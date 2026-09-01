. (Join-Path $PSScriptRoot 'test-helpers.ps1')

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$launcherPath = Join-Path $repoRoot 'scripts\dev\start-isolated-branch-stack.ps1'
. $launcherPath

function New-Ac24Effects {
    [ordered]@{
       safe_environment = 0
       browser_descriptor = 0
        hostile_getter = 0
       runtime = 0
        cleanup = 0
        process_mutation = 0
        acl_mutation = 0
        worktree_status = 0
        worktree_mutation = 0
        sandbox_mutation = 0
        listener_query = 0
        health_probe = 0
        reservation_acquire = 0
        reservation_release = 0
    }
}

function Assert-Ac24NoPreflightEffects {
    param($Effects, [string] $Context)
    foreach ($effectName in @(
        'runtime', 'cleanup', 'process_mutation', 'acl_mutation',
        'worktree_mutation', 'sandbox_mutation', 'listener_query',
        'health_probe', 'reservation_acquire', 'reservation_release'
    )) {
        Assert-Equal 0 $Effects[$effectName] "$Context has no side effect: $effectName"
    }
}

function Get-Ac24ThrownMessage {
    param([scriptblock] $Operation)
    try {
        & $Operation
        return $null
    } catch {
        return $_.Exception.Message
    }
}

function Invoke-Ac24Start {
    param(
       [scriptblock] $SafeEnvironmentContract,
       [scriptblock] $BrowserSpecFn,
       [scriptblock] $RuntimeResolver,
        $Effects,
        $Order=$null
   )
   $worktreeStatus = ({ param($root) $Effects.worktree_status++; @() }).GetNewClosure()
   $reservationAcquire = ({
       param($root,$change,$run,$offset)
       $Effects.reservation_acquire++
        if ($null -ne $Order) { [void]$Order.Add('reservation') }
       [pscustomobject]@{ reservation_id = '00000000-0000-0000-0000-000000000001'; paths = @() }
   }).GetNewClosure()
   $reservationRelease = ({ param($reservation) $Effects.reservation_release++ }).GetNewClosure()
   $preflight = ({
       param($root,$change,$run,$offset)
       $Effects.listener_query++
        if ($null -ne $Order) { [void]$Order.Add('preflight') }
       [pscustomobject]@{
            offset = 0
            ports = [pscustomobject]@{ coordinator = 8005; governance = 49103; viewer = 5180 }
            manifest_path = (Join-Path $root 'artifacts\e2e\change-ac24\run-ac24\stack-manifest.json')
        }
    }).GetNewClosure()
    Invoke-IsolatedBranchStack -Action start -ChangeId 'change-ac24' -RunId 'run-ac24' -OffsetInput '0' -RepoRoot $repoRoot `
        -SafeEnvironmentContract $SafeEnvironmentContract -BrowserSpecFn $BrowserSpecFn -RuntimeResolver $RuntimeResolver `
        -WorktreeStatusFn $worktreeStatus -ReservationAcquireFn $reservationAcquire -ReservationReleaseFn $reservationRelease `
       -PreflightFn $preflight
}

$parameterNames = @((Get-Command Invoke-IsolatedBranchStack).Parameters.Keys)
$lifecycleIndex = [array]::IndexOf($parameterNames, 'LifecycleLogger')
$safeEnvironmentIndex = [array]::IndexOf($parameterNames, 'SafeEnvironmentContract')
$browserSpecIndex = [array]::IndexOf($parameterNames, 'BrowserSpecFn')
Assert-True ($lifecycleIndex -ge 0 -and $safeEnvironmentIndex -gt $lifecycleIndex -and $browserSpecIndex -gt $safeEnvironmentIndex) `
    'new optional preflight parameters preserve every prior positional parameter'

$effects = New-Ac24Effects

# Invalid offsets and reserved ports must fail before any injected side-effect port
# is reached.  Nothing here starts a process, queries the host, or touches a real
# worktree; the callbacks are counter-only fakes.
Assert-Throws {
    Invoke-IsolatedBranchStack -Action start -ChangeId 'change-ac24' -RunId 'run-invalid-offset' -OffsetInput '5' -RepoRoot $repoRoot `
        -SafeEnvironmentContract ({ $effects.safe_environment++; $true }) `
        -BrowserSpecFn ({ $effects.browser_descriptor++; [pscustomobject]@{} }) `
        -WorktreeStatusFn { param($root) $effects.worktree_status++; @() } `
        -ReservationAcquireFn { param($root,$change,$run,$offset) $effects.reservation_acquire++; throw 'reservation must not be reached' } `
        -PreflightFn { param($root,$change,$run,$offset) $effects.listener_query++; throw 'listener preflight must not be reached' } `
        -RuntimeResolver { param($root) $effects.runtime++; throw 'runtime must not be reached' }
} 'invalid offset is rejected'
Assert-Equal 0 $effects.reservation_acquire 'invalid offset does not acquire a reservation'
Assert-Equal 0 $effects.listener_query 'invalid offset does not query listeners'
Assert-Equal 0 $effects.runtime 'invalid offset does not resolve a runtime'
Assert-Equal 0 $effects.safe_environment 'invalid offset does not evaluate the safe environment contract'
Assert-Equal 0 $effects.browser_descriptor 'invalid offset does not produce a browser descriptor'

$effects = New-Ac24Effects
$missingSafeMessage = Get-Ac24ThrownMessage {
    Invoke-IsolatedBranchStack -Action start -ChangeId 'change-ac24' -RunId 'run-missing-safe-authority' -OffsetInput '0' -RepoRoot $repoRoot `
        -WorktreeStatusFn { param($root) $effects.worktree_status++; @() } `
        -ReservationAcquireFn { param($root,$change,$run,$offset) $effects.reservation_acquire++; throw 'reservation must not be reached' }
}
Assert-Equal 'Safe environment contract authority is required for start.' $missingSafeMessage 'missing safe-environment authority fails closed'
Assert-Equal 0 $effects.worktree_status 'missing safe-environment authority stops before worktree inspection'
Assert-Ac24NoPreflightEffects -Effects $effects -Context 'missing safe-environment authority'

$effects = New-Ac24Effects
$missingBrowserMessage = Get-Ac24ThrownMessage {
    Invoke-IsolatedBranchStack -Action start -ChangeId 'change-ac24' -RunId 'run-missing-browser-authority' -OffsetInput '0' -RepoRoot $repoRoot `
        -SafeEnvironmentContract { param($root,$change,$run,$offset,$ports) $effects.safe_environment++; $true } `
        -WorktreeStatusFn { param($root) $effects.worktree_status++; @() } `
        -ReservationAcquireFn { param($root,$change,$run,$offset) $effects.reservation_acquire++; throw 'reservation must not be reached' }
}
Assert-Equal 'Browser specification authority is required for start.' $missingBrowserMessage 'missing browser authority fails closed'
Assert-Equal 0 $effects.safe_environment 'missing browser authority stops before evaluating the remaining authority'
Assert-Equal 0 $effects.worktree_status 'missing browser authority stops before worktree inspection'
Assert-Ac24NoPreflightEffects -Effects $effects -Context 'missing browser authority'

$cliSandbox = New-TestSandbox -Prefix 'parallel-delivery-fabric-ac24-cli'
try {
    $cliMessage = Get-Ac24ThrownMessage {
        Invoke-IsolatedBranchStackCli -Action start -ChangeId 'change-ac24' -RunId 'run-cli-missing-authority' -OffsetInput '0' -RepoRoot $cliSandbox
    }
    Assert-Equal 'Safe environment contract authority is required for start.' $cliMessage 'actual CLI start fails closed without runtime-preflight authority'
    $cliManifestPath = Resolve-IsolatedStackManifestPath -RepoRoot $cliSandbox -ChangeId 'change-ac24' -RunId 'run-cli-missing-authority'
    Assert-True (-not (Test-Path -LiteralPath $cliManifestPath)) 'authority-held CLI start writes no success manifest'
} finally {
    Remove-TestSandbox -Path $cliSandbox
}

foreach ($reservedPort in $script:IsolatedStackPolicy.reserved) {
    Assert-Throws {
        Assert-IsolatedPortSetDisjoint -Ports ([pscustomobject]@{ coordinator = $reservedPort; governance = 49103; viewer = 5180 })
    } "reserved port $reservedPort is rejected"
}

$sandbox = New-TestSandbox -Prefix 'parallel-delivery-fabric-ac24'
try {
    $manifestPath = Resolve-IsolatedStackManifestPath -RepoRoot $sandbox -ChangeId 'change-ac24' -RunId 'run-manifest-mismatch'
    $manifest = [ordered]@{
        schema_version = 'isolated-branch-stack/v1'
        stack_kind = 'isolated_branch_stack'
        change_id = 'change-ac24'
        run_id = 'run-manifest-mismatch'
        worktree_root = $sandbox
        offset = 0
        ports = [ordered]@{ coordinator = 8005; governance = 49103; viewer = 5180 }
        # This is deliberately a reserved deployment URL, not the frozen offset-0 URL.
        base_urls = [ordered]@{ coordinator = 'http://127.0.0.1:8004'; governance = 'http://127.0.0.1:49103'; viewer = 'http://127.0.0.1:5180' }
        lifecycle_owners = [ordered]@{ governance = 'repo_launcher'; coordinator = 'repo_launcher'; viewer = 'playwright_webserver' }
        viewer = [ordered]@{ expected_port = 5180; owner = 'playwright_webserver'; managed_by_launcher = $false }
        backend_ready = [ordered]@{ governance = $true; coordinator = $true }
        stopped_at = $null
        processes = @(
            [pscustomobject]@{ role = 'governance'; pid = 8101; entrypoint = (Join-Path $sandbox 'governance-service'); command_line = "python -m uvicorn --app-dir $(Join-Path $sandbox 'governance-service') app:app --host 127.0.0.1 --port 49103"; creation_identity = 'fixture-governance' },
            [pscustomobject]@{ role = 'coordinator'; pid = 8102; entrypoint = (Join-Path $sandbox 'bim-review-coordinator\src\index.ts'); command_line = "node tsx.mjs $(Join-Path $sandbox 'bim-review-coordinator\src\index.ts') --isolated-stack-port 8005"; creation_identity = 'fixture-coordinator' }
        )
    }
    Write-IsolatedJsonAtomic -Path $manifestPath -Value $manifest -NoClobber

    Assert-Throws {
        Invoke-IsolatedBranchStack -Action status -ChangeId 'change-ac24' -RunId 'run-manifest-mismatch' -OffsetInput '0' -RepoRoot $sandbox `
            -IdentityLookup { param($expected) throw 'identity lookup must not be reached' } `
            -StopListenerLookupFn { param($port) $effects.listener_query++; throw 'listener query must not be reached' } `
            -HealthFn { param($url) $effects.health_probe++; throw 'health probe must not be reached' }
    } 'manifest/base URL mismatch is held before listener or health query'
    Assert-Equal 0 $effects.listener_query 'base URL mismatch performs no listener query'
    Assert-Equal 0 $effects.health_probe 'base URL mismatch performs no health probe'
} finally {
    Remove-TestSandbox -Path $sandbox
}

foreach ($safeCase in @(
    [pscustomobject]@{ name = 'null'; result = { $null } },
    [pscustomobject]@{ name = 'false'; result = { $false } },
    [pscustomobject]@{ name = 'invalid'; result = { 'unsafe-value' } },
    [pscustomobject]@{ name = 'throw'; result = { throw 'safe environment mismatch' } }
)) {
    $effects = New-Ac24Effects
    $result = $safeCase.result
    $safeContract = ({
        param($root,$change,$run,$offset,$ports)
        $effects.safe_environment++
        & $result
    }).GetNewClosure()
    $message = Get-Ac24ThrownMessage {
        Invoke-Ac24Start -SafeEnvironmentContract $safeContract `
            -BrowserSpecFn ({ $effects.browser_descriptor++; throw 'browser descriptor must not be reached' }) `
            -RuntimeResolver ({ param($root) $effects.runtime++; throw 'runtime must not be reached' }) `
            -Effects $effects
    }
    Assert-True ($message -match 'Safe environment contract rejected') "safe environment $($safeCase.name) fails closed"
    Assert-Equal 1 $effects.safe_environment "safe environment $($safeCase.name) is evaluated once"
    Assert-Equal 0 $effects.browser_descriptor "safe environment $($safeCase.name) stops before browser descriptor"
    Assert-Ac24NoPreflightEffects -Effects $effects -Context "safe environment $($safeCase.name)"
}

foreach ($browserCase in @(
   [pscustomobject]@{ name = 'null'; result = { $null } },
   [pscustomobject]@{ name = 'false'; result = { $false } },
   [pscustomobject]@{ name = 'invalid'; result = { 'not-a-browser-spec' } },
    [pscustomobject]@{ name = 'ordered dictionary'; result = { [ordered]@{ schema_version='isolated-browser-spec/v1'; base_url='http://127.0.0.1:5180'; expected_port=5180 } } },
    [pscustomobject]@{ name = 'extra key'; result = { @{ schema_version='isolated-browser-spec/v1'; base_url='http://127.0.0.1:5180'; expected_port=5180; extra='rejected' } } },
    [pscustomobject]@{ name = 'string port'; result = { @{ schema_version='isolated-browser-spec/v1'; base_url='http://127.0.0.1:5180'; expected_port='5180' } } },
   [pscustomobject]@{ name = 'throw'; result = { throw 'browser spec mismatch' } }
)) {
    $effects = New-Ac24Effects
    $result = $browserCase.result
    $browserSpec = ({
        param($root,$change,$run,$offset,$ports)
        $effects.browser_descriptor++
        & $result
    }).GetNewClosure()
    $message = Get-Ac24ThrownMessage {
        Invoke-Ac24Start `
            -SafeEnvironmentContract ({ param($root,$change,$run,$offset,$ports) $effects.safe_environment++; $true }) `
            -BrowserSpecFn $browserSpec `
            -RuntimeResolver ({ param($root) $effects.runtime++; throw 'runtime must not be reached' }) `
            -Effects $effects
    }
    Assert-Equal 'Browser specification rejected.' $message "browser descriptor $($browserCase.name) fails closed"
    Assert-Equal 1 $effects.safe_environment "browser descriptor $($browserCase.name) follows safe environment validation"
    Assert-Equal 1 $effects.browser_descriptor "browser descriptor $($browserCase.name) is evaluated once"
    Assert-Ac24NoPreflightEffects -Effects $effects -Context "browser descriptor $($browserCase.name)"
}

$hostileEffects = New-Ac24Effects
$hostileBrowserSpec = [pscustomobject]@{}
$hostileGetter = ({ $hostileEffects.hostile_getter++; throw 'hostile getter executed' }).GetNewClosure()
$hostileBrowserSpec | Add-Member -MemberType ScriptProperty -Name schema_version -Value $hostileGetter
$hostileBrowserFn = ({
    param($root,$change,$run,$offset,$ports)
    $hostileEffects.browser_descriptor++
    $hostileBrowserSpec
}).GetNewClosure()
$hostileMessage = Get-Ac24ThrownMessage {
    Invoke-Ac24Start `
        -SafeEnvironmentContract ({ param($root,$change,$run,$offset,$ports) $hostileEffects.safe_environment++; $true }) `
        -BrowserSpecFn $hostileBrowserFn `
        -RuntimeResolver ({ param($root) $hostileEffects.runtime++; throw 'runtime must not be reached' }) `
        -Effects $hostileEffects
}
Assert-Equal 'Browser specification rejected.' $hostileMessage 'hostile descriptor is rejected with the generic terminal failure'
Assert-Equal 0 $hostileEffects.hostile_getter 'hostile descriptor getters are never evaluated'
Assert-Equal 1 $hostileEffects.safe_environment 'hostile descriptor follows safe environment validation'
Assert-Equal 1 $hostileEffects.browser_descriptor 'hostile descriptor is delivered once to the preflight gate'
Assert-Ac24NoPreflightEffects -Effects $hostileEffects -Context 'hostile browser descriptor'

$hostileMethodEffects = New-Ac24Effects
$hostileMethodDescriptor = [pscustomobject]@{}
$hostileDescriptorGetType = ({ $hostileMethodEffects.hostile_getter++; throw 'hostile descriptor GetType executed' }).GetNewClosure()
$hostileMethodDescriptor | Add-Member -MemberType ScriptMethod -Name GetType -Value $hostileDescriptorGetType -Force
$hostileMethodBrowserFn = ({
    param($root,$change,$run,$offset,$ports)
    $hostileMethodEffects.browser_descriptor++
    $hostileMethodDescriptor
}).GetNewClosure()
$hostileMethodMessage = Get-Ac24ThrownMessage {
    Invoke-Ac24Start `
        -SafeEnvironmentContract ({ param($root,$change,$run,$offset,$ports) $hostileMethodEffects.safe_environment++; $true }) `
        -BrowserSpecFn $hostileMethodBrowserFn `
        -RuntimeResolver ({ param($root) $hostileMethodEffects.runtime++; throw 'runtime must not be reached' }) `
        -Effects $hostileMethodEffects
}
Assert-Equal 'Browser specification rejected.' $hostileMethodMessage 'hostile descriptor GetType is rejected with the generic terminal failure'
Assert-Equal 0 $hostileMethodEffects.hostile_getter 'hostile descriptor GetType is never invoked'
Assert-Equal 1 $hostileMethodEffects.safe_environment 'hostile descriptor GetType follows safe environment validation'
Assert-Equal 1 $hostileMethodEffects.browser_descriptor 'hostile descriptor GetType is delivered once to the preflight gate'
Assert-Ac24NoPreflightEffects -Effects $hostileMethodEffects -Context 'hostile descriptor GetType'

$hostileValueEffects = New-Ac24Effects
$hostileExpectedPort = [System.Management.Automation.PSObject]::AsPSObject('5180')
$hostileValueGetType = ({ $hostileValueEffects.hostile_getter++; throw 'hostile expected_port GetType executed' }).GetNewClosure()
$hostileExpectedPort | Add-Member -MemberType ScriptMethod -Name GetType -Value $hostileValueGetType -Force
$hostileValueBrowserFn = ({
    param($root,$change,$run,$offset,$ports)
    $hostileValueEffects.browser_descriptor++
    @{
        schema_version = 'isolated-browser-spec/v1'
        base_url = 'http://127.0.0.1:5180'
        expected_port = $hostileExpectedPort
    }
}).GetNewClosure()
$hostileValueMessage = Get-Ac24ThrownMessage {
    Invoke-Ac24Start `
        -SafeEnvironmentContract ({ param($root,$change,$run,$offset,$ports) $hostileValueEffects.safe_environment++; $true }) `
        -BrowserSpecFn $hostileValueBrowserFn `
        -RuntimeResolver ({ param($root) $hostileValueEffects.runtime++; throw 'runtime must not be reached' }) `
        -Effects $hostileValueEffects
}
Assert-Equal 'Browser specification rejected.' $hostileValueMessage 'hostile expected_port is rejected with the generic terminal failure'
Assert-Equal 0 $hostileValueEffects.hostile_getter 'hostile expected_port GetType is never invoked'
Assert-Equal 1 $hostileValueEffects.safe_environment 'hostile expected_port follows safe environment validation'
Assert-Equal 1 $hostileValueEffects.browser_descriptor 'hostile expected_port is delivered once to the preflight gate'
Assert-Ac24NoPreflightEffects -Effects $hostileValueEffects -Context 'hostile expected_port GetType'

$effects = New-Ac24Effects
$order = [System.Collections.Generic.List[string]]::new()
$runtime = ({
    param($root)
    $effects.runtime++
    [void]$order.Add('runtime')
    throw 'runtime fake stop'
}).GetNewClosure()
$message = Get-Ac24ThrownMessage {
    Invoke-Ac24Start `
        -SafeEnvironmentContract ({
            param($root,$change,$run,$offset,$ports)
            $effects.safe_environment++
            [void]$order.Add('safe')
            $true
        }) `
        -BrowserSpecFn ({
            param($root,$change,$run,$offset,$ports)
           $effects.browser_descriptor++
           [void]$order.Add('browser')
            @{
               schema_version = 'isolated-browser-spec/v1'
               base_url = 'http://127.0.0.1:5180'
               expected_port = 5180
            }
       }) `
       -RuntimeResolver $runtime `
        -Effects $effects -Order $order
}
Assert-Equal 'runtime fake stop' $message 'accepted pure browser descriptor reaches the injected runtime stop'
Assert-Equal 'safe,browser,reservation,preflight,runtime' ($order -join ',') 'safe environment and browser descriptor precede reservation, preflight, and runtime resolution'
Assert-Equal 1 $effects.reservation_acquire 'accepted path acquires its fake reservation'
Assert-Equal 1 $effects.reservation_release 'accepted path releases its fake reservation'
Assert-Equal 1 $effects.listener_query 'accepted path invokes only its injected preflight callback'
Assert-Equal 0 $effects.health_probe 'accepted path does not probe health before runtime resolution'
Assert-Equal 0 $effects.cleanup 'accepted path performs no cleanup'
Assert-Equal 0 $effects.process_mutation 'accepted path performs no process mutation'
Assert-Equal 0 $effects.acl_mutation 'accepted path performs no ACL mutation'
Assert-Equal 0 $effects.worktree_mutation 'accepted path performs no worktree mutation'
Assert-Equal 0 $effects.sandbox_mutation 'accepted path performs no sandbox mutation'

Write-Host '[PASS] isolated launcher preflight holds before side effects'
