#Requires -Version 7.0
<#
provision_blip_protection_admin_token.ps1

Owner-side provisioning helper for the read-only branch-protection credential
consumed by the protected approval broker
(`bot/scripts/run_blip_live_approve_once.ps1`).

Why this exists: the broker's `Assert-ProtectedSecretAcl` requires the token
file to carry a protected (non-inherited) ACL owned by the fixed owner SID,
with Allow rules only for the owner/SYSTEM/Administrators and an explicit
FullControl denial for CodexSandboxUsers. A file created normally inside the
installer-created `secrets` directory inherits its parent's ACEs, so
`AreAccessRulesProtected` is false and the broker fails closed. This helper
writes the credential with the exact owner-only protected security descriptor
from the moment of creation (no inherited-ACL window), mirroring the
installer's `New-OwnerOnlyFileSecurity` recipe, then re-validates the result
against the same rules the broker enforces.

The credential is a real secret. It is accepted only through the masked
prompt, is never printed, logged, echoed, or placed on a command line, and
this helper performs no network request with it. `-AclOnly` re-applies the
protected security descriptor to an existing file without reading its
contents.
#>
[CmdletBinding()]
param(
    [string]$TokenPath = 'C:\ProgramData\AI-BIM-governance\blip-approve\secrets\blip-protection-admin-token.v1.txt',
    [switch]$AclOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$fixedOwnerSidValue = 'S-1-5-21-2135046472-1977311562-3864793309-1001'
$fixedOwnerSid = [System.Security.Principal.SecurityIdentifier]::new($fixedOwnerSidValue)

function Get-SandboxSid {
    return ([System.Security.Principal.NTAccount]::new(
        [Environment]::MachineName + '\CodexSandboxUsers'
    )).Translate([System.Security.Principal.SecurityIdentifier])
}

function Assert-FixedOwnerIdentity {
    $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
    if ($identity.User.Value -cne $fixedOwnerSidValue) {
        throw 'The provisioning identity is not the immutable owner SID.'
    }
    $sandboxSid = Get-SandboxSid
    foreach ($group in $identity.Groups) {
        if ($group.Value -ceq $sandboxSid.Value) {
            throw 'The provisioning identity is a CodexSandboxUsers member; trust separation is absent.'
        }
    }
    return $identity
}

function New-OwnerOnlyTokenFileSecurity {
    [void](Assert-FixedOwnerIdentity)
    $sandboxSid = Get-SandboxSid
    $security = [System.Security.AccessControl.FileSecurity]::new()
    $security.SetOwner($fixedOwnerSid)
    $security.SetAccessRuleProtection($true, $false)
    $security.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new(
        $sandboxSid,
        [System.Security.AccessControl.FileSystemRights]::FullControl,
        [System.Security.AccessControl.AccessControlType]::Deny
    ))
    foreach ($sid in @(
        $fixedOwnerSid,
        [System.Security.Principal.SecurityIdentifier]::new('S-1-5-18'),
        [System.Security.Principal.SecurityIdentifier]::new('S-1-5-32-544')
    )) {
        $security.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new(
            $sid,
            [System.Security.AccessControl.FileSystemRights]::FullControl,
            [System.Security.AccessControl.AccessControlType]::Allow
        ))
    }
    return $security
}

function Assert-ProvisionedTokenAcl {
    # Mirrors the broker's Assert-ProtectedSecretAcl file rules so a
    # provisioning mistake fails here instead of at approval time. The broker
    # remains the runtime authority and re-validates independently.
    param([Parameter(Mandatory)][string]$LiteralPath)
    $sandboxSid = (Get-SandboxSid).Value
    $item = Get-Item -Force -LiteralPath $LiteralPath
    if ($item.PSIsContainer -or ($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw "Provisioned credential is not a regular non-reparse file: $LiteralPath"
    }
    $acl = Get-Acl -LiteralPath $LiteralPath
    if (-not $acl.AreAccessRulesProtected) {
        throw "Provisioned credential ACL inherits from its parent: $LiteralPath"
    }
    $ownerSid = ([System.Security.Principal.NTAccount]$acl.Owner).Translate(
        [System.Security.Principal.SecurityIdentifier]
    ).Value
    if ($ownerSid -cne $fixedOwnerSidValue) {
        throw "Provisioned credential owner is not the immutable owner SID: $LiteralPath"
    }
    $trustedReaderSids = @($fixedOwnerSidValue, 'S-1-5-18', 'S-1-5-32-544')
    $sensitiveMask = [System.Security.AccessControl.FileSystemRights]::FullControl
    $sandboxDenied = [System.Security.AccessControl.FileSystemRights]0
    foreach ($rule in $acl.Access) {
        $overlap = $rule.FileSystemRights -band $sensitiveMask
        $ruleSid = $rule.IdentityReference.Translate(
            [System.Security.Principal.SecurityIdentifier]
        ).Value
        if ($rule.AccessControlType -eq [System.Security.AccessControl.AccessControlType]::Allow -and
            $overlap -ne 0 -and $trustedReaderSids -notcontains $ruleSid) {
            throw "Untrusted SID $ruleSid can access the provisioned credential: $LiteralPath"
        }
        if ($ruleSid -ceq $sandboxSid -and
            $rule.AccessControlType -eq [System.Security.AccessControl.AccessControlType]::Deny -and
            -not $rule.IsInherited) {
            $sandboxDenied = $sandboxDenied -bor $overlap
        }
    }
    if (($sandboxDenied -band $sensitiveMask) -ne $sensitiveMask) {
        throw "CodexSandboxUsers lacks an explicit complete denial on the provisioned credential: $LiteralPath"
    }
}

[void](Assert-FixedOwnerIdentity)
$fullTokenPath = [System.IO.Path]::GetFullPath($TokenPath)
$parentPath = Split-Path -Parent $fullTokenPath
if (-not (Test-Path -LiteralPath $parentPath -PathType Container)) {
    throw "The secrets directory does not exist (run the protected installer first): $parentPath"
}
$parentItem = Get-Item -Force -LiteralPath $parentPath
if (($parentItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
    throw "The secrets directory is a reparse point: $parentPath"
}

$security = New-OwnerOnlyTokenFileSecurity
if ($AclOnly) {
    if (-not (Test-Path -LiteralPath $fullTokenPath -PathType Leaf)) {
        throw "No existing credential file to re-protect: $fullTokenPath"
    }
    [System.IO.FileSystemAclExtensions]::SetAccessControl(
        [System.IO.FileInfo]::new($fullTokenPath), $security
    )
}
else {
    if (Test-Path -LiteralPath $fullTokenPath) {
        throw "The credential file already exists; remove it explicitly or use -AclOnly: $fullTokenPath"
    }
    Write-Information 'Enter the READ-ONLY branch-protection admin credential only in the masked prompt.' -InformationAction Continue
    Write-Information 'It must differ from BLIP_GITHUB_TOKEN and needs only repository Administration: read.' -InformationAction Continue
    $secureToken = Read-Host -Prompt 'Enter blip-protection-admin-token' -AsSecureString
    if ($null -eq $secureToken -or $secureToken.Length -eq 0) { throw 'No credential was entered.' }
    $tokenBstr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureToken)
    $stream = $null
    try {
        $plainToken = [System.Runtime.InteropServices.Marshal]::PtrToStringBSTR($tokenBstr)
        if ([string]::IsNullOrWhiteSpace($plainToken)) { throw 'No credential was entered.' }
        $plainToken = $plainToken.Trim()
        if ($plainToken.Length -lt 32 -or $plainToken.Length -gt 4096 -or
            $plainToken -notmatch '^[!-~]+$') {
            throw 'The credential is empty, malformed, or oversized (expected 32..4096 printable ASCII characters).'
        }
        $stream = [System.IO.FileSystemAclExtensions]::Create(
            [System.IO.FileInfo]::new($fullTokenPath),
            [System.IO.FileMode]::CreateNew,
            ([System.Security.AccessControl.FileSystemRights]::WriteData -bor
                [System.Security.AccessControl.FileSystemRights]::ReadPermissions),
            [System.IO.FileShare]::None,
            4096,
            [System.IO.FileOptions]::WriteThrough,
            $security
        )
        $tokenBytes = [System.Text.UTF8Encoding]::new($false).GetBytes($plainToken + "`n")
        try {
            $stream.Write($tokenBytes, 0, $tokenBytes.Length)
            $stream.Flush($true)
        }
        finally {
            [Array]::Clear($tokenBytes, 0, $tokenBytes.Length)
        }
    }
    finally {
        if ($null -ne $stream) { $stream.Dispose() }
        [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($tokenBstr)
        $plainToken = $null
    }
}

Assert-ProvisionedTokenAcl -LiteralPath $fullTokenPath
$mode = if ($AclOnly) { 'acl-only' } else { 'created' }
Write-Output "PROVISION_RESULT mode=$mode path=$fullTokenPath acl=owner-only-protected sandbox_deny=FullControl"
