[CmdletBinding()]
param(
    [string] $WorkerUrl = "http://127.0.0.1:8005",
    [string] $BimControlUrl = "http://127.0.0.1:8001",
    [string] $CoordinatorUrl = "http://127.0.0.1:8004",
    [string] $TenantId = "tenant_demo_001",
    [string] $ProjectId = "project_demo_001",
    [string] $ModelVersionId = "version_demo_001",
    [string] $UserId = "dev_user_001",
    [string] $DevSourceId = "",
    [string] $DevStorageRoot = "",
    [int] $TimeoutSeconds = 120,
    [string] $EvidencePath = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

. (Join-Path $PSScriptRoot 'lib\smoke-evidence.ps1')

$RepoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
if ([string]::IsNullOrWhiteSpace($EvidencePath)) {
    $EvidencePath = Join-Path $RepoRoot 'docs\verification\2026-05-14-stabilize-demo-runtime-readiness\smoke-worker-review-request-evidence.json'
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

# ---------- Service health ----------
$serviceErrors = @{}
foreach ($svc in @(
    @{ name = '_worker'; url = $WorkerUrl },
    @{ name = '_bim-control'; url = $BimControlUrl },
    @{ name = 'bim-review-coordinator'; url = $CoordinatorUrl }
)) {
    try { Invoke-RestMethod "$($svc.url)/health" -TimeoutSec 5 | Out-Null }
    catch { $serviceErrors[$svc.name] = $_.Exception.Message }
}
if ($serviceErrors.Count -gt 0) {
    foreach ($name in $serviceErrors.Keys) {
        Add-SmokeTier -Record $Record -Tier 'service_health' -Status 'blocked' -Owner $name `
            -Blocker "health probe failed: $($serviceErrors[$name])" `
            -NextCommand 'scripts/start-all.ps1 -SkipStreaming and rerun'
    }
    Save-Evidence
    throw "Service health preflight failed: $($serviceErrors.Keys -join ', ')"
}

# ---------- Fixture preflight ----------
$resolvedRoot = Resolve-WorkerDevStorageRoot -Override $DevStorageRoot
$fixtureSummary = Get-WorkerDevFixtureSummary -Root $resolvedRoot

$sources = Invoke-RestMethod "$WorkerUrl/api/dev/ifc-sources"
if (-not $sources.items -or $sources.items.Count -eq 0) {
    Add-SmokeTier -Record $Record -Tier 'worker_conversion' -Status 'blocked' -Owner '_worker' `
        -Blocker 'No dev IFC source is available. Put a real .ifc file under the worker dev storage root before running this smoke.' `
        -NextCommand "Copy a real .ifc into '$resolvedRoot' or set WORKER_DEV_STORAGE_ROOT, then rerun" `
        -Ids @{ worker_dev_storage_root = $resolvedRoot; fixture_count = $fixtureSummary.fixture_count } `
        -Detail @{ root = $fixtureSummary.root; exists = $fixtureSummary.exists; is_directory = $fixtureSummary.is_directory }
    Save-Evidence
    throw "No dev IFC source under '$resolvedRoot'."
}

Add-SmokeTier -Record $Record -Tier 'fixture_preflight' -Status 'passed' -Owner 'scripts' `
    -Ids @{ worker_dev_storage_root = $resolvedRoot; fixture_count = $sources.items.Count }

$source = $null
if (-not [string]::IsNullOrWhiteSpace($DevSourceId)) {
    $source = @($sources.items | Where-Object { $_.source_id -eq $DevSourceId } | Select-Object -First 1)[0]
    if (-not $source) {
        Add-SmokeTier -Record $Record -Tier 'worker_conversion' -Status 'failed' -Owner 'scripts' `
            -Blocker "Dev source id was not found: $DevSourceId" `
            -NextCommand 'List sources with GET /api/dev/ifc-sources and choose a valid source_id'
        Save-Evidence
        throw "Dev source id was not found: $DevSourceId"
    }
} else {
    $source = @($sources.items | Sort-Object filename | Select-Object -First 1)[0]
}

# ---------- Worker conversion tier ----------
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

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    do {
        $result = Invoke-RestMethod "$WorkerUrl/api/conversions/$($conversion.conversion_job_id)/result"
        if ($result.status -eq 'succeeded' -or $result.status -eq 'failed') { break }
        Start-Sleep -Milliseconds 500
    } while ((Get-Date) -lt $deadline)

    if ($result.status -ne 'succeeded') {
        Add-SmokeTier -Record $Record -Tier 'worker_conversion' -Status 'failed' -Owner '_worker' `
            -Blocker "Expected worker conversion result succeeded, got $($result.status)" `
            -NextCommand "Inspect worker job $($conversion.conversion_job_id) and rerun" `
            -Ids @{
                source_artifact_id = $conversion.source_artifact_id
                artifact_group_id  = $conversion.artifact_group_id
                conversion_job_id  = $conversion.conversion_job_id
            } -Detail @{ result = $result }
        Save-Evidence
        throw "Expected worker conversion result succeeded, got $($result.status)"
    }
    if (-not $result.quality_metrics.hard_quality_gates.usdc_openable) {
        Add-SmokeTier -Record $Record -Tier 'worker_conversion' -Status 'failed' -Owner '_worker' `
            -Blocker 'Expected generated USDC to pass the openability quality gate.' `
            -NextCommand 'Re-trigger the conversion and inspect quality_metrics.hard_quality_gates' `
            -Ids @{ conversion_job_id = $conversion.conversion_job_id }
        Save-Evidence
        throw 'Expected generated USDC to pass the openability quality gate.'
    }

    Add-SmokeTier -Record $Record -Tier 'worker_conversion' -Status 'passed' -Owner '_worker' `
        -Ids @{
            source_artifact_id   = $conversion.source_artifact_id
            artifact_group_id    = $conversion.artifact_group_id
            conversion_job_id    = $conversion.conversion_job_id
            usdc_artifact_id     = $result.usdc_artifact_id
            usdc_url             = $result.usdc_url
            mapping_url          = $result.mapping_url
            dev_source_filename  = $source.filename
        } `
        -Detail @{
            source_size_bytes        = $source.size_bytes
            coverage_ratio           = $result.quality_metrics.coverage_ratio
            coverage_status          = $result.quality_metrics.coverage_status
            sidecar_carrier_count    = $result.quality_metrics.sidecar_carrier_count
            materialization_strategy = $result.quality_metrics.materialization_strategy
        }
} catch {
    if (-not ($Record.tiers | Where-Object { $_.tier -eq 'worker_conversion' })) {
        Add-SmokeTier -Record $Record -Tier 'worker_conversion' -Status 'failed' -Owner '_worker' `
            -Blocker $_.Exception.Message
    }
    Save-Evidence
    throw
}

# ---------- _bim-control review request lifecycle tier ----------
$reviewRequest = $null
try {
    $requestBody = @{
        requested_by        = $UserId
        tenant_id           = $TenantId
        project_id          = $ProjectId
        model_version_id    = $ModelVersionId
        artifact_group_ids  = @($conversion.artifact_group_id)
        startup_policy      = @{ routing_policy = 'same_instance' }
        kit_profile         = @{ provider = 'local_fixed' }
    } | ConvertTo-Json -Depth 10
    $reviewRequest = Invoke-RestMethod `
        -Method Post `
        -Uri "$BimControlUrl/api/review-session-requests" `
        -ContentType 'application/json' `
        -Body $requestBody
    if ($reviewRequest.status -ne 'created') {
        throw "Expected review request status created, got $($reviewRequest.status)"
    }
    Add-SmokeTier -Record $Record -Tier 'bim_control_review_request' -Status 'passed' -Owner '_bim-control' `
        -Ids @{
            review_request_id = $reviewRequest.review_request_id
            artifact_group_id = $conversion.artifact_group_id
            status            = $reviewRequest.status
        }
} catch {
    Add-SmokeTier -Record $Record -Tier 'bim_control_review_request' -Status 'failed' -Owner '_bim-control' `
        -Blocker $_.Exception.Message
    Save-Evidence
    throw
}

# ---------- Coordinator session lifecycle tier ----------
$session = $null
$streamConfig = $null
try {
    $sessionBody = @{
        review_request_id  = $reviewRequest.review_request_id
        tenant_id          = $TenantId
        project_id         = $ProjectId
        model_version_id   = $ModelVersionId
        created_by         = $UserId
        routing_policy     = 'same_instance'
        artifact_bindings  = @(@{
            artifact_group_id  = $conversion.artifact_group_id
            model_version_id   = $ModelVersionId
            artifact_id        = $result.usdc_artifact_id
            artifact_role      = 'derived'
            url                = $result.usdc_url
            mapping_url        = $result.mapping_url
            load_order         = 0
            ready_status       = 'ready'
        })
        kit_profile        = @{ provider = 'local_fixed' }
    } | ConvertTo-Json -Depth 20
    $session = Invoke-RestMethod `
        -Method Post `
        -Uri "$CoordinatorUrl/api/review-sessions" `
        -ContentType 'application/json' `
        -Body $sessionBody
    $streamConfig = Invoke-RestMethod "$CoordinatorUrl/api/review-sessions/$($session.session_id)/stream-config"
    if ($streamConfig.model.status -ne 'ready') {
        throw "Expected coordinator stream model ready, got $($streamConfig.model.status)"
    }
    Add-SmokeTier -Record $Record -Tier 'coordinator_session_lifecycle' -Status 'passed' -Owner 'bim-review-coordinator' `
        -Ids @{
            session_id        = $session.session_id
            review_request_id = $reviewRequest.review_request_id
            lifecycle_status  = $streamConfig.lifecycle_status
            model_status      = $streamConfig.model.status
            model_url         = $streamConfig.model.url
        }
} catch {
    Add-SmokeTier -Record $Record -Tier 'coordinator_session_lifecycle' -Status 'failed' -Owner 'bim-review-coordinator' `
        -Blocker $_.Exception.Message
    Save-Evidence
    throw
}

# ---------- _bim-control review request lifecycle patch (sessionBound) ----------
try {
    $patchBody = @{
        status                = $streamConfig.lifecycle_status
        session_id            = $session.session_id
        artifact_bindings     = $streamConfig.artifact_bindings
        kit_instance_bindings = $streamConfig.kit_instance_bindings
        lifecycle_event       = @{ type = 'sessionBound'; session_id = $session.session_id }
    } | ConvertTo-Json -Depth 20
    $patched = Invoke-RestMethod `
        -Method Patch `
        -Uri "$BimControlUrl/api/review-session-requests/$($reviewRequest.review_request_id)" `
        -ContentType 'application/json' `
        -Body $patchBody
    if ($patched.status -ne 'active') {
        throw "Expected patched review request active, got $($patched.status)"
    }
    Add-SmokeTier -Record $Record -Tier 'bim_control_review_request_active' -Status 'passed' -Owner '_bim-control' `
        -Ids @{ review_request_id = $reviewRequest.review_request_id; status = $patched.status }
} catch {
    Add-SmokeTier -Record $Record -Tier 'bim_control_review_request_active' -Status 'failed' -Owner '_bim-control' `
        -Blocker $_.Exception.Message
    Save-Evidence
    throw
}

# ---------- Kit + browser tiers (not driven by this script) ----------
$kitPreflight = Get-KitLauncherPreflight -RepoRoot $RepoRoot
if ($kitPreflight.launcher_present) {
    Add-SmokeTier -Record $Record -Tier 'kit_launcher_preflight' -Status 'passed' -Owner 'bim-streaming-server' `
        -Ids @{ launcher_path = $kitPreflight.launcher_path }
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
        -NextCommand 'Launch bim-streaming-server/scripts/start-streaming-server.ps1 -SkipAutoLoad and rerun' `
        -Ids @{ signaling_endpoint = "$($signalProbe.host):$($signalProbe.port)" }
}

Add-SmokeTier -Record $Record -Tier 'browser_visual_evidence' -Status 'not_observed' -Owner 'web-viewer-sample' `
    -Blocker 'browser automation is out of scope for this smoke script (policy-restricted in workspace)' `
    -NextCommand "Open http://127.0.0.1:5173/?sessionId=$($session.session_id) manually and capture viewport screenshot under docs/verification/2026-05-14-stabilize-demo-runtime-readiness/" `
    -Ids @{
        viewer_url = "http://127.0.0.1:5173/?sessionId=$($session.session_id)"
        session_id = $session.session_id
    }

$singleKitBlocker = @()
if (-not $kitPreflight.launcher_present) { $singleKitBlocker += 'Kit launcher missing' }
if (-not $signalProbe.listening)         { $singleKitBlocker += 'signaling port 49100 closed' }
if (-not $result.usdc_url)               { $singleKitBlocker += 'no successful worker model.usdc' }
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

Add-SmokeTier -Record $Record -Tier 'dedicated_multi_kit_routing' -Status 'deferred' -Owner 'bim-streaming-server' `
    -Blocker 'fewer than two GPU-backed Kit endpoints exist in workspace' `
    -NextCommand 'Design dedicated multi-Kit routing as its own change once a second GPU-backed Kit endpoint exists' `
    -Ids @{ kit_instance_bindings_length = $kitBindingsLength } `
    -Detail @{ invariant = 'stream_config.kit_instance_bindings.length <= 1'; invariant_holds = ($kitBindingsLength -le 1) }

Save-Evidence

Write-Host "[smoke] dev_source: $($source.filename) ($($source.size_bytes) bytes)"
Write-Host "[smoke] source_artifact_id: $($conversion.source_artifact_id)"
Write-Host "[smoke] conversion_job_id: $($conversion.conversion_job_id)"
Write-Host "[smoke] coverage_ratio: $($result.quality_metrics.coverage_ratio)"
Write-Host "[smoke] review_request_id: $($reviewRequest.review_request_id)"
Write-Host "[smoke] session_id: $($session.session_id)"
