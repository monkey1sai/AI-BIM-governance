# A1–A3 對齊 Design System 指引 — 補強設計（第一階段）

> 日期：2026-06-23
> 基準：`C:/Users/IOT/Downloads/AI-BIM Governance Design System`（EZPLUS BIM 設計系統，本專案反向工程而來）的 `guides/`（a1-a10-customer-scenarios、frontend-interaction-and-design、ai-bim-geo-web-server、persistence）。
> 方法：ultracode 三線並行規劃（A1/A2/A3 各 planner → 對抗 critic），指揮官審查 + 使用者拍板範圍後凝固本 doc。
> 後續：本 doc 為三線並行實作的 source of truth；走 branch → PR → Actions → merge，不在 main 開發。

---

## 0. 目標與非目標

**目標**：拿 Design System 指引當標準，把本專案 A1/A2/A3 補到「更完整」，全程維持既有誠實鐵律（provenance tag、不捏造數字/假綠燈）與 user-facing browser E2E evidence。

**非目標（本輪明確不做）**：
- A3 需 GPU + WebRTC DataChannel 的能力（點 clash 飛到 3D 框選兩構件、即時 layer toggle、camera fly）→ Phase 2。
- A2 規格未要求的體驗增強（依類別篩選、persistence、cost-impact 標示）→ 使用者已拍板「只做站得住的」，本輪不做。
- BCF 3.0 升級、change report 匯出器、git-blame 式責任帳本、i18n 框架。

---

## 1. 審查軌跡：一筆誠實更正

第一輪粗稽核曾宣稱「A2『成本影響』區塊缺 ProvTag、違反誠實鐵律」。第二輪深查（plan + critic 實查 codebase 與 spec）**推翻此說**：

- A2（VersionDiffPage）**沒有**任何 cost-impact / 成本功能；A2 spec（設計規格、開發軌跡、互動實作規格）grep「成本/cost」對 A2 = 0 命中。「右側 Copilot 問成本」概念屬 **A9**，非 A2。
- A2 現有的是 **DiffIssueImpact**（issue 計數卡：possibly_addressed / still_open / new），為真實後端資料、渲染在 `prov="asbuilt"` Panel 下，標記正確。
- 結論：**A2 無此誠實破口**。spec 從未要求的能力，不做不算違規。此更正記錄在案，作為雙層 review 互補的實例。

---

## 2. 三線收斂範圍總表

| 線 | critic 裁示 | 第一階段範圍 | 工時粗估 | GPU |
|---|---|---|---|---|
| A1 | sound | BCF 鈕 + 記分板色碼（PR1）/ 失敗構件整批·逐列 3D 高亮（PR2） | PR1 ~1天、PR2 1-2天 | PR2 取證需 |
| A2 | 瘦身後 sound | 變更清單三色碼 + 修 ifc_type 落庫 bug | ~1-1.5天 | 否 |
| A3 | needs_revision（已納入修正） | 真實 clash 清單 + 誠實呈現 + clash→Issue（5 件純加法縱切） | 5-7 工作天 | 否（Phase 1） |

---

## 3. A1 · 治理與模型檢核（route `#a1`）

**canonical 決策**：本專案存在兩個 A1 介面 —— 新的 `A1GovernanceWorkbenchPage`（`#a1`，缺 BCF 鈕）與 legacy `IssuesRuleCenterPage`（`#issues`，已有可運作 BCF/Excel）。本輪宣告 **`#a1` 為 canonical A1 route**，`#issues` 標 legacy（後續退役），避免兩頁 divergent 長期並存。此決策寫入 PR 描述與 cross_cutting，不只當「清理項」。

### PR1（純前端、CI 可驗、不依賴 Kit GPU）
- **A1-W1 BCF 2.1 匯出鈕**：A1「交付」Panel 新增「匯出 BCF 2.1」鈕，重用既有 `governanceClient.bcfExportUrl()`（`pages.tsx:1528` Issues 頁同款）與既有下載慣例。gating 與「失敗構件建 Issue」連動：step ∈ {issued,delivered} 才 enable，未建 Issue 前 disabled + caption「需先建 Issue」；後端 404 走 `actionErr` 誠實顯示。鈕標 `prov=asbuilt`。
- **A1-W4 記分板 / stepper 色碼**：記分板四格依語意著色（passed 綠、failed>0 紅、score 依門檻 100綠/<100琥珀/低於門檻紅，用既有 Metric tone，必要時加 `good` tone）；確認 LifecycleStrip done/active/future 有可見綠/灰。色碼**只呈現既有真實數字、零數值改動**；缺值顯「未取得」。
  - 風險：ec-metric/ec-flow-step 的 CSS 實際檔路徑待定位後再改，避免「改了沒效」。
- **驗收**：`#a1` 跑 fixture rule-run → 建 Issue → BCF 鈕 disabled→enabled → 點擊下載（驗 200 + Content-Disposition .bcfzip）；記分板紅/綠/門檻色 + stepper 色截圖。落 `docs/evidence/` / `artifacts/e2e/`。

### PR2（需在有 Kit GPU 的部署區取證）
- **A1-W2 失敗構件整批 / 逐列 3D 高亮**：FailureRuleRow 每列加「在 3D 標示」鈕（有 `usd_prim_path` 才 enable，否則 disabled + tooltip「未對映 USD」）；加「整批標示（已載 N 筆）」鈕，把已懶載 rows 中有 prim path 的 GUID 組 `HighlightItem[]` 一次 `sendHighlight`。
  - **critic 修訂（必納）**：
    1. 整批高亮需 **aggregate 多筆 `highlight_result`**（viewer 對每 item 各 post 一個回應；現況 console 端 `onHighlightResult` 是單值 last-wins，會被最後一筆覆蓋）→ 顯示「成功 X / 未對映 Y / 失敗 Z」。
    2. FailureRuleRow 改為**吃頂層傳入的「已 enrich + 已 gating」資料與 viewerRef**（而非自己 fetch 一份未 enrich 的），確保切 session 失效路徑與既有「第一筆」鈕共用同一 `selectedSession` 來源（守 `pages.tsx:438-444` 既有防跨 session 誤標陷阱）。
  - 把 `e2e/viewer-embed-a1-highlight.spec.ts:177` 的 `test.fixme`（列級高亮鈕）轉真 test。
  - 維持 VG-01 既有四條件 enable（firstFrame ∧ selectedSession ∧ stageMatched ∧ usd_prim_path）；高亮成敗以 viewer `highlight_result` 為準（證據型），禁樂觀。
- **驗收**：建 session → first_frame 綠 + stage matched → 跑含 IFCCOLUMN rule-run → 展開失敗 rule →（a）逐列鈕點已對映構件→「已在 3D 標示」+ iframe 截圖；（b）整批鈕→多構件標紅 + aggregate 狀態；（c）未對映列鈕 disabled。三張截圖。前置：conversion authority(:49101) succeeded + branch coordinator(:8005) + build:ui + host-native Kit。

### blast radius 註記
GitNexus impact 對 `A1GovernanceWorkbenchPage` / `FailureRuleRow` 回 LOW/exact/0 caller 是**結構性假陰性**（JSX page 元件走 React render 非 symbol call edge）。真實 blast = EdgeConsole router(1 render) + `console.test.tsx` + `A1ViewerEmbed.test.tsx`。**改 A1 頁務必同步跑這兩個測試**，別只信 GitNexus 的 0。W2 改 FailureScoreboard/FailureRuleRow 簽章對 `console.test.tsx` 是 d=1 WILL BREAK，須一併更新。

---

## 4. A2 · 版本差異與責任（route `#a2`）— 只做站得住的

**使用者拍板**：只做標準明確要求的部分。砍掉原 plan 的 W3（類別篩選，spec 0 命中）、W4（cost-impact 標示，spec 無此能力）、W5（persistence，「橫向標準」實查不存在）、W6（雙語，後續）。

- **A2-W1 變更清單三色碼**：中間變更清單每列依 `change_type` 上色（added→綠、removed→紅、moved/property_changed/geometry_changed→黃），三色語義集中成單一 `CHANGE_TONE` map；計數卡同步補 tone。複用既有 CSS 變數 `--ec-grn/--ec-amb/--ec-red`，新增 `.ec-diff-add/.ec-diff-mod/.ec-diff-del`。**色碼必配文字**（色點旁保留 change_type 文字，色盲可及）。Panel 維持 `prov=asbuilt`（對既有真資料的視覺增強，不新增 demo/假資料）。
  - spec 依據：設計規格 §差異列「綠加/黃改/紅刪」+ 開發軌跡 A2 驗收「比對出三色清單」（Must-tier）。
- **A2-W2 修 ifc_type/ifc_name 落庫 bug**（**去掉「為類別篩選」framing，定位為修後端資料丟失 bug**）：`engine.py` 每個 DiffItem 都產 `ifc_type/ifc_name`，但 `store.py` INSERT 從沒存 → 前端型別欄與 `issues_from_diff` 的 issue 標題（`diff {change_type}: {ifc_type}`）都是空字串。
  - `store.py`：`model_diff_items` schema 加 `ifc_type TEXT / ifc_name TEXT`；`complete_diff` INSERT 帶入；**migration 掛在 `DiffStore.__init__`**（lazy 建立必過），用 `PRAGMA table_info` 守衛冪等，舊列 `ifc_type` 留 NULL（前端誠實顯「—」，不回填假值）。
  - **不做** `?ifc_type=` 篩選端點（那是被砍的 W3 的後端延伸）。
  - 驗收：`pytest tests/test_diff_engine.py` 綠（含新 store round-trip ifc_type 斷言 + 「對既有無欄 db 開 store 自動補欄、舊列讀回 None」冪等回歸測試）；跑真 diff 後 `issues_from_diff` 的 issue 標題不再空 ifc_type。
  - blast：`get_items` 三個 caller（`issues_from_rule_run` 無關；`get_diff_items`/`diff_issue_impact` 相關）皆用 `.get()` 容忍新欄位，additive 安全。GitNexus 漏報為 1 caller，已用 codebase-memory trace_path 交叉確認 3 caller（雙圖譜紀律）。

**A2 第一階段建議單一 PR**（W1 + W2）。E2E 前置紀律：`a2-version-diff-selector.spec.ts` 服務 coordinator build:ui 後的 dist-ui，須先 `npm run build:ui` + 重啟 coordinator + `BIM_FILE_LIBRARY_ROOT` 指含 270 的主 worktree storage，否則 conditional skip 假綠。

---

## 5. A3 · 跨專業疊合 / clash 碰撞檢測（route `#a3`）

**定位決策（critic medium 必納）**：Design System 標準把 clash 算進 A3；但本專案 `GovernanceOverlay.tsx:84` 內部標示把「碰撞/空間干涉」掛 **A5（prov=p3 願景）**、A3 標「規則庫/IDS」。本輪 clash 實作放 `#a3` FederationPage（對齊 Design System），**同步更新 GovernanceOverlay 的 A5 條目註記**，避免 overlay 與實頁對「碰撞屬哪個 app / 什麼狀態」自相矛盾。

**核心依賴事實（已實證）**：`ifcclash` 套件**未安裝**，但其底層引擎 `ifcopenshell.geom.tree.clash_intersection_many` 在 host-native ifcopenshell 0.8.5 **可用**（dir() 確認有 clash_intersection_many/clash_collision_many/clash_clearance_many）→ **零新生產依賴**，用 native tree API，不引入 ifcclash/bonsai。

### 第一階段（5 件純加法縱切，不需 GPU）
- **A3-CLASH-1 後端 clash 引擎 `federation/clash.py`**
  - **task0（先吃掉 UNKNOWN，critic 必納）**：clash 物件精確欄位名（`.a/.b/.distance/.clash_type`）仍 UNKNOWN（現有 storage 真檔自我 clash 回 0 筆、大檔 timeout，兩條路都撞牆）→ 先做一個**最小可重疊的合成 IfcWall/IfcBeam fixture**，在 host python dump clash 物件屬性確認真名，再定 severity/GUID 抽取邏輯。
  - `run_clash(discipline_ifc_paths, tolerance) -> clash list`：用 `geom.tree()` + `add_file` + `clash_intersection_many` 對 discipline pair 跑碰撞；每筆抽兩個 GlobalId/type/name/penetration；severity 由穿透深度門檻分級（**門檻是工程預設值，docstring 須誠實標明非法規值**）。
  - effort：**2-3 天**（含 fixture + spike，自原 1-2 天上修）。
- **A3-CLASH-2 clash REST 端點 + 持久化**
  - `POST /api/federated-sets/{set_id}/clash`（吃顯式 IFC 路徑入參，**不從 usd_path 反推 IFC** 以免捏造對映）、`GET .../clash/{run_id}`（後端 ORDER BY severity）；`FederationStore` 加 `clash_runs / clash_results` 兩表。
  - **size/timeout guard（critic high 必納）**：實測許良宇 89MB 光 `tree.add_file` 就 >60-90s、自我 clash 撞 2 分鐘 timeout，FastAPI 同步端點會卡死 worker。第一階段**雙重防護**：(a) 端點加 products 數/檔案大小上限，超過回 413/422 誠實拒絕並標明「大模型需 Phase 2 背景佇列」；(b) browser E2E 用實測 `add_file<10s` 的中小型真檔（如松風庵 70KB）。撤下原 scope_out 的「同步即可」。
- **A3-CLASH-3 clash → Issue `issues_from_clashes`**（鏡像 from-rule-run）
  - `POST /api/issues/from-clash/{run_id}`：讀 clash_results → 組 items → 呼叫既有 `create_issues_batch`（不改簽章）；`source_type='clash_result'`；主鍵取 a 或 b GlobalId，**另一個 GlobalId 寫進 description**。去重沿用 (source_type, source_ref) 唯一鍵。
  - **acceptance 加斷言（critic low 必納）**：生成的 `issue.description` 含第二個 GlobalId（或對手 type/name），確保雙構件資訊不被靜默丟棄。綁真 GUID 的 issue 自動流入既有 BCF 匯出（BCF 只帶主 GUID viewpoint，PR 須註明此語意取捨）。
- **A3-CLASH-4 coordinator proxy 透傳**：`governanceProxy.ts` 是逐路由 allowlist，三個新端點各加一條 forward。**需 rebuild coordinator**（docker compose build coordinator / deploy.ps1）才生效，PR 描述須明示，避免「改了沒效」502。
- **A3-CLASH-5 FederationPage clash 面板**
  - `governanceClient.ts` 加 `runClash/getClashRun/issuesFromClashes` + 型別；FederationPage Build 後新增「跨專業碰撞檢測」Panel（`prov=demo`）：每 discipline IFC 路徑輸入、「跑碰撞（示範）」鈕、severity 排序 clash 清單（high 紅/medium 黃/low 灰）、每列「轉 Issue」鈕；空清單誠實顯「無碰撞或尚未執行」。
  - **prov 標籤修正（critic high 必納，否則 TS2322 編譯失敗）**：`data.ts` 的 `Prov` 聯集 = `asbuilt|artifact|demo|p1|p15|p3|p4`，**無 `todo`**。所有原 plan 寫 `prov=todo` 的 GPU 依賴能力（3D 框選/相機/即時 toggle）一律改 **`prov=p1`** + disabled（沿用 SemanticViewerPage「在 3D 標示」disabled p1 既有先例）。
  - **ProvLegend 補丁拆開（critic low）**：FederationPage 確實沒掛 `<ProvLegend/>`（components.tsx 有 export），補它**獨立 commit 並標明「順手補圖例，非 clash 範圍」**，不稀釋 clash review。
  - 驗收：`:8004/ui #/a3` browser E2E：填兩個重疊真 IFC（中小型）→ 跑碰撞 → severity 排序清單截圖 → 點「轉 Issue」→ Issue 中心可見帶 clash source 截圖。clash 區塊見 demo 徽章、GPU 能力見 p1 徽章。

### Phase 2（明確不做，UI 以 p1 disabled 佔位）
- **A3-CLASH-6** 點 clash → camera 框住 + 高亮兩構件（GPU/DataChannel highlightPrimsRequest）。
- **A3-CLASH-7** 即時 layer toggle（不重建即時開關 discipline 圖層）。

### blast radius
雙圖譜交叉確認皆 LOW、純加法：`create_issues_batch`（LOW/2 caller，只加第 3 個不改簽章）、`build_federated_usda`（LOW/1 caller）。唯一改既有共用點：`governanceProxy.ts` 加路由（逐路由 allowlist 不影響既有）、`issues/store.py` 的 `source_type` 自由 TEXT 加 `clash_result`（無 CHECK，不破壞既有）。

---

## 6. 跨線共通紀律

1. **誠實鐵律**：每個新 user-facing 區塊掛 ProvTag（合法值僅 `asbuilt|artifact|demo|p1|p15|p3|p4`，**無 todo**）；不捏造數字/作者名/假綠燈；缺資料顯「未取得/—/未提供」。clash engine 整區標 `demo`（驗證前不宣稱真實 clash 數）。
2. **browser E2E evidence**：user-facing 項目 acceptance 必須能從前端 route 操作並有 browser 截圖，backend-only done 不接受。evidence 落 `docs/evidence/` 或 `artifacts/e2e/`。
3. **blast radius**：改 symbol 前跑 GitNexus impact + codebase-memory trace_path 雙圖譜交叉（GitNexus 對 JSX page 元件與部分 caller 有已知假陰性，不可只信單一圖譜）。
4. **流程**：不在 main 開發；三線各自 branch（worktree 隔離避免並行互撞）→ PR → Actions → merge。指揮官審查每線 PR。
5. **rebuild 陷阱**：A2/A3 的前端/coordinator 改動須 `npm run build:ui` + 重啟/重建 coordinator 才生效；E2E 前置不齊會 conditional skip 假綠（skip ≠ PASS）。

---

## 7. PR 切割總覽

| PR | 線 | 內容 | 依賴/取證 |
|---|---|---|---|
| PR-A1-1 | A1 | BCF 鈕 + 記分板色碼 + 宣告 #a1 canonical | CI 可驗（無 GPU） |
| PR-A1-2 | A1 | 失敗構件整批/逐列 3D 高亮 | 部署區 GPU 取證 |
| PR-A2-1 | A2 | 變更清單三色碼 + 修 ifc_type 落庫 bug | build:ui + coordinator 重啟 |
| PR-A3-1 | A3 | clash 引擎 + 端點 + 持久化 + clash→Issue + 前端 panel（5 件縱切） | pytest + coordinator verify + #a3 E2E（中小型 IFC） |

A3 第一階段為 5 件純加法縱切，可單一 PR 交付（5-7 工作天）；若體量過大可再拆「後端 clash 鏈」與「前端 panel」兩 PR。

---

## 8. 交叉對抗驗證審批結果與修正（2026-06-23）

**審批**：9 agent 三視角（implementer/adversary/reconciler，依難度配 haiku/sonnet/opus）交叉對抗驗證。8/8 成功 agent 全部 approve / approve_with_fixes，**0 block**；A3 opus reconciler 純 approve。A2 implementer(haiku) 因 schema retry 失敗 null，其視角由 A1 impl 跨線檢查 + A2 adversary/reconciler(sonnet) 覆蓋。所有關鍵技術宣稱經實機/逐行 **confirmed**。以下為驗證抓到、實作前須納入的修正：

### 實機驗證確認（reconciler）
- ifcopenshell **0.8.5** native `geom.tree()` 有 `clash_intersection_many / clash_collision_many / clash_clearance_many`；`ifcclash`/`bonsai` ModuleNotFoundError → 零新依賴成立。
- 許良宇圖書館_2026.ifc = **89,394,282 bytes**，add_file 跑 150s 未完成；松風庵_建築_v2.ifc = **69,861 bytes**，add_file **0.118s** → size guard 必要、E2E 用小檔正確。
- Prov 聯集 data.ts:6 無 todo；federation members 無 ifc_path；governanceProxy 逐路由 allowlist；create_issues_batch 2 caller、source_type 自由 TEXT。

### A1 修正
- **A1-W4 措辭修正（多 agent 抓到）**：Metric tone 只有 `'warn'|'bad'`，**無 `'good'`**；`ec-metric` base class 已是綠。故 passed/total 用**預設綠（不加 good tone）**、failed 用 `bad`(紅)、score<100 用 `warn`(琥珀)。若堅持加 good 須**同步**擴 tone 聯集 + 新增 `.ec-metric.good` CSS 並斷言色碼有效（否則 class 靜默無效＝假綠）。
- §3 blast radius 措辭：「W2」改明寫「PR2(A1-W2 高亮鈕)」，避免與 A2-W2 混淆。
- A1-W1 acceptance 補**反向斷言**：step=scored 時 BCF 鈕仍 disabled(caption「需先建 Issue」)。
- A1-W2：先確認 viewer `onHighlightResult` callback 簽章(單值 vs array)再設計 aggregate；若複雜則 defer follow-up、PR2 保留單列高亮可動。改 FailureRuleRow 簽章**必同步更新** console.test.tsx(:2082 render) + A1ViewerEmbed.test.tsx(d=1 WILL BREAK，GitNexus 漏看 JSX，手動驗)。

### A2 修正
- A2-W1：items 表 `.slice(0,40)` 截斷未被處理，順手加「顯示前 40 筆，共 N 筆」誠實提示(一行 JSX)，避免誤以為「只有這些」。
- A2-W2 migration：用 `PRAGMA table_info` 守衛（此 repo 首例、無樣板）；`executescript` 不支援參數化，用 execute+fetchall 手動比欄位名；migration 接在 `DiffStore.__init__` 的 `_SCHEMA executescript` **之後**。

### A3 修正
- **task0 重新定位（opus adversary 實讀 `ifcopenshell_wrapper.py:4029-4039`）**：clash 物件欄位名**非 UNKNOWN** = `clash_type(int) / a(IfcBaseClass*) / b(IfcBaseClass*) / distance(double) / p1 / p2`。spike 真正要確認的是「`a/b` 是 IfcBaseClass 指標→怎麼取 GlobalId/is_a()/Name + `distance` 正負號/單位語義來定 severity 門檻」。effort 可下修；task0 **加 timebox(1 工作天)**，超時 escalate。
- **files 補**：`GovernanceOverlay.tsx`（改法：A5 條目 title/caption 加註「碰撞 Phase 1 已在 #a3 FederationPage，A5 為 GPU Phase」，prov=p3 不動）+ `GovernanceOverlay.test.tsx`/`console.test.tsx` 斷言；`governance-service/tests/test_clash.py`(新建)、`test_issues.py`(補 from-clash **第二 GUID 寫進 description** 的斷言)、`console.test.tsx`(clash panel 渲染斷言)。
- **URL/proxy 明寫**：client 走 `/api/governance/federated-sets/{id}/clash`、`GET .../clash/{run_id}`、`POST /api/governance/issues/from-clash/{run_id}`；proxy forward 去 `/api/governance` 前綴(對齊既有慣例)、帶 query 沿用 from-diff 的 queryString plumbing。
- **ClashStore 歸屬**：`federation/clash.py`(引擎) + `federation/clash_store.py`(持久化)，由 `federation/api.py` 掛入，保持模組邊界。
- clash Panel 的 **IFC 路徑為獨立 input**（不複用 Federation Builder 的 usd_path，因 clash 吃 IFC 非 USD）。
- size guard 數值：先測 japanese_villa.ifc(70KB) add_file timing(實測 0.118s)定門檻(初始建議 products≤2000 或 ≤5MB)。
- **建議 A3 預切兩 PR**：`PR-A3-1a`(後端 clash 鏈 CLASH-1/2/3 + proxy CLASH-4)、`PR-A3-1b`(前端 clash Panel CLASH-5)，避免前端等後端 spike 卡工。

### 誠實面
8 視角一致：**無假綠燈、無假數據、無 skip-as-PASS、無漏 provenance 的設計**。被點名的潛在假綠風險(good tone CSS 靜默無效、from-clash 第二 GUID 靜默丟失、大檔 timeout)皆已由上述修正的「斷言」紀律堵住。

