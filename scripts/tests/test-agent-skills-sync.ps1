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
Import-Module -Force (Join-Path $repoRoot 'scripts\lib\StructLog.psm1')

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

    $logRecords = @(Get-ChildItem -Recurse -File -Filter '*.jsonl' -LiteralPath (Join-Path $fixtureRoot 'logs') | ForEach-Object {
        Get-Content -LiteralPath $_.FullName | ForEach-Object { $_ | ConvertFrom-Json }
    })
    Assert-True (@($logRecords | Where-Object { $_.msg -eq 'agent skill sync complete' }).Count -eq 1) 'sync emits one structured success record'
    Assert-True (@($logRecords | Where-Object { $_.msg -eq 'agent skill check passed' }).Count -eq 1) 'successful check emits one structured success record'
} finally {
    if (Test-Path -LiteralPath $fixtureRoot) {
        Remove-Item -Recurse -Force -LiteralPath $fixtureRoot
    }
}

$repoManifest = Get-Content -Raw -LiteralPath (Join-Path $repoRoot 'agent-skills-manifest.json') | ConvertFrom-Json
$repoHealth = @($repoManifest.skills | Where-Object { $_.name -eq 'repo-health' })
Assert-True ($repoHealth.Count -eq 1) 'repo-health has one manifest entry'
Assert-True ($repoHealth[0].sync.mode -eq 'independent') 'repo-health declares Claude and Codex platform variants'
$codexRepoHealth = Get-Content -Raw -LiteralPath (Join-Path $repoRoot '.codex\skills\repo-health\SKILL.md')
Assert-True ($codexRepoHealth -notmatch 'repo-health-scan|output-style') 'Codex repo-health does not invoke Claude-only workflow or output-style features'

$expectedSuperpowersSkills = @(
    'brainstorming',
    'dispatching-parallel-agents',
    'executing-plans',
    'finishing-a-development-branch',
    'receiving-code-review',
    'requesting-code-review',
    'subagent-driven-development',
    'systematic-debugging',
    'test-driven-development',
    'using-git-worktrees',
    'using-superpowers',
    'verification-before-completion',
    'writing-plans',
    'writing-skills'
)
$superpowersEntries = @($repoManifest.skills | Where-Object { $_.provenance.source -eq 'obra/superpowers@v6.1.1' })
Assert-True ($superpowersEntries.Count -eq $expectedSuperpowersSkills.Count) 'manifest declares the complete pinned Superpowers v6.1.1 skill set'
foreach ($skillName in $expectedSuperpowersSkills) {
    $entry = @($superpowersEntries | Where-Object { $_.name -eq $skillName })
    Assert-True ($entry.Count -eq 1) "Superpowers manifest has one entry for $skillName"
    Assert-True ($entry[0].sync.mode -eq 'mirror' -and $entry[0].sync.source -eq 'claude' -and @($entry[0].sync.targets) -contains 'codex') "$skillName mirrors Claude to Codex"
    Assert-True ($entry[0].provenance.import_commit -eq 'd884ae04edebef577e82ff7c4e143debd0bbec99') "$skillName pins the v6.1.1 release commit"
    Assert-True ($entry[0].provenance.license -eq 'MIT') "$skillName records the upstream license"
    foreach ($platform in @('claude', 'codex')) {
        $skillPath = Join-Path $repoRoot ".$platform\skills\$skillName\SKILL.md"
        Assert-True (Test-Path -LiteralPath $skillPath) "$skillName has a $platform entrypoint"
        Assert-True ((Get-Content -Raw -LiteralPath $skillPath) -match "(?m)^name:\s*$([regex]::Escape($skillName))\s*$") "$skillName keeps the expected $platform frontmatter name"
    }
}
Assert-True (Test-Path -LiteralPath (Join-Path $repoRoot 'THIRD_PARTY_NOTICES.md')) 'repo includes the Superpowers MIT license notice'

$explicitOnlySuperpowersSkills = @(
    'brainstorming',
    'finishing-a-development-branch',
    'subagent-driven-development',
    'using-git-worktrees',
    'using-superpowers',
    'writing-plans'
)
foreach ($skillName in $explicitOnlySuperpowersSkills) {
    $metadataPath = Join-Path $repoRoot ".codex\skills\$skillName\agents\openai.yaml"
    Assert-True (Test-Path -LiteralPath $metadataPath) "$skillName has Codex invocation metadata"
    Assert-True ((Get-Content -Raw -LiteralPath $metadataPath) -match 'allow_implicit_invocation:\s*false') "$skillName cannot be invoked implicitly by Codex"
}

$testLogger = New-StructLogger -Service 'scripts' -Component 'test-agent-skills-sync' -SkipEnvSnapshot -InMemoryOnly
$testLogger | Write-StructInfo -Msg '[test-agent-skills-sync] all assertions passed' -Data @{ result = 'passed' }
