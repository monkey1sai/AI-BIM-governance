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

# 1. The preflight must pass -PrNumber in the SAME Invoke-External -Arguments
#    array that invokes the body checker. Global string searches let an unrelated
#    later invocation satisfy one half of the assertion.
$ast = [System.Management.Automation.Language.Parser]::ParseFile($preflight, [ref]$null, [ref]$null)
$bodyCheckerInvocations = @($ast.FindAll({
    param($node)
    if ($node -isnot [System.Management.Automation.Language.CommandAst] -or
        $node.GetCommandName() -cne 'Invoke-External') { return $false }
    $strings = @($node.FindAll({
        param($child) $child -is [System.Management.Automation.Language.StringConstantExpressionAst]
    }, $true) | ForEach-Object { $_.Value })
    return @($strings | Where-Object { $_ -match '(^|[\\/])scripts[\\/]tests[\\/]check-pr-body-evidence\.ps1$' }).Count -gt 0
}, $true))
Assert-True ($bodyCheckerInvocations.Count -eq 1) "preflight has exactly one body-checker Invoke-External call (got $($bodyCheckerInvocations.Count))"

$commandElements = @($bodyCheckerInvocations[0].CommandElements)
$argumentsIndex = -1
for ($i = 0; $i -lt $commandElements.Count; $i++) {
    if ($commandElements[$i] -is [System.Management.Automation.Language.CommandParameterAst] -and
        $commandElements[$i].ParameterName -ceq 'Arguments') {
        $argumentsIndex = $i
        break
    }
}
Assert-True ($argumentsIndex -ge 0 -and $argumentsIndex -lt ($commandElements.Count - 1)) 'body-checker invocation has an -Arguments value'
$argumentsAst = $commandElements[$argumentsIndex + 1]
Assert-True ($argumentsAst -is [System.Management.Automation.Language.ArrayExpressionAst]) 'body-checker -Arguments value is an explicit array'
$argumentLiterals = @($argumentsAst.FindAll({
    param($node) $node -is [System.Management.Automation.Language.ArrayLiteralAst]
}, $true))
Assert-True ($argumentLiterals.Count -eq 1) 'body-checker -Arguments contains one literal argument sequence'
$argumentLiteral = $argumentLiterals[0]
$forwardedStrings = @($argumentLiteral.FindAll({
    param($node) $node -is [System.Management.Automation.Language.StringConstantExpressionAst]
}, $true) | ForEach-Object { $_.Value })
Assert-True (@($forwardedStrings | Where-Object {
    $_ -match '(^|[\\/])scripts[\\/]tests[\\/]check-pr-body-evidence\.ps1$'
}).Count -eq 1) 'body-checker path is inside this same -Arguments array'

function Test-PrNumberArgumentBinding {
    param([Parameter(Mandatory = $true)][System.Management.Automation.Language.ArrayLiteralAst] $ArrayLiteral)
    $elements = @($ArrayLiteral.Elements)
    for ($i = 0; $i -lt ($elements.Count - 1); $i++) {
        if ($elements[$i] -isnot [System.Management.Automation.Language.StringConstantExpressionAst] -or
            $elements[$i].Value -cne '-PrNumber') { continue }
        $value = $elements[$i + 1]
        if ($value -is [System.Management.Automation.Language.VariableExpressionAst] -and
            $value.VariablePath.UserPath -ceq 'PrNumber') { return $true }
        if ($value -is [System.Management.Automation.Language.ConvertExpressionAst] -and
            $value.Child -is [System.Management.Automation.Language.VariableExpressionAst] -and
            $value.Child.VariablePath.UserPath -ceq 'PrNumber') { return $true }
    }
    return $false
}
Assert-True (Test-PrNumberArgumentBinding -ArrayLiteral $argumentLiteral) `
    'body-checker -PrNumber is directly followed by $PrNumber (optionally cast)'

# Mutation guard: both tokens may exist in one array while the flag is bound to
# another value. Set membership alone must not accept this shape.
$mutantTokens = $null
$mutantErrors = $null
$mutantAst = [System.Management.Automation.Language.Parser]::ParseInput(
    "@('-PrNumber', 0, '-Other', `$PrNumber)", [ref]$mutantTokens, [ref]$mutantErrors)
Assert-True ($mutantErrors.Count -eq 0) 'wrong-binding mutant parses'
$mutantLiteral = @($mutantAst.FindAll({
    param($node) $node -is [System.Management.Automation.Language.ArrayLiteralAst]
}, $true))[0]
Assert-True (-not (Test-PrNumberArgumentBinding -ArrayLiteral $mutantLiteral)) `
    'wrong-binding mutant is rejected even though both tokens exist in the array'

# 2. Behavioral proof: the checker's PR binding only fires when -PrNumber arrives.
. (Join-Path $repoRoot 'scripts/lib/self-referential-bootstrap.ps1')

$tempRoot = Join-Path $repoRoot "artifacts/tmp/preflight-prnumber-$([Guid]::NewGuid().ToString('N'))"
New-Item -ItemType Directory -Path $tempRoot -Force | Out-Null
try {
    $fx = Join-Path $tempRoot 'fx'
    New-Item -ItemType Directory -Path $fx -Force | Out-Null
    function Invoke-FixtureGit {
        param([Parameter(Mandatory = $true)][string[]] $Arguments)
        $output = @(& git -C $fx -c commit.gpgsign=false @Arguments 2>&1)
        if ($LASTEXITCODE -ne 0) {
            throw "fixture git failed: git $($Arguments -join ' '): $($output -join [Environment]::NewLine)"
        }
        return $output
    }
    $null = Invoke-FixtureGit -Arguments @('init', '-q')
    $evidenceRel = 'docs/evidence/x/self-referential-bootstrap/summary.md'
    $evidenceFull = Join-Path $fx $evidenceRel
    New-Item -ItemType Directory -Path (Split-Path $evidenceFull) -Force | Out-Null
    Set-Content -LiteralPath $evidenceFull -Value 'evidence' -Encoding utf8
    $null = Invoke-FixtureGit -Arguments @('add', '-A')
    $null = Invoke-FixtureGit -Arguments @(
        '-c', 'user.email=t@t', '-c', 'user.name=t',
        'commit', '--no-gpg-sign', '-q', '-m', 'evidence')
    $baseSha = ((Invoke-FixtureGit -Arguments @('rev-parse', 'HEAD')) | Out-String).Trim()

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
    # The current gate requires immutable base/head content proof for bootstrap
    # evidence. Keep this test focused on PrNumber forwarding, but supply a
    # complete fixture so its new-entry assertion is independently valid.
    $ledgerRel = 'scripts/self-referential-bootstrap-ledger.json'
    $ledgerPath = Join-Path $fx $ledgerRel
    New-Item -ItemType Directory -Path (Split-Path $ledgerPath) -Force | Out-Null
    Set-Content -LiteralPath $ledgerPath -Value $entryJson -Encoding utf8
    Set-Content -LiteralPath $evidenceFull -Value 'fresh evidence' -Encoding utf8
    $null = Invoke-FixtureGit -Arguments @('add', '-A')
    $null = Invoke-FixtureGit -Arguments @(
        '-c', 'user.email=t@t', '-c', 'user.name=t',
        'commit', '--no-gpg-sign', '-q', '-m', 'fresh bootstrap evidence')
    $headSha = ((Invoke-FixtureGit -Arguments @('rev-parse', 'HEAD')) | Out-String).Trim()

    $rows = @{
        'Self-referential bootstrap' = 'yes'
        'Bootstrap ledger entry' = 'preflight-parity-entry'
        'Bootstrap reason' = 'the deploy contract only verifies merged origin main so pre-merge deploy-path evidence is unobtainable here'
    }
    $getValue = { param($b, $label) $rows[$label] }.GetNewClosure()
    $emptyBase = '{"schema_version":"self-referential-bootstrap-ledger/v1","entries":[]}'
    $changedPaths = @('scripts/deploy.ps1', $evidenceRel)

    # Without PrNumber the binding cannot be checked - the entry's pr=500 is unverified.
    Assert-SelfReferentialBootstrapBody -Body 'b' -ChangedPaths $changedPaths -LedgerPath $ledgerPath `
        -GetTableValue $getValue -BaseLedgerJson $emptyBase -HasBaseContext $true -RepoRoot $fx `
        -BaseSha $baseSha -HeadSha $headSha

    # With a mismatched PrNumber the binding must fail - proving the argument is load-bearing.
    $bound = $false
    try {
        Assert-SelfReferentialBootstrapBody -Body 'b' -ChangedPaths $changedPaths -LedgerPath $ledgerPath `
            -GetTableValue $getValue -BaseLedgerJson $emptyBase -HasBaseContext $true -RepoRoot $fx `
            -BaseSha $baseSha -HeadSha $headSha -PrNumber 501
    } catch {
        $bound = $true
        Assert-True ($_.Exception.Message -match 'must bind to their originating PR') "mismatch names the PR binding (got: $($_.Exception.Message))"
    }
    Assert-True $bound 'a mismatched PrNumber must fail, so forwarding it locally is load-bearing'

    Write-Host '[test-preflight-prnumber-forwarding] all assertions passed'
} finally {
    Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
}
