# 模型資料與轉檔（MD）：CV / M / IN 三頁合一設計

- 日期：2026-07-06
- 狀態：設計已由使用者確認（brainstorming 三決策：主從雙欄工作台／全域視圖去重化／命名「模型資料與轉檔」）；已通過交叉對抗審批（2026-07-06，5 視角×2-lens 反駁、39 agents——CONFIRMED 5 項全數修正、PLAUSIBLE 9 項採納 9、REFUTED 3 項不採納，詳見 git 歷史第二次 commit）
- 範圍：`web-viewer-sample` console 前端；後端 API 一律不改（後端凍結契約：只打 coordinator `:8004`）
- PR evidence：documented exception for PR #303。Repo 自 #189 退役 active OpenSpec flow；本檔作為 `docs/superpowers/specs/*.md` formal spec evidence，供 `pr-review-agent` 對 behavior / code PR 判定需求來源。

## 0. PR #303 A1 addendum

PR #303 除 MD 三頁合一外，包含 A1 MinIO / local_fs 檢核入口修正，範圍限於前端 orchestration 與測試：

- `local_fs` 代表 governance-service 可直接讀取的 server-local IFC path；A1 可直接呼叫 governance rule-run。
- `MinIO` 代表 object key / bucket provenance，不可直接當成 `ifc_source_path` 丟給 governance-service；若使用者已選 review session，A1 SHALL 透過 coordinator `rule-runs/for-session` 由 session / intake context 解析 server-local IFC path。
- A1 檢核完成後，失敗列 SHALL 提供一鍵開啟 `#review` 的 Review Room handoff，攜帶 `rule_run_id`、`ifc_guid`、`usd_prim_path` 等非機密上下文；不得只因尚未手動選 review session 就把 handoff 按鈕 disabled。
- 實際 3D highlight 是否可視仍由 Review Room runtime 負責：session、viewer lease、first frame、DataChannel、stage match 與 mapping path 必須在 runtime 層觀測成立，A1 不 claim viewer lease。

## 1. 背景與驗證事實

三頁現況（皆已逐檔查證程式碼）：

| 頁 | 路由 | 元件 | 功能 |
|---|---|---|---|
| CV「IFC→USD 轉檔排程」 | `#conv` | `pages.tsx` `ConversionSchedulingPage` | ifc-ready 佇列全欄位表（lifecycle／失敗原因／插隊／重試／coverage drawer／SS·Review 跳轉）、MinIO watcher 面板＋開關（intent→confirm）、轉檔 Ledger 表（`GET /api/conversion/records`）＋失敗列觸發轉檔、轉檔歷史（`GET /api/dev/conversions`）、incoming handoff 重驗（job_id／conversion_id／minio_key） |
| M「MinIO 資料」 | `#minio` | `pages.tsx` `MinioDataPage` | 真實 S3 逐層資料夾導覽（快取＋世代守門＋SSE `minio.changed` stale 通知）、source IFC 掛 ledger chip＋觸發轉檔（intent→confirm）＋「轉檔 →」「A1 檢核 →」cross-link、DEMO bucket layout 規約示意、incoming handoff 重驗（minio_key／prefix） |
| IN「建模接收與轉換」 | `#intake` | `pages.tsx` `IntakePage` | ifc-ready 唯讀佇列表（欄位為 CV 子集，同一 API `GET /api/external/ifc-ready` limit 50）＋「CV →」「Review →」跳轉、純文案「轉換品質誠實標示」panel |

結論：**IN 的「動作」是 CV 的真子集**（無任何 IN 獨有的動作），但**顯示欄位有兩欄差異**——`download_status`、`conversion_authority` 僅 IN 表呈現，CV 表完全未顯示（兩者在 `IfcReadyListItem` 上是與 `conversion_status` 並列的獨立欄位，非別名），合併時佇列表須補列這兩欄才達零損失（§3.2B／§4 #17）。M 與 CV 已共用 ledger 資料與 `POST /api/conversion/trigger`。三頁合一無後端相依。

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
- **每個物件（不限 source_ifc）的角色徽章**（來源 IFC／已轉 USDC／其他，`roleLabel`／`roleClass`）照舊——這是樹上辨識 USDC 產物的唯一視覺線索，不得與三段語意 badge 混同而遺失。
- 點選 source IFC → 右欄切單檔詳情；再點一次或點「返回總覽」→ 右欄回全域視圖。
- 已選中檔案在左欄以反白持續標示（即使之後導覽到其他資料夾）；單檔詳情提供「回到檔案所在資料夾」捷徑，避免深樹導覽迷失定向。
- 資料夾 `has_source_ifc` badge 照舊。

### 3.2 右欄（未選檔）：全域轉檔視圖（去重化）

- **A. 摘要卡**：watcher 啟用狀態＋開關鈕（沿用 intent→confirm `IntentDialog`、防重入 ref、證據型刷新——POST 成功但重抓失敗時不關 dialog 顯誠實錯誤）；watcher 關閉琥珀警示條與開關鈕**同卡緊鄰呈現**（警示正下方即開關，不得隔著其他區塊）。佇列統計（佇列中 N／轉換中 N／失敗 N／完成 N）由 ifc-ready＋ledger 回應真值計算，**每個數字明標口徑來源**：佇列中／轉換中來自 ifc-ready（易失、重啟即清），完成／失敗來自 ledger（持久、跨重啟）——兩者生命週期不同，重啟後「完成 N 但佇列空」是正常現象，統計卡以口徑標示消除「數字對不上」困惑；任一來源被回傳窗截斷（count > items.length）時統計旁標「（回傳窗內，非全量）」，不顯示假總數。watcher 診斷欄位（bucket／prefix／baseline／triggered／seen／一致性基準與 auto-enroll 說明、last_triggered 表）收進「展開細節」折疊區，文案沿用現有（含 §3.4 auto-enroll 說明與補救路徑說明）；展開細節同時承接 CV 現有 Pipeline 總覽 Panel 的內容——頁級 LifecycleStrip（讀 MinIO→排隊→IFC→USD→寫回→通知 Kit）、conversion authority 說明（bim-streaming-server owns heavy conversion）、插隊／重試說明、**「concurrency 控制：NOT BUILT（獨立 follow-up 卡）」誠實揭露（prov=p1）不得隨去重化遺失**。
- **B. 轉檔佇列表**：CV 的 ifc-ready 表**全欄位保留**（job／key 三訊號（idem·replay·volatility）／lifecycle chip／project／usdc／conversion／dispatch 失敗原因（80 字截斷＋tooltip）／session（SS →、Review →）／stage／coverage drawer／插隊·重試控制），**另補 IN 僅有的 `download_status`、`conversion_authority` 兩欄**（CV 現無，補列才達 IN 零損失）。新增一欄行為：列可對映回 MinIO 物件（ledger `object_key` 存在）時掛「檔案 →」鈕＝左欄導覽定位該檔並切單檔詳情。版面：表格外包 `overflow-x: auto` 捲動容器（右欄寬度小於現況 CV 滿版，13 欄不可擠壓變形或裁切）；顯示列數維持 20 上限，回傳筆數多於顯示時表尾標「顯示前 20／回傳 N 筆」，與摘要卡統計口徑互相可對照。
- **C. 轉檔歷史**：`GET /api/dev/conversions` pass-through 表原樣，降為折疊區塊（prov=`artifact`、失敗顯「未取得」語意不變）。
- watcher 關閉時的頁頂琥珀警示條（「⚠ 自動偵測已關閉…」）保留於右欄頂。

**去重化**：CV 現有獨立「轉檔 Ledger 表」不再呈現為表。ledger 資料（`GET /api/conversion/records` limit 100）改為三處驅動：左欄 chip、單檔詳情、摘要統計。Ledger 表原有欄位在單檔詳情全數可見（§3.3）；原「來源 →」cross-link 由「左欄即來源」取代；原失敗列「觸發轉檔」鈕移入單檔詳情與佇列表。

### 3.3 右欄（選中 source IFC）：單檔詳情

由三源以既有鍵串接，**主鍵＝`idempotency_key`**（minio object ↔ ledger ↔ ifc-ready job 三視圖對帳既有主鍵，job 建立當下即賦值）；`conversion_job_id` 僅作已派工後的輔助確認——它在 queued／detected 階段恆為 null，不可當主鍵，否則未派工階段（佇列表最常見狀態）對映必落空；ledger `object_key` ↔ minio `key`。同檔多次轉檔嘗試（failed 後重試／強制重轉）：單檔詳情明示「顯示最新一次嘗試」，歷史嘗試由全域視圖的「轉檔歷史」折疊區塊（§3.2C）查閱。

- **來源資訊**：object key、專案／種類／版本 badge、偵測時間（ledger `detected_at`）。
- **生命週期條**：偵測 → 佇列 → 轉檔 → USDC → 審查（沿用 `LifecycleStrip`＋`LEDGER_STATUS_PROV` 三色語意）。
- **狀態區**：ledger status chip、對應 conversion_job_id、usdc_key（null 標「待產生」p1）、失敗原因（failure_stage＋failure_reason 全文）。失敗原因**來源＝ifc-ready job**（易失·重啟即清），非 ledger 欄位（`ConversionRecord` 無 failure_*）——ledger status=failed 但對應 job 已被重啟清空時，失敗原因誠實顯示「未取得（job 已回收）」，不臆測、不留白誤導。
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
| 17 | IN：ifc-ready 唯讀表 | 動作被 #10 涵蓋；顯示另補 `download_status`／`conversion_authority` 兩欄於佇列表（§3.2B，CV 現無此二欄） |
| 18 | IN：「CV →」「Review →」跳轉 | 同頁佇列表＋Review → |
| 19 | IN：品質誠實標示 panel | 精簡併入單檔詳情 coverage 區（§3.3） |
| 20 | 三頁 IntentDialog 防重入／證據型更新契約 | 全數沿用（§3.2A、§3.3） |
| 21 | CV：Pipeline 總覽 Panel（頁級 LifecycleStrip＋conversion authority／插隊重試說明＋concurrency 控制 NOT BUILT 誠實揭露） | 摘要卡「展開細節」（§3.2A）；NOT BUILT 揭露不得遺失 |
| 22 | M：逐物件角色徽章（來源 IFC／已轉 USDC／其他，不限 source_ifc） | 左欄原樣（§3.1） |

## 5. 路由、導覽與跨頁契約

- `#minio` ＝新頁 MD。`#conv`、`#intake` 改為**重導 alias**：以 `window.location.replace` 導向 `#minio` 並**保留 query string**（handoff id 由新頁照 §3.4 重驗）。重導**必須放在 `useEffect`**、不得在 render 期間執行（既有 `console.test.tsx` 以 `renderToString` 同步斷言純渲染，render 期副作用會污染測試慣例）。明示差異：這是本 repo 第一個「URL 重寫式」alias——既有 alias（`coordinator`／`semantic`／`overview` 等）是同 hash 直接 render 對應元件、網址列不變；`#conv`／`#intake` 改寫網址列為 `#minio` 是刻意設計（單一正典 URL），已含於使用者 2026-07-06 合併裁決（§9）。依 `docs/plans/docs-plans-README.md` deep-link aliases 保留原則，路由不砍。
- `data.ts` `PAGES`：移除 `conv`、`intake` 兩項；`minio` 項改 `no: "MD"`、`label: "模型資料與轉檔"`。`NAV_LABEL`：`minio: { tech: "Model Data & Conversion", biz: "模型資料與轉檔" }`；`conv`／`intake` 條目保留（alias 期間 title 仍可解析）。
- FlowBar：①接收建模來源、②自動轉換 3D 改 `page: "minio"`。
- `COPILOT_PROMPTS`：`conv` 與 `minio` 條目合併至 `minio`。
- `handoff.ts` `AxisKey` 七軸型別**不變**（舊 URL parse 相容）；`EdgeConsole` `AXIS_SET`→`railAxis` 對映將 `conv`／`intake` 歸到 `minio`。發送端更新：`IssuesRuleCenterPage`（A1）等頁的 `buildHandoff("conv", …)` 改 target `"minio"`（payload 欄位不變）；`buildHandoff("minio", …)` 照舊。**MD 頁自身對外送出 handoff 時 `source` 一律填 `"minio"`**（原 CV／IN 程式碼搬移時同步更新原本的 `source:"conv"`／`source:"intake"`——`source` 是接收端原樣顯示給使用者的來源標籤，不得指向已不存在的獨立頁）。
- `routing.ts` `PRODUCT_CONSOLE_ROUTES` 不動。
- SharedStatusRail：rail 本身**無 per-axis 狀態格**（僅 5 個固定指標＋3 顆固定按鈕，無 conv/intake/minio 專屬格位），不需變更；唯一要改的是上一點的 `railAxis` 對映，讓 `activeAxis` 在 MD 頁正確標示。

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

- 共用件分兩類：`IntentDialog`、`Panel`／`Field`／`Btn`、`useIncomingHandoff`、`IncomingHandoffBanner`、`buildHandoff` 已是可 import 的共用模組，直接 import；但 `LifecycleStrip`、`CoverageDrawer`、`ledgerChipStatus`、`LEDGER_STATUS_LABEL`／`LEDGER_STATUS_PROV`（及 `lifecycleLabel`、`roleLabel`／`roleClass`）目前是 **pages.tsx 內未 export 的私有宣告**——前置步驟：先抽至共用檔（如 `modelData/conversionShared.tsx`）並補 export，`modelData/*` 才能 import；此步在 plan 列為獨立 task。防重入 ref／證據型更新等既驗證邏輯以搬移為主，不重寫。
- `OperatorConsole.tsx`＋`IntakeSelectPage.tsx`（退役入口專用）不動。

## 7. 錯誤處理

沿用「各資料源獨立錯誤、互不污染」既有模式：folder（err）／records（recErr＋loadRecordsErr）／jobs（err）／watcher（mwErr）／history（historyErr）各自 settle、各自誠實顯示「未連線／未取得」。控制動作錯誤獨立於載入錯誤（actionErr／triggerErr 顯示在 dialog 內、失敗不關 dialog）。截斷與未載入守門（`jobsLoaded`／`recordsLoaded`／`*Truncated`）全數保留。

## 8. 測試與驗收

- **單元測試遷移**：`MinioDataPage.test.tsx`→`MinioTreePane`／`ModelDataPage`；`ConversionSchedulingPage.test.tsx`→`GlobalConversionPane`／`ObjectDetailPane`／`useConversionData`；`ConversionHistory.test.tsx`、`MinioCrossLinks.test.tsx`、`IntakeCrossLinks.test.tsx`、`console.test.tsx`（nav／FlowBar 斷言）對應改寫。railAxis 對映斷言落點注意：既有 `activeAxis` 斷言在 `SharedStatusRail.test.tsx`（`EdgeConsole.sharedstatus.test.tsx` 測的是 SharedStatusProvider 資料，勿改錯檔）——conv/intake→minio 對映斷言加在 `SharedStatusRail.test.tsx` 或新增 EdgeConsole railAxis 測試。新增：alias 重導保留 query（含「重導在 useEffect、renderToString 純渲染不觸發導航」）、佇列列「檔案 →」定位、單檔詳情三源串接（idempotency_key 主鍵）與對映缺口 indeterminate。
- **驗證入口**：`npm run verify`（build＋test＋struct-log）＋另跑 `npx tsc --noEmit`（vite build 不跑 tsc）。
- **瀏覽器 E2E（user-facing 驗收唯一證據）**：gstack 截圖／trace 至少覆蓋——(1) `#conv?job_id=…` 舊連結重導後佇列高亮；(2) 左欄點 source IFC → 單檔詳情顯示真實 ledger 狀態；(3) failed 檔觸發轉檔 intent→confirm 全程；(4) watcher 開關 dialog 證據型刷新；(5) 佇列插隊／重試按鈕狀態守門；(6) 右欄實際寬度下佇列表 `overflow-x` 捲動可讀（無擠壓變形／裁切）截圖。
- 部署驗收：`build:ui` 後經 coordinator `:8004/ui` 實測（viewer :5173 baked image 另計，不在本案範圍——本三頁皆屬 `:8004/ui` console）。

## 9. 與既有 spec 的調和

- `2026-07-03-seven-axis-cross-page-harmony-design.md`：**本 spec 是對其 Non-Negotiable N1（不得單頁合併）的正式部分覆寫，非單純調和**。N1 與其 §9 Tournament 曾明文否決「單頁合併」；本 spec 將 `conv`／`intake`／`minio` 三軸 UI 收斂為單頁 MD（七實體頁→五實體頁）。**覆寫授權紀錄**：使用者於 2026-07-06 明確指示「CV 和 IN 兩個頁面功能相同，可以整合後，將功能放到 MinIO 資料介面中，再根據三個頁面的功能重新設計新介面」（附截圖圈選三頁），並於同日三項互動決策確認（主從雙欄工作台／全域視圖去重化／命名「模型資料與轉檔」）——依需求效力序，使用者最新明確指令覆寫既有 spec 裁決。Tournament 當時否決單頁合併的理由逐項對應：canonical IA→§5 alias 重導＋routing 認列不變；deep-link 破壞→重導保留 query；巨頁難維護難測→§6 四檔拆分＋per-pane 測試。N1 其餘部分（deep-link aliases 保留不砍）仍遵守；其 §4.2 接收端重驗鐵律、§4.3 evidence-typed cross-link 契約**繼續適用**，handoff payload 與重驗語意不變，發送端 target 與 source 更新見 §5。
- `docs/plans/docs-plans-README.md` deep-link alias 保留原則：遵守（§5 重導 alias）。
- 沿用中的 conv 系列 spec（coverage report／prioritize-retry／watch-toggle／minio-watch 等）之互動契約（IX 卡：禁樂觀更新、證據型更新）不受影響，僅承載頁面改變。

## 10. 風險與緩解

| 風險 | 緩解 |
|---|---|
| 測試遷移量大（三頁測試合計逾千行） | §6 以搬移為主不重寫；plan 按 pane 分 task，逐 pane 綠燈 |
| 三源串接鍵對映缺口（object 無 ledger、job 無 object_key、job 被重啟清空） | 主鍵用 `idempotency_key`（job 建立即賦值）消除 queued/detected 階段 `conversion_job_id=null` 的對映空窗；其餘缺口依 §3.3 誠實顯示「未轉」／「狀態未明」／「未取得（job 已回收）」；非 MinIO job 一律在佇列表可操作，無 object_key 列「檔案 →」欄顯示中性文案（如「非 MinIO 來源」）而非留空 |
| 舊書籤／外部文件指向 #conv、#intake | 重導 alias＋保留 query；routing 認列不變 |
| e2e trace 錨（`artifacts/e2e/conv-watch-toggle-trace/` 等）指向舊頁 | 驗收重錄於新頁；舊 trace 保留為歷史 |
| pages.tsx 大幅刪改與並行 PR 衝突 | 單一 branch 完成、PR 前 rebase origin/main |

## 11. 完成定義

1. `#minio` 呈現主從雙欄 MD 頁；`#conv`、`#intake` 重導且 handoff query 存活。
2. §4 對映表 20 項逐項可在新頁操作或顯示（browser E2E 證據）。
3. `npm run verify`＋`npx tsc --noEmit` 綠；遷移後測試全綠。
4. nav／FlowBar／SharedStatusRail 對映更新；pages.tsx 移除三舊頁。
5. PR 走 branch → Actions → merge；body 附 Frontend Verification 證據表。
