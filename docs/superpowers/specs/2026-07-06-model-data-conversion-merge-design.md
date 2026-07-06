# 模型資料與轉檔（MD）：CV / M / IN 三頁合一設計

- 日期：2026-07-06
- 狀態：設計已由使用者確認（brainstorming 三決策：主從雙欄工作台／全域視圖去重化／命名「模型資料與轉檔」）
- 範圍：`web-viewer-sample` console 前端；後端 API 一律不改（後端凍結契約：只打 coordinator `:8004`）

## 1. 背景與驗證事實

三頁現況（皆已逐檔查證程式碼）：

| 頁 | 路由 | 元件 | 功能 |
|---|---|---|---|
| CV「IFC→USD 轉檔排程」 | `#conv` | `pages.tsx` `ConversionSchedulingPage` | ifc-ready 佇列全欄位表（lifecycle／失敗原因／插隊／重試／coverage drawer／SS·Review 跳轉）、MinIO watcher 面板＋開關（intent→confirm）、轉檔 Ledger 表（`GET /api/conversion/records`）＋失敗列觸發轉檔、轉檔歷史（`GET /api/dev/conversions`）、incoming handoff 重驗（job_id／conversion_id／minio_key） |
| M「MinIO 資料」 | `#minio` | `pages.tsx` `MinioDataPage` | 真實 S3 逐層資料夾導覽（快取＋世代守門＋SSE `minio.changed` stale 通知）、source IFC 掛 ledger chip＋觸發轉檔（intent→confirm）＋「轉檔 →」「A1 檢核 →」cross-link、DEMO bucket layout 規約示意、incoming handoff 重驗（minio_key／prefix） |
| IN「建模接收與轉換」 | `#intake` | `pages.tsx` `IntakePage` | ifc-ready 唯讀佇列表（欄位為 CV 子集，同一 API `GET /api/external/ifc-ready` limit 50）＋「CV →」「Review →」跳轉、純文案「轉換品質誠實標示」panel |

結論：**IN 功能是 CV 的真子集**（無任何 IN 獨有的動作）；M 與 CV 已共用 ledger 資料與 `POST /api/conversion/trigger`。三頁合一無後端相依。

關鍵事實（影響設計）：ifc-ready 佇列含**非 MinIO 來源的 job**（demo-control fixture、外部 webhook），這些 job 在檔案樹沒有節點，插隊／重試必須在全域佇列表可操作，不能只靠檔案視角。

## 2. 目標與非目標

**目標**

1. 三頁合併為單一入口「模型資料與轉檔」（nav 代號 `MD`；EN：`Model Data & Conversion`），落在既有 `#minio` 路由。
2. 以操作員心智設計：「我的檔案在哪 → 轉了沒 → 卡住怎麼辦 → 去審查」。
3. 功能零損失（見 §4 對映表）；誠實鐵律與既有重驗守門語意全數保留。

**非目標**

- 不改任何後端 API／coordinator／governance 程式。
- 不動 OperatorConsole 退役入口（`#/kit`、`#/demo-control`）與其專用的 `IntakeSelectPage.tsx`。
- 不改 `routing.ts` 的 `PRODUCT_CONSOLE_ROUTES`（`conv`／`intake` 仍須被認得，見 §5）。
- 不新增後端遙測或欄位；統計一律由既有回應真值計算。

## 3. 資訊架構：主從雙欄工作台

```txt
┌────────────────────────────────────────────────┐
│ 模型資料與轉檔          [自動偵測:開] [重新整理]  │
├───────────────┬────────────────────────────────┤
│ 左欄：檔案樹    │ 右欄（未選檔）：全域轉檔視圖       │
│ MinIO 逐層導覽 │  A. 摘要卡（watcher 開關＋統計）    │
│ ＋ledger chip │  B. 轉檔佇列表（全 job，含控制）    │
│               │  C. ▸ 轉檔歷史（折疊）             │
│               │────────────────────────────────│
│               │ 右欄（選中 source IFC）：單檔詳情   │
│               │  來源→佇列→轉檔→USDC→審查 生命週期  │
│               │  狀態／失敗原因／動作鈕／coverage    │
│               │  [開審查 Session →] [A1 檢核 →]    │
└───────────────┴────────────────────────────────┘
```

### 3.1 左欄：檔案樹（M 頁原樣搬移）

- 逐層導覽（`GET /api/minio/objects?delimiter=/`）、上一層鈕、麵包屑、refresh、cache hit／live list 標示、SSE stale 提示——**行為不變**。
- 每個 `role === "source_ifc"` 物件掛 ledger 狀態 chip（`ledgerChipStatus`：未轉／轉換中／ready／failed／狀態未明）；三段語意 badge（專案／種類／版本）照舊。
- 點選 source IFC → 右欄切單檔詳情；再點一次或點「返回總覽」→ 右欄回全域視圖。
- 資料夾 `has_source_ifc` badge 照舊。

### 3.2 右欄（未選檔）：全域轉檔視圖（去重化）

- **A. 摘要卡**：watcher 啟用狀態＋開關鈕（沿用 intent→confirm `IntentDialog`、防重入 ref、證據型刷新——POST 成功但重抓失敗時不關 dialog 顯誠實錯誤）；佇列統計（佇列中 N／轉換中 N／失敗 N／完成 N）由 ifc-ready＋ledger 回應真值計算；任一來源被回傳窗截斷（count > items.length）時統計旁標「（回傳窗內，非全量）」，不顯示假總數。watcher 診斷欄位（bucket／prefix／baseline／triggered／seen／一致性基準與 auto-enroll 說明、last_triggered 表）收進「展開細節」折疊區，文案沿用現有（含 §3.4 auto-enroll 說明與補救路徑說明）。
- **B. 轉檔佇列表**：CV 的 ifc-ready 表**全欄位保留**（job／key 三訊號（idem·replay·volatility）／lifecycle chip／project／usdc／conversion／dispatch 失敗原因（80 字截斷＋tooltip）／session（SS →、Review →）／stage／coverage drawer／插隊·重試控制）。新增一欄行為：列可對映回 MinIO 物件（ledger `object_key` 存在）時掛「檔案 →」鈕＝左欄導覽定位該檔並切單檔詳情。
- **C. 轉檔歷史**：`GET /api/dev/conversions` pass-through 表原樣，降為折疊區塊（prov=`artifact`、失敗顯「未取得」語意不變）。
- watcher 關閉時的頁頂琥珀警示條（「⚠ 自動偵測已關閉…」）保留於右欄頂。

**去重化**：CV 現有獨立「轉檔 Ledger 表」不再呈現為表。ledger 資料（`GET /api/conversion/records` limit 100）改為三處驅動：左欄 chip、單檔詳情、摘要統計。Ledger 表原有欄位在單檔詳情全數可見（§3.3）；原「來源 →」cross-link 由「左欄即來源」取代；原失敗列「觸發轉檔」鈕移入單檔詳情與佇列表。

### 3.3 右欄（選中 source IFC）：單檔詳情

由三源以既有鍵串接：minio object `idempotency_key` ↔ ledger `idempotency_key`；ledger `conversion_job_id` ↔ ifc-ready job `conversion_job_id`；ledger `object_key` ↔ minio `key`。

- **來源資訊**：object key、專案／種類／版本 badge、偵測時間（ledger `detected_at`）。
- **生命週期條**：偵測 → 佇列 → 轉檔 → USDC → 審查（沿用 `LifecycleStrip`＋`LEDGER_STATUS_PROV` 三色語意）。
- **狀態區**：ledger status chip、對應 conversion_job_id、usdc_key（null 標「待產生」p1）、失敗原因（failure_stage＋failure_reason 全文）。
- **動作區**（依狀態顯示，全部沿用既有 intent→confirm＋防重入＋證據型更新契約）：
  - 觸發轉檔（未轉／failed／狀態未明可按；`POST /api/conversion/trigger`）
  - 重試（對應 job `dispatch_failed`／`dropped_on_restart`）
  - 插隊（對應 job `queued_for_conversion` 且 queue_position > 1）
- **coverage 區**：對應 job 有 `conversion_job_id` 時掛 coverage 展開（沿用 `CoverageDrawer`＋快取／載入鎖／錯誤可重試守門）；附 IN 頁「品質誠實標示」文案精簡版（quality_metrics 為 pass-through artifact、不承諾精準 GUID、無遙測欄位標未取得）。
- **跳轉區**：「在 Session 管理檢視（SS →）」「Review Room 開啟（Review →）」（job 有 review_session_id 才掛）、「A1 檢核 →」（帶 minio_key handoff）。
- 對映缺口誠實顯示：object 查無 ledger 紀錄＝「未轉」；records 截斷或載入失敗＝「狀態未明」（indeterminate），**不臆測**。

### 3.4 incoming handoff（接收端重驗鐵律沿用）

新頁統一接收原 `conv` 與 `minio` 兩軸的 handoff payload：

- `minio_key` → 導覽左欄至 key 所在資料夾一次＋選中該檔（沿用現有「依導覽目標值為 dep 只跑一次」模式），向該層 objects 重驗。
- `job_id` → 對 ifc-ready jobs 重驗；命中則佇列表高亮該列。
- `conversion_id` → 對 ledger records 重驗。
- `prefix` → 保留能力（現無發送按鈕），導覽＋重驗語意照舊。
- 截斷（count > items.length）或未 settle → `indeterminate`；查無且未截斷 → `not_found`；無欄位可查 → `not_applicable`。`IncomingHandoffBanner` 語意不變。

## 4. 功能對映表（零損失驗證）

| # | 原頁功能 | 新去處 |
|---|---|---|
| 1 | M：資料夾導覽／SSE／refresh／cache／badge | 左欄原樣（§3.1） |
| 2 | M：source IFC ledger chip | 左欄原樣 |
| 3 | M：觸發轉檔＋IntentDialog | 單檔詳情動作區（§3.3） |
| 4 | M：「轉檔 →」cross-link | 由「點檔即詳情」取代（同頁） |
| 5 | M：「A1 檢核 →」cross-link | 單檔詳情跳轉區 |
| 6 | M：DEMO bucket layout 規約示意 | 頁尾折疊 panel，DEMO 標示照舊 |
| 7 | M：「與功能頁的關係」panel | 頁尾折疊 panel 併存 |
| 8 | CV：watcher 面板＋開關＋診斷欄位＋說明文案 | 摘要卡＋展開細節（§3.2A） |
| 9 | CV：watcher 關閉琥珀警示 | 右欄頂保留 |
| 10 | CV：ifc-ready 表全欄位＋插隊／重試／coverage | 全域佇列表（§3.2B） |
| 11 | CV：ledger 表 | 去重化：chip／詳情／統計三處驅動（§3.2） |
| 12 | CV：ledger 失敗列「觸發轉檔」 | 單檔詳情動作區＋佇列表 |
| 13 | CV：ledger「來源 →」跳 M | 左欄即來源（同頁定位） |
| 14 | CV：轉檔歷史 pass-through | 折疊區塊（§3.2C） |
| 15 | CV：SS →／Review → cross-link | 佇列表＋單檔詳情 |
| 16 | CV：incoming handoff 重驗（job_id／conversion_id／minio_key） | §3.4 |
| 17 | IN：ifc-ready 唯讀表 | 被 #10 涵蓋（原本即子集） |
| 18 | IN：「CV →」「Review →」跳轉 | 同頁佇列表＋Review → |
| 19 | IN：品質誠實標示 panel | 精簡併入單檔詳情 coverage 區（§3.3） |
| 20 | 三頁 IntentDialog 防重入／證據型更新契約 | 全數沿用（§3.2A、§3.3） |

## 5. 路由、導覽與跨頁契約

- `#minio` ＝新頁 MD。`#conv`、`#intake` 改為**重導 alias**：EdgeConsole `renderBody` 收到 `conv`／`intake` 時以 `window.location.replace`（或等效 hash 重寫）導向 `#minio` 並**保留 query string**（handoff id 由新頁照 §3.4 重驗）。依 `docs/plans/docs-plans-README.md` deep-link aliases 保留原則，路由不砍。
- `data.ts` `PAGES`：移除 `conv`、`intake` 兩項；`minio` 項改 `no: "MD"`、`label: "模型資料與轉檔"`。`NAV_LABEL`：`minio: { tech: "Model Data & Conversion", biz: "模型資料與轉檔" }`；`conv`／`intake` 條目保留（alias 期間 title 仍可解析）。
- FlowBar：①接收建模來源、②自動轉換 3D 改 `page: "minio"`。
- `COPILOT_PROMPTS`：`conv` 與 `minio` 條目合併至 `minio`。
- `handoff.ts` `AxisKey` 七軸型別**不變**（舊 URL parse 相容）；`EdgeConsole` `AXIS_SET`→`railAxis` 對映將 `conv`／`intake` 歸到 `minio`。發送端更新：`IssuesRuleCenterPage`（A1）等頁的 `buildHandoff("conv", …)` 改 target `"minio"`（payload 欄位不變）；`buildHandoff("minio", …)` 照舊。
- `routing.ts` `PRODUCT_CONSOLE_ROUTES` 不動。
- SharedStatusRail 七軸顯示：`conv`／`intake` 兩軸的狀態格對映到 MD（實作於 rail 的 axis→route 對映，不改 rail 資料源）。

## 6. 元件結構（順手改善）

`pages.tsx` 現 3,408 行。新頁獨立成目錄，舊三頁自 `pages.tsx` 移除（淨減約 900 行）：

```txt
web-viewer-sample/src/console/modelData/
  ModelDataPage.tsx        # 殼層：雙欄 layout＋選檔 state＋handoff 接收
  MinioTreePane.tsx        # 左欄（自 MinioDataPage 抽出）
  GlobalConversionPane.tsx # 右欄全域視圖（摘要卡＋佇列表＋歷史折疊）
  ObjectDetailPane.tsx     # 右欄單檔詳情
  useConversionData.ts     # 共用資料層：jobs／records／watcher／history 抓取＋截斷旗標＋防重入 action hooks
```

- 既有共用件直接 import：`IntentDialog`、`Panel`／`Field`／`Btn`、`LifecycleStrip`、`CoverageDrawer`、`ledgerChipStatus`、`LEDGER_STATUS_LABEL/PROV`、`useIncomingHandoff`、`IncomingHandoffBanner`、`buildHandoff`。防重入 ref／證據型更新等既驗證邏輯以搬移為主，不重寫。
- `OperatorConsole.tsx`＋`IntakeSelectPage.tsx`（退役入口專用）不動。

## 7. 錯誤處理

沿用「各資料源獨立錯誤、互不污染」既有模式：folder（err）／records（recErr＋loadRecordsErr）／jobs（err）／watcher（mwErr）／history（historyErr）各自 settle、各自誠實顯示「未連線／未取得」。控制動作錯誤獨立於載入錯誤（actionErr／triggerErr 顯示在 dialog 內、失敗不關 dialog）。截斷與未載入守門（`jobsLoaded`／`recordsLoaded`／`*Truncated`）全數保留。

## 8. 測試與驗收

- **單元測試遷移**：`MinioDataPage.test.tsx`→`MinioTreePane`／`ModelDataPage`；`ConversionSchedulingPage.test.tsx`→`GlobalConversionPane`／`ObjectDetailPane`／`useConversionData`；`ConversionHistory.test.tsx`、`MinioCrossLinks.test.tsx`、`IntakeCrossLinks.test.tsx`、`console.test.tsx`（nav／FlowBar 斷言）、`EdgeConsole.sharedstatus.test.tsx`（railAxis 對映）對應改寫。新增：alias 重導保留 query、佇列列「檔案 →」定位、單檔詳情三源串接與對映缺口 indeterminate。
- **驗證入口**：`npm run verify`（build＋test＋struct-log）＋另跑 `npx tsc --noEmit`（vite build 不跑 tsc）。
- **瀏覽器 E2E（user-facing 驗收唯一證據）**：gstack 截圖／trace 至少覆蓋——(1) `#conv?job_id=…` 舊連結重導後佇列高亮；(2) 左欄點 source IFC → 單檔詳情顯示真實 ledger 狀態；(3) failed 檔觸發轉檔 intent→confirm 全程；(4) watcher 開關 dialog 證據型刷新；(5) 佇列插隊／重試按鈕狀態守門。
- 部署驗收：`build:ui` 後經 coordinator `:8004/ui` 實測（viewer :5173 baked image 另計，不在本案範圍——本三頁皆屬 `:8004/ui` console）。

## 9. 與既有 spec 的調和

- `2026-07-03-seven-axis-cross-page-harmony-design.md`：其 §4.2 接收端重驗鐵律、§4.3 evidence-typed cross-link 契約**繼續適用**；本 spec supersede 其「conv／minio／intake 為三個獨立頁」的版面預設——七軸中 `conv`／`intake`／`minio` 三軸 UI 收斂為單頁 MD，handoff payload 與重驗語意不變，發送端 target 更新見 §5。
- `docs/plans/docs-plans-README.md` deep-link alias 保留原則：遵守（§5 重導 alias）。
- 沿用中的 conv 系列 spec（coverage report／prioritize-retry／watch-toggle／minio-watch 等）之互動契約（IX 卡：禁樂觀更新、證據型更新）不受影響，僅承載頁面改變。

## 10. 風險與緩解

| 風險 | 緩解 |
|---|---|
| 測試遷移量大（三頁測試合計逾千行） | §6 以搬移為主不重寫；plan 按 pane 分 task，逐 pane 綠燈 |
| 三源串接鍵對映缺口（object 無 ledger、job 無 object_key） | §3.3 誠實顯示「未轉」／「狀態未明」；非 MinIO job 一律在佇列表可操作 |
| 舊書籤／外部文件指向 #conv、#intake | 重導 alias＋保留 query；routing 認列不變 |
| e2e trace 錨（`artifacts/e2e/conv-watch-toggle-trace/` 等）指向舊頁 | 驗收重錄於新頁；舊 trace 保留為歷史 |
| pages.tsx 大幅刪改與並行 PR 衝突 | 單一 branch 完成、PR 前 rebase origin/main |

## 11. 完成定義

1. `#minio` 呈現主從雙欄 MD 頁；`#conv`、`#intake` 重導且 handoff query 存活。
2. §4 對映表 20 項逐項可在新頁操作或顯示（browser E2E 證據）。
3. `npm run verify`＋`npx tsc --noEmit` 綠；遷移後測試全綠。
4. nav／FlowBar／SharedStatusRail 對映更新；pages.tsx 移除三舊頁。
5. PR 走 branch → Actions → merge；body 附 Frontend Verification 證據表。
