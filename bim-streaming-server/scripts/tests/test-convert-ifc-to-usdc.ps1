[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$RepoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..\..")).Path
$ScriptPath = Join-Path $RepoRoot "scripts\convert-ifc-to-usdc.ps1"
$FixtureDir = Join-Path $RepoRoot "_test_ifc_data"
$FixturePath = Join-Path $FixtureDir "許良宇圖書館建築_2026.ifc"
$CreatedFixtureDir = $false
$CreatedFixtureFile = $false

function Assert-True {
    param(
        [Parameter(Mandatory = $true)]
        [bool] $Condition,

        [Parameter(Mandatory = $true)]
        [string] $Message
    )

    if (-not $Condition) {
        throw $Message
    }
}

function Invoke-JsonPlan {
    param(
        [Parameter(Mandatory = $true)]
        [string] $OutputNameParameter
    )

    Push-Location $RepoRoot
    try {
        if ($OutputNameParameter -eq "OutputNamne") {
            $json = & $ScriptPath -IfcPath ".\_test_ifc_data\*.ifc" -OutputNamne "{source-file-name}.usdc" -OutputDir ".\bim-models" -PlanOnly -Json
        }
        else {
            $json = & $ScriptPath -IfcPath ".\_test_ifc_data\*.ifc" -OutputName "{source-file-name}.usdc" -OutputDir ".\bim-models" -PlanOnly -Json
        }
    }
    finally {
        Pop-Location
    }

    return $json | ConvertFrom-Json
}

Assert-True (Test-Path -LiteralPath $ScriptPath -PathType Leaf) "Expected converter script to exist: $ScriptPath"
$scriptContent = Get-Content -LiteralPath $ScriptPath -Raw
Assert-True ($scriptContent -match "BuildPlatform = 'linux-x86_64'") 'converter declares the Linux Kit build root'
Assert-True ($scriptContent -match "Executable\s+= 'kit'") 'converter declares the Linux Kit executable name'
Assert-True ($scriptContent -match "BuildCommand\s+= '\./repo\.sh build'") 'converter gives the Linux build remediation command'
Assert-True (-not ($scriptContent -match 'Get-KitReleaseRoot[\s\S]{0,160}windows-x86_64')) 'runtime release-root resolution is not Windows-only'

try {
    if (-not (Test-Path -LiteralPath $FixtureDir -PathType Container)) {
        New-Item -ItemType Directory -Path $FixtureDir | Out-Null
        $CreatedFixtureDir = $true
    }
    if (-not (Test-Path -LiteralPath $FixturePath -PathType Leaf)) {
        Set-Content -LiteralPath $FixturePath -Encoding UTF8 -Value @(
            "ISO-10303-21;",
            "HEADER;",
            "FILE_DESCRIPTION(('test fixture'),'2;1');",
            "FILE_NAME('fixture.ifc','2026-05-25T00:00:00',('AI-BIM'),('AI-BIM'),'','','');",
            "FILE_SCHEMA(('IFC4'));",
            "ENDSEC;",
            "DATA;",
            "ENDSEC;",
            "END-ISO-10303-21;"
        )
        $CreatedFixtureFile = $true
    }

    $plan = @(Invoke-JsonPlan -OutputNameParameter "OutputName")
    Assert-True ($plan.Count -eq 1) "Expected exactly one IFC plan item."
    Assert-True ($plan[0].IfcPath.EndsWith("_test_ifc_data\許良宇圖書館建築_2026.ifc")) "Expected test IFC path in plan."
    Assert-True ($plan[0].OutputPath.EndsWith("bim-models\許良宇圖書館建築_2026.usdc")) "Expected {source-file-name}.usdc mapping."

    $expectedStatus = "missing"
    if (Test-Path -LiteralPath $plan[0].OutputPath -PathType Leaf) {
        $sourceFile = Get-Item -LiteralPath $plan[0].IfcPath
        $outputFile = Get-Item -LiteralPath $plan[0].OutputPath
        if ($outputFile.LastWriteTimeUtc -lt $sourceFile.LastWriteTimeUtc) {
            $expectedStatus = "stale"
        }
        else {
            $expectedStatus = "ready"
        }
    }
    Assert-True ($plan[0].Status -eq $expectedStatus) "Expected status $expectedStatus for current IFC/USDC timestamps."

    $aliasPlan = @(Invoke-JsonPlan -OutputNameParameter "OutputNamne")
    Assert-True ($aliasPlan[0].OutputPath -eq $plan[0].OutputPath) "Expected OutputNamne alias to map the same output path."
}
finally {
    if ($CreatedFixtureFile -and (Test-Path -LiteralPath $FixturePath -PathType Leaf)) {
        Remove-Item -LiteralPath $FixturePath -Force
    }
    if ($CreatedFixtureDir -and (Test-Path -LiteralPath $FixtureDir -PathType Container)) {
        Remove-Item -LiteralPath $FixtureDir -Force
    }
}

# --- #489 L1-COR-004: the containment helpers need executable coverage --------
# They live inside the converter script (which executes a conversion plan when
# loaded), so lift the function definitions out through the PowerShell AST rather
# than dot-sourcing the whole script.

$converterAst = [System.Management.Automation.Language.Parser]::ParseFile($ScriptPath, [ref]$null, [ref]$null)
foreach ($fnName in @(
        'Test-ConverterHostIsWindows',
        'Get-ConverterChildProcessId',
        'Get-ProcStatProcessState',
        'Test-ConverterProcessAlive',
        'Test-OrphanRediscoverySupported',
        'Get-ConverterProcessStartTime',
        'Test-ConverterProcessIdentity',
        'Stop-ConverterProcessTree',
        'Start-ConverterAsyncLogCapture',
        'Wait-ConverterAsyncLogCapture',
        'Stop-ConverterAsyncLogCapture')) {
    $found = @($converterAst.FindAll({
                param($node)
                $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $fnName
            }, $true))
    Assert-True ($found.Count -eq 1) "Expected exactly one $fnName definition in the converter script."
    . ([scriptblock]::Create($found[0].Extent.Text))
}

# --- #509 review r3: the platform probe must survive Set-StrictMode ----------
# `$IsWindows` is a PowerShell Core AUTOMATIC variable. Windows PowerShell 5.1 -
# the host the adapter falls back to - never defines it, and the converter runs
# under `Set-StrictMode -Version Latest`, where READING an undefined variable is a
# terminating error. `-or $IsWindows` therefore aborted the containment walk on
# 5.1 instead of selecting the Windows branch.

# (a) the mechanism: Get-Variable on a name that exists on NO host must answer,
#     not throw, even under the strictest mode.
$missingVariableProbe = {
    Set-StrictMode -Version Latest
    (Get-Variable -Name 'IsDefinitelyNotAnAutomaticVariable509' -ValueOnly -ErrorAction SilentlyContinue) -eq $true
}
Assert-True ((& $missingVariableProbe) -eq $false) 'Get-Variable on an undefined name must answer $false under Set-StrictMode, not throw.'

# (b) the probe itself still answers correctly for the host running the tests.
$expectedWindows = ([System.Environment]::OSVersion.Platform -eq [System.PlatformID]::Win32NT)
$strictPlatformProbe = {
    Set-StrictMode -Version Latest
    Test-ConverterHostIsWindows
}
Assert-True ((& $strictPlatformProbe) -eq $expectedWindows) 'Test-ConverterHostIsWindows must detect the running host under Set-StrictMode -Version Latest.'

# (c) regression guard: no bare $IsWindows dereference may come back ANYWHERE in
#     the converter script - a single one re-arms the same strict-mode abort.
$bareIsWindowsRefs = @($converterAst.FindAll({
            param($node)
            $node -is [System.Management.Automation.Language.VariableExpressionAst] -and $node.VariablePath.UserPath -eq 'IsWindows'
        }, $true))
Assert-True ($bareIsWindowsRefs.Count -eq 0) 'The converter must not dereference $IsWindows; it is undefined on Windows PowerShell 5.1 under Set-StrictMode.'

# #510: an empty survivor snapshot is not proof that every inherited async
# stdout/stderr write handle reached EOF. A hidden descendant can retain a
# handle even after the root process exits, so Invoke-KitConversion must never
# enter the parameterless WaitForExit() drain that waits without a deadline.
$invokeKitConversionAst = @($converterAst.FindAll({
            param($node)
            $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Invoke-KitConversion'
        }, $true))
Assert-True ($invokeKitConversionAst.Count -eq 1) 'Expected exactly one Invoke-KitConversion definition in the converter script.'
$unboundedDrainCalls = @($invokeKitConversionAst[0].FindAll({
            param($node)
            $node -is [System.Management.Automation.Language.InvokeMemberExpressionAst] -and
            $node.Member.Value -eq 'WaitForExit' -and
            $null -eq $node.Arguments
        }, $true))
Assert-True ($unboundedDrainCalls.Count -eq 0) 'Invoke-KitConversion must not use parameterless WaitForExit(); final async drain needs a deadline even when no survivor was observed.'
$boundedEofDrainCalls = @($invokeKitConversionAst[0].FindAll({
            param($node)
            $node -is [System.Management.Automation.Language.CommandAst] -and
            $node.GetCommandName() -eq 'Wait-ConverterAsyncLogCapture'
        }, $true))
Assert-True ($boundedEofDrainCalls.Count -eq 1) 'Invoke-KitConversion must wait on the explicit async stdout/stderr EOF capture exactly once.'

# /proc/<pid>/stat: comm (field 2) may contain spaces and parens, and a defunct
# descendant must not be counted as a containment survivor.
Assert-True ((Get-ProcStatProcessState -StatLine '4242 (kit (cad) worker) Z 1 4242') -eq 'Z') 'Expected Z state from a comm containing spaces and parens.'
Assert-True ((Get-ProcStatProcessState -StatLine '4242 (kit) S 1 4242') -eq 'S') 'Expected S state from a simple stat line.'
Assert-True ((Get-ProcStatProcessState -StatLine 'garbage') -eq '') 'Expected empty state from an unparsable stat line.'

function Start-ContainmentTestProcess {
    # ProcessStartInfo.ArgumentList, never a joined string: Start-Process's
    # ArgumentList re-tokenizes and shreds quoted arguments.
    param(
        [Parameter(Mandatory = $true)][string] $FilePath,
        [Parameter(Mandatory = $true)][string[]] $Arguments
    )

    $psi = [System.Diagnostics.ProcessStartInfo]::new($FilePath)
    $psi.UseShellExecute = $false
    foreach ($argument in $Arguments) { $psi.ArgumentList.Add($argument) | Out-Null }
    return [System.Diagnostics.Process]::Start($psi)
}

function Stop-OwnedTestProcess {
    param(
        [AllowNull()][System.Diagnostics.Process] $Process,
        [AllowNull()][System.Runtime.InteropServices.SafeHandle] $PinnedHandle
    )

    if ($null -eq $Process -or $null -eq $PinnedHandle -or $PinnedHandle.IsClosed -or $PinnedHandle.IsInvalid) { return }
    try {
        $activeHandle = $Process.SafeHandle
        if ($activeHandle.DangerousGetHandle() -ne $PinnedHandle.DangerousGetHandle()) {
            throw 'Refusing fixture cleanup because the Process no longer owns its pinned OS handle.'
        }
        if (-not $Process.HasExited) {
            # SafeHandle was forced open and retained before cleanup authority
            # was granted. Process.Kill therefore targets that kernel process
            # identity instead of reopening a possibly-recycled numeric PID.
            $Process.Kill()
        }
        [void]$Process.WaitForExit(5000)
    }
    catch { }
}

$PwshPath = (Get-Process -Id $PID).Path
$ContainmentTempDir = Join-Path ([System.IO.Path]::GetTempPath()) ("conv-containment-{0}" -f ([guid]::NewGuid().ToString('N')))
New-Item -ItemType Directory -Path $ContainmentTempDir | Out-Null
$RecordedPids = @()
try {
    $sleepScript = Join-Path $ContainmentTempDir 'sleep-forever.ps1'
    Set-Content -LiteralPath $sleepScript -Encoding UTF8 -Value 'Start-Sleep -Seconds 600'
    $spawnScript = Join-Path $ContainmentTempDir 'spawn-tree.ps1'
    Set-Content -LiteralPath $spawnScript -Encoding UTF8 -Value @(
        'param([string] $PidFile, [string] $PwshPath, [string] $SleepScript)',
        '$psi = [System.Diagnostics.ProcessStartInfo]::new($PwshPath)',
        '$psi.UseShellExecute = $false',
        'foreach ($a in @("-NoProfile", "-NoLogo", "-File", $SleepScript)) { $psi.ArgumentList.Add($a) | Out-Null }',
        '$child = [System.Diagnostics.Process]::Start($psi)',
        'Set-Content -LiteralPath $PidFile -Value $child.Id',
        'Start-Sleep -Seconds 600'
    )
    $pidFile = Join-Path $ContainmentTempDir 'grandchild.pid'

    # 0a) Normal completion must preserve the final stdout/stderr events. A
    #     bounded Process.WaitForExit(Int32) alone does not provide that
    #     guarantee, so exercise the exact capture and EOF helpers used by
    #     Invoke-KitConversion and inspect the closed log files.
    $normalOutputScript = Join-Path $ContainmentTempDir 'write-final-lines.ps1'
    Set-Content -LiteralPath $normalOutputScript -Encoding UTF8 -Value @(
        "[Console]::Out.WriteLine('stdout-final-510')",
        "[Console]::Error.WriteLine('stderr-final-510')"
    )
    $normalStdoutPath = Join-Path $ContainmentTempDir 'normal-stdout.log'
    $normalStderrPath = Join-Path $ContainmentTempDir 'normal-stderr.log'
    $normalProcess = $null
    $normalCapture = $null
    $normalStdoutWriter = $null
    $normalStderrWriter = $null
    $normalProcessHandle = $null
    try {
        $normalStartInfo = [System.Diagnostics.ProcessStartInfo]::new($PwshPath)
        $normalStartInfo.UseShellExecute = $false
        $normalStartInfo.RedirectStandardOutput = $true
        $normalStartInfo.RedirectStandardError = $true
        foreach ($argument in @('-NoProfile', '-NoLogo', '-File', $normalOutputScript)) {
            $normalStartInfo.ArgumentList.Add($argument) | Out-Null
        }
        $normalProcess = [System.Diagnostics.Process]::Start($normalStartInfo)
        $normalProcessHandle = $normalProcess.SafeHandle
        $normalStdoutWriter = [System.IO.StreamWriter]::new($normalStdoutPath, $false, [System.Text.Encoding]::UTF8)
        $normalStderrWriter = [System.IO.StreamWriter]::new($normalStderrPath, $false, [System.Text.Encoding]::UTF8)
        $normalStdoutWriter.AutoFlush = $true
        $normalStderrWriter.AutoFlush = $true
        $normalCapture = Start-ConverterAsyncLogCapture -Process $normalProcess `
            -StdoutWriter $normalStdoutWriter -StderrWriter $normalStderrWriter

        Assert-True ($normalProcess.WaitForExit(5000)) 'Expected the normal log fixture to exit.'
        Assert-True (Wait-ConverterAsyncLogCapture -Capture $normalCapture -TimeoutMilliseconds 5000) 'Expected both normal log streams to reach EOF within one bounded drain window.'
    }
    finally {
        if ($null -ne $normalCapture) {
            Stop-ConverterAsyncLogCapture -Capture $normalCapture
        } else {
            if ($null -ne $normalStdoutWriter) { $normalStdoutWriter.Close() }
            if ($null -ne $normalStderrWriter) { $normalStderrWriter.Close() }
        }
        Stop-OwnedTestProcess -Process $normalProcess -PinnedHandle $normalProcessHandle
        if ($null -ne $normalProcess) { $normalProcess.Dispose() }
    }
    Assert-True ((Get-Content -LiteralPath $normalStdoutPath -Raw) -match 'stdout-final-510') 'Expected the final stdout event to be persisted before capture cleanup.'
    Assert-True ((Get-Content -LiteralPath $normalStderrPath -Raw) -match 'stderr-final-510') 'Expected the final stderr event to be persisted before capture cleanup.'

    # 0b) The root may exit while a descendant that escaped discovery still
    #     owns the inherited redirected handles. Exercise the same EOF helper:
    #     it must consume only one aggregate deadline and return false instead
    #     of waiting forever. Every cleanup signal uses an exact Process handle.
    $hiddenHolderScript = Join-Path $ContainmentTempDir 'hidden-handle-holder.ps1'
    Set-Content -LiteralPath $hiddenHolderScript -Encoding UTF8 -Value 'Start-Sleep -Seconds 600'
    $spawnHiddenHolderScript = Join-Path $ContainmentTempDir 'spawn-hidden-handle-holder.ps1'
    Set-Content -LiteralPath $spawnHiddenHolderScript -Encoding UTF8 -Value @(
        'param([string] $PidFile, [string] $AckFile, [string] $PwshPath, [string] $HolderScript)',
        '$psi = [System.Diagnostics.ProcessStartInfo]::new($PwshPath)',
        '$psi.UseShellExecute = $false',
        'foreach ($a in @("-NoProfile", "-NoLogo", "-File", $HolderScript)) { $psi.ArgumentList.Add($a) | Out-Null }',
        '$holder = [System.Diagnostics.Process]::Start($psi)',
        'Set-Content -LiteralPath $PidFile -Value @(([string]$holder.Id), ([string]$holder.StartTime.ToUniversalTime().Ticks))',
        '$deadline = [DateTime]::UtcNow.AddSeconds(30)',
        'while (-not (Test-Path -LiteralPath $AckFile) -and [DateTime]::UtcNow -lt $deadline) { Start-Sleep -Milliseconds 100 }',
        'if (-not (Test-Path -LiteralPath $AckFile)) {',
        '    if (-not $holder.HasExited) { $holder.Kill() }',
        '    [void]$holder.WaitForExit(5000)',
        "    throw 'Parent did not acknowledge the hidden-holder identity.'",
        '}',
        '$holder.Dispose()'
    )
    $hiddenHolderPidFile = Join-Path $ContainmentTempDir 'hidden-holder.pid'
    $hiddenHolderAckFile = Join-Path $ContainmentTempDir 'hidden-holder.ack'
    $hiddenStdoutPath = Join-Path $ContainmentTempDir 'hidden-stdout.log'
    $hiddenStderrPath = Join-Path $ContainmentTempDir 'hidden-stderr.log'
    $hiddenRoot = $null
    $hiddenHolder = $null
    $hiddenRootHandle = $null
    $hiddenHolderHandle = $null
    $hiddenCapture = $null
    $hiddenStdoutWriter = $null
    $hiddenStderrWriter = $null
    try {
        $hiddenRootStartInfo = [System.Diagnostics.ProcessStartInfo]::new($PwshPath)
        $hiddenRootStartInfo.UseShellExecute = $false
        $hiddenRootStartInfo.RedirectStandardOutput = $true
        $hiddenRootStartInfo.RedirectStandardError = $true
        foreach ($argument in @(
                '-NoProfile', '-NoLogo', '-File', $spawnHiddenHolderScript,
                '-PidFile', $hiddenHolderPidFile, '-AckFile', $hiddenHolderAckFile,
                '-PwshPath', $PwshPath, '-HolderScript', $hiddenHolderScript)) {
            $hiddenRootStartInfo.ArgumentList.Add($argument) | Out-Null
        }
        $hiddenRoot = [System.Diagnostics.Process]::Start($hiddenRootStartInfo)
        $hiddenRootHandle = $hiddenRoot.SafeHandle
        $hiddenStdoutWriter = [System.IO.StreamWriter]::new($hiddenStdoutPath, $false, [System.Text.Encoding]::UTF8)
        $hiddenStderrWriter = [System.IO.StreamWriter]::new($hiddenStderrPath, $false, [System.Text.Encoding]::UTF8)
        $hiddenStdoutWriter.AutoFlush = $true
        $hiddenStderrWriter.AutoFlush = $true
        $hiddenCapture = Start-ConverterAsyncLogCapture -Process $hiddenRoot `
            -StdoutWriter $hiddenStdoutWriter -StderrWriter $hiddenStderrWriter

        $hiddenHolderDeadline = [DateTime]::UtcNow.AddSeconds(30)
        while (-not (Test-Path -LiteralPath $hiddenHolderPidFile) -and [DateTime]::UtcNow -lt $hiddenHolderDeadline) {
            Start-Sleep -Milliseconds 100
        }
        Assert-True (Test-Path -LiteralPath $hiddenHolderPidFile) 'Expected the hidden handle-holder fixture to record its process identity.'
        $hiddenIdentity = @(Get-Content -LiteralPath $hiddenHolderPidFile)
        Assert-True ($hiddenIdentity.Count -eq 2) 'Expected hidden holder PID and creation time.'
        $hiddenHolderCandidate = [System.Diagnostics.Process]::GetProcessById([int]$hiddenIdentity[0])
        $hiddenHolderCandidateHandle = $hiddenHolderCandidate.SafeHandle
        if ($hiddenHolderCandidate.StartTime.ToUniversalTime().Ticks -ne [long]$hiddenIdentity[1]) {
            # The numeric PID no longer denotes our fixture. Dispose the
            # candidate without granting cleanup permission to kill it.
            $hiddenHolderCandidate.Dispose()
            throw 'Hidden holder PID was recycled before its Process handle could be verified.'
        }
        $hiddenHolder = $hiddenHolderCandidate
        $hiddenHolderHandle = $hiddenHolderCandidateHandle
        Set-Content -LiteralPath $hiddenHolderAckFile -Value 'verified'
        Assert-True ($hiddenRoot.WaitForExit(5000)) 'Expected the root fixture to exit while its hidden descendant retained the handles.'
        Assert-True (-not $hiddenHolder.HasExited) 'Expected the hidden descendant to remain alive while retaining inherited handles.'

        $hiddenDrainStopwatch = [System.Diagnostics.Stopwatch]::StartNew()
        $hiddenDrainCompleted = Wait-ConverterAsyncLogCapture -Capture $hiddenCapture -TimeoutMilliseconds 300
        $hiddenDrainStopwatch.Stop()
        Assert-True (-not $hiddenDrainCompleted) 'Expected EOF drain to time out while the hidden descendant retained the handles.'
        Assert-True ($hiddenDrainStopwatch.ElapsedMilliseconds -lt 3000) 'Expected one bounded aggregate drain window, not an unbounded or per-stream wait.'
    }
    finally {
        if ($null -ne $hiddenCapture) {
            Stop-ConverterAsyncLogCapture -Capture $hiddenCapture
        } else {
            if ($null -ne $hiddenStdoutWriter) { $hiddenStdoutWriter.Close() }
            if ($null -ne $hiddenStderrWriter) { $hiddenStderrWriter.Close() }
        }
        Stop-OwnedTestProcess -Process $hiddenHolder -PinnedHandle $hiddenHolderHandle
        if ($null -ne $hiddenHolder) { $hiddenHolder.Dispose() }
        Stop-OwnedTestProcess -Process $hiddenRoot -PinnedHandle $hiddenRootHandle
        if ($null -ne $hiddenRoot) { $hiddenRoot.Dispose() }
    }

    # 1) A real 2-deep tree must be fully terminated and PROVEN gone.
    $rootProcess = Start-ContainmentTestProcess -FilePath $PwshPath -Arguments @(
        '-NoProfile', '-NoLogo', '-File', $spawnScript,
        '-PidFile', $pidFile, '-PwshPath', $PwshPath, '-SleepScript', $sleepScript
    )
    $RecordedPids += [int]$rootProcess.Id
    $waitDeadline = [DateTime]::UtcNow.AddSeconds(30)
    while (-not (Test-Path -LiteralPath $pidFile) -and [DateTime]::UtcNow -lt $waitDeadline) {
        Start-Sleep -Milliseconds 100
    }
    Assert-True (Test-Path -LiteralPath $pidFile) 'Expected the fixture to record its grandchild PID.'
    $grandchildPid = [int]((Get-Content -LiteralPath $pidFile -Raw).Trim())
    $RecordedPids += $grandchildPid
    Assert-True (Test-ConverterProcessAlive -ProcessId $grandchildPid) 'Expected the grandchild to be alive before containment.'

    $containment = Stop-ConverterProcessTree -ProcessId ([int]$rootProcess.Id) -TimeoutMs 15000
    $survivors = @($containment.SurvivingPids)
    Assert-True ($survivors.Count -eq 0) "Expected containment to be proven; survivors: $($survivors -join ', ')"
    Assert-True ([bool]$containment.FixedPointReached) 'Expected the discover -> kill loop to reach a stable fixed point.'
    foreach ($recorded in $RecordedPids) {
        Assert-True (-not (Test-ConverterProcessAlive -ProcessId $recorded)) "Expected PID $recorded to be gone after containment."
    }

    # 2) #509 review r2: a descendant forked by a KNOWN member after that member
    #    was enumerated but before the reverse-order kill must still be found.
    #    Only the FIRST enumeration is stubbed - that stub IS the premise ("the
    #    fork had not happened yet when we looked"). Every later round uses the
    #    real discovery and every kill is real, so this asserts the actual OS
    #    behaviour: Windows keeps ParentProcessId pointing at the killed parent,
    #    so the re-walk from the known (now dead) pid rediscovers the orphan.
    #    Linux reparents orphans to PID 1 and cannot do this - the timeout
    #    wording there says so instead of claiming proof.
    #    The tree is 3 levels deep (root -> mid -> leaf) on purpose: the member
    #    that "forks late" is the MID process, so once it is killed it vanishes
    #    from the process table and the root can no longer reach it. Only a
    #    re-walk that keeps querying every KNOWN pid rediscovers the leaf, which
    #    is exactly the property under dispute.
    if (Test-OrphanRediscoverySupported) {
        $midScript = Join-Path $ContainmentTempDir 'spawn-mid.ps1'
        Set-Content -LiteralPath $midScript -Encoding UTF8 -Value @(
            'param([string] $MidPidFile, [string] $PwshPath, [string] $SpawnScript, [string] $LeafPidFile, [string] $SleepScript)',
            '$psi = [System.Diagnostics.ProcessStartInfo]::new($PwshPath)',
            '$psi.UseShellExecute = $false',
            'foreach ($a in @("-NoProfile", "-NoLogo", "-File", $SpawnScript, "-PidFile", $LeafPidFile, "-PwshPath", $PwshPath, "-SleepScript", $SleepScript)) { $psi.ArgumentList.Add($a) | Out-Null }',
            '$mid = [System.Diagnostics.Process]::Start($psi)',
            'Set-Content -LiteralPath $MidPidFile -Value $mid.Id',
            'Start-Sleep -Seconds 600'
        )
        $midPidFile = Join-Path $ContainmentTempDir 'mid.pid'
        $leafPidFile = Join-Path $ContainmentTempDir 'leaf.pid'
        $orphanRoot = Start-ContainmentTestProcess -FilePath $PwshPath -Arguments @(
            '-NoProfile', '-NoLogo', '-File', $midScript,
            '-MidPidFile', $midPidFile, '-PwshPath', $PwshPath, '-SpawnScript', $spawnScript,
            '-LeafPidFile', $leafPidFile, '-SleepScript', $sleepScript
        )
        $RecordedPids += [int]$orphanRoot.Id
        $orphanDeadline = [DateTime]::UtcNow.AddSeconds(30)
        while ((-not (Test-Path -LiteralPath $leafPidFile)) -and [DateTime]::UtcNow -lt $orphanDeadline) {
            Start-Sleep -Milliseconds 100
        }
        Assert-True (Test-Path -LiteralPath $midPidFile) 'Expected the fork fixture to record its mid PID.'
        Assert-True (Test-Path -LiteralPath $leafPidFile) 'Expected the fork fixture to record its leaf PID.'
        $midPid = [int]((Get-Content -LiteralPath $midPidFile -Raw).Trim())
        $leafPid = [int]((Get-Content -LiteralPath $leafPidFile -Raw).Trim())
        $RecordedPids += $midPid
        $RecordedPids += $leafPid
        Assert-True (Test-ConverterProcessAlive -ProcessId $leafPid) 'Expected the orphan-to-be to be alive before containment.'

        $script:RealGetConverterChildProcessId = ${function:Get-ConverterChildProcessId}
        $script:ForkParentId = $midPid
        $script:FirstForkScanDone = $false

        function Get-ConverterChildProcessId {
            param([Parameter(Mandatory = $true)][int] $ParentProcessId)
            if ($ParentProcessId -eq $script:ForkParentId -and -not $script:FirstForkScanDone) {
                $script:FirstForkScanDone = $true
                return @()
            }
            return @(& $script:RealGetConverterChildProcessId -ParentProcessId $ParentProcessId)
        }

        $orphanContainment = Stop-ConverterProcessTree -ProcessId ([int]$orphanRoot.Id) -TimeoutMs 15000
        $orphanSurvivors = @($orphanContainment.SurvivingPids)
        Assert-True $script:FirstForkScanDone 'Expected the mid process to have been enumerated before the kill.'
        Assert-True ($orphanSurvivors.Count -eq 0) "Expected no survivors after the orphan round; got: $($orphanSurvivors -join ', ')"
        Assert-True ([bool]$orphanContainment.FixedPointReached) 'Expected the orphan case to reach a stable fixed point.'
        Assert-True (-not (Test-ConverterProcessAlive -ProcessId $leafPid)) 'Expected the orphan forked before the kill to be terminated, not left running.'
        # No restore needed: the next case replaces Get-ConverterChildProcessId
        # with a self-contained stub that never delegates.
    }

    # 3) Descendants are re-discovered THROUGH termination, not from one snapshot.
    #    A child that only becomes visible after the first scan must still be
    #    terminated before containment is claimed.
    #
    #    #509 review r3: the root here MUST be a fixture process this test owns.
    #    Stop-ConverterProcessTree unconditionally adds its root argument to the
    #    kill list and runs Stop-Process -Force on it, so a hard-coded
    #    "surely nobody has this PID" value would terminate an unrelated host or
    #    CI process wherever that PID happens to be live - Linux routinely
    #    allocates PIDs far above any such guess (pid_max defaults to 4194304).
    $rescanRoot = Start-ContainmentTestProcess -FilePath $PwshPath -Arguments @('-NoProfile', '-NoLogo', '-File', $sleepScript)
    $script:RescanRootId = [int]$rescanRoot.Id
    $RecordedPids += $script:RescanRootId
    $lateChild = Start-ContainmentTestProcess -FilePath $PwshPath -Arguments @('-NoProfile', '-NoLogo', '-File', $sleepScript)
    $script:LateChildId = [int]$lateChild.Id
    $RecordedPids += $script:LateChildId
    $script:TreeScanCount = 0

    function Get-ConverterChildProcessId {
        param([Parameter(Mandatory = $true)][int] $ParentProcessId)
        if ($ParentProcessId -ne $script:RescanRootId) { return @() }
        $script:TreeScanCount++
        if ($script:TreeScanCount -eq 1) { return @() }
        return @($script:LateChildId)
    }

    $lateContainment = Stop-ConverterProcessTree -ProcessId $script:RescanRootId -TimeoutMs 10000
    $lateSurvivors = @($lateContainment.SurvivingPids)
    Assert-True ($lateSurvivors.Count -eq 0) "Expected the rescan loop to prove containment; survivors: $($lateSurvivors -join ', ')"
    Assert-True ([bool]$lateContainment.FixedPointReached) 'Expected the late-descendant case to still reach a fixed point.'
    Assert-True ($script:TreeScanCount -ge 2) 'Expected the process tree to be re-scanned, not scanned once.'
    Assert-True (-not (Test-ConverterProcessAlive -ProcessId $script:LateChildId)) 'Expected the late-appearing descendant to be terminated.'
    Assert-True (-not (Test-ConverterProcessAlive -ProcessId $script:RescanRootId)) 'Expected the rescan root fixture to be terminated.'

    # 4) #509 review r4: a PID is not an identity. The known-member set accumulates
    #    across rounds, so a member that exits early and has its pid handed to an
    #    UNRELATED process must not be signalled by a later kill round, and must not
    #    be reported as a survivor of this tree. Stubbing the recorded start time so
    #    that it stops matching the live one reproduces exactly what the caller
    #    observes after a recycle, without having to win a real pid-reuse race.
    $identityRoot = Start-ContainmentTestProcess -FilePath $PwshPath -Arguments @('-NoProfile', '-NoLogo', '-File', $sleepScript)
    $script:IdentityRootId = [int]$identityRoot.Id
    $RecordedPids += $script:IdentityRootId
    $bystander = Start-ContainmentTestProcess -FilePath $PwshPath -Arguments @('-NoProfile', '-NoLogo', '-File', $sleepScript)
    $script:BystanderId = [int]$bystander.Id
    $RecordedPids += $script:BystanderId

    function Get-ConverterChildProcessId {
        param([Parameter(Mandatory = $true)][int] $ParentProcessId)
        if ($ParentProcessId -eq $script:IdentityRootId) { return @($script:BystanderId) }
        return @()
    }

    $script:StartTimeProbeCount = 0
    function Get-ConverterProcessStartTime {
        param([Parameter(Mandatory = $true)][int] $ProcessId)
        if ($ProcessId -ne $script:BystanderId) { return ([datetime]'2020-01-01T00:00:00Z') }
        $script:StartTimeProbeCount++
        # The first read is the discovery snapshot; every later read sees the pid
        # owned by a different process.
        if ($script:StartTimeProbeCount -eq 1) { return ([datetime]'2020-01-01T00:00:00Z') }
        return ([datetime]'2026-01-01T00:00:00Z')
    }

    $identityContainment = Stop-ConverterProcessTree -ProcessId $script:IdentityRootId -TimeoutMs 10000
    $identitySurvivors = @($identityContainment.SurvivingPids)
    Assert-True ($script:StartTimeProbeCount -ge 2) 'Expected the recorded process identity to be re-validated before the kill, not only captured at discovery.'
    Assert-True (Test-ConverterProcessAlive -ProcessId $script:BystanderId) 'Expected a recycled PID to be left alone: signalling it is a kill OUTSIDE the tree.'
    Assert-True ($identitySurvivors -notcontains $script:BystanderId) "Expected a recycled PID not to be reported as a tree survivor; got: $($identitySurvivors -join ', ')"
    Assert-True (-not (Test-ConverterProcessAlive -ProcessId $script:IdentityRootId)) 'Expected the identity-case root fixture to be terminated.'

    # 5) #509 review r4 (second finding): validating identity only in the KILL
    #    phase is too late, because the re-walk runs FIRST. A pid carried over
    #    from an earlier round can be recycled before this round's walk, and
    #    enumerating ITS children then enrols an unrelated process's children into
    #    the kill set with fresh, self-consistent identities - which the
    #    reverse-order kill terminates BEFORE the recycled parent is evaluated.
    #
    #    Stop-Process is shadowed here rather than fired for real: the assertion is
    #    about WHICH pids get signalled, and recording the attempts proves that
    #    directly without needing the fixture processes to survive being killed
    #    (which is precisely what a real kill would prevent).
    $carriedProc = Start-ContainmentTestProcess -FilePath $PwshPath -Arguments @('-NoProfile', '-NoLogo', '-File', $sleepScript)
    $script:CarriedId = [int]$carriedProc.Id
    $RecordedPids += $script:CarriedId
    $unrelatedProc = Start-ContainmentTestProcess -FilePath $PwshPath -Arguments @('-NoProfile', '-NoLogo', '-File', $sleepScript)
    $script:UnrelatedChildId = [int]$unrelatedProc.Id
    $RecordedPids += $script:UnrelatedChildId
    $walkRoot = Start-ContainmentTestProcess -FilePath $PwshPath -Arguments @('-NoProfile', '-NoLogo', '-File', $sleepScript)
    $script:WalkRootId = [int]$walkRoot.Id
    $RecordedPids += $script:WalkRootId

    try {
        $script:KillAttempts = [System.Collections.Generic.List[int]]::new()
        function Stop-Process {
            param([int] $Id, [switch] $Force, [string] $ErrorAction)
            $script:KillAttempts.Add([int]$Id)
        }

        $script:CarriedChildScanCount = 0
        function Get-ConverterChildProcessId {
            param([Parameter(Mandatory = $true)][int] $ParentProcessId)
            if ($ParentProcessId -eq $script:WalkRootId) { return @($script:CarriedId) }
            if ($ParentProcessId -eq $script:CarriedId) {
                $script:CarriedChildScanCount++
                # Round 1: the pid is still ours and has no children. From round 2
                # on it has been recycled, and the process now holding it has a
                # child of its own - which has nothing to do with this tree.
                if ($script:CarriedChildScanCount -eq 1) { return @() }
                return @($script:UnrelatedChildId)
            }
            return @()
        }

        $script:CarriedProbeCount = 0
        function Get-ConverterProcessStartTime {
            param([Parameter(Mandatory = $true)][int] $ProcessId)
            if ($ProcessId -ne $script:CarriedId) { return ([datetime]'2020-01-01T00:00:00Z') }
            $script:CarriedProbeCount++
            # Probe 1 = discovery, probe 2 = round 1's kill check (still ours).
            # The recycle becomes visible only from round 2's WALK onwards.
            if ($script:CarriedProbeCount -le 2) { return ([datetime]'2020-01-01T00:00:00Z') }
            return ([datetime]'2026-01-01T00:00:00Z')
        }

        $walkContainment = Stop-ConverterProcessTree -ProcessId $script:WalkRootId -TimeoutMs 0
        $walkSurvivors = @($walkContainment.SurvivingPids)
        Assert-True ($script:CarriedChildScanCount -ge 1) 'Expected the carried-over PID to have been walked at least once.'
        Assert-True ($script:KillAttempts -contains $script:CarriedId) 'Expected the carried-over PID to be signalled while its identity still matched (fixture sanity).'
        Assert-True ($script:KillAttempts -notcontains $script:UnrelatedChildId) 'A recycled PID''s children must never be enrolled and signalled: identity has to be revalidated BEFORE the child walk, not only before the kill.'
        Assert-True ($walkSurvivors -notcontains $script:UnrelatedChildId) 'An unrelated process reached through a recycled PID must not be reported as a survivor of this tree.'
    }
    finally {
        # Restore the real cmdlet before the outer cleanup runs, or the fixture
        # processes would be "stopped" into a list instead of being terminated.
        Remove-Item -LiteralPath 'function:Stop-Process' -ErrorAction SilentlyContinue
    }
}
finally {
    foreach ($recorded in $RecordedPids) {
        Stop-Process -Id ([int]$recorded) -Force -ErrorAction SilentlyContinue
    }
    if (Test-Path -LiteralPath $ContainmentTempDir) {
        Remove-Item -LiteralPath $ContainmentTempDir -Recurse -Force -ErrorAction SilentlyContinue
    }
}

Write-Host "convert-ifc-to-usdc tests passed"
