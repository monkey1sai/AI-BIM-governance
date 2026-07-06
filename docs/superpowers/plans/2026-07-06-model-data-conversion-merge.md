# 模型資料與轉檔（MD）三頁合一 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 console 的 CV（`#conv`）、M（`#minio`）、IN（`#intake`）三頁合併成單一「模型資料與轉檔」主從雙欄工作台，落在 `#minio`，舊路由重導、功能零損失。

**Architecture:** 新頁獨立成 `web-viewer-sample/src/console/modelData/` 目錄（殼層＋左欄樹＋全域視圖＋單檔詳情＋兩個資料 hook＋共用件抽檔）；`pages.tsx` 移除三舊頁；EdgeConsole 以 `useEffect` 內 `window.location.replace` 做 `#conv`/`#intake` → `#minio` 重導（保留 query）。資料層三源以 `idempotency_key` 為主鍵串接。

**Tech Stack:** React 18＋TypeScript（Vite）、vitest、既有 coordinatorClient（只打 `:8004`）。

**Spec:** `docs/superpowers/specs/2026-07-06-model-data-conversion-merge-design.md`（已通過交叉對抗審批；本 plan 各 task 括號標註對應 spec 章節）。

## Global Constraints

- 只打 coordinator `:8004`（一律經 `coordinatorClient`／`governanceClient`）；後端 API 零變更。
- `routing.ts` `PRODUCT_CONSOLE_ROUTES` 不動；`handoff.ts` `AxisKey` 七軸型別不動。
- 誠實鐵律：禁樂觀更新（一律證據型更新）；截斷／載入失敗→`indeterminate`；「concurrency 控制：NOT BUILT」揭露不得遺失；不捏數字。
- 重導只能放 `useEffect`，不得在 render 期執行（`console.test.tsx` 以 `renderToString` 同步斷言純渲染）。
- 每個 task 結尾：`npx tsc --noEmit`（在 `web-viewer-sample/` 下）＋受影響測試綠才 commit；commit 前 `git diff --cached --check`。
- 分支：`feat/model-data-conversion-merge`（已存在，spec 兩個 commit 在其上）；不動 main。
- 修改既有 symbol 前跑 GitNexus `impact`、commit 前 `detect_changes`（MCP 不可用時在 commit message 註明降級）。
- 所有新 UI 文案走 `t("中文", "English")` 雙語（既有 i18n 模式）。
- 工作目錄註記：npm/vitest 指令都在 `web-viewer-sample/` 下執行；git 指令在 repo root。

## File Structure

```txt
web-viewer-sample/src/console/modelData/
  conversionShared.tsx      # Task 1：自 pages.tsx 抽出＋export 的共用件（唯一真相源，pages.tsx 改 import）
  useConversionData.ts      # Task 2：jobs/records/watcher/history 四源抓取＋截斷/loaded 旗標
  useMinioFolder.ts         # Task 3：folder/prefix/cache/SSE/世代守門（自 MinioDataPage 抽出）
  MinioTreePane.tsx         # Task 3：左欄檔案樹（受控元件：選檔 callback＋選中反白）
  GlobalConversionPane.tsx  # Task 4：右欄全域視圖（摘要卡＋佇列表＋歷史折疊＋dialogs）
  ObjectDetailPane.tsx      # Task 5：右欄單檔詳情（三源串接＋動作＋coverage）
  ModelDataPage.tsx         # Task 6：殼層（雙欄 layout＋選檔 state＋handoff 接收）
web-viewer-sample/src/console/pages.tsx        # Task 1 改 import；Task 9 刪三舊頁（淨減約 900 行）
web-viewer-sample/src/console/EdgeConsole.tsx  # Task 7：路由/重導/railAxis/FlowBar/NAV_LABEL/COPILOT_PROMPTS
web-viewer-sample/src/console/data.ts          # Task 7：PAGES 導覽項
web-viewer-sample/src/console/edge-console.css # Task 6：雙欄 layout＋overflow-x 容器樣式
```

行號基準：commit `4fb266e` 時的 `pages.tsx`（3,408 行）。若實作時行號漂移，以符號名搜尋為準。

---

### Task 1: 抽出共用件 `conversionShared.tsx`（spec §6 前置步驟）

**Files:**
- Create: `web-viewer-sample/src/console/modelData/conversionShared.tsx`
- Modify: `web-viewer-sample/src/console/pages.tsx`（刪原宣告、改 import）
- Test: 既有全套（不新增測試檔——本 task 是行為不變的搬移，以既有測試守護）

**Interfaces:**
- Consumes: `coordinatorClient` 的 `ConversionQualityMetricsResponse`、`ConversionLifecycleStatus`、`narrowConversionStatus`、`MinioObject`；`data.ts` 的 `Prov`；`components.tsx` 的 `Field`；`i18n` 的 `t`
- Produces（後續 task 全部依賴，簽名如下、全部 `export`）:
  - `function LifecycleStrip({ steps, statuses }: { steps: string[]; statuses?: ("done" | "current" | "future")[] }): JSX.Element`
  - `function CoverageDrawer({ state }: { state: ConversionQualityMetricsResponse | { error: string } | "loading" | undefined }): JSX.Element`
  - `const LEDGER_STATUS_LABEL: Record<string, string>`
  - `const LEDGER_STATUS_PROV: Record<string, Prov>`
  - `function lifecycleLabel(s: ConversionLifecycleStatus | null | undefined): string`
  - `function ledgerChipStatus(idempotencyKey: string, records: ReadonlyArray<{ idempotency_key: string; status: string }>, recordsIncomplete: boolean): string`
  - `const MINIO_CHIP_LABEL: Record<string, string>`
  - `function roleLabel(role: MinioObject["role"]): string`
  - `function roleClass(role: MinioObject["role"]): string`

- [ ] **Step 1: 建 `modelData/conversionShared.tsx`**——把下列 pages.tsx 私有宣告「原文搬移」進新檔並前綴 `export`（內容一字不改，含註解）：`LifecycleStrip`（pages.tsx:105-123）、`pct`＋`CoverageDrawer`（845-882，`pct` 不 export、留檔內私有）、`LEDGER_STATUS_LABEL`/`LEDGER_STATUS_PROV`（884-890）、`lifecycleLabel`（892-896）、`ledgerChipStatus`（1660-1686 含註解）、`MINIO_CHIP_LABEL`（1688-1707）、`roleLabel`/`roleClass`（1709-1719）。檔頭 import：

```tsx
// web-viewer-sample/src/console/modelData/conversionShared.tsx
// MD 三頁合一（spec §6）：自 pages.tsx 抽出的轉檔共用件（原文搬移＋export，唯一真相源）。
import { t } from "../i18n";
import { Field } from "../components";
import type { Prov } from "../data";
import { narrowConversionStatus, type ConversionLifecycleStatus, type ConversionQualityMetricsResponse, type MinioObject } from "../coordinatorClient";
```

（`roleLabel`/`roleClass` 原本用 `import("./coordinatorClient").MinioObject` 內聯型別——改用上面具名 `MinioObject` type import。）

- [ ] **Step 2: pages.tsx 刪除上列原宣告，檔頭加**：

```tsx
import { CoverageDrawer, LEDGER_STATUS_LABEL, LEDGER_STATUS_PROV, LifecycleStrip, lifecycleLabel, ledgerChipStatus, MINIO_CHIP_LABEL, roleLabel, roleClass } from "./modelData/conversionShared";
```

注意：pages.tsx 內其他頁（A1 等）若也用到 `LifecycleStrip` 等符號，import 後即自動接上，不需逐處改。

- [ ] **Step 3: 型別檢查**——Run: `cd web-viewer-sample && npx tsc --noEmit`。Expected: 0 errors。
- [ ] **Step 4: 既有測試綠**——Run: `npm test`（web-viewer-sample 下）。Expected: 全綠（本 task 零行為變更，任何紅燈＝搬移錯誤）。
- [ ] **Step 5: Commit**——`git add web-viewer-sample/src/console/modelData/conversionShared.tsx web-viewer-sample/src/console/pages.tsx && git commit -m "refactor(console): 抽出轉檔共用件至 modelData/conversionShared（MD 合一 Task 1）"`

---

### Task 2: 資料層 hook `useConversionData.ts`（spec §3.2、§7）

**Files:**
- Create: `web-viewer-sample/src/console/modelData/useConversionData.ts`
- Test: `web-viewer-sample/src/console/modelData/useConversionData.test.ts`

**Interfaces:**
- Consumes: `coordinatorClient.listIfcReady(50)`、`.minioWatchStatus()`、`.getConversionRecords(100)`、`.getConversionsHistory()`
- Produces（Task 4/5/6 依賴）:

```ts
export interface ConversionData {
  jobs: IfcReadyListItem[]; jobsErr: string | null; jobsTruncated: boolean; jobsLoaded: boolean;
  records: ConversionRecord[]; recErr: string | null; recordsTruncated: boolean; recordsLoaded: boolean; recordsIncomplete: boolean; // = recordsTruncated || 載入失敗
  mw: MinioWatchStatus | null; mwErr: string | null;
  history: DevConversionRecord[] | null; historyErr: boolean;
  busy: boolean;
  load(): Promise<{ jobsOk: boolean; mwOk: boolean }>;   // ifc-ready + watcher（allSettled，錯誤獨立）
  loadRecords(): Promise<void>;                            // ledger（獨立錯誤）
}
export function useConversionData(): ConversionData
```

- [ ] **Step 1: 寫失敗測試**（`useConversionData.test.ts`；mock 模式沿用 `ConversionSchedulingPage.test.tsx` 既有 `vi.mock("../coordinatorClient", ...)` 寫法，改相對路徑 `"../coordinatorClient"`）：

```ts
// 核心斷言（三條）：
// 1) listIfcReady 回 {items:[…1筆], count: 60} → jobsTruncated=true、jobsLoaded=true
// 2) getConversionRecords reject → recErr 非 null、recordsIncomplete=true、recordsLoaded=true（settle 過）
// 3) minioWatchStatus reject 不污染 jobs：jobs 有值、mwErr 非 null、load() 回 { jobsOk:true, mwOk:false }
```

用 `renderHook`（`@testing-library/react` 若 repo 未裝則用既有測試的「掛載小元件讀 hook」模式——先看 `ConversionSchedulingPage.test.tsx` 怎麼掛，沿用同一套）＋ `waitFor` 等 settle（禁同步斷言，flaky 前科見 minio-watcher-loop）。

- [ ] **Step 2: 跑測試確認 FAIL**——Run: `npx vitest run src/console/modelData/useConversionData.test.ts`。Expected: FAIL（模組不存在）。
- [ ] **Step 3: 實作 hook**——邏輯**原文搬移**自 `ConversionSchedulingPage`：state 宣告（pages.tsx:899-947 中資料相關者）、`load`（976-995）、`loadRecords`（998-1010）、mount effect（1012）、history effect（1016-1024）。變更點僅四處：(a) 包成 hook 回傳 `ConversionData` 物件；(b) `getConversionRecords(50)` 改 `100`（對齊 M 頁上限，去重後單一份 records 三處共用）；(c) 新增衍生值 `recordsIncomplete = recordsTruncated || loadRecordsErrFlag`（M 頁 L1729 的 `loadRecordsErr` 語意併入）；(d) `loadRecords` 的 catch 同時設 `recErr` 與 incomplete 旗標（CV 只設 recErr、M 只設旗標——合併兩者）。
- [ ] **Step 4: 跑測試確認 PASS**——Run: 同 Step 2。Expected: PASS。
- [ ] **Step 5: Commit**——`git commit -m "feat(console): useConversionData 四源資料 hook（MD 合一 Task 2）"`

---

### Task 3: 左欄 `useMinioFolder.ts`＋`MinioTreePane.tsx`（spec §3.1）

**Files:**
- Create: `web-viewer-sample/src/console/modelData/useMinioFolder.ts`、`web-viewer-sample/src/console/modelData/MinioTreePane.tsx`
- Test: `web-viewer-sample/src/console/modelData/MinioTreePane.test.tsx`

**Interfaces:**
- Produces:

```ts
export interface MinioFolderState {
  folder: MinioFolderListing | null; prefix: string; loading: boolean; err: string | null;
  stalePrefixes: Set<string>;
  navigate(prefix: string): void;   // enterFolder/goUp 共用（goUp 由 pane 算父層後呼叫）
  refreshCurrent(): void;
}
export function useMinioFolder(): MinioFolderState

export function MinioTreePane(props: {
  fs: MinioFolderState;
  records: ConversionRecord[]; recordsIncomplete: boolean;
  selectedKey: string | null;
  onSelect(obj: MinioObject): void;   // 點 source_ifc 物件 → 殼層切單檔詳情
}): JSX.Element
```

- [ ] **Step 1: 寫失敗測試**（遷移自 `MinioDataPage.test.tsx` 相關斷言＋兩條新斷言）：(a) 資料夾列表以 `localeCompare("zh-TW")` 排序、`has_source_ifc` badge 存在（沿用既有斷言，改掛在 `MinioTreePane`）；(b) 新：`selectedKey` 命中的物件列有 `data-selected="true"` 屬性（反白樣式鉤子）；(c) 新：點擊 source_ifc 物件的檔名鈕呼叫 `onSelect`，收到完整 `MinioObject`。
- [ ] **Step 2: 跑測試確認 FAIL**——Run: `npx vitest run src/console/modelData/MinioTreePane.test.tsx`。
- [ ] **Step 3: 實作**——`useMinioFolder`：**原文搬移** `MinioDataPage` 的 `folderCacheRef`/`stalePrefixes`/`loadGenRef`/`load`（pages.tsx:1736-1776）、SSE effect（1778-1802）、prefix state＋mount effect（1818-1820）、`refreshCurrent`（1832-1835）；`navigate = setPrefix`。`MinioTreePane`：**原文搬移** M 頁左欄 JSX（1911-2033 的 Panel：麵包屑/上一層/Refresh/cache 標示/stale 警示/loading/err/empty/資料夾鈕/物件列，含 roleLabel 徽章、三段語意 badge、ledger chip——chip 用 Task 1 的 `ledgerChipStatus(obj.idempotency_key, records, recordsIncomplete)`）。變更點：(a) 物件列的「觸發轉檔」「轉檔 →」「A1 檢核 →」三鈕**移除**（觸發/跳轉移至單檔詳情，Task 5）；改為整列可點：`source_ifc` 物件檔名鈕 `onClick={() => props.onSelect(obj)}`、掛 `data-testid={`md-tree-select-${obj.idempotency_key}`}`、`data-selected={props.selectedKey === obj.key}`；(b) `goUp` 邏輯（1826-1831 的父層計算）留在 pane、算完呼 `props.fs.navigate(parent)`。
- [ ] **Step 4: 跑測試確認 PASS**。
- [ ] **Step 5: Commit**——`git commit -m "feat(console): MinioTreePane 左欄檔案樹＋useMinioFolder（MD 合一 Task 3）"`

---

### Task 4: 右欄全域視圖 `GlobalConversionPane.tsx`（spec §3.2）

**Files:**
- Create: `web-viewer-sample/src/console/modelData/GlobalConversionPane.tsx`
- Test: `web-viewer-sample/src/console/modelData/GlobalConversionPane.test.tsx`

**Interfaces:**
- Consumes: `ConversionData`（Task 2）、Task 1 全部共用件、`IntentDialog`、`buildHandoff`
- Produces:

```ts
export function GlobalConversionPane(props: {
  data: ConversionData;
  onLocateObject(objectKey: string): void; // 佇列列「檔案 →」→ 殼層導覽左欄＋選檔
  highlightJobId?: string | null;          // handoff job_id 命中列高亮（data-highlight="true"）
}): JSX.Element
```

- [ ] **Step 1: 寫失敗測試**（遷移 `ConversionSchedulingPage.test.tsx` 的 watcher/佇列/插隊/重試/coverage 斷言至本元件＋五條新斷言）：

```ts
// 新斷言：
// 1) 摘要卡統計：jobs 含 1 筆 status=queued_for_conversion、records 含 1 筆 status=failed
//    → data-testid="md-stat-queued" 文字 "1"、"md-stat-failed" 文字 "1"，
//    且各自帶口徑標示文字（佇列中/轉換中 → 「口徑：ifc-ready（易失）」；完成/失敗 → 「口徑：ledger（持久）」）
// 2) recordsTruncated=true → 摘要卡出現「（回傳窗內，非全量）」
// 3) 佇列表表頭含 "download" 與 "authority" 兩欄，列值 render j.download_status / j.conversion_authority（IN 零損失，spec §4 #17）
// 4) record.object_key 存在的列有 data-testid=`md-queue-locate-${idempotency_key}` 鈕；點擊呼 onLocateObject(object_key)；
//    無 object_key 的列該欄顯示「非 MinIO 來源」（spec §10）
// 5) 展開「Pipeline / 系統細節」details 後出現 "NOT BUILT" 文字（concurrency 揭露，spec §4 #21）
```

- [ ] **Step 2: 跑測試確認 FAIL**。
- [ ] **Step 3: 實作**——組成（由上而下）：
  1. **watcher 關閉琥珀警示**（搬 pages.tsx:1111-1115）＋緊鄰其下的**摘要卡**（新碼）：watcher 狀態＋開關鈕（搬 watcher Panel 的 enable/disable 鈕邏輯 1137-1140/1207-1210，`pendingAction` state 機制搬 1052-1083 的 `runAction`＋`actionBusyRef` 防重入原文）；統計列：

```tsx
const stats = {
  queued: data.jobs.filter((j) => j.status === "queued_for_conversion").length,
  converting: data.jobs.filter((j) => j.conversion_lifecycle_status === "converting").length,
  failed: data.records.filter((r) => r.status === "failed").length,
  ready: data.records.filter((r) => r.status === "ready").length,
};
// 口徑標示（spec §3.2A）：queued/converting 標「口徑：ifc-ready（易失、重啟即清）」；
// failed/ready 標「口徑：ledger（持久、跨重啟）」；(data.jobsTruncated || data.recordsTruncated)
// 時整卡加註「（回傳窗內，非全量）」。
```

  2. **「展開細節」`<details>`**：搬 watcher 診斷欄位全文（pages.tsx:1144-1206：bucket/prefix/最近一輪/輪詢次數/baseline/triggered/seen/兩段說明文案/補救文案/last_error/last_triggered 表）＋ Pipeline Panel 內容全文（1116-1122：頁級 `LifecycleStrip`＋conversion authority／插隊重試／`concurrency 控制：NOT BUILT` 三個 Field，prov 照舊）。
  3. **轉檔佇列表**：搬 ifc-ready 表全文（1293-1396），變更點：(a) `<div style={{ overflowX: "auto" }}>` 包住 `<table>`（spec §3.2B 版面）；(b) 表頭 `session` 前插 `<th>download</th><th>authority</th>`，列插 `<td>{j.download_status ?? "—"}</td><td>{j.conversion_authority ?? "—"}</td>`；(c) 每列尾端加「檔案 →」欄：`records.find(r => r.idempotency_key === j.idempotency_key)?.object_key` 有值→掛 `onLocateObject` 鈕、無值→`<span className="ec-note">{t("非 MinIO 來源", "non-MinIO source")}</span>`；(d) 列 `data-highlight={props.highlightJobId != null && (j.ifc_ready_job_id === props.highlightJobId || j.conversion_job_id === props.highlightJobId)}`；(e) 表尾：`jobs.length > 20 && <p className="ec-note">{t(`顯示前 20／回傳 ${jobs.length} 筆`, ...)}</p>`；(f) 內部 `buildHandoff("sessions"/"review", { source: ... })` 的 `source` 一律改 `"minio"`（spec §5）。
  4. **轉檔歷史 `<details>`**：搬 1402-1425 全文包進 `<details><summary>`。
  5. **兩個 `IntentDialog`**：搬 1426-1457 全文（watch-toggle/prioritize/retry dialog＋ledger trigger dialog；`confirmTrigger` 搬 1089-1105 原文含 `triggerBusyRef` 防重入）。
- [ ] **Step 4: 跑測試確認 PASS**。
- [ ] **Step 5: Commit**——`git commit -m "feat(console): GlobalConversionPane 全域轉檔視圖（MD 合一 Task 4）"`

---

### Task 5: 單檔詳情 `ObjectDetailPane.tsx`（spec §3.3）

**Files:**
- Create: `web-viewer-sample/src/console/modelData/ObjectDetailPane.tsx`
- Test: `web-viewer-sample/src/console/modelData/ObjectDetailPane.test.tsx`

**Interfaces:**
- Produces:

```ts
export function ObjectDetailPane(props: {
  object: MinioObject;               // 已選中的 source IFC
  data: ConversionData;
  onBack(): void;                    // 返回總覽
  onGoToFolder(prefix: string): void; // 「回到檔案所在資料夾」（spec §3.1 定向捷徑）
}): JSX.Element
```

- [ ] **Step 1: 寫失敗測試**（六條）：

```ts
// 1) 串接主鍵：records 含 {idempotency_key: K, status:"failed", conversion_job_id:null, object_key:"a/b/model.ifc"}、
//    jobs 含 {idempotency_key: K, failure_reason:"boom", ...} → 詳情顯示 ledger chip「失敗」且失敗原因 "boom"
//    （conversion_job_id 為 null 也串得上 = idempotency_key 主鍵，spec §3.3）
// 2) ledger status=failed 但 jobs 查無同 idempotency_key → 失敗原因顯示「未取得（job 已回收）」
// 3) record 查無且 recordsIncomplete=true → chip 顯「狀態未明」；recordsIncomplete=false → 「未轉（無 ledger 紀錄）」
// 4) status ∈ {untracked, failed, indeterminate}（ledgerChipStatus 結果）→「觸發轉檔」鈕 enabled；ready → disabled
// 5) job.review_session_id 存在 → 「SS →」「Review →」鈕存在且 buildHandoff target/source 正確（source="minio"）
// 6) 顯示「顯示最新一次嘗試」註記文字（同檔多次轉檔，spec §3.3）
```

- [ ] **Step 2: 跑測試確認 FAIL**。
- [ ] **Step 3: 實作**——新碼為主，串接邏輯：

```tsx
const record = data.records.find((r) => r.idempotency_key === props.object.idempotency_key) ?? null;
// 主鍵 idempotency_key；conversion_job_id 僅輔助（queued/detected 階段為 null，spec §3.3）
const job =
  data.jobs.find((j) => j.idempotency_key === props.object.idempotency_key) ??
  (record?.conversion_job_id ? data.jobs.find((j) => j.conversion_job_id === record.conversion_job_id) : undefined) ??
  null;
const chip = ledgerChipStatus(props.object.idempotency_key, data.records, data.recordsIncomplete);
```

區塊（各區 `data-testid` 前綴 `md-detail-`）：
  - 頂列：`onBack` 鈕、`onGoToFolder(props.object.key.slice(0, props.object.key.lastIndexOf("/") + 1))` 捷徑鈕。
  - 來源資訊：object key（mono 字型）、三段 badge、`record?.detected_at`。
  - 生命週期：`<LifecycleStrip steps={[偵測,佇列,轉檔,USDC,審查]} statuses={...}/>`，statuses 由 `record?.status` 導出（`detected`→step1 current；`queued`→1 done 2 current；`converting`→3 current；`ready`→1-4 done、job.review_session_id 有值時 5 done；`failed`→3 current（配紅色 chip 說明）；record 為 null→全 future）。
  - 狀態區：chip（`MINIO_CHIP_LABEL[chip] ?? chip`）＋`record?.conversion_job_id ?? "—"`＋usdc_key（null→`<span className="ec-prov ec-p1">待產生</span>`）＋失敗原因：`job?.failure_reason ?? job?.dispatch_error`，若 `record?.status === "failed" && !job` → `t("未取得（job 已回收）", "not available (job recycled)")`。加註 `<p className="ec-note">{t("顯示最新一次嘗試；歷史嘗試見總覽的轉檔歷史。", ...)}</p>`。
  - 動作區：「觸發轉檔」鈕（`disabled={!["untracked","failed","indeterminate"].includes(chip)}`、intent→confirm `IntentDialog`＋`confirmTrigger` 邏輯搬 M 頁 1884-1901 原文、成功後 `void data.loadRecords()`）；job 存在時依 `job.status` 掛插隊/重試鈕（gating 條件原文搬 CV 1365-1383，動作走與 Task 4 相同的 `conversionPrioritize`/`conversionRetry`＋dialog——為避免雙份 dialog 邏輯，把 Task 4 的 `runAction`＋dialog 抽成本目錄共用 hook `useConversionActions.ts`，兩 pane 共用；Task 4 實作時即建此檔）。
  - coverage 區：`job?.conversion_job_id` 存在→「coverage」展開鈕＋`CoverageDrawer`（快取/載入鎖邏輯搬 CV `toggleCoverage` 1025-1051 原文，state 本地持有）＋IN 品質誠實文案精簡三行（quality_metrics 為 pass-through artifact／不承諾精準 GUID／無遙測欄位標未取得——文字取自 pages.tsx:3276-3281 的 Field 值）。
  - 跳轉區：`job?.review_session_id` 存在→「SS →」`buildHandoff("sessions", { source: "minio", session })`、「Review →」`buildHandoff("review", { source: "minio", session })`；「A1 檢核 →」`buildHandoff("a1", { source: "minio", minio_key: props.object.key })`。
- [ ] **Step 4: 跑測試確認 PASS**。
- [ ] **Step 5: Commit**——`git commit -m "feat(console): ObjectDetailPane 單檔詳情（MD 合一 Task 5）"`

---

### Task 6: 殼層 `ModelDataPage.tsx`＋雙欄樣式（spec §3、§3.4）

**Files:**
- Create: `web-viewer-sample/src/console/modelData/ModelDataPage.tsx`
- Modify: `web-viewer-sample/src/console/edge-console.css`（追加，不改既有規則）
- Test: `web-viewer-sample/src/console/modelData/ModelDataPage.test.tsx`

**Interfaces:**
- Produces: `export function ModelDataPage(): JSX.Element`（EdgeConsole 唯一入口）

- [ ] **Step 1: 寫失敗測試**（handoff 接收四分支，mock 兩個 hook 模組回固定資料）：

```ts
// 1) hash="#minio?source=intake&job_id=J"：jobsLoaded=false → banner data-handoff-status="indeterminate"；
//    jobs 命中 J → "verified"；jobsLoaded=true 未命中且 jobsTruncated=false → "not_found"
// 2) hash="#minio?source=conv&minio_key=a/b/model.ifc"：folder=null → indeterminate；
//    folder.objects 命中 → verified，且 navigate 被呼叫過一次（prefix="a/b/"）
// 3) hash="#minio?source=a1"（無 id 欄位）→ "not_applicable"
// 4) 點左欄物件 → ObjectDetailPane 出現；點返回 → GlobalConversionPane 出現
```

- [ ] **Step 2: 跑測試確認 FAIL**。
- [ ] **Step 3: 實作**：

```tsx
export function ModelDataPage() {
  const data = useConversionData();
  const fs = useMinioFolder();
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const selectedObj = fs.folder?.objects.find((o) => o.key === selectedKey) ?? null;
  // handoff 統一接收（spec §3.4）：job_id/conversion_id 向 jobs/records 重驗（CV 語意，搬 pages.tsx:951-970 原文）；
  // minio_key/prefix 向 folder 重驗（M 語意，搬 1853-1866 原文）；皆無 → not_applicable。
  const incoming = useIncomingHandoff("minio", (h) => { /* 四分支合併，各守門原文 */ });
  // minio_key/prefix 導覽 effect（搬 M 頁 1871-1879 原文，navigate 改 fs.navigate）；
  // job_id 命中且該 job 可對映 object_key 時不自動選檔（佇列高亮已足，避免雙重挾持）。
  return (
    <>
      <h1>{t("模型資料與轉檔", "Model Data & Conversion")}</h1>
      <IncomingHandoffBanner testId="md-incoming-handoff" handoff={incoming.handoff} status={incoming.status} />
      <p className="ec-lead">{/* 融合 CV/M 兩頁 lead 文案：MinIO 唯讀視圖 + 轉檔排程，metadata 權威在 bim-control */}</p>
      <div className="md-split">
        <div className="md-split-tree">
          <MinioTreePane fs={fs} records={data.records} recordsIncomplete={data.recordsIncomplete}
            selectedKey={selectedKey} onSelect={(o) => setSelectedKey(o.key)} />
        </div>
        <div className="md-split-main">
          {selectedObj ? (
            <ObjectDetailPane object={selectedObj} data={data}
              onBack={() => setSelectedKey(null)}
              onGoToFolder={(p) => { fs.navigate(p); }} />
          ) : (
            <GlobalConversionPane data={data}
              onLocateObject={(key) => { fs.navigate(key.slice(0, key.lastIndexOf("/") + 1)); setSelectedKey(key); }}
              highlightJobId={incoming.handoff?.job_id ?? null} />
          )}
        </div>
      </div>
      {/* 頁尾兩個折疊 Panel：DEMO bucket layout（搬 pages.tsx:2046-2057 全文，DEMO 標示照舊）＋
          「與功能頁的關係」（搬 2059-2064 全文）——spec §4 #6/#7 */}
    </>
  );
}
```

`selectedKey` 若在 folder 重載後查無（物件被刪），`selectedObj` 為 null 自動回總覽——誠實不顯 stale 詳情。CSS 追加到 edge-console.css 檔尾：

```css
/* MD 三頁合一（spec §3）：主從雙欄。窄視窗退化為上下疊。 */
.md-split { display: grid; grid-template-columns: minmax(260px, 1fr) minmax(0, 2fr); gap: 14px; align-items: start; }
@media (max-width: 1100px) { .md-split { grid-template-columns: 1fr; } }
.md-split-tree { min-width: 0; }
.md-split-main { min-width: 0; }
[data-selected="true"] { outline: 1px solid var(--ec-accent, #7fd962); border-radius: 4px; }
```

- [ ] **Step 4: 跑測試確認 PASS**；`npx tsc --noEmit` 綠。
- [ ] **Step 5: Commit**——`git commit -m "feat(console): ModelDataPage 主從雙欄殼層＋handoff 統一接收（MD 合一 Task 6）"`

---

### Task 7: EdgeConsole／data.ts 路由與導覽整合（spec §5）

**Files:**
- Modify: `web-viewer-sample/src/console/EdgeConsole.tsx`、`web-viewer-sample/src/console/data.ts`
- Test: `web-viewer-sample/src/console/console.test.tsx`（更新斷言）＋`web-viewer-sample/src/console/EdgeConsole.aliasRedirect.test.tsx`（新增）

**Interfaces:**
- Consumes: `ModelDataPage`（Task 6）
- Produces: `#minio` render `ModelDataPage`；`#conv`/`#intake` 掛 `AliasRedirect`

- [ ] **Step 1: 寫失敗測試**（`EdgeConsole.aliasRedirect.test.tsx`）：

```ts
// 1) renderToString(<EdgeConsole/>) 於 hash="#conv?job_id=J" 時不拋錯、輸出不含舊 CV 頁 h1（純渲染不導航——useEffect 不跑）
// 2) DOM 掛載（createRoot）hash="#conv?job_id=J" → waitFor(window.location.hash === "#minio?job_id=J")（重導保 query）
// 3) hash="#intake" → waitFor hash "#minio"
// console.test.tsx 更新：nav 出現「模型資料與轉檔」與 no="MD"；不出現「IFC→USD 轉檔排程」「Model Intake」nav 項
```

- [ ] **Step 2: 跑測試確認 FAIL**。
- [ ] **Step 3: 實作**——EdgeConsole.tsx：

```tsx
// alias 重導（spec §5）：repo 第一個 URL 重寫式 alias。只能在 useEffect（renderToString 純渲染不觸發）。
function AliasRedirect({ to }: { to: string }) {
  useEffect(() => {
    const raw = window.location.hash;
    const q = raw.includes("?") ? raw.slice(raw.indexOf("?")) : "";
    window.location.replace(`#${to}${q}`);   // replace：不留 history 污染
  }, [to]);
  return null;
}
```

switch 改：`case "conv": case "intake": return <AliasRedirect to="minio" />;`、`case "minio": return <ModelDataPage />;`（刪 `ConversionSchedulingPage`/`IntakePage`/`MinioDataPage` 三個 import 與 case——import 刪除留到 Task 9 一併驗證無他處引用）。`railAxis`：`AXIS_SET` 判斷前加 `const effectivePage = page === "conv" || page === "intake" ? "minio" : page;` 並以 `effectivePage` 計算。`NAV_LABEL`：`minio: { tech: "Model Data & Conversion", biz: "模型資料與轉檔" }`（`conv`/`intake` 條目保留）。`FLOW`：①②的 `page: "intake"` 改 `page: "minio"`。`COPILOT_PROMPTS`：`conv` 三條 prompts 併入 `minio` 陣列、刪 `conv` key。data.ts `PAGES`：刪 `conv`、`intake` 兩項；`minio` 項改 `{ key: "minio", no: "MD", label: "模型資料與轉檔", plane: "governance", group: "coordinator" }`。
- [ ] **Step 4: 跑測試確認 PASS**（新檔＋console.test.tsx＋routing.test.ts 全綠）。
- [ ] **Step 5: Commit**——`git commit -m "feat(console): #minio 掛 ModelDataPage、#conv/#intake 重導 alias、nav 改 MD（MD 合一 Task 7）"`

---

### Task 8: 發送端 handoff target/source 更新（spec §5）

**Files:**
- Modify: `grep -rn 'buildHandoff("conv"' web-viewer-sample/src/console/` 與 `buildHandoff("intake"` 的所有命中檔（已知至少 `pages.tsx` 的 `IssuesRuleCenterPage`；以 grep 實測為準）
- Test: `A1CrossLinks.test.tsx`／`IntakeCrossLinks.test.tsx`／`MinioCrossLinks.test.tsx`／`CoordinatorCrossLinks.test.tsx` 等既有 cross-link 測試更新斷言

- [ ] **Step 1: 盤點**——Run: `grep -rn "buildHandoff(\"conv\"\|buildHandoff(\"intake\"" web-viewer-sample/src/`。記錄每一處。
- [ ] **Step 2: 逐處修改**——target `"conv"`→`"minio"`（payload 欄位不變）；發自即將刪除的三舊頁者跳過（Task 9 隨頁刪除）。同步把對應測試檔中斷言 hash 前綴 `#conv`→`#minio` 的期望值更新。
- [ ] **Step 3: 跑受影響測試確認 PASS**——Run: `npx vitest run src/console/A1CrossLinks.test.tsx src/console/IntakeCrossLinks.test.tsx src/console/MinioCrossLinks.test.tsx`。
- [ ] **Step 4: Commit**——`git commit -m "refactor(console): 發送端 buildHandoff target conv/intake→minio（MD 合一 Task 8）"`

---

### Task 9: 移除三舊頁＋測試檔收尾（spec §6）

**Files:**
- Modify: `web-viewer-sample/src/console/pages.tsx`（刪 `ConversionSchedulingPage` 898-1461、`MinioDataPage` 1721-2067、`IntakePage` 3223-3285 及僅它們使用的孤兒 state/helper——刪前逐一 grep 確認無他頁引用）
- Delete: `ConversionSchedulingPage.test.tsx`、`MinioDataPage.test.tsx`、`ConversionHistory.test.tsx`（斷言已於 Task 3/4/5 遷移；刪除前逐檔比對遷移清單，未遷移的斷言先補進新測試檔再刪）
- Modify: `EdgeConsole.tsx`（刪三舊頁 import）

- [ ] **Step 1: 刪除前比對**——列出三個舊測試檔的所有 `it(...)` 名稱，逐一確認新測試檔有對應（或明確記錄為「已隨移除的 UI 一併退役」，例：M 頁物件列觸發鈕測試→由 Task 5 詳情觸發鈕測試取代）。
- [ ] **Step 2: 刪頁、刪 import、刪孤兒 helper**——`npx tsc --noEmit` 直到 0 error（tsc 未引用報錯是孤兒 helper 的權威清單）。
- [ ] **Step 3: 全套測試**——Run: `npm test`。Expected: 全綠。
- [ ] **Step 4: GitNexus detect_changes**（可用時）確認變更面只落在 console 前端。
- [ ] **Step 5: Commit**——`git commit -m "refactor(console): 移除 CV/M/IN 三舊頁（MD 合一 Task 9，pages.tsx 淨減約 900 行）"`

---

### Task 10: 全量驗證＋browser E2E 證據＋PR（spec §8、§11）

**Files:**
- Create: `artifacts/e2e/md-merge-trace/`（截圖證據；PNG 需 `git add -f`，`.gitignore` 擋 `*.png`）

- [ ] **Step 1: 全量驗證**——Run（web-viewer-sample 下）: `npm run verify`（= build＋test＋test:struct-log）＋`npx tsc --noEmit`。Expected: 全綠。
- [ ] **Step 2: 起 branch 隔離 stack 或部署區 dev server**（不污染 `:8004` 部署區——沿用既有 branch E2E 模式：`npm run dev` 於 5173 或 branch coordinator :8005；只驗前端可用 dev server＋真 coordinator API）。
- [ ] **Step 3: gstack／headless Chrome 截圖六項證據**（spec §8）：(1) `#conv?job_id=…` 重導後 `#minio?job_id=…` 佇列高亮；(2) 左欄點 source IFC→單檔詳情真 ledger 狀態；(3) failed 檔觸發轉檔 intent→confirm 全程；(4) watcher 開關 dialog 證據型刷新；(5) 插隊/重試按鈕 gating；(6) 右欄佇列表 overflow-x 捲動無裁切。存 `artifacts/e2e/md-merge-trace/01-…06-*.png`，逐張 Read 回驗內容真實。
- [ ] **Step 4: rebase 檢查**——Run: `git fetch origin && git rev-list --count HEAD..origin/main`。非 0 → rebase 後重跑 Step 1。
- [ ] **Step 5: 開 PR**——title `feat(console): 模型資料與轉檔（MD）— CV/M/IN 三頁合一`；body 含 spec/plan 連結、Frontend Verification 表（逐字 label：Main button(s) tested / Fixture used / Visible success state / Screenshot/trace——填 `artifacts/e2e/md-merge-trace/*`）、§4 對映表 22 項自檢清單。開完 `gh pr merge --squash --auto --delete-branch`。
- [ ] **Step 6: 監看 CI**——pr-review-agent 為 required check；formal spec 已在 branch（`docs/superpowers/specs/2026-07-06-model-data-conversion-merge-design.md`）可消 missing_openspec。紅燈→修→push；綠燈 auto-merge 後 `git fetch --prune`。

---

## Self-Review 紀錄

- **Spec coverage**：§3.1→Task 3/6、§3.2→Task 2/4、§3.3→Task 5、§3.4→Task 6、§4 #1-22→Task 3(1,2,4,6,22)/4(8-15,17,21)/5(3,5,12,15,19,20)/6(6,7,16)/9(#17 動作零損失以佇列表承接)、§5→Task 7/8、§6→Task 1＋File Structure、§7→Task 2（錯誤獨立）、§8→各 task Step＋Task 10、§9/§10→Global Constraints 與 Task 10。無缺口。
- **Placeholder scan**：Task 4/5/6 的「搬移原文」步驟均附精確來源行號（基準 commit `4fb266e`）＋變更點全文，非 TBD。
- **Type consistency**：`ConversionData`（Task 2）／`MinioFolderState`（Task 3）／各 pane props 簽名在 Interfaces 區塊互相引用一致；`useConversionActions.ts` 於 Task 4 建立、Task 5 消費。
