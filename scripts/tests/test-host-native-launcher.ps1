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

# Host-native Kit Manager must never inherit its container defaults. The parent
# deployment process environment is restored after Start-Process snapshots it.
foreach ($expectedKitManagerSetting in @(
    "RUNTIME_MODE = 'hybrid-web-plane-host-native-kit'",
    "HOST_LOCAL_RUNTIME_ALLOWED = 'true'",
    "KIT_INSTANCE_ID = 'kit_local_001'",
    "KIT_CONTROL_URL = 'http://127.0.0.1:49101'"
)) {
    Assert-True ($moduleContent.Contains($expectedKitManagerSetting)) "Kit Manager child env includes $expectedKitManagerSetting"
}
Assert-True ($moduleContent -match 'finally\s*\{\s*foreach \(\$name in \$kitManagerEnvironment\.Keys\)') 'Kit Manager child env is restored in finally'
Write-TestPass 'host-native Kit Manager receives exact child authority identity'

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

# Test 13: Invoke-KitRepoBuild returns success + removes pid file when process exits in time
$sb = New-TestSandbox -Prefix 'kit-repo-build'
try {
    $runDir = Join-Path $sb 'scripts\.run'
    New-Item -ItemType Directory -Path $runDir -Force | Out-Null
    $logPath = Join-Path $runDir 'kit-repo-build.log'
    $result = Invoke-KitRepoBuild -WorkingDirectory $sb -LogPath $logPath -RunDir $runDir `
        -StartProcessFn { param($workingDirectory, $logPath) [pscustomobject]@{ Id = 4242; ExitCode = 0 } } `
        -WaitForExitFn { param($proc, $timeoutMs) $true } `
        -StopTreeFn { param($name, $runDir) throw 'StopTreeFn must not run on success' }
    Assert-True ($result.TimedOut -eq $false) 'success path is not TimedOut'
    Assert-Equal 0 $result.ExitCode 'success path forwards process ExitCode'
    Assert-True (-not (Test-Path -LiteralPath (Join-Path $runDir 'kit-repo-build.pid'))) 'pid file removed on success'
    Write-TestPass 'Invoke-KitRepoBuild success path'
}
finally { Remove-TestSandbox -Path $sb }

# Test 14: Invoke-KitRepoBuild forwards a non-zero exit code without treating it as a timeout
$sb = New-TestSandbox -Prefix 'kit-repo-build'
try {
    $runDir = Join-Path $sb 'scripts\.run'
    New-Item -ItemType Directory -Path $runDir -Force | Out-Null
    $logPath = Join-Path $runDir 'kit-repo-build.log'
    $result = Invoke-KitRepoBuild -WorkingDirectory $sb -LogPath $logPath -RunDir $runDir `
        -StartProcessFn { param($workingDirectory, $logPath) [pscustomobject]@{ Id = 4243; ExitCode = 1 } } `
        -WaitForExitFn { param($proc, $timeoutMs) $true } `
        -StopTreeFn { param($name, $runDir) throw 'StopTreeFn must not run when process merely fails' }
    Assert-True ($result.TimedOut -eq $false) 'failed-but-exited path is not TimedOut'
    Assert-Equal 1 $result.ExitCode 'failed path forwards non-zero ExitCode'
    Write-TestPass 'Invoke-KitRepoBuild non-zero exit path'
}
finally { Remove-TestSandbox -Path $sb }

# Test 15: Invoke-KitRepoBuild kills the process tree and reports TimedOut when WaitForExit never returns true
# (regression guard for 2026-07-01 repo.bat build 卡死:build 早已成功但外層永久
# 等 stream EOF — 這裡驗證逾時會呼叫 StopTreeFn 砍程序,而不是無限期掛住)
$sb = New-TestSandbox -Prefix 'kit-repo-build'
try {
    $runDir = Join-Path $sb 'scripts\.run'
    New-Item -ItemType Directory -Path $runDir -Force | Out-Null
    $logPath = Join-Path $runDir 'kit-repo-build.log'
    $stoppedArgs = $null
    $result = Invoke-KitRepoBuild -WorkingDirectory $sb -LogPath $logPath -RunDir $runDir -TimeoutSec 1 `
        -StartProcessFn { param($workingDirectory, $logPath) [pscustomobject]@{ Id = 4244; ExitCode = 0 } } `
        -WaitForExitFn { param($proc, $timeoutMs) $false } `
        -StopTreeFn { param($name, $runDir) $script:stoppedArgs = @($name, $runDir) }
    Assert-True ($result.TimedOut -eq $true) 'hung process is reported as TimedOut'
    Assert-Equal (-1) $result.ExitCode 'timeout path reports sentinel ExitCode -1'
    Assert-Equal 'kit-repo-build' $stoppedArgs[0] 'StopTreeFn invoked with kit-repo-build service name'
    Assert-Equal $runDir $stoppedArgs[1] 'StopTreeFn invoked with the same RunDir'
    Write-TestPass 'Invoke-KitRepoBuild timeout kills process tree'
}
finally { Remove-TestSandbox -Path $sb }

# Test 16: Invoke-KitRepoBuild writes the started process id to a pid file before waiting,
# so an external killer can target it even ahead of the timeout deadline
$sb = New-TestSandbox -Prefix 'kit-repo-build'
try {
    $runDir = Join-Path $sb 'scripts\.run'
    New-Item -ItemType Directory -Path $runDir -Force | Out-Null
    $logPath = Join-Path $runDir 'kit-repo-build.log'
    $pidFile = Join-Path $runDir 'kit-repo-build.pid'
    $observedDuringWait = $null
    Invoke-KitRepoBuild -WorkingDirectory $sb -LogPath $logPath -RunDir $runDir `
        -StartProcessFn { param($workingDirectory, $logPath) [pscustomobject]@{ Id = 4245; ExitCode = 0 } } `
        -WaitForExitFn {
            param($proc, $timeoutMs)
            $script:observedDuringWait = Get-Content -LiteralPath $pidFile -ErrorAction SilentlyContinue
            $true
        } `
        -StopTreeFn { param($name, $runDir) throw 'StopTreeFn must not run on success' } | Out-Null
    Assert-Equal '4245' $observedDuringWait 'pid file already contains the child PID while waiting'
    Write-TestPass 'Invoke-KitRepoBuild writes pid file before waiting'
}
finally { Remove-TestSandbox -Path $sb }

# Test 17: Invoke-KitRepoBuild's default StartProcessFn calls repo.bat by its
# fully-qualified path, not a bare name (regression guard: hosts with a broken
# .bat/batfile file association make cmd.exe's bare-name PATHEXT lookup fail
# with "not recognized as an internal or external command" even though
# `where`/`dir`/`call` all find the file — 2026-07-06)
Assert-True (-not ($moduleContent -match '"repo\.bat build')) 'default StartProcessFn does not call repo.bat by bare name'
Assert-True ($moduleContent -match "Join-Path \`$workingDirectory 'repo\.bat'") 'default StartProcessFn resolves repo.bat to a fully-qualified path'
Write-TestPass 'Invoke-KitRepoBuild default StartProcessFn uses fully-qualified repo.bat path'

# Test 18: default StartProcessFn uses cmd.exe syntax that survives quoted batch
# paths plus quoted redirected log paths. Without `call`, cmd.exe /c can fail
# before repo.bat starts with "The filename, directory name, or volume label
# syntax is incorrect."
Assert-True ($moduleContent -match 'call `"\$repoBatPath`" build > `"\$logPath`" 2>&1') 'default StartProcessFn uses call for quoted repo.bat redirect'
$sb = New-TestSandbox -Prefix 'kit repo build'
try {
    $runDir = Join-Path $sb 'scripts\.run'
    New-Item -ItemType Directory -Path $runDir -Force | Out-Null
    $repoBat = Join-Path $sb 'repo.bat'
    $logPath = Join-Path $runDir 'kit repo build.log'
    @(
        '@echo off'
        'echo fake repo build %*'
        'exit /b 0'
    ) | Set-Content -LiteralPath $repoBat -Encoding ascii

    $result = Invoke-KitRepoBuild -WorkingDirectory $sb -LogPath $logPath -RunDir $runDir -TimeoutSec 5

    Assert-True ($result.TimedOut -eq $false) 'quoted redirect process exits'
    Assert-Equal 0 $result.ExitCode 'quoted redirect process returns success'
    Assert-True (Test-Path -LiteralPath $logPath -PathType Leaf) 'quoted redirect writes log file'
    Assert-True ((Get-Content -LiteralPath $logPath -Raw) -match 'fake repo build build') 'repo.bat received build argument'
    Write-TestPass 'Invoke-KitRepoBuild default StartProcessFn handles quoted redirect'
}
finally { Remove-TestSandbox -Path $sb }

# Test 19: registry-selected Linux Kit builds use repo.sh through bash, never cmd.exe.
Assert-True ($moduleContent -match "effectiveCommand -eq '\./repo\.sh build'") 'Linux build command has an explicit structured branch'
Assert-True ($moduleContent -match "Start-Process -FilePath 'bash'") 'Linux build branch launches bash'
Write-TestPass 'Invoke-KitRepoBuild supports validated Linux repo.sh command'

# Test 20: detachment is polled so a short setsid scheduling race can settle.
Assert-True ($moduleContent -match 'detachDeadline') 'detachment check has a bounded deadline'
Assert-True ($moduleContent -match '& \$SleepFn 100') 'detachment check retries between probes'
Write-TestPass 'host-native detachment check is bounded and retried'

# Test 21: Kit Manager receives its exact host-native child environment while
# the deployment process recovers its previous values after Start-Process.
$sb = New-TestSandbox -Prefix 'kit-manager-child-env'
$kitManagerEnvironmentNames = @('RUNTIME_MODE', 'HOST_LOCAL_RUNTIME_ALLOWED', 'KIT_INSTANCE_ID', 'KIT_CONTROL_URL')
$originalKitManagerEnvironment = @{}
try {
    foreach ($name in $kitManagerEnvironmentNames) {
        $originalKitManagerEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
        [Environment]::SetEnvironmentVariable($name, "parent-$name", 'Process')
    }
    function Resolve-HostNativePython { param($RepoRoot, $ServiceName) return (Get-Command python -ErrorAction Stop).Source }
    function Get-HostNativeBindHost { param($RepoRoot) return '127.0.0.1' }
    function Start-HostNativeService {
        param($Name, $WorkingDirectory, $FilePath, $ArgumentList, $RunDir)
        $script:capturedKitManagerEnvironment = [ordered]@{
            RUNTIME_MODE = [Environment]::GetEnvironmentVariable('RUNTIME_MODE', 'Process')
            HOST_LOCAL_RUNTIME_ALLOWED = [Environment]::GetEnvironmentVariable('HOST_LOCAL_RUNTIME_ALLOWED', 'Process')
            KIT_INSTANCE_ID = [Environment]::GetEnvironmentVariable('KIT_INSTANCE_ID', 'Process')
            KIT_CONTROL_URL = [Environment]::GetEnvironmentVariable('KIT_CONTROL_URL', 'Process')
        }
        return [pscustomobject]@{ Pid = 4246; LogPath = 'fixture.log' }
    }

    Start-HostNativeKitManager -RepoRoot $sb -Port 8010 | Out-Null

    Assert-Equal 'hybrid-web-plane-host-native-kit' $capturedKitManagerEnvironment.RUNTIME_MODE 'child receives hybrid runtime mode'
    Assert-Equal 'true' $capturedKitManagerEnvironment.HOST_LOCAL_RUNTIME_ALLOWED 'child receives host-local authority flag'
    Assert-Equal 'kit_local_001' $capturedKitManagerEnvironment.KIT_INSTANCE_ID 'child receives launched Kit instance id'
    Assert-Equal 'http://127.0.0.1:49101' $capturedKitManagerEnvironment.KIT_CONTROL_URL 'child receives loopback conversion authority URL'
    foreach ($name in $kitManagerEnvironmentNames) {
        Assert-Equal "parent-$name" ([Environment]::GetEnvironmentVariable($name, 'Process')) "parent env restores $name"
    }
    Write-TestPass 'host-native Kit Manager child env is exact and parent env is restored'
}
finally {
    foreach ($name in $kitManagerEnvironmentNames) {
        [Environment]::SetEnvironmentVariable($name, $originalKitManagerEnvironment[$name], 'Process')
    }
    Remove-TestSandbox -Path $sb
}

Write-Host "`n=== test-host-native-launcher.ps1: ALL PASSED ===" -ForegroundColor Green
