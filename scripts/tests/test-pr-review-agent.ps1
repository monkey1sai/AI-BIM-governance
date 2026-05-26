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

function New-TestOutputDir {
    $path = Join-Path ([System.IO.Path]::GetTempPath()) "pr-review-agent-test-$([Guid]::NewGuid().ToString('N'))"
    New-Item -ItemType Directory -Path $path -Force | Out-Null
    return $path
}

$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$env:PR_REVIEW_AGENT_REQUIRE_AI = $null

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
$optionalAiWarning = $loaded1.warnings | Where-Object { $_.kind -eq 'optional_ai_adapter_skipped' } | Select-Object -First 1
$optionalAiNote = $loaded1.human_review_notes | Where-Object { $_ -match 'Optional AI adapter' } | Select-Object -First 1
Assert-True ($null -eq $optionalAiWarning) 'optional AI skip is not a warning by default'
Assert-True ($null -ne $optionalAiNote) 'optional AI skip is recorded as a human note'
Assert-True (-not ($loaded1.gitnexus -is [array])) 'gitnexus report serializes as an object'
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
$secretLeaks = @($secretBlockers | ForEach-Object { $_.message } | Where-Object { $_ -match 'PASSWORD=|TOKEN=' })
Assert-True ($secretLeaks.Count -eq 0) 'secret values are not printed'
Remove-Item -LiteralPath $out3 -Recurse -Force

# Test 3b: Secret and generated-tooling deletions are allowed as cleanup warnings.
$tempCleanupGit = Join-Path ([System.IO.Path]::GetTempPath()) "pr-review-agent-cleanup-$([Guid]::NewGuid().ToString('N'))"
New-Item -ItemType Directory -Path $tempCleanupGit -Force | Out-Null
Push-Location $tempCleanupGit
try {
    git init -q
    git config user.email 'pr-review-agent@example.invalid'
    git config user.name 'PR Review Agent Test'
    New-Item -ItemType Directory -Path deploy | Out-Null
    New-Item -ItemType Directory -Path '.gitnexus' | Out-Null
    Set-Content -LiteralPath '.env' -Value 'TOKEN=redacted' -Encoding UTF8
    Set-Content -LiteralPath 'deploy/private.pem' -Value 'redacted' -Encoding UTF8
    Set-Content -LiteralPath '.gitnexus/state.json' -Value '{}' -Encoding UTF8
    git add -f .env deploy/private.pem .gitnexus/state.json
    git commit -q -m 'base'
    $cleanupBaseSha = (git rev-parse HEAD).Trim()
    Remove-Item -LiteralPath '.env' -Force
    Remove-Item -LiteralPath 'deploy/private.pem' -Force
    Remove-Item -LiteralPath '.gitnexus/state.json' -Force
    git add -A
    git commit -q -m 'remove unsafe files'
    $cleanupHeadSha = (git rev-parse HEAD).Trim()
    $cleanupGuards = Get-PrReviewPathGuardFindings -ChangedPaths @('.env', 'deploy/private.pem', '.gitnexus/state.json') -RepoRoot $tempCleanupGit -BaseSha $cleanupBaseSha -HeadSha $cleanupHeadSha
    $cleanupBlockers = @($cleanupGuards.blockers | Where-Object { $_.kind -in @('secret_path', 'generated_tooling_path') })
    $cleanupWarnings = @($cleanupGuards.warnings | Where-Object { $_.kind -in @('secret_path_deleted', 'generated_tooling_path_deleted') })
    Assert-True ($cleanupBlockers.Count -eq 0) 'cleanup deletions do not block secret/generated path guards'
    Assert-True ($cleanupWarnings.Count -ge 2) 'cleanup deletions produce human review warnings'
} finally {
    Pop-Location
    Remove-Item -LiteralPath $tempCleanupGit -Recurse -Force
}

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

# Test 6b: GitNexus execution failure still blocks even when unavailable tooling is allowed.
$out6b = New-TestOutputDir
$result6b = Invoke-PrReviewAgent -RepoRoot $repoRoot `
    -ChangedPaths @('scripts/pr-review-agent.ps1', 'openspec/changes/add-pr-review-agent/tasks.md') `
    -OutputDir $out6b `
    -SkipCommandExecution `
    -SimulateGitNexusFailure `
    -AllowGitNexusUnavailable
$loaded6b = Get-Content -LiteralPath $result6b.json_path -Raw | ConvertFrom-Json
$gitnexusFailedBlocker = $loaded6b.blockers | Where-Object { $_.kind -eq 'gitnexus_failed' } | Select-Object -First 1
Assert-True ($null -ne $gitnexusFailedBlocker) 'GitNexus failed result blocks even when unavailable is allowed'
Remove-Item -LiteralPath $out6b -Recurse -Force

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

# Test 7c: Retired runtime guard only blocks newly added wiring lines when base/head are available.
$tempGuardGit = Join-Path ([System.IO.Path]::GetTempPath()) "pr-review-agent-guard-$([Guid]::NewGuid().ToString('N'))"
New-Item -ItemType Directory -Path $tempGuardGit -Force | Out-Null
Push-Location $tempGuardGit
try {
    git init -q
    git config user.email 'pr-review-agent@example.invalid'
    git config user.name 'PR Review Agent Test'
    New-Item -ItemType Directory -Path scripts | Out-Null
    Set-Content -LiteralPath 'scripts/pre-existing.ps1' -Value @('Push-Location _worker', 'Write-Host base') -Encoding UTF8
    git add scripts/pre-existing.ps1
    git commit -q -m 'base'
    $guardBaseSha = (git rev-parse HEAD).Trim()
    Set-Content -LiteralPath 'scripts/pre-existing.ps1' -Value @('Push-Location _worker', 'Write-Host edited') -Encoding UTF8
    git add scripts/pre-existing.ps1
    git commit -q -m 'edit unrelated line'
    $guardHeadSha = (git rev-parse HEAD).Trim()
    $preExistingGuard = Get-PrReviewPathGuardFindings -ChangedPaths @('scripts/pre-existing.ps1') -RepoRoot $tempGuardGit -BaseSha $guardBaseSha -HeadSha $guardHeadSha
    $preExistingBlocker = $preExistingGuard.blockers | Where-Object { $_.kind -eq 'retired_runtime_reference' } | Select-Object -First 1
    Assert-True ($null -eq $preExistingBlocker) 'pre-existing retired runtime wiring is not re-blocked'

    Set-Content -LiteralPath 'scripts/new-wiring.ps1' -Value 'Push-Location _worker' -Encoding UTF8
    git add scripts/new-wiring.ps1
    git commit -q -m 'add retired wiring'
    $guardNewHeadSha = (git rev-parse HEAD).Trim()
    $newGuard = Get-PrReviewPathGuardFindings -ChangedPaths @('scripts/new-wiring.ps1') -RepoRoot $tempGuardGit -BaseSha $guardHeadSha -HeadSha $guardNewHeadSha
    $newBlocker = $newGuard.blockers | Where-Object { $_.kind -eq 'retired_runtime_reference' } | Select-Object -First 1
    Assert-True ($null -ne $newBlocker) 'new retired runtime wiring is blocked'
} finally {
    Pop-Location
    Remove-Item -LiteralPath $tempGuardGit -Recurse -Force
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
    Assert-Throws { Get-PrReviewChangedPathsFromGit -RepoRoot $tempGit -BaseSha 'missing-base-sha' -HeadSha $headSha } 'invalid base/head diff throws'
} finally {
    Pop-Location
    Remove-Item -LiteralPath $tempGit -Recurse -Force
}

# Test 11: Working-tree rename parsing reports the new path only.
$tempRenameGit = Join-Path ([System.IO.Path]::GetTempPath()) "pr-review-agent-rename-$([Guid]::NewGuid().ToString('N'))"
New-Item -ItemType Directory -Path $tempRenameGit -Force | Out-Null
Push-Location $tempRenameGit
try {
    git init -q
    git config user.email 'pr-review-agent@example.invalid'
    git config user.name 'PR Review Agent Test'
    Set-Content -LiteralPath 'old name.txt' -Value 'base' -Encoding UTF8
    git add 'old name.txt'
    git commit -q -m 'base'
    git mv 'old name.txt' 'new name.txt'
    $renamePaths = @(Get-PrReviewChangedPathsFromGit -RepoRoot $tempRenameGit)
    Assert-True ($renamePaths -contains 'new name.txt') 'working-tree rename includes new path'
    Assert-True (-not ($renamePaths -contains 'old name.txt')) 'working-tree rename excludes old path'
} finally {
    Pop-Location
    Remove-Item -LiteralPath $tempRenameGit -Recurse -Force
}

# Test 12: Wrapper fallback report keeps the stable schema when report generation fails.
$out12 = New-TestOutputDir
$wrapperPath = Join-Path $repoRoot 'scripts\pr-review-agent.ps1'
& powershell -NoProfile -ExecutionPolicy Bypass -File $wrapperPath -BaseSha missing-base-sha -HeadSha missing-head-sha -OutputDir $out12 *> $null
Assert-True ($LASTEXITCODE -eq 1) 'wrapper exits nonzero on invalid base/head'
$failedReport = Get-Content -LiteralPath (Join-Path $out12 'pr-review-agent.json') -Raw | ConvertFrom-Json
$failedFields = @($failedReport.PSObject.Properties.Name)
foreach ($field in @('changed_paths', 'openspec_changes', 'validation_commands', 'human_review_notes', 'gitnexus')) {
    Assert-True ($failedFields -contains $field) "fallback report contains $field"
}
Remove-Item -LiteralPath $out12 -Recurse -Force

Write-Host '[test-pr-review-agent] all assertions passed'
