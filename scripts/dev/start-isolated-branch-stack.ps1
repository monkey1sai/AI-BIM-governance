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
        [scriptblock] $IdentityLookup = { param($processId,$entry) Get-IsolatedProcessIdentity -ProcessId $processId -Entrypoint $entry }
    )
    New-Item -ItemType Directory -Force -Path $RunDirectory | Out-Null
    $stdout = Join-Path $RunDirectory "$Role.stdout.log"
    $stderr = Join-Path $RunDirectory "$Role.stderr.log"
    $process = & $StartProcessFn $Executable $Arguments $WorkingDirectory $Environment $stdout $stderr
    $identity = & $IdentityLookup ([int]$process.Id) $Entrypoint
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

if ($MyInvocation.InvocationName -ne '.') {
    throw 'Direct execution is unavailable until the Task 4 dispatcher is implemented. Dot-source this file only for tests.'
}
