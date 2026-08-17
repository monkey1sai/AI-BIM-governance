# Run one protected Codex App ship gate and, only on SHIP, append a canonical
# base/head/mode/changed-files attestation before posting the App COMMENT.
[CmdletBinding(DefaultParameterSetName = 'Review')]
param(
    [Parameter(Mandatory, ParameterSetName = 'Review')]
    [ValidateRange(1, 999999)]
    [int]$PrNumber,

    [Parameter(ParameterSetName = 'Review')]
    [switch]$Live,

    [Parameter(Mandatory, ParameterSetName = 'TokenHealth')]
    [switch]$TokenHealth,

    [Parameter(ParameterSetName = 'Review')]
    [ValidateRange(60, 300)]
    [int]$AgentTimeoutSec = 300,

    [Parameter(ParameterSetName = 'Review')]
    [ValidateRange(1, 8)]
    [int]$Jobs = 4
)

$ErrorActionPreference = 'Stop'
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
        'Read-Host' = 'Microsoft.PowerShell.Utility'
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
$appId = '4445344'
$installationId = '150304409'
$trustedRoot = $PSScriptRoot
$protectedRoot = 'C:\ProgramData\AI-BIM-governance'
$protectedBase = Join-Path $protectedRoot 'blip-approve'
$secretRoot = Join-Path $protectedBase 'secrets'
$privateKeyPath = Join-Path $secretRoot 'codex-private-key.pem'
$stateRoot = Join-Path $trustedRoot 'state'
$appScriptsRoot = Join-Path $trustedRoot 'app-scripts'
$manifestPath = Join-Path $trustedRoot 'manifest.json'
$completionPath = Join-Path $trustedRoot 'install-complete.json'
$collectorPath = Join-Path $appScriptsRoot 'collect_ship_gate_packet.py'
$gatePath = Join-Path $appScriptsRoot 'codex_ship_gate.py'
$packetModulePath = Join-Path $appScriptsRoot 'ship_gate_packet.py'
$binderPath = Join-Path $trustedRoot 'bind_ship_attestation.py'
$postReviewPath = Join-Path $appScriptsRoot 'post_review.py'
$appAuthPath = Join-Path $appScriptsRoot 'app_auth.py'
$botsPath = Join-Path $trustedRoot 'bots.json'
$powerShellPath = 'C:\Program Files\PowerShell\7\pwsh.exe'
$pythonPath = 'C:\Program Files\Python312\python.exe'
$fixedOwnerSidValue = 'S-1-5-21-2135046472-1977311562-3864793309-1001'
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
$codexRuntimeRoot = Join-Path $trustedRoot 'codex-runtime'
$codexBinRoot = Join-Path $codexRuntimeRoot 'bin'
$codexPathRoot = Join-Path $codexRuntimeRoot 'codex-path'
$codexResourcesRoot = Join-Path $codexRuntimeRoot 'codex-resources'
$codexPackagePath = Join-Path $codexRuntimeRoot 'codex-package.json'
$codexPath = Join-Path $codexBinRoot 'codex.exe'
$codexCodeModeHostPath = Join-Path $codexBinRoot 'codex-code-mode-host.exe'
$codexRgPath = Join-Path $codexPathRoot 'rg.exe'
$codexCommandRunnerPath = Join-Path $codexResourcesRoot 'codex-command-runner.exe'
$codexSandboxSetupPath = Join-Path $codexResourcesRoot 'codex-windows-sandbox-setup.exe'
$codexHome = Join-Path $trustedRoot 'codex-home'
$codexAuthPath = Join-Path $codexHome 'auth.json'
$stamp = [DateTimeOffset]::Now.ToString('yyyyMMddTHHmmssfff')
$artifactsRoot = if ($PSCmdlet.ParameterSetName -ceq 'Review') {
    Join-Path $stateRoot "codex-bound-pr$PrNumber-$stamp"
}
else { $null }
$wrapperExitCode = 1
$pinnedStreams = [System.Collections.Generic.List[System.IO.FileStream]]::new()
$reviewLockStream = $null

$protectedTokenEnv = 'BLIP_PROTECTED_CODEX_INSTALLATION_TOKEN'
$protectedAppIdEnv = 'BLIP_PROTECTED_CODEX_APP_ID'
$protectedInstallationIdEnv = 'BLIP_PROTECTED_CODEX_INSTALLATION_ID'

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
            'schema', 'files', 'runtime', 'candidate_freeze_sha256', 'activation', 'installed_at'
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


function Open-ExclusiveAppReviewLock {
    param(
        [Parameter(Mandatory)][string]$StateRoot,
        [Parameter(Mandatory)][string]$Repository,
        [Parameter(Mandatory)][ValidateRange(1, 999999)][int]$PrNumber
    )
    if ($Repository -cne 'monkey1sai/AI-BIM-governance') {
        throw 'App review lock repository differs from the fixed protected repository.'
    }
    $lockPath = Join-Path $StateRoot "codex-app-review-pr$PrNumber.lock"
    return [System.IO.FileStream]::new(
        $lockPath,
        [System.IO.FileMode]::OpenOrCreate,
        [System.IO.FileAccess]::ReadWrite,
        [System.IO.FileShare]::None
    )
}

function Get-ProtectedGateCommandTimeoutSec {
    param(
        [Parameter(Mandatory)][ValidateRange(60, 300)][int]$AgentTimeoutSec,
        [Parameter(Mandatory)][ValidateRange(1, 8)][int]$Jobs
    )
    $triageAndApexWaves = 2
    $finderWaves = [Math]::Ceiling(4.0 / $Jobs)
    $refuterWaves = [Math]::Ceiling(8.0 / $Jobs)
    $attemptsPerCall = 2
    $fixedProcessOverheadSec = 300
    return [int](
        $attemptsPerCall * $AgentTimeoutSec *
            ($triageAndApexWaves + $finderWaves + $refuterWaves) +
        $fixedProcessOverheadSec
    )
}

function Assert-PinnedSigner {
    param(
        [Parameter(Mandatory)][string]$LiteralPath,
        [Parameter(Mandatory)][string]$ExpectedThumbprint
    )
    $signature = Get-AuthenticodeSignature -LiteralPath $LiteralPath
    if (
        $signature.Status -ne [System.Management.Automation.SignatureStatus]::Valid -or
        $null -eq $signature.SignerCertificate -or
        $signature.SignerCertificate.Thumbprint -cne $ExpectedThumbprint
    ) {
        throw "Executable signer mismatch: $LiteralPath"
    }
}

function Assert-SystemExecutableAcl {
    param([Parameter(Mandatory)][string]$LiteralPath)
    $item = Get-Item -Force -LiteralPath $LiteralPath
    if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw "System executable is a reparse point: $LiteralPath"
    }
    $acl = Get-Acl -LiteralPath $LiteralPath
    $ownerSid = ([System.Security.Principal.NTAccount]$acl.Owner).Translate(
        [System.Security.Principal.SecurityIdentifier]
    ).Value
    $systemWriterSids = @('S-1-5-18', 'S-1-5-32-544')
    if ($systemWriterSids -notcontains $ownerSid) {
        throw "System executable owner is not SYSTEM or Administrators: $LiteralPath"
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
                throw "Unresolvable identity has write-like rights on the pinned system executable: $LiteralPath"
            }
            continue
        }
        if (
            $rule.AccessControlType -eq [System.Security.AccessControl.AccessControlType]::Allow -and
            $overlap -ne 0 -and
            $systemWriterSids -notcontains $ruleSid
        ) {
            throw "Non-system SID $ruleSid can modify the pinned system executable: $LiteralPath"
        }
    }
}

function Get-ProtectedWriteMask {
    return [System.Security.AccessControl.FileSystemRights]::WriteData -bor
        [System.Security.AccessControl.FileSystemRights]::AppendData -bor
        [System.Security.AccessControl.FileSystemRights]::WriteAttributes -bor
        [System.Security.AccessControl.FileSystemRights]::WriteExtendedAttributes -bor
        [System.Security.AccessControl.FileSystemRights]::Delete -bor
        [System.Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles -bor
        [System.Security.AccessControl.FileSystemRights]::ChangePermissions -bor
        [System.Security.AccessControl.FileSystemRights]::TakeOwnership
}

function Assert-ProtectedRuntimeAcl {
    param([Parameter(Mandatory)][string[]]$LiteralPaths)
    $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
    if ($identity.User.Value -cne $fixedOwnerSidValue) {
        throw 'The protected App wrapper identity is not the immutable owner SID.'
    }
    $currentSid = $fixedOwnerSidValue
    $trustedSids = @($currentSid, 'S-1-5-18', 'S-1-5-32-544')
    $currentGroups = @($identity.Groups | ForEach-Object { $_.Value })
    $sandboxSid = ([System.Security.Principal.NTAccount]::new(
        [Environment]::MachineName + '\CodexSandboxUsers'
    )).Translate([System.Security.Principal.SecurityIdentifier]).Value
    if ($currentGroups -contains $sandboxSid) {
        throw 'The protected App wrapper owner identity is a CodexSandboxUsers member; trust separation is absent.'
    }
    $writeMask = Get-ProtectedWriteMask
    $readMask = [System.Security.AccessControl.FileSystemRights]::ReadAndExecute -bor
        [System.Security.AccessControl.FileSystemRights]::Synchronize
    foreach ($literalPath in $LiteralPaths) {
        $item = Get-Item -Force -LiteralPath $literalPath
        if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw "Trusted App runtime path is a reparse point: $literalPath"
        }
        $acl = Get-Acl -LiteralPath $literalPath
        if (-not $acl.AreAccessRulesProtected) { throw "Trusted App runtime path inherits ACLs: $literalPath" }
        $ownerSid = ([System.Security.Principal.NTAccount]$acl.Owner).Translate(
            [System.Security.Principal.SecurityIdentifier]
        ).Value
        if ($ownerSid -cne $currentSid) { throw "Trusted App runtime owner mismatch: $literalPath" }
        $sandboxDenied = [System.Security.AccessControl.FileSystemRights]0
        $sandboxAllowed = [System.Security.AccessControl.FileSystemRights]0
        foreach ($rule in $acl.Access) {
            try {
                $ruleSid = $rule.IdentityReference.Translate(
                    [System.Security.Principal.SecurityIdentifier]
                ).Value
            }
            catch { throw "Unresolvable identity has access to trusted App runtime path: $literalPath" }
            if ($rule.AccessControlType -eq [System.Security.AccessControl.AccessControlType]::Allow) {
                if ($ruleSid -ceq $sandboxSid) {
                    if (($rule.FileSystemRights -band (-bnot $readMask)) -ne 0) {
                        throw "CodexSandboxUsers has non-read access to trusted App runtime path: $literalPath"
                    }
                    $sandboxAllowed = $sandboxAllowed -bor ($rule.FileSystemRights -band $readMask)
                }
                elseif ($trustedSids -notcontains $ruleSid -and $rule.FileSystemRights -ne 0) {
                    throw "Untrusted SID $ruleSid has access to trusted App runtime path: $literalPath"
                }
            }
            if ($ruleSid -ceq $sandboxSid -and
                $rule.AccessControlType -eq [System.Security.AccessControl.AccessControlType]::Deny -and
                -not $rule.IsInherited) {
                $sandboxDenied = $sandboxDenied -bor ($rule.FileSystemRights -band $writeMask)
            }
            if ($rule.AccessControlType -eq [System.Security.AccessControl.AccessControlType]::Deny -and
                ($ruleSid -ceq $currentSid -or $currentGroups -contains $ruleSid) -and
                $rule.FileSystemRights -ne 0) {
                throw "The owner process is subject to a denial on trusted App runtime path: $literalPath"
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

function Assert-ProtectedOwnerAcl {
    param([Parameter(Mandatory)][string[]]$LiteralPaths)
    $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
    if ($identity.User.Value -cne $fixedOwnerSidValue) {
        throw 'The protected App wrapper identity is not the immutable owner SID.'
    }
    $currentSid = $fixedOwnerSidValue
    $trustedWriterSids = @($currentSid, 'S-1-5-18', 'S-1-5-32-544')
    $currentGroups = @($identity.Groups | ForEach-Object { $_.Value })
    $sandboxSid = ([System.Security.Principal.NTAccount]::new(
        [Environment]::MachineName + '\CodexSandboxUsers'
    )).Translate([System.Security.Principal.SecurityIdentifier]).Value
    if ($currentGroups -contains $sandboxSid) {
        throw 'The protected App wrapper owner identity is a CodexSandboxUsers member; trust separation is absent.'
    }
    $accessMask = [System.Security.AccessControl.FileSystemRights]::FullControl
    foreach ($literalPath in $LiteralPaths) {
        $item = Get-Item -Force -LiteralPath $literalPath
        if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw "Trusted App path is a reparse point: $literalPath"
        }
        $acl = Get-Acl -LiteralPath $literalPath
        if (-not $acl.AreAccessRulesProtected) { throw "Trusted App path inherits ACLs: $literalPath" }
        $ownerSid = ([System.Security.Principal.NTAccount]$acl.Owner).Translate(
            [System.Security.Principal.SecurityIdentifier]
        ).Value
        if ($ownerSid -cne $currentSid) { throw "Trusted App path owner mismatch: $literalPath" }
        $sandboxDenied = [System.Security.AccessControl.FileSystemRights]0
        foreach ($rule in $acl.Access) {
            $overlap = $rule.FileSystemRights -band $accessMask
            try {
                $ruleSid = $rule.IdentityReference.Translate(
                    [System.Security.Principal.SecurityIdentifier]
                ).Value
            }
            catch {
                if ($overlap -ne 0) {
                    throw "Unresolvable identity has access rights on trusted App path: $literalPath"
                }
                continue
            }
            if (
                $rule.AccessControlType -eq [System.Security.AccessControl.AccessControlType]::Allow -and
                $overlap -ne 0 -and
                $trustedWriterSids -notcontains $ruleSid
            ) { throw "Untrusted SID $ruleSid has access rights on $literalPath" }
            if (
                $rule.AccessControlType -eq [System.Security.AccessControl.AccessControlType]::Deny -and
                $overlap -ne 0 -and
                ($ruleSid -ceq $currentSid -or $currentGroups -contains $ruleSid)
            ) { throw "The owner process is subject to an access denial on $literalPath" }
            if (
                $ruleSid -ceq $sandboxSid -and
                $rule.AccessControlType -eq [System.Security.AccessControl.AccessControlType]::Deny -and
                -not $rule.IsInherited
            ) { $sandboxDenied = $sandboxDenied -bor ($rule.FileSystemRights -band $accessMask) }
        }
        if (($sandboxDenied -band $accessMask) -ne $accessMask) {
            throw "CodexSandboxUsers lacks the complete explicit access denial on $literalPath"
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

function Assert-ProtectedSecretAcl {
    param([Parameter(Mandatory)][string[]]$LiteralPaths)
    Assert-ProtectedOwnerAcl -LiteralPaths $LiteralPaths
    $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
    if ($identity.User.Value -cne $fixedOwnerSidValue) {
        throw 'The protected App wrapper identity is not the immutable owner SID.'
    }
    $currentSid = $fixedOwnerSidValue
    $trustedReaderSids = @($currentSid, 'S-1-5-18', 'S-1-5-32-544')
    $currentGroups = @($identity.Groups | ForEach-Object { $_.Value })
    $sandboxSid = ([System.Security.Principal.NTAccount]::new(
        [Environment]::MachineName + '\CodexSandboxUsers'
    )).Translate([System.Security.Principal.SecurityIdentifier]).Value
    $sensitiveMask = [System.Security.AccessControl.FileSystemRights]::FullControl
    foreach ($literalPath in $LiteralPaths) {
        $acl = Get-Acl -LiteralPath $literalPath
        $sandboxDenied = [System.Security.AccessControl.FileSystemRights]0
        foreach ($rule in $acl.Access) {
            $overlap = $rule.FileSystemRights -band $sensitiveMask
            try {
                $ruleSid = $rule.IdentityReference.Translate(
                    [System.Security.Principal.SecurityIdentifier]
                ).Value
            }
            catch {
                if ($overlap -ne 0) { throw "Unresolvable identity can access protected secret path: $literalPath" }
                continue
            }
            if ($rule.AccessControlType -eq [System.Security.AccessControl.AccessControlType]::Allow -and
                $overlap -ne 0 -and $trustedReaderSids -notcontains $ruleSid) {
                throw "Untrusted SID $ruleSid can access protected secret path: $literalPath"
            }
            if ($rule.AccessControlType -eq [System.Security.AccessControl.AccessControlType]::Deny -and
                $overlap -ne 0 -and ($ruleSid -ceq $currentSid -or $currentGroups -contains $ruleSid)) {
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

function Assert-ProtectedCredentialFileAcl {
    param(
        [Parameter(Mandatory)][string]$LiteralPath,
        [Parameter(Mandatory)][string]$ProtectedParent
    )
    $parentPath = [System.IO.Path]::GetFullPath($ProtectedParent).TrimEnd('\')
    $filePath = [System.IO.Path]::GetFullPath($LiteralPath)
    if ((Split-Path -Parent $filePath) -cne $parentPath) {
        throw 'Protected credential file is outside its fixed owner-only parent.'
    }
    Assert-ProtectedSecretAcl -LiteralPaths @($parentPath)
    $item = Get-Item -Force -LiteralPath $filePath
    if ($item.PSIsContainer -or ($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw 'Protected credential path is not a regular non-reparse file.'
    }
    $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
    if ($identity.User.Value -cne $fixedOwnerSidValue) {
        throw 'The protected App wrapper identity is not the immutable owner SID.'
    }
    $currentSid = $fixedOwnerSidValue
    $trustedReaderSids = @($currentSid, 'S-1-5-18', 'S-1-5-32-544')
    $currentGroups = @($identity.Groups | ForEach-Object { $_.Value })
    $sandboxSid = ([System.Security.Principal.NTAccount]::new(
        [Environment]::MachineName + '\CodexSandboxUsers'
    )).Translate([System.Security.Principal.SecurityIdentifier]).Value
    $acl = Get-Acl -LiteralPath $filePath
    $ownerSid = ([System.Security.Principal.NTAccount]$acl.Owner).Translate(
        [System.Security.Principal.SecurityIdentifier]
    ).Value
    if ($ownerSid -cne $currentSid) { throw 'Protected credential file owner mismatch.' }
    $sandboxDenied = [System.Security.AccessControl.FileSystemRights]0
    foreach ($rule in $acl.Access) {
        try {
            $ruleSid = $rule.IdentityReference.Translate(
                [System.Security.Principal.SecurityIdentifier]
            ).Value
        }
        catch { throw 'Unresolvable identity can access the protected credential file.' }
        if ($rule.AccessControlType -eq [System.Security.AccessControl.AccessControlType]::Allow -and
            $rule.FileSystemRights -ne 0 -and $trustedReaderSids -notcontains $ruleSid) {
            throw "Untrusted SID $ruleSid can access the protected credential file."
        }
        if ($rule.AccessControlType -eq [System.Security.AccessControl.AccessControlType]::Deny -and
            $rule.FileSystemRights -ne 0 -and
            ($ruleSid -ceq $currentSid -or $currentGroups -contains $ruleSid)) {
            throw 'The owner process is subject to a denial on the protected credential file.'
        }
        if ($ruleSid -ceq $sandboxSid -and
            $rule.AccessControlType -eq [System.Security.AccessControl.AccessControlType]::Deny) {
            $sandboxDenied = $sandboxDenied -bor
                ($rule.FileSystemRights -band [System.Security.AccessControl.FileSystemRights]::FullControl)
        }
    }
    if (($sandboxDenied -band [System.Security.AccessControl.FileSystemRights]::FullControl) -ne
        [System.Security.AccessControl.FileSystemRights]::FullControl) {
        throw 'CodexSandboxUsers lacks a complete effective denial on the protected credential file.'
    }
}

function ConvertTo-Base64Url {
    param([Parameter(Mandatory)][byte[]]$Bytes)
    return [Convert]::ToBase64String($Bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
}

function New-FixedAppJwt {
    param([Parameter(Mandatory)][char[]]$PemChars)
    $rsa = $null
    [byte[]]$headerBytes = $null
    [byte[]]$payloadBytes = $null
    [byte[]]$unsignedBytes = $null
    [byte[]]$signatureBytes = $null
    try {
        $rsa = [System.Security.Cryptography.RSA]::Create()
        try { $rsa.ImportFromPem($PemChars) }
        catch { throw 'Protected GitHub App key could not be imported as an RSA PEM.' }
        if ($rsa.KeySize -lt 2048) { throw 'Protected GitHub App RSA key is below 2048 bits.' }
        $now = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
        $headerBytes = [System.Text.Encoding]::UTF8.GetBytes('{"alg":"RS256","typ":"JWT"}')
        $payloadBytes = [System.Text.Encoding]::UTF8.GetBytes((
            [ordered]@{ iat = $now - 60; exp = $now + 540; iss = $appId } |
                ConvertTo-Json -Compress
        ))
        $unsigned = (ConvertTo-Base64Url -Bytes $headerBytes) + '.' +
            (ConvertTo-Base64Url -Bytes $payloadBytes)
        $unsignedBytes = [System.Text.Encoding]::ASCII.GetBytes($unsigned)
        $signatureBytes = $rsa.SignData(
            $unsignedBytes,
            [System.Security.Cryptography.HashAlgorithmName]::SHA256,
            [System.Security.Cryptography.RSASignaturePadding]::Pkcs1
        )
        return $unsigned + '.' + (ConvertTo-Base64Url -Bytes $signatureBytes)
    }
    finally {
        if ($rsa) { $rsa.Dispose() }
        foreach ($buffer in @($headerBytes, $payloadBytes, $unsignedBytes, $signatureBytes)) {
            if ($null -ne $buffer) {
                [System.Security.Cryptography.CryptographicOperations]::ZeroMemory($buffer)
            }
        }
    }
}

function Open-ProtectedPrivateKeyStream {
    param([Parameter(Mandatory)][string]$LiteralPath)
    Assert-ProtectedSecretAcl -LiteralPaths @($secretRoot)
    Assert-ProtectedCredentialFileAcl -LiteralPath $LiteralPath -ProtectedParent $secretRoot
    return [System.IO.FileStream]::new(
        $LiteralPath,
        [System.IO.FileMode]::Open,
        [System.IO.FileAccess]::Read,
        [System.IO.FileShare]::None
    )
}

function New-ProtectedInstallationTokenRequest {
    param([Parameter(Mandatory)][string]$Jwt)
    if ($Jwt -notmatch '^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$') {
        throw 'Protected GitHub App JWT has an invalid shape.'
    }
    $request = [System.Net.Http.HttpRequestMessage]::new(
        [System.Net.Http.HttpMethod]::Post,
        "https://api.github.com/app/installations/$installationId/access_tokens"
    )
    [void]$request.Headers.TryAddWithoutValidation('Accept', 'application/vnd.github+json')
    [void]$request.Headers.TryAddWithoutValidation('X-GitHub-Api-Version', '2022-11-28')
    [void]$request.Headers.TryAddWithoutValidation('User-Agent', 'blip-protected-codex-gate/1.0')
    $request.Headers.Authorization = [System.Net.Http.Headers.AuthenticationHeaderValue]::new('Bearer', $Jwt)
    $request.Content = [System.Net.Http.StringContent]::new(
        '{"repositories":["AI-BIM-governance"],"permissions":{"contents":"read","pull_requests":"write"}}',
        [System.Text.Encoding]::UTF8,
        'application/json'
    )
    return $request
}

function Read-BoundedHttpContentBytes {
    param(
        [Parameter(Mandatory)][AllowNull()][System.Net.Http.HttpContent]$Content,
        [ValidateRange(1, 1048576)][int]$MaxBytes = 65536
    )
    if ($null -eq $Content) {
        throw 'GitHub installation-token response content is unavailable.'
    }
    $declaredLength = $Content.Headers.ContentLength
    if ($null -ne $declaredLength -and [long]$declaredLength -gt $MaxBytes) {
        throw 'GitHub installation-token response exceeded the protected size limit.'
    }
    $source = $null
    $sink = [System.IO.MemoryStream]::new()
    [byte[]]$buffer = [byte[]]::new(8192)
    try {
        $source = $Content.ReadAsStream()
        while ($true) {
            $remaining = [long]$MaxBytes - $sink.Length
            $requested = [Math]::Min($buffer.Length, [int]$remaining + 1)
            $read = $source.Read($buffer, 0, $requested)
            if ($read -eq 0) { break }
            if ($sink.Length + $read -gt $MaxBytes) {
                throw 'GitHub installation-token response exceeded the protected size limit.'
            }
            $sink.Write($buffer, 0, $read)
        }
        return ,$sink.ToArray()
    }
    finally {
        [System.Security.Cryptography.CryptographicOperations]::ZeroMemory($buffer)
        if ($source) { $source.Dispose() }
        $sink.Dispose()
    }
}

function Read-ProtectedInstallationTokenHttpResponse {
    param([Parameter(Mandatory)][AllowNull()][System.Net.Http.HttpResponseMessage]$Response)
    if ($null -eq $Response) {
        throw 'GitHub installation-token request returned no response.'
    }
    if ([int]$Response.StatusCode -ne 201) {
        throw "GitHub installation-token request failed with HTTP $([int]$Response.StatusCode)."
    }
    return Read-BoundedHttpContentBytes -Content $Response.Content -MaxBytes 65536
}

function Invoke-GitHubInstallationTokenRequest {
    param([Parameter(Mandatory)][string]$Jwt)
    $handler = $null
    $client = $null
    $request = $null
    $response = $null
    [byte[]]$responseBytes = $null
    try {
        $handler = [System.Net.Http.HttpClientHandler]::new()
        $handler.UseProxy = $false
        $handler.Proxy = $null
        $handler.AllowAutoRedirect = $false
        $handler.CheckCertificateRevocationList = $true
        $client = [System.Net.Http.HttpClient]::new($handler, $true)
        $client.Timeout = [TimeSpan]::FromSeconds(60)
        $request = New-ProtectedInstallationTokenRequest -Jwt $Jwt
        $response = $client.Send(
            $request,
            [System.Net.Http.HttpCompletionOption]::ResponseHeadersRead
        )
        $responseBytes = Read-ProtectedInstallationTokenHttpResponse -Response $response
        return ,$responseBytes
    }
    finally {
        if ($response) { $response.Dispose() }
        if ($request) { $request.Dispose() }
        if ($client) { $client.Dispose() }
        elseif ($handler) { $handler.Dispose() }
    }
}

function ConvertFrom-ProtectedInstallationTokenResponse {
    param(
        [Parameter(Mandatory)][byte[]]$ResponseBytes,
        [Parameter(Mandatory)][DateTimeOffset]$Now,
        [Parameter(Mandatory)][string]$ExpectedRepository
    )
    if ($ResponseBytes.Length -gt 65536) {
        throw 'GitHub installation-token response exceeded the protected size limit.'
    }
    $document = $null
    try {
        $document = [System.Text.Json.JsonDocument]::Parse(
            [ReadOnlyMemory[byte]]::new($ResponseBytes)
        )
        $root = $document.RootElement
        $token = $root.GetProperty('token').GetString()
        if ($token -notmatch '^[A-Za-z0-9._-]{20,4096}$') {
            throw 'GitHub returned a malformed installation token.'
        }
        $expiresAt = [DateTimeOffset]::MinValue
        if (-not [DateTimeOffset]::TryParse(
            $root.GetProperty('expires_at').GetString(),
            [Globalization.CultureInfo]::InvariantCulture,
            [Globalization.DateTimeStyles]::AssumeUniversal -bor
                [Globalization.DateTimeStyles]::AdjustToUniversal,
            [ref]$expiresAt
        )) { throw 'GitHub returned a malformed installation-token expiry.' }
        if ($expiresAt -lt $Now.AddMinutes(5) -or $expiresAt -gt $Now.AddMinutes(70)) {
            throw 'GitHub returned an unexpected installation-token lifetime.'
        }
        $permissions = $root.GetProperty('permissions')
        $permissionMap = @{}
        foreach ($property in $permissions.EnumerateObject()) {
            $permissionMap[$property.Name] = $property.Value.GetString()
        }
        if ([string]$permissionMap.contents -cne 'read' -or
            [string]$permissionMap.pull_requests -cne 'write' -or
            ($permissionMap.ContainsKey('metadata') -and [string]$permissionMap.metadata -cne 'read') -or
            @($permissionMap.Keys | Where-Object { $_ -notin @('contents', 'pull_requests', 'metadata') }).Count -ne 0) {
            throw 'GitHub returned installation-token permissions outside the protected subset.'
        }
        $repositories = @($root.GetProperty('repositories').EnumerateArray())
        if ($repositories.Count -ne 1 -or
            $repositories[0].GetProperty('full_name').GetString() -cne $ExpectedRepository) {
            throw 'GitHub returned an installation token outside the fixed repository scope.'
        }
        return $token
    }
    catch {
        if ($_.Exception.Message -like 'GitHub returned*') { throw }
        throw 'GitHub returned malformed installation-token metadata.'
    }
    finally {
        if ($document) { $document.Dispose() }
    }
}

function Get-ProtectedInstallationToken {
    Assert-SystemProtectedProgramData
    Assert-ProtectedRuntimeAcl -LiteralPaths @($protectedRoot, $protectedBase)

    $keyStream = Open-ProtectedPrivateKeyStream -LiteralPath $privateKeyPath
    [byte[]]$pemBytes = $null
    [char[]]$pemChars = $null
    [byte[]]$responseBytes = $null
    $jwt = $null
    try {
        if ($keyStream.Length -lt 500 -or $keyStream.Length -gt 16384) {
            throw 'Protected GitHub App key has an implausible file length.'
        }
        $pemBytes = [byte[]]::new([int]$keyStream.Length)
        $offset = 0
        while ($offset -lt $pemBytes.Length) {
            $read = $keyStream.Read($pemBytes, $offset, $pemBytes.Length - $offset)
            if ($read -le 0) { throw 'Protected GitHub App key ended before its declared length.' }
            $offset += $read
        }
        for ($index = 0; $index -lt $pemBytes.Length; $index++) {
            if ($pemBytes[$index] -gt 0x7f) { throw 'Protected GitHub App key is not ASCII PEM.' }
        }
        $pemChars = [System.Text.Encoding]::ASCII.GetChars($pemBytes)
        $jwt = New-FixedAppJwt -PemChars $pemChars
        $responseBytes = Invoke-GitHubInstallationTokenRequest -Jwt $jwt
        return ConvertFrom-ProtectedInstallationTokenResponse `
            -ResponseBytes $responseBytes `
            -Now ([DateTimeOffset]::UtcNow) `
            -ExpectedRepository $repository
    }
    finally {
        $jwt = $null
        $keyStream.Dispose()
        foreach ($buffer in @($pemBytes, $responseBytes)) {
            if ($null -ne $buffer) {
                [System.Security.Cryptography.CryptographicOperations]::ZeroMemory($buffer)
            }
        }
        if ($null -ne $pemChars) { [Array]::Clear($pemChars, 0, $pemChars.Length) }
    }
}

function Invoke-PinnedPython {
    param(
        [Parameter(Mandatory)][string[]]$Arguments,
        [ValidateRange(60, 9000)][int]$CommandTimeoutSec = 600,
        [switch]$WithGitHubToken
    )
    $installationToken = $null
    if ($WithGitHubToken) {
        $installationToken = Get-ProtectedInstallationToken
    }
    $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
    $startInfo.FileName = $pythonPath
    $startInfo.WorkingDirectory = $trustedRoot
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    foreach ($argument in @('-I', '-S', '-B') + $Arguments) { [void]$startInfo.ArgumentList.Add($argument) }
    $preserved = [ordered]@{}
    foreach ($name in @('SystemRoot', 'WINDIR', 'TEMP', 'TMP')) {
        $value = [Environment]::GetEnvironmentVariable($name, 'Process')
        if (-not [string]::IsNullOrWhiteSpace($value)) { $preserved[$name] = $value }
    }
    $startInfo.Environment.Clear()
    foreach ($entry in $preserved.GetEnumerator()) { $startInfo.Environment[$entry.Key] = $entry.Value }
    if ($WithGitHubToken) {
        $startInfo.Environment[$protectedTokenEnv] = $installationToken
        $startInfo.Environment[$protectedAppIdEnv] = $appId
        $startInfo.Environment[$protectedInstallationIdEnv] = $installationId
    }
    $process = [System.Diagnostics.Process]::new()
    $process.StartInfo = $startInfo
    try {
        if (-not $process.Start()) { throw 'Failed to start the pinned Python child.' }
        foreach ($name in @($protectedTokenEnv, $protectedAppIdEnv, $protectedInstallationIdEnv)) {
            [void]$startInfo.Environment.Remove($name)
        }
        $installationToken = $null
        $stdoutTask = $process.StandardOutput.ReadToEndAsync()
        $stderrTask = $process.StandardError.ReadToEndAsync()
        if (-not $process.WaitForExit($CommandTimeoutSec * 1000)) {
            $process.Kill($true); $process.WaitForExit()
            throw "Pinned Python command exceeded its $CommandTimeoutSec-second protected limit."
        }
        $stdout = $stdoutTask.GetAwaiter().GetResult()
        $stderr = $stderrTask.GetAwaiter().GetResult()
        $exitCode = $process.ExitCode
    }
    finally {
        foreach ($name in @($protectedTokenEnv, $protectedAppIdEnv, $protectedInstallationIdEnv)) {
            [void]$startInfo.Environment.Remove($name)
        }
        $installationToken = $null
        $process.Dispose()
    }
    $output = @($stdout -split "`r?`n" | Where-Object { -not [string]::IsNullOrEmpty($_) }) +
        @($stderr -split "`r?`n" | Where-Object { -not [string]::IsNullOrEmpty($_) })
    foreach ($line in $output) { Write-Information "$line" -InformationAction Continue }
    if ($exitCode -ne 0) { throw "Pinned Python command failed with exit $exitCode" }
    return @($output | ForEach-Object { "$_" })
}

function Get-UniqueMarkerValue {
    param(
        [Parameter(Mandatory)][string[]]$Lines,
        [Parameter(Mandatory)][string]$Prefix
    )
    $matches = @($Lines | Where-Object { $_.StartsWith($Prefix, [StringComparison]::Ordinal) })
    if ($matches.Count -ne 1) { throw "Expected exactly one $Prefix marker, got $($matches.Count)." }
    return $matches[0].Substring($Prefix.Length).Trim()
}

try {
    $hostPath = [System.IO.Path]::GetFullPath([Environment]::ProcessPath)
    if ($hostPath -cne $powerShellPath) {
        throw "Protected App wrapper must run with the fixed PowerShell host: $powerShellPath"
    }
    if ((Get-Item -LiteralPath $powerShellPath).VersionInfo.FileVersion -cne '7.5.4.500') {
        throw 'Protected PowerShell host version differs from the reviewed runtime.'
    }
    Assert-SystemProtectedProgramData
    $runtimeRequired = @(
        $trustedRoot, $stateRoot, $appScriptsRoot,
        $codexRuntimeRoot, $codexBinRoot, $codexPathRoot, $codexResourcesRoot,
        $codexPackagePath, $codexPath, $codexCodeModeHostPath, $codexRgPath,
        $codexCommandRunnerPath, $codexSandboxSetupPath,
        $manifestPath, $completionPath, $PSCommandPath,
        $collectorPath, $gatePath, $packetModulePath, $binderPath,
        $postReviewPath, $appAuthPath, $botsPath
    )
    $credentialRequired = if ($PSCmdlet.ParameterSetName -ceq 'Review') {
        @($codexHome, $codexAuthPath)
    }
    else { @() }
    $protectedRequired = @($runtimeRequired + $credentialRequired)
    foreach ($path in @($powerShellPath, $pythonPath, $protectedBase, $secretRoot, $privateKeyPath) + $protectedRequired) {
        if (-not (Test-Path -LiteralPath $path)) { throw "Trusted App runtime path is unavailable: $path" }
    }
    Assert-SystemExecutableAcl -LiteralPath $powerShellPath
    Assert-PinnedSigner -LiteralPath $powerShellPath -ExpectedThumbprint '3F56A45111684D454E231CFDC4DA5C8D370F9816'
    Assert-SystemExecutableAcl -LiteralPath $pythonPath
    Assert-PinnedSigner -LiteralPath $pythonPath -ExpectedThumbprint '36168EE17C1A240517388540C903BB6717DD2563'
    foreach ($signedCodexPath in @(
        $codexPath, $codexCodeModeHostPath, $codexCommandRunnerPath, $codexSandboxSetupPath
    )) {
        Assert-PinnedSigner -LiteralPath $signedCodexPath -ExpectedThumbprint '8B0ADFB840E141DAD3044D2B5AC819873DDE3590'
    }
    Assert-ProtectedRuntimeAcl -LiteralPaths (@($protectedRoot, $protectedBase) + $runtimeRequired)
    if ($PSCmdlet.ParameterSetName -ceq 'Review') {
        Assert-ProtectedSecretAcl -LiteralPaths @($codexHome)
        Assert-ProtectedCredentialFileAcl -LiteralPath $codexAuthPath -ProtectedParent $codexHome
    }
    $metadata = ConvertFrom-StrictRuntimeMetadata `
        -ManifestText (Get-Content -Raw -LiteralPath $manifestPath) `
        -CompletionText (Get-Content -Raw -LiteralPath $completionPath) `
        -ExpectedFileNames $expectedManifestFileNames `
        -ExpectedRuntimeNames $expectedManifestRuntimeNames
    $manifest = $metadata.Manifest
    $completion = $metadata.Completion
    $manifestHash = (Get-FileHash -LiteralPath $manifestPath -Algorithm SHA256).Hash.ToUpperInvariant()
    if ($completion.schema -cne 'blip-trusted-runtime-complete/v1' -or
        [string]$completion.owner_sid -cne $fixedOwnerSidValue -or
        [string]$completion.candidate_freeze_sha256 -notmatch '^[0-9A-F]{64}$' -or
        [string]$completion.candidate_freeze_sha256 -cne
            [string]$manifest.candidate_freeze_sha256 -or
        [string]$completion.manifest_sha256 -cne $manifestHash) {
        throw 'Trusted runtime completion marker does not bind the installed manifest.'
    }

    $manifestFiles = [ordered]@{
        'run_codex_bound_ship_gate_once.ps1' = $PSCommandPath
        'bind_ship_attestation.py' = $binderPath
        'app-scripts/collect_ship_gate_packet.py' = $collectorPath
        'app-scripts/codex_ship_gate.py' = $gatePath
        'app-scripts/ship_gate_packet.py' = $packetModulePath
        'app-scripts/post_review.py' = $postReviewPath
        'app-scripts/app_auth.py' = $appAuthPath
        'bots.json' = $botsPath
    }
    $runtimeFiles = [ordered]@{
        'runtime/pwsh.exe' = $powerShellPath
        'runtime/python.exe' = $pythonPath
        'runtime/codex-package.json' = $codexPackagePath
        'runtime/bin/codex.exe' = $codexPath
        'runtime/bin/codex-code-mode-host.exe' = $codexCodeModeHostPath
        'runtime/codex-path/rg.exe' = $codexRgPath
        'runtime/codex-resources/codex-command-runner.exe' = $codexCommandRunnerPath
        'runtime/codex-resources/codex-windows-sandbox-setup.exe' = $codexSandboxSetupPath
    }
    foreach ($entry in $trustedPowerShellInputs.GetEnumerator()) {
        $runtimeFiles[$entry.Key] = $entry.Value.Path
    }
    foreach ($entry in $manifestFiles.GetEnumerator()) {
        $expectedProperty = $manifest.files.PSObject.Properties[$entry.Key]
        if ($null -eq $expectedProperty -or [string]$expectedProperty.Value -notmatch '^[0-9A-F]{64}$') {
            throw "Manifest has no valid hash for $($entry.Key)"
        }
        $stream = [System.IO.FileStream]::new(
            $entry.Value, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::Read
        )
        $pinnedStreams.Add($stream)
        if ((Get-OpenStreamSha256 -Stream $stream) -cne [string]$expectedProperty.Value) {
            throw "Trusted App file hash mismatch: $($entry.Key)"
        }
    }
    foreach ($entry in $runtimeFiles.GetEnumerator()) {
        $expectedProperty = $manifest.runtime.PSObject.Properties[$entry.Key]
        if ($null -eq $expectedProperty -or [string]$expectedProperty.Value -notmatch '^[0-9A-F]{64}$') {
            throw "Manifest has no valid runtime hash for $($entry.Key)"
        }
        if ($trustedPowerShellInputs.Contains($entry.Key) -and
            [string]$expectedProperty.Value -cne
                $trustedPowerShellInputs[$entry.Key].Sha256) {
            throw "Manifest PowerShell dependency hash differs from the protected prelude: $($entry.Key)"
        }
        $stream = [System.IO.FileStream]::new(
            $entry.Value, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::Read
        )
        $pinnedStreams.Add($stream)
        if ((Get-OpenStreamSha256 -Stream $stream) -cne [string]$expectedProperty.Value) {
            throw "Protected runtime executable hash mismatch: $($entry.Key)"
        }
    }

    if ($TokenHealth) {
        $healthToken = Get-ProtectedInstallationToken
        try {
            if ($healthToken -notmatch '^[A-Za-z0-9._-]{20,4096}$') {
                throw 'Protected token health returned an invalid opaque token shape.'
            }
            Write-Information 'BLIP_TOKEN_HEALTH=OK' -InformationAction Continue
        }
        finally { $healthToken = $null }
        exit 0
    }

    $reviewLockStream = Open-ExclusiveAppReviewLock `
        -StateRoot $stateRoot -Repository $repository -PrNumber $PrNumber
    New-Item -ItemType Directory -Path $artifactsRoot | Out-Null
    if (((Get-Item -Force -LiteralPath $artifactsRoot).Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw 'Fresh App artifact directory unexpectedly resolved to a reparse point.'
    }
    $expectedPacketPath = [System.IO.Path]::GetFullPath((
        Join-Path $artifactsRoot "codex-gate-packet-pr-$PrNumber-$stamp.json"
    ))
    $collectorOutput = Invoke-PinnedPython -Arguments @(
        $collectorPath,
        '--repo', $repository,
        '--pr', [string]$PrNumber,
        '--out-dir', $artifactsRoot,
        '--stamp', $stamp
    ) -WithGitHubToken
    $packetPath = Get-UniqueMarkerValue -Lines $collectorOutput -Prefix 'BLIP_GATE_PACKET='
    $packetBase = Get-UniqueMarkerValue -Lines $collectorOutput -Prefix 'BLIP_GATE_PACKET_BASE='
    $packetHead = Get-UniqueMarkerValue -Lines $collectorOutput -Prefix 'BLIP_GATE_PACKET_HEAD='
    if ([System.IO.Path]::GetFullPath($packetPath) -cne $expectedPacketPath -or
        $packetBase -notmatch '^[0-9a-f]{40}$' -or
        $packetHead -notmatch '^[0-9a-f]{40}$' -or
        -not (Test-Path -LiteralPath $packetPath -PathType Leaf)) {
        throw 'Privileged collector output is malformed or escaped the protected artifact directory.'
    }

    $gateCommandTimeoutSec = Get-ProtectedGateCommandTimeoutSec `
        -AgentTimeoutSec $AgentTimeoutSec -Jobs $Jobs
    $gateOutput = Invoke-PinnedPython -Arguments @(
        $gatePath,
        '--repo', $repository,
        '--pr', [string]$PrNumber,
        '--packet', $packetPath,
        '--out-dir', $artifactsRoot,
        '--stamp', $stamp,
        '--timeout', [string]$AgentTimeoutSec,
        '--jobs', [string]$Jobs,
        '--codex-bin', $codexPath,
        '--codex-home', $codexHome
    ) -CommandTimeoutSec $gateCommandTimeoutSec
    $event = Get-UniqueMarkerValue -Lines $gateOutput -Prefix 'TRI_GATE_EVENT='
    $verdict = Get-UniqueMarkerValue -Lines $gateOutput -Prefix 'TRI_GATE_VERDICT='
    $head = Get-UniqueMarkerValue -Lines $gateOutput -Prefix 'TRI_GATE_HEAD_SHA='
    $reportPath = Get-UniqueMarkerValue -Lines $gateOutput -Prefix 'TRI_GATE_MARKDOWN='
    $gateJsonPath = Get-UniqueMarkerValue -Lines $gateOutput -Prefix 'TRI_GATE_JSON='
    if ($event -notin @('comment', 'request_changes') -or $verdict -notin @('SHIP', 'NO-SHIP', 'HELD')) {
        throw 'Gate output mapping is malformed or attempts an App approval.'
    }
    if (
        ($verdict -ceq 'SHIP' -and $event -cne 'comment') -or
        ($verdict -ceq 'NO-SHIP' -and $event -cne 'request_changes') -or
        ($verdict -ceq 'HELD' -and $event -cne 'comment')
    ) { throw 'Gate verdict/event pair differs from the protected fail-closed mapping.' }
    $expectedReportPath = [System.IO.Path]::GetFullPath((Join-Path $artifactsRoot "codex-tri-pr-$PrNumber-$stamp.md"))
    $expectedGateJsonPath = [System.IO.Path]::GetFullPath((Join-Path $artifactsRoot "codex-tri-pr-$PrNumber-$stamp.json"))
    if (
        [System.IO.Path]::GetFullPath($reportPath) -cne $expectedReportPath -or
        [System.IO.Path]::GetFullPath($gateJsonPath) -cne $expectedGateJsonPath
    ) { throw 'Gate output paths escaped or differed from the exact protected artifact names.' }
    if ($head -cne $packetHead -or $head -notmatch '^[0-9a-f]{40}$' -or
        -not (Test-Path -LiteralPath $reportPath -PathType Leaf) -or
        -not (Test-Path -LiteralPath $gateJsonPath -PathType Leaf)) {
        throw 'Gate output paths or exact head are malformed.'
    }

    $verifiedPath = [System.IO.Path]::GetFullPath((
        Join-Path $artifactsRoot "codex-tri-pr-$PrNumber-$stamp-verified.md"
    ))
    $bindOutput = Invoke-PinnedPython -Arguments @(
        $binderPath,
        '--repo', $repository,
        '--pr', [string]$PrNumber,
        '--expected-head', $head,
        '--gate-json', $gateJsonPath,
        '--report', $reportPath,
        '--out', $verifiedPath
    ) -WithGitHubToken
    $tupleVerified = Get-UniqueMarkerValue -Lines $bindOutput -Prefix 'BLIP_TUPLE_VERIFIED='
    $base = Get-UniqueMarkerValue -Lines $bindOutput -Prefix 'BLIP_TUPLE_BASE='
    $verifiedHead = Get-UniqueMarkerValue -Lines $bindOutput -Prefix 'BLIP_TUPLE_HEAD='
    $verifiedFiles = Get-UniqueMarkerValue -Lines $bindOutput -Prefix 'BLIP_TUPLE_CHANGED_FILES_SHA256='
    $verifiedDiff = Get-UniqueMarkerValue -Lines $bindOutput -Prefix 'BLIP_TUPLE_DIFF_SHA256='
    $verifiedVerdict = Get-UniqueMarkerValue -Lines $bindOutput -Prefix 'BLIP_TUPLE_VERDICT='
    $verifiedReport = Get-UniqueMarkerValue -Lines $bindOutput -Prefix 'BLIP_VERIFIED_REPORT='
    if ($tupleVerified -cne 'true' -or $base -cne $packetBase -or
        $verifiedHead -cne $head -or $verifiedVerdict -cne $verdict -or
        $verifiedFiles -notmatch '^[0-9a-f]{64}$' -or
        $verifiedDiff -notmatch '^[0-9a-f]{64}$' -or
        [System.IO.Path]::GetFullPath($verifiedReport) -cne $verifiedPath -or
        -not (Test-Path -LiteralPath $verifiedPath -PathType Leaf)) {
        throw 'Final privileged tuple verification output is malformed or drifted.'
    }
    $reportPath = $verifiedPath
    if ($verdict -ceq 'SHIP') {
        $mode = Get-UniqueMarkerValue -Lines $bindOutput -Prefix 'BLIP_ATTESTATION_REVIEW_MODE='
        if ($mode -notin @('focused_semantic', 'risk_scoped_specialists', 'human_critical')) {
            throw 'Canonical SHIP attestation output is malformed.'
        }
        Write-Information "BLIP_APPROVAL_TUPLE pr=$PrNumber base=$base head=$head review_mode=$mode" -InformationAction Continue
    }

    $postArguments = @(
        $postReviewPath,
        '--bot', 'codex',
        '--bot-name', 'Codex Tri-Adversarial Bot',
        '--bot-subtitle', 'Automated **tri-adversarial ship-gate** with protected canonical attestation binding.',
        '--repo', $repository,
        '--pr', [string]$PrNumber,
        '--body-file', $reportPath,
        '--event', $event,
        '--commit-id', $head,
        $(if ($Live) { '--live' } else { '--dry-run' })
    )
    $postOutput = Invoke-PinnedPython -Arguments $postArguments -WithGitHubToken
    $postMode = if ($Live) { 'dry_run=False' } else { 'dry_run=True' }
    if (@($postOutput | Where-Object { $_ -match '^repo=monkey1sai/AI-BIM-governance pr=#\d+ event=(COMMENT|REQUEST_CHANGES) dry_run=(True|False)$' }).Count -ne 1) {
        throw 'post_review.py exited 0 without the expected fixed-repository result marker.'
    }
    $postPattern = if ($Live) {
        '^POST_REVIEW_RESULT event=' + [regex]::Escape($event.ToUpperInvariant()) +
        ' dry_run=False review_id=\d+ html=https://github\.com/monkey1sai/AI-BIM-governance/pull/' +
        [regex]::Escape([string]$PrNumber) + '#pullrequestreview-\d+$'
    }
    else { '^POST_REVIEW_RESULT event=' + [regex]::Escape($event.ToUpperInvariant()) + ' dry_run=True$' }
    if (@($postOutput | Where-Object { $_ -match $postPattern }).Count -ne 1) {
        throw 'post_review.py did not confirm the exact event and execution mode.'
    }
    $wrapperExitCode = 0
}
catch {
    Write-Information "Bound Codex App gate failed closed: $($_.Exception.Message)" -InformationAction Continue
    $wrapperExitCode = 1
}
finally {
    if ($null -ne $reviewLockStream) { $reviewLockStream.Dispose() }
    foreach ($stream in $pinnedStreams) { $stream.Dispose() }
    foreach ($stream in $trustedPowerShellInputStreams) { try { $stream.Dispose() } catch { } }
}

exit $wrapperExitCode
