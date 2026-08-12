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

    # Test 21b (issue #493 / TG-02): every dynamic case above injects a
    # SUCCEEDING fake -ImportProbeFn, so the DEFAULT probe defined inline in
    # Start-HostNativeKitManager (host-native-launcher.ps1:556-600) — its
    # WaitForExit($TimeoutSec * 1000), the Stop-HostNativeProcessTreeAndWait
    # call, and the -1 -> throw propagation at host-native-launcher.ps1:616-618
    # — was only proven by source-regex assertions, never actually driven.
    # The probe's argv is hardcoded to `-c 'import fastapi, uvicorn'`, so make
    # the import itself hang: put a `fastapi.py` shim earlier on PYTHONPATH
    # that spawns a child and sleeps 30s, modeled on the proven hung-child
    # fixture at test-deploy-governance-static.ps1:174-215.
    $defaultProbePython = Resolve-PlatformSystemPython
    if ([string]::IsNullOrWhiteSpace($defaultProbePython)) {
        throw 'default import-probe regression fixture requires a working Python 3.11+ interpreter'
    }
    $defaultProbeShimDir = Join-Path $sb 'default-probe-shim'
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

    function Resolve-HostNativePython { param($RepoRoot, $ServiceName) return $defaultProbePython }
    $script:defaultProbeServiceStarted = $false
    function Start-HostNativeService {
        param($Name, $WorkingDirectory, $FilePath, $ArgumentList, $RunDir)
        $script:defaultProbeServiceStarted = $true
        return [pscustomobject]@{ Pid = 4251; LogPath = 'fixture.log' }
    }

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
    Assert-True (-not $script:defaultProbeServiceStarted) `
        'a failed default import probe must never reach Start-HostNativeService'
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
    Remove-TestSandbox -Path $sb
}

$canonicalControlUrl = Resolve-HostNativeKitControlUrl `
    -KitControlUrl 'HTTP://LOCALHOST:49101/' `
    -LocalAddressProbeFn { param($HostName) return ($HostName -eq 'localhost') }
Assert-Equal 'http://localhost:49101' $canonicalControlUrl 'resolver canonicalizes an explicit localhost authority'

Assert-True ($moduleContent -match '\$importProcess\.WaitForExit\(\$TimeoutSec \* 1000\)') 'Kit Manager import probe wait is bounded'
Assert-True ($moduleContent -match 'Stop-HostNativeProcessTreeAndWait -Process \$importProcess -TimeoutMs 5000') 'Kit Manager import probe terminates and waits for a timed-out child process tree'
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

    # Case 3 (#489 L1-COR-001): the parent exits BEFORE the helper is entered.
    # Neither Windows nor Linux cascades termination, so the descendants are still
    # running - the old `if ($Process.HasExited) { return }` reported containment
    # without ever looking at them. An exited parent excuses the parent kill/wait
    # only; the sweep, the termination and the proof still have to happen.
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
    $orphanStopwatch = [System.Diagnostics.Stopwatch]::StartNew()
    # Sampled INSIDE the try, before the sandbox cleanup below: killing the child
    # here and asserting afterwards would let the test's own cleanup satisfy the
    # containment claim the helper is supposed to prove.
    $orphanChildIdentityAfterStop = 'never-sampled'
    try {
        Stop-HostNativeProcessTreeAndWait -Process $orphanProcess -TimeoutMs 5000 `
            -ChildPidLookup {
                param($parentId)
                # A re-parented descendant is no longer reachable through the dead
                # parent's ppid link, so the caller's own record stands in for it.
                if ([int]$parentId -eq $orphanParentId) { return @($orphanChildId) }
                return @()
            }.GetNewClosure()
        $orphanChildIdentityAfterStop = Get-PlatformProcessIdentity -ProcessId $orphanChildId
    }
    finally {
        $orphanStopwatch.Stop()
        Stop-Process -Id $orphanChildId -Force -ErrorAction SilentlyContinue
    }
    Assert-True ($null -eq $orphanChildIdentityAfterStop) 'process-tree terminator contains the descendants of an already-exited parent'
    Assert-True ($orphanStopwatch.Elapsed.TotalSeconds -lt 15) 'already-exited-parent containment stays inside the bounded window'
    Write-TestPass 'process-tree terminator sweeps descendants when the parent exited before entry'

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
}
finally {
    Remove-TestSandbox -Path $treeSandbox
}

Write-Host "`n=== test-host-native-launcher.ps1: ALL PASSED ===" -ForegroundColor Green
