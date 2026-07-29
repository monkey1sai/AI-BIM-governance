# Cross-Service Structured Log Baseline — Design

- **Status**: Approved; production-wiring completion scope approved by user on 2026-07-24 (option A); bounded viewer-operability correction approved by user on 2026-07-28; P5 adversarial security/correctness remediation approved for autonomous continuation on 2026-07-28
- **Date**: 2026-05-26
- **Change id**: `cross-service-structured-log-baseline`
- **Worktree**: `.worktrees/cross-service-structured-log-baseline/`
- **Branch**: `codex/openspec/cross-service-structured-log-baseline`
- **Predecessor closeout**: `trim-docs-and-dedupe-ide-skills` archived (origin/main `18aad0f`)
- **Author**: agent (brainstormed with user via `superpowers:brainstorming`; 2026-07-24 completion amendment, 2026-07-28 bounded viewer-operability correction, and P5 remediation explicitly approved by user)
- **Audience**: AI-BIM-governance maintainers / agents working incidents

---

## 0. TL;DR

導入跨 3 個 sub-repo + PowerShell scripts 的**統一 structured log baseline**，用同一份 JSON Schema、同一套 trace_id 命名約定，把目前散在 `console.*` / `carb.log_*` / `kit-stdout.log` / `.run/*.log.err` 的 log 收斂成 `logs/<service>/YYYY-MM-DD/*.jsonl`。本 change 不上 Prometheus/Grafana/Loki（屬 roadmap 候選 #8 `observability-audit-baseline` 範圍），但 schema 與檔案佈局**設計為 roadmap #8 直接可掃**。

預期收益：
1. agent debugging cross-service incident 時，用 `trace_id` grep 一次拉齊 4 個 service 的 timeline。
2. service 啟動時自動 dump env snapshot（allow-list 之外的值脫敏），追 misconfig 不再依賴口頭問。
3. `logic_error` / `operation_anomaly` / `network` 三類 event 有固定 schema 欄位，agent 不用學每個服務的 ad-hoc log 句型。

---

## 1. Architecture

```
┌────────────────────────────────────────────────────────────────────┐
│ Cross-service Structured Log Baseline                              │
├──────────────────────┬───────────────────────┬─────────────────────┤
│ Service              │ Adapter               │ Sink                │
├──────────────────────┼───────────────────────┼─────────────────────┤
│ coordinator (TS)     │ src/lib/structLog.ts  │ logs/coordinator/<date>/<run_id>.jsonl │
│ streaming-server     │ ezplus.bim_review_    │ logs/streaming-server/<date>/<run_id>.jsonl │
│   (Python / Kit)     │ stream.messaging/.../ │                     │
│                      │ struct_log.py         │                     │
│ web-viewer-sample    │ src/lib/structLog.ts  │ POST coordinator    │
│   (Browser)          │                       │ → logs/viewer/<date>/<run_id>.jsonl │
│ PowerShell scripts   │ scripts/lib/          │ logs/scripts/<date>/<run_id>.jsonl │
│                      │ StructLog.psm1        │                     │
└──────────────────────┴───────────────────────┴─────────────────────┘

shared spec  : docs/contracts/structured-log-schema.md          (唯一 schema 來源)
shared spec  : docs/contracts/structured-log-env-allowlist.md  (env redaction allow-list)
shared tool  : scripts/log-retention/prune-logs.ps1            (>30d daily dir 砍除)
gitignore    : logs/                                            (新增到 .gitignore)
```

**4 個 adapter 不共享 code**——跨語言共享 code 等於 IPC，得不償失。共享的是：
- `docs/contracts/structured-log-schema.md` 文字契約
- `tests/contracts/structured-log/{schema.json, fixtures/*.jsonl}` 共用 fixture
- 4 個 adapter 各自的 validator 拿同一份 fixture 跑 contract test

---

## 2. Common JSON Schema

每條 log 是一行 JSON。

### 2.1 必填欄位

```json
{
  "ts": "2026-05-26T14:23:11.482Z",
  "level": "error",
  "event_type": "logic_error",
  "service": "coordinator",
  "component": "ifcDownloader",
  "run_id": "run_20260526_142010_a3f9",
  "trace_id": "rev_20260526_1234abcd",
  "msg": "IFC download failed: 403 Forbidden",
  "data": { }
}
```

| Field | Type | Notes |
|---|---|---|
| `ts` | string | ISO-8601 UTC, ms precision |
| `level` | enum | `debug` \| `info` \| `warn` \| `error` \| `fatal` |
| `event_type` | enum | 見 §2.3 |
| `service` | enum | `coordinator` \| `streaming-server` \| `viewer` \| `scripts` |
| `component` | string | free-form module name within service |
| `run_id` | string | 一次 service startup 一個；格式 `run_<YYYYMMDD>_<HHMMSS>_<6 hex>` |
| `trace_id` | string | 跨服務串；§4 命名規約 |
| `msg` | string | 人類可讀短句 |
| `data` | object | event-specific payload（§2.4） |

### 2.2 選填欄位

| Field | When | Notes |
|---|---|---|
| `seq` | always optional | 同 `trace_id` 內遞增（coordinator 已有 EventLog sequence 概念） |
| `caller` | `level=error/warn` 時必填 | `file:line` |
| `error` | `level=error/fatal` 時必填 | `{ name, message, stack_tail: string[8] }` |
| `parent_event_id` | 自訂 | 描述 retry / fallback chain |
| `parent_trace_id` | 自訂 | 描述 trace 間衍生關係（見 §4） |

### 2.3 `event_type` 7 類

| event_type | 用途 |
|---|---|
| `logic_error` | handled / unhandled exception, validation failure, contract violation |
| `operation_anomaly` | retry / fallback / timeout / unexpected_state |
| `env_snapshot` | startup env / config dump（每 run 一筆） |
| `lifecycle` | session / conversion / Kit subprocess 生命周期 |
| `audit` | agent / human 關鍵指令（deploy-report, gh pr merge, fast MVP 弁出 job 等） |
| `network` | inbound/outbound HTTP / WebSocket / Socket.IO / WebRTC signal / DataChannel |
| `general` | 不屬於上述 6 類的一般訊息（raw `debug/info/warn` 的預設）；`data` 無必填欄位 |

**API → event_type 對應**：
- 語意 helper（`network` / `audit` / `lifecycle` / `anomaly` / `envSnapshot`）：明確設定對應 event_type
- raw `debug` / `info` / `warn`：預設 `event_type = "general"`
- raw `error` / `fatal`：預設 `event_type = "logic_error"`（caller 傳 `Error` 物件，自動填 `error.{name, message, stack_tail}`）
- caller 若要強制特定 event_type，用語意 helper

### 2.4 `data` Sub-schema by `event_type`

| event_type | data 必填 keys |
|---|---|
| `logic_error` | `error.name`, `error.message`, `error.stack_tail` |
| `operation_anomaly` | `anomaly_kind` (`retry` \| `fallback` \| `timeout` \| `unexpected_state`), `reason` |
| `env_snapshot` | `vars[]` —— `{key, source, value_or_redacted, type}` |
| `lifecycle` | `phase` (`start` \| `active` \| `closing` \| `closed`), `subject_kind` (`review_session` \| `conversion_job` \| `kit_subprocess` \| `ifc_ready_job` \| `script_run` \| `outbox_delivery`), `subject_id`（對應 subject_kind 的實體 id：review_session_id / stream_conv job id / kit subprocess pid / ifc_ready_job_id / script run_id / outbox entry id） |
| `audit` | `action`, `actor`, `target` |
| `network` | `direction` (`inbound` \| `outbound`), `protocol` (`http` \| `websocket` \| `socket.io` \| `webrtc-signal` \| `datachannel`), `peer` (logical name), `status`, `duration_ms?` |
| `general` | （無必填；`data` 可省略） |

### 2.5 Redaction

**Env snapshot**：
- `allow_list`（明碼輸出）：**完整列表唯一來源**為 `docs/contracts/structured-log-env-allowlist.md`；本 design 不複製清單，新增 env 必 PR 一併改該文件
- 不在 allow_list 但 key 含 `TOKEN` / `SECRET` / `KEY` / `PASSWORD` / `AUTH` / `CREDENTIAL`：寫 `[REDACTED:type=<string|number|boolean>, len=<n>]`
- 其餘（不在 allow_list、也不命中 secret pattern）：寫 type + length，不寫原值
- `source`：`.env` \| `.env.example` \| `system` \| `docker-compose` \| `default`
- **觸發時機**：每個 service 的 `createLogger()` / `create_logger()` / `createBrowserLogger()` / `New-StructLogger` 在回傳 logger 之前，立刻 emit 一筆 `env_snapshot`（即 logger 取得即送，不延後到第一次一般 log 呼叫）。Browser transport 必然非同步，因此 browser 的「emit」定義為 return 前進入既有 buffer，並由既有 flush policy送往 coordinator；不得用同步 XHR 阻塞 bootstrap。
- Browser 沒有 `process.env`；viewer snapshot 只列 build-time allow-list runtime config 與 browser 可觀察 metadata，禁止掃描或序列化任意 `window` / storage / query 值。`trace_id` 是 record envelope，不列入 snapshot vars。

**Network**：
- `peer` 只記 logical name (`coordinator` / `streaming-server` / `external-edge` / `external-cloud` / `kit-subprocess`)，**不寫**原始 host:port / URL
- HTTP `path` 可寫；query string 一律砍掉
- request/response body **預設不入 log**；若要追 payload 用 `data.evidence_ref` 指 `logs/<service>/<date>/evidence/<id>.json`（本 baseline 不實作 evidence 機制，留 schema hook）

**Depth defense**：adapter 入口 mandatory 跑 `redactDataBeforeWrite(data)`：掃 `data` 任何 key 包含 secret pattern → 一律 `[REDACTED]`。即使 caller 忘了，也擋一層。

---

## 3. Components

### 3.1 TypeScript adapter — `bim-review-coordinator/src/lib/structLog.ts`

**Public API**：

```ts
export interface NetworkData { direction: 'inbound' | 'outbound'; protocol: string; peer: string; status: number | string; duration_ms?: number; path?: string; }
export interface AuditData { action: string; actor: string; target: string; }
export interface LifecycleData {
  phase: 'start' | 'active' | 'closing' | 'closed';
  subject_kind: 'review_session' | 'conversion_job' | 'kit_subprocess' | 'ifc_ready_job' | 'script_run' | 'outbox_delivery';
  subject_id: string;
}
export interface AnomalyData { anomaly_kind: 'retry' | 'fallback' | 'timeout' | 'unexpected_state'; reason: string; [k: string]: unknown; }
export interface EnvVar { key: string; source: string; value_or_redacted: string; type: string; }

export interface StructLogger {
  debug(component: string, msg: string, data?: object): void;
  info (component: string, msg: string, data?: object): void;
  warn (component: string, msg: string, data?: object): void;
  error(component: string, msg: string, err: Error, data?: object): void;
  fatal(component: string, msg: string, err: Error, data?: object): void;

  network(component: string, msg: string, data: NetworkData): void;
  audit  (component: string, msg: string, data: AuditData): void;
  lifecycle(component: string, msg: string, data: LifecycleData): void;
  anomaly  (component: string, msg: string, data: AnomalyData): void;
  envSnapshot(component: string, vars: EnvVar[]): void;
  withTraceId(traceId: string): StructLogger;
}

export function createLogger(service: 'coordinator' | 'viewer', opts?: { logRoot?: string }): StructLogger;
```

**內部**：
- 啟動產 `run_id`
- 寫 `<logRoot>/<service>/<YYYY-MM-DD>/<service>-<run_id>.jsonl`（append-only, `fs.createWriteStream` flag `a`）
- 同時 `process.stdout.write` 一行 JSON
- 跨日 rotate：每寫一筆檢查 date，跨了 close 舊 stream 開新的
- Redaction helper：`redactEnvValue(key, value)` 共用

**Viewer-log intake**：coordinator app.ts 加 `POST /api/internal/viewer-log` → body parse前驗 active primary/spectator viewer lease三個 headers → 256 KiB parser → 收 `LogRecord[]` → 僅將 `service="viewer"` records寫到 `logs/viewer/<date>/...`。health endpoint沿用 internal token；base host publish綁loopback但 explicit host-kit LAN profile仍受同一 auth約束。

### 3.2 Python adapter — `bim-streaming-server/source/extensions/ezplus.bim_review_stream.messaging/ezplus/bim_review_stream/messaging/struct_log.py`

**Public API**（與 TS 對齊）：

```python
class StructLogger:
    def debug(self, component: str, msg: str, data: dict | None = None) -> None: ...
    def info(self, component: str, msg: str, data: dict | None = None) -> None: ...
    def warn(self, component: str, msg: str, data: dict | None = None) -> None: ...
    def error(self, component: str, msg: str, err: BaseException, data: dict | None = None) -> None: ...
    def fatal(self, component: str, msg: str, err: BaseException, data: dict | None = None) -> None: ...

    def network(self, component: str, msg: str, data: dict) -> None: ...
    def audit(self, component: str, msg: str, data: dict) -> None: ...
    def lifecycle(self, component: str, msg: str, data: dict) -> None: ...
    def anomaly(self, component: str, msg: str, data: dict) -> None: ...
    def env_snapshot(self, component: str, vars: list[dict]) -> None: ...
    def with_trace_id(self, trace_id: str) -> "StructLogger": ...

def create_logger(service: str, log_root: pathlib.Path | None = None) -> StructLogger: ...
```

**內部**：
- stdlib `json` + `pathlib`
- **不**用 `logging.handlers.TimedRotatingFileHandler`（跨 process 不可靠）；自寫單 process daily rotate（每筆檢查 date）
- 與 `carb.log_*` **並存**：Kit ext 兩邊都呼。`carb.log_*` 給 Kit console / UI 使用者看；`struct_log` 給跨服務追蹤
- stdout 寫到 `sys.stdout`；`convert-ifc-to-usdc.ps1` 既有 `kit-stdout.log` capture 會吃到，等於免費二次備份

### 3.3 PowerShell module — `scripts/lib/StructLog.psm1`

**Public API**：

```powershell
Import-Module $PSScriptRoot/../lib/StructLog.psm1
$log = New-StructLogger -Service 'scripts' -Component 'preflight-docker' -LogRoot $env:LOG_ROOT
$log | Write-StructInfo -Msg 'docker available' -Data @{ version='29.5.1' }
$log | Write-StructError -Msg 'docker daemon down' -ErrorRecord $err
$log | Write-StructAudit -Msg 'deploy-report generated' -Data @{ action='deploy-report'; target='compose-host' }
```

**內部**：
- `ConvertTo-Json -Compress -Depth 8` 一筆一行
- `Add-Content -LiteralPath` append, daily rotate
- redaction helper：`Get-RedactedEnvVar`

### 3.4 Browser adapter — `web-viewer-sample/src/lib/structLog.ts`

**Public API**：同 3.1。

**內部**：
- **不**寫 local file（browser 不行）
- ring buffer max 500 records
- 每 2 秒或 buffer ≥ 50 筆 flush：以 active viewer lease authority headers呼叫 `fetch('POST /api/internal/viewer-log', body=records[])`；authority只存在 memory/headers
- 缺 authority或 transport失敗：不發 request或保留 buffer最多 5 min；超過丟最舊；同時 `console.error` fallback但不得輸出 token
- 成功只移除 exact captured in-flight entry identities；concurrent append/overflow後的新 entry不得被 positional splice誤刪或計為 delivered
- 全域 `window.addEventListener('error', ...)` + `unhandledrejection` 自動產 `logic_error`
- 暴露 `window.__structLog.tail(n=100)`，使用者 / Chrome MCP 隨時 inspect

### 3.5 Retention helper — `scripts/log-retention/prune-logs.ps1`

```powershell
# 砍 logs/<service>/<YYYY-MM-DD>/ 超過 30 天的整個 date dir
# 不砍 logs/ 本身、不砍 service dir 本身
# 預設 -DryRun，要加 -Apply 才真砍
```

預期手動跑 / Windows 任務排程；CI 不負責 retention。

### 3.6 Schema spec docs

- `docs/contracts/structured-log-schema.md` — 4 adapter 必須通過的契約
- `docs/contracts/structured-log-env-allowlist.md` — env var allow-list（跨 service 集中管理；新增 env 必 PR 一併改這份）

### 3.7 Test fixtures（跨語言共用）

- `tests/contracts/structured-log/schema.json` — JSON Schema draft-07
- `tests/contracts/structured-log/fixtures/<event_type>-*.jsonl` — 各 event_type 1~3 sample

### 3.8 Bounded viewer diagnostics surface（2026-07-28 completion correction）

P4 證據第一次執行因 `no_browser_evidence` held。使用者選擇 Option A：在 coordinator `/ui/open` handoff 最終落地的 standalone review viewer route 上補一個**窄範圍 delivery diagnostics surface**，使既有 browser adapter 的 production carrier 可由使用者操作並可被 Playwright 誠實驗證。Operator console route／control 不得代替這個 surface。這不是集中式 log dashboard，也不新增 backend route。

只有同時存在合法 review session 與已 bootstrap 的 browser logger 時才渲染。surface MUST：

- 顯示 browser logger `trace_id`、`run_id`、review session id，以及 stream config 已提供時的 conversion job / Kit instance id；缺值一律顯示「未觀測」，不得捏造 runtime ID。
- 提供明確的 `Flush structured logs` 主操作：先 enqueue 一筆 diagnostics record，再呼叫既有 `BrowserStructLogger.flush()`，使 browser 只透過 coordinator `POST /api/internal/viewer-log` 送出。
- 顯示 `idle`、`loading`、`success`、`failure` 四種狀態；失敗時保留明確 `Retry flush` 操作，重試仍走同一真實 endpoint。
- 提供 `Close review session` 操作，重用既有 coordinator cooperative-close `POST /api/review-sessions/:sessionId/close`，body 為 `{}`（不得帶 operator `reason`）；顯示 closing / closed / failure，close 失敗時可重試。
- 不呈現 JSONL record body、env value、absolute log path，不讀取 repo-local log files，也不直接呼叫 streaming / governance / Kit internal service。
- explicit Flush前取得或重用 active primary/spectator viewer lease；component mount不得自動 claim，spectator不得偷走 primary。authority缺失時顯示 retryable failure、不得 fetch且保留同一 diagnostics action。

Forced failure 只允許由 Playwright 在測試程序內攔截第一輪 viewer-log POST；production code 不得新增 `forceFailure` query、fault-injection endpoint 或測試專用成功分支。解除攔截後的 retry MUST 命中真 coordinator 並取得 2xx。

Manual-flush correctness MUST 不受 2 秒 timer 競態影響：public `flush()` 若遇到既有 in-flight batch，先等待該 batch terminal，再 drain 當時仍保留的 records。Logger 提供 `setAutoFlushPaused(boolean)`；UI 在第一次 action 前 pause timer/threshold auto-flush，failure 到 explicit Retry 之間保持 paused，success 或 component cleanup 後 resume。UI enqueue 唯一 `evidence_action_id` 後，固定 `target_flushed_total = flushedTotal + bufferLength` 與 `droppedTotal` baseline；只有 `flushedTotal >= target_flushed_total`、最新 status=`ok`、`droppedTotal` 未增加且該 action 已不在 retained buffer 時才可顯 success。Transport成功後只以 exact `BufferEntry` object identity移除該 in-flight batch，不能用 index/count splice刪除等待期間新增或保留的 entries。Timeout / terminal failure一律顯 failure；Retry 沿用 buffer 中同一 action，不重複 enqueue。

Surface 的 action gate MUST 要求 route 上唯一合法 session/root trace carrier與已載入 session case-exact一致，且 logger `trace_id` 與 carrier case-exact一致；不一致時只顯 unavailable，不得執行 evidence flush/close。一般 review route允許 documented `ifcready_*` / `rev_*` root；canonical P4 route MUST 是 `ifcready_*`。

---

## 4. Data flow / trace_id propagation

### 4.1 Trace_id 命名規約

| trace_id 前綴 | 起源 | 範例 |
|---|---|---|
| existing `ifc_ready_job_id` (already `ifcready_*`) | coordinator IFC-ready intake；byte-for-byte作 root trace，不重複加前綴 | `ifcready_1779687625000_064c6813` |
| `rev_<existing_session_id>` | 只有無 IFC-ready 上游的 standalone review session 才 mint；由 IFC-ready 建立的 session 必須保留 upstream `ifcready_*` root trace | `rev_20260526_1234abcd` |
| `stream_conv_<existing_job_id>` | 只有無 inbound trace 的 internal conversion 才自 mint；有 `X-Trace-Id` 時必須承襲 inbound root trace | `stream_conv_20260525055218_115177da` |
| `script_<run_id>` | pure PowerShell scripts（無上游） | `script_run_20260526_142010_a3f9` |

`parent_trace_id` 用於另起 standalone child trace 時描述衍生關係。IFC-ready closed loop 的驗收以同一個 `ifcready_*` root trace 貫穿為準，不得只靠 parent link 冒充 one-trace grep。

### 4.2 Trace_id 傳遞通道

| 通道 | 載體 |
|---|---|
| coordinator ⇄ streaming-server HTTP | `X-Trace-Id` header |
| coordinator ⇄ viewer Socket.IO | event payload `trace_id` field |
| viewer ⇄ streaming-server WebRTC DataChannel | 每個 event `payload.trace_id`；vendor `ApplicationMessage` bridge只有 `{event_type,payload}`，不宣稱不存在的 root envelope field |
| 外部 cloud callback outbox | payload `trace_id` field（外部 cloud 不一定理會，至少 outbox 記錄） |
| Kit subprocess invocation | command-line arg `--trace-id=<id>` |
| PowerShell scripts 之間 | env var `BIM_TRACE_ID` |

Production completion wiring：

- coordinator dispatch conversion 時以 `ifc_ready_job_id` 作 root trace，送 `X-Trace-Id`，並用同一 trace 寫 outbound network record。
- streaming conversion authority 驗證並持久化 inbound trace；conversion lifecycle、converter adapter與 `-TraceId` / `BIM_TRACE_ID` 都承襲它。缺 header 時才以 conversion job id mint `stream_conv_*`。
- coordinator 從 IFC-ready job 建立 review session時，session/open payload與 viewer URL query攜帶同一 root trace；standalone session才使用 `rev_*`。
- viewer production bootstrap 從受信任的 query carrier讀取合法 trace，建立 singleton browser logger、安裝 global handlers，並在一般 app log前送出 viewer `env_snapshot`。
- `scripts/smoke-bscheme-intake.ps1` 是四單位 smoke 中的 PowerShell participant；取得 intake job後切換到該 root trace，記錄 poll/session/close lifecycle。它是受支援的真 runner，不得用另寫 evidence harness 取代。
- coordinator callback outbox ready/failed payload都保留 exact IFC-ready root；persist/reload/delivery不得丟失或改寫。
- Socket.IO canonical trace在session建立時immutable persist；legacy只允許zero/one distinct valid linked root backfill，multiple/conflict/malformed fail closed，禁止latest-by-updated_at。join/heartbeat/leave request帶candidate；成功ack/presence帶canonical trace，rejected ack只回stable error且在room/participant/session/presence副作用前停止。
- viewer在 Socket exact-match驗證前不送 DataChannel。Schema完整26-message catalog涵蓋viewer outbound、Kit inbound/outbound與viewer inbound；Kit先驗inbound mismatch，viewer在correlation/request completion/accepted logging/UI mutation前拒絕Kit→viewer缺失或mismatch trace，mutator另走coordinator runtime authority。

### 4.3 範例 timeline

```
[external IFC Worker] POST /api/external/ifc-ready ifc_ready_job_id=ifcready_X
                              │
[coordinator]                 ▼  trace_id=ifcready_X
   network inbound /api/external/ifc-ready 200
   lifecycle start subject=ifc_ready_job
   network outbound coordinator→streaming-server (X-Trace-Id: ifcready_X)
                              │
[streaming-server]            ▼  trace_id=ifcready_X (承襲)
   network inbound /internal/convert
   lifecycle start subject=stream_conv_job
   network outbound streaming→kit-subprocess --trace-id=ifcready_X
                              │
[Kit subprocess (Python)]     ▼  trace_id=ifcready_X
   lifecycle start subject=kit_subprocess
   operation_anomaly anomaly_kind=fallback reason=hoops_a3d_failed
   lifecycle closed
                              │
[PowerShell smoke runner]     ▼  trace_id=ifcready_X (取得 intake response 後承襲)
   lifecycle active subject=script_run
                              │
[browser viewer]              ▼  trace_id=ifcready_X (viewer URL/query 承襲)
   env_snapshot (browser-safe runtime config only)
   network outbound viewer→coordinator /api/review-sessions
   lifecycle start subject=review_session
   network outbound viewer→streaming-server WebRTC DataChannel openStageRequest
```

agent 在 incident debugging 時跑：

```powershell
Get-ChildItem logs -Recurse -Filter *.jsonl |
  Select-String -Pattern '"trace_id":"ifcready_X"' |
  ForEach-Object { $_.Line } |
  ConvertFrom-Json |
  Sort-Object ts
```

跨 4 個 service 的 log 按時間排序展開。

---

## 5. Error handling（logger 自己壞掉怎麼辦）

**核心原則**：logger 不能讓主流程壞掉，永遠 fail-soft，最後手段寫 stderr。

### 5.1 Sink 失敗

| 失敗模式 | 處理 |
|---|---|
| disk full | 寫 `logs/` 失敗 → memory ring 留 last-100；同時 `console.error('[structLog sink failed]', record)` 到 stderr；不 throw |
| permission denied | 同上 |
| file locked（單 process daily rotate 不該發生） | 改寫 `logs/<service>/_recovery/<date>-<run_id>.jsonl`，下一筆再嘗試主檔 |
| stdout pipe closed | swallow，繼續嘗試檔案 |

### 5.2 Serialization 失敗

- safe stringify wrapper：捕獲 circular ref（TS: `JSON.stringify(obj, safeReplacer)`；Python: `default=lambda o: f"<unserializable:{type(o).__name__}>"`）
- BigInt / Date / Error 明定 serializer
- non-redaction serialization失敗的 record不丟，才改寫降級 anomaly；redaction traversal的 depth/cycle由下節 marker處理且保留原 event type

### 5.3 Redaction depth defense

- adapter 入口 mandatory 跑 bounded、cycle-safe `redactDataBeforeWrite(data)`；ordinary event nested `auth` / `key` / `password` / `api_key` / `token`等 secret-pattern key一律固定 marker，env allow-list不得形成 general-data exemption
- 只有 `env_snapshot.vars[]` 專用 sanitizer可保留 `key/source/value_or_redacted/type` schema vocabulary；同 event其他 secret field仍redact
- `MAX_REDACTION_DEPTH=8`，root `data` container算 depth 0；將要進入 depth 9的 object/array整棵換成 exact `[Truncated]`。cycle只替換該 subtree為 `[Circular]`並保留原 event type；marker/error不得包含原值
- coordinator `tests/lib/structLog.test.ts`、streaming `tests/contracts/structured-log/test_python_adapter.py`、browser `web-viewer-sample/scripts/verify-struct-log.mjs`、PowerShell `scripts/tests/test-struct-log.ps1`各自測 nested object/array、literal auth/key/password/api_key/token、env_snapshot structure、depth 8/9、circular（PowerShell另測 cyclic enumerable），斷言 serialized sink/buffered POST body不含 sentinel且不改 event type

### 5.4 Daily rotate race

- 設計為**單 process per service**
- PowerShell scripts 同時跑兩個（例 deploy-report + preflight-docker）→ 各自寫**自己的** `<service>-<run_id>.jsonl`，不共寫同檔，sidestep race
- 跨午夜：偵測 date 跳變 → close 舊 stream / fd，開新的；最壞情況跨午夜那一筆掉到舊檔 OK，schema 有 `ts` 不影響 join

### 5.5 viewer POST 失敗

- viewer-log在 body parse前驗 active primary/spectator lease三個 headers；route-local 256 KiB parser先於 global 1 MiB parser，只持久化 `service="viewer"`
- base runtime-manager publish coordinator/viewer只綁 host loopback；explicit host-kit LAN override保留，因此 auth不可只依賴 bind address
- buffer 5 min；缺 authority不 fetch，transport失敗保留；超過丟最舊；同時 `console.error`但不得輸出 token
- coordinator endpoint 回 5xx → viewer 不持續 retry 同樣 payload，指數 backoff 最多 3 次

### 5.6 Schema 自我驗證

- runtime adapter 入口拒收 unknown event_type / level（throw to caller）但 logger 本身吞 exception → 寫降級 anomaly record
- 不在 runtime 跑 JSON Schema validation（避免 perf cost）
- 在**測試**裡驗：fixture-driven contract test

### 5.7 Logger 健康觀察

- coordinator: 既有 internal token保護 `GET /api/internal/structLog/health` → `{ run_id, current_file, records_written, last_failure }`
- streaming-server / scripts / viewer：不另開 endpoint，dev 直接看檔 / `window.__structLog.tail()`

---

## 6. Testing strategy

### 6.1 Schema contract test（最重要）

- `tests/contracts/structured-log/fixtures/*.jsonl` — 每 event_type 1~3 sample
- `tests/contracts/structured-log/schema.json` — JSON Schema draft-07
- 各語言 validator：
  - TS: `tests/contracts/structured-log/validate.contract.test.ts` (Vitest, ajv)
  - Python: `tests/contracts/structured-log/test_validate.py` (pytest, jsonschema)
  - PowerShell: `tests/contracts/structured-log/Test-Validate.Tests.ps1` (Pester, 簡單 ConvertFrom-Json + assert keys)
- **共用**同一份 fixtures + schema → 跨語言一致性硬保證

### 6.2 Adapter unit test

| Adapter | Test 位置 | 框架 |
|---|---|---|
| coordinator TS | `bim-review-coordinator/tests/lib/structLog.test.ts` | Vitest |
| viewer TS | `web-viewer-sample/scripts/verify-struct-log.mjs` | Node assertions against logger buffer/transport |
| streaming Python | `tests/contracts/structured-log/test_python_adapter.py` | root pytest |
| PowerShell module | `scripts/tests/test-struct-log.ps1` | plain PowerShell assertions |

每 adapter 必測：
- write 一筆 → 合法 JSONL 行、通過 §6.1 schema
- `withTraceId` / `with_trace_id` child logger 繼承
- redaction：nested object/array 的 `auth` / `key` / `password` / `api_key` / `token` → serialized sink或buffered POST body不含 sentinel
- redaction：env_snapshot 對 allow-list 外的 key → `[REDACTED:...]`
- depth 8/9 boundary → depth-9 subtree exact `[Truncated]`
- circular ref → subtree exact `[Circular]`、保留原 event type且不 crash；PowerShell另測 cyclic enumerable
- daily rotate：mock 時間跨午夜 → 新檔產生、舊檔不變
- 多筆順序：seq 正確遞增（同 trace_id 內）

### 6.3 Integration / 跨服務 test

- `tests/integration/structured-log-cross-service.test.ts`（Vitest, root）
- 啟 fake coordinator → fake streaming-server outbound → 驗 trace_id 串得起、ts 排序合理
- mock viewer POST → coordinator endpoint 真的收到 → 寫到 `logs/viewer/...`

### 6.4 Smoke / runtime evidence

- 跑一次本地完整 IFC-ready → conversion → session → viewer bootstrap → close 閉環；使用受支援的 `smoke-bscheme-intake.ps1` 作 PowerShell participant
- 驗 4 service log 都產生、目錄結構正確、同一 `ifcready_*` trace_id 串得起、env_snapshot 各 service 每 run 恰一筆且 secret pattern 不出現原值
- 在 coordinator 產生的真 viewer route 操作 diagnostics：觀測 flush loading → Playwright-only forced POST failure → visible retry → 真 coordinator 2xx success，再由同一 browser surface close 同一 review session
- Browser evidence MUST 保存 failure 與 final success/closed screenshot、Playwright trace、secret-free console events、viewer-log/session-close network events與 runtime IDs；預期攔截的 503 必須標成 test-injected，不得寫成 backend incident
- raw Playwright trace只能進 owned random private OS temp root，sanitized final zip才進 retained artifact tree；non-canonical URI scheme/UNC fail closed，final viewer origin必須精確等於獨立 trusted origin參數
- `browser_run_id` MUST 在 operability、readiness、root timeline的唯一 viewer run、artifact manifest與PR fields case-exact一致
- Evidence 寫 `docs/evidence/structured-log-baseline-2026-05-26.md`

### 6.5 Retention script test

- `scripts/log-retention/tests/Prune-Logs.Tests.ps1`
- 建假 logs/ 結構含 5/15/30/45/60 天前的檔
- `-DryRun` 不真砍、`-Apply` 砍 >30 天
- 不砍 `<service>` dir 本身、不砍 logs/ 本身
- 邊界：剛好 30 天的不砍、31 天的砍

### 6.6 不測什麼

- 不測 `carb.log_*` 行為
- 不測 docker logs / systemd stdout 接收（屬 sink 外層）
- 不測 production sink（Loki，roadmap #8 範疇）
- 不測 Internet-grade IdP/TLS/firewall；viewer lease/internal-token auth與 base/host-kit Compose boundary是本 change必測

---

## 7. Migration / coexistence

### 7.1 既有 logging 機制處理

| 既有機制 | 處理 |
|---|---|
| coordinator `console.log/warn/error`（6 處） | 漸進改寫到 struct_log；本 change 不一次全砍，至少把 `app.ts` / `index.ts` / `eventLog.ts` 改完 |
| coordinator `EventLog` (storage/event-log/*.jsonl) | **不動**。`/api/.../lifecycle-events` endpoint schema 不變、儲存位置不變。實作：在 `EventLog.append()` 既有路徑後**附加一行** `structLog.lifecycle(...)` 呼叫，subject_kind 依 event type 決定（例如 `sessionCreated` → `subject_kind=review_session, phase=start`）；本 change 提供從既有 EventLog event type 映射到新 schema 的轉換表，列於 `tasks.md`。雙 sink 並存，新 baseline 不替代舊 endpoint。 |
| streaming-server `carb.log_*`（48 處） | **不動**，並存。Kit ext 在 critical path 額外呼 `struct_log` |
| Kit subprocess `kit-stdout.log` / `kit-stderr.log` | 不動。Kit ext 內部 `struct_log` 寫的 stdout 會被既有 capture 同時收進去（免費 redundancy） |
| PowerShell scripts `.run/*.log.err` | 不動。新 baseline 另寫 `logs/scripts/...`；既有檔案保留 |

### 7.2 .gitignore 更新

新增：
```
/logs/
```

不影響既有 `storage/event-log/` ignore 規則。

---

## 8. Out of scope / future hardening

| 項目 | 為何不做 | 何時做 |
|---|---|---|
| Prometheus `/metrics` 端點 | 屬 roadmap #8 `observability-audit-baseline` | Phase 6 解凍時 |
| Loki / Grafana production sink | 同上 | 同上 |
| Internet-grade viewer-log identity、TLS、edge firewall | 本 change只重用 active viewer lease並收斂 host publish；host-kit仍是 LAN/single-machine profile | production edge rollout |
| Log payload evidence sidecar（`logs/<service>/<date>/evidence/`） | schema 留 hook `data.evidence_ref`，本 change 不實作機制 | 真有 incident 需要追大 payload 時 |
| OpenTelemetry W3C `traceparent` 格式 | dev 期無人股 OTel SDK | roadmap #8 |
| Daily retention CI 自動化 | 手動跑 / Windows 任務排程已夠 | Phase 5/6 production |
| 完整 Log 集中 dashboard UI（search / tail / filter / download / cross-service aggregation） | 屬 #8；本 change 只核准 §3.8 的單一 viewer delivery diagnostics surface | Phase 6 |

---

## 9. 風險與假設

### 9.1 假設

- 4 個 adapter 各自為政、不共享 code 是可接受的 maintainability trade-off。理由：跨語言共享 code 等於 IPC；schema 是文字契約，跨語言一致性靠 contract test 保證。
- `logs/` 在 repo 根 + gitignore 不會撞到既有 dev workflow。已驗 `logs/` 目前不存在於 worktree base。
- coordinator 是 viewer log 的中繼節點是合理選擇：viewer 本來就只能跟 coordinator 通訊（per `bim-review-coordinator/CLAUDE.md` 邊界），加一個 internal endpoint 不破壞 boundary。
- env_snapshot 用 allow-list + pattern-based redaction 雙保險足夠；新加 env 若忘了加 allow-list，會落到 `[REDACTED:type=...,len=...]`，不會洩漏原值。

### 9.2 已知風險

| Risk | Mitigation |
|---|---|
| 4 adapter 各自實作 schema → 漂移 | 共用 fixtures + contract test，CI fail-fast |
| Kit ext 整合 struct_log 影響 Kit subprocess perf | 寫 file 是 I/O bound，每筆 < 1ms；Kit 對單筆 log 不敏感；若真有 hot loop 用 debug level 預設關 |
| host-kit LAN仍可達 viewer-log | body parse前要求 active viewer lease，health要求 internal token；missing/wrong/cross-session/expired/released全部401零寫入，base profile另綁host loopback |
| viewer lease不是Internet-grade identity | host-kit只宣稱LAN/single-machine；TLS/firewall/IdP留production edge rollout |
| raw trace在硬 kill後殘留OS temp | raw永不進retained evidence tree；owned temp finally cleanup並誠實揭露hard-kill residual |
| daily rotate 跨午夜瞬間 record 寫到舊檔 | schema 有 `ts`，join/sort 不受影響 |
| 30 天 retention 對追長期 incident 不夠 | 本 baseline 預設 30；env var 可調 `LOG_RETENTION_DAYS`；長期歸檔屬 Phase 6 |
| P4 forced failure 被誤作 production fault path | 只允許 Playwright route interception；production UI / API 不接受 fault-injection flag |

---

## 10. 成功標準

本 change 完成的條件：

1. 4 個 adapter 各自有 public API、各自通過 unit test。
2. 共用 schema contract test：4 個 validator 用同一份 fixtures 全 pass。
3. `tests/integration/structured-log-cross-service.test.ts` 跑通：mock cross-service flow，trace_id 串得起。
4. `scripts/log-retention/prune-logs.ps1` 有 Pester test，`-DryRun` / `-Apply` 行為正確、30 天邊界正確。
5. Smoke evidence：本地跑一次 IFC-ready → conversion → session → viewer bootstrap → close 閉環，4 service log 都產生，agent 用同一 `ifcready_*` trace_id grep 拉得齊；不得以人工注入相同 trace 的 adapter harness 代替 production carriers。
6. `docs/contracts/structured-log-schema.md` + `docs/contracts/structured-log-env-allowlist.md` 完成；新加 env var 的 PR review checklist 提到必更 allow-list。
7. `.gitignore` 加 `/logs/`。
8. `coordinator npm run verify` / streaming pytest / viewer build / root pytest 全 pass。
9. Coordinator 產生的真 viewer route 上，使用者可操作 structured-log flush 與同 session close；P4 觀測 visible loading、forced failure、retry、success/closed、真 API、console/network、runtime IDs、screenshots 與 `trace.zip`。Design status 保持 `mixed`、reference-missing surface 誠實列出、`Full completion claimed=no`。

---

## 11. 與 roadmap 的關係

本 change **不**取代 roadmap 候選 #8 `observability-audit-baseline`；本 change 是 #8 的**前置 baseline**：

- #8 屆時需要的 structured log + `/metrics`，本 change 提供前者
- `logs/` 檔案佈局是 promtail-friendly；#8 上 Loki 時只需加 promtail config，**不需改 schema**
- `trace_id` 命名約定一致；#8 上 OpenTelemetry 時需要再加 W3C `traceparent` 對照欄位（schema additive 擴充，不破現有）

---

## 12. 後續步驟（本 design doc 通過後）

1. Spec self-review（placeholder / consistency / scope / ambiguity）— 寫完即跑
2. User review（請使用者讀本檔，提修改意見）
3. 通過後 `openspec new change cross-service-structured-log-baseline` scaffold OpenSpec change
4. 產 `openspec/changes/cross-service-structured-log-baseline/{proposal.md, design.md, tasks.md}`，design.md 引用本檔；tasks.md 用 §10 成功標準拆 bite-sized tasks
5. 跑 `openspec status --change cross-service-structured-log-baseline` 確認 apply-ready
6. 走 `/opsx:apply` 進實作；HIGH/CRITICAL risk symbol 先跑 `gitnexus_impact` 回報
