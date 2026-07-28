# spec-to-done helper — host-native port preflight for backend stack startup / rebuild
#
# Safety contract:
# - Default and -DetectOnly modes are read-only. They report busy ports and exit 1 without stopping anything.
# - Real cleanup is opt-in and restricted to the canonical test deployment. It requires BOTH
#   -StopOwnedRuntime and -DeploymentRoot 'D:\Users\deploy\AI-bim-geo'.
# - A process is stoppable only when its port-specific runtime role, deployment launcher ancestry,
#   exact entrypoint/arguments, and creation identity are revalidated before stop. Pidfiles are lineage
#   evidence only; port/process-name/pidfile evidence is never sufficient by itself.
# - The helper records protocol/port/PID/process-name/ownership kind, but never prints full command lines.
#
# Exit codes:
#   0 = all required ports are free
#   1 = ports are occupied, ownership is unproven, or cleanup did not release them before timeout (HELD)
#   2 = invalid/out-of-scope request or port inspection unavailable (HELD)
#
# Usage:
#   powershell -NoProfile -ExecutionPolicy Bypass -File ensure-host-native-ports-free.ps1
#   powershell -NoProfile -ExecutionPolicy Bypass -File ensure-host-native-ports-free.ps1 -DetectOnly
#   powershell -NoProfile -ExecutionPolicy Bypass -File ensure-host-native-ports-free.ps1 `
#     -StopOwnedRuntime -DeploymentRoot 'D:\Users\deploy\AI-bim-geo'

[CmdletBinding()]
param(
    [string] $TimeoutSec = '30',
    [switch] $DetectOnly,
    [switch] $StopOwnedRuntime,
    [string] $DeploymentRoot,
    # Topology defaults mirror deploy.ps1. Spectator ports are derived as start + i*stride.
    [string] $KitSignalPort = '49100',
    [string] $KitMediaPort = '47998',
    [string] $ConversionPort = '49101',
    [string] $SpectatorCount = '5',
    [string] $SpectatorSignalStart = '49110',
    [string] $SpectatorMediaStart = '48008',
    [string] $SpectatorStride = '10'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Continue'

$script:CanonicalTestDeploymentRoot = 'D:\Users\deploy\AI-bim-geo'
$script:KillableHostNativeProcessPattern = '^(kit|kitd|python|pythonw|nvstreamer|pvd_streamer)$'

function ConvertTo-ValidatedInt {
    param(
        [Parameter(Mandatory = $true)][string] $Name,
        [Parameter(Mandatory = $true)][AllowEmptyString()][string] $Value,
        [Parameter(Mandatory = $true)][int] $Min,
        [Parameter(Mandatory = $true)][int] $Max
    )

    $parsed = 0
    if (-not [int]::TryParse($Value.Trim(), [ref]$parsed) -or $parsed -lt $Min -or $parsed -gt $Max) {
        throw "$Name must be an integer between $Min and $Max"
    }
    return $parsed
}

function ConvertTo-NormalizedPath {
    param([Parameter(Mandatory = $true)][string] $Path)

    $full = [System.IO.Path]::GetFullPath($Path)
    $volumeRoot = [System.IO.Path]::GetPathRoot($full)
    if ([string]::Equals($full.TrimEnd('\', '/'), $volumeRoot.TrimEnd('\', '/'), [System.StringComparison]::OrdinalIgnoreCase)) {
        return $volumeRoot
    }
    return $full.TrimEnd('\', '/')
}

function Test-SamePath {
    param(
        [Parameter(Mandatory = $true)][string] $Left,
        [Parameter(Mandatory = $true)][string] $Right
    )

    try {
        $leftFull = ConvertTo-NormalizedPath -Path $Left
        $rightFull = ConvertTo-NormalizedPath -Path $Right
        return [string]::Equals($leftFull, $rightFull, [System.StringComparison]::OrdinalIgnoreCase)
    }
    catch {
        return $false
    }
}

function Test-PathContained {
    param(
        [Parameter(Mandatory = $true)][string] $Candidate,
        [Parameter(Mandatory = $true)][string] $Root
    )

    try {
        $candidateFull = ConvertTo-NormalizedPath -Path $Candidate
        $rootFull = ConvertTo-NormalizedPath -Path $Root
        $rootPrefix = if ($rootFull.EndsWith('\') -or $rootFull.EndsWith('/')) { $rootFull } else { "$rootFull\" }
        return [string]::Equals($candidateFull, $rootFull, [System.StringComparison]::OrdinalIgnoreCase) -or
            $candidateFull.StartsWith($rootPrefix, [System.StringComparison]::OrdinalIgnoreCase)
    }
    catch {
        return $false
    }
}

function Test-PathChainWithoutReparsePoint {
    param(
        [Parameter(Mandatory = $true)][string] $Path,
        [Parameter(Mandatory = $true)][string] $Boundary
    )

    try {
        $current = ConvertTo-NormalizedPath -Path $Path
        $boundaryFull = ConvertTo-NormalizedPath -Path $Boundary
        if (-not (Test-PathContained -Candidate $current -Root $boundaryFull)) { return $false }

        while ($true) {
            $item = Get-Item -Force -LiteralPath $current -ErrorAction Stop
            if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
                return $false
            }
            if (Test-SamePath -Left $current -Right $boundaryFull) {
                return $true
            }
            $parent = Split-Path -Parent $current
            if ([string]::IsNullOrWhiteSpace($parent) -or (Test-SamePath -Left $parent -Right $current)) {
                return $false
            }
            $current = $parent
        }
    }
    catch {
        return $false
    }
}

function Test-SecurelyContainedPath {
    param(
        [Parameter(Mandatory = $true)][string] $Candidate,
        [Parameter(Mandatory = $true)][string] $Root
    )

    if (-not (Test-PathContained -Candidate $Candidate -Root $Root)) { return $false }
    return Test-PathChainWithoutReparsePoint -Path $Candidate -Boundary $Root
}

function Assert-CanonicalTestDeploymentRoot {
    param([Parameter(Mandatory = $true)][string] $Path)

    if (-not (Test-SamePath -Left $Path -Right $script:CanonicalTestDeploymentRoot)) {
        throw "-StopOwnedRuntime is restricted to the canonical test deployment: $($script:CanonicalTestDeploymentRoot)"
    }

    $normalized = ConvertTo-NormalizedPath -Path $Path
    if (-not (Test-Path -LiteralPath $normalized -PathType Container)) {
        throw "Canonical test deployment root does not exist: $normalized"
    }
    $volumeRoot = [System.IO.Path]::GetPathRoot($normalized)
    if (-not (Test-PathChainWithoutReparsePoint -Path $normalized -Boundary $volumeRoot)) {
        throw "Canonical test deployment path contains an unavailable or reparse-point segment: $normalized"
    }
    $deployEntrypoint = Join-Path $normalized 'scripts\deploy.ps1'
    if (-not (Test-Path -LiteralPath $deployEntrypoint -PathType Leaf)) {
        throw "Canonical test deployment marker is missing: $deployEntrypoint"
    }
    if (-not (Test-SecurelyContainedPath -Candidate $deployEntrypoint -Root $normalized)) {
        throw "Canonical test deployment marker is not securely contained: $deployEntrypoint"
    }
    return $normalized
}

function Get-DeploymentPidFileRecords {
    param([Parameter(Mandatory = $true)][string] $Root)

    $runDir = Join-Path $Root 'scripts\.run'
    if (-not (Test-Path -LiteralPath $runDir -PathType Container)) { return @() }

    if (-not (Test-SecurelyContainedPath -Candidate $runDir -Root $Root)) {
        return @()
    }

    $records = @()
    $seenPids = [System.Collections.Generic.HashSet[int]]::new()
    foreach ($pidFile in @(Get-ChildItem -LiteralPath $runDir -File -Filter '*.pid' -ErrorAction SilentlyContinue)) {
        if (-not (Test-SecurelyContainedPath -Candidate $pidFile.FullName -Root $Root)) { continue }
        $raw = Get-Content -LiteralPath $pidFile.FullName -TotalCount 1 -ErrorAction SilentlyContinue
        $parsed = 0
        if ([int]::TryParse(([string]$raw).Trim(), [ref]$parsed) -and $parsed -gt 0 -and $seenPids.Add($parsed)) {
            $records += [pscustomobject]@{ Name = $pidFile.BaseName; ProcId = $parsed }
        }
    }
    return @($records)
}

function Get-DeploymentPidFilePids {
    param([Parameter(Mandatory = $true)][string] $Root)
    return @(Get-DeploymentPidFileRecords -Root $Root | ForEach-Object { [int]$_.ProcId })
}

function Get-DeploymentEnvSnapshot {
    param([Parameter(Mandatory = $true)][string] $Path)

    $bytes = [System.IO.File]::ReadAllBytes($Path)
    $sha256 = [System.Security.Cryptography.SHA256]::Create()
    try {
        $hashBytes = $sha256.ComputeHash($bytes)
        $hash = ([System.BitConverter]::ToString($hashBytes)).Replace('-', '')
    }
    finally {
        $sha256.Dispose()
    }

    $values = @{}
    $text = [System.Text.Encoding]::UTF8.GetString($bytes)
    foreach ($line in @($text -split "\r?\n")) {
        $trimmed = ([string]$line).Trim().TrimStart([char]0xFEFF)
        if ($trimmed.Length -eq 0 -or $trimmed.StartsWith('#')) { continue }
        if ($trimmed -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*[:=]\s*(.*)$') {
            $name = $Matches[1]
            if ($values.ContainsKey($name)) { continue }
            $value = $Matches[2].Trim()
            $isQuoted = $value.Length -ge 2 -and (
                ($value.StartsWith('"') -and $value.EndsWith('"')) -or
                ($value.StartsWith("'") -and $value.EndsWith("'"))
            )
            if ($isQuoted) {
                $value = $value.Substring(1, $value.Length - 2)
            }
            else {
                $commentIndex = $value.IndexOf('#')
                if ($commentIndex -ge 0) {
                    $value = $value.Substring(0, $commentIndex).Trim()
                }
            }
            $values[$name] = $value
        }
    }
    return [pscustomobject]@{ Values = $values; Hash = $hash }
}

function Resolve-DeploymentIntValue {
    param(
        [Parameter(Mandatory = $true)][string] $Name,
        [Parameter(Mandatory = $true)][hashtable] $Values,
        [Parameter(Mandatory = $true)][int] $Default,
        [Parameter(Mandatory = $true)][int] $Min,
        [Parameter(Mandatory = $true)][int] $Max
    )

    $raw = if ($Values.ContainsKey($Name)) { [string]$Values[$Name] } else { '' }
    if ([string]::IsNullOrWhiteSpace($raw)) { $raw = [string]$Default }
    return ConvertTo-ValidatedInt -Name $Name -Value $raw -Min $Min -Max $Max
}

function Get-DeploymentPortTopology {
    param([Parameter(Mandatory = $true)][string] $Root)

    $envFile = Join-Path $Root '.env.web-plane.host-kit'
    if (-not (Test-Path -LiteralPath $envFile -PathType Leaf)) {
        $envFile = Join-Path $Root '.env.web-plane.host-kit.example'
    }
    if (-not (Test-Path -LiteralPath $envFile -PathType Leaf)) {
        throw 'Deployment topology source is missing (.env.web-plane.host-kit or .example)'
    }
    if (-not (Test-SecurelyContainedPath -Candidate $envFile -Root $Root)) {
        throw 'Deployment topology source is not securely contained'
    }

    $envSnapshot = Get-DeploymentEnvSnapshot -Path $envFile
    $signalPort = Resolve-DeploymentIntValue -Name 'KIT_SIGNALING_PORT' -Values $envSnapshot.Values -Default 49100 -Min 1 -Max 65535
    $mediaPort = Resolve-DeploymentIntValue -Name 'KIT_MEDIA_PORT' -Values $envSnapshot.Values -Default 47998 -Min 1 -Max 65535
    $spectatorCount = Resolve-DeploymentIntValue -Name 'KIT_SPECTATOR_COUNT' -Values $envSnapshot.Values -Default 5 -Min 0 -Max 32
    $spectatorSignalStart = Resolve-DeploymentIntValue -Name 'KIT_SPECTATOR_SIGNALING_PORT_START' -Values $envSnapshot.Values -Default 49110 -Min 1 -Max 65535
    $spectatorMediaStart = Resolve-DeploymentIntValue -Name 'KIT_SPECTATOR_MEDIA_PORT_START' -Values $envSnapshot.Values -Default 48008 -Min 1 -Max 65535
    $spectatorStride = Resolve-DeploymentIntValue -Name 'KIT_SPECTATOR_PORT_STRIDE' -Values $envSnapshot.Values -Default 10 -Min 1 -Max 1000

    $tcpPorts = @($signalPort, 49101)
    $udpPorts = @($mediaPort)
    for ($index = 0; $index -lt $spectatorCount; $index++) {
        $spectatorSignalPort = $spectatorSignalStart + ($index * $spectatorStride)
        $spectatorMediaPort = $spectatorMediaStart + ($index * $spectatorStride)
        if ($spectatorSignalPort -gt 65535 -or $spectatorMediaPort -gt 65535) {
            throw 'Derived spectator port exceeds 65535'
        }
        $tcpPorts += $spectatorSignalPort
        $udpPorts += $spectatorMediaPort
    }
    $allPorts = @($tcpPorts + $udpPorts)
    if (@($allPorts | Sort-Object -Unique).Count -ne $allPorts.Count) {
        throw 'Deployment topology contains duplicate or cross-protocol port collisions'
    }

    return [pscustomobject]@{
        TcpPorts = @($tcpPorts | Sort-Object -Unique)
        UdpPorts = @($udpPorts | Sort-Object -Unique)
        Source = $envFile
        SourceHash = $envSnapshot.Hash
    }
}

function Test-IntArrayExact {
    param(
        [Parameter(Mandatory = $true)][int[]] $Left,
        [Parameter(Mandatory = $true)][int[]] $Right
    )
    if ($Left.Count -ne $Right.Count) { return $false }
    for ($index = 0; $index -lt $Left.Count; $index++) {
        if ([int]$Left[$index] -ne [int]$Right[$index]) { return $false }
    }
    return $true
}

function Test-DeploymentTopologyUnchanged {
    param(
        [Parameter(Mandatory = $true)][string] $Root,
        [Parameter(Mandatory = $true)] $Expected
    )
    try {
        $current = Get-DeploymentPortTopology -Root $Root
        return [string]::Equals([string]$current.SourceHash, [string]$Expected.SourceHash, [System.StringComparison]::Ordinal) -and
            (Test-SamePath -Left ([string]$current.Source) -Right ([string]$Expected.Source)) -and
            (Test-IntArrayExact -Left @($current.TcpPorts) -Right @($Expected.TcpPorts)) -and
            (Test-IntArrayExact -Left @($current.UdpPorts) -Right @($Expected.UdpPorts))
    }
    catch {
        return $false
    }
}

function Get-BusyPorts {
    param(
        [Parameter(Mandatory = $true)][int[]] $TcpPorts,
        [Parameter(Mandatory = $true)][int[]] $UdpPorts
    )

    try {
        $tcpListeners = @(Get-NetTCPConnection -State Listen -ErrorAction Stop)
    }
    catch {
        throw "Unable to inspect TCP listen endpoints: $($_.Exception.Message)"
    }
    try {
        $udpEndpoints = @(Get-NetUDPEndpoint -ErrorAction Stop)
    }
    catch {
        throw "Unable to inspect UDP endpoints: $($_.Exception.Message)"
    }

    $busy = @()
    $seen = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
    foreach ($port in $TcpPorts) {
        foreach ($connection in @($tcpListeners | Where-Object { $_.LocalPort -eq $port })) {
            $procId = [int]$connection.OwningProcess
            $key = "TCP|$port|$procId"
            if ($procId -gt 0 -and $seen.Add($key)) {
                $busy += [pscustomobject]@{ Port = $port; Protocol = 'TCP'; ProcId = $procId }
            }
        }
    }
    foreach ($port in $UdpPorts) {
        foreach ($connection in @($udpEndpoints | Where-Object { $_.LocalPort -eq $port })) {
            $procId = [int]$connection.OwningProcess
            $key = "UDP|$port|$procId"
            if ($procId -gt 0 -and $seen.Add($key)) {
                $busy += [pscustomobject]@{ Port = $port; Protocol = 'UDP'; ProcId = $procId }
            }
        }
    }
    return @($busy)
}

function Get-HostNativeProcessInfo {
    param([int] $ProcId)

    $cimProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $ProcId" -ErrorAction SilentlyContinue
    $process = Get-Process -Id $ProcId -ErrorAction SilentlyContinue
    $processName = ''
    $executablePath = ''
    $creationKey = ''
    $commandLine = ''
    $parentProcessId = 0
    if ($null -ne $cimProcess) {
        $processName = [System.IO.Path]::GetFileNameWithoutExtension([string]$cimProcess.Name)
        $executablePath = [string]$cimProcess.ExecutablePath
        $commandLine = [string]$cimProcess.CommandLine
        $parentProcessId = [int]$cimProcess.ParentProcessId
    }
    if ($null -ne $process) {
        if ([string]::IsNullOrWhiteSpace($processName)) {
            $processName = [string]$process.ProcessName
        }
        if ([string]::IsNullOrWhiteSpace($executablePath)) {
            try { $executablePath = [string]$process.Path } catch { $executablePath = '' }
        }
        try { $creationKey = $process.StartTime.ToUniversalTime().ToString('o') } catch { $creationKey = '' }
    }

    if ([string]::IsNullOrWhiteSpace($processName)) { $processName = '(unknown)' }
    return [pscustomobject]@{
        ProcessId = $ProcId
        Name = $processName
        ExecutablePath = $executablePath
        CreationKey = $creationKey
        CommandLine = $commandLine
        ParentProcessId = $parentProcessId
    }
}

function Get-DeploymentOwnershipEvidence {
    param(
        [Parameter(Mandatory = $true)] $ProcessInfo,
        [Parameter(Mandatory = $true)][string] $Root,
        [int[]] $PidFilePids = @()
    )

    $evidence = [System.Collections.Generic.List[string]]::new()
    if ($PidFilePids -contains [int]$ProcessInfo.ProcessId) {
        $evidence.Add('deployment-pidfile')
    }
    if (-not [string]::IsNullOrWhiteSpace([string]$ProcessInfo.ExecutablePath) -and
        (Test-SecurelyContainedPath -Candidate ([string]$ProcessInfo.ExecutablePath) -Root $Root)) {
        $evidence.Add('executable-path')
    }
    return @($evidence | Sort-Object -Unique)
}

function Test-CommandLinePathFlag {
    param(
        [AllowEmptyString()][string] $CommandLine,
        [Parameter(Mandatory = $true)][string] $Flag,
        [Parameter(Mandatory = $true)][string] $Path
    )
    if ([string]::IsNullOrWhiteSpace($CommandLine)) { return $false }
    $escapedFlag = [regex]::Escape($Flag)
    $escapedPath = [regex]::Escape((ConvertTo-NormalizedPath -Path $Path))
    $pathToken = '(?:"' + $escapedPath + '"|''' + $escapedPath + '''|' + $escapedPath + ')'
    return [regex]::IsMatch($CommandLine, '(?i)(?:^|\s)' + $escapedFlag + '(?:\s+|=)' + $pathToken + '(?=\s|$)')
}

function ConvertFrom-WindowsCommandLine {
    param([Parameter(Mandatory = $true)][AllowEmptyString()][string] $CommandLine)

    if ([string]::IsNullOrWhiteSpace($CommandLine)) { return @() }
    if ($null -eq ('SpecToDone.NativeCommandLine' -as [type])) {
        $typeDefinition = @'
using System;
using System.Runtime.InteropServices;

namespace SpecToDone {
    public static class NativeCommandLine {
        [DllImport("shell32.dll", SetLastError = true)]
        public static extern IntPtr CommandLineToArgvW(
            [MarshalAs(UnmanagedType.LPWStr)] string commandLine,
            out int argumentCount);

        [DllImport("kernel32.dll")]
        public static extern IntPtr LocalFree(IntPtr memory);
    }
}
'@
        Add-Type -TypeDefinition $typeDefinition -ErrorAction Stop
    }

    $argumentCount = 0
    $argumentVector = [SpecToDone.NativeCommandLine]::CommandLineToArgvW($CommandLine, [ref]$argumentCount)
    if ($argumentVector -eq [IntPtr]::Zero -or $argumentCount -lt 1) {
        throw 'CommandLineToArgvW could not parse the launcher command line'
    }

    $arguments = [System.Collections.Generic.List[string]]::new()
    try {
        for ($index = 0; $index -lt $argumentCount; $index++) {
            $argumentPointer = [System.Runtime.InteropServices.Marshal]::ReadIntPtr(
                $argumentVector,
                $index * [IntPtr]::Size
            )
            $arguments.Add([System.Runtime.InteropServices.Marshal]::PtrToStringUni($argumentPointer))
        }
    }
    finally {
        $null = [SpecToDone.NativeCommandLine]::LocalFree($argumentVector)
    }
    return @($arguments)
}

function Test-PowerShellFileEntrypoint {
    param(
        [AllowEmptyString()][string] $CommandLine,
        [Parameter(Mandatory = $true)][string] $ExpectedPath
    )

    try {
        $arguments = @(ConvertFrom-WindowsCommandLine -CommandLine $CommandLine)
    }
    catch {
        return $false
    }
    if ($arguments.Count -lt 3) { return $false }

    $fileIndex = -1
    for ($index = 1; $index -lt $arguments.Count; $index++) {
        $token = [string]$arguments[$index]
        if ($token -eq '--%' -or $token -eq '--') { return $false }
        if ($token -notmatch '^[-/]') { continue }

        $option = $token.TrimStart('-', '/')
        $separatorIndex = $option.IndexOfAny([char[]]@(':', '='))
        $hasInlineValue = $separatorIndex -ge 0
        $optionName = if ($hasInlineValue) { $option.Substring(0, $separatorIndex) } else { $option }
        if ([string]::IsNullOrWhiteSpace($optionName)) { continue }

        $isFileOption = 'file'.StartsWith($optionName, [System.StringComparison]::OrdinalIgnoreCase)
        $isCommandOption = 'command'.StartsWith($optionName, [System.StringComparison]::OrdinalIgnoreCase) -or
            'commandwithargs'.StartsWith($optionName, [System.StringComparison]::OrdinalIgnoreCase)
        $isEncodedCommandOption = 'encodedcommand'.StartsWith($optionName, [System.StringComparison]::OrdinalIgnoreCase)
        if ($isCommandOption -or $isEncodedCommandOption) { return $false }
        if (-not $isFileOption) { continue }

        # The deployment launchers use the canonical, separate-token -File form. Reject aliases,
        # inline values, and duplicates so a later script argument cannot masquerade as the entrypoint.
        if ($hasInlineValue -or
            -not [string]::Equals($token, '-File', [System.StringComparison]::OrdinalIgnoreCase) -or
            $fileIndex -ge 0) {
            return $false
        }
        $fileIndex = $index
    }

    if ($fileIndex -lt 0 -or $fileIndex + 1 -ge $arguments.Count) { return $false }
    return Test-SamePath -Left ([string]$arguments[$fileIndex + 1]) -Right $ExpectedPath
}

function Test-ListenerHasLauncherLineage {
    param(
        [Parameter(Mandatory = $true)] $ProcessInfo,
        [Parameter(Mandatory = $true)][string] $Root,
        [Parameter(Mandatory = $true)][AllowEmptyCollection()][object[]] $PidFileRecords,
        [Parameter(Mandatory = $true)][ValidateSet('kit', 'conversion')][string] $ServiceKind
    )

    $pidFileName = if ($ServiceKind -eq 'kit') { 'bim-streaming-server' } else { 'bim-streaming-conversion-service' }
    $entrypoint = if ($ServiceKind -eq 'kit') {
        Join-Path $Root 'bim-streaming-server\scripts\start-streaming-server.ps1'
    }
    else {
        Join-Path $Root 'bim-streaming-server\scripts\start-host-native-conversion-service.ps1'
    }
    $launcherRecord = $PidFileRecords | Where-Object { $_.Name -eq $pidFileName } | Select-Object -First 1
    if ($null -eq $launcherRecord) { return $false }

    $listenerStart = [datetime]::MinValue
    if (-not [datetime]::TryParse([string]$ProcessInfo.CreationKey, [ref]$listenerStart)) { return $false }
    $parentId = [int]$ProcessInfo.ParentProcessId
    $seen = [System.Collections.Generic.HashSet[int]]::new()
    for ($depth = 0; $depth -lt 8 -and $parentId -gt 0 -and $seen.Add($parentId); $depth++) {
        $ancestor = Get-HostNativeProcessInfo -ProcId $parentId
        $ancestorStart = [datetime]::MinValue
        if (-not [datetime]::TryParse([string]$ancestor.CreationKey, [ref]$ancestorStart) -or $ancestorStart -gt $listenerStart) {
            return $false
        }
        if ($parentId -eq [int]$launcherRecord.ProcId) {
            $launcherNameAllowed = $ancestor.Name -match '^(powershell|pwsh)$'
            return $launcherNameAllowed -and
                (Test-PowerShellFileEntrypoint -CommandLine ([string]$ancestor.CommandLine) -ExpectedPath $entrypoint)
        }
        $parentId = [int]$ancestor.ParentProcessId
    }
    return $false
}

function Get-DeploymentVenvBaseExecutables {
    param([Parameter(Mandatory = $true)][string] $Root)

    # Windows venv redirector topology: `.venv\Scripts\python.exe` is a launcher that spawns the
    # base interpreter recorded in pyvenv.cfg (`home = <dir>`) as a child, and that child is the
    # process that actually binds the port. Only that exact configured interpreter is acceptable.
    $configPath = Join-Path $Root '.venv\pyvenv.cfg'
    if (-not (Test-Path -LiteralPath $configPath -PathType Leaf)) { return @() }
    $homeDir = ''
    foreach ($line in @(Get-Content -LiteralPath $configPath -ErrorAction SilentlyContinue)) {
        if ([string]$line -match '^\s*home\s*=\s*(.+?)\s*$') { $homeDir = $Matches[1]; break }
    }
    if ([string]::IsNullOrWhiteSpace($homeDir) -or -not (Test-Path -LiteralPath $homeDir -PathType Container)) { return @() }
    $executables = [System.Collections.Generic.List[string]]::new()
    foreach ($name in @('python.exe', 'pythonw.exe')) {
        $candidate = Join-Path $homeDir $name
        if (Test-Path -LiteralPath $candidate -PathType Leaf) { $executables.Add($candidate) }
    }
    return @($executables)
}

function Get-RuntimeRoleEvidence {
    param(
        [Parameter(Mandatory = $true)] $PortOwner,
        [Parameter(Mandatory = $true)] $ProcessInfo,
        [Parameter(Mandatory = $true)][string] $Root,
        [Parameter(Mandatory = $true)][AllowEmptyCollection()][object[]] $PidFileRecords
    )

    if ($PortOwner.Protocol -eq 'TCP' -and [int]$PortOwner.Port -eq 49101) {
        $expectedPython = Join-Path $Root '.venv\Scripts\python.exe'
        $conversionCode = 'import host_native_conversion_service as s; raise SystemExit(s.main())'
        if ($ProcessInfo.Name -notmatch '^(python|pythonw)$' -or
            -not ([string]$ProcessInfo.CommandLine).Contains($conversionCode)) {
            return @()
        }

        if ((Test-SamePath -Left ([string]$ProcessInfo.ExecutablePath) -Right $expectedPython) -and
            (Test-SecurelyContainedPath -Candidate ([string]$ProcessInfo.ExecutablePath) -Root $Root) -and
            (Test-ListenerHasLauncherLineage -ProcessInfo $ProcessInfo -Root $Root -PidFileRecords $PidFileRecords -ServiceKind conversion)) {
            return @('conversion-launcher-lineage')
        }

        # Windows venv redirector: the listener is the pyvenv.cfg base interpreter whose direct
        # parent must be the deployment venv python running the exact conversion entrypoint, and
        # the full launcher lineage (pidfile powershell + exact -File entrypoint) must still hold.
        $venvBaseExecutables = @(Get-DeploymentVenvBaseExecutables -Root $Root)
        $listenerMatchesBase = $false
        foreach ($candidate in $venvBaseExecutables) {
            if (Test-SamePath -Left ([string]$ProcessInfo.ExecutablePath) -Right ([string]$candidate)) {
                $listenerMatchesBase = $true
                break
            }
        }
        if (-not $listenerMatchesBase) { return @() }

        $parentInfo = Get-HostNativeProcessInfo -ProcId ([int]$ProcessInfo.ParentProcessId)
        if ($parentInfo.Name -notmatch '^(python|pythonw)$' -or
            -not (Test-SamePath -Left ([string]$parentInfo.ExecutablePath) -Right $expectedPython) -or
            -not (Test-SecurelyContainedPath -Candidate ([string]$parentInfo.ExecutablePath) -Root $Root) -or
            -not ([string]$parentInfo.CommandLine).Contains($conversionCode) -or
            -not (Test-ListenerHasLauncherLineage -ProcessInfo $ProcessInfo -Root $Root -PidFileRecords $PidFileRecords -ServiceKind conversion)) {
            return @()
        }
        return @('conversion-venv-redirector-lineage')
    }

    $expectedKit = Join-Path $Root 'bim-streaming-server\_build\windows-x86_64\release\kit\kit.exe'
    $expectedExtensions = Join-Path $Root 'bim-streaming-server\source\extensions'
    $portKind = if ($PortOwner.Protocol -eq 'TCP') { 'signalPort' } else { 'streamPort' }
    $portTokenPattern = '(?i)(?:^|\s)--/exts/omni\.kit\.livestream\.app/(?:primaryStream|spectatorStream/[0-9]+)/' +
        $portKind + '=' + [regex]::Escape([string]$PortOwner.Port) + '(?=\s|$)'
    if ($ProcessInfo.Name -ne 'kit' -or
        -not (Test-SamePath -Left ([string]$ProcessInfo.ExecutablePath) -Right $expectedKit) -or
        -not (Test-CommandLinePathFlag -CommandLine ([string]$ProcessInfo.CommandLine) -Flag '--ext-folder' -Path $expectedExtensions) -or
        -not [regex]::IsMatch([string]$ProcessInfo.CommandLine, $portTokenPattern) -or
        -not (Test-ListenerHasLauncherLineage -ProcessInfo $ProcessInfo -Root $Root -PidFileRecords $PidFileRecords -ServiceKind kit)) {
        return @()
    }
    return @('kit-launcher-lineage')
}

function Get-PortRecordKey {
    param([Parameter(Mandatory = $true)] $Record)
    return "{0}|{1}|{2}" -f $Record.Protocol, $Record.Port, $Record.ProcId
}

function Test-ProcessIdentityMatch {
    param(
        [Parameter(Mandatory = $true)] $Expected,
        [Parameter(Mandatory = $true)] $Actual
    )

    if ([int]$Expected.ProcessId -ne [int]$Actual.ProcessId) { return $false }
    if (-not [string]::Equals([string]$Expected.Name, [string]$Actual.Name, [System.StringComparison]::OrdinalIgnoreCase)) {
        return $false
    }
    if ([string]::IsNullOrWhiteSpace([string]$Expected.CreationKey) -or
        -not [string]::Equals([string]$Expected.CreationKey, [string]$Actual.CreationKey, [System.StringComparison]::Ordinal)) {
        return $false
    }
    if ([string]::IsNullOrWhiteSpace([string]$Expected.ExecutablePath) -or
        -not (Test-SamePath -Left ([string]$Expected.ExecutablePath) -Right ([string]$Actual.ExecutablePath))) {
        return $false
    }
    return $true
}

function Get-HostNativePortSnapshot {
    param(
        [Parameter(Mandatory = $true)][int[]] $TcpPorts,
        [Parameter(Mandatory = $true)][int[]] $UdpPorts,
        [Parameter(Mandatory = $true)][string] $Root
    )

    $busy = @(Get-BusyPorts -TcpPorts $TcpPorts -UdpPorts $UdpPorts)
    if ($busy.Count -eq 0) { return @() }

    $pidFileRecords = @(Get-DeploymentPidFileRecords -Root $Root)
    $pidFilePids = @($pidFileRecords | ForEach-Object { [int]$_.ProcId })
    $processCache = @{}
    $records = @()
    foreach ($item in $busy) {
        $cacheKey = [string]$item.ProcId
        if (-not $processCache.ContainsKey($cacheKey)) {
            $processCache[$cacheKey] = Get-HostNativeProcessInfo -ProcId $item.ProcId
        }
        $processInfo = $processCache[$cacheKey]
        $ownership = @(@(
                @(Get-DeploymentOwnershipEvidence -ProcessInfo $processInfo -Root $Root -PidFilePids $pidFilePids)
                @(Get-RuntimeRoleEvidence -PortOwner $item -ProcessInfo $processInfo -Root $Root -PidFileRecords $pidFileRecords)
            ) | Sort-Object -Unique)
        $nameAllowed = $processInfo.Name -match $script:KillableHostNativeProcessPattern
        $hasRuntimeRoleProof = ($ownership -contains 'kit-launcher-lineage') -or
            ($ownership -contains 'conversion-launcher-lineage') -or
            ($ownership -contains 'conversion-venv-redirector-lineage')
        $hasCreationIdentity = -not [string]::IsNullOrWhiteSpace([string]$processInfo.CreationKey)
        $records += [pscustomobject]@{
            Port = [int]$item.Port
            Protocol = [string]$item.Protocol
            ProcId = [int]$item.ProcId
            ProcessInfo = $processInfo
            Ownership = @($ownership)
            NameAllowed = $nameAllowed
            SafeToStop = ($nameAllowed -and $hasRuntimeRoleProof -and $hasCreationIdentity)
        }
    }
    return @($records)
}

function Test-PortSnapshotsExact {
    param(
        [Parameter(Mandatory = $true)][object[]] $Expected,
        [Parameter(Mandatory = $true)][object[]] $Actual
    )

    if ($Expected.Count -ne $Actual.Count) { return $false }
    $expectedByKey = @{}
    foreach ($record in $Expected) {
        $key = Get-PortRecordKey -Record $record
        if ($expectedByKey.ContainsKey($key)) { return $false }
        $expectedByKey[$key] = $record
    }
    $actualKeys = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
    foreach ($record in $Actual) {
        $key = Get-PortRecordKey -Record $record
        if (-not $actualKeys.Add($key) -or -not $record.SafeToStop -or -not $expectedByKey.ContainsKey($key)) {
            return $false
        }
        if (-not (Test-ProcessIdentityMatch -Expected $expectedByKey[$key].ProcessInfo -Actual $record.ProcessInfo)) {
            return $false
        }
    }
    return $true
}

function Test-PortSnapshotSubset {
    param(
        [Parameter(Mandatory = $true)][object[]] $Baseline,
        [Parameter(Mandatory = $true)][object[]] $Current
    )

    $baselineByKey = @{}
    foreach ($record in $Baseline) {
        $baselineByKey[(Get-PortRecordKey -Record $record)] = $record
    }
    $currentKeys = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
    foreach ($record in $Current) {
        $key = Get-PortRecordKey -Record $record
        if (-not $currentKeys.Add($key) -or -not $record.SafeToStop -or -not $baselineByKey.ContainsKey($key)) {
            return $false
        }
        if (-not (Test-ProcessIdentityMatch -Expected $baselineByKey[$key].ProcessInfo -Actual $record.ProcessInfo)) {
            return $false
        }
    }
    return $true
}

function Invoke-ValidatedProcessStop {
    param([Parameter(Mandatory = $true)] $ExpectedProcess)

    $current = Get-HostNativeProcessInfo -ProcId ([int]$ExpectedProcess.ProcessId)
    if (-not (Test-ProcessIdentityMatch -Expected $ExpectedProcess -Actual $current)) {
        return $false
    }

    $process = Get-Process -Id ([int]$ExpectedProcess.ProcessId) -ErrorAction SilentlyContinue
    if ($null -eq $process) { return $false }
    try {
        # Acquire and retain the exact process handle first. Every final identity read and Kill()
        # below is performed through this same Process instance/handle, closing the PID-reuse gap.
        $null = $process.Handle
        $startKey = $process.StartTime.ToUniversalTime().ToString('o')
        if (-not [string]::Equals($startKey, [string]$ExpectedProcess.CreationKey, [System.StringComparison]::Ordinal)) {
            return $false
        }
        $handleImagePath = [string]$process.Path
        if (-not (Test-SamePath -Left $handleImagePath -Right ([string]$ExpectedProcess.ExecutablePath)) -or
            -not [string]::Equals([string]$process.ProcessName, [string]$ExpectedProcess.Name, [System.StringComparison]::OrdinalIgnoreCase)) {
            return $false
        }
        $process.Kill()
        return $true
    }
    catch {
        return $false
    }
    finally {
        $process.Dispose()
    }
}

function Invoke-HostNativePortCleanup {
    param(
        [Parameter(Mandatory = $true)][int[]] $TcpPorts,
        [Parameter(Mandatory = $true)][int[]] $UdpPorts,
        [ValidateRange(1, 600)][int] $WaitTimeoutSec,
        [switch] $ReadOnly,
        [switch] $AllowOwnedStop,
        [string] $TargetDeploymentRoot
    )

    if ($ReadOnly -and $AllowOwnedStop) {
        Write-Host '[held ] -DetectOnly and -StopOwnedRuntime cannot be combined'
        return 2
    }

    $resolvedDeploymentRoot = ''
    $expectedTopology = $null
    if ($AllowOwnedStop) {
        if ([string]::IsNullOrWhiteSpace($TargetDeploymentRoot)) {
            Write-Host '[held ] -StopOwnedRuntime requires -DeploymentRoot'
            return 2
        }
        try {
            $resolvedDeploymentRoot = Assert-CanonicalTestDeploymentRoot -Path $TargetDeploymentRoot
            $expectedTopology = Get-DeploymentPortTopology -Root $resolvedDeploymentRoot
            if (-not (Test-IntArrayExact -Left @($TcpPorts | Sort-Object -Unique) -Right @($expectedTopology.TcpPorts)) -or
                -not (Test-IntArrayExact -Left @($UdpPorts | Sort-Object -Unique) -Right @($expectedTopology.UdpPorts))) {
                throw 'Explicit cleanup ports do not match the canonical deployment topology snapshot'
            }
        }
        catch {
            Write-Host ("[held ] {0}" -f $_.Exception.Message)
            return 2
        }
    }

    if (-not $AllowOwnedStop) {
        try {
            $busy = @(Get-BusyPorts -TcpPorts $TcpPorts -UdpPorts $UdpPorts)
        }
        catch {
            Write-Host ("[held ] port inspection unavailable; no process was stopped: {0}" -f $_.Exception.Message)
            return 2
        }
        if ($busy.Count -eq 0) {
            Write-Host '[detect] all required host-native ports FREE; no process stopped'
            return 0
        }
        Write-Host '[detect] required host-native ports occupied; default mode is read-only:'
        foreach ($item in $busy) {
            $processInfo = Get-HostNativeProcessInfo -ProcId $item.ProcId
            Write-Host ("         {0}/{1} PID={2} ({3}) ownership=not-evaluated -> HELD" -f
                $item.Protocol, $item.Port, $item.ProcId, $processInfo.Name)
        }
        return 1
    }

    try {
        $initialSnapshot = @(Get-HostNativePortSnapshot -TcpPorts $TcpPorts -UdpPorts $UdpPorts -Root $resolvedDeploymentRoot)
    }
    catch {
        Write-Host ("[held ] port inspection unavailable; no process was stopped: {0}" -f $_.Exception.Message)
        return 2
    }
    if ($initialSnapshot.Count -eq 0) {
        Write-Host '[ports-free] all required host-native ports FREE'
        return 0
    }

    foreach ($record in $initialSnapshot) {
        $ownershipLabel = if ($record.Ownership.Count -gt 0) { $record.Ownership -join '+' } else { 'unproven' }
        Write-Host ("[inspect] {0}/{1} PID={2} ({3}) ownership={4} allowlisted={5} creation-identity={6}" -f
            $record.Protocol, $record.Port, $record.ProcId, $record.ProcessInfo.Name, $ownershipLabel,
            $record.NameAllowed, (-not [string]::IsNullOrWhiteSpace([string]$record.ProcessInfo.CreationKey)))
    }
    if (@($initialSnapshot | Where-Object { -not $_.SafeToStop }).Count -gt 0) {
        Write-Host '[held ] port/process-name/pidfile evidence is insufficient; no process was stopped'
        return 1
    }

    # Take a complete second snapshot before the first stop. Every protocol/port/PID and process
    # identity must remain exact, otherwise a race or PID reuse is treated as HELD.
    if (-not (Test-DeploymentTopologyUnchanged -Root $resolvedDeploymentRoot -Expected $expectedTopology)) {
        Write-Host '[held ] deployment topology changed before cleanup; no process was stopped'
        return 1
    }
    try {
        $confirmedSnapshot = @(Get-HostNativePortSnapshot -TcpPorts $TcpPorts -UdpPorts $UdpPorts -Root $resolvedDeploymentRoot)
    }
    catch {
        Write-Host ("[held ] confirmation inspection unavailable; no process was stopped: {0}" -f $_.Exception.Message)
        return 2
    }
    if ($confirmedSnapshot.Count -eq 0) {
        Write-Host '[ports-free] required ports became FREE before cleanup; no process stopped'
        return 0
    }
    if (-not (Test-PortSnapshotsExact -Expected $initialSnapshot -Actual $confirmedSnapshot)) {
        Write-Host '[held ] port ownership or process identity changed before cleanup; no process was stopped'
        return 1
    }

    $deadline = (Get-Date).ToUniversalTime().AddSeconds($WaitTimeoutSec)
    foreach ($processGroup in @($confirmedSnapshot | Group-Object ProcId)) {
        if (-not (Test-DeploymentTopologyUnchanged -Root $resolvedDeploymentRoot -Expected $expectedTopology)) {
            Write-Host '[held ] deployment topology changed during cleanup; no further process was stopped'
            return 1
        }
        try {
            $currentSnapshot = @(Get-HostNativePortSnapshot -TcpPorts $TcpPorts -UdpPorts $UdpPorts -Root $resolvedDeploymentRoot)
        }
        catch {
            Write-Host ("[held ] pre-stop inspection unavailable; no further process was stopped: {0}" -f $_.Exception.Message)
            return 2
        }
        if ($currentSnapshot.Count -eq 0) {
            Write-Host '[ports-free] all required host-native ports FREE'
            return 0
        }
        if (-not (Test-PortSnapshotSubset -Baseline $confirmedSnapshot -Current $currentSnapshot)) {
            Write-Host '[held ] a port owner or process identity changed during cleanup; no further process was stopped'
            return 1
        }
        if (-not (Test-DeploymentTopologyUnchanged -Root $resolvedDeploymentRoot -Expected $expectedTopology)) {
            Write-Host '[held ] deployment topology changed after pre-stop inspection; no further process was stopped'
            return 1
        }

        $procId = [int]$processGroup.Name
        $currentProcessRecords = @($currentSnapshot | Where-Object { $_.ProcId -eq $procId })
        if ($currentProcessRecords.Count -eq 0) { continue }
        $sample = $currentProcessRecords | Select-Object -First 1
        $ports = @($currentProcessRecords | ForEach-Object { "$($_.Protocol)/$($_.Port)" }) -join ','
        $ownership = @($currentProcessRecords | ForEach-Object { $_.Ownership } | Sort-Object -Unique) -join '+'
        Write-Host ("[stop  ] ports={0} PID={1} ({2}) ownership={3} -> exact validated process handle" -f
            $ports, $procId, $sample.ProcessInfo.Name, $ownership)
        if (-not (Invoke-ValidatedProcessStop -ExpectedProcess $sample.ProcessInfo)) {
            try {
                $remaining = @(Get-BusyPorts -TcpPorts $TcpPorts -UdpPorts $UdpPorts)
            }
            catch {
                Write-Host ("[held ] stop identity changed and reinspection failed: {0}" -f $_.Exception.Message)
                return 2
            }
            if ($remaining.Count -eq 0) {
                Write-Host '[ports-free] process exited before stop; all required host-native ports FREE'
                return 0
            }
            Write-Host ("[held ] exact process identity changed or stop failed for PID={0}; no further process was stopped" -f $procId)
            return 1
        }
    }

    while ((Get-Date).ToUniversalTime() -lt $deadline) {
        try {
            $remaining = @(Get-BusyPorts -TcpPorts $TcpPorts -UdpPorts $UdpPorts)
        }
        catch {
            Write-Host ("[held ] post-stop port inspection unavailable: {0}" -f $_.Exception.Message)
            return 2
        }
        if ($remaining.Count -eq 0) {
            Write-Host '[ports-free] all required host-native ports FREE'
            return 0
        }
        Start-Sleep -Milliseconds 250
    }

    Write-Host '[fail  ] timeout: required host-native ports remain occupied after ownership-gated stop attempts'
    return 1
}

if ($MyInvocation.InvocationName -ne '.') {
    try {
        $resolvedTimeoutSec = ConvertTo-ValidatedInt -Name 'TimeoutSec' -Value $TimeoutSec -Min 1 -Max 600
    }
    catch {
        Write-Host ("[held ] {0}" -f $_.Exception.Message)
        exit 2
    }
    if ($DetectOnly -and $StopOwnedRuntime) {
        Write-Host '[held ] -DetectOnly and -StopOwnedRuntime cannot be combined'
        exit 2
    }

    if ($StopOwnedRuntime) {
        $topologyParameters = @(
            'KitSignalPort', 'KitMediaPort', 'ConversionPort', 'SpectatorCount',
            'SpectatorSignalStart', 'SpectatorMediaStart', 'SpectatorStride'
        )
        if (@($topologyParameters | Where-Object { $PSBoundParameters.ContainsKey($_) }).Count -gt 0) {
            Write-Host '[held ] explicit stop derives ports from the canonical deployment topology; caller port overrides are forbidden'
            exit 2
        }
        try {
            $resolvedRoot = Assert-CanonicalTestDeploymentRoot -Path $DeploymentRoot
            $topology = Get-DeploymentPortTopology -Root $resolvedRoot
            $tcpPorts = @($topology.TcpPorts)
            $udpPorts = @($topology.UdpPorts)
        }
        catch {
            Write-Host ("[held ] {0}" -f $_.Exception.Message)
            exit 2
        }
    }
    else {
        try {
            $resolvedKitSignalPort = ConvertTo-ValidatedInt -Name 'KitSignalPort' -Value $KitSignalPort -Min 1 -Max 65535
            $resolvedKitMediaPort = ConvertTo-ValidatedInt -Name 'KitMediaPort' -Value $KitMediaPort -Min 1 -Max 65535
            $resolvedConversionPort = ConvertTo-ValidatedInt -Name 'ConversionPort' -Value $ConversionPort -Min 1 -Max 65535
            $resolvedSpectatorCount = ConvertTo-ValidatedInt -Name 'SpectatorCount' -Value $SpectatorCount -Min 0 -Max 32
            $resolvedSpectatorSignalStart = ConvertTo-ValidatedInt -Name 'SpectatorSignalStart' -Value $SpectatorSignalStart -Min 1 -Max 65535
            $resolvedSpectatorMediaStart = ConvertTo-ValidatedInt -Name 'SpectatorMediaStart' -Value $SpectatorMediaStart -Min 1 -Max 65535
            $resolvedSpectatorStride = ConvertTo-ValidatedInt -Name 'SpectatorStride' -Value $SpectatorStride -Min 1 -Max 1000
        }
        catch {
            Write-Host ("[held ] {0}" -f $_.Exception.Message)
            exit 2
        }
        $tcpPorts = @($resolvedKitSignalPort, $resolvedConversionPort)
        $udpPorts = @($resolvedKitMediaPort)
        for ($index = 0; $index -lt $resolvedSpectatorCount; $index++) {
            $derivedTcpPort = $resolvedSpectatorSignalStart + ($index * $resolvedSpectatorStride)
            $derivedUdpPort = $resolvedSpectatorMediaStart + ($index * $resolvedSpectatorStride)
            if ($derivedTcpPort -gt 65535 -or $derivedUdpPort -gt 65535) {
                Write-Host '[held ] derived spectator port exceeds 65535'
                exit 2
            }
            $tcpPorts += $derivedTcpPort
            $udpPorts += $derivedUdpPort
        }
        $tcpPorts = @($tcpPorts | Sort-Object -Unique)
        $udpPorts = @($udpPorts | Sort-Object -Unique)
    }

    $exitCode = Invoke-HostNativePortCleanup `
        -TcpPorts $tcpPorts `
        -UdpPorts $udpPorts `
        -WaitTimeoutSec $resolvedTimeoutSec `
        -ReadOnly:$DetectOnly `
        -AllowOwnedStop:$StopOwnedRuntime `
        -TargetDeploymentRoot $DeploymentRoot
    exit $exitCode
}
