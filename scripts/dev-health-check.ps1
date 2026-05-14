[CmdletBinding()]
param(
    [string] $BimControlUrl = "http://127.0.0.1:8001",
    [string] $WorkerUrl = "http://127.0.0.1:8005",
    [string] $CoordinatorUrl = "http://127.0.0.1:8004",
    [string] $ViewerUrl = "http://127.0.0.1:5173",
    [string] $EvidencePath = "",
    [switch] $StrictKit
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

. (Join-Path $PSScriptRoot 'lib\smoke-evidence.ps1')

$RepoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
if ([string]::IsNullOrWhiteSpace($EvidencePath)) {
    $EvidencePath = Join-Path $RepoRoot 'docs\verification\2026-05-14-stabilize-demo-runtime-readiness\dev-health-check-evidence.json'
}

$Record = New-SmokeEvidenceRecord -Command $MyInvocation.MyCommand.Path -Cwd (Get-Location).Path -Context @{
    bim_control_url = $BimControlUrl
    worker_url      = $WorkerUrl
    coordinator_url = $CoordinatorUrl
    viewer_url      = $ViewerUrl
}

function Test-Health {
    param(
        [string] $Name,
        [string] $Url,
        [switch] $Optional
    )

    try {
        $response = Invoke-RestMethod -Method Get -Uri "$Url/health" -TimeoutSec 5
        if ($response.status -ne "ok") {
            Add-SmokeTier -Record $Record -Tier 'service_health' -Status 'failed' -Owner $Name `
                -Blocker "$Name returned non-ok status: $($response.status)" `
                -Ids @{ url = $Url }
            return
        }
        Add-SmokeTier -Record $Record -Tier 'service_health' -Status 'passed' -Owner $Name `
            -Ids @{ url = $Url }
        Write-Host "[health] $Name OK ($Url)"
    }
    catch {
        $status = if ($Optional) { 'not_observed' } else { 'blocked' }
        Add-SmokeTier -Record $Record -Tier 'service_health' -Status $status -Owner $Name `
            -Blocker $_.Exception.Message `
            -NextCommand "scripts/start-all.ps1 -SkipStreaming and rerun" `
            -Ids @{ url = $Url }
        if ($Optional) {
            Write-Host "[health] $Name SKIPPED/UNAVAILABLE ($Url): $($_.Exception.Message)"
            return
        }
        Save-SmokeEvidence -Record $Record -Path $EvidencePath | Out-Null
        Write-SmokeTierSummary -Record $Record
        throw
    }
}

Test-Health -Name "_bim-control" -Url $BimControlUrl
Test-Health -Name "_worker" -Url $WorkerUrl
Test-Health -Name "bim-review-coordinator" -Url $CoordinatorUrl

# Viewer route is a static page; HTTP 200 is allowed evidence but never implies WebRTC.
try {
    $viewerResponse = Invoke-WebRequest -Uri $ViewerUrl -TimeoutSec 5 -UseBasicParsing
    if ($viewerResponse.StatusCode -eq 200) {
        Add-SmokeTier -Record $Record -Tier 'service_health' -Status 'passed' -Owner 'web-viewer-sample' `
            -Ids @{ url = $ViewerUrl } -Detail @{ note = 'HTTP 200 does not imply WebRTC video or DataChannel stage load.' }
    } else {
        Add-SmokeTier -Record $Record -Tier 'service_health' -Status 'failed' -Owner 'web-viewer-sample' `
            -Blocker "viewer route returned HTTP $($viewerResponse.StatusCode)" `
            -Ids @{ url = $ViewerUrl }
    }
} catch {
    Add-SmokeTier -Record $Record -Tier 'service_health' -Status 'not_observed' -Owner 'web-viewer-sample' `
        -Blocker $_.Exception.Message `
        -NextCommand "Start web-viewer-sample (scripts/start-all.ps1) and rerun" `
        -Ids @{ url = $ViewerUrl }
}

# Fixture preflight (informational, separate from Kit/WebRTC tiers).
$resolvedRoot = Resolve-WorkerDevStorageRoot
$fixtureSummary = Get-WorkerDevFixtureSummary -Root $resolvedRoot
if ($fixtureSummary.fixture_count -gt 0) {
    Add-SmokeTier -Record $Record -Tier 'fixture_preflight' -Status 'passed' -Owner 'scripts' `
        -Ids @{ worker_dev_storage_root = $resolvedRoot; fixture_count = $fixtureSummary.fixture_count }
} else {
    Add-SmokeTier -Record $Record -Tier 'fixture_preflight' -Status 'blocked' -Owner '_worker' `
        -Blocker "no .ifc fixture present under '$resolvedRoot'" `
        -NextCommand "Copy a real .ifc into '$resolvedRoot' or set WORKER_DEV_STORAGE_ROOT, then rerun" `
        -Ids @{ worker_dev_storage_root = $resolvedRoot; fixture_count = 0 }
}

# Kit launcher preflight (Kit health is OUT OF SCOPE for the trivial dev-health-check; only classify).
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

Save-SmokeEvidence -Record $Record -Path $EvidencePath | Out-Null
Write-SmokeTierSummary -Record $Record
Write-Host "[health] evidence: $EvidencePath"
Write-Host "[health] local development health check completed"

if ($StrictKit) {
    $kitBlocked = $Record.tiers | Where-Object { $_.tier -in @('kit_launcher_preflight', 'kit_webrtc_readiness') -and $_.status -ne 'passed' }
    if ($kitBlocked) {
        throw "Strict mode: Kit tiers blocked. See evidence at $EvidencePath"
    }
}
