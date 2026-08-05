[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'test-helpers.ps1')
. (Join-Path $PSScriptRoot '..\lib\rebuild-test-deploy.ps1')

$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$testName = 'rebuild-test-deploy'
$sandbox = New-TestSandbox -Prefix $testName

function Resolve-TestReparseTargetPath {
    param([Parameter(Mandatory = $true)] $LinkItem)

    if ($null -ne $LinkItem.PSObject.Methods['ResolveLinkTarget']) {
        $resolved = $LinkItem.ResolveLinkTarget($true)
        if ($null -eq $resolved) { return $null }
        return [System.IO.Path]::GetFullPath($resolved.FullName)
    }

    $targets = @($LinkItem.Target)
    if ($targets.Count -ne 1 -or [string]::IsNullOrWhiteSpace([string]$targets[0])) {
        return $null
    }
    $targetPath = [string]$targets[0]
    if (-not [System.IO.Path]::IsPathRooted($targetPath)) {
        $targetPath = Join-Path $LinkItem.Parent.FullName $targetPath
    }
    return [System.IO.Path]::GetFullPath($targetPath)
}

function New-DeployEdgeVolumeHarness {
    param(
        [Parameter(Mandatory = $true)][string] $DeployRoot,
        [Parameter(Mandatory = $true)][string] $SourceRepoRoot
    )

    $scriptsRoot = Join-Path $DeployRoot 'scripts'
    $libRoot = Join-Path $scriptsRoot 'lib'
    $platformLibRoot = Join-Path $libRoot 'platform'
    New-Item -ItemType Directory -Path $libRoot -Force | Out-Null
    New-Item -ItemType Directory -Path $platformLibRoot -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path $SourceRepoRoot 'scripts\lib\design-assets.ps1') -Destination (Join-Path $libRoot 'design-assets.ps1')
    Copy-Item -LiteralPath (Join-Path $SourceRepoRoot 'scripts\lib\platform\platform-adapter.ps1') -Destination (Join-Path $platformLibRoot 'platform-adapter.ps1')

    # deploy.ps1 resolves its target profile from the registry, so the sandbox
    # overrides DATA instead of rewriting code: copy the script unmodified and
    # write a sandbox registry whose local-windows deploy_root is $DeployRoot.
    Copy-Item -LiteralPath (Join-Path $SourceRepoRoot 'scripts\lib\deploy-target-registry.ps1') -Destination (Join-Path $libRoot 'deploy-target-registry.ps1')
    $sandboxRegistry = Get-Content -LiteralPath (Join-Path $SourceRepoRoot 'scripts\deploy-target-registry.json') -Raw | ConvertFrom-Json
    $sandboxLocal = @($sandboxRegistry.targets | Where-Object { [string]$_.id -eq 'local-windows' })
    if ($sandboxLocal.Count -ne 1) {
        throw 'New-DeployEdgeVolumeHarness: registry must define exactly one local-windows target'
    }
    $sandboxLocal[0].deploy_root = $DeployRoot
    $sandboxRegistry | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath (Join-Path $scriptsRoot 'deploy-target-registry.json') -Encoding ascii
    Copy-Item -LiteralPath (Join-Path $SourceRepoRoot 'scripts\deploy.ps1') -Destination (Join-Path $scriptsRoot 'deploy.ps1')

    # The harness intentionally has no requirements files and its host-native
    # preflight stub reports dependencies as already satisfied. Bind that empty
    # inventory to the same SHA-256 stamp contract used by deploy.ps1.
    $venvRoot = Join-Path $DeployRoot '.venv'
    New-Item -ItemType Directory -Path $venvRoot -Force | Out-Null
    $emptyRequirementsFingerprint = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
    Set-Content -LiteralPath (Join-Path $venvRoot '.deploy-requirements-stamp') -Value $emptyRequirementsFingerprint -Encoding ascii

    @'
function Write-DeployHeader {
    param([string] $Title)
}

function Write-DeployTag {
    param(
        [string] $Tag,
        [string] $Message,
        [string] $LogPath
    )
    return "$Tag $Message"
}
'@ | Set-Content -LiteralPath (Join-Path $libRoot 'deploy-report.ps1') -Encoding ascii

    @'
function Test-DockerEnvironment {
    param([string] $RepoRoot)

    $realEnv = Join-Path $RepoRoot '.env.web-plane.host-kit'
    $exampleEnv = "$realEnv.example"
    $envFile = if (Test-Path -LiteralPath $realEnv) {
        '.env.web-plane.host-kit'
    } elseif (Test-Path -LiteralPath $exampleEnv) {
        '.env.web-plane.host-kit.example'
    } else {
        $null
    }

    return [pscustomobject]@{
        cliVersion    = '24.0.0'
        composeV2     = $true
        engineRunning = $true
        envFile       = $envFile
    }
}
'@ | Set-Content -LiteralPath (Join-Path $libRoot 'preflight-docker.ps1') -Encoding ascii

    @'
function Test-HostNativeEnvironment {
    param([string] $RepoRoot)

    return [pscustomobject]@{
        venv                        = 'OK'
        kitLauncher                 = 'OK'
        nvidiaDriver                = 'OK'
        pythonDependencies          = 'OK'
        pythonDependencyFastApi     = '0.115.0'
        pythonDependencyStarlette   = '0.37.2'
        pythonDependencyUvicorn     = '0.30.6'
        pythonDependencyReason      = ''
        kitRuntime                  = 'OK'
        kitBuildRequired            = $false
        kitBuildReason              = ''
        kitBuildCommand             = ''
    }
}
'@ | Set-Content -LiteralPath (Join-Path $libRoot 'preflight-host-native.ps1') -Encoding ascii

    @'
function Get-EnvExampleDefaultValue {
    param(
        [Parameter(Mandatory = $true)][string] $Path,
        [Parameter(Mandatory = $true)][string] $Key
    )

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        return ''
    }

    foreach ($line in Get-Content -LiteralPath $Path) {
        if ($line -match "^\s*$([regex]::Escape($Key))\s*[:=]\s*(.*)$") {
            return $matches[1].Trim()
        }
    }

    return ''
}

function Test-EnvFiles {
    param([string] $RepoRoot)

    $envPath = Join-Path $RepoRoot '.env.web-plane.host-kit'
    $examplePath = "$envPath.example"

    return @([pscustomobject]@{
        file          = '.env.web-plane.host-kit'
        envExists     = (Test-Path -LiteralPath $envPath -PathType Leaf)
        exampleExists = (Test-Path -LiteralPath $examplePath -PathType Leaf)
        missing       = @()
    })
}
'@ | Set-Content -LiteralPath (Join-Path $libRoot 'preflight-env.ps1') -Encoding ascii

    @'
function Test-PortAvailability {
    param(
        [string] $RepoRoot,
        [int] $KitSignalPort,
        [int] $KitMediaPort,
        [int[]] $ExtraHostNativePorts,
        [int[]] $ExtraHostNativeUdpPorts
    )

    return [pscustomobject]@{
        docker     = @()
        hostNative = @()
    }
}
'@ | Set-Content -LiteralPath (Join-Path $libRoot 'preflight-ports.ps1') -Encoding ascii

    @'
function Test-VolumeAlignment {
    param(
        [Parameter(Mandatory = $true)][string] $RepoRoot,
        [Parameter(Mandatory = $true)][string] $EnvFile
    )

    $envPath = if ([System.IO.Path]::IsPathRooted($EnvFile)) {
        $EnvFile
    } else {
        Join-Path $RepoRoot $EnvFile
    }

    $runtimeStorageRoot = Get-EnvExampleDefaultValue -Path $envPath -Key 'RUNTIME_STORAGE_ROOT'
    if ([string]::IsNullOrWhiteSpace($runtimeStorageRoot)) {
        return [pscustomobject]@{
            runtimeStorageRoot = ''
            leaf               = ''
            status             = 'MISSING_KEY'
        }
    }

    if (-not [System.IO.Path]::IsPathRooted($runtimeStorageRoot)) {
        $runtimeStorageRoot = Join-Path $RepoRoot $runtimeStorageRoot
    }

    $fullRoot = [System.IO.Path]::GetFullPath($runtimeStorageRoot)
    $leaf = Split-Path -Leaf $fullRoot

    return [pscustomobject]@{
        runtimeStorageRoot = $fullRoot
        leaf               = $leaf
        status             = $(if ($leaf -eq 'storage') { 'ALIGNED' } else { 'WRONG_LEAF' })
    }
}
'@ | Set-Content -LiteralPath (Join-Path $libRoot 'preflight-volume-alignment.ps1') -Encoding ascii

    @'
function Start-HostNativeConversion {
    param(
        [string] $RepoRoot,
        [string] $RuntimeStorageRoot,
        [string] $BindHost,
        [string] $PublicArtifactsUrl
    )

    $capturePath = [Environment]::GetEnvironmentVariable('TEST_CAPTURE_VOLUME_PATH', 'Process')
    if (-not [string]::IsNullOrWhiteSpace($capturePath)) {
        Set-Content -LiteralPath $capturePath -Value $RuntimeStorageRoot -Encoding ascii
    }

    $logPath = Join-Path $RepoRoot 'scripts\.run\mock-conversion.log'
    Set-Content -LiteralPath $logPath -Value 'conversion started' -Encoding ascii

    return [pscustomobject]@{
        Pid     = 4242
        LogPath = $logPath
    }
}

function Start-HostNativeGovernance {
    param([string] $RepoRoot, [int] $Port, [string] $DbPath, [string] $FileLibraryRoot)
    return [pscustomobject]@{ Pid = 4343; LogPath = (Join-Path $RepoRoot 'scripts\.run\mock-governance.log') }
}

function Start-HostNativeKit {
    param([string] $RepoRoot, [int] $SignalPort, [int] $StreamPort, [string] $PublicIp, [int[]] $SpectatorSignalPorts, [int[]] $SpectatorStreamPorts)
    return [pscustomobject]@{ Pid = 4444; LogPath = (Join-Path $RepoRoot 'scripts\.run\mock-kit.log') }
}

function Start-HostNativeKitManager {
    param([string] $RepoRoot, [int] $Port)
    return [pscustomobject]@{ Pid = 4545; LogPath = (Join-Path $RepoRoot 'scripts\.run\mock-kit-manager.log') }
}

function Wait-HostNativeHealth {
    param([string] $Name, [string] $Url, [int] $TimeoutSec)
    return $true
}

function Test-AlreadyRunning {
    param([string] $Name, [string] $RunDir)
    return $false
}

function Stop-HostNativeService {
    param([string] $Name, [string] $RunDir)
}

function Set-KitRuntimeSignature {
    param([string] $Path, $Value)
    $Value | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $Path -Encoding ascii
}

function Test-KitRuntimeSignatureMatches {
    param([string] $Path, $Expected)
    return $false
}
'@ | Set-Content -LiteralPath (Join-Path $libRoot 'host-native-launcher.ps1') -Encoding ascii

    @'
function Wait-KitReady {
    param([string] $LogPath, [int] $SignalPort, [int] $TimeoutSec)
    return [pscustomobject]@{
        ready          = $true
        listenPort     = $SignalPort
        matchedKeyword = 'mock-ready'
    }
}
'@ | Set-Content -LiteralPath (Join-Path $libRoot 'kit-log-probe.ps1') -Encoding ascii
}

try {
    $expected = 'D:\Users\deploy\AI-bim-geo'
    Assert-Equal $expected (Assert-TestDeployPath -Path $expected) 'fixed deployment path is accepted'
    Assert-Throws { Assert-TestDeployPath -Path 'D:\Users\deploy\AI-bim-geo2' } 'nearby deployment path is rejected'
    Assert-Throws { Assert-TestDeployPath -Path $sandbox } 'temporary sandbox path is rejected'

    $cleanupRoot = Join-Path $sandbox 'AI-bim-geo'
    $toolingDirNames = @('.codex', '.agents', '.agent', '.claude', '.cursor', '.windsurf', '.github\skills', '.github\prompts', 'docs', 'openspec', 'patches')
    New-Item -ItemType Directory -Path $cleanupRoot -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $cleanupRoot '.github\workflows') -Force | Out-Null
    foreach ($dirName in $toolingDirNames) {
        New-Item -ItemType Directory -Path (Join-Path $cleanupRoot "$dirName\content") -Force | Out-Null
    }
    New-Item -ItemType Directory -Path (Join-Path $cleanupRoot 'apps\kit-manager-web') -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $cleanupRoot 'scripts') -Force | Out-Null
    'root agent' | Set-Content -LiteralPath (Join-Path $cleanupRoot 'AGENTS.md') -Encoding ascii
    'root claude' | Set-Content -LiteralPath (Join-Path $cleanupRoot 'CLAUDE.md') -Encoding ascii
    'nested agent' | Set-Content -LiteralPath (Join-Path $cleanupRoot 'apps\kit-manager-web\AGENTS.md') -Encoding ascii
    'workflow' | Set-Content -LiteralPath (Join-Path $cleanupRoot '.github\workflows\ci.yml') -Encoding ascii
    'deploy' | Set-Content -LiteralPath (Join-Path $cleanupRoot 'scripts\deploy.ps1') -Encoding ascii
    New-Item -ItemType Directory -Path (Join-Path $cleanupRoot 'docs\plans') -Force | Out-Null
    ':root { --ab-test: 1; }' | Set-Content -LiteralPath (Join-Path $cleanupRoot 'docs\plans\ai-bim-governance.css') -Encoding ascii

    Assert-Throws { Remove-TestDeployAgentTooling -DeploymentPath $cleanupRoot } 'temporary cleanup root requires explicit test escape'

    $removed = Remove-TestDeployAgentTooling -DeploymentPath $cleanupRoot -AllowNonFixedPathForTests
    Assert-True ($removed.Count -ge 4) 'agent/tooling paths are reported as removed'
    Assert-True (-not (Test-Path -LiteralPath (Join-Path $cleanupRoot 'AGENTS.md'))) 'root AGENTS.md removed'
    Assert-True (-not (Test-Path -LiteralPath (Join-Path $cleanupRoot 'CLAUDE.md'))) 'root CLAUDE.md removed'
    Assert-True (-not (Test-Path -LiteralPath (Join-Path $cleanupRoot 'apps\kit-manager-web\AGENTS.md'))) 'nested AGENTS.md removed'
    foreach ($dirName in ($toolingDirNames | Where-Object { $_ -ne 'docs' })) {
        Assert-True (-not (Test-Path -LiteralPath (Join-Path $cleanupRoot $dirName))) "root $dirName removed"
    }
    Assert-True (-not (Test-Path -LiteralPath (Join-Path $cleanupRoot 'docs\content'))) 'docs tooling content removed'
    $preservedCss = Join-Path $cleanupRoot 'docs\plans\ai-bim-governance.css'
    Assert-True (Test-Path -LiteralPath $preservedCss) 'design token css preserved through docs removal'
    Assert-Equal ':root { --ab-test: 1; }' ((Get-Content -LiteralPath $preservedCss -Raw).Trim()) 'design token css content intact'
    Assert-True (Test-Path -LiteralPath (Join-Path $cleanupRoot '.github\workflows\ci.yml')) '.github workflows kept'
    Assert-True (Test-Path -LiteralPath (Join-Path $cleanupRoot 'scripts\deploy.ps1')) 'deploy.ps1 kept'

    $assetStageRoot = Join-Path $sandbox 'design-assets-stage'
    New-Item -ItemType Directory -Path (Join-Path $assetStageRoot 'docs\plans\assets') -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $assetStageRoot 'docs\plans\uploads') -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $assetStageRoot 'web-viewer-sample\public\design-assets') -Force | Out-Null
    'asset-a' | Set-Content -LiteralPath (Join-Path $assetStageRoot 'docs\plans\assets\vp-test.png') -Encoding ascii
    'asset-b' | Set-Content -LiteralPath (Join-Path $assetStageRoot 'docs\plans\uploads\concept-test.png') -Encoding ascii
    'stale' | Set-Content -LiteralPath (Join-Path $assetStageRoot 'web-viewer-sample\public\design-assets\stale.png') -Encoding ascii
    $unexpectedAssetPath = Join-Path $assetStageRoot 'web-viewer-sample\public\design-assets\unexpected.txt'
    'must survive fail-closed validation' | Set-Content -LiteralPath $unexpectedAssetPath -Encoding ascii
    Assert-Throws { Sync-DeploymentDesignAssets -RepoRoot $assetStageRoot } 'unexpected non-PNG staging residue fails closed'
    Assert-True (Test-Path -LiteralPath $unexpectedAssetPath -PathType Leaf) 'unexpected staging file is preserved after rejection'
    Remove-Item -LiteralPath $unexpectedAssetPath -Force
    $unexpectedAssetDirectory = Join-Path $assetStageRoot 'web-viewer-sample\public\design-assets\unexpected-directory'
    New-Item -ItemType Directory -Path $unexpectedAssetDirectory | Out-Null
    Assert-Throws { Sync-DeploymentDesignAssets -RepoRoot $assetStageRoot } 'unexpected staging directory fails closed'
    Assert-True (Test-Path -LiteralPath $unexpectedAssetDirectory -PathType Container) 'unexpected staging directory is preserved after rejection'
    [System.IO.Directory]::Delete($unexpectedAssetDirectory, $false)
    $assetStage = Sync-DeploymentDesignAssets -RepoRoot $assetStageRoot
    Assert-Equal 'synced' $assetStage.Mode 'design assets are refreshed from tracked docs sources'
    Assert-Equal 2 $assetStage.Count 'design assets stage includes both source directories'
    Assert-True (-not (Test-Path -LiteralPath (Join-Path $assetStageRoot 'web-viewer-sample\public\design-assets\stale.png'))) 'stale generated PNG is removed'
    $rollbackDestinationParent = Join-Path $assetStageRoot 'web-viewer-sample\public'
    $rollbackDestination = Join-Path $rollbackDestinationParent 'design-assets'
    $rollbackStagePath = Join-Path $rollbackDestinationParent ".design-assets-stage-rollback-$([Guid]::NewGuid().ToString('N'))"
    Copy-Item -LiteralPath $rollbackDestination -Destination $rollbackStagePath -Recurse
    $rollbackInventoryBefore = @(
        Get-ChildItem -LiteralPath $rollbackDestination -Force -File |
            Sort-Object Name |
            ForEach-Object { "$($_.Name):$((Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash)" }
    ) -join "`n"
    $rollbackMoveCounter = [pscustomobject]@{ Value = 0 }
    $rollbackMover = {
        param([string] $Source, [string] $Target)
        $rollbackMoveCounter.Value++
        if ($rollbackMoveCounter.Value -eq 2) {
            throw 'injected stage-to-destination rename failure'
        }
        [System.IO.Directory]::Move($Source, $Target)
    }.GetNewClosure()
    Assert-Throws {
        Publish-DeploymentDesignAssetStage `
            -StagePath $rollbackStagePath `
            -Destination $rollbackDestination `
            -DestinationParent $rollbackDestinationParent `
            -BoundaryRoot $assetStageRoot `
            -DirectoryMover $rollbackMover
    } 'claim/swap publication restores the last-known-good directory when stage rename fails'
    $rollbackInventoryAfter = @(
        Get-ChildItem -LiteralPath $rollbackDestination -Force -File |
            Sort-Object Name |
            ForEach-Object { "$($_.Name):$((Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash)" }
    ) -join "`n"
    Assert-Equal $rollbackInventoryBefore $rollbackInventoryAfter 'rename failure rollback preserves canonical design-asset bytes and inventory'
    Assert-True (Test-Path -LiteralPath $rollbackStagePath -PathType Container) 'rename failure leaves the validated stage available for diagnosis'
    Assert-NoDeploymentDesignAssetBackupResidue -DestinationParent $rollbackDestinationParent -BoundaryRoot $assetStageRoot
    Remove-ReplaceableDeploymentDesignAssetDirectory -Destination $rollbackStagePath -BoundaryRoot $assetStageRoot

    $postPublishStagePath = Join-Path $rollbackDestinationParent ".design-assets-stage-post-publish-$([Guid]::NewGuid().ToString('N'))"
    Copy-Item -LiteralPath $rollbackDestination -Destination $postPublishStagePath -Recurse
    $postPublishValidator = {
        param([string] $PublishedPath, [string] $RootBoundary)
        throw 'injected post-publish validation failure'
    }
    Assert-Throws {
        Publish-DeploymentDesignAssetStage `
            -StagePath $postPublishStagePath `
            -Destination $rollbackDestination `
            -DestinationParent $rollbackDestinationParent `
            -BoundaryRoot $assetStageRoot `
            -PublicationValidator $postPublishValidator
    } 'post-publish validation failure restores the last-known-good directory'
    $postPublishInventoryAfter = @(
        Get-ChildItem -LiteralPath $rollbackDestination -Force -File |
            Sort-Object Name |
            ForEach-Object { "$($_.Name):$((Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash)" }
    ) -join "`n"
    Assert-Equal $rollbackInventoryBefore $postPublishInventoryAfter 'post-publish rollback preserves canonical bytes and inventory'
    Assert-True (Test-Path -LiteralPath $postPublishStagePath -PathType Container) 'rejected post-publish directory is moved back to staging'
    Assert-NoDeploymentDesignAssetBackupResidue -DestinationParent $rollbackDestinationParent -BoundaryRoot $assetStageRoot
    Remove-ReplaceableDeploymentDesignAssetDirectory -Destination $postPublishStagePath -BoundaryRoot $assetStageRoot

    $moveBackFailureStagePath = Join-Path $rollbackDestinationParent ".design-assets-stage-move-back-failure-$([Guid]::NewGuid().ToString('N'))"
    Copy-Item -LiteralPath $rollbackDestination -Destination $moveBackFailureStagePath -Recurse
    'rejected-new-publication' | Set-Content -LiteralPath (Join-Path $moveBackFailureStagePath 'vp-test.png') -Encoding ascii
    $moveBackFailureCounter = [pscustomobject]@{ Value = 0 }
    $moveBackFailureMover = {
        param([string] $Source, [string] $Target)
        $moveBackFailureCounter.Value++
        if ($moveBackFailureCounter.Value -eq 3) {
            throw 'injected rejected-publication move-back failure'
        }
        [System.IO.Directory]::Move($Source, $Target)
    }.GetNewClosure()
    $moveBackFailureMessage = $null
    try {
        Publish-DeploymentDesignAssetStage `
            -StagePath $moveBackFailureStagePath `
            -Destination $rollbackDestination `
            -DestinationParent $rollbackDestinationParent `
            -BoundaryRoot $assetStageRoot `
            -DirectoryMover $moveBackFailureMover `
            -PublicationValidator $postPublishValidator
    } catch {
        $moveBackFailureMessage = $_.Exception.Message
    }
    Assert-True ($moveBackFailureMessage -match 'Additionally failed to move the rejected design-assets publication back to staging') 'rollback move-back failure preserves both primary and recovery errors'
    $moveBackFailureBackups = @(
        Get-ChildItem -LiteralPath $rollbackDestinationParent -Force -Directory |
            Where-Object { $_.Name.StartsWith('.design-assets-backup-', [System.StringComparison]::Ordinal) }
    )
    Assert-Equal 1 $moveBackFailureBackups.Count 'rollback move-back failure retains exactly one last-known-good backup'
    Assert-True (-not (Test-Path -LiteralPath $moveBackFailureStagePath)) 'rollback move-back failure leaves the rejected publication at canonical'
    Assert-Equal 'rejected-new-publication' ((Get-Content -LiteralPath (Join-Path $rollbackDestination 'vp-test.png') -Raw).Trim()) 'rollback move-back failure never overwrites the retained backup'
    Remove-ReplaceableDeploymentDesignAssetDirectory -Destination $rollbackDestination -BoundaryRoot $assetStageRoot
    [System.IO.Directory]::Move($moveBackFailureBackups[0].FullName, $rollbackDestination)

    $backupRestoreFailureStagePath = Join-Path $rollbackDestinationParent ".design-assets-stage-backup-restore-failure-$([Guid]::NewGuid().ToString('N'))"
    Copy-Item -LiteralPath $rollbackDestination -Destination $backupRestoreFailureStagePath -Recurse
    'rejected-before-restore' | Set-Content -LiteralPath (Join-Path $backupRestoreFailureStagePath 'vp-test.png') -Encoding ascii
    $backupRestoreFailureCounter = [pscustomobject]@{ Value = 0 }
    $backupRestoreFailureMover = {
        param([string] $Source, [string] $Target)
        $backupRestoreFailureCounter.Value++
        if ($backupRestoreFailureCounter.Value -eq 4) {
            throw 'injected backup restore failure'
        }
        [System.IO.Directory]::Move($Source, $Target)
    }.GetNewClosure()
    $backupRestoreFailureMessage = $null
    try {
        Publish-DeploymentDesignAssetStage `
            -StagePath $backupRestoreFailureStagePath `
            -Destination $rollbackDestination `
            -DestinationParent $rollbackDestinationParent `
            -BoundaryRoot $assetStageRoot `
            -DirectoryMover $backupRestoreFailureMover `
            -PublicationValidator $postPublishValidator
    } catch {
        $backupRestoreFailureMessage = $_.Exception.Message
    }
    Assert-True ($backupRestoreFailureMessage -match 'Additionally failed to restore the previous design-assets directory') 'backup restore failure preserves both primary and recovery errors'
    $backupRestoreFailureBackups = @(
        Get-ChildItem -LiteralPath $rollbackDestinationParent -Force -Directory |
            Where-Object { $_.Name.StartsWith('.design-assets-backup-', [System.StringComparison]::Ordinal) }
    )
    Assert-Equal 1 $backupRestoreFailureBackups.Count 'backup restore failure retains exactly one last-known-good backup'
    Assert-True (-not (Test-Path -LiteralPath $rollbackDestination)) 'backup restore failure leaves canonical absent rather than claiming success'
    Assert-Equal 'rejected-before-restore' ((Get-Content -LiteralPath (Join-Path $backupRestoreFailureStagePath 'vp-test.png') -Raw).Trim()) 'backup restore failure retains the rejected publication in staging'
    [System.IO.Directory]::Move($backupRestoreFailureBackups[0].FullName, $rollbackDestination)
    Remove-ReplaceableDeploymentDesignAssetDirectory -Destination $backupRestoreFailureStagePath -BoundaryRoot $assetStageRoot

    $backupCleanupFailureStagePath = Join-Path $rollbackDestinationParent ".design-assets-stage-backup-cleanup-failure-$([Guid]::NewGuid().ToString('N'))"
    Copy-Item -LiteralPath $rollbackDestination -Destination $backupCleanupFailureStagePath -Recurse
    $backupCleanupFailureRemover = {
        param([string] $DirectoryPath, [string] $RootBoundary)
        throw 'injected backup cleanup failure'
    }
    $backupCleanupFailureMessage = $null
    try {
        Publish-DeploymentDesignAssetStage `
            -StagePath $backupCleanupFailureStagePath `
            -Destination $rollbackDestination `
            -DestinationParent $rollbackDestinationParent `
            -BoundaryRoot $assetStageRoot `
            -DirectoryRemover $backupCleanupFailureRemover
    } catch {
        $backupCleanupFailureMessage = $_.Exception.Message
    }
    Assert-True ($backupCleanupFailureMessage -match 'claimed backup was retained for manual inspection') 'backup cleanup failure is fail-closed and reports retained recovery data'
    $backupCleanupFailureBackups = @(
        Get-ChildItem -LiteralPath $rollbackDestinationParent -Force -Directory |
            Where-Object { $_.Name.StartsWith('.design-assets-backup-', [System.StringComparison]::Ordinal) }
    )
    Assert-Equal 1 $backupCleanupFailureBackups.Count 'backup cleanup failure retains exactly one backup'
    Assert-DeploymentDesignAssetsPrestaged -Destination $rollbackDestination -BoundaryRoot $assetStageRoot | Out-Null
    Remove-ReplaceableDeploymentDesignAssetDirectory -Destination $backupCleanupFailureBackups[0].FullName -BoundaryRoot $assetStageRoot
    Assert-NoDeploymentDesignAssetBackupResidue -DestinationParent $rollbackDestinationParent -BoundaryRoot $assetStageRoot

    Remove-Item -LiteralPath (Join-Path $assetStageRoot 'docs') -Recurse -Force
    $prestaged = Sync-DeploymentDesignAssets -RepoRoot $assetStageRoot
    Assert-Equal 'prestaged' $prestaged.Mode 'deployment without root docs reuses verified prestaged assets'
    'tampered' | Set-Content -LiteralPath (Join-Path $assetStageRoot 'web-viewer-sample\public\design-assets\vp-test.png') -Encoding ascii
    Assert-Throws { Sync-DeploymentDesignAssets -RepoRoot $assetStageRoot } 'tampered prestaged asset is rejected by SHA-256 manifest'

    $resolveTestReparseTargetPath = ${function:Resolve-TestReparseTargetPath}
    $assertTrue = ${function:Assert-True}
    $removeVerifiedAssetJunction = {
        param(
            [Parameter(Mandatory = $true)][string] $LinkPath,
            [Parameter(Mandatory = $true)][string] $ExpectedTarget
        )

        $linkItem = Get-Item -LiteralPath $LinkPath -Force -ErrorAction Stop
        if (-not [bool]($linkItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint)) {
            throw "design asset test cleanup refused non-reparse path: '$LinkPath'"
        }
        $resolvedTarget = & $resolveTestReparseTargetPath -LinkItem $linkItem
        if (
            [string]::IsNullOrWhiteSpace($resolvedTarget) -or
            -not $resolvedTarget.Equals(
                [System.IO.Path]::GetFullPath($ExpectedTarget),
                [System.StringComparison]::OrdinalIgnoreCase
            )
        ) {
            throw "design asset test cleanup refused junction target mismatch: '$LinkPath'"
        }
        [System.IO.Directory]::Delete([System.IO.Path]::GetFullPath($LinkPath), $false)
        & $assertTrue (-not (Test-Path -LiteralPath $LinkPath)) 'design asset test junction is detached without traversing target'
        & $assertTrue (Test-Path -LiteralPath $ExpectedTarget -PathType Container) 'design asset test junction target remains after detach'
    }.GetNewClosure()

    $sourceGuardRoot = Join-Path $sandbox 'design-assets-source-guard'
    $sourceGuardAssets = Join-Path $sourceGuardRoot 'docs\plans\assets'
    $sourceGuardUploads = Join-Path $sourceGuardRoot 'docs\plans\uploads'
    $sourceGuardPublic = Join-Path $sourceGuardRoot 'web-viewer-sample\public'
    $sourceGuardDestination = Join-Path $sourceGuardPublic 'design-assets'
    New-Item -ItemType Directory -Path $sourceGuardAssets -Force | Out-Null
    New-Item -ItemType Directory -Path $sourceGuardUploads -Force | Out-Null
    New-Item -ItemType Directory -Path $sourceGuardPublic -Force | Out-Null
    'source-a' | Set-Content -LiteralPath (Join-Path $sourceGuardAssets 'vp-source-guard.png') -Encoding ascii
    'source-b' | Set-Content -LiteralPath (Join-Path $sourceGuardUploads 'concept-source-guard.png') -Encoding ascii
    Sync-DeploymentDesignAssets -RepoRoot $sourceGuardRoot | Out-Null
    $sourceGuardInventoryBefore = @(
        Get-ChildItem -LiteralPath $sourceGuardDestination -Force -File |
            Sort-Object Name |
            ForEach-Object { "$($_.Name):$((Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash)" }
    ) -join "`n"

    $sourceGuardLock = Enter-DeploymentDesignAssetLock -DestinationParent $sourceGuardPublic -BoundaryRoot $sourceGuardRoot
    try {
        $callerOwnedLockResult = Sync-DeploymentDesignAssets -RepoRoot $sourceGuardRoot -LockHandle $sourceGuardLock
        Assert-Equal 'synced' $callerOwnedLockResult.Mode 'PowerShell sync accepts the live caller-owned lock without reacquiring it'
        Assert-True (Test-Path -LiteralPath (Join-Path $sourceGuardPublic '.design-assets-sync.lock') -PathType Leaf) 'caller-owned lock remains held after nested sync'
        Assert-Throws { Sync-DeploymentDesignAssets -RepoRoot $sourceGuardRoot } 'PowerShell design-asset lock rejects a concurrent official adapter'
    } finally {
        $sourceGuardLock.Dispose()
    }
    Assert-True (-not (Test-Path -LiteralPath (Join-Path $sourceGuardPublic '.design-assets-sync.lock'))) 'PowerShell lock uses delete-on-close without stale residue'

    $sourceAccessDeniedReader = {
        param([string] $CandidatePath)
        throw [System.UnauthorizedAccessException]::new('injected source ancestor access denied')
    }
    $sourceAccessDeniedMessage = $null
    try {
        Sync-DeploymentDesignAssets -RepoRoot $sourceGuardRoot -SourceItemReader $sourceAccessDeniedReader | Out-Null
    } catch {
        $sourceAccessDeniedMessage = $_.Exception.Message
    }
    Assert-True ($sourceAccessDeniedMessage -match 'injected source ancestor access denied') 'PowerShell source probe rethrows access denied instead of accepting stale prestaging'
    $sourceGuardInventoryAfterAccessDenied = @(
        Get-ChildItem -LiteralPath $sourceGuardDestination -Force -File |
            Sort-Object Name |
            ForEach-Object { "$($_.Name):$((Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash)" }
    ) -join "`n"
    Assert-Equal $sourceGuardInventoryBefore $sourceGuardInventoryAfterAccessDenied 'access-denied source probe preserves canonical bytes and inventory'

    $sourceIoFailureReader = {
        param([string] $CandidatePath)
        throw [System.IO.IOException]::new('injected source ancestor IO failure')
    }
    $sourceIoFailureMessage = $null
    try {
        Sync-DeploymentDesignAssets -RepoRoot $sourceGuardRoot -SourceItemReader $sourceIoFailureReader | Out-Null
    } catch {
        $sourceIoFailureMessage = $_.Exception.Message
    }
    Assert-True ($sourceIoFailureMessage -match 'injected source ancestor IO failure') 'PowerShell source probe rethrows IO failure instead of accepting stale prestaging'

    $sourceDoubleFailureDisposer = {
        param([System.IO.FileStream] $Handle)
        $Handle.Dispose()
        throw [System.IO.IOException]::new('injected lock cleanup failure')
    }
    $sourceDoubleFailureMessage = $null
    try {
        Sync-DeploymentDesignAssets `
            -RepoRoot $sourceGuardRoot `
            -SourceItemReader $sourceAccessDeniedReader `
            -LockDisposer $sourceDoubleFailureDisposer `
            -WarningAction Stop | Out-Null
    } catch {
        $sourceDoubleFailureMessage = $_.Exception.Message
    }
    Assert-True ($sourceDoubleFailureMessage -match 'injected source ancestor access denied') 'PowerShell lock cleanup failure does not overwrite the primary source error'
    Assert-True ($sourceDoubleFailureMessage -notmatch '^injected lock cleanup failure$') 'PowerShell double failure never promotes cleanup above primary'
    Assert-True (-not (Test-Path -LiteralPath (Join-Path $sourceGuardPublic '.design-assets-sync.lock'))) 'double-failure test still releases the design-assets lock'

    Remove-Item -LiteralPath $sourceGuardAssets -Recurse -Force
    Remove-Item -LiteralPath $sourceGuardUploads -Recurse -Force
    'not a directory' | Set-Content -LiteralPath $sourceGuardAssets -Encoding ascii
    'not a directory' | Set-Content -LiteralPath $sourceGuardUploads -Encoding ascii
    Assert-Throws { Sync-DeploymentDesignAssets -RepoRoot $sourceGuardRoot } 'PowerShell source probe rejects two regular files instead of falling back to prestaged assets'
    Remove-Item -LiteralPath $sourceGuardAssets -Force
    Remove-Item -LiteralPath $sourceGuardUploads -Force
    [System.IO.Directory]::Delete((Join-Path $sourceGuardRoot 'docs\plans'), $false)
    [System.IO.Directory]::Delete((Join-Path $sourceGuardRoot 'docs'), $false)
    'not a directory ancestor' | Set-Content -LiteralPath (Join-Path $sourceGuardRoot 'docs') -Encoding ascii
    Assert-Throws { Sync-DeploymentDesignAssets -RepoRoot $sourceGuardRoot } 'PowerShell source probe rejects a non-directory source ancestor'
    Remove-Item -LiteralPath (Join-Path $sourceGuardRoot 'docs') -Force
    New-Item -ItemType Directory -Path (Join-Path $sourceGuardRoot 'docs\plans') -Force | Out-Null

    $sourceGuardAssetsTarget = Join-Path $sandbox 'design-assets-source-guard-assets-target'
    $sourceGuardUploadsTarget = Join-Path $sandbox 'design-assets-source-guard-uploads-target'
    New-Item -ItemType Directory -Path $sourceGuardAssetsTarget -Force | Out-Null
    New-Item -ItemType Directory -Path $sourceGuardUploadsTarget -Force | Out-Null
    New-Item -ItemType Junction -Path $sourceGuardAssets -Target $sourceGuardAssetsTarget -ErrorAction Stop | Out-Null
    New-Item -ItemType Junction -Path $sourceGuardUploads -Target $sourceGuardUploadsTarget -ErrorAction Stop | Out-Null
    [System.IO.Directory]::Delete($sourceGuardAssetsTarget, $false)
    [System.IO.Directory]::Delete($sourceGuardUploadsTarget, $false)
    try {
        Assert-Throws { Sync-DeploymentDesignAssets -RepoRoot $sourceGuardRoot } 'PowerShell source probe rejects two dangling junctions'
        $danglingAssetsItem = Get-Item -LiteralPath $sourceGuardAssets -Force -ErrorAction Stop
        Assert-True ([bool]($danglingAssetsItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint)) 'PowerShell source fixture keeps a real dangling assets junction'
        [System.IO.Directory]::Delete($sourceGuardAssets, $false)
        Assert-Throws { Sync-DeploymentDesignAssets -RepoRoot $sourceGuardRoot } 'PowerShell source probe rejects missing plus dangling source entries'
    } finally {
        $remainingUploadsLink = Get-Item -LiteralPath $sourceGuardUploads -Force -ErrorAction SilentlyContinue
        if ($null -ne $remainingUploadsLink) {
            if (-not [bool]($remainingUploadsLink.Attributes -band [System.IO.FileAttributes]::ReparsePoint)) {
                throw "source guard cleanup refused non-reparse path: '$sourceGuardUploads'"
            }
            [System.IO.Directory]::Delete($sourceGuardUploads, $false)
        }
        $remainingAssetsLink = Get-Item -LiteralPath $sourceGuardAssets -Force -ErrorAction SilentlyContinue
        if ($null -ne $remainingAssetsLink) {
            if (-not [bool]($remainingAssetsLink.Attributes -band [System.IO.FileAttributes]::ReparsePoint)) {
                throw "source guard cleanup refused non-reparse path: '$sourceGuardAssets'"
            }
            [System.IO.Directory]::Delete($sourceGuardAssets, $false)
        }
    }
    $sourceGuardInventoryAfter = @(
        Get-ChildItem -LiteralPath $sourceGuardDestination -Force -File |
            Sort-Object Name |
            ForEach-Object { "$($_.Name):$((Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash)" }
    ) -join "`n"
    Assert-Equal $sourceGuardInventoryBefore $sourceGuardInventoryAfter 'rejected PowerShell source types preserve the prestaged canonical inventory'

    $powerShellJunctionRepo = Join-Path $sandbox 'design-assets-powershell-junction-repo'
    $powerShellJunctionOutside = Join-Path $sandbox 'design-assets-powershell-junction-outside'
    $powerShellJunctionPublic = Join-Path $powerShellJunctionRepo 'web-viewer-sample\public'
    $powerShellJunctionOutsideAssets = Join-Path $powerShellJunctionOutside 'design-assets'
    New-Item -ItemType Directory -Path (Join-Path $powerShellJunctionRepo 'docs\plans\assets') -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $powerShellJunctionRepo 'docs\plans\uploads') -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $powerShellJunctionRepo 'web-viewer-sample') -Force | Out-Null
    New-Item -ItemType Directory -Path $powerShellJunctionOutsideAssets -Force | Out-Null
    'source-a' | Set-Content -LiteralPath (Join-Path $powerShellJunctionRepo 'docs\plans\assets\vp-junction.png') -Encoding ascii
    'source-b' | Set-Content -LiteralPath (Join-Path $powerShellJunctionRepo 'docs\plans\uploads\concept-junction.png') -Encoding ascii
    $powerShellJunctionSentinel = Join-Path $powerShellJunctionOutsideAssets 'sentinel.png'
    'outside sentinel' | Set-Content -LiteralPath $powerShellJunctionSentinel -Encoding ascii
    $powerShellJunctionHashBefore = (Get-FileHash -LiteralPath $powerShellJunctionSentinel -Algorithm SHA256).Hash
    $powerShellJunctionInventoryBefore = @(
        Get-ChildItem -LiteralPath $powerShellJunctionOutside -Force -Recurse |
            ForEach-Object { $_.FullName.Substring($powerShellJunctionOutside.Length) }
    ) -join "`n"
    try {
        New-Item -ItemType Junction -Path $powerShellJunctionPublic -Target $powerShellJunctionOutside -ErrorAction Stop | Out-Null
        Assert-Throws { Sync-DeploymentDesignAssets -RepoRoot $powerShellJunctionRepo } 'PowerShell sync rejects an ancestor junction before destination traversal'
        $powerShellJunctionHashAfter = (Get-FileHash -LiteralPath $powerShellJunctionSentinel -Algorithm SHA256).Hash
        $powerShellJunctionInventoryAfter = @(
            Get-ChildItem -LiteralPath $powerShellJunctionOutside -Force -Recurse |
                ForEach-Object { $_.FullName.Substring($powerShellJunctionOutside.Length) }
        ) -join "`n"
        Assert-Equal $powerShellJunctionHashBefore $powerShellJunctionHashAfter 'PowerShell ancestor-junction rejection preserves outside bytes'
        Assert-Equal $powerShellJunctionInventoryBefore $powerShellJunctionInventoryAfter 'PowerShell ancestor-junction rejection preserves outside inventory'
    } finally {
        if (Test-Path -LiteralPath $powerShellJunctionPublic) {
            & $removeVerifiedAssetJunction -LinkPath $powerShellJunctionPublic -ExpectedTarget $powerShellJunctionOutside
        }
    }

    $nodeJunctionRepo = Join-Path $sandbox 'design-assets-node-junction-repo'
    $nodeJunctionOutside = Join-Path $sandbox 'design-assets-node-junction-outside'
    $nodeJunctionPublic = Join-Path $nodeJunctionRepo 'web-viewer-sample\public'
    $nodeJunctionOutsideAssets = Join-Path $nodeJunctionOutside 'design-assets'
    $nodeJunctionScript = Join-Path $nodeJunctionRepo 'web-viewer-sample\scripts\sync-design-assets.mjs'
    New-Item -ItemType Directory -Path (Join-Path $nodeJunctionRepo 'docs\plans\assets') -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $nodeJunctionRepo 'docs\plans\uploads') -Force | Out-Null
    New-Item -ItemType Directory -Path (Split-Path -Parent $nodeJunctionScript) -Force | Out-Null
    New-Item -ItemType Directory -Path $nodeJunctionOutsideAssets -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path $repoRoot 'web-viewer-sample\scripts\sync-design-assets.mjs') -Destination $nodeJunctionScript
    'source-a' | Set-Content -LiteralPath (Join-Path $nodeJunctionRepo 'docs\plans\assets\vp-junction.png') -Encoding ascii
    'source-b' | Set-Content -LiteralPath (Join-Path $nodeJunctionRepo 'docs\plans\uploads\concept-junction.png') -Encoding ascii
    $nodeJunctionSentinel = Join-Path $nodeJunctionOutsideAssets 'sentinel.png'
    'outside sentinel' | Set-Content -LiteralPath $nodeJunctionSentinel -Encoding ascii
    $nodeJunctionHashBefore = (Get-FileHash -LiteralPath $nodeJunctionSentinel -Algorithm SHA256).Hash
    $nodeJunctionInventoryBefore = @(
        Get-ChildItem -LiteralPath $nodeJunctionOutside -Force -Recurse |
            ForEach-Object { $_.FullName.Substring($nodeJunctionOutside.Length) }
    ) -join "`n"
    $nodeJunctionStdout = Join-Path $sandbox 'design-assets-node-junction.stdout.log'
    $nodeJunctionStderr = Join-Path $sandbox 'design-assets-node-junction.stderr.log'
    try {
        New-Item -ItemType Junction -Path $nodeJunctionPublic -Target $nodeJunctionOutside -ErrorAction Stop | Out-Null
        $nodeJunctionProcess = Start-Process -FilePath 'node' -ArgumentList @($nodeJunctionScript) -Wait -PassThru -NoNewWindow `
            -RedirectStandardOutput $nodeJunctionStdout -RedirectStandardError $nodeJunctionStderr
        Assert-True ($nodeJunctionProcess.ExitCode -ne 0) 'Node sync rejects an ancestor junction'
        $nodeJunctionError = Get-Content -LiteralPath $nodeJunctionStderr -Raw
        Assert-True ($nodeJunctionError -match 'symbolic link or junction') 'Node ancestor-junction rejection reports the guarded path condition'
        $nodeJunctionHashAfter = (Get-FileHash -LiteralPath $nodeJunctionSentinel -Algorithm SHA256).Hash
        $nodeJunctionInventoryAfter = @(
            Get-ChildItem -LiteralPath $nodeJunctionOutside -Force -Recurse |
                ForEach-Object { $_.FullName.Substring($nodeJunctionOutside.Length) }
        ) -join "`n"
        Assert-Equal $nodeJunctionHashBefore $nodeJunctionHashAfter 'Node ancestor-junction rejection preserves outside bytes'
        Assert-Equal $nodeJunctionInventoryBefore $nodeJunctionInventoryAfter 'Node ancestor-junction rejection preserves outside inventory'
    } finally {
        if (Test-Path -LiteralPath $nodeJunctionPublic) {
            & $removeVerifiedAssetJunction -LinkPath $nodeJunctionPublic -ExpectedTarget $nodeJunctionOutside
        }
    }

    $invokeNodeDesignAssetSync = {
        param(
            [Parameter(Mandatory = $true)][string] $ScriptPath,
            [Parameter(Mandatory = $true)][string] $EvidenceName
        )

        $stdoutPath = Join-Path $sandbox "$EvidenceName.stdout.log"
        $stderrPath = Join-Path $sandbox "$EvidenceName.stderr.log"
        $process = Start-Process -FilePath 'node' -ArgumentList @($ScriptPath) -Wait -PassThru -NoNewWindow `
            -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath
        return [pscustomobject]@{
            ExitCode = $process.ExitCode
            Stdout = if (Test-Path -LiteralPath $stdoutPath) { Get-Content -LiteralPath $stdoutPath -Raw } else { '' }
            Stderr = if (Test-Path -LiteralPath $stderrPath) { Get-Content -LiteralPath $stderrPath -Raw } else { '' }
        }
    }.GetNewClosure()

    $nodeSourceGuardRoot = Join-Path $sandbox 'design-assets-node-source-guard'
    $nodeSourceGuardAssets = Join-Path $nodeSourceGuardRoot 'docs\plans\assets'
    $nodeSourceGuardUploads = Join-Path $nodeSourceGuardRoot 'docs\plans\uploads'
    $nodeSourceGuardPublic = Join-Path $nodeSourceGuardRoot 'web-viewer-sample\public'
    $nodeSourceGuardDestination = Join-Path $nodeSourceGuardPublic 'design-assets'
    $nodeSourceGuardScript = Join-Path $nodeSourceGuardRoot 'web-viewer-sample\scripts\sync-design-assets.mjs'
    New-Item -ItemType Directory -Path $nodeSourceGuardAssets -Force | Out-Null
    New-Item -ItemType Directory -Path $nodeSourceGuardUploads -Force | Out-Null
    New-Item -ItemType Directory -Path $nodeSourceGuardPublic -Force | Out-Null
    New-Item -ItemType Directory -Path (Split-Path -Parent $nodeSourceGuardScript) -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path $repoRoot 'web-viewer-sample\scripts\sync-design-assets.mjs') -Destination $nodeSourceGuardScript
    'source-a' | Set-Content -LiteralPath (Join-Path $nodeSourceGuardAssets 'vp-source-guard.png') -Encoding ascii
    'source-b' | Set-Content -LiteralPath (Join-Path $nodeSourceGuardUploads 'concept-source-guard.png') -Encoding ascii
    $nodeSourceInitial = & $invokeNodeDesignAssetSync -ScriptPath $nodeSourceGuardScript -EvidenceName 'node-source-initial'
    Assert-Equal 0 $nodeSourceInitial.ExitCode 'Node source guard fixture creates an initial sealed staging directory'
    $nodeSourceInventoryBefore = @(
        Get-ChildItem -LiteralPath $nodeSourceGuardDestination -Force -File |
            Sort-Object Name |
            ForEach-Object { "$($_.Name):$((Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash)" }
    ) -join "`n"

    $nodeCrossAdapterLock = Enter-DeploymentDesignAssetLock -DestinationParent $nodeSourceGuardPublic -BoundaryRoot $nodeSourceGuardRoot
    try {
        $nodeLockedRun = & $invokeNodeDesignAssetSync -ScriptPath $nodeSourceGuardScript -EvidenceName 'node-source-locked'
        Assert-True ($nodeLockedRun.ExitCode -ne 0) 'Node adapter rejects the lock held by the PowerShell adapter'
        Assert-True ($nodeLockedRun.Stderr -match 'already running or left a stale lock') 'cross-adapter lock rejection reports a stable condition'
    } finally {
        $nodeCrossAdapterLock.Dispose()
    }

    Remove-Item -LiteralPath $nodeSourceGuardAssets -Recurse -Force
    Remove-Item -LiteralPath $nodeSourceGuardUploads -Recurse -Force
    'not a directory' | Set-Content -LiteralPath $nodeSourceGuardAssets -Encoding ascii
    'not a directory' | Set-Content -LiteralPath $nodeSourceGuardUploads -Encoding ascii
    $nodeRegularFilesRun = & $invokeNodeDesignAssetSync -ScriptPath $nodeSourceGuardScript -EvidenceName 'node-source-regular-files'
    Assert-True ($nodeRegularFilesRun.ExitCode -ne 0) 'Node source probe rejects two regular files'
    Assert-True ($nodeRegularFilesRun.Stderr -match 'source exists but is not a directory') 'Node regular-file rejection reports the source type'
    Remove-Item -LiteralPath $nodeSourceGuardAssets -Force
    Remove-Item -LiteralPath $nodeSourceGuardUploads -Force
    [System.IO.Directory]::Delete((Join-Path $nodeSourceGuardRoot 'docs\plans'), $false)
    [System.IO.Directory]::Delete((Join-Path $nodeSourceGuardRoot 'docs'), $false)
    'not a directory ancestor' | Set-Content -LiteralPath (Join-Path $nodeSourceGuardRoot 'docs') -Encoding ascii
    $nodeAncestorFileRun = & $invokeNodeDesignAssetSync -ScriptPath $nodeSourceGuardScript -EvidenceName 'node-source-ancestor-file'
    Assert-True ($nodeAncestorFileRun.ExitCode -ne 0) 'Node source probe rejects a non-directory source ancestor'
    Assert-True ($nodeAncestorFileRun.Stderr -match 'path ancestor is not a directory') 'Node source ancestor rejection reports the guarded path condition'
    Remove-Item -LiteralPath (Join-Path $nodeSourceGuardRoot 'docs') -Force
    New-Item -ItemType Directory -Path (Join-Path $nodeSourceGuardRoot 'docs\plans') -Force | Out-Null

    $nodeSourceAssetsTarget = Join-Path $sandbox 'design-assets-node-source-assets-target'
    $nodeSourceUploadsTarget = Join-Path $sandbox 'design-assets-node-source-uploads-target'
    New-Item -ItemType Directory -Path $nodeSourceAssetsTarget -Force | Out-Null
    New-Item -ItemType Directory -Path $nodeSourceUploadsTarget -Force | Out-Null
    New-Item -ItemType Junction -Path $nodeSourceGuardAssets -Target $nodeSourceAssetsTarget -ErrorAction Stop | Out-Null
    New-Item -ItemType Junction -Path $nodeSourceGuardUploads -Target $nodeSourceUploadsTarget -ErrorAction Stop | Out-Null
    [System.IO.Directory]::Delete($nodeSourceAssetsTarget, $false)
    [System.IO.Directory]::Delete($nodeSourceUploadsTarget, $false)
    try {
        $nodeDanglingRun = & $invokeNodeDesignAssetSync -ScriptPath $nodeSourceGuardScript -EvidenceName 'node-source-dangling'
        Assert-True ($nodeDanglingRun.ExitCode -ne 0) 'Node source probe rejects two dangling junctions'
        Assert-True ($nodeDanglingRun.Stderr -match 'symbolic link or junction') 'Node dangling-junction rejection reports the guarded path condition'
        [System.IO.Directory]::Delete($nodeSourceGuardAssets, $false)
        $nodeMixedRun = & $invokeNodeDesignAssetSync -ScriptPath $nodeSourceGuardScript -EvidenceName 'node-source-missing-dangling'
        Assert-True ($nodeMixedRun.ExitCode -ne 0) 'Node source probe rejects missing plus dangling source entries'
        Assert-True ($nodeMixedRun.Stderr -match 'symbolic link or junction') 'Node mixed missing/dangling rejection does not fall back to prestaged assets'
    } finally {
        $nodeRemainingUploadsLink = Get-Item -LiteralPath $nodeSourceGuardUploads -Force -ErrorAction SilentlyContinue
        if ($null -ne $nodeRemainingUploadsLink) {
            if (-not [bool]($nodeRemainingUploadsLink.Attributes -band [System.IO.FileAttributes]::ReparsePoint)) {
                throw "Node source guard cleanup refused non-reparse path: '$nodeSourceGuardUploads'"
            }
            [System.IO.Directory]::Delete($nodeSourceGuardUploads, $false)
        }
        $nodeRemainingAssetsLink = Get-Item -LiteralPath $nodeSourceGuardAssets -Force -ErrorAction SilentlyContinue
        if ($null -ne $nodeRemainingAssetsLink) {
            if (-not [bool]($nodeRemainingAssetsLink.Attributes -band [System.IO.FileAttributes]::ReparsePoint)) {
                throw "Node source guard cleanup refused non-reparse path: '$nodeSourceGuardAssets'"
            }
            [System.IO.Directory]::Delete($nodeSourceGuardAssets, $false)
        }
    }
    $nodeSourceInventoryAfter = @(
        Get-ChildItem -LiteralPath $nodeSourceGuardDestination -Force -File |
            Sort-Object Name |
            ForEach-Object { "$($_.Name):$((Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash)" }
    ) -join "`n"
    Assert-Equal $nodeSourceInventoryBefore $nodeSourceInventoryAfter 'rejected Node source types and lock contention preserve canonical inventory'

    $nodePublicationTestPath = Join-Path $repoRoot 'web-viewer-sample\scripts\test-sync-design-assets-publication.mjs'
    $nodePublicationStdout = Join-Path $sandbox 'design-assets-node-publication.stdout.log'
    $nodePublicationStderr = Join-Path $sandbox 'design-assets-node-publication.stderr.log'
    $nodePublicationProcess = Start-Process -FilePath 'node' -ArgumentList @($nodePublicationTestPath) -Wait -PassThru -NoNewWindow `
        -RedirectStandardOutput $nodePublicationStdout -RedirectStandardError $nodePublicationStderr
    $nodePublicationError = if (Test-Path -LiteralPath $nodePublicationStderr) {
        Get-Content -LiteralPath $nodePublicationStderr -Raw
    } else {
        ''
    }
    Assert-Equal 0 $nodePublicationProcess.ExitCode "Node publication rollback fault-injection suite passes. stderr=$nodePublicationError"
    $nodePublicationOutput = Get-Content -LiteralPath $nodePublicationStdout -Raw
    Assert-True ($nodePublicationOutput -match '\[test-sync-design-assets-publication\] passed') 'Node publication rollback suite emits deterministic evidence'

    $realCleanRoot = Join-Path $sandbox 'design-assets-real-git-clean'
    New-Item -ItemType Directory -Path $realCleanRoot -Force | Out-Null
    Invoke-TestDeployGitCommand -Tool 'git' -Arguments @('init', '--quiet') -WorkingDirectory $realCleanRoot | Out-Null
    $realCleanPublic = Join-Path $realCleanRoot 'web-viewer-sample\public'
    $realCleanCanonical = Join-Path $realCleanPublic 'design-assets'
    $realCleanStage = Join-Path $realCleanPublic '.design-assets-stage-0123456789abcdef0123456789abcdef'
    $realCleanBackup = Join-Path $realCleanPublic '.design-assets-backup-0123456789abcdef0123456789abcdef'
    $realCleanLock = Join-Path $realCleanPublic '.design-assets-sync.lock'
    New-Item -ItemType Directory -Path $realCleanCanonical -Force | Out-Null
    New-Item -ItemType Directory -Path $realCleanStage -Force | Out-Null
    New-Item -ItemType Directory -Path $realCleanBackup -Force | Out-Null
    'canonical' | Set-Content -LiteralPath (Join-Path $realCleanCanonical 'canonical.png') -Encoding ascii
    'stage' | Set-Content -LiteralPath (Join-Path $realCleanStage 'stage.png') -Encoding ascii
    'backup' | Set-Content -LiteralPath (Join-Path $realCleanBackup 'backup.png') -Encoding ascii
    'lock' | Set-Content -LiteralPath $realCleanLock -Encoding ascii
    'remove' | Set-Content -LiteralPath (Join-Path $realCleanRoot 'remove-me.txt') -Encoding ascii
    Invoke-TestDeployGitCommand -Tool 'git' -Arguments @(Get-TestDeployGitCleanArguments) -WorkingDirectory $realCleanRoot | Out-Null
    Assert-True (Test-Path -LiteralPath (Join-Path $realCleanCanonical 'canonical.png') -PathType Leaf) 'real git clean preserves canonical design assets'
    Assert-True (Test-Path -LiteralPath (Join-Path $realCleanStage 'stage.png') -PathType Leaf) 'real git clean preserves recovery staging'
    Assert-True (Test-Path -LiteralPath (Join-Path $realCleanBackup 'backup.png') -PathType Leaf) 'real git clean preserves retained backup'
    Assert-True (Test-Path -LiteralPath $realCleanLock -PathType Leaf) 'real git clean preserves the cross-adapter lock'
    Assert-True (-not (Test-Path -LiteralPath (Join-Path $realCleanRoot 'remove-me.txt'))) 'real git clean still removes unrelated untracked files'

    $transactionOriginalFixedPath = $script:TestDeployFixedPath
    $transactionLiveRoot = Join-Path $sandbox 'production-live'
    $transactionStageLeaf = ".$(Split-Path -Leaf $transactionLiveRoot).rebuild-stage-$([Guid]::NewGuid().ToString('N'))"
    $transactionStageRoot = Join-Path (Split-Path -Parent $transactionLiveRoot) $transactionStageLeaf
    $transactionJunctionOutside = Join-Path $sandbox 'production-transaction-junction-outside'
    $transactionJunctionRoot = Join-Path (Split-Path -Parent $transactionLiveRoot) ".$(Split-Path -Leaf $transactionLiveRoot).rebuild-stage-$([Guid]::NewGuid().ToString('N'))"
    $script:TestDeployFixedPath = $transactionLiveRoot
    try {
        New-Item -ItemType Directory -Path (Join-Path $transactionStageRoot 'docs\plans\assets') -Force | Out-Null
        New-Item -ItemType Directory -Path (Join-Path $transactionStageRoot 'docs\plans\uploads') -Force | Out-Null
        New-Item -ItemType Directory -Path (Join-Path $transactionStageRoot 'web-viewer-sample\public') -Force | Out-Null
        New-Item -ItemType Directory -Path (Join-Path $transactionStageRoot '.codex') -Force | Out-Null
        'asset' | Set-Content -LiteralPath (Join-Path $transactionStageRoot 'docs\plans\assets\vp-transaction.png') -Encoding ascii
        'upload' | Set-Content -LiteralPath (Join-Path $transactionStageRoot 'docs\plans\uploads\concept-transaction.png') -Encoding ascii
        'agent instructions' | Set-Content -LiteralPath (Join-Path $transactionStageRoot 'AGENTS.md') -Encoding ascii

        $transactionStage = Initialize-TestDeployDesignAssets `
            -DeploymentPath $transactionStageRoot `
            -TransactionForDeploymentPath $transactionLiveRoot
        Assert-Equal 'synced' $transactionStage.Mode 'production transaction stage accepts the generated GUID sibling'
        $transactionRemoved = @(
            Remove-TestDeployAgentTooling `
                -DeploymentPath $transactionStageRoot `
                -TransactionForDeploymentPath $transactionLiveRoot
        )
        Assert-True ($transactionRemoved.Count -ge 2) 'production transaction stage uses the shared scope to remove tooling'
        Assert-True (-not (Test-Path -LiteralPath (Join-Path $transactionStageRoot 'docs'))) 'production transaction stage removes root docs after asset staging'
        Assert-True (-not (Test-Path -LiteralPath (Join-Path $transactionStageRoot 'AGENTS.md'))) 'production transaction stage removes agent instructions'
        Assert-True (Test-Path -LiteralPath (Join-Path $transactionStageRoot 'web-viewer-sample\public\design-assets\.deployment-manifest.json') -PathType Leaf) 'production transaction stage retains the sealed asset manifest'

        $transactionWrongSibling = Join-Path (Split-Path -Parent $transactionLiveRoot) '.unrelated.rebuild-stage-0123456789abcdef0123456789abcdef'
        Assert-Throws {
            Initialize-TestDeployDesignAssets `
                -DeploymentPath $transactionWrongSibling `
                -TransactionForDeploymentPath $transactionLiveRoot
        } 'production transaction scope rejects an arbitrary sibling'
        $transactionWrongName = Join-Path (Split-Path -Parent $transactionLiveRoot) ".$(Split-Path -Leaf $transactionLiveRoot).rebuild-stage-not-a-guid"
        Assert-Throws {
            Remove-TestDeployAgentTooling `
                -DeploymentPath $transactionWrongName `
                -TransactionForDeploymentPath $transactionLiveRoot
        } 'production transaction scope rejects a malformed stage name'
        Assert-Throws {
            Resolve-TestDeployMutationRoot `
                -Path $transactionStageRoot `
                -AllowNonFixedPathForTests `
                -TransactionForDeploymentPath $transactionLiveRoot
        } 'test escape and production transaction authorization cannot be combined'

        New-Item -ItemType Directory -Path (Join-Path $transactionJunctionOutside 'docs\plans\assets') -Force | Out-Null
        New-Item -ItemType Directory -Path (Join-Path $transactionJunctionOutside 'docs\plans\uploads') -Force | Out-Null
        New-Item -ItemType Directory -Path (Join-Path $transactionJunctionOutside 'web-viewer-sample\public') -Force | Out-Null
        $transactionJunctionSentinel = Join-Path $transactionJunctionOutside 'sentinel.txt'
        'outside transaction sentinel' | Set-Content -LiteralPath $transactionJunctionSentinel -Encoding ascii
        $transactionJunctionHashBefore = (Get-FileHash -LiteralPath $transactionJunctionSentinel -Algorithm SHA256).Hash
        $transactionJunctionInventoryBefore = @(
            Get-ChildItem -LiteralPath $transactionJunctionOutside -Force -Recurse |
                ForEach-Object { $_.FullName.Substring($transactionJunctionOutside.Length) }
        ) -join "`n"
        try {
            New-Item -ItemType Junction -Path $transactionJunctionRoot -Target $transactionJunctionOutside -ErrorAction Stop | Out-Null
            Assert-Throws {
                Initialize-TestDeployDesignAssets `
                    -DeploymentPath $transactionJunctionRoot `
                    -TransactionForDeploymentPath $transactionLiveRoot
            } 'production transaction scope rejects a correctly named junction'
            $transactionJunctionHashAfter = (Get-FileHash -LiteralPath $transactionJunctionSentinel -Algorithm SHA256).Hash
            $transactionJunctionInventoryAfter = @(
                Get-ChildItem -LiteralPath $transactionJunctionOutside -Force -Recurse |
                    ForEach-Object { $_.FullName.Substring($transactionJunctionOutside.Length) }
            ) -join "`n"
            Assert-Equal $transactionJunctionHashBefore $transactionJunctionHashAfter 'production transaction junction rejection preserves outside bytes'
            Assert-Equal $transactionJunctionInventoryBefore $transactionJunctionInventoryAfter 'production transaction junction rejection preserves outside inventory'
        } finally {
            if (Test-Path -LiteralPath $transactionJunctionRoot) {
                & $removeVerifiedAssetJunction -LinkPath $transactionJunctionRoot -ExpectedTarget $transactionJunctionOutside
            }
        }
    } finally {
        $script:TestDeployFixedPath = $transactionOriginalFixedPath
    }

    $calls = New-Object 'System.Collections.Generic.List[string]'
    $runner = {
        param([string] $Tool, [string[]] $Arguments, [string] $WorkingDirectory)
        $script:calls.Add("$Tool $($Arguments -join ' ') @ $WorkingDirectory")
        if ($Arguments -contains 'fetch') {
            return [pscustomobject]@{ ExitCode = 23; Output = 'fetch failed' }
        }
        return [pscustomobject]@{ ExitCode = 0; Output = 'ok' }
    }.GetNewClosure()

    $script:calls = $calls
    $mainRefSpec = '+refs/heads/main:refs/remotes/origin/main'
    $expectedCleanArguments = @(Get-TestDeployGitCleanArguments)
    $expectedCleanCommandText = $expectedCleanArguments -join ' '
    $fetchFailureMessage = $null
    try {
        Invoke-TestDeployGitCommand -Tool 'git' -Arguments @('fetch', 'origin', $mainRefSpec) -WorkingDirectory $cleanupRoot -CommandRunner $runner
    } catch {
        $fetchFailureMessage = $_.Exception.Message
    }
    Assert-True (-not [string]::IsNullOrWhiteSpace($fetchFailureMessage)) 'fetch failure is surfaced as a blocker'
    Assert-True ($fetchFailureMessage -match 'exit code 23') 'fetch failure includes exit code'
    Assert-True ($fetchFailureMessage -match 'fetch failed') 'fetch failure includes command output'
    Assert-True ($calls.Count -gt 0) 'fetch command was attempted'
    Assert-True ($calls[0] -match [regex]::Escape("git fetch origin $mainRefSpec")) 'fetch command updates origin/main ref'

    $commandDiagnosticCanary = 'REVIEW_COMMAND_DIAGNOSTIC_CANARY'
    $commandDiagnosticFailure = $null
    try {
        Invoke-TestDeployGitCommand `
            -Tool 'git' `
            -Arguments @('clone', "file:///C:/repo.git?access_token=$commandDiagnosticCanary", 'C:\tmp\stage') `
            -WorkingDirectory $cleanupRoot `
            -CommandRunner {
                param([string] $Tool, [string[]] $Arguments, [string] $WorkingDirectory)
                return [pscustomobject]@{ ExitCode = 91; Output = 'injected command failure' }
            } | Out-Null
    } catch {
        $commandDiagnosticFailure = $_.Exception.Message
    }
    Assert-True (-not [string]::IsNullOrWhiteSpace($commandDiagnosticFailure)) 'failing command surfaces a diagnostic'
    Assert-True ($commandDiagnosticFailure -match 'git clone failed with exit code 91') 'failing command diagnostic keeps tool, operation, and exit code'
    Assert-True ($commandDiagnosticFailure -match 'injected command failure') 'failing command diagnostic keeps command output'
    Assert-True (-not $commandDiagnosticFailure.Contains($commandDiagnosticCanary)) 'failing command diagnostic redacts later command arguments'

    $okRunner = {
        param([string] $Tool, [string[]] $Arguments, [string] $WorkingDirectory)
        return [pscustomobject]@{ ExitCode = 0; Output = 'ok' }
    }
    $okResult = Invoke-TestDeployGitCommand -Tool 'git' -Arguments @('status', '--short') -WorkingDirectory $cleanupRoot -CommandRunner $okRunner
    Assert-Equal 0 $okResult.ExitCode 'successful command returns exit code'
    Assert-Equal 'ok' $okResult.Output 'successful command returns output'

    $stderrCmd = Join-Path $sandbox 'native-stderr-ok.cmd'
    "@echo off`r`necho native stderr ok 1>&2`r`nexit /b 0`r`n" | Set-Content -LiteralPath $stderrCmd -Encoding ascii
    $stderrResult = Invoke-TestDeployGitCommand -Tool 'cmd.exe' -Arguments @('/c', $stderrCmd) -WorkingDirectory $cleanupRoot
    Assert-Equal 0 $stderrResult.ExitCode 'native stderr command returns exit code zero'
    Assert-True ($stderrResult.Output -match 'native stderr ok') 'native stderr is captured without throwing'

    $argvProbe = Join-Path $sandbox 'native-argv-probe.ps1'
    @'
param([string] $First, [string] $Second, [string] $Third)
[Console]::Out.WriteLine(($First, $Second, $Third -join '|'))
'@ | Set-Content -LiteralPath $argvProbe -Encoding ascii
    $argvExpected = 'D:\Repo Mirrors\AI BIM.git|C:\Stage Root\|quote"inside'
    $argvResult = Invoke-TestDeployGitCommand `
        -Tool 'powershell.exe' `
        -Arguments @('-NoProfile', '-NonInteractive', '-File', $argvProbe, 'D:\Repo Mirrors\AI BIM.git', 'C:\Stage Root\', 'quote"inside') `
        -WorkingDirectory $cleanupRoot
    Assert-Equal $argvExpected $argvResult.Output.Trim() 'native command preserves spaces, trailing backslashes, and embedded quotes as exact argv values'

    $bareOrigin = Join-Path $sandbox 'origin mirror with spaces.git'
    $bareClone = Join-Path $sandbox 'clone target with spaces'
    Invoke-TestDeployGitCommand -Tool 'git' -Arguments @('init', '--bare', $bareOrigin) -WorkingDirectory $cleanupRoot | Out-Null
    Invoke-TestDeployGitCommand -Tool 'git' -Arguments @('clone', '--', $bareOrigin, $bareClone) -WorkingDirectory $cleanupRoot | Out-Null
    Assert-True (Test-Path -LiteralPath (Join-Path $bareClone '.git') -PathType Container) 'native git clone preserves rooted local origin and target paths containing spaces'

    $rebuildRoot = Join-Path $sandbox 'rebuild-root'
    $rebuildDeployRoot = Join-Path $sandbox 'rebuild-deploy'
    New-Item -ItemType Directory -Path $rebuildRoot -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $rebuildDeployRoot '.git') -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $rebuildDeployRoot 'scripts') -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $rebuildDeployRoot 'web-viewer-sample\public') -Force | Out-Null
    'deploy' | Set-Content -LiteralPath (Join-Path $rebuildDeployRoot 'scripts\deploy.ps1') -Encoding ascii

    $rebuildCalls = New-Object 'System.Collections.Generic.List[string]'
    $rebuildRunner = {
        param([string] $Tool, [string[]] $Arguments, [string] $WorkingDirectory)
        $script:rebuildCalls.Add("$Tool $($Arguments -join ' ') @ $WorkingDirectory")
        $commandText = $Arguments -join ' '
        if ($commandText -eq 'remote get-url origin') {
            return [pscustomobject]@{ ExitCode = 0; Output = 'https://example.invalid/AI-BIM-governance.git' }
        }
        if ($commandText -eq 'rev-parse --short HEAD') {
            return [pscustomobject]@{ ExitCode = 0; Output = 'abc1234' }
        }
        if ($commandText -eq 'status --short') {
            return [pscustomobject]@{ ExitCode = 0; Output = '' }
        }
        if ($commandText -eq "fetch origin $mainRefSpec") {
            return [pscustomobject]@{ ExitCode = 23; Output = 'fetch failed' }
        }
        return [pscustomobject]@{ ExitCode = 0; Output = 'ok' }
    }.GetNewClosure()

    $script:rebuildCalls = $rebuildCalls
    $deployWasCalled = $false
    $deployRunner = {
        param([string] $DeployRoot)
        $script:deployWasCalled = $true
        return [pscustomobject]@{ ExitCode = 0 }
    }.GetNewClosure()

    $rebuildMutationSentinel = Join-Path $rebuildDeployRoot 'docs\mutation-sentinel.txt'
    New-Item -ItemType Directory -Path (Split-Path -Parent $rebuildMutationSentinel) -Force | Out-Null
    'must remain byte-identical' | Set-Content -LiteralPath $rebuildMutationSentinel -Encoding ascii
    $rebuildMutationSentinelHash = (Get-FileHash -LiteralPath $rebuildMutationSentinel -Algorithm SHA256).Hash
    $rebuildDesignAssetPublic = Join-Path $rebuildDeployRoot 'web-viewer-sample\public'

    $heldRebuildAssetLock = Enter-DeploymentDesignAssetLock -DestinationParent $rebuildDesignAssetPublic -BoundaryRoot $rebuildDeployRoot
    $heldRebuildFailureMessage = $null
    $rebuildCalls.Clear()
    try {
        try {
            Invoke-TestDeployRebuild -Build -RepoRoot $rebuildRoot -DeploymentPath $rebuildDeployRoot -AllowNonFixedPathForTests -CommandRunner $rebuildRunner -DeployRunner $deployRunner | Out-Null
        } catch {
            $heldRebuildFailureMessage = $_.Exception.Message
        }
    } finally {
        $heldRebuildAssetLock.Dispose()
    }
    Assert-True ($heldRebuildFailureMessage -match 'already running or left a stale lock') 'existing-checkout rebuild rejects a lock held by another official adapter'
    Assert-True (-not (($rebuildCalls -join "`n") -match '\bgit fetch\b|\bgit reset\b|\bgit clean\b')) 'held design-assets lock stops rebuild before fetch/reset/clean'
    Assert-Equal $rebuildMutationSentinelHash (Get-FileHash -LiteralPath $rebuildMutationSentinel -Algorithm SHA256).Hash 'held design-assets lock prevents docs mutation'

    $rebuildBackupResidue = Join-Path $rebuildDesignAssetPublic ".design-assets-backup-$([Guid]::NewGuid().ToString('N'))"
    New-Item -ItemType Directory -Path $rebuildBackupResidue -Force | Out-Null
    'manual recovery data' | Set-Content -LiteralPath (Join-Path $rebuildBackupResidue 'sentinel.txt') -Encoding ascii
    $backupResidueFailureMessage = $null
    $rebuildCalls.Clear()
    try {
        Invoke-TestDeployRebuild -Build -RepoRoot $rebuildRoot -DeploymentPath $rebuildDeployRoot -AllowNonFixedPathForTests -CommandRunner $rebuildRunner -DeployRunner $deployRunner | Out-Null
    } catch {
        $backupResidueFailureMessage = $_.Exception.Message
    }
    Assert-True ($backupResidueFailureMessage -match 'backup residue requires manual inspection') 'existing-checkout rebuild fails closed on retained backup residue'
    Assert-True (-not (($rebuildCalls -join "`n") -match '\bgit fetch\b|\bgit reset\b|\bgit clean\b')) 'backup residue stops rebuild before fetch/reset/clean'
    Assert-True (Test-Path -LiteralPath (Join-Path $rebuildBackupResidue 'sentinel.txt') -PathType Leaf) 'backup residue is preserved for manual recovery'
    Assert-Equal $rebuildMutationSentinelHash (Get-FileHash -LiteralPath $rebuildMutationSentinel -Algorithm SHA256).Hash 'backup residue rejection prevents docs mutation'
    Remove-Item -LiteralPath $rebuildBackupResidue -Recurse -Force

    $rebuildStaleAssetLockPath = Join-Path $rebuildDesignAssetPublic '.design-assets-sync.lock'
    'stale lock sentinel' | Set-Content -LiteralPath $rebuildStaleAssetLockPath -Encoding ascii
    $staleLockFailureMessage = $null
    $rebuildCalls.Clear()
    try {
        Invoke-TestDeployRebuild -Build -RepoRoot $rebuildRoot -DeploymentPath $rebuildDeployRoot -AllowNonFixedPathForTests -CommandRunner $rebuildRunner -DeployRunner $deployRunner | Out-Null
    } catch {
        $staleLockFailureMessage = $_.Exception.Message
    }
    Assert-True ($staleLockFailureMessage -match 'already running or left a stale lock') 'existing-checkout rebuild fails closed on a stale design-assets lock'
    Assert-True (-not (($rebuildCalls -join "`n") -match '\bgit fetch\b|\bgit reset\b|\bgit clean\b')) 'stale design-assets lock stops rebuild before fetch/reset/clean'
    Assert-True (Test-Path -LiteralPath $rebuildStaleAssetLockPath -PathType Leaf) 'stale lock residue is not deleted by rebuild'
    Assert-Equal $rebuildMutationSentinelHash (Get-FileHash -LiteralPath $rebuildMutationSentinel -Algorithm SHA256).Hash 'stale lock rejection prevents docs mutation'
    Remove-Item -LiteralPath $rebuildStaleAssetLockPath -Force

    $rebuildCalls.Clear()
    $rebuildFailureMessage = $null
    try {
        Invoke-TestDeployRebuild -Build -RepoRoot $rebuildRoot -DeploymentPath $rebuildDeployRoot -AllowNonFixedPathForTests -CommandRunner $rebuildRunner -DeployRunner $deployRunner | Out-Null
    } catch {
        $rebuildFailureMessage = $_.Exception.Message
    }
    Assert-True (-not [string]::IsNullOrWhiteSpace($rebuildFailureMessage)) 'rebuild fetch failure is surfaced'
    Assert-True ($rebuildFailureMessage -match 'exit code 23') 'rebuild fetch failure includes exit code'
    Assert-True ($rebuildFailureMessage -match 'fetch failed') 'rebuild fetch failure includes command output'
    Assert-True (($rebuildCalls -join "`n") -match [regex]::Escape("git fetch origin $mainRefSpec")) 'rebuild attempted explicit origin/main ref update'
    Assert-True (-not (($rebuildCalls -join "`n") -match 'git reset --hard origin/main')) 'rebuild stops before reset'
    Assert-True (-not (($rebuildCalls -join "`n") -match 'git clean -fdx')) 'rebuild stops before clean'
    Assert-True (-not $deployWasCalled) 'rebuild stops before deploy'

    $preserveRoot = Join-Path $sandbox 'preserve-root'
    New-Item -ItemType Directory -Path (Join-Path $preserveRoot '.git') -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $preserveRoot 'scripts') -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $preserveRoot 'bim-review-coordinator') -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $preserveRoot 'docs\plans\assets') -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $preserveRoot 'docs\plans\uploads') -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $preserveRoot 'web-viewer-sample\public') -Force | Out-Null
    'deploy' | Set-Content -LiteralPath (Join-Path $preserveRoot 'scripts\deploy.ps1') -Encoding ascii
    'asset' | Set-Content -LiteralPath (Join-Path $preserveRoot 'docs\plans\assets\vp-test.png') -Encoding ascii
    'upload' | Set-Content -LiteralPath (Join-Path $preserveRoot 'docs\plans\uploads\concept-test.png') -Encoding ascii
    'ROOT_REQUIRED=from-current-version' | Set-Content -LiteralPath (Join-Path $preserveRoot '.env.example') -Encoding ascii
    'COORD_REQUIRED=from-current-version' | Set-Content -LiteralPath (Join-Path $preserveRoot 'bim-review-coordinator\.env.example') -Encoding ascii
    'MINIO_WATCH_ENABLED=true' | Set-Content -LiteralPath (Join-Path $preserveRoot '.env.web-plane.host-kit.example') -Encoding ascii
    @(
        'ROOT_REQUIRED=already-filled-root',
        'ROOT_SECRET=keep-root'
    ) | Set-Content -LiteralPath (Join-Path $preserveRoot '.env') -Encoding ascii
    @(
        'COORD_REQUIRED=already-filled-coordinator',
        'INTERNAL_API_AUTH_TOKEN=keep-coordinator'
    ) | Set-Content -LiteralPath (Join-Path $preserveRoot 'bim-review-coordinator\.env') -Encoding ascii
    @(
        'MINIO_WATCH_ENABLED=true',
        'MINIO_WATCH_ENDPOINT=http://192.168.20.234:9000',
        'MINIO_WATCH_BUCKET=bim-control',
        'MINIO_WATCH_ACCESS_KEY=keep-access-key',
        'MINIO_WATCH_SECRET_KEY=keep-secret-key'
    ) | Set-Content -LiteralPath (Join-Path $preserveRoot '.env.web-plane.host-kit') -Encoding ascii

    $preserveCalls = New-Object 'System.Collections.Generic.List[string]'
    $cleanEvents = New-Object 'System.Collections.Generic.List[string]'
    $preserveRunner = {
        param([string] $Tool, [string[]] $Arguments, [string] $WorkingDirectory)
        $script:preserveCalls.Add("$Tool $($Arguments -join ' ') @ $WorkingDirectory")
        $commandText = $Arguments -join ' '
        if ($commandText -eq 'remote get-url origin') {
            return [pscustomobject]@{ ExitCode = 0; Output = 'https://example.invalid/AI-BIM-governance.git' }
        }
        if ($commandText -eq 'rev-parse --short HEAD') {
            return [pscustomobject]@{ ExitCode = 0; Output = 'abc1234' }
        }
        if ($commandText -eq 'status --short') {
            return [pscustomobject]@{ ExitCode = 0; Output = '' }
        }
        if ($commandText -eq $expectedCleanCommandText) {
            Assert-True (Test-Path -LiteralPath (Join-Path $WorkingDirectory 'web-viewer-sample\public\.design-assets-sync.lock') -PathType Leaf) 'existing-checkout clean runs while the design-assets lock is held'
            foreach ($relativePath in @('.env', 'bim-review-coordinator\.env', '.env.web-plane.host-kit')) {
                Remove-Item -LiteralPath (Join-Path $WorkingDirectory $relativePath) -Force -ErrorAction Stop
            }
            $script:cleanEvents.Add('removed env files') | Out-Null
            return [pscustomobject]@{ ExitCode = 0; Output = 'removed env files' }
        }
        if ($commandText -eq 'rev-parse origin/main') {
            return [pscustomobject]@{ ExitCode = 0; Output = 'abcdef123456' }
        }
        return [pscustomobject]@{ ExitCode = 0; Output = 'ok' }
    }.GetNewClosure()

    $script:preserveCalls = $preserveCalls
    $script:cleanEvents = $cleanEvents
    $preserveDeployRunner = {
        param([string] $DeployRoot)
        $rootEnv = Get-Content -LiteralPath (Join-Path $DeployRoot '.env') -Raw
        $coordEnv = Get-Content -LiteralPath (Join-Path $DeployRoot 'bim-review-coordinator\.env') -Raw
        $hostKitEnv = Get-Content -LiteralPath (Join-Path $DeployRoot '.env.web-plane.host-kit') -Raw
        Assert-True ($rootEnv -match 'ROOT_SECRET=keep-root') 'root .env value restored before deploy'
        Assert-True ($coordEnv -match 'INTERNAL_API_AUTH_TOKEN=keep-coordinator') 'coordinator .env value restored before deploy'
        Assert-True ($hostKitEnv -match 'MINIO_WATCH_ACCESS_KEY=keep-access-key') 'MinIO access key restored before deploy'
        Assert-True ($hostKitEnv -match 'MINIO_WATCH_SECRET_KEY=keep-secret-key') 'MinIO secret key restored before deploy'
        Assert-True (-not (Test-Path -LiteralPath (Join-Path $DeployRoot 'docs'))) 'root docs are removed before deploy'
        Assert-True (-not (Test-Path -LiteralPath (Join-Path $DeployRoot 'web-viewer-sample\public\.design-assets-sync.lock'))) 'design-assets lock is released only after staging and docs cleanup'
        Assert-True (Test-Path -LiteralPath (Join-Path $DeployRoot 'web-viewer-sample\public\design-assets\vp-test.png')) 'design asset is prestaged before deploy'
        Assert-True (Test-Path -LiteralPath (Join-Path $DeployRoot 'web-viewer-sample\public\design-assets\concept-test.png')) 'uploaded design asset is prestaged before deploy'
        Assert-True (Test-Path -LiteralPath (Join-Path $DeployRoot 'web-viewer-sample\public\design-assets\.deployment-manifest.json')) 'design asset manifest is prestaged before deploy'
        return [pscustomobject]@{ ExitCode = 0 }
    }.GetNewClosure()

    $preserveResult = Invoke-TestDeployRebuild -Build -RepoRoot $rebuildRoot -DeploymentPath $preserveRoot -AllowNonFixedPathForTests -CommandRunner $preserveRunner -DeployRunner $preserveDeployRunner
    Assert-True ($script:cleanEvents.Count -eq 1) 'mock clean removed env files before restore'
    Assert-Equal 3 $preserveResult.RestoredEnvFileCount 'rebuild restores current-version env files before deploy'
    Assert-True (@($preserveCalls | Where-Object { $_ -match [regex]::Escape($expectedCleanCommandText) }).Count -ge 1) 'git clean excludes Kit logs and all design-assets transaction paths'
    Assert-True (Test-Path -LiteralPath (Join-Path $preserveRoot 'web-viewer-sample\public\design-assets\.deployment-manifest.json')) 'prestaged assets remain available for a direct rebuild'

    $dryRunEdgeRoot = Join-Path $sandbox 'dry-run-edge-runtime-data'
    $dryRunDeployRoot = Join-Path $sandbox 'dry-run-artifact-contract-root'
    New-Item -ItemType Directory -Path (Join-Path $dryRunDeployRoot '.git') -Force | Out-Null
    New-DeployEdgeVolumeHarness -DeployRoot $dryRunDeployRoot -SourceRepoRoot $repoRoot
    @(
        'RUNTIME_STORAGE_ROOT=./storage',
        'MINIO_WATCH_ENABLED=true'
    ) | Set-Content -LiteralPath (Join-Path $dryRunDeployRoot '.env.web-plane.host-kit.example') -Encoding ascii

    $dryRunEdgeRootBackup = [Environment]::GetEnvironmentVariable('EDGE_RUNTIME_DATA_ROOT', 'Process')
    try {
        [Environment]::SetEnvironmentVariable('EDGE_RUNTIME_DATA_ROOT', $dryRunEdgeRoot, 'Process')
        $dryRunProcess = Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', 'scripts\deploy.ps1', '-DryRun', '-SkipDocker', '-SkipGovernance', '-SkipKit', '-PublicHost', '127.0.0.1') -WorkingDirectory $dryRunDeployRoot -NoNewWindow -Wait -PassThru

        Assert-Equal 0 $dryRunProcess.ExitCode 'deploy dry-run exits successfully'
        Assert-True (-not (Test-Path -LiteralPath (Join-Path $dryRunEdgeRoot 'storage'))) 'deploy dry-run does not create external storage root'
        Assert-True (-not (Test-Path -LiteralPath (Join-Path $dryRunEdgeRoot 'artifacts'))) 'deploy dry-run does not create external artifact root'
        Assert-True (-not (Test-Path -LiteralPath (Join-Path $dryRunEdgeRoot 'ledgers'))) 'deploy dry-run does not create external ledger root'
    } finally {
        [Environment]::SetEnvironmentVariable('EDGE_RUNTIME_DATA_ROOT', $dryRunEdgeRootBackup, 'Process')
    }

    $artifactRoot = Join-Path $sandbox 'edge-runtime-data'
    $artifactSentinel = Join-Path $artifactRoot 'ledgers\sentinel.txt'
    New-Item -ItemType Directory -Path (Split-Path -Parent $artifactSentinel) -Force | Out-Null
    'keep-me' | Set-Content -LiteralPath $artifactSentinel -Encoding ascii
    $artifactDeployRoot = Join-Path $sandbox 'artifact-contract-root'
    New-Item -ItemType Directory -Path (Join-Path $artifactDeployRoot '.git') -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $artifactDeployRoot 'web-viewer-sample\public') -Force | Out-Null
    New-DeployEdgeVolumeHarness -DeployRoot $artifactDeployRoot -SourceRepoRoot $repoRoot
    @(
        'RUNTIME_STORAGE_ROOT=./storage',
        'MINIO_WATCH_ENABLED=true'
    ) | Set-Content -LiteralPath (Join-Path $artifactDeployRoot '.env.web-plane.host-kit.example') -Encoding ascii

    $artifactEnvNames = @(
        'EDGE_SITE_ID',
        'EDGE_RUNTIME_DATA_ROOT',
        'RUNTIME_STORAGE_ROOT',
        'STORAGE_HOST_ROOT',
        'STREAMING_CONVERSION_ARTIFACTS_ROOT',
        'CONVERSION_LEDGER_STORE_PATH',
        'ARTIFACT_HEALTH_LEDGER_STORE_PATH'
    )
    $artifactEnvBackup = @{}
    foreach ($name in $artifactEnvNames) {
        $artifactEnvBackup[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
        [Environment]::SetEnvironmentVariable($name, $null, 'Process')
    }

    try {
        [Environment]::SetEnvironmentVariable('EDGE_RUNTIME_DATA_ROOT', $artifactRoot, 'Process')
        [Environment]::SetEnvironmentVariable('RUNTIME_STORAGE_ROOT', (Join-Path $artifactDeployRoot 'storage'), 'Process')
        [Environment]::SetEnvironmentVariable('STORAGE_HOST_ROOT', (Join-Path $artifactDeployRoot 'storage'), 'Process')
        [Environment]::SetEnvironmentVariable('CONVERSION_LEDGER_STORE_PATH', (Join-Path $artifactDeployRoot 'ledgers\conversion-ledger.json'), 'Process')
        [Environment]::SetEnvironmentVariable('ARTIFACT_HEALTH_LEDGER_STORE_PATH', (Join-Path $artifactDeployRoot 'ledgers\artifact-health-ledger.json'), 'Process')
        $capturedVolumePath = Join-Path $sandbox 'captured-conversion-volume.txt'
        [Environment]::SetEnvironmentVariable('TEST_CAPTURE_VOLUME_PATH', $capturedVolumePath, 'Process')

        $artifactRunner = {
            param([string] $Tool, [string[]] $Arguments, [string] $WorkingDirectory)
            $commandText = $Arguments -join ' '
            if ($commandText -eq 'remote get-url origin') {
                return [pscustomobject]@{ ExitCode = 0; Output = 'https://example.invalid/AI-BIM-governance.git' }
            }
            if ($commandText -eq 'rev-parse --short HEAD') {
                return [pscustomobject]@{ ExitCode = 0; Output = 'abc1234' }
            }
            if ($commandText -eq 'status --short') {
                return [pscustomobject]@{ ExitCode = 0; Output = '' }
            }
            if ($commandText -eq 'rev-parse origin/main') {
                return [pscustomobject]@{ ExitCode = 0; Output = 'abcdef123456' }
            }
            return [pscustomobject]@{ ExitCode = 0; Output = 'ok' }
        }.GetNewClosure()

        $artifactDeployRunner = {
            param([string] $DeployRoot)
            Assert-True (Test-Path -LiteralPath (Join-Path $artifactRoot 'storage') -PathType Container) 'rebuild creates external storage root'
            Assert-True (Test-Path -LiteralPath (Join-Path $artifactRoot 'artifacts') -PathType Container) 'rebuild creates external artifact root'
            Assert-True (Test-Path -LiteralPath (Join-Path $artifactRoot 'ledgers') -PathType Container) 'rebuild creates external ledger root'
            Assert-True (Test-Path -LiteralPath $artifactSentinel -PathType Leaf) 'external ledger sentinel survives rebuild helper'
            Assert-True (-not (Test-Path -LiteralPath (Join-Path $DeployRoot 'ledgers\sentinel.txt'))) 'deployment checkout does not absorb external ledger sentinel'
            $deployProcess = Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', 'scripts\deploy.ps1', '-Build', '-SkipDocker', '-SkipGovernance', '-SkipKit', '-PublicHost', '127.0.0.1') -WorkingDirectory $DeployRoot -NoNewWindow -Wait -PassThru
            Assert-Equal 0 $deployProcess.ExitCode 'deploy harness exits successfully'
            Assert-True (Test-Path -LiteralPath (Join-Path $DeployRoot '.env.web-plane.host-kit') -PathType Leaf) 'deploy copies missing host-kit env from example'
            Assert-True (Test-Path -LiteralPath $capturedVolumePath -PathType Leaf) 'conversion harness captures runtime storage root'
            $capturedVolume = (Get-Content -LiteralPath $capturedVolumePath -Raw).Trim()
            Assert-Equal (Join-Path $artifactRoot 'storage') $capturedVolume 'host-native conversion keeps edge runtime storage root after env repair'
            Assert-True ($capturedVolume -ne (Join-Path $DeployRoot 'storage')) 'host-native conversion does not fall back to deploy checkout storage'
            return [pscustomobject]@{ ExitCode = $deployProcess.ExitCode }
        }.GetNewClosure()

        Invoke-TestDeployRebuild -Build -RepoRoot $rebuildRoot -DeploymentPath $artifactDeployRoot -AllowNonFixedPathForTests -CommandRunner $artifactRunner -DeployRunner $artifactDeployRunner | Out-Null
    } finally {
        foreach ($name in $artifactEnvNames) {
            [Environment]::SetEnvironmentVariable($name, $artifactEnvBackup[$name], 'Process')
        }
        [Environment]::SetEnvironmentVariable('TEST_CAPTURE_VOLUME_PATH', $null, 'Process')
    }

    $cleanFailureRoot = Join-Path $sandbox 'clean-failure-root'
    New-Item -ItemType Directory -Path (Join-Path $cleanFailureRoot '.git') -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $cleanFailureRoot 'scripts') -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $cleanFailureRoot 'web-viewer-sample\public') -Force | Out-Null
    'deploy' | Set-Content -LiteralPath (Join-Path $cleanFailureRoot 'scripts\deploy.ps1') -Encoding ascii
    'MINIO_WATCH_ENABLED=true' | Set-Content -LiteralPath (Join-Path $cleanFailureRoot '.env.web-plane.host-kit.example') -Encoding ascii
    @(
        'MINIO_WATCH_ENABLED=true',
        'MINIO_WATCH_ACCESS_KEY=keep-after-failed-clean',
        'MINIO_WATCH_SECRET_KEY=keep-secret-after-failed-clean'
    ) | Set-Content -LiteralPath (Join-Path $cleanFailureRoot '.env.web-plane.host-kit') -Encoding ascii

    $cleanFailureCalls = New-Object 'System.Collections.Generic.List[string]'
    $cleanFailureRunner = {
        param([string] $Tool, [string[]] $Arguments, [string] $WorkingDirectory)
        $script:cleanFailureCalls.Add("$Tool $($Arguments -join ' ') @ $WorkingDirectory")
        $commandText = $Arguments -join ' '
        if ($commandText -eq 'remote get-url origin') {
            return [pscustomobject]@{ ExitCode = 0; Output = 'https://example.invalid/AI-BIM-governance.git' }
        }
        if ($commandText -eq 'rev-parse --short HEAD') {
            return [pscustomobject]@{ ExitCode = 0; Output = 'abc1234' }
        }
        if ($commandText -eq 'status --short') {
            return [pscustomobject]@{ ExitCode = 0; Output = '' }
        }
        if ($commandText -eq $expectedCleanCommandText) {
            Remove-Item -LiteralPath (Join-Path $WorkingDirectory '.env.web-plane.host-kit') -Force -ErrorAction SilentlyContinue
            return [pscustomobject]@{ ExitCode = 42; Output = 'locked governance log' }
        }
        return [pscustomobject]@{ ExitCode = 0; Output = 'ok' }
    }.GetNewClosure()

    $script:cleanFailureCalls = $cleanFailureCalls
    $cleanFailureDeployWasCalled = $false
    $cleanFailureDeployRunner = {
        param([string] $DeployRoot)
        $script:cleanFailureDeployWasCalled = $true
        return [pscustomobject]@{ ExitCode = 0 }
    }.GetNewClosure()

    $cleanFailureMessage = $null
    try {
        Invoke-TestDeployRebuild -Build -RepoRoot $rebuildRoot -DeploymentPath $cleanFailureRoot -AllowNonFixedPathForTests -CommandRunner $cleanFailureRunner -DeployRunner $cleanFailureDeployRunner | Out-Null
    } catch {
        $cleanFailureMessage = $_.Exception.Message
    }
    Assert-True (-not [string]::IsNullOrWhiteSpace($cleanFailureMessage)) 'clean failure is surfaced'
    Assert-True ($cleanFailureMessage -match 'locked governance log') 'clean failure includes command output'
    Assert-True (-not $cleanFailureDeployWasCalled) 'clean failure stops before deploy'
    $restoredHostKitEnv = Get-Content -LiteralPath (Join-Path $cleanFailureRoot '.env.web-plane.host-kit') -Raw
    Assert-True ($restoredHostKitEnv -match 'MINIO_WATCH_ACCESS_KEY=keep-after-failed-clean') 'MinIO access key restored after failed clean'
    Assert-True ($restoredHostKitEnv -match 'MINIO_WATCH_SECRET_KEY=keep-secret-after-failed-clean') 'MinIO secret key restored after failed clean'

    $deployExitRoot = Join-Path $sandbox 'deploy-exit-root'
    New-Item -ItemType Directory -Path (Join-Path $deployExitRoot '.git') -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $deployExitRoot 'scripts') -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $deployExitRoot 'docs\plans\assets') -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $deployExitRoot 'docs\plans\uploads') -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $deployExitRoot 'web-viewer-sample\public') -Force | Out-Null
    'asset' | Set-Content -LiteralPath (Join-Path $deployExitRoot 'docs\plans\assets\vp-test.png') -Encoding ascii
    'upload' | Set-Content -LiteralPath (Join-Path $deployExitRoot 'docs\plans\uploads\concept-test.png') -Encoding ascii
    @'
if (Test-Path -LiteralPath 'docs') {
    exit 8
}
if (-not (Test-Path -LiteralPath 'web-viewer-sample\public\design-assets\.deployment-manifest.json')) {
    exit 9
}
exit 7
'@ | Set-Content -LiteralPath (Join-Path $deployExitRoot 'scripts\deploy.ps1') -Encoding ascii
    $deployExitCalls = New-Object 'System.Collections.Generic.List[string]'
    $deployExitRunner = {
        param([string] $Tool, [string[]] $Arguments, [string] $WorkingDirectory)
        $script:deployExitCalls.Add("$Tool $($Arguments -join ' ') @ $WorkingDirectory")
        $commandText = $Arguments -join ' '
        if ($commandText -eq 'remote get-url origin') {
            return [pscustomobject]@{ ExitCode = 0; Output = 'https://example.invalid/AI-BIM-governance.git' }
        }
        if ($commandText -eq 'rev-parse --short HEAD') {
            return [pscustomobject]@{ ExitCode = 0; Output = 'abc1234' }
        }
        if ($commandText -eq 'status --short') {
            return [pscustomobject]@{ ExitCode = 0; Output = '' }
        }
        if ($commandText -eq 'rev-parse origin/main') {
            return [pscustomobject]@{ ExitCode = 0; Output = 'abcdef123456' }
        }
        return [pscustomobject]@{ ExitCode = 0; Output = 'ok' }
    }.GetNewClosure()
    $script:deployExitCalls = $deployExitCalls

    $deployExitResult = Invoke-TestDeployRebuild -Build -RepoRoot $rebuildRoot -DeploymentPath $deployExitRoot -AllowNonFixedPathForTests -CommandRunner $deployExitRunner
    Assert-Equal 7 $deployExitResult.DeployExitCode 'deploy.ps1 sees prestaged assets after docs cleanup and its exit code is returned without terminating caller'
    Assert-True (Test-Path -LiteralPath (Join-Path $deployExitRoot 'web-viewer-sample\public\design-assets\.deployment-manifest.json')) 'prestaged assets survive a nonzero deploy exit for retry'

    # Batch 1 (a)+(b): pre-clean stop of all three deploy-zone services, each recorded
    # BEFORE the clean event in one shared ordered log (ServiceStopper + CommandRunner
    # write to the same list).
    $stopOrderRoot = Join-Path $sandbox 'stop-order-root'
    New-Item -ItemType Directory -Path (Join-Path $stopOrderRoot '.git') -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $stopOrderRoot 'scripts') -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $stopOrderRoot 'web-viewer-sample\public') -Force | Out-Null
    'deploy' | Set-Content -LiteralPath (Join-Path $stopOrderRoot 'scripts\deploy.ps1') -Encoding ascii

    $stopOrderLog = New-Object 'System.Collections.Generic.List[string]'
    $script:stopOrderLog = $stopOrderLog
    $stopOrderRunner = {
        param([string] $Tool, [string[]] $Arguments, [string] $WorkingDirectory)
        $commandText = $Arguments -join ' '
        if ($commandText -eq $expectedCleanCommandText) { $script:stopOrderLog.Add('clean') | Out-Null }
        if ($commandText -eq 'remote get-url origin') {
            return [pscustomobject]@{ ExitCode = 0; Output = 'https://example.invalid/AI-BIM-governance.git' }
        }
        if ($commandText -eq 'rev-parse --short HEAD') {
            return [pscustomobject]@{ ExitCode = 0; Output = 'abc1234' }
        }
        if ($commandText -eq 'status --short') {
            return [pscustomobject]@{ ExitCode = 0; Output = '' }
        }
        if ($commandText -eq 'rev-parse origin/main') {
            return [pscustomobject]@{ ExitCode = 0; Output = 'abcdef123456' }
        }
        return [pscustomobject]@{ ExitCode = 0; Output = 'ok' }
    }.GetNewClosure()

    $stoppedServices = New-Object 'System.Collections.Generic.List[string]'
    $script:stoppedServices = $stoppedServices
    $stopOrderStopper = {
        param([string] $ServiceName, [string] $ServiceRunDir)
        $script:stopOrderLog.Add("stop:$ServiceName") | Out-Null
        $script:stoppedServices.Add($ServiceName) | Out-Null
    }.GetNewClosure()
    $stopOrderDeployRunner = {
        param([string] $DeployRoot)
        return [pscustomobject]@{ ExitCode = 0 }
    }.GetNewClosure()

    Invoke-TestDeployRebuild -Build -RepoRoot $rebuildRoot -DeploymentPath $stopOrderRoot -AllowNonFixedPathForTests -CommandRunner $stopOrderRunner -DeployRunner $stopOrderDeployRunner -ServiceStopper $stopOrderStopper | Out-Null

    foreach ($svc in @('bim-streaming-server', 'bim-streaming-conversion-service', 'governance-service', 'kit-manager-api')) {
        Assert-True ($stoppedServices -contains $svc) "pre-clean stop invoked for $svc"
    }
    $cleanIndex = $stopOrderLog.IndexOf('clean')
    Assert-True ($cleanIndex -ge 0) 'clean event recorded in shared ordered log'
    foreach ($svc in @('bim-streaming-server', 'bim-streaming-conversion-service', 'governance-service', 'kit-manager-api')) {
        $stopIndex = $stopOrderLog.IndexOf("stop:$svc")
        Assert-True (($stopIndex -ge 0) -and ($stopIndex -lt $cleanIndex)) "stop of $svc precedes clean in shared ordered log"
    }

    # Batch 1 (c): first `git clean -fdx` throws a transient EINVAL, second succeeds ->
    # Invoke-TestDeployRebuild retries, reaches deploy, returns DeployExitCode (no throw).
    $retryRoot = Join-Path $sandbox 'clean-retry-root'
    New-Item -ItemType Directory -Path (Join-Path $retryRoot '.git') -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $retryRoot 'scripts') -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $retryRoot 'web-viewer-sample\public') -Force | Out-Null
    'deploy' | Set-Content -LiteralPath (Join-Path $retryRoot 'scripts\deploy.ps1') -Encoding ascii

    $retryCleanCalls = New-Object 'System.Collections.Generic.List[string]'
    $script:retryCleanCalls = $retryCleanCalls
    $retryRunner = {
        param([string] $Tool, [string[]] $Arguments, [string] $WorkingDirectory)
        $commandText = $Arguments -join ' '
        if ($commandText -eq 'remote get-url origin') {
            return [pscustomobject]@{ ExitCode = 0; Output = 'https://example.invalid/AI-BIM-governance.git' }
        }
        if ($commandText -eq 'rev-parse --short HEAD') {
            return [pscustomobject]@{ ExitCode = 0; Output = 'abc1234' }
        }
        if ($commandText -eq 'status --short') {
            return [pscustomobject]@{ ExitCode = 0; Output = '' }
        }
        if ($commandText -eq $expectedCleanCommandText) {
            $script:retryCleanCalls.Add('clean') | Out-Null
            if ($script:retryCleanCalls.Count -eq 1) {
                return [pscustomobject]@{ ExitCode = 1; Output = "warning: failed to remove 'bim-streaming-server/_build/.../logs/Kit/kit.log': Invalid argument" }
            }
            return [pscustomobject]@{ ExitCode = 0; Output = 'ok' }
        }
        if ($commandText -eq 'rev-parse origin/main') {
            return [pscustomobject]@{ ExitCode = 0; Output = 'abcdef123456' }
        }
        return [pscustomobject]@{ ExitCode = 0; Output = 'ok' }
    }.GetNewClosure()

    $retryDeployCalls = New-Object 'System.Collections.Generic.List[string]'
    $script:retryDeployCalls = $retryDeployCalls
    $retryDeployRunner = {
        param([string] $DeployRoot)
        $script:retryDeployCalls.Add($DeployRoot) | Out-Null
        return [pscustomobject]@{ ExitCode = 0 }
    }.GetNewClosure()
    $noopStopper = {
        param([string] $ServiceName, [string] $ServiceRunDir)
    }.GetNewClosure()

    $retryResult = Invoke-TestDeployRebuild -Build -RepoRoot $rebuildRoot -DeploymentPath $retryRoot -AllowNonFixedPathForTests -CommandRunner $retryRunner -DeployRunner $retryDeployRunner -ServiceStopper $noopStopper
    Assert-Equal 2 $retryCleanCalls.Count 'git clean -fdx retried after transient Invalid argument failure'
    Assert-True ($retryDeployCalls.Count -eq 1) 'rebuild reaches deploy after clean retry succeeds'
    Assert-Equal 0 $retryResult.DeployExitCode 'rebuild returns deploy exit code after clean retry'

    $wrapper = Join-Path $repoRoot 'scripts\dev\rebuild-test-deploy.ps1'
    Assert-True (Test-Path -LiteralPath $wrapper) 'wrapper exists'
    $wrapperText = Get-Content -LiteralPath $wrapper -Raw
    Assert-True ($wrapperText -match '\[switch\]\s+\$Build') 'wrapper exposes Build switch'
    $forbiddenWrapperToken = 'Dry' + 'Run'
    Assert-True ($wrapperText -notmatch [regex]::Escape($forbiddenWrapperToken)) 'wrapper does not expose forbidden token'

    $libText = Get-Content -LiteralPath (Join-Path $repoRoot 'scripts\lib\rebuild-test-deploy.ps1') -Raw
    Assert-True ($libText -notmatch "Start-Process\s+-FilePath 'powershell\.exe'[^\r\n]*-Wait") 'rebuild deploy runner must not wait on deploy.ps1 process tree'
    Assert-True ($libText -notmatch 'Remove-Item[^\r\n]*\$stageRoot[^\r\n]*-Recurse') 'production rebuild never recursively deletes a failed stage'

    $deployHelperRoot = Join-Path $sandbox 'deploy-helper'
    New-Item -ItemType Directory -Path $deployHelperRoot -Force | Out-Null
    $deployHelperProbes = New-Object 'System.Collections.Generic.List[object]'
    $deployHelperRunner = {
        param([string] $FilePath, [string[]] $ArgumentList, [string] $WorkingDirectory, [hashtable] $Environment)
        $deployHelperProbes.Add([pscustomobject]@{
            FilePath = $FilePath
            ArgumentList = @($ArgumentList)
            WorkingDirectory = $WorkingDirectory
        }) | Out-Null
        return 0
    }.GetNewClosure()
    $deployHelperResult = Invoke-TestDeployScript -DeploymentRoot $deployHelperRoot -ProcessRunner $deployHelperRunner
    Assert-Equal 0 $deployHelperResult.ExitCode 'deploy helper returns direct deploy.ps1 exit code'
    Assert-Equal 1 $deployHelperProbes.Count 'deploy helper invokes process runner once'
    $deployHelperProbe = $deployHelperProbes[0]
    Assert-Equal 'powershell.exe' $deployHelperProbe.FilePath 'deploy helper uses Windows PowerShell'
    Assert-Equal $deployHelperRoot $deployHelperProbe.WorkingDirectory 'deploy helper runs inside deployment root'
    Assert-True (($deployHelperProbe.ArgumentList -join ' ') -match 'scripts\\deploy\.ps1') 'deploy helper invokes scripts\deploy.ps1'
    Assert-True ($deployHelperProbe.ArgumentList -contains '-Build') 'deploy helper preserves -Build'

    $realChildDeployRoot = Join-Path $sandbox 'real-child-module-path'
    New-Item -ItemType Directory -Path (Join-Path $realChildDeployRoot 'scripts') -Force | Out-Null
    @'
$hashCommand = Get-Command Get-FileHash -ErrorAction SilentlyContinue
if ($null -eq $hashCommand) {
    exit 42
}
exit 0
'@ | Set-Content -LiteralPath (Join-Path $realChildDeployRoot 'scripts\deploy.ps1') -Encoding ascii

    $contaminatedParentModulePath = 'C:\Program Files\PowerShell\7\Modules;C:\Users\operator\Documents\PowerShell\Modules'
    $originalParentModulePath = [Environment]::GetEnvironmentVariable('PSModulePath', 'Process')
    try {
        [Environment]::SetEnvironmentVariable('PSModulePath', $contaminatedParentModulePath, 'Process')
        $env:PSModulePath = $contaminatedParentModulePath

        $realChildResult = Invoke-TestDeployScript -DeploymentRoot $realChildDeployRoot
        Assert-Equal 0 $realChildResult.ExitCode 'Windows PowerShell child resolves Get-FileHash under a PowerShell 7-first parent module path'
        Assert-Equal $contaminatedParentModulePath ([Environment]::GetEnvironmentVariable('PSModulePath', 'Process')) 'real Windows PowerShell child does not mutate the PowerShell 7-first parent environment'

        $childEnvironmentProbe = New-Object 'System.Collections.Generic.List[object]'
        $childEnvironmentRunner = {
            param(
                [string] $FilePath,
                [string[]] $ArgumentList,
                [string] $WorkingDirectory,
                [hashtable] $Environment
            )
            $childEnvironmentProbe.Add([pscustomobject]@{
                FilePath = $FilePath
                ArgumentList = @($ArgumentList)
                WorkingDirectory = $WorkingDirectory
                Environment = $Environment
            }) | Out-Null
            return 0
        }.GetNewClosure()

        $childEnvironmentResult = Invoke-TestDeployScript -DeploymentRoot $deployHelperRoot -ProcessRunner $childEnvironmentRunner
        Assert-Equal 0 $childEnvironmentResult.ExitCode 'deploy helper preserves its direct process result under a PowerShell 7-first parent'
        Assert-Equal 1 $childEnvironmentProbe.Count 'deploy helper exposes one normalized child environment to the injected process runner'
        $childModulePath = [string]$childEnvironmentProbe[0].Environment['PSModulePath']
        Assert-True (-not [string]::IsNullOrWhiteSpace($childModulePath)) 'deploy helper provides PSModulePath only to its Windows PowerShell child'
        Assert-True ($childModulePath -match '(?i)WindowsPowerShell') 'deploy helper child PSModulePath includes Windows PowerShell module roots'
        Assert-True ($childModulePath -notmatch '(?i)[\\/]PowerShell[\\/]7[\\/]Modules') 'deploy helper child PSModulePath excludes PowerShell 7 module roots'
        Assert-Equal $contaminatedParentModulePath ([Environment]::GetEnvironmentVariable('PSModulePath', 'Process')) 'deploy helper does not mutate the PowerShell 7-first parent environment'
    } finally {
        [Environment]::SetEnvironmentVariable('PSModulePath', $originalParentModulePath, 'Process')
        $env:PSModulePath = $originalParentModulePath
    }

    $nullExitResult = Invoke-TestDeployScript -DeploymentRoot $deployHelperRoot -ProcessRunner {
        param([string] $FilePath, [string[]] $ArgumentList, [string] $WorkingDirectory, [hashtable] $Environment)
        return $null
    }
    Assert-Equal 1 $nullExitResult.ExitCode 'deploy helper treats missing exit code as failure'

    # F2: restore 逐檔獨立、收集失敗、不中途 abort
    $restoreRoot = Join-Path $sandbox 'restore-partial-failure'
    New-Item -ItemType Directory -Path $restoreRoot -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $restoreRoot 'sub') -Force | Out-Null
    # 建立 .example 檔（Restore 需要此檔存在才會嘗試還原）
    'FIRST=placeholder' | Set-Content -LiteralPath (Join-Path $restoreRoot '.env.first.example') -Encoding ascii
    'SECOND=placeholder' | Set-Content -LiteralPath (Join-Path $restoreRoot '.env.second.example') -Encoding ascii
    'THIRD=placeholder' | Set-Content -LiteralPath (Join-Path $restoreRoot 'sub\.env.third.example') -Encoding ascii

    # 建立一個被鎖定（無法寫入）的目標路徑以模擬第一個 entry WriteAllBytes 失敗
    $lockedPath = Join-Path $restoreRoot '.env.first'
    'OLD=content' | Set-Content -LiteralPath $lockedPath -Encoding ascii
    $lockedFile = [System.IO.File]::Open($lockedPath, [System.IO.FileMode]::Open, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
    try {
        $firstBytes = [System.Text.Encoding]::UTF8.GetBytes('FIRST=restored')
        $secondBytes = [System.Text.Encoding]::UTF8.GetBytes('SECOND=restored')
        $thirdBytes = [System.Text.Encoding]::UTF8.GetBytes('THIRD=restored')

        $partialSnapshot = @(
            [pscustomobject]@{ RelativePath = '.env.first';     Bytes = $firstBytes  }
            [pscustomobject]@{ RelativePath = '.env.second';    Bytes = $secondBytes }
            [pscustomobject]@{ RelativePath = 'sub\.env.third'; Bytes = $thirdBytes  }
        )

        $restoreFailureMessage = $null
        try {
            Restore-TestDeployEnvSnapshot -DeploymentPath $restoreRoot -Snapshot $partialSnapshot | Out-Null
        } catch {
            $restoreFailureMessage = $_.Exception.Message
        }

        Assert-True (-not [string]::IsNullOrWhiteSpace($restoreFailureMessage)) 'partial restore: failure is surfaced as a throw'
        Assert-True ($restoreFailureMessage -match '\.env\.first') 'partial restore: error message contains failing entry path'
        Assert-True (Test-Path -LiteralPath (Join-Path $restoreRoot '.env.second')) 'partial restore: second entry is still written despite first failure'
        $secondContent = Get-Content -LiteralPath (Join-Path $restoreRoot '.env.second') -Raw
        Assert-True ($secondContent -match 'SECOND=restored') 'partial restore: second entry content is correct'
        Assert-True (Test-Path -LiteralPath (Join-Path $restoreRoot 'sub\.env.third')) 'partial restore: third entry is still written despite first failure'
        $thirdContent = Get-Content -LiteralPath (Join-Path $restoreRoot 'sub\.env.third') -Raw
        Assert-True ($thirdContent -match 'THIRD=restored') 'partial restore: third entry content is correct'
    } finally {
        $lockedFile.Dispose()
    }

    # Sensitive env paths remain fail-closed even though production treats
    # unrelated Kit-generated reparse entries as opaque live state.
    $envReparseRoot = Join-Path $sandbox 'env-reparse-snapshot'
    $envReparseTarget = Join-Path $sandbox 'env-reparse-target'
    $envReparseLink = Join-Path $envReparseRoot 'bim-review-coordinator'
    $envReparseTargetFile = Join-Path $envReparseTarget '.env'
    New-Item -ItemType Directory -Path $envReparseRoot -Force | Out-Null
    New-Item -ItemType Directory -Path $envReparseTarget -Force | Out-Null
    [System.IO.File]::WriteAllBytes($envReparseTargetFile, [byte[]](83, 69, 67, 82, 69, 84))
    $envReparseHashBefore = (Get-FileHash -LiteralPath $envReparseTargetFile -Algorithm SHA256).Hash
    $envReparseHandle = $null
    try {
        New-Item -ItemType Junction -Path $envReparseLink -Target $envReparseTarget -ErrorAction Stop | Out-Null
        $envReparseHandle = [System.IO.File]::Open(
            $envReparseTargetFile,
            [System.IO.FileMode]::Open,
            [System.IO.FileAccess]::ReadWrite,
            [System.IO.FileShare]::None
        )
        $envReparseFailureMessage = $null
        try {
            Save-TestDeployEnvSnapshot -DeploymentPath $envReparseRoot | Out-Null
        } catch {
            $envReparseFailureMessage = $_.Exception.Message
        }
        Assert-True ($envReparseFailureMessage -match 'deployment path contains reparse point') 'env snapshot rejects a reparse ancestor before reading the env file'

        $envRestoreFailureMessage = $null
        try {
            Restore-TestDeployEnvSnapshot -DeploymentPath $envReparseRoot -Snapshot @(
                [pscustomobject]@{
                    RelativePath = 'bim-review-coordinator\.env'
                    Bytes = [byte[]](67, 72, 65, 78, 71, 69, 68)
                }
            ) | Out-Null
        } catch {
            $envRestoreFailureMessage = $_.Exception.Message
        }
        Assert-True ($envRestoreFailureMessage -match 'deployment path contains reparse point') 'env restore rejects a reparse ancestor before writing the env file'
    } finally {
        if ($null -ne $envReparseHandle) {
            $envReparseHandle.Dispose()
        }
        if (Test-Path -LiteralPath $envReparseLink) {
            & $removeVerifiedAssetJunction -LinkPath $envReparseLink -ExpectedTarget $envReparseTarget
        }
    }
    Assert-Equal $envReparseHashBefore (Get-FileHash -LiteralPath $envReparseTargetFile -Algorithm SHA256).Hash 'env snapshot reparse rejection preserves target bytes'

    # Task 1A RED: transactional checkout preparation must never mutate the live
    # deployment until a complete standalone stage has passed provenance and
    # deploy-script validation.  These fixtures use real bytes/hashes; only Git,
    # service-stop, and deploy process boundaries are injected.
    $transactionOriginUrl = 'https://example.invalid/AI-BIM-governance.git'
    $transactionOriginCommit = 'fedcba9876543210fedcba9876543210fedcba98'
    $transactionFixturePaths = @(
        'live-sentinel.bin',
        '.env',
        'bim-review-coordinator\.env',
        '.env.web-plane.host-kit'
    )
    $transactionProvenanceMarker = '.task-1a-stage-provenance.txt'
    $transactionPathTrimChars = [char[]]@(
        [System.IO.Path]::DirectorySeparatorChar,
        [System.IO.Path]::AltDirectorySeparatorChar
    )
    $newTransactionFixture = {
        param([Parameter(Mandatory = $true)][string] $Root)

        New-Item -ItemType Directory -Path (Join-Path $Root 'scripts') -Force | Out-Null
        New-Item -ItemType Directory -Path (Join-Path $Root 'bim-review-coordinator') -Force | Out-Null
        [System.IO.File]::WriteAllBytes(
            (Join-Path $Root 'live-sentinel.bin'),
            [byte[]](0, 1, 2, 13, 10, 127, 128, 254, 255)
        )
        # Keep the script source ASCII-safe for Windows PowerShell 5.1 runners,
        # while still exercising UTF-8 preservation in the fixture payload.
        $unicodeFixtureValue = -join ([char[]]@(0x4EA4, 0x6613, 0x5F0F))
        [System.IO.File]::WriteAllBytes(
            (Join-Path $Root '.env'),
            [System.Text.Encoding]::UTF8.GetBytes("ROOT_TOKEN=fixture-root`r`nUNICODE=$unicodeFixtureValue`r`n")
        )
        [System.IO.File]::WriteAllBytes(
            (Join-Path $Root 'bim-review-coordinator\.env'),
            [System.Text.Encoding]::UTF8.GetBytes("INTERNAL_API_AUTH_TOKEN=fixture-coordinator`n")
        )
        [System.IO.File]::WriteAllBytes(
            (Join-Path $Root '.env.web-plane.host-kit'),
            [System.Text.Encoding]::UTF8.GetBytes("MINIO_WATCH_ACCESS_KEY=fixture-access`r`nMINIO_WATCH_SECRET_KEY=fixture-secret`r`n")
        )

        # The legacy restore helper currently requires examples.  Keeping them in
        # the real fixture ensures a RED result cannot be blamed on fixture setup.
        [System.IO.File]::WriteAllBytes((Join-Path $Root '.env.example'), [byte[]](35, 10))
        [System.IO.File]::WriteAllBytes((Join-Path $Root 'bim-review-coordinator\.env.example'), [byte[]](35, 10))
        [System.IO.File]::WriteAllBytes((Join-Path $Root '.env.web-plane.host-kit.example'), [byte[]](35, 10))
        [System.IO.File]::WriteAllBytes(
            (Join-Path $Root 'scripts\deploy.ps1'),
            [System.Text.Encoding]::ASCII.GetBytes("exit 0`r`n")
        )
    }
    $getTransactionHashes = {
        param([Parameter(Mandatory = $true)][string] $Root)

        $hashes = [ordered]@{}
        foreach ($relativePath in $transactionFixturePaths) {
            $path = Join-Path $Root $relativePath
            $hashes[$relativePath] = if (Test-Path -LiteralPath $path -PathType Leaf) {
                (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash
            } else {
                '<missing>'
            }
        }
        return $hashes
    }.GetNewClosure()
    $getTransactionBytesHash = {
        param([Parameter(Mandatory = $true)][byte[]] $Bytes)

        $sha256 = [System.Security.Cryptography.SHA256]::Create()
        try {
            return ([System.BitConverter]::ToString($sha256.ComputeHash($Bytes))).Replace('-', '')
        } finally {
            $sha256.Dispose()
        }
    }
    $getTransactionLiveManifest = {
        param([Parameter(Mandatory = $true)][string] $Root)

        $canonicalRoot = ([System.IO.Path]::GetFullPath($Root)).TrimEnd($transactionPathTrimChars)
        $entries = New-Object 'System.Collections.Generic.List[string]'
        if (-not (Test-Path -LiteralPath $canonicalRoot -PathType Container)) {
            $entries.Add('__root__|missing|-|-') | Out-Null
        } else {
            $gitPath = Join-Path $canonicalRoot '.git'
            if (-not (Test-Path -LiteralPath $gitPath)) {
                $entries.Add('.git|missing|-|absent') | Out-Null
            }

            foreach ($item in @(Get-ChildItem -LiteralPath $canonicalRoot -Force -Recurse | Sort-Object FullName)) {
                $relativePath = $item.FullName.Substring($canonicalRoot.Length).TrimStart($transactionPathTrimChars)
                $entryType = if ($item.PSIsContainer) { 'directory' } else { 'file' }
                $hash = if ($item.PSIsContainer) { '-' } else { (Get-FileHash -LiteralPath $item.FullName -Algorithm SHA256).Hash }
                $marker = '-'
                if ($relativePath -ieq '.git') {
                    $marker = if ($item.PSIsContainer) {
                        'standalone-directory'
                    } else {
                        ([System.IO.File]::ReadAllText($item.FullName)).Trim().Replace("`r", '').Replace("`n", '')
                    }
                } elseif ($relativePath -ieq $transactionProvenanceMarker -and -not $item.PSIsContainer) {
                    $marker = ([System.IO.File]::ReadAllText($item.FullName)).Trim().Replace("`r", ';').Replace("`n", ';')
                }
                $entries.Add("$relativePath|$entryType|$hash|$marker") | Out-Null
            }
        }

        $serialized = @($entries.ToArray()) -join "`n"
        $serializedBytes = [System.Text.Encoding]::UTF8.GetBytes($serialized)
        return [pscustomobject]@{
            Entries = @($entries.ToArray())
            Serialized = $serialized
            Sha256 = (& $getTransactionBytesHash -Bytes $serializedBytes)
        }
    }.GetNewClosure()
    $assertTransactionManifestCoverage = {
        param(
            [Parameter(Mandatory = $true)] $Manifest,
            [Parameter(Mandatory = $true)][string] $ExpectedGitType
        )

        foreach ($relativePath in @($transactionFixturePaths + 'scripts\deploy.ps1')) {
            $prefix = "$relativePath|file|"
            $found = @($Manifest.Entries | Where-Object { $_.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase) }).Count -eq 1
            Assert-True $found "Task 1A manifest precondition includes file metadata for $relativePath"
        }
        $gitPrefix = ".git|$ExpectedGitType|"
        $gitFound = @($Manifest.Entries | Where-Object { $_.StartsWith($gitPrefix, [System.StringComparison]::OrdinalIgnoreCase) }).Count -eq 1
        Assert-True $gitFound "Task 1A manifest precondition includes .git type/marker as $ExpectedGitType"
    }.GetNewClosure()
    $resolveTransactionCloneInvocation = {
        param(
            [Parameter(Mandatory = $true)][string[]] $Arguments,
            [Parameter(Mandatory = $true)][string] $ExpectedOrigin
        )

        $cloneIndex = -1
        for ($i = 0; $i -lt $Arguments.Count; $i++) {
            if ($Arguments[$i] -eq 'clone') {
                $cloneIndex = $i
                break
            }
        }
        if ($cloneIndex -lt 0) {
            throw "prepared-stage fake expected git clone, got '$($Arguments -join ' ')'"
        }
        if ($cloneIndex + 1 -ge $Arguments.Count -or $Arguments[$cloneIndex + 1] -ne '--') {
            throw "prepared-stage fake expected git clone option terminator before origin, got '$($Arguments -join ' ')'"
        }

        $originIndex = -1
        for ($i = $cloneIndex + 1; $i -lt $Arguments.Count; $i++) {
            if ($Arguments[$i] -eq $ExpectedOrigin) {
                $originIndex = $i
                break
            }
        }
        if ($originIndex -lt 0 -or $originIndex + 1 -ge $Arguments.Count) {
            throw 'prepared-stage fake could not resolve clone origin and destination'
        }

        return [pscustomobject]@{
            Origin = [string]$Arguments[$originIndex]
            Target = [System.IO.Path]::GetFullPath([string]$Arguments[$originIndex + 1])
        }
    }
    $newPreparedTransactionStage = {
        param(
            [Parameter(Mandatory = $true)][string] $Target,
            [Parameter(Mandatory = $true)][string] $ScenarioRoot,
            [Parameter(Mandatory = $true)][string] $LiveRoot,
            [Parameter(Mandatory = $true)][string] $MarkerContent,
            [Parameter(Mandatory = $true)][bool] $IncludeDeployScript
        )

        # Fail closed before the first New-Item/WriteAllBytes.  The fake must never
        # make an unsafe production implementation less destructive by writing its
        # prepared checkout directly into live or below live.
        $canonicalTarget = ([System.IO.Path]::GetFullPath($Target)).TrimEnd($transactionPathTrimChars)
        $canonicalScenario = ([System.IO.Path]::GetFullPath($ScenarioRoot)).TrimEnd($transactionPathTrimChars)
        $canonicalLive = ([System.IO.Path]::GetFullPath($LiveRoot)).TrimEnd($transactionPathTrimChars)
        $scenarioPrefix = "$canonicalScenario$([System.IO.Path]::DirectorySeparatorChar)"
        $livePrefix = "$canonicalLive$([System.IO.Path]::DirectorySeparatorChar)"
        $targetInsideScenario = $canonicalTarget.StartsWith($scenarioPrefix, [System.StringComparison]::OrdinalIgnoreCase)
        $targetIsLive = $canonicalTarget.Equals($canonicalLive, [System.StringComparison]::OrdinalIgnoreCase)
        $targetInsideLive = $canonicalTarget.StartsWith($livePrefix, [System.StringComparison]::OrdinalIgnoreCase)
        if (-not $targetInsideScenario -or $targetIsLive -or $targetInsideLive) {
            throw "prepared-stage fake rejected unsafe target before filesystem write: target='$canonicalTarget' scenario='$canonicalScenario' live='$canonicalLive'"
        }

        New-Item -ItemType Directory -Path (Join-Path $canonicalTarget '.git') -Force | Out-Null
        New-Item -ItemType Directory -Path (Join-Path $canonicalTarget 'scripts') -Force | Out-Null
        New-Item -ItemType Directory -Path (Join-Path $canonicalTarget 'bim-review-coordinator') -Force | Out-Null
        $markerBytes = [System.Text.Encoding]::UTF8.GetBytes($MarkerContent)
        [System.IO.File]::WriteAllBytes((Join-Path $canonicalTarget $transactionProvenanceMarker), $markerBytes)
        if ($IncludeDeployScript) {
            [System.IO.File]::WriteAllBytes((Join-Path $canonicalTarget 'scripts\deploy.ps1'), [System.Text.Encoding]::ASCII.GetBytes("exit 0`r`n"))
        }

        return [pscustomobject]@{
            Root = $canonicalTarget
            MarkerHash = (& $getTransactionBytesHash -Bytes $markerBytes)
        }
    }.GetNewClosure()

    # Prove the prepared-stage fake itself fails closed with zero filesystem
    # mutation for each forbidden target class before it is used by RED cases.
    $preparedStageGuardScenario = Join-Path $sandbox 'transaction-prepared-stage-guard'
    $preparedStageGuardLive = Join-Path $preparedStageGuardScenario 'live'
    & $newTransactionFixture $preparedStageGuardLive
    $preparedStageGuardManifest = & $getTransactionLiveManifest $preparedStageGuardLive
    & $assertTransactionManifestCoverage -Manifest $preparedStageGuardManifest -ExpectedGitType 'missing'
    $preparedStageGuardCandidates = @(
        $preparedStageGuardLive,
        (Join-Path $preparedStageGuardLive 'unsafe-child-stage'),
        (Join-Path $sandbox 'transaction-prepared-stage-outside')
    )
    foreach ($unsafeTarget in $preparedStageGuardCandidates) {
        $guardFailure = $null
        try {
            & $newPreparedTransactionStage -Target $unsafeTarget -ScenarioRoot $preparedStageGuardScenario -LiveRoot $preparedStageGuardLive -MarkerContent 'guard-must-never-be-written' -IncludeDeployScript $false | Out-Null
        } catch {
            $guardFailure = $_.Exception.Message
        }
        Assert-True ($guardFailure -match 'rejected unsafe target before filesystem write') "prepared-stage fake rejects unsafe target before write: $unsafeTarget"
        $guardManifestAfter = & $getTransactionLiveManifest $preparedStageGuardLive
        Assert-Equal $preparedStageGuardManifest.Serialized $guardManifestAfter.Serialized "prepared-stage fake rejection leaves live manifest unchanged: $unsafeTarget"
        if (-not ([System.IO.Path]::GetFullPath($unsafeTarget)).Equals(([System.IO.Path]::GetFullPath($preparedStageGuardLive)), [System.StringComparison]::OrdinalIgnoreCase)) {
            Assert-True (-not (Test-Path -LiteralPath $unsafeTarget)) "prepared-stage fake creates no rejected target: $unsafeTarget"
        }
    }
    $transactionRedFailures = New-Object 'System.Collections.Generic.List[string]'
    $recordTransactionExpectation = {
        param(
            [Parameter(Mandatory = $true)][bool] $Condition,
            [Parameter(Mandatory = $true)][string] $Behavior,
            [Parameter(Mandatory = $true)][string] $Details
        )

        if (-not $Condition) {
            $transactionRedFailures.Add("$Behavior -- $Details") | Out-Null
        }
    }.GetNewClosure()

    $recordRetainedStageWithoutEnv = {
        param(
            [Parameter(Mandatory = $true)][string] $StageRoot,
            [Parameter(Mandatory = $true)][string] $Behavior
        )

        foreach ($relativePath in $script:TestDeployPreservedEnvFiles) {
            $stageEnvPath = Join-Path $StageRoot $relativePath
            & $recordTransactionExpectation (
                -not (Test-Path -LiteralPath $stageEnvPath)
            ) "$Behavior retains no preserved env files" "path='$relativePath'"
        }
    }.GetNewClosure()

    # Task 1A.0: an origin URL carrying inline credentials must be rejected
    # before stage allocation. The canary proves neither the thrown diagnostic
    # nor a retained .git/config can persist the credential.
    $credentialScenarioRoot = Join-Path $sandbox 'transaction-credential-origin'
    $credentialLiveRoot = Join-Path $credentialScenarioRoot 'live'
    & $newTransactionFixture $credentialLiveRoot
    $credentialManifestBefore = & $getTransactionLiveManifest $credentialLiveRoot
    $credentialCanary = 'DO_NOT_LOG_OR_PERSIST_CANARY_7f06d4a9'
    $credentialOriginUrl = "https://oauth2:$credentialCanary@example.invalid/AI-BIM-governance.git"
    $credentialCloneTargets = New-Object 'System.Collections.Generic.List[string]'
    $script:credentialCloneTargets = $credentialCloneTargets
    $credentialRunner = {
        param([string] $Tool, [string[]] $Arguments, [string] $WorkingDirectory)
        $commandText = $Arguments -join ' '
        if ($commandText -eq 'remote get-url origin') {
            return [pscustomobject]@{ ExitCode = 0; Output = $credentialOriginUrl }
        }
        if ($Arguments -contains 'clone') {
            $cloneInvocation = & $resolveTransactionCloneInvocation -Arguments $Arguments -ExpectedOrigin $credentialOriginUrl
            $script:credentialCloneTargets.Add($cloneInvocation.Target) | Out-Null
            New-Item -ItemType Directory -Path (Join-Path $cloneInvocation.Target '.git') -Force | Out-Null
            [System.IO.File]::WriteAllText(
                (Join-Path $cloneInvocation.Target '.git\config'),
                "[remote `"origin`"]`nurl = $credentialOriginUrl`n",
                [System.Text.Encoding]::UTF8
            )
            return [pscustomobject]@{ ExitCode = 94; Output = 'injected credential-bearing clone failure' }
        }
        return [pscustomobject]@{ ExitCode = 0; Output = 'ok' }
    }.GetNewClosure()
    $credentialFailureMessage = $null
    try {
        Invoke-TestDeployRebuild `
            -Build `
            -RepoRoot $rebuildRoot `
            -DeploymentPath $credentialLiveRoot `
            -AllowNonFixedPathForTests `
            -CommandRunner $credentialRunner `
            -DeployRunner { param([string] $DeployRoot); [pscustomobject]@{ ExitCode = 0 } } `
            -ServiceStopper { param([string] $ServiceName, [string] $ServiceRunDir) } | Out-Null
    } catch {
        $credentialFailureMessage = $_.Exception.Message
    }
    $credentialManifestAfter = & $getTransactionLiveManifest $credentialLiveRoot
    $credentialFailureHasCanary = -not [string]::IsNullOrWhiteSpace($credentialFailureMessage) -and
        $credentialFailureMessage.Contains($credentialCanary)
    $credentialResidue = @(
        Get-ChildItem -LiteralPath $credentialScenarioRoot -Directory -Force |
            Where-Object { $_.Name -like '.live.rebuild-stage-*' -or $_.Name -like '.live.rebuild-previous-*' }
    )
    & $recordTransactionExpectation (
        -not [string]::IsNullOrWhiteSpace($credentialFailureMessage) -and
        $credentialFailureMessage -match 'credential-bearing origin URL is not allowed'
    ) 'Task 1A.0 credential-bearing origin is rejected before clone' "cloneCalls=$($credentialCloneTargets.Count)"
    & $recordTransactionExpectation (-not $credentialFailureHasCanary) 'Task 1A.0 credential canary is absent from thrown diagnostics' "canaryExposed=$credentialFailureHasCanary"
    & $recordTransactionExpectation ($credentialCloneTargets.Count -eq 0 -and $credentialResidue.Count -eq 0) 'Task 1A.0 credential-bearing origin creates no stage or previous checkout' "cloneCalls=$($credentialCloneTargets.Count) residue=$($credentialResidue.Count)"
    & $recordTransactionExpectation ($credentialManifestAfter.Serialized -ceq $credentialManifestBefore.Serialized) 'Task 1A.0 credential rejection leaves live checkout byte-identical' "before='$($credentialManifestBefore.Sha256)' after='$($credentialManifestAfter.Sha256)'"
    foreach ($safeOriginUrl in @(
        'https://github.com/monkey1sai/AI-BIM-governance.git',
        'git@github.com:monkey1sai/AI-BIM-governance.git',
        'ssh://git@github.com/monkey1sai/AI-BIM-governance.git',
        'file:///C:/Repos/AI-BIM-governance.git',
        'D:\Repos\AI-BIM-governance.git',
        '\\localhost\repo-mirror\AI-BIM-governance.git',
        '.\repo-mirror\AI-BIM-governance.git'
    )) {
        $safeOriginFailure = $null
        try {
            Assert-TestDeployOriginUrlSafe -OriginUrl $safeOriginUrl | Out-Null
        } catch {
            $safeOriginFailure = $_.Exception.Message
        }
        & $recordTransactionExpectation ([string]::IsNullOrWhiteSpace($safeOriginFailure)) 'Task 1A.0 credential guard accepts credential-manager and SSH-agent origins' "failure='$safeOriginFailure'"
    }
    $optionShapedOriginFailure = $null
    try {
        Assert-TestDeployOriginUrlSafe -OriginUrl '--config=core.hooksPath=C:\unsafe-hooks' | Out-Null
    } catch {
        $optionShapedOriginFailure = $_.Exception.Message
    }
    & $recordTransactionExpectation (
        $optionShapedOriginFailure -match 'origin URL is invalid'
    ) 'Task 1A.0 origin guard rejects option-shaped relative origins before git clone' "failure='$optionShapedOriginFailure'"
    foreach ($unsafeOriginCase in @(
        [pscustomobject]@{
            Url = "https://oauth2:$credentialCanary@example.invalid/repo.git"
            Canary = $credentialCanary
        },
        [pscustomobject]@{
            Url = "https://example.invalid/repo.git?access_token=$credentialCanary"
            Canary = $credentialCanary
        },
        [pscustomobject]@{
            Url = "ssh://git:$credentialCanary@example.invalid/repo.git"
            Canary = $credentialCanary
        },
        [pscustomobject]@{
            Url = "ssh://git%3A$credentialCanary@example.invalid/repo.git"
            Canary = $credentialCanary
        },
        [pscustomobject]@{
            Url = "git@example.invalid:repo.git?access_token=$credentialCanary"
            Canary = $credentialCanary
        },
        [pscustomobject]@{
            Url = "git@example.invalid:repo.git#$credentialCanary"
            Canary = $credentialCanary
        },
        [pscustomobject]@{
            Url = "file:///C:/repo.git?access_token=$credentialCanary"
            Canary = $credentialCanary
        },
        [pscustomobject]@{
            Url = "file:///C:/repo.git#$credentialCanary"
            Canary = $credentialCanary
        },
        [pscustomobject]@{
            Url = "D:\Repos\repo.git?access_token=$credentialCanary"
            Canary = $credentialCanary
        },
        [pscustomobject]@{
            Url = "D:\Repos\repo.git#$credentialCanary"
            Canary = $credentialCanary
        },
        [pscustomobject]@{
            Url = "repo.git?access_token=$credentialCanary"
            Canary = $credentialCanary
        },
        [pscustomobject]@{
            Url = "repo.git#$credentialCanary"
            Canary = $credentialCanary
        }
    )) {
        $unsafeOriginFailure = $null
        try {
            Assert-TestDeployOriginUrlSafe -OriginUrl ([string]$unsafeOriginCase.Url) | Out-Null
        } catch {
            $unsafeOriginFailure = $_.Exception.Message
        }
        $unsafeOriginCanaryExposed = -not [string]::IsNullOrWhiteSpace($unsafeOriginFailure) -and
            $unsafeOriginFailure.Contains([string]$unsafeOriginCase.Canary)
        & $recordTransactionExpectation (
            -not [string]::IsNullOrWhiteSpace($unsafeOriginFailure) -and
            $unsafeOriginFailure -match 'credential-bearing origin URL is not allowed' -and
            -not $unsafeOriginCanaryExposed
        ) 'Task 1A.0 credential guard rejects inline and query credentials without echoing canaries' "canaryExposed=$unsafeOriginCanaryExposed"
    }
    $credentialBypassCases = @(
        [pscustomobject]@{
            Name = 'encoded-ssh-password'
            Url = "ssh://git%3A$credentialCanary@example.invalid/repo.git"
        },
        [pscustomobject]@{
            Name = 'scp-query'
            Url = "git@example.invalid:repo.git?access_token=$credentialCanary"
        },
        [pscustomobject]@{
            Name = 'scp-fragment'
            Url = "git@example.invalid:repo.git#$credentialCanary"
        },
        [pscustomobject]@{
            Name = 'file-query'
            Url = "file:///C:/repo.git?access_token=$credentialCanary"
        },
        [pscustomobject]@{
            Name = 'file-fragment'
            Url = "file:///C:/repo.git#$credentialCanary"
        },
        [pscustomobject]@{
            Name = 'local-path-query'
            Url = "D:\Repos\repo.git?access_token=$credentialCanary"
        },
        [pscustomobject]@{
            Name = 'local-path-fragment'
            Url = "D:\Repos\repo.git#$credentialCanary"
        },
        [pscustomobject]@{
            Name = 'relative-path-query'
            Url = "repo.git?access_token=$credentialCanary"
        },
        [pscustomobject]@{
            Name = 'relative-path-fragment'
            Url = "repo.git#$credentialCanary"
        }
    )
    foreach ($credentialBypassCase in $credentialBypassCases) {
        $bypassScenarioRoot = Join-Path $sandbox "transaction-credential-$($credentialBypassCase.Name)"
        $bypassLiveRoot = Join-Path $bypassScenarioRoot 'live'
        & $newTransactionFixture $bypassLiveRoot
        $bypassManifestBefore = & $getTransactionLiveManifest $bypassLiveRoot
        $bypassOriginUrl = [string]$credentialBypassCase.Url
        $bypassCloneTargets = New-Object 'System.Collections.Generic.List[string]'
        $bypassRunner = {
            param([string] $Tool, [string[]] $Arguments, [string] $WorkingDirectory)
            $commandText = $Arguments -join ' '
            if ($commandText -eq 'remote get-url origin') {
                return [pscustomobject]@{ ExitCode = 0; Output = $bypassOriginUrl }
            }
            if ($Arguments -contains 'clone') {
                $cloneTarget = [System.IO.Path]::GetFullPath([string]$Arguments[-1])
                $bypassCloneTargets.Add($cloneTarget) | Out-Null
                New-Item -ItemType Directory -Path (Join-Path $cloneTarget '.git') -Force | Out-Null
                [System.IO.File]::WriteAllText(
                    (Join-Path $cloneTarget '.git\config'),
                    "[remote `"origin`"]`nurl = $bypassOriginUrl`n",
                    [System.Text.Encoding]::UTF8
                )
                return [pscustomobject]@{ ExitCode = 95; Output = 'injected bypass clone failure' }
            }
            return [pscustomobject]@{ ExitCode = 0; Output = 'ok' }
        }.GetNewClosure()
        $bypassFailureMessage = $null
        try {
            Invoke-TestDeployRebuild `
                -Build `
                -RepoRoot $rebuildRoot `
                -DeploymentPath $bypassLiveRoot `
                -AllowNonFixedPathForTests `
                -CommandRunner $bypassRunner `
                -DeployRunner { param([string] $DeployRoot); [pscustomobject]@{ ExitCode = 0 } } `
                -ServiceStopper { param([string] $ServiceName, [string] $ServiceRunDir) } | Out-Null
        } catch {
            $bypassFailureMessage = $_.Exception.Message
        }
        $bypassManifestAfter = & $getTransactionLiveManifest $bypassLiveRoot
        $bypassFailureHasCanary = -not [string]::IsNullOrWhiteSpace($bypassFailureMessage) -and
            $bypassFailureMessage.Contains($credentialCanary)
        $bypassResidue = @(
            Get-ChildItem -LiteralPath $bypassScenarioRoot -Directory -Force |
                Where-Object { $_.Name -like '.live.rebuild-stage-*' -or $_.Name -like '.live.rebuild-previous-*' }
        )
        & $recordTransactionExpectation (
            -not [string]::IsNullOrWhiteSpace($bypassFailureMessage) -and
            $bypassFailureMessage -match 'credential-bearing origin URL is not allowed' -and
            -not $bypassFailureHasCanary
        ) "Task 1A.0 $($credentialBypassCase.Name) is rejected without echoing its canary" "canaryExposed=$bypassFailureHasCanary"
        & $recordTransactionExpectation (
            $bypassCloneTargets.Count -eq 0 -and
            $bypassResidue.Count -eq 0
        ) "Task 1A.0 $($credentialBypassCase.Name) creates no clone or transaction residue" "cloneCalls=$($bypassCloneTargets.Count) residue=$($bypassResidue.Count)"
        & $recordTransactionExpectation (
            $bypassManifestAfter.Serialized -ceq $bypassManifestBefore.Serialized
        ) "Task 1A.0 $($credentialBypassCase.Name) leaves live checkout byte-identical" "before='$($bypassManifestBefore.Sha256)' after='$($bypassManifestAfter.Sha256)'"
    }

    # Task 1A.1: non-git live bytes survive a failed sibling-stage clone; no
    # service stop, live cutover, or deploy is allowed to begin.
    $nonGitScenarioRoot = Join-Path $sandbox 'transaction-non-git'
    $nonGitLiveRoot = Join-Path $nonGitScenarioRoot 'live'
    & $newTransactionFixture $nonGitLiveRoot
    $nonGitHashesBefore = & $getTransactionHashes $nonGitLiveRoot
    $nonGitManifestBefore = & $getTransactionLiveManifest $nonGitLiveRoot
    & $assertTransactionManifestCoverage -Manifest $nonGitManifestBefore -ExpectedGitType 'missing'
    $nonGitCloneTargets = New-Object 'System.Collections.Generic.List[string]'
    $nonGitStoppedServices = New-Object 'System.Collections.Generic.List[string]'
    $nonGitDeployCalls = New-Object 'System.Collections.Generic.List[string]'
    $script:nonGitCloneTargets = $nonGitCloneTargets
    $script:nonGitStoppedServices = $nonGitStoppedServices
    $script:nonGitDeployCalls = $nonGitDeployCalls
    $nonGitRunner = {
        param([string] $Tool, [string[]] $Arguments, [string] $WorkingDirectory)
        $commandText = $Arguments -join ' '
        if ($commandText -eq 'remote get-url origin') {
            return [pscustomobject]@{ ExitCode = 0; Output = $transactionOriginUrl }
        }
        if ($Arguments -contains 'clone') {
            $cloneInvocation = & $resolveTransactionCloneInvocation -Arguments $Arguments -ExpectedOrigin $transactionOriginUrl
            $script:nonGitCloneTargets.Add($cloneInvocation.Target) | Out-Null
            New-Item -ItemType Directory -Path $cloneInvocation.Target -Force | Out-Null
            [System.IO.File]::WriteAllBytes(
                (Join-Path $cloneInvocation.Target 'partial-clone-sentinel.bin'),
                [byte[]](101, 102, 103, 104)
            )
            return [pscustomobject]@{ ExitCode = 91; Output = 'injected sibling stage clone failure' }
        }
        return [pscustomobject]@{ ExitCode = 0; Output = 'ok' }
    }.GetNewClosure()
    $nonGitStopper = {
        param([string] $ServiceName, [string] $ServiceRunDir)
        $script:nonGitStoppedServices.Add($ServiceName) | Out-Null
    }.GetNewClosure()
    $nonGitDeployRunner = {
        param([string] $DeployRoot)
        $script:nonGitDeployCalls.Add($DeployRoot) | Out-Null
        return [pscustomobject]@{ ExitCode = 0 }
    }.GetNewClosure()
    $nonGitFailureMessage = $null
    try {
        Invoke-TestDeployRebuild -Build -RepoRoot $rebuildRoot -DeploymentPath $nonGitLiveRoot -AllowNonFixedPathForTests -CommandRunner $nonGitRunner -DeployRunner $nonGitDeployRunner -ServiceStopper $nonGitStopper | Out-Null
    } catch {
        $nonGitFailureMessage = $_.Exception.Message
    }
    $nonGitHashesAfter = & $getTransactionHashes $nonGitLiveRoot
    $nonGitManifestAfter = & $getTransactionLiveManifest $nonGitLiveRoot
    $nonGitRetainedStage = if ($nonGitCloneTargets.Count -eq 1) { $nonGitCloneTargets[0] } else { '' }
    & $recordTransactionExpectation (-not [string]::IsNullOrWhiteSpace($nonGitFailureMessage) -and $nonGitFailureMessage -match 'injected sibling stage clone failure') 'Task 1A.1 non-git clone failure is surfaced' "actual='$nonGitFailureMessage'"
    & $recordTransactionExpectation ($nonGitFailureMessage -match 'failed_stage_path=') 'Task 1A.1 partial clone failure reports the retained stage path' "actual='$nonGitFailureMessage'"
    & $recordTransactionExpectation (
        -not [string]::IsNullOrWhiteSpace($nonGitRetainedStage) -and
        (Test-Path -LiteralPath (Join-Path $nonGitRetainedStage 'partial-clone-sentinel.bin') -PathType Leaf)
    ) 'Task 1A.1 partial clone stage is retained without recursive cleanup' "stage='$nonGitRetainedStage'"
    & $recordRetainedStageWithoutEnv -StageRoot $nonGitRetainedStage -Behavior 'Task 1A.1 partial clone stage'
    foreach ($relativePath in $transactionFixturePaths) {
        & $recordTransactionExpectation ($nonGitHashesAfter[$relativePath] -eq $nonGitHashesBefore[$relativePath]) 'Task 1A.1 non-git live bytes remain SHA256-identical' "path='$relativePath' before='$($nonGitHashesBefore[$relativePath])' after='$($nonGitHashesAfter[$relativePath])'"
    }
    & $recordTransactionExpectation ($nonGitManifestAfter.Serialized -ceq $nonGitManifestBefore.Serialized) 'Task 1A.1 clone failure leaves complete live inventory byte-identical' "beforeManifest='$($nonGitManifestBefore.Sha256)' afterManifest='$($nonGitManifestAfter.Sha256)'"
    $nonGitCanonicalScenario = ([System.IO.Path]::GetFullPath($nonGitScenarioRoot)).TrimEnd($transactionPathTrimChars)
    $nonGitCanonicalLive = ([System.IO.Path]::GetFullPath($nonGitLiveRoot)).TrimEnd($transactionPathTrimChars)
    $nonGitStageSafe = $false
    if ($nonGitCloneTargets.Count -eq 1) {
        $nonGitCandidate = $nonGitCloneTargets[0].TrimEnd($transactionPathTrimChars)
        $nonGitCandidateParent = ([System.IO.Path]::GetFullPath((Split-Path -Parent $nonGitCandidate))).TrimEnd($transactionPathTrimChars)
        $nonGitLiveParent = ([System.IO.Path]::GetFullPath((Split-Path -Parent $nonGitCanonicalLive))).TrimEnd($transactionPathTrimChars)
        $nonGitStageSafe = $nonGitCandidateParent.Equals($nonGitLiveParent, [System.StringComparison]::OrdinalIgnoreCase) -and
            $nonGitCandidate.StartsWith("$nonGitCanonicalScenario$([System.IO.Path]::DirectorySeparatorChar)", [System.StringComparison]::OrdinalIgnoreCase) -and
            -not $nonGitCandidate.Equals($nonGitCanonicalLive, [System.StringComparison]::OrdinalIgnoreCase) -and
            -not $nonGitCandidate.StartsWith("$nonGitCanonicalLive$([System.IO.Path]::DirectorySeparatorChar)", [System.StringComparison]::OrdinalIgnoreCase)
    }
    & $recordTransactionExpectation $nonGitStageSafe 'Task 1A.1 clone targets a safe sibling stage, not live' "targets='$($nonGitCloneTargets -join ',')' live='$nonGitLiveRoot'"
    & $recordTransactionExpectation ($nonGitStoppedServices.Count -eq 0) 'Task 1A.1 clone failure stops before service stop' "stopped='$($nonGitStoppedServices -join ',')'"
    & $recordTransactionExpectation ($nonGitDeployCalls.Count -eq 0) 'Task 1A.1 clone failure stops before deploy' "deployCalls=$($nonGitDeployCalls.Count)"

    # Task 1A.2: a stale linked-worktree gitfile is broken state, not a valid
    # checkout.  A prepared standalone stage may replace it while env hashes and
    # source provenance remain exact.
    $brokenGitfileScenarioRoot = Join-Path $sandbox 'transaction-broken-gitfile'
    $brokenGitfileLiveRoot = Join-Path $brokenGitfileScenarioRoot 'live'
    & $newTransactionFixture $brokenGitfileLiveRoot
    $missingLinkedGitDir = Join-Path $brokenGitfileScenarioRoot 'missing-linked-worktree-gitdir'
    [System.IO.File]::WriteAllBytes(
        (Join-Path $brokenGitfileLiveRoot '.git'),
        [System.Text.Encoding]::ASCII.GetBytes("gitdir: $missingLinkedGitDir`r`n")
    )
    $brokenGitfileHashesBefore = & $getTransactionHashes $brokenGitfileLiveRoot
    $transactionOriginUrlHash = & $getTransactionBytesHash -Bytes ([System.Text.Encoding]::UTF8.GetBytes($transactionOriginUrl))
    $brokenGitfileMarkerContent = "scenario=broken-gitfile`nmode=OriginMain`noriginUrlSha256=$transactionOriginUrlHash`ncommit=$transactionOriginCommit`n"
    $brokenGitfileExpectedMarkerHash = & $getTransactionBytesHash -Bytes ([System.Text.Encoding]::UTF8.GetBytes($brokenGitfileMarkerContent))
    $brokenGitfileCloneTargets = New-Object 'System.Collections.Generic.List[string]'
    $brokenGitfileCloneOrigins = New-Object 'System.Collections.Generic.List[string]'
    $brokenGitfilePreparedStages = New-Object 'System.Collections.Generic.List[object]'
    $brokenGitfileDeployCalls = New-Object 'System.Collections.Generic.List[string]'
    $script:brokenGitfileCloneTargets = $brokenGitfileCloneTargets
    $script:brokenGitfileCloneOrigins = $brokenGitfileCloneOrigins
    $script:brokenGitfilePreparedStages = $brokenGitfilePreparedStages
    $script:brokenGitfileDeployCalls = $brokenGitfileDeployCalls
    $brokenGitfileRunner = {
        param([string] $Tool, [string[]] $Arguments, [string] $WorkingDirectory)
        $commandText = $Arguments -join ' '
        if ($commandText -eq 'remote get-url origin') {
            return [pscustomobject]@{ ExitCode = 0; Output = $transactionOriginUrl }
        }
        if ($Arguments -contains 'clone') {
            $cloneInvocation = & $resolveTransactionCloneInvocation -Arguments $Arguments -ExpectedOrigin $transactionOriginUrl
            $script:brokenGitfileCloneOrigins.Add($cloneInvocation.Origin) | Out-Null
            $script:brokenGitfileCloneTargets.Add($cloneInvocation.Target) | Out-Null
            $preparedStage = & $newPreparedTransactionStage -Target $cloneInvocation.Target -ScenarioRoot $brokenGitfileScenarioRoot -LiveRoot $brokenGitfileLiveRoot -MarkerContent $brokenGitfileMarkerContent -IncludeDeployScript $true
            $script:brokenGitfilePreparedStages.Add($preparedStage) | Out-Null
            return [pscustomobject]@{ ExitCode = 0; Output = 'prepared standalone stage' }
        }
        if ($commandText -eq 'rev-parse --short HEAD') {
            return [pscustomobject]@{ ExitCode = 0; Output = $transactionOriginCommit.Substring(0, 7) }
        }
        if ($commandText -eq 'status --short') {
            return [pscustomobject]@{ ExitCode = 0; Output = '' }
        }
        if ($commandText -eq 'rev-parse origin/main') {
            return [pscustomobject]@{ ExitCode = 0; Output = $transactionOriginCommit }
        }
        return [pscustomobject]@{ ExitCode = 0; Output = 'ok' }
    }.GetNewClosure()
    $brokenGitfileDeployRunner = {
        param([string] $DeployRoot)
        $script:brokenGitfileDeployCalls.Add($DeployRoot) | Out-Null
        return [pscustomobject]@{ ExitCode = 0 }
    }.GetNewClosure()
    $brokenGitfileFailureMessage = $null
    $brokenGitfileResult = $null
    try {
        $brokenGitfileResult = Invoke-TestDeployRebuild -Build -RepoRoot $rebuildRoot -DeploymentPath $brokenGitfileLiveRoot -AllowNonFixedPathForTests -CommandRunner $brokenGitfileRunner -DeployRunner $brokenGitfileDeployRunner -ServiceStopper $noopStopper
    } catch {
        $brokenGitfileFailureMessage = $_.Exception.Message
    }
    $brokenGitfileHashesAfter = & $getTransactionHashes $brokenGitfileLiveRoot
    $brokenGitfileActualCommit = if ($null -eq $brokenGitfileResult) { '<no result>' } else { [string]$brokenGitfileResult.OriginMainCommit }
    $brokenGitfileFinalMarkerPath = Join-Path $brokenGitfileLiveRoot $transactionProvenanceMarker
    $brokenGitfileFinalMarkerHash = if (Test-Path -LiteralPath $brokenGitfileFinalMarkerPath -PathType Leaf) {
        (Get-FileHash -LiteralPath $brokenGitfileFinalMarkerPath -Algorithm SHA256).Hash
    } else {
        '<missing>'
    }
    & $recordTransactionExpectation ([string]::IsNullOrWhiteSpace($brokenGitfileFailureMessage)) 'Task 1A.2 broken gitfile self-heals successfully' "actual='$brokenGitfileFailureMessage'"
    & $recordTransactionExpectation (Test-Path -LiteralPath (Join-Path $brokenGitfileLiveRoot '.git') -PathType Container) 'Task 1A.2 replacement is a standalone checkout' "live .git remains file=$((Test-Path -LiteralPath (Join-Path $brokenGitfileLiveRoot '.git') -PathType Leaf))"
    & $recordTransactionExpectation ($brokenGitfilePreparedStages.Count -eq 1) 'Task 1A.2 broken checkout is replaced from one validated sibling stage' "attemptedTargets='$($brokenGitfileCloneTargets -join ',')' preparedCount=$($brokenGitfilePreparedStages.Count)"
    & $recordTransactionExpectation ($brokenGitfileCloneOrigins.Count -eq 1 -and $brokenGitfileCloneOrigins[0] -eq $transactionOriginUrl) 'Task 1A.2 prepared stage uses caller source provenance' "origins='$($brokenGitfileCloneOrigins -join ',')'"
    & $recordTransactionExpectation ($brokenGitfileActualCommit -eq $transactionOriginCommit) 'Task 1A.2 result provenance matches origin/main' "actual='$brokenGitfileActualCommit'"
    & $recordTransactionExpectation ($brokenGitfileFinalMarkerHash -eq $brokenGitfileExpectedMarkerHash) 'Task 1A.2 prepared-stage provenance marker reaches final live checkout' "expected='$brokenGitfileExpectedMarkerHash' actual='$brokenGitfileFinalMarkerHash'"
    foreach ($relativePath in $transactionFixturePaths | Where-Object { $_ -ne 'live-sentinel.bin' }) {
        & $recordTransactionExpectation ($brokenGitfileHashesAfter[$relativePath] -eq $brokenGitfileHashesBefore[$relativePath]) 'Task 1A.2 preserved env remains SHA256-identical' "path='$relativePath' before='$($brokenGitfileHashesBefore[$relativePath])' after='$($brokenGitfileHashesAfter[$relativePath])'"
    }
    $brokenGitfileEnvExamples = @(
        '.env.example',
        'bim-review-coordinator\.env.example',
        '.env.web-plane.host-kit.example'
    ) | Where-Object { Test-Path -LiteralPath (Join-Path $brokenGitfileLiveRoot $_) -PathType Leaf }
    & $recordTransactionExpectation (@($brokenGitfileEnvExamples).Count -eq 0) 'Task 1A.2 staged env restore does not require .example files' "unexpectedExamples='$($brokenGitfileEnvExamples -join ',')'"
    & $recordTransactionExpectation ($brokenGitfileDeployCalls.Count -eq 1 -and $brokenGitfileDeployCalls[0] -eq $brokenGitfileLiveRoot) 'Task 1A.2 deploy runs from replacement live checkout' "deployRoots='$($brokenGitfileDeployCalls -join ',')'"

    # Task 1A.3: a valid standalone checkout with the wrong origin is rejected
    # before staging, service stop, cutover, or deploy.
    $wrongOriginScenarioRoot = Join-Path $sandbox 'transaction-wrong-origin'
    $wrongOriginLiveRoot = Join-Path $wrongOriginScenarioRoot 'live'
    & $newTransactionFixture $wrongOriginLiveRoot
    New-Item -ItemType Directory -Path (Join-Path $wrongOriginLiveRoot '.git') -Force | Out-Null
    $wrongOriginManifestBefore = & $getTransactionLiveManifest $wrongOriginLiveRoot
    & $assertTransactionManifestCoverage -Manifest $wrongOriginManifestBefore -ExpectedGitType 'directory'
    $wrongOriginCloneTargets = New-Object 'System.Collections.Generic.List[string]'
    $wrongOriginStoppedServices = New-Object 'System.Collections.Generic.List[string]'
    $wrongOriginDeployCalls = New-Object 'System.Collections.Generic.List[string]'
    $script:wrongOriginCloneTargets = $wrongOriginCloneTargets
    $script:wrongOriginStoppedServices = $wrongOriginStoppedServices
    $script:wrongOriginDeployCalls = $wrongOriginDeployCalls
    $wrongOriginRunner = {
        param([string] $Tool, [string[]] $Arguments, [string] $WorkingDirectory)
        $commandText = $Arguments -join ' '
        if ($commandText -eq 'remote get-url origin') {
            $output = if ([System.IO.Path]::GetFullPath($WorkingDirectory) -eq [System.IO.Path]::GetFullPath($wrongOriginLiveRoot)) {
                'https://wrong.example.invalid/not-this-repo.git'
            } else {
                $transactionOriginUrl
            }
            return [pscustomobject]@{ ExitCode = 0; Output = $output }
        }
        if ($Arguments -contains 'clone') {
            $cloneInvocation = & $resolveTransactionCloneInvocation -Arguments $Arguments -ExpectedOrigin $transactionOriginUrl
            $script:wrongOriginCloneTargets.Add($cloneInvocation.Target) | Out-Null
        }
        return [pscustomobject]@{ ExitCode = 0; Output = 'ok' }
    }.GetNewClosure()
    $wrongOriginStopper = {
        param([string] $ServiceName, [string] $ServiceRunDir)
        $script:wrongOriginStoppedServices.Add($ServiceName) | Out-Null
    }.GetNewClosure()
    $wrongOriginDeployRunner = {
        param([string] $DeployRoot)
        $script:wrongOriginDeployCalls.Add($DeployRoot) | Out-Null
        return [pscustomobject]@{ ExitCode = 0 }
    }.GetNewClosure()
    $wrongOriginFailureMessage = $null
    try {
        Invoke-TestDeployRebuild -Build -RepoRoot $rebuildRoot -DeploymentPath $wrongOriginLiveRoot -AllowNonFixedPathForTests -CommandRunner $wrongOriginRunner -DeployRunner $wrongOriginDeployRunner -ServiceStopper $wrongOriginStopper | Out-Null
    } catch {
        $wrongOriginFailureMessage = $_.Exception.Message
    }
    $wrongOriginManifestAfter = & $getTransactionLiveManifest $wrongOriginLiveRoot
    & $recordTransactionExpectation (-not [string]::IsNullOrWhiteSpace($wrongOriginFailureMessage) -and $wrongOriginFailureMessage -match 'origin mismatch') 'Task 1A.3 wrong live origin is rejected' "actual='$wrongOriginFailureMessage'"
    & $recordTransactionExpectation ($wrongOriginCloneTargets.Count -eq 0) 'Task 1A.3 wrong origin fails before staging' "targets='$($wrongOriginCloneTargets -join ',')'"
    & $recordTransactionExpectation ($wrongOriginStoppedServices.Count -eq 0) 'Task 1A.3 wrong origin fails before service stop' "stopped='$($wrongOriginStoppedServices -join ',')'"
    & $recordTransactionExpectation ($wrongOriginDeployCalls.Count -eq 0) 'Task 1A.3 wrong origin fails before deploy' "deployCalls=$($wrongOriginDeployCalls.Count)"
    & $recordTransactionExpectation ($wrongOriginManifestAfter.Serialized -ceq $wrongOriginManifestBefore.Serialized) 'Task 1A.3 wrong-origin rejection leaves complete live manifest identical' "beforeManifest='$($wrongOriginManifestBefore.Sha256)' afterManifest='$($wrongOriginManifestAfter.Sha256)'"

    # Task 1A.4: a successfully prepared stage without scripts/deploy.ps1 is
    # rejected while live is still untouched and before services are stopped.
    $missingDeployScenarioRoot = Join-Path $sandbox 'transaction-stage-missing-deploy'
    $missingDeployLiveRoot = Join-Path $missingDeployScenarioRoot 'live'
    & $newTransactionFixture $missingDeployLiveRoot
    $missingDeployManifestBefore = & $getTransactionLiveManifest $missingDeployLiveRoot
    & $assertTransactionManifestCoverage -Manifest $missingDeployManifestBefore -ExpectedGitType 'missing'
    $missingDeployMarkerContent = "scenario=missing-deploy`nmode=OriginMain`noriginUrlSha256=$transactionOriginUrlHash`ncommit=$transactionOriginCommit`n"
    $missingDeployExpectedMarkerHash = & $getTransactionBytesHash -Bytes ([System.Text.Encoding]::UTF8.GetBytes($missingDeployMarkerContent))
    $missingDeployCloneTargets = New-Object 'System.Collections.Generic.List[string]'
    $missingDeployPreparedStages = New-Object 'System.Collections.Generic.List[object]'
    $missingDeployStoppedServices = New-Object 'System.Collections.Generic.List[string]'
    $missingDeployDeployCalls = New-Object 'System.Collections.Generic.List[string]'
    $script:missingDeployCloneTargets = $missingDeployCloneTargets
    $script:missingDeployPreparedStages = $missingDeployPreparedStages
    $script:missingDeployStoppedServices = $missingDeployStoppedServices
    $script:missingDeployDeployCalls = $missingDeployDeployCalls
    $missingDeployRunner = {
        param([string] $Tool, [string[]] $Arguments, [string] $WorkingDirectory)
        $commandText = $Arguments -join ' '
        if ($commandText -eq 'remote get-url origin') {
            return [pscustomobject]@{ ExitCode = 0; Output = $transactionOriginUrl }
        }
        if ($Arguments -contains 'clone') {
            $cloneInvocation = & $resolveTransactionCloneInvocation -Arguments $Arguments -ExpectedOrigin $transactionOriginUrl
            $script:missingDeployCloneTargets.Add($cloneInvocation.Target) | Out-Null
            $preparedStage = & $newPreparedTransactionStage -Target $cloneInvocation.Target -ScenarioRoot $missingDeployScenarioRoot -LiveRoot $missingDeployLiveRoot -MarkerContent $missingDeployMarkerContent -IncludeDeployScript $false
            $script:missingDeployPreparedStages.Add($preparedStage) | Out-Null
            return [pscustomobject]@{ ExitCode = 0; Output = 'prepared stage intentionally missing scripts/deploy.ps1' }
        }
        if ($commandText -eq 'rev-parse --short HEAD') {
            return [pscustomobject]@{ ExitCode = 0; Output = $transactionOriginCommit.Substring(0, 7) }
        }
        if ($commandText -eq 'status --short') {
            return [pscustomobject]@{ ExitCode = 0; Output = '' }
        }
        if ($commandText -eq 'rev-parse origin/main') {
            return [pscustomobject]@{ ExitCode = 0; Output = $transactionOriginCommit }
        }
        return [pscustomobject]@{ ExitCode = 0; Output = 'ok' }
    }.GetNewClosure()
    $missingDeployStopper = {
        param([string] $ServiceName, [string] $ServiceRunDir)
        $script:missingDeployStoppedServices.Add($ServiceName) | Out-Null
    }.GetNewClosure()
    $missingDeployDeployRunner = {
        param([string] $DeployRoot)
        $script:missingDeployDeployCalls.Add($DeployRoot) | Out-Null
        return [pscustomobject]@{ ExitCode = 0 }
    }.GetNewClosure()
    $missingDeployFailureMessage = $null
    try {
        Invoke-TestDeployRebuild -Build -RepoRoot $rebuildRoot -DeploymentPath $missingDeployLiveRoot -AllowNonFixedPathForTests -CommandRunner $missingDeployRunner -DeployRunner $missingDeployDeployRunner -ServiceStopper $missingDeployStopper | Out-Null
    } catch {
        $missingDeployFailureMessage = $_.Exception.Message
    }
    $missingDeployManifestAfter = & $getTransactionLiveManifest $missingDeployLiveRoot
    $missingDeployPreparedMarkerHash = if ($missingDeployPreparedStages.Count -eq 1) {
        [string]$missingDeployPreparedStages[0].MarkerHash
    } else {
        '<not-prepared>'
    }
    & $recordTransactionExpectation (-not [string]::IsNullOrWhiteSpace($missingDeployFailureMessage) -and $missingDeployFailureMessage -match 'deploy(ment)? script missing') 'Task 1A.4 missing stage deploy script is surfaced' "actual='$missingDeployFailureMessage'"
    & $recordTransactionExpectation ($missingDeployPreparedStages.Count -eq 1 -and $missingDeployPreparedMarkerHash -eq $missingDeployExpectedMarkerHash) 'Task 1A.4 deploy-script validation observes one safe marked sibling stage' "attemptedTargets='$($missingDeployCloneTargets -join ',')' preparedCount=$($missingDeployPreparedStages.Count) markerHash='$missingDeployPreparedMarkerHash'"
    & $recordTransactionExpectation ($missingDeployStoppedServices.Count -eq 0) 'Task 1A.4 missing deploy script fails before service stop' "stopped='$($missingDeployStoppedServices -join ',')'"
    & $recordTransactionExpectation ($missingDeployDeployCalls.Count -eq 0) 'Task 1A.4 missing deploy script fails before deploy' "deployCalls=$($missingDeployDeployCalls.Count)"
    & $recordTransactionExpectation ($missingDeployManifestAfter.Serialized -ceq $missingDeployManifestBefore.Serialized) 'Task 1A.4 missing deploy script leaves complete live manifest identical' "beforeManifest='$($missingDeployManifestBefore.Sha256)' afterManifest='$($missingDeployManifestAfter.Sha256)'"
    & $recordTransactionExpectation (
        $missingDeployCloneTargets.Count -eq 1 -and
        (Test-Path -LiteralPath $missingDeployCloneTargets[0] -PathType Container)
    ) 'Task 1A.4 validated stage missing deploy script is retained' "stage='$($missingDeployCloneTargets -join ',')'"
    & $recordTransactionExpectation ($missingDeployFailureMessage -match 'failed_stage_path=') 'Task 1A.4 missing deploy script reports the retained stage path' "actual='$missingDeployFailureMessage'"
    if ($missingDeployCloneTargets.Count -eq 1) {
        & $recordRetainedStageWithoutEnv -StageRoot $missingDeployCloneTargets[0] -Behavior 'Task 1A.4 missing-deploy stage'
    }

    # Task 1A.5: a syntactically valid gitfile that cannot be inspected is an
    # indeterminate checkout, not proof of a broken checkout. Fail closed before
    # clone/stage/stop/deploy while a real Windows exclusive handle blocks reads.
    $unreadableGitfileScenarioRoot = Join-Path $sandbox 'transaction-unreadable-gitfile'
    $unreadableGitfileLiveRoot = Join-Path $unreadableGitfileScenarioRoot 'live'
    & $newTransactionFixture $unreadableGitfileLiveRoot
    $validLinkedGitDir = Join-Path $unreadableGitfileScenarioRoot 'valid-linked-gitdir'
    New-Item -ItemType Directory -Path $validLinkedGitDir -Force | Out-Null
    $unreadableGitfilePath = Join-Path $unreadableGitfileLiveRoot '.git'
    [System.IO.File]::WriteAllBytes(
        $unreadableGitfilePath,
        [System.Text.Encoding]::ASCII.GetBytes("gitdir: $validLinkedGitDir`r`n")
    )
    $unreadableGitfileManifestBefore = & $getTransactionLiveManifest $unreadableGitfileLiveRoot
    & $assertTransactionManifestCoverage -Manifest $unreadableGitfileManifestBefore -ExpectedGitType 'file'
    $unreadableGitfileCloneTargets = New-Object 'System.Collections.Generic.List[string]'
    $unreadableGitfileStoppedServices = New-Object 'System.Collections.Generic.List[string]'
    $unreadableGitfileDeployCalls = New-Object 'System.Collections.Generic.List[string]'
    $script:unreadableGitfileCloneTargets = $unreadableGitfileCloneTargets
    $script:unreadableGitfileStoppedServices = $unreadableGitfileStoppedServices
    $script:unreadableGitfileDeployCalls = $unreadableGitfileDeployCalls
    $unreadableGitfileRunner = {
        param([string] $Tool, [string[]] $Arguments, [string] $WorkingDirectory)
        $commandText = $Arguments -join ' '
        if ($commandText -eq 'remote get-url origin') {
            return [pscustomobject]@{ ExitCode = 0; Output = $transactionOriginUrl }
        }
        if ($Arguments -contains 'clone') {
            $cloneInvocation = & $resolveTransactionCloneInvocation -Arguments $Arguments -ExpectedOrigin $transactionOriginUrl
            $script:unreadableGitfileCloneTargets.Add($cloneInvocation.Target) | Out-Null
            return [pscustomobject]@{ ExitCode = 92; Output = 'inspection failure must not reach clone' }
        }
        return [pscustomobject]@{ ExitCode = 0; Output = 'ok' }
    }.GetNewClosure()
    $unreadableGitfileStopper = {
        param([string] $ServiceName, [string] $ServiceRunDir)
        $script:unreadableGitfileStoppedServices.Add($ServiceName) | Out-Null
    }.GetNewClosure()
    $unreadableGitfileDeployRunner = {
        param([string] $DeployRoot)
        $script:unreadableGitfileDeployCalls.Add($DeployRoot) | Out-Null
        return [pscustomobject]@{ ExitCode = 0 }
    }.GetNewClosure()
    $unreadableGitfileFailureMessage = $null
    $unreadableGitfileHandle = $null
    try {
        $unreadableGitfileHandle = [System.IO.File]::Open(
            $unreadableGitfilePath,
            [System.IO.FileMode]::Open,
            [System.IO.FileAccess]::ReadWrite,
            [System.IO.FileShare]::None
        )
        try {
            Invoke-TestDeployRebuild -Build -RepoRoot $rebuildRoot -DeploymentPath $unreadableGitfileLiveRoot -AllowNonFixedPathForTests -CommandRunner $unreadableGitfileRunner -DeployRunner $unreadableGitfileDeployRunner -ServiceStopper $unreadableGitfileStopper | Out-Null
        } catch {
            $unreadableGitfileFailureMessage = $_.Exception.Message
        }
    } finally {
        if ($null -ne $unreadableGitfileHandle) {
            $unreadableGitfileHandle.Dispose()
        }
    }
    $unreadableGitfileManifestAfter = & $getTransactionLiveManifest $unreadableGitfileLiveRoot
    $unreadableGitfileLiveLeaf = Split-Path -Leaf $unreadableGitfileLiveRoot
    $unreadableGitfileResidue = @(Get-ChildItem -LiteralPath $unreadableGitfileScenarioRoot -Directory -Force | Where-Object {
        $_.Name -like ".$unreadableGitfileLiveLeaf.rebuild-stage-*" -or
        $_.Name -like ".$unreadableGitfileLiveLeaf.rebuild-previous-*"
    })
    $unreadableGitfileResidueNames = @($unreadableGitfileResidue | ForEach-Object { $_.Name })
    & $recordTransactionExpectation (-not [string]::IsNullOrWhiteSpace($unreadableGitfileFailureMessage) -and $unreadableGitfileFailureMessage -match 'deployment gitfile inspection failed') 'Task 1A.5 unreadable gitfile inspection fails closed' "actual='$unreadableGitfileFailureMessage'"
    & $recordTransactionExpectation ($unreadableGitfileCloneTargets.Count -eq 0) 'Task 1A.5 unreadable gitfile fails before clone or stage' "targets='$($unreadableGitfileCloneTargets -join ',')'"
    & $recordTransactionExpectation ($unreadableGitfileStoppedServices.Count -eq 0) 'Task 1A.5 unreadable gitfile fails before service stop' "stopped='$($unreadableGitfileStoppedServices -join ',')'"
    & $recordTransactionExpectation ($unreadableGitfileDeployCalls.Count -eq 0) 'Task 1A.5 unreadable gitfile fails before deploy' "deployCalls=$($unreadableGitfileDeployCalls.Count)"
    & $recordTransactionExpectation ($unreadableGitfileManifestAfter.Serialized -ceq $unreadableGitfileManifestBefore.Serialized) 'Task 1A.5 unreadable gitfile leaves complete live manifest identical' "beforeManifest='$($unreadableGitfileManifestBefore.Sha256)' afterManifest='$($unreadableGitfileManifestAfter.Sha256)'"
    & $recordTransactionExpectation ($unreadableGitfileResidue.Count -eq 0) 'Task 1A.5 unreadable gitfile leaves no transaction residue' "residue='$($unreadableGitfileResidueNames -join ',')'"

    # Task 1A.6: staged replacement service-stop failures are aggregated after
    # every owned service is attempted, then block before the first Directory.Move.
    $serviceStopFailureScenarioRoot = Join-Path $sandbox 'transaction-service-stop-failure'
    $serviceStopFailureLiveRoot = Join-Path $serviceStopFailureScenarioRoot 'live'
    & $newTransactionFixture $serviceStopFailureLiveRoot
    $serviceStopFailureManifestBefore = & $getTransactionLiveManifest $serviceStopFailureLiveRoot
    & $assertTransactionManifestCoverage -Manifest $serviceStopFailureManifestBefore -ExpectedGitType 'missing'
    $serviceStopFailureMarkerContent = "scenario=service-stop-failure`nmode=OriginMain`noriginUrlSha256=$transactionOriginUrlHash`ncommit=$transactionOriginCommit`n"
    $serviceStopFailureCloneTargets = New-Object 'System.Collections.Generic.List[string]'
    $serviceStopAttempts = New-Object 'System.Collections.Generic.List[string]'
    $serviceStopFailureDeployCalls = New-Object 'System.Collections.Generic.List[string]'
    $script:serviceStopFailureCloneTargets = $serviceStopFailureCloneTargets
    $script:serviceStopAttempts = $serviceStopAttempts
    $script:serviceStopFailureDeployCalls = $serviceStopFailureDeployCalls
    $serviceStopFailureRunner = {
        param([string] $Tool, [string[]] $Arguments, [string] $WorkingDirectory)
        $commandText = $Arguments -join ' '
        if ($commandText -eq 'remote get-url origin') {
            return [pscustomobject]@{ ExitCode = 0; Output = $transactionOriginUrl }
        }
        if ($Arguments -contains 'clone') {
            $cloneInvocation = & $resolveTransactionCloneInvocation -Arguments $Arguments -ExpectedOrigin $transactionOriginUrl
            $script:serviceStopFailureCloneTargets.Add($cloneInvocation.Target) | Out-Null
            & $newPreparedTransactionStage -Target $cloneInvocation.Target -ScenarioRoot $serviceStopFailureScenarioRoot -LiveRoot $serviceStopFailureLiveRoot -MarkerContent $serviceStopFailureMarkerContent -IncludeDeployScript $true | Out-Null
            return [pscustomobject]@{ ExitCode = 0; Output = 'prepared stage for service-stop failure' }
        }
        if ($commandText -eq 'rev-parse --short HEAD') {
            return [pscustomobject]@{ ExitCode = 0; Output = $transactionOriginCommit.Substring(0, 7) }
        }
        if ($commandText -eq 'status --short') {
            return [pscustomobject]@{ ExitCode = 0; Output = '' }
        }
        if ($commandText -eq 'rev-parse origin/main') {
            return [pscustomobject]@{ ExitCode = 0; Output = $transactionOriginCommit }
        }
        return [pscustomobject]@{ ExitCode = 0; Output = 'ok' }
    }.GetNewClosure()
    $serviceStopFailureStopper = {
        param([string] $ServiceName, [string] $ServiceRunDir)
        $script:serviceStopAttempts.Add($ServiceName) | Out-Null
        if ($ServiceName -eq 'bim-streaming-conversion-service') {
            throw 'injected deployment-owned service stop failure'
        }
    }.GetNewClosure()
    $serviceStopFailureDeployRunner = {
        param([string] $DeployRoot)
        $script:serviceStopFailureDeployCalls.Add($DeployRoot) | Out-Null
        return [pscustomobject]@{ ExitCode = 0 }
    }.GetNewClosure()
    $serviceStopFailureMessage = $null
    try {
        Invoke-TestDeployRebuild -Build -RepoRoot $rebuildRoot -DeploymentPath $serviceStopFailureLiveRoot -AllowNonFixedPathForTests -CommandRunner $serviceStopFailureRunner -DeployRunner $serviceStopFailureDeployRunner -ServiceStopper $serviceStopFailureStopper | Out-Null
    } catch {
        $serviceStopFailureMessage = $_.Exception.Message
    }
    $serviceStopFailureManifestAfter = & $getTransactionLiveManifest $serviceStopFailureLiveRoot
    $serviceStopFailureLiveLeaf = Split-Path -Leaf $serviceStopFailureLiveRoot
    $serviceStopFailureResidue = @(Get-ChildItem -LiteralPath $serviceStopFailureScenarioRoot -Directory -Force | Where-Object {
        $_.Name -like ".$serviceStopFailureLiveLeaf.rebuild-stage-*" -or
        $_.Name -like ".$serviceStopFailureLiveLeaf.rebuild-previous-*"
    })
    $serviceStopFailureStageResidue = @($serviceStopFailureResidue | Where-Object { $_.Name -like ".$serviceStopFailureLiveLeaf.rebuild-stage-*" })
    $serviceStopFailurePreviousResidue = @($serviceStopFailureResidue | Where-Object { $_.Name -like ".$serviceStopFailureLiveLeaf.rebuild-previous-*" })
    $serviceStopFailureResidueNames = @($serviceStopFailureResidue | ForEach-Object { $_.Name })
    $expectedStoppedServices = @('bim-streaming-server', 'bim-streaming-conversion-service', 'governance-service', 'kit-manager-api')
    $allStopAttemptsObserved = $serviceStopAttempts.Count -eq $expectedStoppedServices.Count
    foreach ($serviceName in $expectedStoppedServices) {
        $allStopAttemptsObserved = $allStopAttemptsObserved -and ($serviceStopAttempts -contains $serviceName)
    }
    & $recordTransactionExpectation (-not [string]::IsNullOrWhiteSpace($serviceStopFailureMessage) -and $serviceStopFailureMessage -match 'deployment service stop failed') 'Task 1A.6 staged service-stop failure is surfaced' "actual='$serviceStopFailureMessage'"
    & $recordTransactionExpectation $allStopAttemptsObserved 'Task 1A.6 all deployment-owned service stops are attempted' "attempts='$($serviceStopAttempts -join ',')'"
    & $recordTransactionExpectation ($serviceStopFailureManifestAfter.Serialized -ceq $serviceStopFailureManifestBefore.Serialized) 'Task 1A.6 service-stop failure leaves complete live manifest identical' "beforeManifest='$($serviceStopFailureManifestBefore.Sha256)' afterManifest='$($serviceStopFailureManifestAfter.Sha256)'"
    & $recordTransactionExpectation ($serviceStopFailureDeployCalls.Count -eq 0) 'Task 1A.6 service-stop failure blocks deploy' "deployCalls=$($serviceStopFailureDeployCalls.Count)"
    & $recordTransactionExpectation (
        $serviceStopFailureStageResidue.Count -eq 1 -and
        $serviceStopFailurePreviousResidue.Count -eq 0
    ) 'Task 1A.6 service-stop failure retains one validated stage and creates no previous checkout' "residue='$($serviceStopFailureResidueNames -join ',')'"
    & $recordTransactionExpectation ($serviceStopFailureMessage -match 'failed_stage_path=') 'Task 1A.6 service-stop failure reports the retained stage path' "actual='$serviceStopFailureMessage'"
    if ($serviceStopFailureStageResidue.Count -eq 1) {
        & $recordRetainedStageWithoutEnv -StageRoot $serviceStopFailureStageResidue[0].FullName -Behavior 'Task 1A.6 service-stop failure stage'
    }

    # Task 1A.7: a valid fixed-path checkout after a real Kit build contains
    # ignored reparse entries under _build/_compiler/_repo.  Production must
    # treat live as an opaque rename source, prepare a clean sibling checkout,
    # and never reset/clean the active tree or follow the external target.
    $kitReparseScenarioRoot = Join-Path $sandbox 'transaction-valid-kit-reparse'
    $kitReparseLiveRoot = Join-Path $kitReparseScenarioRoot 'live'
    $kitReparseOutsideRoot = Join-Path $kitReparseScenarioRoot 'packman-target'
    $kitReparseLinkRelative = 'bim-streaming-server\_repo\deps\repo_build'
    $kitReparseLiveLink = Join-Path $kitReparseLiveRoot $kitReparseLinkRelative
    $kitReparseOutsideSentinel = Join-Path $kitReparseOutsideRoot 'sentinel.bin'
    & $newTransactionFixture $kitReparseLiveRoot
    New-Item -ItemType Directory -Path (Join-Path $kitReparseLiveRoot '.git') -Force | Out-Null
    New-Item -ItemType Directory -Path (Split-Path -Parent $kitReparseLiveLink) -Force | Out-Null
    New-Item -ItemType Directory -Path $kitReparseOutsideRoot -Force | Out-Null
    [System.IO.File]::WriteAllBytes($kitReparseOutsideSentinel, [byte[]](73, 74, 75, 240, 241, 242))
    $kitReparseOutsideHashBefore = (Get-FileHash -LiteralPath $kitReparseOutsideSentinel -Algorithm SHA256).Hash
    $kitReparseOutsideInventoryBefore = @(
        Get-ChildItem -LiteralPath $kitReparseOutsideRoot -Force -Recurse |
            Sort-Object FullName |
            ForEach-Object {
                $relative = $_.FullName.Substring($kitReparseOutsideRoot.Length)
                if ($_.PSIsContainer) {
                    "$relative|directory|$($_.Attributes)|$($_.CreationTimeUtc.Ticks)|$($_.LastWriteTimeUtc.Ticks)"
                } else {
                    "$relative|file|$($_.Length)|$((Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash)|$($_.CreationTimeUtc.Ticks)|$($_.LastWriteTimeUtc.Ticks)"
                }
            }
    ) -join "`n"
    $kitReparseEnvHashesBefore = & $getTransactionHashes $kitReparseLiveRoot
    $kitReparseMarkerContent = "scenario=valid-kit-reparse`nmode=OriginMain`noriginUrlSha256=$transactionOriginUrlHash`ncommit=$transactionOriginCommit`n"
    $kitReparseCloneTargets = New-Object 'System.Collections.Generic.List[string]'
    $kitReparseGitCommands = New-Object 'System.Collections.Generic.List[object]'
    $kitReparseStopAttempts = New-Object 'System.Collections.Generic.List[string]'
    $kitReparseDeployCalls = New-Object 'System.Collections.Generic.List[string]'
    $script:kitReparseCloneTargets = $kitReparseCloneTargets
    $script:kitReparseGitCommands = $kitReparseGitCommands
    $script:kitReparseStopAttempts = $kitReparseStopAttempts
    $script:kitReparseDeployCalls = $kitReparseDeployCalls
    $kitReparseRunner = {
        param([string] $Tool, [string[]] $Arguments, [string] $WorkingDirectory)
        $commandText = $Arguments -join ' '
        $script:kitReparseGitCommands.Add([pscustomobject]@{
            Command = $commandText
            WorkingDirectory = [System.IO.Path]::GetFullPath($WorkingDirectory)
        }) | Out-Null
        if ($commandText -eq 'remote get-url origin') {
            return [pscustomobject]@{ ExitCode = 0; Output = $transactionOriginUrl }
        }
        if ($Arguments -contains 'clone') {
            $cloneInvocation = & $resolveTransactionCloneInvocation -Arguments $Arguments -ExpectedOrigin $transactionOriginUrl
            $script:kitReparseCloneTargets.Add($cloneInvocation.Target) | Out-Null
            & $newPreparedTransactionStage `
                -Target $cloneInvocation.Target `
                -ScenarioRoot $kitReparseScenarioRoot `
                -LiveRoot $kitReparseLiveRoot `
                -MarkerContent $kitReparseMarkerContent `
                -IncludeDeployScript $true | Out-Null
            New-Item -ItemType Directory -Path (Join-Path $cloneInvocation.Target 'docs\plans\assets') -Force | Out-Null
            New-Item -ItemType Directory -Path (Join-Path $cloneInvocation.Target 'docs\plans\uploads') -Force | Out-Null
            New-Item -ItemType Directory -Path (Join-Path $cloneInvocation.Target 'web-viewer-sample\public') -Force | Out-Null
            [System.IO.File]::WriteAllBytes(
                (Join-Path $cloneInvocation.Target 'docs\plans\assets\vp-kit-reparse.png'),
                [byte[]](1, 2, 3, 4)
            )
            [System.IO.File]::WriteAllBytes(
                (Join-Path $cloneInvocation.Target 'docs\plans\uploads\concept-kit-reparse.png'),
                [byte[]](5, 6, 7, 8)
            )
            return [pscustomobject]@{ ExitCode = 0; Output = 'prepared standalone Kit-reparse stage' }
        }
        if ($commandText -eq 'rev-parse --short HEAD') {
            return [pscustomobject]@{ ExitCode = 0; Output = $transactionOriginCommit.Substring(0, 7) }
        }
        if ($commandText -eq 'status --short') {
            return [pscustomobject]@{ ExitCode = 0; Output = '' }
        }
        if ($commandText -eq 'rev-parse origin/main') {
            return [pscustomobject]@{ ExitCode = 0; Output = $transactionOriginCommit }
        }
        return [pscustomobject]@{ ExitCode = 0; Output = 'ok' }
    }.GetNewClosure()
    $kitReparseStopper = {
        param([string] $ServiceName, [string] $ServiceRunDir)
        $script:kitReparseStopAttempts.Add($ServiceName) | Out-Null
    }.GetNewClosure()
    $kitReparseDeployRunner = {
        param([string] $DeployRoot)
        $script:kitReparseDeployCalls.Add($DeployRoot) | Out-Null
        return [pscustomobject]@{ ExitCode = 0 }
    }.GetNewClosure()
    $kitReparseOriginalFixedPath = $script:TestDeployFixedPath
    $kitReparseResult = $null
    $kitReparseFailureMessage = $null
    $kitReparsePreviousPath = ''
    $kitReparseLiveManifestBefore = $null
    try {
        New-Item -ItemType Junction -Path $kitReparseLiveLink -Target $kitReparseOutsideRoot -ErrorAction Stop | Out-Null
        $kitReparseLiveManifestBefore = & $getTransactionLiveManifest $kitReparseLiveRoot
        $script:TestDeployFixedPath = $kitReparseLiveRoot
        try {
            $kitReparseResult = Invoke-TestDeployRebuild `
                -Build `
                -RepoRoot $rebuildRoot `
                -DeploymentPath $kitReparseLiveRoot `
                -CommandRunner $kitReparseRunner `
                -DeployRunner $kitReparseDeployRunner `
                -ServiceStopper $kitReparseStopper
        } catch {
            $kitReparseFailureMessage = $_.Exception.Message
        }
        if ($null -ne $kitReparseResult -and $kitReparseResult.PSObject.Properties.Name -contains 'PreviousPath') {
            $kitReparsePreviousPath = [string]$kitReparseResult.PreviousPath
        }

        $canonicalKitReparseLive = [System.IO.Path]::GetFullPath($kitReparseLiveRoot)
        $kitReparseLiveGitCommands = @(
            $kitReparseGitCommands |
                Where-Object {
                    $_.WorkingDirectory.Equals($canonicalKitReparseLive, [System.StringComparison]::OrdinalIgnoreCase)
                }
        )
        $canonicalKitReparseStage = if ($kitReparseCloneTargets.Count -eq 1) {
            [System.IO.Path]::GetFullPath($kitReparseCloneTargets[0])
        } else {
            ''
        }
        $kitReparseDestructiveGitCommands = @(
            $kitReparseGitCommands |
                Where-Object { $_.Command -match '^reset --hard\b' -or $_.Command -match '^clean -fdx\b' }
        )
        $kitReparseMisroutedDestructiveGitCommands = @(
            $kitReparseDestructiveGitCommands |
                Where-Object {
                    [string]::IsNullOrWhiteSpace($canonicalKitReparseStage) -or
                    -not $_.WorkingDirectory.Equals($canonicalKitReparseStage, [System.StringComparison]::OrdinalIgnoreCase)
                }
        )
        $kitReparsePreviousLink = if ([string]::IsNullOrWhiteSpace($kitReparsePreviousPath)) {
            ''
        } else {
            Join-Path $kitReparsePreviousPath $kitReparseLinkRelative
        }
        $kitReparsePreviousLinkItem = if ([string]::IsNullOrWhiteSpace($kitReparsePreviousLink)) {
            $null
        } else {
            Get-Item -LiteralPath $kitReparsePreviousLink -Force -ErrorAction SilentlyContinue
        }
        $kitReparseOutsideHashAfter = (Get-FileHash -LiteralPath $kitReparseOutsideSentinel -Algorithm SHA256).Hash
        $kitReparseOutsideInventoryAfter = @(
            Get-ChildItem -LiteralPath $kitReparseOutsideRoot -Force -Recurse |
                Sort-Object FullName |
                ForEach-Object {
                    $relative = $_.FullName.Substring($kitReparseOutsideRoot.Length)
                    if ($_.PSIsContainer) {
                        "$relative|directory|$($_.Attributes)|$($_.CreationTimeUtc.Ticks)|$($_.LastWriteTimeUtc.Ticks)"
                    } else {
                        "$relative|file|$($_.Length)|$((Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash)|$($_.CreationTimeUtc.Ticks)|$($_.LastWriteTimeUtc.Ticks)"
                    }
                }
        ) -join "`n"
        $kitReparseEnvHashesAfter = & $getTransactionHashes $kitReparseLiveRoot
        $kitReparsePreviousManifest = if (
            -not [string]::IsNullOrWhiteSpace($kitReparsePreviousPath) -and
            (Test-Path -LiteralPath $kitReparsePreviousPath -PathType Container)
        ) {
            & $getTransactionLiveManifest $kitReparsePreviousPath
        } else {
            $null
        }

        & $recordTransactionExpectation ([string]::IsNullOrWhiteSpace($kitReparseFailureMessage)) 'Task 1A.7 valid Kit-built checkout rebuild succeeds through sibling stage' "actual='$kitReparseFailureMessage'"
        & $recordTransactionExpectation ($kitReparseCloneTargets.Count -eq 1) 'Task 1A.7 valid checkout prepares exactly one sibling stage' "targets='$($kitReparseCloneTargets -join ',')'"
        & $recordTransactionExpectation ($kitReparseLiveGitCommands.Count -eq 0) 'Task 1A.7 production executes zero Git commands in the active checkout' "commands='$(@($kitReparseLiveGitCommands | ForEach-Object { $_.Command }) -join ';')'"
        & $recordTransactionExpectation (
            $kitReparseDestructiveGitCommands.Count -ge 2 -and
            $kitReparseMisroutedDestructiveGitCommands.Count -eq 0
        ) 'Task 1A.7 every destructive Git command is confined to the unique sibling stage' "misrouted='$(@($kitReparseMisroutedDestructiveGitCommands | ForEach-Object { "$($_.Command)@$($_.WorkingDirectory)" }) -join ';')'"
        & $recordTransactionExpectation (
            -not [string]::IsNullOrWhiteSpace($kitReparsePreviousPath) -and
            (Test-Path -LiteralPath $kitReparsePreviousPath -PathType Container)
        ) 'Task 1A.7 result exposes the opaque previous checkout recovery path' "previous='$kitReparsePreviousPath'"
        & $recordTransactionExpectation (
            $null -ne $kitReparsePreviousLinkItem -and
            [bool]($kitReparsePreviousLinkItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint)
        ) 'Task 1A.7 old Kit reparse remains attached only under opaque previous' "previousLink='$kitReparsePreviousLink'"
        & $recordTransactionExpectation (
            $null -ne $kitReparsePreviousManifest -and
            $kitReparsePreviousManifest.Serialized -ceq $kitReparseLiveManifestBefore.Serialized
        ) 'Task 1A.7 opaque previous checkout exactly preserves the pre-cutover live manifest' "before='$($kitReparseLiveManifestBefore.Sha256)' previous='$($kitReparsePreviousManifest.Sha256)'"
        & $recordTransactionExpectation (-not (Test-Path -LiteralPath $kitReparseLiveLink)) 'Task 1A.7 replacement live contains no inherited Kit reparse' "liveLink='$kitReparseLiveLink'"
        & $recordTransactionExpectation ($kitReparseOutsideHashAfter -eq $kitReparseOutsideHashBefore) 'Task 1A.7 external Packman target remains SHA256-identical' "before='$kitReparseOutsideHashBefore' after='$kitReparseOutsideHashAfter'"
        & $recordTransactionExpectation ($kitReparseOutsideInventoryAfter -ceq $kitReparseOutsideInventoryBefore) 'Task 1A.7 external Packman target inventory and metadata remain identical' "before='$kitReparseOutsideInventoryBefore' after='$kitReparseOutsideInventoryAfter'"
        foreach ($relativePath in $transactionFixturePaths | Where-Object { $_ -ne 'live-sentinel.bin' }) {
            & $recordTransactionExpectation ($kitReparseEnvHashesAfter[$relativePath] -eq $kitReparseEnvHashesBefore[$relativePath]) 'Task 1A.7 preserved env remains SHA256-identical after opaque cutover' "path='$relativePath' before='$($kitReparseEnvHashesBefore[$relativePath])' after='$($kitReparseEnvHashesAfter[$relativePath])'"
        }
        & $recordTransactionExpectation ($kitReparseDeployCalls.Count -eq 1 -and $kitReparseDeployCalls[0] -eq $kitReparseLiveRoot) 'Task 1A.7 deploy runs from replacement live checkout' "deployRoots='$($kitReparseDeployCalls -join ',')'"
    } finally {
        $script:TestDeployFixedPath = $kitReparseOriginalFixedPath
        $candidateLinks = @($kitReparseLiveLink)
        if (-not [string]::IsNullOrWhiteSpace($kitReparsePreviousPath)) {
            $candidateLinks += (Join-Path $kitReparsePreviousPath $kitReparseLinkRelative)
        }
        foreach ($candidateLink in $candidateLinks | Select-Object -Unique) {
            $candidateLinkItem = Get-Item -LiteralPath $candidateLink -Force -ErrorAction SilentlyContinue
            if ($null -ne $candidateLinkItem) {
                & $removeVerifiedAssetJunction -LinkPath $candidateLink -ExpectedTarget $kitReparseOutsideRoot
            }
        }
    }

    # Task 1A.8: if a clone produces a reparse entry, strict stage validation
    # fails before service stop/cutover and the unsafe stage is retained rather
    # than passed to recursive deletion.
    $unsafeStageScenarioRoot = Join-Path $sandbox 'transaction-unsafe-stage-reparse'
    $unsafeStageLiveRoot = Join-Path $unsafeStageScenarioRoot 'live'
    $unsafeStageOutsideRoot = Join-Path $unsafeStageScenarioRoot 'outside-target'
    $unsafeStageOutsideSentinel = Join-Path $unsafeStageOutsideRoot 'sentinel.bin'
    $unsafeStageLinkRelative = 'bim-streaming-server\_repo\unsafe-stage-link'
    & $newTransactionFixture $unsafeStageLiveRoot
    New-Item -ItemType Directory -Path $unsafeStageOutsideRoot -Force | Out-Null
    [System.IO.File]::WriteAllBytes($unsafeStageOutsideSentinel, [byte[]](91, 92, 93, 250, 251, 252))
    $unsafeStageOutsideHashBefore = (Get-FileHash -LiteralPath $unsafeStageOutsideSentinel -Algorithm SHA256).Hash
    $unsafeStageLiveManifestBefore = & $getTransactionLiveManifest $unsafeStageLiveRoot
    $unsafeStageCloneTargets = New-Object 'System.Collections.Generic.List[string]'
    $unsafeStageStopAttempts = New-Object 'System.Collections.Generic.List[string]'
    $unsafeStageDeployCalls = New-Object 'System.Collections.Generic.List[string]'
    $script:unsafeStageCloneTargets = $unsafeStageCloneTargets
    $script:unsafeStageStopAttempts = $unsafeStageStopAttempts
    $script:unsafeStageDeployCalls = $unsafeStageDeployCalls
    $unsafeStageRunner = {
        param([string] $Tool, [string[]] $Arguments, [string] $WorkingDirectory)
        $commandText = $Arguments -join ' '
        if ($commandText -eq 'remote get-url origin') {
            return [pscustomobject]@{ ExitCode = 0; Output = $transactionOriginUrl }
        }
        if ($Arguments -contains 'clone') {
            $cloneInvocation = & $resolveTransactionCloneInvocation -Arguments $Arguments -ExpectedOrigin $transactionOriginUrl
            $script:unsafeStageCloneTargets.Add($cloneInvocation.Target) | Out-Null
            New-Item -ItemType Directory -Path (Join-Path $cloneInvocation.Target '.git') -Force | Out-Null
            $unsafeLink = Join-Path $cloneInvocation.Target $unsafeStageLinkRelative
            New-Item -ItemType Directory -Path (Split-Path -Parent $unsafeLink) -Force | Out-Null
            New-Item -ItemType Junction -Path $unsafeLink -Target $unsafeStageOutsideRoot -ErrorAction Stop | Out-Null
            return [pscustomobject]@{ ExitCode = 0; Output = 'prepared unsafe stage' }
        }
        return [pscustomobject]@{ ExitCode = 0; Output = 'ok' }
    }.GetNewClosure()
    $unsafeStageStopper = {
        param([string] $ServiceName, [string] $ServiceRunDir)
        $script:unsafeStageStopAttempts.Add($ServiceName) | Out-Null
    }.GetNewClosure()
    $unsafeStageDeployRunner = {
        param([string] $DeployRoot)
        $script:unsafeStageDeployCalls.Add($DeployRoot) | Out-Null
        return [pscustomobject]@{ ExitCode = 0 }
    }.GetNewClosure()
    $unsafeStageOriginalFixedPath = $script:TestDeployFixedPath
    $unsafeStageFailureMessage = $null
    try {
        $script:TestDeployFixedPath = $unsafeStageLiveRoot
        try {
            Invoke-TestDeployRebuild `
                -Build `
                -RepoRoot $rebuildRoot `
                -DeploymentPath $unsafeStageLiveRoot `
                -CommandRunner $unsafeStageRunner `
                -DeployRunner $unsafeStageDeployRunner `
                -ServiceStopper $unsafeStageStopper | Out-Null
        } catch {
            $unsafeStageFailureMessage = $_.Exception.Message
        }

        $unsafeStageRoot = if ($unsafeStageCloneTargets.Count -eq 1) { $unsafeStageCloneTargets[0] } else { '' }
        $unsafeStageLink = if ([string]::IsNullOrWhiteSpace($unsafeStageRoot)) { '' } else { Join-Path $unsafeStageRoot $unsafeStageLinkRelative }
        $unsafeStageLinkItem = if ([string]::IsNullOrWhiteSpace($unsafeStageLink)) {
            $null
        } else {
            Get-Item -LiteralPath $unsafeStageLink -Force -ErrorAction SilentlyContinue
        }
        $unsafeStageLiveManifestAfter = & $getTransactionLiveManifest $unsafeStageLiveRoot
        & $recordTransactionExpectation ($unsafeStageFailureMessage -match 'deployment path contains reparse point') 'Task 1A.8 unsafe stage is rejected by strict validation' "actual='$unsafeStageFailureMessage'"
        & $recordTransactionExpectation (
            -not [string]::IsNullOrWhiteSpace($unsafeStageRoot) -and
            (Test-Path -LiteralPath $unsafeStageRoot -PathType Container)
        ) 'Task 1A.8 unsafe stage is preserved for inspection' "stage='$unsafeStageRoot'"
        & $recordTransactionExpectation (
            $null -ne $unsafeStageLinkItem -and
            [bool]($unsafeStageLinkItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint)
        ) 'Task 1A.8 preserved stage retains its reparse evidence' "link='$unsafeStageLink'"
        if (-not [string]::IsNullOrWhiteSpace($unsafeStageRoot)) {
            & $recordRetainedStageWithoutEnv -StageRoot $unsafeStageRoot -Behavior 'Task 1A.8 unsafe stage'
        }
        & $recordTransactionExpectation ($unsafeStageLiveManifestAfter.Serialized -ceq $unsafeStageLiveManifestBefore.Serialized) 'Task 1A.8 unsafe stage leaves live checkout byte-identical' "before='$($unsafeStageLiveManifestBefore.Sha256)' after='$($unsafeStageLiveManifestAfter.Sha256)'"
        & $recordTransactionExpectation ($unsafeStageStopAttempts.Count -eq 0 -and $unsafeStageDeployCalls.Count -eq 0) 'Task 1A.8 unsafe stage fails before service stop or deploy' "stops=$($unsafeStageStopAttempts.Count) deploys=$($unsafeStageDeployCalls.Count)"
        & $recordTransactionExpectation ((Get-FileHash -LiteralPath $unsafeStageOutsideSentinel -Algorithm SHA256).Hash -eq $unsafeStageOutsideHashBefore) 'Task 1A.8 unsafe stage rejection preserves external target bytes' "before='$unsafeStageOutsideHashBefore'"
    } finally {
        $script:TestDeployFixedPath = $unsafeStageOriginalFixedPath
        if ($unsafeStageCloneTargets.Count -eq 1) {
            $unsafeStageRoot = $unsafeStageCloneTargets[0]
            $unsafeStageLink = Join-Path $unsafeStageRoot $unsafeStageLinkRelative
            if (Test-Path -LiteralPath $unsafeStageLink) {
                & $removeVerifiedAssetJunction -LinkPath $unsafeStageLink -ExpectedTarget $unsafeStageOutsideRoot
            }
            if (Test-Path -LiteralPath $unsafeStageRoot -PathType Container) {
                Remove-Item -LiteralPath $unsafeStageRoot -Recurse -Force
            }
        }
    }

    # Task 1A.9: post-cutover deploy failures do not rename the filesystem back.
    # Both the structured nonzero result and thrown-error path expose the exact
    # retained previous checkout for explicit operator recovery.
    $postCutoverProcessEnvNames = @(
        'EDGE_SITE_ID',
        'EDGE_RUNTIME_DATA_ROOT',
        'RUNTIME_STORAGE_ROOT',
        'STORAGE_HOST_ROOT',
        'STREAMING_CONVERSION_ARTIFACTS_ROOT',
        'CONVERSION_LEDGER_STORE_PATH',
        'ARTIFACT_HEALTH_LEDGER_STORE_PATH'
    )
    foreach ($postCutoverMode in @('nonzero', 'throw')) {
        $postCutoverScenarioRoot = Join-Path $sandbox "transaction-post-cutover-$postCutoverMode"
        $postCutoverLiveRoot = Join-Path $postCutoverScenarioRoot 'live'
        & $newTransactionFixture $postCutoverLiveRoot
        $postCutoverLiveManifestBefore = & $getTransactionLiveManifest $postCutoverLiveRoot
        $postCutoverMarkerContent = "scenario=post-cutover-$postCutoverMode`nmode=OriginMain`noriginUrlSha256=$transactionOriginUrlHash`ncommit=$transactionOriginCommit`n"
        $postCutoverCloneTargets = New-Object 'System.Collections.Generic.List[string]'
        $postCutoverDeployCalls = New-Object 'System.Collections.Generic.List[string]'
        $script:postCutoverCloneTargets = $postCutoverCloneTargets
        $script:postCutoverDeployCalls = $postCutoverDeployCalls
        $postCutoverRunner = {
            param([string] $Tool, [string[]] $Arguments, [string] $WorkingDirectory)
            $commandText = $Arguments -join ' '
            if ($commandText -eq 'remote get-url origin') {
                return [pscustomobject]@{ ExitCode = 0; Output = $transactionOriginUrl }
            }
            if ($Arguments -contains 'clone') {
                $cloneInvocation = & $resolveTransactionCloneInvocation -Arguments $Arguments -ExpectedOrigin $transactionOriginUrl
                $script:postCutoverCloneTargets.Add($cloneInvocation.Target) | Out-Null
                & $newPreparedTransactionStage `
                    -Target $cloneInvocation.Target `
                    -ScenarioRoot $postCutoverScenarioRoot `
                    -LiveRoot $postCutoverLiveRoot `
                    -MarkerContent $postCutoverMarkerContent `
                    -IncludeDeployScript $true | Out-Null
                New-Item -ItemType Directory -Path (Join-Path $cloneInvocation.Target 'docs\plans\assets') -Force | Out-Null
                New-Item -ItemType Directory -Path (Join-Path $cloneInvocation.Target 'docs\plans\uploads') -Force | Out-Null
                New-Item -ItemType Directory -Path (Join-Path $cloneInvocation.Target 'web-viewer-sample\public') -Force | Out-Null
                [System.IO.File]::WriteAllBytes((Join-Path $cloneInvocation.Target 'docs\plans\assets\vp-post-cutover.png'), [byte[]](1, 3, 5, 7))
                [System.IO.File]::WriteAllBytes((Join-Path $cloneInvocation.Target 'docs\plans\uploads\concept-post-cutover.png'), [byte[]](2, 4, 6, 8))
                return [pscustomobject]@{ ExitCode = 0; Output = 'prepared post-cutover failure stage' }
            }
            if ($commandText -eq 'rev-parse --short HEAD') {
                return [pscustomobject]@{ ExitCode = 0; Output = $transactionOriginCommit.Substring(0, 7) }
            }
            if ($commandText -eq 'status --short') {
                return [pscustomobject]@{ ExitCode = 0; Output = '' }
            }
            if ($commandText -eq 'rev-parse origin/main') {
                return [pscustomobject]@{ ExitCode = 0; Output = $transactionOriginCommit }
            }
            return [pscustomobject]@{ ExitCode = 0; Output = 'ok' }
        }.GetNewClosure()
        $postCutoverDeployRunner = {
            param([string] $DeployRoot)
            $script:postCutoverDeployCalls.Add($DeployRoot) | Out-Null
            if ($postCutoverMode -eq 'throw') {
                throw 'injected post-cutover deploy exception'
            }
            return [pscustomobject]@{ ExitCode = 37 }
        }.GetNewClosure()
        $postCutoverOriginalFixedPath = $script:TestDeployFixedPath
        $postCutoverResult = $null
        $postCutoverFailureMessage = $null
        $postCutoverOriginalProcessEnv = @{}
        $postCutoverExpectedProcessEnv = @{}
        for ($processEnvIndex = 0; $processEnvIndex -lt $postCutoverProcessEnvNames.Count; $processEnvIndex++) {
            $processEnvName = $postCutoverProcessEnvNames[$processEnvIndex]
            $postCutoverOriginalProcessEnv[$processEnvName] = [Environment]::GetEnvironmentVariable($processEnvName, 'Process')
            $expectedProcessEnvValue = if (($processEnvIndex % 2) -eq 0) {
                "pre-$postCutoverMode-$processEnvIndex"
            } else {
                $null
            }
            $postCutoverExpectedProcessEnv[$processEnvName] = $expectedProcessEnvValue
            if ($null -eq $expectedProcessEnvValue) {
                Remove-Item -LiteralPath "Env:$processEnvName" -ErrorAction SilentlyContinue
            } else {
                [Environment]::SetEnvironmentVariable($processEnvName, $expectedProcessEnvValue, 'Process')
            }
        }
        $postCutoverProcessEnvRestoredExactly = $false
        try {
            $script:TestDeployFixedPath = $postCutoverLiveRoot
            try {
                $postCutoverResult = Invoke-TestDeployRebuild `
                    -Build `
                    -RepoRoot $rebuildRoot `
                    -DeploymentPath $postCutoverLiveRoot `
                    -CommandRunner $postCutoverRunner `
                    -DeployRunner $postCutoverDeployRunner `
                    -ServiceStopper $noopStopper
            } catch {
                $postCutoverFailureMessage = $_.Exception.Message
            }
        } finally {
            $script:TestDeployFixedPath = $postCutoverOriginalFixedPath
            $postCutoverProcessEnvRestoredExactly = $true
            foreach ($processEnvName in $postCutoverProcessEnvNames) {
                $actualProcessEnvValue = [Environment]::GetEnvironmentVariable($processEnvName, 'Process')
                if ($actualProcessEnvValue -cne $postCutoverExpectedProcessEnv[$processEnvName]) {
                    $postCutoverProcessEnvRestoredExactly = $false
                }
                $originalProcessEnvValue = $postCutoverOriginalProcessEnv[$processEnvName]
                if ($null -eq $originalProcessEnvValue) {
                    Remove-Item -LiteralPath "Env:$processEnvName" -ErrorAction SilentlyContinue
                } else {
                    [Environment]::SetEnvironmentVariable(
                        $processEnvName,
                        $originalProcessEnvValue,
                        'Process'
                    )
                }
            }
        }

        $postCutoverPreviousPath = if ($null -ne $postCutoverResult) {
            [string]$postCutoverResult.PreviousPath
        } elseif ($postCutoverFailureMessage -match "previous checkout retained at '([^']+)'") {
            [string]$Matches[1]
        } else {
            ''
        }
        $postCutoverPreviousManifest = if (
            -not [string]::IsNullOrWhiteSpace($postCutoverPreviousPath) -and
            (Test-Path -LiteralPath $postCutoverPreviousPath -PathType Container)
        ) {
            & $getTransactionLiveManifest $postCutoverPreviousPath
        } else {
            $null
        }
        $postCutoverActiveMarker = Join-Path $postCutoverLiveRoot $transactionProvenanceMarker
        $postCutoverPreviousSha = if ($null -eq $postCutoverPreviousManifest) { '<missing>' } else { [string]$postCutoverPreviousManifest.Sha256 }
        $postCutoverExitCode = if ($null -eq $postCutoverResult) { '<none>' } else { [string]$postCutoverResult.DeployExitCode }

        if ($postCutoverMode -eq 'throw') {
            & $recordTransactionExpectation (
                $postCutoverFailureMessage -match 'injected post-cutover deploy exception' -and
                $postCutoverFailureMessage -match 'previous checkout retained at'
            ) 'Task 1A.9 thrown deploy error includes failure and recovery path' "actual='$postCutoverFailureMessage'"
            & $recordTransactionExpectation ($null -eq $postCutoverResult) 'Task 1A.9 thrown deploy error returns no false success result' "result='$postCutoverResult'"
        } else {
            & $recordTransactionExpectation (
                $null -ne $postCutoverResult -and
                $postCutoverResult.DeployExitCode -eq 37
            ) 'Task 1A.9 nonzero deploy exit is returned without false success' "exit='$postCutoverExitCode'"
            & $recordTransactionExpectation ([string]::IsNullOrWhiteSpace($postCutoverFailureMessage)) 'Task 1A.9 nonzero deploy exit does not masquerade as a PowerShell exception' "actual='$postCutoverFailureMessage'"
        }
        & $recordTransactionExpectation $postCutoverProcessEnvRestoredExactly 'Task 1A.9 post-cutover failure restores every process env value exactly, including unset values' "mode='$postCutoverMode'"
        & $recordTransactionExpectation (
            -not [string]::IsNullOrWhiteSpace($postCutoverPreviousPath) -and
            $null -ne $postCutoverPreviousManifest -and
            $postCutoverPreviousManifest.Serialized -ceq $postCutoverLiveManifestBefore.Serialized
        ) 'Task 1A.9 previous checkout remains exact after post-cutover failure' "mode='$postCutoverMode' before='$($postCutoverLiveManifestBefore.Sha256)' previous='$postCutoverPreviousSha'"
        & $recordTransactionExpectation (
            (Test-Path -LiteralPath $postCutoverActiveMarker -PathType Leaf) -and
            $postCutoverDeployCalls.Count -eq 1 -and
            $postCutoverDeployCalls[0] -eq $postCutoverLiveRoot
        ) 'Task 1A.9 failed deployment generation remains active without unsafe rename-back' "mode='$postCutoverMode' marker='$postCutoverActiveMarker' calls='$($postCutoverDeployCalls -join ',')'"
    }

    if ($transactionRedFailures.Count -gt 0) {
        throw "Task 1A wished-for RED behaviors unmet:$([Environment]::NewLine) - $($transactionRedFailures -join "$([Environment]::NewLine) - ")"
    }

    # Task 1B1 RED: path safety and the stable same-parent rebuild lock must be
    # enforced before env backup, clone/stage, service stop, or deploy.  The
    # junction fixtures below are real Windows reparse points.  Their cleanup
    # resolves and verifies both link and target inside this temp sandbox, then
    # deletes only the link itself (never recursively through the junction).
    # Redirect the library's fixed-path variable into temp for this RED block as
    # an additional safety net against a partial helper ignoring its test path.
    $task1B1OriginalFixedPath = $script:TestDeployFixedPath
    $script:TestDeployFixedPath = Join-Path $sandbox 'task-1b1-fixed-path-override'
    $task1B1RedFailures = New-Object 'System.Collections.Generic.List[string]'
    $task1B1ScenariosExecuted = New-Object 'System.Collections.Generic.List[string]'
    $task1B1FixtureReparsePaths = New-Object 'System.Collections.Generic.List[string]'

    # Test-only Windows file identity.  Creation timestamps are not proof of the
    # same NTFS file object, so the lock test compares volume serial + file index
    # from GetFileInformationByHandle before and after reacquisition.
    if ([System.Environment]::OSVersion.Platform -ne [System.PlatformID]::Win32NT) {
        throw 'Task 1B1 Windows file identity is unavailable: tests require Windows'
    }
    if ($null -eq ('Task1B1NativeFileIdentity' -as [type])) {
        try {
            Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;

public static class Task1B1NativeFileIdentity
{
    [StructLayout(LayoutKind.Sequential)]
    private struct BY_HANDLE_FILE_INFORMATION
    {
        public uint FileAttributes;
        public System.Runtime.InteropServices.ComTypes.FILETIME CreationTime;
        public System.Runtime.InteropServices.ComTypes.FILETIME LastAccessTime;
        public System.Runtime.InteropServices.ComTypes.FILETIME LastWriteTime;
        public uint VolumeSerialNumber;
        public uint FileSizeHigh;
        public uint FileSizeLow;
        public uint NumberOfLinks;
        public uint FileIndexHigh;
        public uint FileIndexLow;
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GetFileInformationByHandle(
        SafeFileHandle hFile,
        out BY_HANDLE_FILE_INFORMATION fileInformation);

    public static string Get(SafeFileHandle handle)
    {
        if (handle == null || handle.IsInvalid || handle.IsClosed)
            throw new InvalidOperationException("file handle is not usable");

        BY_HANDLE_FILE_INFORMATION info;
        if (!GetFileInformationByHandle(handle, out info))
            throw new Win32Exception(Marshal.GetLastWin32Error(), "GetFileInformationByHandle failed");

        return string.Format(
            "{0:X8}:{1:X8}{2:X8}",
            info.VolumeSerialNumber,
            info.FileIndexHigh,
            info.FileIndexLow);
    }
}
'@ -ErrorAction Stop
        } catch {
            throw "Task 1B1 Windows file identity is unavailable: $($_.Exception.Message)"
        }
    }
    if ($null -eq ('Task1B1NativeFileIdentity' -as [type])) {
        throw 'Task 1B1 Windows file identity is unavailable after Add-Type'
    }
    if ($null -eq ('Task1B1CountingLockOwner' -as [type])) {
        try {
            Add-Type -TypeDefinition @'
using System;
using System.IO;
using Microsoft.Win32.SafeHandles;

public sealed class Task1B1CountingLockOwner : IDisposable
{
    private readonly FileStream stream;

    public Task1B1CountingLockOwner(string path)
    {
        stream = File.Open(path, FileMode.Open, FileAccess.ReadWrite, FileShare.None);
    }

    public int DisposeCount { get; private set; }
    public SafeFileHandle SafeFileHandle { get { return stream.SafeFileHandle; } }
    public bool IsHandleClosed { get { return stream.SafeFileHandle.IsClosed; } }

    public void Dispose()
    {
        DisposeCount++;
        if (DisposeCount > 1)
            throw new InvalidOperationException("Task1B1CountingLockOwner disposed more than once");
        stream.Dispose();
    }
}
'@ -ErrorAction Stop
        } catch {
            throw "Task 1B1 counting lock owner is unavailable: $($_.Exception.Message)"
        }
    }
    if ($null -eq ('Task1B1CountingLockOwner' -as [type])) {
        throw 'Task 1B1 counting lock owner is unavailable after Add-Type'
    }

    $recordTask1B1Expectation = {
        param(
            [Parameter(Mandatory = $true)][bool] $Condition,
            [Parameter(Mandatory = $true)][string] $Behavior,
            [Parameter(Mandatory = $true)][string] $Details
        )

        if (-not $Condition) {
            $task1B1RedFailures.Add("$Behavior -- $Details") | Out-Null
        }
    }.GetNewClosure()
    $getTask1B1PathEntry = {
        param([Parameter(Mandatory = $true)][string] $Path)

        return Get-Item -LiteralPath $Path -Force -ErrorAction SilentlyContinue
    }
    $removeVerifiedTempJunction = {
        param(
            [Parameter(Mandatory = $true)][string] $LinkPath,
            [Parameter(Mandatory = $true)][string] $ExpectedTarget
        )

        $canonicalSandbox = ([System.IO.Path]::GetFullPath($sandbox)).TrimEnd($transactionPathTrimChars)
        $canonicalLink = ([System.IO.Path]::GetFullPath($LinkPath)).TrimEnd($transactionPathTrimChars)
        $canonicalExpectedTarget = ([System.IO.Path]::GetFullPath($ExpectedTarget)).TrimEnd($transactionPathTrimChars)
        $sandboxPrefix = "$canonicalSandbox$([System.IO.Path]::DirectorySeparatorChar)"
        foreach ($candidate in @($canonicalLink, $canonicalExpectedTarget)) {
            if (-not $candidate.StartsWith($sandboxPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
                throw "Task 1B1 junction cleanup refused path outside sandbox: '$candidate'"
            }
        }
        if ($canonicalLink.Equals($canonicalExpectedTarget, [System.StringComparison]::OrdinalIgnoreCase)) {
            throw 'Task 1B1 junction cleanup refused identical link and target paths'
        }

        $linkItem = Get-Item -LiteralPath $canonicalLink -Force -ErrorAction Stop
        if (-not [bool]($linkItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint)) {
            throw "Task 1B1 junction cleanup refused non-reparse path: '$canonicalLink'"
        }
        $resolvedTargetPath = Resolve-TestReparseTargetPath -LinkItem $linkItem
        if ([string]::IsNullOrWhiteSpace($resolvedTargetPath)) {
            throw "Task 1B1 junction cleanup could not resolve target: '$canonicalLink'"
        }
        $canonicalResolvedTarget = $resolvedTargetPath.TrimEnd($transactionPathTrimChars)
        if (-not $canonicalResolvedTarget.Equals($canonicalExpectedTarget, [System.StringComparison]::OrdinalIgnoreCase)) {
            throw "Task 1B1 junction cleanup target mismatch. expected='$canonicalExpectedTarget' actual='$canonicalResolvedTarget'"
        }

        [System.IO.Directory]::Delete($canonicalLink, $false)
        $remainingLinkItem = & $getTask1B1PathEntry -Path $canonicalLink
        if ($null -ne $remainingLinkItem) {
            throw "Task 1B1 junction cleanup failed to remove link: '$canonicalLink'"
        }
        $remainingTargetItem = Get-Item -LiteralPath $canonicalExpectedTarget -Force -ErrorAction Stop
        if (-not $remainingTargetItem.PSIsContainer) {
            throw "Task 1B1 junction cleanup removed or lost target: '$canonicalExpectedTarget'"
        }
    }.GetNewClosure()
    $newPathBoundaryDoubles = {
        $originUrl = $transactionOriginUrl
        $commands = New-Object 'System.Collections.Generic.List[string]'
        $cloneTargets = New-Object 'System.Collections.Generic.List[string]'
        $stoppedServices = New-Object 'System.Collections.Generic.List[string]'
        $deployCalls = New-Object 'System.Collections.Generic.List[string]'
        $runner = {
            param([string] $Tool, [string[]] $Arguments, [string] $WorkingDirectory)
            $commandText = $Arguments -join ' '
            $commands.Add($commandText) | Out-Null
            if ($commandText -eq 'remote get-url origin') {
                return [pscustomobject]@{ ExitCode = 0; Output = $originUrl }
            }
            if ($Arguments -contains 'clone') {
                $cloneTargets.Add([System.IO.Path]::GetFullPath([string]$Arguments[-1])) | Out-Null
                return [pscustomobject]@{ ExitCode = 97; Output = 'path-safety rejection must precede clone' }
            }
            return [pscustomobject]@{ ExitCode = 0; Output = 'ok' }
        }.GetNewClosure()
        $stopper = {
            param([string] $ServiceName, [string] $ServiceRunDir)
            $stoppedServices.Add($ServiceName) | Out-Null
        }.GetNewClosure()
        $deployRunner = {
            param([string] $DeployRoot)
            $deployCalls.Add($DeployRoot) | Out-Null
            return [pscustomobject]@{ ExitCode = 0 }
        }.GetNewClosure()

        return [pscustomobject]@{
            Commands = $commands
            CloneTargets = $cloneTargets
            StoppedServices = $stoppedServices
            DeployCalls = $deployCalls
            Runner = $runner
            Stopper = $stopper
            DeployRunner = $deployRunner
        }
    }.GetNewClosure()
    $getTask1B1RawLockHandle = {
        param([Parameter(Mandatory = $true)] $Result)

        $handle = $null
        if ($Result -is [System.IO.Stream]) {
            $handle = $Result
        } elseif ($null -ne $Result.PSObject.Properties['Handle']) {
            $handle = $Result.Handle
        } elseif ($null -ne $Result.PSObject.Properties['Stream']) {
            $handle = $Result.Stream
        }
        if ($null -eq $handle -or $handle -isnot [System.IDisposable]) {
            throw 'Enter-TestDeployRebuildLock did not return a disposable lock handle'
        }

        return $handle
    }
    $normalizeLockResource = {
        param([Parameter(Mandatory = $true)] $Result)

        $handle = & $getTask1B1RawLockHandle $Result
        $declaredLockPath = $null
        if ($null -ne $Result.PSObject.Properties['LockPath']) {
            $declaredLockPath = [string]$Result.LockPath
        }
        $handleLockPath = if ($null -ne $handle.PSObject.Properties['Name']) { [string]$handle.Name } else { $null }
        if (-not [string]::IsNullOrWhiteSpace($declaredLockPath) -and -not [string]::IsNullOrWhiteSpace($handleLockPath)) {
            $canonicalDeclaredPath = [System.IO.Path]::GetFullPath($declaredLockPath)
            $canonicalHandlePath = [System.IO.Path]::GetFullPath($handleLockPath)
            if (-not $canonicalDeclaredPath.Equals($canonicalHandlePath, [System.StringComparison]::OrdinalIgnoreCase)) {
                throw "Enter-TestDeployRebuildLock returned mismatched handle and lock paths. declared='$canonicalDeclaredPath' handle='$canonicalHandlePath'"
            }
        }
        $lockPath = if (-not [string]::IsNullOrWhiteSpace($handleLockPath)) { $handleLockPath } else { $declaredLockPath }
        if ([string]::IsNullOrWhiteSpace($lockPath)) {
            throw 'Enter-TestDeployRebuildLock did not expose the lock file path'
        }
        $canonicalLockPath = [System.IO.Path]::GetFullPath($lockPath)

        return [pscustomobject]@{
            Handle = $handle
            LockPath = $canonicalLockPath
        }
    }
    $assertTestLockResourceWithinScenario = {
        param(
            [Parameter(Mandatory = $true)] $Resource,
            [Parameter(Mandatory = $true)][string] $ExpectedParent,
            [Parameter(Mandatory = $true)][string] $LivePath,
            $ProbeCounters = $null
        )

        $canonicalSandbox = ([System.IO.Path]::GetFullPath($sandbox)).TrimEnd($transactionPathTrimChars)
        $canonicalExpectedParent = ([System.IO.Path]::GetFullPath($ExpectedParent)).TrimEnd($transactionPathTrimChars)
        $canonicalLockPath = ([System.IO.Path]::GetFullPath($Resource.LockPath)).TrimEnd($transactionPathTrimChars)
        $canonicalLockParent = ([System.IO.Path]::GetFullPath((Split-Path -Parent $canonicalLockPath))).TrimEnd($transactionPathTrimChars)
        $canonicalLivePath = ([System.IO.Path]::GetFullPath($LivePath)).TrimEnd($transactionPathTrimChars)
        $sandboxPrefix = "$canonicalSandbox$([System.IO.Path]::DirectorySeparatorChar)"

        # Check only canonical strings until the candidate is proven to be the
        # exact temp parent.  Never Test-Path or mutate an out-of-bound result.
        $insideSandbox = $canonicalExpectedParent.StartsWith($sandboxPrefix, [System.StringComparison]::OrdinalIgnoreCase)
        $sameParent = $canonicalLockParent.Equals($canonicalExpectedParent, [System.StringComparison]::OrdinalIgnoreCase)
        $distinctFromLive = -not $canonicalLockPath.Equals($canonicalLivePath, [System.StringComparison]::OrdinalIgnoreCase)
        if (-not $insideSandbox -or -not $sameParent -or -not $distinctFromLive) {
            throw "Enter-TestDeployRebuildLock returned unsafe lock path. lock='$canonicalLockPath' expectedParent='$canonicalExpectedParent'"
        }
        if ($null -ne $ProbeCounters) {
            $ProbeCounters.MetadataProbeCount = [int]$ProbeCounters.MetadataProbeCount + 1
        }
        if (-not (Test-Path -LiteralPath $canonicalLockPath -PathType Leaf)) {
            throw "Enter-TestDeployRebuildLock lock path is not a temp file: '$canonicalLockPath'"
        }

        return $Resource
    }.GetNewClosure()
    $newTask1B1ProbeCounters = {
        return [pscustomobject]@{
            FallbackCount = 0
            MetadataProbeCount = 0
            DeleteProbeCount = 0
        }
    }
    $acquireTask1B1LockResource = {
        param(
            [Parameter(Mandatory = $true)][scriptblock] $AcquireFactory,
            [Parameter(Mandatory = $true)][bool] $AcquireFactoryAvailable,
            [scriptblock] $FallbackFactory = $null,
            [Parameter(Mandatory = $true)][string] $DeploymentPath,
            [Parameter(Mandatory = $true)][string] $ExpectedParent,
            [Parameter(Mandatory = $true)][string] $LivePath,
            $ProbeCounters = $null
        )

        $owner = $null
        $candidateResource = $null
        $officialResource = $null
        $ownershipTransferred = $false
        $usedFallback = $false
        try {
            $factory = $AcquireFactory
            if (-not $AcquireFactoryAvailable) {
                if ($null -eq $FallbackFactory) {
                    throw 'Enter-TestDeployRebuildLock is unavailable and no safe test fallback was supplied'
                }
                $factory = $FallbackFactory
                $usedFallback = $true
                if ($null -ne $ProbeCounters) {
                    $ProbeCounters.FallbackCount = [int]$ProbeCounters.FallbackCount + 1
                }
            }

            $rawResult = & $factory -DeploymentPath $DeploymentPath
            $owner = & $getTask1B1RawLockHandle $rawResult
            $candidateResource = & $normalizeLockResource $rawResult
            $validatedResource = & $assertTestLockResourceWithinScenario -Resource $candidateResource -ExpectedParent $ExpectedParent -LivePath $LivePath -ProbeCounters $ProbeCounters
            $officialResource = $validatedResource
            $candidateResource = $null
            $owner = $null
            $ownershipTransferred = $true

            return [pscustomobject]@{
                Resource = $officialResource
                ByHelper = -not $usedFallback
                UsedFallback = $usedFallback
            }
        } finally {
            if (-not $ownershipTransferred -and $null -ne $owner) {
                $owner.Dispose()
                $owner = $null
            }
        }
    }.GetNewClosure()
    $getTask1B1ParentInventory = {
        param([Parameter(Mandatory = $true)][string] $ParentPath)

        $entries = foreach ($item in @(Get-ChildItem -LiteralPath $ParentPath -Force | Sort-Object Name)) {
            $kind = if ($item.PSIsContainer) { 'directory' } else { 'file' }
            $length = if ($item.PSIsContainer) { '-' } else { [string]$item.Length }
            "$($item.Name)|$kind|$length|$($item.Attributes)"
        }
        return @($entries) -join "`n"
    }
    $getTask1B1ScenarioManifest = {
        param([Parameter(Mandatory = $true)][string] $Root)

        $canonicalSandbox = ([System.IO.Path]::GetFullPath($sandbox)).TrimEnd($transactionPathTrimChars)
        $canonicalRoot = ([System.IO.Path]::GetFullPath($Root)).TrimEnd($transactionPathTrimChars)
        $sandboxPrefix = "$canonicalSandbox$([System.IO.Path]::DirectorySeparatorChar)"
        if (-not $canonicalRoot.StartsWith($sandboxPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
            throw "Task 1B1 scenario manifest refused root outside sandbox: '$canonicalRoot'"
        }

        $entries = New-Object 'System.Collections.Generic.List[string]'
        $pendingDirectories = New-Object 'System.Collections.Generic.Queue[string]'
        $pendingDirectories.Enqueue($canonicalRoot)
        while ($pendingDirectories.Count -gt 0) {
            $directory = $pendingDirectories.Dequeue()
            foreach ($item in @(Get-ChildItem -LiteralPath $directory -Force | Sort-Object FullName)) {
                $canonicalItem = [System.IO.Path]::GetFullPath($item.FullName)
                $relativePath = $canonicalItem.Substring($canonicalRoot.Length).TrimStart($transactionPathTrimChars)
                $isReparse = [bool]($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint)
                if ($isReparse) {
                    $resolvedTarget = Resolve-TestReparseTargetPath -LinkItem $item
                    $resolvedMarker = if ([string]::IsNullOrWhiteSpace($resolvedTarget)) {
                        '<unresolved>'
                    } else {
                        $resolvedTarget
                    }
                    $entries.Add("$relativePath|reparse|$($item.Attributes)|$resolvedMarker") | Out-Null
                    continue
                }
                if ($item.PSIsContainer) {
                    $entries.Add("$relativePath|directory|$($item.Attributes)|-") | Out-Null
                    $pendingDirectories.Enqueue($canonicalItem)
                    continue
                }

                $hash = (Get-FileHash -LiteralPath $canonicalItem -Algorithm SHA256).Hash
                $entries.Add("$relativePath|file|$($item.Length)|$hash") | Out-Null
            }
        }

        $serialized = @($entries.ToArray() | Sort-Object) -join "`n"
        return [pscustomobject]@{
            Serialized = $serialized
            Sha256 = (& $getTransactionBytesHash -Bytes ([System.Text.Encoding]::UTF8.GetBytes($serialized)))
        }
    }.GetNewClosure()
    $getTask1B1TransactionResidue = {
        param(
            [Parameter(Mandatory = $true)][string] $ParentPath,
            [Parameter(Mandatory = $true)][string] $LiveLeaf
        )

        return @(Get-ChildItem -LiteralPath $ParentPath -Force | Where-Object {
            $_.Name -like ".$LiveLeaf.rebuild-stage-*" -or
            $_.Name -like ".$LiveLeaf.rebuild-previous-*"
        })
    }
    $getTask1B1FileIdentity = {
        param([Parameter(Mandatory = $true)] $Handle)

        if ($null -eq $Handle.PSObject.Properties['SafeFileHandle']) {
            throw 'Task 1B1 Windows file identity requires a SafeFileHandle'
        }
        try {
            return [Task1B1NativeFileIdentity]::Get($Handle.SafeFileHandle)
        } catch {
            throw "Task 1B1 Windows file identity lookup failed: $($_.Exception.Message)"
        }
    }
    $unwrapTask1B1IOException = {
        param([Parameter(Mandatory = $true)][System.Exception] $Exception)

        $candidate = $Exception
        while ($candidate -isnot [System.IO.IOException] -and $null -ne $candidate.InnerException) {
            $candidate = $candidate.InnerException
        }
        return $candidate
    }
    $getTask1B1SharingViolationEvidence = {
        param($Exception)

        $isIOException = $Exception -is [System.IO.IOException]
        $hresult = if ($null -eq $Exception) { 0 } else { [int]$Exception.HResult }
        $lowCode = $hresult -band 0xFFFF
        return [pscustomobject]@{
            IsIOException = $isIOException
            Type = $(if ($null -eq $Exception) { '<none>' } else { $Exception.GetType().FullName })
            HResult = $hresult
            LowCode = $lowCode
            IsSharingViolation = $isIOException -and $hresult -eq -2147024864 -and $lowCode -eq 32
        }
    }

    # Regression for the shared acquire -> normalize -> validate -> official or
    # fallback decision.  The malformed factory returns a valid counted owner
    # but lies about LockPath, naming a pre-existing sibling sentinel outside
    # this sandbox.  Validation must reject before metadata/delete probes and
    # the shared acquisition finally must dispose the candidate exactly once.
    $malformedLockScenario = Join-Path $sandbox 'task-1b1-malformed-lock-helper'
    New-Item -ItemType Directory -Path $malformedLockScenario -Force | Out-Null
    $malformedCandidatePath = Join-Path $malformedLockScenario 'candidate-owner.bin'
    [System.IO.File]::WriteAllBytes($malformedCandidatePath, [byte[]](2, 4, 6, 8, 10, 12))
    $malformedCandidateCreationTime = [DateTime]::SpecifyKind([datetime]'2002-03-04T05:06:07', [DateTimeKind]::Utc)
    [System.IO.File]::SetCreationTimeUtc($malformedCandidatePath, $malformedCandidateCreationTime)
    $malformedManifestBefore = & $getTask1B1ScenarioManifest $malformedLockScenario
    $malformedCandidateHashBefore = (Get-FileHash -LiteralPath $malformedCandidatePath -Algorithm SHA256).Hash
    $malformedCandidateCreationBefore = [System.IO.File]::GetCreationTimeUtc($malformedCandidatePath)

    $malformedOutsideParent = Join-Path ([System.IO.Path]::GetDirectoryName([System.IO.Path]::GetFullPath($sandbox))) ".task-1b1-outside-$([guid]::NewGuid().ToString('N'))"
    $malformedOutsideSentinel = Join-Path $malformedOutsideParent 'pre-existing-lock-sentinel.bin'
    New-Item -ItemType Directory -Path $malformedOutsideParent -ErrorAction Stop | Out-Null
    [System.IO.File]::WriteAllBytes($malformedOutsideSentinel, [byte[]](91, 92, 93, 200, 201, 202))
    $malformedOwnerState = [pscustomobject]@{ Owner = $null; WasValid = $false }
    $malformedOfficialResource = $null
    $malformedOutsideGuard = $null
    $malformedOutsideReopen = $null
    try {
    $malformedOutsideCreationTime = [DateTime]::SpecifyKind([datetime]'2003-04-05T06:07:08', [DateTimeKind]::Utc)
    $malformedOutsideLastWriteTime = [DateTime]::SpecifyKind([datetime]'2004-05-06T07:08:09', [DateTimeKind]::Utc)
    [System.IO.File]::SetCreationTimeUtc($malformedOutsideSentinel, $malformedOutsideCreationTime)
    [System.IO.File]::SetLastWriteTimeUtc($malformedOutsideSentinel, $malformedOutsideLastWriteTime)
    $malformedOutsideBytesBefore = [System.IO.File]::ReadAllBytes($malformedOutsideSentinel)
    $malformedOutsideHashBefore = (Get-FileHash -LiteralPath $malformedOutsideSentinel -Algorithm SHA256).Hash
    $malformedOutsideCreationBefore = [System.IO.File]::GetCreationTimeUtc($malformedOutsideSentinel)
    $malformedOutsideLastWriteBefore = [System.IO.File]::GetLastWriteTimeUtc($malformedOutsideSentinel)
    $malformedOutsideInventoryBefore = & $getTask1B1ParentInventory $malformedOutsideParent

    $malformedOwnerState = [pscustomobject]@{ Owner = $null; WasValid = $false }
    $malformedProbeCounters = & $newTask1B1ProbeCounters
    $malformedFallbackState = [pscustomobject]@{ Calls = 0 }
    $malformedAcquireResult = $null
    $malformedOfficialResource = $null
    $malformedOfficialAssigned = $false
    $malformedValidationMessage = $null
    $malformedOutsideGuard = $null
    $malformedOutsideIdentityBefore = $null
    $malformedOutsideIdentityWhileHeld = $null
    $malformedOutsideIdentityAfter = $null
    $malformedFakeFactory = {
        param([string] $DeploymentPath)
        $malformedOwnerState.Owner = [Task1B1CountingLockOwner]::new($malformedCandidatePath)
        $malformedOwnerState.WasValid = -not $malformedOwnerState.Owner.SafeFileHandle.IsInvalid -and -not $malformedOwnerState.Owner.SafeFileHandle.IsClosed
        return [pscustomobject]@{
            Handle = $malformedOwnerState.Owner
            LockPath = $malformedOutsideSentinel
        }
    }.GetNewClosure()
    $malformedForbiddenFallbackFactory = {
        param([string] $DeploymentPath)
        $malformedFallbackState.Calls = [int]$malformedFallbackState.Calls + 1
        throw 'malformed helper validation must never enter fallback'
    }.GetNewClosure()

    try {
        $malformedOutsideGuard = [System.IO.File]::Open(
            $malformedOutsideSentinel,
            [System.IO.FileMode]::Open,
            [System.IO.FileAccess]::ReadWrite,
            [System.IO.FileShare]::None
        )
        $malformedOutsideIdentityBefore = & $getTask1B1FileIdentity $malformedOutsideGuard
        try {
            $malformedAcquireResult = & $acquireTask1B1LockResource -AcquireFactory $malformedFakeFactory -AcquireFactoryAvailable $true -FallbackFactory $malformedForbiddenFallbackFactory -DeploymentPath $malformedLockScenario -ExpectedParent $malformedLockScenario -LivePath (Join-Path $malformedLockScenario 'live') -ProbeCounters $malformedProbeCounters
            $malformedOfficialResource = $malformedAcquireResult.Resource
            $malformedOfficialAssigned = $true
        } catch {
            $malformedValidationMessage = $_.Exception.Message
            $malformedOfficialResource = $null
            $malformedOfficialAssigned = $false
        }
        $malformedOutsideIdentityWhileHeld = & $getTask1B1FileIdentity $malformedOutsideGuard
    } finally {
        if ($null -ne $malformedOfficialResource) {
            $malformedOfficialResource.Handle.Dispose()
            $malformedOfficialResource = $null
        }
        if ($null -ne $malformedOutsideGuard) {
            $malformedOutsideGuard.Dispose()
            $malformedOutsideGuard = $null
        }
    }

    $malformedOutsideReopen = $null
    try {
        $malformedOutsideReopen = [System.IO.File]::Open(
            $malformedOutsideSentinel,
            [System.IO.FileMode]::Open,
            [System.IO.FileAccess]::Read,
            [System.IO.FileShare]::Read
        )
        $malformedOutsideIdentityAfter = & $getTask1B1FileIdentity $malformedOutsideReopen
    } finally {
        if ($null -ne $malformedOutsideReopen) {
            $malformedOutsideReopen.Dispose()
            $malformedOutsideReopen = $null
        }
    }
    $malformedManifestAfter = & $getTask1B1ScenarioManifest $malformedLockScenario
    $malformedCandidateHashAfter = (Get-FileHash -LiteralPath $malformedCandidatePath -Algorithm SHA256).Hash
    $malformedCandidateCreationAfter = [System.IO.File]::GetCreationTimeUtc($malformedCandidatePath)
    $malformedOutsideBytesAfter = [System.IO.File]::ReadAllBytes($malformedOutsideSentinel)
    $malformedOutsideHashAfter = (Get-FileHash -LiteralPath $malformedOutsideSentinel -Algorithm SHA256).Hash
    $malformedOutsideCreationAfter = [System.IO.File]::GetCreationTimeUtc($malformedOutsideSentinel)
    $malformedOutsideLastWriteAfter = [System.IO.File]::GetLastWriteTimeUtc($malformedOutsideSentinel)
    $malformedOutsideInventoryAfter = & $getTask1B1ParentInventory $malformedOutsideParent
    $malformedOutsideBytesEqual = [System.Linq.Enumerable]::SequenceEqual([byte[]]$malformedOutsideBytesBefore, [byte[]]$malformedOutsideBytesAfter)

    & $recordTask1B1Expectation (-not [string]::IsNullOrWhiteSpace($malformedValidationMessage) -and $malformedValidationMessage -match 'unsafe lock path') 'Task 1B1 malformed helper resource is rejected by shared scenario validation' "actual='$malformedValidationMessage'"
    & $recordTask1B1Expectation (-not $malformedOfficialAssigned -and $null -eq $malformedOfficialResource) 'Task 1B1 malformed helper never becomes an official lock resource' "officialAssigned=$malformedOfficialAssigned"
    & $recordTask1B1Expectation $malformedOwnerState.WasValid 'Task 1B1 malformed helper supplies a valid live owner before validation' "wasValid=$($malformedOwnerState.WasValid)"
    & $recordTask1B1Expectation ($null -ne $malformedOwnerState.Owner -and $malformedOwnerState.Owner.DisposeCount -eq 1) 'Task 1B1 malformed helper candidate owner is disposed exactly once on rejection' "disposeCount=$(if ($null -eq $malformedOwnerState.Owner) { '<none>' } else { $malformedOwnerState.Owner.DisposeCount })"
    & $recordTask1B1Expectation ($malformedProbeCounters.FallbackCount -eq 0 -and $malformedFallbackState.Calls -eq 0) 'Task 1B1 malformed helper rejection performs zero fallback acquisitions' "counter=$($malformedProbeCounters.FallbackCount) factoryCalls=$($malformedFallbackState.Calls)"
    & $recordTask1B1Expectation ($malformedProbeCounters.MetadataProbeCount -eq 0) 'Task 1B1 malformed helper rejection performs zero candidate-path metadata probes' "metadataProbes=$($malformedProbeCounters.MetadataProbeCount)"
    & $recordTask1B1Expectation ($malformedProbeCounters.DeleteProbeCount -eq 0) 'Task 1B1 malformed helper rejection performs zero candidate-path delete probes' "deleteProbes=$($malformedProbeCounters.DeleteProbeCount)"
    & $recordTask1B1Expectation ($malformedManifestAfter.Serialized -ceq $malformedManifestBefore.Serialized) 'Task 1B1 malformed helper leaves candidate scenario manifest identical' "before='$($malformedManifestBefore.Sha256)' after='$($malformedManifestAfter.Sha256)'"
    & $recordTask1B1Expectation ($malformedCandidateHashAfter -eq $malformedCandidateHashBefore -and $malformedCandidateCreationAfter -eq $malformedCandidateCreationBefore) 'Task 1B1 malformed helper leaves candidate sentinel bytes and creation metadata unchanged' "hashBefore='$malformedCandidateHashBefore' hashAfter='$malformedCandidateHashAfter' creationBefore='$($malformedCandidateCreationBefore.ToString('O'))' creationAfter='$($malformedCandidateCreationAfter.ToString('O'))'"
    & $recordTask1B1Expectation ($malformedOutsideIdentityBefore -ceq $malformedOutsideIdentityWhileHeld -and $malformedOutsideIdentityBefore -ceq $malformedOutsideIdentityAfter) 'Task 1B1 malformed helper preserves outside sentinel Windows file identity' "before='$malformedOutsideIdentityBefore' held='$malformedOutsideIdentityWhileHeld' after='$malformedOutsideIdentityAfter'"
    & $recordTask1B1Expectation ($malformedOutsideBytesEqual -and $malformedOutsideHashAfter -eq $malformedOutsideHashBefore) 'Task 1B1 malformed helper preserves outside sentinel bytes and hash' "bytesEqual=$malformedOutsideBytesEqual hashBefore='$malformedOutsideHashBefore' hashAfter='$malformedOutsideHashAfter'"
    & $recordTask1B1Expectation ($malformedOutsideCreationAfter -eq $malformedOutsideCreationBefore -and $malformedOutsideLastWriteAfter -eq $malformedOutsideLastWriteBefore) 'Task 1B1 malformed helper preserves outside sentinel timestamps' "creationBefore='$($malformedOutsideCreationBefore.ToString('O'))' creationAfter='$($malformedOutsideCreationAfter.ToString('O'))' writeBefore='$($malformedOutsideLastWriteBefore.ToString('O'))' writeAfter='$($malformedOutsideLastWriteAfter.ToString('O'))'"
    & $recordTask1B1Expectation ($malformedOutsideInventoryAfter -ceq $malformedOutsideInventoryBefore) 'Task 1B1 malformed helper preserves outside sentinel parent inventory' "before='$malformedOutsideInventoryBefore' after='$malformedOutsideInventoryAfter'"

    } finally {
        if ($null -ne $malformedOfficialResource) {
            $malformedOfficialResource.Handle.Dispose()
            $malformedOfficialResource = $null
        }
        if ($null -ne $malformedOutsideReopen) {
            $malformedOutsideReopen.Dispose()
            $malformedOutsideReopen = $null
        }
        if ($null -ne $malformedOutsideGuard) {
            $malformedOutsideGuard.Dispose()
            $malformedOutsideGuard = $null
        }
        if ($null -ne $malformedOwnerState.Owner -and $malformedOwnerState.Owner.DisposeCount -eq 0) {
            $malformedOwnerState.Owner.Dispose()
        }
        $malformedOutsideSentinelItem = Get-Item -LiteralPath $malformedOutsideSentinel -Force -ErrorAction SilentlyContinue
        if ($null -ne $malformedOutsideSentinelItem) {
            if ([bool]($malformedOutsideSentinelItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint)) {
                throw 'Task 1B1 malformed outside fixture cleanup refused a sentinel reparse point'
            }
            [System.IO.File]::Delete($malformedOutsideSentinel)
        }
        $malformedOutsideParentItem = Get-Item -LiteralPath $malformedOutsideParent -Force -ErrorAction SilentlyContinue
        if ($null -ne $malformedOutsideParentItem) {
            if ([bool]($malformedOutsideParentItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint)) {
                throw 'Task 1B1 malformed outside fixture cleanup refused a parent reparse point'
            }
            [System.IO.Directory]::Delete($malformedOutsideParent, $false)
        }
    }

    # A normal, existing temp deployment path is accepted by the wished-for
    # standalone path-safety helper.
    $normalSafetyRoot = Join-Path $sandbox 'task-1b1-normal-path\live'
    New-Item -ItemType Directory -Path $normalSafetyRoot -Force | Out-Null
    [System.IO.File]::WriteAllBytes((Join-Path $normalSafetyRoot 'normal-sentinel.bin'), [byte[]](1, 3, 5, 7, 9))
    $normalSafetyFailureMessage = $null
    try {
        Assert-TestDeployPathSafety -Path $normalSafetyRoot | Out-Null
    } catch {
        $normalSafetyFailureMessage = $_.Exception.Message
    }
    $task1B1ScenariosExecuted.Add('normal temp deployment path') | Out-Null
    & $recordTask1B1Expectation ([string]::IsNullOrWhiteSpace($normalSafetyFailureMessage)) 'Task 1B1 normal temp deployment path passes path safety' "actual='$normalSafetyFailureMessage'"

    # The deployment root itself is a junction.  A second nested junction points
    # at a locked binary tripwire: safe code must reject the root before it can
    # recurse, read, copy, stage, or mutate any fixture content.
    $rootJunctionScenario = Join-Path $sandbox 'task-1b1-root-junction'
    $rootJunctionTarget = Join-Path $rootJunctionScenario 'junction-target'
    $rootJunctionLink = Join-Path $rootJunctionScenario 'live-junction'
    $rootJunctionNestedTarget = Join-Path $rootJunctionScenario 'nested-tripwire-target'
    $rootJunctionNestedLink = Join-Path $rootJunctionTarget 'nested-tripwire-link'
    $rootJunctionTripwire = Join-Path $rootJunctionNestedTarget 'locked-tripwire.bin'
    $rootJunctionOutside = Join-Path $rootJunctionScenario 'outside-sentinel.bin'
    & $newTransactionFixture $rootJunctionTarget
    New-Item -ItemType Directory -Path $rootJunctionNestedTarget -Force | Out-Null
    [System.IO.File]::WriteAllBytes($rootJunctionTripwire, [byte[]](41, 42, 43, 240, 241, 242))
    [System.IO.File]::WriteAllBytes($rootJunctionOutside, [byte[]](21, 22, 23, 200, 201))
    $rootJunctionDetachedTargetBaseline = & $getTask1B1ScenarioManifest $rootJunctionTarget
    $rootJunctionOutsideHashBefore = (Get-FileHash -LiteralPath $rootJunctionOutside -Algorithm SHA256).Hash
    $rootJunctionTripwireHashBefore = (Get-FileHash -LiteralPath $rootJunctionTripwire -Algorithm SHA256).Hash
    $rootJunctionTripwireHandle = $null
    $rootJunctionEnvHandle = $null
    try {
        New-Item -ItemType Junction -Path $rootJunctionNestedLink -Target $rootJunctionNestedTarget -ErrorAction Stop | Out-Null
        $task1B1FixtureReparsePaths.Add([System.IO.Path]::GetFullPath($rootJunctionNestedLink)) | Out-Null
        New-Item -ItemType Junction -Path $rootJunctionLink -Target $rootJunctionTarget -ErrorAction Stop | Out-Null
        $task1B1FixtureReparsePaths.Add([System.IO.Path]::GetFullPath($rootJunctionLink)) | Out-Null

        $rootJunctionItem = Get-Item -LiteralPath $rootJunctionLink -Force -ErrorAction Stop
        $rootNestedItem = Get-Item -LiteralPath $rootJunctionNestedLink -Force -ErrorAction Stop
        Assert-True ([bool]($rootJunctionItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint)) 'Task 1B1 fixture creates a real deployment-root reparse point'
        Assert-True ([bool]($rootNestedItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint)) 'Task 1B1 fixture creates a nested reparse tripwire'
        $rootJunctionTargetBefore = & $getTask1B1ScenarioManifest $rootJunctionTarget
        $rootJunctionScenarioBefore = & $getTask1B1ScenarioManifest $rootJunctionScenario
        $rootJunctionTripwireHandle = [System.IO.File]::Open(
            $rootJunctionTripwire,
            [System.IO.FileMode]::Open,
            [System.IO.FileAccess]::ReadWrite,
            [System.IO.FileShare]::None
        )

        $rootJunctionDirectMessage = $null
        $rootJunctionDirectException = $null
        try {
            Assert-TestDeployPathSafety -Path $rootJunctionLink | Out-Null
        } catch {
            $rootJunctionDirectMessage = $_.Exception.Message
            $rootJunctionDirectException = & $unwrapTask1B1IOException $_.Exception
        }

        $rootJunctionEnvHandle = [System.IO.File]::Open(
            (Join-Path $rootJunctionTarget '.env'),
            [System.IO.FileMode]::Open,
            [System.IO.FileAccess]::ReadWrite,
            [System.IO.FileShare]::None
        )
        $rootJunctionDoubles = & $newPathBoundaryDoubles
        $rootJunctionInvokeMessage = $null
        $rootJunctionInvokeException = $null
        try {
            Invoke-TestDeployRebuild -Build -RepoRoot $rebuildRoot -DeploymentPath $rootJunctionLink -AllowNonFixedPathForTests -CommandRunner $rootJunctionDoubles.Runner -DeployRunner $rootJunctionDoubles.DeployRunner -ServiceStopper $rootJunctionDoubles.Stopper | Out-Null
        } catch {
            $rootJunctionInvokeMessage = $_.Exception.Message
            $rootJunctionInvokeException = & $unwrapTask1B1IOException $_.Exception
        }
        $rootJunctionEnvHandle.Dispose()
        $rootJunctionEnvHandle = $null
        $rootJunctionTripwireHandle.Dispose()
        $rootJunctionTripwireHandle = $null

        $rootJunctionTargetAfter = & $getTask1B1ScenarioManifest $rootJunctionTarget
        $rootJunctionScenarioAfter = & $getTask1B1ScenarioManifest $rootJunctionScenario
        $rootJunctionOutsideHashAfter = (Get-FileHash -LiteralPath $rootJunctionOutside -Algorithm SHA256).Hash
        $rootJunctionTripwireHashAfter = (Get-FileHash -LiteralPath $rootJunctionTripwire -Algorithm SHA256).Hash
        $rootJunctionStillReparse = [bool]((Get-Item -LiteralPath $rootJunctionLink -Force -ErrorAction Stop).Attributes -band [System.IO.FileAttributes]::ReparsePoint)
        $rootNestedStillReparse = [bool]((Get-Item -LiteralPath $rootJunctionNestedLink -Force -ErrorAction Stop).Attributes -band [System.IO.FileAttributes]::ReparsePoint)
        $rootJunctionResidue = @(& $getTask1B1TransactionResidue -ParentPath $rootJunctionScenario -LiveLeaf (Split-Path -Leaf $rootJunctionLink))
        $rootDirectSharingEvidence = & $getTask1B1SharingViolationEvidence $rootJunctionDirectException
        $rootInvokeSharingEvidence = & $getTask1B1SharingViolationEvidence $rootJunctionInvokeException

        & $recordTask1B1Expectation (-not [string]::IsNullOrWhiteSpace($rootJunctionDirectMessage) -and $rootJunctionDirectMessage -match 'deployment path contains reparse point') 'Task 1B1 root junction direct check fails closed with stable error' "actual='$rootJunctionDirectMessage'"
        & $recordTask1B1Expectation (-not $rootDirectSharingEvidence.IsSharingViolation) 'Task 1B1 root junction direct check rejects before reading locked nested tripwire' "type='$($rootDirectSharingEvidence.Type)' hresult='$($rootDirectSharingEvidence.HResult)' lowCode='$($rootDirectSharingEvidence.LowCode)'"
        & $recordTask1B1Expectation (-not [string]::IsNullOrWhiteSpace($rootJunctionInvokeMessage) -and $rootJunctionInvokeMessage -match 'deployment path contains reparse point') 'Task 1B1 root junction rebuild fails closed with stable error' "actual='$rootJunctionInvokeMessage'"
        & $recordTask1B1Expectation (-not $rootInvokeSharingEvidence.IsSharingViolation) 'Task 1B1 root junction rejects before env backup tripwire' "type='$($rootInvokeSharingEvidence.Type)' hresult='$($rootInvokeSharingEvidence.HResult)' lowCode='$($rootInvokeSharingEvidence.LowCode)' actual='$rootJunctionInvokeMessage'"
        & $recordTask1B1Expectation (-not $rootInvokeSharingEvidence.IsSharingViolation) 'Task 1B1 root junction rebuild rejects before reading locked nested tripwire' "type='$($rootInvokeSharingEvidence.Type)' hresult='$($rootInvokeSharingEvidence.HResult)' lowCode='$($rootInvokeSharingEvidence.LowCode)'"
        & $recordTask1B1Expectation ($rootJunctionDoubles.Commands.Count -eq 0) 'Task 1B1 root junction fails before any Git or origin command' "commands='$($rootJunctionDoubles.Commands -join ';')'"
        & $recordTask1B1Expectation ($rootJunctionDoubles.CloneTargets.Count -eq 0) 'Task 1B1 root junction fails before clone' "targets='$($rootJunctionDoubles.CloneTargets -join ',')' commands='$($rootJunctionDoubles.Commands -join ';')'"
        & $recordTask1B1Expectation ($rootJunctionDoubles.StoppedServices.Count -eq 0) 'Task 1B1 root junction fails before service stop' "stopped='$($rootJunctionDoubles.StoppedServices -join ',')'"
        & $recordTask1B1Expectation ($rootJunctionDoubles.DeployCalls.Count -eq 0) 'Task 1B1 root junction fails before deploy' "deployCalls=$($rootJunctionDoubles.DeployCalls.Count)"
        & $recordTask1B1Expectation ($rootJunctionTargetAfter.Serialized -ceq $rootJunctionTargetBefore.Serialized) 'Task 1B1 root junction target remains complete and byte-identical' "before='$($rootJunctionTargetBefore.Sha256)' after='$($rootJunctionTargetAfter.Sha256)'"
        & $recordTask1B1Expectation ($rootJunctionScenarioAfter.Serialized -ceq $rootJunctionScenarioBefore.Serialized) 'Task 1B1 root junction leaves complete scenario parent manifest identical' "before='$($rootJunctionScenarioBefore.Sha256)' after='$($rootJunctionScenarioAfter.Sha256)'"
        & $recordTask1B1Expectation ($rootJunctionTripwireHashAfter -eq $rootJunctionTripwireHashBefore) 'Task 1B1 root junction leaves locked binary tripwire byte-identical' "before='$rootJunctionTripwireHashBefore' after='$rootJunctionTripwireHashAfter'"
        & $recordTask1B1Expectation ($rootJunctionOutsideHashAfter -eq $rootJunctionOutsideHashBefore) 'Task 1B1 root junction leaves outside data byte-identical' "before='$rootJunctionOutsideHashBefore' after='$rootJunctionOutsideHashAfter'"
        & $recordTask1B1Expectation ($rootJunctionStillReparse -and $rootNestedStillReparse) 'Task 1B1 root junction rejection preserves both reparse entries until verified teardown' "root='$rootJunctionLink' nested='$rootJunctionNestedLink'"
        & $recordTask1B1Expectation ($rootJunctionResidue.Count -eq 0) 'Task 1B1 root junction leaves no stage or previous residue' "residue='$(@($rootJunctionResidue | ForEach-Object { $_.Name }) -join ',')'"
        $task1B1ScenariosExecuted.Add('deployment root junction') | Out-Null
    } finally {
        if ($null -ne $rootJunctionEnvHandle) {
            $rootJunctionEnvHandle.Dispose()
        }
        if ($null -ne $rootJunctionTripwireHandle) {
            $rootJunctionTripwireHandle.Dispose()
        }
        $rootNestedEntry = & $getTask1B1PathEntry -Path $rootJunctionNestedLink
        if ($null -ne $rootNestedEntry) {
            & $removeVerifiedTempJunction -LinkPath $rootJunctionNestedLink -ExpectedTarget $rootJunctionNestedTarget
        }
        $rootLinkEntry = & $getTask1B1PathEntry -Path $rootJunctionLink
        if ($null -ne $rootLinkEntry) {
            & $removeVerifiedTempJunction -LinkPath $rootJunctionLink -ExpectedTarget $rootJunctionTarget
        }
    }
    $rootJunctionTargetAfterCleanup = & $getTask1B1ScenarioManifest $rootJunctionTarget
    Assert-Equal $rootJunctionDetachedTargetBaseline.Serialized $rootJunctionTargetAfterCleanup.Serialized 'Task 1B1 root-junction link-only cleanup preserves detached target manifest'
    Assert-Equal $rootJunctionTripwireHashBefore (Get-FileHash -LiteralPath $rootJunctionTripwire -Algorithm SHA256).Hash 'Task 1B1 root-junction cleanup preserves tripwire target'
    Assert-Equal $rootJunctionOutsideHashBefore (Get-FileHash -LiteralPath $rootJunctionOutside -Algorithm SHA256).Hash 'Task 1B1 root-junction cleanup preserves outside sentinel'

    # The deployment is three components below a junction ancestor:
    # linked-parent\normal-a\normal-b\live.  Live and its immediate parent are
    # ordinary directories, forcing the path guard to walk every existing
    # component instead of checking only the leaf or direct parent.
    $ancestorJunctionScenario = Join-Path $sandbox 'task-1b1-ancestor-junction'
    $ancestorJunctionTarget = Join-Path $ancestorJunctionScenario 'junction-target'
    $ancestorJunctionActualLive = Join-Path $ancestorJunctionTarget 'normal-a\normal-b\live'
    $ancestorJunctionActualParent = Split-Path -Parent $ancestorJunctionActualLive
    $ancestorJunctionLink = Join-Path $ancestorJunctionScenario 'linked-parent'
    $ancestorJunctionViaLink = Join-Path $ancestorJunctionLink 'normal-a\normal-b\live'
    $ancestorJunctionNestedTarget = Join-Path $ancestorJunctionScenario 'nested-tripwire-target'
    $ancestorJunctionNestedLink = Join-Path $ancestorJunctionActualLive 'nested-tripwire-link'
    $ancestorJunctionTripwire = Join-Path $ancestorJunctionNestedTarget 'locked-tripwire.bin'
    $ancestorJunctionOutside = Join-Path $ancestorJunctionScenario 'outside-sentinel.bin'
    & $newTransactionFixture $ancestorJunctionActualLive
    New-Item -ItemType Directory -Path $ancestorJunctionNestedTarget -Force | Out-Null
    [System.IO.File]::WriteAllBytes($ancestorJunctionTripwire, [byte[]](51, 52, 53, 250, 251, 252))
    [System.IO.File]::WriteAllBytes($ancestorJunctionOutside, [byte[]](31, 32, 33, 210, 211))
    $ancestorJunctionDetachedTargetBaseline = & $getTask1B1ScenarioManifest $ancestorJunctionTarget
    $ancestorJunctionOutsideHashBefore = (Get-FileHash -LiteralPath $ancestorJunctionOutside -Algorithm SHA256).Hash
    $ancestorJunctionTripwireHashBefore = (Get-FileHash -LiteralPath $ancestorJunctionTripwire -Algorithm SHA256).Hash
    $ancestorJunctionTripwireHandle = $null
    $ancestorJunctionEnvHandle = $null
    try {
        New-Item -ItemType Junction -Path $ancestorJunctionNestedLink -Target $ancestorJunctionNestedTarget -ErrorAction Stop | Out-Null
        $task1B1FixtureReparsePaths.Add([System.IO.Path]::GetFullPath($ancestorJunctionNestedLink)) | Out-Null
        New-Item -ItemType Junction -Path $ancestorJunctionLink -Target $ancestorJunctionTarget -ErrorAction Stop | Out-Null
        $task1B1FixtureReparsePaths.Add([System.IO.Path]::GetFullPath($ancestorJunctionLink)) | Out-Null

        $ancestorJunctionItem = Get-Item -LiteralPath $ancestorJunctionLink -Force -ErrorAction Stop
        Assert-True ([bool]($ancestorJunctionItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint)) 'Task 1B1 fixture creates a real higher ancestor reparse point'
        foreach ($ordinaryPath in @(
            (Join-Path $ancestorJunctionLink 'normal-a'),
            (Join-Path $ancestorJunctionLink 'normal-a\normal-b'),
            $ancestorJunctionViaLink
        )) {
            $ordinaryItem = Get-Item -LiteralPath $ordinaryPath -Force -ErrorAction Stop
            Assert-True (-not [bool]($ordinaryItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint)) "Task 1B1 deep ancestor fixture keeps component ordinary: $ordinaryPath"
        }
        $ancestorNestedItem = Get-Item -LiteralPath $ancestorJunctionNestedLink -Force -ErrorAction Stop
        Assert-True ([bool]($ancestorNestedItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint)) 'Task 1B1 fixture creates a nested ancestor-tripwire reparse point'
        $ancestorJunctionTargetBefore = & $getTask1B1ScenarioManifest $ancestorJunctionTarget
        $ancestorJunctionScenarioBefore = & $getTask1B1ScenarioManifest $ancestorJunctionScenario
        $ancestorJunctionTripwireHandle = [System.IO.File]::Open(
            $ancestorJunctionTripwire,
            [System.IO.FileMode]::Open,
            [System.IO.FileAccess]::ReadWrite,
            [System.IO.FileShare]::None
        )

        $ancestorJunctionDirectMessage = $null
        $ancestorJunctionDirectException = $null
        try {
            Assert-TestDeployPathSafety -Path $ancestorJunctionViaLink | Out-Null
        } catch {
            $ancestorJunctionDirectMessage = $_.Exception.Message
            $ancestorJunctionDirectException = & $unwrapTask1B1IOException $_.Exception
        }

        $ancestorJunctionEnvHandle = [System.IO.File]::Open(
            (Join-Path $ancestorJunctionActualLive '.env'),
            [System.IO.FileMode]::Open,
            [System.IO.FileAccess]::ReadWrite,
            [System.IO.FileShare]::None
        )
        $ancestorJunctionDoubles = & $newPathBoundaryDoubles
        $ancestorJunctionInvokeMessage = $null
        $ancestorJunctionInvokeException = $null
        try {
            Invoke-TestDeployRebuild -Build -RepoRoot $rebuildRoot -DeploymentPath $ancestorJunctionViaLink -AllowNonFixedPathForTests -CommandRunner $ancestorJunctionDoubles.Runner -DeployRunner $ancestorJunctionDoubles.DeployRunner -ServiceStopper $ancestorJunctionDoubles.Stopper | Out-Null
        } catch {
            $ancestorJunctionInvokeMessage = $_.Exception.Message
            $ancestorJunctionInvokeException = & $unwrapTask1B1IOException $_.Exception
        }
        $ancestorJunctionEnvHandle.Dispose()
        $ancestorJunctionEnvHandle = $null
        $ancestorJunctionTripwireHandle.Dispose()
        $ancestorJunctionTripwireHandle = $null

        $ancestorJunctionTargetAfter = & $getTask1B1ScenarioManifest $ancestorJunctionTarget
        $ancestorJunctionScenarioAfter = & $getTask1B1ScenarioManifest $ancestorJunctionScenario
        $ancestorJunctionOutsideHashAfter = (Get-FileHash -LiteralPath $ancestorJunctionOutside -Algorithm SHA256).Hash
        $ancestorJunctionTripwireHashAfter = (Get-FileHash -LiteralPath $ancestorJunctionTripwire -Algorithm SHA256).Hash
        $ancestorJunctionStillReparse = [bool]((Get-Item -LiteralPath $ancestorJunctionLink -Force -ErrorAction Stop).Attributes -band [System.IO.FileAttributes]::ReparsePoint)
        $ancestorNestedStillReparse = [bool]((Get-Item -LiteralPath $ancestorJunctionNestedLink -Force -ErrorAction Stop).Attributes -band [System.IO.FileAttributes]::ReparsePoint)
        $ancestorJunctionResidue = @(& $getTask1B1TransactionResidue -ParentPath $ancestorJunctionActualParent -LiveLeaf (Split-Path -Leaf $ancestorJunctionActualLive))
        $ancestorDirectSharingEvidence = & $getTask1B1SharingViolationEvidence $ancestorJunctionDirectException
        $ancestorInvokeSharingEvidence = & $getTask1B1SharingViolationEvidence $ancestorJunctionInvokeException

        & $recordTask1B1Expectation (-not [string]::IsNullOrWhiteSpace($ancestorJunctionDirectMessage) -and $ancestorJunctionDirectMessage -match 'deployment path contains reparse point') 'Task 1B1 deep ancestor junction direct check fails closed with stable error' "actual='$ancestorJunctionDirectMessage'"
        & $recordTask1B1Expectation (-not $ancestorDirectSharingEvidence.IsSharingViolation) 'Task 1B1 deep ancestor direct check rejects before reading locked nested tripwire' "type='$($ancestorDirectSharingEvidence.Type)' hresult='$($ancestorDirectSharingEvidence.HResult)' lowCode='$($ancestorDirectSharingEvidence.LowCode)'"
        & $recordTask1B1Expectation (-not [string]::IsNullOrWhiteSpace($ancestorJunctionInvokeMessage) -and $ancestorJunctionInvokeMessage -match 'deployment path contains reparse point') 'Task 1B1 deep ancestor junction rebuild fails closed with stable error' "actual='$ancestorJunctionInvokeMessage'"
        & $recordTask1B1Expectation (-not $ancestorInvokeSharingEvidence.IsSharingViolation) 'Task 1B1 deep ancestor junction rejects before env backup tripwire' "type='$($ancestorInvokeSharingEvidence.Type)' hresult='$($ancestorInvokeSharingEvidence.HResult)' lowCode='$($ancestorInvokeSharingEvidence.LowCode)' actual='$ancestorJunctionInvokeMessage'"
        & $recordTask1B1Expectation (-not $ancestorInvokeSharingEvidence.IsSharingViolation) 'Task 1B1 deep ancestor rebuild rejects before reading locked nested tripwire' "type='$($ancestorInvokeSharingEvidence.Type)' hresult='$($ancestorInvokeSharingEvidence.HResult)' lowCode='$($ancestorInvokeSharingEvidence.LowCode)'"
        & $recordTask1B1Expectation ($ancestorJunctionDoubles.Commands.Count -eq 0) 'Task 1B1 deep ancestor junction fails before any Git or origin command' "commands='$($ancestorJunctionDoubles.Commands -join ';')'"
        & $recordTask1B1Expectation ($ancestorJunctionDoubles.CloneTargets.Count -eq 0) 'Task 1B1 deep ancestor junction fails before clone' "targets='$($ancestorJunctionDoubles.CloneTargets -join ',')' commands='$($ancestorJunctionDoubles.Commands -join ';')'"
        & $recordTask1B1Expectation ($ancestorJunctionDoubles.StoppedServices.Count -eq 0) 'Task 1B1 deep ancestor junction fails before service stop' "stopped='$($ancestorJunctionDoubles.StoppedServices -join ',')'"
        & $recordTask1B1Expectation ($ancestorJunctionDoubles.DeployCalls.Count -eq 0) 'Task 1B1 deep ancestor junction fails before deploy' "deployCalls=$($ancestorJunctionDoubles.DeployCalls.Count)"
        & $recordTask1B1Expectation ($ancestorJunctionTargetAfter.Serialized -ceq $ancestorJunctionTargetBefore.Serialized) 'Task 1B1 deep ancestor target remains complete and byte-identical' "before='$($ancestorJunctionTargetBefore.Sha256)' after='$($ancestorJunctionTargetAfter.Sha256)'"
        & $recordTask1B1Expectation ($ancestorJunctionScenarioAfter.Serialized -ceq $ancestorJunctionScenarioBefore.Serialized) 'Task 1B1 deep ancestor leaves complete scenario parent manifest identical' "before='$($ancestorJunctionScenarioBefore.Sha256)' after='$($ancestorJunctionScenarioAfter.Sha256)'"
        & $recordTask1B1Expectation ($ancestorJunctionTripwireHashAfter -eq $ancestorJunctionTripwireHashBefore) 'Task 1B1 deep ancestor leaves locked binary tripwire byte-identical' "before='$ancestorJunctionTripwireHashBefore' after='$ancestorJunctionTripwireHashAfter'"
        & $recordTask1B1Expectation ($ancestorJunctionOutsideHashAfter -eq $ancestorJunctionOutsideHashBefore) 'Task 1B1 deep ancestor leaves outside data byte-identical' "before='$ancestorJunctionOutsideHashBefore' after='$ancestorJunctionOutsideHashAfter'"
        & $recordTask1B1Expectation ($ancestorJunctionStillReparse -and $ancestorNestedStillReparse) 'Task 1B1 deep ancestor rejection preserves both reparse entries until verified teardown' "ancestor='$ancestorJunctionLink' nested='$ancestorJunctionNestedLink'"
        & $recordTask1B1Expectation ($ancestorJunctionResidue.Count -eq 0) 'Task 1B1 deep ancestor leaves no stage or previous residue' "residue='$(@($ancestorJunctionResidue | ForEach-Object { $_.Name }) -join ',')'"
        $task1B1ScenariosExecuted.Add('existing deep ancestor junction') | Out-Null
    } finally {
        if ($null -ne $ancestorJunctionEnvHandle) {
            $ancestorJunctionEnvHandle.Dispose()
        }
        if ($null -ne $ancestorJunctionTripwireHandle) {
            $ancestorJunctionTripwireHandle.Dispose()
        }
        $ancestorNestedEntry = & $getTask1B1PathEntry -Path $ancestorJunctionNestedLink
        if ($null -ne $ancestorNestedEntry) {
            & $removeVerifiedTempJunction -LinkPath $ancestorJunctionNestedLink -ExpectedTarget $ancestorJunctionNestedTarget
        }
        $ancestorLinkEntry = & $getTask1B1PathEntry -Path $ancestorJunctionLink
        if ($null -ne $ancestorLinkEntry) {
            & $removeVerifiedTempJunction -LinkPath $ancestorJunctionLink -ExpectedTarget $ancestorJunctionTarget
        }
    }
    $ancestorJunctionTargetAfterCleanup = & $getTask1B1ScenarioManifest $ancestorJunctionTarget
    Assert-Equal $ancestorJunctionDetachedTargetBaseline.Serialized $ancestorJunctionTargetAfterCleanup.Serialized 'Task 1B1 deep-ancestor link-only cleanup preserves detached target manifest'
    Assert-Equal $ancestorJunctionTripwireHashBefore (Get-FileHash -LiteralPath $ancestorJunctionTripwire -Algorithm SHA256).Hash 'Task 1B1 deep-ancestor cleanup preserves tripwire target'
    Assert-Equal $ancestorJunctionOutsideHashBefore (Get-FileHash -LiteralPath $ancestorJunctionOutside -Algorithm SHA256).Hash 'Task 1B1 deep-ancestor cleanup preserves outside sentinel'

    # Independent untracked leaf-reparse case.  The deployment root and its
    # ancestors are ordinary and the fixture has an existing .git directory,
    # so the real orchestrator can reject only because of this nested junction.
    $untrackedLeafScenario = Join-Path $sandbox 'task-1b1-untracked-leaf-reparse'
    $untrackedLeafLive = Join-Path $untrackedLeafScenario 'live'
    $untrackedLeafTarget = Join-Path $untrackedLeafScenario 'detached-target'
    $untrackedLeafLink = Join-Path $untrackedLeafLive 'untracked-leaf-link'
    $untrackedLeafSentinel = Join-Path $untrackedLeafTarget 'target-sentinel.bin'
    & $newTransactionFixture $untrackedLeafLive
    New-Item -ItemType Directory -Path (Join-Path $untrackedLeafLive '.git') -Force | Out-Null
    New-Item -ItemType Directory -Path $untrackedLeafTarget -Force | Out-Null
    [System.IO.File]::WriteAllBytes($untrackedLeafSentinel, [byte[]](61, 62, 63, 220, 221, 222))
    $untrackedLeafTargetHashBefore = (Get-FileHash -LiteralPath $untrackedLeafSentinel -Algorithm SHA256).Hash
    $untrackedLeafTargetInventoryBefore = & $getTask1B1ParentInventory $untrackedLeafTarget
    $untrackedLeafTargetHandle = $null
    $untrackedLeafEnvHandle = $null
    $untrackedLeafIdentityBefore = $null
    $untrackedLeafIdentityWhileHeld = $null
    $untrackedLeafIdentityAfter = $null
    try {
        New-Item -ItemType Junction -Path $untrackedLeafLink -Target $untrackedLeafTarget -ErrorAction Stop | Out-Null
        $task1B1FixtureReparsePaths.Add([System.IO.Path]::GetFullPath($untrackedLeafLink)) | Out-Null
        $untrackedLeafLiveItem = Get-Item -LiteralPath $untrackedLeafLive -Force -ErrorAction Stop
        $untrackedLeafLinkItem = Get-Item -LiteralPath $untrackedLeafLink -Force -ErrorAction Stop
        Assert-True (-not [bool]($untrackedLeafLiveItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint)) 'Task 1B1 untracked-leaf fixture keeps deployment root ordinary'
        Assert-True ([bool]($untrackedLeafLinkItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint)) 'Task 1B1 untracked-leaf fixture creates a real leaf reparse point'
        $untrackedLeafLiveInventoryBefore = & $getTask1B1ParentInventory $untrackedLeafLive
        $untrackedLeafTargetHandle = [System.IO.File]::Open($untrackedLeafSentinel, [System.IO.FileMode]::Open, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
        $untrackedLeafIdentityBefore = & $getTask1B1FileIdentity $untrackedLeafTargetHandle
        $untrackedLeafEnvHandle = [System.IO.File]::Open((Join-Path $untrackedLeafLive '.env'), [System.IO.FileMode]::Open, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)

        $untrackedLeafDoubles = & $newPathBoundaryDoubles
        $untrackedLeafInvokeMessage = $null
        $untrackedLeafInvokeException = $null
        try {
            Invoke-TestDeployRebuild -Build -RepoRoot $rebuildRoot -DeploymentPath $untrackedLeafLive -AllowNonFixedPathForTests -CommandRunner $untrackedLeafDoubles.Runner -DeployRunner $untrackedLeafDoubles.DeployRunner -ServiceStopper $untrackedLeafDoubles.Stopper | Out-Null
        } catch {
            $untrackedLeafInvokeMessage = $_.Exception.Message
            $untrackedLeafInvokeException = & $unwrapTask1B1IOException $_.Exception
        }
        $untrackedLeafIdentityWhileHeld = & $getTask1B1FileIdentity $untrackedLeafTargetHandle
        $untrackedLeafEnvHandle.Dispose()
        $untrackedLeafEnvHandle = $null
        $untrackedLeafTargetHandle.Dispose()
        $untrackedLeafTargetHandle = $null
        $untrackedLeafReopen = $null
        try {
            $untrackedLeafReopen = [System.IO.File]::Open($untrackedLeafSentinel, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::Read)
            $untrackedLeafIdentityAfter = & $getTask1B1FileIdentity $untrackedLeafReopen
        } finally {
            if ($null -ne $untrackedLeafReopen) { $untrackedLeafReopen.Dispose() }
        }

        $untrackedLeafSharingEvidence = & $getTask1B1SharingViolationEvidence $untrackedLeafInvokeException
        $untrackedLeafTargetHashAfter = (Get-FileHash -LiteralPath $untrackedLeafSentinel -Algorithm SHA256).Hash
        $untrackedLeafTargetInventoryAfter = & $getTask1B1ParentInventory $untrackedLeafTarget
        $untrackedLeafLiveInventoryAfter = & $getTask1B1ParentInventory $untrackedLeafLive
        $untrackedLeafStillReparse = [bool]((Get-Item -LiteralPath $untrackedLeafLink -Force -ErrorAction Stop).Attributes -band [System.IO.FileAttributes]::ReparsePoint)
        $untrackedLeafResidue = @(& $getTask1B1TransactionResidue -ParentPath $untrackedLeafScenario -LiveLeaf (Split-Path -Leaf $untrackedLeafLive))

        & $recordTask1B1Expectation (-not [string]::IsNullOrWhiteSpace($untrackedLeafInvokeMessage) -and $untrackedLeafInvokeMessage -match 'deployment path contains reparse point') 'Task 1B1 untracked leaf reparse rebuild fails closed with stable error' "actual='$untrackedLeafInvokeMessage'"
        & $recordTask1B1Expectation (-not $untrackedLeafSharingEvidence.IsSharingViolation) 'Task 1B1 untracked leaf reparse rejects before env backup or target traversal' "type='$($untrackedLeafSharingEvidence.Type)' hresult='$($untrackedLeafSharingEvidence.HResult)' lowCode='$($untrackedLeafSharingEvidence.LowCode)' actual='$untrackedLeafInvokeMessage'"
        & $recordTask1B1Expectation ($untrackedLeafDoubles.Commands.Count -eq 0) 'Task 1B1 untracked leaf reparse fails before any Git or origin command' "commands='$($untrackedLeafDoubles.Commands -join ';')'"
        & $recordTask1B1Expectation ($untrackedLeafDoubles.CloneTargets.Count -eq 0) 'Task 1B1 untracked leaf reparse performs zero clones' "targets='$($untrackedLeafDoubles.CloneTargets -join ',')'"
        & $recordTask1B1Expectation ($untrackedLeafDoubles.StoppedServices.Count -eq 0) 'Task 1B1 untracked leaf reparse performs zero service stops' "stopped='$($untrackedLeafDoubles.StoppedServices -join ',')'"
        & $recordTask1B1Expectation ($untrackedLeafDoubles.DeployCalls.Count -eq 0) 'Task 1B1 untracked leaf reparse performs zero deploys' "deployCalls=$($untrackedLeafDoubles.DeployCalls.Count)"
        & $recordTask1B1Expectation ($untrackedLeafIdentityBefore -ceq $untrackedLeafIdentityWhileHeld -and $untrackedLeafIdentityBefore -ceq $untrackedLeafIdentityAfter) 'Task 1B1 untracked leaf reparse preserves target Windows file identity' "before='$untrackedLeafIdentityBefore' held='$untrackedLeafIdentityWhileHeld' after='$untrackedLeafIdentityAfter'"
        & $recordTask1B1Expectation ($untrackedLeafTargetHashAfter -eq $untrackedLeafTargetHashBefore) 'Task 1B1 untracked leaf reparse preserves target bytes' "before='$untrackedLeafTargetHashBefore' after='$untrackedLeafTargetHashAfter'"
        & $recordTask1B1Expectation ($untrackedLeafTargetInventoryAfter -ceq $untrackedLeafTargetInventoryBefore -and $untrackedLeafLiveInventoryAfter -ceq $untrackedLeafLiveInventoryBefore) 'Task 1B1 untracked leaf reparse preserves target and deployment parent inventories' "targetBefore='$untrackedLeafTargetInventoryBefore' targetAfter='$untrackedLeafTargetInventoryAfter' liveBefore='$untrackedLeafLiveInventoryBefore' liveAfter='$untrackedLeafLiveInventoryAfter'"
        & $recordTask1B1Expectation ($untrackedLeafStillReparse -and $untrackedLeafResidue.Count -eq 0) 'Task 1B1 untracked leaf reparse preserves link until teardown and leaves no transaction residue' "reparse=$untrackedLeafStillReparse residue='$(@($untrackedLeafResidue | ForEach-Object { $_.Name }) -join ',')'"
        $task1B1ScenariosExecuted.Add('untracked leaf reparse') | Out-Null
    } finally {
        if ($null -ne $untrackedLeafEnvHandle) { $untrackedLeafEnvHandle.Dispose() }
        if ($null -ne $untrackedLeafTargetHandle) { $untrackedLeafTargetHandle.Dispose() }
        $untrackedLeafEntry = & $getTask1B1PathEntry -Path $untrackedLeafLink
        if ($null -ne $untrackedLeafEntry) {
            & $removeVerifiedTempJunction -LinkPath $untrackedLeafLink -ExpectedTarget $untrackedLeafTarget
        }
    }
    Assert-Equal $untrackedLeafTargetHashBefore (Get-FileHash -LiteralPath $untrackedLeafSentinel -Algorithm SHA256).Hash 'Task 1B1 untracked-leaf link-only cleanup preserves target bytes'
    Assert-Equal $untrackedLeafTargetInventoryBefore (& $getTask1B1ParentInventory $untrackedLeafTarget) 'Task 1B1 untracked-leaf link-only cleanup preserves target inventory'

    # Independent ordinary-leaf-under-reparse-ancestor case.  The leaf itself
    # is a normal file; only an existing component in its path is a junction.
    $untrackedAncestorScenario = Join-Path $sandbox 'task-1b1-untracked-ancestor-reparse'
    $untrackedAncestorLive = Join-Path $untrackedAncestorScenario 'live'
    $untrackedAncestorTarget = Join-Path $untrackedAncestorScenario 'detached-ancestor-target'
    $untrackedAncestorTargetParent = Join-Path $untrackedAncestorTarget 'ordinary-parent'
    $untrackedAncestorTargetLeaf = Join-Path $untrackedAncestorTargetParent 'ordinary-untracked.bin'
    $untrackedAncestorLink = Join-Path $untrackedAncestorLive 'untracked-ancestor-link'
    $untrackedAncestorLeafViaLink = Join-Path $untrackedAncestorLink 'ordinary-parent\ordinary-untracked.bin'
    & $newTransactionFixture $untrackedAncestorLive
    New-Item -ItemType Directory -Path (Join-Path $untrackedAncestorLive '.git') -Force | Out-Null
    New-Item -ItemType Directory -Path $untrackedAncestorTargetParent -Force | Out-Null
    [System.IO.File]::WriteAllBytes($untrackedAncestorTargetLeaf, [byte[]](71, 72, 73, 230, 231, 232))
    $untrackedAncestorTargetHashBefore = (Get-FileHash -LiteralPath $untrackedAncestorTargetLeaf -Algorithm SHA256).Hash
    $untrackedAncestorTargetInventoryBefore = & $getTask1B1ParentInventory $untrackedAncestorTargetParent
    $untrackedAncestorTargetHandle = $null
    $untrackedAncestorEnvHandle = $null
    $untrackedAncestorIdentityBefore = $null
    $untrackedAncestorIdentityWhileHeld = $null
    $untrackedAncestorIdentityAfter = $null
    try {
        New-Item -ItemType Junction -Path $untrackedAncestorLink -Target $untrackedAncestorTarget -ErrorAction Stop | Out-Null
        $task1B1FixtureReparsePaths.Add([System.IO.Path]::GetFullPath($untrackedAncestorLink)) | Out-Null
        $untrackedAncestorLiveItem = Get-Item -LiteralPath $untrackedAncestorLive -Force -ErrorAction Stop
        $untrackedAncestorLinkItem = Get-Item -LiteralPath $untrackedAncestorLink -Force -ErrorAction Stop
        $untrackedAncestorLeafItem = Get-Item -LiteralPath $untrackedAncestorLeafViaLink -Force -ErrorAction Stop
        Assert-True (-not [bool]($untrackedAncestorLiveItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint)) 'Task 1B1 untracked-ancestor fixture keeps deployment root ordinary'
        Assert-True ([bool]($untrackedAncestorLinkItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint)) 'Task 1B1 untracked-ancestor fixture creates a real ancestor reparse point'
        Assert-True (-not [bool]($untrackedAncestorLeafItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint)) 'Task 1B1 untracked-ancestor fixture keeps the untracked leaf ordinary'
        $untrackedAncestorLiveInventoryBefore = & $getTask1B1ParentInventory $untrackedAncestorLive
        $untrackedAncestorTargetHandle = [System.IO.File]::Open($untrackedAncestorTargetLeaf, [System.IO.FileMode]::Open, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
        $untrackedAncestorIdentityBefore = & $getTask1B1FileIdentity $untrackedAncestorTargetHandle
        $untrackedAncestorEnvHandle = [System.IO.File]::Open((Join-Path $untrackedAncestorLive '.env'), [System.IO.FileMode]::Open, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)

        $untrackedAncestorDoubles = & $newPathBoundaryDoubles
        $untrackedAncestorInvokeMessage = $null
        $untrackedAncestorInvokeException = $null
        try {
            Invoke-TestDeployRebuild -Build -RepoRoot $rebuildRoot -DeploymentPath $untrackedAncestorLive -AllowNonFixedPathForTests -CommandRunner $untrackedAncestorDoubles.Runner -DeployRunner $untrackedAncestorDoubles.DeployRunner -ServiceStopper $untrackedAncestorDoubles.Stopper | Out-Null
        } catch {
            $untrackedAncestorInvokeMessage = $_.Exception.Message
            $untrackedAncestorInvokeException = & $unwrapTask1B1IOException $_.Exception
        }
        $untrackedAncestorIdentityWhileHeld = & $getTask1B1FileIdentity $untrackedAncestorTargetHandle
        $untrackedAncestorEnvHandle.Dispose()
        $untrackedAncestorEnvHandle = $null
        $untrackedAncestorTargetHandle.Dispose()
        $untrackedAncestorTargetHandle = $null
        $untrackedAncestorReopen = $null
        try {
            $untrackedAncestorReopen = [System.IO.File]::Open($untrackedAncestorTargetLeaf, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::Read)
            $untrackedAncestorIdentityAfter = & $getTask1B1FileIdentity $untrackedAncestorReopen
        } finally {
            if ($null -ne $untrackedAncestorReopen) { $untrackedAncestorReopen.Dispose() }
        }

        $untrackedAncestorSharingEvidence = & $getTask1B1SharingViolationEvidence $untrackedAncestorInvokeException
        $untrackedAncestorTargetHashAfter = (Get-FileHash -LiteralPath $untrackedAncestorTargetLeaf -Algorithm SHA256).Hash
        $untrackedAncestorTargetInventoryAfter = & $getTask1B1ParentInventory $untrackedAncestorTargetParent
        $untrackedAncestorLiveInventoryAfter = & $getTask1B1ParentInventory $untrackedAncestorLive
        $untrackedAncestorStillReparse = [bool]((Get-Item -LiteralPath $untrackedAncestorLink -Force -ErrorAction Stop).Attributes -band [System.IO.FileAttributes]::ReparsePoint)
        $untrackedAncestorResidue = @(& $getTask1B1TransactionResidue -ParentPath $untrackedAncestorScenario -LiveLeaf (Split-Path -Leaf $untrackedAncestorLive))

        & $recordTask1B1Expectation (-not [string]::IsNullOrWhiteSpace($untrackedAncestorInvokeMessage) -and $untrackedAncestorInvokeMessage -match 'deployment path contains reparse point') 'Task 1B1 ordinary untracked leaf under reparse ancestor fails closed with stable error' "actual='$untrackedAncestorInvokeMessage'"
        & $recordTask1B1Expectation (-not $untrackedAncestorSharingEvidence.IsSharingViolation) 'Task 1B1 untracked reparse ancestor rejects before env backup or ordinary-leaf traversal' "type='$($untrackedAncestorSharingEvidence.Type)' hresult='$($untrackedAncestorSharingEvidence.HResult)' lowCode='$($untrackedAncestorSharingEvidence.LowCode)' actual='$untrackedAncestorInvokeMessage'"
        & $recordTask1B1Expectation ($untrackedAncestorDoubles.Commands.Count -eq 0) 'Task 1B1 untracked reparse ancestor fails before any Git or origin command' "commands='$($untrackedAncestorDoubles.Commands -join ';')'"
        & $recordTask1B1Expectation ($untrackedAncestorDoubles.CloneTargets.Count -eq 0) 'Task 1B1 untracked reparse ancestor performs zero clones' "targets='$($untrackedAncestorDoubles.CloneTargets -join ',')'"
        & $recordTask1B1Expectation ($untrackedAncestorDoubles.StoppedServices.Count -eq 0) 'Task 1B1 untracked reparse ancestor performs zero service stops' "stopped='$($untrackedAncestorDoubles.StoppedServices -join ',')'"
        & $recordTask1B1Expectation ($untrackedAncestorDoubles.DeployCalls.Count -eq 0) 'Task 1B1 untracked reparse ancestor performs zero deploys' "deployCalls=$($untrackedAncestorDoubles.DeployCalls.Count)"
        & $recordTask1B1Expectation ($untrackedAncestorIdentityBefore -ceq $untrackedAncestorIdentityWhileHeld -and $untrackedAncestorIdentityBefore -ceq $untrackedAncestorIdentityAfter) 'Task 1B1 untracked reparse ancestor preserves target Windows file identity' "before='$untrackedAncestorIdentityBefore' held='$untrackedAncestorIdentityWhileHeld' after='$untrackedAncestorIdentityAfter'"
        & $recordTask1B1Expectation ($untrackedAncestorTargetHashAfter -eq $untrackedAncestorTargetHashBefore) 'Task 1B1 untracked reparse ancestor preserves ordinary target leaf bytes' "before='$untrackedAncestorTargetHashBefore' after='$untrackedAncestorTargetHashAfter'"
        & $recordTask1B1Expectation ($untrackedAncestorTargetInventoryAfter -ceq $untrackedAncestorTargetInventoryBefore -and $untrackedAncestorLiveInventoryAfter -ceq $untrackedAncestorLiveInventoryBefore) 'Task 1B1 untracked reparse ancestor preserves target and deployment parent inventories' "targetBefore='$untrackedAncestorTargetInventoryBefore' targetAfter='$untrackedAncestorTargetInventoryAfter' liveBefore='$untrackedAncestorLiveInventoryBefore' liveAfter='$untrackedAncestorLiveInventoryAfter'"
        & $recordTask1B1Expectation ($untrackedAncestorStillReparse -and $untrackedAncestorResidue.Count -eq 0) 'Task 1B1 untracked reparse ancestor preserves link until teardown and leaves no transaction residue' "reparse=$untrackedAncestorStillReparse residue='$(@($untrackedAncestorResidue | ForEach-Object { $_.Name }) -join ',')'"
        $task1B1ScenariosExecuted.Add('ordinary untracked leaf under reparse ancestor') | Out-Null
    } finally {
        if ($null -ne $untrackedAncestorEnvHandle) { $untrackedAncestorEnvHandle.Dispose() }
        if ($null -ne $untrackedAncestorTargetHandle) { $untrackedAncestorTargetHandle.Dispose() }
        $untrackedAncestorEntry = & $getTask1B1PathEntry -Path $untrackedAncestorLink
        if ($null -ne $untrackedAncestorEntry) {
            & $removeVerifiedTempJunction -LinkPath $untrackedAncestorLink -ExpectedTarget $untrackedAncestorTarget
        }
    }
    Assert-Equal $untrackedAncestorTargetHashBefore (Get-FileHash -LiteralPath $untrackedAncestorTargetLeaf -Algorithm SHA256).Hash 'Task 1B1 untracked-ancestor link-only cleanup preserves target bytes'
    Assert-Equal $untrackedAncestorTargetInventoryBefore (& $getTask1B1ParentInventory $untrackedAncestorTargetParent) 'Task 1B1 untracked-ancestor link-only cleanup preserves target inventory'

    # The lock helper returns a disposable exclusive handle.  A second acquire
    # must get the stable contention error; after disposal the same file (marked
    # with a deterministic creation time) must be reacquirable, not recreated.
    $lockScenarioRoot = Join-Path $sandbox 'task-1b1-exclusive-lock'
    $lockLiveRoot = Join-Path $lockScenarioRoot 'live'
    New-Item -ItemType Directory -Path $lockLiveRoot -Force | Out-Null
    $fallbackLockPath = Join-Path $lockScenarioRoot ".$((Split-Path -Leaf $lockLiveRoot)).rebuild.lock"
    $lockHelperAvailable = $null -ne (Get-Command -Name 'Enter-TestDeployRebuildLock' -ErrorAction SilentlyContinue)
    $productionLockFactory = {
        param([string] $DeploymentPath)
        return Enter-TestDeployRebuildLock -DeploymentPath $DeploymentPath
    }
    $firstFallbackFactory = {
        param([string] $DeploymentPath)
        $handle = [System.IO.File]::Open(
            $fallbackLockPath,
            [System.IO.FileMode]::OpenOrCreate,
            [System.IO.FileAccess]::ReadWrite,
            [System.IO.FileShare]::None
        )
        return [pscustomobject]@{ Handle = $handle; LockPath = $fallbackLockPath }
    }.GetNewClosure()
    $firstProbeCounters = & $newTask1B1ProbeCounters
    $firstLockDecision = $null
    $firstLockResource = $null
    $firstLockAcquiredByHelper = $false
    $firstLockAcquireMessage = $null
    $activeLockResource = $null
    $activeLockHandle = $null
    $activeLockPath = $null
    $activeLockPathValidated = $false
    $reacquiredLockResource = $null
    try {
        try {
            $firstLockDecision = & $acquireTask1B1LockResource -AcquireFactory $productionLockFactory -AcquireFactoryAvailable $lockHelperAvailable -FallbackFactory $firstFallbackFactory -DeploymentPath $lockLiveRoot -ExpectedParent $lockScenarioRoot -LivePath $lockLiveRoot -ProbeCounters $firstProbeCounters
            $firstLockResource = $firstLockDecision.Resource
            $firstLockAcquiredByHelper = [bool]$firstLockDecision.ByHelper
            if ($firstLockDecision.UsedFallback) {
                $firstLockAcquireMessage = 'Enter-TestDeployRebuildLock is unavailable; safe test fallback used'
            }
        } catch {
            $firstLockAcquireMessage = $_.Exception.Message
            if ($null -ne $firstLockResource) {
                $firstLockResource.Handle.Dispose()
                $firstLockResource = $null
            }
            $firstLockAcquiredByHelper = $false
        }
        & $recordTask1B1Expectation $firstLockAcquiredByHelper 'Task 1B1 first rebuild lock acquire succeeds' "actual='$firstLockAcquireMessage'"

        if ($null -ne $firstLockResource) {
            $activeLockResource = $firstLockResource
            $firstLockResource = $null
            $activeLockHandle = $activeLockResource.Handle
            $activeLockPath = $activeLockResource.LockPath
            $activeLockPathValidated = $true
        }

        # A rejected helper candidate never reaches this block: no fallback is
        # allowed when the helper exists, and no active-path metadata operation
        # runs unless an in-sandbox resource completed validation.
        if ($null -ne $activeLockResource -and $activeLockPathValidated) {
    $canonicalLockParent = ([System.IO.Path]::GetFullPath((Split-Path -Parent $activeLockPath))).TrimEnd($transactionPathTrimChars)
    $canonicalLiveParent = ([System.IO.Path]::GetFullPath((Split-Path -Parent $lockLiveRoot))).TrimEnd($transactionPathTrimChars)
    & $recordTask1B1Expectation ($firstLockAcquiredByHelper -and $canonicalLockParent.Equals($canonicalLiveParent, [System.StringComparison]::OrdinalIgnoreCase)) 'Task 1B1 lock file is a same-parent sibling of live' "lock='$activeLockPath' live='$lockLiveRoot'"
    & $recordTask1B1Expectation ($firstLockAcquiredByHelper -and (Test-Path -LiteralPath $activeLockPath -PathType Leaf)) 'Task 1B1 lock file exists while first handle is held' "lock='$activeLockPath'"

    $firstLockIdentity = $null
    $firstLockIdentityMessage = $null
    try {
        $firstLockIdentity = & $getTask1B1FileIdentity $activeLockHandle
    } catch {
        $firstLockIdentityMessage = $_.Exception.Message
    }
    & $recordTask1B1Expectation (-not [string]::IsNullOrWhiteSpace($firstLockIdentity)) 'Task 1B1 first lock handle exposes Windows file identity' "actual='$firstLockIdentityMessage'"

    # FileShare.None must also deny delete sharing.  A handle opened with
    # FileShare.Delete could make every competing open test pass while still
    # allowing the lock file to be unlinked/replaced underneath the owner.
    $rawDeleteException = $null
    $firstProbeCounters.DeleteProbeCount = [int]$firstProbeCounters.DeleteProbeCount + 1
    try {
        [System.IO.File]::Delete($activeLockPath)
    } catch {
        $rawDeleteException = & $unwrapTask1B1IOException $_.Exception
    }
    $rawDeleteEvidence = & $getTask1B1SharingViolationEvidence $rawDeleteException
    $lockPathExistsAfterDeleteProbe = Test-Path -LiteralPath $activeLockPath -PathType Leaf
    $lockIdentityAfterDeleteProbe = $null
    $lockIdentityAfterDeleteProbeMessage = $null
    try {
        $lockIdentityAfterDeleteProbe = & $getTask1B1FileIdentity $activeLockHandle
    } catch {
        $lockIdentityAfterDeleteProbeMessage = $_.Exception.Message
    }
    & $recordTask1B1Expectation $rawDeleteEvidence.IsSharingViolation 'Task 1B1 competing delete gets Windows sharing violation' "type='$($rawDeleteEvidence.Type)' hresult='$($rawDeleteEvidence.HResult)' lowCode='$($rawDeleteEvidence.LowCode)'"
    & $recordTask1B1Expectation ($firstProbeCounters.DeleteProbeCount -eq 1) 'Task 1B1 validated normal lock performs exactly one delete probe' "deleteProbes=$($firstProbeCounters.DeleteProbeCount)"
    & $recordTask1B1Expectation $lockPathExistsAfterDeleteProbe 'Task 1B1 competing delete leaves validated lock path present' "lock='$activeLockPath'"
    & $recordTask1B1Expectation (-not [string]::IsNullOrWhiteSpace($firstLockIdentity) -and $lockIdentityAfterDeleteProbe -ceq $firstLockIdentity) 'Task 1B1 competing delete preserves active handle Windows file identity' "before='$firstLockIdentity' after='$lockIdentityAfterDeleteProbe' actual='$lockIdentityAfterDeleteProbeMessage'"

    $rawReadHandle = $null
    $rawReadException = $null
    try {
        $rawReadHandle = [System.IO.File]::Open(
            $activeLockPath,
            [System.IO.FileMode]::Open,
            [System.IO.FileAccess]::Read,
            [System.IO.FileShare]::ReadWrite
        )
    } catch {
        $rawReadException = & $unwrapTask1B1IOException $_.Exception
    } finally {
        if ($null -ne $rawReadHandle) {
            $rawReadHandle.Dispose()
        }
    }
    $rawWriteHandle = $null
    $rawWriteException = $null
    try {
        $rawWriteHandle = [System.IO.File]::Open(
            $activeLockPath,
            [System.IO.FileMode]::Open,
            [System.IO.FileAccess]::Write,
            [System.IO.FileShare]::ReadWrite
        )
    } catch {
        $rawWriteException = & $unwrapTask1B1IOException $_.Exception
    } finally {
        if ($null -ne $rawWriteHandle) {
            $rawWriteHandle.Dispose()
        }
    }
    $rawReadWriteHandle = $null
    $rawReadWriteException = $null
    try {
        $rawReadWriteHandle = [System.IO.File]::Open(
            $activeLockPath,
            [System.IO.FileMode]::Open,
            [System.IO.FileAccess]::ReadWrite,
            [System.IO.FileShare]::ReadWrite
        )
    } catch {
        $rawReadWriteException = & $unwrapTask1B1IOException $_.Exception
    } finally {
        if ($null -ne $rawReadWriteHandle) {
            $rawReadWriteHandle.Dispose()
        }
    }
    $rawReadEvidence = & $getTask1B1SharingViolationEvidence $rawReadException
    $rawWriteEvidence = & $getTask1B1SharingViolationEvidence $rawWriteException
    $rawReadWriteEvidence = & $getTask1B1SharingViolationEvidence $rawReadWriteException
    & $recordTask1B1Expectation $rawReadEvidence.IsSharingViolation 'Task 1B1 read-only competing open gets Windows sharing violation' "type='$($rawReadEvidence.Type)' hresult='$($rawReadEvidence.HResult)' lowCode='$($rawReadEvidence.LowCode)'"
    & $recordTask1B1Expectation $rawWriteEvidence.IsSharingViolation 'Task 1B1 write-only competing open gets Windows sharing violation' "type='$($rawWriteEvidence.Type)' hresult='$($rawWriteEvidence.HResult)' lowCode='$($rawWriteEvidence.LowCode)'"
    & $recordTask1B1Expectation $rawReadWriteEvidence.IsSharingViolation 'Task 1B1 read-write competing open gets Windows sharing violation' "type='$($rawReadWriteEvidence.Type)' hresult='$($rawReadWriteEvidence.HResult)' lowCode='$($rawReadWriteEvidence.LowCode)'"

    $secondAcquireMessage = $null
    $unexpectedSecondDecision = $null
    $unexpectedSecondResource = $null
    try {
        $unexpectedSecondDecision = & $acquireTask1B1LockResource -AcquireFactory $productionLockFactory -AcquireFactoryAvailable $lockHelperAvailable -DeploymentPath $lockLiveRoot -ExpectedParent $lockScenarioRoot -LivePath $lockLiveRoot
        $unexpectedSecondResource = $unexpectedSecondDecision.Resource
    } catch {
        $secondAcquireMessage = $_.Exception.Message
    } finally {
        if ($null -ne $unexpectedSecondResource) {
            $unexpectedSecondResource.Handle.Dispose()
            $unexpectedSecondResource = $null
        }
        if ($null -ne $activeLockResource) {
            $activeLockResource.Handle.Dispose()
            $activeLockResource = $null
        }
        $activeLockHandle = $null
        $firstLockResource = $null
    }
    & $recordTask1B1Expectation (-not [string]::IsNullOrWhiteSpace($secondAcquireMessage) -and $secondAcquireMessage -match 'test deploy rebuild already in progress') 'Task 1B1 second concurrent acquire fails with stable error' "actual='$secondAcquireMessage'"

    $lockPersistedAfterFirstDispose = Test-Path -LiteralPath $activeLockPath -PathType Leaf
    & $recordTask1B1Expectation ($firstLockAcquiredByHelper -and $lockPersistedAfterFirstDispose) 'Task 1B1 lock file remains after first handle disposal' "lock='$activeLockPath'"
    if (-not $lockPersistedAfterFirstDispose) {
        New-Item -ItemType File -Path $activeLockPath -Force | Out-Null
    }
    $stableLockCreationTime = [DateTime]::SpecifyKind([datetime]'2001-02-03T04:05:06', [DateTimeKind]::Utc)
    [System.IO.File]::SetCreationTimeUtc($activeLockPath, $stableLockCreationTime)

    $reacquireFallbackFactory = {
        param([string] $DeploymentPath)
        $handle = [System.IO.File]::Open(
            $fallbackLockPath,
            [System.IO.FileMode]::Open,
            [System.IO.FileAccess]::ReadWrite,
            [System.IO.FileShare]::None
        )
        return [pscustomobject]@{ Handle = $handle; LockPath = $fallbackLockPath }
    }.GetNewClosure()
    $reacquireProbeCounters = & $newTask1B1ProbeCounters
    $reacquiredLockDecision = $null
    $reacquiredLockResource = $null
    $reacquiredLockPath = $null
    $reacquiredLockIdentity = $null
    $reacquiredByHelper = $false
    $reacquireMessage = $null
    try {
        $reacquiredLockDecision = & $acquireTask1B1LockResource -AcquireFactory $productionLockFactory -AcquireFactoryAvailable $lockHelperAvailable -FallbackFactory $reacquireFallbackFactory -DeploymentPath $lockLiveRoot -ExpectedParent $lockScenarioRoot -LivePath $lockLiveRoot -ProbeCounters $reacquireProbeCounters
        $reacquiredLockResource = $reacquiredLockDecision.Resource
        $reacquiredLockPath = $reacquiredLockResource.LockPath
        $reacquiredByHelper = [bool]$reacquiredLockDecision.ByHelper
        if ($reacquiredLockDecision.UsedFallback) {
            $reacquireMessage = 'Enter-TestDeployRebuildLock is unavailable; safe test fallback used'
        }
        $reacquiredLockIdentity = & $getTask1B1FileIdentity $reacquiredLockResource.Handle
    } catch {
        $reacquireMessage = $_.Exception.Message
        if ($null -ne $reacquiredLockResource) {
            $reacquiredLockResource.Handle.Dispose()
            $reacquiredLockResource = $null
        }
        $reacquiredByHelper = $false
    } finally {
        if ($null -ne $reacquiredLockResource) {
            $reacquiredLockResource.Handle.Dispose()
            $reacquiredLockResource = $null
        }
    }
    & $recordTask1B1Expectation $reacquiredByHelper 'Task 1B1 lock can be reacquired after first handle disposal' "actual='$reacquireMessage'"
    $reacquiredSamePath = $reacquiredByHelper -and $firstLockAcquiredByHelper -and $reacquiredLockPath.Equals($activeLockPath, [System.StringComparison]::OrdinalIgnoreCase)
    & $recordTask1B1Expectation $reacquiredSamePath 'Task 1B1 reacquire uses the same stable lock file path' "first='$activeLockPath' second='$(if ($reacquiredByHelper) { $reacquiredLockPath } else { '<none>' })'"

    $observedSecondLockIdentity = $reacquiredLockIdentity
    $identityFallbackMessage = $null
    if ([string]::IsNullOrWhiteSpace($observedSecondLockIdentity) -and -not $lockHelperAvailable) {
        $identityFallbackHandle = $null
        try {
            $identityFallbackHandle = [System.IO.File]::Open(
                $activeLockPath,
                [System.IO.FileMode]::Open,
                [System.IO.FileAccess]::ReadWrite,
                [System.IO.FileShare]::None
            )
            $observedSecondLockIdentity = & $getTask1B1FileIdentity $identityFallbackHandle
        } catch {
            $identityFallbackMessage = $_.Exception.Message
        } finally {
            if ($null -ne $identityFallbackHandle) {
                $identityFallbackHandle.Dispose()
            }
        }
    }
    & $recordTask1B1Expectation (-not [string]::IsNullOrWhiteSpace($observedSecondLockIdentity)) 'Task 1B1 reopened lock file exposes Windows file identity' "actual='$identityFallbackMessage'"
    $sameWindowsFileObject =
        $firstLockAcquiredByHelper -and
        $reacquiredByHelper -and
        $lockPersistedAfterFirstDispose -and
        -not [string]::IsNullOrWhiteSpace($firstLockIdentity) -and
        -not [string]::IsNullOrWhiteSpace($reacquiredLockIdentity) -and
        $firstLockIdentity -ceq $reacquiredLockIdentity
    & $recordTask1B1Expectation $sameWindowsFileObject 'Task 1B1 reacquire retains the same Windows file object without delete/recreate' "firstIdentity='$firstLockIdentity' secondIdentity='$reacquiredLockIdentity' observedFallbackIdentity='$observedSecondLockIdentity'"

    $lockStillExists = $false
    $lockCreationTimeAfterReacquire = [datetime]::MinValue
    if ($reacquiredByHelper -or -not $lockHelperAvailable) {
        $lockStillExists = Test-Path -LiteralPath $activeLockPath -PathType Leaf
        $lockCreationTimeAfterReacquire = if ($lockStillExists) { [System.IO.File]::GetCreationTimeUtc($activeLockPath) } else { [datetime]::MinValue }
    }
    & $recordTask1B1Expectation ($firstLockAcquiredByHelper -and $reacquiredByHelper -and $lockStillExists -and $lockCreationTimeAfterReacquire -eq $stableLockCreationTime) 'Task 1B1 lock creation time remains stable as auxiliary identity evidence' "exists=$lockStillExists expectedCreation='$($stableLockCreationTime.ToString('O'))' actualCreation='$($lockCreationTimeAfterReacquire.ToString('O'))'"
        }
    } finally {
        if ($null -ne $activeLockResource) {
            $activeLockResource.Handle.Dispose()
            $activeLockResource = $null
        }
        $activeLockHandle = $null
        if ($null -ne $firstLockResource) {
            $firstLockResource.Handle.Dispose()
            $firstLockResource = $null
        }
        if ($null -ne $reacquiredLockResource) {
            $reacquiredLockResource.Handle.Dispose()
            $reacquiredLockResource = $null
        }
    }
    $task1B1ScenariosExecuted.Add('exclusive lock contention and reacquire') | Out-Null

    # Integration ordering tripwire: hold both the deployment lock and an env
    # file with FileShare.None.  Correct code reports lock contention before it
    # ever touches the unreadable env file; missing/late lock wiring instead leaks
    # an env sharing error.  Only process boundaries are injected.
    $lockIntegrationScenario = Join-Path $sandbox 'task-1b1-lock-integration'
    $lockIntegrationLive = Join-Path $lockIntegrationScenario 'live'
    & $newTransactionFixture $lockIntegrationLive
    $lockIntegrationManifestBefore = & $getTransactionLiveManifest $lockIntegrationLive
    $lockIntegrationFallbackPath = Join-Path $lockIntegrationScenario ".$((Split-Path -Leaf $lockIntegrationLive)).rebuild.lock"
    $integrationFallbackFactory = {
        param([string] $DeploymentPath)
        $handle = [System.IO.File]::Open(
            $lockIntegrationFallbackPath,
            [System.IO.FileMode]::OpenOrCreate,
            [System.IO.FileAccess]::ReadWrite,
            [System.IO.FileShare]::None
        )
        return [pscustomobject]@{ Handle = $handle; LockPath = $lockIntegrationFallbackPath }
    }.GetNewClosure()
    $integrationProbeCounters = & $newTask1B1ProbeCounters
    $integrationLockDecision = $null
    $integrationLockResource = $null
    $integrationLockByHelper = $false
    $lockIntegrationAcquireMessage = $null
    $lockIntegrationActiveResource = $null
    $lockIntegrationHandle = $null
    try {
        try {
            $integrationLockDecision = & $acquireTask1B1LockResource -AcquireFactory $productionLockFactory -AcquireFactoryAvailable $lockHelperAvailable -FallbackFactory $integrationFallbackFactory -DeploymentPath $lockIntegrationLive -ExpectedParent $lockIntegrationScenario -LivePath $lockIntegrationLive -ProbeCounters $integrationProbeCounters
            $integrationLockResource = $integrationLockDecision.Resource
            $integrationLockByHelper = [bool]$integrationLockDecision.ByHelper
            if ($integrationLockDecision.UsedFallback) {
                $lockIntegrationAcquireMessage = 'Enter-TestDeployRebuildLock is unavailable; safe test fallback used'
            }
        } catch {
            $lockIntegrationAcquireMessage = $_.Exception.Message
            if ($null -ne $integrationLockResource) {
                $integrationLockResource.Handle.Dispose()
                $integrationLockResource = $null
            }
            $integrationLockByHelper = $false
        }
        & $recordTask1B1Expectation $integrationLockByHelper 'Task 1B1 integration acquires the production rebuild lock helper' "actual='$lockIntegrationAcquireMessage'"
        if ($null -ne $integrationLockResource) {
            $lockIntegrationActiveResource = $integrationLockResource
            $integrationLockResource = $null
            $lockIntegrationHandle = $lockIntegrationActiveResource.Handle
        }

        # As with the first acquire, a returned-but-rejected helper candidate
        # disables fallback and prevents all subsequent active-path operations.
        if ($null -ne $lockIntegrationActiveResource) {
    $lockIntegrationParentBefore = & $getTask1B1ParentInventory $lockIntegrationScenario
    $lockIntegrationEnvHandle = $null
    $lockIntegrationCommands = New-Object 'System.Collections.Generic.List[string]'
    $lockIntegrationCloneTargets = New-Object 'System.Collections.Generic.List[string]'
    $lockIntegrationStops = New-Object 'System.Collections.Generic.List[string]'
    $lockIntegrationDeployCalls = New-Object 'System.Collections.Generic.List[string]'
    $lockIntegrationOrigin = $transactionOriginUrl
    $lockIntegrationRunner = {
        param([string] $Tool, [string[]] $Arguments, [string] $WorkingDirectory)
        $commandText = $Arguments -join ' '
        $lockIntegrationCommands.Add($commandText) | Out-Null
        if ($commandText -eq 'remote get-url origin') {
            return [pscustomobject]@{ ExitCode = 0; Output = $lockIntegrationOrigin }
        }
        if ($Arguments -contains 'clone') {
            $lockIntegrationCloneTargets.Add([System.IO.Path]::GetFullPath([string]$Arguments[-1])) | Out-Null
            return [pscustomobject]@{ ExitCode = 98; Output = 'lock contention must precede clone' }
        }
        return [pscustomobject]@{ ExitCode = 0; Output = 'ok' }
    }.GetNewClosure()
    $lockIntegrationStopper = {
        param([string] $ServiceName, [string] $ServiceRunDir)
        $lockIntegrationStops.Add($ServiceName) | Out-Null
    }.GetNewClosure()
    $lockIntegrationDeployRunner = {
        param([string] $DeployRoot)
        $lockIntegrationDeployCalls.Add($DeployRoot) | Out-Null
        return [pscustomobject]@{ ExitCode = 0 }
    }.GetNewClosure()
    $lockIntegrationFailureMessage = $null
    try {
        $lockIntegrationEnvHandle = [System.IO.File]::Open(
            (Join-Path $lockIntegrationLive '.env'),
            [System.IO.FileMode]::Open,
            [System.IO.FileAccess]::ReadWrite,
            [System.IO.FileShare]::None
        )
        try {
            Invoke-TestDeployRebuild -Build -RepoRoot $rebuildRoot -DeploymentPath $lockIntegrationLive -AllowNonFixedPathForTests -CommandRunner $lockIntegrationRunner -DeployRunner $lockIntegrationDeployRunner -ServiceStopper $lockIntegrationStopper | Out-Null
        } catch {
            $lockIntegrationFailureMessage = $_.Exception.Message
        }
    } finally {
        if ($null -ne $lockIntegrationEnvHandle) {
            $lockIntegrationEnvHandle.Dispose()
            $lockIntegrationEnvHandle = $null
        }
    }
    $lockIntegrationManifestAfter = & $getTransactionLiveManifest $lockIntegrationLive
    $lockIntegrationParentAfter = & $getTask1B1ParentInventory $lockIntegrationScenario
    & $recordTask1B1Expectation (-not [string]::IsNullOrWhiteSpace($lockIntegrationFailureMessage) -and $lockIntegrationFailureMessage -match 'test deploy rebuild already in progress') 'Task 1B1 held deployment lock blocks rebuild before env backup' "actual='$lockIntegrationFailureMessage' commands='$($lockIntegrationCommands -join ';')'"
    & $recordTask1B1Expectation ($lockIntegrationManifestAfter.Serialized -ceq $lockIntegrationManifestBefore.Serialized) 'Task 1B1 held-lock integration leaves complete live manifest identical' "before='$($lockIntegrationManifestBefore.Sha256)' after='$($lockIntegrationManifestAfter.Sha256)'"
    & $recordTask1B1Expectation ($lockIntegrationParentAfter -ceq $lockIntegrationParentBefore) 'Task 1B1 held-lock integration creates no run/stage/backup residue' "before='$lockIntegrationParentBefore' after='$lockIntegrationParentAfter'"
    & $recordTask1B1Expectation ($lockIntegrationCommands.Count -eq 0) 'Task 1B1 held-lock integration performs zero Git or origin commands' "commands='$($lockIntegrationCommands -join ';')'"
    & $recordTask1B1Expectation ($lockIntegrationCloneTargets.Count -eq 0) 'Task 1B1 held-lock integration performs zero clones' "targets='$($lockIntegrationCloneTargets -join ',')' commands='$($lockIntegrationCommands -join ';')'"
    & $recordTask1B1Expectation ($lockIntegrationStops.Count -eq 0) 'Task 1B1 held-lock integration performs zero service stops' "stopped='$($lockIntegrationStops -join ',')'"
    & $recordTask1B1Expectation ($lockIntegrationDeployCalls.Count -eq 0) 'Task 1B1 held-lock integration performs zero deploys' "deployCalls=$($lockIntegrationDeployCalls.Count)"
        }
    } finally {
        if ($null -ne $lockIntegrationActiveResource) {
            $lockIntegrationActiveResource.Handle.Dispose()
            $lockIntegrationActiveResource = $null
        }
        $lockIntegrationHandle = $null
        if ($null -ne $integrationLockResource) {
            $integrationLockResource.Handle.Dispose()
            $integrationLockResource = $null
        }
    }
    $task1B1ScenariosExecuted.Add('held-lock rebuild integration') | Out-Null

    & $recordTask1B1Expectation ($task1B1ScenariosExecuted.Count -eq 7) 'Task 1B1 executes every requested path/reparse/lock scenario' "executed='$($task1B1ScenariosExecuted -join ',')'"
    Write-Host "[Task 1B1 RED] scenarios executed: $($task1B1ScenariosExecuted -join '; ')"
    if ($task1B1RedFailures.Count -gt 0) {
        throw "Task 1B1 wished-for RED behaviors unmet:$([Environment]::NewLine) - $($task1B1RedFailures -join "$([Environment]::NewLine) - ")"
    }

    Write-TestPass $testName
} catch {
    Write-TestFail $testName $_.Exception.Message
    throw
} finally {
    if ($null -ne (Get-Variable -Name task1B1OriginalFixedPath -ErrorAction SilentlyContinue)) {
        $script:TestDeployFixedPath = $task1B1OriginalFixedPath
    }
    if ($null -ne (Get-Variable -Name task1B1FixtureReparsePaths -ErrorAction SilentlyContinue)) {
        foreach ($fixtureReparsePath in $task1B1FixtureReparsePaths) {
            $remainingFixtureReparse = Get-Item -LiteralPath $fixtureReparsePath -Force -ErrorAction SilentlyContinue
            if ($null -ne $remainingFixtureReparse) {
                throw "Task 1B1 refused generic sandbox cleanup while fixture reparse remains attached: '$fixtureReparsePath'"
            }
        }
    }
    Remove-TestSandbox -Path $sandbox
}
