# streaming-ifc-usdc-conversion-authority — Spec Delta (streaming-server-capture-kit-conversion-logs)

> Delta against `openspec/specs/streaming-ifc-usdc-conversion-authority/spec.md`(本檔僅含本 change 的差異)。本 change 加觀察性:Kit subprocess silent fail(`exit 0` 但無 USDC)時,result 必須帶 stdout/stderr log 完整路徑,且 error message 含 tail 摘要,讓 operator 不需要重跑 conversion 就能 debug Kit 本身的失敗。

## ADDED Requirements

### Requirement: Conversion failures expose actionable diagnostic

`bim-streaming-server` SHALL capture the Kit conversion subprocess's full stdout and stderr to dedicated log files inside the conversion's artifact directory and SHALL expose those log file paths in any failure result so operators can read the Kit subprocess output without re-running the conversion. The capture MUST be performed via asynchronous redirect(`Process.RedirectStandardOutput=true` + `BeginOutputReadLine`/`BeginErrorReadLine` writing to file)to avoid the standard sync `WaitForExit` + `ReadToEnd` deadlock when the subprocess output volume is large.

When the conversion fails for any reason after the subprocess starts(non-zero exit code, missing output file despite zero exit, or timeout):

- The `error` object on `GET /api/conversions/<id>/result` SHALL include `kit_stdout_log` and `kit_stderr_log` keys holding host-absolute paths to the captured log files.
- The `error.message` string SHALL include a tail summary of the last 100 lines of stderr and the last 50 lines of stdout so operators can triage from the result payload alone without filesystem access.
- The log files SHALL persist on disk(co-located with the conversion's artifact dir)beyond the failure event so subsequent re-reads, archival, or post-mortem analysis can use them.
- Successful conversions SHALL also retain the log files(co-located with `model.usdc`)to support baseline comparison; the result object MAY omit `kit_stdout_log` / `kit_stderr_log` from `error`(no error)but the files MUST still exist on disk.

The log files MUST NOT be sent to the cloud callback outbox(callback remains metadata-only per `conversion-webhook-lifecycle`);diagnostic log access is a host-local-only concern.

#### Scenario: Kit subprocess silent failure surfaces stderr tail in result

- **WHEN** `bim-streaming-server` invokes `convert-ifc-to-usdc.ps1` for a conversion job and the Kit subprocess exits with code 0 but does NOT write `model.usdc`
- **THEN** the resulting `GET /api/conversions/<id>/result` returns `status="failed"` with `error.code="converter_failed"`
- **AND** `error.kit_stdout_log` and `error.kit_stderr_log` are host-absolute paths pointing to files that exist on disk
- **AND** `error.message` contains the substring `---- stderr tail (last 100 lines) ----` followed by actual stderr lines from the Kit subprocess
- **AND** the operator can `tail` either log file independently without re-running the conversion

#### Scenario: Successful conversion retains subprocess logs on disk

- **WHEN** Kit subprocess successfully writes `model.usdc` and the conversion completes ready
- **THEN** `kit-stdout.log` and `kit-stderr.log` files exist in the artifact directory alongside `model.usdc`
- **AND** the result object does NOT include `kit_stdout_log` / `kit_stderr_log` in its `error` field(there is no error)
- **AND** the log files MAY be used for baseline comparison against future failures

#### Scenario: Async redirect prevents large-output deadlock

- **WHEN** Kit subprocess emits a stdout/stderr volume large enough to fill the OS pipe buffer(typical Kit verbose conversion log can reach megabytes)
- **THEN** the PowerShell wrapper MUST NOT block `WaitForExit` waiting for the parent to drain the pipe
- **AND** the conversion MUST progress to natural completion(success or terminal exit)without artificial pipe-buffer-induced hang
- **AND** the full output is captured to disk via async `BeginOutputReadLine` / `BeginErrorReadLine` event handlers

#### Scenario: Cloud callback outbox excludes subprocess logs

- **WHEN** coordinator enqueues a `conversion_failed` callback for a job whose error includes `kit_stdout_log` and `kit_stderr_log`
- **THEN** the callback payload sent to the company-cloud control plane MUST NOT include the log file contents
- **AND** MAY reference the log file paths only as opaque diagnostic markers(per existing metadata-only callback principle in `conversion-webhook-lifecycle`)
