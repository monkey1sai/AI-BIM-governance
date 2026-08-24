[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string] $WorktreeRoot,
    [Parameter(Mandatory = $true)][string] $EvidenceRoot,
    [Parameter(Mandatory = $true)][string] $KitReleaseRoot,
    [Parameter(Mandatory = $true)][ValidatePattern('^[0-9A-Fa-f]{64}$')][string] $ExpectedKitExecutableSha256,
    [Parameter(Mandatory = $true)][ValidatePattern('^[0-9A-Fa-f]{64}$')][string] $ExpectedAppKitSha256,
    [Parameter(Mandatory = $true)][string] $StageUrlA,
    [Parameter(Mandatory = $true)][string] $StageUrlB,
    [Parameter(Mandatory = $true)][string] $StageArtifactPath,
    [Parameter(Mandatory = $true)][string] $StageSourceIfcPath,
    [Parameter(Mandatory = $true)][ValidatePattern('^S-1-5-21-\d+-\d+-\d+-\d+$')][string] $ExpectedOwnerSid,
    [string] $CoordinatorBaseUrl = 'http://127.0.0.1:8005',
    [string] $AuthorityIngressBaseUrl = 'http://127.0.0.1:8006',
    [ValidateSet(49131)][int] $KitSignalPort = 49131,
    [ValidateSet(48031)][int] $KitMediaPort = 48031,
    [switch] $PreflightOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$script:HostNativeAllowedBranchDelta = @(
    'scripts/dev/run-runtime-command-authority-host-native-evidence.ps1',
    'scripts/tests/test-runtime-command-authority-host-native-evidence.ps1'
)
$script:HostNativeExpectedOwnerSid = $ExpectedOwnerSid

function Get-HostNativeTrustedPrincipalSids {
    param(
        [Parameter(Mandatory = $true)] $Acl,
        [Parameter(Mandatory = $true)][string] $Mode
    )

    $currentSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    $ownerSid = try {
        ([Security.Principal.NTAccount]$Acl.Owner).Translate([Security.Principal.SecurityIdentifier]).Value
    }
    catch {
        ([Security.Principal.SecurityIdentifier]$Acl.Owner).Value
    }
    $trustedInstallerSid = 'S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464'
    $trustedSids = @($currentSid, $script:HostNativeExpectedOwnerSid, 'S-1-5-18', 'S-1-5-32-544')
    if ($Mode -ceq 'signed_toolchain') { $trustedSids += $trustedInstallerSid }
    $trustedSids = @($trustedSids | Sort-Object -Unique)
    if ($ownerSid -cnotin $trustedSids) {
        throw "Host-native evidence path has an unapproved owner SID: $ownerSid"
    }
    return [pscustomobject]@{
        current_sid = $currentSid
        owner_sid = $ownerSid
        trusted_sids = $trustedSids
    }
}

function Assert-HostNativePathAcl {
    param(
        [Parameter(Mandatory = $true)][string] $Path,
        [Parameter(Mandatory = $true)][ValidateSet('source_integrity', 'private_evidence', 'signed_toolchain')][string] $Mode
    )

    $acl = Get-Acl -LiteralPath $Path
    $principalEvidence = Get-HostNativeTrustedPrincipalSids -Acl $acl -Mode $Mode
    $trustedSids = @($principalEvidence.trusted_sids)
    $writeMask = [int64](
        [Security.AccessControl.FileSystemRights]::WriteData -bor
        [Security.AccessControl.FileSystemRights]::AppendData -bor
        [Security.AccessControl.FileSystemRights]::WriteAttributes -bor
        [Security.AccessControl.FileSystemRights]::WriteExtendedAttributes -bor
        [Security.AccessControl.FileSystemRights]::Delete -bor
        [Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles -bor
        [Security.AccessControl.FileSystemRights]::ChangePermissions -bor
        [Security.AccessControl.FileSystemRights]::TakeOwnership
    )
    $rules = $acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])
    foreach ($rule in $rules) {
        if ($rule.AccessControlType -ne [Security.AccessControl.AccessControlType]::Allow) { continue }
        $sid = [string]$rule.IdentityReference.Value
        if ($sid -in $trustedSids) { continue }
        $rights = [int64]$rule.FileSystemRights
        if (($Mode -in @('source_integrity', 'signed_toolchain') -and ($rights -band $writeMask) -ne 0) `
            -or ($Mode -ceq 'private_evidence' -and $rights -ne 0)) {
            throw "Host-native $Mode ACL trusts an unapproved principal on ${Path}: $sid"
        }
    }
    return [pscustomobject]@{
        path = [IO.Path]::GetFullPath($Path)
        mode = $Mode
        owner_sid = [string]$principalEvidence.owner_sid
        current_sid = [string]$principalEvidence.current_sid
        access_rules_protected = [bool]$acl.AreAccessRulesProtected
    }
}

function Invoke-HostNativeBootstrapProvenance {
    param(
        [Parameter(Mandatory = $true)][string] $RequestedWorktreeRoot,
        [Parameter(Mandatory = $true)][bool] $IsPreflightOnly
    )

    $root = [IO.Path]::GetFullPath((Resolve-Path -LiteralPath $RequestedWorktreeRoot -ErrorAction Stop).Path).TrimEnd('\')
    $cwd = [IO.Path]::GetFullPath((Get-Location).Path).TrimEnd('\')
    if (-not [string]::Equals($root, $cwd, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Run host-native evidence only from the exact requested worktree root.'
    }
    $expectedRunnerPath = [IO.Path]::GetFullPath((Join-Path $root $script:HostNativeAllowedBranchDelta[0]))
    if (-not [string]::Equals($expectedRunnerPath, [IO.Path]::GetFullPath($PSCommandPath), [StringComparison]::OrdinalIgnoreCase)) {
        throw 'The host-native runner must execute from its exact worktree path.'
    }

    $safeDirectory = "safe.directory=$($root.Replace('\', '/'))"
    $null = & git -c $safeDirectory -C $root fetch origin --prune 2>&1
    if ($LASTEXITCODE -ne 0) { throw 'Unable to freshly fetch origin/main before loading runner dependencies.' }
    $headSha = (& git -c $safeDirectory -C $root rev-parse HEAD 2>$null | Out-String).Trim()
    $originMainSha = (& git -c $safeDirectory -C $root rev-parse origin/main 2>$null | Out-String).Trim()
    if ($headSha -notmatch '^[0-9a-f]{40}$' -or $originMainSha -notmatch '^[0-9a-f]{40}$') {
        throw 'Unable to establish bootstrap HEAD and origin/main identities.'
    }
    $null = & git -c $safeDirectory -C $root merge-base --is-ancestor $originMainSha $headSha 2>$null
    if ($LASTEXITCODE -ne 0) { throw 'Fresh origin/main is not an ancestor of the bootstrap HEAD.' }

    $committedPaths = @(& git -c $safeDirectory -C $root diff --name-only --diff-filter=ACDMRTUXB "$originMainSha..$headSha" -- 2>$null) |
        ForEach-Object { ([string]$_).Trim() } | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
    if ($LASTEXITCODE -ne 0) { throw 'Unable to establish committed branch paths.' }
    $workingPaths = @(
        @(& git -c $safeDirectory -C $root diff --name-only --diff-filter=ACDMRTUXB HEAD -- 2>$null)
        @(& git -c $safeDirectory -C $root diff --cached --name-only --diff-filter=ACDMRTUXB HEAD -- 2>$null)
        @(& git -c $safeDirectory -C $root ls-files --others --exclude-standard 2>$null)
    ) | ForEach-Object { ([string]$_).Trim() } | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Sort-Object -Unique
    if ($LASTEXITCODE -ne 0) { throw 'Unable to establish working-tree branch paths.' }
    foreach ($path in @($committedPaths) + @($workingPaths)) {
        if ($path -cnotin $script:HostNativeAllowedBranchDelta) {
            throw "Host-native provenance rejected an unapproved branch path: $path"
        }
    }
    if (-not $IsPreflightOnly) {
        $status = (& git -c $safeDirectory -C $root status --porcelain=v1 2>$null | Out-String).Trim()
        if ($LASTEXITCODE -ne 0 -or -not [string]::IsNullOrWhiteSpace($status)) {
            throw 'Full host-native evidence requires a clean worktree before loading dependencies.'
        }
        $delta = @(Compare-Object -CaseSensitive `
            -ReferenceObject @($script:HostNativeAllowedBranchDelta | Sort-Object) `
            -DifferenceObject @($committedPaths | Sort-Object))
        if ($delta.Count -ne 0) {
            throw 'Full host-native evidence requires exactly the reviewed runner and paired static-test branch delta.'
        }
    }

    $dependencyPaths = @(
        'scripts/dev/start-isolated-branch-stack.ps1',
        'scripts/dev/kit-message-probe/start-isolated-kit.ps1',
        'scripts/lib/StructLog.psm1'
    )
    $dependencyEvidence = foreach ($path in $dependencyPaths) {
        $fullPath = Join-Path $root $path
        $null = & git -c $safeDirectory -C $root diff --quiet $originMainSha -- $path 2>$null
        if ($LASTEXITCODE -ne 0) { throw "A bootstrap dependency differs from fresh origin/main: $path" }
        if (-not (Test-Path -LiteralPath $fullPath -PathType Leaf)) { throw "A bootstrap dependency is missing: $path" }
        $aclEvidence = Assert-HostNativePathAcl -Path $fullPath -Mode source_integrity
        [ordered]@{
            path = $path
            sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $fullPath).Hash
            acl = $aclEvidence
        }
    }
    $rootAcl = Assert-HostNativePathAcl -Path $root -Mode source_integrity
    return [pscustomobject]@{
        worktree_root = $root
        safe_directory = $safeDirectory
        head_sha = $headSha
        origin_main_sha = $originMainSha
        committed_paths = @($committedPaths)
        working_paths = @($workingPaths)
        dependencies = @($dependencyEvidence)
        worktree_acl = $rootAcl
    }
}

$bootstrapProvenance = Invoke-HostNativeBootstrapProvenance `
    -RequestedWorktreeRoot $WorktreeRoot -IsPreflightOnly ([bool]$PreflightOnly)

# Reuse the repository's reviewed process identity, command-line quoting, health,
# and pinned SafeHandle stop primitives. Dot-sourcing is side-effect-free because
# that script's CLI entrypoint is guarded by InvocationName != '.'.
. (Join-Path $PSScriptRoot 'start-isolated-branch-stack.ps1')
# Import only the probe launcher's reviewed port and reserved-range helpers. The
# authority evidence never calls its high-level start path, which deliberately
# clears the two authority variables.
. (Join-Path $PSScriptRoot 'kit-message-probe\start-isolated-kit.ps1')

# This host-native run is an isolated Windows development-verification surface.
# It never reads or controls the local-windows deployment checkout/runtime.
$script:HostNativeEvidenceRole = 'agent_development_verification'
$script:HostNativeEvidenceIsDeliverySurface = $false
$script:HostNativeEvidenceIntegrityNotes = @()

function Assert-HostNativeEvidenceIntegrity {
    param(
        [Parameter(Mandatory = $true)][string] $Code,
        [Parameter(Mandatory = $true)][string] $Detail
    )

    if ($script:HostNativeEvidenceIsDeliverySurface) { throw $Detail }
    $script:HostNativeEvidenceIntegrityNotes += [ordered]@{ code = $Code; detail = $Detail }
}
$script:PlaywrightEvidenceTimeoutSeconds = 300
$script:PlaywrightRunnerGraceSeconds = 30
$script:RunnerOwnedStagePort = 49081
$script:StageArtifactMaxBytes = 536870912
$script:KnownStageArtifactSha256 = '60DA4E7BB458A053E3642389420903C8D8715E87957D1C018C7FB4B36A60F4A9'
$script:KnownStageSourceIfcSha256 = '54D77FE1C8839BDD7D2CB46A9A87E4491B75F0019462608FAB7BC5FC86155B71'

function Test-SamePath {
    param(
        [Parameter(Mandatory = $true)][string] $Left,
        [Parameter(Mandatory = $true)][string] $Right
    )

    $leftFull = [System.IO.Path]::GetFullPath($Left).TrimEnd('\')
    $rightFull = [System.IO.Path]::GetFullPath($Right).TrimEnd('\')
    return [string]::Equals($leftFull, $rightFull, [System.StringComparison]::OrdinalIgnoreCase)
}

function Test-PathContained {
    param(
        [Parameter(Mandatory = $true)][string] $Candidate,
        [Parameter(Mandatory = $true)][string] $Root
    )

    $candidateFull = [System.IO.Path]::GetFullPath($Candidate).TrimEnd('\')
    $rootFull = [System.IO.Path]::GetFullPath($Root).TrimEnd('\')
    return [string]::Equals($candidateFull, $rootFull, [System.StringComparison]::OrdinalIgnoreCase) `
        -or $candidateFull.StartsWith("$rootFull\", [System.StringComparison]::OrdinalIgnoreCase)
}

function Assert-NoReparsePointPath {
    param([Parameter(Mandatory = $true)][string] $Path)

    $fullPath = [System.IO.Path]::GetFullPath($Path)
    $root = [System.IO.Path]::GetPathRoot($fullPath)
    if ([string]::IsNullOrWhiteSpace($root)) {
        throw "Cannot determine the filesystem root for path: $Path"
    }

    $relative = $fullPath.Substring($root.Length).Trim('\')
    if ([string]::IsNullOrWhiteSpace($relative)) { return }

    $current = $root
    foreach ($segment in @($relative -split '[\\/]') | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }) {
        $current = Join-Path $current $segment
        if (-not (Test-Path -LiteralPath $current)) { return }
        $item = Get-Item -LiteralPath $current
        if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw "Reparse-point paths are not allowed for host-native evidence: $current"
        }
    }
}

function Assert-NoBroadWriteAcl {
    param([Parameter(Mandatory = $true)][string] $Path)

    $broadWriterSids = @('S-1-1-0', 'S-1-5-11', 'S-1-5-32-545')
    $writeMask = [int64](
        [System.Security.AccessControl.FileSystemRights]::WriteData -bor
        [System.Security.AccessControl.FileSystemRights]::AppendData -bor
        [System.Security.AccessControl.FileSystemRights]::WriteAttributes -bor
        [System.Security.AccessControl.FileSystemRights]::WriteExtendedAttributes -bor
        [System.Security.AccessControl.FileSystemRights]::Delete -bor
        [System.Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles -bor
        [System.Security.AccessControl.FileSystemRights]::ChangePermissions -bor
        [System.Security.AccessControl.FileSystemRights]::TakeOwnership
    )
    $rules = (Get-Acl -LiteralPath $Path).GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier])
    foreach ($rule in $rules) {
        if ($rule.AccessControlType -ne [System.Security.AccessControl.AccessControlType]::Allow) { continue }
        if ($rule.IdentityReference.Value -notin $broadWriterSids) { continue }
        if (([int64]$rule.FileSystemRights -band $writeMask) -ne 0) {
            Assert-HostNativeEvidenceIntegrity -Code 'broad_write_acl' `
                -Detail "Host-native evidence path grants a broad principal write access: $Path"
            # One note per path: further matching ACEs describe the same condition.
            return
        }
    }
}

function Ensure-Directory {
    param([Parameter(Mandatory = $true)][string] $Path)

    Assert-NoReparsePointPath -Path (Split-Path -Path $Path -Parent)
    if (-not (Test-Path -LiteralPath $Path -PathType Container)) {
        New-Item -ItemType Directory -Path $Path | Out-Null
    }
    Assert-NoReparsePointPath -Path $Path
    Assert-NoBroadWriteAcl -Path $Path
}

function Protect-RunnerOwnedPrivateDirectory {
    param([Parameter(Mandatory = $true)][string] $Path)

    $fullPath = [IO.Path]::GetFullPath($Path)
    Assert-NoReparsePointPath -Path $fullPath
    $acl = Get-Acl -LiteralPath $fullPath
    $acl.SetAccessRuleProtection($true, $false)
    foreach ($rule in @($acl.Access)) {
        $null = $acl.RemoveAccessRuleSpecific($rule)
    }
    $inheritance = [Security.AccessControl.InheritanceFlags]::ContainerInherit -bor `
        [Security.AccessControl.InheritanceFlags]::ObjectInherit
    $propagation = [Security.AccessControl.PropagationFlags]::None
    foreach ($sidValue in @(
        [Security.Principal.WindowsIdentity]::GetCurrent().User.Value,
        $script:HostNativeExpectedOwnerSid,
        'S-1-5-18',
        'S-1-5-32-544'
    ) | Sort-Object -Unique) {
        $sid = [Security.Principal.SecurityIdentifier]::new($sidValue)
        $rule = [Security.AccessControl.FileSystemAccessRule]::new(
            $sid,
            [Security.AccessControl.FileSystemRights]::FullControl,
            $inheritance,
            $propagation,
            [Security.AccessControl.AccessControlType]::Allow
        )
        $acl.AddAccessRule($rule)
    }
    Set-Acl -LiteralPath $fullPath -AclObject $acl
    $aclEvidence = Assert-HostNativePathAcl -Path $fullPath -Mode private_evidence

    $probePath = Join-Path $fullPath ".acl-write-probe-$([guid]::NewGuid().ToString('N'))"
    $probe = [IO.File]::Open($probePath, [IO.FileMode]::CreateNew, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
    try {
        $probe.WriteByte(1)
    }
    finally {
        $probe.Dispose()
        Remove-Item -LiteralPath $probePath -Force
    }
    return $aclEvidence
}

function Assert-HostNativeTreeAcl {
    param(
        [Parameter(Mandatory = $true)][string] $Root,
        [ValidateSet('source_integrity', 'signed_toolchain')][string] $Mode = 'source_integrity'
    )

    $items = @((Get-Item -LiteralPath $Root -Force)) + @(
        Get-ChildItem -LiteralPath $Root -Recurse -Force -ErrorAction Stop
    )
    $count = 0
    foreach ($item in $items) {
        if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw "A trusted execution tree contains a reparse point: $($item.FullName)"
        }
        $null = Assert-HostNativePathAcl -Path $item.FullName -Mode $Mode
        $count += 1
    }
    return [ordered]@{ root = [IO.Path]::GetFullPath($Root); acl_entries_verified = $count }
}

function Get-TrustedWindowsToolchain {
    $nodeRoot = Join-Path $env:ProgramFiles 'nodejs'
    $nodeExecutable = Join-Path $nodeRoot 'node.exe'
    $npmCli = Join-Path $nodeRoot 'node_modules\npm\bin\npm-cli.js'
    $chromeRoot = Join-Path $env:ProgramFiles 'Google\Chrome\Application'
    $chromeExecutable = Join-Path $chromeRoot 'chrome.exe'
    foreach ($required in @($nodeExecutable, $npmCli, $chromeExecutable)) {
        if (-not (Test-Path -LiteralPath $required -PathType Leaf)) {
            throw "A pinned Windows toolchain file is missing: $required"
        }
        Assert-NoReparsePointPath -Path $required
    }
    $nodeTreeAcl = Assert-HostNativeTreeAcl -Root $nodeRoot -Mode signed_toolchain
    $chromeRootAcl = Assert-HostNativePathAcl -Path $chromeRoot -Mode signed_toolchain
    $chromeExecutableAcl = Assert-HostNativePathAcl -Path $chromeExecutable -Mode signed_toolchain

    $nodeSignature = Get-AuthenticodeSignature -LiteralPath $nodeExecutable
    if ($nodeSignature.Status -ne [Management.Automation.SignatureStatus]::Valid `
        -or [string]$nodeSignature.SignerCertificate.Subject -notmatch '(?:^|,\s*)O=OpenJS Foundation(?:,|$)') {
        throw 'The pinned Node executable is not validly signed by OpenJS Foundation.'
    }
    $chromeSignature = Get-AuthenticodeSignature -LiteralPath $chromeExecutable
    if ($chromeSignature.Status -ne [Management.Automation.SignatureStatus]::Valid `
        -or [string]$chromeSignature.SignerCertificate.Subject -notmatch '(?:^|,\s*)O=Google LLC(?:,|$)') {
        throw 'The pinned Chrome executable is not validly signed by Google LLC.'
    }
    $chromeVersion = (Get-Item -LiteralPath $chromeExecutable).VersionInfo.FileVersion
    $chromeVersionRoot = Join-Path $chromeRoot $chromeVersion
    if (-not (Test-Path -LiteralPath $chromeVersionRoot -PathType Container)) {
        throw 'The signed Chrome executable has no exact matching version directory.'
    }
    $chromeVersionTreeAcl = Assert-HostNativeTreeAcl -Root $chromeVersionRoot -Mode signed_toolchain
    $nodeVersion = (& $nodeExecutable --version 2>$null | Out-String).Trim()
    $npmVersion = (& $nodeExecutable $npmCli --version 2>$null | Out-String).Trim()
    if ($LASTEXITCODE -ne 0 -or $nodeVersion -notmatch '^v\d+\.\d+\.\d+$' `
        -or $npmVersion -notmatch '^\d+\.\d+\.\d+$') {
        throw 'The pinned Node/npm toolchain did not report exact semantic versions.'
    }
    return [pscustomobject]@{
        node_executable = [IO.Path]::GetFullPath($nodeExecutable)
        node_version = $nodeVersion
        node_sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $nodeExecutable).Hash
        node_signer = [string]$nodeSignature.SignerCertificate.Subject
        npm_cli = [IO.Path]::GetFullPath($npmCli)
        npm_version = $npmVersion
        npm_cli_sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $npmCli).Hash
        chrome_executable = [IO.Path]::GetFullPath($chromeExecutable)
        chrome_version = $chromeVersion
        chrome_sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $chromeExecutable).Hash
        chrome_signer = [string]$chromeSignature.SignerCertificate.Subject
        node_tree_acl = $nodeTreeAcl
        chrome_execution_acl = [ordered]@{
            application_root = $chromeRootAcl
            executable = $chromeExecutableAcl
            version_tree = $chromeVersionTreeAcl
        }
    }
}

function Test-HttpOk {
    param([Parameter(Mandatory = $true)][string] $Url)

    try {
        $response = Invoke-WebRequest -Uri $Url -TimeoutSec 5 -UseBasicParsing
        return $response.StatusCode -ge 200 -and $response.StatusCode -lt 300
    }
    catch {
        return $false
    }
}

function Wait-ForHttpOk {
    param(
        [Parameter(Mandatory = $true)][string] $Url,
        [Parameter(Mandatory = $true)][int] $TimeoutSeconds
    )

    $deadline = (Get-Date).ToUniversalTime().AddSeconds($TimeoutSeconds)
    do {
        if (Test-HttpOk -Url $Url) { return $true }
        Start-Sleep -Milliseconds 500
    } while ((Get-Date).ToUniversalTime() -lt $deadline)
    return $false
}

function Wait-ForHttpUnavailable {
    param(
        [Parameter(Mandatory = $true)][string] $Url,
        [Parameter(Mandatory = $true)][int] $TimeoutSeconds
    )

    $deadline = (Get-Date).ToUniversalTime().AddSeconds($TimeoutSeconds)
    do {
        if (-not (Test-HttpOk -Url $Url)) { return $true }
        Start-Sleep -Milliseconds 500
    } while ((Get-Date).ToUniversalTime() -lt $deadline)
    return $false
}

function Test-ProcessDescendsFrom {
    param(
        [Parameter(Mandatory = $true)][int] $ProcessId,
        [Parameter(Mandatory = $true)] $AncestorIdentity
    )

    $expectedCreation = [DateTimeOffset]::MinValue
    if (-not [DateTimeOffset]::TryParse(
        (ConvertTo-IsolatedCreationIdentity $AncestorIdentity.creation_identity),
        [Globalization.CultureInfo]::InvariantCulture,
        [Globalization.DateTimeStyles]::AllowWhiteSpaces,
        [ref]$expectedCreation
    )) { return $false }
    $currentProcessId = $ProcessId
    $childCreation = $null
    for ($depth = 0; $depth -lt 16 -and $currentProcessId -gt 0; $depth += 1) {
        $currentProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$currentProcessId" -ErrorAction SilentlyContinue
        if ($null -eq $currentProcess) { return $false }
        $creation = [DateTimeOffset]::MinValue
        if (-not [DateTimeOffset]::TryParse(
            (ConvertTo-IsolatedCreationIdentity $currentProcess.CreationDate),
            [Globalization.CultureInfo]::InvariantCulture,
            [Globalization.DateTimeStyles]::AllowWhiteSpaces,
            [ref]$creation
        ) -or $creation -lt $expectedCreation `
            -or ($null -ne $childCreation -and $creation -gt $childCreation)) { return $false }
        if ($currentProcessId -eq [int]$AncestorIdentity.pid) {
            return (ConvertTo-IsolatedCreationIdentity $currentProcess.CreationDate) -ceq `
                (ConvertTo-IsolatedCreationIdentity $AncestorIdentity.creation_identity)
        }
        $childCreation = $creation
        $currentProcessId = [int]$currentProcess.ParentProcessId
    }
    return $false
}

function Write-ControlMarker {
    param(
        [Parameter(Mandatory = $true)][string] $Path,
        [Parameter(Mandatory = $true)][hashtable] $Marker
    )

    Assert-NoReparsePointPath -Path (Split-Path -Path $Path -Parent)
    if (Test-Path -LiteralPath $Path) {
        throw "Control marker already exists and will not be overwritten: $Path"
    }

    $payload = "$(($Marker | ConvertTo-Json -Depth 4 -Compress))`n"
    $encoding = [System.Text.UTF8Encoding]::new($false)
    $bytes = $encoding.GetBytes($payload)
    $stream = [System.IO.File]::Open($Path, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
    try {
        $stream.Write($bytes, 0, $bytes.Length)
    }
    finally {
        $stream.Dispose()
    }
}

function Read-ControlMarker {
    param([Parameter(Mandatory = $true)][string] $Path)

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $null }
    try {
        return Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
    }
    catch {
        return $null
    }
}

function Wait-ForControlMarker {
    param(
        [Parameter(Mandatory = $true)][string] $Path,
        [Parameter(Mandatory = $true)][string] $RunId,
        [Parameter(Mandatory = $true)][string] $ControlNonce,
        [Parameter(Mandatory = $true)][int] $TimeoutSeconds,
        [System.Diagnostics.Process] $ChildProcess
    )

    $deadline = (Get-Date).ToUniversalTime().AddSeconds($TimeoutSeconds)
    do {
        $marker = Read-ControlMarker -Path $Path
        if (
            $null -ne $marker `
            -and $marker.schema_version -eq 'runtime-command-authority-control/v1' `
            -and $marker.run_id -eq $RunId `
            -and $marker.control_nonce -eq $ControlNonce `
            -and -not [string]::IsNullOrWhiteSpace([string]$marker.request_id)
        ) {
            return $marker
        }
        if ($null -ne $ChildProcess -and $ChildProcess.HasExited) {
            # The case's raw stdout/stderr can carry lease tokens, datachannel trace ids and
            # session ids, so it is deliberately never redirected to a file next to the
            # evidence. The exit code is the one detail that can be reported safely; the
            # case's own sanitized JSON under the Playwright output directory is where the
            # per-request detail lives.
            throw ("The host-native Playwright case exited (code $($ChildProcess.ExitCode)) before its " +
                   'required control marker was written. Raw case output is intentionally not persisted; ' +
                   "read the sanitized case JSON under the run's Playwright output directory.")
        }
        Start-Sleep -Milliseconds 250
    } while ((Get-Date).ToUniversalTime() -lt $deadline)
    throw "Timed out waiting for control marker: $Path"
}

function Wait-ForProcessExit {
    param(
        [Parameter(Mandatory = $true)][System.Diagnostics.Process] $Process,
        [Parameter(Mandatory = $true)][int] $TimeoutSeconds
    )

    $deadline = (Get-Date).ToUniversalTime().AddSeconds($TimeoutSeconds)
    do {
        if ($Process.HasExited) { return }
        Start-Sleep -Milliseconds 500
    } while ((Get-Date).ToUniversalTime() -lt $deadline)
    throw 'The host-native Playwright case did not exit within its bounded evidence window.'
}

function Get-HttpNoRedirectProbe {
    param([Parameter(Mandatory = $true)][string] $Url)

    $handler = [System.Net.Http.HttpClientHandler]::new()
    $handler.AllowAutoRedirect = $false
    $handler.UseProxy = $false
    $client = [System.Net.Http.HttpClient]::new($handler)
    $client.Timeout = [TimeSpan]::FromSeconds(15)
    try {
        $request = [System.Net.Http.HttpRequestMessage]::new([System.Net.Http.HttpMethod]::Head, $Url)
        try {
            $response = $client.SendAsync(
                $request,
                [System.Net.Http.HttpCompletionOption]::ResponseHeadersRead
            ).GetAwaiter().GetResult()
            try {
                $location = if ($null -eq $response.Headers.Location) { '' } else { [string]$response.Headers.Location }
                return [pscustomobject]@{
                    status_code = [int]$response.StatusCode
                    redirect_location_present = -not [string]::IsNullOrWhiteSpace($location)
                    content_length = if ($null -eq $response.Content.Headers.ContentLength) {
                        $null
                    }
                    else {
                        [int64]$response.Content.Headers.ContentLength
                    }
                }
            }
            finally {
                $response.Dispose()
            }
        }
        finally {
            $request.Dispose()
        }
    }
    finally {
        $client.Dispose()
        $handler.Dispose()
    }
}

function Get-GitSafeDirectoryArgument {
    param([Parameter(Mandatory = $true)][string] $Path)

    $normalizedPath = [IO.Path]::GetFullPath($Path).Replace('\', '/')
    return "safe.directory=$normalizedPath"
}

function New-RunScopedInternalApiAuthToken {
    $bytes = [System.Security.Cryptography.RandomNumberGenerator]::GetBytes(32)
    return [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
}

function New-IsolatedCoordinatorEnvironment {
    param(
        [Parameter(Mandatory = $true)][string] $RunRoot,
        [Parameter(Mandatory = $true)][int] $ViewerPort,
        [Parameter(Mandatory = $true)][string] $RuntimeId,
        [Parameter(Mandatory = $true)][string] $InternalAuthToken
    )

    $stateRoot = Join-Path $RunRoot 'state\coordinator'
    $storageRoot = Join-Path $stateRoot 'storage'
    $artifactRoot = Join-Path $stateRoot 'artifacts'
    foreach ($directory in @(
        $stateRoot,
        $storageRoot,
        $artifactRoot,
        (Join-Path $stateRoot 'sessions'),
        (Join-Path $stateRoot 'events'),
        (Join-Path $stateRoot 'logs'),
        (Join-Path $stateRoot 'edge-runtime')
    )) {
        Ensure-Directory -Path $directory
    }

    $kitEndpoints = @([ordered]@{
        id = $RuntimeId
        signalingServer = '127.0.0.1'
        signalingPort = 49131
        mediaServer = '127.0.0.1'
        mediaPort = 48031
    }) | ConvertTo-Json -AsArray -Compress -Depth 4

    return @{
        HOST = '127.0.0.1'
        PORT = '8005'
        PUBLIC_HOST = '127.0.0.1'
        COORDINATOR_PUBLIC_BASE_URL = 'http://127.0.0.1:8005'
        VIEWER_PUBLIC_BASE_URL = "http://127.0.0.1:$ViewerPort"
        CORS_ORIGINS = "http://127.0.0.1:$ViewerPort,http://localhost:$ViewerPort"
        KIT_STREAM_SERVER = '127.0.0.1'
        KIT_SIGNALING_PORT = '49131'
        KIT_MEDIA_SERVER = '127.0.0.1'
        KIT_MEDIA_PORT = '48031'
        KIT_INSTANCE_ENDPOINTS = $kitEndpoints
        INTERNAL_API_AUTH_TOKEN = $InternalAuthToken
        USER_AUTH_PROVIDER = 'local-dev'
        SESSION_STORE_DIR = (Join-Path $stateRoot 'sessions')
        EVENT_LOG_DIR = (Join-Path $stateRoot 'events')
        CALLBACK_OUTBOX_STORE_PATH = (Join-Path $stateRoot 'callback-outbox.json')
        CONVERSION_LEDGER_STORE_PATH = (Join-Path $stateRoot 'conversion-ledger.json')
        ARTIFACT_HEALTH_LEDGER_STORE_PATH = (Join-Path $stateRoot 'artifact-health-ledger.json')
        EXTERNAL_IFC_READY_STORE_PATH = (Join-Path $stateRoot 'external-ifc-ready.json')
        STORAGE_ROOT = $storageRoot
        STORAGE_HOST_ROOT = $storageRoot
        RUNTIME_STORAGE_ROOT = $storageRoot
        EDGE_RUNTIME_DATA_ROOT = (Join-Path $stateRoot 'edge-runtime')
        A4_CONVERSION_ARTIFACTS_ROOT = $artifactRoot
        A4_CONVERSION_ARTIFACTS_HOST_ROOT = $artifactRoot
        LOG_ROOT = (Join-Path $stateRoot 'logs')
        MINIO_WATCH_ENABLED = 'false'
        CONVERSION_POLL_ENABLED = 'false'
        IFC_DOWNLOAD_STRICT = 'true'
        # Explicit unavailable loopback targets prevent fallback to deployment services.
        GOVERNANCE_API_BASE = 'http://127.0.0.1:8007'
        STREAMING_CONVERSION_API_BASE = 'http://127.0.0.1:8007'
        KIT_MANAGER_API_BASE = 'http://127.0.0.1:8007'
    }
}

function Start-RunnerOwnedChild {
    param(
        [Parameter(Mandatory = $true)][string] $Role,
        [Parameter(Mandatory = $true)][string] $Executable,
        [Parameter(Mandatory = $true)][string[]] $Arguments,
        [Parameter(Mandatory = $true)][string] $WorkingDirectory,
        [Parameter(Mandatory = $true)][hashtable] $Environment,
        [Parameter(Mandatory = $true)][string] $RunDirectory,
        [Parameter(Mandatory = $true)][string] $Entrypoint,
        [switch] $NoPersistedOutput,
        [switch] $AllowCleanFastExit
    )

    Ensure-Directory -Path $RunDirectory
    $stdoutPath = Join-Path $RunDirectory "$Role.stdout.log"
    $stderrPath = Join-Path $RunDirectory "$Role.stderr.log"
    if ($NoPersistedOutput) {
        $startInfo = [Diagnostics.ProcessStartInfo]::new()
        $startInfo.FileName = $Executable
        $startInfo.WorkingDirectory = $WorkingDirectory
        $startInfo.UseShellExecute = $false
        $startInfo.CreateNoWindow = $true
        $startInfo.RedirectStandardOutput = $true
        $startInfo.RedirectStandardError = $true
        $startInfo.Environment.Clear()
        foreach ($entry in [Environment]::GetEnvironmentVariables('Machine').GetEnumerator()) {
            $startInfo.Environment[[string]$entry.Key] = [string]$entry.Value
        }
        # SystemRoot is session-dynamic and absent from the Machine registry block;
        # without it Node's OpenSSL CSPRNG bootstrap asserts (exit 134) on Windows.
        $startInfo.Environment['SystemRoot'] = [string][Environment]::GetEnvironmentVariable('SystemRoot')
        foreach ($entry in $Environment.GetEnumerator()) {
            $startInfo.Environment[[string]$entry.Key] = [string]$entry.Value
        }
        foreach ($argument in $Arguments) { $startInfo.ArgumentList.Add([string]$argument) }
        $child = [Diagnostics.Process]::new()
        $child.StartInfo = $startInfo
        $child.EnableRaisingEvents = $true
        if (-not $child.Start()) { throw "Unable to start runner-owned $Role process." }
        # Asynchronous reads drain both pipes without emitting or persisting child output.
        $child.BeginOutputReadLine()
        $child.BeginErrorReadLine()
    }
    else {
        $startParameters = @{
            FilePath = $Executable
            ArgumentList = (ConvertTo-IsolatedWindowsArgumentLine -Arguments $Arguments)
            WorkingDirectory = $WorkingDirectory
            UseNewEnvironment = $true
            Environment = $Environment
            WindowStyle = 'Hidden'
            PassThru = $true
        }
        $startParameters.RedirectStandardOutput = $stdoutPath
        $startParameters.RedirectStandardError = $stderrPath
        $child = Start-Process @startParameters
    }

    $identity = $null
    try {
        $deadline = [DateTime]::UtcNow.AddSeconds(10)
        do {
            try {
                $identity = Get-IsolatedProcessIdentity -ProcessId ([int]$child.Id) -Entrypoint $Entrypoint
                break
            }
            catch {
                if ($child.HasExited) {
                    if ($AllowCleanFastExit -and $child.ExitCode -eq 0) {
                        # Short-lived commands (e.g. --list collection) may finish
                        # cleanly before the first CIM identity read completes.
                        $identity = [pscustomobject]@{
                            pid = [int]$child.Id
                            entrypoint = $Entrypoint
                            command_line = '<clean-fast-exit>'
                            creation_identity = '<clean-fast-exit>'
                            executable_path = [IO.Path]::GetFullPath($Executable)
                        }
                        break
                    }
                    throw ("Runner-owned $Role child (pid $($child.Id)) exited with code " +
                        "$($child.ExitCode) before its identity was established: $($_.Exception.Message)")
                }
                Start-Sleep -Milliseconds 100
            }
        } while ([DateTime]::UtcNow -lt $deadline)
        if ($null -eq $identity) { throw "Unable to establish $Role child identity." }
    }
    catch {
        if (-not $child.HasExited) {
            $child.Kill($true)
            $null = $child.WaitForExit(5000)
        }
        throw
    }

    $identity | Add-Member -NotePropertyName role -NotePropertyValue $Role
    $identity | Add-Member -NotePropertyName expected_executable_path -NotePropertyValue ([IO.Path]::GetFullPath($Executable))
    $identity | Add-Member -NotePropertyName stdout_path -NotePropertyValue $(if ($NoPersistedOutput) { '' } else { $stdoutPath })
    $identity | Add-Member -NotePropertyName stderr_path -NotePropertyValue $(if ($NoPersistedOutput) { '' } else { $stderrPath })
    $identity | Add-Member -NotePropertyName output_policy -NotePropertyValue $(if ($NoPersistedOutput) { 'async_drained_discard' } else { 'private_files' })
    $identity | Add-Member -NotePropertyName process_handle -NotePropertyValue $child
    return $identity
}

function Stop-RunnerOwnedChild {
    param([Parameter(Mandatory = $true)] $Identity)

    $actual = Get-IsolatedProcessIdentity -ProcessId ([int]$Identity.pid) -Entrypoint ([string]$Identity.entrypoint)
    if (-not (Test-SamePath -Left ([string]$actual.executable_path) -Right ([string]$Identity.expected_executable_path))) {
        throw "Runner-owned $($Identity.role) executable identity changed before stop."
    }
    $results = @(Stop-IsolatedBackends -Processes @($Identity))
    if ($results.Count -ne 1 -or $results[0].status -ne 'stopped') {
        $reason = if ($results.Count -eq 1) { [string]$results[0].reason } else { 'unexpected_stop_result' }
        throw "Runner-owned $($Identity.role) process was not stopped: $reason"
    }
    return $results[0]
}

function Start-RunnerOwnedCoordinator {
    param(
        [Parameter(Mandatory = $true)][string] $ResolvedWorktreeRoot,
        [Parameter(Mandatory = $true)][string] $RunRoot,
        [Parameter(Mandatory = $true)][string] $NodeExecutable,
        [Parameter(Mandatory = $true)][string] $TsxCli,
        [Parameter(Mandatory = $true)][hashtable] $Environment
    )

    $coordinatorRoot = Join-Path $ResolvedWorktreeRoot 'bim-review-coordinator'
    $entrypoint = Join-Path $coordinatorRoot 'src\index.ts'
    return Start-RunnerOwnedChild -Role 'coordinator' -Executable $NodeExecutable `
        -Arguments @($TsxCli, $entrypoint, '--isolated-stack-port', '8005') `
        -WorkingDirectory $coordinatorRoot -Environment $Environment `
        -RunDirectory (Join-Path $RunRoot 'processes') -Entrypoint $entrypoint `
        -NoPersistedOutput
}

function New-AuthorityIngressProxySource {
    param(
        [Parameter(Mandatory = $true)][string] $ProxyPath,
        [Parameter(Mandatory = $true)][string] $RunRoot
    )

    # This generated helper contains no token and emits no request/header/body logs.
    $source = @'
import http from "node:http";

const listenHost = "127.0.0.1";
const listenPort = 8006;
const upstreamHost = "127.0.0.1";
const upstreamPort = 8005;
const bodyLimit = 1024 * 1024;
const allowedPostPath = /^\/api\/internal\/review-sessions\/review_session_[A-Za-z0-9_-]+\/(?:datachannel-trace-verifications|runtime-command-authorizations|stage-binding-authorization-rollbacks|stage-binding-confirmations)$/;
const forwardedHeaders = new Set(["accept", "content-length", "content-type", "x-internal-token", "x-trace-id", "x-viewer-lease-token"]);

function json(response, status, body) {
  const payload = Buffer.from(JSON.stringify(body));
  response.writeHead(status, { "content-type": "application/json", "content-length": String(payload.length) });
  response.end(payload);
}

const server = http.createServer((request, response) => {
  const parsed = new URL(request.url || "/", `http://${listenHost}:${listenPort}`);
  if (request.method === "GET" && parsed.pathname === "/health" && parsed.search === "") {
    json(response, 200, { status: "ok", service: "runtime-authority-ingress" });
    return;
  }
  if (request.method !== "POST" || parsed.search !== "" || !allowedPostPath.test(parsed.pathname)) {
    json(response, request.method === "POST" ? 404 : 405, { error: "route_not_allowed" });
    return;
  }

  const chunks = [];
  let size = 0;
  let rejected = false;
  request.on("data", (chunk) => {
    if (rejected) return;
    size += chunk.length;
    if (size > bodyLimit) {
      rejected = true;
      json(response, 413, { error: "request_too_large" });
      return;
    }
    chunks.push(chunk);
  });
  request.on("end", () => {
    if (rejected) return;
    const headers = {};
    for (const [name, value] of Object.entries(request.headers)) {
      if (forwardedHeaders.has(name) && value !== undefined) headers[name] = value;
    }
    const upstream = http.request({
      host: upstreamHost,
      port: upstreamPort,
      method: "POST",
      path: parsed.pathname,
      headers,
    }, (upstreamResponse) => {
      const responseHeaders = {};
      if (upstreamResponse.headers["content-type"]) responseHeaders["content-type"] = upstreamResponse.headers["content-type"];
      if (upstreamResponse.headers["x-trace-id"]) responseHeaders["x-trace-id"] = upstreamResponse.headers["x-trace-id"];
      response.writeHead(upstreamResponse.statusCode || 502, responseHeaders);
      upstreamResponse.pipe(response);
    });
    upstream.on("error", () => {
      if (!response.headersSent) json(response, 502, { error: "authority_upstream_unavailable" });
      else response.destroy();
    });
    upstream.end(Buffer.concat(chunks));
  });
});

server.requestTimeout = 5000;
server.headersTimeout = 6000;
server.listen(listenPort, listenHost);
'@
    return Write-RunnerOwnedNewTextFile -Path $ProxyPath -Text "$source`n" -RunRoot $RunRoot
}

function Start-RunnerOwnedAuthorityIngress {
    param(
        [Parameter(Mandatory = $true)][string] $NodeExecutable,
        [Parameter(Mandatory = $true)][string] $ProxySourcePath,
        [Parameter(Mandatory = $true)][string] $RunRoot
    )

    return Start-RunnerOwnedChild -Role 'authority_ingress' -Executable $NodeExecutable `
        -Arguments @($ProxySourcePath) -WorkingDirectory $RunRoot -Environment @{} `
        -RunDirectory (Join-Path $RunRoot 'processes') -Entrypoint $ProxySourcePath `
        -NoPersistedOutput
}

function Copy-RunnerOwnedStageArtifact {
    param(
        [Parameter(Mandatory = $true)] $SourceArtifact,
        [Parameter(Mandatory = $true)][string] $RunRoot
    )

    $stageRoot = Join-Path $RunRoot 'stage'
    Ensure-Directory -Path $stageRoot
    Assert-NoReparsePointPath -Path $stageRoot
    $destinationPath = Join-Path $stageRoot 'model.usdc'
    $sourceStream = $null
    $destinationStream = $null
    $copyFailure = $null
    try {
        $sourceStream = [IO.File]::Open(
            [string]$SourceArtifact.source_path,
            [IO.FileMode]::Open,
            [IO.FileAccess]::Read,
            [IO.FileShare]::Read
        )
        $destinationStream = [IO.File]::Open(
            $destinationPath,
            [IO.FileMode]::CreateNew,
            [IO.FileAccess]::Write,
            [IO.FileShare]::None
        )
        $sourceStream.CopyTo($destinationStream)
    }
    catch {
        $copyFailure = $_
    }
    finally {
        if ($null -ne $destinationStream) { $destinationStream.Dispose() }
        if ($null -ne $sourceStream) { $sourceStream.Dispose() }
    }
    if ($null -ne $copyFailure) {
        if (Test-Path -LiteralPath $destinationPath -PathType Leaf) {
            Assert-NoReparsePointPath -Path $destinationPath
            Remove-Item -LiteralPath $destinationPath -Force
        }
        throw 'Unable to create the runner-owned stage artifact copy.'
    }
    try {
        $readHandle = [IO.File]::Open(
            $destinationPath,
            [IO.FileMode]::Open,
            [IO.FileAccess]::Read,
            [IO.FileShare]::Read
        )
    }
    catch {
        Assert-NoReparsePointPath -Path $destinationPath
        Remove-Item -LiteralPath $destinationPath -Force
        throw 'Unable to pin the runner-owned stage copy against mutation.'
    }
    $copiedSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $destinationPath).Hash
    $copiedLength = [int64](Get-Item -LiteralPath $destinationPath).Length
    if ($copiedSha256 -cne [string]$SourceArtifact.sha256 `
        -or $copiedLength -ne [int64]$SourceArtifact.length) {
        $readHandle.Dispose()
        Assert-NoReparsePointPath -Path $destinationPath
        Remove-Item -LiteralPath $destinationPath -Force
        throw 'The runner-owned stage copy did not preserve the supplied USDC identity.'
    }
    return [pscustomobject]@{
        path = $destinationPath
        sha256 = $copiedSha256
        length = $copiedLength
        read_handle = $readHandle
    }
}

function Remove-RunnerOwnedStageCacheArtifacts {
    param(
        [Parameter(Mandatory = $true)][string] $PrimaryStageUrl,
        [Parameter(Mandatory = $true)][string] $RejectedStageUrl,
        [Parameter(Mandatory = $true)][string] $StageCacheRoot,
        [Parameter(Mandatory = $true)][string] $ExpectedSha256,
        [Parameter(Mandatory = $true)][int64] $ExpectedLength,
        [Parameter(Mandatory = $true)][string] $RunRoot,
        [Parameter(Mandatory = $true)][bool] $RequireSuccessfulEvidence
    )

    $results = [System.Collections.Generic.List[object]]::new()
    $expectedCaches = @(
        [ordered]@{ url = $PrimaryStageUrl; must_exist = $true; classification = 'valid_stage' },
        [ordered]@{ url = $RejectedStageUrl; must_exist = $false; classification = 'rejected_stage' }
    )
    foreach ($expectedCache in $expectedCaches) {
        $stageUrl = [string]$expectedCache.url
        $sha = [Security.Cryptography.SHA256]::Create()
        try {
            $keyBytes = $sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($stageUrl))
        }
        finally {
            $sha.Dispose()
        }
        $cacheKey = ([BitConverter]::ToString($keyBytes)).Replace('-', '').ToLowerInvariant()
        $cachePath = Join-Path $StageCacheRoot "$cacheKey.usdc"
        $temporaryPath = Join-Path $StageCacheRoot "$cacheKey.usdc.tmp"
        $cacheExists = Test-Path -LiteralPath $cachePath -PathType Leaf
        if ($RequireSuccessfulEvidence -and [bool]$expectedCache.must_exist -and -not $cacheExists) {
            throw 'The valid stage did not produce its expected runner-owned Kit cache artifact.'
        }
        if ($cacheExists) {
            Assert-NoReparsePointPath -Path $cachePath
            $cacheItem = Get-Item -LiteralPath $cachePath
            $cacheSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $cachePath).Hash
            if ([int64]$cacheItem.Length -ne $ExpectedLength -or $cacheSha256 -cne $ExpectedSha256) {
                throw 'A runner-owned Kit stage cache artifact did not match the pinned USDC identity.'
            }
            Remove-RunnerOwnedGeneratedFile -Path $cachePath `
                -ExpectedSha256 $cacheSha256 -RunRoot $RunRoot
            $results.Add([ordered]@{
                role = 'kit_stage_cache'
                cache_key = $cacheKey
                status = 'removed_exact_file'
            })
            if ($RequireSuccessfulEvidence -and -not [bool]$expectedCache.must_exist) {
                throw 'A rejected stage URL produced a Kit cache artifact before denial.'
            }
        }
        if (Test-Path -LiteralPath $temporaryPath -PathType Leaf) {
            $resolvedTemporaryPath = [IO.Path]::GetFullPath($temporaryPath)
            if (-not (Test-PathContained -Candidate $resolvedTemporaryPath -Root $RunRoot)) {
                throw 'A runner-owned Kit stage cache temporary file resolved outside the run root.'
            }
            Assert-NoReparsePointPath -Path $resolvedTemporaryPath
            Remove-Item -LiteralPath $resolvedTemporaryPath -Force
            $results.Add([ordered]@{
                role = 'kit_stage_cache_temp'
                cache_key = $cacheKey
                status = 'removed_exact_file'
            })
            if ($RequireSuccessfulEvidence) {
                throw 'A runner-owned Kit stage cache temporary file remained after the evidence case.'
            }
        }
    }
    $residualEntries = @(Get-ChildItem -LiteralPath $StageCacheRoot -Force -ErrorAction SilentlyContinue)
    if ($residualEntries.Count -gt 0) {
        throw 'Runner-owned Kit stage cache cleanup left an unexpected file, directory, or reparse point.'
    }
    return @($results)
}

function New-RunnerOwnedStageServerSource {
    param(
        [Parameter(Mandatory = $true)][string] $SourcePath,
        [Parameter(Mandatory = $true)][string] $RunRoot
    )

    $source = @'
import http from "node:http";
import fs from "node:fs";
import crypto from "node:crypto";

const listenHost = "127.0.0.1";
const listenPort = 49081;
const artifactPath = process.env.STAGE_ARTIFACT_PATH;
const accessCapability = process.env.STAGE_ACCESS_CAPABILITY;
const allowedHosts = new Set(["127.0.0.1:49081", "localhost:49081"]);
if (!artifactPath || !/^[a-f0-9]{64}$/.test(accessCapability || "")) process.exit(2);
const artifact = fs.realpathSync(artifactPath);
const artifactStat = fs.statSync(artifact);
if (!artifactStat.isFile() || artifactStat.size <= 8) process.exit(3);

function end(response, statusCode, headers = {}) {
  response.writeHead(statusCode, { "Cache-Control": "no-store", ...headers });
  response.end();
}

const server = http.createServer((request, response) => {
  if (!allowedHosts.has(request.headers.host || "")) return end(response, 421);
  const parsed = new URL(request.url || "/", `http://${listenHost}:${listenPort}`);
  if (request.method === "GET" && parsed.pathname === "/health" && parsed.search === "") {
    const body = Buffer.from('{"status":"ok"}\n');
    response.writeHead(200, {
      "Content-Type": "application/json",
      "Content-Length": String(body.length),
      "Cache-Control": "no-store",
    });
    response.end(body);
    return;
  }
  const suppliedCapabilities = parsed.searchParams.getAll("cap");
  const suppliedCapability = suppliedCapabilities.length === 1 ? suppliedCapabilities[0] : "";
  const capabilityMatches = suppliedCapability.length === accessCapability.length &&
    crypto.timingSafeEqual(Buffer.from(suppliedCapability), Buffer.from(accessCapability));
  if ((request.method !== "GET" && request.method !== "HEAD") || parsed.pathname !== "/model.usdc" ||
      parsed.searchParams.size !== 1 || !capabilityMatches) {
    return end(response, 404);
  }
  response.writeHead(200, {
    "Content-Type": "application/octet-stream",
    "Content-Length": String(artifactStat.size),
    "Cache-Control": "no-store",
  });
  if (request.method === "HEAD") return response.end();
  const stream = fs.createReadStream(artifact);
  stream.on("error", () => response.destroy());
  stream.pipe(response);
});
server.requestTimeout = 30000;
server.headersTimeout = 5000;
server.listen(listenPort, listenHost);
'@
    return Write-RunnerOwnedNewTextFile -Path $SourcePath -Text "$source`n" -RunRoot $RunRoot
}

function Start-RunnerOwnedStageServer {
    param(
        [Parameter(Mandatory = $true)][string] $NodeExecutable,
        [Parameter(Mandatory = $true)][string] $ServerSourcePath,
        [Parameter(Mandatory = $true)][string] $StageArtifactPath,
        [Parameter(Mandatory = $true)][string] $StageAccessCapability,
        [Parameter(Mandatory = $true)][string] $RunRoot
    )

    return Start-RunnerOwnedChild -Role 'stage_server' -Executable $NodeExecutable `
        -Arguments @($ServerSourcePath) -WorkingDirectory $RunRoot `
        -Environment @{
            STAGE_ARTIFACT_PATH = $StageArtifactPath
            STAGE_ACCESS_CAPABILITY = $StageAccessCapability
        } `
        -RunDirectory (Join-Path $RunRoot 'processes') -Entrypoint $ServerSourcePath `
        -NoPersistedOutput
}

function Get-IsolatedKitRuntimePaths {
    param(
        [Parameter(Mandatory = $true)][string] $ResolvedWorktreeRoot,
        [Parameter(Mandatory = $true)][string] $RequestedReleaseRoot,
        [Parameter(Mandatory = $true)][string] $ExpectedKitExecutableSha256,
        [Parameter(Mandatory = $true)][string] $ExpectedAppKitSha256
    )

    $expectedReleaseRoot = Join-Path $ResolvedWorktreeRoot 'bim-streaming-server\_build\windows-x86_64\release'
    $resolvedReleaseRoot = [IO.Path]::GetFullPath(
        (Resolve-Path -LiteralPath $RequestedReleaseRoot -ErrorAction Stop).Path
    ).TrimEnd('\')
    if (-not (Test-SamePath -Left $resolvedReleaseRoot -Right $expectedReleaseRoot)) {
        throw 'KitReleaseRoot must be the exact isolated worktree build output.'
    }
    Assert-NoReparsePointPath -Path $resolvedReleaseRoot

    $kitExecutable = Join-Path $resolvedReleaseRoot 'kit\kit.exe'
    $appKit = Join-Path $resolvedReleaseRoot 'apps\ezplus.bim_review_stream_streaming.kit'
    $extensionSource = Join-Path $ResolvedWorktreeRoot 'bim-streaming-server\source\extensions'
    foreach ($requiredFile in @($kitExecutable, $appKit)) {
        if (-not (Test-Path -LiteralPath $requiredFile -PathType Leaf)) {
            throw "Required isolated Kit build output is missing: $requiredFile"
        }
    }
    if (-not (Test-Path -LiteralPath $extensionSource -PathType Container)) {
        throw 'The isolated worktree Kit extension source is missing.'
    }

    $kitExecutableSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $kitExecutable).Hash
    $appKitSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $appKit).Hash
    if ($kitExecutableSha256 -cne $ExpectedKitExecutableSha256.ToUpperInvariant() `
        -or $appKitSha256 -cne $ExpectedAppKitSha256.ToUpperInvariant()) {
        throw 'The isolated Kit build outputs do not match the caller-pinned post-build hashes.'
    }

    return [pscustomobject]@{
        release_root = $resolvedReleaseRoot
        kit_executable = $kitExecutable
        app_kit = $appKit
        extension_source = $extensionSource
        kit_executable_sha256 = $kitExecutableSha256
        app_kit_sha256 = $appKitSha256
        caller_pinned_post_build_hashes = $true
        release_provenance = 'isolated_worktree_build'
    }
}

function Assert-IsolatedKitPortPolicy {
    param(
        [Parameter(Mandatory = $true)][int] $SignalPort,
        [Parameter(Mandatory = $true)][int] $MediaPort
    )

    Assert-ProbePortAllowed -Name 'SignalPort' -Port $SignalPort
    Assert-ProbePortAllowed -Name 'StreamPort' -Port $MediaPort
    Assert-ProbePortFree -Name 'SignalPort' -Port $SignalPort
    Assert-ProbePortFree -Name 'StreamPort' -Port $MediaPort
}

function Wait-RunnerOwnedTcpListener {
    param(
        [Parameter(Mandatory = $true)][int] $Port,
        [Parameter(Mandatory = $true)] $Identity,
        [Parameter(Mandatory = $true)][int] $TimeoutSeconds,
        # omni.kit.livestream.app 10.1.0 exposes no bind-interface setting; its
        # signalling server always binds the wildcard address, so the Kit port
        # accepts 0.0.0.0 while every listener must still descend from the child.
        [switch] $AllowWildcardBind
    )

    $allowedAddresses = if ($AllowWildcardBind) { @('127.0.0.1', '0.0.0.0') } else { @('127.0.0.1') }
    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    do {
        $listeners = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
        if ($listeners.Count -gt 0) {
            $foreign = @($listeners | Where-Object {
                [string]$_.LocalAddress -cnotin $allowedAddresses `
                    -or -not (Test-ProcessDescendsFrom -ProcessId ([int]$_.OwningProcess) -AncestorIdentity $Identity)
            })
            if ($foreign.Count -gt 0) {
                throw "Port $Port acquired a wildcard, foreign, or creation-inconsistent listener."
            }
            $foreignUdp = @(Get-NetUDPEndpoint -LocalPort $Port -ErrorAction SilentlyContinue | Where-Object {
                [string]$_.LocalAddress -cnotin $allowedAddresses `
                    -or -not (Test-ProcessDescendsFrom -ProcessId ([int]$_.OwningProcess) -AncestorIdentity $Identity)
            })
            if ($foreignUdp.Count -gt 0) {
                throw "Port $Port acquired a wildcard, foreign, or creation-inconsistent UDP endpoint."
            }
            $actual = Get-IsolatedProcessIdentity -ProcessId ([int]$Identity.pid) -Entrypoint ([string]$Identity.entrypoint)
            if (-not (Test-IsolatedProcessOwnership -Expected $Identity -Actual $actual) `
                -or -not (Test-SamePath -Left ([string]$actual.executable_path) -Right ([string]$Identity.expected_executable_path))) {
                throw "Runner-owned $($Identity.role) identity changed while waiting for port $Port."
            }
            return $listeners
        }
        Start-Sleep -Milliseconds 500
    } while ([DateTime]::UtcNow -lt $deadline)
    throw "Runner-owned $($Identity.role) did not bind port $Port within its bounded readiness window."
}

function Assert-RunnerOwnedUdpMediaPortNotForeign {
    param(
        [Parameter(Mandatory = $true)][int] $Port,
        [Parameter(Mandatory = $true)] $Identity
    )

    # The WebRTC media UDP socket binds lazily when the first client session is
    # negotiated, so an absent endpoint is the healthy pre-session state; only a
    # foreign owner on the reserved media port is a failure.
    $foreignUdp = @(Get-NetUDPEndpoint -LocalPort $Port -ErrorAction SilentlyContinue | Where-Object {
        -not (Test-ProcessDescendsFrom -ProcessId ([int]$_.OwningProcess) -AncestorIdentity $Identity)
    })
    if ($foreignUdp.Count -gt 0) {
        throw "UDP media port $Port is owned by a foreign process."
    }
}

function Start-RunnerOwnedIsolatedKit {
    param(
        [Parameter(Mandatory = $true)] $KitPaths,
        [Parameter(Mandatory = $true)][string] $RunRoot,
        [Parameter(Mandatory = $true)][string] $RuntimeId,
        [Parameter(Mandatory = $true)][string] $InternalAuthToken,
        [Parameter(Mandatory = $true)][string] $AllowedStageHosts,
        [Parameter(Mandatory = $true)][ref] $StartedIdentity
    )

    Assert-IsolatedKitPortPolicy -SignalPort 49131 -MediaPort 48031
    $portableRoot = Join-Path $RunRoot 'kit\portable'
    $stageCacheRoot = Join-Path $RunRoot 'kit\stage-cache'
    Ensure-Directory -Path (Join-Path $RunRoot 'kit')
    Ensure-Directory -Path $portableRoot
    Ensure-Directory -Path $stageCacheRoot
    $arguments = @(
        [string]$KitPaths.app_kit,
        '--no-window',
        '--portable-root', $portableRoot,
        '--reset-user',
        '--ext-folder', [string]$KitPaths.extension_source,
        '--/exts/omni.kit.livestream.app/primaryStream/streamType=webrtc',
        '--/exts/omni.kit.livestream.app/primaryStream/signalPort=49131',
        '--/exts/omni.kit.livestream.app/primaryStream/streamPort=48031',
        '--/exts/omni.kit.livestream.app/primaryStream/publicIp=127.0.0.1'
    )
    $environment = @{
        COORDINATOR_INTERNAL_API_BASE = 'http://127.0.0.1:8006'
        INTERNAL_API_AUTH_TOKEN = $InternalAuthToken
        BIM_REVIEW_STREAM_ALLOWED_STAGE_HOSTS = $AllowedStageHosts
        BIM_REVIEW_STREAM_STAGE_CACHE = $stageCacheRoot
        KIT_INSTANCE_ID = $RuntimeId
    }
    $identity = Start-RunnerOwnedChild -Role 'kit' -Executable ([string]$KitPaths.kit_executable) `
        -Arguments $arguments -WorkingDirectory ([string]$KitPaths.release_root) `
        -Environment $environment -RunDirectory (Join-Path $RunRoot 'processes') `
        -Entrypoint ([string]$KitPaths.app_kit) -NoPersistedOutput
    $StartedIdentity.Value = $identity
    try {
        $null = Wait-RunnerOwnedTcpListener -Port 49131 -Identity $identity -TimeoutSeconds 300 -AllowWildcardBind
    }
    catch {
        $readinessFailure = $_.Exception.Message
        try {
            $null = Stop-RunnerOwnedChild -Identity $identity
            $StartedIdentity.Value = $null
        }
        catch {
            throw "Runner-owned Kit readiness failed: $readinessFailure Cleanup also failed: $($_.Exception.Message)"
        }
        throw "Runner-owned Kit readiness failed: $readinessFailure"
    }
    return $identity
}

function Resolve-AbsoluteHttpUrl {
    param(
        [Parameter(Mandatory = $true)][string] $Value,
        [Parameter(Mandatory = $true)][string] $Name
    )

    $parsed = $null
    if (-not [uri]::TryCreate($Value, [System.UriKind]::Absolute, [ref]$parsed) `
        -or $parsed.Scheme -notin @('http', 'https') `
        -or [string]::IsNullOrWhiteSpace($parsed.Host) `
        -or -not [string]::IsNullOrEmpty($parsed.UserInfo)) {
        throw "$Name must be an absolute HTTP(S) URL without user-info."
    }
    return $parsed
}

function Get-NativeBoundPortOwners {
    param([Parameter(Mandatory = $true)][int[]] $Ports)

    $netstatPath = Join-Path $env:SystemRoot 'System32\netstat.exe'
    $lines = @(& $netstatPath -ano 2>&1)
    if ($LASTEXITCODE -ne 0) { throw 'Native netstat port preflight failed.' }

    $boundOwners = [System.Collections.Generic.List[object]]::new()
    foreach ($line in $lines) {
        $text = [string]$line
        foreach ($port in $Ports) {
            if ($text -notmatch "^\s*(TCP|UDP)\s+\S+:$port\s+") { continue }
            $protocol = [string]$Matches[1]
            if ($protocol -eq 'TCP' -and $text -notmatch '\sLISTENING\s') { continue }
            $pidMatch = [regex]::Match($text, '(\d+)\s*$')
            $boundOwners.Add([pscustomobject]@{
                protocol = $protocol.ToLowerInvariant()
                port = $port
                process_id = if ($pidMatch.Success) { [int]$pidMatch.Groups[1].Value } else { 0 }
            })
        }
    }
    return @($boundOwners)
}

function Get-NativeDynamicTcpPortRanges {
    $netshPath = Join-Path $env:SystemRoot 'System32\netsh.exe'
    $ranges = [System.Collections.Generic.List[object]]::new()
    foreach ($family in @('ipv4', 'ipv6')) {
        $lines = @(& $netshPath int $family show dynamicport tcp 2>&1)
        if ($LASTEXITCODE -ne 0) { throw "Unable to inspect the Windows $family dynamic TCP range." }
        $values = @(
            $lines | ForEach-Object {
                $match = [regex]::Match([string]$_, ':\s*(\d+)\s*$')
                if ($match.Success) { [int]$match.Groups[1].Value }
            }
        )
        if ($values.Count -lt 2 -or $values[1] -le 0) {
            throw "Unable to parse the Windows $family dynamic TCP range."
        }
        $ranges.Add([pscustomobject]@{
            address_family = $family
            start_port = [int]$values[0]
            number_of_ports = [int]$values[1]
            end_port = [int]$values[0] + [int]$values[1] - 1
        })
    }
    return @($ranges)
}

function Assert-RunnerOwnedPortsReleased {
    param([Parameter(Mandatory = $true)][int[]] $Ports)

    $native = @(Get-NativeBoundPortOwners -Ports $Ports)
    $cmdletEndpoints = foreach ($port in $Ports) {
        @(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)
        @(Get-NetUDPEndpoint -LocalPort $port -ErrorAction SilentlyContinue)
    }
    if ($native.Count -gt 0 -or @($cmdletEndpoints).Count -gt 0) {
        $occupied = @(
            @($native | ForEach-Object { [int]$_.port })
            @($cmdletEndpoints | ForEach-Object { [int]$_.LocalPort })
        ) | Sort-Object -Unique
        throw "Runner-owned cleanup left an isolated listener or endpoint: $($occupied -join ', ')"
    }
    return [ordered]@{ ports = @($Ports | Sort-Object -Unique); all_released = $true }
}

function Invoke-IsolatedEvidencePreflight {
    param(
        [Parameter(Mandatory = $true)][string] $RequestedWorktreeRoot,
        [Parameter(Mandatory = $true)][string] $RequestedEvidenceRoot,
        [Parameter(Mandatory = $true)][string] $RequestedKitReleaseRoot,
        [Parameter(Mandatory = $true)][string] $RequestedExpectedKitExecutableSha256,
        [Parameter(Mandatory = $true)][string] $RequestedExpectedAppKitSha256,
        [Parameter(Mandatory = $true)][string] $RequestedStageUrlA,
        [Parameter(Mandatory = $true)][string] $RequestedStageUrlB,
        [Parameter(Mandatory = $true)][string] $RequestedStageArtifactPath,
        [Parameter(Mandatory = $true)][string] $RequestedStageSourceIfcPath,
        [Parameter(Mandatory = $true)][string] $RequestedCoordinatorBaseUrl,
        [Parameter(Mandatory = $true)][string] $RequestedAuthorityIngressBaseUrl,
        [Parameter(Mandatory = $true)][int] $RequestedKitSignalPort,
        [Parameter(Mandatory = $true)][int] $RequestedKitMediaPort
    )

    $resolvedWorktreeRoot = [System.IO.Path]::GetFullPath(
        (Resolve-Path -LiteralPath $RequestedWorktreeRoot -ErrorAction Stop).Path
    ).TrimEnd('\')
    $currentRoot = [System.IO.Path]::GetFullPath((Get-Location).Path).TrimEnd('\')
    if (-not (Test-SamePath -Left $resolvedWorktreeRoot -Right $currentRoot)) {
        throw 'Run isolated host-native evidence only from the explicitly supplied worktree root.'
    }
    Assert-NoReparsePointPath -Path $resolvedWorktreeRoot

    $resolvedEvidenceRoot = [System.IO.Path]::GetFullPath($RequestedEvidenceRoot).TrimEnd('\')
    if (-not (Test-PathContained -Candidate $resolvedEvidenceRoot -Root $resolvedWorktreeRoot) `
        -or (Test-SamePath -Left $resolvedEvidenceRoot -Right $resolvedWorktreeRoot)) {
        throw 'EvidenceRoot must be a child path contained by WorktreeRoot.'
    }
    Assert-NoReparsePointPath -Path $resolvedEvidenceRoot
    $kitPaths = Get-IsolatedKitRuntimePaths `
        -ResolvedWorktreeRoot $resolvedWorktreeRoot `
        -RequestedReleaseRoot $RequestedKitReleaseRoot `
        -ExpectedKitExecutableSha256 $RequestedExpectedKitExecutableSha256 `
        -ExpectedAppKitSha256 $RequestedExpectedAppKitSha256

    $resolvedStageArtifactPath = [IO.Path]::GetFullPath(
        (Resolve-Path -LiteralPath $RequestedStageArtifactPath -ErrorAction Stop).Path
    )
    Assert-NoReparsePointPath -Path $resolvedStageArtifactPath
    $stageArtifactItem = Get-Item -LiteralPath $resolvedStageArtifactPath -ErrorAction Stop
    if (-not $stageArtifactItem.PSIsContainer `
        -and $stageArtifactItem.Extension -ceq '.usdc' `
        -and [int64]$stageArtifactItem.Length -gt 8 `
        -and [int64]$stageArtifactItem.Length -le $script:StageArtifactMaxBytes) {
        $stageHeader = [byte[]]::new(8)
        $stageStream = [IO.File]::Open($resolvedStageArtifactPath, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
        try {
            if ($stageStream.Read($stageHeader, 0, $stageHeader.Length) -ne $stageHeader.Length `
                -or [Text.Encoding]::ASCII.GetString($stageHeader) -cne 'PXR-USDC') {
                throw 'StageArtifactPath is not a binary USDC artifact.'
            }
        }
        finally {
            $stageStream.Dispose()
        }
    }
    else {
        throw 'StageArtifactPath must be a non-empty .usdc file within the 512 MiB runtime cap.'
    }
    $stageArtifactSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $resolvedStageArtifactPath).Hash
    if ($stageArtifactSha256 -cne $script:KnownStageArtifactSha256) {
        throw 'StageArtifactPath must match the reviewed repo-local renderable USDC fixture.'
    }

    $resolvedStageSourceIfcPath = [IO.Path]::GetFullPath(
        (Resolve-Path -LiteralPath $RequestedStageSourceIfcPath -ErrorAction Stop).Path
    )
    Assert-NoReparsePointPath -Path $resolvedStageSourceIfcPath
    $sourceIfcItem = Get-Item -LiteralPath $resolvedStageSourceIfcPath -ErrorAction Stop
    if ($sourceIfcItem.PSIsContainer -or $sourceIfcItem.Extension -cne '.ifc' -or [int64]$sourceIfcItem.Length -le 16) {
        throw 'StageSourceIfcPath must be a non-empty IFC source file.'
    }
    $sourceIfcHeader = [byte[]]::new(13)
    $sourceIfcStream = [IO.File]::Open($resolvedStageSourceIfcPath, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
    try {
        if ($sourceIfcStream.Read($sourceIfcHeader, 0, $sourceIfcHeader.Length) -ne $sourceIfcHeader.Length `
            -or [Text.Encoding]::ASCII.GetString($sourceIfcHeader) -cne 'ISO-10303-21;') {
            throw 'StageSourceIfcPath is not an ISO-10303-21 IFC source.'
        }
    }
    finally {
        $sourceIfcStream.Dispose()
    }
    $sourceIfcSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $resolvedStageSourceIfcPath).Hash
    if ($sourceIfcSha256 -cne $script:KnownStageSourceIfcSha256) {
        throw 'StageSourceIfcPath must match the reviewed source IFC fixture.'
    }

    $stageA = Resolve-AbsoluteHttpUrl -Value $RequestedStageUrlA -Name 'StageUrlA'
    $stageB = Resolve-AbsoluteHttpUrl -Value $RequestedStageUrlB -Name 'StageUrlB'
    if ($stageA.Scheme -cne 'http' -or $stageA.Host -cne '127.0.0.1' `
        -or $stageB.Scheme -cne 'http' -or $stageB.Host -cne 'localhost' `
        -or $stageA.Port -ne $script:RunnerOwnedStagePort -or $stageB.Port -ne $script:RunnerOwnedStagePort `
        -or $stageA.PathAndQuery -cne '/model.usdc' -or $stageB.PathAndQuery -cne '/model.usdc') {
        throw 'StageUrlA/B must name the runner-owned /model.usdc through 127.0.0.1:49081 and localhost:49081.'
    }
    if ($RequestedCoordinatorBaseUrl -cne 'http://127.0.0.1:8005') {
        throw 'CoordinatorBaseUrl must be exactly http://127.0.0.1:8005.'
    }
    if ($RequestedAuthorityIngressBaseUrl -cne 'http://127.0.0.1:8006') {
        throw 'AuthorityIngressBaseUrl must be exactly http://127.0.0.1:8006.'
    }
    if ($RequestedKitSignalPort -ne 49131 -or $RequestedKitMediaPort -ne 48031) {
        throw 'The isolated Kit ports must be exactly signal=49131 and media=48031.'
    }
    Assert-IsolatedKitPortPolicy -SignalPort $RequestedKitSignalPort -MediaPort $RequestedKitMediaPort
    Assert-ProbePortAllowed -Name 'StageServerPort' -Port $script:RunnerOwnedStagePort
    Assert-ProbePortFree -Name 'StageServerPort' -Port $script:RunnerOwnedStagePort
    $dynamicTcpRanges = @(Get-NativeDynamicTcpPortRanges)
    if (@($dynamicTcpRanges | Where-Object {
        $script:RunnerOwnedStagePort -ge [int]$_.start_port `
            -and $script:RunnerOwnedStagePort -le [int]$_.end_port
    }).Count -gt 0) {
        throw 'The runner-owned stage port overlaps a configured Windows dynamic TCP range.'
    }

    # This list intentionally excludes every deployment-owned port, especially 49100.
    $isolatedPorts = @(8005, 8006, $script:RunnerOwnedStagePort, $RequestedKitSignalPort, $RequestedKitMediaPort)
    $nativeListeners = @(Get-NativeBoundPortOwners -Ports $isolatedPorts)
    $cmdletListeners = @()
    foreach ($port in $isolatedPorts) {
        $cmdletListeners += @(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)
        $cmdletListeners += @(Get-NetUDPEndpoint -LocalPort $port -ErrorAction SilentlyContinue)
    }
    if ($nativeListeners.Count -gt 0 -or $cmdletListeners.Count -gt 0) {
        $occupied = @(
            @($nativeListeners | ForEach-Object { [int]$_.port }) +
            @($cmdletListeners | ForEach-Object { [int]$_.LocalPort })
        ) | Sort-Object -Unique
        throw "An isolated evidence port is already owned by another process: $($occupied -join ', '). No process was stopped."
    }

    $gitSafeDirectory = Get-GitSafeDirectoryArgument -Path $resolvedWorktreeRoot
    $headSha = (& git -c $gitSafeDirectory -C $resolvedWorktreeRoot rev-parse HEAD 2>$null | Out-String).Trim()
    if ($LASTEXITCODE -ne 0 -or $headSha -notmatch '^[0-9a-f]{40}$') {
        throw 'Unable to establish the isolated worktree HEAD.'
    }
    $trackedStatus = (& git -c $gitSafeDirectory -C $resolvedWorktreeRoot status --short 2>$null | Out-String).Trim()
    if ($LASTEXITCODE -ne 0) { throw 'Unable to establish isolated worktree cleanliness.' }

    return [pscustomobject]@{
        status = 'preflight_passed'
        worktree_root = $resolvedWorktreeRoot
        evidence_root = $resolvedEvidenceRoot
        kit_paths = $kitPaths
        stage_artifact = [ordered]@{
            source_path = $resolvedStageArtifactPath
            sha256 = $stageArtifactSha256
            length = [int64]$stageArtifactItem.Length
            max_bytes = $script:StageArtifactMaxBytes
            classification = 'known_repo_local_renderable_fixture_not_current_worker_produced'
            source_ifc_path = $resolvedStageSourceIfcPath
            source_ifc_sha256 = $sourceIfcSha256
            source_ifc_length = [int64]$sourceIfcItem.Length
            provenance_refs = @(
                'docs/verification/2026-05-08-spec-end-to-end-verification.md',
                'docs/verification/2026-05-11-worker-real-conversion-quality.md',
                'bim-streaming-server/docs/plan-bim-ifc-usd-streaming-2026-04-27.md'
            )
        }
        head_sha = $headSha
        tracked_clean = [string]::IsNullOrWhiteSpace($trackedStatus)
        coordinator_base = $RequestedCoordinatorBaseUrl
        authority_ingress_base = $RequestedAuthorityIngressBaseUrl
        kit_signal_port = $RequestedKitSignalPort
        kit_media_port = $RequestedKitMediaPort
        stage_hosts = @($stageA.Authority, $stageB.Authority)
        deployment_ports_controlled = @()
        runner_owned_stage_port = $script:RunnerOwnedStagePort
        dynamic_tcp_ranges = $dynamicTcpRanges
    }
}

$isolatedPreflight = Invoke-IsolatedEvidencePreflight `
    -RequestedWorktreeRoot $WorktreeRoot `
    -RequestedEvidenceRoot $EvidenceRoot `
    -RequestedKitReleaseRoot $KitReleaseRoot `
    -RequestedExpectedKitExecutableSha256 $ExpectedKitExecutableSha256 `
    -RequestedExpectedAppKitSha256 $ExpectedAppKitSha256 `
    -RequestedStageUrlA $StageUrlA `
    -RequestedStageUrlB $StageUrlB `
    -RequestedStageArtifactPath $StageArtifactPath `
    -RequestedStageSourceIfcPath $StageSourceIfcPath `
    -RequestedCoordinatorBaseUrl $CoordinatorBaseUrl `
    -RequestedAuthorityIngressBaseUrl $AuthorityIngressBaseUrl `
    -RequestedKitSignalPort $KitSignalPort `
    -RequestedKitMediaPort $KitMediaPort
if ($PreflightOnly) {
    $isolatedPreflight
    return
}

function Get-IsolatedGitStatus {
    param([Parameter(Mandatory = $true)][string] $ResolvedWorktreeRoot)

    $safeDirectory = Get-GitSafeDirectoryArgument -Path $ResolvedWorktreeRoot
    $status = (& git -c $safeDirectory -C $ResolvedWorktreeRoot status --porcelain 2>$null | Out-String).TrimEnd()
    if ($LASTEXITCODE -ne 0) { throw 'Unable to read isolated worktree status.' }
    return $status
}

function Invoke-IsolatedNpmCi {
    param(
        [Parameter(Mandatory = $true)][string] $ResolvedWorktreeRoot,
        [Parameter(Mandatory = $true)][string] $PackageRoot,
        [Parameter(Mandatory = $true)][string] $Name,
        [Parameter(Mandatory = $true)][string] $NodeExecutable,
        [Parameter(Mandatory = $true)][string] $NpmCli
    )

    $before = Get-IsolatedGitStatus -ResolvedWorktreeRoot $ResolvedWorktreeRoot
    Push-Location -LiteralPath $PackageRoot
    try {
        & $NodeExecutable $NpmCli ci --ignore-scripts --no-audit --no-fund 2>&1 | Out-Null
        $npmExitCode = $LASTEXITCODE
        if ($npmExitCode -ne 0) { throw "npm ci failed for isolated $Name source." }
    }
    finally {
        Pop-Location
    }
    $after = Get-IsolatedGitStatus -ResolvedWorktreeRoot $ResolvedWorktreeRoot
    if ($after -cne $before) { throw "npm ci changed tracked or visible worktree state for isolated $Name source." }
    return [ordered]@{
        name = $Name
        package_lock_sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $PackageRoot 'package-lock.json')).Hash
        worktree_status_unchanged = $true
    }
}

function New-ReservedViewerPort {
    $excluded = @(8005, 8006, 48031, 49081, 49100, 49101, 49102, 49131)
    for ($attempt = 0; $attempt -lt 20; $attempt++) {
        $reservation = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
        $reservation.Start()
        $port = [int]$reservation.LocalEndpoint.Port
        if ($port -notin $excluded) {
            return [pscustomobject]@{ listener = $reservation; port = $port }
        }
        $reservation.Stop()
    }
    throw 'Unable to reserve a viewer port outside the deployment and isolated runtime port set.'
}

function Write-RunnerOwnedNewTextFile {
    param(
        [Parameter(Mandatory = $true)][string] $Path,
        [Parameter(Mandatory = $true)][string] $Text,
        [Parameter(Mandatory = $true)][string] $RunRoot
    )

    $fullPath = [IO.Path]::GetFullPath($Path)
    if (-not (Test-PathContained -Candidate $fullPath -Root $RunRoot) `
        -or (Test-SamePath -Left $fullPath -Right $RunRoot)) {
        throw 'Runner-generated files must be children of the exact run root.'
    }
    Assert-NoReparsePointPath -Path (Split-Path -Path $fullPath -Parent)
    $encoding = [Text.UTF8Encoding]::new($false)
    $bytes = $encoding.GetBytes("$Text`n")
    $stream = $null
    $createdByRunner = $false
    try {
        $stream = [IO.File]::Open($fullPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
        $createdByRunner = $true
        $stream.Write($bytes, 0, $bytes.Length)
    }
    catch {
        if ($createdByRunner -and (Test-Path -LiteralPath $fullPath -PathType Leaf)) {
            Assert-NoReparsePointPath -Path $fullPath
            Remove-Item -LiteralPath $fullPath -Force
        }
        throw
    }
    finally {
        if ($null -ne $stream) { $stream.Dispose() }
    }
    Assert-NoReparsePointPath -Path $fullPath
    return (Get-FileHash -Algorithm SHA256 -LiteralPath $fullPath).Hash
}

function New-AuthorityIngressE2EAdapter {
    param(
        [Parameter(Mandatory = $true)][string] $TrackedSpecPath,
        [Parameter(Mandatory = $true)][string] $RunRoot,
        [Parameter(Mandatory = $true)][string] $ViewerRoot,
        [Parameter(Mandatory = $true)][int] $ViewerPort,
        [Parameter(Mandatory = $true)][string] $CoordinatorBaseUrl
    )

    $trackedSource = [IO.File]::ReadAllText($TrackedSpecPath)
    $trackedSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $TrackedSpecPath).Hash
    $replacements = @(
        [ordered]@{
            # The derived spec lives under the private evidence root, outside every
            # package, so no ancestor node_modules can resolve the bare specifier.
            from = 'import { expect, test, type Page } from "@playwright/test";'
            to = "import { expect, test, type Page } from `"$($ViewerRoot.Replace('\', '/'))/node_modules/@playwright/test`";"
        },
        [ordered]@{
            from = '  coordinator_stopped?: boolean;'
            to = "  authority_ingress_stopped?: boolean;`n  coordinator_process_stopped?: boolean;"
        },
        [ordered]@{
            from = '  coordinator_recovered?: boolean;'
            to = "  authority_ingress_recovered?: boolean;`n  coordinator_process_restarted?: boolean;"
        },
        [ordered]@{
            from = '  expect(outageGo.coordinator_stopped).toBe(true);'
            to = '  expect(outageGo).toMatchObject({ authority_ingress_stopped: true, coordinator_process_stopped: false });'
        },
        [ordered]@{
            from = '  expect(outageRecovered.coordinator_recovered).toBe(true);'
            to = '  expect(outageRecovered).toMatchObject({ authority_ingress_recovered: true, coordinator_process_restarted: false });'
        },
        [ordered]@{
            from = '      outage_handshake: "deployment-owned-coordinator",'
            to = '      outage_handshake: "runner-owned-authority-ingress",'
        },
        [ordered]@{
            from = '  // back. Hand control to the runner and wait for it to say the coordinator recovered.'
            to = '  // back. Hand control to the runner and wait for it to say the authority ingress recovered.'
        },
        [ordered]@{
            from = '  channel: "chrome",'
            to = '  executablePath: process.env.E2E_TRUSTED_CHROME_PATH,'
        },
        [ordered]@{
            from = '      `stage=${evidence.runtime.observed_stage_url}`,'
            to = '      "stage=runner-owned capability URL (expired after capture)",'
        },
        [ordered]@{
            from = '    post_merge_corrective: true,'
            to = '    dependency_source_post_merge: true,'
        }
    )
    $derivedSource = $trackedSource
    $manifest = [System.Collections.Generic.List[object]]::new()
    foreach ($replacement in $replacements) {
        $count = [regex]::Matches($derivedSource, [regex]::Escape([string]$replacement.from)).Count
        if ($count -ne 1) {
            throw 'The tracked E2E source no longer matches the exact authority-ingress adapter contract.'
        }
        $derivedSource = $derivedSource.Replace([string]$replacement.from, [string]$replacement.to)
        $manifest.Add([ordered]@{
            from = [string]$replacement.from
            to = [string]$replacement.to
            exact_count = 1
        })
    }
    foreach ($forbidden in @('coordinator_stopped', 'coordinator_recovered', 'deployment-owned-coordinator')) {
        if ($derivedSource.Contains($forbidden, [StringComparison]::Ordinal)) {
            throw 'The derived E2E source retained a legacy coordinator-outage claim.'
        }
    }

    $derivedSpecPath = Join-Path $RunRoot 'runtime-command-authority-host-native.ingress.spec.ts'
    $derivedSpecSha256 = $null
    $configPath = Join-Path $RunRoot 'playwright.authority-ingress.config.cjs'
    try {
        $derivedSpecSha256 = Write-RunnerOwnedNewTextFile -Path $derivedSpecPath `
            -Text $derivedSource -RunRoot $RunRoot

    $viewerRootJson = [string]($ViewerRoot | ConvertTo-Json -Compress)
    $runRootJson = [string]($RunRoot | ConvertTo-Json -Compress)
    $viewerOriginJson = [string]("http://127.0.0.1:$ViewerPort" | ConvertTo-Json -Compress)
    $allowedOriginsJson = [string]("$CoordinatorBaseUrl,http://127.0.0.1:$ViewerPort,http://localhost:$ViewerPort" | ConvertTo-Json -Compress)
    $coordinatorBaseJson = [string]($CoordinatorBaseUrl | ConvertTo-Json -Compress)
    $configSource = @"
// The config lives under the private evidence root, outside every package, so
// resolve @playwright/test from the viewer package explicitly.
const viewerRoot = $viewerRootJson;
const { defineConfig, devices } = require(require("node:path").join(viewerRoot, "node_modules", "@playwright", "test"));
const viewerOrigin = $viewerOriginJson;
const collectionOnly = process.env.E2E_COLLECTION_ONLY === "1";
module.exports = defineConfig({
  testDir: $runRootJson,
  testMatch: ["runtime-command-authority-host-native.ingress.spec.ts"],
  outputDir: $runRootJson,
  timeout: 300000,
  expect: { timeout: 15000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: viewerOrigin,
    trace: "off",
    screenshot: "off",
    video: "off",
    viewport: { width: 1440, height: 900 },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: collectionOnly ? undefined : [{
    command: "npm run dev -- --host 127.0.0.1 --port $ViewerPort --strictPort",
    cwd: viewerRoot,
    url: viewerOrigin,
    reuseExistingServer: false,
    timeout: 120000,
    env: {
      VITE_VIEWER_HARNESS: "1",
      VITE_COORDINATOR_API_BASE: $coordinatorBaseJson,
      VITE_ALLOWED_COORDINATOR_ORIGINS: $allowedOriginsJson,
    },
  }],
});
"@
        $configSha256 = Write-RunnerOwnedNewTextFile -Path $configPath -Text $configSource -RunRoot $RunRoot
    }
    catch {
        if (-not [string]::IsNullOrWhiteSpace([string]$derivedSpecSha256)) {
            Remove-RunnerOwnedGeneratedFile -Path $derivedSpecPath `
                -ExpectedSha256 $derivedSpecSha256 -RunRoot $RunRoot
        }
        throw
    }
    return [pscustomobject]@{
        tracked_spec_path = [IO.Path]::GetFullPath($TrackedSpecPath)
        tracked_spec_sha256 = $trackedSha256
        derived_spec_path = $derivedSpecPath
        derived_spec_sha256 = $derivedSpecSha256
        config_path = $configPath
        config_sha256 = $configSha256
        substitutions = @($manifest)
        outage_handshake = 'runner-owned-authority-ingress'
    }
}

function Remove-RunnerOwnedGeneratedFile {
    param(
        [Parameter(Mandatory = $true)][string] $Path,
        [Parameter(Mandatory = $true)][string] $ExpectedSha256,
        [Parameter(Mandatory = $true)][string] $RunRoot
    )

    $resolvedPath = [IO.Path]::GetFullPath((Resolve-Path -LiteralPath $Path -ErrorAction Stop).Path)
    if (-not (Test-PathContained -Candidate $resolvedPath -Root $RunRoot) `
        -or (Test-SamePath -Left $resolvedPath -Right $RunRoot)) {
        throw 'Refusing to remove a generated file outside the exact run root.'
    }
    Assert-NoReparsePointPath -Path $resolvedPath
    if ((Get-FileHash -Algorithm SHA256 -LiteralPath $resolvedPath).Hash -cne $ExpectedSha256) {
        throw 'Refusing to remove a runner-generated file whose content identity changed.'
    }
    Remove-Item -LiteralPath $resolvedPath -Force
}

function Remove-RunnerOwnedDirectoryTree {
    param(
        [Parameter(Mandatory = $true)][string] $Path,
        [Parameter(Mandatory = $true)][string] $RunRoot
    )

    $resolvedPath = [IO.Path]::GetFullPath((Resolve-Path -LiteralPath $Path -ErrorAction Stop).Path)
    if (-not (Test-PathContained -Candidate $resolvedPath -Root $RunRoot) `
        -or (Test-SamePath -Left $resolvedPath -Right $RunRoot)) {
        throw 'Refusing to remove a runner-owned directory outside or equal to the exact run root.'
    }
    Assert-NoReparsePointPath -Path $resolvedPath
    foreach ($item in @(Get-ChildItem -LiteralPath $resolvedPath -Recurse -Force -ErrorAction Stop)) {
        if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw "Refusing to recursively remove a runner-owned tree containing a reparse point: $($item.FullName)"
        }
    }
    Remove-Item -LiteralPath $resolvedPath -Recurse -Force
}

function Start-RunnerOwnedPlaywright {
    param(
        [Parameter(Mandatory = $true)][string] $NodeExecutable,
        [Parameter(Mandatory = $true)][string] $PlaywrightCli,
        [Parameter(Mandatory = $true)] $Adapter,
        [Parameter(Mandatory = $true)][string] $ViewerRoot,
        [Parameter(Mandatory = $true)][string] $PlaywrightOutput,
        [Parameter(Mandatory = $true)][hashtable] $Environment,
        [Parameter(Mandatory = $true)][string] $RunRoot
    )

    $arguments = @(
        $PlaywrightCli,
        # Playwright treats the positional file argument as a regex when it is not
        # slash-normalized; backslashes become escapes and the filter never matches.
        'test', ([string]$Adapter.derived_spec_path).Replace('\', '/'),
        "--config=$([string]$Adapter.config_path)",
        '--output', $PlaywrightOutput
    )
    return Start-RunnerOwnedChild -Role 'playwright' -Executable $NodeExecutable `
        -Arguments $arguments -WorkingDirectory $ViewerRoot -Environment $Environment `
        -RunDirectory (Join-Path $RunRoot 'processes') `
        -Entrypoint (([string]$Adapter.derived_spec_path).Replace('\', '/')) -NoPersistedOutput
}

function Test-RunnerOwnedPlaywrightCollection {
    param(
        [Parameter(Mandatory = $true)][string] $NodeExecutable,
        [Parameter(Mandatory = $true)][string] $PlaywrightCli,
        [Parameter(Mandatory = $true)] $Adapter,
        [Parameter(Mandatory = $true)][string] $ViewerRoot,
        [Parameter(Mandatory = $true)][string] $ViewerNodeModules,
        [Parameter(Mandatory = $true)][string] $RunRoot
    )

    $identity = Start-RunnerOwnedChild -Role 'playwright-collection' -Executable $NodeExecutable `
        -Arguments @(
            $PlaywrightCli,
            # Slash-normalized for the same regex-vs-path reason as the live run.
            'test', ([string]$Adapter.derived_spec_path).Replace('\', '/'),
            "--config=$([string]$Adapter.config_path)",
            '--list'
        ) `
        -WorkingDirectory $ViewerRoot `
        -Environment @{ NODE_PATH = $ViewerNodeModules; E2E_COLLECTION_ONLY = '1' } `
        -RunDirectory (Join-Path $RunRoot 'processes') `
        -Entrypoint (([string]$Adapter.derived_spec_path).Replace('\', '/')) -NoPersistedOutput -AllowCleanFastExit
    try {
        Wait-ForProcessExit -Process $identity.process_handle -TimeoutSeconds 60
        if ($identity.process_handle.ExitCode -ne 0) {
            throw 'The derived authority-ingress Playwright spec could not be collected.'
        }
        return [ordered]@{
            derived_spec_collected = $true
            exit_code = 0
        }
    }
    catch {
        $collectionFailure = $_.Exception.Message
        if (-not $identity.process_handle.HasExited) {
            try { $null = Stop-RunnerOwnedChild -Identity $identity }
            catch {
                throw "Playwright collection failed: $collectionFailure Cleanup also failed: $($_.Exception.Message)"
            }
        }
        throw "Playwright collection failed: $collectionFailure"
    }
}

function Assert-RunnerOwnedChildLive {
    param([Parameter(Mandatory = $true)] $Identity)

    $actual = Get-IsolatedProcessIdentity -ProcessId ([int]$Identity.pid) -Entrypoint ([string]$Identity.entrypoint)
    if (-not (Test-IsolatedProcessOwnership -Expected $Identity -Actual $actual) `
        -or -not (Test-SamePath -Left ([string]$actual.executable_path) -Right ([string]$Identity.expected_executable_path))) {
        throw "Runner-owned $($Identity.role) identity changed during evidence capture."
    }
    return $actual
}

function ConvertTo-RunnerOwnedIdentityEvidence {
    param([Parameter(Mandatory = $true)] $Identity)

    return [ordered]@{
        role = [string]$Identity.role
        process_id = [int]$Identity.pid
        creation_identity = [string]$Identity.creation_identity
        executable_path = [string]$Identity.executable_path
        entrypoint = [string]$Identity.entrypoint
        stdout_path = [string]$Identity.stdout_path
        stderr_path = [string]$Identity.stderr_path
    }
}

function Assert-DataChannelTerminal {
    param(
        [Parameter(Mandatory = $true)] $Terminal,
        [Parameter(Mandatory = $true)][string] $ExpectedRequestId,
        [Parameter(Mandatory = $true)][string] $ExpectedSessionId,
        [Parameter(Mandatory = $true)][string[]] $ExpectedEventTypes
    )

    if ([string]::IsNullOrWhiteSpace($ExpectedRequestId) `
        -or [string]::IsNullOrWhiteSpace($ExpectedSessionId)) {
        throw 'A normalized case has an empty request or session correlation ID.'
    }
    if ($null -eq $Terminal -or $null -eq $Terminal.payload) { throw 'A normalized case is missing its DataChannel terminal.' }
    if ([string]$Terminal.event_type -notin $ExpectedEventTypes) { throw 'A normalized case has an unexpected DataChannel terminal type.' }
    $terminalRequestId = [string]$Terminal.payload.request_id
    if ([string]::IsNullOrWhiteSpace($terminalRequestId) -or $terminalRequestId -cne $ExpectedRequestId) {
        throw 'A normalized case terminal request ID is empty or does not match.'
    }
    $terminalSessionId = [string]$Terminal.payload.session_id
    if (-not [string]::IsNullOrWhiteSpace($terminalSessionId) -and $terminalSessionId -cne $ExpectedSessionId) {
        throw 'A normalized case terminal session ID does not match.'
    }
}

function ConvertTo-PublishedTerminalEvidence {
    param(
        [Parameter(Mandatory = $true)] $Terminal,
        [Parameter(Mandatory = $true)][string] $ExpectedStageUrl,
        [Parameter(Mandatory = $true)][string] $PublishedStageUrl
    )

    $payload = [ordered]@{}
    foreach ($key in @(
        'request_id', 'session_id', 'trace_id', 'result', 'reason', 'detail_code',
        'retryable', 'runtime_state', 'rejection_id', 'rejected_event_type', 'url',
        'binding_revision_id'
    )) {
        if ($null -ne $Terminal.payload.PSObject.Properties[$key]) {
            $value = $Terminal.payload.$key
            if ($key -ceq 'url' -and [string]$value -ceq $ExpectedStageUrl) { $value = $PublishedStageUrl }
            $payload[$key] = $value
        }
    }
    return [ordered]@{
        event_type = [string]$Terminal.event_type
        payload = $payload
        payload_projection = 'strict_runtime_authority_evidence_allowlist'
    }
}

function ConvertTo-NineCaseEvidence {
    param(
        [Parameter(Mandatory = $true)] $TestEvidence,
        [Parameter(Mandatory = $true)][string] $ExpectedRuntimeId,
        [Parameter(Mandatory = $true)][int] $ExpectedRuntimePid,
        [Parameter(Mandatory = $true)][string] $ExpectedStageUrl,
        [Parameter(Mandatory = $true)][string] $PublishedStageUrl
    )

    if ([string]$TestEvidence.schema_version -cne 'runtime-command-authority-host-native-evidence/v1') {
        throw 'The source E2E evidence schema is not the reviewed v1 contract.'
    }
    if ($TestEvidence.runtime.runtime_id -cne $ExpectedRuntimeId `
        -or [int]$TestEvidence.runtime.process_id -ne $ExpectedRuntimePid `
        -or [int]$TestEvidence.runtime.signaling_port -ne 49131 `
        -or [int]$TestEvidence.runtime.media_port -ne 48031) {
        throw 'E2E runtime identity does not match the runner-owned isolated Kit.'
    }
    if ([int]$TestEvidence.runtime.first_frame.width -le 0 `
        -or [int]$TestEvidence.runtime.first_frame.height -le 0 `
        -or [int]$TestEvidence.runtime.first_frame.readyState -lt 2 `
        -or [string]$TestEvidence.runtime.observed_stage_url -cne $ExpectedStageUrl) {
        throw 'E2E first-frame or observed-stage evidence is incomplete.'
    }
    $p95Ms = [double]$TestEvidence.latency.p95_ms
    if ([int]$TestEvidence.latency.sample_count -ne 20 `
        -or [double]::IsNaN($p95Ms) -or [double]::IsInfinity($p95Ms) `
        -or $p95Ms -ge [double]$TestEvidence.latency.threshold_ms `
        -or [double]$TestEvidence.latency.threshold_ms -ne 500) {
        throw 'E2E P95 evidence does not satisfy the 20-sample, under-500ms contract.'
    }

    $common = [ordered]@{
        first_frame = [ordered]@{
            width = [int]$TestEvidence.runtime.first_frame.width
            height = [int]$TestEvidence.runtime.first_frame.height
            ready_state = [int]$TestEvidence.runtime.first_frame.readyState
        }
        runtime_id = $ExpectedRuntimeId
        p95 = [ordered]@{
            sample_count = [int]$TestEvidence.latency.sample_count
            p95_ms = $p95Ms
            threshold_ms = [double]$TestEvidence.latency.threshold_ms
        }
    }
    $primarySession = [string]$TestEvidence.sessions.primary
    $validRequestId = [string]$TestEvidence.runtime.initial_stage_request_id
    Assert-DataChannelTerminal -Terminal $TestEvidence.runtime.initial_stage_terminal `
        -ExpectedRequestId $validRequestId -ExpectedSessionId $primarySession `
        -ExpectedEventTypes @('openedStageResult')
    if ([string]$TestEvidence.runtime.initial_stage_terminal.payload.result -cne 'success') {
        throw 'The valid case did not publish a successful stage terminal.'
    }

    $cases = [ordered]@{
        valid = [ordered]@{
            outcome = 'success'
            first_frame = $common.first_frame
            observed_stage = $PublishedStageUrl
            datachannel_terminal = $(ConvertTo-PublishedTerminalEvidence `
                -Terminal $TestEvidence.runtime.initial_stage_terminal `
                -ExpectedStageUrl $ExpectedStageUrl -PublishedStageUrl $PublishedStageUrl)
            request_id = $validRequestId
            runtime_id = $common.runtime_id
            session_id = $primarySession
            p95 = $common.p95
            runtime_mutation_proof = [ordered]@{
                classification = 'confirmed_stage_change'
                zero_mutation_or_changed_unconfirmed = 'not_applicable_valid_confirmed'
                observed_stage_after = $PublishedStageUrl
            }
        }
    }

    $denialSpecs = @(
        [ordered]@{ name = 'forged'; session_id = $primarySession },
        [ordered]@{ name = 'released'; session_id = [string]$TestEvidence.sessions.released },
        [ordered]@{ name = 'expired'; session_id = [string]$TestEvidence.sessions.expired },
        [ordered]@{ name = 'wrong_source'; session_id = $primarySession },
        [ordered]@{ name = 'direct_open_wrong_session'; session_id = $primarySession },
        [ordered]@{ name = 'composition_tamper'; session_id = $primarySession }
    )
    foreach ($spec in $denialSpecs) {
        $property = $TestEvidence.denials.PSObject.Properties[[string]$spec.name]
        if ($null -eq $property) { throw "E2E evidence is missing denial case $($spec.name)." }
        $denial = $property.Value
        $requestId = [string]$denial.terminal.payload.request_id
        Assert-DataChannelTerminal -Terminal $denial.terminal -ExpectedRequestId $requestId `
            -ExpectedSessionId ([string]$spec.session_id) -ExpectedEventTypes @('commandRejected')
        if ([string]$denial.terminal.payload.runtime_state -cne 'unchanged' `
            -or [string]$denial.observed_stage_before -cne [string]$denial.observed_stage_after) {
            throw "Denial case $($spec.name) lacks zero-mutation proof."
        }
        if ([string]$spec.name -cne 'expired' `
            -and [string]$denial.observed_stage_after -cne $ExpectedStageUrl) {
            throw "Denial case $($spec.name) did not preserve the baseline stage."
        }
        $cases[[string]$spec.name] = [ordered]@{
            outcome = 'denied'
            first_frame = $common.first_frame
            observed_stage = [ordered]@{
                before = if ([string]$denial.observed_stage_before -ceq $ExpectedStageUrl) { $PublishedStageUrl } else { [string]$denial.observed_stage_before }
                after = if ([string]$denial.observed_stage_after -ceq $ExpectedStageUrl) { $PublishedStageUrl } else { [string]$denial.observed_stage_after }
            }
            datachannel_terminal = $(ConvertTo-PublishedTerminalEvidence -Terminal $denial.terminal `
                -ExpectedStageUrl $ExpectedStageUrl -PublishedStageUrl $PublishedStageUrl)
            request_id = $requestId
            runtime_id = $common.runtime_id
            session_id = [string]$spec.session_id
            p95 = $common.p95
            runtime_mutation_proof = [ordered]@{
                classification = 'zero_mutation'
                runtime_state = 'unchanged'
                observed_stage_before = if ([string]$denial.observed_stage_before -ceq $ExpectedStageUrl) { $PublishedStageUrl } else { [string]$denial.observed_stage_before }
                observed_stage_after = if ([string]$denial.observed_stage_after -ceq $ExpectedStageUrl) { $PublishedStageUrl } else { [string]$denial.observed_stage_after }
            }
        }
    }
    $cases['direct_open_wrong_session']['authorization_session_id'] = [string]$TestEvidence.sessions.wrong_session

    $outageRequestId = [string]$TestEvidence.outage.request_id
    Assert-DataChannelTerminal -Terminal $TestEvidence.outage.terminal `
        -ExpectedRequestId $outageRequestId -ExpectedSessionId $primarySession `
        -ExpectedEventTypes @('commandRejected')
    if ([string]$TestEvidence.outage.terminal.payload.detail_code -cne 'authority_unavailable' `
        -or $TestEvidence.outage.terminal.payload.retryable -ne $true `
        -or [string]$TestEvidence.outage.terminal.payload.runtime_state -cne 'unchanged' `
        -or [string]$TestEvidence.outage.observed_stage_url -cne $ExpectedStageUrl) {
        throw 'The outage case lacks retryable authority-unavailable zero-mutation proof.'
    }
    $cases['outage'] = [ordered]@{
        outcome = 'denied'
        first_frame = $common.first_frame
        observed_stage = $PublishedStageUrl
        datachannel_terminal = $(ConvertTo-PublishedTerminalEvidence -Terminal $TestEvidence.outage.terminal `
            -ExpectedStageUrl $ExpectedStageUrl -PublishedStageUrl $PublishedStageUrl)
        request_id = $outageRequestId
        runtime_id = $common.runtime_id
        session_id = $primarySession
        p95 = $common.p95
        runtime_mutation_proof = [ordered]@{
            classification = 'zero_mutation'
            runtime_state = 'unchanged'
            detail_code = 'authority_unavailable'
            retryable = $true
            observed_stage_after_recovery = $PublishedStageUrl
        }
    }

    $replayRequestIds = @($TestEvidence.concurrent_replay.request_ids | ForEach-Object { [string]$_ })
    $replayTerminals = @($TestEvidence.concurrent_replay.terminals)
    if ($replayRequestIds.Count -ne 2 `
        -or @($replayRequestIds | Sort-Object -Unique).Count -ne 2 `
        -or $replayTerminals.Count -ne 2 `
        -or [int]$TestEvidence.concurrent_replay.accepted_count -ne 1 `
        -or [int]$TestEvidence.concurrent_replay.success_terminal_count -ne 1 `
        -or [int]$TestEvidence.concurrent_replay.rejection_terminal_count -ne 1 `
        -or [string]$TestEvidence.concurrent_replay.observed_stage_url -cne $ExpectedStageUrl) {
        throw 'Concurrent replay evidence does not prove one atomic consume and one rejection.'
    }
    for ($index = 0; $index -lt 2; $index++) {
        Assert-DataChannelTerminal -Terminal $replayTerminals[$index] `
            -ExpectedRequestId $replayRequestIds[$index] -ExpectedSessionId $primarySession `
            -ExpectedEventTypes @('openedStageResult', 'commandRejected')
    }
    $replaySuccessTerminals = @($replayTerminals | Where-Object {
        [string]$_.event_type -ceq 'openedStageResult' -and [string]$_.payload.result -ceq 'success'
    })
    $replayRejectedTerminals = @($replayTerminals | Where-Object {
        [string]$_.event_type -ceq 'commandRejected' -and [string]$_.payload.runtime_state -ceq 'unchanged'
    })
    if ($replaySuccessTerminals.Count -ne 1 -or $replayRejectedTerminals.Count -ne 1) {
        throw 'Concurrent replay terminals must contain one success and one unchanged rejection.'
    }
    $cases['concurrent_replay'] = [ordered]@{
        outcome = 'mixed'
        first_frame = $common.first_frame
        observed_stage = $PublishedStageUrl
        datachannel_terminals = @($replayTerminals | ForEach-Object {
            ConvertTo-PublishedTerminalEvidence -Terminal $_ `
                -ExpectedStageUrl $ExpectedStageUrl -PublishedStageUrl $PublishedStageUrl
        })
        request_ids = $replayRequestIds
        runtime_id = $common.runtime_id
        session_id = $primarySession
        p95 = $common.p95
        runtime_mutation_proof = [ordered]@{
            classification = 'single_consume_with_rejected_peer_zero_mutation'
            accepted_count = 1
            success_terminal_count = 1
            rejection_terminal_count = 1
            duplicate_terminal_deliveries = [int]$TestEvidence.concurrent_replay.duplicate_terminal_deliveries
            observed_stage_after = $PublishedStageUrl
        }
    }

    $expectedNames = @('valid', 'forged', 'released', 'expired', 'wrong_source', 'outage', 'direct_open_wrong_session', 'composition_tamper', 'concurrent_replay')
    $actualNames = @($cases.Keys)
    if ($actualNames.Count -ne 9 -or @(Compare-Object $expectedNames $actualNames).Count -ne 0) {
        throw 'Normalized evidence does not contain exactly the required nine cases.'
    }
    return $cases
}

function Assert-InternalTokenNotPersisted {
    param(
        [Parameter(Mandatory = $true)][string] $RunRoot,
        [Parameter(Mandatory = $true)][string] $InternalAuthToken
    )

    $textExtensions = @('.json', '.log', '.mjs', '.txt')
    $redactedFiles = [Collections.Generic.List[string]]::new()
    foreach ($file in @(Get-ChildItem -LiteralPath $RunRoot -Recurse -File)) {
        if ($file.Extension.ToLowerInvariant() -notin $textExtensions) { continue }
        $text = [IO.File]::ReadAllText($file.FullName)
        if ($text.Contains($InternalAuthToken, [StringComparison]::Ordinal)) {
            $resolvedFile = [IO.Path]::GetFullPath($file.FullName)
            if (-not (Test-PathContained -Candidate $resolvedFile -Root $RunRoot)) {
                throw 'A token-bearing artifact resolved outside the exact run root.'
            }
            Assert-NoReparsePointPath -Path $resolvedFile
            [IO.File]::WriteAllText(
                $resolvedFile,
                "[REDACTED: runner-owned internal token detected]`n",
                [Text.UTF8Encoding]::new($false)
            )
            $redactedFiles.Add($resolvedFile)
        }
    }
    if ($redactedFiles.Count -gt 0) {
        throw "Runner-owned evidence artifacts persisted the internal authority token; all $($redactedFiles.Count) matches were redacted."
    }
}

function Remove-StageAccessCapabilityFromArtifacts {
    param(
        [Parameter(Mandatory = $true)][string] $RunRoot,
        [Parameter(Mandatory = $true)][string] $StageAccessCapability
    )

    $textExtensions = @('.json', '.log', '.mjs', '.cjs', '.ts', '.txt')
    $redactedCount = 0
    foreach ($file in @(Get-ChildItem -LiteralPath $RunRoot -Recurse -File -ErrorAction Stop)) {
        if ($file.Extension.ToLowerInvariant() -notin $textExtensions) { continue }
        $text = [IO.File]::ReadAllText($file.FullName)
        if (-not $text.Contains($StageAccessCapability, [StringComparison]::Ordinal)) { continue }
        Assert-NoReparsePointPath -Path $file.FullName
        [IO.File]::WriteAllText(
            $file.FullName,
            $text.Replace($StageAccessCapability, '[expired-redacted-stage-capability]', [StringComparison]::Ordinal),
            [Text.UTF8Encoding]::new($false)
        )
        $redactedCount += 1
    }
    return $redactedCount
}

$resolvedWorktreeRoot = [string]$isolatedPreflight.worktree_root
$resolvedEvidenceRoot = [string]$isolatedPreflight.evidence_root
$safeDirectory = [string]$bootstrapProvenance.safe_directory
$testedHeadSha = [string]$isolatedPreflight.head_sha
if (-not [bool]$isolatedPreflight.tracked_clean) {
    throw 'The isolated worktree must be clean before full evidence mode can run.'
}
$originMainSha = [string]$bootstrapProvenance.origin_main_sha
if ($testedHeadSha -cne [string]$bootstrapProvenance.head_sha) {
    throw 'The tested HEAD changed between bootstrap provenance and isolated preflight.'
}
$testedKitSourceTree = (& git -c $safeDirectory -C $resolvedWorktreeRoot rev-parse "${testedHeadSha}:bim-streaming-server" 2>$null | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or $testedKitSourceTree -notmatch '^[0-9a-f]{40}$') {
    throw 'Unable to establish the tested Kit source-tree identity.'
}
$originMainKitSourceTree = (& git -c $safeDirectory -C $resolvedWorktreeRoot rev-parse "${originMainSha}:bim-streaming-server" 2>$null | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or $originMainKitSourceTree -notmatch '^[0-9a-f]{40}$' `
    -or $originMainKitSourceTree -cne $testedKitSourceTree) {
    throw 'The tested Kit source tree differs from freshly fetched origin/main.'
}
$sourceStatusBeforeRuntime = Get-IsolatedGitStatus -ResolvedWorktreeRoot $resolvedWorktreeRoot
if (-not [string]::IsNullOrWhiteSpace($sourceStatusBeforeRuntime)) {
    throw 'The isolated worktree changed after its clean preflight.'
}
$evidenceRepoPath = [IO.Path]::GetRelativePath($resolvedWorktreeRoot, $resolvedEvidenceRoot).Replace('\', '/')
$null = & git -c $safeDirectory -C $resolvedWorktreeRoot check-ignore -q -- $evidenceRepoPath 2>$null
if ($LASTEXITCODE -ne 0) {
    throw 'The evidence root must be a gitignored child of the isolated worktree.'
}

$deploymentKitBefore = @(Get-NativeBoundPortOwners -Ports @(49100))
$deploymentKitPidsBefore = @($deploymentKitBefore | ForEach-Object { [int]$_.process_id } | Where-Object { $_ -gt 0 } | Sort-Object -Unique)
if ($deploymentKitPidsBefore.Count -eq 0) {
    throw 'The deployment Kit listener on :49100 was not observable; the isolated run will not start.'
}

$stageAccessCapability = [Convert]::ToHexString(
    [Security.Cryptography.RandomNumberGenerator]::GetBytes(32)
).ToLowerInvariant()
$stageUrlA = "${StageUrlA}?cap=$stageAccessCapability"
$stageUrlB = "${StageUrlB}?cap=$stageAccessCapability"
$redactedStageUrlA = "${StageUrlA}?cap=[expired-redacted]"
$redactedStageUrlB = "${StageUrlB}?cap=[expired-redacted]"

Ensure-Directory -Path $resolvedEvidenceRoot
$evidenceRootAcl = Assert-HostNativePathAcl -Path $resolvedEvidenceRoot -Mode private_evidence
$runId = "runtime-authority-e2e-$([guid]::NewGuid().ToString('N'))"
$runRoot = Join-Path $resolvedEvidenceRoot $runId
$controlDirectory = Join-Path $runRoot 'control'
$playwrightOutput = Join-Path $runRoot 'playwright-output'
Ensure-Directory -Path $runRoot
$runRootAcl = Protect-RunnerOwnedPrivateDirectory -Path $runRoot
foreach ($directory in @($controlDirectory, $playwrightOutput, (Join-Path $runRoot 'processes'))) {
    Ensure-Directory -Path $directory
    $null = Assert-HostNativePathAcl -Path $directory -Mode private_evidence
}
$controlNonce = [guid]::NewGuid().ToString('N')
$runtimeId = "isolated-host-native-$([guid]::NewGuid().ToString('N'))"
$internalAuthToken = New-RunScopedInternalApiAuthToken

$coordinatorRoot = Join-Path $resolvedWorktreeRoot 'bim-review-coordinator'
$viewerRoot = Join-Path $resolvedWorktreeRoot 'web-viewer-sample'
$executionTreeAclBefore = @(
    Assert-HostNativeTreeAcl -Root $coordinatorRoot
    Assert-HostNativeTreeAcl -Root $viewerRoot
    Assert-HostNativeTreeAcl -Root ([string]$isolatedPreflight.kit_paths.release_root)
    Assert-HostNativeTreeAcl -Root ([string]$isolatedPreflight.kit_paths.extension_source)
)
$toolchainEvidence = Get-TrustedWindowsToolchain
$nodeExecutable = [string]$toolchainEvidence.node_executable
$npmCli = [string]$toolchainEvidence.npm_cli
$dependencyEvidence = @(
    Invoke-IsolatedNpmCi -ResolvedWorktreeRoot $resolvedWorktreeRoot -PackageRoot $coordinatorRoot `
        -Name 'coordinator' -NodeExecutable $nodeExecutable -NpmCli $npmCli
    Invoke-IsolatedNpmCi -ResolvedWorktreeRoot $resolvedWorktreeRoot -PackageRoot $viewerRoot `
        -Name 'viewer' -NodeExecutable $nodeExecutable -NpmCli $npmCli
)
$tsxCli = Join-Path $coordinatorRoot 'node_modules\tsx\dist\cli.mjs'
$playwrightCli = Join-Path $viewerRoot 'node_modules\@playwright\test\cli.js'
foreach ($required in @($nodeExecutable, $tsxCli, $playwrightCli)) {
    if (-not (Test-Path -LiteralPath $required -PathType Leaf)) { throw "Required isolated runtime tool is missing: $required" }
}
$executionTreeAclAfterDependencyInstall = @(
    Assert-HostNativeTreeAcl -Root $coordinatorRoot
    Assert-HostNativeTreeAcl -Root $viewerRoot
    Assert-HostNativeTreeAcl -Root ([string]$isolatedPreflight.kit_paths.release_root)
    Assert-HostNativeTreeAcl -Root ([string]$isolatedPreflight.kit_paths.extension_source)
)

$viewerReservation = New-ReservedViewerPort
$viewerPort = [int]$viewerReservation.port
$coordinator = $null
$coordinatorIdentityEvidence = $null
$authorityIngress = $null
$authorityIngressBeforeOutage = $null
$authorityIngressAfterOutage = $null
$proxySourcePath = $null
$proxySourceSha256 = $null
$kit = $null
$kitIdentityEvidence = $null
$stageArtifactCopy = $null
$stageCacheRoot = Join-Path $runRoot 'kit\stage-cache'
$stageCacheCleanupVerified = $false
$stageServerSourcePath = $null
$stageServerSourceSha256 = $null
$stageServer = $null
$stageServerIdentityEvidence = $null
$stageServerListenerEvidence = $null
$stageProbeA = $null
$stageProbeB = $null
$e2eAdapter = $null
$adapterCleanupVerified = $false
$playwrightCollectionEvidence = $null
$e2eIdentity = $null
$e2eProcess = $null
$testEvidence = $null
$nineCases = $null
$publishedE2ESummary = $null
$resultFile = $null
$screenshotFile = $null
$preProjectionEphemeralRawSha256 = $null
$stageCapabilityRedactionCount = $null
$normalizedResultPath = Join-Path $runRoot 'runtime-command-authority-host-native.json'
$screenshotDestination = Join-Path $runRoot 'runtime-command-authority-host-native.png'
$originalFailure = $null
$cleanupFailures = [System.Collections.Generic.List[string]]::new()
$cleanupEvidence = [System.Collections.Generic.List[object]]::new()

try {
    $viewerNodeModules = Join-Path $viewerRoot 'node_modules'
    $trackedE2EPath = Join-Path $viewerRoot 'e2e\runtime-command-authority-host-native.spec.ts'
    $e2eAdapter = New-AuthorityIngressE2EAdapter -TrackedSpecPath $trackedE2EPath `
        -RunRoot $runRoot -ViewerRoot $viewerRoot -ViewerPort $viewerPort `
        -CoordinatorBaseUrl $CoordinatorBaseUrl
    $playwrightCollectionEvidence = Test-RunnerOwnedPlaywrightCollection `
        -NodeExecutable $nodeExecutable -PlaywrightCli $playwrightCli `
        -Adapter $e2eAdapter -ViewerRoot $viewerRoot `
        -ViewerNodeModules $viewerNodeModules -RunRoot $runRoot

    $stageArtifactCopy = Copy-RunnerOwnedStageArtifact `
        -SourceArtifact $isolatedPreflight.stage_artifact -RunRoot $runRoot
    $stageServerSourcePath = Join-Path $runRoot 'stage-server.mjs'
    $stageServerSourceSha256 = New-RunnerOwnedStageServerSource `
        -SourcePath $stageServerSourcePath -RunRoot $runRoot
    $stageServer = Start-RunnerOwnedStageServer -NodeExecutable $nodeExecutable `
        -ServerSourcePath $stageServerSourcePath `
        -StageArtifactPath ([string]$stageArtifactCopy.path) `
        -StageAccessCapability $stageAccessCapability -RunRoot $runRoot
    $stageServerIdentityEvidence = ConvertTo-RunnerOwnedIdentityEvidence -Identity $stageServer
    $stageServerListeners = @(Wait-RunnerOwnedTcpListener -Port $script:RunnerOwnedStagePort `
        -Identity $stageServer -TimeoutSeconds 30
    )
    if ($stageServerListeners.Count -ne 1 -or @($stageServerListeners | Where-Object {
        [string]$_.LocalAddress -cne '127.0.0.1' `
            -or [int]$_.LocalPort -ne $script:RunnerOwnedStagePort `
            -or [int]$_.OwningProcess -ne [int]$stageServer.pid
    }).Count -gt 0) {
        throw 'Runner-owned stage server must have one exact 127.0.0.1 listener owned by its pinned PID.'
    }
    $stageServerListenerEvidence = @($stageServerListeners | ForEach-Object {
        [ordered]@{
            local_address = [string]$_.LocalAddress
            local_port = [int]$_.LocalPort
            owning_process_id = [int]$_.OwningProcess
        }
    })
    if (-not (Wait-ForHttpOk -Url "http://127.0.0.1:$($script:RunnerOwnedStagePort)/health" -TimeoutSeconds 30)) {
        throw 'Runner-owned stage server did not become healthy.'
    }
    $stageProbeA = Get-HttpNoRedirectProbe -Url $stageUrlA
    $stageProbeB = Get-HttpNoRedirectProbe -Url $stageUrlB
    foreach ($probe in @($stageProbeA, $stageProbeB)) {
        if ([int]$probe.status_code -lt 200 -or [int]$probe.status_code -ge 300 `
            -or [bool]$probe.redirect_location_present `
            -or $null -eq $probe.content_length `
            -or [int64]$probe.content_length -ne [int64]$stageArtifactCopy.length) {
            throw 'Both runner-owned stage URLs must be direct 2xx responses for the exact USDC length.'
        }
    }

    $coordinatorEnvironment = New-IsolatedCoordinatorEnvironment -RunRoot $runRoot `
        -ViewerPort $viewerPort -RuntimeId $runtimeId -InternalAuthToken $internalAuthToken
    $coordinator = Start-RunnerOwnedCoordinator -ResolvedWorktreeRoot $resolvedWorktreeRoot `
        -RunRoot $runRoot -NodeExecutable $nodeExecutable -TsxCli $tsxCli `
        -Environment $coordinatorEnvironment
    $coordinatorIdentityEvidence = ConvertTo-RunnerOwnedIdentityEvidence -Identity $coordinator
    $null = Wait-RunnerOwnedTcpListener -Port 8005 -Identity $coordinator -TimeoutSeconds 60
    if (-not (Wait-ForHttpOk -Url "$CoordinatorBaseUrl/health" -TimeoutSeconds 60)) {
        throw 'Runner-owned isolated coordinator did not become healthy on :8005.'
    }

    $proxySourcePath = Join-Path $runRoot 'authority-ingress.mjs'
    $proxySourceSha256 = New-AuthorityIngressProxySource `
        -ProxyPath $proxySourcePath -RunRoot $runRoot
    $authorityIngress = Start-RunnerOwnedAuthorityIngress -NodeExecutable $nodeExecutable `
        -ProxySourcePath $proxySourcePath -RunRoot $runRoot
    $null = Wait-RunnerOwnedTcpListener -Port 8006 -Identity $authorityIngress -TimeoutSeconds 30
    if (-not (Wait-ForHttpOk -Url "$AuthorityIngressBaseUrl/health" -TimeoutSeconds 30)) {
        throw 'Runner-owned authority ingress did not become healthy on :8006.'
    }

    $kit = Start-RunnerOwnedIsolatedKit -KitPaths $isolatedPreflight.kit_paths `
        -RunRoot $runRoot `
        -RuntimeId $runtimeId -InternalAuthToken $internalAuthToken `
        -AllowedStageHosts (@($isolatedPreflight.stage_hosts) -join ',') `
        -StartedIdentity ([ref]$kit)
    $kitIdentityEvidence = ConvertTo-RunnerOwnedIdentityEvidence -Identity $kit
    $null = Assert-RunnerOwnedUdpMediaPortNotForeign -Port 48031 -Identity $kit

    $processLogPaths = @(@(
        [string]$stageServer.stdout_path, [string]$stageServer.stderr_path,
        [string]$coordinator.stdout_path, [string]$coordinator.stderr_path,
        [string]$authorityIngress.stdout_path, [string]$authorityIngress.stderr_path,
        [string]$kit.stdout_path, [string]$kit.stderr_path
    ) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
    $playwrightEnvironment = @{
        NODE_PATH = $viewerNodeModules
        E2E_HOST_NATIVE_RUNTIME_AUTHORITY = '1'
        E2E_COORDINATOR_BASE_URL = $CoordinatorBaseUrl
        E2E_KIT_SIGNAL_PORT = '49131'
        E2E_KIT_MEDIA_PORT = '48031'
        E2E_STAGE_URL_A = $stageUrlA
        E2E_STAGE_URL_B = $stageUrlB
        E2E_KIT_RUNTIME_ID = $runtimeId
        E2E_KIT_PID = [string]$kit.pid
        E2E_RUNTIME_PROCESS_LOGS = ($processLogPaths -join ';')
        E2E_RUNTIME_AUTHORITY_CONTROL_DIR = $controlDirectory
        E2E_RUNTIME_AUTHORITY_RUN_ID = $runId
        E2E_RUNTIME_AUTHORITY_CONTROL_NONCE = $controlNonce
        E2E_ORIGIN_MAIN_SHA = $originMainSha
        E2E_VIEWER_PORT = [string]$viewerPort
        E2E_TRUSTED_CHROME_PATH = [string]$toolchainEvidence.chrome_executable
    }

    $viewerReservation.listener.Stop()
    $viewerReservation = $null
    # Raw Playwright stdout/stderr is intentionally not persisted because matcher
    # diagnostics can contain bearer material. The test writes its sanitized JSON.
    $e2eIdentity = Start-RunnerOwnedPlaywright -NodeExecutable $nodeExecutable `
        -PlaywrightCli $playwrightCli -Adapter $e2eAdapter -ViewerRoot $viewerRoot `
        -PlaywrightOutput $playwrightOutput -Environment $playwrightEnvironment `
        -RunRoot $runRoot
    $e2eProcess = $e2eIdentity.process_handle

    $outageReady = Wait-ForControlMarker `
        -Path (Join-Path $controlDirectory 'outage-ready.json') `
        -RunId $runId -ControlNonce $controlNonce `
        -TimeoutSeconds ($script:PlaywrightEvidenceTimeoutSeconds + $script:PlaywrightRunnerGraceSeconds) `
        -ChildProcess $e2eProcess

    $authorityIngressBeforeOutage = $authorityIngress
    $null = Stop-RunnerOwnedChild -Identity $authorityIngress
    $authorityIngress = $null
    if (-not (Wait-ForHttpUnavailable -Url "$AuthorityIngressBaseUrl/health" -TimeoutSeconds 30)) {
        throw 'Runner-owned authority ingress did not become unavailable after its exact-owned stop.'
    }
    $null = Assert-RunnerOwnedChildLive -Identity $coordinator
    $null = Wait-RunnerOwnedTcpListener -Port 8005 -Identity $coordinator -TimeoutSeconds 5
    if (-not (Wait-ForHttpOk -Url "$CoordinatorBaseUrl/health" -TimeoutSeconds 5)) {
        throw 'Coordinator process or state was lost during the authority-ingress outage.'
    }
    Write-ControlMarker -Path (Join-Path $controlDirectory 'outage-go.json') -Marker @{
        schema_version = 'runtime-command-authority-control/v1'
        run_id = $runId
        request_id = [string]$outageReady.request_id
        control_nonce = $controlNonce
        authority_ingress_stopped = $true
        coordinator_process_stopped = $false
    }

    $null = Wait-ForControlMarker `
        -Path (Join-Path $controlDirectory 'outage-done.json') `
        -RunId $runId -ControlNonce $controlNonce `
        -TimeoutSeconds ($script:PlaywrightEvidenceTimeoutSeconds + $script:PlaywrightRunnerGraceSeconds) `
        -ChildProcess $e2eProcess
    $authorityIngress = Start-RunnerOwnedAuthorityIngress -NodeExecutable $nodeExecutable `
        -ProxySourcePath $proxySourcePath -RunRoot $runRoot
    $authorityIngressAfterOutage = $authorityIngress
    $null = Wait-RunnerOwnedTcpListener -Port 8006 -Identity $authorityIngress -TimeoutSeconds 30
    if (-not (Wait-ForHttpOk -Url "$AuthorityIngressBaseUrl/health" -TimeoutSeconds 30)) {
        throw 'Runner-owned authority ingress did not recover on :8006.'
    }
    $null = Assert-RunnerOwnedChildLive -Identity $coordinator
    $null = Wait-RunnerOwnedTcpListener -Port 8005 -Identity $coordinator -TimeoutSeconds 5
    $null = Wait-RunnerOwnedTcpListener -Port 49131 -Identity $kit -TimeoutSeconds 5 -AllowWildcardBind
    $null = Assert-RunnerOwnedUdpMediaPortNotForeign -Port 48031 -Identity $kit
    $null = Wait-RunnerOwnedTcpListener -Port $script:RunnerOwnedStagePort `
        -Identity $stageServer -TimeoutSeconds 5
    Write-ControlMarker -Path (Join-Path $controlDirectory 'outage-recovered.json') -Marker @{
        schema_version = 'runtime-command-authority-control/v1'
        run_id = $runId
        request_id = [string]$outageReady.request_id
        control_nonce = $controlNonce
        authority_ingress_recovered = $true
        coordinator_process_restarted = $false
    }

    Wait-ForProcessExit -Process $e2eProcess `
        -TimeoutSeconds ($script:PlaywrightEvidenceTimeoutSeconds + $script:PlaywrightRunnerGraceSeconds)
    if ($e2eProcess.ExitCode -ne 0) {
        throw 'The host-native Playwright case failed; inspect only its sanitized result and runner-owned process logs.'
    }
    $outageComplete = Wait-ForControlMarker `
        -Path (Join-Path $controlDirectory 'outage-complete.json') `
        -RunId $runId -ControlNonce $controlNonce -TimeoutSeconds 15 -ChildProcess $e2eProcess
    if ([string]$outageComplete.request_id -cne [string]$outageReady.request_id) {
        throw 'Outage completion marker does not match the authority-ingress outage request.'
    }

    $resultFiles = @(Get-ChildItem -LiteralPath $playwrightOutput -Recurse -Filter 'runtime-command-authority-host-native.json' -File)
    $screenshotFiles = @(Get-ChildItem -LiteralPath $playwrightOutput -Recurse -Filter 'runtime-command-authority-host-native.png' -File)
    if ($resultFiles.Count -ne 1 -or $screenshotFiles.Count -ne 1) {
        throw 'The host-native E2E did not emit exactly one sanitized JSON result and one screenshot.'
    }
    $resultFile = $resultFiles[0].FullName
    $screenshotFile = $screenshotFiles[0].FullName
    $preProjectionEphemeralRawSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $resultFile).Hash
    $testEvidence = Get-Content -LiteralPath $resultFile -Raw | ConvertFrom-Json
    if ($testEvidence.dependency_source_post_merge -ne $true `
        -or [string]$testEvidence.origin_main_sha -cne $originMainSha `
        -or [string]$testEvidence.runner_control.outage_handshake -cne 'runner-owned-authority-ingress') {
        throw 'The E2E result is missing its expected provenance or exact authority-ingress handshake.'
    }
    $nineCases = ConvertTo-NineCaseEvidence -TestEvidence $testEvidence `
        -ExpectedRuntimeId $runtimeId -ExpectedRuntimePid ([int]$kit.pid) `
        -ExpectedStageUrl $stageUrlA -PublishedStageUrl $redactedStageUrlA
    $publishedE2ESummary = [ordered]@{
        schema_version = 'runtime-command-authority-host-native-published/v1'
        source_schema_version = [string]$testEvidence.schema_version
        observed_at = [string]$testEvidence.observed_at
        origin_main_sha = [string]$testEvidence.origin_main_sha
        runner_control = [ordered]@{
            run_id = [string]$testEvidence.runner_control.run_id
            outage_handshake = [string]$testEvidence.runner_control.outage_handshake
        }
        runtime = [ordered]@{
            runtime_id = $runtimeId
            process_id = [int]$kit.pid
            signaling_port = 49131
            media_port = 48031
            first_frame = $nineCases.valid.first_frame
            observed_stage_url = $redactedStageUrlA
        }
        latency = $nineCases.valid.p95
        sessions = [ordered]@{
            primary = [string]$testEvidence.sessions.primary
            wrong_session = [string]$testEvidence.sessions.wrong_session
            released = [string]$testEvidence.sessions.released
            expired = [string]$testEvidence.sessions.expired
        }
        known_gaps = @($testEvidence.known_gaps | ForEach-Object {
            [ordered]@{
                id = [string]$_.id
                issue = [int]$_.issue
                duplicate_terminal_deliveries = [int]$_.duplicate_terminal_deliveries
            }
        })
        raw_tokens_persisted = $false
        payload_publication = 'strict_projection_no_unknown_terminal_fields'
    }
    Copy-Item -LiteralPath $screenshotFile -Destination $screenshotDestination
}
catch {
    $originalFailure = $_
}
finally {
    if ($null -ne $viewerReservation) {
        try { $viewerReservation.listener.Stop() } catch { $cleanupFailures.Add("viewer reservation: $($_.Exception.Message)") }
    }
    if ($null -ne $e2eProcess -and -not $e2eProcess.HasExited) {
        try {
            $result = Stop-RunnerOwnedChild -Identity $e2eIdentity
            $cleanupEvidence.Add([ordered]@{ role = 'playwright'; status = 'stopped' })
        }
        catch { $cleanupFailures.Add("playwright: $($_.Exception.Message)") }
    }
    if ($null -ne $e2eAdapter -and ($null -eq $e2eProcess -or $e2eProcess.HasExited)) {
        try {
            Remove-RunnerOwnedGeneratedFile -Path ([string]$e2eAdapter.derived_spec_path) `
                -ExpectedSha256 ([string]$e2eAdapter.derived_spec_sha256) -RunRoot $runRoot
            Remove-RunnerOwnedGeneratedFile -Path ([string]$e2eAdapter.config_path) `
                -ExpectedSha256 ([string]$e2eAdapter.config_sha256) -RunRoot $runRoot
            $adapterCleanupVerified = $true
            $cleanupEvidence.Add([ordered]@{ role = 'e2e_adapter'; status = 'removed_exact_files' })
        }
        catch { $cleanupFailures.Add("E2E adapter: $($_.Exception.Message)") }
    }
    if (($null -eq $e2eProcess -or $e2eProcess.HasExited) `
        -and (Test-Path -LiteralPath $playwrightOutput -PathType Container)) {
        try {
            Remove-RunnerOwnedDirectoryTree -Path $playwrightOutput -RunRoot $runRoot
            $cleanupEvidence.Add([ordered]@{ role = 'playwright_raw_output'; status = 'removed_exact_tree' })
        }
        catch { $cleanupFailures.Add("Playwright raw output: $($_.Exception.Message)") }
    }
    if ($null -ne $authorityIngress) {
        try {
            $result = Stop-RunnerOwnedChild -Identity $authorityIngress
            $cleanupEvidence.Add([ordered]@{ role = 'authority_ingress'; status = [string]$result.status })
            $authorityIngress = $null
        }
        catch { $cleanupFailures.Add("authority ingress: $($_.Exception.Message)") }
    }
    if ($null -eq $authorityIngress -and $null -ne $proxySourcePath -and $null -ne $proxySourceSha256) {
        try {
            Remove-RunnerOwnedGeneratedFile -Path $proxySourcePath `
                -ExpectedSha256 $proxySourceSha256 -RunRoot $runRoot
            $cleanupEvidence.Add([ordered]@{ role = 'authority_ingress_source'; status = 'removed_exact_file' })
        }
        catch { $cleanupFailures.Add("authority ingress source: $($_.Exception.Message)") }
    }
    if ($null -ne $kit) {
        try {
            $result = Stop-RunnerOwnedChild -Identity $kit
            $cleanupEvidence.Add([ordered]@{ role = 'kit'; status = [string]$result.status })
            $kit = $null
        }
        catch { $cleanupFailures.Add("kit: $($_.Exception.Message)") }
    }
    if ($null -ne $coordinator) {
        try {
            $result = Stop-RunnerOwnedChild -Identity $coordinator
            $cleanupEvidence.Add([ordered]@{ role = 'coordinator'; status = [string]$result.status })
            $coordinator = $null
        }
        catch { $cleanupFailures.Add("coordinator: $($_.Exception.Message)") }
    }
    if ($null -ne $stageServer) {
        try {
            $result = Stop-RunnerOwnedChild -Identity $stageServer
            $cleanupEvidence.Add([ordered]@{ role = 'stage_server'; status = [string]$result.status })
            $stageServer = $null
        }
        catch { $cleanupFailures.Add("stage server: $($_.Exception.Message)") }
    }
    if ($null -eq $stageServer -and $null -ne $stageServerSourcePath -and $null -ne $stageServerSourceSha256) {
        try {
            Remove-RunnerOwnedGeneratedFile -Path $stageServerSourcePath `
                -ExpectedSha256 $stageServerSourceSha256 -RunRoot $runRoot
            $cleanupEvidence.Add([ordered]@{ role = 'stage_server_source'; status = 'removed_exact_file' })
        }
        catch { $cleanupFailures.Add("stage server source: $($_.Exception.Message)") }
    }
    if ($null -eq $kit -and $null -eq $stageServer -and $null -ne $stageArtifactCopy) {
        try {
            $stageCacheResults = @(Remove-RunnerOwnedStageCacheArtifacts `
                -PrimaryStageUrl $stageUrlA -RejectedStageUrl $stageUrlB `
                -StageCacheRoot $stageCacheRoot `
                -ExpectedSha256 ([string]$stageArtifactCopy.sha256) `
                -ExpectedLength ([int64]$stageArtifactCopy.length) -RunRoot $runRoot `
                -RequireSuccessfulEvidence ($null -ne $nineCases))
            foreach ($stageCacheResult in $stageCacheResults) { $cleanupEvidence.Add($stageCacheResult) }
            $stageCacheCleanupVerified = $true
        }
        catch { $cleanupFailures.Add("Kit stage cache: $($_.Exception.Message)") }
    }
    if ($stageCacheCleanupVerified -and $null -ne $stageArtifactCopy) {
        try {
            $stageArtifactCopy.read_handle.Dispose()
            Remove-RunnerOwnedGeneratedFile -Path ([string]$stageArtifactCopy.path) `
                -ExpectedSha256 ([string]$stageArtifactCopy.sha256) -RunRoot $runRoot
            $cleanupEvidence.Add([ordered]@{ role = 'stage_artifact_copy'; status = 'removed_exact_file' })
        }
        catch { $cleanupFailures.Add("stage artifact copy: $($_.Exception.Message)") }
    }
    try { Assert-InternalTokenNotPersisted -RunRoot $runRoot -InternalAuthToken $internalAuthToken }
    catch { $cleanupFailures.Add("internal token persistence: $($_.Exception.Message)") }
    try {
        $stageCapabilityRedactionCount = Remove-StageAccessCapabilityFromArtifacts `
            -RunRoot $runRoot -StageAccessCapability $stageAccessCapability
        $cleanupEvidence.Add([ordered]@{
            role = 'stage_access_capability'
            status = 'expired_and_redacted'
            redacted_text_artifact_count = $stageCapabilityRedactionCount
        })
    }
    catch { $cleanupFailures.Add("stage capability redaction: $($_.Exception.Message)") }
    try {
        $releasedPortEvidence = Assert-RunnerOwnedPortsReleased -Ports @(
            8005, 8006, $script:RunnerOwnedStagePort, 49131, 48031, $viewerPort
        )
        $cleanupEvidence.Add([ordered]@{ role = 'isolated_ports'; status = 'all_released'; evidence = $releasedPortEvidence })
    }
    catch { $cleanupFailures.Add("isolated ports: $($_.Exception.Message)") }
}

if ($null -ne $originalFailure -or $cleanupFailures.Count -gt 0) {
    $message = if ($null -ne $originalFailure) { $originalFailure.Exception.Message } else { 'Runner-owned cleanup failed.' }
    if ($cleanupFailures.Count -gt 0) { $message += " Cleanup: $($cleanupFailures -join ' | ')" }
    throw $message
}

$deploymentKitAfter = @(Get-NativeBoundPortOwners -Ports @(49100))
$deploymentKitPidsAfter = @($deploymentKitAfter | ForEach-Object { [int]$_.process_id } | Where-Object { $_ -gt 0 } | Sort-Object -Unique)
if (($deploymentKitPidsAfter -join ',') -cne ($deploymentKitPidsBefore -join ',')) {
    throw 'The deployment Kit :49100 listener PID set changed during isolated evidence capture.'
}
if ($null -eq $testEvidence -or $null -eq $nineCases `
    -or $null -eq $authorityIngressBeforeOutage -or $null -eq $authorityIngressAfterOutage `
    -or $null -eq $stageServerIdentityEvidence -or $null -eq $stageServerListenerEvidence `
    -or $null -eq $stageProbeA -or $null -eq $stageProbeB) {
    throw 'The isolated host-native run did not produce complete normalized evidence.'
}
[ordered]@{
    schema_version = 'runtime-command-authority-host-native-normalized/v1'
    pre_projection_ephemeral_raw_sha256 = $preProjectionEphemeralRawSha256
    raw_source_artifact = 'removed_exact_tree_after_strict_projection'
    source_e2e = $publishedE2ESummary
    cases = $nineCases
} | ConvertTo-Json -Depth 18 | Set-Content -LiteralPath $normalizedResultPath -Encoding utf8
$sourceStatusAfterCleanup = Get-IsolatedGitStatus -ResolvedWorktreeRoot $resolvedWorktreeRoot
if (-not [string]::IsNullOrWhiteSpace($sourceStatusAfterCleanup)) {
    throw 'The isolated worktree was not clean after exact-owned runtime cleanup.'
}
$headAfterCleanup = (& git -c $safeDirectory -C $resolvedWorktreeRoot rev-parse HEAD 2>$null | Out-String).Trim()
$originMainAfterCleanup = (& git -c $safeDirectory -C $resolvedWorktreeRoot rev-parse origin/main 2>$null | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or $headAfterCleanup -cne $testedHeadSha `
    -or $originMainAfterCleanup -cne $originMainSha) {
    throw 'HEAD or the freshly fetched origin/main identity changed during evidence capture.'
}
if ((Get-FileHash -Algorithm SHA256 -LiteralPath ([string]$toolchainEvidence.node_executable)).Hash `
        -cne [string]$toolchainEvidence.node_sha256 `
    -or (Get-FileHash -Algorithm SHA256 -LiteralPath ([string]$toolchainEvidence.npm_cli)).Hash `
        -cne [string]$toolchainEvidence.npm_cli_sha256 `
    -or (Get-FileHash -Algorithm SHA256 -LiteralPath ([string]$toolchainEvidence.chrome_executable)).Hash `
        -cne [string]$toolchainEvidence.chrome_sha256) {
    throw 'A pinned Windows toolchain file changed during evidence capture.'
}

$runnerEvidence = [ordered]@{
    schema_version = 'runtime-command-authority-host-native-runner/v3'
    evidence_class = 'development_verification'
    target_role = $script:HostNativeEvidenceRole
    integrity_notes = @($script:HostNativeEvidenceIntegrityNotes)
    known_risks = @(
        [ordered]@{
            id = 'general_stage_loader_redirect_revalidation_gap'
            scope = 'product_path_outside_this_fixed_runner_owned_server'
            current_run_mitigation = 'capability URL; fixed loopback server emits no redirects; no-redirect HEAD probes'
            completion_effect = 'does_not_establish_general_product_redirect_safety'
        }
    )
    dependency_source_post_merge = $true
    tested_origin_main_sha = $originMainSha
    worktree = [ordered]@{
        root = $resolvedWorktreeRoot
        head_sha = $testedHeadSha
        freshly_fetched_origin_main_sha = $originMainSha
        origin_main_is_ancestor = $true
        reviewed_branch_delta_paths = @($bootstrapProvenance.committed_paths)
        kit_source_tree_sha = $testedKitSourceTree
        kit_source_tree_matches_origin_main = $true
        source_status_before_runtime = $sourceStatusBeforeRuntime
        source_status_after_cleanup = $sourceStatusAfterCleanup
        clean_before_and_after = $true
        evidence_root_gitignored = $true
        dependency_installs = $dependencyEvidence
        toolchain = $toolchainEvidence
        executed_tree_acls_before_dependency_install = $executionTreeAclBefore
        executed_tree_acls_after_dependency_install = $executionTreeAclAfterDependencyInstall
        bootstrap_provenance = $bootstrapProvenance
        evidence_root_acl = $evidenceRootAcl
        run_root_acl = $runRootAcl
    }
    isolation = [ordered]@{
        deployment_ports_controlled = @()
        deployment_kit_port = 49100
        deployment_kit_observation_only = $true
        deployment_kit_observation_strength = 'native_bound_port_and_pid_set_only_process_metadata_access_limited'
        runner_owned_stage_port = $script:RunnerOwnedStagePort
        dynamic_tcp_ranges = $isolatedPreflight.dynamic_tcp_ranges
        deployment_kit_process_ids_before = $deploymentKitPidsBefore
        deployment_kit_process_ids_after = $deploymentKitPidsAfter
        coordinator_base = $CoordinatorBaseUrl
        authority_ingress_base = $AuthorityIngressBaseUrl
        authority_outage_scope = 'kit-to-coordinator-authority-ingress'
        coordinator_process_retained = $true
    }
    runtime = [ordered]@{
        runtime_id = $runtimeId
        kit_release = $isolatedPreflight.kit_paths
        coordinator = $coordinatorIdentityEvidence
        kit = $kitIdentityEvidence
        stage_server = $stageServerIdentityEvidence
        kit_signal_port = 49131
        kit_media_port = 48031
    }
    authority_ingress = [ordered]@{
        before_outage = ConvertTo-RunnerOwnedIdentityEvidence -Identity $authorityIngressBeforeOutage
        after_outage = ConvertTo-RunnerOwnedIdentityEvidence -Identity $authorityIngressAfterOutage
        exact_owned_stop_and_restart = $true
    }
    stage = [ordered]@{
        source = $redactedStageUrlA
        stage_url_a = $redactedStageUrlA
        stage_url_b = $redactedStageUrlB
        access_capability = 'expired_and_redacted_after_exact_owned_stage_server_stop'
        source_kind = 'runner_owned_loopback_copy_of_caller_supplied_usdc'
        source_artifact = $isolatedPreflight.stage_artifact
        served_artifact_sha256 = [string]$stageArtifactCopy.sha256
        served_artifact_length = [int64]$stageArtifactCopy.length
        generated_server_source_sha256 = $stageServerSourceSha256
        listener = $stageServerListenerEvidence
        cache_cleanup_verified = $stageCacheCleanupVerified
        no_redirect_probe = [ordered]@{
            url_a = $stageProbeA
            url_b = $stageProbeB
            same_content_length = $true
        }
    }
    source_e2e = [ordered]@{
        schema_version = 'runtime-command-authority-host-native-evidence/v1'
        pre_projection_ephemeral_raw_sha256 = $preProjectionEphemeralRawSha256
        raw_source_artifact = 'removed_exact_tree_after_strict_projection'
        adapter_applied = $true
        emitted_outage_handshake = [string]$e2eAdapter.outage_handshake
        tracked_spec_sha256 = [string]$e2eAdapter.tracked_spec_sha256
        derived_spec_sha256 = [string]$e2eAdapter.derived_spec_sha256
        generated_config_sha256 = [string]$e2eAdapter.config_sha256
        substitutions = @($e2eAdapter.substitutions)
        collection = $playwrightCollectionEvidence
        generated_files_removed_exactly = $adapterCleanupVerified
    }
    cases = $nineCases
    e2e = $publishedE2ESummary
    cleanup = [ordered]@{
        exact_owned_children_stopped = $true
        results = @($cleanupEvidence)
    }
    artifact_policy = [ordered]@{
        raw_playwright_stdout_persisted = $false
        raw_tokens_persisted = $false
        stage_capability_persisted = $false
        stage_capability_redacted_text_artifact_count = $stageCapabilityRedactionCount
        playwright_trace = 'disabled_to_avoid_bearer_capture'
    }
}
Assert-InternalTokenNotPersisted -RunRoot $runRoot -InternalAuthToken $internalAuthToken
$runnerEvidenceJson = $runnerEvidence | ConvertTo-Json -Depth 20
if ($runnerEvidenceJson.Contains($internalAuthToken, [StringComparison]::Ordinal)) {
    throw 'The normalized runner evidence contains the internal authority token.'
}
if ($runnerEvidenceJson.Contains($stageAccessCapability, [StringComparison]::Ordinal)) {
    throw 'The normalized runner evidence contains the expired stage access capability.'
}
$runnerEvidenceJson | Set-Content -LiteralPath (Join-Path $runRoot 'runner-evidence.json') -Encoding utf8
Write-Host "Host-native runtime authority evidence passed: $runRoot"
