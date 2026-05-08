[CmdletBinding()]
param(
    [string] $BimControlUrl = "http://127.0.0.1:8001",
    [string] $WorkerUrl = "http://127.0.0.1:8005",
    [string] $CoordinatorUrl = "http://127.0.0.1:8004",
    [string] $ProjectId = "project_demo_001",
    [string] $ModelVersionId = "version_demo_001",
    [string] $UserId = "dev_user_001"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Test-HttpResource {
    param(
        [string] $Name,
        [string] $Uri
    )

    if ([string]::IsNullOrWhiteSpace($Uri)) {
        throw "Missing $Name URL"
    }

    try {
        $response = Invoke-WebRequest -Method Head -Uri $Uri -TimeoutSec 5 -UseBasicParsing
    } catch {
        $response = Invoke-WebRequest -Method Get -Uri $Uri -TimeoutSec 5 -UseBasicParsing
    }

    if ($response.StatusCode -lt 200 -or $response.StatusCode -ge 300) {
        throw "$Name returned HTTP $($response.StatusCode): $Uri"
    }
}

Invoke-RestMethod "$BimControlUrl/health" | Out-Null
Invoke-RestMethod "$WorkerUrl/health" | Out-Null
Invoke-RestMethod "$CoordinatorUrl/health" | Out-Null

$ifcText = "ISO-10303-21;`nEND-ISO-10303-21;`n"
$artifactBody = @{
    tenant_id = "tenant_demo_001"
    project_id = $ProjectId
    model_version_id = $ModelVersionId
    source_system = "smoke"
    uploaded_by = $UserId
    filename = "source.ifc"
    source_format = "ifc"
    content_base64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($ifcText))
} | ConvertTo-Json -Depth 10

$artifact = Invoke-RestMethod `
    -Method Post `
    -Uri "$WorkerUrl/api/artifacts" `
    -ContentType "application/json" `
    -Body $artifactBody

$conversionBody = @{
    source_artifact_id = $artifact.source_artifact_id
    target_format = "usdc"
    generate_mapping = $true
    options = @{ auto_complete = $true }
} | ConvertTo-Json -Depth 10

$conversion = Invoke-RestMethod `
    -Method Post `
    -Uri "$WorkerUrl/api/conversions" `
    -ContentType "application/json" `
    -Body $conversionBody

$deadline = (Get-Date).AddSeconds(30)
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

$body = @{
    project_id = $ProjectId
    model_version_id = $ModelVersionId
    created_by = $UserId
    mode = "single_kit_shared_state"
    artifact_bindings = @(@{
        artifact_group_id = $artifact.artifact_group_id
        model_version_id = $ModelVersionId
        artifact_id = $result.usdc_artifact_id
        artifact_role = "derived"
        url = $result.usdc_url
        mapping_url = $result.mapping_url
        load_order = 0
        ready_status = "ready"
    })
    options = @{ auto_allocate_kit = $true }
} | ConvertTo-Json -Depth 20

$session = Invoke-RestMethod `
    -Method Post `
    -Uri "$CoordinatorUrl/api/review-sessions" `
    -ContentType "application/json" `
    -Body $body

if ([string]::IsNullOrWhiteSpace($session.session_id)) {
    throw "Missing session_id"
}

$config = Invoke-RestMethod "$CoordinatorUrl/api/review-sessions/$($session.session_id)/stream-config"
$artifacts = Invoke-RestMethod "$BimControlUrl/api/model-versions/$ModelVersionId/artifacts"
$issues = Invoke-RestMethod "$BimControlUrl/api/model-versions/$ModelVersionId/review-issues"

if (-not $config.webrtc.signalingPort) {
    throw "Missing signalingPort"
}
if ($config.webrtc.signalingPort -ne 49100) {
    throw "Expected signalingPort 49100, got $($config.webrtc.signalingPort)"
}
if ($config.model.status -ne "ready") {
    throw "Expected ready review model, got $($config.model.status)"
}
Test-HttpResource -Name "model.url" -Uri $config.model.url
Test-HttpResource -Name "model.mapping_url" -Uri $config.model.mapping_url
if ($null -eq $artifacts.items) {
    throw "Missing artifacts.items"
}
if ($null -eq $issues.items) {
    throw "Missing issues.items"
}

$annotationBody = @{
    annotation_id = "ann_smoke_$($session.session_id)"
    project_id = $ProjectId
    model_version_id = $ModelVersionId
    author_id = $UserId
    title = "Smoke annotation"
    body = "Created by smoke-review-session.ps1"
    usd_prim_path = "/World"
} | ConvertTo-Json -Depth 10

$annotation = Invoke-RestMethod `
    -Method Post `
    -Uri "$BimControlUrl/api/review-sessions/$($session.session_id)/annotations" `
    -ContentType "application/json" `
    -Body $annotationBody

if ([string]::IsNullOrWhiteSpace($annotation.annotation_id)) {
    throw "Missing annotation_id"
}

$eventBody = @{
    type = "highlightRequest"
    issue_id = "ISSUE-DEMO-001"
    items = @(@{ usd_prim_path = "/World"; color = @(1, 0, 0, 1); label = "Smoke" })
} | ConvertTo-Json -Depth 10

$event = Invoke-RestMethod `
    -Method Post `
    -Uri "$CoordinatorUrl/api/review-sessions/$($session.session_id)/events" `
    -ContentType "application/json" `
    -Body $eventBody

if ([string]::IsNullOrWhiteSpace($event.event_id)) {
    throw "Missing event_id"
}

Write-Host "[smoke] review session passed: $($session.session_id)"
Write-Host "[smoke] model status: $($config.model.status)"
Write-Host "[smoke] artifacts: $($artifacts.items.Count)"
Write-Host "[smoke] issues: $($issues.items.Count)"
Write-Host "[smoke] annotation: $($annotation.annotation_id)"
