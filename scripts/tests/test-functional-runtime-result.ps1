Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../..')).Path
$validator = Join-Path $PSScriptRoot 'verify-functional-runtime-result.ps1'
$tempId = [guid]::NewGuid().ToString('N')
$artifactRoot = Join-Path $repoRoot "artifacts/e2e/functional-runtime/_gate-test-$tempId"
$resultPath = Join-Path $artifactRoot 'functional-runtime-result.json'
$screenshotPath = Join-Path $artifactRoot 'success.png'
$tracePath = Join-Path $artifactRoot 'trace.zip'
New-Item -ItemType Directory -Force -Path $artifactRoot | Out-Null
[System.IO.File]::WriteAllBytes($screenshotPath, [byte[]](1, 2, 3, 4))
[System.IO.File]::WriteAllBytes($tracePath, [byte[]](5, 6, 7, 8))

function Get-RelativeArtifactPath {
    param([Parameter(Mandatory = $true)][string] $LiteralPath)
    return [System.IO.Path]::GetRelativePath($repoRoot, $LiteralPath).Replace('\', '/')
}

function Get-Sha256 {
    param([Parameter(Mandatory = $true)][string] $LiteralPath)
    return (Get-FileHash -Algorithm SHA256 -LiteralPath $LiteralPath).Hash.ToLowerInvariant()
}

function New-Result {
    return [ordered]@{
        schema_version = 1
        kind = 'ai-bim-functional-runtime-result'
        status = 'passed'
        generated_at_utc = [datetimeoffset]::UtcNow.ToString('o')
        subject_commit = '0000000000000000000000000000000000000000'
        workspace_clean = $true
        skipped = $false
        blocked = $false
        route = '#conv'
        scope = 'history_result_only'
        full_route_coverage = $false
        known_gaps = @('watch and control actions are not covered by this slice')
        main_buttons_tested = @('重新整理', '查看結果')
        fixture = 'conversion-history.default'
        backend_api = [ordered]@{
            requests = @(
                [ordered]@{ method = 'GET'; path = '/api/external/ifc-ready'; response_status = 200 },
                [ordered]@{ method = 'GET'; path = '/api/dev/conversions'; response_status = 200 },
                [ordered]@{ method = 'GET'; path = '/api/dev/conversions/stream_conv_test_001/result'; response_status = 503 },
                [ordered]@{ method = 'GET'; path = '/api/dev/conversions/stream_conv_test_001/result'; response_status = 200 }
            )
            browser_direct_runtime_port_requests = 0
        }
        runtime_actions = @(
            [ordered]@{ action = 'load conversion history'; runtime_id_type = 'conversion_job_id'; runtime_id = 'stream_conv_test_001' }
        )
        runtime_boundary = [ordered]@{
            coordinator = 'real'
            conversion_authority = 'stub_external_conversion'
            live_gpu = 'not_observed'
        }
        visible_states = [ordered]@{
            loading = [ordered]@{ observed = $true }
            success = [ordered]@{ observed = $true }
            failure = [ordered]@{ observed = $true }
            retry = [ordered]@{ observed = $true }
        }
        e2e_command = 'npx playwright test e2e/conv-history.spec.ts'
        artifacts = @(
            [ordered]@{ role = 'screenshot'; path = (Get-RelativeArtifactPath $screenshotPath); sha256 = (Get-Sha256 $screenshotPath) },
            [ordered]@{ role = 'trace'; path = (Get-RelativeArtifactPath $tracePath); sha256 = (Get-Sha256 $tracePath) }
        )
        kit_runtime = $null
    }
}

function Write-Result {
    param([Parameter(Mandatory = $true)] $Value)
    $Value | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $resultPath -Encoding utf8
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
        & $validator -RepoRoot $repoRoot -ResultPath $resultPath -AllowUntrackedArtifacts -SkipGitBinding
    } catch {
        $caught = $_.Exception.Message
    }
    if ($null -eq $caught -or $caught -notmatch $ExpectedPattern) {
        throw "Expected functional/runtime rejection matching '$ExpectedPattern'; actual='$caught'"
    }
}

try {
    $valid = New-Result
    $script:validJson = $valid | ConvertTo-Json -Depth 20
    Write-Result -Value $valid
    & $validator -RepoRoot $repoRoot -ResultPath $resultPath -AllowUntrackedArtifacts -SkipGitBinding

    Assert-Rejected -ExpectedPattern 'skipped' -Mutation { param($candidate) $candidate.skipped = $true }
    Assert-Rejected -ExpectedPattern 'route' -Mutation { param($candidate) $candidate.route = 'conv' }
    Assert-Rejected -ExpectedPattern 'scope' -Mutation { param($candidate) $candidate.PSObject.Properties.Remove('scope') }
    Assert-Rejected -ExpectedPattern 'known_gaps' -Mutation { param($candidate) $candidate.known_gaps = @() }
    Assert-Rejected -ExpectedPattern 'runtime ID' -Mutation { param($candidate) $candidate.runtime_actions[0].runtime_id = '' }
    Assert-Rejected -ExpectedPattern 'coordinator must be real' -Mutation { param($candidate) $candidate.runtime_boundary.coordinator = 'browser_mock' }
    Assert-Rejected -ExpectedPattern 'cannot claim live GPU' -Mutation { param($candidate) $candidate.runtime_boundary.live_gpu = 'observed' }
    Assert-Rejected -ExpectedPattern "visible state 'failure'" -Mutation { param($candidate) $candidate.visible_states.failure.observed = $false }
    Assert-Rejected -ExpectedPattern 'artifact SHA-256' -Mutation { param($candidate) $candidate.artifacts[0].sha256 = ('0' * 64) }
    Assert-Rejected -ExpectedPattern 'DataChannel' -Mutation {
        param($candidate)
        $candidate.kit_runtime = [pscustomobject]@{ first_frame_observed = $true; stage_id = 'stage-1'; datachannel_ack_observed = $false }
    }

    $workflow = Get-Content -LiteralPath (Join-Path $repoRoot '.github/workflows/ci.yml') -Raw
    foreach ($requiredText in @('functional-runtime-conv:', 'playwright.functional-runtime.config.ts', 'verify-functional-runtime-result.ps1', 'needs.changes.outputs.head_sha', 'npm run build:ui', 'scripts/tests/(test|verify)-functional-runtime-result')) {
        if (-not $workflow.Contains($requiredText)) { throw "CI targeted functional/runtime producer is missing '$requiredText'." }
    }
    $functionalConfig = Get-Content -LiteralPath (Join-Path $repoRoot 'web-viewer-sample/playwright.functional-runtime.config.ts') -Raw
    if ($functionalConfig -notmatch 'testMatch:\s*\[\s*"conv-history\.spec\.ts"\s*\]') {
        throw 'Functional/runtime config must run only the commit-bound conv-history producer; additional specs can mutate tracked evidence before binding validation.'
    }
    $bindingValidatorMarker = 'Validate functional/runtime evidence binding'
    $functionalProducerCommand = 'npx playwright test --config=playwright.functional-runtime.config.ts'
    $hifiRuntimeCommand = 'npx playwright test e2e/hifi-token-authority.spec.ts --config=playwright.config.ts'
    $functionalProducerIndex = $workflow.IndexOf($functionalProducerCommand, [StringComparison]::Ordinal)
    $bindingValidatorIndex = $workflow.IndexOf($bindingValidatorMarker, [StringComparison]::Ordinal)
    $hifiRuntimeIndex = $workflow.IndexOf($hifiRuntimeCommand, [StringComparison]::Ordinal)
    if (
        $functionalProducerIndex -lt 0 -or
        $hifiRuntimeIndex -le $functionalProducerIndex -or
        $bindingValidatorIndex -le $hifiRuntimeIndex
    ) {
        throw 'CI must run functional producer, then the hifi runtime slice, then commit-bound drift validation.'
    }
    if (-not $workflow.Contains('artifacts/e2e/hifi-token-authority/')) {
        throw 'CI must upload the Hi-Fi runtime screenshots in the head-SHA-bound functional/runtime artifact.'
    }

    Write-Host '[test-functional-runtime-result] passed — positive evidence plus skip/route/runtime/state/hash/Kit negative cases'
} finally {
    Remove-Item -LiteralPath $artifactRoot -Recurse -Force -ErrorAction SilentlyContinue
}
