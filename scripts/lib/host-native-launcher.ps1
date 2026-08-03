# scripts\lib\host-native-launcher.ps1
# Host-native process launcher:抽自 start-all.ps1 line 217-260 的
# Test-AlreadyRunning / Start-LocalService / Wait-Health,讓 deploy.ps1
# 與其他入口共用。Start-* 函數有副作用(啟 process / 寫 PID file / 寫 log)。

Set-StrictMode -Version Latest

# Per-OS primitives (venv layout, system interpreter, platform name). Guarded so
# this lib stays dot-sourceable standalone in tests.
if (-not (Get-Command -Name 'Resolve-PlatformVenvPython' -ErrorAction SilentlyContinue)) {
    . (Join-Path $PSScriptRoot 'platform/platform-adapter.ps1')
}

function Resolve-HostNativePython {
    # Single interpreter-selection rule for every host-native service. The three
    # launchers each had their own copy hardcoding the Windows venv layout
    # (.venv\Scripts\python.exe), which never matches on Linux (.venv/bin/python),
    # so they all fell through to the bare name 'python' - which the Linux target
    # does not have. Start-Process then produced no process and the failure only
    # surfaced as a health-check timeout 30 seconds later.
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string] $RepoRoot,
        [Parameter(Mandatory = $true)][string] $ServiceName
    )
    $venvPython = Resolve-PlatformVenvPython -VenvRoot (Join-Path $RepoRoot '.venv')
    if ((Get-PlatformName) -eq 'windows') {
        # Windows keeps preferring the system 3.12 install: the host-native Kit
        # toolchain is built against it.
        $python312 = 'C:\Program Files\Python312\python.exe'
        if (Test-Path -LiteralPath $python312 -PathType Leaf) { return $python312 }
    }
    if (Test-Path -LiteralPath $venvPython -PathType Leaf) { return $venvPython }
    $systemPython = Resolve-PlatformSystemPython
    if ($systemPython) { return $systemPython }
    throw "${ServiceName}: no usable Python interpreter (looked for the repo venv at $venvPython and a system python on PATH)."
}

function Get-HostNativePowerShellExe {
    # powershell.exe is Windows-only; the cross-platform executable is pwsh.
    # -Platform is injectable so both branches are testable from either OS.
    param([string] $Platform = (Get-PlatformName))
    if ($Platform -eq 'windows') { return 'powershell.exe' }
    return 'pwsh'
}

function Get-HostNativePowerShellArgumentPrefix {
    param([string] $Platform = (Get-PlatformName))
    # Standard prefix for launching one of our .ps1 files as a child process.
    # -ExecutionPolicy is a Windows-only concept and pwsh rejects it elsewhere, so
    # it is only emitted there. Callers append -File <script> and their own args.
    #
    # CONTRACT: callers MUST wrap the call in @() - `@(Get-...Prefix) + @('-File', ...)`.
    # Two failure modes bracket this, and both have shipped:
    #   - a bare call without @(): off Windows the single-element result unrolls to a
    #     string, `+` becomes string concatenation, and the child gets '-NoProfile-File'.
    #   - returning `,@(...)` to defeat that: @() around it then yields a NESTED array,
    #     and Start-Process rejects it with "Cannot convert 'System.Object[]' to the
    #     type 'System.String' required by parameter 'ArgumentList'".
    # So: emit a plain array here, and let the caller's @() do the normalising.
    # test-host-native-child-launch.ps1 asserts the composed argv is FLAT, which is
    # the property that actually matters and which catches both shapes.
    if ($Platform -eq 'windows') {
        return @('-NoProfile', '-ExecutionPolicy', 'Bypass')
    }
    return @('-NoProfile')
}

function Test-AlreadyRunning {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string] $Name,
        [Parameter(Mandatory = $true)][string] $RunDir,
        [scriptblock] $GetProcessFn = {
            param($procId)
            try { Get-Process -Id $procId -ErrorAction Stop } catch { $null }
        }
    )
    $pidFile = Join-Path $RunDir "$Name.pid"
    if (-not (Test-Path -LiteralPath $pidFile)) { return $false }
    $raw = Get-Content -LiteralPath $pidFile -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $raw) { return $false }
    $procId = 0
    if (-not [int]::TryParse($raw.Trim(), [ref]$procId)) { return $false }
    return ($null -ne (& $GetProcessFn $procId))
}

function Remove-StalePidFile {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string] $Name,
        [Parameter(Mandatory = $true)][string] $RunDir,
        [scriptblock] $GetProcessFn = {
            param($procId)
            try { Get-Process -Id $procId -ErrorAction Stop } catch { $null }
        }
    )
    $pidFile = Join-Path $RunDir "$Name.pid"
    if (-not (Test-Path -LiteralPath $pidFile)) { return $false }
    $raw = Get-Content -LiteralPath $pidFile -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $raw) {
        Remove-Item -LiteralPath $pidFile -Force
        return $true
    }
    $procId = 0
    if ([int]::TryParse($raw.Trim(), [ref]$procId)) {
        if ($null -eq (& $GetProcessFn $procId)) {
            Remove-Item -LiteralPath $pidFile -Force
            return $true
        }
    }
    return $false
}

function Stop-HostNativeService {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string] $Name,
        [Parameter(Mandatory = $true)][string] $RunDir,
        # Win32_Process is Windows-only: on Linux the CIM call threw, the catch
        # returned an empty list, and the tree walk silently degraded to killing
        # only the wrapper - leaving uvicorn/Kit children holding their ports.
        # The adapter reads /proc there and CIM here.
        [scriptblock] $ChildPidLookup = {
            param($parentId)
            @(Get-PlatformChildProcessIds -ParentProcessId ([int]$parentId))
        },
        [scriptblock] $StopProcessFn = {
            param($procId)
            Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
        }
    )
    $pidFile = Join-Path $RunDir "$Name.pid"
    if (-not (Test-Path -LiteralPath $pidFile)) { return $false }
    $raw = Get-Content -LiteralPath $pidFile -ErrorAction SilentlyContinue | Select-Object -First 1
    $procId = 0
    if (-not $raw -or -not [int]::TryParse($raw.Trim(), [ref]$procId)) {
        Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
        return $false
    }

    $ids = @()
    $stack = @($procId)
    while ($stack.Count -gt 0) {
        $current = [int]$stack[0]
        $stack = @($stack | Select-Object -Skip 1)
        if ($ids -notcontains $current) {
            $ids += $current
            $stack += @(& $ChildPidLookup $current)
        }
    }
    for ($i = $ids.Count - 1; $i -ge 0; $i--) {
        & $StopProcessFn ([int]$ids[$i])
    }
    Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
    return $true
}

function Start-HostNativeService {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string] $Name,
        [Parameter(Mandatory = $true)][string] $WorkingDirectory,
        [Parameter(Mandatory = $true)][string] $FilePath,
        [string[]] $ArgumentList = @(),
        [Parameter(Mandatory = $true)][string] $RunDir,
        [ValidateSet('Hidden','Normal')] [string] $WindowStyle = 'Hidden'
    )

    if (-not (Test-Path -LiteralPath $RunDir)) {
        New-Item -ItemType Directory -Path $RunDir -Force | Out-Null
    }
    $logFile = Join-Path $RunDir "$Name.log"
    $errFile = "$logFile.err"
    $pidFile = Join-Path $RunDir "$Name.pid"

    $startArgs = @{
        FilePath               = $FilePath
        ArgumentList           = $ArgumentList
        WorkingDirectory       = $WorkingDirectory
        RedirectStandardOutput = $logFile
        RedirectStandardError  = $errFile
        PassThru               = $true
    }
    # -WindowStyle is a Windows-only concept; PowerShell rejects it on Linux/macOS.
    if ((Get-PlatformName) -eq 'windows') { $startArgs.WindowStyle = $WindowStyle }

    $proc = Start-Process @startArgs
    # Fail closed on a start that produced no process. Start-Process can come back
    # empty (bad interpreter name, missing working directory) and the old code then
    # returned an object whose Pid was silently absent - the caller logged
    # "PID=" as [ok] and only the health probe noticed, 30 seconds later.
    if (-not $proc -or -not $proc.Id) {
        throw "$Name did not start: '$FilePath' produced no process (workdir=$WorkingDirectory, stderr=$errFile)."
    }
    $proc.Id | Set-Content -LiteralPath $pidFile -Encoding ascii
    return [pscustomobject]@{ Name = $Name; Pid = $proc.Id; LogPath = $logFile; ErrPath = $errFile }
}

function Wait-HostNativeHealth {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string] $Name,
        [Parameter(Mandatory = $true)][string] $Url,
        [int] $TimeoutSec = 30,
        [scriptblock] $ProbeFn = {
            param($url)
            Invoke-WebRequest -Uri $url -TimeoutSec 3 -UseBasicParsing -ErrorAction Stop
        }
    )
    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    while ((Get-Date) -lt $deadline) {
        try {
            $r = & $ProbeFn $Url
            if ($r -and $r.StatusCode -eq 200) { return $true }
        } catch {
            # 繼續等
        }
        Start-Sleep -Milliseconds 500
    }
    return $false
}

function Invoke-KitRepoBuild {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string] $WorkingDirectory,
        [Parameter(Mandatory = $true)][string] $LogPath,
        [Parameter(Mandatory = $true)][string] $RunDir,
        # repo.bat 底下的 Kit precache 工具鏈偶爾會留下未釋放 stdout/stderr handle
        # 的背景分支程序,讓 native process 的 stream redirect 卡住等 EOF 而非只等
        # repo.bat 本身結束(2026-07-01 實測:build 早已成功,但外層卡死 20+ 分鐘)。
        # 20 分鐘是官方「may take several minutes」訊息的保守上限,足夠涵蓋 cold
        # build,又能在真的卡住時及時失敗而非無限期掛住整條 deploy pipeline。
        [int] $TimeoutSec = 1200,
        [scriptblock] $StartProcessFn = {
            param($workingDirectory, $logPath)
            # cmd.exe 自己做 `>` 檔案重導向(真實 Win32 file handle,不是
            # pipe),deploy.ps1 只用 WaitForExit(timeout) 等「process 本身」
            # 結束,不受孫行程持有的 handle 影響。
            # 用完整路徑呼叫 repo.bat,不用裸檔名——某些主機的 .bat/batfile
            # 副檔名關聯毀損時(`assoc .bat`/`ftype batfile` 回報 not found),
            # cmd.exe 對裸檔名的 PATHEXT 查找+啟動會直接回報 "not recognized
            # as an internal or external command"(即使 `where repo.bat`、
            # `dir`、`call repo.bat` 都找得到/看得到檔案)。完整路徑不經過
            # 這條關聯查找路徑,兩種主機狀態下都能正常執行(2026-07-06 實測)。
            $repoBatPath = Join-Path $workingDirectory 'repo.bat'
            $cmdLine = "call `"$repoBatPath`" build > `"$logPath`" 2>&1"
            Start-Process -FilePath 'cmd.exe' -ArgumentList @('/c', $cmdLine) `
                -WorkingDirectory $workingDirectory -NoNewWindow -PassThru
        },
        [scriptblock] $WaitForExitFn = {
            param($proc, $timeoutMs)
            $proc.WaitForExit($timeoutMs)
        },
        [scriptblock] $StopTreeFn = {
            param($name, $runDir)
            Stop-HostNativeService -Name $name -RunDir $runDir | Out-Null
        }
    )

    $pidFile = Join-Path $RunDir 'kit-repo-build.pid'
    $proc = & $StartProcessFn $WorkingDirectory $LogPath
    $proc.Id | Set-Content -LiteralPath $pidFile -Encoding ascii

    $exited = & $WaitForExitFn $proc ($TimeoutSec * 1000)
    if ($exited) {
        Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
        return [pscustomobject]@{ TimedOut = $false; ExitCode = [int]$proc.ExitCode; ProcessId = [int]$proc.Id }
    }

    & $StopTreeFn 'kit-repo-build' $RunDir
    return [pscustomobject]@{ TimedOut = $true; ExitCode = -1; ProcessId = [int]$proc.Id }
}

function Resolve-ConversionParentRoot {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string] $RuntimeStorageRoot)
    return (Split-Path -Parent $RuntimeStorageRoot)
}

function Start-HostNativeConversion {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string] $RepoRoot,
        [Parameter(Mandatory = $true)][string] $RuntimeStorageRoot,
        [int] $Port = 49101,
        [string] $BindHost = '127.0.0.1',
        [string] $PublicArtifactsUrl = ''
    )
    $runDir = Join-Path $RepoRoot 'scripts\.run'
    if (-not (Test-Path -LiteralPath $runDir)) {
        New-Item -ItemType Directory -Path $runDir -Force | Out-Null
    }

    # 反向對齊(spec §7.4 方案 A):
    # - STORAGE_ROOT 是 conversion service 內 ifc2usdc_powershell_adapter.py 用來驗
    #   dispatch payload host_local_path 必須在其下的 sandbox 根。coordinator 給的
    #   host_local_path = <RuntimeStorageRoot>\ifc-cache\<job>\source.ifc,所以
    #   STORAGE_ROOT 必須 = RuntimeStorageRoot,IFC path 才落在 sandbox 內。
    # - STREAMING_CONVERSION_WORK_DIR 是給 launcher 工作目錄(spec 註解保留 parent
    #   對齊以容 Resolve-ConversionWorkDir 的 storage subdir 推導)
    $parentRoot = Resolve-ConversionParentRoot -RuntimeStorageRoot $RuntimeStorageRoot
    $env:STORAGE_ROOT                  = $RuntimeStorageRoot
    $env:STREAMING_CONVERSION_WORK_DIR = $parentRoot
    $env:STREAMING_CONVERSION_HOST     = $BindHost
    $env:STREAMING_CONVERSION_PORT     = "$Port"
    if (-not [string]::IsNullOrWhiteSpace($PublicArtifactsUrl)) {
        $env:STREAMING_CONVERSION_PUBLIC_ARTIFACTS_URL = $PublicArtifactsUrl
    } else {
        Remove-Item Env:STREAMING_CONVERSION_PUBLIC_ARTIFACTS_URL -ErrorAction SilentlyContinue
    }
    $env:PYTHONNOUSERSITE = '1'

    $launcher = Join-Path $RepoRoot 'bim-streaming-server\scripts\start-host-native-conversion-service.ps1'
    $pythonExe = Resolve-HostNativePython -RepoRoot $RepoRoot -ServiceName 'bim-streaming-conversion-service'
    return (Start-HostNativeService `
        -Name 'bim-streaming-conversion-service' `
        -WorkingDirectory (Join-Path $RepoRoot 'bim-streaming-server') `
        -FilePath (Get-HostNativePowerShellExe) `
        -ArgumentList (@(Get-HostNativePowerShellArgumentPrefix) + @('-File', $launcher, '-PythonExe', $pythonExe)) `
        -RunDir $runDir)
}

function Start-HostNativeGovernance {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string] $RepoRoot,
        [int] $Port = 49102,
        [string] $DbPath = '',
        [string] $FileLibraryRoot = ''
    )
    # 'scripts\.run' is safe on both platforms: PowerShell's Join-Path normalises the
    # backslash to the native separator, verified on the Linux target (the run
    # directory materialised as /home/bimdeploy/AI-bim-geo/scripts/.run). Kept in the
    # Windows spelling to match every other site that reads or writes these PID files.
    $runDir = Join-Path $RepoRoot 'scripts\.run'
    if (-not (Test-Path -LiteralPath $runDir)) {
        New-Item -ItemType Directory -Path $runDir -Force | Out-Null
    }

    $serviceRoot = Join-Path $RepoRoot 'governance-service'
    $pythonExe = Resolve-HostNativePython -RepoRoot $RepoRoot -ServiceName 'governance-service'

    Remove-Item Env:PYTHONNOUSERSITE -ErrorAction SilentlyContinue
    & $pythonExe -c "import ifcopenshell, fastapi, uvicorn" *> $null
    if ($LASTEXITCODE -ne 0) {
        throw "governance-service Python cannot import ifcopenshell, fastapi, and uvicorn: $pythonExe"
    }

    $env:GOV_PORT = "$Port"
    if (-not [string]::IsNullOrWhiteSpace($DbPath)) {
        $env:GOV_DB_PATH = $DbPath
    }
    if (-not [string]::IsNullOrWhiteSpace($FileLibraryRoot)) {
        $env:BIM_FILE_LIBRARY_ROOT = $FileLibraryRoot
    }

    return (Start-HostNativeService `
        -Name 'governance-service' `
        -WorkingDirectory $serviceRoot `
        -FilePath $pythonExe `
        -ArgumentList @('-m','uvicorn','app:app','--host','127.0.0.1','--port',"$Port") `
        -RunDir $runDir)
}

# R5（2026-07-10 衛生輪 C3）：kit-manager-api 納入 golden path——hybrid 模式下 coordinator
# 容器經 host.docker.internal:8010 依賴 host-native kit-manager-api（RK1 Kit 控制權威），
# 先前 Mode A/C 完全未編排（只有 Mode B compose 有）。樣式克隆 Start-HostNativeGovernance。
function Start-HostNativeKitManager {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string] $RepoRoot,
        [int] $Port = 8010
    )
    $runDir = Join-Path $RepoRoot 'scripts\.run'
    if (-not (Test-Path -LiteralPath $runDir)) {
        New-Item -ItemType Directory -Path $runDir -Force | Out-Null
    }

    $serviceRoot = Join-Path $RepoRoot 'services\kit-manager-api'
    $pythonExe = Resolve-HostNativePython -RepoRoot $RepoRoot -ServiceName 'kit-manager-api'

    Remove-Item Env:PYTHONNOUSERSITE -ErrorAction SilentlyContinue
    & $pythonExe -c "import fastapi, uvicorn" *> $null
    if ($LASTEXITCODE -ne 0) {
        throw "kit-manager-api Python cannot import fastapi and uvicorn: $pythonExe"
    }

    return (Start-HostNativeService `
        -Name 'kit-manager-api' `
        -WorkingDirectory $serviceRoot `
        -FilePath $pythonExe `
        -ArgumentList @('-m','uvicorn','app.main:app','--host','127.0.0.1','--port',"$Port") `
        -RunDir $runDir)
}

function Start-HostNativeKit {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string] $RepoRoot,
        [int] $SignalPort = 49100,
        [int] $StreamPort = 47998,
        [string] $PublicIp = '127.0.0.1',
        [int[]] $SpectatorSignalPorts = @(),
        [int[]] $SpectatorStreamPorts = @()
    )
    if ($SpectatorSignalPorts.Count -ne $SpectatorStreamPorts.Count) {
        throw "SpectatorSignalPorts and SpectatorStreamPorts must have the same number of entries."
    }

    $runDir = Join-Path $RepoRoot 'scripts\.run'
    if (-not (Test-Path -LiteralPath $runDir)) {
        New-Item -ItemType Directory -Path $runDir -Force | Out-Null
    }
    $launcher = Join-Path $RepoRoot 'bim-streaming-server\scripts\start-streaming-server.ps1'
    $arguments = @(Get-HostNativePowerShellArgumentPrefix) + @(
        '-File', $launcher,
        '-InstanceId','kit_local_001',
        '-SignalPort',"$SignalPort",
        '-StreamPort',"$StreamPort",
        '-PublicIp', $PublicIp,
        '-ResetUser',
        '-SkipAutoLoad'
    )
    if ($SpectatorSignalPorts.Count -gt 0) {
        $arguments += '-SpectatorSignalPorts'
        $arguments += ($SpectatorSignalPorts -join ',')
        $arguments += '-SpectatorStreamPorts'
        $arguments += ($SpectatorStreamPorts -join ',')
    }

    return (Start-HostNativeService `
        -Name 'bim-streaming-server' `
        -WorkingDirectory (Join-Path $RepoRoot 'bim-streaming-server') `
        -FilePath (Get-HostNativePowerShellExe) `
        -ArgumentList $arguments `
        -RunDir $runDir)
}
