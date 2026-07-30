. (Join-Path $PSScriptRoot 'test-helpers.ps1')
Import-Module -Force (Join-Path $PSScriptRoot '..\lib\StructLog.psm1')
$testLogger = New-StructLogger -Service 'scripts' -Component 'test-isolated-branch-stack' -SkipEnvSnapshot -InMemoryOnly

$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$productContractPath = Join-Path $repoRoot 'docs\agents\product-operability-and-script-contract.md'
$scriptContractPath = Join-Path $repoRoot 'scripts\SCRIPT_CONTRACT.md'
$productContract = Get-Content -Raw -LiteralPath $productContractPath
$scriptContract = Get-Content -Raw -LiteralPath $scriptContractPath

Assert-True ($productContract -match '## 8\. 隔離 branch stack 驗證') 'product contract has isolated stack section'
foreach ($required in @('8005', '49103', '5180', '0\.\.4', 'E2E_STACK_MANIFEST', 'stack_kind=isolated_branch_stack')) {
    Assert-True ($productContract -match $required) "product contract contains $required"
}
foreach ($boundary in @('不得推論 design gate', '不得推論 deploy', '不得推論 Kit/WebRTC')) {
    Assert-True ($productContract -match [regex]::Escape($boundary)) "product contract contains boundary: $boundary"
}
Assert-True ($scriptContract -match 'scripts/dev/start-isolated-branch-stack\.ps1') 'script contract registers launcher'
Assert-True ($scriptContract -match 'Playwright.*viewer') 'script contract keeps viewer lifecycle in Playwright'
$scriptRegistry = Get-Content -Raw -LiteralPath (Join-Path $repoRoot 'scripts\script-registry.json') | ConvertFrom-Json
$registryEntries = @($scriptRegistry.scripts | Where-Object path -eq 'scripts/dev/start-isolated-branch-stack.ps1')
Assert-Equal 1 $registryEntries.Count 'isolated stack launcher has exactly one registry entry'
$registryEntry = $registryEntries[0]
Assert-Equal 'isolated-branch-verifier' $registryEntry.role 'isolated stack launcher registry role'
Assert-Equal 'scripts' $registryEntry.owner 'isolated stack launcher registry owner'
Assert-Equal 'Backend-only branch evidence adapter; Playwright owns viewer lifecycle. Not a canonical operator entrypoint.' $registryEntry.notes 'isolated stack launcher registry notes'
$governanceWorkflow = Get-Content -Raw -LiteralPath (Join-Path $repoRoot '.github\workflows\agent-governance.yml')
Assert-True ($governanceWorkflow -match 'pwsh -NoProfile -NonInteractive -File scripts/tests/test-isolated-branch-stack\.ps1') 'agent-governance workflow runs isolated stack machine test'

$launcherPath = Join-Path $repoRoot 'scripts\dev\start-isolated-branch-stack.ps1'
$launcherSource = Get-Content -Raw -LiteralPath $launcherPath
Assert-True ($launcherSource -match 'Import-Module.*StructLog\.psm1') 'launcher imports the repository StructLog module'
$ignoredLauncherLog = & git -C $repoRoot check-ignore --no-index 'artifacts/e2e/_launcher/structured-logs/probe.jsonl'
Assert-Equal 0 $LASTEXITCODE 'fixed-root launcher logs remain outside the clean-worktree gate'
Assert-True ($ignoredLauncherLog -match 'artifacts/e2e/_launcher/structured-logs/probe\.jsonl') 'git check-ignore identifies the launcher log path'
. $launcherPath

$capturedLifecycleRecords = [System.Collections.Generic.List[object]]::new()
$captureLifecycleRecord = ({ param($record) [void]$capturedLifecycleRecords.Add($record) }).GetNewClosure()
$lifecycleLogger = New-StructLogger -Service 'scripts' -Component 'isolated-branch-stack' `
    -RunId 'run_20260730_051500_abc123' -InitialTraceId 'script_run_20260730_051500_abc123' `
    -SkipEnvSnapshot -InMemoryOnly -RecordSink $captureLifecycleRecord
$lifecycleData = New-IsolatedStackLifecycleData -StructRunId $lifecycleLogger.RunId -ChangeId 'change-a' `
    -StackRunId 'run-a' -Action start -Phase closed -Status started
$lifecycleLogger | Write-StructLifecycle -Msg 'isolated branch stack action completed' -Data $lifecycleData | Out-Null
$failureLifecycleData = New-IsolatedStackLifecycleData -StructRunId $lifecycleLogger.RunId -ChangeId 'change-a' `
    -StackRunId 'run-a' -Action start -Phase closed -Status failed
$lifecycleLogger | Write-StructLifecycle -Msg 'isolated branch stack action failed' -Data $failureLifecycleData -Level error | Out-Null
Assert-Equal 2 $capturedLifecycleRecords.Count 'launcher lifecycle helper emits terminal success and failure records'
$structuredSchema = Get-Content -Raw -LiteralPath (Join-Path $repoRoot 'tests\contracts\structured-log\schema.json') | ConvertFrom-Json
$lifecycleSchema = @($structuredSchema.allOf | Where-Object { $_.if.properties.event_type.const -ceq 'lifecycle' })[0].then.properties.data
foreach ($lifecycleRecord in $capturedLifecycleRecords) {
    foreach ($requiredField in @($structuredSchema.required)) {
        Assert-True ($null -ne $lifecycleRecord.$requiredField) "lifecycle record has required top-level field $requiredField"
    }
    foreach ($requiredField in @($lifecycleSchema.required)) {
        Assert-True ($null -ne $lifecycleRecord.data.$requiredField) "lifecycle data has required schema field $requiredField"
    }
    Assert-True (@($lifecycleSchema.properties.phase.enum) -contains $lifecycleRecord.data.phase) 'lifecycle phase is schema-valid'
    Assert-True (@($lifecycleSchema.properties.subject_kind.enum) -contains $lifecycleRecord.data.subject_kind) 'lifecycle subject kind is schema-valid'
    Assert-Equal 'closed' $lifecycleRecord.data.phase 'launcher invocation emits a terminal lifecycle phase'
    Assert-Equal 'script_run' $lifecycleRecord.data.subject_kind 'launcher lifecycle uses the script_run subject kind'
    Assert-Equal $lifecycleLogger.RunId $lifecycleRecord.data.subject_id 'launcher lifecycle subject id is the structured logger run id'
    Assert-Equal 'change-a' $lifecycleRecord.data.change_id 'launcher lifecycle records the isolated change id as extra data'
    Assert-Equal 'run-a' $lifecycleRecord.data.stack_run_id 'launcher lifecycle records the isolated stack run id as extra data'
}
Assert-Equal 'started' $capturedLifecycleRecords[0].data.status 'success lifecycle records the result status'
Assert-Equal 'failed' $capturedLifecycleRecords[1].data.status 'failure lifecycle records the terminal failure status'

$p0 = Resolve-IsolatedStackPorts -OffsetInput '0'
Assert-Equal 8005 $p0.coordinator 'offset 0 coordinator'
Assert-Equal 49103 $p0.governance 'offset 0 governance'
Assert-Equal 5180 $p0.viewer 'offset 0 viewer'
$p4 = Resolve-IsolatedStackPorts -OffsetInput '4'
Assert-Equal 8009 $p4.coordinator 'offset 4 coordinator'
Assert-Equal 49107 $p4.governance 'offset 4 governance'
Assert-Equal 5184 $p4.viewer 'offset 4 viewer'
$spacedWorktreeArgumentLine = ConvertTo-IsolatedWindowsArgumentLine -Arguments @(
    'C:\Repos\isolated branch stack\bim-review-coordinator\src\index.ts',
    '--port',
    '8005'
)
Assert-Equal '"C:\Repos\isolated branch stack\bim-review-coordinator\src\index.ts" --port 8005' $spacedWorktreeArgumentLine 'Start-Process argument boundaries preserve a spaced worktree path'
$reservedPorts = @(8004, 49102, 49101, 8010, 5173, 5174, 49100) + @(49110..49150)
foreach ($reservedPort in $reservedPorts) {
    Assert-Throws {
        Assert-IsolatedPortSetDisjoint -Ports ([pscustomobject]@{ coordinator=$reservedPort; governance=49103; viewer=5180 })
    } "reserved port $reservedPort rejected"
}

foreach ($bad in @('-1', '1.5', '5', '48', 'abc')) {
    $listenerCalls = 0
    Assert-Throws {
        Assert-IsolatedStackStartPreflight -RepoRoot $repoRoot -ChangeId 'change-a' -RunId 'run-a' `
            -OffsetInput $bad -ListenerLookup { param($port) $script:listenerCalls++; $null }
    } "offset $bad rejected"
    Assert-Equal 0 $listenerCalls "offset $bad rejected before listener lookup"
}

$listener = Get-IsolatedPortListener -Port 8005 -ConnectionLookup {
    @(
        [pscustomobject]@{LocalPort=8005;State='Established';OwningProcess=1},
        [pscustomobject]@{LocalPort=8006;State='Listen';OwningProcess=2},
        [pscustomobject]@{LocalPort=8005;State='Listen';OwningProcess=3}
    )
}
Assert-Equal 3 $listener.OwningProcess 'listener lookup returns only the exact listening port'
Assert-True ($null -eq (Get-IsolatedPortListener -Port 8007 -ConnectionLookup { @([pscustomobject]@{LocalPort=8005;State='Listen'}) })) 'successful query with no matching port returns no listener'
Assert-Throws {
    Get-IsolatedPortListener -Port 8005 -ConnectionLookup { throw 'injected provider failure' }
} 'listener provider failure remains distinguishable from a free port'

foreach ($badId in @('', '.', '..', 'a/b', 'a\b', 'a:b', ' leading', 'NUL', 'con.txt', 'COM1', 'LPT9.log', 'change-a.')) {
    foreach ($field in @('ChangeId', 'RunId')) {
        Assert-Throws { Assert-SafeStackSegment -Name $field -Value $badId } "unsafe $field rejected: $badId"
    }
}

foreach ($badId in @('NUL', 'con.txt', 'COM1', 'LPT9.log', 'change-a.')) {
    foreach ($field in @('ChangeId', 'RunId')) {
        $listenerCalls = 0
        $changeId = if ($field -eq 'ChangeId') { $badId } else { 'change-a' }
        $runId = if ($field -eq 'RunId') { $badId } else { 'run-a' }
        Assert-Throws {
            Assert-IsolatedStackStartPreflight -RepoRoot $repoRoot -ChangeId $changeId -RunId $runId `
                -OffsetInput '0' -ListenerLookup { param($port) $script:listenerCalls++; $null }
        } "unsafe $field rejected before listener lookup: $badId"
        Assert-Equal 0 $listenerCalls "unsafe $field rejected before listener lookup: $badId"
    }
}

$expected = [pscustomobject]@{ role='governance'; pid=4201; entrypoint='app:app'; command_line='python -m uvicorn app:app'; creation_identity='c1' }
$same = [pscustomobject]@{ role='governance'; pid=4201; entrypoint='app:app'; command_line='python -m uvicorn app:app'; creation_identity='c1' }
$snapshot = Get-IsolatedProcessIdentity -ProcessId 4201 -Entrypoint 'app:app' -ProcessLookup {
    param($processId)
    Assert-Equal 4201 $processId 'process identity lookup receives ProcessId'
    [pscustomobject]@{
        ProcessId = 4201
        CommandLine = 'python -m uvicorn app:app --port 49103'
        CreationDate = 'c1'
        ExecutablePath = 'C:\Python\python.exe'
    }
}
Assert-Equal 4201 $snapshot.pid 'process identity snapshot PID'
Assert-Equal 'app:app' $snapshot.entrypoint 'process identity snapshot entrypoint'
Assert-Equal 'python -m uvicorn app:app --port 49103' $snapshot.command_line 'process identity snapshot command line'
Assert-Equal 'c1' $snapshot.creation_identity 'process identity snapshot creation identity'
Assert-True (Test-IsolatedProcessOwnership -Expected $expected -Actual $same) 'exact identity accepted'
$isoExpected = [pscustomobject]@{
    role='governance'; pid=4201; entrypoint='app:app'; command_line='python -m uvicorn app:app'
    creation_identity='2026-07-29T21:39:35.694283Z'
}
$jsonRoundTrippedExpected = $isoExpected | ConvertTo-Json -Depth 3 | ConvertFrom-Json -Depth 3
$isoActual = $isoExpected.PSObject.Copy()
$isoActual.creation_identity = '2026-07-29T21:39:35.6942830Z'
Assert-True (Test-IsolatedProcessOwnership -Expected $jsonRoundTrippedExpected -Actual $isoActual) 'JSON round-trip preserves the exact creation instant for ownership checks'
foreach ($field in @('pid','entrypoint','command_line','creation_identity')) {
    $changed = $same.PSObject.Copy()
    $changed.$field = if ($field -eq 'pid') { 9999 } else { "wrong-$field" }
    Assert-True (-not (Test-IsolatedProcessOwnership -Expected $expected -Actual $changed)) "$field mismatch rejected"
}

$listenerEntrypoint = 'C:\repo\bim-review-coordinator\src\index.ts'
$listenerExpected = [pscustomobject]@{
    role='coordinator';pid=4202;entrypoint=$listenerEntrypoint
    command_line="node tsx.mjs $listenerEntrypoint --isolated-stack-port 8005"
    creation_identity='2026-07-30T10:00:00Z'
}
$listenerLineage = @{
    4302 = [pscustomobject]@{
        ProcessId=4302;ParentProcessId=4202
        CommandLine="node --import tsx $listenerEntrypoint --isolated-stack-port 8005"
        CreationDate='2026-07-30T10:00:01Z'
    }
    4202 = [pscustomobject]@{
        ProcessId=4202;ParentProcessId=1
        CommandLine=$listenerExpected.command_line
        CreationDate=$listenerExpected.creation_identity
    }
}
$listenerLineageLookup = { param($processId) $script:listenerLineage[[int]$processId] }
Assert-True (Test-IsolatedListenerProcessOwnership -Expected $listenerExpected -ListenerProcessId 4302 -Port 8005 `
    -ProcessLookup $listenerLineageLookup) 'listener descendant with canonical command, port, ancestry, and creation chronology is owned'
$wrongListenerCommandLine = @{}
foreach ($key in $listenerLineage.Keys) { $wrongListenerCommandLine[$key] = $listenerLineage[$key].PSObject.Copy() }
$wrongListenerCommandLine[4302].CommandLine = 'node unrelated.js --isolated-stack-port 8005'
Assert-True (-not (Test-IsolatedListenerProcessOwnership -Expected $listenerExpected -ListenerProcessId 4302 -Port 8005 `
    -ProcessLookup { param($processId) $script:wrongListenerCommandLine[[int]$processId] })) 'descendant listener without canonical entrypoint is rejected'
$reusedAncestorLineage = @{}
foreach ($key in $listenerLineage.Keys) { $reusedAncestorLineage[$key] = $listenerLineage[$key].PSObject.Copy() }
$reusedAncestorLineage[4202].CreationDate = '2026-07-30T10:00:02Z'
Assert-True (-not (Test-IsolatedListenerProcessOwnership -Expected $listenerExpected -ListenerProcessId 4302 -Port 8005 `
    -ProcessLookup { param($processId) $script:reusedAncestorLineage[[int]$processId] })) 'listener ancestry rejects a reused manifest root PID'
$reusedIntermediateLineage = @{
    4303 = [pscustomobject]@{
        ProcessId=4303;ParentProcessId=4250
        CommandLine="node --import tsx $listenerEntrypoint --isolated-stack-port 8005"
        CreationDate='2026-07-30T10:00:01Z'
    }
    4250 = [pscustomobject]@{
        ProcessId=4250;ParentProcessId=4202
        CommandLine='node intermediate.js'
        CreationDate='2026-07-30T10:00:02Z'
    }
    4202 = $listenerLineage[4202]
}
Assert-True (-not (Test-IsolatedListenerProcessOwnership -Expected $listenerExpected -ListenerProcessId 4303 -Port 8005 `
    -ProcessLookup { param($processId) $script:reusedIntermediateLineage[[int]$processId] })) 'listener ancestry rejects an intermediate parent created later than its child'
Assert-True (-not (Test-IsolatedListenerProcessOwnership -Expected $listenerExpected -ListenerProcessId 9999 -Port 8005 `
    -ProcessLookup { param($processId) [pscustomobject]@{ProcessId=$processId;ParentProcessId=0;CommandLine="node $listenerEntrypoint --isolated-stack-port 8005";CreationDate='2026-07-30T10:00:01Z'} })) 'unrelated listener with a matching command line is rejected'

$stopped = [System.Collections.Generic.List[int]]::new()
$owned = @(
    [pscustomobject]@{ role='governance';pid=4201;entrypoint='app:app';command_line='gov';creation_identity='c1' },
    [pscustomobject]@{ role='coordinator';pid=4202;entrypoint='src/index.ts';command_line='coord';creation_identity='c2' }
)
$fakeProcessHandleLookup = { param($processId) [pscustomobject]@{ Id=$processId; HasExited=$false; SafeHandle=[pscustomobject]@{ IsInvalid=$false; IsClosed=$false; process_id=$processId } } }
$mismatchStop = Stop-IsolatedBackends -Processes $owned `
  -IdentityLookup { param($e) if($e.pid -eq 4201){$e}else{[pscustomobject]@{role='coordinator';pid=4202;entrypoint='wrong';command_line='coord';creation_identity='c2'}} } `
  -ProcessHandleLookup $fakeProcessHandleLookup `
  -StopProcessFn { param($processId) $script:stopped.Add($processId) }
Assert-Equal 'not_owned' @($mismatchStop | Where-Object role -eq 'coordinator')[0].status 'one mismatch is recorded before stopping'
Assert-Equal 0 $stopped.Count 'all identities validate before any stop'

$rollbackStops = [System.Collections.Generic.List[int]]::new()
$rollback = Stop-IsolatedBackends -Processes $owned -AllowMissing `
  -IdentityLookup { param($e) if ($e.role -eq 'governance') { throw 'already exited' }; $e } `
  -MissingProcessFn { param($e) $e.role -eq 'governance' } `
  -ProcessHandleLookup $fakeProcessHandleLookup `
  -StopProcessFn { param($processId) $script:rollbackStops.Add($processId) }
Assert-Equal '4202' ($rollbackStops -join ',') 'rollback skips missing child and stops surviving owned backend'
Assert-Equal 'already_stopped' @($rollback | Where-Object role -eq 'governance')[0].status 'rollback records missing child as already stopped'

$unprovenRollbackStops = [System.Collections.Generic.List[int]]::new()
$unprovenRollback = Stop-IsolatedBackends -Processes $owned -AllowMissing `
  -IdentityLookup { param($e) if ($e.role -eq 'governance') { throw 'identity lookup failed' }; $e } `
  -MissingProcessFn { param($e) $false } `
  -ProcessHandleLookup $fakeProcessHandleLookup `
  -StopProcessFn { param($processId) $script:unprovenRollbackStops.Add($processId) }
Assert-Equal 'not_owned' @($unprovenRollback | Where-Object role -eq 'governance')[0].status 'rollback does not equate an unproven identity lookup failure with process exit'
Assert-Equal 0 $unprovenRollbackStops.Count 'unproven rollback identity fails before stopping any backend'

$stoppedExactly = [System.Collections.Generic.List[int]]::new()
Stop-IsolatedBackends -Processes $owned `
  -IdentityLookup { param($expectedProcess) $expectedProcess } `
  -ProcessHandleLookup $fakeProcessHandleLookup `
  -StopProcessFn { param($processId) $script:stoppedExactly.Add($processId) }
Assert-Equal '4202,4201' ($stoppedExactly -join ',') 'exact identities stop in reverse manifest order'

$pidReuseStops = [System.Collections.Generic.List[int]]::new()
$pidReuseIdentityChecks = @{}
$pidReuse = Stop-IsolatedBackends -Processes $owned `
  -IdentityLookup {
      param($expectedProcess)
      $count = 1 + [int]($script:pidReuseIdentityChecks[$expectedProcess.pid] ?? 0)
      $script:pidReuseIdentityChecks[$expectedProcess.pid] = $count
      if ($expectedProcess.role -eq 'coordinator' -and $count -eq 2) {
          return [pscustomobject]@{ role='coordinator';pid=4202;entrypoint='src/index.ts';command_line='coord';creation_identity='reused-c2' }
      }
      $expectedProcess
  } `
  -ProcessHandleLookup { param($processId) [pscustomobject]@{ Id=$processId; HasExited=$false; SafeHandle=[pscustomobject]@{ IsInvalid=$false; IsClosed=$false; process_id=$processId } } } `
  -StopProcessFn { param($processId,$processHandle) $script:pidReuseStops.Add($processId) }
Assert-Equal 'not_owned' @($pidReuse | Where-Object role -eq 'coordinator')[0].status 'immediate stop recheck rejects a reused PID creation identity'
Assert-Equal 0 $pidReuseStops.Count 'a reused PID after prevalidation stops no backend'

$postRecheckStops = [System.Collections.Generic.List[int]]::new()
$postRecheckIdentityChecks = @{}
$postRecheckPinnedHandles = @{}
$pidReusedAfterRecheck = $false
$postRecheck = Stop-IsolatedBackends -Processes $owned `
  -IdentityLookup {
      param($expectedProcess)
      $count = 1 + [int]($script:postRecheckIdentityChecks[$expectedProcess.pid] ?? 0)
      $script:postRecheckIdentityChecks[$expectedProcess.pid] = $count
      if ($expectedProcess.role -eq 'coordinator' -and $count -eq 2) {
          $script:pidReusedAfterRecheck = $true
      }
      $expectedProcess
  } `
  -ProcessHandleLookup {
      param($processId)
      $safeHandle = [pscustomobject]@{ IsInvalid=$false; IsClosed=$false; process_id=$processId; pinned=$true }
      $script:postRecheckPinnedHandles[$processId] = $safeHandle
      [pscustomobject]@{ Id=$processId; HasExited=$false; SafeHandle=$safeHandle }
  } `
  -StopProcessFn {
      param($processId,$processHandle,$safeProcessHandle)
      if ($processId -eq 4202) {
          Assert-True $script:pidReusedAfterRecheck 'test simulates PID reuse only after immediate identity recheck'
          Assert-True ([object]::ReferenceEquals($script:postRecheckPinnedHandles[$processId], $safeProcessHandle)) 'stop receives the safe handle pinned before immediate identity recheck'
      }
      $script:postRecheckStops.Add($processId)
  }
Assert-Equal '4202,4201' ($postRecheckStops -join ',') 'a PID reused after immediate identity recheck is stopped only through its previously pinned process handle'
$treeKillArgument = $null
$treeKillHandle = [pscustomobject]@{
    Id=4201;HasExited=$false;SafeHandle=[pscustomobject]@{IsInvalid=$false;IsClosed=$false;process_id=4201}
}
$treeKillHandle | Add-Member -MemberType ScriptMethod -Name Kill -Value {
    param($entireProcessTree)
    $script:treeKillArgument = $entireProcessTree
    $this.HasExited = $true
}
$treeKillHandle | Add-Member -MemberType ScriptMethod -Name WaitForExit -Value { param($timeoutMilliseconds) $true }
$treeKillResult = Stop-IsolatedBackends -Processes @($owned[0]) `
    -IdentityLookup { param($expectedProcess) $expectedProcess } `
    -ProcessHandleLookup { param($processId) $script:treeKillHandle }
Assert-Equal 'stopped' @($treeKillResult)[0].status 'default stop succeeds through the pinned process handle'
Assert-True ($treeKillArgument -eq $true) 'default stop requests termination of the owned process tree'
$launcherSource = Get-Content -Raw -LiteralPath $launcherPath
Assert-True ($launcherSource -match '\$processHandle\.SafeHandle') 'default stop path pins the process SafeHandle before the immediate identity recheck'
Assert-True ($launcherSource -match '\$processHandle\.Kill\(\$true\)') 'default stop path terminates the owned process tree through the pinned Process object rather than a PID lookup'

$spawned = [pscustomobject]@{ Id = 4301 }
$cleanedSpawned = [System.Collections.Generic.List[object]]::new()
Assert-Throws {
    Start-IsolatedBackend -Role 'governance' -WorkingDirectory $repoRoot -Executable 'python' -Arguments @('--version') `
        -Environment @{} -RunDirectory (Join-Path $repoRoot 'artifacts\test-spawn-cleanup') -Entrypoint 'app:app' `
        -StartProcessFn { param($exe,$argumentList,$cwd,$envMap,$stdout,$stderr) $script:spawned } `
        -IdentityLookup { param($processId,$entrypoint) throw 'snapshot failed' } `
        -StopSpawnedProcessFn { param($spawnedProcess) $script:cleanedSpawned.Add($spawnedProcess) }
} 'identity snapshot failure cleans the exact spawned process handle'
Assert-Equal 1 $cleanedSpawned.Count 'snapshot failure cleans exactly one spawned process'
Assert-True ([object]::ReferenceEquals($spawned, $cleanedSpawned[0])) 'snapshot failure cleans the spawned process object, not a rediscovered PID'

$realProcessSandbox = New-TestSandbox -Prefix 'isolated-stack-real-process'
$realIdentity = $null
$failureCleanupHandles = [System.Collections.Generic.List[object]]::new()
$bodyFailure = $null
try {
    $capturedFailure = $null
    try {
        $realIdentity = Start-IsolatedBackend -Role 'argument-forwarding' -WorkingDirectory $repoRoot `
            -Executable (Get-Command pwsh -CommandType Application -ErrorAction Stop).Source `
            -Arguments @('-NoProfile', '-NonInteractive', '-Command', 'Start-Sleep -Seconds 30') `
            -Environment @{} -RunDirectory $realProcessSandbox -Entrypoint 'Start-Sleep' `
            -StopSpawnedProcessFn {
                param($spawnedProcess)
                $script:failureCleanupHandles.Add($spawnedProcess)
                if ($null -ne $spawnedProcess -and -not $spawnedProcess.HasExited) {
                    $spawnedProcess.Kill()
                    $spawnedProcess.WaitForExit()
                }
            }
    } catch {
        $capturedFailure = $_
    }

    if ($null -ne $capturedFailure) {
        Assert-True ($capturedFailure.Exception.Message -match [regex]::Escape('command line does not contain exact entrypoint Start-Sleep')) 'broken argument forwarding fails at the real identity entrypoint check'
        Assert-Equal 1 $failureCleanupHandles.Count 'broken argument forwarding cleans exactly the spawned process handle'
        Assert-True $failureCleanupHandles[0].HasExited 'broken argument forwarding leaves the exact spawned process handle exited'
        throw $capturedFailure
    }

    Assert-Equal 'Start-Sleep' $realIdentity.entrypoint 'real process identity preserves expected entrypoint'
    Assert-True ($realIdentity.command_line -match [regex]::Escape('Start-Sleep -Seconds 30')) 'real process command line receives Start-IsolatedBackend arguments'
} catch {
    $bodyFailure = $_
    throw
}
finally {
    try {
        if ($null -ne $realIdentity) {
            $cleanupProcess = Get-Process -Id ([int]$realIdentity.pid) -ErrorAction Stop
            $cleanupIdentity = Get-IsolatedProcessIdentity -ProcessId ([int]$realIdentity.pid) -Entrypoint 'Start-Sleep'
            Assert-True (Test-IsolatedProcessOwnership -Expected $realIdentity -Actual $cleanupIdentity) 'cleanup revalidates exact creation identity and command line before stopping the returned process'
            $cleanupProcess.Kill()
            $cleanupProcess.WaitForExit()
            Assert-True $cleanupProcess.HasExited 'successful argument-forwarding test stops its exact revalidated process handle'
        }
    } catch {
        if ($null -eq $bodyFailure) { throw }
    } finally {
        Remove-TestSandbox -Path $realProcessSandbox
    }
}

$sandbox = New-TestSandbox -Prefix 'isolated-stack-collision'
try {
    $manifest = Resolve-IsolatedStackManifestPath -RepoRoot $sandbox -ChangeId 'change-a' -RunId 'run-a'
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $manifest) | Out-Null
    '{}' | Set-Content -LiteralPath $manifest
    $listenerCalls = 0
    Assert-Throws {
        Assert-IsolatedStackStartPreflight -RepoRoot $sandbox -ChangeId 'change-a' -RunId 'run-a' `
            -OffsetInput '0' -ListenerLookup { param($port) $script:listenerCalls++; $null }
    } 'manifest collision rejected'
    Assert-Equal '{}' (Get-Content -Raw -LiteralPath $manifest).Trim() 'collision does not overwrite manifest'
    Assert-Equal 0 $listenerCalls 'collision rejected before listener lookup'
}
finally { Remove-TestSandbox -Path $sandbox }

$reservationSandbox = New-TestSandbox -Prefix 'isolated-stack-reservation'
$firstReservation = $null
$reacquiredReservation = $null
try {
    $firstReservation = Acquire-IsolatedStackReservations -RepoRoot $reservationSandbox -ChangeId 'change-a' -RunId 'run-a' -Offset 2
    Assert-Equal 2 @($firstReservation.paths).Count 'reservation owns both run and offset files'
    foreach ($reservationPath in @($firstReservation.paths)) {
        Assert-True (Test-Path -LiteralPath $reservationPath -PathType Leaf) "reservation file exists: $reservationPath"
    }
    Assert-Throws {
        Acquire-IsolatedStackReservations -RepoRoot $reservationSandbox -ChangeId 'change-a' -RunId 'run-a' -Offset 2
    } 'same run cannot acquire an active reservation twice'
    Assert-Throws {
        Acquire-IsolatedStackReservations -RepoRoot $reservationSandbox -ChangeId 'change-a' -RunId 'run-b' -Offset 2
    } 'different run cannot acquire the same active offset'
    Release-IsolatedStackReservations -Reservation $firstReservation
    $firstReservation = $null
    $reacquiredReservation = Acquire-IsolatedStackReservations -RepoRoot $reservationSandbox -ChangeId 'change-a' -RunId 'run-b' -Offset 2
    Assert-Equal 2 @($reacquiredReservation.paths).Count 'released run and offset reservation can be reacquired'
}
finally {
    Release-IsolatedStackReservations -Reservation $firstReservation
    Release-IsolatedStackReservations -Reservation $reacquiredReservation
    Remove-TestSandbox -Path $reservationSandbox
}

$dispatcherSandbox = New-TestSandbox -Prefix 'isolated-stack-dispatcher'
try {
    $rejectedRawSegment = '..\sensitive-path'
    Assert-Throws {
        Invoke-IsolatedBranchStackCli -Action start -ChangeId $rejectedRawSegment -RunId 'run-rejected' -RepoRoot $dispatcherSandbox
    } 'Invalid ChangeId'
    $rejectedLogFiles = @(Get-ChildItem -LiteralPath (Join-Path $dispatcherSandbox 'artifacts\e2e\_launcher\structured-logs') -File -Recurse)
    Assert-Equal 1 $rejectedLogFiles.Count 'invalid direct invocation writes one fixed-root structured log file'
    $rejectedLogText = Get-Content -Raw -LiteralPath $rejectedLogFiles[0].FullName
    Assert-True (-not $rejectedLogText.Contains($rejectedRawSegment, [StringComparison]::Ordinal)) 'rejected raw segment is absent from structured logs'
    $rejectedRecords = @($rejectedLogText -split "`r?`n" | Where-Object { $_ } | ForEach-Object { $_ | ConvertFrom-Json })
    Assert-Equal 2 $rejectedRecords.Count 'invalid direct invocation emits terminal lifecycle plus anomaly'
    Assert-Equal 'closed' $rejectedRecords[0].data.phase 'invalid direct invocation lifecycle is terminal'
    Assert-Equal 'invalid' $rejectedRecords[0].data.change_id 'invalid direct invocation uses a safe change-id marker'
    Assert-Equal 'input validation failed' $rejectedRecords[1].data.reason 'invalid direct invocation redacts the rejected segment from reason'

    $startedRoles = [System.Collections.Generic.List[string]]::new()
    $stoppedPids = [System.Collections.Generic.List[int]]::new()
    $startManifestPath = Resolve-IsolatedStackManifestPath -RepoRoot $dispatcherSandbox -ChangeId 'change-a' -RunId 'run-start'
    Assert-Throws {
        Invoke-IsolatedBranchStack -Action start -ChangeId 'change-a' -RunId 'run-start' -OffsetInput '0' `
          -RepoRoot $dispatcherSandbox -WorktreeStatusFn { param($root) @() } `
          -PreflightFn { param($root,$change,$run,$offset) [pscustomobject]@{offset=0;ports=[pscustomobject]@{coordinator=8005;governance=49103;viewer=5180};manifest_path=$startManifestPath} } `
          -RuntimeResolver { param($root) [pscustomobject]@{python='python';node='node';tsx='tsx.mjs'} } `
          -StartBackendFn { param($spec) $script:startedRoles.Add($spec.role); if($spec.role -eq 'coordinator'){throw 'coordinator start failed'}; [pscustomobject]@{role='governance';pid=4101;entrypoint='app:app';command_line='gov';creation_identity='c1'} } `
          -HealthFn { param($url) $true } `
          -IdentityLookup { param($e) $e } `
          -ProcessHandleLookup $fakeProcessHandleLookup `
          -StopProcessFn { param($processId) $script:stoppedPids.Add($processId) } `
          -HeadShaFn { param($root) ('a' * 40 -join '') }
    } 'second backend failure rolls back first backend'
    Assert-Equal 'governance,coordinator' ($startedRoles -join ',') 'start order'
    Assert-Equal '4101' ($stoppedPids -join ',') 'only this-run owned first backend stopped'
    Assert-True (-not (Test-Path -LiteralPath $startManifestPath)) 'failed start writes no success manifest'

    $reservationStarts = [System.Collections.Generic.List[string]]::new()
    Assert-Throws {
        Invoke-IsolatedBranchStack -Action start -ChangeId 'change-a' -RunId 'run-reserved' -RepoRoot $dispatcherSandbox `
          -WorktreeStatusFn { param($root) @() } `
          -PreflightFn { param($root,$change,$run,$offset) [pscustomobject]@{offset=0;ports=[pscustomobject]@{coordinator=8005;governance=49103;viewer=5180};manifest_path=(Resolve-IsolatedStackManifestPath -RepoRoot $root -ChangeId $change -RunId $run)} } `
          -ReservationAcquireFn { param($root,$change,$run,$offset) throw 'reservation held' } `
          -StartBackendFn { param($spec) $script:reservationStarts.Add($spec.role) } `
          -RuntimeResolver { param($root) throw 'runtime must not resolve while reservation is held' }
    } 'held reservation rejects before backend start'
    Assert-Equal 0 $reservationStarts.Count 'held reservation starts no backend'

    $reservationOrder = [System.Collections.Generic.List[string]]::new()
    Assert-Throws {
        Invoke-IsolatedBranchStack -Action start -ChangeId 'change-a' -RunId 'run-preflight-order' -RepoRoot $dispatcherSandbox `
          -WorktreeStatusFn { param($root) @() } `
          -ReservationAcquireFn { param($root,$change,$run,$offset) $script:reservationOrder.Add('acquire'); [pscustomobject]@{paths=@()} } `
          -PreflightFn { param($root,$change,$run,$offset) $script:reservationOrder.Add('preflight'); throw 'injected preflight failure' } `
          -ReservationReleaseFn { param($reservation) $script:reservationOrder.Add('release') } `
          -RuntimeResolver { param($root) throw 'runtime must not resolve after preflight failure' }
    } 'listener and manifest preflight runs while reservation is held'
    Assert-Equal 'acquire,preflight,release' ($reservationOrder -join ',') 'reservation brackets the decision-making preflight'

    $dirtyStarts = [System.Collections.Generic.List[string]]::new()
    Assert-Throws {
        Invoke-IsolatedBranchStack -Action start -ChangeId 'change-a' -RunId 'run-dirty' -RepoRoot $dispatcherSandbox `
          -WorktreeStatusFn { param($root) ' M tracked-file.txt' } `
          -StartBackendFn { param($spec) $script:dirtyStarts.Add($spec.role) }
    } 'dirty worktree rejects before backend start or identity recording'
    Assert-Equal 0 $dirtyStarts.Count 'dirty worktree starts no backend'

    $successManifestPath = Resolve-IsolatedStackManifestPath -RepoRoot $dispatcherSandbox -ChangeId 'change-a' -RunId 'run-success'
    $successSpecs = [System.Collections.Generic.List[object]]::new()
    $success = Invoke-IsolatedBranchStack -Action start -ChangeId 'change-a' -RunId 'run-success' -OffsetInput '0' `
        -RepoRoot $dispatcherSandbox -WorktreeStatusFn { param($root) @() } `
        -PreflightFn { param($root,$change,$run,$offset) [pscustomobject]@{offset=0;ports=[pscustomobject]@{coordinator=8005;governance=49103;viewer=5180};manifest_path=$successManifestPath} } `
        -RuntimeResolver { param($root) [pscustomobject]@{python='python';node='node';tsx='tsx.mjs'} } `
        -StartBackendFn {
            param($spec)
            $script:successSpecs.Add($spec)
            $backendId = if ($spec.role -eq 'governance') { 4201 } else { 4202 }
            [pscustomobject]@{role=$spec.role;pid=$backendId;entrypoint=$spec.entrypoint;command_line=($spec.Arguments -join ' ');creation_identity=$spec.role}
        } `
        -HealthFn { param($url) $true } `
        -IdentityLookup { param($expectedProcess) $expectedProcess } `
        -ProcessHandleLookup $fakeProcessHandleLookup `
        -StopProcessFn { param($processId) throw "unexpected success rollback for $processId" } `
        -HeadShaFn { param($root) ('b' * 40 -join '') }
    Assert-Equal 'started' $success.status 'successful start returns started'
    Assert-True (Test-Path -LiteralPath $successManifestPath -PathType Leaf) 'successful start writes a manifest'
    $successManifest = Read-IsolatedStackManifest -Path $successManifestPath
    Assert-Equal 'isolated-branch-stack/v1' $successManifest.schema_version 'successful start writes v1 manifest'
    Assert-Equal 'isolated_branch_stack' $successManifest.stack_kind 'successful start writes isolated stack kind'
    Assert-Equal 2 @($successManifest.processes).Count 'successful start writes both backend identities'
    Assert-IsolatedStackManifestIdentity -Manifest $successManifest -RepoRoot $dispatcherSandbox -ChangeId 'change-a' -RunId 'run-success' -OffsetInput '0'
    $successRunDirectory = Split-Path -Parent $successManifestPath
    $expectedStateRoot = Join-Path $successRunDirectory 'state'
    $expectedFixtureRoot = Join-Path $dispatcherSandbox 'storage'
    Assert-Equal $expectedStateRoot ([string]$successManifest.mutable_state.root) 'manifest binds mutable state to this run directory'
    Assert-Equal $expectedFixtureRoot ([string]$successManifest.read_only_fixture_root) 'manifest records the worktree fixture root'
    $governanceSpec = @($successSpecs | Where-Object role -eq 'governance')[0]
    $coordinatorSpec = @($successSpecs | Where-Object role -eq 'coordinator')[0]
    Assert-Equal (Join-Path $expectedStateRoot 'governance\governance.db') ([string]$governanceSpec.Environment.GOV_DB_PATH) 'governance DB is per run'
    Assert-Equal (Join-Path $expectedStateRoot 'governance\federated') ([string]$governanceSpec.Environment.GOV_FED_OUT) 'governance federation output is per run'
    Assert-Equal $expectedFixtureRoot ([string]$governanceSpec.Environment.BIM_FILE_LIBRARY_ROOT) 'governance fixture root is explicit and worktree-scoped'
    Assert-Equal (Join-Path $expectedStateRoot 'coordinator\sessions') ([string]$coordinatorSpec.Environment.SESSION_STORE_DIR) 'coordinator sessions are per run'
    Assert-Equal (Join-Path $expectedStateRoot 'coordinator\events') ([string]$coordinatorSpec.Environment.EVENT_LOG_DIR) 'coordinator events are per run'
    Assert-Equal (Join-Path $expectedStateRoot 'coordinator\callback-outbox.json') ([string]$coordinatorSpec.Environment.CALLBACK_OUTBOX_STORE_PATH) 'callback outbox is per run'
    Assert-Equal (Join-Path $expectedStateRoot 'coordinator\conversion-ledger.json') ([string]$coordinatorSpec.Environment.CONVERSION_LEDGER_STORE_PATH) 'conversion ledger is per run'
    Assert-Equal (Join-Path $expectedStateRoot 'coordinator\external-ifc-ready.json') ([string]$coordinatorSpec.Environment.EXTERNAL_IFC_READY_STORE_PATH) 'IFC-ready intake store is per run'
    $expectedCoordinatorStorage = Join-Path $expectedStateRoot 'coordinator\storage'
    Assert-Equal $expectedCoordinatorStorage ([string]$coordinatorSpec.Environment.STORAGE_ROOT) 'coordinator mutable storage is per run'
    Assert-Equal $expectedCoordinatorStorage ([string]$coordinatorSpec.Environment.STORAGE_HOST_ROOT) 'coordinator host storage view matches its per-run mutable storage'
    Assert-Equal $expectedCoordinatorStorage ([string]$coordinatorSpec.Environment.RUNTIME_STORAGE_ROOT) 'coordinator runtime storage stays in the same per-run root'

    $expectedGovernanceEntrypoint = Join-Path $dispatcherSandbox 'governance-service'
    $expectedCoordinatorEntrypoint = Join-Path $dispatcherSandbox 'bim-review-coordinator\src\index.ts'
    $statusManifest = [ordered]@{
        schema_version='isolated-branch-stack/v1';stack_kind='isolated_branch_stack';change_id='change-a';run_id='run-status'
        worktree_root=$dispatcherSandbox;offset=0
        ports=[ordered]@{coordinator=8005;governance=49103;viewer=5180}
        base_urls=[ordered]@{coordinator='http://127.0.0.1:8005';governance='http://127.0.0.1:49103';viewer='http://127.0.0.1:5180'}
        lifecycle_owners=[ordered]@{governance='repo_launcher';coordinator='repo_launcher';viewer='playwright_webserver'}
        viewer=[ordered]@{expected_port=5180;owner='playwright_webserver';managed_by_launcher=$false}
        backend_ready=[ordered]@{governance=$true;coordinator=$true}
        stopped_at=$null
        processes=@(
            [pscustomobject]@{role='governance';pid=4101;entrypoint=$expectedGovernanceEntrypoint;command_line="python -m uvicorn --app-dir $expectedGovernanceEntrypoint app:app --host 127.0.0.1 --port 49103";creation_identity='c1'},
            [pscustomobject]@{role='coordinator';pid=4102;entrypoint=$expectedCoordinatorEntrypoint;command_line="node tsx.mjs $expectedCoordinatorEntrypoint --isolated-stack-port 8005";creation_identity='c2'}
        )
    }
    $statusPath = Resolve-IsolatedStackManifestPath -RepoRoot $dispatcherSandbox -ChangeId 'change-a' -RunId 'run-status'
    Write-IsolatedJsonAtomic -Path $statusPath -Value $statusManifest -NoClobber
    $status = Invoke-IsolatedBranchStack -Action status -ChangeId 'change-a' -RunId 'run-status' -OffsetInput '0' -RepoRoot $dispatcherSandbox `
        -IdentityLookup { param($expectedProcess) $expectedProcess } `
        -HealthFn { param($url) -not $url.EndsWith(':8005/health') }
    $governanceStatus = @($status.backend | Where-Object role -eq 'governance')[0]
    $coordinatorStatus = @($status.backend | Where-Object role -eq 'coordinator')[0]
    Assert-Equal 'degraded' $status.status 'status reports degraded when an owned backend is not ready'
    Assert-True ($governanceStatus.owned -and $governanceStatus.ready) 'owned healthy governance is ready'
    Assert-True ($coordinatorStatus.owned -and -not $coordinatorStatus.ready) 'owned coordinator with failed live health is not ready'

    $offsetOneManifest = $statusManifest | ConvertTo-Json -Depth 12 | ConvertFrom-Json -Depth 12
    $offsetOneManifest.run_id = 'run-status-offset-one'
    $offsetOneManifest.offset = 1
    $offsetOneManifest.ports.coordinator = 8006; $offsetOneManifest.ports.governance = 49104; $offsetOneManifest.ports.viewer = 5181
    $offsetOneManifest.base_urls.coordinator = 'http://127.0.0.1:8006'; $offsetOneManifest.base_urls.governance = 'http://127.0.0.1:49104'; $offsetOneManifest.base_urls.viewer = 'http://127.0.0.1:5181'
    $offsetOneManifest.viewer.expected_port = 5181
    $offsetOneManifest.processes[0].command_line = "python -m uvicorn --app-dir $expectedGovernanceEntrypoint app:app --host 127.0.0.1 --port 49104"
    $offsetOneManifest.processes[1].command_line = "node tsx.mjs $expectedCoordinatorEntrypoint --isolated-stack-port 8006"
    $offsetOnePath = Resolve-IsolatedStackManifestPath -RepoRoot $dispatcherSandbox -ChangeId 'change-a' -RunId 'run-status-offset-one'
    Write-IsolatedJsonAtomic -Path $offsetOnePath -Value $offsetOneManifest -NoClobber
    $derivedOffsetStatus = Invoke-IsolatedBranchStack -Action status -ChangeId 'change-a' -RunId 'run-status-offset-one' -RepoRoot $dispatcherSandbox `
        -IdentityLookup { param($expectedProcess) $expectedProcess } -HealthFn { param($url) $true }
    Assert-Equal 'active' $derivedOffsetStatus.status 'status reports active when every owned backend is ready'
    Assert-Equal 2 @($derivedOffsetStatus.backend).Count 'status derives nonzero offset from manifest when omitted'
    Assert-Throws {
        Invoke-IsolatedBranchStack -Action status -ChangeId 'change-a' -RunId 'run-status-offset-one' -OffsetInput '0' -RepoRoot $dispatcherSandbox `
            -IdentityLookup { param($expectedProcess) $expectedProcess } -HealthFn { param($url) $true }
    } 'explicit mismatching offset is rejected'
    $derivedOffsetStops = [System.Collections.Generic.List[int]]::new()
    $derivedOffsetStop = Invoke-IsolatedBranchStack -Action stop -ChangeId 'change-a' -RunId 'run-status-offset-one' -RepoRoot $dispatcherSandbox `
        -IdentityLookup { param($expectedProcess) $expectedProcess } `
        -StopListenerLookupFn { param($port) $null } `
        -ProcessHandleLookup $fakeProcessHandleLookup `
        -StopProcessFn { param($processId) $script:derivedOffsetStops.Add($processId) }
    Assert-Equal 'stopped' $derivedOffsetStop.status 'stop derives nonzero offset from manifest when omitted'
    Assert-Equal '4102,4101' ($derivedOffsetStops -join ',') 'derived-offset stop uses manifest-owned backend identities'
    $derivedStoppedStatus = Invoke-IsolatedBranchStack -Action status -ChangeId 'change-a' -RunId 'run-status-offset-one' -RepoRoot $dispatcherSandbox `
        -IdentityLookup { param($expectedProcess) $expectedProcess } -HealthFn { param($url) $true }
    Assert-Equal 'stopped' $derivedStoppedStatus.status 'status preserves stopped manifest state even when identity probes are healthy'

    $manifestIdentityMutations = @(
        [pscustomobject]@{name='schema';mutate={ param($manifest) $manifest.schema_version='wrong' }},
        [pscustomobject]@{name='stack kind';mutate={ param($manifest) $manifest.stack_kind='wrong' }},
        [pscustomobject]@{name='change';mutate={ param($manifest) $manifest.change_id='wrong' }},
        [pscustomobject]@{name='run';mutate={ param($manifest) $manifest.run_id='wrong' }},
        [pscustomobject]@{name='worktree';mutate={ param($manifest) $manifest.worktree_root='C:\wrong-worktree' }},
        [pscustomobject]@{name='offset';mutate={ param($manifest) $manifest.offset=1 }},
        [pscustomobject]@{name='deployment coordinator URL';mutate={ param($manifest) $manifest.base_urls.coordinator='http://127.0.0.1:8004' }},
        [pscustomobject]@{name='deployment governance URL';mutate={ param($manifest) $manifest.base_urls.governance='http://127.0.0.1:49102' }},
        [pscustomobject]@{name='governance lifecycle owner';mutate={ param($manifest) $manifest.lifecycle_owners.governance='external' }},
        [pscustomobject]@{name='viewer lifecycle owner';mutate={ param($manifest) $manifest.lifecycle_owners.viewer='repo_launcher' }},
        [pscustomobject]@{name='viewer owner';mutate={ param($manifest) $manifest.viewer.owner='repo_launcher' }},
        [pscustomobject]@{name='viewer port';mutate={ param($manifest) $manifest.viewer.expected_port=5173 }},
        [pscustomobject]@{name='viewer launcher flag';mutate={ param($manifest) $manifest.viewer.managed_by_launcher=$true }},
        [pscustomobject]@{name='missing processes';mutate={ param($manifest) $manifest.PSObject.Properties.Remove('processes') }},
        [pscustomobject]@{name='empty processes';mutate={ param($manifest) $manifest.processes=@() }},
        [pscustomobject]@{name='missing coordinator process';mutate={ param($manifest) $manifest.processes=@($manifest.processes | Where-Object role -eq 'governance') }},
        [pscustomobject]@{name='duplicate process role';mutate={ param($manifest) $manifest.processes[1].role='governance';$manifest.processes[1].entrypoint=$expectedGovernanceEntrypoint;$manifest.processes[1].command_line="python -m uvicorn --app-dir $expectedGovernanceEntrypoint app:app --host 127.0.0.1 --port 49103" }},
        [pscustomobject]@{name='unknown process role';mutate={ param($manifest) $manifest.processes[1].role='viewer' }},
        [pscustomobject]@{name='duplicate process PID';mutate={ param($manifest) $manifest.processes[1].pid=$manifest.processes[0].pid }},
        [pscustomobject]@{name='wrong coordinator entrypoint';mutate={ param($manifest) $manifest.processes[1].entrypoint='src/index.ts' }}
    )
    foreach ($identityMutation in $manifestIdentityMutations) {
        $candidate = $statusManifest | ConvertTo-Json -Depth 12 | ConvertFrom-Json -Depth 12
        & $identityMutation.mutate $candidate
        Assert-Throws {
            Assert-IsolatedStackManifestIdentity -Manifest $candidate -RepoRoot $dispatcherSandbox -ChangeId 'change-a' -RunId 'run-status' -OffsetInput '0'
        } "manifest $($identityMutation.name) mismatch rejected"
    }

    $recoverySubset = $statusManifest | ConvertTo-Json -Depth 12 | ConvertFrom-Json -Depth 12
    $recoverySubset.processes = @($recoverySubset.processes | Where-Object role -eq 'governance')
    $recoverySubset | Add-Member -Force -NotePropertyName start_failure -NotePropertyValue ([pscustomobject]@{message='coordinator start failed';occurred_at='2026-07-30T00:00:00Z'})
    $recoverySubset | Add-Member -Force -NotePropertyName reservation_held -NotePropertyValue $true
    Assert-IsolatedStackManifestIdentity -Manifest $recoverySubset -RepoRoot $dispatcherSandbox -ChangeId 'change-a' -RunId 'run-status' -OffsetInput '0'
    $recoverySubsetStatus = Get-IsolatedStackStatus -Manifest $recoverySubset -ManifestPath 'recovery-subset.json' `
        -IdentityLookup { param($expectedProcess) $expectedProcess } -HealthFn { param($url) $true }
    Assert-Equal 'degraded' $recoverySubsetStatus.status 'active recovery subset never reports active even when its surviving backend is healthy'

    $emptyRecovery = $recoverySubset | ConvertTo-Json -Depth 12 | ConvertFrom-Json -Depth 12
    $emptyRecovery.run_id = 'run-empty-recovery'
    $emptyRecovery.processes = @()
    $emptyRecoveryPath = Resolve-IsolatedStackManifestPath -RepoRoot $dispatcherSandbox -ChangeId 'change-a' -RunId 'run-empty-recovery'
    Write-IsolatedJsonAtomic -Path $emptyRecoveryPath -Value $emptyRecovery -NoClobber
    $emptyRecoveryReleaseCalls = 0
    Assert-Throws {
        Invoke-IsolatedBranchStack -Action stop -ChangeId 'change-a' -RunId 'run-empty-recovery' -RepoRoot $dispatcherSandbox `
            -ReservationReleaseFn { param($reservation) $script:emptyRecoveryReleaseCalls++ }
    } 'empty recovery manifest fails closed before stop or reservation release'
    Assert-Equal 0 $emptyRecoveryReleaseCalls 'empty recovery manifest never releases a held reservation'

    $unknownActiveListener = $statusManifest | ConvertTo-Json -Depth 12 | ConvertFrom-Json -Depth 12
    $unknownActiveListener.run_id = 'run-unknown-active-listener'
    $unknownActiveListenerPath = Resolve-IsolatedStackManifestPath -RepoRoot $dispatcherSandbox -ChangeId 'change-a' -RunId 'run-unknown-active-listener'
    Write-IsolatedJsonAtomic -Path $unknownActiveListenerPath -Value $unknownActiveListener -NoClobber
    $unknownActiveListenerStops = [System.Collections.Generic.List[int]]::new()
    Assert-Throws {
        Invoke-IsolatedBranchStack -Action stop -ChangeId 'change-a' -RunId 'run-unknown-active-listener' -RepoRoot $dispatcherSandbox `
            -IdentityLookup { param($expectedProcess) $expectedProcess } `
            -ProcessExistsFn { param($processId) $true } `
            -StopListenerLookupFn { param($port) if ($port -eq 49103) { [pscustomobject]@{LocalPort=$port;State='Listen';OwningProcess=9999} } else { $null } } `
            -ProcessHandleLookup $fakeProcessHandleLookup `
            -StopProcessFn { param($processId) $script:unknownActiveListenerStops.Add($processId) }
    } 'unknown listener on an active role port fails closed before stopping any backend'
    Assert-Equal 0 $unknownActiveListenerStops.Count 'unknown active listener stops zero processes'

    $stillAliveManifest = $statusManifest | ConvertTo-Json -Depth 12 | ConvertFrom-Json -Depth 12
    $stillAliveManifest.run_id = 'run-kill-request-still-alive'
    $stillAliveManifest | Add-Member -Force -NotePropertyName reservation_held -NotePropertyValue $true
    $stillAliveManifest | Add-Member -Force -NotePropertyName start_failure -NotePropertyValue ([pscustomobject]@{message='recovery';occurred_at='2026-07-30T00:00:00Z'})
    $stillAlivePath = Resolve-IsolatedStackManifestPath -RepoRoot $dispatcherSandbox -ChangeId 'change-a' -RunId 'run-kill-request-still-alive'
    Write-IsolatedJsonAtomic -Path $stillAlivePath -Value $stillAliveManifest -NoClobber
    $stillAliveReleaseCalls = 0
    Assert-Throws {
        Invoke-IsolatedBranchStack -Action stop -ChangeId 'change-a' -RunId 'run-kill-request-still-alive' -RepoRoot $dispatcherSandbox `
            -IdentityLookup { param($expectedProcess) $expectedProcess } `
            -ProcessExistsFn { param($processId) $true } `
            -StopListenerLookupFn { param($port) $null } `
            -ProcessHandleLookup $fakeProcessHandleLookup `
            -StopProcessFn { param($processId) } `
            -ReservationReleaseFn { param($reservation) $script:stillAliveReleaseCalls++ }
    } 'kill request that leaves a backend alive cannot complete stop or release reservation'
    Assert-Equal 0 $stillAliveReleaseCalls 'unproven backend termination retains the recovery reservation'

    $failureMatrix = @(
        [pscustomobject]@{runId='run-gov-start';kind='governance_start';expectedStarted='governance';expectedStopped='';preseed=$false},
        [pscustomobject]@{runId='run-gov-health';kind='governance_health';expectedStarted='governance';expectedStopped='5101';preseed=$false},
        [pscustomobject]@{runId='run-coord-start';kind='coordinator_start';expectedStarted='governance,coordinator';expectedStopped='5101';preseed=$false},
        [pscustomobject]@{runId='run-coord-health';kind='coordinator_health';expectedStarted='governance,coordinator';expectedStopped='5102,5101';preseed=$false},
        [pscustomobject]@{runId='run-invalid-head';kind='invalid_head';expectedStarted='';expectedStopped='';preseed=$false},
        [pscustomobject]@{runId='run-manifest-collision';kind='manifest_collision';expectedStarted='governance,coordinator';expectedStopped='5102,5101';preseed=$true}
    )
    foreach ($failure in $failureMatrix) {
        $failureManifestPath = Resolve-IsolatedStackManifestPath -RepoRoot $dispatcherSandbox -ChangeId 'change-a' -RunId $failure.runId
        $sentinel = '{"preexisting":true}'
        if ($failure.preseed) {
            New-Item -ItemType Directory -Force -Path (Split-Path -Parent $failureManifestPath) | Out-Null
            Set-Content -LiteralPath $failureManifestPath -Value $sentinel -NoNewline
        }
        $failedStartRoles = [System.Collections.Generic.List[string]]::new()
        $failedStopIds = [System.Collections.Generic.List[int]]::new()
        Assert-Throws {
            Invoke-IsolatedBranchStack -Action start -ChangeId 'change-a' -RunId $failure.runId -OffsetInput '0' `
                -RepoRoot $dispatcherSandbox -WorktreeStatusFn { param($root) @() } `
                -PreflightFn { param($root,$change,$run,$offset) [pscustomobject]@{offset=0;ports=[pscustomobject]@{coordinator=8005;governance=49103;viewer=5180};manifest_path=$failureManifestPath} } `
                -RuntimeResolver { param($root) [pscustomobject]@{python='python';node='node';tsx='tsx.mjs'} } `
                -StartBackendFn {
                    param($spec)
                    $script:failedStartRoles.Add($spec.role)
                    if (($failure.kind -eq 'governance_start' -and $spec.role -eq 'governance') -or
                        ($failure.kind -eq 'coordinator_start' -and $spec.role -eq 'coordinator')) { throw "$($failure.kind) failed" }
                    $backendId = if ($spec.role -eq 'governance') { 5101 } else { 5102 }
                    [pscustomobject]@{role=$spec.role;pid=$backendId;entrypoint=$spec.entrypoint;command_line=$spec.role;creation_identity=$spec.role}
                } `
                -HealthFn {
                    param($url)
                    if ($failure.kind -eq 'governance_health' -and $url.EndsWith(':49103/health')) { return $false }
                    if ($failure.kind -eq 'coordinator_health' -and $url.EndsWith(':8005/health')) { return $false }
                    $true
                } `
                -IdentityLookup { param($expectedProcess) $expectedProcess } `
                -ProcessHandleLookup $fakeProcessHandleLookup `
                -StopProcessFn { param($processId) $script:failedStopIds.Add($processId) } `
                -HeadShaFn { param($root) if ($failure.kind -eq 'invalid_head') { 'not-a-sha' } else { ('c' * 40 -join '') } }
        } "start failure $($failure.kind) is reported"
        Assert-Equal $failure.expectedStarted ($failedStartRoles -join ',') "start roles for $($failure.kind)"
        Assert-Equal $failure.expectedStopped ($failedStopIds -join ',') "rollback exact identities for $($failure.kind)"
        if ($failure.preseed) {
            Assert-Equal $sentinel (Get-Content -Raw -LiteralPath $failureManifestPath) "manifest collision does not overwrite existing evidence"
        } else {
            Assert-True (-not (Test-Path -LiteralPath $failureManifestPath)) "failed $($failure.kind) writes no success manifest"
        }
    }

    $recoveryRunId = 'run-rollback-stop-failure'
    $recoveryManifestPath = Resolve-IsolatedStackManifestPath -RepoRoot $dispatcherSandbox -ChangeId 'change-a' -RunId $recoveryRunId
    Assert-Throws {
        Invoke-IsolatedBranchStack -Action start -ChangeId 'change-a' -RunId $recoveryRunId -OffsetInput '0' -RepoRoot $dispatcherSandbox `
            -WorktreeStatusFn { param($root) @() } `
            -PreflightFn { param($root,$change,$run,$offset) [pscustomobject]@{offset=0;ports=[pscustomobject]@{coordinator=8005;governance=49103;viewer=5180};manifest_path=$recoveryManifestPath} } `
            -RuntimeResolver { param($root) [pscustomobject]@{python='python';node='node';tsx='tsx.mjs'} } `
            -StartBackendFn {
                param($spec)
                if ($spec.role -eq 'coordinator') { throw 'coordinator start failed' }
                [pscustomobject]@{role='governance';pid=6101;entrypoint=$spec.entrypoint;command_line=($spec.Arguments -join ' ');creation_identity='recovery-c1'}
            } `
            -HealthFn { param($url) $true } `
            -IdentityLookup { param($expectedProcess) $expectedProcess } `
            -ProcessHandleLookup $fakeProcessHandleLookup `
            -StopProcessFn { param($processId) throw 'injected rollback stop failure' } `
            -HeadShaFn { param($root) ('d' * 40 -join '') }
    } 'incomplete startup rollback writes a recovery manifest and holds reservations'
    Assert-True (Test-Path -LiteralPath $recoveryManifestPath -PathType Leaf) 'incomplete rollback retains a recovery manifest'
    $recoveryManifest = Read-IsolatedStackManifest -Path $recoveryManifestPath
    Assert-True ([bool]$recoveryManifest.reservation_held) 'incomplete rollback marks its reservation held'
    Assert-Equal 'stop_failed' @($recoveryManifest.stop_state.entries)[0].status 'recovery manifest records rollback stop failure'
    Assert-True (-not $recoveryManifest.backend_ready.governance -and -not $recoveryManifest.backend_ready.coordinator) 'recovery manifest cannot claim backend readiness'
    $heldRecoveryReservation = Resolve-IsolatedStackReservation -RepoRoot $dispatcherSandbox -ChangeId 'change-a' -RunId $recoveryRunId -Offset 0
    foreach ($reservationPath in @($heldRecoveryReservation.paths)) {
        Assert-True (Test-Path -LiteralPath $reservationPath -PathType Leaf) "incomplete rollback retains reservation file: $reservationPath"
    }
    $recoveryRetryStops = [System.Collections.Generic.List[int]]::new()
    $recoveryStop = Invoke-IsolatedBranchStack -Action stop -ChangeId 'change-a' -RunId $recoveryRunId -RepoRoot $dispatcherSandbox `
        -IdentityLookup { param($expectedProcess) $expectedProcess } `
        -StopListenerLookupFn { param($port) $null } `
        -ProcessHandleLookup $fakeProcessHandleLookup `
        -StopProcessFn { param($processId) $script:recoveryRetryStops.Add($processId) }
    Assert-Equal 'stopped' $recoveryStop.status 'recovery manifest supports an explicit stop retry'
    Assert-Equal '6101' ($recoveryRetryStops -join ',') 'recovery retry stops only the surviving owned backend'
    $recoveredManifest = Read-IsolatedStackManifest -Path $recoveryManifestPath
    Assert-True (-not [bool]$recoveredManifest.reservation_held) 'successful recovery stop clears held reservation state'
    foreach ($reservationPath in @($heldRecoveryReservation.paths)) {
        Assert-True (-not (Test-Path -LiteralPath $reservationPath)) "successful recovery stop releases reservation file: $reservationPath"
    }

    $partialStopManifest = $statusManifest | ConvertTo-Json -Depth 12 | ConvertFrom-Json -Depth 12
    $partialStopManifest.run_id = 'run-partial-stop'
    $partialStopPath = Resolve-IsolatedStackManifestPath -RepoRoot $dispatcherSandbox -ChangeId 'change-a' -RunId 'run-partial-stop'
    Write-IsolatedJsonAtomic -Path $partialStopPath -Value $partialStopManifest -NoClobber
    $partialStopAttempts = [System.Collections.Generic.List[int]]::new()
    Assert-Throws {
        Invoke-IsolatedBranchStack -Action stop -ChangeId 'change-a' -RunId 'run-partial-stop' -RepoRoot $dispatcherSandbox `
            -IdentityLookup { param($expectedProcess) $expectedProcess } `
            -StopListenerLookupFn { param($port) $null } `
            -ProcessHandleLookup $fakeProcessHandleLookup `
            -StopProcessFn {
                param($processId)
                $script:partialStopAttempts.Add($processId)
                if ($processId -eq 4102) { throw 'injected coordinator stop failure' }
            }
    } 'partial stop persists recoverable per-process state'
    Assert-Equal '4102,4101' ($partialStopAttempts -join ',') 'partial stop still attempts every prevalidated owned backend'
    $afterPartialStop = Read-IsolatedStackManifest -Path $partialStopPath
    Assert-True (-not $afterPartialStop.stopped_at) 'partial stop leaves stopped_at unset'
    Assert-True (-not $afterPartialStop.backend_ready.governance -and $afterPartialStop.backend_ready.coordinator) 'partial stop clears readiness only for the backend that stopped'
    Assert-Equal 'stopped' @($afterPartialStop.processes | Where-Object role -eq 'governance')[0].stop_status 'partial stop records the stopped backend'

    $missingExitManifest = $afterPartialStop | ConvertTo-Json -Depth 12 | ConvertFrom-Json -Depth 12
    $missingExitManifest.run_id = 'run-partial-stop-missing-exit'
    $missingExitPath = Resolve-IsolatedStackManifestPath -RepoRoot $dispatcherSandbox -ChangeId 'change-a' -RunId 'run-partial-stop-missing-exit'
    Write-IsolatedJsonAtomic -Path $missingExitPath -Value $missingExitManifest -NoClobber
    $missingExitStops = [System.Collections.Generic.List[int]]::new()
    $missingExitRetry = Invoke-IsolatedBranchStack -Action stop -ChangeId 'change-a' -RunId 'run-partial-stop-missing-exit' -RepoRoot $dispatcherSandbox `
        -IdentityLookup { param($expectedProcess) throw 'process missing' } `
        -ProcessExistsFn { param($processId) $false } `
        -StopListenerLookupFn { param($port) $null } `
        -ProcessHandleLookup $fakeProcessHandleLookup `
        -StopProcessFn { param($processId) $script:missingExitStops.Add($processId) }
    Assert-Equal 'stopped' $missingExitRetry.status 'retry accepts an absent failed process only when its role port is free'
    Assert-Equal 0 $missingExitStops.Count 'already-exited retry stops no rediscovered process'
    Assert-True (-not [string]::IsNullOrWhiteSpace([string](Read-IsolatedStackManifest -Path $missingExitPath).stopped_at)) 'safe missing-process retry records stopped_at'

    $unknownListenerManifest = $afterPartialStop | ConvertTo-Json -Depth 12 | ConvertFrom-Json -Depth 12
    $unknownListenerManifest.run_id = 'run-partial-stop-unknown-listener'
    $unknownListenerPath = Resolve-IsolatedStackManifestPath -RepoRoot $dispatcherSandbox -ChangeId 'change-a' -RunId 'run-partial-stop-unknown-listener'
    Write-IsolatedJsonAtomic -Path $unknownListenerPath -Value $unknownListenerManifest -NoClobber
    Assert-Throws {
        Invoke-IsolatedBranchStack -Action stop -ChangeId 'change-a' -RunId 'run-partial-stop-unknown-listener' -RepoRoot $dispatcherSandbox `
            -IdentityLookup { param($expectedProcess) throw 'process missing' } `
        -ProcessExistsFn { param($processId) $false } `
        -StopListenerLookupFn { param($port) [pscustomobject]@{LocalPort=$port;OwningProcess=9999} } `
        -ProcessHandleLookup $fakeProcessHandleLookup `
        -StopProcessFn { param($processId) throw 'unknown listener must not be stopped' }
    } 'missing process with an unknown listener remains fail closed'
    Assert-True (-not (Read-IsolatedStackManifest -Path $unknownListenerPath).stopped_at) 'unknown-listener retry leaves stopped_at unset'

    $listenerFailureManifest = $afterPartialStop | ConvertTo-Json -Depth 12 | ConvertFrom-Json -Depth 12
    $listenerFailureManifest.run_id = 'run-partial-stop-listener-failure'
    $listenerFailurePath = Resolve-IsolatedStackManifestPath -RepoRoot $dispatcherSandbox -ChangeId 'change-a' -RunId 'run-partial-stop-listener-failure'
    Write-IsolatedJsonAtomic -Path $listenerFailurePath -Value $listenerFailureManifest -NoClobber
    Assert-Throws {
        Invoke-IsolatedBranchStack -Action stop -ChangeId 'change-a' -RunId 'run-partial-stop-listener-failure' -RepoRoot $dispatcherSandbox `
            -IdentityLookup { param($expectedProcess) throw 'process missing' } `
        -ProcessExistsFn { param($processId) $false } `
        -StopListenerLookupFn { param($port) throw 'injected listener provider failure' } `
        -ProcessHandleLookup $fakeProcessHandleLookup `
        -StopProcessFn { param($processId) throw 'listener lookup failure must not stop a process' }
    } 'listener provider failure is not treated as a free port'
    Assert-True (-not (Read-IsolatedStackManifest -Path $listenerFailurePath).stopped_at) 'listener-provider failure leaves stopped_at unset'

    $partialRetryStops = [System.Collections.Generic.List[int]]::new()
    $partialRetry = Invoke-IsolatedBranchStack -Action stop -ChangeId 'change-a' -RunId 'run-partial-stop' -RepoRoot $dispatcherSandbox `
        -IdentityLookup { param($expectedProcess) $expectedProcess } `
        -StopListenerLookupFn { param($port) $null } `
        -ProcessHandleLookup $fakeProcessHandleLookup `
        -StopProcessFn { param($processId) $script:partialRetryStops.Add($processId) }
    Assert-Equal 'stopped' $partialRetry.status 'partial stop can be retried to completion'
    Assert-Equal '4102' ($partialRetryStops -join ',') 'retry skips the backend already recorded as stopped'
    $afterPartialRetry = Read-IsolatedStackManifest -Path $partialStopPath
    Assert-True (-not [string]::IsNullOrWhiteSpace([string]$afterPartialRetry.stopped_at)) 'successful retry records stopped_at'
    Assert-True (-not $afterPartialRetry.backend_ready.governance -and -not $afterPartialRetry.backend_ready.coordinator) 'successful retry clears both backend readiness flags'

    $stopManifest = [ordered]@{}
    foreach ($key in $statusManifest.Keys) { $stopManifest[$key] = $statusManifest[$key] }
    $stopManifest.run_id = 'run-stop'
    $stopPath = Resolve-IsolatedStackManifestPath -RepoRoot $dispatcherSandbox -ChangeId 'change-a' -RunId 'run-stop'
    Write-IsolatedJsonAtomic -Path $stopPath -Value $stopManifest -NoClobber
    $mismatchStops = [System.Collections.Generic.List[int]]::new()
    Assert-Throws {
        Invoke-IsolatedBranchStack -Action stop -ChangeId 'change-a' -RunId 'run-stop' -OffsetInput '0' -RepoRoot $dispatcherSandbox `
            -IdentityLookup { param($expectedProcess) if($expectedProcess.pid -eq 4101){$expectedProcess}else{[pscustomobject]@{role='coordinator';pid=4102;entrypoint='wrong';command_line='coord';creation_identity='c2'}} } `
            -StopListenerLookupFn { param($port) $null } `
            -ProcessHandleLookup $fakeProcessHandleLookup `
            -StopProcessFn { param($processId) $script:mismatchStops.Add($processId) }
    } 'stop ownership mismatch leaves every process running'
    Assert-Equal 0 $mismatchStops.Count 'stop validates all identities before any stop'
    Assert-True (-not (Read-IsolatedStackManifest -Path $stopPath).stopped_at) 'failed stop leaves stopped_at unset'

    $stoppedRun = Invoke-IsolatedBranchStack -Action stop -ChangeId 'change-a' -RunId 'run-stop' -OffsetInput '0' -RepoRoot $dispatcherSandbox `
        -IdentityLookup { param($expectedProcess) $expectedProcess } `
        -StopListenerLookupFn { param($port) $null } `
        -ProcessHandleLookup $fakeProcessHandleLookup `
        -StopProcessFn { param($processId) $script:mismatchStops.Add($processId) }
    Assert-Equal 'stopped' $stoppedRun.status 'exact ownership stops the stack'
    Assert-Equal '4102,4101' ($mismatchStops -join ',') 'stop uses reverse manifest order after all identities validate'
    $stoppedManifest = Read-IsolatedStackManifest -Path $stopPath
    Assert-True (-not [string]::IsNullOrWhiteSpace([string]$stoppedManifest.stopped_at)) 'successful stop atomically records stopped_at'
    Assert-True (-not $stoppedManifest.backend_ready.governance -and -not $stoppedManifest.backend_ready.coordinator) 'successful stop clears backend readiness'

    $directExecutionOutput = (& pwsh -NoProfile -NonInteractive -File $launcherPath -Action status -ChangeId '.' -RunId 'run-a' -RepoRoot $dispatcherSandbox 2>&1 | Out-String)
    Assert-True ($LASTEXITCODE -ne 0) 'direct launcher execution dispatches invalid identity failure'
    Assert-True ($directExecutionOutput -match [regex]::Escape('ChangeId must be one safe path segment')) 'direct launcher execution reaches dispatcher validation'
}
finally { Remove-TestSandbox -Path $dispatcherSandbox }

$testLogger | Write-StructInfo -Component 'test-isolated-branch-stack' -Msg 'contract assertions passed' -Data @{ assertions = 'isolated-stack' }
