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

function Get-JsonNumber {
    param(
        [object] $Object,
        [string] $PropertyName
    )

    if ($null -eq $Object) {
        return 0
    }
    $property = $Object.PSObject.Properties[$PropertyName]
    if ($null -eq $property -or $null -eq $property.Value) {
        return 0
    }
    return [int] $property.Value
}

function Assert-PropertyPresent {
    param(
        [object] $Object,
        [string] $PropertyName
    )

    $property = $Object.PSObject.Properties[$PropertyName]
    if ($null -eq $property -or $null -eq $property.Value -or [string]::IsNullOrWhiteSpace([string] $property.Value)) {
        throw "Mapping item is missing required property '$PropertyName'"
    }
}

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
$mappedCount = Get-JsonNumber -Object $mapping.summary -PropertyName "mapped_count"
$unmappedIfcCount = Get-JsonNumber -Object $mapping.summary -PropertyName "unmapped_ifc_count"
$unmappedUsdCount = Get-JsonNumber -Object $mapping.summary -PropertyName "unmapped_usd_count"
$fakeMappingCount = Get-JsonNumber -Object $mapping.summary -PropertyName "fake_mapping_count"
Write-Host "[smoke] mapping mapped_count = $mappedCount"
Write-Host "[smoke] mapping unmapped_ifc_count = $unmappedIfcCount"
Write-Host "[smoke] mapping unmapped_usd_count = $unmappedUsdCount"
Write-Host "[smoke] mapping fake_mapping_count = $fakeMappingCount"

if (-not $AllowFakeMapping) {
    if ($mappedCount -le 0) {
        throw "Mapping correctness failed: mapped_count must be > 0 when allow_fake_mapping=false."
    }
    if ($fakeMappingCount -ne 0) {
        throw "Mapping correctness failed: fake_mapping_count must be 0 when allow_fake_mapping=false."
    }

    $items = @($mapping.items)
    if ($items.Count -le 0) {
        throw "Mapping correctness failed: element_mapping.json items[] is empty."
    }
    foreach ($item in $items) {
        Assert-PropertyPresent -Object $item -PropertyName "ifc_guid"
        Assert-PropertyPresent -Object $item -PropertyName "ifc_class"
        Assert-PropertyPresent -Object $item -PropertyName "revit_element_id"
        Assert-PropertyPresent -Object $item -PropertyName "usd_prim_path"
        Assert-PropertyPresent -Object $item -PropertyName "mapping_method"
        Assert-PropertyPresent -Object $item -PropertyName "mapping_confidence"
        if ($item.mapping_method -eq "fake_for_smoke_test") {
            throw "Mapping correctness failed: fake_for_smoke_test item is not allowed when allow_fake_mapping=false."
        }
    }
    Write-Host "[smoke] mapping correctness passed: real mapped items found, no fake mappings accepted"
}
else {
    Write-Host "[smoke] -AllowFakeMapping was set; fake mappings are accepted for smoke-only flow checks"
}

$stored = Invoke-RestMethod -Method Get -Uri "$BimControlUrl/api/model-versions/$ModelVersionId/conversion-result"
if ($stored.usdc_url -ne $result.usdc_url) {
    throw "_bim-control result usdc_url did not match conversion result"
}

Write-Host "[smoke] job status = succeeded"
Write-Host "[smoke] usdc_url = $($result.usdc_url)"
Write-Host "[smoke] mapping_url = $($result.mapping_url)"
