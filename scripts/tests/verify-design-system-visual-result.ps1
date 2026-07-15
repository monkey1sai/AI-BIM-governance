[CmdletBinding()]
param(
    [string] $RepoRoot = '',
    [string] $ManifestPath = '',
    [string] $ResultPath = '',
    [string[]] $RequiredScreenIds = @(),
    [string] $TargetCommit = 'HEAD',
    [int] $MaxAgeHours = 24,
    [switch] $AllowUntrackedArtifacts,
    [switch] $SkipGitBinding
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($RepoRoot)) {
    $RepoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
} else {
    $RepoRoot = (Resolve-Path -LiteralPath $RepoRoot).Path
}
if ([string]::IsNullOrWhiteSpace($ManifestPath)) {
    $ManifestPath = Join-Path $RepoRoot 'docs\plans\design-system-reference.manifest.json'
}
if ([string]::IsNullOrWhiteSpace($ResultPath)) {
    $ResultPath = Join-Path $RepoRoot 'artifacts\e2e\design-system-visual-result.json'
}
$scopeLibrary = Join-Path $RepoRoot 'scripts\lib\design-system-gate.ps1'
if (-not (Test-Path -LiteralPath $scopeLibrary -PathType Leaf)) {
    throw "[design-visual-gate] scope library not found: $scopeLibrary"
}
. $scopeLibrary

function Assert-VisualResult {
    param([Parameter(Mandatory = $true)][bool] $Condition, [Parameter(Mandatory = $true)][string] $Message)
    if (-not $Condition) { throw "[design-visual-gate] $Message" }
}

function Get-Sha256 {
    param([Parameter(Mandatory = $true)][string] $LiteralPath)
    return (Get-FileHash -Algorithm SHA256 -LiteralPath $LiteralPath).Hash.ToLowerInvariant()
}

function Resolve-RepoArtifact {
    param([Parameter(Mandatory = $true)][string] $RelativePath)
    Assert-VisualResult ($RelativePath -match '^artifacts/e2e/design-system-visual/') "visual artifact must stay under artifacts/e2e/design-system-visual/: $RelativePath"
    $absolute = [System.IO.Path]::GetFullPath((Join-Path $RepoRoot $RelativePath))
    $artifactRoot = [System.IO.Path]::GetFullPath((Join-Path $RepoRoot 'artifacts/e2e/design-system-visual'))
    $artifactPrefix = $artifactRoot.TrimEnd([System.IO.Path]::DirectorySeparatorChar, [System.IO.Path]::AltDirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
    Assert-VisualResult ($absolute.StartsWith($artifactPrefix, [System.StringComparison]::OrdinalIgnoreCase)) "visual artifact escaped artifacts/e2e/design-system-visual/: $RelativePath"
    return $absolute
}

Assert-VisualResult (Test-Path -LiteralPath $ManifestPath -PathType Leaf) "manifest not found: $ManifestPath"
Assert-VisualResult (Test-Path -LiteralPath $ResultPath -PathType Leaf) "visual result not found: $ResultPath"

$manifest = Get-Content -LiteralPath $ManifestPath -Raw | ConvertFrom-Json
$result = Get-Content -LiteralPath $ResultPath -Raw | ConvertFrom-Json
$manifestHash = Get-Sha256 -LiteralPath $ManifestPath
$runtimePlatform = if ([System.Runtime.InteropServices.RuntimeInformation]::IsOSPlatform([System.Runtime.InteropServices.OSPlatform]::Windows)) {
    'windows'
} elseif ([System.Runtime.InteropServices.RuntimeInformation]::IsOSPlatform([System.Runtime.InteropServices.OSPlatform]::Linux)) {
    'linux'
} elseif ([System.Runtime.InteropServices.RuntimeInformation]::IsOSPlatform([System.Runtime.InteropServices.OSPlatform]::OSX)) {
    'darwin'
} else {
    'unknown'
}

Assert-VisualResult ($result.schema_version -eq 2) 'schema_version must be 2.'
Assert-VisualResult ($result.kind -eq 'ai-bim-design-system-visual-result') 'kind is invalid.'
Assert-VisualResult ($result.status -eq 'passed') 'visual result status must be passed.'
Assert-VisualResult ($result.manifest_sha256 -eq $manifestHash) 'result is not bound to the current manifest SHA-256.'
Assert-VisualResult ($result.source_snapshot_sha256 -eq $manifest.source.snapshot_sha256) 'result source snapshot is stale.'
Assert-VisualResult ($result.baseline_snapshot_sha256 -eq $manifest.baseline_snapshot_sha256) 'result baseline snapshot is stale.'
Assert-VisualResult ($result.browser -eq 'chromium') 'result browser must be chromium.'
Assert-VisualResult ($result.platform -eq $manifest.fidelity_contract.platform) 'result platform does not match the approved manifest platform.'
Assert-VisualResult ($result.playwright_version -eq $manifest.fidelity_contract.playwright_version) 'result Playwright version does not match the approved pin.'
Assert-VisualResult ($result.chromium_revision -eq $manifest.fidelity_contract.chromium_revision) 'result Chromium revision does not match the approved pin.'
Assert-VisualResult ($result.chromium_version -eq $manifest.fidelity_contract.chromium_version) 'result Chromium version does not match the approved pin.'
Assert-VisualResult ($result.ci_runner_label -in @($manifest.fidelity_contract.ci_runner_label, 'local-windows')) 'result runner label is not approved.'
Assert-VisualResult ($runtimePlatform -eq $manifest.fidelity_contract.platform) "validator host platform '$runtimePlatform' does not match the approved manifest platform '$($manifest.fidelity_contract.platform)'."
Assert-VisualResult ([bool]$result.workspace_clean) 'visual result was not produced from a clean subject commit.'
Assert-VisualResult ([double]$result.device_scale_factor -eq 1) 'result device scale factor must be 1.'
Assert-VisualResult ($manifest.semantic_contract.status -eq 'executable') 'semantic state variants are reference_missing; a visual result cannot claim 99% yet.'
Assert-VisualResult (-not [bool]$manifest.semantic_contract.external_result_input_allowed) 'external semantic-result input is forbidden.'
Assert-VisualResult ($result.semantic_contract_schema_version -eq $manifest.semantic_contract.schema_version) 'semantic contract schema version drifted.'

$pixelValidator = Join-Path $RepoRoot 'web-viewer-sample/scripts/verify-design-system-pixels.mjs'
Assert-VisualResult (Test-Path -LiteralPath $pixelValidator -PathType Leaf) "pixel recomputation validator not found: $pixelValidator"
& node $pixelValidator --repo-root $RepoRoot --manifest $ManifestPath --result $ResultPath
Assert-VisualResult ($LASTEXITCODE -eq 0) 'baseline/actual/diff PNG recomputation failed.'

$generatedAt = [datetimeoffset]::MinValue
Assert-VisualResult ([datetimeoffset]::TryParse([string]$result.generated_at_utc, [ref]$generatedAt)) 'generated_at_utc is invalid.'
if ($MaxAgeHours -gt 0) {
    $age = [datetimeoffset]::UtcNow - $generatedAt.ToUniversalTime()
    Assert-VisualResult ($age.TotalHours -ge -1 -and $age.TotalHours -le $MaxAgeHours) "visual result is older than $MaxAgeHours hours or from an invalid future time."
}

$screenMap = @{}
foreach ($screen in @($manifest.screens)) { $screenMap[[string]$screen.id] = $screen }
$resultScreens = @($result.screens)
Assert-VisualResult ($resultScreens.Count -gt 0) 'result must contain at least one screen.'
Assert-VisualResult (@($resultScreens | Group-Object id | Where-Object Count -gt 1).Count -eq 0) 'result contains duplicate screen IDs.'
$resultScreenIds = @($resultScreens | ForEach-Object { [string]$_.id })
$policyRequiredScreenIds = @($manifest.screens | ForEach-Object { [string]$_.id })
Assert-VisualResult ((@($resultScreenIds | Sort-Object) -join '|') -eq ((@($policyRequiredScreenIds | Sort-Object)) -join '|')) 'visual result must contain every approved manifest screen.'
foreach ($requiredScreenId in $RequiredScreenIds) {
    if ([string]::IsNullOrWhiteSpace($requiredScreenId)) { continue }
    Assert-VisualResult ($requiredScreenId -in $resultScreenIds) "required screen '$requiredScreenId' is absent from the visual result."
}

$requiredStates = @($manifest.required_semantic_states)
$requiredCaseIds = @($manifest.semantic_contract.required_case_ids)
$requiredViewportIds = @($manifest.fidelity_contract.viewports | ForEach-Object { [string]$_.id })
foreach ($screenResult in $resultScreens) {
    $screenId = [string]$screenResult.id
    Assert-VisualResult ($screenMap.ContainsKey($screenId)) "screen '$screenId' is not approved by the manifest."
    $approvedScreen = $screenMap[$screenId]
    Assert-VisualResult ([string]$screenResult.production_route -in @($approvedScreen.production_routes)) "screen '$screenId' uses an unapproved production route."
    Assert-VisualResult ([double]$screenResult.semantic_parity -eq 1) "screen '$screenId' semantic parity is not 100%."
    Assert-VisualResult ($screenResult.semantic_producer -eq 'playwright-inline-cases') "screen '$screenId' semantic producer is not trusted."
    $caseIds = @($screenResult.semantic_case_ids | ForEach-Object { [string]$_ })
    Assert-VisualResult (@($caseIds | Group-Object | Where-Object Count -gt 1).Count -eq 0) "screen '$screenId' contains duplicate semantic cases."
    Assert-VisualResult ((@($caseIds | Sort-Object) -join '|') -eq ((@($requiredCaseIds | Sort-Object)) -join '|')) "screen '$screenId' does not contain the exact semantic case set."
    foreach ($state in $requiredStates) {
        $property = $screenResult.semantic_states.PSObject.Properties[[string]$state]
        Assert-VisualResult ($null -ne $property -and [bool]$property.Value) "screen '$screenId' semantic state '$state' is missing or false."
    }
    $semanticAssertions = @($screenResult.semantic_assertions)
    Assert-VisualResult ($semanticAssertions.Count -ge $requiredCaseIds.Count) "screen '$screenId' lacks spec-executed semantic assertions."
    Assert-VisualResult (@($semanticAssertions | Group-Object { "$($_.case_id):$($_.assertion_id)" } | Where-Object Count -gt 1).Count -eq 0) "screen '$screenId' contains duplicate semantic assertion IDs."
    foreach ($caseId in $requiredCaseIds) {
        $caseAssertions = @($semanticAssertions | Where-Object case_id -eq $caseId)
        Assert-VisualResult ($caseAssertions.Count -gt 0) "screen '$screenId' semantic case '$caseId' has no spec-executed DOM assertion."
        foreach ($assertion in $caseAssertions) {
            Assert-VisualResult (-not [string]::IsNullOrWhiteSpace([string]$assertion.assertion_id)) "screen '$screenId' semantic case '$caseId' has an empty assertion ID."
            Assert-VisualResult (-not [string]::IsNullOrWhiteSpace([string]$assertion.locator)) "screen '$screenId' semantic case '$caseId' has an empty locator."
            Assert-VisualResult ([string]$assertion.expectation -in @('visible', 'hidden', 'enabled', 'disabled', 'text_equals', 'text_contains', 'attribute_equals', 'count_equals')) "screen '$screenId' semantic assertion '$($assertion.assertion_id)' has an unsupported expectation."
            Assert-VisualResult ([bool]$assertion.passed) "screen '$screenId' semantic assertion '$($assertion.assertion_id)' did not pass in Playwright."
            Assert-VisualResult ($null -ne $assertion.PSObject.Properties['observed']) "screen '$screenId' semantic assertion '$($assertion.assertion_id)' has no observed DOM value."
        }
    }

    $viewportResults = @($screenResult.viewports)
    Assert-VisualResult ($viewportResults.Count -eq $requiredViewportIds.Count) "screen '$screenId' must contain both approved viewports."
    Assert-VisualResult (@($viewportResults | Group-Object id | Where-Object Count -gt 1).Count -eq 0) "screen '$screenId' contains duplicate viewports."
    foreach ($viewportId in $requiredViewportIds) {
        $viewportResult = @($viewportResults | Where-Object id -eq $viewportId)
        Assert-VisualResult ($viewportResult.Count -eq 1) "screen '$screenId' lacks viewport '$viewportId'."
        $viewportResult = $viewportResult[0]
        Assert-VisualResult ([double]$viewportResult.diff_pixel_ratio -ge 0 -and [double]$viewportResult.diff_pixel_ratio -le [double]$manifest.fidelity_contract.max_diff_pixel_ratio) "screen '$screenId' viewport '$viewportId' exceeds the 1% pixel-diff budget."
        $approvedBaseline = $approvedScreen.baselines.PSObject.Properties[[string]$viewportId].Value
        Assert-VisualResult ($viewportResult.baseline_path -eq $approvedBaseline.path) "screen '$screenId' viewport '$viewportId' baseline path drifted."
        Assert-VisualResult ($viewportResult.baseline_sha256 -eq $approvedBaseline.sha256) "screen '$screenId' viewport '$viewportId' baseline hash drifted."
        foreach ($artifactKind in @('actual', 'diff')) {
            $pathProperty = "${artifactKind}_path"
            $hashProperty = "${artifactKind}_sha256"
            $relativePath = [string]$viewportResult.$pathProperty
            $absolutePath = Resolve-RepoArtifact -RelativePath $relativePath
            Assert-VisualResult (Test-Path -LiteralPath $absolutePath -PathType Leaf) "visual artifact is missing: $relativePath"
            Assert-VisualResult ([string]$viewportResult.$hashProperty -match '^[0-9a-f]{64}$') "visual artifact hash is invalid: $relativePath"
            Assert-VisualResult ((Get-Sha256 -LiteralPath $absolutePath) -eq $viewportResult.$hashProperty) "visual artifact hash mismatch: $relativePath"
            if (-not $AllowUntrackedArtifacts) {
                & git -C $RepoRoot -c "safe.directory=$RepoRoot" ls-files --error-unmatch -- $relativePath *> $null
                Assert-VisualResult ($LASTEXITCODE -eq 0) "visual artifact is not tracked: $relativePath"
            }
        }
    }
}

if (-not $AllowUntrackedArtifacts) {
    $relativeResult = [System.IO.Path]::GetRelativePath($RepoRoot, (Resolve-Path -LiteralPath $ResultPath).Path).Replace('\', '/')
    & git -C $RepoRoot -c "safe.directory=$RepoRoot" ls-files --error-unmatch -- $relativeResult *> $null
    Assert-VisualResult ($LASTEXITCODE -eq 0) "visual result is not tracked: $relativeResult"
}

if (-not $SkipGitBinding) {
    $subjectCommit = [string]$result.subject_commit
    Assert-VisualResult ($subjectCommit -match '^[0-9a-f]{40}$') 'subject_commit must be a full 40-character commit SHA.'
    & git -C $RepoRoot -c "safe.directory=$RepoRoot" cat-file -e "${subjectCommit}^{commit}" 2>$null
    Assert-VisualResult ($LASTEXITCODE -eq 0) 'subject_commit does not exist in this repository.'
    $targetCommitInput = $TargetCommit
    $resolvedTargetCommit = @(& git -C $RepoRoot -c "safe.directory=$RepoRoot" rev-parse --verify "${targetCommitInput}^{commit}" 2>$null)
    Assert-VisualResult ($LASTEXITCODE -eq 0 -and $resolvedTargetCommit.Count -eq 1 -and $resolvedTargetCommit[0].Trim() -match '^[0-9a-f]{40}$') "target commit '$targetCommitInput' does not exist in this repository."
    $TargetCommit = $resolvedTargetCommit[0].Trim()
    $manifestRelative = [System.IO.Path]::GetRelativePath($RepoRoot, (Resolve-Path -LiteralPath $ManifestPath).Path).Replace('\', '/')
    Assert-VisualResult ($manifestRelative -eq 'docs/plans/design-system-reference.manifest.json') 'commit-bound validation requires the canonical tracked manifest.'
    $trackedDirtyPaths = @(& git -C $RepoRoot -c "safe.directory=$RepoRoot" -c core.quotepath=false diff --no-renames --name-only $TargetCommit -- 2>$null)
    Assert-VisualResult ($LASTEXITCODE -eq 0) "unable to inspect tracked working-tree changes relative to target commit '$TargetCommit'."
    $untrackedDirtyPaths = @(& git -C $RepoRoot -c "safe.directory=$RepoRoot" -c core.quotepath=false ls-files --others --exclude-standard 2>$null)
    Assert-VisualResult ($LASTEXITCODE -eq 0) 'unable to inspect untracked working-tree files.'
    $dirtyPaths = @($trackedDirtyPaths + $untrackedDirtyPaths | ForEach-Object { ConvertTo-DesignSystemRepoPath -Path ([string]$_) } | Where-Object { $_ } | Sort-Object -Unique)
    if ($dirtyPaths.Count -gt 0) {
        $directDirtyPaths = @($dirtyPaths | Where-Object {
            $_ -eq 'docs/plans/design-system-reference.manifest.json' -or
            $_ -like 'docs/plans/design-system-baseline/*'
        })
        $dirtyScope = Get-DesignSystemChangeScope -RepoRoot $RepoRoot -ChangedPaths $dirtyPaths -BaseSha $TargetCommit -HeadSha $TargetCommit
        $hasRelevantDirtyScope = [bool]$dirtyScope.frontend_product -or
            $dirtyScope.status -eq 'unknown_fail_closed' -or
            @($dirtyScope.gate_infrastructure_paths).Count -gt 0
        Assert-VisualResult ($directDirtyPaths.Count -eq 0 -and -not $hasRelevantDirtyScope) "working tree has uncommitted design-relevant paths outside target commit '$TargetCommit': $($dirtyPaths -join ', ')."
    }
    Assert-VisualResult ($subjectCommit -eq $TargetCommit) "visual evidence subject_commit '$subjectCommit' must equal target commit '$TargetCommit'; rerun the visual gate after every commit."
}

Write-Host "[design-visual-gate] passed — screens=$($resultScreens.Count), manifest=$manifestHash"
