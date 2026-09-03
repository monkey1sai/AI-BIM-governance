# 3D 工作區：中央內嵌 WebRTC viewport ＋ 右側工具 Dock — 實作規劃

Lane G · branch `feat/workspace-viewport-host` · base `origin/main df056b6`
執行的是 `introduce-viewer-app-integration-surface` 的 **S3a（ViewportHost V-A′）＋ S3b（手動啟動／lease UI）**，
並補正本 §03 標為「未做」的那一行：`#/workspace` ＝ 左 Stage 樹 · 中 WebRTC viewport · 右工具 Dock。

## 0. 根因（2026-09-03 實測，canonical-linux `8ba517f`）

| 層 | 實況 | 結論 |
|---|---|---|
| GPU / Kit | RTX 5080；Kit PID 876722 於 49100/49110 listening | 硬體與 runtime 正常 |
| viewer origin | `:5173` 有服務；`VIEWER_PUBLIC_BASE_URL` 正確 | iframe 掛得起 |
| `GET /api/kit/instances/current` | 200 `kit_local_001 idle` | pane 的「啟動 3D Session」鈕**可按** |
| `GET /api/runtime/status` | 無 `gpu` 欄位 | 頂列「GPU 未取得」＝unavailable 顯示，**非錯誤** |
| 前端 IA | `WorkspacePage` 是分頁路由；viewer 藏在各模組 Panel 內、480px、手動選 session 才掛 | **看不到串流的唯一原因** |
| `EdgeConsole` | `<WorkspacePage key={page}>` | 切 dock 整頁重建 → lease 釋放、iframe 重載 |

## 1. 版面（依正本 IA；token 一律 `--ab-*`，不引入新調色盤／字型）

```
┌ tabs: A1 治理檢核 · A2 版本差異 · A3 Federation · A4 語意查詢 · Issues/BCF ─── Coordinator :8004 · Kit primary WebRTC ┐
├────────────┬────────────────────────────────────────────────┬──────────────────────────────────────────────┤
│ Stage 樹   │                                                │ ① 操作流程（依當前 dock，狀態燈由 live 證據驅動）│
│ (roadmap   │        WebRTC viewport（ViewportHost）          │   ○ 選 session → ○ 啟動 3D → ○ first frame     │
│  #609，    │        live-only：coordinator 離線 ＝ 零 DOM     │   → ○ 高亮/疊加 → ○ 交付                        │
│  誠實停用) │        內容物＝ReviewSessionViewerPane（重用，   │ ② 模組面板（既有 A1/A2/A3/A4/Issues 頁原樣，     │
│            │        12 態錨點不新造第二套）                    │    只是搬到右欄、可捲動）                        │
│            │        切 dock 不 unmount、同 session 不重 claim │                                                │
└────────────┴────────────────────────────────────────────────┴──────────────────────────────────────────────┘
```

- **中欄**：`WorkspacePage` 用 `useViewportSlot().registerSlot(el)` 註冊矩形；`WorkspaceViewportHost` 掛在
  `UnifiedShell` `page-root` 的 absolute 兄弟層，ResizeObserver 同步位置。`data-uc="viewport" data-prov="asbuilt"`
  （既有 e2e 只禁 `data-prov="demo"` 的 viewport）。離線 `return null`＝零新 DOM → design gate 的 503 stub 下**不出現
  iframe／video**（manifest `live_surface_policy: capture_fails_if_present` 安全）。
- **右欄 Dock**：上方 `WorkspaceFlowGuide`（5 步導引，狀態只由 live 證據推導：shared session、pane 的 gate reason），
  下方就是原本的模組頁（零改動其內容），寬 `minmax(380px, 34%)`，內部捲動。
- **左欄 Stage 樹**：協定缺口（vg01 無 tree，#609）→ 依 spec「宿主不支援之能力誠實停用」以 disabled＋Roadmap 標示，
  不放假資料。
- **工具列 ⬒✥◫⟲**：#605 結構性封鎖 → 不做假按鈕。

## 2. 共用 session（切 dock 不重 claim 的前提）

`ViewportSlotContext` 持有 `activeSessionId`；模組頁把自己的 handoff `publish()` 到 context，host 以
`activeSessionId ?? handoff.sessionId` 掛 pane。pane 的 lease 只在 `handoff.sessionId` 變動時重置（pane 既有 effect），
所以四個 dock 共用同一 session 時 lease／first frame 跨 dock 存活。模組頁在 workspace 內**不再各自掛** pane
（避免雙重 claim）；在 legacy 深連結（`#version-diff`、`#a1-workbench`）context 缺席時維持原樣 inline。

## 3. UX 規則對照（ui-ux-pro-max，只取結構／互動規則；視覺 token 沿用 repo pinned 系統）

| 規則 | 落點 |
|---|---|
| primary-action（每屏一個主 CTA） | 「啟動 3D Session」是 viewport 內唯一 primary；dock 內其餘為次級 |
| multi-step-progress | FlowGuide 5 步＋`aria-current="step"`；每步附「為何未完成」的誠實理由 |
| progressive-disclosure | 未選 session 前只顯示步驟①與提示，不攤開整段 runtime evidence |
| empty-states / error-recovery | viewport 空態＝說明＋下一步；12 個失敗態沿用 pane 既有 `role="alert"` 錨點與重試鈕 |
| disabled-states（附原因） | Stage 樹／工具列 disabled 附 issue 編號；pane 既有 caption 機制不動 |
| nav-state-active | dock tab `data-active`、側欄 `nav-ws`／`app-*` 既有契約不變 |
| loading-states | pane 既有「啟動中…」「等待第一幀」；host 不另造 spinner |
| no-emoji-icons | 新元件不用 emoji；既有 ⬒▣◧ 字形屬 pinned 原型，範圍外 |
| reduced-motion | 新元件無動畫；`prefers-reduced-motion` 不受影響 |
| contrast | 全部走 `--ab-*` token，AA 由既有 baseline 保證 |

## 4. 切片與驗證

| 片 | 內容 | 驗證 |
|---|---|---|
| P1 | `viewportSlot.tsx`（context/provider）、`WorkspaceViewportHost.tsx`、`WorkspaceFlowGuide.tsx` | vitest：離線零 DOM、live 掛 pane、page 切走 unmount |
| P2 | `WorkspacePage` 三欄；`UnifiedShell` 掛 host；`EdgeConsole` 去 `key={page}`、加 `#workspace?dock=` alias | 既有 `unifiedLiveWorkspace.test`、`dockLiveLink.test`、e2e `unified-a1-a4-live-workspace.spec` |
| P3 | A1/A2/A3/A4 改為 `publish()`（context 在）／inline（context 缺） | 各頁既有 vitest；A2 批次 ack 經 host ref 透傳 |
| P4 | design baseline：重錄 `workspace.a1..a4.default` 兩解析度、manifest sha256＋approval | `npm run test:visual:design-system` |
| P5 | openspec：`introduce-viewer-app-integration-surface` deferred→active（**需 owner 明確口令**，NOW.md R2）、勾 S3a/S3b、ledger | `verify-openspec-repository-lifecycle.mjs` |
| P6 | 181 真 runtime 證據：`#a1` 選 `review_session_734f8e675d73` → 啟動 → first frame／stage／DataChannel → 截圖＋trace | Playwright 對 181（唯讀 API，僅 claim lease） |

GitNexus upstream impact（改動前）：`WorkspacePage` LOW(2)、`ReviewSessionViewerPane` LOW(6)、`EmbeddedViewer` LOW(6)、
`A1GovernanceWorkbenchPage`/`A4SemanticSearchPage`/`VersionDiffPage`/`FederationPage` 各 LOW(2–3)。無 HIGH/CRITICAL。

## 5. 不做／已知缺口

- Stage 樹真實資料（#609）、工具列真行為（#605）、Kit 多色高亮（#603）— 前置為協定演進，超出本片。
- A4 是否需內嵌 3D 屬 owner 裁決（#607 三前提）；本片 A4 走與 A1 相同的 publish 路徑，但 A4 頁既有
  `table-only` 邊界不動。
- 視覺 baseline 的 `approval` 文字需 owner 核准字樣；PR 內先標 pending。
