[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$RepoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$SmokeScript = Join-Path $RepoRoot 'scripts\smoke-bscheme-intake.ps1'
$StructLogSchema = Join-Path $RepoRoot 'tests\contracts\structured-log\schema.json'
$RootTraceId = 'ifcready_test_root_123'
$SessionId = 'review_session_test_123'
$OpenUrl = "http://127.0.0.1:5173/review?session=$SessionId&trace_id=$RootTraceId"
$WebhookSecret = 'webhook-secret-must-not-appear'
$InternalToken = 'internal-token-must-not-appear'
$SmokeSource = Get-Content -LiteralPath $SmokeScript -Raw
$TestRoots = [System.Collections.ArrayList]::new()

function Assert-True {
    param([bool] $Condition, [string] $Message)
    if (-not $Condition) { throw "ASSERT FAILED: $Message" }
}

function Assert-Equal {
    param($Expected, $Actual, [string] $Message)
    if ($Expected -cne $Actual) {
        throw "ASSERT FAILED: $Message (expected '$Expected', got '$Actual')"
    }
}

function New-TestRoot {
    $root = Join-Path ([IO.Path]::GetTempPath()) ("bscheme-struct-log-" + [Guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $root -Force | Out-Null
    $null = $TestRoots.Add($root)
    $storage = Join-Path $root 'storage'
    New-Item -ItemType Directory -Path $storage -Force | Out-Null
    Set-Content -LiteralPath (Join-Path $storage 'fixture.ifc') -Value 'ISO-10303-21; ENDSEC; END-ISO-10303-21;' -Encoding utf8
    return [pscustomobject]@{
        Root = $root
        Storage = $storage
        LogRoot = (Join-Path $root 'logs')
        ArtifactRoot = (Join-Path $root 'browser')
        EvidencePath = (Join-Path $root 'evidence.json')
    }
}

function New-RequestHarness {
    param([ValidateSet('', 'review_session', 'close', 'dispatch', 'timeout', 'duplicate_source', 'boundary_success')][string] $FailureMode = '')
    $calls = [System.Collections.ArrayList]::new()
    $handler = {
        param([string] $Method, [string] $Url, $Body, [hashtable] $Headers, [int] $TimeoutSec)
        $null = $calls.Add([pscustomobject]@{
            method = $Method
            url = $Url
            body = $Body
            header_names = @($Headers.Keys)
        })
        if ($Url -match '/health$') { return [pscustomobject]@{ status = 'ok' } }
        if ($Method -eq 'GET' -and $Url -match '/api/dev/ifc-sources$') {
            $items = @([pscustomobject]@{ source_id = 'ifcsrc_fixture'; filename = 'fixture.ifc'; relative_path = 'fixture.ifc' })
            if ($FailureMode -eq 'duplicate_source') {
                $items += [pscustomobject]@{ source_id = 'ifcsrc_duplicate'; filename = 'fixture.ifc'; relative_path = 'fixture.ifc' }
            }
            return [pscustomobject]@{
                root = [pscustomobject]@{ exists = $true; readable = $true; item_count = $items.Count }
                items = $items
            }
        }
        if ($Method -eq 'POST' -and $Url -match '/api/dev/ifc-sources/ifcsrc_fixture/register$') {
            return [pscustomobject]@{
                ifc_ready_job_id = $RootTraceId
                conversion_job_id = $null
                correlation_id = 'corr_devreg_test_123'
                status = 'queued_for_conversion'
                conversion_status = $null
            }
        }
        if ($Method -eq 'GET' -and $Url -match "/api/external/ifc-ready/$RootTraceId$") {
            if ($FailureMode -eq 'dispatch') {
                return [pscustomobject]@{
                    ifc_ready_job_id = $RootTraceId
                    conversion_job_id = $null
                    correlation_id = 'corr_devreg_test_123'
                    status = 'dispatch_failed'
                    conversion_status = 'dispatch_failed'
                    dispatch_error = 'mock dispatch failure'
                }
            }
            if ($FailureMode -eq 'timeout') {
                return [pscustomobject]@{
                    ifc_ready_job_id = $RootTraceId
                    conversion_job_id = $null
                    correlation_id = 'corr_devreg_test_123'
                    status = 'queued_for_conversion'
                    conversion_status = $null
                }
            }
            if ($FailureMode -eq 'boundary_success') {
                Start-Sleep -Milliseconds 1100
            }
            return [pscustomobject]@{
                ifc_ready_job_id = $RootTraceId
                conversion_job_id = 'stream_conv_test_123'
                correlation_id = 'corr_devreg_test_123'
                status = 'dispatched'
                conversion_status = 'running'
            }
        }
        if ($Url -match '/api/conversions/stream_conv_test_123/result$') {
            return [pscustomobject]@{
                status = 'succeeded'
                artifacts = [pscustomobject]@{
                    model_usdc = [pscustomobject]@{ url = 'file:///model.usdc' }
                    element_mapping = [pscustomobject]@{ url = 'file:///element-mapping.json' }
                    metadata = [pscustomobject]@{ url = 'file:///metadata.json' }
                }
                quality_metrics = [pscustomobject]@{ mapped = 1 }
            }
        }
        if ($Url -match '/api/internal/conversion-result$') {
            return [pscustomobject]@{ status = 'accepted' }
        }
        if ($Url -match "/api/external/ifc-ready/$RootTraceId/review-session$") {
            if ($FailureMode -eq 'review_session') { throw 'mock review-session open failure' }
            return [pscustomobject]@{
                trace_id = $RootTraceId
                review_session_id = $SessionId
                open_url = $OpenUrl
                session_status = 'active'
            }
        }
        if ($Url -match "/api/review-sessions/$SessionId/close$") {
            if ($FailureMode -eq 'close') { throw 'mock cleanup close failure' }
            return [pscustomobject]@{ session_id = $SessionId; status = 'closed' }
        }
        throw "Unexpected request: $Method $Url"
    }.GetNewClosure()
    return [pscustomobject]@{ Calls = $calls; Handler = $handler }
}

function Read-StructRecords {
    param([string] $LogRoot)
    return @(
        Get-ChildItem -LiteralPath $LogRoot -Filter '*.jsonl' -File -Recurse |
            ForEach-Object { Get-Content -LiteralPath $_.FullName -Encoding utf8 } |
            Where-Object { -not [string]::IsNullOrWhiteSpace($_) } |
            ForEach-Object { $_ | ConvertFrom-Json -DateKind String }
    )
}

function Assert-RecordsValidate {
    param([object[]] $Records, [string] $Scenario)
    foreach ($record in $Records) {
        $json = $record | ConvertTo-Json -Compress -Depth 20
        $valid = Test-Json -Json $json -SchemaFile $StructLogSchema -ErrorAction SilentlyContinue
        Assert-True -Condition $valid -Message "$Scenario record validates canonical schema: $($record.msg)"
    }
}

function Invoke-TestSmoke {
    param($Paths, $RequestHandler, $BrowserHandler)
    & $SmokeScript `
        -EvidencePath $Paths.EvidencePath `
        -StorageRoot $Paths.Storage `
        -CoordinatorBaseUrl 'http://coordinator.test' `
        -StreamingConversionApiBase 'http://streaming.test' `
        -WebhookSecret $WebhookSecret `
        -InternalApiToken $InternalToken `
        -LivePollSeconds 1 `
        -StructLogRoot $Paths.LogRoot `
        -BrowserArtifactDir $Paths.ArtifactRoot `
        -RequestInvoker $RequestHandler `
        -BrowserInvoker $BrowserHandler `
        -ExecutionProfile owned_runtime `
        -SkipVerificationTiers `
        -SkipKitLauncher 6>&1 | Out-Null
}

function Invoke-ExecutionModeSmoke {
    param($Paths, [ValidateSet('auto','owned_runtime')] [string] $ExecutionProfile)
    & $SmokeScript `
        -EvidencePath $Paths.EvidencePath `
        -StorageRoot $Paths.Storage `
        -CoordinatorBaseUrl 'http://127.0.0.1:1' `
        -StreamingConversionApiBase 'http://127.0.0.1:1' `
        -LivePollSeconds 1 `
        -StructLogRoot $Paths.LogRoot `
        -BrowserArtifactDir $Paths.ArtifactRoot `
        -ExecutionProfile $ExecutionProfile `
        -SkipVerificationTiers `
        -SkipKitLauncher 6>&1 | Out-Null
    return Get-Content -LiteralPath $Paths.EvidencePath -Raw | ConvertFrom-Json
}

try {
Write-Host '[test-smoke-bscheme-structured-log] execution profiles isolate owned runtime from nested verification tiers'
$autoMode = New-TestRoot
$autoEvidence = Invoke-ExecutionModeSmoke -Paths $autoMode -ExecutionProfile auto
Assert-Equal -Expected 'test_only' -Actual $autoEvidence.context.execution_mode -Message 'auto plus skip verification preserves historical test_only mode'
$ownedMode = New-TestRoot
$ownedEvidence = Invoke-ExecutionModeSmoke -Paths $ownedMode -ExecutionProfile owned_runtime
Assert-Equal -Expected 'production' -Actual $ownedEvidence.context.execution_mode -Message 'owned runtime plus skip verification remains production evidence mode'
foreach ($tierName in @('external_ifc_ready_intake','coordinator_session_lifecycle','streaming_internal_conversion')) {
    $ownedTiers = @($ownedEvidence.tiers | Where-Object tier -eq $tierName)
    Assert-Equal -Expected 0 -Actual $ownedTiers.Count -Message "owned runtime does not add or execute nested verification tier $tierName"
}

Write-Host '[test-smoke-bscheme-structured-log] success lifecycle'
Assert-True -Condition ($SmokeSource -match [regex]::Escape("web-viewer-sample\scripts\smoke-struct-log-bootstrap.mjs")) -Message 'supported smoke owns production browser helper path'
Assert-True -Condition ($SmokeSource -match '& node \$helper --url \$Url --trace-id \$TraceId --artifact-dir \$ArtifactDir') -Message 'default path invokes real page helper with URL, trace, and artifact directory'
$success = New-TestRoot
$successRequests = New-RequestHarness
$successBrowser = {
    param([string] $Url, [string] $TraceId, [string] $ArtifactDir)
    Assert-Equal -Expected $OpenUrl -Actual $Url -Message 'browser receives coordinator open URL'
    Assert-Equal -Expected $RootTraceId -Actual $TraceId -Message 'browser receives root trace'
    New-Item -ItemType Directory -Path $ArtifactDir -Force | Out-Null
    $screenshot = Join-Path $ArtifactDir 'struct-log-bootstrap.png'
    $trace = Join-Path $ArtifactDir 'struct-log-bootstrap-trace.zip'
    Set-Content -LiteralPath $screenshot -Value 'png-bytes' -Encoding utf8
    Set-Content -LiteralPath $trace -Value 'trace-bytes' -Encoding utf8
    return [pscustomobject]@{
        ok = $true
        traceId = $TraceId
        screenshotPath = $screenshot
        tracePath = $trace
    }
}.GetNewClosure()
Invoke-TestSmoke -Paths $success -RequestHandler $successRequests.Handler -BrowserHandler $successBrowser
$sourceListCalls = @($successRequests.Calls | Where-Object { $_.method -eq 'GET' -and $_.url -match '/api/dev/ifc-sources$' })
$sourceRegisterCalls = @($successRequests.Calls | Where-Object { $_.method -eq 'POST' -and $_.url -match '/api/dev/ifc-sources/ifcsrc_fixture/register$' })
$directFileUriIntakeCalls = @($successRequests.Calls | Where-Object { $_.method -eq 'POST' -and $_.url -match '/api/external/ifc-ready$' })
$dispatchPollCalls = @($successRequests.Calls | Where-Object { $_.method -eq 'GET' -and $_.url -match "/api/external/ifc-ready/$RootTraceId$" })
Assert-Equal -Expected 1 -Actual $sourceListCalls.Count -Message 'supported smoke resolves coordinator-owned IFC source id'
Assert-Equal -Expected 1 -Actual $sourceRegisterCalls.Count -Message 'supported smoke registers the selected coordinator source'
Assert-Equal -Expected 0 -Actual $directFileUriIntakeCalls.Count -Message 'supported smoke never bypasses coordinator download with direct file URI intake'
Assert-True -Condition ($dispatchPollCalls.Count -ge 1) -Message 'async coordinator job is polled until conversion_job_id appears'
$successCloseCalls = @($successRequests.Calls | Where-Object url -match '/api/review-sessions/.+/close$')
Assert-Equal -Expected 1 -Actual $successCloseCalls.Count -Message 'successful browser closes session exactly once after artifacts'

$successRecords = Read-StructRecords -LogRoot $success.LogRoot
Assert-RecordsValidate -Records $successRecords -Scenario 'success'
Assert-Equal -Expected 1 -Actual @($successRecords | Where-Object event_type -eq 'env_snapshot').Count -Message 'one startup env snapshot'
$requiredLifecycle = @(
    'IFC-ready intake accepted',
    'Streaming conversion poll completed',
    'Review session opened',
    'Viewer bootstrap completed',
    'Review session closed'
)
foreach ($message in $requiredLifecycle) {
    $matching = @($successRecords | Where-Object { $_.event_type -eq 'lifecycle' -and $_.msg -eq $message })
    Assert-Equal -Expected 1 -Actual $matching.Count -Message "one lifecycle record: $message"
    Assert-Equal -Expected $RootTraceId -Actual $matching[0].trace_id -Message "$message uses root trace"
}

$successEvidenceText = Get-Content -LiteralPath $success.EvidencePath -Raw
$successEvidence = $successEvidenceText | ConvertFrom-Json
$successTier = $successEvidence.tiers | Where-Object tier -eq 'real_ifc_intake_conversion'
Assert-Equal -Expected 'test_double' -Actual $successEvidence.context.execution_mode -Message 'test hook evidence execution mode'
Assert-Equal -Expected 'test_double' -Actual $successEvidence.context.artifact_provenance -Message 'test hook artifact provenance'
Assert-Equal -Expected 'test_double' -Actual $successTier.detail.execution_mode -Message 'integration detail execution mode'
Assert-Equal -Expected $RootTraceId -Actual $successTier.detail.root_trace_id -Message 'evidence root trace'
Assert-Equal -Expected $OpenUrl -Actual $successTier.detail.open_url -Message 'evidence open URL'
Assert-Equal -Expected $SessionId -Actual $successTier.detail.review_session_id -Message 'evidence review session'
Assert-Equal -Expected 'test_double_observed' -Actual $successTier.detail.browser_status -Message 'test-double browser status is not live passed'
Assert-True -Condition ((Get-Item -LiteralPath $successTier.detail.browser_artifacts.screenshot_path).Length -gt 0) -Message 'nonempty screenshot evidence'
Assert-True -Condition ((Get-Item -LiteralPath $successTier.detail.browser_artifacts.playwright_trace_path).Length -gt 0) -Message 'nonempty trace evidence'
Assert-Equal -Expected 'test_double' -Actual $successTier.detail.browser_artifacts.provenance -Message 'browser artifact provenance'
Assert-Equal -Expected 'closed' -Actual $successTier.detail.close_status -Message 'evidence close status'
$liveTierNames = @('real_ifc_fixture', 'real_ifc_intake_conversion', 'mapping_quality', 'runtime_image_kit_launcher', 'single_kit_render', 'single_kit_multi_viewer', 'usd_stage_composition')
foreach ($tierName in $liveTierNames) {
    $tier = $successEvidence.tiers | Where-Object tier -eq $tierName
    Assert-True -Condition ($tier.status -in @('not_observed', 'deferred')) -Message "$tierName cannot pass under test doubles"
    Assert-True -Condition (-not [string]::IsNullOrWhiteSpace([string]$tier.blocker)) -Message "$tierName records test-double blocker"
}
Assert-Equal -Expected 0 -Actual @($successEvidence.tiers | Where-Object status -eq 'passed').Count -Message 'test-double evidence serializes no live passed tier'
Assert-True -Condition (-not $successEvidenceText.Contains($WebhookSecret)) -Message 'webhook secret absent from evidence'
Assert-True -Condition (-not $successEvidenceText.Contains($InternalToken)) -Message 'internal token absent from evidence'
$successLogText = ($successRecords | ConvertTo-Json -Depth 20)
Assert-True -Condition (-not $successLogText.Contains($WebhookSecret)) -Message 'webhook secret absent from logs'
Assert-True -Condition (-not $successLogText.Contains($InternalToken)) -Message 'internal token absent from logs'
$callbackCall = @($successRequests.Calls | Where-Object url -match '/api/internal/conversion-result$') | Select-Object -First 1
Assert-Equal -Expected 'corr_devreg_test_123' -Actual $callbackCall.body.correlation_id -Message 'callback uses register job correlation_id'

Write-Host '[test-smoke-bscheme-structured-log] deadline-boundary dispatch success is evaluated before timeout'
$boundarySuccess = New-TestRoot
$boundarySuccessRequests = New-RequestHarness -FailureMode 'boundary_success'
Invoke-TestSmoke -Paths $boundarySuccess -RequestHandler $boundarySuccessRequests.Handler -BrowserHandler $successBrowser
$boundarySuccessEvidence = Get-Content -LiteralPath $boundarySuccess.EvidencePath -Raw | ConvertFrom-Json
$boundarySuccessTier = $boundarySuccessEvidence.tiers | Where-Object tier -eq 'real_ifc_intake_conversion'
Assert-Equal -Expected $true -Actual $boundarySuccessTier.detail.coordinator_dispatch_poll.completed -Message 'last GET conversion id wins over expired deadline'
Assert-Equal -Expected 'dispatched' -Actual $boundarySuccessTier.detail.coordinator_dispatch_poll.status -Message 'deadline-boundary conversion is dispatched, not timeout'

Write-Host '[test-smoke-bscheme-structured-log] async dispatch failure stops before streaming poll'
$dispatchFailure = New-TestRoot
$dispatchFailureRequests = New-RequestHarness -FailureMode 'dispatch'
$dispatchFailureBrowser = { throw 'browser must not run after dispatch failure' }
Invoke-TestSmoke -Paths $dispatchFailure -RequestHandler $dispatchFailureRequests.Handler -BrowserHandler $dispatchFailureBrowser
$dispatchStreamingCalls = @($dispatchFailureRequests.Calls | Where-Object url -match '/api/conversions/.+/result$')
Assert-Equal -Expected 0 -Actual $dispatchStreamingCalls.Count -Message 'terminal coordinator dispatch failure stops before streaming result polling'
$dispatchFailureEvidence = Get-Content -LiteralPath $dispatchFailure.EvidencePath -Raw | ConvertFrom-Json
$dispatchFailureTier = $dispatchFailureEvidence.tiers | Where-Object tier -eq 'real_ifc_intake_conversion'
Assert-True -Condition ([string]$dispatchFailureTier.detail.ifc_ready_job.dispatch_error -match 'mock dispatch failure') -Message 'dispatch failure is preserved in evidence'
Assert-Equal -Expected $false -Actual $dispatchFailureTier.detail.coordinator_dispatch_poll.completed -Message 'dispatch terminal failure is not completed'
Assert-Equal -Expected 'blocked' -Actual $dispatchFailureTier.detail.coordinator_dispatch_poll.status -Message 'dispatch terminal failure is blocked, not timeout'
Assert-Equal -Expected 'mock dispatch failure' -Actual $dispatchFailureTier.detail.coordinator_dispatch_poll.error -Message 'dispatch terminal error is preserved without timeout substitution'

Write-Host '[test-smoke-bscheme-structured-log] async dispatch timeout is deterministic and preserves last job'
$dispatchTimeout = New-TestRoot
$dispatchTimeoutRequests = New-RequestHarness -FailureMode 'timeout'
Invoke-TestSmoke -Paths $dispatchTimeout -RequestHandler $dispatchTimeoutRequests.Handler -BrowserHandler $dispatchFailureBrowser
$dispatchTimeoutEvidence = Get-Content -LiteralPath $dispatchTimeout.EvidencePath -Raw | ConvertFrom-Json
$dispatchTimeoutTier = $dispatchTimeoutEvidence.tiers | Where-Object tier -eq 'real_ifc_intake_conversion'
Assert-Equal -Expected 'queued_for_conversion' -Actual $dispatchTimeoutTier.detail.ifc_ready_job.status -Message 'timeout evidence preserves last coordinator job state'
Assert-True -Condition ([string]$dispatchTimeoutTier.detail.coordinator_dispatch_poll.error -match 'not observed within 1s') -Message 'timeout evidence records deterministic blocker'
Assert-Equal -Expected 0 -Actual @($dispatchTimeoutRequests.Calls | Where-Object url -match '/api/conversions/.+/result$').Count -Message 'dispatch timeout stops before streaming poll'

Write-Host '[test-smoke-bscheme-structured-log] duplicate source match fails closed'
$duplicateSource = New-TestRoot
$duplicateSourceRequests = New-RequestHarness -FailureMode 'duplicate_source'
Invoke-TestSmoke -Paths $duplicateSource -RequestHandler $duplicateSourceRequests.Handler -BrowserHandler $dispatchFailureBrowser
Assert-Equal -Expected 0 -Actual @($duplicateSourceRequests.Calls | Where-Object url -match '/register$').Count -Message 'ambiguous source catalog never registers a guessed source id'
$duplicateEvidence = Get-Content -LiteralPath $duplicateSource.EvidencePath -Raw | ConvertFrom-Json
$duplicateTier = $duplicateEvidence.tiers | Where-Object tier -eq 'real_ifc_intake_conversion'
Assert-True -Condition ([string]$duplicateTier.detail.error -match 'exactly one coordinator IFC source') -Message 'ambiguous source blocker is explicit'

Write-Host '[test-smoke-bscheme-structured-log] browser failure best-effort closes session once'
$failure = New-TestRoot
$failureRequests = New-RequestHarness
$failureBrowser = { throw 'mock browser bootstrap failure' }
Invoke-TestSmoke -Paths $failure -RequestHandler $failureRequests.Handler -BrowserHandler $failureBrowser

$closeCalls = @($failureRequests.Calls | Where-Object url -match '/api/review-sessions/.+/close$')
Assert-Equal -Expected 1 -Actual $closeCalls.Count -Message 'failed browser best-effort closes fake session exactly once'
$failureRecords = Read-StructRecords -LogRoot $failure.LogRoot
Assert-RecordsValidate -Records $failureRecords -Scenario 'browser failure'
$anomalies = @($failureRecords | Where-Object { $_.event_type -eq 'operation_anomaly' -and $_.trace_id -eq $RootTraceId })
Assert-True -Condition ($anomalies.Count -ge 1) -Message 'browser failure records root-trace anomaly'
$failureEvidenceText = Get-Content -LiteralPath $failure.EvidencePath -Raw
$failureEvidence = $failureEvidenceText | ConvertFrom-Json
$failureTier = $failureEvidence.tiers | Where-Object tier -eq 'real_ifc_intake_conversion'
Assert-Equal -Expected 'failed' -Actual $failureTier.detail.browser_status -Message 'failed browser evidence status'
Assert-Equal -Expected 'closed' -Actual $failureTier.detail.close_status -Message 'failed browser cleanup close status'
Assert-True -Condition ([string]$failureTier.detail.lifecycle_error -match 'mock browser bootstrap failure') -Message 'primary browser error preserved'
Assert-True -Condition (-not $failureEvidenceText.Contains($WebhookSecret)) -Message 'webhook secret absent from failure evidence'
Assert-True -Condition (-not $failureEvidenceText.Contains($InternalToken)) -Message 'internal token absent from failure evidence'

Write-Host '[test-smoke-bscheme-structured-log] cleanup failure is independent from primary browser failure'
$cleanupFailure = New-TestRoot
$cleanupFailureRequests = New-RequestHarness -FailureMode 'close'
Invoke-TestSmoke -Paths $cleanupFailure -RequestHandler $cleanupFailureRequests.Handler -BrowserHandler $failureBrowser
$cleanupCloseCalls = @($cleanupFailureRequests.Calls | Where-Object url -match '/api/review-sessions/.+/close$')
Assert-Equal -Expected 1 -Actual $cleanupCloseCalls.Count -Message 'cleanup close failure is not retried recursively'
$cleanupRecords = Read-StructRecords -LogRoot $cleanupFailure.LogRoot
Assert-RecordsValidate -Records $cleanupRecords -Scenario 'cleanup close failure'
$cleanupAnomalies = @($cleanupRecords | Where-Object { $_.event_type -eq 'operation_anomaly' -and $_.trace_id -eq $RootTraceId })
Assert-Equal -Expected 2 -Actual $cleanupAnomalies.Count -Message 'primary and cleanup failures have separate anomalies'
$cleanupEvidence = Get-Content -LiteralPath $cleanupFailure.EvidencePath -Raw | ConvertFrom-Json
$cleanupEvidenceText = Get-Content -LiteralPath $cleanupFailure.EvidencePath -Raw
$cleanupTier = $cleanupEvidence.tiers | Where-Object tier -eq 'real_ifc_intake_conversion'
Assert-True -Condition ([string]$cleanupTier.detail.lifecycle_error -match 'mock browser bootstrap failure') -Message 'cleanup failure does not overwrite primary error'
Assert-Equal -Expected 'failed' -Actual $cleanupTier.detail.close_status -Message 'cleanup failure close status'
Assert-True -Condition ([string]$cleanupTier.detail.close_error -match 'mock cleanup close failure') -Message 'cleanup error recorded independently'
Assert-True -Condition (-not $cleanupEvidenceText.Contains($WebhookSecret) -and -not $cleanupEvidenceText.Contains($InternalToken)) -Message 'secrets absent from cleanup failure evidence'

Write-Host '[test-smoke-bscheme-structured-log] pre-session failure closes nothing'
$preSession = New-TestRoot
$preSessionRequests = New-RequestHarness -FailureMode 'review_session'
$unexpectedBrowser = { throw 'browser must not run before session id exists' }
Invoke-TestSmoke -Paths $preSession -RequestHandler $preSessionRequests.Handler -BrowserHandler $unexpectedBrowser
$preSessionCloseCalls = @($preSessionRequests.Calls | Where-Object url -match '/api/review-sessions/.+/close$')
Assert-Equal -Expected 0 -Actual $preSessionCloseCalls.Count -Message 'pre-session failure does not call close'
$preSessionRecords = Read-StructRecords -LogRoot $preSession.LogRoot
Assert-RecordsValidate -Records $preSessionRecords -Scenario 'pre-session failure'
$preSessionEvidenceText = Get-Content -LiteralPath $preSession.EvidencePath -Raw
$preSessionEvidence = $preSessionEvidenceText | ConvertFrom-Json
$preSessionTier = $preSessionEvidence.tiers | Where-Object tier -eq 'real_ifc_intake_conversion'
Assert-Equal -Expected 'not_attempted' -Actual $preSessionTier.detail.close_status -Message 'pre-session close status'
Assert-True -Condition (-not $preSessionEvidenceText.Contains($WebhookSecret) -and -not $preSessionEvidenceText.Contains($InternalToken)) -Message 'secrets absent from pre-session evidence'

Write-Host 'PASS: B-scheme smoke structured logging, browser lifecycle, evidence, and secret redaction'
} finally {
    $tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar)
    foreach ($candidate in $TestRoots) {
        $resolved = [IO.Path]::GetFullPath([string]$candidate).TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar)
        $parent = [IO.Path]::GetDirectoryName($resolved)
        $leaf = [IO.Path]::GetFileName($resolved)
        if (-not $parent.Equals($tempRoot, [StringComparison]::OrdinalIgnoreCase) -or
            -not $leaf.StartsWith('bscheme-struct-log-', [StringComparison]::Ordinal)) {
            throw "Refusing unsafe test cleanup path: $resolved"
        }
        if (Test-Path -LiteralPath $resolved) {
            Remove-Item -LiteralPath $resolved -Recurse -Force
        }
    }
}
