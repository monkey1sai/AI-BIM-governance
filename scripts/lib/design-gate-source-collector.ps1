#requires -Version 7.0
Set-StrictMode -Version Latest

$designGatePolicyLibrary = Join-Path $PSScriptRoot 'design-gate-policy.ps1'
if (-not (Test-Path -LiteralPath $designGatePolicyLibrary -PathType Leaf)) {
    throw "design-gate-policy.ps1 is required: $designGatePolicyLibrary"
}
. $designGatePolicyLibrary

function Get-DesignGateSha256Hex {
    param([Parameter(Mandatory = $true)][byte[]] $Bytes)
    $hash = [System.Security.Cryptography.SHA256]::Create()
    try {
        return [System.BitConverter]::ToString($hash.ComputeHash($Bytes)).Replace('-', '').ToLowerInvariant()
    } finally {
        $hash.Dispose()
    }
}

function Invoke-DesignGateGit {
    param(
        [Parameter(Mandatory = $true)][string] $RepoRoot,
        [Parameter(Mandatory = $true)][string[]] $ArgumentList
    )
    $output = & git -C $RepoRoot -c "safe.directory=$RepoRoot" -c core.quotepath=false @ArgumentList 2>&1
    if ($LASTEXITCODE -ne 0) {
        New-DesignGateError -Code 'source.unresolved_ref' -Message ("git {0} failed: {1}" -f ($ArgumentList -join ' '), (($output | Out-String).Trim()))
    }
    return @($output | ForEach-Object { [string]$_ } | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
}

function Resolve-DesignGateCommit {
    param(
        [Parameter(Mandatory = $true)][string] $RepoRoot,
        [Parameter(Mandatory = $true)][string] $Ref
    )
    $value = @(Invoke-DesignGateGit -RepoRoot $RepoRoot -ArgumentList @('rev-parse', "$Ref^{commit}"))
    if ($value.Count -ne 1 -or [string]$value[0] -notmatch '^[0-9a-f]{40}$') {
        New-DesignGateError -Code 'source.unresolved_ref' -Message "unable to resolve commit for ref '$Ref'."
    }
    return [string]$value[0]
}

function Get-GitRawBlobBytes {
    param(
        [Parameter(Mandatory = $true)][string] $RepoRoot,
        [Parameter(Mandatory = $true)][string] $BlobOid
    )
    if ([string]$BlobOid -notmatch '^[0-9a-f]{40}$') {
        New-DesignGateError -Code 'source.unresolved_ref' -Message "blob oid '$BlobOid' is not a Git SHA-1."
    }
    $outFile = Join-Path ([System.IO.Path]::GetTempPath()) "design-gate-blob-$([guid]::NewGuid().ToString('N'))"
    $errFile = "$outFile.err"
    try {
        $proc = Start-Process -FilePath (Get-Command git -ErrorAction Stop).Source `
            -ArgumentList @('-C', $RepoRoot, '-c', "safe.directory=$RepoRoot", 'cat-file', 'blob', $BlobOid) `
            -RedirectStandardOutput $outFile -RedirectStandardError $errFile -Wait -NoNewWindow -PassThru
        if ($proc.ExitCode -ne 0) {
            $err = ''
            if (Test-Path -LiteralPath $errFile) { $err = Get-Content -LiteralPath $errFile -Raw }
            New-DesignGateError -Code 'source.unresolved_ref' -Message "git cat-file blob $BlobOid failed: $err"
        }
        return [System.IO.File]::ReadAllBytes($outFile)
    } finally {
        Remove-Item -LiteralPath $outFile, $errFile -Force -ErrorAction SilentlyContinue
    }
}

function Get-DesignGateTrackedHtmlRecords {
    param(
        [Parameter(Mandatory = $true)][string] $RepoRoot,
        [string] $Ref = ''
    )

    $records = New-Object System.Collections.Generic.List[object]
    if ([string]::IsNullOrWhiteSpace($Ref)) {
        $lines = @(Invoke-DesignGateGit -RepoRoot $RepoRoot -ArgumentList @('ls-files', '-s', '--', 'docs/plans/*.html'))
        foreach ($line in $lines) {
            if ([string]$line -notmatch '^100644 ([0-9a-f]{40}) [0-3]\t(.+\.html)$') {
                New-DesignGateError -Code 'source.unresolved_ref' -Message "unexpected git ls-files -s line: $line"
            }
            $records.Add([pscustomobject]@{
                path = $Matches[2].Replace('\', '/')
                blob_oid = $Matches[1]
            })
        }
        return @($records.ToArray())
    }

    # Named ref: list the docs/plans tree, then keep *.html suffix.
    # Do not pass docs/plans/*.html as an ls-tree pathspec; that glob does not match .dc.html.
    $lines = @(Invoke-DesignGateGit -RepoRoot $RepoRoot -ArgumentList @('ls-tree', '-r', '--full-tree', $Ref, '--', 'docs/plans/'))
    foreach ($line in $lines) {
        if ([string]$line -notmatch '^100644 blob ([0-9a-f]{40})\t(.+)$') { continue }
        $path = $Matches[2].Replace('\', '/')
        if ($path -notlike '*.html') { continue }
        $records.Add([pscustomobject]@{
            path = $path
            blob_oid = $Matches[1]
        })
    }
    return @($records.ToArray())
}

function Get-DesignGateTrackedHtmlPaths {
    param(
        [Parameter(Mandatory = $true)][string] $RepoRoot,
        [string] $Ref = ''
    )
    return @((Get-DesignGateTrackedHtmlRecords -RepoRoot $RepoRoot -Ref $Ref).path)
}

function ConvertTo-DesignGateRepoRelativePath {
    param(
        [Parameter(Mandatory = $true)][string] $RepoRoot,
        [Parameter(Mandatory = $true)][string] $Path
    )
    $normalized = $Path.Trim().Replace('\', '/')
    $originPrefix = 'C:/Repos/design/desigin-system'
    $originWindows = 'C:\Repos\design\desigin-system'
    if ($normalized.StartsWith($originPrefix, [System.StringComparison]::OrdinalIgnoreCase) -or
        $Path.StartsWith($originWindows, [System.StringComparison]::OrdinalIgnoreCase)) {
        New-DesignGateError -Code 'source.origin_projected' -Message "origin-projected HTML has no authority: $Path"
    }
    $resolvedRoot = (Resolve-Path -LiteralPath $RepoRoot).Path.TrimEnd('\')
    if ([System.IO.Path]::IsPathRooted($Path)) {
        $full = $Path
        try { $full = [System.IO.Path]::GetFullPath($Path) } catch { $full = $Path }
        if ($full.StartsWith($originWindows, [System.StringComparison]::OrdinalIgnoreCase)) {
            New-DesignGateError -Code 'source.origin_projected' -Message "origin-projected HTML has no authority: $Path"
        }
        if (-not $full.StartsWith($resolvedRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
            New-DesignGateError -Code 'source.external' -Message "repo-external HTML has no authority: $Path"
        }
        $relative = $full.Substring($resolvedRoot.Length).TrimStart('\', '/').Replace('\', '/')
        return $relative
    }
    if ($normalized.Contains('..')) {
        New-DesignGateError -Code 'source.external' -Message "path escaped the repository: $Path"
    }
    return $normalized.TrimStart('/')
}

function Test-DesignGateIgnoredPath {
    param(
        [Parameter(Mandatory = $true)][string] $RepoRoot,
        [Parameter(Mandatory = $true)][string] $RelativePath
    )
    & git -C $RepoRoot -c "safe.directory=$RepoRoot" check-ignore -q -- $RelativePath 2>$null | Out-Null
    return ($LASTEXITCODE -eq 0)
}

function Get-DesignGateSourceCollection {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string] $RepoRoot,
        [Parameter(Mandatory = $true)][string] $PolicyPath,
        [Parameter(Mandatory = $true)][string] $SchemaPath,
        [string] $Ref = '',
        [string] $BaseRef = '',
        [string] $HeadRef = '',
        [string] $CallerDigest = '',
        [string] $PrProse = '',
        [string] $ScreenshotPath = '',
        [object] $ManualBoolean = $null,
        [switch] $HashWorkingTreeBytes,
        [object[]] $CandidatePaths = @()
    )

    if ($PSBoundParameters.ContainsKey('CallerDigest') -and -not [string]::IsNullOrWhiteSpace($CallerDigest)) {
        New-DesignGateError -Code 'source.caller_digest_forbidden' -Message 'caller-supplied digests are not authority.'
    }
    if ($PSBoundParameters.ContainsKey('PrProse') -and -not [string]::IsNullOrWhiteSpace($PrProse)) {
        New-DesignGateError -Code 'source.pr_prose_forbidden' -Message 'PR prose is not authority.'
    }
    if ($PSBoundParameters.ContainsKey('ScreenshotPath') -and -not [string]::IsNullOrWhiteSpace($ScreenshotPath)) {
        New-DesignGateError -Code 'source.screenshot_forbidden' -Message 'screenshots are not authority.'
    }
    if ($PSBoundParameters.ContainsKey('ManualBoolean') -and $null -ne $ManualBoolean) {
        New-DesignGateError -Code 'source.manual_boolean_forbidden' -Message 'manual booleans are not authority.'
    }
    if ($HashWorkingTreeBytes) {
        New-DesignGateError -Code 'source.working_tree_bytes_forbidden' -Message 'working-tree bytes are not authority.'
    }

    $RepoRoot = (Resolve-Path -LiteralPath $RepoRoot).Path
    $policy = Test-DesignGatePolicy -PolicyPath $PolicyPath -SchemaPath $SchemaPath
    $registry = @{}
    foreach ($entry in @($policy.sources)) {
        $registry[[string]$entry.path] = $entry
    }

    foreach ($candidate in @($CandidatePaths)) {
        $candidatePath = $candidate
        $candidateRole = $null
        if ($candidate -is [System.Collections.IDictionary]) {
            $candidatePath = [string]$candidate['path']
            if ($candidate.Contains('source_role') -and $null -ne $candidate['source_role']) {
                $candidateRole = [string]$candidate['source_role']
            }
        } else {
            $candidatePath = [string]$candidate
        }
        $relative = ConvertTo-DesignGateRepoRelativePath -RepoRoot $RepoRoot -Path $candidatePath
        if (Test-DesignGateIgnoredPath -RepoRoot $RepoRoot -RelativePath $relative) {
            New-DesignGateError -Code 'source.ignored' -Message "ignored HTML has no authority: $relative"
        }
        $trackedNow = @(Get-DesignGateTrackedHtmlPaths -RepoRoot $RepoRoot)
        if ($relative -notin $trackedNow) {
            New-DesignGateError -Code 'source.untracked' -Message "untracked HTML has no authority: $relative"
        }
        if (-not $registry.ContainsKey($relative)) {
            New-DesignGateError -Code 'source.unregistered' -Message "unregistered HTML path '$relative'."
        }
        if ($null -ne $candidateRole -and [string]$candidateRole -cne [string]$registry[$relative].source_role) {
            New-DesignGateError -Code 'source.role_ambiguous' -Message "role '$candidateRole' is not the unique registered role for '$relative'."
        }
    }

    $pairMode = -not [string]::IsNullOrWhiteSpace($BaseRef) -or -not [string]::IsNullOrWhiteSpace($HeadRef)
    if ($pairMode) {
        if ([string]::IsNullOrWhiteSpace($BaseRef) -or [string]::IsNullOrWhiteSpace($HeadRef)) {
            New-DesignGateError -Code 'source.unresolved_ref' -Message 'pair collection requires both BaseRef and HeadRef.'
        }
        if (-not [string]::IsNullOrWhiteSpace($Ref)) {
            New-DesignGateError -Code 'source.unresolved_ref' -Message 'Ref cannot be combined with BaseRef/HeadRef.'
        }
    }

    $requestedRef = if ($pairMode) { "$BaseRef...$HeadRef" } elseif ([string]::IsNullOrWhiteSpace($Ref)) { 'HEAD' } else { $Ref }
    $resolvedCommit = if ($pairMode) {
        Resolve-DesignGateCommit -RepoRoot $RepoRoot -Ref $HeadRef
    } elseif ([string]::IsNullOrWhiteSpace($Ref)) {
        Resolve-DesignGateCommit -RepoRoot $RepoRoot -Ref 'HEAD'
    } else {
        Resolve-DesignGateCommit -RepoRoot $RepoRoot -Ref $Ref
    }

    $baseRecords = @()
    $headRecords = @()
    if ($pairMode) {
        $baseRecords = @(Get-DesignGateTrackedHtmlRecords -RepoRoot $RepoRoot -Ref $BaseRef)
        $headRecords = @(Get-DesignGateTrackedHtmlRecords -RepoRoot $RepoRoot -Ref $HeadRef)
    } else {
        $headRecords = @(Get-DesignGateTrackedHtmlRecords -RepoRoot $RepoRoot -Ref $Ref)
        $baseRecords = $headRecords
    }

    $baseMap = @{}
    foreach ($record in $baseRecords) { $baseMap[$record.path] = $record }
    $headMap = @{}
    foreach ($record in $headRecords) { $headMap[$record.path] = $record }
    $union = @($baseMap.Keys + $headMap.Keys) | Sort-Object -Unique

    $sources = New-Object System.Collections.Generic.List[object]
    $unregisteredHead = New-Object System.Collections.Generic.List[string]
    $missingHead = New-Object System.Collections.Generic.List[string]
    foreach ($path in $union) {
        $inBase = $baseMap.ContainsKey($path)
        $inHead = $headMap.ContainsKey($path)
        $use = if ($inHead) { $headMap[$path] } else { $baseMap[$path] }
        $refForBlob = if ($inHead) {
            if ($pairMode) { $HeadRef } elseif ([string]::IsNullOrWhiteSpace($Ref)) { 'HEAD' } else { $Ref }
        } else {
            $BaseRef
        }
        $commitForBlob = Resolve-DesignGateCommit -RepoRoot $RepoRoot -Ref $refForBlob
        $bytes = Get-GitRawBlobBytes -RepoRoot $RepoRoot -BlobOid $use.blob_oid
        $registered = $registry.ContainsKey($path)
        if ($inHead -and -not $registered) { $unregisteredHead.Add($path) }
        if ($registered -and $inBase -and -not $inHead) { $missingHead.Add($path) }
        $sourceId = if ($registered) { [string]$registry[$path].source_id } else { '' }
        $sourceRole = if ($registered) { [string]$registry[$path].source_role } else { '' }
        $sources.Add([pscustomobject]@{
            source_id = $sourceId
            source_role = $sourceRole
            path = $path
            requested_ref = $refForBlob
            resolved_commit = $commitForBlob
            blob_oid = [string]$use.blob_oid
            sha256 = Get-DesignGateSha256Hex -Bytes $bytes
            in_base = [bool]$inBase
            in_head = [bool]$inHead
        })
    }

    foreach ($path in @($registry.Keys)) {
        if (-not $baseMap.ContainsKey($path) -and -not $headMap.ContainsKey($path)) {
            $unregisteredHead.Add("missing-registered:$path")
        }
    }

    $result = [pscustomobject]@{
        ok = $true
        code = $null
        message = $null
        requested_ref = $requestedRef
        resolved_commit = $resolvedCommit
        successful_eligibility = $false
        sources = @($sources.ToArray())
    }

    if ($pairMode -and $unregisteredHead.Count -gt 0 -and $missingHead.Count -gt 0) {
        $result.ok = $false
        $result.code = 'source.renamed'
        $result.message = 'registered HTML was renamed; the governed source set cannot shrink silently.'
        return $result
    }
    if ($unregisteredHead.Count -gt 0) {
        $result.ok = $false
        $result.code = 'source.unregistered'
        $result.message = ("unregistered HTML is not in the policy registry: {0}" -f ($unregisteredHead -join ', '))
        return $result
    }
    if ($missingHead.Count -gt 0) {
        $result.ok = $false
        $result.code = 'source.deleted_from_head'
        $result.message = ("registered HTML deleted from head remains visible: {0}" -f ($missingHead -join ', '))
        return $result
    }

    $registeredCount = @($sources | Where-Object { -not [string]::IsNullOrWhiteSpace($_.source_id) }).Count
    if ($registeredCount -ne 2 -and -not $pairMode) {
        $result.ok = $false
        $result.code = 'source.unregistered'
        $result.message = 'current collection must resolve exactly the two registered HTML sources.'
        return $result
    }

    return $result
}
