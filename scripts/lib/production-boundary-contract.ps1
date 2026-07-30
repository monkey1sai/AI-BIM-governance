Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-GitFileText {
    param(
        [string] $RepoRoot,
        [string] $SafeRoot,
        [string] $Revision,
        [string] $Path
    )
    $content = @(& git -C $RepoRoot -c "safe.directory=$SafeRoot" show --no-textconv "${Revision}:$Path" 2>$null)
    if ($LASTEXITCODE -ne 0) { return '' }
    return ($content -join "`n")
}

function Add-NewPatternViolations {
    param(
        [string] $BaseText,
        [string] $HeadText,
        [string] $Pattern,
        [string] $Label,
        $Violations
    )
    $baseCounts = @{}
    foreach ($match in [regex]::Matches($BaseText, $Pattern)) {
        $normalized = ($match.Value -replace '\s+', ' ').Trim().ToLowerInvariant()
        $baseCounts[$normalized] = 1 + [int]($baseCounts[$normalized])
    }
    foreach ($match in [regex]::Matches($HeadText, $Pattern)) {
        $normalized = ($match.Value -replace '\s+', ' ').Trim()
        $key = $normalized.ToLowerInvariant()
        if ([int]($baseCounts[$key]) -gt 0) {
            $baseCounts[$key] = [int]($baseCounts[$key]) - 1
        } else {
            $Violations.Add("${Label}: $normalized")
        }
    }
}

function Add-ChangedPatternViolations {
    param(
        [string] $HeadText,
        [string] $Pattern,
        [Collections.Generic.HashSet[int]] $ChangedHeadLines,
        [string] $Label,
        $Violations
    )
    foreach ($match in [regex]::Matches($HeadText, $Pattern)) {
        $startLine = 1 + [regex]::Matches($HeadText.Substring(0, $match.Index), "`n").Count
        $endLine = $startLine + [regex]::Matches($match.Value, "`n").Count
        for ($lineNumber = $startLine; $lineNumber -le $endLine; $lineNumber++) {
            if ($ChangedHeadLines.Contains($lineNumber)) {
                $normalized = ($match.Value -replace '\s+', ' ').Trim()
                $Violations.Add("${Label}: $normalized")
                break
            }
        }
    }
}

function Assert-ProductionBoundaryDiff {
    param(
        [Parameter(Mandatory = $true)][string] $RepoRoot,
        [string] $BaseSha = '',
        [string] $HeadSha = ''
    )

    # This is intentionally a diff guard: legacy, explicitly labelled fake
    # detectors remain readable, but no PR may add a fake-positive payload or
    # a browser route to an internal listener.
    if ([string]::IsNullOrWhiteSpace($BaseSha) -or [string]::IsNullOrWhiteSpace($HeadSha)) { return }
    if ($BaseSha -notmatch '^[0-9a-fA-F]{7,64}$' -or $HeadSha -notmatch '^[0-9a-fA-F]{7,64}$') {
        throw 'Production boundary diff requires hexadecimal base and head SHAs.'
    }

    $productionPaths = @(
        'bim-review-coordinator/src',
        'bim-streaming-server/source',
        'governance-service',
        'web-viewer-sample/src',
        'apps/kit-manager-web/src',
        'services/kit-manager-api',
        'compose.runtime-manager.yml'
    )
    $browserPaths = @(
        'apps/kit-manager-web/src/',
        'bim-review-coordinator/src/public/',
        'web-viewer-sample/src/'
    )
    $nonProductionPaths = @(
        'bim-review-coordinator/tests/',
        'bim-streaming-server/tests/',
        'governance-service/tests/',
        'governance-service/README.md',
        'web-viewer-sample/e2e/',
        'apps/kit-manager-web/tests/',
        'services/kit-manager-api/tests/',
        'services/kit-manager-api/README.md'
    )
    $safeRoot = [IO.Path]::GetFullPath($RepoRoot).Replace('\', '/')
    $mergeBase = (& git -C $RepoRoot -c "safe.directory=$safeRoot" merge-base $BaseSha $HeadSha).Trim()
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($mergeBase)) {
        throw 'Unable to resolve the production diff merge base.'
    }
    $diff = @(& git -C $RepoRoot -c "safe.directory=$safeRoot" diff --no-ext-diff --unified=1 $mergeBase $HeadSha -- $productionPaths)
    if ($LASTEXITCODE -ne 0) { throw 'Unable to inspect production diff for boundary violations.' }

    $violations = [Collections.Generic.List[string]]::new()
    $addedByPath = @{}
    $addedHeadLinesByPath = @{}
    $hunksByPath = @{}
    $changedProductionPaths = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    $currentPath = ''
    $currentHunk = $null
    $headLine = 0
    foreach ($line in $diff) {
        if ($line -match '^\+\+\+ b/(.+)$') {
            $diffPath = $Matches[1].Replace('\', '/')
            $isNonProduction = $nonProductionPaths.Where({
                $diffPath.StartsWith($_, [StringComparison]::OrdinalIgnoreCase)
            }).Count -gt 0 -or
                $diffPath -match '(?i)(^|/)(tests?|__tests__|e2e)(/|$)' -or
                $diffPath -match '(?i)\.(test|spec)\.[^/]+$'
            $currentPath = if ($isNonProduction) { '' } else { $diffPath }
            $currentHunk = $null
            $headLine = 0
            if (-not $addedByPath.ContainsKey($currentPath)) {
                if ($currentPath) {
                    $addedByPath[$currentPath] = [Collections.Generic.List[string]]::new()
                    $addedHeadLinesByPath[$currentPath] = [Collections.Generic.HashSet[int]]::new()
                    $hunksByPath[$currentPath] = [Collections.Generic.List[object]]::new()
                    [void]$changedProductionPaths.Add($currentPath)
                }
            }
            continue
        }
        if ($line.StartsWith('@@') -and $currentPath) {
            if ($line -notmatch '^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@') {
                throw "Unable to parse production diff hunk header: $line"
            }
            $headLine = [int]$Matches[1]
            $addedByPath[$currentPath].Add('<<DIFF_HUNK_BOUNDARY>>')
            $currentHunk = [pscustomobject]@{
                Base = [Collections.Generic.List[string]]::new()
                Head = [Collections.Generic.List[string]]::new()
            }
            $hunksByPath[$currentPath].Add($currentHunk)
            continue
        }
        if ($currentPath -and $null -ne $currentHunk) {
            if ($line.StartsWith(' ')) {
                $context = $line.Substring(1)
                $currentHunk.Base.Add($context)
                $currentHunk.Head.Add($context)
                $headLine++
            } elseif ($line.StartsWith('-') -and -not $line.StartsWith('---')) {
                $currentHunk.Base.Add($line.Substring(1))
            } elseif ($line.StartsWith('+') -and -not $line.StartsWith('+++')) {
                $currentHunk.Head.Add($line.Substring(1))
                [void]$addedHeadLinesByPath[$currentPath].Add($headLine)
                $headLine++
            }
        }
        if (-not $line.StartsWith('+') -or $line.StartsWith('+++')) { continue }
        $added = $line.Substring(1)
        if ($currentPath) { $addedByPath[$currentPath].Add($added) }
        $isBrowserSource = (
            $browserPaths.Where({ $currentPath.StartsWith($_, [StringComparison]::OrdinalIgnoreCase) }).Count -gt 0 -or
            ($currentPath -eq 'compose.runtime-manager.yml' -and $added -match '(?i)\bVITE_[A-Z0-9_]+')
        )
        if ($isBrowserSource -and $added -match '(?i)https?://[^\s"''`]+:(?:49\d{3}|8010)(?:\b|/)') {
            $violations.Add("browser/internal listener addition: $added")
        }
    }
    $fakePattern = '(?i)(?:["'']?mock["'']?\s*[:=]\s*true|["'']?allow_fake_mapping["'']?\s*[:=]\s*true|["'']?fake_mapping_count["'']?\s*[:=]\s*[1-9]\d*|["'']?mapping_provenance["'']?\s*[:=]\s*["'']fake_smoke_test["'']|["'']?mapping_method["'']?\s*[:=]\s*["'']fake_for_smoke_test["''])'
    foreach ($path in $addedByPath.Keys) {
        $addedBlock = $addedByPath[$path] -join "`n"
        foreach ($match in [regex]::Matches($addedBlock, $fakePattern)) {
            $normalizedMatch = ($match.Value -replace '\s+', ' ').Trim()
            $violations.Add("fake-positive production addition in ${path}: $normalizedMatch")
        }
    }
    $internalUrlPattern = '(?i)https?://[^\s"''`]+:(?:49\d{3}|8010)(?:\b|/)'
    $composeVitePattern = '(?ims)\bVITE_[A-Z0-9_]+\s*:\s*(?:[>|]-?\s*)?https?://[^\s"''`]+:(?:49\d{3}|8010)(?:\b|/)'
    foreach ($path in $changedProductionPaths) {
        $baseText = Get-GitFileText -RepoRoot $RepoRoot -SafeRoot $safeRoot -Revision $mergeBase -Path $path
        $headText = Get-GitFileText -RepoRoot $RepoRoot -SafeRoot $safeRoot -Revision $HeadSha -Path $path
        Add-NewPatternViolations -BaseText $baseText -HeadText $headText -Pattern $fakePattern `
            -Label "fake-positive production post-image in $path" -Violations $violations
        Add-ChangedPatternViolations -HeadText $headText -Pattern $fakePattern `
            -ChangedHeadLines $addedHeadLinesByPath[$path] `
            -Label "fake-positive production changed location in $path" -Violations $violations
        $isBrowserPath = $browserPaths.Where({
            $path.StartsWith($_, [StringComparison]::OrdinalIgnoreCase)
        }).Count -gt 0
        if ($isBrowserPath) {
            Add-NewPatternViolations -BaseText $baseText -HeadText $headText -Pattern $internalUrlPattern `
                -Label "browser/internal listener post-image in $path" -Violations $violations
            Add-ChangedPatternViolations -HeadText $headText -Pattern $internalUrlPattern `
                -ChangedHeadLines $addedHeadLinesByPath[$path] `
                -Label "browser/internal listener changed location in $path" -Violations $violations
        } elseif ($path -eq 'compose.runtime-manager.yml') {
            Add-NewPatternViolations -BaseText $baseText -HeadText $headText -Pattern $composeVitePattern `
                -Label 'Compose VITE/internal listener post-image' -Violations $violations
            Add-ChangedPatternViolations -HeadText $headText -Pattern $composeVitePattern `
                -ChangedHeadLines $addedHeadLinesByPath[$path] `
                -Label 'Compose VITE/internal listener changed location' -Violations $violations
        }
    }
    foreach ($path in $hunksByPath.Keys) {
        $isBrowserPath = $browserPaths.Where({
            $path.StartsWith($_, [StringComparison]::OrdinalIgnoreCase)
        }).Count -gt 0
        foreach ($hunk in $hunksByPath[$path]) {
            $baseHunk = $hunk.Base -join "`n"
            $headHunk = $hunk.Head -join "`n"
            Add-NewPatternViolations -BaseText $baseHunk -HeadText $headHunk -Pattern $fakePattern `
                -Label "fake-positive production hunk post-image in $path" -Violations $violations
            if ($isBrowserPath) {
                Add-NewPatternViolations -BaseText $baseHunk -HeadText $headHunk -Pattern $internalUrlPattern `
                    -Label "browser/internal listener hunk post-image in $path" -Violations $violations
            } elseif ($path -eq 'compose.runtime-manager.yml') {
                Add-NewPatternViolations -BaseText $baseHunk -HeadText $headHunk -Pattern $composeVitePattern `
                    -Label 'Compose VITE/internal listener hunk post-image' -Violations $violations
            }
        }
    }
    if ($violations.Count -gt 0) {
        throw "Production boundary contract failed:`n$($violations -join "`n")"
    }
}
