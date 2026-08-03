[CmdletBinding()]
param()

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
. (Join-Path $repoRoot 'scripts/lib/deploy-target-registry.ps1')

$tempRoot = Join-Path $repoRoot "artifacts/tmp/deploy-target-registry-$([Guid]::NewGuid().ToString('N'))"
New-Item -ItemType Directory -Path $tempRoot -Force | Out-Null

function Write-Mutated {
    param([Parameter(Mandatory = $true)][string] $Name, [Parameter(Mandatory = $true)][scriptblock] $Mutate)
    $registry = Get-Content -LiteralPath (Join-Path $repoRoot 'scripts/deploy-target-registry.json') -Raw | ConvertFrom-Json
    & $Mutate $registry
    $path = Join-Path $tempRoot $Name
    $registry | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $path -Encoding utf8
    return $path
}

try {
    # real registry validates and resolves
    $registry = Get-DeployTargetRegistry
    Assert-True ([string]$registry.canonical_target -eq 'remote-linux-181') 'canonical target must be remote-linux-181'
    $canonical = Get-DeployTarget -Canonical
    Assert-True ([string]$canonical.kind -eq 'linux_host_native') 'canonical target must be linux_host_native'
    Assert-True ([string]$canonical.connection.host -eq '192.168.20.181') 'canonical target host'
    $windows = Get-DeployTarget -Id 'local-windows'
    Assert-True ([string]$windows.role -eq 'on_demand_platform_verification') 'windows target is on-demand only (decision D-3)'

    Assert-Throws -Context 'unknown target id' -MessagePattern 'not found' -Action { Get-DeployTarget -Id 'nope-nope' }

    Assert-Throws -Context 'wrong schema version' -MessagePattern 'unsupported schema_version' -Action {
        Get-DeployTargetRegistry -Path (Write-Mutated 'ver.json' { param($r) $r.schema_version = 'deploy-target-registry/v9' })
    }
    Assert-Throws -Context 'duplicate target ids' -MessagePattern 'duplicate' -Action {
        Get-DeployTargetRegistry -Path (Write-Mutated 'dup.json' { param($r) $r.targets[1].id = $r.targets[0].id })
    }
    Assert-Throws -Context 'canonical target missing' -MessagePattern 'not a defined target' -Action {
        Get-DeployTargetRegistry -Path (Write-Mutated 'canon.json' { param($r) $r.canonical_target = 'ghost' })
    }
    Assert-Throws -Context 'reserved kind used by a target' -MessagePattern 'reserved kind' -Action {
        Get-DeployTargetRegistry -Path (Write-Mutated 'reserved.json' { param($r) $r.targets[1].kind = 'linux_container' })
    }
    Assert-Throws -Context 'linux target without --no-window' -MessagePattern 'F-1' -Action {
        Get-DeployTargetRegistry -Path (Write-Mutated 'nowindow.json' { param($r) $r.targets[1].kit.extra_launch_args = @() })
    }
    Assert-Throws -Context 'linux target without restore-exec-bits' -MessagePattern 'F-2' -Action {
        Get-DeployTargetRegistry -Path (Write-Mutated 'execbits.json' { param($r) $r.targets[1].post_clone_steps = @() })
    }
    Assert-Throws -Context 'ssh connection without user' -MessagePattern 'requires host and user' -Action {
        Get-DeployTargetRegistry -Path (Write-Mutated 'sshuser.json' { param($r) $r.targets[1].connection.user = '' })
    }
    Assert-Throws -Context 'windows root not absolute' -MessagePattern 'absolute Windows path' -Action {
        Get-DeployTargetRegistry -Path (Write-Mutated 'winroot.json' { param($r) $r.targets[0].deploy_root = 'relative\path' })
    }
    Assert-Throws -Context 'linux root not absolute' -MessagePattern 'absolute POSIX path' -Action {
        Get-DeployTargetRegistry -Path (Write-Mutated 'linroot.json' { param($r) $r.targets[1].deploy_root = 'home/bimdeploy/x' })
    }
    Assert-Throws -Context 'two canonical roles' -MessagePattern 'exactly one target' -Action {
        Get-DeployTargetRegistry -Path (Write-Mutated 'twocanon.json' { param($r) $r.targets[0].role = 'canonical_test_deploy' })
    }

    # --- Kit launcher resolution: no Windows drift, correct Linux shape ---------
    # start-streaming-server.ps1 used to hardcode the Windows build tree, so a
    # Linux run looked for a .bat that could never exist. It now asks the registry.
    # These pin BOTH ends: the Windows answer must stay byte-identical to the path
    # that was hardcoded, and the Linux answer must be the .sh in the Linux tree.
    . (Join-Path $repoRoot 'scripts/lib/platform/platform-adapter.ps1')
    $registry = Get-DeployTargetRegistry
    $winTarget = @($registry.targets | Where-Object { [string]$_.kind -eq 'windows_host_native' })[0]
    $linTarget = @($registry.targets | Where-Object { [string]$_.kind -eq 'linux_host_native' })[0]

    $winLaunch = Resolve-DeployTargetKitLaunch -Target $winTarget -DeployRootOverride 'R:'
    $expectedWin = 'R:\bim-streaming-server\_build\windows-x86_64\release\ezplus.bim_review_stream_streaming.kit.bat'
    if ($winLaunch.LauncherPath -ne $expectedWin) {
        throw "ASSERT FAILED: windows launcher must match the historically hardcoded path exactly (expected='$expectedWin' actual='$($winLaunch.LauncherPath)')"
    }

    $linLaunch = Resolve-DeployTargetKitLaunch -Target $linTarget -DeployRootOverride '/srv/app'
    $expectedLin = '/srv/app/bim-streaming-server/_build/linux-x86_64/release/ezplus.bim_review_stream_streaming.kit.sh'
    if ($linLaunch.LauncherPath -ne $expectedLin) {
        throw "ASSERT FAILED: linux launcher must be the .sh in the linux-x86_64 tree (expected='$expectedLin' actual='$($linLaunch.LauncherPath)')"
    }
    Assert-True (@($linLaunch.Arguments) -contains '--no-window') 'linux target must mandate --no-window (headless, no display)'
    Assert-True (-not (@($winLaunch.Arguments) -contains '--no-window')) 'windows target must not force --no-window'

    # Host-native bind address per target: loopback on Windows, bridge-reachable on
    # Linux. Governance and kit-manager-api bound 127.0.0.1 there, so the dockerised
    # coordinator could not reach them (/api/governance/files/tree -> 502) even
    # though the same services answered fine on the host itself.
    if ([string]$winTarget.host_native_bind_host -ne '127.0.0.1') {
        throw "ASSERT FAILED: windows target must keep host-native services on loopback (actual='$($winTarget.host_native_bind_host)')"
    }
    if ([string]$linTarget.host_native_bind_host -eq '127.0.0.1') {
        throw 'ASSERT FAILED: linux target must not bind host-native services to loopback only; the dockerised coordinator reaches them over the bridge'
    }
    # Exercise the real consumer, not a re-implementation of it: the launcher must
    # read the value for THIS platform out of the registry.
    . (Join-Path $repoRoot 'scripts/lib/host-native-launcher.ps1')
    $currentBind = Get-HostNativeBindHost -RepoRoot $repoRoot
    $expectedBind = if ((Get-PlatformName) -eq 'windows') { [string]$winTarget.host_native_bind_host }
                    else { [string]$linTarget.host_native_bind_host }
    if ($currentBind -ne $expectedBind) {
        throw "ASSERT FAILED: Get-HostNativeBindHost must return this platform's registry value (expected='$expectedBind' actual='$currentBind')"
    }

    Write-Host '[test-deploy-target-registry] all assertions passed'
} finally {
    Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
}
