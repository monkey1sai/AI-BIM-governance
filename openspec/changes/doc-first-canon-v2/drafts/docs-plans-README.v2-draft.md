# docs/plans 入口（docs-plans-README）

> v5 · 2026-07-15 · 設計與規格正本＝`AI-BIM 前後端設計文件.dc.html`（使用者指示整批替換舊七檔體系）

## §0 一句話定位

本目錄存放本 repo 的設計與規格正本：`AI-BIM 前後端設計文件.dc.html`（§01–§08，v1 2026-07-14，對齊 repo 實碼與 tests/contracts）。舊 TRUTH／TARGET-*／BACKLOG／PROCESS 七檔體系與 SaaS 六檔已於 2026-07-15 依使用者指示整批移除；原文見 git history（去向表見本檔 §4）。

## §1 檔案清單與角色

| 檔 | 角色 |
|---|---|
| `AI-BIM 前後端設計文件.dc.html` | **設計與規格正本**：§01 服務邊界（B 方案三鐵律）／§02 部署拓撲（Mode C Hybrid）／§03 前端架構 IA（route map·元件樹·共用 hooks）／§04 API 契約（coordinator·governance·conversion·kit·DataChannel）／§05 時序圖 F1·F2／§06 資料模型／§07 實作分期 CH-0～CH-G／§08 AI Coding 交付守則（權威順序·R1–R4·Task 0–12） |
| `AI-BIM Console Hi-Fi.dc.html` | Console 高保真互動原型設計稿（6 screens：shell／總覽 Home／3D 工作區 Workspace／模型資料與轉檔 Pipeline／Runtime·Kit·GPU Ops／Concept Preview） |
| `support.js` | 兩份 `.dc.html` 的 render runtime（generated；執行時自 unpkg 載入 React 18／Babel standalone） |
| `assets/`、`uploads/` | Hi-Fi 原型的 viewport 背景圖與 A5–A10 概念稿原圖 |
| `ai-bim-geo-viewer-A1..A10.png` | 10 張應用場景圖＝設計文件 §08 三層輸入之 Visual Requirement（只當視覺上下文） |
| `ai-bim-geo-Ai-codeing-A1..A10.png` | 10 張 AI Coding Prompt Board＝§08 之 Implementation Intent（其中 API 多為「建議」，非現有契約） |
| `design-system-reference.manifest.json`＋`design-system-baseline/` | CI design fidelity gate 的 tracked machine snapshot（本輪不動；支援 artifacts，非需求正本） |
<!-- canon:r-file-table -->

檢視方式：`.dc.html` 開啟需連網（React CDN）；上游 authoring origin＝唯讀 `C:\Repos\design\desigin-system`（該處另有同內容之零依賴靜態版 `design-doc.html` 與可操作的 console 實作）。上游不得由本 repo 回寫，CI 亦不得依賴該絕對路徑。

## §2 讀取路線

| 情境 | 讀什麼 |
|---|---|
| 第一次進 repo | 本檔 → 設計文件 §01（服務邊界＋鐵律 1–3） |
| 動任何 code 前 | §04 API 契約（Payload 以 `tests/contracts/*.json` 為最高標準）＋ §08 權威順序與 R1–R4 |
| 做前端／console 任務 | §03 前端架構 IA → §07 對應 CH 期 → Hi-Fi 原型比對 → `design-system-reference.manifest.json` visual gate |
| 查 3D／runtime 互動 | §04 Kit DataChannel 訊息協定 ＋ §05 時序 F1（intake→轉檔→session→串流）／F2（檢核→疊加→Issue→BCF→回拋） |
| 排工作順序、找下一件事 | §07 實作分期（每期一 PR；done＝Playwright browser E2E 證據）＋ §08 Task 0–12 |
| 查「X 建了沒」（現況） | repo code＋tests 直接查證（本目錄不再維護建成帳本） |

## §3 效力

1. **使用者最新明確指令 > 本目錄一切文件。** <!-- canon:r-user-instruction-supremacy -->
2. **權威順序**（設計文件 §08，衝突由上而下裁決）：既有 repo 程式碼與測試 > AGENTS.md 與 OpenSpec > 既有 API client 與後端契約（tests/contracts） > 書面 A1–A10 需求 > Prompt Board 文字 > 應用場景圖 > 圖中示例數字（僅 fixture）。 <!-- canon:r-authority-order -->
3. **四條鐵律**（§08）：R1 技術棧權威（React+TypeScript+Vite；沿用 EdgeConsole 與 `--ec-*` token 單一真相源；禁 Vue/Pinia/第二套 SPA/theme）；R2 API 三態（existing→直接整合、planned→typed adapter+mock、missing→NOT_BUILT，絕不臆造 production 後端）；R3 Provenance 誠實（示意數字一律 fixture，面板掛 ProvenanceTag(mock|live)，未接通 action 誠實停用，不做假成功）；R4 一個 outcome 一個 task（outcome＋constraints＋DoD）。 <!-- canon:r-four-iron-rules -->
4. **後端凍結面**（自舊 TARGET-contracts §1 承繼，效力不變）：前端只打 coordinator `:8004`；proxy 路徑 byte-identical；禁改 governance `app.py`、coordinator `governanceProxy.ts`、streaming `conversion_authority.py`；瀏覽器禁直連 `:49101`／`:49102`／`:8010`。 <!-- canon:r-backend-freeze -->
5. **現況行為權威＝code＋tests**；設計文件＝目標權威；兩者落差＝implementation gap，不得以文件宣稱 runtime 已完成。 <!-- canon:r-runtime-authority -->

## §4 舊檔去向（斷鏈救援）

舊七檔（docs-plans-README v4、TRUTH、TARGET-contracts、TARGET-shell、TARGET-viewer、BACKLOG、PROCESS）、SaaS 六檔（`ai-bim-governance-saas-*`）、審批報告×4、兩份 legacy prototype html 與 `nvidia-cosmos-diagram.jpg` 已於 2026-07-15 整批移除；原文一律見 git history。歷史文件或舊 PR 引用到舊檔時依下表改讀去向：

| 舊檔 | 去向 |
|---|---|
| `TRUTH.md`（建成狀態帳本） | repo code＋tests 直接查證 |
| `TARGET-contracts.md`（凍結契約·22 條正典路由·enum） | 設計文件 §04 API 契約＋§01 鐵律 1–3＋§03 Route Map（含舊路由收斂 CH-G）；Payload 以 `tests/contracts/*.json` 為準；後端凍結面見本檔 §3.4 |
| `TARGET-shell.md`／`TARGET-viewer.md`（頁面與 viewer 規格） | 設計文件 §03 前端架構＋§06 資料模型＋§05 時序＋Hi-Fi 原型 |
| `BACKLOG.md`（缺口佇列·OPEN 決策） | 設計文件 §07 實作分期＋§08 Task 0–12 |
| `PROCESS.md`（工程紀律·DoD） | 設計文件 §07「done＝契約測試綠＋Playwright E2E 截圖證據」＋§08 R1–R4；design fidelity dual-gate 仍由 manifest／baseline CI gate 機制執行 |
| `ai-bim-governance-prototype.html`／`ai-bim-geo-viewer-prototype.html` | `AI-BIM Console Hi-Fi.dc.html` |
| `ai-bim-governance-saas-*` 六檔／`審批報告-*`×4／`nvidia-cosmos-diagram.jpg` | git history（無現行效力） |
<!-- canon:r-legacy-file-mapping -->
