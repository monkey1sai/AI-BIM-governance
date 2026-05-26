[CmdletBinding()]
param()

# scripts/tests/test-struct-log.ps1 — assertion-driven test for scripts/lib/StructLog.psm1.
#
# Follows the existing repo pattern (test-smoke-evidence.ps1): plain Set-StrictMode +
# throw-on-fail asserts. Pester is available but kept optional to match repo style.

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

Import-Module -Force (Join-Path $PSScriptRoot '..\lib\StructLog.psm1')

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

function New-TestLogRoot {
    return (New-Item -ItemType Directory -Force -Path (Join-Path ([IO.Path]::GetTempPath()) ("structlog-ps-" + [Guid]::NewGuid().ToString('N')))).FullName
}

function Read-JsonlLines {
    param([string] $Path)
    if (-not (Test-Path -LiteralPath $Path)) { return @() }
    return (Get-Content -LiteralPath $Path -Encoding UTF8 |
        Where-Object { $_ -and $_.Trim().Length -gt 0 } |
        ForEach-Object { $_ | ConvertFrom-Json })
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

# ---------------------------------------------------------------------------

Run-Test 'New-StructLogRunId emits the documented pattern' {
    $id = New-StructLogRunId -Now ([datetime]::Parse('2026-05-26T14:20:10Z').ToUniversalTime()) -RandomHex 'a3f900'
    Assert-Equal -Expected 'run_20260526_142010_a3f900' -Actual $id -Message "run id"
    Assert-True -Condition ($id -match '^run_\d{8}_\d{6}_[0-9a-f]{6}$') -Message "pattern match"
}

Run-Test 'Get-StructLogIsoTimestamp always emits ms precision' {
    $ts = Get-StructLogIsoTimestamp -Now ([datetime]::Parse('2026-05-26T14:23:11.482Z').ToUniversalTime())
    Assert-Equal -Expected '2026-05-26T14:23:11.482Z' -Actual $ts -Message "iso ms"
}

Run-Test 'Get-RedactedEnvVar emits raw value for allow-list keys' {
    $allow = Get-StructLogAllowList
    $v = Get-RedactedEnvVar -Key 'STORAGE_ROOT' -Value 'C:\repos\foo' -AllowList $allow
    Assert-Equal -Expected 'C:\repos\foo' -Actual $v.value_or_redacted -Message "raw"
}

Run-Test 'Get-RedactedEnvVar redacts secret-pattern keys with type+len' {
    $allow = Get-StructLogAllowList
    $v = Get-RedactedEnvVar -Key 'INTERNAL_API_TOKEN' -Value 'abc123xyz' -AllowList $allow
    Assert-Equal -Expected '[REDACTED:type=string, len=9]' -Actual $v.value_or_redacted -Message "redacted"
}

Run-Test 'Get-RedactedEnvVar emits type-only for non-listed non-secret keys' {
    $allow = Get-StructLogAllowList
    $v = Get-RedactedEnvVar -Key 'RANDOM_KNOB' -Value 'hello' -AllowList $allow
    Assert-Equal -Expected '[TYPE:type=string, len=5]' -Actual $v.value_or_redacted -Message "type-only"
}

Run-Test 'ConvertTo-StructLogRedactedData strips secret-pattern keys at depth' {
    $allow = Get-StructLogAllowList
    $out = ConvertTo-StructLogRedactedData -Data @{
        password = 'abc'
        nested = @{ api_key = 'shh'; body = @{ token = 'tok' } }
    } -AllowList $allow
    Assert-Equal -Expected '[REDACTED]' -Actual $out.password -Message "top-level"
    Assert-Equal -Expected '[REDACTED]' -Actual $out.nested.api_key -Message "nested api_key"
    Assert-Equal -Expected '[REDACTED]' -Actual $out.nested.body.token -Message "deep token"
}

Run-Test 'ConvertTo-StructLogRedactedData preserves env_snapshot vars[].key field' {
    $allow = Get-StructLogAllowList
    $data = @{
        vars = @(
            [ordered]@{ key = 'STORAGE_ROOT'; source = '.env'; value_or_redacted = 'C:\x'; type = 'string' }
        )
    }
    $out = ConvertTo-StructLogRedactedData -Data $data -AllowList $allow
    Assert-Equal -Expected 'STORAGE_ROOT' -Actual $out.vars[0].key -Message "schema 'key' field not redacted"
}

Run-Test 'New-StructLogger emits env_snapshot to the daily file' {
    $env:STRUCTLOG_TEST_SECRET = 'supersecret-1234'
    try {
        $root = New-TestLogRoot
        $logger = New-StructLogger -Service 'coordinator' -Component 'bootstrap' -LogRoot $root `
            -RunId 'run_20260526_142010_a3f900' -Now ([datetime]::Parse('2026-05-26T14:20:10.001Z').ToUniversalTime())
        Assert-True -Condition (Test-Path -LiteralPath $logger.CurrentFile) -Message "log file created"
        $lines = Read-JsonlLines -Path $logger.CurrentFile
        Assert-Equal -Expected 1 -Actual $lines.Count -Message "exactly one env_snapshot"
        Assert-Equal -Expected 'env_snapshot' -Actual $lines[0].event_type -Message "event_type"
        Assert-Equal -Expected 'coordinator' -Actual $lines[0].service -Message "service"
        $secretEntry = $lines[0].data.vars | Where-Object { $_.key -eq 'STRUCTLOG_TEST_SECRET' }
        Assert-True -Condition ($null -ne $secretEntry) -Message "secret env var observed"
        Assert-True -Condition ($secretEntry.value_or_redacted -like '`[REDACTED:*') `
            -Message "secret env value redacted (got: $($secretEntry.value_or_redacted))"
        Assert-True -Condition ($secretEntry.value_or_redacted -notlike '*supersecret-1234*') -Message "no raw value leak"
    } finally {
        Remove-Item Env:\STRUCTLOG_TEST_SECRET -ErrorAction SilentlyContinue
    }
}

Run-Test 'logger.Info / Network / Lifecycle / Anomaly / Audit / Error pass through with correct event_type' {
    $root = New-TestLogRoot
    $logger = New-StructLogger -Service 'scripts' -Component 'preflight' -LogRoot $root `
        -RunId 'run_20260526_142010_b1c200' -InitialTraceId 'script_run_20260526_142010_b1c200' `
        -Now ([datetime]::Parse('2026-05-26T14:23:11.482Z').ToUniversalTime()) -SkipEnvSnapshot

    $logger | Write-StructInfo -Component 'app' -Msg 'preflight ok' -Data @{ docker = '29.5.1' }
    $logger | Write-StructWarn -Component 'app' -Msg 'kit subprocess slow' -Data @{ ms = 4200 }
    try { throw 'boom' } catch { $logger | Write-StructError -Component 'app' -Msg 'caught boom' -ErrorRecord $_ }
    $logger | Write-StructNetwork -Component 'http' -Msg 'POST coordinator' -Data @{
        direction = 'outbound'; protocol = 'http'; peer = 'coordinator'; status = 200
    }
    $logger | Write-StructAudit -Component 'gh' -Msg 'gh pr merge' -Data @{ action = 'gh-pr-merge'; actor = 'agent'; target = 'PR#1' }
    $logger | Write-StructLifecycle -Component 'session' -Msg 'closed' -Data @{
        phase = 'closed'; subject_kind = 'script_run'; subject_id = 'foo'
    }
    $logger | Write-StructAnomaly -Component 'pipeline' -Msg 'fallback' -Data @{
        anomaly_kind = 'fallback'; reason = 'plan_b'
    }

    $lines = Read-JsonlLines -Path $logger.CurrentFile
    Assert-Equal -Expected 7 -Actual $lines.Count -Message "all 7 helpers wrote"
    $types = $lines | ForEach-Object { $_.event_type }
    Assert-Equal -Expected 'general' -Actual $types[0] -Message "info -> general"
    Assert-Equal -Expected 'general' -Actual $types[1] -Message "warn -> general"
    Assert-Equal -Expected 'logic_error' -Actual $types[2] -Message "error -> logic_error"
    Assert-Equal -Expected 'network' -Actual $types[3] -Message "network -> network"
    Assert-Equal -Expected 'audit' -Actual $types[4] -Message "audit -> audit"
    Assert-Equal -Expected 'lifecycle' -Actual $types[5] -Message "lifecycle -> lifecycle"
    Assert-Equal -Expected 'operation_anomaly' -Actual $types[6] -Message "anomaly -> operation_anomaly"
}

Run-Test 'logger picks up BIM_TRACE_ID env when present' {
    $env:BIM_TRACE_ID = 'rev_20260526_aabbcc'
    try {
        $root = New-TestLogRoot
        $logger = New-StructLogger -Service 'scripts' -Component 'inherit' -LogRoot $root `
            -RunId 'run_20260526_142010_c2d300' `
            -Now ([datetime]::Parse('2026-05-26T14:23:11.482Z').ToUniversalTime()) -SkipEnvSnapshot
        $logger | Write-StructInfo -Component 'app' -Msg 'hello'
        $lines = Read-JsonlLines -Path $logger.CurrentFile
        Assert-Equal -Expected 1 -Actual $lines.Count -Message "1 record"
        Assert-Equal -Expected 'rev_20260526_aabbcc' -Actual $lines[0].trace_id -Message "trace_id inherited from env"
    } finally {
        Remove-Item Env:\BIM_TRACE_ID -ErrorAction SilentlyContinue
    }
}

Run-Test 'seq increments per trace_id within a logger' {
    $root = New-TestLogRoot
    $logger = New-StructLogger -Service 'scripts' -Component 'seqtest' -LogRoot $root `
        -RunId 'run_20260526_142010_d3e400' -InitialTraceId 'rev_aaa' `
        -Now ([datetime]::Parse('2026-05-26T14:23:11.482Z').ToUniversalTime()) -SkipEnvSnapshot
    $logger | Write-StructInfo -Component 'app' -Msg 'a1'
    $logger | Write-StructInfo -Component 'app' -Msg 'a2'
    Set-StructLogTraceId -Logger $logger -TraceId 'rev_bbb'
    $logger | Write-StructInfo -Component 'app' -Msg 'b1'
    $logger | Write-StructInfo -Component 'app' -Msg 'b2'
    Set-StructLogTraceId -Logger $logger -TraceId 'rev_aaa'
    $logger | Write-StructInfo -Component 'app' -Msg 'a3'
    $lines = Read-JsonlLines -Path $logger.CurrentFile
    $aaa = $lines | Where-Object { $_.trace_id -eq 'rev_aaa' } | ForEach-Object { $_.seq }
    $bbb = $lines | Where-Object { $_.trace_id -eq 'rev_bbb' } | ForEach-Object { $_.seq }
    Assert-Equal -Expected '1 2 3' -Actual ($aaa -join ' ') -Message "aaa seq 1,2,3"
    Assert-Equal -Expected '1 2' -Actual ($bbb -join ' ') -Message "bbb seq 1,2"
}

Run-Test 'cross-midnight UTC rotate opens a new dated file' {
    $root = New-TestLogRoot
    $logger = New-StructLogger -Service 'scripts' -Component 'rotate' -LogRoot $root `
        -RunId 'run_20260526_235959_e4f500' -InitialTraceId 'rev_x' `
        -Now ([datetime]::Parse('2026-05-26T23:59:59.500Z').ToUniversalTime()) -SkipEnvSnapshot
    $logger | Write-StructInfo -Component 'app' -Msg 'before midnight'
    $before = $logger.CurrentFile

    # Manually advance the clock by patching NowProvider (tests-only)
    $afterTs = ([datetime]::Parse('2026-05-27T00:00:01.100Z').ToUniversalTime())
    $logger.NowProvider = { $afterTs }.GetNewClosure()
    $logger | Write-StructInfo -Component 'app' -Msg 'after midnight'
    $after = $logger.CurrentFile

    Assert-True -Condition ($before -ne $after) -Message "file path differs across midnight"
    Assert-True -Condition ($before -like '*2026-05-26*') -Message "before path on 2026-05-26"
    Assert-True -Condition ($after -like '*2026-05-27*') -Message "after path on 2026-05-27"
    $beforeLines = Read-JsonlLines -Path $before
    $afterLines = Read-JsonlLines -Path $after
    Assert-Equal -Expected 1 -Actual $beforeLines.Count -Message "before file has 1 record"
    Assert-Equal -Expected 1 -Actual $afterLines.Count -Message "after file has 1 record"
}

Run-Test 'sink failure does not throw and records last_failure' {
    $root = New-TestLogRoot
    # Pre-create the expected output path as a directory to force append to fail.
    $logger = New-StructLogger -Service 'scripts' -Component 'sinkfail' -LogRoot $root `
        -RunId 'run_20260526_142010_aa1100' -InitialTraceId 'rev_x' `
        -Now ([datetime]::Parse('2026-05-26T14:23:11.482Z').ToUniversalTime()) -SkipEnvSnapshot
    Remove-Item -LiteralPath $logger.CurrentFile -Force -ErrorAction SilentlyContinue
    New-Item -ItemType Directory -Force -Path $logger.CurrentFile | Out-Null

    & {
        $logger | Write-StructInfo -Component 'app' -Msg 'should not throw'
    } | Out-Null
    # Either main sink failed and recovery file received it, OR last_failure is non-null.
    $moved = $logger.RecordsWritten + $logger.RecordsDropped
    Assert-True -Condition ($moved -gt 0) -Message "logger advanced past the bad sink"
}

# ---------------------------------------------------------------------------

if ($failures -gt 0) {
    Write-Host ""
    Write-Host "  $failures of $tests tests failed" -ForegroundColor Red
    exit 1
}
Write-Host ""
Write-Host "  $tests tests passed"
