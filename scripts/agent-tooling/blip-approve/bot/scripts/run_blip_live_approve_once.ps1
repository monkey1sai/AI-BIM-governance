# run_blip_live_approve_once.ps1
#
# Owner-controlled one-shot broker for a counted monkey1sai-blip User approval.
# This file is editable source only. It refuses to run unless installed beside an
# owner-controlled manifest in the trusted runtime directory. The token is read only
# from the fixed owner-protected .env.blip file and injected into one pinned child.
[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [ValidateRange(1, 999999)]
    [int]$PrNumber,

    [Parameter(Mandatory)]
    [ValidatePattern('^[0-9a-fA-F]{40}$')]
    [string]$ExpectedBaseSha,

    [Parameter(Mandatory)]
    [ValidatePattern('^[0-9a-fA-F]{40}$')]
    [string]$ExpectedHeadSha,

    [Parameter(Mandatory)]
    [ValidateSet('mechanical_only', 'focused_semantic', 'risk_scoped_specialists', 'human_critical')]
    [string]$ReviewMode,

    [switch]$HumanCriticalOverride
)

$ErrorActionPreference = 'Stop'
$retirementReason = 'HELD_AUTOMATED_APPROVAL_RETIRED: automated User/PAT approval is retired; an eligible human must approve in the GitHub UI.'
throw $retirementReason

$PSModuleAutoLoadingPreference = 'None'

# Trust-critical prelude: use only PowerShell language constructs and .NET until
# the fixed owner, host, module bytes, environment, and command resolution are
# proven. This must remain before every Join-Path or other module-backed cmdlet.
$wrapperFixedPowerShellPath = 'C:\Program Files\PowerShell\7\pwsh.exe'
$wrapperFixedPowerShellHash = 'A7AD362B22E0E289772CCCF78C7AF3B99E32F3084E675392E4A9FFDDF380BF05'
$wrapperFixedPowerShellVersion = '7.5.4.500'
$wrapperFixedOwnerSid = 'S-1-5-21-2135046472-1977311562-3864793309-1001'
$trustedPowerShellInputs = [ordered]@{
    'runtime/psmodule/Microsoft.PowerShell.Management.psd1' = [pscustomobject][ordered]@{
        Path = 'C:\Program Files\PowerShell\7\Modules\Microsoft.PowerShell.Management\Microsoft.PowerShell.Management.psd1'
        Sha256 = '8E46BAD04C1CFF740C317630160BDA1D82F5287EE42BCFEAC952A05D68998FA0'
    }
    'runtime/psmodule/Microsoft.PowerShell.Security.psd1' = [pscustomobject][ordered]@{
        Path = 'C:\Program Files\PowerShell\7\Modules\Microsoft.PowerShell.Security\Microsoft.PowerShell.Security.psd1'
        Sha256 = 'BD6B6DA1CE41C6F25C991148BCB14AE17EE216091AB4BAEB154E0C03993D886F'
    }
    'runtime/psmodule/Security.types.ps1xml' = [pscustomobject][ordered]@{
        Path = 'C:\Program Files\PowerShell\7\Modules\Microsoft.PowerShell.Security\Security.types.ps1xml'
        Sha256 = 'D438B0D9D1579DD9090AADEA18C34A3BDEDDD198951642E92521060473BF8998'
    }
    'runtime/psmodule/Microsoft.PowerShell.Utility.psd1' = [pscustomobject][ordered]@{
        Path = 'C:\Program Files\PowerShell\7\Modules\Microsoft.PowerShell.Utility\Microsoft.PowerShell.Utility.psd1'
        Sha256 = '0A19BF1917DFC626670EE86FFC6F9E3EDF00E2BED1A7CF4A05F29F3380A2A482'
    }
    'runtime/psmodule/Microsoft.PowerShell.Commands.Management.dll' = [pscustomobject][ordered]@{
        Path = 'C:\Program Files\PowerShell\7\Microsoft.PowerShell.Commands.Management.dll'
        Sha256 = '2ED60F0A518438E62ADD07BD70DF476D5A997F1C249D34C29F1A41E59251DF72'
    }
    'runtime/psmodule/Microsoft.PowerShell.Security.dll' = [pscustomobject][ordered]@{
        Path = 'C:\Program Files\PowerShell\7\Microsoft.PowerShell.Security.dll'
        Sha256 = 'C7088E44293774224BB2545D057BA11267EFFCF55CA7F80B2F1BD9DFBC914B82'
    }
    'runtime/psmodule/Microsoft.PowerShell.Commands.Utility.dll' = [pscustomobject][ordered]@{
        Path = 'C:\Program Files\PowerShell\7\Microsoft.PowerShell.Commands.Utility.dll'
        Sha256 = '1F02E95C5C3FE82723298AC594BD91439A0E1E0A3901581998B5A88D1A31A010'
    }
}
$trustedPowerShellInputStreams = [System.Collections.Generic.List[System.IO.FileStream]]::new()

function Assert-WrapperBootstrapPath {
    param(
        [Parameter(Mandatory)][string]$LiteralPath,
        [switch]$LeafMustBeFile
    )
    $full = [System.IO.Path]::GetFullPath($LiteralPath)
    if ($LeafMustBeFile -and -not [System.IO.File]::Exists($full)) {
        throw "Required wrapper trust input is unavailable: $full"
    }
    $root = [System.IO.Path]::GetPathRoot($full)
    $cursor = $full.TrimEnd('\')
    while ($true) {
        if (-not [System.IO.File]::Exists($cursor) -and
            -not [System.IO.Directory]::Exists($cursor)) {
            throw "Wrapper trust-input ancestor is unavailable: $cursor"
        }
        if (([System.IO.File]::GetAttributes($cursor) -band
            [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw "Wrapper trust input resolves through a reparse point: $cursor"
        }
        if ($cursor.TrimEnd('\').Equals(
            $root.TrimEnd('\'), [StringComparison]::OrdinalIgnoreCase
        )) { break }
        $parent = [System.IO.Directory]::GetParent($cursor)
        if ($null -eq $parent) { throw "Wrapper trust input has an invalid ancestor chain: $cursor" }
        $cursor = $parent.FullName
    }
    return $full
}

function Get-WrapperBootstrapStreamSha256 {
    param([Parameter(Mandatory)][System.IO.FileStream]$Stream)
    $originalPosition = $Stream.Position
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        $Stream.Position = 0
        return [Convert]::ToHexString($sha.ComputeHash($Stream))
    }
    finally {
        $Stream.Position = $originalPosition
        $sha.Dispose()
    }
}

try {
    if ($ExecutionContext.SessionState.LanguageMode -ne
        [System.Management.Automation.PSLanguageMode]::FullLanguage) {
        throw 'The protected approval wrapper requires FullLanguage mode.'
    }
    if ([System.IO.Path]::GetFullPath([Environment]::ProcessPath) -cne
        $wrapperFixedPowerShellPath -or
        [System.Diagnostics.FileVersionInfo]::GetVersionInfo(
            $wrapperFixedPowerShellPath
        ).FileVersion -cne $wrapperFixedPowerShellVersion) {
        throw 'The protected approval wrapper host differs from the reviewed host.'
    }
    $wrapperIdentity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
    if ($wrapperIdentity.User.Value -cne $wrapperFixedOwnerSid) {
        throw 'The protected approval wrapper identity is not the immutable owner SID.'
    }
    $wrapperSandboxSid = ([System.Security.Principal.NTAccount]::new(
        [Environment]::MachineName + '\CodexSandboxUsers'
    )).Translate([System.Security.Principal.SecurityIdentifier])
    foreach ($group in $wrapperIdentity.Groups) {
        if ($group.Value -ceq $wrapperSandboxSid.Value) {
            throw 'The protected approval wrapper owner is a CodexSandboxUsers member.'
        }
    }

    [void](Assert-WrapperBootstrapPath -LiteralPath $wrapperFixedPowerShellPath -LeafMustBeFile)
    $wrapperHostStream = [System.IO.FileStream]::new(
        $wrapperFixedPowerShellPath,
        [System.IO.FileMode]::Open,
        [System.IO.FileAccess]::Read,
        [System.IO.FileShare]::Read
    )
    try {
        if ((Get-WrapperBootstrapStreamSha256 -Stream $wrapperHostStream) -cne
            $wrapperFixedPowerShellHash) {
            throw 'The protected approval wrapper host hash differs from the reviewed host.'
        }
    }
    finally { $wrapperHostStream.Dispose() }

    foreach ($entry in $trustedPowerShellInputs.GetEnumerator()) {
        $path = Assert-WrapperBootstrapPath -LiteralPath $entry.Value.Path -LeafMustBeFile
        $stream = [System.IO.FileStream]::new(
            $path,
            [System.IO.FileMode]::Open,
            [System.IO.FileAccess]::Read,
            [System.IO.FileShare]::Read
        )
        $trustedPowerShellInputStreams.Add($stream)
        if ((Get-WrapperBootstrapStreamSha256 -Stream $stream) -cne $entry.Value.Sha256) {
            throw "Protected PowerShell dependency hash mismatch: $($entry.Key)"
        }
    }

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
    $PSModuleAutoLoadingPreference = 'None'
    $importModule = $ExecutionContext.InvokeCommand.GetCommand(
        'Microsoft.PowerShell.Core\Import-Module',
        [System.Management.Automation.CommandTypes]::Cmdlet
    )
    if ($null -eq $importModule) { throw 'The built-in Import-Module cmdlet is unavailable.' }
    foreach ($manifestKey in @(
        'runtime/psmodule/Microsoft.PowerShell.Management.psd1',
        'runtime/psmodule/Microsoft.PowerShell.Security.psd1',
        'runtime/psmodule/Microsoft.PowerShell.Utility.psd1'
    )) {
        & $importModule -Name $trustedPowerShellInputs[$manifestKey].Path -Force -ErrorAction Stop
    }
    $requiredCmdlets = [ordered]@{
        'Join-Path' = 'Microsoft.PowerShell.Management'
        'Get-Item' = 'Microsoft.PowerShell.Management'
        'Get-Content' = 'Microsoft.PowerShell.Management'
        'Test-Path' = 'Microsoft.PowerShell.Management'
        'New-Item' = 'Microsoft.PowerShell.Management'
        'Split-Path' = 'Microsoft.PowerShell.Management'
        'Get-Acl' = 'Microsoft.PowerShell.Security'
        'Get-AuthenticodeSignature' = 'Microsoft.PowerShell.Security'
        'Get-FileHash' = 'Microsoft.PowerShell.Utility'
        'ConvertFrom-Json' = 'Microsoft.PowerShell.Utility'
        'ConvertTo-Json' = 'Microsoft.PowerShell.Utility'
        'Write-Information' = 'Microsoft.PowerShell.Utility'
        'ForEach-Object' = 'Microsoft.PowerShell.Core'
        'Where-Object' = 'Microsoft.PowerShell.Core'
        'Out-Null' = 'Microsoft.PowerShell.Core'
    }
    foreach ($entry in $requiredCmdlets.GetEnumerator()) {
        $resolved = $ExecutionContext.InvokeCommand.GetCommand(
            $entry.Key, [System.Management.Automation.CommandTypes]::All
        )
        if ($null -eq $resolved -or
            $resolved.CommandType -ne [System.Management.Automation.CommandTypes]::Cmdlet -or
            $resolved.ModuleName -cne $entry.Value) {
            throw "Protected wrapper command resolution is untrusted: $($entry.Key)"
        }
    }
}
catch {
    foreach ($stream in $trustedPowerShellInputStreams) { try { $stream.Dispose() } catch { } }
    throw
}

Microsoft.PowerShell.Core\Set-StrictMode -Version Latest

$repository = 'monkey1sai/AI-BIM-governance'
$reviewer = 'monkey1sai-blip'
$capabilityVersion = 'blip-approval-capability/v2'
$trustedRoot = $PSScriptRoot
$expectedTrustedRoot = 'C:\ProgramData\AI-BIM-governance\blip-approve\v1'
$productRoot = Split-Path -Parent $trustedRoot
$protectedRoot = Split-Path -Parent $productRoot
$stateRoot = Join-Path $trustedRoot 'state'
$powerShellPath = 'C:\Program Files\PowerShell\7\pwsh.exe'
$pythonPath = 'C:\Program Files\Python312\python.exe'
$fixedOwnerSidValue = 'S-1-5-21-2135046472-1977311562-3864793309-1001'
$helperPath = Join-Path $trustedRoot 'blip_review.py'
$authHelperPath = Join-Path $trustedRoot 'app_auth.py'
$appScriptsRoot = Join-Path $trustedRoot 'app-scripts'
$packetModulePath = Join-Path $appScriptsRoot 'ship_gate_packet.py'
$manifestPath = Join-Path $trustedRoot 'manifest.json'
$completionPath = Join-Path $trustedRoot 'install-complete.json'
$expectedManifestFileNames = @(
    'run_blip_live_approve_once.ps1',
    'blip_review.py',
    'app_auth.py',
    'run_codex_bound_ship_gate_once.ps1',
    'bind_ship_attestation.py',
    'bots.json',
    'app-scripts/collect_ship_gate_packet.py',
    'app-scripts/codex_ship_gate.py',
    'app-scripts/ship_gate_packet.py',
    'app-scripts/post_review.py',
    'app-scripts/app_auth.py'
)
$expectedManifestRuntimeNames = @(
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
$brokerPath = $PSCommandPath
$stamp = [DateTimeOffset]::Now.ToString('yyyyMMddTHHmmssfff')
$ExpectedBaseSha = $ExpectedBaseSha.ToLowerInvariant()
$ExpectedHeadSha = $ExpectedHeadSha.ToLowerInvariant()
$ReviewMode = $ReviewMode.ToLowerInvariant()
$resultPath = Join-Path $stateRoot "blip-live-approve-pr$PrNumber-$stamp.json"
$lockPath = Join-Path $stateRoot "blip-live-approve-pr$PrNumber-$($ExpectedHeadSha.Substring(0,12)).lock"
$tokenEnvironmentName = 'BLIP_GITHUB_TOKEN'
$reviewerTokenEnvPath = 'C:\Users\IOT\.grok\github-bot\.env.blip'
$capabilityEnvironmentName = 'BLIP_APPROVAL_CAPABILITY'
$protectionPolicyEnvironmentName = 'BLIP_PROTECTION_POLICY_JSON'
$secretRoot = Join-Path $productRoot 'secrets'
$protectionAdminTokenPath = Join-Path $secretRoot 'blip-protection-admin-token.v1.txt'
$pythonBootstrap = @'
import sys
import types

helper_path = sys.argv[1]
auth_helper_path = sys.argv[2]
packet_module_path = sys.argv[3]
sys.argv = [helper_path, *sys.argv[4:]]

auth_module = types.ModuleType("app_auth")
auth_module.__file__ = auth_helper_path
auth_module.__package__ = ""
sys.modules["app_auth"] = auth_module
with open(auth_helper_path, "rb") as auth_stream:
    auth_source = auth_stream.read()
exec(compile(auth_source, auth_helper_path, "exec"), auth_module.__dict__)

packet_module = types.ModuleType("ship_gate_packet")
packet_module.__file__ = packet_module_path
packet_module.__package__ = ""
sys.modules["ship_gate_packet"] = packet_module
with open(packet_module_path, "rb") as packet_stream:
    packet_source = packet_stream.read()
exec(compile(packet_source, packet_module_path, "exec"), packet_module.__dict__)

helper_globals = {
    "__name__": "__main__",
    "__file__": helper_path,
    "__package__": None,
    "__cached__": None,
}
with open(helper_path, "rb") as helper_stream:
    helper_source = helper_stream.read()
exec(compile(helper_source, helper_path, "exec"), helper_globals)
'@

$plainToken = $null
$tokenBytes = $null
$capability = $null
$capabilityBytes = $null
$protectionPolicyJson = $null
$protectionAdminToken = $null
$protectionAdminTokenBytes = $null
$protectionAdminTokenStream = $null
$protectionAdminTokenReader = $null
$reviewerTokenStream = $null
$childProcess = $null
$childStarted = $false
$childTimedOut = $false
$lockStream = $null
$helperStream = $null
$authHelperStream = $null
$packetModuleStream = $null
$pythonStream = $null
$powerShellStream = $null
$brokerExitCode = 1
$resultWritten = $false
$reviewId = $null
$reviewUrl = $null
$capabilityId = $null

function Get-OpenStreamSha256 {
    param([Parameter(Mandatory)][System.IO.FileStream]$Stream)
    $originalPosition = $Stream.Position
    $sha256 = [System.Security.Cryptography.SHA256]::Create()
    try {
        $Stream.Position = 0
        return [Convert]::ToHexString($sha256.ComputeHash($Stream))
    }
    finally {
        $Stream.Position = $originalPosition
        $sha256.Dispose()
    }
}

function Get-FileSha256 {
    param([Parameter(Mandatory)][string]$LiteralPath)
    return (Get-FileHash -LiteralPath $LiteralPath -Algorithm SHA256).Hash.ToUpperInvariant()
}

function Get-UniqueRuntimeJsonProperty {
    param(
        [Parameter(Mandatory)][System.Text.Json.JsonElement]$Object,
        [Parameter(Mandatory)][string]$Name,
        [Parameter(Mandatory)][string]$Label
    )
    if ($Object.ValueKind -ne [System.Text.Json.JsonValueKind]::Object) {
        throw "$Label must be a JSON object."
    }
    $count = 0
    $value = $null
    foreach ($property in $Object.EnumerateObject()) {
        if ($property.Name -ceq $Name) {
            $count++
            $value = $property.Value
        }
    }
    if ($count -ne 1) { throw "$Label must contain exactly one '$Name' property." }
    return $value
}

function Assert-ExactRuntimeJsonProperties {
    param(
        [Parameter(Mandatory)][System.Text.Json.JsonElement]$Object,
        [Parameter(Mandatory)][string[]]$ExpectedNames,
        [Parameter(Mandatory)][string]$Label
    )
    if ($Object.ValueKind -ne [System.Text.Json.JsonValueKind]::Object) {
        throw "$Label must be a JSON object."
    }
    $seen = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
    foreach ($property in $Object.EnumerateObject()) {
        if (-not $seen.Add($property.Name)) {
            throw "$Label contains duplicate property '$($property.Name)'."
        }
        if ($ExpectedNames -cnotcontains $property.Name) {
            throw "$Label contains unknown property '$($property.Name)'."
        }
    }
    foreach ($expectedName in $ExpectedNames) {
        if (-not $seen.Contains($expectedName)) {
            throw "$Label is missing required property '$expectedName'."
        }
    }
    if ($seen.Count -ne $ExpectedNames.Count) {
        throw "$Label property count is invalid."
    }
}

function Assert-ExactRuntimeHashObject {
    param(
        [Parameter(Mandatory)][System.Text.Json.JsonElement]$Object,
        [Parameter(Mandatory)][string[]]$ExpectedNames,
        [Parameter(Mandatory)][string]$Label
    )
    Assert-ExactRuntimeJsonProperties -Object $Object -ExpectedNames $ExpectedNames -Label $Label
    foreach ($name in $ExpectedNames) {
        $value = Get-UniqueRuntimeJsonProperty -Object $Object -Name $name -Label $Label
        if (
            $value.ValueKind -ne [System.Text.Json.JsonValueKind]::String -or
            $value.GetString() -notmatch '^[0-9A-F]{64}$'
        ) {
            throw "$Label property '$name' must be an uppercase SHA-256 value."
        }
    }
}

function ConvertFrom-StrictRuntimeMetadata {
    param(
        [Parameter(Mandatory)][string]$ManifestText,
        [Parameter(Mandatory)][string]$CompletionText,
        [Parameter(Mandatory)][string[]]$ExpectedFileNames,
        [Parameter(Mandatory)][string[]]$ExpectedRuntimeNames
    )
    $manifestDocument = $null
    $completionDocument = $null
    try {
        $manifestDocument = [System.Text.Json.JsonDocument]::Parse($ManifestText)
        $completionDocument = [System.Text.Json.JsonDocument]::Parse($CompletionText)
        $manifestRoot = $manifestDocument.RootElement
        $completionRoot = $completionDocument.RootElement
        Assert-ExactRuntimeJsonProperties -Object $manifestRoot -ExpectedNames @(
            'schema', 'source_commit', 'files', 'runtime', 'candidate_freeze_sha256',
            'activation', 'installed_at'
        ) -Label 'Trusted runtime manifest'
        Assert-ExactRuntimeJsonProperties -Object $completionRoot -ExpectedNames @(
            'schema', 'owner_sid', 'candidate_freeze_sha256', 'manifest_sha256', 'completed_at'
        ) -Label 'Trusted runtime completion marker'
        $files = Get-UniqueRuntimeJsonProperty -Object $manifestRoot -Name 'files' -Label 'Trusted runtime manifest'
        $runtime = Get-UniqueRuntimeJsonProperty -Object $manifestRoot -Name 'runtime' -Label 'Trusted runtime manifest'
        Assert-ExactRuntimeHashObject -Object $files -ExpectedNames $ExpectedFileNames -Label 'Trusted runtime manifest files'
        Assert-ExactRuntimeHashObject -Object $runtime -ExpectedNames $ExpectedRuntimeNames -Label 'Trusted runtime manifest runtime'
        foreach ($binding in @(
            @{ Root = $manifestRoot; Name = 'candidate_freeze_sha256'; Label = 'Trusted runtime manifest' },
            @{ Root = $completionRoot; Name = 'candidate_freeze_sha256'; Label = 'Trusted runtime completion marker' },
            @{ Root = $completionRoot; Name = 'manifest_sha256'; Label = 'Trusted runtime completion marker' }
        )) {
            $value = Get-UniqueRuntimeJsonProperty -Object $binding.Root -Name $binding.Name -Label $binding.Label
            if (
                $value.ValueKind -ne [System.Text.Json.JsonValueKind]::String -or
                $value.GetString() -notmatch '^[0-9A-F]{64}$'
            ) {
                throw "$($binding.Label) property '$($binding.Name)' must be an uppercase SHA-256 value."
            }
        }
        $manifestSchema = Get-UniqueRuntimeJsonProperty -Object $manifestRoot -Name 'schema' -Label 'Trusted runtime manifest'
        $sourceCommit = Get-UniqueRuntimeJsonProperty -Object $manifestRoot -Name 'source_commit' -Label 'Trusted runtime manifest'
        $activation = Get-UniqueRuntimeJsonProperty -Object $manifestRoot -Name 'activation' -Label 'Trusted runtime manifest'
        $completionSchema = Get-UniqueRuntimeJsonProperty -Object $completionRoot -Name 'schema' -Label 'Trusted runtime completion marker'
        foreach ($textBinding in @(
            @{ Value = $manifestSchema; Expected = 'blip-trusted-runtime-manifest/v1'; Label = 'manifest schema' },
            @{ Value = $activation; Expected = 'OWNER_PEM_AND_CODEX_LOGIN_REQUIRED'; Label = 'manifest activation' },
            @{ Value = $completionSchema; Expected = 'blip-trusted-runtime-complete/v1'; Label = 'completion schema' }
        )) {
            if (
                $textBinding.Value.ValueKind -ne [System.Text.Json.JsonValueKind]::String -or
                $textBinding.Value.GetString() -cne $textBinding.Expected
            ) {
                throw "Trusted runtime $($textBinding.Label) is invalid."
            }
        }
        if ($sourceCommit.ValueKind -ne [System.Text.Json.JsonValueKind]::String -or
            $sourceCommit.GetString() -cnotmatch '^[0-9a-f]{40}$' -or
            $sourceCommit.GetString() -ceq ('0' * 40)) {
            throw 'Trusted runtime source commit is invalid.'
        }
        foreach ($name in @('installed_at', 'completed_at', 'owner_sid')) {
            $root = if ($name -ceq 'installed_at') { $manifestRoot } else { $completionRoot }
            $label = if ($name -ceq 'installed_at') { 'Trusted runtime manifest' } else { 'Trusted runtime completion marker' }
            $value = Get-UniqueRuntimeJsonProperty -Object $root -Name $name -Label $label
            if (
                $value.ValueKind -ne [System.Text.Json.JsonValueKind]::String -or
                [string]::IsNullOrWhiteSpace($value.GetString())
            ) {
                throw "$label property '$name' must be a non-empty string."
            }
        }
        return [pscustomobject]@{
            Manifest = $ManifestText | ConvertFrom-Json
            Completion = $CompletionText | ConvertFrom-Json
        }
    }
    finally {
        if ($null -ne $completionDocument) { $completionDocument.Dispose() }
        if ($null -ne $manifestDocument) { $manifestDocument.Dispose() }
    }
}


function Assert-PinnedSystemExecutable {
    param(
        [Parameter(Mandatory)][string]$LiteralPath,
        [Parameter(Mandatory)][string]$ExpectedThumbprint
    )
    $item = Get-Item -Force -LiteralPath $LiteralPath
    if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw "Pinned Python is a reparse point: $LiteralPath"
    }
    $signature = Get-AuthenticodeSignature -LiteralPath $LiteralPath
    if ($signature.Status -ne [System.Management.Automation.SignatureStatus]::Valid -or
        $null -eq $signature.SignerCertificate -or
        $signature.SignerCertificate.Thumbprint -cne $ExpectedThumbprint) {
        throw "Pinned executable signer mismatch: $LiteralPath"
    }
    $acl = Get-Acl -LiteralPath $LiteralPath
    $ownerSid = ([System.Security.Principal.NTAccount]$acl.Owner).Translate(
        [System.Security.Principal.SecurityIdentifier]
    ).Value
    $systemWriterSids = @('S-1-5-18', 'S-1-5-32-544')
    if ($systemWriterSids -notcontains $ownerSid) {
        throw "Pinned executable owner is not SYSTEM or Administrators: $LiteralPath"
    }
    $writeMask = [System.Security.AccessControl.FileSystemRights]::WriteData -bor
        [System.Security.AccessControl.FileSystemRights]::AppendData -bor
        [System.Security.AccessControl.FileSystemRights]::WriteAttributes -bor
        [System.Security.AccessControl.FileSystemRights]::WriteExtendedAttributes -bor
        [System.Security.AccessControl.FileSystemRights]::Delete -bor
        [System.Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles -bor
        [System.Security.AccessControl.FileSystemRights]::ChangePermissions -bor
        [System.Security.AccessControl.FileSystemRights]::TakeOwnership
    foreach ($rule in $acl.Access) {
        $overlap = $rule.FileSystemRights -band $writeMask
        try {
            $ruleSid = $rule.IdentityReference.Translate(
                [System.Security.Principal.SecurityIdentifier]
            ).Value
        }
        catch {
            if ($overlap -ne 0) {
                throw "Unresolvable identity has write-like rights on pinned executable: $LiteralPath"
            }
            continue
        }
        if (
            $rule.AccessControlType -eq [System.Security.AccessControl.AccessControlType]::Allow -and
            $overlap -ne 0 -and
            $systemWriterSids -notcontains $ruleSid
        ) {
            throw "Non-system SID $ruleSid can modify pinned executable: $LiteralPath"
        }
    }
}

function Assert-SystemProtectedProgramData {
    $programData = 'C:\ProgramData'
    $item = Get-Item -Force -LiteralPath $programData
    if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw 'C:\ProgramData unexpectedly resolves through a reparse point.'
    }
    $acl = Get-Acl -LiteralPath $programData
    $ownerSid = ([System.Security.Principal.NTAccount]$acl.Owner).Translate(
        [System.Security.Principal.SecurityIdentifier]
    ).Value
    $systemWriterSids = @('S-1-5-18', 'S-1-5-32-544')
    if ($systemWriterSids -notcontains $ownerSid) {
        throw 'C:\ProgramData is not owned by SYSTEM or Administrators.'
    }
    $parentReplacementMask = [System.Security.AccessControl.FileSystemRights]::Delete -bor
        [System.Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles -bor
        [System.Security.AccessControl.FileSystemRights]::ChangePermissions -bor
        [System.Security.AccessControl.FileSystemRights]::TakeOwnership
    foreach ($rule in $acl.Access) {
        if ($rule.AccessControlType -ne [System.Security.AccessControl.AccessControlType]::Allow -or
            ($rule.FileSystemRights -band $parentReplacementMask) -eq 0) { continue }
        try {
            $ruleSid = $rule.IdentityReference.Translate(
                [System.Security.Principal.SecurityIdentifier]
            ).Value
        }
        catch { throw 'An unresolvable identity has parent-replacement rights on C:\ProgramData.' }
        if ($systemWriterSids -notcontains $ruleSid) {
            throw "Non-system SID $ruleSid has parent-replacement rights on C:\ProgramData."
        }
    }
}

function Assert-TrustedRuntimeAcl {
    param([Parameter(Mandatory)][string[]]$LiteralPaths)
    $currentIdentity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
    if ($currentIdentity.User.Value -cne $fixedOwnerSidValue) {
        throw 'The approval broker identity is not the immutable owner SID.'
    }
    $currentSid = $fixedOwnerSidValue
    $trustedWriterSids = @($currentSid, 'S-1-5-18', 'S-1-5-32-544')
    $currentGroups = @($currentIdentity.Groups | ForEach-Object { $_.Value })
    $sandboxSid = ([System.Security.Principal.NTAccount]::new(
        [Environment]::MachineName + '\CodexSandboxUsers'
    )).Translate([System.Security.Principal.SecurityIdentifier]).Value
    if ($currentGroups -contains $sandboxSid) {
        throw 'The approval broker owner identity is a CodexSandboxUsers member; trust separation is absent.'
    }
    $writeMask = [System.Security.AccessControl.FileSystemRights]::WriteData -bor
        [System.Security.AccessControl.FileSystemRights]::AppendData -bor
        [System.Security.AccessControl.FileSystemRights]::WriteAttributes -bor
        [System.Security.AccessControl.FileSystemRights]::WriteExtendedAttributes -bor
        [System.Security.AccessControl.FileSystemRights]::Delete -bor
        [System.Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles -bor
        [System.Security.AccessControl.FileSystemRights]::ChangePermissions -bor
        [System.Security.AccessControl.FileSystemRights]::TakeOwnership
    $readMask = [System.Security.AccessControl.FileSystemRights]::ReadAndExecute -bor
        [System.Security.AccessControl.FileSystemRights]::Synchronize
    foreach ($literalPath in $LiteralPaths) {
        $item = Get-Item -Force -LiteralPath $literalPath
        if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw "Trusted runtime path is a reparse point: $literalPath"
        }
        $acl = Get-Acl -LiteralPath $literalPath
        if (-not $acl.AreAccessRulesProtected) {
            throw "Trusted runtime ACL inherits from its parent: $literalPath"
        }
        $ownerSid = ([System.Security.Principal.NTAccount]$acl.Owner).Translate(
            [System.Security.Principal.SecurityIdentifier]
        ).Value
        if ($ownerSid -cne $currentSid) {
            throw "Trusted runtime owner is not the current owner account: $literalPath"
        }

        $sandboxDenied = [System.Security.AccessControl.FileSystemRights]0
        $sandboxAllowed = [System.Security.AccessControl.FileSystemRights]0
        foreach ($rule in $acl.Access) {
            try {
                $ruleSid = $rule.IdentityReference.Translate(
                    [System.Security.Principal.SecurityIdentifier]
                ).Value
            }
            catch {
                if ($rule.FileSystemRights -ne 0) {
                    throw "Unresolvable identity has access rights on trusted runtime path: $literalPath"
                }
                continue
            }
            if ($rule.AccessControlType -eq [System.Security.AccessControl.AccessControlType]::Allow) {
                if ($ruleSid -ceq $sandboxSid) {
                    if (($rule.FileSystemRights -band (-bnot $readMask)) -ne 0) {
                        throw "CodexSandboxUsers has non-read access on trusted runtime path: $literalPath"
                    }
                    $sandboxAllowed = $sandboxAllowed -bor ($rule.FileSystemRights -band $readMask)
                }
                elseif ($trustedWriterSids -notcontains $ruleSid -and $rule.FileSystemRights -ne 0) {
                    throw "Trusted runtime grants access rights to untrusted SID $ruleSid on $literalPath"
                }
            }
            if (
                $rule.AccessControlType -eq [System.Security.AccessControl.AccessControlType]::Deny -and
                $rule.FileSystemRights -ne 0 -and
                ($ruleSid -ceq $currentSid -or $currentGroups -contains $ruleSid)
            ) {
                throw "The owner process is subject to an access denial on $literalPath"
            }
            if (
                $ruleSid -ceq $sandboxSid -and
                $rule.AccessControlType -eq [System.Security.AccessControl.AccessControlType]::Deny -and
                -not $rule.IsInherited
            ) {
                $sandboxDenied = $sandboxDenied -bor ($rule.FileSystemRights -band $writeMask)
            }
        }
        if (($sandboxDenied -band $writeMask) -ne $writeMask) {
            throw "CodexSandboxUsers lacks the complete explicit write denial on $literalPath"
        }
        if (($sandboxAllowed -band [System.Security.AccessControl.FileSystemRights]::ReadAndExecute) -ne
            [System.Security.AccessControl.FileSystemRights]::ReadAndExecute) {
            throw "CodexSandboxUsers lacks explicit read/execute access on $literalPath"
        }
    }
}

function Assert-ProtectedSecretAcl {
    param(
        [Parameter(Mandatory)][string[]]$LiteralPaths,
        [System.IO.FileStream]$PinnedFileStream
    )
    if ($null -ne $PinnedFileStream -and $LiteralPaths.Count -ne 1) {
        throw 'A pinned secret stream must bind exactly one protected path.'
    }
    $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
    if ($identity.User.Value -cne $fixedOwnerSidValue) {
        throw 'The approval broker identity is not the immutable owner SID.'
    }
    $trustedReaderSids = @($fixedOwnerSidValue, 'S-1-5-18', 'S-1-5-32-544')
    $currentGroups = @($identity.Groups | ForEach-Object { $_.Value })
    $sandboxSid = ([System.Security.Principal.NTAccount]::new(
        [Environment]::MachineName + '\CodexSandboxUsers'
    )).Translate([System.Security.Principal.SecurityIdentifier]).Value
    $sensitiveMask = [System.Security.AccessControl.FileSystemRights]::FullControl
    foreach ($literalPath in $LiteralPaths) {
        $item = Get-Item -Force -LiteralPath $literalPath
        if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw "Protected secret path is a reparse point: $literalPath"
        }
        $acl = if ($null -ne $PinnedFileStream) {
            if ($PinnedFileStream.SafeFileHandle.IsInvalid -or $PinnedFileStream.SafeFileHandle.IsClosed -or
                [System.IO.Path]::GetFullPath($PinnedFileStream.Name) -cne
                    [System.IO.Path]::GetFullPath($literalPath)) {
                throw "Pinned protected secret stream does not bind the expected path: $literalPath"
            }
            [System.IO.FileSystemAclExtensions]::GetAccessControl($PinnedFileStream)
        }
        else {
            Get-Acl -LiteralPath $literalPath
        }
        if (-not $acl.AreAccessRulesProtected) {
            throw "Protected secret ACL inherits from its parent: $literalPath"
        }
        $ownerSid = ([System.Security.Principal.NTAccount]$acl.Owner).Translate(
            [System.Security.Principal.SecurityIdentifier]
        ).Value
        if ($ownerSid -cne $fixedOwnerSidValue) {
            throw "Protected secret owner is not the immutable owner SID: $literalPath"
        }
        $sandboxDenied = [System.Security.AccessControl.FileSystemRights]0
        foreach ($rule in $acl.Access) {
            $overlap = $rule.FileSystemRights -band $sensitiveMask
            try {
                $ruleSid = $rule.IdentityReference.Translate(
                    [System.Security.Principal.SecurityIdentifier]
                ).Value
            }
            catch {
                if ($overlap -ne 0) {
                    throw "Unresolvable identity can access protected secret path: $literalPath"
                }
                continue
            }
            if ($rule.AccessControlType -eq [System.Security.AccessControl.AccessControlType]::Allow -and
                $overlap -ne 0 -and $trustedReaderSids -notcontains $ruleSid) {
                throw "Untrusted SID $ruleSid can access protected secret path: $literalPath"
            }
            if ($rule.AccessControlType -eq [System.Security.AccessControl.AccessControlType]::Deny -and
                $overlap -ne 0 -and
                ($ruleSid -ceq $fixedOwnerSidValue -or $currentGroups -contains $ruleSid)) {
                throw "The owner process is subject to a denial on protected secret path: $literalPath"
            }
            if ($ruleSid -ceq $sandboxSid -and
                $rule.AccessControlType -eq [System.Security.AccessControl.AccessControlType]::Deny -and
                -not $rule.IsInherited) {
                $sandboxDenied = $sandboxDenied -bor $overlap
            }
        }
        if (($sandboxDenied -band $sensitiveMask) -ne $sensitiveMask) {
            throw "CodexSandboxUsers lacks an explicit complete denial on protected secret path: $literalPath"
        }
    }
}

function Open-ProtectedAdminTokenStream {
    Assert-ProtectedSecretAcl -LiteralPaths @($secretRoot, $protectionAdminTokenPath)
    $parentPath = [System.IO.Path]::GetFullPath((Split-Path -Parent $protectionAdminTokenPath)).TrimEnd('\')
    if ($parentPath -cne [System.IO.Path]::GetFullPath($secretRoot).TrimEnd('\')) {
        throw 'Branch-protection credential is outside its fixed owner-only parent.'
    }
    $item = Get-Item -Force -LiteralPath $protectionAdminTokenPath
    if ($item.PSIsContainer -or ($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw 'Branch-protection credential is not a regular non-reparse file.'
    }
    return [System.IO.FileStream]::new(
        $protectionAdminTokenPath,
        [System.IO.FileMode]::Open,
        [System.IO.FileAccess]::Read,
        [System.IO.FileShare]::None
    )
}

function Open-ProtectedReviewerTokenStream {
    $fullPath = Assert-WrapperBootstrapPath -LiteralPath $reviewerTokenEnvPath -LeafMustBeFile
    if ($fullPath -cne $reviewerTokenEnvPath) {
        throw 'The counted-reviewer credential path differs from the fixed owner-authorized path.'
    }
    $stream = [System.IO.FileStream]::new(
        $fullPath,
        [System.IO.FileMode]::Open,
        [System.IO.FileAccess]::Read,
        [System.IO.FileShare]::None
    )
    try {
        Assert-ProtectedSecretAcl -LiteralPaths @($fullPath) -PinnedFileStream $stream
        $postOpenPath = Assert-WrapperBootstrapPath -LiteralPath $reviewerTokenEnvPath -LeafMustBeFile
        if ($postOpenPath -cne $fullPath) {
            throw 'The counted-reviewer credential path moved after its handle was opened.'
        }
        $item = Get-Item -Force -LiteralPath $fullPath
        if ($item.PSIsContainer -or ($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw 'The counted-reviewer credential is not a regular non-reparse file.'
        }
        if ($stream.Length -lt 1 -or $stream.Length -gt 16384) {
            throw 'The counted-reviewer credential file is empty or oversized.'
        }
        return $stream
    }
    catch {
        $stream.Dispose()
        throw
    }
}

function Read-ReviewerTokenFromEnvStream {
    param([Parameter(Mandatory)][System.IO.Stream]$Stream)
    if (-not $Stream.CanRead -or -not $Stream.CanSeek) {
        throw 'The counted-reviewer credential stream is not readable and seekable.'
    }
    if ($Stream.Length -lt 1 -or $Stream.Length -gt 16384) {
        throw 'The counted-reviewer credential file is empty or oversized.'
    }
    $Stream.Position = 0
    $strictUtf8 = [System.Text.UTF8Encoding]::new($false, $true)
    $reader = [System.IO.StreamReader]::new($Stream, $strictUtf8, $false, 1024, $true)
    try {
        $text = $reader.ReadToEnd()
    }
    finally {
        $reader.Dispose()
    }

    if ($text.Length -gt 0 -and $text[0] -eq [char]0xFEFF) {
        $text = $text.Substring(1)
    }
    $token = $null
    $assignmentCount = 0
    foreach ($line in [regex]::Split($text, '\r\n|\n|\r')) {
        $trimmed = $line.Trim()
        if ($trimmed.Length -eq 0 -or $trimmed.StartsWith('#', [StringComparison]::Ordinal)) {
            continue
        }
        if ($line -cnotmatch '^\s*(?:export\s+)?BLIP_GITHUB_TOKEN\s*=\s*(.*?)\s*$') {
            throw 'The counted-reviewer credential file contains an unsupported assignment.'
        }
        $assignmentCount += 1
        if ($assignmentCount -ne 1) {
            throw 'The counted-reviewer credential file contains duplicate BLIP_GITHUB_TOKEN assignments.'
        }
        $rawValue = $Matches[1].Trim()
        if ($rawValue.Length -ge 2 -and
            (($rawValue[0] -ceq '"' -and $rawValue[$rawValue.Length - 1] -ceq '"') -or
             ($rawValue[0] -ceq "'" -and $rawValue[$rawValue.Length - 1] -ceq "'"))) {
            $rawValue = $rawValue.Substring(1, $rawValue.Length - 2)
        }
        elseif (($rawValue.StartsWith('"', [StringComparison]::Ordinal) -or
                 $rawValue.StartsWith("'", [StringComparison]::Ordinal) -or
                 $rawValue.EndsWith('"', [StringComparison]::Ordinal) -or
                 $rawValue.EndsWith("'", [StringComparison]::Ordinal))) {
            throw 'The counted-reviewer credential value has mismatched quotes.'
        }
        $token = $rawValue
    }
    $text = $null
    $rawValue = $null
    if ($assignmentCount -ne 1 -or [string]::IsNullOrWhiteSpace($token)) {
        throw 'The counted-reviewer credential file must contain exactly one BLIP_GITHUB_TOKEN assignment.'
    }
    if ($token.Length -lt 32 -or $token.Length -gt 4096 -or $token -notmatch '^[A-Za-z0-9_]+$') {
        throw 'The counted-reviewer credential is malformed or outside the permitted size.'
    }
    return $token
}

function Write-CanonicalJsonElement {
    param(
        [Parameter(Mandatory)][System.Text.Json.JsonElement]$Element,
        [Parameter(Mandatory)][System.Text.Json.Utf8JsonWriter]$Writer
    )
    switch ($Element.ValueKind) {
        ([System.Text.Json.JsonValueKind]::Object) {
            $Writer.WriteStartObject()
            $properties = [System.Collections.Generic.List[System.Text.Json.JsonProperty]]::new()
            $seen = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
            foreach ($property in $Element.EnumerateObject()) {
                if (-not $seen.Add($property.Name)) {
                    throw "GitHub policy JSON contains duplicate property: $($property.Name)"
                }
                $properties.Add($property)
            }
            $properties.Sort([System.Comparison[System.Text.Json.JsonProperty]]{
                param($left, $right)
                return [StringComparer]::Ordinal.Compare($left.Name, $right.Name)
            })
            foreach ($property in $properties) {
                $Writer.WritePropertyName($property.Name)
                Write-CanonicalJsonElement -Element $property.Value -Writer $Writer
            }
            $Writer.WriteEndObject()
        }
        ([System.Text.Json.JsonValueKind]::Array) {
            $Writer.WriteStartArray()
            foreach ($entry in $Element.EnumerateArray()) {
                Write-CanonicalJsonElement -Element $entry -Writer $Writer
            }
            $Writer.WriteEndArray()
        }
        ([System.Text.Json.JsonValueKind]::String) { $Writer.WriteStringValue($Element.GetString()) }
        ([System.Text.Json.JsonValueKind]::Number) { $Writer.WriteRawValue($Element.GetRawText(), $true) }
        ([System.Text.Json.JsonValueKind]::True) { $Writer.WriteBooleanValue($true) }
        ([System.Text.Json.JsonValueKind]::False) { $Writer.WriteBooleanValue($false) }
        ([System.Text.Json.JsonValueKind]::Null) { $Writer.WriteNullValue() }
        default { throw 'GitHub policy JSON contains an unsupported value kind.' }
    }
}

function ConvertTo-CanonicalProtectionSnapshot {
    param(
        [Parameter(Mandatory)][string]$ActiveRulesText,
        [Parameter(Mandatory)][string]$ProtectionText
    )
    if ($ActiveRulesText.Length -gt 262144 -or $ProtectionText.Length -gt 262144) {
        throw 'GitHub branch-protection response exceeds the protected size limit.'
    }
    $options = [System.Text.Json.JsonDocumentOptions]::new()
    $options.AllowTrailingCommas = $false
    $options.CommentHandling = [System.Text.Json.JsonCommentHandling]::Disallow
    $options.MaxDepth = 128
    $rulesDocument = [System.Text.Json.JsonDocument]::Parse($ActiveRulesText, $options)
    $protectionDocument = [System.Text.Json.JsonDocument]::Parse($ProtectionText, $options)
    $stream = [System.IO.MemoryStream]::new()
    $writerOptions = [System.Text.Json.JsonWriterOptions]::new()
    $writerOptions.Indented = $false
    $writerOptions.SkipValidation = $false
    $writer = [System.Text.Json.Utf8JsonWriter]::new($stream, $writerOptions)
    try {
        if ($rulesDocument.RootElement.ValueKind -ne [System.Text.Json.JsonValueKind]::Array -or
            $rulesDocument.RootElement.GetArrayLength() -ne 0) {
            throw 'Active rulesets are present or malformed; only verified legacy protection is supported.'
        }
        if ($protectionDocument.RootElement.ValueKind -ne [System.Text.Json.JsonValueKind]::Object) {
            throw 'GitHub branch-protection payload is malformed.'
        }
        $writer.WriteStartObject()
        $writer.WritePropertyName('active_rules')
        Write-CanonicalJsonElement -Element $rulesDocument.RootElement -Writer $writer
        $writer.WritePropertyName('protection')
        Write-CanonicalJsonElement -Element $protectionDocument.RootElement -Writer $writer
        $writer.WriteEndObject()
        $writer.Flush()
        $result = [System.Text.Encoding]::UTF8.GetString($stream.ToArray())
        if ($result.Length -gt 262144) {
            throw 'Canonical branch-protection snapshot exceeds the protected size limit.'
        }
        return $result
    }
    finally {
        $writer.Dispose()
        $stream.Dispose()
        $rulesDocument.Dispose()
        $protectionDocument.Dispose()
    }
}

function Invoke-ProtectedGitHubGet {
    param(
        [Parameter(Mandatory)][System.Net.Http.HttpClient]$Client,
        [Parameter(Mandatory)][string]$RelativePath
    )
    $request = [System.Net.Http.HttpRequestMessage]::new(
        [System.Net.Http.HttpMethod]::Get,
        "https://api.github.com$RelativePath"
    )
    try {
        $request.Headers.Authorization = [System.Net.Http.Headers.AuthenticationHeaderValue]::new(
            'Bearer', $protectionAdminToken
        )
        [void]$request.Headers.TryAddWithoutValidation('Accept', 'application/vnd.github+json')
        [void]$request.Headers.TryAddWithoutValidation('X-GitHub-Api-Version', '2022-11-28')
        [void]$request.Headers.TryAddWithoutValidation('User-Agent', 'blip-protected-approval-broker/1.0')
        $response = $Client.Send($request)
        try {
            if (-not $response.IsSuccessStatusCode) {
                throw "Protected GitHub policy read failed with HTTP $([int]$response.StatusCode)."
            }
            $length = $response.Content.Headers.ContentLength
            if ($null -ne $length -and $length -gt 262144) {
                throw 'Protected GitHub policy response exceeds the size limit.'
            }
            $text = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
            if ([string]::IsNullOrWhiteSpace($text) -or $text.Length -gt 262144) {
                throw 'Protected GitHub policy response is empty or oversized.'
            }
            return $text
        }
        finally { $response.Dispose() }
    }
    finally { $request.Dispose() }
}

function Get-LiveProtectionSnapshot {
    $handler = [System.Net.Http.HttpClientHandler]::new()
    $handler.AllowAutoRedirect = $false
    $client = [System.Net.Http.HttpClient]::new($handler, $true)
    $client.Timeout = [TimeSpan]::FromSeconds(60)
    try {
        $encodedBranch = [Uri]::EscapeDataString('main')
        $activeRules = Invoke-ProtectedGitHubGet -Client $client `
            -RelativePath "/repos/monkey1sai/AI-BIM-governance/rules/branches/$encodedBranch`?per_page=100"
        $protection = Invoke-ProtectedGitHubGet -Client $client `
            -RelativePath "/repos/monkey1sai/AI-BIM-governance/branches/$encodedBranch/protection"
        return ConvertTo-CanonicalProtectionSnapshot `
            -ActiveRulesText $activeRules -ProtectionText $protection
    }
    finally { $client.Dispose() }
}

function New-ApprovalCapability {
    param([Parameter(Mandatory)][string]$Token)
    $issuedAt = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
    $expiresAt = $issuedAt + 600
    $nonce = [Guid]::NewGuid().ToString('N').ToLowerInvariant()
    $payload = @(
        $capabilityVersion,
        'approve',
        $repository,
        [string]$PrNumber,
        $ExpectedBaseSha,
        $ExpectedHeadSha,
        $reviewer,
        $ReviewMode,
        ('human_critical_override=' + $HumanCriticalOverride.IsPresent.ToString().ToLowerInvariant()),
        [string]$issuedAt,
        [string]$expiresAt,
        $nonce
    ) -join "`n"
    $script:tokenBytes = [System.Text.Encoding]::UTF8.GetBytes($Token)
    $script:capabilityBytes = [System.Text.Encoding]::UTF8.GetBytes($payload)
    $hmac = [System.Security.Cryptography.HMACSHA256]::new($script:tokenBytes)
    try {
        $signature = [Convert]::ToHexString($hmac.ComputeHash($script:capabilityBytes)).ToLowerInvariant()
    }
    finally {
        $hmac.Dispose()
    }
    $encoded = [Convert]::ToBase64String($script:capabilityBytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
    $nonceHash = [System.Security.Cryptography.SHA256]::HashData([System.Text.Encoding]::UTF8.GetBytes($nonce))
    $script:capabilityId = [Convert]::ToHexString($nonceHash).Substring(0, 16).ToLowerInvariant()
    return "$encoded.$signature"
}

function Save-BrokerResult {
    param(
        [Parameter(Mandatory)][int]$ExitCode,
        [Parameter(Mandatory)][AllowEmptyString()][string]$StdOut,
        [Parameter(Mandatory)][AllowEmptyString()][string]$StdErr,
        [Parameter(Mandatory)][string]$Status
    )
    if (-not [string]::IsNullOrEmpty($script:plainToken)) {
        $StdOut = $StdOut.Replace($script:plainToken, '[REDACTED]')
        $StdErr = $StdErr.Replace($script:plainToken, '[REDACTED]')
    }
    if (-not [string]::IsNullOrEmpty($script:capability)) {
        $StdOut = $StdOut.Replace($script:capability, '[REDACTED-CAPABILITY]')
        $StdErr = $StdErr.Replace($script:capability, '[REDACTED-CAPABILITY]')
    }
    if (-not [string]::IsNullOrEmpty($script:protectionAdminToken)) {
        $StdOut = $StdOut.Replace($script:protectionAdminToken, '[REDACTED-PROTECTION-CREDENTIAL]')
        $StdErr = $StdErr.Replace($script:protectionAdminToken, '[REDACTED-PROTECTION-CREDENTIAL]')
    }
    $payload = [ordered]@{
        schema = 'blip-live-approve-broker-result/v2'
        repository = $repository
        pr_number = $PrNumber
        expected_base_sha = $ExpectedBaseSha
        expected_head_sha = $ExpectedHeadSha
        review_mode = $ReviewMode
        human_critical_override = $HumanCriticalOverride.IsPresent
        mode = 'automated_service_account_approval'
        mutation_requested = $true
        mutation_outcome = if ($null -ne $script:reviewId) {
            'approval_observed'
        }
        elseif ($script:childStarted) {
            'unknown'
        }
        else {
            'not_started'
        }
        auto_merge_allowed = $false
        capability_id = $script:capabilityId
        review_id = $script:reviewId
        review_url = $script:reviewUrl
        status = $Status
        exit_code = $ExitCode
        stdout = $StdOut
        stderr = $StdErr
        completed_at = [DateTimeOffset]::Now.ToString('o')
    } | ConvertTo-Json -Depth 4
    $resultStream = [System.IO.FileStream]::new(
        $resultPath,
        [System.IO.FileMode]::CreateNew,
        [System.IO.FileAccess]::Write,
        [System.IO.FileShare]::None
    )
    $writer = [System.IO.StreamWriter]::new($resultStream, [System.Text.UTF8Encoding]::new($false))
    try {
        $writer.Write($payload)
        $writer.Flush()
    }
    finally {
        $writer.Dispose()
    }
    $script:resultWritten = $true
}

try {
    Assert-SystemProtectedProgramData
    if ($ReviewMode -ceq 'human_critical') {
        if (-not $HumanCriticalOverride.IsPresent) {
            throw 'human_critical review mode requires -HumanCriticalOverride from an explicit owner authorization.'
        }
    }
    elseif ($HumanCriticalOverride.IsPresent) {
        throw '-HumanCriticalOverride is forbidden for machine review modes.'
    }
    $hostPath = [System.IO.Path]::GetFullPath([Environment]::ProcessPath)
    if ($hostPath -cne $powerShellPath) {
        throw "Protected approval broker must run with the fixed PowerShell host: $powerShellPath"
    }
    if ([System.IO.Path]::GetFullPath($trustedRoot).TrimEnd('\') -cne $expectedTrustedRoot) {
        throw "Protected approval broker must run from the fixed installed runtime: $expectedTrustedRoot"
    }
    if ((Get-Item -LiteralPath $powerShellPath).VersionInfo.FileVersion -cne '7.5.4.500') {
        throw 'Protected PowerShell host version differs from the reviewed runtime.'
    }
    foreach ($requiredPath in @(
        $powerShellPath, $pythonPath, $helperPath, $authHelperPath, $packetModulePath,
        $manifestPath, $completionPath, $brokerPath
    )) {
        if (-not (Test-Path -LiteralPath $requiredPath -PathType Leaf)) {
            throw "Trusted runtime file is unavailable: $requiredPath"
        }
    }
    if (-not (Test-Path -LiteralPath $secretRoot -PathType Container)) {
        throw "Owner-only secret root is unavailable: $secretRoot"
    }
    if (-not (Test-Path -LiteralPath $protectionAdminTokenPath -PathType Leaf)) {
        throw "Read-only branch-protection credential is unavailable: $protectionAdminTokenPath"
    }
    if (-not (Test-Path -LiteralPath $reviewerTokenEnvPath -PathType Leaf)) {
        throw "Fixed counted-reviewer credential file is unavailable: $reviewerTokenEnvPath"
    }
    Assert-TrustedRuntimeAcl -LiteralPaths @(
        $protectedRoot, $productRoot, $trustedRoot, $stateRoot, $appScriptsRoot,
        $brokerPath, $helperPath, $authHelperPath,
        $packetModulePath,
        $manifestPath, $completionPath
    )
    Assert-PinnedSystemExecutable -LiteralPath $powerShellPath `
        -ExpectedThumbprint '3F56A45111684D454E231CFDC4DA5C8D370F9816'
    Assert-PinnedSystemExecutable -LiteralPath $pythonPath `
        -ExpectedThumbprint '36168EE17C1A240517388540C903BB6717DD2563'
    $metadata = ConvertFrom-StrictRuntimeMetadata `
        -ManifestText (Get-Content -Raw -LiteralPath $manifestPath) `
        -CompletionText (Get-Content -Raw -LiteralPath $completionPath) `
        -ExpectedFileNames $expectedManifestFileNames `
        -ExpectedRuntimeNames $expectedManifestRuntimeNames
    $manifest = $metadata.Manifest
    $completion = $metadata.Completion
    if ([string]$manifest.source_commit -ceq $ExpectedHeadSha) {
        throw 'A protected runtime cannot approve the PR head that introduced its own source.'
    }
    $manifestHash = Get-FileSha256 -LiteralPath $manifestPath
    if ($completion.schema -cne 'blip-trusted-runtime-complete/v1' -or
        [string]$completion.owner_sid -cne $fixedOwnerSidValue -or
        [string]$completion.candidate_freeze_sha256 -notmatch '^[0-9A-F]{64}$' -or
        [string]$completion.candidate_freeze_sha256 -cne
            [string]$manifest.candidate_freeze_sha256 -or
        [string]$completion.manifest_sha256 -cne $manifestHash) {
        throw 'Trusted runtime completion marker does not bind the installed manifest.'
    }
    foreach ($name in @('run_blip_live_approve_once.ps1', 'blip_review.py', 'app_auth.py')) {
        $entry = $manifest.files.PSObject.Properties[$name]
        if ($null -eq $entry -or [string]$entry.Value -notmatch '^[0-9A-F]{64}$') {
            throw "Trusted runtime manifest has no valid hash for $name."
        }
    }
    $pythonEntry = $manifest.runtime.PSObject.Properties['runtime/python.exe']
    if ($null -eq $pythonEntry -or [string]$pythonEntry.Value -notmatch '^[0-9A-F]{64}$') {
        throw 'Trusted runtime manifest has no valid Python hash.'
    }
    $powerShellEntry = $manifest.runtime.PSObject.Properties['runtime/pwsh.exe']
    if ($null -eq $powerShellEntry -or [string]$powerShellEntry.Value -notmatch '^[0-9A-F]{64}$') {
        throw 'Trusted runtime manifest has no valid PowerShell hash.'
    }
    foreach ($entry in $trustedPowerShellInputs.GetEnumerator()) {
        $manifestEntry = $manifest.runtime.PSObject.Properties[$entry.Key]
        if ($null -eq $manifestEntry -or
            [string]$manifestEntry.Value -cne $entry.Value.Sha256) {
            throw "Trusted runtime manifest does not bind PowerShell dependency: $($entry.Key)"
        }
    }
    if ((Get-FileSha256 -LiteralPath $brokerPath) -cne [string]$manifest.files.'run_blip_live_approve_once.ps1') {
        throw 'Trusted broker hash does not match the owner-controlled manifest.'
    }

    $helperStream = [System.IO.FileStream]::new(
        $helperPath, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::Read
    )
    $authHelperStream = [System.IO.FileStream]::new(
        $authHelperPath, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::Read
    )
    $packetModuleStream = [System.IO.FileStream]::new(
        $packetModulePath, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::Read
    )
    $pythonStream = [System.IO.FileStream]::new(
        $pythonPath, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::Read
    )
    $powerShellStream = [System.IO.FileStream]::new(
        $powerShellPath, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::Read
    )
    if ((Get-OpenStreamSha256 -Stream $helperStream) -cne [string]$manifest.files.'blip_review.py') {
        throw 'Trusted approval helper hash does not match the manifest.'
    }
    if ((Get-OpenStreamSha256 -Stream $authHelperStream) -cne [string]$manifest.files.'app_auth.py') {
        throw 'Trusted auth helper hash does not match the manifest.'
    }
    if ((Get-OpenStreamSha256 -Stream $packetModuleStream) -cne [string]$manifest.files.'app-scripts/ship_gate_packet.py') {
        throw 'Trusted immutable packet helper hash does not match the manifest.'
    }
    if ((Get-OpenStreamSha256 -Stream $pythonStream) -cne [string]$pythonEntry.Value) {
        throw 'Pinned Python hash does not match the manifest.'
    }
    if ((Get-OpenStreamSha256 -Stream $powerShellStream) -cne [string]$powerShellEntry.Value) {
        throw 'Pinned PowerShell hash does not match the manifest.'
    }

    $lockStream = [System.IO.FileStream]::new(
        $lockPath, [System.IO.FileMode]::OpenOrCreate, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None
    )
    if (Test-Path -LiteralPath $resultPath) { throw 'The one-shot result path already exists.' }

    Write-Information "PR #$PrNumber automatic approval broker" -InformationAction Continue
    Write-Information "Exact tuple: base=$($ExpectedBaseSha.Substring(0,7)) head=$($ExpectedHeadSha.Substring(0,7)) mode=$ReviewMode human_critical_override=$($HumanCriticalOverride.IsPresent.ToString().ToLowerInvariant())" -InformationAction Continue
    Write-Information 'This can submit one counted APPROVED review; it refuses auto-merge and never merges.' -InformationAction Continue
    $protectionAdminTokenStream = Open-ProtectedAdminTokenStream
    $reviewerTokenStream = Open-ProtectedReviewerTokenStream
    $plainToken = Read-ReviewerTokenFromEnvStream -Stream $reviewerTokenStream
    Write-Information 'Loaded the fixed User PAT from the owner-only protected .env.blip credential file.' -InformationAction Continue
    $capability = New-ApprovalCapability -Token $plainToken
    $strictUtf8 = [System.Text.UTF8Encoding]::new($false, $true)
    $protectionAdminTokenReader = [System.IO.StreamReader]::new(
        $protectionAdminTokenStream, $strictUtf8, $false, 1024, $true
    )
    $protectionAdminToken = $protectionAdminTokenReader.ReadToEnd().Trim()
    if ($protectionAdminToken.Length -lt 32 -or $protectionAdminToken.Length -gt 4096 -or
        $protectionAdminToken -notmatch '^[!-~]+$') {
        throw 'Read-only branch-protection credential is empty, malformed, or oversized.'
    }
    $protectionAdminTokenBytes = [System.Text.Encoding]::UTF8.GetBytes($protectionAdminToken)
    if ($tokenBytes.Length -eq $protectionAdminTokenBytes.Length -and
        [System.Security.Cryptography.CryptographicOperations]::FixedTimeEquals(
            $tokenBytes, $protectionAdminTokenBytes
    )) {
        throw 'The read-only branch-protection credential must differ from the counted-reviewer PAT.'
    }
    $protectionPolicyJson = Get-LiveProtectionSnapshot

    $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
    $startInfo.FileName = $pythonPath
    $startInfo.WorkingDirectory = $trustedRoot
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $childArguments = @(
        '-I', '-S', '-B', '-c', $pythonBootstrap, $helperPath, $authHelperPath, $packetModulePath,
        '--pr', [string]$PrNumber,
        '--expected-base', $ExpectedBaseSha,
        '--expected-head', $ExpectedHeadSha,
        '--review-mode', $ReviewMode
    )
    if ($HumanCriticalOverride.IsPresent) { $childArguments += '--human-critical-override' }
    $childArguments += @('--approve', '--live')
    foreach ($argument in $childArguments) {
        [void]$startInfo.ArgumentList.Add($argument)
    }
    $preservedEnvironment = [ordered]@{}
    foreach ($ambientName in @('SystemRoot', 'WINDIR', 'TEMP', 'TMP')) {
        $ambientValue = [Environment]::GetEnvironmentVariable($ambientName, 'Process')
        if (-not [string]::IsNullOrWhiteSpace($ambientValue)) { $preservedEnvironment[$ambientName] = $ambientValue }
    }
    $startInfo.Environment.Clear()
    foreach ($entry in $preservedEnvironment.GetEnumerator()) { $startInfo.Environment[$entry.Key] = $entry.Value }
    $startInfo.Environment[$tokenEnvironmentName] = $plainToken
    $startInfo.Environment[$capabilityEnvironmentName] = $capability
    $startInfo.Environment[$protectionPolicyEnvironmentName] = $protectionPolicyJson

    $childProcess = [System.Diagnostics.Process]::new()
    $childProcess.StartInfo = $startInfo
    if (-not $childProcess.Start()) { throw 'Failed to start the pinned approval child process.' }
    $childStarted = $true
    $stdoutTask = $childProcess.StandardOutput.ReadToEndAsync()
    $stderrTask = $childProcess.StandardError.ReadToEndAsync()
    if (-not $childProcess.WaitForExit(600000)) {
        $childProcess.Kill($true)
        $childProcess.WaitForExit()
        $childTimedOut = $true
    }
    $stdout = $stdoutTask.GetAwaiter().GetResult()
    $stderr = $stderrTask.GetAwaiter().GetResult()
    if ($childTimedOut) {
        $brokerExitCode = 1
        $stderr = $stderr + "`nThe approval run exceeded the 10-minute capability lifetime and broker timeout."
    }
    else {
        $brokerExitCode = $childProcess.ExitCode
    }
    try {
        $postProtectionPolicyJson = Get-LiveProtectionSnapshot
        if ($postProtectionPolicyJson -cne $protectionPolicyJson) {
            $brokerExitCode = 1
            $stderr = $stderr + "`nFull branch-protection policy drifted during the approval operation."
        }
    }
    catch {
        $brokerExitCode = 1
        $stderr = $stderr + "`nPost-approval full branch-protection verification failed closed: " + $_.Exception.Message
    }
    $marker = [regex]::Match(
        $stdout,
        '(?m)^\[blip\] APPROVAL_RESULT review_id=(\d+) state=APPROVED head=([0-9a-f]{40}) url=(https://github\.com/monkey1sai/AI-BIM-governance/pull/' +
        [regex]::Escape([string]$PrNumber) + '#pullrequestreview-\d+) automated=true\s*$'
    )
    if ($brokerExitCode -eq 0 -and -not $marker.Success) {
        $brokerExitCode = 1
        $stderr = $stderr + "`nPinned helper exited 0 without the required validated APPROVAL_RESULT marker."
    }
    if ($marker.Success -and $marker.Groups[2].Value -cne $ExpectedHeadSha) {
        $brokerExitCode = 1
        $stderr = $stderr + "`nApproval result head does not match the authorized exact head."
    }
    $approvalObserved = $marker.Success -and $marker.Groups[2].Value -ceq $ExpectedHeadSha
    if ($approvalObserved) {
        $reviewId = [Int64]$marker.Groups[1].Value
        $reviewUrl = $marker.Groups[3].Value
    }
    $status = if ($brokerExitCode -eq 0) {
        'approve_succeeded'
    }
    elseif ($approvalObserved) {
        'approval_posted_post_verification_failed'
    }
    else {
        'approve_failed'
    }
    Save-BrokerResult -ExitCode $brokerExitCode -StdOut $stdout -StdErr $stderr -Status $status
    if ($brokerExitCode -eq 0) {
        Write-Information "Live approval submitted and read back: review_id=$reviewId" -InformationAction Continue
    }
    else {
        Write-Information 'Live approval failed closed. Do not retry the same capability.' -InformationAction Continue
    }
    Write-Information "Result: $resultPath" -InformationAction Continue
}
catch {
    $message = $_.Exception.Message
    if (-not [string]::IsNullOrEmpty($plainToken)) { $message = $message.Replace($plainToken, '[REDACTED]') }
    if (-not [string]::IsNullOrEmpty($capability)) { $message = $message.Replace($capability, '[REDACTED-CAPABILITY]') }
    if (-not [string]::IsNullOrEmpty($protectionAdminToken)) {
        $message = $message.Replace($protectionAdminToken, '[REDACTED-PROTECTION-CREDENTIAL]')
    }
    if (-not $resultWritten -and (Test-Path -LiteralPath $stateRoot)) {
        try { Save-BrokerResult -ExitCode 1 -StdOut '' -StdErr $message -Status 'broker_failed' } catch { }
    }
    Write-Information "Broker failed closed: $message" -InformationAction Continue
    if (Test-Path -LiteralPath $stateRoot) { Write-Information "Result: $resultPath" -InformationAction Continue }
    $brokerExitCode = 1
}
finally {
    if ($null -ne $childProcess) {
        if ($childStarted -and -not $childProcess.HasExited) {
            try { $childProcess.Kill($true); $childProcess.WaitForExit() } catch { }
        }
        $childProcess.Dispose()
    }
    if ($null -ne $authHelperStream) { $authHelperStream.Dispose() }
    if ($null -ne $packetModuleStream) { $packetModuleStream.Dispose() }
    if ($null -ne $powerShellStream) { $powerShellStream.Dispose() }
    if ($null -ne $pythonStream) { $pythonStream.Dispose() }
    if ($null -ne $helperStream) { $helperStream.Dispose() }
    if ($null -ne $lockStream) { $lockStream.Dispose() }
    if ($null -ne $protectionAdminTokenReader) { $protectionAdminTokenReader.Dispose() }
    if ($null -ne $protectionAdminTokenStream) { $protectionAdminTokenStream.Dispose() }
    if ($null -ne $reviewerTokenStream) { $reviewerTokenStream.Dispose() }
    if ($null -ne $tokenBytes) { [Array]::Clear($tokenBytes, 0, $tokenBytes.Length) }
    if ($null -ne $capabilityBytes) { [Array]::Clear($capabilityBytes, 0, $capabilityBytes.Length) }
    if ($null -ne $protectionAdminTokenBytes) {
        [System.Security.Cryptography.CryptographicOperations]::ZeroMemory($protectionAdminTokenBytes)
    }
    $plainToken = $null
    $capability = $null
    $protectionPolicyJson = $null
    $protectionAdminToken = $null
    foreach ($stream in $trustedPowerShellInputStreams) { try { $stream.Dispose() } catch { } }
}

exit $brokerExitCode
