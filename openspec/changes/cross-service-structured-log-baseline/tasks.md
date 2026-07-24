# cross-service-structured-log-baseline — Tasks

> 對應 spec：`specs/cross-service-structured-log-baseline/spec.md`
> 對應 design：`design.md` + `docs/superpowers/specs/2026-05-26-cross-service-structured-log-baseline-design.md`
> 完成準則：design §10 + spec requirements 全部覆蓋；root pytest / coordinator `npm run verify` / viewer build / streaming pytest / 4 個 contract test 全 pass。

## 1. Shared schema 契約與 fixtures

- [x] 1.1 撰寫 `docs/contracts/structured-log-schema.md` — 完整 schema、7 個 event_type、data sub-schema、redaction 規則、trace_id 命名約定、傳遞通道
- [x] 1.2 撰寫 `docs/contracts/structured-log-env-allowlist.md` — 列出 `NODE_ENV` / `STORAGE_ROOT` / `IFC_DOWNLOAD_STRICT` / `KIT_RUNTIME_PORT` / `COORDINATOR_PORT` / `VIEWER_PORT` / `LOG_RETENTION_DAYS` 等明碼 env，所有新增 env 必 PR 一併改本檔
- [x] 1.3 撰寫 `tests/contracts/structured-log/schema.json`（JSON Schema draft-07）覆蓋 7 個 event_type 與其 data sub-schema
- [x] 1.4 建 `tests/contracts/structured-log/fixtures/` 各 event_type 1~3 sample（合法 + edge case；至少 14 個 fixture）→ 17 valid + 6 invalid, all asserted by both Python & TS validators
- [x] 1.5 撰寫 TS contract validator → `bim-review-coordinator/tests/contracts/structured-log/validate.contract.test.ts`（Vitest + ajv，讀 root 共享 fixtures；root 無 Vitest setup，所以 host 在 coordinator package）
- [x] 1.6 撰寫 `tests/contracts/structured-log/test_validate.py`（root pytest，已用 `.venv` 內預裝 `jsonschema 4.25.1`）
- [x] 1.7 決定：Python 用 `jsonschema 4.25.1`（已在 root `.venv`，0 dep change）；TS 用 `ajv ^8.17.1` 作 coordinator `devDependencies`（ad-hoc draft-07 interpreter 風險高、ajv 是 Node 業界標準、僅 devDep 不進 production bundle）
- [x] 1.8 `.gitignore` 新增 `/logs/` 條目（連同來源註解指回 `docs/contracts/structured-log-schema.md` §6.1）

## 2. TypeScript adapter — coordinator (`bim-review-coordinator/src/lib/structLog.ts`)

- [x] 2.1 跑 `gitnexus_impact` 對 `EventLog` (Class) / `createCoordinatorApp` (Function) — 兩者 LOW risk / 0 upstream，安全進改寫
- [x] 2.2 實作 `createLogger(service, opts)` + public API（debug/info/warn/error/fatal/network/audit/lifecycle/anomaly/envSnapshot/withTraceId/writeRaw/noteDropped/flushAndClose）
- [x] 2.3 實作 `run_id` 生成（`run_<YYYYMMDD>_<HHMMSS>_<6 hex>`）
- [x] 2.4 實作 daily rotate（每筆檢查 date 跳變 → close 舊 stream / 開新）+ stdout dual sink（`process.stdout.write`）
- [x] 2.5 實作 `redactEnvValue(key, value)` + `redactDataBeforeWrite(data)` depth-defense（schema 欄位名白名單避免 `key`/`auth` 誤判 + circular ref 防護）
- [x] 2.6 實作 safe stringify wrapper（circular ref / BigInt / Date / Error serializer）
- [x] 2.7 實作 fail-soft sink failure handling + `_recovery/` fallback + ring buffer last 100
- [x] 2.8 `createLogger()` return 前 emit `env_snapshot`（test mode 跳過避免日誌污染）
- [x] 2.9 `tests/lib/structLog.test.ts` 16 tests pass — 覆蓋 schema 合規 / `withTraceId` child / redaction / circular / daily rotate / seq 遞增 / sink failure / writeRaw
- [x] 2.10 改寫 `src/index.ts` (1 處) / `src/app.ts` (2 處 auto-poll) / `src/services/eventLog.ts` (2 處 malformed/legacy) 的 `console.*` 到 `structLog`（structLog 注入透過 EventLog options，向後相容）

## 3. coordinator viewer-log intake + health endpoint

- [x] 3.1 加 `POST /api/internal/viewer-log`：256 KiB body limit + 500 records/batch 上限；white-list bypass internal-auth middleware（local-dev-only baseline）；`validateLogRecordBasic` runtime 檢查 + `persistRecordsToServicePaths` 寫 `logs/viewer/<date>/viewer-<run_id>.jsonl`；413 body / 400 non-array / 413 too-many-records 全覆蓋
- [x] 3.2 加 `GET /api/internal/structLog/health`：回 `{run_id, current_file, records_written, records_dropped, last_failure, viewer_intake: {records_received, records_accepted, records_dropped, ...}}`
- [x] 3.3 + 3.4 `tests/app/viewerLogIntake.test.ts` 7 tests pass — 10 valid → 200 + 10 lines、混合 valid/invalid → 200 + 8 lines + dropped 累計、非 array → 400、oversized body → 413、太多 records → 413、health endpoint 必填欄位齊全、dropped counter 跨 request 累積正確

## 4. coordinator EventLog 雙 sink mirror

- [x] 4.1 在 `src/services/eventLog.ts` `append()` 既有路徑後加 `structLog.lifecycle(...)` 呼叫（透過 `mirrorToStructuredLog` private method，best-effort try/catch 不影響 caller）
- [x] 4.2 撰寫 EventLog event type → `(subject_kind, phase)` 對應表並寫進 `docs/contracts/structured-log-schema.md` §9 + `STRUCTURED_LIFECYCLE_MAP` constant：
  - `sessionCreated` → `subject_kind=review_session, phase=start`
  - `sessionActive` → `subject_kind=review_session, phase=active`
  - `sessionClosing` → `subject_kind=review_session, phase=closing`
  - `sessionClosed` → `subject_kind=review_session, phase=closed`
  - `kitInstanceReleased` → `subject_kind=kit_subprocess, phase=closed`
  - `kitInstancesReleased` → `subject_kind=kit_subprocess, phase=closed`（多 kit 一筆 record）
- [x] 4.3 `tests/services/eventLogMirror.test.ts` 4 tests pass — 涵蓋 sessionCreated → lifecycle start、6 個 type 對應 subject_kind/phase、無 logger backward compat、storage/event-log/ 檔案 shape 不變

## 5. Browser adapter — viewer (`web-viewer-sample/src/lib/structLog.ts`)

- [x] 5.1 viewer src/lib 為新檔，跳 GitNexus impact（新建 module 0 upstream 風險）；既有 src/lib 目錄當前無其他模組
- [x] 5.2 實作 `createBrowserLogger(opts)` + public API 對齊 coordinator（debug/info/warn/error/fatal/network/lifecycle/anomaly/setTraceId/flush/tail/shutdown）
- [x] 5.3 實作 ring buffer（default capacity 500）+ flush trigger 三條件（≥50 records / 2s timer / explicit flush()）
- [x] 5.4 實作預設 fetch transport + 注入式 transport；失敗 retain ≤ 5 min（`retainOnFailureMs`）；buffer 滿丟最舊；指數 backoff up to 3 attempts
- [x] 5.5 `installGlobalHandlers(logger, win)` 接 `window.addEventListener('error', ...)` + `unhandledrejection` 自動產 `logic_error`；可被測試環境注入 win
- [x] 5.6 `installGlobalHandlers` 同時暴露 `window.__structLog = { logger, tail(n) }` 供 Chrome MCP / dev console inspect
- [x] 5.7 `scripts/verify-struct-log.mjs` 10 tests pass — run_id pattern、isoUtcMs ms precision、6 個 helper event_type、auto-flush at threshold、ring buffer 丟最舊、retainOnFailureMs 過期、tail() 抓尾、setTraceId rotate per-trace seq；wire 進 `npm run verify`

## 6. Python adapter — streaming-server (`bim-streaming-server/source/extensions/.../struct_log.py`)

- [x] 6.1 新增為 NEW module；不 import omni/carb；既有 `carb.log_*` 並存。Kit ext entry hook (`kit_struct_log.py`) 為 sibling module，由 `extension.py` 用 `from . import kit_struct_log` 載入；不改任何既有 function/class 簽章
- [x] 6.2 純 Python `StructLogger` class + `create_logger()` API 對齊 TS adapter（snake_case helpers：debug/info/warn/error/fatal/network/audit/lifecycle/anomaly/env_snapshot/with_trace_id/flush_and_close）
- [x] 6.3 stdlib `json` + `pathlib` + 自寫 daily rotate（每筆檢查 ts 日期）；threading.Lock 保護 seq counter
- [x] 6.4 `redact_env_value` 三段規則 + `redact_data_before_write` 深度防護（schema 欄位白名單避免 `key`/`auth` 誤判；recursion seen set 防 circular）
- [x] 6.5 `safe_dumps` + `_safe_default` 處理 datetime / BaseException / bytes / 無法序列化物件
- [x] 6.6 fail-soft sink：主檔失敗轉寫 `_recovery/` + ring buffer (deque maxlen=100) + last_failure 記時間 + 原因；不 throw
- [x] 6.7 `create_logger()` return 前自動 emit `env_snapshot`（測試可 `skip_env_snapshot=True`）
- [x] 6.8 `bim-streaming-server/scripts/convert-ifc-to-usdc.ps1` 加 `-TraceId` 參數；effective trace 優先序：參數 → `BIM_TRACE_ID` env → 空；非空時透過 `--trace-id "<id>"` 注入 Kit subprocess 的 exec script
- [x] 6.9 新增 `kit_struct_log.py` Kit-side bootstrap：解析 `sys.argv` 的 `--trace-id`（space + equals 兩種形式）/ fallback `BIM_TRACE_ID` env；singleton `get_logger()`；`log_kit_startup_lifecycle()` / `log_kit_shutdown_lifecycle()`。`extension.py` 的 `Extension.on_startup` / `on_shutdown` 加 lifecycle 呼叫（additive，不動既有 manager 邏輯）
- [x] 6.10 兩份 root pytest（在 root 跑而非 Kit harness，避開 omni/carb 載入）：`tests/contracts/structured-log/test_python_adapter.py` 18 tests pass（schema/runid/redaction/with_trace_id/circular/cross-midnight/sink-fail/BIM_TRACE_ID env/invalid run_id/invalid service）；`tests/contracts/structured-log/test_python_kit_bootstrap.py` 6 tests pass（argv space/equals form parse / BIM_TRACE_ID fallback / singleton / lifecycle helpers emit）。Kit harness 內 in-Kit critical path coverage 留 group 9 smoke evidence

## 7. PowerShell module — `scripts/lib/StructLog.psm1`

- [x] 7.1 `New-StructLogger -Service -Component -LogRoot` 工廠（自帶 InitialTraceId / Now / BufferLimit / AllowListPath / SkipEnvSnapshot / InMemoryOnly / RecordSink 旗標）
- [x] 7.2 全部 8 個 `Write-Struct*` helper（Debug/Info/Warn/Error/Fatal + Network/Audit/Lifecycle/Anomaly + EnvSnapshot）；皆可用 pipeline `$logger | Write-StructXxx`
- [x] 7.3 `ConvertTo-Json -Compress -Depth 8` 單行 + `Add-Content -LiteralPath` daily rotate；夜過午檢查 `Record.ts.Substring(0,10)`，跨日改寫新檔
- [x] 7.4 `Get-RedactedEnvVar` + `ConvertTo-StructLogRedactedData` (schema 欄位 reserve-list 含 `key`/`auth`/`status` 避免誤判) + 循環/OrderedDictionary 防護
- [x] 7.5 `New-StructLogger` return 前自動 `Write-StructEnvSnapshot`（test 可加 `-SkipEnvSnapshot`）
- [x] 7.6 fail-soft：sink fail 寫 stderr、降級進 `_recovery/`、ring buffer 100、`LastFailure` 記時間 + 原因
- [x] 7.7 啟動時若 `BIM_TRACE_ID` 環境變數有設定即取作為 InitialTraceId
- [x] 7.8 `scripts/tests/test-struct-log.ps1` (plain assert pattern, 對齊既有 test-smoke-evidence.ps1) — 13 tests pass: run id 規範、ISO 時間、env redaction 三段、circular/ordered dict 防護、ConvertTo-StructLogRedactedData 保留 `vars[].key`、env_snapshot 命中 secret pattern 不洩漏值、全 8 helper 對應 event_type、`BIM_TRACE_ID` 沿用、seq per trace_id、跨午夜 rotate、sink failure fail-soft

## 8. Retention script — `scripts/log-retention/prune-logs.ps1`

- [x] 8.1 Scan `<LogRoot>/<service>/<YYYY-MM-DD>/`，跳 `_recovery/` 與非日期目錄；UTC `Today - RetentionDays = cutoff`，`entryDate < cutoff` 進刪除候選
- [x] 8.2 預設 dry-run（only logs `WOULD`），`-Apply` 才真執行 `Remove-Item -Recurse -Force`；輸出 `[pscustomobject]` 含 `candidate_count / deleted_count / skipped_count`
- [x] 8.3 邊界：30 天剛好留、31 天砍；不砍 `LogRoot` 自己、不砍 `<service>/` 自己、不砍 `_recovery/` 與非 YYYY-MM-DD 目錄
- [x] 8.4 接受 `-LogRoot`（fallback `LOG_ROOT` env / `<repo-root>/logs`）+ `-RetentionDays`（fallback `LOG_RETENTION_DAYS` env / 30）+ `-TodayUtc`（test-only 替換 today）+ `-Quiet`
- [x] 8.5 `scripts/log-retention/tests/test-prune-logs.ps1` 5 tests pass — dry-run 不動、apply 刪 >30 天、保 5/15/30 + `_recovery/` + 非日期、custom 14 天 cutoff 改寫候選數、missing log root 零 count、`LOG_RETENTION_DAYS` env 沿用

## 9. Cross-service integration test

- [x] 9.1 `tests/contracts/structured-log/test_cross_service_integration.py` 3 tests pass — host 在 root pytest（非 root Vitest，因 root 無 Vitest 基礎建設；coordinator 內 vitest 改在 group 3 已驗端到端 viewer-log → file persistence）。模擬 4 個 sub-repo 全部寫入同一 LOG_ROOT 後 grep trace_id：(a) 全 4 service 各自有 record、ts 可排序、全部過 schema (8 records, 4 services)；(b) `parent_trace_id` 鏈接 `rev_*` 到上游 `ifcready_*`；(c) 倒序寫入後 sorted-by-ts 仍能還原 start→end timeline
- [x] 9.2 viewer POST → coordinator 收 → 寫到 `logs/viewer/...` 在 group 3 `bim-review-coordinator/tests/app/viewerLogIntake.test.ts` 7 tests 已驗（10 valid → 1 jsonl with 10 lines、混合 → drop counter、413、400、跨 request dropped 累積）

## 10. Smoke / runtime evidence

- [ ] 10.0.1 Coordinator production carrier：IFC-ready root trace → conversion `X-Trace-Id`，並保留到 review session/open payload與 viewer URL；補 unit/integration tests
- [ ] 10.0.2 Streaming production carrier：驗證/持久化 inbound trace，conversion lifecycle與 converter `-TraceId` / `BIM_TRACE_ID` 承襲；無 inbound 才 mint fallback；補 tests
- [ ] 10.0.3 Viewer production wiring：`createBrowserLogger()` return 前 emit browser-safe `env_snapshot`；`main.tsx` 建 singleton、安裝 global handlers並從合法 query carrier採用 root trace；補 verify/tests
- [ ] 10.0.4 PowerShell production smoke participant：`scripts/smoke-bscheme-intake.ps1` 建 logger，取得 intake response後切換 root trace並記 poll/session/close；補 narrow script test
- [ ] 10.0.5 Cross-service integration：不得人工注入四份 record；驗 coordinator HTTP header、streaming persisted trace、viewer query/bootstrap、PowerShell runner handoff使用同一 root trace
- [ ] 10.1 本地完整跑一次 IFC-ready → conversion → session → close 閉環（用既有 fast MVP playbook）
- [ ] 10.2 驗 4 個 service 的 `logs/<service>/<date>/*.jsonl` 都產生
- [ ] 10.3 用 trace_id 跨 service grep 串得起來 timeline
- [ ] 10.4 驗 env_snapshot 4 個 service 都有寫、secret pattern key 不出現原值
- [ ] 10.5 撰寫 `docs/evidence/structured-log-baseline-2026-05-26.md` 記錄 evidence（含 `trace_id` 與 record 摘要）

## 11. Verification 與 PR

- [x] 11.1 `bim-review-coordinator` `npm run verify` (build + 241 tests pass)
- [x] 11.2 streaming-server 改動由 root pytest 24 tests 覆蓋（純 Python adapter + Kit bootstrap，不需 Kit harness）。Kit ext entry hook 為 additive lifecycle 呼叫；in-Kit 完整 critical path 驗證留 group 10 smoke evidence
- [x] 11.3 viewer `npm run verify` (vite build + verify-struct-log 10 + session-first + tri-ready-states 全 pass)
- [x] 11.4 root `python -m pytest tests -p no:cacheprovider`：65 pass (既有 9 + 新 56)
- [x] 11.5 `openspec validate --specs --strict`：27 → **28 pass**（新增 capability `cross-service-structured-log-baseline`）
- [x] 11.6 GitNexus re-analyze 完成後（worktree 索引到 `c8a0723`，2 commits behind HEAD 但皆是 tests/docs）：`gitnexus detect_changes` → 2 files changed / 0 changed_symbols / 0 affected processes / risk=LOW。對 `EventLog` (Class) + `createCoordinatorApp` (Function) 跑 `gitnexus_impact` upstream → 兩者都 risk=LOW / impactedCount=0，確認 backward-compatible additive args 沒影響任何 caller
- [x] 11.7 每次 commit 前 `git diff --cached --check` exit=0 確認無 trailing whitespace
- [x] 11.8 開 [PR #126](https://github.com/monkey1sai/AI-BIM-governance/pull/126)，body 含 design / spec / tasks 對應、verification 摘要、capability change 摘要、smoke evidence deferred 註記。Draft → Ready-for-review transition 完成（`gh pr ready 126`）
- [x] 11.9 GitHub Actions / PR Review Gate / CodeRabbit 通過（PR #126，2026-05-27；本次 historical correction 以 `gh pr view 126` 重驗）
- [x] 11.10 Merge 後已完成 OpenSpec sync/archive；2026-07-24 僅因 runtime evidence 未完成而恢復 deferred，不回滾已同步 canonical spec
