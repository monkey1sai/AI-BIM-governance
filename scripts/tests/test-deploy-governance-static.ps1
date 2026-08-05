Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$RepoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$deployPath = Join-Path $RepoRoot 'scripts\deploy.ps1'
$deployBytes = [System.IO.File]::ReadAllBytes($deployPath)
if ($deployBytes.Count -lt 3 -or $deployBytes[0] -ne 0xEF -or $deployBytes[1] -ne 0xBB -or $deployBytes[2] -ne 0xBF) {
    throw 'deploy.ps1 must use a UTF-8 BOM so Windows PowerShell 5.1 does not decode non-ASCII strings through the active ANSI code page'
}
$deploy = Get-Content -Raw $deployPath
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
Assert-Contains $deploy "Join-Path `$RunDir 'web-plane.params.json'" 'deploy.ps1 must persist effective web-plane inputs separately'
Assert-Contains $deploy 'function New-WebPlaneRuntimeSignature' 'deploy.ps1 must build a secret-safe effective web-plane signature'
Assert-Contains $deploy 'Test-KitRuntimeSignatureMatches -Path $script:webPlaneRuntimeSignaturePath' 'deploy.ps1 must compare the effective web-plane signature before refresh'
Assert-Contains $deploy 'Set-KitRuntimeSignature -Path $script:webPlaneRuntimeSignaturePath' 'deploy.ps1 must persist the web-plane signature after reconcile'
Assert-Contains $deploy '-ArtifactsRoot $resolvedConversionArtifactsRoot' 'conversion runtime signature must track its effective output root'
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

$parserTokens = $null
$parserErrors = $null
$deployAst = [System.Management.Automation.Language.Parser]::ParseInput($deploy, [ref]$parserTokens, [ref]$parserErrors)
if (@($parserErrors).Count -ne 0) {
    throw 'deploy.ps1 must parse before governance static inspection'
}
$refreshFunction = @($deployAst.FindAll({
    param($node)
    $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and
        $node.Name -eq 'Test-WebPlaneRefreshRequired'
}, $true))
if ($refreshFunction.Count -ne 1) {
    throw 'deploy.ps1 must define exactly one Test-WebPlaneRefreshRequired helper'
}
$refreshFunctionText = $refreshFunction[0].Extent.Text
if ($refreshFunctionText -match "'A4_INTERNAL_CONTEXT_TOKEN'" -or $refreshFunctionText -match "'A4_CONVERSION_ARTIFACTS_HOST_ROOT'") {
    throw 'script-derived A4 values must use effective signatures, not presence-only web-plane refresh triggers'
}

$dockerFailureIndex = $deploy.IndexOf('if ($dockerExit -ne 0)')
$webPlaneSignatureSaveIndex = $deploy.IndexOf('Set-KitRuntimeSignature -Path $script:webPlaneRuntimeSignaturePath')
if ($dockerFailureIndex -lt 0 -or $webPlaneSignatureSaveIndex -le $dockerFailureIndex) {
    throw 'web-plane signature must be persisted only after docker compose succeeds'
}

# Hybrid mode must not start a CONTAINERISED kit-manager-api. `compose up
# coordinator viewer` used to pull it in through coordinator's depends_on, and
# that service publishes 127.0.0.1:8010 - the same port deploy.ps1 Phase 4c-2
# gives the host-native kit-manager. Linux refuses the second bind (Phase 4d died
# with "address already in use"); Windows only tolerated it because SO_REUSEADDR
# lets a second socket take the same addr:port, leaving it undefined which one
# actually answered :8010.
if ($hostKitCompose -notmatch 'depends_on:\s*!override\s*\[\]') {
    throw 'compose.host-kit.yml must clear coordinator depends_on (!override []) so hybrid mode does not start the containerised kit-manager-api on the host-native :8010'
}
if ($hostKitCompose -notmatch 'KIT_MANAGER_API_BASE:\s*\$\{HOST_KIT_MANAGER_API_BASE:-http://host\.docker\.internal:8010\}') {
    throw 'compose.host-kit.yml must route the coordinator to the HOST-NATIVE kit-manager (host.docker.internal:8010); clearing depends_on without this would leave it with no kit-manager at all'
}

[scriptblock]::Create($deploy) | Out-Null
[scriptblock]::Create($launcher) | Out-Null
[scriptblock]::Create($stopAll) | Out-Null
Write-Host 'PASS deploy governance static checks'
