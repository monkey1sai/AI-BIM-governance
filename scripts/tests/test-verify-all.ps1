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
        [Parameter(Mandatory = $true)][string] $RepoRoot
    )

    $output = @(& (Get-Command pwsh -ErrorAction Stop).Source -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $verifyScript `
        -Profile $Profile -PlanOnly -RepoRoot $RepoRoot 2>&1)
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
    Assert-True ($developerPlan.Output -notmatch '\[OMIT\]') 'developer profile does not omit its normal contract targets'

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
