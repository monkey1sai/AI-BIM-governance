# scripts\tests\test-deploy-cfd-solver.ps1
# CFD S4：canonical deploy 的 CFD_* env 解析、fail-closed 驗證、映像 digest 釘住與 process env 套用；
# 以及重啟 conversion service 前的 CFD run guard（進行中的 run 會被 reconcile_on_start 標 failed）。
# 沿用 test-helpers.ps1 的 dot-source + 自訂 assert 風格；docker 與 run list HTTP 都以 stub scriptblock 注入，不碰真服務。
. (Join-Path $PSScriptRoot 'test-helpers.ps1')
$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
. (Join-Path $repoRoot 'scripts\lib\cfd-solver-deploy.ps1')

function New-EnvReader {
    param([hashtable] $Values)
    return { param($Name, $Default) if ($Values.ContainsKey($Name)) { $Values[$Name] } else { $Default } }.GetNewClosure()
}

# ---------------------------------------------------------------------------
# Test 1: no CFD keys -> disabled, pinned defaults, derived /cfd-artifacts origin
# ---------------------------------------------------------------------------
$resolved = Resolve-CfdDeployEnvironment -EnvValueReader (New-EnvReader @{}) -ConversionPublicArtifactsUrl 'http://192.0.2.10:49101/artifacts'
Assert-Equal 'false' $resolved.CFD_ENABLED 'CFD stays disabled without CFD_ENABLED'
Assert-Equal 'opencfd/openfoam-default:2412' $resolved.CFD_IMAGE 'default solver image'
Assert-Equal 'sha256:1ba02114b1c025c370f2e269a07677c16c9bea8d990fcd75ac8378aff9d41b50' $resolved.CFD_IMAGE_DIGEST 'default pinned digest'
Assert-Equal '4' $resolved.CFD_N_PROCS 'conservative default n_procs (Kit shares the CPU, R-A1)'
Assert-Equal '16' $resolved.CFD_MAX_DIRECTIONS 'default max directions'
Assert-Equal 'http://192.0.2.10:49101/cfd-artifacts' $resolved.CFD_PUBLIC_ARTIFACTS_URL 'derived from the /artifacts origin like the coordinator'
Assert-Equal '' $resolved.CFD_ARTIFACTS_ROOT 'no CFD_ARTIFACTS_ROOT -> service default (<artifacts root>/cfd)'
Assert-Equal '' $resolved.CFD_MAX_CELLS_PER_DIRECTION 'no CFD_MAX_CELLS_PER_DIRECTION -> job service default cap'

# ---------------------------------------------------------------------------
# Test 2: explicit values pass through; truthy spellings normalise
# ---------------------------------------------------------------------------
$resolved = Resolve-CfdDeployEnvironment -EnvValueReader (New-EnvReader @{
    CFD_ENABLED = 'Yes'; CFD_N_PROCS = ' 6 '; CFD_MAX_DIRECTIONS = '8'; CFD_PUBLIC_ARTIFACTS_URL = 'https://edge.example/cfd-artifacts'
    CFD_IMAGE_DIGEST = ''
}) -ConversionPublicArtifactsUrl 'http://ignored:49101/artifacts'
Assert-Equal 'true' $resolved.CFD_ENABLED 'yes -> true'
Assert-Equal '6' $resolved.CFD_N_PROCS 'trimmed integer'
Assert-Equal '8' $resolved.CFD_MAX_DIRECTIONS 'explicit max directions'
Assert-Equal 'https://edge.example/cfd-artifacts' $resolved.CFD_PUBLIC_ARTIFACTS_URL 'explicit public URL wins over derivation'
Assert-Equal '' $resolved.CFD_IMAGE_DIGEST 'empty digest is allowed (unpinned) but stays empty, not defaulted'
Assert-Equal '' (Get-CfdPublicArtifactsUrl -ConversionPublicArtifactsUrl '') 'no origin -> no derived URL'
Assert-Equal 'http://h:49101/cfd-artifacts' (Get-CfdPublicArtifactsUrl -ConversionPublicArtifactsUrl 'http://h:49101') 'origin without /artifacts'

# ---------------------------------------------------------------------------
# Test 3: invalid values fail closed
# ---------------------------------------------------------------------------
Assert-Throws { Resolve-CfdDeployEnvironment -EnvValueReader (New-EnvReader @{ CFD_ENABLED = 'maybe' }) } 'ambiguous CFD_ENABLED throws'
Assert-Throws { Resolve-CfdDeployEnvironment -EnvValueReader (New-EnvReader @{ CFD_N_PROCS = '0' }) } 'n_procs below 1 throws'
Assert-Throws { Resolve-CfdDeployEnvironment -EnvValueReader (New-EnvReader @{ CFD_N_PROCS = 'eight' }) } 'non-integer n_procs throws'
Assert-Throws { Resolve-CfdDeployEnvironment -EnvValueReader (New-EnvReader @{ CFD_MAX_DIRECTIONS = '17' }) } 'max directions above 16 throws'
Assert-Equal '6000000' (Resolve-CfdDeployEnvironment -EnvValueReader (New-EnvReader @{ CFD_MAX_CELLS_PER_DIRECTION = ' 6000000 ' })).CFD_MAX_CELLS_PER_DIRECTION 'explicit compute cap is trimmed and kept'
Assert-Throws { Resolve-CfdDeployEnvironment -EnvValueReader (New-EnvReader @{ CFD_MAX_CELLS_PER_DIRECTION = '99999' }) } 'compute cap below 100000 throws'
Assert-Throws { Resolve-CfdDeployEnvironment -EnvValueReader (New-EnvReader @{ CFD_MAX_CELLS_PER_DIRECTION = '8e6' }) } 'non-integer compute cap throws'
Assert-Throws { Resolve-CfdDeployEnvironment -EnvValueReader (New-EnvReader @{ CFD_IMAGE_DIGEST = 'sha256:abc' }) } 'malformed digest throws'
Assert-Throws { Resolve-CfdDeployEnvironment -EnvValueReader (New-EnvReader @{ CFD_IMAGE = 'opencfd/openfoam-default:2412 && rm -rf /' }) } 'image reference with shell metacharacters throws'
Assert-Throws { Resolve-CfdDeployEnvironment -EnvValueReader (New-EnvReader @{ CFD_ARTIFACTS_ROOT = 'relative/cfd' }) } 'relative CFD_ARTIFACTS_ROOT throws'
if ($IsWindows -or $env:OS -eq 'Windows_NT') {
    Assert-Throws { Resolve-CfdDeployEnvironment -EnvValueReader (New-EnvReader @{ CFD_ARTIFACTS_ROOT = 'C:cfd' }) } 'drive-relative CFD_ARTIFACTS_ROOT (C:cfd) throws'
    Assert-Throws { Resolve-CfdDeployEnvironment -EnvValueReader (New-EnvReader @{ CFD_ARTIFACTS_ROOT = '\bim-runtime\cfd' }) } 'root-relative CFD_ARTIFACTS_ROOT (backslash-prefixed, no drive) throws'
}
$absRoot = if ($IsWindows -or $env:OS -eq 'Windows_NT') { 'D:\bim-runtime\cfd' } else { '/srv/bim-runtime/cfd' }
Assert-Equal $absRoot (Resolve-CfdDeployEnvironment -EnvValueReader (New-EnvReader @{ CFD_ARTIFACTS_ROOT = $absRoot })).CFD_ARTIFACTS_ROOT 'absolute CFD_ARTIFACTS_ROOT passes through'

# ---------------------------------------------------------------------------
# Test 4: Set-CfdProcessEnvironment sets and clears keys
# ---------------------------------------------------------------------------
$saved = @{}
foreach ($key in @('CFD_ENABLED', 'CFD_IMAGE', 'CFD_IMAGE_DIGEST', 'CFD_N_PROCS', 'CFD_MAX_DIRECTIONS', 'CFD_MAX_CELLS_PER_DIRECTION', 'CFD_ARTIFACTS_ROOT', 'CFD_PUBLIC_ARTIFACTS_URL')) { $saved[$key] = [Environment]::GetEnvironmentVariable($key) }
try {
    [Environment]::SetEnvironmentVariable('CFD_PUBLIC_ARTIFACTS_URL', 'http://stale/cfd-artifacts')
    [Environment]::SetEnvironmentVariable('CFD_ARTIFACTS_ROOT', 'X:\stale\cfd')
    Set-CfdProcessEnvironment -CfdEnvironment ([ordered]@{ CFD_ENABLED = 'true'; CFD_IMAGE = 'img:tag'; CFD_IMAGE_DIGEST = ''; CFD_N_PROCS = '4'; CFD_MAX_DIRECTIONS = '16'; CFD_PUBLIC_ARTIFACTS_URL = '' })
    Assert-Equal 'true' ([Environment]::GetEnvironmentVariable('CFD_ENABLED')) 'CFD_ENABLED applied'
    Assert-Equal 'img:tag' ([Environment]::GetEnvironmentVariable('CFD_IMAGE')) 'CFD_IMAGE applied'
    Assert-True ([string]::IsNullOrEmpty([Environment]::GetEnvironmentVariable('CFD_IMAGE_DIGEST'))) 'empty digest removed'
    Assert-True ([string]::IsNullOrEmpty([Environment]::GetEnvironmentVariable('CFD_PUBLIC_ARTIFACTS_URL'))) 'stale public URL cleared'
    Assert-True ([string]::IsNullOrEmpty([Environment]::GetEnvironmentVariable('CFD_ARTIFACTS_ROOT'))) 'stale artifacts root cleared even when the key is absent from the map'
} finally {
    foreach ($key in $saved.Keys) { [Environment]::SetEnvironmentVariable($key, $saved[$key]) }
}

# ---------------------------------------------------------------------------
# Test 5: Ensure-CfdSolverImage — present + digest match: no pull
# ---------------------------------------------------------------------------
$digest = 'sha256:' + ('a' * 64)
$calls = New-Object System.Collections.ArrayList
$stubPresent = {
    param($ArgList)
    [void]$calls.Add(($ArgList -join ' '))
    if ($ArgList[0] -eq 'image') { return @{ ExitCode = 0; Stdout = "opencfd/openfoam-default@$digest" } }
    return @{ ExitCode = 0; Stdout = '' }
}.GetNewClosure()
$info = Ensure-CfdSolverImage -Image 'opencfd/openfoam-default:2412' -Digest $digest -DockerCommand $stubPresent
Assert-Equal $false $info.pulled 'no pull when the pinned digest is already present'
Assert-Equal $digest $info.digest_actual 'actual digest reported'
Assert-True (@($calls | Where-Object { $_ -like 'pull *' }).Count -eq 0) 'docker pull not invoked'

# ---------------------------------------------------------------------------
# Test 6: missing image -> pull by digest, tag, re-inspect
# ---------------------------------------------------------------------------
$calls = New-Object System.Collections.ArrayList
$state = @{ present = $false }
$stubMissing = {
    param($ArgList)
    [void]$calls.Add(($ArgList -join ' '))
    switch ($ArgList[0]) {
        'image' { if ($state.present) { return @{ ExitCode = 0; Stdout = "opencfd/openfoam-default@$digest" } } else { return @{ ExitCode = 1; Stdout = 'Error: No such image' } } }
        'pull'  { $state.present = $true; return @{ ExitCode = 0; Stdout = 'Status: Downloaded' } }
        default { return @{ ExitCode = 0; Stdout = '' } }
    }
}.GetNewClosure()
$info = Ensure-CfdSolverImage -Image 'opencfd/openfoam-default:2412' -Digest $digest -DockerCommand $stubMissing
Assert-Equal $true $info.pulled 'pulled when missing'
Assert-True (@($calls | Where-Object { $_ -eq "pull opencfd/openfoam-default@$digest" }).Count -eq 1) 'pull addressed by digest'
Assert-True (@($calls | Where-Object { $_ -eq "tag opencfd/openfoam-default@$digest opencfd/openfoam-default:2412" }).Count -eq 1) 'pulled digest re-tagged with the configured tag'

# ---------------------------------------------------------------------------
# Test 7: digest mismatch -> throw (never deploy an unpinned solver); pull failure -> throw
# ---------------------------------------------------------------------------
$stubWrong = { param($ArgList) if ($ArgList[0] -eq 'image') { return @{ ExitCode = 0; Stdout = ('opencfd/openfoam-default@sha256:' + ('b' * 64)) } }; return @{ ExitCode = 0; Stdout = '' } }
Assert-Throws { Ensure-CfdSolverImage -Image 'opencfd/openfoam-default:2412' -Digest $digest -DockerCommand $stubWrong } 'digest mismatch throws'
$stubPullFail = { param($ArgList) if ($ArgList[0] -eq 'image') { return @{ ExitCode = 1; Stdout = 'No such image' } }; return @{ ExitCode = 1; Stdout = 'pull access denied' } }
Assert-Throws { Ensure-CfdSolverImage -Image 'opencfd/openfoam-default:2412' -Digest $digest -DockerCommand $stubPullFail } 'pull failure throws'
# Unpinned (empty digest): present image passes, missing image pulls by tag.
$info = Ensure-CfdSolverImage -Image 'opencfd/openfoam-default:2412' -Digest '' -DockerCommand $stubWrong
Assert-Equal $false $info.pulled 'unpinned present image accepted'

# ---------------------------------------------------------------------------
# Test 8: CFD run guard — a run in progress blocks the conversion-service stop and is listed
# ---------------------------------------------------------------------------
# Stub of GET /api/cfd-runs?status=<s>&limit=500 that filters by status like the service does.
function New-CfdRunListStub {
    param([hashtable] $RunsByStatus, [System.Collections.ArrayList] $Calls)
    return {
        param($Uri)
        [void]$Calls.Add([string]$Uri)
        $status = ([regex]::Match([string]$Uri, '[?&]status=([a-z]+)')).Groups[1].Value
        $ids = if ($RunsByStatus.ContainsKey($status)) { @($RunsByStatus[$status]) } else { @() }
        $items = @($ids | ForEach-Object { [pscustomobject]@{ run_id = $_; status = $status; progress = @{ directions_done = 0 } } })
        return [pscustomobject]@{ items = $items; count = $items.Count; enabled = $true }
    }.GetNewClosure()
}
$solvingRun = 'cfd_20260923T010203Z_abc123'
$queuedRun = 'cfd_20260923T020304Z_def456'
$calls = New-Object System.Collections.ArrayList
$guard = Get-CfdRunDeployGuard -ServiceRunning $true -ServiceBaseUrl 'http://127.0.0.1:49101/' `
    -HttpGet (New-CfdRunListStub -RunsByStatus @{ solving = @($solvingRun); queued = @($queuedRun) } -Calls $calls)
Assert-Equal $true $guard.Blocked 'a solving run blocks the stop'
Assert-Equal 'active_runs' $guard.Status 'blocked because runs are in progress'
Assert-Equal 1 @($guard.ActiveRuns).Count 'exactly the in-progress run is reported active'
Assert-Equal $solvingRun $guard.ActiveRuns[0].run_id 'active run id'
Assert-Equal 'solving' $guard.ActiveRuns[0].status 'active run status'
Assert-Equal $queuedRun @($guard.QueuedRuns)[0] 'queued run reported separately (reconcile re-enqueues it)'
Assert-True ($guard.Message.Contains("$solvingRun (solving)")) 'message lists run id with status'
Assert-True ($guard.Message.Contains($queuedRun)) 'message reports the queued run'
Assert-True ($guard.Message.Contains('-AllowInterruptingCfdRuns')) 'message names the override switch'
Assert-True ($guard.Message.StartsWith('CFD run guard:')) 'stable prefix (the remote transcript is filtered on it)'
Assert-Equal 5 $calls.Count 'one list request per non-terminal status'
Assert-Equal 'http://127.0.0.1:49101/api/cfd-runs?status=queued&limit=500' $calls[0] 'loopback list route, queued first, trailing slash trimmed'
Assert-Equal 'http://127.0.0.1:49101/api/cfd-runs?status=postprocessing&limit=500' $calls[4] 'statuses queried in pipeline order'

foreach ($inProgress in @('preprocessing', 'meshing', 'solving', 'postprocessing')) {
    $guard = Get-CfdRunDeployGuard -ServiceRunning $true -ServiceBaseUrl 'http://127.0.0.1:49101' `
        -HttpGet (New-CfdRunListStub -RunsByStatus @{ $inProgress = @('cfd_20260923T030405Z_aaa111') } -Calls (New-Object System.Collections.ArrayList))
    Assert-Equal $true $guard.Blocked "$inProgress run blocks the stop (reconcile_on_start fails it)"
}

# Only queued runs: they survive the restart, so the stop may proceed.
$guard = Get-CfdRunDeployGuard -ServiceRunning $true -ServiceBaseUrl 'http://127.0.0.1:49101' `
    -HttpGet (New-CfdRunListStub -RunsByStatus @{ queued = @($queuedRun) } -Calls (New-Object System.Collections.ArrayList))
Assert-Equal $false $guard.Blocked 'queued-only does not block'
Assert-Equal 'clear' $guard.Status 'nothing in progress'
Assert-True ($guard.Message.Contains($queuedRun)) 'queued run still reported'

# A run that advances between two requests (seen queued, then preprocessing) counts as in progress.
$guard = Get-CfdRunDeployGuard -ServiceRunning $true -ServiceBaseUrl 'http://127.0.0.1:49101' `
    -HttpGet (New-CfdRunListStub -RunsByStatus @{ queued = @($queuedRun); preprocessing = @($queuedRun) } -Calls (New-Object System.Collections.ArrayList))
Assert-Equal $true $guard.Blocked 'advancing run is caught by the later request'
Assert-Equal 0 @($guard.QueuedRuns).Count 'last observed status wins'

# ---------------------------------------------------------------------------
# Test 9: CFD run guard — override proceeds but still records the interrupted runs
# ---------------------------------------------------------------------------
$guard = Get-CfdRunDeployGuard -ServiceRunning $true -ServiceBaseUrl 'http://127.0.0.1:49101' -AllowInterruptingCfdRuns `
    -HttpGet (New-CfdRunListStub -RunsByStatus @{ solving = @($solvingRun) } -Calls (New-Object System.Collections.ArrayList))
Assert-Equal $false $guard.Blocked 'override lets the deploy proceed'
Assert-Equal 'active_runs' $guard.Status 'the interruption is still reported as such'
Assert-True ($guard.Message.Contains("$solvingRun (solving)")) 'interrupted run ids stay in the log line'

# ---------------------------------------------------------------------------
# Test 10: CFD run guard — service not running: proceed without any request
# ---------------------------------------------------------------------------
$calls = New-Object System.Collections.ArrayList
$guard = Get-CfdRunDeployGuard -ServiceRunning $false -ServiceBaseUrl 'http://127.0.0.1:49101' `
    -HttpGet (New-CfdRunListStub -RunsByStatus @{ solving = @($solvingRun) } -Calls $calls)
Assert-Equal $false $guard.Blocked 'no running service -> nothing to interrupt'
Assert-Equal 'not_running' $guard.Status 'reason recorded'
Assert-Equal 0 $calls.Count 'no request when the service is not running'

# ---------------------------------------------------------------------------
# Test 11: CFD run guard — a running service whose run list cannot be read fails closed
# ---------------------------------------------------------------------------
$guard = Get-CfdRunDeployGuard -ServiceRunning $true -ServiceBaseUrl 'http://127.0.0.1:49101' -HttpGet { param($Uri) throw "Connection refused`n(127.0.0.1:49101)" }
Assert-Equal $true $guard.Blocked 'query error blocks'
Assert-Equal 'query_failed' $guard.Status 'reason recorded'
Assert-True ($guard.Message.Contains('GET http://127.0.0.1:49101/api/cfd-runs?status=queued&limit=500 failed: Connection refused (127.0.0.1:49101)')) 'message names the request and the error on one line'
$failOnSolving = { param($Uri) if ([string]$Uri -match 'status=solving') { throw 'timeout' }; [pscustomobject]@{ items = @(); count = 0; enabled = $true } }
Assert-Equal $true (Get-CfdRunDeployGuard -ServiceRunning $true -ServiceBaseUrl 'http://127.0.0.1:49101' -HttpGet $failOnSolving).Blocked 'a failure after earlier statuses succeeded still blocks'
foreach ($malformed in @(
    @{ Name = 'HTML body'; Stub = { param($Uri) '<html>502 Bad Gateway</html>' } },
    @{ Name = 'empty body'; Stub = { param($Uri) $null } },
    @{ Name = 'null items'; Stub = { param($Uri) [pscustomobject]@{ items = $null; count = 0 } } },
    @{ Name = 'run without run_id'; Stub = { param($Uri) [pscustomobject]@{ items = @([pscustomobject]@{ status = 'solving' }); count = 1 } } },
    @{ Name = 'null run entry'; Stub = { param($Uri) [pscustomobject]@{ items = @($null); count = 1 } } }
)) {
    $guard = Get-CfdRunDeployGuard -ServiceRunning $true -ServiceBaseUrl 'http://127.0.0.1:49101' -HttpGet $malformed.Stub
    Assert-Equal $true $guard.Blocked "malformed run list ($($malformed.Name)) blocks"
    Assert-Equal 'query_failed' $guard.Status "malformed run list ($($malformed.Name)) is a query failure"
}
$guard = Get-CfdRunDeployGuard -ServiceRunning $true -ServiceBaseUrl 'http://127.0.0.1:49101' -AllowInterruptingCfdRuns -HttpGet { param($Uri) throw 'Connection refused' }
Assert-Equal $false $guard.Blocked 'override also covers an unreadable run list'
Assert-Equal 'query_failed' $guard.Status 'and still records why'

# ---------------------------------------------------------------------------
# Test 12: deploy.ps1 wiring — every conversion-service stop goes through the guard
# ---------------------------------------------------------------------------
$deploySource = Get-Content -LiteralPath (Join-Path $repoRoot 'scripts\deploy.ps1') -Raw
Assert-True ($deploySource -match '\[switch\]\s+\$AllowInterruptingCfdRuns') 'deploy.ps1 declares -AllowInterruptingCfdRuns'
Assert-Equal 1 ([regex]::Matches($deploySource, "Stop-HostNativeService -Name 'bim-streaming-conversion-service'")).Count 'the only conversion-service stop is inside the guarded helper'
Assert-Equal 3 ([regex]::Matches($deploySource, '(?m)^\s+Stop-DeployConversionService\s*$')).Count 'all three Phase 4b restart paths stop through the guarded helper'

Write-Host '[test-deploy-cfd-solver] passed'
