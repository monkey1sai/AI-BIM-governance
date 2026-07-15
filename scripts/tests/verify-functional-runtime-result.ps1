[CmdletBinding()]
param(
    [string] $RepoRoot = '',
    [string] $ResultPath = '',
    [string] $TargetCommit = 'HEAD',
    [int] $MaxAgeHours = 24,
    [switch] $AllowUntrackedArtifacts,
    [switch] $SkipGitBinding
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($RepoRoot)) {
    $RepoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../..')).Path
} else {
    $RepoRoot = (Resolve-Path -LiteralPath $RepoRoot).Path
}
if ([string]::IsNullOrWhiteSpace($ResultPath)) {
    $ResultPath = Join-Path $RepoRoot 'artifacts\e2e\functional-runtime\functional-runtime-result.json'
}

function Assert-FunctionalResult {
    param([Parameter(Mandatory = $true)][bool] $Condition, [Parameter(Mandatory = $true)][string] $Message)
    if (-not $Condition) { throw "[functional-runtime-gate] $Message" }
}

function Get-Sha256 {
    param([Parameter(Mandatory = $true)][string] $LiteralPath)
    return (Get-FileHash -Algorithm SHA256 -LiteralPath $LiteralPath).Hash.ToLowerInvariant()
}

function Resolve-FunctionalArtifact {
    param([Parameter(Mandatory = $true)][string] $RelativePath)
    Assert-FunctionalResult ($RelativePath -match '^artifacts/e2e/functional-runtime/') "artifact must stay under artifacts/e2e/functional-runtime/: $RelativePath"
    $absolute = [System.IO.Path]::GetFullPath((Join-Path $RepoRoot $RelativePath))
    $artifactRoot = [System.IO.Path]::GetFullPath((Join-Path $RepoRoot 'artifacts/e2e/functional-runtime'))
    $artifactPrefix = $artifactRoot.TrimEnd([System.IO.Path]::DirectorySeparatorChar, [System.IO.Path]::AltDirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
    Assert-FunctionalResult ($absolute.StartsWith($artifactPrefix, [System.StringComparison]::OrdinalIgnoreCase)) "artifact escaped functional/runtime evidence root: $RelativePath"
    return $absolute
}

Assert-FunctionalResult (Test-Path -LiteralPath $ResultPath -PathType Leaf) "functional/runtime result not found: $ResultPath"
$result = Get-Content -LiteralPath $ResultPath -Raw | ConvertFrom-Json

Assert-FunctionalResult ($result.schema_version -eq 1) 'schema_version must be 1.'
Assert-FunctionalResult ($result.kind -eq 'ai-bim-functional-runtime-result') 'kind is invalid.'
Assert-FunctionalResult ($result.status -eq 'passed') 'status must be passed.'
Assert-FunctionalResult (-not [bool]$result.skipped) 'skipped evidence cannot pass the functional/runtime gate.'
Assert-FunctionalResult (-not [bool]$result.blocked) 'blocked evidence cannot pass the functional/runtime gate.'
Assert-FunctionalResult ([bool]$result.workspace_clean) 'result must be produced from a clean subject commit.'
Assert-FunctionalResult ([string]$result.subject_commit -match '^[0-9a-f]{40}$') 'subject_commit must be a full lowercase 40-character commit SHA.'
Assert-FunctionalResult ([string]$result.route -match '^#[a-z0-9][a-z0-9-]*(?:\?.*)?$') 'route must be an exact hash route.'
$scopeProperty = $result.PSObject.Properties['scope']
Assert-FunctionalResult ($null -ne $scopeProperty -and [string]$scopeProperty.Value -match '^[a-z0-9]+(?:_[a-z0-9]+)*$') 'scope must name the exact exercised slice.'
$fullRouteCoverageProperty = $result.PSObject.Properties['full_route_coverage']
Assert-FunctionalResult ($null -ne $fullRouteCoverageProperty -and $fullRouteCoverageProperty.Value -is [bool]) 'full_route_coverage must be a boolean.'
$knownGapsProperty = $result.PSObject.Properties['known_gaps']
Assert-FunctionalResult ($null -ne $knownGapsProperty) 'known_gaps is required.'
$knownGaps = @($knownGapsProperty.Value)
if (-not [bool]$fullRouteCoverageProperty.Value) {
    Assert-FunctionalResult ($knownGaps.Count -gt 0) 'partial route evidence must list known_gaps.'
    foreach ($knownGap in $knownGaps) {
        Assert-FunctionalResult (-not [string]::IsNullOrWhiteSpace([string]$knownGap)) 'known_gaps cannot contain an empty entry.'
    }
}
Assert-FunctionalResult (@($result.main_buttons_tested).Count -gt 0) 'main_buttons_tested must name at least one tested action.'
Assert-FunctionalResult (-not [string]::IsNullOrWhiteSpace([string]$result.fixture)) 'fixture must identify the exercised input.'
Assert-FunctionalResult ([string]$result.e2e_command -match '(?i)playwright|gstack|browser') 'e2e_command must identify the browser verification command.'

$generatedAt = [datetimeoffset]::MinValue
Assert-FunctionalResult ([datetimeoffset]::TryParse([string]$result.generated_at_utc, [ref]$generatedAt)) 'generated_at_utc is invalid.'
$age = [datetimeoffset]::UtcNow - $generatedAt.ToUniversalTime()
Assert-FunctionalResult ($age.TotalMinutes -ge -5) 'generated_at_utc is unreasonably in the future.'
Assert-FunctionalResult ($age.TotalHours -le $MaxAgeHours) "functional/runtime result is older than $MaxAgeHours hours."

$requests = @($result.backend_api.requests)
Assert-FunctionalResult ($requests.Count -gt 0) 'backend_api.requests must contain at least one observed request.'
foreach ($request in $requests) {
    Assert-FunctionalResult ([string]$request.method -match '^(GET|POST|PUT|PATCH|DELETE)$') 'backend API request method is invalid.'
    Assert-FunctionalResult ([string]$request.path -match '^/api/') "backend API path must stay behind the coordinator proxy: $($request.path)"
    Assert-FunctionalResult ([int]$request.response_status -ge 100 -and [int]$request.response_status -le 599) 'backend API response status is invalid.'
}
Assert-FunctionalResult ([int]$result.backend_api.browser_direct_runtime_port_requests -eq 0) 'browser made a forbidden direct runtime-port request.'

$runtimeBoundary = $result.PSObject.Properties['runtime_boundary']
Assert-FunctionalResult ($null -ne $runtimeBoundary) 'runtime_boundary is required.'
Assert-FunctionalResult ([string]$runtimeBoundary.Value.coordinator -eq 'real') 'runtime_boundary.coordinator must be real; browser API mocks cannot pass.'
Assert-FunctionalResult ([string]$runtimeBoundary.Value.conversion_authority -in @('live', 'stub_external_conversion')) 'runtime_boundary.conversion_authority is invalid.'
Assert-FunctionalResult ([string]$runtimeBoundary.Value.live_gpu -in @('observed', 'not_observed')) 'runtime_boundary.live_gpu is invalid.'
if ([string]$runtimeBoundary.Value.conversion_authority -eq 'stub_external_conversion') {
    Assert-FunctionalResult ([string]$runtimeBoundary.Value.live_gpu -eq 'not_observed') 'stub external conversion evidence cannot claim live GPU observation.'
}

if ([string]$result.route -eq '#conv') {
    $requestPaths = @($requests | ForEach-Object { [string]$_.path })
    Assert-FunctionalResult ('/api/external/ifc-ready' -in $requestPaths) '#conv evidence must exercise the real coordinator queue route.'
    Assert-FunctionalResult ('/api/dev/conversions' -in $requestPaths) '#conv evidence must exercise the coordinator conversion-history proxy.'
    Assert-FunctionalResult (@($requestPaths | Where-Object { $_ -match '^/api/dev/conversions/[^/]+/result$' }).Count -gt 0) '#conv evidence must exercise the coordinator conversion-result proxy.'
}

$runtimeActions = @($result.runtime_actions)
Assert-FunctionalResult ($runtimeActions.Count -gt 0) 'runtime_actions must contain at least one observed action.'
foreach ($runtimeAction in $runtimeActions) {
    Assert-FunctionalResult (-not [string]::IsNullOrWhiteSpace([string]$runtimeAction.action)) 'runtime action name is missing.'
    Assert-FunctionalResult (-not [string]::IsNullOrWhiteSpace([string]$runtimeAction.runtime_id_type)) 'runtime ID type is missing.'
    Assert-FunctionalResult ([string]$runtimeAction.runtime_id -match '^[A-Za-z0-9][A-Za-z0-9_.:-]+$') 'runtime ID is missing or invalid.'
}

foreach ($stateName in @('loading', 'success', 'failure', 'retry')) {
    $stateProperty = $result.visible_states.PSObject.Properties[$stateName]
    Assert-FunctionalResult ($null -ne $stateProperty -and [bool]$stateProperty.Value.observed) "visible state '$stateName' was not observed."
}

$artifacts = @($result.artifacts)
Assert-FunctionalResult ($artifacts.Count -ge 2) 'artifacts must include screenshot and trace evidence.'
$roles = @($artifacts | ForEach-Object { [string]$_.role })
Assert-FunctionalResult ('screenshot' -in $roles) 'screenshot artifact is required.'
Assert-FunctionalResult ('trace' -in $roles) 'trace artifact is required.'
foreach ($artifact in $artifacts) {
    $relativePath = [string]$artifact.path
    $absolutePath = Resolve-FunctionalArtifact -RelativePath $relativePath
    Assert-FunctionalResult (Test-Path -LiteralPath $absolutePath -PathType Leaf) "artifact file is missing: $relativePath"
    Assert-FunctionalResult ([string]$artifact.sha256 -match '^[0-9a-f]{64}$') "artifact SHA-256 is invalid: $relativePath"
    Assert-FunctionalResult ((Get-Sha256 -LiteralPath $absolutePath) -eq [string]$artifact.sha256) "artifact SHA-256 does not match: $relativePath"
    if (-not $AllowUntrackedArtifacts) {
        & git -C $RepoRoot -c "safe.directory=$RepoRoot" ls-files --error-unmatch -- $relativePath *> $null
        Assert-FunctionalResult ($LASTEXITCODE -eq 0) "artifact is not tracked: $relativePath"
    }
}

if ($null -ne $result.kit_runtime) {
    Assert-FunctionalResult ([bool]$result.kit_runtime.first_frame_observed) 'Kit first-frame evidence is required.'
    Assert-FunctionalResult (-not [string]::IsNullOrWhiteSpace([string]$result.kit_runtime.stage_id)) 'Kit stage ID is required.'
    Assert-FunctionalResult ([bool]$result.kit_runtime.datachannel_ack_observed) 'Kit DataChannel acknowledgement evidence is required.'
}

if (-not $SkipGitBinding) {
    $resolvedTarget = @(& git -C $RepoRoot -c "safe.directory=$RepoRoot" rev-parse --verify "${TargetCommit}^{commit}" 2>$null)
    Assert-FunctionalResult ($LASTEXITCODE -eq 0 -and $resolvedTarget.Count -eq 1) "target commit '$TargetCommit' does not exist."
    $TargetCommit = $resolvedTarget[0].Trim()
    Assert-FunctionalResult ([string]$result.subject_commit -eq $TargetCommit) "result subject_commit must equal target commit '$TargetCommit'."
    & git -C $RepoRoot -c "safe.directory=$RepoRoot" diff --quiet $TargetCommit --
    Assert-FunctionalResult ($LASTEXITCODE -eq 0) "tracked working tree differs from target commit '$TargetCommit'."
}

Write-Host "[functional-runtime-gate] passed — route=$($result.route), scope=$($scopeProperty.Value), full_route_coverage=$($fullRouteCoverageProperty.Value), runtime_actions=$($runtimeActions.Count), artifacts=$($artifacts.Count)"
