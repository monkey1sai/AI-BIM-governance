[CmdletBinding()]
param(
    [ValidateSet('start', 'stop', 'status')][string] $Action = 'status',
    [string] $ChangeId,
    [string] $RunId,
    [string] $Offset = '0'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$script:IsolatedStackPolicy = [ordered]@{
    base = [ordered]@{ coordinator = 8005; governance = 49103; viewer = 5180 }
    reserved = @(8004, 49102, 49101, 8010, 5173, 5174, 49100) + @(49110..49150)
}

function Assert-SafeStackSegment {
    param([string] $Name, [string] $Value)
    $deviceName = if ([string]::IsNullOrEmpty($Value)) { '' } else { $Value.Split('.', 2)[0] }
    if ([string]::IsNullOrWhiteSpace($Value) -or
        $Value -in @('.', '..') -or
        $Value -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$' -or
        $Value -match '[. ]$' -or
        $deviceName -match '^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$') {
        throw "$Name must be one safe path segment (1..64 chars: A-Z, a-z, 0-9, dot, underscore, dash)."
    }
}

function Resolve-IsolatedStackPorts {
    param([string] $OffsetInput)
    if ($OffsetInput -notmatch '^[0-4]$') {
        throw 'Offset must be one integer from 0 through 4.'
    }
    $resolvedOffset = [int]$OffsetInput
    $ports = [ordered]@{
        coordinator = $script:IsolatedStackPolicy.base.coordinator + $resolvedOffset
        governance = $script:IsolatedStackPolicy.base.governance + $resolvedOffset
        viewer = $script:IsolatedStackPolicy.base.viewer + $resolvedOffset
    }
    $resolved = [pscustomobject]$ports
    Assert-IsolatedPortSetDisjoint -Ports $resolved
    return $resolved
}

function Assert-IsolatedPortSetDisjoint {
    param($Ports)
    $conflicts = @(
        @($Ports.coordinator, $Ports.governance, $Ports.viewer) |
            Where-Object { $script:IsolatedStackPolicy.reserved -contains $_ }
    )
    if ($conflicts.Count -gt 0) {
        throw "Resolved ports intersect reserved ports: $($conflicts -join ',')."
    }
}

function Resolve-IsolatedStackManifestPath {
    param([string] $RepoRoot, [string] $ChangeId, [string] $RunId)
    Assert-SafeStackSegment -Name 'ChangeId' -Value $ChangeId
    Assert-SafeStackSegment -Name 'RunId' -Value $RunId
    return Join-Path $RepoRoot "artifacts\e2e\$ChangeId\$RunId\stack-manifest.json"
}

function Assert-IsolatedStackStartPreflight {
    param(
        [string] $RepoRoot, [string] $ChangeId, [string] $RunId, [string] $OffsetInput,
        [scriptblock] $ListenerLookup = {
            param($port)
            Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue |
                Select-Object -First 1
        }
    )
    Assert-SafeStackSegment -Name 'ChangeId' -Value $ChangeId
    Assert-SafeStackSegment -Name 'RunId' -Value $RunId
    $ports = Resolve-IsolatedStackPorts -OffsetInput $OffsetInput
    $manifestPath = Resolve-IsolatedStackManifestPath -RepoRoot $RepoRoot -ChangeId $ChangeId -RunId $RunId
    if (Test-Path -LiteralPath $manifestPath) {
        throw "Manifest collision: $manifestPath"
    }
    foreach ($port in @($ports.coordinator, $ports.governance)) {
        $listener = & $ListenerLookup $port
        if ($null -ne $listener) {
            throw "Port $port is occupied; ownership is unknown. No process was stopped."
        }
    }
    [pscustomobject]@{ ports = $ports; manifest_path = $manifestPath; offset = [int]$OffsetInput }
}

function Resolve-IsolatedRuntime {
    param([string] $RepoRoot)
    $pythonCandidates = @(
        (Join-Path $RepoRoot 'governance-service\.venv\Scripts\python.exe'),
        (Join-Path $RepoRoot '.venv\Scripts\python.exe'),
        'C:\Program Files\Python312\python.exe'
    )
    $pythonExe = $pythonCandidates | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
    if (-not $pythonExe) { throw 'No supported host Python was found.' }
    $nodeExe = (Get-Command node -CommandType Application -ErrorAction Stop).Source
    $tsxCli = Join-Path $RepoRoot 'bim-review-coordinator\node_modules\tsx\dist\cli.mjs'
    if (-not (Test-Path -LiteralPath $tsxCli -PathType Leaf)) { throw "Missing current-worktree tsx CLI: $tsxCli" }
    [pscustomobject]@{ python = $pythonExe; node = $nodeExe; tsx = $tsxCli }
}

function Get-IsolatedProcessIdentity {
    param(
        [int] $ProcessId,
        [string] $Entrypoint,
        [scriptblock] $ProcessLookup = { param($id) Get-CimInstance Win32_Process -Filter "ProcessId=$id" -ErrorAction Stop }
    )
    $process = & $ProcessLookup $ProcessId
    if ($null -eq $process) { throw "Process $ProcessId is not running." }
    $commandLine = [string]$process.CommandLine
    if (-not $commandLine.Contains($Entrypoint, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Process $ProcessId command line does not contain exact entrypoint $Entrypoint."
    }
    [pscustomobject]@{
        pid = [int]$process.ProcessId
        entrypoint = $Entrypoint
        command_line = $commandLine
        creation_identity = [string]$process.CreationDate
        executable_path = [string]$process.ExecutablePath
    }
}

function Test-IsolatedProcessOwnership {
    param($Expected, $Actual)
    $null -ne $Actual `
      -and [int]$Expected.pid -eq [int]$Actual.pid `
      -and [string]$Expected.entrypoint -ceq [string]$Actual.entrypoint `
      -and [string]$Expected.command_line -ceq [string]$Actual.command_line `
      -and [string]$Expected.creation_identity -ceq [string]$Actual.creation_identity
}

function Start-IsolatedBackend {
    param(
        [string] $Role, [string] $WorkingDirectory, [string] $Executable,
        [string[]] $Arguments, [hashtable] $Environment, [string] $RunDirectory,
        [string] $Entrypoint,
        [scriptblock] $StartProcessFn = {
            param($exe,$args,$cwd,$envMap,$stdout,$stderr)
            Start-Process -FilePath $exe -ArgumentList $args -WorkingDirectory $cwd `
              -Environment $envMap -WindowStyle Hidden -PassThru `
              -RedirectStandardOutput $stdout -RedirectStandardError $stderr
        },
        [scriptblock] $IdentityLookup = { param($processId,$entry) Get-IsolatedProcessIdentity -ProcessId $processId -Entrypoint $entry },
        [scriptblock] $StopSpawnedProcessFn = {
            param($spawnedProcess)
            if ($null -ne $spawnedProcess -and -not $spawnedProcess.HasExited) {
                $spawnedProcess.Kill()
                $spawnedProcess.WaitForExit()
            }
        }
    )
    New-Item -ItemType Directory -Force -Path $RunDirectory | Out-Null
    $stdout = Join-Path $RunDirectory "$Role.stdout.log"
    $stderr = Join-Path $RunDirectory "$Role.stderr.log"
    $process = & $StartProcessFn $Executable $Arguments $WorkingDirectory $Environment $stdout $stderr
    try {
        $identity = & $IdentityLookup ([int]$process.Id) $Entrypoint
    } catch {
        try { & $StopSpawnedProcessFn $process } catch {}
        throw
    }
    $identity | Add-Member -NotePropertyName 'role' -NotePropertyValue $Role
    $identity | Add-Member -NotePropertyName 'stdout_path' -NotePropertyValue $stdout
    $identity | Add-Member -NotePropertyName 'stderr_path' -NotePropertyValue $stderr
    $identity
}

function Wait-IsolatedHealth {
    param(
        [string] $Url, [int] $TimeoutSeconds = 45,
        [scriptblock] $Probe = { param($uri) Invoke-WebRequest -UseBasicParsing -TimeoutSec 3 -Uri $uri }
    )
    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    while ([DateTime]::UtcNow -lt $deadline) {
        try { if ((& $Probe $Url).StatusCode -eq 200) { return $true } } catch {}
        Start-Sleep -Milliseconds 500
    }
    $false
}

function Stop-IsolatedBackends {
    param(
        [object[]] $Processes,
        [scriptblock] $IdentityLookup = { param($e) Get-IsolatedProcessIdentity -ProcessId ([int]$e.pid) -Entrypoint ([string]$e.entrypoint) },
        [scriptblock] $StopProcessFn = { param($processId) Stop-Process -Id $processId -Force -ErrorAction Stop }
    )
    $verified = foreach ($expected in $Processes) {
        $actual = & $IdentityLookup $expected
        if (-not (Test-IsolatedProcessOwnership -Expected $expected -Actual $actual)) {
            throw "Ownership mismatch for $($expected.role) PID $($expected.pid); no process was stopped."
        }
        $expected
    }
    foreach ($process in @($verified | Sort-Object { [array]::IndexOf($Processes, $_) } -Descending)) {
        & $StopProcessFn ([int]$process.pid)
    }
}

function Write-IsolatedJsonAtomic {
    param([string] $Path, $Value, [switch] $NoClobber)
    if ($NoClobber -and (Test-Path -LiteralPath $Path)) { throw "Manifest collision: $Path" }
    $directory = Split-Path -Parent $Path
    New-Item -ItemType Directory -Force -Path $directory | Out-Null
    $temporary = Join-Path $directory ".stack-manifest.$([Guid]::NewGuid().ToString('N')).tmp"
    try {
        $Value | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $temporary -Encoding utf8NoBOM
        [System.IO.File]::Move($temporary, $Path, -not $NoClobber)
    } finally {
        if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Force }
    }
}

function Read-IsolatedStackManifest {
    param([string] $Path)
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw "Stack manifest not found: $Path" }
    Get-Content -Raw -LiteralPath $Path | ConvertFrom-Json -Depth 12
}

function Assert-IsolatedStackManifestIdentity {
    param($Manifest,[string]$RepoRoot,[string]$ChangeId,[string]$RunId,[string]$OffsetInput)
    if ([string]$Manifest.schema_version -cne 'isolated-branch-stack/v1' -or
        [string]$Manifest.stack_kind -cne 'isolated_branch_stack') {
        throw 'Manifest schema/stack identity mismatch.'
    }
    if ([string]$Manifest.change_id -cne $ChangeId -or [string]$Manifest.run_id -cne $RunId) {
        throw 'Manifest change/run identity mismatch.'
    }
    $expectedRoot = [IO.Path]::GetFullPath($RepoRoot).TrimEnd('\')
    $actualRoot = [IO.Path]::GetFullPath([string]$Manifest.worktree_root).TrimEnd('\')
    if (-not $actualRoot.Equals($expectedRoot, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Manifest worktree identity mismatch.'
    }
    $ports = Resolve-IsolatedStackPorts -OffsetInput $OffsetInput
    if ([int]$Manifest.offset -ne [int]$OffsetInput -or
        [int]$Manifest.ports.coordinator -ne $ports.coordinator -or
        [int]$Manifest.ports.governance -ne $ports.governance -or
        [int]$Manifest.ports.viewer -ne $ports.viewer) {
        throw 'Manifest offset/port identity mismatch.'
    }
    if ([string]$Manifest.base_urls.coordinator -cne "http://127.0.0.1:$($ports.coordinator)" -or
        [string]$Manifest.base_urls.governance -cne "http://127.0.0.1:$($ports.governance)" -or
        [string]$Manifest.base_urls.viewer -cne "http://127.0.0.1:$($ports.viewer)") {
        throw 'Manifest base URL identity mismatch.'
    }
    if ([string]$Manifest.lifecycle_owners.governance -cne 'repo_launcher' -or
        [string]$Manifest.lifecycle_owners.coordinator -cne 'repo_launcher' -or
        [string]$Manifest.lifecycle_owners.viewer -cne 'playwright_webserver') {
        throw 'Manifest lifecycle owner identity mismatch.'
    }
    if ([int]$Manifest.viewer.expected_port -ne $ports.viewer -or
        [string]$Manifest.viewer.owner -cne 'playwright_webserver' -or
        $null -eq $Manifest.viewer.managed_by_launcher -or
        [bool]$Manifest.viewer.managed_by_launcher) {
        throw 'Manifest viewer identity mismatch.'
    }
}

function New-IsolatedStackManifest {
    param([string]$RepoRoot,[string]$ChangeId,[string]$RunId,$Preflight,[string]$HeadSha,[object[]]$Processes)
    [ordered]@{
        schema_version='isolated-branch-stack/v1'; stack_kind='isolated_branch_stack'
        change_id=$ChangeId; run_id=$RunId; worktree_root=$RepoRoot; offset=$Preflight.offset
        ports=$Preflight.ports
        base_urls=[ordered]@{
            coordinator="http://127.0.0.1:$($Preflight.ports.coordinator)"
            governance="http://127.0.0.1:$($Preflight.ports.governance)"
            viewer="http://127.0.0.1:$($Preflight.ports.viewer)"
        }
        head_sha=$HeadSha; started_at=[DateTime]::UtcNow.ToString('o'); stopped_at=$null
        backend_ready=[ordered]@{governance=$true;coordinator=$true}
        lifecycle_owners=[ordered]@{governance='repo_launcher';coordinator='repo_launcher';viewer='playwright_webserver'}
        viewer=[ordered]@{expected_port=$Preflight.ports.viewer;owner='playwright_webserver';managed_by_launcher=$false}
        processes=$Processes
    }
}

function Get-IsolatedStackStatus {
    param($Manifest,[string]$ManifestPath,[scriptblock]$IdentityLookup,[scriptblock]$HealthFn)
    $backend = foreach ($expected in @($Manifest.processes)) {
        $actual = $null
        try { $actual = & $IdentityLookup $expected } catch {}
        $owned = Test-IsolatedProcessOwnership -Expected $expected -Actual $actual
        $ready = $false
        if ($owned) {
            $healthUrl = "$($Manifest.base_urls.($expected.role))/health"
            try { $ready = [bool](& $HealthFn $healthUrl) } catch { $ready = $false }
        }
        [pscustomobject]@{ role=$expected.role;pid=$expected.pid;owned=$owned;ready=$ready }
    }
    [pscustomobject]@{stack_kind=$Manifest.stack_kind;backend=@($backend);viewer=$Manifest.viewer;manifest_path=$ManifestPath}
}

function Stop-IsolatedStackRun {
    param($Manifest,[string]$ManifestPath,[scriptblock]$IdentityLookup,[scriptblock]$StopProcessFn)
    if ($Manifest.stopped_at) { return [pscustomobject]@{status='already_stopped';manifest_path=$ManifestPath} }
    Stop-IsolatedBackends -Processes @($Manifest.processes) -IdentityLookup $IdentityLookup -StopProcessFn $StopProcessFn
    $Manifest.stopped_at=[DateTime]::UtcNow.ToString('o')
    $Manifest.backend_ready.governance=$false
    $Manifest.backend_ready.coordinator=$false
    Write-IsolatedJsonAtomic -Path $ManifestPath -Value $Manifest
    [pscustomobject]@{status='stopped';manifest_path=$ManifestPath}
}

function Start-IsolatedStackRun {
    param($RepoRoot,$ChangeId,$RunId,$Preflight,$Runtime,$StartBackendFn,$HealthFn,$IdentityLookup,$StopProcessFn,$HeadShaFn)
    $runDirectory=Split-Path -Parent $Preflight.manifest_path
    $started=[System.Collections.Generic.List[object]]::new()
    try {
        $governanceSpec=@{
            Role='governance';WorkingDirectory=(Join-Path $RepoRoot 'governance-service');Executable=$Runtime.python
            Arguments=@('-m','uvicorn','app:app','--host','127.0.0.1','--port',"$($Preflight.ports.governance)")
            Environment=@{GOV_PORT="$($Preflight.ports.governance)"};RunDirectory=$runDirectory;Entrypoint='app:app'
        }
        $governance=& $StartBackendFn $governanceSpec
        $started.Add($governance)
        if(-not (& $HealthFn "http://127.0.0.1:$($Preflight.ports.governance)/health")){throw 'governance health failed'}

        $indexPath=Join-Path $RepoRoot 'bim-review-coordinator\src\index.ts'
        $coordinatorSpec=@{
            Role='coordinator';WorkingDirectory=(Join-Path $RepoRoot 'bim-review-coordinator');Executable=$Runtime.node
            Arguments=@($Runtime.tsx,$indexPath)
            Environment=@{
                PORT="$($Preflight.ports.coordinator)";HOST='127.0.0.1'
                GOVERNANCE_API_BASE="http://127.0.0.1:$($Preflight.ports.governance)"
                COORDINATOR_PUBLIC_BASE_URL="http://127.0.0.1:$($Preflight.ports.coordinator)"
                VIEWER_PUBLIC_BASE_URL="http://127.0.0.1:$($Preflight.ports.viewer)"
                CORS_ORIGINS="http://127.0.0.1:$($Preflight.ports.viewer)"
            }
            RunDirectory=$runDirectory;Entrypoint=$indexPath
        }
        $coordinator=& $StartBackendFn $coordinatorSpec
        $started.Add($coordinator)
        if(-not (& $HealthFn "http://127.0.0.1:$($Preflight.ports.coordinator)/health")){throw 'coordinator health failed'}

        $head=& $HeadShaFn $RepoRoot
        if($head -notmatch '^[0-9a-f]{40}$'){throw 'HEAD identity is not a 40-character commit SHA'}
        $manifest=New-IsolatedStackManifest -RepoRoot $RepoRoot -ChangeId $ChangeId -RunId $RunId -Preflight $Preflight -HeadSha $head -Processes @($started)
        Write-IsolatedJsonAtomic -Path $Preflight.manifest_path -Value $manifest -NoClobber
        [pscustomobject]@{status='started';manifest_path=$Preflight.manifest_path;manifest=$manifest}
    } catch {
        if($started.Count -gt 0){Stop-IsolatedBackends -Processes @($started) -IdentityLookup $IdentityLookup -StopProcessFn $StopProcessFn}
        throw
    }
}

function Invoke-IsolatedBranchStack {
    param(
        [ValidateSet('start','status','stop')][string]$Action,
        [string]$ChangeId,[string]$RunId,[string]$OffsetInput='0',
        [string]$RepoRoot=(Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path,
        [scriptblock]$PreflightFn={param($root,$change,$run,$offset) Assert-IsolatedStackStartPreflight -RepoRoot $root -ChangeId $change -RunId $run -OffsetInput $offset},
        [scriptblock]$RuntimeResolver={param($root) Resolve-IsolatedRuntime -RepoRoot $root},
        [scriptblock]$StartBackendFn={param($spec) Start-IsolatedBackend @spec},
        [scriptblock]$HealthFn={param($url) Wait-IsolatedHealth -Url $url},
        [scriptblock]$IdentityLookup={param($e) Get-IsolatedProcessIdentity -ProcessId ([int]$e.pid) -Entrypoint ([string]$e.entrypoint)},
        [scriptblock]$StopProcessFn={param($processId) Stop-Process -Id $processId -Force -ErrorAction Stop},
        [scriptblock]$HeadShaFn={param($root) (& git -C $root rev-parse HEAD).Trim()}
    )
    Assert-SafeStackSegment -Name 'ChangeId' -Value $ChangeId
    Assert-SafeStackSegment -Name 'RunId' -Value $RunId
    $manifestPath=Resolve-IsolatedStackManifestPath -RepoRoot $RepoRoot -ChangeId $ChangeId -RunId $RunId

    if($Action -in @('status','stop')){
        $manifest=Read-IsolatedStackManifest -Path $manifestPath
        Assert-IsolatedStackManifestIdentity -Manifest $manifest -RepoRoot $RepoRoot -ChangeId $ChangeId -RunId $RunId -OffsetInput $OffsetInput
        if($Action -eq 'status'){return Get-IsolatedStackStatus -Manifest $manifest -ManifestPath $manifestPath -IdentityLookup $IdentityLookup -HealthFn $HealthFn}
        return Stop-IsolatedStackRun -Manifest $manifest -ManifestPath $manifestPath -IdentityLookup $IdentityLookup -StopProcessFn $StopProcessFn
    }

    $preflight=& $PreflightFn $RepoRoot $ChangeId $RunId $OffsetInput
    $runtime=& $RuntimeResolver $RepoRoot
    Start-IsolatedStackRun -RepoRoot $RepoRoot -ChangeId $ChangeId -RunId $RunId -Preflight $preflight -Runtime $runtime `
      -StartBackendFn $StartBackendFn -HealthFn $HealthFn -IdentityLookup $IdentityLookup -StopProcessFn $StopProcessFn -HeadShaFn $HeadShaFn
}

if ($MyInvocation.InvocationName -ne '.') {
    Invoke-IsolatedBranchStack -Action $Action -ChangeId $ChangeId -RunId $RunId -OffsetInput $Offset
}
