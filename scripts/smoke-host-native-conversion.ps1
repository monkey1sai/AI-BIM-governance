# Host-native conversion authority smoke
# (introduce-host-native-conversion-authority-service, demo-runtime-readiness-smoke spec).
#
# Evaluates ONLY the `host_native_conversion_authority` tier for the local
# 127.0.0.1:49101 conversion service. This tier is classified INDEPENDENTLY of
# coordinator health, callback outbox delivery, Kit/WebRTC 49100, DataChannel
# stage loading, and browser visual evidence.
#
# Honest rules (AGENTS.md §0.1 / spec "Missing converter is an honest blocker"):
#   - service unreachable                -> blocked  (records target URL + rerun cmd)
#   - converter preflight unavailable    -> blocked  (records missing prerequisite)
#   - job created + ready result + gates -> passed
#   - never fabricates a pass; never promotes this tier to WebRTC/Kit/browser
#
# Usage:
#   pwsh -File scripts/smoke-host-native-conversion.ps1
#   pwsh -File scripts/smoke-host-native-conversion.ps1 -BaseUrl http://127.0.0.1:49101 -EvidencePath out.json

[CmdletBinding()]
param(
    [string] $BaseUrl = "http://127.0.0.1:49101",
    [string] $EvidencePath = "",
    # No IFC fixture is checked into the repo; point this at a real local .ifc
    # (or edge-local ref the host-native work dir can resolve) to get real
    # conversion evidence instead of an invalid_ifc_input blocker.
    [string] $IfcUrl = $(if ($env:STREAMING_CONVERSION_SMOKE_IFC_URL) { $env:STREAMING_CONVERSION_SMOKE_IFC_URL } else { "edge-local://fixtures/smoke-model.ifc" }),
    # Required when the service was started with STREAMING_CONVERSION_INTERNAL_TOKEN.
    [string] $InternalToken = $env:STREAMING_CONVERSION_INTERNAL_TOKEN,
    [int]    $TimeoutSeconds = 120,
    [switch] $SkipJob
)

$ErrorActionPreference = "Stop"
$startCmd = "pwsh -File bim-streaming-server/scripts/start-host-native-conversion-service.ps1"

$tier = [ordered]@{
    tier                 = "host_native_conversion_authority"
    status               = "not_observed"
    service_url          = $BaseUrl
    expected_start_cmd   = $startCmd
    working_directory    = (Get-Location).Path
    shell                = "powershell"
    health               = $null
    conversion_job_id    = $null
    correlation_id       = $null
    model_status         = $null
    artifact_refs        = $null
    coverage_status      = $null
    diagnostic           = $null
    separate_tiers_note  = "single_kit_render / webrtc_49100 / browser_visual require their own evidence; not asserted here"
    observed_at          = (Get-Date).ToUniversalTime().ToString("o")
}

function Save-And-Report {
    if ($EvidencePath) {
        $tier | ConvertTo-Json -Depth 6 | Set-Content -Path $EvidencePath -Encoding utf8
        Write-Host "evidence -> $EvidencePath"
    }
    $tier | ConvertTo-Json -Depth 6
}

# 1. health
try {
    $health = Invoke-RestMethod -Method Get -Uri "$BaseUrl/health" -TimeoutSec 5
    $tier.health = $health
    if ($health.authority -ne "bim-streaming-server" -or $health.role -ne "conversion-only") {
        $tier.status = "failed"
        $tier.diagnostic = "unexpected /health identity (not conversion-only bim-streaming-server)"
        return Save-And-Report
    }
}
catch {
    $tier.status = "blocked"
    $tier.diagnostic = "conversion service unreachable at $BaseUrl/health: $($_.Exception.Message). Rerun: $startCmd"
    return Save-And-Report
}

if ($SkipJob) {
    $tier.status = "blocked"
    $tier.diagnostic = "health ok; job creation skipped (-SkipJob). Conversion evidence not observed."
    return Save-And-Report
}

# 2. create job + read result
$payload = @{
    event_type     = "ifc_ready"
    event_id       = "evt_smoke_hn_001"
    correlation_id = "corr_smoke_hn_001"
    tenant_id      = "tenant_demo_001"
    project_id     = "project_demo_001"
    model_version_id = "version_smoke_hn_001"
    source_rvt_artifact_id = "artifact_rvt_smoke_001"
    ifc_artifact   = @{
        artifact_id = "artifact_ifc_smoke_001"
        format      = "ifc"
        filename    = [System.IO.Path]::GetFileName($IfcUrl)
        url         = $IfcUrl
    }
    requested_outputs = @("usdc", "element_mapping", "entity_index", "metadata")
} | ConvertTo-Json -Depth 6

$postHeaders = @{ "Content-Type" = "application/json" }
if (-not [string]::IsNullOrWhiteSpace($InternalToken)) {
    $postHeaders["X-Internal-Conversion-Token"] = $InternalToken
}

try {
    $created = Invoke-RestMethod -Method Post -Uri "$BaseUrl/api/conversions/ifc-to-usdc" `
        -Headers $postHeaders -Body $payload -TimeoutSec 15
    $tier.conversion_job_id = $created.conversion_job_id
    $tier.correlation_id = $created.correlation_id
}
catch {
    $tier.status = "blocked"
    $tier.diagnostic = "job creation failed: $($_.Exception.Message)"
    return Save-And-Report
}

# Poll until terminal: a single early fetch can observe queued/running and
# (when model is absent) dereferencing $result.model.status would throw.
try {
    $deadline = (Get-Date).ToUniversalTime().AddSeconds($TimeoutSeconds)
    $result = $null
    do {
        $result = Invoke-RestMethod -Method Get `
            -Uri "$BaseUrl/api/conversions/$($tier.conversion_job_id)/result" -TimeoutSec 15
        if ($result.status -in @("succeeded", "succeeded_with_warnings", "failed", "cancelled")) { break }
        Start-Sleep -Seconds 2
    } while ((Get-Date).ToUniversalTime() -lt $deadline)
}
catch {
    $tier.status = "blocked"
    $tier.diagnostic = "result query failed: $($_.Exception.Message)"
    return Save-And-Report
}

$tier.model_status = if ($result.model) { $result.model.status } else { $null }
if ($result.status -in @("queued", "running")) {
    $tier.status = "blocked"
    $tier.diagnostic = "conversion not terminal within smoke timeout (${TimeoutSeconds}s)"
    return Save-And-Report
}
if ($result.status -eq "succeeded" -and $tier.model_status -eq "ready") {
    $tier.status = "passed"
    $tier.artifact_refs = @{
        model_usdc      = $result.artifacts.model_usdc.url
        element_mapping = $result.artifacts.element_mapping.url
        entity_index    = $result.artifacts.entity_index.url
        metadata        = $result.artifacts.metadata.url
    }
    $tier.coverage_status = $result.quality_metrics.coverage_status
}
else {
    # honest blocker: converter prerequisites missing on host -> non-ready,
    # NOT a fabricated pass and NOT mapping-quality evidence.
    $tier.status = "blocked"
    $code = if ($result.error) { $result.error.code } else { $result.status }
    $msg = if ($result.error) { $result.error.message } else { "non-ready result" }
    $tier.diagnostic = "conversion not ready (honest blocker): $code - $msg"
}

Save-And-Report
