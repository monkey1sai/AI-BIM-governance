## Why

目前 fast MVP viewer handoff 仍把 `/ui/open?session=` 302 導向
`http://127.0.0.1:5173/?session=...`。這在 streaming server 同機瀏覽器可用，
但 LAN client 會被導到自己的 loopback，等於看不到 host 端 viewer 與 Kit/WebRTC 畫面。

同時，single-viewer closed loop 已有 current evidence，但下一個正式 runtime 擴展
`same-kit-multi-viewer-session-evidence` 仍是 `not_observed`。本 change 要把「可從 LAN 開啟」
與「同一 review session 至少兩個 viewer 同時觀看」收斂成可驗證的 OpenSpec contract。

## What Changes

- `bim-review-coordinator` 的 viewer handoff SHALL 產生 browser-visible viewer URL，不再固定 redirect 到 `127.0.0.1:5173`。
- `/ui/open?session=` SHALL 使用受信任的設定值組 viewer URL，並保留 session id 驗證；不得接受任意 query redirect target。
- coordinator runtime status 與 `/ui` SHALL 顯示實際 browser-visible viewer URL、coordinator base URL 與 Kit endpoint，讓 operator 可先看出 client 會連到哪台機器。
- `web-viewer-sample` SHALL 能從 coordinator handoff query 取得 `session`、coordinator API base、Socket.IO base 與 WebRTC endpoint，避免遠端 client 回打自己的 `127.0.0.1`。
- 同一 `review_session_id` SHALL 支援至少兩個 browser clients 同時加入並嘗試連同一 Kit endpoint；runtime evidence 只能將 `single_kit_multi_viewer` 標為 passed，不得升級為 dedicated multi-Kit passed。
- 驗證層 SHALL 安裝並使用 Microsoft Webwright 產生本機瀏覽器驗證與截圖 artifact，作為 final evidence 的一部分。

## Capabilities

### New Capabilities

- 無。

### Modified Capabilities

- `local-coordinator-ifc-ready-intake-boundary`: 修改 `/ui/open` viewer handoff，要求 browser-visible URL 與 loopback 安全策略。
- `session-first-review-viewer`: 修改 viewer bootstrap contract，要求 coordinator base/socket base 可由 handoff 帶入，並防止遠端 client 回打自身 loopback。
- `multi-artifact-kit-routing`: 擴充 single-Kit multi-viewer sharing 的 observable contract，與 dedicated multi-Kit routing 保持分離。
- `demo-runtime-readiness-smoke`: 新增 same-session LAN multi-viewer smoke evidence 要求與 Webwright screenshot artifact。
- `runtime-verification-task-status`: 修改 same-Kit concurrent runtime evidence 規則，允許本 pass 以同一 primary Kit endpoint 的多 PeerConnection 作為 `single_kit_multi_viewer` evidence，並將 spectator stream 視為後續更強驗證。

## Impact

- Owner folders:
  - `bim-review-coordinator/`: URL handoff, runtime status, dev console copy, tests.
  - `web-viewer-sample/`: handoff query parsing, coordinator/socket base selection, tests/build.
  - `openspec/changes/fix-lan-webrtc-multi-viewer-handoff/`: requirements, design, tasks.
  - `docs/superpowers/specs/`: brainstorming design record.
  - `docs/evidence/` 或 `docs/verification/evidence/`: Webwright screenshot / validation artifacts.
- No production dependency is required for runtime services. Webwright is a local validation tool installed outside product runtime.
- No external company cloud or customer-edge IFC Worker runtime is introduced. The existing B-scheme boundary remains: coordinator owns session/control-plane metadata, streaming server owns Kit/WebRTC runtime, viewer owns browser interaction.
- Non-goals:
  - 不做 dedicated multi-Kit scheduling。
  - 不恢復 issue / annotation / conflict-review collaboration UI。
  - 不把 `bim-streaming-server` 改成多人協作事件中心。
  - 不把 Webwright 納入 production dependency 或服務啟動鏈。
