## Why

目前 workspace 已累積多個 demo 與 runtime 驗證證據，但功能狀態分散在 OpenSpec archive、roadmap、verification report、啟動腳本與實機環境中。需要建立一個以 demo 為中心的現況觀測 change，把所有可運行功能重新分層驗證，讓「已通過、已阻塞、延後、未觀測」都有可追溯證據。

## What Changes

- 建立 demo current-state observation 流程，盤點 `_bim-control`、`_worker`、`bim-review-coordinator`、`web-viewer-sample` 與可用的 `bim-streaming-server` runtime。
- 重新執行或明確記錄最小驗證：health check、API smoke、service tests/builds、worker conversion evidence、review session lifecycle、Socket.IO collaboration、browser E2E，以及 Kit/WebRTC runtime tier。
- 產出 repo-local verification report，記錄命令、時間、服務端口、session/artifact IDs、screenshots 或 blocker classification。
- 保持 runtime evidence 分層：API pass 不等於 GPU/browser pass，conversion pass 不等於 visual preview pass，single-Kit pass 不等於 dedicated multi-Kit pass。
- 不新增 production dependency，不改變既有 API、資料結構、event schema、storage layout、session lifecycle 或 Kit runtime contract，除非後續觀測發現明確缺口並另開實作 change。

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `runtime-verification-evidence`: require current demo observation evidence to record each demo tier as `passed`, `failed`, `blocked`, `deferred`, or `not_observed`, with commands, runtime prerequisites, IDs, and artifacts sufficient for replay.
- `runtime-verification-task-status`: require demo observation tasks to remain incomplete unless current live evidence or an explicit blocker/deferred classification is recorded.

## Impact

- Owner: root OpenSpec and verification documentation, with per-service observation staying inside each repo/folder boundary.
- Affected folders: `openspec/changes/demo-current-runtime-observation/`, likely `docs/verification/`, and possibly `docs/plans/AI-BIM-governance-saas-roadmap-2026-05.md` after observation results are collected.
- Service boundaries: `_bim-control` remains fake BIM data authority; `_worker` remains artifact/conversion facade; `bim-review-coordinator` remains session/collaboration control plane; `bim-streaming-server` remains Kit/WebRTC runtime; `web-viewer-sample` remains browser client.
- API/data/event/storage/session/runtime changes: none planned in this proposal.
- Dependencies: none planned.
- Non-goals: do not revive `_s3_storage`, `_conversion-service`, or `_conversion-server` as current demo dependencies; do not claim dedicated multi-Kit runtime verification without at least two live GPU-backed Kit endpoints; do not treat documentation-only evidence as live runtime pass.
