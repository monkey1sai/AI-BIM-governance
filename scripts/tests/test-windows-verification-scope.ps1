[CmdletBinding()]
param()

# Machine-derived Windows on-demand verification tiers (D-20, plan §6.4).
# Covers tier selection, subsumption, the deliberate exclusions, and the PR-body
# enforcement (self-selection of an easier tier must fail).

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Assert-True {
    param([Parameter(Mandatory = $true)] $Condition, [Parameter(Mandatory = $true)][string] $Message)
    if (-not $Condition) { throw "ASSERT FAILED: $Message" }
}

function Assert-Throws {
    param(
        [Parameter(Mandatory = $true)][scriptblock] $Action,
        [Parameter(Mandatory = $true)][string] $MessagePattern,
        [Parameter(Mandatory = $true)][string] $Context
    )
    $failed = $false
    try { & $Action } catch {
        $failed = $true
        if ($_.Exception.Message -notmatch $MessagePattern) {
            throw "ASSERT FAILED: $Context threw, but message '$($_.Exception.Message)' does not match '$MessagePattern'."
        }
    }
    Assert-True $failed "$Context was expected to throw."
}

$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../..')).Path
. (Join-Path $repoRoot 'scripts/lib/windows-verification-scope.ps1')

function Get-Tier { param([string[]] $Paths) return (Get-WindowsVerificationScope -ChangedPaths $Paths) }

# --- tier selection ------------------------------------------------------------
$t1 = Get-Tier @('scripts/lib/platform/platform-adapter.ps1')
Assert-True ($t1.Tier -eq 1 -and $t1.Id -eq 'platform_unit') "platform adapter -> tier 1 (got $($t1.Id))"
Assert-True ($t1.Required) 'tier 1 is required'

$t2a = Get-Tier @('scripts/deploy.ps1')
Assert-True ($t2a.Tier -eq 2 -and $t2a.Id -eq 'deploy_dryrun') "deploy.ps1 -> tier 2 (got $($t2a.Id))"
$t2b = Get-Tier @('scripts/lib/rebuild-test-deploy.ps1')
Assert-True ($t2b.Tier -eq 2) "scripts/lib top-level ps1 -> tier 2 (got $($t2b.Tier))"
$t2c = Get-Tier @('compose.host-kit.yml')
Assert-True ($t2c.Tier -eq 2) "compose file -> tier 2 (got $($t2c.Tier))"
$t2d = Get-Tier @('scripts/stop-all.ps1')
Assert-True ($t2d.Tier -eq 2) "stop-all.ps1 -> tier 2 (got $($t2d.Tier))"
$t2e = Get-Tier @('scripts/dev/rebuild-test-deploy.ps1')
Assert-True ($t2e.Tier -eq 2) "rebuild-test-deploy entrypoint -> tier 2 (got $($t2e.Tier))"

foreach ($kitPath in @('bim-streaming-server/source/apps/ezplus.bim_review_stream.kit', 'bim-streaming-server/repo.toml', 'bim-streaming-server/tools/packman/python.sh', 'bim-streaming-server/premake5.lua', 'bim-streaming-server/scripts/start-streaming-server.ps1')) {
    $t3 = Get-Tier @($kitPath)
    Assert-True ($t3.Tier -eq 3 -and $t3.Id -eq 'kit_gpu') "$kitPath -> tier 3 (got $($t3.Id))"
}

# --- subsumption: only the highest tier is owed ---------------------------------
$mixed = Get-Tier @('scripts/lib/platform/platform-adapter.ps1', 'scripts/deploy.ps1', 'bim-streaming-server/source/apps/x.kit')
Assert-True ($mixed.Tier -eq 3) "highest tier wins (got $($mixed.Tier))"
$mixed12 = Get-Tier @('scripts/lib/platform/platform-adapter.ps1', 'scripts/deploy.ps1')
Assert-True ($mixed12.Tier -eq 2) "tier 2 subsumes tier 1 (got $($mixed12.Tier))"

# --- deliberate exclusions: no Windows behavior can change ----------------------
foreach ($exempt in @(
    'docs/agents/product-operability-and-script-contract.md',
    'docs/plans/remote-linux-test-deploy-target.plan.md',
    'scripts/tests/test-platform-adapter.ps1',
    'web-viewer-sample/src/Window.tsx',
    'bim-streaming-server/README.md',
    'README.md'
)) {
    $none = Get-Tier @($exempt)
    Assert-True (-not $none.Required) "$exempt must not owe Windows evidence (got tier $($none.Tier))"
}
Assert-True ((Get-Tier @()).Tier -eq 0) 'empty changed-path set owes nothing'

# --- path normalization ---------------------------------------------------------
Assert-True ((Get-Tier @('scripts\lib\platform\platform-adapter.ps1')).Tier -eq 1) 'backslash paths normalize'
Assert-True ((Get-Tier @('./scripts/deploy.ps1')).Tier -eq 2) 'leading ./ normalizes'

# --- PR body enforcement --------------------------------------------------------
function Invoke-Gate {
    param(
        [hashtable] $Rows,
        [string[]] $Paths,
        [string] $ExpectedHeadSha = '0123456789abcdef0123456789abcdef01234567'
    )
    return Assert-WindowsVerificationEvidence -Body 'body' -ChangedPaths $Paths `
        -GetTableValue { param($b, $label) $Rows[$label] }.GetNewClosure() `
        -ExpectedHeadSha $ExpectedHeadSha
}

# exempt PR: no rows needed at all
$null = Invoke-Gate -Rows @{} -Paths @('docs/agents/x.md')

Assert-Throws -Context 'tier owed but undeclared' -MessagePattern 'must declare' -Action {
    Invoke-Gate -Rows @{} -Paths @('scripts/lib/platform/platform-adapter.ps1')
}
Assert-Throws -Context 'self-selecting an easier tier' -MessagePattern "must be 'kit_gpu'" -Action {
    Invoke-Gate -Rows @{
        'Windows verification tier' = 'platform_unit'
        'Windows verification evidence' = 'ran unit tests'
    } -Paths @('bim-streaming-server/source/apps/x.kit')
}
Assert-Throws -Context 'claiming a heavier tier than derived' -MessagePattern "must be 'platform_unit'" -Action {
    Invoke-Gate -Rows @{
        'Windows verification tier' = 'kit_gpu'
        'Windows verification evidence' = 'full GPU launch'
    } -Paths @('scripts/lib/platform/platform-adapter.ps1')
}
Assert-Throws -Context 'missing evidence value' -MessagePattern 'evidence' -Action {
    Invoke-Gate -Rows @{ 'Windows verification tier' = 'platform_unit' } -Paths @('scripts/lib/platform/platform-adapter.ps1')
}
foreach ($weasel in @('none', 'N/A', 'not needed', 'TBD')) {
    Assert-Throws -Context "weasel evidence '$weasel'" -MessagePattern 'must record a real Windows run' -Action {
        Invoke-Gate -Rows @{
            'Windows verification tier' = 'platform_unit'
            'Windows verification evidence' = $weasel
        } -Paths @('scripts/lib/platform/platform-adapter.ps1')
    }
}

Assert-Throws -Context 'descriptive prose is not commit-bound evidence' -MessagePattern 'exact reviewed head SHA' -Action {
    Invoke-Gate -Rows @{
        'Windows verification tier' = 'deploy_dryrun'
        'Windows verification evidence' = '.\scripts\deploy.ps1 -DryRun -> exit 0 on win11 host'
    } -Paths @('scripts/deploy.ps1')
}
Assert-Throws -Context 'head-bound evidence without actions URL' -MessagePattern 'GitHub Actions run URL' -Action {
    Invoke-Gate -Rows @{
        'Windows verification tier' = 'deploy_dryrun'
        'Windows verification evidence' = 'head 0123456789abcdef0123456789abcdef01234567: deploy dry-run passed'
    } -Paths @('scripts/deploy.ps1')
}
Assert-Throws -Context 'evidence for a different head' -MessagePattern 'exact reviewed head SHA' -Action {
    Invoke-Gate -Rows @{
        'Windows verification tier' = 'deploy_dryrun'
        'Windows verification evidence' = 'head fedcba9876543210fedcba9876543210fedcba98; https://github.com/monkey1sai/AI-BIM-governance/actions/runs/123456789'
    } -Paths @('scripts/deploy.ps1')
}

$ok = Invoke-Gate -Rows @{
    'Windows verification tier' = 'deploy_dryrun'
    'Windows verification evidence' = 'head 0123456789abcdef0123456789abcdef01234567; .\scripts\deploy.ps1 -DryRun -> exit 0; https://github.com/monkey1sai/AI-BIM-governance/actions/runs/123456789'
} -Paths @('scripts/deploy.ps1')
Assert-True ($ok.Id -eq 'deploy_dryrun') 'correct declaration passes and returns the scope'

Write-Host '[test-windows-verification-scope] all assertions passed'
