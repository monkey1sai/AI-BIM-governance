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
| Linked issue | #123 |
| Requirement source | docs/plans/docs-plans-README.md |
| CODEOWNERS / owner review | requested |
| GitNexus evidence | detect_changes |
| gstack evidence | screenshot |
| Agent workflow changed? | yes, rollback by reverting workflow |
| Required checks expected | CI / Agent Governance / PR Review Agent |

## Frontend Verification

| Item | Result |
|---|---|
| Frontend route | /ui#a1 |
| Main button(s) tested | Run governance |
| Fixture used | storage fixture |
| Backend API called | /api/governance/runs |
| Runtime action | none |
| Visible success state | Success toast and issue row |
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

    @'
## Summary

- Missing evidence.

## AI Coding Governance

| Item | Result |
|---|---|
| Linked issue |  |
| Requirement source |  |
| CODEOWNERS / owner review |  |
| GitNexus evidence |  |
| gstack evidence |  |
| Agent workflow changed? |  |
| Required checks expected |  |
'@ | Set-Content -LiteralPath $bodyPath -Encoding UTF8

    'AGENTS.md' | Set-Content -LiteralPath $pathsPath -Encoding UTF8
    Assert-Throws {
        & powershell -NoProfile -ExecutionPolicy Bypass -File $checker -BodyPath $bodyPath -ChangedPathsPath $pathsPath *> $null
        if ($LASTEXITCODE -ne 0) { throw "checker failed as expected" }
    } 'empty governance fields fail'
} finally {
    Remove-Item -LiteralPath $tempRoot -Recurse -Force
}

Write-Host '[test-pr-body-evidence] all assertions passed'
