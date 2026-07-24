[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'test-helpers.ps1')

$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$runnerPath = Join-Path $repoRoot 'scripts\dev\run-runtime-command-authority-host-native-evidence.ps1'
$e2ePath = Join-Path $repoRoot 'web-viewer-sample\e2e\runtime-command-authority-host-native.spec.ts'

Assert-True (Test-Path -LiteralPath $runnerPath -PathType Leaf) 'host-native authority evidence runner exists'

$runner = Get-Content -LiteralPath $runnerPath -Raw
$e2e = Get-Content -LiteralPath $e2ePath -Raw

Assert-True ($runner -match [regex]::Escape("D:\Users\deploy\AI-bim-geo")) 'runner pins canonical test deployment root'
Assert-True ($runner -match [regex]::Escape("D:\Users\deploy\AI-bim-geo-data")) 'runner pins canonical deployment data root'
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
Assert-True ($runner -match [regex]::Escape('runtime-authority-e2e-')) 'runner creates unique runtime fixture directory'
Assert-True ($runner -match [regex]::Escape('runtime-command-authority-evidence')) 'runner persists evidence beneath data-root artifacts'
Assert-True ($runner -match [regex]::Escape('testing.usd')) 'runner copies tracked USD fixture'
Assert-True ($runner -match [regex]::Escape('model.usdc')) 'runner gives the copied fixture a stage URL filename'
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
$expiryWaitIndex = $e2e.IndexOf('await page.waitForTimeout(expiryWaitMs)')
$primaryLeaseIndex = $e2e.IndexOf('const primary = await createSession')
$wrongSessionLeaseIndex = $e2e.IndexOf('const wrongSession = await createSession')
Assert-True ($expiryWaitIndex -ge 0 -and $primaryLeaseIndex -gt $expiryWaitIndex -and $wrongSessionLeaseIndex -gt $expiryWaitIndex) 'E2E mints replay and outage leases only after the deliberate expiry wait'
Assert-True ($e2e -match [regex]::Escape('const expiredStageBefore = await observedStageUrl(page)')) 'expired denial captures its pre-command stage before the initial stage baseline exists'
Assert-True ($e2e -match [regex]::Escape('expect(expiredStageAfter).toBe(expiredStageBefore)')) 'expired denial proves its own pre/post stage invariant'
Assert-True ($e2e -match [regex]::Escape('async function assertStageStable')) 'E2E samples a stage stability window after each denial'
Assert-True ($e2e -match [regex]::Escape('const denialStageStabilityMs = 750')) 'E2E gives deferred runtime mutations a bounded observation window'
Assert-True ($e2e -match [regex]::Escape('const finalStage = await observedStageUrl(page)')) 'E2E takes a final stage sample after the stability deadline'
Assert-True ($e2e -match [regex]::Escape('expect(forgedStageBefore).toBe(baselineStage)')) 'post-initial forged denial starts from the initial stage baseline'
Assert-True ($e2e -match [regex]::Escape('const wrongSessionStageAfter = await assertStageStable(page, baselineStage)')) 'direct wrong-session denial holds the initial stage across the stability window'
Assert-True ($e2e -match [regex]::Escape('expect(evidence.observed_stage_after).toBe(baselineStage)')) 'all post-initial denial evidence remains at the initial stage baseline'
Assert-True ($e2e -match [regex]::Escape('observed_stage_before')) 'all denial evidence records a pre-command stage'
Assert-True ($e2e -match [regex]::Escape('observed_stage_after')) 'all denial evidence records a post-command stage'
Write-TestPass 'E2E ownership and terminal-correlation contract'
