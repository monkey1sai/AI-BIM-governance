. (Join-Path $PSScriptRoot 'test-helpers.ps1')

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

$launcherPath = Join-Path $repoRoot 'scripts\dev\start-isolated-branch-stack.ps1'
. $launcherPath

$p0 = Resolve-IsolatedStackPorts -OffsetInput '0'
Assert-Equal 8005 $p0.coordinator 'offset 0 coordinator'
Assert-Equal 49103 $p0.governance 'offset 0 governance'
Assert-Equal 5180 $p0.viewer 'offset 0 viewer'
$p4 = Resolve-IsolatedStackPorts -OffsetInput '4'
Assert-Equal 8009 $p4.coordinator 'offset 4 coordinator'
Assert-Equal 49107 $p4.governance 'offset 4 governance'
Assert-Equal 5184 $p4.viewer 'offset 4 viewer'
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
foreach ($field in @('pid','entrypoint','command_line','creation_identity')) {
    $changed = $same.PSObject.Copy()
    $changed.$field = if ($field -eq 'pid') { 9999 } else { "wrong-$field" }
    Assert-True (-not (Test-IsolatedProcessOwnership -Expected $expected -Actual $changed)) "$field mismatch rejected"
}

$stopped = [System.Collections.Generic.List[int]]::new()
$owned = @(
    [pscustomobject]@{ role='governance';pid=4201;entrypoint='app:app';command_line='gov';creation_identity='c1' },
    [pscustomobject]@{ role='coordinator';pid=4202;entrypoint='src/index.ts';command_line='coord';creation_identity='c2' }
)
Assert-Throws {
    Stop-IsolatedBackends -Processes $owned `
      -IdentityLookup { param($e) if($e.pid -eq 4201){$e}else{[pscustomobject]@{role='coordinator';pid=4202;entrypoint='wrong';command_line='coord';creation_identity='c2'}} } `
      -StopProcessFn { param($processId) $script:stopped.Add($processId) }
} 'one mismatch holds the entire stop'
Assert-Equal 0 $stopped.Count 'all identities validate before any stop'

$stoppedExactly = [System.Collections.Generic.List[int]]::new()
Stop-IsolatedBackends -Processes $owned `
  -IdentityLookup { param($expectedProcess) $expectedProcess } `
  -StopProcessFn { param($processId) $script:stoppedExactly.Add($processId) }
Assert-Equal '4202,4201' ($stoppedExactly -join ',') 'exact identities stop in reverse manifest order'

$spawned = [pscustomobject]@{ Id = 4301 }
$cleanedSpawned = [System.Collections.Generic.List[object]]::new()
Assert-Throws {
    Start-IsolatedBackend -Role 'governance' -WorkingDirectory $repoRoot -Executable 'python' -Arguments @('--version') `
        -Environment @{} -RunDirectory (Join-Path $repoRoot 'artifacts\test-spawn-cleanup') -Entrypoint 'app:app' `
        -StartProcessFn { param($exe,$args,$cwd,$envMap,$stdout,$stderr) $script:spawned } `
        -IdentityLookup { param($processId,$entrypoint) throw 'snapshot failed' } `
        -StopSpawnedProcessFn { param($spawnedProcess) $script:cleanedSpawned.Add($spawnedProcess) }
} 'identity snapshot failure cleans the exact spawned process handle'
Assert-Equal 1 $cleanedSpawned.Count 'snapshot failure cleans exactly one spawned process'
Assert-True ([object]::ReferenceEquals($spawned, $cleanedSpawned[0])) 'snapshot failure cleans the spawned process object, not a rediscovered PID'

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

$dispatcherSandbox = New-TestSandbox -Prefix 'isolated-stack-dispatcher'
try {
    $startedRoles = [System.Collections.Generic.List[string]]::new()
    $stoppedPids = [System.Collections.Generic.List[int]]::new()
    $startManifestPath = Resolve-IsolatedStackManifestPath -RepoRoot $dispatcherSandbox -ChangeId 'change-a' -RunId 'run-start'
    Assert-Throws {
        Invoke-IsolatedBranchStack -Action start -ChangeId 'change-a' -RunId 'run-start' -OffsetInput '0' `
          -RepoRoot $dispatcherSandbox `
          -PreflightFn { param($root,$change,$run,$offset) [pscustomobject]@{offset=0;ports=[pscustomobject]@{coordinator=8005;governance=49103;viewer=5180};manifest_path=$startManifestPath} } `
          -RuntimeResolver { param($root) [pscustomobject]@{python='python';node='node';tsx='tsx.mjs'} } `
          -StartBackendFn { param($spec) $script:startedRoles.Add($spec.role); if($spec.role -eq 'coordinator'){throw 'coordinator start failed'}; [pscustomobject]@{role='governance';pid=4101;entrypoint='app:app';command_line='gov';creation_identity='c1'} } `
          -HealthFn { param($url) $true } `
          -IdentityLookup { param($e) $e } `
          -StopProcessFn { param($processId) $script:stoppedPids.Add($processId) } `
          -HeadShaFn { param($root) ('a' * 40 -join '') }
    } 'second backend failure rolls back first backend'
    Assert-Equal 'governance,coordinator' ($startedRoles -join ',') 'start order'
    Assert-Equal '4101' ($stoppedPids -join ',') 'only this-run owned first backend stopped'
    Assert-True (-not (Test-Path -LiteralPath $startManifestPath)) 'failed start writes no success manifest'

    $successManifestPath = Resolve-IsolatedStackManifestPath -RepoRoot $dispatcherSandbox -ChangeId 'change-a' -RunId 'run-success'
    $success = Invoke-IsolatedBranchStack -Action start -ChangeId 'change-a' -RunId 'run-success' -OffsetInput '0' `
        -RepoRoot $dispatcherSandbox `
        -PreflightFn { param($root,$change,$run,$offset) [pscustomobject]@{offset=0;ports=[pscustomobject]@{coordinator=8005;governance=49103;viewer=5180};manifest_path=$successManifestPath} } `
        -RuntimeResolver { param($root) [pscustomobject]@{python='python';node='node';tsx='tsx.mjs'} } `
        -StartBackendFn {
            param($spec)
            $backendId = if ($spec.role -eq 'governance') { 4201 } else { 4202 }
            [pscustomobject]@{role=$spec.role;pid=$backendId;entrypoint=$spec.entrypoint;command_line=$spec.role;creation_identity=$spec.role}
        } `
        -HealthFn { param($url) $true } `
        -IdentityLookup { param($expectedProcess) $expectedProcess } `
        -StopProcessFn { param($processId) throw "unexpected success rollback for $processId" } `
        -HeadShaFn { param($root) ('b' * 40 -join '') }
    Assert-Equal 'started' $success.status 'successful start returns started'
    Assert-True (Test-Path -LiteralPath $successManifestPath -PathType Leaf) 'successful start writes a manifest'
    $successManifest = Read-IsolatedStackManifest -Path $successManifestPath
    Assert-Equal 'isolated-branch-stack/v1' $successManifest.schema_version 'successful start writes v1 manifest'
    Assert-Equal 'isolated_branch_stack' $successManifest.stack_kind 'successful start writes isolated stack kind'
    Assert-Equal 2 @($successManifest.processes).Count 'successful start writes both backend identities'

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
            [pscustomobject]@{role='governance';pid=4101;entrypoint='app:app';command_line='gov';creation_identity='c1'},
            [pscustomobject]@{role='coordinator';pid=4102;entrypoint='src/index.ts';command_line='coord';creation_identity='c2'}
        )
    }
    $statusPath = Resolve-IsolatedStackManifestPath -RepoRoot $dispatcherSandbox -ChangeId 'change-a' -RunId 'run-status'
    Write-IsolatedJsonAtomic -Path $statusPath -Value $statusManifest -NoClobber
    $status = Invoke-IsolatedBranchStack -Action status -ChangeId 'change-a' -RunId 'run-status' -OffsetInput '0' -RepoRoot $dispatcherSandbox `
        -IdentityLookup { param($expectedProcess) $expectedProcess } `
        -HealthFn { param($url) -not $url.EndsWith(':8005/health') }
    $governanceStatus = @($status.backend | Where-Object role -eq 'governance')[0]
    $coordinatorStatus = @($status.backend | Where-Object role -eq 'coordinator')[0]
    Assert-True ($governanceStatus.owned -and $governanceStatus.ready) 'owned healthy governance is ready'
    Assert-True ($coordinatorStatus.owned -and -not $coordinatorStatus.ready) 'owned coordinator with failed live health is not ready'

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
        [pscustomobject]@{name='viewer launcher flag';mutate={ param($manifest) $manifest.viewer.managed_by_launcher=$true }}
    )
    foreach ($identityMutation in $manifestIdentityMutations) {
        $candidate = $statusManifest | ConvertTo-Json -Depth 12 | ConvertFrom-Json -Depth 12
        & $identityMutation.mutate $candidate
        Assert-Throws {
            Assert-IsolatedStackManifestIdentity -Manifest $candidate -RepoRoot $dispatcherSandbox -ChangeId 'change-a' -RunId 'run-status' -OffsetInput '0'
        } "manifest $($identityMutation.name) mismatch rejected"
    }

    $failureMatrix = @(
        [pscustomobject]@{runId='run-gov-start';kind='governance_start';expectedStarted='governance';expectedStopped='';preseed=$false},
        [pscustomobject]@{runId='run-gov-health';kind='governance_health';expectedStarted='governance';expectedStopped='5101';preseed=$false},
        [pscustomobject]@{runId='run-coord-start';kind='coordinator_start';expectedStarted='governance,coordinator';expectedStopped='5101';preseed=$false},
        [pscustomobject]@{runId='run-coord-health';kind='coordinator_health';expectedStarted='governance,coordinator';expectedStopped='5102,5101';preseed=$false},
        [pscustomobject]@{runId='run-invalid-head';kind='invalid_head';expectedStarted='governance,coordinator';expectedStopped='5102,5101';preseed=$false},
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
                -RepoRoot $dispatcherSandbox `
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

    $stopManifest = [ordered]@{}
    foreach ($key in $statusManifest.Keys) { $stopManifest[$key] = $statusManifest[$key] }
    $stopManifest.run_id = 'run-stop'
    $stopPath = Resolve-IsolatedStackManifestPath -RepoRoot $dispatcherSandbox -ChangeId 'change-a' -RunId 'run-stop'
    Write-IsolatedJsonAtomic -Path $stopPath -Value $stopManifest -NoClobber
    $mismatchStops = [System.Collections.Generic.List[int]]::new()
    Assert-Throws {
        Invoke-IsolatedBranchStack -Action stop -ChangeId 'change-a' -RunId 'run-stop' -OffsetInput '0' -RepoRoot $dispatcherSandbox `
            -IdentityLookup { param($expectedProcess) if($expectedProcess.pid -eq 4101){$expectedProcess}else{[pscustomobject]@{role='coordinator';pid=4102;entrypoint='wrong';command_line='coord';creation_identity='c2'}} } `
            -StopProcessFn { param($processId) $script:mismatchStops.Add($processId) }
    } 'stop ownership mismatch leaves every process running'
    Assert-Equal 0 $mismatchStops.Count 'stop validates all identities before any stop'
    Assert-True (-not (Read-IsolatedStackManifest -Path $stopPath).stopped_at) 'failed stop leaves stopped_at unset'

    $stoppedRun = Invoke-IsolatedBranchStack -Action stop -ChangeId 'change-a' -RunId 'run-stop' -OffsetInput '0' -RepoRoot $dispatcherSandbox `
        -IdentityLookup { param($expectedProcess) $expectedProcess } `
        -StopProcessFn { param($processId) $script:mismatchStops.Add($processId) }
    Assert-Equal 'stopped' $stoppedRun.status 'exact ownership stops the stack'
    Assert-Equal '4102,4101' ($mismatchStops -join ',') 'stop uses reverse manifest order after all identities validate'
    $stoppedManifest = Read-IsolatedStackManifest -Path $stopPath
    Assert-True (-not [string]::IsNullOrWhiteSpace([string]$stoppedManifest.stopped_at)) 'successful stop atomically records stopped_at'
    Assert-True (-not $stoppedManifest.backend_ready.governance -and -not $stoppedManifest.backend_ready.coordinator) 'successful stop clears backend readiness'

    $directExecutionOutput = (& pwsh -NoProfile -NonInteractive -File $launcherPath -Action status -ChangeId '.' -RunId 'run-a' 2>&1 | Out-String)
    Assert-True ($LASTEXITCODE -ne 0) 'direct launcher execution dispatches invalid identity failure'
    Assert-True ($directExecutionOutput -match [regex]::Escape('ChangeId must be one safe path segment')) 'direct launcher execution reaches dispatcher validation'
}
finally { Remove-TestSandbox -Path $dispatcherSandbox }

Write-Host '[test-isolated-branch-stack] contract assertions passed'
