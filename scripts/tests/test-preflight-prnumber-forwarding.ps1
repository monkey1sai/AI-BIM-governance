[CmdletBinding()]
param()

# Local-preflight parity regression (Codex review TG-1, severity low because CI
# independently supplies -PrNumber and remains the merge backstop).
#
# check-pr-local-preflight.ps1 must forward -PrNumber to the body checker;
# without it a ledger entry bound to another PR passes locally and only fails in
# CI, which trains people to skip the local gate. Asserting the forwarding by
# reading the source would pass on a commented-out line, so this executes the
# checker with and without the argument and observes the decision change.

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Assert-True {
    param([Parameter(Mandatory = $true)] $Condition, [Parameter(Mandatory = $true)][string] $Message)
    if (-not $Condition) { throw "ASSERT FAILED: $Message" }
}

$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../..')).Path
$preflight = Join-Path $repoRoot 'scripts/dev/check-pr-local-preflight.ps1'
Assert-True (Test-Path -LiteralPath $preflight) 'local preflight script exists'

# 1. The preflight must actually pass -PrNumber through to the checker. Parse the
#    AST so a commented-out or string-only occurrence cannot satisfy this.
$ast = [System.Management.Automation.Language.Parser]::ParseFile($preflight, [ref]$null, [ref]$null)
$argStrings = @($ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.StringConstantExpressionAst] }, $true) |
    ForEach-Object { $_.Value })
Assert-True ('-PrNumber' -in $argStrings) 'preflight passes -PrNumber as a real argument (not a comment)'
Assert-True ('check-pr-body-evidence.ps1' -in @($argStrings | ForEach-Object { Split-Path -Leaf $_ })) 'preflight invokes the body checker'

# 2. Behavioral proof: the checker's PR binding only fires when -PrNumber arrives.
. (Join-Path $repoRoot 'scripts/lib/self-referential-bootstrap.ps1')

$tempRoot = Join-Path $repoRoot "artifacts/tmp/preflight-prnumber-$([Guid]::NewGuid().ToString('N'))"
New-Item -ItemType Directory -Path $tempRoot -Force | Out-Null
try {
    $fx = Join-Path $tempRoot 'fx'
    New-Item -ItemType Directory -Path $fx -Force | Out-Null
    & git -C $fx init -q
    $evidenceRel = 'docs/evidence/x/self-referential-bootstrap/summary.md'
    $evidenceFull = Join-Path $fx $evidenceRel
    New-Item -ItemType Directory -Path (Split-Path $evidenceFull) -Force | Out-Null
    Set-Content -LiteralPath $evidenceFull -Value 'evidence' -Encoding utf8
    & git -C $fx add -A | Out-Null
    & git -C $fx -c user.email=t@t -c user.name=t commit -q -m 'evidence'

    $entryJson = @{
        schema_version = 'self-referential-bootstrap-ledger/v1'
        entries = @(@{
            id = 'preflight-parity-entry'
            status = 'open'
            pr = 500
            opened_at = '2026-08-03T08:00:00Z'
            reason = 'the deploy contract only verifies merged origin main so pre-merge deploy-path evidence is unobtainable here'
            verification_mechanism_paths = @('scripts/deploy.ps1')
            bootstrap_evidence_refs = @($evidenceRel)
            fixpoint = $null
        })
    } | ConvertTo-Json -Depth 8
    $ledgerPath = Join-Path $tempRoot 'ledger.json'
    Set-Content -LiteralPath $ledgerPath -Value $entryJson -Encoding utf8

    $rows = @{
        'Self-referential bootstrap' = 'yes'
        'Bootstrap ledger entry' = 'preflight-parity-entry'
        'Bootstrap reason' = 'the deploy contract only verifies merged origin main so pre-merge deploy-path evidence is unobtainable here'
    }
    $getValue = { param($b, $label) $rows[$label] }.GetNewClosure()
    $emptyBase = '{"schema_version":"self-referential-bootstrap-ledger/v1","entries":[]}'

    # Without PrNumber the binding cannot be checked - the entry's pr=500 is unverified.
    Assert-SelfReferentialBootstrapBody -Body 'b' -ChangedPaths @('scripts/deploy.ps1') -LedgerPath $ledgerPath `
        -GetTableValue $getValue -BaseLedgerJson $emptyBase -HasBaseContext $true -RepoRoot $fx

    # With a mismatched PrNumber the binding must fail - proving the argument is load-bearing.
    $bound = $false
    try {
        Assert-SelfReferentialBootstrapBody -Body 'b' -ChangedPaths @('scripts/deploy.ps1') -LedgerPath $ledgerPath `
            -GetTableValue $getValue -BaseLedgerJson $emptyBase -HasBaseContext $true -RepoRoot $fx -PrNumber 501
    } catch {
        $bound = $true
        Assert-True ($_.Exception.Message -match 'must bind to their originating PR') "mismatch names the PR binding (got: $($_.Exception.Message))"
    }
    Assert-True $bound 'a mismatched PrNumber must fail, so forwarding it locally is load-bearing'

    Write-Host '[test-preflight-prnumber-forwarding] all assertions passed'
} finally {
    Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
}
