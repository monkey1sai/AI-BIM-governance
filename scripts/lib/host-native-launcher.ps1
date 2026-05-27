# scripts\lib\host-native-launcher.ps1
# Host-native process launcher:抽自 start-all.ps1 line 217-260 的
# Test-AlreadyRunning / Start-LocalService / Wait-Health,讓 deploy.ps1
# 與其他入口共用。Start-* 函數有副作用(啟 process / 寫 PID file / 寫 log)。

Set-StrictMode -Version Latest

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

    $proc = Start-Process `
        -FilePath $FilePath `
        -ArgumentList $ArgumentList `
        -WorkingDirectory $WorkingDirectory `
        -WindowStyle $WindowStyle `
        -RedirectStandardOutput $logFile `
        -RedirectStandardError $errFile `
        -PassThru
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

    $launcher = Join-Path $RepoRoot 'bim-streaming-server\scripts\start-host-native-conversion-service.ps1'
    return (Start-HostNativeService `
        -Name 'bim-streaming-conversion-service' `
        -WorkingDirectory (Join-Path $RepoRoot 'bim-streaming-server') `
        -FilePath 'powershell.exe' `
        -ArgumentList @('-ExecutionPolicy','Bypass','-NoProfile','-File',$launcher) `
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
    $arguments = @(
        '-ExecutionPolicy','Bypass','-NoProfile','-File', $launcher,
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
        -FilePath 'powershell.exe' `
        -ArgumentList $arguments `
        -RunDir $runDir)
}
