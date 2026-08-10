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
$cadHardener = Get-Content -Raw (Join-Path $RepoRoot 'bim-streaming-server\scripts\harden-cad-extension-cache.py')
$kitGateway = Get-Content -Raw (Join-Path $RepoRoot 'services\kit-manager-api\app\kit_gateway.py')
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
Assert-Contains $deploy "if (-not `$SkipConversion -and (Get-PlatformName) -eq 'linux')" 'deploy.ps1 must harden the CAD entrypoint only on the Linux conversion path'
Assert-Contains $deploy 'harden-cad-extension-cache.py' 'deploy.ps1 must invoke the checked-in CAD cache hardener'
Assert-Contains $deploy "Get-DeployEnvValue -Name 'STREAMING_CONVERSION_HOOPS_MAIN'" 'Linux deploy must reject an unpinned explicit HOOPS override'
Assert-Contains $deploy '[System.IO.File]::GetUnixFileMode($hardenerPython)' 'Linux deploy must prove the hardener interpreter is executable'
Assert-Contains $deploy '[System.Diagnostics.ProcessStartInfo]::new()' 'Linux deploy must launch the hardener through a process with a reliable ExitCode'
Assert-Contains $deploy '$process.ExitCode' 'Linux deploy must read the hardener process ExitCode directly'
Assert-Contains $deploy "[string]`$status.status -ceq 'passed'" 'Linux deploy must require the hardener passed JSON contract'
Assert-Contains $cadHardener 'harden_default_hoops_main_permissions' 'CAD cache hardener must reuse the adapter trust-boundary implementation'
Assert-Contains $cadHardener 'cad-extension-cache-hardening/v1' 'CAD cache hardener must emit the stable redacted result schema'
Assert-Contains $deploy 'coordinator-governance-files-tree' 'deploy.ps1 must verify coordinator to governance proxy'
Assert-Contains $launcher 'function Start-HostNativeGovernance' 'launcher must define Start-HostNativeGovernance'
Assert-Contains $launcher "-Name 'governance-service'" 'launcher must use governance-service PID/log name'
Assert-Contains $launcher "RUNTIME_MODE = 'hybrid-web-plane-host-native-kit'" 'host-native Kit Manager must publish the hybrid runtime identity'
Assert-Contains $launcher "HOST_LOCAL_RUNTIME_ALLOWED = 'true'" 'host-native Kit Manager must allow the host-local runtime authority'
Assert-Contains $launcher "KIT_INSTANCE_ID = 'kit_local_001'" 'host-native Kit Manager must target the launched Kit instance'
Assert-Contains $launcher 'KIT_CONTROL_URL = $normalizedKitControlUrl' 'host-native Kit Manager must use only a validated explicit control authority or the empty blocked state'
Assert-Contains $launcher 'function Test-HostNativeLocalAddress' 'host-native Kit Manager must verify that its conversion authority is local'
Assert-Contains $launcher 'KitControlUrl host must be loopback or an address assigned to this host.' 'host-native Kit Manager must reject remote Kit control targets'
Assert-Contains $launcher 'return $importProcess.ExitCode' 'host-native Kit Manager import probe must read a real process ExitCode'
Assert-Contains $deploy "Get-DeployEnvValue -Name 'KIT_CONTROL_URL'" 'deploy.ps1 must preserve an explicit Kit control authority instead of inventing conversion runtime routes'
Assert-Contains $deploy 'Resolve-HostNativeKitControlUrl' 'deploy.ps1 must canonicalize and validate Kit control identity before writing its runtime signature'
Assert-Contains $deploy '-KitControlUrl $resolvedKitControlUrl' 'deploy.ps1 must pass the explicit or empty Kit control authority to the child'
Assert-Contains $kitGateway 'blocked_runtime_control_unconfigured' 'an empty Kit control authority must produce an honest blocked state without network access'
Assert-Contains $deploy 'http://${resolvedConversionHealthHost}:49101/health' 'strict post-verify must probe the effective conversion health host'
Assert-Contains $stopAll 'governance-service' 'stop-all.ps1 must know governance-service'
Assert-Contains $stopAll 'if ($remaining.Count -gt 0)' 'stop-all.ps1 must fail closed when any expected listener remains'
Assert-Contains $stopAll 'owner-not-visible' 'stop-all.ps1 must report a listener whose PID is hidden'
Assert-Contains $stopAll 'exit 2' 'stop-all.ps1 must return nonzero when an expected listener remains'
Assert-Contains $deploy "'port','coordinator','8004'" 'deploy.ps1 must prove the current Compose coordinator publication before treating :8004 as owned'
Assert-Contains $deploy "'port','viewer','5173'" 'deploy.ps1 must prove the current Compose viewer publication before treating :5173 as owned'
Assert-Contains $deploy 'refusing an ownership-blind stop' 'deploy.ps1 must fail closed when an occupied listener PID is hidden'
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
$hardenerFunction = @($deployAst.FindAll({
    param($node)
    $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and
        $node.Name -eq 'Invoke-CadExtensionCacheHardener'
}, $true))
if ($hardenerFunction.Count -ne 1) {
    throw 'deploy.ps1 must define exactly one Invoke-CadExtensionCacheHardener helper'
}
. ([scriptblock]::Create($hardenerFunction[0].Extent.Text))
$hardenerSandbox = Join-Path ([System.IO.Path]::GetTempPath()) ("ai-bim-invalid-hardener-{0}" -f [guid]::NewGuid().ToString('N'))
try {
    New-Item -ItemType Directory -Path $hardenerSandbox -Force | Out-Null
    $invalidInterpreter = Join-Path $hardenerSandbox ($(if ($IsWindows) { 'invalid.exe' } else { 'invalid-python' }))
    $fixtureScript = Join-Path $hardenerSandbox 'fixture.py'
    [System.IO.File]::WriteAllText($invalidInterpreter, 'not an executable image')
    [System.IO.File]::WriteAllText($fixtureScript, 'print("unexpected")')
    $invalidResult = Invoke-CadExtensionCacheHardener `
        -PythonPath $invalidInterpreter `
        -ScriptPath $fixtureScript `
        -StreamingRepoRoot $hardenerSandbox
    if ($invalidResult.ExitCode -ne -1 -or $invalidResult.StatusValid) {
        throw 'invalid or non-executable hardener interpreter must fail closed'
    }
}
finally {
    if (Test-Path -LiteralPath $hardenerSandbox) {
        Remove-Item -LiteralPath $hardenerSandbox -Recurse -Force
    }
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

$kitBuildIndex = $deploy.IndexOf('Invoke-KitRepoBuild')
$cadHardeningIndex = $deploy.IndexOf('harden-cad-extension-cache.py')
$envMergeIndex = $deploy.IndexOf('# fix: .env / .env.example missing-key merge')
if ($kitBuildIndex -lt 0 -or $cadHardeningIndex -le $kitBuildIndex -or $envMergeIndex -le $cadHardeningIndex) {
    throw 'CAD cache hardening must run after the Kit build gate and before later deployment phases'
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

$legacyCleanupStart = $deploy.IndexOf('$legacyKitManagerRmArgs')
$legacyCleanupEnd = $deploy.IndexOf('# fix: 第一次 docker compose build', $legacyCleanupStart)
if ($legacyCleanupStart -lt 0 -or $legacyCleanupEnd -le $legacyCleanupStart) {
    throw 'deploy.ps1 must retain the bounded legacy kit-manager cleanup block'
}
$legacyCleanup = $deploy.Substring($legacyCleanupStart, $legacyCleanupEnd - $legacyCleanupStart)
Assert-Contains $legacyCleanup "'rm','-f','-s','kit-manager-api'" 'legacy cleanup must remove only the precise Compose kit-manager-api service'
if ($legacyCleanup -match "'down'|--remove-orphans") {
    throw 'legacy kit-manager cleanup must not broaden into compose down or orphan removal'
}
$kitManagerPreflightWiring = [regex]::Matches($deploy, 'if \(-not \$SkipKitManager\) \{ \$extraHostNativePorts \+= 8010 \}')
if ($kitManagerPreflightWiring.Count -ne 2) {
    throw 'deploy.ps1 must include host-native kit-manager port 8010 in both the initial and Phase 3 port audits'
}

[scriptblock]::Create($deploy) | Out-Null
[scriptblock]::Create($launcher) | Out-Null
[scriptblock]::Create($stopAll) | Out-Null
Write-Host 'PASS deploy governance static checks'
