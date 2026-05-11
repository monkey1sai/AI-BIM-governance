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
    [int] $TimeoutSeconds = 30
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

Invoke-RestMethod "$WorkerUrl/health" | Out-Null
Invoke-RestMethod "$BimControlUrl/health" | Out-Null
Invoke-RestMethod "$CoordinatorUrl/health" | Out-Null

$sources = Invoke-RestMethod "$WorkerUrl/api/dev/ifc-sources"
if (-not $sources.items -or $sources.items.Count -eq 0) {
    throw "No dev IFC source is available. Put a real .ifc file under the worker dev storage root before running this smoke."
}

$source = $null
if (-not [string]::IsNullOrWhiteSpace($DevSourceId)) {
    $source = @($sources.items | Where-Object { $_.source_id -eq $DevSourceId } | Select-Object -First 1)[0]
    if (-not $source) {
        throw "Dev source id was not found: $DevSourceId"
    }
}
else {
    $source = @($sources.items | Sort-Object filename | Select-Object -First 1)[0]
}

$conversionBody = @{
    tenant_id = $TenantId
    project_id = $ProjectId
    model_version_id = $ModelVersionId
    source_system = "dev_storage"
    uploaded_by = $UserId
    target_format = "usdc"
    generate_mapping = $true
    options = @{ auto_complete = $true }
} | ConvertTo-Json -Depth 10

$conversion = Invoke-RestMethod `
    -Method Post `
    -Uri "$WorkerUrl/api/dev/ifc-sources/$($source.source_id)/conversions" `
    -ContentType "application/json" `
    -Body $conversionBody

$deadline = (Get-Date).AddSeconds($TimeoutSeconds)
$result = $null
do {
    $result = Invoke-RestMethod "$WorkerUrl/api/conversions/$($conversion.conversion_job_id)/result"
    if ($result.status -eq "succeeded") {
        break
    }
    Start-Sleep -Milliseconds 500
} while ((Get-Date) -lt $deadline)

if ($result.status -ne "succeeded") {
    throw "Expected worker conversion result succeeded, got $($result.status)"
}
if (-not $result.quality_metrics.hard_quality_gates.usdc_openable) {
    throw "Expected generated USDC to pass the openability quality gate."
}

$requestBody = @{
    requested_by = $UserId
    tenant_id = $TenantId
    project_id = $ProjectId
    model_version_id = $ModelVersionId
    artifact_group_ids = @($conversion.artifact_group_id)
    startup_policy = @{ routing_policy = "same_instance" }
    kit_profile = @{ provider = "local_fixed" }
} | ConvertTo-Json -Depth 10

$reviewRequest = Invoke-RestMethod `
    -Method Post `
    -Uri "$BimControlUrl/api/review-session-requests" `
    -ContentType "application/json" `
    -Body $requestBody

if ($reviewRequest.status -ne "created") {
    throw "Expected review request status created, got $($reviewRequest.status)"
}

$sessionBody = @{
    review_request_id = $reviewRequest.review_request_id
    tenant_id = $TenantId
    project_id = $ProjectId
    model_version_id = $ModelVersionId
    created_by = $UserId
    routing_policy = "same_instance"
    artifact_bindings = @(@{
        artifact_group_id = $conversion.artifact_group_id
        model_version_id = $ModelVersionId
        artifact_id = $result.usdc_artifact_id
        artifact_role = "derived"
        url = $result.usdc_url
        mapping_url = $result.mapping_url
        load_order = 0
        ready_status = "ready"
    })
    kit_profile = @{ provider = "local_fixed" }
} | ConvertTo-Json -Depth 20

$session = Invoke-RestMethod `
    -Method Post `
    -Uri "$CoordinatorUrl/api/review-sessions" `
    -ContentType "application/json" `
    -Body $sessionBody

$streamConfig = Invoke-RestMethod "$CoordinatorUrl/api/review-sessions/$($session.session_id)/stream-config"
if ($streamConfig.model.status -ne "ready") {
    throw "Expected coordinator stream model ready, got $($streamConfig.model.status)"
}

$patchBody = @{
    status = $streamConfig.lifecycle_status
    session_id = $session.session_id
    artifact_bindings = $streamConfig.artifact_bindings
    kit_instance_bindings = $streamConfig.kit_instance_bindings
    lifecycle_event = @{ type = "sessionBound"; session_id = $session.session_id }
} | ConvertTo-Json -Depth 20

$patched = Invoke-RestMethod `
    -Method Patch `
    -Uri "$BimControlUrl/api/review-session-requests/$($reviewRequest.review_request_id)" `
    -ContentType "application/json" `
    -Body $patchBody

if ($patched.status -ne "active") {
    throw "Expected patched review request active, got $($patched.status)"
}

Write-Host "[smoke] worker review request passed"
Write-Host "[smoke] dev_source: $($source.filename) ($($source.size_bytes) bytes)"
Write-Host "[smoke] source_artifact_id: $($conversion.source_artifact_id)"
Write-Host "[smoke] conversion_job_id: $($conversion.conversion_job_id)"
Write-Host "[smoke] coverage_ratio: $($result.quality_metrics.coverage_ratio)"
Write-Host "[smoke] review_request_id: $($reviewRequest.review_request_id)"
Write-Host "[smoke] session_id: $($session.session_id)"
