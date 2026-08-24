[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'test-helpers.ps1')

$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$runnerPath = Join-Path $repoRoot 'scripts\dev\run-runtime-command-authority-host-native-evidence.ps1'
$e2ePath = Join-Path $repoRoot 'web-viewer-sample\e2e\runtime-command-authority-host-native.spec.ts'
$playwrightConfigPath = Join-Path $repoRoot 'web-viewer-sample\playwright.config.ts'

Assert-True (Test-Path -LiteralPath $runnerPath -PathType Leaf) 'host-native authority evidence runner exists'
Assert-True (Test-Path -LiteralPath $playwrightConfigPath -PathType Leaf) 'Playwright config exists'

$runner = Get-Content -LiteralPath $runnerPath -Raw
$e2e = Get-Content -LiteralPath $e2ePath -Raw
$playwrightConfig = Get-Content -LiteralPath $playwrightConfigPath -Raw
$browserLaunchSurface = "$playwrightConfig`n$e2e"

Assert-True ($runner -match [regex]::Escape('[Parameter(Mandatory = $true)][string] $WorktreeRoot')) 'runner requires an explicit worktree root'
Assert-True ($runner -match [regex]::Escape('[Parameter(Mandatory = $true)][string] $EvidenceRoot')) 'runner requires an explicit contained evidence root'
Assert-True ($runner -match [regex]::Escape('[Parameter(Mandatory = $true)][string] $KitReleaseRoot')) 'runner requires the isolated worktree Kit release root'
Assert-True ($runner -match [regex]::Escape('[string] $ExpectedKitExecutableSha256')) 'runner requires a caller-pinned post-build Kit executable hash'
Assert-True ($runner -match [regex]::Escape('[string] $ExpectedAppKitSha256')) 'runner requires a caller-pinned post-build app kit hash'
Assert-True ($runner -match [regex]::Escape('[Parameter(Mandatory = $true)][string] $StageArtifactPath')) 'runner requires an explicit binary USDC source'
Assert-True ($runner -match [regex]::Escape('[Parameter(Mandatory = $true)][string] $StageSourceIfcPath')) 'runner requires the reviewed IFC source paired with the USDC fixture'
Assert-True ($runner -match [regex]::Escape('[string] $ExpectedOwnerSid')) 'runner requires an externally pinned owner SID'
Assert-True ($runner -match [regex]::Escape('[switch] $PreflightOnly')) 'runner exposes a runtime-free preflight mode'
Assert-True ($runner -match [regex]::Escape("CoordinatorBaseUrl must be exactly http://127.0.0.1:8005.")) 'runner pins its isolated coordinator to loopback 8005'
Assert-True ($runner -match [regex]::Escape("AuthorityIngressBaseUrl must be exactly http://127.0.0.1:8006.")) 'runner pins authority ingress to loopback 8006'
Assert-True ($runner -match [regex]::Escape('This list intentionally excludes every deployment-owned port, especially 49100.')) 'runner documents that deployment ports are excluded from its target set'
Assert-True ($runner -match [regex]::Escape('PXR-USDC')) 'preflight rejects non-USDC stage inputs'
Assert-True ($runner -match [regex]::Escape('$script:StageArtifactMaxBytes = 536870912')) 'preflight caps the stage artifact at the Kit loader limit'
Assert-True ($runner -match [regex]::Escape('$script:KnownStageArtifactSha256')) 'preflight pins the reviewed USDC fixture digest'
Assert-True ($runner -match [regex]::Escape('$script:KnownStageSourceIfcSha256')) 'preflight pins the paired IFC source digest'
Assert-True ($runner -match [regex]::Escape('known_repo_local_renderable_fixture_not_current_worker_produced')) 'runner does not overclaim the fixture as a fresh conversion'
Assert-True ($runner -match [regex]::Escape('127.0.0.1:49081 and localhost:49081')) 'preflight pins both stage URLs to the runner-owned loopback server'
Assert-True ($runner -match 'function Get-NativeDynamicTcpPortRanges') 'preflight reads the actual Windows dynamic TCP ranges'
Assert-True ($runner -match [regex]::Escape('The runner-owned stage port overlaps a configured Windows dynamic TCP range.')) 'preflight rejects a dynamically allocated stage port'
Assert-True ($runner -match [regex]::Escape("Assert-ProbePortAllowed -Name 'StageServerPort'")) 'stage server reuses the isolated Kit reserved-port policy'
Assert-True ($runner -match [regex]::Escape('No process was stopped.')) 'occupied isolated ports fail closed without stopping a process'
Assert-True ($runner -match 'function Get-GitSafeDirectoryArgument') 'runner centralizes path-normalized safe.directory arguments'
Assert-True ($runner -match [regex]::Escape("Replace('\', '/')")) 'runner normalizes Windows paths for Git safe.directory matching'
$preflightGuardIndex = $runner.IndexOf("if (`$PreflightOnly)")
$isolatedFullModeIndex = $runner.IndexOf('function Get-IsolatedGitStatus')
Assert-True ($preflightGuardIndex -ge 0 -and $isolatedFullModeIndex -gt $preflightGuardIndex) 'preflight returns before isolated full-mode orchestration'
Assert-True (-not ($runner -match [regex]::Escape('The isolated runtime composition is not implemented yet'))) 'full mode no longer stops at the staged-replacement guard'
Write-TestPass 'isolated worktree preflight contract'

Assert-True ($runner -match [regex]::Escape(". (Join-Path `$PSScriptRoot 'start-isolated-branch-stack.ps1')")) 'runner reuses reviewed isolated process primitives by dot-source'
Assert-True ($runner -match 'function New-RunScopedInternalApiAuthToken') 'runner generates a per-run internal authority token'
Assert-True ($runner -match 'function New-IsolatedCoordinatorEnvironment') 'runner builds a run-scoped coordinator environment'
Assert-True ($runner -match [regex]::Escape('ConvertTo-Json -AsArray -Compress -Depth 4')) 'coordinator endpoint JSON cannot collapse a single endpoint into an object'
$endpointShapeJson = @([ordered]@{
    id = 'runtime-regression'
    signalingServer = '127.0.0.1'
    signalingPort = 49131
    mediaServer = '127.0.0.1'
    mediaPort = 48031
}) | ConvertTo-Json -AsArray -Compress -Depth 4
$endpointShapeDocument = [Text.Json.JsonDocument]::Parse($endpointShapeJson)
try {
    Assert-True (
        $endpointShapeDocument.RootElement.ValueKind -eq [Text.Json.JsonValueKind]::Array `
        -and $endpointShapeDocument.RootElement.GetArrayLength() -eq 1
    ) 'coordinator endpoint JSON parses as an exact one-element array'
}
finally {
    $endpointShapeDocument.Dispose()
}
Assert-True ($runner -match 'function Start-RunnerOwnedCoordinator') 'runner owns the isolated coordinator child'
Assert-True ($runner -match 'function New-AuthorityIngressProxySource') 'runner generates a token-free authority ingress proxy'
Assert-True ($runner -match 'function Start-RunnerOwnedAuthorityIngress') 'runner owns the authority ingress child'
Assert-True ($runner -match [regex]::Escape('UseNewEnvironment = $true')) 'runner starts children with a new environment'
Assert-True ($runner -match [regex]::Escape('Environment = $Environment')) 'runner supplies only the explicit child environment map'
Assert-True ($runner -match [regex]::Escape('Start-Process @startParameters')) 'runner applies hardened child launch parameters through splatting'
Assert-True ($runner -match [regex]::Escape('$startInfo.RedirectStandardOutput = $true')) 'no-output child path captures stdout instead of inheriting the session handle'
Assert-True ($runner -match [regex]::Escape('$startInfo.RedirectStandardError = $true')) 'no-output child path captures stderr instead of inheriting the session handle'
Assert-True ($runner -match [regex]::Escape('$child.BeginOutputReadLine()')) 'runner asynchronously drains and discards child stdout'
Assert-True ($runner -match [regex]::Escape('$child.BeginErrorReadLine()')) 'runner asynchronously drains and discards child stderr'
Assert-True ($runner -match [regex]::Escape('INTERNAL_API_AUTH_TOKEN = $InternalAuthToken')) 'coordinator token is supplied only through its environment map'
Assert-True (-not ($runner -match [regex]::Escape('PayloadBase64'))) 'runner does not put its authority token environment into a command-line payload'
Assert-True ($runner -match [regex]::Escape('127.0.0.1:8006')) 'authority ingress is loopback-only'
Assert-True ($runner -match [regex]::Escape('runtime-command-authorizations|stage-binding-authorization-rollbacks|stage-binding-confirmations')) 'proxy restricts forwarding to authority route families'
Assert-True ($runner -match [regex]::Escape('datachannel-trace-verifications')) 'proxy permits the trace verification route'
Assert-True (-not ($runner -match 'console\.(?:log|error)')) 'generated proxy never logs request material'
Assert-True ($runner -match [regex]::Escape('forwardedHeaders = new Set')) 'proxy forwards only an explicit header allowlist'
Assert-True ($runner -match [regex]::Escape('responseHeaders["x-trace-id"] = upstreamResponse.headers["x-trace-id"]')) 'proxy returns the coordinator trace identity required by Kit'
Assert-True (($runner | Select-String -Pattern '-NoPersistedOutput' -AllMatches).Matches.Count -ge 6) 'runner persists no raw stdout or stderr for runtime children or Playwright'
Assert-True ($runner -match [regex]::Escape('Stop-IsolatedBackends -Processes @($Identity)')) 'runner cleanup reuses pinned SafeHandle identity stop'
$generatedNodeSources = [regex]::Matches($runner, "(?s)\`$source = @'\r?\n(?<source>.*?)\r?\n'@")
Assert-True ($generatedNodeSources.Count -eq 2) 'static test extracts the two runner-owned Node sources'
foreach ($sourceMatch in $generatedNodeSources) {
    $generatedSource = $sourceMatch.Groups['source'].Value
    Assert-True (-not ($generatedSource -match [regex]::Escape('INTERNAL_API_AUTH_TOKEN'))) 'generated Node source contains no authority token name or value'
    $syntaxPath = Join-Path ([IO.Path]::GetTempPath()) "runtime-authority-source-$([guid]::NewGuid().ToString('N')).mjs"
    try {
        [IO.File]::WriteAllText($syntaxPath, "$generatedSource`n", [Text.UTF8Encoding]::new($false))
        & node --check $syntaxPath
        Assert-True ($LASTEXITCODE -eq 0) 'generated runner-owned Node source passes node --check'
    }
    finally {
        Remove-Item -LiteralPath $syntaxPath -Force -ErrorAction SilentlyContinue
    }
}
Write-TestPass 'runner-owned coordinator and authority ingress helper contract'

Assert-True ($runner -match 'function Copy-RunnerOwnedStageArtifact') 'runner creates a run-owned stage copy'
Assert-True ($runner -match [regex]::Escape('[IO.FileShare]::Read')) 'runner pins the stage copy against writes until cleanup'
Assert-True ($runner -match 'function New-RunnerOwnedStageServerSource') 'runner generates a minimal stage server'
Assert-True ($runner -match 'function Start-RunnerOwnedStageServer') 'runner owns the stage server child'
Assert-True ($runner -match 'function Remove-RunnerOwnedStageCacheArtifacts') 'runner derives and removes exact Kit stage cache files'
Assert-True ($runner -match [regex]::Escape('ComputeHash([Text.Encoding]::UTF8.GetBytes($stageUrl))')) 'stage cache cleanup mirrors the Kit URL SHA-256 key'
Assert-True ($runner -match [regex]::Escape('$stageCacheCleanupVerified -and $null -ne $stageArtifactCopy')) 'stage copy cleanup waits for exact cache cleanup'
Assert-True ($runner -match [regex]::Escape('[IO.FileMode]::CreateNew')) 'stage and control artifacts are never overwritten'
Assert-True ($runner -match [regex]::Escape('allowedHosts = new Set(["127.0.0.1:49081", "localhost:49081"])')) 'stage server rejects unexpected Host headers'
Assert-True ($runner -match [regex]::Escape('parsed.pathname !== "/model.usdc"')) 'stage server exposes only the exact model path'
Assert-True ($runner -match [regex]::Escape('crypto.timingSafeEqual')) 'stage server requires a per-run unguessable capability'
Assert-True ($runner -match [regex]::Escape('STAGE_ACCESS_CAPABILITY = $StageAccessCapability')) 'stage capability is supplied only through the child environment'
Assert-True ($runner -match [regex]::Escape('request.method !== "GET" && request.method !== "HEAD"')) 'stage server permits only read methods for the artifact'
Assert-True ($runner -match [regex]::Escape('Get-HttpNoRedirectProbe')) 'runner probes stage inputs without following redirects'
Assert-True ($runner -match [regex]::Escape('does_not_establish_general_product_redirect_safety')) 'runner discloses the product-wide redirect revalidation residual'
Assert-True ($runner -match [regex]::Escape('[System.Net.Http.HttpMethod]::Head')) 'stage probe verifies headers without streaming the BIM body'
Assert-True ($runner -match [regex]::Escape('The valid stage did not produce its expected runner-owned Kit cache artifact.')) 'cache cleanup requires the valid stage side effect'
Assert-True ($runner -match [regex]::Escape('A rejected stage URL produced a Kit cache artifact before denial.')) 'cache cleanup rejects a denied-stage side effect'
Assert-True ($runner -match [regex]::Escape('$residualEntries.Count -gt 0')) 'cache cleanup rejects any residual file or directory'
Assert-True ($runner -match [regex]::Escape('-RequireSuccessfulEvidence ($null -ne $nineCases)')) 'cache semantics are required only after a successful evidence result'
Write-TestPass 'runner-owned stage source contract'

Assert-True ($runner -match [regex]::Escape(". (Join-Path `$PSScriptRoot 'kit-message-probe\start-isolated-kit.ps1')")) 'runner imports the reviewed isolated Kit port policy'
Assert-True ($runner -match 'function Get-IsolatedKitRuntimePaths') 'runner resolves exact worktree Kit build paths'
Assert-True ($runner -match [regex]::Escape("'bim-streaming-server\_build\windows-x86_64\release'")) 'runner pins Kit release to the isolated worktree build tree'
Assert-True ($runner -match [regex]::Escape("release_provenance = 'isolated_worktree_build'")) 'runner records exact worktree build provenance class'
Assert-True ($runner -match 'function Assert-IsolatedKitPortPolicy') 'runner centralizes the imported Kit port policy'
Assert-True ($runner -match [regex]::Escape("Assert-ProbePortAllowed -Name 'SignalPort'")) 'runner reuses the probe reserved-port guard'
Assert-True ($runner -match [regex]::Escape("Assert-ProbePortFree -Name 'SignalPort'")) 'runner reuses the probe foreign-listener guard'
Assert-True ($runner -match 'function Start-RunnerOwnedIsolatedKit') 'runner owns the isolated Kit child'
Assert-True ($runner -match [regex]::Escape("COORDINATOR_INTERNAL_API_BASE = 'http://127.0.0.1:8006'")) 'Kit authority calls only the isolated ingress'
Assert-True ($runner -match [regex]::Escape('BIM_REVIEW_STREAM_ALLOWED_STAGE_HOSTS = $AllowedStageHosts')) 'Kit receives only caller-validated stage hosts'
Assert-True ($runner -match [regex]::Escape('BIM_REVIEW_STREAM_STAGE_CACHE = $stageCacheRoot')) 'Kit stage cache is contained by the run root'
Assert-True ($runner -match [regex]::Escape('$StartedIdentity.Value = $identity')) 'Kit identity is registered before readiness waits'
Assert-True ($runner -match [regex]::Escape('Test-IsolatedProcessOwnership -Expected $Identity -Actual $actual')) 'Kit readiness revalidates creation identity'
Assert-True ($runner -match [regex]::Escape('expected_executable_path')) 'runner binds child cleanup to exact executable path'
Assert-True (-not ($runner -match 'Invoke-IsolatedKitProbeCli|Start-ProbeIsolatedKit|Stop-ProbeIsolatedKit')) 'runner never calls the probe path that clears authority environment'
Write-TestPass 'runner-owned isolated Kit helper contract'

# Full mode must remain wholly inside runner-owned processes and the explicit
# worktree/evidence roots. Deployment services are observations, never targets.
Assert-True ($runner -match [regex]::Escape('$script:HostNativeEvidenceRole = ''agent_development_verification''')) 'runner stamps the isolated Windows evidence role'
Assert-True (-not ($runner -match '(?i)\bdocker\b')) 'runner contains no Docker control path'
Assert-True (-not ($runner -match [regex]::Escape('$deploymentRoot'))) 'runner contains no deployment checkout root'
Assert-True (-not ($runner -match [regex]::Escape('Get-DeployTarget'))) 'runner does not resolve a deployment target'
Assert-True (-not ($runner -match [regex]::Escape('http://127.0.0.1:8004'))) 'runner never targets the deployment coordinator port'
Assert-True ($runner -match [regex]::Escape('if (-not [bool]$isolatedPreflight.tracked_clean)')) 'full mode rejects a dirty worktree before evidence writes'
Assert-True ($runner -match [regex]::Escape('fetch origin --prune')) 'full mode freshly fetches origin/main'
Assert-True ($runner.IndexOf('$bootstrapProvenance = Invoke-HostNativeBootstrapProvenance') -lt $runner.IndexOf(". (Join-Path `$PSScriptRoot 'start-isolated-branch-stack.ps1')")) 'fresh provenance and ACL gates run before any branch helper is loaded'
Assert-True ($runner -match [regex]::Escape('HostNativeAllowedBranchDelta')) 'runner limits the full branch delta to an exact reviewed allowlist'
Assert-True ($runner -match [regex]::Escape('A bootstrap dependency differs from fresh origin/main')) 'runner pins dot-sourced helpers to fresh origin/main'
Assert-True ($runner -match [regex]::Escape('Assert-HostNativePathAcl -Path $fullPath -Mode source_integrity')) 'preflight and full mode reject broad-write helper ACLs'
Assert-True ($runner -match [regex]::Escape('merge-base --is-ancestor $originMainSha $headSha')) 'bootstrap proves origin/main is an ancestor of tested HEAD'
Assert-True ($runner -match [regex]::Escape('$headAfterCleanup -cne $testedHeadSha')) 'runner proves HEAD stayed fixed through cleanup'
Assert-True ($runner -match [regex]::Escape('$originMainAfterCleanup -cne $originMainSha')) 'runner proves the fetched origin/main identity stayed fixed through cleanup'
Assert-True ($runner -match [regex]::Escape('${testedHeadSha}:bim-streaming-server')) 'full mode identifies the tested Kit source subtree'
Assert-True ($runner -match [regex]::Escape('$originMainKitSourceTree -cne $testedKitSourceTree')) 'full mode requires Kit source equality with origin/main'
Assert-True ($runner -match [regex]::Escape('check-ignore -q -- $evidenceRepoPath')) 'full mode requires a gitignored evidence root'
Assert-True ($runner -match [regex]::Escape('ci --ignore-scripts --no-audit --no-fund')) 'runner disables dependency lifecycle scripts during isolated setup'
Assert-True ($runner -match [regex]::Escape('& $NodeExecutable $NpmCli ci --ignore-scripts --no-audit --no-fund')) 'runner invokes npm only through the pinned Node and npm CLI files'
Assert-True ($runner -match 'function Get-TrustedWindowsToolchain') 'runner validates the Windows Node/npm/Chrome toolchain'
Assert-True ($runner -match [regex]::Escape('O=OpenJS Foundation')) 'runner requires a valid OpenJS Node signature'
Assert-True ($runner -match [regex]::Escape('O=Google LLC')) 'runner requires a valid Google Chrome signature'
Assert-True ($runner -match [regex]::Escape('Assert-HostNativeTreeAcl -Root $coordinatorRoot')) 'runner checks the complete coordinator execution tree ACL'
Assert-True ($runner -match [regex]::Escape('Assert-HostNativeTreeAcl -Root $viewerRoot')) 'runner checks the complete viewer execution tree ACL'
Assert-True ($runner -match [regex]::Escape('2>&1 | Out-Null')) 'dependency output cannot contaminate structured evidence'
Assert-True ($runner -match [regex]::Escape("node_modules\tsx\dist\cli.mjs")) 'runner invokes the locked tsx ESM CLI with node'
Assert-True ($runner -match [regex]::Escape('node_modules\@playwright\test\cli.js')) 'runner invokes the locked local Playwright Node CLI'
Assert-True ($runner -match 'function Test-RunnerOwnedPlaywrightCollection') 'runner collects the derived spec before runtime startup'
Assert-True ($runner -match [regex]::Escape('E2E_COLLECTION_ONLY = ''1''')) 'collection proof cannot start the viewer web server'
Assert-True ($runner -match [regex]::Escape('Get-NativeBoundPortOwners -Ports @(49100)')) 'runner observes deployment Kit bound-port PID set before and after without controlling it'
Assert-True ($runner -match [regex]::Escape('native_bound_port_and_pid_set_only_process_metadata_access_limited')) 'runner does not overclaim creation identity for access-limited deployment Kit observation'
Assert-True ($runner -match [regex]::Escape('deployment_ports_controlled = @()')) 'published evidence records that no deployment port was controlled'
Assert-True ($runner -match [regex]::Escape('Wait-RunnerOwnedTcpListener -Port 8005')) 'runner proves isolated coordinator listener ownership'
Assert-True ($runner -match [regex]::Escape('Wait-RunnerOwnedTcpListener -Port 8006')) 'runner proves authority-ingress listener ownership'
Assert-True ($runner -match [regex]::Escape("LocalAddress -cne '127.0.0.1'")) 'runner rejects wildcard listeners on every isolated port'
Assert-True ($runner -match [regex]::Escape('ConvertTo-IsolatedCreationIdentity $AncestorIdentity.creation_identity')) 'listener ancestry is bound to creation identity rather than PID alone'
Assert-True ($runner -match [regex]::Escape('Get-NetUDPEndpoint -LocalPort $Port')) 'runner rejects foreign or wildcard UDP endpoints on isolated ports'
Assert-True ($runner -match [regex]::Escape('Wait-RunnerOwnedTcpListener -Port $script:RunnerOwnedStagePort')) 'runner proves stage-server listener ownership'
Assert-True ($runner -match [regex]::Escape("[string]`$_.LocalAddress -cne '127.0.0.1'")) 'runner rejects a wildcard stage-server listener'
Assert-True ($runner -match [regex]::Escape('Assert-RunnerOwnedUdpMediaPortNotForeign -Port 48031')) 'runner guards the lazily-bound Kit media UDP port against foreign owners'
Assert-True (-not ($runner -match [regex]::Escape('Wait-RunnerOwnedTcpListener -Port 48031'))) 'runner never waits for a TCP listener on the lazily-bound UDP media port'
Assert-True ($runner -match [regex]::Escape('$null = Stop-RunnerOwnedChild -Identity $authorityIngress')) 'outage stops only the exact-owned authority ingress'
Assert-True ($runner -match [regex]::Escape('authority_ingress_stopped = $true')) 'outage marker names the stopped authority ingress'
Assert-True ($runner -match [regex]::Escape('coordinator_process_stopped = $false')) 'outage marker explicitly says the coordinator process stayed alive'
Assert-True ($runner -match [regex]::Escape('authority_ingress_recovered = $true')) 'recovery marker names the recovered authority ingress'
Assert-True ($runner -match [regex]::Escape('coordinator_process_restarted = $false')) 'recovery marker explicitly says the coordinator was not restarted'
Assert-True ($runner -match [regex]::Escape("outage_handshake = 'runner-owned-authority-ingress'")) 'derived source emits the truthful outage label'
Assert-True (-not ($runner -match [regex]::Escape('legacy_source_handshake'))) 'runner publishes no false legacy handshake metadata'
Assert-True ($runner -match '(?s)try\s*\{.*finally\s*\{') 'runner has a finally cleanup boundary'
Assert-True (-not ($runner -match [regex]::Escape('Stop-RunnerOwnedProcessTree'))) 'runner has no PID-only Playwright cleanup path'
Assert-True (-not ($runner -match [regex]::Escape('taskkill.exe'))) 'runner never calls taskkill'
Assert-True ($runner -match [regex]::Escape('Stop-RunnerOwnedChild -Identity $e2eIdentity')) 'Playwright cleanup uses exact creation identity'
Assert-True ($runner -match 'function Assert-RunnerOwnedPortsReleased') 'runner verifies every isolated listener and endpoint is released after cleanup'
Assert-True ($runner -match [regex]::Escape('8005, 8006, $script:RunnerOwnedStagePort, 49131, 48031, $viewerPort')) 'cleanup release proof covers coordinator, ingress, stage, Kit, and viewer ports'
Assert-True ($runner -match [regex]::Escape('$null -eq $e2eProcess -or $e2eProcess.HasExited')) 'adapter cleanup waits for Playwright to exit'
Assert-True ($runner -match 'function Remove-RunnerOwnedDirectoryTree') 'runner has exact contained cleanup for raw Playwright output'
Assert-True ($runner -match [regex]::Escape("role = 'playwright_raw_output'; status = 'removed_exact_tree'")) 'raw Playwright output is removed after strict projection'
Assert-True (-not ($runner -match 'Split-Path\s+-LiteralPath\s+\$Path\s+-Parent')) 'runner uses a valid Split-Path parameter set for evidence directories'
Assert-True ($runner -match [regex]::Escape('Assert-NoReparsePointPath')) 'runner rejects reparse-point control and evidence paths'
Assert-True ($runner -match 'function Protect-RunnerOwnedPrivateDirectory') 'runner protects its exact GUID run root before writing evidence children'
Assert-True ($runner -match [regex]::Escape('SetAccessRuleProtection($true, $false)')) 'private run root removes inherited access rules'
Assert-True ($runner -match [regex]::Escape('Assert-HostNativePathAcl -Path $resolvedEvidenceRoot -Mode private_evidence')) 'full mode rejects a broad-read or broad-write evidence root'
Assert-True ($runner -match [regex]::Escape('$runRootAcl = Protect-RunnerOwnedPrivateDirectory')) 'full mode applies and records the private run-root ACL'
Assert-True ($runner -match [regex]::Escape('E2E_RUNTIME_AUTHORITY_CONTROL_NONCE')) 'runner requires a per-run control nonce'
Assert-True ($runner -match [regex]::Escape('[System.IO.FileMode]::CreateNew')) 'runner creates control markers without overwriting'
Assert-True ($runner -match [regex]::Escape('[System.Text.UTF8Encoding]::new($false)')) 'runner writes no-BOM control-marker JSON'
Assert-True ($runner -match [regex]::Escape('outage-ready.json')) 'runner waits for E2E readiness marker'
Assert-True ($runner -match [regex]::Escape('outage-go.json')) 'runner grants outage only after exact-owned stop proof'
Assert-True ($runner -match [regex]::Escape('outage-complete.json')) 'runner requires E2E completion marker'
Assert-True ($runner -match [regex]::Escape('PlaywrightEvidenceTimeoutSeconds')) 'runner aligns readiness and exit waits with the E2E evidence budget'
$e2eStartIndex = $runner.IndexOf('$e2eIdentity = Start-RunnerOwnedPlaywright')
$e2eMarkerWaitIndex = $runner.IndexOf('$outageReady = Wait-ForControlMarker')
Assert-True ($e2eStartIndex -ge 0 -and $e2eMarkerWaitIndex -gt $e2eStartIndex) 'runner exposes a bounded Playwright launch block'
$e2eLaunchBlock = $runner.Substring($e2eStartIndex, $e2eMarkerWaitIndex - $e2eStartIndex)
Assert-True (-not ($e2eLaunchBlock -match [regex]::Escape('-RedirectStandardOutput'))) 'runner does not persist raw Playwright stdout'
Assert-True (-not ($e2eLaunchBlock -match [regex]::Escape('-RedirectStandardError'))) 'runner does not persist raw Playwright stderr'
Assert-True (-not ($runner -match [regex]::Escape('playwright-stdout.log'))) 'runner keeps no raw Playwright stdout artifact'
Assert-True (-not ($runner -match [regex]::Escape('playwright-stderr.log'))) 'runner keeps no raw Playwright stderr artifact'
Assert-True ($runner -match 'function Assert-InternalTokenNotPersisted') 'runner scans all text evidence for its run-scoped internal token'
Assert-True ($runner -match [regex]::Escape('[REDACTED: runner-owned internal token detected]')) 'token scan redacts the exact unsafe artifact before failing'
Assert-True ($runner -match [regex]::Escape('all $($redactedFiles.Count) matches were redacted')) 'token scan redacts every matching artifact before throwing'
Assert-True ($runner -match 'function Remove-StageAccessCapabilityFromArtifacts') 'runner removes the per-run stage capability from all retained text artifacts'
Assert-True ($runner -match [regex]::Escape('[expired-redacted-stage-capability]')) 'stage capability cleanup uses an explicit expired redaction marker'
Assert-True ($runner -match [regex]::Escape('internal token persistence: $($_.Exception.Message)')) 'failure cleanup always performs the token scan'
Assert-True ($runner -match 'function New-AuthorityIngressE2EAdapter') 'runner derives an exact authority-ingress E2E adapter'
Assert-True ($runner -match [regex]::Escape('exact_count = 1')) 'adapter requires each reviewed substitution exactly once'
Assert-True ($runner -match [regex]::Escape('tracked_spec_sha256')) 'adapter evidence retains the tracked source hash'
Assert-True ($runner -match [regex]::Escape('to = ''  executablePath: process.env.E2E_TRUSTED_CHROME_PATH,''')) 'adapter pins Playwright to the verified Chrome executable'
Assert-True ($runner -match [regex]::Escape('stage=runner-owned capability URL (expired after capture)')) 'captured screenshot cannot display the stage capability'
Assert-True ($runner -match [regex]::Escape('to = ''    dependency_source_post_merge: true,''')) 'adapter avoids claiming that its own unmerged harness is post-merge'
Assert-True (-not ($runner -match [regex]::Escape('post_merge_corrective = $true'))) 'runner publishes no overbroad post-merge harness claim'
Assert-True ($runner -match [regex]::Escape('derived_spec_sha256')) 'adapter evidence retains the derived source hash'
Assert-True ($runner -match [regex]::Escape('generated_files_removed_exactly = $adapterCleanupVerified')) 'adapter files are removed by exact hash after execution'
Assert-True ($runner -match [regex]::Escape('$createdByRunner -and (Test-Path -LiteralPath $fullPath -PathType Leaf)')) 'partial CreateNew writes remove only runner-created files'
Assert-True ($runner -match [regex]::Escape('Remove-RunnerOwnedGeneratedFile -Path $derivedSpecPath')) 'adapter rolls back a completed derived spec if config creation fails'
Assert-True ($runner -match [regex]::Escape('pre_projection_ephemeral_raw_sha256 = $preProjectionEphemeralRawSha256')) 'raw E2E digest is named as an ephemeral pre-projection input'
Assert-True ($runner -match [regex]::Escape("raw_source_artifact = 'removed_exact_tree_after_strict_projection'")) 'published evidence records that the raw Playwright tree was removed'
Assert-True (-not ($runner -match [regex]::Escape('raw_result_sha256 = $rawE2eSha256'))) 'runner cannot present the ephemeral digest as a retained raw artifact hash'
Assert-True ($runner -match [regex]::Escape("schema_version = 'runtime-command-authority-host-native-runner/v3'")) 'runner writes the isolated v3 evidence schema'
Assert-True ($runner -match [regex]::Escape('runtime-command-authority-host-native.spec.ts')) 'runner launches only the authority host-native E2E case'
Assert-True (-not ($runner -match [regex]::Escape('-DryRun'))) 'runner cannot invoke dry-run deployment behavior'
Assert-True (-not ($runner -match [regex]::Escape('[switch] $Force'))) 'runner exposes no force-mode switch'
Write-TestPass 'runner isolated orchestration safety contract'

Assert-True ($runner -match 'function ConvertTo-NineCaseEvidence') 'runner owns a strict nine-case normalizer'
Assert-True ($runner -match 'function ConvertTo-PublishedTerminalEvidence') 'runner projects terminal payloads through an explicit publication allowlist'
Assert-True ($runner -match [regex]::Escape("payload_projection = 'strict_runtime_authority_evidence_allowlist'")) 'published terminals cannot retain unknown payload fields'
foreach ($caseName in @('valid', 'forged', 'released', 'expired', 'wrong_source', 'outage', 'direct_open_wrong_session', 'composition_tamper', 'concurrent_replay')) {
    Assert-True ($runner -match [regex]::Escape("'$caseName'")) "normalizer includes $caseName"
}
Assert-True ($runner -match [regex]::Escape("schema_version -cne 'runtime-command-authority-host-native-evidence/v1'")) 'normalizer rejects an unreviewed source schema'
Assert-True ($runner -match [regex]::Escape('first_frame.readyState -lt 2')) 'normalizer requires a decodable first frame'
Assert-True ($runner -match [regex]::Escape('sample_count -ne 20')) 'normalizer requires the exact P95 sample scope'
Assert-True ($runner -match [regex]::Escape('[double]::IsNaN($p95Ms)')) 'normalizer rejects non-finite P95 evidence'
Assert-True ($runner -match [regex]::Escape('A normalized case has an empty request or session correlation ID.')) 'normalizer rejects empty correlation IDs'
Assert-True ($runner -match [regex]::Escape("classification = 'zero_mutation'")) 'denial cases publish per-case zero-mutation proof'
Assert-True ($runner -match [regex]::Escape("classification = 'single_consume_with_rejected_peer_zero_mutation'")) 'replay publishes mixed single-consume truth'
Assert-True ($runner -match [regex]::Escape('$replaySuccessTerminals.Count -ne 1')) 'replay requires exactly one success terminal'
Assert-True ($runner -match [regex]::Escape('$replayRejectedTerminals.Count -ne 1')) 'replay requires exactly one unchanged rejection terminal'
Assert-True ($runner -match [regex]::Escape('duplicate_terminal_deliveries')) 'replay preserves duplicate-delivery issue evidence'
Assert-True ($runner -match [regex]::Escape("source_e2e = [ordered]@{")) 'runner retains raw and derived source hashes separately from normalized truth'
Assert-True ($runner -match [regex]::Escape("payload_publication = 'strict_projection_no_unknown_terminal_fields'")) 'runner publishes only projected E2E fields'
Assert-True (-not ($runner -match [regex]::Escape('e2e = $testEvidence'))) 'runner never embeds the raw E2E object in durable evidence'
Write-TestPass 'normalized nine-case evidence contract'

Assert-True ($e2e -match [regex]::Escape('outage_handshake: "deployment-owned-coordinator"')) 'tracked E2E remains unchanged by the runner-only adapter'
Assert-True ($runner -match [regex]::Escape('from = ''      outage_handshake: "deployment-owned-coordinator",''')) 'adapter binds the exact tracked handshake literal'
Assert-True ($runner -match [regex]::Escape('to = ''      outage_handshake: "runner-owned-authority-ingress",''')) 'adapter derives the truthful handshake literal'
Assert-True (-not ($e2e -match [regex]::Escape('process.kill'))) 'E2E never kills a coordinator PID directly'
Assert-True (-not ($e2e -match [regex]::Escape('E2E_COORDINATOR_PID'))) 'E2E cannot accept arbitrary coordinator PID input'
Assert-True ($e2e -match [regex]::Escape('E2E_RUNTIME_AUTHORITY_CONTROL_DIR')) 'E2E requires runner-owned control directory'
Assert-True ($e2e -match [regex]::Escape('E2E_RUNTIME_AUTHORITY_CONTROL_NONCE')) 'E2E requires the runner-issued control nonce'
Assert-True ($e2e -match [regex]::Escape('outage-ready.json')) 'E2E emits outage readiness marker'
Assert-True ($e2e -match [regex]::Escape('outage-go.json')) 'E2E waits for runner outage marker'
Assert-True ($e2e -match [regex]::Escape('outage-complete.json')) 'E2E emits outage completion marker'
Assert-True ($e2e -match [regex]::Escape('host_concurrent_replay_a_')) 'E2E uses first distinct concurrent replay request ID'
Assert-True ($e2e -match [regex]::Escape('host_concurrent_replay_b_')) 'E2E uses second distinct concurrent replay request ID'
Assert-True ($e2e -match [regex]::Escape('flag: "wx"')) 'E2E will not overwrite a pre-existing control marker'
Assert-True ($e2e -match [regex]::Escape('control_nonce: controlNonce')) 'E2E binds all emitted control markers to the per-run nonce'
Assert-True ($e2e -match [regex]::Escape('serialized.includes(secret)).toBe(false)')) 'secret guard asserts a boolean rather than echoing bearer text'
Assert-True (-not ($e2e -match [regex]::Escape('not.toContain(secret)'))) 'secret guard never prints bearer text through matcher diagnostics'
Assert-True ($e2e -match [regex]::Escape('ignoreDefaultArgs: [playwrightDisableFeaturesArg]')) 'E2E replaces the pinned Playwright disable-features switch instead of overriding it accidentally'
Assert-True ($e2e -match [regex]::Escape('...playwrightChromiumDisabledFeatures') -and $e2e -match [regex]::Escape('"LocalNetworkAccessChecksWebSockets"')) 'E2E preserves Playwright disabled features while adding the WebSocket LNA gate'
Assert-True ($e2e -match [regex]::Escape('LocalNetworkAccessChecksWebSockets')) 'E2E disables only the headless Chromium WebSocket LNA gate'
Assert-True (-not ($browserLaunchSurface -match '(?<![A-Za-z0-9_])LocalNetworkAccessChecks(?!WebSockets|[A-Za-z0-9_])')) 'E2E and inherited Playwright config do not disable the broader Chromium LNA parent gate'

# Playwright's bundled Chromium has no proprietary codecs, so it cannot negotiate
# a video track against Kit's NVENC H.264 livestream and the first-frame wait can
# only time out. The evidence case must drive the real Chrome install, matching
# the one repo path that has actually captured a first frame.
Assert-True ($e2e -match [regex]::Escape('channel: "chrome"')) 'E2E drives the real Chrome install rather than codec-less bundled Chromium'
Assert-True ($e2e -match [regex]::Escape('--autoplay-policy=no-user-gesture-required')) 'E2E lets the probe page start playback without a user gesture'
Assert-True (-not ($e2e -match [regex]::Escape('await streamer.connect'))) 'E2E mirrors production by not awaiting connect(), so onStart owns the readiness timeout'
Assert-True ($e2e -match [regex]::Escape('probe.connectSettled.push')) 'E2E records connect settlement so an onStart timeout names its failure mode'
$expiryWaitIndex = $e2e.IndexOf('await page.waitForTimeout(expiryWaitMs)')
$primaryLeaseIndex = $e2e.IndexOf('const primary = await createSession')
$wrongSessionLeaseIndex = $e2e.IndexOf('const wrongSession = await createSession')
Assert-True ($expiryWaitIndex -ge 0 -and $primaryLeaseIndex -gt $expiryWaitIndex -and $wrongSessionLeaseIndex -gt $expiryWaitIndex) 'E2E mints replay and outage leases only after the deliberate expiry wait'
# #623 made every stage read go through a named session, because the stage read is
# authority-gated too. Anchor on that shape: the expired case must read through the
# expiring session it is denying, not through some other session's lease.
Assert-True ($e2e -match [regex]::Escape('const expiredStageBefore = await observedStageUrl(page, expiring)')) 'expired denial captures its pre-command stage through the expiring session, before the initial stage baseline exists'
Assert-True ($e2e -match [regex]::Escape('expect(expiredStageAfter).toBe(expiredStageBefore)')) 'expired denial proves its own pre/post stage invariant'
Assert-True ($e2e -match [regex]::Escape('async function assertStageStable')) 'E2E samples a stage stability window after each denial'
Assert-True ($e2e -match [regex]::Escape('const denialStageStabilityMs = 750')) 'E2E gives deferred runtime mutations a bounded observation window'
Assert-True ($e2e -match [regex]::Escape('const finalStage = await observedStageUrl(page, observer)')) 'E2E takes a final stage sample through the observing session after the stability deadline'
Assert-True ($e2e -match [regex]::Escape('expect(forgedStageBefore).toBe(baselineStage)')) 'post-initial forged denial starts from the initial stage baseline'
Assert-True ($e2e -match [regex]::Escape('const wrongSessionStageAfter = await assertStageStable(page, primary, baselineStage)')) 'direct wrong-session denial holds the initial stage across the stability window, read through the primary session'
Assert-True ($e2e -match [regex]::Escape('expect(evidence.observed_stage_after).toBe(baselineStage)')) 'all post-initial denial evidence remains at the initial stage baseline'
Assert-True ($e2e -match [regex]::Escape('observed_stage_before')) 'all denial evidence records a pre-command stage'
Assert-True ($e2e -match [regex]::Escape('observed_stage_after')) 'all denial evidence records a post-command stage'
Write-TestPass 'E2E ownership and terminal-correlation contract'
