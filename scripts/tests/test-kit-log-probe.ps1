# scripts\tests\test-kit-log-probe.ps1
. (Join-Path $PSScriptRoot 'test-helpers.ps1')

$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$modulePath = Join-Path $repoRoot 'scripts\lib\kit-log-probe.ps1'
. $modulePath

# Test 1: log 出現 'Application started' → ready=true
$sb = New-TestSandbox -Prefix 'kit-log-probe'
try {
    $logFile = Join-Path $sb 'kit.log'
    Set-Content -LiteralPath $logFile -Value "boot...`n  loading...`n  Application started`n"
    $r = Test-KitReadyFromLog -LogPath $logFile
    Assert-True $r.ready 'Application started → ready'
    Assert-Equal 'Application started' $r.matchedKeyword 'matched keyword'
    Write-TestPass 'Application started detected'
}
finally { Remove-TestSandbox -Path $sb }

# Test 2: log 只有 'launching Linux Kit' → ready=true(關鍵字 OR)
$sb = New-TestSandbox -Prefix 'kit-log-probe'
try {
    $logFile = Join-Path $sb 'kit.log'
    Set-Content -LiteralPath $logFile -Value "launching Linux Kit streaming app"
    $r = Test-KitReadyFromLog -LogPath $logFile
    Assert-True $r.ready 'launching Linux Kit → ready'
    Write-TestPass 'launching Linux Kit detected'
}
finally { Remove-TestSandbox -Path $sb }

# Test 3: log 出現 'Streaming started'
$sb = New-TestSandbox -Prefix 'kit-log-probe'
try {
    $logFile = Join-Path $sb 'kit.log'
    Set-Content -LiteralPath $logFile -Value "Streaming started on port 49100"
    $r = Test-KitReadyFromLog -LogPath $logFile
    Assert-True $r.ready 'Streaming started → ready'
    Write-TestPass 'Streaming started detected'
}
finally { Remove-TestSandbox -Path $sb }

# Test 4: log 空 → ready=false
$sb = New-TestSandbox -Prefix 'kit-log-probe'
try {
    $logFile = Join-Path $sb 'kit.log'
    Set-Content -LiteralPath $logFile -Value ""
    $r = Test-KitReadyFromLog -LogPath $logFile
    Assert-True (-not $r.ready) 'empty → not ready'
    Write-TestPass 'empty log → not ready'
}
finally { Remove-TestSandbox -Path $sb }

# Test 5: log 不存在 → ready=false
$r = Test-KitReadyFromLog -LogPath 'C:\nonexistent\kit.log'
Assert-True (-not $r.ready) 'missing log → not ready'
Write-TestPass 'missing log handled'

# Test 6: Wait-KitReady poll loop:log 出現 + port listen → ready=true
$sb = New-TestSandbox -Prefix 'kit-log-probe'
try {
    $logFile = Join-Path $sb 'kit.log'
    Set-Content -LiteralPath $logFile -Value 'Application started'
    $r = Wait-KitReady -LogPath $logFile -SignalPort 49100 -TimeoutSec 1 `
        -PortListenProbe { param($p) $true }
    Assert-True $r.ready 'ready when log+port both ok'
    Write-TestPass 'Wait-KitReady positive'
}
finally { Remove-TestSandbox -Path $sb }

# Test 7: Wait-KitReady — port 未 listen → ready=false(timeout)
$sb = New-TestSandbox -Prefix 'kit-log-probe'
try {
    $logFile = Join-Path $sb 'kit.log'
    Set-Content -LiteralPath $logFile -Value 'Application started'
    $r = Wait-KitReady -LogPath $logFile -SignalPort 49100 -TimeoutSec 1 `
        -PortListenProbe { param($p) $false }
    Assert-True (-not $r.ready) 'not ready when port not listen'
    Write-TestPass 'Wait-KitReady port-not-listen'
}
finally { Remove-TestSandbox -Path $sb }

# --- #768 media-aware readiness ---------------------------------------------
# 假活 Kit（deploy 在前一顆 SIGKILL 後 0.7s 即啟動）會通過 LISTEN + 'app ready'，
# 但 livestream 的 primary stream server 只寫在 Kit 檔案 log；launcher stdout 只有
# 'Logging to file: <path>' 指向它。以下驗證路徑解析、關鍵字判定與 -RequireMediaServer。

# Test 8: launcher log 指出 Kit 檔案 log 路徑（取最後一次出現）
$sb = New-TestSandbox -Prefix 'kit-log-probe'
try {
    $launcherLog = Join-Path $sb 'bim-streaming-server.log'
    Set-Content -LiteralPath $launcherLog -Value @(
        '[streaming] starting Kit. Press Ctrl+C to stop.',
        '2026-09-07T06:14:36Z [Info] [carb] Logging to file: /home/x/.nvidia-omniverse/logs/Kit/BIM Review Stream Streaming/0.1/kit_20260907_141436.log',
        '[0.088s] [ext: omni.activity.core-1.0.3] startup',
        '2026-09-07T09:47:50Z [Info] [carb] Logging to file: /home/x/.nvidia-omniverse/logs/Kit/BIM Review Stream Streaming/0.1/kit_20260907_174750.log',
        'Active user not found. Using default user [kiosk][2.825s] app ready'
    )
    $p = Get-KitLogFilePathFromLauncherLog -LauncherLogPath $launcherLog
    Assert-Equal '/home/x/.nvidia-omniverse/logs/Kit/BIM Review Stream Streaming/0.1/kit_20260907_174750.log' $p 'last Logging-to-file line wins'
    Assert-True ($null -eq (Get-KitLogFilePathFromLauncherLog -LauncherLogPath (Join-Path $sb 'absent.log'))) 'missing launcher log → null'
    Set-Content -LiteralPath $launcherLog -Value '[0.088s] [ext: omni.activity.core-1.0.3] startup'
    Assert-True ($null -eq (Get-KitLogFilePathFromLauncherLog -LauncherLogPath $launcherLog)) 'no Logging-to-file line yet → null'
    Write-TestPass 'Kit file log path parsed from launcher stdout (#768)'
}
finally { Remove-TestSandbox -Path $sb }

# Test 9: primary stream server 關鍵字：同 port → started；他 port／缺席／空檔 → 各自誠實原因
$sb = New-TestSandbox -Prefix 'kit-log-probe'
try {
    $kitLog = Join-Path $sb 'kit.log'
    Set-Content -LiteralPath $kitLog -Value @(
        '2026-09-07T09:47:53Z [2,201ms] [Info] [omni.kit.livestream.app.plugin] Started primary stream server on signal port 49100 and stream port 47998',
        '2026-09-07T09:47:53Z [2,204ms] [Info] [omni.kit.livestream.app.plugin] Started spectator stream server for index 0 with signal port 49110 and stream port 48008'
    )
    $r = Test-KitMediaServerStarted -KitLogPath $kitLog -SignalPort 49100
    Assert-True $r.started 'primary stream server on the configured port → started'
    Assert-Equal 47998 $r.streamPort 'stream port parsed'
    $r2 = Test-KitMediaServerStarted -KitLogPath $kitLog -SignalPort 49200
    Assert-True (-not $r2.started) 'primary stream server on another port → not started'
    Assert-Equal 'primary_stream_server_on_other_port' $r2.reason 'other-port reason'
    # 指定 media port：signalling 對、stream port 不對 → 媒體設定沒套上，不算 ready
    $r2b = Test-KitMediaServerStarted -KitLogPath $kitLog -SignalPort 49100 -StreamPort 48998
    Assert-True (-not $r2b.started) 'configured stream port mismatch → not started'
    Assert-Equal 'primary_stream_server_on_other_stream_port' $r2b.reason 'stream-port mismatch reason'
    Assert-Equal 47998 $r2b.streamPort 'logged stream port surfaced'
    Assert-True (Test-KitMediaServerStarted -KitLogPath $kitLog -SignalPort 49100 -StreamPort 47998).started 'matching stream port → started'
    Set-Content -LiteralPath $kitLog -Value '[2,590ms] [Info] [omni.kit.app.plugin] [2.615s] app ready'
    $r3 = Test-KitMediaServerStarted -KitLogPath $kitLog -SignalPort 49100
    Assert-Equal 'primary_stream_server_not_logged' $r3.reason 'app ready alone is not media readiness'
    Set-Content -LiteralPath $kitLog -Value ''
    Assert-Equal 'kit_log_empty' (Test-KitMediaServerStarted -KitLogPath $kitLog -SignalPort 49100).reason 'empty kit log reason'
    Assert-Equal 'kit_log_missing' (Test-KitMediaServerStarted -KitLogPath (Join-Path $sb 'nope.log') -SignalPort 49100).reason 'missing kit log reason'
    Write-TestPass 'primary stream server keyword is port-exact and fail-closed (#768)'
}
finally { Remove-TestSandbox -Path $sb }

# Test 10: Wait-KitReady -RequireMediaServer：LISTEN + app ready 但媒體層未起 → 不 ready；起了 → ready
$sb = New-TestSandbox -Prefix 'kit-log-probe'
try {
    $launcherLog = Join-Path $sb 'bim-streaming-server.log'
    $kitLog = Join-Path $sb 'kit.log'
    Set-Content -LiteralPath $launcherLog -Value @("[carb] Logging to file: $kitLog", 'app ready')
    Set-Content -LiteralPath $kitLog -Value 'app ready'
    $r = Wait-KitReady -LogPath $launcherLog -SignalPort 49100 -TimeoutSec 1 -RequireMediaServer -PortListenProbe { param($p) $true }
    Assert-True (-not $r.ready) 'LISTEN + app ready without primary stream server → not ready'
    Assert-Equal $kitLog $r.kitLogPath 'kit log path surfaced for diagnostics'
    Assert-Equal 'primary_stream_server_not_logged' $r.mediaServerReason 'media reason surfaced'
    Add-Content -LiteralPath $kitLog -Value 'Started primary stream server on signal port 49100 and stream port 47998'
    $r2 = Wait-KitReady -LogPath $launcherLog -SignalPort 49100 -TimeoutSec 1 -RequireMediaServer -PortListenProbe { param($p) $true }
    Assert-True $r2.ready 'ready once the primary stream server line appears'
    Assert-True ($r2.mediaServerStarted -eq $true) 'mediaServerStarted reported'
    # 沒有 -RequireMediaServer 時行為不變（舊 gate）
    Set-Content -LiteralPath $kitLog -Value 'app ready'
    $r3 = Wait-KitReady -LogPath $launcherLog -SignalPort 49100 -TimeoutSec 1 -PortListenProbe { param($p) $true }
    Assert-True $r3.ready 'legacy gate unchanged without the switch'
    Assert-True ($null -eq $r3.mediaServerStarted) 'legacy gate does not claim media evidence'
    # launcher log 還沒印出路徑 → 誠實 kit_log_path_unknown
    Set-Content -LiteralPath $launcherLog -Value 'app ready'
    $r4 = Wait-KitReady -LogPath $launcherLog -SignalPort 49100 -TimeoutSec 1 -RequireMediaServer -PortListenProbe { param($p) $true }
    Assert-True (-not $r4.ready) 'unknown kit log path → not ready'
    Assert-Equal 'kit_log_path_unknown' $r4.mediaServerReason 'unknown path reason'
    Write-TestPass 'Wait-KitReady -RequireMediaServer gates on the media layer (#768)'
}
finally { Remove-TestSandbox -Path $sb }

Write-Host "`n=== test-kit-log-probe.ps1: ALL PASSED ===" -ForegroundColor Green
