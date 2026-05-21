## Why

OpenSpec archive `2026-05-21-coordinator-ifc-ready-worker-webhook`（implementation PR #74，2026-05-19 merged）將 worker compatibility intake + conversion-ready → 自動 review session 寫進 `openspec/specs/` 三份規格（`local-coordinator-ifc-ready-intake-boundary` / `review-session-request-lifecycle` / `conversion-webhook-lifecycle`），但 archive commit 自承「tasks.md 26/26 未勾選 = documentation lag」。2026-05-21 retro-audit（commit `a32fcd6`）確認該 archive 為 spec drift：規格已 ratified，code 從未實作。

精確缺口（grep `bim-review-coordinator/src/app.ts`）：

- `ingestConversionReport`（line 566-628）terminal `ready` 分支只 `callbackOutbox.enqueue` ＋ `recordConversionOutcome`，**不呼叫** `SessionStore.create` / `allocateKitInstanceBindings` / `chooseReadyUsdc`，造成 worker-webhook 驅動的閉環走到「轉檔成功」後對本地 viewer 是死路。
- external IFC-ready intake schema 只接 canonical `event="ifc_ready"` + `external_model_version_id` + `external_conversion_task_id`，**未支援** worker compatibility payload（`status="ifc_ready"` / `ifc_path` / `project_id` + `version` + `task_id`）。

11 個 spec scenarios（intake 4 + auto-session 4 + webhook seam 3）對 code 全部 `not_implemented`。

本 change 不重新發明 spec，只實作既有 spec authority，把 archive 標 deferred 的 26 個 tasks 真正落地。

## What Changes

純 implementation backfill — 不修改 spec，不新增 capability，不調整 boundary：

- 在 `bim-review-coordinator/src/app.ts`（或抽出 helper）的 external IFC-ready intake 加入 worker compatibility branch，把 `status="ifc_ready"` / `ifc_path` / `project_id` / `version` / `task_id` 正規化為 canonical `ExternalIfcReadyEvent`；`task_id` 在缺 explicit `X-Correlation-Id` / `X-Idempotency-Key` 時作為 idempotency / correlation fallback。
- 在 `ingestConversionReport` terminal `ready` 分支接 `SessionStore.create` + `allocateKitInstanceBindings` + `chooseReadyUsdc`（重用既有 `POST /api/review-sessions` 內部邏輯，必要時抽 helper），把新轉出的 USDC 與 Kit binding 綁進 session；對同一 `correlation_id` / `external_model_version_id` 具 idempotency；terminal `failed` 不建可串流 session。
- callback outbox enqueue 與 session 自動建立並行不耦合，pending / dead-letter cloud callback 不阻塞本地 session handoff。
- 補對應 contract / unit tests（`tests/contracts/`、`bim-review-coordinator/tests/external-ifc-ready.test.ts`、新增 `host-native-conversion-ingest.test.ts` 或等效）覆蓋 11 個 spec scenarios。
- 維持 `bim-streaming-server` 為 internal-only IFC→USDC conversion engine；不暴露 public webhook、不改 streaming API contract。

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `local-coordinator-ifc-ready-intake-boundary` — `Coordinator accepts worker ifc-ready compatibility payload` requirement 加 implementation backfill note，scenarios 不變。
- `review-session-request-lifecycle` — `Coordinator session is bound back to the request` requirement 加 implementation backfill note，scenarios 不變。
- `conversion-webhook-lifecycle` — `Terminal conversion-ready ingestion triggers local review session handoff` requirement 加 implementation backfill note，scenarios 不變。

> **Why these MODIFIED deltas are essentially NO-OP**：archive `2026-05-21-coordinator-ifc-ready-worker-webhook` 已把這三份 requirement 同步進 `openspec/specs/`。本 change 試過 Option A（無 spec delta），但 `openspec validate --strict` 強制要求每個 change 帶 delta + Scenario block，因此採 Option B：把三個既有 requirement 各加一段 `> **Implementation status (2026-05-21)**: ...` note，宣告 backfill 來源；scenarios 全保留不變。Spec history 的代價是「每個 requirement 多一句 implementation note」，換來 process tracking 與 archive 的 closure。

## Impact

- Owner repo/folder: `bim-review-coordinator/`（intake normalization + `ingestConversionReport` ready branch wiring；重用既有 `SessionStore` / `kitPool` / `chooseReadyUsdc`，不新增 runtime service）。
- API: `POST /api/external/ifc-ready` 接受 worker payload 形狀；既有 canonical caller 行為不變。`POST /api/review-sessions` 內部建立路徑被 conversion-ready ingestion 自動觸發複用；外部 API path 維持英文不變。
- Data: worker payload → local shadow conversion job mapping；conversion-ready → review session（綁 `usdc_artifact_id` + `kit_instance_bindings`）；不保存大型 IFC/USDC file body；新增 session 紀錄寫入既有 `SessionStore`，不開新 storage。
- Affected integration: external customer-edge IFC Worker → `bim-review-coordinator`（intake + auto-session）→ `bim-streaming-server` internal conversion → coordinator conversion-ready ingestion →（並行）metadata-only callback outbox ＋ 自動 review session → session-first `web-viewer-sample`。
- Affected symbols（apply 前需 GitNexus impact analysis）：`ingestConversionReport`、`SessionStore.create`、`allocateKitInstanceBindings`、`chooseReadyUsdc`、`/api/internal/conversion-result`、`/api/internal/conversions/:id/ingest`、`/api/review-sessions`、`/api/external/ifc-ready` route handler、`ExternalIfcReadyStore`。
- Tests/contracts: 既有 intake route / contract test 補 worker payload cases；新增 auto-session unit test；callback outbox 與 session 接線狀態分離斷言；維持 root `python -m pytest tests` baseline 綠。
- Dependencies: none。
- Render tier: 真實 GPU / Kit render / WebRTC `49100` / browser visual 維持 `not_observed`，不在本 change pass 範圍（與 archive Decision 一致）。
- Predecessor: `2026-05-21-coordinator-ifc-ready-worker-webhook`（archived 2026-05-21，documentation lag）；retro-audit commit `a32fcd6` 已標 26 tasks `[ ] — deferred`，本 change 落地後升級為 `[x] — implemented by`。
