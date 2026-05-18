[CmdletBinding()]
param(
    [string] $BimControlUrl = "http://127.0.0.1:8001",
    [string] $WorkerUrl = "http://127.0.0.1:8005",
    [string] $CoordinatorUrl = "http://127.0.0.1:8004",
    [string] $ViewerUrl = "http://127.0.0.1:5173"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Test-JsonEndpoint {
    param(
        [string] $Name,
        [string] $Uri
    )

    $response = Invoke-RestMethod -Method Get -Uri $Uri
    if ($response.status -and $response.status -ne "ok") {
        throw "$Name returned non-ok status: $($response.status)"
    }
    Write-Host "[ok] $Name $Uri"
}

function Test-HtmlEndpoint {
    param(
        [string] $Name,
        [string] $Uri
    )

    $response = Invoke-WebRequest -Method Get -Uri $Uri
    if ($response.StatusCode -lt 200 -or $response.StatusCode -ge 300) {
        throw "$Name returned HTTP $($response.StatusCode)"
    }
    Write-Host "[ok] $Name $Uri"
}

# B-scheme T2：_bim-control(:8001) / _worker(:8005) 已自 repo 刪除（外部平台由 tests/fakes 模擬）
Test-JsonEndpoint -Name "coordinator health" -Uri "$CoordinatorUrl/health"
Test-HtmlEndpoint -Name "coordinator UI" -Uri "$CoordinatorUrl/ui"
Test-HtmlEndpoint -Name "web viewer" -Uri $ViewerUrl

Write-Host "[demo] health and UI checks passed"
