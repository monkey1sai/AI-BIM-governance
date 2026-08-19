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

# The runner used to hard-code the deployment paths. It now resolves them from
# scripts/deploy-target-registry.json, so pinning is asserted at the source it
# actually reads instead of at a literal that no longer appears in the file.
Assert-True ($runner -match [regex]::Escape("Get-DeployTarget -Id 'local-windows'")) 'runner pins the local-windows registry target'
Assert-True ($runner -match [regex]::Escape('$script:HostNativeEvidenceTarget.deploy_root')) 'runner takes the deployment root from the pinned target'
Assert-True ($runner -match [regex]::Escape('$script:HostNativeEvidenceTarget.runtime_data_root')) 'runner takes the deployment data root from the pinned target'

# Owner ruling 2026-08-18: local Windows is an agent development-verification
# surface, canonical Linux is the human delivery surface. Evidence-integrity
# gates fail closed only on a delivery surface; elsewhere they are recorded and
# published so the output cannot be quoted as delivery-grade proof by omission.
Assert-True ($runner -match [regex]::Escape("-ceq 'canonical_test_deploy'")) 'runner decides delivery-surface status from the target role, case-sensitively'
Assert-True ($runner -match 'function Assert-HostNativeEvidenceIntegrity') 'runner routes evidence-integrity conditions through one role-scoped decision'
Assert-True ($runner -match [regex]::Escape('if ($script:HostNativeEvidenceIsDeliverySurface) { throw $Detail }')) 'delivery surfaces still fail closed on an integrity condition'
Assert-True ($runner -match 'broad_write_acl') 'broad-write ACL is an integrity condition rather than an unconditional throw'
Assert-True ($runner -match 'checkout_not_exactly_origin_main') 'checkout drift is an integrity condition rather than an unconditional throw'
Assert-True ($runner -match 'evidence_class') 'runner stamps the evidence class into runner-evidence.json'
Assert-True ($runner -match 'integrity_notes') 'runner publishes recorded integrity conditions alongside the evidence'
Assert-True ($runner -notmatch 'throw\s+"Host-native evidence path grants') 'the ACL condition no longer throws unconditionally'
Assert-True ($runner -match [regex]::Escape('origin/main')) 'runner requires fresh origin/main'
Assert-True ($runner -match [regex]::Escape('com.docker.compose.project.working_dir')) 'runner verifies Compose working-dir ownership label'
Assert-True ($runner -match [regex]::Escape('com.docker.compose.service')) 'runner verifies Compose service label'
Assert-True ($runner -match [regex]::Escape('coordinator')) 'runner scopes outage to coordinator service'
Assert-True ($runner -match '(?s)try\s*\{.*finally\s*\{') 'runner has finally recovery boundary'
Assert-True ($runner -match [regex]::Escape("@('start', `$coordinator.container_id)")) 'runner restores the exact coordinator container in finally'
Assert-True ($runner -match [regex]::Escape('outage-ready.json')) 'runner waits for E2E readiness marker'
Assert-True ($runner -match [regex]::Escape('outage-go.json')) 'runner grants outage only after ownership proof'
Assert-True ($runner -match [regex]::Escape('outage-complete.json')) 'runner requires E2E completion marker'
Assert-True ($runner -match [regex]::Escape('PlaywrightEvidenceTimeoutSeconds')) 'runner aligns readiness and exit waits with the Playwright evidence budget'
Assert-True ($runner -match [regex]::Escape('Stop-RunnerOwnedProcessTree')) 'runner reclaims its own Playwright command tree on failure'
Assert-True ($runner -match [regex]::Escape('taskkill.exe /PID')) 'runner cleanup is scoped to the Start-Process child PID'
Assert-True ($runner -match [regex]::Escape('/T')) 'runner cleanup includes only the owned child process tree'
Assert-True (-not ($runner -match 'Split-Path\s+-LiteralPath\s+\$Path\s+-Parent')) 'runner uses a valid Split-Path parameter set for evidence directories'
Assert-True ($runner -match [regex]::Escape('Assert-NoReparsePointPath')) 'runner rejects reparse-point control and evidence paths'
Assert-True ($runner -match [regex]::Escape('Assert-NoBroadWriteAcl')) 'runner rejects broad write ACLs on deployment evidence roots'
Assert-True ($runner -match [regex]::Escape('Test-ProcessDescendsFrom')) 'runner proves the signaling listener descends from the deployment PID'
Assert-True ($runner -match [regex]::Escape('Get-NetTCPConnection -LocalPort $SignalPort -State Listen')) 'runner binds PID provenance to the live Kit signaling listener'
Assert-True ($runner -match [regex]::Escape('hasRuntimeMarker') -and $runner -match [regex]::Escape('bim-streaming-server')) 'runner requires the expected runtime command marker'
Assert-True ($runner -match [regex]::Escape('E2E_RUNTIME_AUTHORITY_CONTROL_NONCE')) 'runner requires a per-run control nonce'
Assert-True ($runner -match [regex]::Escape('[System.IO.FileMode]::CreateNew')) 'runner creates its control marker without overwriting an existing file'
Assert-True ($runner -match [regex]::Escape('[System.Text.UTF8Encoding]::new($false)')) 'runner writes no-BOM control-marker JSON'
Assert-True ($runner -match [regex]::Escape('docker context show')) 'runner establishes a Docker context before outage control'
Assert-True ($runner -match [regex]::Escape('--context $script:VerifiedDockerContext')) 'runner pins all Docker calls to the verified context'
Assert-True ($runner -match [regex]::Escape("@('stop', `$coordinator.container_id)")) 'runner stops the exact verified coordinator container ID'
Assert-True ($runner -match [regex]::Escape("@('start', `$coordinator.container_id)")) 'runner restarts the exact verified coordinator container ID'
Assert-True ($runner -match [regex]::Escape('coordinatorRecoveryRequired = $true')) 'runner arms exact-container recovery before stop'
Assert-True ($runner -match [regex]::Escape('node_modules\.bin\playwright.cmd')) 'runner invokes only the locked local Playwright binary'
Assert-True ($runner -match [regex]::Escape('npm ci --ignore-scripts --no-audit --no-fund')) 'runner disables dependency lifecycle scripts during test setup'
Assert-True (-not ($runner -match [regex]::Escape('-RedirectStandardOutput'))) 'runner does not persist raw Playwright stdout'
Assert-True (-not ($runner -match [regex]::Escape('-RedirectStandardError'))) 'runner does not persist raw Playwright stderr'
Assert-True (-not ($runner -match [regex]::Escape('playwright-stdout.log'))) 'runner keeps no raw Playwright stdout file beside the evidence'
Assert-True (-not ($runner -match [regex]::Escape('playwright-stderr.log'))) 'runner keeps no raw Playwright stderr file beside the evidence'
Assert-True ($runner -match [regex]::Escape('runtime-authority-e2e-')) 'runner scopes every run to its own run ID'
Assert-True ($runner -match [regex]::Escape('runtime-command-authority-evidence')) 'runner persists evidence beneath data-root artifacts'

# The 7.3 stage is no longer a tracked USD fixture copied into the artifacts root: #441
# gave the conversion service per-artifact download authority, so a fabricated
# /artifacts/<runId>/model.usdc URL 404s and Kit reports an HTTPError. The stage must be
# a real, downloadable conversion artifact, and the published evidence must name THAT
# artifact - a stale fixture path in the evidence would contradict the run it describes.
Assert-True (-not ($runner -match [regex]::Escape('testing.usd'))) 'runner neither copies nor claims the retired tracked USD fixture'
Assert-True ($runner -match 'function Resolve-HostNativeEvidenceStage') 'runner resolves the stage through one conversion-artifact resolver'
Assert-True ($runner -match [regex]::Escape('$stageArtifact = Resolve-HostNativeEvidenceStage')) 'runner takes its stage from that resolver rather than building a URL of its own'
Assert-True ($runner -match [regex]::Escape('$artifact = $result.artifacts.model_usdc')) 'resolver selects the conversion job model_usdc artifact'
Assert-True ($runner -match [regex]::Escape('/artifacts/$jobId/$fileName')) 'resolver builds both stage URLs from the job that actually serves them'
Assert-True (($runner -match [regex]::Escape('Test-HttpOk -Url $urlA')) -and ($runner -match [regex]::Escape('Test-HttpOk -Url $urlB'))) 'resolver proves both stage host spellings are downloadable before returning them'
Assert-True ($runner -match [regex]::Escape('[uri]::IsWellFormedUriString($artifactUrl, [System.UriKind]::Absolute)')) 'resolver rejects a relative artifact URL as one candidate instead of throwing out of the run'
Assert-True ($runner -match [regex]::Escape("kind              = 'conversion_artifact'")) 'evidence stamps the stage source kind as a conversion artifact'
Assert-True ($runner -match [regex]::Escape('conversion_job_id = [string]$stageArtifact.conversion_job_id')) 'evidence names the conversion job the stage came from'
Assert-True ($runner -match [regex]::Escape('checksum_sha256   = [string]$stageArtifact.checksum_sha256')) 'evidence binds the stage to the resolved artifact checksum'
Assert-True ($runner -match [regex]::Escape('source = $stageUrlA')) 'evidence publishes the stage URL the run actually loaded as its source'
Assert-True (-not ($runner -match [regex]::Escape('bim-streaming-server/source/extensions'))) 'evidence no longer hard-codes a repo fixture path as the stage source'
Assert-True ($runner -match [regex]::Escape('runtime-command-authority-host-native.spec.ts')) 'runner launches only the authority host-native E2E case'
Assert-True (-not ($runner -match [regex]::Escape('-DryRun'))) 'runner cannot invoke dry-run deployment behavior'
Assert-True (-not ($runner -match [regex]::Escape('-Force'))) 'runner cannot invoke force behavior'
Write-TestPass 'runner static safety contract'

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
