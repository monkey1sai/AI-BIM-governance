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
        'scripts/tests/fixtures/agent-governance-routing.json',
        '.codex/skills/ai-bim-fast-fix/SKILL.md',
        '.codex/skills/ai-bim-bounded-change/SKILL.md',
        '.codex/skills/spec-to-done/agents/openai.yaml',
        'docs/agents/superpowers-invocation-policy.md',
        'docs/PR_REVIEW_AGENT.md',
        'docs/superpowers/plans/2026-06-18-ai-coding-maturity-governance.md'
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
    foreach ($ownedPath in @('/AGENTS.md', '/docs/agents/', '/docs/plans/', '/.github/', '/scripts/')) {
        Assert-FileContains '.github/CODEOWNERS' ([regex]::Escape($ownedPath)) "CODEOWNERS covers $ownedPath"
    }

    $ci = Get-Content -LiteralPath '.github/workflows/ci.yml' -Raw
    foreach ($job in @('changes', 'root-contracts', 'coordinator', 'governance-service', 'viewer', 'kit-manager-api', 'kit-manager-web', 'compose-config', 'powershell-static', 'secret-pattern-scan')) {
        Assert-True ($ci -match "(?m)^\s{2}$([regex]::Escape($job)):\s*$") "ci.yml contains job $job"
    }
    Assert-True ($ci -match 'changed path classifier') 'ci.yml contains changed path classifier'
    foreach ($output in @('root_contracts', 'coordinator', 'governance_service', 'viewer', 'kit_manager_api', 'kit_manager_web', 'compose_config', 'powershell_static', 'secret_pattern_scan')) {
        $expectedOutput = $output + ': ${{ steps.paths.outputs.' + $output + ' }}'
        Assert-True ($ci -match [regex]::Escape($expectedOutput)) "changes job exposes $output output"
    }
    foreach ($gate in @('root_contracts', 'coordinator', 'governance_service', 'viewer', 'kit_manager_api', 'kit_manager_web', 'compose_config', 'powershell_static', 'secret_pattern_scan')) {
        Assert-True ($ci -match [regex]::Escape("needs.changes.outputs.$gate == 'true'")) "ci.yml gates affected job on $gate"
    }
    Assert-True ($ci -match 'if \[ "\$\{\{ github\.event_name \}\}" = "pull_request" \]') 'changed path classifier diffs PR base/head on pull_request'
    Assert-True ($ci -match 'printf "__full__\\n" > changed-paths\.txt') 'changed path classifier runs full service CI on push/workflow_dispatch'
    foreach ($command in @(
        'python -m pytest tests -q -p no:cacheprovider',
        'python -m pytest governance-service/tests -q',
        'usd-core',
        'web-viewer-sample',
        'npm install --no-audit --no-fund',
        'npm run verify',
        'python -m pytest services/kit-manager-api/tests -q',
        'npm run test:session-first',
        'docker compose -f compose.runtime-manager.yml -f compose.host-kit.yml --env-file .env.web-plane.host-kit.example config --quiet',
        'Invoke-ScriptAnalyzer',
        'git grep -nE'
    )) {
        Assert-True ($ci -match [regex]::Escape($command)) "ci.yml contains command $command"
    }
    Assert-True (-not ($ci -match [regex]::Escape('web-viewer-sample/package-lock.json'))) 'ci.yml does not depend on ignored viewer package-lock'

    $governanceWorkflow = Get-Content -LiteralPath '.github/workflows/agent-governance.yml' -Raw
    Assert-True (-not ($governanceWorkflow -match '(?m)^\s+paths:\s*$')) 'agent-governance workflow does not use path filters because it is a required-check candidate'
    Assert-True ($governanceWorkflow -match 'scripts/tests/test-agent-governance-check\.ps1') 'agent-governance workflow runs static check'
    Assert-True ($governanceWorkflow -match 'scripts/tests/test-pr-body-evidence\.ps1') 'agent-governance workflow runs PR body evidence tests'

    $prReviewWorkflow = Get-Content -LiteralPath '.github/workflows/pr-review-agent.yml' -Raw
    Assert-True (-not ($prReviewWorkflow -match '(?m)^\s+paths-ignore:\s*$')) 'PR review workflow does not use paths-ignore because it is a required-check candidate'
    Assert-True ($prReviewWorkflow -match '(?m)^\s+runs-on:\s+ubuntu-latest\s*$') 'PR review workflow uses lightweight ubuntu runner'
    Assert-True ($prReviewWorkflow -match 'check-pr-body-evidence\.ps1') 'PR review workflow enforces PR body evidence'
    Assert-True ($prReviewWorkflow -match 'changed-paths\.txt') 'PR review workflow records changed paths for body evidence checks'
    $prDiffRange = '${{ github.event.pull_request.base.sha }}...${{ github.event.pull_request.head.sha }}'
    Assert-True ($prReviewWorkflow -match [regex]::Escape($prDiffRange)) 'PR review workflow diffs from the merge base so newer main commits are not classified as PR changes'
    Assert-True ($prReviewWorkflow -match 'check-pr-local-preflight\.ps1 -PrNumber <n>') 'PR review workflow points reviewers to the local preflight gate'
    Assert-True ($prReviewWorkflow -match 'Full service CI remains available on `push` to `main` and `workflow_dispatch`') 'PR review workflow documents full remote CI trigger points'
    Assert-True (-not ($prReviewWorkflow -match 'scripts/pr-review-agent\.ps1')) 'PR review workflow does not rerun the local review agent in CI'
    Assert-True (-not ($prReviewWorkflow -match "'-SkipGitNexus'|'-AllowGitNexusUnavailable'|'-ReportOnly'")) 'PR review workflow no longer carries local review-agent flags'
    Assert-True (-not ($prReviewWorkflow -match '(?m)^\s+pull-requests:\s+write\s*$')) 'PR review workflow does not request pull-requests write permission'
    Assert-True (-not ($prReviewWorkflow -match '(?m)^\s+checks:\s+write\s*$')) 'PR review workflow does not request checks write permission'
    Assert-True (-not ($prReviewWorkflow -match 'npm ci|npm install --no-audit --no-fund|python -m pip install')) 'PR review workflow does not install local service dependencies in CI'
    Assert-True (-not ($prReviewWorkflow -match 'gitnexus@1\.6\.5')) 'PR review workflow does not install GitNexus in CI'
    Assert-True (-not ($prReviewWorkflow -match 'gitnexus analyze --index-only')) 'PR review workflow does not build a GitNexus index in CI'

    $gitnexusIgnore = Get-Content -LiteralPath '.gitnexusignore' -Raw
    foreach ($ignoredPath in @(
        '/bim-streaming-server/source/extensions/ezplus.bim_review_stream.messaging/ezplus/bim_review_stream/messaging/stage_loading.py',
        '/bim-streaming-server/source/extensions/ezplus.bim_review_stream.messaging/ezplus/bim_review_stream/messaging/ifc2usdc_powershell_adapter.py',
        '/bim-streaming-server/source/extensions/ezplus.bim_review_stream.messaging/ezplus/bim_review_stream/messaging/conversion_authority.py',
        '/bim-streaming-server/tests/test_host_native_conversion_service.py'
    )) {
        Assert-True ($gitnexusIgnore -match [regex]::Escape($ignoredPath)) ".gitnexusignore excludes analyzer crash path $ignoredPath"
    }

    $prBodyEvidenceChecker = Get-Content -LiteralPath 'scripts/tests/check-pr-body-evidence.ps1' -Raw
    foreach ($marker in @('Change lane', 'Behavior contract changed', 'Requirement source', 'GitNexus evidence', 'Browser E2E evidence', 'Agent workflow changed?')) {
        Assert-True ($prBodyEvidenceChecker -match [regex]::Escape($marker)) "PR body evidence checker requires $marker"
    }

    $prTemplate = Get-Content -LiteralPath '.github/PULL_REQUEST_TEMPLATE.md' -Raw
    foreach ($marker in @('AI Coding Governance', 'Change lane', 'Behavior contract changed', 'Linked issue', 'Requirement source', 'CODEOWNERS', 'GitNexus', 'Browser E2E evidence')) {
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
    Assert-True ($codexConfig -match '\[permissions\.safe-workspace\.network\]') '.codex/config.toml declares safe-workspace network permissions'
    foreach ($domain in @('api.github.com', 'github.com')) {
        Assert-True ($codexConfig -match [regex]::Escape('"' + $domain + '"')) ".codex/config.toml allows $domain"
    }
    Assert-True ($codexConfig -match '\[plugins\."cloudflare@openai-curated"\][\s\S]*?enabled\s*=\s*false') '.codex/config.toml disables the Cloudflare plugin'
    Assert-True ($codexConfig -match '\[plugins\."superpowers@claude-plugins-official"\][\s\S]*?enabled\s*=\s*false') '.codex/config.toml disables the Superpowers plugin for Codex'
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

    $codexSpecToDone = Get-Content -LiteralPath '.codex/skills/spec-to-done/SKILL.md' -Raw
    $claudeSpecToDone = Get-Content -LiteralPath '.claude/skills/spec-to-done/SKILL.md' -Raw
    foreach ($implicitTrigger in @('實作 spec', '完成需求', '使用 agents')) {
        Assert-True ($codexSpecToDone -match [regex]::Escape($implicitTrigger)) "Codex spec-to-done excludes implicit trigger: $implicitTrigger"
    }
    foreach ($hardGate in @('P0', 'P1', 'P3', 'P4', 'P5', 'P6', 'P7', 'HELD', 'browser evidence', 'ship-item', 'GitNexus')) {
        Assert-True ($codexSpecToDone -match [regex]::Escape($hardGate)) "Codex spec-to-done preserves hard-gate marker: $hardGate"
        Assert-True ($claudeSpecToDone -match [regex]::Escape($hardGate)) "Claude spec-to-done preserves hard-gate marker: $hardGate"
    }

    $claudeSettingsRaw = Get-Content -LiteralPath '.claude/settings.json' -Raw
    $claudeSettings = $claudeSettingsRaw | ConvertFrom-Json
    Assert-True ($claudeSettings.enabledPlugins.'superpowers@claude-plugins-official' -eq $false) 'Claude project disables Superpowers'
    Assert-True (-not ($claudeSettingsRaw -match 'Write\|Edit\|MultiEdit|verify-reminder')) 'Claude no longer runs verify reminder after every edit'
    Assert-True ($claudeSettingsRaw -match 'Bash\(git commit\*\)') 'Claude commit guard runs only for git commit'
    Assert-True ($claudeSettingsRaw -match 'Bash\(gh pr merge\*\)') 'Claude keeps the merge evidence gate'
    $browserGate = Get-Content -LiteralPath 'scripts/hooks/require-gstack-evidence.ps1' -Raw
    Assert-True ($browserGate -match 'Playwright / gstack / supported browser engine') 'merge evidence gate is browser-engine neutral'
    Assert-True ($browserGate -match 'trace\.\*\\\.zip|trace.*\\\.zip') 'merge evidence gate accepts browser trace artifacts'
    Assert-True ($browserGate -match 'apps/kit-manager-web') 'merge evidence gate covers Kit Manager frontend changes'

    $fastFixSkill = Get-Content -LiteralPath '.codex/skills/ai-bim-fast-fix/SKILL.md' -Raw
    Assert-True ($fastFixSkill -match 'Escalate directly to Lane G') 'Fast Fix governed triggers escalate directly to Lane G'
    foreach ($frontendLabel in @('Backend API called', 'Runtime action', 'loading, success, failure, and retry')) {
        Assert-True ($prBodyEvidenceChecker -match [regex]::Escape($frontendLabel)) "frontend evidence gate requires $frontendLabel"
    }

    $routingFixtures = Get-Content -LiteralPath 'scripts/tests/fixtures/agent-governance-routing.json' -Raw | ConvertFrom-Json
    Assert-True ($routingFixtures.tasks.Count -ge 12) 'routing fixture suite has at least 12 tasks'
    foreach ($lane in @('F', 'B')) {
        Assert-True (@($routingFixtures.tasks | Where-Object { $_.lane -eq $lane }).Count -ge 4) "routing fixtures include four Lane $lane tasks"
    }
    foreach ($lane in @('G', 'S')) {
        Assert-True (@($routingFixtures.tasks | Where-Object { $_.lane -eq $lane }).Count -ge 2) "routing fixtures include two Lane $lane tasks"
    }
    foreach ($fixture in @($routingFixtures.tasks | Where-Object { $_.lane -eq 'F' })) {
        Assert-True (-not $fixture.superpowers -and -not $fixture.worktree_required -and -not $fixture.spec_required -and $fixture.max_subagents -eq 0 -and $fixture.validation -eq 'targeted') "Lane F fixture contract: $($fixture.id)"
    }
    foreach ($fixture in @($routingFixtures.tasks | Where-Object { $_.lane -eq 'B' })) {
        Assert-True (-not $fixture.superpowers -and -not $fixture.spec_required -and $fixture.max_subagents -le 1 -and $fixture.validation -eq 'affected') "Lane B fixture contract: $($fixture.id)"
    }
    foreach ($fixture in @($routingFixtures.tasks | Where-Object { $_.lane -eq 'G' })) {
        Assert-True ($fixture.worktree_required -and $fixture.spec_required -and $fixture.validation -match 'integration') "Lane G fixture contract: $($fixture.id)"
    }
    foreach ($fixture in @($routingFixtures.tasks | Where-Object { $_.lane -eq 'S' })) {
        Assert-True ($fixture.superpowers -and $fixture.worktree_required -and $fixture.spec_required -and $fixture.validation -eq 'p0_p7') "Lane S fixture contract: $($fixture.id)"
    }
    Assert-True ($routingFixtures.negative_cases.Count -ge 10) 'routing fixture suite includes high-risk negative cases'
    foreach ($fixtureId in @('delete-public-contract', 'deploy-false-fast', 'security-false-bounded', 'kit-browser-evidence', 'ifc-fixture-contract')) {
        Assert-True ($null -ne ($routingFixtures.negative_cases | Where-Object id -eq $fixtureId | Select-Object -First 1)) "routing negative fixture exists: $fixtureId"
    }

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
} finally {
    Pop-Location
}

Write-Host '[test-agent-governance-check] all assertions passed'
