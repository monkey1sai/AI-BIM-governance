# scripts/tests/test-verify-all.ps1
# Verifies the canonical aggregate verifier's developer and pruned-deployment profiles.

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$verifyScript = Join-Path $repoRoot 'scripts\verify-all.ps1'
. (Join-Path $PSScriptRoot 'test-helpers.ps1')

function Invoke-VerificationPlan {
    param(
        [Parameter(Mandatory = $true)][string] $Profile,
        [Parameter(Mandatory = $true)][string] $RepoRoot,
        [string[]] $AdditionalArguments = @()
    )

    $output = @(& (Get-Command pwsh -ErrorAction Stop).Source -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $verifyScript `
        -Profile $Profile -PlanOnly -RepoRoot $RepoRoot @AdditionalArguments 2>&1)
    return [pscustomobject]@{
        ExitCode = $LASTEXITCODE
        Output = ($output -join "`n")
    }
}

$sandbox = New-TestSandbox -Prefix 'verify-all-profile'
try {
    $developerPlan = Invoke-VerificationPlan -Profile 'Developer' -RepoRoot $repoRoot
    Assert-Equal 0 $developerPlan.ExitCode 'default developer profile plan is available'
    Assert-True ($developerPlan.Output -match '\[PLAN\] profile=developer') 'default profile identifies itself as developer'
    foreach ($target in @(
        'tests \(contracts\+fakes\)',
        'bim-review-coordinator',
        'web-viewer-sample',
        'bim-streaming-server'
    )) {
        Assert-True ($developerPlan.Output -match "\[EXECUTE\] $target") "developer profile retains complete target '$target'"
    }
    foreach ($policyGap in @(
        'bim-review-coordinator \[coordinator-lint\].*not_configured:tooling_absent',
        'bim-review-coordinator \[coordinator-changed-lines\].*not_configured:coverage_instrumentation_absent',
        'web-viewer-sample \[viewer-changed-lines\].*not_configured:coverage_instrumentation_absent'
    )) {
        Assert-True ($developerPlan.Output -match "\[OMIT\] $policyGap") "developer profile exposes policy gap '$policyGap'"
    }
    Assert-True ($developerPlan.Output -notmatch '\[EXECUTE\].*(coordinator-lint|coordinator-changed-lines|viewer-changed-lines)') 'not-configured policies never become no-op executions'

    foreach ($filter in @(
        @{ Arguments = @('-TsOnly'); Expected = @('bim-review-coordinator', 'web-viewer-sample'); Excluded = @('tests \(contracts\+fakes\)', 'bim-streaming-server') },
        @{ Arguments = @('-PyOnly'); Expected = @('tests \(contracts\+fakes\)'); Excluded = @('bim-review-coordinator', 'web-viewer-sample', 'bim-streaming-server') },
        @{ Arguments = @('-StreamingOnly'); Expected = @('bim-streaming-server'); Excluded = @('tests \(contracts\+fakes\)', 'bim-review-coordinator', 'web-viewer-sample') },
        @{ Arguments = @('-TsOnly', '-PyOnly'); Expected = @(); Excluded = @('tests \(contracts\+fakes\)', 'bim-review-coordinator', 'web-viewer-sample', 'bim-streaming-server') }
    )) {
        $filtered = Invoke-VerificationPlan -Profile 'Developer' -RepoRoot $repoRoot -AdditionalArguments $filter.Arguments
        Assert-Equal 0 $filtered.ExitCode "developer filter '$($filter.Arguments -join ' ')' exits zero"
        foreach ($target in $filter.Expected) {
            Assert-True ($filtered.Output -match "\[EXECUTE\] $target") "developer filter retains '$target'"
        }
        foreach ($target in $filter.Excluded) {
            Assert-True ($filtered.Output -notmatch "\[EXECUTE\] $target") "developer filter excludes '$target'"
        }
    }

    $jsonPlan = Invoke-VerificationPlan -Profile 'Developer' -RepoRoot $repoRoot -AdditionalArguments @('-Json')
    Assert-Equal 0 $jsonPlan.ExitCode 'PowerShell JSON plan exits zero'
    Assert-True ($jsonPlan.Output -notmatch '\[PLAN\]|\[EXECUTE\]') 'JSON plan contains no human log prefix'
    $jsonDocument = $jsonPlan.Output | ConvertFrom-Json -Depth 100 -ErrorAction Stop
    $directJson = & (Get-Command node -ErrorAction Stop).Source `
        (Join-Path $repoRoot 'scripts\lib\verification-plan.mjs') `
        '--manifest' (Join-Path $repoRoot 'scripts\verification-manifest.json') `
        '--default-profile' 'developer'
    Assert-Equal 0 $LASTEXITCODE 'direct planner exits zero'
    $directDocument = $directJson | ConvertFrom-Json -Depth 100 -ErrorAction Stop
    Assert-Equal ($directDocument | ConvertTo-Json -Depth 100 -Compress) `
        ($jsonDocument | ConvertTo-Json -Depth 100 -Compress) `
        'PowerShell and direct planner JSON are semantically identical'

    $affectedPlan = Invoke-VerificationPlan -Profile 'Developer' -RepoRoot $repoRoot `
        -AdditionalArguments @('-ChangedPath', 'governance-service/app.py')
    Assert-Equal 0 $affectedPlan.ExitCode 'affected-path plan exits zero'
    foreach ($target in @('tests \(contracts\+fakes\)', 'governance-service', 'secret pattern scan')) {
        Assert-True ($affectedPlan.Output -match "\[EXECUTE\] $target") "affected plan includes '$target'"
    }

    $unknownPlan = Invoke-VerificationPlan -Profile 'Developer' -RepoRoot $repoRoot `
        -AdditionalArguments @('-ChangedPath', 'new-unowned-service/file.xyz')
    Assert-Equal 2 $unknownPlan.ExitCode 'unknown path fails closed with planner exit two'
    Assert-True ($unknownPlan.Output -match 'unknown_path_fail_closed|fail_closed') 'unknown path reports a typed fail-closed reason'

    $deploymentRoot = Join-Path $sandbox 'pruned-deployment'
    foreach ($directory in @(
        'scripts',
        'docs\plans',
        'bim-review-coordinator',
        'web-viewer-sample',
        'bim-streaming-server\scripts\tests'
    )) {
        New-Item -ItemType Directory -Path (Join-Path $deploymentRoot $directory) -Force | Out-Null
    }
    'deploy entrypoint' | Set-Content -LiteralPath (Join-Path $deploymentRoot 'scripts\deploy.ps1') -Encoding ascii
    'retained production design token' | Set-Content -LiteralPath (Join-Path $deploymentRoot 'docs\plans\ai-bim-governance.css') -Encoding ascii
    'streaming contract entrypoint' | Set-Content -LiteralPath (Join-Path $deploymentRoot 'bim-streaming-server\scripts\tests\test-stage-loading-contract.ps1') -Encoding ascii

    $deploymentPlan = Invoke-VerificationPlan -Profile 'Deployment' -RepoRoot $deploymentRoot
    Assert-Equal 0 $deploymentPlan.ExitCode 'deployment profile accepts the intentionally pruned fixture inventory'
    Assert-True ($deploymentPlan.Output -match '\[PLAN\] profile=deployment') 'deployment profile identifies itself explicitly'
    foreach ($target in @(
        'deployment required artifacts',
        'coordinator health',
        'governance health',
        'conversion health',
        'kit manager health',
        'viewer endpoint'
    )) {
        Assert-True ($deploymentPlan.Output -match "\[EXECUTE\] $target") "deployment profile executes retained target '$target'"
    }
    foreach ($target in @(
        'tests \(contracts\+fakes\)',
        'bim-review-coordinator \(full verify\)',
        'web-viewer-sample \(full verify\)',
        'bim-streaming-server stage-loading contract'
    )) {
        Assert-True ($deploymentPlan.Output -match "\[OMIT\] $target") "deployment profile explicitly records authoring-only omission '$target'"
    }

    $verifyShell = Get-Content -LiteralPath (Join-Path $repoRoot 'scripts\verify-all.sh') -Raw
    Assert-True ($verifyShell -match '--profile') 'POSIX verifier mirror accepts an explicit deployment profile'
    Assert-True ($verifyShell -match '--plan-only') 'POSIX verifier mirror publishes the same profile inventory without executing it'
    Assert-True ($verifyShell -match 'verification-runner\.mjs') 'POSIX verifier consumes the shared manifest runner'
    Assert-True ($verifyShell -notmatch '\beval\b') 'POSIX verifier never reconstructs manifest argv through eval'
    Assert-True ($verifyShell -match '\[ -n "\$SUBJECT" \] \|\| \[ -n "\$OUTCOME_OUT" \]') 'POSIX Deployment adapter rejects execution-outcome arguments it cannot forward'

    $runnerSource = Get-Content -LiteralPath (Join-Path $repoRoot 'scripts\lib\verification-runner.mjs') -Raw
    Assert-True ($runnerSource -match 'shell:\s*false') 'shared runner executes argv without a shell'

    Remove-Item -LiteralPath (Join-Path $deploymentRoot 'docs\plans\ai-bim-governance.css') -Force
    $missingArtifactPlan = Invoke-VerificationPlan -Profile 'Deployment' -RepoRoot $deploymentRoot
    Assert-True ($missingArtifactPlan.ExitCode -ne 0) 'deployment profile fails when a production-required retained artifact is missing'
    Assert-True ($missingArtifactPlan.Output -match 'deployment required artifact missing') 'deployment profile reports the missing production-required artifact'

    Write-TestPass 'verify-all profiles'
} catch {
    Write-TestFail 'verify-all profiles' $_.Exception.Message
    throw
} finally {
    Remove-TestSandbox -Path $sandbox
}

exit 0
