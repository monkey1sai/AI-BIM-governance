[CmdletBinding()]
param(
    [string] $BimControlUrl = "http://127.0.0.1:8001",
    [string] $WorkerUrl = "http://127.0.0.1:8005",
    [string] $CoordinatorUrl = "http://127.0.0.1:8004",
    [string] $ProjectId = "project_demo_001",
    [string] $ModelVersionId = "version_demo_001",
    [string] $UserId = "dev_user_001",
    [string] $TenantId = "tenant_demo_001",
    [string] $DevStorageRoot = "",
    [int] $ConversionTimeoutSeconds = 120,
    [string] $EvidencePath = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# === B-scheme（local-coordinator-ifc-ready-intake-boundary T2）SUPERSEDED ===
# `_worker`(:8005) / `_bim-control`(:8001) 已自 repo 刪除（外部平台改由 tests/fakes 模擬）。
# 本 smoke 原以兩 mock 服務為核心，已不可運作。B-scheme 的 default smoke 改以
# tests/contracts + tests/fakes 對 coordinator 對外 intake / 雲端 callback outbox
# 驗證（OpenSpec change T8；契約：tests/contracts/*.json）。
Write-Host "[smoke] SUPERSEDED：_worker/_bim-control 已於 T2 刪除；改由 T8 contract-stub smoke 取代。未執行。" -ForegroundColor Yellow
exit 0

. (Join-Path $PSScriptRoot 'lib\smoke-evidence.ps1')

$RepoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
if ([string]::IsNullOrWhiteSpace($EvidencePath)) {
    $EvidencePath = Join-Path $RepoRoot 'docs\verification\2026-05-14-stabilize-demo-runtime-readiness\smoke-review-session-evidence.json'
}

$Record = New-SmokeEvidenceRecord -Command $MyInvocation.MyCommand.Path -Cwd (Get-Location).Path -Context @{
    bim_control_url   = $BimControlUrl
    worker_url        = $WorkerUrl
    coordinator_url   = $CoordinatorUrl
    project_id        = $ProjectId
    model_version_id  = $ModelVersionId
    user_id           = $UserId
    tenant_id         = $TenantId
}

function Save-Evidence {
    Save-SmokeEvidence -Record $Record -Path $EvidencePath | Out-Null
    Write-SmokeTierSummary -Record $Record
    Write-Host "[smoke] evidence: $EvidencePath"
}

function Get-OptionalValue {
    param(
        $Object,
        [Parameter(Mandatory = $true)][string] $Name
    )
    if ($null -eq $Object) { return $null }
    $property = $Object.PSObject.Properties[$Name]
    if ($null -eq $property) { return $null }
    return $property.Value
}

# ---------- Service health preflight ----------
$serviceErrors = @{}
foreach ($svc in @(
    @{ name = '_bim-control'; url = $BimControlUrl },
    @{ name = '_worker'; url = $WorkerUrl },
    @{ name = 'bim-review-coordinator'; url = $CoordinatorUrl }
)) {
    try {
        Invoke-RestMethod "$($svc.url)/health" -TimeoutSec 5 | Out-Null
    } catch {
        $serviceErrors[$svc.name] = $_.Exception.Message
    }
}
if ($serviceErrors.Count -gt 0) {
    foreach ($name in $serviceErrors.Keys) {
        Add-SmokeTier -Record $Record -Tier 'service_health' -Status 'blocked' -Owner $name `
            -Blocker "health probe failed: $($serviceErrors[$name])" `
            -NextCommand 'Start the service via scripts/start-all.ps1 -SkipStreaming and rerun'
    }
    Save-Evidence
    throw "Service health preflight failed: $($serviceErrors.Keys -join ', ')"
}

# ---------- Worker dev fixture preflight ----------
$resolvedRoot = Resolve-WorkerDevStorageRoot -Override $DevStorageRoot
$fixtureSummary = Get-WorkerDevFixtureSummary -Root $resolvedRoot

if ($fixtureSummary.fixture_count -le 0) {
    Add-SmokeTier -Record $Record -Tier 'worker_conversion' -Status 'blocked' -Owner '_worker' `
        -Blocker 'no parseable .ifc fixture under WORKER_DEV_STORAGE_ROOT' `
        -NextCommand "Copy a real .ifc into '$resolvedRoot' or set WORKER_DEV_STORAGE_ROOT to a folder that contains one, then rerun this script" `
        -Ids @{ worker_dev_storage_root = $resolvedRoot; fixture_count = 0 } `
        -Detail @{ root = $fixtureSummary.root; exists = $fixtureSummary.exists; is_directory = $fixtureSummary.is_directory }
} else {
    Add-SmokeTier -Record $Record -Tier 'fixture_preflight' -Status 'passed' -Owner 'scripts' `
        -Ids @{ worker_dev_storage_root = $resolvedRoot; fixture_count = $fixtureSummary.fixture_count } `
        -Detail @{ fixtures = $fixtureSummary.fixtures }
}

# ---------- Worker conversion tier ----------
$source = $null
$conversion = $null
$conversionResult = $null
$workerArtifactId = $null
$workerMappingUrl = $null
$workerUsdcUrl = $null
$artifactGroupId = $null

if ($fixtureSummary.fixture_count -gt 0) {
    try {
        $sources = Invoke-RestMethod "$WorkerUrl/api/dev/ifc-sources"
        if (-not $sources.items -or $sources.items.Count -eq 0) {
            throw "Worker dev source listing is empty even though the storage root has $($fixtureSummary.fixture_count) .ifc files. Check worker's WORKER_DEV_STORAGE_ROOT."
        }
        $source = @($sources.items | Sort-Object filename | Select-Object -First 1)[0]

        $conversionBody = @{
            tenant_id          = $TenantId
            project_id         = $ProjectId
            model_version_id   = $ModelVersionId
            source_system      = 'dev_storage'
            uploaded_by        = $UserId
            target_format      = 'usdc'
            generate_mapping   = $true
            options            = @{ auto_complete = $true }
        } | ConvertTo-Json -Depth 10

        $conversion = Invoke-RestMethod `
            -Method Post `
            -Uri "$WorkerUrl/api/dev/ifc-sources/$($source.source_id)/conversions" `
            -ContentType 'application/json' `
            -Body $conversionBody

        $deadline = (Get-Date).AddSeconds($ConversionTimeoutSeconds)
        do {
            $conversionResult = Invoke-RestMethod "$WorkerUrl/api/conversions/$($conversion.conversion_job_id)/result"
            if ($conversionResult.status -eq 'succeeded' -or $conversionResult.status -eq 'failed') { break }
            Start-Sleep -Milliseconds 500
        } while ((Get-Date) -lt $deadline)

        if ($conversionResult.status -eq 'succeeded') {
            $workerArtifactId = $conversionResult.usdc_artifact_id
            $workerMappingUrl = $conversionResult.mapping_url
            $workerUsdcUrl    = $conversionResult.usdc_url
            $artifactGroupId  = $conversion.artifact_group_id
            $tierIds = @{
                source_artifact_id  = $conversion.source_artifact_id
                artifact_group_id   = $conversion.artifact_group_id
                conversion_job_id   = $conversion.conversion_job_id
                usdc_artifact_id    = $workerArtifactId
                usdc_url            = $workerUsdcUrl
                mapping_url         = $workerMappingUrl
                dev_source_filename = $source.filename
            }
            Add-SmokeTier -Record $Record -Tier 'worker_conversion' -Status 'passed' -Owner '_worker' `
                -Ids $tierIds `
                -Detail @{
                    source_size_bytes        = $source.size_bytes
                    coverage_ratio           = $conversionResult.quality_metrics.coverage_ratio
                    coverage_status          = $conversionResult.quality_metrics.coverage_status
                    sidecar_carrier_count    = $conversionResult.quality_metrics.sidecar_carrier_count
                    materialization_strategy = $conversionResult.quality_metrics.materialization_strategy
                }
        } else {
            $diag = ''
            try { $diag = ($conversionResult | ConvertTo-Json -Compress -Depth 5) } catch {}
            Add-SmokeTier -Record $Record -Tier 'worker_conversion' -Status 'failed' -Owner '_worker' `
                -Blocker "conversion job did not succeed within $ConversionTimeoutSeconds s (status=$($conversionResult.status))" `
                -NextCommand "Inspect worker logs and rerun scripts/smoke-review-session.ps1 once the converter is healthy" `
                -Ids @{ conversion_job_id = $conversion.conversion_job_id; dev_source_filename = $source.filename } `
                -Detail @{ result = $conversionResult }
        }
    } catch {
        Add-SmokeTier -Record $Record -Tier 'worker_conversion' -Status 'failed' -Owner '_worker' `
            -Blocker $_.Exception.Message `
            -NextCommand 'Inspect worker logs and rerun once the converter is healthy' `
            -Ids @{ dev_source_filename = if ($source) { $source.filename } else { '' } }
    }
}

# ---------- Coordinator session lifecycle (independent of model readiness) ----------
$session = $null
$streamConfig = $null
try {
    $sessionPayload = @{
        project_id       = $ProjectId
        model_version_id = $ModelVersionId
        created_by       = $UserId
        mode             = 'single_kit_shared_state'
        options          = @{ auto_allocate_kit = $true }
    }
    if ($workerArtifactId -and $artifactGroupId -and $workerUsdcUrl) {
        # Coordinator's zod schema accepts `.default([])` when the key is absent; supplying an
        # empty array can serialise to `null` on PowerShell 5.1, which fails validation. So only
        # set the key when we actually have a derived binding to forward.
        $sessionPayload.artifact_bindings = @(@{
            artifact_group_id  = $artifactGroupId
            model_version_id   = $ModelVersionId
            artifact_id        = $workerArtifactId
            artifact_role      = 'derived'
            url                = $workerUsdcUrl
            mapping_url        = $workerMappingUrl
            load_order         = 0
            ready_status       = 'ready'
        })
    }
    $sessionBody = $sessionPayload | ConvertTo-Json -Depth 20

    $session = Invoke-RestMethod `
        -Method Post `
        -Uri "$CoordinatorUrl/api/review-sessions" `
        -ContentType 'application/json' `
        -Body $sessionBody

    $streamConfig = Invoke-RestMethod "$CoordinatorUrl/api/review-sessions/$($session.session_id)/stream-config"

    Add-SmokeTier -Record $Record -Tier 'coordinator_session_lifecycle' -Status 'passed' -Owner 'bim-review-coordinator' `
        -Ids @{
            session_id          = $session.session_id
            review_request_id   = $session.review_request_id
            lifecycle_status    = $streamConfig.lifecycle_status
            model_status        = $streamConfig.model.status
        } `
        -Detail @{
            kit_instance_bindings_count = @($streamConfig.kit_instance_bindings).Count
            artifact_bindings_count     = @($streamConfig.artifact_bindings).Count
        }

    # B-scheme conversion tiers. Legacy `_worker` conversion evidence above is historical
    # context only and must not promote streaming-owned conversion readiness.
    Add-SmokeTier -Record $Record -Tier 'rvt_intake' -Status 'not_observed' -Owner '_bim-control' `
        -Blocker 'smoke-review-session.ps1 does not submit fake RVT intake; it starts from dev IFC fixtures' `
        -NextCommand 'Use _bim-control POST /api/model-versions/{model_version_id}/rvt-intake for RVT intake evidence' `
        -Ids @{ model_version_id = $ModelVersionId }

    Add-SmokeTier -Record $Record -Tier 'rvt_to_ifc_bridge' -Status 'not_observed' -Owner '_worker' `
        -Blocker 'no rvt_uploaded -> ifc_ready handoff was executed in this smoke pass' `
        -NextCommand 'POST the rvt_uploaded event to _worker /api/rvt-exports, then rerun streaming conversion smoke' `
        -Ids @{ model_version_id = $ModelVersionId }

    $model = $streamConfig.model
    $conversionAuthority = Get-OptionalValue -Object $model -Name 'conversion_authority'
    $streamingConversionJobId = Get-OptionalValue -Object $model -Name 'conversion_job_id'
    $failureCode = Get-OptionalValue -Object $model -Name 'failure_code'
    $diagnostic = Get-OptionalValue -Object $model -Name 'diagnostic'
    $stageComposition = Get-OptionalValue -Object $streamConfig -Name 'stage_composition'

    if ($conversionAuthority -eq 'bim-streaming-server') {
        $streamingStatus = 'blocked'
        if ($model.status -eq 'ready') { $streamingStatus = 'passed' }
        elseif ($model.status -eq 'failed') { $streamingStatus = 'failed' }
        elseif ($model.status -eq 'converting') { $streamingStatus = 'blocked' }

        Add-SmokeTier -Record $Record -Tier 'streaming_conversion_job' -Status $streamingStatus -Owner 'bim-streaming-server' `
            -Blocker $(if ($streamingStatus -eq 'passed') { '' } else { "model.status=$($model.status)" }) `
            -Ids @{
                conversion_authority = $conversionAuthority
                conversion_job_id    = $streamingConversionJobId
                model_status         = $model.status
                artifact_id          = $model.artifact_id
            } `
            -Detail @{
                failure_code = $failureCode
                diagnostic   = $diagnostic
                model_url    = $model.url
                mapping_url  = $model.mapping_url
            }

        $mappingStatus = if ($model.status -eq 'ready' -and $model.mapping_url) { 'passed' } elseif ($model.status -eq 'failed') { 'failed' } else { 'blocked' }
        Add-SmokeTier -Record $Record -Tier 'mapping_quality' -Status $mappingStatus -Owner 'bim-streaming-server' `
            -Blocker $(if ($mappingStatus -eq 'passed') { '' } else { 'streaming-owned mapping quality evidence is not ready' }) `
            -Ids @{
                conversion_authority = $conversionAuthority
                conversion_job_id    = $streamingConversionJobId
                mapping_url          = $model.mapping_url
            } `
            -Detail @{ quality_metrics_summary = Get-OptionalValue -Object $streamConfig -Name 'quality_metrics_summary' }
    } else {
        Add-SmokeTier -Record $Record -Tier 'streaming_conversion_job' -Status 'not_observed' -Owner 'bim-streaming-server' `
            -Blocker 'no streaming-owned conversion evidence in stream-config; legacy _worker conversion is not promoted' `
            -NextCommand 'Run the B-scheme ifc_ready -> bim-streaming-server conversion API path' `
            -Ids @{ conversion_authority = $conversionAuthority; historical_worker_conversion_job_id = if ($conversion) { $conversion.conversion_job_id } else { $null } }

        Add-SmokeTier -Record $Record -Tier 'mapping_quality' -Status 'not_observed' -Owner 'bim-streaming-server' `
            -Blocker 'mapping quality is not streaming-owned in this smoke pass' `
            -NextCommand 'Run a streaming-owned conversion job and verify its mapping result payload'
    }

    if ($null -ne $stageComposition -and (Get-OptionalValue -Object $stageComposition -Name 'primary_artifact_id')) {
        Add-SmokeTier -Record $Record -Tier 'usd_stage_composition' -Status 'passed' -Owner 'bim-streaming-server' `
            -Ids @{
                primary_artifact_id    = $stageComposition.primary_artifact_id
                secondary_artifact_ids = $stageComposition.secondary_artifact_ids
            } `
            -Detail @{ policy = $stageComposition.applied_policy }
    } else {
        Add-SmokeTier -Record $Record -Tier 'usd_stage_composition' -Status 'not_observed' -Owner 'bim-streaming-server' `
            -Blocker 'stream-config did not include a loadable stage_composition primary artifact' `
            -NextCommand 'Create a session with streaming-owned ready artifacts and rerun'
    }
} catch {
    Add-SmokeTier -Record $Record -Tier 'coordinator_session_lifecycle' -Status 'failed' -Owner 'bim-review-coordinator' `
        -Blocker $_.Exception.Message `
        -NextCommand 'Check bim-review-coordinator logs and rerun once /api/review-sessions responds 2xx'
    Save-Evidence
    throw
}

# ---------- _bim-control review request artifact discovery (independent tier) ----------
try {
    $artifacts = Invoke-RestMethod "$BimControlUrl/api/model-versions/$ModelVersionId/artifacts"
    $issues    = Invoke-RestMethod "$BimControlUrl/api/model-versions/$ModelVersionId/review-issues"
    $artifactCount = if ($artifacts.items) { @($artifacts.items).Count } else { 0 }
    $issueCount    = if ($issues.items)    { @($issues.items).Count }    else { 0 }
    Add-SmokeTier -Record $Record -Tier 'bim_control_review_request' -Status 'passed' -Owner '_bim-control' `
        -Ids @{ model_version_id = $ModelVersionId } `
        -Detail @{ artifact_count = $artifactCount; issue_count = $issueCount }
} catch {
    Add-SmokeTier -Record $Record -Tier 'bim_control_review_request' -Status 'failed' -Owner '_bim-control' `
        -Blocker $_.Exception.Message `
        -NextCommand 'Confirm _bim-control fake metadata is seeded for the model version'
}

# ---------- annotation + collaboration event flow ----------
try {
    $annotationBody = @{
        annotation_id    = "ann_smoke_$($session.session_id)"
        project_id       = $ProjectId
        model_version_id = $ModelVersionId
        author_id        = $UserId
        title            = 'Smoke annotation'
        body             = 'Created by smoke-review-session.ps1'
        usd_prim_path    = '/World'
    } | ConvertTo-Json -Depth 10
    $annotation = Invoke-RestMethod `
        -Method Post `
        -Uri "$BimControlUrl/api/review-sessions/$($session.session_id)/annotations" `
        -ContentType 'application/json' `
        -Body $annotationBody

    $eventBody = @{
        type     = 'highlightRequest'
        issue_id = 'ISSUE-DEMO-001'
        items    = @(@{ usd_prim_path = '/World'; color = @(1, 0, 0, 1); label = 'Smoke' })
    } | ConvertTo-Json -Depth 10
    $event = Invoke-RestMethod `
        -Method Post `
        -Uri "$CoordinatorUrl/api/review-sessions/$($session.session_id)/events" `
        -ContentType 'application/json' `
        -Body $eventBody

    Add-SmokeTier -Record $Record -Tier 'rest_collaboration_event' -Status 'passed' -Owner 'bim-review-coordinator' `
        -Ids @{ session_id = $session.session_id; annotation_id = $annotation.annotation_id; event_id = $event.event_id }
} catch {
    Add-SmokeTier -Record $Record -Tier 'rest_collaboration_event' -Status 'failed' -Owner 'bim-review-coordinator' `
        -Blocker $_.Exception.Message `
        -NextCommand 'Rerun once the coordinator and _bim-control accept annotation/event posts'
}

# ---------- Kit launcher preflight (does not run Kit) ----------
$kitPreflight = Get-KitLauncherPreflight -RepoRoot $RepoRoot
if ($kitPreflight.launcher_present) {
    Add-SmokeTier -Record $Record -Tier 'kit_launcher_preflight' -Status 'passed' -Owner 'bim-streaming-server' `
        -Ids @{ launcher_path = $kitPreflight.launcher_path } `
        -Detail @{ next_command = $kitPreflight.next_command }
} else {
    Add-SmokeTier -Record $Record -Tier 'kit_launcher_preflight' -Status 'blocked' -Owner 'bim-streaming-server' `
        -Blocker "Streaming launcher not found at $($kitPreflight.launcher_path)" `
        -NextCommand $kitPreflight.next_command `
        -Ids @{ launcher_path = $kitPreflight.launcher_path }
}

# ---------- WebRTC signaling readiness (no live Kit means blocked) ----------
$signalProbe = Test-KitSignalingPortListening -Port 49100
if ($signalProbe.listening) {
    Add-SmokeTier -Record $Record -Tier 'kit_webrtc_readiness' -Status 'passed' -Owner 'bim-streaming-server' `
        -Ids @{ signaling_endpoint = "$($signalProbe.host):$($signalProbe.port)" }
} else {
    Add-SmokeTier -Record $Record -Tier 'kit_webrtc_readiness' -Status 'blocked' -Owner 'bim-streaming-server' `
        -Blocker "$($signalProbe.host):$($signalProbe.port) is not listening" `
        -NextCommand "Launch Kit with bim-streaming-server/scripts/start-streaming-server.ps1 -SkipAutoLoad and rerun" `
        -Ids @{ signaling_endpoint = "$($signalProbe.host):$($signalProbe.port)" }
}

# ---------- Browser visual evidence (not driven by this script) ----------
Add-SmokeTier -Record $Record -Tier 'browser_visual_evidence' -Status 'not_observed' -Owner 'web-viewer-sample' `
    -Blocker 'browser automation is out of scope for this smoke script (policy-restricted in workspace)' `
    -NextCommand "Open http://127.0.0.1:5173/?sessionId=$($session.session_id) manually and capture viewport screenshot under docs/verification/2026-05-14-stabilize-demo-runtime-readiness/" `
    -Ids @{
        viewer_url = "http://127.0.0.1:5173/?sessionId=$($session.session_id)"
        session_id = $session.session_id
    }

# ---------- single_kit_render (capability-defined tier) ----------
$singleKitBlocker = @()
if (-not $kitPreflight.launcher_present) { $singleKitBlocker += 'Kit launcher missing' }
if (-not $signalProbe.listening)         { $singleKitBlocker += 'signaling port 49100 closed' }
if (-not $workerUsdcUrl)                 { $singleKitBlocker += 'no successful worker model.usdc for the canonical fixture' }
$kitBindingsLength = @($streamConfig.kit_instance_bindings).Count

if ($singleKitBlocker.Count -eq 0) {
    Add-SmokeTier -Record $Record -Tier 'single_kit_render' -Status 'not_observed' -Owner 'web-viewer-sample' `
        -Blocker 'screenshot + video dimensions must be captured manually before this tier is passed' `
        -NextCommand "Open http://127.0.0.1:5173/?sessionId=$($session.session_id) once Kit is running and save a screenshot" `
        -Ids @{
            viewer_url        = "http://127.0.0.1:5173/?sessionId=$($session.session_id)"
            session_id        = $session.session_id
            kit_endpoint      = "$($signalProbe.host):$($signalProbe.port)"
            stage_load_result = $null
        } `
        -Detail @{ manual_or_automated = 'manual'; screenshot_path = $null; video = @{ width = 0; height = 0 } }
} else {
    Add-SmokeTier -Record $Record -Tier 'single_kit_render' -Status 'blocked' -Owner 'web-viewer-sample' `
        -Blocker ($singleKitBlocker -join '; ') `
        -NextCommand $kitPreflight.next_command `
        -Ids @{
            viewer_url   = "http://127.0.0.1:5173/?sessionId=$($session.session_id)"
            session_id   = $session.session_id
            kit_endpoint = "$($signalProbe.host):$($signalProbe.port)"
        } `
        -Detail @{
            manual_or_automated = 'manual'
            screenshot_path     = $null
            video               = @{ width = 0; height = 0 }
            stage_load_result   = $null
            missing_prereqs     = $singleKitBlocker
        }
}

# Multi-Kit invariant (always recorded so single_kit_render cannot leak into dedicated routing)
Add-SmokeTier -Record $Record -Tier 'dedicated_multi_kit_routing' -Status 'deferred' -Owner 'bim-streaming-server' `
    -Blocker 'fewer than two GPU-backed Kit endpoints exist in workspace' `
    -NextCommand 'When two Kit endpoints exist, design dedicated multi-Kit routing as its own change' `
    -Ids @{ kit_instance_bindings_length = $kitBindingsLength } `
    -Detail @{ invariant = 'stream_config.kit_instance_bindings.length <= 1'; invariant_holds = ($kitBindingsLength -le 1) }

Add-SmokeTier -Record $Record -Tier 'single_kit_multi_viewer' -Status 'deferred' -Owner 'bim-streaming-server' `
    -Blocker 'same-Kit primary/spectator viewport sharing requires browser evidence and a spectator port' `
    -NextCommand 'Run browser E2E with primary and spectator viewers against one Kit instance' `
    -Ids @{ kit_instance_bindings_length = $kitBindingsLength } `
    -Detail @{ invariant = 'single Kit, multiple viewers'; evidence_required = @('primary screenshot', 'spectator screenshot', 'shared kit_instance_id') }

Save-Evidence

# Backward-compatible final summary line for legacy consumers.
Write-Host "[smoke] review session lifecycle: $($session.session_id)"
Write-Host "[smoke] coordinator model.status: $($streamConfig.model.status)"
if ($workerUsdcUrl) {
    Write-Host "[smoke] worker model.usdc URL: $workerUsdcUrl"
}
