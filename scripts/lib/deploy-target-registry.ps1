# scripts/lib/deploy-target-registry.ps1
# Deploy target registry: the single source of truth for WHERE the persistent test
# deployment lives and HOW each target differs by platform (decision D-8, plan
# docs/plans/remote-linux-test-deploy-target.plan.md §6.1).
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
        if ($connectionType -eq 'ssh') {
            if ([string]::IsNullOrWhiteSpace([string]$connection.host) -or [string]::IsNullOrWhiteSpace([string]$connection.user)) {
                throw "deploy_target_registry: target '$id' ssh connection requires host and user."
            }
        }

        foreach ($field in @('deploy_root', 'runtime_data_root', 'public_host', 'edge_site_id', 'env_file')) {
            if ([string]::IsNullOrWhiteSpace([string]$target.$field)) {
                throw "deploy_target_registry: target '$id' must define $field."
            }
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
        }
        if ($kind -eq 'windows_host_native' -and [string]$kit.build_platform -ne 'windows-x86_64') {
            throw "deploy_target_registry: target '$id' kit.build_platform must be windows-x86_64."
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
        [string] $RegistryPath = ''
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
    return $target[0]
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
        [string] $RegistryPath = ''
    )
    $registry = Get-DeployTargetRegistry -Path $RegistryPath
    $kind = Get-DeployTargetPlatformKind
    $candidates = @($registry.targets | Where-Object { [string]$_.kind -eq $kind })
    if ($candidates.Count -eq 0) {
        throw "deploy_target_registry: no target registered for platform kind '$kind'."
    }
    if ($candidates.Count -eq 1) { return $candidates[0] }

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
    if ($canonical.Count -eq 1) { return $canonical[0] }
    throw "deploy_target_registry: multiple '$kind' targets and none matches RepoRoot or canonical; disambiguate explicitly."
}
