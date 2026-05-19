# B-scheme readiness smoke（local-coordinator-ifc-ready-intake-boundary T8 §9.2-9.3）。
#
# 取代已退役的 _worker/_bim-control smoke：default smoke 不依賴兩 mock 服務，
# 改以 contract stub（tests/fakes + tests/contracts）→ coordinator 對外 intake，
# 驗 conversion dispatch + cloud callback outbox + Kit launcher evidence。
#
# 誠實規則（同 T0）：GPU / driver / Kit license 阻塞 → Kit launcher tier 標
# `deferred` 並記 reason，**不得**標 passed、不得用 host-local Kit 充當 pass。
#
# 分層 tiers（demo-runtime-readiness-smoke/v1）：
#   external_ifc_ready_intake    — tests/contracts + tests/fakes pytest
#   coordinator_session_lifecycle— bim-review-coordinator npm verify
#                                  （含 external-ifc-ready / cloud-callback-outbox
#                                    / shadow-metadata / local-web-view 契約測試）
#   streaming_internal_conversion— bim-streaming-server conversion_authority pytest
#   cloud_callback_outbox        — outbox retry / dead-letter 契約（含於 coordinator verify）
#   runtime_image_kit_launcher   — 沿用 T0；GPU/Kit 阻塞 → deferred（不謊報）
#   single_kit_render / single_kit_multi_viewer / usd_stage_composition
#                                — Kit/GPU live evidence missing時維持 deferred/not_observed
#
# Usage:
#   pwsh -File scripts/smoke-bscheme-intake.ps1
#   pwsh -File scripts/smoke-bscheme-intake.ps1 -SkipKitLauncher
#   pwsh -File scripts/smoke-bscheme-intake.ps1 -CoordinatorBaseUrl http://127.0.0.1:8004

[CmdletBinding()]
param(
    [string] $EvidencePath = "",
    [string] $StorageRoot = "",
    [string] $CoordinatorBaseUrl = "http://127.0.0.1:8004",
    [string] $StreamingConversionApiBase = "http://127.0.0.1:49101",
    [string] $WebhookSecret = "dev-webhook-secret",
    [string] $InternalApiToken = "dev-internal-token",
    [int] $LivePollSeconds = 45,
    [switch] $SkipKitLauncher
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

. (Join-Path $PSScriptRoot 'lib\smoke-evidence.ps1')

$RepoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$Python = Join-Path $RepoRoot ".venv\Scripts\python.exe"
if (-not (Test-Path $Python)) { $Python = "python" }
$EvidenceDir = Join-Path $RepoRoot 'docs\verification\evidence\2026-05-18-bscheme-intake-smoke'
if ([string]::IsNullOrWhiteSpace($EvidencePath)) {
    $EvidencePath = Join-Path $EvidenceDir 'bscheme-readiness.json'
}

$Record = New-SmokeEvidenceRecord -Command $MyInvocation.MyCommand.Path -Cwd (Get-Location).Path -Context @{
    change_id = 'local-coordinator-ifc-ready-intake-boundary'
    task      = 'T8 readiness/smoke/evidence rewrite'
    note      = 'default smoke 不依賴 _worker/_bim-control；contract stub + optional real storage/*.ifc → coordinator intake → streaming conversion'
}

function Invoke-Tier {
    param([string] $Tier, [string] $Owner, [string] $Cwd, [string[]] $CmdArgs, [string] $NextCommand)
    Push-Location (Join-Path $RepoRoot $Cwd)
    $output = @()
    $tempBase = Join-Path $RepoRoot 'pytest-bim-worker-tmp\bscheme-smoke'
    $safeTier = ($Tier -replace '[^A-Za-z0-9_.-]', '_').Trim('_')
    if ([string]::IsNullOrWhiteSpace($safeTier)) { $safeTier = 'tier' }
    $tempRoot = Join-Path $tempBase "$safeTier-$PID-$([System.Guid]::NewGuid().ToString('N'))"
    if (-not (Test-Path -LiteralPath $tempRoot)) {
        New-Item -ItemType Directory -Path $tempRoot -Force | Out-Null
    }
    $previousTemp = $env:TEMP
    $previousTmp = $env:TMP
    $previousTmpDir = $env:TMPDIR
    $previousErrorActionPreference = $ErrorActionPreference
    try {
        $env:TEMP = $tempRoot
        $env:TMP = $tempRoot
        $env:TMPDIR = $tempRoot
        $InvokeArgs = if ($CmdArgs.Length -gt 1) { $CmdArgs[1..($CmdArgs.Length - 1)] } else { @() }
        $ErrorActionPreference = 'Continue'
        try {
            $output = & $CmdArgs[0] @InvokeArgs 2>&1
            $exitCode = $LASTEXITCODE
        } finally {
            $ErrorActionPreference = $previousErrorActionPreference
        }
        $ok = ($exitCode -eq 0)
    } catch {
        $ok = $false
        $output = @($_)
    } finally {
        $env:TEMP = $previousTemp
        $env:TMP = $previousTmp
        $env:TMPDIR = $previousTmpDir
        Pop-Location
    }
    $status = if ($ok) { 'passed' } else { 'failed' }
    $blocker = if ($ok) { '' } else { "tier command failed in $Cwd" }
    $detail = @{ output = (($output | ForEach-Object { "$_" }) -join "`n") }
    Add-SmokeTier -Record $Record -Tier $Tier -Status $status -Owner $Owner `
        -Blocker $blocker -NextCommand $NextCommand -Detail $detail | Out-Null
    return $status
}

function Get-JsonProperty {
    param($Object, [string] $Name)
    if ($null -eq $Object) { return $null }
    $property = $Object.PSObject.Properties[$Name]
    if ($null -eq $property) { return $null }
    return $property.Value
}

function ConvertTo-SafeIdPart {
    param([string] $Value)
    $clean = ($Value -replace '[^A-Za-z0-9_.-]', '_').Trim('_')
    if ([string]::IsNullOrWhiteSpace($clean)) { $clean = 'fixture' }
    if ($clean.Length -gt 32) { $clean = $clean.Substring(0, 32) }
    return $clean
}

function ConvertTo-LocalFileUri {
    param([string] $Path)
    return ([System.Uri]::new([System.IO.Path]::GetFullPath($Path))).AbsoluteUri
}

function Get-HttpErrorDetail {
    param($ErrorRecord)
    $message = $ErrorRecord.Exception.Message
    if ($ErrorRecord.ErrorDetails -and -not [string]::IsNullOrWhiteSpace($ErrorRecord.ErrorDetails.Message)) {
        $message = "$message :: $($ErrorRecord.ErrorDetails.Message)"
    }
    return $message
}

function Invoke-JsonRequest {
    param(
        [Parameter(Mandatory = $true)][string] $Method,
        [Parameter(Mandatory = $true)][string] $Url,
        $Body = $null,
        [hashtable] $Headers = @{},
        [int] $TimeoutSec = 15
    )
    $params = @{
        Uri         = $Url
        Method      = $Method
        TimeoutSec  = $TimeoutSec
        ErrorAction = 'Stop'
    }
    if ($Headers.Count -gt 0) { $params.Headers = $Headers }
    if ($null -ne $Body) {
        $params.ContentType = 'application/json'
        $params.Body = ($Body | ConvertTo-Json -Depth 20)
    }
    return Invoke-RestMethod @params
}

function Get-TopLevelIfcFixtures {
    param([string] $Root)
    if (-not (Test-Path -LiteralPath $Root -PathType Container)) { return @() }
    return @(
        Get-ChildItem -LiteralPath $Root -Filter '*.ifc' -File -ErrorAction SilentlyContinue |
            Sort-Object Length -Descending
    )
}

function New-RealIfcReadyPayload {
    param(
        [Parameter(Mandatory = $true)] [System.IO.FileInfo] $Fixture,
        [Parameter(Mandatory = $true)] [string] $CorrelationId,
        [Parameter(Mandatory = $true)] [string] $IdempotencyKey,
        [Parameter(Mandatory = $true)] [string] $EventId
    )
    $hash = (Get-FileHash -LiteralPath $Fixture.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    $safeName = ConvertTo-SafeIdPart ([System.IO.Path]::GetFileNameWithoutExtension($Fixture.Name))
    return [ordered]@{
        event                       = 'ifc_ready'
        event_id                    = $EventId
        correlation_id              = $CorrelationId
        idempotency_key             = $IdempotencyKey
        tenant_id                   = 'tenant_local_smoke'
        project_id                  = 'project_local_smoke'
        external_model_version_id   = "ext_mv_$safeName"
        external_conversion_task_id = "ext_task_$safeName"
        source_ifc                  = [ordered]@{
            ref      = ConvertTo-LocalFileUri $Fixture.FullName
            etag     = "sha256:$hash"
            filename = $Fixture.Name
            format   = 'ifc'
        }
        requested_outputs           = @('usdc', 'element_mapping', 'entity_index', 'metadata')
        callback_url                = $null
    }
}

function Wait-StreamingConversionResult {
    param(
        [string] $BaseUrl,
        [string] $ConversionJobId,
        [int] $PollSeconds
    )
    $deadline = (Get-Date).AddSeconds($PollSeconds)
    $lastResult = $null
    do {
        try {
            $url = "$($BaseUrl.TrimEnd('/'))/api/conversions/$ConversionJobId/result"
            $lastResult = Invoke-JsonRequest -Method 'GET' -Url $url -TimeoutSec 15
            $status = [string](Get-JsonProperty $lastResult 'status')
            if (@('succeeded', 'failed', 'cancelled') -contains $status) {
                return [pscustomobject]@{ completed = $true; status = $status; result = $lastResult; error = $null }
            }
        } catch {
            return [pscustomobject]@{ completed = $false; status = 'blocked'; result = $lastResult; error = (Get-HttpErrorDetail $_) }
        }
        Start-Sleep -Seconds 2
    } while ((Get-Date) -lt $deadline)
    return [pscustomobject]@{ completed = $false; status = 'not_observed'; result = $lastResult; error = "conversion result not completed within ${PollSeconds}s" }
}

function Publish-CoordinatorConversionResult {
    param(
        [string] $CoordinatorBase,
        [string] $InternalToken,
        [string] $CorrelationId,
        [string] $ConversionJobId,
        $StreamingResult,
        [System.IO.FileInfo] $Fixture
    )
    $status = [string](Get-JsonProperty $StreamingResult 'status')
    $artifacts = Get-JsonProperty $StreamingResult 'artifacts'
    $modelUsdc = Get-JsonProperty $artifacts 'model_usdc'
    $mapping = Get-JsonProperty $artifacts 'element_mapping'
    $metadata = Get-JsonProperty $artifacts 'metadata'
    $error = Get-JsonProperty $StreamingResult 'error'
    $reason = Get-JsonProperty $error 'code'
    if ([string]::IsNullOrWhiteSpace($reason)) { $reason = Get-JsonProperty $error 'message' }
    if ([string]::IsNullOrWhiteSpace($reason)) { $reason = 'conversion_failed' }

    $reportStatus = if ($status -eq 'succeeded') { 'succeeded' } else { 'failed' }
    $report = [ordered]@{
        correlation_id    = $CorrelationId
        conversion_job_id = $ConversionJobId
        status            = $reportStatus
        artifacts         = [ordered]@{
            usdc_ref            = Get-JsonProperty $modelUsdc 'url'
            element_mapping_ref = Get-JsonProperty $mapping 'url'
            manifest_ref        = Get-JsonProperty $metadata 'url'
        }
        artifact_summary  = [ordered]@{
            fixture_filename = $Fixture.Name
            fixture_bytes    = [int64]$Fixture.Length
            quality_metrics  = Get-JsonProperty $StreamingResult 'quality_metrics'
        }
        reason            = if ($reportStatus -eq 'failed') { $reason } else { $null }
        retryable         = $false
    }
    $headers = @{ 'X-Internal-Token' = $InternalToken }
    $url = "$($CoordinatorBase.TrimEnd('/'))/api/internal/conversion-result"
    return Invoke-JsonRequest -Method 'POST' -Url $url -Body $report -Headers $headers -TimeoutSec 15
}

function Invoke-RealIfcIntakeConversion {
    param(
        [string] $FixtureRoot,
        [string] $CoordinatorBase,
        [string] $StreamingBase,
        [string] $Secret,
        [string] $InternalToken,
        [int] $PollSeconds
    )

    $rootOverride = $FixtureRoot
    if ([string]::IsNullOrWhiteSpace($rootOverride)) {
        $rootOverride = Join-Path $RepoRoot 'storage'
    }
    $resolvedRoot = Resolve-WorkerDevStorageRoot -Override $rootOverride
    $summary = Get-WorkerDevFixtureSummary -Root $resolvedRoot
    $topLevelFixtures = @(Get-TopLevelIfcFixtures -Root $resolvedRoot)
    $fixtureIds = @{
        storage_root        = $summary.root
        fixture_count       = $summary.fixture_count
        top_level_ifc_count = $topLevelFixtures.Count
    }
    $fixtureDetail = @{
        storage_root         = $summary.root
        recursive_fixtures   = $summary.fixtures
        top_level_pattern    = 'storage/*.ifc'
        selected_fixture     = $null
        coordinator_base_url = $CoordinatorBase
        streaming_base_url   = $StreamingBase
    }
    if ($topLevelFixtures.Count -eq 0) {
        return [pscustomobject]@{
            fixture_status     = 'blocked'
            fixture_blocker    = 'no real IFC fixture found at storage/*.ifc'
            fixture_ids        = $fixtureIds
            fixture_detail     = $fixtureDetail
            integration_status = 'blocked'
            integration_blocker = 'real IFC intake→conversion was not run because storage/*.ifc is empty'
            integration_ids    = $fixtureIds
            integration_detail = $fixtureDetail
            callback_detail    = $null
            quality_metrics    = $null
        }
    }

    $fixture = $topLevelFixtures[0]
    $timestamp = (Get-Date).ToUniversalTime().ToString('yyyyMMddHHmmss')
    $safeName = ConvertTo-SafeIdPart ([System.IO.Path]::GetFileNameWithoutExtension($fixture.Name))
    $correlationId = "corr_bscheme_${timestamp}_$safeName"
    $idempotencyKey = "idem_bscheme_${timestamp}_$safeName"
    $eventId = "evt_bscheme_${timestamp}_$safeName"
    $payload = New-RealIfcReadyPayload -Fixture $fixture -CorrelationId $correlationId -IdempotencyKey $idempotencyKey -EventId $eventId
    $fixtureDetail.selected_fixture = @{
        full_name    = $fixture.FullName
        filename     = $fixture.Name
        size_bytes   = [int64]$fixture.Length
        sha256       = ($payload.source_ifc.etag -replace '^sha256:', '')
        source_ref   = $payload.source_ifc.ref
    }

    try {
        $health = Invoke-JsonRequest -Method 'GET' -Url "$($CoordinatorBase.TrimEnd('/'))/health" -TimeoutSec 10
    } catch {
        $detail = $fixtureDetail.Clone()
        $detail.error = Get-HttpErrorDetail $_
        return [pscustomobject]@{
            fixture_status     = 'passed'
            fixture_blocker    = ''
            fixture_ids        = $fixtureIds
            fixture_detail     = $fixtureDetail
            integration_status = 'blocked'
            integration_blocker = 'coordinator live service is not reachable'
            integration_ids    = $fixtureIds
            integration_detail = $detail
            callback_detail    = $null
            quality_metrics    = $null
        }
    }

    $headers = @{
        'X-Correlation-Id'  = $correlationId
        'X-Idempotency-Key' = $idempotencyKey
        'X-Webhook-Secret'  = $Secret
    }
    try {
        $intakeUrl = "$($CoordinatorBase.TrimEnd('/'))/api/external/ifc-ready"
        $job = Invoke-JsonRequest -Method 'POST' -Url $intakeUrl -Body $payload -Headers $headers -TimeoutSec 20
    } catch {
        $detail = $fixtureDetail.Clone()
        $detail.coordinator_health = $health
        $detail.error = Get-HttpErrorDetail $_
        return [pscustomobject]@{
            fixture_status     = 'passed'
            fixture_blocker    = ''
            fixture_ids        = $fixtureIds
            fixture_detail     = $fixtureDetail
            integration_status = 'blocked'
            integration_blocker = 'coordinator rejected or failed the IFC-ready intake request'
            integration_ids    = $fixtureIds
            integration_detail = $detail
            callback_detail    = $null
            quality_metrics    = $null
        }
    }

    $ifcReadyJobId = [string](Get-JsonProperty $job 'ifc_ready_job_id')
    $conversionJobId = [string](Get-JsonProperty $job 'conversion_job_id')
    $jobStatus = [string](Get-JsonProperty $job 'status')
    $conversionStatus = [string](Get-JsonProperty $job 'conversion_status')
    $dispatchError = [string](Get-JsonProperty $job 'dispatch_error')
    $integrationIds = @{
        storage_root        = $summary.root
        selected_fixture    = $fixture.Name
        ifc_ready_job_id    = $ifcReadyJobId
        conversion_job_id   = $conversionJobId
        correlation_id      = $correlationId
        idempotency_key     = $idempotencyKey
    }
    $integrationDetail = $fixtureDetail.Clone()
    $integrationDetail.coordinator_health = $health
    $integrationDetail.ifc_ready_job = $job

    if ([string]::IsNullOrWhiteSpace($conversionJobId)) {
        $blocker = if ([string]::IsNullOrWhiteSpace($dispatchError)) { 'coordinator accepted intake but did not return conversion_job_id' } else { $dispatchError }
        return [pscustomobject]@{
            fixture_status     = 'passed'
            fixture_blocker    = ''
            fixture_ids        = $fixtureIds
            fixture_detail     = $fixtureDetail
            integration_status = 'blocked'
            integration_blocker = $blocker
            integration_ids    = $integrationIds
            integration_detail = $integrationDetail
            callback_detail    = $null
            quality_metrics    = $null
        }
    }

    $poll = Wait-StreamingConversionResult -BaseUrl $StreamingBase -ConversionJobId $conversionJobId -PollSeconds $PollSeconds
    $integrationDetail.streaming_poll = $poll
    if (-not $poll.completed) {
        $blocker = if ($poll.error) { $poll.error } else { 'streaming conversion result was not observed' }
        return [pscustomobject]@{
            fixture_status     = 'passed'
            fixture_blocker    = ''
            fixture_ids        = $fixtureIds
            fixture_detail     = $fixtureDetail
            integration_status = $poll.status
            integration_blocker = $blocker
            integration_ids    = $integrationIds
            integration_detail = $integrationDetail
            callback_detail    = $null
            quality_metrics    = $null
        }
    }

    $callback = $null
    try {
        $callback = Publish-CoordinatorConversionResult -CoordinatorBase $CoordinatorBase -InternalToken $InternalToken `
            -CorrelationId $correlationId -ConversionJobId $conversionJobId -StreamingResult $poll.result -Fixture $fixture
    } catch {
        $integrationDetail.callback_error = Get-HttpErrorDetail $_
    }
    $integrationDetail.callback_result = $callback
    $resultStatus = [string](Get-JsonProperty $poll.result 'status')
    $qualityMetrics = Get-JsonProperty $poll.result 'quality_metrics'
    $passed = $resultStatus -eq 'succeeded'
    $status = if ($passed) { 'passed' } else { 'blocked' }
    $blocker = ''
    if (-not $passed) {
        $error = Get-JsonProperty $poll.result 'error'
        $code = Get-JsonProperty $error 'code'
        $message = Get-JsonProperty $error 'message'
        $blocker = "streaming conversion result status=$resultStatus"
        if ($code -or $message) { $blocker = "$blocker; $code $message".Trim() }
    }
    return [pscustomobject]@{
        fixture_status     = 'passed'
        fixture_blocker    = ''
        fixture_ids        = $fixtureIds
        fixture_detail     = $fixtureDetail
        integration_status = $status
        integration_blocker = $blocker
        integration_ids    = $integrationIds
        integration_detail = $integrationDetail
        callback_detail    = $callback
        quality_metrics    = $qualityMetrics
    }
}

# external platform contracts + test-only fakes（repo-root pytest）
$ExternalContractsStatus = Invoke-Tier -Tier 'external_ifc_ready_intake' -Owner 'scripts' -Cwd '.' `
    -CmdArgs @($Python, '-m', 'pytest', 'tests', '-q', '-p', 'no:cacheprovider') `
    -NextCommand 'python -m pytest tests -q'

$Live = Invoke-RealIfcIntakeConversion -FixtureRoot $StorageRoot -CoordinatorBase $CoordinatorBaseUrl `
    -StreamingBase $StreamingConversionApiBase -Secret $WebhookSecret -InternalToken $InternalApiToken `
    -PollSeconds $LivePollSeconds

Add-SmokeTier -Record $Record -Tier 'real_ifc_fixture' -Status $Live.fixture_status -Owner 'scripts' `
    -Blocker $Live.fixture_blocker `
    -NextCommand 'Put a real .ifc directly under storage/ (gitignored), then rerun scripts/smoke-bscheme-intake.ps1' `
    -Ids $Live.fixture_ids -Detail $Live.fixture_detail | Out-Null

Add-SmokeTier -Record $Record -Tier 'real_ifc_intake_conversion' -Status $Live.integration_status -Owner 'bim-review-coordinator' `
    -Blocker $Live.integration_blocker `
    -NextCommand 'Start bim-review-coordinator on 8004 and a streaming conversion API on 49101, then rerun scripts/smoke-bscheme-intake.ps1' `
    -Ids $Live.integration_ids -Detail $Live.integration_detail | Out-Null

# coordinator B-scheme intake（含 callback outbox / shadow / local-web-view 契約測試）
$CoordinatorStatus = Invoke-Tier -Tier 'coordinator_session_lifecycle' -Owner 'bim-review-coordinator' -Cwd 'bim-review-coordinator' `
    -CmdArgs @('npm', 'run', 'verify') -NextCommand 'cd bim-review-coordinator && npm run verify'

# streaming internal conversion authority
$StreamingStatus = Invoke-Tier -Tier 'streaming_internal_conversion' -Owner 'bim-streaming-server' -Cwd 'bim-streaming-server' `
    -CmdArgs @($Python, '-m', 'pytest', 'tests/test_conversion_authority_api.py', '-q', '-p', 'no:cacheprovider') `
    -NextCommand 'cd bim-streaming-server && python -m pytest tests/test_conversion_authority_api.py -q -p no:cacheprovider'

# mapping quality 需要 streaming-owned quality evidence；本 smoke 不用 historical worker evidence 充當。
$MappingStatus = 'not_observed'
$MappingBlocker = 'no streaming-owned mapping-quality evidence collected by this pass'
$MappingDetail = @{ live_real_ifc_intake_conversion = $Live.integration_status }
if ($Live.integration_status -eq 'passed' -and $null -ne $Live.quality_metrics) {
    $MappingStatus = 'passed'
    $MappingBlocker = ''
    $MappingDetail.quality_metrics = $Live.quality_metrics
}
Add-SmokeTier -Record $Record -Tier 'mapping_quality' -Status $MappingStatus -Owner 'bim-streaming-server' `
    -Blocker $MappingBlocker `
    -NextCommand 'Run a real streaming conversion with quality metrics evidence when Kit/converter prerequisites are available' `
    -Detail $MappingDetail | Out-Null

# callback outbox tier 由 coordinator verify 的 cloud-callback-outbox.test.ts 覆蓋
$CallbackBlocker = if ($CoordinatorStatus -eq 'passed') { '' } else { 'covered coordinator verify did not pass; cloud_callback_outbox cannot be claimed passed' }
Add-SmokeTier -Record $Record -Tier 'cloud_callback_outbox' -Status $CoordinatorStatus -Owner 'bim-review-coordinator' `
    -Blocker $CallbackBlocker `
    -NextCommand 'covered by coordinator verify: tests/cloud-callback-outbox.test.ts' `
    -Detail @{ retry = 'pending->retry'; exhausted = 'dead_letter'; metadata_only = 'enforced (422)'; live_real_ifc_callback = $Live.callback_detail } | Out-Null

# runtime image Kit launcher：沿用 T0 誠實規則
if ($SkipKitLauncher) {
    Add-SmokeTier -Record $Record -Tier 'runtime_image_kit_launcher' -Status 'deferred' -Owner 'bim-streaming-server' `
        -Blocker 'skipped by -SkipKitLauncher; see T0 evidence' `
        -NextCommand 'pwsh -File scripts/verify-runtime-kit-launcher.ps1' | Out-Null
} else {
    & (Join-Path $PSScriptRoot 'verify-runtime-kit-launcher.ps1') 2>&1 | Out-Null
    $t0 = Join-Path $RepoRoot 'docs\verification\evidence\2026-05-18-t0-kit-launcher\kit-launcher-readiness.json'
    $status = 'deferred'
    $t0Blocker = ''
    if (Test-Path $t0) {
        try {
            $t0Tier = (Get-Content $t0 -Raw | ConvertFrom-Json).tiers[0]
            $status = $t0Tier.status
            $t0Blocker = $t0Tier.blocker
        } catch {
            $status = 'deferred'
            $t0Blocker = ''
        }
    }
    $KitBlocker = if ($status -eq 'passed') { '' } elseif (-not [string]::IsNullOrWhiteSpace($t0Blocker)) { $t0Blocker } else { 'GPU/Kit prerequisite unavailable (honest deferred; not passed)' }
    Add-SmokeTier -Record $Record -Tier 'runtime_image_kit_launcher' -Status $status -Owner 'bim-streaming-server' `
        -Blocker $KitBlocker `
        -NextCommand 'pwsh -File scripts/verify-runtime-kit-launcher.ps1' `
        -EvidencePaths @($t0) | Out-Null
}

Add-SmokeTier -Record $Record -Tier 'single_kit_render' -Status 'deferred' -Owner 'bim-streaming-server' `
    -Blocker 'Kit/GPU/WebRTC live render evidence not collected by this API-only pass' `
    -NextCommand 'pwsh -File scripts/verify-runtime-kit-launcher.ps1, then run browser/Kit render validation' `
    -Detail @{ kit_signal = (Test-KitSignalingPortListening -Port 49100) } | Out-Null
Add-SmokeTier -Record $Record -Tier 'single_kit_multi_viewer' -Status 'not_observed' -Owner 'web-viewer-sample' `
    -Blocker 'multi-viewer browser evidence not collected by this API-only pass' `
    -NextCommand 'Run multi-viewer browser validation after single Kit render is available' | Out-Null
Add-SmokeTier -Record $Record -Tier 'usd_stage_composition' -Status 'not_observed' -Owner 'bim-streaming-server' `
    -Blocker 'USD stage composition evidence not collected by this API-only pass' `
    -NextCommand 'Run stage composition validation with streaming-owned artifacts' | Out-Null

Save-SmokeEvidence -Record $Record -Path $EvidencePath | Out-Null
Write-SmokeTierSummary -Record $Record
Write-Host "[bscheme-smoke] evidence: $EvidencePath"

$FailedTiers = @($Record.tiers | Where-Object { $_.status -eq 'failed' })
if ($FailedTiers.Count -gt 0) {
    $failedNames = ($FailedTiers | ForEach-Object { $_.tier }) -join ', '
    throw "B-scheme smoke failed tiers: $failedNames"
}
