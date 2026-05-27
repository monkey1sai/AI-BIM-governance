## Context

現行 fast MVP loop 已能在 host 同機瀏覽器透過 coordinator `/ui/open?session=` 開啟 viewer，
但 `bim-review-coordinator/src/app.ts` 仍固定 redirect 到
`http://127.0.0.1:5173/?session=...`。`web-viewer-sample/src/config/env.ts` 也預設
coordinator API / Socket.IO 為 `http://127.0.0.1:8004`。當 client 在另一台電腦打開連結時，
這些 loopback 會指到 client 自己，而不是 streaming host。

Roadmap 已把 `same-kit-multi-viewer-session-evidence` 排在 single-viewer closed loop 之後。
本次使用者選定 A 方案：先證明同一個已轉檔 review session 可由至少兩個 browser clients
同時觀看同一 Kit runtime 畫面。這比 dedicated multi-Kit 小，且直接對應目前痛點。

## Goals / Non-Goals

**Goals:**

- 將 coordinator viewer handoff 改成設定驅動的 browser-visible URL。
- 讓 viewer 從 handoff query 使用正確 coordinator API / Socket.IO base，而非固定 `127.0.0.1`。
- 保留 loopback dev convenience：localhost request 可繼續使用 loopback；LAN/public host request 不得被導向 client loopback。
- 建立同一 `review_session_id` 的兩個 browser clients validation path，包含 participant/viewer count、WebRTC lifecycle、stage URL match 與 screenshot evidence。
- 最終用本機安裝的 Microsoft Webwright 跑可重複的 browser validation script 並保存截圖。

**Non-Goals:**

- 不做 dedicated multi-Kit / 多 GPU 排程。
- 不要求 `bim-streaming-server` 在本 change 內新增 spectator stream；若同一 primary endpoint 多 PeerConnection 失敗，先產出 defect/evidence，再另開 follow-up。
- 不恢復已退役的 issue / annotation / conflict-review collaboration UI。
- 不把 Webwright 當 production dependency。

## Decisions

### Decision 1: Coordinator owns trusted viewer URL construction

`bim-review-coordinator` 新增設定 `VIEWER_PUBLIC_BASE_URL`，優先順序為：
explicit `VIEWER_PUBLIC_BASE_URL` > 依 `PUBLIC_HOST` + `VIEWER_PORT` 組合的 URL >
localhost default。`/ui/open?session=` 只使用設定與已驗證 session id 組 URL，不接受 query
中的任意 redirect target。

Rationale: handoff URL 是 control-plane/session entrypoint 的一部分，歸 coordinator 組裝最清楚；
安全上也避免 open redirect。

### Decision 2: Handoff query carries coordinator base and socket base

redirect URL 加上 `session`、`coordinatorApiBase`、`coordinatorSocketUrl`。viewer 先讀 query，
再 fallback 到 Vite env，最後才 fallback localhost。遠端 client 因此可從同一 URL 得到正確的
coordinator endpoint。

Rationale: Vite build-time env 不適合每台 client 動態變；query handoff 是最小可逆改動。

### Decision 3: Same-session multi-viewer first, dedicated multi-Kit later

本 pass 的 success 標記只允許 `single_kit_multi_viewer=passed`。兩個 browser clients 可連同一
Kit endpoint，並以兩份 screenshot/video readiness/stage match 證據證明。若 vendor/runtime 不支援
同 primary endpoint 多 PeerConnection，tasks 需留下失敗診斷，而不是升級改做 dedicated multi-Kit。

Rationale: 使用者目前痛點是多人觀看同一已轉檔畫面與 URL loopback 錯誤，不是 isolation / GPU
capacity scheduling。

### Decision 4: Webwright is validation tooling

Webwright 以 local checkout + editable Python install 執行，使用 Playwright Chromium 產生 screenshot
與 log。它只放在 validation/runbook，不納入 product service package。

Rationale: 使用者明確要求 Webwright 驗證與截圖；官方 README 也將 Webwright 定位為 terminal-native
browser agent/harness。將它留在 validation 層可避免污染 runtime dependency。

## Risks / Trade-offs

- [Risk] 真實 Kit WebRTC primary endpoint 可能不支援兩個同時 viewer。→ Mitigation: tasks 分成 contract
  tests 與 live Webwright evidence；若 live evidence 失敗，保留 defect code/log/screenshot，不把 runtime pass
  標成完成。
- [Risk] `VIEWER_PUBLIC_BASE_URL` 設錯會產生不可用 URL。→ Mitigation: `/ui` runtime status 顯示實際 URL；
  tests cover explicit base / PUBLIC_HOST fallback / localhost default。
- [Risk] query 帶入 coordinator base 可能被濫用成任意外站 endpoint。→ Mitigation: 只由 coordinator redirect
  產生；viewer 只把它當連線 base，不執行程式碼；不接受 redirect target。
- [Risk] Webwright 需要下載 repo / Playwright browser，受網路與權限影響。→ Mitigation: 安裝步驟獨立於產品驗證；
  若下載被擋，記錄工具層 blocker，但仍保留產品測試 evidence。

## Migration Plan

1. 新增 config helper 與 tests，保持 default localhost 行為。
2. 修改 `/ui/open` 與 runtime status/dev console copy，讓 operator 看到 browser-visible URL。
3. 修改 viewer env parsing，接受 handoff query base URLs。
4. 增加 coordinator/viewer tests。
5. 跑 OpenSpec validate、coordinator verify、viewer build/test。
6. 安裝 Webwright 到本機 validation workspace，跑同 session two-viewer screenshot script。
7. 保存 screenshot/log/evidence，更新 tasks。

Rollback: revert this change branch；runtime defaults 回到既有 localhost-only 行為。

## Open Questions

- OQ1: 實機 Kit primary endpoint 是否允許兩個 simultaneous PeerConnection；需 Webwright/live browser evidence 判定。
- OQ2: production URL 是否由 reverse proxy 提供 HTTPS；本 change 只要求 browser-visible URL contract，不強制 TLS。
