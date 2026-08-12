# scripts\tests\test-measure-session-baseline.ps1
# Unit + fail-safe + schema + registry-consistency tests for
# scripts\lib\measure-session-baseline.ps1 and the scripts\measure-session-baseline.ps1
# root CLI wrapper (openspec/changes/gpu-session-baseline-and-idle-reclaim task 1.1/1.2).

. (Join-Path $PSScriptRoot 'test-helpers.ps1')

$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$libPath = Join-Path $repoRoot 'scripts\lib\measure-session-baseline.ps1'
$rootScriptPath = Join-Path $repoRoot 'scripts\measure-session-baseline.ps1'
. $libPath

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$REQUIRED_ENV_FINGERPRINT_FIELDS = @('gpu_model', 'gpu_driver_version', 'kit_version', 'fixture_hash', 'fixture_size_bytes')
$REQUIRED_REPORT_TOP_LEVEL_KEYS = @(
    'schema_version', 'run_id', 'captured_at', 'host', 'environment_fingerprint',
    'gpu_inventory', 'session_vram_watermark', 'webrtc_health_probe', 'ttff_ms', 'session_creation_success_rate'
)

function Assert-MeasuredShape {
    param([Parameter(Mandatory = $true)] $Obj, [Parameter(Mandatory = $true)][string] $Message)
    Assert-True ($Obj.Contains('value')) "$Message has 'value' key"
    Assert-True ($Obj.Contains('measured')) "$Message has 'measured' key"
    Assert-True ($Obj.Contains('reason')) "$Message has 'reason' key"
    if ($Obj.measured) {
        Assert-True ($null -ne $Obj.value) "$Message measured=true implies non-null value"
    } else {
        Assert-True ($null -eq $Obj.value) "$Message measured=false implies null value (no fabrication)"
        Assert-True (-not [string]::IsNullOrWhiteSpace($Obj.reason)) "$Message measured=false carries a non-empty reason"
    }
}

function Assert-ReportSchemaShape {
    param([Parameter(Mandatory = $true)] $Report, [Parameter(Mandatory = $true)][string] $Message)
    foreach ($key in $REQUIRED_REPORT_TOP_LEVEL_KEYS) {
        Assert-True ($Report.Contains($key)) "$Message :: report has top-level key '$key'"
    }
    Assert-Equal 'gpu-session-baseline-report/v1' $Report.schema_version "$Message :: schema_version pinned"
    Assert-True ($Report.run_id -match '^measure_\d{8}_\d{6}_[0-9a-f]{6}$') "$Message :: run_id matches measure_<date>_<time>_<hex6>"
    Assert-True ($Report.captured_at -match '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$') "$Message :: captured_at is ISO8601 UTC with milliseconds"

    $ef = $Report.environment_fingerprint
    foreach ($field in $REQUIRED_ENV_FINGERPRINT_FIELDS) {
        Assert-True ($ef.Contains($field)) "$Message :: environment_fingerprint has required field '$field'"
        Assert-MeasuredShape -Obj $ef[$field] -Message "$Message :: environment_fingerprint.$field"
    }
    Assert-True ($ef.Contains('complete')) "$Message :: environment_fingerprint has 'complete'"
    Assert-True ($ef.Contains('gpu_count')) "$Message :: environment_fingerprint has 'gpu_count'"
    Assert-True ($ef.Contains('gpu_fingerprint_scope')) "$Message :: environment_fingerprint declares its GPU scope"
    Assert-True ($ef.gpu_fingerprint_scope_note -match 'deferred to task 1.2') "$Message :: GPU scope note defers per-GPU fingerprinting to task 1.2"
    $expectComplete = -not [bool]($REQUIRED_ENV_FINGERPRINT_FIELDS | Where-Object { -not $ef[$_].measured })
    Assert-Equal $expectComplete $ef.complete "$Message :: environment_fingerprint.complete matches per-field measured flags"

    Assert-MeasuredShape -Obj $Report.ttff_ms -Message "$Message :: ttff_ms"
    Assert-MeasuredShape -Obj $Report.session_creation_success_rate -Message "$Message :: session_creation_success_rate"
    # Both metrics can only ever arrive from the caller; the report must say so.
    Assert-Equal 'caller_supplied' $Report.ttff_ms.source "$Message :: ttff_ms tagged source=caller_supplied"
    Assert-Equal 'caller_supplied' $Report.session_creation_success_rate.source "$Message :: session_creation_success_rate tagged source=caller_supplied"

    Assert-True ($Report.gpu_inventory.Contains('measured')) "$Message :: gpu_inventory has 'measured'"
    Assert-True ($Report.gpu_inventory.Contains('gpus')) "$Message :: gpu_inventory has 'gpus'"
    Assert-True ($Report.session_vram_watermark.Contains('measured')) "$Message :: session_vram_watermark has 'measured'"
    Assert-Equal 'process_name_match_only' $Report.session_vram_watermark.attribution "$Message :: session_vram_watermark declares its attribution basis"
    Assert-True ($Report.session_vram_watermark.Contains('observed_primary_lease_count')) "$Message :: session_vram_watermark has 'observed_primary_lease_count'"
    Assert-True ($Report.session_vram_watermark.Contains('observed_spectator_lease_count')) "$Message :: session_vram_watermark has 'observed_spectator_lease_count'"
    Assert-True ($Report.webrtc_health_probe.Contains('measured')) "$Message :: webrtc_health_probe has 'measured'"
    Assert-Equal $false $Report.webrtc_health_probe.webrtc_signaling_probed "$Message :: webrtc_health_probe admits no signaling endpoint was probed"
    Assert-Equal 'coordinator_only' $Report.webrtc_health_probe.probe_scope "$Message :: webrtc_health_probe declares probe_scope=coordinator_only"
}

# ============================================================================
# 1. Consumer-RTX / MIG classification
# ============================================================================
Assert-True (Test-ConsumerRtxGpuName -Name 'NVIDIA GeForce RTX 4060 Ti') 'GeForce RTX 4060 Ti classified as consumer'
Assert-True (Test-ConsumerRtxGpuName -Name 'NVIDIA GeForce RTX 4090') 'GeForce RTX 4090 classified as consumer'
Assert-True (-not (Test-ConsumerRtxGpuName -Name 'NVIDIA RTX A6000')) 'RTX A6000 excluded from consumer classification'
Assert-True (-not (Test-ConsumerRtxGpuName -Name 'NVIDIA H100 80GB HBM3')) 'H100 excluded from consumer classification'
Assert-True (-not (Test-ConsumerRtxGpuName -Name 'Tesla T4')) 'Tesla T4 excluded from consumer classification'
Assert-True (-not (Test-ConsumerRtxGpuName -Name 'Quadro RTX 8000')) 'Quadro RTX 8000 excluded from consumer classification'
Assert-True (-not (Test-ConsumerRtxGpuName -Name '')) 'empty name is not consumer'
Write-TestPass 'consumer RTX name classification'

$consumerLine = ConvertFrom-NvidiaSmiGpuLine -Line '0, NVIDIA GeForce RTX 4060 Ti, 580.97, 8188, 1827, 6123, 2, 0, [N/A]'
Assert-True $consumerLine.parse_ok 'consumer GPU line parses'
Assert-Equal 8188 $consumerLine.memory_total_mb 'memory_total_mb parsed'
Assert-Equal 1827 $consumerLine.memory_used_mb 'memory_used_mb parsed'
Assert-True $consumerLine.is_consumer_rtx 'consumer GPU line flagged consumer RTX'
Assert-True (-not $consumerLine.mig_available) 'bracketed [N/A] MIG mode treated as unavailable'
Assert-Equal 'N/A' $consumerLine.mig_mode_raw 'brackets stripped from mig_mode_raw'

$migEnabledLine = ConvertFrom-NvidiaSmiGpuLine -Line '0, NVIDIA H100 80GB HBM3, 550.54, 81920, 0, 81920, 0, 0, Enabled'
Assert-True $migEnabledLine.mig_available 'Enabled MIG mode treated as available'
Assert-True (-not $migEnabledLine.is_consumer_rtx) 'H100 not classified as consumer RTX'

$malformedLine = ConvertFrom-NvidiaSmiGpuLine -Line 'not,enough,fields'
Assert-True (-not $malformedLine.parse_ok) 'malformed GPU line marked parse_ok=false, never throws'
Write-TestPass 'nvidia-smi GPU line parsing'

# ============================================================================
# 2. Get-GpuInventorySnapshot
# ============================================================================
$inv = Get-GpuInventorySnapshot -NvidiaSmiQuery { @('0, NVIDIA GeForce RTX 4060 Ti, 580.97, 8188, 1827, 6123, 2, 0, [N/A]') }
Assert-True $inv.measured 'single consumer GPU inventory measured=true'
Assert-Equal 1 @($inv.gpus).Count 'single consumer GPU inventory returns one row'
Assert-True $inv.consumer_grade_all 'single consumer GPU: consumer_grade_all=true'
Assert-True (-not $inv.mig_available_any) 'single consumer GPU: mig_available_any=false'
Assert-True $inv.software_queue_required 'consumer GPU with no MIG locks to software queue path'

$invMixed = Get-GpuInventorySnapshot -NvidiaSmiQuery {
    @(
        '0, NVIDIA GeForce RTX 4060 Ti, 580.97, 8188, 1827, 6123, 2, 0, [N/A]',
        '1, NVIDIA H100 80GB HBM3, 550.54, 81920, 0, 81920, 0, 0, Enabled'
    )
}
Assert-Equal 2 @($invMixed.gpus).Count 'mixed inventory returns two rows'
Assert-True (-not $invMixed.consumer_grade_all) 'mixed fleet: consumer_grade_all=false'
Assert-True $invMixed.mig_available_any 'mixed fleet: mig_available_any=true'
Assert-True (-not $invMixed.software_queue_required) 'mixed fleet with MIG-capable GPU does not force software queue'

$invMissing = Get-GpuInventorySnapshot -NvidiaSmiQuery { return $null }
Assert-True (-not $invMissing.measured) 'nvidia-smi absent -> measured=false'
Assert-Equal 0 @($invMissing.gpus).Count 'nvidia-smi absent -> empty gpu list, never fabricated'
Assert-True (-not [string]::IsNullOrWhiteSpace($invMissing.reason)) 'nvidia-smi absent -> reason present'
Assert-True ($null -eq $invMissing.software_queue_required) 'nvidia-smi absent -> derived fields left null, not guessed'

$invThrows = Get-GpuInventorySnapshot -NvidiaSmiQuery { throw 'boom' }
Assert-True (-not $invThrows.measured) 'nvidia-smi query throwing is caught, not propagated'
Assert-True ($invThrows.reason -match 'boom') 'thrown message captured in reason'

$invEmpty = Get-GpuInventorySnapshot -NvidiaSmiQuery { @() }
Assert-True (-not $invEmpty.measured) 'nvidia-smi returning zero rows -> measured=false'
Write-TestPass 'Get-GpuInventorySnapshot (measured + fail-safe paths)'

# ============================================================================
# 3. Get-GpuComputeProcessSnapshot
# ============================================================================
$procSnap = Get-GpuComputeProcessSnapshot -NvidiaSmiComputeAppsQuery {
    @(
        '40232, kit.exe, 2048',
        '1924, [Insufficient Permissions], [N/A]'
    )
}
Assert-True $procSnap.measured 'compute-apps query success -> measured=true even with unreadable rows'
Assert-Equal 2 @($procSnap.processes).Count 'two process rows parsed'
$kitRow = @($procSnap.processes | Where-Object { $_.process_name -eq 'kit.exe' })[0]
Assert-Equal 2048 $kitRow.used_memory_mb 'numeric VRAM column parsed for kit.exe'
Assert-True $kitRow.used_memory_measured 'numeric VRAM column marked measured'
$unreadableRow = @($procSnap.processes | Where-Object { $_.process_name -eq '[Insufficient Permissions]' })[0]
Assert-True (-not $unreadableRow.used_memory_measured) 'insufficient-permission VRAM column marked unmeasured, not zero'
Assert-True ($null -eq $unreadableRow.used_memory_mb) 'insufficient-permission VRAM column left null, never fabricated as a number'

$procMissing = Get-GpuComputeProcessSnapshot -NvidiaSmiComputeAppsQuery { return $null }
Assert-True (-not $procMissing.measured) 'nvidia-smi compute-apps absent -> measured=false'
Assert-Equal 0 @($procMissing.processes).Count 'nvidia-smi compute-apps absent -> empty process list'
Write-TestPass 'Get-GpuComputeProcessSnapshot (measured + fail-safe paths)'

# ============================================================================
# 4. Get-KitVersionFingerprint
# ============================================================================
$sandbox = New-TestSandbox -Prefix 'measure-baseline'
try {
    $packmanDir = Join-Path $sandbox 'bim-streaming-server\tools\deps'
    New-Item -ItemType Directory -Path $packmanDir -Force | Out-Null
    Set-Content -LiteralPath (Join-Path $packmanDir 'kit-sdk.packman.xml') -Value @'
<project toolsVersion="5.0">
  <dependency name="kit_sdk_${config}" linkPath="../../_build/${platform_target}/${config}/kit" tags="${config} non-redist">
    <package name="kit-kernel" version="110.1.0+feature.${platform_target_abi}.${config}"/>
  </dependency>
</project>
'@ -Encoding utf8

    $kitVersion = Get-KitVersionFingerprint -RepoRoot $sandbox
    Assert-Equal '110.1.0' $kitVersion.value 'kit-kernel version extracted from packman xml, feature suffix stripped'
    Assert-True $kitVersion.measured 'kit version measured=true when packman xml present'

    $kitVersionMissing = Get-KitVersionFingerprint -RepoRoot (Join-Path $sandbox 'does-not-exist')
    Assert-True (-not $kitVersionMissing.measured) 'kit version measured=false when packman xml absent'
    Assert-True (-not [string]::IsNullOrWhiteSpace($kitVersionMissing.reason)) 'kit version absent -> reason present'
    Write-TestPass 'Get-KitVersionFingerprint'
} finally { Remove-TestSandbox -Path $sandbox }

# Real repo packman xml should resolve today (the file this harness depends on).
$realKitVersion = Get-KitVersionFingerprint -RepoRoot $repoRoot
if ($realKitVersion.measured) {
    Assert-True ($realKitVersion.value -match '^\d+\.\d+\.\d+$') 'real repo kit-kernel version looks like semver'
    Write-TestPass 'Get-KitVersionFingerprint against real repo tree'
} else {
    Write-TestPass 'Get-KitVersionFingerprint against real repo tree skipped (kit-sdk.packman.xml layout changed)'
}

# ============================================================================
# 5. Get-FixtureFingerprint
# ============================================================================
$noFixture = Get-FixtureFingerprint -FixturePath ''
Assert-True (-not $noFixture.hash_measured) 'no fixture path -> hash unmeasured'
Assert-True (-not $noFixture.size_measured) 'no fixture path -> size unmeasured'
Assert-True ($null -eq $noFixture.hash) 'no fixture path -> hash null, not fabricated'

$sandbox = New-TestSandbox -Prefix 'measure-baseline-fixture'
try {
    $fixtureFile = Join-Path $sandbox 'fixture.ifc'
    Set-Content -LiteralPath $fixtureFile -Value 'fixture content for hashing' -Encoding utf8 -NoNewline
    $expectedHash = (Get-FileHash -LiteralPath $fixtureFile -Algorithm SHA256).Hash.ToLowerInvariant()
    $expectedSize = (Get-Item -LiteralPath $fixtureFile).Length

    $fixtureResult = Get-FixtureFingerprint -FixturePath $fixtureFile
    Assert-True $fixtureResult.hash_measured 'existing fixture -> hash measured=true'
    Assert-Equal $expectedHash $fixtureResult.hash 'fixture hash matches independent Get-FileHash computation'
    Assert-True $fixtureResult.size_measured 'existing fixture -> size measured=true'
    Assert-Equal $expectedSize $fixtureResult.size_bytes 'fixture size matches independent Get-Item length'

    $missingFixture = Get-FixtureFingerprint -FixturePath (Join-Path $sandbox 'nope.ifc')
    Assert-True (-not $missingFixture.hash_measured) 'nonexistent fixture path -> hash unmeasured'
    Assert-True (-not [string]::IsNullOrWhiteSpace($missingFixture.hash_reason)) 'nonexistent fixture path -> reason present'
    Write-TestPass 'Get-FixtureFingerprint'
} finally { Remove-TestSandbox -Path $sandbox }

# ============================================================================
# 6. Get-WebRtcHealthProbe (injected invoker; no live network calls)
# ============================================================================
$probeOk = Get-WebRtcHealthProbe -CoordinatorUrl 'http://127.0.0.1:8004' -HealthInvoker {
    param($Uri, $Timeout)
    if ($Uri -match '/health$') {
        return [ordered]@{ ok = $true; body = [pscustomobject]@{ status = 'ok'; kit_signaling_port = 49100 }; status_code = 200; error = $null }
    }
    # Shaped after the real buildRuntimeStatus() projection
    # (bim-review-coordinator/src/runtimeStatus.ts): sessions.items[] each carry
    # viewer_leases[] (role primary|spectator, status active|released|expired),
    # and kit_instance_bindings[] is a flat list whose status comes from
    # KitInstanceBindingStatus = allocated|starting|ready|draining|released|failed.
    # Note there is no 'active' binding status in that enum.
    return [ordered]@{
        ok = $true
        body = [pscustomobject]@{
            sessions = [pscustomobject]@{
                count = 2
                active_count = 2
                participant_count = 4
                items = @(
                    [pscustomobject]@{
                        session_id = 'rs_alpha'
                        status = 'active'
                        viewer_leases = @(
                            [pscustomobject]@{ lease_id = 'vl_1'; role = 'primary'; status = 'active' },
                            [pscustomobject]@{ lease_id = 'vl_2'; role = 'spectator'; status = 'active' },
                            [pscustomobject]@{ lease_id = 'vl_3'; role = 'spectator'; status = 'active' },
                            [pscustomobject]@{ lease_id = 'vl_4'; role = 'spectator'; status = 'released' }
                        )
                    },
                    [pscustomobject]@{
                        session_id = 'rs_beta'
                        status = 'active'
                        viewer_leases = @(
                            [pscustomobject]@{ lease_id = 'vl_5'; role = 'primary'; status = 'active' },
                            [pscustomobject]@{ lease_id = 'vl_6'; role = 'spectator'; status = 'expired' }
                        )
                    }
                )
            }
            kit_instance_bindings = @(
                [pscustomobject]@{ session_id = 'rs_alpha'; kit_instance_id = 'kit-1'; status = 'ready' },
                [pscustomobject]@{ session_id = 'rs_alpha'; kit_instance_id = 'kit-2'; status = 'starting' },
                [pscustomobject]@{ session_id = 'rs_beta'; kit_instance_id = 'kit-3'; status = 'allocated' },
                [pscustomobject]@{ session_id = 'rs_beta'; kit_instance_id = 'kit-4'; status = 'draining' },
                [pscustomobject]@{ session_id = 'rs_gamma'; kit_instance_id = 'kit-5'; status = 'released' },
                [pscustomobject]@{ session_id = 'rs_gamma'; kit_instance_id = 'kit-6'; status = 'failed' }
            )
        }
        status_code = 200
        error = $null
    }
}
Assert-True $probeOk.measured 'webrtc probe attempted -> measured=true'
Assert-True $probeOk.reachable 'webrtc probe reachable=true when injected invoker reports ok'
Assert-Equal 'ok' $probeOk.service_status 'webrtc probe surfaces coordinator /health status'
Assert-Equal 49100 $probeOk.kit_signaling_port 'webrtc probe surfaces kit_signaling_port'
Assert-Equal 2 $probeOk.active_session_count 'webrtc probe surfaces active_count from /api/runtime/status'
Assert-Equal 3 $probeOk.active_kit_instance_binding_count 'webrtc probe counts non-terminal (allocated/starting/ready) kit_instance_bindings'
Assert-Equal 2 $probeOk.observed_primary_lease_count 'webrtc probe counts active primary viewer leases across sessions'
Assert-Equal 2 $probeOk.observed_spectator_lease_count 'webrtc probe counts active spectator viewer leases, excluding released/expired'
Assert-Equal $false $probeOk.webrtc_signaling_probed 'probe admits it never contacted a WebRTC signaling endpoint'
Assert-Equal 'coordinator_only' $probeOk.probe_scope 'probe declares its scope as coordinator_only'
Assert-True ($probeOk.note -match 'coordinator HTTP reachability only') 'probe note states reachable covers coordinator reachability only'
Assert-True ($probeOk.note -match 'echoes back from its own configuration') 'probe note explains kit_signaling_port is echoed config, not a contacted port'

# Regression guard for the enum bug: 'active' is NOT a KitInstanceBindingStatus,
# so a body full of fabricated 'active' bindings must count zero, not three.
$probeFabricatedStatus = Get-WebRtcHealthProbe -CoordinatorUrl 'http://127.0.0.1:8004' -HealthInvoker {
    param($Uri, $Timeout)
    if ($Uri -match '/health$') {
        return [ordered]@{ ok = $true; body = [pscustomobject]@{ status = 'ok' }; status_code = 200; error = $null }
    }
    return [ordered]@{
        ok = $true
        body = [pscustomobject]@{
            sessions = [pscustomobject]@{ active_count = 1 }
            kit_instance_bindings = @([pscustomobject]@{ status = 'active' }, [pscustomobject]@{ status = 'active' })
        }
        status_code = 200
        error = $null
    }
}
Assert-Equal 0 $probeFabricatedStatus.active_kit_instance_binding_count "'active' is not a KitInstanceBindingStatus; such rows count zero, never as capacity"

# An observed-empty bindings array is a measured zero, not a missing measurement.
$probeEmptyBindings = Get-WebRtcHealthProbe -CoordinatorUrl 'http://127.0.0.1:8004' -HealthInvoker {
    param($Uri, $Timeout)
    if ($Uri -match '/health$') {
        return [ordered]@{ ok = $true; body = [pscustomobject]@{ status = 'ok' }; status_code = 200; error = $null }
    }
    return [ordered]@{
        ok = $true
        body = [pscustomobject]@{
            sessions = [pscustomobject]@{ active_count = 0; items = @() }
            kit_instance_bindings = @()
        }
        status_code = 200
        error = $null
    }
}
Assert-Equal 0 $probeEmptyBindings.active_kit_instance_binding_count 'empty kit_instance_bindings array records an observed 0, not null'
Assert-True ($null -ne $probeEmptyBindings.active_kit_instance_binding_count) 'observed zero bindings is not conflated with "no data"'
Assert-Equal 0 $probeEmptyBindings.observed_primary_lease_count 'empty sessions.items records zero primary leases, not null'
Assert-Equal 0 $probeEmptyBindings.observed_spectator_lease_count 'empty sessions.items records zero spectator leases, not null'

# A runtime body with no sessions.items at all leaves the lease counts null:
# absence of the projection is not evidence of zero leases.
$probeNoItems = Get-WebRtcHealthProbe -CoordinatorUrl 'http://127.0.0.1:8004' -HealthInvoker {
    param($Uri, $Timeout)
    if ($Uri -match '/health$') {
        return [ordered]@{ ok = $true; body = [pscustomobject]@{ status = 'ok' }; status_code = 200; error = $null }
    }
    return [ordered]@{ ok = $true; body = [pscustomobject]@{ sessions = [pscustomobject]@{ active_count = 1 } }; status_code = 200; error = $null }
}
Assert-True ($null -eq $probeNoItems.observed_primary_lease_count) 'missing sessions.items -> primary lease count null, not fabricated 0'
Assert-True ($null -eq $probeNoItems.observed_spectator_lease_count) 'missing sessions.items -> spectator lease count null, not fabricated 0'

$probeDown = Get-WebRtcHealthProbe -CoordinatorUrl 'http://127.0.0.1:8004' -HealthInvoker {
    param($Uri, $Timeout)
    return [ordered]@{ ok = $false; body = $null; status_code = $null; error = 'connection refused' }
}
Assert-True $probeDown.measured 'webrtc probe attempted even when coordinator is down -> measured=true (we tried)'
Assert-True (-not $probeDown.reachable) 'webrtc probe reachable=false when coordinator unreachable'
Assert-True ($null -eq $probeDown.active_session_count) 'webrtc probe leaves active_session_count null when unreachable, not zero'
Assert-Equal 'connection refused' $probeDown.error 'webrtc probe surfaces the underlying error'
Assert-True ($null -eq $probeDown.observed_primary_lease_count) 'unreachable coordinator -> primary lease count null, not zero'
Assert-True ($null -eq $probeDown.observed_spectator_lease_count) 'unreachable coordinator -> spectator lease count null, not zero'
Write-TestPass 'Get-WebRtcHealthProbe (reachable + unreachable, injected invoker, real binding enum, per-role leases)'

# ============================================================================
# 7. Get-SessionVramWatermark
# ============================================================================
$vramNoQuery = Get-SessionVramWatermark -GpuComputeSnapshot (Get-GpuComputeProcessSnapshot -NvidiaSmiComputeAppsQuery { return $null })
Assert-True (-not $vramNoQuery.measured) 'vram watermark propagates unmeasured compute snapshot'

$vramNoKit = Get-SessionVramWatermark -GpuComputeSnapshot (Get-GpuComputeProcessSnapshot -NvidiaSmiComputeAppsQuery { @('4128, explorer.exe, 64') })
Assert-True (-not $vramNoKit.measured) 'vram watermark unmeasured when no Kit process observed'
Assert-True ($vramNoKit.reason -match 'no active Kit') 'vram watermark reason names the missing Kit process'

$vramUnreadable = Get-SessionVramWatermark -GpuComputeSnapshot (Get-GpuComputeProcessSnapshot -NvidiaSmiComputeAppsQuery { @('40232, kit.exe, [Insufficient Permissions]') })
Assert-True (-not $vramUnreadable.measured) 'vram watermark unmeasured when Kit VRAM column unreadable'
Assert-Equal 1 @($vramUnreadable.kit_processes).Count 'vram watermark still lists the observed Kit process'

$vramMeasured = Get-SessionVramWatermark -GpuComputeSnapshot (Get-GpuComputeProcessSnapshot -NvidiaSmiComputeAppsQuery { @('40232, kit.exe, 2000') }) -ObservedActiveSessionCount 6 -ObservedPrimaryLeaseCount 2 -ObservedSpectatorLeaseCount 7
Assert-True $vramMeasured.measured 'vram watermark measured=true with numeric Kit VRAM'
Assert-Equal 2000 $vramMeasured.total_kit_vram_mb 'vram watermark sums numeric Kit process VRAM'
Assert-Equal 6 $vramMeasured.observed_active_session_count 'vram watermark carries through observed active session count'
Assert-Equal 2 $vramMeasured.observed_primary_lease_count 'vram watermark carries through observed primary lease count'
Assert-Equal 7 $vramMeasured.observed_spectator_lease_count 'vram watermark carries through observed spectator lease count (the k in 1 primary + k spectator)'
Assert-Equal 0 $vramMeasured.kit_process_vram_unreadable_count 'fully readable Kit VRAM -> zero unreadable processes'

# Partial visibility must be refused, not silently under-counted: summing only
# the readable subset would publish a watermark lower than the real one.
$vramPartial = Get-SessionVramWatermark -GpuComputeSnapshot (Get-GpuComputeProcessSnapshot -NvidiaSmiComputeAppsQuery {
    @('40232, kit.exe, 2000', '40988, kit.exe, [Insufficient Permissions]')
})
Assert-True (-not $vramPartial.measured) 'partial Kit VRAM visibility -> measured=false'
Assert-True ($null -eq $vramPartial.total_kit_vram_mb) 'partial Kit VRAM visibility -> total null, never the readable-subset sum'
Assert-True ($vramPartial.reason -match 'partial VRAM visibility: 1 of 2 matching Kit processes have no readable used_memory') 'partial VRAM reason counts readable vs matching processes'
Assert-True ($vramPartial.reason -match 'refusing to report an under-counted total') 'partial VRAM reason states the refusal explicitly'
Assert-Equal 2 $vramPartial.kit_process_count 'partial VRAM case reports both matching Kit processes'
Assert-Equal 1 $vramPartial.kit_process_vram_unreadable_count 'partial VRAM case counts the unreadable process'

# Attribution honesty: name-matched only, co-resident Kit processes included.
foreach ($watermark in @($vramMeasured, $vramPartial, $vramNoKit, $vramUnreadable, $vramNoQuery)) {
    Assert-Equal 'process_name_match_only' $watermark.attribution 'vram watermark declares process-name-only attribution on every path'
    Assert-True ($watermark.attribution_note -match 'IFC conversion') 'attribution note names co-resident Kit processes as included'
    Assert-True ($watermark.attribution_note -match 'deferred to task 1.2/1.3') 'attribution note states full PID-to-binding attribution is deferred'
}
Write-TestPass 'Get-SessionVramWatermark (partial-visibility refusal + attribution honesty)'

# ============================================================================
# 8. Get-EnvironmentFingerprint + New-OptionalMeasurement
# ============================================================================
$fullInv = Get-GpuInventorySnapshot -NvidiaSmiQuery { @('0, NVIDIA GeForce RTX 4060 Ti, 580.97, 8188, 1827, 6123, 2, 0, [N/A]') }
$fullKit = [ordered]@{ value = '110.1.0'; measured = $true; reason = $null }
$fullFixture = [ordered]@{ hash = 'deadbeef'; hash_measured = $true; hash_reason = $null; size_bytes = 12345; size_measured = $true; size_reason = $null }
$fullFingerprint = Get-EnvironmentFingerprint -GpuInventory $fullInv -KitVersion $fullKit -FixtureFingerprint $fullFixture
Assert-True $fullFingerprint.complete 'environment fingerprint complete=true when all five fields measured'

Assert-Equal 1 $fullFingerprint.gpu_count 'single-GPU inventory reports gpu_count=1'
Assert-Equal 'single_gpu' $fullFingerprint.gpu_fingerprint_scope 'single-GPU host is fingerprinted under a declared single_gpu scope'

# A multi-GPU host must say the fingerprint covers only the first GPU row.
$multiFingerprint = Get-EnvironmentFingerprint -GpuInventory $invMixed -KitVersion $fullKit -FixtureFingerprint $fullFixture
Assert-Equal 2 $multiFingerprint.gpu_count 'multi-GPU inventory reports gpu_count=2'
Assert-Equal 'first_gpu_only' $multiFingerprint.gpu_fingerprint_scope 'multi-GPU host declares first_gpu_only fingerprint scope, not a silent single-GPU claim'
Assert-Equal 'NVIDIA GeForce RTX 4060 Ti' $multiFingerprint.gpu_model.value 'multi-GPU fingerprint still pins the first row (scope field is what makes that honest)'

$partialFingerprint = Get-EnvironmentFingerprint -GpuInventory $invMissing -KitVersion $fullKit -FixtureFingerprint $fullFixture
Assert-True (-not $partialFingerprint.complete) 'environment fingerprint complete=false when GPU unmeasured'
Assert-True (-not $partialFingerprint.gpu_model.measured) 'partial fingerprint: gpu_model unmeasured'
Assert-True (-not [string]::IsNullOrWhiteSpace($partialFingerprint.gpu_model.reason)) 'partial fingerprint: gpu_model carries reason'
Assert-True ($null -eq $partialFingerprint.gpu_count) 'no GPU inventory -> gpu_count null, not fabricated 0'
Assert-Equal 'unknown_no_gpu_inventory' $partialFingerprint.gpu_fingerprint_scope 'no GPU inventory -> scope reported as unknown, not single_gpu'
Write-TestPass 'Get-EnvironmentFingerprint completeness gate'

$measurementPresent = New-OptionalMeasurement -Value 42.5 -MissingReason 'unused'
Assert-Equal 42.5 $measurementPresent.value 'New-OptionalMeasurement passes through a supplied value'
Assert-True $measurementPresent.measured 'New-OptionalMeasurement measured=true when value supplied'
$measurementAbsent = New-OptionalMeasurement -Value $null -MissingReason 'no live session'
Assert-True (-not $measurementAbsent.measured) 'New-OptionalMeasurement measured=false when value is null'
Assert-Equal 'no live session' $measurementAbsent.reason 'New-OptionalMeasurement surfaces the missing reason'

$measurementRejected = New-OptionalMeasurement -Value -3 -MissingReason 'unused' -Source 'caller_supplied' `
    -Validator { param($v) ([double]$v -ge 0) } -InvalidReasonFormat 'rejected {0}: must be >= 0'
Assert-True (-not $measurementRejected.measured) 'New-OptionalMeasurement rejects a value failing the validator'
Assert-True ($null -eq $measurementRejected.value) 'rejected value is dropped, not carried into the report'
Assert-Equal 'rejected -3: must be >= 0' $measurementRejected.reason 'rejection reason interpolates the offending value'
Assert-Equal 'caller_supplied' $measurementRejected.source 'rejected caller-supplied metric still records its provenance'
Write-TestPass 'New-OptionalMeasurement (validation + provenance)'

# ============================================================================
# 9. Get-SessionBaselineReport end-to-end (fully injected, offline)
# ============================================================================
$fixedNow = [datetime]::new(2026, 8, 12, 3, 4, 5, [System.DateTimeKind]::Utc)
$offlineReport = Get-SessionBaselineReport `
    -CoordinatorUrl 'http://127.0.0.1:8004' `
    -RepoRoot $repoRoot `
    -Now $fixedNow `
    -NvidiaSmiQuery { @('0, NVIDIA GeForce RTX 4060 Ti, 580.97, 8188, 1827, 6123, 2, 0, [N/A]') } `
    -NvidiaSmiComputeAppsQuery { @('40232, kit.exe, 2000') } `
    -WebRtcHealthInvoker {
        param($Uri, $Timeout)
        if ($Uri -match '/health$') {
            return [ordered]@{ ok = $true; body = [pscustomobject]@{ status = 'ok'; kit_signaling_port = 49100 }; status_code = 200; error = $null }
        }
        return [ordered]@{ ok = $true; body = [pscustomobject]@{ sessions = [pscustomobject]@{ active_count = 1 } }; status_code = 200; error = $null }
    }
Assert-ReportSchemaShape -Report $offlineReport -Message 'offline end-to-end report (no fixture, no TTFF)'
Assert-Equal '2026-08-12T03:04:05.000Z' $offlineReport.captured_at 'captured_at honors injected -Now'
Assert-True (-not $offlineReport.environment_fingerprint.complete) 'offline report incomplete without -FixturePath'
Assert-True $offlineReport.gpu_inventory.software_queue_required 'offline report: consumer GPU without MIG locks to software queue path'
Assert-True (-not $offlineReport.ttff_ms.measured) 'offline report: TTFF honestly unmeasured'
Assert-True (-not $offlineReport.session_creation_success_rate.measured) 'offline report: success rate honestly unmeasured'
# Hostname must come from the cross-platform API, not the Windows-only env var.
Assert-Equal ([System.Net.Dns]::GetHostName()) $offlineReport.host.hostname 'report hostname resolves via [System.Net.Dns]::GetHostName()'
Assert-True (-not [string]::IsNullOrWhiteSpace($offlineReport.host.hostname)) 'report hostname is non-empty'

# ConvertTo-Json round trip must not throw and must preserve the schema_version.
$json = $offlineReport | ConvertTo-Json -Depth 12
$roundTrip = $json | ConvertFrom-Json
Assert-Equal 'gpu-session-baseline-report/v1' $roundTrip.schema_version 'report survives ConvertTo-Json/ConvertFrom-Json round trip'
Write-TestPass 'Get-SessionBaselineReport offline end-to-end (schema + honesty)'

$sandbox = New-TestSandbox -Prefix 'measure-baseline-fixture-e2e'
try {
    $fixtureFile = Join-Path $sandbox 'fixture.ifc'
    Set-Content -LiteralPath $fixtureFile -Value 'fixture content' -Encoding utf8 -NoNewline
    $completeReport = Get-SessionBaselineReport `
        -CoordinatorUrl 'http://127.0.0.1:8004' `
        -RepoRoot $repoRoot `
        -Now $fixedNow `
        -FixturePath $fixtureFile `
        -TtffMs 812.5 `
        -SessionCreationSuccessRate 0.97 `
        -NvidiaSmiQuery { @('0, NVIDIA GeForce RTX 4060 Ti, 580.97, 8188, 1827, 6123, 2, 0, [N/A]') } `
        -NvidiaSmiComputeAppsQuery { @('40232, kit.exe, 2000') } `
        -WebRtcHealthInvoker {
            param($Uri, $Timeout)
            return [ordered]@{ ok = $true; body = [pscustomobject]@{ status = 'ok'; kit_signaling_port = 49100; sessions = [pscustomobject]@{ active_count = 1 } }; status_code = 200; error = $null }
        }
    Assert-ReportSchemaShape -Report $completeReport -Message 'complete report (fixture + TTFF + success rate supplied)'
    Assert-True $completeReport.environment_fingerprint.complete 'complete report: environment_fingerprint.complete=true'
    Assert-True $completeReport.ttff_ms.measured 'complete report: TTFF measured when supplied'
    Assert-Equal 812.5 $completeReport.ttff_ms.value 'complete report: TTFF value passed through'
    Assert-True $completeReport.session_creation_success_rate.measured 'complete report: success rate measured when supplied'
    Write-TestPass 'Get-SessionBaselineReport complete end-to-end (fixture + TTFF + success rate)'
} finally { Remove-TestSandbox -Path $sandbox }

# Caller-supplied TTFF / success rate are validated, not trusted blindly.
$badInputReport = Get-SessionBaselineReport `
    -CoordinatorUrl 'http://127.0.0.1:8004' `
    -RepoRoot $repoRoot `
    -Now $fixedNow `
    -SkipWebRtcProbe `
    -TtffMs -12.5 `
    -SessionCreationSuccessRate 1.4 `
    -NvidiaSmiQuery { @('0, NVIDIA GeForce RTX 4060 Ti, 580.97, 8188, 1827, 6123, 2, 0, [N/A]') } `
    -NvidiaSmiComputeAppsQuery { return $null }
Assert-ReportSchemaShape -Report $badInputReport -Message 'report with out-of-range caller inputs'
Assert-True (-not $badInputReport.ttff_ms.measured) 'negative caller-supplied TTFF is rejected, not accepted as measured'
Assert-True ($null -eq $badInputReport.ttff_ms.value) 'rejected TTFF leaves value null'
Assert-True ($badInputReport.ttff_ms.reason -match 'cannot be negative') 'rejected TTFF reason names the violated constraint'
Assert-True (-not $badInputReport.session_creation_success_rate.measured) 'success rate above 1 is rejected'
Assert-True ($badInputReport.session_creation_success_rate.reason -match '\[0,1\]') 'rejected success rate reason names the allowed range'

$negativeRateReport = Get-SessionBaselineReport `
    -CoordinatorUrl 'http://127.0.0.1:8004' `
    -RepoRoot $repoRoot `
    -Now $fixedNow `
    -SkipWebRtcProbe `
    -SessionCreationSuccessRate -0.01 `
    -NvidiaSmiQuery { return $null } `
    -NvidiaSmiComputeAppsQuery { return $null }
Assert-True (-not $negativeRateReport.session_creation_success_rate.measured) 'success rate below 0 is rejected'

# Boundary values are legitimate measurements and must survive validation.
$boundaryReport = Get-SessionBaselineReport `
    -CoordinatorUrl 'http://127.0.0.1:8004' `
    -RepoRoot $repoRoot `
    -Now $fixedNow `
    -SkipWebRtcProbe `
    -TtffMs 0 `
    -SessionCreationSuccessRate 1 `
    -NvidiaSmiQuery { return $null } `
    -NvidiaSmiComputeAppsQuery { return $null }
Assert-True $boundaryReport.ttff_ms.measured 'TTFF of exactly 0 ms is accepted (boundary, not rejected)'
Assert-True $boundaryReport.session_creation_success_rate.measured 'success rate of exactly 1 is accepted (boundary, not rejected)'
Write-TestPass 'Get-SessionBaselineReport validates caller-supplied TTFF / success rate'

# -SkipWebRtcProbe path
$skippedProbeReport = Get-SessionBaselineReport `
    -CoordinatorUrl 'http://127.0.0.1:8004' `
    -RepoRoot $repoRoot `
    -Now $fixedNow `
    -SkipWebRtcProbe `
    -NvidiaSmiQuery { @('0, NVIDIA GeForce RTX 4060 Ti, 580.97, 8188, 1827, 6123, 2, 0, [N/A]') } `
    -NvidiaSmiComputeAppsQuery { return $null }
Assert-True (-not $skippedProbeReport.webrtc_health_probe.measured) '-SkipWebRtcProbe -> webrtc_health_probe measured=false'
Assert-True (-not $skippedProbeReport.webrtc_health_probe.reachable) '-SkipWebRtcProbe -> reachable=false, not fabricated true'
Write-TestPass 'Get-SessionBaselineReport honors -SkipWebRtcProbe'

# ============================================================================
# 10. Fail-safe end-to-end: nvidia-smi entirely absent (explicit test requirement)
# ============================================================================
$noGpuHostReport = Get-SessionBaselineReport `
    -CoordinatorUrl 'http://127.0.0.1:8004' `
    -RepoRoot $repoRoot `
    -Now $fixedNow `
    -SkipWebRtcProbe `
    -NvidiaSmiQuery { return $null } `
    -NvidiaSmiComputeAppsQuery { return $null }
Assert-ReportSchemaShape -Report $noGpuHostReport -Message 'nvidia-smi-absent report still schema-valid'
Assert-True (-not $noGpuHostReport.gpu_inventory.measured) 'nvidia-smi absent -> gpu_inventory.measured=false'
Assert-Equal 0 @($noGpuHostReport.gpu_inventory.gpus).Count 'nvidia-smi absent -> zero GPUs reported, never fabricated'
Assert-True (-not $noGpuHostReport.environment_fingerprint.gpu_model.measured) 'nvidia-smi absent -> gpu_model unmeasured'
Assert-True (-not $noGpuHostReport.environment_fingerprint.gpu_driver_version.measured) 'nvidia-smi absent -> gpu_driver_version unmeasured'
Assert-True (-not $noGpuHostReport.environment_fingerprint.complete) 'nvidia-smi absent -> environment_fingerprint.complete=false'
Assert-True (-not $noGpuHostReport.session_vram_watermark.measured) 'nvidia-smi absent -> session_vram_watermark.measured=false'
# The harness must not throw even with every GPU signal missing.
Write-TestPass 'end-to-end fail-safe when nvidia-smi is entirely absent'

# ============================================================================
# 11. Real host smoke check (this machine has an RTX 4060 Ti; skip gracefully
#     elsewhere so CI without a GPU still passes).
# ============================================================================
$realInventory = Get-GpuInventorySnapshot
if ($realInventory.measured) {
    Assert-True (@($realInventory.gpus).Count -ge 1) 'real nvidia-smi reports at least one GPU on this host'
    Write-TestPass 'Get-GpuInventorySnapshot against real local nvidia-smi'
} else {
    Write-TestPass 'Get-GpuInventorySnapshot real-host check skipped (no nvidia-smi on this runner)'
}

# ============================================================================
# 12. Registry consistency
# ============================================================================
$registryPath = Join-Path $repoRoot 'scripts\script-registry.json'
Assert-True (Test-Path -LiteralPath $registryPath -PathType Leaf) 'script-registry.json exists'
$registry = Get-Content -LiteralPath $registryPath -Raw | ConvertFrom-Json
Assert-Equal 'script-registry/v1' $registry.schema_version 'script-registry.json schema_version unchanged'
$entries = @($registry.scripts | Where-Object { $_.path -eq 'scripts/measure-session-baseline.ps1' })
Assert-Equal 1 $entries.Count 'exactly one script-registry.json entry for scripts/measure-session-baseline.ps1'
$entry = $entries[0]
Assert-True (-not [string]::IsNullOrWhiteSpace($entry.role)) 'registry entry has a non-empty role'
Assert-Equal 'scripts' $entry.owner 'registry entry owner is scripts'
Assert-True (-not [string]::IsNullOrWhiteSpace($entry.notes)) 'registry entry has explanatory notes'
Assert-True (Test-Path -LiteralPath (Join-Path $repoRoot $entry.path) -PathType Leaf) 'registry entry path resolves to a real file'
# Every path in the registry must actually exist -- a stale entry is a silent lie.
foreach ($registered in @($registry.scripts)) {
    Assert-True (Test-Path -LiteralPath (Join-Path $repoRoot $registered.path)) "registry entry '$($registered.path)' resolves to an existing file"
}
Write-TestPass 'script-registry.json consistency'

# ============================================================================
# 13. Root CLI wrapper smoke test (real invocation, network probe skipped)
# ============================================================================
Assert-True (Test-Path -LiteralPath $rootScriptPath -PathType Leaf) 'root wrapper scripts/measure-session-baseline.ps1 exists'
$sandbox = New-TestSandbox -Prefix 'measure-baseline-cli'
try {
    $cliOutputPath = Join-Path $sandbox 'report.json'
    & $rootScriptPath -OutputPath $cliOutputPath -SkipWebRtcProbe -ProbeTimeoutSec 1 | Out-Null
    Assert-True (Test-Path -LiteralPath $cliOutputPath -PathType Leaf) 'root wrapper writes a report to -OutputPath'
    $cliReport = Get-Content -LiteralPath $cliOutputPath -Raw | ConvertFrom-Json
    Assert-Equal 'gpu-session-baseline-report/v1' $cliReport.schema_version 'root wrapper report has pinned schema_version'
    Assert-True ($null -ne $cliReport.PSObject.Properties['environment_fingerprint']) 'root wrapper report has environment_fingerprint'
    Write-TestPass 'root wrapper CLI smoke test (-OutputPath, -SkipWebRtcProbe)'
} finally { Remove-TestSandbox -Path $sandbox }

# Default -OutputPath falls under artifacts/gpu-baseline/<run_id>.json under RepoRoot.
# run_id (not a bare second-resolution timestamp) prevents two runs inside the
# same second from silently overwriting each other's report.
$gpuBaselineDir = Join-Path $repoRoot 'artifacts\gpu-baseline'
$dirExistedBefore = Test-Path -LiteralPath $gpuBaselineDir
$before = @()
if ($dirExistedBefore) { $before = @(Get-ChildItem -LiteralPath $gpuBaselineDir -Filter '*.json' -File | Select-Object -ExpandProperty Name) }
try {
    $defaultReport = & $rootScriptPath -SkipWebRtcProbe -ProbeTimeoutSec 1
    Assert-True (Test-Path -LiteralPath $gpuBaselineDir -PathType Container) 'default OutputPath creates artifacts/gpu-baseline/'
    $after = @(Get-ChildItem -LiteralPath $gpuBaselineDir -Filter '*.json' -File | Select-Object -ExpandProperty Name)
    $newFiles = @($after | Where-Object { $before -notcontains $_ })
    Assert-True ($newFiles.Count -ge 1) 'default OutputPath produced a new report file'
    Assert-True ($defaultReport.run_id -match '^measure_\d{8}_\d{6}_[0-9a-f]{6}$') 'default run produced a run_id'
    Assert-True ($newFiles -contains "$($defaultReport.run_id).json") 'default OutputPath names the report after its run_id, not a collision-prone timestamp'
    foreach ($newFile in $newFiles) {
        Remove-Item -LiteralPath (Join-Path $gpuBaselineDir $newFile) -Force -ErrorAction SilentlyContinue
    }
    Write-TestPass 'root wrapper default -OutputPath under artifacts/gpu-baseline/<run_id>.json'
} finally {
    if (-not $dirExistedBefore) {
        $remaining = @(Get-ChildItem -LiteralPath $gpuBaselineDir -File -ErrorAction SilentlyContinue)
        if ($remaining.Count -eq 0) {
            Remove-Item -LiteralPath $gpuBaselineDir -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
}

Write-Host "`n=== test-measure-session-baseline.ps1: ALL PASSED ===" -ForegroundColor Green
