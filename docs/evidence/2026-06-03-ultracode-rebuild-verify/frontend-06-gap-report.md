# Frontend「06 操作介面總覽」骨架 Gap 分析 + 可執行建置計畫

- 日期：2026-06-03
- 任務主線：以「06 操作介面總覽」為骨架建全部前端頁面，且 A1/A2/A3 可在介面真實驗證。
- 範圍：只讀分析；本檔為唯一寫出物。不改任何 code。

## 0. 權威輸入（已讀）

| 類別 | 路徑 | 角色 |
|---|---|---|
| 06 規格（live OpenSpec capability） | `openspec/specs/edge-console-operator-frontend/spec.md` | 骨架鐵律 / 兩段式導覽 / provenance 誠實鐵律的 **source of truth**（**但 A2/A3 條款已過時**，見 §4） |
| 06 shell 設計 | `openspec/changes/archive/2026-06-03-edge-console-shell/design.md` | 路由決策（零依賴 hash / `/console` pathname）、跨 repo 資料流、誠實系統 |
| 雲端設計原型（06 骨架視覺/結構權威）｜**外部 repo** | `C:/Repos/design/bim-desigin-arich/project/coordinator/console/` 之 `app.jsx`/`data.jsx`/`pages.jsx`/`pages2.jsx`/`components.jsx`（外部設計原型 repo，非本 repo） | 兩段式 IA、頁面殼、誠實 provenance 系統原型 |
| A1–A10 權威功能規格｜**外部 repo** | `C:/Repos/design/bim-desigin-arich/bim-desigin-arich (4)/roadmap-data.jsx`（`RM_APPS`）（外部設計原型 repo，非本 repo） | 每 app 的 DB schema / REST api / ui 面板 / mvp 驗收 / sprint steps / risks |
| 現有實作 | `web-viewer-sample/src/console/` 之 `EdgeConsole.tsx`/`pages.tsx`/`components.tsx`/`data.ts`/`governanceClient.ts`/`console.test.tsx`/`edge-console.css` | 目標 repo 落地現況 |
| coordinator proxy | `bim-review-coordinator/src/routes/governanceProxy.ts` | 決定哪些 `/api/governance/*` 已 live |
| 後端 | `governance-service/`（`app.py` + `diff_engine/api.py` / `federation/api.py` / `issues/api.py` / `bcf/api.py`） | 決定哪些前端可「真實驗證」 |

---

## 1. 06 骨架 IA（導覽結構 + deep-link slug 表）

### 1.1 兩段式導覽（雲地邊界視覺化）

06 鐵律：左側導覽分兩段，視覺化「雲 vs 地」邊界。出自 `app.jsx` 的 `NAV_GOV` / `NAV_OMNI` 與現有 `data.ts` `PAGES`：

- **GOVERNANCE PLATFORM · 零 GPU · coordinator**（governance plane）
- **OMNIVERSE RUNTIME · KIT / USD / GPU**（omniverse plane）

每個 nav item：`num`（A/B/C…字母序）+ `label` + 可選 `badge`（p1/p15）。右側為可折疊 **ChatUSD Agent 欄**（A9 ROADMAP，後端未建，互動僅示意）。頂列 = edge health chips（COORD/KIT as-built；CONV/GPU「未取得」標 demo 非 fail）。底列 = runtime jobs（誠實狀態）。版型 = `ec-root` 三欄 grid（top / nav / main / agent / foot）。

### 1.2 頁面清單（原型 vs 現有實作）

| no | 原型 app.jsx (`NAV_*`) | 現有 `data.ts` PAGES | plane | 現有 body 來源 |
|---|---|---|---|---|
| A | overview | overview | governance | `OverviewPage`（真實 body） |
| B | coordinator | coordinator | governance | `StubPage`（殼） |
| C | intake | intake | governance | `StubPage`（殼） |
| D | issues（badge p1） | issues · 語意驗收 / Rule Center | governance | `IssuesRuleCenterPage`（真實 body，A1） |
| E | apps | apps · A1–A10 | governance | `AppsPage`（真實 body） |
| F | runtime | runtime | omniverse | `StubPage`（殼） |
| G | review（badge p15） | review | omniverse | `StubPage`（殼） |
| H | （原型無此頁） | semantic（Semantic Viewer） | omniverse | `StubPage`（殼） |

差異：現有實作把原型 7 頁擴成 8 頁（新增 **H Semantic Viewer**，omniverse plane）。原型 issues 頁 badge=p1（因原型時代後端未建）；現已不該再標 p1（A1 後端已 merged）。

### 1.3 A1–A10 deep-link slug 表（`RM_APPS` 權威）

原型 deep-link 契約：`../governance/index.html#/app/<slug>`（指向 sibling governance 子站）。**現有實作改為 console 內部 route**（不另開子站），故下表「現有 route」欄是 `data.ts` `A1A10[].route`（hash 內頁），這是落地後正確作法。

| code | slug（RM_APPS 權威） | title | tier | RM phase | 現有 console route（data.ts） |
|---|---|---|---|---|---|
| A1 | governance | BIM 治理與模型檢核 | focus | 1 | `issues`（→ IssuesRuleCenterPage） |
| A2 | version-diff | 模型版本差異與責任追蹤 | focus | 2 | `version-diff`（→ VersionDiffPage） |
| A3 | federation | 跨專業模型 Federation | focus | 2 | `federation`（→ FederationPage） |
| A4 | ai-search | 語意搜尋與模型問答 | roadmap | 4 | —（無 route，灰卡） |
| A5 | iot-fm | IoT / BMS / FM 數位分身 | roadmap | 3 | — |
| A6 | 4d-5d | 4D / 5D 施工模擬 | roadmap | 2 | — |
| A7 | reality-capture | Reality Capture 比對 | roadmap | 4 | — |
| A8 | synthetic-data | Synthetic Data Studio | roadmap | 4 | — |
| A9 | usd-copilot | USD Code / ChatUSD | roadmap | 4 | —（同時是右欄 Agent） |
| A10 | robot-sim | 機器人 / 無人機巡檢 | roadmap | 4 | — |

> 註：原型 `data.jsx` 的 A1A10 與 `roadmap-data.jsx` `RM_APPS` 的 phase 對 A6 標 phase 2（diff 一致）；現有 `data.ts` 對 A6 標 phase 2 一致。slug 三方一致。

---

## 2. 逐項 Gap 表

**狀態定義**：built = 真實 body 已接 live API / 已落地；partial-skeleton = 有真實 body 但缺部分功能；launcher-only = 只在 AppsPage 當卡片；missing = 完全沒有。
**後端可真實驗證**：A1✅ A2✅ A3✅（後端皆 merged 並經 coordinator proxy live）；A4–A10 為 roadmap vision（後端不存在）。

### 2.1 A1–A10 應用

| app | 06/RM 要求（節錄 RM_APPS） | 現有實作狀態 | 後端可真實驗證 | 差距描述 |
|---|---|---|---|---|
| **A1** | Rule Center：rule set 列表 / 失敗統計 / failed elements（含 ifc_guid + usd_prim_path）/ [Highlight in 3D] [Create Issues] [Export BCF] [Export Excel] [Compare Versions] | **built**（`IssuesRuleCenterPage`：live rule-run、IDS 路徑、真實 artifact、from-rule-run 建 issue、BCF 匯出、transition） | ✅ POST `/api/governance/rule-runs` 等全 live | 缺：**[Highlight in 3D]**（把 failed `usd_prim_path` 經 client `highlightPrimsRequest` 送 viewer，RM mvp 第 4 條）；**[Export Excel]** 按鈕（client 有 `exportUrl` 但頁面未放按鈕）；**[Compare Versions]** 連到 A2 的捷徑 |
| **A2** | Diff Builder / Summary cards / Issue Impact（resolved/reopened/new）/ **3D Overlay 綠紅橘藍** | **built**（`VersionDiffPage`：live diff、include_geometry、items、issue-impact、from-diff 建 issue） | ✅ POST `/api/governance/diffs` + `/issue-impact` live；`apply-overlay` proxy+後端有但前端未用 | 缺：**3D colour overlay**（`apply-overlay` 端點 proxy+後端已存在，前端零呼叫 — 確認 gap）。其餘 mvp 5 條皆已滿足 |
| **A3** | Federation Builder（discipline/version/visible/order/transform）/ [Validate Coords] [Build] [Open in Review Room] / Sample USDA | **built**（`FederationPage`：member 表含 per-member transform、validate-coords、build、review-room handoff） | ✅ POST `/api/governance/federated-sets/*` 全 live | 缺：**member visibility toggle**（RM mvp 第 5 條「即時切換 visibility 不重建」；後端 member 有 `visibility_default`，前端 UI 未提供切換）；Sample USDA 預覽區（build 已回 `sublayer_order`/`prim_sample`，可呈現） |
| **A4** ai-search | element_search_index / 10 固定 query / interpreted filters 不黑箱 / Highlight + batch issue | **launcher-only** | ❌ vision | 後端不存在。只能做誠實 vision 骨架（schema/api/ui/mvp/risks），標 p4 |
| **A5** iot-fm | sensors/readings/alerts/work_orders / 3D heatmap / MQTT | **launcher-only** | ❌ vision | 同上，標 p3（RM phase 3） |
| **A6** 4d-5d | schedule import / activity↔element / date overlay | **launcher-only** | ❌ vision | 同上，標 p4（現 data.ts p15；RM phase 2 但 dep=omni 待 GPU） |
| **A7** reality-capture | capture_jobs / deviation / 點雲對齊 | **launcher-only** | ❌ vision | 同上，標 p4 |
| **A8** synthetic-data | dataset_jobs / Replicator / COCO-YOLO | **launcher-only** | ❌ vision | 同上，標 p4 |
| **A9** usd-copilot | preview+apply+undo / session-layer only / audit | **launcher-only + 右欄 Agent 殼** | ❌ vision | 右欄 Agent 已誠實標 ROADMAP；可加 A9 vision 詳頁，標 p4 |
| **A10** robot-sim | inspection routes/targets / Isaac Sim | **launcher-only** | ❌ vision | 同上，標 p4 |

### 2.2 06 共用頁面 / section

| page | 06 要求（原型 pages.jsx/pages2.jsx） | 現有實作狀態 | 後端可真實驗證 | 差距描述 |
|---|---|---|---|---|
| **A overview** | Edge Health chips / 服務邊界圖 BoundaryDiagram / 已實作路由數 / Phase backlog / 相依授權風險表（LGPL，禁「零授權風險」） | **partial-skeleton**（有 health + boundary 文字 + phase backlog；但 **無 BoundaryDiagram 視覺**、**無相依授權風險表**、**無已實作路由 endpoint 清單**） | 部分（coordinator `/health` 可探活） | 缺原型三個 Panel：BoundaryDiagram（三欄 web/boundary/internal）、DEPENDENCIES 授權表、ENDPOINTS 路由清單 |
| **B coordinator** | sessions(created/active/closing/closed/failed) / session detail / artifact bindings / 事件流 Socket.IO / Endpoint Pool / N-viewer smoke / Dispatch / callback outbox | **launcher-only → StubPage**（只列 5 條 Field + provenance；無原型的 session list / detail / pool / outbox 真實互動） | ✅ coordinator `/api/review-sessions*`、`/api/external/ifc-ready`、`/api/internal/callback-outbox/*` 皆 as-built | 整頁缺真實 body。可接 coordinator 既有 REST（非 governance proxy）做成真實頁，但**屬 coordinator plane，不在「A1/A2/A3 主線」**，列 P2 |
| **C intake** | IFC-ready intake / conversion / quality metrics / mapping fidelity（誠實：不承諾精準 GUID） | **launcher-only → StubPage** | 部分（coordinator `/api/external/ifc-ready/:jobId` as-built；conversion quality 為 artifact） | 整頁缺真實 body；mapping fidelity 須遵守 mock-vs-real 隔離鐵律。列 P2 |
| **D issues / Rule Center** | （= A1） | **built** | ✅ | 見 A1 列；此 nav 應移除過時 p1 badge |
| **E apps** | A1–A10 launcher（focus 綠卡 / roadmap 虛線卡）/ deep-link 契約 Panel | **built** | n/a | 已符合。roadmap 卡灰掉不可點 = 誠實 |
| **F runtime** | kit_instance_bindings / stream-config（read-only proxy）/ governance rule-run binding | **launcher-only → StubPage** | 部分（coordinator `/api/review-sessions/:id/stream-config` as-built；GPU 未取得標 demo） | 整頁缺真實 body。列 P2 |
| **G review** | USD over WebRTC viewport / tool rail（openStage/focusPrim/selectPrims/clearHighlight as-built；highlight/section/snapshot 待建）/ issue list / highlight bridge | **launcher-only → StubPage** | 部分（viewer DataChannel 指令 as-built；但真正 viewport 在既有 `<App/>` viewer，非 console） | console 內 review 為殼；真實 3D 在既有 viewer 路徑。列 P3（與既有 viewer 整合複雜） |
| **H semantic** | （原型無；現新增）IFC→USD 語意檢核：載入真實 element_mapping.json + entity_index.json、點構件 client highlight | **launcher-only → StubPage** | 部分（mapping artifact 為真實；highlight 走 client DataChannel as-built） | 整頁缺真實 body；須嚴守 mapping fake-vs-real 隔離（`mock=true`/`fake_mapping_count>0` 一律當 fake）。列 P2 |
| **右欄 ChatUSD Agent** | A9 ROADMAP 示意欄、寫入限制聲明 | **partial-skeleton**（已誠實標 ROADMAP + 「AI 僅改 review/session layer」聲明；但比原型少 SUGGESTED prompts / 輸入框） | ❌ vision | 可補原型的 suggested prompts（disabled）+ 輸入框（disabled），保持誠實 |
| **TopBar / FootBar / FlowBar / Tweaks** | health chips / runtime jobs / 5-step flow bar / density·register·scenario tweaks | **partial**（TopBar 有 3 chips；無 FootBar runtime jobs、無 FlowBar、無 Tweaks 面板） | n/a | 原型的 FlowBar（Intake→Convert→Meeting→Mark→Record）與 Tweaks（操作員/技術用語切換）未移植；屬 polish，列 P3 |

---

## 3. 可執行建置計畫（依優先序，可分派 build agent）

共同約束（全項適用）：
- 改檔範圍限 `web-viewer-sample/src/console/`（守 viewer repo 邊界）。
- 前端只打 `governanceClient`（→ coordinator `:8004` `/api/governance/*`）；**永不直連 `:49102`**。
- provenance 鐵律：真實 live 資料無假數字；後端離線顯示未連線（不假裝成功）；vision 頁標 p3/p4。
- 共同驗收：`web-viewer-sample` 跑 `npm run build`（vite, = `npm run verify`）+ `npm run test`（vitest）；新增功能補 `console.test.tsx` 斷言。`bim-review-coordinator` 若動 proxy 跑 `npm run verify`（tsc + test）。

### P0 — 規格對齊（阻斷誠實鐵律，必先做）

**P0-1 修正過時 06 spec 條款**
- 改檔：`openspec/specs/edge-console-operator-frontend/spec.md`（+ 視需要新開 OpenSpec change，因動 spec 須走 branch→PR）。
- 內容：第 40–54 行「A2/A3 SHALL 為標示待建的骨架(p1)…SHALL NOT 顯示 diff/federation 結果」**已與現實牴觸**——A2/A3 後端已 merged，`VersionDiffPage`/`FederationPage` 已 live 接 proxy。需改為「A1/A2/A3 SHALL 在介面可真實驗證（經 coordinator proxy 觸發 live rule-run / diff / federation build）」。並補 `## Purpose`（現為 `TBD`）。
- 驗收：`npx openspec validate edge-console-operator-frontend --strict`；spec 與 `data.ts`（A2/A3 已 `asbuilt`）一致。
- provenance：n/a（文件）。
- 相依：無。**先行**，因其他項以此為準。

### P1 — A1/A2/A3 主線：補齊「真實可驗證」缺口（重點）

> 比照 A1 Rule Center 模式：UI 動作 → `governanceClient` → coordinator proxy → governance-service live。三項皆**獨立檔內小範圍 edit，可平行**。

**P1-1 A2 VersionDiffPage：接 `apply-overlay`（3D colour overlay）**
- 改檔：`web-viewer-sample/src/console/pages.tsx`（`VersionDiffPage`）；`governanceClient.ts`（加 `applyDiffOverlay(diffId)` 呼叫 `POST /api/governance/diffs/:id/apply-overlay`）。
- 端點：`POST /api/governance/diffs/:diffId/apply-overlay`（proxy 第 89 行 + 後端 `diff_engine/api.py:87` **皆已存在**；前端零呼叫 = 確認 gap）。overlay 顏色（綠 added / 紅 removed / 橘 moved / 藍 property）依 RM_APPS A2 ui；實際 3D 著色走 client `highlightPrimsRequest`（既有 builder，不復活 server-push）。
- 驗收：tsc + vitest；新增斷言 overlay 按鈕存在且帶 provenance；後端離線顯示未連線。
- provenance：overlay 觸發 asbuilt；3D 著色管線（client highlight）標 asbuilt / 視整合程度標 p15（同現有 pages.tsx 第 306 行既有標示）。

**P1-2 A3 FederationPage：member visibility toggle（即時切換不重建）**
- 改檔：`web-viewer-sample/src/console/pages.tsx`（`FederationPage` member 表加 visible checkbox）；`governanceClient.ts`（`addFederatedMember` 已支援 `visibility_default`，確認 build 後 hidden 清單回傳已有 `FederatedBuildResult.hidden`）。
- 端點：沿用 `POST /api/governance/federated-sets/:setId/members`（`visibility_default`）+ `…/build`（回 `hidden[]`）。RM_APPS A3 mvp 第 5 條。
- 驗收：tsc + vitest；斷言 visibility 欄存在；build 結果顯示 hidden members。
- provenance：asbuilt（後端 member visibility 已落地）。
- 風險：若「不重建即時切換」需後端新端點則超出現有 API → 第一版以 build 時帶 visibility 達成（誠實標：切換需 rebuild），不捏造即時能力。

**P1-3 A1 IssuesRuleCenterPage：[Highlight in 3D] + [Export Excel] 按鈕**
- 改檔：`web-viewer-sample/src/console/pages.tsx`（`IssuesRuleCenterPage`）。
- 內容：failed 列加 [Highlight in 3D]（把 `usd_prim_path` 經 client `highlightPrimsRequest` 送 viewer，RM_APPS A1 mvp 第 4 條）；加 [Export Excel]（client `exportUrl(runId)` 已存在，只缺按鈕）。
- 端點：Excel = `GET /api/governance/rule-runs/:id/export?fmt=excel`（proxy 第 65 行 live）；Highlight = client DataChannel（既有）。
- 驗收：tsc + vitest；斷言兩按鈕存在。`usd_prim_path=null`（未對映）誠實顯示不可 highlight。
- provenance：Excel asbuilt；Highlight 視 viewer 整合標 asbuilt / p15。

### P2 — 06 共用頁面真實化（governance plane 優先，可平行）

**P2-1 OverviewPage 補三 Panel（BoundaryDiagram + 授權風險表 + 路由清單）**
- 改檔：`pages.tsx`（`OverviewPage`）；可在 `data.ts` 新增 `DEPENDENCIES` / `ENDPOINTS` 常量（移植自原型 `data.jsx`）。
- 內容：移植原型 BoundaryDiagram（web-plane→boundary→internal 三欄）、DEPENDENCIES 授權表（**禁寫「零授權風險」**，LGPL copyleft 須標）、coordinator 已實作路由清單。
- 端點：唯讀展示為主；可選接 coordinator `/health`。
- 驗收：tsc + vitest；斷言 DEPENDENCIES 含「copyleft」、無「零授權風險」字串。
- provenance：邊界圖 asbuilt；授權表 asbuilt。

**P2-2 SemanticViewerPage（H）真實 body**
- 改檔：`pages.tsx`（新 `SemanticViewerPage`，取代 EdgeConsole 第 45–46 行 semantic StubPage）；`EdgeConsole.tsx`（`renderBody` semantic case 換成新 component）。
- 內容：載入真實 `element_mapping.json` + `entity_index.json`，點構件 → client `focusPrim`/`highlightPrims`。
- 端點：mapping 為 conversion artifact；highlight 走 client DataChannel。
- **誠實鐵律（強制）**：嚴守 mapping fake-vs-real 隔離 —— `mock=true` / `allow_fake_mapping=true` / `fake_mapping_count>0` / `mapping_method=fake_for_smoke_test` 一律當 fake 並明確標示，禁覆蓋真 mapping。
- 驗收：tsc + vitest；斷言 fake mapping 會被標 demo / 拒絕當真。
- provenance：mapping artifact；highlight asbuilt。

**P2-3 CoordinatorPage / IntakePage / RuntimePage 真實 body（B/C/F）**
- 改檔：`pages.tsx`（三個新 component 取代對應 StubPage）；`EdgeConsole.tsx`（`renderBody` 三個 case）；視需要新增 `coordinatorClient.ts`（打 coordinator 既有 REST，非 governance proxy）。
- 端點：B = `/api/review-sessions*` + `/api/internal/callback-outbox/*`；C = `/api/external/ifc-ready/:jobId` + conversion quality；F = `/api/review-sessions/:id/stream-config`。皆 coordinator as-built。
- 驗收：tsc + vitest；後端離線誠實顯示；GPU/conversion「未取得」標 demo 非 fail。
- provenance：session/binding/stream-config asbuilt；GPU/conversion demo。
- 風險：新增 `coordinatorClient` 須守邊界（只打 `:8004`）；instance 值若無真實遙測一律標 demo，不捏造秒數（同原型 ENDPOINT_POOL 誠實作法）。

### P3 — 誠實 vision 骨架 + polish（可平行，低風險）

**P3-1 A4–A10 vision 詳頁（誠實 roadmap）**
- 改檔：`pages.tsx`（一個 `AppVisionPage` 泛用 component，吃 RM_APPS-移植資料）；`data.ts`（移植 `RM_APPS` 的 schema/api/ui/mvp/risks，新增 `A1A10_DETAIL`）；`AppsPage` roadmap 卡改為可點 → vision 詳頁。
- 內容：每頁顯示 DB schema / REST api / ui 面板 / mvp 驗收 / sprint steps / risks（皆標 vision），**明確標後端未建**。
- provenance：A5 標 **p3**（RM phase 3）；A4/A6/A7/A8/A9/A10 標 **p4**（RM phase 4）。注意現有 `data.ts` 全標 p15，建議細分 p3/p4 對齊 RM phase（需同步 `Prov` 型別或新增 label）。
- 驗收：tsc + vitest；斷言每 vision 頁含「後端待建/未建」且無捏造數字。
- 相依：A9 與右欄 Agent 共用 slug，注意一致。

**P3-2 右欄 Agent 補 suggested prompts + disabled 輸入框**；**P3-3 FlowBar + Tweaks 面板移植**（操作員/技術用語切換、scenario clean/warn）。
- 改檔：`EdgeConsole.tsx` + `components.tsx`（+ 可選 `tweaks` 狀態）。
- provenance：Agent p4；FlowBar/Tweaks 為 UI polish（asbuilt UI、無資料宣稱）。

### P4 — review 頁與既有 viewer 整合（最後，相依複雜）

**P4-1 Review Room（G）**：console 內 review 與既有 `<App/>` viewer（真實 WebRTC viewport）整合。
- 相依：牽涉 `src/App.tsx`/`Window.tsx`（viewer 主體，非 console 檔），跨越 console 邊界，風險高 → 獨立評估，不與 P1–P3 平行。第一版維持 StubPage + 連到既有 viewer 入口的連結即可。

---

## 4. 誠實鐵律檢查點（標錯 / 假資料風險）

1. **【最高優先 · 規格 drift】** `openspec/specs/edge-console-operator-frontend/spec.md` 第 40–54 行仍宣稱「A2/A3 為標示待建骨架(p1)，SHALL NOT 顯示 diff/federation 結果」——**與已 merged 的 A2/A3 後端 + live 前端牴觸**。這是「標錯 provenance」的反向案例：spec 把已實作說成待建。必須以 P0-1 修正，否則後續 build agent 可能據過時 spec 把 A2/A3 退回骨架。`data.ts` 第 56–60 行已正確標 A2/A3 `asbuilt`，可作為對齊基準。

2. **`StubPage` 殼頁的 provenance 是否誠實**：EdgeConsole.tsx 第 38–46 行 B/C/F/G/H 殼頁 items 內含 `demo`（GPU 未取得）、`asbuilt`（coordinator 端點）、`p15`（待建）混用。轉真實 body（P2）時須逐欄重驗：凡無真實遙測來源的數值（GPU 秒數、framed 數）一律 demo / 「未取得」，**禁畫成 fail、禁捏造**（沿用原型 ENDPOINT_POOL / NVIEWER「port listening ≠ has frame」誠實作法）。

3. **Semantic Viewer mapping 假資料風險（P2-2）**：載入 element_mapping.json 時，凡 `mock=true` / `allow_fake_mapping=true` / `fake_mapping_count>0` / `mapping_method=fake_for_smoke_test` 一律當 fake 標 demo，**嚴禁覆蓋或冒充真 mapping**。這是本 repo 既有鐵律（mapping fake-vs-real 隔離）。

4. **A4–A10 vision 頁（P3-1）**：RM_APPS 的 scenario 內含具體數字（如 A1「312 扇門 / Passed 287 / Failed 25」、A2「新增 18 段風管」）——這些是**原型情境敘事，非真實 run**。移植時必須整段標 vision/demo 或改寫為「範例情境」，**禁止當成本系統的真實實測**（呼應原型 data.jsx 開頭「No fabricated marketing numbers」與已移除的 127 rules / 99.1% GUID / 92.4% mapping）。

5. **`from-diff` 建 issue 的版本綁定**：後端 `issues/api.py:114` 對缺 `target_model_version_id` 的 diff **直接拒絕**（誠實鐵律：所有 issue 綁 model_version）。`VersionDiffPage` 的 from-diff 按鈕（pages.tsx 第 292 行）須能誠實顯示此 400 拒絕，不可吞掉錯誤假裝成功。

6. **nav badge drift**：原型 app.jsx issues 頁 badge=p1、review=p15。現有 `data.ts` PAGES 未帶 badge（已移除），但若 build agent 參照原型移植，勿復活 issues 的 p1 badge（A1 後端已 merged）。

---

## 5. 建議分工（平行 vs 相依）

### 可平行（不同檔 / 無共享狀態，可多 agent 同時）

- **P0-1**（spec，先單獨完成並 merge，作為其餘基準）
- **P1-1 / P1-2 / P1-3**：皆只動 `pages.tsx` 內**不同 component** + `governanceClient.ts` 內**不同方法**。若擔心 `pages.tsx` / `governanceClient.ts` 合併衝突，建議**序列化在同一 agent 的三個 commit**，或先把三 component 拆到獨立檔再平行（拆檔本身一個小 PR）。
- **P2-1（Overview）/ P2-2（Semantic）/ P2-3（B/C/F）**：三組改不同 component + 各自 client，**可三 agent 平行**（P2-3 內 B/C/F 也可再拆三 agent）。
- **P3-1 / P3-2 / P3-3**：彼此獨立，可平行。

### 有相依（須排序）

- 所有實作項 **依賴 P0-1 先行**（否則據過時 spec 做錯方向）。
- **P1-3 / P2-2 的「Highlight in 3D」** 共用 client `highlightPrimsRequest` 既有 builder：若該 builder 需擴充，先做一次 builder 小改再讓兩者接（避免重複改）。
- **P3-1（vision 頁）依賴 P0-1 對 phase/provenance 的對齊**（p3/p4 細分）。
- **P4-1（Review Room）** 牽動既有 viewer 主體（`App.tsx`/`Window.tsx`），跨 console 邊界，**最後做、不與其他平行**。

### 共用 client/型別（避免衝突的協調點）

- `governanceClient.ts`：P1-1 加 `applyDiffOverlay`；其餘 A1/A2/A3 方法皆已齊備。新增方法集中一次提交較安全。
- `coordinatorClient.ts`（P2-3 新建）：B/C/F 共用，建議先由一個 agent 建好骨架再分頭接。
- `data.ts`：P2-1 加 `DEPENDENCIES`/`ENDPOINTS`；P3-1 加 `A1A10_DETAIL` + 可能細分 `Prov`（p3/p4）。`Prov` 型別若改動會牽動 `components.tsx` `PROV_LABEL`/`PROV_CLASS` 與 `edge-console.css`——屬 d=1 連動，須一併更新。

---

## 6. Buildable-now 摘要（給 orchestrator）

- **現在就能做成真實可驗證（後端已 merged + proxy live）**：
  - **P1-1 A2 apply-overlay**、**P1-2 A3 visibility**、**P1-3 A1 Highlight/Excel** —— 主線重點，三項小範圍、可（拆檔後）平行。
  - **P2-1 Overview 三 Panel**、**P2-2 Semantic Viewer**、**P2-3 Coordinator/Intake/Runtime** —— 接 coordinator 既有 as-built REST，可三 agent 平行。
- **只能做誠實 vision 骨架（後端不存在，標 p3/p4）**：**P3-1 A4–A10 vision 詳頁**（A5=p3，其餘 p4）、P3-2 Agent prompts、P3-3 FlowBar/Tweaks。
- **必須先做（阻斷）**：**P0-1 修正 spec**（A2/A3 已非骨架，spec 過時 + Purpose=TBD）。
- **最後且不可平行**：P4-1 Review Room（與既有 viewer 主體整合）。

優先序：**P0 → P1（主線）→ P2 → P3 → P4**。
