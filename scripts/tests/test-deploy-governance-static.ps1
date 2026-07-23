Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$RepoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$deploy = Get-Content -Raw (Join-Path $RepoRoot 'scripts\deploy.ps1')
$launcher = Get-Content -Raw (Join-Path $RepoRoot 'scripts\lib\host-native-launcher.ps1')
$stopAll = Get-Content -Raw (Join-Path $RepoRoot 'scripts\stop-all.ps1')
$hostKitCompose = Get-Content -Raw (Join-Path $RepoRoot 'compose.host-kit.yml')
$hostKitExample = Get-Content -Raw (Join-Path $RepoRoot '.env.web-plane.host-kit.example')

function Assert-Contains {
    param([string] $Text, [string] $Pattern, [string] $Message)
    if ($Text -notmatch [regex]::Escape($Pattern)) {
        throw $Message
    }
}

Assert-Contains $deploy '[switch] $SkipGovernance' 'deploy.ps1 must expose -SkipGovernance'
Assert-Contains $deploy '[int]    $GovernancePort = 49102' 'deploy.ps1 must expose -GovernancePort 49102'
Assert-Contains $deploy 'Start-HostNativeGovernance' 'deploy.ps1 must start governance through host-native launcher'
Assert-Contains $deploy 'HOST_GOVERNANCE_API_BASE' 'deploy.ps1 must inject coordinator governance base URL'
Assert-Contains $deploy "'HOST_GOVERNANCE_API_BASE'" 'deploy.ps1 must consider governance base URL in web-plane refresh inputs'
Assert-Contains $deploy "'A4_INTERNAL_CONTEXT_TOKEN'" 'deploy.ps1 must inject and refresh the A4 shared token without embedding it'
Assert-Contains $deploy 'A4InternalContextTokenFingerprint' 'governance runtime signature must react to A4 token rotation'
Assert-Contains $deploy "[Environment]::SetEnvironmentVariable('A4_CONVERSION_ARTIFACTS_HOST_ROOT'" 'deploy.ps1 must inject an absolute host-native artifacts namespace'
Assert-Contains $deploy '$shouldRefreshWebPlane = $true' 'deploy.ps1 must force web-plane refresh for custom governance port'
Assert-Contains $deploy 'coordinator-governance-files-tree' 'deploy.ps1 must verify coordinator to governance proxy'
Assert-Contains $launcher 'function Start-HostNativeGovernance' 'launcher must define Start-HostNativeGovernance'
Assert-Contains $launcher "-Name 'governance-service'" 'launcher must use governance-service PID/log name'
Assert-Contains $stopAll 'governance-service' 'stop-all.ps1 must know governance-service'
Assert-Contains $hostKitCompose 'A4_TRUSTED_GOVERNANCE_ORIGINS: ${HOST_GOVERNANCE_API_BASE:-http://host.docker.internal:49102}' 'host-kit must explicitly allow only its configured governance bridge origin'
Assert-Contains $hostKitCompose 'A4_INTERNAL_CONTEXT_TOKEN: ${A4_INTERNAL_CONTEXT_TOKEN:-}' 'host-kit must pass the A4 token through environment substitution'
Assert-Contains $hostKitCompose ':/workspace/a4-conversion-artifacts:ro' 'host-kit must mount conversion artifacts read-only for mapping provenance'
Assert-Contains $hostKitCompose 'A4_CONVERSION_ARTIFACTS_HOST_ROOT: ${A4_CONVERSION_ARTIFACTS_HOST_ROOT:-}' 'host-kit must pass the separately resolved host namespace'
Assert-Contains $hostKitExample 'A4_INTERNAL_CONTEXT_TOKEN=' 'host-kit example must document an empty secret placeholder'

$clearUserSite = $launcher.IndexOf('Remove-Item Env:PYTHONNOUSERSITE')
$importCheck = $launcher.IndexOf('import ifcopenshell, fastapi, uvicorn')
if ($clearUserSite -lt 0 -or $importCheck -lt 0 -or $clearUserSite -gt $importCheck) {
    throw 'launcher must clear PYTHONNOUSERSITE before governance import sanity check'
}

[scriptblock]::Create($deploy) | Out-Null
[scriptblock]::Create($launcher) | Out-Null
[scriptblock]::Create($stopAll) | Out-Null
Write-Host 'PASS deploy governance static checks'
