[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string] $BodyPath,
    [Parameter(Mandatory = $true)][string] $ChangedPathsPath,
    [switch] $ChangedPathsNulDelimited,
    [string] $RepoRoot = '',
    [string] $BaseSha = '',
    [string] $HeadSha = '',
    [int] $PrNumber = 0
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$scriptRepoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
if ([string]::IsNullOrWhiteSpace($RepoRoot)) { $RepoRoot = $scriptRepoRoot }
$RepoRoot = (Resolve-Path -LiteralPath $RepoRoot).Path
. (Join-Path $scriptRepoRoot 'scripts\lib\pr-review-agent.ps1')
. (Join-Path $scriptRepoRoot 'scripts\lib\design-system-gate.ps1')
. (Join-Path $scriptRepoRoot 'scripts\lib\production-boundary-contract.ps1')
. (Join-Path $scriptRepoRoot 'scripts\lib\self-referential-bootstrap.ps1')
. (Join-Path $scriptRepoRoot 'scripts\lib\windows-verification-scope.ps1')

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
    param(
        [Parameter(Mandatory = $true)][string] $Body,
        [Parameter(Mandatory = $true)][string] $EvidenceRepoRoot,
        [Parameter(Mandatory = $true)] $DesignScope,
        [string] $EvidenceHeadSha = ''
    )

    $labels = @(
        'Frontend route',
        'Main button(s) tested',
        'Fixture used',
        'Backend API called',
        'Runtime action',
        'Visible success state',
        'E2E command',
        'Screenshot / trace',
        'Design gate status',
        'Design screen(s)',
        'Reference-missing route(s) / surface(s)',
        'Full completion claimed',
        'Design reference manifest',
        'Visual fidelity result',
        'Visual comparison',
        'Visual artifacts',
        'Known gaps'
    )
    Assert-BodyFields -Body $Body -Context 'Frontend Verification' -Labels $labels

    $prohibited = @('none', 'n/a', 'not applicable', 'not needed', 'unavailable', 'not tested')
    $alwaysObservedLabels = @(
        'Frontend route',
        'Main button(s) tested',
        'Fixture used',
        'Backend API called',
        'Runtime action',
        'Visible success state',
        'E2E command',
        'Screenshot / trace'
    )
    foreach ($label in $alwaysObservedLabels) {
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

    $designReference = Get-MarkdownTableValue -Body $Body -Label 'Design reference manifest'
    if ($designReference -notmatch '(?i)docs/plans/design-system-reference\.manifest\.json') {
        throw 'Frontend Verification Design reference manifest must name docs/plans/design-system-reference.manifest.json.'
    }

    if ($DesignScope.status -eq 'unknown_fail_closed') {
        throw "Frontend design scope contains paths unknown to the base/head manifest union: $($DesignScope.unknown_paths -join ', ')."
    }
    $declaredStatus = (Get-MarkdownTableValue -Body $Body -Label 'Design gate status').Trim().ToLowerInvariant()
    if ($declaredStatus -ne [string]$DesignScope.status) {
        throw "Frontend Verification Design gate status must be '$($DesignScope.status)' for the machine-derived changed-path scope; actual='$declaredStatus'."
    }
    $fullCompletion = (Get-MarkdownTableValue -Body $Body -Label 'Full completion claimed').Trim().ToLowerInvariant()
    if ($fullCompletion -notin @('yes', 'no')) {
        throw "Frontend Verification Full completion claimed must be yes or no; actual='$fullCompletion'."
    }
    if ($fullCompletion -eq 'yes' -and -not [bool]$DesignScope.full_completion_allowed) {
        throw "Frontend Verification cannot claim full completion while design scope is '$($DesignScope.status)' or semantic state variants are not executable."
    }

    $declaredMissing = @((Get-MarkdownTableValue -Body $Body -Label 'Reference-missing route(s) / surface(s)').Split(',') | ForEach-Object { $_.Trim() } | Where-Object { $_ })
    $expectedMissing = @($DesignScope.reference_missing_items | ForEach-Object { [string]$_ })
    if ($expectedMissing.Count -eq 0) {
        if ($declaredMissing.Count -ne 1 -or $declaredMissing[0].ToLowerInvariant() -ne 'none') {
            throw 'Frontend Verification Reference-missing route(s) / surface(s) must be none for an approved-only scope.'
        }
    } elseif ((@($declaredMissing | Sort-Object) -join '|') -ne (@($expectedMissing | Sort-Object) -join '|')) {
        throw "Frontend Verification Reference-missing route(s) / surface(s) must exactly match the machine-derived set: $($expectedMissing -join ', ')."
    }

    $screenIds = @((Get-MarkdownTableValue -Body $Body -Label 'Design screen(s)').Split(',') | ForEach-Object { $_.Trim() } | Where-Object { $_ })
    $expectedScreenIds = @($DesignScope.required_screen_ids | ForEach-Object { [string]$_ })
    if ([bool]$DesignScope.visual_required) {
        if ((@($screenIds | Sort-Object) -join '|') -ne (@($expectedScreenIds | Sort-Object) -join '|')) {
            throw "Frontend Verification Design screen(s) must exactly match all machine-required manifest screens: $($expectedScreenIds -join ', ')."
        }
    } elseif ($screenIds.Count -ne 1 -or $screenIds[0].ToLowerInvariant() -ne 'reference_missing') {
        throw 'Frontend Verification Design screen(s) must be reference_missing when the affected product surface has no approved screen.'
    }

    $comparison = Get-MarkdownTableValue -Body $Body -Label 'Visual comparison'
    $visualArtifacts = Get-MarkdownTableValue -Body $Body -Label 'Visual artifacts'
    $resultRelative = Get-MarkdownTableValue -Body $Body -Label 'Visual fidelity result'
    if ([bool]$DesignScope.visual_required) {
        if ($comparison -notmatch '(?i)(?:<=|≤)\s*1\s*%' -or $comparison -notmatch '(?i)(?:semantic|語意).*(?:100\s*%|1(?:\.0+)?)') {
            throw 'Frontend Verification Visual comparison must record the required pixel diff <=1% and semantic parity 100%.'
        }
        if ($visualArtifacts -notmatch '(?i)actual.*\.png' -or $visualArtifacts -notmatch '(?i)diff.*\.png') {
            throw 'Frontend Verification Visual artifacts must identify actual and diff PNG artifacts produced by the required CI check.'
        }
        if ($resultRelative -notmatch '(?i)artifacts/e2e/design-system-visual-result\.json') {
            throw 'Frontend Verification Visual fidelity result must identify artifacts/e2e/design-system-visual-result.json from the required CI check.'
        }
    } else {
        foreach ($entry in @(
            @{ Label = 'Visual fidelity result'; Value = $resultRelative },
            @{ Label = 'Visual comparison'; Value = $comparison },
            @{ Label = 'Visual artifacts'; Value = $visualArtifacts }
        )) {
            if ($entry.Value.Trim().ToLowerInvariant() -ne 'reference_missing') {
                throw "Frontend Verification '$($entry.Label)' must be reference_missing for a pure reference-missing product scope."
            }
        }
    }

    if ($expectedMissing.Count -gt 0) {
        $knownGaps = Get-MarkdownTableValue -Body $Body -Label 'Known gaps'
        foreach ($missingItem in $expectedMissing) {
            if ($knownGaps -notmatch [regex]::Escape($missingItem)) {
                throw "Frontend Verification Known gaps must disclose reference-missing item '$missingItem'."
            }
        }
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
if ($ChangedPathsNulDelimited) {
    $pathBytes = [IO.File]::ReadAllBytes((Resolve-Path -LiteralPath $ChangedPathsPath).Path)
    if ($pathBytes.Length -eq 0 -or $pathBytes[$pathBytes.Length - 1] -ne 0) {
        throw 'NUL-delimited changed-path input must be non-empty and end in NUL.'
    }
    try {
        $pathText = [Text.UTF8Encoding]::new($false, $true).GetString($pathBytes, 0, $pathBytes.Length - 1)
    } catch {
        throw 'NUL-delimited changed-path input is not valid UTF-8.'
    }
    $changedPaths = @($pathText.Split([char]0))
    if (@($changedPaths | Where-Object { [string]::IsNullOrEmpty($_) }).Count -gt 0) {
        throw 'NUL-delimited changed-path input contains an empty path.'
    }
} else {
    $changedPaths = @(Get-Content -LiteralPath $ChangedPathsPath | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
}
$designScope = Get-DesignSystemChangeScope -RepoRoot $RepoRoot -ChangedPaths $changedPaths -BaseSha $BaseSha -HeadSha $HeadSha
if ($designScope.status -like '*_fail_closed') {
    throw "Frontend design scope failed closed with status '$($designScope.status)'; unknown=$($designScope.unknown_paths -join ', '); reference-authority=$($designScope.reference_authority_paths -join ', ')."
}
Assert-ProductionBoundaryDiff -RepoRoot $RepoRoot -BaseSha $BaseSha -HeadSha $HeadSha

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
if ($changeLane -in @('F', 'B') -and @($designScope.gate_infrastructure_paths).Count -gt 0) {
    throw "PR body Change lane '$changeLane' is below the required Lane G minimum for design gate infrastructure: $($designScope.gate_infrastructure_paths -join ', ')."
}
$gitNexusEvidence = Get-MarkdownTableValue -Body $body -Label 'GitNexus evidence'
if ($changeLane -in @('F', 'B') -and $gitNexusEvidence -match '(?i)\brisk(?:_level)?\s*[:=]\s*(?:high|critical)\b') {
    throw 'PR body GitNexus evidence reports HIGH/CRITICAL risk; Lane G is required.'
}

$governancePattern = '^(AGENTS\.md|CLAUDE\.md|README\.md|\.gitignore|docs/(agents|plans)/|docs/PR_REVIEW_AGENT\.md|\.github/|\.claude/workflows/|\.claude/settings\.json|\.codex/config\.toml|\.codex/skills/|scripts/(pr-review-agent\.ps1|lib/(pr-review-agent|design-system-gate)\.ps1|dev/check-pr-local-preflight\.ps1|tests/(check-pr-body-evidence|test-agent-governance-check|test-pr-body-evidence|test-pr-review-agent|test-design-system-change-scope)\.ps1|tests/fixtures/agent-governance-routing\.json))'
$deployPattern = '^(scripts/deploy\.ps1|scripts/lib/(preflight|deploy|host-native|rebuild)|scripts/dev/rebuild-test-deploy\.ps1|compose\..*\.yml|infra/docker/|bim-streaming-server/|governance-service/|services/kit-manager-api/|\.env.*\.example)'

if ((Test-AnyPathMatches -Paths $changedPaths -Pattern $governancePattern) -or @($designScope.gate_infrastructure_paths).Count -gt 0) {
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

if ([bool]$designScope.frontend_product) {
    Assert-FrontendEvidence -Body $body -EvidenceRepoRoot $RepoRoot -DesignScope $designScope -EvidenceHeadSha $HeadSha
}

if (Test-AnyPathMatches -Paths $changedPaths -Pattern $deployPattern) {
    Assert-BodyFields -Body $body -Context 'Deploy Path Verification' -Labels @(
        'Affects runtime / docker / Kit / viewer / ports / env?',
        'Canonical deploy path updated?',
        'Deploy dry-run command',
        'Verify command'
    )
}

# Self-referential bootstrap: PRs that change the verification mechanism itself must
# declare it, and the ledger transition is judged base-vs-head so debt cannot be
# deleted, impersonated, or closed with a fabricated fixpoint.
# Rule: docs/agents/self-referential-bootstrap.md
$hasBootstrapBaseContext = -not [string]::IsNullOrWhiteSpace($BaseSha)
$baseLedgerJson = ''
$baseLedgerExists = $false
if ($hasBootstrapBaseContext) {
    & git -C $RepoRoot cat-file -e "$BaseSha^{commit}" 2>$null
    if ($LASTEXITCODE -ne 0) { throw "Self-referential bootstrap base SHA does not resolve to a commit: $BaseSha" }
    & git -C $RepoRoot cat-file -e "${BaseSha}:scripts/self-referential-bootstrap-ledger.json" 2>$null
    if ($LASTEXITCODE -eq 0) {
        $baseLedgerExists = $true
        $baseLedgerJson = (& git -C $RepoRoot show "${BaseSha}:scripts/self-referential-bootstrap-ledger.json" 2>$null) -join "`n"
        if ($LASTEXITCODE -ne 0) { throw "Unable to read the bootstrap ledger that exists at base $BaseSha." }
    }
}
# Windows on-demand verification tier (D-20): the canonical deploy target is Linux,
# so the Windows path only stays alive if changed-path scope machine-derives which
# tier of Windows evidence a PR owes. Highest matched tier wins; docs/tests exempt.
$null = Assert-WindowsVerificationEvidence -Body $body -ChangedPaths $changedPaths `
    -GetTableValue { param($b, $label) Get-MarkdownTableValue -Body $b -Label $label }

Assert-SelfReferentialBootstrapBody -Body $body -ChangedPaths $changedPaths `
    -LedgerPath (Join-Path $RepoRoot 'scripts\self-referential-bootstrap-ledger.json') `
    -GetTableValue { param($b, $label) Get-MarkdownTableValue -Body $b -Label $label } `
    -BaseLedgerJson $baseLedgerJson -BaseLedgerExists $baseLedgerExists `
    -HasBaseContext $hasBootstrapBaseContext `
    -PrNumber $PrNumber -RepoRoot $RepoRoot -BaseSha $BaseSha -HeadSha $HeadSha

Write-Host '[check-pr-body-evidence] passed'
