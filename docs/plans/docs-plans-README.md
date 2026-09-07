# docs/plans 入口（docs-plans-README）

> v7 · 2026-09-07 · 設計與規格正本＝`AI-BIM 前後端設計文件.dc.html`；§07 採納階段 0–5、A1 → A2 → A3 → A4 閉環交付順序。文件性質：需求與設計入口，非 runtime 完成證據。

## §0 一句話定位

本目錄存放本 repo 的設計與規格正本：`AI-BIM 前後端設計文件.dc.html`（§01–§08，v1 2026-07-14，對齊 repo 實碼與 tests/contracts）。舊 TRUTH／TARGET-*／BACKLOG／PROCESS 七檔體系與 SaaS 六檔已於 2026-07-15 依使用者指示整批移除；原文見 git history（去向表見本檔 §4）。

## §1 檔案清單與角色

| 檔 | 角色 |
|---|---|
| `AI-BIM 前後端設計文件.dc.html` | **設計與規格正本**：§01 服務邊界（B 方案三鐵律）／§02 部署拓撲（Mode C Hybrid）／§03 前端架構 IA（route map·元件樹·共用 hooks）／§04 API 契約（coordinator·governance·conversion·kit·DataChannel）／§05 時序圖 F1·F2／§06 資料模型／§07 實作分期 CH-0～CH-G／§08 AI Coding 交付守則（權威順序·R1–R4·Task 0–12） |
| `AI-BIM Console Hi-Fi.dc.html` | Console 高保真互動原型設計稿（6 screens：shell／總覽 Home／3D 工作區 Workspace／模型資料與轉檔 Pipeline／Runtime·Kit·GPU Ops／Concept Preview） |
| `ai-bim-governance.css` | design token 權威（`--ab-*`）：上游 design 系統之 production 投影＋`EdgeConsole.tsx` 真實 import 的雙重身分；手寫正本面，變更控制見 `design-canon-change-control` |
| `support.js` | 兩份 `.dc.html` 的 render runtime（generated；執行時自 unpkg 載入 React 18／Babel standalone） |
| `assets/`、`uploads/` | Hi-Fi 原型的 viewport 背景圖與 A5–A10 概念稿原圖 |
| `ai-bim-geo-viewer-A1..A10.png` | 10 張應用場景圖＝設計文件 §08 三層輸入之 Visual Requirement（只當視覺上下文） |
| `ai-bim-geo-Ai-codeing-A1..A10.png` | 10 張 AI Coding Prompt Board＝§08 之 Implementation Intent（其中 API 多為「建議」，非現有契約） |
| `ai-bim-a1-workflow-reference.png`～`ai-bim-a4-workflow-reference.png` | A1–A4 前端功能與操作流程解說圖（2026-09-07 生成、使用者指定納入）；coding agent 輔助參考，使用限制見下方「流程圖讀法」 |
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
| 排工作順序、找下一件事 | **先讀 `NOW.md` 的當前 outcome** → [設計正本 §07 階段 0–5](<AI-BIM 前後端設計文件.dc.html#delivery-sequence>)：凍結操作契約 → A1 所需基礎能力 → A1 → A2 → A3 → A4 閉環；CH 與 §08 Task 0–12 僅作既有工程範圍對照 |
| 查「X 建了沒」（現況） | repo code＋tests 直接查證（本目錄不再維護建成帳本） |

### A1–A4 流程圖讀法（coding agent）

先讀設計正本 §07 的階段 0–5 與對應 §04 API／§05 時序，再用下圖理解功能目的、操作順序、資料與 3D 的關係；實作前將流程轉成可驗收的文字契約。這些圖是解說參考，不是新增需求、API 契約或 pixel golden，也不取代 Hi-Fi／CSS 的正式視覺與互動設計。

| 圖片 | 前端功能與操作重點 |
|---|---|
| [A1 治理檢核](ai-bim-a1-workflow-reference.png) | 選模型 → 選規則 → 檢核 → 失敗項目與定位 → Issue／BCF；整改重檢與關閉的完整流程仍須依 §07 階段 0 定義 |
| [A2 版本差異](ai-bim-a2-workflow-reference.png) | 選兩版 → 差異清單 → 三色疊加／定位 → Issue；正確綁定基準與比較版本 |
| [A3 跨專業模型整合](ai-bim-a3-workflow-reference.png) | 選成員與順序 → 座標／單位驗證 → 整合 Stage → Review Room |
| [A4 語意查詢與證據](ai-bim-a4-workflow-reference.png) | 選範圍 → 查詢 → 構件屬性與來源 → 3D 定位；搜尋不等於合規判定 |

**使用限制：** 圖片由 imagegen 生成，介面、規則、檔名、GUID、版本、數字與成功狀態均為示意，未經部署驗收。圖內服務分工是簡化解說；以設計正本的服務邊界與文字契約裁決，現況以 source＋tests 查證。A2 圖中的「上傳」不授權新增上傳入口；缺失／移除構件的呈現不得假設目前 Stage 一定含有該構件。圖片與文字不一致時須記錄差異，不得依圖臆造 API、擴大功能或宣稱閉環完成。

## §3 效力

文件分工與逐階段通過條件統一引用設計正本 §07：正本定義功能／契約／操作與驗收；Hi-Fi 承載對應畫面狀態；README 導覽；NOW 排當前 outcome；OpenSpec 承載切片變更。code、tests 與真實 runtime／browser evidence 才能確認完成。採納新順序不等於已完成階段 0，也不會自行啟動或 thaw 其他 OpenSpec。

1. **使用者最新明確指令 > 本目錄一切文件。** <!-- canon:r-user-instruction-supremacy -->
2. **權威順序**（設計文件 §08，衝突由上而下裁決）：docs/plans 需求正本（設計文件 §01–§08；前端視覺／互動面＝Hi-Fi＋ai-bim-governance.css 最高，依領域分工） > tests/contracts/*.json（payload 委任，§04 保留） > AGENTS.md 與 OpenSpec（治理程序） > Prompt Board 文字（僅意圖參考） > 應用場景圖（僅視覺上下文） > 圖中示例數字（僅 fixture）。 <!-- canon:r-authority-order -->
3. **四條鐵律**（§08）：R1 技術棧權威（React+TypeScript+Vite；沿用 EdgeConsole 入口殼；design token 單一真相源＝docs/plans/ai-bim-governance.css（`--ab-*`，production 真實 import）；`--ec-*` token 已退役（`.ec-*` class 命名空間保留於 legacy-console.css）；禁 Vue/Pinia/第二套 SPA/theme）；R2 API 三態（existing→直接整合、in-canon+repo 內可建→後端+前端一次建到位(預設不做 mock 過渡)、in-canon+依賴外接引擎→才准 mock(掛 ProvTag 誠實標示)、missing→NOT_BUILT，絕不臆造 production 後端）；R3 Provenance 誠實（示意數字一律 fixture 並以 `data-prov` 標示，面板掛 `ProvTag`(7 值 `Prov` 誠實分類)，未接通 action 誠實停用並標 Concept Preview / Roadmap，不做假成功）；R4 一個 outcome 一個 task（outcome＋constraints＋DoD）。 <!-- canon:r-four-iron-rules -->
4. **後端凍結面**（自舊 TARGET-contracts §1 承繼，效力不變）：前端只打 coordinator `:8004`；proxy 路徑 byte-identical；禁改 governance `app.py`、coordinator `governanceProxy.ts`、streaming `conversion_authority.py`；瀏覽器禁直連 `:49101`／`:49102`／`:8010`。 <!-- canon:r-backend-freeze -->
5. **需求權威＝本目錄設計正本（doc-first）**；code＋tests＝runtime 現況查證面；code 偏離正本＝implementation gap，列入 gap ledger 排修；不得以文件宣稱 runtime 已完成。 <!-- canon:r-runtime-authority -->

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
