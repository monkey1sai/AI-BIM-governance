[CmdletBinding()]
param(
    [string] $BimControlUrl = "http://127.0.0.1:8001",
    [string] $StorageUrl = "http://127.0.0.1:8002",
    [string] $ConversionUrl = "http://127.0.0.1:8003",
    [string] $CoordinatorUrl = "http://127.0.0.1:8004",
    [switch] $SkipConversion
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Test-Health {
    param(
        [string] $Name,
        [string] $Url,
        [switch] $Optional
    )

    try {
        $response = Invoke-RestMethod -Method Get -Uri "$Url/health"
        if ($response.status -ne "ok") {
            throw "$Name returned non-ok status: $($response.status)"
        }
        Write-Host "[health] $Name OK ($Url)"
    }
    catch {
        if ($Optional) {
            Write-Host "[health] $Name SKIPPED/UNAVAILABLE ($Url): $($_.Exception.Message)"
            return
        }
        throw
    }
}

Test-Health -Name "_bim-control" -Url $BimControlUrl
Test-Health -Name "_s3_storage" -Url $StorageUrl
if (-not $SkipConversion) {
    Test-Health -Name "_conversion-service" -Url $ConversionUrl -Optional
}
Test-Health -Name "bim-review-coordinator" -Url $CoordinatorUrl

Write-Host "[health] local development health check passed"
