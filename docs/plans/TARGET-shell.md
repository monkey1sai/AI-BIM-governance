# TARGET-shell — 殼層 22 route 逐頁目標規格

> v4 · 2026-07-14 · desigin-system screen/state 對齊與 dual-gate
> 本檔回答「22 頁各要做成什麼樣」（IA、IX 卡全文、API 逐字、實作接點、驗收句、凍結點）。
> 現況（建到哪）一律查 `TRUTH.md`；跨頁不變量查 `TARGET-contracts.md`；viewer 七區塊深規查 `TARGET-viewer.md`；缺口排序與 OPEN 決策查 `BACKLOG.md`。
> 共用 2D shell／A1–A10 screen/state 以上游唯讀 `C:\Repos\design\desigin-system` 與 repo-pinned manifest/baselines 為 design authority；route IA／persona／資料/API/runtime 由本檔 self-contained 正文定義；共享 3D 互動由 `TARGET-viewer.md` 定義，legacy geo-viewer prototype 只作 runtime companion。所有設計數字與協定字樣均須由真資料／契約取代。

---

## §0 基準、凍結點規約、legacy 輸入不一致裁決

### §0.1 基準與凍結點規約

- 基準宣告：`TARGET-shell@v4 frozen 2026-07-14 · 2D基準=approved design-system snapshot；durable behavior authority=self-contained route sections`。
- 作廢範圍（v3→v4）：legacy HTML／paired route PNG 作 production 2D pass/fail 或 coding authority；改以 manifest `screen.id`＋state fixture 對映各 route，未有 reference 者標 `reference_missing`。
- 作廢範圍（v1→v2）：A4–A10 只要求 disabled 佔位頁的舊目標、A1 禁內嵌 viewer 的舊 IA、A9 Copilot／A10 Robotics 舊身分；改為十頁情境導向 vertical slice，未完成時仍依 contracts §9 誠實降級。
- 權威分工：manifest/baselines 管 2D fidelity；本檔管行為、資料、API、fallback 與驗收語意；TARGET-viewer 管 3D/runtime。legacy HTML／route PNG 只補充歷史 IA，不得覆寫三者。
- 凍結點語法：每節末行 `<route>@v<N> frozen <date>`（可 grep）。改版＝bump 版本號＋同節加一行「作廢範圍」。
- **節進入 BACKLOG IN-PROGRESS 後規格凍結；要改＝先 bump 再動工**，禁止邊做邊改規格。

### §0.2 純潔性聲明

本檔不含任何 repo 建成宣稱（禁用樣式清單與 CI grep 見 PROCESS §6 閘 1；本檔命中數必須＝0）；「待建」是需求屬性（本規格要求新增），不受此限。建成狀態唯一落點＝`TRUTH.md`。實作接點欄的改檔清單為撰寫時點的對映；檔案實際位置以 repo 現行結構為機器真相。

### §0.3 legacy 輸入 8 項不一致裁決（有 repo 事實直接裁；無事實進 OPEN，不偷渡）

| # | 不一致 | 裁決 |
|---|---|---|
| 1 | coordinator HostTag：legacy `#minio` 頁標 host、其餘頁標 container | 裁＝**container**（舊標示為筆誤；埠表見 contracts §3） |
| 2 | A1 選檔樣式三選一（下拉 dd／級聯 cascade／樹狀 tree） | 由 approved design screen `workspace.a1.default` 的元件與狀態決定；production 不再提供 legacy PROTO 切換列 |
| 3 | legacy `review→gpu` alias 僅 demo 權宜 | 裁＝正式版 `#review`＝獨立 ReviewRoomPage、`#gpu`＝GpuReviewRoomPage，**永不合併或重定向**（引 contracts §4） |
| 4 | A6 phase 矛盾（data.ts RM phase=2 vs legacy NOT BUILT） | 裁＝以 repo prov=`p4` 與 TARGET 情境為準 |
| 5 | governance 埠 | 全檔一致 `:49102`，無需裁；引 contracts §3 |
| 6 | conv 觸發敘事（#conv 寫「僅靠 watcher」vs #minio 有手動觸發鈕） | 裁＝**雙軌並列**：watcher 自動偵測（opt-in，預設關）＋ `#minio` 手動 `POST /api/conversion/trigger`（x-dev-token）；`#conv` 的 prioritize/retry 只對既有 job 排序／重試、不觸發新轉檔 |
| 7 | Google Fonts／unpkg CDN 外連 | 裁＝僅 legacy 單檔便利；production 依 manifest 的 font-ready 條件與本地 build dependency |
| 8 | 底欄 job bar 轉檔進度與 QUEUE 數字的真資料來源 | **OPEN** → BACKLOG（與 #home 待辦真來源同組） |

### §0.4 來源計數核對（一次性宣告）

> 本節是遷移時點對舊檔（README §7 刪除清單）的清點審計紀錄；舊檔刪除後本節保留作審計軌跡，**不構成引用依賴**（原文 git history 可考，無效力）。

- IX 卡實際清點＝**30 張**：PART B 26 張（IX-A1×8、IX-CV×4、IX-SS×5、IX-KG×4、IX-3D×5）＋PART D IX-TN×4。IX-3D 五張全文落 `TARGET-viewer.md`；IX-TN 四張全文落 `TARGET-contracts.md` §12；其餘 **21 張全文載於本檔**（#a1×8、#conv×4、#sessions×5、#instances×4），零漏卡零濃縮（僅依 §0.2 純潔性剝除建成宣稱字樣，行為內容不動）。
- 手冊 §5 逐路由規格＝24 節（`#a2/#version-diff`、`#a3/#federation` 雙 route 節各計 2，共 26 條路由）落點：`#a1/#a2/#a3/#issues/#conv/#sessions/#minio/#runtime/#spec/#home/#viewer/#gpu/#instances/#a4–#a10/#reports/#admin` → 本檔 §2 各節；`#review` → §4.1 完整節；`#semantic/#overview/#apps/#coordinator/#intake/#kit/#demo-control` → §4.2。

---

## §1 路由契約引用

22 條正典路由身分表、9 個別名＋1 個獨立保留頁、四鐵則（hash 無斜線 `#a1` 非 `#/a1`；`/ui/open?session=:id` 凍結 handoff；`#gpu` 正典＋`#review` 獨立保留；路由機器真相＝`data.ts PAGES[]`＋`EdgeConsole.tsx`）一律見 **contracts §4**，本檔不重抄。

## §1.5 殼層 chrome（全站共用；22 頁之外的殼層需求）

design screen/state：`console.home.default`（共用 shell chrome）；其餘 screen 仍須保持相同 nav/topbar/chrome token 投影

目標 IA：
- **三欄 grid**：`50px 頂欄 / 主區 / 32px 底欄` × `240px nav / 1fr main / 380px agent rail`；`<1180px` 自動收合 agent rail；收合態（`data-agent="off"`）可由底欄重開鈕還原。
- **頂欄**：品牌區（mark＋產品名稱／副標）→ tenant 徽章（虛線 pill「tenant zero · 單站點現況」＋`DEMO DATA` 小標；語意引 contracts §11.3）→ 麵包屑 Pills（專案／版本／階段＋caret；真資料來源未定，接真來源前一律標示意——與 BACKLOG OPEN #2 同組）→ approved design 中存在的 locale 控制（current baseline=`zh-TW`；新增 locale 須有對應 state evidence，不提供無功能 toggle）→ **HealthChips 四枚**（`COORD`／`GPU`／`QUEUE`／`MCP`；缺遙測顯「未取得」＋idle LED 不偽綠；數字真資料來源＝BACKLOG OPEN #2）→ 使用者頭像。
- **Agent rail（右欄 AI 決策助理）**：READY pill＋可關閉；紫色虛線註記「建議必帶 evidence refs；任何 USD 寫入只到 session layer，不直接改 source model」（contracts §7 A10）；「TOOL CALLS」軌跡列＋底部輸入框——真對話／MCP 執行建成前 input 一律 disabled、tool calls 一律標「示意，非實測」，不渲染假結果（現況查 TRUTH §3 #2）。
- **底欄 job bar**：`OMNI` 標籤＋轉檔進度列＋右側 mono 服務摘要（`coordinator :8004 · governance :49102 · MCP x/x`）；agent rail 關閉時出現「↗ Chat USD Agent」重開鈕；進度與 QUEUE 數字接真來源前一律標示意（BACKLOG OPEN #2）。
- **持久化**：localStorage 鍵 `aibim:lang`／`aibim:ec:active`／`aibim:ec:agentOpen`，refresh 不丟狀態；**cache 非 source of truth**。
- **nav 版位**：分組五組與 22 條目依 contracts §4；omni 分組綠色漸層底；nav 底部「雲地邊界」註記＋「雲端控制面：PLANNED · 未建」灰虛線 badge（contracts §11）。

驗收句：DONE＝`console.home.default` 在兩 viewport 通過 contracts §5.1 design gate；殼層 functional E2E 另斷言 HealthChips 缺值不偽綠、tenant/agent/job bar 誠實標示，切頁後 refresh 還原 active route 與 agent 開合；responsive 行為不以縮放 golden 取代實測。

shell-chrome@v1 frozen 2026-07-10

---

## §2 逐頁目標規格（22 條正典路由）

> 每節固定骨架：design screen/state（或 `reference_missing`）／使用情境（persona、trigger、outcome）／主任務流／目標 IA／資料與 API/runtime／誠實 fallback／實作接點／驗收句，末行凍結點。A1 既有 IX 卡保留；其他頁以可驗收 vertical slice 表達。
> 六通用互動模式（模式 1 證據型更新～模式 6 空狀態）與誠實元件規範（disabled＋prov mini-tag、Panel phase 紅 hatch、DarkStage、「未取得」＋idle LED、confirm、空狀態不補假列）全文見 contracts §9，本檔以「模式 N」引用。

## #home 今天要做什麼（⌂ · 工作台 · plane=core · HostTag=CONTAINER）

design screen/state：`console.home.default`

目標 IA：
- ① SaaS 重定位導讀卡（NOT BUILT 樣式：虛線框＋DS `todo` 顯示標籤＋`PLANNED` 小標），三點文案：(1) 定位＝「雲端控制面＋落地端 data/GPU plane」雲地混合多租戶 SaaS（SaaS ≠ 全上雲）；(2) SaaS 能力未具 evidence 時一律 PLANNED，使用 tenant-zero 單站點 fallback；(3) 模型檔不出站：IFC/USD payload 永不上雲，雲端只收 metadata 白名單投影；拔網時落地端完全自主。尾註指向 `ai-bim-governance-saas-架構總覽.md`（PLANNED 增補層，效力低於 contracts）。
- ② 待辦 · TODO 列表：跨應用待辦彙整（A1 失敗／coverage 低／逾期工單聚合），列＝sev 色塊（err/warn/low）＋來源 Badge（A1/A3/A2）＋期限。**真資料來源未定＝OPEN**（§0.3 #8 同組，見 BACKLOG）；接真來源前一律標「示意待辦」。
- ③ 可信度圖例卡：陳列全部 Prov 顯示級別＋說明「沒有遙測就標『未取得』，不畫成綠燈」（contracts §5/§9）。

IX 卡：—（無歸屬 IX 卡）

API（逐字）：無 live API（純導覽＋demo 列）；待辦聚合端點＝待建（隨 OPEN 裁決定義）。

實作接點：改檔＝`pages.tsx`、`components.tsx`、`edge-console.css`。陷阱＝D-07（禁假按鈕）；demo 風險列必標 `prov="demo"`，無捏造計數。

驗收句：DONE＝`#home` 在 `console.home.default` 的兩 viewport 通過 pixel≤1%＋semantic 100%；functional E2E 另斷言 SaaS 導讀卡為虛線 PLANNED、demo 區帶「示範資料」ProvTag、無資料處無綠燈、接真來源前零 `/api/*` 呼叫。

home@v1 frozen 2026-07-10

## #a1 治理與模型檢核（A1 · 核心治理 · plane=core · HostTag=HOST-NATIVE · P0 hero）

design screen/state：`workspace.a1.default`；legacy A1 PNG 只補充 viewer/runtime 情境，不參與 2D pass/fail

**使用情境**：送審前的 BIM QA lead 要在同一頁選 IFC 與 IDS、執行檢核、用真 3D stage 定位失敗構件，確認 runtime 證據後建立 Issue／BCF 並交付報表。成功結果不是一個分數，而是每筆規則可追到 `ifc_guid ↔ usd_prim_path ↔ review_session_id`。

**主任務流**：`選 IFC → 選 IDS/ruleset → 執行檢核 → 啟動/附著 3D Session → 點規則或構件定位 → 建 Issue／匯出`。整頁 reducer：`idle → ifc_picked → rules_picked → running → results_ready → session_starting → reviewing`；重跑只清下游 UI state，不覆蓋歷史 artifact。

**目標 IA**：
- 頂部四步 Stepper：`1 選 IFC`、`2 選 IDS`、`3 執行檢核`、`4 3D Session`；每步顯示真檔名／ruleset version／`rule_run_id`／`review_session_id`，loading、failure、retry 不可只靠顏色。
- 左欄 `IFC / USD 結構`：可搜尋，IFC 與 USD tab 顯同一 model version 的空間樹與 stage tree；點樹節點走 select/highlight，不在 browser 自畫幾何。
- 中央為 **A1 inline Kit WebRTC viewport**（contracts §1.1 限定例外）：工具列、view cube、FPS/latency、stage path 都由 runtime 回報；沒有 first frame 時顯可操作的啟動／重試狀態，不用假建築圖頂替。
- 右欄 `Evidence Inspector`：session role、first_frame_at、expected/loaded stage、stage matched、endpoint/lease、DataChannel ready/latency、mapping coverage（帶分子／分母／method）、conversion status；下方列 endpoint pool 與 session lifecycle。PNG 的 `gRPC`、IP、時間與 98.6% 只是示意，不得照抄。
- 底部 workspace tabs：`檢核結果／Issue／BCF／DH(A2 diff handoff)／Federation(A3 handoff)`；檢核 tab 顯治理分、passed/failed/warning、rule、GUID、prim path、severity、狀態與說明，並提供 `建立 Issue`、Excel、BCF 2.1、`高亮構件`。
- 右下摘要卡只鏡射 A2 差異摘要與 A3 規則/IFC/USD mapping 狀態；資料缺席顯 `未取得`，不補圖片數字。

**IX 卡（A1-01～08 保留語意）**：01 雙來源選 IFC（local_fs/MinIO，一邊失敗不拖垮另一邊）；02 rule-run 1.5s 輪詢與離頁恢復；03 規則列懶載入 failures；04 failures→Issue 冪等鍵 `rule_run_id+guid`；05 Excel 與 BCF 2.1 兩步 gating；06 3D 高亮四條件 `DataChannel ready ∧ first_frame_at ∧ stage matched ∧ usd_prim_path`；07 BCF topic transition 與 assignee；08 inline viewer 的 Evidence Inspector 只讀 `#sessions`／runtime 權威值，viewer ack 前不標高亮成功。

**資料/API/runtime（逐字，全走 coordinator `:8004`）**：`GET /api/governance/files/tree`、`GET /api/minio/objects?prefix=&delimiter=/`、`POST /api/governance/rule-runs`、`GET /api/governance/rule-runs/:id`／`results`／`failures`、`POST /api/governance/issues/from-rule-run/:runId`、`GET /api/governance/issues?rule_run=:id`、`POST /api/governance/issues/:id/transition`、`GET /api/governance/rule-runs/:id/export?fmt=excel`、`GET /api/governance/bcf/export`、`POST /api/external/ifc-ready/:jobId/review-session`（`mode=a1-inline`）、`GET /api/runtime/status`；DataChannel `highlightPrimsRequest`／`highlightPrimsResult`。

**誠實 fallback**：尚未選檔／規則、rule-run 空結果、mapping 缺失、session 排隊、first frame timeout、stage mismatch、DataChannel 斷線、匯出失敗各有獨立空／錯誤／retry state；GPU 缺席不阻止 CPU rule-run，但 3D 操作保持 disabled 並標原因。

實作接點：`pages.tsx`、`a1Machine.ts`、`components.tsx`（SourcePicker／RuleResults／BcfReviewPanel／EvidenceInspector）、`EmbeddedViewer.tsx`、`governanceClient.ts`、`coordinatorClient.ts`。陷阱＝D-20/D-24/D-31/D-33、coverage 自我參照、圖片協定字樣誤抄。

驗收句：DONE＝`workspace.a1.default` 兩 viewport 通過 design gate；functional/runtime E2E 另以 default IFC＋IDS fixture 從 Stepper 跑到真 `rule_run_id`／`review_session_id`，驗 WebRTC 首幀、stage matched、同 GUID prim 高亮 ack、Issue＋Excel/BCF 2.1、DataChannel failure/disabled/retry、network 僅 coordinator，並保存 trace/runtime IDs。

a1@v2 frozen 2026-07-13

## #a2 版本差異與責任（A2 · 核心治理 · plane=core · HostTag=HOST-NATIVE）

design screen/state：`workspace.a2.default`；legacy A2 PNG 只補充 diff/viewer 情境，不參與 2D pass/fail

**使用情境**：設計經理／BIM coordinator 比較 Base 與 Target 版本，分辨新增、移除、移動、屬性與幾何變更，定位受影響 Issue 與責任單位，並交付可審計的差異包。成本與 EVM 歸 A6，A2 不做成本估算。

**主任務流**：`選 Base/Target → 設比較條件 → 執行 diff → split/overlay 檢視 → 選變更 → 查看責任/Issue impact → 建 Issue／匯出`。

**目標 IA**：左欄 Base/Target 專案、模型、版本與角色；頂部比較模式（並排／疊加）與條件設定；中央摘要卡顯五種 `change_type`＋總數；3D viewport 支援可拖曳 split 與 overlay，圖例與 table 使用同一 enum；底部變更表顯 GUID、prim path、Issue、責任單位與說明；右欄依序是 Issue 影響矩陣、責任追蹤、關聯 Review Session 與 PDF/XLSX/BCF/3D 視點匯出。

**資料/API/runtime**：`GET /api/governance/files/tree`、`POST /api/governance/diffs`、`GET /api/governance/diffs/:id`、`GET .../items`、`GET .../issue-impact`、`POST /api/governance/issues/from-diff/:diffId`。`change_type` 逐字 echo contracts §2；`usd_prim_path=null` 留空。`POST .../apply-overlay` 保持 by-design 501；3D 著色只走 client `highlightPrimsRequest`，split/overlay 必須綁可證明的 stage/session。

**誠實 fallback**：跨 schema、無配對鍵、無 prim mapping、geometry compare 未啟用、session/stage 不可用要逐列顯原因；責任資料未知顯未指派，不從檔名推定人員；任何 count 都來自該 `diff_id`。

實作接點：`pages.tsx`、`components.tsx`（VersionPairPicker／DiffSummary／IssueImpact／ResponsibilityPanel）、`governanceClient.ts`、viewer highlight bridge。陷阱＝D-08/D-11/D-20；禁止把 A6 成本卡塞回 A2。

驗收句：DONE＝`workspace.a2.default` 兩 viewport 通過 design gate；functional/runtime E2E 另以 deterministic IFC 版本建真 diff，驗五類摘要、table↔3D 選取、null mapping 不發 highlight、Issue impact/責任回讀與 `diff_id` artifact，保存 trace/session ID。

a2@v3 frozen 2026-07-13

## #a3 跨專業疊合（A3 · 核心治理 · plane=core · HostTag=HOST-NATIVE）

design screen/state：`workspace.a3.default`；legacy A3 PNG 只補充 federation/viewer 情境，不參與 2D pass/fail

**使用情境**：BIM coordinator 在協調會前把建築、結構、機電、土木／景觀等模型組成一個可重現的 federated stage，驗證座標系與每個 sublayer transform，再把同一 artifact 交給 Review Room。

**主任務流**：`建立 set → 新增/匯入 members → 排序/可見性/transform → Coordinate Check → Build Federated USD → Review Room handoff → 檢視 member matrix`。

**目標 IA**：左欄 member ledger（discipline、USD path、順序、visible、XYZ/rotation、version/hash）；中央真 WebRTC federation viewport；右欄 Coordinate Check（CRS、unit、檢查時間、結果）、Sublayer 順序、per-member transform、缺席成員、Review Room 交付與 stage composition；底部 matrix 顯每成員 readiness、座標檢查、幾何檢查、Issue/BCF 與操作；summary 顯 member/visible/missing、prim count、artifact size、build time、builder。

**資料/API/runtime（逐字）**：`POST /api/governance/federated-sets`、`POST .../:setId/members`、`GET .../:setId`、`POST .../validate-coords`、`POST .../build`、`GET .../review-room`、`/ui/open?session=`。stage URL 只取 build/handoff 回應，不自行組。clash 仍是獨立能力：ifcclash runtime probe unavailable 時顯機器可讀原因，絕不畫 0 碰撞。

**誠實 fallback**：少於 2 members、路徑空值、CRS/unit 不一致、build 409/400、missing member、GPU/session 缺席各自阻擋下一步並保留已輸入資料；transform edit 必須 Intent→Confirm→Audited。

實作接點：`pages.tsx`、`components.tsx`（FederationMembers／CoordinateInspector／SublayerPanel／MemberMatrix）、`IntentDialog.tsx`、`governanceClient.ts`。陷阱＝D-10/D-14/D-27；不得把靜態建築背景當 federation frame。

驗收句：DONE＝`workspace.a3.default` 兩 viewport 通過 design gate；functional/runtime E2E 另以至少 2 個 discipline fixture 建 set／驗座標／build，驗 stage path 與 loaded stage matched、member visibility/transform、unit mismatch 阻擋、clash 無假數，保存 build/session evidence。

a3@v2 frozen 2026-07-13

## #a4 語意查詢與證據（A4 · 核心治理 · plane=core · HostTag=HOST-NATIVE）

design screen/state：`workspace.a4.default`；legacy A4 PNG 只補充 semantic/viewer 情境，不參與 2D pass/fail

**使用情境**：不熟 IFC schema 的設計審查者用自然語言找出特定樓層／類別／Pset 條件的構件，先看系統如何解譯，再在 3D 驗證並批次建 Issue。目標是可解釋查詢，不是聊天答案。

**主任務流**：`輸入問句或條件 → 顯示 interpreted filters → 確認/修正 → 執行 → table/3D 同步定位 → 展開 evidence trace → 建 Issue`；BCF 只有滿足 contracts §1 第 8 條或新增 approved provenance bridge 才可用。

**目標 IA**：左上 query composer（範例問句、語意模式、執行）；中央 WebRTC viewport＋結果高亮；底部 tabs `IFC 語意/Pset·Qto/空間/構件/規範關聯` 與分頁結果；右欄顯意圖判斷、confidence（只有定義/校正來源時才顯）、樓層/IfcClass/Pset 條件、規範與模型屬性 Evidence Trace、可編輯條件 builder、符合/不符合統計與建立 Issue。

**目標資料/API（新增 route 前須依 contracts §1.1 凍結 ownership/例外）**：`POST /api/search/model {model_version_id, query}` → `interpreted_filters + results + evidence_refs`；`POST /api/search/spatial`；結果至少帶 `ifc_guid/usd_prim_path/ifc_class/name/storey/properties/match_status/confidence/evidence_refs`。browser 一律打 coordinator；索引以 model version/hash 隔離。

**誠實 fallback**：索引未就緒、問句無法解譯、條件矛盾、confidence 未定義、結果 0、prim mapping 缺失、GPU 缺席都要有明確下一步；AI 不得在使用者確認前擴大/刪除條件，也不得生成不存在的 property。

實作接點：`pages.tsx`、`components.tsx`（QueryComposer／FilterBuilder／EvidenceTrace／SemanticResults）、`data.ts`、新增 coordinator route/client 與 search owner（先過 BACKLOG ownership gate）。陷阱＝D-06/D-08/D-20、LLM 黑箱與 prompt injection。

驗收句：DONE＝`workspace.a4.default` 兩 viewport 通過 design gate；functional/runtime E2E 另以 default fixture 驗自然語言解譯、evidence、3D ack、門檻重算、mapping 缺失不 highlight、批次 Issue confirm/audit，保存 query/runtime trace。

a4@v2 frozen 2026-07-13

## #a5 IoT / FM 數位分身（A5 · 核心治理 · plane=core · HostTag=HOST-NATIVE）

design screen/state：`concept.a5.default`；concept golden 定義 2D 方向，不能替代未來 IoT/FM 真 API/runtime evidence

**使用情境**：設施值班員看到即時漏水／溫度／AQI 告警，要從空間與資產定位設備、確認資料新鮮度與歷史趨勢，建立維保工單並追 SLA；管理者同時看能源與資產健康 KPI。

**主任務流**：`選空間/資產 → 看最新 telemetry 與 freshness → 3D 定位/heatmap → 展開告警/設備詳情 → 建或指派工單 → 查看趨勢/KPI`。

**目標 IA**：左欄空間樹＋資產分類/狀態；頂部 KPI（溫度、濕度、AQI、能源、HVAC、漏水、工單）；中央 floor/room 3D overlay（正常/注意/告警/離線，卡片顯時間與品質）；右欄即時警報、設備基本資料、最新 readings、維保週期與 KPI；底部工單表、資產健康 donut、24h 趨勢。所有 telemetry 遵守 contracts §10.4 的 value/unit/time/quality/source。

**目標資料/API（新增 route 前先凍結 ownership/例外）**：MQTT/BMS ingest 只在 server-side；`POST /api/sensors/bind`、`GET /api/sensors/:id/readings?range=24h`、`POST /api/alert-rules`、`POST /api/work-orders`、work-order list/transition。sensor/asset/room 必須對到 `ifc_guid` 或 `usd_prim_path`；工單可連共同 Issue schema。

**誠實 fallback**：離線、stale、bad quality、單位未知、未綁 BIM、時區未知、GPU 缺席分開顯示；資料 replay/fixture 必須全頁 `DEMO DATA`，不能用綠色「線上」冒充 live MQTT。

實作接點：`pages.tsx`、`components.tsx`（SpaceAssetTree／TelemetryCard／AlertFeed／WorkOrderTable／TrendChart）、IoT/FM client、coordinator route、Kit overlay adapter。陷阱＝高頻 redraw、BMS alias、離線資料被當 0、工單與 Issue 雙寫。

驗收句：DONE＝`concept.a5.default` 兩 viewport 通過 design gate；functional/runtime E2E 另以 deterministic telemetry replay 驗空間定位→設備→工單、stale/單位/時間、同 BIM element 3D ack、broker failure/保留值/retry，保存 `work_order_id`/runtime trace。

a5@v2 frozen 2026-07-13

## #a6 4D / 5D 進度與成本整合（A6 · OMNIVERSE RUNTIME · plane=omni · HostTag=HOST-NATIVE）

design screen/state：`concept.a6.default`；concept golden 定義 2D 方向，不能替代 schedule/cost/runtime evidence

**使用情境**：專案控制／工務主管在週會比較基準排程、實際進度與成本，找出關鍵路徑延誤、依賴與資源衝突，並用 3D＋Gantt 向施工團隊說明影響。

**主任務流**：`匯入 schedule/cost baseline → 綁 WBS/activity 與 elements → 選資料日期/比較對象 → 播放或拖曳時間 → 選逾期工項 → 看依賴/EVM → 建 Issue/匯報`。

**目標 IA**：上方 filters（date range/trade/WBS/contractor/baseline/view mode）與 KPI（進度達成率、CV、關鍵延誤、工項數、風險、EAC）；中央 WebRTC 依已完成/進行中/延誤/未開始著色；下方 Gantt/S-curve tabs；右欄逾期工項 planned vs actual、依賴、Issue/附件與風險預警；底部 EVM、S 曲線、成本分佈。公式固定：`CV=EV-AC`、`SV=EV-PV`、`CPI=EV/AC`、`SPI=EV/PV`，分母 0 顯 n/a。

**目標資料/API（新增 route 前先凍結 ownership/例外）**：`POST /api/schedules/import`（先支援 CSV，再談 P6/MSP）、`POST /api/activities/:id/bind-elements`、`POST /api/schedule/overlay {as_of,mode}`、activity/detail/risk read APIs。資料必帶 baseline id、currency、timezone、data date、source hash；overlay 走 Kit/DataChannel，不在 web 重渲染。

**誠實 fallback**：無 actual feed、成本未匯入、未綁 element、GPU 缺席、activity 粒度過細、EVM 分母 0 分別顯未取得；第一個 slice 可只做 4D，但 5D 卡不得填 demo 金額假裝可用。

實作接點：`pages.tsx`、`components.tsx`（ScheduleFilters／Gantt／ActivityDetail／EvmCards）、schedule/cost owner、coordinator routes、Kit time overlay。陷阱＝時區、貨幣、baseline 漂移、WBS 批次綁定與 D-10。

驗收句：DONE＝`concept.a6.default` 兩 viewport 通過 design gate；functional/runtime E2E 另匯入 schedule fixture、綁 GUID、驗 Gantt/3D/detail/KPI 同一 activity、EVM 可重算、缺 mapping 不著色、Issue confirm，保存 overlay ack/trace。

a6@v2 frozen 2026-07-13

## #a7 掃描比對 / Reality Capture（A7 · OMNIVERSE RUNTIME · plane=omni · HostTag=HOST-NATIVE）

design screen/state：`concept.a7.default`；concept golden 定義 2D 方向，不能替代 capture/alignment/runtime evidence

**使用情境**：現場 QA／測量工程師把 LAS/E57/PLY 或 mesh 對齊設計 BIM，調整 tolerance，找出正／負偏差與漏建／多建，再把高風險偏差交成 Issue。

**主任務流**：`新增 capture → 選模型/掃描 → coarse align/ICP refine → 檢查 transform/RMS → 設 tolerance/切片 → 看 deviation heatmap/list → 建 Issue／匯出`。

**目標 IA**：左欄模型樹、掃描資料集與 selected zone；中央 model/point cloud/mixed/deviation 視圖、切片高度、密度與 tolerance 圖例；右欄 alignment method、transform、RMS/accuracy、tolerance、偏差統計與匯出；底部 deviation table（severity、element、storey/zone、deviation mm、type、status、建議）與分頁。

**目標資料/API（新增 route 前先凍結 ownership/例外）**：`POST /api/capture-jobs`、`POST /api/capture-jobs/:id/align`、deviation list/detail、`POST /api/deviations/:id/to-issue`、`GET /api/capture-jobs/:id/export?fmt=pdf|excel|las`。每個 job 保存 source URI/hash、CRS/unit、4x4 transform、method/parameters、RMS、tolerance 與 runtime/tool version；PDF 報告帶 job/source/model hash、transform、RMS、tolerance、tool version 與產生時間，Excel 帶逐筆 GUID/zone/deviation/severity/status/source_ref，LAS 切片帶 clipping bounds、source hash、unit/CRS；三種 artifact 共用同一 `capture_job_id`，大點雲不進 git。

**誠實 fallback**：未對齊前禁止顯 deviation；RMS 高於門檻顯 low-confidence，不把 scan density 當精度；座標系未知、unit mismatch、空區域、GPU/memory 不足顯機器可讀原因；匯出只含真計算結果。

實作接點：`pages.tsx`、`components.tsx`（CaptureList／AlignmentInspector／TolerancePanel／DeviationTable）、capture service/coordinator route、Kit point-cloud/overlay adapter。陷阱＝CRS、mm/m、ICP local minimum、巨型 artifact 與 precision 誇大。

驗收句：DONE＝`concept.a7.default` 兩 viewport 通過 design gate；functional/runtime E2E 另以 scan fixture 驗 transform/tolerance/RMS、heatmap/table/count、GUID/zone、高 RMS 阻擋、Issue 與三種可追溯 artifact，保存 alignment/runtime evidence。

a7@v3 frozen 2026-07-14

## #a8 Synthetic Data Studio（A8 · OMNIVERSE RUNTIME · plane=omni · HostTag=HOST-NATIVE）

design screen/state：`concept.a8.default`；concept golden 定義 2D 方向，不能替代 Replicator/runtime evidence

**使用情境**：ML／simulation engineer 從核准的 USD stage 定義範圍、相機路徑與 domain randomization，生成 RGB/depth/instance segmentation/bbox 與 metadata，先驗 preview 與品質，再匯出可回溯資料集。

**主任務流**：`選 stage/scope → 放置 camera path → 設 randomization/lighting/material → 選 annotators/writer → preview → 設 budget/split → run → 品質檢查 → export/register`。

**目標 IA**：六步 Stepper；左欄 scene/domain randomization/light/material controls；中央真 RTX viewport＋camera path；中下輸出 preview；右欄 job ID/status/progress、output stats、writer path/version、quality checks、export/manifest/registry；底部 writer throughput、distribution coverage 與 class balance。每 frame 可追 `stage_hash/camera/seed/annotator/writer/timestamp`。

**目標資料/API（新增 route 前先凍結 ownership/例外）**：`POST /api/datasets`、`POST /api/datasets/:id/run`、`GET /api/datasets/:id`、`GET /api/datasets/:id/export?fmt=coco|yolo`。Replicator Annotator/Writer 是標註權威；Cosmos 只做擬真擴增，不得取代 ground truth（contracts §7）。job 必須有 frame/GPU-hour/storage budget 與 cancel。

**誠實 fallback**：preview 與 full run 分開；失敗 frame 不計成功；品質百分比帶算法/分母；GPU 不足、writer path 不可寫、class 空洞、domain coverage 不足要阻擋 export 或顯 warning；生成影像永遠標 synthetic。

實作接點：`pages.tsx`、`components.tsx`（SceneScope／CameraPath／Randomization／OutputPreview／DatasetJobPanel）、dataset owner/coordinator routes、Replicator runner。陷阱＝版本 API 漂移、GPU/storage 無上限、不可重現 seed、把生成影像當真實 evidence。

驗收句：DONE＝`concept.a8.default` 兩 viewport 通過 design gate；functional/runtime E2E 另以 deterministic USD fixture 驗固定 seed/camera/output、per-frame manifest、writer failure/retry、COCO/YOLO schema，保存 `dataset_job_id`/runtime logs。

a8@v2 frozen 2026-07-13

## #a9 機器人 / 自主巡檢（A9 · OMNIVERSE RUNTIME · plane=omni · HostTag=HOST-NATIVE）

design screen/state：`concept.a9.default`；legacy A9 PNG/Copilot 文案只作歷史 companion，不定義 route、API 或 2D pass/fail

**使用情境**：設施／機器人操作員先在 digital twin 驗證巡檢路線、waypoints、禁行區與 camera/LiDAR coverage，執行任務時追蹤電量、定位與異常，並把事件連回 BIM 空間/資產與 Issue。預設是模擬；實機模式另需 edge/ROS 證據。

**主任務流**：`選 robot/sensor pack/mode → 建任務或套模板 → 選巡檢點/禁行區 → 產生/審核路線 → 執行 → 看影像/LiDAR/telemetry → 處理異常 → 完成/回充/匯出`。

**目標 IA**：頂部 robot、battery、mode、mission/status/progress/mileage/ETA；左欄任務佇列與模板；中央 floor 3D route、waypoints、inspection/danger zones、即時 camera/LiDAR；底部 timeline、事件擷取、route history；右欄 mission/robot 狀態、next waypoint、環境告警、anomaly list 與 BIM linkage。

**目標資料/API（新增 route 前先凍結 ownership/例外）**：`POST /api/routes`、`POST /api/routes/:id/simulate`、`GET /api/simulation-runs/:id`，以及 mission create/start/pause/abort/events/telemetry read APIs。`RobotMission.mode=simulation|physical` 必須由後端回傳並顯眼；simulation authority＝Isaac Sim。physical 需另案定義 ROS/edge auth、command ownership、E-stop、heartbeat 與安全責任，不能沿用模擬按鈕直接控制。

**誠實 fallback**：沒有 navmesh、waypoint 不可達、sensor blind spot、collision、定位品質差、battery/telemetry stale、stream 斷線各有阻擋或 retry；即時影像與 LiDAR 只有收到真 frame/packet 才顯 live；simulated sensor 全程標 `SIMULATION`。

實作接點：`pages.tsx`、`components.tsx`（MissionQueue／RobotStatus／RouteViewer／SensorFeeds／EventTimeline）、robot mission owner/coordinator routes、Isaac Sim runner。陷阱＝把模擬當實機、缺 E-stop、BIM 無 navmesh、telemetry freshness、危險動作未 confirm。

驗收句：DONE＝`concept.a9.default` 兩 viewport 通過 design gate；functional/runtime E2E 另以 simulated robot fixture 驗不可達點、route run、同一 runtime ID 的 3D/timeline/sensors/progress、anomaly Issue、telemetry stale 與 audited pause/abort，保留 Isaac/runtime trace且不得宣稱實機。

a9@v2 frozen 2026-07-13

## #a10 其他應用 / AI 決策工作台（A10 · OMNIVERSE RUNTIME · plane=omni · HostTag=HOST-NATIVE）

design screen/state：`concept.a10.default`；legacy A10 PNG/Robotics 文案只作歷史 companion，不定義 route、API 或 2D pass/fail

**使用情境**：資產業主、ESG／法遵與設計決策者把 BIM、能源、IFC/IDS、IoT 與氣象證據放到同一個 scenario，比較 baseline 與替代方案，閱讀有來源的 AI 建議，最後輸出決策報告或建立追蹤 Issue。

**主任務流**：`選專案/模型/資料時間 → 檢查資料來源完整性 → 建 baseline/alternative scenario → 選模組分析 → 比較 KPI/風險 → 展開 AI evidence → 人工採納/拒絕 → 匯報/建立 Issue`；BCF 在 approved provenance bridge 前維持 unavailable。

**目標 IA**：tabs `應用總覽／碳排·能耗／室內溫度與通風／法規審查 Copilot／文件問答／風險模擬／報告生成`；左欄模型/範圍/資料時間與 BIM/Energy/IFC-IDS/IoT/Climate source ledger；中央 3D context＋六個應用卡；右欄 evidence-linked AI 建議、證據來源、baseline vs alternative 表與匯出；底部 AI insight、scenario matrix、report jobs。A10 是組合層，不複製 A1–A9 權威資料。

**目標資料/API（新增 route 前先凍結 ownership/例外）**：scenario create/read/compare、module run/status、evidence drilldown 與 report job APIs；所有 request/response 遵守 contracts §10.4。每個 KPI 帶 unit、baseline、delta、observed_at、source_ref；AI suggestion 帶 claim/confidence/interpreted_inputs/evidence_refs/limitations。若要寫 USD，只能走 preview→confirm→audit 的 session-layer operation；A10 可建立共同 Issue，但 BCF 在新增 approved provenance bridge 前依 contracts §1 第 8 條維持 unavailable。

**誠實 fallback**：缺任一資料源只降級相關模組，不把整頁偽綠；模型衝突、時間窗不一致、低 confidence、無 evidence、報告失敗要可見；AI 不可自動採納方案、改 source model 或把建議說成法規結論。

實作接點：`pages.tsx`、`components.tsx`（SourceLedger／ScenarioMatrix／ApplicationCards／EvidenceRecommendation／ReportJobs）、A10 orchestration client/coordinator route；各模組 owner 由 BACKLOG 決策。陷阱＝catch-all 變成第二份資料庫、跨時間源硬比較、AI 無證據、成本/碳排單位混用。

驗收句：DONE＝`concept.a10.default` 兩 viewport 通過 design gate；functional/runtime E2E 另以 baseline＋alternative fixture 驗 module、source ledger、可重算 KPI、缺來源誠實態、evidence-linked AI confirm/audit、report IDs 與 BCF unavailable，保存 trace且 source model hash 不變。

a10@v3 frozen 2026-07-14

## #issues Issue / BCF（BC · 核心治理 · plane=core · HostTag=HOST-NATIVE）

design screen/state：`reference_missing`（`#issues` 尚未有 approved pixel baseline；legacy anchor 只補充 IA）

目標 IA：
- **Issue 列表** Panel：Issue 依 contracts §10.2 的共同 schema 接收 A1/A2/A3/A4/A5/A6/A7/A9/A10 與 manual 來源（A8 job failure 不自動轉 Issue；`source` 欄標來源）；列＝ID＋標題＋sev＋來源 Badge；status Badge 逐字 echo 生命週期 enum（open/assigned/in_progress/resolved/rejected/reopened，contracts §2）；transition 走 IntentDialog（模式 3）。
- `匯出 BCF 2.1` primary 鈕；**BCF gating 誠實兩步**：先有 `from-rule-run`／`from-diff` issue 才可匯出（contracts §1）；rule-run export 只支援 `?fmt=excel`，BCF 為獨立 endpoint。
- 「在 3D 標示」建成前 disabled＋`p1` 標。

IX 卡：—（無歸屬 IX 卡；A1 的 BCF 面板行為見 IX-A1-07）

API（逐字）：`GET /api/governance/issues`（list）、`POST /api/governance/issues`（create）、`POST /api/governance/issues/:id/transition`、`POST /api/governance/issues/from-rule-run/:runId`、`POST /api/governance/issues/from-diff/:diffId`、`GET /api/governance/rule-runs/:id/export?fmt=excel`、`GET /api/governance/bcf/export`。BCF 對非 rule-run/diff provenance 的 gate 見 contracts §10.2。

實作接點：改檔＝`pages.tsx`、`components.tsx`、`IntentDialog.tsx`、`governanceClient.ts`。陷阱＝D-04（BCF 版本字串集中一處常數，UI 顯 `BCF 2.1`）、D-12（禁 A1Issue/A2Issue 獨立型別）、D-10。

驗收句：DONE＝先取得 `#issues` approved design screen/state 並通過兩 viewport design gate；functional E2E 另驗 rule-run→from failures→transition→BCF、無 issue gated、status enum 逐字與 network 只打 `/api/governance/*`。

issues@v1 frozen 2026-07-10

## #reports 報表中心（RP · 核心治理 · plane=core · HostTag=HOST-NATIVE）

design screen/state：`reference_missing`（`#reports` 尚未有 approved pixel baseline；legacy anchor 只補充 IA）

目標 IA：**可用報表** Panel 兩列呈現規格——列 1＝`A1 檢核結果 Excel 匯出`（ok LED＋`匯出` ghost 鈕，指向 IX-A1-05 同一 API）；列 2＝`中心化報表彙整（待建）`（idle LED、opacity 降、`待建` disabled＋待建標）。中心化彙整（mapping coverage 報表、review package）建成前一律 disabled 待建列，禁暗示功能性報表。
IX 卡：—。API（逐字）：`GET /api/governance/rule-runs/:id/export?fmt=excel`；中心化彙整端點＝待建。
實作接點：改檔＝`pages.tsx`。陷阱＝D-07、D-25（coverage 數字不可當品質宣稱）。
驗收句：DONE＝先取得 `#reports` approved design screen/state 並通過兩 viewport design gate；functional E2E 另斷言可用列可匯出、待建列 disabled＋prov 標。

reports@v1 frozen 2026-07-10

## #viewer 3D Viewer 呈現（3D · OMNIVERSE RUNTIME · plane=omni · HostTag=HOST-NATIVE）

design screen/state：`reference_missing`（`#viewer` 2D chrome 尚未有 approved pixel baseline；live WebRTC frame 永不作設計 golden）

定位句：把 GPU 算好的模型 WebRTC 串到瀏覽器（M4 目標）；console 本頁不內嵌 3D，首幀前＝暗 stage＋斜線佔位，不偽造 matched 影像。
目標 IA：`Card_DarkCTA` 雙欄——左＝DarkStage（glyph ◳）＋全寬 `GPU 開啟主畫面預覽 · Primary + Spectator ↗` CTA → `/ui/open?session=`（凍結 handoff）；右＝需求規格 Panel 四條 bullets：
1. 一個 session 一位主控（Primary）驅動相機與 DataChannel；
2. N 位旁觀（Spectator）收同一串流，只能舉手／留言；
3. 標記、剖切只寫 USD session layer，永不改 source model；
4. **首幀指標由 WebRTC track 事件驅動，未取得不可標綠**。
API（逐字）：`GET /api/runtime/status`（first_frame 讀值）；`/ui/open?session=`。
驗收句：DONE＝先取得只涵蓋 2D chrome/非動態區域的 approved design screen/state 並通過 design gate；runtime E2E 另驗無 active session 時 first-frame 列顯 idle「未取得」、CTA 導向 `/ui/open?session=<id>`，真 session 再驗 first-frame/stage/DataChannel。
深規（七區塊 IA、AC-1~21、IX-3D 卡族）一律見 **TARGET-viewer.md**。

viewer@v1 frozen 2026-07-10

## #gpu GPU 審查室（01 · OMNIVERSE RUNTIME · plane=omni · HostTag=HOST-NATIVE · MVP）

design screen/state：`reference_missing`（`#gpu` 2D chrome 尚未有 approved pixel baseline；live runtime 另驗）

目標 IA：`Card_DarkCTA` 語意同 #viewer（多人同看同一視角：主控驅動、旁觀跟隨；首幀前不偽造 matched 影像）；bridge 步驟（建立 session→派發 endpoint→首幀→DataChannel）以 Stepper 呈現；CTA 走 `openInViewerUrl` → `/ui/open?session=`（不得改 redirect target／session-id regex，contracts §1）；console 內無 WebRTC 影片（僅 link-out）。
**`#review` 獨立頁裁決見 §0.3 #3：`#gpu` 與 `#review` 為兩個獨立元件/route，永不合併或重定向。**
IX 卡：—。API（逐字）：`/ui/open?session=`（經 `coordinatorClient.openInViewerUrl`）。
實作接點：改檔＝`pages.tsx`、`coordinatorClient.ts`、`components.tsx`。陷阱＝D-01（禁 canvas 示意當 3D 交付）、D-17（禁宣稱無縫遷移，contracts §6）。
驗收句：DONE＝先取得 `#gpu` approved design screen/state 並通過 design gate；functional/runtime E2E 另驗 CTA 導向 `/ui/open?session=<id>`、console 內無影片、bridge Stepper 與未建工具 `p15` disabled。

gpu@v1 frozen 2026-07-10

## #conv IFC→USD 轉檔排程（CV · 落地端控制台 · plane=core · HostTag=CONTAINER · P1）

design screen/state：`pipeline.default`

目標 IA：
- ① 3 MetricCards 呈現規則：`IFC-READY 佇列 N`（真值）；`COVERAGE`（**必附「usd_stage_enumeration · 自我參照」note**——coverage_ratio=1 為結構性恆真非 IFC lossless；後端值不動、UI 加註）；`GPU 轉檔`（adapter 未配時顯「未取得」＋idle，note `adapter_from_env 未配 · idle`，不偽綠）。
- ② **ifc-ready 佇列** Panel：列＝job／project／conversion／dispatch／session／stage URL；mono 註「**prioritize / retry 只對既有 ifc-ready job 排序／重試，不觸發新轉檔**」（§0.3 #6 裁決：觸發雙軌＝watcher 自動（opt-in 預設關）＋ #minio 手動 trigger）；`插隊 prioritize`／`重試 retry` 鈕走模式 3；MinIO watch toggle（StatusLED 可觀測狀態，**不預設為開**，保留 IP-allowlist auth header）。
- ③ **轉檔歷史頁**（＝gap-conv-history 的規格本體）：渲染 streaming `GET /api/conversions`（:49101）清單，**一律經 coordinator `/api/dev/conversions` proxy** 取得（browser 不直連 :49101，contracts §1/§3）；列＝conversion id／status（enum 逐字：queued/running/succeeded/succeeded_with_warnings/failed/cancelled）／來源 key／artifact（`model.usdc`＋`element_mapping.json`）／時間；點列展開 `/api/dev/conversions/:jobId/result` 摘要；空清單＝模式 6；歷史頁建成前入口鈕 disabled＋待建標。真實 GPU 轉檔須 env 配 adapter_from_env；live GPU 轉檔證據未觀測前一律標 not observed。

IX 卡（B.2 全文）：

**IX-CV-01 佇列輪詢**：`GET /api/external/ifc-ready` 5000ms，模式 2。列欄位：job / project / conversion / dispatch / session / stage URL。
**IX-CV-02 任務展開**：點列展開 coverage 報告（property/relationship/attribute %）＋輸出路徑；coverage API 未建時顯示待建徽章（模式 6 的 501 規則）。
**IX-CV-03 插隊/重試（endpoint 建成狀態查 TRUTH；未建期間 UI 以 disabled＋規格呈現）**：模式 3；插隊 `POST /api/conversion/jobs/:id/prioritize`、重試 `POST .../retry`；原型的「拖曳排序」正式版**改為按鈕式插隊**（拖曳排序的視覺回饋成本高且易誤觸，控制語意相同）。
**IX-CV-04 自動偵測開關**：`PUT /api/conversion/watch {enabled}`；關閉時佇列頁頂顯示琥珀條「自動偵測已關閉」。

API（逐字）：`GET /api/external/ifc-ready`、`GET /api/external/minio-watch/status`、`GET /api/conversions/:jobId/quality-metrics`、`POST /api/conversion/jobs/:id/prioritize`、`POST /api/conversion/jobs/:id/retry`、`PUT /api/conversion/watch`；轉檔歷史＝streaming `GET /api/conversions` 經 `/api/dev/conversions`（GET）、`/api/dev/conversions/:jobId`、`/:jobId/result` proxy（路徑凍結，contracts §1）。

實作接點：改檔＝轉檔 UI 現行落點（`modelData/ModelDataPage.tsx`＋`modelData/GlobalConversionPane.tsx`＋`modelData/useConversionData.ts` 等；實際位置以 repo 現行結構為機器真相）、`coordinatorClient.ts`、`components.tsx`。**`#conv` 的 alias／獨立頁現況查 TRUTH §1 `conv` 列**；本節規格要求 `#conv` 為獨立正典頁——若現況仍為 alias，解除 alias 屬 route 收斂決策，查 BACKLOG gap-route-convergence／gap-conv-history。陷阱＝D-25（coverage=1 自我參照必加 `conv-coverage-selfref-note`）、D-15（禁宣稱 100% 無損）、D-09（離頁 clearInterval、失敗不清空舊資料）、D-26（MinIO watch runtime env 走 compose 透傳的部署區頂層 `.env`）。

驗收句：DONE＝`pipeline.default` 兩 viewport 通過 design gate；functional E2E 另驗 job 表、coverage note、GPU「未取得」、watch payload/status、`/api/dev/conversions` 歷史 enum 逐字且無直連 `:49101`。

作廢範圍（v1→v2）：v1 節首 HostTag=HOST-NATIVE 抵觸 §0.3 #1 裁決（coordinator HostTag 裁＝container）；v1 實作接點頁名 `ConversionSchedulingPage` 為 stale 對映、且把 alias 現況寫在本檔而非引 TRUTH。v2 改標 CONTAINER、落點改依 repo 現行 `modelData/` 結構、現況一律引 TRUTH §1 `conv` 列。

conv@v2 frozen 2026-07-10

## #sessions Session 管理（SS · 落地端控制台 · plane=core · HostTag=CONTAINER · hero）

design screen/state：`reference_missing`（`#sessions` 尚未有 approved pixel baseline；legacy v2 anchor 只補充 IA）

目標 IA：
- ① **站點連線狀態條（SaaS 前瞻，示意）**：虛線框＋`connected`/`offline-grace · 本地自主運作中` 兩態 pill（idle LED）＋`DEMO DATA · PLANNED · SaaS-M1` 標；徽章不偽綠也不偽紅。行為合約＝**IX-TN-03（PLANNED · SaaS-M1；本行即自足合約，無外部引用）**：徽章三態狀態機 `connected →（逾心跳窗）offline-grace →（逾寬限期）expired →（重連刷新憑證）connected`，值一律後端驅動（模式 4，前端不推定）；上報僅 metadata（計數/狀態/hash/摘要/時戳/版本號，IFC/USD payload 不出站，contracts §11）；`offline-grace` 文案固定標「本地自主運作中」——離線僅犧牲雲端可視性與遠端控制，落地端轉檔／檢核／GPU 渲染／WebRTC 不受影響；`expired` 提示重連刷新憑證；心跳窗與寬限期均為規劃值·非實測。
- ② **Session 列表** Panel（標題直接寫資料來源：`GET /api/runtime/status`（5s 輪詢））：列＝session id＋status Badge（enum 逐字：created/active/closing/closed/failed；機器真相＝coordinator `types.ts` `SessionStatus`，session 無 `queued` 態——`queued` 僅存在於 conversion 脈絡）＋Kit instance＋Primary/旁觀數＋stage key；**每列渲染 occupied 證據鏈三欄（IX-SS-02）**：`first_frame`／`heartbeat`／`stage match`（缺值＝「未取得」＋idle）；動作＝`Primary ↗`／`Spectator ↗`（title：「只開新分頁，不改任何狀態欄（Open URL ≠ occupied）」）；ACTIVE 列有 `結束 session`（模式 3 confirm→`POST /api/review-sessions/:id/close`，重用 cooperative close：釋放 coordinator 端 session/binding、非殺 GPU 上 Kit 行程→確認後列轉灰 60 秒再移除）；`強制釋放（待建）` disabled＋待建標（前置＝heartbeat stale ∧ 無 first frame，IX-SS-03）。
- ③ **A1 連動橋 · 供應端** Panel（hint「A1 只讀鏡射本表 · 不推定」）：證據鏈 `A1 rule_run ⇢ session ⇢ DataChannel ⇢ highlight ack`；A1 四格證據一律讀本頁與 Runtime 監控權威值，證據未齊 A1 高亮鍵保持 disabled。**本頁是 A1 連動橋證據的供應端（單一來源）；Open URL ≠ occupied**。

IX 卡（B.3 全文）：

**IX-SS-01 清單輪詢**：`GET /api/runtime/status` 5000ms。
**IX-SS-02 occupied 證據鏈**：每 endpoint 列三欄證據：`first_frame_at`（無→「未見畫面」琥珀）/ `last_heartbeat`（>15s→stale 紅）/ `stage matched`（expected==loaded 綠勾）。**Open URL ≠ occupied**——open 按鈕按下只開新分頁，不改任何狀態欄。
**IX-SS-03 強制釋放 stale（待建）**：條件：heartbeat stale ∧ 無 first frame；模式 3，confirm 文案「viewer-XXX 已 N 分鐘無心跳，釋放後該座位可被新 viewer 使用」→ `POST /api/sessions/:id/endpoints/:ep/release`。
**IX-SS-04 結束 session**：模式 3 → **重用 `POST /api/review-sessions/:sessionId/close`**（使用者裁定 2026-06-17：不開 spec 原文 `POST /api/sessions/:id/terminate`，因 cooperative close 為 operator terminate 之超集；additive 補 optional `reason`+`actor` 寫進 `sessionClosing`/`sessionClosed` 事件流作模式 3 audit，cooperative close 呼叫端零退化、`reason` 不外溢回傳 body）；前端 `#sessions` per-row 結束鈕僅 `active` 列顯示，成功後該列轉灰（`ec-row-muted`）60 秒再移除（讓 operator 看見因果）。**刻意不加 IP allowlist 守門**（裁定 A：同端點同時服務 browser cooperative close 與 operator terminate，無欄位可區分、無法分離門控）。terminate＝釋放 coordinator 端 session/binding，非殺 GPU 上 Kit 行程（lifecycle 屬 kit-manager-api）。
**IX-SS-05 A1 連動橋 · 供應端（v2 新增 2026-07-02）**：`#sessions` 新增「A1 連動橋 · 供應端」面板：顯示繫結鏈 `A1 rule_run ⇢ session ⇢ DataChannel ⇢ highlight ack`。A1 頁（IX-A1-08）的四格證據**一律讀本頁與 Runtime 監控的權威值**（first_frame_at／heartbeat／stage matched 同 IX-SS-02 語意）；本頁是單一來源，A1 不得自行推定或快取過期值。證據未齊→A1 高亮鍵 disabled，不畫假綠燈。**驗收**：同一證據在 `#sessions` 與 `#a1` 兩頁顯示一致（同一輪詢周期內）；關 session 後 A1 連動橋同步回 idle。

API（逐字）：`GET /api/runtime/status`（5s 輪詢）、`POST /api/review-sessions/:id/close`、`POST /api/sessions/:id/endpoints/:ep/release`（**待建**）。連動橋無新 endpoint（同 `runtime/status` 資料鏡射）。

實作接點：改檔＝`SessionManagementPage.tsx`、`IntentDialog.tsx`、`coordinatorClient.ts`、`components.tsx`（A1BridgeSupplyPanel）。陷阱＝D-24（`stage matched` 必等 viewer 端真實回報 `first_frame_at`，coordinator 不得推定）、D-10（terminate 走三段式）、D-33（供應端與 A1 同輪詢值）。

驗收句：DONE＝先取得 `#sessions` approved design screen/state 並通過 design gate；functional E2E 另驗 IntentDialog close/reason、列轉灰、`強制釋放` disabled、證據缺值 idle、A1 bridge 同源同步與 PLANNED 站點狀態。

作廢範圍（v1→v2）：v1 的 status Badge enum「queued/active/closing/closed」誤植——repo 無 session status=`queued`，且漏列 `created`/`failed`；v2 起以 coordinator `types.ts` `SessionStatus`（created/active/closing/closed/failed）逐字為準。

sessions@v2 frozen 2026-07-10

## #instances Kit / GPU 機隊（KG · 落地端控制台 · plane=omni · HostTag=HOST-NATIVE）

design screen/state：`reference_missing`（`#instances` 尚未有 approved pixel baseline；Kit Manager 2D UI 同樣須另有 approved screen）

目標 IA：**Kit 實例** Panel（監看）：列＝instance id＋用途（串流·審查室／待命）＋LED＋GPU 型號＋`util=未取得`（真遙測未接一律「未取得」＋idle，絕不偽綠）；`KitInstance.status` enum 逐字 echo（contracts §2）。**GPU 鐵律引 contracts §6**：1 GPU＝1 Kit instance＝1 stream；換 GPU＝terminate＋recreate（約 30–40 秒）；無 live migration；spectator 共看不另吃 GPU。真遙測未接前節點快照一律標 `demo`（DEMO DATA），與 Fleet-model 設計區分開呈現。

IX 卡（B.4 全文）：

**IX-KG-01 節點卡輪詢**：接 kit-manager-api 真遙測（建成狀態查 TRUTH）；真遙測未接前一律渲染示範資料並標 `demo`，不接假 API。
**IX-KG-02 拖 session 到他節點 = 重啟搬移**：模式 5 + 3。規則函式：target.drain→拒「節點排空中」；target 已有 stream→拒「1 GPU = 1 stream」；confirm 文案含 30–40s/重載 stage/斷線；確認 → `POST /api/fleet/move-intent {session_id, target_node, reason}` → 目標節點顯示「啟動中…%」（輪詢），完成才在新節點顯示 session。
**IX-KG-03 drain/恢復**：模式 3 → `POST /api/fleet/nodes/:id/drain {on}`；drain 中節點卡片左緣琥珀條、不可成為 drop 目標。
**IX-KG-04 指派待排程 session**：把 pending 卡拖到 idle 節點 → confirm →`POST /api/fleet/assign-intent`。
（以上 fleet intent API＝**待建**；UI 先實作互動骨架，按鈕 disabled＋待建徽章，**拖放規則函式先寫並單元測試**。）

API（逐字）：`GET /api/runtime/status`、`GET /api/kit/instances/current`（經 `/api/kit/*` proxy，禁直連 `:8010`）；`POST /api/fleet/move-intent`、`POST /api/fleet/nodes/:id/drain`、`POST /api/fleet/assign-intent`（皆**待建**）。

實作接點：改檔＝`pages.tsx`、`components.tsx`。陷阱＝D-17（confirm 文案含重啟搬移＋約 30–40 秒；UI/API 不出現 live migration）、D-22（drop 後彈 IntentDialog，禁直接改前端狀態）、D-07。

驗收句：DONE＝先取得 `#instances` approved design screen/state 並通過 design gate；functional E2E 另驗 util「未取得」＋idle、demo ProvTag、fleet intent disabled 與拖放規則單測。

instances@v1 frozen 2026-07-10

## #minio MinIO 資料（M · 落地端控制台 · plane=core · HostTag=CONTAINER）

design screen/state：`reference_missing`（`#minio` 尚未有 approved pixel baseline）

目標 IA：
- ① **真 MinIO 逐層瀏覽** Panel（唯讀 raw-folder，S3 `Delimiter='/'` 語意，像 MinIO 網頁一樣逐層點開）：mono 註 `GET /api/minio/objects?prefix=&delimiter=/ · folders[]=CommonPrefixes · objects[]=當層直屬檔`；點資料夾以該 prefix 重打 list 進下一層（**lazy drill-down**）；**導到含 model.ifc 的葉層**時掛「專案(中文)/種類/版本」語意 badge（`deriveIntakeFromKey`，≥3 段）＋**ledger 衍生狀態 chip**（ready/detected/queued/converting/failed/未轉）；**無 ledger 紀錄誠實標「未轉（含 baseline）」＋提供一鍵觸發轉檔鈕**；資料夾節點**不顯示寫死物件數**（CommonPrefix 不含其下數量）；末層（如 geometries_chunks）摺成單一資料夾不攤開；排序 `localeCompare('zh-TW')`。
- ② **bucket 規約 Panel**（語意參照 · demo 標示）：`bucket bim-control`；key 結構 `專案中文 / …動態層 / 種類(倒數二) / 版本(末) / model.ifc`；`watcher: segments.length < 3 擋 · 中文資料夾 → mv_<hash8>`。此三層規約是 watcher 的解析語意（供對照葉層 badge），**非樹骨架**；真實 endpoint 由部署區 `.env` 注入，不在程式碼硬編碼。
- 定位聲明：本頁為**唯讀 intake 來源視圖，非 metadata 權威**（權威＝bim-control · MySQL，contracts §10）。轉檔觸發雙軌見 §0.3 #6。

IX 卡：—（轉檔佇列行為屬 #conv 的 IX-CV 族）

API（逐字）：`GET /api/minio/objects?prefix=&delimiter=/`、`GET /api/conversion/records`（ledger chip）、`POST /api/conversion/trigger`（一鍵觸發，**x-dev-token**）、`GET /api/minio/events`（SSE，樹即時更新）。

實作接點：改檔＝`pages.tsx`、`governanceClient.ts`、`components.tsx`（實際落點以 repo 現行 `modelData/` 結構為機器真相）。陷阱＝D-26（runtime env 走 compose 透傳）、D-21（空層顯「目前沒有 X＋下一步」，404/501 顯待建徽章非錯誤）。

驗收句：DONE＝先取得 `#minio` approved design screen/state 並通過 design gate；functional E2E 另逐層點入真 bucket 至 `model.ifc` 葉層，驗語意 badge/ledger、未轉＋觸發、無寫死物件數、demo 規約與 coordinator-only network。

作廢範圍（v1→v2）：v1 節首 HostTag=HOST-NATIVE 為原型筆誤原樣凍入，抵觸本檔 §0.3 #1 裁決（coordinator HostTag 裁＝container；本頁資料面全走 coordinator :8004 proxy）。v2 改標 CONTAINER。

minio@v2 frozen 2026-07-10

## #runtime Runtime 監控（RT · SYSTEM · plane=core · HostTag=HOST-NATIVE）

design screen/state：`runtime.ops.default`

目標 IA：4 MetricCards：`KIT 實例`（真值）、`活躍 SESSION`（真值）、`GPU 使用率`（**遙測未接＝「未取得」＋note「遙測待接 · idle」，不畫假綠燈、不捏 GPU 數字**）、`控制面`（health 真值）。無操作鈕（純監看）。streamConfig 欄當 session 回報（CAM/CODEC/LATENCY 有值才顯，FPS 缺值顯「未取得」）。
IX 卡：—。API（逐字）：`GET /api/runtime/status`、`GET /api/review-sessions/:id/stream-config`。
實作接點：改檔＝`pages.tsx`、`coordinatorClient.ts`、`components.tsx`。陷阱＝D-06（provenance 不硬編前端）、D-09。
驗收句：DONE＝`runtime.ops.default` 兩 viewport 通過 design gate；functional E2E 另斷言 GPU/VRAM/FPS「未取得」不偽綠、network 只打 runtimeStatus＋streamConfig，且釋放 Kit 等危險操作遵守 intent→confirm→audited。

runtime@v1 frozen 2026-07-10

## #admin 系統管理（SY · SYSTEM · plane=core · HostTag=CONTAINER · NOT BUILT stub）

design screen/state：`reference_missing`（`#admin` 尚未有 approved pixel baseline）

目標 IA：**系統設定** Panel phase（紅 hatch）：說明「此頁為 stub，介面先佔位。所有設定控制 disabled，不接任何 mock」；`使用者管理（待建）`、`部署設定（待建）` 兩枚 disabled＋待建標（repo prov=`p1`）。
IX 卡：—。API：無（零 `/api/*` 呼叫）。實作接點：改檔＝`pages.tsx`。陷阱＝D-07。
驗收句：DONE＝先取得 `#admin` approved design screen/state 並通過 design gate；functional E2E 另斷言全控制 disabled＋`p1`、零 network。

admin@v1 frozen 2026-07-10

## #spec 設計規格說明（▦ · SYSTEM · plane=core · HostTag=CONTAINER · 文件頁）

design screen/state：`reference_missing`（`#spec` 尚未有 approved pixel baseline）

目標 IA：**A1–A10 狀態總表** Panel（2 欄 grid，每格名稱＋ProvTag）——**狀態值動態取自 TRUTH 語意（不在本檔或頁面硬編建成狀態）**；repo boundary contract 對照列（Panel＋Field 靜態呈現）。尾註（mono）：「scenario 數字（『312 扇門』『17000 frames』）一律願景敘事，**禁當實測**。」
IX 卡：—。API：無（靜態）。實作接點：改檔＝`pages.tsx`、`components.tsx`。陷阱＝D-06、D-28。
驗收句：DONE＝先取得 `#spec` approved design screen/state 並通過 design gate；functional E2E 另驗狀態總表/尾註、ProvTag 與 TRUTH 一致、零 network。

spec@v1 frozen 2026-07-10

---

## §3 viewer 深規指向

`#viewer` 七區塊 IA、M4 驗收 AC-1~21、`G_<sanitized_guid>` 命名驗證、IX-3D-01~05 卡全文，見 `TARGET-viewer.md`。

---

## §4 repo 非正典頁處置

### §4.1 `#review` GPU Review Room（獨立保留頁 · plane=omni · HostTag=HOST-NATIVE）

design screen/state：`reference_missing`（`#review` 無 approved pixel baseline；legacy `review→gpu` alias 不可補位）

目標 IA：獨立 ReviewRoomPage（與 `#gpu` 永不合併）：**ReviewSessionViewerPane 以真 session attach 3D**（EmbeddedViewer postMessage bridge，不接 mock）＋**Tool Rail**（`Load / Focus / Select / Clear` 四指令；`Highlight`＝client-pull `highlightPrimsRequest`；`Section`／`Snapshot`＝待建，disabled＋`p15` 標）；每次指令留一行 trace（時間、指令、參數摘要、ack/timeout）；server-push highlight 屬 DO-NOT-RE-ADD（contracts §1）。
IX 卡：IX-3D-01~05 全文見 TARGET-viewer §6（本頁為其宿主）。
API（逐字）：review-sessions＋viewer lease（`claim/heartbeat/release/status`）＋`/ui/open?session=`；DataChannel `openStage/focusPrim/selectPrims/clearHighlight`＋`highlightPrimsRequest`（P1.5）。
實作接點：改檔＝`pages.tsx`、`coordinatorClient.ts`、`components.tsx`。陷阱＝D-01（禁 canvas 示意當 3D 交付）、D-16（browser 禁直連 governance `:49102`，一律走 `/api/governance/*` proxy；同 PROCESS §3 network 面斷言）、勿破 `/ui/open` regex（RK6，contracts §1）。
驗收句：DONE＝先取得只涵蓋 2D chrome/非動態區域的 `#review` approved screen 並通過 design gate；runtime E2E 另 attach 真 session，驗 Load/Focus/Select/Clear ack trace、Highlight 四條件 gating、Section/Snapshot disabled＋`p15`。

review@v1 frozen 2026-07-10

### §4.2 其餘 repo 非正典頁（各 2–4 行：身分＋機器真相＋收斂處置）

- `#version-diff`：VersionDiffPage 別名 route（正典＝`#a2`，規格見 §2 #a2 節）。機器真相＝`data.ts PAGES[]`。收斂處置見 BACKLOG gap-route-convergence。
- `#federation`：FederationPage 別名 route（正典＝`#a3`，規格見 §2 #a3 節）。機器真相＝`data.ts PAGES[]`。收斂處置見 BACKLOG gap-route-convergence。
- `#semantic`：SemanticViewerPage（IFC GUID⇔USD prim 對照；mapping URL raw-fetch；classification/geometry 顯 null＋`roadmap[]` 禁捏造；fake mapping 一律 DEMO banner）。非 22 條正典之一；收斂處置見 BACKLOG gap-route-convergence（proxy 遷移屬行為變更、另立 OPEN）。
- `#overview`：OverviewPage（服務邊界圖＋coordinator 路由表＋`/health` HealthChip，缺值顯「未取得」）。機器真相＝`data.ts SERVICES/ENDPOINTS`。收斂處置見 BACKLOG gap-route-convergence。
- `#apps`：AppsPage（A1–A10 卡片牆，每卡真 prov：A1–A3 導 live 頁、A4–A10 導 vision 頁，永不樣式化成 built）。收斂處置見 BACKLOG gap-route-convergence。
- `#coordinator`：CoordinatorPage（runtime 彙總 tabs；aria tablist 保留；缺值 idle「未取得」）。原型 alias `coordinator→sessions`；收斂處置見 BACKLOG gap-route-convergence。
- `#intake`：alias route（deep-link 防斷保留；IN 誠實文案落點＝ModelDataPage 的 ObjectDetailPane）。原型 alias 指 `intake→conv`；重導終點的現況查 TRUTH §7、收斂裁決見 BACKLOG gap-route-convergence。
- `#kit`：KitConsolePage（operator 工具，保留不砍；只走 `/api/kit/*` proxy、變更需 `x-dev-token`）。operator-only；收斂處置見 BACKLOG gap-route-convergence。
- `#demo-control`：RealIfcConsolePage（operator 工具，保留不砍；`/api/dev/ifc-sources`＋register→轉檔→WebRTC demo 控制；dev-gated 誠實標示）。operator-only；收斂處置見 BACKLOG gap-route-convergence。

---

檔尾：本檔 22 節＋殼層 chrome 節（§1.5）＋`#review` 節每節自帶凍結點；整檔基準＝`TARGET-shell@v1 frozen 2026-07-10`。
