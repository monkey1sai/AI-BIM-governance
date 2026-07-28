[CmdletBinding()]
param(
    [ValidateSet('ContextPortsFixture', 'KitProvisioning', 'ProcessSpecs', 'OwnedStartLease', 'HealthSupportedSmoke', 'IdentityShutdown', 'ArtifactRenderer', 'AttemptReconcile', 'TopLevelOrchestration')]
    [string] $Case = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$RepoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$RunnerPath = Join-Path $RepoRoot 'scripts\dev\run-structured-log-runtime-evidence.ps1'
$ExpectedBrowserStates = @('ready','flush_loading','flush_failure','retry_loading','flush_success','close_loading','closed')
$TestBrowserArtifactNames = @(
    'browser/structured-log-failure.png',
    'browser/structured-log-success-closed.png',
    'browser/structured-log-trace.zip',
    'browser/structured-log-console.json',
    'browser/structured-log-network.json',
    'browser/structured-log-operability.json'
)
if (Test-Path -LiteralPath $RunnerPath) {
    . $RunnerPath
}

function Assert-True {
    param([bool] $Condition, [string] $Message)
    if (-not $Condition) { throw "ASSERT TRUE failed: $Message" }
}

function Assert-Equal {
    param($Expected, $Actual, [string] $Message)
    if ([string]$Expected -cne [string]$Actual) {
        throw "ASSERT EQUAL failed: $Message (expected='$Expected', actual='$Actual')"
    }
}

function Assert-Throws {
    param([scriptblock] $Action, [string] $Pattern, [string] $Message)
    $caught = $null
    try { & $Action } catch { $caught = $_ }
    if ($null -eq $caught) { throw "ASSERT THROWS failed: $Message" }
    if ($Pattern -and [string]$caught.Exception.Message -notmatch $Pattern) {
        throw "ASSERT THROWS pattern failed: $Message ($($caught.Exception.Message))"
    }
}

function New-TestRoot {
    param([string] $Name)
    $root = Join-Path ([System.IO.Path]::GetTempPath()) "structured-log-runner-$Name-$PID-$([guid]::NewGuid().ToString('N'))"
    New-Item -ItemType Directory -Path $root -Force | Out-Null
    return $root
}

function Write-TestFile {
    param([string] $Path, [string] $Content = 'fixture')
    New-Item -ItemType Directory -Path (Split-Path -Parent $Path) -Force | Out-Null
    Set-Content -LiteralPath $Path -Value $Content -Encoding utf8
}

function Write-TestSmokeEvidence {
    param(
        [Parameter(Mandatory)] [string] $Path,
        [ValidateSet('passed','blocked')] [string] $TierStatus = 'passed',
        [ValidateSet('production','test_double')] [string] $ExecutionMode = 'production',
        [ValidateRange(0, 2)] [int] $TierCount = 1,
        [ValidateSet('none','root_mismatch','ambiguous_conversion','ambiguous_review','browser_failed','close_failed','kit_missing','close_origin')]
        [string] $Mutation = 'none'
    )
    $ifcReadyJobId = if ($Mutation -eq 'root_mismatch') { 'ifcready_conflict' } else { 'ifcready_testroot' }
    $browserStatus = if ($Mutation -eq 'browser_failed') { 'failed' } else { 'passed' }
    $closeStatus = if ($Mutation -eq 'close_failed') { 'failed' } else { 'closed' }
    $kitInstanceId = if ($Mutation -eq 'kit_missing') { $null } else { 'kit_test_1' }
    $closeOrigin = if ($Mutation -eq 'close_origin') { 'runner_fallback' } else { 'browser' }
    $tiers = @()
    for ($index = 0; $index -lt $TierCount; $index++) {
        $tiers += [ordered]@{
            tier = 'real_ifc_intake_conversion'
            status = $TierStatus
            blocker = if ($TierStatus -eq 'passed') { '' } else { 'blocked fixture' }
            ids = [ordered]@{
                ifc_ready_job_id = $ifcReadyJobId
                conversion_job_id = 'conv_1'
                kit_instance_id = $kitInstanceId
            }
            detail = [ordered]@{
                execution_mode = $ExecutionMode
                root_trace_id = 'ifcready_testroot'
                review_session_id = 'session_1'
                browser_status = $browserStatus
                close_status = $closeStatus
                close_origin = $closeOrigin
                browser_artifacts = [ordered]@{
                    root_trace_id = 'ifcready_testroot'
                    review_session_id = 'session_1'
                    conversion_job_id = 'conv_1'
                    kit_instance_id = $kitInstanceId
                    state_transitions = $ExpectedBrowserStates
                    failure_provenance = 'playwright_intercepted_503'
                    forced_viewer_log_statuses = @(503,503,503)
                    retry_viewer_log_status = 200
                    close_http_status = 200
                    artifacts = [ordered]@{
                        failure_screenshot = [ordered]@{path='browser/structured-log-failure.png'}
                        final_screenshot = [ordered]@{path='browser/structured-log-success-closed.png'}
                        playwright_trace = [ordered]@{path='browser/structured-log-trace.zip'}
                        console_events = [ordered]@{path='browser/structured-log-console.json'}
                        network_events = [ordered]@{path='browser/structured-log-network.json'}
                        operability = [ordered]@{path='browser/structured-log-operability.json'}
                    }
                }
            }
        }
    }
    $context = [ordered]@{ execution_mode = $ExecutionMode }
    if ($Mutation -eq 'ambiguous_conversion') { $context.conversion_job_id = 'conv_conflict' }
    if ($Mutation -eq 'ambiguous_review') { $context.review_session_id = 'session_conflict' }
    [ordered]@{
        schema_version = 'demo-runtime-readiness-smoke/v1'
        context = $context
        tiers = $tiers
    } | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $Path -Encoding utf8
}

function New-TestContext {
    param([string] $Root)
    $attempt = Join-Path $Root 'artifacts\spec-to-done\cross-service-structured-log-baseline\evidence\attempt-001'
    New-Item -ItemType Directory -Path $attempt -Force | Out-Null
    $logRoot = Join-Path $attempt 'logs'
    $storage = Join-Path $attempt 'storage'
    New-Item -ItemType Directory -Path $logRoot, $storage -Force | Out-Null
    return [pscustomobject]@{
        RepoRoot = $Root
        AttemptRoot = $attempt
        AttemptId = 'attempt-001'
        FixturePath = (Join-Path $storage 'model.ifc')
        FixtureSha256 = ('a' * 64)
        PythonExe = (Join-Path $Root 'python.exe')
        LogRoot = $logRoot
        StorageRoot = $storage
        Ports = [ordered]@{ Coordinator = 8005; Viewer = 5175; Conversion = 49104 }
        ProvenancePath = (Join-Path $attempt 'command-provenance.jsonl')
        LeasePath = (Join-Path $attempt 'runtime-lease.json')
        Kit = $null
    }
}

function Get-TestRequiredArtifactNames {
    return @(
        'attempt-manifest.json',
        'runtime-lease.json',
        'command-provenance.jsonl',
        'machine.json',
        'fixture.json',
        'health.json',
        'bscheme-readiness.json',
        'root-trace-timeline.json',
        'runtime-log-validation.json',
        'shutdown.json',
        'pr-fields.json',
        'evidence-summary.md'
        $TestBrowserArtifactNames
    )
}

function New-TestCanonicalReadiness {
    param([string] $RootTraceId = 'ifcready_root')
    return [ordered]@{
        schema_version = 'demo-runtime-readiness-smoke/v1'
        capability = 'demo-runtime-readiness-smoke'
        context = [ordered]@{ execution_mode = 'production' }
        tiers = @([ordered]@{
            tier = 'real_ifc_intake_conversion'
            status = 'passed'
            ids = [ordered]@{
                ifc_ready_job_id = $RootTraceId
                conversion_job_id = 'stream_conv_1'
                kit_instance_id = 'kit_instance_1'
            }
            detail = [ordered]@{
                execution_mode = 'production'
                root_trace_id = $RootTraceId
                review_session_id = 'review_session_1'
                browser_status = 'passed'
                close_status = 'closed'
                close_origin = 'browser'
                browser_artifacts = [ordered]@{
                    root_trace_id = $RootTraceId
                    review_session_id = 'review_session_1'
                    conversion_job_id = 'stream_conv_1'
                    kit_instance_id = 'kit_instance_1'
                    state_transitions = $ExpectedBrowserStates
                    failure_provenance = 'playwright_intercepted_503'
                    forced_viewer_log_statuses = @(503,503,503)
                    retry_viewer_log_status = 200
                    close_http_status = 200
                    artifacts = [ordered]@{
                        failure_screenshot = [ordered]@{path='browser/structured-log-failure.png'}
                        final_screenshot = [ordered]@{path='browser/structured-log-success-closed.png'}
                        playwright_trace = [ordered]@{path='browser/structured-log-trace.zip'}
                        console_events = [ordered]@{path='browser/structured-log-console.json'}
                        network_events = [ordered]@{path='browser/structured-log-network.json'}
                        operability = [ordered]@{path='browser/structured-log-operability.json'}
                    }
                }
            }
        })
    }
}

function Write-TestBrowserArtifacts {
    param([Parameter(Mandatory)] [string] $AttemptRoot)
    $browserDir = Join-Path $AttemptRoot 'browser'
    New-Item -ItemType Directory -Path $browserDir -Force | Out-Null
    Set-Content -LiteralPath (Join-Path $browserDir 'structured-log-failure.png') -Value 'failure-png' -Encoding utf8
    Set-Content -LiteralPath (Join-Path $browserDir 'structured-log-success-closed.png') -Value 'success-png' -Encoding utf8
    Write-TestPrivacyTrace -Path (Join-Path $browserDir 'structured-log-trace.zip')
    [ordered]@{schema_version='1';events=@([ordered]@{seq=1;type='log'})} | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $browserDir 'structured-log-console.json') -Encoding utf8
    [ordered]@{schema_version='1';events=@(
        [ordered]@{seq=1;method='POST';path='/api/internal/viewer-log';status=503;phase='forced_failure';provenance='playwright_intercepted'},
        [ordered]@{seq=2;method='POST';path='/api/internal/viewer-log';status=200;phase='retry_success';provenance='coordinator'},
        [ordered]@{seq=3;method='POST';path='/api/review-sessions/review_session_1/close';status=200;phase='browser_close';provenance='coordinator'}
    )} | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $browserDir 'structured-log-network.json') -Encoding utf8
    $operabilityArtifacts = [ordered]@{}
    foreach ($entry in ([ordered]@{
        failure_screenshot='structured-log-failure.png'
        final_screenshot='structured-log-success-closed.png'
        playwright_trace='structured-log-trace.zip'
        console_events='structured-log-console.json'
        network_events='structured-log-network.json'
    }).GetEnumerator()) {
        $artifactPath = Join-Path $browserDir $entry.Value
        $operabilityArtifacts[$entry.Key] = [ordered]@{
            path=$entry.Value
            size_bytes=[int64](Get-Item -LiteralPath $artifactPath).Length
            sha256=(Get-FileHash -LiteralPath $artifactPath -Algorithm SHA256).Hash.ToLowerInvariant()
        }
    }
    [ordered]@{
        schema_version='1'
        root_trace_id='ifcready_root'
        review_session_id='review_session_1'
        conversion_job_id='stream_conv_1'
        kit_instance_id='kit_instance_1'
        browser_run_id='run_20260728_010203_abcdef'
        state_transitions=$ExpectedBrowserStates
        failure_provenance='playwright_intercepted_503'
        forced_viewer_log_statuses=@(503,503,503)
        retry_viewer_log_status=200
        close_origin='browser'
        close_status='closed'
        close_http_status=200
        artifacts=$operabilityArtifacts
    } | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $browserDir 'structured-log-operability.json') -Encoding utf8
}

function Write-TestCompleteArtifactManifest {
    param([string] $AttemptRoot, [string] $AttemptId)
    $now = '2026-07-24T00:00:00.0000000Z'
    Write-TestBrowserArtifacts -AttemptRoot $AttemptRoot
    $jsonArtifacts = [ordered]@{
        'attempt-manifest.json' = [ordered]@{schema_version='1';attempt_id=$AttemptId;status='succeeded';root_trace_id='ifcready_root';ports=[ordered]@{Coordinator=8005;Viewer=5175;Conversion=49104};fixture_sha256=('a'*64)}
        'runtime-lease.json' = [ordered]@{schema_version='1';attempt_id=$AttemptId;processes=@()}
        'machine.json' = [ordered]@{schema_version='1';machine_name='test-machine';os_version='test-os';pwsh_version='7.5';process_architecture='X64'}
        'fixture.json' = [ordered]@{schema_version='1';name='model.ifc';size_bytes=3;sha256=('a'*64);source_path='C:\fixture\model.ifc';attempt_copy=(Join-Path $AttemptRoot 'storage\model.ifc')}
        'health.json' = [ordered]@{schema_version='1';probes=@([ordered]@{name='coordinator';uri='http://127.0.0.1:8005/health';started_utc=$now;ended_utc=$now;status='passed';http_status=200;error_type=$null})}
        'bscheme-readiness.json' = New-TestCanonicalReadiness
        'root-trace-timeline.json' = [ordered]@{schema_version='1';root_trace_id='ifcready_root';records=@()}
        'runtime-log-validation.json' = [ordered]@{schema_version='1';status='passed';files=@();line_counts=[ordered]@{};event_counts=[ordered]@{};violations=@();redaction_violations=@()}
        'shutdown.json' = [ordered]@{schema_version='1';attempt_id=$AttemptId;status='succeeded';entries=@();foreign_listeners=@()}
        'pr-fields.json' = [ordered]@{schema_version='1';attempt_id=$AttemptId;root_trace_id='ifcready_root';runtime_ids=[ordered]@{ifc_ready_job_id=@('ifcready_root');conversion_job_id=@('stream_conv_1');review_session_id=@('review_session_1');kit_instance_id=@('kit_instance_1')};shutdown_status='owned_shutdown_complete';tests='scripts/tests/test-run-structured-log-runtime-evidence.ps1';screenshot_trace=[ordered]@{failure_screenshot='browser/structured-log-failure.png';final_screenshot='browser/structured-log-success-closed.png';trace='browser/structured-log-trace.zip'};browser_evidence=[ordered]@{console='browser/structured-log-console.json';network='browser/structured-log-network.json';operability='browser/structured-log-operability.json'};known_gaps=@()}
    }
    foreach ($artifact in $jsonArtifacts.GetEnumerator()) {
        $artifact.Value | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath (Join-Path $AttemptRoot $artifact.Key) -Encoding utf8
    }
    [ordered]@{seq=1;ts_utc=$now;started_utc=$now;ended_utc=$now;phase='test';command='test command';cwd=$AttemptRoot;status='passed';exit_code=0} | ConvertTo-Json -Compress | Set-Content -LiteralPath (Join-Path $AttemptRoot 'command-provenance.jsonl') -Encoding utf8
    @('# Structured Log Runtime Evidence','','## Revision and machine','','## Fixture name-size-SHA256','','## Exact command provenance','','## Owned process lease and shutdown','','## Root trace timeline and runtime IDs','','## Schema/env-snapshot/redaction validation','','## OpenSpec 10.1-10.5 mapping','','## Verified facts','','## Inferences','','## Unverified risks','','## Skipped checks') | Set-Content -LiteralPath (Join-Path $AttemptRoot 'evidence-summary.md') -Encoding utf8
    $entries = @()
    foreach ($name in @(Get-TestRequiredArtifactNames)) {
        $path = Join-Path $AttemptRoot $name
        $entries += [pscustomobject]@{
            name = $name
            path = $name
            size_bytes = [int64](Get-Item -LiteralPath $path).Length
            sha256 = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
        }
    }
    $manifest = [ordered]@{
        schema_version = '1'
        attempt_id = $AttemptId
        status = 'succeeded'
        files = $entries
        root_trace_id = 'ifcready_root'
        shutdown_status = 'owned_shutdown_complete'
        known_gaps = @()
    }
    $manifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $AttemptRoot 'artifact-manifest.json') -Encoding utf8
}

function Update-TestArtifactManifestHash {
    param([string] $AttemptRoot, [string] $Name)
    $manifestPath = Join-Path $AttemptRoot 'artifact-manifest.json'
    $manifest = Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json
    $entry = $manifest.files | Where-Object name -CEQ $Name | Select-Object -First 1
    $entry.size_bytes = [int64](Get-Item -LiteralPath (Join-Path $AttemptRoot $Name)).Length
    $entry.sha256 = (Get-FileHash -LiteralPath (Join-Path $AttemptRoot $Name) -Algorithm SHA256).Hash.ToLowerInvariant()
    $manifest | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $manifestPath -Encoding utf8
}

function Update-TestBrowserArtifactBindings {
    param([string] $AttemptRoot, [string] $Role, [string] $Name)
    $artifactPath = Join-Path $AttemptRoot "browser/$Name"
    $operabilityPath = Join-Path $AttemptRoot 'browser/structured-log-operability.json'
    $operability = Get-Content -Raw -LiteralPath $operabilityPath | ConvertFrom-Json
    $descriptor = $operability.artifacts.PSObject.Properties[$Role].Value
    $descriptor.path = $Name
    $descriptor.size_bytes = [int64](Get-Item -LiteralPath $artifactPath).Length
    $descriptor.sha256 = (Get-FileHash -LiteralPath $artifactPath -Algorithm SHA256).Hash.ToLowerInvariant()
    $operability | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $operabilityPath -Encoding utf8
    Update-TestArtifactManifestHash -AttemptRoot $AttemptRoot -Name "browser/$Name"
    Update-TestArtifactManifestHash -AttemptRoot $AttemptRoot -Name 'browser/structured-log-operability.json'
}

function Get-TestPrivacyTraceEntries {
    param(
        [string] $Url = 'http://127.0.0.1:8005/ui/open?session=review_session_1&trace_id=ifcready_root',
        [string] $UnsafeProperty = '',
        [string] $NetworkContent = '',
        [object[]] $AdditionalEntries = @(),
        [string[]] $AdditionalTraceLines = @(),
        [byte[]] $StacksBytes = ([Text.Encoding]::UTF8.GetBytes('{"files":["playwright-helper-0.mjs"],"stacks":[]}')),
        [int] $StacksExternalAttributes = 0
    )
    $before = [ordered]@{type='before';callId='call@1';startTime=1;apiName='page.goto';class='Frame';method='goto';params=[ordered]@{url=$Url}}
    if (-not [string]::IsNullOrWhiteSpace($UnsafeProperty)) { $before.params[$UnsafeProperty] = 'test-only-forbidden-value' }
    $traceLines = @(
        ([ordered]@{type='context-options';version='1';browserName='chromium';options=[ordered]@{}} | ConvertTo-Json -Compress -Depth 10),
        ($before | ConvertTo-Json -Compress -Depth 10),
        ([ordered]@{type='after';callId='call@1';endTime=2} | ConvertTo-Json -Compress -Depth 10)
    ) + @($AdditionalTraceLines)
    $trace = $traceLines -join "`n"
    $effectiveStacksExternalAttributes = if ($StacksExternalAttributes -ne 0) { $StacksExternalAttributes } else { -2119958528 }
    $entries = @(
        [pscustomobject]@{Name='trace.trace';Bytes=[Text.Encoding]::UTF8.GetBytes("$trace`n");ExternalAttributes=-2119958528},
        [pscustomobject]@{Name='trace.network';Bytes=[Text.Encoding]::UTF8.GetBytes($NetworkContent);ExternalAttributes=-2119958528},
        [pscustomobject]@{Name='trace.stacks';Bytes=$StacksBytes;ExternalAttributes=$effectiveStacksExternalAttributes}
    )
    return @($entries + $AdditionalEntries)
}

function Write-TestPrivacyTrace {
    param(
        [Parameter(Mandatory)] [string] $Path,
        [string] $Url = 'http://127.0.0.1:8005/ui/open?session=review_session_1&trace_id=ifcready_root',
        [string] $UnsafeProperty = '',
        [string] $NetworkContent = '',
        [object[]] $AdditionalEntries = @(),
        [string[]] $AdditionalTraceLines = @(),
        [byte[]] $StacksBytes = ([Text.Encoding]::UTF8.GetBytes('{"files":["playwright-helper-0.mjs"],"stacks":[]}')),
        [int] $StacksExternalAttributes = 0
    )
    New-TestZip -Path $Path -Entries (Get-TestPrivacyTraceEntries -Url $Url -UnsafeProperty $UnsafeProperty `
        -NetworkContent $NetworkContent -AdditionalEntries $AdditionalEntries -AdditionalTraceLines $AdditionalTraceLines `
        -StacksBytes $StacksBytes -StacksExternalAttributes $StacksExternalAttributes)
}

function New-TestKitAssets {
    param([string] $Root)
    $kit = Join-Path $Root 'bim-streaming-server\_build\windows-x86_64\release\kit\kit.exe'
    $hoops = Join-Path $Root 'bim-streaming-server\_build\windows-x86_64\release\exts\omni.services.convert.cad\omni\services\convert\cad\services\process\hoops_main.py'
    $config = Join-Path $Root 'bim-streaming-server\source\apps\ezplus.bim_ifc_usd_converter.kit'
    $wrapper = Join-Path $Root 'bim-streaming-server\scripts\convert-ifc-to-usdc.ps1'
    foreach ($path in @($kit, $hoops, $config, $wrapper)) { Write-TestFile -Path $path }
}

function New-TestExtractedKitAssets {
    param([string] $Destination)
    $kit = Join-Path $Destination '_build\windows-x86_64\release\kit\kit.exe'
    $hoops = Join-Path $Destination '_build\windows-x86_64\release\exts\omni.services.convert.cad\omni\services\convert\cad\services\process\hoops_main.py'
    $config = Join-Path $Destination 'source\apps\ezplus.bim_ifc_usd_converter.kit'
    $wrapper = Join-Path $Destination 'scripts\convert-ifc-to-usdc.ps1'
    foreach ($path in @($kit, $hoops, $config, $wrapper)) { Write-TestFile -Path $path }
}

function New-TestZip {
    param([string] $Path, [object[]] $Entries)
    Add-Type -AssemblyName System.IO.Compression
    New-Item -ItemType Directory -Path (Split-Path -Parent $Path) -Force | Out-Null
    $stream = [IO.FileStream]::new($Path,[IO.FileMode]::Create,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
    try {
        $archive = [IO.Compression.ZipArchive]::new($stream,[IO.Compression.ZipArchiveMode]::Create,$false)
        try {
            foreach ($item in $Entries) {
                $entry = $archive.CreateEntry([string]$item.Name)
                if ($null -ne $item.PSObject.Properties['ExternalAttributes']) { $entry.ExternalAttributes = [int]$item.ExternalAttributes }
                if (-not ([string]$item.Name).EndsWith('/')) {
                    $bytesProperty = $item.PSObject.Properties['Bytes']
                    if ($null -ne $bytesProperty) {
                        $entryStream = $entry.Open()
                        try {
                            [byte[]]$bytes = $bytesProperty.Value
                            $entryStream.Write($bytes,0,$bytes.Length)
                        } finally { $entryStream.Dispose() }
                    } else {
                        $writer = [IO.StreamWriter]::new($entry.Open())
                        try { $writer.Write([string]$item.Content) } finally { $writer.Dispose() }
                    }
                }
            }
        } finally { $archive.Dispose() }
    } finally { $stream.Dispose() }
}

function Get-TestKitZipEntries {
    return @(
        [pscustomobject]@{Name='_build/windows-x86_64/release/kit/kit.exe';Content='kit'},
        [pscustomobject]@{Name='_build/windows-x86_64/release/exts/omni.services.convert.cad/omni/services/convert/cad/services/process/hoops_main.py';Content='hoops'},
        [pscustomobject]@{Name='source/apps/ezplus.bim_ifc_usd_converter.kit';Content='config'},
        [pscustomobject]@{Name='scripts/convert-ifc-to-usdc.ps1';Content='wrapper'}
    )
}

function Invoke-ContextPortsFixtureCase {
    Assert-True ($null -ne (Get-Command New-StructuredLogAttemptContext -ErrorAction SilentlyContinue)) 'context function exists'
    $root = New-TestRoot 'context'
    try {
        $fixture = Join-Path $root 'source.ifc'
        $python = Join-Path $root 'python.exe'
        Write-TestFile $fixture 'IFC-CONTENT'
        Write-TestFile $python 'python'
        $evidenceRoot = Join-Path $root 'artifacts\spec-to-done\cross-service-structured-log-baseline\evidence'
        $attempt = Join-Path $evidenceRoot 'attempt-new'
        $ports = [ordered]@{ Coordinator = 8005; Viewer = 5175; Conversion = 49104 }
        $ctx = New-StructuredLogAttemptContext -RepoRoot $root -AttemptRoot $attempt -FixturePath $fixture -PythonExe $python -Ports $ports -PortInspector { param($port) @() }
        Assert-Equal 8005 $ctx.Ports.Coordinator 'alternate coordinator port'
        Assert-True (Test-Path (Join-Path $attempt 'machine.json')) 'machine capture exists'
        $fixtureCapture = Get-Content -Raw (Join-Path $attempt 'fixture.json') | ConvertFrom-Json
        Assert-Equal 64 ([string]$fixtureCapture.sha256).Length 'fixture SHA-256 captured'
        Assert-Throws { New-StructuredLogAttemptContext -RepoRoot $root -AttemptRoot $attempt -FixturePath $fixture -PythonExe $python -Ports $ports -PortInspector { @() } } 'attempt.*exist|reus' 'reused attempt fails closed'
        Assert-Throws { New-StructuredLogAttemptContext -RepoRoot $root -AttemptRoot (Join-Path $evidenceRoot 'missing-ifc-attempt') -FixturePath (Join-Path $root 'missing.ifc') -PythonExe $python -Ports $ports -PortInspector { @() } } 'fixture|IFC' 'missing IFC fails closed'
        Assert-Throws { New-StructuredLogAttemptContext -RepoRoot $root -AttemptRoot 'relative-attempt' -FixturePath $fixture -PythonExe $python -Ports $ports -PortInspector { @() } } 'absolute' 'relative attempt fails closed'
        $outsideAttempt = Join-Path $root 'outside-attempt'
        Assert-Throws { New-StructuredLogAttemptContext -RepoRoot $root -AttemptRoot $outsideAttempt -FixturePath $fixture -PythonExe $python -Ports $ports -PortInspector { @() } } 'evidence|confine|canonical|HELD' 'outside attempt root fails before create/copy'
        Assert-True (-not (Test-Path -LiteralPath $outsideAttempt)) 'outside attempt root is never created'
        $dotDotAttempt = "$evidenceRoot\nested\..\attempt-dotdot"
        Assert-Throws { New-StructuredLogAttemptContext -RepoRoot $root -AttemptRoot $dotDotAttempt -FixturePath $fixture -PythonExe $python -Ports $ports -PortInspector { @() } } 'canonical|\.\.|HELD' 'dot-dot attempt spelling fails closed'
        $foreign = [pscustomobject]@{ Alive = $true; Inspections = 0 }
        $busyAttempt = Join-Path $evidenceRoot 'busy-attempt'
        Assert-Throws {
            New-StructuredLogAttemptContext -RepoRoot $root -AttemptRoot $busyAttempt -FixturePath $fixture -PythonExe $python -Ports $ports -PortInspector {
                param($port)
                $foreign.Inspections++
                if ($port -eq 8005 -and $foreign.Alive) { [pscustomobject]@{ pid = 9876; path = 'foreign.exe' } }
            }
        } 'HELD|occupied|listener' 'occupied port fails closed'
        Assert-True $foreign.Alive 'foreign listener remains alive after occupied-port rejection'
        Assert-True ($foreign.Inspections -gt 0) 'foreign listener was observed'
        Assert-True (-not (Test-Path -LiteralPath $busyAttempt)) 'occupied-port rejection creates no attempt root'
    } finally {
        Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
    }
}

function Invoke-KitProvisioningCase {
    Assert-True ($null -ne (Get-Command Resolve-StructuredLogKitPrerequisites -ErrorAction SilentlyContinue)) 'Kit resolver exists'
    $root = New-TestRoot 'kit'
    try {
        $ctx = New-TestContext $root
        Write-TestFile $ctx.FixturePath
        Write-TestFile $ctx.PythonExe
        Write-TestFile (Join-Path $root 'bim-streaming-server\repo.bat') 'build'
        New-TestKitAssets $root
        $buildCalls = [pscustomobject]@{ Value = 0 }
        $result = Resolve-StructuredLogKitPrerequisites -Context $ctx -KitProvisionMode Build -ProcessInvoker {
            param($filePath, $argumentList, $cwd, $stdoutPath, $stderrPath)
            $script:unused = $null
            $buildCalls.Value++
            New-TestKitAssets $root
            return 0
        }
        Assert-Equal 1 $buildCalls.Value 'branch-local build called once even when stale assets already exist'
        Assert-True (Test-Path -LiteralPath $result.kit_exe) 'kit.exe revalidated'
        Assert-True (Test-Path -LiteralPath $result.hoops_main) 'HOOPS revalidated'

        $linkRoot = New-TestRoot 'kit-extscache-link'
        try {
            $linkContext = New-TestContext $linkRoot
            Write-TestFile (Join-Path $linkRoot 'bim-streaming-server\repo.bat') 'build'
            New-TestKitAssets $linkRoot
            $extensionTarget = Join-Path $linkRoot 'extension-target'
            $canonicalSuffix = 'omni\services\convert\cad\services\process\hoops_main.py'
            Write-TestFile -Path (Join-Path $extensionTarget $canonicalSuffix) -Content 'linked-hoops'
            $extensionLink = Join-Path $linkRoot 'bim-streaming-server\_build\windows-x86_64\release\extscache\omni.services.convert.cad-linked'
            New-Item -ItemType Directory -Path (Split-Path -Parent $extensionLink) -Force | Out-Null
            New-Item -ItemType Junction -Path $extensionLink -Target $extensionTarget | Out-Null
            $linkedResult = Resolve-StructuredLogKitPrerequisites -Context $linkContext -KitProvisionMode Build -ProcessInvoker { return 0 }
            Assert-True (Test-Path -LiteralPath $linkedResult.hoops_main -PathType Leaf) 'Build discovery traverses an extscache immediate-child directory link candidate'
            Assert-True ([string]$linkedResult.hoops_main -like "*$canonicalSuffix") 'linked HOOPS match keeps only the canonical suffix'
            Assert-Equal (Join-Path $extensionLink $canonicalSuffix) $linkedResult.hoops_main 'extscache first-hit wins when both extscache link and exts contain canonical HOOPS'
        } finally { Remove-Item -LiteralPath $linkRoot -Recurse -Force -ErrorAction SilentlyContinue }

        $badPackage = Join-Path $root 'bad.zip'
        Write-TestFile $badPackage 'package'
        Assert-Throws { Resolve-StructuredLogKitPrerequisites -Context $ctx -KitProvisionMode VerifiedPackage -KitPackagePath $badPackage -KitPackageSha256 ('0' * 64) -PackageExtractor { throw 'must not extract bad hash' } } 'SHA-256|checksum|hash' 'bad package hash fails before extraction'

        $goodPackage = Join-Path $root 'good.zip'
        New-TestZip -Path $goodPackage -Entries @(Get-TestKitZipEntries)
        $goodHash = (Get-FileHash -LiteralPath $goodPackage -Algorithm SHA256).Hash.ToLowerInvariant()
        $good = Resolve-StructuredLogKitPrerequisites -Context $ctx -KitProvisionMode VerifiedPackage -KitPackagePath $goodPackage -KitPackageSha256 $goodHash
        $extractRoot = Join-Path $ctx.AttemptRoot 'kit-package'
        foreach ($property in @('kit_exe','hoops_main','converter_config','converter_wrapper')) {
            Assert-True ([string]$good.$property -like "$extractRoot*") "verified package $property comes only from attempt-scoped extract"
        }

        $missingRoot = New-TestRoot 'kit-missing'
        try {
            $missingContext = New-TestContext $missingRoot
            Write-TestFile $missingContext.FixturePath
            Write-TestFile $missingContext.PythonExe
            Write-TestFile (Join-Path $missingRoot 'bim-streaming-server\repo.bat') 'build'
            Assert-Throws { Resolve-StructuredLogKitPrerequisites -Context $missingContext -KitProvisionMode Build -ProcessInvoker { return 0 } } 'HELD|missing|asset' 'missing assets after build fail closed'
            New-TestKitAssets $missingRoot
            $incompletePackage = Join-Path $missingRoot 'incomplete.zip'
            New-TestZip -Path $incompletePackage -Entries @([pscustomobject]@{Name='_build/windows-x86_64/release/kit/kit.exe';Content='kit'})
            $incompleteHash = (Get-FileHash -LiteralPath $incompletePackage -Algorithm SHA256).Hash.ToLowerInvariant()
            Assert-Throws { Resolve-StructuredLogKitPrerequisites -Context $missingContext -KitProvisionMode VerifiedPackage -KitPackagePath $incompletePackage -KitPackageSha256 $incompleteHash } 'HELD|missing|asset' 'stale repo assets cannot substitute for missing package contents'
        } finally { Remove-Item -LiteralPath $missingRoot -Recurse -Force -ErrorAction SilentlyContinue }

        $toctouRoot = New-TestRoot 'kit-toctou'
        try {
            $toctouContext = New-TestContext $toctouRoot
            $toctouPackage = Join-Path $toctouRoot 'package.zip'
            New-TestZip -Path $toctouPackage -Entries @(Get-TestKitZipEntries)
            $toctouHash = (Get-FileHash -LiteralPath $toctouPackage -Algorithm SHA256).Hash.ToLowerInvariant()
            $observedExtractPath = [pscustomobject]@{Value=$null}
            Resolve-StructuredLogKitPrerequisites -Context $toctouContext -KitProvisionMode VerifiedPackage -KitPackagePath $toctouPackage -KitPackageSha256 $toctouHash -PackageSnapshotCopier {
                param($source,$snapshot)
                Copy-Item -LiteralPath $source -Destination $snapshot
                Set-Content -LiteralPath $source -Value 'mutated-after-snapshot'
            } -PackageExtractor {
                param($packagePath,$destination)
                $observedExtractPath.Value=$packagePath
                New-TestExtractedKitAssets -Destination $destination
            } | Out-Null
            Assert-True ([string]$observedExtractPath.Value -like "$($toctouContext.AttemptRoot)\kit-package-input\*") 'extractor receives only the attempt-scoped verified snapshot'
        } finally { Remove-Item -LiteralPath $toctouRoot -Recurse -Force -ErrorAction SilentlyContinue }

        foreach ($archiveCase in @(
            [pscustomobject]@{Name='traversal';Entries=@([pscustomobject]@{Name='../escape.txt';Content='x'})},
            [pscustomobject]@{Name='absolute';Entries=@([pscustomobject]@{Name='/absolute.txt';Content='x'})},
            [pscustomobject]@{Name='drive';Entries=@([pscustomobject]@{Name='C:/drive.txt';Content='x'})},
            [pscustomobject]@{Name='ads';Entries=@([pscustomobject]@{Name='safe.txt:ads';Content='x'})},
            [pscustomobject]@{Name='duplicate';Entries=@([pscustomobject]@{Name='A.txt';Content='a'},[pscustomobject]@{Name='a.txt';Content='b'})},
            [pscustomobject]@{Name='collision';Entries=@([pscustomobject]@{Name='node';Content='file'},[pscustomobject]@{Name='node/child.txt';Content='child'})},
            [pscustomobject]@{Name='symlink';Entries=@([pscustomobject]@{Name='link';Content='target';ExternalAttributes=([int](0xA000 -shl 16))})}
        )) {
            $archiveRoot = New-TestRoot "kit-archive-$($archiveCase.Name)"
            try {
                $archiveContext = New-TestContext $archiveRoot
                $archivePath = Join-Path $archiveRoot 'unsafe.zip'
                New-TestZip -Path $archivePath -Entries $archiveCase.Entries
                $archiveHash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
                $extractCalls = [pscustomobject]@{Value=0}
                Assert-Throws { Resolve-StructuredLogKitPrerequisites -Context $archiveContext -KitProvisionMode VerifiedPackage -KitPackagePath $archivePath -KitPackageSha256 $archiveHash -PackageExtractor { $extractCalls.Value++; throw 'extractor must not run' } } 'archive|entry|unsafe|HELD|collision|duplicate|reparse|symlink' "$($archiveCase.Name) archive is rejected during preflight"
                Assert-Equal 0 $extractCalls.Value "$($archiveCase.Name) preflight failure never invokes extractor"
            } finally { Remove-Item -LiteralPath $archiveRoot -Recurse -Force -ErrorAction SilentlyContinue }
        }

        $postExtractRoot = New-TestRoot 'kit-post-extract-reparse'
        try {
            $postExtractContext = New-TestContext $postExtractRoot
            $postExtractPackage = Join-Path $postExtractRoot 'safe.zip'
            New-TestZip -Path $postExtractPackage -Entries @(Get-TestKitZipEntries)
            $postExtractHash = (Get-FileHash -LiteralPath $postExtractPackage -Algorithm SHA256).Hash.ToLowerInvariant()
            $junctionTarget = Join-Path $postExtractRoot 'outside-target'
            New-Item -ItemType Directory -Path $junctionTarget -Force | Out-Null
            Assert-Throws { Resolve-StructuredLogKitPrerequisites -Context $postExtractContext -KitProvisionMode VerifiedPackage -KitPackagePath $postExtractPackage -KitPackageSha256 $postExtractHash -PackageExtractor {
                param($packagePath,$destination)
                New-TestExtractedKitAssets -Destination $destination
                New-Item -ItemType Junction -Path (Join-Path $destination 'unsafe-link') -Target $junctionTarget | Out-Null
            } } 'reparse|HELD|escaped' 'post-extract reparse point is rejected'
        } finally { Remove-Item -LiteralPath $postExtractRoot -Recurse -Force -ErrorAction SilentlyContinue }

        $rootJunctionRoot = New-TestRoot 'kit-extract-root-reparse'
        try {
            $rootJunctionContext = New-TestContext $rootJunctionRoot
            $rootJunctionPackage = Join-Path $rootJunctionRoot 'safe.zip'
            New-TestZip -Path $rootJunctionPackage -Entries @(Get-TestKitZipEntries)
            $rootJunctionHash = (Get-FileHash -LiteralPath $rootJunctionPackage -Algorithm SHA256).Hash.ToLowerInvariant()
            $outsideAssets = Join-Path $rootJunctionRoot 'outside-assets'
            New-TestExtractedKitAssets -Destination $outsideAssets
            Assert-Throws { Resolve-StructuredLogKitPrerequisites -Context $rootJunctionContext -KitProvisionMode VerifiedPackage -KitPackagePath $rootJunctionPackage -KitPackageSha256 $rootJunctionHash -PackageExtractor {
                param($packagePath,$destination)
                New-Item -ItemType Junction -Path $destination -Target $outsideAssets | Out-Null
            } } 'reparse|HELD|extraction root' 'extraction destination root junction is rejected before accepting outside assets'
        } finally { Remove-Item -LiteralPath $rootJunctionRoot -Recurse -Force -ErrorAction SilentlyContinue }
    } finally { Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue }
}

function Invoke-ProcessSpecsCase {
    Assert-True ($null -ne (Get-Command New-StructuredLogProcessSpecs -ErrorAction SilentlyContinue)) 'process spec function exists'
    $root = New-TestRoot 'specs'
    try {
        $ctx = New-TestContext $root
        Write-TestFile $ctx.FixturePath
        Write-TestFile $ctx.PythonExe
        Write-TestFile (Join-Path $root 'bim-streaming-server\repo.bat') 'build'
        New-TestKitAssets $root
        $ctx.Kit = Resolve-StructuredLogKitPrerequisites -Context $ctx -KitProvisionMode Build -ProcessInvoker { return 0 }
        $specs = @(New-StructuredLogProcessSpecs -Context $ctx)
        Assert-Equal 3 $specs.Count 'three owned participants'
        Assert-Equal 49104 ($specs | Where-Object name -eq 'conversion').port 'conversion alternate port'
        $conversion = $specs | Where-Object name -eq 'conversion'
        Assert-Equal $ctx.Kit.converter_config $conversion.env.STREAMING_CONVERSION_CONFIG_PATH 'conversion uses adapter-owned config env key'
        Assert-Equal (Join-Path $ctx.AttemptRoot 'c') $conversion.env.STREAMING_CONVERSION_SERVICE_ROOT 'conversion service root is short and attempt-local'
        Assert-Equal (Join-Path $ctx.AttemptRoot 'c\a') $conversion.env.STREAMING_CONVERSION_ARTIFACTS_ROOT 'conversion artifacts are short and attempt-local'
        Assert-Equal (Join-Path $ctx.AttemptRoot 'c\j') $conversion.env.STREAMING_CONVERSION_JOBS_DIR 'conversion jobs are short and attempt-local'
        $projectedModelPath = Join-Path $conversion.env.STREAMING_CONVERSION_ARTIFACTS_ROOT 'stream_conv_YYYYMMDDHHMMSS_12345678\model.usdc'
        Assert-True ([IO.Path]::GetFullPath($projectedModelPath).Length -lt 260) 'representative OpenUSD output stays below the Windows path budget'
        $longContext = $ctx.PSObject.Copy()
        $longContext.AttemptRoot = Join-Path $ctx.AttemptRoot ('x' * 80)
        Assert-Throws { New-StructuredLogProcessSpecs -Context $longContext } 'path budget|260|OpenUSD' 'over-budget OpenUSD output fails before process start'
        Assert-Equal 8005 ($specs | Where-Object name -eq 'coordinator').port 'coordinator alternate port'
        Assert-Equal 5175 ($specs | Where-Object name -eq 'viewer').port 'viewer alternate port'
        $viewer = $specs | Where-Object name -eq 'viewer'
        Assert-True ($viewer.argument_list -join ' ' -match '--strictPort') 'viewer strictPort enabled'
        Assert-Equal 'http://127.0.0.1:8005' $viewer.env.VITE_COORDINATOR_API_BASE 'viewer coordinator carrier is alternate coordinator, not Vite origin'
        Assert-Equal 'http://127.0.0.1:8005/api/internal/viewer-log' $viewer.viewer_log_endpoint 'viewer log endpoint is coordinator intake'
        Assert-True (($specs | ConvertTo-Json -Depth 8) -notmatch ':8004|:5173|:49101') 'no default participant ports'
    } finally { Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue }
}

function Invoke-OwnedStartLeaseCase {
    Assert-True ($null -ne (Get-Command Start-StructuredLogOwnedProcess -ErrorAction SilentlyContinue)) 'owned start function exists'
    $root = New-TestRoot 'lease'
    try {
        $ctx = New-TestContext $root
        $env:STRUCT_LOG_TEST_KEEP = 'parent'
        Remove-Item Env:STRUCT_LOG_TEST_NEW -ErrorAction SilentlyContinue
        $spec = [pscustomobject]@{ name='coordinator'; file_path='fake.exe'; argument_list=@('run'); cwd=$root; env=[ordered]@{ STRUCT_LOG_TEST_KEEP='child'; STRUCT_LOG_TEST_NEW='new' }; port=8005; health_uri='http://127.0.0.1:8005/health'; stdout_path=(Join-Path $ctx.AttemptRoot 'coordinator.stdout.log'); stderr_path=(Join-Path $ctx.AttemptRoot 'coordinator.stderr.log') }
        $startObserved = [pscustomobject]@{ Value = $false }
        $lease = Start-StructuredLogOwnedProcess -Context $ctx -ProcessSpec $spec -StartProcessInvoker {
            param($filePath, $argumentList, $cwd, $stdoutPath, $stderrPath)
            Assert-Equal 'child' $env:STRUCT_LOG_TEST_KEEP 'child env scoped during Start-Process'
            Assert-Equal 'new' $env:STRUCT_LOG_TEST_NEW 'new child env present during Start-Process'
            $startObserved.Value = $true
            [pscustomobject]@{ Id = 4242 }
        } -IdentityProvider {
            param($processId)
            [pscustomobject]@{ pid=$processId; parent_pid=$PID; path='C:\fake\fake.exe'; start_time_utc='2026-07-24T00:00:00.0000000Z' }
        }
        Assert-True $startObserved.Value 'Start-Process test seam invoked'
        Assert-Equal 4242 $lease.pid 'PassThru PID leased'
        Assert-Equal 'parent' $env:STRUCT_LOG_TEST_KEEP 'existing env restored'
        Assert-True (-not (Test-Path Env:STRUCT_LOG_TEST_NEW)) 'previously absent env removed after launch'
        $persisted = Get-Content -Raw $ctx.LeasePath | ConvertFrom-Json
        Assert-Equal 4242 $persisted.processes[0].pid 'identity persisted immediately'
        Assert-Equal '1' $persisted.schema_version 'lease schema version'
        Assert-True ($persisted.processes[0].env_keys -contains 'STRUCT_LOG_TEST_NEW') 'only env key names persisted'

        foreach($failureKind in @('identity','lease')) {
            $negativeRoot = New-TestRoot "lease-$failureKind"
            try {
                $negativeContext = New-TestContext $negativeRoot
                $handle = [pscustomobject]@{Id=if($failureKind -eq 'identity'){5001}else{5002}}
                $cleanup = [System.Collections.Generic.List[object]]::new()
                $identityProvider = if($failureKind -eq 'identity'){ { throw 'identity capture failed' } } else { { param($processId) [pscustomobject]@{pid=$processId;parent_pid=$PID;path='C:\fake\owned.exe';start_time_utc='2026-07-24T00:00:00Z'} } }
                $leaseWriter = if($failureKind -eq 'lease'){ { throw 'durable lease write failed' } } else { { param($path,$value) Write-StructuredLogJsonAtomic -Path $path -Value $value } }
                Assert-Throws {
                    Start-StructuredLogOwnedProcess -Context $negativeContext -ProcessSpec $spec -StartProcessInvoker { $handle } -IdentityProvider $identityProvider -LeaseWriter $leaseWriter -OwnedHandleCleanup { param($ownedHandle) $cleanup.Add($ownedHandle) }
                } 'failed|lease' "$failureKind failure is surfaced"
                Assert-Equal 1 $cleanup.Count "$failureKind failure cleans exactly one owned handle"
                Assert-True ([object]::ReferenceEquals($handle,$cleanup[0])) "$failureKind cleanup uses exact PassThru handle"
                Assert-True (-not(Test-Path -LiteralPath $negativeContext.LeasePath)) "$failureKind failure leaves no durable lease"
                Assert-True (-not(Test-Path -LiteralPath (Join-Path $negativeContext.AttemptRoot 'coordinator.pid'))) "$failureKind failure removes pidfile"
                Assert-Equal 'parent' $env:STRUCT_LOG_TEST_KEEP "$failureKind failure restores parent env"
                Assert-True (-not(Test-Path Env:STRUCT_LOG_TEST_NEW)) "$failureKind failure removes child env"
                $failureProvenance=Get-Content -LiteralPath $negativeContext.ProvenancePath|Select-Object -Last 1|ConvertFrom-Json
                Assert-Equal 'failed' $failureProvenance.status "$failureKind failure records provenance"
            } finally { Remove-Item -LiteralPath $negativeRoot -Recurse -Force -ErrorAction SilentlyContinue }
        }

        foreach ($cleanupFailureKind in @('callback-throw','still-alive')) {
            $quarantineRoot = New-TestRoot "lease-quarantine-$cleanupFailureKind"
            try {
                $quarantineContext = New-TestContext $quarantineRoot
                $quarantineHandle = [pscustomobject]@{Id=if($cleanupFailureKind -eq 'callback-throw'){6001}else{6002};HasExited=$false}
                $cleanupCalls = [pscustomobject]@{Value=0}
                $caught = $null
                try {
                    Start-StructuredLogOwnedProcess -Context $quarantineContext -ProcessSpec $spec -StartProcessInvoker { $quarantineHandle } -IdentityProvider {
                        param($processId)
                        [pscustomobject]@{pid=$processId;parent_pid=$PID;path="C:\fake\quarantine-$cleanupFailureKind.exe";start_time_utc='2026-07-24T00:00:00.0000000Z'}
                    } -LeaseWriter { throw 'durable lease write failed' } -OwnedHandleCleanup {
                        param($ownedHandle)
                        $cleanupCalls.Value++
                        if ($cleanupFailureKind -eq 'callback-throw') { throw 'cleanup callback failed' }
                    } | Out-Null
                } catch { $caught = $_ }
                Assert-True ($null -ne $caught) "$cleanupFailureKind cleanup failure is surfaced"
                Assert-True ([string]$caught.Exception.Message -match 'durable lease write failed' -and [string]$caught.Exception.Message -match 'cleanup|still running') "$cleanupFailureKind reports primary and cleanup failures"
                Assert-Equal 1 $cleanupCalls.Value "$cleanupFailureKind cleanup attempted exactly once"
                $quarantinePath = Join-Path $quarantineContext.AttemptRoot 'cleanup-quarantine.json'
                Assert-True (Test-Path -LiteralPath $quarantinePath -PathType Leaf) "$cleanupFailureKind writes durable quarantine evidence"
                $quarantine = Get-Content -Raw -LiteralPath $quarantinePath | ConvertFrom-Json
                Assert-Equal '1' $quarantine.schema_version "$cleanupFailureKind quarantine schema"
                Assert-Equal $quarantineContext.AttemptId $quarantine.attempt_id "$cleanupFailureKind quarantine attempt"
                Assert-Equal 'cleanup_failed' $quarantine.status "$cleanupFailureKind quarantine status cannot claim cleaned"
                Assert-Equal $quarantineHandle.Id $quarantine.entries[0].pid "$cleanupFailureKind quarantine PID"
                Assert-True (-not [string]::IsNullOrWhiteSpace([string]$quarantine.entries[0].path) -and -not [string]::IsNullOrWhiteSpace([string]$quarantine.entries[0].start_time_utc)) "$cleanupFailureKind preserves identity path/start"
                Assert-True (Test-Path -LiteralPath (Join-Path $quarantineContext.AttemptRoot 'coordinator.pid')) "$cleanupFailureKind preserves pidfile evidence"
                $emergencyLease = Get-Content -Raw -LiteralPath $quarantineContext.LeasePath | ConvertFrom-Json
                Assert-Equal $quarantineHandle.Id $emergencyLease.processes[0].pid "$cleanupFailureKind leaves identity for next reconcile"
                $stopped = [System.Collections.Generic.List[int]]::new()
                $identity = [pscustomobject]@{pid=[int]$quarantineHandle.Id;parent_pid=$PID;path=[string]$emergencyLease.processes[0].path;start_time_utc=$emergencyLease.processes[0].start_time_utc}
                $reconcileShutdown = Stop-StructuredLogOwnedProcesses -Context $quarantineContext -ProcessInventoryProvider { @($identity) } -StopProcessInvoker { param($processId) $stopped.Add([int]$processId) } -ListenerInspector { @() }
                Assert-Equal 1 $stopped.Count "$cleanupFailureKind emergency lease is actionable by next reconcile; entries=$($reconcileShutdown.entries|ConvertTo-Json -Compress -Depth 5)"
                Assert-Equal $quarantineHandle.Id $stopped[0] "$cleanupFailureKind next reconcile retains exact PID"
            } finally { Remove-Item -LiteralPath $quarantineRoot -Recurse -Force -ErrorAction SilentlyContinue }
        }

        $identityCleanupRoot = New-TestRoot 'identity-cleanup-complete-fallback'
        try {
            $identityCleanupContext = New-TestContext $identityCleanupRoot
            $identityCleanupHandle = [pscustomobject]@{Id=7001;HasExited=$false}
            $caught = $null
            try {
                Start-StructuredLogOwnedProcess -Context $identityCleanupContext -ProcessSpec $spec -StartProcessInvoker { $identityCleanupHandle } -IdentityProvider { throw 'identity capture failed' } -FallbackIdentityProvider {
                    param($ownedHandle)
                    Assert-True ([object]::ReferenceEquals($identityCleanupHandle,$ownedHandle)) 'fallback identity reads the exact PassThru handle'
                    [pscustomobject]@{pid=[int]$ownedHandle.Id;parent_pid=$PID;path='C:\fake\fallback-complete.exe';start_time_utc='2026-07-24T00:00:00.0000000Z'}
                } -OwnedHandleCleanup { throw 'cleanup callback failed' } | Out-Null
            } catch { $caught = $_ }
            Assert-True ($null -ne $caught -and [string]$caught.Exception.Message -match 'identity capture failed' -and [string]$caught.Exception.Message -match 'cleanup callback failed') 'identity+cleanup failure reports both errors'
            $completeQuarantine = Get-Content -Raw (Join-Path $identityCleanupContext.AttemptRoot 'cleanup-quarantine.json') | ConvertFrom-Json
            Assert-Equal 'cleanup_failed' $completeQuarantine.status 'complete fallback quarantine remains fail-closed'
            Assert-Equal 7001 $completeQuarantine.entries[0].pid 'complete fallback preserves PID'
            Assert-True (Test-Path -LiteralPath $identityCleanupContext.LeasePath) 'complete fallback writes emergency lease'
            Assert-True (Test-Path -LiteralPath (Join-Path $identityCleanupContext.AttemptRoot 'coordinator.pid')) 'complete fallback preserves pidfile'
            $completeLease = Get-Content -Raw $identityCleanupContext.LeasePath | ConvertFrom-Json
            $completeIdentity = [pscustomobject]@{pid=7001;parent_pid=$PID;path=[string]$completeLease.processes[0].path;start_time_utc=$completeLease.processes[0].start_time_utc}
            $completeStops = [System.Collections.Generic.List[int]]::new()
            Stop-StructuredLogOwnedProcesses -Context $identityCleanupContext -ProcessInventoryProvider { @($completeIdentity) } -StopProcessInvoker { param($processId) $completeStops.Add([int]$processId) } -ListenerInspector { @() } | Out-Null
            Assert-Equal 7001 $completeStops[0] 'complete fallback emergency identity is actionable by next reconcile'
        } finally { Remove-Item -LiteralPath $identityCleanupRoot -Recurse -Force -ErrorAction SilentlyContinue }

        $unavailableRoot = New-TestRoot 'identity-cleanup-unavailable'
        try {
            $unavailableContext = New-TestContext $unavailableRoot
            $unavailableHandle = [pscustomobject]@{Id=7002;HasExited=$false;Handle=12345}
            $caught = $null
            try {
                Start-StructuredLogOwnedProcess -Context $unavailableContext -ProcessSpec $spec -StartProcessInvoker { $unavailableHandle } -IdentityProvider { throw 'identity capture failed' } -FallbackIdentityProvider {
                    param($ownedHandle)
                    [pscustomobject]@{pid=[int]$ownedHandle.Id;path=$null;start_time_utc=$null;handle_type=$ownedHandle.GetType().FullName;has_exited=[bool]$ownedHandle.HasExited}
                } -OwnedHandleCleanup { } | Out-Null
            } catch { $caught = $_ }
            Assert-True ($null -ne $caught -and [string]$caught.Exception.Message -match 'identity capture failed' -and [string]$caught.Exception.Message -match 'still running|identity unavailable') 'identity+alive failure is explicit'
            $unavailableQuarantinePath = Join-Path $unavailableContext.AttemptRoot 'cleanup-quarantine.json'
            Assert-True (Test-Path -LiteralPath $unavailableQuarantinePath) 'incomplete fallback still writes durable quarantine'
            $unavailableQuarantine = Get-Content -Raw $unavailableQuarantinePath | ConvertFrom-Json
            Assert-Equal 'cleanup_failed_identity_unavailable' $unavailableQuarantine.status 'incomplete fallback cannot claim actionable identity'
            Assert-Equal $unavailableContext.AttemptId $unavailableQuarantine.attempt_id 'incomplete fallback preserves attempt'
            Assert-Equal 7002 $unavailableQuarantine.entries[0].pid 'incomplete fallback preserves available PID'
            Assert-Equal 8005 $unavailableQuarantine.entries[0].port 'incomplete fallback preserves requested port as evidence only'
            Assert-Equal $false $unavailableQuarantine.entries[0].handle_evidence.has_exited 'incomplete fallback preserves available handle state'
            Assert-True (-not (Test-Path -LiteralPath $unavailableContext.LeasePath)) 'incomplete fallback does not invent an actionable lease'

            $stateDir = Join-Path $unavailableRoot 'artifacts\spec-to-done\cross-service-structured-log-baseline'
            New-Item -ItemType Directory -Path $stateDir -Force | Out-Null
            @{schema_version='1';head_oid='old';attempt_id=$unavailableContext.AttemptId;attempt_root=$unavailableContext.AttemptRoot;status='running';started_utc='2026-07-24T00:00:00Z';lineage=@()} | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $stateDir 'active-attempt.json')
            $shutdownCalls = [pscustomobject]@{Value=0}
            $unsafe = Resolve-StructuredLogActiveAttempt -RepoRoot $unavailableRoot -HeadOid 'new' -ShutdownInvoker { $shutdownCalls.Value++; [pscustomobject]@{entries=@();foreign_listeners=@()} }
            Assert-Equal 'unsafe_running_identity' $unsafe.action 'identity-unavailable quarantine remains HELD on next reconcile'
            Assert-Equal 0 $shutdownCalls.Value 'identity-unavailable reconcile never attempts unsafe cleanup or kill-by-port'
        } finally { Remove-Item -LiteralPath $unavailableRoot -Recurse -Force -ErrorAction SilentlyContinue }
    } finally {
        $env:STRUCT_LOG_TEST_KEEP = $null
        Remove-Item Env:STRUCT_LOG_TEST_NEW -ErrorAction SilentlyContinue
        Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
    }
}

function Invoke-HealthSupportedSmokeCase {
    Assert-True ($null -ne (Get-Command Wait-StructuredLogHealth -ErrorAction SilentlyContinue)) 'health function exists'
    Assert-True ($null -ne (Get-Command Invoke-StructuredLogSupportedSmoke -ErrorAction SilentlyContinue)) 'supported smoke function exists'
    $root = New-TestRoot 'health'
    try {
        $ctx = New-TestContext $root
        Write-TestFile (Join-Path $root 'scripts\smoke-bscheme-intake.ps1') @'
param(
    [string] $EvidencePath,
    [string] $StorageRoot,
    [string] $CoordinatorBaseUrl,
    [string] $StreamingConversionApiBase,
    [int] $LivePollSeconds,
    [string] $StructLogRoot,
    [string] $BrowserArtifactDir,
    [ValidateSet('auto','owned_runtime')] [string] $ExecutionProfile,
    [switch] $SkipVerificationTiers,
    [switch] $SkipKitLauncher
)
Write-Output 'child stdout that must not become the exit code'
@{ schema_version='demo-runtime-readiness-smoke/v1'; context=@{execution_mode='production'}; tiers=@(@{tier='real_ifc_intake_conversion';status='passed';blocker='';ids=@{ifc_ready_job_id='ifcready_default';conversion_job_id='conv_default';kit_instance_id='kit_default'};detail=@{execution_mode='production';root_trace_id='ifcready_default';review_session_id='session_default';browser_status='passed';close_status='closed';close_origin='browser';browser_artifacts=@{root_trace_id='ifcready_default';review_session_id='session_default';conversion_job_id='conv_default';kit_instance_id='kit_default';state_transitions=@('ready','flush_loading','flush_failure','retry_loading','flush_success','close_loading','closed');failure_provenance='playwright_intercepted_503';forced_viewer_log_statuses=@(503,503,503);retry_viewer_log_status=200;close_http_status=200;artifacts=@{failure_screenshot=@{path='browser/structured-log-failure.png'};final_screenshot=@{path='browser/structured-log-success-closed.png'};playwright_trace=@{path='browser/structured-log-trace.zip'};console_events=@{path='browser/structured-log-console.json'};network_events=@{path='browser/structured-log-network.json'};operability=@{path='browser/structured-log-operability.json'}}}}}) } | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $EvidencePath
exit 0
'@
        $specs = @(
            [pscustomobject]@{name='conversion';health_uri='http://127.0.0.1:49104/health'},
            [pscustomobject]@{name='coordinator';health_uri='http://127.0.0.1:8005/health'},
            [pscustomobject]@{name='viewer';health_uri='http://127.0.0.1:5175/'}
        )
        $health = Wait-StructuredLogHealth -Context $ctx -ProcessSpecs $specs -RequestInvoker { param($uri) [pscustomobject]@{StatusCode=200} } -TimeoutSeconds 1
        Assert-Equal 3 $health.probes.Count 'all three alternate endpoints probed'
        Assert-True (@($health.probes | Where-Object status -ne 'passed').Count -eq 0) 'all health probes pass'
        Assert-True (Test-Path (Join-Path $ctx.AttemptRoot 'health.json')) 'health artifact written'
        $healthProvenance = @(Get-Content -LiteralPath $ctx.ProvenancePath | ForEach-Object { $_ | ConvertFrom-Json } | Where-Object phase -eq 'health_probe')
        Assert-Equal 3 $healthProvenance.Count 'each health probe has one provenance record'
        Assert-Equal 'GET http://127.0.0.1:49104/health,GET http://127.0.0.1:8005/health,GET http://127.0.0.1:5175/' (@($healthProvenance.command) -join ',') 'health provenance records exact safe commands'
        Assert-True (@($healthProvenance | Where-Object { $_.cwd -cne $ctx.RepoRoot -or $_.status -cne 'passed' -or [int]$_.exit_code -ne 200 }).Count -eq 0) 'health success provenance records cwd/status/exit'
        Assert-True (@($healthProvenance | Where-Object { [string]::IsNullOrWhiteSpace([string]$_.started_utc) -or [string]::IsNullOrWhiteSpace([string]$_.ended_utc) }).Count -eq 0) 'health success provenance records start/end times'

        $failureRoot = New-TestRoot 'health-failure'
        try {
            $failureContext = New-TestContext $failureRoot
            $failureSpec = @([pscustomobject]@{name='conversion';health_uri='http://127.0.0.1:49104/health'})
            Assert-Throws { Wait-StructuredLogHealth -Context $failureContext -ProcessSpecs $failureSpec -RequestInvoker { throw 'dev-internal-token=super-secret' } -TimeoutSeconds 1 } 'HELD|health' 'failed health is surfaced'
            $failedHealthProvenance = Get-Content -LiteralPath $failureContext.ProvenancePath | Select-Object -Last 1 | ConvertFrom-Json
            Assert-Equal 'health_probe' $failedHealthProvenance.phase 'health failure phase'
            Assert-Equal 'GET http://127.0.0.1:49104/health' $failedHealthProvenance.command 'health failure command is exact and redacted'
            Assert-Equal $failureContext.RepoRoot $failedHealthProvenance.cwd 'health failure cwd'
            Assert-Equal 'failed' $failedHealthProvenance.status 'health failure status'
            Assert-True ($null -eq $failedHealthProvenance.exit_code) 'health transport failure has null exit'
            Assert-True (-not [string]::IsNullOrWhiteSpace([string]$failedHealthProvenance.started_utc) -and -not [string]::IsNullOrWhiteSpace([string]$failedHealthProvenance.ended_utc)) 'health failure records start/end times'
            $failedHealthRaw = Get-Content -Raw -LiteralPath $failureContext.ProvenancePath
            Assert-True ($failedHealthRaw -notmatch 'super-secret|dev-internal-token') 'health provenance never records exception secret values'
        } finally { Remove-Item -LiteralPath $failureRoot -Recurse -Force -ErrorAction SilentlyContinue }

        $env:LOG_ROOT = 'parent-log-root'
        $smoke = Invoke-StructuredLogSupportedSmoke -Context $ctx -LivePollSeconds 3 -SmokeInvoker {
            param($scriptPath, $arguments)
            Assert-Equal $ctx.LogRoot $env:LOG_ROOT 'supported smoke receives scoped LOG_ROOT'
            $profileIndex = [Array]::IndexOf($arguments, '-ExecutionProfile')
            Assert-True ($profileIndex -ge 0) 'supported smoke declares owned runtime execution profile'
            Assert-Equal 'owned_runtime' $arguments[$profileIndex + 1] 'supported smoke uses owned runtime profile'
            Assert-True ($arguments -contains '-SkipVerificationTiers') 'owned runtime skips nested verification tiers'
            Write-TestSmokeEvidence -Path (Join-Path $ctx.AttemptRoot 'bscheme-readiness.json')
            return 0
        }
        Assert-Equal 0 $smoke.exit_code 'supported smoke succeeds'
        Assert-Equal 'parent-log-root' $env:LOG_ROOT 'parent LOG_ROOT restored'

        Remove-Item -LiteralPath (Join-Path $ctx.AttemptRoot 'bscheme-readiness.json') -Force
        $defaultSmoke = Invoke-StructuredLogSupportedSmoke -Context $ctx -LivePollSeconds 3
        Assert-Equal 0 $defaultSmoke.exit_code 'default smoke child stdout does not contaminate scalar exit code'
        Assert-True (Test-Path -LiteralPath $defaultSmoke.evidence_path -PathType Leaf) 'default smoke still produces readiness evidence'

        foreach ($negative in @(
            [pscustomobject]@{Name='blocked';Status='blocked';Mode='production';Count=1;Mutation='none';Pattern='status|passed|blocked'},
            [pscustomobject]@{Name='missing';Status='passed';Mode='production';Count=0;Mutation='none';Pattern='exactly one|tier'},
            [pscustomobject]@{Name='duplicate';Status='passed';Mode='production';Count=2;Mutation='none';Pattern='exactly one|tier'},
            [pscustomobject]@{Name='test-double';Status='passed';Mode='test_double';Count=1;Mutation='none';Pattern='context-execution-mode|tier-execution-mode'},
            [pscustomobject]@{Name='root-mismatch';Status='passed';Mode='production';Count=1;Mutation='root_mismatch';Pattern='ifc-ready-job-id'},
            [pscustomobject]@{Name='ambiguous-conversion';Status='passed';Mode='production';Count=1;Mutation='ambiguous_conversion';Pattern='ambiguous-conversion_job_id'},
            [pscustomobject]@{Name='ambiguous-review';Status='passed';Mode='production';Count=1;Mutation='ambiguous_review';Pattern='ambiguous-review_session_id'},
            [pscustomobject]@{Name='browser-failed';Status='passed';Mode='production';Count=1;Mutation='browser_failed';Pattern='browser-status'},
            [pscustomobject]@{Name='close-failed';Status='passed';Mode='production';Count=1;Mutation='close_failed';Pattern='close-status'},
            [pscustomobject]@{Name='kit-missing';Status='passed';Mode='production';Count=1;Mutation='kit_missing';Pattern='kit-instance-id'},
            [pscustomobject]@{Name='runner-close';Status='passed';Mode='production';Count=1;Mutation='close_origin';Pattern='close-origin'}
        )) {
            $provenanceBefore = @(Get-Content -LiteralPath $ctx.ProvenancePath).Count
            Assert-Throws {
                Invoke-StructuredLogSupportedSmoke -Context $ctx -LivePollSeconds 3 -SmokeInvoker {
                    param($scriptPath, $arguments)
                    Write-TestSmokeEvidence -Path (Join-Path $ctx.AttemptRoot 'bscheme-readiness.json') -TierStatus $negative.Status -ExecutionMode $negative.Mode -TierCount $negative.Count -Mutation $negative.Mutation
                    return 0
                }
            } $negative.Pattern "exit zero $($negative.Name) readiness is rejected"
            $negativeProvenance = @(Get-Content -LiteralPath $ctx.ProvenancePath | ForEach-Object { $_ | ConvertFrom-Json })
            Assert-Equal ($provenanceBefore + 1) $negativeProvenance.Count "$($negative.Name) adds exactly one provenance record"
            Assert-Equal 'failed' $negativeProvenance[-1].status "$($negative.Name) readiness records failed provenance without a later success"
        }

        Assert-Throws { Invoke-StructuredLogSupportedSmoke -Context $ctx -LivePollSeconds 3 -SmokeInvoker { throw 'native failure' } } 'native failure' 'native smoke failure is surfaced'
        $last = Get-Content -LiteralPath $ctx.ProvenancePath | Select-Object -Last 1 | ConvertFrom-Json
        Assert-Equal 'failed' $last.status 'native failure recorded in provenance'
    } finally {
        $env:LOG_ROOT = $null
        Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
    }
}

function Invoke-IdentityShutdownCase {
    Assert-True ($null -ne (Get-Command Stop-StructuredLogOwnedProcesses -ErrorAction SilentlyContinue)) 'identity shutdown exists'
    $root = New-TestRoot 'shutdown'
    try {
        $ctx = New-TestContext $root
        @{schema_version='1';attempt_id=$ctx.AttemptId;processes=@(
            @{name='parent';pid=100;parent_pid=$PID;path='C:\owned\parent.exe';start_time_utc='2026-07-24T00:00:00.0000000Z';cwd=$root;port=8005;pidfile='parent.pid'},
            @{name='foreign';pid=200;parent_pid=$PID;path='C:\owned\foreign.exe';start_time_utc='2026-07-24T00:00:00.0000000Z';cwd=$root;port=5175;pidfile='foreign.pid'}
        )}|ConvertTo-Json -Depth 8|Set-Content -LiteralPath $ctx.LeasePath
        $stopped = [System.Collections.Generic.List[int]]::new()
        $inventory = {
            @(
                [pscustomobject]@{pid=100;parent_pid=$PID;path='C:\owned\parent.exe';start_time_utc='2026-07-24T00:00:00.0000000Z'},
                [pscustomobject]@{pid=101;parent_pid=100;path='C:\owned\child.exe';start_time_utc='2026-07-24T00:00:01.0000000Z'},
                [pscustomobject]@{pid=200;parent_pid=$PID;path='C:\foreign\different.exe';start_time_utc='2026-07-24T00:00:00.0000000Z'}
            )
        }
        $result = Stop-StructuredLogOwnedProcesses -Context $ctx -ProcessInventoryProvider $inventory -StopProcessInvoker { param($processId) $stopped.Add([int]$processId) } -ListenerInspector { param($port) if($port -eq 5175){@([pscustomobject]@{pid=200;path='C:\foreign\different.exe'})}else{@()} }
        $stoppedEntries = @($result.entries | Where-Object { $_.action -eq 'stop_owned' -and $_.result -eq 'stopped' })
        $stoppedIds = @($stoppedEntries | ForEach-Object { [string]$_.pid })
        Assert-Equal '101,100' ($stoppedIds -join ',') "owned descendants stop child-first and root-last; entries=$($result.entries | ConvertTo-Json -Compress -Depth 5)"
        Assert-True (@($result.entries | Where-Object { $_.pid -eq 200 -and $_.action -eq 'stop_owned' }).Count -eq 0) 'identity mismatch is never stopped'
        Assert-True ($result.foreign_listeners.Count -eq 1) 'foreign listener only reported'
        $again = Stop-StructuredLogOwnedProcesses -Context $ctx -ProcessInventoryProvider { @() } -StopProcessInvoker { throw 'idempotent shutdown must not stop' } -ListenerInspector { @() }
        Assert-True ($again.entries.Count -ge 2) 'idempotent shutdown still reports lease entries'

        @{schema_version='1';attempt_id=$ctx.AttemptId;processes=@(
            @{name='disappearing-tree';pid=300;parent_pid=$PID;path='C:\owned\parent.exe';start_time_utc='2026-07-24T00:00:00.0000000Z';cwd=$root;port=8005;pidfile='parent.pid'}
        )}|ConvertTo-Json -Depth 8|Set-Content -LiteralPath $ctx.LeasePath
        $disappearingInventoryCall = [pscustomobject]@{ Value = 0 }
        $disappearingInventory = {
            $disappearingInventoryCall.Value++
            if ($disappearingInventoryCall.Value -eq 1) {
                return @(
                    [pscustomobject]@{pid=300;parent_pid=$PID;path='C:\owned\parent.exe';start_time_utc='2026-07-24T00:00:00.0000000Z'},
                    [pscustomobject]@{pid=301;parent_pid=300;path='C:\owned\child.exe';start_time_utc='2026-07-24T00:00:01.0000000Z'}
                )
            }
            return @([pscustomobject]@{pid=300;parent_pid=$PID;path='C:\owned\parent.exe';start_time_utc='2026-07-24T00:00:00.0000000Z'})
        }
        $disappearingStopped = [System.Collections.Generic.List[int]]::new()
        $disappearingResult = Stop-StructuredLogOwnedProcesses -Context $ctx -ProcessInventoryProvider $disappearingInventory -StopProcessInvoker { param($processId) $disappearingStopped.Add([int]$processId) } -ListenerInspector { @() }
        Assert-Equal 'not_running' ($disappearingResult.entries | Where-Object pid -eq 301).result 'child that disappears before cleanup is already not running'
        Assert-True (-not $disappearingStopped.Contains(301)) 'disappeared child is never passed to StopProcessInvoker'
        Assert-Equal '300' (($disappearingStopped | ForEach-Object { [string]$_ }) -join ',') 'remaining identity-matched root is still stopped'
        Assert-Equal 'succeeded' $disappearingResult.status 'disappeared child does not make owned shutdown fail'

        @{schema_version='1';attempt_id=$ctx.AttemptId;processes=@(
            @{name='changed-tree';pid=400;parent_pid=$PID;path='C:\owned\parent.exe';start_time_utc='2026-07-24T00:00:00.0000000Z';cwd=$root;port=8005;pidfile='parent.pid'}
        )}|ConvertTo-Json -Depth 8|Set-Content -LiteralPath $ctx.LeasePath
        $changedInventoryCall = [pscustomobject]@{ Value = 0 }
        $changedInventory = {
            $changedInventoryCall.Value++
            if ($changedInventoryCall.Value -eq 1) {
                return @(
                    [pscustomobject]@{pid=400;parent_pid=$PID;path='C:\owned\parent.exe';start_time_utc='2026-07-24T00:00:00.0000000Z'},
                    [pscustomobject]@{pid=401;parent_pid=400;path='C:\owned\child.exe';start_time_utc='2026-07-24T00:00:01.0000000Z'}
                )
            }
            if ($changedInventoryCall.Value -eq 2) {
                return @(
                    [pscustomobject]@{pid=400;parent_pid=$PID;path='C:\owned\parent.exe';start_time_utc='2026-07-24T00:00:00.0000000Z'},
                    [pscustomobject]@{pid=401;parent_pid=400;path='C:\foreign\reused.exe';start_time_utc='2026-07-24T00:00:02.0000000Z'}
                )
            }
            return @([pscustomobject]@{pid=400;parent_pid=$PID;path='C:\owned\parent.exe';start_time_utc='2026-07-24T00:00:00.0000000Z'})
        }
        $changedStopped = [System.Collections.Generic.List[int]]::new()
        $changedResult = Stop-StructuredLogOwnedProcesses -Context $ctx -ProcessInventoryProvider $changedInventory -StopProcessInvoker { param($processId) $changedStopped.Add([int]$processId) } -ListenerInspector { @() }
        Assert-Equal 'identity_changed' ($changedResult.entries | Where-Object pid -eq 401).result 'same PID with changed path/start remains unsafe'
        Assert-True (-not $changedStopped.Contains(401)) 'identity-changed child is never stopped'
        Assert-True ($changedStopped.Contains(400)) 'remaining identity-matched root is still stopped after child mismatch'
        Assert-Equal 'failed' $changedResult.status 'identity-changed child keeps shutdown failed'
    } finally { Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue }
}

function Invoke-ArtifactRendererCase {
    Assert-True ($null -ne (Get-Command Write-StructuredLogEvidenceArtifacts -ErrorAction SilentlyContinue)) 'artifact renderer exists'
    Assert-True ($null -ne (Get-Command Test-StructuredLogArtifactManifest -ErrorAction SilentlyContinue)) 'artifact hash validator exists'
    $root = New-TestRoot 'artifacts'
    try {
        $ctx = New-TestContext $root
        $now = '2026-07-24T00:00:00.0000000Z'
        @{schema_version='1';machine_name='test';os_version='test';pwsh_version='7.5';process_architecture='X64'}|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $ctx.AttemptRoot 'machine.json')
        @{schema_version='1';name='model.ifc';size_bytes=3;sha256=('a'*64);source_path='C:\fixture\model.ifc';attempt_copy=$ctx.FixturePath}|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $ctx.AttemptRoot 'fixture.json')
        @{schema_version='1';probes=@(@{name='coordinator';uri='http://127.0.0.1:8005/health';started_utc=$now;ended_utc=$now;status='passed';http_status=200;error_type=$null})}|ConvertTo-Json -Depth 8|Set-Content -LiteralPath (Join-Path $ctx.AttemptRoot 'health.json')
        @{schema_version='1';attempt_id=$ctx.AttemptId;processes=@()}|ConvertTo-Json|Set-Content -LiteralPath $ctx.LeasePath
        @{schema_version='1';attempt_id=$ctx.AttemptId;status='succeeded';entries=@();foreign_listeners=@()}|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $ctx.AttemptRoot 'shutdown.json')
        [ordered]@{seq=1;ts_utc=$now;started_utc=$now;ended_utc=$now;phase='test';command='test';cwd=$root;status='passed';exit_code=0}|ConvertTo-Json -Compress|Set-Content -LiteralPath $ctx.ProvenancePath
        New-TestCanonicalReadiness | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath (Join-Path $ctx.AttemptRoot 'bscheme-readiness.json')
        Write-TestBrowserArtifacts -AttemptRoot $ctx.AttemptRoot
        $report = Write-StructuredLogEvidenceArtifacts -Context $ctx -ValidatorInvoker {
            param($python, $arguments, $outputPath)
            @{schema_version='1';status='passed';files=@('scripts/x.jsonl');line_counts=@{};event_counts=@{};violations=@();redaction_violations=@()}|ConvertTo-Json -Depth 8|Set-Content -LiteralPath $outputPath
            return 0
        }
        Assert-Equal 'succeeded' $report.status 'renderer status'
        foreach($name in @('root-trace-timeline.json','runtime-log-validation.json','artifact-manifest.json','pr-fields.json','evidence-summary.md')) {
            Assert-True (Test-Path (Join-Path $ctx.AttemptRoot $name)) "$name rendered"
        }
        $summaryLines = @(Get-Content -LiteralPath (Join-Path $ctx.AttemptRoot 'evidence-summary.md'))
        $rootTraceLines = @($summaryLines | Where-Object { $_ -like 'Root trace:*' })
        Assert-Equal 1 $rootTraceLines.Count 'summary has exactly one root trace line'
        Assert-Equal 'Root trace: `ifcready_root`. See `root-trace-timeline.json`.' $rootTraceLines[0] 'summary root trace line is exact'
        Assert-True ($rootTraceLines[0] -notmatch '\$rootTraceId') 'summary root trace line does not contain the literal variable name'
        Assert-True ($rootTraceLines[0] -notmatch '[\x00-\x1F\x7F]') 'summary root trace line contains no control characters'
        $check = Test-StructuredLogArtifactManifest -AttemptRoot $ctx.AttemptRoot
        Assert-True $check.valid 'fresh artifact hashes validate'
        $validatorProvenance = @(Get-Content -LiteralPath $ctx.ProvenancePath | ForEach-Object { $_ | ConvertFrom-Json } | Where-Object { $null -ne $_.PSObject.Properties['phase'] -and $_.phase -eq 'runtime_validator' })
        Assert-Equal 1 $validatorProvenance.Count 'canonical validator success has one provenance record'
        Assert-Equal 'python validate_runtime_logs.py --log-root <attempt-log-root> --trace-id <root-trace-id> --require-services coordinator streaming-server viewer scripts --output runtime-log-validation.json' $validatorProvenance[0].command 'validator command is exact and redacted'
        Assert-Equal $ctx.RepoRoot $validatorProvenance[0].cwd 'validator success cwd'
        Assert-Equal 'passed' $validatorProvenance[0].status 'validator success status'
        Assert-Equal 0 $validatorProvenance[0].exit_code 'validator success exit'
        Assert-True (-not [string]::IsNullOrWhiteSpace([string]$validatorProvenance[0].started_utc) -and -not [string]::IsNullOrWhiteSpace([string]$validatorProvenance[0].ended_utc)) 'validator success start/end times'
        Assert-True ((Get-Content -Raw -LiteralPath $ctx.ProvenancePath) -notmatch [regex]::Escape($ctx.LogRoot)) 'validator provenance omits attempt environment values'
        $manifestPath = Join-Path $ctx.AttemptRoot 'artifact-manifest.json'
        $baseline = Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json
        Assert-Equal '1' $baseline.schema_version 'manifest schema version is canonical'
        Assert-Equal $ctx.AttemptId $baseline.attempt_id 'manifest attempt identity is canonical'
        Assert-Equal 'succeeded' $baseline.status 'manifest status is canonical'
        Assert-Equal ((Get-TestRequiredArtifactNames | Sort-Object) -join ',') (@($baseline.files.path | Sort-Object) -join ',') 'manifest contains the exact required artifact set'
        Assert-True (@($baseline.files | Where-Object { [string]$_.sha256 -notmatch '^[0-9a-f]{64}$' }).Count -eq 0) 'all manifest hashes are canonical SHA-256'
        Assert-True (@($baseline.files | Where-Object { [int64]$_.size_bytes -le 0 }).Count -eq 0) 'all manifest entries bind a positive artifact size'
        Assert-Equal 'browser/structured-log-failure.png' $report.screenshot_trace.failure_screenshot 'manifest projects the failure screenshot by role'
        Assert-Equal 'browser/structured-log-success-closed.png' $report.screenshot_trace.final_screenshot 'manifest projects the final screenshot by role'
        Assert-Equal 'browser/structured-log-operability.json' $report.browser_evidence.operability 'manifest projects machine-readable browser evidence'

        $writeMutation = {
            param($value)
            $value | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $manifestPath -Encoding utf8
            $result = Test-StructuredLogArtifactManifest -AttemptRoot $ctx.AttemptRoot
            Assert-True (-not $result.valid) 'invalid manifest mutation is rejected'
        }

        $mutation = $baseline | ConvertTo-Json -Depth 10 | ConvertFrom-Json
        $mutation.files[0].path = (Join-Path $ctx.AttemptRoot 'attempt-manifest.json')
        & $writeMutation $mutation

        $mutation = $baseline | ConvertTo-Json -Depth 10 | ConvertFrom-Json
        $mutation.files[0].path = '..\escape.json'
        & $writeMutation $mutation

        $mutation = $baseline | ConvertTo-Json -Depth 10 | ConvertFrom-Json
        $mutation.files[1].path = '.\attempt-manifest.json'
        & $writeMutation $mutation

        $mutation = $baseline | ConvertTo-Json -Depth 10 | ConvertFrom-Json
        $mutation.files[0].path = ''
        & $writeMutation $mutation

        $mutation = $baseline | ConvertTo-Json -Depth 10 | ConvertFrom-Json
        $mutation.files = @($mutation.files | Select-Object -Skip 1)
        & $writeMutation $mutation

        $mutation = $baseline | ConvertTo-Json -Depth 10 | ConvertFrom-Json
        $mutation.attempt_id = 'wrong-attempt'
        & $writeMutation $mutation

        $mutation = $baseline | ConvertTo-Json -Depth 10 | ConvertFrom-Json
        $mutation.files[0].sha256 = 'not-a-sha256'
        & $writeMutation $mutation

        $mutation = $baseline | ConvertTo-Json -Depth 10 | ConvertFrom-Json
        $mutation.files[0].size_bytes = [int64]$mutation.files[0].size_bytes + 1
        & $writeMutation $mutation

        $baseline | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $manifestPath -Encoding utf8
        Add-Content -LiteralPath (Join-Path $ctx.AttemptRoot 'health.json') -Value 'tamper'
        Assert-True (-not (Test-StructuredLogArtifactManifest -AttemptRoot $ctx.AttemptRoot).valid) 'tampered artifact rejected'
        $baseline | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $manifestPath -Encoding utf8
        Add-Content -LiteralPath (Join-Path $ctx.AttemptRoot 'browser\structured-log-operability.json') -Value 'browser-tamper'
        Assert-True (-not (Test-StructuredLogArtifactManifest -AttemptRoot $ctx.AttemptRoot).valid) 'tampered browser artifact rejected'
        $baseline | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $manifestPath -Encoding utf8
        Remove-Item -LiteralPath (Join-Path $ctx.AttemptRoot 'fixture.json') -Force
        Assert-True (-not (Test-StructuredLogArtifactManifest -AttemptRoot $ctx.AttemptRoot).valid) 'missing artifact rejected'

        $semanticRoot = New-TestRoot 'artifact-semantics'
        try {
            $semanticAttempt = Join-Path $semanticRoot 'attempt-semantic'
            New-Item -ItemType Directory -Path $semanticAttempt -Force | Out-Null
            Write-TestCompleteArtifactManifest -AttemptRoot $semanticAttempt -AttemptId 'attempt-semantic'
            Assert-True (Test-StructuredLogArtifactManifest -AttemptRoot $semanticAttempt).valid 'complete semantic fixture validates'
            foreach ($semanticCase in @(
                'malformed','version','wrong-attempt','shutdown-status','attempt-status','jsonl-seq','markdown-heading',
                'browser-operability-root','browser-operability-artifact-size','browser-operability-artifact-string','browser-operability-artifact-missing-field',
                'browser-network-forbidden','trace-network','trace-postdata','trace-authorization','trace-escaped-authorization','trace-query',
                'trace-escaped-unscoped-url','trace-screencast-event','trace-body-resource','trace-traversal','trace-duplicate','trace-symlink',
                'trace-oversize','trace-escaped-stack-key','trace-escaped-stack-path'
            )) {
                Write-TestCompleteArtifactManifest -AttemptRoot $semanticAttempt -AttemptId 'attempt-semantic'
                switch ($semanticCase) {
                    'malformed' { Set-Content -LiteralPath (Join-Path $semanticAttempt 'machine.json') -Value '{not-json'; Update-TestArtifactManifestHash $semanticAttempt 'machine.json' }
                    'version' { $value=Get-Content -Raw (Join-Path $semanticAttempt 'health.json')|ConvertFrom-Json;$value.schema_version='2';$value|ConvertTo-Json -Depth 8|Set-Content (Join-Path $semanticAttempt 'health.json');Update-TestArtifactManifestHash $semanticAttempt 'health.json' }
                    'wrong-attempt' { $value=Get-Content -Raw (Join-Path $semanticAttempt 'runtime-lease.json')|ConvertFrom-Json;$value.attempt_id='ATTEMPT-SEMANTIC';$value|ConvertTo-Json -Depth 8|Set-Content (Join-Path $semanticAttempt 'runtime-lease.json');Update-TestArtifactManifestHash $semanticAttempt 'runtime-lease.json' }
                    'shutdown-status' { $value=Get-Content -Raw (Join-Path $semanticAttempt 'shutdown.json')|ConvertFrom-Json;$value.status='unknown';$value|ConvertTo-Json -Depth 8|Set-Content (Join-Path $semanticAttempt 'shutdown.json');Update-TestArtifactManifestHash $semanticAttempt 'shutdown.json' }
                    'attempt-status' { $value=Get-Content -Raw (Join-Path $semanticAttempt 'attempt-manifest.json')|ConvertFrom-Json;$value.status='unknown';$value|ConvertTo-Json -Depth 8|Set-Content (Join-Path $semanticAttempt 'attempt-manifest.json');Update-TestArtifactManifestHash $semanticAttempt 'attempt-manifest.json' }
                    'jsonl-seq' { Add-Content -LiteralPath (Join-Path $semanticAttempt 'command-provenance.jsonl') -Value '{"seq":3,"ts_utc":"2026-07-24T00:00:01Z","started_utc":"2026-07-24T00:00:01Z","ended_utc":"2026-07-24T00:00:01Z","phase":"test","command":"test","cwd":"C:\\\\test","status":"passed","exit_code":0}';Update-TestArtifactManifestHash $semanticAttempt 'command-provenance.jsonl' }
                    'markdown-heading' { (Get-Content (Join-Path $semanticAttempt 'evidence-summary.md')|Where-Object {$_ -cne '## Verified facts'})|Set-Content (Join-Path $semanticAttempt 'evidence-summary.md');Update-TestArtifactManifestHash $semanticAttempt 'evidence-summary.md' }
                    'browser-operability-root' { $value=Get-Content -Raw (Join-Path $semanticAttempt 'browser\structured-log-operability.json')|ConvertFrom-Json;$value.root_trace_id='ifcready_other';$value|ConvertTo-Json -Depth 8|Set-Content (Join-Path $semanticAttempt 'browser\structured-log-operability.json');Update-TestArtifactManifestHash $semanticAttempt 'browser/structured-log-operability.json' }
                    'browser-operability-artifact-size' { $value=Get-Content -Raw (Join-Path $semanticAttempt 'browser\structured-log-operability.json')|ConvertFrom-Json;$value.artifacts.failure_screenshot.size_bytes=[int64]$value.artifacts.failure_screenshot.size_bytes+1;$value|ConvertTo-Json -Depth 8|Set-Content (Join-Path $semanticAttempt 'browser\structured-log-operability.json');Update-TestArtifactManifestHash $semanticAttempt 'browser/structured-log-operability.json' }
                    'browser-operability-artifact-string' { $value=Get-Content -Raw (Join-Path $semanticAttempt 'browser\structured-log-operability.json')|ConvertFrom-Json;$value.artifacts.playwright_trace='structured-log-trace.zip';$value|ConvertTo-Json -Depth 8|Set-Content (Join-Path $semanticAttempt 'browser\structured-log-operability.json');Update-TestArtifactManifestHash $semanticAttempt 'browser/structured-log-operability.json' }
                    'browser-operability-artifact-missing-field' { $value=Get-Content -Raw (Join-Path $semanticAttempt 'browser\structured-log-operability.json')|ConvertFrom-Json;$value.artifacts.playwright_trace.PSObject.Properties.Remove('sha256');$value|ConvertTo-Json -Depth 8|Set-Content (Join-Path $semanticAttempt 'browser\structured-log-operability.json');Update-TestArtifactManifestHash $semanticAttempt 'browser/structured-log-operability.json' }
                    'browser-network-forbidden' { $value=Get-Content -Raw (Join-Path $semanticAttempt 'browser\structured-log-network.json')|ConvertFrom-Json;$value.events[0]|Add-Member -Force NoteProperty headers @{authorization='redacted-but-forbidden'};$value|ConvertTo-Json -Depth 8|Set-Content (Join-Path $semanticAttempt 'browser\structured-log-network.json');Update-TestArtifactManifestHash $semanticAttempt 'browser/structured-log-network.json' }
                    'trace-network' { Write-TestPrivacyTrace -Path (Join-Path $semanticAttempt 'browser\structured-log-trace.zip') -NetworkContent '{"request":{"headers":[]}}';Update-TestBrowserArtifactBindings $semanticAttempt 'playwright_trace' 'structured-log-trace.zip' }
                    'trace-postdata' { Write-TestPrivacyTrace -Path (Join-Path $semanticAttempt 'browser\structured-log-trace.zip') -UnsafeProperty 'postData';Update-TestBrowserArtifactBindings $semanticAttempt 'playwright_trace' 'structured-log-trace.zip' }
                    'trace-authorization' { Write-TestPrivacyTrace -Path (Join-Path $semanticAttempt 'browser\structured-log-trace.zip') -UnsafeProperty 'authorization';Update-TestBrowserArtifactBindings $semanticAttempt 'playwright_trace' 'structured-log-trace.zip' }
                    'trace-escaped-authorization' { Write-TestPrivacyTrace -Path (Join-Path $semanticAttempt 'browser\structured-log-trace.zip') -AdditionalTraceLines '{"type":"input","callId":"call@2","\u0061uthorization":"test-only-forbidden-value"}';Update-TestBrowserArtifactBindings $semanticAttempt 'playwright_trace' 'structured-log-trace.zip' }
                    'trace-query' { Write-TestPrivacyTrace -Path (Join-Path $semanticAttempt 'browser\structured-log-trace.zip') -Url 'http://127.0.0.1:8005/ui/open?session=review_session_1&trace_id=ifcready_root&access_token=test-only';Update-TestBrowserArtifactBindings $semanticAttempt 'playwright_trace' 'structured-log-trace.zip' }
                    'trace-escaped-unscoped-url' { Write-TestPrivacyTrace -Path (Join-Path $semanticAttempt 'browser\structured-log-trace.zip') -AdditionalTraceLines '{"type":"input","callId":"call@2","value":"https:\/\/evil.test\/secret"}';Update-TestBrowserArtifactBindings $semanticAttempt 'playwright_trace' 'structured-log-trace.zip' }
                    'trace-screencast-event' { Write-TestPrivacyTrace -Path (Join-Path $semanticAttempt 'browser\structured-log-trace.zip') -AdditionalTraceLines '{"type":"screencast-frame","pageId":"page@1","sha1":"page@test-1.jpeg"}';Update-TestBrowserArtifactBindings $semanticAttempt 'playwright_trace' 'structured-log-trace.zip' }
                    'trace-body-resource' { $extra=[pscustomobject]@{Name='resources/response-body.json';Bytes=[Text.Encoding]::UTF8.GetBytes('{}')};Write-TestPrivacyTrace -Path (Join-Path $semanticAttempt 'browser\structured-log-trace.zip') -AdditionalEntries @($extra);Update-TestBrowserArtifactBindings $semanticAttempt 'playwright_trace' 'structured-log-trace.zip' }
                    'trace-traversal' { $extra=[pscustomobject]@{Name='../outside.txt';Bytes=[Text.Encoding]::UTF8.GetBytes('x')};Write-TestPrivacyTrace -Path (Join-Path $semanticAttempt 'browser\structured-log-trace.zip') -AdditionalEntries @($extra);Update-TestBrowserArtifactBindings $semanticAttempt 'playwright_trace' 'structured-log-trace.zip' }
                    'trace-duplicate' { $extra=[pscustomobject]@{Name='TRACE.TRACE';Bytes=[Text.Encoding]::UTF8.GetBytes('{}')};Write-TestPrivacyTrace -Path (Join-Path $semanticAttempt 'browser\structured-log-trace.zip') -AdditionalEntries @($extra);Update-TestBrowserArtifactBindings $semanticAttempt 'playwright_trace' 'structured-log-trace.zip' }
                    'trace-symlink' { Write-TestPrivacyTrace -Path (Join-Path $semanticAttempt 'browser\structured-log-trace.zip') -StacksExternalAttributes -1610612736;Update-TestBrowserArtifactBindings $semanticAttempt 'playwright_trace' 'structured-log-trace.zip' }
                    'trace-oversize' { Write-TestPrivacyTrace -Path (Join-Path $semanticAttempt 'browser\structured-log-trace.zip') -StacksBytes ([byte[]]::new(5MB + 1));Update-TestBrowserArtifactBindings $semanticAttempt 'playwright_trace' 'structured-log-trace.zip' }
                    'trace-escaped-stack-key' { Write-TestPrivacyTrace -Path (Join-Path $semanticAttempt 'browser\structured-log-trace.zip') -StacksBytes ([Text.Encoding]::UTF8.GetBytes('{"files":["playwright-helper-0.mjs"],"stacks":[],"\u0061uthorization":"test-only-forbidden-value"}'));Update-TestBrowserArtifactBindings $semanticAttempt 'playwright_trace' 'structured-log-trace.zip' }
                    'trace-escaped-stack-path' { Write-TestPrivacyTrace -Path (Join-Path $semanticAttempt 'browser\structured-log-trace.zip') -StacksBytes ([Text.Encoding]::UTF8.GetBytes('{"files":["C:\u005cprivate\u005chelper.mjs"],"stacks":[]}'));Update-TestBrowserArtifactBindings $semanticAttempt 'playwright_trace' 'structured-log-trace.zip' }
                }
                Assert-True (-not (Test-StructuredLogArtifactManifest -AttemptRoot $semanticAttempt).valid) "$semanticCase semantic corruption is rejected even with a matching hash"
            }

            Write-TestCompleteArtifactManifest -AttemptRoot $semanticAttempt -AttemptId 'attempt-semantic'
            $outsideBrowser = Join-Path $semanticRoot 'outside-browser'
            Move-Item -LiteralPath (Join-Path $semanticAttempt 'browser') -Destination $outsideBrowser
            $browserJunction = Join-Path $semanticAttempt 'browser'
            try {
                New-Item -ItemType Junction -Path $browserJunction -Target $outsideBrowser | Out-Null
                $reparseResult = Test-StructuredLogArtifactManifest -AttemptRoot $semanticAttempt
                Assert-True (-not $reparseResult.valid) 'browser artifact reparse ancestor is rejected even when hashes match'
                Assert-True (@($reparseResult.errors | Where-Object { $_ -like 'reparse:browser/*' }).Count -gt 0) 'browser reparse rejection is explicit'
            } finally {
                if (Test-Path -LiteralPath $browserJunction) { Remove-Item -LiteralPath $browserJunction -Force }
            }

            $readinessCases = @(
                [pscustomobject]@{Name='schema';Error='readiness:schema-version'},
                [pscustomobject]@{Name='missing-tier';Error='readiness:live-tier-count'},
                [pscustomobject]@{Name='duplicate-tier';Error='readiness:live-tier-count'},
                [pscustomobject]@{Name='tier-status';Error='readiness:live-tier-status'},
                [pscustomobject]@{Name='context-mode';Error='readiness:context-execution-mode'},
                [pscustomobject]@{Name='detail-mode';Error='readiness:tier-execution-mode'},
                [pscustomobject]@{Name='root-missing-with-decoy';Error='readiness:root-trace-id'},
                [pscustomobject]@{Name='root-invalid';Error='readiness:root-trace-id'},
                [pscustomobject]@{Name='root-mismatch';Error='readiness:ifc-ready-job-id'},
                [pscustomobject]@{Name='root-ambiguous';Error='readiness:ambiguous-root_trace_id'},
                [pscustomobject]@{Name='ifc-ready-ambiguous';Error='readiness:ambiguous-ifc_ready_job_id'},
                [pscustomobject]@{Name='conversion-missing';Error='readiness:conversion-job-id'},
                [pscustomobject]@{Name='conversion-ambiguous';Error='readiness:ambiguous-conversion_job_id'},
                [pscustomobject]@{Name='review-missing';Error='readiness:review-session-id'},
                [pscustomobject]@{Name='review-ambiguous';Error='readiness:ambiguous-review_session_id'},
                [pscustomobject]@{Name='browser';Error='readiness:browser-status'},
                [pscustomobject]@{Name='close';Error='readiness:close-status'},
                [pscustomobject]@{Name='close-origin';Error='readiness:close-origin'},
                [pscustomobject]@{Name='kit-missing';Error='readiness:kit-instance-id'},
                [pscustomobject]@{Name='kit-mismatch';Error='readiness:browser-kit-instance-id'},
                [pscustomobject]@{Name='states';Error='readiness:browser-state-transitions'},
                [pscustomobject]@{Name='forced-status';Error='readiness:browser-forced-statuses'},
                [pscustomobject]@{Name='retry-status';Error='readiness:browser-retry-status'}
            )
            foreach ($readinessCase in $readinessCases) {
                Write-TestCompleteArtifactManifest -AttemptRoot $semanticAttempt -AttemptId 'attempt-semantic'
                $readinessPath = Join-Path $semanticAttempt 'bscheme-readiness.json'
                $value = Get-Content -Raw -LiteralPath $readinessPath | ConvertFrom-Json
                switch ($readinessCase.Name) {
                    'schema' { $value.schema_version = '1' }
                    'missing-tier' { $value.tiers = @() }
                    'duplicate-tier' { $value.tiers = @($value.tiers[0], ($value.tiers[0] | ConvertTo-Json -Depth 10 | ConvertFrom-Json)) }
                    'tier-status' { $value.tiers[0].status = 'blocked' }
                    'context-mode' { $value.context.execution_mode = 'test_double' }
                    'detail-mode' { $value.tiers[0].detail.execution_mode = 'test_double' }
                    'root-missing-with-decoy' { $value.tiers[0].detail.root_trace_id = $null; $value | Add-Member -Force NoteProperty root_trace_id 'ifcready_decoy' }
                    'root-invalid' { $value.tiers[0].detail.root_trace_id = 'invalid-root' }
                    'root-mismatch' { $value.tiers[0].ids.ifc_ready_job_id = 'ifcready_other' }
                    'root-ambiguous' { $value | Add-Member -Force NoteProperty root_trace_id 'ifcready_other' }
                    'ifc-ready-ambiguous' { $value | Add-Member -Force NoteProperty ifc_ready_job_id 'ifcready_other' }
                    'conversion-missing' { $value.tiers[0].ids.conversion_job_id = $null }
                    'conversion-ambiguous' { $value | Add-Member -Force NoteProperty conversion_job_id 'stream_conv_other' }
                    'review-missing' { $value.tiers[0].detail.review_session_id = $null }
                    'review-ambiguous' { $value | Add-Member -Force NoteProperty review_session_id 'review_session_other' }
                    'browser' { $value.tiers[0].detail.browser_status = 'failed' }
                    'close' { $value.tiers[0].detail.close_status = 'close_failed' }
                    'close-origin' { $value.tiers[0].detail.close_origin = 'runner_fallback' }
                    'kit-missing' { $value.tiers[0].ids.kit_instance_id = $null; $value.tiers[0].detail.browser_artifacts.kit_instance_id = $null }
                    'kit-mismatch' { $value.tiers[0].detail.browser_artifacts.kit_instance_id = 'kit_other' }
                    'states' { $value.tiers[0].detail.browser_artifacts.state_transitions = @('ready','flush_success','closed') }
                    'forced-status' { $value.tiers[0].detail.browser_artifacts.forced_viewer_log_statuses = @(503,503) }
                    'retry-status' { $value.tiers[0].detail.browser_artifacts.retry_viewer_log_status = 503 }
                }
                $value | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $readinessPath -Encoding utf8
                Update-TestArtifactManifestHash $semanticAttempt 'bscheme-readiness.json'
                $result = Test-StructuredLogArtifactManifest -AttemptRoot $semanticAttempt
                Assert-True (-not $result.valid) "$($readinessCase.Name) readiness corruption is rejected with matching hash"
                Assert-True (@($result.errors) -ccontains $readinessCase.Error) "$($readinessCase.Name) reports readiness-specific error; errors=$($result.errors -join ',')"
            }

            foreach ($rootArtifact in @('artifact-manifest.json','attempt-manifest.json','root-trace-timeline.json','pr-fields.json')) {
                Write-TestCompleteArtifactManifest -AttemptRoot $semanticAttempt -AttemptId 'attempt-semantic'
                $rootArtifactPath = Join-Path $semanticAttempt $rootArtifact
                $value = Get-Content -Raw -LiteralPath $rootArtifactPath | ConvertFrom-Json
                $value.root_trace_id = 'ifcready_other'
                $value | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $rootArtifactPath -Encoding utf8
                if ($rootArtifact -cne 'artifact-manifest.json') { Update-TestArtifactManifestHash $semanticAttempt $rootArtifact }
                $result = Test-StructuredLogArtifactManifest -AttemptRoot $semanticAttempt
                Assert-True (-not $result.valid) "$rootArtifact root mismatch is rejected"
                Assert-True (@($result.errors) -ccontains "root-mismatch:$rootArtifact") "$rootArtifact reports cross-artifact root mismatch; errors=$($result.errors -join ',')"
            }
        } finally { Remove-Item -LiteralPath $semanticRoot -Recurse -Force -ErrorAction SilentlyContinue }

        $validatorFailureRoot = New-TestRoot 'validator-failure'
        try {
            $validatorFailureContext = New-TestContext $validatorFailureRoot
            foreach($name in @('machine.json','fixture.json','health.json','runtime-lease.json','shutdown.json')) {
                @{schema_version='1';name=$name}|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $validatorFailureContext.AttemptRoot $name)
            }
            Set-Content -LiteralPath $validatorFailureContext.ProvenancePath -Value '{"seq":1,"status":"passed"}'
            New-TestCanonicalReadiness -RootTraceId 'ifcready_failure' | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath (Join-Path $validatorFailureContext.AttemptRoot 'bscheme-readiness.json')
            Write-TestBrowserArtifacts -AttemptRoot $validatorFailureContext.AttemptRoot
            Assert-Throws { Write-StructuredLogEvidenceArtifacts -Context $validatorFailureContext -ValidatorInvoker { return 7 } } 'validator failed|exit code 7' 'canonical validator failure is surfaced'
            $failedValidator = Get-Content -LiteralPath $validatorFailureContext.ProvenancePath | Select-Object -Last 1 | ConvertFrom-Json
            Assert-Equal 'runtime_validator' $failedValidator.phase 'validator failure phase'
            Assert-Equal 'failed' $failedValidator.status 'validator failure status'
            Assert-Equal 7 $failedValidator.exit_code 'validator failure exit'
            Assert-True (-not [string]::IsNullOrWhiteSpace([string]$failedValidator.started_utc) -and -not [string]::IsNullOrWhiteSpace([string]$failedValidator.ended_utc)) 'validator failure start/end times'
            $failedValidatorRaw = Get-Content -Raw -LiteralPath $validatorFailureContext.ProvenancePath
            Assert-True ($failedValidatorRaw -notmatch [regex]::Escape($validatorFailureContext.LogRoot)) 'validator failure provenance omits attempt environment values'
        } finally { Remove-Item -LiteralPath $validatorFailureRoot -Recurse -Force -ErrorAction SilentlyContinue }
    } finally { Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue }
}

function Invoke-AttemptReconcileCase {
    Assert-True ($null -ne (Get-Command Resolve-StructuredLogActiveAttempt -ErrorAction SilentlyContinue)) 'attempt reconcile exists'
    $root = New-TestRoot 'reconcile'
    try {
        $stateDir = Join-Path $root 'artifacts\spec-to-done\cross-service-structured-log-baseline'
        $attempt = Join-Path $stateDir 'evidence\attempt-ok'
        New-Item -ItemType Directory -Path $attempt -Force | Out-Null
        Write-TestCompleteArtifactManifest -AttemptRoot $attempt -AttemptId 'attempt-ok'
        New-Item -ItemType Directory -Path $stateDir -Force | Out-Null
        $pointer=Join-Path $stateDir 'active-attempt.json'
        $directAtomicWrites=[pscustomobject]@{Value=0}
        $directState=[ordered]@{schema_version='1';head_oid='atomic';attempt_id='attempt-ok';attempt_root=$attempt;status='failed';started_utc='2026-07-24T00:00:00Z';finished_utc='2026-07-24T00:00:01Z';lineage=@()}
        Set-StructuredLogActiveAttempt -RepoRoot $root -State $directState -AtomicWriter { param($path,$value) $directAtomicWrites.Value++;Assert-Equal $pointer $path 'active pointer atomic seam receives canonical pointer path';Write-StructuredLogJsonAtomic -Path $path -Value $value }
        Assert-Equal 1 $directAtomicWrites.Value 'active pointer writer uses injected atomic writer exactly once'
        @{schema_version='1';head_oid='abc';attempt_id='attempt-ok';attempt_root=$attempt;status='succeeded';started_utc='2026-07-24T00:00:00Z';finished_utc='2026-07-24T00:01:00Z';lineage=@()}|ConvertTo-Json -Depth 8|Set-Content $pointer
        $resume=Resolve-StructuredLogActiveAttempt -RepoRoot $root -HeadOid 'abc'
        Assert-Equal 'resume_succeeded' $resume.action 'same HEAD succeeded resumes only with valid hashes'
        $operabilityPath = Join-Path $attempt 'browser\structured-log-operability.json'
        $malformedOperability = Get-Content -Raw -LiteralPath $operabilityPath | ConvertFrom-Json
        $malformedOperability.artifacts.playwright_trace = 'structured-log-trace.zip'
        $malformedOperability | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $operabilityPath -Encoding utf8
        Update-TestArtifactManifestHash -AttemptRoot $attempt -Name 'browser/structured-log-operability.json'
        $malformedDescriptor = Resolve-StructuredLogActiveAttempt -RepoRoot $root -HeadOid 'abc'
        Assert-Equal 'invalid_succeeded_artifacts' $malformedDescriptor.action 'malformed browser descriptor invalidates succeeded attempt without throwing'
        Write-TestCompleteArtifactManifest -AttemptRoot $attempt -AttemptId 'attempt-ok'
        $pointerState = Get-Content -Raw -LiteralPath $pointer | ConvertFrom-Json
        $pointerState.attempt_id = 'ATTEMPT-OK'
        $pointerState | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $pointer
        $identityMismatch = Resolve-StructuredLogActiveAttempt -RepoRoot $root -HeadOid 'abc'
        Assert-Equal 'invalid_pointer' $identityMismatch.action 'pointer attempt_id must case-exactly match validated manifest attempt_id'
        $pointerState.attempt_id = 'attempt-ok'
        $pointerState | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $pointer
        Add-Content -LiteralPath (Join-Path $attempt 'health.json') -Value 'tamper'
        $invalid=Resolve-StructuredLogActiveAttempt -RepoRoot $root -HeadOid 'abc'
        Assert-Equal 'invalid_succeeded_artifacts' $invalid.action 'same HEAD invalid hash does not resume'

        $trustShutdownCalls = [pscustomobject]@{Value=0}
        $outside = Join-Path $root 'outside-running'
        New-Item -ItemType Directory -Path $outside -Force | Out-Null
        Set-Content -LiteralPath (Join-Path $outside 'runtime-lease.json') -Value '{not-json'
        foreach ($unsafePointer in @(
            [pscustomobject]@{Name='outside';AttemptId='outside-running';AttemptRoot=$outside},
            [pscustomobject]@{Name='dotdot';AttemptId='attempt-ok';AttemptRoot=(Join-Path $stateDir 'evidence\nested\..\attempt-ok')},
            [pscustomobject]@{Name='case';AttemptId='ATTEMPT-OK';AttemptRoot=$attempt}
        )) {
            @{schema_version='1';head_oid='old';attempt_id=$unsafePointer.AttemptId;attempt_root=$unsafePointer.AttemptRoot;status='running';started_utc='2026-07-24T00:00:00Z';lineage=@()} | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $pointer
            $trustResult = Resolve-StructuredLogActiveAttempt -RepoRoot $root -HeadOid 'new' -ShutdownInvoker { $trustShutdownCalls.Value++; throw 'unsafe pointer must never reach shutdown' }
            Assert-Equal 'invalid_pointer' $trustResult.action "$($unsafePointer.Name) pointer is rejected at trust boundary"
        }
        $junctionTarget = Join-Path $root 'junction-target'
        New-Item -ItemType Directory -Path $junctionTarget -Force | Out-Null
        $junctionPath = Join-Path $stateDir 'evidence\attempt-link'
        New-Item -ItemType Junction -Path $junctionPath -Target $junctionTarget | Out-Null
        @{schema_version='1';head_oid='old';attempt_id='attempt-link';attempt_root=$junctionPath;status='running';started_utc='2026-07-24T00:00:00Z';lineage=@()} | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $pointer
        $junctionResult = Resolve-StructuredLogActiveAttempt -RepoRoot $root -HeadOid 'new' -ShutdownInvoker { $trustShutdownCalls.Value++; throw 'reparse pointer must never reach shutdown' }
        Assert-Equal 'invalid_pointer' $junctionResult.action 'reparse attempt root is rejected before lease read'
        Assert-Equal 0 $trustShutdownCalls.Value 'unsafe pointers never read outside lease or invoke shutdown'

        $running=Join-Path $stateDir 'evidence\attempt-running';New-Item -ItemType Directory -Path $running -Force|Out-Null
        @{schema_version='1';attempt_id='attempt-running';processes=@()}|ConvertTo-Json|Set-Content (Join-Path $running 'runtime-lease.json')
        @{schema_version='1';head_oid='old';attempt_id='attempt-running';attempt_root=$running;status='running';started_utc='2026-07-24T00:00:00Z';lineage=@()}|ConvertTo-Json -Depth 8|Set-Content $pointer
        $shutdownCalls=[pscustomobject]@{Value=0}
        $atomicWrites=[pscustomobject]@{Value=0}
        $superseded=Resolve-StructuredLogActiveAttempt -RepoRoot $root -HeadOid 'new' -ShutdownInvoker { param($context) $shutdownCalls.Value++; [pscustomobject]@{entries=@();foreign_listeners=@()} } -AtomicStateWriter { param($repoRoot,$state) $atomicWrites.Value++; Set-StructuredLogActiveAttempt -RepoRoot $repoRoot -State $state }
        Assert-Equal 'superseded_owned_runtime' $superseded.action 'running owned attempt reconciled then superseded'
        Assert-Equal 1 $shutdownCalls.Value 'owned shutdown invoked once'
        Assert-Equal 1 $atomicWrites.Value 'running-to-superseded pointer uses injectable atomic writer exactly once'
        $updated=Get-Content -Raw $pointer|ConvertFrom-Json
        Assert-Equal 'superseded' $updated.status 'pointer status preserved as superseded lineage'
        Assert-True $updated.lineage.Count -ge 1 'lineage retained'
    } finally { Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue }
}

function Invoke-TopLevelOrchestrationCase {
    Assert-True ($null -ne (Get-Command Invoke-StructuredLogRuntimeEvidence -ErrorAction SilentlyContinue)) 'top-level orchestrator exists'
    $source = Get-Content -Raw $RunnerPath
    foreach($prohibited in @('start-all','stop-all','ensure-host-native-ports-free','Stop-Process -Id $listener','Invoke-WebRequest.*-UseBasicParsing.*window\.')) {
        Assert-True ($source -notmatch $prohibited) "prohibited orchestration absent: $prohibited"
    }
    Assert-True ($source -match 'function Invoke-StructuredLogRuntimeEvidence[\s\S]*?try\s*\{[\s\S]*?finally\s*\{') 'one outer try/finally guards orchestration'
    Assert-True ($source -match 'Stop-StructuredLogOwnedProcesses') 'finally performs identity-bound owned shutdown'
    Assert-True ($source -match 'Confirm-StructuredLogLeasedProcessesEnded') 'finally verifies every leased identity ended'
    Assert-True ($source -match 'artifact manifest self-check failed after orchestration') 'final manifest rewrite cannot invalidate artifact hashes'
    Assert-True ($source -match 'Restore-StructuredLogEnvironment') 'finally restores every touched environment key'
    Assert-True ($source -match 'Write-StructuredLogEvidenceArtifacts') 'canonical renderer composed'
    Assert-True ($source -notmatch 'XMLHTTP|ActiveXObject|synchronous XHR') 'no synchronous XHR harness'

    $root = New-TestRoot 'top-level'
    try {
        Write-TestFile (Join-Path $root 'source.ifc') 'IFC'
        Write-TestFile (Join-Path $root 'python.exe') 'python'
        $attempt = Join-Path $root 'attempt-success'
        $ctx = New-TestContext $root
        Move-Item -LiteralPath $ctx.AttemptRoot -Destination $attempt
        $ctx.AttemptRoot = $attempt
        $ctx.AttemptId = 'attempt-success'
        $ctx.LogRoot = Join-Path $attempt 'logs'
        $ctx.StorageRoot = Join-Path $attempt 'storage'
        $ctx.ProvenancePath = Join-Path $attempt 'command-provenance.jsonl'
        $ctx.LeasePath = Join-Path $attempt 'runtime-lease.json'
        $order = [System.Collections.Generic.List[string]]::new()
        $dependencies = @{
            GetHeadOid = { param($repoRoot) $order.Add('head'); 'head-123' }
            Reconcile = { param($repoRoot,$headOid) $order.Add('reconcile'); [pscustomobject]@{action='none';lineage=@()} }
            NewContext = { param($repoRoot,$attemptRoot,$fixturePath,$pythonExe,$ports) $order.Add('context'); $ctx }
            ResolveKit = { param($context,$mode,$packagePath,$packageSha) $order.Add('kit'); [pscustomobject]@{kit_exe='kit';hoops_main='hoops';converter_config='config';converter_wrapper='wrapper'} }
            ProcessSpecs = { param($context) $order.Add('specs'); @([pscustomobject]@{name='conversion'},[pscustomobject]@{name='coordinator'},[pscustomobject]@{name='viewer'}) }
            Start = { param($context,$spec) $running=Get-Content -Raw (Join-Path $root 'artifacts\spec-to-done\cross-service-structured-log-baseline\active-attempt.json')|ConvertFrom-Json;Assert-Equal 'running' $running.status 'running pointer is durable before first start';$order.Add("start:$($spec.name)"); [pscustomobject]@{pid=1} }
            Health = { param($context,$specs) $order.Add('health') }
            Smoke = { param($context,$seconds) $order.Add('smoke') }
            Shutdown = { param($context) $order.Add('shutdown'); [pscustomobject]@{entries=@();foreign_listeners=@()} }
            ConfirmEnded = { param($context) $order.Add('confirm') }
            Render = { param($context) $order.Add('render'); [pscustomobject]@{status='succeeded'} }
            ManifestCheck = { param($attemptRoot) [pscustomobject]@{valid=$true;errors=@()} }
            Finalize = { param($repoRoot,$state) $order.Add("finalize:$($state.status)"); Set-StructuredLogActiveAttempt -RepoRoot $repoRoot -State $state }
        }
        $env:LOG_ROOT = 'parent-root'
        $result = Invoke-StructuredLogRuntimeEvidence -RepoRoot $root -AttemptRoot $attempt -FixturePath (Join-Path $root 'source.ifc') -PythonExe (Join-Path $root 'python.exe') -Dependencies $dependencies
        Assert-Equal 'head,reconcile,context,kit,specs,start:conversion,start:coordinator,start:viewer,health,smoke,shutdown,confirm,render,finalize:succeeded' ($order -join ',') 'actual injectable orchestration order'
        Assert-Equal 'succeeded' $result.status 'top-level returns renderer result'
        Assert-Equal 'parent-root' $env:LOG_ROOT 'top-level restores parent environment'
        $pointer = Get-Content -Raw (Join-Path $root 'artifacts\spec-to-done\cross-service-structured-log-baseline\active-attempt.json') | ConvertFrom-Json
        Assert-Equal 'succeeded' $pointer.status 'active attempt finalized succeeded'
        Assert-Equal 'head-123' $pointer.head_oid 'active attempt bound to HEAD'
        Assert-True ($null -ne $pointer.finished_utc) 'success pointer has finished_utc'

        $resumeOrder = [System.Collections.Generic.List[string]]::new()
        $resumeDeps = @{
            GetHeadOid = { 'head-123' }
            Reconcile = { $resumeOrder.Add('reconcile'); [pscustomobject]@{action='resume_succeeded';attempt_root=$attempt;lineage=@();attempt_id='attempt-success'} }
            NewContext = { throw 'resume must not start a new context' }
        }
        $resume = Invoke-StructuredLogRuntimeEvidence -RepoRoot $root -AttemptRoot (Join-Path $root 'unused') -FixturePath (Join-Path $root 'source.ifc') -PythonExe (Join-Path $root 'python.exe') -Dependencies $resumeDeps
        Assert-Equal 'resume_succeeded' $resume.action 'hash-verified succeeded attempt resumes without start'
        Assert-Equal 'reconcile' ($resumeOrder -join ',') 'resume stops after reconcile'

        foreach($unsafeAction in @('invalid_pointer','unsafe_running_identity')) {
            $unsafeDeps=@{GetHeadOid={'head-123'};Reconcile={ [pscustomobject]@{action=$unsafeAction;lineage=@();detail='unsafe'} }}
            Assert-Throws { Invoke-StructuredLogRuntimeEvidence -RepoRoot $root -AttemptRoot (Join-Path $root "unused-$unsafeAction") -FixturePath (Join-Path $root 'source.ifc') -PythonExe (Join-Path $root 'python.exe') -Dependencies $unsafeDeps } 'HELD|unsafe|invalid' "$unsafeAction is fail-closed"
        }

        foreach ($scenario in @(
            [pscustomobject]@{Name='health';Primary='health failure';Shutdown=$false;Render=$false;Expected='health failure';Reconcile='superseded_owned_runtime'},
            [pscustomobject]@{Name='smoke';Primary='smoke failure';Shutdown=$false;Render=$false;Expected='smoke failure';Reconcile='none'},
            [pscustomobject]@{Name='shutdown';Primary='';Shutdown=$true;Render=$false;Expected='shutdown failure';Reconcile='none'},
            [pscustomobject]@{Name='render';Primary='';Shutdown=$false;Render=$true;Expected='render failure';Reconcile='none'},
            [pscustomobject]@{Name='priority';Primary='smoke failure';Shutdown=$true;Render=$false;Expected='smoke failure';Reconcile='none'}
        )) {
            $scenarioRoot = Join-Path $root "scenario-$($scenario.Name)"
            New-Item -ItemType Directory -Path $scenarioRoot -Force | Out-Null
            Write-TestFile (Join-Path $scenarioRoot 'source.ifc') 'IFC'
            Write-TestFile (Join-Path $scenarioRoot 'python.exe') 'python'
            $scenarioContext = New-TestContext $scenarioRoot
            $events = [System.Collections.Generic.List[string]]::new()
            $scenarioDependencies = @{
                GetHeadOid = { 'head-scenario' }
                Reconcile = { [pscustomobject]@{action=$scenario.Reconcile;lineage=@()} }
                NewContext = { $events.Add('context'); $scenarioContext }
                ResolveKit = { [pscustomobject]@{kit_exe='kit';hoops_main='hoops';converter_config='config';converter_wrapper='wrapper'} }
                ProcessSpecs = { @([pscustomobject]@{name='conversion'},[pscustomobject]@{name='coordinator'},[pscustomobject]@{name='viewer'}) }
                Start = { param($context,$spec) $events.Add("start:$($spec.name)") }
                Health = {
                    $events.Add('health')
                    if ($scenario.Primary -eq 'health failure') { $env:LOG_ROOT='mutated-health'; throw 'health failure' }
                }
                Smoke = {
                    $events.Add('smoke')
                    if ($scenario.Primary -eq 'smoke failure') { $env:LOG_ROOT='mutated-smoke'; throw 'smoke failure' }
                }
                Shutdown = {
                    $events.Add('shutdown')
                    if ($scenario.Shutdown) { $env:LOG_ROOT='mutated-shutdown'; throw 'shutdown failure' }
                    [pscustomobject]@{entries=@();foreign_listeners=@()}
                }
                ConfirmEnded = { $events.Add('confirm') }
                Render = {
                    $events.Add('render')
                    if ($scenario.Render) { $env:LOG_ROOT='mutated-render'; throw 'render failure' }
                    [pscustomobject]@{status='succeeded'}
                }
                ManifestCheck = { [pscustomobject]@{valid=$true;errors=@()} }
            }
            $env:LOG_ROOT = "parent-$($scenario.Name)"
            $caught = $null
            try {
                Invoke-StructuredLogRuntimeEvidence -RepoRoot $scenarioRoot -AttemptRoot $scenarioContext.AttemptRoot -FixturePath (Join-Path $scenarioRoot 'source.ifc') -PythonExe (Join-Path $scenarioRoot 'python.exe') -Dependencies $scenarioDependencies | Out-Null
            } catch { $caught = $_ }
            Assert-True ($null -ne $caught) "$($scenario.Name) failure propagates"
            Assert-True ([string]$caught.Exception.Message -match [regex]::Escape($scenario.Expected)) "$($scenario.Name) failure priority is deterministic"
            Assert-Equal "parent-$($scenario.Name)" $env:LOG_ROOT "$($scenario.Name) restores outer environment"
            Assert-True ($events.Contains('shutdown')) "$($scenario.Name) reaches owned shutdown"
            if ($scenario.Name -in @('health','smoke','shutdown','priority')) { Assert-True (-not $events.Contains('render')) "$($scenario.Name) never renders after an earlier failure" }
            if ($scenario.Name -eq 'health') {
                Assert-True (-not $events.Contains('smoke')) 'health failure stops before smoke'
                Assert-True $events.Contains('context') 'superseded_owned_runtime reconcile proceeds to a new attempt'
            }
            if ($scenario.Name -eq 'render') { Assert-True $events.Contains('confirm') 'renderer failure happens only after shutdown confirmation' }
            $failedPointer = Get-Content -Raw (Join-Path $scenarioRoot 'artifacts\spec-to-done\cross-service-structured-log-baseline\active-attempt.json') | ConvertFrom-Json
            Assert-Equal 'failed' $failedPointer.status "$($scenario.Name) finalizes failed pointer"
            Assert-True (-not [string]::IsNullOrWhiteSpace([string]$failedPointer.finished_utc)) "$($scenario.Name) records finished_utc"
        }
    } finally {
        $env:LOG_ROOT = $null
        Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
    }
}

$cases = [ordered]@{
    ContextPortsFixture = ${function:Invoke-ContextPortsFixtureCase}
    KitProvisioning = ${function:Invoke-KitProvisioningCase}
    ProcessSpecs = ${function:Invoke-ProcessSpecsCase}
    OwnedStartLease = ${function:Invoke-OwnedStartLeaseCase}
    HealthSupportedSmoke = ${function:Invoke-HealthSupportedSmokeCase}
    IdentityShutdown = ${function:Invoke-IdentityShutdownCase}
    ArtifactRenderer = ${function:Invoke-ArtifactRendererCase}
    AttemptReconcile = ${function:Invoke-AttemptReconcileCase}
    TopLevelOrchestration = ${function:Invoke-TopLevelOrchestrationCase}
}

$selected = if ([string]::IsNullOrWhiteSpace($Case)) { @($cases.Keys) } else { @($Case) }
foreach($name in $selected) {
    & $cases[$name]
    Write-Host "PASS $name"
}

Write-Host "All structured-log runtime evidence runner tests passed ($(@($selected).Count) case(s))."
