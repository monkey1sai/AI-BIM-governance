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
$privateTempRoot = Join-Path ([IO.Path]::GetTempPath()) "ai-bim-target-inventory-$([Guid]::NewGuid().ToString('N'))"
New-Item -ItemType Directory -Path $tempRoot -Force | Out-Null
New-Item -ItemType Directory -Path $privateTempRoot -Force | Out-Null
$previousInventoryEnv = [Environment]::GetEnvironmentVariable('AI_BIM_DEPLOY_TARGET_INVENTORY', 'Process')

$privateDeployRoot = if ((Get-DeployTargetPlatformKind) -eq 'linux_host_native') {
    $repoRoot -replace '\\', '/'
} else {
    '/srv/ai-bim/example-deploy'
}
$baseInventory = [pscustomobject]@{
    schema_version = 'deploy-target-private-inventory/v1'
    targets = @([pscustomobject]@{
        id = 'canonical-linux'
        connection = [pscustomobject]@{ host = 'deploy.example.invalid'; user = 'deploy-fixture' }
        deploy_root = $privateDeployRoot
        runtime_data_root = '/srv/ai-bim/example-runtime-data'
        public_host = '192.0.2.10'
        edge_site_id = 'site-example'
        host_native_bind_host = '192.0.2.1'
    })
}

function Write-MutatedRegistry {
    param([Parameter(Mandatory = $true)][string] $Name, [Parameter(Mandatory = $true)][scriptblock] $Mutate)
    $registry = Get-Content -LiteralPath (Join-Path $repoRoot 'scripts/deploy-target-registry.json') -Raw | ConvertFrom-Json
    & $Mutate $registry
    $path = Join-Path $tempRoot $Name
    $registry | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $path -Encoding utf8
    return $path
}

function Write-MutatedInventory {
    param(
        [Parameter(Mandatory = $true)][string] $Name,
        [Parameter(Mandatory = $true)][scriptblock] $Mutate,
        [string] $Root = $privateTempRoot
    )
    $inventory = $baseInventory | ConvertTo-Json -Depth 10 | ConvertFrom-Json
    & $Mutate $inventory
    $path = Join-Path $Root $Name
    $inventory | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $path -Encoding utf8
    return $path
}

try {
    $inventoryPath = Write-MutatedInventory 'target.local.json' { param($i) }
    [Environment]::SetEnvironmentVariable('AI_BIM_DEPLOY_TARGET_INVENTORY', $inventoryPath, 'Process')

    # Public registry carries behaviour only; the resolved target receives the
    # synthetic location mapping from the repo-external private inventory.
    $registry = Get-DeployTargetRegistry
    Assert-True ([string]$registry.canonical_target -eq 'canonical-linux') 'canonical target id is de-identified'
    $descriptor = @($registry.targets | Where-Object { [string]$_.id -eq 'canonical-linux' })[0]
    Assert-True (Test-DeployTargetPrivateInventoryRequired -Target $descriptor) 'canonical target requires private inventory'
    Assert-True ($null -eq $descriptor.connection.PSObject.Properties['host']) 'public registry must not publish ssh host'
    foreach ($field in $script:DeployTargetPrivateLocationFields) {
        Assert-True ($null -eq $descriptor.PSObject.Properties[$field]) "public registry must not publish $field"
    }
    Assert-Throws -Context 'canonical target without private inventory' -MessagePattern 'requires owner-controlled private inventory' -Action {
        [Environment]::SetEnvironmentVariable('AI_BIM_DEPLOY_TARGET_INVENTORY', $null, 'Process')
        Get-DeployTarget -Canonical
    }
    [Environment]::SetEnvironmentVariable('AI_BIM_DEPLOY_TARGET_INVENTORY', $inventoryPath, 'Process')

    $canonical = Get-DeployTarget -Canonical -InventoryPath $inventoryPath
    Assert-True ([string]$canonical.kind -eq 'linux_host_native') 'canonical target must be linux_host_native'
    Assert-True ([string]$canonical.connection.host -eq 'deploy.example.invalid') 'private host resolves from synthetic inventory'
    Assert-True ([string]$canonical.deploy_root -eq $privateDeployRoot) 'private deploy root resolves from synthetic inventory'
    $windows = Get-DeployTarget -Id 'local-windows'
    Assert-True ([string]$windows.role -eq 'on_demand_platform_verification') 'windows target is on-demand only'

    Assert-Throws -Context 'unknown target id' -MessagePattern 'not found' -Action { Get-DeployTarget -Id 'nope-nope' }
    Assert-Throws -Context 'wrong schema version' -MessagePattern 'unsupported schema_version' -Action {
        Get-DeployTargetRegistry -Path (Write-MutatedRegistry 'ver.json' { param($r) $r.schema_version = 'deploy-target-registry/v9' })
    }
    Assert-Throws -Context 'duplicate target ids' -MessagePattern 'duplicate' -Action {
        Get-DeployTargetRegistry -Path (Write-MutatedRegistry 'dup.json' { param($r) $r.targets[1].id = $r.targets[0].id })
    }
    Assert-Throws -Context 'canonical target missing' -MessagePattern 'not a defined target' -Action {
        Get-DeployTargetRegistry -Path (Write-MutatedRegistry 'canon.json' { param($r) $r.canonical_target = 'ghost' })
    }
    Assert-Throws -Context 'reserved kind used by a target' -MessagePattern 'reserved kind' -Action {
        Get-DeployTargetRegistry -Path (Write-MutatedRegistry 'reserved.json' { param($r) $r.targets[1].kind = 'linux_container' })
    }
    Assert-Throws -Context 'linux target without --no-window' -MessagePattern 'F-1' -Action {
        Get-DeployTargetRegistry -Path (Write-MutatedRegistry 'nowindow.json' { param($r) $r.targets[1].kit.extra_launch_args = @() })
    }
    Assert-Throws -Context 'linux target without restore-exec-bits' -MessagePattern 'F-2' -Action {
        Get-DeployTargetRegistry -Path (Write-MutatedRegistry 'execbits.json' { param($r) $r.targets[1].post_clone_steps = @() })
    }
    Assert-Throws -Context 'private descriptor publishing user' -MessagePattern 'must not publish connection.user' -Action {
        Get-DeployTargetRegistry -Path (Write-MutatedRegistry 'published-user.json' { param($r) $r.targets[1].connection | Add-Member -NotePropertyName user -NotePropertyValue 'fixture' })
    }
    Assert-Throws -Context 'windows root not absolute' -MessagePattern 'absolute Windows path' -Action {
        Get-DeployTargetRegistry -Path (Write-MutatedRegistry 'winroot.json' { param($r) $r.targets[0].deploy_root = 'relative\path' })
    }
    Assert-Throws -Context 'two canonical roles' -MessagePattern 'exactly one target' -Action {
        Get-DeployTargetRegistry -Path (Write-MutatedRegistry 'twocanon.json' { param($r) $r.targets[0].role = 'canonical_test_deploy' })
    }

    $insideRepoInventory = Write-MutatedInventory 'inside.target.local.json' { param($i) } -Root $tempRoot
    Assert-Throws -Context 'private inventory inside repository' -MessagePattern 'outside the repository' -Action {
        Get-DeployTarget -Canonical -InventoryPath $insideRepoInventory
    }
    $relativeRootInventory = Write-MutatedInventory 'relative-root.json' { param($i) $i.targets[0].deploy_root = 'srv/not-absolute' }
    Assert-Throws -Context 'relative private deploy root' -MessagePattern 'absolute POSIX path' -Action {
        Get-DeployTarget -Canonical -InventoryPath $relativeRootInventory
    }
    $wildcardInventory = Write-MutatedInventory 'wildcard.json' { param($i) $i.targets[0].host_native_bind_host = '0.0.0.0' }
    Assert-Throws -Context 'wildcard private bind' -MessagePattern 'non-wildcard' -Action {
        Get-DeployTarget -Canonical -InventoryPath $wildcardInventory
    }
    $publicBindInventory = Write-MutatedInventory 'public-bind.json' { param($i) $i.targets[0].host_native_bind_host = '8.8.8.8' }
    Assert-Throws -Context 'public private bind' -MessagePattern 'private, loopback, link-local' -Action {
        Get-DeployTarget -Canonical -InventoryPath $publicBindInventory
    }
    $publicHostBindInventory = Write-MutatedInventory 'public-host-bind.json' { param($i) $i.targets[0].host_native_bind_host = $i.targets[0].public_host }
    Assert-Throws -Context 'bind equal to public host' -MessagePattern 'must differ from public_host' -Action {
        Get-DeployTarget -Canonical -InventoryPath $publicHostBindInventory
    }
    $connectionHostBindInventory = Write-MutatedInventory 'connection-host-bind.json' {
        param($i)
        $i.targets[0].connection.host = '192.0.2.1'
        $i.targets[0].host_native_bind_host = '192.0.2.1'
    }
    Assert-Throws -Context 'bind equal to connection host' -MessagePattern 'must differ from public_host' -Action {
        Get-DeployTarget -Canonical -InventoryPath $connectionHostBindInventory
    }
    $policyOverrideInventory = Write-MutatedInventory 'policy-override.json' { param($i) $i.targets[0] | Add-Member -NotePropertyName kit -NotePropertyValue @{ build_command = 'unsafe' } }
    Assert-Throws -Context 'private policy override' -MessagePattern 'non-location field' -Action {
        Get-DeployTarget -Canonical -InventoryPath $policyOverrideInventory
    }
    $insideDeployInventory = Write-MutatedInventory 'inside-deploy.json' { param($i) $i.targets[0].runtime_data_root = "$($i.targets[0].deploy_root)/runtime-data" }
    Assert-Throws -Context 'runtime data inside deploy root' -MessagePattern 'outside deploy_root' -Action {
        Get-DeployTarget -Canonical -InventoryPath $insideDeployInventory
    }
    $dotDotInventory = Write-MutatedInventory 'dot-dot.json' { param($i) $i.targets[0].runtime_data_root = '/srv/ai-bim/../private-data' }
    Assert-Throws -Context 'dot-dot private path' -MessagePattern 'normalized' -Action {
        Get-DeployTarget -Canonical -InventoryPath $dotDotInventory
    }
    $quoteInventory = Write-MutatedInventory 'quote.json' { param($i) $i.targets[0].connection.user = "deploy'fixture" }
    Assert-Throws -Context 'quoted private value' -MessagePattern 'unsafe characters' -Action {
        Get-DeployTarget -Canonical -InventoryPath $quoteInventory
    }
    $newlineInventory = Write-MutatedInventory 'newline.json' { param($i) $i.targets[0].edge_site_id = "site`nfixture" }
    Assert-Throws -Context 'newline private value' -MessagePattern 'unsafe characters' -Action {
        Get-DeployTarget -Canonical -InventoryPath $newlineInventory
    }

    $examplePath = Join-Path $repoRoot 'scripts/target.local.example.json'
    Assert-True (Test-Path -LiteralPath $examplePath -PathType Leaf) 'tracked private inventory schema example exists'
    $example = Get-Content -LiteralPath $examplePath -Raw | ConvertFrom-Json
    Assert-True ([string]$example.schema_version -eq 'deploy-target-private-inventory/v1') 'private inventory example schema is current'
    Assert-True (@($example.targets).Count -eq 1 -and [string]$example.targets[0].id -eq 'canonical-linux') 'private inventory example joins the public descriptor'

    # Launcher behaviour remains public and reviewable; location is private.
    . (Join-Path $repoRoot 'scripts/lib/platform/platform-adapter.ps1')
    $winTarget = @($registry.targets | Where-Object { [string]$_.kind -eq 'windows_host_native' })[0]
    $winLaunch = Resolve-DeployTargetKitLaunch -Target $winTarget -DeployRootOverride 'R:'
    Assert-True ($winLaunch.LauncherPath -eq 'R:\bim-streaming-server\_build\windows-x86_64\release\ezplus.bim_review_stream_streaming.kit.bat') 'windows launcher remains byte-identical'

    $linLaunch = Resolve-DeployTargetKitLaunch -Target $canonical -DeployRootOverride '/srv/app'
    Assert-True ($linLaunch.LauncherPath -eq '/srv/app/bim-streaming-server/_build/linux-x86_64/release/ezplus.bim_review_stream_streaming.kit.sh') 'linux launcher uses reviewed public template'
    Assert-True (@($linLaunch.Arguments) -contains '--no-window') 'linux target mandates --no-window'
    Assert-True (-not (@($winLaunch.Arguments) -contains '--no-window')) 'windows target does not force --no-window'
    Assert-True ([string]$windows.host_native_bind_host -eq '127.0.0.1') 'windows target keeps loopback'
    Assert-True ([string]$canonical.host_native_bind_host -eq '192.0.2.1') 'linux bind resolves from synthetic inventory'
    Assert-True ([string]$canonical.host_native_bind_host -notin @('0.0.0.0', '::', '[::]')) 'linux bind is not wildcard'
    Assert-True (Test-Path -LiteralPath (Join-Path $repoRoot "$([string]$canonical.env_file).example") -PathType Leaf) 'canonical Linux target provides a secret-free env example'

    . (Join-Path $repoRoot 'scripts/lib/host-native-launcher.ps1')
    $currentBind = Get-HostNativeBindHost -RepoRoot $repoRoot
    $expectedBind = if ((Get-PlatformName) -eq 'windows') { [string]$windows.host_native_bind_host } else { [string]$canonical.host_native_bind_host }
    Assert-True ($currentBind -eq $expectedBind) 'real consumer resolves the platform bind through the inventory seam'

    Write-Host '[test-deploy-target-registry] all assertions passed'
} finally {
    [Environment]::SetEnvironmentVariable('AI_BIM_DEPLOY_TARGET_INVENTORY', $previousInventoryEnv, 'Process')
    Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $privateTempRoot -Recurse -Force -ErrorAction SilentlyContinue
}
