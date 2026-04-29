[CmdletBinding()]
param(
    [string] $BimControlUrl = "http://127.0.0.1:8001",
    [string] $StorageUrl = "http://127.0.0.1:8002",
    [string] $CoordinatorUrl = "http://127.0.0.1:8004",
    [string] $ProjectId = "project_demo_001",
    [string] $ModelVersionId = "version_demo_001",
    [string] $UserId = "dev_user_001"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

Invoke-RestMethod "$BimControlUrl/health" | Out-Null
Invoke-RestMethod "$StorageUrl/health" | Out-Null
Invoke-RestMethod "$CoordinatorUrl/health" | Out-Null

$body = @{
    project_id = $ProjectId
    model_version_id = $ModelVersionId
    created_by = $UserId
    mode = "single_kit_shared_state"
    options = @{ auto_allocate_kit = $true }
} | ConvertTo-Json -Depth 10

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
