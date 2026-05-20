[CmdletBinding()]
param(
    [switch] $SkipStreaming,    # 跳過 bim-streaming-server (Kit GPU runtime)
    [switch] $SkipViewer,
    [switch] $SkipConversionService,
    [switch] $SkipCoordinator,
    [switch] $Visible,           # 顯示 console 視窗 (預設背景隱藏)
    [string] $KitHost = "auto",
    [string[]] $KitSignalPorts = @("49100"),
    [string[]] $KitStreamPorts = @("47998"),
    [string[]] $KitSpectatorSignalPorts = @(),
    [string[]] $KitSpectatorStreamPorts = @(),
    [int] $HealthTimeoutSeconds = 30
)

# 一鍵啟動 Phase B current demo services。PID 寫到 scripts/.run/<svc>.pid，stdout/stderr 寫到 scripts/.run/<svc>.log。
# 對應的關閉指令：scripts/stop-all.ps1
# 設計原則：直接 Start-Process 真正的執行檔，避免 cmd /c 包 wrapper 導致 PID 鏈斷裂。
# Uvicorn 不開 --reload，因為 --reload 會 fork 額外子行程，使 stop 時清理變複雜。

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$RunDir = Join-Path $PSScriptRoot ".run"
if (-not (Test-Path $RunDir)) { New-Item -ItemType Directory -Path $RunDir -Force | Out-Null }

function Initialize-WindowsRuntimeEnvironment {
    $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
    $parts = $identity.Split("\", 2)
    if ($parts.Count -eq 2) {
        if ([string]::IsNullOrWhiteSpace($env:USERDOMAIN)) {
            $env:USERDOMAIN = $parts[0]
        }
        if ([string]::IsNullOrWhiteSpace($env:USERNAME)) {
            $env:USERNAME = $parts[1]
        }
    }

    if ([string]::IsNullOrWhiteSpace($env:APPDATA)) {
        $env:APPDATA = Join-Path $env:USERPROFILE "AppData\Roaming"
    }
    if ([string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) {
        $env:LOCALAPPDATA = Join-Path $env:USERPROFILE "AppData\Local"
    }
    if ([string]::IsNullOrWhiteSpace($env:ProgramData)) {
        $env:ProgramData = "C:\ProgramData"
    }
    if ([string]::IsNullOrWhiteSpace($env:ALLUSERSPROFILE)) {
        $env:ALLUSERSPROFILE = "C:\ProgramData"
    }
    if ([string]::IsNullOrWhiteSpace($env:SystemRoot)) {
        $env:SystemRoot = "C:\WINDOWS"
    }
    if ([string]::IsNullOrWhiteSpace($env:windir)) {
        $env:windir = $env:SystemRoot
    }
    if ([string]::IsNullOrWhiteSpace($env:ComSpec)) {
        $env:ComSpec = Join-Path $env:SystemRoot "system32\cmd.exe"
    }
    if ([string]::IsNullOrWhiteSpace($env:COMPUTERNAME)) {
        $env:COMPUTERNAME = $env:USERDOMAIN
    }
}

Initialize-WindowsRuntimeEnvironment

$Python = Join-Path $RepoRoot ".venv\Scripts\python.exe"
if (-not (Test-Path $Python)) { $Python = "python" }

$WindowStyle = if ($Visible) { "Normal" } else { "Hidden" }

function Resolve-KitHost {
    param([string] $Value)

    if (-not [string]::IsNullOrWhiteSpace($Value) -and $Value.Trim().ToLowerInvariant() -ne "auto") {
        return $Value
    }

    $candidates = @()
    foreach ($nic in [System.Net.NetworkInformation.NetworkInterface]::GetAllNetworkInterfaces()) {
        if ($nic.OperationalStatus -ne [System.Net.NetworkInformation.OperationalStatus]::Up) { continue }
        $props = $nic.GetIPProperties()
        foreach ($address in $props.UnicastAddresses) {
            if ($address.Address.AddressFamily -ne [System.Net.Sockets.AddressFamily]::InterNetwork) { continue }
            if ([System.Net.IPAddress]::IsLoopback($address.Address)) { continue }
            $candidates += [pscustomobject]@{
                Address = $address.Address.ToString()
                HasGateway = @($props.GatewayAddresses | Where-Object { $_.Address.AddressFamily -eq [System.Net.Sockets.AddressFamily]::InterNetwork }).Count -gt 0
            }
        }
    }

    $preferred = $candidates | Sort-Object -Property @{ Expression = "HasGateway"; Descending = $true }, Address | Select-Object -First 1
    if ($preferred) { return $preferred.Address }
    return "127.0.0.1"
}

$ResolvedKitHost = Resolve-KitHost -Value $KitHost

function Resolve-ConversionWorkDir {
    param([string] $Root)

    $rootStorage = Join-Path $Root "storage"
    if (
        (Test-Path -LiteralPath $rootStorage -PathType Container) -and
        @(Get-ChildItem -LiteralPath $rootStorage -Filter "*.ifc" -File -ErrorAction SilentlyContinue).Count -gt 0
    ) {
        return $Root
    }

    $parent = Split-Path -Parent $Root
    if ((Split-Path -Leaf $parent) -eq ".worktrees") {
        $hostRoot = Split-Path -Parent $parent
        $hostStorage = Join-Path $hostRoot "storage"
        if (
            (Test-Path -LiteralPath $hostStorage -PathType Container) -and
            @(Get-ChildItem -LiteralPath $hostStorage -Filter "*.ifc" -File -ErrorAction SilentlyContinue).Count -gt 0
        ) {
            return $hostRoot
        }
    }

    return $Root
}

if ([string]::IsNullOrWhiteSpace($env:STREAMING_CONVERSION_WORK_DIR)) {
    $env:STREAMING_CONVERSION_WORK_DIR = Resolve-ConversionWorkDir -Root $RepoRoot
}

function Get-KitEndpointSpecs {
    $signalPorts = @(ConvertTo-PortList -Values $KitSignalPorts -Name "KitSignalPorts")
    $streamPorts = @(ConvertTo-PortList -Values $KitStreamPorts -Name "KitStreamPorts")
    if ($signalPorts.Count -eq 0) {
        throw "KitSignalPorts must contain at least one port."
    }
    if ($signalPorts.Count -ne $streamPorts.Count) {
        throw "KitSignalPorts and KitStreamPorts must have the same number of entries."
    }

    $endpoints = @()
    for ($i = 0; $i -lt $signalPorts.Count; $i++) {
        $endpoints += [pscustomobject]@{
            Id = "kit_local_{0:D3}" -f ($i + 1)
            SignalingServer = $ResolvedKitHost
            SignalingPort = [int]$signalPorts[$i]
            MediaServer = $ResolvedKitHost
            MediaPort = [int]$streamPorts[$i]
        }
    }
    return $endpoints
}

function ConvertTo-PortList {
    param(
        [string[]] $Values,
        [string] $Name
    )

    $ports = @()
    foreach ($value in $Values) {
        foreach ($part in ($value -split ",")) {
            $trimmed = $part.Trim()
            if ([string]::IsNullOrWhiteSpace($trimmed)) { continue }
            $port = 0
            if (-not [int]::TryParse($trimmed, [ref] $port)) {
                throw "$Name contains a non-integer port: $trimmed"
            }
            $ports += $port
        }
    }
    return $ports
}

function Get-KitSpectatorEndpointSpecs {
    $signalPorts = @(ConvertTo-PortList -Values $KitSpectatorSignalPorts -Name "KitSpectatorSignalPorts")
    $streamPorts = @(ConvertTo-PortList -Values $KitSpectatorStreamPorts -Name "KitSpectatorStreamPorts")
    if ($signalPorts.Count -ne $streamPorts.Count) {
        throw "KitSpectatorSignalPorts and KitSpectatorStreamPorts must have the same number of entries."
    }

    $endpoints = @()
    for ($i = 0; $i -lt $signalPorts.Count; $i++) {
        $endpoints += [pscustomobject]@{
            Index = $i
            SignalingPort = [int]$signalPorts[$i]
            MediaPort = [int]$streamPorts[$i]
        }
    }
    return $endpoints
}

$KitEndpointSpecs = @(Get-KitEndpointSpecs)
$KitSpectatorEndpointSpecs = @(Get-KitSpectatorEndpointSpecs)
if ($KitEndpointSpecs.Count -gt 1 -and $KitSpectatorEndpointSpecs.Count -gt 0) {
    throw "Kit spectator streams are configured for a single Kit process. Use one KitSignalPort when KitSpectatorSignalPorts is set."
}
$KitEndpointObjects = @(
    $KitEndpointSpecs | ForEach-Object {
        [ordered]@{
            id = $_.Id
            signalingServer = $_.SignalingServer
            signalingPort = $_.SignalingPort
            mediaServer = $_.MediaServer
            mediaPort = $_.MediaPort
        }
    }
)
$KitEndpointJson = ConvertTo-Json -InputObject $KitEndpointObjects -Compress

$env:KIT_STREAM_SERVER = $KitEndpointSpecs[0].SignalingServer
$env:KIT_SIGNALING_PORT = [string]$KitEndpointSpecs[0].SignalingPort
$env:KIT_MEDIA_SERVER = $KitEndpointSpecs[0].MediaServer
$env:KIT_MEDIA_PORT = [string]$KitEndpointSpecs[0].MediaPort
$env:KIT_INSTANCE_ENDPOINTS = $KitEndpointJson

function Test-AlreadyRunning {
    param([string] $Name)
    $pidFile = Join-Path $RunDir "$Name.pid"
    if (-not (Test-Path $pidFile)) { return $false }
    $procId = Get-Content $pidFile -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $procId) { return $false }
    try {
        $null = Get-Process -Id $procId -ErrorAction Stop
        return $true
    } catch {
        Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
        return $false
    }
}

function Start-LocalService {
    param(
        [string] $Name,
        [string] $WorkingDirectory,
        [string] $FilePath,
        [string[]] $Arguments
    )

    if (Test-AlreadyRunning -Name $Name) {
        Write-Host "[skip ] $Name 已在執行 (PID file 存在)" -ForegroundColor Yellow
        return
    }

    Write-Host "[start] $Name ..." -ForegroundColor Cyan
    $logFile = Join-Path $RunDir "$Name.log"
    $pidFile = Join-Path $RunDir "$Name.pid"

    $proc = Start-Process `
        -FilePath $FilePath `
        -ArgumentList $Arguments `
        -WorkingDirectory $WorkingDirectory `
        -WindowStyle $WindowStyle `
        -RedirectStandardOutput $logFile `
        -RedirectStandardError "$logFile.err" `
        -PassThru

    $proc.Id | Set-Content -Path $pidFile -Encoding ascii
    Write-Host "       PID=$($proc.Id)  log=$logFile" -ForegroundColor DarkGray
}

function Wait-Health {
    param(
        [string] $Name,
        [string] $Url,
        [int] $TimeoutSeconds
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        try {
            $r = Invoke-WebRequest -Uri $Url -TimeoutSec 3 -UseBasicParsing -ErrorAction Stop
            if ($r.StatusCode -eq 200) {
                Write-Host "[ok   ] $Name ($Url)" -ForegroundColor Green
                return $true
            }
        } catch {
            # 健康檢查失敗或服務尚未就緒，繼續等待。
        }
        Start-Sleep -Milliseconds 500
    }
    Write-Host "[warn ] $Name 在 ${TimeoutSeconds}s 內未通過健康檢查 ($Url)" -ForegroundColor Yellow
    return $false
}

# === B-scheme（local-coordinator-ifc-ready-intake-boundary T2）===
# `_worker`(:8005) / `_bim-control`(:8001) 已自 repo 刪除。公司雲端 control-plane
# 與落地端 IFC Worker 屬外部系統，僅由 tests/fakes 模擬，不在本地啟動。
# 對外 IFC-ready intake 收斂於 coordinator（T3），streaming 為 internal-only（T4）。

if (-not $SkipCoordinator) {
    Start-LocalService `
        -Name "bim-review-coordinator" `
        -WorkingDirectory (Join-Path $RepoRoot "bim-review-coordinator") `
        -FilePath "npm.cmd" `
        -Arguments @("run", "dev")
}

if (-not $SkipConversionService) {
    Start-LocalService `
        -Name "bim-streaming-conversion-service" `
        -WorkingDirectory (Join-Path $RepoRoot "bim-streaming-server") `
        -FilePath "powershell.exe" `
        -Arguments @(
            "-ExecutionPolicy", "Bypass",
            "-NoProfile",
            "-File", "$RepoRoot\bim-streaming-server\scripts\start-host-native-conversion-service.ps1"
        )
}

if (-not $SkipStreaming) {
    foreach ($endpoint in $KitEndpointSpecs) {
        $serviceName = if ($KitEndpointSpecs.Count -eq 1) { "bim-streaming-server" } else { "bim-streaming-server-$($endpoint.Id)" }
        $streamingArguments = @(
            "-ExecutionPolicy", "Bypass",
            "-NoProfile",
            "-File", "$RepoRoot\bim-streaming-server\scripts\start-streaming-server.ps1",
            "-InstanceId", $endpoint.Id,
            "-SignalPort", [string]$endpoint.SignalingPort,
            "-StreamPort", [string]$endpoint.MediaPort,
            "-TraceRoot", ".\logs\nvstreamer\$($endpoint.Id)",
            "-PortableRoot", ".\logs\nvstreamer\$($endpoint.Id)\portable",
            "-PublicIp", $ResolvedKitHost,
            "-ResetUser",
            "-SkipAutoLoad"
        )
        if ($KitSpectatorEndpointSpecs.Count -gt 0) {
            $streamingArguments += "-SpectatorSignalPorts"
            $streamingArguments += (($KitSpectatorEndpointSpecs | ForEach-Object { [string]$_.SignalingPort }) -join ",")
            $streamingArguments += "-SpectatorStreamPorts"
            $streamingArguments += (($KitSpectatorEndpointSpecs | ForEach-Object { [string]$_.MediaPort }) -join ",")
        }
        Start-LocalService `
            -Name $serviceName `
            -WorkingDirectory (Join-Path $RepoRoot "bim-streaming-server") `
            -FilePath "powershell.exe" `
            -Arguments $streamingArguments
    }
}

if (-not $SkipViewer) {
    Start-LocalService `
        -Name "web-viewer-sample" `
        -WorkingDirectory (Join-Path $RepoRoot "web-viewer-sample") `
        -FilePath "npm.cmd" `
        -Arguments @("run", "dev", "--", "--host", "127.0.0.1")
}

Write-Host ""
Write-Host "=== Health probe ===" -ForegroundColor Cyan
if (-not $SkipCoordinator) {
    Wait-Health -Name "bim-review-coordinator(步驟 ③)" -Url "http://127.0.0.1:8004/health" -TimeoutSeconds $HealthTimeoutSeconds | Out-Null
}
if (-not $SkipViewer) {
    Wait-Health -Name "web-viewer-sample     (步驟 ④)" -Url "http://127.0.0.1:5173" -TimeoutSeconds $HealthTimeoutSeconds | Out-Null
}
if (-not $SkipConversionService) {
    Wait-Health -Name "bim-streaming-conversion-service (:49101)" -Url "http://127.0.0.1:49101/health" -TimeoutSeconds $HealthTimeoutSeconds | Out-Null
}
if (-not $SkipStreaming) {
    $kitSummary = ($KitEndpointSpecs | ForEach-Object { "$($_.Id)=$($_.SignalingServer):$($_.SignalingPort)/$($_.MediaPort)" }) -join ", "
    Write-Host "[note ] bim-streaming-server (Kit) 沒有 HTTP /health；請看 scripts/.run/bim-streaming-server*.log 確認啟動進度" -ForegroundColor DarkGray
    Write-Host "[note ] KIT_INSTANCE_ENDPOINTS: $kitSummary" -ForegroundColor DarkGray
    if ($KitSpectatorEndpointSpecs.Count -gt 0) {
        $spectatorSummary = ($KitSpectatorEndpointSpecs | ForEach-Object { "spectator[$($_.Index)]=${ResolvedKitHost}:$($_.SignalingPort)/$($_.MediaPort)" }) -join ", "
        Write-Host "[note ] Kit spectator streams: $spectatorSummary" -ForegroundColor DarkGray
    }
}

Write-Host ""
Write-Host "=== Demo URLs ===" -ForegroundColor Cyan
Write-Host "③ 審查協調       http://127.0.0.1:8004/ui"
Write-Host "④ 瀏覽器審查端   http://127.0.0.1:5173"
Write-Host "（①/② Worker、⑤ 主資料庫已移除：外部平台由 tests/fakes 模擬，見 T3/T5）" -ForegroundColor DarkGray
Write-Host ""
Write-Host "停止所有服務：scripts\stop-all.ps1" -ForegroundColor DarkGray
Write-Host "查看 log：     Get-Content scripts\.run\<service>.log -Wait" -ForegroundColor DarkGray
