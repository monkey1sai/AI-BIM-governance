Set-StrictMode -Version Latest

function ConvertTo-DesignSystemRepoPath {
    param([Parameter(Mandatory = $true)][string] $Path)

    $normalized = $Path.Trim().Replace('\', '/')
    while ($normalized.StartsWith('./', [System.StringComparison]::Ordinal)) {
        $normalized = $normalized.Substring(2)
    }
    return $normalized.TrimStart('/')
}

function Test-DesignSystemPathPatterns {
    param(
        [Parameter(Mandatory = $true)][string] $Path,
        [AllowNull()][AllowEmptyCollection()][object[]] $Patterns = @()
    )

    if ($null -eq $Patterns) { return $false }
    foreach ($pattern in $Patterns) {
        $patternText = [string]$pattern
        if ([string]::IsNullOrWhiteSpace($patternText)) { continue }
        if ($Path -match $patternText) { return $true }
    }
    return $false
}

function Get-DesignSystemGitText {
    param(
        [Parameter(Mandatory = $true)][string] $RepoRoot,
        [Parameter(Mandatory = $true)][string] $Ref,
        [Parameter(Mandatory = $true)][string] $Path
    )

    if ([string]::IsNullOrWhiteSpace($Ref)) { return $null }
    $value = @(& git -C $RepoRoot -c "safe.directory=$RepoRoot" show "${Ref}:$Path" 2>$null)
    if ($LASTEXITCODE -ne 0) { return $null }
    return $value -join "`n"
}

function Get-DesignSystemManifestAtRef {
    param(
        [Parameter(Mandatory = $true)][string] $RepoRoot,
        [Parameter(Mandatory = $true)][string] $ManifestRelativePath,
        [string] $Ref = ''
    )

    $raw = if ([string]::IsNullOrWhiteSpace($Ref)) {
        $absolute = Join-Path $RepoRoot $ManifestRelativePath
        if (-not (Test-Path -LiteralPath $absolute -PathType Leaf)) { return $null }
        Get-Content -LiteralPath $absolute -Raw
    } else {
        Get-DesignSystemGitText -RepoRoot $RepoRoot -Ref $Ref -Path $ManifestRelativePath
    }
    if ([string]::IsNullOrWhiteSpace([string]$raw)) { return $null }
    return $raw | ConvertFrom-Json
}

function Test-DesignSystemBootstrapJsonRule {
    param(
        [Parameter(Mandatory = $true)][string] $RepoRoot,
        [Parameter(Mandatory = $true)] $Rule,
        [Parameter(Mandatory = $true)][string] $BaseSha,
        [Parameter(Mandatory = $true)][string] $HeadSha
    )

    $baseRaw = Get-DesignSystemGitText -RepoRoot $RepoRoot -Ref $BaseSha -Path ([string]$Rule.path)
    $headRaw = Get-DesignSystemGitText -RepoRoot $RepoRoot -Ref $HeadSha -Path ([string]$Rule.path)
    if ([string]::IsNullOrWhiteSpace([string]$baseRaw) -or [string]::IsNullOrWhiteSpace([string]$headRaw)) { return $false }

    try {
        $base = $baseRaw | ConvertFrom-Json
        $head = $headRaw | ConvertFrom-Json
    } catch {
        return $false
    }

    foreach ($sectionRule in @($Rule.sections)) {
        $sectionName = [string]$sectionRule.name
        $baseSection = $base.PSObject.Properties[$sectionName]
        $headSection = $head.PSObject.Properties[$sectionName]
        if ($null -eq $baseSection -or $null -eq $headSection) { return $false }
        foreach ($entry in $sectionRule.entries.PSObject.Properties) {
            $headValue = $headSection.Value.PSObject.Properties[$entry.Name]
            if ($null -eq $headValue -or [string]$headValue.Value -ne [string]$entry.Value) { return $false }
            $baseSection.Value.PSObject.Properties.Remove($entry.Name)
            $headSection.Value.PSObject.Properties.Remove($entry.Name)
        }
    }

    $baseComparable = $base | ConvertTo-Json -Depth 100 -Compress
    $headComparable = $head | ConvertTo-Json -Depth 100 -Compress
    return $baseComparable -ceq $headComparable
}

function ConvertTo-DesignSystemPairedRebaselineComparableManifest {
    param([Parameter(Mandatory = $true)] $Manifest)

    $copy = ($Manifest | ConvertTo-Json -Depth 100 | ConvertFrom-Json)
    foreach ($screen in @($copy.screens)) {
        $screen.PSObject.Properties.Remove('baselines')
        $screen.PSObject.Properties.Remove('baseline_provenance')
    }
    $copy.PSObject.Properties.Remove('baseline_snapshot_sha256')
    return $copy | ConvertTo-Json -Depth 100 -Compress
}

function Get-DesignSystemBaselinePaths {
    param([Parameter(Mandatory = $true)] $Manifest)

    return @($Manifest.screens | ForEach-Object {
        @($_.baselines.PSObject.Properties | ForEach-Object { ConvertTo-DesignSystemRepoPath -Path ([string]$_.Value.path) })
    } | Sort-Object -Unique)
}

function Test-DesignSystemPairedRebaseline {
    param(
        [Parameter(Mandatory = $true)] $BaseManifest,
        [Parameter(Mandatory = $true)] $HeadManifest,
        [Parameter(Mandatory = $true)][string[]] $ChangedPaths,
        [Parameter(Mandatory = $true)][string[]] $ReferenceAuthorityPaths,
        [Parameter(Mandatory = $true)][bool] $HasApprovedSurface
    )

    if (-not $HasApprovedSurface) { return $false }
    if ('docs/plans/design-system-reference.manifest.json' -notin $ReferenceAuthorityPaths) { return $false }
    if ((ConvertTo-DesignSystemPairedRebaselineComparableManifest -Manifest $BaseManifest) -cne
        (ConvertTo-DesignSystemPairedRebaselineComparableManifest -Manifest $HeadManifest)) { return $false }

    $baseBaselinePaths = Get-DesignSystemBaselinePaths -Manifest $BaseManifest
    $headBaselinePaths = Get-DesignSystemBaselinePaths -Manifest $HeadManifest
    if (($baseBaselinePaths -join '|') -cne ($headBaselinePaths -join '|')) { return $false }

    $changedBaselinePaths = @($ChangedPaths | Where-Object { $_ -match '^docs/plans/design-system-baseline/' })
    if ($changedBaselinePaths.Count -eq 0 -or @($changedBaselinePaths | Where-Object { $_ -notin $headBaselinePaths }).Count -gt 0) {
        return $false
    }

    foreach ($screen in @($HeadManifest.screens)) {
        $screenBaselinePaths = @($screen.baselines.PSObject.Properties | ForEach-Object {
            ConvertTo-DesignSystemRepoPath -Path ([string]$_.Value.path)
        })
        if (@($screenBaselinePaths | Where-Object { $_ -in $changedBaselinePaths }).Count -eq 0) { continue }
        $provenance = $screen.PSObject.Properties['baseline_provenance']
        if ($null -eq $provenance -or
            [string]$provenance.Value.authority -ne 'canonical_product_surface' -or
            [string]::IsNullOrWhiteSpace([string]$provenance.Value.canonical_route) -or
            [string]::IsNullOrWhiteSpace([string]$provenance.Value.capture_runner) -or
            [string]::IsNullOrWhiteSpace([string]$provenance.Value.approval)) {
            return $false
        }
    }
    return $true
}

function Get-DesignSystemManifestScope {
    param(
        [Parameter(Mandatory = $true)] $Manifest,
        [Parameter(Mandatory = $true)][string[]] $ChangedPaths,
        [string[]] $AdditionalGateInfrastructurePaths = @()
    )

    $contract = $Manifest.change_scope_contract
    $approvedSurfaceIds = [System.Collections.Generic.List[string]]::new()
    $referenceMissingSurfaceIds = [System.Collections.Generic.List[string]]::new()
    $approvedPaths = [System.Collections.Generic.List[string]]::new()
    $referenceMissingPaths = [System.Collections.Generic.List[string]]::new()
    $nonProductPaths = [System.Collections.Generic.List[string]]::new()
    $gateInfrastructurePaths = [System.Collections.Generic.List[string]]::new()
    $unknownPaths = [System.Collections.Generic.List[string]]::new()

    foreach ($path in $ChangedPaths) {
        if ($path -in $AdditionalGateInfrastructurePaths -or (Test-DesignSystemPathPatterns -Path $path -Patterns @($contract.gate_infrastructure_path_patterns))) {
            $gateInfrastructurePaths.Add($path)
            continue
        }
        if (Test-DesignSystemPathPatterns -Path $path -Patterns @($contract.non_product_path_patterns)) {
            $nonProductPaths.Add($path)
            continue
        }

        $matched = $false
        foreach ($surface in @($contract.approved_product_surfaces)) {
            if ($path -match [string]$surface.path_pattern) {
                $approvedSurfaceIds.Add([string]$surface.id)
                $approvedPaths.Add($path)
                $matched = $true
            }
        }
        foreach ($surface in @($contract.reference_missing_product_surfaces)) {
            if ($path -match [string]$surface.path_pattern) {
                $referenceMissingSurfaceIds.Add([string]$surface.id)
                $referenceMissingPaths.Add($path)
                $matched = $true
            }
        }
        if (-not $matched -and (Test-DesignSystemPathPatterns -Path $path -Patterns @($contract.frontend_candidate_path_patterns))) {
            $unknownPaths.Add($path)
        }
    }

    return [pscustomobject]@{
        manifest = $Manifest
        approved_surface_ids = @($approvedSurfaceIds | Sort-Object -Unique)
        reference_missing_surface_ids = @($referenceMissingSurfaceIds | Sort-Object -Unique)
        approved_paths = @($approvedPaths | Sort-Object -Unique)
        reference_missing_paths = @($referenceMissingPaths | Sort-Object -Unique)
        non_product_paths = @($nonProductPaths | Sort-Object -Unique)
        gate_infrastructure_paths = @($gateInfrastructurePaths | Sort-Object -Unique)
        unknown_paths = @($unknownPaths | Sort-Object -Unique)
    }
}

function Get-DesignSystemChangeScope {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string] $RepoRoot,
        [Parameter(Mandatory = $true)][string[]] $ChangedPaths,
        [string] $BaseSha = '',
        [string] $HeadSha = '',
        [string] $ManifestRelativePath = 'docs/plans/design-system-reference.manifest.json'
    )

    $RepoRoot = (Resolve-Path -LiteralPath $RepoRoot).Path
    $normalizedPaths = @($ChangedPaths | ForEach-Object { ConvertTo-DesignSystemRepoPath -Path ([string]$_) } | Where-Object { $_ } | Sort-Object -Unique)
    $baseManifest = Get-DesignSystemManifestAtRef -RepoRoot $RepoRoot -ManifestRelativePath $ManifestRelativePath -Ref $BaseSha
    $headManifest = if ([string]::IsNullOrWhiteSpace($HeadSha)) {
        Get-DesignSystemManifestAtRef -RepoRoot $RepoRoot -ManifestRelativePath $ManifestRelativePath
    } else {
        Get-DesignSystemManifestAtRef -RepoRoot $RepoRoot -ManifestRelativePath $ManifestRelativePath -Ref $HeadSha
    }
    if ($null -eq $headManifest) {
        throw '[design-scope-gate] head design-system manifest is unavailable.'
    }

    $bootstrapGatePaths = @()
    if ($null -eq $baseManifest -and -not [string]::IsNullOrWhiteSpace($BaseSha) -and -not [string]::IsNullOrWhiteSpace($HeadSha)) {
        foreach ($rule in @($headManifest.change_scope_contract.bootstrap_gate_infrastructure_json_rules)) {
            $rulePath = ConvertTo-DesignSystemRepoPath -Path ([string]$rule.path)
            if ([bool]$rule.only_when_base_manifest_absent -and $rulePath -in $normalizedPaths -and
                (Test-DesignSystemBootstrapJsonRule -RepoRoot $RepoRoot -Rule $rule -BaseSha $BaseSha -HeadSha $HeadSha)) {
                $bootstrapGatePaths += $rulePath
            }
        }
    }

    $scopes = @()
    if ($null -ne $baseManifest) {
        $scopes += Get-DesignSystemManifestScope -Manifest $baseManifest -ChangedPaths $normalizedPaths
    }
    $scopes += Get-DesignSystemManifestScope -Manifest $headManifest -ChangedPaths $normalizedPaths -AdditionalGateInfrastructurePaths $bootstrapGatePaths

    $approvedSurfaceIds = @($scopes | ForEach-Object { $_.approved_surface_ids } | Sort-Object -Unique)
    $missingSurfaceIds = @($scopes | ForEach-Object { $_.reference_missing_surface_ids } | Sort-Object -Unique)
    $ownedPaths = @($scopes | ForEach-Object { @($_.approved_paths) + @($_.reference_missing_paths) } | Sort-Object -Unique)
    $unknownPaths = @($scopes | ForEach-Object { $_.unknown_paths } | Where-Object { $_ -notin $ownedPaths } | Sort-Object -Unique)
    $nonProductPaths = @($scopes | ForEach-Object { $_.non_product_paths } | Sort-Object -Unique)
    $gatePaths = @($scopes | ForEach-Object { $_.gate_infrastructure_paths } | Sort-Object -Unique)
    $referenceAuthorityPaths = @($normalizedPaths | Where-Object {
        $candidate = $_
        @($scopes | Where-Object {
            Test-DesignSystemPathPatterns -Path $candidate -Patterns @($_.manifest.change_scope_contract.reference_authority_path_patterns)
        }).Count -gt 0
    } | Sort-Object -Unique)
    $requiredScreenIds = @()
    $referenceMissing = [System.Collections.Generic.List[string]]::new()
    $alsoAffectsMissing = $false

    foreach ($scope in $scopes) {
        foreach ($surfaceId in $scope.approved_surface_ids) {
            $surface = @($scope.manifest.change_scope_contract.approved_product_surfaces | Where-Object id -eq $surfaceId | Select-Object -First 1)
            if ($surface.Count -gt 0 -and [bool]$surface[0].also_affects_reference_missing_routes) {
                $alsoAffectsMissing = $true
                foreach ($route in @($scope.manifest.route_inventory | Where-Object status -eq 'reference_missing' | ForEach-Object route)) {
                    $referenceMissing.Add([string]$route)
                }
            }
        }
        foreach ($surfaceId in $scope.reference_missing_surface_ids) {
            $surface = @($scope.manifest.change_scope_contract.reference_missing_product_surfaces | Where-Object id -eq $surfaceId | Select-Object -First 1)
            if ($surface.Count -gt 0) { $referenceMissing.Add([string]$surface[0].reference) }
        }
        if ($scope.approved_surface_ids.Count -gt 0) {
            $requiredScreenIds += @($scope.manifest.screens | ForEach-Object { [string]$_.id })
        }
    }

    $requiredScreenIds = @($requiredScreenIds | Sort-Object -Unique)
    $referenceMissingItems = @($referenceMissing | Sort-Object -Unique)
    $hasApproved = $approvedSurfaceIds.Count -gt 0
    $hasMissing = $missingSurfaceIds.Count -gt 0 -or $alsoAffectsMissing
    $frontendProduct = $hasApproved -or $hasMissing -or $unknownPaths.Count -gt 0
    $pairedRebaseline = $false
    if ($null -ne $baseManifest -and $referenceAuthorityPaths.Count -gt 0 -and $frontendProduct) {
        $pairedRebaseline = Test-DesignSystemPairedRebaseline `
            -BaseManifest $baseManifest `
            -HeadManifest $headManifest `
            -ChangedPaths $normalizedPaths `
            -ReferenceAuthorityPaths $referenceAuthorityPaths `
            -HasApprovedSurface $hasApproved
    }
    $referenceAuthorityMixed = $referenceAuthorityPaths.Count -gt 0 -and $frontendProduct -and -not $pairedRebaseline
    $status = if ($unknownPaths.Count -gt 0) {
        'unknown_fail_closed'
    } elseif ($referenceAuthorityMixed) {
        'reference_authority_mixed_fail_closed'
    } elseif ($pairedRebaseline) {
        'passed_with_rebaseline'
    } elseif ($hasApproved -and $hasMissing) {
        'mixed'
    } elseif ($hasApproved) {
        'passed'
    } elseif ($hasMissing) {
        'partial_reference_missing'
    } elseif ($gatePaths.Count -gt 0) {
        'gate_infrastructure_only'
    } else {
        'not_applicable'
    }

    $requiredCases = @($headManifest.semantic_contract.required_case_ids | ForEach-Object { [string]$_ } | Sort-Object)
    $implementedCases = @($headManifest.semantic_contract.implemented_case_ids | ForEach-Object { [string]$_ } | Sort-Object)
    $semanticExecutable = $headManifest.semantic_contract.status -eq 'executable' -and
        $headManifest.semantic_contract.enforcement_status -eq 'required_check_configured' -and
        (($requiredCases -join '|') -eq ($implementedCases -join '|'))
    $runtimeExecutable = $headManifest.functional_runtime_contract.status -eq 'executable' -and
        $headManifest.functional_runtime_contract.enforcement_status -eq 'required_check_configured'
    $fidelityDeterministic = $headManifest.fidelity_contract.runner_image_fingerprint_status -eq 'pinned' -and
        $headManifest.fidelity_contract.font_fingerprint_status -eq 'pinned' -and
        $headManifest.fidelity_contract.dependency_tree_status -eq 'resolved_snapshot_pinned'

    return [pscustomobject]@{
        status = $status
        frontend_product = $frontendProduct
        visual_required = $hasApproved -or $unknownPaths.Count -gt 0
        full_completion_allowed = $status -in @('passed', 'passed_with_rebaseline') -and $semanticExecutable -and $runtimeExecutable -and $fidelityDeterministic
        semantic_executable = $semanticExecutable
        functional_runtime_executable = $runtimeExecutable
        fidelity_deterministic = $fidelityDeterministic
        required_screen_ids = $requiredScreenIds
        reference_missing_items = $referenceMissingItems
        approved_surface_ids = $approvedSurfaceIds
        reference_missing_surface_ids = $missingSurfaceIds
        unknown_paths = $unknownPaths
        gate_infrastructure_paths = $gatePaths
        reference_authority_paths = $referenceAuthorityPaths
        paired_rebaseline = $pairedRebaseline
        non_product_paths = $nonProductPaths
        base_manifest_present = $null -ne $baseManifest
        bootstrap_gate_infrastructure_paths = @($bootstrapGatePaths | Sort-Object -Unique)
    }
}
