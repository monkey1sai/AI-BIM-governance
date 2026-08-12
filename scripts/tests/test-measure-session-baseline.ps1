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

$REQUIRED_ENV_FINGERPRINT_FIELDS = @('gpu_model', 'gpu_driver_version', 'kit_version', 'fixture_hash', 'fixture_size_bytes', 'fixture_provenance')
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
    Assert-Equal 'checkout_packman_declared' $ef.kit_version.source "$Message :: kit_version declares checkout provenance"
    Assert-True (-not $ef.kit_version.runtime_verified) "$Message :: kit_version is never claimed as runtime-verified"
    Assert-True ($ef.Contains('fixture_binding_scope')) "$Message :: environment_fingerprint declares its fixture-to-session binding scope"
    Assert-True (-not $ef.fixture_provenance.runtime_verified) "$Message :: fixture identity is never claimed as runtime-verified"
    Assert-True ($ef.fixture_provenance.caveat -match 'task 1.2/1.3') "$Message :: fixture provenance caveat defers runtime artifact-identity verification to task 1.2/1.3"
    $expectComplete = (-not [bool]($REQUIRED_ENV_FINGERPRINT_FIELDS | Where-Object { -not $ef[$_].measured })) -and ($ef.gpu_fingerprint_scope -ne 'first_gpu_only') -and ($ef.fixture_binding_scope -ne 'live_session_unverified') -and ($ef.fixture_binding_scope -ne 'runtime_state_unknown')
    Assert-Equal $expectComplete $ef.complete "$Message :: environment_fingerprint.complete matches per-field measured flags AND full GPU-topology attribution AND a verifiable fixture binding AND a KNOWN runtime state"

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
    Assert-True ($Report.session_vram_watermark.Contains('session_scope')) "$Message :: session_vram_watermark declares the session scope its lease counts were aggregated over"
    Assert-True ($Report.session_vram_watermark.Contains('watermark_interpretation')) "$Message :: session_vram_watermark carries an explicit verdict on the 1 primary + k spectator interpretation"
    Assert-True ($Report.session_vram_watermark.watermark_interpretation.Contains('measured')) "$Message :: watermark_interpretation has 'measured'"
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

# Non-consumer AND no MIG (e.g. a lone RTX A6000, which is excluded from
# is_consumer_rtx but does not support MIG at all): no hardware-partition
# route is available here either, so software queuing must still be
# required. Gating this on consumer_grade_all as well previously reported
# software_queue_required=false on exactly this fleet shape (PR #511 review,
# round 2).
$invProfessionalNoMig = Get-GpuInventorySnapshot -NvidiaSmiQuery { @('0, NVIDIA RTX A6000, 550.54, 49140, 0, 49140, 0, 0, [N/A]') }
Assert-True (-not $invProfessionalNoMig.consumer_grade_all) 'lone RTX A6000: consumer_grade_all=false'
Assert-True (-not $invProfessionalNoMig.mig_available_any) 'lone RTX A6000: mig_available_any=false'
Assert-True $invProfessionalNoMig.software_queue_required 'non-consumer fleet with no MIG anywhere still requires software queuing, not falsely implying a MIG route exists'

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
    Assert-Equal 'checkout_packman_declared' $kitVersion.source 'kit version records its source as the checkout-declared dependency, not a live Kit-process read'
    Assert-True (-not [string]::IsNullOrWhiteSpace($kitVersion.caveat)) 'kit version carries an explicit staleness caveat since it cannot verify the running build matches this checkout'

    $kitVersionMissing = Get-KitVersionFingerprint -RepoRoot (Join-Path $sandbox 'does-not-exist')
    Assert-True (-not $kitVersionMissing.measured) 'kit version measured=false when packman xml absent'
    Assert-True (-not [string]::IsNullOrWhiteSpace($kitVersionMissing.reason)) 'kit version absent -> reason present'
    Assert-True (-not [string]::IsNullOrWhiteSpace($kitVersionMissing.caveat)) 'kit version caveat present even when unmeasured'
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
Assert-True (-not $noFixture.path_supplied) 'no fixture path -> path_supplied=false (declaration absent, not merely unhashable)'
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
    Assert-True $fixtureResult.path_supplied 'existing fixture -> path_supplied=true'
    Assert-True $fixtureResult.hash_measured 'existing fixture -> hash measured=true'
    Assert-Equal $expectedHash $fixtureResult.hash 'fixture hash matches independent Get-FileHash computation'
    Assert-True $fixtureResult.size_measured 'existing fixture -> size measured=true'
    Assert-Equal $expectedSize $fixtureResult.size_bytes 'fixture size matches independent Get-Item length'

    $missingFixture = Get-FixtureFingerprint -FixturePath (Join-Path $sandbox 'nope.ifc')
    Assert-True $missingFixture.path_supplied 'nonexistent fixture path -> still a declaration (path_supplied=true), just an unhashable one'
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

# PR #511 review r5: the lease counts are summed over every sessions.items[]
# entry while total_kit_vram_mb is one host-wide sample, so a host serving 2+
# sessions cannot be read as "1 primary + k spectator". The aggregate counts
# survive (they are real observations); the INTERPRETATION is refused.
Assert-Equal 'multi_session_aggregate' $vramMeasured.session_scope '6 observed active sessions -> multi_session_aggregate scope, never a silent single-session reading'
Assert-True (-not $vramMeasured.watermark_interpretation.measured) 'multi-session snapshot: the 1 primary + k spectator interpretation is not measured'
Assert-Equal 'non-isolated multi-session snapshot; per-session VRAM attribution unavailable in this slice' $vramMeasured.watermark_interpretation.reason 'multi-session refusal names the non-isolated snapshot and the missing per-session attribution'
Assert-Equal 2000 $vramMeasured.total_kit_vram_mb 'multi-session scope does not discard the aggregate VRAM measurement'
Assert-True ($vramMeasured.session_scope_note -match 'only valid under session_scope=single_session') 'session scope note states when the 1 primary + k spectator reading holds'

$vramSingleSession = Get-SessionVramWatermark -GpuComputeSnapshot (Get-GpuComputeProcessSnapshot -NvidiaSmiComputeAppsQuery { @('40232, kit.exe, 2000') }) -ObservedActiveSessionCount 1 -ObservedPrimaryLeaseCount 1 -ObservedSpectatorLeaseCount 3
Assert-Equal 'single_session' $vramSingleSession.session_scope 'exactly one observed active session -> single_session scope'
Assert-True $vramSingleSession.watermark_interpretation.measured 'single session: the 1 primary + k spectator interpretation keeps its current semantics'
Assert-True ($null -eq $vramSingleSession.watermark_interpretation.reason) 'single session: no refusal reason is invented'
Assert-Equal 2000 $vramSingleSession.total_kit_vram_mb 'single session: the VRAM total is unchanged by the scope work'
Assert-Equal 3 $vramSingleSession.observed_spectator_lease_count 'single session: the k in 1 primary + k spectator is carried through'

$vramNoSession = Get-SessionVramWatermark -GpuComputeSnapshot (Get-GpuComputeProcessSnapshot -NvidiaSmiComputeAppsQuery { @('40232, kit.exe, 2000') }) -ObservedActiveSessionCount 0
Assert-Equal 'no_active_session_observed' $vramNoSession.session_scope 'an observed zero sessions is its own scope, distinct from an unobserved host'
Assert-True (-not $vramNoSession.watermark_interpretation.measured) 'no active session: there is no 1 primary + k spectator shape to interpret'

$vramUnknownScope = Get-SessionVramWatermark -GpuComputeSnapshot (Get-GpuComputeProcessSnapshot -NvidiaSmiComputeAppsQuery { @('40232, kit.exe, 2000') })
Assert-Equal 'unknown_no_runtime_observation' $vramUnknownScope.session_scope 'no runtime observation -> session scope reported unknown, never assumed single'
Assert-True (-not $vramUnknownScope.watermark_interpretation.measured) 'unknown runtime state: the interpretation is refused rather than assumed'
Assert-True ($vramUnknownScope.watermark_interpretation.reason -match 'GET /api/runtime/status') 'unknown-scope reason names the observation that is missing'

# PR #511 review r6: a non-null-but-unparseable active_count (coordinator
# version skew) must not be coerced into 0 and read as an observed idle host.
$vramMalformedScope = Get-SessionVramWatermark -GpuComputeSnapshot (Get-GpuComputeProcessSnapshot -NvidiaSmiComputeAppsQuery { @('40232, kit.exe, 2000') }) -ObservedActiveSessionCount 'unknown'
Assert-Equal 'malformed_runtime_observation' $vramMalformedScope.session_scope 'non-numeric active_count -> malformed scope, never coerced into 0'
Assert-True (-not $vramMalformedScope.watermark_interpretation.measured) 'malformed active_count: the interpretation is refused rather than assumed'
Assert-True ($vramMalformedScope.watermark_interpretation.reason -match 'not a valid non-negative integer') 'malformed-scope reason names the invalid observation'

# PR #511 review r6: a session existing is not the same as a primary viewer
# having joined it -- an idle-but-created or spectator-only session must not
# pass as a valid "1 primary + k spectator" watermark.
$vramSingleSessionNoPrimary = Get-SessionVramWatermark -GpuComputeSnapshot (Get-GpuComputeProcessSnapshot -NvidiaSmiComputeAppsQuery { @('40232, kit.exe, 2000') }) -ObservedActiveSessionCount 1 -ObservedPrimaryLeaseCount 0 -ObservedSpectatorLeaseCount 0
Assert-Equal 'single_session' $vramSingleSessionNoPrimary.session_scope 'one active session with zero primary leases is still single_session scope'
Assert-True (-not $vramSingleSessionNoPrimary.watermark_interpretation.measured) 'single session with zero observed primary leases: the interpretation is refused'
Assert-True ($vramSingleSessionNoPrimary.watermark_interpretation.reason -match 'primary') 'no-primary refusal reason names the missing primary lease'

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
foreach ($watermark in @($vramMeasured, $vramPartial, $vramNoKit, $vramUnreadable, $vramNoQuery, $vramSingleSession, $vramNoSession, $vramUnknownScope, $vramMalformedScope, $vramSingleSessionNoPrimary)) {
    Assert-Equal 'process_name_match_only' $watermark.attribution 'vram watermark declares process-name-only attribution on every path'
    Assert-True ($watermark.Contains('session_scope')) 'vram watermark declares its session scope on every path'
    Assert-True ($watermark.Contains('watermark_interpretation')) 'vram watermark carries its 1 primary + k spectator verdict on every path'
    Assert-True ($watermark.attribution_note -match 'IFC conversion') 'attribution note names co-resident Kit processes as included'
    Assert-True ($watermark.attribution_note -match 'deferred to task 1.2/1.3') 'attribution note states full PID-to-binding attribution is deferred'
}
Write-TestPass 'Get-SessionVramWatermark (partial-visibility refusal + attribution honesty + session scope)'

# ============================================================================
# 8. Get-EnvironmentFingerprint + New-OptionalMeasurement
# ============================================================================
$fullInv = Get-GpuInventorySnapshot -NvidiaSmiQuery { @('0, NVIDIA GeForce RTX 4060 Ti, 580.97, 8188, 1827, 6123, 2, 0, [N/A]') }
$fullKit = [ordered]@{ value = '110.1.0'; measured = $true; reason = $null; source = 'checkout_packman_declared'; caveat = 'test caveat' }
$fullFixture = [ordered]@{ path_supplied = $true; hash = 'deadbeef'; hash_measured = $true; hash_reason = $null; size_bytes = 12345; size_measured = $true; size_reason = $null }
# 0 active sessions and 0 kit bindings is an OBSERVED idle host (the coordinator
# answered and reported nothing running) -- distinct from the null/null case
# below, where nothing was observed at all (PR #511 review r5).
$fullFingerprint = Get-EnvironmentFingerprint -GpuInventory $fullInv -KitVersion $fullKit -FixtureFingerprint $fullFixture -ObservedActiveSessionCount 0 -ObservedKitInstanceBindingCount 0
Assert-True $fullFingerprint.complete 'environment fingerprint complete=true when all five fields measured'
Assert-Equal 'checkout_packman_declared' $fullFingerprint.kit_version.source 'environment fingerprint propagates kit_version source through to the report'
Assert-True ($fullFingerprint.kit_version.caveat -match 'test caveat') 'environment fingerprint propagates kit_version caveat through to the report'
Assert-True (-not $fullFingerprint.kit_version.runtime_verified) 'kit_version.runtime_verified=false: no running Kit build was interrogated'
Assert-Equal 0 $fullFingerprint.kit_version.observed_kit_process_count 'no observed Kit processes -> observed_kit_process_count=0'
Assert-True ($fullFingerprint.kit_version.caveat -notmatch 'observed running at capture time') 'no observed Kit processes -> no observed-process caveat appended'

# When Kit processes WERE observed holding GPU memory, the version field must say
# those exact processes were never interrogated (PR #511 review, round 2).
$observedKitFingerprint = Get-EnvironmentFingerprint -GpuInventory $fullInv -KitVersion $fullKit -FixtureFingerprint $fullFixture -ObservedKitProcessCount 2
Assert-Equal 2 $observedKitFingerprint.kit_version.observed_kit_process_count 'observed Kit process count carried into the fingerprint'
Assert-True (-not $observedKitFingerprint.kit_version.runtime_verified) 'observed Kit processes still do not make the version runtime-verified'
Assert-True ($observedKitFingerprint.kit_version.caveat -match '2 Kit GPU process\(es\) were observed running at capture time') 'observed Kit processes -> caveat names how many ran uninterrogated'
Assert-True ($observedKitFingerprint.kit_version.caveat -match 'may not describe the processes that produced these measurements') 'observed Kit processes -> caveat refuses to bind the checkout version to them'

Assert-Equal 1 $fullFingerprint.gpu_count 'single-GPU inventory reports gpu_count=1'
Assert-Equal 'single_gpu' $fullFingerprint.gpu_fingerprint_scope 'single-GPU host is fingerprinted under a declared single_gpu scope'

# A multi-GPU host must say the fingerprint covers only the first GPU row.
$multiFingerprint = Get-EnvironmentFingerprint -GpuInventory $invMixed -KitVersion $fullKit -FixtureFingerprint $fullFixture
Assert-Equal 2 $multiFingerprint.gpu_count 'multi-GPU inventory reports gpu_count=2'
Assert-Equal 'first_gpu_only' $multiFingerprint.gpu_fingerprint_scope 'multi-GPU host declares first_gpu_only fingerprint scope, not a silent single-GPU claim'
Assert-Equal 'NVIDIA GeForce RTX 4060 Ti' $multiFingerprint.gpu_model.value 'multi-GPU fingerprint still pins the first row (scope field is what makes that honest)'
# All five base fields individually measured=true does not entitle
# complete=true here: first_gpu_only means the fingerprint has not attributed
# every relevant GPU, and the wrapper's incomplete-fingerprint warning (SHALL
# NOT be used to set SLOs or admission parameters) must still fire on this
# host shape instead of being silently bypassed (PR #511 review, round 2).
Assert-True (-not $multiFingerprint.complete) 'multi-GPU host: complete=false despite every base field individually measured, because GPU topology attribution is incomplete'

$partialFingerprint = Get-EnvironmentFingerprint -GpuInventory $invMissing -KitVersion $fullKit -FixtureFingerprint $fullFixture
Assert-True (-not $partialFingerprint.complete) 'environment fingerprint complete=false when GPU unmeasured'
Assert-True (-not $partialFingerprint.gpu_model.measured) 'partial fingerprint: gpu_model unmeasured'
Assert-True (-not [string]::IsNullOrWhiteSpace($partialFingerprint.gpu_model.reason)) 'partial fingerprint: gpu_model carries reason'
Assert-True ($null -eq $partialFingerprint.gpu_count) 'no GPU inventory -> gpu_count null, not fabricated 0'
Assert-Equal 'unknown_no_gpu_inventory' $partialFingerprint.gpu_fingerprint_scope 'no GPU inventory -> scope reported as unknown, not single_gpu'

# PR #511 review r4 (owner-delegated adjudication of the reviewer's option B):
# -FixturePath is hashed independently of what the live session actually serves,
# so a report can bind session VRAM / viewer counts to the wrong fixture's
# fingerprint. The fix is honest provenance, not a fabricated verification:
#   (a) the provenance of the fixture identity is always published;
#   (b) completeness is withdrawn exactly when a live session is observed, which
#       is the only situation where misattribution is possible;
#   (c) an idle baseline - the primary 1.1 use case - keeps its semantics.
Assert-Equal 'operator_supplied_unverified' $fullFingerprint.fixture_provenance.value 'a supplied -FixturePath is published as operator-declared and unverified, never as an observation'
Assert-True $fullFingerprint.fixture_provenance.measured 'fixture provenance is itself a known fact, so it is measured=true'
Assert-True (-not $fullFingerprint.fixture_provenance.runtime_verified) 'fixture identity is never claimed as runtime-verified in this slice'
Assert-True ($fullFingerprint.fixture_provenance.caveat -match 'task 1.2/1.3') 'fixture provenance caveat defers runtime artifact-identity verification to task 1.2/1.3'
Assert-Equal 'no_live_session_observed' $fullFingerprint.fixture_binding_scope 'no observed session -> idle-baseline binding scope'
Assert-True $fullFingerprint.complete 'idle baseline with a declared fixture keeps complete=true: there is no live measurement to misattribute'

# (b) a live session IS observed: the declared fixture cannot be verified against
#     the artifact that session actually loaded, so the completeness claim goes.
$liveSessionFingerprint = Get-EnvironmentFingerprint -GpuInventory $fullInv -KitVersion $fullKit -FixtureFingerprint $fullFixture -ObservedActiveSessionCount 1
Assert-Equal 'live_session_unverified' $liveSessionFingerprint.fixture_binding_scope 'observed active session + declared fixture -> live_session_unverified binding scope'
Assert-True (-not $liveSessionFingerprint.complete) 'observed live session: complete=false despite every field measured, because the fixture binding is unverifiable in this slice'
Assert-True ($liveSessionFingerprint.fixture_binding_scope_note -match "cannot verify the declared fixture against the live session's artifact identity") 'incompleteness reason names the unverifiable fixture-to-session binding'
Assert-True ($liveSessionFingerprint.fixture_binding_scope_note -match 'task 1.2/1.3') 'incompleteness reason defers runtime artifact-identity verification to task 1.2/1.3'
Assert-Equal 'operator_supplied_unverified' $liveSessionFingerprint.fixture_provenance.value 'provenance field is retained in the live-session case too'
Assert-Equal 1 $liveSessionFingerprint.observed_active_session_count 'fingerprint records the observation that withdrew completeness'

# A kit_instance_binding alone is enough: bindings exist before/after the session
# row is counted, and either one means a live artifact is in play.
$boundFingerprint = Get-EnvironmentFingerprint -GpuInventory $fullInv -KitVersion $fullKit -FixtureFingerprint $fullFixture -ObservedActiveSessionCount 0 -ObservedKitInstanceBindingCount 2
Assert-Equal 'live_session_unverified' $boundFingerprint.fixture_binding_scope 'an observed kit_instance_binding alone also makes the fixture binding unverifiable'
Assert-True (-not $boundFingerprint.complete) 'observed kit binding: complete=false'

# An unreachable (or skipped, or malformed) runtime probe reports null, which is
# "no data". PR #511 review r5: the old defaults coerced those nulls to 0, so an
# UNKNOWN runtime state was published under the OBSERVED-idle label and the
# fingerprint could still claim complete=true beside a declared fixture. Unknown
# must stay unknown, and must cost the completeness claim.
$nullProbeFingerprint = Get-EnvironmentFingerprint -GpuInventory $fullInv -KitVersion $fullKit -FixtureFingerprint $fullFixture -ObservedActiveSessionCount $null -ObservedKitInstanceBindingCount $null
Assert-Equal 'runtime_state_unknown' $nullProbeFingerprint.fixture_binding_scope 'failed/absent runtime probe -> runtime_state_unknown, never the observed-idle label'
Assert-True (-not $nullProbeFingerprint.complete) 'unknown runtime state + declared fixture -> complete=false, so the SHALL-NOT-set-SLOs warning fires'
Assert-True ($nullProbeFingerprint.fixture_binding_scope_note -match 'GET /api/runtime/status') 'incompleteness reason names the probe that failed to observe the runtime'
Assert-True ($nullProbeFingerprint.fixture_binding_scope_note -match 'must not be published as an observed idle baseline') 'incompleteness reason states the exact confusion being refused'
Assert-True ($null -eq $nullProbeFingerprint.observed_active_session_count) 'unreachable probe records null, not a fabricated 0'

# Half-observed is still unknown: one readable count does not license a verdict
# about the other.
$halfProbeFingerprint = Get-EnvironmentFingerprint -GpuInventory $fullInv -KitVersion $fullKit -FixtureFingerprint $fullFixture -ObservedActiveSessionCount 0 -ObservedKitInstanceBindingCount $null
Assert-Equal 'runtime_state_unknown' $halfProbeFingerprint.fixture_binding_scope 'a partially observed runtime is unknown, not idle'
Assert-True (-not $halfProbeFingerprint.complete) 'partially observed runtime -> complete=false'

# A POSITIVE observation is definite even when the sibling count is missing:
# something live is running, so live_session_unverified outranks the unknown.
$partialLiveFingerprint = Get-EnvironmentFingerprint -GpuInventory $fullInv -KitVersion $fullKit -FixtureFingerprint $fullFixture -ObservedActiveSessionCount 2
Assert-Equal 'live_session_unverified' $partialLiveFingerprint.fixture_binding_scope 'an observed live session outranks a missing kit-binding count'
Assert-True (-not $partialLiveFingerprint.complete) 'observed live session with a partial probe -> complete=false'

# (c) no fixture declared at all: provenance says so instead of implying a file.
$noFixtureFingerprint = Get-EnvironmentFingerprint -GpuInventory $fullInv -KitVersion $fullKit -FixtureFingerprint $noFixture -ObservedActiveSessionCount 3
Assert-Equal 'not_supplied' $noFixtureFingerprint.fixture_provenance.value 'no declared fixture -> provenance reports not_supplied'
Assert-Equal 'not_supplied' $noFixtureFingerprint.fixture_binding_scope 'no declared fixture -> nothing to misbind, scope reports not_supplied'
Assert-True (-not $noFixtureFingerprint.complete) 'no declared fixture -> complete=false via the unmeasured fixture fields'
Write-TestPass 'Get-EnvironmentFingerprint completeness gate + fixture provenance honesty'

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
            # An IDLE host: no active session and no kit_instance_binding. This is
            # the primary task 1.1 use case, and the one case where a declared
            # fixture can still be part of a complete fingerprint (PR #511 r4).
            return [ordered]@{ ok = $true; body = [pscustomobject]@{ status = 'ok'; kit_signaling_port = 49100; sessions = [pscustomobject]@{ active_count = 0 }; kit_instance_bindings = @() }; status_code = 200; error = $null }
        }
    Assert-ReportSchemaShape -Report $completeReport -Message 'complete report (fixture + TTFF + success rate supplied)'
    Assert-True $completeReport.environment_fingerprint.complete 'complete report: environment_fingerprint.complete=true'
    Assert-Equal 'no_live_session_observed' $completeReport.environment_fingerprint.fixture_binding_scope 'complete report is an idle baseline: no live session to misattribute the declared fixture to'
    Assert-Equal 'operator_supplied_unverified' $completeReport.environment_fingerprint.fixture_provenance.value 'complete report still declares the fixture as operator-supplied and unverified'
    Assert-True $completeReport.ttff_ms.measured 'complete report: TTFF measured when supplied'
    Assert-Equal 812.5 $completeReport.ttff_ms.value 'complete report: TTFF value passed through'
    Assert-True $completeReport.session_creation_success_rate.measured 'complete report: success rate measured when supplied'
    Write-TestPass 'Get-SessionBaselineReport complete end-to-end (fixture + TTFF + success rate)'

    # The same inputs against a host that IS serving a session: every field is
    # still measured, but the report must refuse to present the operator's
    # fixture as the artifact those session numbers came from.
    $liveSessionReport = Get-SessionBaselineReport `
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
            return [ordered]@{ ok = $true; body = [pscustomobject]@{ status = 'ok'; kit_signaling_port = 49100; sessions = [pscustomobject]@{ active_count = 2 }; kit_instance_bindings = @([pscustomobject]@{ status = 'ready' }) }; status_code = 200; error = $null }
        }
    Assert-ReportSchemaShape -Report $liveSessionReport -Message 'live-session report (fixture declared while a session is being served)'
    Assert-Equal 'live_session_unverified' $liveSessionReport.environment_fingerprint.fixture_binding_scope 'live session observed -> fixture binding declared unverifiable'
    Assert-True (-not $liveSessionReport.environment_fingerprint.complete) 'live session observed: complete=false so the SHALL-NOT-set-SLOs warning fires instead of a fixture binding nobody verified'
    Assert-Equal 2 $liveSessionReport.environment_fingerprint.observed_active_session_count 'live-session report records the observed session count that withdrew completeness'
    Assert-True $liveSessionReport.environment_fingerprint.fixture_hash.measured 'live-session report still publishes the declared fixture hash (withheld completeness, not withheld data)'
    Write-TestPass 'Get-SessionBaselineReport withdraws completeness when a live session cannot be tied to the declared fixture'

    # PR #511 review r5: the coordinator is down, so every observed count arrives
    # null. The old fixture-binding defaults coerced them to 0 and shipped
    # 'no_live_session_observed' + complete=true -- an UNKNOWN host published as an
    # observed idle baseline, which is exactly the report a capacity decision would
    # trust.
    $probeFailureReport = Get-SessionBaselineReport `
        -CoordinatorUrl 'http://127.0.0.1:8004' `
        -RepoRoot $repoRoot `
        -Now $fixedNow `
        -FixturePath $fixtureFile `
        -NvidiaSmiQuery { @('0, NVIDIA GeForce RTX 4060 Ti, 580.97, 8188, 1827, 6123, 2, 0, [N/A]') } `
        -NvidiaSmiComputeAppsQuery { @('40232, kit.exe, 2000') } `
        -WebRtcHealthInvoker {
            param($Uri, $Timeout)
            return [ordered]@{ ok = $false; body = $null; status_code = $null; error = 'connection refused' }
        }
    Assert-ReportSchemaShape -Report $probeFailureReport -Message 'probe-failure report (fixture declared, runtime state unknown)'
    Assert-Equal 'runtime_state_unknown' $probeFailureReport.environment_fingerprint.fixture_binding_scope 'failed runtime probe + declared fixture -> runtime_state_unknown, not no_live_session_observed'
    Assert-True (-not $probeFailureReport.environment_fingerprint.complete) 'failed runtime probe -> complete=false instead of a complete fingerprint built on coerced zeros'
    Assert-True ($probeFailureReport.environment_fingerprint.fixture_binding_scope_note -match 'GET /api/runtime/status') 'probe-failure incompleteness reason names the failed probe'
    Assert-True ($null -eq $probeFailureReport.environment_fingerprint.observed_active_session_count) 'probe-failure report keeps the observed session count null'
    Assert-Equal 'unknown_no_runtime_observation' $probeFailureReport.session_vram_watermark.session_scope 'probe-failure report cannot claim a session scope for its VRAM sample'
    Assert-True $probeFailureReport.environment_fingerprint.fixture_hash.measured 'probe-failure report still publishes the declared fixture hash (withheld completeness, not withheld data)'

    # A malformed 200 body is the same class of ignorance as an unreachable host.
    $malformedRuntimeReport = Get-SessionBaselineReport `
        -CoordinatorUrl 'http://127.0.0.1:8004' `
        -RepoRoot $repoRoot `
        -Now $fixedNow `
        -FixturePath $fixtureFile `
        -NvidiaSmiQuery { @('0, NVIDIA GeForce RTX 4060 Ti, 580.97, 8188, 1827, 6123, 2, 0, [N/A]') } `
        -NvidiaSmiComputeAppsQuery { @('40232, kit.exe, 2000') } `
        -WebRtcHealthInvoker {
            param($Uri, $Timeout)
            if ($Uri -match '/health$') {
                return [ordered]@{ ok = $true; body = [pscustomobject]@{ status = 'ok' }; status_code = 200; error = $null }
            }
            return [ordered]@{ ok = $true; body = [pscustomobject]@{ unexpected = 'shape' }; status_code = 200; error = $null }
        }
    Assert-Equal 'runtime_state_unknown' $malformedRuntimeReport.environment_fingerprint.fixture_binding_scope 'malformed runtime body -> runtime_state_unknown'
    Assert-True (-not $malformedRuntimeReport.environment_fingerprint.complete) 'malformed runtime body -> complete=false'

    # PR #511 review r6: version skew can also return a non-null active_count
    # that is not a valid integer (e.g. "unknown") -- this must land in the
    # same runtime_state_unknown bucket as a missing/unreachable probe, not be
    # coerced into 0 and read as an observed idle host.
    $malformedActiveCountReport = Get-SessionBaselineReport `
        -CoordinatorUrl 'http://127.0.0.1:8004' `
        -RepoRoot $repoRoot `
        -Now $fixedNow `
        -FixturePath $fixtureFile `
        -NvidiaSmiQuery { @('0, NVIDIA GeForce RTX 4060 Ti, 580.97, 8188, 1827, 6123, 2, 0, [N/A]') } `
        -NvidiaSmiComputeAppsQuery { @('40232, kit.exe, 2000') } `
        -WebRtcHealthInvoker {
            param($Uri, $Timeout)
            if ($Uri -match '/health$') {
                return [ordered]@{ ok = $true; body = [pscustomobject]@{ status = 'ok' }; status_code = 200; error = $null }
            }
            return [ordered]@{ ok = $true; body = [pscustomobject]@{ sessions = [pscustomobject]@{ active_count = 'unknown'; items = @() }; kit_instance_bindings = @() }; status_code = 200; error = $null }
        }
    Assert-Equal 'runtime_state_unknown' $malformedActiveCountReport.environment_fingerprint.fixture_binding_scope 'non-numeric active_count -> runtime_state_unknown, never coerced into an observed zero'
    Assert-True (-not $malformedActiveCountReport.environment_fingerprint.complete) 'non-numeric active_count -> complete=false'
    Assert-Equal 'malformed_runtime_observation' $malformedActiveCountReport.session_vram_watermark.session_scope 'non-numeric active_count -> VRAM watermark reports malformed scope, never single_session'
    Write-TestPass 'Get-SessionBaselineReport refuses to relabel an unknown runtime state as an observed idle baseline'

    # Session scope end-to-end. One active session keeps the current
    # 1-primary+k-spectator semantics; the two-session report above must not.
    $singleSessionReport = Get-SessionBaselineReport `
        -CoordinatorUrl 'http://127.0.0.1:8004' `
        -RepoRoot $repoRoot `
        -Now $fixedNow `
        -NvidiaSmiQuery { @('0, NVIDIA GeForce RTX 4060 Ti, 580.97, 8188, 1827, 6123, 2, 0, [N/A]') } `
        -NvidiaSmiComputeAppsQuery { @('40232, kit.exe, 2000') } `
        -WebRtcHealthInvoker {
            param($Uri, $Timeout)
            if ($Uri -match '/health$') {
                return [ordered]@{ ok = $true; body = [pscustomobject]@{ status = 'ok' }; status_code = 200; error = $null }
            }
            return [ordered]@{ ok = $true; body = [pscustomobject]@{ sessions = [pscustomobject]@{ active_count = 1; items = @([pscustomobject]@{ session_id = 'rs_only'; status = 'active'; viewer_leases = @([pscustomobject]@{ role = 'primary'; status = 'active' }, [pscustomobject]@{ role = 'spectator'; status = 'active' }) }) }; kit_instance_bindings = @() }; status_code = 200; error = $null }
        }
    Assert-Equal 'single_session' $singleSessionReport.session_vram_watermark.session_scope 'one active session -> single_session scope'
    Assert-True $singleSessionReport.session_vram_watermark.watermark_interpretation.measured 'one active session -> the 1 primary + k spectator interpretation stands'
    Assert-Equal 1 $singleSessionReport.session_vram_watermark.observed_primary_lease_count 'single-session report counts its one primary lease'
    Assert-Equal 1 $singleSessionReport.session_vram_watermark.observed_spectator_lease_count 'single-session report counts its one spectator lease'

    Assert-Equal 'multi_session_aggregate' $liveSessionReport.session_vram_watermark.session_scope 'two active sessions against one host-wide VRAM sample -> multi_session_aggregate scope'
    Assert-True (-not $liveSessionReport.session_vram_watermark.watermark_interpretation.measured) 'two active sessions -> the watermark interpretation is not measured'
    Assert-True ($liveSessionReport.session_vram_watermark.watermark_interpretation.reason -match 'non-isolated multi-session snapshot') 'multi-session refusal names the non-isolated snapshot'
    Assert-True ($liveSessionReport.session_vram_watermark.watermark_interpretation.reason -match 'per-session VRAM attribution unavailable in this slice') 'multi-session refusal names the missing per-session attribution'
    Assert-Equal 2000 $liveSessionReport.session_vram_watermark.total_kit_vram_mb 'multi-session report keeps its aggregate VRAM measurement'
    Write-TestPass 'session_vram_watermark reports its session scope end-to-end (single vs multi session)'
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

# PR #511 review r6: positive infinity satisfies "-ge 0" and must not be
# laundered into the report as a measured elapsed time.
$infiniteTtffReport = Get-SessionBaselineReport `
    -CoordinatorUrl 'http://127.0.0.1:8004' `
    -RepoRoot $repoRoot `
    -Now $fixedNow `
    -SkipWebRtcProbe `
    -TtffMs ([double]::PositiveInfinity) `
    -NvidiaSmiQuery { return $null } `
    -NvidiaSmiComputeAppsQuery { return $null }
Assert-True (-not $infiniteTtffReport.ttff_ms.measured) 'infinite caller-supplied TTFF is rejected, not accepted as measured'
Assert-True ($null -eq $infiniteTtffReport.ttff_ms.value) 'rejected infinite TTFF leaves value null'
Assert-True ($infiniteTtffReport.ttff_ms.reason -match 'finite') 'rejected infinite TTFF reason names the finiteness constraint'
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

# PR #511 review r5: -FixturePath and -OutputPath resolving to the same file made
# Set-Content truncate the fixture with the report -- destroying the very artifact
# the report claims to fingerprint. The wrapper must refuse before any write.
$sandbox = New-TestSandbox -Prefix 'measure-baseline-overwrite-guard'
try {
    $guardFixture = Join-Path $sandbox 'fixture.ifc'
    Set-Content -LiteralPath $guardFixture -Value 'precious fixture bytes' -Encoding utf8 -NoNewline
    $guardError = $null
    try {
        & $rootScriptPath -OutputPath $guardFixture -FixturePath $guardFixture -SkipWebRtcProbe -ProbeTimeoutSec 1 | Out-Null
    } catch { $guardError = $_ }
    Assert-True ($null -ne $guardError) 'wrapper refuses when -OutputPath and -FixturePath name the same file'
    Assert-True ("$guardError" -match 'would truncate the fixture being measured') 'overwrite refusal explains that the fixture would be destroyed'
    Assert-Equal 'precious fixture bytes' (Get-Content -LiteralPath $guardFixture -Raw) 'refused run leaves the fixture byte-identical'

    # The same file reached through a non-canonical spelling must be caught too:
    # a naive string compare would happily truncate it.
    $awkwardOutput = Join-Path $sandbox (Join-Path '.' 'fixture.ifc')
    $guardError2 = $null
    try {
        & $rootScriptPath -OutputPath $awkwardOutput -FixturePath $guardFixture -SkipWebRtcProbe -ProbeTimeoutSec 1 | Out-Null
    } catch { $guardError2 = $_ }
    Assert-True ($null -ne $guardError2) 'non-canonical -OutputPath spelling of the fixture is still refused'
    Assert-Equal 'precious fixture bytes' (Get-Content -LiteralPath $guardFixture -Raw) 'non-canonical refusal also leaves the fixture intact'

    # A genuinely different -OutputPath beside the fixture must still work: the
    # guard refuses a collision, not the directory.
    $distinctOutput = Join-Path $sandbox 'report.json'
    & $rootScriptPath -OutputPath $distinctOutput -FixturePath $guardFixture -SkipWebRtcProbe -ProbeTimeoutSec 1 | Out-Null
    Assert-True (Test-Path -LiteralPath $distinctOutput -PathType Leaf) 'a distinct -OutputPath beside the fixture is not blocked by the guard'
    Assert-Equal 'precious fixture bytes' (Get-Content -LiteralPath $guardFixture -Raw) 'a legitimate run never touches the fixture'
    Write-TestPass 'root wrapper refuses to overwrite -FixturePath with the report (-OutputPath collision guard)'
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
    # Delete only the report THIS invocation produced. Deleting every file in
    # $newFiles would also remove evidence written by any other harness
    # invocation that happens to land in the same directory between the
    # before/after snapshots (a real risk: this test shares the checkout's
    # artifacts/gpu-baseline/ with any concurrent manual run or another test
    # process) -- collateral deletion of unrelated measurement evidence
    # (PR #511 review, round 2).
    Remove-Item -LiteralPath (Join-Path $gpuBaselineDir "$($defaultReport.run_id).json") -Force -ErrorAction SilentlyContinue
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
