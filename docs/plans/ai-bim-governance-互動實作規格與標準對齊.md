# AI-BIM-Governance — 前端互動實作規格 · 實測差距報告 · 官方標準對齊

> 版本：v1 · 2026-06-11 · 放置位置：`docs/plans/`（與 README、v2 規格、v3 計畫並列）
> 本檔解決三個問題：
> **(1)** AI 看 HTML 原型學不會「互動怎麼做」→ PART B 把每個互動寫成可照做的「行為合約」
> **(2)** 實作與 demo 差距 → PART A 是 2026-06-11 對 `http://localhost:8004/ui` 的逐頁實測比對
> **(3)** 3D Viewer 如何發揮 Omniverse Kit 最大價值（含長期維運）→ PART C 對齊官方標準
>
> **效力順序**：本檔 PART B/C 的行為與標準 > 兩份 .html 原型的視覺示意。原型管「長相」，本檔管「行為」。
> **實作紀律 / 技術債防線**：本檔的行為合約如何「不欠技術債、精準落地與驗收」，另見 `ai-bim-governance-實作紀律與技術債防線.md`（HOW 補充層，每輪交付前逐條核對；它不改本檔需求，與本檔衝突時以本檔為準）。

---

# PART A · 實測差距報告（2026-06-11 逐頁比對）

## A.0 總評（先說好消息）

實作方向**正確**，而且最重要的「誠實文化」已經真的落地：每個能力都掛 provenance 徽章、沒做的功能不放假按鈕、A1 規則引擎是真的（真 IFC、真分數、真匯出）。實作甚至超出原型：多了五步管線（Intake→Convert→Meeting→Mark→Record）、用語切換（操作員/技術）、Review Room、Model Intake 等頁。

差距主要在三類：**(a)** 原型會動的互動（拖曳、即時跳動、點擊展開）實作多為唯讀陳列；**(b)** 控制動作（插隊/重試/釋放/drain/move）後端 intent endpoint 未建；**(c)** 我們的文件有幾處已過時，反而會誤導 AI（見 A.3 勘誤）。

> 補：本案有**兩份**原型——殼層原型 `ai-bim-governance-prototype.html`（本 PART A 逐頁比對對象）與 **3D 驗收示意原型 `ai-bim-geo-viewer-prototype.html`**（對應 `#viewer`、M4 完成後的 IFC→USD 語意驗證：七區塊、`G_<sanitized_guid>` 命名、自寫 canvas 非真 WebRTC）。後者驗收語意見 §B.5 IX-3D。

## A.1 路由對照（原型 ↔ 實際）

| 原型頁 | 文件寫的 route | **實際 hash** | 實測狀態 |
|---|---|---|---|
| 今天要做什麼 | `/ui` | `#home` | 🟢 已實作（Smart Todo + Recent Risk） |
| A1 治理檢核 | `#/a1` | **`#a1`** | 🟢 五步版型＋真規則引擎（詳 A.2） |
| 3D Viewer 呈現 | `#/viewer` | `#viewer` | 🟢 證據面板版（不內嵌 3D，正確設計） |
| 轉檔排程 | `#/conv` | `#conv` | 🟡 讀真 ifc-ready jobs；控制動作待建 |
| Session 管理 | `#/sessions` | `#sessions` | 🟡 Phase 1 read-only；occupied 證據鏈待建 |
| Kit/GPU 機隊 | `#/instances` | `#instances` | 🟡 fleet 模型正確；節點遙測為示範資料 |
| MinIO 資料 | `#/minio` | `#minio` | 🟢 真檔案樹（local_fs；詳 A.2） |
| —（實作新增）| — | `#gpu` `#review` | Review Room（G）：viewer 入口導引 + Tool Rail |
| —（實作新增）| — | Model Intake / Coordinator Console / Overview / Applications 等 | 原型沒有的頁，方向合理 |

**規則：文件一律改用 `#a1` 式 hash（無斜線）。**

### A.1.1 正典路由表（唯一事實來源 · 22 條 · 對齊上傳原型導航）

> 全 repo 路由的唯一事實來源；README / 設計 / 開發三份文件一律「指向本表」，不再各自維護。hash 一律無斜線。狀態以 origin/main #224（2026-06-17）實測為準。
> **命名收斂裁定**：GPU 審查室正典 route ＝ **`#gpu`**，**`#review` 為別名**（既有連結不破）。`#admin` 維持 **待建**。

| 碼 | route | UI 頁名 | 群組 | 後端 / 服務 | 狀態 |
|---|---|---|---|---|---|
| ⌂ | `#home` | 今天要做什麼 | 工作台 | coordinator（彙整） | 🟢 版型+入口；跨應用待辦待接真來源 |
| A1 | `#a1` | 治理與模型檢核（P0） | 核心治理 | governance-service rule_engine（經 proxy） | 🟢 真規則/Issue/Excel/BCF2.1；五步串接、點規則展開、3D 高亮 P1.5 待建 |
| A2 | `#a2` | 版本差異與責任 | 核心治理 | governance-service diff_engine（GlobalId 鍵） | 🟡 示範頁；對齊官方 ifcdiff |
| A3 | `#a3` | 跨專業疊合 | 核心治理 | Kit clash（GPU） | 🟡 示範頁；核心舞台需 GPU |
| A4 | `#a4` | 語意搜尋問答 | 核心治理 | search microservice | 🟡 示範頁；選用疊加 |
| A5 | `#a5` | IoT / FM 數位分身 | 核心治理 | MQTT（規劃） | 🟡 示範頁；核心舞台需 GPU |
| BC | `#issues` | Issue / BCF 中心 | 核心治理 | governance-service issues + bcf | 🟢 Issue DB + BCF 2.1 真匯出 |
| RP | `#reports` | 報表中心 | 核心治理 | governance-service excel_export | 🟡 報表骨架 |
| 3D | `#viewer` | 3D Viewer 呈現 | 核心治理 | 證據面板（不內嵌 3D）；3D 來自 streaming-server WebRTC | 🟡 證據矩陣版；openStage/focusPrim/selectPrims 真，highlightPrimsRequest P1.5 |
| 01 | `#gpu`（別名 `#review`） | GPU 審查室 / Review Room（MVP） | 核心治理 | coordinator `/ui/open` redirect → web-viewer + streaming-server | 🟡 v1＝導引既有 viewer + Tool Rail |
| A6 | `#a6` | 4D / 5D 施工模擬 | 核心治理 | USD timeSamples（GPU） | 🟡 示範頁；核心舞台需 GPU |
| A7 | `#a7` | Reality Capture 比對 | 核心治理 | point cloud（GPU） | 🟡 示範頁；核心舞台需 GPU |
| A8 | `#a8` | Synthetic Data | 核心治理 | Replicator + Cosmos Transfer | 🟡 示範頁；取景台 |
| A9 | `#a9` | 設計 / 審查 Copilot | 核心治理 | usd-code-mcp :9903 | 🟡 示範頁；AI 動作預覽 |
| A10 | `#a10` | 機器人 / 巡檢模擬 | 核心治理 | Isaac Sim + Cosmos | 🟡 示範頁；核心舞台需 GPU |
| CV | `#conv` | IFC→USD 轉檔排程（P1） | OMNIVERSE RUNTIME | coordinator `/api/conversions` + streaming-server 轉檔 | 🟡 讀真 ifc-ready jobs；插隊/重試/coverage P1 |
| SS | `#sessions` | Session 管理 | OMNIVERSE RUNTIME | coordinator `/api/sessions` | 🟡 Phase1 read-only；結束 session IX-SS-04 已設計(#224)；occupied 證據鏈 P1 |
| KG | `#instances` | Kit / GPU 機隊 | OMNIVERSE RUNTIME | kit-manager-api `/instances` | 🟡 fleet 模型正確；真遙測接 kit-manager-api；restart/release intent 待建 |
| M | `#minio` | MinIO 資料 | OMNIVERSE RUNTIME | coordinator → local_fs storage（真 MinIO 待接） | 🟢 真三層樹 270/類別/版本 |
| RT | `#runtime` | Runtime 監控 | 落地端控制台 / SYSTEM | kit-manager-api `/runtime` + `/health` | 🟡 端點真有；UI 監控面板待建 |
| SY | `#admin` | 系統管理 | SYSTEM | coordinator（auth/config） | ⚪ **待建**（本期僅佔位） |
| ▦ | `#spec` | 設計規格說明 | SYSTEM | 靜態 | 🟢 文件入口 |
| — | `#kit` / `#demo-control` | operator 工具（保留） | — | kit-manager-web（apps/kit-manager-web） | operator-only，不砍 |

> 註：`#runtime`/`#admin` 對應真實 kit-manager-api 端點（`/runtime`/`/health`），IX-SS-01、IX-KG-01 已引用 `GET /api/runtime/status`。

## A.2 逐頁重點差距

**#home**：實作已有版型與入口卡。差距：Recent Risk 是示範資料（已誠實標示）；原型的「跨應用待辦彙整」（從 A1 失敗/coverage 低/逾期工單聚合）尚未接真來源。

**#a1**（最接近完成）：五步版型、規則引擎（host-native ifcopenshell + 可選 ifctester IDS）、真實 artifact（fixture-bytes.ifc · IFC4X3 · 7126 構件 · 99 score）、Issue 生命週期 DB、Excel（openpyxl）、**BCF 2.1 匯出**全部真。差距：(1) 五步 stepper 是「版型」，步驟間沒有狀態機串接（上傳完成不會自動點亮步驟 2）；(2) 記分板與規則清單未做「點規則展開命中構件清單」互動；(3) 3D 高亮 P1.5 待建（誠實已標）；(4) fixture 清單顯示 `./storage` 為空時的 refresh 流程，但與 #minio 的真實樹未打通選取。

**#viewer**：做成「證據矩陣」頁——openStage / focusPrim / selectPrims / clearHighlight 已實作（走既有 viewer 的 DataChannel），highlightPrimsRequest P1.5、first_frame_at P1、stage truth P1。這頁設計**比原型更成熟**（viewport 留在既有 viewer，不在 console 重渲染 WebRTC），應回寫進文件成為正式架構。

**#conv**：讀真 `/api/external/ifc-ready`（實測看到 project 271 的 job、`model.usdc` artifact URL、review_session）。差距：mapping coverage 報告 P1；插隊/重試/並行數控制 P1（原型的拖曳排序在實作改為 controlled action endpoint——正確，但 endpoint 未建）。

**#sessions**：ATC 隱喻正確、「port listening ≠ has frame」已內化。差距：occupied 證據鏈（first_frame_at + heartbeat + stage match）P1；Open primary/spectator 是 Phase 1 read-only。

**#instances**：1 GPU = 1 stream、drain/move（terminate+recreate 30–40s）語意全部正確。差距：節點表為示範資料，真遙測需 kit-manager-api；restart/release 須走 audited intent 給 Kit Manager（邊界正確，未實作）。

**#minio**：**驚喜——三層結構已落地**：`root=D:\Users\deploy\AI-bim-geo\storage`，樹為 `270/機電|水電|消防/000001.ifc·000002.ifc·000003.ifc·竣工.ifc`。即「projectId / OpenBIM 類別 / 版本檔案」真實存在（版本=檔名序號+竣工）。來源是 local file-server 比照 bim-control 規約，真 S3/MinIO 待接。

**#review（=#gpu）Review Room**：v1 = 導引到既有 viewer（coordinator `/ui/open?session=` server-side redirect），Tool Rail 列出 DataChannel as-built 指令。highlight 走「Review-Room 主動拉 → client DataChannel」，不復活 server-push——此決策應寫入文件。

## A.3 我們文件的勘誤（必改，否則誤導 AI）

| # | 文件原句 | 實測事實 | 改法 |
|---|---|---|---|
| E1 | route contract `#/a1`、`#/viewer`… | 實際為 `#a1`、`#viewer`…（無斜線） | v2 §10.5、v3、README 全改 |
| E2 | 「MinIO 第三層版本**尚未實作**」（v3 D7/O3） | storage 已有 `270/機電/000001~竣工.ifc` 三層樹（local_fs） | O3 已半解：剩「真 S3/MinIO 接入」與「版本命名規約定案」 |
| E3 | 「匯出 **BCF 3.0**」（README/v3） | 實作為 **BCF 2.1** 匯出（stdlib 自建，避 GPLv3 依賴）；IfcOpenShell bcf 庫支援 2.1 與 3.0 | 標準改寫成「BCF 2.1 起步、以官方 bcf 庫對齊、3.0 為升級目標」 |
| E4 | 「governance-service :49102」直述 | browser **不直連**，一律經 coordinator `/api/governance/*` proxy | 文件補「經 proxy」字樣 |
| E5 | 專案編號 270/899/988 | UI 檔案庫列 270/**889/990**，conv job 出現 **271** | ✅ **2026-06-11 已確認**：現況為 270/889/990＋271，**皆為 MinIO 暫時測試 IFC 檔**（非正式專案編號；正式專案資料之後才匯入） |
| E6 | （無此概念） | 實作有五步管線、用語切換、Review Room、Intake 等新頁 | 文件承認其為正式 IA 的一部分 |

## A.4 待你確認（兩題）

1. ~~**專案編號**~~ ✅ 已答（2026-06-11）：**270/889/990＋271，皆為 MinIO 暫時測試 IFC 檔**；測試/示範一律用這組編號，並在 UI 標示其為測試資料；正式專案匯入後再替換。
2. ~~**storage 真相源**~~ ✅ 已答（2026-06-11）：**短期以 local_fs（D:\Users\deploy\AI-bim-geo\storage）為真相源**，比照 `bim-control/{projectId}/{類別}/{版本檔}` 三層規約；真 MinIO/S3 之後才接，接上時資料層只換 source_kind、路徑語意不變。

> A.4 兩題皆已確認（2026-06-11），本檔勘誤全數定案。

---

# PART B · 前端互動實作規格（給 AI 的「行為合約」）

> **為什麼有這份**：HTML 原型只能展示「長相和感覺」，AI 從中讀不出狀態機、API 時序、失敗處理。本部分把每個互動寫成固定格式的「互動卡 IX-xx」，照卡實作即可。
> **技術前提**：React 18 + TypeScript EdgeConsole（coordinator `/ui`）；所有狀態變化走「證據型更新」。

## B.0 六個通用互動模式（先讀這節，80% 互動是這六型的組合）

### 模式 1 · 證據型更新（Evidence-based update）——本案唯一允許的更新方式
```
使用者按下動作 → 按鈕進入 busy（disabled + spinner 字樣）
→ 呼叫 API → 等回應
→ 成功：以「回應裡的事實」重繪（不是以「我以為會發生的事」重繪）
→ 失敗：按鈕復原 + 顯示錯誤條（紅，含 status code 與 message），畫面資料不變
禁止：樂觀更新（先改畫面再等 API）。理由：本系統的信任=畫面等於事實。
```

### 模式 2 · 輪詢（Polling）
```
頁面進入時 fetch 一次 → setInterval 輪詢 → 頁面離開時 clearInterval
節奏：佇列/Session/機隊類 5000ms；執行中的進度（rule-run、conversion running）1500ms
規則：輪詢中新資料「就地更新列」，不整頁閃爍；fetch 失敗顯示「上次更新 HH:MM:SS · 連線異常」徽章，不清空舊資料
```

### 模式 3 · 危險動作三段式（Intent → Confirm → Audited result）
```
適用：插隊/重試/強制釋放/結束 session/drain/move/批次建 issue/匯出交付
① intent：點按鈕 → 開 confirm 對話框，內容必須含「成本與後果」白話
   （例 move：「這是重啟搬移：先終止再於新節點重建，約 30–40 秒、重載 stage、短暫斷線」）
② confirm：明確按「確認執行」→ POST intent API（body 含 reason 欄位，可空）
③ result：依模式 1 證據型更新；audit 記錄（who/when/what/reason）由後端寫
```

### 模式 4 · Provenance 徽章（誠實標記渲染）
```
資料源：GET /api/provenance（或頁面資料內嵌 provenance 欄位），前端絕不硬編碼
狀態 → 樣式：已實作(綠) / 實測 artifact(青) / 示範資料(琥珀) / 後端待建·P1(灰虛線)
規則：每個區塊右上角一枚；待建功能的按鈕 render 成 disabled + title 說明，「不提供假按鈕」
```

### 模式 5 · 拖放（Drag & Drop）→ 一律轉譯成 intent API
```
HTML5 DnD：draggable 元素 dragstart 寫 payload(JSON: {kind, id}) 進 dataTransfer
目標 dragover：用「規則函式」判斷可否放（不可放 → dropEffect='none' + 目標紅框提示原因）
drop：不直接改狀態 → 走模式 3（彈 confirm → POST intent）
規則函式範例（fleet）：目標節點 drain 中→拒；目標已有 running stream→拒（1 GPU=1 stream）；same node→忽略
```

### 模式 6 · 空狀態與錯誤狀態
```
空資料：顯示「目前沒有 X」+ 下一步建議（例：storage 無 IFC → 顯示放檔路徑與 Refresh 鈕）——不補假列
API 錯誤：保留舊資料 + 錯誤條；404/501 視為「後端待建」→ 顯示待建徽章而非錯誤
```

## B.1 A1 五步 Stepper（IX-A1）

**狀態機（整頁一個 reducer）**
```
states: idle → picked → running → scored → issued → delivered
事件: PICK_FILE / RUN / RUN_PROGRESS(p) / RUN_DONE(result) / RUN_FAIL(err)
      CREATE_ISSUES_OK(n) / EXPORT_OK(kind)
規則: 步驟圓點 i 的樣式 = (state 已過此步 ? 綠勾 : state 正在此步 ? 綠光圈 : 灰)
      任何步可「重跑」：回到該步 state，下游步驟清空（資料保留在歷史，不覆蓋 artifact）
```

**IX-A1-01 選取模型**：檔案庫下拉（專案→類別→版本，資料來自 #minio 同一 API `GET /api/storage/tree`）；選定 → state=picked、顯示完整路徑與檔案大小。前置：無。失敗：樹載入失敗→模式 6。

**IX-A1-02 執行檢核**：按「執行規則檢核」→ `POST /api/governance/rule-runs {source_path, ids_path?}` → 回 `rule_run_id` → 進度輪詢 `GET /api/governance/rule-runs/:id`（1500ms）→ status=running 顯示進度條+逐條 log（若 API 提供）；done → RUN_DONE。**驗收**：跑 fixture 真檔出真分數；中途離頁再回來，輪詢自動恢復（rule_run_id 存頁面 state）。

**IX-A1-03 記分板與規則清單**：渲染 evaluated/passed/failed/score 四格；規則列**點擊展開**命中構件（`GET /api/governance/rule-runs/:id/failures?rule=`，懶載入、分頁 50 筆）；每構件顯示 ifc_guid + name + storey；guid 可複製。**驗收**：展開 71 筆失敗不卡頓；空失敗規則顯示「全過」不可展開。

**IX-A1-04 失敗轉 Issue**：勾選規則或構件 → 「失敗構件建 issue」→ 模式 3（confirm 顯示將建幾筆、指派誰）→ `POST /api/governance/issues/from-rule-run` → 成功後顯示 issue 連結。**驗收**：重複執行不產生重複 issue（後端冪等鍵 = rule_run_id+guid，前端顯示「已建過 n 筆，跳過」）。

**IX-A1-05 匯出交付**：Excel `GET .../export?fmt=excel` 直接下載；BCF `GET /api/governance/bcf/export` 下載 .bcfzip（**BCF 2.1**，無 viewpoint 時 BCF 內誠實缺省）。**驗收**：BIMcollab/BCF 檢視器可開。

**IX-A1-06 在 3D 高亮（P1.5，待建——render disabled）**：啟用條件（缺一不可）：viewer DataChannel ready ∧ first_frame_at 存在 ∧ stage matched ∧ 構件有 usd_prim_path。滿足後：按下 → Review-Room 主動拉模式發 `highlightPrimsRequest {prim_paths[], color:'red'}` → viewer 回 ack 才標成功。

## B.2 Conversion Queue（IX-CV）

**IX-CV-01 佇列輪詢**：`GET /api/external/ifc-ready` 5000ms，模式 2。列欄位：job / project / conversion / dispatch / session / stage URL。
**IX-CV-02 任務展開**：點列展開 coverage 報告（property/relationship/attribute %）＋輸出路徑；coverage API 未建時顯示待建徽章（模式 6 的 501 規則）。
**IX-CV-03 插隊/重試（待建 endpoint，UI 先以 disabled+規格呈現）**：模式 3；插隊 `POST /api/conversion/jobs/:id/prioritize`、重試 `POST .../retry`；原型的「拖曳排序」正式版**改為按鈕式插隊**（拖曳排序的視覺回饋成本高且易誤觸，控制語意相同）。
**IX-CV-04 自動偵測開關**：`PUT /api/conversion/watch {enabled}`；關閉時佇列頁頂顯示琥珀條「自動偵測已關閉」。

## B.3 Session ATC（IX-SS）

**IX-SS-01 清單輪詢**：`GET /api/runtime/status` 5000ms。
**IX-SS-02 occupied 證據鏈**：每 endpoint 列三欄證據：`first_frame_at`（無→「未見畫面」琥珀）/ `last_heartbeat`（>15s→stale 紅）/ `stage matched`（expected==loaded 綠勾）。**Open URL ≠ occupied**——open 按鈕按下只開新分頁，不改任何狀態欄。
**IX-SS-03 強制釋放 stale（待建）**：條件：heartbeat stale ∧ 無 first frame；模式 3，confirm 文案「viewer-XXX 已 N 分鐘無心跳，釋放後該座位可被新 viewer 使用」→ `POST /api/sessions/:id/endpoints/:ep/release`。
**IX-SS-04 結束 session（已實作，PR #226）**：模式 3 → **重用 `POST /api/review-sessions/:sessionId/close`**（使用者裁定 2026-06-17：不開 spec 原文 `POST /api/sessions/:id/terminate`，因 cooperative close 為 operator terminate 之超集；additive 補 optional `reason`+`actor` 寫進 `sessionClosing`/`sessionClosed` 事件流作模式 3 audit，cooperative close 呼叫端零退化、`reason` 不外溢回傳 body）；前端 `#sessions` per-row 結束鈕僅 `active` 列顯示，成功後該列轉灰（`ec-row-muted`）60 秒再移除（讓 operator 看見因果）。**刻意不加 IP allowlist 守門**（裁定 A：同端點同時服務 browser cooperative close 與 operator terminate，無欄位可區分、無法分離門控）。terminate＝釋放 coordinator 端 session/binding，非殺 GPU 上 Kit 行程（lifecycle 屬 kit-manager-api）。

## B.4 Kit/GPU Fleet（IX-KG）

**IX-KG-01 節點卡輪詢**：未來接 kit-manager-api；現為示範資料（已標）。
**IX-KG-02 拖 session 到他節點 = 重啟搬移**：模式 5 + 3。規則函式：target.drain→拒「節點排空中」；target 已有 stream→拒「1 GPU = 1 stream」；confirm 文案含 30–40s/重載 stage/斷線；確認 → `POST /api/fleet/move-intent {session_id, target_node, reason}` → 目標節點顯示「啟動中…%」（輪詢），完成才在新節點顯示 session。
**IX-KG-03 drain/恢復**：模式 3 → `POST /api/fleet/nodes/:id/drain {on}`；drain 中節點卡片左緣琥珀條、不可成為 drop 目標。
**IX-KG-04 指派待排程 session**：把 pending 卡拖到 idle 節點 → confirm →`POST /api/fleet/assign-intent`。
（以上 intent API 全部待建；UI 先實作互動骨架，按鈕 disabled+待建徽章，**拖放規則函式先寫並單元測試**——這正是原型已驗證過的 10 條行為測試。）

## B.5 3D Viewer / Review Room（IX-3D）

> 本卡「完成後長相」以 `ai-bim-geo-viewer-prototype.html` 為驗收示意（七區塊資訊架構＋GUID⇔USD 對應表）。**誠實驗收規則**：該檔為 canvas 示意，正式 3D 一律來自落地端 Kit 的 WebRTC 串流；示意畫面須帶可見浮水印「CANVAS 示意 · 非真 WebRTC 串流」，避免驗收場合誤認。

**IX-3D-01 開啟 viewer**：輸入或選 `review_session_id` → 開 `coordinator /ui/open?session=`（server redirect；不在 console 內嵌 WebRTC）。
**IX-3D-02 DataChannel 指令（as-built）**：openStage（成功證據=loaded stage URL 回報）/ focusPrim / selectPrims / clearHighlight。每次指令在 UI 留一行 trace（時間、指令、參數摘要、ack/timeout）——對齊「AI 透明可追」原則。 **傳輸機制（官方）**：瀏覽器端 `AppStreamer.sendMessage(JSON.stringify({event_type, payload}))` 經 WebRTC DataChannel 送出；Kit 端由 `omni.kit.livestream.messaging`(v1.2.1) 收下→解析 JSON→重發到內部 message bus 交給對應 handler；Kit→瀏覽器回 ack 用 `messaging.register_event_type_to_send(event_type)`。命名對齊 NVIDIA `web-viewer-sample` 的 `openStageRequest`→`openedStageResult` 往返——本案 openStage / highlightPrimsRequest / isolatePrimsRequest 一律沿用同一 `*Request`/`*Result` ack 慣例。
**IX-3D-03 mapping table ↔ 3D 連動**：點 mapping 列 → 若 viewer 開著 → 發 focusPrim；無 usd_prim_path（mapping 缺）→ 該列標 ⚠ name_fallback 並 disabled 連動，tooltip「此構件未對應，無法定位」。
**IX-3D-04 first frame / stage truth 證據（P1）**：viewer 端回報 `first_frame_at`；console 只顯示，不推定。
**IX-3D-05 高亮（P1.5）**：見 IX-A1-06；A2 diff 三色與 A4 搜尋 isolate 共用同一指令族（highlight/isolate payload 帶 source: a1|a2|a4）。

## B.6 EdgeConsole 實作慣例（精簡）

每頁一個 `usePageData(url, intervalMs)` hook（模式 2 內建）＋一個 reducer 管狀態機；API client 統一前綴 `/api/`、錯誤物件標準化 `{status, message}`；provenance 用 `useProvenance(key)` 取徽章狀態；所有 confirm 對話框共用 `<IntentDialog cost={...} onConfirm={...}>`；trace 列共用 `<ToolTrace/>`。**禁止**：localStorage 存業務狀態、樂觀更新、假資料填充。

---

# PART C · 官方標準對齊（鐵律升級版）

> 三個領域一律「**官方有就用官方，自製只做橋接**」。出處皆為官方文件（已逐頁查證）。
>
> **一頁式總表見《開發軌跡》§2.0.5「官方技術棧對齊總表」**——那張表是「每個能力用哪個官方件＋能力邊界」的單一速查；本 PART C 是其展開細節（C.1 BCF/diff、C.2 轉檔、C.3 viewer extensions、C.5 Cosmos/Replicator/Isaac、C.6 USD schema）。

## C.1 BCF 與 IFC diff —— 對齊 IfcOpenShell

- **BCF**：用官方 `bcf` 庫（`pip install bcf-client`；支援 BCF-XML **2.1 與 3.0**、BCF-API 3.0）。建議路線：現行自建 BCF 2.1 匯出（避 GPLv3）短期保留；中期改走官方 `bcf.v3.topic.TopicHandler.create_new()` + `add_viewpoint_from_point_and_guids(position, *guids)` + snapshot，升級 3.0。viewpoint/snapshot 在 M4（3D 證據）後自動補進 topic。
  https://docs.ifcopenshell.org/bcf.html
- **A2 版本差異引擎 = 官方 `ifcdiff`，不自寫**：CLI `python -m ifcdiff old.ifc new.ifc` 或 `from ifcdiff import IfcDiff`；輸出 JSON 分 **added / deleted / changed**、以 **GlobalId 為鍵**，changed 附變更欄位；支援跨 schema。前端三色清單直接吃此 JSON。現成資料：storage 已有 `000001→000002→000003→竣工` 版本檔可立即試跑。
  https://docs.ifcopenshell.org/ifcdiff.html
- **A1 規則**：ifctester（IDS）已實作 ✓；注意官方 reporter 含 **Bcf 輸出**——檢核結果可直接產 BCF 回饋閉環。
  https://docs.ifcopenshell.org/ifctester.html
- 工具箱補充：`ifcpatch` recipes（ExtractElements / SplitByBuildingStorey / Ifc2Sql / Optimise / TessellateElements）與 IfcClash（A3 碰撞選型的第一候選）。

## C.2 IFC 轉檔 —— 對齊 IfcConvert 的「能與不能」

- **官方事實：IfcConvert 不輸出 USD**（支援 obj/dae/**glb**/stp/igs/xml/json(xeokit)/svg/h5/ttl/ifc；官方表指 IFC→USD 走 Bonsai/Blender）。所以本案 IFC→USD 兩條合法路線：
  **(a) 現行路線（保留）**：自製 conversion authority（bim-streaming-server，ifcopenshell python → USD）——官方沒有的東西自己做是合理的，但 mapping coverage 報告因此是**義務**；
  **(b) 備援路線**：`IfcConvert --use-element-guids` → glb → Omniverse glTF importer（除錯/比對用）。
- **GUID 鐵律**：任何幾何輸出一律以 `IfcRoot.GlobalId` 命名元素（自製轉檔器同樣遵守 `G_<sanitized_guid>` prim 命名）→ 這是 mapping table 與 3D 連動的生命線。
- 大檔旗標（自製轉檔器比照）：多執行緒 `-j`、`--exclude=entities IfcOpeningElement IfcSpace`（官方預設排除）、`--center-model` / `--site-local-placement`（大座標防漂移）。
- **語意不走幾何檔**：屬性/Pset 用 ifcopenshell python（或 ifcpatch Ifc2Sql）另行入庫——與現行 elements.json 思路一致。
  https://docs.ifcopenshell.org/ifcconvert.html

## C.3 3D Viewer —— 把 Omniverse Kit 價值最大化（長期維運核心）

**戰略：「Kit 端用官方 extension，Web 端只做控制與證據」。** 量測/批註/剖切/書籤這些 viewer 功能，NVIDIA 官方都有現成 extension——自己在 web 端重做=長期維運災難；正確做法是在 Kit app 啟用官方件，web console 只負責開關它們、收證據、轉 BCF。

| 需求（原型底部 tabs） | 官方 extension | 說明 |
|---|---|---|
| 量測 | `omni.kit.tool.measure` | 點對點/角度/面積、snap、CSV 匯出 |
| 批註 markup | `omni.kit.tool.markup`（+ `omni.kit.markup.core`） | 3D 場景 2D 批註、匯出 |
| 剖切 | `omni.kit.window.section` | 剖切面拖曳/XYZ 對齊/反向 |
| 書籤視角 | `omni.kit.waypoint.core` | 視角保存/播放清單 |
| 場景樹 | `omni.kit.widget.stage` / `omni.kit.window.stage` | 對應原型結構樹 |
| 屬性面板 | `omni.kit.window.property`（可 register_widget 擴充 IFC 語意） | 對應原型右欄 |
| viewport | `omni.kit.viewport.window` / `.bundle` | 基線互動 viewport |
| WebRTC 串流 | `omni.kit.livestream.webrtc` / `omni.kit.livestream.core` / `omni.services.livestream.session` | 注意：舊名 `omni.services.streamclient.webrtc` 已不在 registry |

出處：https://docs.omniverse.nvidia.com/extensions （measure/markup/section/waypoints 各分頁）

**自製只做一層：BCF 橋接**——把 markup/waypoint 的內容轉成 `bcf topic + viewpoint + snapshot`（用 C.1 官方 bcf 庫）。這層是本產品的差異化價值，也是唯一值得自寫的 viewer 周邊。

**3D Viewer 演進路線（取代原 M3/M4 的細化）**
```
v1（現況已達）：console 導引到既有 viewer（/ui/open redirect）+ DataChannel 四指令
v2（=M4）：highlightPrimsRequest + first_frame/stage-truth 證據鏈 + mapping 連動
v3（Kit 加值）：Kit app 啟用官方 measure/markup/section/waypoint，console 加開關與狀態
v4（差異化）：markup/waypoint ↔ BCF 雙向橋接；A2 三色 onion-skin、A4 isolate 共用高亮指令族
```
**長期維運理由**：官方 extension 隨 Kit 升版由 NVIDIA 維護；我們的維運面只剩「橋接層 + console」，升級 Kit 107→108 時不必重寫 viewer 功能。

## C.5 A8 / A10 加值 —— 對齊 NVIDIA Replicator / Cosmos / Isaac Sim

> A8 Synthetic Data、A10 機器人巡檢是「OMNIVERSE 加值線」，一律對齊官方件，**禁自造資料管線/物理引擎**。

**A8 合成資料（Replicator → Cosmos）**
- 標註資料管線：**Omniverse Replicator**（`import omni.replicator.core as rep`；流程 Scene → Randomizer → Annotator → Writer → `rep.orchestrator.run()` / `await rep.orchestrator.step_async()`）。
- Annotator：`rep.AnnotatorRegistry.get_annotator(...)` —— `rgb` / `semantic_segmentation` / `instance_segmentation` / `bounding_box_2d_tight` / `bounding_box_3d` / `distance_to_camera`。Writer：`rep.WriterRegistry.get("BasicWriter")` + `writer.initialize(output_dir=, rgb=True, semantic_segmentation=True, bounding_box_2d_tight=True, image_output_format="png")` + `writer.attach([rep.create.render_product(cam,(W,H))])`；另有 **KittiWriter**、Isaac 的 **CosmosWriter**（輸出 RGB/depth/seg/edge 當 Cosmos control 輸入）。
- 擬真擴增：**NVIDIA Cosmos Transfer**（world-to-world、structure-conditioned；以 segmentation/depth/edge 為 spatial control 生成照片級變體）。存取＝**NIM 微服務**（`POST /v1/infer`）/ build.nvidia.com / HF `nvidia/` / GitHub `nvidia-cosmos`。關鍵參數：每分支 `control_weight ∈ [0,1]`（合計建議 ≤2.0，NIM 對 >1.0 自動歸一）、`sigma_max`（對條件輸入加噪上限，SDG 建議 80–90）。
- **能力邊界 / 版本風險**：Replicator 出 ground-truth 標註，Cosmos 只「擬真」不標註，兩者分工。模型授權 NVIDIA Open Model License（程式碼 Apache 2.0）。**Cosmos 3 已於 2026-06 統一為 Mixture-of-Transformers「雙塔」（Nano 16B / Super 64B、改 OpenMDW-1.1、repo 移至 `github.com/nvidia/cosmos`）→ 鎖 API/模型版本前務必確認，勿假設 Predict1/Transfer1 介面不變。**
  https://developer.nvidia.com/blog/how-to-build-a-generative-ai-enabled-synthetic-data-pipeline-for-perception-ai/

**A10 機器人 / 巡檢模擬（Isaac Sim → Cosmos）**
- 模擬：**Isaac Sim**（建於 Omniverse、USD-native、PhysX）；匯入 URDF/MJCF/USD。感測擴充 `isaacsim.sensors.physx`；PhysX Lidar 用 `omni.kit.commands.execute("RangeSensorCreateLidar", path="/Lidar", min_range=0.4, max_range=100.0, horizontal_fov=360.0, vertical_fov=30.0, ...)`，Python 綁定 `from isaacsim.sensors.physx import _range_sensor`。第一人稱＝camera prim 掛在機器人 chassis link 下。
- **能力邊界（重要）**：**PhysX Lidar 只偵測「有碰撞體」的物件、會穿透透明物、量到的是 ground-truth 深度（非真雜訊）**；要擬真感測模型（Ouster/HESAI…）改用 **RTX Lidar**。`rotationRate=0` 表同幀打完所有 ray。
- sim-to-real：用 **CosmosWriter** 擷取機器人相機 clip → **Cosmos Transfer** 光真化。**3D 角色：核心舞台**；Isaac Sim 比 Kit 重，**建議最後做**；真機 ROS bridge 本期 Won't。
  https://docs.isaacsim.omniverse.nvidia.com/latest/replicator_tutorials/tutorial_replicator_cosmos.html

## C.6 OpenUSD schema 機制 —— 轉檔 / 4D / 疊合 / session layer（給轉檔器與 viewer）

- **prim 命名（IFC GlobalId → USD）**：USD 識別碼須以 `[A-Za-z_]` 起頭、續 `[A-Za-z0-9_]`；不可含 `/ {} [] @`、空白、運算子；不可數字開頭；同層名稱需唯一。IFC GlobalId 22 字元且可能含 `$` → 用 `G_<sanitized_guid>`（`$`→`_`），**但 `$`→`_` 有碰撞風險**（`foo$bar` 與 `foo#bar` 都變 `foo_bar`）→ **務必把原始 GUID 另存 customData**（`prim.SetCustomDataByKey("ifc:GlobalId", guid)`）或用 NVIDIA Exchange/Connect SDK 的可逆轉碼（`getValidChildNames()`）。
- **承載 IFC 語意**：`prim.SetCustomDataByKey("ifc:Pset:FireRating", v)` 或建 typed attribute（`prim.CreateAttribute("ifc:FireRating", Sdf.ValueTypeNames.String, False).Set(v)`）——對應 geo-viewer 七區塊的 Pset/Qto 顯示。
- **4D 生長（A6）**：`UsdGeom.Imageable(prim).GetVisibilityAttr().Set("invisible"|"inherited", Usd.TimeCode(t))`；stage `SetStartTimeCode/EndTimeCode/TimeCodesPerSecond`。**visibility 是 token → held 不內插**（構件在某幀「啪」地出現，正合施工語意）；平滑移動才用 `xformOp:*`（linear）。
- **疊合 / 沙箱（A3/A9）**：用 **sublayer / layer stack**（上強下弱）、**payload**（大模型延遲載入）、**variant set**；clash/markup/section/AI 改動一律寫進 **session layer** 或專用 sublayer，**source IFC 衍生層保持乾淨**（剖面工具用 `useSessionLayer=true`）。
- **prim 高亮 API**：Kit `omni.usd` selection group —— `ctx.register_selection_group()` → `set_selection_group_outline_color(gid, carb.Float4)` → 指派 prims；web 端只發 `highlightPrimsRequest`，不重渲染。**完整指令路徑**：web `AppStreamer.sendMessage({event_type:'highlightPrimsRequest', payload:{prim_paths:[…], color}})` → Kit `omni.kit.livestream.messaging` bus → handler 把 GlobalId→prim path→selection group + `carb.Float4` outline color；完成回 `highlightPrimsResult` ack（mapping 缺 usd_prim_path 的構件回報於 ack 的 `unmapped[]`）。isolate 同理走 `isolatePrimsRequest`（改 `visibility`）。
- **串流硬限制（再次強調）**：`omni.kit.livestream.webrtc/.app`，**1 GPU = 1 Kit = 1 primary stream、無 live migration**；換模型/GPU = terminate+recreate；冷啟動 shader cache 空可達 ~15 分；spectator 共看同一 render 不另吃 GPU。
  https://openusd.org/release/glossary.html ／ https://docs.omniverse.nvidia.com/ovas/latest/deployments/infra/limitations_etc.html

## C.4 README 鐵律增補（複製貼進 docs/plans/README.md 第 9–11 條）

```
9. BCF / IFC diff 對齊 IfcOpenShell 官方：版本比對一律用 ifcdiff（JSON、GlobalId 鍵），
   BCF 用官方 bcf 庫語意（現行 2.1 匯出保留，3.0 為升級目標）。https://docs.ifcopenshell.org/
10. IFC 轉檔對齊 IfcConvert 官方能力邊界：IfcConvert 無 USD 輸出，自製 IFC→USD 必須
    (a) 以 GlobalId 命名 prim、(b) 出 mapping coverage 報告；備援路線 IfcConvert→glb。
    https://docs.ifcopenshell.org/ifcconvert.html
11. 3D viewer 功能對齊 Omniverse 官方 extensions：量測/批註/剖切/書籤/場景樹/屬性/串流
    一律用官方件（omni.kit.tool.measure、omni.kit.tool.markup、omni.kit.window.section、
    omni.kit.waypoint.core…），web 端不重做；自製僅限 BCF 橋接層。
    https://docs.omniverse.nvidia.com/extensions
```

---

## 附 · 給下一輪的三個動作建議

1. **回答 A.4 兩題**（專案編號真相、storage 真相源）→ 我即更新全部文件勘誤（E1–E5 一次改完）。
2. **A2 立即可開工**：storage 已有四個版本檔，`ifcdiff 000001.ifc 000002.ifc` 一輪就能出真三色清單（不需要 GPU）。
3. **把本檔 PART B 餵給 Claude Code**：開工指令建議寫「依 docs/plans/互動實作規格 PART B 的 IX-A1-02/03 實作，禁止樂觀更新」這種粒度。

*v1 · 2026-06-11 · 實測來源：http://localhost:8004/ui（#home/#a1/#viewer/#conv/#sessions/#instances/#minio/#review 八頁逐頁擷取）；官方文件查證：docs.ifcopenshell.org（bcf/ifcdiff/ifctester/ifcconvert/ifcpatch）、docs.omniverse.nvidia.com/extensions 與 NVIDIA Kit extension registry。*
