## Why

C（Viewer/Runtime）區塊 M4：把「治理面板 ↔ 3D viewer runtime」的指令橋接（highlight / focus / stage load / artifact binding）與其授權邊界正式落地。對應 spec `docs/superpowers/specs/2026-07-03-c-m4-runtime-command-bridge-design.md`、plan `docs/superpowers/plans/2026-07-03-c-m4-runtime-command-bridge.md`。

此 change 為 spec-to-done retrofit 收斂：既有工作目錄改動經 P3（15 task，impact→TDD→雙 review）補完流程、P4 Layer3 真實 IFC 補收、P5 對抗複驗處置後入 PR。

## What Changes

- **C Viewer IA layout 契約**：MockViewport 3×3 grid IA、C 區塊五區 test id 斷言、中窗語意欄 overflow 修正（`web-viewer-sample/src/console/viewer/`）。
- **runtime mutator 授權（前端半 + Kit 端半）**：前端 `Window.tsx` 中央 `_sendStreamMessage` 加 primary/lease/lifecycle 三道 UX gate（standalone 直送與 VG-01 embedded postMessage 橋共用）；Kit 端新增 `runtime_authority.py`（`is_authorized_mutator`）作為 defense-in-depth 形狀檢查，8 個 mutating handler 前置守衛。
- **UI-local 選取與 runtime mutator 送出分離**：mapping-row 選列為 UI-local（不送 mutator），tree node 選取送 `selectPrimsRequest`+`focusPrimRequest`。
- **coordinator 邊界保留**：不新增通用 `/operations` runtime endpoint（新增 committed 回歸測試 `no-generic-operations-endpoint.test.ts` 守衛）。
- **三層驗證閘門**：Layer1 契約/unit、Layer2 harness browser E2E、Layer3 真實 IFC intake→轉檔 ready→`/ui/open` lineage。

## Impact

- Affected code：`web-viewer-sample`（Window.tsx runtime gate、viewer IA、harness fixture）、`bim-streaming-server`（runtime_authority.py + 8 handler 守衛 + pytest）、`bim-review-coordinator`（僅新增邊界回歸測試，未改 production 路由）。
- userFacing：true。P4 Layer2 harness 8 passed + Layer3 真實 IFC 3 specs passed（松風庵_建築_v2.ifc → mv_realifc_1783396194657_323492 → `/ui/open` review_session_e7d75e956c31，GPU Kit 綁定；stage-truth matched 刻意不斷言，不宣稱 3D 完成）。
- 誠實揭露（P5 對抗複驗，經使用者裁決以揭露+follow-up 處理）：
  - f4 已關閉（committed 回歸測試）。
  - f1（issue #307）：Kit 端授權只驗 lease 字串形狀、未回 coordinator 驗真偽——shared-state 下有 privilege-escalation-shaped 面；coordinator 為真實權威層，Kit 端為 defense-in-depth。
  - f5（issue #308）：embedded primary lease 晚到可能黑畫面 stall、無重試。
  - f3：第 7 塊 reverse-jump 只做 tree 半邊，table 為 UI-local 無 focus 入口。
  - g1：runtime mutator 失敗/重試 browser UI 無 Playwright E2E（僅 vitest jsdom）。
  - holistic critic 於 12:30pm 前撞 session limit，已於重置後重跑。
- 非目標：f1 真驗證 / f5 重試邏輯（各自 follow-up issue）；完整 M4 real-Kit embedded readiness。
