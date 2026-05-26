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

- [ ] 6.1 跑 `gitnexus_impact` 對 `bim-streaming-server/source/extensions/ezplus.bim_review_stream.messaging/ezplus/bim_review_stream/messaging/` — 確認新加 module 不破現有 `carb.log_*` 路徑
- [ ] 6.2 實作 `StructLogger` class + `create_logger()` public API（與 TS API 對齊；method 命名用 snake_case）
- [ ] 6.3 stdlib `json` + `pathlib` + 自寫 daily rotate（不用 `TimedRotatingFileHandler`）
- [ ] 6.4 redaction helper（env value + data depth defense）
- [ ] 6.5 safe serializer：`default=lambda o: f"<unserializable:{type(o).__name__}>"`
- [ ] 6.6 fail-soft + `_recovery/` fallback + ring buffer
- [ ] 6.7 `create_logger()` return 前 emit `env_snapshot`
- [ ] 6.8 修改 `convert-ifc-to-usdc.ps1` 接 `--trace-id` 參數，傳給 Kit subprocess CLI（檢查既有 `start-streaming-server.ps1` / `start-host-native-conversion-service.ps1` 也要同步接 `BIM_TRACE_ID`）
- [ ] 6.9 修改 Kit ext entry point（`ezplus.bim_review_stream.messaging` setup）：startup 解析 `--trace-id`，建立 struct_logger 帶 trace_id；critical path（stage_management / stage_loading / conversion_authority）關鍵分支加 `struct_log` 呼叫，與 `carb.log_*` 並存
- [ ] 6.10 `source/extensions/ezplus.bim_review_stream.messaging/ezplus/bim_review_stream/messaging/tests/test_struct_log.py`（pytest）覆蓋與 §2.9 對等內容

## 7. PowerShell module — `scripts/lib/StructLog.psm1`

- [ ] 7.1 實作 `New-StructLogger -Service -Component -LogRoot` 工廠
- [ ] 7.2 實作 `Write-StructInfo` / `Write-StructWarn` / `Write-StructError` / `Write-StructAudit` / `Write-StructLifecycle` / `Write-StructAnomaly` / `Write-StructNetwork` / `Write-StructEnvSnapshot` 函式
- [ ] 7.3 `ConvertTo-Json -Compress -Depth 8` 一筆一行 + `Add-Content -LiteralPath` daily rotate
- [ ] 7.4 redaction helper `Get-RedactedEnvVar`
- [ ] 7.5 `New-StructLogger` return 前 emit `env_snapshot`
- [ ] 7.6 fail-soft：sink fail 寫 stderr、不 throw
- [ ] 7.7 接 `BIM_TRACE_ID` 環境變數作為 trace_id 預設值
- [ ] 7.8 `scripts/tests/StructLog.Tests.ps1`（Pester）覆蓋與 §2.9 對等內容

## 8. Retention script — `scripts/log-retention/prune-logs.ps1`

- [ ] 8.1 實作 prune 邏輯：scan `logs/<service>/<YYYY-MM-DD>/`，比較 date 與今日 UTC，>30 天列入刪除候選
- [ ] 8.2 `-DryRun`（預設）只列出；`-Apply` 才真砍
- [ ] 8.3 邊界：剛好 30 天的不砍、31 天的砍；不砍 `logs/` 本身、不砍 `<service>/` 本身
- [ ] 8.4 接受 `-LogRoot` 參數（預設 `./logs`）+ `-RetentionDays` 參數（預設 30，讀 `LOG_RETENTION_DAYS` env）
- [ ] 8.5 `scripts/log-retention/tests/Prune-Logs.Tests.ps1`（Pester）覆蓋：建假 fixture 含 5/15/30/45/60 天前的 dir，分別驗 `-DryRun` / `-Apply` 行為

## 9. Cross-service integration test

- [ ] 9.1 撰寫 `tests/integration/structured-log-cross-service.test.ts`（root Vitest）：
  - 啟 in-process coordinator + mock streaming-server outbound + mock viewer POST
  - 模擬 IFC-ready → conversion request → conversion result → session create → viewer log 完整流程
  - 驗：grep `trace_id` 跨 service 拉得到 records、ts 排序合理、`parent_trace_id` 串接正確
- [ ] 9.2 驗 viewer POST → coordinator 收 → 寫到 `logs/viewer/...`

## 10. Smoke / runtime evidence

- [ ] 10.1 本地完整跑一次 IFC-ready → conversion → session → close 閉環（用既有 fast MVP playbook）
- [ ] 10.2 驗 4 個 service 的 `logs/<service>/<date>/*.jsonl` 都產生
- [ ] 10.3 用 trace_id 跨 service grep 串得起來 timeline
- [ ] 10.4 驗 env_snapshot 4 個 service 都有寫、secret pattern key 不出現原值
- [ ] 10.5 撰寫 `docs/evidence/structured-log-baseline-2026-05-26.md` 記錄 evidence（含 `trace_id` 與 record 摘要）

## 11. Verification 與 PR

- [ ] 11.1 跑 `bim-review-coordinator` 內 `npm run verify`（= `npm run build && npm test`）— pass
- [ ] 11.2 跑 streaming-server pytest（依 `docs/agents/sub-repo-verify-commands.md`）— pass
- [ ] 11.3 跑 viewer build + test:session-first — pass
- [ ] 11.4 跑 root `python -m pytest tests -p no:cacheprovider`（用 `.venv\Scripts\python.exe`）— pass
- [ ] 11.5 跑 `openspec validate --specs --strict`：26 → 27 全 pass（新增 capability 1 個）
- [ ] 11.6 跑 `gitnexus_detect_changes` 確認本 change scope 與 design 一致；HIGH/CRITICAL 已處理
- [ ] 11.7 commit 前跑 `git diff --cached --check` 確認無 trailing whitespace
- [ ] 11.8 開 PR（draft → ready）；PR 描述包含 design / spec / tasks 對應、verification log 截圖、smoke evidence 連結
- [ ] 11.9 等 GitHub Actions / PR Review Gate / CodeRabbit 通過
- [ ] 11.10 Merge 後跑 OpenSpec sync/archive（依 `docs/agents/github-workflow.md`）
