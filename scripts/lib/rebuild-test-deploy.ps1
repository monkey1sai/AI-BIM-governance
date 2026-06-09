Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$script:TestDeployFixedPath = 'D:\Users\deploy\AI-bim-geo'
$script:TestDeployRootToolingDirNames = @(
    '.codex',
    '.agents',
    '.agent',
    '.claude',
    '.cursor',
    '.windsurf'
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
