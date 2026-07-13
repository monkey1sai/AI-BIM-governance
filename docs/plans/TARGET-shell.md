# TARGET-shell — 殼層 22 route 逐頁目標規格

> v1 · 2026-07-10 · AI-coding 文件體系重設計（依使用者指令，以兩份 prototype 為基準）
> 本檔回答「22 頁各要做成什麼樣」（IA、IX 卡全文、API 逐字、實作接點、驗收句、凍結點）。
> 現況（建到哪）一律查 `TRUTH.md`；跨頁不變量查 `TARGET-contracts.md`；viewer 七區塊深規查 `TARGET-viewer.md`；缺口排序與 OPEN 決策查 `BACKLOG.md`。
> 視覺樣貌真相＝`ai-bim-governance-prototype.html`（只引用、不修改；原型是樣貌真相，非程式碼範本——不抄 canvas/CDN，示意數值一律寫「示意」不當規格值）。

---

## §0 基準、凍結點規約、原型不一致裁決

### §0.1 基準與凍結點規約

- 基準宣告：`TARGET-shell@v1 frozen 2026-07-10 · 基準=prototype v2 (2026-07-02)`。
- 凍結點語法：每節末行 `<route>@v<N> frozen <date>`（可 grep）。改版＝bump 版本號＋同節加一行「作廢範圍」。
- **節進入 BACKLOG IN-PROGRESS 後規格凍結；要改＝先 bump 再動工**，禁止邊做邊改規格。

### §0.2 純潔性聲明

本檔不含任何 repo 建成宣稱（禁用樣式清單與 CI grep 見 PROCESS §6 閘 1；本檔命中數必須＝0）；「待建」是需求屬性（本規格要求新增），不受此限。建成狀態唯一落點＝`TRUTH.md`。實作接點欄的改檔清單為撰寫時點的對映；檔案實際位置以 repo 現行結構為機器真相。

### §0.3 原型內部 8 項不一致裁決（有 repo 事實直接裁；無事實進 OPEN，不偷渡）

| # | 不一致 | 裁決 |
|---|---|---|
| 1 | coordinator HostTag：`#minio` 頁標 host、其餘頁標 container | 裁＝**container**（`#minio` 頁標 host 為原型筆誤；埠表見 contracts §3） |
| 2 | A1 選檔樣式三選一（下拉 dd／級聯 cascade／樹狀 tree） | **OPEN** → BACKLOG 待人類決策；本檔 #a1 節暫錨「三式並陳為原型示意，擇一後 bump」 |
| 3 | 原型 `review→gpu` alias 僅 demo 權宜 | 裁＝正式版 `#review`＝獨立 ReviewRoomPage、`#gpu`＝GpuReviewRoomPage，**永不合併或重定向**（引 contracts §4） |
| 4 | A6 phase 矛盾（data.ts RM phase=2 vs NOT BUILT） | 裁＝以 repo prov=`p4` 為準（原型自我裁決採納） |
| 5 | governance 埠 | 全檔一致 `:49102`，無需裁；引 contracts §3 |
| 6 | conv 觸發敘事（#conv 寫「僅靠 watcher」vs #minio 有手動觸發鈕） | 裁＝**雙軌並列**：watcher 自動偵測（opt-in，預設關）＋ `#minio` 手動 `POST /api/conversion/trigger`（x-dev-token）；`#conv` 的 prioritize/retry 只對既有 job 排序／重試、不觸發新轉檔 |
| 7 | Google Fonts／unpkg CDN 外連 | 裁＝僅原型單檔便利；正式殼層無此依賴 |
| 8 | 底欄 job bar 轉檔進度與 QUEUE 數字的真資料來源 | **OPEN** → BACKLOG（與 #home 待辦真來源同組） |

### §0.4 來源計數核對（一次性宣告）

> 本節是遷移時點對舊檔（README §7 刪除清單）的清點審計紀錄；舊檔刪除後本節保留作審計軌跡，**不構成引用依賴**（原文 git history 可考，無效力）。

- IX 卡實際清點＝**30 張**：PART B 26 張（IX-A1×8、IX-CV×4、IX-SS×5、IX-KG×4、IX-3D×5）＋PART D IX-TN×4。IX-3D 五張全文落 `TARGET-viewer.md`；IX-TN 四張全文落 `TARGET-contracts.md` §12；其餘 **21 張全文載於本檔**（#a1×8、#conv×4、#sessions×5、#instances×4），零漏卡零濃縮（僅依 §0.2 純潔性剝除建成宣稱字樣，行為內容不動）。
- 手冊 §5 逐路由規格＝24 節（`#a2/#version-diff`、`#a3/#federation` 雙 route 節各計 2，共 26 條路由）落點：`#a1/#a2/#a3/#issues/#conv/#sessions/#minio/#runtime/#spec/#home/#viewer/#gpu/#instances/#a4–#a10/#reports/#admin` → 本檔 §2 各節；`#review` → §4.1 完整節；`#semantic/#overview/#apps/#coordinator/#intake/#kit/#demo-control` → §4.2。

---

## §1 路由契約引用

22 條正典路由身分表、9 個別名＋1 個獨立保留頁、四鐵則（hash 無斜線 `#a1` 非 `#/a1`；`/ui/open?session=:id` 凍結 handoff；`#gpu` 正典＋`#review` 獨立保留；路由機器真相＝`data.ts PAGES[]`＋`EdgeConsole.tsx`）一律見 **contracts §4**，本檔不重抄。

## §1.5 殼層 chrome（全站共用；22 頁之外的殼層需求）

prototype 錨：ai-bim-governance-prototype.html（全站 shell 骨架，非單頁錨）

目標 IA：
- **三欄 grid**：`50px 頂欄 / 主區 / 32px 底欄` × `240px nav / 1fr main / 380px agent rail`；`<1180px` 自動收合 agent rail；收合態（`data-agent="off"`）可由底欄重開鈕還原。
- **頂欄**：品牌區（mark＋「AI · BIM Governance」＋mono 副標）→ tenant 徽章（虛線 pill「tenant zero · 單站點現況」＋`DEMO DATA` 小標；語意引 contracts §11.3）→ 麵包屑 Pills（專案／版本／階段＋caret；真資料來源未定，接真來源前一律標示意——與 BACKLOG OPEN #2 同組）→ LangToggle（雙語 i18n 做否＝BACKLOG OPEN #3.4）→ **HealthChips 四枚**（`COORD`／`GPU`／`QUEUE`／`MCP`；缺遙測顯「未取得」＋idle LED 不偽綠；數字真資料來源＝BACKLOG OPEN #2）→ 使用者頭像。
- **Agent rail（右欄 Chat USD Agent）**：READY pill＋可關閉；紫色虛線註記「AI 只在 session layer 操作 · 不直接改 source model」（contracts §7 A9 同義）；「TOOL CALLS」軌跡列＋底部輸入框——真對話／MCP 執行建成前 input 一律 disabled、tool calls 一律標「示意，非實測」，不渲染假結果（現況查 TRUTH §3 #2）。
- **底欄 job bar**：`OMNI` 標籤＋轉檔進度列＋右側 mono 服務摘要（`coordinator :8004 · governance :49102 · MCP x/x`）；agent rail 關閉時出現「↗ Chat USD Agent」重開鈕；進度與 QUEUE 數字接真來源前一律標示意（BACKLOG OPEN #2）。
- **持久化**：localStorage 鍵 `aibim:lang`／`aibim:ec:active`／`aibim:ec:agentOpen`，refresh 不丟狀態；**cache 非 source of truth**。
- **nav 版位**：分組五組與 22 條目依 contracts §4；omni 分組綠色漸層底；nav 底部「雲地邊界」註記＋「雲端控制面：PLANNED · 未建」灰虛線 badge（contracts §11）。

驗收句：DONE＝殼層截圖含頂欄四枚 HealthChips（GPU 缺遙測顯「未取得」＋idle）、tenant 徽章虛線 PLANNED 樣式、agent rail input disabled＋tool calls「示意」標示、底欄 job bar 示意標示；切頁後 refresh 還原 `aibim:ec:active` 與 agent 開合；`<1180px` agent rail 自動收合。

shell-chrome@v1 frozen 2026-07-10

---

## §2 逐頁目標規格（22 條正典路由）

> 每節六欄固定骨架：prototype 錨／目標 IA／IX 卡／API（逐字）／實作接點／驗收句，末行凍結點。
> 六通用互動模式（模式 1 證據型更新～模式 6 空狀態）與誠實元件規範（disabled＋prov mini-tag、Panel phase 紅 hatch、DarkStage、「未取得」＋idle LED、confirm、空狀態不補假列）全文見 contracts §9，本檔以「模式 N」引用。

## #home 今天要做什麼（⌂ · 工作台 · plane=core · HostTag=CONTAINER）

prototype 錨：ai-bim-governance-prototype.html#home

目標 IA：
- ① SaaS 重定位導讀卡（NOT BUILT 樣式：虛線框＋DS `todo` 顯示標籤＋`PLANNED` 小標），三點文案：(1) 定位＝「雲端控制面＋落地端 data/GPU plane」雲地混合多租戶 SaaS（SaaS ≠ 全上雲）；(2) SaaS 能力未具 evidence 時一律 PLANNED，使用 tenant-zero 單站點 fallback；(3) 模型檔不出站：IFC/USD payload 永不上雲，雲端只收 metadata 白名單投影；拔網時落地端完全自主。尾註指向 `ai-bim-governance-saas-架構總覽.md`（PLANNED 增補層，效力低於 contracts）。
- ② 待辦 · TODO 列表：跨應用待辦彙整（A1 失敗／coverage 低／逾期工單聚合），列＝sev 色塊（err/warn/low）＋來源 Badge（A1/A3/A2）＋期限。**真資料來源未定＝OPEN**（§0.3 #8 同組，見 BACKLOG）；接真來源前一律標「示意待辦」。
- ③ 可信度圖例卡：陳列全部 Prov 顯示級別＋說明「沒有遙測就標『未取得』，不畫成綠燈」（contracts §5/§9）。

IX 卡：—（無歸屬 IX 卡）

API（逐字）：無 live API（純導覽＋demo 列）；待辦聚合端點＝待建（隨 OPEN 裁決定義）。

實作接點：改檔＝`pages.tsx`、`components.tsx`、`edge-console.css`。陷阱＝D-07（禁假按鈕）；demo 風險列必標 `prov="demo"`，無捏造計數。

驗收句：DONE＝載入 `#home` 截圖與 prototype #home 三卡對齊；SaaS 導讀卡為虛線 PLANNED 樣式；demo 區帶「示範資料」ProvTag；無資料處無綠燈；斷言零 `/api/*` 呼叫（接真來源前）。

home@v1 frozen 2026-07-10

## #a1 治理與模型檢核（A1 · 核心治理 · plane=core · HostTag=HOST-NATIVE · P0 hero）

prototype 錨：ai-bim-governance-prototype.html#a1（v2 2026-07-02）

目標 IA（5 區＋Stepper）：
- **① 選檔 · 偵測到的 IFC**（Panel，sub 直接印 API 字串）：右上雙來源切換鈕 `local_fs 檔案庫`／`MinIO bucket 偵測`；選檔樣式三式並陳（dd/cascade/tree）為原型示意，**擇一後 bump 本節**（§0.3 #2 OPEN）。選定檔案列＝LED＋完整路徑（前綴 `storage/` 或 `bim-control/`）＋大小/時間；只有 coordinator config 指定的 `local_fs` fixture 顯示 `測試資料` Badge，MinIO 來源不得僅因來源或編號被標成測試；未選時模式 6 空狀態「目前未選檔——從上方偵測結果選一個 .ifc」，不補假列。`執行規則檢核` primary 鈕（未選檔或 running 時 disabled）；running 顯進度條＋mono 註（1500ms 輪詢）。
- **② 檢核流程 Stepper**：`選檔→檢核→結果→審查→交付` 五步；右上 `重跑 · 回到選檔` ghost 鈕（全 reset）。
- **③ 記分板＋規則清單**（hint：`ifctester · IDS/YAML`）：4 MetricCards（PASSED／BLOCKED／PASS RATE／構件數；值一律來自真實 rule-run，原型數字為示意禁 hardcode）；規則清單對選定檔，列可點展開命中構件；`失敗構件轉 Issue（模式 3）` primary 鈕→confirm 條（冪等鍵 `rule_run_id+guid`，已建過會跳過）。未 scored＝模式 6 空狀態「目前沒有這個檔的 rule-run 結果…」。
- **④ BCF 審查面板**（hint：`issues API · BCF 2.1 匯出`）：ProvTag 動態（有 topics＝`asbuilt` 顯示、無 topics＝`demo` 顯示）；topic 列（掛 rule 碼＋sev Badge）＋狀態鈕循環 `OPEN→IN-PROGRESS→RESOLVED`；**assignee＝自由文字欄（O7 裁決）；欄位建成前 UI 依 contracts §9 誠實呈現（dashed 待建標，不提供假控制）**；動作列＝`匯出 BCF 2.1（.bcfzip）` primary＋`匯出 Excel` ghost；mono 註「無 viewpoint 時 BCF 內誠實缺省；BCF 3.0 為升級目標（contracts §7）」。
- **⑤ 3D 連動 · A1 連動橋**（hint：「證據由 #sessions 供應 · 只顯示不推定」）：四格證據 rail（session 派發／WebRTC 首幀／DataChannel／stage matched，唯讀）＋高亮佇列（失敗構件 GUID chips）＋`在 3D 高亮` 鍵。**高亮啟用四條件缺一不可：DataChannel ready ∧ first_frame_at ∧ stage matched ∧ usd_prim_path；viewer 回 ack 才標成功；證據單一來源＝#sessions**。此區**不內嵌 3D 視窗**。旁附 `開 Session 管理（證據來源）→` 連 `#sessions`。

IX 卡（B.1 全文）：

**狀態機（整頁一個 reducer）**
```text
states: idle → picked → running → scored → issued → delivered
事件: PICK_FILE / RUN / RUN_PROGRESS(p) / RUN_DONE(result) / RUN_FAIL(err)
      CREATE_ISSUES_OK(n) / EXPORT_OK(kind)
規則: 步驟圓點 i 的樣式 = (state 已過此步 ? 綠勾 : state 正在此步 ? 綠光圈 : 灰)
      任何步可「重跑」：回到該步 state，下游步驟清空（資料保留在歷史，不覆蓋 artifact）
```

**IX-A1-01 選檔（v2 · 雙來源）**：頁首「① 選檔 · 偵測到的 IFC」區，來源切換兩顆 pill：**local_fs 檔案庫**（`GET /api/governance/files/tree`，經 coordinator proxy，`source_kind=local_fs`）／**MinIO bucket 偵測**（coordinator `GET /api/minio/objects?prefix=&delimiter=/`，真 MinIO 唯讀逐層，只列 `.ifc`）。選檔元件三樣式（下拉 optgroup／級聯 pills／樹狀）原型供挑，**正式版擇一**；選定 → state=picked、顯示完整 key、大小、mtime；`source_kind=local_fs` 且 coordinator config 判定為 fixture 時標「**測試資料**」，MinIO 來源不自動標測試。切來源 = 回 idle（下游清空）。**選檔不觸發轉檔**：只對選定檔跑 rule-run（CPU）。前置：無。失敗：任一來源 list 失敗→模式 6（保留另一來源可用，MinIO 502 顯錯誤條不推定）。

**IX-A1-02 執行檢核**：按「執行規則檢核」→ `POST /api/governance/rule-runs {source_path, ids_path?}` → 回 `rule_run_id` → 進度輪詢 `GET /api/governance/rule-runs/:id`（1500ms）→ status=running 顯示進度條+逐條 log（若 API 提供）；done → RUN_DONE。**驗收**：跑 fixture 真檔出真分數；中途離頁再回來，輪詢自動恢復（rule_run_id 存頁面 state）。

**IX-A1-03 記分板與規則清單**：渲染 evaluated/passed/failed/score 四格；規則列**點擊展開**命中構件（`GET /api/governance/rule-runs/:id/failures?rule=`，懶載入、分頁 50 筆）；每構件顯示 ifc_guid + name + storey；guid 可複製。**驗收**：展開 71 筆失敗不卡頓；空失敗規則顯示「全過」不可展開。

**IX-A1-04 失敗轉 Issue**：勾選規則或構件 → 「失敗構件建 issue」→ 模式 3（confirm 顯示將建幾筆、指派誰）→ `POST /api/governance/issues/from-rule-run` → 成功後顯示 issue 連結。**驗收**：重複執行不產生重複 issue（後端冪等鍵 = rule_run_id+guid，前端顯示「已建過 n 筆，跳過」）。

**IX-A1-05 匯出交付**：Excel `GET .../export?fmt=excel` 直接下載；BCF `GET /api/governance/bcf/export` 下載 .bcfzip（**BCF 2.1**，無 viewpoint 時 BCF 內誠實缺省）。**v2：匯出入口移至 BCF 審查面板（IX-A1-07）footer**，API 不變。**驗收**：BIMcollab/BCF 檢視器可開。

**IX-A1-06 在 3D 高亮（P1.5——建成前 render disabled）**：啟用條件（缺一不可）：viewer DataChannel ready ∧ first_frame_at 存在 ∧ stage matched ∧ 構件有 usd_prim_path。滿足後：按下 → Review-Room 主動拉模式發 `highlightPrimsRequest {prim_paths[], color:'red'}` → viewer 回 ack 才標成功。**v2 呈現方式改為 IX-A1-08 的 A1 連動橋 rail**，啟用條件與 ack 語意不變。

**IX-A1-07 BCF 審查面板（v2 新增，對選定檔）**：位於規則清單之下。資料源 = issues API（Issue 共同出海口，A1/A2/A3/A5 共用 schema，contracts §10）：`GET /api/governance/issues?rule_run=:id` 列 topic（規則×命中構件數、severity）；狀態流轉 open→in-progress→resolved = `POST /api/governance/issues/:id/transition`（模式 3 + 證據型更新）；**指派 assignee：自由文字欄（O7 裁決）；欄位建成前 render 為 dashed 待建標，不提供假控制（建成狀態查 TRUTH）**；無 viewpoint 時誠實缺省（不假截圖）。footer：匯出 BCF 2.1（IX-A1-05）+ Excel；BCF 3.0 升級目標只引用 contracts §7，不重述。**驗收**：topic 數=失敗規則數；狀態流轉後重整頁面狀態不回退（後端回讀）；空 topic 時顯示模式 6 空狀態（「由失敗構件轉 Issue 產生」）。

**IX-A1-08 A1 連動橋（v2 新增；3D 連動留在 A1，禁用 viewer 視窗風格）**：A1 頁底部以**證據 rail** 呈現 3D 連動：四格證據（session 派發／WebRTC 首幀／DataChannel／stage matched）+ 高亮佇列（失敗構件 GUID chips）+ 高亮鍵。**不內嵌 3D 視窗、不畫斜線佔位圖**。四格證據以 `#sessions`／Runtime 監控為**單一來源**（IX-SS-05），A1 只讀鏡射、只顯示不推定；任一格未綠，高亮鍵保持 disabled（title 說明缺哪格），附「開 Session 管理 →」連結。**驗收**：證據未齊時按鍵 disabled + 原因可讀；證據全綠後才發 IX-A1-06 指令；ack 前不標成功。

API（逐字，全走 coordinator `:8004` proxy，凍結面見 contracts §1）：
- `GET /api/governance/files/tree`（local_fs 來源）
- `GET /api/minio/objects?prefix=&delimiter=/`（MinIO 來源）
- `POST /api/governance/rule-runs` → `GET /api/governance/rule-runs/:id`（1.5s 輪詢）→ `/results`、`/failures`
- `POST /api/governance/issues/from-rule-run/:runId`、`GET /api/governance/issues?rule_run=:id`、`POST /api/governance/issues/:id/transition`
- `GET /api/governance/rule-runs/:id/export?fmt=excel`（Excel；`fmt=bcf` → 400，contracts §1）
- `GET /api/governance/bcf/export`（BCF 2.1 `.bcfzip`；兩步 gating 見 contracts §1）
- `GET /api/runtime/status`（連動橋鏡射用）；viewer DataChannel `highlightPrimsRequest`（P1.5，待建）

實作接點：改檔＝`pages.tsx`、`a1Machine.ts`、`components.tsx`（SourcePicker／BcfReviewPanel／A1BridgeRail）、`EmbeddedViewer.tsx`、`governanceClient.ts`、`coordinatorClient.ts`。陷阱＝D-31（雙來源一邊壞只降該邊，禁默默換來源）、D-32（BCF 面板禁假指派控制）、D-33（連動橋禁自行推定證據）、D-08（禁樂觀更新）、D-20（高亮四條件缺一即 disabled）。

驗收句：DONE＝branch-isolated stack 下：① 雙來源各自列出真檔（MinIO 邊斷線時只該邊降破）；② 選檔→真 IFC rule-run 截圖 live 數、Stepper 隨狀態機推進；③ topic 狀態流轉後重整不回退；④ 連動橋四格與 `#sessions` 同輪詢一致、證據未齊高亮鍵 disabled；⑤ network 面只打 `/api/governance/*`＋`/api/minio/objects`＋`/api/runtime/status`；截圖與 prototype #a1 五區對齊。

a1@v1 frozen 2026-07-10

## #a2 版本差異與責任（A2 · 核心治理 · plane=core · HostTag=HOST-NATIVE）

prototype 錨：ai-bim-governance-prototype.html#a2

目標 IA：
- ① 選擇版本 Panel（右上 `v06`→`v07` Badge；3 MetricCards `加/改/刪`，值來自真實 `DiffResult.summary.counts`，原型數字為示意）。
- ② 變更清單（hint `diff_engine · GlobalId 多級鍵 ledger（語意對齊 ifcdiff）`）雙欄＝Diff 列表（每筆 ADD/MOD/DEL 三色碼＋作者＋日期，可點選）＋責任 Panel（選中項的改動者/時間/原因＋`飛到此構件 →` ghost 鈕）。
- `轉變更為 Issue` primary（共用 Issue 出海口 schema，contracts §10）、`匯出變更報表` ghost。
- **邊界：成本影響屬 A9 範疇，A2 頁禁出現成本塊**。geometry 比對＝opt-in。
- 3D 著色（apply-overlay）：後端語意＝**by design 501**（contracts §1），前端維持 `p15` 誠實標記＋client `highlightPrimsRequest` 路線，不當缺功能補。

IX 卡：—（diff 高亮共用指令族見 TARGET-viewer IX-3D-05）

API（逐字）：`GET /api/governance/files/tree`、`POST /api/governance/diffs`、`GET /api/governance/diffs/:id`、`GET .../items`、`GET .../issue-impact`、`POST /api/governance/issues/from-diff/:diffId`；`POST .../apply-overlay`（501 by design，維持 `p15`）。`change_type` enum（added/removed/moved/geometry_changed/property_changed）逐字 echo（contracts §2）。

實作接點：改檔＝`pages.tsx`、`components.tsx`、`governanceClient.ts`。陷阱＝D-11（diff 引擎＝R2 簽核之自製多級鍵引擎、語意對齊 ifcdiff，禁選型漂移，見 contracts §7）、D-08；三色 `ec-diff-add/del/mod` 對 token 不硬編色值。

驗收句：DONE＝建一筆 diff，截圖三色清單＋MetricCard 來自真實 counts；斷言 apply-overlay 顯示 `p15` 誠實標記而非可用按鈕；`usd_prim_path` 為 null 時留空不捏造；頁內 grep 無成本塊；與 prototype #a2 版面對齊。

作廢範圍（v1→v2）：v1 的 hint 與陷阱欄原載「ifcdiff · 禁自寫比對」抵觸 2026-07-10 R2 使用者簽核裁決（A2 現行採簽核之自製多級鍵引擎，語意對齊 ifcdiff）；v2 依 R2 更正。

a2@v2 frozen 2026-07-13

## #a3 跨專業疊合（A3 · 核心治理 · plane=core · HostTag=HOST-NATIVE）

prototype 錨：ai-bim-governance-prototype.html#a3

目標 IA（雙欄）：
- 左：**聯邦疊合視窗**：4 個 layer 開關 chips（建築 green／結構 cyan／機電 violet／水電 amber；預設 plumb 關）；DarkStage「USD sublayer 聯邦已掛載 · 需 GPU session 呈現」；`重建聯邦 stage` primary 鈕（federation build 流程：建 set→加 members→validate-coords→build）；`GPU 開 review-room 預覽 ↗` 連結 → `/ui/open?session=`（凍結 handoff，contracts §4）。
- 右：**碰撞偵測 · Clash**（Panel phase 紅 hatch）：**此處不顯示任何碰撞數量**；`碰撞數 = 未取得（NOT BUILT）` idle LED 行；`重跑碰撞檢測（待建）` disabled＋DS `todo` 顯示標籤（repo Prov 值用 `p4`，禁 `prov="todo"`，contracts §5）。選型＝ifcclash（官方對齊，contracts §7）；實作時以 runtime probe 判定幾何能力，引擎不可用必走 `has_occ`／probe hard guard，禁靜默回 0。
- 空 seeded `usd_path` 呈現為「需操作員填入」的誠實提示；build 409/400 錯誤用 IntentDialog 顯示；**不捏 `stage_url`**。

IX 卡：—（review-room handoff 行為見 TARGET-viewer IX-3D-01）

API（逐字）：`POST /api/governance/federated-sets`、`POST .../members`、`GET .../:setId`、`POST .../validate-coords`、`POST .../build`、`GET .../review-room`；`/ui/open?session=` handoff。clash 端點＝待建；O6 已裁決使用 ifcclash，完整 API 與 unavailable guard 依核准的 Spec-3/plan。

實作接點：改檔＝`pages.tsx`、`components.tsx`、`IntentDialog.tsx`、`governanceClient.ts`。陷阱＝D-27（runtime probe 不可用時 clash 必加 hard guard，顯示機器可讀原因而非 0 碰撞）、D-14（AI/標記只寫 session layer）。

驗收句：DONE＝建 set→加 2 members→validate-coords→build→開 review-room descriptor 截圖；<2 members 的 build 在 IntentDialog 顯誠實 400；clash 區零假數、disabled 鈕帶待建標；與 prototype #a3 雙欄對齊。

a3@v1 frozen 2026-07-10

## #a4 語意搜尋問答（A4 · 核心治理 · plane=core · HostTag=HOST-NATIVE · NOT BUILT 佔位頁）

prototype 錨：ai-bim-governance-prototype.html#a4

目標 IA：單一 Panel phase（紅 hatch）：搜尋框與按鈕一律 disabled（placeholder 示範問句），**不接任何 mock，不渲染假結果**；prov=`p4`。願景敘事不寫入本檔（機器真相＝`data.ts A1A10_DETAIL`）。
IX 卡：—。API：`/api/search/model`＝待建（不存在前零 `/api/*` 呼叫）。
實作接點：改檔＝`pages.tsx`、`components.tsx`、`data.ts`。陷阱＝D-07、D-28。
驗收句：DONE＝載入 `#a4` 斷言 phase Panel＋全控制 disabled＋`p4` 標＋零 network 呼叫。

a4@v1 frozen 2026-07-10

## #a5 IoT / FM 數位分身（A5 · 核心治理 · plane=core · HostTag=HOST-NATIVE · NOT BUILT 佔位頁）

prototype 錨：ai-bim-governance-prototype.html#a5

目標 IA：雙欄。左＝感測點示意 Panel phase，感測 demo 點一律標「**示範資料 · MQTT 待接**」浮水印；右＝選中感測器 detail（MetricCard note 標示範資料）＋`開維保工單（待 MQTT）` disabled；prov=`p3`。不接任何真資料流。
IX 卡：—。API：MQTT broker／TimescaleDB＝待接（零 `/api/*` 呼叫）。
實作接點：改檔＝`pages.tsx`、`components.tsx`、`data.ts`。陷阱＝D-07、D-28。
驗收句：DONE＝載入 `#a5` 斷言感測點標「示範資料」、控制 disabled＋`p3` 標、零 network 呼叫。

a5@v1 frozen 2026-07-10

## #a6 4D / 5D 施工模擬（A6 · OMNIVERSE RUNTIME · plane=omni · HostTag=HOST-NATIVE · NOT BUILT 佔位頁）

prototype 錨：ai-bim-governance-prototype.html#a6

目標 IA：紫色「願景情境 VISION」橫幅（所有控制 disabled、不接 mock、需 GPU · Omniverse runtime 串接後升級）＋DarkStage（glyph ▤，`Runtime = no`）＋`啟動模擬（待建）` disabled；狀態以 repo prov=`p4` 為準（§0.3 #4 裁決）。
IX 卡：—。API：無（零呼叫）。實作接點：改檔＝`pages.tsx`、`components.tsx`、`data.ts`。陷阱＝D-07、D-28。
驗收句：DONE＝載入 `#a6` 斷言 VISION 橫幅＋DarkStage＋disabled＋`p4`＋零 network。

a6@v1 frozen 2026-07-10

## #a7 Reality Capture 比對（A7 · OMNIVERSE RUNTIME · plane=omni · HostTag=HOST-NATIVE · NOT BUILT 佔位頁）

prototype 錨：ai-bim-governance-prototype.html#a7

目標 IA：同 #a6 共版（glyph ◫）；特註「需 usd-code-mcp 驗 mesh-compare＝先驗再寫」（contracts §7）。prov=`p4`。
IX 卡：—。API：無。實作接點：同 #a6。陷阱＝D-07、D-28。
驗收句：DONE＝同 #a6 斷言組（glyph 換 ◫）。

a7@v1 frozen 2026-07-10

## #a8 Synthetic Data（A8 · OMNIVERSE RUNTIME · plane=omni · HostTag=HOST-NATIVE · NOT BUILT 佔位頁）

prototype 錨：ai-bim-governance-prototype.html#a8

目標 IA：同 #a6 共版（glyph ⊞）；特註「需對齊 Omniverse Replicator（先驗再寫）」（contracts §7）。prov=`p4`。
IX 卡：—。API：無。實作接點：同 #a6。陷阱＝D-07、D-28。
驗收句：DONE＝同 #a6 斷言組（glyph 換 ⊞）。

a8@v1 frozen 2026-07-10

## #a9 設計／審查 Copilot（A9 · OMNIVERSE RUNTIME · plane=omni · HostTag=HOST-NATIVE · NOT BUILT 佔位頁）

prototype 錨：ai-bim-governance-prototype.html#a9

目標 IA：同 #a6 共版（glyph ✦）；特註「復用 ChatToolCall，只在 session layer（非 3D 場景）」；ChatUSD rail 標 `ROADMAP · A9`、input disabled、無假 tool call。prov=`p4`。
IX 卡：—。API：無。實作接點：同 #a6。陷阱＝D-07、D-14、D-28。
驗收句：DONE＝同 #a6 斷言組＋ChatUSD rail input disabled。

a9@v1 frozen 2026-07-10

## #a10 機器人／巡檢模擬（A10 · OMNIVERSE RUNTIME · plane=omni · HostTag=HOST-NATIVE · NOT BUILT 佔位頁）

prototype 錨：ai-bim-governance-prototype.html#a10

目標 IA：同 #a6 共版（glyph ⊿）；特註「Isaac-sim adjacent，先驗再宣稱」（contracts §7）。prov=`p4`。
IX 卡：—。API：無。實作接點：同 #a6。陷阱＝D-07、D-28。
驗收句：DONE＝同 #a6 斷言組（glyph 換 ⊿）。

a10@v1 frozen 2026-07-10

## #issues Issue / BCF（BC · 核心治理 · plane=core · HostTag=HOST-NATIVE）

prototype 錨：ai-bim-governance-prototype.html#issues

目標 IA：
- **Issue 列表** Panel：Issue 由 A1/A2/A3 檢核轉入（共同出海口 schema，contracts §10；`source` 欄標來源）；列＝ID＋標題＋sev＋來源 Badge；status Badge 逐字 echo 生命週期 enum（open/assigned/in_progress/resolved/rejected/reopened，contracts §2）；transition 走 IntentDialog（模式 3）。
- `匯出 BCF 2.1` primary 鈕；**BCF gating 誠實兩步**：先有 `from-rule-run`／`from-diff` issue 才可匯出（contracts §1）；rule-run export 只支援 `?fmt=excel`，BCF 為獨立 endpoint。
- 「在 3D 標示」建成前 disabled＋`p1` 標。

IX 卡：—（無歸屬 IX 卡；A1 的 BCF 面板行為見 IX-A1-07）

API（逐字）：`GET /api/governance/issues`（list）、`POST /api/governance/issues/:id/transition`、`POST /api/governance/issues/from-rule-run/:runId`、`GET /api/governance/rule-runs/:id/export?fmt=excel`、`GET /api/governance/bcf/export`。

實作接點：改檔＝`pages.tsx`、`components.tsx`、`IntentDialog.tsx`、`governanceClient.ts`。陷阱＝D-04（BCF 版本字串集中一處常數，UI 顯 `BCF 2.1`）、D-12（禁 A1Issue/A2Issue 獨立型別）、D-10。

驗收句：DONE＝rule-run→from failures 建 issues→transition 一張→匯 BCF；斷言 BCF 按鈕在無 issue 前 gated、status Badge 對 enum 逐字、network 只打 `/api/governance/*`；與 prototype #issues 對齊。

issues@v1 frozen 2026-07-10

## #reports 報表中心（RP · 核心治理 · plane=core · HostTag=HOST-NATIVE）

prototype 錨：ai-bim-governance-prototype.html#reports

目標 IA：**可用報表** Panel 兩列呈現規格——列 1＝`A1 檢核結果 Excel 匯出`（ok LED＋`匯出` ghost 鈕，指向 IX-A1-05 同一 API）；列 2＝`中心化報表彙整（待建）`（idle LED、opacity 降、`待建` disabled＋待建標）。中心化彙整（mapping coverage 報表、review package）建成前一律 disabled 待建列，禁暗示功能性報表。
IX 卡：—。API（逐字）：`GET /api/governance/rule-runs/:id/export?fmt=excel`；中心化彙整端點＝待建。
實作接點：改檔＝`pages.tsx`。陷阱＝D-07、D-25（coverage 數字不可當品質宣稱）。
驗收句：DONE＝載入 `#reports` 斷言兩列（可用列可匯出、待建列 disabled＋prov 標）；與 prototype #reports 對齊。

reports@v1 frozen 2026-07-10

## #viewer 3D Viewer 呈現（3D · OMNIVERSE RUNTIME · plane=omni · HostTag=HOST-NATIVE）

prototype 錨：ai-bim-governance-prototype.html#viewer

定位句：把 GPU 算好的模型 WebRTC 串到瀏覽器（M4 目標）；console 本頁不內嵌 3D，首幀前＝暗 stage＋斜線佔位，不偽造 matched 影像。
目標 IA：`Card_DarkCTA` 雙欄——左＝DarkStage（glyph ◳）＋全寬 `GPU 開啟主畫面預覽 · Primary + Spectator ↗` CTA → `/ui/open?session=`（凍結 handoff）；右＝需求規格 Panel 四條 bullets：
1. 一個 session 一位主控（Primary）驅動相機與 DataChannel；
2. N 位旁觀（Spectator）收同一串流，只能舉手／留言；
3. 標記、剖切只寫 USD session layer，永不改 source model；
4. **首幀指標由 WebRTC track 事件驅動，未取得不可標綠**。
API（逐字）：`GET /api/runtime/status`（first_frame 讀值）；`/ui/open?session=`。
驗收句：DONE＝無 active session 時 first-frame 列顯 idle「未取得」（無假綠）；CTA 導向 `/ui/open?session=<id>`。
深規（七區塊 IA、AC-1~21、IX-3D 卡族）一律見 **TARGET-viewer.md**。

viewer@v1 frozen 2026-07-10

## #gpu GPU 審查室（01 · OMNIVERSE RUNTIME · plane=omni · HostTag=HOST-NATIVE · MVP）

prototype 錨：ai-bim-governance-prototype.html#gpu

目標 IA：`Card_DarkCTA` 語意同 #viewer（多人同看同一視角：主控驅動、旁觀跟隨；首幀前不偽造 matched 影像）；bridge 步驟（建立 session→派發 endpoint→首幀→DataChannel）以 Stepper 呈現；CTA 走 `openInViewerUrl` → `/ui/open?session=`（不得改 redirect target／session-id regex，contracts §1）；console 內無 WebRTC 影片（僅 link-out）。
**`#review` 獨立頁裁決見 §0.3 #3：`#gpu` 與 `#review` 為兩個獨立元件/route，永不合併或重定向。**
IX 卡：—。API（逐字）：`/ui/open?session=`（經 `coordinatorClient.openInViewerUrl`）。
實作接點：改檔＝`pages.tsx`、`coordinatorClient.ts`、`components.tsx`。陷阱＝D-01（禁 canvas 示意當 3D 交付）、D-17（禁宣稱無縫遷移，contracts §6）。
驗收句：DONE＝點「開啟主畫面預覽」斷言導向 `/ui/open?session=<id>`、console 內無影片；Stepper 渲染 bridge 步驟；highlight/section/snapshot 建成前 `p15` disabled。

gpu@v1 frozen 2026-07-10

## #conv IFC→USD 轉檔排程（CV · 落地端控制台 · plane=core · HostTag=CONTAINER · P1）

prototype 錨：ai-bim-governance-prototype.html#conv

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

驗收句：DONE＝載入 `#conv` 截圖 job 表＋coverage note＋GPU 卡「未取得」；toggle watch 斷言 `PUT /api/conversion/watch` payload 回 status；轉檔歷史清單渲染自 `/api/dev/conversions` 且逐列 status enum 逐字；無直連 `:49101`；與 prototype #conv 三區對齊。

作廢範圍（v1→v2）：v1 節首 HostTag=HOST-NATIVE 抵觸 §0.3 #1 裁決（coordinator HostTag 裁＝container）；v1 實作接點頁名 `ConversionSchedulingPage` 為 stale 對映、且把 alias 現況寫在本檔而非引 TRUTH。v2 改標 CONTAINER、落點改依 repo 現行 `modelData/` 結構、現況一律引 TRUTH §1 `conv` 列。

conv@v2 frozen 2026-07-10

## #sessions Session 管理（SS · 落地端控制台 · plane=core · HostTag=CONTAINER · hero）

prototype 錨：ai-bim-governance-prototype.html#sessions（v2 2026-07-02）

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

驗收句：DONE＝載入 `#sessions` 經 IntentDialog 結束一筆 active session，斷言 `POST .../:id/close` 帶 reason、列轉灰 60s；`強制釋放` 維持 disabled＋待建標；證據三欄缺值顯「未取得」＋idle；連動橋證據與 `#a1` rail 同輪詢一致、關 session 後 A1 rail 同步回 idle；站點連線條為虛線 PLANNED 樣式；與 prototype #sessions 三區對齊。

作廢範圍（v1→v2）：v1 的 status Badge enum「queued/active/closing/closed」誤植——repo 無 session status=`queued`，且漏列 `created`/`failed`；v2 起以 coordinator `types.ts` `SessionStatus`（created/active/closing/closed/failed）逐字為準。

sessions@v2 frozen 2026-07-10

## #instances Kit / GPU 機隊（KG · 落地端控制台 · plane=omni · HostTag=HOST-NATIVE）

prototype 錨：ai-bim-governance-prototype.html#instances

目標 IA：**Kit 實例** Panel（監看）：列＝instance id＋用途（串流·審查室／待命）＋LED＋GPU 型號＋`util=未取得`（真遙測未接一律「未取得」＋idle，絕不偽綠）；`KitInstance.status` enum 逐字 echo（contracts §2）。**GPU 鐵律引 contracts §6**：1 GPU＝1 Kit instance＝1 stream；換 GPU＝terminate＋recreate（約 30–40 秒）；無 live migration；spectator 共看不另吃 GPU。真遙測未接前節點快照一律標 `demo`（DEMO DATA），與 Fleet-model 設計區分開呈現。

IX 卡（B.4 全文）：

**IX-KG-01 節點卡輪詢**：接 kit-manager-api 真遙測（建成狀態查 TRUTH）；真遙測未接前一律渲染示範資料並標 `demo`，不接假 API。
**IX-KG-02 拖 session 到他節點 = 重啟搬移**：模式 5 + 3。規則函式：target.drain→拒「節點排空中」；target 已有 stream→拒「1 GPU = 1 stream」；confirm 文案含 30–40s/重載 stage/斷線；確認 → `POST /api/fleet/move-intent {session_id, target_node, reason}` → 目標節點顯示「啟動中…%」（輪詢），完成才在新節點顯示 session。
**IX-KG-03 drain/恢復**：模式 3 → `POST /api/fleet/nodes/:id/drain {on}`；drain 中節點卡片左緣琥珀條、不可成為 drop 目標。
**IX-KG-04 指派待排程 session**：把 pending 卡拖到 idle 節點 → confirm →`POST /api/fleet/assign-intent`。
（以上 fleet intent API＝**待建**；UI 先實作互動骨架，按鈕 disabled＋待建徽章，**拖放規則函式先寫並單元測試**。）

API（逐字）：`GET /api/runtime/status`、`GET /api/kit/instances/current`（經 `/api/kit/*` proxy，禁直連 `:8010`）；`POST /api/fleet/move-intent`、`POST /api/fleet/nodes/:id/drain`、`POST /api/fleet/assign-intent`（皆**待建**）。

實作接點：改檔＝`pages.tsx`、`components.tsx`。陷阱＝D-17（confirm 文案含重啟搬移＋約 30–40 秒；UI/API 不出現 live migration）、D-22（drop 後彈 IntentDialog，禁直接改前端狀態）、D-07。

驗收句：DONE＝載入 `#instances` 斷言 util 欄顯「未取得」＋idle（無假綠 metric）、demo 快照帶 `demo` ProvTag 且無 network 取它、fleet intent 鈕 disabled＋待建標；拖放規則函式單測綠；與 prototype #instances 對齊。

instances@v1 frozen 2026-07-10

## #minio MinIO 資料（M · 落地端控制台 · plane=core · HostTag=CONTAINER）

prototype 錨：ai-bim-governance-prototype.html#minio

目標 IA：
- ① **真 MinIO 逐層瀏覽** Panel（唯讀 raw-folder，S3 `Delimiter='/'` 語意，像 MinIO 網頁一樣逐層點開）：mono 註 `GET /api/minio/objects?prefix=&delimiter=/ · folders[]=CommonPrefixes · objects[]=當層直屬檔`；點資料夾以該 prefix 重打 list 進下一層（**lazy drill-down**）；**導到含 model.ifc 的葉層**時掛「專案(中文)/種類/版本」語意 badge（`deriveIntakeFromKey`，≥3 段）＋**ledger 衍生狀態 chip**（ready/detected/queued/converting/failed/未轉）；**無 ledger 紀錄誠實標「未轉（含 baseline）」＋提供一鍵觸發轉檔鈕**；資料夾節點**不顯示寫死物件數**（CommonPrefix 不含其下數量）；末層（如 geometries_chunks）摺成單一資料夾不攤開；排序 `localeCompare('zh-TW')`。
- ② **bucket 規約 Panel**（語意參照 · demo 標示）：`bucket bim-control`；key 結構 `專案中文 / …動態層 / 種類(倒數二) / 版本(末) / model.ifc`；`watcher: segments.length < 3 擋 · 中文資料夾 → mv_<hash8>`。此三層規約是 watcher 的解析語意（供對照葉層 badge），**非樹骨架**；真實 endpoint 由部署區 `.env` 注入，不在程式碼硬編碼。
- 定位聲明：本頁為**唯讀 intake 來源視圖，非 metadata 權威**（權威＝bim-control · MySQL，contracts §10）。轉檔觸發雙軌見 §0.3 #6。

IX 卡：—（轉檔佇列行為屬 #conv 的 IX-CV 族）

API（逐字）：`GET /api/minio/objects?prefix=&delimiter=/`、`GET /api/conversion/records`（ledger chip）、`POST /api/conversion/trigger`（一鍵觸發，**x-dev-token**）、`GET /api/minio/events`（SSE，樹即時更新）。

實作接點：改檔＝`pages.tsx`、`governanceClient.ts`、`components.tsx`（實際落點以 repo 現行 `modelData/` 結構為機器真相）。陷阱＝D-26（runtime env 走 compose 透傳）、D-21（空層顯「目前沒有 X＋下一步」，404/501 顯待建徽章非錯誤）。

驗收句：DONE＝載入 `#minio` 逐層點入真 bucket 至含 model.ifc 葉層，截圖語意 badge＋ledger chip；無紀錄檔標「未轉」且一鍵觸發鈕可見；資料夾無寫死物件數；bucket 規約 Panel 帶 demo 標；network 只打 `/api/minio/*`＋`/api/conversion/*`；與 prototype #minio 兩區對齊。

作廢範圍（v1→v2）：v1 節首 HostTag=HOST-NATIVE 為原型筆誤原樣凍入，抵觸本檔 §0.3 #1 裁決（coordinator HostTag 裁＝container；本頁資料面全走 coordinator :8004 proxy）。v2 改標 CONTAINER。

minio@v2 frozen 2026-07-10

## #runtime Runtime 監控（RT · SYSTEM · plane=core · HostTag=HOST-NATIVE）

prototype 錨：ai-bim-governance-prototype.html#runtime

目標 IA：4 MetricCards：`KIT 實例`（真值）、`活躍 SESSION`（真值）、`GPU 使用率`（**遙測未接＝「未取得」＋note「遙測待接 · idle」，不畫假綠燈、不捏 GPU 數字**）、`控制面`（health 真值）。無操作鈕（純監看）。streamConfig 欄當 session 回報（CAM/CODEC/LATENCY 有值才顯，FPS 缺值顯「未取得」）。
IX 卡：—。API（逐字）：`GET /api/runtime/status`、`GET /api/review-sessions/:id/stream-config`。
實作接點：改檔＝`pages.tsx`、`coordinatorClient.ts`、`components.tsx`。陷阱＝D-06（provenance 不硬編前端）、D-09。
驗收句：DONE＝載入 `#runtime` 斷言 GPU/VRAM/FPS 顯「未取得」（無假綠）；network 只打 runtimeStatus＋streamConfig；與 prototype #runtime 四卡對齊。

runtime@v1 frozen 2026-07-10

## #admin 系統管理（SY · SYSTEM · plane=core · HostTag=CONTAINER · NOT BUILT stub）

prototype 錨：ai-bim-governance-prototype.html#admin

目標 IA：**系統設定** Panel phase（紅 hatch）：說明「此頁為 stub，介面先佔位。所有設定控制 disabled，不接任何 mock」；`使用者管理（待建）`、`部署設定（待建）` 兩枚 disabled＋待建標（repo prov=`p1`）。
IX 卡：—。API：無（零 `/api/*` 呼叫）。實作接點：改檔＝`pages.tsx`。陷阱＝D-07。
驗收句：DONE＝載入 `#admin` 斷言全控制 disabled＋`p1`、零 network。

admin@v1 frozen 2026-07-10

## #spec 設計規格說明（▦ · SYSTEM · plane=core · HostTag=CONTAINER · 文件頁）

prototype 錨：ai-bim-governance-prototype.html#spec

目標 IA：**A1–A10 狀態總表** Panel（2 欄 grid，每格名稱＋ProvTag）——**狀態值動態取自 TRUTH 語意（不在本檔或頁面硬編建成狀態）**；repo boundary contract 對照列（Panel＋Field 靜態呈現）。尾註（mono）：「scenario 數字（『312 扇門』『17000 frames』）一律願景敘事，**禁當實測**。」
IX 卡：—。API：無（靜態）。實作接點：改檔＝`pages.tsx`、`components.tsx`。陷阱＝D-06、D-28。
驗收句：DONE＝載入 `#spec` 截圖狀態總表與尾註；狀態格 ProvTag 與 TRUTH 對應列一致；無 network。

spec@v1 frozen 2026-07-10

---

## §3 viewer 深規指向

`#viewer` 七區塊 IA、M4 驗收 AC-1~21、`G_<sanitized_guid>` 命名驗證、IX-3D-01~05 卡全文，見 `TARGET-viewer.md`。

---

## §4 repo 非正典頁處置

### §4.1 `#review` GPU Review Room（獨立保留頁 · plane=omni · HostTag=HOST-NATIVE）

prototype 錨：無獨立原型頁（原型 `review→gpu` alias 僅 demo；裁決見 §0.3 #3）

目標 IA：獨立 ReviewRoomPage（與 `#gpu` 永不合併）：**ReviewSessionViewerPane 以真 session attach 3D**（EmbeddedViewer postMessage bridge，不接 mock）＋**Tool Rail**（`Load / Focus / Select / Clear` 四指令；`Highlight`＝client-pull `highlightPrimsRequest`；`Section`／`Snapshot`＝待建，disabled＋`p15` 標）；每次指令留一行 trace（時間、指令、參數摘要、ack/timeout）；server-push highlight 屬 DO-NOT-RE-ADD（contracts §1）。
IX 卡：IX-3D-01~05 全文見 TARGET-viewer §6（本頁為其宿主）。
API（逐字）：review-sessions＋viewer lease（`claim/heartbeat/release/status`）＋`/ui/open?session=`；DataChannel `openStage/focusPrim/selectPrims/clearHighlight`＋`highlightPrimsRequest`（P1.5）。
實作接點：改檔＝`pages.tsx`、`coordinatorClient.ts`、`components.tsx`。陷阱＝D-01（禁 canvas 示意當 3D 交付）、D-16（browser 禁直連 governance `:49102`，一律走 `/api/governance/*` proxy；同 PROCESS §3 network 面斷言）、勿破 `/ui/open` regex（RK6，contracts §1）。
驗收句：DONE＝attach 一筆真 session 後 Load/Focus/Select/Clear 有 ack trace；Highlight 依四條件 gating；Section/Snapshot disabled＋`p15`。

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
