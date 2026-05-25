# Design — streaming-server-capture-kit-conversion-logs

## 1. Context

`bim-streaming-server/scripts/convert-ifc-to-usdc.ps1` line 288-316:

```powershell
$startInfo = [System.Diagnostics.ProcessStartInfo]::new($kitExe)
$startInfo.UseShellExecute = $false
$startInfo.WorkingDirectory = $RepoRoot
foreach ($arg in $kitArgs) { $startInfo.ArgumentList.Add($arg) | Out-Null }

$process = [System.Diagnostics.Process]::Start($startInfo)
...
$process.WaitForExit($TimeoutSeconds * 1000)
$exitCode = $process.ExitCode
...
if ($exitCode -ne 0) { throw "Kit CAD conversion failed with exit code $exitCode ..." }
if (-not (Test-Path -LiteralPath $Item.OutputPath -PathType Leaf)) {
  throw "Kit CAD conversion completed but output was not created: $($Item.OutputPath)"
}
```

`RedirectStandardOutput`/`RedirectStandardError` 沒設 → Kit subprocess 的 stdout/stderr **直接寫到 PowerShell host 主控台**(被 Python adapter subprocess.Popen 吃了一部分但沒 surface 進 result;且 .NET process inherits parent 的 stdout handle,實際 mixed 在 ps1 stdout 內)。

2026-05-22 user 341MB IFC L4 跑:
- Kit subprocess `exit 0`(line 312 沒 throw)
- 但 `model.usdc` 沒被寫(line 316 throw)
- error message 內**完全沒 Kit 自己的 stderr/stdout**

## 2. Resolution shape

**async file-based redirection**(避免 .NET sync RedirectStandardOutput + WaitForExit 經典 deadlock — 子進程 stdout buffer 滿等 parent read,parent 等 child exit):

```powershell
$artifactDir = Split-Path -Parent $Item.OutputPath
if (-not (Test-Path -LiteralPath $artifactDir)) {
  New-Item -ItemType Directory -Path $artifactDir | Out-Null
}
$stdoutLog = Join-Path $artifactDir "kit-stdout.log"
$stderrLog = Join-Path $artifactDir "kit-stderr.log"

$startInfo.RedirectStandardOutput = $true
$startInfo.RedirectStandardError  = $true

$process = [System.Diagnostics.Process]::Start($startInfo)
if (-not $process) { throw "Kit CAD conversion process did not start ..." }

$stdoutWriter = [System.IO.StreamWriter]::new($stdoutLog, $false, [System.Text.Encoding]::UTF8)
$stderrWriter = [System.IO.StreamWriter]::new($stderrLog, $false, [System.Text.Encoding]::UTF8)
$stdoutWriter.AutoFlush = $true
$stderrWriter.AutoFlush = $true

# async events,buffer 不會 fill
$null = Register-ObjectEvent -InputObject $process -EventName OutputDataReceived -Action {
  if ($EventArgs.Data) { $Event.MessageData.WriteLine($EventArgs.Data) }
} -MessageData $stdoutWriter
$null = Register-ObjectEvent -InputObject $process -EventName ErrorDataReceived -Action {
  if ($EventArgs.Data) { $Event.MessageData.WriteLine($EventArgs.Data) }
} -MessageData $stderrWriter

$process.BeginOutputReadLine()
$process.BeginErrorReadLine()

try {
  if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
    Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
    throw "Kit CAD conversion timed out after $TimeoutSeconds seconds ..."
  }
  $exitCode = $process.ExitCode
} finally {
  # flush 所有 pending event handlers
  $process.WaitForExit()  # second call ensures all async events processed
  Get-EventSubscriber | Where-Object { $_.SourceObject -eq $process } | Unregister-Event
  $stdoutWriter.Close()
  $stderrWriter.Close()
  $process.Dispose()
}

if ($exitCode -ne 0 -or -not (Test-Path -LiteralPath $Item.OutputPath -PathType Leaf)) {
  $stderrTail = if (Test-Path $stderrLog) {
    (Get-Content -LiteralPath $stderrLog -Tail 100 -ErrorAction SilentlyContinue) -join "`n"
  } else { "(no stderr log)" }
  $stdoutTail = if (Test-Path $stdoutLog) {
    (Get-Content -LiteralPath $stdoutLog -Tail 50 -ErrorAction SilentlyContinue) -join "`n"
  } else { "(no stdout log)" }
  $reason = if ($exitCode -ne 0) {
    "Kit CAD conversion failed with exit code $exitCode"
  } else {
    "Kit CAD conversion completed but output was not created: $($Item.OutputPath)"
  }
  throw @"
$reason
  kit_stdout_log: $stdoutLog
  kit_stderr_log: $stderrLog
  ---- stderr tail (last 100 lines) ----
$stderrTail
  ---- stdout tail (last 50 lines) ----
$stdoutTail
"@
}
```

## 3. Python adapter changes

`Ifc2UsdcPowershellConverterAdapter._run_powershell_conversion`(or `convert`)在 `subprocess.run` non-zero exit 時,從 throw message 解析 `kit_stdout_log:` / `kit_stderr_log:` 兩行 path(regex 抓);掛到 `ConversionAuthorityError` 的 metadata,host_native_conversion_service 端把這兩個 path 寫進 result `error` dict:

```python
{
  "error": {
    "code": "converter_failed",
    "message": "<full ps1 throw>",
    "kit_stdout_log": "C:\\...\\artifacts\\<conv>\\kit-stdout.log",  # 新
    "kit_stderr_log": "C:\\...\\artifacts\\<conv>\\kit-stderr.log",  # 新
  }
}
```

GET `/api/conversions/<id>/result` 自然帶出來。Operator 直接 host 端 `tail` 對應 file 看完整 Kit log。

## 4. Why file-based + async

兩個常見 .NET deadlock pattern:

- **A**: parent `process.StandardOutput.ReadToEnd()` + `WaitForExit` — 若 child write 量大且 child 等 parent read stderr(buffer fill),parent 在 WaitForExit 卡住
- **B**: parent 同時 `process.StandardOutput.ReadToEnd()` + `process.StandardError.ReadToEnd()` — 兩個 stream 序列讀,另一個 buffer fill 卡

Async `BeginOutputReadLine` + event handler 是 .NET 官方推薦解法。我們再進一步寫 file(而非 buffer 在 memory)避免大 log 吃 memory。

## 5. Backward compatibility

- 既有 stdout-only inheritance 行為:Kit log 之前直接顯示在 ps1 console(混在 ps1 自己的 Write-Host 後面);本 change 後 Kit log **只進 file**(不再上主控台)。對 operator 不是 net loss(file 留得更完整),但 dev 跑 ps1 直接觀察 console 時看不到 Kit 即時 log,需要另開 terminal `tail -f kit-stdout.log`
- result.error.message 變長(加 stderr/stdout tail);existing consumer 若有 length 限制可能影響顯示 — coordinator response truncate 由 client 處理,不破 schema
- result.error 加兩個欄位 `kit_stdout_log` / `kit_stderr_log`,純 additive,不破 backward compat

## 6. Failure modes

| 情境 | 行為 |
|---|---|
| log file 寫入失敗(permission) | log file 不存在,throw 訊息 fallback `"(no stderr log)"`;throw 本身仍 raise |
| Kit subprocess crash(unhandled exception → non-zero exit) | log 仍寫到 partial,tail 進 throw |
| timeout | line 304 throw 之前,先 close writer + Unregister-Event,partial log 仍保留 |
| 成功(USDC 寫出) | log 仍保留(成功 baseline 對比用);不 throw |

## 7. Spec impact

`streaming-ifc-usdc-conversion-authority` capability MODIFIED 1 個 requirement(或新 ADD「Conversion subprocess diagnostic capture」)。從 spec wording 看既有 `Conversion failures are observable and retryable` 之類 requirement,我加 sub-clause:「failure result SHALL include `kit_stdout_log` and `kit_stderr_log` absolute paths pointing to host fs files containing the full Kit subprocess streams; failure error message SHALL include a tail summary」。

## 8. Apply gap found after archive correction

補做 implementation apply 時,`bim-streaming-server/scripts/tests/test-convert-ifc-to-usdc.ps1` 暴露一個既有 PowerShell path regression:`Resolve-IfcInputs` 先呼叫 `ConvertTo-AbsolutePath`,而該 helper 直接把 `.\_test_ifc_data\*.ifc` 交給 `[System.IO.Path]::GetFullPath(...)`;在 Windows/.NET 下 `*` 被視為非法 path character,導致 plan-only test 在真正跑到 Kit subprocess 前就失敗。

這個 gap 會遮蔽本 change 的最低層 script verification:即使 log capture implementation 正確,plan-only converter smoke 也無法通過。修法是新增 wildcard-aware path expansion helper:非 wildcard path 仍走既有 canonical `ConvertTo-AbsolutePath`;wildcard pattern 則只把相對 pattern anchor 到 `$RepoRoot`,保留 `*` / `?` 給 `Get-ChildItem -Path` 處理。
