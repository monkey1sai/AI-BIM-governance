# scripts\lib\host-native-launcher.ps1
# Host-native process launcher:抽自 start-all.ps1 line 217-260 的
# Test-AlreadyRunning / Start-LocalService / Wait-Health,讓 deploy.ps1
# 與其他入口共用。Start-* 函數有副作用(啟 process / 寫 PID file / 寫 log)。

Set-StrictMode -Version Latest

# Per-OS primitives (venv layout, system interpreter, platform name). Guarded so
# this lib stays dot-sourceable standalone in tests.
if (-not (Get-Command -Name 'Resolve-PlatformVenvPython' -ErrorAction SilentlyContinue)) {
    . (Join-Path $PSScriptRoot 'platform/platform-adapter.ps1')
}
if (-not (Get-Command -Name 'Get-DeployTargetForCurrentPlatform' -ErrorAction SilentlyContinue)) {
    . (Join-Path $PSScriptRoot 'deploy-target-registry.ps1')
}
# Launch-time OS containment boundary (issue #522). Guarded like the adapters so
# this lib stays dot-sourceable standalone in tests.
if (-not (Get-Command -Name 'Test-HostNativeJobBoundarySupported' -ErrorAction SilentlyContinue)) {
    . (Join-Path $PSScriptRoot 'host-native-job-boundary.ps1')
}

function Resolve-HostNativePython {
    # Single interpreter-selection rule for every host-native service. The three
    # launchers each had their own copy hardcoding the Windows venv layout
    # (.venv\Scripts\python.exe), which never matches on Linux (.venv/bin/python),
    # so they all fell through to the bare name 'python' - which the Linux target
    # does not have. Start-Process then produced no process and the failure only
    # surfaced as a health-check timeout 30 seconds later.
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string] $RepoRoot,
        [Parameter(Mandatory = $true)][string] $ServiceName
    )
    $venvPython = Resolve-PlatformVenvPython -VenvRoot (Join-Path $RepoRoot '.venv')
    if (Test-Path -LiteralPath $venvPython -PathType Leaf) { return $venvPython }
    $systemPython = Resolve-PlatformSystemPython
    if ($systemPython) { return $systemPython }
    throw "${ServiceName}: no usable Python interpreter (looked for the repo venv at $venvPython and a system python on PATH)."
}

function Get-HostNativePowerShellExe {
    # powershell.exe is Windows-only; the cross-platform executable is pwsh.
    # -Platform is injectable so both branches are testable from either OS.
    param([string] $Platform = (Get-PlatformName))
    if ($Platform -eq 'windows') { return 'powershell.exe' }
    return 'pwsh'
}

function Get-HostNativePowerShellArgumentPrefix {
    param([string] $Platform = (Get-PlatformName))
    # Standard prefix for launching one of our .ps1 files as a child process.
    # -ExecutionPolicy is a Windows-only concept and pwsh rejects it elsewhere, so
    # it is only emitted there. Callers append -File <script> and their own args.
    #
    # CONTRACT: callers MUST wrap the call in @() - `@(Get-...Prefix) + @('-File', ...)`.
    # Two failure modes bracket this, and both have shipped:
    #   - a bare call without @(): off Windows the single-element result unrolls to a
    #     string, `+` becomes string concatenation, and the child gets '-NoProfile-File'.
    #   - returning `,@(...)` to defeat that: @() around it then yields a NESTED array,
    #     and Start-Process rejects it with "Cannot convert 'System.Object[]' to the
    #     type 'System.String' required by parameter 'ArgumentList'".
    # So: emit a plain array here, and let the caller's @() do the normalising.
    # test-host-native-child-launch.ps1 asserts the composed argv is FLAT, which is
    # the property that actually matters and which catches both shapes.
    if ($Platform -eq 'windows') {
        return @('-NoProfile', '-ExecutionPolicy', 'Bypass')
    }
    return @('-NoProfile')
}

function Get-HostNativeBindHost {
    # Which address host-native services listen on. Windows keeps loopback; on a
    # Linux target the dockerised coordinator reaches them over the bridge, and a
    # 127.0.0.1-only socket refuses that connection - governance and
    # kit-manager-api were unreachable from the container (coordinator
    # /api/governance/files/tree returned 502) while the conversion service, which
    # already bound a reachable address, answered from the Docker bridge.
    # Measured from inside the container: the target-scoped bridge address was
    # reachable while the owner-private host address refused the loopback bind.
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string] $RepoRoot)

    $target = Get-DeployTargetForCurrentPlatform -RepoRoot $RepoRoot
    $bind = [string]$target.host_native_bind_host
    if ([string]::IsNullOrWhiteSpace($bind)) {
        throw "deploy target '$($target.id)' does not declare host_native_bind_host."
    }
    return $bind
}

function Test-HostNativeLocalAddress {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string] $HostName)

    $normalized = $HostName.Trim().Trim([char[]]'[]').ToLowerInvariant()
    if ($normalized -eq 'localhost') { return $true }
    $address = $null
    if (-not [System.Net.IPAddress]::TryParse($normalized, [ref]$address)) {
        # Do not resolve arbitrary DNS here: a DNS answer is not proof that the
        # conversion authority is bound to this host and can introduce rebinding.
        return $false
    }
    if ([System.Net.IPAddress]::IsLoopback($address)) { return $true }
    foreach ($networkInterface in [System.Net.NetworkInformation.NetworkInterface]::GetAllNetworkInterfaces()) {
        foreach ($unicast in $networkInterface.GetIPProperties().UnicastAddresses) {
            if ($unicast.Address.Equals($address)) { return $true }
        }
    }
    return $false
}

function Resolve-HostNativeKitControlUrl {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][AllowEmptyString()][string] $KitControlUrl,
        [scriptblock] $LocalAddressProbeFn = {
            param($HostName)
            return (Test-HostNativeLocalAddress -HostName $HostName)
        }
    )

    if ([string]::IsNullOrWhiteSpace($KitControlUrl)) { return '' }

    $kitControlUri = $null
    if (-not [uri]::TryCreate($KitControlUrl, [System.UriKind]::Absolute, [ref]$kitControlUri) -or
        $kitControlUri.Scheme -ne 'http' -or
        [string]::IsNullOrWhiteSpace($kitControlUri.Host) -or
        -not [string]::IsNullOrWhiteSpace($kitControlUri.UserInfo) -or
        -not [string]::IsNullOrWhiteSpace($kitControlUri.Query) -or
        -not [string]::IsNullOrWhiteSpace($kitControlUri.Fragment) -or
        -not ($kitControlUri.AbsolutePath -eq '' -or $kitControlUri.AbsolutePath -eq '/')) {
        throw 'KitControlUrl must be an origin-only absolute HTTP URL without credentials, path, query, or fragment.'
    }
    if (-not (& $LocalAddressProbeFn $kitControlUri.Host)) {
        throw 'KitControlUrl host must be loopback or an address assigned to this host.'
    }
    return $kitControlUri.GetLeftPart([System.UriPartial]::Authority).TrimEnd('/')
}

function Test-AlreadyRunning {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string] $Name,
        [Parameter(Mandatory = $true)][string] $RunDir,
        [scriptblock] $GetProcessFn = {
            param($procId)
            try { Get-Process -Id $procId -ErrorAction Stop } catch { $null }
        }
    )
    $pidFile = Join-Path $RunDir "$Name.pid"
    if (-not (Test-Path -LiteralPath $pidFile)) { return $false }
    $raw = Get-Content -LiteralPath $pidFile -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $raw) { return $false }
    $procId = 0
    if (-not [int]::TryParse($raw.Trim(), [ref]$procId)) { return $false }
    return ($null -ne (& $GetProcessFn $procId))
}

function Get-HostNativeServiceListenPorts {
    # The TCP ports the LAST launch of this service declared it would own, read
    # back from the <Name>.ports sidecar. Empty when no launch ever declared any.
    #
    # This sidecar exists because the pid file cannot answer the question that
    # matters (#640). Liveness is recorded as the LAUNCHER's pid, but the thing
    # holding the ports, the GPU context and the Omniverse user directory is its
    # CHILD - for the Kit service, a `kit` process started by the pwsh wrapper.
    # When the wrapper dies and the child is orphaned, Remove-StalePidFile
    # correctly deletes the pid file (the recorded pid really is gone) and the
    # only record that ANY instance is still holding those resources disappears
    # with it. The sidecar deliberately outlives the pid file so the surviving
    # child stays visible; only a deliberate stop removes it.
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string] $Name,
        [Parameter(Mandatory = $true)][string] $RunDir
    )
    $portFile = Join-Path $RunDir "$Name.ports"
    if (-not (Test-Path -LiteralPath $portFile -PathType Leaf)) { return @() }
    $ports = @()
    foreach ($line in @(Get-Content -LiteralPath $portFile -ErrorAction SilentlyContinue)) {
        $text = ([string]$line).Trim()
        if ([string]::IsNullOrWhiteSpace($text)) { continue }
        $port = 0
        # A malformed line is dropped rather than thrown on: this record is read
        # on the start path, and a corrupt sidecar must not make the deploy
        # unrunnable. The caller's ExpectedPorts still cover the current config.
        if ([int]::TryParse($text, [ref]$port) -and $port -ge 1 -and $port -le 65535) {
            if ($ports -notcontains $port) { $ports += $port }
        }
    }
    return @($ports)
}

function Get-HostNativeOrphanListener {
    # Fail-closed answer to "is something OTHER than this service's recorded
    # process tree still holding the ports this service owns?" - $null when the
    # answer is no, a report object when it is yes.
    #
    # Phase 1 of the deploy already SAW the orphan in the failure this fixes
    # ("port TCP/49150 occupied by our PID 188705 (kit.exe) - already running,
    # will skip start") but that observation never reached the start decision:
    # Phase 4c asked the pid file instead, the pid file had just been deleted as
    # stale, and a second Kit was launched into the live one. This function is
    # the observation the start decision can actually consume.
    #
    # "Accounted for" is deliberately narrow: the pid file must exist, its
    # recorded process must still be alive, and the listener must be that
    # process or one of its descendants. Everything else - no pid file, a dead
    # recorded pid, an unrelated holder, or a listener whose owner the OS will
    # not reveal (Get-PlatformTcpListenerPid returns -1) - is unaccounted and
    # therefore a hard stop. Refusing is the safe direction: the caller can only
    # ever choose between "refuse" and "start a second instance into a live one".
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string] $Name,
        [Parameter(Mandatory = $true)][string] $RunDir,
        # The ports THIS run intends to use. Unioned with the recorded ports so a
        # config change cannot hide an orphan that is still holding the previous
        # instance's ports, and so a first-ever launch is covered too.
        [AllowEmptyCollection()][int[]] $ExpectedPorts = @(),
        [scriptblock] $PortLookupFn = {
            param($port)
            Get-PlatformTcpListenerPid -Port ([int]$port)
        },
        [scriptblock] $GetProcessFn = {
            param($procId)
            try { Get-Process -Id $procId -ErrorAction Stop } catch { $null }
        },
        [scriptblock] $ChildPidLookup = {
            param($parentId)
            @(Get-PlatformChildProcessIds -ParentProcessId ([int]$parentId))
        },
        # Phase 4c also reaches this gate straight after deliberately stopping
        # the previous tree (runtime parameters changed). A force-killed process
        # does not release its listening socket at the instant the stop call
        # returns, and turning that teardown window into a hard deploy failure
        # would trade one flaky outcome for another. So a holder must still be
        # there after this budget before it counts. Zero means answer on the
        # first observation.
        [ValidateRange(0, 60000)][int] $SettleTimeoutMs = 3000,
        [scriptblock] $SleepFn = {
            param($milliseconds)
            Start-Sleep -Milliseconds ([int]$milliseconds)
        }
    )

    $recordedPorts = @(Get-HostNativeServiceListenPorts -Name $Name -RunDir $RunDir)
    $ports = @(@(@($recordedPorts) + @($ExpectedPorts)) |
        ForEach-Object { [int]$_ } |
        Where-Object { $_ -ge 1 -and $_ -le 65535 } |
        Sort-Object -Unique)
    if ($ports.Count -eq 0) { return $null }

    $pidFile = Join-Path $RunDir "$Name.pid"
    $budget = [System.Diagnostics.Stopwatch]::StartNew()
    $accounted = @{}
    $recordedProcessId = 0
    $orphanPorts = @()
    $orphanProcessIds = @()
    while ($true) {
        # Descendants of a LIVE recorded pid are ours. A dead recorded pid is
        # expanded from nothing on purpose: on Linux the kernel re-parents the
        # orphan, so the ppid link back to a dead launcher is gone and expanding
        # from it would silently claim whatever later inherited that pid.
        # Re-read every pass: the tree can still be dying underneath us.
        $accounted = @{}
        $recordedProcessId = 0
        if (Test-Path -LiteralPath $pidFile -PathType Leaf) {
            $raw = Get-Content -LiteralPath $pidFile -ErrorAction SilentlyContinue | Select-Object -First 1
            if ($raw -and [int]::TryParse(([string]$raw).Trim(), [ref]$recordedProcessId)) {
                if ($null -ne (& $GetProcessFn $recordedProcessId)) {
                    $stack = @([int]$recordedProcessId)
                    while ($stack.Count -gt 0) {
                        $current = [int]$stack[0]
                        $stack = @($stack | Select-Object -Skip 1)
                        if ($accounted.ContainsKey($current)) { continue }
                        $accounted[$current] = $true
                        # Enumeration failure is fatal here, exactly as it is in
                        # Stop-HostNativeService: a tree we cannot enumerate must
                        # never be used to clear a start decision.
                        $stack += @(& $ChildPidLookup $current)
                    }
                }
            }
        }

        $orphanPorts = @()
        $orphanProcessIds = @()
        foreach ($port in $ports) {
            $listenerProcessId = & $PortLookupFn ([int]$port)
            if ($null -eq $listenerProcessId) { continue }
            $listenerProcessId = [int]$listenerProcessId
            if ($accounted.ContainsKey($listenerProcessId)) { continue }
            $orphanPorts += [int]$port
            if ($orphanProcessIds -notcontains $listenerProcessId) { $orphanProcessIds += $listenerProcessId }
        }
        if ($orphanPorts.Count -eq 0) { return $null }
        if ($budget.ElapsedMilliseconds -ge $SettleTimeoutMs) { break }
        & $SleepFn 250
    }

    return [pscustomobject]@{
        Name          = $Name
        Ports         = @($orphanPorts)
        ProcessIds    = @($orphanProcessIds)
        RecordedPorts = @($recordedPorts)
        RecordedPid   = [int]$recordedProcessId
        AccountedPids = @(@($accounted.Keys) | ForEach-Object { [int]$_ } | Sort-Object)
    }
}

function Remove-StalePidFile {
    # Removes ONLY the pid file, and only when the pid it records is gone.
    #
    # It deliberately leaves the <Name>.ports sidecar in place (#640). Deleting
    # it here would be the exact fail-open this repo already shipped: a dead
    # launcher whose Kit child is still alive would lose its last trace, and the
    # next Phase 4c would read "nothing is running" and start a second instance
    # into the live one. Only a deliberate stop clears that record.
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string] $Name,
        [Parameter(Mandatory = $true)][string] $RunDir,
        [scriptblock] $GetProcessFn = {
            param($procId)
            try { Get-Process -Id $procId -ErrorAction Stop } catch { $null }
        }
    )
    $pidFile = Join-Path $RunDir "$Name.pid"
    if (-not (Test-Path -LiteralPath $pidFile)) { return $false }
    $raw = Get-Content -LiteralPath $pidFile -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $raw) {
        Remove-Item -LiteralPath $pidFile -Force
        return $true
    }
    $procId = 0
    if ([int]::TryParse($raw.Trim(), [ref]$procId)) {
        if ($null -eq (& $GetProcessFn $procId)) {
            Remove-Item -LiteralPath $pidFile -Force
            return $true
        }
    }
    return $false
}

function Stop-HostNativeService {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string] $Name,
        [Parameter(Mandatory = $true)][string] $RunDir,
        # Win32_Process is Windows-only: on Linux the CIM call threw, the catch
        # returned an empty list, and the tree walk silently degraded to killing
        # only the wrapper - leaving uvicorn/Kit children holding their ports.
        # The adapter reads /proc there and CIM here.
        [scriptblock] $ChildPidLookup = {
            param($parentId)
            @(Get-PlatformChildProcessIds -ParentProcessId ([int]$parentId))
        },
        [scriptblock] $StopProcessFn = {
            param($procId)
            Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
        },
        # Job-first stop (issue #522): when the launch recorded a job boundary,
        # membership - not PPID discovery - is the containment authority.
        [scriptblock] $JobStopFn = {
            param($jobName)
            Stop-HostNativeJobBoundary -Name $jobName -TimeoutMs 5000
        }
    )
    $pidFile = Join-Path $RunDir "$Name.pid"
    $jobFile = Join-Path $RunDir "$Name.job"
    # The port record is a claim on resources, so a DELIBERATE stop is what
    # releases it (#640). Every return path below removes it: after this call the
    # service is either gone or it threw, and in neither case may a later start
    # decision keep treating the old claim as live.
    $portFile = Join-Path $RunDir "$Name.ports"

    # Job-first: a recorded boundary makes the stop authoritative. Found+Proven
    # terminated the whole membership set; Found=$false is proven-dead by
    # construction (the anchor handle lives exactly as long as the root, so a
    # missing job means no member survived). An unproven survivor THROWS inside
    # Stop-HostNativeJobBoundary - deliberately not swallowed here. A run whose
    # platform cannot open jobs (Supported=$false) falls through to the sweep.
    if (Test-Path -LiteralPath $jobFile) {
        $jobName = (Get-Content -LiteralPath $jobFile -ErrorAction SilentlyContinue | Select-Object -First 1)
        if ($jobName) {
            $jobReport = & $JobStopFn ([string]$jobName.Trim())
            if ($jobReport.Supported) {
                Remove-Item -LiteralPath $jobFile -Force -ErrorAction SilentlyContinue
                Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
                Remove-Item -LiteralPath $portFile -Force -ErrorAction SilentlyContinue
                return $true
            }
        }
        Remove-Item -LiteralPath $jobFile -Force -ErrorAction SilentlyContinue
    }

    # The two $false returns below stopped NOTHING (no pid file, or a pid file we
    # cannot parse), so they must not clear the port claim either - that is the
    # orphan case, and erasing its last record here would recreate #640.
    if (-not (Test-Path -LiteralPath $pidFile)) { return $false }
    $raw = Get-Content -LiteralPath $pidFile -ErrorAction SilentlyContinue | Select-Object -First 1
    $procId = 0
    if (-not $raw -or -not [int]::TryParse($raw.Trim(), [ref]$procId)) {
        Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
        return $false
    }

    $ids = @()
    $stack = @($procId)
    while ($stack.Count -gt 0) {
        $current = [int]$stack[0]
        $stack = @($stack | Select-Object -Skip 1)
        if ($ids -notcontains $current) {
            $ids += $current
            $stack += @(& $ChildPidLookup $current)
        }
    }
    for ($i = $ids.Count - 1; $i -ge 0; $i--) {
        & $StopProcessFn ([int]$ids[$i])
    }
    Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $portFile -Force -ErrorAction SilentlyContinue
    return $true
}

function Start-HostNativeService {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string] $Name,
        [Parameter(Mandatory = $true)][string] $WorkingDirectory,
        [Parameter(Mandatory = $true)][string] $FilePath,
        [string[]] $ArgumentList = @(),
        [Parameter(Mandatory = $true)][string] $RunDir,
        # TCP ports this service's process TREE will own. Recorded as a sidecar
        # so liveness stops depending on the launcher pid alone (#640): the
        # holder is usually a child, and the child outlives the pid file.
        [AllowEmptyCollection()][int[]] $ListenPorts = @(),
        [ValidateSet('Hidden','Normal')] [string] $WindowStyle = 'Hidden',
        [ValidateRange(0, 30000)][int] $DetachTimeoutMs = 5000,
        [scriptblock] $DetachProbeFn = {
            param($processId)
            Test-PlatformProcessDetached -ProcessId ([int]$processId)
        },
        [scriptblock] $SleepFn = {
            param($milliseconds)
            Start-Sleep -Milliseconds $milliseconds
        },
        # Launch-time containment boundary ops (issue #522). Injectable as ONE
        # table so tests can prove ordering and the failure contract without a
        # real kernel object. Keys: Supported / Create / Assign / Anchor /
        # Terminate / Close - all required when the table is replaced.
        [hashtable] $JobBoundaryOps = @{
            Supported = { Test-HostNativeJobBoundarySupported }
            Create    = { param($jobName) New-HostNativeJobBoundary -Name $jobName }
            Assign    = { param($handle, $childId) Add-HostNativeJobBoundaryProcess -Handle $handle -ProcessId ([int]$childId) }
            Anchor    = { param($handle, $childId) Grant-HostNativeJobBoundaryAnchor -Handle $handle -ProcessId ([int]$childId) }
            Terminate = { param($handle) Stop-HostNativeJobBoundaryHandle -Handle $handle }
            Close     = { param($handle) Close-HostNativeJobBoundary -Handle $handle }
        }
    )

    if (-not (Test-Path -LiteralPath $RunDir)) {
        New-Item -ItemType Directory -Path $RunDir -Force | Out-Null
    }
    $logFile = Join-Path $RunDir "$Name.log"
    $errFile = "$logFile.err"
    $pidFile = Join-Path $RunDir "$Name.pid"
    $jobFile = Join-Path $RunDir "$Name.job"
    $portFile = Join-Path $RunDir "$Name.ports"

    # Written BEFORE the launch, not after (#640). This record is a claim, not an
    # observation: the moment Start-Process returns, a child may already be
    # binding these ports, and a launch that then fails its detach check must
    # still leave the claim behind for the next run's orphan preflight. Recording
    # it afterwards would reopen the same window the pid file already has.
    $declaredPorts = @(@($ListenPorts) | ForEach-Object { [int]$_ } | Where-Object { $_ -ge 1 -and $_ -le 65535 } | Sort-Object -Unique)
    if ($declaredPorts.Count -gt 0) {
        Set-Content -LiteralPath $portFile -Value ($declaredPorts -join [string][char]10) -Encoding ascii
    }
    else {
        # A service that declares no ports must not inherit a previous launch's
        # claim; a stale record would fail the next start closed for nothing.
        Remove-Item -LiteralPath $portFile -Force -ErrorAction SilentlyContinue
    }

    # Off Windows the service must OUTLIVE the session that started it: a remote
    # deploy runs over SSH, and a service that dies at disconnect makes the whole
    # "persistent deploy area" idea false. `setsid` makes the child its own session
    # leader so a terminal hangup cannot reach it, and it execs in place when the
    # caller is not already a process-group leader, preserving the PID we record.
    #
    # setsid alone is NOT sufficient here, and measuring beat assuming: with it in
    # place the services still died at disconnect. pwsh is installed from snap, so
    # its children land in
    #   /user.slice/user-<uid>.slice/user@<uid>.service/app.slice/snap.powershell...scope
    # and systemd stops user@<uid>.service on last logout unless the account has
    # lingering enabled - taking the whole scope with it. The deploy therefore also
    # requires `loginctl enable-linger`, which the Linux preflight checks.
    $launchExe = $FilePath
    $launchArgs = @($ArgumentList)
    if ((Get-PlatformName) -ne 'windows') {
        $launchArgs = @($FilePath) + @($ArgumentList)
        $launchExe = 'setsid'
    }

    $startArgs = @{
        FilePath               = $launchExe
        ArgumentList           = $launchArgs
        WorkingDirectory       = $WorkingDirectory
        RedirectStandardOutput = $logFile
        RedirectStandardError  = $errFile
        PassThru               = $true
    }
    # -WindowStyle is a Windows-only concept; PowerShell rejects it on Linux/macOS.
    if ((Get-PlatformName) -eq 'windows') { $startArgs.WindowStyle = $WindowStyle }

    $proc = Start-Process @startArgs
    # Fail closed on a start that produced no process. Start-Process can come back
    # empty (bad interpreter name, missing working directory) and the old code then
    # returned an object whose Pid was silently absent - the caller logged
    # "PID=" as [ok] and only the health probe noticed, 30 seconds later.
    if (-not $proc -or -not $proc.Id) {
        throw "$Name did not start: '$launchExe' produced no process (workdir=$WorkingDirectory, stderr=$errFile)."
    }

    # Launch-time containment boundary (issue #522), Windows only. Ordering is
    # load-bearing and happens BEFORE the detach probe so the pre-membership
    # window stays as small as Start-Process allows:
    #   create(named, kill-on-close) -> assign(child) -> anchor(duplicate the
    #   job handle INTO the child) -> close(our handle).
    # After the anchor the child's duplicated handle keeps the job alive, so
    # the deploy session exiting does not kill the service, while the root
    # dying reaps every remaining descendant via kill-on-close. A service this
    # launcher cannot contain must not run: any boundary failure terminates
    # the just-started tree and throws. POSIX keeps the setsid path unchanged
    # (real boundary tracked in #517).
    Remove-Item -LiteralPath $jobFile -Force -ErrorAction SilentlyContinue
    if ([bool](& $JobBoundaryOps.Supported)) {
        $jobName = Get-HostNativeJobBoundaryName -Name $Name
        $jobHandle = & $JobBoundaryOps.Create $jobName
        $boundaryEstablished = $false
        try {
            & $JobBoundaryOps.Assign $jobHandle $proc.Id
            & $JobBoundaryOps.Anchor $jobHandle $proc.Id
            $boundaryEstablished = $true
        }
        finally {
            if (-not $boundaryEstablished) {
                # Terminate reaps whatever DID make it into the job; the direct
                # stop covers the assign-failed case where the child is outside.
                try { & $JobBoundaryOps.Terminate $jobHandle } catch { }
                try { Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue } catch { }
            }
            & $JobBoundaryOps.Close $jobHandle
        }
        Set-Content -LiteralPath $jobFile -Value $jobName -Encoding ascii
    }
    # Verify the detachment actually happened rather than assuming it. If setsid
    # forked instead of exec'ing, the PID we are about to record is not the
    # service, and the service would die with the session anyway - both silent
    # failures that only show up long after the deploy reports success.
    $detached = $false
    $detachDeadline = [DateTime]::UtcNow.AddMilliseconds($DetachTimeoutMs)
    do {
        if (& $DetachProbeFn ([int]$proc.Id)) {
            $detached = $true
            break
        }
        if ([DateTime]::UtcNow -ge $detachDeadline) { break }
        & $SleepFn 100
    } while ($true)
    if (-not $detached) {
        throw "$Name started as PID $($proc.Id) but is not a session leader; it would die when the deploy session ends (stderr=$errFile)."
    }
    $proc.Id | Set-Content -LiteralPath $pidFile -Encoding ascii
    return [pscustomobject]@{ Name = $Name; Pid = $proc.Id; LogPath = $logFile; ErrPath = $errFile }
}

function Wait-HostNativeHealth {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string] $Name,
        [Parameter(Mandatory = $true)][string] $Url,
        [int] $TimeoutSec = 30,
        [scriptblock] $ProbeFn = {
            param($url)
            Invoke-WebRequest -Uri $url -TimeoutSec 3 -UseBasicParsing -ErrorAction Stop
        }
    )
    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    while ((Get-Date) -lt $deadline) {
        try {
            $r = & $ProbeFn $Url
            if ($r -and $r.StatusCode -eq 200) { return $true }
        } catch {
            # 繼續等
        }
        Start-Sleep -Milliseconds 500
    }
    return $false
}

function Invoke-KitRepoBuild {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string] $WorkingDirectory,
        [Parameter(Mandatory = $true)][string] $LogPath,
        [Parameter(Mandatory = $true)][string] $RunDir,
        [string] $BuildCommand = '',
        # repo.bat 底下的 Kit precache 工具鏈偶爾會留下未釋放 stdout/stderr handle
        # 的背景分支程序,讓 native process 的 stream redirect 卡住等 EOF 而非只等
        # repo.bat 本身結束(2026-07-01 實測:build 早已成功,但外層卡死 20+ 分鐘)。
        # 20 分鐘是官方「may take several minutes」訊息的保守上限,足夠涵蓋 cold
        # build,又能在真的卡住時及時失敗而非無限期掛住整條 deploy pipeline。
        [int] $TimeoutSec = 1200,
        [scriptblock] $StartProcessFn = {
            param($workingDirectory, $logPath, $buildCommand)
            # cmd.exe 自己做 `>` 檔案重導向(真實 Win32 file handle,不是
            # pipe),deploy.ps1 只用 WaitForExit(timeout) 等「process 本身」
            # 結束,不受孫行程持有的 handle 影響。
            # 用完整路徑呼叫 repo.bat,不用裸檔名——某些主機的 .bat/batfile
            # 副檔名關聯毀損時(`assoc .bat`/`ftype batfile` 回報 not found),
            # cmd.exe 對裸檔名的 PATHEXT 查找+啟動會直接回報 "not recognized
            # as an internal or external command"(即使 `where repo.bat`、
            # `dir`、`call repo.bat` 都找得到/看得到檔案)。完整路徑不經過
            # 這條關聯查找路徑,兩種主機狀態下都能正常執行(2026-07-06 實測)。
            $effectiveCommand = if ([string]::IsNullOrWhiteSpace($buildCommand)) {
                if ((Get-PlatformName) -eq 'windows') { '.\repo.bat build' } else { './repo.sh build' }
            } else { $buildCommand.Trim() }
            if ($effectiveCommand -eq '.\repo.bat build') {
                $repoBatPath = Join-Path $workingDirectory 'repo.bat'
                $cmdLine = "call `"$repoBatPath`" build > `"$logPath`" 2>&1"
                return Start-Process -FilePath 'cmd.exe' -ArgumentList @('/c', $cmdLine) `
                    -WorkingDirectory $workingDirectory -NoNewWindow -PassThru
            }
            if ($effectiveCommand -eq './repo.sh build') {
                $repoShPath = Join-Path $workingDirectory 'repo.sh'
                # Start-Process 會把 ArgumentList join 成單一 Arguments 字串再
                # 重新斷詞;含空白與引號的 -c 命令字串經這層重組後被切碎,bash
                # 實際收到的命令只剩 repo.sh 路徑本身 — repo.sh 以無參數印
                # usage 後 exit 0,build 參數與 log 重導向全數丟失(2026-08-11
                # 對 canonical Linux 部署機實測)。把整條命令寫進 wrapper 腳本,
                # 由 stdin 餵給 bash:命令列上一個參數都不剩,任何平台的引號
                # 重組(含 deploy_root 帶空白的情況)都碰不到它。
                $wrapperPath = Join-Path (Split-Path -Parent $logPath) 'kit-repo-build-launch.sh'
                # registry 允許 deploy_root 含 $、backtick 等字元;路徑內插進
                # wrapper 的 shell 雙引號前,先跳脫雙引號語境內僅有的四個特殊
                # 字元(\ $ ` "),否則 sh 會對路徑做參數/命令替換,執行或重導向
                # 到錯誤的位置。
                $shQuote = { param($s) $s -replace '([\\$`"])', '\$1' }
                $repoShQuoted = & $shQuote $repoShPath
                $logQuoted = & $shQuote $logPath
                [IO.File]::WriteAllText($wrapperPath, "#!/bin/sh`nexec `"$repoShQuoted`" build > `"$logQuoted`" 2>&1`n")
                return Start-Process -FilePath 'bash' -RedirectStandardInput $wrapperPath `
                    -WorkingDirectory $workingDirectory -NoNewWindow -PassThru
            }
            throw "Unsupported Kit build command '$effectiveCommand'; expected the validated registry command for this platform."
        },
        [scriptblock] $WaitForExitFn = {
            param($proc, $timeoutMs)
            $proc.WaitForExit($timeoutMs)
        },
        [scriptblock] $StopTreeFn = {
            param($name, $runDir)
            Stop-HostNativeService -Name $name -RunDir $runDir | Out-Null
        }
    )

    $pidFile = Join-Path $RunDir 'kit-repo-build.pid'
    # 舊 build 留下的 log 會讓「exit 0 必須有 log」的 fail-closed 檢查誤把
    # stale log 當成本次啟動的證據;先刪掉,log 的存在就專屬於這一次 build。
    if (Test-Path -LiteralPath $LogPath -ErrorAction Stop) {
        if (-not (Test-Path -LiteralPath $LogPath -PathType Leaf -ErrorAction Stop)) {
            throw "Kit build log path '$LogPath' exists but is not a file."
        }
        Remove-Item -LiteralPath $LogPath -Force -ErrorAction Stop
        if (Test-Path -LiteralPath $LogPath -ErrorAction Stop) {
            throw "Failed to remove stale Kit build log '$LogPath'."
        }
    }
    $proc = & $StartProcessFn $WorkingDirectory $LogPath $BuildCommand
    $proc.Id | Set-Content -LiteralPath $pidFile -Encoding ascii

    $exited = & $WaitForExitFn $proc ($TimeoutSec * 1000)
    if ($exited) {
        Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
        $exitCode = [int]$proc.ExitCode
        if ($exitCode -eq 0 -and -not (Test-Path -LiteralPath $LogPath -PathType Leaf -ErrorAction Stop)) {
            # exit 0 卻連 log 檔都沒建,代表啟動列被引號重組弄壞、重導向沒有
            # 生效(build 根本沒跑);此時相信 exit code 會讓 deploy 把假 build
            # 當成功,直到 artifacts 檢查才以更難診斷的方式失敗。
            $exitCode = 1
        }
        return [pscustomobject]@{ TimedOut = $false; ExitCode = $exitCode; ProcessId = [int]$proc.Id }
    }

    & $StopTreeFn 'kit-repo-build' $RunDir
    return [pscustomobject]@{ TimedOut = $true; ExitCode = -1; ProcessId = [int]$proc.Id }
}

function Resolve-ConversionParentRoot {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string] $RuntimeStorageRoot)
    return (Split-Path -Parent $RuntimeStorageRoot)
}

function Start-HostNativeConversion {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string] $RepoRoot,
        [Parameter(Mandatory = $true)][string] $RuntimeStorageRoot,
        [int] $Port = 49101,
        [string] $BindHost = '127.0.0.1',
        [string] $PublicArtifactsUrl = ''
    )
    $runDir = Join-Path $RepoRoot 'scripts\.run'
    if (-not (Test-Path -LiteralPath $runDir)) {
        New-Item -ItemType Directory -Path $runDir -Force | Out-Null
    }

    # 反向對齊(spec §7.4 方案 A):
    # - STORAGE_ROOT 是 conversion service 內 ifc2usdc_powershell_adapter.py 用來驗
    #   dispatch payload host_local_path 必須在其下的 sandbox 根。coordinator 給的
    #   host_local_path = <RuntimeStorageRoot>\ifc-cache\<job>\source.ifc,所以
    #   STORAGE_ROOT 必須 = RuntimeStorageRoot,IFC path 才落在 sandbox 內。
    # - STREAMING_CONVERSION_WORK_DIR 是給 launcher 工作目錄(spec 註解保留 parent
    #   對齊以容 Resolve-ConversionWorkDir 的 storage subdir 推導)
    $parentRoot = Resolve-ConversionParentRoot -RuntimeStorageRoot $RuntimeStorageRoot
    $env:STORAGE_ROOT                  = $RuntimeStorageRoot
    $env:STREAMING_CONVERSION_WORK_DIR = $parentRoot
    $env:STREAMING_CONVERSION_HOST     = $BindHost
    $env:STREAMING_CONVERSION_PORT     = "$Port"
    if (-not [string]::IsNullOrWhiteSpace($PublicArtifactsUrl)) {
        $env:STREAMING_CONVERSION_PUBLIC_ARTIFACTS_URL = $PublicArtifactsUrl
    } else {
        Remove-Item Env:STREAMING_CONVERSION_PUBLIC_ARTIFACTS_URL -ErrorAction SilentlyContinue
    }
    $env:PYTHONNOUSERSITE = '1'

    $launcher = Join-Path $RepoRoot 'bim-streaming-server\scripts\start-host-native-conversion-service.ps1'
    $pythonExe = Resolve-HostNativePython -RepoRoot $RepoRoot -ServiceName 'bim-streaming-conversion-service'
    return (Start-HostNativeService `
        -Name 'bim-streaming-conversion-service' `
        -WorkingDirectory (Join-Path $RepoRoot 'bim-streaming-server') `
        -FilePath (Get-HostNativePowerShellExe) `
        -ArgumentList (@(Get-HostNativePowerShellArgumentPrefix) + @('-File', $launcher, '-PythonExe', $pythonExe)) `
        -RunDir $runDir)
}

function Start-HostNativeGovernance {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string] $RepoRoot,
        [int] $Port = 49102,
        [string] $DbPath = '',
        [string] $FileLibraryRoot = ''
    )
    # 'scripts\.run' is safe on both platforms: PowerShell's Join-Path normalises the
    # backslash to the native separator, verified on the Linux target (the run
    # directory materialised under <private-deploy-root>/scripts/.run). Kept in the
    # Windows spelling to match every other site that reads or writes these PID files.
    $runDir = Join-Path $RepoRoot 'scripts\.run'
    if (-not (Test-Path -LiteralPath $runDir)) {
        New-Item -ItemType Directory -Path $runDir -Force | Out-Null
    }

    $serviceRoot = Join-Path $RepoRoot 'governance-service'
    $pythonExe = Resolve-HostNativePython -RepoRoot $RepoRoot -ServiceName 'governance-service'

    Remove-Item Env:PYTHONNOUSERSITE -ErrorAction SilentlyContinue
    & $pythonExe -c "import ifcopenshell, fastapi, uvicorn" *> $null
    if ($LASTEXITCODE -ne 0) {
        throw "governance-service Python cannot import ifcopenshell, fastapi, and uvicorn: $pythonExe"
    }

    $env:GOV_PORT = "$Port"
    if (-not [string]::IsNullOrWhiteSpace($DbPath)) {
        $env:GOV_DB_PATH = $DbPath
    }
    if (-not [string]::IsNullOrWhiteSpace($FileLibraryRoot)) {
        $env:BIM_FILE_LIBRARY_ROOT = $FileLibraryRoot
    }

    return (Start-HostNativeService `
        -Name 'governance-service' `
        -WorkingDirectory $serviceRoot `
        -FilePath $pythonExe `
        -ArgumentList @('-m','uvicorn','app:app','--host',(Get-HostNativeBindHost -RepoRoot $RepoRoot),'--port',"$Port") `
        -RunDir $runDir)
}

function Stop-HostNativeProcessTreeAndWait {
    # Bounded best-effort process-tree SWEEP with a fail-closed provability
    # report. The contract is deliberately narrower than "containment", and
    # callers must read it as written:
    #
    #   It DOES: enumerate the descendants it can reach, terminate them
    #     deepest-first (parent last) with identity revalidation before every
    #     stop, re-enumerate to a fixed point, and THROW whenever it cannot prove
    #     that the set it knows about is gone inside one bounded budget.
    #
    #   It is NOT an escape-proof boundary. Discovery rides the OS parent/child
    #     link, and that link is advisory: a live process can spawn a child in the
    #     window between an enumeration and the stop that follows it, and on a
    #     platform that re-parents orphans the link vanishes outright once the
    #     parent dies. Only an OS boundary established at LAUNCH - a Windows Job
    #     Object, or a POSIX process group / cgroup - makes containment
    #     inescapable. #522 landed that boundary on Windows (named kill-on-close
    #     Job Objects for services via Start-HostNativeService, anonymous ones
    #     for bounded children via Invoke-HostNativeBoundedProcess), so this
    #     sweep is now the FALLBACK for processes launched without a boundary
    #     and for platforms without Job Objects (#517 tracks the POSIX cgroup
    #     boundary).
    #
    # So a caller gets "this sweep proved what it could see, or it threw" - never
    # "nothing survived". Releasing a trust boundary on the strength of a silent
    # return is a misuse of this helper.
    #
    # Two defects made even that narrower proof false (#489 L1-COR-004):
    #   1. Kill($true), WaitForExit and HasExited all describe the SAME Process
    #      object. Microsoft documents that they can report completion while
    #      descendants are still running, and the old catch additionally swallowed
    #      the tree-kill exception whenever the parent had already exited - the
    #      exact case where orphaned grandchildren survive.
    #   2. Process.Kill([bool]) does not exist on .NET Framework, so under Windows
    #      PowerShell 5.1 the tree kill ALWAYS threw into that catch and the helper
    #      silently degraded to "parent only".
    #
    #   3. An `if ($Process.HasExited) { return }` pre-entry guard is not
    #      containment either (#513 gate L1-COR-001). The parent can lose the race
    #      between the caller's liveness decision and this helper, and NEITHER OS
    #      cascades termination, so its descendants keep running. An exited parent
    #      excuses the parent kill/wait only - never the sweep or the proof.
    #   4. Stopping a snapshotted descendant by bare PID can terminate an unrelated
    #      process that inherited a recycled PID (#513 gate L1-COR-002), and the
    #      survivor poll would still read "our descendant is gone".
    #   5. One fixed snapshot is not containment (#513 gate L1-SEC-002): a
    #      snapshotted process can spawn another child before it dies, and that
    #      child appears in neither the stop list nor the success check.
    #   6. Sweeping an already-exited parent is only possible where the OS keeps
    #      the creator PID on an orphan (#513 gate r2 L1-COR-001). Linux
    #      re-parents orphans to init/subreaper, so BOTH discovery passes come
    #      back empty and an empty pass would read as containment. There this
    #      fails closed and names the caller's launch-time boundary instead of
    #      pretending a sweep can recover the link.
    #   7. Reaching the deadline is not a clean pass (#513 gate r2 L1-SEC-001).
    #      Success requires a pass that observed NEITHER a survivor NOR a newly
    #      discovered descendant; an empty survivor set at the deadline is not
    #      the same thing and must fail closed.
    #   8. TimeoutMs is ONE end-to-end budget (#513 gate r2 L1-COR-002). The
    #      stopwatch starts before discovery and every bounded operation after it
    #      - including the parent wait - receives only the remaining allowance.
    #
    # Fix: snapshot the descendant PID set BEFORE terminating (afterwards the
    # parent/child links are gone and orphans are re-parented), guard the tree
    # kill behind an overload probe with the enumerated-PID fallback used by
    # Stop-HostNativeService, then drive containment as a bounded FIXED POINT -
    # re-enumerate, terminate what is still ours, verify - until a pass finds
    # nothing new and nothing alive. Anything still alive at the deadline throws.
    #
    # Descendant liveness is judged on process IDENTITY, not the bare PID, both
    # before each stop and in the survivor proof, so a recycled PID is correctly
    # read as "our descendant is gone" instead of killing an unrelated process or
    # failing a caller closed on one.
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][System.Diagnostics.Process] $Process,
        [ValidateRange(1, 60000)][int] $TimeoutMs = 5000,
        # Injectable so the containment postcondition is testable without an
        # actually unkillable process.
        [scriptblock] $ChildPidLookup = {
            param($parentId)
            @(Get-PlatformChildProcessIds -ParentProcessId ([int]$parentId))
        },
        [scriptblock] $IdentityProbeFn = {
            param($procId)
            Get-PlatformProcessIdentity -ProcessId ([int]$procId)
        },
        [scriptblock] $StopProcessFn = {
            param($procId)
            Stop-Process -Id ([int]$procId) -Force -ErrorAction SilentlyContinue
        },
        [scriptblock] $SleepFn = {
            param($milliseconds)
            Start-Sleep -Milliseconds ([int]$milliseconds)
        },
        # Injectable so the .NET Framework / Windows PowerShell 5.1 branch is
        # reachable as BEHAVIOUR from a PowerShell 7 run instead of being pinned
        # by source strings alone (#513 gate L1-TG-003). Windows PowerShell 5.1
        # compatibility is an explicit purpose of this helper, and that branch
        # carries the two races above.
        [scriptblock] $TreeKillCapabilityProbeFn = {
            $null -ne [System.Diagnostics.Process].GetMethod('Kill', [type[]]@([bool]))
        },
        # Injectable so the POSIX fail-closed path is provable from a Windows run
        # and vice versa. See Test-OrphanRediscoverySupported for the platform
        # facts this gate encodes.
        [scriptblock] $OrphanRediscoveryProbeFn = {
            Test-OrphanRediscoverySupported
        }
    )

    # Nested on purpose: scripts/tests/test-deploy-governance-static.ps1 extracts
    # this function's AST and dot-sources it ALONE, so every helper it needs has
    # to travel inside its own extent.
    function Update-DescendantSnapshot {
        # Breadth-first walk below every root. Returns the PIDs discovered on THIS
        # pass in parent-before-child order (so reverse iteration is deepest-first)
        # and records an identity for each one.
        param(
            # Expanded from. Callers pass only PIDs that are still the incarnation
            # they recorded, so a recycled PID can never contribute an unrelated
            # process's children to the containment set.
            [Parameter(Mandatory = $true)][AllowEmptyCollection()][int[]] $RootProcessIds,
            # Already recorded; seeds the visited set so they are never rediscovered
            # or re-probed, even when they are no longer expanded from.
            [Parameter(Mandatory = $true)][AllowEmptyCollection()][int[]] $KnownProcessIds,
            [Parameter(Mandatory = $true)][hashtable] $Identities,
            [Parameter(Mandatory = $true)][scriptblock] $LookupFn,
            [Parameter(Mandatory = $true)][scriptblock] $ProbeFn
        )
        $discovered = @()
        $visited = @{}
        foreach ($knownId in $KnownProcessIds) { $visited[[int]$knownId] = $true }
        foreach ($rootId in $RootProcessIds) { $visited[[int]$rootId] = $true }
        $pending = @($RootProcessIds)
        while ($pending.Count -gt 0) {
            $current = [int]$pending[0]
            $pending = @($pending | Select-Object -Skip 1)
            try {
                $currentChildIds = @(& $LookupFn $current)
            } catch {
                throw ("Process tree child enumeration failed for PID {0}: {1}" -f $current, $_.Exception.Message)
            }
            foreach ($childId in $currentChildIds) {
                $childProcessId = [int]$childId
                if ($visited.ContainsKey($childProcessId)) { continue }
                $visited[$childProcessId] = $true
                $pending += $childProcessId
                $discovered += $childProcessId
                $Identities[$childProcessId] = (& $ProbeFn $childProcessId)
            }
        }
        # Emitted flat on purpose: every call site re-collects with @(), which is
        # what keeps the empty and single-descendant cases arrays.
        return $discovered
    }

    function Stop-DescendantSnapshot {
        # Deepest-first termination, identity-revalidated immediately before each
        # stop. A PID whose incarnation changed - or that we never got an identity
        # for - is not ours to kill and is already gone for our purposes.
        param(
            [Parameter(Mandatory = $true)][AllowEmptyCollection()][int[]] $DescendantIds,
            [Parameter(Mandatory = $true)][hashtable] $Identities,
            [Parameter(Mandatory = $true)][scriptblock] $ProbeFn,
            [Parameter(Mandatory = $true)][scriptblock] $StopFn
        )
        for ($i = $DescendantIds.Count - 1; $i -ge 0; $i--) {
            $descendantProcessId = [int]$DescendantIds[$i]
            if (-not (Test-PlatformProcessIdentityMatch `
                        -Reference $Identities[$descendantProcessId] `
                        -Current (& $ProbeFn $descendantProcessId))) {
                continue
            }
            $null = & $StopFn $descendantProcessId
        }
    }

    function Wait-ParentExitWithinBudget {
        # $TimeoutMs here is the REMAINING allowance out of the caller's single
        # end-to-end budget, never the caller's total: discovery and termination
        # already spent part of it before this runs.
        param(
            [Parameter(Mandatory = $true)][System.Diagnostics.Process] $Process,
            [Parameter(Mandatory = $true)][int] $TimeoutMs
        )
        if (-not $Process.WaitForExit($TimeoutMs) -or -not $Process.HasExited) { return $false }
        return $true
    }

    # ONE end-to-end budget: started before discovery, so every later bounded
    # operation spends what is left of it rather than a fresh full allowance.
    $budget = [System.Diagnostics.Stopwatch]::StartNew()

    $parentProcessId = [int]$Process.Id
    $parentAlreadyExited = $Process.HasExited

    # An already-exited parent is only sweepable where the OS keeps the creator
    # PID on an orphan. Where it does not, discovery has nothing left to walk, so
    # an empty result is ignorance rather than proof - fail closed and name the
    # boundary that could actually have prevented the escape.
    if ($parentAlreadyExited -and -not [bool](& $OrphanRediscoveryProbeFn)) {
        throw ("Process tree for PID $parentProcessId cannot be proven contained: the parent had " +
            'already exited on entry and this platform re-parents orphans, so containment is not ' +
            'provable via PPID here. This helper is a bounded best-effort sweep, not an escape-proof ' +
            'boundary: the authoritative containment boundary is the caller, which must hold an OS ' +
            'process group, cgroup or Job Object established at launch (#517).')
    }

    $descendantIdentities = @{}
    $descendantIds = @(Update-DescendantSnapshot `
            -RootProcessIds @($parentProcessId) `
            -KnownProcessIds @() `
            -Identities $descendantIdentities `
            -LookupFn $ChildPidLookup `
            -ProbeFn $IdentityProbeFn)

    $supportsTreeKill = [bool](& $TreeKillCapabilityProbeFn)
    if (-not $parentAlreadyExited) {
        try {
            if ($supportsTreeKill) {
                $Process.Kill($true)
            }
            else {
                # Windows PowerShell 5.1 / .NET Framework: no tree overload. Kill the
                # snapshot deepest-first, then the parent - the same enumerated-PID
                # shape Stop-HostNativeService already uses.
                Stop-DescendantSnapshot `
                    -DescendantIds $descendantIds `
                    -Identities $descendantIdentities `
                    -ProbeFn $IdentityProbeFn `
                    -StopFn $StopProcessFn
                $Process.Kill()
            }
        }
        catch {
            # An already-exited PARENT is the only tolerated failure, and it is not
            # a licence to stop: its descendants outlive it, so the containment
            # loop below still terminates and proves them instead of swallowing
            # the exception as before.
            if (-not $Process.HasExited) {
                throw "Process tree termination failed for PID $($Process.Id): $($_.Exception.Message)"
            }
        }
        $parentWaitMs = [int]($TimeoutMs - $budget.ElapsedMilliseconds)
        if ($parentWaitMs -le 0 -or -not (Wait-ParentExitWithinBudget -Process $Process -TimeoutMs $parentWaitMs)) {
            throw "Process tree for PID $($Process.Id) did not terminate within $TimeoutMs ms."
        }
    }

    # Bounded containment fixed point. Runs on EVERY path, including the exited
    # parent that used to return here, and including a successful tree kill - a
    # child created after the snapshot is invisible to both. The parent stays a
    # root even once it is dead: this call holds its Process handle, so its PID
    # cannot be recycled underneath us, and on Windows a just-orphaned child is
    # still reachable through the dead parent's ppid link. Every other root has
    # to still be the incarnation we recorded.
    #
    # $survivors starts as the WHOLE snapshot, alive or not, so the first pass
    # re-walks every member the stop above just killed. That is what catches a
    # descendant spawned between enumeration and the stop: measured on Windows
    # with a real three-level fixture whose grandchild was hidden from the
    # snapshot, pass 1 rediscovered it through its dead parent's link, stopped
    # it, and pass 2 came back clean.
    #
    # KNOWN RESIDUAL (analysis, not measured; the reason the contract above stops
    # short of "containment"): a descendant discovered AND stopped inside the same
    # pass drops out of $survivors, so the next pass no longer expands from it. A
    # child it spawned in that sub-window is not rediscovered. Expanding from dead
    # PIDs on every pass instead would trade this fail-open gap for a
    # fail-dangerous one - a recycled PID would contribute an unrelated process's
    # children to the kill set - so the gap is documented and left to the
    # launch-time OS boundary in #517 rather than papered over here.
    $survivors = @($descendantIds)
    $cleanPassObserved = $false
    while ($true) {
        # Never start another pass on an exhausted budget: the work below is
        # itself unbounded platform I/O.
        if ($budget.ElapsedMilliseconds -ge $TimeoutMs) { break }
        $newDescendantIds = @(Update-DescendantSnapshot `
                -RootProcessIds (@($parentProcessId) + $survivors) `
                -KnownProcessIds $descendantIds `
                -Identities $descendantIdentities `
                -LookupFn $ChildPidLookup `
                -ProbeFn $IdentityProbeFn)
        if ($newDescendantIds.Count -gt 0) { $descendantIds += $newDescendantIds }
        Stop-DescendantSnapshot `
            -DescendantIds $descendantIds `
            -Identities $descendantIdentities `
            -ProbeFn $IdentityProbeFn `
            -StopFn $StopProcessFn
        $survivors = @($descendantIds | Where-Object {
                $descendantProcessId = [int]$_
                Test-PlatformProcessIdentityMatch `
                    -Reference $descendantIdentities[$descendantProcessId] `
                    -Current (& $IdentityProbeFn $descendantProcessId)
            })
        # The fixed point is a pass that found NOTHING new and NOTHING alive.
        # An empty survivor set on a pass that still discovered a descendant is
        # not a fixed point: whatever spawned it can spawn again.
        if ($survivors.Count -eq 0 -and $newDescendantIds.Count -eq 0) {
            $cleanPassObserved = $true
            break
        }
        if ($budget.ElapsedMilliseconds -ge $TimeoutMs) { break }
        & $SleepFn 50
    }
    if ($survivors.Count -gt 0) {
        throw "Process tree for PID $($Process.Id) left descendant PID(s) $($survivors -join ', ') running after $TimeoutMs ms."
    }
    if (-not $cleanPassObserved) {
        throw "Process tree for PID $($Process.Id) could not be proven contained within $TimeoutMs ms: no containment pass completed with neither a surviving nor a newly discovered descendant."
    }
}

# R5（2026-07-10 衛生輪 C3）：kit-manager-api 納入 golden path——hybrid 模式下 coordinator
# 容器經 host.docker.internal:8010 依賴 host-native kit-manager-api（RK1 Kit 控制權威），
# 先前 Mode A/C 完全未編排（只有 Mode B compose 有）。樣式克隆 Start-HostNativeGovernance。
function Start-HostNativeKitManager {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string] $RepoRoot,
        [int] $Port = 8010,
        [Parameter(Mandatory = $true)][AllowEmptyString()][string] $KitControlUrl,
        [ValidateRange(1, 300)][int] $ImportProbeTimeoutSec = 30,
        [scriptblock] $ImportProbeFn = {
            # Bounded child on the launch-time containment boundary (#522):
            # Invoke-HostNativeBoundedProcess runs the probe inside a
            # kill-on-close Job Object on Windows and keeps the prior
            # Stop-HostNativeProcessTreeAndWait sweep + fail-closed disclosure
            # where Job Objects do not exist (POSIX boundary: #517).
            param($PythonExe, $TimeoutSec)
            $probe = Invoke-HostNativeBoundedProcess `
                -FilePath $PythonExe `
                -ArgumentList @('-c', 'import fastapi, uvicorn') `
                -TimeoutSec ([int]$TimeoutSec)
            if ($null -ne $probe.TerminationFailure) {
                throw "Kit Manager import probe timed out and its process tree exit could not be proven: $($probe.TerminationFailure.Exception.Message)"
            }
            return $probe.ExitCode
        },
        [scriptblock] $LocalAddressProbeFn = {
            param($HostName)
            return (Test-HostNativeLocalAddress -HostName $HostName)
        }
    )
    $runDir = Join-Path $RepoRoot 'scripts\.run'
    if (-not (Test-Path -LiteralPath $runDir)) {
        New-Item -ItemType Directory -Path $runDir -Force | Out-Null
    }

    $serviceRoot = Join-Path $RepoRoot 'services\kit-manager-api'
    $pythonExe = Resolve-HostNativePython -RepoRoot $RepoRoot -ServiceName 'kit-manager-api'

    Remove-Item Env:PYTHONNOUSERSITE -ErrorAction SilentlyContinue
    $pythonImportExit = & $ImportProbeFn $pythonExe $ImportProbeTimeoutSec
    if ([int]$pythonImportExit -ne 0) {
        throw "kit-manager-api Python cannot import fastapi and uvicorn: $pythonExe"
    }

    $normalizedKitControlUrl = Resolve-HostNativeKitControlUrl `
        -KitControlUrl $KitControlUrl `
        -LocalAddressProbeFn $LocalAddressProbeFn

    # This service runs on the host even though the web plane is containerized.
    # Set its child-only authority identity explicitly; container defaults would
    # otherwise return status=ok while routing Kit control to an invalid DNS name.
    $kitManagerEnvironment = [ordered]@{
        RUNTIME_MODE = 'hybrid-web-plane-host-native-kit'
        HOST_LOCAL_RUNTIME_ALLOWED = 'true'
        KIT_INSTANCE_ID = 'kit_local_001'
        KIT_CONTROL_URL = $normalizedKitControlUrl
    }
    $previousEnvironment = @{}
    foreach ($name in $kitManagerEnvironment.Keys) {
        $previousEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
        [Environment]::SetEnvironmentVariable($name, [string]$kitManagerEnvironment[$name], 'Process')
    }
    try {
        return (Start-HostNativeService `
            -Name 'kit-manager-api' `
            -WorkingDirectory $serviceRoot `
            -FilePath $pythonExe `
            -ArgumentList @('-m','uvicorn','app.main:app','--host',(Get-HostNativeBindHost -RepoRoot $RepoRoot),'--port',"$Port") `
            -RunDir $runDir)
    }
    finally {
        foreach ($name in $kitManagerEnvironment.Keys) {
            [Environment]::SetEnvironmentVariable($name, $previousEnvironment[$name], 'Process')
        }
    }
}

function Start-HostNativeKit {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string] $RepoRoot,
        [int] $SignalPort = 49100,
        [int] $StreamPort = 47998,
        [string] $PublicIp = '127.0.0.1',
        [int[]] $SpectatorSignalPorts = @(),
        [int[]] $SpectatorStreamPorts = @()
    )
    if ($SpectatorSignalPorts.Count -ne $SpectatorStreamPorts.Count) {
        throw "SpectatorSignalPorts and SpectatorStreamPorts must have the same number of entries."
    }

    $runDir = Join-Path $RepoRoot 'scripts\.run'
    if (-not (Test-Path -LiteralPath $runDir)) {
        New-Item -ItemType Directory -Path $runDir -Force | Out-Null
    }
    $launcher = Join-Path $RepoRoot 'bim-streaming-server\scripts\start-streaming-server.ps1'
    $arguments = @(Get-HostNativePowerShellArgumentPrefix) + @(
        '-File', $launcher,
        '-InstanceId','kit_local_001',
        '-SignalPort',"$SignalPort",
        '-StreamPort',"$StreamPort",
        '-PublicIp', $PublicIp,
        '-ResetUser',
        '-SkipAutoLoad'
    )
    if ($SpectatorSignalPorts.Count -gt 0) {
        $arguments += '-SpectatorSignalPorts'
        $arguments += ($SpectatorSignalPorts -join ',')
        $arguments += '-SpectatorStreamPorts'
        $arguments += ($SpectatorStreamPorts -join ',')
    }

    # The signal ports are the observable identity of a running Kit tree (#640).
    # They are TCP LISTEN sockets, so Get-PlatformTcpListenerPid can attribute
    # them on both platforms; the WebRTC media ports are UDP and are deliberately
    # not part of this record - one probe shape, one meaning.
    return (Start-HostNativeService `
        -Name 'bim-streaming-server' `
        -WorkingDirectory (Join-Path $RepoRoot 'bim-streaming-server') `
        -FilePath (Get-HostNativePowerShellExe) `
        -ArgumentList $arguments `
        -ListenPorts (@($SignalPort) + @($SpectatorSignalPorts)) `
        -RunDir $runDir)
}
