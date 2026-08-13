[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'test-helpers.ps1')

$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$testName = 'edge-console-deploy-contract'

try {
    $dockerfilePath = Join-Path $repoRoot 'infra\docker\coordinator-web-plane.Dockerfile'
    $viewerDockerfilePath = Join-Path $repoRoot 'infra\docker\web-viewer-sample.Dockerfile'
    $designAssetsLibPath = Join-Path $repoRoot 'scripts\lib\design-assets.ps1'
    $syncDesignAssetsPath = Join-Path $repoRoot 'web-viewer-sample\scripts\sync-design-assets.mjs'
    $rebuildLibPath = Join-Path $repoRoot 'scripts\lib\rebuild-test-deploy.ps1'
    $startWebPlanePath = Join-Path $repoRoot 'scripts\start-web-plane-docker.ps1'
    $startRuntimeManagerPath = Join-Path $repoRoot 'scripts\start-runtime-manager-docker.ps1'
    $dockerIgnorePath = Join-Path $repoRoot '.dockerignore'
    $composePath = Join-Path $repoRoot 'compose.runtime-manager.yml'
    $deployPath = Join-Path $repoRoot 'scripts\deploy.ps1'
    $canonicalAllowListPath = Join-Path $repoRoot 'tests\contracts\structured-log\env-allowlist.json'
    $canonicalAllowListCopy = 'COPY tests/contracts/structured-log/env-allowlist.json /workspace/tests/contracts/structured-log/env-allowlist.json'

    Assert-True (Test-Path -LiteralPath $canonicalAllowListPath -PathType Leaf) 'canonical structured-log env allow-list exists'

    Assert-True (Test-Path -LiteralPath $dockerfilePath -PathType Leaf) 'coordinator web-plane Dockerfile exists'
    $dockerfile = Get-Content -LiteralPath $dockerfilePath -Raw
    Assert-True ($dockerfile -match 'AS console-build') 'Dockerfile has a console build stage'
    Assert-True ($dockerfile -match 'npm run build:ui') 'Dockerfile builds the /ui bundle'
    Assert-True ($dockerfile.Contains($canonicalAllowListCopy)) 'coordinator console-build copies the canonical structured-log env allow-list'
    Assert-True ($dockerfile.IndexOf($canonicalAllowListCopy) -lt $dockerfile.IndexOf('RUN npm run build:ui')) 'coordinator copies the canonical allow-list before the Vite UI build'
    Assert-True ($dockerfile -match 'COPY --from=console-build /workspace/web-viewer-sample/dist-ui /workspace/console-dist') 'Dockerfile copies dist-ui into image console-dist'
    Assert-True ($dockerfile -match 'ENV CONSOLE_DIST_DIR=/workspace/console-dist') 'Dockerfile sets CONSOLE_DIST_DIR'

    Assert-True (Test-Path -LiteralPath $viewerDockerfilePath -PathType Leaf) 'viewer Dockerfile exists'
    $viewerDockerfile = Get-Content -LiteralPath $viewerDockerfilePath -Raw
    Assert-True ($viewerDockerfile -match 'COPY --chown=node:node web-viewer-sample/ /workspace/web-viewer-sample/') 'viewer image includes prestaged public design assets'
    Assert-True ($viewerDockerfile.Contains($canonicalAllowListCopy)) 'viewer image copies the canonical structured-log env allow-list for dev runtime reads'
    Assert-True ($viewerDockerfile -match 'RUN node scripts/sync-design-assets\.mjs') 'viewer image build validates the prestaged manifest as USER node'
    $dockerIgnore = Get-Content -LiteralPath $dockerIgnorePath -Raw
    $activeDockerIgnoreRules = @(
        ($dockerIgnore -split "`r?`n") |
            ForEach-Object { $_.Trim() } |
            Where-Object { $_ -and -not $_.StartsWith('#') -and -not $_.StartsWith('!') }
    )
    Assert-True (-not ($activeDockerIgnoreRules -match '(?i)tests|env-allowlist|json')) 'Docker context does not exclude the canonical structured-log env allow-list source'
    Assert-True ($dockerIgnore -match 'web-viewer-sample/public/\.design-assets-stage-\*/') 'Docker context excludes failed temporary design-asset staging directories'
    Assert-True ($dockerIgnore -match 'web-viewer-sample/public/\.design-assets-backup-\*/') 'Docker context excludes retained rollback backups'
    Assert-True ($dockerIgnore -match 'web-viewer-sample/public/\.design-assets-sync\.lock') 'Docker context excludes the cross-adapter design-asset lock'
    Assert-True ($dockerIgnore -match 'web-viewer-sample/scripts/test-sync-design-assets-publication\.mjs') 'Docker context excludes the publication fault-injection test'

    Assert-True (Test-Path -LiteralPath $designAssetsLibPath -PathType Leaf) 'shared deployment design-assets helper exists'
    $designAssetsLib = Get-Content -LiteralPath $designAssetsLibPath -Raw
    Assert-True ($designAssetsLib -match 'design-assets/v1') 'deployment design-assets helper writes a versioned manifest'
    Assert-True ($designAssetsLib -match 'Get-FileHash.+SHA256') 'deployment design-assets helper verifies SHA-256'
    Assert-True ($designAssetsLib -match 'Get-DeploymentDesignAssetItemIfPresent') 'deployment design-assets helper distinguishes missing paths from access or IO failures'
    Assert-True ($designAssetsLib -match 'caller-owned deployment design assets lock') 'deployment design-assets helper accepts only its own live caller-owned lock'

    $syncDesignAssets = Get-Content -LiteralPath $syncDesignAssetsPath -Raw
    Assert-True ($syncDesignAssets -match 'verified.+prestaged png') 'viewer prebuild validates prestaged assets when root docs are absent'
    Assert-True ($syncDesignAssets -match 'prestaged asset hash mismatch') 'viewer prebuild rejects stale or tampered prestaged assets'
    Assert-True ($syncDesignAssets -match 'export function publishStagedDirectory') 'viewer publication transaction exposes a narrow fault-injection test seam'

    $rebuildLib = Get-Content -LiteralPath $rebuildLibPath -Raw
    Assert-True ($rebuildLib -match 'Initialize-TestDeployDesignAssets') 'test deployment stages design assets before tooling cleanup'
    Assert-True ($rebuildLib -match 'DesignAssetLockHandle \$designAssetLockHandle') 'existing-checkout rebuild keeps one caller-owned asset lock through staging'
    foreach ($cleanExclusion in @(
        'web-viewer-sample/public/design-assets/',
        'web-viewer-sample/public/.design-assets-stage-*',
        'web-viewer-sample/public/.design-assets-backup-*',
        'web-viewer-sample/public/.design-assets-sync.lock'
    )) {
        Assert-True ($rebuildLib.Contains("'$cleanExclusion'")) "git clean preserves design-assets transaction path: $cleanExclusion"
    }

    $startWebPlane = Get-Content -LiteralPath $startWebPlanePath -Raw
    Assert-True ($startWebPlane -match "lib\\design-assets\.ps1") 'hybrid web-plane adapter imports design-assets staging'
    Assert-True ($startWebPlane -match 'Sync-DeploymentDesignAssets -RepoRoot \$repoRootForStorage') 'hybrid web-plane adapter stages assets before compose up'

    $startRuntimeManager = Get-Content -LiteralPath $startRuntimeManagerPath -Raw
    Assert-True ($startRuntimeManager -match "lib\\design-assets\.ps1") 'runtime-manager adapter imports design-assets staging'
    Assert-True ($startRuntimeManager -match 'Sync-DeploymentDesignAssets -RepoRoot \$repoRoot') 'runtime-manager adapter stages assets before compose up'

    $compose = Get-Content -LiteralPath $composePath -Raw
    $coordinatorComposeBlock = [regex]::Match($compose, '(?ms)^  coordinator:\r?\n(?<body>.*?)(?=^  [A-Za-z0-9_-]+:|\z)')
    $viewerComposeBlock = [regex]::Match($compose, '(?ms)^  viewer:\r?\n(?<body>.*?)(?=^  [A-Za-z0-9_-]+:|\z)')
    Assert-True $coordinatorComposeBlock.Success 'compose contains coordinator service block'
    Assert-True $viewerComposeBlock.Success 'compose contains viewer service block'
    Assert-True ($coordinatorComposeBlock.Groups['body'].Value -match '(?m)^      context: \.\r?$') 'coordinator build context remains repo root'
    Assert-True ($viewerComposeBlock.Groups['body'].Value -match '(?m)^      context: \.\r?$') 'viewer build context remains repo root'
    Assert-True ($coordinatorComposeBlock.Groups['body'].Value -match '(?m)^      CONVERSION_LEDGER_STORE_PATH: /workspace/storage/coordinator/conversion-ledger\.json\r?$') 'coordinator conversion ledger uses persistent storage mount'
    Assert-True ($coordinatorComposeBlock.Groups['body'].Value -match '(?m)^      CALLBACK_OUTBOX_STORE_PATH: /workspace/storage/coordinator/callback-outbox\.json\r?$') 'coordinator callback outbox uses persistent storage mount'
    Assert-True ($coordinatorComposeBlock.Groups['body'].Value -match '(?m)^      EXTERNAL_IFC_READY_STORE_PATH: /workspace/storage/coordinator/external-ifc-ready\.json\r?$') 'coordinator external IFC-ready correlation store uses persistent storage mount'
    Assert-True ($coordinatorComposeBlock.Groups['body'].Value -match '(?m)^      SESSION_STORE_DIR: /workspace/storage/coordinator/sessions\r?$') 'coordinator review sessions use persistent storage mount'
    Assert-True ($coordinatorComposeBlock.Groups['body'].Value -match '(?m)^      EVENT_LOG_DIR: /workspace/storage/coordinator/events\r?$') 'coordinator lifecycle events use persistent storage mount'
    Assert-True ($coordinatorComposeBlock.Groups['body'].Value -match '(?m)^      - \$\{RUNTIME_STORAGE_ROOT:-\./storage\}:/workspace/storage\r?$') 'coordinator state paths share owner-controlled runtime storage mount'
    Assert-True ($compose -match 'dockerfile:\s+infra/docker/coordinator-web-plane\.Dockerfile') 'coordinator uses dedicated Dockerfile'
    Assert-True ($compose -match 'CONSOLE_DIST_DIR:\s+/workspace/console-dist') 'compose points coordinator at image console-dist'
    Assert-True (-not ($compose -match 'web-viewer-sample/dist-ui:/workspace/console-dist')) 'compose does not bind-mount ignored host dist-ui over image bundle'

    $deploy = Get-Content -LiteralPath $deployPath -Raw
    Assert-True ($deploy -match 'Sync-DeploymentDesignAssets -RepoRoot \$RepoRoot') 'deploy refreshes or validates design assets before image build'
    Assert-True ($deploy -match 'function Probe-UiAsset') 'deploy verifies built /ui assets'
    Assert-True ($deploy -match 'coordinator-ui-edge-console-shell') 'deploy logs EdgeConsole shell verification'
    Assert-True ($deploy -match '/ui/assets/') 'deploy checks Vite /ui asset references'

    Write-TestPass $testName
} catch {
    Write-TestFail $testName $_.Exception.Message
    throw
}
