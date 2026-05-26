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

# Test 6: Path planner maps owners to commands.
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

Write-Host '[test-pr-review-agent] all assertions passed'
