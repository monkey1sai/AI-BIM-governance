# scripts/lib/deploy-target-registry.ps1
# Deploy target registry: public source of truth for reviewed target behaviour.
# Exact canonical Linux location/topology is resolved from owner-controlled
# inventory outside the repository (decision D-8 / plan §6.1 policy A).
#
# Spike findings are encoded as schema-level invariants so they cannot regress:
# - F-1: linux_host_native targets MUST launch Kit with --no-window (headless Linux
#   crashes in carb.windowing-glfw -> IAppWindow::startup otherwise).
# - F-2: linux_host_native targets MUST run restore-exec-bits after clone (a
#   Windows-authored checkout carries 100644 for *.sh, and repo.sh execs python.sh).
# reserved_kinds documents planned-but-unimplemented kinds (e.g. linux_container for
# the phase-2 official containerized Kit); targets may not use them.

Set-StrictMode -Version Latest

$script:DeployTargetKinds = @('windows_host_native', 'linux_host_native')
$script:DeployTargetRoles = @('canonical_test_deploy', 'on_demand_platform_verification')
$script:DeployTargetInventoryEnvName = 'AI_BIM_DEPLOY_TARGET_INVENTORY'
$script:DeployTargetPrivateLocationFields = @(
    'deploy_root', 'runtime_data_root', 'public_host', 'edge_site_id', 'host_native_bind_host'
)

function Test-DeployTargetPrivateInventoryRequired {
    param([Parameter(Mandatory = $true)] $Target)
    $property = $Target.PSObject.Properties['private_inventory_required']
    return ($null -ne $property -and [bool]$property.Value)
}

function Assert-DeployTargetPrivateValue {
    param(
        [Parameter(Mandatory = $true)][AllowEmptyString()][string] $Value,
        [Parameter(Mandatory = $true)][string] $Field
    )
    if ([string]::IsNullOrWhiteSpace($Value)) {
        throw "deploy_target_registry: private inventory must define $Field."
    }
    # Values enter a single-quoted remote shell template. Reject quotes and
    # control characters at the trust boundary rather than attempting escaping.
    if ($Value -match '[\x00-\x1F\x7F''"]') {
        throw "deploy_target_registry: private inventory field $Field contains unsafe characters."
    }
}

function ConvertTo-NormalizedDeployTargetPosixRoot {
    param(
        [Parameter(Mandatory = $true)][string] $Value,
        [Parameter(Mandatory = $true)][string] $Field
    )
    if ($Value -eq '/' -or -not $Value.StartsWith('/') -or $Value.Contains('\')) {
        throw "deploy_target_registry: private inventory $Field must be a non-root absolute POSIX path."
    }
    $segments = @($Value.Substring(1).Split('/'))
    if ($segments.Count -eq 0 -or @($segments | Where-Object { $_ -in @('', '.', '..') }).Count -gt 0) {
        throw "deploy_target_registry: private inventory $Field must be normalized without empty, dot, or dot-dot segments."
    }
    return '/' + ($segments -join '/')
}

function Resolve-DeployTargetPrivateInventory {
    param(
        [Parameter(Mandatory = $true)] $Target,
        [Alias('TargetLocalPath')][string] $InventoryPath = ''
    )
    if (-not (Test-DeployTargetPrivateInventoryRequired -Target $Target)) { return $Target }
    if ([string]::IsNullOrWhiteSpace($InventoryPath)) {
        $InventoryPath = [Environment]::GetEnvironmentVariable($script:DeployTargetInventoryEnvName, 'Process')
    }
    if ([string]::IsNullOrWhiteSpace($InventoryPath)) {
        throw "deploy_target_registry: target '$($Target.id)' requires owner-controlled private inventory via -InventoryPath or $script:DeployTargetInventoryEnvName."
    }
    if (-not [IO.Path]::IsPathRooted($InventoryPath)) {
        throw 'deploy_target_registry: private inventory path must be absolute and outside the repository.'
    }

    $fullInventoryPath = [IO.Path]::GetFullPath($InventoryPath)
    $repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..')).TrimEnd('\', '/')
    $comparison = if ([IO.Path]::DirectorySeparatorChar -eq '\') { [StringComparison]::OrdinalIgnoreCase } else { [StringComparison]::Ordinal }
    $repoPrefix = $repoRoot + [IO.Path]::DirectorySeparatorChar
    if ($fullInventoryPath.Equals($repoRoot, $comparison) -or $fullInventoryPath.StartsWith($repoPrefix, $comparison)) {
        throw 'deploy_target_registry: private inventory must remain outside the repository.'
    }
    if (-not (Test-Path -LiteralPath $fullInventoryPath -PathType Leaf)) {
        throw 'deploy_target_registry: private inventory file was not found.'
    }
    try { $inventory = Get-Content -LiteralPath $fullInventoryPath -Raw | ConvertFrom-Json }
    catch { throw 'deploy_target_registry: private inventory is not valid JSON.' }
    if ([string]$inventory.schema_version -ne 'deploy-target-private-inventory/v1') {
        throw 'deploy_target_registry: private inventory has an unsupported schema_version.'
    }
    $matches = @($inventory.targets | Where-Object { [string]$_.id -eq [string]$Target.id })
    if ($matches.Count -ne 1) {
        throw "deploy_target_registry: private inventory must contain exactly one mapping for target '$($Target.id)'."
    }
    $mapping = $matches[0]
    $allowedFields = @('id', 'connection') + $script:DeployTargetPrivateLocationFields
    foreach ($property in $mapping.PSObject.Properties) {
        if ([string]$property.Name -notin $allowedFields) {
            throw 'deploy_target_registry: private inventory attempted to override a non-location field.'
        }
    }
    if ($null -eq $mapping.connection) {
        throw 'deploy_target_registry: private inventory must define connection host and user.'
    }
    foreach ($property in $mapping.connection.PSObject.Properties) {
        if ([string]$property.Name -notin @('host', 'user')) {
            throw 'deploy_target_registry: private inventory connection may only define host and user.'
        }
    }

    $resolved = $Target | ConvertTo-Json -Depth 10 | ConvertFrom-Json
    $resolved | Add-Member -NotePropertyName connection -NotePropertyValue ([pscustomobject]@{
        type = [string]$Target.connection.type
        host = [string]$mapping.connection.host
        user = [string]$mapping.connection.user
    }) -Force
    foreach ($field in $script:DeployTargetPrivateLocationFields) {
        $resolved | Add-Member -NotePropertyName $field -NotePropertyValue ([string]$mapping.$field) -Force
    }

    Assert-DeployTargetPrivateValue -Value ([string]$resolved.connection.host) -Field 'connection.host'
    Assert-DeployTargetPrivateValue -Value ([string]$resolved.connection.user) -Field 'connection.user'
    if ([string]$resolved.connection.host -notmatch '^[A-Za-z0-9][A-Za-z0-9._:-]{0,252}$') {
        throw 'deploy_target_registry: private inventory connection.host has an invalid shape.'
    }
    if ([string]$resolved.connection.user -notmatch '^[A-Za-z_][A-Za-z0-9._-]{0,63}$') {
        throw 'deploy_target_registry: private inventory connection.user has an invalid shape.'
    }
    foreach ($field in $script:DeployTargetPrivateLocationFields) {
        Assert-DeployTargetPrivateValue -Value ([string]$resolved.$field) -Field $field
    }
    if ([string]$resolved.public_host -notmatch '^[A-Za-z0-9][A-Za-z0-9._:-]{0,252}$') {
        throw 'deploy_target_registry: private inventory public_host has an invalid shape.'
    }
    if ([string]$resolved.edge_site_id -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$') {
        throw 'deploy_target_registry: private inventory edge_site_id has an invalid shape.'
    }
    if ([string]$resolved.host_native_bind_host -notmatch '^[A-Za-z0-9][A-Za-z0-9._:-]{0,252}$' -or
        [string]$resolved.host_native_bind_host -in @('0.0.0.0', '::', '[::]')) {
        throw 'deploy_target_registry: private inventory host_native_bind_host must be a non-wildcard host address.'
    }
    $deployRoot = ConvertTo-NormalizedDeployTargetPosixRoot -Value ([string]$resolved.deploy_root) -Field 'deploy_root'
    $runtimeDataRoot = ConvertTo-NormalizedDeployTargetPosixRoot -Value ([string]$resolved.runtime_data_root) -Field 'runtime_data_root'
    if ($runtimeDataRoot -eq $deployRoot -or $runtimeDataRoot.StartsWith("$deployRoot/", [StringComparison]::Ordinal)) {
        throw 'deploy_target_registry: runtime_data_root must remain outside deploy_root.'
    }
    $resolved.deploy_root = $deployRoot
    $resolved.runtime_data_root = $runtimeDataRoot
    return $resolved
}

function Get-DeployTargetRegistry {
    param([string] $Path = '')

    if ([string]::IsNullOrWhiteSpace($Path)) {
        $Path = Join-Path (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path 'deploy-target-registry.json'
    }
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "deploy_target_registry: registry not found at $Path"
    }
    try {
        $registry = Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
    } catch {
        throw "deploy_target_registry: registry is not valid JSON: $($_.Exception.Message)"
    }

    if ([string]$registry.schema_version -ne 'deploy-target-registry/v1') {
        throw "deploy_target_registry: unsupported schema_version '$($registry.schema_version)'."
    }
    $reservedKinds = @()
    if ($null -ne $registry.PSObject.Properties['reserved_kinds']) { $reservedKinds = @($registry.reserved_kinds) }
    $targets = @($registry.targets)
    if ($targets.Count -eq 0) { throw 'deploy_target_registry: targets must not be empty.' }

    $seen = @{}
    $canonicalCount = 0
    foreach ($target in $targets) {
        $id = [string]$target.id
        if ($id -notmatch '^[a-z0-9][a-z0-9-]{2,63}$') {
            throw "deploy_target_registry: target id '$id' must be kebab-case (3-64 chars)."
        }
        if ($seen.ContainsKey($id)) { throw "deploy_target_registry: duplicate target id '$id'." }
        $seen[$id] = $true

        $kind = [string]$target.kind
        if ($kind -in $reservedKinds) {
            throw "deploy_target_registry: target '$id' uses reserved kind '$kind' (schema slot only; not implemented)."
        }
        if ($kind -notin $script:DeployTargetKinds) {
            throw "deploy_target_registry: target '$id' kind '$kind' is not a supported kind ($($script:DeployTargetKinds -join ', '))."
        }
        if ([string]$target.role -notin $script:DeployTargetRoles) {
            throw "deploy_target_registry: target '$id' role '$($target.role)' is not a supported role ($($script:DeployTargetRoles -join ', '))."
        }
        if ([string]$target.role -eq 'canonical_test_deploy') { $canonicalCount++ }

        $connection = $target.connection
        $connectionType = [string]$connection.type
        if ($connectionType -notin @('local', 'ssh')) {
            throw "deploy_target_registry: target '$id' connection.type must be local or ssh."
        }
        $privateInventoryRequired = Test-DeployTargetPrivateInventoryRequired -Target $target
        if ($privateInventoryRequired) {
            if ($connectionType -ne 'ssh') {
                throw "deploy_target_registry: private target '$id' must use connection.type=ssh."
            }
            foreach ($propertyName in @('host', 'user')) {
                if ($null -ne $connection.PSObject.Properties[$propertyName]) {
                    throw "deploy_target_registry: private target '$id' must not publish connection.$propertyName."
                }
            }
            foreach ($field in $script:DeployTargetPrivateLocationFields) {
                if ($null -ne $target.PSObject.Properties[$field]) {
                    throw "deploy_target_registry: private target '$id' must not publish $field."
                }
            }
        } elseif ($connectionType -eq 'ssh') {
            if ([string]::IsNullOrWhiteSpace([string]$connection.host) -or [string]::IsNullOrWhiteSpace([string]$connection.user)) {
                throw "deploy_target_registry: target '$id' ssh connection requires host and user."
            }
        }

        foreach ($field in @('env_file')) {
            if ([string]::IsNullOrWhiteSpace([string]$target.$field)) {
                throw "deploy_target_registry: target '$id' must define $field."
            }
        }
        if ($privateInventoryRequired) {
            if ([string]$target.env_file -notmatch '^\.env[.A-Za-z0-9_-]+$') {
                throw "deploy_target_registry: target '$id' env_file must be a repo-root dotenv filename."
            }
        } else {
            foreach ($field in $script:DeployTargetPrivateLocationFields) {
                if ([string]::IsNullOrWhiteSpace([string]$target.$field)) {
                    throw "deploy_target_registry: target '$id' must define $field."
                }
            }
            $hostNativeBindHost = [string]$target.host_native_bind_host
            if ($hostNativeBindHost -in @('0.0.0.0', '::', '[::]')) {
                throw "deploy_target_registry: target '$id' host_native_bind_host must be a target-scoped interface, not wildcard '$hostNativeBindHost'."
            }
            switch ($kind) {
                'windows_host_native' {
                    foreach ($rootField in @('deploy_root', 'runtime_data_root')) {
                        if ([string]$target.$rootField -notmatch '^[A-Za-z]:\\') {
                            throw "deploy_target_registry: target '$id' $rootField must be an absolute Windows path."
                        }
                    }
                }
                'linux_host_native' {
                    foreach ($rootField in @('deploy_root', 'runtime_data_root')) {
                        if ([string]$target.$rootField -notmatch '^/') {
                            throw "deploy_target_registry: target '$id' $rootField must be an absolute POSIX path."
                        }
                    }
                }
            }
        }

        $kit = $target.kit
        foreach ($field in @('build_platform', 'build_command', 'streaming_launcher_relative')) {
            if ([string]::IsNullOrWhiteSpace([string]$kit.$field)) {
                throw "deploy_target_registry: target '$id' kit.$field must be defined."
            }
        }
        $extraArgs = @($kit.extra_launch_args)
        $postClone = @($target.post_clone_steps)
        if ($kind -eq 'linux_host_native') {
            if ('--no-window' -notin $extraArgs) {
                throw "deploy_target_registry: target '$id' (linux_host_native) must include --no-window in kit.extra_launch_args (spike finding F-1: headless Kit crashes without it)."
            }
            if ('restore-exec-bits' -notin $postClone) {
                throw "deploy_target_registry: target '$id' (linux_host_native) must include restore-exec-bits in post_clone_steps (spike finding F-2: *.sh land without exec bits)."
            }
            if ([string]$kit.build_platform -ne 'linux-x86_64') {
                throw "deploy_target_registry: target '$id' kit.build_platform must be linux-x86_64."
            }
            if ([string]$kit.build_command -ne './repo.sh build') {
                throw "deploy_target_registry: target '$id' kit.build_command must be './repo.sh build'."
            }
        }
        if ($kind -eq 'windows_host_native') {
            if ([string]$kit.build_platform -ne 'windows-x86_64') {
                throw "deploy_target_registry: target '$id' kit.build_platform must be windows-x86_64."
            }
            if ([string]$kit.build_command -ne '.\repo.bat build') {
                throw "deploy_target_registry: target '$id' kit.build_command must be '.\repo.bat build'."
            }
        }
    }

    $canonicalId = [string]$registry.canonical_target
    if (-not $seen.ContainsKey($canonicalId)) {
        throw "deploy_target_registry: canonical_target '$canonicalId' is not a defined target."
    }
    if ($canonicalCount -ne 1) {
        throw "deploy_target_registry: exactly one target must have role canonical_test_deploy (found $canonicalCount)."
    }
    $canonical = @($targets | Where-Object { [string]$_.id -eq $canonicalId })[0]
    if ([string]$canonical.role -ne 'canonical_test_deploy') {
        throw "deploy_target_registry: canonical_target '$canonicalId' must carry role canonical_test_deploy."
    }

    return $registry
}

function Get-DeployTarget {
    param(
        [string] $Id = '',
        [switch] $Canonical,
        [string] $RegistryPath = '',
        [Alias('TargetLocalPath')][string] $InventoryPath = ''
    )
    $registry = Get-DeployTargetRegistry -Path $RegistryPath
    if ($Canonical) { $Id = [string]$registry.canonical_target }
    if ([string]::IsNullOrWhiteSpace($Id)) {
        throw 'deploy_target_registry: pass -Id or -Canonical.'
    }
    $target = @($registry.targets | Where-Object { [string]$_.id -eq $Id })
    if ($target.Count -ne 1) {
        throw "deploy_target_registry: target '$Id' not found."
    }
    return Resolve-DeployTargetPrivateInventory -Target $target[0] -InventoryPath $InventoryPath
}

function Get-DeployTargetPlatformKind {
    # PS 5.1 has no $IsWindows and only runs on Windows.
    $isWin = $true
    $flag = Get-Variable -Name IsWindows -Scope Global -ErrorAction SilentlyContinue
    if ($null -ne $flag) { $isWin = [bool]$flag.Value }
    if ($isWin) { return 'windows_host_native' }
    return 'linux_host_native'
}

function Get-DeployTargetForCurrentPlatform {
    # Resolves the target profile the CURRENT machine plays. deploy.ps1 always runs
    # on the target machine itself (from inside a checkout), so platform kind picks
    # the profile; with several same-platform targets, a deploy_root match on
    # -RepoRoot wins, then the canonical target, else the choice is ambiguous.
    param(
        [string] $RepoRoot = '',
        [string] $RegistryPath = '',
        [Alias('TargetLocalPath')][string] $InventoryPath = ''
    )
    $registry = Get-DeployTargetRegistry -Path $RegistryPath
    $kind = Get-DeployTargetPlatformKind
    $descriptors = @($registry.targets | Where-Object { [string]$_.kind -eq $kind })
    if ($descriptors.Count -eq 0) {
        throw "deploy_target_registry: no target registered for platform kind '$kind'."
    }
    $candidates = @($descriptors | ForEach-Object {
        Resolve-DeployTargetPrivateInventory -Target $_ -InventoryPath $InventoryPath
    })
    if ($candidates.Count -eq 1) {
        $candidate = $candidates[0]
        if ((Test-DeployTargetPrivateInventoryRequired -Target $candidate) -and -not [string]::IsNullOrWhiteSpace($RepoRoot)) {
            $normalizedRepoRoot = $RepoRoot.TrimEnd('\', '/')
            $candidateRoot = ([string]$candidate.deploy_root).TrimEnd('\', '/')
            if (-not [string]::Equals($normalizedRepoRoot, $candidateRoot, [StringComparison]::Ordinal)) {
                throw 'deploy_target_registry: current checkout does not match the private target deploy_root.'
            }
        }
        return $candidate
    }

    if (-not [string]::IsNullOrWhiteSpace($RepoRoot)) {
        $ignoreCase = ($kind -eq 'windows_host_native')
        $normalizedRepoRoot = $RepoRoot.TrimEnd('\', '/')
        foreach ($candidate in $candidates) {
            $candidateRoot = ([string]$candidate.deploy_root).TrimEnd('\', '/')
            $equal = if ($ignoreCase) { [string]::Equals($normalizedRepoRoot, $candidateRoot, [StringComparison]::OrdinalIgnoreCase) }
                     else { [string]::Equals($normalizedRepoRoot, $candidateRoot, [StringComparison]::Ordinal) }
            if ($equal) { return $candidate }
        }
    }
    $canonicalId = [string]$registry.canonical_target
    $canonical = @($candidates | Where-Object { [string]$_.id -eq $canonicalId })
    if ($canonical.Count -eq 1 -and -not (Test-DeployTargetPrivateInventoryRequired -Target $canonical[0])) { return $canonical[0] }
    throw "deploy_target_registry: multiple '$kind' targets and none matches RepoRoot or canonical; disambiguate explicitly."
}
