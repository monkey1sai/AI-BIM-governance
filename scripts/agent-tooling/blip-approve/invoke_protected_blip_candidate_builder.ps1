[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [switch]$Build,

    [Parameter(Mandatory)]
    [ValidateNotNullOrEmpty()]
    [string]$OutputDirectory,

    [Parameter(Mandatory)]
    [ValidateNotNullOrEmpty()]
    [string]$ReviewedBuildManifestPath,

    [Parameter(Mandatory)]
    [ValidatePattern('^[0-9A-Fa-f]{64}$')]
    [string]$ExpectedReviewedBuildManifestSha256,

    [Parameter(Mandatory)]
    [ValidatePattern('^[0-9A-Fa-f]{64}$')]
    [string]$ExpectedLauncherSha256,

    [Parameter(Mandatory)]
    [ValidatePattern('^[0-9A-Fa-f]{64}$')]
    [string]$ExpectedBuilderSha256
)

Microsoft.PowerShell.Core\Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# This launcher is a separately reviewed owner-side trust anchor. It never enters
# CandidateRoot. It pins itself, the builder, and the reviewed manifest while a
# fixed PowerShell host starts a clean, non-interactive child process.
$fixedPowerShellPath = 'C:\Program Files\PowerShell\7\pwsh.exe'
$fixedPowerShellHash = 'A7AD362B22E0E289772CCCF78C7AF3B99E32F3084E675392E4A9FFDDF380BF05'
$fixedPowerShellVersion = '7.5.4.500'
$fixedOwnerSidValue = 'S-1-5-21-2135046472-1977311562-3864793309-1001'
$launcherPath = [System.IO.Path]::GetFullPath($PSCommandPath)
$packageRoot = [System.IO.Path]::GetFullPath($PSScriptRoot).TrimEnd('\')
$builderPath = [System.IO.Path]::Combine($packageRoot, 'build_blip_candidate.ps1')
$manifestPath = [System.IO.Path]::GetFullPath($ReviewedBuildManifestPath)
$outputRoot = [System.IO.Path]::GetFullPath($OutputDirectory).TrimEnd('\')
$launcherStream = $null
$builderStream = $null
$manifestStream = $null

function Assert-NoReparseChain {
    param([Parameter(Mandatory)][string]$LiteralPath)
    $full = [System.IO.Path]::GetFullPath($LiteralPath)
    if (-not [System.IO.File]::Exists($full)) {
        throw "Protected builder input is unavailable: $full"
    }
    $root = [System.IO.Path]::GetPathRoot($full)
    $cursor = $full.TrimEnd('\')
    while ($true) {
        if (([System.IO.File]::GetAttributes($cursor) -band
            [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw "Protected builder input resolves through a reparse point: $full"
        }
        if ($cursor.TrimEnd('\') -ceq $root.TrimEnd('\')) { break }
        $parent = [System.IO.Directory]::GetParent($cursor)
        if ($null -eq $parent) { throw "Protected builder input has an invalid ancestor chain: $full" }
        $cursor = $parent.FullName
    }
    return $full
}

function Open-PinnedReadStream {
    param(
        [Parameter(Mandatory)][string]$LiteralPath,
        [Parameter(Mandatory)][long]$MaximumLength
    )
    $path = Assert-NoReparseChain -LiteralPath $LiteralPath
    $stream = [System.IO.FileStream]::new(
        $path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read,
        [System.IO.FileShare]::Read, 65536, [System.IO.FileOptions]::SequentialScan
    )
    if ($stream.Length -le 0 -or $stream.Length -gt $MaximumLength) {
        $stream.Dispose()
        throw "Protected builder input length is outside the reviewed bound: $path"
    }
    return $stream
}

function Get-OpenStreamSha256 {
    param([Parameter(Mandatory)][System.IO.FileStream]$Stream)
    $position = $Stream.Position
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        $Stream.Position = 0
        return [Convert]::ToHexString($sha.ComputeHash($Stream))
    }
    finally { $Stream.Position = $position; $sha.Dispose() }
}

try {
    if (-not $Build) { throw 'Protected candidate creation requires the explicit -Build capability.' }
    if ($ExecutionContext.SessionState.LanguageMode -ne
        [System.Management.Automation.PSLanguageMode]::FullLanguage) {
        throw 'The protected builder launcher requires an unmodified FullLanguage owner process.'
    }
    if ([System.IO.Path]::GetFullPath([Environment]::ProcessPath) -cne $fixedPowerShellPath -or
        [System.Diagnostics.FileVersionInfo]::GetVersionInfo($fixedPowerShellPath).FileVersion -cne
            $fixedPowerShellVersion) {
        throw 'The protected builder launcher host differs from the reviewed PowerShell host.'
    }
    $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
    if ($null -eq $identity.User -or $identity.User.Value -cne $fixedOwnerSidValue) {
        throw 'The protected builder launcher identity is not the immutable owner SID.'
    }
    $sandboxSid = ([System.Security.Principal.NTAccount]::new(
        [Environment]::MachineName + '\CodexSandboxUsers'
    )).Translate([System.Security.Principal.SecurityIdentifier])
    foreach ($group in $identity.Groups) {
        if ($group.Value -ceq $sandboxSid.Value) {
            throw 'The protected builder launcher cannot run as a CodexSandboxUsers member.'
        }
    }
    if ($outputRoot.StartsWith($packageRoot + '\', [StringComparison]::OrdinalIgnoreCase) -or
        $outputRoot -ceq $packageRoot) {
        throw 'Candidate output must be outside the reviewed source package.'
    }

    $hostStream = Open-PinnedReadStream -LiteralPath $fixedPowerShellPath -MaximumLength 268435456
    try {
        if ((Get-OpenStreamSha256 -Stream $hostStream) -cne $fixedPowerShellHash) {
            throw 'The protected builder launcher host hash differs from the reviewed host.'
        }
    }
    finally { $hostStream.Dispose() }

    $launcherStream = Open-PinnedReadStream -LiteralPath $launcherPath -MaximumLength 1048576
    $builderStream = Open-PinnedReadStream -LiteralPath $builderPath -MaximumLength 1048576
    $manifestStream = Open-PinnedReadStream -LiteralPath $manifestPath -MaximumLength 1048576
    if ((Get-OpenStreamSha256 -Stream $launcherStream) -cne
        $ExpectedLauncherSha256.ToUpperInvariant()) {
        throw 'The running builder launcher differs from the explicitly reviewed hash.'
    }
    if ((Get-OpenStreamSha256 -Stream $builderStream) -cne
        $ExpectedBuilderSha256.ToUpperInvariant()) {
        throw 'The candidate builder differs from the explicitly reviewed hash.'
    }
    if ((Get-OpenStreamSha256 -Stream $manifestStream) -cne
        $ExpectedReviewedBuildManifestSha256.ToUpperInvariant()) {
        throw 'The reviewed build manifest differs from the explicitly authorized hash.'
    }

    $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
    $startInfo.FileName = $fixedPowerShellPath
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $startInfo.WorkingDirectory = $packageRoot
    $startInfo.Environment.Clear()
    foreach ($entry in ([ordered]@{
        SystemRoot = 'C:\Windows'
        WINDIR = 'C:\Windows'
        ComSpec = 'C:\Windows\System32\cmd.exe'
        ProgramData = 'C:\ProgramData'
        ProgramFiles = 'C:\Program Files'
        'ProgramFiles(x86)' = 'C:\Program Files (x86)'
        ProgramW6432 = 'C:\Program Files'
        USERPROFILE = 'C:\Users\IOT'
        HOMEDRIVE = 'C:'
        HOMEPATH = '\Users\IOT'
        TEMP = 'C:\Users\IOT\AppData\Local\Temp'
        TMP = 'C:\Users\IOT\AppData\Local\Temp'
        Path = 'C:\Windows\System32;C:\Windows;C:\Program Files\PowerShell\7'
        PATHEXT = '.COM;.EXE;.BAT;.CMD'
        PSModulePath = 'C:\Program Files\PowerShell\7\Modules'
    }).GetEnumerator()) {
        $startInfo.Environment[$entry.Key] = $entry.Value
    }
    foreach ($argument in @(
        '-NoLogo', '-NoProfile', '-NonInteractive', '-File', $builderPath,
        '-OutputDirectory', $outputRoot, '-Production',
        '-ReviewedBuildManifestPath', $manifestPath
    )) {
        [void]$startInfo.ArgumentList.Add($argument)
    }
    $process = [System.Diagnostics.Process]::new()
    $process.StartInfo = $startInfo
    try {
        if (-not $process.Start()) { throw 'The fixed PowerShell builder process did not start.' }
        $standardOutput = $process.StandardOutput.ReadToEndAsync()
        $standardError = $process.StandardError.ReadToEndAsync()
        if (-not $process.WaitForExit(600000)) {
            $process.Kill($true)
            throw 'The protected candidate builder exceeded its ten-minute bound.'
        }
        $stdout = $standardOutput.GetAwaiter().GetResult()
        $stderr = $standardError.GetAwaiter().GetResult()
        if ($process.ExitCode -ne 0) {
            throw "The protected candidate builder failed: $stderr"
        }
        $expectedMarker = 'BLIP_REVIEWED_BUILD_MANIFEST_SHA256=' +
            $ExpectedReviewedBuildManifestSha256.ToUpperInvariant()
        if (@($stdout -split "`r?`n") -cnotcontains $expectedMarker) {
            throw 'The protected candidate builder did not echo the reviewed manifest binding.'
        }
        [Console]::Out.WriteLine($stdout.TrimEnd())
    }
    finally { $process.Dispose() }
}
finally {
    if ($null -ne $manifestStream) { $manifestStream.Dispose() }
    if ($null -ne $builderStream) { $builderStream.Dispose() }
    if ($null -ne $launcherStream) { $launcherStream.Dispose() }
}
