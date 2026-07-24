# cross-service-structured-log-baseline — Proposal

> **Status: active completion amendment approved 2026-07-24**：使用者選擇 option A，授權限縮修改 production trace carriers、viewer logger bootstrap/env snapshot，以及受支援 PowerShell smoke participant，直到 tasks 10.0–10.5 的真 4-service runtime evidence閉合。

> **Historical correction 2026-07-24**：本 change 曾在缺少 runtime evidence 時被 archive；現依嚴格 terminal rule恢復原 change id。既有 adapters/contracts不得重寫；但四單位 production closed loop缺少的 carrier/wiring 已由使用者明確批准補齊。既有 delta 已同步至 `openspec/specs/cross-service-structured-log-baseline/`，本 amendment必須同步維護 canonical spec，最終 archive使用 `--skip-specs` 並以 byte-identical diff作硬 gate，避免重複套用舊 delta。

## Why

目前 4 個執行單元（coordinator TypeScript、streaming-server Python/Kit、web-viewer-sample Browser、PowerShell scripts）各自用 `console.*` / `carb.log_*` / `Add-Content` / `kit-stdout.log` / `.run/*.log.err` 寫 log，沒有共用 schema、沒有跨服務 `trace_id`、沒有 env snapshot、沒有統一 retention 規則。agent 在跨服務 incident 追蹤時必須手動 join 多個格式不同的 log 來源；env 設定誤差只能靠口頭釐清；roadmap 候選 #8 `observability-audit-baseline`（Prometheus / Grafana / Loki）要等 Phase 6 才解凍，目前夾在「無基線」與「過早全套上 stack」之間。本 change 建立可給 #8 直接掃的 baseline，把 schema、trace_id 命名、env redaction、檔案佈局一次落定，後續 Loki promtail 接上不需改 schema。

## What Changes

- 新增跨語言共用的 **JSON Schema**（`docs/contracts/structured-log-schema.md` + `tests/contracts/structured-log/schema.json`），7 個 `event_type`（`logic_error` / `operation_anomaly` / `env_snapshot` / `lifecycle` / `audit` / `network` / `general`）與 5 個 `level`。
- 新增 **env allow-list 規格**：`docs/contracts/structured-log-env-allowlist.md` 唯一來源，allow-list 之外 + 命中 secret pattern 寫 `[REDACTED:type=…,len=…]`，其餘寫 type+length。
- 新增 **4 個 thin adapter**（同語意 API，跨語言對齊）：
  - `bim-review-coordinator/src/lib/structLog.ts`（TypeScript）
  - `bim-streaming-server/source/extensions/ezplus.bim_review_stream.messaging/.../struct_log.py`（Python，與既有 `carb.log_*` 並存）
  - `scripts/lib/StructLog.psm1`（PowerShell module）
  - `web-viewer-sample/src/lib/structLog.ts`（Browser，buffer + POST coordinator）
- 新增 **viewer-log intake endpoint** `POST /api/internal/viewer-log` 於 coordinator（local-dev-only baseline，**不**加 internal token，做基本 schema validation 擋亂寫；production hardening 屬 future）。
- 新增 **logger health endpoint** `GET /api/internal/structLog/health` 於 coordinator。
- 新增 **trace_id 命名規約**：`ifcready_<job_id>` / `rev_<session_id>` / `stream_conv_<job_id>` / `script_<run_id>`，配 `parent_trace_id` 串多層關係。
- 新增 **trace_id 跨通道傳遞**：HTTP `X-Trace-Id` header / Socket.IO event field / WebRTC DataChannel envelope field / Kit subprocess `--trace-id` CLI arg / PowerShell `BIM_TRACE_ID` env var。
- 補齊 **production carrier wiring**：IFC-ready job id 作 root trace，coordinator dispatch、streaming persisted job/converter、review session/viewer URL、viewer bootstrap與受支援 smoke runner全部承襲同一 trace；standalone session/conversion才自 mint `rev_*` / `stream_conv_*`。
- 補齊 viewer `createBrowserLogger()` 自動 browser-safe `env_snapshot` 與 production singleton/global handlers；不得掃描任意 browser storage/query payload。
- 新增 **retention script** `scripts/log-retention/prune-logs.ps1`：daily dir + 30 天 cutoff，預設 `-DryRun`。
- 新增 `.gitignore` 條目 `/logs/`。
- coordinator 既有 `EventLog` (`storage/event-log/*.jsonl`) **不動**；在 `EventLog.append()` 既有路徑後追加 `structLog.lifecycle(...)` 雙 sink。`/api/.../lifecycle-events` API 不變。
- streaming-server `carb.log_*`（48 處）**不動**並存；critical path 額外呼 `struct_log`。
- coordinator 既有 `console.log/warn/error`（6 處）漸進改寫到 `structLog`：`app.ts` / `index.ts` / `eventLog.ts` 本 change 改完，其餘服務 file 留後續 PR。
- 新增 **跨語言 contract test fixtures**：`tests/contracts/structured-log/fixtures/*.jsonl`，4 個 adapter 各自的 validator 共用同一份 fixture。

非 breaking change：既有 endpoint / event schema / API 一律不破。新加 endpoint 與 module 為 additive。

## Capabilities

### New Capabilities

- `cross-service-structured-log-baseline`：建立跨 4 個執行單元的 structured log 共用 schema、trace_id 命名與傳遞、env snapshot redaction、本地 file 佈局、retention 規約，與既有 `EventLog` / `carb.log_*` 並存。

### Modified Capabilities

（無：本 change 不改既有 `openspec/specs/` 任何 capability 的 requirement。`review-session-request-lifecycle` 的 lifecycle audit endpoint 行為不變；既有 EventLog 不變。新 baseline 是 additive，雙 sink 共存。）

## Impact

**Code（新增）**
- `bim-review-coordinator/src/lib/structLog.ts`（adapter）
- `bim-review-coordinator/src/app.ts`（新加 viewer-log intake endpoint + health endpoint + 改寫 `console.*`）
- `bim-review-coordinator/src/index.ts`（改寫 `console.*` 到 structLog；啟動時建 logger 並 env snapshot）
- `bim-review-coordinator/src/services/eventLog.ts`（雙 sink lifecycle mirror）
- `bim-streaming-server/source/extensions/ezplus.bim_review_stream.messaging/ezplus/bim_review_stream/messaging/struct_log.py`（adapter）
- `bim-streaming-server/scripts/convert-ifc-to-usdc.ps1`（吃 `--trace-id` 參數轉發給 Kit subprocess）
- `web-viewer-sample/src/lib/structLog.ts`（adapter）
- `scripts/lib/StructLog.psm1`（adapter）
- `scripts/log-retention/prune-logs.ps1`
- `scripts/log-retention/tests/Prune-Logs.Tests.ps1`
- `tests/contracts/structured-log/schema.json`
- `tests/contracts/structured-log/fixtures/*.jsonl`
- `tests/contracts/structured-log/validate.contract.test.ts`（root Vitest）
- `tests/contracts/structured-log/test_validate.py`（root pytest）
- `tests/integration/structured-log-cross-service.test.ts`
- 各 sub-repo 內 adapter unit test 檔（位置見 design §6.2）

**Code（2026-07-24 completion amendment 修改）**
- coordinator IFC-ready pipeline、streaming conversion client、review-session/open payload carrier與測試
- streaming conversion authority/job persistence、converter `TraceId` propagation與測試
- viewer production bootstrap、browser env snapshot與測試
- `scripts/smoke-bscheme-intake.ps1` structured-log participation與測試

**Docs（新增）**
- `docs/contracts/structured-log-schema.md`
- `docs/contracts/structured-log-env-allowlist.md`
- `docs/superpowers/specs/2026-05-26-cross-service-structured-log-baseline-design.md`（已 commit）
- `docs/evidence/structured-log-baseline-2026-05-26.md`（smoke evidence，apply 階段補）

**Boundary 對齊**
- coordinator 仍是 viewer 唯一可達 service（`bim-review-coordinator/CLAUDE.md`）；新加 internal endpoint 不改 viewer 必須走 coordinator 的邊界。
- streaming-server 不直接受 viewer 流量（不變）。
- 外部 cloud callback outbox payload 加 `trace_id` field（schema additive；外部 cloud 不一定理會）。
- 外部 IFC Worker 不要求帶 `X-Trace-Id`；若未帶，coordinator 用既有 `ifc_ready_job_id` 起 trace。

**API 變更摘要**
- **新增** `POST /api/internal/viewer-log`（coordinator）：接 LogRecord 陣列，內部使用，無 auth。
- **新增** `GET /api/internal/structLog/health`（coordinator）：回 logger health metadata。
- **保留** 既有 `/api/external/ifc-ready` / `/api/review-sessions/*` / `/api/.../lifecycle-events` 行為與 schema 不變。
- **新增** request header `X-Trace-Id` 為 coordinator / streaming-server inbound 與 outbound 標準 header（無 header 時退回 derive from existing id）。

**Dependencies**
- 不新增任何 production dependency。
- 測試端可能加：root level 若無 `ajv`（TS）/`jsonschema`（Python）需評估；首選用 ad-hoc validator 避免新加 dep（design §6.1 提供兩種方案，apply 時定）。

**非 goals**
- 不上 Prometheus / Grafana / Loki / OpenTelemetry SDK（屬 roadmap #8）。
- 不替代既有 `EventLog`、不破 `/api/.../lifecycle-events` 的 schema 與 audit endpoint 行為。
- 不取消 `carb.log_*`（Kit ext 內部觀察）。
- 不取代 `kit-stdout.log` / `kit-stderr.log` 既有 capture（雙 sink redundancy）。
- viewer-log endpoint **不**加 auth（local-dev-only baseline，production hardening 留後續 change）。
- 不在本 change 設計 production retention / 集中 log 服務（手動 prune script + Windows 任務排程）。

**Risk**
- Boundary：viewer-log endpoint 在 LAN 內無 auth，依賴部署在 `127.0.0.1:5173` 與 `127.0.0.1:8004`；production 上線前必補。
- Operational：4 adapter 各自實作 schema → 漂移風險，靠跨語言共用 fixtures 與 contract test 阻擋。
- Performance：每筆 log 多寫 file + JSON serialize；4 adapter 都 fail-soft，不阻塞主流程。Kit ext 內 hot loop 預設 `debug` 關，且 `struct_log` 與 `carb.log_*` 是各自獨立 sink，無相互拖累。
