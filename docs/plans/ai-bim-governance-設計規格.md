# AI · BIM Governance — 介面設計規格

> 配套檔案：`ai-bim-governance-prototype.html`（可直接用瀏覽器打開的可點擊原型）
> 對齊系統總覽：https://bim-docs.jackshappybot.com/ （01 系統架構 / 03 落地端入口 / 05 BIM 治理 / 06 操作介面總覽）
> 版本：v2 · 2026-06-09

> **Repo 功能需求主來源**：本檔與 `ai-bim-governance-prototype.html` 是 repo 內 A1–A10 功能需求、操作流程與 UI 驗收語意的主要入口，取代舊 `AI-BIM-governance-saas-roadmap-2026-05.md`。
>
> **主系統架構**：以 `https://bim-docs.jackshappybot.com/` 分頁「01 系統架構」的「BIM 模型管理平台 — 系統架構」為準，採雲端與客戶落地端分離：外部公司雲端負責 control-plane，客戶落地端負責 IFC / Kit / MCP runtime data-plane。
>
> **對齊 `feat/edge-console-product-shell`**：正式產品殼層入口是 coordinator `/ui` 掛載的 EdgeConsole。核心 route contract：`/ui`（今天要做什麼）、`#/a1`、`#/viewer`、`#/conv`、`#/sessions`、`#/instances`、`#/minio`；並保留 operator-tool route `#/kit`、`#/demo-control`。驗收以 product shell E2E 能看到 home、A1 五步、3D Viewer、轉檔排程、Session、Kit/GPU 機隊、MinIO 頁為準。

---

## 0. 這份文件怎麼用（給不懂工程的你）

這份是「說明書」，把原型背後的設計邏輯寫清楚，讓工程師可以照著做。

你只要看 **第 1～3 節**（設計原則、長相、怎麼分頁）就能掌握全貌；
**第 6 節** 是 A1～A10 每個功能「長在介面哪裡、怎麼操作」，可以當成驗收清單一條一條對；
工程師會用到的技術細節集中在 **第 4、10 節**。

一句話總結這次的方向：**深色專業感不變，但把每個動作變得更白話、更像「跟著步驟走」，並且誠實標清楚哪些功能已經能用、哪些還在開發。**

---

## 1. 設計總原則

| 原則 | 白話說明 | 在介面上怎麼落實 |
|---|---|---|
| **白話優先** | 每個技術名詞旁邊都配一句人話 | 主標用中文白話（「治理與模型檢核」），小標才放英文／代碼（`Governance & Rule Checker`）。每頁開頭有一句「這頁在幫你做什麼」。 |
| **引導式流程** | 核心動作做成「跟著步驟走」 | A1 治理檢核用五步 stepper（上傳→檢核→結果→開 Issue→交付），新手照走不會迷路。 |
| **誠實標記** | 不對客戶過度承諾 | 每個畫面貼四種可信度標記：**已實作 / 實測 / 示範 / 待建**。沿用系統總覽既有的「AS-BUILT / DEMO DATA」誠實工程文化。 |
| **深色但更友善** | 保留專業感、降低門檻 | 深色底 + NVIDIA 綠主色不變；但加大按鈕、圓角柔化、增加留白、用暖色（琥珀）做提醒，不再是一片密密麻麻的等寬字。 |
| **AI 透明可追** | 看得到 AI 做了什麼才放心 | 右側 Chat USD Agent 把每次 MCP 工具呼叫（`kit_mcp.search_prims` 等）攤開顯示，並且只在 session layer 操作、不直接改 source model。 |

---

## 2. 版面結構（三欄 · one platform）

呼應系統總覽的標語「**two views · one platform**」，整個介面是固定的三欄式：

```
┌─────────────────────────────────────────────────────────────┐
│  頂部狀態列  專案▾ 版本▾ 階段 | KIT GPU QUEUE MCP | 使用者     │
├──────────┬──────────────────────────────┬───────────────────┤
│ 左側導覽  │       中央工作區（主畫面）       │  右側 Chat USD     │
│ 三群分類  │   每頁：標題→這頁在做什麼→     │  Agent（AI 助理）  │
│ A1–A10   │   主畫面預覽→介面呈現分析→     │  建議指令＋        │
│          │   後端依賴→可信度              │  工具呼叫軌跡       │
└──────────┴──────────────────────────────┴───────────────────┘
```

- **頂部狀態列**：左邊是「我在看哪個專案／版本／階段」，右邊是落地端健康度（Kit 在不在跑、GPU 多滿、排隊幾個、3 個 MCP 通不通）。對應系統架構的落地端 runtime 狀態。
- **右側 AI 助理可收合**：點右上角箭頭收起，把空間讓給 3D 或表格。

---

## 3. 資訊架構（左側導覽三群）

導覽分三群，**直接對應系統架構的部署邊界**——資料量大者落地吃 GPU、邏輯薄者用一般後端：

### 群組一：工作台（Workspace）
- **今天要做什麼** — 進來的第一頁，彙整跨應用待辦 + 常用動作入口。

### 群組二：核心治理（CORE · 語意 / 規則 / 問題）
> 這群以 governance-service / coordinator API 交付規則、Issue、BCF、報表等核心結果；若進入 3D Viewer、高亮、review session 或 Kit viewport，仍以落地端 GPU session 為前提。

| 代碼 | 功能 | 對應 App |
|---|---|---|
| A1 | 治理與模型檢核 | A1（P0，核心閉環）|
| A2 | 版本差異與責任 | A2 |
| A3 | 跨專業疊合 | A3 |
| A4 | 語意搜尋問答 | A4 |
| A5 | IoT / FM 數位分身 | A5 |
| BC | Issue / BCF 中心 | A1–A5 共同出海口 |
| RP | 報表中心 | 跨應用 |

### 群組三：OMNIVERSE RUNTIME（KIT · USD · GPU）
> 這群要吃 GPU、跑 Omniverse Kit，是和一般 BIM viewer 拉開差距的加值功能。

| 代碼 | 功能 | 對應 App |
|---|---|---|
| 01 | GPU 審查室 | MVP-A（WebRTC 串流）|
| A6 | 4D / 5D 施工模擬 | A6 |
| A7 | Reality Capture 比對 | A7 |
| A8 | Synthetic Data | A8 |
| A9 | 設計／審查 Copilot | A9 |
| A10 | 機器人／巡檢模擬 | A10 |

### 群組四：SYSTEM
- Runtime 監控、系統管理、設計規格說明。

**設計重點**：左側用顏色暗示分群——CORE 配青色、OMNIVERSE 配 NVIDIA 綠。使用者一眼就知道「哪一部分是 API / CPU 可交付，哪一部分需要 GPU viewport」，也呼應架構文件「不要把 Kit 包裝成 governance 賣點」的邊界。

---

## 4. 視覺規格（Design Tokens）

### 4.1 色彩

| Token | 色值 | 用途 |
|---|---|---|
| `--bg-0` | `#0c0f11` | 全頁底色（最深）|
| `--bg-1` | `#13181b` | 面板 / 卡片底 |
| `--bg-2` | `#1a2024` | 次層卡片、輸入框 |
| `--bg-3` | `#222a2f` | hover / 凸起 |
| `--green` | `#84c714` | 主色：主要按鈕、通過、running（比原 NVIDIA 綗略亮一階，更友善）|
| `--cyan` | `#46c7e6` | CORE 平台、實測 artifact、資訊 |
| `--amber` | `#f2b43b` | 提醒、警告、示範資料 |
| `--red` | `#f0635f` | 失敗、Critical、刪除 |
| `--violet` | `#9a8cff` | AI / Hybrid |
| `--tx-0/1/2/3` | `#eef3f4 → #56636a` | 文字由主到弱四階 |

### 4.2 字體與字級
- **介面字**：系統 sans（含 PingFang TC / Noto Sans CJK / 微軟正黑），基準 **15px**、行高 1.55（比原本密集版本放大、好讀）。
- **技術標籤 / 代碼**：等寬字 `ui-monospace`，10–11px，字距 `.12em`，大寫。這是沿用系統總覽招牌的「mono label」。
- **頁面大標**：27px / 750 weight。

### 4.3 圓角與間距
- 圓角：卡片 `14px`、小元件 `10px`、徽章 `6–7px`（柔化，比原本銳利的線稿更親和）。
- 內距：卡片 16px、頁面左右 30px、主內容最大寬 1080px（置中，避免在寬螢幕上文字拉太長）。

### 4.4 可信度標記（沿用並系統化）

| 標記 | 顏色 | 意思 |
|---|---|---|
| 🟢 **已實作** AS-BUILT | 綠 | 已經寫好、真的能用 |
| 🔵 **實測** artifact | 青 | 有實測產出（截圖／檔案）佐證 |
| 🟡 **示範資料** DEMO DATA | 琥珀 | 介面通了，但資料是示範用 |
| ⚪ **後端待建** NOT BUILT | 灰虛線 | 還沒做，先佔位 |

> 每一頁都會在「後端與依賴」區塊標出目前狀態，首頁也放一條圖例。這是這套介面最重要的信任機制。

---

## 5. 通用元件庫

| 元件 | 長相 | 用在哪 |
|---|---|---|
| **狀態膠囊 pill** | 圓角小框，左 mono 標籤 + 右值 + ▾ | 頂部專案／版本切換 |
| **狀態點 stat** | 彩色小圓點 + mono 文字 | 頂部 KIT/GPU/QUEUE/MCP |
| **引導步驟 stepper** | 圓號碼 + 標籤，已完成綠勾、目前有綠光圈 | A1 檢核流程 |
| **記分板 scoreboard** | 四格大數字（通過／擋下／通過率／構件數）| A1 結果 |
| **規則列 rule row** | 左狀態 icon + 規則名 + 代碼 + 數量 + 嚴重度標 | A1、A3 |
| **差異列 diff row** | 綠加／黃改／紅刪 三色 | A2 |
| **可信度標記 prov** | 見 4.4 | 每頁 |
| **AI 工具呼叫卡 toolcall** | 標題（工具名＋耗時）＋結果，逐筆堆疊 | 右側 Agent |
| **待辦列 todo** | 嚴重度色點 + 標題 + 來源標 + 期限 | 首頁 |
| **動作卡 act card** | 大代碼 icon + 標題 + 說明 + 「開始 →」 | 首頁常用動作 |

---

## 6. A1–A10：每個功能在介面怎麼呈現

> 這是本份規格的核心，逐一對應使用者選的「整合 A1–A10 並分析如何在介面顯示」。
> 每個應用都列：**做什麼 / 在介面哪裡 / 怎麼操作 / 後端依賴 / 可信度 / MVP 驗收**。

### A1 · 治理與模型檢核 ★核心（P0 · MIX · Phase 1）
- **做什麼**：自動檢查 IFC/Revit 的命名、分類、樓層、空間、設備編碼、LOD/LOI、交付規範。
- **在介面哪裡**：左側導覽置頂、掛 P0 徽章。主畫面是**五步 stepper**。
- **怎麼操作**：① 拖檔上傳 → ② 自動檢核（進度條 + 逐條 log）→ ③ 記分板 287過/25擋 + 規則清單（紅燈可點開）→ ④ 一鍵把失敗轉成 Issue → ⑤ 打包 BCF 3.0 + Excel 交付。
- **3D 連動**：「在 3D 高亮失敗構件」需要已派發的 review session、WebRTC first frame 與 DataChannel；沒有 GPU viewport 時仍可交付規則結果、Issue 與 BCF，但不得宣稱已完成 3D 高亮。
- **後端**：IfcOpenShell + ifctester（IDS/YAML）+ BCF 3.0 + Postgres 帳本。
- **可信度**：規則引擎 🟢已實作 · 3D 高亮 ⚪待建 / 需 viewer DataChannel + first frame · 雙向同步 ⚪待建。
- **MVP 驗收**：能上傳 → 出規則結果 → 匯出 BCF。純 Core MVP 約 1.5～2 人月。

### A2 · 版本差異與責任追蹤（P1 · CORE · Phase 2）
- **做什麼**：比對 v06/v07，列出加／改／刪的牆、梁、管線，並記得「誰改、何時、為什麼」。
- **在介面哪裡**：左右**並排比對**雙欄，中間變更清單，綠加／黃改／紅刪。
- **怎麼操作**：選兩個版本 → 看差異清單 → 點任一筆飛到該構件 → 可問 AI「哪些變更影響成本」。
- **後端**：UsdDiff + color overlay + git-style 帳本。
- **可信度**：🔵實測 · 🟡示範 · ⚪待建。

### A3 · 跨專業疊合（P1 · Phase 2）
- **做什麼**：建築／結構／機電／水電疊在一起，自動找碰撞。
- **在介面哪裡**：各專業是可開關**圖層**，疊在同一 3D 視窗；碰撞點按嚴重度排清單。
- **怎麼操作**：勾選要疊的專業 → 跑碰撞 → 點衝突飛到該位置框出兩個打架構件。
- **後端**：USD composition / layer stack / clash engine。
- **可信度**：clash engine 為 🟡示範資料，不誤導客戶。

### A4 · 語意搜尋與模型問答（P1 · CORE · Phase 4）
- **做什麼**：用白話找構件，例「三樓所有沒填防火時效的防火門」。
- **在介面哪裡**：畫面正中一條**白話搜尋框** + 範例提示；左清單、右 3D 同步高亮。
- **怎麼操作**：打一句話 → 出構件清單 + 3D 框選 → 一鍵轉 Issue／報表。
- **後端**：USD Search microservice + 向量索引 + `kit-mcp.search_prims`。本頁與右側 Copilot **共用同一查詢引擎**。
- **可信度**：🔵實測 · 🟡示範 · ⚪待建。

### A5 · IoT / BMS / FM 數位分身（P1 · MIX · Phase 3）
- **做什麼**：把溫濕度、CO₂、電水表、門禁、設備狀態綁到構件，連回工單與維保。
- **在介面哪裡**：3D 上掛**即時感測點**（綠正常／黃警示）；右側面板看歷史曲線與工單。
- **怎麼操作**：點設備 → 看即時值 + 歷史 + 關聯工單。
- **後端**：MQTT bridge + TimescaleDB/Influx + 工單 API。
- **可信度**：感測接線 ⚪待建，先用 🟡示範資料跑通流程。

### A6 · 4D / 5D 施工模擬（P2 · OMNI · Phase 2）
- **做什麼**：排程、成本、工項綁構件，拉時間軸看工地一週週長出來、抓進度衝突。
- **在介面哪裡**：底部**時間軸**（4D）+ 上方甘特與成本曲線（5D）；衝突時段標紅點。
- **後端**：USD timeSamples + schedule overlay + 成本表。

### A7 · Reality Capture 比對（P2 · OMNI · Phase 4）
- **做什麼**：現場點雲／NeRF 疊設計模型，用顏色標「蓋的跟畫的差多少」。
- **在介面哪裡**：設計＋掃描**疊圖**，熱力色標偏差；超標部位列偏差報告。
- **後端**：point-cloud loader + USD Mesh compare。

### A8 · Synthetic Data Studio（P1 · OMNI · Phase 4）
- **做什麼**：用 BIM 生成 AI 訓練資料（工安、設備辨識、缺陷偵測）。
- **在介面哪裡**：**Job 卡片**（選場景／相機／格式）→ 縮圖牆顯示 RGB／深度／分割／標註框。
- **怎麼操作**：建立 Dataset Job → 頂部 QUEUE 顯示算圖進度（吃 GPU）。
- **後端**：omni.replicator + BasicWriter + COCO/YOLO 匯出。

### A9 · 設計／審查 Copilot（P2 · OMNI · Phase 4）
- **做什麼**：自然語言產生 Python-USD code、改場景、查 OpenUSD API。
- **在介面哪裡**：左對話、右**程式／場景預覽**。
- **安全**：所有改動只寫 **session layer**，可一鍵還原、不碰 source model。
- **後端**：usd-code microservice + kit-mcp。

### A10 · 機器人／自動巡檢模擬（P2 · OMNI · Phase 4）
- **做什麼**：模擬機器狗／無人機巡檢路線、避障、拍照、讀表。
- **在介面哪裡**：3D 場景畫**巡檢路徑**，沿線走、遇障繞行；列出每點要拍／要讀清單，可回放。
- **後端**：Isaac Sim + USD robots + 路徑規劃。

---

## 6.5 3D Viewer 如何呈現（A1–A10）

落地端 GPU 跑 Omniverse Kit，USD 場景以 RTX 算圖、60fps WebRTC 串到瀏覽器（客戶端不下載模型）。**同一個 viewport，A1–A10 各自灌不同東西、控制不同。**

### 共用 viewer 框架（所有應用共用）
環繞／縮放、isolate 隔離、section 剖面、measure 量測、screenshot 存證、prim 級高亮（走 WebRTC DataChannel `highlightPrimsRequest`）。每個應用只是換「看什麼、標什麼、怎麼互動」。

### 三種角色（重要邊界）
- **核心舞台**：3D 是主角，少了它功能就不完整 — A3、A5、A6、A7、A10。
- **選用疊加**：核心結果可由 API / 表格 / BCF 交付；若要在 3D Viewer 裡高亮或飛到構件，必須有 GPU-backed review session — A1、A2、A4。**呼應架構文件「不要把 Kit 包裝成 governance 賣點」，但不把 GPU 前提說成可忽略。**
- **算圖取景台**：viewer 拿來生訓練資料，不是審查 — A8。
- **AI 動作預覽**：viewer 用來看 AI 改了什麼 — A9。

### 逐一對照

| App | 3D 角色 | viewer 裡看到什麼 | 互動 | 技術 |
|---|---|---|---|---|
| A1 治理檢核 | 選用疊加 | 失敗構件紅色高亮（需 GPU viewport；無 viewport 時只交付表格 / Issue / BCF） | 點規則列飛到構件、截圖存進 BCF（待 viewer DataChannel evidence） | `highlightPrimsRequest` |
| A2 版本差異 | 選用疊加 | onion-skin：新增綠、刪除以紅幽靈留原位、修改黃 | 單窗疊加或左右雙窗同步環繞 | UsdDiff · ghost overlay |
| A3 跨專業疊合 | 核心舞台 | 各專業半透明圖層疊同場景、碰撞點紅色發光球 | 點碰撞飛到衝突、高亮兩個打架構件、剖面看穿樑 | USD layer stack · clash |
| A4 語意搜尋 | 選用疊加 | 符合構件高亮、其餘變暗（isolate） | 清單與 3D 雙向連動、框選轉 Issue | search microservice |
| A5 IoT/FM | 核心舞台 | 感測圖釘掛構件（綠／黃／紅）＋樓層熱力圖 | 點設備看即時值與歷史、時間軸回放 | MQTT · 即時貼 prim |
| A6 4D/5D | 核心舞台 | 構件依排程「長出來」：未建半透明、當期高亮、已建實體 | 拖時間軸、衝突時段標紅、吊裝路徑動畫 | USD timeSamples |
| A7 Reality Capture | 核心舞台 | 設計＋現場點雲／NeRF 疊圖，表面塗偏差熱力色 | 切只看掃描／設計／疊加、剖面看內部偏差 | point cloud · Mesh compare |
| A8 Synthetic Data | 算圖取景台 | 相機視錐取景＋光照材質隨機化預覽 | 設好送算圖，輸出 RGB／深度／分割／框 | omni.replicator |
| A9 Copilot | AI 動作預覽 | AI 產生 USD code 後即時套用，被改 prim 高亮 | 一鍵還原（切 session layer 可見性） | usd-code · session only |
| A10 機器人巡檢 | 核心舞台 | 巡檢路徑線、機器人沿線移動、相機視錐標拍照點 | 切機器人第一人稱、遇障繞行、回放 | Isaac Sim · 物理 |

> 原型新增「3D Viewer 呈現」一頁（左側 OMNIVERSE RUNTIME 群第一個），把上表做成可點的卡片＋迷你 viewport 示意，每張卡可直接跳到該應用。

---

## 7. 右側 Chat USD Agent（AI 助理）規格

- **隨頁變化的建議指令**：每頁給 3 條跟當頁有關的白話指令（A1 給「找 FireRating 空值的防火門並建 issue」；A2 給「v07 改了什麼」）。
- **工具呼叫透明化**：AI 回答時逐筆顯示呼叫了哪些 MCP 工具、耗時、結果——例如 A1 場景會依序顯示 `kit_mcp.search_prims` → `usd_code_mcp.query_attr` → `qa_engine.rule_lookup`，最後給結論與「要我現在建立嗎？」。
- **動作前確認**：任何會改東西的動作（建立 Issue、批次修改）都先問使用者確認，不擅自執行。
- **邊界**：底部固定一行「AI 只在 session layer 操作 · 不直接改 source model」——呼應架構文件 `session layer only writes`。

---

## 8. 關鍵互動流程

1. **跨應用待辦彙整**：首頁「系統建議你先處理」把 A1 檢核失敗、A2 成本變更、A3 衝突、A5 逾期工單彙整成一張清單，每筆標來源、可一鍵跳到對應頁。
2. **A1 五步閉環**：上傳→檢核→結果→Issue→BCF，步驟可點、可重跑；高亮按鈕連動 GPU 審查室。
3. **Issue 共同出海口**：A1/A2/A3/A5 開的問題全部丟進同一個 Issue/BCF 中心，用同一套 schema，統一指派、打包交付。**工程上每個應用只要把問題丟進同一 Issue schema，不必各做各的。**

---

## 9. 安全與權限在介面的體現

- 對應架構「六層防線」：SSO → Token → RBAC → HTTPS → 資料隔離 → 內網儲存。
- **RBAC 三級**（管理員／管理者／檢視者）在系統管理頁以角色標呈現，依專案指派。
- **危險動作一律真人確認**：改權限、硬刪資料、送出 BCF、批次修改——介面會跳確認，AI 與自動流程不代勞。

---

## 10. 工程實作建議

- **單頁應用**：原型用單檔 HTML/CSS/JS 做示意；repo 正式產品殼層落在 `web-viewer-sample` 的 **React 18 + TypeScript EdgeConsole**，由 coordinator `/ui` 提供，不改用外部設計站 runtime。
- **資料來源**：CORE 群（A1–A5、Issue、報表）的規則、Issue、BCF 與報表走一般後端 API（governance-service / coordinator / Postgres / MinIO）；任何 3D Viewer、高亮、first frame、session 或 Kit viewport 證據都走 OMNIVERSE RUNTIME（Kit + WebRTC + MCP sidecars：`kit-mcp:9902 / usd-code-mcp:9903 / omni-ui-mcp:9901`）。
- **3D 串流**：以 WebRTC 從落地端 GPU 串瀏覽器；高亮指令走 DataChannel（`highlightPrimsRequest`）。
- **AI 整合**：右側 Agent 接 NeMo Agent Toolkit 的 `streamable-http /mcp`；前端只負責顯示工具呼叫軌跡與確認對話。
- **誠實標記要可由後端驅動**：每個功能的可信度（已實作／實測／示範／待建）建議做成設定，不要寫死在前端，方便隨開發進度更新。

---

## 10.5 落地端控制台（Coordinator · 1..N GPU）

新增一個導覽群「**落地端控制台**」，把維運／控制平面的事放在一起，對應系統架構的 Coordinator（:8004 控制塔）。共四頁。

EdgeConsole product shell route 對照：

| Route | 頁面 | 驗收重點 |
|---|---|---|
| `/ui` | 今天要做什麼 | 顯示 Smart Todo / 核心治理 / OMNIVERSE RUNTIME / 落地端控制台入口 |
| `#/a1` | A1 治理與模型檢核 | 五步引導流程、governance-service :49102、3D 高亮誠實標待建 |
| `#/viewer` | 3D Viewer 呈現 | DataChannel、`highlightPrimsRequest`、first frame / stage truth 誠實標 |
| `#/conv` | IFC→USD 轉檔排程 | conversion authority / mapping coverage / queue 狀態 |
| `#/sessions` | Session 管理 | primary / spectator、first frame / heartbeat / stage match |
| `#/instances` | Kit / GPU 機隊 | `1 GPU = 1 Kit stream`、重啟搬移 / drain，不宣稱無縫遷移 |
| `#/minio` | MinIO 資料 | `bim-control/`、`model.ifc`、`model.usdc` 等真實路徑語意 |
| `#/kit`, `#/demo-control` | operator tools | 舊操作工具保留，不 silently 砍 |

### MinIO 實際資料結構（已從你的 MinIO server 確認）

bucket `bim-control`（PRIVATE · 12.6 GiB · 867 objects）：

```
bim-control/
└── {projectId}              270 / 899 / 988          ← 專案
    └── {modelId UUID}       例 123a909a-0f28-…        ← 一個模型
        ├── model.ifc        65.7 MB   來源 IFC（轉檔輸入）
        ├── model.rvt        222.9 MB  來源 Revit
        ├── elements.json    1.0 MB    解析：元素屬性
        ├── geometries.json  49.7 MB   解析：幾何
        ├── geometries_chunks/         串流分塊 manifest.json + chunk_0…6
        ├── spatial_tree.json 2.3 KB   解析：空間樹（樓層/空間）
        └── model.usdc      （待產生）  ← 轉檔輸出，目前還沒有
```

**完整規劃結構（三層，使用者確認）**：`{projectId}` / `{OpenBIM 類別：機電・消防・管線・施工・牆面…}` / `{版本 v01・v02…}` / 檔案。目前 MinIO 第二層以 UUID 儲存（邏輯上＝類別），第三層「版本」**尚未實作**。轉好的 USD 以 projectId 為索引寫回同一資料夾（`model.usdc`）。應用對應：同專案的多個類別 → A3 跨專業疊合；版本層 → A2 版本差異。

關鍵：每個模型資料夾目前**沒有 `.usd`** — 這正是轉檔排程要產生並回寫的東西。介面所有路徑、專案 / 模型代號都比照此真實結構。

### ① IFC→USD 轉檔排程
- **流程**：MinIO 偵測到新 `model.ifc` → 進佇列 → 指派給 conversion authority worker（IfcOpenShell→USD）→ `model.usdc` 寫回同一個 modelId 資料夾 → 通知 Kit / GPU session 可載入。
- **介面**：管線五步圖 + 狀態記分板（轉檔中／排隊／完成／失敗）+ 佇列表（JOB·來源·狀態·指派·進度·coverage）+ 排程設定（自動偵測開關、每 GPU 並行數、優先序可手動插隊）。
- **誠實**：對齊架構「不承諾 100% 無損」，每任務出 mapping coverage 報告；Conversion authority 為後端待建（P1）。

### ② Session 管理（多 Session）
- **模型**：採用 02 線稿的 **endpoint pool** — 一個 Kit process 有 1 個 PRIMARY（操作者）+ N 個 SPECTATOR（旁觀者）埠，多 viewer 共看同一 session。
- **健康判定**：看「viewer 真的收到 frame」，不是看埠有沒有 listen（`port has listen ≠ viewer sees frame`）。reserved/waiting 太久就強制釋放回收。
- **介面**：在線 session 清單（session↔Kit↔GPU）+ 展開的端點池表（TYPE·PORT·STATE·VIEWER·LAST HB·LAST FRAME）+ 動作（加 spectator／凍結快照／強制釋放／結束）。

### ③ Kit / GPU 機隊（多 Kit instance · 1..N GPU）
- **模型**：落地端 1..N 台 GPU，**每台跑一個 Kit instance**；Coordinator 依各節點空閒度把模型 / session 排過去。要擴充就再加一台 GPU，自動多一個節點。
  - **已向 NVIDIA 官方核實**：Kit App Streaming 文件明訂 GPU「**1 per stream**」、每個 GPU worker 限一個 stream，故「一台 GPU 一個 Kit instance」成立，**同時 session 數 ≤ GPU 數**。多個 spectator 共看同一 stream 不另吃 GPU；若 spectator 要各自獨立鏡頭，才需各自一個 GPU。來源：https://docs.omniverse.nvidia.com/ovas/latest/deployments/infra/requirements.html
  - **session 不能無縫搬移 GPU（官方核實）**：streaming session 綁在單一 GPU pod 上跑到結束，生命週期只有 create / connect / disconnect / terminate，**沒有 migrate API**。換 GPU = **terminate + recreate**（官方：啟動約 30–40 秒、重載 stage，shader cache 冷的話可達 15 分鐘以上）。原型的「拖 session 到別台」即對齊此模型：跳確認 → 在新節點重啟；另含 **drain**（K8s cordon，節點不接新 session）與「待排程 session」拖去偏好節點。**結論：不做會誤導的無縫遷移，只做官方支援的 重啟搬移 / 排程 / drain。** 來源：https://docs.omniverse.nvidia.com/ovas/latest/deployments/infra/limitations_etc.html
- **分工**：轉檔吃 CPU（IfcOpenShell），審查串流吃 GPU（Kit / RTX）。新 session 優先排到 util 低的節點。
- **介面**：GPU 節點卡（GPU 型號·util·VRAM·Kit PID/埠·載入 stage·服務 session·端點池·健康）+ 可擴充提示 + 動作（載入模型／重啟 Kit／排空 drain／健康檢查）。

### ④ MinIO 資料
- 把上面的真實結構做成可讀的瀏覽介面：專案（270/899/988）→ 模型 UUID → 檔案，每個檔案標角色（來源／已解析／待產生）。讓「複雜結構」一眼看懂，也說明它怎麼接到轉檔、Session、機隊。

> 三頁互相扣：**轉檔排程**的每筆任務 = 一個 modelId；**機隊**載入的 stage = 同一個 MinIO 路徑；**Session** 跑在某台機隊節點上。

---

## 11. 交付清單與目前狀態（誠實版）

| 項目 | 狀態 |
|---|---|
| 可點擊 HTML 原型（整合 A1–A10）| 🟢 已交付 `ai-bim-governance-prototype.html` |
| 本設計規格文件 | 🟢 已交付 |
| A1 五步引導流程（可互動）| 🟢 原型可走完整流程（示範資料）|
| 右側 AI 助理（建議指令＋工具呼叫示範）| 🟢 原型可互動（腳本化示範）|
| 3D Viewer 呈現頁（A1–A10 對照）| 🟢 已交付 |
| 落地端控制台：轉檔排程 / Session / Kit·GPU 機隊 / MinIO | 🟢 介面已交付（比照真實 MinIO 結構）|
| 三頁可互動：轉檔拖曳排程 / Session 端點池 / 機隊拖放重啟搬移 | 🟢 已交付（可拖、可點、會即時動，全對齊官方）|
| 轉檔排程後端（Conversion authority）| ⚪ 待建（架構標 P1）|
| Kit instance / WebRTC 實機串流 | ⚪ 開發中（原型為示意）|
| 真實後端串接 | ⚪ 待建（本原型為前端示意，資料為示範用）|
| 3D / WebRTC 實機串流 | ⚪ 待建（原型用線框示意 viewport）|

> 與系統總覽一致的態度：**畫面上沒有任何「假裝已完成」的東西**——能用的標已實作，示範的標示範，沒做的標待建。
