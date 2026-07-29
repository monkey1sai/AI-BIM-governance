[CmdletBinding()]
param(
    [ValidateSet('Check', 'Sync')]
    [string] $Mode = 'Check',
    [string] $RepoRoot = '',
    [string] $ManifestPath = 'agent-skills-manifest.json'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if (-not $RepoRoot) {
    $RepoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
}
$RepoRoot = [IO.Path]::GetFullPath($RepoRoot)
$structLogModule = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\lib\StructLog.psm1'))
Import-Module -Force $structLogModule

function Resolve-RepoPath {
    param([Parameter(Mandatory = $true)][string] $RelativePath)

    if ([IO.Path]::IsPathRooted($RelativePath)) {
        throw "Manifest paths must be repo-relative: $RelativePath"
    }
    $resolved = [IO.Path]::GetFullPath((Join-Path $RepoRoot $RelativePath))
    $prefix = $RepoRoot.TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
    if (-not $resolved.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Manifest path escapes repo root: $RelativePath"
    }
    return $resolved
}

function Test-SamePath {
    param(
        [Parameter(Mandatory = $true)][string] $Left,
        [Parameter(Mandatory = $true)][string] $Right
    )

    $leftFull = [IO.Path]::GetFullPath($Left).TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar)
    $rightFull = [IO.Path]::GetFullPath($Right).TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar)
    return $leftFull.Equals($rightFull, [StringComparison]::OrdinalIgnoreCase)
}

function Test-StrictChildPath {
    param(
        [Parameter(Mandatory = $true)][string] $Child,
        [Parameter(Mandatory = $true)][string] $Parent
    )

    $childFull = [IO.Path]::GetFullPath($Child)
    $parentPrefix = [IO.Path]::GetFullPath($Parent).TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
    return $childFull.StartsWith($parentPrefix, [StringComparison]::OrdinalIgnoreCase)
}

function Test-OverlappingPath {
    param(
        [Parameter(Mandatory = $true)][string] $Left,
        [Parameter(Mandatory = $true)][string] $Right
    )

    return (Test-SamePath $Left $Right) -or (Test-StrictChildPath $Left $Right) -or (Test-StrictChildPath $Right $Left)
}

function Assert-NoReparsePoint {
    param([Parameter(Mandatory = $true)][string] $Path)

    if (-not (Test-Path -LiteralPath $Path)) { return }
    $items = @((Get-Item -Force -LiteralPath $Path)) + @(Get-ChildItem -Force -Recurse -LiteralPath $Path)
    $reparse = @($items | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint })
    if ($reparse.Count -gt 0) {
        throw "Symlinks/junctions are forbidden in tracked skill assets: $($reparse[0].FullName)"
    }
}

function Get-FileMap {
    param([Parameter(Mandatory = $true)][string] $Root)

    $map = [Collections.Generic.Dictionary[string, string]]::new([StringComparer]::Ordinal)
    if (-not (Test-Path -LiteralPath $Root -PathType Container)) { return $map }
    foreach ($file in Get-ChildItem -Force -Recurse -File -LiteralPath $Root) {
        $relative = $file.FullName.Substring($Root.Length).TrimStart('\', '/').Replace('\', '/')
        $map[$relative] = $file.FullName
    }
    return $map
}

function Get-SkillTreeDigest {
    param([Parameter(Mandatory = $true)][string] $Root)

    Assert-NoReparsePath $Root
    Assert-NoReparsePoint $Root
    $fileMap = Get-FileMap $Root
    $relativePaths = [string[]] @($fileMap.Keys)
    [Array]::Sort($relativePaths, [StringComparer]::Ordinal)
    $hasher = [Security.Cryptography.IncrementalHash]::CreateHash([Security.Cryptography.HashAlgorithmName]::SHA256)
    try {
        $nul = [char] 0
        $hasher.AppendData([Text.Encoding]::UTF8.GetBytes("agent-skill-tree/v1$nul"))
        foreach ($relative in $relativePaths) {
            if ($relative.IndexOfAny([char[]] @([char] 0, [char] 10, [char] 13)) -ge 0) {
                throw "Skill file path contains a forbidden control character: $relative"
            }
            $fileHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $fileMap[$relative]).Hash.ToLowerInvariant()
            $hasher.AppendData([Text.Encoding]::UTF8.GetBytes("$relative$nul$fileHash`n"))
        }
        return [Convert]::ToHexString($hasher.GetHashAndReset()).ToLowerInvariant()
    } finally {
        $hasher.Dispose()
    }
}

function Compare-SkillTrees {
    param(
        [Parameter(Mandatory = $true)][string] $Source,
        [Parameter(Mandatory = $true)][string] $Target
    )

    $sourceMap = Get-FileMap $Source
    $targetMap = Get-FileMap $Target
    $differences = [Collections.Generic.List[string]]::new()
    $allPaths = @($sourceMap.Keys + $targetMap.Keys | Sort-Object -Unique)
    foreach ($relative in $allPaths) {
        if (-not $sourceMap.ContainsKey($relative)) {
            $differences.Add("extra target file: $relative")
            continue
        }
        if (-not $targetMap.ContainsKey($relative)) {
            $differences.Add("missing target file: $relative")
            continue
        }
        $sourceHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $sourceMap[$relative]).Hash
        $targetHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $targetMap[$relative]).Hash
        if ($sourceHash -ne $targetHash) {
            $differences.Add("content drift: $relative")
        }
    }
    return @($differences)
}

function Sync-SkillTree {
    param(
        [Parameter(Mandatory = $true)][string] $Source,
        [Parameter(Mandatory = $true)][string] $Target
    )

    Assert-NoReparsePath $Source
    Assert-NoReparsePath $Target
    if (-not (Test-Path -LiteralPath $Target -PathType Container)) {
        New-Item -ItemType Directory -Path $Target -Force | Out-Null
    }
    Assert-NoReparsePoint $Source
    Assert-NoReparsePoint $Target

    $sourceMap = Get-FileMap $Source
    $targetMap = Get-FileMap $Target
    $operations = 0
    foreach ($relative in $sourceMap.Keys) {
        $destination = Join-Path $Target ($relative.Replace('/', [IO.Path]::DirectorySeparatorChar))
        $destinationParent = Split-Path -Parent $destination
        if (-not (Test-Path -LiteralPath $destinationParent -PathType Container)) {
            New-Item -ItemType Directory -Path $destinationParent -Force | Out-Null
        }
        $copy = -not $targetMap.ContainsKey($relative)
        if (-not $copy) {
            $sourceHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $sourceMap[$relative]).Hash
            $targetHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $targetMap[$relative]).Hash
            $copy = $sourceHash -ne $targetHash
        }
        if ($copy) {
            Copy-Item -LiteralPath $sourceMap[$relative] -Destination $destination -Force
            $operations++
        }
    }

    foreach ($relative in @($targetMap.Keys | Where-Object { -not $sourceMap.ContainsKey($_) })) {
        Remove-Item -Force -LiteralPath $targetMap[$relative]
        $operations++
    }

    # Delete only empty descendants. Never recursively delete a declared skill root.
    $directories = @(Get-ChildItem -Force -Recurse -Directory -LiteralPath $Target | Sort-Object { $_.FullName.Length } -Descending)
    foreach ($directory in $directories) {
        if (@(Get-ChildItem -Force -LiteralPath $directory.FullName).Count -eq 0) {
            Remove-Item -Force -LiteralPath $directory.FullName
        }
    }
    return $operations
}

$manifestFullPath = if ([IO.Path]::IsPathRooted($ManifestPath)) {
    [IO.Path]::GetFullPath($ManifestPath)
} else {
    Resolve-RepoPath $ManifestPath
}

function Assert-NoReparsePath {
    param([Parameter(Mandatory = $true)][string] $Path)

    $current = [IO.Path]::GetFullPath($Path)
    if (-not (Test-SamePath $current $RepoRoot) -and -not (Test-StrictChildPath $current $RepoRoot)) {
        throw "Path is outside repository while checking reparse ancestors: $Path"
    }
    while ($true) {
        if (Test-Path -LiteralPath $current) {
            $item = Get-Item -Force -LiteralPath $current
            if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
                throw "Symlinks/junctions are forbidden between the repository root and skill assets: $($item.FullName)"
            }
        }
        if (Test-SamePath $current $RepoRoot) { break }
        $parent = [IO.Directory]::GetParent($current)
        if ($null -eq $parent) {
            throw "Could not reach repository root while checking reparse ancestors: $Path"
        }
        $current = $parent.FullName
    }
}
if (-not (Test-StrictChildPath $manifestFullPath $RepoRoot)) {
    throw "Skill manifest must be inside the repository: $manifestFullPath"
}
Assert-NoReparsePath $manifestFullPath
if (-not (Test-Path -LiteralPath $manifestFullPath -PathType Leaf)) {
    throw "Skill manifest not found: $manifestFullPath"
}
$manifest = Get-Content -Raw -LiteralPath $manifestFullPath | ConvertFrom-Json
if ($manifest.schema_version -ne 'agent-skills-manifest/v2') {
    throw "Unsupported skill manifest schema: $($manifest.schema_version)"
}
if ([string] $manifest.entry_defaults.owner -notmatch '^[a-z][a-z0-9-]{0,63}$') {
    throw 'Skill manifest entry_defaults.owner must be a bounded owner id.'
}
$skillConsumerRelative = [string] $manifest.entry_defaults.executable_consumer
if (-not $skillConsumerRelative) {
    throw 'Skill manifest entry_defaults.executable_consumer is required.'
}
$skillConsumerPath = Resolve-RepoPath $skillConsumerRelative
if (-not (Test-Path -LiteralPath $skillConsumerPath -PathType Leaf)) {
    throw "Skill manifest executable consumer not found: $skillConsumerRelative"
}
if (-not (Test-SamePath $skillConsumerPath (Resolve-RepoPath 'scripts/dev/sync-agent-skills.ps1'))) {
    throw 'Skill manifest executable consumer must be scripts/dev/sync-agent-skills.ps1.'
}
Assert-NoReparsePath $skillConsumerPath

$allowedRootRelatives = [ordered]@{
    claude = '.claude/skills'
    codex = '.codex/skills'
}
$rootProperties = @($manifest.roots.PSObject.Properties)
if ($rootProperties.Count -ne $allowedRootRelatives.Count) {
    throw 'Skill manifest must declare exactly the claude and codex skill roots.'
}
$rootPaths = @{}
foreach ($platform in $allowedRootRelatives.Keys) {
    $property = $manifest.roots.PSObject.Properties[$platform]
    if ($null -eq $property) {
        throw "Skill manifest root missing: $platform"
    }
    $root = Resolve-RepoPath ([string] $property.Value)
    $expectedRoot = Resolve-RepoPath $allowedRootRelatives[$platform]
    if (-not (Test-SamePath $root $expectedRoot)) {
        throw "Skill manifest root must resolve to $($allowedRootRelatives[$platform]): $platform"
    }
    if (-not (Test-Path -LiteralPath $root -PathType Container)) {
        throw "Skill root missing: $platform"
    }
    Assert-NoReparsePath $root
    Assert-NoReparsePoint $root
    $rootPaths[$platform] = $root
}
foreach ($property in $rootProperties) {
    if (-not $allowedRootRelatives.Contains($property.Name)) {
        throw "Unknown skill platform root: $($property.Name)"
    }
}

$skillNames = @($manifest.skills | ForEach-Object { [string] $_.name })
if ($skillNames.Count -eq 0) {
    throw 'Skill manifest must declare at least one skill.'
}
if (@($skillNames | Sort-Object -Unique).Count -ne $skillNames.Count) {
    throw 'Skill manifest contains duplicate names.'
}
foreach ($skillName in $skillNames) {
    if ($skillName -notmatch '^[a-z0-9][a-z0-9-]{0,63}$') {
        throw "Skill name must be a bounded directory id: $skillName"
    }
}

$locationRecords = [Collections.Generic.List[object]]::new()
$syncPlans = [Collections.Generic.List[object]]::new()
$declaredPaths = [Collections.Generic.Dictionary[string, string]]::new([StringComparer]::OrdinalIgnoreCase)
foreach ($skill in $manifest.skills) {
    $skillName = [string] $skill.name
    $syncMode = [string] $skill.sync.mode
    if ($syncMode -notin @('single', 'independent', 'mirror')) {
        throw "Unsupported sync mode for $skillName`: $syncMode"
    }

    $skillLocations = @{}
    $locationProperties = @($skill.locations.PSObject.Properties)
    if ($locationProperties.Count -eq 0) {
        throw "Skill locations missing for $skillName"
    }
    if ([string] $skill.integrity.format -ne 'agent-skill-tree/v1' -or [string] $skill.integrity.algorithm -ne 'sha256') {
        throw "Unsupported skill integrity contract for $skillName"
    }
    $integrityProperties = @($skill.integrity.trees.PSObject.Properties)
    if ($integrityProperties.Count -ne $locationProperties.Count) {
        throw "Skill integrity trees must match declared locations for $skillName"
    }
    foreach ($locationProperty in $locationProperties) {
        $platform = $locationProperty.Name
        if (-not $rootPaths.ContainsKey($platform)) {
            throw "Unknown platform for $skillName`: $platform"
        }
        $relative = [string] $locationProperty.Value
        $path = Resolve-RepoPath $relative
        $expectedPath = [IO.Path]::GetFullPath((Join-Path $rootPaths[$platform] $skillName))
        if (-not (Test-SamePath $path $expectedPath)) {
            throw "Skill location must be the declared platform root plus skill name: $skillName [$platform]"
        }
        if (-not (Test-StrictChildPath $path $rootPaths[$platform])) {
            throw "Skill location is not contained by its declared platform root: $skillName [$platform]"
        }
        Assert-NoReparsePath $path
        $integrityProperty = $skill.integrity.trees.PSObject.Properties[$platform]
        if ($null -eq $integrityProperty -or [string] $integrityProperty.Value -notmatch '^[a-f0-9]{64}$') {
            throw "Skill integrity digest missing or malformed for $skillName [$platform]"
        }
        if ($declaredPaths.ContainsKey($path)) {
            throw "Skill location overlaps another declaration: $relative"
        }
        $declaredPaths[$path] = "$skillName [$platform]"
        $skillLocations[$platform] = $path
        $locationRecords.Add([pscustomobject]@{
            Skill = $skillName
            Platform = $platform
            Path = $path
            Mode = $syncMode
            ExpectedDigest = [string] $integrityProperty.Value
        })
    }

    if ($syncMode -ne 'mirror') {
        if ($null -ne $skill.sync.PSObject.Properties['source'] -or $null -ne $skill.sync.PSObject.Properties['targets']) {
            throw "Only mirror skills may declare sync source or targets: $skillName"
        }
        continue
    }

    $sourcePlatform = [string] $skill.sync.source
    if (-not $rootPaths.ContainsKey($sourcePlatform) -or -not $skillLocations.ContainsKey($sourcePlatform)) {
        throw "Mirror source location missing for $skillName`: $sourcePlatform"
    }
    $targetPlatforms = @($skill.sync.targets | ForEach-Object { [string] $_ })
    if ($targetPlatforms.Count -eq 0 -or @($targetPlatforms | Sort-Object -Unique).Count -ne $targetPlatforms.Count) {
        throw "Mirror targets must be a non-empty unique list for $skillName"
    }
    if ($targetPlatforms -contains $sourcePlatform) {
        throw "Mirror source cannot also be a target for $skillName`: $sourcePlatform"
    }
    if ($skillLocations.Count -ne (1 + $targetPlatforms.Count)) {
        throw "Mirror locations must contain only the source and declared targets for $skillName"
    }

    $source = $skillLocations[$sourcePlatform]
    $sourceDigest = [string] $skill.integrity.trees.PSObject.Properties[$sourcePlatform].Value
    foreach ($targetPlatform in $targetPlatforms) {
        if (-not $rootPaths.ContainsKey($targetPlatform) -or -not $skillLocations.ContainsKey($targetPlatform)) {
            throw "Mirror target location missing for $skillName`: $targetPlatform"
        }
        $target = $skillLocations[$targetPlatform]
        if ([string] $skill.integrity.trees.PSObject.Properties[$targetPlatform].Value -ne $sourceDigest) {
            throw "Mirror source and target integrity digests must match for $skillName`: $sourcePlatform->$targetPlatform"
        }
        if (Test-OverlappingPath $source $target) {
            throw "Mirror source and target paths overlap for $skillName`: $sourcePlatform->$targetPlatform"
        }
        if ((Test-OverlappingPath $target $manifestFullPath) -or (Test-OverlappingPath $target $skillConsumerPath)) {
            throw "Mirror target overlaps protected governance files for $skillName`: $targetPlatform"
        }
        $syncPlans.Add([pscustomobject]@{
            Skill = $skillName
            SourcePlatform = $sourcePlatform
            TargetPlatform = $targetPlatform
            Source = $source
            Target = $target
        })
    }
}

for ($leftIndex = 0; $leftIndex -lt $syncPlans.Count; $leftIndex++) {
    for ($rightIndex = $leftIndex + 1; $rightIndex -lt $syncPlans.Count; $rightIndex++) {
        if (Test-OverlappingPath $syncPlans[$leftIndex].Target $syncPlans[$rightIndex].Target) {
            throw "Mirror targets overlap: $($syncPlans[$leftIndex].Skill) and $($syncPlans[$rightIndex].Skill)"
        }
    }
}

$remediablePaths = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
foreach ($plan in $syncPlans) {
    $null = $remediablePaths.Add($plan.Target)
}

$preflightIssues = [Collections.Generic.List[string]]::new()
foreach ($location in $locationRecords) {
    if (-not (Test-Path -LiteralPath $location.Path -PathType Container)) {
        if (Test-Path -LiteralPath $location.Path) {
            $preflightIssues.Add("skill location is not a directory: $($location.Skill) [$($location.Platform)]")
        } elseif (-not $remediablePaths.Contains($location.Path)) {
            $preflightIssues.Add("missing non-remediable skill directory: $($location.Skill) [$($location.Platform)]")
        }
        continue
    }
    Assert-NoReparsePoint $location.Path
    if (-not $remediablePaths.Contains($location.Path) -and @(Get-ChildItem -Recurse -File -Filter 'SKILL.md' -LiteralPath $location.Path).Count -eq 0) {
        $preflightIssues.Add("skill entrypoint missing from non-remediable location: $($location.Skill) [$($location.Platform)]")
    }
    if (-not $remediablePaths.Contains($location.Path)) {
        $actualDigest = Get-SkillTreeDigest $location.Path
        if ($actualDigest -ne $location.ExpectedDigest) {
            $preflightIssues.Add("integrity mismatch in non-remediable location: $($location.Skill) [$($location.Platform)]")
        }
    }
}
foreach ($platform in $rootPaths.Keys) {
    $root = $rootPaths[$platform]
    $expected = @($locationRecords | Where-Object { $_.Platform -eq $platform } | Select-Object -ExpandProperty Skill | Sort-Object -Unique)
    $actual = @(Get-ChildItem -Force -Directory -LiteralPath $root | Select-Object -ExpandProperty Name | Sort-Object -Unique)
    foreach ($missing in @($expected | Where-Object { $actual -notcontains $_ })) {
        $missingPath = [IO.Path]::GetFullPath((Join-Path $root $missing))
        if (-not $remediablePaths.Contains($missingPath)) {
            $preflightIssues.Add("$platform inventory missing non-remediable skill: $missing")
        }
    }
    foreach ($extra in @($actual | Where-Object { $expected -notcontains $_ })) {
        $preflightIssues.Add("$platform inventory undeclared: $extra")
    }
}
if ($preflightIssues.Count -gt 0) {
    throw ("Agent skill sync preflight failed before any writes:`n - " + ($preflightIssues -join "`n - "))
}

$syncOperations = 0
if ($Mode -eq 'Sync') {
    foreach ($plan in $syncPlans) {
        $syncOperations += Sync-SkillTree -Source $plan.Source -Target $plan.Target
    }
}

$issues = [Collections.Generic.List[string]]::new()
foreach ($platform in $rootPaths.Keys) {
    $root = $rootPaths[$platform]
    $expected = @($locationRecords | Where-Object { $_.Platform -eq $platform } | Select-Object -ExpandProperty Skill | Sort-Object -Unique)
    $actual = @(Get-ChildItem -Force -Directory -LiteralPath $root | Select-Object -ExpandProperty Name | Sort-Object -Unique)
    foreach ($missing in @($expected | Where-Object { $actual -notcontains $_ })) {
        $issues.Add("$platform inventory missing: $missing")
    }
    foreach ($extra in @($actual | Where-Object { $expected -notcontains $_ })) {
        $issues.Add("$platform inventory undeclared: $extra")
    }
}

foreach ($location in $locationRecords) {
    if (-not (Test-Path -LiteralPath $location.Path -PathType Container)) {
        $issues.Add("missing skill directory: $($location.Skill) [$($location.Platform)]")
        continue
    }
    Assert-NoReparsePoint $location.Path
    if (@(Get-ChildItem -Recurse -File -Filter 'SKILL.md' -LiteralPath $location.Path).Count -eq 0) {
        $issues.Add("skill entrypoint missing: $($location.Skill) [$($location.Platform)]")
    }
    $actualDigest = Get-SkillTreeDigest $location.Path
    if ($actualDigest -ne $location.ExpectedDigest) {
        $issues.Add("skill tree integrity mismatch: $($location.Skill) [$($location.Platform)]")
    }
}

foreach ($plan in $syncPlans) {
    foreach ($difference in @(Compare-SkillTrees -Source $plan.Source -Target $plan.Target)) {
        $issues.Add("$($plan.Skill) $($plan.SourcePlatform)->$($plan.TargetPlatform) $difference")
    }
}

if ($issues.Count -gt 0) {
    throw ("Agent skill asset check failed:`n - " + ($issues -join "`n - "))
}

if ($Mode -eq 'Sync') {
    $logger = New-StructLogger `
        -Service 'scripts' `
        -Component 'agent-skills-sync' `
        -LogRoot (Join-Path $RepoRoot 'logs') `
        -SkipEnvSnapshot
    $logger | Write-StructInfo -Msg 'agent skill sync complete' -Data @{
        mode = $Mode
        file_operations = $syncOperations
        skill_count = $manifest.skills.Count
    }
} else {
    [ordered]@{
        schema_version = 'agent-skills-check-result/v1'
        valid = $true
        mode = $Mode
        skill_count = $manifest.skills.Count
        file_operations = 0
    } | ConvertTo-Json -Compress | Write-Output
}
