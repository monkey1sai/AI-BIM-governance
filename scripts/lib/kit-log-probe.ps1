# scripts\lib\kit-log-probe.ps1
# Kit readiness probe:沒 /health endpoint,以 LISTEN(:49100) + log keyword 判定。

Set-StrictMode -Version Latest

$script:KitReadyKeywords = @(
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

function Wait-KitReady {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string] $LogPath,
        [int] $SignalPort = 49100,
        [int] $TimeoutSec = 90,
        [scriptblock] $PortListenProbe = {
            param($port)
            $null -ne (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1)
        }
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    while ((Get-Date) -lt $deadline) {
        $listen = & $PortListenProbe $SignalPort
        $logRes = Test-KitReadyFromLog -LogPath $LogPath
        if ($listen -and $logRes.ready) {
            return [pscustomobject]@{
                ready = $true
                listenPort = $SignalPort
                matchedKeyword = $logRes.matchedKeyword
            }
        }
        Start-Sleep -Milliseconds 500
    }
    $finalLog = Test-KitReadyFromLog -LogPath $LogPath
    $finalListen = & $PortListenProbe $SignalPort
    return [pscustomobject]@{
        ready = $false
        listenPort = if ($finalListen) { $SignalPort } else { $null }
        matchedKeyword = $finalLog.matchedKeyword
    }
}
