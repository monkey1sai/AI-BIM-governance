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

Write-Host "`n=== test-kit-log-probe.ps1: ALL PASSED ===" -ForegroundColor Green
