Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$script:ArtifactNamePattern = '^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$'
$script:RepositoryPattern = '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$'
$script:WindowsDevicePattern = '^(?i:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$'

function Assert-SafeArtifactEntryPath {
    param([Parameter(Mandatory = $true)][string] $Path)

    if ([string]::IsNullOrWhiteSpace($Path) -or $Path.Length -gt 1024 -or $Path.Contains('\') -or
        $Path.StartsWith('/') -or $Path -match '^[A-Za-z]:' -or $Path -match '[\x00-\x1f\x7f:]') {
        throw "Artifact archive contains an unsafe entry path."
    }
    $isDirectory = $Path.EndsWith('/')
    $trimmed = if ($isDirectory) { $Path.Substring(0, $Path.Length - 1) } else { $Path }
    $segments = @($trimmed.Split('/'))
    if ($segments.Count -eq 0 -or @($segments | Where-Object {
        [string]::IsNullOrWhiteSpace($_) -or $_ -in @('.', '..') -or $_.EndsWith(' ') -or $_.EndsWith('.') -or
        $_ -match $script:WindowsDevicePattern
    }).Count -gt 0) {
        throw "Artifact archive contains an unsafe entry path."
    }
    return [pscustomobject]@{ Normalized = $trimmed; IsDirectory = $isDirectory }
}

function Get-UnsignedExternalAttributes {
    param([Parameter(Mandatory = $true)][int] $Value)
    return [BitConverter]::ToUInt32([BitConverter]::GetBytes($Value), 0)
}

function Expand-VerifiedArtifactArchive {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string] $ArchivePath,
        [Parameter(Mandatory = $true)][string] $DestinationRoot,
        [ValidateRange(1, 1024)][int] $MaxEntryCount = 256,
        [ValidateRange(1, 1073741824)][long] $MaxTotalBytes = 536870912,
        [ValidateRange(1, 536870912)][long] $MaxFileBytes = 134217728,
        [ValidateRange(1, 1000)][int] $MaxCompressionRatio = 200
    )

    $archive = Get-Item -LiteralPath $ArchivePath -Force
    if (-not $archive.PSIsContainer -and -not ($archive.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
        $archivePathResolved = $archive.FullName
    } else {
        throw 'Artifact archive must be a regular, non-linked file.'
    }
    if (Test-Path -LiteralPath $DestinationRoot) {
        throw 'Artifact extraction destination must not already exist.'
    }
    $destinationParent = Split-Path -Parent ([IO.Path]::GetFullPath($DestinationRoot))
    if (-not (Test-Path -LiteralPath $destinationParent -PathType Container)) {
        throw 'Artifact extraction parent does not exist.'
    }
    $destination = [IO.Path]::GetFullPath($DestinationRoot)
    $seen = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    $entries = [Collections.Generic.List[object]]::new()
    $totalBytes = [long]0

    Add-Type -AssemblyName System.IO.Compression
    $fileStream = [IO.File]::Open($archivePathResolved, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
    try {
        $zip = [IO.Compression.ZipArchive]::new($fileStream, [IO.Compression.ZipArchiveMode]::Read, $false)
        try {
            if ($zip.Entries.Count -lt 1 -or $zip.Entries.Count -gt $MaxEntryCount) {
                throw 'Artifact archive entry count is outside the approved budget.'
            }
            foreach ($entry in $zip.Entries) {
                $safePath = Assert-SafeArtifactEntryPath -Path $entry.FullName
                if (-not $seen.Add($safePath.Normalized)) {
                    throw 'Artifact archive contains duplicate or case-colliding paths.'
                }
                $attributes = Get-UnsignedExternalAttributes -Value $entry.ExternalAttributes
                $unixType = ($attributes -shr 16) -band 0xF000
                $windowsAttributes = $attributes -band 0xFFFF
                if ($unixType -eq 0xA000 -or ($windowsAttributes -band [uint32][IO.FileAttributes]::ReparsePoint) -ne 0) {
                    throw 'Artifact archive contains a linked entry.'
                }
                if ($safePath.IsDirectory) {
                    if ($entry.Length -ne 0) { throw 'Artifact directory entry contains file data.' }
                } else {
                    if ($entry.Length -lt 0 -or $entry.Length -gt $MaxFileBytes) {
                        throw 'Artifact archive file exceeds its uncompressed budget.'
                    }
                    $totalBytes += [long]$entry.Length
                    if ($totalBytes -gt $MaxTotalBytes) {
                        throw 'Artifact archive exceeds its aggregate uncompressed budget.'
                    }
                    if ($entry.Length -gt 1048576 -and ($entry.CompressedLength -le 0 -or
                        ([double]$entry.Length / [double]$entry.CompressedLength) -gt $MaxCompressionRatio)) {
                        throw 'Artifact archive exceeds its compression-ratio budget.'
                    }
                }
                $target = [IO.Path]::GetFullPath((Join-Path $destination ($safePath.Normalized.Replace('/', [IO.Path]::DirectorySeparatorChar))))
                $prefix = $destination.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
                if (-not $target.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) {
                    throw 'Artifact archive entry escaped its destination.'
                }
                $entries.Add([pscustomobject]@{ Entry = $entry; Target = $target; IsDirectory = $safePath.IsDirectory })
            }

            [void](New-Item -ItemType Directory -Path $destination)
            foreach ($item in $entries) {
                if ($item.IsDirectory) {
                    [void](New-Item -ItemType Directory -Path $item.Target -Force)
                    continue
                }
                $parent = Split-Path -Parent $item.Target
                [void](New-Item -ItemType Directory -Path $parent -Force)
                $inputStream = $item.Entry.Open()
                $outputStream = [IO.File]::Open($item.Target, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
                try {
                    $buffer = [byte[]]::new(65536)
                    $written = [long]0
                    while (($read = $inputStream.Read($buffer, 0, $buffer.Length)) -gt 0) {
                        $written += $read
                        if ($written -gt $item.Entry.Length -or $written -gt $MaxFileBytes) {
                            throw 'Artifact entry expanded beyond its declared budget.'
                        }
                        $outputStream.Write($buffer, 0, $read)
                    }
                    if ($written -ne $item.Entry.Length) { throw 'Artifact entry length changed during extraction.' }
                } finally {
                    $outputStream.Dispose()
                    $inputStream.Dispose()
                }
            }
        } finally {
            $zip.Dispose()
        }
    } finally {
        $fileStream.Dispose()
    }
    return [pscustomobject]@{ EntryCount = $entries.Count; TotalBytes = $totalBytes; Destination = $destination }
}

function Save-BoundedGitHubArtifactArchive {
    param(
        [Parameter(Mandatory = $true)][string] $Repository,
        [Parameter(Mandatory = $true)][long] $ArtifactId,
        [Parameter(Mandatory = $true)][string] $Token,
        [Parameter(Mandatory = $true)][string] $Destination,
        [Parameter(Mandatory = $true)][long] $MaxBytes
    )

    $handler = [Net.Http.HttpClientHandler]::new()
    $handler.AllowAutoRedirect = $false
    $client = [Net.Http.HttpClient]::new($handler)
    $client.Timeout = [TimeSpan]::FromSeconds(60)
    try {
        $request = [Net.Http.HttpRequestMessage]::new([Net.Http.HttpMethod]::Get, "https://api.github.com/repos/$Repository/actions/artifacts/$ArtifactId/zip")
        $request.Headers.Authorization = [Net.Http.Headers.AuthenticationHeaderValue]::new('Bearer', $Token)
        $request.Headers.Accept.ParseAdd('application/vnd.github+json')
        $request.Headers.UserAgent.ParseAdd('ai-bim-trusted-artifact-fetcher/1.0')
        $request.Headers.Add('X-GitHub-Api-Version', '2022-11-28')
        $response = $client.Send($request, [Net.Http.HttpCompletionOption]::ResponseHeadersRead)
        try {
            if ([int]$response.StatusCode -notin @(301, 302, 307, 308) -or $null -eq $response.Headers.Location) {
                throw "GitHub artifact API did not return an approved redirect."
            }
            $redirect = if ($response.Headers.Location.IsAbsoluteUri) { $response.Headers.Location } else { [Uri]::new($request.RequestUri, $response.Headers.Location) }
            if ($redirect.Scheme -ne 'https' -or -not [string]::IsNullOrEmpty($redirect.UserInfo)) {
                throw 'GitHub artifact redirect is unsafe.'
            }
        } finally {
            $response.Dispose()
            $request.Dispose()
        }
    } finally {
        $client.Dispose()
        $handler.Dispose()
    }

    $downloadHandler = [Net.Http.HttpClientHandler]::new()
    $downloadHandler.AllowAutoRedirect = $false
    $downloadClient = [Net.Http.HttpClient]::new($downloadHandler)
    $downloadClient.Timeout = [TimeSpan]::FromMinutes(2)
    try {
        $response = $downloadClient.GetAsync($redirect, [Net.Http.HttpCompletionOption]::ResponseHeadersRead).GetAwaiter().GetResult()
        try {
            if (-not $response.IsSuccessStatusCode) { throw 'GitHub artifact download failed.' }
            if ($response.Content.Headers.ContentLength.HasValue -and $response.Content.Headers.ContentLength.Value -gt $MaxBytes) {
                throw 'GitHub artifact archive exceeds its compressed-size budget.'
            }
            $inputStream = $response.Content.ReadAsStream()
            $outputStream = [IO.File]::Open($Destination, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
            try {
                $buffer = [byte[]]::new(65536)
                $written = [long]0
                while (($read = $inputStream.Read($buffer, 0, $buffer.Length)) -gt 0) {
                    $written += $read
                    if ($written -gt $MaxBytes) { throw 'GitHub artifact archive exceeds its compressed-size budget.' }
                    $outputStream.Write($buffer, 0, $read)
                }
            } finally {
                $outputStream.Dispose()
                $inputStream.Dispose()
            }
        } finally {
            $response.Dispose()
        }
    } catch {
        if (Test-Path -LiteralPath $Destination -PathType Leaf) { Remove-Item -LiteralPath $Destination -Force }
        throw
    } finally {
        $downloadClient.Dispose()
        $downloadHandler.Dispose()
    }
}

function Receive-GitHubArtifactSet {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string] $Repository,
        [Parameter(Mandatory = $true)][string] $ObservationPath,
        [Parameter(Mandatory = $true)][string[]] $ArtifactNames,
        [Parameter(Mandatory = $true)][string] $DestinationRoot,
        [Parameter(Mandatory = $true)][string] $Token
    )

    if ($Repository -notmatch $script:RepositoryPattern -or [string]::IsNullOrWhiteSpace($Token)) { throw 'Artifact request identity is invalid.' }
    $observation = Get-Content -Raw -LiteralPath $ObservationPath | ConvertFrom-Json -Depth 100
    if ($observation.schema_version -ne 'verification-job-results/v1' -or $observation.repository -ne $Repository) {
        throw 'Artifact observation does not match the repository.'
    }
    $requested = @($ArtifactNames | Select-Object -Unique)
    if ($requested.Count -ne $ArtifactNames.Count -or $requested.Count -lt 1 -or $requested.Count -gt 3 -or
        @($requested | Where-Object { $_ -notmatch $script:ArtifactNamePattern }).Count -gt 0) {
        throw 'Artifact request is invalid or unbounded.'
    }
    if (Test-Path -LiteralPath $DestinationRoot) { throw 'Artifact destination root must not already exist.' }
    [void](New-Item -ItemType Directory -Path $DestinationRoot)
    foreach ($name in $requested) {
        $matches = @($observation.artifacts | Where-Object { $_.name -ceq $name -and $_.expired -eq $false })
        if ($matches.Count -ne 1) { throw "Required artifact metadata is missing or ambiguous: $name" }
        $metadata = $matches[0]
        $compressedMax = if ($name.StartsWith('verification-plan-')) { 2097152L } elseif ($name.StartsWith('functional-runtime-conv-')) { 67108864L } elseif ($name.StartsWith('design-semantic-visual-')) { 134217728L } else { throw 'Artifact name has no approved budget.' }
        if ([long]$metadata.size_in_bytes -gt $compressedMax) { throw 'Artifact metadata exceeds its compressed-size budget.' }
        $archivePath = Join-Path $DestinationRoot ".$([long]$metadata.id).zip"
        Save-BoundedGitHubArtifactArchive -Repository $Repository -ArtifactId ([long]$metadata.id) -Token $Token -Destination $archivePath -MaxBytes $compressedMax
        $artifactRoot = Join-Path $DestinationRoot $name
        $expandedMax = if ($name.StartsWith('verification-plan-')) { 2097152L } elseif ($name.StartsWith('functional-runtime-conv-')) { 268435456L } else { 536870912L }
        [void](Expand-VerifiedArtifactArchive -ArchivePath $archivePath -DestinationRoot $artifactRoot -MaxTotalBytes $expandedMax)
        Remove-Item -LiteralPath $archivePath -Force
    }
}

Export-ModuleMember -Function Expand-VerifiedArtifactArchive, Receive-GitHubArtifactSet
