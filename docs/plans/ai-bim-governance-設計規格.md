# AI · BIM Governance — 設計規格（v2.1 · 2026-07-02 · 介面與 design-system 基礎）

> **v2.1 變更（2026-07-02，依使用者指令）**：§3 A1 改版（選檔雙來源取代上傳、新增 BCF 審查面板、3D 連動改 A1 連動橋證據 rail）；§4.2 `#sessions` 新增 A1 連動橋供應端；§4.3 `#minio` 更新為真 MinIO raw-folder 逐層已建。

> **本檔角色（效力＝設計規格層）**：本檔只負責「**長什麼樣 + 每頁介面分析**」。
> - **行為合約**（路由是否成立、功能是否存在、官方對齊）以《ai-bim-governance-互動實作規格與標準對齊.md》為準（最高效力）。
> - **順序 / 里程碑 / DoD** 以《ai-bim-governance-開發軌跡與執行計畫.md》（v3）為準。
> - 本檔（設計規格 v2）效力低於上述兩者；當本檔的視覺敘述與「功能是否已建」衝突時，**以 repo 現況 + 互動規格為準**。
> - 設計系統（styles.css / 元件）對「**視覺**」有約束力；對「**功能是否存在**」無約束力。
>
> 效力順序完整定義見《互動實作規格》§0 / 共用契約表（sharedSheet）§0。配套：可點擊原型 `ai-bim-governance-prototype.html`、3D 驗收示意 `ai-bim-geo-viewer-prototype.html`。
>
> **誠實第一**：本檔是「**過度宣稱更正**」的主責文件。任何介面分析**不得**把 A4–A10、A3 clash、真 MinIO 三層瀏覽、轉檔歷史頁寫成「已交付 / 已實作 / 顯示真實資料」。舊版本檔把 `#minio` 標成「🟢 介面已交付 / 顯示真實三層結構」、把 A4 寫成可交付——本版逐字更正（見 §5）。

---

## §0 這份文件怎麼用（給不懂工程的你）

這份是「說明書」：把介面背後的設計邏輯講清楚，讓工程師照著做、讓你照著驗收。

- 想掌握全貌 → 看 **§1 設計系統視覺基礎** + **§2 Edge Console 結構**。
- 想一條條驗收 A1–A10 「長在哪、怎麼操作、哪些是真的」→ 看 **§3**。
- 想看落地端控制台四頁（轉檔 / Session / 機隊 / MinIO）→ 看 **§4**。
- 最重要的誠實更正（MinIO / 轉檔 / A4）→ 看 **§5**。

一句話方向：**暗色 Edge Console 專業感不變，但把每個動作講白話、像「跟著步驟走」，並誠實標清楚哪些能用、哪些待建。**

### 詞彙與裁決源（避免漂移）

| 名詞 | 在本檔的意思 | 唯一裁決源 |
|---|---|---|
| route / hash | EdgeConsole 的 hash（`#a1`，**無斜線**），對應 `EdgeConsole.tsx` switch case key 與 `PAGES[].key` | 互動規格 §A.1.1（22 條正典路由） |
| `RM_APPS[].route` / `A1A10[].route` | App 卡的**內部跳轉目標**（如 A1→`issues`、A4→`app/ai-search`），**與 hash `#a1` 不同**，勿混為一談 | `web-viewer-sample/src/console/data.ts` |
| A4 狀態 | A4 = **NOT BUILT · p4**（願景 Phase 4），3D 高亮 todo | 對齊矩陣 §3 為唯一裁決源；本檔僅引用，不另展開論證 |
| 功能是否已建 | 一律以 repo + tests 為行為真相，docs 不得當行為權威 | repo / sharedSheet §3 |

---

## §1 Design System 視覺基礎（binding：視覺）

> 本節對「視覺」有約束力。**預設識別＝暗色 Edge Console**；淺色 docs 面為次要。所有 token 數值為「示意，以 `styles.css` 為唯一真相」，文件不另定 px。

### §1.1 唯一入口與主題切換

```html
<link rel="stylesheet" href="<DS_ROOT>/styles.css">   <!-- 暗色 Edge Console 預設 -->
<div class="theme-docs"> ... </div>                    <!-- 包起來切淺色 docs 面 -->
```

- **唯一入口＝`styles.css`**；不在元件內各寫一套色。
- 預設身分＝暗色 Edge Console；`theme-docs` 才切淺色（用於文件頁 `#spec`）。

### §1.2 Plane 色碼（部署邊界的視覺暗示）

| Plane | 色 | 語意 |
|---|---|---|
| CORE | cyan | CPU / API 可交付（governance-service / coordinator） |
| OMNIVERSE | green（品牌綠 `#84c714`） | 需 GPU / Kit viewport 的加值功能 |
| AI | violet | AI / Copilot |

> 使用者一眼分辨「哪些是 API/CPU 可交付、哪些要 GPU viewport」，呼應架構「不要把 Kit 包裝成 governance 賣點」。

### §1.3 Token 速查（數值示意，以 styles.css 為唯一真相）

| 類 | token | 備註 |
|---|---|---|
| 面 | `--bg --surface --surface-2 --raised` | 由深到凸 |
| 線 | `--line --line-2` | 髮線 |
| 文 | `--text --text-2 --text-3 --text-4` | 主到弱四階 |
| 強調（品牌綠 `#84c714`） | `--accent --accent-deep --accent-soft --accent-ring --on-accent` | 主要按鈕 / 通過 / running |
| 語意色（**不可互換**） | `--info`(cyan `#46c7e6`) `--warn`(amber `#f2b43b`) `--err`(red `#f0635f`) `--ai`(violet `#9a8cff`) 各帶 `-soft` | info≠warn≠err≠ai |
| 狀態 | `--ok --warn --err --ai --idle` | StatusLED glow 只加在有狀態意義者；`idle` 無 glow；`.pulse`＝live |
| Prov | `--prov-built/-bg --prov-artifact/-bg --prov-demo/-bg --prov-ai/-bg --prov-todo/-bg` | demo / todo 帶**虛線框** |
| 字 | `--font-sans`(Plus Jakarta Sans + Noto Sans TC) `--font-mono`(JetBrains Mono) | mono label `letter-spacing .12em uppercase` 標機器權威事實（port / enum / status） |
| 字級 | `--fs-page(27) --fs-h2(21) --fs-body(15) --fs-mono(11)` | 數值示意 |
| 間距 | `--sp-1..--sp-12 --pad-card(16) --pad-page(30) --content-max(1080)` | 主內容置中、最大寬 1080 |
| 圓角 | `--radius-xs(6) --radius-sm(10) --radius(14) --radius-pill` | 柔化 |
| 影 / 動 | `--shadow-1 --shadow-2 --glow-accent`；`--ease cubic-bezier(.4,0,.2,1) --dur(.2s) --dur-fast(.13s) --dur-slow(.3s)` | 見 §1.6 |

- dot-grid 背景 + radial green wash 為暗色面的招牌底紋（弱對比，不搶內容）。
- **No emoji** 在 product chrome；狀態一律用 StatusLED + ProvTag 表達。
- 頁標題格式：**中文主標 + English/code 副標**（例「治理與模型檢核 · Governance & Rule Checker」）。
- 缺值一律寫「**未取得**」，絕不偽綠。

### §1.4 13 元件 props 契約速查

| 元件 | 重點 props / 行為 |
|---|---|
| Button | variant（primary 用 `--accent`）/ size / disabled（**前端 `disabled` 不是授權邊界，僅 UX**） |
| ProvTag | 五類見 §1.5；demo / todo 帶虛線框 |
| StatusLED | 有狀態意義才 glow；idle 無 glow；`.pulse`＝live |
| Pill | 左 mono 標籤 + 右值 + ▾（頂欄專案 / 版本切換） |
| Badge | 小徽章（如 P0 / MVP / A1） |
| Card | 卡片容器（`--radius` + `--pad-card`） |
| Panel | `phase` 變體＝hatched 紅 header（標 NOT BUILT 區塊） |
| MetricCard | 大數字用 `tabular-nums`（對齊；記分板） |
| Stepper | 圓號碼 + 標籤；完成綠勾、目前綠光圈（A1 五步） |
| NavItem | **plane 決定 active bar 色**（CORE cyan / OMNIVERSE green / AI violet） |
| ChatToolCall | 工具名 + 耗時 + 結果，逐筆堆疊（右側 Agent rail） |
| HealthChip | 缺值顯「未取得」+ idle LED，不偽綠 |
| LangToggle | 中 / EN 切換 |

lib：`AIBIM.tt(node,lang)`（i18n）/ `AIBIM.useLang()` / `AIBIM.usePersistentState(key,fallback)`（localStorage prefix `aibim:`；**cache 非 source of truth**，load 時對後端 reconcile、server win）。

### §1.5 ProvTag 五類視覺 + repo 七值對映（誠實簽名機制）

設計系統五類：

| 類別 | 語意 | 視覺 |
|---|---|---|
| `built` | AS-BUILT 已實作 | 實線綠 |
| `artifact` | ARTIFACT 實測輸出 | 實線青 |
| `demo` | DEMO DATA 示範 | **1px dashed amber** |
| `ai` | AI / PHASE 1.5 | 紫 |
| `todo` | NOT BUILT 待建 | **1px dashed 灰** |

> dashed 規格以 `styles.css` 的 `--prov-*` token 為準，文件不另定 px。

**重要對映**：repo `data.ts` 的 `Prov` 型別**僅 7 值、無 `todo`**：`asbuilt | artifact | demo | p1 | p15 | p3 | p4`（寫 `prov="todo"` 會 TS2322）。文件層「待建」對映 repo 的 `p1/p15/p3/p4`：

| 設計系統類別 | repo `Prov` 值 | 標籤 |
|---|---|---|
| built | `asbuilt` | 已實作 |
| artifact | `artifact` | 實測 artifact |
| demo | `demo` | 示範資料 |
| ai | `p15` | 後端待建 · P1.5 |
| todo | `p1` / `p3` / `p4` | 後端待建 · P1 / 願景 Phase 3 / 願景 Phase 4 |

### §1.6 動效鐵律

- route 轉場：opacity + `translateY(6→0)`，約 0.28s（fade-up）。
- hover：`brightness(1.06)`，**不 darken**。
- **禁** bounce / parallax。
- 守 `prefers-reduced-motion` 與 `[data-anim="off"]`；對比達 **WCAG 2.2 AA**。

---

## §2 Edge Console Shell 結構

> 正式產品殼層＝coordinator `/ui` 掛載的 **React 18 + TypeScript EdgeConsole**（非外部設計站 runtime）。

### §2.1 1440×900 五區 Grid

```
rows  50 / 1fr / 32      cols  240 / 1fr / 380
┌───────────────────────────────────────────────────────────┐
│ ec-top  專案▾ 版本▾ 階段 | KIT GPU QUEUE MCP | 使用者          │ 50
├──────────┬──────────────────────────────┬──────────────────┤
│ ec-nav   │  ec-main（主工作區 · fade-up） │ ec-agent          │ 1fr
│ 四分組   │  標題→這頁在做什麼→主畫面→     │ ChatToolCall      │
│ plane dot│  介面分析→後端依賴→provenance  │ 工具呼叫軌跡        │
├──────────┴──────────────────────────────┴──────────────────┤
│ ec-foot  job bar（轉檔 / session 任務列）                      │ 32
└───────────────────────────────────────────────────────────┘
```

- `ec-top`：左＝我在看哪個專案 / 版本 / 階段；右＝落地端健康（Kit / GPU / QUEUE / MCP，HealthChip 缺值寫「未取得」）。
- `ec-main`：route 切換走 fade-up。
- `ec-agent`：右側 AI rail，`data-agent="off"` 可收第三欄把空間讓給 3D / 表格。
- `ec-foot`：底部 job bar。

### §2.2 Nav 分組與 plane 色碼

> NavItem 的 active bar 色由 plane 決定。完整 22 條路由以互動規格 §A.1.1 正典表為準，本節只描述分群語意。

| 分組 group | plane（主） | 內容 |
|---|---|---|
| workspace | CORE | `#home` 今天要做什麼 |
| core | CORE | `#a1`–`#a5`、`#issues`(BC)、`#reports`(RP) |
| omniverse | OMNIVERSE | `#viewer`(3D)、`#gpu`(01 別名 `#review`)、`#a6`–`#a10` |
| coordinator | CORE / OMNIVERSE 混 | `#conv`、`#sessions`、`#instances`、`#minio` |
| system | CORE | `#runtime`(RT)、`#admin`(SY 待建)、`#spec`(▦) |

> **保留別名 / operator route**（不砍、不列入 22 條主表）：`#review`（GPU 審查室別名）、`#kit`、`#demo-control`（operator）、以及 data.ts 既有 deep-link aliases `overview / coordinator / intake / semantic / apps`。
>
> **注意 `#review` 雙義**：repo `EdgeConsole.tsx` 既有 `case "review"`＝**ReviewRoomPage**（與 `#gpu` 是兩個不同頁）；正典語意上 `#review` 又是「`#gpu` GPU 審查室別名」。HTML / 殼層重生時**不可把既有 ReviewRoomPage 連結改斷**。
>
> `/ui/open?session=:id` 為**凍結 handoff path**（byte-for-byte），禁 `/ui/*` 萬用 redirect 吃掉。

### §2.3 host-native vs container plane 分離（鐵律）

> 這條邊界決定每頁「依賴掛在哪、為什麼 GPU 受限」，重生 prototype 時每頁「依賴列表」須標 host-native / container 歸屬。

- **host-native**：governance-service（CPU / browser 不直連，一律經 coordinator proxy）、Kit runtime、IFC→USD 轉檔。
- **container plane**：只跑 web plane（coordinator / viewer 容器）；**缺 Vulkan ICD → GPU 受限的是容器，不是這台機器**（host 有 RTX 4060 Ti + host-native Kit）。
- 無遙測一律標「未取得」，不畫 fail。

---

## §3 A1–A10 介面分析（每頁：persona → trigger → journey → persists → provenance 邊界 → 元件組合 → 狀態）

> 本節是驗收核心。**功能是否已建以 sharedSheet §3 / repo 為準；本節寫「介面長相」不得反向把待建寫成已建。**

### A1 · 治理與模型檢核 [P0]（`#a1` · governance / core · **built**）—— **v2 改版 2026-07-02**

- **persona**：品管 / BIM 經理，要在交付前把 IFC 的命名、分類、樓層、空間、設備編碼、LOD/LOI、交付規範一次檢核。
- **trigger**：從「偵測到的 IFC」選檔（**不再是拖檔上傳**）→ 啟動 rule-run。
- **journey**：5-step **Stepper**（① 選檔（雙來源）→ ② 檢核（進度 + 逐條 log）→ ③ 結果 → ④ 審查（失敗轉 Issue + BCF topic 狀態流轉）→ ⑤ 交付（BCF 2.1 + Excel））。
- **① 選檔區（新）**：來源切換兩顆 pill——**local_fs 檔案庫**（`GET /api/governance/files/tree`，built）／**MinIO bucket 偵測**（`GET /api/minio/objects?prefix=&delimiter=/`，built·唯讀，只列 .ifc）；選檔元件三樣式原型供挑（**下拉 optgroup／級聯 pills／樹狀**，正式版擇一）；選定後顯示完整 key、大小、mtime，一律標「**測試資料**」徽章；未選檔＝模式 6 空狀態，不補假列；**選檔不觸發轉檔**。
- **元件組合**：來源切換 pills + 選檔元件（三樣式之一）+ Stepper + 4 格記分板 **MetricCard**（通過 / 擋下 / 通過率 / 構件數，`tabular-nums`）+ 規則清單 **Panel**（紅燈可點開）+ **BCF 審查面板**（topic 列：ID·標題·規則碼·severity·狀態 chip 可流轉·指派 dashed 待建標）+ **A1 連動橋**（四格證據 rail + GUID 佇列 + 高亮鍵）。**3D 連動不用 Panel(phase=hatched) 視窗佔位、不畫斜線底圖**，改用 A1 自己的證據 rail 風格（IX-A1-08）。
- **persists**：rule-run 結果 / Issue / diff / federation 入 **governance-service 本地 SQLite**（`governance-service/db.py` · `governance.db`，host-native · CPU）；專案 / 版本 / artifact metadata 權威在雲端 `bim-control · MySQL`；BCF 打包輸出寫 MinIO。（**非 Postgres**——design-system `persistence.md` 的 Postgres 與 repo 不符，以 repo 為準。）
- **provenance 邊界**：規則引擎 `built`（`asbuilt`；rule_engine + ifctester(IDS) + BCF 2.1 純 stdlib + issues）；選檔雙來源兩條 API 皆 `built`；BCF 審查面板：列表／狀態流轉 `built`（issues API）、**指派 assignee 待建 P1**；**3D 高亮 = P1.5 待建**（需 viewer DataChannel + first frame；證據以 `#sessions` 為單一來源，IX-SS-05）。
- **誠實警示**：**記分板數字一律標示為「實 run 輸出」或「範例」，禁寫死假數**（禁 127 rules / 治理分數 / 99.x% GUID）。連動橋證據未齊時高亮鍵 disabled + 原因可讀，不得宣稱已完成 3D 高亮；MinIO 來源檔案皆測試資料，UI 必標。

### A2 · 版本差異與責任（`#a2` · governance / core · **built**）

- **persona**：設計 / 監造，要看 v06→v07 加了 / 改了 / 刪了什麼，並追「誰改、何時」。
- **trigger**：選兩個版本。
- **journey**：版本選擇 **Panel** → ADD / MOD / DEL 三格 **MetricCard**（**綠加 / 黃改 / 紅刪**）→ 變更清單選取 → 點任一筆飛到該構件 → Accountability **Panel**（author + timestamp）。
- **provenance 邊界**：`built`（`asbuilt`）；diff 來源 = `ifcdiff` / GlobalId artifact（多級 GlobalId + `geometry_changed` opt-in via `ifcopenshell.geom` + issue-impact）。`ifc_type` / `ifc_name` 落庫 bug 已修（PR #242）。
- **誠實警示**：**A2 頁不得出現「成本影響」塊**——成本（5D / S-curve）屬 **A6 / A9 範疇、非 A2**，A2 不呈現（避免製造「A2 有成本功能」假象）。

### A3 · 跨專業疊合（`#a3` · governance / core · **拆分：federation built / clash NOT BUILT**）

- **persona**：協調 / 整合工程師，要把建築 / 結構 / 機電 / 水電疊一起找碰撞。
- **journey**：圖層切換 buttons（federation）+ 3D placeholder + 碰撞清單 **Panel**。
- **provenance 邊界**：
  - **federation = built**（`asbuilt`；USD sublayer 聯邦 + per-member transform + review-room handoff）。圖層切換可呈現。
  - **clash = NOT BUILT**：碰撞清單 **Panel 標 `spec · blocked-on-OCC`**。卡 `ifcopenshell` 缺 OpenCASCADE（`has_occ=False`），出不了真實 clash 數、不在主分支（spike 未 push）。**不得顯示任何真實 clash 數字。**

### A4 · 語意搜尋問答（`#a4` · governance / core · **NOT BUILT · p4**）

- **裁決**：A4 = **NOT BUILT · p4（願景 Phase 4）**，裁決見對齊矩陣 §3。本檔僅引用、不展開論證。
- **journey（願景示意）**：白話搜尋 input + 範例提示 + 結果 **Panel** + 3D 高亮 **Panel(phase)**。
- **provenance 邊界**：**全頁 vision 框（dashed Phase 4）**。repo 無 pgvector / element_search_index / `/api/search/model` 任何程式碼（`AppVisionPage`）。
- **誠實警示（基準 #5 在此更正）**：**禁**寫成「已交付 / hero built / search microservice + vector index 已建」。Hero built ＝ A1 + A2 + A3-federation，**A4 不在內**。

### A5 · IoT / FM 數位分身（`#a5` · governance / core · **NOT BUILT · p3**）

- **journey（願景示意）**：3D 感測點 placeholder（綠正常 / 黃警示）+ 即時值 **MetricCard** + mini 趨勢曲線 + 工單面板。
- **provenance 邊界**：全頁標 demo / 願景 Phase 3，直到 MQTT bridge + TimescaleDB/Influx + 工單 API 到位（`prov=p3`）。

### A6–A10 · 願景應用（`#a6`–`#a10` · omniverse · **NOT BUILT · p4**）

> 用 **ScenarioPage**：persona callout + 3D placeholder + 操作流程 `ol` + SpecList。**全標願景 Phase 4 + GPU-bound**；scenario 具體數字（「312 扇門」「17000 frames」等）一律為**願景敘事**，**禁當實測**。

| App | 願景 | provenance |
|---|---|---|
| A6 4D/5D 施工模擬 | 時間軸 + 甘特 + 成本曲線；構件依排程「長出來」 | `p4`（GPU-bound）。註：`RM_APPS` 標 `phase:2`，但 GPU-bound 實際待建，狀態以 repo `prov=p4` 為準 |
| A7 Reality Capture | 設計 + 點雲 / NeRF 疊圖，偏差熱力色 | `p4`（GPU-bound；需 usd-code-mcp 驗 mesh-compare） |
| A8 Synthetic Data | Job 卡 + RGB/深度/分割/標註縮圖牆 | `p4`（需先對齊 Omniverse Replicator 再寫） |
| A9 審查 Copilot | 左對話、右程式 / 場景預覽；只寫 session layer | `p4`（復用 ChatToolCall；**僅在 session layer**，非獨立 3D 場景） |
| A10 機器人巡檢 | 巡檢路徑線、機器人沿線移動、視錐標拍照點 | `p4`（Isaac-sim adjacent；先驗再宣稱） |

---

## §4 落地端控制台頁（coordinator group 四頁 · 重點章）

> 對應系統架構的 Coordinator（`127.0.0.1:8004` 控制塔）。三頁互扣：轉檔每筆任務＝一個 modelId；機隊載入的 stage＝同一 MinIO 路徑；Session 跑在某台機隊節點上。

### §4.1 `#conv` IFC→USD 轉檔排程 [P1]（built（intake）/ 轉檔歷史頁待建）

- **顯示**：**ifc-ready intake 佇列 + 即時 coverage**。佇列表（JOB · 來源 · 狀態 · 指派 · 進度 · coverage）+ 排程設定（自動偵測開關、每 GPU 並行數、優先序）。
- **prioritize / retry**：只對既有 ifc-ready job 排序 / 重試（**不是手動新建轉檔**）。
- **誠實警示（轉檔歷史頁待建）**：轉檔權威 `bim-streaming-server` **已落地**（非整體待建）；job **有持久化**（`stream_conv_*.json` + `GET /api/conversions` list/`/{id}`/`/{id}/result`）；coordinator 也有 `/api/dev/conversions` proxy 轉發 streaming list。**但前端 console 未渲染成「轉檔歷史紀錄頁」**。
  - **精確說法**：「job 在 streaming-server 有 JSON 持久化與 list API、coordinator 有 proxy 線，但**前端無轉檔歷史紀錄頁**（缺的是 UI 呈現層）」。**不可寫「完全無持久化 / 完全沒接線」。**
  - 真實 GPU 轉檔須 env 配 `adapter_from_env`，預設 `HeadlessConverterNotConfigured`；**live GPU 轉檔證據 not observed**。
- **coverage 註記**：`conv-coverage=1` 在 `usd_stage_enumeration` 下為結構性自我參照（同源 USD prim 枚舉），**非 IFC lossless**，UI 須加註（`conv-coverage-selfref-note`）；**不承諾 100% 無損**。

### §4.2 `#sessions` Session 管理（built） / `#instances` Kit·GPU 機隊（partial）

- **`#sessions`（built · coordinator :8004）**：在線 session 清單（session↔Kit↔GPU）+ 端點池表（TYPE · PORT · STATE · VIEWER · LAST HB · LAST FRAME）+ 動作（加 spectator / 凍結快照 / 強制釋放 / 結束）。健康判定看「viewer 真的收到 frame」，不是看埠 listen（`port has listen ≠ viewer sees frame`）。`SessionStatus` enum 後端逐字 echo。**v2 新增（2026-07-02）「A1 連動橋 · 供應端」面板**：繫結鏈 `A1 rule_run ⇢ session ⇢ DataChannel ⇢ highlight ack`；A1 頁四格證據（session 派發／首幀／DataChannel／stage matched）以本頁為單一來源（IX-SS-05），A1 只讀鏡射、不推定。
- **`#instances`（partial · 真遙測接 kit-manager-api :8010）**：GPU 節點卡（型號 · util · VRAM · Kit PID/埠 · 載入 stage · 服務 session · 端點池 · 健康）。**無遙測標「未取得」+ idle LED，不畫 fail**；部分卡片待建。`KitInstance.status` enum 後端逐字。
- **GPU 鐵律**：1 GPU = 1 Kit instance = 1 stream（同時 session ≤ GPU 數）；換 GPU = terminate + recreate（約 30–40 秒），**無 live migration**；spectator 共看同一 stream 不另吃 GPU。primary 信令 `49100`、spectator `49110` 起（`KIT_SPECTATOR_COUNT` 決定範圍，非只有 1 個）。

### §4.3 `#minio` MinIO 資料（2026-07-02 更新：真 MinIO raw-folder 逐層已建）

- **現況（已交付）**：頁面接 **真 MinIO raw-folder 逐層瀏覽**（coordinator `GET /api/minio/objects?prefix=&delimiter=/`，唯讀；folders[]=CommonPrefixes、objects[]=當層直屬檔），中文資料夾原樣顯示；另一路徑 `GET /api/governance/files/tree`（local_fs 兩層樹）繼續存在。**兩條路徑同時供 A1 v2 選檔雙來源使用（見 §3 A1），不得互冒。**
- **往下一層的語意（更正後）**：bucket layout panel（三層「專案/種類/版本」規約）仍以 `prov="demo"` 標「**watcher 解析語意 · 純語意參照**」——不得當成 bucket 實際結構宣稱。
- **逐字更正（2026-07-02）**：舊版「`#minio` 只顯示 local_fs 兩層樹，真 S3/MinIO 待接」已過時，更正為：「`#minio` 頁已接真 MinIO raw-folder 逐層瀏覽（唯讀）；三層『專案/種類/版本』語意仍僅為 watcher 解析語意，非 bucket 結構宣稱」。
- **兩條獨立資料路徑**：watcher 的三層 key 解析（見 §5）與 `#minio`／A1 選檔的兩條 list API 是**獨立路徑**：watcher 只管自動 intake（env opt-in 預設關），不餵 UI 列表；UI 列表也不觸發轉檔。

---

## §5 誠實版資料存放章（更正過度宣稱 · 本檔交付物核心）

> sharedSheet §4「四條釘子」逐字落地。三件事必須分開講，不可混為一談。

### §5.1 三表：偵測 / 轉檔紀錄 / 結構顯示頁

| 面向 | 真相 | 不可寫成 |
|---|---|---|
| **(a) MinIO watch 偵測** | **已實作**（`bim-review-coordinator/src/services/minioWatcher.ts` `deriveIntakeFromKey`）：解析 **≥3 段** key（`segments.length < 3` 擋）；`projectRaw=segments[0]`、**種類 = 倒數第二段**、**版本 = 末段**，中間動態層忽略；中文資料夾經 `sanitizeArtifactIdPart` → `mv_<hash8>`。env opt-in **預設關**；真實 MinIO endpoint（`192.168.20.234:9000` / bucket `bim-control`）由部署區 `.env` 注入（**outbound S3Client 外連依賴，非本 repo bind 的 loopback 埠**），不在程式碼硬編碼。**live 多層觸發證據 not observed。** | 「偵測未做」 |
| **(b) 轉檔紀錄** | job **有 JSON 持久化**（`stream_conv_*.json`）+ `GET /api/conversions` list API + coordinator `/api/dev/conversions` proxy 皆**存在**；**但前端無轉檔歷史紀錄頁**。真 GPU 轉檔須 `adapter_from_env`，預設 `HeadlessConverterNotConfigured`。 | 「完全無持久化」/「轉檔歷史頁已交付」 |
| **(c) 結構顯示頁 `#minio`** | **真 MinIO raw-folder 逐層瀏覽已交付**（`/api/minio/objects`，唯讀）；local_fs 樹 API 保留；兩者供 A1 v2 雙來源（見 §4.3）。三層「專案/種類/版本」仍僅為 watcher 解析語意。 | 「三層語意瀏覽器已建」／「仍只有 local_fs、真 MinIO 待接」（兩種都錯） |

### §5.2 觸發（無手動佇列觸發新轉檔）

- 自動觸發**僅靠 watcher 偵測到新 / 變更的 `*/model.ifc`**（同 key 同 etag 跳過 → `triggerIntake`）。
- **無已接線的手動佇列 / 插隊 UI 觸發新轉檔**：`#conv` 的 prioritize/retry 只對既有 ifc-ready job 排序 / 重試；`PUT /api/conversion/watch` 只開關 watcher 生命週期。

### §5.3 真 MinIO 三層結構＝語意參照（watcher 解析語意，非 bucket 結構宣稱）

- 真 MinIO 三層 key 規約（`bim-control/{projectId}/{類別}/{版本檔}`，種類 / 版本）僅作為「**待接的目標語意**」記錄於文件與 watcher 解析邏輯，**不得當成 `#minio` 已呈現的內容**。
- 短期真相源＝**local_fs storage**（比照三層規約；已落地 `270/機電|水電|消防/000001~000003＋竣工.ifc`）。
- 專案編號現況＝**270 / 889 / 990 ＋ 271**，**皆為 MinIO 暫時測試 IFC 檔**（**UI 須標示「測試資料」**）。
- 轉檔輸出 `model.usdc` 寫回對應位置 + coverage 報告（**不承諾 100% 無損**；conv-coverage=1 自我參照已加註）。

---

## §6 兩次 NVIDIA 官方核實摘要（保留 v2 既有）

> 視覺 / 介面承諾須與官方對齊；完整對齊鐵律見《互動實作規格》PART C / sharedSheet §7。本節僅保留兩條已核實結論。

1. **1 GPU = 1 stream（已核實）**：Kit App Streaming 文件明訂 GPU「1 per stream」、每 GPU worker 限一個 stream → 「一台 GPU 一個 Kit instance」成立，**同時 session 數 ≤ GPU 數**；spectator 共看同一 stream 不另吃 GPU。
   來源：https://docs.omniverse.nvidia.com/ovas/latest/deployments/infra/requirements.html
2. **無 live migration（已核實）**：streaming session 綁單一 GPU pod 跑到結束，生命週期只有 create / connect / disconnect / terminate，**沒有 migrate API**。換 GPU = terminate + recreate（啟動約 30–40 秒，shader cache 冷可達 15 分鐘以上）。介面只做官方支援的「重啟搬移 / 排程 / drain」，**不做會誤導的無縫遷移**。
   來源：https://docs.omniverse.nvidia.com/ovas/latest/deployments/infra/limitations_etc.html

---

## §7 誠實 / 對齊收尾聲明

- 本檔是「**過度宣稱更正**」的主責文件。
- 任何介面分析**不得**把 **A4–A10 / A3 clash / 真 MinIO 三層瀏覽 / 轉檔歷史頁**寫成已建。
- **A4 必須標 NOT BUILT · p4**（誠實基準 #5「A4 hero built」在此更正，裁決見對齊矩陣 §3）。
- token 與元件為**視覺 binding**；**功能狀態以 sharedSheet §3 / repo 為準**，docs 不得當行為權威。
- 視覺預設識別＝**暗色 Edge Console**；`styles.css` 為唯一入口，數值示意以 `styles.css` 為真相。
