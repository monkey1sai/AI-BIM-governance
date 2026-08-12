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
        'Get-ConverterChildProcessId',
        'Get-ProcStatProcessState',
        'Test-ConverterProcessAlive',
        'Test-OrphanRediscoverySupported',
        'Stop-ConverterProcessTree')) {
    $found = @($converterAst.FindAll({
                param($node)
                $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $fnName
            }, $true))
    Assert-True ($found.Count -eq 1) "Expected exactly one $fnName definition in the converter script."
    . ([scriptblock]::Create($found[0].Extent.Text))
}

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
    $lateChild = Start-ContainmentTestProcess -FilePath $PwshPath -Arguments @('-NoProfile', '-NoLogo', '-File', $sleepScript)
    $script:LateChildId = [int]$lateChild.Id
    $RecordedPids += $script:LateChildId
    $script:PhantomRootId = 999999
    $script:TreeScanCount = 0

    function Get-ConverterChildProcessId {
        param([Parameter(Mandatory = $true)][int] $ParentProcessId)
        if ($ParentProcessId -ne $script:PhantomRootId) { return @() }
        $script:TreeScanCount++
        if ($script:TreeScanCount -eq 1) { return @() }
        return @($script:LateChildId)
    }

    $lateContainment = Stop-ConverterProcessTree -ProcessId $script:PhantomRootId -TimeoutMs 10000
    $lateSurvivors = @($lateContainment.SurvivingPids)
    Assert-True ($lateSurvivors.Count -eq 0) "Expected the rescan loop to prove containment; survivors: $($lateSurvivors -join ', ')"
    Assert-True ([bool]$lateContainment.FixedPointReached) 'Expected the late-descendant case to still reach a fixed point.'
    Assert-True ($script:TreeScanCount -ge 2) 'Expected the process tree to be re-scanned, not scanned once.'
    Assert-True ($null -eq (Get-Process -Id $script:LateChildId -ErrorAction SilentlyContinue)) 'Expected the late-appearing descendant to be terminated.'
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
