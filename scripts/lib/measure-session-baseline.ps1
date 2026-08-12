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
    #
    # The leading comma on array-typed values (below) is load-bearing, not
    # decorative: `return $value` on an EMPTY array is unrolled by
    # PowerShell's pipeline into zero output objects, which a caller doing
    # `$x = Get-SafeProperty ...` then silently collapses to $null --
    # indistinguishable from "the property was absent" and exactly the kind
    # of false-negative this harness's honesty contract cannot tolerate (an
    # observed empty collection, e.g. `kit_instance_bindings: []`, is a real
    # zero, not "unmeasured"). `,$value` prevents the unroll for both empty
    # and non-empty collections; scalars are excluded from the wrap since
    # they were never subject to the unroll bug and PowerShell's pipeline
    # capture boxes a -isnot-array scalar differently once wrapped.
    [CmdletBinding()]
    param($Object, [Parameter(Mandatory = $true)][string] $Name)
    if ($null -eq $Object) { return $null }
    if ($Object -is [System.Collections.IDictionary]) {
        if ($Object.Contains($Name)) {
            $dictValue = $Object[$Name]
            if ($dictValue -is [System.Collections.IEnumerable] -and $dictValue -isnot [string]) { return , $dictValue }
            return $dictValue
        }
        return $null
    }
    $prop = $Object.PSObject.Properties[$Name]
    if ($null -eq $prop) { return $null }
    $value = $prop.Value
    if ($value -is [System.Collections.IEnumerable] -and $value -isnot [string]) { return , $value }
    return $value
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

    # This reads the checkout's DECLARED kit-kernel dependency version, not a
    # value read from the live Kit process. If the checkout was updated after
    # the running Kit build was last built/restarted, this value can be stale
    # relative to the session actually being measured -- no local mechanism
    # exists to introspect a running Kit.exe's build identity from outside,
    # so this caveat travels with the field instead of being silently assumed
    # away. See PR #511 review discussion.
    $caveat = "this is the checkout's declared kit-kernel dependency version (bim-streaming-server/tools/deps/kit-sdk.packman.xml); it is not read from the live Kit process and does not verify the running build was produced from this exact checkout revision -- if the checkout changed without a rebuild/restart, this value can be stale relative to the measured session"

    $packmanPath = Join-Path $RepoRoot 'bim-streaming-server\tools\deps\kit-sdk.packman.xml'
    if (-not (Test-Path -LiteralPath $packmanPath -PathType Leaf)) {
        return [ordered]@{ value = $null; measured = $false; reason = "kit-sdk.packman.xml not found at $packmanPath"; source_path = $packmanPath; source = 'checkout_packman_declared'; caveat = $caveat }
    }
    try {
        $content = Get-Content -LiteralPath $packmanPath -Raw
    } catch {
        return [ordered]@{ value = $null; measured = $false; reason = "failed to read $($packmanPath): $($_.Exception.Message)"; source_path = $packmanPath; source = 'checkout_packman_declared'; caveat = $caveat }
    }
    $match = [regex]::Match($content, 'name="kit-kernel"\s+version="(?<version>[0-9]+\.[0-9]+\.[0-9]+)')
    if (-not $match.Success) {
        return [ordered]@{ value = $null; measured = $false; reason = 'kit-kernel version token not found in kit-sdk.packman.xml'; source_path = $packmanPath; source = 'checkout_packman_declared'; caveat = $caveat }
    }
    return [ordered]@{ value = $match.Groups['version'].Value; measured = $true; reason = $null; source_path = $packmanPath; source = 'checkout_packman_declared'; caveat = $caveat }
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

    $activeSessionCount = $null
    $sessionCountAtCapture = $null
    $activeBindingCount = $null
    $primaryViewerLeaseCount = $null
    $spectatorViewerLeaseCount = $null
    if ($runtimeResult.ok -and $runtimeResult.body) {
        $sessionsValue = Get-SafeProperty -Object $runtimeResult.body -Name 'sessions'
        if ($null -ne $sessionsValue) {
            $activeSessionCount = Get-SafeProperty -Object $sessionsValue -Name 'active_count'
            $sessionCountAtCapture = Get-SafeProperty -Object $sessionsValue -Name 'count'
            $sessionItems = Get-SafeProperty -Object $sessionsValue -Name 'items'
            if ($null -ne $sessionItems) {
                # sessions.active_count is a SESSION cardinality (one review
                # session is "1" whether it has zero or many spectators), not
                # the 1-primary-plus-k-spectator viewer cardinality the spec
                # requires. Count active viewer_leases by role instead so
                # primary/spectator concurrency is recorded explicitly. This
                # aggregates across every session returned by
                # /api/runtime/status; when more than one session is active
                # at capture time (session_count_at_capture > 1) the two
                # counts below are ambiguous across sessions -- see `note`.
                $primaryViewerLeaseCount = 0
                $spectatorViewerLeaseCount = 0
                foreach ($sessionItem in @($sessionItems)) {
                    $viewerLeases = Get-SafeProperty -Object $sessionItem -Name 'viewer_leases'
                    foreach ($lease in @($viewerLeases)) {
                        if ($null -eq $lease) { continue }
                        if ((Get-SafeProperty -Object $lease -Name 'status') -ne 'active') { continue }
                        $role = Get-SafeProperty -Object $lease -Name 'role'
                        if ($role -eq 'primary') { $primaryViewerLeaseCount++ }
                        elseif ($role -eq 'spectator') { $spectatorViewerLeaseCount++ }
                    }
                }
            }
        }
        $bindingsValue = Get-SafeProperty -Object $runtimeResult.body -Name 'kit_instance_bindings'
        if ($null -ne $bindingsValue) {
            # KitInstanceBinding.status (bim-review-coordinator/src/types.ts)
            # is one of allocated|starting|ready|draining|released|failed --
            # 'active' is never a value the real API emits, so a literal
            # -eq 'active' predicate always counts zero even when usable
            # bindings exist. released/failed are terminal (no longer
            # holding GPU capacity); the rest still are.
            $nonTerminalBindingStatuses = @('allocated', 'starting', 'ready', 'draining')
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
        runtime_status_reachable          = [bool]$runtimeResult.ok
        active_session_count              = $activeSessionCount
        session_count_at_capture          = $sessionCountAtCapture
        active_kit_instance_binding_count = $activeBindingCount
        primary_viewer_lease_count        = $primaryViewerLeaseCount
        spectator_viewer_lease_count      = $spectatorViewerLeaseCount
        error                             = $errorMessage
        note                              = 'read-only GET /health and GET /api/runtime/status; does not create, join, or modify any review session. reachable reflects only whether the coordinator process answered GET /health (200) -- it is NOT independent verification that the Kit WebRTC/signaling endpoint itself is reachable: kit_signaling_port is coordinator-reported configuration echoed from /health, never dialed by this harness. active_session_count counts ALL sessions with status=active on this coordinator (not scoped to one review session); primary_viewer_lease_count / spectator_viewer_lease_count aggregate active viewer_leases by role across those sessions and are the more reliable observed k for the 1-primary-plus-k-spectator VRAM watermark (ambiguous when session_count_at_capture > 1).'
    }
}

function Get-SessionVramWatermark {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)] $GpuComputeSnapshot,
        $ObservedPrimaryViewerLeaseCount,
        $ObservedSpectatorViewerLeaseCount,
        $ObservedSessionCountAtCapture
    )

    $note = 'per-stream (primary vs spectator) VRAM split is not observable via nvidia-smi: Kit hosts all streams (1 primary + k spectator) inside a single GPU process, so only the combined process VRAM can be measured from outside Kit. total_kit_vram_mb is only populated when exactly one Kit GPU process is observed AND its VRAM column is readable -- nvidia-smi compute-apps carries no PID-to-review-session binding, so if more than one Kit workload (e.g. an IFC conversion Kit, another coordinator''s Kit instance) is running concurrently, or if some matched processes have an unreadable VRAM column, the arithmetic sum is exposed only as the informational unscoped_total_kit_vram_mb, never as a fabricated clean total. observed_primary_viewer_lease_count / observed_spectator_viewer_lease_count are aggregated across ALL active sessions on the coordinator (ambiguous when observed_session_count_at_capture > 1).'

    if (-not $GpuComputeSnapshot.measured) {
        return [ordered]@{
            measured                               = $false
            reason                                  = $GpuComputeSnapshot.reason
            kit_processes                           = @()
            kit_process_count                       = 0
            total_kit_vram_mb                       = $null
            unscoped_total_kit_vram_mb              = $null
            observed_primary_viewer_lease_count     = $ObservedPrimaryViewerLeaseCount
            observed_spectator_viewer_lease_count   = $ObservedSpectatorViewerLeaseCount
            observed_session_count_at_capture       = $ObservedSessionCountAtCapture
            note                                    = $note
        }
    }

    $kitProcesses = @($GpuComputeSnapshot.processes | Where-Object { $_.process_name -match '(?i)(^|[\\/])kit(\.exe)?$' })
    if ($kitProcesses.Count -eq 0) {
        return [ordered]@{
            measured                               = $false
            reason                                  = 'no active Kit GPU process observed at capture time (no live session running on this host right now)'
            kit_processes                           = @()
            kit_process_count                       = 0
            total_kit_vram_mb                       = $null
            unscoped_total_kit_vram_mb              = $null
            observed_primary_viewer_lease_count     = $ObservedPrimaryViewerLeaseCount
            observed_spectator_viewer_lease_count   = $ObservedSpectatorViewerLeaseCount
            observed_session_count_at_capture       = $ObservedSessionCountAtCapture
            note                                    = $note
        }
    }

    $measuredProcesses = @($kitProcesses | Where-Object { $_.used_memory_measured })
    $readableSum = $null
    if ($measuredProcesses.Count -gt 0) {
        # Manual sum (not Measure-Object -Property): the process entries are
        # ordered hashtables, and Measure-Object's -Property reflection does
        # not reliably resolve hashtable keys across PowerShell editions.
        $sum = 0
        foreach ($proc in $measuredProcesses) { $sum += [int]$proc.used_memory_mb }
        $readableSum = $sum
    }

    $reasonParts = [System.Collections.Generic.List[string]]::new()
    if ($kitProcesses.Count -gt 1) {
        $reasonParts.Add("$($kitProcesses.Count) Kit GPU processes observed at capture time; nvidia-smi carries no PID-to-review-session binding, so this host cannot be confirmed exclusive to the measured session")
    }
    if ($measuredProcesses.Count -lt $kitProcesses.Count) {
        $unreadableCount = $kitProcesses.Count - $measuredProcesses.Count
        $reasonParts.Add("$unreadableCount of $($kitProcesses.Count) matched Kit process(es) had an unreadable VRAM column (nvidia-smi compute-apps memory column requires elevated OS permission on this host)")
    }

    $totalVram = $null
    $unscopedTotalVram = $null
    if ($kitProcesses.Count -eq 1 -and $measuredProcesses.Count -eq 1) {
        $totalVram = $readableSum
    } else {
        $unscopedTotalVram = $readableSum
    }
    $reason = $null
    if ($reasonParts.Count -gt 0) { $reason = $reasonParts -join '; ' }

    return [ordered]@{
        measured                               = ($null -ne $totalVram)
        reason                                  = $reason
        kit_processes                           = $kitProcesses
        kit_process_count                       = $kitProcesses.Count
        total_kit_vram_mb                       = $totalVram
        unscoped_total_kit_vram_mb              = $unscopedTotalVram
        observed_primary_viewer_lease_count     = $ObservedPrimaryViewerLeaseCount
        observed_spectator_viewer_lease_count   = $ObservedSpectatorViewerLeaseCount
        observed_session_count_at_capture       = $ObservedSessionCountAtCapture
        note                                    = $note
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

    $parsedGpuRows = @()
    if ($GpuInventory.measured) { $parsedGpuRows = @($GpuInventory.gpus | Where-Object { $_.parse_ok }) }

    if ($parsedGpuRows.Count -eq 1) {
        $primaryGpu = $parsedGpuRows[0]
        $gpuModel = $primaryGpu.name
        $gpuModelMeasured = $true
        $gpuModelReason = $null
        $gpuDriver = $primaryGpu.driver_version
        $gpuDriverMeasured = $true
        $gpuDriverReason = $null
    } elseif ($parsedGpuRows.Count -gt 1) {
        # nvidia-smi --query-compute-apps carries no GPU index/UUID, so on a
        # multi-GPU host this harness cannot attribute the measured Kit
        # process's VRAM sample to a specific GPU row. Blindly taking
        # gpus[0] would silently bind the fingerprint to the wrong device
        # whenever Kit is not running on the first-enumerated GPU -- fail
        # closed instead of guessing (see PR #511 review discussion).
        $gpuModelReason = "host reports $($parsedGpuRows.Count) GPUs and this harness cannot attribute the measured Kit process to a specific one (nvidia-smi compute-apps query carries no GPU index/UUID); fingerprint left unmeasured to avoid binding to the wrong device"
        $gpuDriverReason = $gpuModelReason
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
        kit_version         = [ordered]@{
            value    = $KitVersion.value
            measured = $KitVersion.measured
            reason   = $KitVersion.reason
            source   = (Get-SafeProperty -Object $KitVersion -Name 'source')
            caveat   = (Get-SafeProperty -Object $KitVersion -Name 'caveat')
        }
        fixture_hash        = [ordered]@{ value = $FixtureFingerprint.hash; measured = $FixtureFingerprint.hash_measured; reason = $FixtureFingerprint.hash_reason }
        fixture_size_bytes  = [ordered]@{ value = $FixtureFingerprint.size_bytes; measured = $FixtureFingerprint.size_measured; reason = $FixtureFingerprint.size_reason }
    }
    $allMeasured = $true
    foreach ($key in @($fields.Keys)) {
        if (-not $fields[$key].measured) { $allMeasured = $false }
    }
    $fields['complete'] = $allMeasured
    return $fields
}

function New-OptionalMeasurement {
    [CmdletBinding()]
    param($Value, [string] $MissingReason)
    if ($null -ne $Value) {
        return [ordered]@{ value = $Value; measured = $true; reason = $null }
    }
    return [ordered]@{ value = $null; measured = $false; reason = $MissingReason }
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
            runtime_status_reachable          = $false
            active_session_count              = $null
            session_count_at_capture          = $null
            active_kit_instance_binding_count = $null
            primary_viewer_lease_count        = $null
            spectator_viewer_lease_count      = $null
            error                             = $null
            note                              = 'probe skipped by caller (-SkipWebRtcProbe)'
        }
    } else {
        $probeArgs = @{ CoordinatorUrl = $CoordinatorUrl; TimeoutSec = $ProbeTimeoutSec }
        if ($WebRtcHealthInvoker) { $probeArgs['HealthInvoker'] = $WebRtcHealthInvoker }
        $webRtcProbe = Get-WebRtcHealthProbe @probeArgs
    }

    $vramWatermark = Get-SessionVramWatermark -GpuComputeSnapshot $computeSnapshot `
        -ObservedPrimaryViewerLeaseCount $webRtcProbe.primary_viewer_lease_count `
        -ObservedSpectatorViewerLeaseCount $webRtcProbe.spectator_viewer_lease_count `
        -ObservedSessionCountAtCapture $webRtcProbe.session_count_at_capture
    $environmentFingerprint = Get-EnvironmentFingerprint -GpuInventory $gpuInventory -KitVersion $kitVersion -FixtureFingerprint $fixtureFingerprint

    # Caller-supplied TTFF / success-rate values are external input like any
    # coordinator response: honor the same "never fabricate" contract by
    # range-validating before accepting them as measured, instead of trusting
    # them blindly (a negative TTFF or a success rate outside [0,1] is never
    # a real measurement and must not be recorded as measured:true).
    $ttffRejectReason = $null
    $ttffValue = $TtffMs
    if ($null -ne $ttffValue -and $ttffValue -lt 0) {
        $ttffRejectReason = "supplied -TtffMs ($ttffValue) is negative; time-to-first-frame cannot be negative -- value rejected rather than fabricated as measured"
        $ttffValue = $null
    }
    $ttffMissingReason = 'read-only harness does not open a WebRTC session; TTFF requires a live session capture (task 1.3 soak, or a manual measurement) supplied via -TtffMs'
    if ($ttffRejectReason) { $ttffMissingReason = $ttffRejectReason }
    $ttff = New-OptionalMeasurement -Value $ttffValue -MissingReason $ttffMissingReason

    $successRateRejectReason = $null
    $successRateValue = $SessionCreationSuccessRate
    if ($null -ne $successRateValue -and ($successRateValue -lt 0 -or $successRateValue -gt 1)) {
        $successRateRejectReason = "supplied -SessionCreationSuccessRate ($successRateValue) is outside the valid [0,1] range -- value rejected rather than fabricated as measured"
        $successRateValue = $null
    }
    $successRateMissingReason = 'read-only harness does not create sessions; success rate requires repeated live session-creation trials supplied via -SessionCreationSuccessRate'
    if ($successRateRejectReason) { $successRateMissingReason = $successRateRejectReason }
    $successRate = New-OptionalMeasurement -Value $successRateValue -MissingReason $successRateMissingReason

    $capturedAt = $Now.ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
    $runSuffix = ('{0:x2}{1:x2}{2:x2}' -f (Get-Random -Maximum 256), (Get-Random -Maximum 256), (Get-Random -Maximum 256))
    $runId = 'measure_{0}_{1}' -f $Now.ToString('yyyyMMdd_HHmmss'), $runSuffix

    # $env:COMPUTERNAME is a Windows-only environment variable and is
    # normally unset on the canonical Linux deployment target, which would
    # otherwise silently null out host identity on every Linux-captured
    # report. Resolve via the cross-platform Dns API first, falling back to
    # $env:HOSTNAME (set on Linux/macOS shells), then COMPUTERNAME.
    $hostname = $null
    try { $hostname = [System.Net.Dns]::GetHostName() } catch { $hostname = $null }
    if ([string]::IsNullOrWhiteSpace($hostname)) { $hostname = $env:HOSTNAME }
    if ([string]::IsNullOrWhiteSpace($hostname)) { $hostname = $env:COMPUTERNAME }

    $hostInfo = [ordered]@{
        hostname            = $hostname
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
