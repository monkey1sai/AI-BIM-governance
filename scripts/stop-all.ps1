[CmdletBinding()]
param(
    [switch] $KeepLogs   # 保留 .run/<svc>.log
)

# 一鍵關閉 6 個服務（與 start-all.ps1 對應）。
# 對每個 PID 做 tree-kill：taskkill /F /T，連子行程 (例如 Kit) 一起終結。

Set-StrictMode -Version Latest
$ErrorActionPreference = "Continue"

$RunDir = Join-Path $PSScriptRoot ".run"
if (-not (Test-Path $RunDir)) {
    Write-Host "[stop ] 沒有 scripts/.run/ 目錄，視為未啟動" -ForegroundColor DarkGray
    return
}

$pidFiles = Get-ChildItem -Path $RunDir -Filter "*.pid" -ErrorAction SilentlyContinue
if (-not $pidFiles -or $pidFiles.Count -eq 0) {
    Write-Host "[stop ] 找不到任何 PID 檔，視為未啟動" -ForegroundColor DarkGray
    return
}

foreach ($f in $pidFiles) {
    $name = [System.IO.Path]::GetFileNameWithoutExtension($f.Name)
    $procId = Get-Content $f.FullName -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $procId) {
        Remove-Item $f.FullName -Force -ErrorAction SilentlyContinue
        continue
    }

    try {
        $proc = Get-Process -Id $procId -ErrorAction Stop
        Write-Host "[stop ] $name (PID=$procId) ..." -ForegroundColor Cyan
        # tree-kill：連同子行程 (Kit / Node / Python child) 一起終結
        & taskkill.exe /F /T /PID $procId 2>&1 | Out-Null
    } catch {
        Write-Host "[skip ] $name (PID=$procId) 已不存在" -ForegroundColor DarkGray
    }

    Remove-Item $f.FullName -Force -ErrorAction SilentlyContinue
    if (-not $KeepLogs) {
        Remove-Item (Join-Path $RunDir "$name.log") -Force -ErrorAction SilentlyContinue
        Remove-Item (Join-Path $RunDir "$name.log.err") -Force -ErrorAction SilentlyContinue
    }
}

Write-Host ""
Write-Host "[done ] 全部服務已停止" -ForegroundColor Green
