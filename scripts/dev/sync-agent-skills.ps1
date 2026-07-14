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

function Get-LocationValue {
    param(
        [Parameter(Mandatory = $true)] $Skill,
        [Parameter(Mandatory = $true)][string] $Platform
    )

    $property = $Skill.locations.PSObject.Properties[$Platform]
    if ($null -eq $property) { return $null }
    return [string] $property.Value
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

    $map = @{}
    if (-not (Test-Path -LiteralPath $Root -PathType Container)) { return $map }
    foreach ($file in Get-ChildItem -Force -Recurse -File -LiteralPath $Root) {
        $relative = $file.FullName.Substring($Root.Length).TrimStart('\', '/').Replace('\', '/')
        $map[$relative] = $file.FullName
    }
    return $map
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
if (-not (Test-Path -LiteralPath $manifestFullPath -PathType Leaf)) {
    throw "Skill manifest not found: $manifestFullPath"
}
$manifest = Get-Content -Raw -LiteralPath $manifestFullPath | ConvertFrom-Json
if ($manifest.schema_version -ne 'agent-skills-manifest/v1') {
    throw "Unsupported skill manifest schema: $($manifest.schema_version)"
}

$rootPaths = @{}
foreach ($property in $manifest.roots.PSObject.Properties) {
    $rootPaths[$property.Name] = Resolve-RepoPath ([string] $property.Value)
}

$skillNames = @($manifest.skills | ForEach-Object { [string] $_.name })
if (@($skillNames | Sort-Object -Unique).Count -ne $skillNames.Count) {
    throw 'Skill manifest contains duplicate names.'
}

$syncOperations = 0
foreach ($skill in $manifest.skills) {
    if ($skill.sync.mode -notin @('single', 'independent', 'mirror')) {
        throw "Unsupported sync mode for $($skill.name): $($skill.sync.mode)"
    }
    if ($skill.sync.mode -ne 'mirror') { continue }

    $sourcePlatform = [string] $skill.sync.source
    $sourceRelative = Get-LocationValue $skill $sourcePlatform
    if (-not $sourceRelative) {
        throw "Mirror source location missing for $($skill.name): $sourcePlatform"
    }
    $source = Resolve-RepoPath $sourceRelative
    if (-not (Test-Path -LiteralPath $source -PathType Container)) {
        throw "Mirror source directory missing for $($skill.name): $sourceRelative"
    }
    foreach ($targetPlatform in @($skill.sync.targets)) {
        $targetRelative = Get-LocationValue $skill ([string] $targetPlatform)
        if (-not $targetRelative) {
            throw "Mirror target location missing for $($skill.name): $targetPlatform"
        }
        $target = Resolve-RepoPath $targetRelative
        if ($Mode -eq 'Sync') {
            $syncOperations += Sync-SkillTree -Source $source -Target $target
        }
    }
}

$issues = [Collections.Generic.List[string]]::new()
foreach ($platform in $rootPaths.Keys) {
    $root = $rootPaths[$platform]
    if (-not (Test-Path -LiteralPath $root -PathType Container)) {
        $issues.Add("missing skill root: $platform")
        continue
    }
    Assert-NoReparsePoint $root
    $expected = @($manifest.skills | ForEach-Object {
        $location = Get-LocationValue $_ $platform
        if ($location) { Split-Path -Leaf $location }
    } | Sort-Object -Unique)
    $actual = @(Get-ChildItem -Force -Directory -LiteralPath $root | Select-Object -ExpandProperty Name | Sort-Object -Unique)
    foreach ($missing in @($expected | Where-Object { $actual -notcontains $_ })) {
        $issues.Add("$platform inventory missing: $missing")
    }
    foreach ($extra in @($actual | Where-Object { $expected -notcontains $_ })) {
        $issues.Add("$platform inventory undeclared: $extra")
    }
}

foreach ($skill in $manifest.skills) {
    foreach ($locationProperty in $skill.locations.PSObject.Properties) {
        $platform = $locationProperty.Name
        if (-not $rootPaths.ContainsKey($platform)) {
            $issues.Add("unknown platform for $($skill.name): $platform")
            continue
        }
        $path = Resolve-RepoPath ([string] $locationProperty.Value)
        if (-not (Test-Path -LiteralPath $path -PathType Container)) {
            $issues.Add("missing skill directory: $($skill.name) [$platform]")
            continue
        }
        Assert-NoReparsePoint $path
        if (@(Get-ChildItem -Recurse -File -Filter 'SKILL.md' -LiteralPath $path).Count -eq 0) {
            $issues.Add("skill entrypoint missing: $($skill.name) [$platform]")
        }
    }

    if ($skill.sync.mode -eq 'mirror') {
        $source = Resolve-RepoPath (Get-LocationValue $skill ([string] $skill.sync.source))
        foreach ($targetPlatform in @($skill.sync.targets)) {
            $target = Resolve-RepoPath (Get-LocationValue $skill ([string] $targetPlatform))
            foreach ($difference in @(Compare-SkillTrees -Source $source -Target $target)) {
                $issues.Add("$($skill.name) $($skill.sync.source)->$targetPlatform $difference")
            }
        }
    }
}

if ($issues.Count -gt 0) {
    throw ("Agent skill asset check failed:`n - " + ($issues -join "`n - "))
}

if ($Mode -eq 'Sync') {
    Write-Host "[agent-skills-sync] sync complete; file operations=$syncOperations"
} else {
    Write-Host "[agent-skills-sync] check passed; skills=$($manifest.skills.Count)"
}
