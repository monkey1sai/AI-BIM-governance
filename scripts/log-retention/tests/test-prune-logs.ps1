[CmdletBinding()]
param()

# scripts/log-retention/tests/test-prune-logs.ps1
# Verifies prune-logs.ps1 boundary behaviour with fixed today / fixed fixture.

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$pruneScript = (Resolve-Path (Join-Path $PSScriptRoot '..\prune-logs.ps1')).Path

function Assert-True {
    param([Parameter(Mandatory = $true)][bool] $Condition, [Parameter(Mandatory = $true)][string] $Message)
    if (-not $Condition) { throw "ASSERT FAILED: $Message" }
}

function Assert-Equal {
    param([Parameter(Mandatory = $true)] $Expected, [Parameter(Mandatory = $true)] $Actual, [Parameter(Mandatory = $true)][string] $Message)
    if ($Expected -cne $Actual) {
        throw "ASSERT FAILED: $Message  (expected '$Expected' got '$Actual')"
    }
}

function New-Fixture {
    [CmdletBinding()]
    param([datetime] $Today)
    $root = (New-Item -ItemType Directory -Force -Path (Join-Path ([IO.Path]::GetTempPath()) ("prune-fixture-" + [Guid]::NewGuid().ToString('N')))).FullName
    foreach ($service in 'coordinator', 'streaming-server', 'viewer', 'scripts') {
        $serviceDir = Join-Path $root $service
        New-Item -ItemType Directory -Force -Path $serviceDir | Out-Null
        foreach ($age in 5, 15, 30, 31, 45, 60) {
            $date = $Today.AddDays(-1 * $age).ToString('yyyy-MM-dd')
            $dateDir = Join-Path $serviceDir $date
            New-Item -ItemType Directory -Force -Path $dateDir | Out-Null
            Set-Content -LiteralPath (Join-Path $dateDir "$service-run_demo.jsonl") -Value '{"ts":"x"}' -Encoding UTF8
        }
        # Always-present helper directories that should be skipped.
        New-Item -ItemType Directory -Force -Path (Join-Path $serviceDir '_recovery') | Out-Null
        New-Item -ItemType Directory -Force -Path (Join-Path $serviceDir 'not-a-date') | Out-Null
    }
    return $root
}

$tests = 0
$failures = 0

function Run-Test {
    param([string] $Name, [scriptblock] $Body)
    $script:tests += 1
    try {
        & $Body
        Write-Host ("  PASS  " + $Name)
    } catch {
        $script:failures += 1
        Write-Host ("  FAIL  " + $Name + "`n         " + $_.Exception.Message) -ForegroundColor Red
    }
}

$frozenToday = [datetime]::Parse('2026-05-26T00:00:00Z').ToUniversalTime().Date

Run-Test 'dry-run lists deletions for >30d (31/45/60) and keeps 5/15/30' {
    $root = New-Fixture -Today $frozenToday
    try {
        $result = & $pruneScript -LogRoot $root -RetentionDays 30 -TodayUtc $frozenToday -Quiet
        # Expect 3 dates × 4 services = 12 candidates
        Assert-Equal -Expected 12 -Actual $result.candidate_count -Message "candidate count"
        Assert-Equal -Expected 0 -Actual $result.deleted_count -Message "dry-run deletes nothing"
        foreach ($service in 'coordinator', 'streaming-server', 'viewer', 'scripts') {
            foreach ($age in 5, 15, 30, 31, 45, 60) {
                $date = $frozenToday.AddDays(-1 * $age).ToString('yyyy-MM-dd')
                Assert-True -Condition (Test-Path -LiteralPath (Join-Path $root (Join-Path $service $date))) `
                    -Message "dry-run preserved $service/$date"
            }
        }
    } finally { Remove-Item -LiteralPath $root -Recurse -Force }
}

Run-Test 'Apply and DryRun are mutually exclusive and never delete' {
    $root = New-Fixture -Today $frozenToday
    try {
        $threw = $false
        try {
            & $pruneScript -LogRoot $root -RetentionDays 30 -TodayUtc $frozenToday -Apply -DryRun -Quiet | Out-Null
        } catch {
            $threw = $true
            Assert-True -Condition ($_.Exception.Message -match 'mutually exclusive') -Message 'conflict error explains mutually exclusive modes'
        }
        Assert-True -Condition $threw -Message 'conflicting Apply and DryRun switches throw'
        foreach ($service in 'coordinator', 'streaming-server', 'viewer', 'scripts') {
            foreach ($age in 31, 45, 60) {
                $date = $frozenToday.AddDays(-1 * $age).ToString('yyyy-MM-dd')
                Assert-True -Condition (Test-Path -LiteralPath (Join-Path $root (Join-Path $service $date))) `
                    -Message "conflicting switches preserved $service/$date"
            }
        }
    } finally { Remove-Item -LiteralPath $root -Recurse -Force }
}

Run-Test 'apply deletes >30d (31/45/60), keeps 5/15/30, never touches recovery or non-date' {
    $root = New-Fixture -Today $frozenToday
    try {
        $result = & $pruneScript -LogRoot $root -RetentionDays 30 -TodayUtc $frozenToday -Apply -Quiet
        Assert-Equal -Expected 12 -Actual $result.deleted_count -Message "deleted count"
        Assert-True -Condition $result.applied -Message "applied flag"
        foreach ($service in 'coordinator', 'streaming-server', 'viewer', 'scripts') {
            # Boundary: 30-day dir is kept (strictly older-than required to delete)
            foreach ($age in 5, 15, 30) {
                $date = $frozenToday.AddDays(-1 * $age).ToString('yyyy-MM-dd')
                Assert-True -Condition (Test-Path -LiteralPath (Join-Path $root (Join-Path $service $date))) `
                    -Message "kept $service/$date"
            }
            foreach ($age in 31, 45, 60) {
                $date = $frozenToday.AddDays(-1 * $age).ToString('yyyy-MM-dd')
                Assert-True -Condition (-not (Test-Path -LiteralPath (Join-Path $root (Join-Path $service $date)))) `
                    -Message "deleted $service/$date"
            }
            # logs/<service>/ itself stays. _recovery + non-date helper also stay.
            Assert-True -Condition (Test-Path -LiteralPath (Join-Path $root $service)) `
                -Message "service dir kept: $service"
            Assert-True -Condition (Test-Path -LiteralPath (Join-Path $root (Join-Path $service '_recovery'))) `
                -Message "recovery dir kept: $service"
            Assert-True -Condition (Test-Path -LiteralPath (Join-Path $root (Join-Path $service 'not-a-date'))) `
                -Message "non-date dir kept: $service"
        }
        # logs/ itself stays.
        Assert-True -Condition (Test-Path -LiteralPath $root) -Message "log root preserved"
    } finally { Remove-Item -LiteralPath $root -Recurse -Force }
}

Run-Test 'custom RetentionDays=14 deletes more aggressively' {
    $root = New-Fixture -Today $frozenToday
    try {
        $result = & $pruneScript -LogRoot $root -RetentionDays 14 -TodayUtc $frozenToday -Apply -Quiet
        # Ages 15, 30, 31, 45, 60 are >14 days → 5 dates × 4 services = 20 candidates
        Assert-Equal -Expected 20 -Actual $result.deleted_count -Message "deleted with 14d cutoff"
    } finally { Remove-Item -LiteralPath $root -Recurse -Force }
}

Run-Test 'missing log root returns zero counts without throwing' {
    $bogus = (Join-Path ([IO.Path]::GetTempPath()) ("missing-" + [Guid]::NewGuid().ToString('N')))
    $result = & $pruneScript -LogRoot $bogus -RetentionDays 30 -TodayUtc $frozenToday -Apply -Quiet
    Assert-Equal -Expected 0 -Actual $result.candidate_count -Message "no candidates"
    Assert-Equal -Expected 0 -Actual $result.deleted_count -Message "no deletes"
}

Run-Test 'missing default log root returns zero counts without Resolve-Path failure' {
    $fixtureRepo = Join-Path ([IO.Path]::GetTempPath()) ("prune-default-root-" + [Guid]::NewGuid().ToString('N'))
    $fixtureScriptDir = Join-Path $fixtureRepo 'scripts\log-retention'
    New-Item -ItemType Directory -Force -Path $fixtureScriptDir | Out-Null
    Copy-Item -LiteralPath $pruneScript -Destination (Join-Path $fixtureScriptDir 'prune-logs.ps1')
    $previousLogRoot = $env:LOG_ROOT
    try {
        Remove-Item Env:\LOG_ROOT -ErrorAction SilentlyContinue
        $result = & (Join-Path $fixtureScriptDir 'prune-logs.ps1') -RetentionDays 30 -TodayUtc $frozenToday -Quiet
        Assert-Equal -Expected 0 -Actual $result.candidate_count -Message 'missing default root has no candidates'
        Assert-Equal -Expected 0 -Actual $result.deleted_count -Message 'missing default root has no deletes'
        Assert-Equal -Expected $false -Actual $result.applied -Message 'missing default root reports no apply'
    } finally {
        if ($null -ne $previousLogRoot) { $env:LOG_ROOT = $previousLogRoot } else { Remove-Item Env:\LOG_ROOT -ErrorAction SilentlyContinue }
        Remove-Item -LiteralPath $fixtureRepo -Recurse -Force
    }
}

Run-Test 'LOG_RETENTION_DAYS env supplies the default' {
    $root = New-Fixture -Today $frozenToday
    try {
        $previous = $env:LOG_RETENTION_DAYS
        $env:LOG_RETENTION_DAYS = '14'
        try {
            $result = & $pruneScript -LogRoot $root -TodayUtc $frozenToday -Apply -Quiet
            Assert-Equal -Expected 14 -Actual $result.retention_days -Message "retention from env"
            Assert-Equal -Expected 20 -Actual $result.deleted_count -Message "matches 14d behaviour"
        } finally {
            if ($null -ne $previous) { $env:LOG_RETENTION_DAYS = $previous } else { Remove-Item Env:\LOG_RETENTION_DAYS -ErrorAction SilentlyContinue }
        }
    } finally { Remove-Item -LiteralPath $root -Recurse -Force }
}

if ($failures -gt 0) {
    Write-Host ""
    Write-Host "  $failures of $tests tests failed" -ForegroundColor Red
    exit 1
}
Write-Host ""
Write-Host "  $tests tests passed"
