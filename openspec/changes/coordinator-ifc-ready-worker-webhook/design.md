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

## Goals / Non-Goals

**Goals:**

- 讓 `bim-review-coordinator` 的 `POST /api/external/ifc-ready` 接受 worker `status / ifc_path / project_id / version / task_id` payload。
- 在 coordinator 邊界把 worker payload 正規化為既有 `ExternalIfcReadyEvent`，避免把簡化格式滲透到 streaming server。
- 以 `task_id` 作為 worker payload 的 idempotency / correlation fallback，讓重送同一 task 不建立重複 conversion job。
- 保留現有 canonical payload 支援，讓新舊 caller 可共存。
- 補 contract / unit tests，覆蓋 valid worker payload、缺欄位、錯誤 status、idempotent replay、conflicting retry、以及 internal streaming dispatch mapping。

**Non-Goals:**

- 不復活 `_worker` / `_bim-control` 產品 runtime；測試 double 仍只放在 `tests/fakes`。
- 不讓 `bim-streaming-server` 開 public external webhook。
- 不讓 coordinator 保存 IFC / USDC 大型檔案本體。
- 不新增 production dependency，不修改真實 `.env` secrets。
- 不在此解決真實公司雲端 callback endpoint、tenant mapping、mTLS 或 SSO 發證問題。

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

## Risks / Trade-offs

- [Risk] `version` 是否等同外部 control-plane 的 `external_model_version_id` 仍需與公司雲端確認。 -> Mitigation：規格明確把它作為目前 worker payload mapping；若外部平台改欄位，後續用 coordinator normalization 層調整，不影響 streaming。
- [Risk] `task_id` 可能只在 worker local scope 唯一，不一定跨 project 全域唯一。 -> Mitigation：idempotency key 應由 `project_id + version + task_id` 或 equivalent fingerprint 派生，避免不同 project 的 task 撞 key。
- [Risk] worker payload 缺少 `source_ifc.etag`，降低 artifact integrity check。 -> Mitigation：coordinator 可以在缺 etag 時保存 deterministic fallback（例如 `unknown:<task_id>` 或 request fingerprint），但不得把它當成真實 checksum；後續若 worker 可提供 checksum，再升級 contract。
- [Risk] intranet-dev tenant fallback 可能被誤認為 production 身分。 -> Mitigation：production provider 必須要求真實 machine identity / tenant mapping；本 change 只允許 minimal dev fallback 作為 compatibility。
