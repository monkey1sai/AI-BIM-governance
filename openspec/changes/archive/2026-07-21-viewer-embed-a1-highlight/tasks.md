# Tasks — viewer-embed-a1-highlight

對應 spec `docs/superpowers/specs/2026-06-22-viewer-embed-a1-highlight-design.md` + plan `docs/superpowers/plans/2026-06-22-viewer-embed-a1-highlight.md`（含 ultracode 對抗驗證修訂段）。

- [x] 0. coordinator `first_frame_at` 後端化：`POST .../first-frame`（safe-id/409/冪等/孤兒 event 防禦/endpoint_id 截斷）+ 型別鏈三處（summarizeSessionForRuntime emit / RuntimeSessionSummary 欄 / runtimeGovernance 讀真值）+ eventLog firstFrameObserved 顯式登記 + 合約 §9 同步。回歸鎖 coordinator 441 tests。
- [x] 1. `<EmbeddedViewer>` 元件 + `vg01` postMessage 橋（iframe 嵌 viewer、origin 白名單非 `"*"`、event.source 驗證、未知 type 忽略、forwardRef handle）。
- [x] 2. `Window.tsx` parent listener（M1 first_frame 單送閂 `_firstFramePosted` 接 `_completeStageLoad`、M2 canOperate 守衛 highlight/focus/clear、M5 referrer 交叉驗 + 白名單）。S3 嵌入時失敗清單收合。
- [x] 3. A1 頁嵌入 `<EmbeddedViewer>`（gated render + `key={session}`）+「在 3D 高亮」翻真（IX-A1-06 四條件）+ session 下拉選取。
- [x] 4. `ViewerPresentationPage` 證據顯示 p1→翻真 + `runtimeGovernance` 讀真 `first_frame_at` + `coordinatorClient` reportFirstFrame / RuntimeSessionSummary 型別鏈收尾。
- [x] 5. Browser E2E（Playwright 真 Kit 取證；model-path 用 conversion source IFC）。test 1 first frame+stage matched PASS、test 2 紅高亮操作鏈 PASS（視覺紅色 georeferenced 相機框取限制揭露）；test 3 未對映誠實拒絕 `test.fixme`（NOT BUILT 列級高亮鈕）。evidence 入庫 `docs/evidence/viewer-embed-a1-highlight/`。
- [x] 6. follow-up（不在本 change）— **2026-07-21 archive 裁決**：本 change 以 task 0–5 為 done；下列另開 issue，不擋 archive：`Window.tsx` latch 注解清理、A2/A3 onion-skin/clash、列級高亮鈕 + 未對映拒絕截圖、runtimeGovernance readiness `connected && first_frame_at → occupied`。
