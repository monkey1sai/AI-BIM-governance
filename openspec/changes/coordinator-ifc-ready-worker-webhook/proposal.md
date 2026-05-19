## Why

現行 B 方案已規定外部 IFC-ready 入口歸 `bim-review-coordinator`，但實際 worker 端目前送出的 webhook payload 是較簡化的 `status / ifc_path / project_id / version / task_id` 格式。若 coordinator 不明確支援這個格式，worker 完成 IFC 後仍無法穩定把「IFC 已準備好」事件交給本 repo 的轉檔閉環。

## What Changes

- 在 `bim-review-coordinator` 規格中定義 `POST /api/external/ifc-ready` 可接收 worker `ifc_ready` payload：
  - `status: "ifc_ready"`
  - `ifc_path`
  - `project_id`
  - `version`
  - `task_id`
- coordinator 將此 payload 正規化為既有 B 方案 conversion job 所需欄位，例如 `source_ifc_ref`、`external_model_version_id`、`external_conversion_task_id`、`correlation_id`、`idempotency_key`。
- `task_id` 在 worker 未提供明確 `correlation_id` / `idempotency_key` 時作為可追蹤與可重試的主要來源。
- 保留 `bim-streaming-server` 為 internal-only IFC->USDC conversion engine；coordinator 仍負責外部 webhook intake、idempotency、shadow metadata 與 callback outbox。
- Non-goal：不復活已刪除的 `_worker` / `_bim-control` runtime，不讓 streaming server 暴露 public IFC-ready webhook，不新增 production dependency，不修改 secrets 或真實 `.env` 值。

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `local-coordinator-ifc-ready-intake-boundary`: 明確支援 worker `ifc_ready` webhook payload，並定義 coordinator 的欄位正規化、驗證、idempotency 與錯誤回應。
- `conversion-webhook-lifecycle`: 明確定義 worker payload 缺少 explicit correlation / idempotency 欄位時，coordinator 如何從 `task_id` 派生可追蹤事件，並維持後續 internal conversion 與 cloud callback 的 correlation。

## Impact

- Owner repo/folder: `bim-review-coordinator/`
- API: `POST /api/external/ifc-ready` 接受 worker payload 格式；API path 維持英文。
- Data structure: 新增/確認 worker payload 到 local shadow conversion job 欄位的 mapping；不保存大型 IFC/USDC file body。
- Affected integration: external customer-edge IFC Worker -> `bim-review-coordinator` -> `bim-streaming-server` internal conversion request -> coordinator metadata-only callback outbox。
- Tests/contracts: 需補 coordinator route / contract test，涵蓋 valid payload、invalid status、missing required fields、duplicate `task_id` replay、conflicting retry。
- Dependencies: none.
