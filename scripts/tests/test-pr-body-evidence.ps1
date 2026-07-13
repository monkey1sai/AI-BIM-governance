[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Assert-True {
    param([Parameter(Mandatory = $true)] $Condition, [Parameter(Mandatory = $true)][string] $Message)
    if (-not $Condition) { throw "ASSERT FAILED: $Message" }
}

function Assert-Throws {
    param([Parameter(Mandatory = $true)][scriptblock] $ScriptBlock, [Parameter(Mandatory = $true)][string] $Message)
    $thrown = $false
    try {
        & $ScriptBlock
    } catch {
        $thrown = $true
    }
    Assert-True $thrown $Message
}

$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$checker = Join-Path $repoRoot 'scripts\tests\check-pr-body-evidence.ps1'
$tempParent = Join-Path $repoRoot 'artifacts\tmp'
$tempRoot = Join-Path $tempParent "pr-body-evidence-$([Guid]::NewGuid().ToString('N'))"
New-Item -ItemType Directory -Path $tempParent -Force | Out-Null
New-Item -ItemType Directory -Path $tempRoot -Force | Out-Null

try {
    $bodyPath = Join-Path $tempRoot 'body.md'
    $pathsPath = Join-Path $tempRoot 'paths.txt'

    @'
## Summary

- Governance and frontend change.

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
| Agent workflow changed? | yes, rollback by reverting workflow |
| Required checks expected | CI / Agent Governance / PR Review Agent |

## Frontend Verification

| Item | Result |
|---|---|
| Frontend route | /ui#a1 |
| Main button(s) tested | Run governance |
| Fixture used | storage fixture |
| Backend API called | /api/governance/runs |
| Runtime action | sessionId=session-123 |
| Visible success state | loading indicator; success toast; failure alert; retry button |
| E2E command | npm run test:e2e |
| Screenshot / trace | artifacts/e2e/sample/trace.zip |
| Manual test steps | Open route and click button |
| Known gaps | none |

## Deploy Path Verification

| Item | Result |
|---|---|
| Affects runtime / docker / Kit / viewer / ports / env? | no |
| Canonical deploy path updated? | not needed |
| New root script added? | no |
| Deploy dry-run command | not needed |
| Full deploy tested | not available |
| Verify command | .\scripts\verify-all.ps1 |
| Frontend URL verified | http://127.0.0.1:8004/ui |
| Evidence path | artifacts/e2e/sample |

## Validation

- tests passed.

## Known Risks

- none.
'@ | Set-Content -LiteralPath $bodyPath -Encoding UTF8

    @(
        'AGENTS.md',
        'web-viewer-sample/src/App.tsx',
        'compose.runtime-manager.yml'
    ) | Set-Content -LiteralPath $pathsPath -Encoding UTF8

    & powershell -NoProfile -ExecutionPolicy Bypass -File $checker -BodyPath $bodyPath -ChangedPathsPath $pathsPath *> $null
    Assert-True ($LASTEXITCODE -eq 0) 'complete body passes'

    $completeBody = Get-Content -LiteralPath $bodyPath -Raw
    ($completeBody -replace 'sessionId=session-123', 'none') | Set-Content -LiteralPath $bodyPath -Encoding UTF8
    Assert-Throws {
        & powershell -NoProfile -ExecutionPolicy Bypass -File $checker -BodyPath $bodyPath -ChangedPathsPath $pathsPath *> $null
        if ($LASTEXITCODE -ne 0) { throw 'checker failed as expected' }
    } 'frontend Runtime action cannot use none instead of a runtime ID'

    @'
## Summary

- Missing evidence.

## AI Coding Governance

| Item | Result |
|---|---|
| Change lane | G |
| Behavior contract changed | yes |
| Linked issue |  |
| Requirement source |  |
| CODEOWNERS / owner review |  |
| GitNexus evidence |  |
| Browser E2E evidence |  |
| Agent workflow changed? |  |
| Required checks expected |  |
'@ | Set-Content -LiteralPath $bodyPath -Encoding UTF8

    'AGENTS.md' | Set-Content -LiteralPath $pathsPath -Encoding UTF8
    Assert-Throws {
        & powershell -NoProfile -ExecutionPolicy Bypass -File $checker -BodyPath $bodyPath -ChangedPathsPath $pathsPath *> $null
        if ($LASTEXITCODE -ne 0) { throw "checker failed as expected" }
    } 'empty governance fields fail'

    @'
## Summary

- Test-only assertion correction.

## AI Coding Governance

| Item | Result |
|---|---|
| Change lane | F |
| Behavior contract changed | no |
| Requirement source | not applicable |
'@ | Set-Content -LiteralPath $bodyPath -Encoding UTF8
    'tests/unit/test_existing_behavior.py' | Set-Content -LiteralPath $pathsPath -Encoding UTF8
    & powershell -NoProfile -ExecutionPolicy Bypass -File $checker -BodyPath $bodyPath -ChangedPathsPath $pathsPath *> $null
    Assert-True ($LASTEXITCODE -eq 0) 'test-only path with behavior=no does not require formal spec'

    $signalRepo = Join-Path $tempRoot 'signal-repo'
    New-Item -ItemType Directory -Path $signalRepo -Force | Out-Null
    Push-Location $signalRepo
    try {
        git init -q
        git config user.email 'pr-body-evidence@example.invalid'
        git config user.name 'PR Body Evidence Test'
        New-Item -ItemType Directory -Path 'bim-review-coordinator/src' -Force | Out-Null
        Set-Content -LiteralPath 'bim-review-coordinator/src/index.ts' -Value 'const app = createApp();' -Encoding UTF8
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
    'bim-review-coordinator/src/index.ts' | Set-Content -LiteralPath $pathsPath -Encoding UTF8
    Assert-Throws {
        & powershell -NoProfile -ExecutionPolicy Bypass -File $checker -BodyPath $bodyPath -ChangedPathsPath $pathsPath -RepoRoot $signalRepo -BaseSha $signalBase -HeadSha $signalHead *> $null
        if ($LASTEXITCODE -ne 0) { throw "checker failed as expected" }
    } 'public route contradicts behavior=no PR body'
} finally {
    Remove-Item -LiteralPath $tempRoot -Recurse -Force
}

Write-Host '[test-pr-body-evidence] all assertions passed'
