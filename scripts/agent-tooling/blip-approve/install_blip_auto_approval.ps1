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
$upgradeTransactionId = [Guid]::NewGuid().ToString('N')
$completionStagePath = Join-Path $trustedRoot (
    '.install-complete-' + $upgradeTransactionId + '.tmp'
)
$stageRoot = Join-Path $productRoot ("v1.stage-" + $upgradeTransactionId)
$failedRoot = Join-Path $productRoot ("v1.failed-" + $upgradeTransactionId)
$previousRoot = Join-Path $productRoot ("v1.previous-" + $upgradeTransactionId)
$upgradeTransactionPath = Join-Path $productRoot 'upgrade-transaction.json'
$upgradeLockPath = Join-Path $productRoot 'upgrade.lock'
$upgradeCompletePath = Join-Path $productRoot ("upgrade-complete-" + $upgradeTransactionId + '.json')
$upgradeRollbackPath = Join-Path $productRoot ("upgrade-rolled-back-" + $upgradeTransactionId + '.json')
$pythonPath = 'C:\Program Files\Python312\python.exe'
$powerShellPath = 'C:\Program Files\PowerShell\7\pwsh.exe'
$fixedOwnerSidValue = 'S-1-5-21-2135046472-1977311562-3864793309-1001'
$fixedOwnerSid = [System.Security.Principal.SecurityIdentifier]::new($fixedOwnerSidValue)
$codexVendorRoot = 'C:\Users\IOT\AppData\Roaming\npm\node_modules\@openai\codex\node_modules\@openai\codex-win32-x64\vendor\x86_64-pc-windows-msvc'
$pinnedStreams = [System.Collections.Generic.List[System.IO.FileStream]]::new()
$predecessorFenceStreams = [System.Collections.Generic.List[System.IO.FileStream]]::new()
$upgradeLockStream = $null
$installerStructLogger = $null
$sourceStreams = @{}
$runtimeStreams = @{}

# Upgrade is deliberately a one-step ratchet. A future runtime can replace this
# one only after a separately reviewed PR updates this exact predecessor tuple.
# This prevents an older, once-approved candidate from being replayed over a
# newer installed runtime.
$allowedPredecessor = [ordered]@{
    source_commit = '23489c37a54719df8e024e6f822b8b2e7179d4d8'
    candidate_freeze_sha256 = '7BD4BA6FD9E054C5CDBD1BD7FFEB623F37D020B76D75A6D2C269886445280309'
    manifest_sha256 = '7DE394C9E7695B996B20719B46D671D97C982659D868566A33C3C3A61252B0EE'
}

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

function Get-QuiesceDenyMask {
    return [System.Security.AccessControl.FileSystemRights]::ReadData -bor
        [System.Security.AccessControl.FileSystemRights]::ReadExtendedAttributes -bor
        [System.Security.AccessControl.FileSystemRights]::ReadAttributes -bor
        [System.Security.AccessControl.FileSystemRights]::ExecuteFile
}

function New-QuiescedFileSecurity {
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
    $security.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new(
        $fixedOwnerSid,
        (Get-QuiesceDenyMask),
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

function Protect-RuntimeTree {
    param([Parameter(Mandatory)][string]$LiteralPath)
    $ownerOnlyRoot = Join-Path $LiteralPath 'codex-home'
    Set-ExactFileSystemSecurity `
        -LiteralPath $LiteralPath -Security (New-ProtectedDirectorySecurity)
    foreach ($item in Get-ChildItem -Force -Recurse -LiteralPath $LiteralPath) {
        if ($item.FullName -ceq $ownerOnlyRoot -or $item.FullName.StartsWith(
                $ownerOnlyRoot + '\', [StringComparison]::OrdinalIgnoreCase
            )) {
            continue
        }
        $security = if ($item.PSIsContainer) {
            New-ProtectedDirectorySecurity
        }
        else { New-ProtectedFileSecurity }
        Set-ExactFileSystemSecurity -LiteralPath $item.FullName -Security $security
    }
    if ([System.IO.Directory]::Exists($ownerOnlyRoot)) {
        Protect-OwnerOnlyTree -LiteralPath $ownerOnlyRoot
    }
    $runtimeReadable = @(
        $LiteralPath
        Get-ChildItem -Force -Recurse -LiteralPath $LiteralPath |
            Where-Object { $_.FullName -cne $ownerOnlyRoot -and
                -not $_.FullName.StartsWith(
                    $ownerOnlyRoot + '\', [StringComparison]::OrdinalIgnoreCase
                ) } |
            ForEach-Object { $_.FullName }
    )
    Assert-ProtectedAcl -LiteralPaths $runtimeReadable
}

function Assert-NoReparseTree {
    param([Parameter(Mandatory)][string]$LiteralPath)
    $root = [System.IO.Path]::GetFullPath($LiteralPath).TrimEnd('\')
    if (-not [System.IO.Directory]::Exists($root)) {
        throw "Trusted runtime directory is unavailable: $root"
    }
    $items = @([System.IO.DirectoryInfo]::new($root)) + @(
        Get-ChildItem -Force -Recurse -LiteralPath $root
    )
    foreach ($item in $items) {
        if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw "Trusted runtime contains a reparse point: $($item.FullName)"
        }
        $full = [System.IO.Path]::GetFullPath($item.FullName)
        if ($full -cne $root -and -not $full.StartsWith(
                $root + '\', [StringComparison]::OrdinalIgnoreCase
            )) {
            throw "Trusted runtime item escapes its canonical root: $full"
        }
    }
}

function Assert-ExistingTrustedRuntime {
    $manifestPath = Join-Path $trustedRoot 'manifest.json'
    $existingCompletionPath = Join-Path $trustedRoot 'install-complete.json'
    $statePath = Join-Path $trustedRoot 'state'
    $ownerOnlyRoot = Join-Path $trustedRoot 'codex-home'
    foreach ($required in @(
        $manifestPath, $existingCompletionPath, $statePath, $ownerOnlyRoot,
        (Join-Path $ownerOnlyRoot 'auth.json')
    )) {
        if (-not (Test-Path -LiteralPath $required)) {
            throw "Existing trusted runtime is incomplete: $required"
        }
    }
    Assert-NoReparseTree -LiteralPath $trustedRoot

    $manifestHash = (Get-FileHash -LiteralPath $manifestPath -Algorithm SHA256).Hash.ToUpperInvariant()
    if ($manifestHash -cne $allowedPredecessor.manifest_sha256) {
        throw 'Existing trusted runtime is not the exact allowed predecessor manifest.'
    }
    $manifestText = Get-Content -Raw -LiteralPath $manifestPath
    $completionText = Get-Content -Raw -LiteralPath $existingCompletionPath
    $manifestDocument = [System.Text.Json.JsonDocument]::Parse($manifestText)
    $completionDocument = [System.Text.Json.JsonDocument]::Parse($completionText)
    try {
        $manifestRoot = $manifestDocument.RootElement
        $completionRoot = $completionDocument.RootElement
        Assert-ExactJsonProperties -Object $manifestRoot -ExpectedNames @(
            'schema', 'source_commit', 'files', 'runtime',
            'candidate_freeze_sha256', 'activation', 'installed_at'
        ) -Label 'Existing trusted runtime manifest'
        Assert-ExactJsonProperties -Object $completionRoot -ExpectedNames @(
            'schema', 'owner_sid', 'candidate_freeze_sha256',
            'manifest_sha256', 'completed_at'
        ) -Label 'Existing trusted runtime completion marker'
        $manifest = $manifestText | ConvertFrom-Json
        $completion = $completionText | ConvertFrom-Json
        if ($manifest.schema -cne 'blip-trusted-runtime-manifest/v1' -or
            [string]$manifest.source_commit -cne $allowedPredecessor.source_commit -or
            [string]$manifest.candidate_freeze_sha256 -cne
                $allowedPredecessor.candidate_freeze_sha256 -or
            $completion.schema -cne 'blip-trusted-runtime-complete/v1' -or
            [string]$completion.owner_sid -cne $fixedOwnerSidValue -or
            [string]$completion.candidate_freeze_sha256 -cne
                $allowedPredecessor.candidate_freeze_sha256 -or
            [string]$completion.manifest_sha256 -cne $allowedPredecessor.manifest_sha256) {
            throw 'Existing trusted runtime does not match the allowed predecessor tuple.'
        }
        if (@($manifest.files.PSObject.Properties.Name).Count -ne $trustedFiles.Count -or
            @($manifest.runtime.PSObject.Properties.Name).Count -ne $runtimeFiles.Count) {
            throw 'Existing trusted runtime inventory does not match the installer contract.'
        }
        foreach ($entry in $trustedFiles.GetEnumerator()) {
            $expected = $manifest.files.PSObject.Properties[$entry.Key]
            $installed = Join-Path $trustedRoot $entry.Key
            if ($null -eq $expected -or [string]$expected.Value -notmatch '^[0-9A-F]{64}$' -or
                (Get-FileHash -LiteralPath $installed -Algorithm SHA256).Hash -cne
                    [string]$expected.Value) {
                throw "Existing trusted runtime file hash mismatch: $($entry.Key)"
            }
        }
        foreach ($entry in $runtimeFiles.GetEnumerator()) {
            $expected = $manifest.runtime.PSObject.Properties[$entry.Key]
            if ($null -eq $expected -or [string]$expected.Value -notmatch '^[0-9A-F]{64}$') {
                throw "Existing trusted runtime dependency hash is malformed: $($entry.Key)"
            }
            if ($entry.Key -in @('runtime/pwsh.exe', 'runtime/python.exe') -or
                $entry.Key.StartsWith('runtime/psmodule/', [StringComparison]::Ordinal)) {
                $installed = [string]$entry.Value
            }
            else {
                $relative = $entry.Key.Substring('runtime/'.Length).Replace('/', '\')
                $installed = Join-Path (Join-Path $trustedRoot 'codex-runtime') $relative
            }
            if (-not [System.IO.File]::Exists($installed)) {
                throw "Existing trusted runtime dependency is unavailable: $($entry.Key)"
            }
            $installedItem = Get-Item -Force -LiteralPath $installed
            if (($installedItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
                throw "Existing trusted runtime dependency is a reparse point: $($entry.Key)"
            }
            if ((Get-FileHash -LiteralPath $installed -Algorithm SHA256).Hash -cne
                [string]$expected.Value) {
                throw "Existing trusted runtime dependency hash mismatch: $($entry.Key)"
            }
        }
    }
    finally {
        $manifestDocument.Dispose()
        $completionDocument.Dispose()
    }

    $runtimeReadable = @(
        $trustedRoot
        Get-ChildItem -Force -Recurse -LiteralPath $trustedRoot |
            Where-Object { -not $_.FullName.StartsWith(
                $ownerOnlyRoot + '\', [StringComparison]::OrdinalIgnoreCase
            ) -and $_.FullName -cne $ownerOnlyRoot } |
            ForEach-Object { $_.FullName }
    )
    $ownerOnlyPaths = @(
        $ownerOnlyRoot
        Get-ChildItem -Force -Recurse -LiteralPath $ownerOnlyRoot |
            ForEach-Object { $_.FullName }
    )
    Assert-ProtectedAcl -LiteralPaths $runtimeReadable
    Assert-OwnerOnlyAcl -LiteralPaths $ownerOnlyPaths
    return $manifestText | ConvertFrom-Json
}

function Open-PredecessorRuntimeFence {
    param([Parameter(Mandatory)][object]$Manifest)
    $paths = [System.Collections.Generic.HashSet[string]]::new(
        [StringComparer]::OrdinalIgnoreCase
    )
    foreach ($relative in @('manifest.json', 'install-complete.json')) {
        [void]$paths.Add((Join-Path $trustedRoot $relative))
    }
    foreach ($property in $Manifest.files.PSObject.Properties) {
        [void]$paths.Add((Join-Path $trustedRoot $property.Name.Replace('/', '\')))
    }
    foreach ($property in $Manifest.runtime.PSObject.Properties) {
        if ($property.Name -in @('runtime/pwsh.exe', 'runtime/python.exe') -or
            $property.Name.StartsWith('runtime/psmodule/', [StringComparison]::Ordinal)) {
            continue
        }
        $relative = $property.Name.Substring('runtime/'.Length).Replace('/', '\')
        [void]$paths.Add((Join-Path (Join-Path $trustedRoot 'codex-runtime') $relative))
    }
    foreach ($path in $paths) {
        $stream = [System.IO.FileStream]::new(
            $path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read,
            [System.IO.FileShare]::Delete
        )
        [void]$predecessorFenceStreams.Add($stream)
    }
}

function Close-PredecessorRuntimeFence {
    foreach ($stream in $predecessorFenceStreams) { $stream.Dispose() }
    $predecessorFenceStreams.Clear()
}

function Assert-SuccessorGenerationPivots {
    param(
        [Parameter(Mandatory)][object]$PredecessorManifest,
        [Parameter(Mandatory)][System.Collections.IDictionary]$SuccessorFileHashes
    )
    foreach ($name in @(
        'blip_review.py', 'run_codex_bound_ship_gate_once.ps1'
    )) {
        $predecessor = $PredecessorManifest.files.PSObject.Properties[$name]
        if ($null -eq $predecessor -or
            [string]$predecessor.Value -notmatch '^[0-9A-F]{64}$' -or
            -not $SuccessorFileHashes.Contains($name) -or
            [string]$SuccessorFileHashes[$name] -notmatch '^[0-9A-F]{64}$' -or
            [string]$SuccessorFileHashes[$name] -ceq [string]$predecessor.Value) {
            throw "Successor generation does not invalidate the cached predecessor pivot: $name"
        }
    }
}

function Assert-QuiescedPredecessorFiles {
    param([Parameter(Mandatory)][string[]]$LiteralPaths)
    $denyMask = Get-QuiesceDenyMask
    foreach ($path in $LiteralPaths) {
        $acl = Get-Acl -LiteralPath $path
        if (-not $acl.AreAccessRulesProtected) {
            throw "Quiesced predecessor file inherits ACLs: $path"
        }
        $ownerSid = ([System.Security.Principal.NTAccount]$acl.Owner).Translate(
            [System.Security.Principal.SecurityIdentifier]
        ).Value
        if ($ownerSid -cne $fixedOwnerSidValue) {
            throw "Quiesced predecessor file owner mismatch: $path"
        }
        $ownerDenied = [System.Security.AccessControl.FileSystemRights]0
        foreach ($rule in $acl.Access) {
            $sid = $rule.IdentityReference.Translate(
                [System.Security.Principal.SecurityIdentifier]
            ).Value
            if ($sid -ceq $fixedOwnerSidValue -and
                $rule.AccessControlType -eq [System.Security.AccessControl.AccessControlType]::Deny -and
                -not $rule.IsInherited) {
                $ownerDenied = $ownerDenied -bor ($rule.FileSystemRights -band $denyMask)
            }
        }
        if (($ownerDenied -band $denyMask) -ne $denyMask) {
            throw "Fixed owner can still read or execute a quiesced predecessor file: $path"
        }
    }
}

function Protect-QuiescedPredecessorRuntime {
    Protect-OwnerOnlyTree -LiteralPath $trustedRoot
    $paths = @($predecessorFenceStreams | ForEach-Object { $_.Name })
    foreach ($path in $paths) {
        Set-ExactFileSystemSecurity `
            -LiteralPath $path -Security (New-QuiescedFileSecurity)
    }
    Assert-QuiescedPredecessorFiles -LiteralPaths $paths
}

function Move-PreservedRuntimeDirectories {
    param(
        [Parameter(Mandatory)][string]$SourceRoot,
        [Parameter(Mandatory)][string]$DestinationRoot,
        [switch]$SourceAlreadyValidated
    )
    $source = [System.IO.Path]::GetFullPath($SourceRoot).TrimEnd('\')
    $destination = [System.IO.Path]::GetFullPath($DestinationRoot).TrimEnd('\')
    if (-not $SourceAlreadyValidated) { Assert-NoReparseTree -LiteralPath $source }
    foreach ($name in @('state', 'codex-home')) {
        $from = Join-Path $source $name
        $to = Join-Path $destination $name
        if (-not [System.IO.Directory]::Exists($from) -or
            [System.IO.Directory]::Exists($to)) {
            throw "Mutable runtime directory cannot be transferred exactly once: $name"
        }
        [System.IO.Directory]::Move($from, $to)
    }
    $artifactSource = Join-Path $source 'artifacts'
    if ([System.IO.Directory]::Exists($artifactSource)) {
        $artifactTarget = Join-Path $destination 'artifacts'
        if ([System.IO.Directory]::Exists($artifactTarget)) {
            throw 'Mutable runtime artifacts directory would be overwritten.'
        }
        [System.IO.Directory]::Move($artifactSource, $artifactTarget)
    }
}

function Write-ProtectedUpgradeJournal {
    param(
        [Parameter(Mandatory)][ValidateSet('initial', 'upgrade')][string]$Operation,
        [Parameter(Mandatory)][string]$TargetSourceCommit,
        [Parameter(Mandatory)][string]$TargetManifestSha256,
        [Parameter(Mandatory)][string]$TargetCandidateFreezeSha256
    )
    $payload = [ordered]@{
        schema = 'blip-runtime-upgrade-transaction/v1'
        transaction_id = $upgradeTransactionId
        operation = $Operation
        trusted_root = $trustedRoot
        stage_root = $stageRoot
        previous_root = $previousRoot
        failed_root = $failedRoot
        predecessor_manifest_sha256 = if ($Operation -ceq 'upgrade') {
            $allowedPredecessor.manifest_sha256
        }
        else { 'NONE' }
        target_source_commit = $TargetSourceCommit
        target_manifest_sha256 = $TargetManifestSha256
        target_candidate_freeze_sha256 = $TargetCandidateFreezeSha256
        created_at = [DateTimeOffset]::Now.ToString('o')
    } | ConvertTo-Json -Depth 4
    $bytes = [System.Text.UTF8Encoding]::new($false).GetBytes(
        $payload + [Environment]::NewLine
    )
    $journalStagePath = Join-Path $productRoot (
        '.upgrade-transaction-' + $upgradeTransactionId + '.tmp'
    )
    $stream = $null
    $journalStageCreated = $false
    $journalPublished = $false
    try {
        $stream = [System.IO.FileSystemAclExtensions]::Create(
            [System.IO.FileInfo]::new($journalStagePath),
            [System.IO.FileMode]::CreateNew,
            [System.Security.AccessControl.FileSystemRights]::FullControl,
            [System.IO.FileShare]::None,
            4096,
            [System.IO.FileOptions]::WriteThrough,
            (New-OwnerOnlyFileSecurity)
        )
        $journalStageCreated = $true
        $stream.Write($bytes, 0, $bytes.Length)
        $stream.Flush($true)
        $stream.Dispose()
        $stream = $null
        Assert-OwnerOnlyAcl -LiteralPaths @($journalStagePath)
        [System.IO.File]::Move($journalStagePath, $upgradeTransactionPath)
        $journalPublished = $true
        Assert-OwnerOnlyAcl -LiteralPaths @($upgradeTransactionPath)
    }
    finally {
        if ($null -ne $stream) {
            try { $stream.Dispose() }
            catch { }
        }
        if ($journalStageCreated -and -not $journalPublished -and
            [System.IO.File]::Exists($journalStagePath)) {
            try { [System.IO.File]::Delete($journalStagePath) }
            catch { }
        }
    }
}

function Move-UpgradeJournal {
    param([Parameter(Mandatory)][string]$Destination)
    if (-not [System.IO.File]::Exists($upgradeTransactionPath)) {
        throw "Active upgrade journal is unavailable: $upgradeTransactionPath"
    }
    if ([System.IO.File]::Exists($Destination)) {
        throw "Upgrade journal archive already exists: $Destination"
    }
    [System.IO.File]::Move($upgradeTransactionPath, $Destination)
    Assert-OwnerOnlyAcl -LiteralPaths @($Destination)
}

function Protect-UpgradeJournalOwnerOnly {
    try {
        Assert-OwnerOnlyAcl -LiteralPaths @($upgradeTransactionPath)
        return
    }
    catch {
        Assert-ProtectedAcl -LiteralPaths @($upgradeTransactionPath)
    }
    Set-ExactFileSystemSecurity `
        -LiteralPath $upgradeTransactionPath `
        -Security (New-OwnerOnlyFileSecurity)
    Assert-OwnerOnlyAcl -LiteralPaths @($upgradeTransactionPath)
}

function Set-RecoveryAttemptMode {
    param(
        [AllowEmptyString()][string]$Operation,
        [Parameter(Mandatory)][ref]$UpgradeAttempted
    )
    if ($Operation -ceq 'upgrade') {
        $UpgradeAttempted.Value = $true
    }
}

function Open-UpgradeLock {
    $ownerOnlySecurity = New-OwnerOnlyFileSecurity
    try {
        $script:upgradeLockStream = [System.IO.FileSystemAclExtensions]::Create(
            [System.IO.FileInfo]::new($upgradeLockPath),
            [System.IO.FileMode]::OpenOrCreate,
            [System.Security.AccessControl.FileSystemRights]::FullControl,
            [System.IO.FileShare]::None,
            4096,
            [System.IO.FileOptions]::WriteThrough,
            $ownerOnlySecurity
        )
    }
    catch [System.IO.IOException] {
        throw 'Another protected runtime install or recovery transaction is active.'
    }
    Set-ExactFileSystemSecurity `
        -LiteralPath $upgradeLockPath `
        -Security $ownerOnlySecurity
    Assert-OwnerOnlyAcl -LiteralPaths @($upgradeLockPath)
}

function Write-InstallerStructRecord {
    param(
        [Parameter(Mandatory)][ValidateSet('Info', 'Warn')][string]$Level,
        [Parameter(Mandatory)][Alias('Event')][string]$EventName,
        [Parameter(Mandatory)][string]$Message,
        [hashtable]$Data = @{}
    )
    try {
        if ($null -eq $script:installerStructLogger) {
            $script:installerStructLogger = New-StructLogger `
                -Service scripts `
                -Component 'blip-runtime-installer' `
                -LogRoot (Join-Path $productRoot 'logs') `
                -AllowListPath (Join-Path $candidateRoot 'struct-log-env-allowlist.unavailable.json') `
                -SkipEnvSnapshot
        }
        $structuredData = [ordered]@{
            event = $EventName
            transaction_id = $upgradeTransactionId
        }
        foreach ($entry in $Data.GetEnumerator()) {
            $structuredData[$entry.Key] = $entry.Value
        }
        if ($Level -ceq 'Info') {
            $script:installerStructLogger | Write-StructInfo -Msg $Message -Data $structuredData
        }
        else {
            $script:installerStructLogger | Write-StructWarn -Msg $Message -Data $structuredData
        }
    }
    catch {
        $script:installerStructLogger = $null
    }
}

function Write-InstallerStructWarning {
    param(
        [Parameter(Mandatory)][Alias('Event')][string]$EventName,
        [Parameter(Mandatory)][string]$Message,
        [hashtable]$Data = @{}
    )
    Write-InstallerStructRecord -Level Warn -Event $EventName -Message $Message -Data $Data
    Write-Warning $Message
}

function Write-InstallerStructInformation {
    param(
        [Parameter(Mandatory)][Alias('Event')][string]$EventName,
        [Parameter(Mandatory)][string]$Message,
        [hashtable]$Data = @{}
    )
    Write-InstallerStructRecord -Level Info -Event $EventName -Message $Message -Data $Data
}

function Assert-ActivationCommitMarker {
    param(
        [Parameter(Mandatory)][string]$ExpectedSourceCommit,
        [Parameter(Mandatory)][string]$ExpectedManifestSha256,
        [Parameter(Mandatory)][string]$ExpectedCandidateFreezeSha256
    )
    $manifestPath = Join-Path $trustedRoot 'manifest.json'
    $targetCompletionPath = Join-Path $trustedRoot 'install-complete.json'
    foreach ($required in @(
        $manifestPath, $targetCompletionPath, (Join-Path $trustedRoot 'state'),
        (Join-Path $trustedRoot 'codex-home')
    )) {
        if (-not (Test-Path -LiteralPath $required)) {
            throw "Committed target runtime is incomplete: $required"
        }
    }
    foreach ($path in @($manifestPath, $targetCompletionPath)) {
        $item = Get-Item -Force -LiteralPath $path
        if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw "Activation commit marker path is a reparse point: $path"
        }
    }
    $manifestText = Get-Content -Raw -LiteralPath $manifestPath
    $completionText = Get-Content -Raw -LiteralPath $targetCompletionPath
    $manifestDocument = [System.Text.Json.JsonDocument]::Parse($manifestText)
    $completionDocument = [System.Text.Json.JsonDocument]::Parse($completionText)
    try {
        Assert-ExactJsonProperties -Object $manifestDocument.RootElement -ExpectedNames @(
            'schema', 'source_commit', 'files', 'runtime',
            'candidate_freeze_sha256', 'activation', 'installed_at'
        ) -Label 'Committed target manifest'
        Assert-ExactJsonProperties -Object $completionDocument.RootElement -ExpectedNames @(
            'schema', 'owner_sid', 'candidate_freeze_sha256',
            'manifest_sha256', 'completed_at'
        ) -Label 'Committed target completion marker'
    }
    finally {
        $manifestDocument.Dispose()
        $completionDocument.Dispose()
    }
    $manifest = $manifestText | ConvertFrom-Json
    $completion = $completionText | ConvertFrom-Json
    $manifestHash = (Get-FileHash -LiteralPath $manifestPath -Algorithm SHA256).Hash
    if ($manifest.schema -cne 'blip-trusted-runtime-manifest/v2' -or
        [string]$manifest.source_commit -cne $ExpectedSourceCommit -or
        $manifestHash -cne $ExpectedManifestSha256 -or
        [string]$manifest.candidate_freeze_sha256 -cne $ExpectedCandidateFreezeSha256 -or
        $completion.schema -cne 'blip-trusted-runtime-complete/v2' -or
        [string]$completion.owner_sid -cne $fixedOwnerSidValue -or
        [string]$completion.candidate_freeze_sha256 -cne
            [string]$manifest.candidate_freeze_sha256 -or
        [string]$completion.manifest_sha256 -cne $manifestHash) {
        throw 'Committed target runtime tuple is invalid.'
    }
}

function Test-TargetActivationMarkerPublished {
    param([Parameter(Mandatory)][bool]$IsUpgrade)
    if (-not [System.IO.File]::Exists($completionPath)) { return $false }
    if (-not $IsUpgrade) { return $true }
    return [System.IO.Directory]::Exists($previousRoot)
}

function Protect-CompletionMarkerRuntimeReadable {
    try {
        Assert-ProtectedAcl -LiteralPaths @($completionPath)
        return
    }
    catch {
        Assert-OwnerOnlyAcl -LiteralPaths @($completionPath)
    }
    Set-ExactFileSystemSecurity `
        -LiteralPath $completionPath `
        -Security (New-ProtectedFileSecurity)
    Assert-ProtectedAcl -LiteralPaths @($completionPath)
}

function Protect-UpgradeArchiveOwnerOnly {
    param([Parameter(Mandatory)][string]$LiteralPath)
    try {
        Assert-OwnerOnlyAcl -LiteralPaths @($LiteralPath)
        return
    }
    catch {
        Assert-ProtectedAcl -LiteralPaths @($LiteralPath)
    }
    Set-ExactFileSystemSecurity `
        -LiteralPath $LiteralPath `
        -Security (New-OwnerOnlyFileSecurity)
    Assert-OwnerOnlyAcl -LiteralPaths @($LiteralPath)
}

function Recover-CommittedUpgradeArchive {
    param(
        [Parameter(Mandatory)][string]$ExpectedTargetSourceCommit,
        [Parameter(Mandatory)][string]$ExpectedTargetCandidateFreezeSha256,
        [ref]$OperationOut
    )
    $matchingTransactions = [System.Collections.Generic.List[object]]::new()
    foreach ($archiveItem in @(Get-ChildItem -Force -File -LiteralPath $productRoot |
            Where-Object { $_.Name -match '^upgrade-complete-[0-9a-f]{32}\.json$' })) {
        if (($archiveItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw "Committed upgrade archive is a reparse point: $($archiveItem.FullName)"
        }
        Protect-UpgradeArchiveOwnerOnly -LiteralPath $archiveItem.FullName
        $archiveText = Get-Content -Raw -LiteralPath $archiveItem.FullName
        $archiveDocument = [System.Text.Json.JsonDocument]::Parse($archiveText)
        try {
            Assert-ExactJsonProperties -Object $archiveDocument.RootElement -ExpectedNames @(
                'schema', 'transaction_id', 'operation', 'trusted_root', 'stage_root',
                'previous_root', 'failed_root', 'predecessor_manifest_sha256',
                'target_source_commit', 'target_manifest_sha256',
                'target_candidate_freeze_sha256', 'created_at'
            ) -Label 'Committed upgrade archive'
        }
        finally { $archiveDocument.Dispose() }
        $transaction = $archiveText | ConvertFrom-Json
        $archiveId = [string]$transaction.transaction_id
        if ($transaction.schema -cne 'blip-runtime-upgrade-transaction/v1' -or
            $archiveId -notmatch '^[0-9a-f]{32}$' -or
            $archiveItem.Name -cne "upgrade-complete-$archiveId.json" -or
            [string]$transaction.operation -notin @('initial', 'upgrade') -or
            [string]$transaction.target_source_commit -notmatch '^[0-9a-f]{40}$' -or
            [string]$transaction.target_manifest_sha256 -notmatch '^[0-9A-F]{64}$' -or
            [string]$transaction.target_candidate_freeze_sha256 -notmatch '^[0-9A-F]{64}$' -or
            ([string]$transaction.operation -ceq 'upgrade' -and
                [string]$transaction.predecessor_manifest_sha256 -notmatch '^[0-9A-F]{64}$') -or
            ([string]$transaction.operation -ceq 'initial' -and
                [string]$transaction.predecessor_manifest_sha256 -cne 'NONE')) {
            throw "Committed upgrade archive authority is invalid: $($archiveItem.FullName)"
        }
        foreach ($entry in @(
            @{ Value = [string]$transaction.trusted_root; Pattern = '^v1$' },
            @{ Value = [string]$transaction.stage_root; Pattern = '^v1\.stage-' + $archiveId + '$' },
            @{ Value = [string]$transaction.previous_root; Pattern = '^v1\.previous-' + $archiveId + '$' },
            @{ Value = [string]$transaction.failed_root; Pattern = '^v1\.failed-' + $archiveId + '$' }
        )) {
            $full = [System.IO.Path]::GetFullPath($entry.Value)
            if ([System.IO.Path]::GetDirectoryName($full) -cne $productRoot -or
                [System.IO.Path]::GetFileName($full) -notmatch $entry.Pattern) {
                throw 'Committed upgrade archive contains a non-canonical runtime path.'
            }
        }
        if ([string]$transaction.target_source_commit -ceq $ExpectedTargetSourceCommit -and
            [string]$transaction.target_candidate_freeze_sha256 -ceq
                $ExpectedTargetCandidateFreezeSha256) {
            if ([string]$transaction.operation -ceq 'upgrade' -and
                [string]$transaction.predecessor_manifest_sha256 -cne
                    $allowedPredecessor.manifest_sha256) {
                throw 'Matching committed upgrade archive has an invalid predecessor tuple.'
            }
            $matchingTransactions.Add($transaction)
        }
    }
    if ($matchingTransactions.Count -eq 0) { return }
    if ($matchingTransactions.Count -ne 1) {
        throw 'Multiple committed upgrade archives match the requested candidate.'
    }
    $match = $matchingTransactions[0]
    if ($null -ne $OperationOut) {
        $OperationOut.Value = [string]$match.operation
    }
    Protect-CompletionMarkerRuntimeReadable
    Assert-ActivationCommitMarker `
        -ExpectedSourceCommit ([string]$match.target_source_commit) `
        -ExpectedManifestSha256 ([string]$match.target_manifest_sha256) `
        -ExpectedCandidateFreezeSha256 ([string]$match.target_candidate_freeze_sha256)
    return [pscustomobject]@{
        Status = 'committed'
        Operation = [string]$match.operation
        PreviousRoot = if ([string]$match.operation -ceq 'upgrade') {
            [string]$match.previous_root
        }
        else { '' }
    }
}

function Restore-PreviousRuntime {
    param(
        [Parameter(Mandatory)][string]$Trusted,
        [Parameter(Mandatory)][string]$Previous,
        [Parameter(Mandatory)][string]$Failed,
        [Parameter(Mandatory)][string]$Stage
    )
    if (-not [System.IO.Directory]::Exists($Previous)) {
        throw "Previous trusted runtime is unavailable for rollback: $Previous"
    }
    foreach ($name in @('state', 'codex-home')) {
        $previousMutable = Join-Path $Previous $name
        if (-not [System.IO.Directory]::Exists($previousMutable)) {
            $sources = @(@(
                (Join-Path $Trusted $name), (Join-Path $Stage $name)
            ) | Where-Object { [System.IO.Directory]::Exists($_) })
            if ($sources.Count -ne 1) {
                throw "Rollback cannot locate exactly one mutable runtime directory: $name"
            }
            [System.IO.Directory]::Move($sources[0], $previousMutable)
        }
    }
    $previousArtifacts = Join-Path $Previous 'artifacts'
    if (-not [System.IO.Directory]::Exists($previousArtifacts)) {
        $artifactSources = @(@(
            (Join-Path $Trusted 'artifacts'), (Join-Path $Stage 'artifacts')
        ) | Where-Object { [System.IO.Directory]::Exists($_) })
        if ($artifactSources.Count -gt 1) {
            throw 'Rollback found ambiguous mutable artifacts directories.'
        }
        if ($artifactSources.Count -eq 1) {
            [System.IO.Directory]::Move($artifactSources[0], $previousArtifacts)
        }
    }
    if ([System.IO.Directory]::Exists($Trusted)) {
        if ([System.IO.Directory]::Exists($Failed)) {
            throw "Failed-runtime quarantine target already exists: $Failed"
        }
        [System.IO.Directory]::Move($Trusted, $Failed)
    }
    [System.IO.Directory]::Move($Previous, $Trusted)
}

function Recover-InterruptedUpgrade {
    param(
        [Parameter(Mandatory)]
        [ValidatePattern('^[0-9a-f]{40}$')]
        [string]$ExpectedTargetSourceCommit,

        [Parameter(Mandatory)]
        [ValidatePattern('^[0-9A-F]{64}$')]
        [string]$ExpectedTargetCandidateFreezeSha256,

        [ref]$OperationOut
    )
    if (-not [System.IO.File]::Exists($upgradeTransactionPath)) {
        if ($null -eq $OperationOut) {
            return Recover-CommittedUpgradeArchive `
                -ExpectedTargetSourceCommit $ExpectedTargetSourceCommit `
                -ExpectedTargetCandidateFreezeSha256 $ExpectedTargetCandidateFreezeSha256
        }
        return Recover-CommittedUpgradeArchive `
            -ExpectedTargetSourceCommit $ExpectedTargetSourceCommit `
            -ExpectedTargetCandidateFreezeSha256 $ExpectedTargetCandidateFreezeSha256 `
            -OperationOut $OperationOut
    }
    Protect-UpgradeJournalOwnerOnly
    $transactionText = Get-Content -Raw -LiteralPath $upgradeTransactionPath
    $document = [System.Text.Json.JsonDocument]::Parse($transactionText)
    try {
        Assert-ExactJsonProperties -Object $document.RootElement -ExpectedNames @(
            'schema', 'transaction_id', 'operation', 'trusted_root', 'stage_root',
            'previous_root', 'failed_root', 'predecessor_manifest_sha256',
            'target_source_commit', 'target_manifest_sha256',
            'target_candidate_freeze_sha256', 'created_at'
        ) -Label 'Upgrade transaction journal'
    }
    finally { $document.Dispose() }
    $transaction = $transactionText | ConvertFrom-Json
    $journalId = [string]$transaction.transaction_id
    if ($transaction.schema -cne 'blip-runtime-upgrade-transaction/v1' -or
        $journalId -notmatch '^[0-9a-f]{32}$' -or
        [string]$transaction.operation -notin @('initial', 'upgrade') -or
        [string]$transaction.target_source_commit -notmatch '^[0-9a-f]{40}$' -or
        [string]$transaction.target_manifest_sha256 -notmatch '^[0-9A-F]{64}$' -or
        [string]$transaction.target_candidate_freeze_sha256 -notmatch '^[0-9A-F]{64}$' -or
        ([string]$transaction.operation -ceq 'upgrade' -and
            [string]$transaction.predecessor_manifest_sha256 -cne
                $allowedPredecessor.manifest_sha256) -or
        ([string]$transaction.operation -ceq 'initial' -and
            [string]$transaction.predecessor_manifest_sha256 -cne 'NONE')) {
        throw 'Upgrade transaction journal authority is invalid.'
    }
    foreach ($entry in @(
        @{ Value = [string]$transaction.trusted_root; Pattern = '^v1$' },
        @{ Value = [string]$transaction.stage_root; Pattern = '^v1\.stage-' + $journalId + '$' },
        @{ Value = [string]$transaction.previous_root; Pattern = '^v1\.previous-' + $journalId + '$' },
        @{ Value = [string]$transaction.failed_root; Pattern = '^v1\.failed-' + $journalId + '$' }
    )) {
        $full = [System.IO.Path]::GetFullPath($entry.Value)
        if ([System.IO.Path]::GetDirectoryName($full) -cne $productRoot -or
            [System.IO.Path]::GetFileName($full) -notmatch $entry.Pattern) {
            throw 'Upgrade transaction journal contains a non-canonical runtime path.'
        }
    }
    $journalPrevious = [string]$transaction.previous_root
    $journalFailed = [string]$transaction.failed_root
    if ($null -ne $OperationOut) {
        $OperationOut.Value = [string]$transaction.operation
    }
    $journalMatchesRequestedCandidate =
        [string]$transaction.target_source_commit -ceq $ExpectedTargetSourceCommit -and
        [string]$transaction.target_candidate_freeze_sha256 -ceq
            $ExpectedTargetCandidateFreezeSha256
    $archive = Join-Path $productRoot (
        'upgrade-recovered-' + [string]$transaction.transaction_id + '.json'
    )
    $committedArchive = Join-Path $productRoot (
        'upgrade-complete-' + [string]$transaction.transaction_id + '.json'
    )
    if ([string]$transaction.operation -ceq 'initial') {
        if ([System.IO.Directory]::Exists($trustedRoot)) {
            if ([System.IO.File]::Exists((Join-Path $trustedRoot 'install-complete.json'))) {
                Assert-ActivationCommitMarker `
                    -ExpectedSourceCommit ([string]$transaction.target_source_commit) `
                    -ExpectedManifestSha256 ([string]$transaction.target_manifest_sha256) `
                    -ExpectedCandidateFreezeSha256 `
                        ([string]$transaction.target_candidate_freeze_sha256)
                Protect-CompletionMarkerRuntimeReadable
                Move-UpgradeJournal -Destination $committedArchive
                if (-not $journalMatchesRequestedCandidate) {
                    throw 'A committed initial runtime journal was recovered for a different candidate; retry the requested installation.'
                }
                return [pscustomobject]@{
                    Status = 'committed'
                    Operation = 'initial'
                    PreviousRoot = ''
                }
            }
            if ([System.IO.Directory]::Exists($journalFailed)) {
                throw 'Initial runtime recovery quarantine target already exists.'
            }
            [System.IO.Directory]::Move($trustedRoot, $journalFailed)
            Move-UpgradeJournal -Destination $archive
            throw 'An interrupted initial runtime publish was quarantined; retry installation.'
        }
        $journalStage = [string]$transaction.stage_root
        if ([System.IO.Directory]::Exists($journalStage)) {
            if ([System.IO.Directory]::Exists($journalFailed)) {
                throw 'Initial runtime recovery quarantine target already exists.'
            }
            [System.IO.Directory]::Move($journalStage, $journalFailed)
            Move-UpgradeJournal -Destination $archive
            throw 'An interrupted initial runtime stage was quarantined; retry installation.'
        }
        if ([System.IO.Directory]::Exists($journalFailed)) {
            Move-UpgradeJournal -Destination $archive
            throw 'An interrupted initial runtime was already quarantined; retry installation.'
        }
        throw 'Interrupted initial runtime installation is not recoverable automatically.'
    }
    if ([System.IO.Directory]::Exists($journalPrevious)) {
        if ([System.IO.Directory]::Exists($trustedRoot) -and
            [System.IO.File]::Exists((Join-Path $trustedRoot 'install-complete.json'))) {
            Assert-ActivationCommitMarker `
                -ExpectedSourceCommit ([string]$transaction.target_source_commit) `
                -ExpectedManifestSha256 ([string]$transaction.target_manifest_sha256) `
                -ExpectedCandidateFreezeSha256 `
                    ([string]$transaction.target_candidate_freeze_sha256)
            Protect-CompletionMarkerRuntimeReadable
            Move-UpgradeJournal -Destination $committedArchive
            if (-not $journalMatchesRequestedCandidate) {
                throw 'A committed runtime upgrade journal was recovered for a different candidate; retry the requested installation.'
            }
            return [pscustomobject]@{
                Status = 'committed'
                Operation = 'upgrade'
                PreviousRoot = $journalPrevious
            }
        }
        Restore-PreviousRuntime -Trusted $trustedRoot -Previous $journalPrevious `
            -Failed $journalFailed -Stage ([string]$transaction.stage_root)
        Protect-RuntimeTree -LiteralPath $trustedRoot
        [void](Assert-ExistingTrustedRuntime)
        Move-UpgradeJournal -Destination $archive
        throw 'An interrupted runtime upgrade was rolled back; retry the authorized installation.'
    }
    if ([System.IO.Directory]::Exists($trustedRoot)) {
        Protect-RuntimeTree -LiteralPath $trustedRoot
        [void](Assert-ExistingTrustedRuntime)
        Move-UpgradeJournal -Destination $archive
        throw 'An interrupted runtime upgrade stopped before predecessor publication; retry installation.'
    }
    throw 'Interrupted runtime upgrade is not recoverable automatically; trusted runtime is unavailable.'
}

$freezeStream = $null
$reviewedManifestStream = $null
$freezeDocument = $null
$stagePublished = $false
$activationCommitted = $false
$upgradeAttempted = $false
$recoveryOperation = ''
$transactionWritten = $false
$trustedBootstrapReady = $false
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
            'BootstrapStream', 'StructLogStream', 'StructLogSha256', 'StructLogModule',
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
            'BootstrapStream', 'StructLogStream', 'InstallerLauncherStream', 'VerifierStream'
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
            [System.IO.Path]::GetFullPath($BootstrapContext.StructLogStream.Name) -cne
                (Resolve-CandidatePath -RelativePath 'scripts/lib/StructLog.psm1') -or
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
            $BootstrapContext.StructLogSha256 -notmatch '^[0-9A-F]{64}$' -or
            (Get-OpenStreamSha256 -Stream $BootstrapContext.StructLogStream) -cne
                $BootstrapContext.StructLogSha256 -or
            $BootstrapContext.StructLogModule -isnot [System.Management.Automation.PSModuleInfo] -or
            $BootstrapContext.StructLogModule.Name -cne 'BlipInstallerStructLog' -or
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
        $trustedBootstrapReady = $true
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
        'install_blip_auto_approval.ps1', 'invoke_frozen_blip_installer.ps1',
        'scripts/lib/StructLog.psm1'
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
        if ($sourceCommitElement.GetString() -ceq $allowedPredecessor.source_commit) {
            throw 'Candidate source commit must advance beyond the exact allowed predecessor.'
        }
        $frozenInstaller = $freeze.source_files.PSObject.Properties['install_blip_auto_approval.ps1']
        $frozenBootstrap = $freeze.source_files.PSObject.Properties['invoke_frozen_blip_installer.ps1']
        if ($null -eq $frozenInstaller -or
            [string]$frozenInstaller.Value -cne $ExpectedInstallerSha256.ToUpperInvariant() -or
            $null -eq $frozenBootstrap -or
            [string]$frozenBootstrap.Value -cne $ExpectedBootstrapSha256.ToUpperInvariant()) {
            throw 'The freeze does not bind the executing installer/bootstrap pair.'
        }
    }

    if ($Apply) {
        Assert-ProgramDataParent
        New-ProtectedDirectory -LiteralPath $protectedRoot
        New-ProtectedDirectory -LiteralPath $productRoot
        New-ProtectedDirectory -LiteralPath $secretRoot -OwnerOnly
        Open-UpgradeLock
        try {
            $recoveryResult = Recover-InterruptedUpgrade `
                -ExpectedTargetSourceCommit $sourceCommitElement.GetString() `
                -ExpectedTargetCandidateFreezeSha256 $freezeHash `
                -OperationOut ([ref]$recoveryOperation)
        }
        catch {
            Set-RecoveryAttemptMode `
                -Operation $recoveryOperation `
                -UpgradeAttempted ([ref]$upgradeAttempted)
            throw
        }
        if ($null -ne $recoveryResult) {
            if ($recoveryResult.Status -cne 'committed' -or
                $recoveryResult.Operation -notin @('initial', 'upgrade')) {
                throw 'Interrupted runtime recovery returned an invalid result.'
            }
            $recoveredPrevious = if ($recoveryResult.Operation -ceq 'upgrade') {
                " previous_runtime=$($recoveryResult.PreviousRoot)"
            }
            else { '' }
            Write-InstallerStructInformation -Event 'committed_recovery_completed' `
                -Message 'A committed runtime transaction journal was recovered.' `
                -Data @{
                    operation = $recoveryResult.Operation
                    trusted_root = $trustedRoot
                    previous_root = $recoveryResult.PreviousRoot
                }
            Write-Output (
                "INSTALL_RESULT trusted_runtime=$trustedRoot$recoveredPrevious " +
                'recovery=committed secret_path=' + $secretRoot +
                ' activation=OWNER_PEM_AND_CODEX_LOGIN_REQUIRED'
            )
            return
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

    $upgradeAttempted = Test-Path -LiteralPath $trustedRoot
    $existingManifest = $null
    if ($upgradeAttempted) {
        $existingManifest = Assert-ExistingTrustedRuntime
        Open-PredecessorRuntimeFence -Manifest $existingManifest
    }
    New-ProtectedDirectory -LiteralPath $stageRoot
    $stageDirectories = @(
        'app-scripts', 'codex-runtime',
        'codex-runtime\bin', 'codex-runtime\codex-path',
        'codex-runtime\codex-resources'
    )
    if (-not $upgradeAttempted) {
        $stageDirectories = @('state') + $stageDirectories
    }
    foreach ($relative in $stageDirectories) {
        New-ProtectedDirectory -LiteralPath (Join-Path $stageRoot $relative)
    }
    if (-not $upgradeAttempted) {
        New-ProtectedDirectory -LiteralPath (Join-Path $stageRoot 'codex-home') -OwnerOnly
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
    if (-not $upgradeAttempted) {
        [System.IO.File]::WriteAllText(
            (Join-Path $stageRoot 'codex-home\auth.json'),
            '{}',
            [System.Text.UTF8Encoding]::new($false)
        )
    }

    $manifestFiles = [ordered]@{}
    foreach ($entry in $trustedFiles.GetEnumerator()) {
        $manifestFiles[$entry.Key] = [string]$freeze.source_files.PSObject.Properties[$entry.Value].Value
    }
    $manifestRuntime = [ordered]@{}
    foreach ($entry in $runtimeFiles.GetEnumerator()) {
        $manifestRuntime[$entry.Key] = [string]$freeze.runtime_source.PSObject.Properties[$entry.Key].Value
    }
    if ($upgradeAttempted) {
        Assert-SuccessorGenerationPivots `
            -PredecessorManifest $existingManifest -SuccessorFileHashes $manifestFiles
    }
    [ordered]@{
        schema = 'blip-trusted-runtime-manifest/v2'
        source_commit = $sourceCommitElement.GetString().ToLowerInvariant()
        files = $manifestFiles
        runtime = $manifestRuntime
        candidate_freeze_sha256 = $freezeHash
        activation = 'OWNER_PEM_AND_CODEX_LOGIN_REQUIRED'
        installed_at = [DateTimeOffset]::Now.ToString('o')
    } | ConvertTo-Json -Depth 6 | Set-Content `
        -LiteralPath (Join-Path $stageRoot 'manifest.json') -Encoding utf8NoBOM
    $targetManifestHash = (Get-FileHash `
        -LiteralPath (Join-Path $stageRoot 'manifest.json') -Algorithm SHA256
    ).Hash.ToUpperInvariant()

    if (-not $upgradeAttempted) {
        Protect-RuntimeTree -LiteralPath $stageRoot
    }
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

    $transactionOperation = if ($upgradeAttempted) { 'upgrade' } else { 'initial' }
    Write-ProtectedUpgradeJournal -Operation $transactionOperation `
        -TargetSourceCommit ($sourceCommitElement.GetString().ToLowerInvariant()) `
        -TargetManifestSha256 $targetManifestHash `
        -TargetCandidateFreezeSha256 $freezeHash
    $transactionWritten = $true

    if ($upgradeAttempted) {
        $predecessorManifestPath = Join-Path $trustedRoot 'manifest.json'
        if ((Get-FileHash -LiteralPath $predecessorManifestPath -Algorithm SHA256).Hash `
                -cne $allowedPredecessor.manifest_sha256) {
            throw 'Existing trusted runtime changed after its predecessor tuple was fenced.'
        }
        Protect-QuiescedPredecessorRuntime
        Close-PredecessorRuntimeFence
        [System.IO.Directory]::Move($trustedRoot, $previousRoot)
        Move-PreservedRuntimeDirectories -SourceRoot $previousRoot -DestinationRoot $stageRoot `
            -SourceAlreadyValidated
        Protect-RuntimeTree -LiteralPath $stageRoot
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
    $ownerOnlyRuntimePaths = @(
        $ownerOnlyRuntimeRoot
        Get-ChildItem -Force -Recurse -LiteralPath $ownerOnlyRuntimeRoot |
            ForEach-Object { $_.FullName }
    )
    Assert-OwnerOnlyAcl -LiteralPaths (@($secretRoot) + $ownerOnlyRuntimePaths)

    $installedManifestPath = Join-Path $trustedRoot 'manifest.json'
    $installedManifestHash = (Get-FileHash `
        -LiteralPath $installedManifestPath -Algorithm SHA256
    ).Hash.ToUpperInvariant()
    if ($installedManifestHash -cne $targetManifestHash) {
        throw 'Published runtime manifest differs from the journal-bound target manifest.'
    }
    $completionPayload = [ordered]@{
        schema = 'blip-trusted-runtime-complete/v2'
        owner_sid = $fixedOwnerSidValue
        candidate_freeze_sha256 = $freezeHash
        manifest_sha256 = $installedManifestHash
        completed_at = [DateTimeOffset]::Now.ToString('o')
    } | ConvertTo-Json -Depth 4
    $completionBytes = [System.Text.UTF8Encoding]::new($false).GetBytes(
        $completionPayload + [Environment]::NewLine
    )
    $completionStream = [System.IO.FileSystemAclExtensions]::Create(
        [System.IO.FileInfo]::new($completionStagePath),
        [System.IO.FileMode]::CreateNew,
        [System.Security.AccessControl.FileSystemRights]::FullControl,
        [System.IO.FileShare]::None,
        4096,
        [System.IO.FileOptions]::WriteThrough,
        (New-OwnerOnlyFileSecurity)
    )
    try {
        $completionStream.Write($completionBytes, 0, $completionBytes.Length)
        $completionStream.Flush($true)
    }
    finally { $completionStream.Dispose() }
    Assert-OwnerOnlyAcl -LiteralPaths @($completionStagePath)
    [System.IO.File]::Move($completionStagePath, $completionPath)
    $activationCommitted = $true
    Protect-CompletionMarkerRuntimeReadable
    $completionReadback = Get-Content -Raw -LiteralPath $completionPath | ConvertFrom-Json
    if ($completionReadback.schema -cne 'blip-trusted-runtime-complete/v2' -or
        [string]$completionReadback.owner_sid -cne $fixedOwnerSidValue -or
        [string]$completionReadback.candidate_freeze_sha256 -cne $freezeHash -or
        [string]$completionReadback.manifest_sha256 -cne $installedManifestHash) {
        throw 'Installed completion marker did not read back with the exact verified runtime tuple.'
    }
    if ($transactionWritten) {
        try {
            Move-UpgradeJournal -Destination $upgradeCompletePath
            $transactionWritten = $false
        }
        catch {
            $message = 'Runtime upgrade committed, but its journal remains for next-invocation recovery: ' +
                $upgradeTransactionPath
            Write-InstallerStructWarning -Event 'journal_archive_failed_after_commit' `
                -Message $message -Data @{
                    journal_path = $upgradeTransactionPath
                    trusted_root = $trustedRoot
                }
        }
    }
    $previousOutput = if ($upgradeAttempted) { " previous_runtime=$previousRoot" } else { '' }
    Write-Output "INSTALL_RESULT trusted_runtime=$trustedRoot$previousOutput secret_path=$secretRoot activation=OWNER_PEM_AND_CODEX_LOGIN_REQUIRED"
}
catch {
    $installationError = $_
    if (-not $Apply -or -not $trustedBootstrapReady) {
        throw $installationError
    }
    $targetMarkerPublished = Test-TargetActivationMarkerPublished `
        -IsUpgrade $upgradeAttempted
    if ($targetMarkerPublished) {
        try {
            Assert-ActivationCommitMarker `
                -ExpectedSourceCommit ($sourceCommitElement.GetString().ToLowerInvariant()) `
                -ExpectedManifestSha256 $targetManifestHash `
                -ExpectedCandidateFreezeSha256 $freezeHash
            $activationCommitted = $true
            Write-InstallerStructWarning -Event 'activation_committed_journal_retained' `
                -Message 'Runtime activation committed; the journal is retained after a post-commit failure.' `
                -Data @{ journal_path = $upgradeTransactionPath; trusted_root = $trustedRoot }
        }
        catch {
            Write-InstallerStructWarning -Event 'activation_marker_ambiguous' `
                -Message 'A final activation marker exists but is ambiguous; no automatic rollback is allowed.' `
                -Data @{ journal_path = $upgradeTransactionPath; trusted_root = $trustedRoot }
        }
    }
    elseif ($upgradeAttempted -and $transactionWritten -and -not $activationCommitted) {
        try {
            if ([System.IO.Directory]::Exists($previousRoot)) {
                Restore-PreviousRuntime -Trusted $trustedRoot -Previous $previousRoot `
                    -Failed $failedRoot -Stage $stageRoot
            }
            elseif (-not [System.IO.Directory]::Exists($trustedRoot)) {
                throw 'Upgrade journal exists but neither trusted nor previous runtime is available.'
            }
            Protect-RuntimeTree -LiteralPath $trustedRoot
            [void](Assert-ExistingTrustedRuntime)
            if ($transactionWritten) {
                Move-UpgradeJournal -Destination $upgradeRollbackPath
                $transactionWritten = $false
            }
            Write-InstallerStructWarning -Event 'upgrade_rolled_back' `
                -Message "Runtime upgrade failed and the exact predecessor was restored: $trustedRoot" `
                -Data @{ trusted_root = $trustedRoot; rollback_journal = $upgradeRollbackPath }
        }
        catch {
            $message = "Runtime upgrade rollback could not restore the exact predecessor: $($_.Exception.Message)"
            Write-InstallerStructWarning -Event 'upgrade_rollback_failed' -Message $message `
                -Data @{ trusted_root = $trustedRoot; journal_path = $upgradeTransactionPath }
        }
    }
    elseif (-not $upgradeAttempted -and $transactionWritten -and -not $activationCommitted) {
        try {
            $incompleteRoot = if ([System.IO.Directory]::Exists($trustedRoot)) {
                $trustedRoot
            }
            elseif ([System.IO.Directory]::Exists($stageRoot)) { $stageRoot }
            else { $null }
            if ($null -eq $incompleteRoot) {
                throw 'Initial install journal exists but no incomplete runtime root is available.'
            }
            if ([System.IO.Directory]::Exists($failedRoot)) {
                throw "Initial install quarantine target already exists: $failedRoot"
            }
            [System.IO.Directory]::Move($incompleteRoot, $failedRoot)
            Move-UpgradeJournal -Destination $upgradeRollbackPath
            $transactionWritten = $false
            Write-InstallerStructWarning -Event 'initial_runtime_quarantined' `
                -Message "Incomplete initial runtime was quarantined: $failedRoot" `
                -Data @{ failed_root = $failedRoot; rollback_journal = $upgradeRollbackPath }
        }
        catch {
            Write-InstallerStructWarning -Event 'initial_recovery_failed' `
                -Message "Initial install recovery journal remains: $upgradeTransactionPath" `
                -Data @{ journal_path = $upgradeTransactionPath }
        }
    }
    elseif ($stagePublished -and -not $activationCommitted -and
        [System.IO.Directory]::Exists($trustedRoot)) {
        try {
            [System.IO.Directory]::Move($trustedRoot, $failedRoot)
            Write-InstallerStructWarning -Event 'published_runtime_quarantined' `
                -Message "Incomplete published runtime was quarantined: $failedRoot" `
                -Data @{ failed_root = $failedRoot }
        }
        catch {
            Write-InstallerStructWarning -Event 'published_runtime_quarantine_failed' `
                -Message "Incomplete runtime remains non-runnable without install-complete.json: $trustedRoot" `
                -Data @{ trusted_root = $trustedRoot }
        }
    }
    throw $installationError
}
finally {
    if ($null -ne $freezeDocument) { $freezeDocument.Dispose() }
    Close-PredecessorRuntimeFence
    if ($null -ne $upgradeLockStream) { $upgradeLockStream.Dispose() }
    foreach ($stream in $pinnedStreams) { $stream.Dispose() }
    if ($trustedBootstrapReady -and -not $stagePublished -and
        (Test-Path -LiteralPath $stageRoot)) {
        Write-InstallerStructWarning -Event 'failed_stage_retained' `
            -Message "A protected failed stage remains for owner inspection: $stageRoot" `
            -Data @{ stage_root = $stageRoot }
    }
}
