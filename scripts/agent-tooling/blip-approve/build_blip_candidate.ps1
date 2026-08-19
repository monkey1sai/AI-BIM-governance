[CmdletBinding(DefaultParameterSetName = 'Production')]
param(
    [Parameter(Mandatory)]
    [ValidateNotNullOrEmpty()]
    [string]$OutputDirectory,

    [Parameter(ParameterSetName = 'Production')]
    [switch]$Production,

    [Parameter(Mandatory, ParameterSetName = 'Production')]
    [ValidateNotNullOrEmpty()]
    [string]$ReviewedBuildManifestPath,

    [Parameter(Mandatory, ParameterSetName = 'TestOnly')]
    [switch]$TestOnly,

    [Parameter(Mandatory, ParameterSetName = 'TestOnly')]
    [ValidateNotNullOrEmpty()]
    [string]$TestRuntimeRoot
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$packageRoot = [System.IO.Path]::GetFullPath($PSScriptRoot).TrimEnd('\')
$outputRoot = [System.IO.Path]::GetFullPath($OutputDirectory).TrimEnd('\')
$externalVerifierPath = Join-Path $packageRoot 'invoke_protected_blip_installer.ps1'
$protectedBuilderLauncherPath = Join-Path $packageRoot 'invoke_protected_blip_candidate_builder.ps1'
$protectedInstallerLauncherPath = Join-Path $packageRoot 'invoke_protected_blip_installer_launcher.ps1'
$sourceFiles = @(
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
$runtimeKeys = @(
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
# Authenticode is a publisher-provenance addition on top of the SHA-256 pins in
# $runtimeKeys, not the integrity control itself. 'runtime/codex-path/rg.exe' is
# upstream ripgrep, which ships unsigned (measured: Get-AuthenticodeSignature
# reports NotSigned), so requiring a Valid signature there can only be satisfied
# by a dishonest manifest. It keeps its runtime_source hash pin and is therefore
# still byte-exact; it is out of scope for signer binding alone.
$runtimeSignerKeys = @(
    'runtime/pwsh.exe',
    'runtime/python.exe',
    'runtime/bin/codex.exe',
    'runtime/bin/codex-code-mode-host.exe',
    'runtime/codex-resources/codex-command-runner.exe',
    'runtime/codex-resources/codex-windows-sandbox-setup.exe',
    'runtime/psmodule/Microsoft.PowerShell.Commands.Management.dll',
    'runtime/psmodule/Microsoft.PowerShell.Security.dll',
    'runtime/psmodule/Microsoft.PowerShell.Commands.Utility.dll'
)

function Assert-RegularNonReparseFile {
    param([Parameter(Mandatory)][string]$LiteralPath)
    $full = [System.IO.Path]::GetFullPath($LiteralPath)
    if (-not [System.IO.File]::Exists($full)) {
        throw "Required candidate input is unavailable: $full"
    }
    $root = [System.IO.Path]::GetPathRoot($full)
    $cursor = $full.TrimEnd('\')
    while ($true) {
        if (([System.IO.File]::GetAttributes($cursor) -band
            [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw "Candidate input resolves through a reparse point: $full"
        }
        if ($cursor.TrimEnd('\') -ceq $root.TrimEnd('\')) { break }
        $parent = [System.IO.Directory]::GetParent($cursor)
        if ($null -eq $parent) { throw "Candidate input has an invalid ancestor chain: $full" }
        $cursor = $parent.FullName
    }
    return $full
}

function Get-RegularFileSha256 {
    param([Parameter(Mandatory)][string]$LiteralPath)
    $path = Assert-RegularNonReparseFile -LiteralPath $LiteralPath
    $stream = [System.IO.FileStream]::new(
        $path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read,
        [System.IO.FileShare]::Read, 131072, [System.IO.FileOptions]::SequentialScan
    )
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try { return [Convert]::ToHexString($sha.ComputeHash($stream)) }
    finally { $sha.Dispose(); $stream.Dispose() }
}

function Get-UniqueReviewedJsonProperty {
    param(
        [Parameter(Mandatory)][System.Text.Json.JsonElement]$Object,
        [Parameter(Mandatory)][string]$Name
    )
    if ($Object.ValueKind -ne [System.Text.Json.JsonValueKind]::Object) {
        throw "Reviewed build manifest member is not an object: $Name"
    }
    $matches = @($Object.EnumerateObject() | Where-Object { $_.Name -ceq $Name })
    if ($matches.Count -ne 1) {
        throw "Reviewed build manifest must contain exactly one property named $Name."
    }
    return $matches[0].Value.Clone()
}

function Assert-ExactReviewedJsonProperties {
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
}

function Get-ReviewedStringMap {
    param(
        [Parameter(Mandatory)][System.Text.Json.JsonElement]$Object,
        [Parameter(Mandatory)][string[]]$ExpectedNames,
        [Parameter(Mandatory)][string]$Label,
        [Parameter(Mandatory)][string]$Pattern
    )
    Assert-ExactReviewedJsonProperties -Object $Object -ExpectedNames $ExpectedNames -Label $Label
    $map = [ordered]@{}
    foreach ($name in $ExpectedNames) {
        $value = Get-UniqueReviewedJsonProperty -Object $Object -Name $name
        if ($value.ValueKind -ne [System.Text.Json.JsonValueKind]::String -or
            $value.GetString() -notmatch $Pattern) {
            throw "$Label contains an invalid value for $name."
        }
        $map[$name] = $value.GetString().ToUpperInvariant()
    }
    return $map
}

function Read-ReviewedBuildManifest {
    param([Parameter(Mandatory)][string]$LiteralPath)
    $path = Assert-RegularNonReparseFile -LiteralPath $LiteralPath
    $length = [System.IO.FileInfo]::new($path).Length
    if ($length -lt 2 -or $length -gt 1048576) {
        throw 'Reviewed build manifest length is outside the protected bound.'
    }
    $bytes = [System.IO.File]::ReadAllBytes($path)
    $document = $null
    try {
        [void][System.Text.UTF8Encoding]::new($false, $true).GetString($bytes)
        $document = [System.Text.Json.JsonDocument]::Parse([ReadOnlyMemory[byte]]::new($bytes))
        $root = $document.RootElement
        Assert-ExactReviewedJsonProperties -Object $root -ExpectedNames @(
            'schema', 'source_commit', 'builder_launcher_sha256', 'builder_sha256',
            'installer_launcher_sha256', 'external_verifier_sha256',
            'source_files', 'runtime_source', 'runtime_signers'
        ) -Label 'Reviewed build manifest'
        $schema = Get-UniqueReviewedJsonProperty -Object $root -Name 'schema'
        $sourceCommit = Get-UniqueReviewedJsonProperty -Object $root -Name 'source_commit'
        $builderLauncherHash = Get-UniqueReviewedJsonProperty `
            -Object $root -Name 'builder_launcher_sha256'
        $builderHash = Get-UniqueReviewedJsonProperty -Object $root -Name 'builder_sha256'
        $installerLauncherHash = Get-UniqueReviewedJsonProperty `
            -Object $root -Name 'installer_launcher_sha256'
        $verifierHash = Get-UniqueReviewedJsonProperty -Object $root -Name 'external_verifier_sha256'
        if ($schema.ValueKind -ne [System.Text.Json.JsonValueKind]::String -or
            $schema.GetString() -cne 'blip-auto-approval-reviewed-build/v2' -or
            $sourceCommit.ValueKind -ne [System.Text.Json.JsonValueKind]::String -or
            $sourceCommit.GetString() -notmatch '^[0-9a-fA-F]{40}$' -or
            $sourceCommit.GetString() -eq ('0' * 40) -or
            $builderLauncherHash.ValueKind -ne [System.Text.Json.JsonValueKind]::String -or
            $builderLauncherHash.GetString() -notmatch '^[0-9a-fA-F]{64}$' -or
            $builderHash.ValueKind -ne [System.Text.Json.JsonValueKind]::String -or
            $builderHash.GetString() -notmatch '^[0-9a-fA-F]{64}$' -or
            $installerLauncherHash.ValueKind -ne [System.Text.Json.JsonValueKind]::String -or
            $installerLauncherHash.GetString() -notmatch '^[0-9a-fA-F]{64}$' -or
            $verifierHash.ValueKind -ne [System.Text.Json.JsonValueKind]::String -or
            $verifierHash.GetString() -notmatch '^[0-9a-fA-F]{64}$') {
            throw 'Reviewed build manifest identity fields are invalid.'
        }
        $sourceMap = Get-ReviewedStringMap `
            -Object (Get-UniqueReviewedJsonProperty -Object $root -Name 'source_files') `
            -ExpectedNames $sourceFiles -Label 'Reviewed source_files' -Pattern '^[0-9a-fA-F]{64}$'
        $runtimeMap = Get-ReviewedStringMap `
            -Object (Get-UniqueReviewedJsonProperty -Object $root -Name 'runtime_source') `
            -ExpectedNames $runtimeKeys -Label 'Reviewed runtime_source' -Pattern '^[0-9a-fA-F]{64}$'
        $signerMap = Get-ReviewedStringMap `
            -Object (Get-UniqueReviewedJsonProperty -Object $root -Name 'runtime_signers') `
            -ExpectedNames $runtimeSignerKeys -Label 'Reviewed runtime_signers' -Pattern '^[0-9a-fA-F]{40}$'
        return [pscustomobject]@{
            Path = $path
            Sha256 = [Convert]::ToHexString([System.Security.Cryptography.SHA256]::HashData($bytes))
            SourceCommit = $sourceCommit.GetString().ToLowerInvariant()
            BuilderLauncherSha256 = $builderLauncherHash.GetString().ToUpperInvariant()
            BuilderSha256 = $builderHash.GetString().ToUpperInvariant()
            InstallerLauncherSha256 = $installerLauncherHash.GetString().ToUpperInvariant()
            ExternalVerifierSha256 = $verifierHash.GetString().ToUpperInvariant()
            SourceFiles = $sourceMap
            RuntimeSource = $runtimeMap
            RuntimeSigners = $signerMap
        }
    }
    catch [System.Text.DecoderFallbackException] {
        throw 'Reviewed build manifest is not strict UTF-8.'
    }
    catch [System.Text.Json.JsonException] {
        throw 'Reviewed build manifest JSON is malformed.'
    }
    finally {
        if ($null -ne $document) { $document.Dispose() }
        [System.Security.Cryptography.CryptographicOperations]::ZeroMemory($bytes)
    }
}

function Get-CurrentIdentityAndTrustedSids {
    $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
    if ($null -eq $identity.User) { throw 'Candidate builder has no Windows owner SID.' }
    $trusted = @($identity.User.Value, 'S-1-5-18', 'S-1-5-32-544')
    if ($TestOnly) {
        $trusted += @($identity.Groups | ForEach-Object { $_.Value })
    }
    return [pscustomobject]@{
        Identity = $identity
        Trusted = @($trusted | Select-Object -Unique)
    }
}

function Get-ReplacementRightsMask {
    return [System.Security.AccessControl.FileSystemRights]::Delete -bor
        [System.Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles -bor
        [System.Security.AccessControl.FileSystemRights]::ChangePermissions -bor
        [System.Security.AccessControl.FileSystemRights]::TakeOwnership
}

function Get-CandidateMutationRightsMask {
    return [System.Security.AccessControl.FileSystemRights]::WriteData -bor
        [System.Security.AccessControl.FileSystemRights]::AppendData -bor
        [System.Security.AccessControl.FileSystemRights]::WriteAttributes -bor
        [System.Security.AccessControl.FileSystemRights]::WriteExtendedAttributes -bor
        (Get-ReplacementRightsMask)
}

function Get-NormalizedAncestorPath {
    # A bare Windows drive specifier ('C:') is a drive-RELATIVE path, not the
    # drive root: Get-Acl and File.GetAttributes resolve it against the process
    # working directory. An ancestor walk that trims the trailing separator off
    # the root therefore stops inspecting the drive root and silently inspects
    # the caller's working directory instead. Keep the root's separator; trim it
    # everywhere else so ancestors compare exactly.
    param([Parameter(Mandatory)][string]$LiteralPath)
    $trimmed = ([string]$LiteralPath).TrimEnd('\')
    if ($trimmed -cmatch '^[A-Za-z]:$') { return $trimmed + '\' }
    return $trimmed
}

function Test-LocalDriveRootPath {
    param([Parameter(Mandatory)][string]$LiteralPath)
    return ([string]$LiteralPath) -cmatch '^[A-Za-z]:\\$'
}

function Assert-TrustedAncestorChain {
    param(
        [Parameter(Mandatory)][string]$LiteralPath,
        [Parameter(Mandatory)][AllowEmptyCollection()][string[]]$TrustedSids,
        [switch]$SkipAclInspection
    )
    $cursor = Get-NormalizedAncestorPath -LiteralPath ([System.IO.Path]::GetFullPath($LiteralPath))
    while ($true) {
        if (([System.IO.File]::GetAttributes($cursor) -band
            [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw "Candidate output parent resolves through a reparse point: $cursor"
        }
        # The replacement-rights rule exists because a principal able to delete,
        # rename, or re-ACL an ancestor directory can substitute the whole
        # candidate path underneath it. A local drive root can be neither
        # deleted nor renamed, so its Windows-default inherited ACEs cannot
        # enable that substitution and the root itself is exempt. Every
        # intermediate ancestor stays fully inspected, inherited ACEs included,
        # and non-drive roots (UNC shares) are not exempt.
        if (-not $SkipAclInspection -and -not (Test-LocalDriveRootPath -LiteralPath $cursor)) {
            $acl = Get-Acl -LiteralPath $cursor
            foreach ($rule in $acl.Access) {
                if ($rule.AccessControlType -ne [System.Security.AccessControl.AccessControlType]::Allow -or
                    ($rule.FileSystemRights -band (Get-ReplacementRightsMask)) -eq 0) {
                    continue
                }
                try {
                    $sid = $rule.IdentityReference.Translate(
                        [System.Security.Principal.SecurityIdentifier]
                    ).Value
                }
                catch { throw "Candidate output parent has an unresolvable replacement identity: $cursor" }
                if ($TrustedSids -notcontains $sid) {
                    throw "Untrusted SID $sid has replacement rights on candidate output ancestor: $cursor"
                }
            }
        }
        $next = [System.IO.Directory]::GetParent($cursor)
        if ($null -eq $next) { break }
        $parentPath = Get-NormalizedAncestorPath -LiteralPath $next.FullName
        # Every real ancestor is strictly shorter than its child. Requiring that
        # keeps the walk provably terminating instead of looping forever if a
        # path form ever resolves to something other than an ancestor.
        if ($parentPath.Length -ge $cursor.Length) {
            throw "Candidate output parent has an invalid ancestor chain: $cursor"
        }
        $cursor = $parentPath
    }
}

function Assert-TrustedOutputParent {
    param([Parameter(Mandatory)][string]$LiteralPath)
    $parent = Get-NormalizedAncestorPath -LiteralPath ([System.IO.Path]::GetFullPath($LiteralPath))
    if (-not [System.IO.Directory]::Exists($parent)) {
        throw 'Candidate output parent must already exist.'
    }
    $identityState = Get-CurrentIdentityAndTrustedSids
    if (-not $TestOnly) {
        $sandboxSid = Get-SandboxSidIfAvailable
        if ($null -eq $sandboxSid) {
            throw 'Production candidate output parent cannot resolve the Codex sandbox SID.'
        }
        $denied = [System.Security.AccessControl.FileSystemRights]0
        foreach ($rule in (Get-Acl -LiteralPath $parent).Access) {
            try {
                $sid = $rule.IdentityReference.Translate(
                    [System.Security.Principal.SecurityIdentifier]
                ).Value
            }
            catch { continue }
            if ($sid -ceq $sandboxSid.Value -and
                $rule.AccessControlType -eq [System.Security.AccessControl.AccessControlType]::Deny) {
                $denied = $denied -bor $rule.FileSystemRights
            }
        }
        $requiredDeny = Get-CandidateMutationRightsMask
        if (($denied -band $requiredDeny) -ne $requiredDeny) {
            throw 'Production candidate output parent must explicitly deny CodexSandboxUsers mutation rights.'
        }
    }
    Assert-TrustedAncestorChain -LiteralPath $parent `
        -TrustedSids $identityState.Trusted -SkipAclInspection:$TestOnly
    return $parent
}

if (-not ('BlipCandidateBuilder.NativeMethods' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;

namespace BlipCandidateBuilder {
    public static class NativeMethods {
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        public static extern SafeFileHandle CreateFileW(
            string name, uint access, uint share, IntPtr security,
            uint creation, uint flags, IntPtr templateFile);
    }
}
'@
}

function Open-PinnedOutputParent {
    param([Parameter(Mandatory)][string]$LiteralPath)
    $handle = [BlipCandidateBuilder.NativeMethods]::CreateFileW(
        $LiteralPath,
        0x00000080,
        0x00000003,
        [IntPtr]::Zero,
        3,
        0x02200000,
        [IntPtr]::Zero
    )
    if ($null -eq $handle -or $handle.IsInvalid) {
        $errorCode = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
        if ($null -ne $handle) { $handle.Dispose() }
        throw [ComponentModel.Win32Exception]::new(
            $errorCode, 'Cannot pin the candidate output parent against replacement.'
        )
    }
    return $handle
}

function Get-SandboxSidIfAvailable {
    try {
        return ([System.Security.Principal.NTAccount]::new(
            [Environment]::MachineName + '\CodexSandboxUsers'
        )).Translate([System.Security.Principal.SecurityIdentifier])
    }
    catch { return $null }
}

function New-CandidateDirectorySecurity {
    $identityState = Get-CurrentIdentityAndTrustedSids
    $identity = $identityState.Identity
    $sandboxSid = Get-SandboxSidIfAvailable
    if (-not $TestOnly -and $null -ne $sandboxSid -and
        @($identity.Groups | ForEach-Object { $_.Value }) -contains $sandboxSid.Value) {
        throw 'Production candidate builder cannot run inside the Codex sandbox identity boundary.'
    }
    $security = [System.Security.AccessControl.DirectorySecurity]::new()
    $security.SetOwner($identity.User)
    $security.SetAccessRuleProtection($true, $false)
    $inheritance = [System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor
        [System.Security.AccessControl.InheritanceFlags]::ObjectInherit
    if (-not $TestOnly -and $null -ne $sandboxSid) {
        $security.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new(
            $sandboxSid,
            [System.Security.AccessControl.FileSystemRights]::FullControl,
            $inheritance,
            [System.Security.AccessControl.PropagationFlags]::None,
            [System.Security.AccessControl.AccessControlType]::Deny
        ))
    }
    foreach ($sidValue in $identityState.Trusted) {
        $security.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new(
            [System.Security.Principal.SecurityIdentifier]::new($sidValue),
            [System.Security.AccessControl.FileSystemRights]::FullControl,
            $inheritance,
            [System.Security.AccessControl.PropagationFlags]::None,
            [System.Security.AccessControl.AccessControlType]::Allow
        ))
    }
    return $security
}

function Assert-CandidateRootAcl {
    param([Parameter(Mandatory)][string]$LiteralPath)
    if (([System.IO.File]::GetAttributes($LiteralPath) -band
        [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw 'Candidate output root is a reparse point.'
    }
    $identityState = Get-CurrentIdentityAndTrustedSids
    $acl = Get-Acl -LiteralPath $LiteralPath
    $ownerSid = ([System.Security.Principal.NTAccount]$acl.Owner).Translate(
        [System.Security.Principal.SecurityIdentifier]
    ).Value
    if (-not $acl.AreAccessRulesProtected -or $ownerSid -cne $identityState.Identity.User.Value) {
        throw 'Candidate output root is not protected and owner-bound.'
    }
    foreach ($rule in $acl.Access) {
        if ($rule.AccessControlType -ne [System.Security.AccessControl.AccessControlType]::Allow -or
            ($rule.FileSystemRights -band (Get-ReplacementRightsMask)) -eq 0) {
            continue
        }
        $sid = $rule.IdentityReference.Translate(
            [System.Security.Principal.SecurityIdentifier]
        ).Value
        if ($identityState.Trusted -notcontains $sid) {
            throw "Untrusted SID $sid can replace candidate output content."
        }
    }
}

function New-SafeCandidateParent {
    param([Parameter(Mandatory)][string]$Target)
    $fullTarget = [System.IO.Path]::GetFullPath($Target)
    if (-not $fullTarget.StartsWith($outputRoot + '\', [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Candidate target escapes the protected output root.'
    }
    $relativeParent = [System.IO.Path]::GetRelativePath(
        $outputRoot, [System.IO.Path]::GetDirectoryName($fullTarget)
    )
    $cursor = $outputRoot
    $segments = if ($relativeParent -ceq '.') {
        @()
    }
    else {
        @($relativeParent.Split('\', [StringSplitOptions]::RemoveEmptyEntries))
    }
    foreach ($segment in $segments) {
        if ($segment -in @('.', '..')) { throw 'Candidate target parent is malformed.' }
        if (([System.IO.File]::GetAttributes($cursor) -band
            [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw "Candidate output resolves through a reparse point: $cursor"
        }
        $next = Join-Path $cursor $segment
        if ([System.IO.File]::Exists($next)) {
            throw "Candidate output parent collides with a file: $next"
        }
        if (-not [System.IO.Directory]::Exists($next)) {
            [System.IO.Directory]::CreateDirectory($next) | Out-Null
        }
        if (([System.IO.File]::GetAttributes($next) -band
            [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw "Candidate output resolves through a reparse point: $next"
        }
        $cursor = $next
    }
    Assert-CandidateRootAcl -LiteralPath $outputRoot
    return $cursor
}

function Copy-RegularFileExclusive {
    param(
        [Parameter(Mandatory)][string]$Source,
        [Parameter(Mandatory)][string]$Target
    )
    $sourcePath = Assert-RegularNonReparseFile -LiteralPath $Source
    $parent = New-SafeCandidateParent -Target $Target
    $input = [System.IO.FileStream]::new(
        $sourcePath, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read,
        [System.IO.FileShare]::Read, 131072, [System.IO.FileOptions]::SequentialScan
    )
    $output = $null
    try {
        $output = [System.IO.FileStream]::new(
            $Target, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write,
            [System.IO.FileShare]::None, 131072, [System.IO.FileOptions]::SequentialScan
        )
        $input.CopyTo($output)
        $output.Flush($true)
    }
    finally {
        if ($output) { $output.Dispose() }
        $input.Dispose()
    }
}

function Write-Utf8FileExclusive {
    param(
        [Parameter(Mandatory)][string]$Target,
        [Parameter(Mandatory)][string]$Content
    )
    [void](New-SafeCandidateParent -Target $Target)
    $bytes = [System.Text.UTF8Encoding]::new($false).GetBytes($Content)
    $stream = [System.IO.FileStream]::new(
        $Target, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write,
        [System.IO.FileShare]::None, 131072, [System.IO.FileOptions]::SequentialScan
    )
    try {
        $stream.Write($bytes, 0, $bytes.Length)
        $stream.Flush($true)
    }
    finally { $stream.Dispose() }
}

if ($outputRoot.StartsWith($packageRoot + '\', [StringComparison]::OrdinalIgnoreCase) -or
    $outputRoot -ceq $packageRoot) {
    throw 'Candidate output must be outside the source package tree.'
}
[void](Assert-RegularNonReparseFile -LiteralPath $externalVerifierPath)
[void](Assert-RegularNonReparseFile -LiteralPath $protectedBuilderLauncherPath)
[void](Assert-RegularNonReparseFile -LiteralPath $protectedInstallerLauncherPath)
$reviewedBuild = $null
$reviewedManifestSha256 = '0' * 64
$sourceCommit = '0' * 40
if (-not $TestOnly) {
    $reviewedBuild = Read-ReviewedBuildManifest -LiteralPath $ReviewedBuildManifestPath
    $reviewedManifestSha256 = $reviewedBuild.Sha256
    $sourceCommit = $reviewedBuild.SourceCommit
    if ((Get-RegularFileSha256 -LiteralPath $PSCommandPath) -cne $reviewedBuild.BuilderSha256) {
        throw 'The running candidate builder differs from the reviewed build manifest.'
    }
    if ((Get-RegularFileSha256 -LiteralPath $protectedBuilderLauncherPath) -cne
        $reviewedBuild.BuilderLauncherSha256) {
        throw 'The protected builder launcher differs from the reviewed build manifest.'
    }
    if ((Get-RegularFileSha256 -LiteralPath $protectedInstallerLauncherPath) -cne
        $reviewedBuild.InstallerLauncherSha256) {
        throw 'The protected installer launcher differs from the reviewed build manifest.'
    }
    if ((Get-RegularFileSha256 -LiteralPath $externalVerifierPath) -cne
        $reviewedBuild.ExternalVerifierSha256) {
        throw 'The external installer verifier differs from the reviewed build manifest.'
    }
}
$outputParent = [System.IO.Path]::GetDirectoryName($outputRoot)
[void](Assert-TrustedOutputParent -LiteralPath $outputParent)
$outputParentHandle = Open-PinnedOutputParent -LiteralPath $outputParent
try {
    [void](Assert-TrustedOutputParent -LiteralPath $outputParent)
    if ([System.IO.File]::Exists($outputRoot) -or [System.IO.Directory]::Exists($outputRoot)) {
        throw 'Candidate output directory must not already exist.'
    }
    [void][System.IO.FileSystemAclExtensions]::CreateDirectory(
        (New-CandidateDirectorySecurity), $outputRoot
    )
    Assert-CandidateRootAcl -LiteralPath $outputRoot

    if (-not $TestOnly) {
        $reviewedManifestTarget = Join-Path $outputRoot 'reviewed-build-manifest.json'
        Copy-RegularFileExclusive -Source $reviewedBuild.Path -Target $reviewedManifestTarget
        if ((Get-RegularFileSha256 -LiteralPath $reviewedManifestTarget) -cne
            $reviewedManifestSha256) {
            throw 'The copied reviewed build manifest differs from its protected input.'
        }
    }

$frozenSources = [ordered]@{}
foreach ($relative in $sourceFiles) {
    $source = Join-Path $packageRoot $relative.Replace('/', '\')
    $target = Join-Path $outputRoot $relative.Replace('/', '\')
    Copy-RegularFileExclusive -Source $source -Target $target
    $sourceHash = Get-RegularFileSha256 -LiteralPath $source
    $targetHash = Get-RegularFileSha256 -LiteralPath $target
    if ($targetHash -cne $sourceHash) {
        throw "Candidate copy hash mismatch: $relative"
    }
    if (-not $TestOnly -and $targetHash -cne $reviewedBuild.SourceFiles[$relative]) {
        throw "Candidate source differs from the independently reviewed manifest: $relative"
    }
    $frozenSources[$relative] = $targetHash
}

$runtimePaths = [ordered]@{}
if ($TestOnly) {
    $fixtureRoot = [System.IO.Path]::GetFullPath($TestRuntimeRoot).TrimEnd('\')
    if (-not [System.IO.Directory]::Exists($fixtureRoot)) {
        throw 'Test-only runtime fixture root is unavailable.'
    }
    foreach ($key in $runtimeKeys) {
        $runtimePaths[$key] = Join-Path $fixtureRoot $key.Substring('runtime/'.Length).Replace('/', '\')
    }
}
else {
    $codexVendorRoot = 'C:\Users\IOT\AppData\Roaming\npm\node_modules\@openai\codex\node_modules\@openai\codex-win32-x64\vendor\x86_64-pc-windows-msvc'
    $runtimePaths = [ordered]@{
        'runtime/pwsh.exe' = 'C:\Program Files\PowerShell\7\pwsh.exe'
        'runtime/python.exe' = 'C:\Program Files\Python312\python.exe'
        'runtime/codex-package.json' = (Join-Path $codexVendorRoot 'codex-package.json')
        'runtime/bin/codex.exe' = (Join-Path $codexVendorRoot 'bin\codex.exe')
        'runtime/bin/codex-code-mode-host.exe' = (Join-Path $codexVendorRoot 'bin\codex-code-mode-host.exe')
        'runtime/codex-path/rg.exe' = (Join-Path $codexVendorRoot 'codex-path\rg.exe')
        'runtime/codex-resources/codex-command-runner.exe' = (Join-Path $codexVendorRoot 'codex-resources\codex-command-runner.exe')
        'runtime/codex-resources/codex-windows-sandbox-setup.exe' = (Join-Path $codexVendorRoot 'codex-resources\codex-windows-sandbox-setup.exe')
        'runtime/psmodule/Microsoft.PowerShell.Management.psd1' = 'C:\Program Files\PowerShell\7\Modules\Microsoft.PowerShell.Management\Microsoft.PowerShell.Management.psd1'
        'runtime/psmodule/Microsoft.PowerShell.Security.psd1' = 'C:\Program Files\PowerShell\7\Modules\Microsoft.PowerShell.Security\Microsoft.PowerShell.Security.psd1'
        'runtime/psmodule/Security.types.ps1xml' = 'C:\Program Files\PowerShell\7\Modules\Microsoft.PowerShell.Security\Security.types.ps1xml'
        'runtime/psmodule/Microsoft.PowerShell.Utility.psd1' = 'C:\Program Files\PowerShell\7\Modules\Microsoft.PowerShell.Utility\Microsoft.PowerShell.Utility.psd1'
        'runtime/psmodule/Microsoft.PowerShell.Commands.Management.dll' = 'C:\Program Files\PowerShell\7\Microsoft.PowerShell.Commands.Management.dll'
        'runtime/psmodule/Microsoft.PowerShell.Security.dll' = 'C:\Program Files\PowerShell\7\Microsoft.PowerShell.Security.dll'
        'runtime/psmodule/Microsoft.PowerShell.Commands.Utility.dll' = 'C:\Program Files\PowerShell\7\Microsoft.PowerShell.Commands.Utility.dll'
    }
}

$frozenRuntime = [ordered]@{}
foreach ($key in $runtimeKeys) {
    if (-not $runtimePaths.Contains($key)) { throw "Runtime map is missing exact key: $key" }
    $frozenRuntime[$key] = Get-RegularFileSha256 -LiteralPath $runtimePaths[$key]
    if (-not $TestOnly -and $frozenRuntime[$key] -cne $reviewedBuild.RuntimeSource[$key]) {
        throw "Runtime source differs from the independently reviewed manifest: $key"
    }
}
if ($runtimePaths.Count -ne $runtimeKeys.Count) {
    throw 'Runtime map contains an unexpected key.'
}

if (-not $TestOnly) {
    foreach ($key in $runtimeSignerKeys) {
        $signature = Microsoft.PowerShell.Security\Get-AuthenticodeSignature `
            -LiteralPath $runtimePaths[$key]
        if ($signature.Status -ne [System.Management.Automation.SignatureStatus]::Valid -or
            $null -eq $signature.SignerCertificate -or
            $signature.SignerCertificate.Thumbprint -cne $reviewedBuild.RuntimeSigners[$key]) {
            throw "Runtime signer differs from the independently reviewed manifest: $key"
        }
    }
}

$freeze = [ordered]@{
    schema = 'blip-auto-approval-candidate-freeze/v3'
    build_profile = $(if ($TestOnly) { 'TEST_ONLY' } else { 'PRODUCTION' })
    source_commit = $sourceCommit
    reviewed_build_manifest_sha256 = $reviewedManifestSha256
    external_verifier_sha256 = Get-RegularFileSha256 -LiteralPath $externalVerifierPath
    source_files = $frozenSources
    runtime_source = $frozenRuntime
}
$freezePath = Join-Path $outputRoot 'candidate-freeze.json'
$freezeJson = ($freeze | ConvertTo-Json -Depth 6 -Compress) + "`n"
Write-Utf8FileExclusive -Target $freezePath -Content $freezeJson

$freezeHash = Get-RegularFileSha256 -LiteralPath $freezePath
Write-Output "BLIP_CANDIDATE_ROOT=$outputRoot"
Write-Output "BLIP_CANDIDATE_PROFILE=$($freeze.build_profile)"
Write-Output "BLIP_CANDIDATE_FREEZE_SHA256=$freezeHash"
Write-Output "BLIP_CANDIDATE_INSTALLER_SHA256=$($frozenSources['install_blip_auto_approval.ps1'])"
Write-Output "BLIP_CANDIDATE_BOOTSTRAP_SHA256=$($frozenSources['invoke_frozen_blip_installer.ps1'])"
Write-Output "BLIP_EXTERNAL_VERIFIER_SHA256=$($freeze.external_verifier_sha256)"
Write-Output "BLIP_EXTERNAL_INSTALLER_LAUNCHER_SHA256=$(Get-RegularFileSha256 -LiteralPath $protectedInstallerLauncherPath)"
Write-Output "BLIP_REVIEWED_BUILD_MANIFEST_SHA256=$reviewedManifestSha256"
Write-Output "BLIP_CANDIDATE_SOURCE_COMMIT=$sourceCommit"
}
finally {
    $outputParentHandle.Dispose()
}
