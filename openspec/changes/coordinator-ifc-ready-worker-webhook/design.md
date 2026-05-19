## Context

`bim-review-coordinator` 現已提供 `POST /api/external/ifc-ready`，目前 canonical contract 以 `event="ifc_ready"`、`tenant_id`、`project_id`、`external_model_version_id`、`source_ifc.ref/etag`、以及 header-based `X-Correlation-Id` / `X-Idempotency-Key` 為主。使用者提供的 worker 端實際 payload 較簡化：

```json
{
  "status": "ifc_ready",
  "ifc_path": "http://.../model.ifc",
  "project_id": "...",
  "version": "...",
  "task_id": "..."
}
```

這代表 coordinator 需要在外部 intake boundary 支援 worker payload compatibility，而不是要求 worker 立即改成完整 canonical contract。repo 邊界仍維持：外部 IFC Worker 只負責產出 IFC 並通知；coordinator 負責 intake / idempotency / local shadow metadata；streaming server 只接 internal conversion request；公司雲端 control-plane 仍是外部權威。

### 退役 `_bim-control` 孤立掉的 session 觸發責任

`review-session-request-lifecycle` 既有需求「Coordinator session is bound back to the request」原文：「After artifact readiness is confirmed, `_bim-control` or an approved service adapter SHALL call `bim-review-coordinator POST /api/review-sessions`」。但 B 方案已把 `_bim-control` / `_worker` 自 product runtime 刪除，spec 指派的觸發者不再以 runtime 存在。閱讀 `bim-review-coordinator/src/app.ts` 現況確認：

- `ingestConversionReport`（terminal `ready` / `failed`）只 `callbackOutbox.enqueue` ＋ `externalIfcReadyStore.recordConversionOutcome`，**不呼叫** `SessionStore.create`。
- `POST /api/review-sessions` 仍在，但本地沒有任何 actor 在 conversion-ready 時自動打它。
- `POST /api/local-web-view/sessions` 只回 `viewer_open_ready` 布林與 artifact_resolution，不配置 `kit_instance_bindings`、不建完整 `ReviewSession`。

因此本 change 的出口側決策核心是：把這個被退役 `_bim-control` 孤立的觸發責任，re-home 進 coordinator 自身的 conversion-ready ingestion，作為**control-plane 自動接線**，且嚴守 coordinator 邊界（不渲染、不控 Kit 進程、不開 USD）。

## Goals / Non-Goals

**Goals:**

- 讓 `bim-review-coordinator` 的 `POST /api/external/ifc-ready` 接受 worker `status / ifc_path / project_id / version / task_id` payload。
- 在 coordinator 邊界把 worker payload 正規化為既有 `ExternalIfcReadyEvent`，避免把簡化格式滲透到 streaming server。
- 以 `task_id` 作為 worker payload 的 idempotency / correlation fallback，讓重送同一 task 不建立重複 conversion job。
- 保留現有 canonical payload 支援，讓新舊 caller 可共存。
- 補 contract / unit tests，覆蓋 valid worker payload、缺欄位、錯誤 status、idempotent replay、conflicting retry、以及 internal streaming dispatch mapping。
- 讓 coordinator 在自身 conversion-ready ingestion（terminal `ready`）時自動建立/啟用一個綁好新 USDC 與 Kit binding 的 review session，讓 session-first viewer 能在無 `_bim-control` runtime 下自動接上。
- 自動建立對同一 `correlation_id` / `external_model_version_id` idempotent，且與既有 explicit `POST /api/review-sessions` 呼叫者共存。
- 補 coordinator 測試：conversion-ready 自動建 session、idempotent 不重複建、非 ready/failed 不建可串流 session、callback outbox 與 session 接線狀態分離。

**Non-Goals:**

- 不復活 `_worker` / `_bim-control` 產品 runtime；測試 double 仍只放在 `tests/fakes`。
- 不讓 `bim-streaming-server` 開 public external webhook。
- 不讓 coordinator 保存 IFC / USDC 大型檔案本體。
- 不新增 production dependency，不修改真實 `.env` secrets。
- 不在此解決真實公司雲端 callback endpoint、tenant mapping、mTLS 或 SSO 發證問題。
- 不讓 coordinator 啟動/控制 Kit 進程、開 USD stage 或渲染（沿用 coordinator 邊界；3D runtime 由 `bim-streaming-server` 自治）。
- 不把真實 GPU/Kit render 與 browser 可見畫面（`single_kit_render` / WebRTC `49100` / browser visual）納入本 change pass；該 tier 獨立判定、不升等。
- 不復活 `_bim-control` 作為觸發者；session_id / binding 改寫進本地最小 shadow metadata，不 mirror 公司雲端。

## Decisions

1. 在 coordinator 做 input normalization，而不是新增第二個 runtime service。
   - Rationale：外部入口已歸 coordinator，將 worker payload 轉成 canonical event 能重用現有 `ExternalIfcReadyStore`、`StreamingConversionClient` 與 callback outbox。
   - Alternative considered：要求 worker 直接送 full canonical payload。這會讓 integration 先卡在 worker 改造，與使用者目前要先開 webhook 接收的目標不符。

2. `status` 僅接受 `"ifc_ready"`，並映射成 canonical `event="ifc_ready"`。
   - Rationale：圖中 payload 用 `status` 表示事件型態；coordinator 只接收完成狀態，不把 blocked/failed worker 狀態誤建成 downstream conversion job。
   - Alternative considered：接受任意 `status` 並記錄為 job state。這會模糊 upstream export state 與 local conversion job state。

3. 欄位 mapping 固定在 coordinator boundary：
   - `ifc_path` -> `source_ifc.ref`
   - `version` -> `external_model_version_id`
   - `task_id` -> `external_conversion_task_id`
   - `task_id` -> fallback `correlation_id` / `idempotency_key`
   - `project_id` -> `project_id`
   - `tenant_id` 若 worker payload 未提供，使用 intranet-dev 設定或明確的 development fallback，但不得宣告本地成為 tenant authority。

4. Idempotency 以 explicit header 優先，worker payload 的 `task_id` 為 fallback。
   - Rationale：保留現有 canonical caller 行為，同時讓簡化 worker payload 也可安全重試。
   - Alternative considered：永遠忽略 headers 只用 `task_id`。這會破壞已存在的 canonical contract 與 HMAC/correlation 設計。

5. Streaming internal request 不接受 worker payload 原樣轉送。
   - Rationale：`bim-streaming-server` 的 internal API 已收斂為 conversion authority contract；worker payload 是 external intake compatibility，不應變成 streaming API contract。

6. Session 自動觸發點放在 `ingestConversionReport` 的 terminal `ready` 分支，而不是新增 service 或改 callback outbox。
   - Rationale：該函式已是 `/api/internal/conversion-result` 與 `/api/internal/conversions/:id/ingest` 共用的 terminal 收斂點，擁有 job correlation 與 readiness；在此 re-home 觸發責任改動面最小、與 callback outbox 並行而非耦合。
   - Alternative considered：在 callback outbox deliver 時建 session — 會把「對外雲端投遞」與「對內 viewer 接線」兩個不同關注點耦合，且 outbox 可 pending/dead-letter，會延誤本地 viewer。

7. 自動建立重用既有 `POST /api/review-sessions` 內部邏輯（`SessionStore.create` + `allocateKitInstanceBindings` + `chooseReadyUsdc`），以 internal 呼叫或抽取共用 helper 形式，不複製 session 邏輯。
   - Rationale：保持單一 session 建立權威，避免兩套 binding 規則漂移；維持 `auto_allocate_kit` / capacity `queued_for_instance` 既有語意。

8. Idempotency：以 `correlation_id`（或 `external_model_version_id`）為 key，conversion-ready 重入或重送只回既有 session，不建重複 active session；非 ready / failed 不建可串流 session（沿用 `Review sessions reference streaming-owned conversion readiness`）。
   - Rationale：conversion-ready ingestion 可能被輪詢重打；session 必須像 outbox 一樣對重入安全。

## Risks / Trade-offs

- [Risk] `version` 是否等同外部 control-plane 的 `external_model_version_id` 仍需與公司雲端確認。 -> Mitigation：規格明確把它作為目前 worker payload mapping；若外部平台改欄位，後續用 coordinator normalization 層調整，不影響 streaming。
- [Risk] `task_id` 可能只在 worker local scope 唯一，不一定跨 project 全域唯一。 -> Mitigation：idempotency key 應由 `project_id + version + task_id` 或 equivalent fingerprint 派生，避免不同 project 的 task 撞 key。
- [Risk] worker payload 缺少 `source_ifc.etag`，降低 artifact integrity check。 -> Mitigation：coordinator 可以在缺 etag 時保存 deterministic fallback（例如 `unknown:<task_id>` 或 request fingerprint），但不得把它當成真實 checksum；後續若 worker 可提供 checksum，再升級 contract。
- [Risk] intranet-dev tenant fallback 可能被誤認為 production 身分。 -> Mitigation：production provider 必須要求真實 machine identity / tenant mapping；本 change 只允許 minimal dev fallback 作為 compatibility。
- [Risk] 自動建 session 與既有 explicit `POST /api/review-sessions` 呼叫者可能對同一 model version 競爭、產生重複 session。 -> Mitigation：Decision 8 的 correlation/model-version idempotency；重入回既有 session 而非新建。
- [Risk] conversion-ready 但 GPU/Kit 無容量時自動建 session 會卡 `queued_for_instance`。 -> Mitigation：沿用既有 capacity 語意，session 記 `queued_for_instance` 不丟 review intent；viewer 顯示 capacity waiting，不宣稱 streaming ready。
- [Risk] 把「自動建 session」誤讀成「轉檔好就有畫面可看」。 -> Mitigation：proposal/design 明示這是 control-plane 接線；真實 GPU/Kit render + browser visual 是獨立 not-asserted tier，需 Kit build + GPU host，不在本 change pass。
- [Risk] re-home 後 `review-session-request-lifecycle` 仍以 `_bim-control` 為主詞，spec 與 B 方案現況不一致。 -> Mitigation：本 change 對該需求做 MODIFIED delta，明確 B 方案 runtime 下觸發者為 coordinator ingestion，patch-back 對象為本地 shadow metadata；canonical `_bim-control`/adapter 路徑保留為相容。
