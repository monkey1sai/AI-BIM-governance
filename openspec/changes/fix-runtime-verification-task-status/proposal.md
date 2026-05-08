## Why

`complete-spec-runtime-verification` 的 review 發現 `tasks.md` 把 blocked runtime evidence 項目勾成完成，容易讓 `openspec instructions apply` 的 `all_done` 訊號被誤讀為 GPU render 或 multi-Kit runtime 已通過。現在需要把任務語意收斂成「完成 blocked evidence classification」或「完成成功驗證」，避免 PR review 與 archive 流程誤判。

## What Changes

- 定義 runtime verification tasks 的 checklist 語意：`[x]` 只能代表該任務描述本身已完成，不能暗示 blocked runtime tier 已 successful validated。
- 將需要 GPU render 或 multi-Kit topology 的 tasks 改寫成 attempt / classify / record blocker 形式，或在缺少前置條件時保持未完成。
- 要求 verification report 與 tasks 對 blocked/not passed 的描述一致，特別是 viewport screenshot、non-zero video frame、distinct Kit endpoints、concurrent browser readiness。
- 不新增 production runtime 功能，不啟動 retired services，不修改 REST API、Socket.IO event、WebRTC / DataChannel payload 或 storage schema。

## Capabilities

### New Capabilities

- `runtime-verification-task-status`: 定義 OpenSpec runtime verification checklist 如何表達 successful validation、blocked evidence capture 與 unavailable topology。

### Modified Capabilities

- None.

## Impact

- 主要影響 `openspec/changes/complete-spec-runtime-verification/tasks.md` 的任務語意與 review finding 修正。
- 可能同步更新 `docs/verification/2026-05-08-spec-end-to-end-verification.md`，補上 re-verification 時的實際 port / script / artifact blocker evidence。
- 不影響 `_worker`、`_bim-control`、`bim-review-coordinator`、`bim-streaming-server`、`web-viewer-sample` 的 production code。
- 無 API、資料結構、事件、storage、session lifecycle 或 runtime boundary change。
- 無新增 dependency。
