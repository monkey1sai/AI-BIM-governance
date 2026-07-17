Set-StrictMode -Version Latest

$script:DeploymentDesignAssetManifestName = '.deployment-manifest.json'
$script:DeploymentDesignAssetManifestSchema = 'design-assets/v1'
$script:DeploymentDesignAssetLockName = '.design-assets-sync.lock'
$script:DeploymentDesignAssetBackupPrefix = '.design-assets-backup-'

function Get-DeploymentDesignAssetItemIfPresent {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string] $Path,
        [scriptblock] $ItemReader = $null
    )

    if ($null -eq $ItemReader) {
        $ItemReader = {
            param([string] $CandidatePath)
            Get-Item -LiteralPath $CandidatePath -Force -ErrorAction Stop
        }
    }

    try {
        return & $ItemReader $Path
    } catch [System.Management.Automation.ItemNotFoundException] {
        return $null
    } catch [System.IO.DirectoryNotFoundException] {
        return $null
    } catch [System.IO.FileNotFoundException] {
        return $null
    }
}

function Write-DeploymentDesignAssetCleanupDiagnostic {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string] $Message
    )

    try {
        Write-Warning -Message $Message -WarningAction Continue
    } catch {
        # Cleanup diagnostics must never replace the operation's primary error.
    }
}

function Get-DeploymentDesignAssetHash {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string] $Path
    )

    return (Get-FileHash -LiteralPath $Path -Algorithm SHA256 -ErrorAction Stop).Hash.ToLowerInvariant()
}

function Enter-DeploymentDesignAssetLock {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string] $DestinationParent,
        [Parameter(Mandatory = $true)][string] $BoundaryRoot
    )

    $parentPath = Assert-DeploymentDesignAssetPathChain -Path $DestinationParent -BoundaryRoot $BoundaryRoot
    if (-not (Test-Path -LiteralPath $parentPath -PathType Container)) {
        throw "deployment design assets parent is missing: '$parentPath'"
    }
    $lockPath = Join-Path $parentPath $script:DeploymentDesignAssetLockName
    Assert-DeploymentDesignAssetPathChain -Path $lockPath -BoundaryRoot $BoundaryRoot | Out-Null
    try {
        return [System.IO.FileStream]::new(
            $lockPath,
            [System.IO.FileMode]::CreateNew,
            [System.IO.FileAccess]::ReadWrite,
            [System.IO.FileShare]::None,
            1,
            [System.IO.FileOptions]::DeleteOnClose
        )
    } catch [System.IO.IOException] {
        throw "deployment design assets sync is already running or left a stale lock: '$lockPath'"
    }
}

function Assert-NoDeploymentDesignAssetBackupResidue {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string] $DestinationParent,
        [Parameter(Mandatory = $true)][string] $BoundaryRoot
    )

    $parentPath = Assert-DeploymentDesignAssetPathChain -Path $DestinationParent -BoundaryRoot $BoundaryRoot
    $residue = @(
        Get-ChildItem -LiteralPath $parentPath -Force -ErrorAction Stop |
            Where-Object { $_.Name.StartsWith($script:DeploymentDesignAssetBackupPrefix, [System.StringComparison]::Ordinal) }
    )
    if ($residue.Count -gt 0) {
        throw "deployment design assets backup residue requires manual inspection: $($residue.FullName -join ', ')"
    }
}

function Assert-DeploymentDesignAssetPathChain {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string] $Path,
        [Parameter(Mandatory = $true)][string] $BoundaryRoot,
        [scriptblock] $ItemReader = $null
    )

    $fullPath = [System.IO.Path]::GetFullPath($Path)
    $boundary = [System.IO.Path]::GetFullPath($BoundaryRoot).TrimEnd([char[]]@('\', '/'))
    $boundaryPrefix = $boundary + [System.IO.Path]::DirectorySeparatorChar
    if (
        $fullPath -ine $boundary -and
        -not $fullPath.StartsWith($boundaryPrefix, [System.StringComparison]::OrdinalIgnoreCase)
    ) {
        throw "deployment design asset path escaped repository root: '$fullPath'"
    }

    $pathRoot = [System.IO.Path]::GetPathRoot($fullPath)
    $currentPath = $pathRoot
    $relativePath = $fullPath.Substring($pathRoot.Length)
    foreach ($segment in @($relativePath.Split(
        [char[]]@([System.IO.Path]::DirectorySeparatorChar, [System.IO.Path]::AltDirectorySeparatorChar),
        [System.StringSplitOptions]::RemoveEmptyEntries
    ))) {
        $currentPath = Join-Path $currentPath $segment
        $item = Get-DeploymentDesignAssetItemIfPresent -Path $currentPath -ItemReader $ItemReader
        if ($null -eq $item) {
            break
        }
        if ([bool]($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint)) {
            throw "deployment design asset path contains reparse point: '$($item.FullName)'"
        }
        if (
            -not $currentPath.Equals($fullPath, [System.StringComparison]::OrdinalIgnoreCase) -and
            -not $item.PSIsContainer
        ) {
            throw "deployment design asset path ancestor is not a directory: '$($item.FullName)'"
        }
    }

    return $fullPath
}

function Get-ReplaceableDeploymentDesignAssetEntries {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string] $Destination,
        [Parameter(Mandatory = $true)][string] $BoundaryRoot
    )

    $destinationPath = Assert-DeploymentDesignAssetPathChain -Path $Destination -BoundaryRoot $BoundaryRoot
    if (-not (Test-Path -LiteralPath $destinationPath)) {
        return @()
    }
    if (-not (Test-Path -LiteralPath $destinationPath -PathType Container)) {
        throw "deployment design assets destination is not a directory: '$destinationPath'"
    }

    $entries = @(Get-ChildItem -LiteralPath $destinationPath -Force -ErrorAction Stop)
    foreach ($entry in $entries) {
        if ([bool]($entry.Attributes -band [System.IO.FileAttributes]::ReparsePoint)) {
            throw "deployment design assets inventory contains reparse point: '$($entry.FullName)'"
        }
        if ($entry.PSIsContainer) {
            throw "deployment design assets inventory contains unexpected directory: '$($entry.FullName)'"
        }
        if (
            $entry.Name -cne $script:DeploymentDesignAssetManifestName -and
            -not $entry.Name.EndsWith('.png', [System.StringComparison]::OrdinalIgnoreCase)
        ) {
            throw "deployment design assets inventory contains unexpected file: '$($entry.FullName)'"
        }
    }
    return $entries
}

function Remove-ReplaceableDeploymentDesignAssetDirectory {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string] $Destination,
        [Parameter(Mandatory = $true)][string] $BoundaryRoot
    )

    if (-not (Test-Path -LiteralPath $Destination)) {
        return
    }
    $entries = @(Get-ReplaceableDeploymentDesignAssetEntries -Destination $Destination -BoundaryRoot $BoundaryRoot)
    foreach ($entry in $entries) {
        Assert-DeploymentDesignAssetPathChain -Path $Destination -BoundaryRoot $BoundaryRoot | Out-Null
        $currentEntry = Get-Item -LiteralPath $entry.FullName -Force -ErrorAction Stop
        if (
            [bool]($currentEntry.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -or
            $currentEntry.PSIsContainer -or
            -not $currentEntry.FullName.Equals($entry.FullName, [System.StringComparison]::OrdinalIgnoreCase)
        ) {
            throw "deployment design assets cleanup identity changed before unlink: '$($entry.FullName)'"
        }
        Remove-Item -LiteralPath $currentEntry.FullName -Force -ErrorAction Stop
    }
    Assert-DeploymentDesignAssetPathChain -Path $Destination -BoundaryRoot $BoundaryRoot | Out-Null
    [System.IO.Directory]::Delete([System.IO.Path]::GetFullPath($Destination), $false)
}

function Assert-DeploymentDesignAssetsPrestaged {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string] $Destination,
        [Parameter(Mandatory = $true)][string] $BoundaryRoot
    )

    $destinationPath = Assert-DeploymentDesignAssetPathChain -Path $Destination -BoundaryRoot $BoundaryRoot
    if (-not (Test-Path -LiteralPath $destinationPath -PathType Container)) {
        throw "deployment design assets are not staged: '$destinationPath'"
    }
    $inventory = @(Get-ReplaceableDeploymentDesignAssetEntries -Destination $destinationPath -BoundaryRoot $BoundaryRoot)
    $manifestPath = Join-Path $destinationPath $script:DeploymentDesignAssetManifestName
    if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
        throw "deployment design assets manifest is missing: '$manifestPath'"
    }

    try {
        $manifest = Get-Content -LiteralPath $manifestPath -Raw -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop
    } catch {
        throw "deployment design assets manifest is invalid JSON: $($_.Exception.Message)"
    }
    if ([string]$manifest.schema_version -cne $script:DeploymentDesignAssetManifestSchema) {
        throw "deployment design assets manifest schema is invalid: '$($manifest.schema_version)'"
    }

    $entries = @($manifest.files)
    if ($entries.Count -eq 0) {
        throw 'deployment design assets manifest contains no files'
    }
    $manifestNames = @($entries | ForEach-Object { [string]$_.name })
    $duplicateNames = @($manifestNames | Group-Object | Where-Object { $_.Count -gt 1 })
    if ($duplicateNames.Count -gt 0) {
        throw "deployment design assets manifest contains duplicate names: $($duplicateNames.Name -join ', ')"
    }

    foreach ($entry in $entries) {
        $name = [string]$entry.name
        $expectedHash = ([string]$entry.sha256).ToLowerInvariant()
        if (
            [string]::IsNullOrWhiteSpace($name) -or
            [System.IO.Path]::GetFileName($name) -cne $name -or
            -not $name.EndsWith('.png', [System.StringComparison]::OrdinalIgnoreCase)
        ) {
            throw "deployment design assets manifest contains an invalid file name: '$name'"
        }
        if ($expectedHash -notmatch '^[0-9a-f]{64}$') {
            throw "deployment design assets manifest contains an invalid SHA-256 for '$name'"
        }

        $assetPath = Join-Path $destinationPath $name
        if (-not (Test-Path -LiteralPath $assetPath -PathType Leaf)) {
            throw "deployment design asset is missing: '$assetPath'"
        }
        $actualHash = Get-DeploymentDesignAssetHash -Path $assetPath
        if ($actualHash -cne $expectedHash) {
            throw "deployment design asset hash mismatch: '$name'"
        }
    }

    $expectedInventory = @($script:DeploymentDesignAssetManifestName) + $manifestNames
    $expectedSorted = @($expectedInventory | Sort-Object)
    $actualSorted = @($inventory | ForEach-Object { $_.Name } | Sort-Object)
    if (($expectedSorted -join "`n") -cne ($actualSorted -join "`n")) {
        throw 'deployment design assets directory is not a sealed manifest inventory'
    }

    return [pscustomobject]@{
        Mode = 'prestaged'
        Count = $entries.Count
        Destination = $destinationPath
        ManifestPath = $manifestPath
    }
}

function Publish-DeploymentDesignAssetStage {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string] $StagePath,
        [Parameter(Mandatory = $true)][string] $Destination,
        [Parameter(Mandatory = $true)][string] $DestinationParent,
        [Parameter(Mandatory = $true)][string] $BoundaryRoot,
        [scriptblock] $DirectoryMover = $null,
        [scriptblock] $PublicationValidator = $null,
        [scriptblock] $DirectoryRemover = $null
    )

    $stage = Assert-DeploymentDesignAssetPathChain -Path $StagePath -BoundaryRoot $BoundaryRoot
    $destinationPath = Assert-DeploymentDesignAssetPathChain -Path $Destination -BoundaryRoot $BoundaryRoot
    $parentPath = Assert-DeploymentDesignAssetPathChain -Path $DestinationParent -BoundaryRoot $BoundaryRoot
    if ($null -eq $DirectoryMover) {
        $DirectoryMover = {
            param([string] $Source, [string] $Target)
            [System.IO.Directory]::Move($Source, $Target)
        }
    }
    if ($null -eq $PublicationValidator) {
        $PublicationValidator = {
            param([string] $PublishedPath, [string] $RootBoundary)
            Assert-DeploymentDesignAssetsPrestaged -Destination $PublishedPath -BoundaryRoot $RootBoundary | Out-Null
        }
    }
    if ($null -eq $DirectoryRemover) {
        $DirectoryRemover = {
            param([string] $DirectoryPath, [string] $RootBoundary)
            Remove-ReplaceableDeploymentDesignAssetDirectory -Destination $DirectoryPath -BoundaryRoot $RootBoundary
        }
    }

    $backupPath = Join-Path $parentPath "$($script:DeploymentDesignAssetBackupPrefix)$([Guid]::NewGuid().ToString('N'))"
    Assert-DeploymentDesignAssetPathChain -Path $backupPath -BoundaryRoot $BoundaryRoot | Out-Null
    if (Test-Path -LiteralPath $backupPath) {
        throw "deployment design assets backup path already exists: '$backupPath'"
    }

    $claimedBackup = $false
    $newPublished = $false
    try {
        if (Test-Path -LiteralPath $destinationPath) {
            Get-ReplaceableDeploymentDesignAssetEntries -Destination $destinationPath -BoundaryRoot $BoundaryRoot | Out-Null
            & $DirectoryMover $destinationPath $backupPath
            $claimedBackup = $true
            Get-ReplaceableDeploymentDesignAssetEntries -Destination $backupPath -BoundaryRoot $BoundaryRoot | Out-Null
        }
        & $DirectoryMover $stage $destinationPath
        $newPublished = $true
        & $PublicationValidator $destinationPath $BoundaryRoot
    } catch {
        $publishError = $_
        if ($newPublished -and (Test-Path -LiteralPath $destinationPath) -and -not (Test-Path -LiteralPath $stage)) {
            try {
                & $DirectoryMover $destinationPath $stage
                $newPublished = $false
            } catch {
                throw "$($publishError.Exception.Message)$([Environment]::NewLine)Additionally failed to move the rejected design-assets publication back to staging: $($_.Exception.Message)"
            }
        }
        if ($claimedBackup -and -not (Test-Path -LiteralPath $destinationPath)) {
            try {
                & $DirectoryMover $backupPath $destinationPath
                $claimedBackup = $false
            } catch {
                throw "$($publishError.Exception.Message)$([Environment]::NewLine)Additionally failed to restore the previous design-assets directory: $($_.Exception.Message)"
            }
        }
        throw $publishError
    }

    if ($claimedBackup) {
        try {
            & $DirectoryRemover $backupPath $BoundaryRoot
        } catch {
            throw "new design assets are published and valid, but the claimed backup was retained for manual inspection: '$backupPath'. $($_.Exception.Message)"
        }
    }
}

function Invoke-DeploymentDesignAssetSyncUnderLock {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string] $Root,
        [Parameter(Mandatory = $true)][string[]] $SourceDirs,
        [Parameter(Mandatory = $true)][string] $DestinationParent,
        [Parameter(Mandatory = $true)][string] $Destination,
        [scriptblock] $SourceItemReader = $null
    )

    Assert-NoDeploymentDesignAssetBackupResidue -DestinationParent $DestinationParent -BoundaryRoot $Root
    $sourceItems = New-Object 'System.Collections.Generic.List[System.IO.DirectoryInfo]'
    $missingSources = New-Object 'System.Collections.Generic.List[string]'
    foreach ($sourceDir in $SourceDirs) {
        Assert-DeploymentDesignAssetPathChain -Path $sourceDir -BoundaryRoot $Root -ItemReader $SourceItemReader | Out-Null
        $sourceItem = Get-DeploymentDesignAssetItemIfPresent -Path $sourceDir -ItemReader $SourceItemReader
        if ($null -eq $sourceItem) {
            $missingSources.Add($sourceDir) | Out-Null
            continue
        }
        if (-not $sourceItem.PSIsContainer) {
            throw "deployment design asset source exists but is not a directory: '$sourceDir'"
        }
        $sourceItems.Add($sourceItem) | Out-Null
    }

    if ($missingSources.Count -gt 0) {
        if ($missingSources.Count -ne $SourceDirs.Count) {
            throw "deployment design asset source is partially missing: $($missingSources -join ', ')"
        }
        return Assert-DeploymentDesignAssetsPrestaged -Destination $Destination -BoundaryRoot $Root
    }

    $sourceFiles = New-Object 'System.Collections.Generic.List[System.IO.FileInfo]'
    foreach ($sourceItem in $sourceItems) {
        foreach ($file in @(Get-ChildItem -LiteralPath $sourceItem.FullName -File -Filter '*.png' -Force -ErrorAction Stop)) {
            Assert-DeploymentDesignAssetPathChain -Path $file.FullName -BoundaryRoot $Root | Out-Null
            $sourceFiles.Add($file) | Out-Null
        }
    }
    if ($sourceFiles.Count -eq 0) {
        throw 'deployment design asset sources contain no PNG files'
    }
    $duplicates = @($sourceFiles.ToArray() | Group-Object Name | Where-Object { $_.Count -gt 1 })
    if ($duplicates.Count -gt 0) {
        throw "deployment design asset sources contain duplicate file names: $($duplicates.Name -join ', ')"
    }

    Get-ReplaceableDeploymentDesignAssetEntries -Destination $Destination -BoundaryRoot $Root | Out-Null
    $stagePath = Join-Path $DestinationParent ".design-assets-stage-$([Guid]::NewGuid().ToString('N'))"
    Assert-DeploymentDesignAssetPathChain -Path $stagePath -BoundaryRoot $Root | Out-Null
    New-Item -ItemType Directory -Path $stagePath -ErrorAction Stop | Out-Null
    $published = $false
    try {
        foreach ($sourceFile in $sourceFiles) {
            Copy-Item -LiteralPath $sourceFile.FullName -Destination (Join-Path $stagePath $sourceFile.Name) -ErrorAction Stop
        }

        $manifestFiles = @(
            Get-ChildItem -LiteralPath $stagePath -File -Filter '*.png' -Force -ErrorAction Stop |
                Sort-Object Name |
                ForEach-Object {
                    [ordered]@{
                        name = $_.Name
                        sha256 = Get-DeploymentDesignAssetHash -Path $_.FullName
                    }
                }
        )
        if ($manifestFiles.Count -ne $sourceFiles.Count) {
            throw "deployment design asset staging count mismatch: source=$($sourceFiles.Count) staged=$($manifestFiles.Count)"
        }
        $manifestJson = [ordered]@{
            schema_version = $script:DeploymentDesignAssetManifestSchema
            files = $manifestFiles
        } | ConvertTo-Json -Depth 4
        [System.IO.File]::WriteAllText(
            (Join-Path $stagePath $script:DeploymentDesignAssetManifestName),
            $manifestJson + [Environment]::NewLine,
            [System.Text.UTF8Encoding]::new($false)
        )
        Assert-DeploymentDesignAssetsPrestaged -Destination $stagePath -BoundaryRoot $Root | Out-Null
        Publish-DeploymentDesignAssetStage `
            -StagePath $stagePath `
            -Destination $Destination `
            -DestinationParent $DestinationParent `
            -BoundaryRoot $Root
        $published = $true
    } finally {
        if (-not $published -and (Test-Path -LiteralPath $stagePath)) {
            try {
                Remove-ReplaceableDeploymentDesignAssetDirectory -Destination $stagePath -BoundaryRoot $Root
            } catch {
                Write-DeploymentDesignAssetCleanupDiagnostic -Message "design assets temporary staging cleanup failed: $($_.Exception.Message)"
            }
        }
    }

    $verified = Assert-DeploymentDesignAssetsPrestaged -Destination $Destination -BoundaryRoot $Root
    return [pscustomobject]@{
        Mode = 'synced'
        Count = $verified.Count
        Destination = $verified.Destination
        ManifestPath = $verified.ManifestPath
    }
}

function Sync-DeploymentDesignAssets {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string] $RepoRoot,
        [AllowNull()][object] $LockHandle = $null,
        [scriptblock] $SourceItemReader = $null,
        [scriptblock] $LockDisposer = $null
    )

    $root = [System.IO.Path]::GetFullPath($RepoRoot).TrimEnd([char[]]@('\', '/'))
    Assert-DeploymentDesignAssetPathChain -Path $root -BoundaryRoot $root | Out-Null
    $sourceDirs = @(
        (Join-Path $root 'docs\plans\assets'),
        (Join-Path $root 'docs\plans\uploads')
    )
    $destinationParent = Join-Path $root 'web-viewer-sample\public'
    $destination = Join-Path $destinationParent 'design-assets'
    Assert-DeploymentDesignAssetPathChain -Path $destinationParent -BoundaryRoot $root | Out-Null
    if (-not (Test-Path -LiteralPath $destinationParent -PathType Container)) {
        throw "deployment design assets parent is missing: '$destinationParent'"
    }

    # The lock coordinates every repo-owned adapter. A hostile process that can
    # arbitrarily rewrite this trusted checkout is outside the build threat model.
    $ownsLock = $null -eq $LockHandle
    if ($ownsLock) {
        $LockHandle = Enter-DeploymentDesignAssetLock -DestinationParent $destinationParent -BoundaryRoot $root
    } else {
        if ($LockHandle -isnot [System.IO.FileStream]) {
            throw 'caller-owned deployment design assets lock must be a FileStream returned by Enter-DeploymentDesignAssetLock'
        }
        $expectedLockPath = [System.IO.Path]::GetFullPath((Join-Path $destinationParent $script:DeploymentDesignAssetLockName))
        $actualLockPath = [System.IO.Path]::GetFullPath($LockHandle.Name)
        if (
            -not $LockHandle.CanWrite -or
            -not $actualLockPath.Equals($expectedLockPath, [System.StringComparison]::OrdinalIgnoreCase)
        ) {
            throw "caller-owned deployment design assets lock does not guard '$expectedLockPath'"
        }
    }

    if ($null -eq $LockDisposer) {
        $LockDisposer = {
            param([System.IO.FileStream] $Handle)
            $Handle.Dispose()
        }
    }

    $result = $null
    $primaryError = $null
    $cleanupError = $null
    try {
        $result = Invoke-DeploymentDesignAssetSyncUnderLock `
            -Root $root `
            -SourceDirs $sourceDirs `
            -DestinationParent $destinationParent `
            -Destination $destination `
            -SourceItemReader $SourceItemReader
    } catch {
        $primaryError = $_
    } finally {
        if ($ownsLock) {
            try {
                & $LockDisposer $LockHandle
            } catch {
                $cleanupError = $_
                if ($null -ne $primaryError) {
                    Write-DeploymentDesignAssetCleanupDiagnostic -Message "deployment design assets lock cleanup failed after primary error: $($_.Exception.Message)"
                }
            }
        }
    }

    if ($null -ne $primaryError) {
        throw $primaryError
    }
    if ($null -ne $cleanupError) {
        throw $cleanupError
    }
    return $result
}
