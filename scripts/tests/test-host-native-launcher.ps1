# scripts\tests\test-host-native-launcher.ps1
. (Join-Path $PSScriptRoot 'test-helpers.ps1')

$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$modulePath = Join-Path $repoRoot 'scripts\lib\host-native-launcher.ps1'
. $modulePath

# Test 1: Test-AlreadyRunning — PID file 不存在 → false
$sb = New-TestSandbox -Prefix 'hn-launcher'
try {
    $runDir = Join-Path $sb 'scripts\.run'
    New-Item -ItemType Directory -Path $runDir -Force | Out-Null
    Assert-True (-not (Test-AlreadyRunning -Name 'foo' -RunDir $runDir)) 'no PID file → false'
    Write-TestPass 'no PID file → not running'
}
finally { Remove-TestSandbox -Path $sb }

# Test 2: PID file 內 PID 對應的 process 不存在 → false(stale PID 應被偵測)
$sb = New-TestSandbox -Prefix 'hn-launcher'
try {
    $runDir = Join-Path $sb 'scripts\.run'
    New-Item -ItemType Directory -Path $runDir -Force | Out-Null
    Set-Content -LiteralPath (Join-Path $runDir 'foo.pid') -Value '999999'
    Assert-True (-not (Test-AlreadyRunning -Name 'foo' -RunDir $runDir `
        -GetProcessFn { param($procId) $null })) 'stale PID → false'
    Write-TestPass 'stale PID flagged'
}
finally { Remove-TestSandbox -Path $sb }

# Test 3: PID file 內 PID 對應 process 存在 → true
$sb = New-TestSandbox -Prefix 'hn-launcher'
try {
    $runDir = Join-Path $sb 'scripts\.run'
    New-Item -ItemType Directory -Path $runDir -Force | Out-Null
    Set-Content -LiteralPath (Join-Path $runDir 'foo.pid') -Value '12345'
    Assert-True (Test-AlreadyRunning -Name 'foo' -RunDir $runDir `
        -GetProcessFn { param($procId) @{ Id = $procId } }) 'live PID → true'
    Write-TestPass 'live PID detected'
}
finally { Remove-TestSandbox -Path $sb }

# Test 4: Wait-HostNativeHealth 對 fake successful HTTP probe 返回 true
$ok = Wait-HostNativeHealth -Name 'fake' -Url 'http://invalid.example' -TimeoutSec 1 `
    -ProbeFn { @{ StatusCode = 200 } }
Assert-True ($ok -eq $true) 'fake 200 → ok'
Write-TestPass 'Wait-HostNativeHealth 200 → ok'

# Test 5: Wait-HostNativeHealth 對 timeout 返回 false
$fail = Wait-HostNativeHealth -Name 'fake' -Url 'http://invalid.example' -TimeoutSec 1 `
    -ProbeFn { throw 'connection refused' }
Assert-True ($fail -eq $false) 'timeout → false'
Write-TestPass 'Wait-HostNativeHealth timeout → false'

# Test 6: Resolve-ConversionParentRoot — 算反向對齊路徑
$parent = Resolve-ConversionParentRoot -RuntimeStorageRoot 'C:\repo\storage'
Assert-Equal 'C:\repo' $parent 'parent of C:\repo\storage = C:\repo'
Write-TestPass 'Resolve-ConversionParentRoot'

Write-Host "`n=== test-host-native-launcher.ps1: ALL PASSED ===" -ForegroundColor Green
