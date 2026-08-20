[CmdletBinding()]
param(
    [ValidateSet('start', 'stop', 'status')][string] $Action = 'start',
    [int]    $SignalPort = 49131,
    [int]    $StreamPort = 48031,
    [string] $InstanceId = 'kit_probe_001',
    [string] $PublicIp = '127.0.0.1',
    [string] $PortableRoot = '',
    [string] $WorkRoot = '',
    [string] $AllowedStageHosts = '127.0.0.1:49101,localhost:49101',
    [int]    $ReadyTimeoutSeconds = 300,
    [switch] $KeepOnTimeout,
    [Alias('RepoRoot')][string] $CliRepoRoot = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# Isolated Kit launcher for the DataChannel message probe (see README.md).
#
# It mirrors the argument shape of bim-streaming-server/scripts/start-streaming-server.ps1
# but invokes kit.exe directly, so:
#   * the PID belongs to this script (teardown is provable, not best-effort);
#   * the log lands under a caller-chosen work root instead of the repo's
#     logs\nvstreamer tree that the real launcher owns;
#   * no coordinator environment is inherited, which is the whole point - the
#     runtime authority must walk its `authority_unavailable` branch.
#
# This script deliberately does NOT import scripts/lib/StructLog.psm1 or the
# deploy-target registry: the probe has to stay runnable against a bare checkout
# whose only build output is bim-streaming-server/_build. Progress goes to
# Write-Verbose; the machine-readable result is the returned object plus
# run-manifest.json under the work root.

# Ports the canonical deployment and the isolated branch stack own. Source of
# truth: scripts/dev/start-isolated-branch-stack.ps1 ($IsolatedStackPolicy.reserved),
# scripts/deploy.ps1 parameter defaults, scripts/.run/bim-streaming-server.params.json.
# Mirrored rather than imported for the reason above; if those move, update here.
$script:ProbeReservedPorts = @(
    8004, 8010, 5173, 5174, 49100, 49101, 49102, # coordinator / viewer / conversion authority
    47998,                                        # primary Kit media
    49110, 49120, 49130, 49140, 49150,            # spectator signalling
    48008, 48018, 48028, 48038, 48048             # spectator media
)

# Environment the child must NOT inherit. Emptying COORDINATOR_INTERNAL_API_BASE
# and INTERNAL_API_AUTH_TOKEN is what forces RuntimeAuthorityClient to report
# `_configuration_valid = False` and answer every command with
# detail_code=authority_unavailable instead of dialling a coordinator.
# See bim-streaming-server/.../messaging/runtime_authority.py.
$script:ProbeClearedEnvironmentNames = @(
    'COORDINATOR_INTERNAL_API_BASE',
    'INTERNAL_API_AUTH_TOKEN'
)

function Resolve-ProbeRepoRoot {
    param([string] $Requested)

    $candidate = if ([string]::IsNullOrWhiteSpace($Requested)) {
        Join-Path $PSScriptRoot '..\..\..'
    } else {
        $Requested
    }
    $resolved = Resolve-Path -LiteralPath $candidate -ErrorAction Stop
    if ([string]$resolved.Provider.Name -cne 'FileSystem' -or -not (Test-Path -LiteralPath $resolved.Path -PathType Container)) {
        throw "RepoRoot must resolve to one filesystem directory: $candidate"
    }
    return [IO.Path]::GetFullPath([string]$resolved.Path)
}

function Resolve-ProbeWorkRoot {
    param(
        [Parameter(Mandatory = $true)][string] $RepoRoot,
        [string] $Requested
    )

    # Precedence: -WorkRoot, then KIT_MESSAGE_PROBE_WORK_ROOT, then a gitignored
    # default inside the repo (artifacts/tmp/ is ignored - see .gitignore).
    $value = $Requested
    if ([string]::IsNullOrWhiteSpace($value)) {
        $value = [string]$env:KIT_MESSAGE_PROBE_WORK_ROOT
    }
    if ([string]::IsNullOrWhiteSpace($value)) {
        $value = Join-Path $RepoRoot 'artifacts\tmp\kit-message-probe'
    }
    return [IO.Path]::GetFullPath($value)
}

function Assert-ProbePortAllowed {
    param(
        [Parameter(Mandatory = $true)][string] $Name,
        [Parameter(Mandatory = $true)][int] $Port
    )

    if ($Port -lt 1024 -or $Port -gt 65535) {
        throw "$Name must be between 1024 and 65535; got $Port."
    }
    if ($script:ProbeReservedPorts -contains $Port) {
        throw "$Name $Port is reserved by the canonical deployment or the isolated branch stack. Pick a port outside $($script:ProbeReservedPorts -join ', ')."
    }
}

function Get-ProbePortListener {
    param(
        [Parameter(Mandatory = $true)][int] $Port,
        [scriptblock] $ConnectionLookup = { param($p) Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue }
    )

    $listeners = @(& $ConnectionLookup $Port)
    if ($listeners.Count -eq 0) { return $null }
    return $listeners[0]
}

function Assert-ProbePortFree {
    param(
        [Parameter(Mandatory = $true)][string] $Name,
        [Parameter(Mandatory = $true)][int] $Port,
        [scriptblock] $ListenerLookup = { param($p) Get-ProbePortListener -Port $p }
    )

    $listener = & $ListenerLookup $Port
    if ($null -ne $listener) {
        # Fail closed: ownership of a foreign listener is unknown, so nothing is stopped.
        throw "$Name $Port is already listening (owning PID $($listener.OwningProcess)). Refusing to start; no process was stopped."
    }
}

function Get-ProbeKitPaths {
    param([Parameter(Mandatory = $true)][string] $RepoRoot)

    $releaseRoot = Join-Path $RepoRoot 'bim-streaming-server\_build\windows-x86_64\release'
    $paths = [pscustomobject]@{
        release_root = $releaseRoot
        kit_exe      = Join-Path $releaseRoot 'kit\kit.exe'
        app_kit      = Join-Path $releaseRoot 'apps\ezplus.bim_review_stream_streaming.kit'
        ext_source   = Join-Path $RepoRoot 'bim-streaming-server\source\extensions'
    }
    if (-not (Test-Path -LiteralPath $paths.kit_exe -PathType Leaf)) {
        throw "Kit build output is missing: $($paths.kit_exe). Build it first: .\bim-streaming-server\repo.bat build"
    }
    if (-not (Test-Path -LiteralPath $paths.app_kit -PathType Leaf)) {
        throw "Streaming app kit file is missing: $($paths.app_kit). Build it first: .\bim-streaming-server\repo.bat build"
    }
    if (-not (Test-Path -LiteralPath $paths.ext_source -PathType Container)) {
        throw "Extension source folder is missing: $($paths.ext_source)."
    }
    return $paths
}

function Get-ProbeKitLogTail {
    param(
        [Parameter(Mandatory = $true)][string] $LogPath,
        [int] $Lines = 8,
        [string] $Pattern = 'omni\.kit\.livestream\.(app|webrtc|core|messaging)'
    )

    if (-not (Test-Path -LiteralPath $LogPath -PathType Leaf)) { return @() }
    $matched = @(Select-String -LiteralPath $LogPath -Pattern $Pattern -ErrorAction SilentlyContinue |
        Select-Object -Last $Lines | ForEach-Object { [string]$_.Line })
    if ($matched.Count -gt 0) { return $matched }
    return @(Get-Content -LiteralPath $LogPath -Tail $Lines -ErrorAction SilentlyContinue | ForEach-Object { [string]$_ })
}

function Get-ProbeRunPaths {
    param([Parameter(Mandatory = $true)][string] $WorkRoot, [string] $PortableRoot)

    $resolvedPortable = if ([string]::IsNullOrWhiteSpace($PortableRoot)) {
        Join-Path $WorkRoot 'portable'
    } else {
        [IO.Path]::GetFullPath($PortableRoot)
    }
    return [pscustomobject]@{
        work_root     = $WorkRoot
        portable_root = $resolvedPortable
        log_path      = Join-Path $WorkRoot 'kit.log'
        error_path    = Join-Path $WorkRoot 'kit.log.err'
        pid_path      = Join-Path $WorkRoot 'kit.pid'
        manifest_path = Join-Path $WorkRoot 'run-manifest.json'
    }
}

function Get-ProbeOwnedKitProcess {
    param(
        [Parameter(Mandatory = $true)][int] $ProcessId,
        [Parameter(Mandatory = $true)][string] $ReleaseRoot
    )

    # Ownership proof before anything is stopped: the PID must still exist, still
    # be kit.exe, and still live under the build tree this script launched from.
    # A recycled PID therefore never gets killed.
    $process = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
    if ($null -eq $process) { return $null }
    if ([string]$process.ProcessName -ne 'kit') { return $null }
    $executablePath = [string]$process.Path
    if ([string]::IsNullOrWhiteSpace($executablePath)) { return $null }
    $rootFull = [IO.Path]::GetFullPath($ReleaseRoot).TrimEnd('\')
    if (-not ([IO.Path]::GetFullPath($executablePath)).StartsWith("$rootFull\", [StringComparison]::OrdinalIgnoreCase)) {
        return $null
    }
    return $process
}

function Read-ProbeRecordedPid {
    param([Parameter(Mandatory = $true)][string] $PidPath)

    if (-not (Test-Path -LiteralPath $PidPath -PathType Leaf)) { return 0 }
    $raw = ([string](Get-Content -LiteralPath $PidPath -Raw -ErrorAction SilentlyContinue)).Trim()
    if ($raw -notmatch '^\d+$') { return 0 }
    return [int]$raw
}

function Start-ProbeIsolatedKit {
    param(
        [Parameter(Mandatory = $true)] $Paths,
        [Parameter(Mandatory = $true)] $RunPaths,
        [Parameter(Mandatory = $true)][int] $SignalPort,
        [Parameter(Mandatory = $true)][int] $StreamPort,
        [Parameter(Mandatory = $true)][string] $InstanceId,
        [Parameter(Mandatory = $true)][string] $PublicIp,
        [Parameter(Mandatory = $true)][string] $AllowedStageHosts,
        [Parameter(Mandatory = $true)][int] $ReadyTimeoutSeconds,
        [bool] $KeepOnTimeout = $false
    )

    $existingPid = Read-ProbeRecordedPid -PidPath $RunPaths.pid_path
    if ($existingPid -gt 0 -and $null -ne (Get-ProbeOwnedKitProcess -ProcessId $existingPid -ReleaseRoot $Paths.release_root)) {
        throw "A probe Kit is already recorded as running (PID $existingPid, $($RunPaths.pid_path)). Run with -Action stop first."
    }

    New-Item -ItemType Directory -Force -Path $RunPaths.work_root | Out-Null
    New-Item -ItemType Directory -Force -Path $RunPaths.portable_root | Out-Null

    $kitArguments = @(
        $Paths.app_kit
        '--no-window'
        '--portable-root'; $RunPaths.portable_root
        '--reset-user'
        '--ext-folder'; $Paths.ext_source
        '--/exts/omni.kit.livestream.app/primaryStream/streamType=webrtc'
        "--/exts/omni.kit.livestream.app/primaryStream/signalPort=$SignalPort"
        "--/exts/omni.kit.livestream.app/primaryStream/streamPort=$StreamPort"
        "--/exts/omni.kit.livestream.app/primaryStream/publicIp=$PublicIp"
    )

    # Mutate the environment only for the duration of Start-Process, then put the
    # caller's shell back exactly as it was (including "was not set at all").
    $savedEnvironment = @{}
    foreach ($name in $script:ProbeClearedEnvironmentNames) {
        $savedEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
    }
    $savedStageHosts = [Environment]::GetEnvironmentVariable('BIM_REVIEW_STREAM_ALLOWED_STAGE_HOSTS', 'Process')
    $savedInstanceId = [Environment]::GetEnvironmentVariable('KIT_INSTANCE_ID', 'Process')

    try {
        foreach ($name in $script:ProbeClearedEnvironmentNames) {
            [Environment]::SetEnvironmentVariable($name, '', 'Process')
        }
        [Environment]::SetEnvironmentVariable('BIM_REVIEW_STREAM_ALLOWED_STAGE_HOSTS', $AllowedStageHosts, 'Process')
        # Informational for this run: with no coordinator and no Kit manager
        # attached, nothing reads it back. It is set and recorded so the manifest
        # names the instance the same way the real launcher does.
        [Environment]::SetEnvironmentVariable('KIT_INSTANCE_ID', $InstanceId, 'Process')

        Write-Verbose "starting kit.exe signalPort=$SignalPort streamPort=$StreamPort instance=$InstanceId"
        $kit = Start-Process -FilePath $Paths.kit_exe -ArgumentList $kitArguments -PassThru `
            -RedirectStandardOutput $RunPaths.log_path -RedirectStandardError $RunPaths.error_path `
            -WorkingDirectory $Paths.release_root
    } finally {
        foreach ($name in $script:ProbeClearedEnvironmentNames) {
            [Environment]::SetEnvironmentVariable($name, $savedEnvironment[$name], 'Process')
        }
        [Environment]::SetEnvironmentVariable('BIM_REVIEW_STREAM_ALLOWED_STAGE_HOSTS', $savedStageHosts, 'Process')
        [Environment]::SetEnvironmentVariable('KIT_INSTANCE_ID', $savedInstanceId, 'Process')
    }

    Set-Content -LiteralPath $RunPaths.pid_path -Value $kit.Id -Encoding ASCII

    # Bounded wait. Two exits: the signalling port starts listening, or the
    # deadline passes / the child dies. There is no unbounded branch.
    $deadline = (Get-Date).AddSeconds($ReadyTimeoutSeconds)
    $ready = $false
    $exitCode = $null
    while ((Get-Date) -lt $deadline) {
        if ($kit.HasExited) { $exitCode = [int]$kit.ExitCode; break }
        if ($null -ne (Get-ProbePortListener -Port $SignalPort)) { $ready = $true; break }
        Start-Sleep -Seconds 2
    }

    $logTail = Get-ProbeKitLogTail -LogPath $RunPaths.log_path
    if (-not $ready) {
        $reason = if ($null -ne $exitCode) {
            "kit.exe exited with code $exitCode before port $SignalPort started listening"
        } else {
            "kit.exe did not listen on port $SignalPort within $ReadyTimeoutSeconds seconds"
        }
        if (-not $KeepOnTimeout -and -not $kit.HasExited) {
            Write-Verbose "readiness failed; stopping PID $($kit.Id)"
            Stop-Process -Id $kit.Id -Force -ErrorAction SilentlyContinue
        }
        Remove-Item -LiteralPath $RunPaths.pid_path -Force -ErrorAction SilentlyContinue
        throw ("$reason. Log: $($RunPaths.log_path)" + [Environment]::NewLine + ($logTail -join [Environment]::NewLine))
    }

    $manifest = [ordered]@{
        schema_version    = 1
        started_at        = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
        kit_pid           = [int]$kit.Id
        kit_instance_id   = $InstanceId
        signal_port       = $SignalPort
        stream_port       = $StreamPort
        public_ip         = $PublicIp
        allowed_stage_hosts = $AllowedStageHosts
        release_root      = $Paths.release_root
        portable_root     = $RunPaths.portable_root
        log_path          = $RunPaths.log_path
        coordinator_attached = $false
    }
    Set-Content -LiteralPath $RunPaths.manifest_path -Value ($manifest | ConvertTo-Json -Depth 4) -Encoding UTF8

    return [pscustomobject]@{
        action          = 'start'
        status          = 'ready'
        kit_pid         = [int]$kit.Id
        kit_instance_id = $InstanceId
        signal_port     = $SignalPort
        stream_port     = $StreamPort
        work_root       = $RunPaths.work_root
        log_path        = $RunPaths.log_path
        manifest_path   = $RunPaths.manifest_path
        log_tail        = $logTail
    }
}

function Stop-ProbeIsolatedKit {
    param(
        [Parameter(Mandatory = $true)] $Paths,
        [Parameter(Mandatory = $true)] $RunPaths
    )

    $recordedPid = Read-ProbeRecordedPid -PidPath $RunPaths.pid_path
    if ($recordedPid -le 0) {
        return [pscustomobject]@{ action = 'stop'; status = 'not_recorded'; kit_pid = 0; work_root = $RunPaths.work_root }
    }

    $process = Get-ProbeOwnedKitProcess -ProcessId $recordedPid -ReleaseRoot $Paths.release_root
    if ($null -eq $process) {
        Remove-Item -LiteralPath $RunPaths.pid_path -Force -ErrorAction SilentlyContinue
        return [pscustomobject]@{ action = 'stop'; status = 'stale_pid_cleared'; kit_pid = $recordedPid; work_root = $RunPaths.work_root }
    }

    Write-Verbose "stopping owned kit.exe PID $recordedPid"
    Stop-Process -Id $recordedPid -Force
    $process.WaitForExit(30000) | Out-Null
    Remove-Item -LiteralPath $RunPaths.pid_path -Force -ErrorAction SilentlyContinue
    return [pscustomobject]@{ action = 'stop'; status = 'stopped'; kit_pid = $recordedPid; work_root = $RunPaths.work_root }
}

function Get-ProbeIsolatedKitStatus {
    param(
        [Parameter(Mandatory = $true)] $Paths,
        [Parameter(Mandatory = $true)] $RunPaths,
        [Parameter(Mandatory = $true)][int] $SignalPort
    )

    $recordedPid = Read-ProbeRecordedPid -PidPath $RunPaths.pid_path
    $process = if ($recordedPid -gt 0) { Get-ProbeOwnedKitProcess -ProcessId $recordedPid -ReleaseRoot $Paths.release_root } else { $null }
    $listener = Get-ProbePortListener -Port $SignalPort
    $status = if ($null -ne $process -and $null -ne $listener) { 'ready' }
        elseif ($null -ne $process) { 'running_not_listening' }
        elseif ($null -ne $listener) { 'foreign_listener' }
        else { 'stopped' }

    return [pscustomobject]@{
        action              = 'status'
        status              = $status
        kit_pid             = $recordedPid
        owned               = ($null -ne $process)
        signal_port         = $SignalPort
        signal_port_listening = ($null -ne $listener)
        work_root           = $RunPaths.work_root
        log_path            = $RunPaths.log_path
        log_tail            = (Get-ProbeKitLogTail -LogPath $RunPaths.log_path)
    }
}

function Invoke-IsolatedKitProbeCli {
    param(
        [ValidateSet('start', 'stop', 'status')][string] $Action,
        [int] $SignalPort,
        [int] $StreamPort,
        [string] $InstanceId,
        [string] $PublicIp,
        [string] $PortableRoot,
        [string] $WorkRoot,
        [string] $AllowedStageHosts,
        [int] $ReadyTimeoutSeconds,
        [bool] $KeepOnTimeout,
        [string] $RepoRoot
    )

    if ([string]::IsNullOrWhiteSpace($InstanceId) -or $InstanceId -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$') {
        throw 'InstanceId must be 1..64 characters of A-Z, a-z, 0-9, dot, underscore or dash.'
    }
    if ($ReadyTimeoutSeconds -lt 10 -or $ReadyTimeoutSeconds -gt 1800) {
        throw "ReadyTimeoutSeconds must be between 10 and 1800; got $ReadyTimeoutSeconds."
    }
    Assert-ProbePortAllowed -Name 'SignalPort' -Port $SignalPort
    Assert-ProbePortAllowed -Name 'StreamPort' -Port $StreamPort
    if ($SignalPort -eq $StreamPort) { throw 'SignalPort and StreamPort must differ.' }

    $resolvedRepoRoot = Resolve-ProbeRepoRoot -Requested $RepoRoot
    $paths = Get-ProbeKitPaths -RepoRoot $resolvedRepoRoot
    $resolvedWorkRoot = Resolve-ProbeWorkRoot -RepoRoot $resolvedRepoRoot -Requested $WorkRoot
    $runPaths = Get-ProbeRunPaths -WorkRoot $resolvedWorkRoot -PortableRoot $PortableRoot

    switch ($Action) {
        'status' { return Get-ProbeIsolatedKitStatus -Paths $paths -RunPaths $runPaths -SignalPort $SignalPort }
        'stop'   { return Stop-ProbeIsolatedKit -Paths $paths -RunPaths $runPaths }
        default {
            Assert-ProbePortFree -Name 'SignalPort' -Port $SignalPort
            Assert-ProbePortFree -Name 'StreamPort' -Port $StreamPort
            return Start-ProbeIsolatedKit -Paths $paths -RunPaths $runPaths `
                -SignalPort $SignalPort -StreamPort $StreamPort -InstanceId $InstanceId -PublicIp $PublicIp `
                -AllowedStageHosts $AllowedStageHosts -ReadyTimeoutSeconds $ReadyTimeoutSeconds -KeepOnTimeout $KeepOnTimeout
        }
    }
}

if ($MyInvocation.InvocationName -ne '.') {
    Invoke-IsolatedKitProbeCli -Action $Action -SignalPort $SignalPort -StreamPort $StreamPort `
        -InstanceId $InstanceId -PublicIp $PublicIp -PortableRoot $PortableRoot -WorkRoot $WorkRoot `
        -AllowedStageHosts $AllowedStageHosts -ReadyTimeoutSeconds $ReadyTimeoutSeconds `
        -KeepOnTimeout ([bool]$KeepOnTimeout) -RepoRoot $CliRepoRoot
}
