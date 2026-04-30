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

Start-LocalProcess `
    -Name "_bim-control" `
    -WorkingDirectory (Join-Path $RepoRoot "_bim-control") `
    -Command "`"$Python`" -m uvicorn app.main:app --host 127.0.0.1 --port 8001 --reload"

Start-LocalProcess `
    -Name "_s3_storage" `
    -WorkingDirectory (Join-Path $RepoRoot "_s3_storage") `
    -Command "`"$Python`" -m uvicorn app.main:app --host 127.0.0.1 --port 8002 --reload"

Start-LocalProcess `
    -Name "_conversion-service" `
    -WorkingDirectory (Join-Path $RepoRoot "_conversion-service") `
    -Command "`"$Python`" -m uvicorn app.main:app --host 127.0.0.1 --port 8003 --reload"

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

Write-Host "[start] fake services, coordinator, and viewer start commands submitted"
Write-Host "[start] start bim-streaming-server separately when Kit runtime is needed"
