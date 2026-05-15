[CmdletBinding()]
param(
    [switch] $WithGpu,
    [switch] $RemoveVolumes
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$ArgsList = @("compose", "-f", "compose.runtime-manager.yml", "--env-file", ".env.runtime-manager.docker")

if ($WithGpu) {
    $ArgsList += @("--profile", "gpu")
}

$ArgsList += "down"

if ($RemoveVolumes) {
    $ArgsList += "--volumes"
}

Write-Host "[runtime] docker $($ArgsList -join ' ')" -ForegroundColor Cyan
docker @ArgsList
