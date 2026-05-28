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

# Test 7: background launcher 不使用 -NoExit,避免 wrapper process 偽裝成服務仍活著
$moduleContent = Get-Content -LiteralPath $modulePath -Raw
Assert-True (-not ($moduleContent -match "'-NoExit'")) 'launcher argument list has no -NoExit'
Write-TestPass 'no -NoExit launcher arg'

# Test 8: Kit launcher wiring preserves spectator stream args
Assert-True ($moduleContent -match "'-SpectatorSignalPorts'") 'launcher forwards spectator signal ports'
Assert-True ($moduleContent -match "'-SpectatorStreamPorts'") 'launcher forwards spectator stream ports'
Write-TestPass 'spectator stream args forwarded'

# Test 9: conversion launcher clears stale public artifacts URL when no URL is provided
Assert-True ($moduleContent -match 'Remove-Item Env:STREAMING_CONVERSION_PUBLIC_ARTIFACTS_URL') 'launcher clears stale public artifacts URL'
Write-TestPass 'public artifacts URL env cleared when unset'

# Test 10: conversion launcher routes through repo .venv Python and disables user-site packages
Assert-True ($moduleContent -match "\.venv\\Scripts\\python\.exe") 'conversion launcher resolves repo venv Python'
Assert-True ($moduleContent -match "'-PythonExe'") 'conversion launcher passes -PythonExe to child script'
Assert-True ($moduleContent -match 'PYTHONNOUSERSITE') 'conversion launcher disables user-site packages'
Write-TestPass 'conversion launcher uses isolated repo Python'

# Test 11: Stop-HostNativeService stops child processes before wrapper PID
$sb = New-TestSandbox -Prefix 'hn-launcher-stop'
try {
    $runDir = Join-Path $sb 'scripts\.run'
    New-Item -ItemType Directory -Path $runDir -Force | Out-Null
    Set-Content -LiteralPath (Join-Path $runDir 'svc.pid') -Value '100'
    $stopped = @()
    $didStop = Stop-HostNativeService -Name 'svc' -RunDir $runDir `
        -ChildPidLookup {
            param($procId)
            if ($procId -eq 100) { @(101) }
            elseif ($procId -eq 101) { @(102) }
            else { @() }
        } `
        -StopProcessFn {
            param($procId)
            $script:stopped += $procId
        }
    Assert-True ($didStop -eq $true) 'service tree stop returns true'
    Assert-Equal '102,101,100' ($stopped -join ',') 'children stopped before wrapper'
    Assert-True (-not (Test-Path -LiteralPath (Join-Path $runDir 'svc.pid'))) 'pid file removed'
    Write-TestPass 'Stop-HostNativeService process tree'
}
finally { Remove-TestSandbox -Path $sb }

# Test 12: spectator stream settings receive the same publicIp override
$streamingScript = Join-Path $repoRoot 'bim-streaming-server\scripts\start-streaming-server.ps1'
$streamingContent = Get-Content -LiteralPath $streamingScript -Raw
Assert-True ($streamingContent -match 'spectatorStream/\$\(\$endpoint\.Index\)/publicIp') 'spectator publicIp setting exists'
Write-TestPass 'spectator publicIp setting forwarded'

Write-Host "`n=== test-host-native-launcher.ps1: ALL PASSED ===" -ForegroundColor Green
