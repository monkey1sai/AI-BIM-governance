Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$script:TestDeployFixedPath = 'D:\Users\deploy\AI-bim-geo'
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
        [switch] $AllowNonFixedPathForTests
    )

    $root = if ($AllowNonFixedPathForTests) {
        Normalize-TestDeployPath -Path $DeploymentPath
    } else {
        Assert-TestDeployPath -Path $DeploymentPath
    }

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

    foreach ($dirPath in (Get-TestDeployRootToolingDirs -DeploymentPath $root)) {
        if (Test-Path -LiteralPath $dirPath -PathType Container) {
            Remove-Item -LiteralPath $dirPath -Recurse -Force -ErrorAction Stop
            $removed.Add($dirPath) | Out-Null
        }
    }

    return @($removed.ToArray())
}

function Save-TestDeployEnvSnapshot {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string] $DeploymentPath
    )

    $root = Normalize-TestDeployPath -Path $DeploymentPath
    $snapshot = New-Object 'System.Collections.Generic.List[object]'
    foreach ($relativePath in $script:TestDeployPreservedEnvFiles) {
        $envPath = Join-Path $root $relativePath
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

    $root = Normalize-TestDeployPath -Path $DeploymentPath
    $restored = New-Object 'System.Collections.Generic.List[string]'
    foreach ($entry in @($Snapshot)) {
        if ($null -eq $entry) { continue }
        $relativePath = [string]$entry.RelativePath
        if ([string]::IsNullOrWhiteSpace($relativePath)) { continue }

        $examplePath = Join-Path $root "$relativePath.example"
        if (-not (Test-Path -LiteralPath $examplePath -PathType Leaf)) {
            continue
        }

        $envPath = Join-Path $root $relativePath
        $parent = Split-Path -Parent $envPath
        if (-not (Test-Path -LiteralPath $parent -PathType Container)) {
            New-Item -ItemType Directory -Path $parent -Force | Out-Null
        }

        [System.IO.File]::WriteAllBytes($envPath, [byte[]]$entry.Bytes)
        $restored.Add($relativePath) | Out-Null
    }

    return @($restored.ToArray())
}

function Invoke-TestDeployGitCommand {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string] $Tool,
        [Parameter(Mandatory = $true)][string[]] $Arguments,
        [Parameter(Mandatory = $true)][string] $WorkingDirectory,
        [scriptblock] $CommandRunner = $null
    )

    $command = "$Tool $($Arguments -join ' ')"
    if ($null -ne $CommandRunner) {
        $result = & $CommandRunner $Tool $Arguments $WorkingDirectory
    } else {
        $stdoutPath = [System.IO.Path]::GetTempFileName()
        $stderrPath = [System.IO.Path]::GetTempFileName()
        try {
            $process = Start-Process -FilePath $Tool -ArgumentList $Arguments -WorkingDirectory $WorkingDirectory -NoNewWindow -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath -Wait -PassThru
            $stdoutText = if (Test-Path -LiteralPath $stdoutPath) { Get-Content -LiteralPath $stdoutPath -Raw -ErrorAction Stop } else { '' }
            $stderrText = if (Test-Path -LiteralPath $stderrPath) { Get-Content -LiteralPath $stderrPath -Raw -ErrorAction Stop } else { '' }
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
            Remove-Item -LiteralPath $stdoutPath, $stderrPath -Force -ErrorAction SilentlyContinue
        }
    }

    if ($result.ExitCode -ne 0) {
        throw "$command failed with exit code $($result.ExitCode): $($result.Output)"
    }

    return $result
}

function Invoke-TestDeployRebuild {
    [CmdletBinding()]
    param(
        [switch] $Build,
        [string] $RepoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path,
        [string] $DeploymentPath = $script:TestDeployFixedPath,
        [scriptblock] $CommandRunner = $null,
        [scriptblock] $DeployRunner = $null,
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

    $origin = Invoke-TestDeployGitCommand -Tool 'git' -Arguments @('remote', 'get-url', 'origin') -WorkingDirectory $repoRootPath -CommandRunner $CommandRunner
    $originUrl = $origin.Output.Trim()
    if ([string]::IsNullOrWhiteSpace($originUrl)) {
        throw 'current repo origin URL is empty'
    }

    if (-not (Test-Path -LiteralPath $deployRoot -PathType Container)) {
        New-Item -ItemType Directory -Path $deployRoot -Force | Out-Null
    }

    $envSnapshot = Save-TestDeployEnvSnapshot -DeploymentPath $deployRoot
    $deployGitDir = Join-Path $deployRoot '.git'
    if (-not (Test-Path -LiteralPath $deployGitDir)) {
        $existing = @(Get-ChildItem -LiteralPath $deployRoot -Force -ErrorAction SilentlyContinue)
        if ($existing.Count -gt 0) {
            foreach ($item in $existing) {
                Remove-Item -LiteralPath $item.FullName -Recurse -Force -ErrorAction Stop
            }
            Write-Host "[rebuild-test-deploy] rebuilt non-git deployment directory: $deployRoot"
        }

        Invoke-TestDeployGitCommand -Tool 'git' -Arguments @('clone', $originUrl, $deployRoot) -WorkingDirectory $repoRootPath -CommandRunner $CommandRunner | Out-Null
    } else {
        $deployOrigin = Invoke-TestDeployGitCommand -Tool 'git' -Arguments @('remote', 'get-url', 'origin') -WorkingDirectory $deployRoot -CommandRunner $CommandRunner
        $deployOriginUrl = $deployOrigin.Output.Trim()
        if ($deployOriginUrl -ne $originUrl) {
            throw "deployment checkout origin mismatch. expected='$originUrl' actual='$deployOriginUrl'"
        }
    }

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
        Invoke-TestDeployGitCommand -Tool 'git' -Arguments @('clean', '-fdx') -WorkingDirectory $deployRoot -CommandRunner $CommandRunner | Out-Null
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

    $removed = Remove-TestDeployAgentTooling -DeploymentPath $deployRoot -AllowNonFixedPathForTests:$AllowNonFixedPathForTests
    $deployScript = Join-Path $deployRoot 'scripts\deploy.ps1'
    if (-not (Test-Path -LiteralPath $deployScript -PathType Leaf)) {
        throw "deployment script missing after rebuild: $deployScript"
    }

    $commit = Invoke-TestDeployGitCommand -Tool 'git' -Arguments @('rev-parse', 'origin/main') -WorkingDirectory $deployRoot -CommandRunner $CommandRunner

    if ($null -ne $DeployRunner) {
        $deployResult = & $DeployRunner $deployRoot
    } else {
        $deployProcess = Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', 'scripts\deploy.ps1', '-Build') -WorkingDirectory $deployRoot -NoNewWindow -Wait -PassThru
        $deployResult = [pscustomobject]@{
            ExitCode = [int]$deployProcess.ExitCode
        }
    }

    return [pscustomobject]@{
        DeploymentPath = $deployRoot
        OriginMainCommit = $commit.Output.Trim()
        RemovedAgentToolingCount = @($removed).Count
        RestoredEnvFileCount = @($restoredEnvFiles).Count
        DeployExitCode = [int]$deployResult.ExitCode
    }
}
