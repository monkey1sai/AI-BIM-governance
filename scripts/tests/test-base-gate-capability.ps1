[CmdletBinding()]
param()

# Differential fixture for the base-pinned gate materialization decision
# (Codex review TG-2). Builds real git revisions where base and head differ and
# executes the SAME detection script the workflow calls - no replicated logic.
#
# The regression this locks down: a PR that MODIFIES check-pr-body-evidence.ps1
# while ADDING the bootstrap library used to be classified as "base has the
# gate", so the old base checker ran and the new gate never executed.

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Assert-True {
    param([Parameter(Mandatory = $true)] $Condition, [Parameter(Mandatory = $true)][string] $Message)
    if (-not $Condition) { throw "ASSERT FAILED: $Message" }
}

$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../..')).Path
$detector = Join-Path $repoRoot 'scripts/lib/detect-base-gate-capability.sh'
Assert-True (Test-Path -LiteralPath $detector) 'detection script exists'
$workflow = Get-Content -LiteralPath (Join-Path $repoRoot '.github/workflows/pr-review-agent.yml') -Raw
Assert-True ($workflow -match 'git show "\$BASE_SHA:scripts/lib/detect-base-gate-capability\.sh" > "\$detector"') `
    'workflow materializes the capability detector from BASE'
Assert-True ($workflow -notmatch 'bash scripts/lib/detect-base-gate-capability\.sh') `
    'workflow never executes the checkout/head detector directly'

$tempRoot = Join-Path $repoRoot "artifacts/tmp/base-gate-capability-$([Guid]::NewGuid().ToString('N'))"
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
    Copy-Item -LiteralPath $detector -Destination (Join-Path $fx 'detect.sh')

    function Write-File {
        param([string] $Rel, [string] $Content)
        $full = Join-Path $fx $Rel
        New-Item -ItemType Directory -Path (Split-Path $full) -Force | Out-Null
        Set-Content -LiteralPath $full -Value $Content -Encoding utf8
    }
    function Commit-All {
        param([string] $Message)
        $null = Invoke-FixtureGit -Arguments @('add', '-A')
        $null = Invoke-FixtureGit -Arguments @(
            '-c', 'user.email=t@t', '-c', 'user.name=t',
            'commit', '--no-gpg-sign', '-q', '-m', $Message)
        return ((Invoke-FixtureGit -Arguments @('rev-parse', 'HEAD')) | Out-String).Trim()
    }
    function Detect {
        param([string] $Sha)
        Push-Location -LiteralPath $fx
        try {
            $output = (& bash './detect.sh' $Sha '.' 2>&1 | Out-String).Trim()
            if ($LASTEXITCODE -ne 0) { throw "detector failed for $Sha`: $output" }
            return $output
        } finally {
            Pop-Location
        }
    }
    $canonicalAssertionLine = 'Assert-SelfReferentialBootstrapBody -Body $body -ChangedPaths $changedPaths -LedgerPath (Join-Path $RepoRoot "scripts\self-referential-bootstrap-ledger.json") -GetTableValue { param($b, $label) Get-MarkdownTableValue -Body $b -Label $label } -BaseLedgerJson $baseLedgerJson -BaseLedgerExists $baseLedgerExists -HasBaseContext $hasBootstrapBaseContext -PrNumber $PrNumber -RepoRoot $RepoRoot -BaseSha $BaseSha -HeadSha $HeadSha'
    $realCheckerSource = Get-Content -LiteralPath (Join-Path $repoRoot 'scripts/tests/check-pr-body-evidence.ps1') -Raw
    function Insert-BeforeBootstrapAssertion {
        param(
            [Parameter(Mandatory = $true)][string] $Source,
            [Parameter(Mandatory = $true)][string] $Insertion
        )
        $tokens = $null
        $errors = $null
        $ast = [System.Management.Automation.Language.Parser]::ParseInput(
            $Source, [ref]$tokens, [ref]$errors)
        if ($errors.Count -gt 0) { throw "real checker parse failed: $($errors[0].Message)" }
        $assertions = @($ast.FindAll({
            param($node)
            $node -is [System.Management.Automation.Language.CommandAst] -and
                $node.GetCommandName() -eq 'Assert-SelfReferentialBootstrapBody'
        }, $true))
        if ($assertions.Count -ne 1) {
            throw "expected one real bootstrap assertion, found $($assertions.Count)"
        }
        return $Source.Insert($assertions[0].Extent.StartOffset, "$Insertion`n")
    }

    # rev1: no gate at all (a base predating the mechanism)
    Write-File 'README.md' 'x'
    $revNoGate = Commit-All 'no gate'
    Assert-True ((Detect $revNoGate) -like 'incomplete:*') "base without any gate is incomplete (got: $(Detect $revNoGate))"

    # rev2: THE REGRESSION SHAPE - the checker exists but the bootstrap library
    # and its wiring do not. The old detection called this "complete".
    Write-File 'scripts/tests/check-pr-body-evidence.ps1' "param()`nWrite-Host 'legacy checker'`n"
    $revCheckerOnly = Commit-All 'checker without bootstrap capability'
    $verdict = Detect $revCheckerOnly
    Assert-True ($verdict -like 'incomplete:*') "checker-only base must be incomplete - this is the shipped regression (got: $verdict)"
    Assert-True ($verdict -match 'self-referential-bootstrap\.ps1') "reason names the missing library (got: $verdict)"

    # rev3: library present but the checker never sources it
    Write-File 'scripts/lib/self-referential-bootstrap.ps1' "function Assert-SelfReferentialBootstrapBody { }`n"
    $revUnwired = Commit-All 'library present but unwired'
    $verdict = Detect $revUnwired
    Assert-True ($verdict -like 'incomplete:*') "unwired library must be incomplete (got: $verdict)"
    Assert-True ($verdict -match 'dot-source') "reason names the missing dot-source (got: $verdict)"

    # rev4: sourced but the assertion is never invoked
    Write-File 'scripts/tests/check-pr-body-evidence.ps1' ". (Join-Path `$PSScriptRoot '..\lib\self-referential-bootstrap.ps1')`nWrite-Host 'sourced but never asserts'`n"
    $revSourcedOnly = Commit-All 'sourced but not invoked'
    $verdict = Detect $revSourcedOnly
    Assert-True ($verdict -like 'incomplete:*') "sourced-but-uninvoked must be incomplete (got: $verdict)"
    Assert-True ($verdict -match 'invoke') "reason names the missing invocation (got: $verdict)"

    # rev5: both names exist only in comments/string literals. Text grep called
    # this complete even though neither executable command is present.
    Write-File 'scripts/tests/check-pr-body-evidence.ps1' @'
# . (Join-Path $PSScriptRoot '..\lib\self-referential-bootstrap.ps1')
$bait = 'Assert-SelfReferentialBootstrapBody'
Write-Host $bait
'@
    $revTextOnly = Commit-All 'gate names only in inert text'
    $verdict = Detect $revTextOnly
    Assert-True ($verdict -like 'incomplete:*') "comment/string-only wiring must be incomplete (got: $verdict)"
    Assert-True ($verdict -match 'dot-source') "comment/string-only reason names the missing dot-source (got: $verdict)"

    # rev6: the filename exists only as an argument to a different dot-source;
    # it is not the command target.
    Write-File 'scripts/tests/check-pr-body-evidence.ps1' @'
param([int] $PrNumber)
$wrongLibrary = './unrelated.ps1'
. $wrongLibrary 'self-referential-bootstrap.ps1'
Assert-SelfReferentialBootstrapBody -Body $b -PrNumber $PrNumber
'@
    $revWrongDotSource = Commit-All 'bootstrap filename is only a dot-source argument'
    $verdict = Detect $revWrongDotSource
    Assert-True ($verdict -like 'incomplete:*') "wrong dot-source target must be incomplete (got: $verdict)"
    Assert-True ($verdict -match 'dot-source') "wrong dot-source reason names the missing target (got: $verdict)"

    # A same-named decoy is not the trusted bootstrap library. Filename-only
    # matching accepted this shape even though the canonical library was unused.
    Write-File 'scripts/tests/check-pr-body-evidence.ps1' @'
param([int] $PrNumber)
. (Join-Path $PSScriptRoot '..\decoy\self-referential-bootstrap.ps1')
Assert-SelfReferentialBootstrapBody -Body $body -PrNumber $PrNumber
'@
    $revDecoyDotSource = Commit-All 'checker dot-sources a same-named decoy library'
    $verdict = Detect $revDecoyDotSource
    Assert-True ($verdict -like 'incomplete:*') "same-named decoy dot-source must be incomplete (got: $verdict)"
    Assert-True ($verdict -match 'dot-source') "decoy dot-source reason names the missing trusted target (got: $verdict)"

    # rev7: the library is really sourced, but the assertion name is still only
    # inert text; this isolates the second AST requirement.
    Write-File 'scripts/tests/check-pr-body-evidence.ps1' @'
. (Join-Path $PSScriptRoot '..\lib\self-referential-bootstrap.ps1')
$bait = 'Assert-SelfReferentialBootstrapBody'
Write-Host $bait
'@
    $revAssertionTextOnly = Commit-All 'assertion name only in inert text'
    $verdict = Detect $revAssertionTextOnly
    Assert-True ($verdict -like 'incomplete:*') "string-only assertion must be incomplete (got: $verdict)"
    Assert-True ($verdict -match 'invoke') "string-only assertion reason names the missing invocation (got: $verdict)"

    # A root function definition after the real library load can shadow the
    # imported assertion while retaining the expected command spelling.
    Write-File 'scripts/tests/check-pr-body-evidence.ps1' @'
param([int] $PrNumber)
. (Join-Path $PSScriptRoot '..\lib\self-referential-bootstrap.ps1')
function script:Assert-SelfReferentialBootstrapBody { }
Assert-SelfReferentialBootstrapBody -Body $b -PrNumber $PrNumber
'@
    $revShadowedAssertion = Commit-All 'bootstrap assertion shadowed after library load'
    $verdict = Detect $revShadowedAssertion
    Assert-True ($verdict -like 'incomplete:*') "shadowed assertion must be incomplete (got: $verdict)"
    Assert-True ($verdict -match 'shadows the bootstrap assertion') "shadowed assertion reason names shadowing (got: $verdict)"

    $assertionMutations = @(
        'Set-Alias Assert-SelfReferentialBootstrapBody Invoke-Fake',
        'New-Alias -Name Assert-SelfReferentialBootstrapBody -Value Invoke-Fake',
        'Set-Alias -Scope Script Assert-SelfReferentialBootstrapBody Invoke-Fake',
        'New-Alias -Scope Script Assert-SelfReferentialBootstrapBody Invoke-Fake',
        'Set-Alias -Name:Assert-SelfReferentialBootstrapBody -Value Invoke-Fake',
        'Microsoft.PowerShell.Utility\Set-Alias Assert-SelfReferentialBootstrapBody Invoke-Fake',
        'Set-Item function:Assert-SelfReferentialBootstrapBody { param() }',
        'Set-Item -Path function:\script:Assert-SelfReferentialBootstrapBody -Value { param() }',
        'Set-Item Alias:Assert-SelfReferentialBootstrapBody Invoke-Fake',
        'Microsoft.PowerShell.Management\Set-Item Alias:Assert-SelfReferentialBootstrapBody Invoke-Fake',
        'Set-Item -LiteralPath Alias:\script:Assert-SelfReferentialBootstrapBody -Value Invoke-Fake',
        'New-Item Alias:Assert-SelfReferentialBootstrapBody -Value Invoke-Fake',
        'Microsoft.PowerShell.Management\New-Item Alias:Assert-SelfReferentialBootstrapBody -Value Invoke-Fake',
        'Set-Content Function:Assert-SelfReferentialBootstrapBody -Value ''param()''',
        'Microsoft.PowerShell.Management\Set-Content Function:Assert-SelfReferentialBootstrapBody -Value ''param()''',
        'Copy-Item Function:Invoke-Fake Function:Assert-SelfReferentialBootstrapBody -Force',
        'cp Function:Invoke-Fake Function:Assert-SelfReferentialBootstrapBody -Force',
        'Rename-Item Function:Invoke-Fake Assert-SelfReferentialBootstrapBody',
        'rni Function:Invoke-Fake Assert-SelfReferentialBootstrapBody',
        ('$name = "Assert-SelfReferentialBootstrapBody"' + "`n" + 'Set-Alias -Name $name -Value Invoke-Fake')
    )
    foreach ($mutation in $assertionMutations) {
        $checkerSource = "param([int] `$PrNumber)`n. (Join-Path `$PSScriptRoot '..\lib\self-referential-bootstrap.ps1')`n$mutation`n$canonicalAssertionLine`n"
        Write-File 'scripts/tests/check-pr-body-evidence.ps1' $checkerSource
        $revMutationShadow = Commit-All 'bootstrap assertion rebound before invocation'
        $verdict = Detect $revMutationShadow
        Assert-True ($verdict -like 'incomplete:*') "assertion rebinding must be incomplete (got: $verdict; mutation: $mutation)"
        Assert-True ($verdict -match 'shadows the bootstrap assertion') "assertion rebinding reason names shadowing (got: $verdict)"
    }

    Write-File 'scripts/tests/check-pr-body-evidence.ps1' "param([int] `$PrNumber)`nSet-Alias Assert-SelfReferentialBootstrapBody Invoke-Fake`n. (Join-Path `$PSScriptRoot '..\lib\self-referential-bootstrap.ps1')`n$canonicalAssertionLine`n"
    $revAliasBeforeDotSource = Commit-All 'assertion alias precedes library load'
    $verdict = Detect $revAliasBeforeDotSource
    Assert-True ($verdict -like 'incomplete:*') "alias before dot-source must remain incomplete (got: $verdict)"
    Assert-True ($verdict -match 'shadows the bootstrap assertion') "alias-before-dot-source reason names shadowing (got: $verdict)"

    Write-File 'scripts/tests/check-pr-body-evidence.ps1' "param([int] `$PrNumber)`nSet-Item Alias:Assert-SelfReferentialBootstrapBody Invoke-Fake`n. (Join-Path `$PSScriptRoot '..\lib\self-referential-bootstrap.ps1')`n$canonicalAssertionLine`n"
    $revProviderAliasBeforeDotSource = Commit-All 'assertion provider alias precedes library load'
    $verdict = Detect $revProviderAliasBeforeDotSource
    Assert-True ($verdict -like 'incomplete:*') "provider alias before dot-source must remain incomplete (got: $verdict)"
    Assert-True ($verdict -match 'shadows the bootstrap assertion') "provider-alias-before-dot-source reason names shadowing (got: $verdict)"

    $unrelatedAliasSource = Insert-BeforeBootstrapAssertion -Source $realCheckerSource -Insertion 'Set-Alias UnrelatedAlias Invoke-Fake'
    Write-File 'scripts/tests/check-pr-body-evidence.ps1' $unrelatedAliasSource
    $revUnrelatedAlias = Commit-All 'unrelated alias does not shadow gate'
    Assert-True ((Detect $revUnrelatedAlias) -eq 'complete') "unrelated literal alias remains complete (got: $(Detect $revUnrelatedAlias))"

    # rev8: syntactically real commands in an unreachable branch or uncalled
    # function are not executable checker wiring.
    Write-File 'scripts/tests/check-pr-body-evidence.ps1' @'
param([int] $PrNumber)
if ($false) {
    . (Join-Path $PSScriptRoot '..\lib\self-referential-bootstrap.ps1')
    Assert-SelfReferentialBootstrapBody -Body $b -PrNumber $PrNumber
}
function Invoke-InertGate {
    . (Join-Path $PSScriptRoot '..\lib\self-referential-bootstrap.ps1')
    Assert-SelfReferentialBootstrapBody -Body $b -PrNumber $PrNumber
}
'@
    $revUnreachable = Commit-All 'gate wiring exists only in unreachable scopes'
    $verdict = Detect $revUnreachable
    Assert-True ($verdict -like 'incomplete:*') "unreachable gate wiring must be incomplete (got: $verdict)"
    Assert-True ($verdict -match 'dot-source') "unreachable wiring reason names the missing root dot-source (got: $verdict)"

    # rev9: the assertion cannot run before the command that defines it.
    Write-File 'scripts/tests/check-pr-body-evidence.ps1' @'
param([int] $PrNumber)
Assert-SelfReferentialBootstrapBody -Body $b -PrNumber $PrNumber
. (Join-Path $PSScriptRoot '..\lib\self-referential-bootstrap.ps1')
'@
    $revReversedWiring = Commit-All 'assertion precedes library dot-source'
    $verdict = Detect $revReversedWiring
    Assert-True ($verdict -like 'incomplete:*') "reversed gate wiring must be incomplete (got: $verdict)"
    Assert-True ($verdict -match 'before dot-sourcing') "reversed wiring reason names ordering (got: $verdict)"

    # rev10: root-level early termination makes later root commands unreachable.
    Write-File 'scripts/tests/check-pr-body-evidence.ps1' @'
param([int] $PrNumber)
exit 0
. (Join-Path $PSScriptRoot '..\lib\self-referential-bootstrap.ps1')
Assert-SelfReferentialBootstrapBody -Body $body -ChangedPaths $changedPaths -LedgerPath (Join-Path $RepoRoot "scripts\self-referential-bootstrap-ledger.json") -GetTableValue { param($b, $label) Get-MarkdownTableValue -Body $b -Label $label } -BaseLedgerJson $baseLedgerJson -BaseLedgerExists $baseLedgerExists -HasBaseContext $hasBootstrapBaseContext -PrNumber $PrNumber -RepoRoot $RepoRoot -BaseSha $BaseSha -HeadSha $HeadSha
'@
    $revEarlyExit = Commit-All 'checker exits before invoking gate'
    $verdict = Detect $revEarlyExit
    Assert-True ($verdict -like 'incomplete:*') "root early-exit wiring must be incomplete (got: $verdict)"
    Assert-True ($verdict -match 'terminate at root') "root early-exit reason names termination (got: $verdict)"

    # rev11: a directly invoked nested script block can terminate the process.
    Write-File 'scripts/tests/check-pr-body-evidence.ps1' @'
param([int] $PrNumber)
& { exit 0 }
. (Join-Path $PSScriptRoot '..\lib\self-referential-bootstrap.ps1')
Assert-SelfReferentialBootstrapBody -Body $body -ChangedPaths $changedPaths -LedgerPath (Join-Path $RepoRoot "scripts\self-referential-bootstrap-ledger.json") -GetTableValue { param($b, $label) Get-MarkdownTableValue -Body $b -Label $label } -BaseLedgerJson $baseLedgerJson -BaseLedgerExists $baseLedgerExists -HasBaseContext $hasBootstrapBaseContext -PrNumber $PrNumber -RepoRoot $RepoRoot -BaseSha $BaseSha -HeadSha $HeadSha
'@
    $revInvokedExit = Commit-All 'invoked scriptblock exits before gate'
    $verdict = Detect $revInvokedExit
    Assert-True ($verdict -like 'incomplete:*') "invoked early-exit block must be incomplete (got: $verdict)"
    Assert-True ($verdict -match 'terminate at root') "invoked early-exit reason names termination (got: $verdict)"

    # rev12/13: assignment/subexpression wrappers still execute nested exits.
    foreach ($wrappedExit in @('$null = & { exit 0 }', '$x = $(exit 0)')) {
        Write-File 'scripts/tests/check-pr-body-evidence.ps1' "param([int] `$PrNumber)`n$wrappedExit`n. (Join-Path `$PSScriptRoot '..\lib\self-referential-bootstrap.ps1')`n$canonicalAssertionLine`n"
        $revWrappedExit = Commit-All 'wrapped exit before gate'
        $verdict = Detect $revWrappedExit
        Assert-True ($verdict -like 'incomplete:*') "wrapped early exit must be incomplete (got: $verdict)"
        Assert-True ($verdict -match 'terminate at root') "wrapped early-exit reason names termination (got: $verdict)"
    }

    # A function definition is inert, but a direct root invocation of a local
    # function containing exit 0 terminates the checker before the gate.
    foreach ($functionTerminator in @('exit 0', 'break', 'continue')) {
        Write-File 'scripts/tests/check-pr-body-evidence.ps1' "param([int] `$PrNumber)`nfunction Stop-Gate { $functionTerminator }`nstop-gate`n. (Join-Path `$PSScriptRoot '..\lib\self-referential-bootstrap.ps1')`n$canonicalAssertionLine`n"
        $revCalledFunctionTerminator = Commit-All 'called local function terminates before gate'
        $verdict = Detect $revCalledFunctionTerminator
        Assert-True ($verdict -like 'incomplete:*') "called function $functionTerminator must be incomplete (got: $verdict)"
        Assert-True ($verdict -match 'terminate at root') "called function $functionTerminator reason names termination (got: $verdict)"
    }

    foreach ($functionScope in @('script:', 'global:')) {
        Write-File 'scripts/tests/check-pr-body-evidence.ps1' "param([int] `$PrNumber)`nfunction ${functionScope}Stop-Gate { exit 0 }`nStop-Gate`n. (Join-Path `$PSScriptRoot '..\lib\self-referential-bootstrap.ps1')`n$canonicalAssertionLine`n"
        $revScopedFunctionExit = Commit-All 'called scope-qualified function exits before gate'
        $verdict = Detect $revScopedFunctionExit
        Assert-True ($verdict -like 'incomplete:*') "called ${functionScope}function exit must be incomplete (got: $verdict)"
        Assert-True ($verdict -match 'terminate at root') "called ${functionScope}function exit reason names termination (got: $verdict)"
    }

    # Explicit root/direct wrappers around throw also make the checker unusable;
    # conditional validation throws remain allowed.
    foreach ($earlyThrow in @("throw 'stop'", "`$null = `$(throw 'stop')")) {
        Write-File 'scripts/tests/check-pr-body-evidence.ps1' "param([int] `$PrNumber)`n$earlyThrow`n. (Join-Path `$PSScriptRoot '..\lib\self-referential-bootstrap.ps1')`n$canonicalAssertionLine`n"
        $revEarlyThrow = Commit-All 'explicit throw before gate'
        $verdict = Detect $revEarlyThrow
        Assert-True ($verdict -like 'incomplete:*') "explicit early throw must be incomplete (got: $verdict)"
        Assert-True ($verdict -match 'terminate at root') "explicit early-throw reason names termination (got: $verdict)"
    }

    # Bare loop-control statements also stop a root script with exit 0.
    foreach ($terminal in @('break', 'continue')) {
        Write-File 'scripts/tests/check-pr-body-evidence.ps1' "param([int] `$PrNumber)`n$terminal`n. (Join-Path `$PSScriptRoot '..\lib\self-referential-bootstrap.ps1')`n$canonicalAssertionLine`n"
        $revLoopControl = Commit-All "$terminal before gate"
        $verdict = Detect $revLoopControl
        Assert-True ($verdict -like 'incomplete:*') "root $terminal must be incomplete (got: $verdict)"
        Assert-True ($verdict -match 'terminate at root') "root $terminal reason names termination (got: $verdict)"
    }

    # rev16: an unbound assertion before exit cannot hide that the only bound
    # assertion is unreachable.
    Write-File 'scripts/tests/check-pr-body-evidence.ps1' @'
param([int] $PrNumber)
. (Join-Path $PSScriptRoot '..\lib\self-referential-bootstrap.ps1')
Assert-SelfReferentialBootstrapBody -Body $b -PrNumber 0
exit 0
Assert-SelfReferentialBootstrapBody -Body $body -ChangedPaths $changedPaths -LedgerPath (Join-Path $RepoRoot "scripts\self-referential-bootstrap-ledger.json") -GetTableValue { param($b, $label) Get-MarkdownTableValue -Body $b -Label $label } -BaseLedgerJson $baseLedgerJson -BaseLedgerExists $baseLedgerExists -HasBaseContext $hasBootstrapBaseContext -PrNumber $PrNumber -RepoRoot $RepoRoot -BaseSha $BaseSha -HeadSha $HeadSha
'@
    $revBoundAfterExit = Commit-All 'bound assertion follows early exit'
    $verdict = Detect $revBoundAfterExit
    Assert-True ($verdict -like 'incomplete:*') "bound assertion after exit must be incomplete (got: $verdict)"
    Assert-True ($verdict -match 'terminate at root') "bound-after-exit reason names termination (got: $verdict)"

    # rev17: the assertion contains both tokens, but -PrNumber is bound to 0 and
    # $PrNumber appears only in an unrelated argument.
    Write-File 'scripts/tests/check-pr-body-evidence.ps1' @'
param([int] $PrNumber)
. (Join-Path $PSScriptRoot '..\lib\self-referential-bootstrap.ps1')
Assert-SelfReferentialBootstrapBody -Body $b -PrNumber 0 -GetTableValue { $PrNumber }
'@
    $revWrongPrBinding = Commit-All 'PrNumber tokens are not an argument binding'
    $verdict = Detect $revWrongPrBinding
    Assert-True ($verdict -like 'incomplete:*') "wrong PrNumber value must be incomplete (got: $verdict)"
    Assert-True ($verdict -match 'PrNumber') "wrong PrNumber binding reason names PrNumber (got: $verdict)"

    # A syntactically bound variable is not trustworthy if the checker overwrites
    # the workflow-injected parameter before invoking the assertion.
    Write-File 'scripts/tests/check-pr-body-evidence.ps1' @'
param([int] $PrNumber)
$PrNumber = 0
. (Join-Path $PSScriptRoot '..\lib\self-referential-bootstrap.ps1')
Assert-SelfReferentialBootstrapBody -Body $body -ChangedPaths $changedPaths -LedgerPath (Join-Path $RepoRoot "scripts\self-referential-bootstrap-ledger.json") -GetTableValue { param($b, $label) Get-MarkdownTableValue -Body $b -Label $label } -BaseLedgerJson $baseLedgerJson -BaseLedgerExists $baseLedgerExists -HasBaseContext $hasBootstrapBaseContext -PrNumber $PrNumber -RepoRoot $RepoRoot -BaseSha $BaseSha -HeadSha $HeadSha
'@
    $revReassignedPrNumber = Commit-All 'PrNumber parameter reassigned before gate'
    $verdict = Detect $revReassignedPrNumber
    Assert-True ($verdict -like 'incomplete:*') "reassigned PrNumber must be incomplete (got: $verdict)"
    Assert-True ($verdict -match 'reassigns the PrNumber') "reassigned PrNumber reason names mutation (got: $verdict)"

    # rev18: the body appears bound but the checker cannot accept workflow CLI
    # -PrNumber because it has no root parameter declaration.
    Write-File 'scripts/tests/check-pr-body-evidence.ps1' @'
. (Join-Path $PSScriptRoot '..\lib\self-referential-bootstrap.ps1')
Assert-SelfReferentialBootstrapBody -Body $b -PrNumber $PrNumber
'@
    $revMissingPrParameter = Commit-All 'checker has no PrNumber CLI parameter'
    $verdict = Detect $revMissingPrParameter
    Assert-True ($verdict -like 'incomplete:*') "checker without PrNumber parameter must be incomplete (got: $verdict)"
    Assert-True ($verdict -match 'PrNumber parameter') "missing parameter reason names PrNumber (got: $verdict)"

    # rev19: the assertion exists but does not receive the current PR number.
    Write-File 'scripts/tests/check-pr-body-evidence.ps1' ". (Join-Path `$PSScriptRoot '..\lib\self-referential-bootstrap.ps1')`nAssert-SelfReferentialBootstrapBody -Body `$b`n"
    $revUnboundPr = Commit-All 'assertion lacks PR binding'
    $verdict = Detect $revUnboundPr
    Assert-True ($verdict -like 'incomplete:*') "assertion without PrNumber binding must be incomplete (got: $verdict)"
    Assert-True ($verdict -match 'PrNumber') "unbound assertion reason names PrNumber (got: $verdict)"

    # A complete capability requires the real assertion's mandatory inputs and
    # load-bearing base/head context on the same command, not merely its name.
    $requiredBindingFragments = @(
        ' -Body $body',
        ' -ChangedPaths $changedPaths',
        ' -LedgerPath (Join-Path $RepoRoot "scripts\self-referential-bootstrap-ledger.json")',
        ' -GetTableValue { param($b, $label) Get-MarkdownTableValue -Body $b -Label $label }',
        ' -BaseLedgerJson $baseLedgerJson',
        ' -BaseLedgerExists $baseLedgerExists',
        ' -HasBaseContext $hasBootstrapBaseContext',
        ' -RepoRoot $RepoRoot',
        ' -BaseSha $BaseSha',
        ' -HeadSha $HeadSha'
    )
    foreach ($fragment in $requiredBindingFragments) {
        $mutantAssertion = $canonicalAssertionLine.Replace($fragment, '')
        Write-File 'scripts/tests/check-pr-body-evidence.ps1' "param([int] `$PrNumber)`n. (Join-Path `$PSScriptRoot '..\lib\self-referential-bootstrap.ps1')`n$mutantAssertion`n"
        $revMissingRequiredBinding = Commit-All 'assertion lacks required direct binding'
        $verdict = Detect $revMissingRequiredBinding
        Assert-True ($verdict -like 'incomplete:*') "missing required binding must be incomplete (got: $verdict; fragment: $fragment)"
        Assert-True ($verdict -match 'required bootstrap assertion argument bindings') "missing binding reason names required arguments (got: $verdict)"
    }

    foreach ($mutantAssertion in @(
        $canonicalAssertionLine.Replace('-ChangedPaths $changedPaths', '-Other $changedPaths'),
        $canonicalAssertionLine.Replace('(Join-Path $RepoRoot "scripts\self-referential-bootstrap-ledger.json")', '(Join-Path $PSScriptRoot "scripts\self-referential-bootstrap-ledger.json")'),
        $canonicalAssertionLine.Replace('(Join-Path $RepoRoot "scripts\self-referential-bootstrap-ledger.json")', '(Join-Path $RepoRoot "ledger.json")'),
        $canonicalAssertionLine.Replace('Join-Path $RepoRoot', 'Evil.Module\Join-Path $RepoRoot'),
        $canonicalAssertionLine.Replace('-GetTableValue { param($b, $label) Get-MarkdownTableValue -Body $b -Label $label }', '-GetTableValue $null'),
        $canonicalAssertionLine.Replace('{ param($b, $label) Get-MarkdownTableValue -Body $b -Label $label }', '{ param($b, $label) ''no'' }'),
        $canonicalAssertionLine.Replace('{ param($b, $label) Get-MarkdownTableValue -Body $b -Label $label }', '{ param($b, $label) Get-MarkdownTableValue -Body $label -Label $b }'),
        $canonicalAssertionLine.Replace('Get-MarkdownTableValue -Body $b', 'Evil.Module\Get-MarkdownTableValue -Body $b')
    )) {
        Write-File 'scripts/tests/check-pr-body-evidence.ps1' "param([int] `$PrNumber)`n. (Join-Path `$PSScriptRoot '..\lib\self-referential-bootstrap.ps1')`n$mutantAssertion`n"
        $revWrongRequiredBinding = Commit-All 'assertion required binding has wrong shape'
        $verdict = Detect $revWrongRequiredBinding
        Assert-True ($verdict -like 'incomplete:*') "wrong required binding shape must be incomplete (got: $verdict)"
        Assert-True ($verdict -match 'required bootstrap assertion argument bindings') "wrong binding reason names required arguments (got: $verdict)"
    }

    # Regression for L1-COR-002: named arguments alone are insufficient when
    # the checker reads a dummy ledger and never forwards the real body table.
    $dummyAssertionLine = 'Assert-SelfReferentialBootstrapBody -Body $body -ChangedPaths $changedPaths -LedgerPath (Join-Path $PSScriptRoot "ledger.json") -GetTableValue { param($body, $label) $null } -BaseLedgerJson $baseLedgerJson -BaseLedgerExists $baseLedgerExists -HasBaseContext $hasBootstrapBaseContext -PrNumber $PrNumber -RepoRoot $RepoRoot -BaseSha $BaseSha -HeadSha $HeadSha'
    Write-File 'scripts/tests/check-pr-body-evidence.ps1' "param([int] `$PrNumber)`n. (Join-Path `$PSScriptRoot '..\lib\self-referential-bootstrap.ps1')`n$dummyAssertionLine`n"
    $revDummyBindings = Commit-All 'checker uses dummy ledger and table accessor'
    $verdict = Detect $revDummyBindings
    Assert-True ($verdict -like 'incomplete:*') "dummy ledger/accessor must be incomplete (got: $verdict)"
    Assert-True ($verdict -match 'required bootstrap assertion argument bindings') "dummy binding reason names required arguments (got: $verdict)"

    # Regression for TG-004: canonical argument names do not help if the checker
    # rebinds those variables, their input paths, or their base/head context
    # before the assertion. Start from the complete real checker so every mutant
    # isolates provenance rather than failing an earlier wiring requirement.
    $inputProvenanceMutations = @(
        '$body = ''forged body''',
        '$changedPaths = @()',
        '$ChangedPathsPath = ''forged-paths.txt''',
        '$pathText = ''''',
        '$RepoRoot = $PSScriptRoot',
        '$BaseSha = ''deadbeef''',
        '$HeadSha = ''''',
        '$hasBootstrapBaseContext = $false',
        '$baseLedgerJson = ''{}''',
        '$baseLedgerExists = $false',
        'if ($true) { $baseLedgerJson = ''{}'' }',
        'Set-Variable -Name changedPaths -Value @()',
        'Set-Item -LiteralPath Variable:baseLedgerExists -Value $false',
        'if ($true) { Copy-Item -LiteralPath Variable:source -Destination Variable:changedPaths -Force }',
        'if ($true) { New-Item -Path Variable:changedPaths -Value @() -Force }',
        'if ($true) { Rename-Item -Path Variable:source -NewName changedPaths }',
        '(Get-Variable -Name changedPaths).Value = @()',
        '$ExecutionContext.SessionState.PSVariable.Set(''changedPaths'', @())',
        '($ExecutionContext.SessionState.PSVariable).Set(''changedPaths'', @())',
        '($ExecutionContext.SessionState.PSVariable).Remove(''changedPaths'')',
        '$ExecutionContext.SessionState.(''PSVariable'').Set(''changedPaths'', @())',
        '$psv = $ExecutionContext.SessionState.PSVariable; $psv.Set(''changedPaths'', @())',
        '$psv = $ExecutionContext.SessionState.PSVariable; $psv.(''S'' + ''et'')(''changedPaths'', @())',
        '$PrNumber++'
    )
    foreach ($mutation in $inputProvenanceMutations) {
        $mutantSource = Insert-BeforeBootstrapAssertion -Source $realCheckerSource -Insertion $mutation
        Write-File 'scripts/tests/check-pr-body-evidence.ps1' $mutantSource
        $revInputRebind = Commit-All 'checker rebinds a load-bearing bootstrap input'
        $verdict = Detect $revInputRebind
        Assert-True ($verdict -like 'incomplete:*') `
            "load-bearing input mutation must be incomplete (got: $verdict; mutation: $mutation)"
        Assert-True ($verdict -match 'trusted provenance') `
            "input mutation reason names trusted provenance (got: $verdict; mutation: $mutation)"
    }

    # Run the detector against the repository's real checker source inside the
    # standalone fixture. WSL Git cannot follow this linked worktree's Windows
    # absolute .git pointer, so a direct `detect HEAD .` smoke is not portable.
    Write-File 'scripts/tests/check-pr-body-evidence.ps1' $realCheckerSource
    $revRealChecker = Commit-All 'real checker capability'
    Assert-True ((Detect $revRealChecker) -eq 'complete') "real repository checker detected as complete (got: $(Detect $revRealChecker))"

    # a weakened HEAD must not change the verdict for an earlier complete BASE:
    # that is the whole point of pinning to base.
    Write-File 'scripts/tests/check-pr-body-evidence.ps1' "param()`nWrite-Host 'gutted by the PR'`n"
    Remove-Item -LiteralPath (Join-Path $fx 'scripts/lib/self-referential-bootstrap.ps1') -Force
    $revWeakenedHead = Commit-All 'PR guts the gate'
    Assert-True ((Detect $revRealChecker) -eq 'complete') 'base verdict is unaffected by a weakened head'
    Assert-True ((Detect $revWeakenedHead) -like 'incomplete:*') 'the weakened head itself would not qualify as a trusted base'

    # Differential provenance fixture for the workflow's materialization shape:
    # a malicious head detector must not influence the script extracted from base.
    Write-File 'scripts/lib/detect-base-gate-capability.sh' "#!/bin/bash`necho base-detector`n"
    $provenanceBase = Commit-All 'trusted base detector'
    Write-File 'scripts/lib/detect-base-gate-capability.sh' "#!/bin/bash`necho head-detector`n"
    $null = Commit-All 'malicious head detector'
    $baseDetector = Invoke-FixtureGit -Arguments @(
        'show', "${provenanceBase}:scripts/lib/detect-base-gate-capability.sh")
    Set-Content -LiteralPath (Join-Path $fx 'materialized-base-detector.sh') `
        -Value (($baseDetector -join "`n") + "`n") -Encoding utf8 -NoNewline
    Push-Location -LiteralPath $fx
    try {
        $provenanceVerdict = (& bash './materialized-base-detector.sh' 2>&1 | Out-String).Trim()
        if ($LASTEXITCODE -ne 0) { throw "materialized base detector failed: $provenanceVerdict" }
    } finally {
        Pop-Location
    }
    Assert-True ($provenanceVerdict -eq 'base-detector') `
        "base materialization ignores malicious head detector (got: $provenanceVerdict)"

    Write-Host '[test-base-gate-capability] all assertions passed'
} finally {
    Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
}
