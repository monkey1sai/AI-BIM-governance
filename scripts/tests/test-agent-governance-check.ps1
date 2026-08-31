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

function Get-WorkflowPermissionViolations {
    param(
        [Parameter(Mandatory = $true)][AllowEmptyCollection()][AllowEmptyString()][string[]] $Lines,
        [string] $WorkflowPath = ''
    )

    $violations = [System.Collections.Generic.List[string]]::new()
    $permissionHeader = [regex]'^(?<indent>\s*)(?:[''"])?permissions(?:[''"])?\s*:\s*(?<inline>[^#]*?)(?:\s+#.*)?$'
    $headerCount = 0
    # The dependency-free scanner intentionally accepts only an unambiguous YAML subset:
    # even comments and literals may not carry a second permissions token.
    $permissionTokenCount = [regex]::Matches(($Lines -join "`n"), '(?i)\bpermissions\b').Count
    if ($permissionTokenCount -ne 1) {
        $violations.Add("workflow must contain exactly one literal permissions token; found $permissionTokenCount")
    }

    $blockScalarIndent = -1
    for ($syntaxIndex = 0; $syntaxIndex -lt $Lines.Count; $syntaxIndex++) {
        $syntaxLine = $Lines[$syntaxIndex]
        if ($blockScalarIndent -ge 0) {
            if (-not $syntaxLine.Trim()) { continue }
            $syntaxIndent = [regex]::Match($syntaxLine, '^\s*').Value.Length
            if ($syntaxIndent -gt $blockScalarIndent) { continue }
            $blockScalarIndent = -1
        }

        $structuralLine = [regex]::Replace($syntaxLine, '\$\{\{.*?\}\}', '')
        if ($structuralLine -match '[{}]' -or
            $structuralLine -match '(?:^|[\s:\[,\-])\s*(?:&(?=[^\s&])|\*(?=\S))' -or
            $structuralLine -match '<<\s*:' -or
            $structuralLine -match '^\s*(?:-\s*)?"[^"]*"\s*:' -or
            $structuralLine -match '^\s*\?' -or
            $structuralLine -match '\\(?:x[0-9A-Fa-f]{2}|u[0-9A-Fa-f]{4}|U[0-9A-Fa-f]{8})') {
            $violations.Add("line $($syntaxIndex + 1): YAML flow maps, anchors, aliases, merges, quoted/complex keys, and escaped keys are forbidden")
        }
        $blockHeader = [regex]::Match($syntaxLine, '^(?<indent>\s*)[^#\r\n]+:\s*[|>][+-]?\s*(?:#.*)?$')
        if ($blockHeader.Success) {
            $blockScalarIndent = $blockHeader.Groups['indent'].Value.Length
        }
    }

    for ($lineIndex = 0; $lineIndex -lt $Lines.Count; $lineIndex++) {
        $headerMatch = $permissionHeader.Match($Lines[$lineIndex])
        if (-not $headerMatch.Success) { continue }
        $headerCount++

        $headerIndent = $headerMatch.Groups['indent'].Value.Length
        $inlineValue = $headerMatch.Groups['inline'].Value.Trim()
        if ($headerIndent -ne 0 -or $inlineValue -or $Lines[$lineIndex] -cnotmatch '^permissions:\s*(?:#.*)?$') {
            $violations.Add("line $($lineIndex + 1): only one literal root permissions block is allowed")
            continue
        }

        $entries = [System.Collections.Generic.List[string]]::new()
        for ($entryIndex = $lineIndex + 1; $entryIndex -lt $Lines.Count; $entryIndex++) {
            $entryLine = $Lines[$entryIndex]
            if (-not $entryLine.Trim() -or $entryLine.TrimStart().StartsWith('#')) { continue }

            $entryIndent = [regex]::Match($entryLine, '^\s*').Value.Length
            if ($entryIndent -le $headerIndent) { break }
            $entries.Add($entryLine)
        }
        $normalizedEntries = @($entries | ForEach-Object { $_.Trim() })
        $normalizedWorkflowPath = $WorkflowPath.Replace('\', '/')
        $allowsPullRequestRead = $normalizedWorkflowPath -match '(?:^|/)\.github/workflows/governance-trust-root\.yml$'
        # The @claude mention workflow is the one deliberate carve-out (issue #518):
        # claude-code-action must exchange an OIDC token for a Claude GitHub App token,
        # which requires literal 'id-token: write'. GITHUB_TOKEN stays read-only; every
        # write goes through the separately-installed Claude GitHub App, which is an
        # evidence provider and never satisfies the required human review.
        $allowsClaudeMention = $normalizedWorkflowPath -match '(?:^|/)\.github/workflows/claude\.yml$'
        # Avoid PowerShell's pipeline unrolling: under StrictMode a one-item
        # branch result becomes a scalar string and has no reliable .Count.
        $allowedEntries = @('contents: read')
        if ($allowsPullRequestRead) {
            $allowedEntries += 'pull-requests: read'
        }
        if ($allowsClaudeMention) {
            $allowedEntries += @('pull-requests: read', 'issues: read', 'id-token: write', 'actions: read')
        }
        $invalidEntries = @($entries | Where-Object {
            $rawEntry = $_
            @($allowedEntries | Where-Object { $rawEntry -ceq "  $_" }).Count -eq 0
        })
        if (
            $entries.Count -lt 1 -or $entries.Count -gt $allowedEntries.Count -or
            $normalizedEntries -notcontains 'contents: read' -or
            @($normalizedEntries | Sort-Object -Unique).Count -ne $normalizedEntries.Count -or
            @($normalizedEntries | Where-Object { $allowedEntries -notcontains $_ }).Count -gt 0 -or
            $invalidEntries.Count -gt 0
        ) {
            $violations.Add("line $($lineIndex + 1): root permissions require literal 'contents: read'; only governance-trust-root.yml may add literal 'pull-requests: read', and only claude.yml may add the literal mention read set plus 'id-token: write'")
        }
    }

    if ($headerCount -ne 1) {
        $violations.Add("workflow must contain exactly one root permissions block; found $headerCount")
    }

    return @($violations)
}

$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
Push-Location $repoRoot
try {

    Assert-FileContains '.github/ISSUE_TEMPLATE/agent-task.yml' 'docs/plans' 'agent task template points to docs/plans'
    Assert-FileContains '.github/ISSUE_TEMPLATE/agent-task.yml' 'acceptance_criteria' 'agent task template requires acceptance criteria'
    Assert-FileContains '.github/ISSUE_TEMPLATE/agent-task.yml' 'validation_commands' 'agent task template requires validation commands'
    Assert-FileContains '.github/ISSUE_TEMPLATE/agent-task.yml' 'evidence_contract' 'agent task template requires evidence contract'
    Assert-FileContains '.github/ISSUE_TEMPLATE/runtime-bug.yml' 'regression_guard' 'runtime bug template requires regression guard'

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
    Assert-FileContains 'openspec/AGENTS.md' 'verify-openspec-repository-lifecycle\.mjs' 'OpenSpec instructions document the repository-scoped lifecycle parity gate'
    foreach ($ownedPath in @('/AGENTS.md', '/docs/agents/', '/docs/plans/', '/.github/', '/scripts/')) {
        Assert-FileContains '.github/CODEOWNERS' ([regex]::Escape($ownedPath)) "CODEOWNERS covers $ownedPath"
    }

    $ci = Get-Content -LiteralPath '.github/workflows/ci.yml' -Raw
    foreach ($job in @('changes', 'root-contracts', 'coordinator', 'streaming', 'governance-service', 'viewer', 'design-semantic-visual', 'kit-manager-api', 'kit-manager-web', 'compose-config', 'powershell-static', 'secret-pattern-scan')) {
        Assert-True ($ci -match "(?m)^\s{2}$([regex]::Escape($job)):\s*$") "ci.yml contains job $job"
    }
    Assert-True (-not ($ci -match '(?m)^\s{2}agent-governance-contracts:\s*$')) 'ci.yml does not duplicate the Agent Governance suite'
    Assert-True ($ci -match 'changed path classifier') 'ci.yml contains changed path classifier'
    Assert-True ($ci -match 'types:\s*\[opened, edited, synchronize, reopened, ready_for_review\]') 'CI listens for PR base edits as well as head lifecycle events'
    $ciEditedGate = '${{ github.event.action != ''edited'' || github.event.changes.base != null }}'
    Assert-True (
        [regex]::Matches($ci, [regex]::Escape($ciEditedGate)).Count -eq 5
    ) 'all changed-path classifier steps skip body/title-only edits but run for base edits'
    Assert-True (
        $ci -match [regex]::Escape("`${{ github.workflow }}-`${{ github.ref }}-`${{ github.event.action == 'edited' && github.event.changes.base == null && 'metadata-only' || 'verification' }}")
    ) 'body/title-only CI uses an isolated concurrency group and cannot cancel exact-head verification'
    foreach ($output in @('root_contracts', 'coordinator', 'streaming', 'governance_service', 'viewer', 'agent_governance', 'conv_functional', 'kit_manager_api', 'kit_manager_web', 'compose_config', 'powershell_static', 'rebuild_test_deploy', 'secret_pattern_scan', 'plan_result', 'plan_sha256')) {
        $expectedOutput = $output + ': ${{ steps.paths.outputs.' + $output + ' }}'
        Assert-True ($ci -match [regex]::Escape($expectedOutput)) "changes job exposes $output output"
    }
    foreach ($output in @('frontend_product', 'frontend_visual_required', 'frontend_design_status', 'frontend_required_screen_ids')) {
        $expectedOutput = $output + ': ${{ steps.design_scope.outputs.' + $output + ' }}'
        Assert-True ($ci -match [regex]::Escape($expectedOutput)) "changes job exposes manifest-derived $output output"
    }
    Assert-True ($ci -match [regex]::Escape("^[a-z0-9][a-z0-9.-]{0,63}$")) 'CI accepts the dotted screen identifiers used by the design-system manifest'
    foreach ($gate in @('root_contracts', 'coordinator', 'streaming', 'governance_service', 'viewer', 'conv_functional', 'kit_manager_api', 'kit_manager_web', 'compose_config', 'powershell_static', 'rebuild_test_deploy', 'secret_pattern_scan')) {
        Assert-True ($ci -match [regex]::Escape("needs.changes.outputs.$gate == 'true'")) "ci.yml gates affected job on $gate"
    }
    Assert-True (([regex]::Matches($ci, "if: always\(\) && \(needs\.changes\.result != 'success' \|\|")).Count -eq 13) 'downstream CI jobs run on classifier failure instead of reporting skipped-success'
    Assert-True ($ci -match '(?s)name: Run rebuild transaction safety tests \(PowerShell 7\).*?shell: pwsh.*?run: pwsh -NoProfile -NonInteractive -ExecutionPolicy Bypass -File scripts/tests/test-rebuild-test-deploy\.ps1') 'CI runs rebuild transaction safety tests in a PowerShell 7 file scope'
    Assert-True ($ci -match '(?s)name: Run rebuild transaction safety tests \(Windows PowerShell 5\.1\).*?shell: pwsh.*?run: powershell\.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File scripts/tests/test-rebuild-test-deploy\.ps1') 'CI runs rebuild transaction safety tests in a Windows PowerShell 5.1 file scope'
    $verificationManifest = Get-Content -LiteralPath 'scripts/verification-manifest.json' -Raw | ConvertFrom-Json -Depth 100
    $verificationManifestJson = $verificationManifest | ConvertTo-Json -Depth 100
    $invalidConfigured = $verificationManifestJson | ConvertFrom-Json -Depth 100
    $invalidConfigured.gates[0].command = $null
    Assert-True (-not (($invalidConfigured | ConvertTo-Json -Depth 100) | Test-Json -SchemaFile 'scripts/tests/verification-manifest.schema.json' -ErrorAction SilentlyContinue)) 'configured gate with null command fails the manifest schema'
    $invalidNotConfigured = $verificationManifestJson | ConvertFrom-Json -Depth 100
    $missingGate = @($invalidNotConfigured.gates | Where-Object { -not $_.configured })[0]
    $missingGate.command = [pscustomobject]@{ executable = 'npm'; args = @('run', 'verify') }
    Assert-True (-not (($invalidNotConfigured | ConvertTo-Json -Depth 100) | Test-Json -SchemaFile 'scripts/tests/verification-manifest.schema.json' -ErrorAction SilentlyContinue)) 'not-configured gate with a command fails the manifest schema'
    Assert-True ($verificationManifest.schema_version -eq 'verification-manifest/v2') 'shared manifest uses the typed quality policy contract'
    $metricsPolicy = Get-Content -LiteralPath 'scripts/ai-coding-metrics-policy.json' -Raw | ConvertFrom-Json -Depth 100
    $metricsPolicyJson = $metricsPolicy | ConvertTo-Json -Depth 100
    $backdatedMetricsPolicy = $metricsPolicy | ConvertTo-Json -Depth 100 | ConvertFrom-Json -Depth 100
    $backdatedMetricsPolicy.baseline.started_on = '2020-01-01'
    Assert-True (-not (($backdatedMetricsPolicy | ConvertTo-Json -Depth 100) | Test-Json -SchemaFile 'scripts/tests/ai-coding-metrics-policy.schema.json' -ErrorAction SilentlyContinue)) 'backdated AI coding metrics policy fails the schema'
    Assert-FileContains '.gitignore' 'artifacts/telemetry/ai-coding/' 'raw AI coding telemetry cannot be accidentally committed'
    $metricsDocs = Get-Content -LiteralPath 'docs/agents/ai-coding-metrics.md' -Raw
    Assert-True ($metricsDocs -match [regex]::Escape('--input artifacts/telemetry/ai-coding/input/observation.json')) 'telemetry input example stays inside the ignored raw namespace'
    Assert-True (-not ($metricsDocs -match [regex]::Escape('--input artifacts/input/observation.json'))) 'telemetry docs do not expose a tracked raw-input path'
    $telemetryFixture = Get-Content -LiteralPath 'scripts/tests/fixtures/ai-coding-telemetry-observation.json' -Raw
    $invalidTelemetry = $telemetryFixture | ConvertFrom-Json -Depth 100
    $invalidTelemetry | Add-Member -NotePropertyName prompt -NotePropertyValue 'forbidden'
    Assert-True (-not (($invalidTelemetry | ConvertTo-Json -Depth 100) | Test-Json -SchemaFile 'scripts/tests/ai-coding-telemetry-observation.schema.json' -ErrorAction SilentlyContinue)) 'telemetry schema rejects prompt-bearing extensions'
    $metricsReportFixture = Get-Content -LiteralPath 'scripts/tests/fixtures/ai-coding-metrics-report.json' -Raw
    $invalidZeroReport = $metricsReportFixture | ConvertFrom-Json -Depth 100
    $invalidZeroMetric = @($invalidZeroReport.metrics | Where-Object id -eq 'first-pass-gate-yield')[0]
    $invalidZeroMetric.status = 'collecting_baseline'
    $invalidZeroMetric.value = 0
    $invalidZeroMetric.sample_size = 1
    Assert-True (-not (($invalidZeroReport | ConvertTo-Json -Depth 100) | Test-Json -SchemaFile 'scripts/tests/ai-coding-metrics-report.schema.json' -ErrorAction SilentlyContinue)) 'zero-observation report schema rejects a fabricated zero-percent yield'
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
    Assert-True ($ci -match '(?s)streaming:.*?Install conversion service test dependencies.*?python -m pip install -r bim-streaming-server/requirements\.txt pytest pytest-asyncio httpx.*?Run host-native conversion service tests') `
        'streaming CI installs the canonical pinned runtime dependencies before tests that import pxr'
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
    Assert-True ($governanceWorkflow -match 'types:\s*\[opened, edited, synchronize, reopened, ready_for_review\]') 'agent-governance reclassifies the exact path set after base retarget edits'
    Assert-True ($governanceWorkflow -match '(?m)^\s{2}scope:\s*$') 'agent-governance workflow has an internal scope classifier job'
    Assert-True ($governanceWorkflow -match 'scripts/lib/verification-plan\.mjs') 'agent-governance scope consumes the shared verification planner'
    Assert-True ($governanceWorkflow -match 'git -c core\.quotepath=false diff --no-renames --name-only -z .* > agent-governance-changed-paths\.bin') 'agent-governance scope makes git diff failure terminal before planning'
    Assert-True ($governanceWorkflow -match '--changed-paths0-file agent-governance-changed-paths\.bin') 'agent-governance scope preserves NUL-delimited changed paths through the shared planner file contract'
    Assert-True (-not ($governanceWorkflow -match '< <\(')) 'agent-governance scope does not hide git diff failures inside process substitution'
    Assert-True ($governanceWorkflow -match '(?m)^\s{2}suite:\s*$') 'agent-governance workflow isolates the expensive suite'
    Assert-True ($governanceWorkflow -match "if: needs\.scope\.result == 'success' && needs\.scope\.outputs\.agent_governance == 'true'") 'agent-governance suite runs only for affected paths after a successful classifier'
    Assert-True ($governanceWorkflow -match '(?ms)^\s{4}needs:\s*\r?\n\s{6}- scope\s*\r?\n\s{6}- suite\s*$') 'required Agent Governance result aggregates classifier and suite outcomes'
    Assert-True ($governanceWorkflow -match '(?m)^\s{4}if: always\(\)\s*$') 'required Agent Governance result always publishes a terminal context'
    Assert-True ($governanceWorkflow -match 'scope classifier did not succeed; refusing a skipped-success required check') 'classifier failure is not converted into skipped success'
    Assert-True ($governanceWorkflow -match 'scope classifier did not publish a closed required/not-required decision') 'missing or malformed classifier output fails closed'
    Assert-True ($governanceWorkflow -match 'publishing explicit no-op success') 'unaffected paths produce an explicit successful terminal result'
    Assert-True ($governanceWorkflow -match '(?m)^\s+timeout-minutes:\s*30\s*$') 'agent-governance workflow has a bounded runtime'
    Assert-True ($governanceWorkflow -match 'scripts/tests/test-agent-governance-check\.ps1') 'agent-governance workflow runs static check'
    Assert-True ($governanceWorkflow -match 'node --test scripts/tests/test-cleanup-orphan-dev-processes\.mjs scripts/tests/test-manage-pr-queue\.mjs scripts/tests/test-pr-queue-adversarial-and-stress\.mjs') 'agent-governance workflow runs isolated orphan cleanup and named PR queue tests'
    Assert-True ($governanceWorkflow -match 'node --test scripts/tests/test-trusted-host-merge\.mjs scripts/tests/test-trusted-host-merge-runtime\.mjs') 'agent-governance runs trusted host executor and broker contract tests'
    Assert-True ($governanceWorkflow -match 'pwsh -NoProfile -NonInteractive -File scripts/tests/test-isolated-branch-stack\.ps1') 'agent-governance workflow runs isolated branch stack machine tests'
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

    # Shard coverage. The suite runs as a fail-fast:false matrix, so each verification step
    # now carries its own `if: matrix.shard == '<x>'`. A typo there (or a new step added
    # without one) is skipped in EVERY leg while the required check still reports success -
    # the one failure mode sharding introduces that no existing assertion can see. Parse the
    # workflow structurally instead of grepping it, and prove the union of the legs is still
    # the whole declared step set.
    Import-Module (Join-Path $repoRoot 'scripts/lib/agent-governance-policy.psm1') -Force
    $governanceWorkflowTree = ConvertFrom-AgentGovernanceYaml -Text $governanceWorkflow -Origin '.github/workflows/agent-governance.yml'
    $suiteJob = $governanceWorkflowTree['jobs']['suite']
    Assert-True ($suiteJob.Contains('strategy') -and $suiteJob['strategy'].Contains('matrix') -and $suiteJob['strategy']['matrix'].Contains('shard')) 'agent-governance suite declares its shard matrix'
    Assert-True (([string]$suiteJob['strategy']['fail-fast']) -ceq 'false') 'one failing shard never cancels the others, so a single red leg cannot hide a second failure'
    $declaredShards = @(@($suiteJob['strategy']['matrix']['shard']) | ForEach-Object { [string]$_ })
    Assert-True ($declaredShards.Count -ge 2) 'the shard matrix declares more than one leg'
    Assert-True (@($declaredShards | Sort-Object -Unique).Count -eq $declaredShards.Count) 'shard names are unique'

    $shardMembershipPattern = [regex]"^matrix\.shard == '(?<shard>[a-z][a-z0-9-]*)'$"
    $suiteRunSteps = [ordered]@{}
    foreach ($suiteStep in @($suiteJob['steps'])) {
        $suiteStepName = [string]$suiteStep['name']
        if ($suiteStep.Contains('run')) {
            Assert-True ($suiteStep.Contains('if')) "suite step '$suiteStepName' declares a shard; a run step without one is skipped in every leg"
            $shardMembership = $shardMembershipPattern.Match([string]$suiteStep['if'])
            Assert-True ($shardMembership.Success) "suite step '$suiteStepName' uses the exact shard membership form matrix.shard == '<shard>'"
            $suiteStepShard = $shardMembership.Groups['shard'].Value
            Assert-True ($declaredShards -ccontains $suiteStepShard) "suite step '$suiteStepName' names a declared shard, not the unreachable '$suiteStepShard'"
            Assert-True (-not $suiteRunSteps.Contains($suiteStepName)) "suite step name '$suiteStepName' is unique, so shard coverage stays countable"
            $suiteRunSteps[$suiteStepName] = $suiteStepShard
        } elseif ($suiteStep.Contains('if')) {
            Assert-True (-not (([string]$suiteStep['if']) -match 'matrix\.shard')) "suite setup step '$suiteStepName' is not bound to one shard; every leg needs it"
        }
    }

    # Ratchet: shards may be rebalanced freely, but the suite may never run fewer steps than
    # the 31 it carried when the matrix landed. Losing a step must be a deliberate edit here.
    Assert-True ($suiteRunSteps.Count -ge 31) "agent-governance suite still runs at least 31 verification steps (found $($suiteRunSteps.Count))"
    $coveredShards = @($suiteRunSteps.Values | Sort-Object -Unique)
    foreach ($declaredShard in $declaredShards) {
        Assert-True ($coveredShards -ccontains $declaredShard) "shard '$declaredShard' actually runs at least one step instead of burning a runner on nothing"
    }
    foreach ($pinnedShardStep in @(
        @{ Name = 'Run governance static check'; Shard = 'core' },
        @{ Name = 'Run orphan cleanup and named PR queue safety tests'; Shard = 'core' },
        @{ Name = 'Run OpenSpec ledger reconciliation tests'; Shard = 'openspec' },
        @{ Name = 'Run OpenSpec machine-truth tests'; Shard = 'openspec' },
        @{ Name = 'Run base-gate capability detection tests'; Shard = 'capability' },
        @{ Name = 'Run self-referential bootstrap ledger tests'; Shard = 'evidence' }
    )) {
        Assert-True ($suiteRunSteps.Contains($pinnedShardStep.Name)) "agent-governance suite still runs '$($pinnedShardStep.Name)'"
        Assert-True (($suiteRunSteps[$pinnedShardStep.Name]) -ceq $pinnedShardStep.Shard) "'$($pinnedShardStep.Name)' stays on the '$($pinnedShardStep.Shard)' shard the wall-clock split assumes"
    }

    $shipWorkflowScript = Get-Content -LiteralPath '.claude/workflows/ship-item.js' -Raw
    $trustedMergeWorkflow = Get-Content -LiteralPath '.github/workflows/trusted-elevated-merge.yml' -Raw
    $trustedMergeExecutor = Get-Content -LiteralPath 'scripts/lib/trusted-host-merge-executor.mjs' -Raw
    $trustedMergeRuntime = Get-Content -LiteralPath 'scripts/lib/trusted-host-merge-runtime.mjs' -Raw
    $trustedMergeCli = Get-Content -LiteralPath 'scripts/dev/trusted-host-merge.mjs' -Raw
    Assert-True ($trustedMergeWorkflow -match '(?m)^\s{2}workflow_dispatch:\s*$') 'trusted merge is dispatch-only from the default branch'
    foreach ($forbiddenTrigger in @('pull_request:', 'pull_request_target:', 'push:', 'schedule:', 'repository_dispatch:')) {
        Assert-True (-not ($trustedMergeWorkflow -match "(?m)^\s{2}$([regex]::Escape($forbiddenTrigger))\s*$")) "trusted merge forbids trigger: $forbiddenTrigger"
    }
    Assert-True (([regex]::Matches($trustedMergeWorkflow, 'actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5')).Count -eq 2) 'trusted merge pins both trusted-base checkouts'
    Assert-True (([regex]::Matches($trustedMergeWorkflow, 'actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020')).Count -eq 2) 'trusted merge pins both Node setup actions'
    Assert-True (([regex]::Matches($trustedMergeWorkflow, "node-version:\s*'20\.20\.2'")).Count -eq 2) 'trusted merge uses one exact Node.js runtime'
    Assert-True (([regex]::Matches($trustedMergeWorkflow, 'runs-on:\s*ubuntu-24\.04')).Count -eq 2) 'trusted merge pins the hosted runner generation'
    Assert-True (([regex]::Matches($trustedMergeWorkflow, 'persist-credentials:\s*false')).Count -eq 2) 'trusted merge never persists checkout credentials'
    Assert-True ($trustedMergeWorkflow -match '(?m)^\s{4}environment:\s*trusted-elevated-merge\s*$') 'irreversible job is protected by the exact broker environment'
    Assert-True (([regex]::Matches($trustedMergeWorkflow, '(?m)^\s{8}timeout-minutes:\s*25\s*$')).Count -eq 2) 'each credential-bearing executor step stops before the 30-minute job deadline and preserves terminal-result time'
    Assert-True ($trustedMergeWorkflow -match 'ref:\s*\$\{\{ github\.sha \}\}') 'trusted executor checkout is pinned to the workflow source SHA'
    Assert-True (-not ($trustedMergeWorkflow -match 'github\.event\.pull_request|refs/pull/')) 'workflow never checks out or executes candidate code'
    foreach ($brokerSecret in @('TRUSTED_MERGE_APP_ID', 'TRUSTED_MERGE_APP_INSTALLATION_ID', 'TRUSTED_MERGE_APP_PRIVATE_KEY')) {
        Assert-True ($trustedMergeWorkflow -match [regex]::Escape("secrets.$brokerSecret")) "trusted merge receives protected broker secret: $brokerSecret"
    }
    Assert-True ($trustedMergeWorkflow -match 'if:\s*\$\{\{ inputs\.apex_provider == ''claude'' \}\}[\s\S]*?secrets\.ANTHROPIC_API_KEY') 'Claude executor step receives only the Anthropic key'
    Assert-True ($trustedMergeWorkflow -match 'if:\s*\$\{\{ inputs\.apex_provider == ''codex'' \}\}[\s\S]*?secrets\.OPENAI_API_KEY') 'Codex executor step receives only the OpenAI key'
    Assert-True (-not ($trustedMergeWorkflow -match '&&\s*secrets\.|\|\|\s*secrets\.')) 'provider secret routing cannot fall through to another provider key'
    Assert-True (([regex]::Matches($trustedMergeWorkflow, 'TRUSTED_MERGE_ACTIVATION_MODE:\s*\$\{\{ vars\.TRUSTED_MERGE_ACTIVATION_MODE \}\}')).Count -eq 3) 'activation preflight and both executor providers receive the protected activation mode'
    Assert-True (([regex]::Matches($trustedMergeWorkflow, 'TRUSTED_MERGE_ATTESTATION_TUPLE_SHA256:\s*\$\{\{ vars\.TRUSTED_MERGE_ATTESTATION_TUPLE_SHA256 \}\}')).Count -eq 3) 'activation preflight and both executor providers receive the exact attestation tuple digest'
    Assert-True ($trustedMergeWorkflow.IndexOf('node scripts/dev/trusted-host-merge.mjs activate') -ge 0 -and $trustedMergeWorkflow.IndexOf('node scripts/dev/trusted-host-merge.mjs activate') -lt $trustedMergeWorkflow.IndexOf('TRUSTED_MERGE_APP_PRIVATE_KEY:')) 'secret-free activation preflight runs before any provider credential step'
    Assert-True ($trustedMergeRuntime -match 'createSign\(' -and $trustedMergeRuntime -match 'repositories:\s*\[repository\.split') 'executor mints a single-repository GitHub App installation token'
    $trustedMergeAppPermissions = (Get-Content -LiteralPath 'agent-contracts/trusted-host-merge.contract.json' -Raw | ConvertFrom-Json -Depth 100).executor.github_app_token.permissions
    $trustedMergeExpectedCapabilities = [ordered]@{
        actions = 'read'
        administration = 'read'
        checks = 'read'
        contents = 'write'
        pull_requests = 'read'
    }
    foreach ($appCapability in $trustedMergeExpectedCapabilities.Keys) {
        Assert-True ($trustedMergeAppPermissions.$appCapability -ceq $trustedMergeExpectedCapabilities[$appCapability]) "trusted App contract declares least-privilege capability: $appCapability=$($trustedMergeExpectedCapabilities[$appCapability])"
    }
    $trustedMergeActualCapabilityNames = @($trustedMergeAppPermissions.PSObject.Properties.Name | Sort-Object)
    Assert-True (($trustedMergeActualCapabilityNames -join ',') -ceq (@($trustedMergeExpectedCapabilities.Keys | Sort-Object) -join ',')) 'trusted App contract declares exactly the expected least-privilege capability set, no more'
    Assert-True ($trustedMergeExecutor -match "body:\s*\{ sha: invocation\.headOid, merge_method: method \}") 'single merge sink is atomically bound to the exact adjudicated head'
    Assert-True ($trustedMergeExecutor -match "spawnSync\('/usr/bin/git'") 'trusted executor invokes the fixed host Git path instead of PATH lookup'
    Assert-True (([regex]::Matches($trustedMergeExecutor, "method:\s*'PUT'")).Count -eq 1) 'executor has exactly one irreversible PUT call site'
    Assert-True ($trustedMergeRuntime -match "tools:\s*\[\]") 'both direct apex APIs receive no tools'
    Assert-True ($trustedMergeCli -match '::add-mask::\$\{minted\.token\}') 'installation token is masked before any downstream operation'
    Assert-True ($trustedMergeCli.IndexOf('verifyActivationGate(activation)') -ge 0 -and $trustedMergeCli.IndexOf('verifyActivationGate(activation)') -lt $trustedMergeCli.IndexOf('mintInstallationToken({')) 'activation gate runs before the credential mint'
    $trustedMergeUses = @([regex]::Matches($trustedMergeWorkflow, '(?m)^\s+uses:\s*(\S+)\s*$') | ForEach-Object { $_.Groups[1].Value })
    $trustedMergeAllowedUses = @(
        'actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5',
        'actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020'
    )
    Assert-True ($trustedMergeUses.Count -eq 4 -and @($trustedMergeUses | Where-Object { $trustedMergeAllowedUses -notcontains $_ }).Count -eq 0) 'trusted workflow uses only the two exact pinned first-party actions'

    $trustedMergeContractRaw = Get-Content -LiteralPath 'agent-contracts/trusted-host-merge.contract.json' -Raw
    $trustedMergeContract = $trustedMergeContractRaw | ConvertFrom-Json -Depth 100
    Assert-True ($trustedMergeContract.executor.toolchain.platform -ceq 'linux') 'trusted merge contract pins the executor platform to linux'
    $trustedMergeContractNodeVersion = [string]$trustedMergeContract.executor.toolchain.node_version
    Assert-True ($trustedMergeContractNodeVersion -cmatch '^v\d+\.\d+\.\d+$') 'trusted merge contract pins an exact semantic Node.js version'
    Assert-True ($trustedMergeCli -match [regex]::Escape('contract.executor.toolchain.platform') -and $trustedMergeCli -match [regex]::Escape('contract.executor.toolchain.node_version')) 'trusted executor reads its toolchain identity from the contract, not a hardcoded literal'
    Assert-True ($trustedMergeWorkflow -match "node-version:\s*'$([regex]::Escape($trustedMergeContractNodeVersion.TrimStart('v')))'") 'workflow setup-node pin matches the contract-declared Node.js version'
    foreach ($schemaPath in @($trustedMergeContract.schemas.PSObject.Properties.Value)) {
        $resolvedSchemaPath = Join-Path 'agent-contracts' ([string]$schemaPath).Replace('./', '')
        Assert-True (Test-Path -LiteralPath $resolvedSchemaPath -PathType Leaf) "trusted merge referenced schema exists: $resolvedSchemaPath"
        $null = Get-Content -LiteralPath $resolvedSchemaPath -Raw | ConvertFrom-Json -Depth 100
    }
    $trustedMergeFixtures = Get-Content -LiteralPath 'scripts/tests/fixtures/trusted-host-merge-machine-fixtures.json' -Raw | ConvertFrom-Json -Depth 100
    $trustedMergeFixtureSchemas = @{
        assertion = 'agent-contracts/trusted-host-merge-assertion.schema.json'
        evidence = 'agent-contracts/trusted-host-merge-evidence.schema.json'
        verdict = 'agent-contracts/trusted-host-merge-verdict.schema.json'
        result = 'agent-contracts/trusted-host-merge-result.schema.json'
    }
    foreach ($fixtureName in @($trustedMergeFixtureSchemas.Keys)) {
        $fixtureJson = $trustedMergeFixtures.$fixtureName | ConvertTo-Json -Depth 100
        Assert-True ($fixtureJson | Test-Json -SchemaFile $trustedMergeFixtureSchemas[$fixtureName] -ErrorAction SilentlyContinue) "trusted merge $fixtureName fixture satisfies its closed schema"
    }
    $unknownMergeResult = [ordered]@{
        schemaVersion = 'trusted-host-merge-result/v1'
        status = 'merge_outcome_unverified'
        merged = $null
        prNumber = 42
        headOid = ('a' * 40 -join '')
        baseOid = ('b' * 40 -join '')
        mergeCommit = $null
        heldReason = 'merge_command_failed_unverified'
        heldDetail = 'merge_state_unreadable'
    } | ConvertTo-Json -Depth 10
    Assert-True ($unknownMergeResult | Test-Json -SchemaFile 'agent-contracts/trusted-host-merge-result.schema.json' -ErrorAction SilentlyContinue) 'trusted merge result schema represents attempted but unverified merge outcome without false bivalence'
    $falseUnknownMergeResult = $unknownMergeResult | ConvertFrom-Json -Depth 10
    $falseUnknownMergeResult.merged = $false
    Assert-True (-not (($falseUnknownMergeResult | ConvertTo-Json -Depth 10) | Test-Json -SchemaFile 'agent-contracts/trusted-host-merge-result.schema.json' -ErrorAction SilentlyContinue)) 'unverified merge outcome cannot be downgraded to merged=false'
    $mutatedAssertion = $trustedMergeFixtures.assertion | ConvertTo-Json -Depth 100 | ConvertFrom-Json -Depth 100
    $mutatedAssertion | Add-Member -NotePropertyName callerAuthorization -NotePropertyValue 'untrusted'
    Assert-True (-not (($mutatedAssertion | ConvertTo-Json -Depth 100) | Test-Json -SchemaFile 'agent-contracts/trusted-host-merge-assertion.schema.json' -ErrorAction SilentlyContinue)) 'broker assertion schema rejects caller-controlled extension fields'
    Assert-True (-not (Test-Path -LiteralPath '.github/workflows/owner-consent.yml')) 'replayable custom owner-consent status workflow is absent'
    Assert-True (-not (Test-Path -LiteralPath '.github/scripts/owner-consent.mjs')) 'replayable custom owner-consent status publisher is absent'
    foreach ($p6FailClosedMarker in @('ARG_KEYS_SAFE', 'USER_FACING_SAFE', 'SHIP_HELD_REASON_VALUES', 'host_env_blocked', 'ship_workflow_shell_unavailable')) {
        Assert-True ($shipWorkflowScript -match [regex]::Escape($p6FailClosedMarker)) "P6 validation-only workflow preserves fail-closed marker: $p6FailClosedMarker"
    }
    Assert-True (-not ($shipWorkflowScript -match [regex]::Escape('$`'))) 'P6 production workflow contains no shell-command template'
    Assert-True (-not ($shipWorkflowScript -match '(?m)\b(?:RAW_AGENT|governedAgent)\b|\bagent\s*\(')) 'P6 production workflow cannot dispatch an agent'
    Assert-True (-not ($shipWorkflowScript -match [regex]::Escape('gh pr merge'))) 'P6 production workflow contains no merge command'
    Assert-True (-not ($shipWorkflowScript -match 'merged\s*:\s*true')) 'P6 production workflow contains no successful merge result path'
    $codeownerLines = @(Get-Content -LiteralPath '.github/CODEOWNERS' | Where-Object { $_.Trim() -and -not $_.Trim().StartsWith('#') })
    foreach ($codeownerLine in $codeownerLines) {
        $codeownerParts = @($codeownerLine.Trim() -split '\s+')
        Assert-True ($codeownerParts.Count -eq 2 -and $codeownerParts[1] -ceq '@monkey1sai-blip') "CODEOWNERS rule has exactly one fixed human owner: $codeownerLine"
    }
    foreach ($workflowFile in @(Get-ChildItem -LiteralPath '.github/workflows' -File)) {
        $permissionViolations = @(Get-WorkflowPermissionViolations -Lines @(Get-Content -LiteralPath $workflowFile.FullName) -WorkflowPath $workflowFile.FullName)
        Assert-True ($permissionViolations.Count -eq 0) "workflow permissions are literal and cannot write comments, reviews, discussions, statuses, or checks: $($workflowFile.Name): $($permissionViolations -join '; ')"
    }
    Assert-True (@(Get-WorkflowPermissionViolations -Lines @('permissions:', '  contents: read')).Count -eq 0) 'the exact root contents-read workflow permission is allowed'
    Assert-True (@(Get-WorkflowPermissionViolations -Lines @('permissions:', '  contents: read', '  pull-requests: read') -WorkflowPath '.github/workflows/governance-trust-root.yml').Count -eq 0) 'base-owned governance trust root may read pull requests alongside contents'
    Assert-True (@(Get-WorkflowPermissionViolations -Lines @('permissions:', '  contents: read', '  pull-requests: read') -WorkflowPath '.github/workflows/ci.yml').Count -gt 0) 'pull-request read is rejected outside the base-owned governance trust root'
    $claudeMentionPermissionLines = @('permissions:', '  contents: read', '  pull-requests: read', '  issues: read', '  id-token: write', '  actions: read')
    Assert-True (@(Get-WorkflowPermissionViolations -Lines $claudeMentionPermissionLines -WorkflowPath '.github/workflows/claude.yml').Count -eq 0) 'the @claude mention workflow may carry the literal read set plus id-token write'
    Assert-True (@(Get-WorkflowPermissionViolations -Lines $claudeMentionPermissionLines -WorkflowPath '.github/workflows/ci.yml').Count -gt 0) 'the claude mention permission set is rejected outside claude.yml'
    Assert-True (@(Get-WorkflowPermissionViolations -Lines @('permissions:', '  contents: read', '  id-token: write') -WorkflowPath '.github/workflows/claude-code-review.yml').Count -gt 0) 'id-token write is rejected for other claude-prefixed workflow names'
    Assert-True (@(Get-WorkflowPermissionViolations -Lines @('permissions:', '  contents: read', '  pull-requests: write') -WorkflowPath '.github/workflows/claude.yml').Count -gt 0) 'claude.yml cannot escalate to pull-request write'
    Assert-True (@(Get-WorkflowPermissionViolations -Lines @('permissions:', '  contents: write', '  id-token: write') -WorkflowPath '.github/workflows/claude.yml').Count -gt 0) 'claude.yml cannot escalate to contents write'
    Assert-True (@(Get-WorkflowPermissionViolations -Lines @('permissions:', '  contents: read', '   id-token: write') -WorkflowPath '.github/workflows/claude.yml').Count -gt 0) 'claude.yml entries must keep the exact two-space literal indent'
    Assert-True (@(Get-WorkflowPermissionViolations -Lines @('permissions:', '  pull-requests: read')).Count -gt 0) 'pull-request read without contents read is rejected'
    Assert-True (@(Get-WorkflowPermissionViolations -Lines @('permissions:', '  contents: read', '  pull-requests: write')).Count -gt 0) 'pull-request write is rejected'
    Assert-True (@(Get-WorkflowPermissionViolations -Lines @('permissions:', '  contents: read', '# permissions tokens are forbidden outside the root key')).Count -gt 0) 'extra permissions tokens in comments are rejected by the strict dependency-free grammar'
    Assert-True (@(Get-WorkflowPermissionViolations -Lines @('permissions:', '  "pull-requests": write')).Count -gt 0) 'quoted pull-request write permission is rejected'
    Assert-True (@(Get-WorkflowPermissionViolations -Lines @('permissions:', '  issues: *writer')).Count -gt 0) 'aliased issue permission is rejected fail closed'
    Assert-True (@(Get-WorkflowPermissionViolations -Lines @('permissions: { checks: write }')).Count -gt 0) 'inline check-write permission map is rejected fail closed'
    Assert-True (@(Get-WorkflowPermissionViolations -Lines @('permissions:', '  discussions: write')).Count -gt 0) 'discussion write permission is rejected'
    Assert-True (@(Get-WorkflowPermissionViolations -Lines @('name: missing-permissions', 'on: push')).Count -gt 0) 'missing workflow permission block is rejected fail closed'
    Assert-True (@(Get-WorkflowPermissionViolations -Lines @('permissions:', '  contents: read', 'jobs: { evil: { runs-on: ubuntu-latest, permissions: { pull-requests: write }, steps: [] } }')).Count -gt 0) 'flow-style job permission override is rejected fail closed'
    Assert-True (@(Get-WorkflowPermissionViolations -Lines @('permissions:', '  contents: read', 'x-job: &danger { permissions: { checks: write } }', 'jobs:', '  evil: *danger')).Count -gt 0) 'anchored flow-style permission override is rejected fail closed'
    Assert-True (@(Get-WorkflowPermissionViolations -Lines @('permissions:', '  contents: read', 'jobs:', '  evil:', '    "permis\x73ions":', '      pull-requests: write')).Count -gt 0) 'hex-escaped job permission key is rejected fail closed'
    Assert-True (@(Get-WorkflowPermissionViolations -Lines @('permissions:', '  contents: read', 'x: &1 "permis\', '  sions"', 'jobs:', '  evil:', '    runs-on: ubuntu-latest', '    *1:', '      pull-requests: write', '    steps: []')).Count -gt 0) 'numeric anchor and aliased multiline permission key are rejected fail closed'

    $prReviewWorkflow = Get-Content -LiteralPath '.github/workflows/pr-review-agent.yml' -Raw
    Assert-True ($prReviewWorkflow -match '(?m)^name:\s*PR Metadata Contract\s*$') 'PR metadata diagnostic has a truthful workflow name'
    Assert-True ($prReviewWorkflow -match '(?m)^\s{4}name:\s*pr-metadata-contract-diagnostic\s*$') 'PR metadata job cannot be mistaken for the merge-authority context'
    Assert-True ($prReviewWorkflow -match '(?m)^\s{2}pull_request_target:\s*$') 'PR metadata diagnostic is loaded from the protected base branch'
    Assert-True (-not ($prReviewWorkflow -match '(?m)^\s{2}pull_request:\s*$')) 'PR metadata diagnostic never uses the PR-head workflow definition'
    Assert-True ($prReviewWorkflow -match 'ref:\s*\$\{\{ github\.event\.pull_request\.base\.sha \}\}') 'PR metadata diagnostic checks out only the immutable base SHA'
    Assert-True ($prReviewWorkflow -match [regex]::Escape('git fetch --no-tags origin "refs/pull/$PR_NUMBER/head"')) 'PR metadata diagnostic explicitly fetches the base-repository pull ref for fork-compatible exact-head data'
    Assert-True (-not ($prReviewWorkflow -match 'git fetch[^\r\n]*--depth=1[^\r\n]*refs/pull/')) 'PR metadata diagnostic does not shallow-boundary the candidate before its three-dot merge-base diff'
    Assert-True ($prReviewWorkflow -match [regex]::Escape('if [ "$fetched_head" != "$HEAD_SHA" ]; then')) 'PR metadata diagnostic verifies the fetched pull ref is the event exact head'
    Assert-True (-not ($prReviewWorkflow -match 'ref:\s*\$\{\{ github\.event\.pull_request\.head\.sha \}\}')) 'PR metadata diagnostic never checks out the PR head'
    Assert-True ($prReviewWorkflow -notmatch 'head-bootstrap|GATE_ROOT=\$GITHUB_WORKSPACE') 'base-incomplete bootstrap cannot execute or trust a head checker'
    Assert-True ($prReviewWorkflow -match 'base_gate_incomplete_external_approval_required') 'base-incomplete bootstrap fails closed pending external approval'
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
    $singleOwnerProtectionMatch = [regex]::Match(
        $reviewDoc,
        '(?s)Remote-only step：.*?(?=\r?\n## 人工審查邊界)'
    )
    Assert-True $singleOwnerProtectionMatch.Success 'PR review doc has a bounded single-owner branch-protection section'
    $singleOwnerProtectionSection = $singleOwnerProtectionMatch.Value
    $postMergeMarker = '#458 merge 後'
    $postMergeMarkerIndex = $singleOwnerProtectionSection.IndexOf($postMergeMarker, [System.StringComparison]::Ordinal)
    Assert-True ($postMergeMarkerIndex -ge 0) 'PR review doc has the #458 post-merge transition marker'
    Assert-True (
        $postMergeMarkerIndex -eq $singleOwnerProtectionSection.LastIndexOf($postMergeMarker, [System.StringComparison]::Ordinal)
    ) 'PR review doc has exactly one #458 post-merge transition marker'
    $bootstrapProtectionSection = $singleOwnerProtectionSection.Substring(0, $postMergeMarkerIndex)
    $postMergeProtectionSection = $singleOwnerProtectionSection.Substring($postMergeMarkerIndex)
    Assert-True ($bootstrapProtectionSection -match 'PR #458') 'PR review doc identifies the #458 bootstrap'
    Assert-True ($bootstrapProtectionSection -match '\brequired_approving_review_count\s*=\s*1\b') 'PR review doc binds the #458 bootstrap to approvals=1'
    Assert-True ($bootstrapProtectionSection -match '\brequire_code_owner_reviews\s*=\s*false\b') 'PR review doc binds the #458 bootstrap to code-owner review=false'
    Assert-True (-not ($bootstrapProtectionSection -match '\brequire_code_owner_reviews\s*=\s*true\b')) 'PR review doc does not mix the post-merge code-owner target into the #458 bootstrap'
    Assert-True ($postMergeProtectionSection -match '\brequired_approving_review_count\s*=\s*1\b') 'PR review doc binds the post-merge target to approvals=1'
    Assert-True ($postMergeProtectionSection -match '\brequire_code_owner_reviews\s*=\s*true\b') 'PR review doc binds the post-merge target to code-owner review=true'
    Assert-True (-not ($postMergeProtectionSection -match '\brequire_code_owner_reviews\s*=\s*false\b')) 'PR review doc does not mix the bootstrap exception into the post-merge target'
    foreach ($evidenceMarker in @('不是 live state 證明', '重讀 API')) {
        Assert-True ($singleOwnerProtectionSection -match [regex]::Escape($evidenceMarker)) "PR review doc keeps live-state evidence warning: $evidenceMarker"
    }
    Assert-True (-not ($reviewDoc -match '(?i)\brequired_approving_review_count\s*=\s*0\b')) 'PR review doc never restores a canonical zero-approval setting'
    Assert-True (-not ($reviewDoc -match '(?i)\bapprovals?\s*=\s*0\b')) 'PR review doc never restores a zero-approval shorthand'

    # Machine gates for openspec/specs/agent-doc-context-budget/spec.md:
    # line budgets, sub-file index completeness, dead-link liveness, mirror declaration, mirror pairing.
    $agentsBody = Get-Content -LiteralPath 'AGENTS.md' -Raw
    $claudeBody = Get-Content -LiteralPath 'CLAUDE.md' -Raw
    $githubWorkflowBody = Get-Content -LiteralPath 'docs/agents/github-workflow.md' -Raw
    foreach ($authRoutingMarker in @(
        'gh api user --jq .login',
        'GH_TOKEN',
        'x509',
        'sandbox 外',
        'HTTP `401 Bad credentials`',
        'GIT_SSL_NO_VERIFY=1',
        'HELD: TLS trust unresolved'
    )) {
        Assert-True ($githubWorkflowBody -match [regex]::Escape($authRoutingMarker)) "GitHub workflow preserves gh auth routing marker: $authRoutingMarker"
    }
    $agentsBodyLf = $agentsBody.Replace("`r`n", "`n")
    foreach ($entrypointVariant in @($agentsBodyLf, $agentsBodyLf.Replace("`n", "`r`n"))) {
        Assert-True ($entrypointVariant -match '(?m)^\|[^\r\n]*gh[^\r\n]*docs/agents/github-workflow\.md[^\r\n]*\r?$') 'AGENTS.md routes gh auth work to the GitHub workflow runbook under LF and CRLF'
    }
    Assert-True ($claudeBody -match '(?m)^@AGENTS\.md\s*$') 'CLAUDE.md imports the AGENTS.md source of truth'
    Assert-True (-not ($claudeBody -match '<!-- gitnexus:start -->|<!-- gitnexus:end -->')) 'CLAUDE.md has no duplicated GitNexus generated block'
    $agentsGeneratedMatch = [regex]::Match($agentsBody, '(?s)<!-- gitnexus:start -->.*?<!-- gitnexus:end -->')
    Assert-True $agentsGeneratedMatch.Success 'AGENTS.md owns the GitNexus generated block'
    Assert-True (($agentsGeneratedMatch.Value -split "`r?`n").Count -gt 1) 'AGENTS.md GitNexus generated block remains multiline'
    $agentsLineCount = @(Get-Content -LiteralPath 'AGENTS.md').Count
    $claudeLineCount = @(Get-Content -LiteralPath 'CLAUDE.md').Count
    foreach ($budget in @(
        @{ Path = 'AGENTS.md'; Min = 150; Max = 200 },
        @{ Path = 'CLAUDE.md'; Min = 1; Max = 30 },
        @{ Path = 'docs/agents/advanced-agent-reasoning-contract.md'; Min = 40; Max = 70 },
        @{ Path = 'docs/agents/codex-loop-workflows.md'; Min = 50; Max = 90 }
    )) {
        $count = @(Get-Content -LiteralPath $budget.Path).Count
        Assert-True ($count -ge $budget.Min -and $count -le $budget.Max) "$($budget.Path) line budget actual=$count"
    }
    Assert-True ($agentsLineCount -le 250) "AGENTS.md within 250-line budget (actual: $agentsLineCount); split into docs/agents/*.md or amend agent-doc-context-budget spec"
    Assert-True ($claudeLineCount -le 130) "CLAUDE.md within 130-line budget (actual: $claudeLineCount); split into docs/agents/*.md or amend agent-doc-context-budget spec"

    Assert-True ($claudeBody -match '(?m)^@AGENTS\.md\s*$') 'CLAUDE.md imports AGENTS.md'
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
        Assert-FileContains $overlayPath 'task-routing\.md' "$overlayPath points to the global runtime task-routing policy"
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
    Assert-True (-not ($claudeBody -match 'docs/agents/')) 'CLAUDE.md does not duplicate the AGENTS.md sub-file index'

    $codexSpecToDone = Get-Content -LiteralPath '.codex/skills/spec-to-done/SKILL.md' -Raw -Encoding UTF8
    $claudeSpecToDone = Get-Content -LiteralPath '.claude/skills/spec-to-done/SKILL.md' -Raw -Encoding UTF8
    Assert-True (-not ($codexSpecToDone -match '(?i)[A-Z]:\\Users\\[^\\]+\\\.codex\\')) 'Codex spec-to-done stores no machine-specific user-home Codex path'
    $specToDoneContractPath = 'agent-contracts/spec-to-done.contract.json'
    $specToDoneContract = Get-Content -LiteralPath $specToDoneContractPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $expectedSpecToDonePhases = @('P0', 'P1', 'P3', 'P4', 'P5', 'P6', 'P7')
    $contractPhases = @($specToDoneContract.phases)
    $contractHeldReasons = @($specToDoneContract.durable_state.held_reasons)
    Assert-True ($specToDoneContract.schema_version -ceq 'spec-to-done-contract/v2') 'spec-to-done machine contract has the pinned schema version'
    Assert-True (($contractPhases -join ',') -ceq ($expectedSpecToDonePhases -join ',')) 'spec-to-done machine contract preserves the P0/P1/P3-P7 phase sequence'
    Assert-True ($specToDoneContract.durable_state.canonical_relative_path -ceq 'artifacts/spec-to-done/{slug}-state.md') 'spec-to-done machine contract owns the canonical durable state path'
    Assert-True ($specToDoneContract.durable_state.fabric_managed_relative_path -ceq 'artifacts/spec-to-done/{slug}--{binding_id}-state.md') 'spec-to-done machine contract owns a binding-derived managed state path'
    Assert-True ($specToDoneContract.durable_state.fabric_binding_relative_path -ceq 'artifacts/spec-to-done/bindings/{binding_id}.json') 'spec-to-done machine contract owns the canonical Fabric binding path'
    Assert-True ($contractHeldReasons.Count -gt 0 -and @($contractHeldReasons | Sort-Object -Unique).Count -eq $contractHeldReasons.Count) 'spec-to-done machine contract held reasons form a nonempty closed set'
    Assert-True (@($contractHeldReasons | Where-Object { $_ -cnotmatch '^[a-z][a-z0-9_]*$' }).Count -eq 0) 'spec-to-done machine contract held reasons use canonical tokens'
    foreach ($requiredHeldReason in @('host_env_blocked', 'evidence_stale', 'fabric_resume_authority_unavailable', 'resume_state_invalid', 'review_unverified', 'ship_blocked')) {
        Assert-True ($contractHeldReasons -contains $requiredHeldReason) "spec-to-done machine contract includes durable reason $requiredHeldReason"
    }
    Assert-True ($specToDoneContract.parallel_delivery_binding.session_admission_limit -ceq 'unbounded') 'spec-to-done Fabric binding does not impose a repo writer cap'
    Assert-True ($specToDoneContract.parallel_delivery_binding.run_writer_cardinality -eq 1) 'spec-to-done Fabric binding keeps one writer per delivery slice'
    Assert-True (-not $specToDoneContract.parallel_delivery_binding.local_new_run_allowed -and -not $specToDoneContract.parallel_delivery_binding.local_resume_allowed) 'spec-to-done Fabric recovery remains fail closed without outer authority'
    Assert-True ($specToDoneContract.parallel_delivery_binding.delivery_authority -ceq 'non_authorizing') 'spec-to-done Fabric binding cannot grant delivery authority'
    Assert-True ($specToDoneContract.ship.workflow_shell_capability -ceq 'not_available_in_measured_runtime') 'spec-to-done machine contract records measured Workflow shell absence'
    Assert-True ($specToDoneContract.ship.trusted_host_executor -ceq 'implemented_external_workflow') 'spec-to-done machine contract points to the external trusted host executor'
    Assert-True ($specToDoneContract.ship.trusted_host_contract -ceq './trusted-host-merge.contract.json') 'spec-to-done machine contract links the trusted merge protocol'
    Assert-True ($specToDoneContract.ship.trusted_host_workflow -ceq '.github/workflows/trusted-elevated-merge.yml') 'spec-to-done machine contract links the default-branch executor workflow'
    Assert-True ($specToDoneContract.ship.dispatch_protocol -ceq 'github-workflow-dispatch') 'spec-to-done machine contract declares the host handoff protocol'
    Assert-True ($specToDoneContract.ship.activation_state -ceq 'requires_live_attestation') 'machine truth remains held until the ordered live attestation closes'
    $trustedMergeCheckSourceSignature = (@($trustedMergeContract.executor.required_check_sources) | ForEach-Object {
        "$($_.context):$($_.app_id):$($_.verification_target):$($_.workflow_path)"
    }) -join '|'
    $expectedTrustedMergeCheckSourceSignature = @(
        'agent-governance:15368:agent-governance:.github/workflows/agent-governance.yml',
        'root contracts and fakes:15368:root-contracts:.github/workflows/ci.yml',
        'coordinator build and tests:15368:coordinator:.github/workflows/ci.yml',
        'governance-service tests:15368:governance:.github/workflows/ci.yml',
        'viewer build and tests:15368:viewer:.github/workflows/ci.yml',
        'kit-manager-api tests:15368:kit-manager-api:.github/workflows/ci.yml',
        'kit-manager-web build:15368:kit-manager-web:.github/workflows/ci.yml',
        'docker compose config:15368:compose-config:.github/workflows/ci.yml',
        'powershell static analysis:15368:powershell-static:.github/workflows/ci.yml',
        'secret pattern scan:15368:secret-pattern-scan:.github/workflows/ci.yml'
    ) -join '|'
    Assert-True ($trustedMergeCheckSourceSignature -ceq $expectedTrustedMergeCheckSourceSignature) 'trusted merge contract pins every live required check to exact App, trusted verification target, and workflow path'
    $trustedMergeTargetSources = @($trustedMergeContract.executor.verification_target_sources)
    $verificationManifestTargets = @($verificationManifest.targets)
    Assert-True ($trustedMergeTargetSources.Count -eq $verificationManifestTargets.Count) 'trusted merge target-source registry covers every base-owned manifest target'
    foreach ($verificationTarget in $verificationManifestTargets) {
        $matchingSources = @($trustedMergeTargetSources | Where-Object { $_.verification_target -ceq $verificationTarget.id })
        Assert-True ($matchingSources.Count -eq 1) "trusted merge target-source registry has exactly one source for $($verificationTarget.id)"
        Assert-True ($matchingSources[0].context -ceq $verificationTarget.ci_job) "trusted merge target-source context matches manifest ci_job for $($verificationTarget.id)"
        $expectedWorkflowPath = if ($verificationTarget.id -ceq 'agent-governance') {
            '.github/workflows/agent-governance.yml'
        } else {
            '.github/workflows/ci.yml'
        }
        Assert-True ($matchingSources[0].app_id -eq 15368 -and $matchingSources[0].workflow_path -ceq $expectedWorkflowPath) "trusted merge target source pins the Actions App and workflow for $($verificationTarget.id)"
    }
    $trustedMergeMechanismPolicy = $trustedMergeContract.executor.required_check_trust_boundary
    Assert-True ($trustedMergeMechanismPolicy.candidate_mechanism_change -ceq 'separate_authorization') 'candidate verification-mechanism changes require separate authorization'
    Assert-True ($trustedMergeMechanismPolicy.base_owned_manifest_path -ceq 'scripts/verification-manifest.json') 'trusted merge computes plans from the base-owned manifest'
    foreach ($mechanismProbe in @('.github/workflows/ci.yml', 'scripts/tests/test-agent-governance-check.ps1', 'bim-review-coordinator/package.json', 'pytest.py', '.gitattributes', 'web-viewer-sample/.gitattributes')) {
        $matches = @($trustedMergeMechanismPolicy.mechanism_path_patterns | Where-Object {
            [regex]::IsMatch($mechanismProbe, [string]$_, [System.Text.RegularExpressions.RegexOptions]::CultureInvariant)
        })
        Assert-True ($matches.Count -gt 0) "trusted merge mechanism policy blocks candidate-owned gate dependency: $mechanismProbe"
    }
    Assert-True ($specToDoneContract.ship.unavailable_reason -ceq 'trusted_elevated_authorization_unavailable') 'spec-to-done machine contract maps pending attestation to a durable authorization hold'
    Assert-True ($specToDoneContract.terminal_evidence.owner_phase -ceq 'P7') 'spec-to-done machine contract owns terminal evidence at P7'
    Assert-True ($specToDoneContract.terminal_evidence.trusted_remote_url -ceq 'https://github.com/monkey1sai/AI-BIM-governance.git') 'P7 pins the trusted HTTPS remote'
    Assert-True ($specToDoneContract.terminal_evidence.remote_main_ref -ceq 'refs/heads/main') 'P7 pins the remote main ref instead of a local tracking ref'
    foreach ($terminalRequirement in @('live_remote_resolution', 'pr_head_ancestor_of_merge_commit', 'merge_commit_equals_remote_main', 'pr_head_and_merge_commit_same_tree')) {
        Assert-True ($specToDoneContract.terminal_evidence.$terminalRequirement -ceq 'required') "P7 machine contract requires $terminalRequirement"
    }
    foreach ($skillBody in @($claudeSpecToDone, $codexSpecToDone)) {
        foreach ($machineMarker in @(
            'agent-contracts/spec-to-done.contract.json',
            'artifacts/spec-to-done/{slug}-state.md',
            'P0,P1,P3,P4,P5,P6,P7',
            'closed enum',
            '--trusted-main-ref refs/heads/main',
            'git ls-remote',
            'local tracking ref',
            'ship_workflow_shell_unavailable',
            'base-pinned trusted host executor',
            'git merge-base --is-ancestor <prHead> <mergeCommit>',
            'git diff --quiet <prHead> <mergeCommit> --'
        )) {
            Assert-True ($skillBody -match [regex]::Escape($machineMarker)) "spec-to-done skill preserves machine/runtime marker: $machineMarker"
        }
    }
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
    # 單一正本政策（pr-review-agent generated_tooling_path）：.codex 鏡像不得放 validate-state 副本，
    # SKILL.md 以路徑引用 .claude 正本。
    Assert-True (-not (Test-Path -LiteralPath '.codex/skills/spec-to-done/validate-state.mjs')) 'Codex mirror must not carry a validate-state copy (single canonical in .claude)'
    Assert-True ($codexSpecToDone -match [regex]::Escape('.claude/skills/spec-to-done/validate-state.mjs')) 'Codex spec-to-done references the canonical .claude validate-state path'
    foreach ($machineValidatorMarker in @(
        '../../../agent-contracts/spec-to-done.contract.json',
        'loadMachineContract()',
        'ALLOWED_PHASES = new Set(phases)',
        'ALLOWED_HELD_REASONS = new Set(reasons)',
        'artifacts/spec-to-done/{slug}-state.md',
        'trusted-main-ref',
        'merge-base',
        '--is-ancestor'
    )) {
        Assert-True ($claudeStateValidator -match [regex]::Escape($machineValidatorMarker)) "state validator consumes machine/P7 contract marker: $machineValidatorMarker"
    }
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
    foreach ($p5IntegrityMarker in @('targetSha', 'empty_review_range', 'repoRelativePath', 'suspect_file_not_tracked_at_subject_sha', '禁止 Read mutable worktree path', 'evidence_not_bound_to_supplied_content', 'maxItems: MAX_FINDINGS')) {
        Assert-True ($fuAdversarial -match [regex]::Escape($p5IntegrityMarker)) "P5 preserves immutable evidence integrity marker: $p5IntegrityMarker"
    }
    foreach ($p5MachineMarker in @('coordinator-attested', 'acceptanceDigest', 'acceptanceSummary', 'REQUIREMENT_REF_KEYS', 'review_unverified', 'reviewer_agent_failed')) {
        Assert-True ($fuAdversarial -match [regex]::Escape($p5MachineMarker)) "P5 preserves bounded attestation/held marker: $p5MachineMarker"
    }
    foreach ($skillBody in @($claudeSpecToDone, $codexSpecToDone)) {
        foreach ($p5SkillMarker in @(
            "git.attestation   = 'coordinator-attested'",
            '{path,commitSha,blobOid,sha256}',
            '不得宣稱 machine-bound',
            "P5.held==='review_unverified'",
            'null/agent infra'
        )) {
            Assert-True ($skillBody -match [regex]::Escape($p5SkillMarker)) "spec-to-done skill preserves P5 machine semantics: $p5SkillMarker"
        }
    }
    Assert-True ($codexSpecToDone -match [regex]::Escape('targetSha')) 'Codex spec-to-done passes the immutable P5 target SHA'
    Assert-True ($claudeSpecToDone -match [regex]::Escape('targetSha')) 'Claude spec-to-done passes the immutable P5 target SHA'
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
        Assert-True ($testDeployContract -match 'canonical[- ]linux|canonical Linux') "$testDeployContractPath identifies the canonical Linux target"
        Assert-True ($testDeployContract -match [regex]::Escape('AI_BIM_DEPLOY_TARGET_INVENTORY')) "$testDeployContractPath routes private topology through the repo-external inventory seam"
        Assert-True ($testDeployContract -match [regex]::Escape('local-windows')) "$testDeployContractPath keeps Windows as an explicit on-demand target"
        Assert-True ($testDeployContract -match 'helper 無法證明 ownership 時必須 HELD') "$testDeployContractPath keeps unproven ownership non-destructive"
    }
    foreach ($shipSafetyMarker in @('review_required', 'cyber_safeguard_payload', 'git merge-base', 'git rebase origin/main', 'published PR branch', 'git merge --no-edit origin/main', 'seg/seg/id', 'passwd')) {
        Assert-True ($codexSpecToDone -match [regex]::Escape($shipSafetyMarker)) "Codex spec-to-done preserves ship safety marker: $shipSafetyMarker"
        Assert-True ($claudeSpecToDone -match [regex]::Escape($shipSafetyMarker)) "Claude spec-to-done preserves ship safety marker: $shipSafetyMarker"
    }

    $shipItemMarkdown = Get-Content -LiteralPath '.claude/workflows/ship-item.md' -Raw -Encoding UTF8
    $shipItemPrompt = Get-Content -LiteralPath '.claude/workflows/ship-item.js' -Raw -Encoding UTF8
    foreach ($runtimeTruthMarker in @(
        "typeof `$ === 'undefined'",
        'ship_workflow_shell_unavailable',
        '不 dispatch apex',
        'base-pinned trusted host executor',
        'synthetic',
        'production script 已移除 legacy coordinator',
        'pull-requests: read'
    )) {
        Assert-True ($shipItemMarkdown -match [regex]::Escape($runtimeTruthMarker)) "ship-item procedure preserves current runtime truth: $runtimeTruthMarker"
    }
    foreach ($shipSafetyMarker in @('review_required', 'cyber_safeguard_payload', 'git fetch origin', 'git merge-base', 'git rebase origin/main', 'published PR branch', 'git merge --no-edit origin/main', 'seg/seg/id', 'passwd')) {
        Assert-True ($shipItemMarkdown -match [regex]::Escape($shipSafetyMarker)) "future trusted-host procedure preserves safety marker: $shipSafetyMarker"
    }
    Assert-True ($shipItemMarkdown -match 'MUST NOT[^\r\n]*gh pr merge --admin') 'future trusted host forbids the admin merge override'
    Assert-True (($shipItemMarkdown -match 'apex') -and ($shipItemMarkdown -match 'arbiter|裁決')) 'future trusted-host procedure requires an independent apex verdict'
    Assert-True ($shipItemMarkdown -match 'headOid') 'future trusted-host verdict binds to an exact PR head'
    Assert-True ($shipItemMarkdown -match [regex]::Escape('--merge --match-head-commit')) 'future trusted-host procedure preserves snapshot ancestry with merge commits'
    Assert-True (-not ($shipItemMarkdown -match [regex]::Escape('--squash --match-head-commit'))) 'future trusted-host procedure does not squash away snapshot commits'
    Assert-True ($shipItemPrompt -match [regex]::Escape("return held('host_env_blocked', INPUT_PR_NUMBER, 'ship_workflow_shell_unavailable')")) 'production P6 always returns the canonical host hold after validation'
    Assert-True (-not ($shipItemPrompt -match [regex]::Escape('$`')) -and -not ($shipItemPrompt -match [regex]::Escape('gh pr merge')) -and -not ($shipItemPrompt -match 'merged\s*:\s*true')) 'production P6 has no shell or merge sink'

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
    # AGENTS.md owns the GitNexus generated block; CLAUDE.md imports it and must
    # not carry a second generated copy that can drift.
    $gitNexusMetadata = '17817 symbols, 28581 relationships, 300 execution flows'
    Assert-True ($agentsBody -match '<!-- gitnexus:start -->') 'AGENTS.md has GitNexus start marker'
    Assert-True ($agentsBody -match '<!-- gitnexus:end -->') 'AGENTS.md has GitNexus end marker'
    $agentsBlockMatch = [regex]::Match($agentsBody, '(?s)<!-- gitnexus:start -->.*?<!-- gitnexus:end -->')
    Assert-True ($agentsBlockMatch.Value -match [regex]::Escape($gitNexusMetadata)) 'AGENTS.md has current GitNexus metadata'
    Assert-True (-not ($claudeBody -match '<!-- gitnexus:start -->|<!-- gitnexus:end -->')) 'CLAUDE.md has no GitNexus generated markers'
    $agentsGitNexusBlock = [regex]::Match($agentsBody, '(?s)<!-- gitnexus:start -->.*?<!-- gitnexus:end -->').Value
    $metadataPattern = '17817 symbols, 28581 relationships, 300 execution flows'
    Assert-True ($agentsGitNexusBlock -match $metadataPattern) 'AGENTS.md GitNexus block carries current metadata'

    # No orphan sub-files: every tracked docs/agents/*.md must appear in the
    # canonical AGENTS.md index; CLAUDE.md imports that index wholesale.
    $subFiles = @(git ls-files 'docs/agents/*.md')
    Assert-True ($subFiles.Count -ge 5) 'docs/agents sub-file inventory resolved via git ls-files'
    foreach ($subFile in $subFiles) {
        Assert-True ($agentsBody -match [regex]::Escape($subFile)) "AGENTS.md index covers $subFile (no orphan sub-files)"
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
    Assert-True ($LASTEXITCODE -eq 0) 'governed dispatch and validation-only fail-closed ship-item runtime tests pass'

    & pwsh -NoProfile -NonInteractive -File (Join-Path $PSScriptRoot 'test-seed-isolated-stack-ifc-ready.ps1')
    Assert-True ($LASTEXITCODE -eq 0) 'isolated seed wrapper script-level tests pass'

    # Repository-scoped OpenSpec lifecycle parity. scripts/lib/openspec-machine-truth.mjs
    # owns the full comparator, but its CLI needs a GitHub observation and a pinned openspec
    # binary, so CI could only ever exercise it against synthetic temporary fixtures. Nothing
    # pointed a comparator at the tree it governs, so drift between openspec/changes, the
    # machine ledger and the NOW projection was corrected by hand after landing instead of
    # being refused at PR time. These two commands close that hole without network or git.
    & node --test (Join-Path $PSScriptRoot 'test-openspec-repository-lifecycle.mjs')
    Assert-True ($LASTEXITCODE -eq 0) 'repository-scoped OpenSpec lifecycle parity fixtures pass'

    $repositoryLifecycleReport = @(& node (Join-Path $PSScriptRoot 'verify-openspec-repository-lifecycle.mjs') --repo-root $repoRoot)
    Assert-True ($LASTEXITCODE -eq 0) 'openspec/changes, openspec/lifecycle-ledger.json and the docs/plans/NOW.md projection agree'
    # Exit 0 alone is not proof the gate ran: assert it actually produced its report.
    Assert-True ((($repositoryLifecycleReport -join "`n")) -match 'openspec repository lifecycle OK') 'repository-scoped lifecycle gate emitted its parity report'
} finally {
    Pop-Location
}

Write-Host '[test-agent-governance-check] all assertions passed'
