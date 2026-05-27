## 1. OpenSpec 與設計

- [x] 1.1 建立 `fix-lan-webrtc-multi-viewer-handoff` proposal / design / tasks / spec deltas。
- [x] 1.2 跑 `openspec validate fix-lan-webrtc-multi-viewer-handoff --strict`，確認 artifacts 合法。
- [x] 1.3 更新 tasks 狀態，保持 OpenSpec artifact 與實作範圍一致。

## 2. Coordinator LAN viewer handoff

- [x] 2.1 在 `bim-review-coordinator` 新增 viewer public base URL 設定與 helper，支援 `VIEWER_PUBLIC_BASE_URL`、`PUBLIC_HOST` + `VIEWER_PORT`、localhost fallback。
- [x] 2.2 修改 `GET /ui/open?session=`，以 trusted config 組 redirect target，帶入 `session`、`coordinatorApiBase`、`coordinatorSocketUrl`，並拒絕/忽略任意 redirect target。
- [x] 2.3 修改 runtime status 與 `/ui` copy，顯示實際 browser-visible viewer URL 與 coordinator endpoint，不再宣稱 host loopback 是 LAN 可用入口。
- [x] 2.4 補 coordinator tests：explicit LAN URL、不含 `127.0.0.1`、localhost default、open redirect query ignored。

## 3. Viewer handoff bootstrap

- [x] 3.1 修改 `web-viewer-sample/src/config/env.ts`，讓 query `coordinatorApiBase` / `coordinatorSocketUrl` 優先於 Vite env 與 localhost default。
- [x] 3.2 確認同一 `session` query 不會 auto-create unrelated session，並保留 `sessionId` legacy fallback。
- [x] 3.3 補 viewer unit/script validation，覆蓋 LAN handoff query 與 localhost fallback。

## 4. Same-session multi-viewer evidence

- [x] 4.1 補 coordinator runtime/session evidence，讓同一 session 的 participant/viewer count 可觀察。
- [x] 4.2 建立兩個 browser clients 同時開同一 `review_session_id` 的驗證腳本或 runbook。
- [x] 4.3 若第二 viewer 無法取得 WebRTC video/stage match，保留 failure evidence 與最小 next fix path，不把 runtime pass 標成完成。

## 5. Webwright 安裝與截圖驗證

- [x] 5.1 在本機 validation 目錄 checkout `https://github.com/microsoft/Webwright`。
- [x] 5.2 依官方 README 安裝 Webwright (`pip install -e .`) 與 Playwright Chromium (`playwright install chromium`)。
- [x] 5.3 用 Webwright/Playwright 跑 LAN handoff + two-viewer validation，輸出 screenshots / logs / target URLs / session id。
- [x] 5.4 將 Webwright 驗證輸出整理到 repo-local evidence path，並在 final summary 引用。

## 6. Validation

- [x] 6.1 跑 coordinator 最小測試：`cd bim-review-coordinator && npm test` 或 affected tests。
- [x] 6.2 跑 viewer build / targeted validation：`cd web-viewer-sample && npm run build` 與相關 script。
- [x] 6.3 跑 `openspec validate fix-lan-webrtc-multi-viewer-handoff --strict`。
- [x] 6.4 若 code symbols 有修改，依 GitNexus 規則跑 impact/detect changes。
