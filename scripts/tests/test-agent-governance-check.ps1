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
    foreach ($job in @('root-contracts', 'coordinator', 'governance-service', 'viewer', 'kit-manager-api', 'kit-manager-web', 'compose-config', 'powershell-static', 'secret-pattern-scan')) {
        Assert-True ($ci -match "(?m)^\s{2}$([regex]::Escape($job)):\s*$") "ci.yml contains job $job"
    }
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
    Assert-True ($prReviewWorkflow -match "'-SkipGitNexus'") 'normal PR review workflow skips GitNexus in CI to avoid slow bootstrap'
    Assert-True ($prReviewWorkflow -match "'-AllowGitNexusUnavailable'") 'normal PR review workflow downgrades skipped GitNexus to warning in CI'
    Assert-True ($prReviewWorkflow -match "'-ReportOnly'") 'draft PR report-only behavior remains available'
    Assert-True ($prReviewWorkflow -match 'check-pr-body-evidence\.ps1') 'PR review workflow enforces PR body evidence'
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
    foreach ($marker in @('GitNexus evidence', 'gstack evidence', 'Agent workflow changed?')) {
        Assert-True ($prBodyEvidenceChecker -match [regex]::Escape($marker)) "PR body evidence checker requires $marker"
    }

    $prTemplate = Get-Content -LiteralPath '.github/PULL_REQUEST_TEMPLATE.md' -Raw
    foreach ($marker in @('AI Coding Governance', 'Linked issue', 'Requirement source', 'CODEOWNERS', 'GitNexus', 'gstack')) {
        Assert-True ($prTemplate -match [regex]::Escape($marker)) "PR template contains $marker"
    }

    $reviewDoc = Get-Content -LiteralPath 'docs/PR_REVIEW_AGENT.md' -Raw
    foreach ($marker in @('Required checks', 'agent-governance', 'CODEOWNERS', 'branch protection', 'remote-only', 'PR body evidence')) {
        Assert-True ($reviewDoc -match [regex]::Escape($marker)) "PR review doc contains $marker"
    }
} finally {
    Pop-Location
}

Write-Host '[test-agent-governance-check] all assertions passed'
