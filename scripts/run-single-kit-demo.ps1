[CmdletBinding()]
param(
    [string] $BimControlUrl = "removed-runtime",
    [string] $WorkerUrl = "removed-runtime",
    [string] $CoordinatorUrl = "http://127.0.0.1:8004",
    [string] $ViewerUrl = "http://127.0.0.1:5173",
    [string] $TenantId = "tenant_demo_001",
    [string] $ProjectId = "project_demo_001",
    [string] $ModelVersionId = "version_demo_001",
    [string] $UserId = "dev_user_001",
    [string] $DevSourceId = "",
    [string] $DevStorageRoot = "",
    [int] $ConversionTimeoutSeconds = 600,
    [string] $EvidencePath = "",
    [switch] $ReuseExisting
)

# Orchestrate the single-Kit demo happy-path: worker/_bim-control/coordinator preflight,
# canonical fixture conversion, review session creation, and a Kit preflight summary.
# The final Kit launch and screenshot capture remain manual. See:
#   docs/verification/2026-05-14-stabilize-demo-runtime-readiness/runbook.md

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# === B-scheme（local-coordinator-ifc-ready-intake-boundary T2）SUPERSEDED ===
# `_worker`(:8005) / `_bim-control`(:8001) 已自 repo 刪除（外部平台改由 tests/fakes 模擬）。
# 本 demo 以兩 mock 服務 preflight 為前提，已不可運作。B-scheme 改以 coordinator
# 對外 intake（T3）+ streaming internal conversion（T4）+ tests/fakes 驗證
# （OpenSpec change local-coordinator-ifc-ready-intake-boundary，T8 smoke rewrite）。
Write-Host "[demo] SUPERSEDED：_worker/_bim-control 已於 T2 刪除；改由 T3/T4 + T8 contract-stub smoke 取代。未執行。" -ForegroundColor Yellow
exit 0

. (Join-Path $PSScriptRoot 'lib\smoke-evidence.ps1')

$RepoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$EvidenceDir = Join-Path $RepoRoot 'docs\verification\2026-05-14-stabilize-demo-runtime-readiness'
if ([string]::IsNullOrWhiteSpace($EvidencePath)) {
    $EvidencePath = Join-Path $EvidenceDir 'run-single-kit-demo-evidence.json'
}

$Record = New-SmokeEvidenceRecord -Command $MyInvocation.MyCommand.Path -Cwd (Get-Location).Path -Context @{
    bim_control_url   = $BimControlUrl
    worker_url        = $WorkerUrl
    coordinator_url   = $CoordinatorUrl
    viewer_url        = $ViewerUrl
    project_id        = $ProjectId
    model_version_id  = $ModelVersionId
    user_id           = $UserId
    tenant_id         = $TenantId
}

function Save-Evidence {
    Save-SmokeEvidence -Record $Record -Path $EvidencePath | Out-Null
    Write-SmokeTierSummary -Record $Record
    Write-Host "[demo] evidence: $EvidencePath"
}

function Fail-Run {
    param([string] $Message)
    Save-Evidence
    throw $Message
}

# ---------- 1. Service health preflight ----------
$serviceErrors = @{}
foreach ($svc in @(
    @{ name = '_bim-control'; url = $BimControlUrl },
    @{ name = '_worker'; url = $WorkerUrl },
    @{ name = 'bim-review-coordinator'; url = $CoordinatorUrl }
)) {
    try { Invoke-RestMethod "$($svc.url)/health" -TimeoutSec 5 | Out-Null }
    catch { $serviceErrors[$svc.name] = $_.Exception.Message }
}
if ($serviceErrors.Count -gt 0) {
    foreach ($name in $serviceErrors.Keys) {
        Add-SmokeTier -Record $Record -Tier 'service_health' -Status 'blocked' -Owner $name `
            -Blocker $serviceErrors[$name] `
            -NextCommand 'scripts/start-all.ps1 -SkipStreaming and rerun'
    }
    Fail-Run "Service health preflight failed: $($serviceErrors.Keys -join ', ')"
}
Add-SmokeTier -Record $Record -Tier 'service_health' -Status 'passed' -Owner 'scripts' `
    -Ids @{
        bim_control_url = $BimControlUrl
        worker_url      = $WorkerUrl
        coordinator_url = $CoordinatorUrl
    }

# ---------- 2. Fixture preflight ----------
$resolvedRoot = Resolve-WorkerDevStorageRoot -Override $DevStorageRoot
$fixtureSummary = Get-WorkerDevFixtureSummary -Root $resolvedRoot

$sources = Invoke-RestMethod "$WorkerUrl/api/dev/ifc-sources"
$sourceCount = if ($sources.items) { @($sources.items).Count } else { 0 }
if ($sourceCount -eq 0) {
    Add-SmokeTier -Record $Record -Tier 'fixture_preflight' -Status 'blocked' -Owner '_worker' `
        -Blocker "no parseable .ifc fixture under '$resolvedRoot'" `
        -NextCommand "Copy a real .ifc into '$resolvedRoot' or set WORKER_DEV_STORAGE_ROOT, then rerun this script" `
        -Ids @{ worker_dev_storage_root = $resolvedRoot; fixture_count = 0 }
    Add-SmokeTier -Record $Record -Tier 'single_kit_render' -Status 'blocked' -Owner 'web-viewer-sample' `
        -Blocker 'fixture missing — cannot proceed to single-Kit render' `
        -NextCommand "Copy a real .ifc into '$resolvedRoot' or set WORKER_DEV_STORAGE_ROOT, then rerun"
    Add-SmokeTier -Record $Record -Tier 'dedicated_multi_kit_routing' -Status 'deferred' -Owner 'bim-streaming-server' `
        -Blocker 'fewer than two GPU-backed Kit endpoints exist in workspace' `
        -NextCommand 'Design dedicated multi-Kit routing as its own change once a second GPU-backed Kit endpoint exists' `
        -Ids @{ kit_instance_bindings_length = 0 } `
        -Detail @{ invariant = 'stream_config.kit_instance_bindings.length <= 1'; invariant_holds = $true }
    Save-Evidence
    return
}

Add-SmokeTier -Record $Record -Tier 'fixture_preflight' -Status 'passed' -Owner 'scripts' `
    -Ids @{ worker_dev_storage_root = $resolvedRoot; fixture_count = $sourceCount }

$source = $null
if (-not [string]::IsNullOrWhiteSpace($DevSourceId)) {
    $source = @($sources.items | Where-Object { $_.source_id -eq $DevSourceId } | Select-Object -First 1)[0]
    if (-not $source) {
        Add-SmokeTier -Record $Record -Tier 'worker_conversion' -Status 'failed' -Owner 'scripts' `
            -Blocker "Dev source id was not found: $DevSourceId" `
            -NextCommand 'GET /api/dev/ifc-sources and choose a valid source_id'
        Fail-Run "Dev source id was not found: $DevSourceId"
    }
} else {
    # Canonical fixture preference: largest .ifc (the optimization spec targets the 89MB fixture).
    $source = @($sources.items | Sort-Object size_bytes -Descending | Select-Object -First 1)[0]
}

# ---------- 3. Worker conversion lookup-or-trigger ----------
$conversion = $null
$result = $null
try {
    $conversionBody = @{
        tenant_id        = $TenantId
        project_id       = $ProjectId
        model_version_id = $ModelVersionId
        source_system    = 'dev_storage'
        uploaded_by      = $UserId
        target_format    = 'usdc'
        generate_mapping = $true
        options          = @{ auto_complete = $true }
    } | ConvertTo-Json -Depth 10

    $conversion = Invoke-RestMethod `
        -Method Post `
        -Uri "$WorkerUrl/api/dev/ifc-sources/$($source.source_id)/conversions" `
        -ContentType 'application/json' `
        -Body $conversionBody

    Write-Host "[demo] polling conversion_job_id=$($conversion.conversion_job_id) (timeout ${ConversionTimeoutSeconds}s)"
    $deadline = (Get-Date).AddSeconds($ConversionTimeoutSeconds)
    do {
        $result = Invoke-RestMethod "$WorkerUrl/api/conversions/$($conversion.conversion_job_id)/result"
        if ($result.status -eq 'succeeded' -or $result.status -eq 'failed') { break }
        Start-Sleep -Seconds 1
    } while ((Get-Date) -lt $deadline)

    if ($result.status -ne 'succeeded') {
        Add-SmokeTier -Record $Record -Tier 'worker_conversion' -Status 'failed' -Owner '_worker' `
            -Blocker "conversion did not succeed within ${ConversionTimeoutSeconds}s (status=$($result.status))" `
            -NextCommand 'Inspect worker logs; if conversion is slow, rerun with -ConversionTimeoutSeconds N' `
            -Ids @{ conversion_job_id = $conversion.conversion_job_id } `
            -Detail @{ result = $result }
        Fail-Run "Conversion not succeeded: status=$($result.status)"
    }
} catch {
    if (-not ($Record.tiers | Where-Object { $_.tier -eq 'worker_conversion' })) {
        Add-SmokeTier -Record $Record -Tier 'worker_conversion' -Status 'failed' -Owner '_worker' `
            -Blocker $_.Exception.Message
    }
    Fail-Run $_.Exception.Message
}

Add-SmokeTier -Record $Record -Tier 'worker_conversion' -Status 'passed' -Owner '_worker' `
    -Ids @{
        source_artifact_id   = $conversion.source_artifact_id
        artifact_group_id    = $conversion.artifact_group_id
        conversion_job_id    = $conversion.conversion_job_id
        usdc_artifact_id     = $result.usdc_artifact_id
        usdc_url             = $result.usdc_url
        mapping_url          = $result.mapping_url
        entity_index_url     = $result.entity_index_url
        dev_source_filename  = $source.filename
    } `
    -Detail @{
        source_size_bytes        = $source.size_bytes
        coverage_ratio           = $result.quality_metrics.coverage_ratio
        coverage_status          = $result.quality_metrics.coverage_status
        sidecar_carrier_count    = $result.quality_metrics.sidecar_carrier_count
        materialization_strategy = $result.quality_metrics.materialization_strategy
    }

# ---------- 4. Build quality_metrics_summary payload (additive pass-through) ----------
$conversionTotalDuration = $null
try {
    $conversionTotalDuration = $result.quality_metrics.phase_timings.conversion_total.duration_seconds
} catch {}

$qualityMetricsSummary = [ordered]@{
    fixture_name                = $source.filename
    conversion_job_id           = $conversion.conversion_job_id
    artifact_group_id           = $conversion.artifact_group_id
    source_ifc_entity_count     = $result.quality_metrics.source_ifc_entity_count
    sidecar_carrier_count       = $result.quality_metrics.sidecar_carrier_count
    materialization_strategy    = $result.quality_metrics.materialization_strategy
    coverage_ratio              = $result.quality_metrics.coverage_ratio
    coverage_status             = $result.quality_metrics.coverage_status
    conversion_duration_seconds = $conversionTotalDuration
}

# ---------- 5. Coordinator session creation with additive quality_metrics_summary ----------
$session = $null
$streamConfig = $null
try {
    $artifactBindings = @(@{
        artifact_group_id  = $conversion.artifact_group_id
        model_version_id   = $ModelVersionId
        artifact_id        = $result.usdc_artifact_id
        artifact_role      = 'derived'
        url                = $result.usdc_url
        mapping_url        = $result.mapping_url
        load_order         = 0
        ready_status       = 'ready'
    })
    if ($result.entity_index_url) {
        $artifactBindings += @{
            artifact_group_id  = $conversion.artifact_group_id
            model_version_id   = $ModelVersionId
            artifact_id        = "entity_index_$($conversion.conversion_job_id)"
            artifact_role      = 'overlay'
            url                = $result.entity_index_url
            mapping_url        = $null
            load_order         = 1
            ready_status       = 'ready'
        }
    }
    $sessionBody = @{
        tenant_id                 = $TenantId
        project_id                = $ProjectId
        model_version_id          = $ModelVersionId
        created_by                = $UserId
        mode                      = 'single_kit_shared_state'
        routing_policy            = 'same_instance'
        artifact_bindings         = $artifactBindings
        kit_profile               = @{ provider = 'local_fixed' }
        options                   = @{ auto_allocate_kit = $true }
        quality_metrics_summary   = $qualityMetricsSummary
    } | ConvertTo-Json -Depth 20
    $session = Invoke-RestMethod `
        -Method Post `
        -Uri "$CoordinatorUrl/api/review-sessions" `
        -ContentType 'application/json' `
        -Body $sessionBody
    $streamConfig = Invoke-RestMethod "$CoordinatorUrl/api/review-sessions/$($session.session_id)/stream-config"

    $modelUrlOk = ($streamConfig.model.status -eq 'ready' -and $streamConfig.model.url -eq $result.usdc_url)
    if (-not $modelUrlOk) {
        Add-SmokeTier -Record $Record -Tier 'coordinator_session_lifecycle' -Status 'failed' -Owner 'bim-review-coordinator' `
            -Blocker "stream_config.model.url did not match the worker-derived model.usdc URL" `
            -Ids @{
                session_id        = $session.session_id
                model_url         = $streamConfig.model.url
                expected_model_url = $result.usdc_url
            }
        Fail-Run "stream_config.model.url mismatch"
    }
    Add-SmokeTier -Record $Record -Tier 'coordinator_session_lifecycle' -Status 'passed' -Owner 'bim-review-coordinator' `
        -Ids @{
            session_id        = $session.session_id
            lifecycle_status  = $streamConfig.lifecycle_status
            model_status      = $streamConfig.model.status
            model_url         = $streamConfig.model.url
        } -Detail @{
            artifact_bindings_count = @($streamConfig.artifact_bindings).Count
            forwards_quality_summary = [bool]($streamConfig.PSObject.Properties.Name -contains 'quality_metrics_summary')
        }
} catch {
    if (-not ($Record.tiers | Where-Object { $_.tier -eq 'coordinator_session_lifecycle' })) {
        Add-SmokeTier -Record $Record -Tier 'coordinator_session_lifecycle' -Status 'failed' -Owner 'bim-review-coordinator' `
            -Blocker $_.Exception.Message
    }
    Fail-Run $_.Exception.Message
}

# ---------- 6. Kit launcher preflight summary (no Kit launch) ----------
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

$signalProbe = Test-KitSignalingPortListening -Port 49100
if ($signalProbe.listening) {
    Add-SmokeTier -Record $Record -Tier 'kit_webrtc_readiness' -Status 'passed' -Owner 'bim-streaming-server' `
        -Ids @{ signaling_endpoint = "$($signalProbe.host):$($signalProbe.port)" }
} else {
    Add-SmokeTier -Record $Record -Tier 'kit_webrtc_readiness' -Status 'blocked' -Owner 'bim-streaming-server' `
        -Blocker "$($signalProbe.host):$($signalProbe.port) is not listening" `
        -NextCommand "& '$($kitPreflight.preflight_script)' -SkipAutoLoad" `
        -Ids @{ signaling_endpoint = "$($signalProbe.host):$($signalProbe.port)" }
}

# ---------- 7. Browser visual + single_kit_render evidence (manual) ----------
$viewerUrlWithSession = "$ViewerUrl/?sessionId=$($session.session_id)"
Add-SmokeTier -Record $Record -Tier 'browser_visual_evidence' -Status 'not_observed' -Owner 'web-viewer-sample' `
    -Blocker 'final viewport observation requires manual browser open + screenshot' `
    -NextCommand "Open $viewerUrlWithSession in a browser; capture screenshot under $EvidenceDir" `
    -Ids @{ viewer_url = $viewerUrlWithSession; session_id = $session.session_id }

$singleKitBlocker = @()
if (-not $kitPreflight.launcher_present) { $singleKitBlocker += 'Kit launcher missing' }
if (-not $signalProbe.listening)         { $singleKitBlocker += 'signaling port 49100 closed' }
if (-not $result.usdc_url)               { $singleKitBlocker += 'no successful worker model.usdc' }
$kitBindingsLength = @($streamConfig.kit_instance_bindings).Count

if ($singleKitBlocker.Count -eq 0) {
    Add-SmokeTier -Record $Record -Tier 'single_kit_render' -Status 'not_observed' -Owner 'web-viewer-sample' `
        -Blocker 'screenshot + non-zero video dimensions must be captured manually before this tier is passed' `
        -NextCommand "Open $viewerUrlWithSession once Kit is running and save a screenshot" `
        -Ids @{
            viewer_url        = $viewerUrlWithSession
            session_id        = $session.session_id
            kit_endpoint      = "$($signalProbe.host):$($signalProbe.port)"
            stage_load_result = $null
        } -Detail @{
            manual_or_automated = 'manual'
            screenshot_path     = $null
            video               = @{ width = 0; height = 0 }
        }
} else {
    Add-SmokeTier -Record $Record -Tier 'single_kit_render' -Status 'blocked' -Owner 'web-viewer-sample' `
        -Blocker ($singleKitBlocker -join '; ') `
        -NextCommand $kitPreflight.next_command `
        -Ids @{
            viewer_url   = $viewerUrlWithSession
            session_id   = $session.session_id
            kit_endpoint = "$($signalProbe.host):$($signalProbe.port)"
        } -Detail @{
            manual_or_automated = 'manual'
            screenshot_path     = $null
            video               = @{ width = 0; height = 0 }
            stage_load_result   = $null
            missing_prereqs     = $singleKitBlocker
        }
}

Add-SmokeTier -Record $Record -Tier 'dedicated_multi_kit_routing' -Status 'deferred' -Owner 'bim-streaming-server' `
    -Blocker 'fewer than two GPU-backed Kit endpoints exist in workspace' `
    -NextCommand 'Design dedicated multi-Kit routing as its own change once a second GPU-backed Kit endpoint exists' `
    -Ids @{ kit_instance_bindings_length = $kitBindingsLength } `
    -Detail @{ invariant = 'stream_config.kit_instance_bindings.length <= 1'; invariant_holds = ($kitBindingsLength -le 1) }

Save-Evidence

Write-Host ""
Write-Host "=== Single-Kit demo summary ==="
Write-Host "session_id        : $($session.session_id)"
Write-Host "conversion_job_id : $($conversion.conversion_job_id)"
Write-Host "model.usdc URL    : $($streamConfig.model.url)"
Write-Host "viewer URL        : $viewerUrlWithSession"
Write-Host "evidence JSON     : $EvidencePath"
Write-Host ""
Write-Host "Next manual steps:"
Write-Host "  1. Launch Kit:  bim-streaming-server/scripts/start-streaming-server.ps1 -SkipAutoLoad"
Write-Host "  2. Open the viewer URL in a browser"
Write-Host "  3. Capture a screenshot under docs/verification/2026-05-14-stabilize-demo-runtime-readiness/"
Write-Host "  4. Manually fill the single_kit_render tier in the evidence JSON with screenshot_path + video dimensions"
