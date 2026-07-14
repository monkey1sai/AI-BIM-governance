[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Assert-True {
    param([Parameter(Mandatory = $true)] $Condition, [Parameter(Mandatory = $true)][string] $Message)
    if (-not $Condition) { throw "ASSERT FAILED: $Message" }
}

$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$scriptUnderTest = Join-Path $repoRoot 'scripts\dev\sync-agent-skills.ps1'
$fixtureRoot = Join-Path ([IO.Path]::GetTempPath()) ("agent-skills-sync-" + [guid]::NewGuid().ToString('N'))

try {
    $source = Join-Path $fixtureRoot '.claude\skills\demo'
    $target = Join-Path $fixtureRoot '.codex\skills\demo'
    $independent = Join-Path $fixtureRoot '.codex\skills\keep'
    New-Item -ItemType Directory -Path $source, $target, $independent -Force | Out-Null
    Set-Content -LiteralPath (Join-Path $source 'SKILL.md') -Value "source`n" -NoNewline
    Set-Content -LiteralPath (Join-Path $target 'SKILL.md') -Value "drift`n" -NoNewline
    Set-Content -LiteralPath (Join-Path $target 'stale.txt') -Value 'remove me' -NoNewline
    Set-Content -LiteralPath (Join-Path $independent 'SKILL.md') -Value 'keep me' -NoNewline

    $manifest = [ordered]@{
        schema_version = 'agent-skills-manifest/v1'
        roots = [ordered]@{ claude = '.claude/skills'; codex = '.codex/skills' }
        skills = @(
            [ordered]@{
                name = 'demo'
                locations = [ordered]@{ claude = '.claude/skills/demo'; codex = '.codex/skills/demo' }
                sync = [ordered]@{ mode = 'mirror'; source = 'claude'; targets = @('codex') }
                provenance = [ordered]@{ kind = 'fixture'; source = 'test'; import_commit = 'fixture' }
            },
            [ordered]@{
                name = 'keep'
                locations = [ordered]@{ codex = '.codex/skills/keep' }
                sync = [ordered]@{ mode = 'single' }
                provenance = [ordered]@{ kind = 'fixture'; source = 'test'; import_commit = 'fixture' }
            }
        )
    }
    $manifestPath = Join-Path $fixtureRoot 'agent-skills-manifest.json'
    $manifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $manifestPath -Encoding UTF8

    $checkFailed = $false
    try {
        & $scriptUnderTest -Mode Check -RepoRoot $fixtureRoot -ManifestPath $manifestPath
    } catch {
        $checkFailed = $true
    }
    Assert-True $checkFailed 'check mode detects content drift and stale target files'

    & $scriptUnderTest -Mode Sync -RepoRoot $fixtureRoot -ManifestPath $manifestPath
    Assert-True ((Get-Content -Raw -LiteralPath (Join-Path $target 'SKILL.md')) -eq "source`n") 'sync copies canonical content'
    Assert-True (-not (Test-Path -LiteralPath (Join-Path $target 'stale.txt'))) 'sync removes only stale files inside a declared mirror target'
    Assert-True (Test-Path -LiteralPath (Join-Path $independent 'SKILL.md')) 'sync preserves independent skill directories'

    & $scriptUnderTest -Mode Check -RepoRoot $fixtureRoot -ManifestPath $manifestPath
} finally {
    if (Test-Path -LiteralPath $fixtureRoot) {
        Remove-Item -Recurse -Force -LiteralPath $fixtureRoot
    }
}

Write-Host '[test-agent-skills-sync] all assertions passed'
