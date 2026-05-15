[CmdletBinding()]
param(
    [switch] $Build,
    [switch] $WithGpu
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$ArgsList = @("compose", "-f", "compose.runtime-manager.yml", "--env-file", ".env.runtime-manager.docker")

if ($WithGpu) {
    $ArgsList += @("--profile", "gpu")
}

$ArgsList += "up"
$ArgsList += "-d"

if ($Build) {
    $ArgsList += "--build"
}

Write-Host "[runtime] docker $($ArgsList -join ' ')" -ForegroundColor Cyan
docker @ArgsList

Write-Host ""
Write-Host "Kit Manager: http://127.0.0.1:5174" -ForegroundColor Green
Write-Host "Viewer:      http://127.0.0.1:5173" -ForegroundColor Green
