[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Assert-True {
    param([Parameter(Mandatory = $true)] $Condition, [Parameter(Mandatory = $true)][string] $Message)
    if (-not $Condition) { throw "ASSERT FAILED: $Message" }
}

function Get-TreeFingerprint {
    param([Parameter(Mandatory = $true)][string] $Root)

    return (@(Get-ChildItem -Force -Recurse -File -LiteralPath $Root | Sort-Object FullName | ForEach-Object {
        $relative = $_.FullName.Substring($Root.Length).TrimStart('\', '/').Replace('\', '/')
        $hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $_.FullName).Hash
        "$relative`:$hash"
    }) -join "`n")
}

function Get-TestTreeDigest {
    param([Parameter(Mandatory = $true)][string] $Root)

    $files = @{}
    $relativePaths = [Collections.Generic.List[string]]::new()
    foreach ($file in Get-ChildItem -Force -Recurse -File -LiteralPath $Root) {
        $relative = $file.FullName.Substring($Root.Length).TrimStart('\', '/').Replace('\', '/')
        $files[$relative] = $file.FullName
        $relativePaths.Add($relative)
    }
    $orderedPaths = [string[]] $relativePaths.ToArray()
    [Array]::Sort($orderedPaths, [StringComparer]::Ordinal)
    $hasher = [Security.Cryptography.IncrementalHash]::CreateHash([Security.Cryptography.HashAlgorithmName]::SHA256)
    try {
        $nul = [char] 0
        $hasher.AppendData([Text.Encoding]::UTF8.GetBytes("agent-skill-tree/v2$nul"))
        foreach ($relative in $orderedPaths) {
            $bytes = Convert-TestCrlfToLfBytes ([IO.File]::ReadAllBytes($files[$relative]))
            $fileHash = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([byte[]] $bytes)).ToLowerInvariant()
            $hasher.AppendData([Text.Encoding]::UTF8.GetBytes("$relative$nul$fileHash`n"))
        }
        return [Convert]::ToHexString($hasher.GetHashAndReset()).ToLowerInvariant()
    } finally {
        $hasher.Dispose()
    }
}

function Convert-TestCrlfToLfBytes {
    param([Parameter(Mandatory = $true)][AllowEmptyCollection()][byte[]] $Bytes)

    $stream = [IO.MemoryStream]::new()
    try {
        for ($index = 0; $index -lt $Bytes.Length; $index++) {
            if ($Bytes[$index] -eq 13 -and ($index + 1) -lt $Bytes.Length -and $Bytes[$index + 1] -eq 10) {
                $stream.WriteByte(10)
                $index++
                continue
            }
            $stream.WriteByte($Bytes[$index])
        }
        return ,$stream.ToArray()
    } finally {
        $stream.Dispose()
    }
}

function Get-TestV2TreeDigest {
    param(
        [Parameter(Mandatory = $true)][string] $Root,
        [string[]] $BinaryPaths = @()
    )

    $files = @{}
    foreach ($file in Get-ChildItem -Force -Recurse -File -LiteralPath $Root) {
        $relative = $file.FullName.Substring($Root.Length).TrimStart('\', '/').Replace('\', '/')
        $files[$relative] = $file.FullName
    }
    $orderedPaths = [string[]] @($files.Keys)
    [Array]::Sort($orderedPaths, [StringComparer]::Ordinal)
    $binarySet = [Collections.Generic.HashSet[string]]::new($BinaryPaths, [StringComparer]::Ordinal)
    $hasher = [Security.Cryptography.IncrementalHash]::CreateHash([Security.Cryptography.HashAlgorithmName]::SHA256)
    try {
        $nul = [char] 0
        $hasher.AppendData([Text.Encoding]::UTF8.GetBytes("agent-skill-tree/v2$nul"))
        foreach ($relative in $orderedPaths) {
            $bytes = [IO.File]::ReadAllBytes($files[$relative])
            if (-not $binarySet.Contains($relative)) {
                $bytes = Convert-TestCrlfToLfBytes $bytes
            }
            $fileHash = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($bytes)).ToLowerInvariant()
            $hasher.AppendData([Text.Encoding]::UTF8.GetBytes("$relative$nul$fileHash`n"))
        }
        return [Convert]::ToHexString($hasher.GetHashAndReset()).ToLowerInvariant()
    } finally {
        $hasher.Dispose()
    }
}

$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$scriptUnderTest = Join-Path $repoRoot 'scripts\dev\sync-agent-skills.ps1'
$fixtureRoot = Join-Path ([IO.Path]::GetTempPath()) ("agent-skills-sync-" + [guid]::NewGuid().ToString('N'))
Import-Module -Force (Join-Path $repoRoot 'scripts\lib\StructLog.psm1')

$eolFixtureRoot = Join-Path ([IO.Path]::GetTempPath()) ("agent-skills-eol-" + [guid]::NewGuid().ToString('N'))
try {
    $eolSkill = Join-Path $eolFixtureRoot '.claude\skills\eol-demo'
    $eolCodexRoot = Join-Path $eolFixtureRoot '.codex\skills'
    $eolConsumer = Join-Path $eolFixtureRoot 'scripts\dev\sync-agent-skills.ps1'
    New-Item -ItemType Directory -Path $eolSkill, $eolCodexRoot, (Split-Path -Parent $eolConsumer) -Force | Out-Null
    [IO.File]::WriteAllBytes((Join-Path $eolSkill 'SKILL.md'), [byte[]] @(65, 10))
    [IO.File]::WriteAllBytes((Join-Path $eolSkill 'empty.md'), [byte[]]::new(0))
    [IO.File]::WriteAllBytes((Join-Path $eolSkill 'lone-cr.md'), [byte[]] @(65, 13, 66))
    [IO.File]::WriteAllBytes((Join-Path $eolSkill 'payload.bin'), [byte[]] @(65, 13, 10, 66))
    [IO.File]::WriteAllBytes((Join-Path $eolSkill 'forced-text.dat'), [byte[]] @(65, 0, 13, 10, 66))
    Set-Content -LiteralPath $eolConsumer -Value '# fixture consumer' -NoNewline
    Set-Content -LiteralPath (Join-Path $eolFixtureRoot '.gitattributes') -Value @('*.md text', '*.bin -text', '*.dat text')

    & git -C $eolFixtureRoot init --quiet
    Assert-True ($LASTEXITCODE -eq 0) 'EOL fixture initializes a Git repository'
    & git -C $eolFixtureRoot config core.autocrlf false
    Assert-True ($LASTEXITCODE -eq 0) 'EOL fixture disables checkout conversion while staging canonical files'
    & git -C $eolFixtureRoot config core.eol lf
    Assert-True ($LASTEXITCODE -eq 0) 'EOL fixture fixes Git text checkout style independently of machine defaults'
    & git -C $eolFixtureRoot add -f -- '.gitattributes' '.claude/skills/eol-demo/SKILL.md' '.claude/skills/eol-demo/empty.md' '.claude/skills/eol-demo/lone-cr.md' '.claude/skills/eol-demo/payload.bin' '.claude/skills/eol-demo/forced-text.dat'
    Assert-True ($LASTEXITCODE -eq 0) 'EOL fixture stages every governed skill asset'
    $eolTextClassification = @(& git -C $eolFixtureRoot ls-files --eol -- '.claude/skills/eol-demo/SKILL.md')
    $eolEmptyTextClassification = @(& git -C $eolFixtureRoot ls-files --eol -- '.claude/skills/eol-demo/empty.md')
    $eolBinaryClassification = @(& git -C $eolFixtureRoot ls-files --eol -- '.claude/skills/eol-demo/payload.bin')
    $eolForcedTextClassification = @(& git -C $eolFixtureRoot ls-files --eol -- '.claude/skills/eol-demo/forced-text.dat')
    Assert-True ($eolTextClassification.Count -eq 1 -and $eolTextClassification[0] -match '^i/lf\s') 'EOL fixture classifies SKILL.md as Git text'
    Assert-True ($eolEmptyTextClassification.Count -eq 1 -and $eolEmptyTextClassification[0] -match '\sattr/text\s') 'EOL fixture classifies an empty tracked Markdown asset as explicit Git text'
    Assert-True ($eolBinaryClassification.Count -eq 1 -and $eolBinaryClassification[0] -match '\sattr/-text\s') "EOL fixture classifies payload.bin as Git binary: $($eolBinaryClassification -join '; ')"
    Assert-True ($eolForcedTextClassification.Count -eq 1 -and $eolForcedTextClassification[0] -match '^i/-text\s' -and $eolForcedTextClassification[0] -match '\sattr/text\s') "EOL fixture reproduces forced text with binary-looking bytes: $($eolForcedTextClassification -join '; ')"

    $eolDigest = Get-TestV2TreeDigest -Root $eolSkill -BinaryPaths @('payload.bin')
    $eolManifest = [ordered]@{
        schema_version = 'agent-skills-manifest/v2'
        roots = [ordered]@{ claude = '.claude/skills'; codex = '.codex/skills' }
        entry_defaults = [ordered]@{ owner = 'agent-governance'; executable_consumer = 'scripts/dev/sync-agent-skills.ps1' }
        skills = @([ordered]@{
            name = 'eol-demo'
            locations = [ordered]@{ claude = '.claude/skills/eol-demo' }
            sync = [ordered]@{ mode = 'single' }
            provenance = [ordered]@{ kind = 'fixture'; source = 'test'; import_commit = 'fixture' }
            integrity = [ordered]@{ format = 'agent-skill-tree/v2'; algorithm = 'sha256'; trees = [ordered]@{ claude = $eolDigest } }
        })
    }
    $eolManifestPath = Join-Path $eolFixtureRoot 'agent-skills-manifest.json'
    $eolManifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $eolManifestPath -Encoding UTF8

    & $scriptUnderTest -Mode Check -RepoRoot $eolFixtureRoot -ManifestPath $eolManifestPath
    [IO.File]::WriteAllBytes((Join-Path $eolSkill 'SKILL.md'), [byte[]] @(65, 13, 10))
    & $scriptUnderTest -Mode Check -RepoRoot $eolFixtureRoot -ManifestPath $eolManifestPath

    $undeclaredGenerated = Join-Path $eolFixtureRoot '.claude\skills\generated'
    New-Item -ItemType Directory -Path $undeclaredGenerated -Force | Out-Null
    Set-Content -LiteralPath (Join-Path $undeclaredGenerated 'SKILL.md') -Value 'tool-generated advisory snapshot' -NoNewline
    $undeclaredGeneratedError = ''
    try {
        & $scriptUnderTest -Mode Check -RepoRoot $eolFixtureRoot -ManifestPath $eolManifestPath
    } catch {
        $undeclaredGeneratedError = $_.Exception.Message
    }
    Assert-True ($undeclaredGeneratedError -match [regex]::Escape('claude inventory undeclared: generated')) 'generated advisory snapshots fail closed inside the manifest-governed Claude root'
    Remove-Item -Recurse -Force -LiteralPath $undeclaredGenerated

    $localGenerated = Join-Path $eolFixtureRoot '.agents\skills\generated\fixture'
    New-Item -ItemType Directory -Path $localGenerated -Force | Out-Null
    Set-Content -LiteralPath (Join-Path $localGenerated 'SKILL.md') -Value 'tool-generated advisory snapshot' -NoNewline
    & $scriptUnderTest -Mode Check -RepoRoot $eolFixtureRoot -ManifestPath $eolManifestPath

    [IO.File]::WriteAllBytes((Join-Path $eolSkill 'payload.bin'), [byte[]] @(65, 10, 66))
    $binaryMutationFailed = $false
    try {
        & $scriptUnderTest -Mode Check -RepoRoot $eolFixtureRoot -ManifestPath $eolManifestPath
    } catch {
        $binaryMutationFailed = $true
    }
    Assert-True $binaryMutationFailed 'v2 preserves raw binary CRLF bytes'
    [IO.File]::WriteAllBytes((Join-Path $eolSkill 'payload.bin'), [byte[]] @(65, 13, 10, 66))

    [IO.File]::WriteAllBytes((Join-Path $eolSkill 'lone-cr.md'), [byte[]] @(65, 13, 10, 66))
    $loneCrMutationFailed = $false
    try {
        & $scriptUnderTest -Mode Check -RepoRoot $eolFixtureRoot -ManifestPath $eolManifestPath
    } catch {
        $loneCrMutationFailed = $true
    }
    Assert-True $loneCrMutationFailed 'v2 preserves lone CR bytes in Git text'
    [IO.File]::WriteAllBytes((Join-Path $eolSkill 'lone-cr.md'), [byte[]] @(65, 13, 66))

    Set-Content -LiteralPath (Join-Path $eolSkill 'untracked.md') -Value 'unreviewed' -NoNewline
    $untrackedFailed = $false
    try {
        & $scriptUnderTest -Mode Check -RepoRoot $eolFixtureRoot -ManifestPath $eolManifestPath
    } catch {
        $untrackedFailed = $true
    }
    Assert-True $untrackedFailed 'v2 rejects untracked skill assets instead of guessing text or binary'

    Remove-Item -Force -LiteralPath (Join-Path $eolSkill 'untracked.md')
    [IO.File]::WriteAllBytes((Join-Path $eolSkill 'SKILL.md'), [byte[]] @(65, 10))
    $eolMirrorTarget = Join-Path $eolCodexRoot 'eol-demo'
    New-Item -ItemType Directory -Path $eolMirrorTarget -Force | Out-Null
    [IO.File]::WriteAllBytes((Join-Path $eolMirrorTarget 'SKILL.md'), [byte[]] @(65, 13, 10))
    [IO.File]::WriteAllBytes((Join-Path $eolMirrorTarget 'empty.md'), [byte[]]::new(0))
    [IO.File]::WriteAllBytes((Join-Path $eolMirrorTarget 'lone-cr.md'), [byte[]] @(65, 13, 66))
    [IO.File]::WriteAllBytes((Join-Path $eolMirrorTarget 'payload.bin'), [byte[]] @(65, 13, 10, 66))
    [IO.File]::WriteAllBytes((Join-Path $eolMirrorTarget 'forced-text.dat'), [byte[]] @(65, 0, 13, 10, 66))
    & git -C $eolFixtureRoot add -f -- '.codex/skills/eol-demo/SKILL.md' '.codex/skills/eol-demo/empty.md' '.codex/skills/eol-demo/lone-cr.md' '.codex/skills/eol-demo/payload.bin' '.codex/skills/eol-demo/forced-text.dat'
    Assert-True ($LASTEXITCODE -eq 0) 'raw-mirror fixture stages the target tree'
    $eolManifest.skills[0].locations.Add('codex', '.codex/skills/eol-demo')
    $eolManifest.skills[0].sync = [ordered]@{ mode = 'mirror'; source = 'claude'; targets = @('codex') }
    $eolManifest.skills[0].integrity.trees.Add('codex', $eolDigest)
    $eolManifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $eolManifestPath -Encoding UTF8
    $rawMirrorError = ''
    try {
        & $scriptUnderTest -Mode Check -RepoRoot $eolFixtureRoot -ManifestPath $eolManifestPath
    } catch {
        $rawMirrorError = $_.Exception.Message
    }
    Assert-True ($rawMirrorError -match [regex]::Escape('eol-demo claude->codex content drift: SKILL.md')) 'mirror equality remains raw-byte strict even when v2 text digests are equal'
} finally {
    if (Test-Path -LiteralPath $eolFixtureRoot) {
        Remove-Item -Recurse -Force -LiteralPath $eolFixtureRoot
    }
}

$missingTargetFixtureRoot = Join-Path ([IO.Path]::GetTempPath()) ("agent-skills-missing-target-" + [guid]::NewGuid().ToString('N'))
try {
    $missingTargetSource = Join-Path $missingTargetFixtureRoot '.claude\skills\demo'
    $missingTargetCodexRoot = Join-Path $missingTargetFixtureRoot '.codex\skills'
    $missingTargetPath = Join-Path $missingTargetCodexRoot 'demo'
    $missingTargetConsumer = Join-Path $missingTargetFixtureRoot 'scripts\dev\sync-agent-skills.ps1'
    New-Item -ItemType Directory -Path $missingTargetSource, $missingTargetCodexRoot, (Split-Path -Parent $missingTargetConsumer) -Force | Out-Null
    [IO.File]::WriteAllBytes((Join-Path $missingTargetSource 'SKILL.md'), [byte[]] @(65, 10))
    Set-Content -LiteralPath $missingTargetConsumer -Value '# fixture consumer' -NoNewline
    Set-Content -LiteralPath (Join-Path $missingTargetFixtureRoot '.gitattributes') -Value @('*.md text eol=lf')
    & git -C $missingTargetFixtureRoot init --quiet
    Assert-True ($LASTEXITCODE -eq 0) 'missing-target fixture initializes a Git repository'
    & git -C $missingTargetFixtureRoot config core.autocrlf false
    & git -C $missingTargetFixtureRoot config core.eol lf
    & git -C $missingTargetFixtureRoot add -f -- '.gitattributes' '.claude/skills/demo/SKILL.md'
    Assert-True ($LASTEXITCODE -eq 0) 'missing-target fixture tracks only the canonical source'

    $missingTargetDigest = Get-TestV2TreeDigest -Root $missingTargetSource
    $missingTargetManifest = [ordered]@{
        schema_version = 'agent-skills-manifest/v2'
        roots = [ordered]@{ claude = '.claude/skills'; codex = '.codex/skills' }
        entry_defaults = [ordered]@{ owner = 'agent-governance'; executable_consumer = 'scripts/dev/sync-agent-skills.ps1' }
        skills = @([ordered]@{
            name = 'demo'
            locations = [ordered]@{ claude = '.claude/skills/demo'; codex = '.codex/skills/demo' }
            sync = [ordered]@{ mode = 'mirror'; source = 'claude'; targets = @('codex') }
            provenance = [ordered]@{ kind = 'fixture'; source = 'test'; import_commit = 'fixture' }
            integrity = [ordered]@{ format = 'agent-skill-tree/v2'; algorithm = 'sha256'; trees = [ordered]@{ claude = $missingTargetDigest; codex = $missingTargetDigest } }
        })
    }
    $missingTargetManifestPath = Join-Path $missingTargetFixtureRoot 'agent-skills-manifest.json'
    $missingTargetManifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $missingTargetManifestPath -Encoding UTF8
    $beforeMissingTargetSync = Get-TreeFingerprint $missingTargetFixtureRoot
    $missingTargetFailed = $false
    try {
        & $scriptUnderTest -Mode Sync -RepoRoot $missingTargetFixtureRoot -ManifestPath $missingTargetManifestPath
    } catch {
        $missingTargetFailed = $true
    }
    Assert-True $missingTargetFailed 'Sync rejects a mirror target whose planned files are absent from the Git index'
    Assert-True (-not (Test-Path -LiteralPath $missingTargetPath)) 'missing untracked mirror target is rejected before materialization'
    Assert-True ((Get-TreeFingerprint $missingTargetFixtureRoot) -ceq $beforeMissingTargetSync) 'missing-target tracking preflight performs zero writes'
} finally {
    if (Test-Path -LiteralPath $missingTargetFixtureRoot) {
        Remove-Item -Recurse -Force -LiteralPath $missingTargetFixtureRoot
    }
}

try {
    $source = Join-Path $fixtureRoot '.claude\skills\demo'
    $target = Join-Path $fixtureRoot '.codex\skills\demo'
    $independent = Join-Path $fixtureRoot '.codex\skills\keep'
    New-Item -ItemType Directory -Path $source, $target, $independent -Force | Out-Null
    Set-Content -LiteralPath (Join-Path $source 'SKILL.md') -Value "source`n" -NoNewline
    Set-Content -LiteralPath (Join-Path $target 'SKILL.md') -Value "drift`n" -NoNewline
    Set-Content -LiteralPath (Join-Path $target 'stale.txt') -Value 'remove me' -NoNewline
    Set-Content -LiteralPath (Join-Path $independent 'SKILL.md') -Value 'keep me' -NoNewline
    Set-Content -LiteralPath (Join-Path $fixtureRoot '.gitattributes') -Value @('*.md text', '*.txt text')
    & git -C $fixtureRoot init --quiet
    Assert-True ($LASTEXITCODE -eq 0) 'sync fixture initializes a Git repository'
    & git -C $fixtureRoot config core.autocrlf false
    Assert-True ($LASTEXITCODE -eq 0) 'sync fixture disables checkout conversion while staging canonical files'
    & git -C $fixtureRoot config core.eol lf
    Assert-True ($LASTEXITCODE -eq 0) 'sync fixture fixes Git text checkout style independently of machine defaults'
    & git -C $fixtureRoot add -f -- '.gitattributes' '.claude/skills/demo/SKILL.md' '.codex/skills/demo/SKILL.md' '.codex/skills/demo/stale.txt' '.codex/skills/keep/SKILL.md'
    Assert-True ($LASTEXITCODE -eq 0) 'sync fixture stages every governed skill asset'

    $demoDigest = Get-TestTreeDigest $source
    $keepDigest = Get-TestTreeDigest $independent
    $manifest = [ordered]@{
        schema_version = 'agent-skills-manifest/v2'
        roots = [ordered]@{ claude = '.claude/skills'; codex = '.codex/skills' }
        entry_defaults = [ordered]@{ owner = 'agent-governance'; executable_consumer = 'scripts/dev/sync-agent-skills.ps1' }
        skills = @(
            [ordered]@{
                name = 'demo'
                locations = [ordered]@{ claude = '.claude/skills/demo'; codex = '.codex/skills/demo' }
                sync = [ordered]@{ mode = 'mirror'; source = 'claude'; targets = @('codex') }
                provenance = [ordered]@{ kind = 'fixture'; source = 'test'; import_commit = 'fixture' }
                integrity = [ordered]@{ format = 'agent-skill-tree/v2'; algorithm = 'sha256'; trees = [ordered]@{ claude = $demoDigest; codex = $demoDigest } }
            },
            [ordered]@{
                name = 'keep'
                locations = [ordered]@{ codex = '.codex/skills/keep' }
                sync = [ordered]@{ mode = 'single' }
                provenance = [ordered]@{ kind = 'fixture'; source = 'test'; import_commit = 'fixture' }
                integrity = [ordered]@{ format = 'agent-skill-tree/v2'; algorithm = 'sha256'; trees = [ordered]@{ codex = $keepDigest } }
            }
        )
    }
    $fixtureConsumer = Join-Path $fixtureRoot 'scripts\dev\sync-agent-skills.ps1'
    New-Item -ItemType Directory -Path (Split-Path -Parent $fixtureConsumer) -Force | Out-Null
    Set-Content -LiteralPath $fixtureConsumer -Value '# fixture consumer' -NoNewline
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

    $beforeReadOnlyCheck = Get-TreeFingerprint $fixtureRoot
    & $scriptUnderTest -Mode Check -RepoRoot $fixtureRoot -ManifestPath $manifestPath
    $afterReadOnlyCheck = Get-TreeFingerprint $fixtureRoot
    Assert-True ($afterReadOnlyCheck -ceq $beforeReadOnlyCheck) 'successful Check mode performs zero filesystem writes'

    Remove-Item -Recurse -Force -LiteralPath $target
    Assert-True (-not (Test-Path -LiteralPath $target)) 'tracked mirror target can be absent from the working tree'
    & $scriptUnderTest -Mode Sync -RepoRoot $fixtureRoot -ManifestPath $manifestPath
    Assert-True ((Get-Content -Raw -LiteralPath (Join-Path $target 'SKILL.md')) -eq "source`n") 'Sync restores a deleted target whose files remain tracked in the Git index'
    & $scriptUnderTest -Mode Check -RepoRoot $fixtureRoot -ManifestPath $manifestPath

    Set-Content -LiteralPath (Join-Path $source 'SKILL.md') -Value 'tampered canonical source' -NoNewline
    $beforeRejectedSource = Get-TreeFingerprint $fixtureRoot
    $tamperedSourceFailed = $false
    try {
        & $scriptUnderTest -Mode Sync -RepoRoot $fixtureRoot -ManifestPath $manifestPath
    } catch {
        $tamperedSourceFailed = $true
    }
    $afterRejectedSource = Get-TreeFingerprint $fixtureRoot
    Assert-True $tamperedSourceFailed 'sync rejects a canonical source whose tree digest no longer matches the reviewed manifest'
    Assert-True ($afterRejectedSource -ceq $beforeRejectedSource) 'source-integrity preflight failure performs zero writes'
    Set-Content -LiteralPath (Join-Path $source 'SKILL.md') -Value "source`n" -NoNewline

    $manifest.entry_defaults.executable_consumer = 'scripts/dev/missing-consumer.ps1'
    $manifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $manifestPath -Encoding UTF8
    $missingConsumerFailed = $false
    try {
        & $scriptUnderTest -Mode Check -RepoRoot $fixtureRoot -ManifestPath $manifestPath
    } catch {
        $missingConsumerFailed = $true
    }
    Assert-True $missingConsumerFailed 'check mode rejects a missing executable skill consumer'

    $manifest.entry_defaults.executable_consumer = 'scripts/dev/sync-agent-skills.ps1'
    Set-Content -LiteralPath (Join-Path $target 'SKILL.md') -Value 'drift again' -NoNewline
    Set-Content -LiteralPath (Join-Path $target 'stale-again.txt') -Value 'must survive rejected preflight' -NoNewline
    $attackSource = Join-Path $fixtureRoot '.claude\skills\attack'
    New-Item -ItemType Directory -Path $attackSource -Force | Out-Null
    Set-Content -LiteralPath (Join-Path $attackSource 'SKILL.md') -Value 'malicious source' -NoNewline
    & git -C $fixtureRoot add -f -- '.claude/skills/attack/SKILL.md'
    Assert-True ($LASTEXITCODE -eq 0) 'malicious-target fixture still tracks its source asset'
    $attackDigest = Get-TestTreeDigest $attackSource
    Set-Content -LiteralPath (Join-Path (Split-Path -Parent $fixtureConsumer) 'protected.txt') -Value 'must not be overwritten or deleted' -NoNewline
    $manifest.skills += [ordered]@{
        name = 'attack'
        locations = [ordered]@{ claude = '.claude/skills/attack'; codex = 'scripts/dev' }
        sync = [ordered]@{ mode = 'mirror'; source = 'claude'; targets = @('codex') }
        provenance = [ordered]@{ kind = 'fixture'; source = 'malicious-test'; import_commit = 'fixture' }
        integrity = [ordered]@{ format = 'agent-skill-tree/v2'; algorithm = 'sha256'; trees = [ordered]@{ claude = $attackDigest; codex = $attackDigest } }
    }
    $manifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $manifestPath -Encoding UTF8
    $beforeRejectedSync = Get-TreeFingerprint $fixtureRoot
    $maliciousTargetFailed = $false
    try {
        & $scriptUnderTest -Mode Sync -RepoRoot $fixtureRoot -ManifestPath $manifestPath
    } catch {
        $maliciousTargetFailed = $true
    }
    $afterRejectedSync = Get-TreeFingerprint $fixtureRoot
    Assert-True $maliciousTargetFailed 'sync rejects a target outside the declared platform root'
    Assert-True ($afterRejectedSync -ceq $beforeRejectedSync) 'failed preflight performs zero writes before rejecting a malicious target'
    Assert-True ((Get-Content -Raw -LiteralPath (Join-Path $target 'SKILL.md')) -eq 'drift again') 'rejected preflight does not mutate an earlier valid mirror plan'
    Assert-True (Test-Path -LiteralPath (Join-Path $target 'stale-again.txt')) 'rejected preflight does not delete stale files from an earlier valid mirror plan'
    Assert-True ((Get-Content -Raw -LiteralPath (Join-Path (Split-Path -Parent $fixtureConsumer) 'protected.txt')) -eq 'must not be overwritten or deleted') 'rejected preflight preserves sensitive in-repo content'

    $reparseFixture = Join-Path $fixtureRoot 'reparse-fixture'
    $reparseRepo = Join-Path $reparseFixture 'repo'
    $reparseSource = Join-Path $reparseRepo '.claude\skills\demo'
    $outsideCodex = Join-Path $reparseFixture 'outside-codex'
    $reparseTarget = Join-Path $outsideCodex 'skills\demo'
    $reparseConsumer = Join-Path $reparseRepo 'scripts\dev\sync-agent-skills.ps1'
    New-Item -ItemType Directory -Path $reparseSource, $reparseTarget, (Split-Path -Parent $reparseConsumer) -Force | Out-Null
    Set-Content -LiteralPath (Join-Path $reparseSource 'SKILL.md') -Value 'same content' -NoNewline
    Set-Content -LiteralPath (Join-Path $reparseTarget 'SKILL.md') -Value 'same content' -NoNewline
    Set-Content -LiteralPath (Join-Path $reparseTarget 'protected.txt') -Value 'outside repo' -NoNewline
    Set-Content -LiteralPath $reparseConsumer -Value '# fixture consumer' -NoNewline
    New-Item -ItemType Junction -Path (Join-Path $reparseRepo '.codex') -Target $outsideCodex | Out-Null
    $reparseDigest = Get-TestTreeDigest $reparseSource
    $reparseManifest = [ordered]@{
        schema_version = 'agent-skills-manifest/v2'
        roots = [ordered]@{ claude = '.claude/skills'; codex = '.codex/skills' }
        entry_defaults = [ordered]@{ owner = 'agent-governance'; executable_consumer = 'scripts/dev/sync-agent-skills.ps1' }
        skills = @([ordered]@{
            name = 'demo'
            locations = [ordered]@{ claude = '.claude/skills/demo'; codex = '.codex/skills/demo' }
            sync = [ordered]@{ mode = 'mirror'; source = 'claude'; targets = @('codex') }
            provenance = [ordered]@{ kind = 'fixture'; source = 'reparse-test'; import_commit = 'fixture' }
            integrity = [ordered]@{ format = 'agent-skill-tree/v2'; algorithm = 'sha256'; trees = [ordered]@{ claude = $reparseDigest; codex = $reparseDigest } }
        })
    }
    $reparseManifestPath = Join-Path $reparseRepo 'agent-skills-manifest.json'
    $reparseManifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $reparseManifestPath -Encoding UTF8
    $beforeReparseTarget = Get-TreeFingerprint $outsideCodex
    $reparseFailed = $false
    try {
        & $scriptUnderTest -Mode Sync -RepoRoot $reparseRepo -ManifestPath $reparseManifestPath
    } catch {
        $reparseFailed = $true
    }
    Assert-True $reparseFailed 'sync rejects a platform-root ancestor junction before traversal or writes'
    Assert-True ((Get-TreeFingerprint $outsideCodex) -ceq $beforeReparseTarget) 'ancestor-junction rejection preserves the out-of-repo target tree'
    Assert-True (-not (Test-Path -LiteralPath (Join-Path $reparseRepo 'logs'))) 'ancestor-junction rejection creates no log or artifact'

    $logRecords = @(Get-ChildItem -Recurse -File -Filter '*.jsonl' -LiteralPath (Join-Path $fixtureRoot 'logs') | ForEach-Object {
        Get-Content -LiteralPath $_.FullName | ForEach-Object { $_ | ConvertFrom-Json }
    })
    Assert-True (@($logRecords | Where-Object { $_.msg -eq 'agent skill sync complete' }).Count -eq 2) 'each successful sync emits one structured success record'
    Assert-True (@($logRecords | Where-Object { $_.msg -eq 'agent skill check passed' }).Count -eq 0) 'read-only Check mode does not create a structured log file'
} finally {
    if (Test-Path -LiteralPath $fixtureRoot) {
        Remove-Item -Recurse -Force -LiteralPath $fixtureRoot
    }
}

$repoManifest = Get-Content -Raw -LiteralPath (Join-Path $repoRoot 'agent-skills-manifest.json') | ConvertFrom-Json
Assert-True ($repoManifest.schema_version -eq 'agent-skills-manifest/v2') 'skill inventory uses the enforced integrity schema'
Assert-True ($repoManifest.entry_defaults.owner -eq 'agent-governance') 'every skill inherits the agent-governance owner'
Assert-True (Test-Path -LiteralPath (Join-Path $repoRoot $repoManifest.entry_defaults.executable_consumer) -PathType Leaf) 'every skill inherits an executable repo consumer'
foreach ($skill in $repoManifest.skills) {
    Assert-True ($skill.sync.mode -in @('single', 'independent', 'mirror')) "$($skill.name) has an enforced sync mode"
    Assert-True ($skill.integrity.format -eq 'agent-skill-tree/v2' -and $skill.integrity.algorithm -eq 'sha256') "$($skill.name) has an enforced tree-integrity format"
    $locationPlatforms = @($skill.locations.PSObject.Properties.Name | Sort-Object)
    $integrityPlatforms = @($skill.integrity.trees.PSObject.Properties.Name | Sort-Object)
    Assert-True (($locationPlatforms -join ',') -ceq ($integrityPlatforms -join ',')) "$($skill.name) integrity covers exactly its declared locations"
    foreach ($digest in $skill.integrity.trees.PSObject.Properties.Value) {
        Assert-True ([string] $digest -cmatch '^[a-f0-9]{64}$') "$($skill.name) has a lowercase SHA-256 tree digest"
    }
    if ($skill.sync.mode -eq 'mirror') {
        $sourceDigest = [string] $skill.integrity.trees.PSObject.Properties[[string] $skill.sync.source].Value
        foreach ($targetPlatform in @($skill.sync.targets)) {
            Assert-True ([string] $skill.integrity.trees.PSObject.Properties[[string] $targetPlatform].Value -eq $sourceDigest) "$($skill.name) mirror target integrity matches its canonical source"
        }
    }
}
$blastRadiusEntry = @($repoManifest.skills | Where-Object { $_.name -eq 'gitnexus-blast-radius' })
Assert-True ($blastRadiusEntry.Count -eq 1) 'manifest declares one GitNexus blast-radius skill'
$gitnexusEntry = @($repoManifest.skills | Where-Object { $_.name -eq 'gitnexus' })
Assert-True ($gitnexusEntry.Count -eq 1 -and $gitnexusEntry[0].provenance.kind -eq 'generated-adapted') 'manifest records the repo adaptation applied to generated GitNexus skills'
$historicalGitnexusValidation = Get-Content -Raw -LiteralPath (Join-Path $repoRoot 'docs\gitnexus-validation.md')
Assert-True ($historicalGitnexusValidation -match '(?im)^> Document nature: \*\*historical validation record\*\*') 'the legacy GitNexus validation transcript is explicitly historical'
Assert-True ($historicalGitnexusValidation -notmatch '(?im)^## Re-run Commands\s*$') 'the historical GitNexus validation transcript has no prescriptive re-run section'
$claudeBlastRadius = Get-Content -Raw -LiteralPath (Join-Path (Join-Path $repoRoot $blastRadiusEntry[0].locations.claude) 'SKILL.md')
$codexBlastRadius = Get-Content -Raw -LiteralPath (Join-Path (Join-Path $repoRoot $blastRadiusEntry[0].locations.codex) 'SKILL.md')
Assert-True ([regex]::Matches($claudeBlastRadius, 'gitnexus analyze --index-only --embeddings').Count -eq 3) 'every GitNexus blast-radius index refresh is injection-free'
Assert-True ($codexBlastRadius -ceq $claudeBlastRadius) 'Codex mirrors the injection-free GitNexus blast-radius workflow byte-for-byte'
$activeIndexRefreshFiles = @(
    'AGENTS.md',
    'CLAUDE.md',
    'docs/agents/gitnexus-usage.md',
    '.claude/skills/README.md',
    '.claude/skills/gitnexus-blast-radius/SKILL.md',
    '.codex/skills/gitnexus-blast-radius/SKILL.md',
    '.claude/workflows/std-plan.js',
    '.claude/workflows/std-implement.js',
    'openspec/changes/a4-console-convergence/tasks.md'
) + @(Get-ChildItem -Recurse -File -Filter 'SKILL.md' -LiteralPath (Join-Path $repoRoot '.claude\skills\gitnexus') | ForEach-Object {
    [IO.Path]::GetRelativePath($repoRoot, $_.FullName).Replace('\', '/')
})
foreach ($relative in @($activeIndexRefreshFiles | Sort-Object -Unique)) {
    $content = Get-Content -Raw -LiteralPath (Join-Path $repoRoot $relative)
    Assert-True ($content -notmatch 'node \.gitnexus/run\.cjs analyze(?! --index-only\b)') "$relative has no bare, path-form, or flag-before-index-only wrapper analyze command"
    Assert-True ($content -notmatch '(?<![A-Za-z0-9@./-])gitnexus(?:@[A-Za-z0-9._-]+)? analyze(?! --index-only\b)') "$relative has no bare, path-form, or version-pinned context-injecting analyze command"
    Assert-True ($content -notmatch '--skip-agents-md|--skills') "$relative never requests partial or community-skill injection"
}
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

$expectedExecutableSkillFiles = @(
    'brainstorming/scripts/start-server.sh',
    'brainstorming/scripts/stop-server.sh',
    'subagent-driven-development/scripts/review-package',
    'subagent-driven-development/scripts/sdd-workspace',
    'subagent-driven-development/scripts/task-brief',
    'systematic-debugging/find-polluter.sh',
    'writing-skills/render-graphs.js'
)
foreach ($relativePath in $expectedExecutableSkillFiles) {
    foreach ($platform in @('claude', 'codex')) {
        $repoPath = ".$platform/skills/$relativePath"
        $indexEntry = @(& git -C $repoRoot ls-files --stage -- $repoPath)
        Assert-True ($indexEntry.Count -eq 1) "$platform executable skill file is tracked: $relativePath"
        Assert-True ($indexEntry[0].Substring(0, 6) -eq '100755') "$platform preserves upstream executable mode for $relativePath"
    }
}

$explicitOnlySuperpowersSkills = @(
    'brainstorming',
    'dispatching-parallel-agents',
    'finishing-a-development-branch',
    'requesting-code-review',
    'subagent-driven-development',
    'test-driven-development',
    'using-git-worktrees',
    'using-superpowers',
    'writing-plans'
)
foreach ($skillName in $explicitOnlySuperpowersSkills) {
    $metadataPath = Join-Path $repoRoot ".codex\skills\$skillName\agents\openai.yaml"
    Assert-True (Test-Path -LiteralPath $metadataPath) "$skillName has Codex invocation metadata"
    Assert-True ((Get-Content -Raw -LiteralPath $metadataPath) -match 'allow_implicit_invocation:\s*false') "$skillName cannot be invoked implicitly by Codex"
}

$skillPolicyChecks = @(
    @{
        Skill = 'brainstorming'
        Pattern = 'terminal state is requesting separate authorization to plan'
        Message = 'brainstorming stops for separate planning authorization'
    },
    @{
        Skill = 'writing-plans'
        Pattern = 'This plan does not authorize implementation'
        Message = 'generated plans do not authorize implementation'
    },
    @{
        Skill = 'using-git-worktrees'
        Pattern = 'git check-ignore -q -- "\$LOCATION"'
        Message = 'worktree safety checks the exact selected location'
    },
    @{
        Skill = 'finishing-a-development-branch'
        Pattern = 'gh pr create --base <base-branch> --head <feature-branch>'
        Message = 'push-and-create-PR option actually creates the PR'
    }
)
foreach ($check in $skillPolicyChecks) {
    foreach ($platform in @('claude', 'codex')) {
        $skillPath = Join-Path $repoRoot ".$platform\skills\$($check.Skill)\SKILL.md"
        Assert-True ((Get-Content -Raw -LiteralPath $skillPath) -match $check.Pattern) "$platform $($check.Message)"
    }
}

foreach ($platform in @('claude', 'codex')) {
    $visualCompanionPath = Join-Path $repoRoot ".$platform\skills\brainstorming\visual-companion.md"
    $visualCompanion = Get-Content -Raw -LiteralPath $visualCompanionPath
    Assert-True ($visualCompanion -match 'Run every shell command in this guide from the skill directory') "$platform visual companion declares its command working directory"
    Assert-True ($visualCompanion -match '(?m)^\./scripts/start-server\.sh ') "$platform visual companion invokes the vendored start-server script"
    Assert-True ($visualCompanion -match '(?m)^\./scripts/stop-server\.sh ') "$platform visual companion invokes the vendored stop-server script"
}

$ornithExamples = Get-Content -Raw -LiteralPath (Join-Path $repoRoot 'ornith-vllm-api-examples.html')
Assert-True ($ornithExamples -match 'Read-Host "ORNITH_API_KEY" -AsSecureString') 'Ornith PowerShell example prompts securely for the API key'
Assert-True ($ornithExamples -notmatch '\$env:ORNITH_API_KEY\s*=\s*"&lt;YOUR_ORNITH_API_KEY&gt;"') 'Ornith PowerShell example does not put a pasted API key assignment in shell history'

$testLogger = New-StructLogger -Service 'scripts' -Component 'test-agent-skills-sync' -SkipEnvSnapshot -InMemoryOnly
$testLogger | Write-StructInfo -Msg '[test-agent-skills-sync] all assertions passed' -Data @{ result = 'passed' }
