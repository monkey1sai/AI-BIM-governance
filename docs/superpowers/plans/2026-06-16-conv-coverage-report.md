# M2-a #conv 轉檔 coverage 報告展開 UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `#conv` 那行「coverage 待建」(`pages.tsx:427` `prov="p1"`) 翻成真資料 —— coordinator 新增一條 production 唯讀 passthrough，前端每筆轉檔 job 可展開看後端真 coverage（不綁 review session）。

**Architecture:** 三層縱切、全部沿用既有件。coordinator 新 route `GET /api/conversions/:id/quality-metrics` 用既有 `fetchConversionResult` + `buildQualityMetricsSummary`（零計算、與 stream-config 同一真相源）回傳 `ConversionQualityMetricsSummary`；前後端兩份 summary 型別 additive 補 `mapped_count`/`unmapped_count`；`#conv` job 列加展開抽屜懶載入該 route。誠實鐵律：coverage 後端原樣、前端零計算；後端無 property/relationship/attribute 三項拆分 → 前端誠實標「未提供」，不捏值。

**Tech Stack:** coordinator = Node 18 + Express + TypeScript + vitest（`npm run verify` = build && test）；web-viewer = React 18 + TypeScript + Vite + vitest + Playwright（`npm run verify` = build）。

**Spec:** `docs/superpowers/specs/2026-06-16-conv-coverage-report-design.md`（權威；衝突以 spec + 程式碼為準）。

**跨 repo 紀律（每個改 symbol 的 task 必跑）：** 改 function/class/method 前先 `gitnexus_impact({target, direction:"upstream"})`，HIGH/CRITICAL 先回報；commit 前 `gitnexus_detect_changes()` 驗 scope。不在 main 開發：branch → PR → Actions → merge。

---

## File Structure

**bim-review-coordinator（後端，先做，前端才能接）**
- Modify `bim-review-coordinator/src/types.ts:70-86` — `ConversionQualityMetricsSummary` additive 加 `mapped_count?` / `unmapped_count?`。
- Modify `bim-review-coordinator/src/services/streamingConversionClient.ts:396-409` — `buildQualityMetricsSummary` return 補萃取兩欄。
- Modify `bim-review-coordinator/src/app.ts` — 新增 `isSafeConversionJobId` helper + production route `GET /api/conversions/:conversionJobId/quality-metrics`。
- Create `bim-review-coordinator/tests/build-quality-metrics-summary.test.ts` — summary 萃取單元測試。
- Create `bim-review-coordinator/tests/conversion-quality-metrics-route.test.ts` — route 行為 + 邊界 + 同值鎖。

**web-viewer-sample（前端）**
- Modify `web-viewer-sample/src/types/review.ts:10-26` — `ConversionQualityMetricsSummary` additive 加同兩欄。
- Modify `web-viewer-sample/src/console/coordinatorClient.ts:98-112,142-152` — `IfcReadyListItem` 加 `conversion_job_id`；新增 `conversionQualityMetrics` 方法 + `ConversionQualityMetricsResponse` 型別。
- Modify `web-viewer-sample/src/console/pages.tsx:397-499` — `ConversionSchedulingPage` job 列展開抽屜；移除 427 佔位。
- Modify `web-viewer-sample/src/console/ConversionSchedulingPage.test.tsx` — 展開 / 誠實降級單元測試。
- Create `web-viewer-sample/e2e/conv-coverage-report.spec.ts` — browser E2E（gstack 證據）。

---

## Task 1: 後端 summary additive 兩欄（`mapped_count` / `unmapped_count`）

**Files:**
- Modify: `bim-review-coordinator/src/types.ts:70-86`
- Modify: `bim-review-coordinator/src/services/streamingConversionClient.ts:396-409`
- Test: `bim-review-coordinator/tests/build-quality-metrics-summary.test.ts`

- [ ] **Step 1: impact analysis（改 symbol 前必跑）**

Run（MCP）：`gitnexus_impact({target: "buildQualityMetricsSummary", direction: "upstream"})`
Expected: 僅 1 個既有 caller（`ingestStreamingConversionResult` / app.ts:1088）。若報 HIGH/CRITICAL → 停下回報。

- [ ] **Step 2: 寫 failing test**

Create `bim-review-coordinator/tests/build-quality-metrics-summary.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { buildQualityMetricsSummary } from "../src/services/streamingConversionClient.js";
import type { StreamingConversionResult } from "../src/services/streamingConversionClient.js";

function resultWith(quality: Record<string, unknown> | undefined): StreamingConversionResult {
  return {
    conversion_job_id: "stream_conv_20260616_abcd1234",
    status: "succeeded",
    ready: true,
    usdc_ref: "http://x/model.usdc",
    element_mapping_ref: "http://x/element_mapping.json",
    manifest_ref: null,
    reason: null,
    raw: quality === undefined ? {} : { quality_metrics: quality },
  } as StreamingConversionResult;
}

describe("buildQualityMetricsSummary additive mapped/unmapped", () => {
  it("萃取 mapped_count / unmapped_count（後端正規化欄位）", () => {
    const s = buildQualityMetricsSummary(resultWith({
      source_ifc_entity_count: 100, mapped_count: 90, unmapped_count: 10,
      coverage_ratio: 0.9, coverage_status: "warn",
    }));
    expect(s).not.toBeNull();
    expect(s!.mapped_count).toBe(90);
    expect(s!.unmapped_count).toBe(10);
    expect(s!.coverage_ratio).toBe(0.9); // 既有欄位不退化
  });

  it("缺值回 null 不是 undefined（schema-stable 約定）", () => {
    const s = buildQualityMetricsSummary(resultWith({ coverage_ratio: 0.5 }));
    expect(s!.mapped_count).toBeNull();
    expect(s!.unmapped_count).toBeNull();
  });

  it("無 quality_metrics 整體回 null（backward compatible）", () => {
    expect(buildQualityMetricsSummary(resultWith(undefined))).toBeNull();
  });
});
```

- [ ] **Step 3: 跑測試確認 fail**

Run: `cd bim-review-coordinator && npx vitest run tests/build-quality-metrics-summary.test.ts`
Expected: FAIL（`mapped_count` 為 `undefined`，前兩個 case 不過）。

- [ ] **Step 4: 型別加兩 optional 欄**

`bim-review-coordinator/src/types.ts` 在 `coverage_status?` 之後（line 78 後）插入：

```ts
  coverage_status?: string | null;
  // m2a-coverage-report:additive 對應/未對應構件數,供 #conv coverage 展開顯示。
  // strictly additive + optional,既有 caller 不需提供。
  mapped_count?: number | null;
  unmapped_count?: number | null;
```

- [ ] **Step 5: `buildQualityMetricsSummary` 補萃取**

`bim-review-coordinator/src/services/streamingConversionClient.ts` return 物件（396-409）在 `coverage_status: str("coverage_status"),` 之後插入：

```ts
    coverage_status: str("coverage_status"),
    mapped_count: num("mapped_count"),
    unmapped_count: num("unmapped_count"),
```

（`num()` helper 已存在於同函式 370-373，缺值回 `null`。）

- [ ] **Step 6: 跑測試確認 pass**

Run: `cd bim-review-coordinator && npx vitest run tests/build-quality-metrics-summary.test.ts`
Expected: PASS（3 個 case 全綠）。

- [ ] **Step 7: 回歸鎖 — stream-config forwarding 不壞**

Run: `cd bim-review-coordinator && npx vitest run tests/host-native-conversion-ingest.test.ts tests/sessions.test.ts`
Expected: PASS（`host-native-conversion-ingest.test.ts:182` 逐欄 `toBe` 只新增不缺漏；`sessions.test.ts:241` strict `toEqual` 走 caller 直供 summary 路徑、不跑萃取，不受影響）。

- [ ] **Step 8: detect_changes + commit**

Run（MCP）：`gitnexus_detect_changes()` — 確認只動 types.ts / streamingConversionClient.ts。

```bash
git add bim-review-coordinator/src/types.ts bim-review-coordinator/src/services/streamingConversionClient.ts bim-review-coordinator/tests/build-quality-metrics-summary.test.ts
git commit -m "feat(coordinator): quality-metrics-summary additive mapped/unmapped count"
```

---

## Task 2: 後端 conversion-job-id safe-id helper（新增，不複用 isSafeSessionId）

**Files:**
- Modify: `bim-review-coordinator/src/app.ts`（新增 module-scope helper；放在 `createApp` 之外、檔案頂層 helper 區）
- Test: `bim-review-coordinator/tests/conversion-quality-metrics-route.test.ts`（與 Task 3 同檔，本 task 先放 helper 單元段）

- [ ] **Step 1: 寫 failing test**

Create `bim-review-coordinator/tests/conversion-quality-metrics-route.test.ts`（先放 helper 段；Task 3 補 route 段）：

```ts
import { describe, expect, it } from "vitest";
import { isSafeConversionJobId } from "../src/app.js";

describe("isSafeConversionJobId", () => {
  it("接受真實 conversion job id", () => {
    expect(isSafeConversionJobId("stream_conv_20260616_abcd1234")).toBe(true);
  });
  it("擋路徑穿越 / 空值 / 斜線", () => {
    expect(isSafeConversionJobId("../etc/passwd")).toBe(false);
    expect(isSafeConversionJobId("a/b")).toBe(false);
    expect(isSafeConversionJobId("")).toBe(false);
  });
  it("不誤用 session pattern（review_session_ 非必要）", () => {
    expect(isSafeConversionJobId("stream_conv_x")).toBe(true);
  });
});
```

- [ ] **Step 2: 跑測試確認 fail**

Run: `cd bim-review-coordinator && npx vitest run tests/conversion-quality-metrics-route.test.ts`
Expected: FAIL（`isSafeConversionJobId` is not exported / not defined）。

- [ ] **Step 3: 加 helper 並 export**

`bim-review-coordinator/src/app.ts` 檔案頂層（靠近其他 module-scope const，例如 import 區之後）新增：

```ts
// m2a-coverage-report:conversion job id safe-id（比照後端 _safe_id 的 ^[A-Za-z0-9_.-]+$）。
// 不可複用 isSafeSessionId —— 其 pattern 只認 ^review_session_,擋掉 stream_conv_*。
const conversionJobIdPattern = /^[A-Za-z0-9_.-]+$/;
export function isSafeConversionJobId(value: string): boolean {
  return typeof value === "string" && value.length > 0 && conversionJobIdPattern.test(value);
}
```

- [ ] **Step 4: 跑測試確認 pass**

Run: `cd bim-review-coordinator && npx vitest run tests/conversion-quality-metrics-route.test.ts`
Expected: PASS（helper 三個 case 綠；route 段尚未寫，無其他 case）。

- [ ] **Step 5: commit**

```bash
git add bim-review-coordinator/src/app.ts bim-review-coordinator/tests/conversion-quality-metrics-route.test.ts
git commit -m "feat(coordinator): add isSafeConversionJobId helper"
```

---

## Task 3: 後端 production route `GET /api/conversions/:conversionJobId/quality-metrics`

**Files:**
- Modify: `bim-review-coordinator/src/app.ts`（production 路由區，比照 stream-config app.ts:565-576 位置風格；route handler 用既有 `streamingConversionClient` 實例 + `buildQualityMetricsSummary`，**不**用 `proxyConversionService`）
- Test: `bim-review-coordinator/tests/conversion-quality-metrics-route.test.ts`（補 route 段）

> 背景：`fetchConversionResult`（streamingConversionClient.ts:304-345）對 upstream non-ok 會 `throw new Error("streaming conversion result API <status>: ...")`；fetch 逾時（`AbortSignal.timeout`）throw `TimeoutError`。回傳物件含 `usdc_ref` / `element_mapping_ref`（339-340）。

- [ ] **Step 1: 寫 failing test（route 段，append 到 Task 2 的測試檔）**

在 `tests/conversion-quality-metrics-route.test.ts` append（route 測試用既有 coordinator app 啟動方式，比照 `tests/host-native-conversion-ingest.test.ts` 如何建立 app 與 mock `streamingConversionClient`——沿用該檔的 app factory import 與 supertest/fetch 風格）：

```ts
// route 段：以既有測試 harness 啟動 coordinator app，stub streamingConversionClient.fetchConversionResult。
// 斷言（描述 behaviour，實作時對齊 host-native-conversion-ingest.test.ts 的 app 啟動/注入方式）：
//
// 1) 成功：fetchConversionResult 回含 quality_metrics 的 result
//    → GET /api/conversions/stream_conv_x/quality-metrics 回 200
//    → body.quality_metrics_summary.coverage_ratio === 後端值
//    → body.quality_metrics_summary.mapped_count / unmapped_count 帶出
//    → body.usdc_url === result.usdc_ref；body.mapping_url === result.element_mapping_ref
// 2) summary null：result.raw 無 quality_metrics → 200 + body.quality_metrics_summary === null（誠實，非錯誤）
// 3) 非法 id：GET /api/conversions/..%2f../quality-metrics → 400
// 4) authority 404：fetchConversionResult throw Error("streaming conversion result API 404: ...") → 路由回 404，body 無 coverage 數字
// 5) authority 連不上：fetchConversionResult throw 一般 Error → 502，body 無 coverage 數字
// 6) 同值鎖：同一 result 經本 route 與經 buildQualityMetricsSummary（stream-config 真相源）coverage_ratio 相等
```

> 實作此測試時，**先讀** `tests/host-native-conversion-ingest.test.ts` 頂部（app 如何建立、`streamingConversionClient` 如何注入/mock），照同一 harness 寫成可執行 case；上面註解每條對應一個 `it(...)`。

- [ ] **Step 2: 跑測試確認 fail**

Run: `cd bim-review-coordinator && npx vitest run tests/conversion-quality-metrics-route.test.ts`
Expected: FAIL（route 尚未存在 → 404/route-not-found）。

- [ ] **Step 3: 加 route**

`bim-review-coordinator/src/app.ts` production 路由區（比照 stream-config 565-576 的位置；`streamingConversionClient` 與 `buildQualityMetricsSummary` 在此 scope 已可用）新增：

```ts
// m2a-coverage-report:production 唯讀 passthrough。以 conversion_job_id 取後端品質摘要,
// 不綁 review session。coordinator 零計算 —— 值全來自 buildQualityMetricsSummary（與
// stream-config 同一真相源）。錯誤路徑一律不回捏造 coverage。
app.get("/api/conversions/:conversionJobId/quality-metrics", async (request, response) => {
  const jobId = request.params.conversionJobId;
  if (!isSafeConversionJobId(jobId)) {
    response.status(400).json({ detail: "Invalid conversion job id." });
    return;
  }
  try {
    const result = await streamingConversionClient.fetchConversionResult(jobId);
    const summary = buildQualityMetricsSummary(result);
    response.json({
      conversion_job_id: result.conversion_job_id,
      quality_metrics_summary: summary, // 可能為 null（result 無 quality_metrics）—— 誠實「未取得」
      usdc_url: result.usdc_ref,
      mapping_url: result.element_mapping_ref,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/API 404\b/.test(msg)) {
      response.status(404).json({ detail: "Conversion job result not found." });
      return;
    }
    const name = err instanceof Error ? err.name : "";
    const code = name === "TimeoutError" || /timeout|aborted/i.test(msg) ? 503 : 502;
    response.status(code).json({ detail: `Conversion authority unreachable: ${msg}` });
  }
});
```

> 若 `streamingConversionClient` 在該 scope 的變數名不同，改用實際名稱；`buildQualityMetricsSummary` 已 import（app.ts:1088 既有使用）。

- [ ] **Step 4: 跑測試確認 pass**

Run: `cd bim-review-coordinator && npx vitest run tests/conversion-quality-metrics-route.test.ts`
Expected: PASS（helper 段 + route 6 條全綠）。

- [ ] **Step 5: 全測 + build 回歸**

Run: `cd bim-review-coordinator && npm run verify`
Expected: build PASS + 全測 PASS（含 host-native-conversion-ingest / sessions / external-ifc-ready 回歸）。

- [ ] **Step 6: detect_changes + commit**

Run（MCP）：`gitnexus_detect_changes()` — 確認只動 app.ts + 新測試檔。

```bash
git add bim-review-coordinator/src/app.ts bim-review-coordinator/tests/conversion-quality-metrics-route.test.ts
git commit -m "feat(coordinator): GET /api/conversions/:id/quality-metrics production passthrough"
```

---

## Task 4: 前端型別 + client（additive 兩欄、`conversion_job_id`、`conversionQualityMetrics`）

**Files:**
- Modify: `web-viewer-sample/src/types/review.ts:10-26`
- Modify: `web-viewer-sample/src/console/coordinatorClient.ts:98-112,142-152`

> 驗證方式：本 task 為純型別/方法新增，以 `npm run build`（tsc）作 RED→GREEN（先寫會被 build 擋的最小消費點，再補定義）。下一個 task 的元件測試會跑到 `conversionQualityMetrics`。

- [ ] **Step 1: web-viewer summary 型別補兩欄**

`web-viewer-sample/src/types/review.ts` `ConversionQualityMetricsSummary`（10-26）在 `coverage_status?` 之後插入：

```ts
    coverage_status?: string | null;
    // m2a-coverage-report:additive 對應/未對應構件數（後端 quality_metrics 既有）。
    mapped_count?: number | null;
    unmapped_count?: number | null;
```

- [ ] **Step 2: `IfcReadyListItem` 補 `conversion_job_id`（wire 已有）**

`web-viewer-sample/src/console/coordinatorClient.ts` `IfcReadyListItem`（98-112）在 `conversion_authority: string | null;` 之後插入：

```ts
  conversion_authority: string | null;
  // m2a-coverage-report:wire 已有（app.ts summarizeIfcReadyJob:1907），補型別供 #conv 展開讀取。
  conversion_job_id: string | null;
```

- [ ] **Step 3: 新增 response 型別 + client 方法**

`web-viewer-sample/src/console/coordinatorClient.ts`：先確保檔頂 import 了 `ConversionQualityMetricsSummary`（若未 import，加 `import type { ConversionQualityMetricsSummary } from "../types/review";`）。在 `IfcReadyListItem` 附近加回應型別：

```ts
export interface ConversionQualityMetricsResponse {
  conversion_job_id: string;
  quality_metrics_summary: ConversionQualityMetricsSummary | null;
  usdc_url?: string | null;
  mapping_url?: string | null;
}
```

在 `coordinatorClient` 物件（142-152）內，`streamConfig` 之後加方法：

```ts
  streamConfig: (sessionId: string) => jsonGet<StreamConfigResponse>(`/api/review-sessions/${encodeURIComponent(sessionId)}/stream-config`),
  conversionQualityMetrics: (conversionJobId: string) =>
    jsonGet<ConversionQualityMetricsResponse>(`/api/conversions/${encodeURIComponent(conversionJobId)}/quality-metrics`),
```

- [ ] **Step 4: build 驗證（tsc）**

Run: `cd web-viewer-sample && npm run build`
Expected: PASS（型別自洽；無 unused/型別錯誤）。

- [ ] **Step 5: commit**

```bash
git add web-viewer-sample/src/types/review.ts web-viewer-sample/src/console/coordinatorClient.ts
git commit -m "feat(web-viewer): conversion quality-metrics client + IfcReadyListItem conversion_job_id"
```

---

## Task 5: 前端 `#conv` coverage 展開抽屜（`ConversionSchedulingPage`）

**Files:**
- Modify: `web-viewer-sample/src/console/pages.tsx:397-499`（`ConversionSchedulingPage`；移除 427 佔位 Field）
- Test: `web-viewer-sample/src/console/ConversionSchedulingPage.test.tsx`

> 既有元件：`Btn` / `Field` / `Panel` 從 `./components` import（pages.tsx:4）。job 表在 472-496。測試 harness：`ConversionSchedulingPage.test.tsx` 已有 `createRoot` + `act` + `vi.spyOn(coordinatorClient, ...)` 模式（見該檔 27-69）。

- [ ] **Step 1: 寫 failing test（展開呼叫 + 渲染真 coverage）**

`web-viewer-sample/src/console/ConversionSchedulingPage.test.tsx` append 一個 describe（沿用檔內 `createRoot`/`act` harness 與 `baseJob`）：

```ts
describe("ConversionSchedulingPage coverage 展開（M2-a）", () => {
  const actEnvKey = "IS_REACT_ACT_ENVIRONMENT" as const;
  let container: HTMLDivElement;
  let prevActEnv: unknown;
  const job: IfcReadyListItem = {
    project_id: "270", download_status: "downloaded", conversion_authority: "bim-streaming-server",
    review_session_id: null, viewer_url: null, expected_stage_url: null, expected_mapping_url: null,
    created_at: "2026-06-16T00:00:00Z", ifc_ready_job_id: "ifcready_cov", external_model_version_id: "ext_cov",
    status: "dispatched", conversion_status: "succeeded", dispatch_error: null,
    conversion_job_id: "stream_conv_20260616_cov",
  };
  beforeEach(() => {
    prevActEnv = (globalThis as Record<string, unknown>)[actEnvKey];
    (globalThis as Record<string, unknown>)[actEnvKey] = true;
    container = document.createElement("div"); document.body.appendChild(container);
  });
  afterEach(() => {
    document.body.removeChild(container); vi.restoreAllMocks();
    (globalThis as Record<string, unknown>)[actEnvKey] = prevActEnv;
  });

  it("展開有 conversion_job_id 的 job → 呼叫 conversionQualityMetrics、顯示 coverage%(×100)+mapped/unmapped", async () => {
    vi.spyOn(coordinatorClient, "listIfcReady").mockResolvedValue({ count: 1, items: [job] });
    vi.spyOn(coordinatorClient, "minioWatchStatus").mockResolvedValue({ enabled: false });
    const spy = vi.spyOn(coordinatorClient, "conversionQualityMetrics").mockResolvedValue({
      conversion_job_id: "stream_conv_20260616_cov",
      quality_metrics_summary: {
        coverage_ratio: 0.9886, coverage_status: "warn", mapped_count: 988, unmapped_count: 12,
        source_ifc_entity_count: 1000, materialization_strategy: "sidecar",
      },
      usdc_url: "http://x/model.usdc", mapping_url: "http://x/element_mapping.json",
    });
    const root = createRoot(container);
    await act(async () => { root.render(<ConversionSchedulingPage />); });
    await act(async () => { await Promise.resolve(); });
    // 點展開鈕（穩定 testid）
    const toggle = container.querySelector('[data-testid="conv-coverage-toggle-ifcready_cov"]') as HTMLElement;
    expect(toggle).not.toBeNull();
    await act(async () => { toggle.click(); });
    await act(async () => { await Promise.resolve(); });
    expect(spy).toHaveBeenCalledWith("stream_conv_20260616_cov");
    const drawer = container.querySelector('[data-testid="conv-coverage-ifcready_cov"]')!;
    expect(drawer.textContent).toContain("98.86"); // coverage_ratio×100 原樣
    expect(drawer.textContent).toContain("988");    // mapped
    expect(drawer.textContent).toContain("12");     // unmapped
    expect(drawer.textContent).toContain("model.usdc");
    expect(drawer.textContent).toContain("未提供");  // 三項拆分誠實標
  });

  it("無 conversion_job_id 的 job → 不可展開、顯尚未派工", async () => {
    const noConv: IfcReadyListItem = { ...job, ifc_ready_job_id: "ifcready_noconv", conversion_job_id: null, conversion_status: "pending" };
    vi.spyOn(coordinatorClient, "listIfcReady").mockResolvedValue({ count: 1, items: [noConv] });
    vi.spyOn(coordinatorClient, "minioWatchStatus").mockResolvedValue({ enabled: false });
    const root = createRoot(container);
    await act(async () => { root.render(<ConversionSchedulingPage />); });
    await act(async () => { await Promise.resolve(); });
    expect(container.querySelector('[data-testid="conv-coverage-toggle-ifcready_noconv"]')).toBeNull();
    expect(container.textContent).toContain("尚未派工");
  });

  it("展開遇 route 錯誤 → 顯誠實錯誤、不顯任何 coverage 數字", async () => {
    vi.spyOn(coordinatorClient, "listIfcReady").mockResolvedValue({ count: 1, items: [job] });
    vi.spyOn(coordinatorClient, "minioWatchStatus").mockResolvedValue({ enabled: false });
    vi.spyOn(coordinatorClient, "conversionQualityMetrics").mockRejectedValue(new Error("/api/conversions/... -> 502"));
    const root = createRoot(container);
    await act(async () => { root.render(<ConversionSchedulingPage />); });
    await act(async () => { await Promise.resolve(); });
    const toggle = container.querySelector('[data-testid="conv-coverage-toggle-ifcready_cov"]') as HTMLElement;
    await act(async () => { toggle.click(); });
    await act(async () => { await Promise.resolve(); });
    const drawer = container.querySelector('[data-testid="conv-coverage-ifcready_cov"]')!;
    expect(drawer.textContent).toContain("/api/conversions");
    expect(drawer.textContent).not.toMatch(/\d+\.\d+\s*%/); // 無假百分比
  });
});
```

- [ ] **Step 2: 跑測試確認 fail**

Run: `cd web-viewer-sample && npx vitest run src/console/ConversionSchedulingPage.test.tsx`
Expected: FAIL（無 `conv-coverage-toggle-*` / `conv-coverage-*` 節點）。

- [ ] **Step 3: 改 `ConversionSchedulingPage` 加展開抽屜**

在 `pages.tsx` `ConversionSchedulingPage`（397）內，state 區（398-402）加：

```ts
  const [openJob, setOpenJob] = useState<string | null>(null);
  const [cov, setCov] = useState<Record<string, ConversionQualityMetricsResponse | { error: string } | "loading">>({});
```

（並於檔頂 import 補 `ConversionQualityMetricsResponse`：`import { coordinatorClient, ConversionQualityMetricsResponse, IfcReadyListItem, MinioWatchStatus, RuntimeStatus } from "./coordinatorClient";`）

加展開 handler（`load` 之後）：

```ts
  const toggleCoverage = useCallback(async (job: IfcReadyListItem) => {
    if (!job.conversion_job_id) return;
    const id = job.ifc_ready_job_id;
    if (openJob === id) { setOpenJob(null); return; }
    setOpenJob(id);
    if (cov[id] && cov[id] !== "loading" && !("error" in (cov[id] as object))) return; // 去重
    setCov((p) => ({ ...p, [id]: "loading" }));
    try {
      const r = await coordinatorClient.conversionQualityMetrics(job.conversion_job_id);
      setCov((p) => ({ ...p, [id]: r }));
    } catch (e) {
      setCov((p) => ({ ...p, [id]: { error: `未取得 coverage：${String(e)}` } }));
    }
  }, [openJob, cov]);
```

把 job 表（472-496）的 `<tbody>` 每列改為「主列 + 條件展開列」。主列尾欄加展開鈕；無 `conversion_job_id` 顯「尚未派工」：

```tsx
<tbody>{jobs.slice(0, 20).map((j) => (
  <Fragment key={j.ifc_ready_job_id}>
    <tr>
      <td>{j.ifc_ready_job_id}</td>
      <td>{j.project_id}</td>
      <td>{j.conversion_status ?? "—"}</td>
      <td>{j.dispatch_error ? (
        <span className="ec-warn-note" data-testid={`conv-dispatch-error-${j.ifc_ready_job_id}`} title={j.dispatch_error}>
          {j.dispatch_error.length > 80 ? `${j.dispatch_error.slice(0, 80)}…` : j.dispatch_error}
        </span>) : "—"}</td>
      <td>{j.review_session_id ?? "—"}</td>
      <td>{j.expected_stage_url ?? "—"}</td>
      <td>{j.conversion_job_id
        ? <Btn caption="coverage" data-testid={`conv-coverage-toggle-${j.ifc_ready_job_id}`} onClick={() => void toggleCoverage(j)}>{openJob === j.ifc_ready_job_id ? "收合" : "coverage"}</Btn>
        : <span className="ec-note">尚未派工</span>}</td>
    </tr>
    {openJob === j.ifc_ready_job_id && (
      <tr><td colSpan={7}>
        <div data-testid={`conv-coverage-${j.ifc_ready_job_id}`}>
          <CoverageDrawer state={cov[j.ifc_ready_job_id]} />
        </div>
      </td></tr>
    )}
  </Fragment>
))}</tbody>
```

（檔頂 import 補 `Fragment`：`import { Fragment, useCallback, useEffect, useReducer, useRef, useState } from "react";`。`Btn` 若不支援 `data-testid` 透傳，改在外層 `<span data-testid=…>` 包住。）

加 `CoverageDrawer` 小元件（同檔 `ConversionSchedulingPage` 之上或之下）：

```tsx
function pct(r?: number | null): string {
  return typeof r === "number" && Number.isFinite(r) ? `${(r * 100).toFixed(2)}%` : "未取得";
}
function CoverageDrawer({ state }: { state: ConversionQualityMetricsResponse | { error: string } | "loading" | undefined }) {
  if (state === "loading" || state === undefined) return <p className="ec-note">讀取 coverage…</p>;
  if ("error" in state) return <p className="ec-warn-note">{state.error}</p>;
  const s = state.quality_metrics_summary;
  if (!s) return <p className="ec-note">未取得品質遙測（後端未提供 quality_metrics）。</p>;
  return (
    <>
      <Field k="coverage" v={`${pct(s.coverage_ratio)}${s.coverage_status ? ` · ${s.coverage_status}` : ""}`} prov="artifact" />
      <Field k="mapped / unmapped" v={`${s.mapped_count ?? "未取得"} / ${s.unmapped_count ?? "未取得"}`} prov="artifact" />
      <Field k="source IFC entity" v={String(s.source_ifc_entity_count ?? "未取得")} prov="artifact" />
      <Field k="materialization" v={s.materialization_strategy ?? "未取得"} prov="artifact" />
      <Field k="usdc 輸出" v={state.usdc_url ?? "未取得"} prov="artifact" />
      <Field k="mapping_url" v={state.mapping_url ?? "未取得"} prov="artifact" />
      <Field k="property / relationship / attribute 三項" v="後端未提供（以 coverage_ratio 為準；三項拆分為 follow-up）" prov="p1" />
    </>
  );
}
```

最後移除 427 行的佔位 Field：

```tsx
// 刪除這行（coverage 改由展開抽屜呈現真資料）：
// <Field k="mapping coverage" v="property / relationship / attribute coverage 必須顯示；不得承諾 100% lossless" prov="p1" />
```

- [ ] **Step 4: 跑測試確認 pass**

Run: `cd web-viewer-sample && npx vitest run src/console/ConversionSchedulingPage.test.tsx`
Expected: PASS（新 3 case + 既有 MinIO/錯誤獨立 case 全綠）。

- [ ] **Step 5: build 回歸**

Run: `cd web-viewer-sample && npm run verify`
Expected: PASS（tsc build 綠）。

- [ ] **Step 6: commit**

```bash
git add web-viewer-sample/src/console/pages.tsx web-viewer-sample/src/console/ConversionSchedulingPage.test.tsx
git commit -m "feat(web-viewer): #conv coverage 展開抽屜（真資料 passthrough，三項誠實標未提供）"
```

---

## Task 6: Browser E2E（gstack 證據，唯一接受的 user-facing 驗收）

**Files:**
- Create: `web-viewer-sample/e2e/conv-coverage-report.spec.ts`
- Evidence: `artifacts/e2e/conv-coverage-report-*`（截圖/summary）+ tracked `docs/evidence/conv-coverage-report/`

> 守門/skip 限制揭露**先讀並比照** `web-viewer-sample/e2e/a2-version-diff-selector.spec.ts` 與 `web-viewer-sample/e2e/minio-fileserver-source.spec.ts`（同一 gating 慣例：缺 stack / 缺真 job 時 honest skip 並在檔頭揭露限制，不假綠）。

- [ ] **Step 1: 寫 E2E spec**

Create `web-viewer-sample/e2e/conv-coverage-report.spec.ts`，比照上述兩個既有 spec 的 import / baseURL / gating，內容：
- 前置：coordinator `/api/external/ifc-ready` 至少一筆**已派工（有 `conversion_job_id`、`conversion_status=succeeded`）**的真 job；無則 honest skip 並揭露「需先有已轉檔 job」。
- 步驟：開 `#conv` → 按 `Refresh queue` → 點該 job 的 `conv-coverage-toggle-<id>` → 等 `conv-coverage-<id>` 抽屜出現 → 斷言抽屜內含真 `coverage`（×100 數字）+ `coverage_status` + mapped/unmapped + `model.usdc` 路徑。
- 截圖落 `artifacts/e2e/conv-coverage-report-<timestamp>.png` + 寫一份 summary。

- [ ] **Step 2: 跑 E2E**

Run: `cd web-viewer-sample && npx playwright test e2e/conv-coverage-report.spec.ts`
Expected: PASS（有真 stack + 已轉檔 job 時）；否則 honest SKIP 並在輸出揭露限制——**不可假綠**。

- [ ] **Step 3: 落 tracked 證據 + commit**

把代表性截圖 + summary 複製到 `docs/evidence/conv-coverage-report/`（抽樣即可，勿 commit 大檔/IFC/usdc）。

```bash
git add web-viewer-sample/e2e/conv-coverage-report.spec.ts docs/evidence/conv-coverage-report/
git commit -m "test(e2e): #conv coverage 展開 browser evidence"
```

---

## Task 7: 收尾驗證 + PR

- [ ] **Step 1: 兩 repo 全驗證**

Run: `cd bim-review-coordinator && npm run verify`（build && test 全綠）
Run: `cd web-viewer-sample && npm run verify`（build 綠）+ `npx vitest run src/console/ConversionSchedulingPage.test.tsx`

- [ ] **Step 2: GitNexus 收尾**

Run（MCP）：`gitnexus_detect_changes({scope: "all"})` — 確認改動集 = {coordinator: types.ts / streamingConversionClient.ts / app.ts (+2 test)；web-viewer: review.ts / coordinatorClient.ts / pages.tsx (+1 test) / e2e}；無外溢。

- [ ] **Step 3: 開 PR（不在 main 開發）**

```bash
git push -u origin <branch>
gh pr create --title "feat: #conv 轉檔 coverage 報告展開（M2-a 唯讀 passthrough）" --body "<列改動檔 + 最小驗證 + 已知風險>"
```

- [ ] **Step 4: 四項回報**

回報：(1) 改了哪些 tracked files；(2) 跑了哪些最小驗證（兩 repo verify + vitest + E2E）；(3) 哪些沒跑與原因（如 E2E 因無真 stack honest skip）；(4) 已知風險（三項拆分 follow-up M2-a2、新 production 路由暴露面已限品質摘要子集）。

---

## Self-Review（plan 對 spec 覆蓋檢查）

- **spec §2 目標 1（production 唯讀路由）** → Task 2（safe-id）+ Task 3（route）。✓
- **spec §2 目標 2（summary additive 兩欄）** → Task 1（後端）+ Task 4 Step 1（前端型別）。✓
- **spec §2 目標 3（#conv 展開、IfcReadyListItem 補欄、client 方法）** → Task 4 + Task 5。✓
- **spec §2 目標 4（誠實鐵律：三項未提供 / 未派工 / 錯誤不假值 / 零計算）** → Task 5（CoverageDrawer 分支）+ Task 3（錯誤路徑不回 coverage）。✓
- **spec §2 目標 5 + §6.3（Browser E2E）** → Task 6。✓
- **spec §4.2 回歸界線（host-native-conversion-ingest / sessions / external-ifc-ready）** → Task 1 Step 7 + Task 3 Step 5。✓
- **spec §3 非目標（不改轉檔引擎 / 不碰 ifc-ready 契約形狀 / 不動 dev route / 不直連 :49101）** → 計畫零涉 bim-streaming-server、`conversion_job_id` 只補型別、route 走 coordinator。✓
- **型別一致性**：`conversionQualityMetrics` / `ConversionQualityMetricsResponse` / `isSafeConversionJobId` / `conv-coverage-toggle-<id>` / `conv-coverage-<id>` 跨 Task 3/4/5/6 命名一致。✓
- **Placeholder 掃描**：route 段測試以註解描述 6 條 behaviour 並要求對齊既有 harness（因 coordinator 測試 app 啟動方式需讀既有檔），非 TODO；其餘步驟均含可執行碼與指令。
