[CmdletBinding()]
param(
    [string] $RepoRoot = '',
    [string] $ManifestPath = '',
    [string] $SourceRoot = '',
    [switch] $VerifyOrigin
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
$scopeLibrary = Join-Path $RepoRoot 'scripts\lib\design-system-gate.ps1'
if (-not (Test-Path -LiteralPath $scopeLibrary -PathType Leaf)) {
    throw "Design-system scope library not found: $scopeLibrary"
}
. $scopeLibrary
if (-not (Test-Path -LiteralPath $ManifestPath -PathType Leaf)) {
    throw "Design-system reference manifest not found: $ManifestPath"
}

function Assert-Reference {
    param(
        [Parameter(Mandatory = $true)][bool] $Condition,
        [Parameter(Mandatory = $true)][string] $Message
    )
    if (-not $Condition) { throw "[design-reference-gate] $Message" }
}

function Get-Sha256 {
    param([Parameter(Mandatory = $true)][string] $LiteralPath)
    return (Get-FileHash -Algorithm SHA256 -LiteralPath $LiteralPath).Hash.ToLowerInvariant()
}

function Get-CanonicalDigest {
    param([Parameter(Mandatory = $true)][object[]] $Files)

    [string[]]$lines = @($Files | ForEach-Object {
        '{0}{1}{2}{1}{3}' -f ([string]$_.path), [char]0, ([long]$_.bytes), ([string]$_.sha256).ToLowerInvariant()
    })
    [Array]::Sort($lines, [System.StringComparer]::Ordinal)
    $canonical = $lines -join "`n"
    $bytes = [System.Text.UTF8Encoding]::new($false).GetBytes($canonical)
    $hash = [System.Security.Cryptography.SHA256]::Create()
    try {
        return ([System.BitConverter]::ToString($hash.ComputeHash($bytes))).Replace('-', '').ToLowerInvariant()
    } finally {
        $hash.Dispose()
    }
}

function Get-OriginFiles {
    param([Parameter(Mandatory = $true)][string] $Root)

    $resolvedRoot = (Resolve-Path -LiteralPath $Root).Path.TrimEnd('\')
    return @(Get-ChildItem -LiteralPath $resolvedRoot -Recurse -File | Where-Object {
        $relative = $_.FullName.Substring($resolvedRoot.Length + 1).Replace('\', '/')
        $relative -notmatch '^(?:\.git|\.cache|node_modules)/'
    } | ForEach-Object {
        [pscustomobject]@{
            path = $_.FullName.Substring($resolvedRoot.Length + 1).Replace('\', '/')
            bytes = $_.Length
            sha256 = Get-Sha256 -LiteralPath $_.FullName
        }
    } | Sort-Object path)
}

$manifest = Get-Content -LiteralPath $ManifestPath -Raw | ConvertFrom-Json

Assert-Reference ($manifest.schema_version -eq 1) 'schema_version must be 1.'
Assert-Reference ($manifest.kind -eq 'ai-bim-frontend-design-reference') 'kind is not the approved frontend design reference kind.'
Assert-Reference ($manifest.status -eq 'approved') 'manifest status must be approved.'
Assert-Reference ($manifest.authority.authoring_origin -eq 'C:\Repos\design\desigin-system') 'authoring_origin must identify the approved read-only design source.'
Assert-Reference ($manifest.authority.origin_mode -eq 'read_only') 'the upstream design source must remain read-only.'
Assert-Reference ($manifest.authority.ci_gate_mode -eq 'tracked_snapshot_only') 'CI must use the tracked snapshot, not a machine-local path.'
Assert-Reference ($manifest.authority.rebaseline_policy -eq 'explicit_confirmation_required') 'rebaseline must require explicit confirmation.'

$sourceFiles = @($manifest.source.files)
Assert-Reference ($sourceFiles.Count -gt 0) 'source.files must not be empty.'
$duplicateSourcePaths = @($sourceFiles | Group-Object path | Where-Object Count -gt 1)
Assert-Reference ($duplicateSourcePaths.Count -eq 0) 'source.files contains duplicate paths.'
foreach ($file in $sourceFiles) {
    Assert-Reference (-not [string]::IsNullOrWhiteSpace([string]$file.path)) 'source file path must not be empty.'
    Assert-Reference ([long]$file.bytes -ge 0) "source file '$($file.path)' has invalid bytes."
    Assert-Reference ([string]$file.sha256 -match '^[0-9a-f]{64}$') "source file '$($file.path)' has an invalid SHA-256."
    Assert-Reference ([string]$file.path -notmatch '^(?:\.git|\.cache|node_modules)/') "source file '$($file.path)' is non-rendering repository/cache state."
}
Assert-Reference (@($sourceFiles | Where-Object path -eq $manifest.source.entrypoint).Count -eq 1) 'source entrypoint is not pinned exactly once.'
Assert-Reference (@($sourceFiles | Where-Object path -eq 'design-doc.html').Count -eq 1) 'design-doc.html must be pinned exactly once as part of the approved design authority.'
$sourceDigest = Get-CanonicalDigest -Files $sourceFiles
Assert-Reference ($sourceDigest -eq $manifest.source.snapshot_sha256) 'source.snapshot_sha256 does not match the pinned file set.'

$fidelity = $manifest.fidelity_contract
Assert-Reference ($fidelity.browser -eq 'chromium') 'browser must be chromium.'
Assert-Reference ($fidelity.platform -eq 'windows') 'platform must be windows because the approved goldens were captured on Windows.'
Assert-Reference ($fidelity.ci_runner_label -eq 'windows-2025') 'design CI runner label must be pinned to windows-2025 instead of windows-latest.'
Assert-Reference ($fidelity.playwright_version -eq '1.61.1') 'Playwright version must remain exactly pinned.'
Assert-Reference ($fidelity.chromium_revision -eq '1228') 'Playwright Chromium revision must remain exactly pinned.'
Assert-Reference ($fidelity.chromium_version -eq '149.0.7827.55') 'Playwright Chromium browser version must remain exactly pinned.'
Assert-Reference ([double]$fidelity.device_scale_factor -eq 1) 'device_scale_factor must be 1.'
$viewerPackage = Get-Content -LiteralPath (Join-Path $RepoRoot 'web-viewer-sample\package.json') -Raw | ConvertFrom-Json
Assert-Reference ($viewerPackage.devDependencies.'@playwright/test' -eq $fidelity.playwright_version) 'viewer @playwright/test must equal the manifest Playwright pin.'
Assert-Reference ($viewerPackage.devDependencies.pixelmatch -eq '7.1.0') 'pixelmatch must remain exactly pinned.'
Assert-Reference ($viewerPackage.devDependencies.pngjs -eq '7.0.0') 'pngjs must remain exactly pinned.'
Assert-Reference ($fidelity.locale -eq 'zh-TW') 'locale must be zh-TW.'
Assert-Reference ($fidelity.timezone -eq 'Asia/Taipei') 'timezone must be Asia/Taipei.'
Assert-Reference ([bool]$fidelity.fonts_ready_required) 'font readiness must be required.'
Assert-Reference ([bool]$fidelity.animations_disabled) 'animations must be disabled for comparison.'
Assert-Reference ([double]$fidelity.pixelmatch_color_threshold -eq 0.1) 'pixelmatch_color_threshold must be exactly 0.1.'
Assert-Reference (-not [bool]$fidelity.include_antialiasing) 'antialias-only differences must remain excluded.'
Assert-Reference ([double]$fidelity.max_diff_pixel_ratio -eq 0.01) 'max_diff_pixel_ratio must be exactly 0.01.'
Assert-Reference ([double]$fidelity.semantic_parity_required -eq 1) 'semantic parity must be exactly 1 (100%).'
Assert-Reference ($fidelity.live_surface_policy -eq 'capture_fails_if_present') 'live WebRTC/GPU surfaces must fail design capture instead of entering pixel comparison.'
Assert-Reference ((@($fidelity.live_surface_selectors | Sort-Object) -join '|') -eq ((@('video', "iframe[src*='/ui/open']") | Sort-Object) -join '|')) 'live surface selectors drifted.'
Assert-Reference ([bool]$fidelity.accessibility_and_security_may_not_be_removed_for_pixel_parity) 'accessibility/security preservation must remain mandatory.'

$viewports = @($fidelity.viewports)
Assert-Reference ($viewports.Count -eq 2) 'exactly two approved viewports are required.'
$viewportMap = @{}
foreach ($viewport in $viewports) { $viewportMap[[string]$viewport.id] = $viewport }
Assert-Reference ($viewportMap.ContainsKey('1440x900')) '1440x900 viewport is missing.'
Assert-Reference ($viewportMap.ContainsKey('1920x1080')) '1920x1080 viewport is missing.'
Assert-Reference ($viewportMap['1440x900'].width -eq 1440 -and $viewportMap['1440x900'].height -eq 900) '1440x900 viewport dimensions drifted.'
Assert-Reference ($viewportMap['1920x1080'].width -eq 1920 -and $viewportMap['1920x1080'].height -eq 1080) '1920x1080 viewport dimensions drifted.'

Assert-Reference (($manifest.token_projection.order -join '>') -eq 'primitive>semantic>component') 'token projection must remain primitive > semantic > component.'
Assert-Reference ([bool]$manifest.token_projection.production_tokens_are_not_upstream_authority) 'production tokens must remain a downstream projection.'

$changeScope = $manifest.change_scope_contract
Assert-Reference ($changeScope.policy -eq 'manifest_driven_and_refactorable') 'frontend change scope must remain manifest-driven and refactorable.'
Assert-Reference ($changeScope.approved_product_screen_policy -eq 'all_manifest_screens') 'approved product changes must exercise all approved screens.'
Assert-Reference ($changeScope.unknown_product_path_policy -eq 'fail_closed_until_manifest_update') 'unknown product paths must fail closed until the manifest is updated.'
foreach ($collectionName in @('approved_product_path_patterns', 'reference_missing_product_path_patterns', 'frontend_candidate_path_patterns', 'non_product_path_patterns', 'gate_infrastructure_path_patterns')) {
    $patterns = @($changeScope.$collectionName)
    Assert-Reference ($patterns.Count -gt 0) "change_scope_contract.$collectionName must not be empty."
    foreach ($pattern in $patterns) {
        Assert-Reference ([string]$pattern -match '^\^') "change_scope_contract.$collectionName contains a non-anchored pattern."
        try { [void][regex]::new([string]$pattern) } catch { throw "[design-reference-gate] change_scope_contract.$collectionName contains an invalid regex: $pattern" }
    }
}
$approvedSurfaces = @($changeScope.approved_product_surfaces)
$missingSurfaces = @($changeScope.reference_missing_product_surfaces)
Assert-Reference ($approvedSurfaces.Count -gt 0) 'change_scope_contract.approved_product_surfaces must not be empty.'
Assert-Reference ($missingSurfaces.Count -gt 0) 'change_scope_contract.reference_missing_product_surfaces must not be empty.'
Assert-Reference (@(@($approvedSurfaces + $missingSurfaces) | Group-Object id | Where-Object Count -gt 1).Count -eq 0) 'frontend product surface IDs must be unique.'
foreach ($surface in $approvedSurfaces) {
    Assert-Reference ($surface.screen_policy -eq 'all_manifest_screens') "approved surface '$($surface.id)' must exercise all manifest screens."
    Assert-Reference ([bool]$surface.also_affects_reference_missing_routes) "approved shared surface '$($surface.id)' must disclose reference_missing routes."
    try { [void][regex]::new([string]$surface.path_pattern) } catch { throw "[design-reference-gate] approved surface '$($surface.id)' has an invalid path regex." }
    Assert-Reference ([string]$surface.path_pattern -in @($changeScope.approved_product_path_patterns)) "approved surface '$($surface.id)' is absent from approved_product_path_patterns."
    Assert-Reference ([string]$surface.path_pattern -in @($changeScope.frontend_candidate_path_patterns)) "approved surface '$($surface.id)' is absent from frontend_candidate_path_patterns."
}
foreach ($surface in $missingSurfaces) {
    Assert-Reference (-not [string]::IsNullOrWhiteSpace([string]$surface.reference)) "reference_missing surface '$($surface.id)' has no reference label."
    try { [void][regex]::new([string]$surface.path_pattern) } catch { throw "[design-reference-gate] reference_missing surface '$($surface.id)' has an invalid path regex." }
    Assert-Reference ([string]$surface.path_pattern -in @($changeScope.reference_missing_product_path_patterns)) "reference_missing surface '$($surface.id)' is absent from reference_missing_product_path_patterns."
    Assert-Reference ([string]$surface.path_pattern -in @($changeScope.frontend_candidate_path_patterns)) "reference_missing surface '$($surface.id)' is absent from frontend_candidate_path_patterns."
}
$bootstrapRules = @($changeScope.bootstrap_gate_infrastructure_json_rules)
Assert-Reference ($bootstrapRules.Count -gt 0) 'bootstrap_gate_infrastructure_json_rules must make the first gate-tool dependency change explicit.'
Assert-Reference (@($bootstrapRules | Group-Object path | Where-Object Count -gt 1).Count -eq 0) 'bootstrap gate JSON rule paths must be unique.'
foreach ($rule in $bootstrapRules) {
    Assert-Reference ([string]$rule.path -match '^[^/]+(?:/[^/]+)+$') 'bootstrap gate JSON rule path must be a normalized repo-relative file.'
    Assert-Reference ([bool]$rule.only_when_base_manifest_absent) "bootstrap gate JSON rule '$($rule.path)' must be one-time only."
    Assert-Reference (Test-DesignSystemPathPatterns -Path ([string]$rule.path) -Patterns @($changeScope.approved_product_path_patterns)) "bootstrap gate JSON rule '$($rule.path)' must otherwise be product-classified."
    $sections = @($rule.sections)
    Assert-Reference ($sections.Count -gt 0) "bootstrap gate JSON rule '$($rule.path)' has no sections."
    Assert-Reference (@($sections | Group-Object name | Where-Object Count -gt 1).Count -eq 0) "bootstrap gate JSON rule '$($rule.path)' repeats a section."
    foreach ($section in $sections) {
        Assert-Reference (-not [string]::IsNullOrWhiteSpace([string]$section.name)) "bootstrap gate JSON rule '$($rule.path)' has an empty section name."
        $entries = @($section.entries.PSObject.Properties)
        Assert-Reference ($entries.Count -gt 0) "bootstrap gate JSON rule '$($rule.path)' section '$($section.name)' has no entries."
        foreach ($entry in $entries) {
            Assert-Reference (-not [string]::IsNullOrWhiteSpace([string]$entry.Value)) "bootstrap gate JSON rule '$($rule.path)' entry '$($entry.Name)' has no pinned value."
        }
    }
}

$semanticStates = @($manifest.required_semantic_states)
$requiredStates = @('navigation', 'primary_actions', 'loading', 'empty', 'success', 'warning', 'failure', 'disabled', 'confirmation', 'i18n_zh_tw', 'runtime_truth')
Assert-Reference ((($semanticStates | Sort-Object) -join '|') -eq (($requiredStates | Sort-Object) -join '|')) 'required semantic state set drifted.'
$semanticContract = $manifest.semantic_contract
Assert-Reference ($semanticContract.schema_version -eq 2) 'semantic_contract.schema_version must be 2.'
Assert-Reference ($semanticContract.authority -eq 'branch_protected_playwright_output_only') 'semantic evidence authority must be branch-protected Playwright output.'
Assert-Reference ([string]$semanticContract.enforcement_status -in @('required_check_not_configured', 'required_check_configured')) 'semantic required-check enforcement status is invalid.'
Assert-Reference (-not [bool]$semanticContract.external_result_input_allowed) 'external semantic-result input must remain forbidden.'
Assert-Reference ($semanticContract.result_role -eq 'ci_output_not_gate_input') 'semantic result must remain CI output, not gate input.'
Assert-Reference ((@($semanticContract.required_case_ids | Sort-Object) -join '|') -eq (($requiredStates | Sort-Object) -join '|')) 'semantic required_case_ids must match the approved state vocabulary.'
$implementedCases = @($semanticContract.implemented_case_ids)
Assert-Reference (@($implementedCases | Where-Object { $_ -notin $requiredStates }).Count -eq 0) 'semantic implemented_case_ids contains an unknown case.'
if ($semanticContract.status -eq 'executable') {
    Assert-Reference ((@($implementedCases | Sort-Object) -join '|') -eq (($requiredStates | Sort-Object) -join '|')) 'executable semantic contract must implement every required case.'
} else {
    Assert-Reference ($semanticContract.status -eq 'state_variants_reference_missing') 'semantic_contract.status must be executable or state_variants_reference_missing.'
    Assert-Reference ($implementedCases.Count -eq 0) 'reference-missing semantic variants cannot claim implemented cases.'
}
$runtimeContract = $manifest.functional_runtime_contract
Assert-Reference ($runtimeContract.schema_version -eq 1) 'functional_runtime_contract.schema_version must be 1.'
Assert-Reference ([string]$runtimeContract.status -in @('machine_gate_missing', 'executable')) 'functional/runtime machine-gate status is invalid.'
Assert-Reference ($runtimeContract.authority -eq 'branch_protected_machine_output_required') 'functional/runtime authority must require branch-protected machine output.'
Assert-Reference ([string]$runtimeContract.enforcement_status -in @('required_check_not_configured', 'required_check_configured')) 'functional/runtime required-check enforcement status is invalid.'
Assert-Reference (-not [bool]$runtimeContract.external_result_input_allowed) 'external functional/runtime result input must remain forbidden.'

$screens = @($manifest.screens)
Assert-Reference ($screens.Count -gt 0) 'screens must not be empty.'
Assert-Reference (@($screens | Group-Object id | Where-Object Count -gt 1).Count -eq 0) 'screen IDs must be unique.'
$mappedRoutes = @()
$baselineDescriptors = @()
$baselineRoot = [System.IO.Path]::GetFullPath((Join-Path $RepoRoot 'docs\plans\design-system-baseline'))
$baselinePrefix = $baselineRoot.TrimEnd('\') + '\'
foreach ($screen in $screens) {
    Assert-Reference ([string]$screen.id -match '^[a-z0-9]+(?:[.-][a-z0-9]+)*$') "screen ID '$($screen.id)' is invalid."
    $routes = @($screen.production_routes)
    Assert-Reference ($routes.Count -gt 0) "screen '$($screen.id)' has no production route."
    foreach ($route in $routes) {
        Assert-Reference ([string]$route -match '^#[a-z0-9-]+$') "screen '$($screen.id)' has invalid route '$route'."
        $mappedRoutes += [string]$route
    }
    foreach ($viewport in $viewports) {
        $baseline = $screen.baselines.PSObject.Properties[[string]$viewport.id].Value
        Assert-Reference ($null -ne $baseline) "screen '$($screen.id)' lacks baseline '$($viewport.id)'."
        Assert-Reference ([string]$baseline.path -match '^docs/plans/design-system-baseline/') "screen '$($screen.id)' baseline escaped docs/plans/design-system-baseline."
        Assert-Reference ([string]$baseline.sha256 -match '^[0-9a-f]{64}$') "screen '$($screen.id)' baseline '$($viewport.id)' has no valid SHA-256."
        $absolute = [System.IO.Path]::GetFullPath((Join-Path $RepoRoot ([string]$baseline.path).Replace('/', '\')))
        Assert-Reference ($absolute.StartsWith($baselinePrefix, [System.StringComparison]::OrdinalIgnoreCase)) "screen '$($screen.id)' baseline escaped docs/plans/design-system-baseline."
        Assert-Reference (Test-Path -LiteralPath $absolute -PathType Leaf) "baseline file is missing: $($baseline.path)"
        $actualHash = Get-Sha256 -LiteralPath $absolute
        Assert-Reference ($actualHash -eq $baseline.sha256) "baseline hash mismatch: $($baseline.path)"
        $baselineDescriptors += [pscustomobject]@{
            path = [string]$baseline.path
            bytes = (Get-Item -LiteralPath $absolute).Length
            sha256 = $actualHash
        }
    }
}
Assert-Reference (@($mappedRoutes | Group-Object | Where-Object Count -gt 1).Count -eq 0) 'a production route is mapped to more than one approved screen.'
Assert-Reference (@($baselineDescriptors | Group-Object path | Where-Object Count -gt 1).Count -eq 0) 'a golden baseline path is reused by more than one screen or viewport.'
$missingRoutes = @($manifest.routes_without_approved_pixel_reference)
Assert-Reference (@($missingRoutes | Where-Object { [string]$_ -notmatch '^#[a-z0-9-]+$' }).Count -eq 0) 'routes_without_approved_pixel_reference contains an invalid route.'
Assert-Reference (@($missingRoutes | Group-Object | Where-Object Count -gt 1).Count -eq 0) 'routes_without_approved_pixel_reference contains duplicates.'
Assert-Reference (@($missingRoutes | Where-Object { $_ -in $mappedRoutes }).Count -eq 0) 'a route cannot be both mapped and reference_missing.'
$routeInventory = @($manifest.route_inventory)
$expectedRoutes = @('#home', '#a1', '#a2', '#a3', '#a4', '#a5', '#a6', '#a7', '#a8', '#a9', '#a10', '#issues', '#reports', '#viewer', '#gpu', '#conv', '#sessions', '#instances', '#minio', '#runtime', '#admin', '#spec', '#review')
Assert-Reference ($routeInventory.Count -eq $expectedRoutes.Count) 'route_inventory must cover the 22 canonical routes plus independent #review.'
Assert-Reference (@($routeInventory | Group-Object route | Where-Object Count -gt 1).Count -eq 0) 'route_inventory contains duplicate routes.'
$inventoryRoutes = @($routeInventory | ForEach-Object { [string]$_.route })
Assert-Reference ((@($inventoryRoutes | Sort-Object) -join '|') -eq ((@($expectedRoutes | Sort-Object)) -join '|')) 'route_inventory does not exactly cover the 22 canonical routes plus #review.'
foreach ($entry in $routeInventory) {
    Assert-Reference ([string]$entry.route -match '^#[a-z0-9-]+$') "route_inventory contains an invalid route '$($entry.route)'."
    Assert-Reference ([string]$entry.status -in @('approved', 'reference_missing')) "route_inventory route '$($entry.route)' has an invalid status."
    $screenIdProperty = $entry.PSObject.Properties['screen_id']
    $screenId = if ($null -eq $screenIdProperty) { '' } else { [string]$screenIdProperty.Value }
    if ($entry.status -eq 'approved') {
        Assert-Reference (-not [string]::IsNullOrWhiteSpace($screenId)) "approved route '$($entry.route)' has no screen_id."
        $mappedScreen = @($screens | Where-Object { [string]$entry.route -in @($_.production_routes) -and [string]$_.id -eq $screenId })
        Assert-Reference ($mappedScreen.Count -eq 1) "approved route '$($entry.route)' does not map exactly to screen '$screenId'."
    } else {
        Assert-Reference ([string]::IsNullOrWhiteSpace($screenId)) "reference_missing route '$($entry.route)' must not claim a screen_id."
        Assert-Reference ([string]$entry.route -in $missingRoutes) "reference_missing route '$($entry.route)' is absent from routes_without_approved_pixel_reference."
    }
}
Assert-Reference ((@($mappedRoutes | Sort-Object) -join '|') -eq ((@($routeInventory | Where-Object status -eq 'approved' | ForEach-Object route | Sort-Object)) -join '|')) 'approved route inventory and screen mappings differ.'
Assert-Reference ((@($missingRoutes | Sort-Object) -join '|') -eq ((@($routeInventory | Where-Object status -eq 'reference_missing' | ForEach-Object route | Sort-Object)) -join '|')) 'reference_missing route inventory and list differ.'
$baselineDigest = Get-CanonicalDigest -Files $baselineDescriptors
Assert-Reference ($baselineDigest -eq $manifest.baseline_snapshot_sha256) 'baseline_snapshot_sha256 does not match the tracked golden files.'

if ($VerifyOrigin -or -not [string]::IsNullOrWhiteSpace($SourceRoot)) {
    if ([string]::IsNullOrWhiteSpace($SourceRoot)) {
        $SourceRoot = if (-not [string]::IsNullOrWhiteSpace($env:DESIGN_SYSTEM_REFERENCE_ROOT)) {
            $env:DESIGN_SYSTEM_REFERENCE_ROOT
        } else {
            [string]$manifest.authority.authoring_origin
        }
    }
    Assert-Reference (Test-Path -LiteralPath $SourceRoot -PathType Container) "approved authoring origin is unavailable: $SourceRoot"
    $originFiles = @(Get-OriginFiles -Root $SourceRoot)
    Assert-Reference ($originFiles.Count -eq $sourceFiles.Count) 'authoring origin file set drifted; explicit rebaseline approval is required.'
    $originDigest = Get-CanonicalDigest -Files $originFiles
    Assert-Reference ($originDigest -eq $manifest.source.snapshot_sha256) 'authoring origin drifted; explicit rebaseline approval is required.'
}

Write-Host "[design-reference-gate] passed — $($screens.Count) screens, $($baselineDescriptors.Count) golden files, source=$($manifest.source.snapshot_sha256)"
