# scripts\lib\measure-session-baseline.ps1
#
# Core, unit-testable logic for the GPU session baseline harness
# (openspec/changes/gpu-session-baseline-and-idle-reclaim task 1.1).
#
# Read-only by design: this library never opens a WebRTC session, never calls
# a coordinator write endpoint, and never starts/stops any service. It only
# observes nvidia-smi and GET-only coordinator endpoints. Fields it cannot
# honestly measure locally (TTFF, session creation success rate, a fixture
# hash when no fixture was supplied, a per-stream VRAM split nvidia-smi
# cannot report) are surfaced as `measured:false` with a `reason`, never
# fabricated.
#
# Root CLI entrypoint: scripts\measure-session-baseline.ps1
# Tests: scripts\tests\test-measure-session-baseline.ps1

Set-StrictMode -Version Latest

function Get-SafeProperty {
    # Dot-accessing a property under Set-StrictMode throws if the object is a
    # PSCustomObject (e.g. from ConvertFrom-Json / Invoke-RestMethod) and does
    # not carry that property -- coordinator responses are external input, so
    # every read of one must go through here instead of a bare `.Prop`.
    [CmdletBinding()]
    param($Object, [Parameter(Mandatory = $true)][string] $Name)
    #
    # The `,` before each returned value is load-bearing: PowerShell enumerates
    # arrays written to the output stream, so a bare `return $prop.Value` turns
    # an observed empty array into $null and an observed 0 into "not measured".
    # Wrapping in a single-element array makes the value survive as itself.
    if ($null -eq $Object) { return $null }
    if ($Object -is [System.Collections.IDictionary]) {
        if ($Object.Contains($Name)) { return ,$Object[$Name] }
        return $null
    }
    $prop = $Object.PSObject.Properties[$Name]
    if ($null -eq $prop) { return $null }
    return ,$prop.Value
}

function Test-ConsumerRtxGpuName {
    [CmdletBinding()]
    param([string] $Name)
    if (-not $Name) { return $false }
    # Datacenter / professional lines report as "GeForce RTX"-adjacent in some
    # driver builds; exclude them explicitly before accepting the consumer match.
    if ($Name -match '(?i)\b(quadro|tesla|RTX\s*A\d{3,4}|RTX\s*PRO|A100|A800|H100|H200|H800|L4|L40|L40S|DGX|GRID)\b') {
        return $false
    }
    return [bool]($Name -match '(?i)GeForce\s+RTX')
}

function ConvertTo-NullableInt {
    [CmdletBinding()]
    param([string] $Raw)
    if ($null -eq $Raw) { return $null }
    $clean = ($Raw -replace '^\[|\]$', '').Trim()
    $value = 0
    if ([int]::TryParse($clean, [ref] $value)) { return $value }
    return $null
}

function ConvertFrom-NvidiaSmiGpuLine {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string] $Line)

    $parts = @($Line -split ',' | ForEach-Object { $_.Trim() })
    if ($parts.Count -lt 9) {
        return [ordered]@{ parse_ok = $false; raw = $Line }
    }

    $migRaw = ($parts[8] -replace '^\[|\]$', '').Trim()
    $memTotal = ConvertTo-NullableInt -Raw $parts[3]
    $memUsed = ConvertTo-NullableInt -Raw $parts[4]
    $memFree = ConvertTo-NullableInt -Raw $parts[5]
    $utilGpu = ConvertTo-NullableInt -Raw $parts[6]
    $utilMem = ConvertTo-NullableInt -Raw $parts[7]

    return [ordered]@{
        parse_ok                = $true
        index                   = ConvertTo-NullableInt -Raw $parts[0]
        name                    = $parts[1]
        driver_version           = $parts[2]
        memory_total_mb         = $memTotal
        memory_used_mb          = $memUsed
        memory_free_mb          = $memFree
        utilization_gpu_pct     = $utilGpu
        utilization_memory_pct  = $utilMem
        mig_mode_raw            = $migRaw
        mig_available           = ($migRaw -eq 'Enabled')
        is_consumer_rtx         = (Test-ConsumerRtxGpuName -Name $parts[1])
    }
}

function Get-GpuInventorySnapshot {
    [CmdletBinding()]
    param(
        [scriptblock] $NvidiaSmiQuery = {
            $cmd = Get-Command nvidia-smi -ErrorAction SilentlyContinue
            if (-not $cmd) { return $null }
            $out = & nvidia-smi --query-gpu=index,name,driver_version,memory.total,memory.used,memory.free,utilization.gpu,utilization.memory,mig.mode.current --format=csv,noheader,nounits 2>&1
            if ($LASTEXITCODE -ne 0) { return $null }
            return @($out)
        }
    )

    try {
        $lines = & $NvidiaSmiQuery
    } catch {
        return [ordered]@{
            measured = $false
            reason   = "nvidia-smi query threw: $($_.Exception.Message)"
            gpus     = @()
            consumer_grade_all    = $null
            mig_available_any     = $null
            software_queue_required = $null
        }
    }
    if ($null -eq $lines) {
        return [ordered]@{
            measured = $false
            reason   = 'nvidia-smi not found or query failed'
            gpus     = @()
            consumer_grade_all    = $null
            mig_available_any     = $null
            software_queue_required = $null
        }
    }
    $lines = @($lines | Where-Object { $_ -and $_.Trim() })
    if ($lines.Count -eq 0) {
        return [ordered]@{
            measured = $false
            reason   = 'nvidia-smi returned no GPU rows'
            gpus     = @()
            consumer_grade_all    = $null
            mig_available_any     = $null
            software_queue_required = $null
        }
    }

    $gpus = @()
    foreach ($line in $lines) {
        $gpus += (ConvertFrom-NvidiaSmiGpuLine -Line $line)
    }

    $parsedGpus = @($gpus | Where-Object { $_.parse_ok })
    $consumerAll = $null
    $migAny = $null
    $softwareQueueRequired = $null
    if ($parsedGpus.Count -gt 0) {
        $consumerAll = -not [bool]($parsedGpus | Where-Object { -not $_.is_consumer_rtx })
        $migAny = [bool]($parsedGpus | Where-Object { $_.mig_available })
        $softwareQueueRequired = ($consumerAll -and -not $migAny)
    }

    return [ordered]@{
        measured = $true
        reason   = $null
        gpus     = $gpus
        consumer_grade_all      = $consumerAll
        mig_available_any       = $migAny
        software_queue_required = $softwareQueueRequired
    }
}

function Get-GpuComputeProcessSnapshot {
    [CmdletBinding()]
    param(
        [scriptblock] $NvidiaSmiComputeAppsQuery = {
            $cmd = Get-Command nvidia-smi -ErrorAction SilentlyContinue
            if (-not $cmd) { return $null }
            $out = & nvidia-smi --query-compute-apps=pid,process_name,used_memory --format=csv,noheader,nounits 2>&1
            if ($LASTEXITCODE -ne 0) { return $null }
            return @($out)
        }
    )

    try {
        $lines = & $NvidiaSmiComputeAppsQuery
    } catch {
        return [ordered]@{ measured = $false; reason = "nvidia-smi compute-apps query threw: $($_.Exception.Message)"; processes = @() }
    }
    if ($null -eq $lines) {
        return [ordered]@{ measured = $false; reason = 'nvidia-smi not found or compute-apps query failed'; processes = @() }
    }
    $lines = @($lines | Where-Object { $_ -and $_.Trim() })

    $processes = @()
    foreach ($line in $lines) {
        $parts = @($line -split ',' | ForEach-Object { $_.Trim() })
        if ($parts.Count -lt 3) { continue }
        $pidRaw = $parts[0]
        $usedRaw = $parts[$parts.Count - 1]
        $nameRaw = ($parts[1..($parts.Count - 2)] -join ',').Trim()
        $usedValue = ConvertTo-NullableInt -Raw $usedRaw
        $processes += [ordered]@{
            pid                   = (ConvertTo-NullableInt -Raw $pidRaw)
            process_name          = $nameRaw
            used_memory_mb        = $usedValue
            used_memory_measured  = ($null -ne $usedValue)
        }
    }

    # measured=true here means the driver query itself succeeded; whether any
    # Kit-related process is present, and whether its VRAM is readable, are
    # separate honestly-reported facts (see Get-SessionVramWatermark).
    return [ordered]@{ measured = $true; reason = $null; processes = $processes }
}

function Get-KitVersionFingerprint {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string] $RepoRoot)

    $packmanPath = Join-Path $RepoRoot 'bim-streaming-server\tools\deps\kit-sdk.packman.xml'
    if (-not (Test-Path -LiteralPath $packmanPath -PathType Leaf)) {
        return [ordered]@{ value = $null; measured = $false; reason = "kit-sdk.packman.xml not found at $packmanPath"; source_path = $packmanPath }
    }
    try {
        $content = Get-Content -LiteralPath $packmanPath -Raw
    } catch {
        return [ordered]@{ value = $null; measured = $false; reason = "failed to read $($packmanPath): $($_.Exception.Message)"; source_path = $packmanPath }
    }
    $match = [regex]::Match($content, 'name="kit-kernel"\s+version="(?<version>[0-9]+\.[0-9]+\.[0-9]+)')
    if (-not $match.Success) {
        return [ordered]@{ value = $null; measured = $false; reason = 'kit-kernel version token not found in kit-sdk.packman.xml'; source_path = $packmanPath }
    }
    return [ordered]@{ value = $match.Groups['version'].Value; measured = $true; reason = $null; source_path = $packmanPath }
}

function Get-FixtureFingerprint {
    [CmdletBinding()]
    param([string] $FixturePath)

    if (-not $FixturePath) {
        $reason = 'no -FixturePath supplied to this harness run (no live session artifact captured)'
        return [ordered]@{ hash = $null; hash_measured = $false; hash_reason = $reason; size_bytes = $null; size_measured = $false; size_reason = $reason }
    }
    if (-not (Test-Path -LiteralPath $FixturePath -PathType Leaf)) {
        $reason = "fixture path does not exist: $FixturePath"
        return [ordered]@{ hash = $null; hash_measured = $false; hash_reason = $reason; size_bytes = $null; size_measured = $false; size_reason = $reason }
    }
    try {
        $hash = (Get-FileHash -LiteralPath $FixturePath -Algorithm SHA256).Hash.ToLowerInvariant()
        $size = (Get-Item -LiteralPath $FixturePath).Length
        return [ordered]@{ hash = $hash; hash_measured = $true; hash_reason = $null; size_bytes = $size; size_measured = $true; size_reason = $null }
    } catch {
        $reason = "failed to hash fixture: $($_.Exception.Message)"
        return [ordered]@{ hash = $null; hash_measured = $false; hash_reason = $reason; size_bytes = $null; size_measured = $false; size_reason = $reason }
    }
}

function Get-WebRtcHealthProbe {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string] $CoordinatorUrl,
        [int] $TimeoutSec = 5,
        [scriptblock] $HealthInvoker = {
            param($Uri, $Timeout)
            try {
                $response = Invoke-RestMethod -Method Get -Uri $Uri -TimeoutSec $Timeout
                return [ordered]@{ ok = $true; body = $response; status_code = 200; error = $null }
            } catch {
                # Under Set-StrictMode, .Exception.Response only exists on some
                # exception types (e.g. WebException on Windows PowerShell 5.1);
                # a connection-refused HttpRequestException on pwsh 7 has no
                # such property at all, so probe it via PSObject first.
                $statusCode = $null
                $hasResponseProperty = $_.Exception.PSObject.Properties.Match('Response').Count -gt 0
                if ($hasResponseProperty -and $_.Exception.Response -and $_.Exception.Response.PSObject.Properties.Match('StatusCode').Count -gt 0) {
                    try { $statusCode = [int]$_.Exception.Response.StatusCode } catch { $statusCode = $null }
                }
                return [ordered]@{ ok = $false; body = $null; status_code = $statusCode; error = $_.Exception.Message }
            }
        }
    )

    $trimmedBase = $CoordinatorUrl.TrimEnd('/')
    $healthUri = "$trimmedBase/health"
    $runtimeUri = "$trimmedBase/api/runtime/status"

    # Both calls are GET-only observations: /health reports coordinator liveness,
    # /api/runtime/status reports counts of sessions/bindings that already exist.
    # Neither creates, joins, or mutates a review session.
    $healthResult = & $HealthInvoker $healthUri $TimeoutSec
    $runtimeResult = & $HealthInvoker $runtimeUri $TimeoutSec

    $serviceStatus = $null
    $kitSignalingPort = $null
    if ($healthResult.ok -and $healthResult.body) {
        $statusValue = Get-SafeProperty -Object $healthResult.body -Name 'status'
        if ($null -ne $statusValue) { $serviceStatus = [string]$statusValue }
        $kitSignalingPort = Get-SafeProperty -Object $healthResult.body -Name 'kit_signaling_port'
    }

    # KitInstanceBindingStatus (bim-review-coordinator/src/types.ts) is
    #   "allocated" | "starting" | "ready" | "draining" | "released" | "failed"
    # -- there is no 'active' member. The first three still hold (or are
    # acquiring) Kit capacity; draining/released/failed no longer do.
    $nonTerminalBindingStatuses = @('allocated', 'starting', 'ready')

    $activeSessionCount = $null
    $activeBindingCount = $null
    $primaryLeaseCount = $null
    $spectatorLeaseCount = $null
    if ($runtimeResult.ok -and $runtimeResult.body) {
        $sessionsValue = Get-SafeProperty -Object $runtimeResult.body -Name 'sessions'
        if ($null -ne $sessionsValue) {
            $activeSessionCount = Get-SafeProperty -Object $sessionsValue -Name 'active_count'

            # Per-role viewer lease counts. buildRuntimeStatus() projects every
            # session under sessions.items[], and summarizeSessionForRuntime()
            # attaches viewer_leases[] whose entries carry role
            # ("primary"|"spectator") and status ("active"|"released"|"expired")
            # -- see bim-review-coordinator/src/runtimeStatus.ts and
            # PublicViewerLease in src/services/viewerLeaseStore.ts. Counting
            # only status='active' leases makes the "1 primary + k spectator"
            # shape expressible instead of collapsing it into one session count.
            $itemsValue = Get-SafeProperty -Object $sessionsValue -Name 'items'
            if ($null -ne $itemsValue) {
                $primaryLeaseCount = 0
                $spectatorLeaseCount = 0
                foreach ($sessionItem in @($itemsValue)) {
                    $leasesValue = Get-SafeProperty -Object $sessionItem -Name 'viewer_leases'
                    if ($null -eq $leasesValue) { continue }
                    foreach ($lease in @($leasesValue)) {
                        if ((Get-SafeProperty -Object $lease -Name 'status') -ne 'active') { continue }
                        $role = Get-SafeProperty -Object $lease -Name 'role'
                        if ($role -eq 'primary') { $primaryLeaseCount++ }
                        elseif ($role -eq 'spectator') { $spectatorLeaseCount++ }
                    }
                }
            }
        }
        $bindingsValue = Get-SafeProperty -Object $runtimeResult.body -Name 'kit_instance_bindings'
        # `if ($bindingsValue)` treats an empty array as absent, which would
        # report an observed zero as "not measured". An observed 0 is a real
        # measurement, so test for $null explicitly.
        if ($null -ne $bindingsValue) {
            $activeBindingCount = @($bindingsValue | Where-Object { $nonTerminalBindingStatuses -contains (Get-SafeProperty -Object $_ -Name 'status') }).Count
        }
    }

    $errorMessage = $null
    if (-not $healthResult.ok) {
        $errorMessage = $healthResult.error
    } elseif (-not $runtimeResult.ok) {
        $errorMessage = $runtimeResult.error
    }

    return [ordered]@{
        measured                          = $true
        coordinator_url                   = $CoordinatorUrl
        reachable                         = [bool]$healthResult.ok
        status_code                       = $healthResult.status_code
        service_status                    = $serviceStatus
        kit_signaling_port                = $kitSignalingPort
        webrtc_signaling_probed           = $false
        probe_scope                       = 'coordinator_only'
        runtime_status_reachable          = [bool]$runtimeResult.ok
        active_session_count              = $activeSessionCount
        observed_primary_lease_count      = $primaryLeaseCount
        observed_spectator_lease_count    = $spectatorLeaseCount
        active_kit_instance_binding_count = $activeBindingCount
        error                             = $errorMessage
        note                              = 'read-only GET /health and GET /api/runtime/status; does not create, join, or modify any review session. reachable reflects coordinator HTTP reachability only -- no WebRTC signaling endpoint is contacted, and kit_signaling_port is merely the port the coordinator echoes back from its own configuration, not a port this harness connected to.'
    }
}

function Get-SessionVramWatermark {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)] $GpuComputeSnapshot,
        $ObservedActiveSessionCount,
        $ObservedPrimaryLeaseCount,
        $ObservedSpectatorLeaseCount
    )

    $note = 'per-stream (primary vs spectator) VRAM split is not observable via nvidia-smi: Kit hosts all streams (1 primary + k spectator) inside a single GPU process, so only the combined process VRAM can be measured from outside Kit'
    # Kit processes are matched by process name only. Any co-resident Kit
    # process on this host (e.g. a headless Kit run doing IFC conversion) is
    # therefore included in the total, and no PID is attributed to a specific
    # kit_instance_binding or review session. Full PID<->binding attribution is
    # deferred to task 1.2/1.3.
    $attribution = 'process_name_match_only'
    $attributionNote = 'total_kit_vram_mb sums every process whose name matches Kit; co-resident Kit processes not serving this review session (e.g. IFC conversion) are included, and no PID is attributed to a kit_instance_binding. Full PID-to-binding attribution is deferred to task 1.2/1.3.'

    if (-not $GpuComputeSnapshot.measured) {
        return [ordered]@{
            measured                    = $false
            reason                      = $GpuComputeSnapshot.reason
            kit_processes               = @()
            total_kit_vram_mb           = $null
            attribution                 = $attribution
            attribution_note            = $attributionNote
            observed_active_session_count = $ObservedActiveSessionCount
            observed_primary_lease_count   = $ObservedPrimaryLeaseCount
            observed_spectator_lease_count = $ObservedSpectatorLeaseCount
            note                        = $note
        }
    }

    $kitProcesses = @($GpuComputeSnapshot.processes | Where-Object { $_.process_name -match '(?i)(^|[\\/])kit(\.exe)?$' })
    if ($kitProcesses.Count -eq 0) {
        return [ordered]@{
            measured                    = $false
            reason                      = 'no active Kit GPU process observed at capture time (no live session running on this host right now)'
            kit_processes               = @()
            total_kit_vram_mb           = $null
            attribution                 = $attribution
            attribution_note            = $attributionNote
            observed_active_session_count = $ObservedActiveSessionCount
            observed_primary_lease_count   = $ObservedPrimaryLeaseCount
            observed_spectator_lease_count = $ObservedSpectatorLeaseCount
            note                        = $note
        }
    }

    $measuredProcesses = @($kitProcesses | Where-Object { $_.used_memory_measured })
    $unreadableCount = $kitProcesses.Count - $measuredProcesses.Count
    $totalVram = $null
    $reason = $null
    if ($measuredProcesses.Count -eq 0) {
        $reason = 'Kit process observed but VRAM readout unavailable (nvidia-smi compute-apps memory column requires elevated OS permission on this host)'
    } elseif ($unreadableCount -gt 0) {
        # Summing only the readable subset would publish a total that is
        # silently smaller than the real watermark, and an under-counted
        # watermark is exactly the number a capacity decision would trust.
        # Refuse the total instead of shipping a low-biased one.
        $reason = "partial VRAM visibility: $unreadableCount of $($kitProcesses.Count) matching Kit processes have no readable used_memory; refusing to report an under-counted total"
    } else {
        # Manual sum (not Measure-Object -Property): the process entries are
        # ordered hashtables, and Measure-Object's -Property reflection does
        # not reliably resolve hashtable keys across PowerShell editions.
        $sum = 0
        foreach ($proc in $measuredProcesses) { $sum += [int]$proc.used_memory_mb }
        $totalVram = $sum
    }

    return [ordered]@{
        measured                    = ($null -ne $totalVram)
        reason                      = $reason
        kit_processes               = $kitProcesses
        kit_process_count           = $kitProcesses.Count
        kit_process_vram_unreadable_count = $unreadableCount
        total_kit_vram_mb           = $totalVram
        attribution                 = $attribution
        attribution_note            = $attributionNote
        observed_active_session_count = $ObservedActiveSessionCount
        observed_primary_lease_count   = $ObservedPrimaryLeaseCount
        observed_spectator_lease_count = $ObservedSpectatorLeaseCount
        note                        = $note
    }
}

function Get-EnvironmentFingerprint {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)] $GpuInventory,
        [Parameter(Mandatory = $true)] $KitVersion,
        [Parameter(Mandatory = $true)] $FixtureFingerprint
    )

    $gpuModel = $null
    $gpuModelMeasured = $false
    $gpuModelReason = 'no GPU detected via nvidia-smi'
    $gpuDriver = $null
    $gpuDriverMeasured = $false
    $gpuDriverReason = 'no GPU detected via nvidia-smi'

    if ($GpuInventory.measured -and @($GpuInventory.gpus | Where-Object { $_.parse_ok }).Count -gt 0) {
        $primaryGpu = @($GpuInventory.gpus | Where-Object { $_.parse_ok })[0]
        $gpuModel = $primaryGpu.name
        $gpuModelMeasured = $true
        $gpuModelReason = $null
        $gpuDriver = $primaryGpu.driver_version
        $gpuDriverMeasured = $true
        $gpuDriverReason = $null
    } elseif ($GpuInventory.measured) {
        $gpuModelReason = 'nvidia-smi query succeeded but returned zero parseable GPU rows'
        $gpuDriverReason = $gpuModelReason
    } else {
        $gpuModelReason = $GpuInventory.reason
        $gpuDriverReason = $GpuInventory.reason
    }

    $fields = [ordered]@{
        gpu_model           = [ordered]@{ value = $gpuModel; measured = $gpuModelMeasured; reason = $gpuModelReason }
        gpu_driver_version  = [ordered]@{ value = $gpuDriver; measured = $gpuDriverMeasured; reason = $gpuDriverReason }
        kit_version         = [ordered]@{ value = $KitVersion.value; measured = $KitVersion.measured; reason = $KitVersion.reason }
        fixture_hash        = [ordered]@{ value = $FixtureFingerprint.hash; measured = $FixtureFingerprint.hash_measured; reason = $FixtureFingerprint.hash_reason }
        fixture_size_bytes  = [ordered]@{ value = $FixtureFingerprint.size_bytes; measured = $FixtureFingerprint.size_measured; reason = $FixtureFingerprint.size_reason }
    }
    $allMeasured = $true
    foreach ($key in @($fields.Keys)) {
        if (-not $fields[$key].measured) { $allMeasured = $false }
    }
    $fields['complete'] = $allMeasured

    # Multi-GPU scope, appended after the completeness loop so these keys are
    # never mistaken for measurement triples. gpu_model / gpu_driver_version
    # above describe the FIRST nvidia-smi row only, while the harness's VRAM
    # figures span every device the driver reports. On a multi-GPU host the
    # fingerprint therefore pins one device and an equal fingerprint does not
    # prove an equal GPU topology. Per-GPU fingerprinting is deferred to task 1.2.
    $parsedGpuCount = $null
    if ($GpuInventory.measured) { $parsedGpuCount = @($GpuInventory.gpus | Where-Object { $_.parse_ok }).Count }
    $gpuScope = 'unknown_no_gpu_inventory'
    if ($null -ne $parsedGpuCount) {
        if ($parsedGpuCount -le 1) { $gpuScope = 'single_gpu' } else { $gpuScope = 'first_gpu_only' }
    }
    $fields['gpu_count'] = $parsedGpuCount
    $fields['gpu_fingerprint_scope'] = $gpuScope
    $fields['gpu_fingerprint_scope_note'] = 'gpu_model and gpu_driver_version describe the first nvidia-smi GPU row only; a multi-GPU host is not fully fingerprinted (per-GPU fingerprint deferred to task 1.2), so an equal fingerprint does not by itself prove an equal GPU topology'
    return $fields
}

function New-OptionalMeasurement {
    # Caller-supplied metrics are external input, not observations: an
    # out-of-range value must be refused with a reason rather than laundered
    # into the report as if it had been measured. -Source records the
    # provenance channel so a reader can tell a caller-supplied number from a
    # locally observed one.
    [CmdletBinding()]
    param(
        $Value,
        [string] $MissingReason,
        [string] $Source,
        [scriptblock] $Validator,
        [string] $InvalidReasonFormat
    )
    if ($null -eq $Value) {
        $result = [ordered]@{ value = $null; measured = $false; reason = $MissingReason }
    } elseif ($Validator -and -not (& $Validator $Value)) {
        $result = [ordered]@{ value = $null; measured = $false; reason = ($InvalidReasonFormat -f $Value) }
    } else {
        $result = [ordered]@{ value = $Value; measured = $true; reason = $null }
    }
    if ($Source) { $result['source'] = $Source }
    return $result
}

function Get-SessionBaselineReport {
    [CmdletBinding()]
    param(
        [string] $CoordinatorUrl = 'http://127.0.0.1:8004',
        [string] $FixturePath,
        [Nullable[double]] $TtffMs,
        [Nullable[double]] $SessionCreationSuccessRate,
        [Parameter(Mandatory = $true)][string] $RepoRoot,
        [int] $ProbeTimeoutSec = 5,
        [datetime] $Now = (Get-Date).ToUniversalTime(),
        [scriptblock] $NvidiaSmiQuery,
        [scriptblock] $NvidiaSmiComputeAppsQuery,
        [scriptblock] $WebRtcHealthInvoker,
        [switch] $SkipWebRtcProbe
    )

    $gpuInventoryArgs = @{}
    if ($NvidiaSmiQuery) { $gpuInventoryArgs['NvidiaSmiQuery'] = $NvidiaSmiQuery }
    $gpuInventory = Get-GpuInventorySnapshot @gpuInventoryArgs

    $computeArgs = @{}
    if ($NvidiaSmiComputeAppsQuery) { $computeArgs['NvidiaSmiComputeAppsQuery'] = $NvidiaSmiComputeAppsQuery }
    $computeSnapshot = Get-GpuComputeProcessSnapshot @computeArgs

    $kitVersion = Get-KitVersionFingerprint -RepoRoot $RepoRoot
    $fixtureFingerprint = Get-FixtureFingerprint -FixturePath $FixturePath

    if ($SkipWebRtcProbe) {
        $webRtcProbe = [ordered]@{
            measured                          = $false
            coordinator_url                   = $CoordinatorUrl
            reachable                         = $false
            status_code                       = $null
            service_status                    = $null
            kit_signaling_port                = $null
            webrtc_signaling_probed           = $false
            probe_scope                       = 'coordinator_only'
            runtime_status_reachable          = $false
            active_session_count              = $null
            observed_primary_lease_count      = $null
            observed_spectator_lease_count    = $null
            active_kit_instance_binding_count = $null
            error                             = $null
            note                              = 'probe skipped by caller (-SkipWebRtcProbe)'
        }
    } else {
        $probeArgs = @{ CoordinatorUrl = $CoordinatorUrl; TimeoutSec = $ProbeTimeoutSec }
        if ($WebRtcHealthInvoker) { $probeArgs['HealthInvoker'] = $WebRtcHealthInvoker }
        $webRtcProbe = Get-WebRtcHealthProbe @probeArgs
    }

    $vramWatermark = Get-SessionVramWatermark `
        -GpuComputeSnapshot $computeSnapshot `
        -ObservedActiveSessionCount $webRtcProbe.active_session_count `
        -ObservedPrimaryLeaseCount $webRtcProbe.observed_primary_lease_count `
        -ObservedSpectatorLeaseCount $webRtcProbe.observed_spectator_lease_count
    $environmentFingerprint = Get-EnvironmentFingerprint -GpuInventory $gpuInventory -KitVersion $kitVersion -FixtureFingerprint $fixtureFingerprint

    $ttff = New-OptionalMeasurement `
        -Value $TtffMs `
        -MissingReason 'read-only harness does not open a WebRTC session; TTFF requires a live session capture (task 1.3 soak, or a manual measurement) supplied via -TtffMs' `
        -Source 'caller_supplied' `
        -Validator { param($v) ([double]$v -ge 0) } `
        -InvalidReasonFormat 'rejected caller-supplied TTFF value {0}: time-to-first-frame cannot be negative'
    $successRate = New-OptionalMeasurement `
        -Value $SessionCreationSuccessRate `
        -MissingReason 'read-only harness does not create sessions; success rate requires repeated live session-creation trials supplied via -SessionCreationSuccessRate' `
        -Source 'caller_supplied' `
        -Validator { param($v) (([double]$v -ge 0) -and ([double]$v -le 1)) } `
        -InvalidReasonFormat 'rejected caller-supplied session creation success rate {0}: a rate must lie within [0,1]'

    $capturedAt = $Now.ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
    $runSuffix = ('{0:x2}{1:x2}{2:x2}' -f (Get-Random -Maximum 256), (Get-Random -Maximum 256), (Get-Random -Maximum 256))
    $runId = 'measure_{0}_{1}' -f $Now.ToString('yyyyMMdd_HHmmss'), $runSuffix

    # [System.Net.Dns]::GetHostName() works on Windows, Linux and macOS;
    # COMPUTERNAME is Windows-only and HOSTNAME is the common POSIX-shell
    # fallback, so try the portable API first and degrade honestly.
    $hostName = $null
    try { $hostName = [System.Net.Dns]::GetHostName() } catch { $hostName = $null }
    if ([string]::IsNullOrWhiteSpace($hostName)) { $hostName = $env:COMPUTERNAME }
    if ([string]::IsNullOrWhiteSpace($hostName)) { $hostName = $env:HOSTNAME }

    $hostInfo = [ordered]@{
        hostname            = $hostName
        os                  = [string][System.Environment]::OSVersion.VersionString
        powershell_version  = $PSVersionTable.PSVersion.ToString()
    }

    $report = [ordered]@{
        schema_version           = 'gpu-session-baseline-report/v1'
        run_id                   = $runId
        captured_at              = $capturedAt
        host                     = $hostInfo
        environment_fingerprint  = $environmentFingerprint
        gpu_inventory            = $gpuInventory
        session_vram_watermark   = $vramWatermark
        webrtc_health_probe      = $webRtcProbe
        ttff_ms                  = $ttff
        session_creation_success_rate = $successRate
    }
    return $report
}
