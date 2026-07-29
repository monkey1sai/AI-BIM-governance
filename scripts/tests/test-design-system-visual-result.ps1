Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../..')).Path
$validator = Join-Path $PSScriptRoot 'verify-design-system-visual-result.ps1'
$diffWriter = Join-Path $repoRoot 'web-viewer-sample/scripts/test-fixtures/write-pixelmatch-diff.mjs'
$canonicalManifestPath = Join-Path $repoRoot 'docs/plans/design-system-reference.manifest.json'
$manifest = Get-Content -LiteralPath $canonicalManifestPath -Raw | ConvertFrom-Json
$tempId = [guid]::NewGuid().ToString('N')
$artifactRoot = Join-Path $repoRoot "artifacts/e2e/design-system-visual/_gate-test-$tempId"
$resultPath = Join-Path $artifactRoot 'design-system-visual-result.json'
New-Item -ItemType Directory -Force -Path $artifactRoot | Out-Null

$manifest.semantic_contract.status = 'executable'
$manifest.semantic_contract.implemented_case_ids = @($manifest.semantic_contract.required_case_ids)
$manifestPath = Join-Path $artifactRoot 'executable-manifest.json'
$manifest | ConvertTo-Json -Depth 30 | Set-Content -LiteralPath $manifestPath -Encoding utf8
$manifestHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $manifestPath).Hash.ToLowerInvariant()

function New-Result {
    $screenResults = @()
    foreach ($screen in $manifest.screens) {
        $semanticStates = [ordered]@{}
        foreach ($state in $manifest.required_semantic_states) {
            $semanticStates[[string]$state] = $true
        }
        $viewports = @()
        $screenArtifactRoot = Join-Path $artifactRoot ([string]$screen.id)
        New-Item -ItemType Directory -Force -Path $screenArtifactRoot | Out-Null
        foreach ($viewport in $manifest.fidelity_contract.viewports) {
            $baseline = $screen.baselines.PSObject.Properties[[string]$viewport.id].Value
            $actualRelative = "artifacts/e2e/design-system-visual/_gate-test-$tempId/$($screen.id)/$($viewport.id)-actual.png"
            $diffRelative = "artifacts/e2e/design-system-visual/_gate-test-$tempId/$($screen.id)/$($viewport.id)-diff.png"
            $source = Join-Path $repoRoot ([string]$baseline.path)
            $actual = Join-Path $repoRoot $actualRelative
            $diff = Join-Path $repoRoot $diffRelative
            Copy-Item -LiteralPath $source -Destination $actual -Force
            $ratio = (& node $diffWriter $source $actual $diff ([string]$manifest.fidelity_contract.pixelmatch_color_threshold))
            if ($LASTEXITCODE -ne 0) { throw 'Unable to create pixelmatch test fixture.' }
            $viewports += [ordered]@{
                id = $viewport.id
                diff_pixel_ratio = [double]$ratio
                baseline_path = $baseline.path
                baseline_sha256 = $baseline.sha256
                actual_path = $actualRelative
                actual_sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $actual).Hash.ToLowerInvariant()
                diff_path = $diffRelative
                diff_sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $diff).Hash.ToLowerInvariant()
            }
        }
        $screenResults += [ordered]@{
            id = $screen.id
            production_route = $screen.production_routes[0]
            semantic_parity = 1
            semantic_states = $semanticStates
            semantic_case_ids = @($manifest.semantic_contract.required_case_ids)
            semantic_assertions = @($manifest.semantic_contract.required_case_ids | ForEach-Object {
                [ordered]@{
                    case_id = [string]$_
                    assertion_id = "$_-fixture-observation"
                    locator = '#fixture'
                    expectation = 'visible'
                    expected = $null
                    attribute = $null
                    observed = $true
                    passed = $true
                }
            })
            semantic_producer = 'playwright-inline-cases'
            viewports = $viewports
        }
    }
    return [ordered]@{
        schema_version = 2
        kind = 'ai-bim-design-system-visual-result'
        status = 'passed'
        generated_at_utc = [datetimeoffset]::UtcNow.ToString('o')
        subject_commit = '0000000000000000000000000000000000000000'
        manifest_sha256 = $manifestHash
        source_snapshot_sha256 = $manifest.source.snapshot_sha256
        baseline_snapshot_sha256 = $manifest.baseline_snapshot_sha256
        browser = 'chromium'
        platform = $manifest.fidelity_contract.platform
        ci_runner_label = 'local-windows'
        playwright_version = $manifest.fidelity_contract.playwright_version
        chromium_revision = $manifest.fidelity_contract.chromium_revision
        chromium_version = $manifest.fidelity_contract.chromium_version
        workspace_clean = $true
        device_scale_factor = 1
        semantic_contract_schema_version = $manifest.semantic_contract.schema_version
        screens = $screenResults
    }
}

function Write-Result {
    param([Parameter(Mandatory = $true)] $Value)
    $Value | ConvertTo-Json -Depth 30 | Set-Content -LiteralPath $resultPath -Encoding utf8
}

function Assert-Rejected {
    param(
        [Parameter(Mandatory = $true)][scriptblock] $Mutation,
        [Parameter(Mandatory = $true)][string] $ExpectedPattern
    )
    $candidate = $script:validJson | ConvertFrom-Json
    & $Mutation $candidate
    Write-Result -Value $candidate
    $caught = $null
    try {
        & $validator -RepoRoot $repoRoot -ManifestPath $manifestPath -ResultPath $resultPath -AllowUntrackedArtifacts -SkipGitBinding
    } catch {
        $caught = $_.Exception.Message
    }
    if ($null -eq $caught -or $caught -notmatch $ExpectedPattern) {
        throw "Expected visual-result rejection matching '$ExpectedPattern'; actual='$caught'."
    }
}

try {
    $valid = New-Result
    $script:validJson = $valid | ConvertTo-Json -Depth 30
    Write-Result -Value $valid
    & $validator -RepoRoot $repoRoot -ManifestPath $manifestPath -ResultPath $resultPath -AllowUntrackedArtifacts -SkipGitBinding

    Assert-Rejected -ExpectedPattern 'PNG recomputation failed' -Mutation {
        param($candidate)
        $candidate.screens[0].viewports[0].diff_pixel_ratio = 0.011
    }
    Assert-Rejected -ExpectedPattern "semantic state 'failure'" -Mutation {
        param($candidate)
        $candidate.screens[0].semantic_states.failure = $false
    }
    Assert-Rejected -ExpectedPattern 'exact semantic case set' -Mutation {
        param($candidate)
        $candidate.screens[0].semantic_case_ids = @($candidate.screens[0].semantic_case_ids | Select-Object -Skip 1)
    }
    Assert-Rejected -ExpectedPattern 'spec-executed semantic assertions' -Mutation {
        param($candidate)
        $candidate.screens[0].semantic_assertions = @($candidate.screens[0].semantic_assertions | Where-Object case_id -ne 'loading')
    }
    Assert-Rejected -ExpectedPattern 'schema_version must be 2' -Mutation {
        param($candidate)
        $candidate.schema_version = 1
    }
    Assert-Rejected -ExpectedPattern 'result platform' -Mutation {
        param($candidate)
        $candidate.platform = 'linux'
    }
    Assert-Rejected -ExpectedPattern 'Playwright version' -Mutation {
        param($candidate)
        $candidate.playwright_version = '0.0.0'
    }
    Assert-Rejected -ExpectedPattern 'clean subject commit' -Mutation {
        param($candidate)
        $candidate.workspace_clean = $false
    }
    Assert-Rejected -ExpectedPattern 'clean subject commit' -Mutation { param($candidate) $candidate.workspace_clean = 'false' }
    Assert-Rejected -ExpectedPattern 'semantic state' -Mutation { param($candidate) $candidate.screens[0].semantic_states.failure = 'false' }
    Assert-Rejected -ExpectedPattern 'current manifest SHA-256' -Mutation {
        param($candidate)
        $candidate.manifest_sha256 = ('0' * 64)
    }
    Assert-Rejected -ExpectedPattern 'every approved manifest screen' -Mutation {
        param($candidate)
        $candidate.screens = @($candidate.screens | Select-Object -Skip 1)
    }

    $headFixtureRoot = Join-Path ([System.IO.Path]::GetTempPath()) "design-visual-head-$([guid]::NewGuid().ToString('N'))"
    try {
        foreach ($directory in @('docs/plans', 'scripts/lib', 'web-viewer-sample/scripts', 'artifacts/e2e')) {
            New-Item -ItemType Directory -Path (Join-Path $headFixtureRoot $directory) -Force | Out-Null
        }
        $headManifest = $manifest | ConvertTo-Json -Depth 30 | ConvertFrom-Json
        $headManifest.screens = @($headManifest.screens[0])
        $headManifest.fidelity_contract.viewports = @($headManifest.fidelity_contract.viewports[0])
        $headManifestPath = Join-Path $headFixtureRoot 'docs/plans/design-system-reference.manifest.json'
        $headManifest | ConvertTo-Json -Depth 30 | Set-Content -LiteralPath $headManifestPath -Encoding utf8
        Copy-Item -LiteralPath (Join-Path $repoRoot 'scripts/lib/design-system-gate.ps1') -Destination (Join-Path $headFixtureRoot 'scripts/lib/design-system-gate.ps1')
        Copy-Item -LiteralPath (Join-Path $repoRoot 'artifacts/e2e/.gitignore') -Destination (Join-Path $headFixtureRoot 'artifacts/e2e/.gitignore')
        'process.exit(0);' | Set-Content -LiteralPath (Join-Path $headFixtureRoot 'web-viewer-sample/scripts/verify-design-system-pixels.mjs') -Encoding utf8

        Push-Location $headFixtureRoot
        try {
            git init -q
            git config user.email 'design-visual@example.invalid'
            git config user.name 'Design Visual Test'
            git add .
            git commit -q -m 'commit-bound visual fixture'
            $headSha = (git rev-parse HEAD).Trim()
        } finally {
            Pop-Location
        }

        $headResult = New-Result
        $headResult.screens = @($headResult.screens[0])
        $headResult.screens[0].viewports = @($headResult.screens[0].viewports[0])
        $headResult.subject_commit = $headSha
        $headResult.manifest_sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $headManifestPath).Hash.ToLowerInvariant()
        foreach ($viewportResult in @($headResult.screens[0].viewports)) {
            foreach ($pathProperty in @('actual_path', 'diff_path')) {
                $relativePath = [string]$viewportResult.$pathProperty
                $destination = Join-Path $headFixtureRoot $relativePath
                New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force | Out-Null
                Copy-Item -LiteralPath (Join-Path $repoRoot $relativePath) -Destination $destination
            }
        }
        $headResultPath = Join-Path $headFixtureRoot 'artifacts/e2e/design-system-visual-result.json'
        $headResult | ConvertTo-Json -Depth 30 | Set-Content -LiteralPath $headResultPath -Encoding utf8
        & $validator -RepoRoot $headFixtureRoot -ManifestPath $headManifestPath -ResultPath $headResultPath -TargetCommit HEAD -AllowUntrackedArtifacts
    } finally {
        Remove-Item -LiteralPath $headFixtureRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
} finally {
    Remove-Item -LiteralPath $artifactRoot -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host '[test-design-system-visual-result] passed — v2 full-screen result plus pixel/semantic/manifest/screen negative cases'
