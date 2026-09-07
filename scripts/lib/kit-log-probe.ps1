# scripts\lib\kit-log-probe.ps1
# Kit readiness probe:沒 /health endpoint,以 LISTEN(:49100) + log keyword 判定。

Set-StrictMode -Version Latest

# Per-OS listener primitives. Guarded so this lib stays dot-sourceable standalone.
if (-not (Get-Command -Name 'Get-PlatformTcpListenerPid' -ErrorAction SilentlyContinue)) {
    . (Join-Path $PSScriptRoot 'platform/platform-adapter.ps1')
}

$script:KitReadyKeywords = @(
    'app ready',
    'Application started',
    'launching Linux Kit',
    'Streaming started'
)

function Test-KitReadyFromLog {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string] $LogPath)

    if (-not (Test-Path -LiteralPath $LogPath)) {
        return [pscustomobject]@{ ready = $false; matchedKeyword = $null }
    }
    $content = Get-Content -LiteralPath $LogPath -Raw -ErrorAction SilentlyContinue
    if ([string]::IsNullOrWhiteSpace($content)) {
        return [pscustomobject]@{ ready = $false; matchedKeyword = $null }
    }
    foreach ($kw in $script:KitReadyKeywords) {
        if ($content -match [regex]::Escape($kw)) {
            return [pscustomobject]@{ ready = $true; matchedKeyword = $kw }
        }
    }
    return [pscustomobject]@{ ready = $false; matchedKeyword = $null }
}

function Get-KitLogFilePathFromLauncherLog {
    # Kit announces its own log file on stdout ("[carb] Logging to file: <path>"),
    # which the launcher captures into scripts/.run/bim-streaming-server.log.
    # That file is where the livestream plugins write; stdout only carries
    # extension startup lines and 'app ready'. Returns $null until Kit has
    # printed the line. The LAST occurrence wins so a launcher log that was
    # appended across restarts still points at the current process.
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string] $LauncherLogPath)

    if (-not (Test-Path -LiteralPath $LauncherLogPath -PathType Leaf)) { return $null }
    $lines = @(Get-Content -LiteralPath $LauncherLogPath -ErrorAction SilentlyContinue)
    for ($i = $lines.Count - 1; $i -ge 0; $i--) {
        if ($lines[$i] -match 'Logging to file:\s*(.+?)\s*$') {
            return [string]$Matches[1]
        }
    }
    return $null
}

$script:KitMediaServerStartedPattern = 'Started primary stream server on signal port (\d+) and stream port (\d+)'

function Test-KitMediaServerStarted {
    # Did omni.kit.livestream.app bring the PRIMARY stream server up on the port
    # this deploy configured? 'app ready' is emitted by the app plugin before the
    # livestream server exists, so it never proved the media side. This reads
    # the Kit file log (see Get-KitLogFilePathFromLauncherLog).
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string] $KitLogPath,
        [int] $SignalPort = 49100,
        # 0 = do not check the media (UDP) port. When the deploy knows the port it
        # configured, pass it: a primary server on the right signalling port but
        # the wrong stream port means the media setting was not applied, and the
        # coordinator would hand viewers an endpoint that never carries video.
        [int] $StreamPort = 0
    )
    if (-not (Test-Path -LiteralPath $KitLogPath -PathType Leaf)) {
        return [pscustomobject]@{ started = $false; signalPort = $null; streamPort = $null; reason = 'kit_log_missing' }
    }
    $content = Get-Content -LiteralPath $KitLogPath -Raw -ErrorAction SilentlyContinue
    if ([string]::IsNullOrWhiteSpace($content)) {
        return [pscustomobject]@{ started = $false; signalPort = $null; streamPort = $null; reason = 'kit_log_empty' }
    }
    $found = [regex]::Matches($content, $script:KitMediaServerStartedPattern)
    foreach ($m in $found) {
        if ([int]$m.Groups[1].Value -ne $SignalPort) { continue }
        $loggedStreamPort = [int]$m.Groups[2].Value
        if ($StreamPort -gt 0 -and $loggedStreamPort -ne $StreamPort) {
            return [pscustomobject]@{ started = $false; signalPort = $SignalPort; streamPort = $loggedStreamPort; reason = 'primary_stream_server_on_other_stream_port' }
        }
        return [pscustomobject]@{ started = $true; signalPort = $SignalPort; streamPort = $loggedStreamPort; reason = $null }
    }
    if ($found.Count -gt 0) {
        return [pscustomobject]@{ started = $false; signalPort = [int]$found[0].Groups[1].Value; streamPort = [int]$found[0].Groups[2].Value; reason = 'primary_stream_server_on_other_port' }
    }
    return [pscustomobject]@{ started = $false; signalPort = $null; streamPort = $null; reason = 'primary_stream_server_not_logged' }
}

function Wait-KitReady {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string] $LogPath,
        [int] $SignalPort = 49100,
        [int] $TimeoutSec = 90,
        [scriptblock] $PortListenProbe = {
            param($port)
            # Get-NetTCPConnection is Windows-only. On Linux it produced no result,
            # so this probe answered "not listening" forever: attempt 11 timed out
            # with listen=False even though Kit had logged 'app ready' and ss showed
            # the signalling port in LISTEN.
            Test-PlatformTcpListening -Port ([int]$port)
        },
        # Media-side readiness (#768): also require the livestream primary stream
        # server to have started on $SignalPort, read from the Kit file log that
        # the launcher log names. Without this switch behaviour is unchanged.
        [switch] $RequireMediaServer,
        # Media (UDP) port the deploy configured; 0 = not checked.
        [int] $StreamPort = 0,
        [scriptblock] $KitLogPathResolver = {
            param($launcherLogPath)
            Get-KitLogFilePathFromLauncherLog -LauncherLogPath $launcherLogPath
        },
        [scriptblock] $MediaServerProbe = {
            param($kitLogPath, $port, $streamPort)
            Test-KitMediaServerStarted -KitLogPath $kitLogPath -SignalPort ([int]$port) -StreamPort ([int]$streamPort)
        }
    )

    $observe = {
        $listen = & $PortListenProbe $SignalPort
        $logRes = Test-KitReadyFromLog -LogPath $LogPath
        $kitLogPath = $null
        $media = $null
        if ($RequireMediaServer) {
            $kitLogPath = & $KitLogPathResolver $LogPath
            if ($kitLogPath) { $media = & $MediaServerProbe $kitLogPath $SignalPort $StreamPort }
        }
        $mediaOk = (-not $RequireMediaServer) -or ($null -ne $media -and [bool]$media.started)
        [pscustomobject]@{
            ready = [bool]($listen -and $logRes.ready -and $mediaOk)
            listenPort = if ($listen) { $SignalPort } else { $null }
            matchedKeyword = $logRes.matchedKeyword
            kitLogPath = $kitLogPath
            mediaServerStarted = if ($null -eq $media) { $null } else { [bool]$media.started }
            mediaServerReason = if ($null -eq $media) { if ($RequireMediaServer) { 'kit_log_path_unknown' } else { $null } } else { $media.reason }
        }
    }

    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    while ((Get-Date) -lt $deadline) {
        $state = & $observe
        if ($state.ready) { return $state }
        Start-Sleep -Milliseconds 500
    }
    return (& $observe)
}
