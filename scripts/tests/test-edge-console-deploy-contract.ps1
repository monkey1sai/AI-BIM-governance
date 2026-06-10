[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'test-helpers.ps1')

$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$testName = 'edge-console-deploy-contract'

try {
    $dockerfilePath = Join-Path $repoRoot 'infra\docker\coordinator-web-plane.Dockerfile'
    $composePath = Join-Path $repoRoot 'compose.runtime-manager.yml'
    $deployPath = Join-Path $repoRoot 'scripts\deploy.ps1'

    Assert-True (Test-Path -LiteralPath $dockerfilePath -PathType Leaf) 'coordinator web-plane Dockerfile exists'
    $dockerfile = Get-Content -LiteralPath $dockerfilePath -Raw
    Assert-True ($dockerfile -match 'AS console-build') 'Dockerfile has a console build stage'
    Assert-True ($dockerfile -match 'npm run build:ui') 'Dockerfile builds the /ui bundle'
    Assert-True ($dockerfile -match 'COPY --from=console-build /workspace/web-viewer-sample/dist-ui /workspace/console-dist') 'Dockerfile copies dist-ui into image console-dist'
    Assert-True ($dockerfile -match 'ENV CONSOLE_DIST_DIR=/workspace/console-dist') 'Dockerfile sets CONSOLE_DIST_DIR'

    $compose = Get-Content -LiteralPath $composePath -Raw
    Assert-True ($compose -match 'dockerfile:\s+infra/docker/coordinator-web-plane\.Dockerfile') 'coordinator uses dedicated Dockerfile'
    Assert-True ($compose -match 'CONSOLE_DIST_DIR:\s+/workspace/console-dist') 'compose points coordinator at image console-dist'
    Assert-True (-not ($compose -match 'web-viewer-sample/dist-ui:/workspace/console-dist')) 'compose does not bind-mount ignored host dist-ui over image bundle'

    $deploy = Get-Content -LiteralPath $deployPath -Raw
    Assert-True ($deploy -match 'function Probe-UiAsset') 'deploy verifies built /ui assets'
    Assert-True ($deploy -match 'coordinator-ui-edge-console-shell') 'deploy logs EdgeConsole shell verification'
    Assert-True ($deploy -match '/ui/assets/') 'deploy checks Vite /ui asset references'

    Write-TestPass $testName
} catch {
    Write-TestFail $testName $_.Exception.Message
    throw
}
