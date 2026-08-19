# scripts\tests\test-cad-extension-cache-acl.ps1
# Fixture regressions for the Windows CAD extension cache ACL convergence (#625).
#
# Every ACL write in this suite happens inside a TEMP sandbox. The real
# %LOCALAPPDATA%\ov\data\exts chain is NEVER modified here; the only supported
# way to touch it is the module's own validate-only path.
. (Join-Path $PSScriptRoot 'test-helpers.ps1')

$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$modulePath = Join-Path $repoRoot 'scripts\lib\cad-extension-cache-acl.ps1'
. $modulePath

$adapterPath = Join-Path $repoRoot ('bim-streaming-server\source\extensions\ezplus.bim_review_stream.messaging\' +
    'ezplus\bim_review_stream\messaging\ifc2usdc_powershell_adapter.py')
$adapterSource = Get-Content -Raw -LiteralPath $adapterPath

# ---------------------------------------------------------------------------
# Cross-file drift guards: this module mirrors the runtime adapter's Windows
# predicate. If the adapter changes its trusted set or write mask, deploy would
# otherwise keep converging to a boundary the runtime no longer accepts.
# ---------------------------------------------------------------------------

# Test 1: the trusted writer SIDs are exactly the adapter's, plus the current user.
$trustedBlock = [regex]::Match($adapterSource, 'trusted_writers = \{(?<body>[\s\S]*?)\n\s*\}')
Assert-True $trustedBlock.Success 'adapter must still declare a trusted_writers set'
$adapterSids = @([regex]::Matches($trustedBlock.Groups['body'].Value, '"(?<sid>S-1-[0-9-]+)"') |
    ForEach-Object { $_.Groups['sid'].Value.ToUpperInvariant() } | Sort-Object)
Assert-Equal 'S-1-3-4;S-1-5-18;S-1-5-32-544' ($adapterSids -join ';') 'adapter well-known trusted SIDs'
$libSids = @(Get-CadExtensionCacheTrustedWriterSid -CurrentUserSid 'S-1-5-21-9-9-9-1001')
Assert-Equal 'S-1-5-21-9-9-9-1001;S-1-3-4;S-1-5-18;S-1-5-32-544' ($libSids -join ';') `
    'module trusted set = injected current user + the adapter well-known SIDs'
foreach ($sid in $adapterSids) {
    Assert-True ($libSids -ccontains $sid) "module must trust the adapter SID $sid"
}
Write-TestPass 'trusted writer set mirrors the runtime adapter'

# Test 2: the write mask is bit-for-bit the adapter's.
$maskBlock = [regex]::Match($adapterSource, 'write_mask = \((?<body>[\s\S]*?)\n\s*\)')
Assert-True $maskBlock.Success 'adapter must still declare a write_mask'
$expectedMask = 0
foreach ($hex in [regex]::Matches($maskBlock.Groups['body'].Value, '0x[0-9A-Fa-f]{8}')) {
    $expectedMask = $expectedMask -bor [int][Convert]::ToUInt32($hex.Value, 16)
}
Assert-True ($expectedMask -ne 0) 'adapter write_mask must parse to a non-zero mask'
Assert-Equal $expectedMask (Get-CadExtensionCacheWriteMask) 'module write mask must equal the adapter write mask'
Write-TestPass 'write mask mirrors the runtime adapter'

# Test 3: the trusted cache root mirrors the adapter's win32 branch.
Assert-True ($adapterSource -match '"ov"\s*/\s*"data"\s*/\s*"exts"') 'adapter must still pin ov/data/exts'
Assert-True ($adapterSource -match 'LOCALAPPDATA') 'adapter must still read LOCALAPPDATA on win32'
if (-not [string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) {
    $expectedRoot = Join-Path (Join-Path (Join-Path $env:LOCALAPPDATA 'ov') 'data') 'exts'
    Assert-Equal $expectedRoot (Get-CadExtensionCacheRoot) 'module cache root must equal LOCALAPPDATA\ov\data\exts'
}
Write-TestPass 'trusted cache root mirrors the runtime adapter'

# Test 4: the pinned package name comes from the tracked manifest, not a copy.
$streamingRoot = Join-Path $repoRoot 'bim-streaming-server'
$manifest = Get-Content -Raw -LiteralPath (Join-Path $streamingRoot 'config\trusted-cad-entrypoints.json') | ConvertFrom-Json
Assert-Equal ([string]$manifest.packages.'windows-x86_64'.extension_package) `
    (Get-CadExtensionCachePinnedPackageName -StreamingRepoRoot $streamingRoot) `
    'pinned package name must be read from the tracked manifest'
Write-TestPass 'pinned package name comes from the tracked manifest'

if (-not $IsWindows) {
    Write-Host '[SKIP] ACL fixture tests require Windows; contract mirrors above still ran.' -ForegroundColor Yellow
    Write-Host 'ALL TESTS PASSED (non-Windows subset)' -ForegroundColor Green
    exit 0
}

# ---------------------------------------------------------------------------
# ACL fixtures. All writes stay inside a TEMP sandbox.
# ---------------------------------------------------------------------------

# An unresolvable SID: no account maps to it, which is exactly the case where
# `icacls /remove:g` reports success and changes nothing (trap 1).
$orphanSid = 'S-1-5-21-1111111111-2222222222-3333333333-4444'
$pinnedPackage = Get-CadExtensionCachePinnedPackageName -StreamingRepoRoot $streamingRoot
$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
$isElevated = ([System.Security.Principal.WindowsPrincipal]::new($identity)).IsInRole(
    [System.Security.Principal.WindowsBuiltInRole]::Administrator)
Write-Host "[info] process elevated = $isElevated" -ForegroundColor DarkGray

function Add-FixtureAce {
    param(
        [Parameter(Mandatory = $true)][string] $Path,
        [Parameter(Mandatory = $true)][string] $Sid,
        [Parameter(Mandatory = $true)][System.Security.AccessControl.FileSystemRights] $Rights,
        [System.Security.AccessControl.InheritanceFlags] $InheritanceFlags = 'None',
        [System.Security.AccessControl.PropagationFlags] $PropagationFlags = 'None'
    )
    $item = Get-Item -LiteralPath $Path -Force
    $security = Get-CadExtensionCacheObjectSecurity -Item $item `
        -Sections ([System.Security.AccessControl.AccessControlSections]::Access)
    $rule = [System.Security.AccessControl.FileSystemAccessRule]::new(
        [System.Security.Principal.SecurityIdentifier]::new($Sid),
        $Rights, $InheritanceFlags, $PropagationFlags,
        [System.Security.AccessControl.AccessControlType]::Allow)
    $security.AddAccessRule($rule)
    Set-CadExtensionCacheObjectSecurity -Item $item -Security $security
}

function New-FixtureCacheChain {
    # <sandbox>\exts\v2\<pinned package>\omni\...\hoops_main.py - the same shape
    # the Kit extension cache uses.
    param([Parameter(Mandatory = $true)][string] $Sandbox)
    $root = Join-Path $Sandbox 'exts'
    $leafDir = Join-Path (Join-Path (Join-Path $root 'v2') $pinnedPackage) 'omni\services\convert\cad\services\process'
    New-Item -ItemType Directory -Path $leafDir -Force | Out-Null
    Set-Content -LiteralPath (Join-Path $leafDir 'hoops_main.py') -Value '# fixture entrypoint' -Encoding utf8
    return $root
}

function Get-FixtureUntrustedSids {
    param([Parameter(Mandatory = $true)][string] $Path)
    $state = Test-CadExtensionCacheComponent -Path $Path -TrustedWriterSid @(Get-CadExtensionCacheTrustedWriterSid)
    return @($state.UntrustedWriters)
}

# Test 5: trap 3 - the rule collection is enumerated, not wrapped into one element.
$sandbox = New-TestSandbox -Prefix 'cad-acl-enum'
try {
    $target = Join-Path $sandbox 'component'
    New-Item -ItemType Directory -Path $target -Force | Out-Null
    Add-FixtureAce -Path $target -Sid $orphanSid -Rights ([System.Security.AccessControl.FileSystemRights]::Modify)
    $item = Get-Item -LiteralPath $target -Force
    $security = Get-CadExtensionCacheObjectSecurity -Item $item `
        -Sections ([System.Security.AccessControl.AccessControlSections]::Access)
    $rules = @(Get-CadExtensionCacheAllowRule -Security $security)
    Assert-True ($rules.Count -gt 0) 'allow rules must enumerate (a wrapped collection silently reports 0)'
    $identities = @($rules | ForEach-Object { [string]$_.IdentityReference.Value })
    Assert-True ($identities -ccontains $orphanSid) 'the injected orphan SID must appear in the enumerated rules'
    Write-TestPass "rule enumeration counts correctly ($($rules.Count) allow rules)"
}
finally { Remove-TestSandbox -Path $sandbox }

# Test 6: the untrusted-writer predicate matches the adapter's semantics.
$sandbox = New-TestSandbox -Prefix 'cad-acl-predicate'
try {
    $writeTarget = Join-Path $sandbox 'writer'
    $readTarget = Join-Path $sandbox 'reader'
    $inheritOnlyTarget = Join-Path $sandbox 'inherit-only'
    foreach ($path in @($writeTarget, $readTarget, $inheritOnlyTarget)) {
        New-Item -ItemType Directory -Path $path -Force | Out-Null
    }
    Add-FixtureAce -Path $writeTarget -Sid $orphanSid -Rights ([System.Security.AccessControl.FileSystemRights]::Modify)
    Add-FixtureAce -Path $readTarget -Sid $orphanSid -Rights ([System.Security.AccessControl.FileSystemRights]::ReadAndExecute)
    Add-FixtureAce -Path $inheritOnlyTarget -Sid $orphanSid `
        -Rights ([System.Security.AccessControl.FileSystemRights]::Modify) `
        -InheritanceFlags 'ContainerInherit, ObjectInherit' -PropagationFlags 'InheritOnly'

    Assert-True ((Get-FixtureUntrustedSids -Path $writeTarget) -ccontains $orphanSid) `
        'a write-granting orphan ACE must be reported'
    Assert-True (-not ((Get-FixtureUntrustedSids -Path $readTarget) -ccontains $orphanSid)) `
        'a read-only orphan ACE grants no write bit and must not be reported'
    Assert-True (-not ((Get-FixtureUntrustedSids -Path $inheritOnlyTarget) -ccontains $orphanSid)) `
        'an INHERIT_ONLY orphan ACE grants nothing on this object and must not be reported'
    $currentUserSid = [string]$identity.User.Value
    Add-FixtureAce -Path $readTarget -Sid $currentUserSid -Rights ([System.Security.AccessControl.FileSystemRights]::FullControl)
    Assert-True (-not ((Get-FixtureUntrustedSids -Path $readTarget) -ccontains $currentUserSid)) `
        'the current user is a trusted writer'
    Write-TestPass 'untrusted-writer predicate matches the adapter semantics'
}
finally { Remove-TestSandbox -Path $sandbox }

# Test 7: convergence strips an orphan write ACE through the object model, with no
# elevation and without destroying the trusted access the owner still needs.
$sandbox = New-TestSandbox -Prefix 'cad-acl-converge'
try {
    $target = Join-Path $sandbox 'component'
    New-Item -ItemType Directory -Path $target -Force | Out-Null
    Add-FixtureAce -Path $target -Sid $orphanSid -Rights ([System.Security.AccessControl.FileSystemRights]::Modify)
    Assert-True ((Get-FixtureUntrustedSids -Path $target) -ccontains $orphanSid) 'fixture must start dirty'

    $applied = Invoke-CadExtensionCacheComponentConvergence -Path $target `
        -TrustedWriterSid @(Get-CadExtensionCacheTrustedWriterSid)
    Assert-True $applied.Applied 'convergence must report an applied write'
    Assert-True (@($applied.RemovedSids) -ccontains $orphanSid) 'convergence must report the removed orphan SID'
    Assert-Equal 0 (@(Get-FixtureUntrustedSids -Path $target)).Count 'no untrusted writer may remain'

    $item = Get-Item -LiteralPath $target -Force
    $security = Get-CadExtensionCacheObjectSecurity -Item $item `
        -Sections ([System.Security.AccessControl.AccessControlSections]::Access)
    Assert-True ($security.AreAccessRulesProtected) 'convergence must break inheritance on the component'
    Set-Content -LiteralPath (Join-Path $target 'still-writable.txt') -Value 'ok' -Encoding utf8
    Assert-True (Test-Path -LiteralPath (Join-Path $target 'still-writable.txt')) `
        'the converged DACL must keep the owner able to write (a non-copying protection would deny everyone)'
    Write-TestPass "orphan SID removed through the ACL object model (elevated=$isElevated)"
}
finally { Remove-TestSandbox -Path $sandbox }

# Test 8: -WhatIf and -ValidateOnly never write.
$sandbox = New-TestSandbox -Prefix 'cad-acl-readonly'
try {
    $root = New-FixtureCacheChain -Sandbox $sandbox
    Add-FixtureAce -Path $root -Sid $orphanSid `
        -Rights ([System.Security.AccessControl.FileSystemRights]::Modify) `
        -InheritanceFlags 'ContainerInherit, ObjectInherit'
    Assert-True ((Get-FixtureUntrustedSids -Path $root) -ccontains $orphanSid) 'fixture root must start dirty'

    $whatIf = Invoke-CadExtensionCacheWindowsHardening -StreamingRepoRoot $streamingRoot -CacheRoot $root -WhatIf
    Assert-Equal 'failed' $whatIf.Status '-WhatIf must report the unconverged chain as failing'
    Assert-True ((Get-FixtureUntrustedSids -Path $root) -ccontains $orphanSid) '-WhatIf must not modify any ACL'

    $validateOnly = Invoke-CadExtensionCacheWindowsHardening -StreamingRepoRoot $streamingRoot -CacheRoot $root -ValidateOnly
    Assert-Equal 'failed' $validateOnly.Status '-ValidateOnly must report the unconverged chain as failing'
    Assert-Equal 'untrusted_writers_remain' $validateOnly.ReasonKind '-ValidateOnly must name the failure kind'
    Assert-True ((Get-FixtureUntrustedSids -Path $root) -ccontains $orphanSid) '-ValidateOnly must not modify any ACL'
    Assert-True ($validateOnly.Diagnostic -match [regex]::Escape($orphanSid)) `
        'the diagnostic must name the offending SID'
    Assert-True ($validateOnly.Diagnostic -match [regex]::Escape($root)) `
        'the diagnostic must name the failing chain component'
    Write-TestPass '-WhatIf and -ValidateOnly are read-only and name the failing level plus SIDs'
}
finally { Remove-TestSandbox -Path $sandbox }

# Test 9: end-to-end convergence of a chain that inherits an untrusted writer,
# then idempotence - a converged chain performs no further writes.
$sandbox = New-TestSandbox -Prefix 'cad-acl-chain'
try {
    $root = New-FixtureCacheChain -Sandbox $sandbox
    Add-FixtureAce -Path $root -Sid $orphanSid `
        -Rights ([System.Security.AccessControl.FileSystemRights]::Modify) `
        -InheritanceFlags 'ContainerInherit, ObjectInherit'

    $result = Invoke-CadExtensionCacheWindowsHardening -StreamingRepoRoot $streamingRoot -CacheRoot $root
    Assert-Equal 'passed' $result.Status "chain convergence must pass (diagnostic: $($result.Diagnostic))"
    Assert-Equal 10 (@($result.Components)).Count 'the validated chain is the cache root plus 9 components'
    Assert-True (@($result.Converged) -ccontains ((Resolve-Path -LiteralPath $root).Path.TrimEnd('\'))) `
        'the cache root is the component that owns the inherited ACEs'
    foreach ($component in @($result.Components)) {
        Assert-Equal 0 (@(Get-FixtureUntrustedSids -Path $component)).Count `
            "converged chain component must be owner-private: $component"
    }

    $again = Invoke-CadExtensionCacheWindowsHardening -StreamingRepoRoot $streamingRoot -CacheRoot $root
    Assert-Equal 'passed' $again.Status 'a converged chain must still pass'
    Assert-Equal 0 (@($again.Converged)).Count 'a converged chain must perform no further ACL writes'
    Write-TestPass 'chain convergence removes an inherited untrusted writer and is idempotent'
}
finally { Remove-TestSandbox -Path $sandbox }

# Test 10: a deep component carrying its own protected, explicit untrusted ACE is
# repaired individually - root-level propagation cannot reach a protected child.
$sandbox = New-TestSandbox -Prefix 'cad-acl-deep'
try {
    $root = New-FixtureCacheChain -Sandbox $sandbox
    $converged = Invoke-CadExtensionCacheWindowsHardening -StreamingRepoRoot $streamingRoot -CacheRoot $root
    Assert-Equal 'passed' $converged.Status 'baseline chain must converge first'
    $deep = @($converged.Components)[-2]
    Add-FixtureAce -Path $deep -Sid $orphanSid -Rights ([System.Security.AccessControl.FileSystemRights]::Modify)
    Assert-True ((Get-FixtureUntrustedSids -Path $deep) -ccontains $orphanSid) 'deep component must start dirty'

    $repaired = Invoke-CadExtensionCacheWindowsHardening -StreamingRepoRoot $streamingRoot -CacheRoot $root
    Assert-Equal 'passed' $repaired.Status "deep repair must pass (diagnostic: $($repaired.Diagnostic))"
    Assert-True (@($repaired.Converged) -ccontains $deep) 'the deep component itself must be converged'
    Assert-Equal 0 (@(Get-FixtureUntrustedSids -Path $deep)).Count 'deep component must end owner-private'
    Write-TestPass 'a deep component with its own untrusted ACE is repaired individually'
}
finally { Remove-TestSandbox -Path $sandbox }

# Test 11: skip and failure reasons the deploy phase branches on.
$sandbox = New-TestSandbox -Prefix 'cad-acl-reasons'
try {
    $absent = Join-Path $sandbox 'never-created'
    $absentResult = Invoke-CadExtensionCacheWindowsHardening -StreamingRepoRoot $streamingRoot -CacheRoot $absent
    Assert-Equal 'skipped' $absentResult.Status 'an absent cache root is a skip, not a failure'
    Assert-Equal 'cache_root_absent' $absentResult.ReasonKind 'absent cache root reason kind'

    $emptyRoot = Join-Path $sandbox 'exts-empty'
    New-Item -ItemType Directory -Path $emptyRoot -Force | Out-Null
    $emptyResult = Invoke-CadExtensionCacheWindowsHardening -StreamingRepoRoot $streamingRoot -CacheRoot $emptyRoot
    Assert-Equal 'skipped' $emptyResult.Status 'an uncached package is a skip, not a failure'
    Assert-Equal 'entrypoint_not_found' $emptyResult.ReasonKind 'uncached package reason kind'

    $root = New-FixtureCacheChain -Sandbox $sandbox
    $overrideResult = Invoke-CadExtensionCacheWindowsHardening -StreamingRepoRoot $streamingRoot -CacheRoot $root `
        -ConfiguredHoopsMain 'C:\somewhere\hoops_main.py'
    Assert-Equal 'skipped' $overrideResult.Status 'an explicit override owns the entrypoint'
    Assert-Equal 'explicit_hoops_main_override' $overrideResult.ReasonKind 'explicit override reason kind'

    # A deployment root pruned of (or never containing) the streaming repo cannot
    # run conversion at all; a new hard deploy failure there would be a
    # regression, and the runtime keeps its own manifest gate.
    $prunedRepoRoot = Join-Path $sandbox 'pruned-streaming-repo'
    New-Item -ItemType Directory -Path $prunedRepoRoot -Force | Out-Null
    $prunedResult = Invoke-CadExtensionCacheWindowsHardening -StreamingRepoRoot $prunedRepoRoot -CacheRoot $root
    Assert-Equal 'skipped' $prunedResult.Status 'an absent pinned manifest is a skip, not a failure'
    Assert-Equal 'cad_manifest_absent' $prunedResult.ReasonKind 'absent manifest reason kind'

    # Present but corrupt is a different story: that is a real misconfiguration.
    $corruptRepoRoot = Join-Path $sandbox 'corrupt-streaming-repo'
    New-Item -ItemType Directory -Path (Join-Path $corruptRepoRoot 'config') -Force | Out-Null
    Set-Content -LiteralPath (Join-Path $corruptRepoRoot 'config\trusted-cad-entrypoints.json') `
        -Value '{"schema_version":"trusted-cad-entrypoints/v0","packages":{}}' -Encoding utf8
    $corruptResult = Invoke-CadExtensionCacheWindowsHardening -StreamingRepoRoot $corruptRepoRoot -CacheRoot $root
    Assert-Equal 'failed' $corruptResult.Status 'an unsupported manifest schema must fail closed'
    Assert-Equal 'cad_manifest_invalid' $corruptResult.ReasonKind 'invalid manifest reason kind'

    # A second cached copy of the pinned package is exactly what the runtime
    # refuses as an ambiguous selection.
    $secondLeaf = Join-Path (Join-Path (Join-Path $root 'v3') $pinnedPackage) 'omni\services\convert\cad\services\process'
    New-Item -ItemType Directory -Path $secondLeaf -Force | Out-Null
    Set-Content -LiteralPath (Join-Path $secondLeaf 'hoops_main.py') -Value '# second' -Encoding utf8
    $ambiguous = Invoke-CadExtensionCacheWindowsHardening -StreamingRepoRoot $streamingRoot -CacheRoot $root
    Assert-Equal 'failed' $ambiguous.Status 'an ambiguous cached entrypoint must fail closed'
    Assert-Equal 'ambiguous_entrypoint' $ambiguous.ReasonKind 'ambiguous entrypoint reason kind'
    Write-TestPass 'skip and failure reason kinds are distinguishable by the deploy phase'
}
finally { Remove-TestSandbox -Path $sandbox }

# Test 12: the status JSON is one parseable, schema-stamped line for the deploy log.
$sandbox = New-TestSandbox -Prefix 'cad-acl-status'
try {
    $root = New-FixtureCacheChain -Sandbox $sandbox
    $result = Invoke-CadExtensionCacheWindowsHardening -StreamingRepoRoot $streamingRoot -CacheRoot $root
    $lines = @([string]$result.StatusJson -split '\r?\n' | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
    Assert-Equal 1 $lines.Count 'status JSON must be a single log line'
    $status = $result.StatusJson | ConvertFrom-Json
    Assert-Equal 'cad-extension-cache-windows-hardening/v1' ([string]$status.schema_version) 'status schema version'
    Assert-Equal 'passed' ([string]$status.status) 'status field'
    Assert-Equal 10 ([int]$status.components) 'component count is recorded'
    Write-TestPass 'status JSON is a single schema-stamped line'
}
finally { Remove-TestSandbox -Path $sandbox }

Write-Host 'ALL TESTS PASSED' -ForegroundColor Green
