## Why

fast-mvp loop 收尾後(PR #94/#95/#96/#98 + archive PR #97/#99 全 merged,2026-05-22 L4 zero-touch end-to-end 跑通),user 用 341MB 真實 IFC 跑時得到 `conversion_status: failed`。從 streaming-server result 看,error 訊息只有 ps1 line 316 throw 的字串:

```
convert-ifc-to-usdc.ps1:316: throw "Kit CAD conversion completed but output was not created: <path>"
```

意思是 Kit subprocess 自己 **`exit 0`**(line 312 沒 throw),但**沒寫出 model.usdc**。沒任何 Kit 內部 log。

根因:`bim-streaming-server/scripts/convert-ifc-to-usdc.ps1` line 288-295 用 `[System.Diagnostics.Process]::Start($startInfo)`,**沒設 `RedirectStandardOutput` / `RedirectStandardError`**,Kit 內部任何 stdout/stderr 直接寫到主控台(被吞)沒進 conversion result。對齊 file 不存在的 throw 之後完全沒 debug 線索。

對 fast-mvp 後續 debug 任何「Kit silently exit 0 但沒寫 output」這類 silent failure,需要先把 Kit subprocess output capture 起來。本 change 加觀察性,不嘗試 fix Kit 本身的問題。

## What Changes

### 修改 — `bim-streaming-server/scripts/convert-ifc-to-usdc.ps1`

- Kit subprocess 啟動前 `$startInfo.RedirectStandardOutput = $true; $startInfo.RedirectStandardError = $true`
- 用 async `add_OutputDataReceived` / `add_ErrorDataReceived` + `StreamWriter` 把 lines 寫到 artifact dir 內(避免 sync read deadlock 當 buffer 滿)
  - `kit-stdout.log`:Kit 全部 stdout
  - `kit-stderr.log`:Kit 全部 stderr
- 兩個 log 都 flush + close 在 `WaitForExit` 後 / finally 內
- 失敗 throw 時(line 312 exit code ≠ 0 或 line 315 file 不存在),把:
  - stderr 最後 100 行
  - stdout 最後 50 行
  - 連同既有 throw 字串 + log 完整路徑
  附在 exception message 內(operator 直接從 error message 看 Kit 真實錯誤)
- 成功(USDC 寫出來)也保留 log file(對 baseline 對比有用,不刪)

### 修改 — `bim-streaming-server/source/.../ifc2usdc_powershell_adapter.py`

- `Ifc2UsdcPowershellConverterAdapter.convert` 在 PowerShell subprocess fail 拋 `ConversionAuthorityError` 時,result error 加兩個欄位:
  - `kit_stdout_log`:host absolute path
  - `kit_stderr_log`:host absolute path
- coordinator 端(以及任何透過 `GET /api/conversions/<id>/result` 的 caller)能直接拿到 log path 去 `tail` 看完整 Kit output

### 加 — pytest 覆蓋

- `bim-streaming-server/tests/test_host_native_conversion_service.py` 加 case:
  - fake converter 模擬 ps1 fail(`ConversionAuthorityError("converter_failed", "...stderr tail...")` + stdout/stderr log paths 存在)
  - result error 內含 `kit_stdout_log` / `kit_stderr_log` 欄位
- 既有 31 streaming-server tests 不破

### OpenSpec spec delta

- `openspec/changes/streaming-server-capture-kit-conversion-logs/specs/streaming-ifc-usdc-conversion-authority/spec.md`:
  - `## MODIFIED Requirements`:`Conversion failures expose actionable diagnostic`(或對應既有 requirement)— 加 SHALL 捕獲 Kit subprocess stdout/stderr 並提供 log path

### 明確排除(本 change 不做)

- 不嘗試解 Kit 自己為什麼 silent fail(本 change 加觀察性,debug 留下一個 change 用本 change 拿到的 log 分析)
- 不改 timeout default(600s)
- 不改 dispatch / auto-poll / ingest 邏輯
- 不引入 metric / OTEL / 集中 log aggregation(log 留 artifact dir)
- 不對 stdout/stderr log 做 retention policy(與既有 artifact 生命週期一致)

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `streaming-ifc-usdc-conversion-authority`:MODIFIED 1 個 requirement(conversion 失敗 SHALL 暴露 Kit subprocess 完整 stdout/stderr log path + tail 摘要)

### Removed Capabilities

- None.

## Impact

- Owner repo/folder:`bim-streaming-server/scripts/`、`bim-streaming-server/source/extensions/ezplus.bim_review_stream.messaging/`、`bim-streaming-server/tests/`
- API:streaming-server `GET /api/conversions/<id>/result` response 內 `error` 物件加 `kit_stdout_log` / `kit_stderr_log` 兩個欄位(optional;只在 converter_failed 時帶);coordinator callback outbox payload 不變(metadata-only 原則,log path 屬 diagnostic 不轉發)
- Data structure:artifact dir 內多兩個 file(`kit-stdout.log` / `kit-stderr.log`),與 USDC 同生命週期
- Affected integration:coordinator 端只 propagate result error;不主動 fetch log content(避免雲端 callback 變肥)
- Affected symbols(apply 前需 GitNexus impact analysis):`Ifc2UsdcPowershellConverterAdapter._run_powershell_conversion` / `.convert`、ps1 內 Kit subprocess invoke 段
- Tests/contracts:streaming-server pytest 加 2-3 case;既有 31 + coordinator 173 不破
- Dependencies:無新 prod dependency(PowerShell .NET Process async API + Python file I/O)
- Predecessor:`coordinator-auto-poll-streaming-conversion`(archive PR #99,2026-05-22 merged)
- Acceptance verification:L1 streaming-server pytest 全綠;L4 重跑 user 341MB IFC 看 result error 是否含 stdout/stderr log path,human read Kit 真實錯誤 → 知道為何 silent fail
- Brainstorming source-of-truth:本次對話 explore Round 1+2;user Postman 截圖(2026-05-22)顯示 341MB IFC conversion failed without Kit detail
