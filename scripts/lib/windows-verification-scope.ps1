# scripts/lib/windows-verification-scope.ps1
# Windows on-demand verification tiers (decision D-20, plan §6.4).
#
# The canonical test deployment is the Linux target; the Windows deployment is
# demoted to an on-demand platform verification point (D-3). "On demand" with no
# machine definition means "nobody remembers", so the tier a PR owes is derived
# from its changed paths and enforced in the PR body evidence check:
#
#   tier 1 platform_unit   scripts/lib/platform/**            seconds
#   tier 2 deploy_dryrun   deploy path / libs / compose        minutes
#   tier 3 kit_gpu         bim-streaming-server Kit sources    heavy (rare)
#
# Only the HIGHEST matched tier is owed - tier 3 subsumes tier 2 subsumes tier 1,
# so a Kit-source PR is not asked for three separate proofs.
#
# Deliberately NOT covered: docs, tests-only changes, and the Linux-only adapter
# branch. Asking for Windows evidence where Windows behavior cannot change is
# how a gate trains people to route around it.

Set-StrictMode -Version Latest

$script:WindowsVerificationTiers = @(
    [pscustomobject]@{
        Tier      = 3
        Id        = 'kit_gpu'
        # Kit sources, app definitions, conversion launchers, and the Kit build
        # toolchain can break the Windows host-native Kit/conversion path.
        Patterns  = @(
            '^bim-streaming-server/source/',
            '^bim-streaming-server/repo\.(toml|bat|sh)$',
            '^bim-streaming-server/premake5\.lua$',
            '^bim-streaming-server/tools/',
            '^bim-streaming-server/scripts/(start-streaming-server|start-host-native-conversion-service|convert-ifc-to-usdc)\.ps1$'
        )
        Evidence  = 'Applicable full Windows host-native Kit GPU/WebRTC or conversion execution evidence'
        Rationale = 'Kit source, conversion launcher, or build toolchain changed; only an applicable real Windows host-native execution proves that path still works.'
    },
    [pscustomobject]@{
        Tier      = 2
        Id        = 'deploy_dryrun'
        Patterns  = @(
            '^scripts/deploy\.ps1$',
            '^scripts/deploy-target-registry\.json$',
            '^scripts/dev/rebuild-test-deploy\.ps1$',
            '^scripts/stop-all\.ps1$',
            '^scripts/lib/(?!platform/)[^/]+\.ps1$',
            '^compose\.[^/]+\.yml$'
        )
        Evidence  = '.\scripts\deploy.ps1 -DryRun passes on Windows'
        Rationale = 'Deploy path or its libraries changed; the Windows resolution branch must still plan a valid deploy.'
    },
    [pscustomobject]@{
        Tier      = 1
        Id        = 'platform_unit'
        Patterns  = @('^scripts/lib/platform/')
        Evidence  = 'Windows-branch unit/contract tests (test-platform-adapter.ps1) pass on Windows'
        Rationale = 'Platform adapter changed; the Windows dispatch branch needs its own executable proof.'
    }
)

function ConvertTo-WindowsScopeRepoPath {
    param([Parameter(Mandatory = $true)][string] $Path)
    $normalized = $Path.Trim().Replace('\', '/')
    while ($normalized.StartsWith('./', [System.StringComparison]::Ordinal)) {
        $normalized = $normalized.Substring(2)
    }
    return $normalized.TrimStart('/')
}

function Get-WindowsVerificationScope {
    # Returns the single owed tier (highest match) plus the paths that triggered
    # it. tier 0 / id 'none' means this PR owes no Windows evidence.
    param(
        [Parameter(Mandatory = $true)][AllowEmptyCollection()][string[]] $ChangedPaths
    )

    $normalized = @($ChangedPaths | ForEach-Object { ConvertTo-WindowsScopeRepoPath -Path $_ } | Where-Object { $_ })

    foreach ($tier in $script:WindowsVerificationTiers) {
        $matchedPaths = @($normalized | Where-Object {
            $candidate = $_
            @($tier.Patterns | Where-Object { $candidate -match $_ }).Count -gt 0
        })
        if ($matchedPaths.Count -gt 0) {
            return [pscustomobject]@{
                Tier          = [int]$tier.Tier
                Id            = [string]$tier.Id
                Required      = $true
                MatchedPaths  = $matchedPaths
                Evidence      = [string]$tier.Evidence
                Rationale     = [string]$tier.Rationale
            }
        }
    }

    return [pscustomobject]@{
        Tier         = 0
        Id           = 'none'
        Required     = $false
        MatchedPaths = @()
        Evidence     = ''
        Rationale    = 'No changed path can alter Windows platform behavior.'
    }
}

function Assert-WindowsVerificationEvidence {
    # Enforced in the PR body evidence check. The declared tier must equal the
    # machine-derived tier - a PR cannot self-select an easier tier, and cannot
    # claim a heavier one to look thorough while the value is unverifiable.
    param(
        [Parameter(Mandatory = $true)][string] $Body,
        [Parameter(Mandatory = $true)][AllowEmptyCollection()][string[]] $ChangedPaths,
        [Parameter(Mandatory = $true)][scriptblock] $GetTableValue,
        [string] $ExpectedHeadSha = ''
    )

    $scope = Get-WindowsVerificationScope -ChangedPaths $ChangedPaths
    if (-not $scope.Required) { return $scope }

    $declaredTier = ([string](& $GetTableValue $Body 'Windows verification tier')).Trim().ToLowerInvariant()
    if ([string]::IsNullOrWhiteSpace($declaredTier)) {
        throw "This PR changes Windows-affecting paths ($($scope.MatchedPaths -join ', ')); the PR body must declare 'Windows verification tier' as '$($scope.Id)'."
    }
    if ($declaredTier -ne $scope.Id) {
        throw "PR body 'Windows verification tier' must be '$($scope.Id)' for the machine-derived changed-path scope ($($scope.MatchedPaths -join ', ')); actual='$declaredTier'."
    }

    $evidence = ([string](& $GetTableValue $Body 'Windows verification evidence')).Trim()
    if ([string]::IsNullOrWhiteSpace($evidence)) {
        throw "PR body 'Windows verification evidence' is required for tier '$($scope.Id)': $($scope.Evidence)."
    }
    $prohibited = @('none', 'n/a', 'not applicable', 'not needed', 'unavailable', 'not tested', 'tbd', 'todo')
    if ($evidence.ToLowerInvariant() -in $prohibited) {
        throw "PR body 'Windows verification evidence' must record a real Windows run, not '$evidence'. Required: $($scope.Evidence)."
    }
    if (-not [string]::IsNullOrWhiteSpace($ExpectedHeadSha)) {
        if ($ExpectedHeadSha -cnotmatch '^[0-9a-f]{40}$') {
            throw "Windows verification expected head SHA must be 40 lowercase hexadecimal characters; actual='$ExpectedHeadSha'."
        }
        $escapedHead = [regex]::Escape($ExpectedHeadSha)
        if ($evidence -notmatch "(?i)(?<![0-9a-f])$escapedHead(?![0-9a-f])") {
            throw "PR body 'Windows verification evidence' must include the exact reviewed head SHA '$ExpectedHeadSha'."
        }
        if ($evidence -notmatch 'https://github\.com/monkey1sai/AI-BIM-governance/actions/runs/[0-9]+(?:/job/[0-9]+)?') {
            throw "PR body 'Windows verification evidence' must include a machine-checkable GitHub Actions run URL for the reviewed head."
        }
    }
    return $scope
}
