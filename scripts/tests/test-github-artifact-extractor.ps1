[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Import-Module (Join-Path $PSScriptRoot '..\lib\GitHubArtifact.psm1') -Force

function Assert-True {
    param([Parameter(Mandatory = $true)] $Condition, [Parameter(Mandatory = $true)][string] $Message)
    if (-not $Condition) { throw "ASSERT FAILED: $Message" }
}

function New-ZipFixture {
    param([Parameter(Mandatory = $true)][string] $Path, [Parameter(Mandatory = $true)][object[]] $Entries)
    Add-Type -AssemblyName System.IO.Compression
    $stream = [IO.File]::Open($Path, [IO.FileMode]::CreateNew)
    try {
        $zip = [IO.Compression.ZipArchive]::new($stream, [IO.Compression.ZipArchiveMode]::Create, $false)
        try {
            foreach ($item in $Entries) {
                $entry = $zip.CreateEntry([string]$item.Path, [IO.Compression.CompressionLevel]::Optimal)
                if ($null -ne $item.PSObject.Properties['ExternalAttributes']) { $entry.ExternalAttributes = [int]$item.ExternalAttributes }
                $entryStream = $entry.Open()
                try {
                    $bytes = [Text.Encoding]::UTF8.GetBytes([string]$item.Content)
                    $entryStream.Write($bytes, 0, $bytes.Length)
                } finally { $entryStream.Dispose() }
            }
        } finally { $zip.Dispose() }
    } finally { $stream.Dispose() }
}

function Assert-RejectedBeforeOutput {
    param([Parameter(Mandatory = $true)][string] $Zip, [Parameter(Mandatory = $true)][string] $Output, [hashtable] $Arguments = @{})
    $failed = $false
    try { Expand-VerifiedArtifactArchive -ArchivePath $Zip -DestinationRoot $Output @Arguments *> $null } catch { $failed = $true }
    Assert-True $failed "unsafe archive must fail: $Zip"
    Assert-True (-not (Test-Path -LiteralPath $Output)) 'unsafe archive must fail before creating output'
}

$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$parent = Join-Path $repoRoot 'artifacts\tmp'
[void](New-Item -ItemType Directory -Path $parent -Force)
$root = Join-Path $parent "github-artifact-$([Guid]::NewGuid().ToString('N'))"
[void](New-Item -ItemType Directory -Path $root)
try {
    $valid = Join-Path $root 'valid.zip'
    New-ZipFixture -Path $valid -Entries @([pscustomobject]@{ Path = 'artifacts/e2e/result.json'; Content = '{"status":"passed"}' })
    $validOut = Join-Path $root 'valid-out'
    $report = Expand-VerifiedArtifactArchive -ArchivePath $valid -DestinationRoot $validOut
    Assert-True ($report.EntryCount -eq 1) 'valid archive reports one entry'
    Assert-True (Test-Path -LiteralPath (Join-Path $validOut 'artifacts\e2e\result.json') -PathType Leaf) 'valid archive is extracted'

    $traversal = Join-Path $root 'traversal.zip'
    New-ZipFixture -Path $traversal -Entries @([pscustomobject]@{ Path = '../escape.txt'; Content = 'x' })
    Assert-RejectedBeforeOutput -Zip $traversal -Output (Join-Path $root 'traversal-out')

    $collision = Join-Path $root 'collision.zip'
    New-ZipFixture -Path $collision -Entries @(
        [pscustomobject]@{ Path = 'Evidence.json'; Content = 'a' },
        [pscustomobject]@{ Path = 'evidence.json'; Content = 'b' }
    )
    Assert-RejectedBeforeOutput -Zip $collision -Output (Join-Path $root 'collision-out')

    $oversize = Join-Path $root 'oversize.zip'
    New-ZipFixture -Path $oversize -Entries @([pscustomobject]@{ Path = 'large.bin'; Content = ('x' * 2048) })
    Assert-RejectedBeforeOutput -Zip $oversize -Output (Join-Path $root 'oversize-out') -Arguments @{ MaxTotalBytes = 1024 }

    $symlink = Join-Path $root 'symlink.zip'
    New-ZipFixture -Path $symlink -Entries @([pscustomobject]@{ Path = 'link'; Content = 'target'; ExternalAttributes = -1577123840 })
    Assert-RejectedBeforeOutput -Zip $symlink -Output (Join-Path $root 'symlink-out')

    $ratio = Join-Path $root 'ratio.zip'
    New-ZipFixture -Path $ratio -Entries @([pscustomobject]@{ Path = 'zeros.bin'; Content = ('0' * 1100000) })
    Assert-RejectedBeforeOutput -Zip $ratio -Output (Join-Path $root 'ratio-out') -Arguments @{ MaxCompressionRatio = 10 }

    Write-Host '[test-github-artifact-extractor] all assertions passed'
} finally {
    if (Test-Path -LiteralPath $root) { Remove-Item -LiteralPath $root -Recurse -Force }
}
