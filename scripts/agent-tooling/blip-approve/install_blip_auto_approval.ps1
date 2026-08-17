[CmdletBinding(DefaultParameterSetName = 'Audit')]
param(
    [Parameter(ParameterSetName = 'Apply', Mandatory)]
    [switch]$Apply,

    [Parameter(ParameterSetName = 'Apply', Mandatory)]
    [ValidatePattern('^[0-9A-Fa-f]{64}$')]
    [string]$ExpectedFreezeSha256,

    [Parameter(ParameterSetName = 'Apply', Mandatory)]
    [ValidatePattern('^[0-9A-Fa-f]{64}$')]
    [string]$ExpectedInstallerSha256,

    [Parameter(ParameterSetName = 'Apply', Mandatory)]
    [ValidatePattern('^[0-9A-Fa-f]{64}$')]
    [string]$ExpectedReviewedBuildManifestSha256,

    [Parameter(ParameterSetName = 'Apply', Mandatory)]
    [ValidatePattern('^[0-9A-Fa-f]{64}$')]
    [string]$ExpectedBootstrapSha256,

    [Parameter(ParameterSetName = 'Apply', Mandatory)]
    [Parameter(ParameterSetName = 'Audit')]
    [ValidateNotNullOrEmpty()]
    [string]$CandidateRoot = $PSScriptRoot,

    [Parameter(ParameterSetName = 'Apply', Mandatory)]
    [ValidateNotNull()]
    [object]$BootstrapContext
)

Microsoft.PowerShell.Core\Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# This installer publishes only the security boundary.  Editable bot sources,
# skills, and repository docs are synchronized separately after this runtime is
# installed and verified; they are never executed for a counted approval.
$candidateRoot = [System.IO.Path]::GetFullPath($CandidateRoot).TrimEnd('\')
$freezePath = Join-Path $candidateRoot 'candidate-freeze.json'
$installerPath = Join-Path $candidateRoot 'install_blip_auto_approval.ps1'
$bootstrapPath = Join-Path $candidateRoot 'invoke_frozen_blip_installer.ps1'
$reviewedManifestPath = Join-Path $candidateRoot 'reviewed-build-manifest.json'
$protectedRoot = 'C:\ProgramData\AI-BIM-governance'
$productRoot = Join-Path $protectedRoot 'blip-approve'
$secretRoot = Join-Path $productRoot 'secrets'
$trustedRoot = Join-Path $productRoot 'v1'
$completionPath = Join-Path $trustedRoot 'install-complete.json'
$stageRoot = Join-Path $productRoot ("v1.stage-" + [Guid]::NewGuid().ToString('N'))
$failedRoot = Join-Path $productRoot ("v1.failed-" + [Guid]::NewGuid().ToString('N'))
$pythonPath = 'C:\Program Files\Python312\python.exe'
$powerShellPath = 'C:\Program Files\PowerShell\7\pwsh.exe'
$fixedOwnerSidValue = 'S-1-5-21-2135046472-1977311562-3864793309-1001'
$fixedOwnerSid = [System.Security.Principal.SecurityIdentifier]::new($fixedOwnerSidValue)
$codexVendorRoot = 'C:\Users\IOT\AppData\Roaming\npm\node_modules\@openai\codex\node_modules\@openai\codex-win32-x64\vendor\x86_64-pc-windows-msvc'
$pinnedStreams = [System.Collections.Generic.List[System.IO.FileStream]]::new()
$sourceStreams = @{}
$runtimeStreams = @{}

$trustedFiles = [ordered]@{
    'run_blip_live_approve_once.ps1' = 'bot/scripts/run_blip_live_approve_once.ps1'
    'blip_review.py' = 'bot/scripts/blip_review.py'
    'app_auth.py' = 'bot/scripts/app_auth.py'
    'run_codex_bound_ship_gate_once.ps1' = 'bot/scripts/run_codex_bound_ship_gate_once.ps1'
    'bind_ship_attestation.py' = 'bot/scripts/bind_ship_attestation.py'
    'bots.json' = 'bot/bots.json'
    'app-scripts/collect_ship_gate_packet.py' = 'bot/scripts/collect_ship_gate_packet.py'
    'app-scripts/codex_ship_gate.py' = 'bot/scripts/codex_ship_gate.py'
    'app-scripts/ship_gate_packet.py' = 'bot/scripts/ship_gate_packet.py'
    'app-scripts/post_review.py' = 'bot/scripts/post_review.py'
    'app-scripts/app_auth.py' = 'bot/scripts/app_auth.py'
}
$runtimeFiles = [ordered]@{
    'runtime/pwsh.exe' = $powerShellPath
    'runtime/python.exe' = $pythonPath
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

function Resolve-CandidatePath {
    param([Parameter(Mandatory)][string]$RelativePath)
    $root = [System.IO.Path]::GetFullPath($candidateRoot).TrimEnd('\')
    $resolved = [System.IO.Path]::GetFullPath((Join-Path $root $RelativePath))
    if (-not $resolved.StartsWith($root + '\', [StringComparison]::OrdinalIgnoreCase)) {
        throw "Candidate path escapes the staged root: $RelativePath"
    }
    $cursor = $resolved
    while ($cursor.Length -ge $root.Length) {
        $item = Get-Item -Force -LiteralPath $cursor
        if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw "Candidate input resolves through a reparse point: $RelativePath"
        }
        if ($cursor -ceq $root) { break }
        $cursor = Split-Path -Parent $cursor
    }
    return $resolved
}

function Open-PinnedReadStream {
    param([Parameter(Mandatory)][string]$LiteralPath)
    $item = Get-Item -Force -LiteralPath $LiteralPath
    if ($item.PSIsContainer -or ($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw "Pinned input is not a regular non-reparse file: $LiteralPath"
    }
    $stream = [System.IO.FileStream]::new(
        $LiteralPath,
        [System.IO.FileMode]::Open,
        [System.IO.FileAccess]::Read,
        [System.IO.FileShare]::Read,
        131072,
        [System.IO.FileOptions]::SequentialScan
    )
    $pinnedStreams.Add($stream)
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
    finally {
        $Stream.Position = $position
        $sha.Dispose()
    }
}

function Read-OpenStreamUtf8 {
    param([Parameter(Mandatory)][System.IO.FileStream]$Stream)
    $position = $Stream.Position
    $reader = $null
    try {
        $Stream.Position = 0
        $reader = [System.IO.StreamReader]::new(
            $Stream, [System.Text.UTF8Encoding]::new($false, $true), $false, 4096, $true
        )
        return $reader.ReadToEnd()
    }
    finally {
        if ($reader) { $reader.Dispose() }
        $Stream.Position = $position
    }
}

function Get-UniqueJsonProperty {
    param(
        [Parameter(Mandatory)][System.Text.Json.JsonElement]$Object,
        [Parameter(Mandatory)][string]$Name
    )
    if ($Object.ValueKind -ne [System.Text.Json.JsonValueKind]::Object) {
        throw "Candidate JSON member is not an object: $Name"
    }
    $count = 0
    $match = [System.Text.Json.JsonElement]::new()
    foreach ($property in $Object.EnumerateObject()) {
        if ($property.Name -ceq $Name) { $count += 1; $match = $property.Value.Clone() }
    }
    if ($count -ne 1) { throw "Candidate JSON must contain exactly one property named $Name." }
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

function Assert-ExactHashObject {
    param(
        [Parameter(Mandatory)][System.Text.Json.JsonElement]$Object,
        [Parameter(Mandatory)][string[]]$ExpectedNames,
        [Parameter(Mandatory)][string]$Label
    )
    Assert-ExactJsonProperties -Object $Object -ExpectedNames $ExpectedNames -Label $Label
    foreach ($name in $ExpectedNames) {
        $value = Get-UniqueJsonProperty -Object $Object -Name $name
        if ($value.ValueKind -ne [System.Text.Json.JsonValueKind]::String -or
            $value.GetString() -notmatch '^[0-9A-F]{64}$') {
            throw "$Label contains a malformed SHA-256 value."
        }
    }
}

function Copy-PinnedStream {
    param(
        [Parameter(Mandatory)][System.IO.FileStream]$Source,
        [Parameter(Mandatory)][string]$Target,
        [Parameter(Mandatory)][string]$ExpectedSha256
    )
    $Source.Position = 0
    $targetStream = [System.IO.FileStream]::new(
        $Target,
        [System.IO.FileMode]::CreateNew,
        [System.IO.FileAccess]::ReadWrite,
        [System.IO.FileShare]::None,
        131072,
        [System.IO.FileOptions]::SequentialScan
    )
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        $Source.CopyTo($targetStream, 131072)
        $targetStream.Flush($true)
        $targetStream.Position = 0
        $actual = [Convert]::ToHexString($sha.ComputeHash($targetStream))
        if ($actual -cne $ExpectedSha256) {
            throw "Staged bytes differ from the immutable freeze: $Target"
        }
    }
    finally {
        $sha.Dispose()
        $targetStream.Dispose()
    }
}

function Get-SandboxSid {
    return ([System.Security.Principal.NTAccount]::new(
        [Environment]::MachineName + '\CodexSandboxUsers'
    )).Translate([System.Security.Principal.SecurityIdentifier])
}

function Assert-FixedOwnerIdentity {
    $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
    if ($identity.User.Value -cne $fixedOwnerSidValue) {
        throw 'The installer identity is not the immutable owner SID.'
    }
    return $identity
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

function New-ProtectedDirectorySecurity {
    $identity = Assert-FixedOwnerIdentity
    $sandboxSid = Get-SandboxSid
    if (@($identity.Groups | ForEach-Object { $_.Value }) -contains $sandboxSid.Value) {
        throw 'Installer identity is a CodexSandboxUsers member; trust separation is absent.'
    }
    $security = [System.Security.AccessControl.DirectorySecurity]::new()
    $security.SetOwner($fixedOwnerSid)
    $security.SetAccessRuleProtection($true, $false)
    $inheritance = [System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor
        [System.Security.AccessControl.InheritanceFlags]::ObjectInherit
    $security.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new(
        $sandboxSid,
        (Get-ProtectedWriteMask),
        $inheritance,
        [System.Security.AccessControl.PropagationFlags]::None,
        [System.Security.AccessControl.AccessControlType]::Deny
    ))
    $security.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new(
        $sandboxSid,
        [System.Security.AccessControl.FileSystemRights]::ReadAndExecute,
        $inheritance,
        [System.Security.AccessControl.PropagationFlags]::None,
        [System.Security.AccessControl.AccessControlType]::Allow
    ))
    foreach ($sid in @(
        $fixedOwnerSid,
        [System.Security.Principal.SecurityIdentifier]::new('S-1-5-18'),
        [System.Security.Principal.SecurityIdentifier]::new('S-1-5-32-544')
    )) {
        $security.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new(
            $sid,
            [System.Security.AccessControl.FileSystemRights]::FullControl,
            $inheritance,
            [System.Security.AccessControl.PropagationFlags]::None,
            [System.Security.AccessControl.AccessControlType]::Allow
        ))
    }
    return $security
}

function New-ProtectedFileSecurity {
    [void](Assert-FixedOwnerIdentity)
    $sandboxSid = Get-SandboxSid
    $security = [System.Security.AccessControl.FileSecurity]::new()
    $security.SetOwner($fixedOwnerSid)
    $security.SetAccessRuleProtection($true, $false)
    $security.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new(
        $sandboxSid,
        (Get-ProtectedWriteMask),
        [System.Security.AccessControl.AccessControlType]::Deny
    ))
    $security.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new(
        $sandboxSid,
        [System.Security.AccessControl.FileSystemRights]::ReadAndExecute,
        [System.Security.AccessControl.AccessControlType]::Allow
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

function New-OwnerOnlyDirectorySecurity {
    [void](Assert-FixedOwnerIdentity)
    $sandboxSid = Get-SandboxSid
    $security = [System.Security.AccessControl.DirectorySecurity]::new()
    $security.SetOwner($fixedOwnerSid)
    $security.SetAccessRuleProtection($true, $false)
    $inheritance = [System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor
        [System.Security.AccessControl.InheritanceFlags]::ObjectInherit
    $security.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new(
        $sandboxSid,
        [System.Security.AccessControl.FileSystemRights]::FullControl,
        $inheritance,
        [System.Security.AccessControl.PropagationFlags]::None,
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
            $inheritance,
            [System.Security.AccessControl.PropagationFlags]::None,
            [System.Security.AccessControl.AccessControlType]::Allow
        ))
    }
    return $security
}

function New-OwnerOnlyFileSecurity {
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

function Assert-ProgramDataParent {
    $path = 'C:\ProgramData'
    $item = Get-Item -Force -LiteralPath $path
    if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw 'C:\ProgramData is a reparse point.'
    }
    $acl = Get-Acl -LiteralPath $path
    $ownerSid = ([System.Security.Principal.NTAccount]$acl.Owner).Translate(
        [System.Security.Principal.SecurityIdentifier]
    ).Value
    $systemSids = @('S-1-5-18', 'S-1-5-32-544')
    if ($systemSids -notcontains $ownerSid) { throw 'C:\ProgramData owner is not system-controlled.' }
    $replaceMask = [System.Security.AccessControl.FileSystemRights]::Delete -bor
        [System.Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles -bor
        [System.Security.AccessControl.FileSystemRights]::ChangePermissions -bor
        [System.Security.AccessControl.FileSystemRights]::TakeOwnership
    foreach ($rule in $acl.Access) {
        if ($rule.AccessControlType -ne [System.Security.AccessControl.AccessControlType]::Allow -or
            ($rule.FileSystemRights -band $replaceMask) -eq 0) { continue }
        try {
            $sid = $rule.IdentityReference.Translate(
                [System.Security.Principal.SecurityIdentifier]
            ).Value
        }
        catch { throw 'Unresolvable identity has replacement rights on C:\ProgramData.' }
        if ($systemSids -notcontains $sid) {
            throw "Non-system SID $sid has replacement rights on C:\ProgramData."
        }
    }
}

function Assert-ProtectedAcl {
    param([Parameter(Mandatory)][string[]]$LiteralPaths)
    $identity = Assert-FixedOwnerIdentity
    $currentSid = $fixedOwnerSidValue
    $trustedSids = @($currentSid, 'S-1-5-18', 'S-1-5-32-544')
    $sandboxSid = (Get-SandboxSid).Value
    $currentGroups = @($identity.Groups | ForEach-Object { $_.Value })
    if ($currentGroups -contains $sandboxSid) {
        throw 'Installer identity is a CodexSandboxUsers member; trust separation is absent.'
    }
    $writeMask = Get-ProtectedWriteMask
    $readMask = [System.Security.AccessControl.FileSystemRights]::ReadAndExecute -bor
        [System.Security.AccessControl.FileSystemRights]::Synchronize
    foreach ($path in $LiteralPaths) {
        $item = Get-Item -Force -LiteralPath $path
        if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw "Protected path is a reparse point: $path"
        }
        $acl = Get-Acl -LiteralPath $path
        if (-not $acl.AreAccessRulesProtected) { throw "Protected path inherits ACLs: $path" }
        $ownerSid = ([System.Security.Principal.NTAccount]$acl.Owner).Translate(
            [System.Security.Principal.SecurityIdentifier]
        ).Value
        if ($ownerSid -cne $currentSid) { throw "Protected path owner mismatch: $path" }
        $sandboxDenied = [System.Security.AccessControl.FileSystemRights]0
        $sandboxAllowed = [System.Security.AccessControl.FileSystemRights]0
        foreach ($rule in $acl.Access) {
            try {
                $sid = $rule.IdentityReference.Translate(
                    [System.Security.Principal.SecurityIdentifier]
                ).Value
            }
            catch { throw "Unresolvable identity has access to protected path: $path" }
            if ($rule.AccessControlType -eq [System.Security.AccessControl.AccessControlType]::Allow) {
                if ($sid -ceq $sandboxSid) {
                    if (($rule.FileSystemRights -band (-bnot $readMask)) -ne 0) {
                        throw "CodexSandboxUsers has non-read access to protected runtime path: $path"
                    }
                    $sandboxAllowed = $sandboxAllowed -bor ($rule.FileSystemRights -band $readMask)
                }
                elseif ($trustedSids -notcontains $sid -and $rule.FileSystemRights -ne 0) {
                    throw "Untrusted SID $sid has access to protected path: $path"
                }
            }
            if ($sid -ceq $sandboxSid -and
                $rule.AccessControlType -eq [System.Security.AccessControl.AccessControlType]::Deny -and
                -not $rule.IsInherited) {
                $sandboxDenied = $sandboxDenied -bor
                    ($rule.FileSystemRights -band $writeMask)
            }
            if ($rule.AccessControlType -eq [System.Security.AccessControl.AccessControlType]::Deny -and
                ($sid -ceq $currentSid -or $currentGroups -contains $sid) -and
                ($rule.FileSystemRights -band [System.Security.AccessControl.FileSystemRights]::FullControl) -ne 0) {
                throw "Installer identity is subject to a denial on protected runtime path: $path"
            }
        }
        if (($sandboxDenied -band $writeMask) -ne $writeMask) {
            throw "CodexSandboxUsers lacks a complete explicit write denial on protected runtime path: $path"
        }
        if (($sandboxAllowed -band [System.Security.AccessControl.FileSystemRights]::ReadAndExecute) -ne
            [System.Security.AccessControl.FileSystemRights]::ReadAndExecute) {
            throw "CodexSandboxUsers lacks explicit read/execute access to protected runtime path: $path"
        }
    }
}

function Assert-OwnerOnlyAcl {
    param([Parameter(Mandatory)][string[]]$LiteralPaths)
    $identity = Assert-FixedOwnerIdentity
    $currentSid = $fixedOwnerSidValue
    $trustedSids = @($currentSid, 'S-1-5-18', 'S-1-5-32-544')
    $currentGroups = @($identity.Groups | ForEach-Object { $_.Value })
    $sandboxSid = (Get-SandboxSid).Value
    foreach ($path in $LiteralPaths) {
        $item = Get-Item -Force -LiteralPath $path
        if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw "Owner-only path is a reparse point: $path"
        }
        $acl = Get-Acl -LiteralPath $path
        if (-not $acl.AreAccessRulesProtected) { throw "Owner-only path inherits ACLs: $path" }
        $ownerSid = ([System.Security.Principal.NTAccount]$acl.Owner).Translate(
            [System.Security.Principal.SecurityIdentifier]
        ).Value
        if ($ownerSid -cne $currentSid) { throw "Owner-only path owner mismatch: $path" }
        $sandboxDenied = [System.Security.AccessControl.FileSystemRights]0
        foreach ($rule in $acl.Access) {
            try {
                $sid = $rule.IdentityReference.Translate(
                    [System.Security.Principal.SecurityIdentifier]
                ).Value
            }
            catch { throw "Unresolvable identity has access to owner-only path: $path" }
            if ($rule.AccessControlType -eq [System.Security.AccessControl.AccessControlType]::Allow -and
                $trustedSids -notcontains $sid -and $rule.FileSystemRights -ne 0) {
                throw "Untrusted SID $sid has access to owner-only path: $path"
            }
            if ($sid -ceq $sandboxSid -and
                $rule.AccessControlType -eq [System.Security.AccessControl.AccessControlType]::Deny -and
                -not $rule.IsInherited) {
                $sandboxDenied = $sandboxDenied -bor
                    ($rule.FileSystemRights -band [System.Security.AccessControl.FileSystemRights]::FullControl)
            }
            if ($rule.AccessControlType -eq [System.Security.AccessControl.AccessControlType]::Deny -and
                ($sid -ceq $currentSid -or $currentGroups -contains $sid) -and
                $rule.FileSystemRights -ne 0) {
                throw "Installer identity is subject to a denial on owner-only path: $path"
            }
        }
        if (($sandboxDenied -band [System.Security.AccessControl.FileSystemRights]::FullControl) -ne
            [System.Security.AccessControl.FileSystemRights]::FullControl) {
            throw "CodexSandboxUsers lacks a complete explicit denial on owner-only path: $path"
        }
    }
}

function New-ProtectedDirectory {
    param([Parameter(Mandatory)][string]$LiteralPath, [switch]$OwnerOnly)
    if (-not (Test-Path -LiteralPath $LiteralPath)) {
        $security = if ($OwnerOnly) {
            New-OwnerOnlyDirectorySecurity
        }
        else { New-ProtectedDirectorySecurity }
        [void][System.IO.FileSystemAclExtensions]::CreateDirectory(
            $security, $LiteralPath
        )
    }
    if (-not (Test-Path -LiteralPath $LiteralPath -PathType Container)) {
        throw "Protected directory is unavailable: $LiteralPath"
    }
    if ($OwnerOnly) {
        Assert-OwnerOnlyAcl -LiteralPaths @($LiteralPath)
    }
    else { Assert-ProtectedAcl -LiteralPaths @($LiteralPath) }
}

function Set-ExactFileSystemSecurity {
    param(
        [Parameter(Mandatory)][string]$LiteralPath,
        [Parameter(Mandatory)]
        [System.Security.AccessControl.FileSystemSecurity]$Security
    )
    if ($Security -is [System.Security.AccessControl.DirectorySecurity]) {
        if (-not [System.IO.Directory]::Exists($LiteralPath)) {
            throw "Protected directory is unavailable: $LiteralPath"
        }
        [System.IO.FileSystemAclExtensions]::SetAccessControl(
            [System.IO.DirectoryInfo]::new($LiteralPath),
            [System.Security.AccessControl.DirectorySecurity]$Security
        )
        return
    }
    if ($Security -is [System.Security.AccessControl.FileSecurity]) {
        if (-not [System.IO.File]::Exists($LiteralPath)) {
            throw "Protected file is unavailable: $LiteralPath"
        }
        [System.IO.FileSystemAclExtensions]::SetAccessControl(
            [System.IO.FileInfo]::new($LiteralPath),
            [System.Security.AccessControl.FileSecurity]$Security
        )
        return
    }
    throw "Unsupported filesystem security descriptor: $LiteralPath"
}

function Protect-Tree {
    param([Parameter(Mandatory)][string]$LiteralPath)
    Set-ExactFileSystemSecurity `
        -LiteralPath $LiteralPath -Security (New-ProtectedDirectorySecurity)
    foreach ($item in Get-ChildItem -Force -Recurse -LiteralPath $LiteralPath) {
        $security = if ($item.PSIsContainer) {
            New-ProtectedDirectorySecurity
        }
        else { New-ProtectedFileSecurity }
        Set-ExactFileSystemSecurity -LiteralPath $item.FullName -Security $security
    }
    Assert-ProtectedAcl -LiteralPaths @(
        $LiteralPath
        Get-ChildItem -Force -Recurse -LiteralPath $LiteralPath | ForEach-Object { $_.FullName }
    )
}

function Protect-OwnerOnlyTree {
    param([Parameter(Mandatory)][string]$LiteralPath)
    Set-ExactFileSystemSecurity `
        -LiteralPath $LiteralPath -Security (New-OwnerOnlyDirectorySecurity)
    foreach ($item in Get-ChildItem -Force -Recurse -LiteralPath $LiteralPath) {
        $security = if ($item.PSIsContainer) {
            New-OwnerOnlyDirectorySecurity
        }
        else { New-OwnerOnlyFileSecurity }
        Set-ExactFileSystemSecurity -LiteralPath $item.FullName -Security $security
    }
    Assert-OwnerOnlyAcl -LiteralPaths @(
        $LiteralPath
        Get-ChildItem -Force -Recurse -LiteralPath $LiteralPath | ForEach-Object { $_.FullName }
    )
}

function Assert-Signer {
    param(
        [Parameter(Mandatory)][string]$LiteralPath,
        [Parameter(Mandatory)][string]$ExpectedThumbprint
    )
    $signature = Get-AuthenticodeSignature -LiteralPath $LiteralPath
    if ($signature.Status -ne [System.Management.Automation.SignatureStatus]::Valid -or
        $null -eq $signature.SignerCertificate -or
        $signature.SignerCertificate.Thumbprint -cne $ExpectedThumbprint) {
        throw "Executable signer mismatch: $LiteralPath"
    }
}

$freezeStream = $null
$reviewedManifestStream = $null
$freezeDocument = $null
$stagePublished = $false
$installCompleted = $false
try {
    if ($Apply) {
        if (-not [string]::IsNullOrWhiteSpace($PSCommandPath) -or
            -not [string]::IsNullOrWhiteSpace($PSScriptRoot)) {
            throw 'Apply is available only through the verified in-memory bootstrap.'
        }
        [void](Assert-FixedOwnerIdentity)
        $expectedBootstrapProperties = @(
            'Schema', 'Capability', 'ProofEcho', 'LoaderContext',
            'CandidateRoot', 'FreezeSha256', 'InstallerSha256',
            'ReviewedBuildManifestSha256', 'ReviewedBuildManifestStream',
            'BootstrapSha256', 'FreezeStream', 'InstallerStream',
            'BootstrapStream',
            'InstallerLauncherPath', 'InstallerLauncherSha256', 'InstallerLauncherStream',
            'VerifierPath', 'VerifierSha256', 'VerifierStream'
        )
        $bootstrapPropertySet = [System.Collections.Generic.HashSet[string]]::new(
            [System.StringComparer]::Ordinal
        )
        foreach ($name in @($BootstrapContext.PSObject.Properties.Name)) {
            [void]$bootstrapPropertySet.Add($name)
        }
        $bootstrapPropertySetMatches =
            $bootstrapPropertySet.Count -eq $expectedBootstrapProperties.Count
        foreach ($name in $expectedBootstrapProperties) {
            if (-not $bootstrapPropertySet.Contains($name)) {
                $bootstrapPropertySetMatches = $false
            }
        }
        if (-not $bootstrapPropertySetMatches -or
            $BootstrapContext.Schema -cne 'blip-installer-bootstrap-context/v3' -or
            -not [object]::ReferenceEquals(
                $BootstrapContext.Capability, $BootstrapContext.ProofEcho
            ) -or
            -not [object]::ReferenceEquals(
                $BootstrapContext.Capability, $BootstrapContext.LoaderContext.Capability
            ) -or
            -not [object]::ReferenceEquals(
                $BootstrapContext.VerifierStream, $BootstrapContext.LoaderContext.VerifierStream
            ) -or
            -not [object]::ReferenceEquals(
                $BootstrapContext.InstallerLauncherStream,
                $BootstrapContext.LoaderContext.InstallerLauncherStream
            ) -or
            -not [object]::ReferenceEquals(
                $BootstrapContext.ReviewedBuildManifestStream,
                $BootstrapContext.LoaderContext.ReviewedBuildManifestStream
            ) -or
            $BootstrapContext.VerifierPath -cne $BootstrapContext.LoaderContext.VerifierPath -or
            $BootstrapContext.VerifierSha256 -cne $BootstrapContext.LoaderContext.VerifierSha256 -or
            $BootstrapContext.InstallerLauncherPath -cne
                $BootstrapContext.LoaderContext.InstallerLauncherPath -or
            $BootstrapContext.InstallerLauncherSha256 -cne
                $BootstrapContext.LoaderContext.InstallerLauncherSha256 -or
            $BootstrapContext.ReviewedBuildManifestSha256 -cne
                $BootstrapContext.LoaderContext.ReviewedBuildManifestSha256) {
            throw 'The process-local bootstrap proof is invalid.'
        }
        if ($BootstrapContext.CandidateRoot -cne $candidateRoot -or
            $BootstrapContext.FreezeSha256 -cne $ExpectedFreezeSha256.ToUpperInvariant() -or
            $BootstrapContext.InstallerSha256 -cne $ExpectedInstallerSha256.ToUpperInvariant() -or
            $BootstrapContext.ReviewedBuildManifestSha256 -cne
                $ExpectedReviewedBuildManifestSha256.ToUpperInvariant() -or
            $BootstrapContext.BootstrapSha256 -cne $ExpectedBootstrapSha256.ToUpperInvariant()) {
            throw 'The bootstrap tuple differs from the requested immutable candidate.'
        }
        foreach ($property in @(
            'FreezeStream', 'ReviewedBuildManifestStream', 'InstallerStream',
            'BootstrapStream', 'InstallerLauncherStream', 'VerifierStream'
        )) {
            if ($BootstrapContext.$property -isnot [System.IO.FileStream] -or
                -not $BootstrapContext.$property.CanRead -or
                $BootstrapContext.$property.SafeFileHandle.IsClosed) {
                throw "The bootstrap did not preserve a readable locked $property."
            }
        }
        if ([System.IO.Path]::GetFullPath($BootstrapContext.FreezeStream.Name) -cne $freezePath -or
            [System.IO.Path]::GetFullPath($BootstrapContext.ReviewedBuildManifestStream.Name) -cne
                $reviewedManifestPath -or
            [System.IO.Path]::GetFullPath($BootstrapContext.InstallerStream.Name) -cne $installerPath -or
            [System.IO.Path]::GetFullPath($BootstrapContext.BootstrapStream.Name) -cne $bootstrapPath -or
            [System.IO.Path]::GetFullPath($BootstrapContext.InstallerLauncherStream.Name) -cne
                [System.IO.Path]::GetFullPath($BootstrapContext.InstallerLauncherPath) -or
            [System.IO.Path]::GetFullPath($BootstrapContext.InstallerLauncherPath).StartsWith(
                $candidateRoot + '\', [StringComparison]::OrdinalIgnoreCase
            ) -or
            [System.IO.Path]::GetFullPath($BootstrapContext.VerifierStream.Name) -cne
                [System.IO.Path]::GetFullPath($BootstrapContext.VerifierPath) -or
            [System.IO.Path]::GetFullPath($BootstrapContext.VerifierPath).StartsWith(
                $candidateRoot + '\', [StringComparison]::OrdinalIgnoreCase
            )) {
            throw 'A bootstrap stream is not bound to the canonical candidate path.'
        }
        if ((Get-OpenStreamSha256 -Stream $BootstrapContext.InstallerStream) -cne
            $ExpectedInstallerSha256.ToUpperInvariant() -or
            (Get-OpenStreamSha256 -Stream $BootstrapContext.ReviewedBuildManifestStream) -cne
                $ExpectedReviewedBuildManifestSha256.ToUpperInvariant() -or
            (Get-OpenStreamSha256 -Stream $BootstrapContext.BootstrapStream) -cne
            $ExpectedBootstrapSha256.ToUpperInvariant() -or
            $BootstrapContext.InstallerLauncherSha256 -notmatch '^[0-9A-F]{64}$' -or
            (Get-OpenStreamSha256 -Stream $BootstrapContext.InstallerLauncherStream) -cne
                $BootstrapContext.InstallerLauncherSha256 -or
            $BootstrapContext.VerifierSha256 -notmatch '^[0-9A-F]{64}$' -or
            (Get-OpenStreamSha256 -Stream $BootstrapContext.VerifierStream) -cne
                $BootstrapContext.VerifierSha256) {
            throw 'The executing installer/bootstrap/verifier bytes differ from the verified trust chain.'
        }
        $freezeStream = $BootstrapContext.FreezeStream
        $reviewedManifestStream = $BootstrapContext.ReviewedBuildManifestStream
    }
    else {
        $freezeStream = Open-PinnedReadStream -LiteralPath $freezePath
        $reviewedManifestStream = Open-PinnedReadStream `
            -LiteralPath (Resolve-CandidatePath -RelativePath 'reviewed-build-manifest.json')
    }
    $freezeHash = Get-OpenStreamSha256 -Stream $freezeStream
    if ($Apply -and $freezeHash -cne $ExpectedFreezeSha256.ToUpperInvariant()) {
        throw 'Candidate freeze hash differs from the explicitly authorized immutable hash.'
    }
    $freezeText = Read-OpenStreamUtf8 -Stream $freezeStream
    $freezeDocument = [System.Text.Json.JsonDocument]::Parse($freezeText)
    $freezeRoot = $freezeDocument.RootElement
    Assert-ExactJsonProperties -Object $freezeRoot -ExpectedNames @(
        'schema', 'build_profile', 'source_commit',
        'reviewed_build_manifest_sha256', 'external_verifier_sha256',
        'source_files', 'runtime_source'
    ) -Label 'Candidate freeze'
    $schemaElement = Get-UniqueJsonProperty -Object $freezeRoot -Name 'schema'
    $profileElement = Get-UniqueJsonProperty -Object $freezeRoot -Name 'build_profile'
    $sourceCommitElement = Get-UniqueJsonProperty -Object $freezeRoot -Name 'source_commit'
    $reviewedManifestElement = Get-UniqueJsonProperty `
        -Object $freezeRoot -Name 'reviewed_build_manifest_sha256'
    $verifierElement = Get-UniqueJsonProperty -Object $freezeRoot -Name 'external_verifier_sha256'
    $sourceElement = Get-UniqueJsonProperty -Object $freezeRoot -Name 'source_files'
    $runtimeElement = Get-UniqueJsonProperty -Object $freezeRoot -Name 'runtime_source'
    $expectedSourceNames = @(
        'install_blip_auto_approval.ps1', 'invoke_frozen_blip_installer.ps1'
    ) + @($trustedFiles.Values | Sort-Object -Unique)
    Assert-ExactHashObject -Object $sourceElement -ExpectedNames $expectedSourceNames -Label 'Candidate source_files'
    Assert-ExactHashObject -Object $runtimeElement -ExpectedNames @($runtimeFiles.Keys) -Label 'Candidate runtime_source'
    $freezeVerifierSha256 = if (
        $verifierElement.ValueKind -eq [System.Text.Json.JsonValueKind]::String
    ) { $verifierElement.GetString() } else { '' }
    if ($schemaElement.ValueKind -ne [System.Text.Json.JsonValueKind]::String -or
        $schemaElement.GetString() -cne 'blip-auto-approval-candidate-freeze/v3' -or
        $profileElement.ValueKind -ne [System.Text.Json.JsonValueKind]::String -or
        $profileElement.GetString() -cne 'PRODUCTION' -or
        $sourceCommitElement.ValueKind -ne [System.Text.Json.JsonValueKind]::String -or
        $sourceCommitElement.GetString() -notmatch '^[0-9a-f]{40}$' -or
        $sourceCommitElement.GetString() -eq ('0' * 40) -or
        $reviewedManifestElement.ValueKind -ne [System.Text.Json.JsonValueKind]::String -or
        $reviewedManifestElement.GetString() -notmatch '^[0-9A-F]{64}$' -or
        (Get-OpenStreamSha256 -Stream $reviewedManifestStream) -cne
            $reviewedManifestElement.GetString() -or
        ($Apply -and $reviewedManifestElement.GetString() -cne
            $ExpectedReviewedBuildManifestSha256.ToUpperInvariant()) -or
        $freezeVerifierSha256 -notmatch '^[0-9A-F]{64}$' -or
        ($Apply -and $freezeVerifierSha256 -cne $BootstrapContext.VerifierSha256)) {
        throw 'Candidate freeze manifest schema is invalid.'
    }
    $freeze = $freezeText | ConvertFrom-Json
    if ($Apply) {
        $frozenInstaller = $freeze.source_files.PSObject.Properties['install_blip_auto_approval.ps1']
        $frozenBootstrap = $freeze.source_files.PSObject.Properties['invoke_frozen_blip_installer.ps1']
        if ($null -eq $frozenInstaller -or
            [string]$frozenInstaller.Value -cne $ExpectedInstallerSha256.ToUpperInvariant() -or
            $null -eq $frozenBootstrap -or
            [string]$frozenBootstrap.Value -cne $ExpectedBootstrapSha256.ToUpperInvariant()) {
            throw 'The freeze does not bind the executing installer/bootstrap pair.'
        }
    }

    foreach ($entry in $trustedFiles.GetEnumerator()) {
        $expected = $freeze.source_files.PSObject.Properties[$entry.Value]
        if ($null -eq $expected -or [string]$expected.Value -notmatch '^[0-9A-F]{64}$') {
            throw "Freeze manifest does not cover trusted input: $($entry.Value)"
        }
        if (-not $sourceStreams.ContainsKey($entry.Value)) {
            $path = Resolve-CandidatePath -RelativePath $entry.Value
            $stream = Open-PinnedReadStream -LiteralPath $path
            if ((Get-OpenStreamSha256 -Stream $stream) -cne [string]$expected.Value) {
                throw "Frozen trusted input hash mismatch: $($entry.Value)"
            }
            $sourceStreams[$entry.Value] = $stream
        }
    }
    foreach ($entry in $runtimeFiles.GetEnumerator()) {
        $expected = $freeze.runtime_source.PSObject.Properties[$entry.Key]
        if ($null -eq $expected -or [string]$expected.Value -notmatch '^[0-9A-F]{64}$') {
            throw "Freeze manifest does not cover runtime input: $($entry.Key)"
        }
        $stream = Open-PinnedReadStream -LiteralPath $entry.Value
        if ((Get-OpenStreamSha256 -Stream $stream) -cne [string]$expected.Value) {
            throw "Frozen runtime input hash mismatch: $($entry.Key)"
        }
        $runtimeStreams[$entry.Key] = $stream
    }

    Assert-Signer -LiteralPath $powerShellPath -ExpectedThumbprint '3F56A45111684D454E231CFDC4DA5C8D370F9816'
    if ((Get-Item -LiteralPath $powerShellPath).VersionInfo.FileVersion -cne '7.5.4.500') {
        throw 'PowerShell host version differs from the reviewed runtime.'
    }
    Assert-Signer -LiteralPath $pythonPath -ExpectedThumbprint '36168EE17C1A240517388540C903BB6717DD2563'
    foreach ($relative in @(
        'bin\codex.exe', 'bin\codex-code-mode-host.exe',
        'codex-resources\codex-command-runner.exe',
        'codex-resources\codex-windows-sandbox-setup.exe'
    )) {
        Assert-Signer -LiteralPath (Join-Path $codexVendorRoot $relative) `
            -ExpectedThumbprint '8B0ADFB840E141DAD3044D2B5AC819873DDE3590'
    }

    Write-Output "AUDIT_RESULT freeze=$freezeHash trusted_files=$($trustedFiles.Count) runtime_inputs=$($runtimeFiles.Count)"
    if (-not $Apply) {
        Write-Output 'AUDIT_ONLY no files were changed'
        exit 0
    }

    Assert-ProgramDataParent
    New-ProtectedDirectory -LiteralPath $protectedRoot
    New-ProtectedDirectory -LiteralPath $productRoot
    New-ProtectedDirectory -LiteralPath $secretRoot -OwnerOnly
    if (Test-Path -LiteralPath $trustedRoot) {
        throw "Trusted runtime v1 already exists; this initial installer never replaces it: $trustedRoot"
    }
    New-ProtectedDirectory -LiteralPath $stageRoot
    foreach ($relative in @(
        'state', 'app-scripts', 'codex-home', 'codex-runtime',
        'codex-runtime\bin', 'codex-runtime\codex-path',
        'codex-runtime\codex-resources'
    )) {
        New-ProtectedDirectory -LiteralPath (Join-Path $stageRoot $relative)
    }

    foreach ($entry in $trustedFiles.GetEnumerator()) {
        $expected = [string]$freeze.source_files.PSObject.Properties[$entry.Value].Value
        Copy-PinnedStream -Source $sourceStreams[$entry.Value] `
            -Target (Join-Path $stageRoot $entry.Key) -ExpectedSha256 $expected
    }
    foreach ($entry in $runtimeFiles.GetEnumerator()) {
        if ($entry.Key -in @('runtime/pwsh.exe', 'runtime/python.exe') -or
            $entry.Key.StartsWith('runtime/psmodule/', [StringComparison]::Ordinal)) { continue }
        $relative = $entry.Key.Substring('runtime/'.Length).Replace('/', '\')
        $expected = [string]$freeze.runtime_source.PSObject.Properties[$entry.Key].Value
        Copy-PinnedStream -Source $runtimeStreams[$entry.Key] `
            -Target (Join-Path (Join-Path $stageRoot 'codex-runtime') $relative) `
            -ExpectedSha256 $expected
    }
    [System.IO.File]::WriteAllText(
        (Join-Path $stageRoot 'codex-home\auth.json'),
        '{}',
        [System.Text.UTF8Encoding]::new($false)
    )

    $manifestFiles = [ordered]@{}
    foreach ($entry in $trustedFiles.GetEnumerator()) {
        $manifestFiles[$entry.Key] = [string]$freeze.source_files.PSObject.Properties[$entry.Value].Value
    }
    $manifestRuntime = [ordered]@{}
    foreach ($entry in $runtimeFiles.GetEnumerator()) {
        $manifestRuntime[$entry.Key] = [string]$freeze.runtime_source.PSObject.Properties[$entry.Key].Value
    }
    [ordered]@{
        schema = 'blip-trusted-runtime-manifest/v1'
        files = $manifestFiles
        runtime = $manifestRuntime
        candidate_freeze_sha256 = $freezeHash
        activation = 'OWNER_PEM_AND_CODEX_LOGIN_REQUIRED'
        installed_at = [DateTimeOffset]::Now.ToString('o')
    } | ConvertTo-Json -Depth 6 | Set-Content `
        -LiteralPath (Join-Path $stageRoot 'manifest.json') -Encoding utf8NoBOM

    Protect-Tree -LiteralPath $stageRoot
    Protect-OwnerOnlyTree -LiteralPath (Join-Path $stageRoot 'codex-home')
    foreach ($entry in $trustedFiles.GetEnumerator()) {
        $installed = Join-Path $stageRoot $entry.Key
        if ((Get-FileHash -LiteralPath $installed -Algorithm SHA256).Hash -cne $manifestFiles[$entry.Key]) {
            throw "Final staged trusted file differs from the freeze: $($entry.Key)"
        }
    }
    foreach ($entry in $runtimeFiles.GetEnumerator()) {
        if ($entry.Key -in @('runtime/pwsh.exe', 'runtime/python.exe') -or
            $entry.Key.StartsWith('runtime/psmodule/', [StringComparison]::Ordinal)) { continue }
        $relative = $entry.Key.Substring('runtime/'.Length).Replace('/', '\')
        $installed = Join-Path (Join-Path $stageRoot 'codex-runtime') $relative
        if ((Get-FileHash -LiteralPath $installed -Algorithm SHA256).Hash -cne $manifestRuntime[$entry.Key]) {
            throw "Final staged runtime file differs from the freeze: $($entry.Key)"
        }
    }
    foreach ($entry in $sourceStreams.GetEnumerator()) {
        $expected = [string]$freeze.source_files.PSObject.Properties[$entry.Key].Value
        if ((Get-OpenStreamSha256 -Stream $entry.Value) -cne $expected) {
            throw "Pinned source drifted during installation: $($entry.Key)"
        }
    }
    foreach ($entry in $runtimeStreams.GetEnumerator()) {
        $expected = [string]$freeze.runtime_source.PSObject.Properties[$entry.Key].Value
        if ((Get-OpenStreamSha256 -Stream $entry.Value) -cne $expected) {
            throw "Pinned runtime input drifted during installation: $($entry.Key)"
        }
    }

    [System.IO.Directory]::Move($stageRoot, $trustedRoot)
    $stagePublished = $true
    $ownerOnlyRuntimeRoot = Join-Path $trustedRoot 'codex-home'
    $runtimeReadable = @(
        $protectedRoot, $productRoot, $trustedRoot
        Get-ChildItem -Force -Recurse -LiteralPath $trustedRoot |
            Where-Object { -not $_.FullName.StartsWith(
                $ownerOnlyRuntimeRoot + '\', [StringComparison]::OrdinalIgnoreCase
            ) -and $_.FullName -cne $ownerOnlyRuntimeRoot } |
            ForEach-Object { $_.FullName }
    )
    Assert-ProtectedAcl -LiteralPaths $runtimeReadable
    Assert-OwnerOnlyAcl -LiteralPaths @(
        $secretRoot, $ownerOnlyRuntimeRoot,
        (Join-Path $ownerOnlyRuntimeRoot 'auth.json')
    )

    $installedManifestPath = Join-Path $trustedRoot 'manifest.json'
    $installedManifestHash = (Get-FileHash `
        -LiteralPath $installedManifestPath -Algorithm SHA256
    ).Hash.ToUpperInvariant()
    $completionPayload = [ordered]@{
        schema = 'blip-trusted-runtime-complete/v1'
        owner_sid = $fixedOwnerSidValue
        candidate_freeze_sha256 = $freezeHash
        manifest_sha256 = $installedManifestHash
        completed_at = [DateTimeOffset]::Now.ToString('o')
    } | ConvertTo-Json -Depth 4
    $completionBytes = [System.Text.UTF8Encoding]::new($false).GetBytes(
        $completionPayload + [Environment]::NewLine
    )
    $completionStream = [System.IO.FileSystemAclExtensions]::Create(
        [System.IO.FileInfo]::new($completionPath),
        [System.IO.FileMode]::CreateNew,
        [System.Security.AccessControl.FileSystemRights]::FullControl,
        [System.IO.FileShare]::None,
        4096,
        [System.IO.FileOptions]::WriteThrough,
        (New-ProtectedFileSecurity)
    )
    try {
        $completionStream.Write($completionBytes, 0, $completionBytes.Length)
        $completionStream.Flush($true)
    }
    finally { $completionStream.Dispose() }
    Assert-ProtectedAcl -LiteralPaths @($completionPath)
    $completionReadback = Get-Content -Raw -LiteralPath $completionPath | ConvertFrom-Json
    if ($completionReadback.schema -cne 'blip-trusted-runtime-complete/v1' -or
        [string]$completionReadback.owner_sid -cne $fixedOwnerSidValue -or
        [string]$completionReadback.candidate_freeze_sha256 -cne $freezeHash -or
        [string]$completionReadback.manifest_sha256 -cne $installedManifestHash) {
        throw 'Installed completion marker did not read back with the exact verified runtime tuple.'
    }
    $installCompleted = $true
    Write-Output "INSTALL_RESULT trusted_runtime=$trustedRoot secret_path=$secretRoot activation=OWNER_PEM_AND_CODEX_LOGIN_REQUIRED"
}
catch {
    $installationError = $_
    if ($stagePublished -and -not $installCompleted -and
        [System.IO.Directory]::Exists($trustedRoot)) {
        try {
            [System.IO.Directory]::Move($trustedRoot, $failedRoot)
            Write-Warning "Incomplete published runtime was quarantined: $failedRoot"
        }
        catch {
            Write-Warning (
                "Incomplete runtime remains non-runnable without install-complete.json: $trustedRoot"
            )
        }
    }
    throw $installationError
}
finally {
    if ($null -ne $freezeDocument) { $freezeDocument.Dispose() }
    foreach ($stream in $pinnedStreams) { $stream.Dispose() }
    if (-not $stagePublished -and (Test-Path -LiteralPath $stageRoot)) {
        Write-Warning "A protected failed stage remains for owner inspection: $stageRoot"
    }
}
