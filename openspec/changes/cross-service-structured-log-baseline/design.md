# cross-service-structured-log-baseline — Design

> 完整 brainstorm design 見 `docs/superpowers/specs/2026-05-26-cross-service-structured-log-baseline-design.md`（530 行；含 schema 詳表、4 adapter API、data flow timeline 範例、error handling 7 條、testing 6 層）。本檔提供 OpenSpec apply 階段必須先對齊的**決策與權衡**摘要。

## Context

AI-BIM-governance workspace 由 4 個執行單元構成：bim-review-coordinator（TypeScript）、bim-streaming-server（Python / Kit ext）、web-viewer-sample（Browser）、PowerShell scripts。目前 logging 散落在：

- coordinator：6 處 `console.*` + 自寫 `EventLog`（session lifecycle JSONL in `storage/`）
- streaming-server：48 處 `carb.log_*`
- Kit subprocess：`convert-ifc-to-usdc.ps1` async capture 到 `kit-stdout.log` / `kit-stderr.log`（archive `streaming-server-capture-kit-conversion-logs`）
- PowerShell：`.run/*.log.err`

無共用 schema、無跨服務 `trace_id`、無啟動 env snapshot、無統一 retention。roadmap 候選 #8 `observability-audit-baseline`（Prometheus / Grafana / Loki）目前 Phase 6 凍結。

source of truth：bim-streaming-server 對 conversion job / Kit subprocess 行為，coordinator 對 session / IFC-ready intake，外部 cloud control-plane 對 metadata 與 callback ack。新 log baseline **不**改變 source of truth 歸屬。

## Goals / Non-Goals

**Goals：**
- 4 個執行單元共用一份 JSON Schema 與 7 個 `event_type`（`logic_error` / `operation_anomaly` / `env_snapshot` / `lifecycle` / `audit` / `network` / `general`）。
- `trace_id` 跨 HTTP / Socket.IO / WebRTC DataChannel / Kit subprocess CLI / PowerShell env 串聯；agent 用一個 grep 拉齊 4 個 service timeline。
- 啟動時 emit `env_snapshot`，allow-list 之外 + secret pattern 一律 `[REDACTED:type,len]`，其餘 type+length，不寫原值。
- 檔案佈局 `logs/<service>/YYYY-MM-DD/<service>-<run_id>.jsonl` + stdout dual sink，daily dir 為 retention 單位。
- schema 設計為 Loki promtail 上 #8 時不需改 schema、只需加 promtail config。
- 與既有 `EventLog` / `carb.log_*` / `kit-stdout.log` 並存，不破任何既有 endpoint / event schema。

**Non-Goals：**
- 不上 Prometheus `/metrics`、不上 Loki、不上 Grafana、不上 OpenTelemetry SDK（屬 roadmap #8 範圍）。
- 不取消 `carb.log_*`（Kit ext 內部觀察通道）、不取消 `kit-stdout.log` / `kit-stderr.log` 既有 capture。
- 不替代 coordinator `EventLog`、不破 `/api/.../lifecycle-events` schema / 行為。
- 不加 viewer-log endpoint 的 auth（local-dev-only baseline；production hardening 屬未來 change）。
- 不在本 change 設計集中 log 服務 / production retention 自動化（手動 prune script + Windows 任務排程）。
- 不引入任何 production dependency。
- 不改 source of truth 歸屬。

## Decisions

### D1：4 個 adapter 各自獨立實作，不共享 code

跨語言共享 code 等於 IPC，得不償失。共享的是文字契約：
- `docs/contracts/structured-log-schema.md`：7 個 event_type 與 data sub-schema 定義
- `docs/contracts/structured-log-env-allowlist.md`：env redaction allow-list 唯一來源
- `tests/contracts/structured-log/{schema.json, fixtures/*.jsonl}`：4 adapter 共用 fixture，各自的 validator 驗

**Alternatives considered：**
- B：pino + structlog + PSFramework — 3 個新 production dep，違反「不新增 prod dep 不解釋」原則，且 structlog 與 `carb.log_*` 重疊。
- C：服務只 stdout JSON，外掛 collector 集中寫 file — 需先把 collector 跑起來；多 process 拼 stdout 容易亂行；Karpathy 「最小可運作」不滿足。

**選 A 理由：** 既有 `EventLog` 已驗證 thin JSONL adapter 在 coordinator 可行；4 adapter 各約 80~120 行；0 new dep；roadmap #8 上 promtail 不改 schema。

### D2：`event_type` 7 類（`general` 作為 raw `debug/info/warn` 預設）

`logic_error` / `operation_anomaly` / `env_snapshot` / `lifecycle` / `audit` / `network` 是有 required `data` sub-schema 的「語意 event」；`general` 是無 required keys 的 fallback，給 raw `logger.info('something')` 使用。raw `error` / `fatal` 預設 `logic_error`（caller 傳 `Error` 物件自動填 `error.{name,message,stack_tail}`）。

**Alternatives：**
- 強制 caller 顯式傳 event_type — API 太囉嗦，每筆都要選；違反 thin adapter 精神。
- 不要 `general`，所有 raw call 都 throw — 破 fail-soft 原則。

### D3：`trace_id` 命名沿用既有 id，前綴標來源

- `ifcready_<existing_job_id>`：coordinator IFC-ready intake 起源
- `rev_<existing_session_id>`：review session（mint 新 id；`parent_trace_id` 連到 `ifcready_`）
- `stream_conv_<existing_job_id>`：internal conversion
- `script_<run_id>`：pure PowerShell scripts

**為何不用 W3C `traceparent` (32 hex)：** dev 期無人股 OpenTelemetry SDK；用既有 id 讀得懂、grep 友善。#8 上 OTel 時 schema additive 加 `traceparent` 欄位，現有不破。

### D4：viewer 不寫 local file，靠 coordinator endpoint 中繼

Browser 不能寫 file system。新加 `POST /api/internal/viewer-log` 於 coordinator：buffer 500 records / 2 秒 / 50 筆三選一條件 flush。失敗：保留 buffer 5 min 並 `console.error` fallback。

viewer 本來就只能跟 coordinator 通訊（`bim-review-coordinator/CLAUDE.md` 邊界），加 internal endpoint 不破 boundary。

**Alternatives：**
- viewer 寫 IndexedDB → 定期匯出 — 需要使用者操作；agent 取不到
- viewer 直連 streaming-server log endpoint — 破現有 boundary（viewer 不直接寫 streaming-server）

### D5：viewer-log endpoint **不**加 internal token

Local-dev-only baseline。endpoint 做基本 schema validation（drop oversized / malformed records），不加 auth。

**Trade-off：** LAN 內任何 device 可 POST 任意 JSON 進來；接受該 risk，因部署綁 `127.0.0.1:8004`。production 上線前 **MUST** 加 `INTERNAL_API_TOKEN` 機制，屬 future change。

### D6：與既有 `EventLog` 雙 sink 並存（不替換）

實作：`EventLog.append()` 既有路徑後追加 `structLog.lifecycle(...)`；提供 EventLog event type → `subject_kind` + `phase` 對應表（列於 `tasks.md`）。

- `/api/.../lifecycle-events` API 不變
- `storage/event-log/*.jsonl` 不動
- 新 baseline 是 additive，雙 sink 共存

**為何不直接 swap：** 既有 audit endpoint 已 `change archive coordinator-session-lifecycle-events-audit` 收斂為 spec requirement；雙 sink 不破現有 audit endpoint contract。

### D7：retention 用 daily dir + 30 天 cutoff，手動 prune script

`logs/<service>/YYYY-MM-DD/` 為單位，超過 30 天的 date dir 整個刪除。`scripts/log-retention/prune-logs.ps1` 預設 `-DryRun`，`-Apply` 才真砍。期待手動跑或 Windows 任務排程。

**Alternatives：**
- size-based rotation per file — 本地 dev 對時間分檔更友善，agent 用日期 grep
- 每 run-id 一個 dir + 不 rotate — disk 容易爆，且農 cleanup 沒有清楚單位

**為何不上 CI：** 本 change 屬 local-dev-only baseline，CI 不負責 retention。production 上線後 retention 自動化屬 future。

### D8：env_snapshot 觸發時機 = `createLogger()` 回傳前

`createLogger()` / `create_logger()` / `New-StructLogger` 在回傳 logger 物件之前**立刻** emit 一筆 `env_snapshot`。不延後到第一次 log 呼叫，避免漏寫。

### D9：daily rotate 設計為單 process per service，跨午夜 fail-soft

PowerShell scripts 不同 process 寫不同 `<service>-<run_id>.jsonl`，sidestep file lock race。其他 service 都單 process。跨午夜瞬間 record 可能掉到舊檔 — schema 有 `ts`，join/sort 不受影響，acceptable。

### D10：2026-07-24 production-wiring completion amendment

使用者明確選擇 option A。IFC-ready closed loop 以既有 `ifc_ready_job_id`（已含 `ifcready_` 前綴）作 root trace：coordinator conversion dispatch送 `X-Trace-Id`；streaming authority持久化並傳給 converter；IFC-ready衍生的 review session/open payload與 viewer URL query延續同一 trace；viewer production bootstrap建立 singleton logger並立即送 browser-safe `env_snapshot`。只有沒有 upstream carrier的 standalone review/conversion才自 mint `rev_*` / `stream_conv_*`。

四單位 smoke的 PowerShell participant固定為受支援的 `scripts/smoke-bscheme-intake.ps1`。它在取得 intake response後以 `Set-StructLogTraceId` 切到同一 root trace並記錄後續 poll/session/close；不得用獨立 harness人工灌四份相同 trace。這個 amendment不重寫既有 adapter/schema，只補缺少的 production wiring與相應 tests。

## Risks / Trade-offs

| Risk | Mitigation |
|---|---|
| 4 adapter 各自實作 schema → 漂移 | 共用 fixtures + contract test 4 個語言全跑；CI fail-fast |
| Kit ext 整合 `struct_log` 影響 Kit subprocess perf | 寫 file 是 I/O bound 每筆 < 1ms；Kit 對單筆 log 不敏感；hot loop 預設 `debug` 關 |
| viewer-log endpoint 無 auth → LAN 內任意 POST | local-dev only；endpoint 做 schema validation 擋亂寫；production 上線前必補（已明列為 non-goal） |
| daily rotate 跨午夜 record 寫到舊檔 | schema 有 `ts`，sort 不影響 |
| 30 天 retention 對追長期 incident 不夠 | env var 可調 `LOG_RETENTION_DAYS`；長期歸檔屬 Phase 6 |
| 雙 sink lifecycle event → 寫兩次 disk I/O | 可接受：lifecycle event 量低（每 session 數筆，非 hot loop） |
| `console.*` 漸進改寫未一次完成 | 本 change 只改 coordinator `app.ts` / `index.ts` / `eventLog.ts`；其餘服務 file 留後續 PR，不影響 baseline functionality |

## Migration Plan

本 change 是 additive，無 breaking change，無 rollback 需求。實作步驟（細節展開到 `tasks.md`）：

1. 先落地 schema 契約 + fixtures（`docs/contracts/structured-log-schema.md` + `tests/contracts/structured-log/`）
2. 4 個 adapter 各自實作（順序：TS coordinator → TS viewer → Python → PowerShell，依語言難度遞增）
3. coordinator 新加 viewer-log intake endpoint + health endpoint
4. EventLog 雙 sink mirror 接上
5. retention script + 邊界測試
6. cross-service integration test
7. smoke evidence：本地跑完 IFC-ready → conversion → session → close 閉環

回退策略：每個 adapter 是新增檔案，所有既有 logging 路徑保留；若某 adapter 出問題，移除該檔即回到既有狀態。

## Open Questions

| 問題 | 預設決策 | 何時 revisit |
|---|---|---|
| Schema validator 是否用 ajv (TS) / jsonschema (Python) 新加 dep？ | apply 階段先試 ad-hoc validator 避免 dep；若維護成本太高再考慮 | apply 第一個 adapter 完成時 |
| viewer flush trigger 真實值（buffer 500 / 2s / 50 records）是否合理？ | 啟動 baseline 用，smoke 階段觀察調整 | smoke evidence |
| `LOG_RETENTION_DAYS` env 是否本 change 引入？ | 引入，預設 30；走 allow-list 明碼 | implementation 階段 |
| EventLog event type → `subject_kind` 對應表是否完整？（`sessionCreated` / `sessionActive` / `sessionClosing` / `sessionClosed` / `kitInstanceReleased` / `kitInstancesReleased`） | `tasks.md` 補完整對應表 | tasks 撰寫時 |
