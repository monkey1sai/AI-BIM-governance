[CmdletBinding()]
param(
    [Parameter(Mandatory = $true, Position = 0)]
    [string[]] $IfcPath,

    # 刻意保留的 typo alias(OutputNamne),向後相容既有呼叫者,勿改 — 移除/改名都會 breaking
    [Alias("OutputNamne")]
    [string] $OutputName = "{source-file-name}.usdc",

    [string] $OutputDir = ".\bim-models",

    [string] $ConfigPath = "",

    [string] $KitExePath = "",

    [string] $HoopsMainPath = "",

    [ValidateRange(1, 86400)]
    [int] $TimeoutSeconds = 600,

    [switch] $Force,

    [switch] $PlanOnly,

    [switch] $Json,

    # cross-service-structured-log-baseline: 跨服務 trace_id 載體。
    # 若呼叫者沒傳，則保留環境變數 BIM_TRACE_ID（若有）並透傳給 Kit subprocess。
    [string] $TraceId = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$RepoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path

function Resolve-KitPlatformLayout {
    param(
        [ValidateSet('windows','linux')]
        [string] $Platform = $(if ($env:OS -eq 'Windows_NT') { 'windows' } else { 'linux' })
    )

    if ($Platform -eq 'windows') {
        return [pscustomobject]@{
            BuildPlatform = 'windows-x86_64'
            Executable    = 'kit.exe'
            BuildCommand  = '.\repo.bat build'
        }
    }
    return [pscustomobject]@{
        BuildPlatform = 'linux-x86_64'
        Executable    = 'kit'
        BuildCommand  = './repo.sh build'
    }
}

$script:KitPlatformLayout = Resolve-KitPlatformLayout

function Get-KitReleaseRoot {
    return (Join-Path $RepoRoot "_build/$($script:KitPlatformLayout.BuildPlatform)/release")
}

function ConvertTo-AbsolutePath {
    param(
        [Parameter(Mandatory = $true)]
        [string] $Path
    )

    if ([string]::IsNullOrWhiteSpace($Path)) {
        return ""
    }

    if ([System.IO.Path]::IsPathRooted($Path)) {
        return [System.IO.Path]::GetFullPath($Path)
    }

    return [System.IO.Path]::GetFullPath((Join-Path $RepoRoot $Path))
}

function ConvertTo-AbsolutePatternPath {
    param(
        [Parameter(Mandatory = $true)]
        [string] $Path
    )

    if (-not [System.Management.Automation.WildcardPattern]::ContainsWildcardCharacters($Path)) {
        return ConvertTo-AbsolutePath -Path $Path
    }

    if ([System.IO.Path]::IsPathRooted($Path)) {
        return $Path
    }

    # .NET GetFullPath rejects wildcard characters on Windows. Keep wildcard
    # tokens intact and only anchor relative patterns under the repo root.
    return Join-Path $RepoRoot $Path
}

function Resolve-IfcInputs {
    param(
        [Parameter(Mandatory = $true)]
        [string[]] $Patterns
    )

    $byPath = [ordered]@{}
    $missingPatterns = New-Object System.Collections.Generic.List[string]

    foreach ($pattern in $Patterns) {
        $fullPattern = ConvertTo-AbsolutePatternPath -Path $pattern

        if ([System.Management.Automation.WildcardPattern]::ContainsWildcardCharacters($fullPattern)) {
            $found = @(
                Get-ChildItem -Path $fullPattern -File -ErrorAction SilentlyContinue |
                    Where-Object { $_.Extension -ieq ".ifc" }
            )
            if ($found.Count -eq 0) {
                $missingPatterns.Add($pattern) | Out-Null
            }

            foreach ($item in $found) {
                $byPath[$item.FullName] = $item
            }
            continue
        }

        if (-not (Test-Path -LiteralPath $fullPattern -PathType Leaf)) {
            $missingPatterns.Add($pattern) | Out-Null
            continue
        }

        $file = Get-Item -LiteralPath $fullPattern
        if ($file.Extension -ine ".ifc") {
            throw "Input is not an .ifc file: $($file.FullName)"
        }
        $byPath[$file.FullName] = $file
    }

    if ($missingPatterns.Count -gt 0) {
        $joined = ($missingPatterns -join ", ")
        throw "No IFC file matched: $joined"
    }

    return @($byPath.Values)
}

function Expand-OutputName {
    param(
        [Parameter(Mandatory = $true)]
        [System.IO.FileInfo] $SourceFile,

        [Parameter(Mandatory = $true)]
        [string] $Template
    )

    $sourceBaseName = [System.IO.Path]::GetFileNameWithoutExtension($SourceFile.Name)
    $sourceExtension = $SourceFile.Extension.TrimStart(".")

    $name = $Template
    $name = $name.Replace("{source-file-name}", $sourceBaseName)
    $name = $name.Replace("{source-name}", $SourceFile.Name)
    $name = $name.Replace("{source-extension}", $sourceExtension)

    if ([string]::IsNullOrWhiteSpace([System.IO.Path]::GetExtension($name))) {
        $name = "$name.usdc"
    }

    return $name
}

function ConvertTo-KitPath {
    param(
        [Parameter(Mandatory = $true)]
        [string] $Path
    )

    return $Path.Replace("\", "/")
}

function Find-KitExe {
    if (-not [string]::IsNullOrWhiteSpace($KitExePath)) {
        $resolved = ConvertTo-AbsolutePath -Path $KitExePath
        if (-not (Test-Path -LiteralPath $resolved -PathType Leaf)) {
            throw "Kit executable not found: $resolved"
        }
        return $resolved
    }

    $default = Join-Path (Get-KitReleaseRoot) "kit/$($script:KitPlatformLayout.Executable)"
    if (-not (Test-Path -LiteralPath $default -PathType Leaf)) {
        throw "Kit executable not found: $default. Run '$($script:KitPlatformLayout.BuildCommand)' first."
    }
    return (Resolve-Path -LiteralPath $default).Path
}

function Find-HoopsMain {
    if (-not [string]::IsNullOrWhiteSpace($HoopsMainPath)) {
        $resolved = ConvertTo-AbsolutePath -Path $HoopsMainPath
        if (-not (Test-Path -LiteralPath $resolved -PathType Leaf)) {
            throw "HOOPS conversion entrypoint not found: $resolved"
        }
        return $resolved
    }

    $releaseRoot = Get-KitReleaseRoot
    $searchRoots = @(
        (Join-Path $releaseRoot 'extscache'),
        (Join-Path $releaseRoot 'exts'),
        (Join-Path $releaseRoot 'extsbuild')
    ) | Where-Object { Test-Path -LiteralPath $_ -PathType Container }

    foreach ($root in $searchRoots) {
        $candidateRoots = @($root)
        $candidateRoots += @(
            Get-ChildItem -LiteralPath $root -Directory -Force -ErrorAction SilentlyContinue |
                Select-Object -ExpandProperty FullName
        )

        foreach ($candidateRoot in $candidateRoots) {
            $matches = @(
                Get-ChildItem -LiteralPath $candidateRoot -Recurse -File -Filter "hoops_main.py" -ErrorAction SilentlyContinue |
                    Where-Object { $_.FullName -match "omni[\\/]services[\\/]convert[\\/]cad[\\/]services[\\/]process[\\/]hoops_main\.py$" } |
                    Sort-Object FullName
            )
            if ($matches.Count -gt 0) {
                return $matches[0].FullName
            }
        }
    }

    throw @"
NVIDIA CAD Converter service entrypoint was not found.

Expected: omni/services/convert/cad/services/process/hoops_main.py

Run a build/precache after this change so the official converter extensions are downloaded:
    $($script:KitPlatformLayout.BuildCommand)

If the extension already exists outside this repo, pass:
    -HoopsMainPath <path-to-hoops_main.py>
"@
}

function Resolve-ConverterConfigPath {
    if (-not [string]::IsNullOrWhiteSpace($ConfigPath)) {
        $resolved = ConvertTo-AbsolutePath -Path $ConfigPath
        if (-not (Test-Path -LiteralPath $resolved -PathType Leaf)) {
            throw "Converter config not found: $resolved"
        }
        return $resolved
    }

    $defaultConfig = Join-Path $RepoRoot "config\ifc-hoops-converter.json"
    if (-not (Test-Path -LiteralPath $defaultConfig -PathType Leaf)) {
        throw "Default converter config not found: $defaultConfig"
    }
    return (Resolve-Path -LiteralPath $defaultConfig).Path
}

function New-ConversionPlan {
    $resolvedOutputDir = ConvertTo-AbsolutePath -Path $OutputDir
    if (-not (Test-Path -LiteralPath $resolvedOutputDir -PathType Container)) {
        New-Item -ItemType Directory -Path $resolvedOutputDir | Out-Null
    }

    $inputs = @(Resolve-IfcInputs -Patterns $IfcPath | Sort-Object FullName)
    if ($inputs.Count -eq 0) {
        throw "No IFC inputs found."
    }

    $outputByPath = @{}
    $rows = New-Object System.Collections.Generic.List[object]

    foreach ($inputFile in $inputs) {
        $outName = Expand-OutputName -SourceFile $inputFile -Template $OutputName
        $outPath = [System.IO.Path]::GetFullPath((Join-Path $resolvedOutputDir $outName))

        if ($outputByPath.ContainsKey($outPath)) {
            throw "Multiple IFC files map to the same output: $outPath. Use -OutputName '{source-file-name}.usdc'."
        }
        $outputByPath[$outPath] = $inputFile.FullName

        $status = "missing"
        if (Test-Path -LiteralPath $outPath -PathType Leaf) {
            $outputFile = Get-Item -LiteralPath $outPath
            if ($outputFile.LastWriteTimeUtc -lt $inputFile.LastWriteTimeUtc) {
                $status = "stale"
            }
            else {
                $status = "ready"
            }
        }

        if ($Force) {
            $status = "force"
        }

        $rows.Add([pscustomobject]@{
            Status = $status
            IfcPath = $inputFile.FullName
            OutputPath = $outPath
            KitPath = ConvertTo-KitPath -Path $outPath
        }) | Out-Null
    }

    return $rows.ToArray()
}

function Test-ConverterHostIsWindows {
    # #509 review r3: `$IsWindows` is an AUTOMATIC variable that only EXISTS on
    # PowerShell Core. Windows PowerShell 5.1 - the host the adapter falls back to -
    # never defines it, and this script runs under `Set-StrictMode -Version Latest`,
    # where READING an undefined variable THROWS. So `-or $IsWindows` did not quietly
    # evaluate to $null on 5.1: it aborted the caller before any child was discovered,
    # which is precisely the failure this platform check was added to prevent (a
    # conversion timeout then entered cleanup with an empty survivor list and reported
    # "confirmed gone" for a tree that was still fully alive).
    #
    # `Get-Variable -ErrorAction SilentlyContinue` READS the variable without
    # dereferencing it, so "not defined" is a MISS instead of a terminating error.
    # Semantics are unchanged: Windows is detected when EITHER signal says so.
    # The only residual gap would be a host where `$IsWindows` is absent AND `OS` is
    # unset - i.e. Windows PowerShell 5.1, which only ever runs on Windows and always
    # exports `OS`, so `$env:OS` alone already covers that host.
    return (($env:OS -eq 'Windows_NT') -or
        ((Get-Variable -Name 'IsWindows' -ValueOnly -ErrorAction SilentlyContinue) -eq $true))
}

function Get-ConverterChildProcessId {
    # Win32_Process is Windows-only; on Linux read /proc/<pid>/stat. Same shape as
    # scripts/lib/platform/platform-adapter.ps1::Get-PlatformChildProcessIds, kept
    # local so this converter stays free of the deploy-lib dependency.
    param([Parameter(Mandatory = $true)][int] $ParentProcessId)

    # #509 review: keying platform detection on $env:OS alone silently turns the
    # whole containment walk into a no-op whenever the converter runs under an
    # environment that does not export OS (observed on a real Windows host: the
    # Windows branch was skipped, the /proc branch found nothing, and
    # Stop-ConverterProcessTree reported "confirmed gone" for a tree that was
    # still fully alive). #509 review r3: the second signal must be read through
    # Test-ConverterHostIsWindows - a bare $IsWindows THROWS under Set-StrictMode on
    # Windows PowerShell 5.1, where the variable does not exist at all.
    if (Test-ConverterHostIsWindows) {
        return @(Get-CimInstance Win32_Process -Filter "ParentProcessId=$ParentProcessId" -ErrorAction SilentlyContinue |
            ForEach-Object { [int]$_.ProcessId })
    }

    $children = [System.Collections.Generic.List[int]]::new()
    foreach ($dir in Get-ChildItem -LiteralPath '/proc' -Directory -ErrorAction SilentlyContinue) {
        if ($dir.Name -notmatch '^\d+$') { continue }
        $statPath = "/proc/$($dir.Name)/stat"
        if (-not (Test-Path -LiteralPath $statPath)) { continue }
        try { $raw = Get-Content -LiteralPath $statPath -Raw -ErrorAction Stop } catch { continue }
        # comm (field 2) may contain spaces/parens, so split on the LAST ')'.
        $closeIndex = $raw.LastIndexOf(')')
        if ($closeIndex -lt 0) { continue }
        $rest = $raw.Substring($closeIndex + 1).Trim() -split '\s+'
        if ($rest.Count -lt 2) { continue }
        if ([int]$rest[1] -eq $ParentProcessId) { $children.Add([int]$dir.Name) }
    }
    return @($children)
}

function Get-ProcStatProcessState {
    # State field of a /proc/<pid>/stat line ('' when unparsable). comm (field 2)
    # may contain spaces and parens, so split on the LAST ')' - same idiom as
    # Get-ConverterChildProcessId and the adapter's _posix_group_members.
    param([Parameter(Mandatory = $true)][AllowEmptyString()][string] $StatLine)

    $closeIndex = $StatLine.LastIndexOf(')')
    if ($closeIndex -lt 0) { return '' }
    $rest = $StatLine.Substring($closeIndex + 1).Trim() -split '\s+'
    if ($rest.Count -lt 1 -or [string]::IsNullOrEmpty($rest[0])) { return '' }
    return $rest[0]
}

function Test-ConverterProcessAlive {
    # #509 review: a defunct (zombie) descendant still owns a PID, so Get-Process
    # keeps returning it - but it holds no HOOPS handle and can no longer execute
    # anything, so for containment it IS terminated. On Linux hosts whose PID 1
    # does not promptly reap orphans (our containers included) counting zombies
    # as survivors burns the whole containment deadline and then reports a
    # containment FAILURE for a tree that is already dead.
    param([Parameter(Mandatory = $true)][int] $ProcessId)

    if (Test-ConverterHostIsWindows) {
        return ($null -ne (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue))
    }

    $statPath = "/proc/$ProcessId/stat"
    if (-not (Test-Path -LiteralPath $statPath)) { return $false }
    try { $raw = Get-Content -LiteralPath $statPath -Raw -ErrorAction Stop } catch { return $false }
    return ((Get-ProcStatProcessState -StatLine $raw) -ne 'Z')
}

function Test-OrphanRediscoverySupported {
    # Can a re-walk still find a descendant whose parent has already been killed?
    #
    # Windows: yes. Win32_Process.ParentProcessId keeps pointing at the dead
    # parent (verified on a real host), so the discover -> kill loop rediscovers
    # such an orphan through the parent's retained PID and terminates it.
    # Linux: no. Orphans are reparented to PID 1, so the /proc ppid link that the
    # walk depends on is destroyed and the orphan becomes unreachable from the
    # tree root. There the authoritative boundary is the CALLER's process group
    # (the adapter sweeps it on every exit path); a non-escapable in-script
    # boundary needs a cgroup, tracked in #517.
    return (Test-ConverterHostIsWindows)
}

function Get-ConverterProcessStartTime {
    # #509 review r4: a PID is NOT an identity. Between the round that discovered
    # a descendant and a later round that signals it, that descendant can exit and
    # the OS can hand the very same pid to an unrelated process (Windows recycles
    # pids aggressively; Linux wraps at pid_max). `Stop-Process` on such a pid is a
    # kill OUTSIDE the tree - the exact failure this containment walk exists to
    # prevent, inverted. (Id, StartTime) is the cheapest identity pair readable on
    # both hosts.
    #
    # Returns $null when the pid does not resolve OR when its start time cannot be
    # read (protected process / raced exit). Callers treat an unreadable start time
    # as "identity unknown" and fall back to the pre-r4 existence check, so this
    # guard can never LOSE a kill that used to happen - it only blocks kills it can
    # PROVE are aimed at a different process.
    param([Parameter(Mandatory = $true)][int] $ProcessId)

    try {
        $process = Get-Process -Id $ProcessId -ErrorAction Stop
        return $process.StartTime
    }
    catch {
        return $null
    }
}

function Test-ConverterProcessIdentity {
    # Is the process currently holding $ProcessId still the one recorded under that
    # pid at discovery time? Three answers, because the caller must treat them
    # differently:
    #
    #   'match'    - same process (or identity unreadable on either side, see
    #                Get-ConverterProcessStartTime): signal it, poll it.
    #   'gone'     - the pid no longer resolves: nothing to signal. It is still kept
    #                as a re-walk seed, because on Windows Win32_Process keeps
    #                naming a dead parent and that is how orphans are rediscovered.
    #   'recycled' - the pid resolves to a DIFFERENT process: it is not ours. Never
    #                signal it, never re-walk from it (its children are not ours),
    #                never report it as a survivor of this tree.
    param(
        [Parameter(Mandatory = $true)][int] $ProcessId,
        [Parameter(Mandatory = $true)][AllowNull()][object] $RecordedStartTime
    )

    $exists = $false
    try { $exists = ($null -ne (Get-Process -Id $ProcessId -ErrorAction Stop)) }
    catch { $exists = $false }
    if (-not $exists) { return 'gone' }
    if ($null -eq $RecordedStartTime) { return 'match' }

    $current = Get-ConverterProcessStartTime -ProcessId $ProcessId
    if ($null -eq $current) { return 'match' }
    if ($current -eq $RecordedStartTime) { return 'match' }
    return 'recycled'
}

function Stop-ConverterProcessTree {
    # #489 L1-COR-004: `Stop-Process -Id $process.Id -Force` only reaches Kit
    # itself. Its HOOPS/CAD grandchildren keep processing untrusted input after
    # the wrapper reports a timeout. Walk the tree breadth-first (same idiom as
    # scripts/lib/host-native-launcher.ps1::Stop-HostNativeService), kill leaves
    # first, then WAIT until every collected PID is observed gone.
    #
    # #509 review: a SINGLE enumerate-then-kill pass is not a containment proof.
    # Enumeration is not atomic, so a descendant forked by a still-living member
    # AFTER that member was enumerated never lands in $ids, is never killed and
    # is never waited on - yet the caller still printed "terminated and confirmed
    # gone". Repeat discover -> kill from every known member until a fixed point
    # (two consecutive rounds that discover no new PID), capped at $MaxRounds.
    # Hitting the cap is reported honestly instead of being papered over.
    #
    # ORPHAN HANDLING (#509 review r2) - the answer is platform-split, and it was
    # MEASURED on a real host rather than assumed:
    #
    #   Windows: an exited process keeps being named by its children's
    #   Win32_Process.ParentProcessId, so querying children of an
    #   ALREADY-KILLED known pid still returns the orphan. That is why this loop
    #   re-walks from every KNOWN member instead of only from the root: the mid
    #   process vanishes from the process table once killed, so the root can no
    #   longer reach it, but its retained pid still answers. Regression test:
    #   scripts/tests/test-convert-ifc-to-usdc.ps1 case 2 (root -> mid -> leaf,
    #   leaf forked late); the same fixture driven by a root-only re-walk was
    #   measured reporting FixedPointReached=True with the leaf still alive.
    #
    #   Linux: orphans are reparented to PID 1, which destroys the ppid link, so
    #   no PPID-based rescan can rediscover them. There this wrapper is BEST
    #   EFFORT by construction - see Test-OrphanRediscoverySupported and the
    #   timeout wording, which says so instead of claiming proof.
    #
    # PID IDENTITY (#509 review r4): the known-member set accumulates ACROSS
    # rounds and every round re-signalled all of it, so a member that exited early
    # and had its pid recycled was signalled again - by then possibly an unrelated
    # service. Each member is therefore recorded as an (Id, StartTime) pair at
    # discovery and re-validated immediately before every signal and before being
    # reported as a survivor; a pid whose identity no longer matches is dropped
    # from all later passes instead of being killed or blamed.
    #
    # On BOTH platforms the authoritative containment boundary is the Python
    # adapter (ifc2usdc_powershell_adapter._ContainedProcess), whose OS-level
    # boundary -- a Windows Job Object, or a POSIX process group -- keeps
    # membership across reparenting and outlives this function. The ps1
    # direct-invocation path is not the ship path.
    #
    # Returns [pscustomobject] @{ SurvivingPids = @(); FixedPointReached = $bool };
    # SurvivingPids empty AND FixedPointReached true is the strongest result this
    # wrapper can report.
    param(
        [Parameter(Mandatory = $true)][int] $ProcessId,
        [ValidateRange(0, 600000)][int] $TimeoutMs = 15000,
        [ValidateRange(1, 100)][int] $MaxRounds = 10
    )

    $ids = [System.Collections.Generic.List[int]]::new()
    $seen = @{}
    # pid -> start time recorded AT DISCOVERY ($null when unreadable).
    $identity = @{}
    # pids observed to be a DIFFERENT process than the one discovered under that
    # pid: dropped from later kill rounds, from the re-walk seeds and from the
    # survivor poll.
    $recycled = @{}
    $stableRounds = 0
    $round = 0
    while ($round -lt $MaxRounds -and $stableRounds -lt 2) {
        $round++
        $discovered = 0
        # Re-walk from EVERY known member, not just the root: a descendant forked
        # by a known member AFTER that member was enumerated but BEFORE the
        # reverse-order kill is only reachable through its (by then dead) parent.
        #
        # #509 review r2, verified on a real Windows host: Windows does NOT
        # reparent orphans - Win32_Process.ParentProcessId still resolves to the
        # killed parent, so querying children of an already-dead KNOWN pid does
        # return the orphan, and the loop terminates it before declaring a fixed
        # point. Regression: scripts/tests/test-convert-ifc-to-usdc.ps1
        # "orphan forked before the kill".
        # Linux DOES reparent orphans to PID 1, which destroys that link, so no
        # PPID-based rescan can rediscover them there - see
        # Test-OrphanRediscoverySupported and the honest timeout wording below.
        $stack = [System.Collections.Generic.List[int]]::new()
        $stack.Add([int]$ProcessId)
        foreach ($known in @($ids)) {
            if ($recycled.ContainsKey([int]$known)) { continue }
            $stack.Add([int]$known)
        }
        $walked = @{}
        while ($stack.Count -gt 0) {
            $current = [int]$stack[0]
            $stack.RemoveAt(0)
            if ($walked.ContainsKey($current)) { continue }
            $walked[$current] = $true
            if (-not $seen.ContainsKey($current)) {
                $seen[$current] = $true
                $ids.Add($current)
                # Capture identity at the moment of discovery: this is what every
                # later round validates against before signalling the pid.
                $identity[$current] = Get-ConverterProcessStartTime -ProcessId $current
                $discovered++
            }
            foreach ($child in @(Get-ConverterChildProcessId -ParentProcessId $current)) {
                $stack.Add([int]$child)
            }
        }

        for ($i = $ids.Count - 1; $i -ge 0; $i--) {
            $target = [int]$ids[$i]
            if ($recycled.ContainsKey($target)) { continue }
            $state = Test-ConverterProcessIdentity -ProcessId $target -RecordedStartTime $identity[$target]
            if ($state -eq 'recycled') {
                # The pid outlived its owner and now belongs to someone else.
                $recycled[$target] = $true
                continue
            }
            if ($state -eq 'gone') { continue }
            Stop-Process -Id $target -Force -ErrorAction SilentlyContinue
        }

        if ($discovered -eq 0) { $stableRounds++ } else { $stableRounds = 0 }
    }
    $fixedPoint = ($stableRounds -ge 2)

    $deadline = [DateTime]::UtcNow.AddMilliseconds($TimeoutMs)
    while ($true) {
        $alive = [System.Collections.Generic.List[int]]::new()
        foreach ($candidate in @($ids)) {
            $candidateId = [int]$candidate
            if ($recycled.ContainsKey($candidateId)) { continue }
            if (-not (Test-ConverterProcessAlive -ProcessId $candidateId)) { continue }
            # A pid recycled between the kill and this poll IS alive, but it is not
            # a survivor of THIS tree; reporting it as one blames containment for an
            # unrelated process and the caller escalates on survivors.
            if ((Test-ConverterProcessIdentity -ProcessId $candidateId -RecordedStartTime $identity[$candidateId]) -ne 'match') {
                $recycled[$candidateId] = $true
                continue
            }
            $alive.Add($candidateId)
        }
        if ($alive.Count -eq 0) {
            return [pscustomobject]@{ SurvivingPids = @(); FixedPointReached = $fixedPoint }
        }
        if ([DateTime]::UtcNow -ge $deadline) {
            return [pscustomobject]@{ SurvivingPids = @($alive); FixedPointReached = $fixedPoint }
        }
        Start-Sleep -Milliseconds 100
    }
}

function Invoke-KitConversion {
    param(
        [Parameter(Mandatory = $true)]
        [object] $Item
    )

    $kitExe = Find-KitExe
    $hoopsMain = Find-HoopsMain
    $resolvedConfigPath = Resolve-ConverterConfigPath
    $buildRoot = Get-KitReleaseRoot
    $wrapperScript = Join-Path $RepoRoot "scripts\kit-cad-convert-and-quit.py"
    if (-not (Test-Path -LiteralPath $wrapperScript -PathType Leaf)) {
        throw "Kit converter wrapper not found: $wrapperScript"
    }

    # cross-service-structured-log-baseline §4.2: forward inbound trace_id to Kit
    # subprocess via `--trace-id=...` so the streaming-server adapter inside Kit
    # can adopt it as its active trace.
    $effectiveTraceId = if (-not [string]::IsNullOrWhiteSpace($TraceId)) {
        $TraceId
    } elseif ($env:BIM_TRACE_ID) {
        $env:BIM_TRACE_ID
    } else {
        ""
    }
    $traceArg = if ($effectiveTraceId) {
        " --trace-id `"$effectiveTraceId`""
    } else {
        ""
    }
    $execScript = "`"$wrapperScript`" --process-script `"$hoopsMain`" --input-path `"$($Item.IfcPath)`" --output-path `"$($Item.OutputPath)`" --config-path `"$resolvedConfigPath`"$traceArg"
    $kitArgs = @(
        "--ext-folder", (Join-Path $buildRoot "exts"),
        "--ext-folder", (Join-Path $buildRoot "extscache"),
        "--ext-folder", (Join-Path $buildRoot "apps"),
        "--no-window",
        "--enable", "omni.services.convert.cad",
        "--enable", "omni.kit.converter.hoops_core",
        "--exec", $execScript,
        "--/app/fastShutdown=1",
        # F7（2026-07-10 R7）：headless --exec 轉檔用不到 services HTTP listener，
        # 但 omni.services.convert.cad 會拉起 omni.services.transport.server.http 預設綁 :8011
        # （官方設定 /exts/omni.services.transport.server.http/port default=8011，Kit MCP 驗證）——
        # 多筆轉檔幾乎同時起時 TOCTOU 搶埠、輸家 crash（conversion_authority.py:238 既有紀錄）。
        # 直接停用該 HTTP server（http/enabled=false），根除搶埠；conversion_authority 的
        # 轉檔序列化鎖保留為第二道保險。
        "--/exts/omni.services.transport.server.http/http/enabled=false",
        "--info"
    )

    Write-Host "[ifc-convert] $($Item.IfcPath)"
    Write-Host "[ifc-convert] -> $($Item.OutputPath)"

    # streaming-server-capture-kit-conversion-logs §2:Kit subprocess stdout/stderr
    # 用 async redirect 寫到 artifact dir 內 file,失敗 throw 時把 tail 帶進 message
    # 並 surface log file path,讓 operator 不需重跑就能 debug Kit silent failure。
    $artifactDir = Split-Path -Parent $Item.OutputPath
    if (-not (Test-Path -LiteralPath $artifactDir)) {
        New-Item -ItemType Directory -Force -Path $artifactDir | Out-Null
    }
    $stdoutLog = Join-Path $artifactDir "kit-stdout.log"
    $stderrLog = Join-Path $artifactDir "kit-stderr.log"
    Write-Host "[ifc-convert] kit_stdout_log: $stdoutLog"
    Write-Host "[ifc-convert] kit_stderr_log: $stderrLog"
    Write-Host ('##CONV_META## ' + (ConvertTo-Json -Compress @{ kit_stdout_log = $stdoutLog; kit_stderr_log = $stderrLog }))

    $startInfo = [System.Diagnostics.ProcessStartInfo]::new($kitExe)
    $startInfo.UseShellExecute = $false
    $startInfo.WorkingDirectory = $RepoRoot
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    foreach ($arg in $kitArgs) {
        $startInfo.ArgumentList.Add($arg) | Out-Null
    }

    $process = [System.Diagnostics.Process]::Start($startInfo)
    if (-not $process) {
        throw "Kit CAD conversion process did not start for $($Item.IfcPath)"
    }

    # AutoFlush 確保 timeout / crash 時 partial log 仍落地。
    $stdoutWriter = [System.IO.StreamWriter]::new($stdoutLog, $false, [System.Text.Encoding]::UTF8)
    $stderrWriter = [System.IO.StreamWriter]::new($stderrLog, $false, [System.Text.Encoding]::UTF8)
    $stdoutWriter.AutoFlush = $true
    $stderrWriter.AutoFlush = $true

    # async file redirect — avoids classic sync ReadToEnd + WaitForExit deadlock
    # when Kit subprocess output volume fills the OS pipe buffer (large IFC 可達 MB).
    $stdoutEvent = Register-ObjectEvent -InputObject $process -EventName OutputDataReceived `
        -MessageData $stdoutWriter -Action {
            if ($EventArgs.Data) { $Event.MessageData.WriteLine($EventArgs.Data) }
        }
    $stderrEvent = Register-ObjectEvent -InputObject $process -EventName ErrorDataReceived `
        -MessageData $stderrWriter -Action {
            if ($EventArgs.Data) { $Event.MessageData.WriteLine($EventArgs.Data) }
        }
    $process.BeginOutputReadLine()
    $process.BeginErrorReadLine()

    $survivingPids = @()
    $containmentFixedPoint = $true
    try {
        if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
            # #489 L1-COR-004:只殺 Kit 本身會留下 HOOPS/CAD 孫代繼續處理不可信
            # 輸入。改成 tree-scoped 終止,並且「觀察到」整棵樹消失才往下走;沒能
            # 證明清空時把殘存 PID 帶進 timeout 訊息,不假裝已清理乾淨。
            $containment = Stop-ConverterProcessTree -ProcessId $process.Id
            $survivingPids = @($containment.SurvivingPids)
            $containmentFixedPoint = [bool]$containment.FixedPointReached
            # fall through 到 finally drain 後,再 throw timeout
            $timedOut = $true
        } else {
            $timedOut = $false
        }
        $exitCode = if ($timedOut) { -1 } else { $process.ExitCode }
    }
    finally {
        # 二次 WaitForExit 確保所有 async events drain(per MS .NET docs)
        # #509 review: when containment FAILED the tree still holds live
        # processes owning the stdout/stderr write ends, so an unbounded
        # WaitForExit() never sees EOF and turns an honestly-reported timeout
        # into a hang. Unbounded drain is only allowed once no survivor was
        # observed; with survivors, take a bounded 5s drain and accept losing
        # a few trailing log lines rather than wedging the whole converter.
        try {
            if ($survivingPids.Count -gt 0) {
                [void]$process.WaitForExit(5000)
            } else {
                $process.WaitForExit()
            }
        } catch { }
        Unregister-Event -SourceIdentifier $stdoutEvent.Name -ErrorAction SilentlyContinue
        Unregister-Event -SourceIdentifier $stderrEvent.Name -ErrorAction SilentlyContinue
        $stdoutWriter.Close()
        $stderrWriter.Close()
        $process.Dispose()
    }

    $outputCreated = Test-Path -LiteralPath $Item.OutputPath -PathType Leaf

    if ($timedOut -or $exitCode -ne 0 -or -not $outputCreated) {
        $stderrTail = if (Test-Path -LiteralPath $stderrLog) {
            (Get-Content -LiteralPath $stderrLog -Tail 100 -ErrorAction SilentlyContinue) -join "`n"
        } else { "(no stderr log)" }
        $stdoutTail = if (Test-Path -LiteralPath $stdoutLog) {
            (Get-Content -LiteralPath $stdoutLog -Tail 50 -ErrorAction SilentlyContinue) -join "`n"
        } else { "(no stdout log)" }
        $reason = if ($timedOut) {
            $timeoutReason = "Kit CAD conversion timed out after $TimeoutSeconds seconds for $($Item.IfcPath)"
            if ($survivingPids.Count -gt 0) {
                "$timeoutReason; process tree containment FAILED, surviving PIDs: $($survivingPids -join ', ')"
            } elseif (-not $containmentFixedPoint) {
                # The discover -> kill loop hit its round cap, so new descendants
                # could still have been appearing when we stopped looking. No
                # survivor was observed, but that is best-effort, not proof.
                "$timeoutReason; process tree kill loop hit its round cap before reaching a stable fixed point; no survivors were observed but containment is NOT proven"
            } elseif (-not (Test-OrphanRediscoverySupported)) {
                # This platform reparents orphans to PID 1, so a descendant forked
                # during termination loses the ppid link the walk depends on and
                # cannot be tracked from here. No survivor was observed among the
                # tracked PIDs, which is strictly weaker than proof.
                "$timeoutReason; no survivors were observed among the tracked PIDs, but this platform reparents orphans away from a killed parent, so a descendant forked during termination cannot be tracked by this script; containment is NOT proven here (the caller's process-group boundary is authoritative)"
            } else {
                # Windows keeps naming an exited parent in its children's
                # ParentProcessId, so the re-walk from every known pid does
                # rediscover a descendant forked during termination (measured;
                # regression-tested). The adapter's Job Object remains the
                # authoritative boundary for the wrapper-less direct path.
                "$timeoutReason; process tree terminated and confirmed gone (descendants forked during termination are rediscovered through the killed parent's retained PID on this platform; the adapter's Job Object remains the authoritative boundary)"
            }
        } elseif ($exitCode -ne 0) {
            "Kit CAD conversion failed with exit code $exitCode for $($Item.IfcPath)"
        } else {
            "Kit CAD conversion completed but output was not created: $($Item.OutputPath)"
        }
        Write-Host ('##CONV_META## ' + (ConvertTo-Json -Compress @{ kit_stdout_log = $stdoutLog; kit_stderr_log = $stderrLog }))
        throw @"
$reason
  kit_stdout_log: $stdoutLog
  kit_stderr_log: $stderrLog
  ---- stderr tail (last 100 lines) ----
$stderrTail
  ---- stdout tail (last 50 lines) ----
$stdoutTail
"@
    }
}

$plan = @(New-ConversionPlan)

if ($Json) {
    $plan | ConvertTo-Json -Depth 4
}
else {
    foreach ($item in $plan) {
        Write-Host "Status : $($item.Status)"
        Write-Host "IFC    : $($item.IfcPath)"
        Write-Host "USDC   : $($item.OutputPath)"
        Write-Host ""
    }
}

if ($PlanOnly) {
    return
}

foreach ($item in $plan) {
    if ($item.Status -eq "ready") {
        Write-Host "[ifc-convert] up-to-date: $($item.OutputPath)"
        continue
    }
    Invoke-KitConversion -Item $item
}
