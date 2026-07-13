[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string] $BodyPath,
    [Parameter(Mandatory = $true)][string] $ChangedPathsPath,
    [string] $RepoRoot = '',
    [string] $BaseSha = '',
    [string] $HeadSha = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$scriptRepoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
if ([string]::IsNullOrWhiteSpace($RepoRoot)) { $RepoRoot = $scriptRepoRoot }
. (Join-Path $scriptRepoRoot 'scripts\lib\pr-review-agent.ps1')

function Get-MarkdownTableValue {
    param(
        [Parameter(Mandatory = $true)][string] $Body,
        [Parameter(Mandatory = $true)][string] $Label
    )
    $pattern = "(?im)^\|\s*$([regex]::Escape($Label))\s*\|\s*(.*?)\s*\|"
    $match = [regex]::Match($Body, $pattern)
    if (-not $match.Success) { return $null }
    return $match.Groups[1].Value.Trim()
}

function Test-MeaningfulValue {
    param([AllowNull()][string] $Value)
    if ([string]::IsNullOrWhiteSpace($Value)) { return $false }
    $normalized = $Value.Trim().ToLowerInvariant()
    if ($normalized -in @('_', '-', 'tbd', 'todo', 'n/a?', 'fill me')) { return $false }
    return $true
}

function Assert-BodyFields {
    param(
        [Parameter(Mandatory = $true)][string] $Body,
        [Parameter(Mandatory = $true)][string[]] $Labels,
        [Parameter(Mandatory = $true)][string] $Context
    )
    $missing = @()
    foreach ($label in $Labels) {
        $value = Get-MarkdownTableValue -Body $Body -Label $label
        if (-not (Test-MeaningfulValue -Value $value)) {
            $missing += $label
        }
    }
    if ($missing.Count -gt 0) {
        throw "PR body evidence check failed for $Context. Missing or empty: $($missing -join ', ')."
    }
}

function Assert-FrontendEvidence {
    param([Parameter(Mandatory = $true)][string] $Body)

    $labels = @('Frontend route', 'Main button(s) tested', 'Fixture used', 'Backend API called', 'Runtime action', 'Visible success state', 'E2E command', 'Screenshot / trace', 'Known gaps')
    Assert-BodyFields -Body $Body -Context 'Frontend Verification' -Labels $labels

    $prohibited = @('none', 'n/a', 'not applicable', 'not needed', 'unavailable', 'not tested')
    foreach ($label in @($labels | Where-Object { $_ -ne 'Known gaps' })) {
        $value = (Get-MarkdownTableValue -Body $Body -Label $label).Trim().ToLowerInvariant()
        if ($value -in $prohibited) { throw "Frontend Verification '$label' must contain real evidence, not '$value'." }
    }

    $runtimeAction = Get-MarkdownTableValue -Body $Body -Label 'Runtime action'
    if ($runtimeAction -notmatch '(?i)(?:run|session|request|job|correlation|runtime)[-_ ]?id\s*[:=]|\bid\s*[:=]') {
        throw 'Frontend Verification Runtime action must name the observed runtime ID (for example sessionId=...).'
    }

    $visibleStates = Get-MarkdownTableValue -Body $Body -Label 'Visible success state'
    foreach ($statePattern in @('(?i)loading|載入|處理中', '(?i)success|成功', '(?i)failure|failed|error|失敗|錯誤', '(?i)retry|重試')) {
        if ($visibleStates -notmatch $statePattern) { throw 'Frontend Verification Visible success state must record loading, success, failure, and retry behavior.' }
    }

    $artifact = Get-MarkdownTableValue -Body $Body -Label 'Screenshot / trace'
    if ($artifact -notmatch '(?i)(?:\.png\b|trace.*\.zip\b|screenshot|trace)') {
        throw 'Frontend Verification Screenshot / trace must identify a screenshot or trace artifact.'
    }
}

function Test-AnyPathMatches {
    param(
        [Parameter(Mandatory = $true)][string[]] $Paths,
        [Parameter(Mandatory = $true)][string] $Pattern
    )
    return [bool](@($Paths | Where-Object { $_ -match $Pattern } | Select-Object -First 1).Count)
}

if (-not (Test-Path -LiteralPath $BodyPath -PathType Leaf)) {
    throw "PR body file not found: $BodyPath"
}
if (-not (Test-Path -LiteralPath $ChangedPathsPath -PathType Leaf)) {
    throw "Changed paths file not found: $ChangedPathsPath"
}

$body = Get-Content -LiteralPath $BodyPath -Raw
$changedPaths = @(Get-Content -LiteralPath $ChangedPathsPath | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })

if ([string]::IsNullOrWhiteSpace($body)) {
    throw 'PR body is empty. Use the repository PR template and fill validation evidence.'
}

Assert-BodyFields -Body $body -Context 'Change Classification' -Labels @(
    'Change lane',
    'Behavior contract changed',
    'Requirement source'
)

$changeLane = (Get-MarkdownTableValue -Body $body -Label 'Change lane').Trim().ToUpperInvariant()
$behaviorChanged = (Get-MarkdownTableValue -Body $body -Label 'Behavior contract changed').Trim().ToLowerInvariant()
$requirementSource = (Get-MarkdownTableValue -Body $body -Label 'Requirement source').Trim()
if ($changeLane -notin @('F', 'B', 'G', 'S')) {
    throw "PR body Change lane must be one of F, B, G, S; actual='$changeLane'."
}
if ($behaviorChanged -notin @('yes', 'no')) {
    throw "PR body Behavior contract changed must be yes or no; actual='$behaviorChanged'."
}
$hasFormalRequirement = Test-PrReviewRequirementSourceIsFormal -RequirementSource $requirementSource
if (($behaviorChanged -eq 'yes' -or $changeLane -in @('G', 'S')) -and -not $hasFormalRequirement) {
    throw 'Behavior-changing or Lane G/S work requires Requirement source: issue, docs/plans, superpowers spec, or existing contract.'
}
$behaviorSignals = @(Get-PrReviewBehaviorContractSignals -ChangedPaths $changedPaths -RepoRoot $RepoRoot -BaseSha $BaseSha -HeadSha $HeadSha)
$governedLaneReasons = @(Get-PrReviewGovernedLaneReasons -ChangedPaths $changedPaths -BehaviorSignals $behaviorSignals)
if ($behaviorChanged -eq 'no' -and $behaviorSignals.Count -gt 0) {
    $signalSummary = @($behaviorSignals | ForEach-Object { "$($_.operation):$($_.kind):$($_.path)" }) -join ', '
    throw "PR body declares Behavior contract changed: no, but diff-line analysis found: $signalSummary"
}
if ($changeLane -in @('F', 'B') -and ($behaviorChanged -eq 'yes' -or $governedLaneReasons.Count -gt 0)) {
    $reasonSummary = if ($governedLaneReasons.Count -gt 0) { $governedLaneReasons -join ', ' } else { 'behavior_contract_declared_changed' }
    throw "PR body Change lane '$changeLane' is below the required Lane G minimum: $reasonSummary."
}
$gitNexusEvidence = Get-MarkdownTableValue -Body $body -Label 'GitNexus evidence'
if ($changeLane -in @('F', 'B') -and $gitNexusEvidence -match '(?i)\brisk(?:_level)?\s*[:=]\s*(?:high|critical)\b') {
    throw 'PR body GitNexus evidence reports HIGH/CRITICAL risk; Lane G is required.'
}

$governancePattern = '^(AGENTS\.md|CLAUDE\.md|README\.md|\.gitignore|docs/(agents|plans)/|docs/PR_REVIEW_AGENT\.md|\.github/|\.claude/workflows/|\.claude/settings\.json|\.codex/config\.toml|\.codex/skills/|scripts/(pr-review-agent\.ps1|lib/pr-review-agent\.ps1|dev/check-pr-local-preflight\.ps1|tests/(check-pr-body-evidence|test-agent-governance-check|test-pr-body-evidence|test-pr-review-agent)\.ps1|tests/fixtures/agent-governance-routing\.json))'
$frontendPattern = '^(web-viewer-sample/|apps/kit-manager-web/|bim-review-coordinator/(src|public)/|docs/plans/.*prototype\.html)'
$deployPattern = '^(scripts/deploy\.ps1|scripts/lib/(preflight|deploy|host-native|rebuild)|scripts/dev/rebuild-test-deploy\.ps1|compose\..*\.yml|infra/docker/|bim-streaming-server/|governance-service/|services/kit-manager-api/|\.env.*\.example)'

if (Test-AnyPathMatches -Paths $changedPaths -Pattern $governancePattern) {
    Assert-BodyFields -Body $body -Context 'AI Coding Governance' -Labels @(
        'Linked issue',
        'Requirement source',
        'CODEOWNERS / owner review',
        'GitNexus evidence',
        'Browser E2E evidence',
        'Agent workflow changed?',
        'Required checks expected'
    )
}

if (Test-AnyPathMatches -Paths $changedPaths -Pattern $frontendPattern) {
    Assert-FrontendEvidence -Body $body
}

if (Test-AnyPathMatches -Paths $changedPaths -Pattern $deployPattern) {
    Assert-BodyFields -Body $body -Context 'Deploy Path Verification' -Labels @(
        'Affects runtime / docker / Kit / viewer / ports / env?',
        'Canonical deploy path updated?',
        'Deploy dry-run command',
        'Verify command'
    )
}

Write-Host '[check-pr-body-evidence] passed'
