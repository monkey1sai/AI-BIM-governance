[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Assert-True {
    param([Parameter(Mandatory = $true)] $Condition, [Parameter(Mandatory = $true)][string] $Message)
    if (-not $Condition) { throw "ASSERT FAILED: $Message" }
}

$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../..')).Path
. (Join-Path $repoRoot 'scripts/lib/design-system-gate.ps1')
Assert-True (-not (Test-DesignSystemPathPatterns -Path 'web-viewer-sample/src/App.tsx' -Patterns @($null, ''))) 'missing optional manifest patterns never match every path'
$manifest = Get-Content -LiteralPath (Join-Path $repoRoot 'docs/plans/design-system-reference.manifest.json') -Raw | ConvertFrom-Json

$partial = Get-DesignSystemChangeScope -RepoRoot $repoRoot -ChangedPaths @('apps/kit-manager-web/src/App.tsx')
Assert-True ($partial.status -eq 'partial_reference_missing') 'Kit Manager is partial_reference_missing'
Assert-True (-not $partial.visual_required) 'pure reference-missing surface does not fabricate a visual result'
Assert-True (($partial.reference_missing_items -join '|') -eq 'surface:kit-manager-web') 'Kit Manager missing reference is explicit'

$mixed = Get-DesignSystemChangeScope -RepoRoot $repoRoot -ChangedPaths @('web-viewer-sample/src/App.tsx')
Assert-True ($mixed.status -eq 'mixed') 'shared EdgeConsole bundle is mixed'
Assert-True $mixed.visual_required 'mixed EdgeConsole scope requires visual gate'
$approvedScreenCount = @($manifest.screens).Count
Assert-True ($approvedScreenCount -gt 0) 'manifest declares at least one approved screen'
Assert-True ($mixed.required_screen_ids.Count -eq $approvedScreenCount) 'mixed EdgeConsole scope requires all approved screens'
Assert-True ($mixed.reference_missing_items -contains '#viewer') 'mixed EdgeConsole scope discloses missing routes'
Assert-True (-not $mixed.full_completion_allowed) 'semantic state variants currently prevent full completion'
Assert-True ($manifest.fidelity_contract.dependency_tree_status -eq 'resolved_snapshot_pinned') 'resolved dependency snapshot is pinned'
Assert-True (-not $mixed.fidelity_deterministic) 'label-only runner/font environment still prevents deterministic 99% completion claims'

$refactoredViewer = Get-DesignSystemChangeScope -RepoRoot $repoRoot -ChangedPaths @('web-viewer-sample/ui/NewConsole.tsx')
Assert-True ($refactoredViewer.status -eq 'mixed') 'viewer surface remains governed after an internal folder refactor'
$refactoredKit = Get-DesignSystemChangeScope -RepoRoot $repoRoot -ChangedPaths @('apps/kit-manager-web/ui/NewFleet.tsx')
Assert-True ($refactoredKit.status -eq 'partial_reference_missing') 'Kit Manager surface remains governed after an internal folder refactor'
$refactoredCoordinator = Get-DesignSystemChangeScope -RepoRoot $repoRoot -ChangedPaths @('bim-review-coordinator/frontend/NewConsole.tsx')
Assert-True ($refactoredCoordinator.status -eq 'partial_reference_missing') 'coordinator frontend refactor remains governed'
$nonProduct = Get-DesignSystemChangeScope -RepoRoot $repoRoot -ChangedPaths @('web-viewer-sample/README.md')
Assert-True ($nonProduct.status -eq 'not_applicable') 'known frontend-repo documentation is explicitly non-product'
foreach ($documentationPath in @(
    'docs/architecture/diagram.png',
    'docs/plans/ai-bim-governance-prototype.html',
    'docs/plans/ai-bim-geo-viewer-A1.png',
    'README-assets/screenshot.webp'
)) {
    $documentationScope = Get-DesignSystemChangeScope -RepoRoot $repoRoot -ChangedPaths @($documentationPath)
    Assert-True ($documentationScope.status -eq 'not_applicable') "documentation companion/assets stay outside product UI scope: $documentationPath"
}
$mixedWithEvidence = Get-DesignSystemChangeScope -RepoRoot $repoRoot -ChangedPaths @(
    'web-viewer-sample/src/App.tsx',
    'artifacts/e2e/a1.png'
)
Assert-True ($mixedWithEvidence.status -eq 'mixed') 'tracked E2E screenshot does not turn a governed product PR into unknown_fail_closed'
Assert-True ($mixedWithEvidence.unknown_paths.Count -eq 0) 'tracked E2E evidence remains non-product while the product path stays governed'

$infrastructure = Get-DesignSystemChangeScope -RepoRoot $repoRoot -ChangedPaths @('scripts/tests/verify-design-system-reference.ps1')
Assert-True ($infrastructure.status -eq 'gate_infrastructure_only') 'design gate tooling is not misclassified as product UI'
Assert-True (-not $infrastructure.frontend_product) 'gate infrastructure does not require a fabricated product result'
$dotInfrastructure = Get-DesignSystemChangeScope -RepoRoot $repoRoot -ChangedPaths @('.github/workflows/ci.yml')
Assert-True ($dotInfrastructure.status -eq 'gate_infrastructure_only') 'legal top-level dot-directory path remains intact during normalization'
Assert-True ($dotInfrastructure.gate_infrastructure_paths -contains '.github/workflows/ci.yml') '.github workflow is tracked as gate infrastructure'

$unknown = Get-DesignSystemManifestScope -Manifest $manifest -ChangedPaths @('apps/future-ui/new-shell.tsx')
Assert-True ($unknown.unknown_paths -contains 'apps/future-ui/new-shell.tsx') 'candidate frontend root without an owned surface fails closed'
foreach ($unknownRefactorPath in @(
    'frontend/NewConsole.ts',
    'ui/NewConsole.ts',
    'packages/shell/src/App.tsx',
    'apps/console/src/App.tsx',
    'packages/shell/src/router.ts',
    'apps/console/src/runtime.ts',
    'packages/shell/src/store.js',
    'apps/console/src/app.mjs',
    'packages/shell/src/logo.svg',
    'apps/console/public/logo.png',
    'packages/shell/src/theme.json',
    'apps/console/package.json',
    'console/assets/brand.woff2',
    'services/new-runtime/frontend/router.ts',
    'services/new-runtime/public/theme.json',
    'governance-service/ui/App.tsx',
    'bim-streaming-server/public/index.html',
    'services/kit-manager-api/frontend/App.tsx',
    'services/admin-ui/src/App.tsx',
    'modules/frontend-shell/src/App.tsx',
    'platform/web-console/src/App.tsx',
    'src/client-app/App.tsx',
    'infra/web-console/App.tsx',
    'storage/ui/index.html',
    'rules/frontend/editor.tsx'
)) {
    $unknownRefactor = Get-DesignSystemChangeScope -RepoRoot $repoRoot -ChangedPaths @($unknownRefactorPath)
    Assert-True ($unknownRefactor.status -eq 'unknown_fail_closed') "new frontend root fails closed until registered: $unknownRefactorPath"
}
foreach ($deferredAssetPath in @(
    'bim-streaming-server/readme-assets/python_ui_extension_template.jpg',
    'bim-streaming-server/templates/extensions/python_ui/template/data/icon.png',
    'bim-streaming-server/templates/extensions/python_ui/template/data/preview.png'
)) {
    $deferredAssetScope = Get-DesignSystemChangeScope -RepoRoot $repoRoot -ChangedPaths @($deferredAssetPath)
    Assert-True ($deferredAssetScope.status -eq 'not_applicable') "deferred OpenUSD extension/template asset stays outside this web design gate: $deferredAssetPath"
}
foreach ($tokenFalsePositivePath in @(
    'build/cache.bin',
    'guides/topic.md',
    'suite/results.json',
    'webhooks/handler.ts',
    '.env.web-plane.host-kit.example',
    'bim-review-coordinator/src/console_client.test.ts',
    'bim-streaming-server/ui_state_manager.py',
    'governance-service/llm_client.py'
)) {
    $tokenFalsePositiveScope = Get-DesignSystemChangeScope -RepoRoot $repoRoot -ChangedPaths @($tokenFalsePositivePath)
    Assert-True ($tokenFalsePositiveScope.status -eq 'not_applicable') "frontend token matching requires segment/delimiter boundaries: $tokenFalsePositivePath"
}

$renameRoot = Join-Path $repoRoot "artifacts/tmp/design-scope-rename-$([guid]::NewGuid().ToString('N'))"
New-Item -ItemType Directory -Path (Join-Path $renameRoot 'docs/plans') -Force | Out-Null
try {
    Push-Location $renameRoot
    try {
        git init -q
        git config user.email 'design-scope@example.invalid'
        git config user.name 'Design Scope Test'
        Copy-Item -LiteralPath (Join-Path $repoRoot 'docs/plans/design-system-reference.manifest.json') -Destination 'docs/plans/design-system-reference.manifest.json'
        New-Item -ItemType Directory -Path 'web-viewer-sample/src' -Force | Out-Null
        Set-Content -LiteralPath 'web-viewer-sample/src/Foo.tsx' -Value 'export const Foo = () => null;' -Encoding utf8
        git add .
        git commit -q -m 'base governed frontend path'
        $renameBase = (git rev-parse HEAD).Trim()

        New-Item -ItemType Directory -Path 'server' -Force | Out-Null
        git mv 'web-viewer-sample/src/Foo.tsx' 'server/foo.py'
        git commit -q -m 'rename governed frontend path outside candidate roots'
        $renameHead = (git rev-parse HEAD).Trim()
        $renamePaths = @(& git diff --no-renames --name-only "$renameBase...$renameHead")
        if ($LASTEXITCODE -ne 0) { throw 'Unable to compute rename-safe fixture diff.' }
    } finally {
        Pop-Location
    }
    Assert-True ($renamePaths -contains 'web-viewer-sample/src/Foo.tsx') 'rename-safe diff preserves the governed old path'
    Assert-True ($renamePaths -contains 'server/foo.py') 'rename-safe diff preserves the new path'
    $renameScope = Get-DesignSystemChangeScope -RepoRoot $renameRoot -ChangedPaths $renamePaths -BaseSha $renameBase -HeadSha $renameHead
    Assert-True $renameScope.frontend_product 'R100 move out of a governed frontend root cannot bypass frontend evidence'
    Assert-True $renameScope.visual_required 'R100 move out of an approved surface still requires visual evidence'
} finally {
    Remove-Item -LiteralPath $renameRoot -Recurse -Force -ErrorAction SilentlyContinue
}

$narrowRoot = Join-Path $repoRoot "artifacts/tmp/design-scope-narrow-$([guid]::NewGuid().ToString('N'))"
foreach ($directory in @('docs/plans/design-system-baseline', 'web-viewer-sample/src')) {
    New-Item -ItemType Directory -Path (Join-Path $narrowRoot $directory) -Force | Out-Null
}
try {
    Push-Location $narrowRoot
    try {
        git init -q
        git config user.email 'design-scope@example.invalid'
        git config user.name 'Design Scope Test'
        Copy-Item -LiteralPath (Join-Path $repoRoot 'docs/plans/design-system-reference.manifest.json') -Destination 'docs/plans/design-system-reference.manifest.json'
        Set-Content -LiteralPath 'docs/plans/design-system-baseline/probe.png' -Value 'base golden' -Encoding utf8
        Set-Content -LiteralPath 'web-viewer-sample/src/App.tsx' -Value 'export const App = () => 1;' -Encoding utf8
        git add .
        git commit -q -m 'base approved reference and product'
        $narrowBase = (git rev-parse HEAD).Trim()

        $narrowManifest = Get-Content -LiteralPath 'docs/plans/design-system-reference.manifest.json' -Raw | ConvertFrom-Json
        $removedScreenId = [string]$narrowManifest.screens[0].id
        $narrowManifest.screens = @($narrowManifest.screens | Select-Object -Skip 1)
        $narrowManifest | ConvertTo-Json -Depth 100 | Set-Content -LiteralPath 'docs/plans/design-system-reference.manifest.json' -Encoding utf8
        Set-Content -LiteralPath 'docs/plans/design-system-baseline/probe.png' -Value 'replacement golden' -Encoding utf8
        Set-Content -LiteralPath 'web-viewer-sample/src/App.tsx' -Value 'export const App = () => 2;' -Encoding utf8
        git add .
        git commit -q -m 'attempt product and reference goalpost move'
        $narrowHead = (git rev-parse HEAD).Trim()
        $narrowPaths = @(& git diff --no-renames --name-only "$narrowBase...$narrowHead")
        if ($LASTEXITCODE -ne 0) { throw 'Unable to compute narrowing fixture diff.' }
    } finally {
        Pop-Location
    }
    $narrowScope = Get-DesignSystemChangeScope -RepoRoot $narrowRoot -ChangedPaths $narrowPaths -BaseSha $narrowBase -HeadSha $narrowHead
    Assert-True ($narrowScope.status -eq 'reference_authority_mixed_fail_closed') 'product and reference authority changes cannot move visual goalposts in one PR'
    Assert-True ($narrowScope.reference_authority_paths -contains 'docs/plans/design-system-reference.manifest.json') 'manifest replacement is disclosed as reference authority'
    Assert-True ($narrowScope.reference_authority_paths -contains 'docs/plans/design-system-baseline/probe.png') 'golden replacement is disclosed as reference authority'
    Assert-True ($narrowScope.required_screen_ids -contains $removedScreenId) 'base-approved screen remains required by the base/head union'
} finally {
    Remove-Item -LiteralPath $narrowRoot -Recurse -Force -ErrorAction SilentlyContinue
}

$tempRoot = Join-Path $repoRoot "artifacts/tmp/design-scope-$([guid]::NewGuid().ToString('N'))"
New-Item -ItemType Directory -Path (Join-Path $tempRoot 'web-viewer-sample') -Force | Out-Null
try {
    Push-Location $tempRoot
    try {
        git init -q
        git config user.email 'design-scope@example.invalid'
        git config user.name 'Design Scope Test'
        @{
            name = 'fixture'
            private = $true
            scripts = @{ test = 'echo test' }
            dependencies = @{ react = '^18.2.0' }
            devDependencies = @{}
        } | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath 'web-viewer-sample/package.json' -Encoding utf8
        git add .
        git commit -q -m 'base without manifest'
        $baseSha = (git rev-parse HEAD).Trim()

        New-Item -ItemType Directory -Path 'docs/plans' -Force | Out-Null
        Copy-Item -LiteralPath (Join-Path $repoRoot 'docs/plans/design-system-reference.manifest.json') -Destination 'docs/plans/design-system-reference.manifest.json'
        $package = Get-Content -LiteralPath 'web-viewer-sample/package.json' -Raw | ConvertFrom-Json
        $package.scripts | Add-Member -NotePropertyName 'test:visual:design-system' -NotePropertyValue 'playwright test --config=playwright.design-system.config.ts'
        foreach ($entry in @{
            '@playwright/test' = '1.61.1'
            '@types/pngjs' = '6.0.5'
            pixelmatch = '7.1.0'
            pngjs = '7.0.0'
        }.GetEnumerator()) {
            $package.devDependencies | Add-Member -NotePropertyName $entry.Key -NotePropertyValue $entry.Value
        }
        $package | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath 'web-viewer-sample/package.json' -Encoding utf8
        git add .
        git commit -q -m 'bootstrap gate'
        $bootstrapHead = (git rev-parse HEAD).Trim()
    } finally {
        Pop-Location
    }

    $bootstrap = Get-DesignSystemChangeScope -RepoRoot $tempRoot -ChangedPaths @(
        'docs/plans/design-system-reference.manifest.json',
        'web-viewer-sample/package.json'
    ) -BaseSha $baseSha -HeadSha $bootstrapHead
    Assert-True ($bootstrap.status -eq 'gate_infrastructure_only') 'first manifest bootstrap permits only the exact pinned visual-tool package entries'
    Assert-True ($bootstrap.bootstrap_gate_infrastructure_paths -contains 'web-viewer-sample/package.json') 'bootstrap exception is explicit and observable'

    Push-Location $tempRoot
    try {
        $package = Get-Content -LiteralPath 'web-viewer-sample/package.json' -Raw | ConvertFrom-Json
        $package.dependencies.react = '^19.0.0'
        $package | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath 'web-viewer-sample/package.json' -Encoding utf8
        git add .
        git commit -q -m 'also changes product dependency'
        $unsafeHead = (git rev-parse HEAD).Trim()
    } finally {
        Pop-Location
    }
    $unsafe = Get-DesignSystemChangeScope -RepoRoot $tempRoot -ChangedPaths @(
        'docs/plans/design-system-reference.manifest.json',
        'web-viewer-sample/package.json'
    ) -BaseSha $baseSha -HeadSha $unsafeHead
    Assert-True ($unsafe.status -eq 'reference_authority_mixed_fail_closed') 'bootstrap rule fails closed when package.json also changes product dependencies alongside new reference authority'
} finally {
    Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host '[test-design-system-change-scope] all assertions passed'
