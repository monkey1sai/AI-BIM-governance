[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [switch]$Apply,

    [Parameter(Mandatory)]
    [ValidateNotNullOrEmpty()]
    [string]$CandidateRoot,

    [Parameter(Mandatory)]
    [ValidatePattern('^[0-9A-Fa-f]{64}$')]
    [string]$ExpectedFreezeSha256,

    [Parameter(Mandatory)]
    [ValidatePattern('^[0-9A-Fa-f]{64}$')]
    [string]$ExpectedReviewedBuildManifestSha256,

    [Parameter(Mandatory)]
    [ValidatePattern('^[0-9A-Fa-f]{64}$')]
    [string]$ExpectedBootstrapSha256,

    [Parameter(Mandatory)]
    [ValidatePattern('^[0-9A-Fa-f]{64}$')]
    [string]$ExpectedVerifierSha256,

    [Parameter(Mandatory)]
    [ValidatePattern('^[0-9A-Fa-f]{64}$')]
    [string]$ExpectedInstallerLauncherSha256
)

Microsoft.PowerShell.Core\Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# This public launcher is the separately protected owner entrypoint. It must
# itself run in the fixed no-profile PowerShell process, pins its own and the
# internal verifier bytes, and invokes only those verified verifier bytes in
# this same clean process with a process-local capability object.
$fixedPowerShellPath = 'C:\Program Files\PowerShell\7\pwsh.exe'
$fixedPowerShellDllPath = 'C:\Program Files\PowerShell\7\pwsh.dll'
$fixedPowerShellHash = 'A7AD362B22E0E289772CCCF78C7AF3B99E32F3084E675392E4A9FFDDF380BF05'
$fixedPowerShellVersion = '7.5.4.500'
$fixedOwnerSidValue = 'S-1-5-21-2135046472-1977311562-3864793309-1001'
$launcherPath = [System.IO.Path]::GetFullPath($PSCommandPath)
$packageRoot = [System.IO.Path]::GetFullPath($PSScriptRoot).TrimEnd('\')
$verifierPath = [System.IO.Path]::Combine($packageRoot, 'invoke_protected_blip_installer.ps1')
$candidateRoot = [System.IO.Path]::GetFullPath($CandidateRoot).TrimEnd('\')
$reviewedManifestPath = [System.IO.Path]::Combine($candidateRoot, 'reviewed-build-manifest.json')
$launcherStream = $null
$verifierStream = $null
$manifestStream = $null
$verifierBytes = $null

function Assert-ExactLauncherCommandLine {
    $expected = @(
        $fixedPowerShellDllPath,
        '-NoLogo', '-NoProfile', '-NonInteractive', '-File', $launcherPath,
        '-Apply', '-CandidateRoot', $candidateRoot,
        '-ExpectedFreezeSha256', $ExpectedFreezeSha256.ToUpperInvariant(),
        '-ExpectedReviewedBuildManifestSha256',
        $ExpectedReviewedBuildManifestSha256.ToUpperInvariant(),
        '-ExpectedBootstrapSha256', $ExpectedBootstrapSha256.ToUpperInvariant(),
        '-ExpectedVerifierSha256', $ExpectedVerifierSha256.ToUpperInvariant(),
        '-ExpectedInstallerLauncherSha256',
        $ExpectedInstallerLauncherSha256.ToUpperInvariant()
    )
    $actual = [Environment]::GetCommandLineArgs()
    if ($actual.Count -ne $expected.Count) {
        throw 'The protected installer launcher command line is not the exact clean contract.'
    }
    for ($index = 0; $index -lt $expected.Count; $index += 1) {
        if ($actual[$index] -cne $expected[$index]) {
            throw 'The protected installer launcher command line is not the exact clean contract.'
        }
    }
}

function Assert-NoReparseChain {
    param(
        [Parameter(Mandatory)][string]$LiteralPath,
        [switch]$LeafMustBeFile,
        [switch]$LeafMustBeDirectory
    )
    $full = [System.IO.Path]::GetFullPath($LiteralPath)
    if ($LeafMustBeFile -and -not [System.IO.File]::Exists($full)) {
        throw "Protected installer input is unavailable: $full"
    }
    if ($LeafMustBeDirectory -and -not [System.IO.Directory]::Exists($full)) {
        throw "Protected installer directory is unavailable: $full"
    }
    $root = [System.IO.Path]::GetPathRoot($full)
    $cursor = $full.TrimEnd('\')
    while ($true) {
        if (([System.IO.File]::GetAttributes($cursor) -band
            [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw "Protected installer input resolves through a reparse point: $full"
        }
        if ($cursor.TrimEnd('\') -ceq $root.TrimEnd('\')) { break }
        $parent = [System.IO.Directory]::GetParent($cursor)
        if ($null -eq $parent) {
            throw "Protected installer input has an invalid ancestor chain: $full"
        }
        $cursor = $parent.FullName
    }
    return $full
}

function Open-PinnedReadStream {
    param(
        [Parameter(Mandatory)][string]$LiteralPath,
        [Parameter(Mandatory)][long]$MaximumLength
    )
    $path = Assert-NoReparseChain -LiteralPath $LiteralPath -LeafMustBeFile
    $stream = [System.IO.FileStream]::new(
        $path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read,
        [System.IO.FileShare]::Read, 65536, [System.IO.FileOptions]::SequentialScan
    )
    if ($stream.Length -le 0 -or $stream.Length -gt $MaximumLength) {
        $stream.Dispose()
        throw "Protected installer input length is outside the reviewed bound: $path"
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

function Read-OpenStreamBytes {
    param([Parameter(Mandatory)][System.IO.FileStream]$Stream)
    $bytes = [byte[]]::new([int]$Stream.Length)
    $Stream.Position = 0
    $offset = 0
    while ($offset -lt $bytes.Length) {
        $read = $Stream.Read($bytes, $offset, $bytes.Length - $offset)
        if ($read -le 0) { throw "Protected installer input ended early: $($Stream.Name)" }
        $offset += $read
    }
    $Stream.Position = 0
    return ,$bytes
}

function Set-LauncherSafeEnvironment {
    foreach ($name in @(
        [Environment]::GetEnvironmentVariables(
            [EnvironmentVariableTarget]::Process
        ).Keys
    )) {
        [Environment]::SetEnvironmentVariable(
            [string]$name, $null, [EnvironmentVariableTarget]::Process
        )
    }
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
        [Environment]::SetEnvironmentVariable(
            $entry.Key, $entry.Value, [EnvironmentVariableTarget]::Process
        )
    }
}

try {
    if (-not $Apply) { throw 'Protected installation requires the explicit -Apply capability.' }
    Assert-ExactLauncherCommandLine
    if ($ExecutionContext.SessionState.LanguageMode -ne
        [System.Management.Automation.PSLanguageMode]::FullLanguage) {
        throw 'The protected installer launcher requires an unmodified FullLanguage owner process.'
    }
    if ([System.IO.Path]::GetFullPath([Environment]::ProcessPath) -cne $fixedPowerShellPath -or
        [System.Diagnostics.FileVersionInfo]::GetVersionInfo($fixedPowerShellPath).FileVersion -cne
            $fixedPowerShellVersion) {
        throw 'The protected installer launcher host differs from the reviewed PowerShell host.'
    }
    $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
    if ($null -eq $identity.User -or $identity.User.Value -cne $fixedOwnerSidValue) {
        throw 'The protected installer launcher identity is not the immutable owner SID.'
    }
    $sandboxSid = ([System.Security.Principal.NTAccount]::new(
        [Environment]::MachineName + '\CodexSandboxUsers'
    )).Translate([System.Security.Principal.SecurityIdentifier])
    foreach ($group in $identity.Groups) {
        if ($group.Value -ceq $sandboxSid.Value) {
            throw 'The protected installer launcher cannot run as a CodexSandboxUsers member.'
        }
    }
    if ($packageRoot.StartsWith($candidateRoot + '\', [StringComparison]::OrdinalIgnoreCase) -or
        $packageRoot -ceq $candidateRoot) {
        throw 'The protected installer launcher and verifier must be outside the candidate directory.'
    }
    [void](Assert-NoReparseChain -LiteralPath $candidateRoot -LeafMustBeDirectory)
    [void](Assert-NoReparseChain -LiteralPath $fixedPowerShellPath -LeafMustBeFile)

    $hostStream = Open-PinnedReadStream -LiteralPath $fixedPowerShellPath -MaximumLength 268435456
    try {
        if ((Get-OpenStreamSha256 -Stream $hostStream) -cne $fixedPowerShellHash) {
            throw 'The protected installer launcher host hash differs from the reviewed host.'
        }
    }
    finally { $hostStream.Dispose() }

    $launcherStream = Open-PinnedReadStream -LiteralPath $launcherPath -MaximumLength 1048576
    $verifierStream = Open-PinnedReadStream -LiteralPath $verifierPath -MaximumLength 1048576
    $manifestStream = Open-PinnedReadStream -LiteralPath $reviewedManifestPath -MaximumLength 1048576
    if ((Get-OpenStreamSha256 -Stream $launcherStream) -cne
        $ExpectedInstallerLauncherSha256.ToUpperInvariant()) {
        throw 'The running installer launcher differs from the explicitly reviewed hash.'
    }
    if ((Get-OpenStreamSha256 -Stream $verifierStream) -cne
        $ExpectedVerifierSha256.ToUpperInvariant()) {
        throw 'The internal installer verifier differs from the explicitly reviewed hash.'
    }
    if ((Get-OpenStreamSha256 -Stream $manifestStream) -cne
        $ExpectedReviewedBuildManifestSha256.ToUpperInvariant()) {
        throw 'The reviewed build manifest differs from the explicitly authorized hash.'
    }
    $manifestStream.Dispose()
    $manifestStream = $null

    $verifierBytes = Read-OpenStreamBytes -Stream $verifierStream
    $verifierText = [System.Text.UTF8Encoding]::new($false, $true).GetString($verifierBytes)
    $tokens = $null
    $parseErrors = $null
    $verifierAst = [System.Management.Automation.Language.Parser]::ParseInput(
        $verifierText, [ref]$tokens, [ref]$parseErrors
    )
    if ($parseErrors.Count -ne 0 -or $null -eq $verifierAst.ParamBlock) {
        throw 'The authorized internal verifier is not a valid parameterized PowerShell script.'
    }
    $parameterNames = [System.Collections.Generic.List[string]]::new()
    foreach ($parameter in $verifierAst.ParamBlock.Parameters) {
        $parameterNames.Add($parameter.Name.VariablePath.UserPath)
    }
    $contractMatches = $parameterNames.Count -eq 8
    foreach ($required in @(
        'Apply', 'CandidateRoot', 'ExpectedFreezeSha256',
        'ExpectedReviewedBuildManifestSha256', 'ExpectedBootstrapSha256',
        'ExpectedVerifierSha256', 'ExpectedInstallerLauncherSha256',
        'InternalLauncherContext'
    )) {
        if ($parameterNames -cnotcontains $required) { $contractMatches = $false }
    }
    if (-not $contractMatches) {
        throw 'The authorized internal verifier parameter contract is invalid.'
    }

    Set-LauncherSafeEnvironment
    $capability = [object]::new()
    $launcherContext = [pscustomobject]@{
        Schema = 'blip-installer-launcher-context/v1'
        Capability = $capability
        ProofEcho = $capability
        CandidateRoot = $candidateRoot
        FreezeSha256 = $ExpectedFreezeSha256.ToUpperInvariant()
        ReviewedBuildManifestSha256 = $ExpectedReviewedBuildManifestSha256.ToUpperInvariant()
        BootstrapSha256 = $ExpectedBootstrapSha256.ToUpperInvariant()
        InstallerLauncherPath = $launcherPath
        InstallerLauncherSha256 = $ExpectedInstallerLauncherSha256.ToUpperInvariant()
        InstallerLauncherStream = $launcherStream
        VerifierPath = $verifierPath
        VerifierSha256 = $ExpectedVerifierSha256.ToUpperInvariant()
        VerifierStream = $verifierStream
        HostPid = [Environment]::ProcessId
        HostPath = $fixedPowerShellPath
    }
    $script = [ScriptBlock]::Create($verifierText)
    & $script -Apply `
        -CandidateRoot $candidateRoot `
        -ExpectedFreezeSha256 $ExpectedFreezeSha256.ToUpperInvariant() `
        -ExpectedReviewedBuildManifestSha256 `
            $ExpectedReviewedBuildManifestSha256.ToUpperInvariant() `
        -ExpectedBootstrapSha256 $ExpectedBootstrapSha256.ToUpperInvariant() `
        -ExpectedVerifierSha256 $ExpectedVerifierSha256.ToUpperInvariant() `
        -ExpectedInstallerLauncherSha256 $ExpectedInstallerLauncherSha256.ToUpperInvariant() `
        -InternalLauncherContext $launcherContext
}
finally {
    if ($null -ne $verifierBytes) {
        [System.Security.Cryptography.CryptographicOperations]::ZeroMemory($verifierBytes)
    }
    if ($null -ne $manifestStream) { $manifestStream.Dispose() }
    if ($null -ne $verifierStream) { $verifierStream.Dispose() }
    if ($null -ne $launcherStream) { $launcherStream.Dispose() }
}
