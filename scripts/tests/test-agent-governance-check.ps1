[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Assert-True {
    param([Parameter(Mandatory = $true)] $Condition, [Parameter(Mandatory = $true)][string] $Message)
    if ($Condition -is [array]) {
        $Condition = ($Condition.Count -gt 0 -and -not ($Condition -contains $false))
    }
    if (-not $Condition) { throw "ASSERT FAILED: $Message" }
}

function Assert-FileContains {
    param(
        [Parameter(Mandatory = $true)][string] $Path,
        [Parameter(Mandatory = $true)][string] $Pattern,
        [Parameter(Mandatory = $true)][string] $Message
    )
    Assert-True (Test-Path -LiteralPath $Path -PathType Leaf) "$Path exists"
    $content = Get-Content -LiteralPath $Path -Raw
    Assert-True ($content -match $Pattern) $Message
}

$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
Push-Location $repoRoot
try {
    foreach ($path in @(
        '.github/ISSUE_TEMPLATE/config.yml',
        '.github/ISSUE_TEMPLATE/agent-task.yml',
        '.github/ISSUE_TEMPLATE/runtime-bug.yml',
        '.github/ISSUE_TEMPLATE/governance-change.yml',
        '.github/CODEOWNERS',
        '.github/workflows/ci.yml',
        '.github/workflows/agent-governance.yml',
        '.github/workflows/pr-review-agent.yml',
        '.github/PULL_REQUEST_TEMPLATE.md',
        'scripts/tests/check-pr-body-evidence.ps1',
        'scripts/tests/test-pr-body-evidence.ps1',
        'scripts/lib/production-boundary-contract.ps1',
        'scripts/tests/test-production-boundary-contract.ps1',
        'tests/contracts/element-mapping-provenance.schema.json',
        'web-viewer-sample/playwright.kit-manager.config.ts',
        'web-viewer-sample/e2e/kit-manager-operator.spec.ts',
        'scripts/tests/verify-openspec-lifecycle.ps1',
        'scripts/tests/test-openspec-lifecycle-archive-diff.ps1',
        'scripts/lib/openspec-lifecycle.ps1',
        'scripts/tests/reconcile-openspec-ledger.ps1',
        'scripts/tests/openspec-lifecycle-ledger.schema.json',
        'scripts/tests/openspec-ledger-reconciliation-report.schema.json',
        'scripts/tests/test-openspec-ledger-reconciliation.ps1',
        'openspec/lifecycle-ledger.json',
        'scripts/lib/openspec-machine-truth.mjs',
        'scripts/lib/collect-openspec-github-state.mjs',
        'scripts/lib/gitnexus-worktree-health.mjs',
        'scripts/dev/report-gitnexus-worktree-health.mjs',
        'scripts/lib/task-packet.mjs',
        'scripts/dev/validate-task-packet.mjs',
        'scripts/tests/verify-openspec-machine-truth.mjs',
        'scripts/tests/test-openspec-machine-truth.mjs',
        'scripts/tests/test-openspec-machine-truth-cli.mjs',
        'scripts/tests/test-collect-openspec-github-state.mjs',
        'scripts/tests/test-gitnexus-worktree-health.mjs',
        'scripts/tests/gitnexus-worktree-health-observation.schema.json',
        'scripts/tests/gitnexus-worktree-health-report.schema.json',
        'scripts/tests/task-packet.schema.json',
        'scripts/tests/test-task-packet.mjs',
        'scripts/tests/openspec-github-lifecycle-state.schema.json',
        'scripts/tests/openspec-machine-truth-report.schema.json',
        'scripts/tests/fixtures/task-ledger-parity.json',
        'scripts/tests/test-task-ledger-parser-parity.mjs',
        'scripts/lib/design-system-gate.ps1',
        'scripts/tests/verify-design-system-reference.ps1',
        'scripts/tests/test-design-system-reference.ps1',
        'scripts/tests/test-design-system-change-scope.ps1',
        'scripts/tests/verify-functional-runtime-result.ps1',
        'scripts/tests/test-functional-runtime-result.ps1',
        'scripts/tests/verify-design-system-visual-result.ps1',
        'scripts/tests/test-design-system-visual-result.ps1',
        'scripts/tests/test-png-preflight.mjs',
        'web-viewer-sample/scripts/lib/png-preflight.mjs',
        'scripts/verification-manifest.json',
        'scripts/lib/verification-plan.mjs',
        'scripts/lib/verification-runner.mjs',
        'scripts/lib/verification-outcome.mjs',
        'scripts/lib/verification-command-policy.mjs',
        'scripts/lib/security-exceptions.mjs',
        'scripts/lib/security-exceptions-cli.mjs',
        'scripts/security-exceptions.json',
        'scripts/ai-coding-metrics-policy.json',
        'scripts/lib/ai-coding-metrics.mjs',
        'scripts/dev/record-ai-coding-telemetry.mjs',
        'scripts/dev/report-ai-coding-metrics.mjs',
        'scripts/tests/test-verification-plan.mjs',
        'scripts/tests/test-verification-command-policy.mjs',
        'scripts/tests/test-verification-runner.mjs',
        'scripts/tests/test-security-exceptions.mjs',
        'scripts/tests/verify-security-exceptions.ps1',
        'scripts/tests/invoke-powershell-static.ps1',
        'scripts/tests/scan-secret-patterns.ps1',
        'scripts/tests/verification-manifest.schema.json',
        'scripts/tests/verification-plan.schema.json',
        'scripts/tests/verification-outcome.schema.json',
        'scripts/tests/security-exceptions.schema.json',
        'scripts/tests/ai-coding-metrics-policy.schema.json',
        'scripts/tests/ai-coding-telemetry-observation.schema.json',
        'scripts/tests/ai-coding-metrics-report.schema.json',
        'scripts/tests/test-ai-coding-metrics.mjs',
        'scripts/tests/fixtures/ai-coding-telemetry-observation.json',
        'scripts/tests/fixtures/ai-coding-metrics-report.json',
        'docs/plans/design-system-reference.manifest.json',
        'scripts/tests/fixtures/agent-governance-routing.json',
        '.gitignore',
        '.ignore',
        '.gitnexusignore',
        'agent-skills-manifest.json',
        'scripts/dev/sync-agent-skills.ps1',
        'scripts/tests/test-agent-skills-sync.ps1',
        '.codex/skills/ai-bim-fast-fix/SKILL.md',
        '.codex/skills/ai-bim-bounded-change/SKILL.md',
        '.codex/skills/repo-health/SKILL.md',
        '.codex/skills/spec-to-done/agents/openai.yaml',
        '.claude/skills/spec-to-done/validate-state.mjs',
        '.codex/skills/spec-to-done/validate-state.mjs',
        '.claude/skills/spec-to-done/ensure-host-native-ports-free.ps1',
        '.codex/skills/spec-to-done/ensure-host-native-ports-free.ps1',
        '.claude/workflows/std-evidence-closeout.js',
        'docs/agents/superpowers-invocation-policy.md',
        'docs/agents/ai-coding-metrics.md',
        'docs/PR_REVIEW_AGENT.md',
        'docs/superpowers/plans/2026-06-18-ai-coding-maturity-governance.md',
        'openspec/AGENTS.md'
    )) {
        Assert-True (Test-Path -LiteralPath $path -PathType Leaf) "$path exists"
    }

    Assert-FileContains '.github/ISSUE_TEMPLATE/config.yml' 'blank_issues_enabled:\s*false' 'blank GitHub issues are disabled'
    Assert-FileContains '.github/ISSUE_TEMPLATE/agent-task.yml' 'docs/plans' 'agent task template points to docs/plans'
    Assert-FileContains '.github/ISSUE_TEMPLATE/agent-task.yml' 'acceptance_criteria' 'agent task template requires acceptance criteria'
    Assert-FileContains '.github/ISSUE_TEMPLATE/agent-task.yml' 'validation_commands' 'agent task template requires validation commands'
    Assert-FileContains '.github/ISSUE_TEMPLATE/agent-task.yml' 'evidence_contract' 'agent task template requires evidence contract'
    Assert-FileContains '.github/ISSUE_TEMPLATE/runtime-bug.yml' 'regression_guard' 'runtime bug template requires regression guard'
    Assert-FileContains '.github/ISSUE_TEMPLATE/governance-change.yml' 'agent-workflow' 'governance change template carries agent workflow label'

    Assert-FileContains '.github/CODEOWNERS' '@monkey1sai' 'CODEOWNERS names repository owner'
    Assert-FileContains '.github/workflows/agent-governance.yml' 'verify-openspec-lifecycle\.ps1' 'agent governance runs OpenSpec lifecycle verification'
    Assert-FileContains '.github/workflows/agent-governance.yml' 'test-openspec-lifecycle-archive-diff\.ps1' 'agent governance tests archive deletion and rename handling'
    Assert-FileContains '.github/workflows/agent-governance.yml' 'test-openspec-ledger-reconciliation\.ps1' 'agent governance runs OpenSpec ledger reconciliation fixture tests'
    Assert-FileContains '.github/workflows/agent-governance.yml' 'test-openspec-machine-truth\.mjs' 'agent governance runs complete OpenSpec machine-truth fixtures'
    Assert-FileContains '.github/workflows/agent-governance.yml' 'test-gitnexus-worktree-health\.mjs' 'agent governance runs GitNexus/worktree health fixtures'
    Assert-FileContains '.github/workflows/agent-governance.yml' 'test-task-packet\.mjs' 'agent governance runs task packet routing fixtures'
    Assert-FileContains '.github/workflows/agent-governance.yml' 'test-ai-coding-metrics\.mjs' 'agent governance runs AI coding metrics privacy and truth fixtures'
    Assert-FileContains '.github/workflows/agent-governance.yml' 'test-production-boundary-contract\.ps1' 'agent governance enforces production provenance and network boundaries'
    Assert-FileContains 'scripts/tests/check-pr-body-evidence.ps1' 'Assert-ProductionBoundaryDiff' 'PR evidence gate enforces the production boundary diff contract'
    Assert-FileContains '.github/workflows/ci.yml' 'npm run test:e2e:kit-manager' 'kit-manager-web CI runs the browser operator-flow regression'
    Assert-FileContains 'scripts/tests/verify-openspec-lifecycle.ps1' 'lib\\openspec-lifecycle\.ps1' 'OpenSpec lifecycle verification uses the shared parser'
    Assert-FileContains 'openspec/AGENTS.md' 'deferred change 保留在 `openspec/changes/<change-id>/`' 'OpenSpec instructions keep deferred changes outside completed archive'
    Assert-FileContains 'openspec/AGENTS.md' '--skip-specs.*不是.*deferred state' 'OpenSpec instructions do not treat skip-specs as deferral'
    Assert-FileContains 'openspec/specs/governance-throughput-budget/spec.md' 'active OpenSpec change 同時數量 SHALL 不超過 6' 'canonical OpenSpec WIP limit is six'
    Assert-FileContains 'scripts/tests/verify-openspec-lifecycle.ps1' '\$wipLimit\s*=\s*6' 'OpenSpec lifecycle verifier enforces the canonical WIP limit'
    Assert-FileContains 'docs/plans/NOW.md' '禁止同時推進 >6 個 active OpenSpec product change' 'NOW reflects the canonical OpenSpec WIP limit'
    Assert-FileContains 'docs/plans/NOW.md' '<!-- lifecycle-ledger:start -->' 'NOW contains the bounded machine-ledger projection'
    foreach ($ownedPath in @('/AGENTS.md', '/docs/agents/', '/docs/plans/', '/.github/', '/scripts/')) {
        Assert-FileContains '.github/CODEOWNERS' ([regex]::Escape($ownedPath)) "CODEOWNERS covers $ownedPath"
    }

    $ci = Get-Content -LiteralPath '.github/workflows/ci.yml' -Raw
    foreach ($job in @('changes', 'root-contracts', 'coordinator', 'streaming', 'governance-service', 'agent-governance-contracts', 'viewer', 'design-semantic-visual', 'kit-manager-api', 'kit-manager-web', 'compose-config', 'powershell-static', 'secret-pattern-scan')) {
        Assert-True ($ci -match "(?m)^\s{2}$([regex]::Escape($job)):\s*$") "ci.yml contains job $job"
    }
    Assert-True ($ci -match 'changed path classifier') 'ci.yml contains changed path classifier'
    foreach ($output in @('root_contracts', 'coordinator', 'streaming', 'governance_service', 'viewer', 'agent_governance', 'conv_functional', 'kit_manager_api', 'kit_manager_web', 'compose_config', 'powershell_static', 'rebuild_test_deploy', 'secret_pattern_scan', 'plan_result', 'plan_sha256')) {
        $expectedOutput = $output + ': ${{ steps.paths.outputs.' + $output + ' }}'
        Assert-True ($ci -match [regex]::Escape($expectedOutput)) "changes job exposes $output output"
    }
    foreach ($output in @('frontend_product', 'frontend_visual_required', 'frontend_design_status', 'frontend_required_screen_ids')) {
        $expectedOutput = $output + ': ${{ steps.design_scope.outputs.' + $output + ' }}'
        Assert-True ($ci -match [regex]::Escape($expectedOutput)) "changes job exposes manifest-derived $output output"
    }
    Assert-True ($ci -match [regex]::Escape("^[a-z0-9][a-z0-9.-]{0,63}$")) 'CI accepts the dotted screen identifiers used by the design-system manifest'
    foreach ($gate in @('root_contracts', 'coordinator', 'streaming', 'governance_service', 'viewer', 'agent_governance', 'conv_functional', 'kit_manager_api', 'kit_manager_web', 'compose_config', 'powershell_static', 'rebuild_test_deploy', 'secret_pattern_scan')) {
        Assert-True ($ci -match [regex]::Escape("needs.changes.outputs.$gate == 'true'")) "ci.yml gates affected job on $gate"
    }
    Assert-True (([regex]::Matches($ci, 'name: Require changed-path classifier success')).Count -eq 14) 'every downstream required job explicitly fails when the classifier dependency fails'
    Assert-True (([regex]::Matches($ci, "if: always\(\) && \(needs\.changes\.result != 'success' \|\|")).Count -eq 14) 'downstream required jobs run on classifier failure instead of reporting skipped-success'
    Assert-True ($ci -match '(?s)name: Run rebuild transaction safety tests \(PowerShell 7\).*?shell: pwsh.*?run: pwsh -NoProfile -NonInteractive -ExecutionPolicy Bypass -File scripts/tests/test-rebuild-test-deploy\.ps1') 'CI runs rebuild transaction safety tests in a PowerShell 7 file scope'
    Assert-True ($ci -match '(?s)name: Run rebuild transaction safety tests \(Windows PowerShell 5\.1\).*?shell: pwsh.*?run: powershell\.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File scripts/tests/test-rebuild-test-deploy\.ps1') 'CI runs rebuild transaction safety tests in a Windows PowerShell 5.1 file scope'
    $verificationManifest = Get-Content -LiteralPath 'scripts/verification-manifest.json' -Raw | ConvertFrom-Json -Depth 100
    $verificationManifestJson = $verificationManifest | ConvertTo-Json -Depth 100
    Assert-True ($verificationManifestJson | Test-Json -SchemaFile 'scripts/tests/verification-manifest.schema.json' -ErrorAction SilentlyContinue) 'verification manifest satisfies its Draft-07 schema'
    $invalidConfigured = $verificationManifestJson | ConvertFrom-Json -Depth 100
    $invalidConfigured.gates[0].command = $null
    Assert-True (-not (($invalidConfigured | ConvertTo-Json -Depth 100) | Test-Json -SchemaFile 'scripts/tests/verification-manifest.schema.json' -ErrorAction SilentlyContinue)) 'configured gate with null command fails the manifest schema'
    $invalidNotConfigured = $verificationManifestJson | ConvertFrom-Json -Depth 100
    $missingGate = @($invalidNotConfigured.gates | Where-Object { -not $_.configured })[0]
    $missingGate.command = [pscustomobject]@{ executable = 'npm'; args = @('run', 'verify') }
    Assert-True (-not (($invalidNotConfigured | ConvertTo-Json -Depth 100) | Test-Json -SchemaFile 'scripts/tests/verification-manifest.schema.json' -ErrorAction SilentlyContinue)) 'not-configured gate with a command fails the manifest schema'
    Assert-True ($verificationManifest.schema_version -eq 'verification-manifest/v2') 'shared manifest uses the typed quality policy contract'
    foreach ($serviceTarget in @('coordinator', 'viewer', 'kit-manager-api', 'kit-manager-web')) {
        Assert-True ($verificationManifest.quality_policy.service_targets -contains $serviceTarget) "quality policy covers $serviceTarget"
    }
    Assert-True ($null -eq $verificationManifest.quality_policy.coverage.whole_repository_percentage) 'coverage policy rejects a whole-repository vanity percentage'
    Assert-True ($verificationManifest.artifact_policy.attestation_scope -eq 'deployables-only') 'attestation policy excludes test evidence'
    Assert-True ($verificationManifest.artifact_policy.excluded_globs -contains 'artifacts/e2e/**') 'screenshots and traces remain hash/commit evidence rather than attested deployables'
    foreach ($policyPath in @(
        'scripts/ai-coding-metrics-policy.json',
        'scripts/lib/ai-coding-metrics.mjs',
        'scripts/tests/test-ai-coding-metrics.mjs'
    )) {
        Assert-True ($verificationManifest.full_dispatch_globs -contains $policyPath) "AI coding metric authority self-change triggers full dispatch: $policyPath"
    }
    $metricsPolicy = Get-Content -LiteralPath 'scripts/ai-coding-metrics-policy.json' -Raw | ConvertFrom-Json -Depth 100
    $metricsPolicyJson = $metricsPolicy | ConvertTo-Json -Depth 100
    Assert-True ($metricsPolicyJson | Test-Json -SchemaFile 'scripts/tests/ai-coding-metrics-policy.schema.json' -ErrorAction SilentlyContinue) 'AI coding metrics policy satisfies its Draft-07 schema'
    Assert-True ($metricsPolicy.authority -eq 'telemetry_only') 'AI coding metrics remain telemetry-only'
    Assert-True ($metricsPolicy.baseline.started_on -eq '2026-07-28') 'AI coding metrics baseline has an immutable no-backfill epoch'
    $backdatedMetricsPolicy = $metricsPolicy | ConvertTo-Json -Depth 100 | ConvertFrom-Json -Depth 100
    $backdatedMetricsPolicy.baseline.started_on = '2020-01-01'
    Assert-True (-not (($backdatedMetricsPolicy | ConvertTo-Json -Depth 100) | Test-Json -SchemaFile 'scripts/tests/ai-coding-metrics-policy.schema.json' -ErrorAction SilentlyContinue)) 'backdated AI coding metrics policy fails the schema'
    Assert-True ($metricsPolicy.merge_truth.required_retry_count -eq 0) 'required merge truth has zero retry'
    Assert-True (-not $metricsPolicy.merge_truth.telemetry_is_merge_authority) 'telemetry cannot become merge authority'
    Assert-True ($metricsPolicy.baseline.minimum_days -eq 28 -and $null -eq $metricsPolicy.baseline.improvement_targets) 'metrics require four weeks before setting targets'
    Assert-True ($metricsPolicy.baseline.capture_provenance -eq 'unattested') 'caller timestamps cannot claim a trusted baseline'
    Assert-True ($metricsPolicy.baseline.readiness_gate -eq 'hosted-attested-capture-required') 'baseline readiness requires hosted capture attestation'
    Assert-True ($metricsPolicy.retention.raw_observations_days -eq 35) 'raw telemetry retention is bounded'
    Assert-True ($metricsPolicy.retention.enforcement -eq 'not_configured') 'raw telemetry retention enforcement is not falsely claimed'
    Assert-True ($metricsPolicy.retention.not_configured_reason -eq 'hosted-retention-unverified') 'raw telemetry retention has a closed hosted blocker'
    Assert-FileContains '.gitignore' 'artifacts/telemetry/ai-coding/' 'raw AI coding telemetry cannot be accidentally committed'
    $metricsDocs = Get-Content -LiteralPath 'docs/agents/ai-coding-metrics.md' -Raw
    Assert-True ($metricsDocs -match [regex]::Escape('--input artifacts/telemetry/ai-coding/input/observation.json')) 'telemetry input example stays inside the ignored raw namespace'
    Assert-True (-not ($metricsDocs -match [regex]::Escape('--input artifacts/input/observation.json'))) 'telemetry docs do not expose a tracked raw-input path'
    Assert-True ($verificationManifest.full_dispatch_globs -contains '.gitignore') 'telemetry ignore-policy changes trigger full verification dispatch'
    foreach ($forbiddenField in @('prompt', 'source', 'user', 'args', 'env', 'cwd', 'stdout', 'stderr', 'path', 'repository', 'actor')) {
        Assert-True ($metricsPolicy.privacy.forbidden_fields -contains $forbiddenField) "telemetry privacy policy forbids $forbiddenField"
    }
    $telemetryFixture = Get-Content -LiteralPath 'scripts/tests/fixtures/ai-coding-telemetry-observation.json' -Raw
    Assert-True ($telemetryFixture | Test-Json -SchemaFile 'scripts/tests/ai-coding-telemetry-observation.schema.json' -ErrorAction SilentlyContinue) 'telemetry fixture satisfies its closed Draft-07 schema'
    $invalidTelemetry = $telemetryFixture | ConvertFrom-Json -Depth 100
    $invalidTelemetry | Add-Member -NotePropertyName prompt -NotePropertyValue 'forbidden'
    Assert-True (-not (($invalidTelemetry | ConvertTo-Json -Depth 100) | Test-Json -SchemaFile 'scripts/tests/ai-coding-telemetry-observation.schema.json' -ErrorAction SilentlyContinue)) 'telemetry schema rejects prompt-bearing extensions'
    $metricsReportFixture = Get-Content -LiteralPath 'scripts/tests/fixtures/ai-coding-metrics-report.json' -Raw
    Assert-True ($metricsReportFixture | Test-Json -SchemaFile 'scripts/tests/ai-coding-metrics-report.schema.json' -ErrorAction SilentlyContinue) 'metrics report fixture satisfies its closed Draft-07 schema'
    $invalidZeroReport = $metricsReportFixture | ConvertFrom-Json -Depth 100
    $invalidZeroMetric = @($invalidZeroReport.metrics | Where-Object id -eq 'first-pass-gate-yield')[0]
    $invalidZeroMetric.status = 'collecting_baseline'
    $invalidZeroMetric.value = 0
    $invalidZeroMetric.sample_size = 1
    Assert-True (-not (($invalidZeroReport | ConvertTo-Json -Depth 100) | Test-Json -SchemaFile 'scripts/tests/ai-coding-metrics-report.schema.json' -ErrorAction SilentlyContinue)) 'zero-observation report schema rejects a fabricated zero-percent yield'
    $powershellClass = @($verificationManifest.path_classes | Where-Object id -eq 'powershell-static')[0]
    Assert-True ($powershellClass.path_globs -contains 'scripts/**/*.psm1') 'shared manifest PowerShell class includes script modules'
    $rebuildClass = @($verificationManifest.path_classes | Where-Object id -eq 'rebuild-test-deploy')[0]
    Assert-True ($rebuildClass.path_globs -contains 'scripts/lib/StructLog.psm1') 'shared manifest rebuild class includes the structured logger module'
    $rootContractClass = @($verificationManifest.path_classes | Where-Object id -eq 'root-contracts')[0]
    foreach ($ownerPath in @('bim-review-coordinator/**', 'bim-streaming-server/**', 'governance-service/**', 'web-viewer-sample/**', 'services/kit-manager-api/**', 'apps/kit-manager-web/**')) {
        Assert-True ($rootContractClass.path_globs -contains $ownerPath) "root contract trigger closure includes $ownerPath"
    }
    Assert-True ($ci -match 'if \[ "\$\{\{ github\.event_name \}\}" = "pull_request" \]') 'changed path classifier diffs PR base/head on pull_request'
    Assert-True ($ci -match 'git -c core\.quotepath=false diff --no-renames --name-only -z "\$base_sha\.\.\.\$head_sha"') 'pull-request path classification uses NUL-safe rename-preserving merge-base semantics'
    Assert-True ($ci -match 'printf "__full__\\0" > changed-paths\.bin') 'changed path classifier runs full service CI on push/workflow_dispatch'
    Assert-True ($ci -match 'scripts/lib/verification-plan\.mjs') 'CI classifier consumes the shared verification planner'
    Assert-True ($ci -match '--changed-paths0-file changed-paths\.bin') 'CI classifier consumes NUL-delimited paths'
    Assert-True ($ci -match '--json-out verification-plan\.json') 'CI publishes the shared verification plan document'
    Assert-True ($ci -match 'name: verification-plan-\$\{\{ steps\.paths\.outputs\.head_sha \}\}') 'CI uploads a commit-bound plan artifact'
    Assert-True ($ci -notmatch '(?m)^\s*emit\(\)') 'CI contains no second inline path classifier'
    Assert-True ($ci -match '\$verificationPlan\.dispatch -eq ''full''') 'frontend scope honors planner self-change full dispatch'
    Assert-True ($ci -match 'Get-DesignSystemChangeScope') 'CI frontend scope comes from the shared base/head manifest resolver'
    Assert-True ($ci -match [regex]::Escape("needs.changes.outputs.frontend_product == 'true'")) 'design-system job is stable for every frontend product scope'
    Assert-True ($ci -match 'npm run test:visual:design-system') 'approved/mixed CI runs the semantic and pixel Playwright producer'
    Assert-True ($ci -match 'verify-design-system-visual-result\.ps1') 'approved/mixed CI recomputes and validates the visual result'
    Assert-True ($ci -match 'Install-Module PSScriptAnalyzer -RequiredVersion 1\.24\.0') 'PowerShell static analysis uses a fixed module version'
    Assert-True ($ci -match '-RequiredScreenIds \$requiredScreenIds') 'CI validator receives the base/head union of approved screen IDs'
    Assert-True ($ci -match 'Head manifest removed base-approved screen IDs') 'CI fails before capture when the head manifest narrows base-approved screens'
    Assert-True ($ci -match 'AllowUntrackedArtifacts') 'CI uploads reproducible visual artifacts without committing ignored output'
    Assert-True ($ci -match '(?s)design-semantic-visual:.*?runs-on: windows-2025') 'design-system CI uses the manifest-pinned Windows runner label'
    Assert-True ($ci -match '(?s)design-semantic-visual:.*?working-directory: web-viewer-sample\s+run: npm ci --ignore-scripts --no-audit --no-fund') 'design-system CI installs the tracked dependency snapshot without lifecycle scripts'
    foreach ($command in @(
        'python -m pytest tests -q -p no:cacheprovider',
        'python -m pytest governance-service/tests -q',
        'usd-core',
        'web-viewer-sample',
        'npm install --ignore-scripts --no-audit --no-fund',
        'npm run verify',
        'npm run lint:baseline',
        'python -m pytest services/kit-manager-api/tests -q',
        'npm run test:session-first',
        'docker compose -f compose.runtime-manager.yml -f compose.host-kit.yml --env-file .env.web-plane.host-kit.example config --quiet',
        'scripts/tests/invoke-powershell-static.ps1',
        'scripts/tests/scan-secret-patterns.ps1',
        'scripts/tests/verify-security-exceptions.ps1'
    )) {
        Assert-True ($ci -match [regex]::Escape($command)) "ci.yml contains command $command"
    }
    Assert-True ($ci -match [regex]::Escape('web-viewer-sample/package-lock.json')) 'ci.yml caches and installs from the tracked viewer package-lock'
    Assert-True ($ci -match 'TRUSTED_BASE_SHA') 'viewer lint policy resolves a trusted base baseline'
    Assert-True ($ci -match 'git show.*web-viewer-sample/scripts/eslint-baseline\.json') 'viewer lint baseline is read from the trusted base commit'
    Assert-True ($ci -match 'git worktree add --detach.*TRUSTED_BASE_SHA') 'viewer lint bootstrap materializes the trusted base source when the historical baseline is absent'
    Assert-True ($ci -match '--source-root \$baseViewer') 'viewer lint bootstrap derives findings from the trusted base viewer source rather than the candidate baseline file'

    $governanceWorkflow = Get-Content -LiteralPath '.github/workflows/agent-governance.yml' -Raw
    Assert-True (-not ($governanceWorkflow -match '(?m)^\s+paths:\s*$')) 'agent-governance workflow does not use path filters because it is a required-check candidate'
    Assert-True ($governanceWorkflow -match '(?m)^\s+timeout-minutes:\s*30\s*$') 'agent-governance workflow has a bounded runtime'
    Assert-True ($governanceWorkflow -match 'scripts/tests/test-agent-governance-check\.ps1') 'agent-governance workflow runs static check'
    Assert-True ($governanceWorkflow -match 'scripts/tests/test-openspec-ledger-reconciliation\.ps1') 'agent-governance workflow runs OpenSpec ledger reconciliation tests'
    Assert-True ($governanceWorkflow -match 'node --test scripts/tests/test-openspec-machine-truth\.mjs scripts/tests/test-openspec-machine-truth-cli\.mjs scripts/tests/test-collect-openspec-github-state\.mjs') 'agent-governance workflow runs machine-truth core, CLI, and GitHub collector tests'
    Assert-True ($governanceWorkflow -match 'scripts/tests/test-task-ledger-parser-parity\.mjs') 'agent-governance workflow runs the task-ledger parser parity contract'
    Assert-True ($governanceWorkflow -match 'scripts/tests/test-verification-runner\.mjs') 'agent-governance workflow runs verification outcome fixtures'
    Assert-True ($governanceWorkflow -match 'scripts/tests/test-security-exceptions\.mjs') 'agent-governance workflow runs security exception lifecycle fixtures'
    Assert-True ($governanceWorkflow -match "github\.event_name == 'pull_request'.*agent-governance.*agent-governance-diagnostic") 'manual dispatch uses a diagnostic check name that cannot satisfy merge authority'
    Assert-True ($governanceWorkflow -match 'scripts/tests/test-pr-body-evidence\.ps1') 'agent-governance workflow runs PR body evidence tests'
    Assert-True ($governanceWorkflow -match 'scripts/tests/test-require-gstack-evidence\.ps1') 'agent-governance workflow runs browser-evidence hook tests'
    Assert-True ($governanceWorkflow -match 'scripts/tests/test-design-system-reference\.ps1') 'agent-governance workflow runs design-system reference tests'
    Assert-True ($governanceWorkflow -match 'scripts/tests/test-design-system-change-scope\.ps1') 'agent-governance workflow runs design-system scope tests'
    Assert-True ($governanceWorkflow -match 'scripts/tests/test-functional-runtime-result\.ps1') 'agent-governance workflow runs functional-runtime result gate tests'
    Assert-True ($governanceWorkflow -match 'scripts/tests/test-png-preflight\.mjs') 'agent-governance runs dependency-free PNG allocation-bound tests'
    Assert-True (-not ($governanceWorkflow -match 'npm\s+(?:ci|install|run)')) 'agent-governance never executes PR-controlled npm lifecycle or package scripts'
    Assert-True ($governanceWorkflow -match "node-version: '20\.20\.2'") 'agent-governance uses the exact Node.js pin'
    Assert-True (-not ($governanceWorkflow -match '(?m)^\s*run:\s*powershell\b')) 'agent-governance workflow does not re-enter legacy Windows PowerShell from pwsh'
    # 原本硬編 `-eq 2`（"both checks"），使得「新增一個治理檢查」必定讓本斷言失敗——數量只是
    # 當時的巧合，真正的意圖是「每個 step 都用 PowerShell 7，不得回退 legacy Windows PowerShell」。
    # 改以「pwsh run 數 == 全部 run 數」表達該意圖，workflow 從此可擴充而不失去保護。
    $pwshRunCount = @([regex]::Matches($governanceWorkflow, '(?m)^\s*run:\s*pwsh\b')).Count
    $totalRunCount = @([regex]::Matches($governanceWorkflow, '(?m)^\s*run:\s*\S')).Count
    Assert-True ($pwshRunCount -ge 5) 'agent-governance workflow runs the governance checks with PowerShell 7'
    Assert-True ($pwshRunCount -eq $totalRunCount) 'agent-governance workflow runs every step with PowerShell 7 (no legacy or non-pwsh shell)'

    $prReviewWorkflow = Get-Content -LiteralPath '.github/workflows/pr-review-agent.yml' -Raw
    Assert-True ($prReviewWorkflow -match '(?m)^name:\s*PR Metadata Contract\s*$') 'PR metadata diagnostic has a truthful workflow name'
    Assert-True ($prReviewWorkflow -match '(?m)^\s{4}name:\s*pr-metadata-contract-diagnostic\s*$') 'PR metadata job cannot be mistaken for the merge-authority context'
    Assert-True (-not ($prReviewWorkflow -match '(?m)^\s+paths-ignore:\s*$')) 'PR metadata workflow does not use paths-ignore'
    Assert-True ($prReviewWorkflow -match '(?m)^\s+runs-on:\s+ubuntu-latest\s*$') 'PR review workflow uses lightweight ubuntu runner'
    Assert-True ($prReviewWorkflow -match 'check-pr-body-evidence\.ps1') 'PR review workflow enforces PR body evidence'
    Assert-True ($prReviewWorkflow -match 'changed-paths\.bin' -and $prReviewWorkflow -match 'name-only -z') 'PR metadata workflow preserves NUL-delimited changed paths'
    Assert-True ($prReviewWorkflow -match [regex]::Escape('"$BASE_SHA...$HEAD_SHA"')) 'PR metadata workflow diffs from the merge base so newer main commits are not classified as PR changes'
    Assert-True ($prReviewWorkflow -match 'check-pr-local-preflight\.ps1 -PrNumber <n>') 'PR review workflow points reviewers to the local preflight gate'
    Assert-True ($prReviewWorkflow -match 'design-semantic-visual') 'PR review workflow identifies the semantic/pixel CI authority'
    Assert-True ($prReviewWorkflow -match 'types:\s*\[opened, edited, synchronize') 'editing a PR body retriggers the evidence check'
    Assert-True (-not ($prReviewWorkflow -match 'scripts/pr-review-agent\.ps1')) 'PR review workflow does not rerun the local review agent in CI'
    Assert-True (-not ($prReviewWorkflow -match "'-SkipGitNexus'|'-AllowGitNexusUnavailable'|'-ReportOnly'")) 'PR review workflow no longer carries local review-agent flags'
    Assert-True (-not ($prReviewWorkflow -match '(?m)^\s+pull-requests:\s+write\s*$')) 'PR review workflow does not request pull-requests write permission'
    Assert-True (-not ($prReviewWorkflow -match '(?m)^\s+checks:\s+write\s*$')) 'PR review workflow does not request checks write permission'
    Assert-True (-not ($prReviewWorkflow -match 'npm ci|npm install --no-audit --no-fund|python -m pip install')) 'PR review workflow does not install local service dependencies in CI'
    Assert-True ($prReviewWorkflow -match 'raw_body_retained\s*=\s*\$false') 'PR metadata artifact explicitly records that raw body is not retained'
    Assert-True (-not ($prReviewWorkflow -match 'artifacts/pr-review-agent/pr-body\.md|path:\s*artifacts/pr-review-agent')) 'PR metadata artifact never uploads the raw body directory'

    $localPreflight = Get-Content -LiteralPath 'scripts/dev/check-pr-local-preflight.ps1' -Raw
    Assert-True ($localPreflight -match 'baseRefOid,headRefOid') 'local preflight resolves the selected PR base/head commits'
    Assert-True ($localPreflight -match 'localHead -ne \$headSha') 'local preflight rejects a checkout that is not the selected PR head'
    Assert-True (-not ($localPreflight -match "-BaseSha',\s*'origin/main'|-HeadSha',\s*'HEAD'")) 'local preflight does not mix selected PR evidence with ambient origin/main or HEAD'
    Assert-True ($localPreflight -match 'RequiredScreenIds\s*=\s*\[string\[\]\]@\(\$designScope\.required_screen_ids\)') 'local preflight preserves required screen IDs as a native PowerShell string array'
    Assert-True ($localPreflight -match 'if \(\$hasFrontendPaths -and -not \$SkipViewerVerify -and \$hasKitManagerPaths\)') 'local preflight builds Kit Manager on both default and SkipReviewAgent paths'
    Assert-True (-not ($prReviewWorkflow -match 'gitnexus@1\.6\.5')) 'PR review workflow does not install GitNexus in CI'
    Assert-True (-not ($prReviewWorkflow -match 'gitnexus analyze --index-only')) 'PR review workflow does not build a GitNexus index in CI'

    $gitnexusIgnore = Get-Content -LiteralPath '.gitnexusignore' -Raw
    $searchIgnore = Get-Content -LiteralPath '.ignore' -Raw
    foreach ($historicalPath in @('/.workflow/', '/artifacts/', '/docs/superpowers/', '/openspec/changes/archive/')) {
        Assert-True ($gitnexusIgnore -match [regex]::Escape($historicalPath)) ".gitnexusignore excludes historical path $historicalPath"
        Assert-True ($searchIgnore -match [regex]::Escape($historicalPath)) ".ignore excludes historical path $historicalPath"
    }
    Assert-True (-not (Test-Path -LiteralPath '.workflow')) '.workflow scratch residue is absent from the checkout'
    foreach ($ignoredPath in @(
        '/bim-streaming-server/source/extensions/ezplus.bim_review_stream.messaging/ezplus/bim_review_stream/messaging/stage_loading.py',
        '/bim-streaming-server/source/extensions/ezplus.bim_review_stream.messaging/ezplus/bim_review_stream/messaging/ifc2usdc_powershell_adapter.py',
        '/bim-streaming-server/source/extensions/ezplus.bim_review_stream.messaging/ezplus/bim_review_stream/messaging/conversion_authority.py',
        '/bim-streaming-server/tests/test_host_native_conversion_service.py'
    )) {
        Assert-True ($gitnexusIgnore -match [regex]::Escape($ignoredPath)) ".gitnexusignore excludes analyzer crash path $ignoredPath"
    }

    $prBodyEvidenceChecker = Get-Content -LiteralPath 'scripts/tests/check-pr-body-evidence.ps1' -Raw
    foreach ($marker in @('Change lane', 'Behavior contract changed', 'Requirement source', 'GitNexus evidence', 'Browser E2E evidence', 'Design gate status', 'Design screen(s)', 'Reference-missing route(s) / surface(s)', 'Full completion claimed', 'Design reference manifest', 'Visual fidelity result', 'Visual comparison', 'Visual artifacts', 'Agent workflow changed?')) {
        Assert-True ($prBodyEvidenceChecker -match [regex]::Escape($marker)) "PR body evidence checker requires $marker"
    }

    $prTemplate = Get-Content -LiteralPath '.github/PULL_REQUEST_TEMPLATE.md' -Raw
    foreach ($marker in @('AI Coding Governance', 'Change lane', 'Behavior contract changed', 'Linked issue', 'Requirement source', 'CODEOWNERS', 'GitNexus', 'Browser E2E evidence', 'Design gate status', 'Design screen(s)', 'Reference-missing route(s) / surface(s)', 'Full completion claimed', 'Design reference manifest', 'Visual fidelity result', 'Visual comparison', 'Visual artifacts')) {
        Assert-True ($prTemplate -match [regex]::Escape($marker)) "PR template contains $marker"
    }

    $reviewDoc = Get-Content -LiteralPath 'docs/PR_REVIEW_AGENT.md' -Raw
    foreach ($marker in @('Required checks', 'agent-governance', 'CODEOWNERS', 'branch protection', 'remote-only', 'PR body evidence')) {
        Assert-True ($reviewDoc -match [regex]::Escape($marker)) "PR review doc contains $marker"
    }

    # Machine gates for openspec/specs/agent-doc-context-budget/spec.md:
    # line budgets, sub-file index completeness, dead-link liveness, mirror declaration, mirror pairing.
    $agentsBody = Get-Content -LiteralPath 'AGENTS.md' -Raw
    $claudeBody = Get-Content -LiteralPath 'CLAUDE.md' -Raw
    foreach ($generatedBody in @($agentsBody, $claudeBody)) {
        $generatedMatch = [regex]::Match($generatedBody, '(?s)<!-- gitnexus:start -->.*?<!-- gitnexus:end -->')
        Assert-True $generatedMatch.Success 'GitNexus generated block has both markers'
        Assert-True (($generatedMatch.Value -split "`r?`n").Count -gt 1) 'GitNexus generated block remains multiline'
    }
    $agentsLineCount = @(Get-Content -LiteralPath 'AGENTS.md').Count
    $claudeLineCount = @(Get-Content -LiteralPath 'CLAUDE.md').Count
    foreach ($budget in @(
        @{ Path = 'AGENTS.md'; Min = 150; Max = 200 },
        @{ Path = 'CLAUDE.md'; Min = 40; Max = 100 },
        @{ Path = 'docs/agents/advanced-agent-reasoning-contract.md'; Min = 40; Max = 70 },
        @{ Path = 'docs/agents/codex-loop-workflows.md'; Min = 50; Max = 90 }
    )) {
        $count = @(Get-Content -LiteralPath $budget.Path).Count
        Assert-True ($count -ge $budget.Min -and $count -le $budget.Max) "$($budget.Path) line budget actual=$count"
    }
    Assert-True ($agentsLineCount -le 250) "AGENTS.md within 250-line budget (actual: $agentsLineCount); split into docs/agents/*.md or amend agent-doc-context-budget spec"
    Assert-True ($claudeLineCount -le 130) "CLAUDE.md within 130-line budget (actual: $claudeLineCount); split into docs/agents/*.md or amend agent-doc-context-budget spec"

    Assert-True ($claudeBody -match 'AGENTS\.md') 'CLAUDE.md references AGENTS.md'
    Assert-True ($claudeBody -match 'source of truth') 'CLAUDE.md declares AGENTS.md as source of truth'

    & (Join-Path $repoRoot 'scripts/dev/sync-agent-skills.ps1') -Mode Check -RepoRoot $repoRoot
    & (Join-Path $repoRoot 'scripts/tests/test-agent-skills-sync.ps1')
    $commandFiles = @(Get-ChildItem -File -LiteralPath '.claude/commands' | Select-Object -ExpandProperty Name)
    Assert-True ($commandFiles.Count -eq 1 -and $commandFiles[0] -eq 'repo-health.md') '.claude/commands contains only the repo-native repo-health entrypoint'
    Assert-True (-not ((Get-Content -Raw -LiteralPath '.claude/commands/repo-health.md') -match 'agent-skills:')) 'tracked Claude command does not reference the retired agent-skills plugin'
    $personaDocs = @(Get-ChildItem -File -Filter '*.md' -LiteralPath '.claude/agents' | ForEach-Object { Get-Content -Raw -LiteralPath $_.FullName }) -join "`n"
    Assert-True (-not ($personaDocs -match '`/(ship|review|test|build|plan|spec|code-simplify)`')) 'Claude persona docs do not reference retired slash-command entrypoints'
    Assert-FileContains 'bim-streaming-server/AGENTS.md' '`governance-service`.*外部公司雲端.*coordinator collaboration handlers' 'streaming formal review-data boundary points to current governance authorities'
    Assert-FileContains 'docs/agents/repo-data-flow-and-ownership.md' '\| Annotation metadata \| `governance-service` \+ 外部公司雲端 `bim-control` \|' 'annotation ownership includes local governance-service and external cloud authority'
    Assert-True (-not ((Get-Content -Raw -LiteralPath 'scripts/tests/test-agent-skills-sync.ps1') -match '\bWrite-Host\b')) 'agent skill sync test uses structured logging instead of bare Write-Host'
    $rebuildLibraryBody = Get-Content -Raw -LiteralPath 'scripts/lib/rebuild-test-deploy.ps1'
    $rebuildEntrypointBody = Get-Content -Raw -LiteralPath 'scripts/dev/rebuild-test-deploy.ps1'
    $structLogModuleBody = Get-Content -Raw -LiteralPath 'scripts/lib/StructLog.psm1'
    Assert-True (-not ($structLogModuleBody -match '[^\x00-\x7F]')) 'StructLog module remains ASCII-safe for Windows PowerShell 5.1 no-BOM parsing'
    Assert-True ($rebuildLibraryBody -match 'StructLog\.psm1') 'rebuild library imports the shared structured logger'
    Assert-True ($rebuildLibraryBody -match 'Write-StructLifecycle') 'rebuild library emits cutover/recovery paths through structured lifecycle logging'
    Assert-True (-not ($rebuildLibraryBody -match 'Write-Host[^\r\n]*retained previous checkout')) 'rebuild library does not emit the retained recovery path with bare Write-Host'
    Assert-True (-not ($rebuildEntrypointBody -match '\bWrite-Host\b')) 'rebuild dev entrypoint emits its result through structured logging'
    Assert-True ($rebuildEntrypointBody -match 'test deployment rebuild failed') 'rebuild dev entrypoint distinguishes nonzero deployment failure from completion'

    foreach ($overlayPath in @('docs/agents/advanced-agent-reasoning-contract.md', 'docs/agents/codex-loop-workflows.md')) {
        Assert-FileContains $overlayPath ([regex]::Escape('C:\Users\IOT\.codex\docs\agents\task-routing.md')) "$overlayPath points to global task-routing source of truth"
        $overlayBody = Get-Content -LiteralPath $overlayPath -Raw
        foreach ($genericHeading in @('Task Complexity Tiers', 'Reasoning Effort Routing', 'Codex Model / Effort Lane Routing')) {
            Assert-True (-not ($overlayBody -match [regex]::Escape($genericHeading))) "$overlayPath does not duplicate generic heading $genericHeading"
        }
    }

    # Active governance surfaces must not pin exact model slugs. Approved specs and plans are historical design records.
    $activeGovernancePaths = @(
        'AGENTS.md'
        'CLAUDE.md'
        'docs/agents/advanced-agent-reasoning-contract.md'
        'docs/agents/codex-loop-workflows.md'
        '.codex/skills/ai-bim-fast-fix/SKILL.md'
        '.codex/skills/ai-bim-bounded-change/SKILL.md'
        '.codex/skills/spec-to-done/SKILL.md'
    )
    foreach ($activePath in $activeGovernancePaths) {
        Assert-True (-not ((Get-Content -LiteralPath $activePath -Raw) -match '(?i)\bgpt-[0-9]')) "$activePath does not contain an exact GPT model slug"
    }

    $codexConfig = Get-Content -LiteralPath '.codex/config.toml' -Raw
    Assert-True ($codexConfig -match '(?m)^default_permissions\s*=\s*"safe-workspace"\s*$') '.codex/config.toml defaults Codex to the governed safe-workspace permission profile'
    Assert-True ($codexConfig -match '(?m)^extends\s*=\s*":workspace"\s*$') '.codex/config.toml safe-workspace profile inherits the native workspace boundary'
    Assert-True ($codexConfig -match '\[permissions\.safe-workspace\.network\]') '.codex/config.toml declares safe-workspace network permissions'
    foreach ($domain in @('api.github.com', 'github.com')) {
        Assert-True ($codexConfig -match [regex]::Escape('"' + $domain + '"')) ".codex/config.toml allows $domain"
    }
    Assert-True ($codexConfig -match 'Plugin enablement is user-scoped') '.codex/config.toml points plugin enablement to the user-scoped config'
    Assert-True (-not ($codexConfig -match '(?m)^\s*\[plugins\.')) '.codex/config.toml does not claim ineffective project-local plugin state'
    Assert-FileContains 'docs/agents/superpowers-invocation-policy.md' 'user-scoped.*config\.toml' 'Superpowers policy records the Codex plugin configuration scope'
    foreach ($forbiddenConfigKey in @('sandbox_workspace_write', 'sandbox_mode', 'model\s*=', 'model_reasoning_effort\s*=')) {
        Assert-True (-not ($codexConfig -match $forbiddenConfigKey)) ".codex/config.toml does not define forbidden selector $forbiddenConfigKey"
    }

    $specMetadata = Get-Content -LiteralPath '.codex/skills/spec-to-done/agents/openai.yaml' -Raw
    Assert-True ($specMetadata -match 'allow_implicit_invocation:\s*false') 'spec-to-done implicit invocation is mechanically disabled'

    $superpowersPolicy = Get-Content -LiteralPath 'docs/agents/superpowers-invocation-policy.md' -Raw
    foreach ($policyTerm in @(
        'repo-native lean mode',
        'explicit-only',
        'Task complexity itself is never a substitute for explicit invocation',
        'No automatic chaining',
        'spec-to-done',
        'brainstorming',
        'writing-plans',
        'subagent-driven-development',
        'brainstorm | plan — prohibited',
        'plan | implementation — prohibited'
    )) {
        Assert-True ($superpowersPolicy -match [regex]::Escape($policyTerm)) "Superpowers invocation policy contains: $policyTerm"
    }
    Assert-True ($agentsBody -match [regex]::Escape('docs/agents/superpowers-invocation-policy.md')) 'AGENTS.md indexes the Superpowers invocation policy'
    Assert-True ($claudeBody -match [regex]::Escape('docs/agents/superpowers-invocation-policy.md')) 'CLAUDE.md indexes the Superpowers invocation policy'

    $codexSpecToDone = Get-Content -LiteralPath '.codex/skills/spec-to-done/SKILL.md' -Raw -Encoding UTF8
    $claudeSpecToDone = Get-Content -LiteralPath '.claude/skills/spec-to-done/SKILL.md' -Raw -Encoding UTF8
    $implicitTriggers = @(
        ([string][char]0x5BE6 + [char]0x4F5C + ' spec'),
        ([string][char]0x5B8C + [char]0x6210 + [char]0x9700 + [char]0x6C42),
        ([string][char]0x4F7F + [char]0x7528 + ' agents')
    )
    foreach ($implicitTrigger in $implicitTriggers) {
        Assert-True ($codexSpecToDone -match [regex]::Escape($implicitTrigger)) "Codex spec-to-done excludes implicit trigger: $implicitTrigger"
    }
    foreach ($hardGate in @('P0', 'P1', 'P3', 'P4', 'P5', 'P6', 'P7', 'HELD', 'browser evidence', 'ship-item', 'GitNexus')) {
        Assert-True ($codexSpecToDone -match [regex]::Escape($hardGate)) "Codex spec-to-done preserves hard-gate marker: $hardGate"
        Assert-True ($claudeSpecToDone -match [regex]::Escape($hardGate)) "Claude spec-to-done preserves hard-gate marker: $hardGate"
    }
    foreach ($costGuardrail in @(
        'maxAgentCalls=40',
        'maxP5VerifierBatches=2',
        'maxP5Rounds=2',
        'maxEvidenceAttempts=2',
        'evidence-closeout',
        'run_budget_exhausted',
        'resume_state_invalid',
        'scope_drift',
        'evidence_stale'
    )) {
        Assert-True ($codexSpecToDone -match [regex]::Escape($costGuardrail)) "Codex spec-to-done preserves cost guardrail: $costGuardrail"
        Assert-True ($claudeSpecToDone -match [regex]::Escape($costGuardrail)) "Claude spec-to-done preserves cost guardrail: $costGuardrail"
    }
    Assert-True ($codexSpecToDone -match [regex]::Escape('fork_turns:"none"')) 'Codex spec-to-done forbids full-history native subagent forks'
    Assert-True ($codexSpecToDone -match [regex]::Escape('codex:<actual-session-or-agent-id>')) 'Codex spec-to-done records actual resumable session or agent IDs'

    $claudeStateValidator = Get-Content -LiteralPath '.claude/skills/spec-to-done/validate-state.mjs' -Raw -Encoding UTF8
    $codexStateValidator = Get-Content -LiteralPath '.codex/skills/spec-to-done/validate-state.mjs' -Raw -Encoding UTF8
    Assert-True ($claudeStateValidator -ceq $codexStateValidator) 'Claude and Codex spec-to-done state validators remain byte-equivalent as text'
    foreach ($stateMarker in @('native-* labels are not resumable run IDs', 'run_budget_exhausted', 'evidence_stale', 'expected-agent-limit', 'expected-worktree', 'production files changed after evidence was captured')) {
        Assert-True ($claudeStateValidator -match [regex]::Escape($stateMarker)) "spec-to-done state validator contains: $stateMarker"
    }

    $stdPlan = Get-Content -LiteralPath '.claude/workflows/std-plan.js' -Raw -Encoding UTF8
    $stdImplement = Get-Content -LiteralPath '.claude/workflows/std-implement.js' -Raw -Encoding UTF8
    $stdEvidence = Get-Content -LiteralPath '.claude/workflows/std-evidence.js' -Raw -Encoding UTF8
    $stdCloseout = Get-Content -LiteralPath '.claude/workflows/std-evidence-closeout.js' -Raw -Encoding UTF8
    $fuAdversarial = Get-Content -LiteralPath '.claude/workflows/fu-adversarial-verify-generic.js' -Raw -Encoding UTF8
    Assert-True ($stdPlan -match 'MAX_PARALLEL_REVIEWERS\s*=\s*2') 'P1 reviewer fan-out is capped at two'
    Assert-True (-not ($stdPlan -match 'parallel\(pendingAxes\.map')) 'P1 no longer launches all pending axes in one wave'
    foreach ($budgetedWorkflow in @($stdPlan, $stdImplement, $stdEvidence, $stdCloseout, $fuAdversarial)) {
        Assert-True ($budgetedWorkflow -match 'remainingAgentCalls') 'every agent-bearing spec-to-done workflow accepts the remaining run budget'
        Assert-True ($budgetedWorkflow -match 'agentCallsUsed') 'every agent-bearing spec-to-done workflow reports consumed calls'
        Assert-True ($budgetedWorkflow -match 'run_budget_exhausted') 'every agent-bearing spec-to-done workflow fails closed at the run budget'
    }
    Assert-True ($fuAdversarial -match 'MAX_VERIFIER_BATCHES\s*=\s*2') 'P5 verifier concurrency is capped at two batches'
    Assert-True ($fuAdversarial -match 'MAX_FINDINGS\s*=\s*32') 'P5 rejects unbounded finding registries'
    Assert-True ($stdCloseout -match 'MAX_EVIDENCE_ATTEMPTS.*2|MAX_EVIDENCE_ATTEMPTS\).*?>\s*2') 'evidence closeout is capped at two attempts'
    foreach ($closeoutMarker in @('closeoutTaskIds', 'productionFilesChanged', 'scope_drift', 'evidence_stale', 'evidence_not_closing')) {
        Assert-True ($stdCloseout -match [regex]::Escape($closeoutMarker)) "evidence closeout preserves fail-closed marker: $closeoutMarker"
    }
    foreach ($testDeploySafetyMarker in @(
        'test_deploy_process_unproven',
        '-StopOwnedRuntime',
        "-DeploymentRoot 'D:\Users\deploy\AI-bim-geo'",
        'freshly fetched `origin/main`',
        '不得拿未 merge branch 宣稱已在部署區驗證'
    )) {
        Assert-True ($codexSpecToDone -match [regex]::Escape($testDeploySafetyMarker)) "Codex spec-to-done preserves test-deploy safety marker: $testDeploySafetyMarker"
        Assert-True ($claudeSpecToDone -match [regex]::Escape($testDeploySafetyMarker)) "Claude spec-to-done preserves test-deploy safety marker: $testDeploySafetyMarker"
    }

    $claudePortHelperPath = '.claude/skills/spec-to-done/ensure-host-native-ports-free.ps1'
    $codexPortHelperPath = '.codex/skills/spec-to-done/ensure-host-native-ports-free.ps1'
    $claudePortHelper = Get-Content -LiteralPath $claudePortHelperPath -Raw -Encoding UTF8
    $codexPortHelper = Get-Content -LiteralPath $codexPortHelperPath -Raw -Encoding UTF8
    Assert-True ($claudePortHelper -ceq $codexPortHelper) 'Claude and Codex spec-to-done port helpers remain byte-equivalent as text'
    foreach ($helperSafetyMarker in @(
        '[switch] $StopOwnedRuntime',
        '[string] $DeploymentRoot',
        'deployment-pidfile',
        'executable-path',
        'CreationKey',
        'Test-PortSnapshotsExact',
        'Get-RuntimeRoleEvidence',
        'kit-launcher-lineage',
        'conversion-launcher-lineage',
        'Test-DeploymentTopologyUnchanged',
        '$process.Handle',
        '$process.Kill()',
        'caller port overrides are forbidden',
        "CanonicalTestDeploymentRoot = 'D:\Users\deploy\AI-bim-geo'"
    )) {
        Assert-True ($claudePortHelper -match [regex]::Escape($helperSafetyMarker)) "spec-to-done port helper contains safety marker: $helperSafetyMarker"
    }
    Assert-True (-not ($claudePortHelper -match 'command-line-path|Test-TextContainsPathBoundary|taskkill\.exe')) 'spec-to-done stop authorization excludes spoofable command-line evidence and PID-only taskkill'
    Assert-True (-not ($claudePortHelper -match 'GetEnvironmentVariable\(\$Name')) 'spec-to-done explicit stop topology does not inherit caller process environment'
    Assert-True (-not ($claudePortHelper -match '實際停（預設）')) 'spec-to-done port helper no longer defaults to destructive cleanup'

    $portHelperBehaviorTestPath = 'scripts/tests/test-spec-to-done-port-helper.ps1'
    Assert-True (Test-Path -LiteralPath $portHelperBehaviorTestPath -PathType Leaf) 'spec-to-done port helper has a dedicated behavior test'
    $portHelperBehaviorTest = Get-Content -LiteralPath $portHelperBehaviorTestPath -Raw
    foreach ($behaviorMarker in @(
        'every owner of the same target port is classified',
        'pidfile identity cannot independently authorize stop',
        'PID reuse is caught before the first stop',
        'stable owner invokes exactly one validated stop'
    )) {
        Assert-True ($portHelperBehaviorTest -match [regex]::Escape($behaviorMarker)) "spec-to-done helper behavior test covers: $behaviorMarker"
    }
    Assert-True ($ci -match '(?s)Run spec-to-done port helper safety tests \(PowerShell 7\).*?pwsh .*?test-spec-to-done-port-helper\.ps1') 'CI runs spec-to-done helper safety tests in PowerShell 7'
    Assert-True ($ci -match '(?s)Run spec-to-done port helper safety tests \(Windows PowerShell 5\.1\).*?powershell\.exe .*?test-spec-to-done-port-helper\.ps1') 'CI runs spec-to-done helper safety tests in Windows PowerShell 5.1'

    foreach ($testDeployContractPath in @('AGENTS.md', 'docs/agents/product-operability-and-script-contract.md', 'docs/agents/sub-repo-verify-commands.md')) {
        $testDeployContract = Get-Content -LiteralPath $testDeployContractPath -Raw -Encoding UTF8
        Assert-True ($testDeployContract -match [regex]::Escape('-StopOwnedRuntime')) "$testDeployContractPath documents the explicit ownership-gated stop"
        Assert-True ($testDeployContract -match [regex]::Escape("D:\Users\deploy\AI-bim-geo")) "$testDeployContractPath pins the canonical test deployment root"
        Assert-True ($testDeployContract -match 'helper 無法證明 ownership 時必須 HELD') "$testDeployContractPath keeps unproven ownership non-destructive"
    }
    foreach ($shipSafetyMarker in @('review_required', 'cyber_safeguard_payload', 'git merge-base', 'git rebase origin/main', 'published PR branch', 'git merge --no-edit origin/main', 'seg/seg/id', 'passwd')) {
        Assert-True ($codexSpecToDone -match [regex]::Escape($shipSafetyMarker)) "Codex spec-to-done preserves ship safety marker: $shipSafetyMarker"
        Assert-True ($claudeSpecToDone -match [regex]::Escape($shipSafetyMarker)) "Claude spec-to-done preserves ship safety marker: $shipSafetyMarker"
    }

    $shipItemMarkdown = Get-Content -LiteralPath '.claude/workflows/ship-item.md' -Raw -Encoding UTF8
    $shipItemPrompt = Get-Content -LiteralPath '.claude/workflows/ship-item.js' -Raw -Encoding UTF8
    foreach ($shipSource in @($shipItemMarkdown, $shipItemPrompt)) {
        foreach ($shipSafetyMarker in @('review_required', 'cyber_safeguard_payload', 'git fetch origin', 'git merge-base', 'git rebase origin/main', 'published PR branch', 'git merge --no-edit origin/main', 'seg/seg/id', 'passwd')) {
            Assert-True ($shipSource -match [regex]::Escape($shipSafetyMarker)) "ship-item dual-maintained source preserves safety marker: $shipSafetyMarker"
        }
        Assert-True ($shipSource -match 'MUST NOT[^\r\n]*gh pr merge --admin') 'ship-item forbids the agent from using the admin merge override'
        Assert-True ($shipSource -match 'preparation') 'ship-item separates preparation from merge authority'
        Assert-True (($shipSource -match 'apex') -and ($shipSource -match 'arbiter|裁決')) 'ship-item requires an independent apex merge verdict'
        Assert-True ($shipSource -match 'headOid') 'ship-item binds the verdict to an exact PR head'
        Assert-True ($shipSource -match [regex]::Escape('--merge --match-head-commit')) 'ship-item preserves snapshot ancestry with merge commits'
        Assert-True (-not ($shipSource -match [regex]::Escape('--squash --match-head-commit'))) 'ship-item does not squash away snapshot commits'
    }

    $claudeSettingsRaw = Get-Content -LiteralPath '.claude/settings.json' -Raw
    $claudeSettings = $claudeSettingsRaw | ConvertFrom-Json
    Assert-True ($claudeSettings.permissions.defaultMode -eq 'plan') 'Claude defaults this project to read-only plan mode'
    Assert-True ($claudeSettings.permissions.disableBypassPermissionsMode -eq 'disable') 'Claude project settings disable bypass-permissions mode'
    Assert-True (-not ($claudeSettingsRaw -match '_tmp_inventory\.ps1')) 'Claude read-only permissions do not pre-approve an external mutable inventory script'
    Assert-True ($claudeSettings.enabledPlugins.'superpowers@claude-plugins-official' -eq $false) 'Claude project-specific configuration disables the Superpowers plugin'
    Assert-True ($claudeSettings.disableAllHooks -eq $true) 'Claude project settings disable all lifecycle hooks'
    Assert-True ($claudeSettings.PSObject.Properties.Name -notcontains 'hooks') 'Claude project settings do not distribute branch-controlled command hooks'
    Assert-True (-not ($claudeSettingsRaw -match '"type"\s*:\s*"command"')) 'Claude project settings contain no automatic command hook'
    $browserGate = Get-Content -LiteralPath 'scripts/hooks/require-gstack-evidence.ps1' -Raw
    Assert-True ($browserGate -match 'verify-design-system-visual-result\.ps1') 'merge evidence gate validates the design-system visual result'
    Assert-True ($browserGate -match 'baseRefOid,headRefOid') 'merge evidence gate binds to the actual PR base/head'
    Assert-True (-not ($browserGate -match 'DESIGN_SYSTEM_VISUAL_RESULT_PATH')) 'merge evidence gate has no arbitrary visual-result path override'
    Assert-True ((Get-Content -LiteralPath 'scripts/lib/design-system-gate.ps1' -Raw) -match 'reference_missing_product_surfaces') 'shared scope resolver covers reference-missing products such as Kit Manager'

    $fastFixSkill = Get-Content -LiteralPath '.codex/skills/ai-bim-fast-fix/SKILL.md' -Raw
    Assert-True ($fastFixSkill -match 'Escalate directly to Lane G') 'Fast Fix governed triggers escalate directly to Lane G'
    foreach ($frontendLabel in @('Backend API called', 'Runtime action', 'loading, success, failure, and retry', 'Design reference manifest', 'Visual fidelity result')) {
        Assert-True ($prBodyEvidenceChecker -match [regex]::Escape($frontendLabel)) "frontend evidence gate requires $frontendLabel"
    }
    $visualResultGate = Get-Content -LiteralPath 'scripts/tests/verify-design-system-visual-result.ps1' -Raw
    foreach ($visualMarker in @('max_diff_pixel_ratio', 'semantic_parity', 'required_semantic_states', 'subject_commit', 'fidelity_contract.platform', 'workspace_clean', 'ls-files --others --exclude-standard')) {
        Assert-True ($visualResultGate -match [regex]::Escape($visualMarker)) "visual result gate requires $visualMarker"
    }
    Assert-True ($visualResultGate -match '\$subjectCommit -eq \$TargetCommit') 'visual evidence must be produced from the exact target commit'
    Assert-True ($visualResultGate -match 'rev-parse --verify') 'symbolic target refs such as HEAD are canonicalized before exact commit comparison'
    foreach ($renameSafeSource in @($ci, (Get-Content -LiteralPath '.github/workflows/pr-review-agent.yml' -Raw), $browserGate, (Get-Content -LiteralPath 'scripts/dev/check-pr-local-preflight.ps1' -Raw), (Get-Content -LiteralPath 'scripts/lib/pr-review-agent.ps1' -Raw), $visualResultGate)) {
        Assert-True ($renameSafeSource -match 'diff --no-renames --name-only') 'changed-path classifier preserves both sides of renames'
    }
    $localPreflight = Get-Content -LiteralPath 'scripts/dev/check-pr-local-preflight.ps1' -Raw
    Assert-True ($localPreflight -match '\.tmp\\pr-local-preflight' -and $localPreflight -notmatch '\.tmp-pr-local-preflight') 'local preflight writes its own evidence only beneath the ignored .tmp directory'
    $e2eIgnore = Get-Content -LiteralPath 'artifacts/e2e/.gitignore' -Raw
    $e2eIgnoreLf = $e2eIgnore.Replace("`r`n", "`n")
    $e2eIgnoreCrLf = $e2eIgnoreLf.Replace("`n", "`r`n")
    foreach ($e2eIgnoreVariant in @($e2eIgnoreLf, $e2eIgnoreCrLf)) {
        Assert-True ($e2eIgnoreVariant -match '(?m)^_playwright-output/\r?$') 'Playwright raw output remains ignored under LF/CRLF'
        Assert-True ($e2eIgnoreVariant -match '(?m)^\*\.webm\r?$') 'Playwright videos remain ignored under LF/CRLF'
    }

    $routingFixtureJson = Get-Content -LiteralPath 'scripts/tests/fixtures/agent-governance-routing.json' -Raw
    $taskPacketSchema = Get-Content -LiteralPath 'scripts/tests/task-packet.schema.json' -Raw
    Assert-True ($routingFixtureJson | Test-Json -Schema $taskPacketSchema) 'task packet corpus validates against the closed schema'
    $routingFixtures = $routingFixtureJson | ConvertFrom-Json
    Assert-True ($routingFixtures.schema_version -eq 'task-packet-corpus/v2') 'routing fixture is the canonical task packet corpus'
    Assert-True ($routingFixtures.tasks.Count -eq 16) 'routing fixture suite has 16 anonymized golden tasks'
    foreach ($laneContract in @(@('F', 4), @('B', 4), @('G', 6), @('S', 2))) {
        Assert-True (@($routingFixtures.tasks | Where-Object { $_.lane -eq $laneContract[0] }).Count -eq $laneContract[1]) "routing fixtures have expected Lane $($laneContract[0]) coverage"
    }
    foreach ($fixture in $routingFixtures.tasks) {
        foreach ($field in @('lane', 'scope', 'owner', 'worktree_required', 'authorization_requirement', 'required_evidence', 'allowed_agents', 'forbidden_actions', 'max_agents', 'read_set', 'read_set_max', 'required_gates', 'escalation')) {
            Assert-True ($null -ne $fixture.$field) "task packet $($fixture.id) has $field"
        }
        Assert-True ($fixture.read_set.Count -le $fixture.read_set_max) "task packet $($fixture.id) stays within read_set_max"
    }
    Assert-True ($routingFixtures.routing_guards.Count -eq 11) 'task packet corpus retains eleven closed routing guards including external Lane S authorization'
    foreach ($fixtureId in @('delete-public-contract', 'deploy-false-fast', 'security-false-bounded', 'browser-evidence', 'real-fixture-contract', 'explicit-spec-authority')) {
        Assert-True ($null -ne ($routingFixtures.routing_guards | Where-Object id -eq $fixtureId | Select-Object -First 1)) "routing guard exists: $fixtureId"
    }

    $taskPacketSchemaMutations = @()
    $invalidFastWorktree = ($routingFixtures.tasks | Where-Object lane -eq 'F' | Select-Object -First 1) | ConvertTo-Json -Depth 20 | ConvertFrom-Json
    $invalidFastWorktree.worktree_required = $true
    $taskPacketSchemaMutations += @{ Name = 'Lane F worktree'; Packet = $invalidFastWorktree }
    $invalidBoundedImpact = ($routingFixtures.tasks | Where-Object { $_.lane -eq 'B' -and $_.scope -eq 'single_service_internal' } | Select-Object -First 1) | ConvertTo-Json -Depth 20 | ConvertFrom-Json
    $invalidBoundedImpact.required_gates = @($invalidBoundedImpact.required_gates | Where-Object { $_ -ne 'impact' })
    $taskPacketSchemaMutations += @{ Name = 'Lane B symbol impact'; Packet = $invalidBoundedImpact }
    $invalidNonSymbolImpact = ($routingFixtures.tasks | Where-Object scope -eq 'single_service_non_symbol' | Select-Object -First 1) | ConvertTo-Json -Depth 20 | ConvertFrom-Json
    $invalidNonSymbolImpact.required_gates = @($invalidNonSymbolImpact.required_gates) + 'impact'
    $invalidNonSymbolImpact.required_evidence = @($invalidNonSymbolImpact.required_evidence) + 'impact_result'
    $taskPacketSchemaMutations += @{ Name = 'Lane B non-symbol affected-only'; Packet = $invalidNonSymbolImpact }
    $invalidGovernedIntegration = ($routingFixtures.tasks | Where-Object lane -eq 'G' | Select-Object -First 1) | ConvertTo-Json -Depth 20 | ConvertFrom-Json
    $invalidGovernedIntegration.required_gates = @($invalidGovernedIntegration.required_gates | Where-Object { $_ -ne 'integration' })
    $taskPacketSchemaMutations += @{ Name = 'Lane G integration'; Packet = $invalidGovernedIntegration }
    $invalidBrowserEvidence = ($routingFixtures.tasks | Where-Object scope -eq 'user_workflow' | Select-Object -First 1) | ConvertTo-Json -Depth 20 | ConvertFrom-Json
    $invalidBrowserEvidence.required_gates = @($invalidBrowserEvidence.required_gates | Where-Object { $_ -ne 'browser_e2e' })
    $taskPacketSchemaMutations += @{ Name = 'user workflow browser evidence'; Packet = $invalidBrowserEvidence }
    $invalidSecurityAgent = ($routingFixtures.tasks | Where-Object scope -eq 'security_or_permission' | Select-Object -First 1) | ConvertTo-Json -Depth 20 | ConvertFrom-Json
    $invalidSecurityAgent.allowed_agents = @('coordinator', 'explorer', 'reviewer')
    $taskPacketSchemaMutations += @{ Name = 'security auditor boundary'; Packet = $invalidSecurityAgent }
    $invalidSpecAuthority = ($routingFixtures.tasks | Where-Object lane -eq 'S' | Select-Object -First 1) | ConvertTo-Json -Depth 20 | ConvertFrom-Json
    $invalidSpecAuthority.authorization_requirement = 'none'
    $taskPacketSchemaMutations += @{ Name = 'Lane S external authorization boundary'; Packet = $invalidSpecAuthority }
    $invalidAuthorityBoundary = ($routingFixtures.tasks | Select-Object -First 1) | ConvertTo-Json -Depth 20 | ConvertFrom-Json
    $invalidAuthorityBoundary.forbidden_actions = @($invalidAuthorityBoundary.forbidden_actions | Where-Object { $_ -ne 'unapproved_production_change' })
    $taskPacketSchemaMutations += @{ Name = 'unapproved production boundary'; Packet = $invalidAuthorityBoundary }
    foreach ($mutation in $taskPacketSchemaMutations) {
        $mutationJson = $mutation.Packet | ConvertTo-Json -Depth 20
        Assert-True (-not ($mutationJson | Test-Json -Schema $taskPacketSchema -ErrorAction SilentlyContinue)) "task packet schema rejects semantic mutation: $($mutation.Name)"
    }
    $missingLaneCorpus = $routingFixtureJson | ConvertFrom-Json
    $missingLaneCorpus.tasks = @($missingLaneCorpus.tasks | Where-Object lane -ne 'S')
    Assert-True (-not (($missingLaneCorpus | ConvertTo-Json -Depth 20) | Test-Json -Schema $taskPacketSchema -ErrorAction SilentlyContinue)) 'task packet schema rejects corpus without every lane'
    $mismatchedGuardCorpus = $routingFixtureJson | ConvertFrom-Json
    $mismatchedGuardCorpus.routing_guards[0].assertion = 'minimum_lane_g'
    Assert-True (-not (($mismatchedGuardCorpus | ConvertTo-Json -Depth 20) | Test-Json -Schema $taskPacketSchema -ErrorAction SilentlyContinue)) 'task packet schema rejects signal/assertion mismatch'
    $duplicateIdCorpus = $routingFixtureJson | ConvertFrom-Json
    $duplicateIdCorpus.tasks[1].id = $duplicateIdCorpus.tasks[0].id
    $duplicateIdJson = $duplicateIdCorpus | ConvertTo-Json -Depth 20
    Assert-True ($duplicateIdJson | Test-Json -Schema $taskPacketSchema) 'Draft-07 structure validation intentionally cannot express task id uniqueness'
    $duplicateIdPath = Join-Path ([IO.Path]::GetTempPath()) ("task-packet-duplicate-id-" + [guid]::NewGuid().ToString('N') + '.json')
    try {
        Set-Content -LiteralPath $duplicateIdPath -Value $duplicateIdJson -Encoding UTF8
        $duplicateIdResult = @(& node scripts/dev/validate-task-packet.mjs --input $duplicateIdPath)
        Assert-True ($LASTEXITCODE -eq 2) 'runtime CLI is mandatory and rejects duplicate task ids that Draft-07 cannot express'
        Assert-True ((($duplicateIdResult -join "`n") | ConvertFrom-Json).valid -eq $false) 'duplicate task id CLI result fails closed'
    } finally {
        Remove-Item -Force -LiteralPath $duplicateIdPath -ErrorAction SilentlyContinue
    }
    Assert-True (-not (Test-Path -LiteralPath 'skills-lock.json')) 'legacy skills-lock remains removed instead of acting as an unenforced pin source'
    $agentGovernancePathClass = @($verificationManifest.path_classes | Where-Object id -eq 'agent-governance')[0]
    Assert-True (@($agentGovernancePathClass.path_globs) -contains 'skills-lock.json') 'skills-lock tombstone routes any reintroduction through governance'
    Assert-True (@($verificationManifest.full_dispatch_globs) -contains 'skills-lock.json') 'skills-lock reintroduction is full-dispatch'

    $healthFixturePaths = @(Get-ChildItem -LiteralPath 'scripts/tests/fixtures/gitnexus-worktree-health' -Filter '*.json' -File | Sort-Object Name)
    Assert-True ($healthFixturePaths.Count -eq 9) 'GitNexus/worktree health suite has nine bounded fixtures including cleanup and wrong-registration output'
    $healthObservationSchema = Get-Content -LiteralPath 'scripts/tests/gitnexus-worktree-health-observation.schema.json' -Raw
    foreach ($healthFixturePath in $healthFixturePaths) {
        $healthFixtureJson = Get-Content -LiteralPath $healthFixturePath.FullName -Raw
        Assert-True ($healthFixtureJson | Test-Json -Schema $healthObservationSchema) "health observation schema validates $($healthFixturePath.Name)"
    }
    $healthReportSchema = Get-Content -LiteralPath 'scripts/tests/gitnexus-worktree-health-report.schema.json' -Raw
    foreach ($healthFixturePath in $healthFixturePaths) {
        $healthReport = @(& node scripts/dev/report-gitnexus-worktree-health.mjs --observation $healthFixturePath.FullName)
        Assert-True ($LASTEXITCODE -in @(0, 1, 2)) "health report uses a bounded exit code for $($healthFixturePath.Name)"
        Assert-True (($healthReport -join "`n") | Test-Json -Schema $healthReportSchema) "generated health report schema validates $($healthFixturePath.Name)"
    }

    $invalidOwnerObservation = Get-Content -LiteralPath $healthFixturePaths[0].FullName -Raw | ConvertFrom-Json
    $invalidOwnerObservation.worktrees[0].owner = $null
    $invalidOwnerObservation.worktrees[0].owner_status = 'active'
    $invalidOwnerJson = $invalidOwnerObservation | ConvertTo-Json -Depth 10
    Assert-True (-not ($invalidOwnerJson | Test-Json -Schema $healthObservationSchema -ErrorAction SilentlyContinue)) 'schema rejects owner-null with an active owner status like the runtime validator'

    $invalidControlOwnerObservation = Get-Content -LiteralPath $healthFixturePaths[0].FullName -Raw | ConvertFrom-Json
    $invalidControlOwnerObservation.worktrees[0].owner = "bad`nowner"
    $invalidControlOwnerJson = $invalidControlOwnerObservation | ConvertTo-Json -Depth 10
    Assert-True (-not ($invalidControlOwnerJson | Test-Json -Schema $healthObservationSchema -ErrorAction SilentlyContinue)) 'schema rejects owner control characters like the runtime validator'

    foreach ($stalePattern in @(('所有實作' + '走'), ('Codex CLI ' + '無 hook'), ('必須使用 ' + 'Superpowers'))) {
        foreach ($activePath in @('AGENTS.md', 'CLAUDE.md', 'docs/agents/github-workflow.md', '.codex/skills/spec-to-done/SKILL.md')) {
            Assert-True (-not ((Get-Content -LiteralPath $activePath -Raw) -match [regex]::Escape($stalePattern))) "$activePath excludes stale rule: $stalePattern"
        }
    }
    # GitNexus generated blocks are required in both root entrypoints and must
    # advertise the same current index metadata and multiline marker structure.
    $gitNexusMetadata = '17817 symbols, 28581 relationships, 300 execution flows'
    foreach ($entrypoint in @(@{ Name = 'AGENTS.md'; Body = $agentsBody }, @{ Name = 'CLAUDE.md'; Body = $claudeBody })) {
        Assert-True ($entrypoint.Body -match '<!-- gitnexus:start -->') "$($entrypoint.Name) has GitNexus start marker"
        Assert-True ($entrypoint.Body -match '<!-- gitnexus:end -->') "$($entrypoint.Name) has GitNexus end marker"
        $blockMatch = [regex]::Match($entrypoint.Body, '(?s)<!-- gitnexus:start -->.*?<!-- gitnexus:end -->')
        Assert-True $blockMatch.Success "$($entrypoint.Name) has multiline GitNexus block"
        Assert-True ($blockMatch.Value -match [regex]::Escape($gitNexusMetadata)) "$($entrypoint.Name) has current GitNexus metadata"
    }
    $agentsGitNexusBlock = [regex]::Match($agentsBody, '(?s)<!-- gitnexus:start -->.*?<!-- gitnexus:end -->').Value
    $claudeGitNexusBlock = [regex]::Match($claudeBody, '(?s)<!-- gitnexus:start -->.*?<!-- gitnexus:end -->').Value
    $metadataPattern = '17817 symbols, 28581 relationships, 300 execution flows'
    Assert-True (($agentsGitNexusBlock -match $metadataPattern) -and ($claudeGitNexusBlock -match $metadataPattern)) 'AGENTS.md and CLAUDE.md GitNexus blocks carry matching metadata'

    # No orphan sub-files: every tracked docs/agents/*.md must appear in BOTH root entrypoint index tables
    $subFiles = @(git ls-files 'docs/agents/*.md')
    Assert-True ($subFiles.Count -ge 5) 'docs/agents sub-file inventory resolved via git ls-files'
    foreach ($subFile in $subFiles) {
        Assert-True ($agentsBody -match [regex]::Escape($subFile)) "AGENTS.md index covers $subFile (no orphan sub-files)"
        Assert-True ($claudeBody -match [regex]::Escape($subFile)) "CLAUDE.md index covers $subFile (no orphan sub-files)"
        $subFileLineCount = @(Get-Content -LiteralPath $subFile).Count
        if ($subFileLineCount -gt 400) {
            Write-Warning "$subFile exceeds 400 lines ($subFileLineCount); agent-doc-context-budget spec suggests splitting (SHOULD, non-blocking)"
        }
    }

    # No dead links: every docs/**.md path referenced by a root entrypoint must exist
    $docRefs = @([regex]::Matches(($agentsBody + "`n" + $claudeBody), 'docs/[A-Za-z0-9_\-./]+\.md') |
        ForEach-Object { $_.Value } | Sort-Object -Unique)
    foreach ($docRef in $docRefs) {
        Assert-True (Test-Path -LiteralPath $docRef -PathType Leaf) "root entrypoint doc reference exists: $docRef"
    }

    # Mirror pairing: every tracked CLAUDE.md has a sibling tracked AGENTS.md, and vice versa
    $claudeDirs = @(git ls-files '*CLAUDE.md' | ForEach-Object { Split-Path $_ -Parent } | Sort-Object -Unique)
    $agentsDirs = @(git ls-files '*AGENTS.md' | ForEach-Object { Split-Path $_ -Parent } | Sort-Object -Unique)
    foreach ($dir in $claudeDirs) {
        Assert-True ($agentsDirs -contains $dir) "CLAUDE.md mirror in '$dir' has sibling AGENTS.md"
    }
    foreach ($dir in $agentsDirs) {
        Assert-True ($claudeDirs -contains $dir) "AGENTS.md in '$dir' has CLAUDE.md mirror"
    }

    & node --test tests/test_governed_dispatch_runtime.mjs tests/test_ship_item_runtime.mjs
    Assert-True ($LASTEXITCODE -eq 0) 'governed dispatch and ship-item runtime tests pass'
} finally {
    Pop-Location
}

Write-Host '[test-agent-governance-check] all assertions passed'
