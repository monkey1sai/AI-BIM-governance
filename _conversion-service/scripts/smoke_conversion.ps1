[CmdletBinding()]
param(
    [string] $ConversionServiceUrl = "http://127.0.0.1:8003",
    [string] $StorageUrl = "http://localhost:8002/static",
    [string] $BimControlUrl = "http://localhost:8001",
    [string] $ProjectId = "project_demo_001",
    [string] $ModelVersionId = "version_demo_001",
    [string] $SourceArtifactId = "artifact_ifc_demo_001",
    [int] $TimeoutSeconds = 1200,
    [switch] $AllowFakeMapping
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$sourceUrl = "$StorageUrl/projects/$ProjectId/versions/$ModelVersionId/source.ifc"
$requestBody = @{
    project_id = $ProjectId
    model_version_id = $ModelVersionId
    source_artifact_id = $SourceArtifactId
    source_url = $sourceUrl
    target_format = "usdc"
    options = @{
        force = $true
        generate_mapping = $true
        allow_fake_mapping = [bool]$AllowFakeMapping
    }
} | ConvertTo-Json -Depth 8

Write-Host "[smoke] posting conversion job"
$job = Invoke-RestMethod -Method Post -Uri "$ConversionServiceUrl/api/conversions" -ContentType "application/json" -Body $requestBody
Write-Host "[smoke] job_id = $($job.job_id)"

$deadline = (Get-Date).AddSeconds($TimeoutSeconds)
$status = $null
do {
    Start-Sleep -Seconds 2
    $status = Invoke-RestMethod -Method Get -Uri "$ConversionServiceUrl/api/conversions/$($job.job_id)"
    Write-Host "[smoke] job status = $($status.status), stage = $($status.stage)"

    if ($status.status -eq "failed") {
        $errorJson = $status.error | ConvertTo-Json -Depth 8
        throw "Conversion failed: $errorJson"
    }
} until ($status.status -eq "succeeded" -or (Get-Date) -gt $deadline)

if ($status.status -ne "succeeded") {
    throw "Timed out waiting for conversion job $($job.job_id)"
}

$result = Invoke-RestMethod -Method Get -Uri "$ConversionServiceUrl/api/conversions/$($job.job_id)/result"
if ([string]::IsNullOrWhiteSpace($result.usdc_url)) {
    throw "result.usdc_url is empty"
}
if ([string]::IsNullOrWhiteSpace($result.mapping_url)) {
    throw "result.mapping_url is empty"
}

foreach ($url in @($result.usdc_url, $result.ifc_index_url, $result.usd_index_url, $result.mapping_url)) {
    $response = Invoke-WebRequest -Method Head -Uri $url -UseBasicParsing
    if ($response.StatusCode -lt 200 -or $response.StatusCode -ge 300) {
        throw "Expected 2xx from $url, got $($response.StatusCode)"
    }
    Write-Host "[smoke] reachable: $url"
}

$mapping = Invoke-RestMethod -Method Get -Uri $result.mapping_url
Write-Host "[smoke] mapping mapped_count = $($mapping.summary.mapped_count)"
Write-Host "[smoke] mapping unmapped_ifc_count = $($mapping.summary.unmapped_ifc_count)"
Write-Host "[smoke] mapping unmapped_usd_count = $($mapping.summary.unmapped_usd_count)"
Write-Host "[smoke] mapping fake_mapping_count = $($mapping.summary.fake_mapping_count)"

$stored = Invoke-RestMethod -Method Get -Uri "$BimControlUrl/api/model-versions/$ModelVersionId/conversion-result"
if ($stored.usdc_url -ne $result.usdc_url) {
    throw "_bim-control result usdc_url did not match conversion result"
}

Write-Host "[smoke] job status = succeeded"
Write-Host "[smoke] usdc_url = $($result.usdc_url)"
Write-Host "[smoke] mapping_url = $($result.mapping_url)"
