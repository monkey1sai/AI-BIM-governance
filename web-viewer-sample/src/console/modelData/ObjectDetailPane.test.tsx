// web-viewer-sample/src/console/modelData/ObjectDetailPane.test.tsx
// MD 三頁合一 Task 5：單檔詳情 ObjectDetailPane（純呈現＋本地 coverage state＋動作經 useConversionActions）。
// 測試模式：本元件吃 props（object/data/onBack/onGoToFolder），直接構造 ConversionData 物件與 MinioObject
// 當 props（不需真 hook harness）。動作路徑 mock coordinatorClient 的 triggerConversion/conversionPrioritize/
// conversionRetry（比照 GlobalConversionPane.test.tsx 慣例）。斷言一律 waitFor（禁同步斷言，flaky 前科）。
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectDetailPane } from "./ObjectDetailPane";
import type { ConversionData } from "./useConversionData";
import { coordinatorClient, type ConversionRecord, type IfcReadyListItem, type MinioObject } from "../coordinatorClient";
import { parseHandoff } from "../handoff";

const actEnvKey = "IS_REACT_ACT_ENVIRONMENT" as const;

async function waitFor(assert: () => void, maxTicks = 40): Promise<void> {
  let lastErr: unknown;
  for (let i = 0; i < maxTicks; i++) {
    await act(async () => { await Promise.resolve(); });
    try { assert(); return; } catch (e) { lastErr = e; }
  }
  throw lastErr;
}

const K = "mw_key0000000001";

function makeObject(over: Partial<MinioObject> = {}): MinioObject {
  return {
    key: "a/b/model.ifc", etag: "etag1", role: "source_ifc",
    project_id: "p1", project_display_name: "專案A", category: "建築",
    version: "v1", idempotency_key: K,
    ...over,
  };
}

function makeRecord(over: Partial<ConversionRecord> = {}): ConversionRecord {
  return {
    idempotency_key: K, project_id: "p1", project_display_name: "專案A",
    category: "建築", external_model_version_id: "000001", conversion_job_id: null,
    status: "failed", usdc_key: null, coverage_report: null,
    object_key: "a/b/model.ifc", detected_at: "2026-06-23T02:00:00.000Z",
    updated_at: "2026-06-23T02:05:00.000Z",
    ...over,
  };
}

function makeJob(over: Partial<IfcReadyListItem> = {}): IfcReadyListItem {
  return {
    ifc_ready_job_id: "ifcready_1", status: "dispatch_failed", project_id: "p1",
    external_model_version_id: "000001", download_status: "downloaded",
    conversion_status: "dispatch_failed", conversion_authority: null,
    queue_position: null, conversion_job_id: null, dispatch_error: null,
    review_session_id: null, viewer_url: null, expected_stage_url: null,
    expected_mapping_url: null, created_at: "2026-06-16T00:00:00Z",
    updated_at: "2026-06-16T00:00:00Z", idempotency_key: K,
    ...over,
  };
}

function makeData(over: Partial<ConversionData> = {}): ConversionData {
  return {
    jobs: [], jobsErr: null, jobsTruncated: false, jobsLoaded: true,
    records: [], recErr: null, recordsTruncated: false, recordsLoaded: true,
    recordsIncomplete: false, mw: null, mwErr: null, history: null, historyErr: false,
    busy: false,
    load: vi.fn(async () => ({ jobsOk: true, mwOk: true })),
    loadRecords: vi.fn(async () => {}),
    ...over,
  };
}

let container: HTMLDivElement;
let root: Root;
let prevActEnv: unknown;

beforeEach(() => {
  prevActEnv = (globalThis as Record<string, unknown>)[actEnvKey];
  (globalThis as Record<string, unknown>)[actEnvKey] = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  window.location.hash = "";
});
afterEach(async () => {
  await act(async () => { root?.unmount(); });
  document.body.removeChild(container);
  vi.restoreAllMocks();
  window.location.hash = "";
  (globalThis as Record<string, unknown>)[actEnvKey] = prevActEnv;
});

function render(props: {
  object?: MinioObject; data?: ConversionData;
  onBack?: () => void; onGoToFolder?: (p: string) => void;
} = {}) {
  root = createRoot(container);
  act(() => {
    root.render(createElement(ObjectDetailPane, {
      object: props.object ?? makeObject(),
      data: props.data ?? makeData(),
      onBack: props.onBack ?? (() => {}),
      onGoToFolder: props.onGoToFolder ?? (() => {}),
    }));
  });
}

describe("ObjectDetailPane：三源串接（spec §3.3）", () => {
  // 1) 串接主鍵：records 含 failed record（conversion_job_id:null）、jobs 含同 idempotency_key job（failure_reason:"boom"）
  //    → 詳情顯示 ledger chip「失敗」且失敗原因 "boom"（conversion_job_id 為 null 也串得上 = idempotency_key 主鍵）
  it("[1] idempotency_key 主鍵串接：conversion_job_id=null 仍串得上 job → chip「失敗」、失敗原因 boom", async () => {
    const data = makeData({
      records: [makeRecord({ status: "failed", conversion_job_id: null, object_key: "a/b/model.ifc" })],
      jobs: [makeJob({ idempotency_key: K, failure_reason: "boom", status: "dispatch_failed" })],
    });
    render({ object: makeObject({ idempotency_key: K }), data });
    await waitFor(() => {
      expect(container.querySelector('[data-testid="md-detail-chip"]')!.textContent).toContain("失敗");
      expect(container.querySelector('[data-testid="md-detail-failure"]')!.textContent).toContain("boom");
    });
  });

  // 2) ledger status=failed 但 jobs 查無同 idempotency_key → 失敗原因顯「未取得（job 已回收）」
  it("[2] ledger failed 但 job 已回收（jobs 查無）→ 失敗原因顯「未取得（job 已回收）」", async () => {
    const data = makeData({
      records: [makeRecord({ status: "failed", conversion_job_id: "cc_gone" })],
      jobs: [], // job 已回收
    });
    render({ object: makeObject({ idempotency_key: K }), data });
    await waitFor(() => {
      expect(container.querySelector('[data-testid="md-detail-chip"]')!.textContent).toContain("失敗");
      expect(container.querySelector('[data-testid="md-detail-failure"]')!.textContent).toContain("未取得（job 已回收）");
    });
  });

  // 3) record 查無且 recordsIncomplete=true → chip「狀態未明」；recordsIncomplete=false → 「未轉（無 ledger 紀錄）」
  it("[3a] record 查無 + recordsIncomplete=true → chip 顯「狀態未明」", async () => {
    const data = makeData({ records: [], recordsIncomplete: true });
    render({ object: makeObject({ idempotency_key: K }), data });
    await waitFor(() => {
      expect(container.querySelector('[data-testid="md-detail-chip"]')!.textContent).toContain("狀態未明");
    });
  });

  it("[3b] record 查無 + recordsIncomplete=false → chip 顯「未轉（無 ledger 紀錄）」", async () => {
    const data = makeData({ records: [], recordsIncomplete: false });
    render({ object: makeObject({ idempotency_key: K }), data });
    await waitFor(() => {
      expect(container.querySelector('[data-testid="md-detail-chip"]')!.textContent).toContain("未轉（無 ledger 紀錄）");
    });
  });

  // 4) chip ∈ {untracked, failed, indeterminate} → 「觸發轉檔」鈕 enabled；ready → disabled
  it("[4] 觸發轉檔鈕 gating：untracked/failed/indeterminate → enabled；ready → disabled", async () => {
    // failed（有 record）→ enabled
    render({ object: makeObject({ idempotency_key: K }), data: makeData({ records: [makeRecord({ status: "failed" })] }) });
    await waitFor(() => {
      const btn = container.querySelector('[data-testid="md-detail-trigger"]') as HTMLButtonElement;
      expect(btn).toBeTruthy();
      expect(btn.disabled).toBe(false);
    });
    await act(async () => { root.unmount(); });

    // untracked（無 record、records 完整）→ enabled
    container.innerHTML = "";
    render({ object: makeObject({ idempotency_key: K }), data: makeData({ records: [], recordsIncomplete: false }) });
    await waitFor(() => {
      expect((container.querySelector('[data-testid="md-detail-trigger"]') as HTMLButtonElement).disabled).toBe(false);
    });
    await act(async () => { root.unmount(); });

    // indeterminate（無 record、records 不完整）→ enabled
    container.innerHTML = "";
    render({ object: makeObject({ idempotency_key: K }), data: makeData({ records: [], recordsIncomplete: true }) });
    await waitFor(() => {
      expect((container.querySelector('[data-testid="md-detail-trigger"]') as HTMLButtonElement).disabled).toBe(false);
    });
    await act(async () => { root.unmount(); });

    // ready → disabled
    container.innerHTML = "";
    render({ object: makeObject({ idempotency_key: K }), data: makeData({ records: [makeRecord({ status: "ready", usdc_key: "a/b/model.usdc" })] }) });
    await waitFor(() => {
      expect((container.querySelector('[data-testid="md-detail-trigger"]') as HTMLButtonElement).disabled).toBe(true);
    });
  });

  // 5) job.review_session_id 存在 → 「SS →」「Review →」鈕存在且 buildHandoff target/source 正確（source="minio"）
  it("[5] job.review_session_id 存在 → SS →／Review → 鈕，且 A1 檢核 → 帶 minio_key、source 一律 minio", async () => {
    const data = makeData({
      records: [makeRecord({ status: "ready", usdc_key: "a/b/model.usdc", conversion_job_id: "conv_1" })],
      jobs: [makeJob({ idempotency_key: K, status: "dispatched", conversion_job_id: "conv_1", review_session_id: "sess_1" })],
    });
    render({ object: makeObject({ idempotency_key: K, key: "a/b/model.ifc" }), data });
    let ssBtn: HTMLButtonElement | null = null;
    let reviewBtn: HTMLButtonElement | null = null;
    let a1Btn: HTMLButtonElement | null = null;
    await waitFor(() => {
      ssBtn = container.querySelector('[data-testid="md-detail-ss"]');
      reviewBtn = container.querySelector('[data-testid="md-detail-review"]');
      a1Btn = container.querySelector('[data-testid="md-detail-a1"]');
      expect(ssBtn).toBeTruthy();
      expect(reviewBtn).toBeTruthy();
      expect(a1Btn).toBeTruthy();
    });
    // SS → target=sessions、source=minio、帶 session
    await act(async () => { ssBtn!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(window.location.hash.startsWith("#sessions?")).toBe(true);
    expect(window.location.hash).toContain("source=minio");
    expect(window.location.hash).toContain("session=sess_1");
    // Review → target=review、source=minio
    await act(async () => { reviewBtn!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(window.location.hash.startsWith("#review?")).toBe(true);
    expect(window.location.hash).toContain("source=minio");
    // A1 檢核 → target=a1、source=minio、帶 minio_key（= object.key）
    await act(async () => { a1Btn!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(window.location.hash.startsWith("#a1?")).toBe(true);
    expect(window.location.hash).toContain("source=minio");
    expect(decodeURIComponent(window.location.hash)).toContain("minio_key=a/b/model.ifc");
  });

  // 遷移自 MinioCrossLinks.test.tsx（OQ4 決定性 spike）：中文 minio_key 經 buildHandoff → URL hash →
  // parseHandoff 完整往返。M 頁物件列的 #a1 chip 已退役，改由單檔詳情 A1 檢核鈕（帶 object.key）承接。
  it("[5b] A1 檢核鈕：中文 minio_key 經 buildHandoff→hash→parseHandoff 完整往返（source 一律 minio）", async () => {
    const CN_KEY = "270專案/建築/v07/模型.ifc";
    render({ object: makeObject({ idempotency_key: K, key: CN_KEY }), data: makeData() });
    let a1Btn: HTMLButtonElement | null = null;
    await waitFor(() => { a1Btn = container.querySelector('[data-testid="md-detail-a1"]'); expect(a1Btn).toBeTruthy(); });
    await act(async () => { a1Btn!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    const parsed = parseHandoff(window.location.hash);
    expect(parsed?.source).toBe("minio");
    expect(parsed?.minio_key).toBe(CN_KEY);                          // encode → hash → decode 精準往返（含中文）
    expect(window.location.hash.startsWith("#a1?")).toBe(true);      // 目的地路由前綴（防 target 打錯字）
  });

  // 6) 顯示「顯示最新一次嘗試」註記文字（同檔多次轉檔，spec §3.3）
  it("[6] 顯示「顯示最新一次嘗試」註記（同檔多次轉檔，歷史見總覽）", async () => {
    render({ object: makeObject(), data: makeData({ records: [makeRecord({ status: "failed" })] }) });
    await waitFor(() => {
      const note = container.querySelector('[data-testid="md-detail-latest-note"]');
      expect(note).not.toBeNull();
      expect(note!.textContent).toContain("顯示最新一次嘗試");
    });
  });

  it("[7a] ledger coverage_report 存在 → usdc_key 下方顯示真實 coverage、status 與自我參照註記", async () => {
    render({
      object: makeObject(),
      data: makeData({
        records: [makeRecord({
          status: "ready",
          usdc_key: "a/b/model.usdc",
          coverage_report: {
            coverage_ratio: 1,
            coverage_status: "pass",
            mapped_count: 10,
            unmapped_count: 0,
            materialization_strategy: "usd_stage_enumeration",
          },
        })],
      }),
    });
    await waitFor(() => {
      const coverage = container.querySelector('[data-testid="md-ledger-coverage"]');
      expect(coverage).not.toBeNull();
      expect(coverage!.textContent).toContain("100%");
      expect(coverage!.textContent).toContain("pass");
      expect(coverage!.textContent).toContain("mapped 10 / unmapped 0");
      expect(coverage!.textContent).toContain("自我參照");
    });
  });

  it("[7b] ledger coverage_report 缺失 → coverage 欄位誠實顯示未取得", async () => {
    render({
      object: makeObject(),
      data: makeData({ records: [makeRecord({ status: "ready", usdc_key: "a/b/model.usdc", coverage_report: null })] }),
    });
    await waitFor(() => {
      const coverage = container.querySelector('[data-testid="md-ledger-coverage"]');
      expect(coverage).not.toBeNull();
      expect(coverage!.textContent).toContain("未取得");
    });
  });
});

describe("ObjectDetailPane：頂列捷徑（spec §3.1 定向）", () => {
  it("返回總覽鈕呼 onBack；回到檔案所在資料夾呼 onGoToFolder(該檔前綴)", async () => {
    const onBack = vi.fn();
    const onGoToFolder = vi.fn();
    render({ object: makeObject({ key: "松風庵/root/main/000001/model.ifc" }), data: makeData(), onBack, onGoToFolder });
    let backBtn: HTMLButtonElement | null = null;
    let folderBtn: HTMLButtonElement | null = null;
    await waitFor(() => {
      backBtn = container.querySelector('[data-testid="md-detail-back"]');
      folderBtn = container.querySelector('[data-testid="md-detail-gotofolder"]');
      expect(backBtn).toBeTruthy();
      expect(folderBtn).toBeTruthy();
    });
    await act(async () => { backBtn!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(onBack).toHaveBeenCalledTimes(1);
    await act(async () => { folderBtn!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(onGoToFolder).toHaveBeenCalledWith("松風庵/root/main/000001/");
  });
});

describe("ObjectDetailPane：動作經 useConversionActions（非重寫）", () => {
  it("觸發轉檔 → confirm → coordinatorClient.triggerConversion(object.key, {forceRetrigger:true}) 且 loadRecords 重抓", async () => {
    const trigSpy = vi.spyOn(coordinatorClient, "triggerConversion").mockResolvedValue({ ifc_ready_job_id: "ifcready_new", status: "queued_for_conversion" });
    const data = makeData({ records: [makeRecord({ status: "failed" })] });
    render({ object: makeObject({ key: "a/b/model.ifc", idempotency_key: K }), data });
    let trigBtn: HTMLButtonElement | null = null;
    await waitFor(() => { trigBtn = container.querySelector('[data-testid="md-detail-trigger"]'); expect(trigBtn).toBeTruthy(); });
    await act(async () => { trigBtn!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    let confirm: HTMLButtonElement | null = null;
    await waitFor(() => {
      const dialog = container.querySelector('[data-testid="intent-dialog"]');
      expect(dialog).not.toBeNull();
      expect(dialog!.textContent).toContain("確認觸發轉檔");
      expect(dialog!.textContent).toContain("a/b/model.ifc"); // cost 含 object.key
      confirm = container.querySelector('[data-testid="intent-confirm"]');
      expect(confirm).toBeTruthy();
    });
    await act(async () => { confirm!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    await waitFor(() => {
      expect(trigSpy).toHaveBeenCalledWith("a/b/model.ifc", { forceRetrigger: true });
      expect(data.loadRecords).toHaveBeenCalled();
      expect(container.querySelector('[data-testid="intent-dialog"]')).toBeNull(); // 成功關 dialog
    });
  });

  it("job.status=dispatch_failed → 重試鈕 → confirm → conversionRetry 被呼叫且 load 重抓", async () => {
    const retrySpy = vi.spyOn(coordinatorClient, "conversionRetry").mockResolvedValue({ ifc_ready_job_id: "ifcready_1", status: "queued_for_conversion", queue_position: 1 });
    const data = makeData({
      records: [makeRecord({ status: "failed" })],
      jobs: [makeJob({ idempotency_key: K, status: "dispatch_failed" })],
    });
    render({ object: makeObject({ idempotency_key: K }), data });
    let retryBtn: HTMLButtonElement | null = null;
    await waitFor(() => { retryBtn = container.querySelector('[data-testid="md-detail-retry"]'); expect(retryBtn).toBeTruthy(); });
    await act(async () => { retryBtn!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    let confirm: HTMLButtonElement | null = null;
    await waitFor(() => { confirm = container.querySelector('[data-testid="intent-confirm"]'); expect(confirm).toBeTruthy(); });
    await act(async () => { confirm!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    await waitFor(() => {
      expect(retrySpy).toHaveBeenCalledWith("ifcready_1", "");
      expect(data.load).toHaveBeenCalled();
    });
  });

  it("job.status=queued_for_conversion + queue_position>=2 → 插隊鈕（不 disabled）→ confirm → conversionPrioritize 被呼叫", async () => {
    const prioSpy = vi.spyOn(coordinatorClient, "conversionPrioritize").mockResolvedValue({ ifc_ready_job_id: "ifcready_1", status: "queued_for_conversion", queue_position: 1 });
    const data = makeData({
      records: [makeRecord({ status: "queued" })],
      jobs: [makeJob({ idempotency_key: K, status: "queued_for_conversion", queue_position: 2 })],
    });
    render({ object: makeObject({ idempotency_key: K }), data });
    let prioBtn: HTMLButtonElement | null = null;
    await waitFor(() => { prioBtn = container.querySelector('[data-testid="md-detail-prioritize"]'); expect(prioBtn).toBeTruthy(); });
    expect(prioBtn!.disabled).toBe(false);
    await act(async () => { prioBtn!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    let confirm: HTMLButtonElement | null = null;
    await waitFor(() => { confirm = container.querySelector('[data-testid="intent-confirm"]'); expect(confirm).toBeTruthy(); });
    await act(async () => { confirm!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    await waitFor(() => {
      expect(prioSpy).toHaveBeenCalledWith("ifcready_1", "");
    });
  });
});

describe("ObjectDetailPane：coverage 展開（本地 state，搬自 CV toggleCoverage）", () => {
  it("job 有 conversion_job_id → coverage 展開鈕 → 呼 conversionQualityMetrics、顯覆蓋率＋IN 品質誠實三行", async () => {
    const covSpy = vi.spyOn(coordinatorClient, "conversionQualityMetrics").mockResolvedValue({
      conversion_job_id: "conv_1",
      quality_metrics_summary: {
        coverage_ratio: 0.9886, coverage_status: "warn", mapped_count: 988, unmapped_count: 12,
        source_ifc_entity_count: 1000, materialization_strategy: "sidecar", conversion_duration_seconds: 73.5,
      },
      usdc_url: "http://x/model.usdc", mapping_url: "http://x/element_mapping.json",
    });
    const data = makeData({
      records: [makeRecord({ status: "ready", conversion_job_id: "conv_1" })],
      jobs: [makeJob({ idempotency_key: K, status: "dispatched", conversion_job_id: "conv_1" })],
    });
    render({ object: makeObject({ idempotency_key: K }), data });
    // IN 品質誠實三行恆在（coverage 區）
    await waitFor(() => {
      expect(container.textContent).toContain("pass-through artifact");
      expect(container.textContent).toContain("不承諾精準 GUID");
      expect(container.textContent).toContain("無統一遙測來源");
    });
    let toggle: HTMLElement | null = null;
    await waitFor(() => { toggle = container.querySelector('[data-testid="md-detail-coverage-toggle"]'); expect(toggle).not.toBeNull(); });
    await act(async () => { toggle!.click(); });
    await waitFor(() => {
      expect(covSpy).toHaveBeenCalledWith("conv_1");
      const drawer = container.querySelector('[data-testid="md-detail-coverage"]')!;
      expect(drawer.textContent).toContain("98.86");
      expect(drawer.textContent).toContain("988");
    });
  });

  // brief §Step 1 補課（Task 5 review）：coverage 快取三語意（搬自 CV toggleCoverage 原文，含去重／載入鎖／可重試）。
  const covData = () => makeData({
    records: [makeRecord({ status: "ready", conversion_job_id: "conv_1" })],
    jobs: [makeJob({ idempotency_key: K, status: "dispatched", conversion_job_id: "conv_1" })],
  });
  const okMetrics = {
    conversion_job_id: "conv_1",
    quality_metrics_summary: {
      coverage_ratio: 0.9886, coverage_status: "warn", mapped_count: 988, unmapped_count: 12,
      source_ifc_entity_count: 1000, materialization_strategy: "sidecar", conversion_duration_seconds: 73.5,
    },
    usdc_url: "http://x/model.usdc", mapping_url: "http://x/element_mapping.json",
  } as const;

  it("[快取1] 成功展開後收合再展開 → 重用快取，不再呼 conversionQualityMetrics", async () => {
    const spy = vi.spyOn(coordinatorClient, "conversionQualityMetrics").mockResolvedValue(okMetrics);
    render({ object: makeObject({ idempotency_key: K }), data: covData() });
    let toggle: HTMLElement | null = null;
    await waitFor(() => { toggle = container.querySelector('[data-testid="md-detail-coverage-toggle"]'); expect(toggle).not.toBeNull(); });
    await act(async () => { toggle!.click(); });                       // 展開 → fetch 一次
    await waitFor(() => { expect(spy).toHaveBeenCalledTimes(1); });
    await act(async () => { toggle!.click(); });                       // 收合
    await act(async () => { toggle!.click(); });                       // 再展開 → 命中快取
    await waitFor(() => {
      expect(spy).toHaveBeenCalledTimes(1);                            // 不重打
      expect(container.querySelector('[data-testid="md-detail-coverage"]')!.textContent).toContain("98.86");
    });
  });

  it("[快取2] 載入中收合再展開 → 載入鎖擋下第二次 conversionQualityMetrics", async () => {
    let resolveCov: (v: typeof okMetrics) => void = () => {};
    const spy = vi.spyOn(coordinatorClient, "conversionQualityMetrics")
      .mockImplementation(() => new Promise((res) => { resolveCov = res as (v: typeof okMetrics) => void; }));
    render({ object: makeObject({ idempotency_key: K }), data: covData() });
    let toggle: HTMLElement | null = null;
    await waitFor(() => { toggle = container.querySelector('[data-testid="md-detail-coverage-toggle"]'); expect(toggle).not.toBeNull(); });
    await act(async () => { toggle!.click(); });                       // 展開 → fetch 啟動（pending，cov="loading"）
    await waitFor(() => { expect(spy).toHaveBeenCalledTimes(1); });
    await act(async () => { toggle!.click(); });                       // 收合（cov 仍停在 "loading"）
    await act(async () => { toggle!.click(); });                       // 載入中再展開 → 載入鎖擋下第二打
    expect(spy).toHaveBeenCalledTimes(1);
    // 放行 pending promise，避免 act 後殘留未 settle
    await act(async () => { resolveCov(okMetrics); await Promise.resolve(); });
  });

  it("[快取3] 展開遇錯誤後收合再展開 → 重新呼 conversionQualityMetrics（error 態可重試）", async () => {
    const spy = vi.spyOn(coordinatorClient, "conversionQualityMetrics")
      .mockRejectedValueOnce(new Error("/api/conversions/... -> 502"))
      .mockResolvedValue(okMetrics);
    render({ object: makeObject({ idempotency_key: K }), data: covData() });
    let toggle: HTMLElement | null = null;
    await waitFor(() => { toggle = container.querySelector('[data-testid="md-detail-coverage-toggle"]'); expect(toggle).not.toBeNull(); });
    await act(async () => { toggle!.click(); });                       // 展開 → reject（error 態，不入快取）
    await waitFor(() => {
      expect(spy).toHaveBeenCalledTimes(1);
      expect(container.querySelector('[data-testid="md-detail-coverage"]')!.textContent).toContain("/api/conversions");
    });
    await act(async () => { toggle!.click(); });                       // 收合
    await act(async () => { toggle!.click(); });                       // 再展開 → error 態可重試，重打
    await waitFor(() => {
      expect(spy).toHaveBeenCalledTimes(2);
      expect(container.querySelector('[data-testid="md-detail-coverage"]')!.textContent).toContain("98.86");
    });
  });
});
