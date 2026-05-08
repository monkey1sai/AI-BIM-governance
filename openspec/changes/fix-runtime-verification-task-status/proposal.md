## Why

`complete-spec-runtime-verification` 的 review 發現 `tasks.md` 把 blocked runtime evidence 項目勾成完成，容易讓 `openspec instructions apply` 的 `all_done` 訊號被誤讀為 GPU render 或 concurrent runtime 已通過。現在需要把任務語意改成「硬體相依 runtime tier 必須真的在 GPU-backed Kit runtime 上執行並留下 evidence 才能完成」，避免用 blocked classification 取代實機驗證。

## What Changes

- 定義 runtime verification tasks 的 checklist 語意：`[x]` 只能代表該 runtime tier 的 in-scope success criteria 已由真實 evidence 滿足，不能用 blocked classification 代替。
- 將 single Kit GPU render 驗收改成必須啟動 GPU-backed `bim-streaming-server`，經由 `_worker -> _bim-control -> bim-review-coordinator -> web-viewer-sample -> bim-streaming-server` 載入 renderable USD / USDC，並記錄 browser video readiness、non-zero video frame 或 viewport screenshot、`openedStageResult`、session / artifact evidence。
- 將本階段的併行 runtime 驗收改成 single Kit process 內的 `primaryStream` + `spectatorStream[0]` 並行串流；若要驗證兩個以上獨立 Kit process，必須列為後續 dedicated capacity tier，不能在本階段用錯誤拓樸硬宣稱通過。
- 要求 browser E2E 成功時必須把截圖保存成 repo-local evidence artifact，並在 verification report 中引用檔案路徑、session id、Kit endpoint、artifact URL 與截圖時間。
- 要求 verification report 與 tasks 對 `passed` / `blocked` / `failed` / `deferred` 的描述一致，特別是 GPU probe、Kit listener、primary / spectator stream ports、viewport screenshot、concurrent browser readiness。
- 補上 Kit 啟動腳本的 spectator stream 支援，讓同一個 GPU-backed Kit instance 可提供 primary / spectator 兩組 distinct WebRTC stream ports 供兩個 browser pages 同時觀看。
- 不啟動 retired services，不修改 Socket.IO event、WebRTC / DataChannel payload 或 storage schema；若需要啟動或協調 runtime，只能使用 root / service 啟動腳本，不改資料權威邊界。

## Capabilities

### New Capabilities

- `runtime-verification-task-status`: 定義 OpenSpec runtime verification checklist 何時可以宣稱 GPU-backed runtime validation passed，以及 blocked / unavailable topology 何時只能保持未完成或 deferred。

### Modified Capabilities

- None.

## Impact

- 主要影響 `openspec/changes/complete-spec-runtime-verification/tasks.md` 的任務語意與 review finding 修正：GPU / concurrent runtime items 不得因 blocker classification 被視為完成。
- 可能同步更新 `docs/verification/2026-05-08-spec-end-to-end-verification.md`，補上真實 GPU run 的 command、ports、session id、artifact URL、browser evidence、screenshot 檔案路徑，或明確列為 deferred。
- 後續 apply 可能需要使用 GPU-backed Windows workstation、Kit SDK、renderable USD / USDC fixture，以及 root `scripts/` 的 multi-service / same-Kit spectator orchestration。
- 影響 `bim-review-coordinator` 的 stream config response shape：新增 optional `mediaPort`，並新增 `KIT_MEDIA_PORT` / `KIT_INSTANCE_ENDPOINTS` runtime config。
- 影響 `bim-streaming-server` 與 root `scripts/`：啟動腳本可用 primary `SignalPort` / `StreamPort` 加上 spectator stream ports 啟動單一 Kit process 的並行 stream。
- 影響 `web-viewer-sample`：browser page 可用 explicit ports 與 `streamRole=spectator` 連到同一 Kit 的 spectator stream；同一 React page 仍維持單一 `AppStreamer` connection。
- 無 Socket.IO event、storage、session lifecycle 或資料權威邊界變更。
- 無新增 dependency。
