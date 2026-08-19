# scripts/lib/cad-extension-cache-acl.ps1
# Windows CAD extension cache DACL convergence and validation (issue #625).
#
# The runtime converter validates the CAD extension cache chain with
# ifc2usdc_powershell_adapter.py::_path_components_are_owner_private on EVERY
# platform, but its hardener (harden_default_hoops_main_permissions) returns
# early on `os.name == "nt"`: the POSIX branch replaces the entrypoint inode,
# which has no NTFS equivalent. Nothing converged the Windows cache ACLs, so the
# cross-platform validation passed only where the DACL happened to be clean and
# conversion otherwise failed at runtime with an unactionable
# `converter_unavailable ... CAD extension cache path failed owner-private
# permission validation`.
#
# This module mirrors the adapter's Windows predicate (trusted writer SIDs,
# write mask, inherit-only exemption, owner trust) and converges the chain in
# place so deploy fails closed instead of the first conversion.
#
# Three Windows behaviours measured on the reporting host are deliberately
# designed around:
#
#   1. `icacls /remove:g *<SID>` returns 1332 (ERROR_NONE_MAPPED) and reports
#      "processed 0 files" for an unresolvable orphan SID - it looks successful
#      and changes nothing. Every removal here happens on the ACL object model,
#      which never name-translates a SecurityIdentifier.
#   2. Set-Acl persists the SACL as well and therefore needs SeSecurityPrivilege
#      (elevation). DACL-only writes use an Access-section-only security object
#      persisted through [System.IO.FileSystemAclExtensions]::SetAccessControl,
#      which only needs WRITE_DAC on the object - the owner already has it.
#   3. PowerShell's @() does not unroll an AuthorizationRuleCollection: it wraps
#      the whole collection as a single element and silently reports zero rules.
#      Rules are read through GetAccessRules(...) and indexed positionally.
#
# Known fidelity limit: .NET FileSystemSecurity surfaces ACCESS_ALLOWED /
# ACCESS_DENIED ACEs, while the adapter's ctypes reader also accepts object and
# callback allow ACE types (5/9/11). NTFS DACLs on this path do not use them.
# This module converges and pre-validates; the runtime adapter stays the final
# authority on the same predicate.

Set-StrictMode -Version Latest

$script:CadExtensionCacheStatusSchema = 'cad-extension-cache-windows-hardening/v1'

# omni/services/convert/cad/services/process/hoops_main.py - the suffix pinned by
# ifc2usdc_powershell_adapter.py::_discover_default_hoops_main.
$script:CadExtensionCacheEntryPointSuffix = @(
    'omni', 'services', 'convert', 'cad', 'services', 'process', 'hoops_main.py'
)

function Get-CadExtensionCacheWriteMask {
    # Mirrors ifc2usdc_powershell_adapter.py::_windows_acl_has_only_trusted_writers.
    # Any allow ACE granting one of these bits to an untrusted SID can rewrite the
    # entrypoint (or one of its parents) between validation and execution.
    $mask = 0
    $mask = $mask -bor 0x00000002   # FILE_WRITE_DATA / FILE_ADD_FILE
    $mask = $mask -bor 0x00000004   # FILE_APPEND_DATA / FILE_ADD_SUBDIRECTORY
    $mask = $mask -bor 0x00000010   # FILE_WRITE_EA
    $mask = $mask -bor 0x00000040   # FILE_DELETE_CHILD
    $mask = $mask -bor 0x00000100   # FILE_WRITE_ATTRIBUTES
    $mask = $mask -bor 0x00010000   # DELETE
    $mask = $mask -bor 0x00040000   # WRITE_DAC
    $mask = $mask -bor 0x00080000   # WRITE_OWNER
    $mask = $mask -bor 0x02000000   # MAXIMUM_ALLOWED (fail closed in an allow ACE)
    $mask = $mask -bor 0x10000000   # GENERIC_ALL
    $mask = $mask -bor 0x40000000   # GENERIC_WRITE
    return [int]$mask
}

function Get-CadExtensionCacheTrustedWriterSid {
    # Mirrors the adapter's trusted_writers set. The current user SID is injectable
    # so fixtures can exercise the predicate without impersonation.
    param([AllowEmptyString()][string] $CurrentUserSid = '')

    if ([string]::IsNullOrWhiteSpace($CurrentUserSid)) {
        $CurrentUserSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    }
    return @(
        $CurrentUserSid.ToUpperInvariant()
        'S-1-3-4'        # OWNER RIGHTS resolves to the already-validated object owner
        'S-1-5-18'       # LocalSystem
        'S-1-5-32-544'   # Builtin Administrators
    )
}

function Get-CadExtensionCacheRoot {
    # Mirrors the win32 branch of the adapter's _trusted_extension_cache_roots.
    $localAppData = ([string]$env:LOCALAPPDATA).Trim()
    if ([string]::IsNullOrWhiteSpace($localAppData)) { return '' }
    return (Join-Path (Join-Path (Join-Path $localAppData 'ov') 'data') 'exts')
}

function Get-CadExtensionCachePinnedPackageName {
    # The pinned Windows package name comes from the same tracked manifest the
    # runtime adapter reads, so this module cannot drift into a second pin.
    param([Parameter(Mandatory = $true)][string] $StreamingRepoRoot)

    $manifestPath = Join-Path (Join-Path $StreamingRepoRoot 'config') 'trusted-cad-entrypoints.json'
    if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
        throw "cad_cache_manifest_missing: $manifestPath"
    }
    $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
    if ([string]$manifest.schema_version -cne 'trusted-cad-entrypoints/v1') {
        throw 'cad_cache_manifest_schema_unsupported'
    }
    $packageName = [string]$manifest.packages.'windows-x86_64'.extension_package
    if ([string]::IsNullOrWhiteSpace($packageName)) {
        throw 'cad_cache_manifest_package_missing'
    }
    return $packageName
}

function Get-CadExtensionCacheObjectSecurity {
    # PowerShell 7 exposes the ACL accessors as extension methods; Windows
    # PowerShell 5.1 only has the FileSystemInfo instance methods. Both persist
    # exactly the sections the security object carries as modified.
    param(
        [Parameter(Mandatory = $true)][System.IO.FileSystemInfo] $Item,
        [Parameter(Mandatory = $true)][System.Security.AccessControl.AccessControlSections] $Sections
    )

    $extensions = $null
    try { $extensions = [System.IO.FileSystemAclExtensions] } catch { $extensions = $null }
    if ($null -ne $extensions) {
        if ($Item -is [System.IO.DirectoryInfo]) {
            return [System.IO.FileSystemAclExtensions]::GetAccessControl([System.IO.DirectoryInfo]$Item, $Sections)
        }
        return [System.IO.FileSystemAclExtensions]::GetAccessControl([System.IO.FileInfo]$Item, $Sections)
    }
    return $Item.GetAccessControl($Sections)
}

function Set-CadExtensionCacheObjectSecurity {
    # DACL-only write: the security object was read with AccessControlSections::Access,
    # so no SACL is persisted and SeSecurityPrivilege (elevation) is never needed.
    param(
        [Parameter(Mandatory = $true)][System.IO.FileSystemInfo] $Item,
        [Parameter(Mandatory = $true)][System.Security.AccessControl.FileSystemSecurity] $Security
    )

    $extensions = $null
    try { $extensions = [System.IO.FileSystemAclExtensions] } catch { $extensions = $null }
    if ($null -ne $extensions) {
        if ($Item -is [System.IO.DirectoryInfo]) {
            [System.IO.FileSystemAclExtensions]::SetAccessControl(
                [System.IO.DirectoryInfo]$Item, [System.Security.AccessControl.DirectorySecurity]$Security)
            return
        }
        [System.IO.FileSystemAclExtensions]::SetAccessControl(
            [System.IO.FileInfo]$Item, [System.Security.AccessControl.FileSecurity]$Security)
        return
    }
    $Item.SetAccessControl($Security)
}

function Get-CadExtensionCacheAllowRule {
    # Trap 3: @($security.GetAccessRules(...)) wraps the AuthorizationRuleCollection
    # as ONE element and silently reports zero rules. Index the collection instead.
    param([Parameter(Mandatory = $true)][System.Security.AccessControl.FileSystemSecurity] $Security)

    $collection = $Security.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier])
    $rules = [System.Collections.Generic.List[System.Security.AccessControl.FileSystemAccessRule]]::new()
    for ($index = 0; $index -lt $collection.Count; $index++) {
        $rule = [System.Security.AccessControl.FileSystemAccessRule]$collection[$index]
        if ($rule.AccessControlType -ne [System.Security.AccessControl.AccessControlType]::Allow) { continue }
        $rules.Add($rule)
    }
    return $rules
}

function Get-CadExtensionCacheUntrustedRule {
    # An allow ACE offends when it grants a write bit to a SID outside the trusted
    # set. INHERIT_ONLY_ACE (PropagationFlags::InheritOnly) grants nothing on this
    # object, so the adapter exempts it and so does this module.
    param(
        [Parameter(Mandatory = $true)][System.Security.AccessControl.FileSystemSecurity] $Security,
        [Parameter(Mandatory = $true)][AllowEmptyCollection()][string[]] $TrustedWriterSid
    )

    $writeMask = Get-CadExtensionCacheWriteMask
    $offending = [System.Collections.Generic.List[System.Security.AccessControl.FileSystemAccessRule]]::new()
    foreach ($rule in @(Get-CadExtensionCacheAllowRule -Security $Security)) {
        if (($rule.PropagationFlags -band [System.Security.AccessControl.PropagationFlags]::InheritOnly) -ne 0) { continue }
        if (([int]$rule.FileSystemRights -band $writeMask) -eq 0) { continue }
        if ($TrustedWriterSid -ccontains ([string]$rule.IdentityReference.Value).ToUpperInvariant()) { continue }
        $offending.Add($rule)
    }
    return $offending
}

function Test-CadExtensionCacheComponent {
    # One path component of the validated chain, evaluated with the adapter's
    # predicate: trusted owner AND no untrusted writer.
    param(
        [Parameter(Mandatory = $true)][string] $Path,
        [Parameter(Mandatory = $true)][AllowEmptyCollection()][string[]] $TrustedWriterSid
    )

    $result = [pscustomobject]@{
        Path             = $Path
        OwnerSid         = ''
        OwnerTrusted     = $false
        UntrustedWriters = @()
        Trusted          = $false
        Error            = ''
    }
    try {
        $item = Get-Item -LiteralPath $Path -Force -ErrorAction Stop
        $sections = [System.Security.AccessControl.AccessControlSections]::Access -bor
            [System.Security.AccessControl.AccessControlSections]::Owner
        $security = Get-CadExtensionCacheObjectSecurity -Item $item -Sections $sections
        $ownerSid = [string]$security.GetOwner([System.Security.Principal.SecurityIdentifier]).Value
        $result.OwnerSid = $ownerSid
        $result.OwnerTrusted = $TrustedWriterSid -ccontains $ownerSid.ToUpperInvariant()
        $untrusted = @(Get-CadExtensionCacheUntrustedRule -Security $security -TrustedWriterSid $TrustedWriterSid)
        $sids = [System.Collections.Generic.List[string]]::new()
        foreach ($rule in $untrusted) {
            $sid = [string]$rule.IdentityReference.Value
            if (-not $sids.Contains($sid)) { $sids.Add($sid) }
        }
        $result.UntrustedWriters = @($sids)
        $result.Trusted = $result.OwnerTrusted -and $sids.Count -eq 0
    }
    catch {
        $result.Error = $_.Exception.Message
        $result.Trusted = $false
    }
    return $result
}

function Invoke-CadExtensionCacheComponentConvergence {
    # Break inheritance (copying the inherited ACEs so the trusted ones survive)
    # and drop every untrusted writer from the resulting explicit DACL.
    [CmdletBinding(SupportsShouldProcess = $true)]
    param(
        [Parameter(Mandatory = $true)][string] $Path,
        [Parameter(Mandatory = $true)][AllowEmptyCollection()][string[]] $TrustedWriterSid
    )

    $accessOnly = [System.Security.AccessControl.AccessControlSections]::Access
    $item = Get-Item -LiteralPath $Path -Force -ErrorAction Stop
    $security = Get-CadExtensionCacheObjectSecurity -Item $item -Sections $accessOnly
    $pending = @(@(Get-CadExtensionCacheUntrustedRule -Security $security -TrustedWriterSid $TrustedWriterSid) |
        ForEach-Object { [string]$_.IdentityReference.Value } | Select-Object -Unique)
    if (-not $PSCmdlet.ShouldProcess($Path, 'converge CAD extension cache DACL')) {
        return [pscustomobject]@{ Path = $Path; Applied = $false; RemovedSids = @($pending) }
    }

    # Phase 1: break inheritance while PRESERVING the inherited ACEs as explicit
    # copies. SetAccessRuleProtection($true, $false) would leave a component whose
    # ACEs were all inherited with an EMPTY DACL - deny-all, including the owner.
    #
    # The copies only become explicit once this descriptor is persisted: every
    # .NET removal API (RemoveAccessRuleSpecific / RemoveAccessRule /
    # PurgeAccessRules) silently skips an ACE still flagged inherited, so removing
    # before this write reports success and changes nothing (measured on the
    # reporting host: 19 offending ACEs in, 19 out, no error).
    if (-not $security.AreAccessRulesProtected) {
        $security.SetAccessRuleProtection($true, $true)
        Set-CadExtensionCacheObjectSecurity -Item $item -Security $security
        $item = Get-Item -LiteralPath $Path -Force -ErrorAction Stop
        $security = Get-CadExtensionCacheObjectSecurity -Item $item -Sections $accessOnly
    }

    # Phase 2: the offending ACEs are explicit now and can actually be removed.
    $removed = [System.Collections.Generic.List[string]]::new()
    foreach ($rule in @(Get-CadExtensionCacheUntrustedRule -Security $security -TrustedWriterSid $TrustedWriterSid)) {
        # Trap 1: the rule object goes straight back into the ACL model, so an
        # unresolvable orphan SID never goes through name translation - which is
        # exactly where `icacls /remove:g *<SID>` reports success and does nothing.
        $security.RemoveAccessRuleSpecific($rule)
        $sid = [string]$rule.IdentityReference.Value
        if (-not $removed.Contains($sid)) { $removed.Add($sid) }
    }
    # Trap 2: DACL-only persist, no SACL, no elevation.
    Set-CadExtensionCacheObjectSecurity -Item $item -Security $security
    return [pscustomobject]@{ Path = $Path; Applied = $true; RemovedSids = @($removed) }
}

function Get-CadExtensionCacheChainComponent {
    # Root plus every component down to the leaf - the exact list the adapter's
    # _path_components_are_owner_private walks.
    param(
        [Parameter(Mandatory = $true)][string] $CacheRoot,
        [Parameter(Mandatory = $true)][string] $EntryPoint
    )

    $separator = [System.IO.Path]::DirectorySeparatorChar
    $root = ([string](Resolve-Path -LiteralPath $CacheRoot).Path).TrimEnd($separator)
    $leaf = [string](Resolve-Path -LiteralPath $EntryPoint).Path
    if (-not $leaf.StartsWith(($root + $separator), [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "cad_cache_entrypoint_outside_root: $leaf"
    }
    $relative = $leaf.Substring($root.Length).Trim($separator)
    $components = [System.Collections.Generic.List[string]]::new()
    $components.Add($root)
    $current = $root
    foreach ($part in $relative.Split($separator)) {
        if ([string]::IsNullOrWhiteSpace($part)) { continue }
        $current = Join-Path $current $part
        $components.Add($current)
    }
    return @($components)
}

function Find-CadExtensionCacheEntryPoint {
    # The Kit cache stores the package under a layout revision directory
    # (.../exts/v2/<package>/...); older layouts put the package directly under
    # the cache root. Both shapes are matched, nothing else is walked.
    param(
        [Parameter(Mandatory = $true)][string] $CacheRoot,
        [Parameter(Mandatory = $true)][string] $PackageName
    )

    $suffix = ($script:CadExtensionCacheEntryPointSuffix -join [System.IO.Path]::DirectorySeparatorChar)
    # Only the layout-revision segment is a wildcard: everything else is literal,
    # so a bracket in the profile path cannot turn into a character class.
    $literalRoot = [System.Management.Automation.WildcardPattern]::Escape($CacheRoot)
    $literalPackage = [System.Management.Automation.WildcardPattern]::Escape($PackageName)
    $literalSuffix = [System.Management.Automation.WildcardPattern]::Escape($suffix)
    $patterns = @(
        (Join-Path (Join-Path $literalRoot $literalPackage) $literalSuffix)
        (Join-Path (Join-Path (Join-Path $literalRoot '*') $literalPackage) $literalSuffix)
    )
    $matched = [System.Collections.Generic.List[string]]::new()
    foreach ($pattern in $patterns) {
        foreach ($item in @(Get-Item -Path $pattern -Force -ErrorAction SilentlyContinue)) {
            if ($item -isnot [System.IO.FileInfo]) { continue }
            $full = [string]$item.FullName
            if (-not $matched.Contains($full)) { $matched.Add($full) }
        }
    }
    return @($matched)
}

function Add-CadExtensionCacheStatusJson {
    # Single-line, schema-stamped status for the deploy log. Local absolute paths
    # and SIDs are deliberate: the log is the actionable surface this issue asks
    # for, and scripts/.run is not a published artifact.
    param([Parameter(Mandatory = $true)][pscustomobject] $Result)

    $payload = [ordered]@{
        schema_version     = $script:CadExtensionCacheStatusSchema
        status             = [string]$Result.Status
        reason_kind        = [string]$Result.ReasonKind
        entrypoint         = [string]$Result.EntryPoint
        components         = @($Result.Components).Count
        converged          = @($Result.Converged)
        failing_components = @($Result.Failures)
    }
    $Result.StatusJson = ($payload | ConvertTo-Json -Compress -Depth 6)
    return $Result
}

function Invoke-CadExtensionCacheWindowsHardening {
    <#
    .SYNOPSIS
    Converge and validate the Windows CAD extension cache chain (issue #625).

    .DESCRIPTION
    Validates first and only writes when a component actually fails the adapter's
    owner-private predicate, so an already-converged host is a read-only no-op.
    Convergence starts at the topmost failing component (the cache root owns the
    inheritable ACEs every level below re-inherits) and then repairs any component
    that still fails on its own explicit DACL. The chain is revalidated afterwards;
    a chain that still fails is reported as a deploy-time failure naming the
    component and the offending SIDs, instead of surfacing later as an
    unactionable runtime converter_unavailable.

    .PARAMETER ValidateOnly
    Read-only: report the current state and never touch an ACL.
    #>
    [CmdletBinding(SupportsShouldProcess = $true)]
    param(
        [Parameter(Mandatory = $true)][string] $StreamingRepoRoot,
        [AllowEmptyString()][string] $ConfiguredHoopsMain = '',
        [AllowEmptyString()][string] $CacheRoot = '',
        [AllowEmptyString()][string] $CurrentUserSid = '',
        [switch] $ValidateOnly
    )

    $result = [pscustomobject]@{
        Status     = 'failed'
        ReasonKind = 'unexpected_error'
        Diagnostic = ''
        EntryPoint = ''
        Components = @()
        Converged  = @()
        Failures   = @()
        StatusJson = ''
    }

    try {
        if (-not [string]::IsNullOrWhiteSpace($ConfiguredHoopsMain)) {
            # An explicit override points the runtime somewhere else entirely, so
            # converging the pinned cache chain would validate the wrong path.
            $result.Status = 'skipped'
            $result.ReasonKind = 'explicit_hoops_main_override'
            $result.Diagnostic = 'STREAMING_CONVERSION_HOOPS_MAIN is set; the pinned cache chain is not the runtime entrypoint.'
            return (Add-CadExtensionCacheStatusJson -Result $result)
        }

        $resolvedRoot = if ([string]::IsNullOrWhiteSpace($CacheRoot)) { Get-CadExtensionCacheRoot } else { $CacheRoot }
        if ([string]::IsNullOrWhiteSpace($resolvedRoot)) {
            $result.Status = 'failed'
            $result.ReasonKind = 'local_app_data_unavailable'
            $result.Diagnostic = 'LOCALAPPDATA is not set; the trusted extension cache root cannot be resolved.'
            return (Add-CadExtensionCacheStatusJson -Result $result)
        }
        if (-not (Test-Path -LiteralPath $resolvedRoot -PathType Container)) {
            # Nothing has been cached yet: there is no ACL to converge and no
            # entrypoint to validate. The runtime keeps its own not-found failure,
            # which this change does not make worse.
            $result.Status = 'skipped'
            $result.ReasonKind = 'cache_root_absent'
            $result.Diagnostic = "CAD extension cache root does not exist yet: $resolvedRoot"
            return (Add-CadExtensionCacheStatusJson -Result $result)
        }

        $manifestPath = Join-Path (Join-Path $StreamingRepoRoot 'config') 'trusted-cad-entrypoints.json'
        if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
            # A deployment root without the streaming repo's pinned manifest cannot
            # run host-native conversion at all, and the runtime adapter fails
            # closed on the same missing manifest. There is no pinned chain to
            # converge here, so this is a skip rather than a new deploy failure
            # mode for pruned or synthetic deployment roots.
            $result.Status = 'skipped'
            $result.ReasonKind = 'cad_manifest_absent'
            $result.Diagnostic = "Trusted CAD entrypoint manifest is not present in this deployment root: $manifestPath"
            return (Add-CadExtensionCacheStatusJson -Result $result)
        }
        try {
            $packageName = Get-CadExtensionCachePinnedPackageName -StreamingRepoRoot $StreamingRepoRoot
        }
        catch {
            # Present but unreadable/unsupported is corruption, not absence.
            $result.Status = 'failed'
            $result.ReasonKind = 'cad_manifest_invalid'
            $result.Diagnostic = [string]$_.Exception.Message
            return (Add-CadExtensionCacheStatusJson -Result $result)
        }
        $entryPoints = @(Find-CadExtensionCacheEntryPoint -CacheRoot $resolvedRoot -PackageName $packageName)
        if ($entryPoints.Count -eq 0) {
            $result.Status = 'skipped'
            $result.ReasonKind = 'entrypoint_not_found'
            $result.Diagnostic = "Pinned CAD extension package is not cached yet under ${resolvedRoot}: $packageName"
            return (Add-CadExtensionCacheStatusJson -Result $result)
        }
        if ($entryPoints.Count -gt 1) {
            # The runtime refuses an ambiguous selection, so deploy must too.
            $result.Status = 'failed'
            $result.ReasonKind = 'ambiguous_entrypoint'
            $result.Diagnostic = "Multiple cached CAD entrypoints matched the pinned package: $($entryPoints -join '; ')"
            return (Add-CadExtensionCacheStatusJson -Result $result)
        }

        $entryPoint = $entryPoints[0]
        $result.EntryPoint = $entryPoint
        $trusted = @(Get-CadExtensionCacheTrustedWriterSid -CurrentUserSid $CurrentUserSid)
        $components = @(Get-CadExtensionCacheChainComponent -CacheRoot $resolvedRoot -EntryPoint $entryPoint)
        $result.Components = $components

        $states = @($components | ForEach-Object { Test-CadExtensionCacheComponent -Path $_ -TrustedWriterSid $trusted })
        $failing = @($states | Where-Object { -not $_.Trusted })
        if ($failing.Count -gt 0 -and -not $ValidateOnly) {
            $converged = [System.Collections.Generic.List[string]]::new()
            # Topmost failing component first: the cache root owns the inheritable
            # ACEs every level below re-inherits, so one write usually converges
            # the whole chain and the deeper components re-validate clean.
            foreach ($state in $failing) {
                if ($state.Error) { continue }
                if (-not $state.OwnerTrusted) { continue }
                $current = Test-CadExtensionCacheComponent -Path $state.Path -TrustedWriterSid $trusted
                if ($current.Trusted) { continue }
                $applied = Invoke-CadExtensionCacheComponentConvergence -Path $state.Path -TrustedWriterSid $trusted
                if ($applied.Applied) { [void]$converged.Add([string]$applied.Path) }
            }
            $result.Converged = @($converged)
            $states = @($components | ForEach-Object { Test-CadExtensionCacheComponent -Path $_ -TrustedWriterSid $trusted })
            $failing = @($states | Where-Object { -not $_.Trusted })
        }

        if ($failing.Count -eq 0) {
            $result.Status = 'passed'
            $result.ReasonKind = ''
            $result.Diagnostic = "$($components.Count) chain components are owner-private."
            return (Add-CadExtensionCacheStatusJson -Result $result)
        }

        $result.Failures = @($failing | ForEach-Object {
            [pscustomobject]@{
                path              = [string]$_.Path
                owner_sid         = [string]$_.OwnerSid
                owner_trusted     = [bool]$_.OwnerTrusted
                untrusted_writers = @($_.UntrustedWriters)
                error             = [string]$_.Error
            }
        })
        $result.Status = 'failed'
        $result.ReasonKind = if (@($failing | Where-Object { -not $_.OwnerTrusted }).Count -gt 0) {
            'untrusted_owner'
        } else {
            'untrusted_writers_remain'
        }
        $details = @($failing | ForEach-Object {
            $writers = if (@($_.UntrustedWriters).Count -gt 0) { @($_.UntrustedWriters) -join ',' } else { "owner=$($_.OwnerSid)" }
            "$($_.Path) [$writers]"
        })
        $result.Diagnostic = "owner-private validation still fails for: $($details -join ' | ')"
        return (Add-CadExtensionCacheStatusJson -Result $result)
    }
    catch {
        $result.Status = 'failed'
        $result.ReasonKind = 'unexpected_error'
        $result.Diagnostic = [string]$_.Exception.Message
        return (Add-CadExtensionCacheStatusJson -Result $result)
    }
}
