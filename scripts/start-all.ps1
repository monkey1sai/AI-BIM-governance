[CmdletBinding()]
param(
    [switch] $SkipStreaming,    # 跳過 bim-streaming-server (Kit GPU runtime)
    [switch] $SkipViewer,
    [switch] $SkipCoordinator,
    [switch] $Visible,           # 顯示 console 視窗 (預設背景隱藏)
    [int] $HealthTimeoutSeconds = 30
)

# 一鍵啟動 6 個服務。PID 寫到 scripts/.run/<svc>.pid，stdout/stderr 寫到 scripts/.run/<svc>.log。
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

function Start-Service {
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
        } catch {}
        Start-Sleep -Milliseconds 500
    }
    Write-Host "[warn ] $Name 在 ${TimeoutSeconds}s 內未通過健康檢查 ($Url)" -ForegroundColor Yellow
    return $false
}

# === 啟動 6 個服務 ===

Start-Service `
    -Name "_s3_storage" `
    -WorkingDirectory (Join-Path $RepoRoot "_s3_storage") `
    -FilePath $Python `
    -Arguments @("-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "8002")

Start-Service `
    -Name "_bim-control" `
    -WorkingDirectory (Join-Path $RepoRoot "_bim-control") `
    -FilePath $Python `
    -Arguments @("-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "8001")

Start-Service `
    -Name "_conversion-service" `
    -WorkingDirectory (Join-Path $RepoRoot "_conversion-service") `
    -FilePath $Python `
    -Arguments @("-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "8003")

if (-not $SkipCoordinator) {
    Start-Service `
        -Name "bim-review-coordinator" `
        -WorkingDirectory (Join-Path $RepoRoot "bim-review-coordinator") `
        -FilePath "npm.cmd" `
        -Arguments @("run", "dev")
}

if (-not $SkipStreaming) {
    Start-Service `
        -Name "bim-streaming-server" `
        -WorkingDirectory (Join-Path $RepoRoot "bim-streaming-server") `
        -FilePath "powershell.exe" `
        -Arguments @(
            "-ExecutionPolicy", "Bypass",
            "-NoProfile",
            "-File", "$RepoRoot\bim-streaming-server\scripts\start-streaming-server.ps1",
            "-SkipAutoLoad"
        )
}

if (-not $SkipViewer) {
    Start-Service `
        -Name "web-viewer-sample" `
        -WorkingDirectory (Join-Path $RepoRoot "web-viewer-sample") `
        -FilePath "npm.cmd" `
        -Arguments @("run", "dev", "--", "--host", "127.0.0.1")
}

Write-Host ""
Write-Host "=== Health probe ===" -ForegroundColor Cyan
Wait-Health -Name "_s3_storage           (步驟 ①)" -Url "http://127.0.0.1:8002/health" -TimeoutSeconds $HealthTimeoutSeconds | Out-Null
Wait-Health -Name "_bim-control          (步驟 ⑤)" -Url "http://127.0.0.1:8001/health" -TimeoutSeconds $HealthTimeoutSeconds | Out-Null
Wait-Health -Name "_conversion-service   (步驟 ②)" -Url "http://127.0.0.1:8003/health" -TimeoutSeconds $HealthTimeoutSeconds | Out-Null
if (-not $SkipCoordinator) {
    Wait-Health -Name "bim-review-coordinator(步驟 ③)" -Url "http://127.0.0.1:8004/health" -TimeoutSeconds $HealthTimeoutSeconds | Out-Null
}
if (-not $SkipViewer) {
    Wait-Health -Name "web-viewer-sample     (步驟 ④)" -Url "http://127.0.0.1:5173" -TimeoutSeconds $HealthTimeoutSeconds | Out-Null
}
if (-not $SkipStreaming) {
    Write-Host "[note ] bim-streaming-server (Kit) 沒有 HTTP /health；請看 scripts/.run/bim-streaming-server.log 確認啟動進度" -ForegroundColor DarkGray
}

Write-Host ""
Write-Host "=== Demo URLs ===" -ForegroundColor Cyan
Write-Host "① 雲端倉庫       http://127.0.0.1:8002"
Write-Host "② 模型轉換       http://127.0.0.1:8003"
Write-Host "③ 審查協調       http://127.0.0.1:8004/ui"
Write-Host "④ 瀏覽器審查端   http://127.0.0.1:5173"
Write-Host "⑤ 主資料庫       http://127.0.0.1:8001"
Write-Host ""
Write-Host "停止所有服務：scripts\stop-all.ps1" -ForegroundColor DarkGray
Write-Host "查看 log：     Get-Content scripts\.run\<service>.log -Wait" -ForegroundColor DarkGray
