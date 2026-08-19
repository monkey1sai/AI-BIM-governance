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
    "KIT_INSTANCE_ID = 'kit_local_001'"
)) {
    Assert-True ($moduleContent.Contains($expectedKitManagerSetting)) "Kit Manager child env includes $expectedKitManagerSetting"
}
Assert-True ($moduleContent -match 'KIT_CONTROL_URL\s*=\s*\$normalizedKitControlUrl') 'Kit Manager child env uses the validated caller-supplied control URL'
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
        -StartProcessFn { param($workingDirectory, $logPath) Set-Content -LiteralPath $logPath -Value 'build ok'; [pscustomobject]@{ Id = 4242; ExitCode = 0 } } `
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

# Test 15b: exit 0 without a log file is treated as a failed build
# (2026-08-11 canonical rebuild regression: bash 收到被重組壞掉的命令列,repo.sh
# 無參數印 usage 後 exit 0、重導向沒生效 — exit code 因此不可單獨採信)
$sb = New-TestSandbox -Prefix 'kit-repo-build-nolog'
try {
    $runDir = Join-Path $sb 'scripts\.run'
    New-Item -ItemType Directory -Path $runDir -Force | Out-Null
    $logPath = Join-Path $runDir 'kit-repo-build.log'
    $result = Invoke-KitRepoBuild -WorkingDirectory $sb -LogPath $logPath -RunDir $runDir `
        -StartProcessFn { param($workingDirectory, $logPath) [pscustomobject]@{ Id = 4245; ExitCode = 0 } } `
        -WaitForExitFn { param($proc, $timeoutMs) $true } `
        -StopTreeFn { param($name, $runDir) throw 'StopTreeFn must not run' }
    Assert-True ($result.TimedOut -eq $false) 'no-log path is not TimedOut'
    Assert-Equal 1 $result.ExitCode 'exit 0 without a log file fails closed'
    Write-TestPass 'Invoke-KitRepoBuild refuses silent no-log success'
}
finally { Remove-TestSandbox -Path $sb }

# Test 15c: the real bash launch path keeps the build argument and the log redirect
# (dynamic regression guard for the same 2026-08-11 incident: Start-Process 對含
# 內嵌引號的 -c 字串重組後,bash 丟失 build 參數與重導向;修正把命令寫進 wrapper
# 並由 stdin 餵給 bash。sandbox 刻意帶空白+$+backtick 目錄:registry 允許這些
# 字元,空白證明引號重組碰不到 stdin wrapper,$ 與 backtick 證明 wrapper 內插
# 的路徑有跳脫、不會被 sh 做參數/命令替換)
$sbRoot = New-TestSandbox -Prefix 'kit-repo-build-bash'
$originalPath = $env:PATH
try {
    # Windows 的裸 `bash` 可能先解析到 System32\bash.exe (WSL)。WSL 需要
    # /mnt/c/... 路徑，無法直接執行這個 Win32 sandbox 裡的 C:/... wrapper；
    # production 的 Linux 路徑則由 native bash 執行。Windows regression 優先
    # 使用隨 Git 安裝的 MSYS bash，讓測試真的覆蓋 production 的 argv/stdin
    # 行為，而不是因 host path dialect 不相容而誤判 launcher。
    if ([Environment]::OSVersion.Platform -eq [PlatformID]::Win32NT) {
        $gitCommand = Get-Command git -ErrorAction SilentlyContinue
        if ($null -ne $gitCommand) {
            $gitRoot = Split-Path -Parent (Split-Path -Parent $gitCommand.Source)
            $gitBash = Join-Path $gitRoot 'bin\bash.exe'
            if (Test-Path -LiteralPath $gitBash -PathType Leaf) {
                $env:PATH = "$(Split-Path -Parent $gitBash)$([IO.Path]::PathSeparator)$originalPath"
            }
        }
    }
    $bashCommand = Get-Command bash -ErrorAction SilentlyContinue
    $sb = (Join-Path $sbRoot 'deploy root with $paces and `tick') -replace '\\', '/'
    $runDir = Join-Path $sb 'scripts/.run'
    New-Item -ItemType Directory -Path $runDir -Force | Out-Null
    $logPath = (Join-Path $runDir 'kit-repo-build.log') -replace '\\', '/'
    $argsPath = (Join-Path $sb 'seen-args.txt') -replace '\\', '/'
    $fakeRepoSh = Join-Path $sb 'repo.sh'
    [IO.File]::WriteAllText($fakeRepoSh, "#!/bin/sh`nprintf '%s\n' `"`$@`" > '$argsPath'`necho build-ran`nexit 0`n")
    if ($null -eq $bashCommand) {
        Write-TestPass 'Invoke-KitRepoBuild real bash launch (skipped: no bash on this host)'
    } else {
        # POSIX 上 WriteAllText 不帶 exec bit,exec "$0" 會 Permission denied；
        # MSYS bash 忽略 exec bit，所以只在 native POSIX host 執行並驗證 chmod。
        if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
            & $bashCommand.Source -c "chmod +x '$($fakeRepoSh -replace '\\', '/')'"
            Assert-Equal 0 $LASTEXITCODE 'fake repo.sh chmod succeeds before the launch'
        }
        $result = Invoke-KitRepoBuild -WorkingDirectory $sb -LogPath $logPath -RunDir $runDir `
            -BuildCommand './repo.sh build' -TimeoutSec 60
        Assert-True ($result.TimedOut -eq $false) 'real bash launch is not TimedOut'
        Assert-Equal 0 $result.ExitCode 'real bash launch exits 0'
        Assert-True (Test-Path -LiteralPath $argsPath -PathType Leaf) 'fake repo.sh actually ran'
        Assert-Equal 'build' ((Get-Content -LiteralPath $argsPath -Raw).Trim()) 'repo.sh received exactly the build argument'
        Assert-True (Test-Path -LiteralPath $logPath -PathType Leaf) 'stdout redirect created the log file'
        Assert-True ((Get-Content -LiteralPath $logPath -Raw) -match 'build-ran') 'repo.sh stdout reached the log file'
    }
}
finally {
    $env:PATH = $originalPath
    Remove-TestSandbox -Path $sbRoot
}

# Test 15d: a stale log from a previous build is removed before the launch
# (otherwise the exit-0-must-have-a-log guard would accept the previous run's
# log as evidence and the shredded-launch signature would slip through again)
$sb = New-TestSandbox -Prefix 'kit-repo-build-stale'
try {
    $runDir = Join-Path $sb 'scripts\.run'
    New-Item -ItemType Directory -Path $runDir -Force | Out-Null
    $logPath = Join-Path $runDir 'kit-repo-build.log'
    Set-Content -LiteralPath $logPath -Value 'stale log from an earlier build'
    $result = Invoke-KitRepoBuild -WorkingDirectory $sb -LogPath $logPath -RunDir $runDir `
        -StartProcessFn { param($workingDirectory, $logPath) [pscustomobject]@{ Id = 4246; ExitCode = 0 } } `
        -WaitForExitFn { param($proc, $timeoutMs) $true } `
        -StopTreeFn { param($name, $runDir) throw 'StopTreeFn must not run' }
    Assert-Equal 1 $result.ExitCode 'stale log does not satisfy the log-existence guard'
    Assert-True (-not (Test-Path -LiteralPath $logPath)) 'stale log was removed before the launch'
    Write-TestPass 'Invoke-KitRepoBuild removes stale logs before launching'
}
finally { Remove-TestSandbox -Path $sb }

# Test 15e: failure to remove locked stale log evidence aborts before launch
Assert-True ($moduleContent -match 'Remove-Item -LiteralPath \$LogPath -Force -ErrorAction Stop') 'stale-log cleanup errors are terminating'
if ([Environment]::OSVersion.Platform -eq [PlatformID]::Win32NT) {
    $sb = New-TestSandbox -Prefix 'kit-repo-build-stale-cleanup'
    $lockedLog = $null
    try {
        $runDir = Join-Path $sb 'scripts\.run'
        New-Item -ItemType Directory -Path $runDir -Force | Out-Null
        $logPath = Join-Path $runDir 'kit-repo-build.log'
        Set-Content -LiteralPath $logPath -Value 'locked stale evidence'
        $lockedLog = [IO.File]::Open($logPath, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::None)
        $started = $false
        $cleanupError = $null
        try {
            Invoke-KitRepoBuild -WorkingDirectory $sb -LogPath $logPath -RunDir $runDir `
                -StartProcessFn { param($workingDirectory, $logPath) $script:started = $true; [pscustomobject]@{ Id = 4247; ExitCode = 0 } } `
                -WaitForExitFn { param($proc, $timeoutMs) $true } `
                -StopTreeFn { param($name, $runDir) throw 'StopTreeFn must not run' } | Out-Null
        }
        catch { $cleanupError = $_ }
        Assert-True ($null -ne $cleanupError) 'locked stale-log cleanup failure aborts the build'
        Assert-True (-not $started) 'build process is not launched after locked stale-log cleanup failure'
        Write-TestPass 'Invoke-KitRepoBuild fails closed when stale log cleanup fails'
    }
    finally {
        if ($null -ne $lockedLog) { $lockedLog.Dispose() }
        Remove-TestSandbox -Path $sb
    }
}
else {
    Write-TestPass 'Invoke-KitRepoBuild locked stale-log cleanup (skipped: POSIX permits unlinking open files)'
}

# Test 15f: a container at the log-file path is rejected and preserved
$sb = New-TestSandbox -Prefix 'kit-repo-build-log-container'
try {
    $runDir = Join-Path $sb 'scripts\.run'
    New-Item -ItemType Directory -Path $runDir -Force | Out-Null
    $logPath = Join-Path $runDir 'kit-repo-build.log'
    New-Item -ItemType Directory -Path $logPath -Force | Out-Null
    $started = $false
    $cleanupError = $null
    try {
        Invoke-KitRepoBuild -WorkingDirectory $sb -LogPath $logPath -RunDir $runDir `
            -StartProcessFn { param($workingDirectory, $logPath) $script:started = $true; [pscustomobject]@{ Id = 4248; ExitCode = 0 } } `
            -WaitForExitFn { param($proc, $timeoutMs) $true } `
            -StopTreeFn { param($name, $runDir) throw 'StopTreeFn must not run' } | Out-Null
    }
    catch { $cleanupError = $_ }
    Assert-True ($null -ne $cleanupError) 'container at the log path aborts the build'
    Assert-True (-not $started) 'build process is not launched for a container log path'
    Assert-True (Test-Path -LiteralPath $logPath -PathType Container) 'container at the log path is preserved'
    Write-TestPass 'Invoke-KitRepoBuild rejects a container log path'
}
finally { Remove-TestSandbox -Path $sb }

# Test 15g: metadata lookup errors abort before stale evidence can be trusted
$sb = New-TestSandbox -Prefix 'kit-repo-build-log-metadata'
try {
    $runDir = Join-Path $sb 'scripts\.run'
    New-Item -ItemType Directory -Path $runDir -Force | Out-Null
    $logPath = Join-Path $runDir 'kit-repo-build.log'
    $started = $false
    $cleanupError = $null
    $previousErrorActionPreference = $ErrorActionPreference
    try {
        function Test-Path {
            [CmdletBinding()]
            param([string] $LiteralPath, [object] $PathType)
            Write-Error 'simulated log metadata access failure'
            return $false
        }
        $ErrorActionPreference = 'Continue'
        try {
            Invoke-KitRepoBuild -WorkingDirectory $sb -LogPath $logPath -RunDir $runDir `
                -StartProcessFn { param($workingDirectory, $logPath) $script:started = $true; [pscustomobject]@{ Id = 4249; ExitCode = 0 } } `
                -WaitForExitFn { param($proc, $timeoutMs) $true } `
                -StopTreeFn { param($name, $runDir) throw 'StopTreeFn must not run' } | Out-Null
        }
        catch { $cleanupError = $_ }
    }
    finally {
        $ErrorActionPreference = $previousErrorActionPreference
        Remove-Item -LiteralPath Function:\Test-Path -Force -ErrorAction SilentlyContinue
    }
    Assert-True ($null -ne $cleanupError) 'log metadata access failure aborts the build'
    Assert-True (-not $started) 'build process is not launched after log metadata access failure'
    Write-TestPass 'Invoke-KitRepoBuild fails closed on log metadata errors'
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
$originalDefaultProbePythonPath = $env:PYTHONPATH
$originalDefaultProbePidFileEnv = $env:HOST_NATIVE_LAUNCHER_TEST_PID_FILE
$originalDefaultProbeMarkerFileEnv = $env:HOST_NATIVE_LAUNCHER_TEST_MARKER_FILE
try {
    foreach ($name in $kitManagerEnvironmentNames) {
        $originalKitManagerEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
        [Environment]::SetEnvironmentVariable($name, "parent-$name", 'Process')
    }
    function Resolve-HostNativePython { param($RepoRoot, $ServiceName) return 'fixture-python' }
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

    $script:capturedImportProbeTimeoutSec = $null
    Start-HostNativeKitManager -RepoRoot $sb -Port 8010 `
        -KitControlUrl 'HTTP://LOCALHOST:49101/' `
        -ImportProbeTimeoutSec 17 `
        -ImportProbeFn { param($PythonExe, $TimeoutSec) $script:capturedImportProbeTimeoutSec = $TimeoutSec; return 0 } `
        -LocalAddressProbeFn { param($HostName) return ($HostName -eq 'localhost') } | Out-Null

    Assert-Equal 17 $script:capturedImportProbeTimeoutSec 'Kit Manager import probe receives the configured bounded timeout'
    Assert-Equal 'hybrid-web-plane-host-native-kit' $capturedKitManagerEnvironment.RUNTIME_MODE 'child receives hybrid runtime mode'
    Assert-Equal 'true' $capturedKitManagerEnvironment.HOST_LOCAL_RUNTIME_ALLOWED 'child receives host-local authority flag'
    Assert-Equal 'kit_local_001' $capturedKitManagerEnvironment.KIT_INSTANCE_ID 'child receives launched Kit instance id'
    Assert-Equal 'http://localhost:49101' $capturedKitManagerEnvironment.KIT_CONTROL_URL 'child receives the canonical explicit operator-configured control authority URL'
    foreach ($name in $kitManagerEnvironmentNames) {
        Assert-Equal "parent-$name" ([Environment]::GetEnvironmentVariable($name, 'Process')) "parent env restores $name"
    }
    Write-TestPass 'host-native Kit Manager child env is exact and parent env is restored'

    Start-HostNativeKitManager -RepoRoot $sb -Port 8010 `
        -KitControlUrl '' `
        -ImportProbeFn { param($PythonExe) return 0 } `
        -LocalAddressProbeFn { param($HostName) throw 'empty control URL must not probe an address' } | Out-Null
    # .NET Framework removes a process env var when it is set to '', while modern
    # .NET preserves the empty string. Both represent the same unconfigured child
    # authority, so normalize the host-specific null/empty representation.
    Assert-Equal '' ([string]$capturedKitManagerEnvironment.KIT_CONTROL_URL) 'unconfigured Kit control remains an honest empty child value'
    foreach ($name in $kitManagerEnvironmentNames) {
        Assert-Equal "parent-$name" ([Environment]::GetEnvironmentVariable($name, 'Process')) "parent env restores $name after empty control authority"
    }
    Write-TestPass 'host-native Kit Manager preserves unconfigured control as blocked state'

    function Start-HostNativeService {
        param($Name, $WorkingDirectory, $FilePath, $ArgumentList, $RunDir)
        $script:capturedKitManagerEnvironment = [ordered]@{
            RUNTIME_MODE = [Environment]::GetEnvironmentVariable('RUNTIME_MODE', 'Process')
            HOST_LOCAL_RUNTIME_ALLOWED = [Environment]::GetEnvironmentVariable('HOST_LOCAL_RUNTIME_ALLOWED', 'Process')
            KIT_INSTANCE_ID = [Environment]::GetEnvironmentVariable('KIT_INSTANCE_ID', 'Process')
            KIT_CONTROL_URL = [Environment]::GetEnvironmentVariable('KIT_CONTROL_URL', 'Process')
        }
        throw 'fixture launch failure'
    }
    $launchFailure = ''
    try {
        Start-HostNativeKitManager -RepoRoot $sb -Port 8010 `
            -KitControlUrl 'http://localhost:49101' `
            -ImportProbeFn { param($PythonExe) return 0 } `
            -LocalAddressProbeFn { param($HostName) return ($HostName -eq 'localhost') } | Out-Null
    }
    catch {
        $launchFailure = $_.Exception.Message
    }
    Assert-True ($launchFailure -match 'fixture launch failure') 'Kit Manager surfaces a child launch failure'
    Assert-Equal 'hybrid-web-plane-host-native-kit' $capturedKitManagerEnvironment.RUNTIME_MODE 'throwing child observes exact runtime mode before launch'
    Assert-Equal 'http://localhost:49101' $capturedKitManagerEnvironment.KIT_CONTROL_URL 'throwing child observes canonical control URL before launch'
    foreach ($name in $kitManagerEnvironmentNames) {
        Assert-Equal "parent-$name" ([Environment]::GetEnvironmentVariable($name, 'Process')) "parent env restores $name after child launch failure"
    }
    Write-TestPass 'host-native Kit Manager restores parent env after launch failure'

    $nonLocalError = ''
    try {
        Start-HostNativeKitManager -RepoRoot $sb -Port 8010 `
            -KitControlUrl 'http://192.0.2.51:49101' `
            -ImportProbeFn { param($PythonExe) return 0 } `
            -LocalAddressProbeFn { param($HostName) return $false } | Out-Null
    }
    catch {
        $nonLocalError = $_.Exception.Message
    }
    Assert-True ($nonLocalError -match 'loopback or an address assigned to this host') 'Kit Manager rejects a non-local conversion authority URL'
    Write-TestPass 'host-native Kit Manager rejects non-local Kit control URL'

    # Test 21b (issue #493 / TG-02): drive the DEFAULT ImportProbeFn through
    # a real Python subprocess on the success path. Local shim modules avoid a
    # dependency on whatever fastapi/uvicorn versions happen to be installed,
    # while a marker file proves that both imports actually executed.
    $defaultProbePython = Resolve-PlatformSystemPython
    if ([string]::IsNullOrWhiteSpace($defaultProbePython)) {
        throw 'default import-probe regression fixture requires a working Python 3.11+ interpreter'
    }
    function Resolve-HostNativePython { param($RepoRoot, $ServiceName) return $defaultProbePython }
    $script:defaultProbeServiceStartCount = 0
    function Start-HostNativeService {
        param($Name, $WorkingDirectory, $FilePath, $ArgumentList, $RunDir)
        $script:defaultProbeServiceStartCount++
        return [pscustomobject]@{ Pid = 4251; LogPath = 'fixture.log' }
    }

    $defaultProbeSuccessShimDir = Join-Path $sb 'default-probe-success-shim'
    New-Item -ItemType Directory -Path $defaultProbeSuccessShimDir -Force | Out-Null
    $defaultProbeSuccessMarker = Join-Path $sb 'default-probe-success.marker'
    $defaultProbeSuccessFastapiSource = @'
import os
from pathlib import Path

Path(os.environ['HOST_NATIVE_LAUNCHER_TEST_MARKER_FILE']).write_text('fastapi', encoding='utf-8')
'@
    $defaultProbeSuccessUvicornSource = @'
import os
from pathlib import Path

with Path(os.environ['HOST_NATIVE_LAUNCHER_TEST_MARKER_FILE']).open('a', encoding='utf-8') as fh:
    fh.write(',uvicorn')
'@
    [System.IO.File]::WriteAllText(
        (Join-Path $defaultProbeSuccessShimDir 'fastapi.py'),
        $defaultProbeSuccessFastapiSource
    )
    [System.IO.File]::WriteAllText(
        (Join-Path $defaultProbeSuccessShimDir 'uvicorn.py'),
        $defaultProbeSuccessUvicornSource
    )
    $env:PYTHONPATH = $defaultProbeSuccessShimDir
    $env:HOST_NATIVE_LAUNCHER_TEST_MARKER_FILE = $defaultProbeSuccessMarker
    $script:defaultProbeServiceStartCount = 0

    Start-HostNativeKitManager -RepoRoot $sb -Port 8010 -KitControlUrl '' `
        -ImportProbeTimeoutSec 5 | Out-Null

    Assert-Equal 1 $script:defaultProbeServiceStartCount `
        'a successful default import probe reaches Start-HostNativeService exactly once'
    Assert-True (Test-Path -LiteralPath $defaultProbeSuccessMarker -PathType Leaf) `
        'successful default import probe writes its subprocess marker'
    Assert-Equal 'fastapi,uvicorn' (Get-Content -Raw -LiteralPath $defaultProbeSuccessMarker) `
        'successful default import probe executes both real Python imports in order'
    Write-TestPass 'host-native Kit Manager default import probe dynamically executes the success path'

    # Test 21c (issue #493 / TG-02): execute the DEFAULT probe failure path.
    # The fastapi shim writes a marker before raising. The uvicorn shim would
    # append an unmistakable value if it were unexpectedly reached.
    $defaultProbeFailureShimDir = Join-Path $sb 'default-probe-failure-shim'
    New-Item -ItemType Directory -Path $defaultProbeFailureShimDir -Force | Out-Null
    $defaultProbeFailureMarker = Join-Path $sb 'default-probe-failure.marker'
    $defaultProbeFailureFastapiSource = @'
import os
from pathlib import Path

Path(os.environ['HOST_NATIVE_LAUNCHER_TEST_MARKER_FILE']).write_text('fastapi-failure', encoding='utf-8')
raise RuntimeError('fixture import failure')
'@
    $defaultProbeFailureUvicornSource = @'
import os
from pathlib import Path

with Path(os.environ['HOST_NATIVE_LAUNCHER_TEST_MARKER_FILE']).open('a', encoding='utf-8') as fh:
    fh.write(',uvicorn-unexpected')
'@
    [System.IO.File]::WriteAllText(
        (Join-Path $defaultProbeFailureShimDir 'fastapi.py'),
        $defaultProbeFailureFastapiSource
    )
    [System.IO.File]::WriteAllText(
        (Join-Path $defaultProbeFailureShimDir 'uvicorn.py'),
        $defaultProbeFailureUvicornSource
    )
    $env:PYTHONPATH = $defaultProbeFailureShimDir
    $env:HOST_NATIVE_LAUNCHER_TEST_MARKER_FILE = $defaultProbeFailureMarker
    $script:defaultProbeServiceStartCount = 0
    $defaultProbeFailureStopwatch = [System.Diagnostics.Stopwatch]::StartNew()
    $defaultProbeFailureError = ''
    try {
        Start-HostNativeKitManager -RepoRoot $sb -Port 8010 -KitControlUrl '' `
            -ImportProbeTimeoutSec 5 | Out-Null
    }
    catch {
        $defaultProbeFailureError = $_.Exception.Message
    }
    $defaultProbeFailureStopwatch.Stop()

    Assert-True ($defaultProbeFailureError -match [regex]::Escape('kit-manager-api Python cannot import fastapi and uvicorn')) `
        'a real default import failure propagates the documented service-start blocker'
    Assert-True ($defaultProbeFailureStopwatch.Elapsed.TotalSeconds -lt 10) `
        'a real default import failure returns within a bounded window'
    Assert-Equal 0 $script:defaultProbeServiceStartCount `
        'a failed default import probe never reaches Start-HostNativeService'
    Assert-True (Test-Path -LiteralPath $defaultProbeFailureMarker -PathType Leaf) `
        'failed default import probe writes its subprocess marker before raising'
    Assert-Equal 'fastapi-failure' (Get-Content -Raw -LiteralPath $defaultProbeFailureMarker) `
        'failed default import probe executes the failing fastapi shim and does not reach uvicorn'
    Write-TestPass 'host-native Kit Manager default import probe dynamically executes the failure path'

    # Test 21d (issue #493 / TG-02): make the DEFAULT import probe hang.
    # Put a fastapi.py shim earlier on PYTHONPATH; it spawns a child and sleeps,
    # proving timeout propagation and descendant cleanup through the real probe.
    $defaultProbeShimDir = Join-Path $sb 'default-probe-timeout-shim'
    New-Item -ItemType Directory -Path $defaultProbeShimDir -Force | Out-Null
    $defaultProbePidFile = Join-Path $sb 'default-probe-pids.json'
    # The shim reads its output path from an env var rather than an embedded
    # literal so nothing here depends on how PowerShell would need to escape a
    # Windows path inside a Python string.
    $defaultProbeShimSource = @'
import json
import os
import subprocess
import sys
import time

pid_file = os.environ['HOST_NATIVE_LAUNCHER_TEST_PID_FILE']
child = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(30)'])
with open(pid_file, 'w', encoding='utf-8') as fh:
    json.dump([os.getpid(), child.pid], fh)
time.sleep(30)
'@
    [System.IO.File]::WriteAllText((Join-Path $defaultProbeShimDir 'fastapi.py'), $defaultProbeShimSource)
    $env:PYTHONPATH = $defaultProbeShimDir
    $env:HOST_NATIVE_LAUNCHER_TEST_PID_FILE = $defaultProbePidFile
    $script:defaultProbeServiceStartCount = 0

    $defaultProbeStopwatch = [System.Diagnostics.Stopwatch]::StartNew()
    $defaultProbeError = ''
    try {
        Start-HostNativeKitManager -RepoRoot $sb -Port 8010 -KitControlUrl '' `
            -ImportProbeTimeoutSec 1 | Out-Null
    }
    catch {
        $defaultProbeError = $_.Exception.Message
    }
    $defaultProbeStopwatch.Stop()

    Assert-True ($defaultProbeError -match [regex]::Escape('kit-manager-api Python cannot import fastapi and uvicorn')) `
        'default import probe timeout propagates the documented -1 failure (host-native-launcher.ps1:616-618)'
    Assert-True ($defaultProbeStopwatch.Elapsed.TotalSeconds -lt 10) `
        'default import probe timeout returns within a bounded window, proving the timeout wiring rather than a hang'
    Assert-Equal 0 $script:defaultProbeServiceStartCount `
        'a timed-out default import probe must never reach Start-HostNativeService'
    Assert-True (Test-Path -LiteralPath $defaultProbePidFile -PathType Leaf) `
        'hung-import shim must record its own PID and its child PID before the timeout kills it'
    $defaultProbePids = @(Get-Content -Raw -LiteralPath $defaultProbePidFile | ConvertFrom-Json)
    Assert-Equal 2 $defaultProbePids.Count 'hung-import shim records exactly parent + child PIDs'
    foreach ($defaultProbeProcessId in $defaultProbePids) {
        $defaultProbeRemaining = Get-Process -Id ([int]$defaultProbeProcessId) -ErrorAction SilentlyContinue
        for ($defaultProbeAttempt = 0; $null -ne $defaultProbeRemaining -and $defaultProbeAttempt -lt 20; $defaultProbeAttempt++) {
            Start-Sleep -Milliseconds 100
            $defaultProbeRemaining = Get-Process -Id ([int]$defaultProbeProcessId) -ErrorAction SilentlyContinue
        }
        if ($null -ne $defaultProbeRemaining) {
            throw "default import probe left PID $defaultProbeProcessId running after termination"
        }
    }
    Write-TestPass 'host-native Kit Manager default import probe bounds a hung fastapi import, never starts the service, and leaves no surviving PIDs'
}
finally {
    foreach ($name in $kitManagerEnvironmentNames) {
        [Environment]::SetEnvironmentVariable($name, $originalKitManagerEnvironment[$name], 'Process')
    }
    $env:PYTHONPATH = $originalDefaultProbePythonPath
    $env:HOST_NATIVE_LAUNCHER_TEST_PID_FILE = $originalDefaultProbePidFileEnv
    $env:HOST_NATIVE_LAUNCHER_TEST_MARKER_FILE = $originalDefaultProbeMarkerFileEnv
    Remove-TestSandbox -Path $sb
}

$canonicalControlUrl = Resolve-HostNativeKitControlUrl `
    -KitControlUrl 'HTTP://LOCALHOST:49101/' `
    -LocalAddressProbeFn { param($HostName) return ($HostName -eq 'localhost') }
Assert-Equal 'http://localhost:49101' $canonicalControlUrl 'resolver canonicalizes an explicit localhost authority'

Assert-True ($moduleContent -match 'Invoke-HostNativeBoundedProcess') 'Kit Manager import probe routes through the shared launch-time containment boundary (#522)'
Assert-True ($moduleContent -match '-TimeoutSec \(\[int\]\$TimeoutSec\)') 'Kit Manager import probe wait is bounded through the boundary helper'
Assert-True ($moduleContent -match 'probe\.TerminationFailure') 'Kit Manager import probe fails closed when a timed-out child process tree exit cannot be proven'
Assert-True ($moduleContent -match 'function Stop-HostNativeProcessTreeAndWait') 'launcher defines a shared bounded process-tree terminator'
Assert-True ($moduleContent -match '\$Process\.Kill\(\$true\)') 'bounded process-tree terminator includes descendants'
Assert-True ($moduleContent -match '\$Process\.WaitForExit\(\$TimeoutMs\)') 'bounded process-tree terminator waits for exit'
Assert-True ($moduleContent -match '-not \$Process\.HasExited') 'bounded process-tree terminator verifies exit'

$ipv6ControlUrl = Resolve-HostNativeKitControlUrl `
    -KitControlUrl 'HTTP://[::1]:49101/' `
    -LocalAddressProbeFn {
        param($HostName)
        # .NET Framework expands ::1 to 0000:...:0001 while modern .NET keeps
        # the compressed form. Check the address semantics, not its rendering.
        return [System.Net.IPAddress]::IsLoopback(
            [System.Net.IPAddress]::Parse($HostName.Trim([char[]]'[]'))
        )
    }
$ipv6ControlUri = [Uri]$ipv6ControlUrl
Assert-Equal 'http' $ipv6ControlUri.Scheme 'resolver preserves the HTTP scheme for IPv6 loopback authority'
Assert-Equal 49101 $ipv6ControlUri.Port 'resolver preserves the IPv6 loopback authority port'
Assert-True ([System.Net.IPAddress]::IsLoopback(
    [System.Net.IPAddress]::Parse($ipv6ControlUri.Host.Trim([char[]]'[]'))
)) 'resolver preserves the IPv6 loopback authority address semantics'

$rejectedControlUrls = @(
    @{ Name = 'HTTPS'; Url = 'https://localhost:49101' },
    @{ Name = 'credentials'; Url = 'http://user:pass@localhost:49101' },
    @{ Name = 'path'; Url = 'http://localhost:49101/control' },
    @{ Name = 'query'; Url = 'http://localhost:49101/?mode=control' },
    @{ Name = 'fragment'; Url = 'http://localhost:49101/#control' },
    @{ Name = 'empty authority'; Url = 'http:///' }
)
foreach ($controlCase in $rejectedControlUrls) {
    $rejectionMessage = ''
    try {
        Resolve-HostNativeKitControlUrl `
            -KitControlUrl $controlCase.Url `
            -LocalAddressProbeFn { param($HostName) return $true } | Out-Null
    }
    catch {
        $rejectionMessage = $_.Exception.Message
    }
    Assert-True ($rejectionMessage -match 'origin-only absolute HTTP URL') "resolver rejects $($controlCase.Name) control URL shape"
}
Write-TestPass 'Kit control URL authority shape matrix'

# ---------------------------------------------------------------------------
# Process-tree containment (#489 L1-COR-004).
# Kill($true) + WaitForExit + HasExited only ever describe the SAME Process
# object, and the old catch swallowed the tree-kill exception whenever the
# parent had already exited - so the helper reported success while
# grandchildren kept running. The postcondition must cover every descendant.
# ---------------------------------------------------------------------------
Assert-True ($moduleContent -match "GetMethod\('Kill'") 'bounded process-tree terminator probes the Kill(bool) overload before using it'
Assert-True ($moduleContent -match 'Get-PlatformChildProcessIds -ParentProcessId') 'bounded process-tree terminator enumerates descendants through the platform adapter'
$overloadProbeIndex = $moduleContent.IndexOf("GetMethod('Kill'")
$treeKillIndex = $moduleContent.IndexOf('$Process.Kill($true)')
Assert-True ($overloadProbeIndex -ge 0 -and $treeKillIndex -gt $overloadProbeIndex) 'bounded process-tree terminator guards the tree kill behind the overload probe'

$treeSandbox = New-TestSandbox -Prefix 'hn-tree-terminator'
try {
    $fixturePython = Resolve-PlatformSystemPython
    if ([string]::IsNullOrWhiteSpace($fixturePython)) {
        throw 'process-tree containment regressions require a working Python 3.11+ interpreter'
    }

    function Start-TreeFixtureProcess {
        param(
            [Parameter(Mandatory = $true)][string] $PythonExe,
            [Parameter(Mandatory = $true)][string] $ScriptPath,
            [Parameter(Mandatory = $true)][string] $PidPath
        )
        $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
        $startInfo.FileName = $PythonExe
        $startInfo.UseShellExecute = $false
        $startInfo.CreateNoWindow = $true
        [void]$startInfo.ArgumentList.Add($ScriptPath)
        [void]$startInfo.ArgumentList.Add($PidPath)
        $process = [System.Diagnostics.Process]::new()
        $process.StartInfo = $startInfo
        if (-not $process.Start()) { throw 'process-tree fixture did not start' }
        for ($attempt = 0; $attempt -lt 200; $attempt++) {
            if (Test-Path -LiteralPath $PidPath -PathType Leaf) { break }
            Start-Sleep -Milliseconds 50
        }
        if (-not (Test-Path -LiteralPath $PidPath -PathType Leaf)) {
            throw 'process-tree fixture never recorded its PIDs'
        }
        return $process
    }

    # Case 1: a real parent with a real grandchild-capable child. Both PIDs must
    # be gone by the time the helper returns, inside the bounded window.
    $treeFixture = Join-Path $treeSandbox 'tree-fixture.py'
    $treePidFile = Join-Path $treeSandbox 'tree-pids.json'
    $treeSource = @'
import json
import os
import pathlib
import subprocess
import sys
import time

child = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(120)"])
pathlib.Path(sys.argv[1]).write_text(
    json.dumps([os.getpid(), child.pid]), encoding="utf-8"
)
time.sleep(120)
'@
    [System.IO.File]::WriteAllText($treeFixture, $treeSource)
    $treeProcess = Start-TreeFixtureProcess -PythonExe $fixturePython -ScriptPath $treeFixture -PidPath $treePidFile
    $treePids = @(Get-Content -Raw -LiteralPath $treePidFile | ConvertFrom-Json)
    Assert-Equal 2 $treePids.Count 'process-tree fixture records exactly its parent and child PIDs'
    $treeStopwatch = [System.Diagnostics.Stopwatch]::StartNew()
    try {
        Stop-HostNativeProcessTreeAndWait -Process $treeProcess -TimeoutMs 5000
    }
    finally {
        $treeStopwatch.Stop()
    }
    Assert-True ($treeStopwatch.Elapsed.TotalSeconds -lt 15) 'process-tree terminator returns inside the bounded cleanup window'
    foreach ($treePid in $treePids) {
        Assert-True ($null -eq (Get-PlatformProcessIdentity -ProcessId ([int]$treePid))) "process-tree terminator proves PID $treePid exited"
    }
    Write-TestPass 'process-tree terminator waits for every descendant, not only the parent'

    # Case 2: a descendant that cannot be killed must FAIL CLOSED. The old
    # implementation reported success here because it never looked past the
    # parent object.
    $survivorFixture = Join-Path $treeSandbox 'survivor-fixture.py'
    $survivorPidFile = Join-Path $treeSandbox 'survivor-pids.json'
    $survivorSource = @'
import json
import os
import pathlib
import sys
import time

pathlib.Path(sys.argv[1]).write_text(json.dumps([os.getpid()]), encoding="utf-8")
time.sleep(120)
'@
    [System.IO.File]::WriteAllText($survivorFixture, $survivorSource)
    $survivorProcess = Start-TreeFixtureProcess -PythonExe $fixturePython -ScriptPath $survivorFixture -PidPath $survivorPidFile
    $unkillableDescendantId = 424242
    $survivorIdentity = [pscustomobject]@{
        ProcessId      = $unkillableDescendantId
        BirthToken     = 'fixture-birth-token'
        ExecutablePath = ''
        CommandLine    = ''
    }
    $survivorFailure = ''
    $survivorStopwatch = [System.Diagnostics.Stopwatch]::StartNew()
    try {
        Stop-HostNativeProcessTreeAndWait -Process $survivorProcess -TimeoutMs 1000 `
            -ChildPidLookup {
                param($parentId)
                if ([int]$parentId -eq $unkillableDescendantId) { return @() }
                return @($unkillableDescendantId)
            }.GetNewClosure() `
            -IdentityProbeFn {
                param($procId)
                if ([int]$procId -eq $unkillableDescendantId) { return $survivorIdentity }
                return $null
            }.GetNewClosure() `
            -StopProcessFn { param($procId) } | Out-Null
    }
    catch {
        $survivorFailure = $_.Exception.Message
    }
    finally {
        $survivorStopwatch.Stop()
        if (-not $survivorProcess.HasExited) {
            $survivorProcess.Kill()
            [void]$survivorProcess.WaitForExit(5000)
        }
    }
    Assert-True ($survivorFailure -match "left descendant PID\(s\) $unkillableDescendantId running") 'process-tree terminator fails closed when a snapshotted descendant survives'
    Assert-True ($survivorStopwatch.Elapsed.TotalSeconds -lt 15) 'process-tree terminator bounds the descendant wait before failing closed'
    Write-TestPass 'process-tree terminator fails closed on a surviving descendant'

    # Case 3 (#489 L1-COR-001, #513 gate r2 L1-COR-001): the parent exits BEFORE
    # the helper is entered. Neither OS cascades termination, so the descendants
    # are still running - the old `if ($Process.HasExited) { return }` reported
    # containment without ever looking at them.
    #
    # Whether that is RECOVERABLE is a platform fact, so this drives the
    # PRODUCTION DEFAULTS with no injected lookup and pins whichever branch this
    # host is on: where the OS keeps the creator PID on an orphan the sweep must
    # find and contain it; where the OS re-parents orphans there is nothing left
    # to walk, and an empty discovery pass must fail closed instead of reading as
    # containment.
    $orphanFixture = Join-Path $treeSandbox 'orphan-fixture.py'
    $orphanPidFile = Join-Path $treeSandbox 'orphan-pids.json'
    [System.IO.File]::WriteAllText($orphanFixture, $treeSource)
    $orphanProcess = Start-TreeFixtureProcess -PythonExe $fixturePython -ScriptPath $orphanFixture -PidPath $orphanPidFile
    $orphanPids = @(Get-Content -Raw -LiteralPath $orphanPidFile | ConvertFrom-Json)
    $orphanParentId = [int]$orphanPids[0]
    $orphanChildId = [int]$orphanPids[1]
    $orphanProcess.Kill()
    [void]$orphanProcess.WaitForExit(5000)
    Assert-True $orphanProcess.HasExited 'orphan fixture parent has already exited before the helper is entered'
    Assert-True ($null -ne (Get-PlatformProcessIdentity -ProcessId $orphanChildId)) 'orphaned descendant outlives the parent that spawned it'
    # INDEPENDENT oracle. Asking Test-OrphanRediscoverySupported which branch to
    # expect would make the implementation grade its own homework, so this reads
    # the raw OS record instead: Win32_Process.ParentProcessId on Windows, and
    # /proc/<pid>/stat field 4 on Linux, neither routed through the launcher or
    # the platform adapter.
    $orphanRediscoverable = $false
    if ($IsWindows) {
        $orphanCimRow = Get-CimInstance Win32_Process -Filter "ProcessId=$orphanChildId" -ErrorAction SilentlyContinue
        $orphanRediscoverable = ($null -ne $orphanCimRow -and [int]$orphanCimRow.ParentProcessId -eq $orphanParentId)
    }
    else {
        $orphanStatPath = "/proc/$orphanChildId/stat"
        if (Test-Path -LiteralPath $orphanStatPath) {
            $orphanStatRaw = Get-Content -LiteralPath $orphanStatPath -Raw -ErrorAction SilentlyContinue
            if (-not [string]::IsNullOrWhiteSpace($orphanStatRaw)) {
                $orphanStatFields = $orphanStatRaw.Substring($orphanStatRaw.LastIndexOf(')') + 1).Trim() -split '\s+'
                $orphanRediscoverable = ([int]$orphanStatFields[1] -eq $orphanParentId)
            }
        }
    }
    $orphanStopwatch = [System.Diagnostics.Stopwatch]::StartNew()
    # Sampled INSIDE the try, before the sandbox cleanup below: killing the child
    # here and asserting afterwards would let the test's own cleanup satisfy the
    # containment claim the helper is supposed to prove.
    $orphanChildIdentityAfterStop = 'never-sampled'
    $orphanFailure = ''
    try {
        Stop-HostNativeProcessTreeAndWait -Process $orphanProcess -TimeoutMs 5000
        $orphanChildIdentityAfterStop = Get-PlatformProcessIdentity -ProcessId $orphanChildId
    }
    catch {
        $orphanFailure = $_.Exception.Message
    }
    finally {
        $orphanStopwatch.Stop()
        Stop-Process -Id $orphanChildId -Force -ErrorAction SilentlyContinue
    }
    if ($orphanRediscoverable) {
        Assert-True ($null -eq $orphanChildIdentityAfterStop) 'production defaults sweep the descendant of an already-exited parent where the raw OS record still links it'
    }
    else {
        Assert-True ($orphanFailure -match 'not provable via PPID') 'production defaults fail closed for an already-exited parent where the raw OS record no longer links it'
    }
    Assert-True ($orphanStopwatch.Elapsed.TotalSeconds -lt 15) 'already-exited-parent containment stays inside the bounded window'
    Write-TestPass 'production-default containment of an already-exited parent matches this platform''s orphan rediscovery'

    # Case 3b (#513 gate r2 L1-COR-001): drive BOTH sides of that platform gate
    # from this one run by injecting the capability decision, so the POSIX
    # fail-closed path is proven on Windows and the recorded-snapshot escape is
    # proven on POSIX. Without a pre-exit record there is nothing to prove with.
    $noRecordFixture = Join-Path $treeSandbox 'no-record-fixture.py'
    $noRecordPidFile = Join-Path $treeSandbox 'no-record-pids.json'
    [System.IO.File]::WriteAllText($noRecordFixture, $survivorSource)
    $noRecordProcess = Start-TreeFixtureProcess -PythonExe $fixturePython -ScriptPath $noRecordFixture -PidPath $noRecordPidFile
    $noRecordProcess.Kill()
    [void]$noRecordProcess.WaitForExit(5000)
    $noRecordFailure = ''
    try {
        Stop-HostNativeProcessTreeAndWait -Process $noRecordProcess -TimeoutMs 2000 `
            -OrphanRediscoveryProbeFn { $false }
    }
    catch {
        $noRecordFailure = $_.Exception.Message
    }
    Assert-True ($noRecordFailure -match 'not provable via PPID') 'an already-exited parent on a re-parenting platform fails closed instead of reporting an empty pass as containment'
    Assert-True ($noRecordFailure -match 'bounded best-effort sweep, not an escape-proof boundary') 'the fail-closed message states the narrowed contract rather than implying the sweep could have contained it'
    Assert-True ($noRecordFailure -match 'established at launch') 'the fail-closed message names the launch-time OS boundary as the authoritative one'
    Assert-True ($noRecordFailure -match '#517') 'the fail-closed message cites the tracked launch-time containment work'
    Write-TestPass 'already-exited parent on a re-parenting platform fails closed and points at the launch-time boundary'

    # Case 4 (#489 L1-COR-001): the same entry state, but the descendant cannot be
    # killed. Silent success is exactly the defect; it must fail closed instead.
    $orphanFailFixture = Join-Path $treeSandbox 'orphan-fail-fixture.py'
    $orphanFailPidFile = Join-Path $treeSandbox 'orphan-fail-pids.json'
    [System.IO.File]::WriteAllText($orphanFailFixture, $survivorSource)
    $orphanFailProcess = Start-TreeFixtureProcess -PythonExe $fixturePython -ScriptPath $orphanFailFixture -PidPath $orphanFailPidFile
    $orphanFailProcess.Kill()
    [void]$orphanFailProcess.WaitForExit(5000)
    $orphanFailFailure = ''
    try {
        Stop-HostNativeProcessTreeAndWait -Process $orphanFailProcess -TimeoutMs 1000 `
            -OrphanRediscoveryProbeFn { $true } `
            -ChildPidLookup {
                param($parentId)
                if ([int]$parentId -eq $unkillableDescendantId) { return @() }
                return @($unkillableDescendantId)
            }.GetNewClosure() `
            -IdentityProbeFn {
                param($procId)
                if ([int]$procId -eq $unkillableDescendantId) { return $survivorIdentity }
                return $null
            }.GetNewClosure() `
            -StopProcessFn { param($procId) } | Out-Null
    }
    catch {
        $orphanFailFailure = $_.Exception.Message
    }
    Assert-True ($orphanFailFailure -match "left descendant PID\(s\) $unkillableDescendantId running") 'process-tree terminator fails closed when an already-exited parent leaves a live descendant'
    Write-TestPass 'already-exited parent with a surviving descendant fails closed'

    # Case 5 (#489 L1-COR-002): a snapshotted descendant PID can be recycled before
    # the stop resolves it. Terminating it by bare PID would kill an unrelated host
    # process, and the later identity check would still read "our descendant is
    # gone". The stop primitive must therefore be identity-gated too.
    $recycledFixture = Join-Path $treeSandbox 'recycled-fixture.py'
    $recycledPidFile = Join-Path $treeSandbox 'recycled-pids.json'
    [System.IO.File]::WriteAllText($recycledFixture, $survivorSource)
    $recycledProcess = Start-TreeFixtureProcess -PythonExe $fixturePython -ScriptPath $recycledFixture -PidPath $recycledPidFile
    $recycledDescendantId = 424243
    $recycledSnapshotIdentity = [pscustomobject]@{
        ProcessId      = $recycledDescendantId
        BirthToken     = 'snapshot-birth-token'
        ExecutablePath = ''
        CommandLine    = ''
    }
    $recycledCurrentIdentity = [pscustomobject]@{
        ProcessId      = $recycledDescendantId
        BirthToken     = 'recycled-birth-token'
        ExecutablePath = ''
        CommandLine    = ''
    }
    $recycledProbeCalls = [System.Collections.Generic.List[int]]::new()
    $recycledStopCalls = [System.Collections.Generic.List[int]]::new()
    try {
        Stop-HostNativeProcessTreeAndWait -Process $recycledProcess -TimeoutMs 2000 `
            -TreeKillCapabilityProbeFn { $false } `
            -ChildPidLookup {
                param($parentId)
                if ([int]$parentId -eq $recycledDescendantId) { return @() }
                return @($recycledDescendantId)
            }.GetNewClosure() `
            -IdentityProbeFn {
                param($procId)
                if ([int]$procId -ne $recycledDescendantId) { return $null }
                $recycledProbeCalls.Add([int]$procId)
                if ($recycledProbeCalls.Count -eq 1) { return $recycledSnapshotIdentity }
                return $recycledCurrentIdentity
            }.GetNewClosure() `
            -StopProcessFn {
                param($procId)
                $recycledStopCalls.Add([int]$procId)
            }.GetNewClosure()
    }
    finally {
        if (-not $recycledProcess.HasExited) {
            $recycledProcess.Kill()
            [void]$recycledProcess.WaitForExit(5000)
        }
    }
    Assert-True ($recycledStopCalls.Count -eq 0) 'process-tree terminator never terminates a descendant PID whose incarnation changed'
    Assert-True ($recycledProbeCalls.Count -ge 2) 'process-tree terminator re-probes descendant identity before terminating it'
    Write-TestPass 'process-tree terminator revalidates descendant identity before the stop'

    # Case 6 (#489 L1-TG-003): drive the .NET Framework / Windows PowerShell 5.1
    # branch as BEHAVIOUR from this PowerShell 7 run by injecting the capability
    # decision. Source-order assertions cannot show that the fallback really
    # terminates the tree deepest-first and proves it gone.
    $chainFixture = Join-Path $treeSandbox 'chain-fixture.py'
    $chainPidFile = Join-Path $treeSandbox 'chain-pids.json'
    $chainSource = @'
import json
import os
import pathlib
import subprocess
import sys
import time

pid_path = pathlib.Path(sys.argv[1])
depth = int(sys.argv[2]) if len(sys.argv) > 2 else 2

descendants = []
if depth > 0:
    child_path = pid_path.with_name(pid_path.name + "." + str(depth))
    subprocess.Popen([sys.executable, sys.argv[0], str(child_path), str(depth - 1)])
    for _ in range(200):
        try:
            descendants = json.loads(child_path.read_text(encoding="utf-8"))
            break
        except (OSError, ValueError):
            time.sleep(0.05)

pid_path.write_text(json.dumps([os.getpid()] + descendants), encoding="utf-8")
time.sleep(120)
'@
    [System.IO.File]::WriteAllText($chainFixture, $chainSource)
    $chainProcess = Start-TreeFixtureProcess -PythonExe $fixturePython -ScriptPath $chainFixture -PidPath $chainPidFile
    $chainPids = @(Get-Content -Raw -LiteralPath $chainPidFile | ConvertFrom-Json)
    Assert-Equal 3 $chainPids.Count 'fallback fixture records a three-level parent/child/grandchild chain'
    $chainChildId = [int]$chainPids[1]
    $chainGrandchildId = [int]$chainPids[2]
    $fallbackStopCalls = [System.Collections.Generic.List[int]]::new()
    $fallbackStopwatch = [System.Diagnostics.Stopwatch]::StartNew()
    try {
        Stop-HostNativeProcessTreeAndWait -Process $chainProcess -TimeoutMs 5000 `
            -TreeKillCapabilityProbeFn { $false } `
            -StopProcessFn {
                param($procId)
                $fallbackStopCalls.Add([int]$procId)
                Stop-Process -Id ([int]$procId) -Force -ErrorAction SilentlyContinue
            }.GetNewClosure()
    }
    finally {
        $fallbackStopwatch.Stop()
        foreach ($chainPid in $chainPids) {
            Stop-Process -Id ([int]$chainPid) -Force -ErrorAction SilentlyContinue
        }
    }
    Assert-True ($fallbackStopCalls.Contains($chainGrandchildId)) 'forced fallback terminates the deepest descendant through the PID stop primitive'
    Assert-True ($fallbackStopCalls.Contains($chainChildId)) 'forced fallback terminates the intermediate descendant through the PID stop primitive'
    Assert-True ($fallbackStopCalls.IndexOf($chainGrandchildId) -lt $fallbackStopCalls.IndexOf($chainChildId)) 'forced fallback terminates the descendant snapshot deepest-first'
    foreach ($chainPid in $chainPids) {
        Assert-True ($null -eq (Get-PlatformProcessIdentity -ProcessId ([int]$chainPid))) "forced fallback proves PID $chainPid exited"
    }
    Assert-True ($fallbackStopwatch.Elapsed.TotalSeconds -lt 15) 'forced fallback returns inside the bounded cleanup window'
    Write-TestPass 'forced no-Kill(bool) fallback terminates the tree deepest-first and proves it gone'

    # Case 7 (#489 L1-SEC-002): one fixed snapshot is not containment. A snapshotted
    # process can spawn another child before it dies, and that child is absent from
    # both the stop list and the success check unless containment re-enumerates.
    $lateSpawnFixture = Join-Path $treeSandbox 'late-spawn-fixture.py'
    $lateSpawnPidFile = Join-Path $treeSandbox 'late-spawn-pids.json'
    [System.IO.File]::WriteAllText($lateSpawnFixture, $survivorSource)
    $lateSpawnProcess = Start-TreeFixtureProcess -PythonExe $fixturePython -ScriptPath $lateSpawnFixture -PidPath $lateSpawnPidFile
    $lateSpawnParentId = [int]$lateSpawnProcess.Id
    $lateSpawnDescendantId = 424244
    $lateSpawnIdentity = [pscustomobject]@{
        ProcessId      = $lateSpawnDescendantId
        BirthToken     = 'late-spawn-birth-token'
        ExecutablePath = ''
        CommandLine    = ''
    }
    $lateSpawnLookups = [System.Collections.Generic.List[int]]::new()
    $lateSpawnStopped = [System.Collections.Generic.List[int]]::new()
    try {
        Stop-HostNativeProcessTreeAndWait -Process $lateSpawnProcess -TimeoutMs 3000 `
            -TreeKillCapabilityProbeFn { $false } `
            -ChildPidLookup {
                param($parentId)
                if ([int]$parentId -ne $lateSpawnParentId) { return @() }
                $lateSpawnLookups.Add([int]$parentId)
                # Empty on the snapshot pass; the child shows up only afterwards,
                # exactly like a real post-snapshot spawn.
                if ($lateSpawnLookups.Count -eq 1) { return @() }
                return @($lateSpawnDescendantId)
            }.GetNewClosure() `
            -IdentityProbeFn {
                param($procId)
                if ([int]$procId -ne $lateSpawnDescendantId) { return $null }
                if ($lateSpawnStopped.Contains($lateSpawnDescendantId)) { return $null }
                return $lateSpawnIdentity
            }.GetNewClosure() `
            -StopProcessFn {
                param($procId)
                $lateSpawnStopped.Add([int]$procId)
            }.GetNewClosure()
    }
    finally {
        if (-not $lateSpawnProcess.HasExited) {
            $lateSpawnProcess.Kill()
            [void]$lateSpawnProcess.WaitForExit(5000)
        }
    }
    Assert-True ($lateSpawnStopped.Contains($lateSpawnDescendantId)) 'containment re-enumerates and terminates a descendant spawned after the snapshot'
    Assert-True ($lateSpawnLookups.Count -ge 2) 'containment enumerates descendants more than once before declaring success'
    Write-TestPass 'process-tree terminator contains post-snapshot descendants'

    # Case 8 (#489 L1-TG-003): the forced fallback must fail closed on a survivor
    # too - the branch carries the retained races, so its failure mode is pinned.
    $fallbackFailFixture = Join-Path $treeSandbox 'fallback-fail-fixture.py'
    $fallbackFailPidFile = Join-Path $treeSandbox 'fallback-fail-pids.json'
    [System.IO.File]::WriteAllText($fallbackFailFixture, $survivorSource)
    $fallbackFailProcess = Start-TreeFixtureProcess -PythonExe $fixturePython -ScriptPath $fallbackFailFixture -PidPath $fallbackFailPidFile
    $fallbackFailFailure = ''
    try {
        Stop-HostNativeProcessTreeAndWait -Process $fallbackFailProcess -TimeoutMs 1000 `
            -TreeKillCapabilityProbeFn { $false } `
            -ChildPidLookup {
                param($parentId)
                if ([int]$parentId -eq $unkillableDescendantId) { return @() }
                return @($unkillableDescendantId)
            }.GetNewClosure() `
            -IdentityProbeFn {
                param($procId)
                if ([int]$procId -eq $unkillableDescendantId) { return $survivorIdentity }
                return $null
            }.GetNewClosure() `
            -StopProcessFn { param($procId) } | Out-Null
    }
    catch {
        $fallbackFailFailure = $_.Exception.Message
    }
    finally {
        if (-not $fallbackFailProcess.HasExited) {
            $fallbackFailProcess.Kill()
            [void]$fallbackFailProcess.WaitForExit(5000)
        }
    }
    Assert-True ($fallbackFailFailure -match "left descendant PID\(s\) $unkillableDescendantId running") 'forced fallback fails closed when a snapshotted descendant survives'
    Write-TestPass 'forced no-Kill(bool) fallback fails closed on a surviving descendant'

    # Case 9 (#513 gate r2 L1-SEC-001): reaching the deadline is NOT a clean pass.
    # A pass that discovers a descendant and stops it leaves zero survivors, but
    # whatever spawned it can spawn again, so the fixed point was never reached.
    # Checking only `survivors > 0` after the loop reported success on exactly
    # that state. Here every pass discovers one more descendant and successfully
    # stops it, so the survivor set is always empty and a clean pass never
    # happens - the helper must fail closed at the deadline.
    $churnFixture = Join-Path $treeSandbox 'churn-fixture.py'
    $churnPidFile = Join-Path $treeSandbox 'churn-pids.json'
    [System.IO.File]::WriteAllText($churnFixture, $survivorSource)
    $churnProcess = Start-TreeFixtureProcess -PythonExe $fixturePython -ScriptPath $churnFixture -PidPath $churnPidFile
    $churnParentId = [int]$churnProcess.Id
    $churnDiscovered = [System.Collections.Generic.List[int]]::new()
    $churnStopped = [System.Collections.Generic.List[int]]::new()
    $churnFailure = ''
    $churnStopwatch = [System.Diagnostics.Stopwatch]::StartNew()
    try {
        Stop-HostNativeProcessTreeAndWait -Process $churnProcess -TimeoutMs 700 `
            -ChildPidLookup {
                param($parentId)
                if ([int]$parentId -ne $churnParentId) { return @() }
                $churnNextId = 500000 + $churnDiscovered.Count
                $churnDiscovered.Add($churnNextId)
                return @($churnNextId)
            }.GetNewClosure() `
            -IdentityProbeFn {
                param($procId)
                if (-not $churnDiscovered.Contains([int]$procId)) { return $null }
                if ($churnStopped.Contains([int]$procId)) { return $null }
                return [pscustomobject]@{
                    ProcessId      = [int]$procId
                    BirthToken     = 'churn-birth-token'
                    ExecutablePath = ''
                    CommandLine    = ''
                }
            }.GetNewClosure() `
            -StopProcessFn {
                param($procId)
                $churnStopped.Add([int]$procId)
            }.GetNewClosure()
    }
    catch {
        $churnFailure = $_.Exception.Message
    }
    finally {
        $churnStopwatch.Stop()
        if (-not $churnProcess.HasExited) {
            $churnProcess.Kill()
            [void]$churnProcess.WaitForExit(5000)
        }
    }
    Assert-True ($churnFailure -match 'could not be proven contained') 'reaching the deadline without a clean containment pass fails closed even with an empty survivor set'
    Assert-True ($churnDiscovered.Count -ge 2) 'the containment loop kept re-enumerating until the deadline'
    Assert-True ($churnStopped.Count -ge 1) 'every descendant discovered before the deadline was still terminated'
    Assert-True ($churnStopwatch.Elapsed.TotalSeconds -lt 15) 'the no-clean-pass failure is still bounded'
    Write-TestPass 'deadline without a clean containment pass fails closed'

    # Case 10 (#513 gate r2 L1-COR-002): TimeoutMs is ONE end-to-end budget.
    # Discovery used to run before the stopwatch started and the parent wait still
    # received the FULL TimeoutMs, so slow platform enumeration pushed the helper
    # far past its advertised bound. Burn most of the budget inside discovery and
    # assert the whole call still lands inside TimeoutMs rather than inside
    # discovery + TimeoutMs (~1.5s under one budget, ~2.7s under two).
    $budgetFixture = Join-Path $treeSandbox 'budget-fixture.py'
    $budgetPidFile = Join-Path $treeSandbox 'budget-pids.json'
    [System.IO.File]::WriteAllText($budgetFixture, $survivorSource)
    $budgetProcess = Start-TreeFixtureProcess -PythonExe $fixturePython -ScriptPath $budgetFixture -PidPath $budgetPidFile
    $budgetParentId = [int]$budgetProcess.Id
    $budgetTimeoutMs = 1500
    $budgetDiscoveryDelayMs = 1200
    $budgetSurvivorId = 424245
    $budgetIdentity = [pscustomobject]@{
        ProcessId      = $budgetSurvivorId
        BirthToken     = 'budget-birth-token'
        ExecutablePath = ''
        CommandLine    = ''
    }
    $budgetLookups = [System.Collections.Generic.List[int]]::new()
    $budgetFailure = ''
    $budgetStopwatch = [System.Diagnostics.Stopwatch]::StartNew()
    try {
        Stop-HostNativeProcessTreeAndWait -Process $budgetProcess -TimeoutMs $budgetTimeoutMs `
            -ChildPidLookup {
                param($parentId)
                if ([int]$parentId -ne $budgetParentId) { return @() }
                $budgetLookups.Add([int]$parentId)
                # Only the first (snapshot) enumeration is slow, so the cost lands
                # squarely in the window the old code left unmetered.
                if ($budgetLookups.Count -eq 1) { Start-Sleep -Milliseconds $budgetDiscoveryDelayMs }
                return @($budgetSurvivorId)
            }.GetNewClosure() `
            -IdentityProbeFn {
                param($procId)
                if ([int]$procId -eq $budgetSurvivorId) { return $budgetIdentity }
                return $null
            }.GetNewClosure() `
            -StopProcessFn { param($procId) } | Out-Null
    }
    catch {
        $budgetFailure = $_.Exception.Message
    }
    finally {
        $budgetStopwatch.Stop()
        if (-not $budgetProcess.HasExited) {
            $budgetProcess.Kill()
            [void]$budgetProcess.WaitForExit(5000)
        }
    }
    Assert-True ($budgetFailure -match "left descendant PID\(s\) $budgetSurvivorId running") 'a slow-discovery run still fails closed on its surviving descendant'
    Assert-True ($budgetStopwatch.Elapsed.TotalMilliseconds -lt ($budgetTimeoutMs + 500)) 'discovery time counts against TimeoutMs instead of being added to it'
    Write-TestPass 'TimeoutMs is a single end-to-end containment budget'

    # Case 11 (#513 gate r3 HIGH-2, REFUTED by this fixture): a descendant that
    # appears between the enumeration and the stop that follows it is claimed to
    # escape. It does not, because $survivors starts as the WHOLE snapshot, so the
    # first containment pass re-walks every member the stop just killed and finds
    # what hung off them.
    #
    # A REAL three-level chain, with the grandchild hidden from the snapshot only
    # - it is running the whole time, exactly like one spawned a moment after
    # enumeration. The tree-kill capability is forced off so .NET's own recursive
    # kill cannot do the containment for us and mask the helper's logic.
    $escapeeFixture = Join-Path $treeSandbox 'escapee-fixture.py'
    $escapeePidFile = Join-Path $treeSandbox 'escapee-pids.json'
    [System.IO.File]::WriteAllText($escapeeFixture, $chainSource)
    $escapeeProcess = Start-TreeFixtureProcess -PythonExe $fixturePython -ScriptPath $escapeeFixture -PidPath $escapeePidFile
    $escapeePids = @(Get-Content -Raw -LiteralPath $escapeePidFile | ConvertFrom-Json)
    Assert-Equal 3 $escapeePids.Count 'escapee fixture records a three-level parent/child/grandchild chain'
    $escapeeParentId = [int]$escapeePids[0]
    $escapeeChildId = [int]$escapeePids[1]
    $escapeeGrandchildId = [int]$escapeePids[2]
    $escapeeLookups = [System.Collections.Generic.List[int]]::new()
    $escapeeGrandchildAfterStop = 'never-sampled'
    $escapeeFailure = ''
    try {
        Stop-HostNativeProcessTreeAndWait -Process $escapeeProcess -TimeoutMs 5000 `
            -TreeKillCapabilityProbeFn { $false } `
            -ChildPidLookup {
                param($parentId)
                $escapeeLookups.Add([int]$parentId)
                # Calls 1-2 are the initial snapshot: report the child only, so the
                # grandchild is outside the set the stop below operates on.
                if ($escapeeLookups.Count -le 2) {
                    if ([int]$parentId -eq $escapeeParentId) { return @($escapeeChildId) }
                    return @()
                }
                return @(Get-PlatformChildProcessIds -ParentProcessId ([int]$parentId))
            }.GetNewClosure()
        $escapeeGrandchildAfterStop = Get-PlatformProcessIdentity -ProcessId $escapeeGrandchildId
    }
    catch {
        $escapeeFailure = $_.Exception.Message
    }
    finally {
        foreach ($escapeePid in $escapeePids) {
            Stop-Process -Id ([int]$escapeePid) -Force -ErrorAction SilentlyContinue
        }
    }
    Assert-Equal '' $escapeeFailure 'the re-enumerating fixed point contains the post-enumeration descendant instead of failing closed on it'
    Assert-True ($null -eq $escapeeGrandchildAfterStop) 'a descendant missed by the snapshot is still discovered, stopped and proven gone'
    Assert-True ($escapeeLookups.Count -gt 2) 'containment re-enumerated past the snapshot that missed it'
    Write-TestPass 'a descendant appearing after enumeration is caught by the clean-pass fixed point'

    # Case 12 (#513 review P2): platform enumeration failure is ignorance, not
    # proof that the tree is empty. Preserve the failing parent PID in the error
    # so callers can distinguish this trust-boundary failure from a clean pass.
    $lookupFailureFixture = Join-Path $treeSandbox 'lookup-failure-fixture.py'
    $lookupFailurePidFile = Join-Path $treeSandbox 'lookup-failure-pids.json'
    [System.IO.File]::WriteAllText($lookupFailureFixture, $survivorSource)
    $lookupFailureProcess = Start-TreeFixtureProcess -PythonExe $fixturePython -ScriptPath $lookupFailureFixture -PidPath $lookupFailurePidFile
    $lookupFailure = ''
    try {
        Stop-HostNativeProcessTreeAndWait -Process $lookupFailureProcess -TimeoutMs 1000 `
            -ChildPidLookup { param($parentId); throw 'simulated platform child enumeration failure' }
    } catch {
        $lookupFailure = $_.Exception.Message
    } finally {
        if (-not $lookupFailureProcess.HasExited) {
            $lookupFailureProcess.Kill()
            [void]$lookupFailureProcess.WaitForExit(5000)
        }
    }
    Assert-True ($lookupFailure -match "Process tree child enumeration failed for PID $($lookupFailureProcess.Id)") 'process-tree cleanup fails closed with PID context when child enumeration is unavailable'
    Write-TestPass 'process-tree cleanup fails closed on child enumeration failure'
}
finally {
    Remove-TestSandbox -Path $treeSandbox
}

# ---------------------------------------------------------------------------
# Launch-time OS containment boundary (issue #522)
# ---------------------------------------------------------------------------

# Test J1: real Windows Job Object boundary - membership is authoritative and
# Stop-HostNativeJobBoundary proves an empty set for a real two-process tree.
if (Test-HostNativeJobBoundarySupported) {
    $jobSandbox = New-TestSandbox -Prefix 'hn-job-boundary'
    try {
        $jobFixturePython = Resolve-PlatformSystemPython
        if ([string]::IsNullOrWhiteSpace($jobFixturePython)) {
            throw 'job boundary containment regressions require a working Python interpreter'
        }
        $jobFixture = Join-Path $jobSandbox 'job-tree-fixture.py'
        $jobPidFile = Join-Path $jobSandbox 'job-tree-pids.json'
        $jobFixtureSource = @'
import json
import os
import pathlib
import subprocess
import sys
import time

child = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(120)"])
pathlib.Path(sys.argv[1]).write_text(
    json.dumps([os.getpid(), child.pid]), encoding="utf-8"
)
time.sleep(120)
'@
        [System.IO.File]::WriteAllText($jobFixture, $jobFixtureSource)

        $jobName = Get-HostNativeJobBoundaryName -Name ('test-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
        $jobHandle = New-HostNativeJobBoundary -Name $jobName
        try {
            $jobStartInfo = [System.Diagnostics.ProcessStartInfo]::new()
            $jobStartInfo.FileName = $jobFixturePython
            $jobStartInfo.UseShellExecute = $false
            $jobStartInfo.CreateNoWindow = $true
            [void]$jobStartInfo.ArgumentList.Add($jobFixture)
            [void]$jobStartInfo.ArgumentList.Add($jobPidFile)
            $jobRoot = [System.Diagnostics.Process]::new()
            $jobRoot.StartInfo = $jobStartInfo
            if (-not $jobRoot.Start()) { throw 'job boundary fixture did not start' }
            Add-HostNativeJobBoundaryProcess -Handle $jobHandle -ProcessId $jobRoot.Id
            Grant-HostNativeJobBoundaryAnchor -Handle $jobHandle -ProcessId $jobRoot.Id
            for ($attempt = 0; $attempt -lt 200; $attempt++) {
                if (Test-Path -LiteralPath $jobPidFile -PathType Leaf) { break }
                Start-Sleep -Milliseconds 50
            }
            $jobTreePids = @(Get-Content -Raw -LiteralPath $jobPidFile | ConvertFrom-Json)
            Assert-Equal 2 $jobTreePids.Count 'job boundary fixture records exactly its parent and child PIDs'
            $membership = @(Get-HostNativeJobBoundaryProcessIds -Handle $jobHandle)
            foreach ($treePid in $jobTreePids) {
                Assert-True ($membership -contains [int]$treePid) "job membership is authoritative: contains fixture PID $treePid"
            }
        }
        finally {
            Close-HostNativeJobBoundary -Handle $jobHandle
        }
        # The anchor handle inside the fixture root keeps the job alive after our
        # handle closes; the named stop must find it, terminate the whole
        # membership set, and prove it empty.
        $jobStopReport = Stop-HostNativeJobBoundary -Name $jobName -TimeoutMs 5000
        Assert-True $jobStopReport.Found 'named job stop finds the anchored job after the launcher handle closed'
        Assert-True $jobStopReport.Proven 'named job stop proves an empty membership set'
        foreach ($treePid in $jobTreePids) {
            Assert-True ($null -eq (Get-PlatformProcessIdentity -ProcessId ([int]$treePid))) "job stop proves PID $treePid exited"
        }
        $jobGoneReport = Stop-HostNativeJobBoundary -Name $jobName -TimeoutMs 1000
        Assert-True (-not $jobGoneReport.Found) 'a fully terminated job ceases to exist (proven-dead by construction)'
        Assert-True $jobGoneReport.Proven 'a missing job reports proven'
        Write-TestPass 'Windows job boundary: authoritative membership, anchored lifetime, proven terminate (#522)'
    }
    finally {
        Remove-TestSandbox -Path $jobSandbox
    }
}
else {
    Assert-True (-not (Test-HostNativeJobBoundarySupported)) 'job boundary reports unsupported off Windows'
    Write-TestPass 'job boundary honestly reports unsupported on this platform (#517 tracks the POSIX boundary)'
}

# Test J2: Invoke-HostNativeBoundedProcess - a timed-out tree leaves no
# survivors on either platform (job on Windows, sweep fallback elsewhere).
$boundedSandbox = New-TestSandbox -Prefix 'hn-bounded'
try {
    $boundedPython = Resolve-PlatformSystemPython
    if ([string]::IsNullOrWhiteSpace($boundedPython)) {
        throw 'bounded process containment regressions require a working Python interpreter'
    }
    $boundedFixture = Join-Path $boundedSandbox 'bounded-tree-fixture.py'
    $boundedPidFile = Join-Path $boundedSandbox 'bounded-tree-pids.json'
    $boundedSource = @'
import json
import os
import pathlib
import subprocess
import sys
import time

child = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(120)"])
pathlib.Path(sys.argv[1]).write_text(
    json.dumps([os.getpid(), child.pid]), encoding="utf-8"
)
time.sleep(120)
'@
    [System.IO.File]::WriteAllText($boundedFixture, $boundedSource)
    $boundedResult = Invoke-HostNativeBoundedProcess `
        -FilePath $boundedPython `
        -ArgumentList @($boundedFixture, $boundedPidFile) `
        -TimeoutSec 2
    Assert-True $boundedResult.TimedOut 'bounded process reports the timeout'
    Assert-True ($null -eq $boundedResult.TerminationFailure) 'bounded process termination is proven, not best-effort'
    $boundedPids = @(Get-Content -Raw -LiteralPath $boundedPidFile | ConvertFrom-Json)
    Assert-Equal 2 $boundedPids.Count 'bounded fixture records exactly its parent and child PIDs'
    foreach ($boundedPid in $boundedPids) {
        Assert-True ($null -eq (Get-PlatformProcessIdentity -ProcessId ([int]$boundedPid))) "bounded timeout leaves no survivor PID $boundedPid"
    }
    if (Test-HostNativeJobBoundarySupported) {
        Assert-Equal 'job' $boundedResult.Boundary 'bounded process used the job boundary on Windows'
    } else {
        Assert-Equal 'sweep' $boundedResult.Boundary 'bounded process disclosed the sweep fallback off Windows'
    }
    # Success path: exit code and output still flow through the boundary.
    $boundedOk = Invoke-HostNativeBoundedProcess `
        -FilePath $boundedPython `
        -ArgumentList @('-c', 'print("bounded-ok")') `
        -TimeoutSec 30
    Assert-Equal 0 $boundedOk.ExitCode 'bounded success path forwards the exit code'
    Assert-True ($boundedOk.StdOut -match 'bounded-ok') 'bounded success path forwards stdout'
    Write-TestPass 'bounded child helper contains a timed-out tree and forwards the success path (#522)'
}
finally {
    Remove-TestSandbox -Path $boundedSandbox
}

# Test J3: Start-HostNativeService boundary contract, proven with mocked ops -
# ordering create->assign->anchor->close, the sidecar record, and the
# fail-closed teardown when the anchor cannot be established.
$serviceSandbox = New-TestSandbox -Prefix 'hn-service-boundary'
# Earlier wiring tests shadow Start-HostNativeService with stubs; restore the real module.
. $modulePath
try {
    $servicePython = Resolve-PlatformSystemPython
    $serviceRunDir = Join-Path $serviceSandbox 'scripts\.run'
    New-Item -ItemType Directory -Path $serviceRunDir -Force | Out-Null
    $script:jobOpsCalls = [System.Collections.ArrayList]::new()
    $mockOps = @{
        Supported = { $true }
        Create    = { param($jobName) [void]$script:jobOpsCalls.Add("create:$jobName"); return ([IntPtr]::new(42)) }
        Assign    = { param($handle, $childId) [void]$script:jobOpsCalls.Add("assign:$childId") }
        Anchor    = { param($handle, $childId) [void]$script:jobOpsCalls.Add("anchor:$childId") }
        Terminate = { param($handle) [void]$script:jobOpsCalls.Add('terminate') }
        Close     = { param($handle) [void]$script:jobOpsCalls.Add('close') }
    }
    $serviceInfo = Start-HostNativeService `
        -Name 'boundary-contract' `
        -WorkingDirectory $serviceSandbox `
        -FilePath $servicePython `
        -ArgumentList @('-c', 'import time; time.sleep(60)') `
        -RunDir $serviceRunDir `
        -DetachProbeFn { param($processId) $true } `
        -JobBoundaryOps $mockOps
    try {
        $expectedJobName = Get-HostNativeJobBoundaryName -Name 'boundary-contract'
        Assert-Equal "create:$expectedJobName" $script:jobOpsCalls[0] 'service boundary creates the named job first'
        Assert-Equal "assign:$($serviceInfo.Pid)" $script:jobOpsCalls[1] 'service boundary assigns the child before anything else touches it'
        Assert-Equal "anchor:$($serviceInfo.Pid)" $script:jobOpsCalls[2] 'service boundary anchors the job into the child'
        Assert-Equal 'close' $script:jobOpsCalls[3] 'service boundary closes its own handle after the anchor'
        Assert-True ($script:jobOpsCalls -notcontains 'terminate') 'a healthy launch never terminates the job'
        $sidecar = Join-Path $serviceRunDir 'boundary-contract.job'
        Assert-True (Test-Path -LiteralPath $sidecar) 'service launch records the job sidecar for the stop path'
        Assert-Equal $expectedJobName ((Get-Content -LiteralPath $sidecar | Select-Object -First 1).Trim()) 'job sidecar records the exact boundary name'
    }
    finally {
        Stop-Process -Id $serviceInfo.Pid -Force -ErrorAction SilentlyContinue
    }

    # Anchor failure must terminate the just-started tree and throw: a service
    # the launcher cannot contain must not run.
    $script:jobOpsCalls = [System.Collections.ArrayList]::new()
    $failingOps = @{
        Supported = { $true }
        Create    = { param($jobName) [void]$script:jobOpsCalls.Add("create:$jobName"); return ([IntPtr]::new(42)) }
        Assign    = { param($handle, $childId) [void]$script:jobOpsCalls.Add("assign:$childId") }
        Anchor    = { param($handle, $childId) throw 'simulated anchor failure' }
        Terminate = { param($handle) [void]$script:jobOpsCalls.Add('terminate') }
        Close     = { param($handle) [void]$script:jobOpsCalls.Add('close') }
    }
    $anchorFailure = ''
    try {
        Start-HostNativeService `
            -Name 'boundary-anchor-fail' `
            -WorkingDirectory $serviceSandbox `
            -FilePath $servicePython `
            -ArgumentList @('-c', 'import time; time.sleep(60)') `
            -RunDir $serviceRunDir `
            -DetachProbeFn { param($processId) $true } `
            -JobBoundaryOps $failingOps | Out-Null
    }
    catch {
        $anchorFailure = $_.Exception.Message
    }
    Assert-True ($anchorFailure -match 'simulated anchor failure') 'anchor failure propagates as a launch failure'
    Assert-True ($script:jobOpsCalls -contains 'terminate') 'anchor failure terminates the partially contained tree'
    Assert-True ($script:jobOpsCalls -contains 'close') 'anchor failure still closes the launcher handle'
    Assert-True (-not (Test-Path -LiteralPath (Join-Path $serviceRunDir 'boundary-anchor-fail.job'))) 'a failed boundary never records a sidecar'
    Write-TestPass 'service boundary contract: ordering, sidecar, and fail-closed anchor teardown (#522)'
}
finally {
    Remove-TestSandbox -Path $serviceSandbox
}

# Test J4: Stop-HostNativeService is job-first - a recorded boundary makes the
# stop authoritative and skips the PPID walk; an unsupported-platform report
# falls back to the legacy walk.
$stopSandbox = New-TestSandbox -Prefix 'hn-job-stop'
. $modulePath
try {
    $stopRunDir = Join-Path $stopSandbox 'scripts\.run'
    New-Item -ItemType Directory -Path $stopRunDir -Force | Out-Null
    Set-Content -LiteralPath (Join-Path $stopRunDir 'svc.pid') -Value '4242'
    Set-Content -LiteralPath (Join-Path $stopRunDir 'svc.job') -Value 'Local\aibim-job-svc'
    $script:walkInvoked = $false
    $stopped = Stop-HostNativeService -Name 'svc' -RunDir $stopRunDir `
        -ChildPidLookup { param($parentId) $script:walkInvoked = $true; @() } `
        -StopProcessFn { param($procId) $script:walkInvoked = $true } `
        -JobStopFn { param($jobName)
            Assert-Equal 'Local\aibim-job-svc' $jobName 'job-first stop opens the recorded boundary name'
            [pscustomobject]@{ Found = $true; MemberPids = @(4242); Proven = $true; Supported = $true }
        }
    Assert-True $stopped 'job-first stop reports success'
    Assert-True (-not $script:walkInvoked) 'job-first stop never falls back to the PPID walk when the boundary is authoritative'
    Assert-True (-not (Test-Path -LiteralPath (Join-Path $stopRunDir 'svc.pid'))) 'job-first stop removes the pid file'
    Assert-True (-not (Test-Path -LiteralPath (Join-Path $stopRunDir 'svc.job'))) 'job-first stop removes the job sidecar'

    # Unsupported platform report -> legacy PPID walk still runs.
    Set-Content -LiteralPath (Join-Path $stopRunDir 'svc2.pid') -Value '4343'
    Set-Content -LiteralPath (Join-Path $stopRunDir 'svc2.job') -Value 'Local\aibim-job-svc2'
    $script:walkStops = @()
    $stopped2 = Stop-HostNativeService -Name 'svc2' -RunDir $stopRunDir `
        -ChildPidLookup { param($parentId) @() } `
        -StopProcessFn { param($procId) $script:walkStops += [int]$procId } `
        -JobStopFn { param($jobName) [pscustomobject]@{ Found = $false; MemberPids = @(); Proven = $false; Supported = $false } }
    Assert-True $stopped2 'unsupported boundary report falls back to the legacy walk'
    Assert-True ($script:walkStops -contains 4343) 'legacy walk still stops the recorded pid'
    Assert-True (-not (Test-Path -LiteralPath (Join-Path $stopRunDir 'svc2.job'))) 'fallback removes the stale job sidecar'
    Write-TestPass 'stop path is job-first with an honest legacy fallback (#522)'
}
finally {
    Remove-TestSandbox -Path $stopSandbox
}

# Test: conversion service launcher honours the STORAGE_ROOT invariant (#626)
#
# 這一組直接跑 bim-streaming-server\scripts\start-host-native-conversion-service.ps1。
# STORAGE_ROOT 的解析全部發生在啟動 python 之前,而 -PythonExe 指向一個不存在的執行檔,
# 所以四種情境都能在「服務真的綁 port」之前觀察完畢——不啟動任何服務、不綁任何 port。
$conversionLauncherPath = Join-Path $repoRoot 'bim-streaming-server\scripts\start-host-native-conversion-service.ps1'
$conversionLauncherText = Get-Content -LiteralPath $conversionLauncherPath -Raw
$currentPwshPath = (Get-Process -Id $PID).Path

function Invoke-ConversionLauncherProbe {
    param(
        [AllowNull()][string] $StorageRoot,
        [AllowNull()][string] $RuntimeStorageRoot
    )

    $managedNames = @('STORAGE_ROOT', 'RUNTIME_STORAGE_ROOT')
    $saved = @{}
    foreach ($name in $managedNames) {
        $saved[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
    }
    try {
        # 先清乾淨:CI runner 或操作者 shell 殘留的值會讓「未設定」情境失去意義。
        [Environment]::SetEnvironmentVariable('STORAGE_ROOT', $StorageRoot, 'Process')
        [Environment]::SetEnvironmentVariable('RUNTIME_STORAGE_ROOT', $RuntimeStorageRoot, 'Process')
        $output = & $currentPwshPath -NoProfile -NonInteractive -File $conversionLauncherPath `
            -PythonExe 'aibim-nonexistent-python-626' 2>&1 | Out-String
        return [pscustomobject]@{ ExitCode = [int]$LASTEXITCODE; Output = [string]$output }
    }
    finally {
        foreach ($name in $managedNames) {
            [Environment]::SetEnvironmentVariable($name, $saved[$name], 'Process')
        }
    }
}

# 靜態面:convenience 預設必須真的消失,否則行為測試只證明「當下這台機器剛好沒踩到」。
Assert-True (-not ($conversionLauncherText -match 'Join-Path\s+\$repoRoot\s+"storage"')) `
    'conversion launcher no longer guesses <repoRoot>\storage as STORAGE_ROOT'
Assert-True ($conversionLauncherText -match 'RUNTIME_STORAGE_ROOT') `
    'conversion launcher knows the RUNTIME_STORAGE_ROOT fallback name'
Write-TestPass 'conversion launcher dropped the guessed STORAGE_ROOT default (#626)'

$conversionProbeSandbox = New-TestSandbox -Prefix 'hn-conv-storage-root'
try {
    $runtimeStorageRoot = Join-Path $conversionProbeSandbox 'runtime-storage'
    New-Item -ItemType Directory -Path $runtimeStorageRoot -Force | Out-Null

    # 1) 兩個都沒設 -> fail closed,訊息要同時點名兩個 env 與不變式所在位置。
    $bothMissing = Invoke-ConversionLauncherProbe -StorageRoot $null -RuntimeStorageRoot $null
    Assert-Equal 2 $bothMissing.ExitCode 'both roots missing -> refuses to start with exit 2'
    Assert-True ($bothMissing.Output -match 'STORAGE_ROOT is not configured') 'refusal names STORAGE_ROOT'
    Assert-True ($bothMissing.Output -match 'RUNTIME_STORAGE_ROOT is not set') 'refusal names RUNTIME_STORAGE_ROOT'
    Assert-True ($bothMissing.Output -match 'host-native-launcher\.ps1') 'refusal points at the invariant comment'
    Assert-True (-not ($bothMissing.Output -match '(?m)^STORAGE_ROOT: ')) 'refusal never resolves a guessed root'
    Write-TestPass 'conversion launcher fails closed when neither storage root is configured (#626)'

    # 2) 只有 RUNTIME_STORAGE_ROOT -> 採用它,並標示來源。之後才因為假的 python 失敗,
    #    代表解析階段已完成而服務從未啟動。
    $runtimeOnly = Invoke-ConversionLauncherProbe -StorageRoot $null -RuntimeStorageRoot $runtimeStorageRoot
    Assert-True ($runtimeOnly.Output -match [regex]::Escape("STORAGE_ROOT: $runtimeStorageRoot (source: RUNTIME_STORAGE_ROOT)")) `
        'missing STORAGE_ROOT adopts RUNTIME_STORAGE_ROOT and reports the source'
    Assert-True ($runtimeOnly.ExitCode -ne 2) 'adopting the runtime root is not a refusal'
    Write-TestPass 'conversion launcher adopts RUNTIME_STORAGE_ROOT when STORAGE_ROOT is absent (#626)'

    # 3) 兩個都設但指向不同目錄 -> 拒絕啟動,訊息要引兩個實際值。
    $divergentRoot = Join-Path $conversionProbeSandbox 'explicit-storage'
    $mismatch = Invoke-ConversionLauncherProbe -StorageRoot $divergentRoot -RuntimeStorageRoot $runtimeStorageRoot
    Assert-Equal 2 $mismatch.ExitCode 'divergent roots -> refuses to start with exit 2'
    Assert-True ($mismatch.Output -match [regex]::Escape("STORAGE_ROOT='$divergentRoot'")) 'refusal quotes the STORAGE_ROOT value'
    Assert-True ($mismatch.Output -match [regex]::Escape("RUNTIME_STORAGE_ROOT='$runtimeStorageRoot'")) 'refusal quotes the RUNTIME_STORAGE_ROOT value'
    Assert-True (-not (Test-Path -LiteralPath $divergentRoot)) 'refusal never materialises the divergent sandbox'
    Write-TestPass 'conversion launcher refuses a STORAGE_ROOT/RUNTIME_STORAGE_ROOT mismatch (#626)'

    # 4) 只差尾端分隔符與大小寫的同一個目錄不得誤擋(Windows 路徑不分大小寫)。
    $sameRootNoisySpelling = $runtimeStorageRoot.ToUpperInvariant() + '\'
    $equivalent = Invoke-ConversionLauncherProbe -StorageRoot $sameRootNoisySpelling -RuntimeStorageRoot $runtimeStorageRoot
    Assert-True ($equivalent.ExitCode -ne 2) 'trailing separator / case differences are not a mismatch'
    Assert-True ($equivalent.Output -match '\(source: STORAGE_ROOT\)') 'equivalent spellings keep the explicit STORAGE_ROOT'
    Write-TestPass 'conversion launcher normalises trailing separators and case before asserting (#626)'
}
finally {
    Remove-TestSandbox -Path $conversionProbeSandbox
}

# ---------------------------------------------------------------------------
# #640: an orphaned Kit child is invisible to pid-file liveness, so Phase 4c
# started a second instance into a live one. Two halves are proven here:
#   (1) a launch RECORDS the ports its process tree will own, and that record
#       outlives the pid file that Remove-StalePidFile is right to delete;
#   (2) Get-HostNativeOrphanListener turns that record into a refusal signal.
#
# Everything below runs on fixtures and injected probes. No Kit is launched, no
# real port in 49100-49110 (or any other real port) is bound, and the only real
# processes started are short-lived Python sleeps that bind nothing.
# ---------------------------------------------------------------------------

# Test O1: Start-HostNativeService records the declared ports as a sidecar, and
# a launch that declares none clears a previous claim instead of inheriting it.
. $modulePath
$portRecordSandbox = New-TestSandbox -Prefix 'hn-port-record'
try {
    $portRunDir = Join-Path $portRecordSandbox 'scripts\.run'
    New-Item -ItemType Directory -Path $portRunDir -Force | Out-Null
    $portProbePython = Resolve-PlatformSystemPython
    # Supported=$false keeps the launch off real Job Objects; the other keys are
    # present only because the parameter contract requires the whole table.
    $noBoundaryOps = @{
        Supported = { $false }
        Create    = { param($jobName) throw 'unsupported boundary must never create' }
        Assign    = { param($handle, $childId) throw 'unsupported boundary must never assign' }
        Anchor    = { param($handle, $childId) throw 'unsupported boundary must never anchor' }
        Terminate = { param($handle) throw 'unsupported boundary must never terminate' }
        Close     = { param($handle) throw 'unsupported boundary must never close' }
    }
    $portedInfo = Start-HostNativeService `
        -Name 'ported-service' `
        -WorkingDirectory $portRecordSandbox `
        -FilePath $portProbePython `
        -ArgumentList @('-c', 'import time; time.sleep(60)') `
        -RunDir $portRunDir `
        -ListenPorts @(49150, 49100, 49100) `
        -DetachProbeFn { param($processId) $true } `
        -JobBoundaryOps $noBoundaryOps
    try {
        $portSidecar = Join-Path $portRunDir 'ported-service.ports'
        Assert-True (Test-Path -LiteralPath $portSidecar -PathType Leaf) 'a launch that declares ports records the sidecar'
        Assert-Equal '49100,49150' ((Get-HostNativeServiceListenPorts -Name 'ported-service' -RunDir $portRunDir) -join ',') 'the recorded claim is de-duplicated and sorted'
    }
    finally {
        Stop-Process -Id $portedInfo.Pid -Force -ErrorAction SilentlyContinue
    }

    # A service that declares no ports must not inherit the previous claim.
    $portlessInfo = Start-HostNativeService `
        -Name 'ported-service' `
        -WorkingDirectory $portRecordSandbox `
        -FilePath $portProbePython `
        -ArgumentList @('-c', 'import time; time.sleep(60)') `
        -RunDir $portRunDir `
        -DetachProbeFn { param($processId) $true } `
        -JobBoundaryOps $noBoundaryOps
    try {
        Assert-True (-not (Test-Path -LiteralPath (Join-Path $portRunDir 'ported-service.ports'))) 'a portless launch clears the previous port claim'
        Assert-Equal '' ((Get-HostNativeServiceListenPorts -Name 'ported-service' -RunDir $portRunDir) -join ',') 'no sidecar reads back as no recorded ports'
    }
    finally {
        Stop-Process -Id $portlessInfo.Pid -Force -ErrorAction SilentlyContinue
    }
    Write-TestPass 'host-native launch records the ports its tree will own (#640)'
}
finally {
    Remove-TestSandbox -Path $portRecordSandbox
}

# Test O2: Remove-StalePidFile still removes the stale pid file, and deliberately
# leaves the port claim behind - that record is the only remaining trace of an
# orphaned child, and deleting it here is exactly how #640 lost the orphan.
$staleRecordSandbox = New-TestSandbox -Prefix 'hn-stale-ports'
try {
    $staleRunDir = Join-Path $staleRecordSandbox 'scripts\.run'
    New-Item -ItemType Directory -Path $staleRunDir -Force | Out-Null
    Set-Content -LiteralPath (Join-Path $staleRunDir 'bim-streaming-server.pid') -Value '216268'
    Set-Content -LiteralPath (Join-Path $staleRunDir 'bim-streaming-server.ports') -Value "49100`n49150"
    $removed = Remove-StalePidFile -Name 'bim-streaming-server' -RunDir $staleRunDir -GetProcessFn { param($procId) $null }
    Assert-True $removed 'a dead recorded pid is still cleaned up'
    Assert-True (-not (Test-Path -LiteralPath (Join-Path $staleRunDir 'bim-streaming-server.pid'))) 'the stale pid file is removed'
    Assert-Equal '49100,49150' ((Get-HostNativeServiceListenPorts -Name 'bim-streaming-server' -RunDir $staleRunDir) -join ',') 'the port claim survives stale-pid cleanup'
    Write-TestPass 'stale-pid cleanup keeps the port claim that outlives the launcher (#640)'
}
finally {
    Remove-TestSandbox -Path $staleRecordSandbox
}

# Test O3: Get-HostNativeOrphanListener - the start decision matrix.
$orphanSandbox = New-TestSandbox -Prefix 'hn-orphan-listener'
try {
    $orphanRunDir = Join-Path $orphanSandbox 'scripts\.run'
    New-Item -ItemType Directory -Path $orphanRunDir -Force | Out-Null
    Set-Content -LiteralPath (Join-Path $orphanRunDir 'bim-streaming-server.ports') -Value "49100`n49150"
    # The measured #640 shape: launcher 216268 gone, orphaned Kit 216306 still
    # holding a spectator signal port, pid file already deleted as stale.
    $orphanPortOwners = @{ 49100 = $null; 49150 = 216306 }
    $orphanProbe = { param($port) $orphanPortOwners[[int]$port] }
    $noProcess = { param($procId) $null }
    $noChildren = { param($parentId) @() }
    # SettleTimeoutMs 0 keeps every "should report" case to a single observation;
    # the settle window itself is proven separately at the end of this block.
    $now = @{ SettleTimeoutMs = 0; SleepFn = { param($milliseconds) } }

    $reported = Get-HostNativeOrphanListener -Name 'bim-streaming-server' -RunDir $orphanRunDir @now `
        -PortLookupFn $orphanProbe -GetProcessFn $noProcess -ChildPidLookup $noChildren
    Assert-True ($null -ne $reported) 'a surviving holder with no pid file is reported'
    Assert-Equal '49150' (@($reported.Ports) -join ',') 'the report names the port that is actually held'
    Assert-Equal '216306' (@($reported.ProcessIds) -join ',') 'the report names the holding pid, not the recorded launcher pid'
    Assert-Equal '49100,49150' (@($reported.RecordedPorts) -join ',') 'the report carries the claim it checked'

    # Same answer when the pid file still exists but its process is gone: that is
    # the window between the launcher dying and Phase 2 deleting the pid file.
    Set-Content -LiteralPath (Join-Path $orphanRunDir 'bim-streaming-server.pid') -Value '216268'
    $deadRecorded = Get-HostNativeOrphanListener -Name 'bim-streaming-server' -RunDir $orphanRunDir @now `
        -PortLookupFn $orphanProbe -GetProcessFn $noProcess -ChildPidLookup $noChildren
    Assert-True ($null -ne $deadRecorded) 'a dead recorded pid cannot account for a live holder'
    Assert-Equal '216306' (@($deadRecorded.ProcessIds) -join ',') 'the dead launcher pid is not treated as the holder'

    # Healthy idempotent re-run: the recorded launcher is alive and the holder is
    # its child, so nothing is reported and Phase 4c keeps its existing skip path.
    $liveTree = { param($parentId) if ([int]$parentId -eq 216268) { @(216306) } else { @() } }
    $liveProcess = { param($procId) @{ Id = [int]$procId } }
    $healthy = Get-HostNativeOrphanListener -Name 'bim-streaming-server' -RunDir $orphanRunDir @now `
        -PortLookupFn $orphanProbe -GetProcessFn $liveProcess -ChildPidLookup $liveTree
    Assert-True ($null -eq $healthy) 'a live launcher accounts for its own child'

    # A live launcher does NOT account for an unrelated holder: two instances.
    $strangerOwners = @{ 49100 = $null; 49150 = 188705 }
    $twoInstances = Get-HostNativeOrphanListener -Name 'bim-streaming-server' -RunDir $orphanRunDir @now `
        -PortLookupFn { param($port) $strangerOwners[[int]$port] } -GetProcessFn $liveProcess -ChildPidLookup $liveTree
    Assert-True ($null -ne $twoInstances) 'a holder outside our tree is reported even when our tree is alive'
    Assert-Equal '188705' (@($twoInstances.ProcessIds) -join ',') 'the unrelated holder is named'

    # Get-PlatformTcpListenerPid returns -1 for "occupied, owner not visible".
    # Unknown ownership must fail closed, never read as free.
    $invisibleOwners = @{ 49100 = -1; 49150 = $null }
    $invisible = Get-HostNativeOrphanListener -Name 'bim-streaming-server' -RunDir $orphanRunDir @now `
        -PortLookupFn { param($port) $invisibleOwners[[int]$port] } -GetProcessFn $liveProcess -ChildPidLookup $liveTree
    Assert-True ($null -ne $invisible) 'an occupied port with an invisible owner fails closed'
    Assert-Equal '49100' (@($invisible.Ports) -join ',') 'the invisible-owner port is the one reported'
    Assert-Equal '-1' (@($invisible.ProcessIds) -join ',') 'the sentinel owner is surfaced rather than swallowed'

    # Free ports mean no report, whatever the claim says.
    $allFree = Get-HostNativeOrphanListener -Name 'bim-streaming-server' -RunDir $orphanRunDir @now `
        -PortLookupFn { param($port) $null } -GetProcessFn $noProcess -ChildPidLookup $noChildren
    Assert-True ($null -eq $allFree) 'a recorded claim with every port free is not an orphan'

    # The probe set is the UNION of the recorded claim and this run's expectation,
    # so neither a config change nor a first-ever launch can hide a holder.
    $script:probedPorts = @()
    $unionProbe = {
        param($port)
        $script:probedPorts += [int]$port
        if ([int]$port -eq 49101) { return 4242 }
        return $null
    }
    $union = Get-HostNativeOrphanListener -Name 'bim-streaming-server' -RunDir $orphanRunDir @now `
        -ExpectedPorts @(49101) -PortLookupFn $unionProbe -GetProcessFn $noProcess -ChildPidLookup $noChildren
    Assert-Equal '49100,49101,49150' (@($script:probedPorts | Sort-Object -Unique) -join ',') 'recorded and expected ports are both probed'
    Assert-True ($null -ne $union) 'a holder on a port only this run expects is still reported'
    Assert-Equal '49101' (@($union.Ports) -join ',') 'the newly expected port is the one reported'

    # Nothing recorded and nothing expected: no probe, no verdict, no refusal.
    $script:probedPorts = @()
    $emptyRunDir = Join-Path $orphanSandbox 'empty-run'
    New-Item -ItemType Directory -Path $emptyRunDir -Force | Out-Null
    $nothing = Get-HostNativeOrphanListener -Name 'bim-streaming-server' -RunDir $emptyRunDir @now `
        -PortLookupFn $unionProbe -GetProcessFn $noProcess -ChildPidLookup $noChildren
    Assert-True ($null -eq $nothing) 'no claim and no expectation is not an orphan'
    Assert-Equal 0 @($script:probedPorts).Count 'with no ports to check the detector probes nothing'

    # Settle window: Phase 4c also reaches this gate immediately after stopping
    # the previous tree itself, and a force-killed listener needs a moment to
    # release its socket. A holder that is gone on a later pass is teardown, not
    # an orphan; one still there when the budget runs out is an orphan.
    $script:teardownProbeCalls = 0
    $script:sleepCalls = 0
    $noSleep = { param($milliseconds) $script:sleepCalls++ }
    $teardownProbe = {
        param($port)
        $script:teardownProbeCalls++
        if ($script:teardownProbeCalls -le 2) { return 999001 }
        return $null
    }
    $settled = Get-HostNativeOrphanListener -Name 'bim-streaming-server' -RunDir $orphanRunDir `
        -SettleTimeoutMs 5000 -SleepFn $noSleep `
        -PortLookupFn $teardownProbe -GetProcessFn $noProcess -ChildPidLookup $noChildren
    Assert-True ($null -eq $settled) 'a listener that disappears within the settle budget is teardown, not an orphan'
    Assert-True ($script:sleepCalls -ge 1) 'the settle window actually waits before re-observing'

    $script:sleepCalls = 0
    $persistent = Get-HostNativeOrphanListener -Name 'bim-streaming-server' -RunDir $orphanRunDir `
        -SettleTimeoutMs 5000 -SleepFn $noSleep `
        -PortLookupFn $orphanProbe -GetProcessFn $noProcess -ChildPidLookup $noChildren
    Assert-True ($null -ne $persistent) 'a holder that survives the settle budget is still reported'
    Assert-Equal '49150' (@($persistent.Ports) -join ',') 'the surviving holder keeps its port in the report'
    Write-TestPass 'orphaned listener detection is fail-closed and tree-aware (#640)'
}
finally {
    Remove-TestSandbox -Path $orphanSandbox
}

# Test O4: a deliberate stop releases the claim; a stop that stopped nothing does
# not - otherwise the recovery path would erase the very record it needs.
$stopClaimSandbox = New-TestSandbox -Prefix 'hn-stop-ports'
try {
    $stopClaimRunDir = Join-Path $stopClaimSandbox 'scripts\.run'
    New-Item -ItemType Directory -Path $stopClaimRunDir -Force | Out-Null

    Set-Content -LiteralPath (Join-Path $stopClaimRunDir 'svc.pid') -Value '4242'
    Set-Content -LiteralPath (Join-Path $stopClaimRunDir 'svc.job') -Value 'Local\aibim-job-svc'
    Set-Content -LiteralPath (Join-Path $stopClaimRunDir 'svc.ports') -Value '49100'
    $null = Stop-HostNativeService -Name 'svc' -RunDir $stopClaimRunDir `
        -ChildPidLookup { param($parentId) @() } `
        -StopProcessFn { param($procId) } `
        -JobStopFn { param($jobName) [pscustomobject]@{ Found = $true; MemberPids = @(4242); Proven = $true; Supported = $true } }
    Assert-True (-not (Test-Path -LiteralPath (Join-Path $stopClaimRunDir 'svc.ports'))) 'the job-first stop releases the port claim'

    Set-Content -LiteralPath (Join-Path $stopClaimRunDir 'svc2.pid') -Value '4343'
    Set-Content -LiteralPath (Join-Path $stopClaimRunDir 'svc2.ports') -Value '49150'
    $null = Stop-HostNativeService -Name 'svc2' -RunDir $stopClaimRunDir `
        -ChildPidLookup { param($parentId) @() } `
        -StopProcessFn { param($procId) } `
        -JobStopFn { param($jobName) [pscustomobject]@{ Found = $false; MemberPids = @(); Proven = $false; Supported = $false } }
    Assert-True (-not (Test-Path -LiteralPath (Join-Path $stopClaimRunDir 'svc2.ports'))) 'the legacy walk releases the port claim too'

    Set-Content -LiteralPath (Join-Path $stopClaimRunDir 'svc3.ports') -Value '49160'
    $stoppedNothing = Stop-HostNativeService -Name 'svc3' -RunDir $stopClaimRunDir `
        -ChildPidLookup { param($parentId) @() } `
        -StopProcessFn { param($procId) } `
        -JobStopFn { param($jobName) [pscustomobject]@{ Found = $false; MemberPids = @(); Proven = $false; Supported = $false } }
    Assert-True (-not $stoppedNothing) 'a stop with no pid file reports that it stopped nothing'
    Assert-Equal '49160' ((Get-HostNativeServiceListenPorts -Name 'svc3' -RunDir $stopClaimRunDir) -join ',') 'a stop that stopped nothing keeps the claim'
    Write-TestPass 'only a stop that terminated something releases the port claim (#640)'
}
finally {
    Remove-TestSandbox -Path $stopClaimSandbox
}

# Test O5: the Kit launcher declares the TCP signal ports as its claim. Media
# ports are UDP and stay out of a record that only a TCP probe can attribute.
$launcherBody = Get-Content -LiteralPath $modulePath -Raw
Assert-True ($launcherBody -match '-ListenPorts \(@\(\$SignalPort\) \+ @\(\$SpectatorSignalPorts\)\)') 'Start-HostNativeKit declares its signal ports as the recorded claim'
Assert-True (-not ($launcherBody -match '-ListenPorts.*\$StreamPort')) 'the UDP media port is not recorded as a TCP claim'
Write-TestPass 'Kit launch declares the signal ports it will own (#640)'

Write-Host "`n=== test-host-native-launcher.ps1: ALL PASSED ===" -ForegroundColor Green
