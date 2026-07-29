Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../..')).Path
$validator = Join-Path $PSScriptRoot 'verify-functional-runtime-result.ps1'
$tempId = [guid]::NewGuid().ToString('N')
$tempRoot = Join-Path $repoRoot "artifacts/tmp/functional-runtime-gate-$tempId"
$fixtureRepoRoot = Join-Path $tempRoot 'repository'
$artifactRoot = Join-Path $fixtureRepoRoot 'artifacts/e2e/functional-runtime'
$resultPath = Join-Path $artifactRoot 'functional-runtime-result.json'
$screenshotPath = Join-Path $artifactRoot 'conv-history.png'
$tracePath = Join-Path $artifactRoot 'conv-history-trace.zip'
New-Item -ItemType Directory -Force -Path $artifactRoot | Out-Null
[System.IO.File]::WriteAllBytes($screenshotPath, [Convert]::FromBase64String('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='))

function Add-ZipTextEntry {
    param(
        [Parameter(Mandatory = $true)] $Archive,
        [Parameter(Mandatory = $true)][string] $Name,
        [Parameter(Mandatory = $true)][string[]] $Lines
    )
    $entry = $Archive.CreateEntry($Name, [System.IO.Compression.CompressionLevel]::Optimal)
    $stream = $entry.Open()
    try {
        $writer = [System.IO.StreamWriter]::new($stream, [System.Text.UTF8Encoding]::new($false), 4096, $true)
        try {
            foreach ($line in $Lines) { $writer.WriteLine($line) }
        } finally {
            $writer.Dispose()
        }
    } finally {
        $stream.Dispose()
    }
}

function Write-ValidTrace {
    param([Parameter(Mandatory = $true)][string] $LiteralPath)
    Add-Type -AssemblyName System.IO.Compression
    $stream = [System.IO.File]::Open($LiteralPath, [System.IO.FileMode]::Create, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
    try {
        $archive = [System.IO.Compression.ZipArchive]::new($stream, [System.IO.Compression.ZipArchiveMode]::Create, $true)
        try {
            Add-ZipTextEntry -Archive $archive -Name 'trace.trace' -Lines @(
                '{"version":8,"type":"context-options","origin":"library","playwrightVersion":"1.61.0"}',
                '{"type":"before","callId":"call@1","class":"Page","method":"goto"}',
                '{"type":"after","callId":"call@1"}'
            )
            Add-ZipTextEntry -Archive $archive -Name 'trace.network' -Lines @(
                '{"type":"resource-snapshot","snapshot":{"request":{"method":"GET","url":"http://127.0.0.1:8005/api/external/ifc-ready"},"response":{"status":200}}}',
                '{"type":"resource-snapshot","snapshot":{"request":{"method":"GET","url":"http://127.0.0.1:8005/api/dev/conversions"},"response":{"status":200}}}',
                '{"type":"resource-snapshot","snapshot":{"request":{"method":"GET","url":"http://127.0.0.1:8005/api/dev/conversions/stream_conv_test_001/result"},"response":{"status":503}}}',
                '{"type":"resource-snapshot","snapshot":{"request":{"method":"GET","url":"http://127.0.0.1:8005/api/dev/conversions/stream_conv_test_001/result"},"response":{"status":200}}}'
            )
        } finally {
            $archive.Dispose()
        }
    } finally {
        $stream.Dispose()
    }
}

Write-ValidTrace -LiteralPath $tracePath

function Get-RelativeArtifactPath {
    param([Parameter(Mandatory = $true)][string] $LiteralPath)
    return [System.IO.Path]::GetRelativePath($fixtureRepoRoot, $LiteralPath).Replace('\', '/')
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
        & $validator -RepoRoot $fixtureRepoRoot -ResultPath $resultPath -AllowUntrackedArtifacts -SkipGitBinding
    } catch {
        $caught = $_.Exception.Message
    }
    if ($null -eq $caught -or $caught -notmatch $ExpectedPattern) {
        throw "Expected functional/runtime rejection matching '$ExpectedPattern'; actual='$caught'"
    }
}

function Assert-CurrentResultRejected {
    param([Parameter(Mandatory = $true)][string] $ExpectedPattern)
    $caught = $null
    try {
        & $validator -RepoRoot $fixtureRepoRoot -ResultPath $resultPath -AllowUntrackedArtifacts -SkipGitBinding
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
    & $validator -RepoRoot $fixtureRepoRoot -ResultPath $resultPath -AllowUntrackedArtifacts -SkipGitBinding

    Assert-Rejected -ExpectedPattern 'skipped' -Mutation { param($candidate) $candidate.skipped = $true }
    Assert-Rejected -ExpectedPattern 'skipped' -Mutation { param($candidate) $candidate.skipped = 'false' }
    Assert-Rejected -ExpectedPattern 'clean subject' -Mutation { param($candidate) $candidate.workspace_clean = 'false' }
    Assert-Rejected -ExpectedPattern 'route' -Mutation { param($candidate) $candidate.route = 'conv' }
    Assert-Rejected -ExpectedPattern 'scope' -Mutation { param($candidate) $candidate.PSObject.Properties.Remove('scope') }
    Assert-Rejected -ExpectedPattern 'known_gaps' -Mutation { param($candidate) $candidate.known_gaps = @() }
    Assert-Rejected -ExpectedPattern 'runtime ID' -Mutation { param($candidate) $candidate.runtime_actions[0].runtime_id = '' }
    Assert-Rejected -ExpectedPattern 'coordinator must be real' -Mutation { param($candidate) $candidate.runtime_boundary.coordinator = 'browser_mock' }
    Assert-Rejected -ExpectedPattern 'cannot claim live GPU' -Mutation { param($candidate) $candidate.runtime_boundary.live_gpu = 'observed' }
    Assert-Rejected -ExpectedPattern "visible state 'failure'" -Mutation { param($candidate) $candidate.visible_states.failure.observed = $false }
    Assert-Rejected -ExpectedPattern "visible state 'failure'" -Mutation { param($candidate) $candidate.visible_states.failure.observed = 'false' }
    Assert-Rejected -ExpectedPattern 'artifact SHA-256' -Mutation { param($candidate) $candidate.artifacts[0].sha256 = ('0' * 64) }
    Assert-Rejected -ExpectedPattern 'DataChannel' -Mutation {
        param($candidate)
        $candidate.kit_runtime = [pscustomobject]@{ first_frame_observed = $true; stage_id = 'stage-1'; datachannel_ack_observed = $false }
    }

    [byte[]]$validScreenshot = [System.IO.File]::ReadAllBytes($screenshotPath)
    try {
        [System.IO.File]::WriteAllBytes($screenshotPath, [System.Text.Encoding]::UTF8.GetBytes('image'))
        $candidate = $script:validJson | ConvertFrom-Json
        $candidate.artifacts[0].sha256 = Get-Sha256 $screenshotPath
        Write-Result -Value $candidate
        Assert-CurrentResultRejected -ExpectedPattern 'PNG'
    } finally {
        [System.IO.File]::WriteAllBytes($screenshotPath, $validScreenshot)
    }

    [byte[]]$validTrace = [System.IO.File]::ReadAllBytes($tracePath)
    try {
        [System.IO.File]::WriteAllBytes($tracePath, [System.Text.Encoding]::UTF8.GetBytes('trace'))
        $candidate = $script:validJson | ConvertFrom-Json
        $candidate.artifacts[1].sha256 = Get-Sha256 $tracePath
        Write-Result -Value $candidate
        Assert-CurrentResultRejected -ExpectedPattern 'ZIP'
    } finally {
        [System.IO.File]::WriteAllBytes($tracePath, $validTrace)
    }

    $workflow = Get-Content -LiteralPath (Join-Path $repoRoot '.github/workflows/ci.yml') -Raw
    foreach ($requiredText in @('functional-runtime-conv:', 'playwright.functional-runtime.config.ts', 'verify-functional-runtime-result.ps1', 'needs.changes.outputs.head_sha', 'npm run build:ui')) {
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
    $hifiSpec = Get-Content -LiteralPath (Join-Path $repoRoot 'web-viewer-sample/e2e/hifi-token-authority.spec.ts') -Raw
    if ($hifiSpec -notmatch 'path\.join\(repoRoot,\s*"artifacts",\s*"e2e",\s*"_output",\s*"hifi-token-authority"\)') {
        throw 'Hi-Fi runtime actual screenshots must be written below artifacts/e2e/_output instead of overwriting tracked baselines.'
    }
    if ($hifiSpec -notmatch 'pixelmatch\(' -or $hifiSpec -notmatch 'maxDiffPixelRatio\s*=\s*0\.01') {
        throw 'Hi-Fi runtime screenshots must enforce the 1% pixel-diff contract against tracked baselines.'
    }
    if ([regex]::Matches($hifiSpec, 'page\.screenshot\(').Count -ne 1) {
        throw 'Hi-Fi runtime screenshots must use one comparison helper; direct per-test writes can mutate tracked baselines.'
    }

    Write-Host '[test-functional-runtime-result] passed — positive evidence plus skip/route/runtime/state/hash/Kit/PNG/trace negative cases'
} finally {
    Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
}
