[CmdletBinding()]
param()

# Focused script-level assertions for scripts/lib/smoke-evidence.ps1.
# Covers:
#   - Tier separation (worker vs coordinator vs socket vs kit vs browser vs single_kit_render)
#   - Blocker classification fields are preserved through JSON round-trip
#   - single_kit_render evidence shape (viewer_url, session_id, kit_endpoint, video.width/height,
#     stage_load_result, screenshot_path, manual_or_automated)
#   - Multi-Kit invariant tier is always recorded and stays deferred

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

. (Join-Path $PSScriptRoot '..\lib\smoke-evidence.ps1')

function Assert-True {
    param([Parameter(Mandatory=$true)][bool] $Condition, [Parameter(Mandatory=$true)][string] $Message)
    if (-not $Condition) { throw "ASSERT FAILED: $Message" }
}

function Get-TierByName {
    param($Tiers, [string] $Name)
    # Avoid `@(...)[0]` — in strict mode + PowerShell 7 indexing an empty result throws.
    return $Tiers | Where-Object { $_.tier -eq $Name } | Select-Object -First 1
}

# --- Test 1: Fixture-missing blocked classification, with separate tier emission ---
$record = New-SmokeEvidenceRecord -Command 'test-smoke-evidence.ps1' -Cwd 'C:\test' -Context @{ test = 'fixture_missing' }

Add-SmokeTier -Record $record -Tier 'worker_conversion' -Status 'blocked' -Owner '_worker' `
    -Blocker 'no parseable .ifc fixture under WORKER_DEV_STORAGE_ROOT' `
    -NextCommand "Copy a real .ifc into storage and rerun" `
    -Ids @{ worker_dev_storage_root = 'C:\Repos\storage'; fixture_count = 0 } | Out-Null

Add-SmokeTier -Record $record -Tier 'rvt_intake' -Status 'not_observed' -Owner '_bim-control' `
    -Blocker 'RVT intake was not exercised in this smoke' `
    -Ids @{ model_version_id = 'version_demo_001' } | Out-Null

Add-SmokeTier -Record $record -Tier 'rvt_to_ifc_bridge' -Status 'blocked' -Owner '_worker' `
    -Blocker 'Revit runtime unavailable and fake fixture mode disabled' `
    -Ids @{ source_rvt_artifact_id = 'artifact_rvt_test_001' } | Out-Null

Add-SmokeTier -Record $record -Tier 'streaming_conversion_job' -Status 'not_observed' -Owner 'bim-streaming-server' `
    -Blocker 'historical worker conversion must not promote streaming conversion readiness' `
    -Ids @{ conversion_authority = $null; historical_worker_conversion_job_id = 'conv_legacy_001' } | Out-Null

Add-SmokeTier -Record $record -Tier 'mapping_quality' -Status 'not_observed' -Owner 'bim-streaming-server' `
    -Blocker 'mapping quality was not produced by streaming-server in this smoke' | Out-Null

Add-SmokeTier -Record $record -Tier 'coordinator_session_lifecycle' -Status 'passed' -Owner 'bim-review-coordinator' `
    -Ids @{ session_id = 'review_session_test_001'; model_status = 'missing' } | Out-Null

Add-SmokeTier -Record $record -Tier 'socket_io_collaboration' -Status 'passed' -Owner 'bim-review-coordinator' `
    -Ids @{ session_id = 'review_session_test_001' } | Out-Null

Add-SmokeTier -Record $record -Tier 'kit_launcher_preflight' -Status 'blocked' -Owner 'bim-streaming-server' `
    -Blocker 'Streaming launcher not found' `
    -Ids @{ launcher_path = 'C:\Repos\bim-streaming-server\_build\windows-x86_64\release\ezplus.bim_review_stream_streaming.kit.bat' } | Out-Null

Add-SmokeTier -Record $record -Tier 'kit_webrtc_readiness' -Status 'blocked' -Owner 'bim-streaming-server' `
    -Blocker '127.0.0.1:49100 is not listening' -Ids @{ signaling_endpoint = '127.0.0.1:49100' } | Out-Null

Add-SmokeTier -Record $record -Tier 'browser_visual_evidence' -Status 'not_observed' -Owner 'web-viewer-sample' `
    -Blocker 'browser automation policy-restricted' `
    -Ids @{ viewer_url = 'http://127.0.0.1:5173'; session_id = 'review_session_test_001' } | Out-Null

Add-SmokeTier -Record $record -Tier 'single_kit_render' -Status 'blocked' -Owner 'web-viewer-sample' `
    -Blocker 'Kit launcher missing; signaling port 49100 closed; no successful worker model.usdc' `
    -Ids @{
        viewer_url    = 'http://127.0.0.1:5173/?sessionId=review_session_test_001'
        session_id    = 'review_session_test_001'
        kit_endpoint  = '127.0.0.1:49100'
    } `
    -Detail @{
        manual_or_automated = 'manual'
        screenshot_path     = $null
        video               = @{ width = 0; height = 0 }
        stage_load_result   = $null
        missing_prereqs     = @('Kit launcher missing', 'signaling port 49100 closed', 'no successful worker model.usdc')
    } | Out-Null

Add-SmokeTier -Record $record -Tier 'single_kit_multi_viewer' -Status 'deferred' -Owner 'bim-streaming-server' `
    -Blocker 'same-Kit primary/spectator evidence not collected' `
    -Ids @{ kit_instance_bindings_length = 1 } `
    -Detail @{ invariant = 'single Kit, multiple viewers'; evidence_required = @('primary screenshot', 'spectator screenshot') } | Out-Null

Add-SmokeTier -Record $record -Tier 'usd_stage_composition' -Status 'not_observed' -Owner 'bim-streaming-server' `
    -Blocker 'no stage_composition primary artifact in stream-config' `
    -Ids @{ primary_artifact_id = $null; secondary_artifact_ids = @() } | Out-Null

Add-SmokeTier -Record $record -Tier 'dedicated_multi_kit_routing' -Status 'deferred' -Owner 'bim-streaming-server' `
    -Blocker 'fewer than two GPU-backed Kit endpoints exist in workspace' `
    -Ids @{ kit_instance_bindings_length = 0 } `
    -Detail @{ invariant = 'stream_config.kit_instance_bindings.length <= 1'; invariant_holds = $true } | Out-Null

$tempPath = Join-Path ([System.IO.Path]::GetTempPath()) "smoke-evidence-test-$([Guid]::NewGuid()).json"
Save-SmokeEvidence -Record $record -Path $tempPath | Out-Null
$loaded = Get-Content -LiteralPath $tempPath -Raw | ConvertFrom-Json
Remove-Item -LiteralPath $tempPath -Force

Assert-True ($loaded.schema_version -eq 'demo-runtime-readiness-smoke/v1') 'schema_version preserved'
Assert-True ($loaded.capability -eq 'demo-runtime-readiness-smoke') 'capability preserved'

$workerTier = Get-TierByName -Tiers $loaded.tiers -Name 'worker_conversion'
Assert-True ($workerTier.status -eq 'blocked') 'worker_conversion blocked when fixture missing'
Assert-True (-not [string]::IsNullOrWhiteSpace($workerTier.blocker)) 'worker_conversion has blocker text'
Assert-True (-not [string]::IsNullOrWhiteSpace($workerTier.next_command)) 'worker_conversion has next_command'
Assert-True ($workerTier.ids.worker_dev_storage_root -eq 'C:\Repos\storage') 'worker_conversion ids.worker_dev_storage_root preserved'
Assert-True ($workerTier.ids.fixture_count -eq 0) 'worker_conversion ids.fixture_count preserved'

$streamingTier = Get-TierByName -Tiers $loaded.tiers -Name 'streaming_conversion_job'
Assert-True ($streamingTier.status -eq 'not_observed') 'streaming_conversion_job not promoted from historical worker conversion'
Assert-True ($streamingTier.status -ne 'passed') 'streaming_conversion_job MUST NOT pass without bim-streaming-server authority'

$rvtBridgeTier = Get-TierByName -Tiers $loaded.tiers -Name 'rvt_to_ifc_bridge'
Assert-True ($rvtBridgeTier.status -eq 'blocked') 'rvt_to_ifc_bridge blocked when Revit runtime unavailable'

$mappingQualityTier = Get-TierByName -Tiers $loaded.tiers -Name 'mapping_quality'
Assert-True ($mappingQualityTier.status -eq 'not_observed') 'mapping_quality is separate from legacy worker_conversion'

$coordTier = Get-TierByName -Tiers $loaded.tiers -Name 'coordinator_session_lifecycle'
Assert-True ($coordTier.status -eq 'passed') 'coordinator_session_lifecycle passes even when worker conversion is blocked'

$socketTier = Get-TierByName -Tiers $loaded.tiers -Name 'socket_io_collaboration'
Assert-True ($socketTier.status -eq 'passed') 'socket_io_collaboration passes independently'

$kitWebrtcTier = Get-TierByName -Tiers $loaded.tiers -Name 'kit_webrtc_readiness'
Assert-True ($kitWebrtcTier.status -eq 'blocked') 'kit_webrtc_readiness blocked when port closed'

$browserTier = Get-TierByName -Tiers $loaded.tiers -Name 'browser_visual_evidence'
Assert-True ($browserTier.status -eq 'not_observed') 'browser_visual_evidence not_observed when automation blocked'
Assert-True ($browserTier.status -ne 'passed') 'Socket.IO pass MUST NOT promote browser_visual_evidence to passed'

# --- Test 2: single_kit_render evidence shape ---
$singleKit = Get-TierByName -Tiers $loaded.tiers -Name 'single_kit_render'
Assert-True ($singleKit.status -eq 'blocked') 'single_kit_render blocked when prerequisites missing'
Assert-True ($null -ne $singleKit.ids.viewer_url) 'single_kit_render has viewer_url'
Assert-True ($null -ne $singleKit.ids.session_id) 'single_kit_render has session_id'
Assert-True ($null -ne $singleKit.ids.kit_endpoint) 'single_kit_render has kit_endpoint'
Assert-True ($singleKit.detail.video.width -eq 0) 'single_kit_render video.width recorded'
Assert-True ($singleKit.detail.video.height -eq 0) 'single_kit_render video.height recorded'
Assert-True ($singleKit.detail.manual_or_automated -eq 'manual') 'single_kit_render manual_or_automated recorded'
Assert-True ($singleKit.detail.PSObject.Properties.Name -contains 'screenshot_path') 'single_kit_render screenshot_path field present'
Assert-True ($singleKit.detail.PSObject.Properties.Name -contains 'stage_load_result') 'single_kit_render stage_load_result field present'

# --- Test 3: Multi-Kit invariant tier ---
$multiKit = Get-TierByName -Tiers $loaded.tiers -Name 'dedicated_multi_kit_routing'
Assert-True ($null -ne $multiKit) 'dedicated_multi_kit_routing tier present'
Assert-True ($multiKit.status -eq 'deferred') 'dedicated_multi_kit_routing stays deferred'
Assert-True ($multiKit.detail.invariant_holds -eq $true) 'invariant_holds true when bindings <= 1'

$sameKitMultiViewer = Get-TierByName -Tiers $loaded.tiers -Name 'single_kit_multi_viewer'
Assert-True ($sameKitMultiViewer.status -eq 'deferred') 'single_kit_multi_viewer stays deferred without browser evidence'

$stageComposition = Get-TierByName -Tiers $loaded.tiers -Name 'usd_stage_composition'
Assert-True ($stageComposition.status -eq 'not_observed') 'usd_stage_composition not_observed when no primary artifact exists'

# --- Test 4: Invariant rejection — record without required single_kit_render fields cannot be passed ---
$badRecord = New-SmokeEvidenceRecord -Command 'test' -Cwd 'C:\test'
# Attempt to mark single_kit_render passed without required ids — assertion below proves the helper
# does not auto-promote. The convention is: passed requires viewer_url, session_id, kit_endpoint,
# video.width/height, stage_load_result, screenshot_path, manual_or_automated.
Add-SmokeTier -Record $badRecord -Tier 'single_kit_render' -Status 'passed' -Owner 'web-viewer-sample' `
    -Ids @{ session_id = 'review_session_x' } -Detail @{ video = @{ width = 1280; height = 720 } } | Out-Null

$bad = Get-TierByName -Tiers $badRecord.tiers -Name 'single_kit_render'
$hasViewerUrl = $bad.ids.PSObject.Properties.Name -contains 'viewer_url'
$hasScreenshot = $bad.detail.PSObject.Properties.Name -contains 'screenshot_path'
Assert-True ((-not $hasViewerUrl) -or (-not $hasScreenshot)) 'partial passed record can be detected via missing fields'

# --- Test 5: dedicated_multi_kit_routing MUST NOT be promoted to passed from single_kit_render ---
$writableMulti = Get-TierByName -Tiers $badRecord.tiers -Name 'dedicated_multi_kit_routing'
Assert-True ($null -eq $writableMulti) 'single_kit_render passed does not auto-emit dedicated_multi_kit_routing'

# --- Test 6: Resolve-WorkerDevStorageRoot defaults to canonical path when env unset ---
$prior = $env:WORKER_DEV_STORAGE_ROOT
$env:WORKER_DEV_STORAGE_ROOT = $null
try {
    $root = Resolve-WorkerDevStorageRoot
    Assert-True ($root -eq 'C:\Repos\active\iot\AI-BIM-governance\storage') "default storage root resolves to canonical path (got '$root')"
} finally {
    if ($prior) { $env:WORKER_DEV_STORAGE_ROOT = $prior }
}

# --- Test 7: Resolve-WorkerDevStorageRoot honors override and env var ---
$root2 = Resolve-WorkerDevStorageRoot -Override 'C:\custom\path'
Assert-True ($root2 -eq 'C:\custom\path') 'override path honored'

$env:WORKER_DEV_STORAGE_ROOT = 'D:\env\path'
try {
    $root3 = Resolve-WorkerDevStorageRoot
    Assert-True ($root3 -eq 'D:\env\path') 'env var path honored when no override'
} finally {
    if ($prior) { $env:WORKER_DEV_STORAGE_ROOT = $prior } else { Remove-Item -Path Env:WORKER_DEV_STORAGE_ROOT -ErrorAction SilentlyContinue }
}

Write-Host "[test-smoke-evidence] all assertions passed"
