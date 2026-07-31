Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'design-assets.ps1')
. (Join-Path $PSScriptRoot 'deploy-target-registry.ps1')
Import-Module -Force (Join-Path $PSScriptRoot 'StructLog.psm1')

$script:TestDeployStructLogger = $null

function Get-TestDeployStructLogger {
    [CmdletBinding()]
    param()

    if ($null -eq $script:TestDeployStructLogger) {
        $script:TestDeployStructLogger = New-StructLogger `
            -Service 'scripts' `
            -Component 'rebuild-test-deploy' `
            -SkipEnvSnapshot
    }
    return $script:TestDeployStructLogger
}

function Write-TestDeployLifecycleLog {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string] $Message,
        [hashtable] $Data = @{},
        [ValidateSet('debug', 'info', 'warn', 'error', 'fatal')][string] $Level = 'info'
    )

    Get-TestDeployStructLogger |
        Write-StructLifecycle -Msg $Message -Data $Data -Level $Level
}

# This local rebuild routine only knows how to rebuild the local Windows
# deployment; it resolves that target explicitly by id. Dispatch by canonical
# target (SSH transport to remote-linux-181) lands with plan tasks B6/B8.
$script:TestDeployTargetProfile = Get-DeployTarget -Id 'local-windows'
$script:TestDeployFixedPath = [string]$script:TestDeployTargetProfile.deploy_root
$script:TestDeployRootToolingDirNames = @(
    '.codex',
    '.agents',
    '.agent',
    '.claude',
    '.cursor',
    '.windsurf',
    '.github\skills',
    '.github\prompts',
    'docs',
    'openspec',
    'patches'
)
$script:TestDeployPreservedEnvFiles = @(
    '.env',
    'bim-review-coordinator\.env',
    '.env.web-plane.host-kit'
)
# Production build dependencies that live under removed tooling dirs.
# EdgeConsole.tsx imports docs/plans/ai-bim-governance.css (design token
# authority); the coordinator/viewer docker builds COPY it from the checkout.
$script:TestDeployPreservedProductionFiles = @(
    'docs\plans\ai-bim-governance.css'
)
$script:TestDeployEdgeSiteId = [string]$script:TestDeployTargetProfile.edge_site_id
$script:TestDeployEdgeRuntimeDataRoot = [string]$script:TestDeployTargetProfile.runtime_data_root

function Get-TestDeployGitCleanArguments {
    [CmdletBinding()]
    param()

    return @(
        'clean',
        '-fdx',
        '-e',
        'bim-streaming-server/_build/**/logs/**',
        '-e',
        'web-viewer-sample/public/design-assets/',
        '-e',
        'web-viewer-sample/public/.design-assets-stage-*',
        '-e',
        'web-viewer-sample/public/.design-assets-backup-*',
        '-e',
        'web-viewer-sample/public/.design-assets-sync.lock'
    )
}

function Normalize-TestDeployPath {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string] $Path
    )

    if ([string]::IsNullOrWhiteSpace($Path)) {
        throw 'deployment path must not be empty'
    }

    $fullPath = [System.IO.Path]::GetFullPath($Path)
    return $fullPath.TrimEnd([char[]]@('\', '/'))
}

function Assert-TestDeployPathComponentsSafety {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string] $Path
    )

    $fullPath = Normalize-TestDeployPath -Path $Path
    $pathRoot = [System.IO.Path]::GetPathRoot($fullPath)
    if ([string]::IsNullOrWhiteSpace($pathRoot)) {
        throw "deployment path has no filesystem root: '$fullPath'"
    }

    $currentPath = $pathRoot
    $relativePath = $fullPath.Substring($pathRoot.Length)
    foreach ($segment in @($relativePath.Split(
        [char[]]@([System.IO.Path]::DirectorySeparatorChar, [System.IO.Path]::AltDirectorySeparatorChar),
        [System.StringSplitOptions]::RemoveEmptyEntries
    ))) {
        $currentPath = Join-Path $currentPath $segment
        try {
            $item = Get-Item -LiteralPath $currentPath -Force -ErrorAction Stop
        } catch [System.Management.Automation.ItemNotFoundException] {
            break
        } catch [System.IO.DirectoryNotFoundException] {
            break
        } catch {
            throw "deployment path component inspection failed for '$currentPath': $($_.Exception.Message)"
        }
        if ([bool]($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint)) {
            throw "deployment path contains reparse point: '$($item.FullName)'"
        }
    }

    return $fullPath
}

function Assert-TestDeployPathSafety {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string] $Path
    )

    $fullPath = Assert-TestDeployPathComponentsSafety -Path $Path
    if (-not (Test-Path -LiteralPath $fullPath -PathType Container)) {
        return $fullPath
    }

    $pendingDirectories = New-Object 'System.Collections.Generic.Queue[string]'
    $pendingDirectories.Enqueue($fullPath)
    while ($pendingDirectories.Count -gt 0) {
        $directory = $pendingDirectories.Dequeue()
        foreach ($item in @(Get-ChildItem -LiteralPath $directory -Force -ErrorAction Stop)) {
            if ([bool]($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint)) {
                throw "deployment path contains reparse point: '$($item.FullName)'"
            }
            if ($item.PSIsContainer) {
                $pendingDirectories.Enqueue($item.FullName)
            }
        }
    }

    return $fullPath
}

function Enter-TestDeployRebuildLock {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string] $DeploymentPath
    )

    $deployRoot = Assert-TestDeployPathComponentsSafety -Path $DeploymentPath
    $deployParent = Split-Path -Parent $deployRoot
    if ([string]::IsNullOrWhiteSpace($deployParent) -or -not (Test-Path -LiteralPath $deployParent -PathType Container)) {
        throw "deployment parent does not exist: '$deployParent'"
    }

    $deployLeaf = Split-Path -Leaf $deployRoot
    $lockPath = Normalize-TestDeployPath -Path (Join-Path $deployParent ".$deployLeaf.rebuild.lock")
    Assert-TestDeployPathComponentsSafety -Path $lockPath | Out-Null
    $handle = $null
    try {
        $handle = [System.IO.File]::Open(
            $lockPath,
            [System.IO.FileMode]::OpenOrCreate,
            [System.IO.FileAccess]::ReadWrite,
            [System.IO.FileShare]::None
        )
    } catch [System.IO.IOException] {
        $lowCode = [int]$_.Exception.HResult -band 0xFFFF
        if ($lowCode -in @(32, 33)) {
            throw "test deploy rebuild already in progress for '$deployRoot'"
        }
        throw "failed to acquire test deploy rebuild lock '$lockPath': $($_.Exception.Message)"
    }

    return [pscustomobject]@{
        Handle = $handle
        LockPath = $lockPath
    }
}

function Test-TestDeployBrokenGitFile {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string] $GitPath
    )

    if (-not (Test-Path -LiteralPath $GitPath -PathType Leaf)) {
        return $false
    }

    try {
        $gitFileText = [System.IO.File]::ReadAllText($GitPath).Trim()
    } catch {
        throw "deployment gitfile inspection failed for '$GitPath': $($_.Exception.Message)"
    }

    if ($gitFileText -notmatch '^gitdir:\s*(.+)$') {
        return $true
    }

    $gitDirValue = $Matches[1].Trim()
    if ([string]::IsNullOrWhiteSpace($gitDirValue)) {
        return $true
    }

    try {
        $gitDirPath = if ([System.IO.Path]::IsPathRooted($gitDirValue)) {
            [System.IO.Path]::GetFullPath($gitDirValue)
        } else {
            [System.IO.Path]::GetFullPath((Join-Path (Split-Path -Parent $GitPath) $gitDirValue))
        }
    } catch {
        return $true
    }

    return -not (Test-Path -LiteralPath $gitDirPath -PathType Container)
}

function Assert-TestDeployPath {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string] $Path
    )

    $expected = Normalize-TestDeployPath -Path $script:TestDeployFixedPath
    $actual = Normalize-TestDeployPath -Path $Path
    if ($actual -ine $expected) {
        throw "deployment path must be '$expected', got '$actual'"
    }

    return $expected
}

function Assert-TestDeployTransactionStagePath {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string] $Path,
        [Parameter(Mandatory = $true)][string] $DeploymentPath
    )

    $deployRoot = Assert-TestDeployPath -Path $DeploymentPath
    $stageRoot = Normalize-TestDeployPath -Path $Path
    $deployParent = Normalize-TestDeployPath -Path (Split-Path -Parent $deployRoot)
    $stageParent = Normalize-TestDeployPath -Path (Split-Path -Parent $stageRoot)
    if (-not $stageParent.Equals($deployParent, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "deployment transaction stage must be a sibling of '$deployRoot', got '$stageRoot'"
    }

    $deployLeaf = Split-Path -Leaf $deployRoot
    $stageLeaf = Split-Path -Leaf $stageRoot
    $stageLeafPattern = "^\.$([regex]::Escape($deployLeaf))\.rebuild-stage-[0-9a-f]{32}$"
    if ($stageLeaf -cnotmatch $stageLeafPattern) {
        throw "deployment transaction stage name is invalid: '$stageLeaf'"
    }

    Assert-TestDeployPathSafety -Path $stageRoot | Out-Null
    return $stageRoot
}

function Resolve-TestDeployMutationRoot {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string] $Path,
        [switch] $AllowNonFixedPathForTests,
        [string] $TransactionForDeploymentPath = ''
    )

    if ($AllowNonFixedPathForTests -and -not [string]::IsNullOrWhiteSpace($TransactionForDeploymentPath)) {
        throw 'test path escape and production transaction scope are mutually exclusive'
    }
    if ($AllowNonFixedPathForTests) {
        return Normalize-TestDeployPath -Path $Path
    }
    if (-not [string]::IsNullOrWhiteSpace($TransactionForDeploymentPath)) {
        return Assert-TestDeployTransactionStagePath -Path $Path -DeploymentPath $TransactionForDeploymentPath
    }
    return Assert-TestDeployPath -Path $Path
}

function Get-TestDeployRootToolingDirs {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string] $DeploymentPath
    )

    $root = Normalize-TestDeployPath -Path $DeploymentPath
    $paths = foreach ($dirName in $script:TestDeployRootToolingDirNames) {
        Join-Path $root $dirName
    }

    return @($paths)
}

function Remove-TestDeployAgentTooling {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string] $DeploymentPath,
        [switch] $AllowNonFixedPathForTests,
        [string] $TransactionForDeploymentPath = ''
    )

    $root = Resolve-TestDeployMutationRoot `
        -Path $DeploymentPath `
        -AllowNonFixedPathForTests:$AllowNonFixedPathForTests `
        -TransactionForDeploymentPath $TransactionForDeploymentPath

    if (-not (Test-Path -LiteralPath $root -PathType Container)) {
        throw "deployment path does not exist: $root"
    }

    $removed = New-Object 'System.Collections.Generic.List[string]'
    foreach ($fileName in @('AGENTS.md', 'CLAUDE.md')) {
        $files = Get-ChildItem -LiteralPath $root -Filter $fileName -Recurse -File -Force -ErrorAction Stop
        foreach ($file in $files) {
            Remove-Item -LiteralPath $file.FullName -Force -ErrorAction Stop
            $removed.Add($file.FullName) | Out-Null
        }
    }

    $preserved = New-Object 'System.Collections.Generic.List[object]'
    foreach ($relativePath in $script:TestDeployPreservedProductionFiles) {
        $filePath = Join-Path $root $relativePath
        if (Test-Path -LiteralPath $filePath -PathType Leaf) {
            $preserved.Add([pscustomobject]@{
                RelativePath = $relativePath
                Bytes = [System.IO.File]::ReadAllBytes($filePath)
            }) | Out-Null
        }
    }

    foreach ($dirPath in (Get-TestDeployRootToolingDirs -DeploymentPath $root)) {
        if (Test-Path -LiteralPath $dirPath -PathType Container) {
            Remove-Item -LiteralPath $dirPath -Recurse -Force -ErrorAction Stop
            $removed.Add($dirPath) | Out-Null
        }
    }

    foreach ($entry in $preserved) {
        $filePath = Join-Path $root $entry.RelativePath
        $parent = Split-Path -Parent $filePath
        if (-not (Test-Path -LiteralPath $parent -PathType Container)) {
            New-Item -ItemType Directory -Path $parent -Force -ErrorAction Stop | Out-Null
        }
        [System.IO.File]::WriteAllBytes($filePath, $entry.Bytes)
    }

    return @($removed.ToArray())
}

function Initialize-TestDeployDesignAssets {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string] $DeploymentPath,
        [switch] $AllowNonFixedPathForTests,
        [string] $TransactionForDeploymentPath = '',
        [AllowNull()][object] $DesignAssetLockHandle = $null
    )

    $root = Resolve-TestDeployMutationRoot `
        -Path $DeploymentPath `
        -AllowNonFixedPathForTests:$AllowNonFixedPathForTests `
        -TransactionForDeploymentPath $TransactionForDeploymentPath

    $sourceDirs = @(
        (Join-Path $root 'docs\plans\assets'),
        (Join-Path $root 'docs\plans\uploads')
    )
    $available = @($sourceDirs | Where-Object { Test-Path -LiteralPath $_ -PathType Container })
    if ($AllowNonFixedPathForTests -and $available.Count -eq 0) {
        return $null
    }
    return Sync-DeploymentDesignAssets -RepoRoot $root -LockHandle $DesignAssetLockHandle
}

function Save-TestDeployEnvSnapshot {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string] $DeploymentPath
    )

    $root = Assert-TestDeployPathComponentsSafety -Path $DeploymentPath
    $snapshot = New-Object 'System.Collections.Generic.List[object]'
    foreach ($relativePath in $script:TestDeployPreservedEnvFiles) {
        $envPath = Join-Path $root $relativePath
        Assert-TestDeployPathComponentsSafety -Path $envPath | Out-Null
        if (-not (Test-Path -LiteralPath $envPath -PathType Leaf)) { continue }
        $snapshot.Add([pscustomobject]@{
            RelativePath = $relativePath
            Bytes = [System.IO.File]::ReadAllBytes($envPath)
        }) | Out-Null
    }

    return @($snapshot.ToArray())
}

function Restore-TestDeployEnvSnapshot {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string] $DeploymentPath,
        $Snapshot = @()
    )

    $root = Assert-TestDeployPathComponentsSafety -Path $DeploymentPath
    $restored = New-Object 'System.Collections.Generic.List[string]'
    $failures = New-Object 'System.Collections.Generic.List[string]'
    foreach ($entry in @($Snapshot)) {
        if ($null -eq $entry) { continue }
        $relativePath = [string]$entry.RelativePath
        if ([string]::IsNullOrWhiteSpace($relativePath)) { continue }

        $envPath = Join-Path $root $relativePath
        Assert-TestDeployPathComponentsSafety -Path $envPath | Out-Null
        $parent = Split-Path -Parent $envPath
        if (-not (Test-Path -LiteralPath $parent -PathType Container)) {
            New-Item -ItemType Directory -Path $parent -Force | Out-Null
        }
        Assert-TestDeployPathComponentsSafety -Path $envPath | Out-Null

        try {
            [System.IO.File]::WriteAllBytes($envPath, [byte[]]$entry.Bytes)
            $restoredBytes = [System.IO.File]::ReadAllBytes($envPath)
            $expectedBytes = [byte[]]$entry.Bytes
            $bytesMatch = $restoredBytes.Length -eq $expectedBytes.Length
            if ($bytesMatch) {
                for ($index = 0; $index -lt $expectedBytes.Length; $index++) {
                    if ($restoredBytes[$index] -ne $expectedBytes[$index]) {
                        $bytesMatch = $false
                        break
                    }
                }
            }
            if (-not $bytesMatch) {
                throw 'restored bytes do not match the preserved snapshot'
            }
            $restored.Add($relativePath) | Out-Null
        } catch {
            $failures.Add("$relativePath`: $_") | Out-Null
        }
    }

    if ($failures.Count -gt 0) {
        $summary = $failures -join '; '
        throw "Restore-TestDeployEnvSnapshot: failed to restore $($failures.Count) env file(s): $summary"
    }

    return @($restored.ToArray())
}

function Resolve-TestDeployEdgeRuntimeContract {
    [CmdletBinding()]
    param()

    $edgeSiteId = [Environment]::GetEnvironmentVariable('EDGE_SITE_ID', 'Process')
    if ([string]::IsNullOrWhiteSpace($edgeSiteId)) {
        $edgeSiteId = $script:TestDeployEdgeSiteId
    }

    $edgeRuntimeDataRoot = [Environment]::GetEnvironmentVariable('EDGE_RUNTIME_DATA_ROOT', 'Process')
    if ([string]::IsNullOrWhiteSpace($edgeRuntimeDataRoot)) {
        $edgeRuntimeDataRoot = $script:TestDeployEdgeRuntimeDataRoot
    }
    $edgeRuntimeDataRoot = Normalize-TestDeployPath -Path $edgeRuntimeDataRoot

    $runtimeStorageRoot = Join-Path $edgeRuntimeDataRoot 'storage'
    $artifactsRoot = Join-Path $edgeRuntimeDataRoot 'artifacts'
    $ledgerRoot = Join-Path $edgeRuntimeDataRoot 'ledgers'
    foreach ($dirPath in @($runtimeStorageRoot, $artifactsRoot, $ledgerRoot)) {
        if (-not (Test-Path -LiteralPath $dirPath -PathType Container)) {
            New-Item -ItemType Directory -Path $dirPath -Force | Out-Null
        }
    }

    return [pscustomobject]@{
        EDGE_SITE_ID                       = $edgeSiteId
        EDGE_RUNTIME_DATA_ROOT             = $edgeRuntimeDataRoot
        RUNTIME_STORAGE_ROOT               = $runtimeStorageRoot
        STORAGE_HOST_ROOT                  = $runtimeStorageRoot
        STREAMING_CONVERSION_ARTIFACTS_ROOT = $artifactsRoot
        CONVERSION_LEDGER_STORE_PATH       = Join-Path $ledgerRoot 'conversion-ledger.json'
        ARTIFACT_HEALTH_LEDGER_STORE_PATH  = Join-Path $ledgerRoot 'artifact-health-ledger.json'
    }
}

function Push-TestDeployProcessEnv {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)] $Contract
    )

    $backup = @{}
    foreach ($name in @(
        'EDGE_SITE_ID',
        'EDGE_RUNTIME_DATA_ROOT',
        'RUNTIME_STORAGE_ROOT',
        'STORAGE_HOST_ROOT',
        'STREAMING_CONVERSION_ARTIFACTS_ROOT',
        'CONVERSION_LEDGER_STORE_PATH',
        'ARTIFACT_HEALTH_LEDGER_STORE_PATH'
    )) {
        $backup[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
        [Environment]::SetEnvironmentVariable($name, [string]$Contract.$name, 'Process')
    }

    return $backup
}

function Restore-TestDeployProcessEnv {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][hashtable] $Backup
    )

    foreach ($name in $Backup.Keys) {
        $value = $Backup[$name]
        if ($null -eq $value) {
            Remove-Item -LiteralPath "Env:$name" -ErrorAction SilentlyContinue
        } else {
            [Environment]::SetEnvironmentVariable($name, $value, 'Process')
        }
    }
}

function Assert-TestDeployOriginUrlSafe {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string] $OriginUrl
    )

    $candidate = $OriginUrl.Trim()
    if ([string]::IsNullOrWhiteSpace($candidate)) {
        throw 'current repo origin URL is empty'
    }
    if ($candidate.StartsWith('-', [System.StringComparison]::Ordinal)) {
        throw 'current repo origin URL is invalid'
    }
    if ($candidate.Contains('?') -or $candidate.Contains('#')) {
        throw 'credential-bearing origin URL is not allowed; use a credential manager or SSH agent'
    }

    $decodeUserInfo = {
        param([Parameter(Mandatory = $true)][string] $Value)

        $decoded = $Value
        for ($decodeAttempt = 0; $decodeAttempt -lt 8; $decodeAttempt++) {
            try {
                $next = [System.Uri]::UnescapeDataString($decoded)
            } catch {
                throw 'current repo origin URL is invalid'
            }
            if ($next -ceq $decoded) {
                return $decoded
            }
            $decoded = $next
        }
        throw 'current repo origin URL is invalid'
    }

    $uri = $null
    $looksLikeUri = $candidate -match '^[A-Za-z][A-Za-z0-9+.-]*://'
    $isAbsoluteUri = [System.Uri]::TryCreate(
        $candidate,
        [System.UriKind]::Absolute,
        [ref]$uri
    )
    $scpLikeMatch = [regex]::Match(
        $candidate,
        '^(?<user>[^@/\\:\s]+)@(?<host>\[[^\]]+\]|[^:/\\\s]+):(?<path>.+)$'
    )
    if ($scpLikeMatch.Success) {
        $decodedScpUser = & $decodeUserInfo $scpLikeMatch.Groups['user'].Value
        if ($decodedScpUser.Contains(':')) {
            throw 'credential-bearing origin URL is not allowed; use a credential manager or SSH agent'
        }
        return $candidate
    }

    if ($looksLikeUri -and -not $isAbsoluteUri) {
        throw 'current repo origin URL is invalid'
    }
    if (-not $looksLikeUri) {
        if ([System.IO.Path]::IsPathRooted($candidate)) {
            return $candidate
        }
        if ($isAbsoluteUri) {
            throw 'current repo origin URL is invalid'
        }
        return $candidate
    }

    $scheme = $uri.Scheme.ToLowerInvariant()
    $hasUserInfo = -not [string]::IsNullOrWhiteSpace($uri.UserInfo)
    $decodedUserInfo = if ($hasUserInfo) {
        & $decodeUserInfo $uri.UserInfo
    } else {
        ''
    }
    $hasCredentialUserInfo =
        ($hasUserInfo -and $scheme -ne 'ssh') -or
        ($hasUserInfo -and $decodedUserInfo.Contains(':'))
    $hasQueryOrFragment =
        -not [string]::IsNullOrWhiteSpace($uri.Query) -or
        -not [string]::IsNullOrWhiteSpace($uri.Fragment)
    if ($hasCredentialUserInfo -or $hasQueryOrFragment) {
        throw 'credential-bearing origin URL is not allowed; use a credential manager or SSH agent'
    }

    return $candidate
}

function ConvertTo-TestDeployNativeArgument {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][AllowEmptyString()][string] $Value
    )

    if ($Value.Length -gt 0 -and $Value -notmatch '[\s"]') {
        return $Value
    }

    # Windows CreateProcess receives one command-line string. Quote according to
    # CommandLineToArgvW rules so PS5/.NET Framework preserves spaces, quotes,
    # and trailing backslashes exactly. PS7 uses ProcessStartInfo.ArgumentList.
    $builder = New-Object System.Text.StringBuilder
    [void]$builder.Append('"')
    $backslashes = 0
    foreach ($character in $Value.ToCharArray()) {
        if ($character -eq '\') {
            $backslashes += 1
            continue
        }
        if ($character -eq '"') {
            if ($backslashes -gt 0) {
                [void]$builder.Append(('\' * ($backslashes * 2)))
            }
            [void]$builder.Append('\"')
        } else {
            if ($backslashes -gt 0) {
                [void]$builder.Append(('\' * $backslashes))
            }
            [void]$builder.Append($character)
        }
        $backslashes = 0
    }
    if ($backslashes -gt 0) {
        [void]$builder.Append(('\' * ($backslashes * 2)))
    }
    [void]$builder.Append('"')
    return $builder.ToString()
}

function Invoke-TestDeployGitCommand {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string] $Tool,
        [Parameter(Mandatory = $true)][string[]] $Arguments,
        [Parameter(Mandatory = $true)][string] $WorkingDirectory,
        [scriptblock] $CommandRunner = $null
    )

    $toolLabel = [System.IO.Path]::GetFileName($Tool)
    $operationLabel = if (
        $Arguments.Count -gt 0 -and
        $Arguments[0] -match '^[A-Za-z0-9._/-]+$'
    ) {
        $Arguments[0]
    } else {
        'command'
    }
    $command = "$toolLabel $operationLabel"
    if ($null -ne $CommandRunner) {
        $result = & $CommandRunner $Tool $Arguments $WorkingDirectory
    } else {
        $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
        $startInfo.FileName = $Tool
        $startInfo.WorkingDirectory = $WorkingDirectory
        $startInfo.UseShellExecute = $false
        $startInfo.CreateNoWindow = $true
        $startInfo.RedirectStandardOutput = $true
        $startInfo.RedirectStandardError = $true
        if ($null -ne $startInfo.PSObject.Properties['ArgumentList']) {
            foreach ($argument in $Arguments) {
                $startInfo.ArgumentList.Add($argument)
            }
        } else {
            $startInfo.Arguments = @(
                $Arguments | ForEach-Object { ConvertTo-TestDeployNativeArgument -Value $_ }
            ) -join ' '
        }

        $process = [System.Diagnostics.Process]::new()
        $process.StartInfo = $startInfo
        try {
            if (-not $process.Start()) {
                throw "$command failed to start"
            }
            $stdoutTask = $process.StandardOutput.ReadToEndAsync()
            $stderrTask = $process.StandardError.ReadToEndAsync()
            $process.WaitForExit()
            $stdoutText = $stdoutTask.GetAwaiter().GetResult()
            $stderrText = $stderrTask.GetAwaiter().GetResult()
            $outputParts = @()
            if (-not [string]::IsNullOrEmpty($stdoutText)) {
                $outputParts += $stdoutText.TrimEnd([char[]]@("`r", "`n"))
            }
            if (-not [string]::IsNullOrEmpty($stderrText)) {
                $outputParts += $stderrText.TrimEnd([char[]]@("`r", "`n"))
            }
            $result = [pscustomobject]@{
                ExitCode = [int]$process.ExitCode
                Output = ($outputParts -join [Environment]::NewLine)
            }
        } finally {
            $process.Dispose()
        }
    }

    if ($result.ExitCode -ne 0) {
        throw "$command failed with exit code $($result.ExitCode): $($result.Output)"
    }

    return $result
}

function Get-TestDeployPruningContract {
    [CmdletBinding()]
    param()

    return [pscustomobject]@{
        RootToolingDirNames = @($script:TestDeployRootToolingDirNames)
        PreservedProductionFiles = @($script:TestDeployPreservedProductionFiles)
    }
}

function Get-TestDeployWindowsPowerShellChildEnvironment {
    [CmdletBinding()]
    param()

    $systemRoot = [Environment]::GetEnvironmentVariable('SystemRoot', 'Machine')
    if ([string]::IsNullOrWhiteSpace($systemRoot)) {
        $systemRoot = [Environment]::GetEnvironmentVariable('SystemRoot', 'Process')
    }
    $programFiles = [Environment]::GetEnvironmentVariable('ProgramFiles', 'Machine')
    if ([string]::IsNullOrWhiteSpace($programFiles)) {
        $programFiles = [Environment]::GetEnvironmentVariable('ProgramFiles', 'Process')
    }
    $programFilesX86 = [Environment]::GetEnvironmentVariable('ProgramFiles(x86)', 'Machine')
    if ([string]::IsNullOrWhiteSpace($programFilesX86)) {
        $programFilesX86 = [Environment]::GetEnvironmentVariable('ProgramFiles(x86)', 'Process')
    }

    $candidateRoots = @()
    if (-not [string]::IsNullOrWhiteSpace($systemRoot)) {
        $candidateRoots += Join-Path $systemRoot 'System32\WindowsPowerShell\v1.0\Modules'
    }
    if (-not [string]::IsNullOrWhiteSpace($programFiles)) {
        $candidateRoots += Join-Path $programFiles 'WindowsPowerShell\Modules'
    }
    if (-not [string]::IsNullOrWhiteSpace($programFilesX86)) {
        $candidateRoots += Join-Path $programFilesX86 'WindowsPowerShell\Modules'
    }

    $moduleRoots = @(
        $candidateRoots |
            Where-Object { Test-Path -LiteralPath $_ -PathType Container } |
            Select-Object -Unique
    )
    if ($moduleRoots.Count -eq 0) {
        throw 'Windows PowerShell module roots are unavailable for the deployment child process.'
    }

    return @{ PSModulePath = ($moduleRoots -join [IO.Path]::PathSeparator) }
}

function Invoke-TestDeployScript {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string] $DeploymentRoot,
        [scriptblock] $ProcessRunner = $null
    )

    $arguments = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', 'scripts\deploy.ps1', '-Build')
    $childEnvironment = Get-TestDeployWindowsPowerShellChildEnvironment
    if ($null -ne $ProcessRunner) {
        $exitCode = & $ProcessRunner `
            -FilePath 'powershell.exe' `
            -ArgumentList $arguments `
            -WorkingDirectory $DeploymentRoot `
            -Environment $childEnvironment
    } else {
        function ConvertTo-CmdQuotedArgument {
            param([Parameter(Mandatory = $true)][string] $Value)
            return '"' + $Value.Replace('"', '\"') + '"'
        }

        $runDir = Join-Path $DeploymentRoot 'scripts\.run'
        if (-not (Test-Path -LiteralPath $runDir -PathType Container)) {
            New-Item -ItemType Directory -Path $runDir -Force | Out-Null
        }
        $stdoutPath = Join-Path $runDir 'rebuild-test-deploy.deploy.stdout.log'
        $stderrPath = Join-Path $runDir 'rebuild-test-deploy.deploy.stderr.log'

        # Do not use Start-Process -Wait here: Windows PowerShell waits on the
        # launched process tree, and deploy.ps1 intentionally leaves host-native
        # runtime services running after its own process exits. Route through cmd.exe
        # with file redirection so long-lived child processes cannot keep the agent
        # harness pipe open; then wait only for the direct cmd.exe process.
        $quotedArgs = ($arguments | ForEach-Object { ConvertTo-CmdQuotedArgument -Value $_ }) -join ' '
        $cmdLine = 'set "PSModulePath=' + $childEnvironment.PSModulePath + '" && powershell.exe ' + $quotedArgs + ' > ' + (ConvertTo-CmdQuotedArgument -Value $stdoutPath) + ' 2> ' + (ConvertTo-CmdQuotedArgument -Value $stderrPath)
        $process = Start-Process -FilePath 'cmd.exe' `
            -ArgumentList @('/c', $cmdLine) `
            -WorkingDirectory $DeploymentRoot `
            -PassThru `
            -WindowStyle Hidden
        $process.WaitForExit()
        $process.Refresh()
        $exitCode = $process.ExitCode
    }

    if ($null -eq $exitCode) {
        $exitCode = 1
    }

    return [pscustomobject]@{
        ExitCode = [int]$exitCode
    }
}

function Invoke-TestDeployRebuild {
    [CmdletBinding()]
    param(
        [switch] $Build,
        [string] $RepoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path,
        [string] $DeploymentPath = $script:TestDeployFixedPath,
        [scriptblock] $CommandRunner = $null,
        [scriptblock] $DeployRunner = $null,
        [scriptblock] $ServiceStopper = $null,
        [switch] $AllowNonFixedPathForTests
    )

    if (-not $Build) {
        throw 'Invoke-TestDeployRebuild requires -Build.'
    }
    if ($AllowNonFixedPathForTests -and $null -eq $CommandRunner) {
        throw 'AllowNonFixedPathForTests requires CommandRunner.'
    }

    $repoRootPath = (Resolve-Path -LiteralPath $RepoRoot).Path
    $deployRoot = if ($AllowNonFixedPathForTests) {
        Normalize-TestDeployPath -Path $DeploymentPath
    } else {
        Assert-TestDeployPath -Path $DeploymentPath
    }

    if ($AllowNonFixedPathForTests) {
        Assert-TestDeployPathSafety -Path $deployRoot | Out-Null
    } else {
        # The active deployment is opaque runtime state. Validate only the path
        # components that lead to it; Kit-generated reparse points below the
        # checkout are preserved by moving the whole directory aside.
        Assert-TestDeployPathComponentsSafety -Path $deployRoot | Out-Null
    }

    $rebuildLock = Enter-TestDeployRebuildLock -DeploymentPath $deployRoot
    try {
    $origin = Invoke-TestDeployGitCommand -Tool 'git' -Arguments @('remote', 'get-url', 'origin') -WorkingDirectory $repoRootPath -CommandRunner $CommandRunner
    $originUrl = Assert-TestDeployOriginUrlSafe -OriginUrl $origin.Output

    $deployGitDir = Join-Path $deployRoot '.git'
    Assert-TestDeployPathComponentsSafety -Path $deployGitDir | Out-Null
    $requiresStagedReplacement = -not $AllowNonFixedPathForTests
    if ($AllowNonFixedPathForTests) {
        $requiresStagedReplacement =
            -not (Test-Path -LiteralPath $deployGitDir) -or
            (Test-TestDeployBrokenGitFile -GitPath $deployGitDir)
    }

    # Keep the injected non-fixed test seam's legacy in-place origin guard.
    # Production never trusts or mutates live Git metadata; it always replaces
    # the active checkout from the caller repo's canonical origin.
    if ($AllowNonFixedPathForTests -and -not $requiresStagedReplacement) {
        $deployOrigin = Invoke-TestDeployGitCommand -Tool 'git' -Arguments @('remote', 'get-url', 'origin') -WorkingDirectory $deployRoot -CommandRunner $CommandRunner
        $deployOriginUrl = Assert-TestDeployOriginUrlSafe -OriginUrl $deployOrigin.Output
        if ($deployOriginUrl -ne $originUrl) {
            throw "deployment checkout origin mismatch. expected='$originUrl' actual='$deployOriginUrl'"
        }
    }

    $envSnapshot = Save-TestDeployEnvSnapshot -DeploymentPath $deployRoot
    $previousPath = ''

    if ($requiresStagedReplacement) {
        $deployParent = Split-Path -Parent $deployRoot
        if (-not (Test-Path -LiteralPath $deployParent -PathType Container)) {
            throw "deployment parent does not exist: $deployParent"
        }

        $deployLeaf = Split-Path -Leaf $deployRoot
        $transactionId = [Guid]::NewGuid().ToString('N')
        $stageRoot = Normalize-TestDeployPath -Path (Join-Path $deployParent ".$deployLeaf.rebuild-stage-$transactionId")
        $previousRoot = Normalize-TestDeployPath -Path (Join-Path $deployParent ".$deployLeaf.rebuild-previous-$transactionId")
        if ((Test-Path -LiteralPath $stageRoot) -or (Test-Path -LiteralPath $previousRoot)) {
            throw 'could not allocate unique deployment transaction paths'
        }

        $mainRefSpec = '+refs/heads/main:refs/remotes/origin/main'
        $restoredEnvFiles = @()
        try {
            # Canonical OriginMain preparation: Git creates one standalone,
            # same-parent sibling. Live remains byte-identical until validation.
            Invoke-TestDeployGitCommand -Tool 'git' -Arguments @('clone', '--', $originUrl, $stageRoot) -WorkingDirectory $repoRootPath -CommandRunner $CommandRunner | Out-Null
            Assert-TestDeployPathSafety -Path $stageRoot | Out-Null

            $stageGitDir = Join-Path $stageRoot '.git'
            if (-not (Test-Path -LiteralPath $stageGitDir -PathType Container)) {
                throw "staged deployment checkout is not standalone: $stageGitDir"
            }

            $headBefore = Invoke-TestDeployGitCommand -Tool 'git' -Arguments @('rev-parse', '--short', 'HEAD') -WorkingDirectory $stageRoot -CommandRunner $CommandRunner
            $statusBefore = Invoke-TestDeployGitCommand -Tool 'git' -Arguments @('status', '--short') -WorkingDirectory $stageRoot -CommandRunner $CommandRunner
            if (-not [string]::IsNullOrWhiteSpace($statusBefore.Output)) {
                $statusLines = @([System.Text.RegularExpressions.Regex]::Split($statusBefore.Output, '\r?\n') | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
                Write-Host "[rebuild-test-deploy] discarding staged checkout local changes count=$($statusLines.Count) head=$($headBefore.Output.Trim())"
                Write-Host $statusBefore.Output
            }

            Invoke-TestDeployGitCommand -Tool 'git' -Arguments @('fetch', 'origin', $mainRefSpec) -WorkingDirectory $stageRoot -CommandRunner $CommandRunner | Out-Null
            Invoke-TestDeployGitCommand -Tool 'git' -Arguments @('reset', '--hard', 'origin/main') -WorkingDirectory $stageRoot -CommandRunner $CommandRunner | Out-Null

            $cleanArguments = @(Get-TestDeployGitCleanArguments)
            $cleanMaxAttempts = 3
            $cleanAttempt = 0
            while ($true) {
                $cleanAttempt++
                try {
                    Invoke-TestDeployGitCommand -Tool 'git' -Arguments $cleanArguments -WorkingDirectory $stageRoot -CommandRunner $CommandRunner | Out-Null
                    break
                } catch {
                    if ($cleanAttempt -ge $cleanMaxAttempts) { throw }
                    Write-Host "[rebuild-test-deploy] staged git clean -fdx attempt $cleanAttempt failed, retrying in 1s: $($_.Exception.Message)"
                    Start-Sleep -Seconds 1
                }
            }

            Assert-TestDeployPathSafety -Path $stageRoot | Out-Null
            if ($AllowNonFixedPathForTests) {
                Initialize-TestDeployDesignAssets -DeploymentPath $stageRoot -AllowNonFixedPathForTests | Out-Null
                $removed = @(Remove-TestDeployAgentTooling -DeploymentPath $stageRoot -AllowNonFixedPathForTests)
            } else {
                Initialize-TestDeployDesignAssets -DeploymentPath $stageRoot -TransactionForDeploymentPath $deployRoot | Out-Null
                $removed = @(Remove-TestDeployAgentTooling -DeploymentPath $stageRoot -TransactionForDeploymentPath $deployRoot)
            }
            Assert-TestDeployPathSafety -Path $stageRoot | Out-Null

            # Design PNGs are staged under the gitignored viewer public directory
            # before all root docs/tooling are removed. No service may be stopped
            # and no live path may be renamed until all checks pass.
            if (-not (Test-Path -LiteralPath $stageGitDir -PathType Container)) {
                throw "staged deployment checkout is not standalone: $stageGitDir"
            }
            $stageDeployScript = Join-Path $stageRoot 'scripts\deploy.ps1'
            if (-not (Test-Path -LiteralPath $stageDeployScript -PathType Leaf)) {
                throw "deployment script missing after staged rebuild: $stageDeployScript"
            }
            $commit = Invoke-TestDeployGitCommand -Tool 'git' -Arguments @('rev-parse', 'origin/main') -WorkingDirectory $stageRoot -CommandRunner $CommandRunner

            $effectiveServiceStopper = $ServiceStopper
            if ($null -eq $effectiveServiceStopper) {
                $launcherLibPath = Join-Path $PSScriptRoot 'host-native-launcher.ps1'
                $effectiveServiceStopper = {
                    param([string] $ServiceName, [string] $ServiceRunDir)
                    . $launcherLibPath
                    Stop-HostNativeService -Name $ServiceName -RunDir $ServiceRunDir | Out-Null
                }.GetNewClosure()
            }
            $deployZoneRunDir = Join-Path $deployRoot 'scripts\.run'
            Assert-TestDeployPathComponentsSafety -Path $deployZoneRunDir | Out-Null
            $serviceStopFailures = New-Object 'System.Collections.Generic.List[string]'
            foreach ($serviceName in @('bim-streaming-server', 'bim-streaming-conversion-service', 'governance-service', 'kit-manager-api')) {
                try {
                    & $effectiveServiceStopper $serviceName $deployZoneRunDir | Out-Null
                } catch {
                    $serviceStopFailures.Add("$serviceName`: $($_.Exception.Message)") | Out-Null
                    Write-Host "[rebuild-test-deploy] WARNING stop of '$serviceName' failed (remaining stops will still be attempted): $($_.Exception.Message)"
                }
            }
            if ($serviceStopFailures.Count -gt 0) {
                throw "deployment service stop failed: $($serviceStopFailures -join '; ')"
            }

            $liveMovedToPrevious = $false
            Assert-TestDeployPathComponentsSafety -Path $deployRoot | Out-Null
            Assert-TestDeployPathSafety -Path $stageRoot | Out-Null
            Assert-TestDeployPathComponentsSafety -Path $previousRoot | Out-Null
            if (Test-Path -LiteralPath $deployRoot -PathType Container) {
                [System.IO.Directory]::Move($deployRoot, $previousRoot)
                $liveMovedToPrevious = $true
                $previousPath = $previousRoot
            } elseif (Test-Path -LiteralPath $deployRoot) {
                throw "deployment path is not a directory: $deployRoot"
            }

            try {
                [System.IO.Directory]::Move($stageRoot, $deployRoot)
            } catch {
                $cutoverError = $_
                if ($liveMovedToPrevious) {
                    try {
                        [System.IO.Directory]::Move($previousRoot, $deployRoot)
                        $previousPath = ''
                    } catch {
                        throw "$($cutoverError.Exception.Message)$([Environment]::NewLine)Additionally failed to restore previous live checkout from '$previousRoot' to '$deployRoot': $($_.Exception.Message)"
                    }
                }
                throw $cutoverError
            }

            Write-TestDeployLifecycleLog -Message 'activated validated staged checkout' -Data @{
                deployment_path = $deployRoot
            }
            if (-not [string]::IsNullOrWhiteSpace($previousPath)) {
                Write-TestDeployLifecycleLog -Message 'retained previous checkout for recovery' -Data @{
                    previous_path = $previousPath
                }
            }
            try {
                $restoredEnvFiles = @(Restore-TestDeployEnvSnapshot -DeploymentPath $deployRoot -Snapshot $envSnapshot)
            } catch {
                if (-not [string]::IsNullOrWhiteSpace($previousPath)) {
                    throw "post-cutover environment restore failed; previous checkout retained at '$previousPath': $($_.Exception.Message)"
                }
                throw
            }
        } catch {
            $stageError = $_
            $stageMayExist = $false
            try {
                $stageMayExist = $null -ne (Get-Item -LiteralPath $stageRoot -Force -ErrorAction Stop)
            } catch [System.Management.Automation.ItemNotFoundException] {
                $stageMayExist = $false
            } catch [System.IO.DirectoryNotFoundException] {
                $stageMayExist = $false
            } catch {
                $stageMayExist = $true
                Write-Warning "[rebuild-test-deploy] failed stage inspection was indeterminate; preserving allocated path: '$stageRoot' ($($_.Exception.Message))"
            }
            if ($stageMayExist) {
                Write-Warning "[rebuild-test-deploy] failed_stage_path=$stageRoot; automatic recursive cleanup is disabled"
                throw "$($stageError.Exception.Message)$([Environment]::NewLine)failed_stage_path=$stageRoot"
            }
            throw $stageError
        }

        if ($restoredEnvFiles.Count -gt 0) {
            Write-Host "[rebuild-test-deploy] restored deployment env files count=$($restoredEnvFiles.Count): $($restoredEnvFiles -join ', ')"
        }
    } else {
    # Test-only in-place seam: production cannot reach this branch because it
    # always requires staged replacement. Existing-checkout tests share the same
    # lock as deploy/start adapters.
    # Acquire it before fetch/reset/clean and preserve every recovery path from
    # git clean. Release only after staging and root-doc cleanup are complete,
    # before deploy.ps1 reacquires the lock to validate the prestaged manifest.
    $designAssetDestinationParent = Join-Path $deployRoot 'web-viewer-sample\public'
    $designAssetLockHandle = Enter-DeploymentDesignAssetLock -DestinationParent $designAssetDestinationParent -BoundaryRoot $deployRoot
    $existingCheckoutError = $null
    $designAssetLockCleanupError = $null
    try {
        Assert-NoDeploymentDesignAssetBackupResidue -DestinationParent $designAssetDestinationParent -BoundaryRoot $deployRoot

        $headBefore = Invoke-TestDeployGitCommand -Tool 'git' -Arguments @('rev-parse', '--short', 'HEAD') -WorkingDirectory $deployRoot -CommandRunner $CommandRunner
        $statusBefore = Invoke-TestDeployGitCommand -Tool 'git' -Arguments @('status', '--short') -WorkingDirectory $deployRoot -CommandRunner $CommandRunner
        if (-not [string]::IsNullOrWhiteSpace($statusBefore.Output)) {
            $statusLines = @($statusBefore.Output -split "`r?`n" | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
            Write-Host "[rebuild-test-deploy] discarding deployment local changes count=$($statusLines.Count) head=$($headBefore.Output.Trim())"
            Write-Host $statusBefore.Output
        }

        $mainRefSpec = '+refs/heads/main:refs/remotes/origin/main'
        $restoredEnvFiles = @()
        try {
            Invoke-TestDeployGitCommand -Tool 'git' -Arguments @('fetch', 'origin', $mainRefSpec) -WorkingDirectory $deployRoot -CommandRunner $CommandRunner | Out-Null
            Invoke-TestDeployGitCommand -Tool 'git' -Arguments @('reset', '--hard', 'origin/main') -WorkingDirectory $deployRoot -CommandRunner $CommandRunner | Out-Null

            # Pre-clean stop: kit.exe / conversion / governance from rebuild N still hold
            # locked handles under _build (gitignored, targeted by -x). Stop the deploy-zone
            # services (identified ONLY by this deploy zone's scripts\.run pidfiles) so their
            # file handles release before `git clean -fdx`. BEST-EFFORT by design: a stop
            # failure must not abort — the clean-retry below is the real safety net, and the
            # guardrail (pidfile-scoped Stop-HostNativeService) never touches out-of-zone
            # processes such as hub.exe under C:\Users\...\ov\pkg.
            $effectiveServiceStopper = $ServiceStopper
            if ($null -eq $effectiveServiceStopper) {
                $launcherLibPath = Join-Path $PSScriptRoot 'host-native-launcher.ps1'
                $effectiveServiceStopper = {
                    param([string] $ServiceName, [string] $ServiceRunDir)
                    . $launcherLibPath
                    Stop-HostNativeService -Name $ServiceName -RunDir $ServiceRunDir | Out-Null
                }.GetNewClosure()
            }
            $deployZoneRunDir = Join-Path $deployRoot 'scripts\.run'
            foreach ($serviceName in @('bim-streaming-server', 'bim-streaming-conversion-service', 'governance-service', 'kit-manager-api')) {
                try {
                    & $effectiveServiceStopper $serviceName $deployZoneRunDir | Out-Null
                } catch {
                    Write-Host "[rebuild-test-deploy] WARNING best-effort stop of '$serviceName' failed (continuing to clean-retry): $($_.Exception.Message)"
                }
            }

            # Retry ONLY the clean: a just-released handle can still throw a transient EINVAL
            # ("Invalid argument") on the first unlink. Re-throw after the final attempt so a
            # genuine lock still surfaces AND still reaches the env-restore catch below.
            # Kit's own runtime log files under _build/**/logs can be left with an orphaned
            # OS-level handle (observed: no owning process, Defender idle, lock outlives the
            # 3-attempt retry) that no amount of retrying releases. These logs are pure
            # diagnostic output, not build state, so skip them instead of blocking the rebuild.
            $cleanArguments = @(Get-TestDeployGitCleanArguments)
            $cleanMaxAttempts = 3
            $cleanAttempt = 0
            while ($true) {
                $cleanAttempt++
                try {
                    Invoke-TestDeployGitCommand -Tool 'git' -Arguments $cleanArguments -WorkingDirectory $deployRoot -CommandRunner $CommandRunner | Out-Null
                    break
                } catch {
                    if ($cleanAttempt -ge $cleanMaxAttempts) { throw }
                    Write-Host "[rebuild-test-deploy] git clean -fdx attempt $cleanAttempt failed, retrying in 1s: $($_.Exception.Message)"
                    Start-Sleep -Seconds 1
                }
            }
            $restoredEnvFiles = @(Restore-TestDeployEnvSnapshot -DeploymentPath $deployRoot -Snapshot $envSnapshot)
        } catch {
            $cleanupError = $_
            try {
                $restoredAfterFailure = @(Restore-TestDeployEnvSnapshot -DeploymentPath $deployRoot -Snapshot $envSnapshot)
                if ($restoredAfterFailure.Count -gt 0) {
                    Write-Host "[rebuild-test-deploy] restored deployment env files after failed cleanup count=$($restoredAfterFailure.Count): $($restoredAfterFailure -join ', ')"
                }
            } catch {
                throw "$($cleanupError.Exception.Message)$([Environment]::NewLine)Additionally failed to restore preserved env files: $($_.Exception.Message)"
            }
            throw
        }
        if ($restoredEnvFiles.Count -gt 0) {
            Write-Host "[rebuild-test-deploy] restored deployment env files count=$($restoredEnvFiles.Count): $($restoredEnvFiles -join ', ')"
        }

        Initialize-TestDeployDesignAssets `
            -DeploymentPath $deployRoot `
            -AllowNonFixedPathForTests:$AllowNonFixedPathForTests `
            -DesignAssetLockHandle $designAssetLockHandle | Out-Null
        $removed = Remove-TestDeployAgentTooling -DeploymentPath $deployRoot -AllowNonFixedPathForTests:$AllowNonFixedPathForTests
        $deployScript = Join-Path $deployRoot 'scripts\deploy.ps1'
        if (-not (Test-Path -LiteralPath $deployScript -PathType Leaf)) {
            throw "deployment script missing after rebuild: $deployScript"
        }

        $commit = Invoke-TestDeployGitCommand -Tool 'git' -Arguments @('rev-parse', 'origin/main') -WorkingDirectory $deployRoot -CommandRunner $CommandRunner
    } catch {
        $existingCheckoutError = $_
    } finally {
        try {
            $designAssetLockHandle.Dispose()
        } catch {
            $designAssetLockCleanupError = $_
            if ($null -ne $existingCheckoutError) {
                Write-DeploymentDesignAssetCleanupDiagnostic -Message "deployment design assets lock cleanup failed after rebuild preparation error: $($_.Exception.Message)"
            }
        }
    }
    if ($null -ne $existingCheckoutError) {
        throw $existingCheckoutError
    }
    if ($null -ne $designAssetLockCleanupError) {
        throw $designAssetLockCleanupError
    }
    }

    try {
        $edgeRuntimeContract = Resolve-TestDeployEdgeRuntimeContract
        $processEnvBackup = Push-TestDeployProcessEnv -Contract $edgeRuntimeContract

        try {
            if ($null -ne $DeployRunner) {
                $deployResult = & $DeployRunner $deployRoot
            } else {
                $deployResult = Invoke-TestDeployScript -DeploymentRoot $deployRoot
            }
        } finally {
            Restore-TestDeployProcessEnv -Backup $processEnvBackup
        }
    } catch {
        if (-not [string]::IsNullOrWhiteSpace($previousPath)) {
            throw "post-cutover deployment failed; previous checkout retained at '$previousPath': $($_.Exception.Message)"
        }
        throw
    }

    return [pscustomobject]@{
        DeploymentPath = $deployRoot
        PreviousPath = $previousPath
        OriginMainCommit = $commit.Output.Trim()
        RemovedAgentToolingCount = @($removed).Count
        RestoredEnvFileCount = @($restoredEnvFiles).Count
        DeployExitCode = [int]$deployResult.ExitCode
    }
    } finally {
        if ($null -ne $rebuildLock -and $null -ne $rebuildLock.Handle) {
            $rebuildLock.Handle.Dispose()
        }
    }
}
