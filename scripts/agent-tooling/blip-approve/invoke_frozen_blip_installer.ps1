[CmdletBinding()]
param(
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
    [ValidateNotNull()]
    [object]$InternalLoaderContext
)

Microsoft.PowerShell.Core\Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# This file is an inner bootstrap, never a directly executable installer.  The
# owner-authorized root loader must first verify these exact bytes and execute
# them from memory while retaining an exclusive handle to this file.
if (-not [string]::IsNullOrWhiteSpace($PSCommandPath) -or
    -not [string]::IsNullOrWhiteSpace($PSScriptRoot)) {
    throw 'The frozen installer bootstrap must be executed from verified in-memory bytes.'
}

$fixedPowerShellPath = 'C:\Program Files\PowerShell\7\pwsh.exe'
$fixedPowerShellHash = 'A7AD362B22E0E289772CCCF78C7AF3B99E32F3084E675392E4A9FFDDF380BF05'
$fixedPowerShellVersion = '7.5.4.500'
$fixedOwnerSidValue = 'S-1-5-21-2135046472-1977311562-3864793309-1001'
$moduleDependencies = [ordered]@{
    'C:\Program Files\PowerShell\7\Modules\Microsoft.PowerShell.Management\Microsoft.PowerShell.Management.psd1' = '8E46BAD04C1CFF740C317630160BDA1D82F5287EE42BCFEAC952A05D68998FA0'
    'C:\Program Files\PowerShell\7\Modules\Microsoft.PowerShell.Security\Microsoft.PowerShell.Security.psd1' = 'BD6B6DA1CE41C6F25C991148BCB14AE17EE216091AB4BAEB154E0C03993D886F'
    'C:\Program Files\PowerShell\7\Modules\Microsoft.PowerShell.Security\Security.types.ps1xml' = 'D438B0D9D1579DD9090AADEA18C34A3BDEDDD198951642E92521060473BF8998'
    'C:\Program Files\PowerShell\7\Modules\Microsoft.PowerShell.Utility\Microsoft.PowerShell.Utility.psd1' = '0A19BF1917DFC626670EE86FFC6F9E3EDF00E2BED1A7CF4A05F29F3380A2A482'
    'C:\Program Files\PowerShell\7\Microsoft.PowerShell.Commands.Management.dll' = '2ED60F0A518438E62ADD07BD70DF476D5A997F1C249D34C29F1A41E59251DF72'
    'C:\Program Files\PowerShell\7\Microsoft.PowerShell.Security.dll' = 'C7088E44293774224BB2545D057BA11267EFFCF55CA7F80B2F1BD9DFBC914B82'
    'C:\Program Files\PowerShell\7\Microsoft.PowerShell.Commands.Utility.dll' = '1F02E95C5C3FE82723298AC594BD91439A0E1E0A3901581998B5A88D1A31A010'
}
$reviewedSourceFiles = @(
    'install_blip_auto_approval.ps1',
    'invoke_frozen_blip_installer.ps1',
    'bot/bots.json',
    'bot/scripts/app_auth.py',
    'bot/scripts/bind_ship_attestation.py',
    'bot/scripts/blip_review.py',
    'bot/scripts/codex_ship_gate.py',
    'bot/scripts/collect_ship_gate_packet.py',
    'bot/scripts/post_review.py',
    'bot/scripts/run_blip_live_approve_once.ps1',
    'bot/scripts/run_codex_bound_ship_gate_once.ps1',
    'bot/scripts/ship_gate_packet.py'
)
$reviewedRuntimeKeys = @(
    'runtime/pwsh.exe',
    'runtime/python.exe',
    'runtime/codex-package.json',
    'runtime/bin/codex.exe',
    'runtime/bin/codex-code-mode-host.exe',
    'runtime/codex-path/rg.exe',
    'runtime/codex-resources/codex-command-runner.exe',
    'runtime/codex-resources/codex-windows-sandbox-setup.exe',
    'runtime/psmodule/Microsoft.PowerShell.Management.psd1',
    'runtime/psmodule/Microsoft.PowerShell.Security.psd1',
    'runtime/psmodule/Security.types.ps1xml',
    'runtime/psmodule/Microsoft.PowerShell.Utility.psd1',
    'runtime/psmodule/Microsoft.PowerShell.Commands.Management.dll',
    'runtime/psmodule/Microsoft.PowerShell.Security.dll',
    'runtime/psmodule/Microsoft.PowerShell.Commands.Utility.dll'
)
$reviewedSignerKeys = @(
    'runtime/pwsh.exe',
    'runtime/python.exe',
    'runtime/bin/codex.exe',
    'runtime/bin/codex-code-mode-host.exe',
    'runtime/codex-path/rg.exe',
    'runtime/codex-resources/codex-command-runner.exe',
    'runtime/codex-resources/codex-windows-sandbox-setup.exe',
    'runtime/psmodule/Microsoft.PowerShell.Commands.Management.dll',
    'runtime/psmodule/Microsoft.PowerShell.Security.dll',
    'runtime/psmodule/Microsoft.PowerShell.Commands.Utility.dll'
)
$candidateRoot = [System.IO.Path]::GetFullPath($CandidateRoot).TrimEnd('\')
$freezePath = [System.IO.Path]::Combine($candidateRoot, 'candidate-freeze.json')
$installerPath = [System.IO.Path]::Combine($candidateRoot, 'install_blip_auto_approval.ps1')
$bootstrapPath = [System.IO.Path]::Combine($candidateRoot, 'invoke_frozen_blip_installer.ps1')
$reviewedManifestPath = [System.IO.Path]::Combine($candidateRoot, 'reviewed-build-manifest.json')
$freezeStream = $null
$installerStream = $null
$freezeDocument = $null
$reviewedManifestDocument = $null
$freezeBytes = $null
$reviewedManifestBytes = $null
$installerBytes = $null

function Set-BootstrapSafeEnvironment {
    foreach ($name in @(
        [Environment]::GetEnvironmentVariables(
            [EnvironmentVariableTarget]::Process
        ).Keys
    )) {
        [Environment]::SetEnvironmentVariable(
            [string]$name, $null, [EnvironmentVariableTarget]::Process
        )
    }
    $safeEnvironment = [ordered]@{
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
    }
    foreach ($entry in $safeEnvironment.GetEnumerator()) {
        [Environment]::SetEnvironmentVariable(
            $entry.Key, $entry.Value, [EnvironmentVariableTarget]::Process
        )
    }
}

function Get-BytesSha256 {
    param([Parameter(Mandatory)][byte[]]$Bytes)
    return [Convert]::ToHexString([System.Security.Cryptography.SHA256]::HashData($Bytes))
}

function Get-OpenStreamSha256 {
    param([Parameter(Mandatory)][System.IO.FileStream]$Stream)
    $position = $Stream.Position
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        $Stream.Position = 0
        return [Convert]::ToHexString($sha.ComputeHash($Stream))
    }
    finally {
        $Stream.Position = $position
        $sha.Dispose()
    }
}

function Read-LockedStreamBytes {
    param(
        [Parameter(Mandatory)][System.IO.FileStream]$Stream,
        [Parameter(Mandatory)][long]$MaximumLength
    )
    if ($Stream.Length -le 0 -or $Stream.Length -gt $MaximumLength) {
        throw "Frozen input length is outside the approved bound: $($Stream.Name)"
    }
    $bytes = [byte[]]::new([int]$Stream.Length)
    $Stream.Position = 0
    $offset = 0
    while ($offset -lt $bytes.Length) {
        $read = $Stream.Read($bytes, $offset, $bytes.Length - $offset)
        if ($read -le 0) { throw "Frozen input ended early: $($Stream.Name)" }
        $offset += $read
    }
    $Stream.Position = 0
    return ,$bytes
}

function ConvertFrom-StrictUtf8 {
    param([Parameter(Mandatory)][byte[]]$Bytes)
    return [System.Text.UTF8Encoding]::new($false, $true).GetString($Bytes)
}

function Assert-FileSha256 {
    param(
        [Parameter(Mandatory)][string]$LiteralPath,
        [Parameter(Mandatory)][string]$ExpectedSha256
    )
    $stream = [System.IO.FileStream]::new(
        $LiteralPath,
        [System.IO.FileMode]::Open,
        [System.IO.FileAccess]::Read,
        [System.IO.FileShare]::Read
    )
    try {
        if ((Get-OpenStreamSha256 -Stream $stream) -cne $ExpectedSha256) {
            throw "Protected PowerShell dependency hash mismatch: $LiteralPath"
        }
    }
    finally { $stream.Dispose() }
}

function Assert-NoReparseChain {
    param(
        [Parameter(Mandatory)][string]$LiteralPath,
        [switch]$LeafMustBeFile,
        [switch]$LeafMustBeDirectory
    )
    $full = [System.IO.Path]::GetFullPath($LiteralPath)
    if ($LeafMustBeFile -and -not [System.IO.File]::Exists($full)) {
        throw "Required frozen file is unavailable: $full"
    }
    if ($LeafMustBeDirectory -and -not [System.IO.Directory]::Exists($full)) {
        throw "Required frozen directory is unavailable: $full"
    }
    $root = [System.IO.Path]::GetPathRoot($full)
    $cursor = $full.TrimEnd('\')
    while ($true) {
        if (-not [System.IO.File]::Exists($cursor) -and
            -not [System.IO.Directory]::Exists($cursor)) {
            throw "Frozen candidate ancestor is unavailable: $cursor"
        }
        $attributes = [System.IO.File]::GetAttributes($cursor)
        if (($attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw "Frozen candidate resolves through a reparse point: $cursor"
        }
        if ($cursor.TrimEnd('\') -ceq $root.TrimEnd('\')) { break }
        $parent = [System.IO.Directory]::GetParent($cursor)
        if ($null -eq $parent) { throw "Frozen candidate has an invalid ancestor chain: $cursor" }
        $cursor = $parent.FullName
    }
    return $full
}

function Open-ExclusiveFrozenFile {
    param(
        [Parameter(Mandatory)][string]$LiteralPath,
        [Parameter(Mandatory)][long]$MaximumLength
    )
    $full = Assert-NoReparseChain -LiteralPath $LiteralPath -LeafMustBeFile
    $stream = [System.IO.FileStream]::new(
        $full,
        [System.IO.FileMode]::Open,
        [System.IO.FileAccess]::Read,
        [System.IO.FileShare]::None,
        65536,
        [System.IO.FileOptions]::SequentialScan
    )
    if ($stream.Length -le 0 -or $stream.Length -gt $MaximumLength) {
        $stream.Dispose()
        throw "Frozen input length is outside the approved bound: $full"
    }
    return $stream
}

function Assert-ExclusiveStream {
    param(
        [Parameter(Mandatory)][System.IO.FileStream]$Stream,
        [Parameter(Mandatory)][string]$ExpectedPath
    )
    if (-not $Stream.CanRead -or $Stream.SafeFileHandle.IsClosed -or
        [System.IO.Path]::GetFullPath($Stream.Name) -cne $ExpectedPath) {
        throw "The root loader did not retain the expected bootstrap stream: $ExpectedPath"
    }
    $second = $null
    $blocked = $false
    try {
        $second = [System.IO.FileStream]::new(
            $ExpectedPath,
            [System.IO.FileMode]::Open,
            [System.IO.FileAccess]::Read,
            [System.IO.FileShare]::ReadWrite
        )
    }
    catch [System.IO.IOException] { $blocked = $true }
    finally { if ($null -ne $second) { $second.Dispose() } }
    if (-not $blocked) { throw "Frozen input is not exclusively locked: $ExpectedPath" }
}

function Assert-PinnedReadStream {
    param(
        [Parameter(Mandatory)][System.IO.FileStream]$Stream,
        [Parameter(Mandatory)][string]$ExpectedPath
    )
    if (-not $Stream.CanRead -or $Stream.SafeFileHandle.IsClosed -or
        [System.IO.Path]::GetFullPath($Stream.Name) -cne $ExpectedPath) {
        throw "The root loader did not retain the expected protected stream: $ExpectedPath"
    }
    $writer = $null
    $blocked = $false
    try {
        $writer = [System.IO.FileStream]::new(
            $ExpectedPath,
            [System.IO.FileMode]::Open,
            [System.IO.FileAccess]::Write,
            [System.IO.FileShare]::ReadWrite
        )
    }
    catch [System.IO.IOException] { $blocked = $true }
    finally { if ($null -ne $writer) { $writer.Dispose() } }
    if (-not $blocked) { throw "Protected input is writable while pinned: $ExpectedPath" }
}

function Get-UniqueJsonProperty {
    param(
        [Parameter(Mandatory)][System.Text.Json.JsonElement]$Object,
        [Parameter(Mandatory)][string]$Name
    )
    if ($Object.ValueKind -ne [System.Text.Json.JsonValueKind]::Object) {
        throw "Frozen JSON member is not an object: $Name"
    }
    $count = 0
    $match = [System.Text.Json.JsonElement]::new()
    foreach ($property in $Object.EnumerateObject()) {
        if ($property.Name -ceq $Name) {
            $count += 1
            $match = $property.Value.Clone()
        }
    }
    if ($count -ne 1) { throw "Frozen JSON must contain exactly one property named $Name." }
    return $match
}

function Assert-ExactJsonProperties {
    param(
        [Parameter(Mandatory)][System.Text.Json.JsonElement]$Object,
        [Parameter(Mandatory)][string[]]$ExpectedNames,
        [Parameter(Mandatory)][string]$Label
    )
    if ($Object.ValueKind -ne [System.Text.Json.JsonValueKind]::Object) {
        throw "$Label is not a JSON object."
    }
    $seen = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
    foreach ($property in $Object.EnumerateObject()) {
        if (-not $seen.Add($property.Name)) { throw "$Label contains a duplicate property." }
        if ($ExpectedNames -cnotcontains $property.Name) { throw "$Label contains an unknown property." }
    }
    if ($seen.Count -ne $ExpectedNames.Count) { throw "$Label is missing a required property." }
    foreach ($name in $ExpectedNames) {
        if (-not $seen.Contains($name)) { throw "$Label is missing a required property." }
    }
}

function Assert-ExactReviewedMapMatchesFreeze {
    param(
        [Parameter(Mandatory)][System.Text.Json.JsonElement]$ReviewedObject,
        [Parameter(Mandatory)][System.Text.Json.JsonElement]$FreezeObject,
        [Parameter(Mandatory)][string[]]$ExpectedNames,
        [Parameter(Mandatory)][string]$Pattern,
        [Parameter(Mandatory)][string]$Label
    )
    Assert-ExactJsonProperties -Object $ReviewedObject -ExpectedNames $ExpectedNames -Label $Label
    Assert-ExactJsonProperties `
        -Object $FreezeObject -ExpectedNames $ExpectedNames -Label "Candidate $Label"
    foreach ($name in $ExpectedNames) {
        $reviewed = Get-UniqueJsonProperty -Object $ReviewedObject -Name $name
        $frozen = Get-UniqueJsonProperty -Object $FreezeObject -Name $name
        if ($reviewed.ValueKind -ne [System.Text.Json.JsonValueKind]::String -or
            $frozen.ValueKind -ne [System.Text.Json.JsonValueKind]::String -or
            $reviewed.GetString() -notmatch $Pattern -or
            $frozen.GetString() -notmatch $Pattern -or
            $reviewed.GetString().ToUpperInvariant() -cne
                $frozen.GetString().ToUpperInvariant()) {
            throw "$Label differs from candidate freeze: $name"
        }
    }
}

function Assert-ReviewedManifestMatchesFreeze {
    param(
        [Parameter(Mandatory)][System.Text.Json.JsonElement]$ReviewedRoot,
        [Parameter(Mandatory)][System.Text.Json.JsonElement]$FreezeRoot
    )
    Assert-ExactJsonProperties -Object $ReviewedRoot -ExpectedNames @(
        'schema', 'source_commit', 'builder_launcher_sha256', 'builder_sha256',
        'installer_launcher_sha256', 'external_verifier_sha256',
        'source_files', 'runtime_source', 'runtime_signers'
    ) -Label 'Reviewed build manifest'
    $schema = Get-UniqueJsonProperty -Object $ReviewedRoot -Name 'schema'
    $sourceCommit = Get-UniqueJsonProperty -Object $ReviewedRoot -Name 'source_commit'
    $builderLauncherHash = Get-UniqueJsonProperty `
        -Object $ReviewedRoot -Name 'builder_launcher_sha256'
    $builderHash = Get-UniqueJsonProperty -Object $ReviewedRoot -Name 'builder_sha256'
    $installerLauncherHash = Get-UniqueJsonProperty `
        -Object $ReviewedRoot -Name 'installer_launcher_sha256'
    $verifierHash = Get-UniqueJsonProperty -Object $ReviewedRoot -Name 'external_verifier_sha256'
    $frozenSourceCommit = Get-UniqueJsonProperty -Object $FreezeRoot -Name 'source_commit'
    $frozenVerifierHash = Get-UniqueJsonProperty `
        -Object $FreezeRoot -Name 'external_verifier_sha256'
    if ($schema.ValueKind -ne [System.Text.Json.JsonValueKind]::String -or
        $schema.GetString() -cne 'blip-auto-approval-reviewed-build/v2' -or
        $sourceCommit.ValueKind -ne [System.Text.Json.JsonValueKind]::String -or
        $sourceCommit.GetString() -notmatch '^[0-9a-fA-F]{40}$' -or
        $sourceCommit.GetString() -eq ('0' * 40) -or
        $frozenSourceCommit.ValueKind -ne [System.Text.Json.JsonValueKind]::String -or
        $sourceCommit.GetString().ToLowerInvariant() -cne
            $frozenSourceCommit.GetString() -or
        $builderLauncherHash.ValueKind -ne [System.Text.Json.JsonValueKind]::String -or
        $builderLauncherHash.GetString() -notmatch '^[0-9a-fA-F]{64}$' -or
        $builderHash.ValueKind -ne [System.Text.Json.JsonValueKind]::String -or
        $builderHash.GetString() -notmatch '^[0-9a-fA-F]{64}$' -or
        $installerLauncherHash.ValueKind -ne [System.Text.Json.JsonValueKind]::String -or
        $installerLauncherHash.GetString().ToUpperInvariant() -cne
            $InternalLoaderContext.InstallerLauncherSha256 -or
        $verifierHash.ValueKind -ne [System.Text.Json.JsonValueKind]::String -or
        $frozenVerifierHash.ValueKind -ne [System.Text.Json.JsonValueKind]::String -or
        $verifierHash.GetString().ToUpperInvariant() -cne
            $frozenVerifierHash.GetString().ToUpperInvariant() -or
        $verifierHash.GetString().ToUpperInvariant() -cne
            $InternalLoaderContext.VerifierSha256) {
        throw 'Reviewed build manifest identity differs from the candidate freeze.'
    }
    Assert-ExactReviewedMapMatchesFreeze `
        -ReviewedObject (Get-UniqueJsonProperty -Object $ReviewedRoot -Name 'source_files') `
        -FreezeObject (Get-UniqueJsonProperty -Object $FreezeRoot -Name 'source_files') `
        -ExpectedNames $reviewedSourceFiles -Pattern '^[0-9a-fA-F]{64}$' `
        -Label 'Reviewed source_files'
    Assert-ExactReviewedMapMatchesFreeze `
        -ReviewedObject (Get-UniqueJsonProperty -Object $ReviewedRoot -Name 'runtime_source') `
        -FreezeObject (Get-UniqueJsonProperty -Object $FreezeRoot -Name 'runtime_source') `
        -ExpectedNames $reviewedRuntimeKeys -Pattern '^[0-9a-fA-F]{64}$' `
        -Label 'Reviewed runtime_source'
    $signers = Get-UniqueJsonProperty -Object $ReviewedRoot -Name 'runtime_signers'
    Assert-ExactJsonProperties `
        -Object $signers -ExpectedNames $reviewedSignerKeys -Label 'Reviewed runtime_signers'
    foreach ($name in $reviewedSignerKeys) {
        $value = Get-UniqueJsonProperty -Object $signers -Name $name
        if ($value.ValueKind -ne [System.Text.Json.JsonValueKind]::String -or
            $value.GetString() -notmatch '^[0-9a-fA-F]{40}$') {
            throw "Reviewed runtime_signers contains an invalid value: $name"
        }
    }
}

function Assert-InstallerCommandResolution {
    param(
        [Parameter(Mandatory)]
        [System.Management.Automation.Language.ScriptBlockAst]$InstallerAst
    )
    $contracts = [ordered]@{
        'Join-Path' = 'Microsoft.PowerShell.Management'
        'Get-Item' = 'Microsoft.PowerShell.Management'
        'Split-Path' = 'Microsoft.PowerShell.Management'
        'Get-Acl' = 'Microsoft.PowerShell.Security'
        'Get-AuthenticodeSignature' = 'Microsoft.PowerShell.Security'
        'Get-FileHash' = 'Microsoft.PowerShell.Utility'
        'ConvertFrom-Json' = 'Microsoft.PowerShell.Utility'
        'ConvertTo-Json' = 'Microsoft.PowerShell.Utility'
        'Set-Content' = 'Microsoft.PowerShell.Management'
        'Get-ChildItem' = 'Microsoft.PowerShell.Management'
        'Where-Object' = 'Microsoft.PowerShell.Core'
        'ForEach-Object' = 'Microsoft.PowerShell.Core'
        'Test-Path' = 'Microsoft.PowerShell.Management'
        'Write-Warning' = 'Microsoft.PowerShell.Utility'
        'Get-Content' = 'Microsoft.PowerShell.Management'
        'Microsoft.PowerShell.Core\Set-StrictMode' = 'Microsoft.PowerShell.Core'
        'Sort-Object' = 'Microsoft.PowerShell.Utility'
        'Write-Output' = 'Microsoft.PowerShell.Utility'
    }
    $localFunctions = [System.Collections.Generic.HashSet[string]]::new(
        [System.StringComparer]::Ordinal
    )
    foreach ($definition in $InstallerAst.FindAll(
        {
            param($node)
            $node -is [System.Management.Automation.Language.FunctionDefinitionAst]
        },
        $true
    )) {
        [void]$localFunctions.Add($definition.Name)
    }
    foreach ($commandAst in $InstallerAst.FindAll(
        {
            param($node)
            $node -is [System.Management.Automation.Language.CommandAst]
        },
        $true
    )) {
        $name = $commandAst.GetCommandName()
        if ([string]::IsNullOrWhiteSpace($name)) {
            throw 'Installer contains a dynamic command that is outside the exact command contract.'
        }
        if (-not $localFunctions.Contains($name) -and -not $contracts.Contains($name)) {
            throw "Installer command is outside the exact command contract: $name"
        }
    }
    foreach ($entry in $contracts.GetEnumerator()) {
        $command = Microsoft.PowerShell.Core\Get-Command `
            -Name $entry.Key -ErrorAction Stop
        if ($command.CommandType -ne [System.Management.Automation.CommandTypes]::Cmdlet -or
            $command.Source -cne $entry.Value) {
            throw "Installer command resolution is shadowed or untrusted: $($entry.Key)"
        }
    }
}

try {
    if ($ExecutionContext.SessionState.LanguageMode -ne
        [System.Management.Automation.PSLanguageMode]::FullLanguage) {
        throw 'The frozen installer requires an unmodified FullLanguage owner process.'
    }
    $expectedLoaderProperties = @(
        'Schema', 'Capability', 'ProofEcho', 'CandidateRoot',
        'FreezeSha256', 'ReviewedBuildManifestSha256',
        'ReviewedBuildManifestStream', 'BootstrapSha256', 'BootstrapStream',
        'InstallerLauncherPath', 'InstallerLauncherSha256', 'InstallerLauncherStream',
        'VerifierPath', 'VerifierSha256', 'VerifierStream',
        'HostPid', 'HostPath'
    )
    $actualLoaderProperties = @($InternalLoaderContext.PSObject.Properties.Name)
    $loaderPropertySet = [System.Collections.Generic.HashSet[string]]::new(
        [System.StringComparer]::Ordinal
    )
    foreach ($name in $actualLoaderProperties) { [void]$loaderPropertySet.Add($name) }
    $loaderPropertySetMatches = $loaderPropertySet.Count -eq $expectedLoaderProperties.Count
    foreach ($name in $expectedLoaderProperties) {
        if (-not $loaderPropertySet.Contains($name)) { $loaderPropertySetMatches = $false }
    }
    if (-not $loaderPropertySetMatches -or
        $InternalLoaderContext.Schema -cne 'blip-installer-root-loader/v4' -or
        -not [object]::ReferenceEquals(
            $InternalLoaderContext.Capability, $InternalLoaderContext.ProofEcho
        ) -or
        $InternalLoaderContext.CandidateRoot -cne $candidateRoot -or
        $InternalLoaderContext.FreezeSha256 -cne $ExpectedFreezeSha256.ToUpperInvariant() -or
        $InternalLoaderContext.ReviewedBuildManifestSha256 -cne
            $ExpectedReviewedBuildManifestSha256.ToUpperInvariant() -or
        $InternalLoaderContext.BootstrapSha256 -cne $ExpectedBootstrapSha256.ToUpperInvariant() -or
        $InternalLoaderContext.HostPid -ne [Environment]::ProcessId -or
        $InternalLoaderContext.HostPath -cne $fixedPowerShellPath) {
        throw 'The process-local root-loader proof is invalid.'
    }
    if ([System.IO.Path]::GetFullPath([Environment]::ProcessPath) -cne $fixedPowerShellPath -or
        [System.Diagnostics.FileVersionInfo]::GetVersionInfo(
            $fixedPowerShellPath
        ).FileVersion -cne $fixedPowerShellVersion) {
        throw 'The running PowerShell host differs from the reviewed bootstrap host.'
    }
    $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
    if ($identity.User.Value -cne $fixedOwnerSidValue) {
        throw 'The frozen installer identity is not the immutable owner SID.'
    }
    $hostStream = [System.IO.FileStream]::new(
        $fixedPowerShellPath,
        [System.IO.FileMode]::Open,
        [System.IO.FileAccess]::Read,
        [System.IO.FileShare]::Read
    )
    try {
        if ((Get-OpenStreamSha256 -Stream $hostStream) -cne $fixedPowerShellHash) {
            throw 'The running PowerShell host hash differs from the reviewed bootstrap host.'
        }
    }
    finally { $hostStream.Dispose() }
    $sandboxSid = ([System.Security.Principal.NTAccount]::new(
        [Environment]::MachineName + '\CodexSandboxUsers'
    )).Translate([System.Security.Principal.SecurityIdentifier])
    $isSandboxIdentity = $identity.User -eq $sandboxSid
    foreach ($group in $identity.Groups) {
        if ($group.Value -ceq $sandboxSid.Value) { $isSandboxIdentity = $true }
    }
    if ($isSandboxIdentity) {
        throw 'The frozen installer cannot run inside the Codex sandbox identity.'
    }

    [void](Assert-NoReparseChain -LiteralPath $candidateRoot -LeafMustBeDirectory)
    [void](Assert-NoReparseChain -LiteralPath $freezePath -LeafMustBeFile)
    [void](Assert-NoReparseChain -LiteralPath $installerPath -LeafMustBeFile)
    [void](Assert-NoReparseChain -LiteralPath $bootstrapPath -LeafMustBeFile)
    [void](Assert-NoReparseChain -LiteralPath $reviewedManifestPath -LeafMustBeFile)
    [void](Assert-NoReparseChain `
        -LiteralPath $InternalLoaderContext.InstallerLauncherPath -LeafMustBeFile)
    [void](Assert-NoReparseChain -LiteralPath $InternalLoaderContext.VerifierPath -LeafMustBeFile)

    $expectedInstallerLauncherPath = [System.IO.Path]::Combine(
        [System.IO.Path]::GetDirectoryName($InternalLoaderContext.VerifierPath),
        'invoke_protected_blip_installer_launcher.ps1'
    )
    if ($InternalLoaderContext.InstallerLauncherPath -cne $expectedInstallerLauncherPath -or
        $InternalLoaderContext.InstallerLauncherPath.StartsWith(
            $candidateRoot + '\', [StringComparison]::OrdinalIgnoreCase
        ) -or $InternalLoaderContext.InstallerLauncherPath -ceq $candidateRoot -or
        $InternalLoaderContext.InstallerLauncherSha256 -notmatch '^[0-9A-F]{64}$' -or
        $InternalLoaderContext.InstallerLauncherStream -isnot [System.IO.FileStream]) {
        throw 'The protected installer launcher provenance is missing or candidate-controlled.'
    }
    Assert-PinnedReadStream -Stream $InternalLoaderContext.InstallerLauncherStream `
        -ExpectedPath $InternalLoaderContext.InstallerLauncherPath
    if ((Get-OpenStreamSha256 -Stream $InternalLoaderContext.InstallerLauncherStream) -cne
        $InternalLoaderContext.InstallerLauncherSha256) {
        throw 'The protected installer launcher bytes moved after owner authorization.'
    }

    if ($InternalLoaderContext.VerifierPath.StartsWith(
        $candidateRoot + '\', [StringComparison]::OrdinalIgnoreCase
    ) -or $InternalLoaderContext.VerifierPath -ceq $candidateRoot -or
        $InternalLoaderContext.VerifierSha256 -notmatch '^[0-9A-F]{64}$' -or
        $InternalLoaderContext.VerifierStream -isnot [System.IO.FileStream]) {
        throw 'The external verifier provenance is missing or candidate-controlled.'
    }
    Assert-PinnedReadStream -Stream $InternalLoaderContext.VerifierStream `
        -ExpectedPath $InternalLoaderContext.VerifierPath
    if ((Get-OpenStreamSha256 -Stream $InternalLoaderContext.VerifierStream) -cne
        $InternalLoaderContext.VerifierSha256) {
        throw 'The external verifier bytes moved after owner authorization.'
    }

    if ($InternalLoaderContext.BootstrapStream -isnot [System.IO.FileStream]) {
        throw 'The root loader did not supply its locked bootstrap stream.'
    }
    Assert-ExclusiveStream -Stream $InternalLoaderContext.BootstrapStream `
        -ExpectedPath $bootstrapPath
    if ((Get-OpenStreamSha256 -Stream $InternalLoaderContext.BootstrapStream) -cne
        $ExpectedBootstrapSha256.ToUpperInvariant()) {
        throw 'The executing bootstrap bytes differ from the owner-authorized hash.'
    }
    if ($InternalLoaderContext.ReviewedBuildManifestStream -isnot [System.IO.FileStream]) {
        throw 'The root loader did not supply its locked reviewed build manifest stream.'
    }
    Assert-ExclusiveStream -Stream $InternalLoaderContext.ReviewedBuildManifestStream `
        -ExpectedPath $reviewedManifestPath
    if ((Get-OpenStreamSha256 -Stream $InternalLoaderContext.ReviewedBuildManifestStream) -cne
        $ExpectedReviewedBuildManifestSha256.ToUpperInvariant()) {
        throw 'The reviewed build manifest bytes differ from the owner-authorized hash.'
    }
    $reviewedManifestBytes = Read-LockedStreamBytes `
        -Stream $InternalLoaderContext.ReviewedBuildManifestStream -MaximumLength 1048576
    [void](ConvertFrom-StrictUtf8 -Bytes $reviewedManifestBytes)
    $reviewedManifestDocument = [System.Text.Json.JsonDocument]::Parse(
        [ReadOnlyMemory[byte]]::new($reviewedManifestBytes)
    )

    $freezeStream = Open-ExclusiveFrozenFile -LiteralPath $freezePath -MaximumLength 1048576
    Assert-ExclusiveStream -Stream $freezeStream -ExpectedPath $freezePath
    $freezeBytes = Read-LockedStreamBytes -Stream $freezeStream -MaximumLength 1048576
    if ((Get-BytesSha256 -Bytes $freezeBytes) -cne $ExpectedFreezeSha256.ToUpperInvariant()) {
        throw 'The candidate freeze differs from the owner-authorized immutable hash.'
    }
    [void](ConvertFrom-StrictUtf8 -Bytes $freezeBytes)
    $freezeDocument = [System.Text.Json.JsonDocument]::Parse(
        [ReadOnlyMemory[byte]]::new($freezeBytes)
    )
    $root = $freezeDocument.RootElement
    Assert-ExactJsonProperties -Object $root -ExpectedNames @(
        'schema', 'build_profile', 'source_commit',
        'reviewed_build_manifest_sha256', 'external_verifier_sha256',
        'source_files', 'runtime_source'
    ) -Label 'Candidate freeze'
    $schema = Get-UniqueJsonProperty -Object $root -Name 'schema'
    if ($schema.ValueKind -ne [System.Text.Json.JsonValueKind]::String -or
        $schema.GetString() -cne 'blip-auto-approval-candidate-freeze/v3') {
        throw 'The candidate freeze schema is invalid.'
    }
    $profile = Get-UniqueJsonProperty -Object $root -Name 'build_profile'
    $sourceCommitElement = Get-UniqueJsonProperty -Object $root -Name 'source_commit'
    $reviewedManifestElement = Get-UniqueJsonProperty `
        -Object $root -Name 'reviewed_build_manifest_sha256'
    $verifierHashElement = Get-UniqueJsonProperty -Object $root -Name 'external_verifier_sha256'
    if ($profile.ValueKind -ne [System.Text.Json.JsonValueKind]::String -or
        $profile.GetString() -cne 'PRODUCTION' -or
        $sourceCommitElement.ValueKind -ne [System.Text.Json.JsonValueKind]::String -or
        $sourceCommitElement.GetString() -notmatch '^[0-9a-f]{40}$' -or
        $sourceCommitElement.GetString() -eq ('0' * 40) -or
        $reviewedManifestElement.ValueKind -ne [System.Text.Json.JsonValueKind]::String -or
        $reviewedManifestElement.GetString() -cne
            $ExpectedReviewedBuildManifestSha256.ToUpperInvariant() -or
        $verifierHashElement.ValueKind -ne [System.Text.Json.JsonValueKind]::String -or
        $verifierHashElement.GetString() -cne $InternalLoaderContext.VerifierSha256) {
        throw 'The freeze is test-only or does not bind the external protected verifier.'
    }
    Assert-ReviewedManifestMatchesFreeze `
        -ReviewedRoot $reviewedManifestDocument.RootElement -FreezeRoot $root
    $sourceFiles = Get-UniqueJsonProperty -Object $root -Name 'source_files'
    $installerHashElement = Get-UniqueJsonProperty `
        -Object $sourceFiles -Name 'install_blip_auto_approval.ps1'
    $bootstrapHashElement = Get-UniqueJsonProperty `
        -Object $sourceFiles -Name 'invoke_frozen_blip_installer.ps1'
    if ($installerHashElement.ValueKind -ne [System.Text.Json.JsonValueKind]::String -or
        $bootstrapHashElement.ValueKind -ne [System.Text.Json.JsonValueKind]::String) {
        throw 'The freeze installer/bootstrap hashes are not strings.'
    }
    $installerHash = $installerHashElement.GetString()
    $bootstrapHash = $bootstrapHashElement.GetString()
    if ($installerHash -notmatch '^[0-9A-F]{64}$' -or
        $bootstrapHash -cne $ExpectedBootstrapSha256.ToUpperInvariant()) {
        throw 'The freeze does not bind the owner-authorized installer/bootstrap pair.'
    }

    $installerStream = Open-ExclusiveFrozenFile `
        -LiteralPath $installerPath -MaximumLength 1048576
    Assert-ExclusiveStream -Stream $installerStream -ExpectedPath $installerPath
    $installerBytes = Read-LockedStreamBytes -Stream $installerStream -MaximumLength 1048576
    if ((Get-BytesSha256 -Bytes $installerBytes) -cne $installerHash) {
        throw 'The installer bytes differ from the immutable freeze.'
    }
    $installerText = ConvertFrom-StrictUtf8 -Bytes $installerBytes
    $tokens = $null
    $parseErrors = $null
    $installerAst = [System.Management.Automation.Language.Parser]::ParseInput(
        $installerText, [ref]$tokens, [ref]$parseErrors
    )
    if ($parseErrors.Count -ne 0 -or $null -eq $installerAst.ParamBlock) {
        throw 'The frozen installer is not a valid PowerShell script with a parameter contract.'
    }
    $requiredParameters = @(
        'Apply', 'ExpectedFreezeSha256', 'ExpectedInstallerSha256',
        'ExpectedReviewedBuildManifestSha256', 'ExpectedBootstrapSha256',
        'CandidateRoot', 'BootstrapContext'
    )
    $actualParameters = [System.Collections.Generic.List[string]]::new()
    foreach ($parameter in $installerAst.ParamBlock.Parameters) {
        $actualParameters.Add($parameter.Name.VariablePath.UserPath)
    }
    foreach ($required in $requiredParameters) {
        if ($actualParameters -cnotcontains $required) {
            throw "The frozen installer is missing required parameter: $required"
        }
    }

    Set-BootstrapSafeEnvironment
    $moduleRoot = 'C:\Program Files\PowerShell\7\Modules'
    $PSModuleAutoLoadingPreference = 'None'
    foreach ($dependency in $moduleDependencies.GetEnumerator()) {
        [void](Assert-NoReparseChain -LiteralPath $dependency.Key -LeafMustBeFile)
        Assert-FileSha256 -LiteralPath $dependency.Key -ExpectedSha256 $dependency.Value
    }
    foreach ($manifest in @(
        'C:\Program Files\PowerShell\7\Modules\Microsoft.PowerShell.Management\Microsoft.PowerShell.Management.psd1',
        'C:\Program Files\PowerShell\7\Modules\Microsoft.PowerShell.Security\Microsoft.PowerShell.Security.psd1',
        'C:\Program Files\PowerShell\7\Modules\Microsoft.PowerShell.Utility\Microsoft.PowerShell.Utility.psd1'
    )) {
        Microsoft.PowerShell.Core\Import-Module `
            -Name $manifest -Force -ErrorAction Stop
    }
    Assert-InstallerCommandResolution -InstallerAst $installerAst

    $capability = $InternalLoaderContext.Capability
    $bootstrapContext = [pscustomobject]@{
        Schema = 'blip-installer-bootstrap-context/v3'
        Capability = $capability
        ProofEcho = $capability
        LoaderContext = $InternalLoaderContext
        CandidateRoot = $candidateRoot
        FreezeSha256 = $ExpectedFreezeSha256.ToUpperInvariant()
        ReviewedBuildManifestSha256 = $ExpectedReviewedBuildManifestSha256.ToUpperInvariant()
        ReviewedBuildManifestStream = $InternalLoaderContext.ReviewedBuildManifestStream
        InstallerSha256 = $installerHash
        BootstrapSha256 = $ExpectedBootstrapSha256.ToUpperInvariant()
        FreezeStream = $freezeStream
        InstallerStream = $installerStream
        BootstrapStream = $InternalLoaderContext.BootstrapStream
        InstallerLauncherPath = $InternalLoaderContext.InstallerLauncherPath
        InstallerLauncherSha256 = $InternalLoaderContext.InstallerLauncherSha256
        InstallerLauncherStream = $InternalLoaderContext.InstallerLauncherStream
        VerifierPath = $InternalLoaderContext.VerifierPath
        VerifierSha256 = $InternalLoaderContext.VerifierSha256
        VerifierStream = $InternalLoaderContext.VerifierStream
    }
    $installerScript = [ScriptBlock]::Create($installerText)
    & $installerScript -Apply `
        -CandidateRoot $candidateRoot `
        -ExpectedFreezeSha256 $ExpectedFreezeSha256.ToUpperInvariant() `
        -ExpectedInstallerSha256 $installerHash `
        -ExpectedReviewedBuildManifestSha256 $ExpectedReviewedBuildManifestSha256.ToUpperInvariant() `
        -ExpectedBootstrapSha256 $ExpectedBootstrapSha256.ToUpperInvariant() `
        -BootstrapContext $bootstrapContext
}
finally {
    if ($null -ne $reviewedManifestDocument) { $reviewedManifestDocument.Dispose() }
    if ($null -ne $freezeDocument) { $freezeDocument.Dispose() }
    if ($null -ne $installerStream) { $installerStream.Dispose() }
    if ($null -ne $freezeStream) { $freezeStream.Dispose() }
    if ($null -ne $freezeBytes) {
        [System.Array]::Clear($freezeBytes, 0, $freezeBytes.Length)
    }
    if ($null -ne $reviewedManifestBytes) {
        [System.Array]::Clear($reviewedManifestBytes, 0, $reviewedManifestBytes.Length)
    }
    if ($null -ne $installerBytes) {
        [System.Array]::Clear($installerBytes, 0, $installerBytes.Length)
    }
}
