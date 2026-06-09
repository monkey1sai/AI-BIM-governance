[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'test-helpers.ps1')
. (Join-Path $PSScriptRoot '..\lib\rebuild-test-deploy.ps1')

$testName = 'rebuild-test-deploy'
$sandbox = New-TestSandbox -Prefix $testName

try {
    $expected = 'D:\Users\deploy\AI-bim-geo'
    Assert-Equal $expected (Assert-TestDeployPath -Path $expected) 'fixed deployment path is accepted'
    Assert-Throws { Assert-TestDeployPath -Path 'D:\Users\deploy\AI-bim-geo2' } 'nearby deployment path is rejected'
    Assert-Throws { Assert-TestDeployPath -Path $sandbox } 'temporary sandbox path is rejected'

    $cleanupRoot = Join-Path $sandbox 'AI-bim-geo'
    $toolingDirNames = @('.codex', '.agents', '.agent', '.claude', '.cursor', '.windsurf')
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

    Assert-Throws { Remove-TestDeployAgentTooling -DeploymentPath $cleanupRoot } 'temporary cleanup root requires explicit test escape'

    $removed = Remove-TestDeployAgentTooling -DeploymentPath $cleanupRoot -AllowNonFixedPathForTests
    Assert-True ($removed.Count -ge 4) 'agent/tooling paths are reported as removed'
    Assert-True (-not (Test-Path -LiteralPath (Join-Path $cleanupRoot 'AGENTS.md'))) 'root AGENTS.md removed'
    Assert-True (-not (Test-Path -LiteralPath (Join-Path $cleanupRoot 'CLAUDE.md'))) 'root CLAUDE.md removed'
    Assert-True (-not (Test-Path -LiteralPath (Join-Path $cleanupRoot 'apps\kit-manager-web\AGENTS.md'))) 'nested AGENTS.md removed'
    foreach ($dirName in $toolingDirNames) {
        Assert-True (-not (Test-Path -LiteralPath (Join-Path $cleanupRoot $dirName))) "root $dirName removed"
    }
    Assert-True (Test-Path -LiteralPath (Join-Path $cleanupRoot '.github\workflows\ci.yml')) '.github workflows kept'
    Assert-True (Test-Path -LiteralPath (Join-Path $cleanupRoot 'scripts\deploy.ps1')) 'deploy.ps1 kept'

    Write-TestPass $testName
} catch {
    Write-TestFail $testName $_.Exception.Message
    throw
} finally {
    Remove-TestSandbox -Path $sandbox
}
