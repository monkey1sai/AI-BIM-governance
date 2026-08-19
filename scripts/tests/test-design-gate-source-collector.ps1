#requires -Version 7.0
[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'test-helpers.ps1')

$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$collectorPath = Join-Path $repoRoot 'scripts\lib\design-gate-source-collector.ps1'
$policyPath = Join-Path $repoRoot 'scripts\config\design-gate-policy.json'
$schemaPath = Join-Path $repoRoot 'scripts\tests\design-gate-policy.schema.json'

Assert-True (Test-Path -LiteralPath $collectorPath -PathType Leaf) 'scripts/lib/design-gate-source-collector.ps1 exists'
. $collectorPath

function Assert-SourceCode {
    param(
        [Parameter(Mandatory = $true)][scriptblock] $Action,
        [Parameter(Mandatory = $true)][string] $Code,
        [Parameter(Mandatory = $true)][string] $Context
    )
    $failed = $false
    $message = ''
    try { & $Action | Out-Null } catch {
        $failed = $true
        $message = [string]$_.Exception.Message
    }
    Assert-True $failed "$Context was expected to throw"
    Assert-True ($message.StartsWith("${Code}:", [System.StringComparison]::Ordinal)) `
        "$Context expected prefix '${Code}:' actual='$message'"
}

function Get-IndependentBlobSha256 {
    param(
        [Parameter(Mandatory = $true)][string] $Root,
        [Parameter(Mandatory = $true)][string] $BlobOid
    )
    $outFile = Join-Path ([System.IO.Path]::GetTempPath()) "design-gate-indep-$([guid]::NewGuid().ToString('N'))"
    $errFile = "$outFile.err"
    try {
        $proc = Start-Process -FilePath (Get-Command git -ErrorAction Stop).Source `
            -ArgumentList @('-C', $Root, '-c', "safe.directory=$Root", 'cat-file', 'blob', $BlobOid) `
            -RedirectStandardOutput $outFile -RedirectStandardError $errFile -Wait -NoNewWindow -PassThru
        Assert-Equal 0 $proc.ExitCode "independent cat-file $BlobOid"
        return (Get-FileHash -LiteralPath $outFile -Algorithm SHA256).Hash.ToLowerInvariant()
    } finally {
        Remove-Item -LiteralPath $outFile, $errFile -Force -ErrorAction SilentlyContinue
    }
}

function New-FixturePolicyBytes {
    param([Parameter(Mandatory = $true)][string] $Root)
    $canonical = Get-Content -LiteralPath $policyPath -Raw -Encoding utf8
    $dest = Join-Path $Root 'scripts\config\design-gate-policy.json'
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $dest) | Out-Null
    New-Item -ItemType Directory -Force -Path (Join-Path $Root 'scripts\tests') | Out-Null
    Copy-Item -LiteralPath $schemaPath -Destination (Join-Path $Root 'scripts\tests\design-gate-policy.schema.json')
    [System.IO.File]::WriteAllText($dest, $canonical, [System.Text.UTF8Encoding]::new($false))
    return $dest
}

function New-TrackedHtml {
    param(
        [Parameter(Mandatory = $true)][string] $Root,
        [Parameter(Mandatory = $true)][string] $RelativePath,
        [Parameter(Mandatory = $true)][string] $LfBody
    )
    $absolute = Join-Path $Root ($RelativePath.Replace('/', '\'))
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $absolute) | Out-Null
    [System.IO.File]::WriteAllText($absolute, $LfBody, [System.Text.UTF8Encoding]::new($false))
}

function Initialize-FixtureGit {
    param([Parameter(Mandatory = $true)][string] $Root)
    Push-Location $Root
    try {
        git init -q -b main
        git config user.email 'design-gate@example.invalid'
        git config user.name 'Design Gate Test'
    } finally {
        Pop-Location
    }
}

function Invoke-FixtureGit {
    param(
        [Parameter(Mandatory = $true)][string] $Root,
        [Parameter(Mandatory = $true)][string[]] $ArgumentList
    )
    Push-Location $Root
    try {
        $output = & git @ArgumentList
        if ($LASTEXITCODE -ne 0) { throw "fixture git $($ArgumentList -join ' ') failed: $output" }
        return $output
    } finally {
        Pop-Location
    }
}

$archPath = 'docs/plans/AI-BIM 前後端設計文件.dc.html'
$hifiPath = 'docs/plans/AI-BIM Console Hi-Fi.dc.html'
$archBody = "<!doctype html>`n<title>architecture</title>`n"
$hifiBody = "<!doctype html>`n<title>hifi</title>`n"

# --- Live repo: current checkout matches git ls-files and raw blob digest ---
$liveLs = @(& git -C $repoRoot ls-files -- 'docs/plans/*.html')
Assert-Equal 2 $liveLs.Count 'live source set has exactly two tracked HTML files'
Assert-True ($liveLs -contains $archPath) 'live set contains architecture HTML'
Assert-True ($liveLs -contains $hifiPath) 'live set contains console hifi HTML'

$live = Get-DesignGateSourceCollection -RepoRoot $repoRoot -PolicyPath $policyPath -SchemaPath $schemaPath
Assert-True $live.ok 'live current collection ok'
Assert-True (-not [bool]$live.successful_eligibility) 'live collection does not grant eligibility'
Assert-Equal 2 @($live.sources).Count 'live collection has two sources'
$head = (& git -C $repoRoot rev-parse HEAD).Trim()
Assert-Equal $head ([string]$live.resolved_commit) 'live resolved commit is HEAD'
foreach ($path in @($archPath, $hifiPath)) {
    $record = @($live.sources | Where-Object { [string]$_.path -eq $path })
    Assert-Equal 1 $record.Count "live record for $path"
    $oid = (& git -C $repoRoot rev-parse "HEAD:$path").Trim()
    Assert-Equal $oid ([string]$record[0].blob_oid) "live blob oid for $path"
    $expectedSha = Get-IndependentBlobSha256 -Root $repoRoot -BlobOid $oid
    Assert-Equal $expectedSha ([string]$record[0].sha256) "live raw-blob sha256 for $path"
}

$named = Get-DesignGateSourceCollection -RepoRoot $repoRoot -PolicyPath $policyPath -SchemaPath $schemaPath -Ref 'HEAD'
Assert-True $named.ok 'named HEAD collection ok'
Assert-Equal $head ([string]$named.resolved_commit) 'named HEAD commit'
Assert-Equal 2 @($named.sources).Count 'named HEAD has two sources'

$lsTreeGlob = @(& git -C $repoRoot ls-tree -r --name-only HEAD -- 'docs/plans/*.html')
Assert-Equal 0 @($lsTreeGlob | Where-Object { $_ }).Count 'ls-tree pathspec glob does not match .dc.html; collector must not use it'
$collectorText = Get-Content -LiteralPath $collectorPath -Raw -Encoding utf8
Assert-True ($collectorText -notmatch "ls-tree[^\r\n]*docs/plans/\*\.html") 'collector source does not pass docs/plans/*.html to ls-tree'

# --- Isolated fixture: current / base / head valid collection ---
$tempRoot = Join-Path $repoRoot "artifacts\tmp\design-gate-source-$([guid]::NewGuid().ToString('N'))"
New-Item -ItemType Directory -Force -Path $tempRoot | Out-Null
try {
    $validRoot = Join-Path $tempRoot 'valid'
    New-Item -ItemType Directory -Force -Path $validRoot | Out-Null
    Initialize-FixtureGit -Root $validRoot
    $fixturePolicy = New-FixturePolicyBytes -Root $validRoot
    New-TrackedHtml -Root $validRoot -RelativePath $archPath -LfBody $archBody
    New-TrackedHtml -Root $validRoot -RelativePath $hifiPath -LfBody $hifiBody
    Invoke-FixtureGit -Root $validRoot -ArgumentList @('add', '--', 'docs/plans', 'scripts/config', 'scripts/tests')
    Invoke-FixtureGit -Root $validRoot -ArgumentList @('commit', '-q', '-m', 'base html')
    $validHead = (Invoke-FixtureGit -Root $validRoot -ArgumentList @('rev-parse', 'HEAD')).Trim()

    $validCurrent = Get-DesignGateSourceCollection -RepoRoot $validRoot -PolicyPath $fixturePolicy -SchemaPath (Join-Path $validRoot 'scripts\tests\design-gate-policy.schema.json')
    Assert-True $validCurrent.ok 'fixture current ok'
    Assert-True (-not [bool]$validCurrent.successful_eligibility) 'fixture current does not grant eligibility'
    Assert-Equal $validHead ([string]$validCurrent.resolved_commit) 'fixture current commit'
    Assert-Equal 2 @($validCurrent.sources).Count 'fixture current two sources'

    $validNamed = Get-DesignGateSourceCollection -RepoRoot $validRoot -PolicyPath $fixturePolicy -SchemaPath (Join-Path $validRoot 'scripts\tests\design-gate-policy.schema.json') -Ref $validHead
    Assert-True $validNamed.ok 'fixture named ok'
    Assert-Equal $validHead ([string]$validNamed.resolved_commit) 'fixture named commit'

    $validPair = Get-DesignGateSourceCollection -RepoRoot $validRoot -PolicyPath $fixturePolicy -SchemaPath (Join-Path $validRoot 'scripts\tests\design-gate-policy.schema.json') -BaseRef $validHead -HeadRef $validHead
    Assert-True $validPair.ok 'fixture pair same-ref ok'
    Assert-Equal 2 @($validPair.sources).Count 'fixture pair two sources'

    # Untracked HTML on disk is not authority and does not fail default collection.
    New-TrackedHtml -Root $validRoot -RelativePath 'docs/plans/scratch-untracked.html' -LfBody "<!doctype html>`n<title>scratch</title>`n"
    $stillValid = Get-DesignGateSourceCollection -RepoRoot $validRoot -PolicyPath $fixturePolicy -SchemaPath (Join-Path $validRoot 'scripts\tests\design-gate-policy.schema.json')
    Assert-True $stillValid.ok 'untracked extra HTML is not promoted from the working tree'
    Assert-Equal 2 @($stillValid.sources).Count 'untracked HTML is absent from the source set'
    Assert-SourceCode {
        Get-DesignGateSourceCollection -RepoRoot $validRoot -PolicyPath $fixturePolicy -SchemaPath (Join-Path $validRoot 'scripts\tests\design-gate-policy.schema.json') -CandidatePaths @('docs/plans/scratch-untracked.html')
    } 'source.untracked' 'untracked candidate'

    # CRLF working tree does not change raw Git blob digest.
    $hifiAbsolute = Join-Path $validRoot ($hifiPath.Replace('/', '\'))
    $crlfBody = $hifiBody.Replace("`n", "`r`n")
    [System.IO.File]::WriteAllText($hifiAbsolute, $crlfBody, [System.Text.UTF8Encoding]::new($false))
    $workHash = (Get-FileHash -LiteralPath $hifiAbsolute -Algorithm SHA256).Hash.ToLowerInvariant()
    $afterCrlf = Get-DesignGateSourceCollection -RepoRoot $validRoot -PolicyPath $fixturePolicy -SchemaPath (Join-Path $validRoot 'scripts\tests\design-gate-policy.schema.json')
    $hifiRecord = @($afterCrlf.sources | Where-Object { [string]$_.path -eq $hifiPath })[0]
    Assert-True ($workHash -cne [string]$hifiRecord.sha256) 'working-tree CRLF hash differs from blob digest'
    $oid = (& git -C $validRoot rev-parse "HEAD:$hifiPath").Trim()
    $blobSha = Get-IndependentBlobSha256 -Root $validRoot -BlobOid $oid
    Assert-Equal $blobSha ([string]$hifiRecord.sha256) 'CRLF working tree leaves ref-bound digest unchanged'
    Assert-SourceCode {
        Get-DesignGateSourceCollection -RepoRoot $validRoot -PolicyPath $fixturePolicy -SchemaPath (Join-Path $validRoot 'scripts\tests\design-gate-policy.schema.json') -HashWorkingTreeBytes
    } 'source.working_tree_bytes_forbidden' 'working-tree bytes switch'

    Assert-SourceCode {
        Get-DesignGateSourceCollection -RepoRoot $validRoot -PolicyPath $fixturePolicy -SchemaPath (Join-Path $validRoot 'scripts\tests\design-gate-policy.schema.json') -CallerDigest ('0' * 64)
    } 'source.caller_digest_forbidden' 'caller digest'
    Assert-SourceCode {
        Get-DesignGateSourceCollection -RepoRoot $validRoot -PolicyPath $fixturePolicy -SchemaPath (Join-Path $validRoot 'scripts\tests\design-gate-policy.schema.json') -PrProse 'looks fine in the PR body'
    } 'source.pr_prose_forbidden' 'PR prose'
    Assert-SourceCode {
        Get-DesignGateSourceCollection -RepoRoot $validRoot -PolicyPath $fixturePolicy -SchemaPath (Join-Path $validRoot 'scripts\tests\design-gate-policy.schema.json') -ScreenshotPath 'docs/plans/screenshot.png'
    } 'source.screenshot_forbidden' 'screenshot'
    Assert-SourceCode {
        Get-DesignGateSourceCollection -RepoRoot $validRoot -PolicyPath $fixturePolicy -SchemaPath (Join-Path $validRoot 'scripts\tests\design-gate-policy.schema.json') -ManualBoolean $true
    } 'source.manual_boolean_forbidden' 'manual boolean'

    $outside = Join-Path $tempRoot 'outside.html'
    [System.IO.File]::WriteAllText($outside, '<!doctype html><title>outside</title>', [System.Text.UTF8Encoding]::new($false))
    Assert-SourceCode {
        Get-DesignGateSourceCollection -RepoRoot $validRoot -PolicyPath $fixturePolicy -SchemaPath (Join-Path $validRoot 'scripts\tests\design-gate-policy.schema.json') -CandidatePaths @($outside)
    } 'source.external' 'repo-external HTML'

    $originProjected = 'C:\Repos\design\desigin-system\AI-BIM Console Hi-Fi.dc.html'
    Assert-SourceCode {
        Get-DesignGateSourceCollection -RepoRoot $validRoot -PolicyPath $fixturePolicy -SchemaPath (Join-Path $validRoot 'scripts\tests\design-gate-policy.schema.json') -CandidatePaths @($originProjected)
    } 'source.origin_projected' 'origin-projected HTML'

    Assert-SourceCode {
        Get-DesignGateSourceCollection -RepoRoot $validRoot -PolicyPath $fixturePolicy -SchemaPath (Join-Path $validRoot 'scripts\tests\design-gate-policy.schema.json') -CandidatePaths @(@{
            path = $hifiPath
            source_role = 'architecture_behavior'
        })
    } 'source.role_ambiguous' 'role-ambiguous candidate'

    # Ignored HTML
    $ignoreRoot = Join-Path $tempRoot 'ignored'
    New-Item -ItemType Directory -Force -Path $ignoreRoot | Out-Null
    Initialize-FixtureGit -Root $ignoreRoot
    $ignorePolicy = New-FixturePolicyBytes -Root $ignoreRoot
    New-TrackedHtml -Root $ignoreRoot -RelativePath $archPath -LfBody $archBody
    New-TrackedHtml -Root $ignoreRoot -RelativePath $hifiPath -LfBody $hifiBody
    [System.IO.File]::WriteAllText((Join-Path $ignoreRoot '.gitignore'), "docs/plans/ignored.html`n", [System.Text.UTF8Encoding]::new($false))
    New-TrackedHtml -Root $ignoreRoot -RelativePath 'docs/plans/ignored.html' -LfBody "<!doctype html>`n<title>ignored</title>`n"
    Invoke-FixtureGit -Root $ignoreRoot -ArgumentList @('add', '--', '.gitignore', 'docs/plans', 'scripts/config', 'scripts/tests')
    Invoke-FixtureGit -Root $ignoreRoot -ArgumentList @('commit', '-q', '-m', 'ignored html')
    $ignoreCollection = Get-DesignGateSourceCollection -RepoRoot $ignoreRoot -PolicyPath $ignorePolicy -SchemaPath (Join-Path $ignoreRoot 'scripts\tests\design-gate-policy.schema.json')
    Assert-True $ignoreCollection.ok 'ignored extra HTML is not promoted'
    Assert-Equal 2 @($ignoreCollection.sources).Count 'ignored HTML is absent from the source set'
    Assert-SourceCode {
        Get-DesignGateSourceCollection -RepoRoot $ignoreRoot -PolicyPath $ignorePolicy -SchemaPath (Join-Path $ignoreRoot 'scripts\tests\design-gate-policy.schema.json') -CandidatePaths @('docs/plans/ignored.html')
    } 'source.ignored' 'ignored candidate'

    # Unregistered tracked HTML
    $unregRoot = Join-Path $tempRoot 'unregistered'
    New-Item -ItemType Directory -Force -Path $unregRoot | Out-Null
    Initialize-FixtureGit -Root $unregRoot
    $unregPolicy = New-FixturePolicyBytes -Root $unregRoot
    New-TrackedHtml -Root $unregRoot -RelativePath $archPath -LfBody $archBody
    New-TrackedHtml -Root $unregRoot -RelativePath $hifiPath -LfBody $hifiBody
    New-TrackedHtml -Root $unregRoot -RelativePath 'docs/plans/extra.dc.html' -LfBody "<!doctype html>`n<title>extra</title>`n"
    Invoke-FixtureGit -Root $unregRoot -ArgumentList @('add', '--', 'docs/plans', 'scripts/config', 'scripts/tests')
    Invoke-FixtureGit -Root $unregRoot -ArgumentList @('commit', '-q', '-m', 'unregistered html')
    $unreg = Get-DesignGateSourceCollection -RepoRoot $unregRoot -PolicyPath $unregPolicy -SchemaPath (Join-Path $unregRoot 'scripts\tests\design-gate-policy.schema.json')
    Assert-True (-not $unreg.ok) 'unregistered tracked HTML fails closed'
    Assert-Equal 'source.unregistered' ([string]$unreg.code) 'unregistered code'
    Assert-True (-not [bool]$unreg.successful_eligibility) 'unregistered does not grant eligibility'

    # Base-only deletion visibility
    $delRoot = Join-Path $tempRoot 'deleted'
    New-Item -ItemType Directory -Force -Path $delRoot | Out-Null
    Initialize-FixtureGit -Root $delRoot
    $delPolicy = New-FixturePolicyBytes -Root $delRoot
    New-TrackedHtml -Root $delRoot -RelativePath $archPath -LfBody $archBody
    New-TrackedHtml -Root $delRoot -RelativePath $hifiPath -LfBody $hifiBody
    Invoke-FixtureGit -Root $delRoot -ArgumentList @('add', '--', 'docs/plans', 'scripts/config', 'scripts/tests')
    Invoke-FixtureGit -Root $delRoot -ArgumentList @('commit', '-q', '-m', 'base both html')
    $delBase = (Invoke-FixtureGit -Root $delRoot -ArgumentList @('rev-parse', 'HEAD')).Trim()
    Invoke-FixtureGit -Root $delRoot -ArgumentList @('rm', '-q', '--', $hifiPath)
    Invoke-FixtureGit -Root $delRoot -ArgumentList @('commit', '-q', '-m', 'delete hifi')
    $delHead = (Invoke-FixtureGit -Root $delRoot -ArgumentList @('rev-parse', 'HEAD')).Trim()
    $deleted = Get-DesignGateSourceCollection -RepoRoot $delRoot -PolicyPath $delPolicy -SchemaPath (Join-Path $delRoot 'scripts\tests\design-gate-policy.schema.json') -BaseRef $delBase -HeadRef $delHead
    Assert-True (-not $deleted.ok) 'deletion fails closed'
    Assert-Equal 'source.deleted_from_head' ([string]$deleted.code) 'deletion code'
    Assert-True (-not [bool]$deleted.successful_eligibility) 'deletion does not grant eligibility'
    $deletedHifi = @($deleted.sources | Where-Object { [string]$_.path -eq $hifiPath })
    Assert-Equal 1 $deletedHifi.Count 'base-only hifi remains visible'
    Assert-True ([bool]$deletedHifi[0].in_base) 'deleted source in_base'
    Assert-True (-not [bool]$deletedHifi[0].in_head) 'deleted source not in_head'
    Assert-Equal $delBase ([string]$deletedHifi[0].resolved_commit) 'deleted source blob comes from base'
    Assert-Equal 2 @($deleted.sources).Count 'governed set is not silently shrunk'

    # Rename
    $renRoot = Join-Path $tempRoot 'renamed'
    New-Item -ItemType Directory -Force -Path $renRoot | Out-Null
    Initialize-FixtureGit -Root $renRoot
    $renPolicy = New-FixturePolicyBytes -Root $renRoot
    New-TrackedHtml -Root $renRoot -RelativePath $archPath -LfBody $archBody
    New-TrackedHtml -Root $renRoot -RelativePath $hifiPath -LfBody $hifiBody
    Invoke-FixtureGit -Root $renRoot -ArgumentList @('add', '--', 'docs/plans', 'scripts/config', 'scripts/tests')
    Invoke-FixtureGit -Root $renRoot -ArgumentList @('commit', '-q', '-m', 'base both html')
    $renBase = (Invoke-FixtureGit -Root $renRoot -ArgumentList @('rev-parse', 'HEAD')).Trim()
    Invoke-FixtureGit -Root $renRoot -ArgumentList @('mv', '--', $hifiPath, 'docs/plans/renamed-hifi.dc.html')
    Invoke-FixtureGit -Root $renRoot -ArgumentList @('commit', '-q', '-m', 'rename hifi')
    $renHead = (Invoke-FixtureGit -Root $renRoot -ArgumentList @('rev-parse', 'HEAD')).Trim()
    $renamed = Get-DesignGateSourceCollection -RepoRoot $renRoot -PolicyPath $renPolicy -SchemaPath (Join-Path $renRoot 'scripts\tests\design-gate-policy.schema.json') -BaseRef $renBase -HeadRef $renHead
    Assert-True (-not $renamed.ok) 'rename fails closed'
    Assert-Equal 'source.renamed' ([string]$renamed.code) 'rename code'
    Assert-True (-not [bool]$renamed.successful_eligibility) 'rename does not grant eligibility'
    Assert-True ((@($renamed.sources | Where-Object { [string]$_.path -eq $hifiPath }).Count) -eq 1) 'old path remains visible'
    Assert-True ((@($renamed.sources | Where-Object { [string]$_.path -eq 'docs/plans/renamed-hifi.dc.html' }).Count) -eq 1) 'new path is present for diagnosis'

    Assert-SourceCode {
        Get-DesignGateSourceCollection -RepoRoot $validRoot -PolicyPath $fixturePolicy -SchemaPath (Join-Path $validRoot 'scripts\tests\design-gate-policy.schema.json') -Ref 'this-ref-does-not-exist'
    } 'source.unresolved_ref' 'unresolved ref'
} finally {
    Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
}

# --- Excluded-file guard ---
$changed = @(& git -C $repoRoot diff --name-only origin/main)
$changed += @(& git -C $repoRoot diff --name-only --cached)
$status = @(& git -C $repoRoot status --porcelain)
$allTouched = @($changed + @($status | ForEach-Object { $_.Substring(3).Replace('\', '/') })) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Sort-Object -Unique
$forbidden = @(
    '^docs/plans/.*\.html$'
    '^docs/plans/design-system-reference\.manifest\.json$'
    '^docs/plans/design-system-baseline/'
    'capture-design-system-reference'
    'rebaseline'
    '^scripts/lib/design-system-gate\.ps1$'
)
foreach ($path in $allTouched) {
    $normalized = [string]$path
    foreach ($pattern in $forbidden) {
        Assert-True ($normalized -notmatch $pattern) "excluded surface was modified: $normalized"
    }
}
Assert-True ($collectorText -notmatch 'Set-Content|Out-File|WriteAllText') 'collector does not write files'
Assert-True ($collectorText -notmatch 'design-system-reference\.manifest\.json') 'collector does not treat the manifest as authority'
Assert-True ($collectorText -notmatch 'design-system-baseline') 'collector does not touch baselines'

Write-Host '[test-design-gate-source-collector] passed — ref-bound collection, fail-closed untrusted inputs, excluded-file guard'
