[CmdletBinding()]
param(
    [switch] $Build,
    [switch] $WithGpu
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
. (Join-Path $PSScriptRoot 'lib\design-assets.ps1')
$designAssetStage = Sync-DeploymentDesignAssets -RepoRoot $repoRoot
Write-Host "[runtime] design assets $($designAssetStage.Mode) count=$($designAssetStage.Count)" -ForegroundColor Cyan

$ArgsList = @("compose", "-f", "compose.runtime-manager.yml", "--env-file", ".env.runtime-manager.docker")

if ($WithGpu) {
    $ArgsList += @("--profile", "gpu")
}

if ($WithGpu -and $Build) {
    $GpuBuildArgs = $ArgsList + @("build", "streaming-server")
    Write-Host "[runtime] docker $($GpuBuildArgs -join ' ')" -ForegroundColor Cyan
    docker @GpuBuildArgs
    if ($LASTEXITCODE -ne 0) {
        throw "failed_linux_kit_build: streaming-server GPU image build failed"
    }
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
