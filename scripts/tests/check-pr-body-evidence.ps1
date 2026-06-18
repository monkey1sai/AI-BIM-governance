[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string] $BodyPath,
    [Parameter(Mandatory = $true)][string] $ChangedPathsPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

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

$governancePattern = '^(AGENTS\.md|CLAUDE\.md|README\.md|docs/(agents|plans)/|docs/PR_REVIEW_AGENT\.md|\.github/|\.claude/workflows/|\.claude/settings\.json|\.codex/skills/|scripts/(pr-review-agent\.ps1|lib/pr-review-agent\.ps1|tests/(check-pr-body-evidence|test-agent-governance-check|test-pr-body-evidence)\.ps1))'
$frontendPattern = '^(web-viewer-sample/|apps/kit-manager-web/|bim-review-coordinator/(src|public)/|docs/plans/.*prototype\.html)'
$deployPattern = '^(scripts/deploy\.ps1|scripts/lib/(preflight|deploy|host-native|rebuild)|scripts/dev/rebuild-test-deploy\.ps1|compose\..*\.yml|infra/docker/|bim-streaming-server/|governance-service/|services/kit-manager-api/|\.env.*\.example)'

if (Test-AnyPathMatches -Paths $changedPaths -Pattern $governancePattern) {
    Assert-BodyFields -Body $body -Context 'AI Coding Governance' -Labels @(
        'Linked issue',
        'Requirement source',
        'CODEOWNERS / owner review',
        'GitNexus evidence',
        'gstack evidence',
        'Agent workflow changed?',
        'Required checks expected'
    )
}

if (Test-AnyPathMatches -Paths $changedPaths -Pattern $frontendPattern) {
    Assert-BodyFields -Body $body -Context 'Frontend Verification' -Labels @(
        'Frontend route',
        'Main button(s) tested',
        'Fixture used',
        'Visible success state',
        'E2E command',
        'Screenshot / trace',
        'Known gaps'
    )
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
