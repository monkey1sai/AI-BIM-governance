# Behavioral safety tests for the shared host-native port helper.

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$helperPath = Join-Path $repoRoot 'scripts\dev\ensure-host-native-ports-free.ps1'

function Assert-True {
    param([bool] $Condition, [string] $Message)
    if (-not $Condition) { throw "Assertion failed: $Message" }
}

function New-TestPortRecord {
    param(
        [int] $ProcId,
        [int] $Port,
        [string] $Protocol,
        [string] $Name,
        [string] $ExecutablePath,
        [string] $CreationKey,
        [bool] $SafeToStop,
        [string[]] $Ownership = @('executable-path')
    )

    $processInfo = [pscustomobject]@{
        ProcessId = $ProcId
        Name = $Name
        ExecutablePath = $ExecutablePath
        CreationKey = $CreationKey
        CommandLine = ''
        ParentProcessId = 0
    }
    return [pscustomobject]@{
        Port = $Port
        Protocol = $Protocol
        ProcId = $ProcId
        ProcessInfo = $processInfo
        Ownership = @($Ownership)
        NameAllowed = ($Name -match '^(kit|kitd|python|pythonw|nvstreamer|pvd_streamer)$')
        SafeToStop = $SafeToStop
    }
}

$helperBody = Get-Content -LiteralPath $helperPath -Raw -Encoding UTF8
Assert-True (-not ($helperBody -match 'command-line-path|Test-TextContainsPathBoundary')) 'arbitrary command-line substrings cannot authorize a stop'
Assert-True ($helperBody -match '\$process\.Handle' -and $helperBody -match '\$process\.Kill\(\)') 'stop uses an exact acquired process handle'
Assert-True (-not ($helperBody -match 'GetEnvironmentVariable\(\$Name')) 'explicit stop topology never falls back to caller process environment'

. $helperPath
$ErrorActionPreference = 'Stop'

$tempBase = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath()).TrimEnd('\')
$tempRoot = Join-Path $tempBase ("spec-to-done-port-helper-{0}" -f [guid]::NewGuid().ToString('N'))
$previousLogRoot = $env:LOG_ROOT
$env:LOG_ROOT = Join-Path $tempRoot 'must-not-create-logs'
$previousConsoleOut = [Console]::Out
$eventWriter = New-Object System.IO.StringWriter
[Console]::SetOut($eventWriter)
try {
    $null = New-Item -ItemType Directory -Force -Path (Join-Path $tempRoot 'scripts')
    $null = New-Item -ItemType Directory -Force -Path (Join-Path $tempRoot '.venv\Scripts')
    Set-Content -LiteralPath (Join-Path $tempRoot 'scripts\deploy.ps1') -Value '# marker' -Encoding ASCII
    Set-Content -LiteralPath (Join-Path $tempRoot '.venv\Scripts\python.exe') -Value '' -Encoding ASCII
    $null = New-Item -ItemType Directory -Force -Path (Join-Path $tempRoot 'basepython')
    Set-Content -LiteralPath (Join-Path $tempRoot 'basepython\python.exe') -Value '' -Encoding ASCII
    Set-Content -LiteralPath (Join-Path $tempRoot '.venv\pyvenv.cfg') -Encoding ASCII -Value @(
        ('home = ' + (Join-Path $tempRoot 'basepython')),
        'include-system-site-packages = false',
        'version = 3.12.0'
    )
    Set-Content -LiteralPath (Join-Path $tempRoot '.env.web-plane.host-kit') -Encoding ASCII -Value @(
        'KIT_SIGNALING_PORT=50100',
        'KIT_MEDIA_PORT=48998',
        'KIT_SPECTATOR_COUNT=2',
        'KIT_SPECTATOR_SIGNALING_PORT_START=50110',
        'KIT_SPECTATOR_MEDIA_PORT_START=49008',
        'KIT_SPECTATOR_PORT_STRIDE=10'
    )

    $script:CanonicalTestDeploymentRoot = $tempRoot
    Assert-True (Test-SamePath -Left $tempRoot -Right ($tempRoot.ToUpperInvariant() + '\')) 'canonical path comparison is case-insensitive and slash-safe'
    Assert-True (-not (Test-PathContained -Candidate ($tempRoot + '-evil\python.exe') -Root $tempRoot)) 'path containment rejects prefix collisions'
    Assert-True ((Assert-CanonicalTestDeploymentRoot -Path $tempRoot) -eq $tempRoot) 'canonical root marker and non-reparse path are accepted'

    $topology = Get-DeploymentPortTopology -Root $tempRoot
    Assert-True ((@($topology.TcpPorts) -join ',') -eq '49101,50100,50110,50120') 'explicit cleanup derives TCP ports from deployment topology'
    Assert-True ((@($topology.UdpPorts) -join ',') -eq '48998,49008,49018') 'explicit cleanup derives UDP ports from deployment topology'
    Assert-True (Test-DeploymentTopologyUnchanged -Root $tempRoot -Expected $topology) 'deployment topology fingerprint initially matches'
    $topologyBytes = [System.IO.File]::ReadAllBytes($topology.Source)
    Add-Content -LiteralPath $topology.Source -Value '# concurrent change' -Encoding ASCII
    Assert-True (-not (Test-DeploymentTopologyUnchanged -Root $tempRoot -Expected $topology)) 'deployment topology mutation invalidates the immutable snapshot'
    [System.IO.File]::WriteAllBytes($topology.Source, $topologyBytes)
    Assert-True (Test-DeploymentTopologyUnchanged -Root $tempRoot -Expected $topology) 'restored deployment topology matches the original fingerprint'

    $expectedKit = Join-Path $tempRoot 'bim-streaming-server\_build\windows-x86_64\release\kit\kit.exe'
    $expectedExtensions = Join-Path $tempRoot 'bim-streaming-server\source\extensions'
    $kitListener = [pscustomobject]@{
        ProcessId = 210
        Name = 'kit'
        ExecutablePath = $expectedKit
        CreationKey = '2026-07-24T00:00:02.0000000Z'
        CommandLine = ('"{0}" --ext-folder {1} --/exts/omni.kit.livestream.app/primaryStream/signalPort=50100' -f $expectedKit, $expectedExtensions)
        ParentProcessId = 211
    }
    $kitLauncher = [pscustomobject]@{
        ProcessId = 211
        Name = 'powershell'
        ExecutablePath = 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe'
        CreationKey = '2026-07-24T00:00:01.0000000Z'
        CommandLine = ('powershell.exe -NoProfile -File {0}' -f (Join-Path $tempRoot 'bim-streaming-server\scripts\start-streaming-server.ps1'))
        ParentProcessId = 0
    }
    $conversionListener = [pscustomobject]@{
        ProcessId = 310
        Name = 'python'
        ExecutablePath = (Join-Path $tempRoot '.venv\Scripts\python.exe')
        CreationKey = '2026-07-24T00:00:02.0000000Z'
        CommandLine = 'python.exe -c "import host_native_conversion_service as s; raise SystemExit(s.main())"'
        ParentProcessId = 311
    }
    $conversionLauncher = [pscustomobject]@{
        ProcessId = 311
        Name = 'powershell'
        ExecutablePath = 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe'
        CreationKey = '2026-07-24T00:00:01.0000000Z'
        CommandLine = ('powershell.exe -NoProfile -File {0}' -f (Join-Path $tempRoot 'bim-streaming-server\scripts\start-host-native-conversion-service.ps1'))
        ParentProcessId = 0
    }
    $kitEntrypoint = Join-Path $tempRoot 'bim-streaming-server\scripts\start-streaming-server.ps1'
    $decoyEntrypoint = Join-Path $tempRoot 'scripts\decoy.ps1'
    Assert-True (Test-PowerShellFileEntrypoint -CommandLine $kitLauncher.CommandLine -ExpectedPath $kitEntrypoint) 'launcher parser accepts one exact -File entrypoint'
    Assert-True (-not (Test-PowerShellFileEntrypoint -CommandLine ('powershell.exe -File "{0}" -File "{1}"' -f $decoyEntrypoint, $kitEntrypoint) -ExpectedPath $kitEntrypoint)) 'decoy-first and expected-second -File is rejected'
    Assert-True (-not (Test-PowerShellFileEntrypoint -CommandLine ('powershell.exe -Command "Write-Output decoy" -File "{0}"' -f $kitEntrypoint) -ExpectedPath $kitEntrypoint)) 'mixed -Command and -File launcher modes are rejected'
    Assert-True (-not (Test-PowerShellFileEntrypoint -CommandLine ('powershell.exe -EncodedCommand ZQB4AGkAdAA= -File "{0}"' -f $kitEntrypoint) -ExpectedPath $kitEntrypoint)) 'mixed -EncodedCommand and -File launcher modes are rejected'
    & {
        function Get-HostNativeProcessInfo {
            param([int] $ProcId)
            if ($ProcId -eq 211) { return $kitLauncher }
            if ($ProcId -eq 311) { return $conversionLauncher }
            throw 'unexpected ancestor'
        }
        $kitRole = @(Get-RuntimeRoleEvidence -PortOwner ([pscustomobject]@{ Protocol = 'TCP'; Port = 50100 }) -ProcessInfo $kitListener -Root $tempRoot -PidFileRecords @([pscustomobject]@{ Name = 'bim-streaming-server'; ProcId = 211 }))
        Assert-True ($kitRole -contains 'kit-launcher-lineage') 'Kit port requires exact port argument and deployment launcher ancestry'
        $conversionRole = @(Get-RuntimeRoleEvidence -PortOwner ([pscustomobject]@{ Protocol = 'TCP'; Port = 49101 }) -ProcessInfo $conversionListener -Root $tempRoot -PidFileRecords @([pscustomobject]@{ Name = 'bim-streaming-conversion-service'; ProcId = 311 }))
        Assert-True ($conversionRole -contains 'conversion-launcher-lineage') 'conversion port requires exact service command and deployment launcher ancestry'
        $sharedPythonRole = @(Get-RuntimeRoleEvidence -PortOwner ([pscustomobject]@{ Protocol = 'TCP'; Port = 50100 }) -ProcessInfo ([pscustomobject]@{ ProcessId=212;Name='python';ExecutablePath=(Join-Path $tempRoot '.venv\Scripts\python.exe');CreationKey='2026-07-24T00:00:02.0000000Z';CommandLine='python maintenance.py';ParentProcessId=211 }) -Root $tempRoot -PidFileRecords @([pscustomobject]@{ Name = 'bim-streaming-server'; ProcId = 211 }))
        Assert-True ($sharedPythonRole.Count -eq 0) 'deployment-shared Python cannot satisfy a Kit port role'
    }
    & {
        $venvRedirector = [pscustomobject]@{
            ProcessId = 312
            Name = 'python'
            ExecutablePath = (Join-Path $tempRoot '.venv\Scripts\python.exe')
            CreationKey = '2026-07-24T00:00:02.0000000Z'
            CommandLine = 'python.exe -c "import host_native_conversion_service as s; raise SystemExit(s.main())"'
            ParentProcessId = 311
        }
        function Get-HostNativeProcessInfo {
            param([int] $ProcId)
            if ($ProcId -eq 312) { return $venvRedirector }
            if ($ProcId -eq 311) { return $conversionLauncher }
            throw 'unexpected ancestor'
        }
        $conversionRecords = @([pscustomobject]@{ Name = 'bim-streaming-conversion-service'; ProcId = 311 })
        $baseInterpreterListener = [pscustomobject]@{
            ProcessId = 320
            Name = 'python'
            ExecutablePath = (Join-Path $tempRoot 'basepython\python.exe')
            CreationKey = '2026-07-24T00:00:03.0000000Z'
            CommandLine = 'python.exe -c "import host_native_conversion_service as s; raise SystemExit(s.main())"'
            ParentProcessId = 312
        }
        $redirectorRole = @(Get-RuntimeRoleEvidence -PortOwner ([pscustomobject]@{ Protocol = 'TCP'; Port = 49101 }) -ProcessInfo $baseInterpreterListener -Root $tempRoot -PidFileRecords $conversionRecords)
        Assert-True ($redirectorRole -contains 'conversion-venv-redirector-lineage') 'pyvenv.cfg base interpreter with venv redirector parent and launcher lineage is accepted'

        $foreignBaseListener = [pscustomobject]@{
            ProcessId = 321
            Name = 'python'
            ExecutablePath = 'C:\Python312\python.exe'
            CreationKey = '2026-07-24T00:00:03.0000000Z'
            CommandLine = 'python.exe -c "import host_native_conversion_service as s; raise SystemExit(s.main())"'
            ParentProcessId = 312
        }
        Assert-True (@(Get-RuntimeRoleEvidence -PortOwner ([pscustomobject]@{ Protocol = 'TCP'; Port = 49101 }) -ProcessInfo $foreignBaseListener -Root $tempRoot -PidFileRecords $conversionRecords).Count -eq 0) 'an interpreter not recorded in pyvenv.cfg home cannot claim the conversion role'

        $orphanBaseListener = [pscustomobject]@{
            ProcessId = 322
            Name = 'python'
            ExecutablePath = (Join-Path $tempRoot 'basepython\python.exe')
            CreationKey = '2026-07-24T00:00:03.0000000Z'
            CommandLine = 'python.exe -c "import host_native_conversion_service as s; raise SystemExit(s.main())"'
            ParentProcessId = 311
        }
        Assert-True (@(Get-RuntimeRoleEvidence -PortOwner ([pscustomobject]@{ Protocol = 'TCP'; Port = 49101 }) -ProcessInfo $orphanBaseListener -Root $tempRoot -PidFileRecords $conversionRecords).Count -eq 0) 'a base interpreter without the venv redirector parent is rejected'
    }
    & {
        function Get-BusyPorts { param([int[]] $TcpPorts, [int[]] $UdpPorts); return @([pscustomobject]@{ Port = 50100; Protocol = 'TCP'; ProcId = 210 }) }
        function Get-DeploymentPidFileRecords { param([string] $Root); return @([pscustomobject]@{ Name = 'bim-streaming-server'; ProcId = 211 }) }
        function Get-HostNativeProcessInfo {
            param([int] $ProcId)
            if ($ProcId -eq 210) { return $kitListener }
            if ($ProcId -eq 211) { return $kitLauncher }
            throw 'unexpected process'
        }
        $kitSnapshot = @(Get-HostNativePortSnapshot -TcpPorts $topology.TcpPorts -UdpPorts $topology.UdpPorts -Root $tempRoot)
        Assert-True ($kitSnapshot.Count -eq 1 -and $kitSnapshot[0].SafeToStop) 'snapshot wires exact Kit launcher lineage into SafeToStop'
        Assert-True ($kitSnapshot[0].Ownership -contains 'kit-launcher-lineage') 'snapshot records non-spoofable Kit role evidence'
    }

    $ownedExecutable = Join-Path $tempRoot '.venv\Scripts\python.exe'
    $ownedProcess = [pscustomobject]@{
        ProcessId = 123
        Name = 'python'
        ExecutablePath = $ownedExecutable
        CreationKey = '2026-07-24T00:00:00.0000000Z'
        CommandLine = ''
        ParentProcessId = 0
    }
    $pidOnlyProcess = [pscustomobject]@{
        ProcessId = 456
        Name = 'python'
        ExecutablePath = 'C:\Python312\python.exe'
        CreationKey = '2026-07-24T00:00:01.0000000Z'
        CommandLine = ''
        ParentProcessId = 0
    }
    $ownedEvidence = @(Get-DeploymentOwnershipEvidence -ProcessInfo $ownedProcess -Root $tempRoot)
    Assert-True ($ownedEvidence.Count -eq 1 -and $ownedEvidence[0] -eq 'executable-path') 'securely contained executable proves ownership'
    $pidOnlyEvidence = @(Get-DeploymentOwnershipEvidence -ProcessInfo $pidOnlyProcess -Root $tempRoot -PidFilePids @(456))
    Assert-True ($pidOnlyEvidence.Count -eq 1 -and $pidOnlyEvidence[0] -eq 'deployment-pidfile') 'pidfile is retained only as advisory evidence'

    & {
        function Get-NetTCPConnection {
            param([string] $State, [System.Management.Automation.ActionPreference] $ErrorAction)
            return @(
                [pscustomobject]@{ LocalPort = 49101; OwningProcess = 123 },
                [pscustomobject]@{ LocalPort = 49101; OwningProcess = 456 }
            )
        }
        function Get-NetUDPEndpoint { param([System.Management.Automation.ActionPreference] $ErrorAction); return @() }
        $samePortOwners = @(Get-BusyPorts -TcpPorts @(49101) -UdpPorts @(47998))
        Assert-True ($samePortOwners.Count -eq 2) 'every owner of the same target port is classified'
    }

    & {
        function Get-BusyPorts { param([int[]] $TcpPorts, [int[]] $UdpPorts); return @([pscustomobject]@{ Port = 49101; Protocol = 'TCP'; ProcId = 456 }) }
        function Get-DeploymentPidFilePids { param([string] $Root); return @(456) }
        function Get-HostNativeProcessInfo { param([int] $ProcId); return $pidOnlyProcess }
        $pidOnlySnapshot = @(Get-HostNativePortSnapshot -TcpPorts @(49101) -UdpPorts @(47998) -Root $tempRoot)
        Assert-True (-not $pidOnlySnapshot[0].SafeToStop) 'stale or reused pidfile identity cannot independently authorize stop'
    }

    & {
        $script:SpecToDoneStopCalls = 0
        function Get-BusyPorts { param([int[]] $TcpPorts, [int[]] $UdpPorts); return @([pscustomobject]@{ Port = 49101; Protocol = 'TCP'; ProcId = 456 }) }
        function Get-HostNativeProcessInfo { param([int] $ProcId); return $pidOnlyProcess }
        function Invoke-ValidatedProcessStop { param($ExpectedProcess); $script:SpecToDoneStopCalls++; return $true }
        $detectExit = Invoke-HostNativePortCleanup -TcpPorts @(49101) -UdpPorts @(47998) -WaitTimeoutSec 1
        Assert-True ($detectExit -is [int] -and $detectExit -eq 1) 'default mode reports a scalar HELD exit without log pipeline output'
        Assert-True ($script:SpecToDoneStopCalls -eq 0) 'default mode never stops a process'
    }

    & {
        $script:SpecToDoneStopCalls = 0
        function Get-BusyPorts { param([int[]] $TcpPorts, [int[]] $UdpPorts); throw 'inspection denied' }
        function Invoke-ValidatedProcessStop { param($ExpectedProcess); $script:SpecToDoneStopCalls++; return $true }
        $inspectionExit = Invoke-HostNativePortCleanup -TcpPorts @(49101) -UdpPorts @(47998) -WaitTimeoutSec 1
        Assert-True ($inspectionExit -eq 2) 'port inspection failure is HELD instead of falsely reporting FREE'
        Assert-True ($script:SpecToDoneStopCalls -eq 0) 'inspection failure never stops a process'
    }

    $ownedRecord = New-TestPortRecord -ProcId 123 -Port 49101 -Protocol TCP -Name python -ExecutablePath $ownedExecutable -CreationKey 'stable' -SafeToStop $true
    $unownedRecord = New-TestPortRecord -ProcId 456 -Port 49101 -Protocol TCP -Name python -ExecutablePath 'C:\Python312\python.exe' -CreationKey 'other' -SafeToStop $false -Ownership @('deployment-pidfile')
    $nonRuntimeRecord = New-TestPortRecord -ProcId 789 -Port 49101 -Protocol TCP -Name node -ExecutablePath $ownedExecutable -CreationKey 'node' -SafeToStop $false

    & {
        $script:SpecToDoneStopCalls = 0
        function Get-HostNativePortSnapshot { param([int[]] $TcpPorts, [int[]] $UdpPorts, [string] $Root); return @($ownedRecord, $unownedRecord) }
        function Invoke-ValidatedProcessStop { param($ExpectedProcess); $script:SpecToDoneStopCalls++; return $true }
        $mixedExit = Invoke-HostNativePortCleanup -TcpPorts $topology.TcpPorts -UdpPorts $topology.UdpPorts -WaitTimeoutSec 1 -AllowOwnedStop -TargetDeploymentRoot $tempRoot
        Assert-True ($mixedExit -eq 1) 'mixed same-port owners fail closed'
        Assert-True ($script:SpecToDoneStopCalls -eq 0) 'mixed owners are classified before any partial cleanup'
    }

    & {
        $script:SpecToDoneStopCalls = 0
        function Get-HostNativePortSnapshot { param([int[]] $TcpPorts, [int[]] $UdpPorts, [string] $Root); return @($nonRuntimeRecord) }
        function Invoke-ValidatedProcessStop { param($ExpectedProcess); $script:SpecToDoneStopCalls++; return $true }
        $nonRuntimeExit = Invoke-HostNativePortCleanup -TcpPorts $topology.TcpPorts -UdpPorts $topology.UdpPorts -WaitTimeoutSec 1 -AllowOwnedStop -TargetDeploymentRoot $tempRoot
        Assert-True ($nonRuntimeExit -eq 1) 'non-runtime name remains HELD despite a deployment path'
        Assert-True ($script:SpecToDoneStopCalls -eq 0) 'allowlist gate prevents non-runtime stop'
    }

    & {
        $script:SpecToDoneSnapshotCalls = 0
        $script:SpecToDoneStopCalls = 0
        $reusedRecord = New-TestPortRecord -ProcId 123 -Port 49101 -Protocol TCP -Name python -ExecutablePath $ownedExecutable -CreationKey 'reused' -SafeToStop $true
        function Get-HostNativePortSnapshot {
            param([int[]] $TcpPorts, [int[]] $UdpPorts, [string] $Root)
            $script:SpecToDoneSnapshotCalls++
            if ($script:SpecToDoneSnapshotCalls -eq 1) { return @($ownedRecord) }
            return @($reusedRecord)
        }
        function Invoke-ValidatedProcessStop { param($ExpectedProcess); $script:SpecToDoneStopCalls++; return $true }
        $reuseExit = Invoke-HostNativePortCleanup -TcpPorts $topology.TcpPorts -UdpPorts $topology.UdpPorts -WaitTimeoutSec 1 -AllowOwnedStop -TargetDeploymentRoot $tempRoot
        Assert-True ($reuseExit -eq 1) 'creation identity change between complete snapshots is HELD'
        Assert-True ($script:SpecToDoneStopCalls -eq 0) 'PID reuse is caught before the first stop'
    }

    & {
        $script:SpecToDoneSnapshotCalls = 0
        $script:SpecToDoneStopCalls = 0
        function Get-HostNativePortSnapshot {
            param([int[]] $TcpPorts, [int[]] $UdpPorts, [string] $Root)
            $script:SpecToDoneSnapshotCalls++
            return @($ownedRecord)
        }
        function Get-BusyPorts { param([int[]] $TcpPorts, [int[]] $UdpPorts); return @() }
        function Invoke-ValidatedProcessStop { param($ExpectedProcess); $script:SpecToDoneStopCalls++; return $true }
        $ownedExit = Invoke-HostNativePortCleanup -TcpPorts $topology.TcpPorts -UdpPorts $topology.UdpPorts -WaitTimeoutSec 1 -AllowOwnedStop -TargetDeploymentRoot $tempRoot
        Assert-True ($ownedExit -is [int] -and $ownedExit -eq 0) 'stable exact ownership reaches a scalar FREE exit without log pipeline output'
        Assert-True ($script:SpecToDoneSnapshotCalls -ge 3) 'owned cleanup uses initial, confirmation, and immediate pre-stop snapshots'
        Assert-True ($script:SpecToDoneStopCalls -eq 1) 'stable owner invokes exactly one validated stop'
    }

    $events = @($eventWriter.ToString() -split '\r?\n' | Where-Object { $_ } | ForEach-Object { $_ | ConvertFrom-Json })
    foreach ($status in @('held', 'inspect', 'stopping', 'free')) {
        Assert-True (@($events | Where-Object { $_.data.status -eq $status }).Count -gt 0) "structured lifecycle includes $status events"
    }
    foreach ($event in $events) {
        Assert-True ($event.event_type -eq 'lifecycle' -and $event.service -eq 'scripts') 'port events use the shared lifecycle schema'
        Assert-True ($event.data.subject_kind -eq 'script_run' -and $event.data.subject_id -eq $event.run_id) 'lifecycle subject is bound to the logger run'
        Assert-True ($event.data.phase -in @('active', 'closed')) 'lifecycle uses valid active or closed phases'
        Assert-True ($event.run_id -match '^run_\d{8}_\d{6}_[0-9a-f]{6}$') 'port events carry a structured run identity'
    }
    Assert-True (-not (Test-Path -LiteralPath $env:LOG_ROOT)) 'detect and cleanup logging never create log files or directories'

    foreach ($failure in @('initialize', 'emit')) {
        & {
            $savedLogger = $script:HostNativePortLogger
            try {
                if ($failure -eq 'initialize') { $script:HostNativePortLogger = $null }
                $script:PortLogFaultCalls = 0
                function Import-Module { $script:PortLogFaultCalls++; throw 'fixture logger initialization failed' }
                function Write-StructLifecycle { $script:PortLogFaultCalls++; throw 'fixture logger emit failed' }
                function Get-HostNativePortSnapshot { param([int[]] $TcpPorts, [int[]] $UdpPorts, [string] $Root); return @($ownedRecord) }
                function Get-BusyPorts { param([int[]] $TcpPorts, [int[]] $UdpPorts); return @() }
                $script:SpecToDoneStopCalls = 0
                function Invoke-ValidatedProcessStop { param($ExpectedProcess); $script:SpecToDoneStopCalls++; return $true }
                $loggingFailureExit = Invoke-HostNativePortCleanup -TcpPorts $topology.TcpPorts -UdpPorts $topology.UdpPorts -WaitTimeoutSec 1 -AllowOwnedStop -TargetDeploymentRoot $tempRoot
                Assert-True ($loggingFailureExit -is [int] -and $loggingFailureExit -eq 0) "$failure failure preserves the scalar FREE exit"
                Assert-True ($script:SpecToDoneStopCalls -eq 1) "$failure failure preserves the one ownership-validated stop"
                Assert-True ($script:PortLogFaultCalls -gt 0) "$failure fault injection was exercised"
            }
            finally { $script:HostNativePortLogger = $savedLogger }
        }
    }

    $modeConflictExit = Invoke-HostNativePortCleanup -TcpPorts @(49101) -UdpPorts @(47998) -WaitTimeoutSec 1 -ReadOnly -AllowOwnedStop -TargetDeploymentRoot $tempRoot
    Assert-True ($modeConflictExit -eq 2) 'detect-only and explicit-stop modes cannot be combined'

    $wrongRootRejected = $false
    try { Assert-CanonicalTestDeploymentRoot -Path (Join-Path $tempBase 'wrong-root') | Out-Null } catch { $wrongRootRejected = $true }
    Assert-True $wrongRootRejected 'explicit stop rejects a non-canonical deployment root'

    $hostExe = (Get-Process -Id $PID).Path
    $cliOutput = @(& $hostExe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $helperPath -SpectatorCount 33)
    Assert-True ($LASTEXITCODE -eq 2) 'out-of-range CLI input returns the documented exit code 2'
    $cliEvent = ($cliOutput -join "`n") | ConvertFrom-Json
    Assert-True ($cliEvent.data.status -eq 'held' -and $cliEvent.data.phase -eq 'closed') 'CLI validation failure emits structured HELD JSON'
    Assert-True (-not (Test-Path -LiteralPath $env:LOG_ROOT)) 'CLI logging preserves the no-file-write boundary'

    $child = Start-Process -FilePath $hostExe -ArgumentList @('-NoProfile', '-NonInteractive', '-Command', 'Start-Sleep -Seconds 60') -PassThru -WindowStyle Hidden
    try {
        Start-Sleep -Milliseconds 250
        $childInfo = Get-HostNativeProcessInfo -ProcId $child.Id
        $wrongIdentity = [pscustomobject]@{
            ProcessId = $childInfo.ProcessId
            Name = $childInfo.Name
            ExecutablePath = $childInfo.ExecutablePath
            CreationKey = $childInfo.CreationKey + '-wrong'
            CommandLine = $childInfo.CommandLine
            ParentProcessId = $childInfo.ParentProcessId
        }
        Assert-True (-not (Invoke-ValidatedProcessStop -ExpectedProcess $wrongIdentity)) 'wrong creation identity cannot stop a test-owned process'
        Assert-True ($null -ne (Get-Process -Id $child.Id -ErrorAction SilentlyContinue)) 'test-owned process remains alive after wrong identity'
        Assert-True (Invoke-ValidatedProcessStop -ExpectedProcess $childInfo) 'exact acquired handle stops the test-owned process'
        Assert-True ($child.WaitForExit(5000)) 'test-owned process exits after exact-handle stop'
    }
    finally {
        $remainingChild = Get-Process -Id $child.Id -ErrorAction SilentlyContinue
        if ($null -ne $remainingChild) { Stop-Process -InputObject $remainingChild -Force }
        $child.Dispose()
    }
}
finally {
    [Console]::SetOut($previousConsoleOut)
    $eventWriter.Dispose()
    $env:LOG_ROOT = $previousLogRoot
    $resolvedTempRoot = [System.IO.Path]::GetFullPath($tempRoot)
    if ((Test-Path -LiteralPath $resolvedTempRoot) -and
        $resolvedTempRoot.StartsWith(($tempBase + '\'), [System.StringComparison]::OrdinalIgnoreCase) -and
        (Split-Path -Leaf $resolvedTempRoot).StartsWith('spec-to-done-port-helper-', [System.StringComparison]::Ordinal)) {
        Remove-Item -LiteralPath $resolvedTempRoot -Recurse -Force
    }
}

Write-Output '[test-spec-to-done-port-helper] all assertions passed'
