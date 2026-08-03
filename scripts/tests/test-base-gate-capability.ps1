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

$tempRoot = Join-Path $repoRoot "artifacts/tmp/base-gate-capability-$([Guid]::NewGuid().ToString('N'))"
New-Item -ItemType Directory -Path $tempRoot -Force | Out-Null

try {
    $fx = Join-Path $tempRoot 'fx'
    New-Item -ItemType Directory -Path $fx -Force | Out-Null
    & git -C $fx init -q
    Copy-Item -LiteralPath $detector -Destination (Join-Path $fx 'detect.sh')

    function Write-File {
        param([string] $Rel, [string] $Content)
        $full = Join-Path $fx $Rel
        New-Item -ItemType Directory -Path (Split-Path $full) -Force | Out-Null
        Set-Content -LiteralPath $full -Value $Content -Encoding utf8
    }
    function Commit-All {
        param([string] $Message)
        & git -C $fx add -A | Out-Null
        & git -C $fx -c user.email=t@t -c user.name=t commit -q -m $Message
        return (& git -C $fx rev-parse HEAD).Trim()
    }
    function Detect {
        param([string] $Sha)
        return (& bash (Join-Path $fx 'detect.sh') $Sha $fx 2>&1 | Out-String).Trim()
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

    # rev5: complete capability
    Write-File 'scripts/tests/check-pr-body-evidence.ps1' ". (Join-Path `$PSScriptRoot '..\lib\self-referential-bootstrap.ps1')`nAssert-SelfReferentialBootstrapBody -Body `$b`n"
    $revComplete = Commit-All 'complete capability'
    Assert-True ((Detect $revComplete) -eq 'complete') "complete capability detected (got: $(Detect $revComplete))"

    # a weakened HEAD must not change the verdict for an earlier complete BASE:
    # that is the whole point of pinning to base.
    Write-File 'scripts/tests/check-pr-body-evidence.ps1' "param()`nWrite-Host 'gutted by the PR'`n"
    Remove-Item -LiteralPath (Join-Path $fx 'scripts/lib/self-referential-bootstrap.ps1') -Force
    $revWeakenedHead = Commit-All 'PR guts the gate'
    Assert-True ((Detect $revComplete) -eq 'complete') 'base verdict is unaffected by a weakened head'
    Assert-True ((Detect $revWeakenedHead) -like 'incomplete:*') 'the weakened head itself would not qualify as a trusted base'

    Write-Host '[test-base-gate-capability] all assertions passed'
} finally {
    Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
}
