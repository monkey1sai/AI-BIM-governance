[CmdletBinding()]
param(
    [ValidateSet('start', 'stop', 'status')][string] $Action = 'status',
    [string] $ChangeId,
    [string] $RunId,
    [string] $Offset,
    [Alias('RepoRoot')][string] $CliRepoRoot
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Import-Module -Force (Join-Path $PSScriptRoot '..\lib\StructLog.psm1')

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

function Get-IsolatedPortListener {
    param(
        [int] $Port,
        [scriptblock] $ConnectionLookup = { Get-NetTCPConnection -ErrorAction Stop }
    )
    $connections = @(& $ConnectionLookup)
    @($connections | Where-Object { [int]$_.LocalPort -eq $Port -and [string]$_.State -eq 'Listen' }) | Select-Object -First 1
}

function Assert-IsolatedStackStartPreflight {
    param(
        [string] $RepoRoot, [string] $ChangeId, [string] $RunId, [string] $OffsetInput,
        [scriptblock] $ListenerLookup = {
            param($port)
            Get-IsolatedPortListener -Port $port
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

function Assert-IsolatedCleanWorktree {
    param([string] $RepoRoot, [scriptblock] $StatusFn = { param($root) & git -C $root status --porcelain --untracked-files=all })
    $entries = @(& $StatusFn $RepoRoot | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) })
    if ($entries.Count -gt 0) {
        throw 'Isolated stack start requires a clean worktree; tracked or nonignored untracked changes are not allowed.'
    }
}

function ConvertTo-IsolatedWindowsArgumentLine {
    param([string[]] $Arguments)
    @($Arguments | ForEach-Object {
        $argument = [string]$_
        if ($argument -notmatch '[\s"]') { return $argument }
        '"' + ([regex]::Replace($argument, '(\\*)"', '$1$1\\"') -replace '(\\+)$', '$1$1') + '"'
    }) -join ' '
}

function Resolve-IsolatedStackReservation {
    param([string] $RepoRoot, [string] $ChangeId, [string] $RunId, [int] $Offset)
    $runPath = Join-Path $RepoRoot "artifacts\e2e\$ChangeId\$RunId\.stack-reservation.json"
    $portPath = Join-Path $RepoRoot "artifacts\e2e\_isolated-stack-reservations\offset-$Offset.reservation.json"
    [pscustomobject]@{ paths=@($runPath,$portPath) }
}

function Acquire-IsolatedStackReservations {
    param([string] $RepoRoot, [string] $ChangeId, [string] $RunId, [int] $Offset)
    $reservation = Resolve-IsolatedStackReservation -RepoRoot $RepoRoot -ChangeId $ChangeId -RunId $RunId -Offset $Offset
    $created = [System.Collections.Generic.List[string]]::new()
    try {
        foreach ($path in @($reservation.paths)) {
            New-Item -ItemType Directory -Force -Path (Split-Path -Parent $path) | Out-Null
            try {
                $stream = [IO.File]::Open($path, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
                try { [Text.Encoding]::UTF8.GetBytes('{"owner":"isolated-branch-stack"}') | ForEach-Object { $stream.WriteByte($_) } } finally { $stream.Dispose() }
                $created.Add($path)
            } catch [IO.IOException] {
                throw "Isolated stack reservation is already held: $path"
            }
        }
        [pscustomobject]@{ paths=@($created) }
    } catch {
        foreach ($path in @($created)) { Remove-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue }
        throw
    }
}

function Release-IsolatedStackReservations {
    param($Reservation)
    if ($null -eq $Reservation) { return }
    foreach ($path in @($Reservation.paths)) {
        Remove-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue
        if (Test-Path -LiteralPath $path) { throw "Failed to release isolated stack reservation: $path" }
    }
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

function Resolve-IsolatedStackStateLayout {
    param([string] $RepoRoot, [string] $RunDirectory)
    $fixtureRoot = [IO.Path]::GetFullPath((Join-Path $RepoRoot 'storage'))
    $stateRoot = [IO.Path]::GetFullPath((Join-Path $RunDirectory 'state'))
    $governanceRoot = Join-Path $stateRoot 'governance'
    $coordinatorRoot = Join-Path $stateRoot 'coordinator'
    [pscustomobject]@{
        fixture_root = $fixtureRoot
        state_root = $stateRoot
        governance_root = $governanceRoot
        governance_db = Join-Path $governanceRoot 'governance.db'
        governance_federation_out = Join-Path $governanceRoot 'federated'
        coordinator_root = $coordinatorRoot
    }
}

function New-IsolatedBackendEnvironment {
    param(
        [ValidateSet('governance','coordinator')][string] $Role,
        $StateLayout,
        $Ports
    )
    if ($Role -eq 'governance') {
        return @{
            GOV_PORT = "$($Ports.governance)"
            GOV_DB_PATH = [string]$StateLayout.governance_db
            GOV_FED_OUT = [string]$StateLayout.governance_federation_out
            BIM_FILE_LIBRARY_ROOT = [string]$StateLayout.fixture_root
            RUNTIME_STORAGE_ROOT = [string]$StateLayout.fixture_root
            LOG_ROOT = (Join-Path $StateLayout.governance_root 'logs')
        }
    }

    $coordinatorRoot = [string]$StateLayout.coordinator_root
    $fixtureArtifacts = Join-Path $StateLayout.fixture_root 'artifacts'
    $coordinatorStorage = Join-Path $coordinatorRoot 'storage'
    @{
        PORT = "$($Ports.coordinator)"
        HOST = '127.0.0.1'
        GOVERNANCE_API_BASE = "http://127.0.0.1:$($Ports.governance)"
        COORDINATOR_PUBLIC_BASE_URL = "http://127.0.0.1:$($Ports.coordinator)"
        VIEWER_PUBLIC_BASE_URL = "http://127.0.0.1:$($Ports.viewer)"
        CORS_ORIGINS = "http://127.0.0.1:$($Ports.viewer)"
        SESSION_STORE_DIR = (Join-Path $coordinatorRoot 'sessions')
        EVENT_LOG_DIR = (Join-Path $coordinatorRoot 'events')
        CALLBACK_OUTBOX_STORE_PATH = (Join-Path $coordinatorRoot 'callback-outbox.json')
        CONVERSION_LEDGER_STORE_PATH = (Join-Path $coordinatorRoot 'conversion-ledger.json')
        ARTIFACT_HEALTH_LEDGER_STORE_PATH = (Join-Path $coordinatorRoot 'artifact-health-ledger.json')
        EXTERNAL_IFC_READY_STORE_PATH = (Join-Path $coordinatorRoot 'external-ifc-ready.json')
        STORAGE_ROOT = $coordinatorStorage
        STORAGE_HOST_ROOT = $coordinatorStorage
        RUNTIME_STORAGE_ROOT = $coordinatorStorage
        EDGE_RUNTIME_DATA_ROOT = (Join-Path $coordinatorRoot 'edge-runtime')
        A4_CONVERSION_ARTIFACTS_ROOT = $fixtureArtifacts
        A4_CONVERSION_ARTIFACTS_HOST_ROOT = $fixtureArtifacts
        LOG_ROOT = (Join-Path $coordinatorRoot 'logs')
        MINIO_WATCH_ENABLED = 'false'
    }
}

function ConvertTo-IsolatedCreationIdentity {
    param($CreationDate)
    if ($CreationDate -is [DateTimeOffset]) {
        return $CreationDate.UtcDateTime.ToString('o')
    }
    if ($CreationDate -is [datetime]) {
        return $CreationDate.ToUniversalTime().ToString('o')
    }
    $value = [string]$CreationDate
    if ($value -match '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,7})?Z$') {
        $parsed = [DateTimeOffset]::MinValue
        if ([DateTimeOffset]::TryParse(
            $value,
            [Globalization.CultureInfo]::InvariantCulture,
            [Globalization.DateTimeStyles]::AllowWhiteSpaces,
            [ref]$parsed
        )) {
            return $parsed.UtcDateTime.ToString('o')
        }
    }
    return $value
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
        creation_identity = ConvertTo-IsolatedCreationIdentity $process.CreationDate
        executable_path = [string]$process.ExecutablePath
    }
}

function New-IsolatedStackLifecycleData {
    param(
        [string]$StructRunId,
        [string]$ChangeId,
        [string]$StackRunId,
        [ValidateSet('start','status','stop','rollback')][string]$Action,
        [ValidateSet('start','active','closing','closed')][string]$Phase,
        [string]$Status
    )
    $data = @{
        phase = $Phase
        subject_kind = 'script_run'
        subject_id = $StructRunId
        change_id = $ChangeId
        stack_run_id = $StackRunId
        action = $Action
    }
    if (-not [string]::IsNullOrWhiteSpace($Status)) { $data.status = $Status }
    return $data
}

function Test-IsolatedProcessOwnership {
    param($Expected, $Actual)
    $null -ne $Actual `
      -and [int]$Expected.pid -eq [int]$Actual.pid `
      -and [string]$Expected.entrypoint -ceq [string]$Actual.entrypoint `
      -and [string]$Expected.command_line -ceq [string]$Actual.command_line `
      -and (ConvertTo-IsolatedCreationIdentity $Expected.creation_identity) -ceq (ConvertTo-IsolatedCreationIdentity $Actual.creation_identity)
}

function Start-IsolatedBackend {
    param(
        [string] $Role, [string] $WorkingDirectory, [string] $Executable,
        [string[]] $Arguments, [hashtable] $Environment, [string] $RunDirectory,
        [string] $Entrypoint,
        [scriptblock] $StartProcessFn = {
            param($exe,$argumentList,$cwd,$envMap,$stdout,$stderr)
            Start-Process -FilePath $exe -ArgumentList (ConvertTo-IsolatedWindowsArgumentLine -Arguments $argumentList) -WorkingDirectory $cwd `
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
        [scriptblock] $ProcessHandleLookup = { param($processId) Get-Process -Id $processId -ErrorAction Stop },
        [scriptblock] $StopProcessFn = {
            param($processId,$processHandle,$safeProcessHandle)
            if ($null -eq $processHandle -or $null -eq $safeProcessHandle) { throw "Pinned process handle is required for $processId." }
            if ([bool]$safeProcessHandle.IsInvalid -or [bool]$safeProcessHandle.IsClosed) { throw "Pinned process handle for $processId is no longer valid." }
            $processHandle.Kill()
        },
        [scriptblock] $MissingProcessFn,
        [switch] $AllowMissing
    )
    $verified = [System.Collections.Generic.List[object]]::new()
    $results = [System.Collections.Generic.List[object]]::new()
    $prevalidationFailed = $false
    foreach ($expected in $Processes) {
        if ($expected.PSObject.Properties['stop_status'] -and [string]$expected.stop_status -eq 'stopped') {
            $results.Add([pscustomobject]@{role=$expected.role;pid=$expected.pid;status='already_stopped';reason='persisted_stop_state'})
            continue
        }
        try { $actual = & $IdentityLookup $expected } catch {
            if ($null -ne $MissingProcessFn -and [bool](& $MissingProcessFn $expected)) {
                $results.Add([pscustomobject]@{role=$expected.role;pid=$expected.pid;status='already_stopped';reason='process_absent_and_port_free'})
            } else {
                $reason = if ($AllowMissing) { 'rollback_identity_unproven' } else { 'identity_lookup_failed' }
                $results.Add([pscustomobject]@{role=$expected.role;pid=$expected.pid;status='not_owned';reason=$reason})
                $prevalidationFailed = $true
            }
            continue
        }
        if (-not (Test-IsolatedProcessOwnership -Expected $expected -Actual $actual)) {
            $results.Add([pscustomobject]@{role=$expected.role;pid=$expected.pid;status='not_owned';reason='identity_mismatch'})
            $prevalidationFailed = $true
            continue
        }
        $verified.Add($expected)
    }
    if ($prevalidationFailed) { return @($results) }
    foreach ($process in @($verified | Sort-Object { [array]::IndexOf($Processes, $_) } -Descending)) {
        $processHandle = $null
        $safeProcessHandle = $null
        try {
            if ($null -ne $ProcessHandleLookup) {
                $processHandle = & $ProcessHandleLookup ([int]$process.pid)
                if ($null -eq $processHandle -or [int]$processHandle.Id -ne [int]$process.pid -or [bool]$processHandle.HasExited) {
                    throw "Fresh process handle for $($process.pid) is unavailable."
                }
                $safeProcessHandle = $processHandle.SafeHandle
                if ($null -eq $safeProcessHandle -or [bool]$safeProcessHandle.IsInvalid -or [bool]$safeProcessHandle.IsClosed) {
                    throw "Fresh process handle for $($process.pid) cannot be pinned."
                }
            }
            $immediate = & $IdentityLookup $process
            if (-not (Test-IsolatedProcessOwnership -Expected $process -Actual $immediate)) {
                $results.Add([pscustomobject]@{role=$process.role;pid=$process.pid;status='not_owned';reason='identity_changed_before_stop'})
                return @($results)
            }
        } catch {
            $results.Add([pscustomobject]@{role=$process.role;pid=$process.pid;status='not_owned';reason="fresh_revalidation_failed: $($_.Exception.Message)"})
            return @($results)
        }
        try {
            & $StopProcessFn ([int]$process.pid) $processHandle $safeProcessHandle
            $results.Add([pscustomobject]@{role=$process.role;pid=$process.pid;status='stopped';reason=$null})
        } catch {
            $results.Add([pscustomobject]@{role=$process.role;pid=$process.pid;status='stop_failed';reason=$_.Exception.Message})
        }
    }
    @($results)
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
    param([string]$RepoRoot,[string]$ChangeId,[string]$RunId,$Preflight,[string]$HeadSha,[object[]]$Processes,$StateLayout)
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
        read_only_fixture_root=[string]$StateLayout.fixture_root
        mutable_state=[ordered]@{
            root=[string]$StateLayout.state_root
            governance_db=[string]$StateLayout.governance_db
            governance_federation_out=[string]$StateLayout.governance_federation_out
            coordinator_root=[string]$StateLayout.coordinator_root
        }
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

function New-IsolatedMissingProcessGuard {
    param($Ports,[scriptblock]$ProcessExistsFn,[scriptblock]$ListenerLookupFn)
    {
        param($expected)
        try {
            if ([bool](& $ProcessExistsFn ([int]$expected.pid))) { return $false }
            $port = [int]$Ports.($expected.role)
            return $null -eq (& $ListenerLookupFn $port)
        } catch {
            return $false
        }
    }.GetNewClosure()
}

function Stop-IsolatedStackRun {
    param(
        $Manifest,[string]$ManifestPath,[scriptblock]$IdentityLookup,[scriptblock]$StopProcessFn,
        [scriptblock]$ProcessExistsFn,[scriptblock]$ListenerLookupFn,[scriptblock]$ProcessHandleLookup
    )
    if ($Manifest.stopped_at) { return [pscustomobject]@{status='already_stopped';manifest_path=$ManifestPath} }
    $missingProcessFn = New-IsolatedMissingProcessGuard -Ports $Manifest.ports -ProcessExistsFn $ProcessExistsFn -ListenerLookupFn $ListenerLookupFn
    $results = @(Stop-IsolatedBackends -Processes @($Manifest.processes) -IdentityLookup $IdentityLookup -ProcessHandleLookup $ProcessHandleLookup -StopProcessFn $StopProcessFn -MissingProcessFn $missingProcessFn)
    $Manifest | Add-Member -Force -NotePropertyName stop_state -NotePropertyValue ([ordered]@{ attempted_at=[DateTime]::UtcNow.ToString('o'); entries=$results })
    foreach ($result in $results) {
        $process = @($Manifest.processes | Where-Object { $_.role -eq $result.role -and $_.pid -eq $result.pid }) | Select-Object -First 1
        if ($process -and $result.status -in @('stopped','already_stopped')) {
            $process | Add-Member -Force -NotePropertyName stop_status -NotePropertyValue 'stopped'
            $Manifest.backend_ready.($result.role) = $false
        }
    }
    $failed = @($results | Where-Object { $_.status -in @('not_owned','stop_failed') })
    if ($failed.Count -eq 0) {
        $Manifest.stopped_at=[DateTime]::UtcNow.ToString('o')
        $Manifest.backend_ready.governance=$false
        $Manifest.backend_ready.coordinator=$false
    }
    Write-IsolatedJsonAtomic -Path $ManifestPath -Value $Manifest
    if ($failed.Count -gt 0) { throw "Partial stop; recoverable per-process state persisted for: $($failed.role -join ',')" }
    [pscustomobject]@{status='stopped';manifest_path=$ManifestPath}
}

function Start-IsolatedStackRun {
    param(
        $RepoRoot,$ChangeId,$RunId,$Preflight,$Runtime,$Reservation,$StartBackendFn,$HealthFn,$IdentityLookup,$StopProcessFn,$HeadShaFn,
        [scriptblock]$ProcessExistsFn,[scriptblock]$ListenerLookupFn,[scriptblock]$ProcessHandleLookup,$LifecycleLogger
    )
    $runDirectory=Split-Path -Parent $Preflight.manifest_path
    $stateLayout=Resolve-IsolatedStackStateLayout -RepoRoot $RepoRoot -RunDirectory $runDirectory
    foreach ($directory in @(
        $stateLayout.state_root,
        $stateLayout.governance_root,
        $stateLayout.coordinator_root,
        (Join-Path $stateLayout.coordinator_root 'storage'),
        (Join-Path $stateLayout.coordinator_root 'edge-runtime')
    )) {
        New-Item -ItemType Directory -Force -Path $directory | Out-Null
    }
    $started=[System.Collections.Generic.List[object]]::new()
    try {
        $head=& $HeadShaFn $RepoRoot
        if($head -notmatch '^[0-9a-f]{40}$'){throw 'HEAD identity is not a 40-character commit SHA'}

        $governanceSpec=@{
            Role='governance';WorkingDirectory=(Join-Path $RepoRoot 'governance-service');Executable=$Runtime.python
            Arguments=@('-m','uvicorn','app:app','--host','127.0.0.1','--port',"$($Preflight.ports.governance)")
            Environment=(New-IsolatedBackendEnvironment -Role governance -StateLayout $stateLayout -Ports $Preflight.ports)
            RunDirectory=$runDirectory;Entrypoint='app:app'
        }
        $governance=& $StartBackendFn $governanceSpec
        $started.Add($governance)
        if(-not (& $HealthFn "http://127.0.0.1:$($Preflight.ports.governance)/health")){throw 'governance health failed'}

        $indexPath=Join-Path $RepoRoot 'bim-review-coordinator\src\index.ts'
        $coordinatorSpec=@{
            Role='coordinator';WorkingDirectory=(Join-Path $RepoRoot 'bim-review-coordinator');Executable=$Runtime.node
            Arguments=@($Runtime.tsx,$indexPath)
            Environment=(New-IsolatedBackendEnvironment -Role coordinator -StateLayout $stateLayout -Ports $Preflight.ports)
            RunDirectory=$runDirectory;Entrypoint=$indexPath
        }
        $coordinator=& $StartBackendFn $coordinatorSpec
        $started.Add($coordinator)
        if(-not (& $HealthFn "http://127.0.0.1:$($Preflight.ports.coordinator)/health")){throw 'coordinator health failed'}

        $manifest=New-IsolatedStackManifest -RepoRoot $RepoRoot -ChangeId $ChangeId -RunId $RunId -Preflight $Preflight -HeadSha $head -Processes @($started) -StateLayout $stateLayout
        Write-IsolatedJsonAtomic -Path $Preflight.manifest_path -Value $manifest -NoClobber
        [pscustomobject]@{status='started';manifest_path=$Preflight.manifest_path;manifest=$manifest}
    } catch {
        $startFailure = $_
        if($started.Count -gt 0){
            $rollbackMissingProcessFn = New-IsolatedMissingProcessGuard -Ports $Preflight.ports -ProcessExistsFn $ProcessExistsFn -ListenerLookupFn $ListenerLookupFn
            $rollbackResults = @(Stop-IsolatedBackends -Processes @($started) -IdentityLookup $IdentityLookup -ProcessHandleLookup $ProcessHandleLookup -StopProcessFn $StopProcessFn -MissingProcessFn $rollbackMissingProcessFn -AllowMissing)
            $rollbackFailures = @($rollbackResults | Where-Object { $_.status -in @('not_owned','stop_failed') })
            if ($null -ne $LifecycleLogger) {
                $rollbackStatus = if ($rollbackFailures.Count -eq 0) { 'complete' } else { 'incomplete' }
                $rollbackData = New-IsolatedStackLifecycleData -StructRunId $LifecycleLogger.RunId -ChangeId $ChangeId `
                    -StackRunId $RunId -Action rollback -Phase closed -Status $rollbackStatus
                $LifecycleLogger | Write-StructLifecycle -Msg 'isolated branch stack startup rollback completed' -Data $rollbackData | Out-Null
            }
            if ($rollbackFailures.Count -gt 0) {
                try {
                    $recovery = New-IsolatedStackManifest -RepoRoot $RepoRoot -ChangeId $ChangeId -RunId $RunId -Preflight $Preflight -HeadSha $head -Processes @($started) -StateLayout $stateLayout
                    $recovery.backend_ready.governance = $false
                    $recovery.backend_ready.coordinator = $false
                    $recovery | Add-Member -Force -NotePropertyName reservation_held -NotePropertyValue $true
                    $recovery | Add-Member -Force -NotePropertyName start_failure -NotePropertyValue ([ordered]@{ message=$startFailure.Exception.Message; occurred_at=[DateTime]::UtcNow.ToString('o') })
                    $recovery | Add-Member -Force -NotePropertyName stop_state -NotePropertyValue ([ordered]@{ attempted_at=[DateTime]::UtcNow.ToString('o'); entries=$rollbackResults })
                    foreach ($result in $rollbackResults) {
                        $process = @($recovery.processes | Where-Object { $_.role -eq $result.role -and $_.pid -eq $result.pid }) | Select-Object -First 1
                        if ($process -and $result.status -in @('stopped','already_stopped')) {
                            $process | Add-Member -Force -NotePropertyName stop_status -NotePropertyValue 'stopped'
                        }
                    }
                    Write-IsolatedJsonAtomic -Path $Preflight.manifest_path -Value $recovery -NoClobber
                } catch {
                    $recoveryPersistenceError = [InvalidOperationException]::new("Start failed, rollback was incomplete, and the recovery manifest could not be persisted; reservations remain held for manual recovery. Cause: $($startFailure.Exception.Message). Persistence error: $($_.Exception.Message)")
                    $recoveryPersistenceError.Data['KeepIsolatedReservation'] = $true
                    throw $recoveryPersistenceError
                }
                $recoveryError = [InvalidOperationException]::new("Start failed and rollback was incomplete; recovery manifest retained at $($Preflight.manifest_path). Cause: $($startFailure.Exception.Message)")
                $recoveryError.Data['KeepIsolatedReservation'] = $true
                throw $recoveryError
            }
        }
        throw
    }
}

function Invoke-IsolatedBranchStack {
    param(
        [ValidateSet('start','status','stop')][string]$Action,
        [string]$ChangeId,[string]$RunId,[string]$OffsetInput,
        [string]$RepoRoot=(Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path,
        [scriptblock]$PreflightFn={param($root,$change,$run,$offset) Assert-IsolatedStackStartPreflight -RepoRoot $root -ChangeId $change -RunId $run -OffsetInput $offset},
        [scriptblock]$RuntimeResolver={param($root) Resolve-IsolatedRuntime -RepoRoot $root},
        [scriptblock]$StartBackendFn={param($spec) Start-IsolatedBackend @spec},
        [scriptblock]$HealthFn={param($url) Wait-IsolatedHealth -Url $url},
        [scriptblock]$IdentityLookup={param($e) Get-IsolatedProcessIdentity -ProcessId ([int]$e.pid) -Entrypoint ([string]$e.entrypoint)},
        [scriptblock]$StopProcessFn={param($processId,$processHandle,$safeProcessHandle) if ($null -eq $processHandle -or $null -eq $safeProcessHandle) { throw "Pinned process handle is required for $processId." }; if ([bool]$safeProcessHandle.IsInvalid -or [bool]$safeProcessHandle.IsClosed) { throw "Pinned process handle for $processId is no longer valid." }; $processHandle.Kill()},
        [scriptblock]$ProcessHandleLookup={param($processId) Get-Process -Id $processId -ErrorAction Stop},
        [scriptblock]$ProcessExistsFn={param($processId) $null -ne (Get-Process -Id $processId -ErrorAction SilentlyContinue)},
        [scriptblock]$StopListenerLookupFn={param($port) Get-IsolatedPortListener -Port $port},
        [scriptblock]$HeadShaFn={param($root) (& git -C $root rev-parse HEAD).Trim()},
        [scriptblock]$WorktreeStatusFn={param($root) & git -C $root status --porcelain --untracked-files=all},
        [scriptblock]$ReservationAcquireFn={param($root,$change,$run,$offset) Acquire-IsolatedStackReservations -RepoRoot $root -ChangeId $change -RunId $run -Offset $offset},
        [scriptblock]$ReservationReleaseFn={param($reservation) Release-IsolatedStackReservations -Reservation $reservation},
        $LifecycleLogger=$null
    )
    Assert-SafeStackSegment -Name 'ChangeId' -Value $ChangeId
    Assert-SafeStackSegment -Name 'RunId' -Value $RunId
    $manifestPath=Resolve-IsolatedStackManifestPath -RepoRoot $RepoRoot -ChangeId $ChangeId -RunId $RunId

    if($Action -in @('status','stop')){
        $manifest=Read-IsolatedStackManifest -Path $manifestPath
        $effectiveOffset = if ([string]::IsNullOrWhiteSpace($OffsetInput)) { [string]$manifest.offset } else { $OffsetInput }
        Assert-IsolatedStackManifestIdentity -Manifest $manifest -RepoRoot $RepoRoot -ChangeId $ChangeId -RunId $RunId -OffsetInput $effectiveOffset
        if($Action -eq 'status'){return Get-IsolatedStackStatus -Manifest $manifest -ManifestPath $manifestPath -IdentityLookup $IdentityLookup -HealthFn $HealthFn}
        $stopResult = Stop-IsolatedStackRun -Manifest $manifest -ManifestPath $manifestPath -IdentityLookup $IdentityLookup -StopProcessFn $StopProcessFn `
            -ProcessExistsFn $ProcessExistsFn -ListenerLookupFn $StopListenerLookupFn -ProcessHandleLookup $ProcessHandleLookup
        if ($manifest.PSObject.Properties['reservation_held'] -and [bool]$manifest.reservation_held) {
            $heldReservation = Resolve-IsolatedStackReservation -RepoRoot $RepoRoot -ChangeId $ChangeId -RunId $RunId -Offset ([int]$manifest.offset)
            & $ReservationReleaseFn $heldReservation
            $manifest.reservation_held = $false
            Write-IsolatedJsonAtomic -Path $manifestPath -Value $manifest
        }
        return $stopResult
    }

    $effectiveOffset = if ([string]::IsNullOrWhiteSpace($OffsetInput)) { '0' } else { $OffsetInput }
    Assert-IsolatedCleanWorktree -RepoRoot $RepoRoot -StatusFn $WorktreeStatusFn
    $null = Resolve-IsolatedStackPorts -OffsetInput $effectiveOffset
    $reservation = & $ReservationAcquireFn $RepoRoot $ChangeId $RunId ([int]$effectiveOffset)
    $releaseReservation = $true
    try {
        $preflight=& $PreflightFn $RepoRoot $ChangeId $RunId $effectiveOffset
        $runtime=& $RuntimeResolver $RepoRoot
        Start-IsolatedStackRun -RepoRoot $RepoRoot -ChangeId $ChangeId -RunId $RunId -Preflight $preflight -Runtime $runtime -Reservation $reservation `
          -StartBackendFn $StartBackendFn -HealthFn $HealthFn -IdentityLookup $IdentityLookup -StopProcessFn $StopProcessFn -HeadShaFn $HeadShaFn `
          -ProcessExistsFn $ProcessExistsFn -ListenerLookupFn $StopListenerLookupFn -ProcessHandleLookup $ProcessHandleLookup -LifecycleLogger $LifecycleLogger
    } catch {
        if ($_.Exception.Data['KeepIsolatedReservation'] -eq $true) { $releaseReservation = $false }
        throw
    } finally {
        if ($releaseReservation) { & $ReservationReleaseFn $reservation }
    }
}

function Invoke-IsolatedBranchStackCli {
    param(
        [ValidateSet('start','status','stop')][string]$Action,
        [string]$ChangeId,
        [string]$RunId,
        [string]$OffsetInput,
        [string]$RepoRoot=(Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
    )
    $logRoot = Join-Path $RepoRoot 'artifacts\e2e\_launcher\structured-logs'
    $structRunId = New-StructLogRunId
    $logger = New-StructLogger -Service 'scripts' -Component 'isolated-branch-stack' -RunId $structRunId `
        -InitialTraceId "script_$structRunId" -LogRoot $logRoot -SkipEnvSnapshot
    $inputsValidated = $false
    try {
        Assert-SafeStackSegment -Name 'ChangeId' -Value $ChangeId
        Assert-SafeStackSegment -Name 'RunId' -Value $RunId
        $inputsValidated = $true
        $startData = New-IsolatedStackLifecycleData -StructRunId $structRunId -ChangeId $ChangeId `
            -StackRunId $RunId -Action $Action -Phase start
        $logger | Write-StructLifecycle -Msg 'isolated branch stack action started' -Data $startData | Out-Null
        $result = Invoke-IsolatedBranchStack -Action $Action -ChangeId $ChangeId -RunId $RunId -OffsetInput $OffsetInput -RepoRoot $RepoRoot -LifecycleLogger $logger
        $completionData = New-IsolatedStackLifecycleData -StructRunId $structRunId -ChangeId $ChangeId `
            -StackRunId $RunId -Action $Action -Phase closed -Status ([string]$result.status)
        $logger | Write-StructLifecycle -Msg 'isolated branch stack action completed' -Data $completionData | Out-Null
        return $result
    } catch {
        $safeChangeId = if ($inputsValidated) { $ChangeId } else { 'invalid' }
        $safeStackRunId = if ($inputsValidated) { $RunId } else { 'invalid' }
        $safeReason = if ($inputsValidated) { $_.Exception.Message } else { 'input validation failed' }
        $failureData = New-IsolatedStackLifecycleData -StructRunId $structRunId -ChangeId $safeChangeId `
            -StackRunId $safeStackRunId -Action $Action -Phase closed -Status failed
        $logger | Write-StructLifecycle -Msg 'isolated branch stack action failed' -Data $failureData -Level error | Out-Null
        $logger | Write-StructAnomaly -Msg 'isolated branch stack action failed' -Data @{
            anomaly_kind = 'unexpected_state'; phase = $Action; reason = $safeReason
            subject_kind = 'script_run'; subject_id = $structRunId; change_id = $safeChangeId; stack_run_id = $safeStackRunId; action = $Action
        } | Out-Null
        throw
    }
}

if ($MyInvocation.InvocationName -ne '.') {
    $cliParameters = @{ Action=$Action; ChangeId=$ChangeId; RunId=$RunId; OffsetInput=$Offset }
    if (-not [string]::IsNullOrWhiteSpace($CliRepoRoot)) { $cliParameters.RepoRoot = $CliRepoRoot }
    Invoke-IsolatedBranchStackCli @cliParameters
}
