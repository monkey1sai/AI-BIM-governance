# Tasks — c-m4-runtime-command-bridge

對應 plan `docs/superpowers/plans/2026-07-03-c-m4-runtime-command-bridge.md`（7 task）。狀態以 branch commit 為準（本 repo「狀態以 commit/state 檔為準」慣例，plan checkbox 不回勾）。

- [x] Task1 Lock C Viewer IA Layout Contract（commit task#0：C 區塊 5 test id 斷言）
- [x] Task2 Align MockViewport IA（grid layout CSS + 3×3 grid）
- [x] Task3 分離 UI-local 選取與 runtime mutator 送出路徑（含 spec/quality gap 修復系列）
- [x] Task4 Preserve Coordinator Boundary（未新增 generic operations endpoint；補 committed 回歸測試 `no-generic-operations-endpoint.test.ts` 關閉 P5 f4）
- [x] Task5 Add Kit-Side Runtime Mutator Authorization（`runtime_authority.py` + 8 handler 守衛 + pytest；defense-in-depth 形狀檢查，真偽驗證見 follow-up #307）
- [x] Task6 Three-Layer Verification Gate（Layer1/2 綠；Layer3 真實 IFC 補收 3 specs 綠）
- [x] Task7 Final Detect Changes And Review（final-report.md；P5 對抗複驗處置：f2/f4 閉合、f1/f3/f5/g1 揭露）

## Follow-up（本 change 範圍外，另立 issue）

- [x] #307 / #308 — **2026-07-21 archive 裁決**：Task1–7 為本 change done；#307 Kit mutator lease 真偽、#308 embedded primary lease 晚到重試 維持獨立 issue，不擋 archive。
