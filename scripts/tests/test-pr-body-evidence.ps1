[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Assert-True {
    param([Parameter(Mandatory = $true)] $Condition, [Parameter(Mandatory = $true)][string] $Message)
    if (-not $Condition) { throw "ASSERT FAILED: $Message" }
}

function Assert-CheckerFails {
    param(
        [Parameter(Mandatory = $true)][string] $BodyPath,
        [Parameter(Mandatory = $true)][string] $PathsPath,
        [Parameter(Mandatory = $true)][string] $Message,
        [string] $RepoRoot = '',
        [string] $BaseSha = '',
        [string] $HeadSha = ''
    )

    $arguments = @('-NoProfile', '-NonInteractive', '-File', $script:checker, '-BodyPath', $BodyPath, '-ChangedPathsPath', $PathsPath)
    if (-not [string]::IsNullOrWhiteSpace($RepoRoot)) { $arguments += @('-RepoRoot', $RepoRoot) }
    if (-not [string]::IsNullOrWhiteSpace($BaseSha)) { $arguments += @('-BaseSha', $BaseSha) }
    if (-not [string]::IsNullOrWhiteSpace($HeadSha)) { $arguments += @('-HeadSha', $HeadSha) }
    & pwsh @arguments *> $null
    Assert-True ($LASTEXITCODE -ne 0) $Message
}

$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../..')).Path
$script:checker = Join-Path $repoRoot 'scripts/tests/check-pr-body-evidence.ps1'
$tempParent = Join-Path $repoRoot 'artifacts/tmp'
$tempRoot = Join-Path $tempParent "pr-body-evidence-$([Guid]::NewGuid().ToString('N'))"
New-Item -ItemType Directory -Path $tempRoot -Force | Out-Null

$manifest = Get-Content -LiteralPath (Join-Path $repoRoot 'docs/plans/design-system-reference.manifest.json') -Raw | ConvertFrom-Json
$allScreens = @($manifest.screens | ForEach-Object { [string]$_.id }) -join ', '
$missingRoutes = @($manifest.route_inventory | Where-Object status -eq 'reference_missing' | ForEach-Object { [string]$_.route }) -join ', '

try {
    $bodyPath = Join-Path $tempRoot 'body.md'
    $pathsPath = Join-Path $tempRoot 'paths.txt'

    $partialBody = @'
## AI Coding Governance

| Item | Result |
|---|---|
| Change lane | G |
| Behavior contract changed | yes |
| Linked issue | #123 |
| Requirement source | docs/plans |
| CODEOWNERS / owner review | requested |
| GitNexus evidence | detect_changes |
| Browser E2E evidence | Playwright screenshot |
| Agent workflow changed? | no |
| Required checks expected | CI / Agent Governance / PR Review Agent |

## Frontend Verification

| Item | Result |
|---|---|
| Frontend route | /kit-manager |
| Main button(s) tested | Release Kit instance |
| Fixture used | deterministic operator fixture |
| Backend API called | /api/kit/instances/release |
| Runtime action | runtimeId=runtime-123 |
| Visible success state | loading indicator; success toast; failure alert; retry button |
| E2E command | npm run test:e2e |
| Screenshot / trace | artifacts/e2e/kit-manager/trace.zip |
| Design gate status | partial_reference_missing |
| Design screen(s) | reference_missing |
| Reference-missing route(s) / surface(s) | surface:kit-manager-web |
| Full completion claimed | no |
| Design reference manifest | docs/plans/design-system-reference.manifest.json |
| Visual fidelity result | reference_missing |
| Visual comparison | reference_missing |
| Visual artifacts | reference_missing |
| Known gaps | surface:kit-manager-web has no approved upstream screen; no 99% claim |
'@
    $partialBody | Set-Content -LiteralPath $bodyPath -Encoding utf8
    @('AGENTS.md', 'apps/kit-manager-web/src/App.tsx') | Set-Content -LiteralPath $pathsPath -Encoding utf8
    $partialOutput = @(& pwsh -NoProfile -NonInteractive -File $script:checker -BodyPath $bodyPath -ChangedPathsPath $pathsPath 2>&1)
    Assert-True ($LASTEXITCODE -eq 0) "partial_reference_missing body passes: $($partialOutput -join ' | ')"

    ($partialBody -replace 'runtimeId=runtime-123', 'none') | Set-Content -LiteralPath $bodyPath -Encoding utf8
    Assert-CheckerFails -BodyPath $bodyPath -PathsPath $pathsPath -Message 'partial frontend still requires observed runtime evidence'

    ($partialBody -replace 'Full completion claimed \| no', 'Full completion claimed | yes') | Set-Content -LiteralPath $bodyPath -Encoding utf8
    Assert-CheckerFails -BodyPath $bodyPath -PathsPath $pathsPath -Message 'reference-missing scope cannot claim full completion'

    ($partialBody -replace 'surface:kit-manager-web \|', 'none |') | Set-Content -LiteralPath $bodyPath -Encoding utf8
    Assert-CheckerFails -BodyPath $bodyPath -PathsPath $pathsPath -Message 'reference-missing surface disclosure must match machine scope'

    $mixedBody = $partialBody.
        Replace('/kit-manager', '/ui#home').
        Replace('Release Kit instance', 'Open governance workspace').
        Replace('/api/kit/instances/release', '/api/governance/models').
        Replace('artifacts/e2e/kit-manager/trace.zip', 'artifacts/e2e/edge-console/trace.zip').
        Replace('partial_reference_missing', 'mixed').
        Replace('reference_missing', $allScreens).
        Replace('surface:kit-manager-web', $missingRoutes).
        Replace('| Visual fidelity result | ' + $allScreens + ' |', '| Visual fidelity result | artifacts/e2e/design-system-visual-result.json (generated by design-system-gate CI) |').
        Replace('| Visual comparison | ' + $allScreens + ' |', '| Visual comparison | required Chromium DPR1; 1440x900 + 1920x1080; pixel diff <=1%; semantic parity 100% |').
        Replace('| Visual artifacts | ' + $allScreens + ' |', '| Visual artifacts | artifacts/e2e/design-system-visual/*-actual.png + *-diff.png |')
    $mixedBody | Set-Content -LiteralPath $bodyPath -Encoding utf8
    @('web-viewer-sample/src/App.tsx') | Set-Content -LiteralPath $pathsPath -Encoding utf8
    $mixedOutput = @(& pwsh -NoProfile -NonInteractive -File $script:checker -BodyPath $bodyPath -ChangedPathsPath $pathsPath 2>&1)
    Assert-True ($LASTEXITCODE -eq 0) "mixed scope body passes structural gate; semantic/visual producer remains CI authority: $($mixedOutput -join ' | ')"

    ($mixedBody -replace [regex]::Escape($allScreens), 'console.home.default') | Set-Content -LiteralPath $bodyPath -Encoding utf8
    Assert-CheckerFails -BodyPath $bodyPath -PathsPath $pathsPath -Message 'mixed shared shell cannot self-select one easy screen'

    $gateInfrastructureBody = @'
## AI Coding Governance

| Item | Result |
|---|---|
| Change lane | G |
| Behavior contract changed | yes |
| Linked issue | #123 |
| Requirement source | docs/plans |
| CODEOWNERS / owner review | requested |
| GitNexus evidence | detect_changes |
| Browser E2E evidence | gate infrastructure only; product result not claimed |
| Agent workflow changed? | yes, rollback by reverting workflow |
| Required checks expected | CI / Agent Governance / PR Review Agent |
'@
    $gateInfrastructureBody | Set-Content -LiteralPath $bodyPath -Encoding utf8
    'docs/plans/design-system-reference.manifest.json' | Set-Content -LiteralPath $pathsPath -Encoding utf8
    & pwsh -NoProfile -NonInteractive -File $script:checker -BodyPath $bodyPath -ChangedPathsPath $pathsPath *> $null
    Assert-True ($LASTEXITCODE -eq 0) 'gate-infrastructure-only change does not require a fabricated production visual result'

    'web-viewer-sample/e2e/design-system-semantic-cases.ts' | Set-Content -LiteralPath $pathsPath -Encoding utf8
    & pwsh -NoProfile -NonInteractive -File $script:checker -BodyPath $bodyPath -ChangedPathsPath $pathsPath *> $null
    Assert-True ($LASTEXITCODE -eq 0) 'semantic producer self-modification is accepted only with Lane G governance evidence'

    $fastFixBody = @'
## AI Coding Governance

| Item | Result |
|---|---|
| Change lane | F |
| Behavior contract changed | no |
| Requirement source | not applicable |
'@
    $fastFixBody | Set-Content -LiteralPath $bodyPath -Encoding utf8
    'web-viewer-sample/e2e/design-system-semantic-cases.ts' | Set-Content -LiteralPath $pathsPath -Encoding utf8
    Assert-CheckerFails -BodyPath $bodyPath -PathsPath $pathsPath -Message 'design gate producer cannot self-report Lane F/B without AI Governance evidence'

    $fastFixBody | Set-Content -LiteralPath $bodyPath -Encoding utf8
    'tests/unit/test_existing_behavior.py' | Set-Content -LiteralPath $pathsPath -Encoding utf8
    & pwsh -NoProfile -NonInteractive -File $script:checker -BodyPath $bodyPath -ChangedPathsPath $pathsPath *> $null
    Assert-True ($LASTEXITCODE -eq 0) 'test-only path with behavior=no does not require formal spec'

    $signalRepo = Join-Path $tempRoot 'signal-repo'
    New-Item -ItemType Directory -Path $signalRepo -Force | Out-Null
    Push-Location $signalRepo
    try {
        git init -q
        git config user.email 'pr-body-evidence@example.invalid'
        git config user.name 'PR Body Evidence Test'
        New-Item -ItemType Directory -Path 'bim-review-coordinator/src' -Force | Out-Null
        Set-Content -LiteralPath 'bim-review-coordinator/src/index.ts' -Value 'const app = createApp();' -Encoding utf8
        git add .
        git commit -q -m 'base'
        $signalBase = (git rev-parse HEAD).Trim()
        Add-Content -LiteralPath 'bim-review-coordinator/src/index.ts' -Value "app.post('/api/new-capability', handler);"
        git add .
        git commit -q -m 'route'
        $signalHead = (git rev-parse HEAD).Trim()
    } finally {
        Pop-Location
    }
    'bim-review-coordinator/src/index.ts' | Set-Content -LiteralPath $pathsPath -Encoding utf8
    Assert-CheckerFails -BodyPath $bodyPath -PathsPath $pathsPath -Message 'public route contradicts behavior=no PR body' -RepoRoot $signalRepo -BaseSha $signalBase -HeadSha $signalHead
} finally {
    Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host '[test-pr-body-evidence] all assertions passed'
