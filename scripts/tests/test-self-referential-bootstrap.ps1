[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Assert-True {
    param([Parameter(Mandatory = $true)] $Condition, [Parameter(Mandatory = $true)][string] $Message)
    if (-not $Condition) { throw "ASSERT FAILED: $Message" }
}

function Assert-Throws {
    param(
        [Parameter(Mandatory = $true)][scriptblock] $Action,
        [Parameter(Mandatory = $true)][string] $MessagePattern,
        [Parameter(Mandatory = $true)][string] $Context
    )
    $failed = $false
    try { & $Action } catch {
        $failed = $true
        if ($_.Exception.Message -notmatch $MessagePattern) {
            throw "ASSERT FAILED: $Context threw, but message '$($_.Exception.Message)' does not match '$MessagePattern'."
        }
    }
    Assert-True $failed "$Context was expected to throw."
}

$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../..')).Path
. (Join-Path $repoRoot 'scripts/lib/self-referential-bootstrap.ps1')

$tempRoot = Join-Path $repoRoot "artifacts/tmp/self-referential-bootstrap-$([Guid]::NewGuid().ToString('N'))"
New-Item -ItemType Directory -Path $tempRoot -Force | Out-Null

function Write-Ledger {
    param([Parameter(Mandatory = $true)][string] $Name, [Parameter(Mandatory = $true)][string] $Json)
    $path = Join-Path $tempRoot $Name
    Set-Content -LiteralPath $path -Value $Json -Encoding utf8
    return $path
}

$validOpenEntry = @'
{
  "schema_version": "self-referential-bootstrap-ledger/v1",
  "entries": [
    {
      "id": "remote-linux-deploy-target",
      "status": "open",
      "pr": 500,
      "opened_at": "2026-07-31T08:00:00Z",
      "reason": "the deploy contract only verifies merged origin/main, so a PR changing the deploy path itself cannot obtain deploy-target evidence pre-merge",
      "verification_mechanism_paths": ["scripts/deploy.ps1"],
      "bootstrap_evidence_refs": ["docs/evidence/remote-linux-deploy/self-referential-bootstrap/summary.md"],
      "fixpoint": null
    }
  ]
}
'@

$validClosedEntry = @'
{
  "schema_version": "self-referential-bootstrap-ledger/v1",
  "entries": [
    {
      "id": "remote-linux-deploy-target",
      "status": "closed",
      "pr": 500,
      "opened_at": "2026-07-31T08:00:00Z",
      "reason": "the deploy contract only verifies merged origin/main, so a PR changing the deploy path itself cannot obtain deploy-target evidence pre-merge",
      "verification_mechanism_paths": ["scripts/deploy.ps1"],
      "bootstrap_evidence_refs": ["docs/evidence/remote-linux-deploy/self-referential-bootstrap/summary.md"],
      "fixpoint": {
        "reverified_at": "2026-08-01T08:00:00Z",
        "mechanism_commit": "0123456789abcdef0123456789abcdef01234567",
        "evidence_refs": ["docs/evidence/remote-linux-deploy/fixpoint/summary.md"]
      }
    }
  ]
}
'@

function Invoke-BodyGate {
    param(
        [Parameter(Mandatory = $true)][hashtable] $Rows,
        [Parameter(Mandatory = $true)][string[]] $ChangedPaths,
        [Parameter(Mandatory = $true)][string] $LedgerPath
    )
    Assert-SelfReferentialBootstrapBody -Body 'body' -ChangedPaths $ChangedPaths -LedgerPath $LedgerPath `
        -GetTableValue { param($b, $label) $Rows[$label] }.GetNewClosure()
}

try {
    # --- mechanism path detection -------------------------------------------------
    $matched = Get-SelfReferentialMechanismPaths -ChangedPaths @(
        'scripts/deploy.ps1',
        'scripts/lib/platform/listener-owner.ps1',
        'scripts/dev/rebuild-test-deploy.ps1',
        'scripts/self-referential-bootstrap-ledger.json',
        'web-viewer-sample/src/Window.tsx',
        'docs/agents/self-referential-bootstrap.md'
    )
    Assert-True ($matched.Count -eq 4) "mechanism pattern must match exactly the 4 mechanism paths (matched: $($matched -join ', '))"

    # --- ledger integrity ---------------------------------------------------------
    $realLedger = Get-SelfReferentialBootstrapLedger -Path (Join-Path $repoRoot 'scripts/self-referential-bootstrap-ledger.json')
    Assert-True ($null -ne $realLedger) 'repo ledger must parse and validate'

    $null = Get-SelfReferentialBootstrapLedger -Path (Write-Ledger 'open.json' $validOpenEntry)
    $null = Get-SelfReferentialBootstrapLedger -Path (Write-Ledger 'closed.json' $validClosedEntry)

    Assert-Throws -Context 'malformed json' -MessagePattern 'not valid JSON' -Action {
        Get-SelfReferentialBootstrapLedger -Path (Write-Ledger 'bad.json' '{nope')
    }
    Assert-Throws -Context 'wrong schema version' -MessagePattern 'unsupported schema_version' -Action {
        Get-SelfReferentialBootstrapLedger -Path (Write-Ledger 'ver.json' ($validOpenEntry -replace '/v1', '/v9'))
    }
    Assert-Throws -Context 'open entry with fixpoint' -MessagePattern 'must not carry a fixpoint' -Action {
        Get-SelfReferentialBootstrapLedger -Path (Write-Ledger 'openfp.json' ($validClosedEntry -replace '"status": "closed"', '"status": "open"'))
    }
    Assert-Throws -Context 'closed entry without fixpoint' -MessagePattern 'complete fixpoint record' -Action {
        Get-SelfReferentialBootstrapLedger -Path (Write-Ledger 'closednofp.json' ($validOpenEntry -replace '"status": "open"', '"status": "closed"'))
    }
    Assert-Throws -Context 'short mechanism commit' -MessagePattern '40-hex' -Action {
        Get-SelfReferentialBootstrapLedger -Path (Write-Ledger 'shortsha.json' ($validClosedEntry -replace '0123456789abcdef0123456789abcdef01234567', 'abc123'))
    }
    Assert-Throws -Context 'unlabeled evidence ref' -MessagePattern 'stack kind' -Action {
        Get-SelfReferentialBootstrapLedger -Path (Write-Ledger 'nolabel.json' ($validOpenEntry -replace 'self-referential-bootstrap/summary\.md', 'plain/summary.md'))
    }
    Assert-Throws -Context 'generic reason' -MessagePattern 'reason' -Action {
        Get-SelfReferentialBootstrapLedger -Path (Write-Ledger 'genreason.json' ($validOpenEntry -replace '"reason": "[^"]+"', '"reason": "bootstrap"'))
    }
    Assert-Throws -Context 'duplicate ids' -MessagePattern 'duplicate' -Action {
        $parsed = $validOpenEntry | ConvertFrom-Json
        $parsed.entries = @($parsed.entries[0], $parsed.entries[0])
        Get-SelfReferentialBootstrapLedger -Path (Write-Ledger 'dup.json' ($parsed | ConvertTo-Json -Depth 8))
    }

    # --- body gate ----------------------------------------------------------------
    $emptyLedgerPath = Join-Path $repoRoot 'scripts/self-referential-bootstrap-ledger.json'
    $openLedgerPath = Write-Ledger 'gate-open.json' $validOpenEntry
    $closedLedgerPath = Write-Ledger 'gate-closed.json' $validClosedEntry
    $mechanism = @('scripts/deploy.ps1')
    $harmless = @('web-viewer-sample/src/Window.tsx')
    $goodReason = 'the deploy contract only verifies merged origin/main, so pre-merge deploy-path evidence is unobtainable'

    # non-mechanism PR: no requirements at all, even with open debt
    Invoke-BodyGate -Rows @{} -ChangedPaths $harmless -LedgerPath $openLedgerPath

    Assert-Throws -Context 'mechanism PR without declaration' -MessagePattern 'must declare' -Action {
        Invoke-BodyGate -Rows @{} -ChangedPaths $mechanism -LedgerPath $emptyLedgerPath
    }
    Assert-Throws -Context 'declaration must be yes/no' -MessagePattern 'yes or no' -Action {
        Invoke-BodyGate -Rows @{ 'Self-referential bootstrap' = 'maybe' } -ChangedPaths $mechanism -LedgerPath $emptyLedgerPath
    }

    # declared no + clean ledger → pass
    Invoke-BodyGate -Rows @{ 'Self-referential bootstrap' = 'no' } -ChangedPaths $mechanism -LedgerPath $emptyLedgerPath
    # declared no + closed-only ledger → pass (debt already fixpoint-closed)
    Invoke-BodyGate -Rows @{ 'Self-referential bootstrap' = 'no' } -ChangedPaths $mechanism -LedgerPath $closedLedgerPath

    Assert-Throws -Context 'declared no + open debt' -MessagePattern 'open ledger debt' -Action {
        Invoke-BodyGate -Rows @{ 'Self-referential bootstrap' = 'no' } -ChangedPaths $mechanism -LedgerPath $openLedgerPath
    }

    # declared yes naming its own open entry → pass
    Invoke-BodyGate -Rows @{
        'Self-referential bootstrap' = 'yes'
        'Bootstrap ledger entry' = 'remote-linux-deploy-target'
        'Bootstrap reason' = $goodReason
    } -ChangedPaths $mechanism -LedgerPath $openLedgerPath

    Assert-Throws -Context 'declared yes but entry missing from ledger' -MessagePattern 'does not contain it' -Action {
        Invoke-BodyGate -Rows @{
            'Self-referential bootstrap' = 'yes'
            'Bootstrap ledger entry' = 'some-other-entry'
            'Bootstrap reason' = $goodReason
        } -ChangedPaths $mechanism -LedgerPath $openLedgerPath
    }
    Assert-Throws -Context 'declared yes with generic reason' -MessagePattern 'reason' -Action {
        Invoke-BodyGate -Rows @{
            'Self-referential bootstrap' = 'yes'
            'Bootstrap ledger entry' = 'remote-linux-deploy-target'
            'Bootstrap reason' = 'bootstrap'
        } -ChangedPaths $mechanism -LedgerPath $openLedgerPath
    }
    Assert-Throws -Context 'declared yes naming a closed entry' -MessagePattern 'must be open' -Action {
        Invoke-BodyGate -Rows @{
            'Self-referential bootstrap' = 'yes'
            'Bootstrap ledger entry' = 'remote-linux-deploy-target'
            'Bootstrap reason' = $goodReason
        } -ChangedPaths $mechanism -LedgerPath $closedLedgerPath
    }

    # --- wire-up through the real PR body checker ---------------------------------
    $checker = Join-Path $repoRoot 'scripts/tests/check-pr-body-evidence.ps1'
    $pathsPath = Join-Path $tempRoot 'paths.txt'
    Set-Content -LiteralPath $pathsPath -Value 'scripts/dev/rebuild-test-deploy.ps1' -Encoding utf8

    $baseBody = @'
| Item | Result |
|---|---|
| Change lane | G |
| Behavior contract changed | yes |
| Requirement source | docs/plans |
| Linked issue | docs/plans/remote-linux-test-deploy-target.plan.md |
| CODEOWNERS / owner review | requested |
| GitNexus evidence | detect_changes |
| Browser E2E evidence | not user-facing |
| Agent workflow changed? | no |
| Required checks expected | CI / Agent Governance / PR Metadata Contract |
| Affects runtime / docker / Kit / viewer / ports / env? | yes |
| Canonical deploy path updated? | verified |
| Deploy dry-run command | .\scripts\deploy.ps1 -DryRun |
| Verify command | .\scripts\verify-all.ps1 |
'@
    $bootstrapRows = @'
| Self-referential bootstrap | no |
'@

    $bodyMissing = Join-Path $tempRoot 'body-missing.md'
    Set-Content -LiteralPath $bodyMissing -Value $baseBody -Encoding utf8
    $output = & pwsh -NoProfile -NonInteractive -File $checker -BodyPath $bodyMissing -ChangedPathsPath $pathsPath 2>&1 | Out-String
    Assert-True ($LASTEXITCODE -ne 0) 'checker must fail when a mechanism PR omits the bootstrap declaration'
    Assert-True ($output -match 'Self-referential bootstrap') "checker failure must name the missing label (got: $output)"

    $bodyOk = Join-Path $tempRoot 'body-ok.md'
    Set-Content -LiteralPath $bodyOk -Value ($baseBody + "`n" + $bootstrapRows) -Encoding utf8
    & pwsh -NoProfile -NonInteractive -File $checker -BodyPath $bodyOk -ChangedPathsPath $pathsPath *> $null
    Assert-True ($LASTEXITCODE -eq 0) 'checker must pass when the mechanism PR declares bootstrap=no with a clean ledger'

    Write-Host '[test-self-referential-bootstrap] all assertions passed'
} finally {
    Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
}
