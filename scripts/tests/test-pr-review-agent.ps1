[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot '..\lib\pr-review-agent.ps1')

function Assert-True {
    param([Parameter(Mandatory = $true)] $Condition, [Parameter(Mandatory = $true)][string] $Message)
    if ($Condition -is [array]) {
        $Condition = ($Condition.Count -gt 0 -and -not ($Condition -contains $false))
    }
    if (-not $Condition) { throw "ASSERT FAILED: $Message" }
}

function New-TestOutputDir {
    $path = Join-Path ([System.IO.Path]::GetTempPath()) "pr-review-agent-test-$([Guid]::NewGuid().ToString('N'))"
    New-Item -ItemType Directory -Path $path -Force | Out-Null
    return $path
}

$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path

# Test 1: OpenSpec-only PR produces schema-valid report and detects change id.
$out1 = New-TestOutputDir
$result1 = Invoke-PrReviewAgent -RepoRoot $repoRoot `
    -ChangedPaths @(
        'openspec/changes/add-pr-review-agent/proposal.md',
        'openspec/changes/add-pr-review-agent/design.md',
        'openspec/changes/add-pr-review-agent/specs/pull-request-review-agent/spec.md'
    ) `
    -OutputDir $out1 `
    -SkipCommandExecution `
    -SkipGitNexus
$loaded1 = Get-Content -LiteralPath $result1.json_path -Raw | ConvertFrom-Json
Assert-True ($loaded1.schema_version -eq 'pr-review-agent/v1') 'schema version present'
Assert-True ($loaded1.openspec_changes -contains 'add-pr-review-agent') 'OpenSpec change id detected'
Assert-True ($loaded1.validation_commands -contains 'openspec validate add-pr-review-agent') 'OpenSpec validation command planned'
Assert-True (Test-Path -LiteralPath $result1.markdown_path) 'markdown summary written'
Remove-Item -LiteralPath $out1 -Recurse -Force

# Test 2: Service code change without OpenSpec blocks.
$out2 = New-TestOutputDir
$result2 = Invoke-PrReviewAgent -RepoRoot $repoRoot `
    -ChangedPaths @('bim-review-coordinator/src/index.ts') `
    -OutputDir $out2 `
    -SkipCommandExecution `
    -SkipGitNexus `
    -AllowGitNexusUnavailable
$loaded2 = Get-Content -LiteralPath $result2.json_path -Raw | ConvertFrom-Json
Assert-True ($loaded2.status -in @('blocked', 'warning')) 'service code without OpenSpec does not silently pass'
$missingSpec = $loaded2.blockers | Where-Object { $_.kind -eq 'missing_openspec' } | Select-Object -First 1
Assert-True ($null -ne $missingSpec) 'missing OpenSpec blocker recorded'
Remove-Item -LiteralPath $out2 -Recurse -Force

# Test 3: Secret-like paths are blocked without printing values.
$out3 = New-TestOutputDir
$result3 = Invoke-PrReviewAgent -RepoRoot $repoRoot `
    -ChangedPaths @('.env', 'deploy/private.pem') `
    -OutputDir $out3 `
    -SkipCommandExecution `
    -SkipGitNexus `
    -AllowGitNexusUnavailable
$loaded3 = Get-Content -LiteralPath $result3.json_path -Raw | ConvertFrom-Json
$secretBlockers = @($loaded3.blockers | Where-Object { $_.kind -eq 'secret_path' })
Assert-True ($secretBlockers.Count -ge 2) 'secret path blockers recorded'
Assert-True (($secretBlockers | ForEach-Object { $_.message }) -notmatch 'PASSWORD=|TOKEN=') 'secret values are not printed'
Remove-Item -LiteralPath $out3 -Recurse -Force

# Test 4: Retired runtime reintroduction is blocked.
$out4 = New-TestOutputDir
$result4 = Invoke-PrReviewAgent -RepoRoot $repoRoot `
    -ChangedPaths @('_worker/package.json') `
    -OutputDir $out4 `
    -SkipCommandExecution `
    -SkipGitNexus `
    -AllowGitNexusUnavailable
$loaded4 = Get-Content -LiteralPath $result4.json_path -Raw | ConvertFrom-Json
$retired = $loaded4.blockers | Where-Object { $_.kind -eq 'retired_runtime_path' } | Select-Object -First 1
Assert-True ($null -ne $retired) 'retired runtime blocker recorded'
Remove-Item -LiteralPath $out4 -Recurse -Force

# Test 5: GitNexus unavailable fails closed for code/script changes.
$out5 = New-TestOutputDir
$result5 = Invoke-PrReviewAgent -RepoRoot $repoRoot `
    -ChangedPaths @('scripts/pr-review-agent.ps1', 'openspec/changes/add-pr-review-agent/tasks.md') `
    -OutputDir $out5 `
    -SkipCommandExecution `
    -SimulateGitNexusUnavailable
$loaded5 = Get-Content -LiteralPath $result5.json_path -Raw | ConvertFrom-Json
$gitnexusBlocker = $loaded5.blockers | Where-Object { $_.kind -eq 'gitnexus_unavailable' } | Select-Object -First 1
Assert-True ($null -ne $gitnexusBlocker) 'GitNexus unavailable blocker recorded for script change'
Remove-Item -LiteralPath $out5 -Recurse -Force

# Test 6: GitNexus unavailable can be downgraded when the caller declares a tooling-only rollout exception.
$out6 = New-TestOutputDir
$result6 = Invoke-PrReviewAgent -RepoRoot $repoRoot `
    -ChangedPaths @('scripts/pr-review-agent.ps1', 'openspec/changes/add-pr-review-agent/tasks.md') `
    -OutputDir $out6 `
    -SkipCommandExecution `
    -SimulateGitNexusUnavailable `
    -AllowGitNexusUnavailable
$loaded6 = Get-Content -LiteralPath $result6.json_path -Raw | ConvertFrom-Json
$gitnexusAllowedBlocker = $loaded6.blockers | Where-Object { $_.kind -eq 'gitnexus_unavailable' } | Select-Object -First 1
$gitnexusWarning = $loaded6.warnings | Where-Object { $_.kind -eq 'gitnexus_warning' } | Select-Object -First 1
Assert-True ($null -eq $gitnexusAllowedBlocker) 'allowed GitNexus unavailable does not block'
Assert-True ($null -ne $gitnexusWarning) 'allowed GitNexus unavailable records warning'
Remove-Item -LiteralPath $out6 -Recurse -Force

# Test 7: Retired runtime guard definitions are allowed, but runtime wiring is blocked.
$out7 = New-TestOutputDir
$result7 = Invoke-PrReviewAgent -RepoRoot $repoRoot `
    -ChangedPaths @('scripts/lib/pr-review-agent.ps1', 'openspec/changes/add-pr-review-agent/tasks.md') `
    -OutputDir $out7 `
    -SkipCommandExecution `
    -SkipGitNexus `
    -AllowGitNexusUnavailable
$loaded7 = Get-Content -LiteralPath $result7.json_path -Raw | ConvertFrom-Json
$selfGuardBlocker = $loaded7.blockers | Where-Object { $_.kind -eq 'retired_runtime_reference' } | Select-Object -First 1
Assert-True ($null -eq $selfGuardBlocker) 'retired runtime guard list does not self-block'
Remove-Item -LiteralPath $out7 -Recurse -Force

$tempWiringPath = Join-Path $repoRoot 'scripts\tmp-retired-runtime-wiring.ps1'
try {
    Set-Content -LiteralPath $tempWiringPath -Value 'Push-Location _worker' -Encoding UTF8
    $out7b = New-TestOutputDir
    $result7b = Invoke-PrReviewAgent -RepoRoot $repoRoot `
        -ChangedPaths @('scripts/tmp-retired-runtime-wiring.ps1', 'openspec/changes/add-pr-review-agent/tasks.md') `
        -OutputDir $out7b `
        -SkipCommandExecution `
        -SkipGitNexus `
        -AllowGitNexusUnavailable
    $loaded7b = Get-Content -LiteralPath $result7b.json_path -Raw | ConvertFrom-Json
    $wiringBlocker = $loaded7b.blockers | Where-Object { $_.kind -eq 'retired_runtime_reference' } | Select-Object -First 1
    Assert-True ($null -ne $wiringBlocker) 'retired runtime wiring reference is blocked'
    Remove-Item -LiteralPath $out7b -Recurse -Force
} finally {
    if (Test-Path -LiteralPath $tempWiringPath) {
        Remove-Item -LiteralPath $tempWiringPath -Force
    }
}

# Test 8: Path planner maps owners to commands.
$plan = Get-PrReviewValidationPlan -RepoRoot $repoRoot `
    -ChangedPaths @(
        'bim-review-coordinator/src/index.ts',
        'web-viewer-sample/src/Window.tsx',
        'bim-streaming-server/tests/test_conversion_authority_api.py',
        'tests/contracts/test_external_cloud_callback.py',
        'scripts/pr-review-agent.ps1'
    ) `
    -OpenSpecChangeIds @('add-pr-review-agent')
$owners = @($plan | ForEach-Object { $_.owner })
Assert-True ($owners -contains 'openspec') 'planner includes OpenSpec owner'
Assert-True ($owners -contains 'bim-review-coordinator') 'planner includes coordinator owner'
Assert-True ($owners -contains 'web-viewer-sample') 'planner includes viewer owner'
Assert-True ($owners -contains 'bim-streaming-server') 'planner includes streaming owner'
Assert-True ($owners -contains 'tests') 'planner includes tests owner'
Assert-True ($owners -contains 'scripts') 'planner includes scripts owner'

# Test 9: Missing commands are recorded as skipped/unavailable instead of crashing report generation.
$missingPlan = New-PrReviewCommandPlan -Name 'missing command fixture' -Owner 'scripts' -Cwd $repoRoot -FileName 'definitely-missing-pr-review-agent-command' -Arguments @('--version')
$missingCheck = Invoke-PrReviewCommand -Plan $missingPlan
Assert-True ($missingCheck.status -eq 'skipped') 'missing command is skipped'
Assert-True ($missingCheck.exit_code -eq 127) 'missing command has unavailable exit code'

# Test 10: PR diff uses merge-base so base-branch-only changes are not reviewed.
$tempGit = Join-Path ([System.IO.Path]::GetTempPath()) "pr-review-agent-git-$([Guid]::NewGuid().ToString('N'))"
New-Item -ItemType Directory -Path $tempGit -Force | Out-Null
Push-Location $tempGit
try {
    git init -q
    git config user.email 'pr-review-agent@example.invalid'
    git config user.name 'PR Review Agent Test'
    Set-Content -LiteralPath 'base.txt' -Value 'base' -Encoding UTF8
    git add base.txt
    git commit -q -m 'base'
    git branch main
    git switch -q -c feature
    Set-Content -LiteralPath 'feature.txt' -Value 'feature' -Encoding UTF8
    git add feature.txt
    git commit -q -m 'feature'
    $headSha = (git rev-parse HEAD).Trim()
    git switch -q main
    Set-Content -LiteralPath 'main.txt' -Value 'main' -Encoding UTF8
    git add main.txt
    git commit -q -m 'main'
    $baseSha = (git rev-parse HEAD).Trim()
    $mergeBasePaths = @(Get-PrReviewChangedPathsFromGit -RepoRoot $tempGit -BaseSha $baseSha -HeadSha $headSha)
    Assert-True ($mergeBasePaths -contains 'feature.txt') 'merge-base diff includes PR head changes'
    Assert-True (-not ($mergeBasePaths -contains 'main.txt')) 'merge-base diff excludes base-only changes'
} finally {
    Pop-Location
    Remove-Item -LiteralPath $tempGit -Recurse -Force
}

Write-Host '[test-pr-review-agent] all assertions passed'
