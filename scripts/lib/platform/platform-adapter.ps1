# scripts/lib/platform/platform-adapter.ps1
# Cross-platform primitives for the deploy path (decision D-4, plan §6.2).
# One codebase, per-OS dispatch: the ~10 Windows-only call sites in the canonical
# deploy path route through these functions instead of calling CIM/NetTCP directly.
#
# Ownership-identity equivalence (plan B3): the stop/ownership gates rely on
# "same PID is still the same process". Both platforms expose a birth token that
# PID reuse cannot preserve:
#   windows: Win32_Process.CreationDate  (100ns-resolution creation timestamp)
#   linux:   /proc/<pid>/stat field 22   (starttime, clock ticks since boot;
#            monotonic per boot, assigned at fork, immutable for process life)
# A recycled PID necessarily gets a new birth token on both platforms, so
# (pid, birth token, executable path) is an equivalent identity triple. The
# same test suite runs unmodified on both OSes as the executable evidence.

Set-StrictMode -Version Latest

function Get-PlatformName {
    # PS 5.1 has no automatic $IsWindows and only runs on Windows.
    $isWin = $true
    $flag = Get-Variable -Name IsWindows -Scope Global -ErrorAction SilentlyContinue
    if ($null -ne $flag) { $isWin = [bool]$flag.Value }
    if ($isWin) { return 'windows' }
    $flag = Get-Variable -Name IsLinux -Scope Global -ErrorAction SilentlyContinue
    if ($null -ne $flag -and [bool]$flag.Value) { return 'linux' }
    throw 'platform_adapter: unsupported platform (only windows and linux are implemented).'
}

function Get-PlatformChildProcessIds {
    param([Parameter(Mandatory = $true)][int] $ParentProcessId)

    if ((Get-PlatformName) -eq 'windows') {
        try {
            return @(Get-CimInstance Win32_Process -Filter "ParentProcessId=$ParentProcessId" -ErrorAction Stop |
                ForEach-Object { [int]$_.ProcessId })
        } catch {
            throw "platform_child_enumeration_failed: unable to query Windows children of PID ${ParentProcessId}: $($_.Exception.Message)"
        }
    }
    try {
        $procDirectories = @(Get-ChildItem -LiteralPath '/proc' -Directory -ErrorAction Stop)
    } catch {
        throw "platform_child_enumeration_failed: unable to enumerate /proc for children of PID ${ParentProcessId}: $($_.Exception.Message)"
    }
    $children = [System.Collections.Generic.List[int]]::new()
    foreach ($dir in $procDirectories) {
        if ($dir.Name -notmatch '^\d+$') { continue }
        try {
            $stat = Get-PlatformProcStatFields -ProcessId ([int]$dir.Name) -FailOnReadError
        } catch {
            throw "platform_child_enumeration_failed: unable to inspect /proc/$($dir.Name) while enumerating children of PID ${ParentProcessId}: $($_.Exception.Message)"
        }
        if ($null -ne $stat -and $stat.ParentProcessId -eq $ParentProcessId) {
            $children.Add([int]$dir.Name)
        }
    }
    return @($children)
}

function Test-OrphanRediscoverySupported {
    # Can a dead parent's descendants still be found through the parent/child
    # link AFTER the parent has exited?
    #
    #   windows: YES. Win32_Process.ParentProcessId keeps the CREATOR's PID once
    #            the creator exits, so an orphan stays reachable from the parent
    #            PID we recorded - and while a handle to the exited process is
    #            held that PID cannot be recycled underneath the query.
    #   linux:   NO. The kernel re-parents an orphan to init or to the nearest
    #            subreaper, so /proc/<pid>/stat field 4 stops naming the creator
    #            and the link is gone for good.
    #
    # Anything that must PROVE containment across a parent exit on Linux has to
    # own a boundary established at LAUNCH (process group / job object) or a
    # descendant record captured before the exit - the same conclusion the
    # converter containment work reached and measured (#489 / #509).
    param([string] $Platform = (Get-PlatformName))
    return ($Platform -eq 'windows')
}

function Get-PlatformProcStatFields {
    # Parses /proc/<pid>/stat. comm (field 2) may contain spaces/parens, so split
    # on the LAST ')' before reading positional fields.
    param(
        [Parameter(Mandatory = $true)][int] $ProcessId,
        [switch] $FailOnReadError
    )

    $statPath = "/proc/$ProcessId/stat"
    try {
        if (-not (Test-Path -LiteralPath $statPath -PathType Leaf -ErrorAction Stop)) { return $null }
    } catch {
        if ($FailOnReadError) {
            throw "platform_proc_stat_read_failed: unable to inspect ${statPath}: $($_.Exception.Message)"
        }
        return $null
    }
    try {
        $raw = Get-Content -LiteralPath $statPath -Raw -ErrorAction Stop
    } catch {
        # A process can disappear between listing /proc and reading stat. That is
        # a successful observation that this candidate no longer exists. Any
        # failure while the entry still exists is unknown and must fail closed
        # for child enumeration instead of being converted to an empty set.
        $entryStillExists = $false
        try { $entryStillExists = Test-Path -LiteralPath $statPath -PathType Leaf -ErrorAction Stop } catch { $entryStillExists = $true }
        if ($FailOnReadError -and $entryStillExists) {
            throw "platform_proc_stat_read_failed: unable to read ${statPath}: $($_.Exception.Message)"
        }
        return $null
    }
    $closeIndex = $raw.LastIndexOf(')')
    if ($closeIndex -lt 0) {
        if ($FailOnReadError) { throw "platform_proc_stat_read_failed: malformed ${statPath} (missing process-name terminator)." }
        return $null
    }
    $rest = $raw.Substring($closeIndex + 1).Trim() -split '\s+'
    # $rest[0] = state (field 3), $rest[1] = ppid (field 4), $rest[3] = session
    # (field 6), $rest[19] = starttime (field 22)
    if ($rest.Count -lt 20) {
        if ($FailOnReadError) { throw "platform_proc_stat_read_failed: malformed ${statPath} (expected at least 20 trailing fields)." }
        return $null
    }
    return [pscustomobject]@{
        ParentProcessId = [int]$rest[1]
        SessionId       = [int]$rest[3]
        StartTimeTicks  = [string]$rest[19]
    }
}

function Test-PlatformProcessDetached {
    # Is this process free of the launching terminal/SSH session? A process that
    # is its own session leader (sid == pid) no longer receives the SIGHUP sent
    # when the session's controlling terminal goes away.
    #
    # This is the whole difference between a local deploy and a remote one: on
    # Windows the deploy runs in a session that stays, so nothing hangs up. Over
    # SSH, every host-native service started as a child of the session died the
    # moment the transport disconnected - the deploy reported them healthy and
    # they were gone minutes later, leaving stale PID files behind.
    param([Parameter(Mandatory = $true)][int] $ProcessId)

    if ((Get-PlatformName) -eq 'windows') { return $true }
    $stat = Get-PlatformProcStatFields -ProcessId $ProcessId
    if ($null -eq $stat) { return $false }
    return ([int]$stat.SessionId -eq $ProcessId)
}

function Test-PlatformServiceLingerEnabled {
    # Will this account's processes survive its last logout?
    #
    # Windows has no equivalent and the deploy runs in a session that stays, so it
    # is always true there. On Linux with systemd, a snap-installed pwsh puts its
    # children under user@<uid>.service, which systemd stops on last logout unless
    # the account has lingering enabled - so an SSH-driven deploy reported four
    # healthy host-native services and every one of them was gone minutes later,
    # with only stale PID files left. Measured, not assumed: two probes started
    # through the real launcher died without lingering and survived with it.
    param([string] $UserName = '')

    if ((Get-PlatformName) -eq 'windows') { return $true }
    $target = if ([string]::IsNullOrWhiteSpace($UserName)) { (& id -un 2>$null | Out-String).Trim() } else { $UserName }
    if ([string]::IsNullOrWhiteSpace($target)) { return $false }
    $out = (& loginctl show-user $target -p Linger 2>$null | Out-String).Trim()
    return ($out -match 'Linger\s*=\s*yes')
}

function Get-PlatformProcessIdentity {
    # Returns $null when the process does not exist. BirthToken is an opaque
    # string: equal tokens => same process incarnation on this host+boot.
    param([Parameter(Mandatory = $true)][int] $ProcessId)

    if ((Get-PlatformName) -eq 'windows') {
        $cim = Get-CimInstance Win32_Process -Filter "ProcessId=$ProcessId" -ErrorAction SilentlyContinue
        if ($null -eq $cim) { return $null }
        $birth = ''
        if ($null -ne $cim.CreationDate) { $birth = $cim.CreationDate.ToUniversalTime().ToString('o') }
        return [pscustomobject]@{
            ProcessId      = $ProcessId
            BirthToken     = $birth
            ExecutablePath = [string]$cim.ExecutablePath
            CommandLine    = [string]$cim.CommandLine
        }
    }

    $stat = Get-PlatformProcStatFields -ProcessId $ProcessId
    if ($null -eq $stat) { return $null }
    $exe = ''
    try { $exe = [string](Get-Item -LiteralPath "/proc/$ProcessId/exe" -ErrorAction Stop).Target } catch { $exe = '' }
    $cmdline = ''
    try {
        $bytes = [IO.File]::ReadAllBytes("/proc/$ProcessId/cmdline")
        $cmdline = ([Text.Encoding]::UTF8.GetString($bytes)).TrimEnd([char]0).Replace([char]0, ' ')
    } catch { $cmdline = '' }
    return [pscustomobject]@{
        ProcessId      = $ProcessId
        BirthToken     = $stat.StartTimeTicks
        ExecutablePath = $exe
        CommandLine    = $cmdline
    }
}

function Test-PlatformProcessIdentityMatch {
    # The ownership gates take a snapshot before acting and MUST re-verify that the
    # PID still denotes the same incarnation immediately before any stop.
    param(
        [Parameter(Mandatory = $true)][AllowNull()] $Reference,
        [Parameter(Mandatory = $true)][AllowNull()] $Current
    )
    if ($null -eq $Reference -or $null -eq $Current) { return $false }
    if ([int]$Reference.ProcessId -ne [int]$Current.ProcessId) { return $false }
    if ([string]::IsNullOrEmpty([string]$Reference.BirthToken) -or ([string]$Reference.BirthToken -ne [string]$Current.BirthToken)) { return $false }
    $refExe = [string]$Reference.ExecutablePath
    $curExe = [string]$Current.ExecutablePath
    if ($refExe -and $curExe -and ($refExe -ne $curExe)) { return $false }
    return $true
}

function Get-PlatformTcpListenerPid {
    # Returns the owning PID of a LISTEN socket on the port, or $null.
    param([Parameter(Mandatory = $true)][int] $Port)

    if ((Get-PlatformName) -eq 'windows') {
        $conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($null -eq $conn) { return $null }
        return [int]$conn.OwningProcess
    }
    $lines = @(& ss -ltnpH "sport = :$Port" 2>$null | Where-Object { $_ })
    foreach ($line in $lines) {
        if ($line -match 'pid=(\d+)') { return [int]$Matches[1] }
    }
    # A LISTEN line with no visible pid means the socket belongs to another user:
    # ss only reveals process info for sockets you own, or to root. Returning
    # $null there would report the port FREE - a fail-open on exactly the case
    # that matters. -1 means "occupied, owner not visible"; it matches no PID we
    # track, so callers treat it as a foreign holder.
    if ($lines.Count -gt 0) { return -1 }
    return $null
}

function Test-PlatformTcpListening {
    # "Is anything listening here", regardless of owner. Readiness probes want
    # this; ownership decisions want Get-PlatformTcpListenerPid.
    param([Parameter(Mandatory = $true)][int] $Port)
    return ($null -ne (Get-PlatformTcpListenerPid -Port $Port))
}

function Get-PlatformUdpListenerPid {
    # UDP peer of Get-PlatformTcpListenerPid, same -1 convention.
    param([Parameter(Mandatory = $true)][int] $Port)

    if ((Get-PlatformName) -eq 'windows') {
        $conn = Get-NetUDPEndpoint -LocalPort $Port -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($null -eq $conn) { return $null }
        return [int]$conn.OwningProcess
    }
    $lines = @(& ss -lunpH "sport = :$Port" 2>$null | Where-Object { $_ })
    foreach ($line in $lines) {
        if ($line -match 'pid=(\d+)') { return [int]$Matches[1] }
    }
    if ($lines.Count -gt 0) { return -1 }
    return $null
}

function Resolve-PlatformVenvPython {
    param([Parameter(Mandatory = $true)][string] $VenvRoot)
    if ((Get-PlatformName) -eq 'windows') {
        return Join-Path $VenvRoot 'Scripts/python.exe'
    }
    return Join-Path $VenvRoot 'bin/python'
}

function Resolve-PlatformSystemPython {
    # The interpreter used to CREATE a venv - a different question from the one
    # inside it. Distros commonly ship only `python3` with no `python`, while
    # Windows ships `python` plus a `python3` Store-alias stub that exits without
    # doing anything. Probing candidates in platform order and requiring one that
    # actually reports a version avoids both traps.
    # Returns $null when none works; callers MUST fail closed rather than run a
    # name that does not resolve - a bare `& python` under ErrorActionPreference
    # 'Continue' merely prints and leaves $LASTEXITCODE stale, which silently
    # skipped venv creation on the first real Linux deploy.
    $candidates = if ((Get-PlatformName) -eq 'windows') { @('python', 'python3') } else { @('python3', 'python') }
    foreach ($candidate in $candidates) {
        if ($null -eq (Get-Command -Name $candidate -ErrorAction SilentlyContinue)) { continue }
        $version = (& $candidate -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")' 2>&1 | Out-String).Trim()
        if ($LASTEXITCODE -ne 0 -or $version -notmatch '^(\d+)\.(\d+)$') { continue }
        $major = [int]$Matches[1]
        $minor = [int]$Matches[2]
        if ($major -gt 3 -or ($major -eq 3 -and $minor -ge 11)) { return $candidate }
    }
    return $null
}

function Resolve-DeployTargetKitLaunch {
    # Builds the full launch specification for a target object from the registry:
    # working directory, launcher path, and the platform-mandatory extra args.
    param(
        [Parameter(Mandatory = $true)] $Target,
        [string] $DeployRootOverride = ''
    )
    $root = if ([string]::IsNullOrWhiteSpace($DeployRootOverride)) { [string]$Target.deploy_root } else { $DeployRootOverride }
    $separator = if ([string]$Target.kind -eq 'windows_host_native') { '\' } else { '/' }
    $launcherRelative = [string]$Target.kit.streaming_launcher_relative
    $launcherNative = $launcherRelative.Replace('/', $separator).Replace('\', $separator)
    return [pscustomobject]@{
        WorkingDirectory = "$root$separator" + 'bim-streaming-server'
        LauncherPath     = "$root$separator" + 'bim-streaming-server' + $separator + $launcherNative
        Arguments        = @($Target.kit.extra_launch_args)
        BuildCommand     = [string]$Target.kit.build_command
    }
}
