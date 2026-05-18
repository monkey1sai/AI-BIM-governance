[CmdletBinding()]
param(
    [switch] $SkipViewer,
    [switch] $SkipCoordinator,
    [switch] $Visible
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$Python = Join-Path $RepoRoot ".venv\Scripts\python.exe"
if (-not (Test-Path $Python)) {
    $Python = "python"
}

$windowStyle = if ($Visible) { "Normal" } else { "Hidden" }

function Start-LocalProcess {
    param(
        [string] $Name,
        [string] $WorkingDirectory,
        [string] $Command
    )

    Write-Host "[start] $Name"
    Start-Process `
        -FilePath "cmd.exe" `
        -ArgumentList @("/c", $Command) `
        -WorkingDirectory $WorkingDirectory `
        -WindowStyle $windowStyle
}

# B-scheme（local-coordinator-ifc-ready-intake-boundary T2）：
# `_worker` / `_bim-control` 已自 repo 刪除（外部平台由 tests/fakes 模擬）。
# 此腳本只啟動 coordinator + viewer；對外 intake 收斂於 coordinator（T3）。

if (-not $SkipCoordinator) {
    Start-LocalProcess `
        -Name "bim-review-coordinator" `
        -WorkingDirectory (Join-Path $RepoRoot "bim-review-coordinator") `
        -Command "npm.cmd run dev"
}

if (-not $SkipViewer) {
    Start-LocalProcess `
        -Name "web-viewer-sample" `
        -WorkingDirectory (Join-Path $RepoRoot "web-viewer-sample") `
        -Command "npm.cmd run dev -- --host 127.0.0.1"
}

Write-Host "[start] worker-only demo services, coordinator, and viewer start commands submitted"
Write-Host "[start] start bim-streaming-server separately when Kit runtime is needed"
