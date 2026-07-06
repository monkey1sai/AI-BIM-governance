// web-viewer-sample/src/console/modelData/GlobalConversionPane.test.tsx
// MD 三頁合一 Task 4：右欄全域轉檔視圖 GlobalConversionPane（純呈現＋dialog 驅動）。
// 遷移 ConversionSchedulingPage.test.tsx 的 watcher / 佇列 / 插隊 / 重試 / coverage 核心斷言到本元件，
// 外加 brief §Step 1 的五條新斷言（摘要卡統計＋口徑、回傳窗截斷、download/authority 兩欄、檔案定位／
// 非 MinIO 來源、Pipeline details NOT BUILT 揭露）。
//
// 掛載策略：本元件不自抓資料（吃 props.data: ConversionData）。測試掛一層 Harness 用「真 useConversionData
// hook」餵給 pane——如此 mount 的 load()/loadRecords()、動作後的證據型重抓，皆走真實資料流，vi.spyOn
// coordinatorClient 的行為與原 CV 測試逐字一致，驗的是真行為（非構造死資料）。斷言一律 waitFor 輪詢
// （禁同步斷言，flaky 前科：minio-watcher-loop）。
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GlobalConversionPane } from "./GlobalConversionPane";
import { useConversionData } from "./useConversionData";
import { coordinatorClient, type ConversionRecord, type IfcReadyListItem } from "../coordinatorClient";

const actEnvKey = "IS_REACT_ACT_ENVIRONMENT" as const;

// waitFor：輪詢直到斷言成立（同 MinioTreePane.test.tsx / useConversionData.test.ts pattern）。
async function waitFor(assert: () => void, maxTicks = 40): Promise<void> {
  let lastErr: unknown;
  for (let i = 0; i < maxTicks; i++) {
    await act(async () => { await Promise.resolve(); });
    try { assert(); return; } catch (e) { lastErr = e; }
  }
  throw lastErr;
}

// harness：真 useConversionData hook → GlobalConversionPane（受控純呈現）。onLocateObject/highlightJobId 注入。
function Harness(props: { onLocateObject?: (k: string) => void; highlightJobId?: string | null }) {
  const data = useConversionData();
  return createElement(GlobalConversionPane, {
    data,
    onLocateObject: props.onLocateObject ?? (() => {}),
    highlightJobId: props.highlightJobId ?? null,
  });
}

// 預設 stub：mount 的四端點都要 mock，避免真 fetch。個別 test 於呼叫後可對特定端點覆寫 Once 序列。
function stubHistoryEmpty() {
  vi.spyOn(coordinatorClient, "getConversionsHistory").mockResolvedValue({ items: [] });
}

const baseJob = {
  project_id: "271", download_status: "downloaded", conversion_authority: null,
  review_session_id: null, viewer_url: null, expected_stage_url: null,
  expected_mapping_url: null, created_at: "2026-06-11T00:00:00Z",
  conversion_job_id: null, queue_position: null, updated_at: "2026-06-11T00:00:00Z",
} as const;

const okJob: IfcReadyListItem = {
  ...baseJob, ifc_ready_job_id: "ifcready_ok", external_model_version_id: "ext_ok",
  status: "dispatched", conversion_status: "dispatched", dispatch_error: null,
};

const failedJob: IfcReadyListItem = {
  ifc_ready_job_id: "ifcready_failed", status: "dispatch_failed", project_id: "271",
  external_model_version_id: "ext_f", download_status: "downloaded", conversion_status: "dispatch_failed",
  conversion_authority: null, conversion_job_id: null, dispatch_error: "stub failure",
  queue_position: null, review_session_id: null, viewer_url: null,
  expected_stage_url: null, expected_mapping_url: null, created_at: "2026-06-16T00:00:00Z",
  updated_at: "2026-06-16T00:00:00Z",
};

const queuedJob: IfcReadyListItem = {
  ifc_ready_job_id: "ifcready_queued", status: "queued_for_conversion", project_id: "271",
  external_model_version_id: "ext_q", download_status: "downloaded", conversion_status: "queued_for_conversion",
  conversion_authority: null, conversion_job_id: null, dispatch_error: null,
  queue_position: 2, review_session_id: null, viewer_url: null,
  expected_stage_url: null, expected_mapping_url: null, created_at: "2026-06-16T00:00:00Z",
  updated_at: "2026-06-16T00:00:00Z",
};

const coverageJob: IfcReadyListItem = {
  project_id: "270", download_status: "downloaded", conversion_authority: "bim-streaming-server",
  review_session_id: null, viewer_url: null, expected_stage_url: null, expected_mapping_url: null,
  created_at: "2026-06-16T00:00:00Z", ifc_ready_job_id: "ifcready_cov", external_model_version_id: "ext_cov",
  status: "dispatched", conversion_status: "succeeded", dispatch_error: null,
  conversion_job_id: "stream_conv_20260616_cov", queue_position: null, updated_at: "2026-06-16T00:00:00Z",
};

const failedRec: ConversionRecord = {
  idempotency_key: "mw_failed0123456789", project_id: "mv_failed01", project_display_name: "東勢區許良宇紀念圖書館",
  category: "建築", external_model_version_id: "000003", conversion_job_id: "ifcready_failed_cc",
  status: "failed", usdc_key: null, coverage_report: null,
  object_key: "東勢區許良宇紀念圖書館/root/main/000003/model.ifc",
  detected_at: "2026-06-23T02:00:00.000Z", updated_at: "2026-06-23T02:05:00.000Z",
};

let container: HTMLDivElement;
let root: Root;
let prevActEnv: unknown;

beforeEach(() => {
  prevActEnv = (globalThis as Record<string, unknown>)[actEnvKey];
  (globalThis as Record<string, unknown>)[actEnvKey] = true;
  container = document.createElement("div");
  document.body.appendChild(container);
});
afterEach(async () => {
  await act(async () => { root?.unmount(); });
  document.body.removeChild(container);
  vi.restoreAllMocks();
  (globalThis as Record<string, unknown>)[actEnvKey] = prevActEnv;
});

function render(props: { onLocateObject?: (k: string) => void; highlightJobId?: string | null } = {}) {
  root = createRoot(container);
  act(() => { root.render(createElement(Harness, props)); });
}

describe("GlobalConversionPane：初始渲染 + 只打 coordinator", () => {
  it("含 watcher 面板與穩定選取子、揭露真實狀態端點、不直連內部埠", async () => {
    vi.spyOn(coordinatorClient, "listIfcReady").mockResolvedValue({ count: 0, items: [] });
    vi.spyOn(coordinatorClient, "minioWatchStatus").mockResolvedValue({ enabled: false });
    vi.spyOn(coordinatorClient, "getConversionRecords").mockResolvedValue({ count: 0, items: [] });
    stubHistoryEmpty();
    render();
    await waitFor(() => {
      expect(container.querySelector('[data-testid="minio-watch-panel"]')).not.toBeNull();
      expect(container.textContent).toContain("/api/external/minio-watch/status");
      // 前端不直連內部埠（誠實邊界）。
      expect(container.textContent).not.toContain(":49101");
      expect(container.textContent).not.toContain(":9000");
    });
  });
});

describe("GlobalConversionPane：watcher 錯誤獨立 + 診斷欄位（§3.2A）", () => {
  it("minioWatchStatus reject 時：jobs 仍渲染，watcher 顯獨立錯誤而非 placeholder，且不誤標成 ifc-ready", async () => {
    vi.spyOn(coordinatorClient, "listIfcReady").mockResolvedValue({ count: 1, items: [okJob] });
    vi.spyOn(coordinatorClient, "minioWatchStatus").mockRejectedValue(new Error("coordinator /api/external/minio-watch/status -> 404 Not Found"));
    vi.spyOn(coordinatorClient, "getConversionRecords").mockResolvedValue({ count: 0, items: [] });
    stubHistoryEmpty();
    render();
    await waitFor(() => {
      expect(container.textContent).toContain("ifcready_ok");
      const mwErrNode = container.querySelector('[data-testid="minio-watch-error"]');
      expect(mwErrNode).not.toBeNull();
      expect(mwErrNode!.textContent).toContain("/api/external/minio-watch/status");
      expect(mwErrNode!.textContent).not.toContain("/api/external/ifc-ready");
      const panel = container.querySelector('[data-testid="minio-watch-panel"]');
      expect(panel!.textContent).not.toContain("按上方 Refresh queue 後顯示");
    });
  });

  it("enabled=true：渲染計數、triggered table、baseline/一致性/補救診斷（診斷移入展開細節）", async () => {
    vi.spyOn(coordinatorClient, "listIfcReady").mockResolvedValue({ count: 1, items: [okJob] });
    vi.spyOn(coordinatorClient, "minioWatchStatus").mockResolvedValue({
      enabled: true, bucket: "bim-control", prefix: "", last_poll_at: "2026-06-12T06:00:00Z",
      poll_count: 3, baseline_count: 10, seen_count: 11, triggered_total: 1, skipped_malformed_total: 0,
      last_triggered: [{ key: "bim-control/271/v1/model.ifc", job_id: "ifcready_mw1", error: null, at: "2026-06-12T06:00:00Z" }],
    });
    vi.spyOn(coordinatorClient, "getConversionRecords").mockResolvedValue({ count: 0, items: [] });
    stubHistoryEmpty();
    render();
    await waitFor(() => {
      // 摘要卡 watcher 狀態切啟用
      expect(container.querySelector('[data-testid="minio-watch-panel"]')!.textContent).toContain("啟用中");
      // 診斷（展開細節內，仍在 DOM）
      expect(container.querySelector('[data-testid="conv-baseline-count"]')!.textContent).toContain("10");
      expect(container.querySelector('[data-testid="conv-triggered-total"]')!.textContent).toContain("1");
      const diag = container.querySelector('[data-testid="md-watch-diagnostics"]')!;
      expect(diag.textContent).toContain("bim-control");
      expect(diag.textContent).toContain("11 / 0"); // seen / skipped
      expect(diag.textContent).toContain("輪詢次數");
      expect(diag.textContent).toContain("3");
      // 一致性基準 + 補救文案（§3.4 auto-enroll，反鎖過時假文案）
      const explain = container.querySelector('[data-testid="conv-baseline-explain"]')!;
      expect(explain.textContent).toContain("自動觸發");
      expect(explain.textContent).toContain("純診斷");
      expect(explain.textContent).not.toContain("不自動轉檔");
      expect(container.querySelector('[data-testid="conv-consistency-basis"]')!.textContent).toContain("可解析 IFC");
      expect(container.querySelector('[data-testid="conv-remediation-note"]')!.textContent).toContain("etag");
      const triggered = container.querySelector('[data-testid="minio-watch-triggered"]');
      expect(triggered!.textContent).toContain("ifcready_mw1");
    });
  });

  it("enabled=true 但僅帶 note（watcher 尚未啟動）：note 穿透顯示於 watcher 面板", async () => {
    vi.spyOn(coordinatorClient, "listIfcReady").mockResolvedValue({ count: 0, items: [] });
    vi.spyOn(coordinatorClient, "minioWatchStatus").mockResolvedValue({
      enabled: true, note: "watcher enabled but not yet started (server not listening)",
    });
    vi.spyOn(coordinatorClient, "getConversionRecords").mockResolvedValue({ count: 0, items: [] });
    stubHistoryEmpty();
    render();
    await waitFor(() => {
      const panel = container.querySelector('[data-testid="minio-watch-panel"]')!;
      expect(panel.textContent).toContain("啟用中");
      expect(panel.textContent).toContain("watcher enabled but not yet started");
    });
  });
});

describe("GlobalConversionPane coverage 展開（純呈現）", () => {
  it("展開有 conversion_job_id 的 job → 呼 conversionQualityMetrics、顯 coverage%(×100)+mapped/unmapped+耗時", async () => {
    vi.spyOn(coordinatorClient, "listIfcReady").mockResolvedValue({ count: 1, items: [coverageJob] });
    vi.spyOn(coordinatorClient, "minioWatchStatus").mockResolvedValue({ enabled: false });
    vi.spyOn(coordinatorClient, "getConversionRecords").mockResolvedValue({ count: 0, items: [] });
    stubHistoryEmpty();
    const spy = vi.spyOn(coordinatorClient, "conversionQualityMetrics").mockResolvedValue({
      conversion_job_id: "stream_conv_20260616_cov",
      quality_metrics_summary: {
        coverage_ratio: 0.9886, coverage_status: "warn", mapped_count: 988, unmapped_count: 12,
        source_ifc_entity_count: 1000, materialization_strategy: "sidecar", conversion_duration_seconds: 73.5,
      },
      usdc_url: "http://x/model.usdc", mapping_url: "http://x/element_mapping.json",
    });
    render();
    let toggle: HTMLElement | null = null;
    await waitFor(() => { toggle = container.querySelector('[data-testid="conv-coverage-toggle-ifcready_cov"]'); expect(toggle).not.toBeNull(); });
    await act(async () => { toggle!.click(); });
    await waitFor(() => {
      expect(spy).toHaveBeenCalledWith("stream_conv_20260616_cov");
      const drawer = container.querySelector('[data-testid="conv-coverage-ifcready_cov"]')!;
      expect(drawer.textContent).toContain("98.86");
      expect(drawer.textContent).toContain("988");
      expect(drawer.textContent).toContain("12");
      expect(drawer.textContent).toContain("73.5");
      expect(container.querySelector('[data-testid="conv-coverage-selfref-note"]')).toBeNull();
    });
  });

  it("materialization=usd_stage_enumeration → 顯自我參照誠實 caveat", async () => {
    vi.spyOn(coordinatorClient, "listIfcReady").mockResolvedValue({ count: 1, items: [coverageJob] });
    vi.spyOn(coordinatorClient, "minioWatchStatus").mockResolvedValue({ enabled: false });
    vi.spyOn(coordinatorClient, "getConversionRecords").mockResolvedValue({ count: 0, items: [] });
    stubHistoryEmpty();
    vi.spyOn(coordinatorClient, "conversionQualityMetrics").mockResolvedValue({
      conversion_job_id: "stream_conv_20260616_cov",
      quality_metrics_summary: {
        coverage_ratio: 1, coverage_status: "pass", mapped_count: 543, unmapped_count: 0,
        source_ifc_entity_count: 543, materialization_strategy: "usd_stage_enumeration", conversion_duration_seconds: null,
      },
      usdc_url: "http://x/model.usdc", mapping_url: "http://x/element_mapping.json",
    });
    render();
    let toggle: HTMLElement | null = null;
    await waitFor(() => { toggle = container.querySelector('[data-testid="conv-coverage-toggle-ifcready_cov"]'); expect(toggle).not.toBeNull(); });
    await act(async () => { toggle!.click(); });
    await waitFor(() => {
      const drawer = container.querySelector('[data-testid="conv-coverage-ifcready_cov"]')!;
      expect(drawer.textContent).toContain("100.00");
      const note = container.querySelector('[data-testid="conv-coverage-selfref-note"]');
      expect(note).not.toBeNull();
      expect(note!.textContent).toContain("自我比對");
      expect(drawer.textContent).toContain("USD 枚舉 prim 數");
    });
  });

  it("展開遇 route 錯誤 → 顯誠實錯誤、不顯任何 coverage 數字", async () => {
    vi.spyOn(coordinatorClient, "listIfcReady").mockResolvedValue({ count: 1, items: [coverageJob] });
    vi.spyOn(coordinatorClient, "minioWatchStatus").mockResolvedValue({ enabled: false });
    vi.spyOn(coordinatorClient, "getConversionRecords").mockResolvedValue({ count: 0, items: [] });
    stubHistoryEmpty();
    vi.spyOn(coordinatorClient, "conversionQualityMetrics").mockRejectedValue(new Error("/api/conversions/... -> 502"));
    render();
    let toggle: HTMLElement | null = null;
    await waitFor(() => { toggle = container.querySelector('[data-testid="conv-coverage-toggle-ifcready_cov"]'); expect(toggle).not.toBeNull(); });
    await act(async () => { toggle!.click(); });
    await waitFor(() => {
      const drawer = container.querySelector('[data-testid="conv-coverage-ifcready_cov"]')!;
      expect(drawer.textContent).toContain("/api/conversions");
      expect(drawer.textContent).not.toMatch(/\d+\.\d+\s*%/);
    });
  });

  it("成功展開後收合再展開同一 job → 重用快取，不再呼 conversionQualityMetrics", async () => {
    vi.spyOn(coordinatorClient, "listIfcReady").mockResolvedValue({ count: 1, items: [coverageJob] });
    vi.spyOn(coordinatorClient, "minioWatchStatus").mockResolvedValue({ enabled: false });
    vi.spyOn(coordinatorClient, "getConversionRecords").mockResolvedValue({ count: 0, items: [] });
    stubHistoryEmpty();
    const spy = vi.spyOn(coordinatorClient, "conversionQualityMetrics").mockResolvedValue({
      conversion_job_id: "stream_conv_20260616_cov",
      quality_metrics_summary: {
        coverage_ratio: 0.9886, coverage_status: "warn", mapped_count: 988, unmapped_count: 12,
        source_ifc_entity_count: 1000, materialization_strategy: "sidecar", conversion_duration_seconds: 73.5,
      },
      usdc_url: "http://x/model.usdc", mapping_url: "http://x/element_mapping.json",
    });
    render();
    let toggle: HTMLElement | null = null;
    await waitFor(() => { toggle = container.querySelector('[data-testid="conv-coverage-toggle-ifcready_cov"]'); expect(toggle).not.toBeNull(); });
    await act(async () => { toggle!.click(); });                       // 展開 → fetch 一次
    await waitFor(() => { expect(spy).toHaveBeenCalledTimes(1); });
    await act(async () => { toggle!.click(); });                       // 收合
    await act(async () => { toggle!.click(); });                       // 再展開 → 命中快取
    await waitFor(() => {
      expect(spy).toHaveBeenCalledTimes(1);
      expect(container.querySelector('[data-testid="conv-coverage-ifcready_cov"]')!.textContent).toContain("98.86");
    });
  });

  // brief §Step 1 補課（Task 4 review）：展開遇錯誤後收合再展開 → 重新呼叫 conversionQualityMetrics（error 態可重試）。
  // 對照上方「重用快取」測試（成功後不重打）：error 態不入快取（cov[id] 帶 error 鍵）→ 收合重展必重打。
  it("展開遇錯誤後收合再展開同一 job → 重新呼 conversionQualityMetrics（error 態可重試，非快取）", async () => {
    vi.spyOn(coordinatorClient, "listIfcReady").mockResolvedValue({ count: 1, items: [coverageJob] });
    vi.spyOn(coordinatorClient, "minioWatchStatus").mockResolvedValue({ enabled: false });
    vi.spyOn(coordinatorClient, "getConversionRecords").mockResolvedValue({ count: 0, items: [] });
    stubHistoryEmpty();
    const spy = vi.spyOn(coordinatorClient, "conversionQualityMetrics")
      .mockRejectedValueOnce(new Error("/api/conversions/... -> 502"))
      .mockResolvedValue({
        conversion_job_id: "stream_conv_20260616_cov",
        quality_metrics_summary: {
          coverage_ratio: 0.9886, coverage_status: "warn", mapped_count: 988, unmapped_count: 12,
          source_ifc_entity_count: 1000, materialization_strategy: "sidecar", conversion_duration_seconds: 73.5,
        },
        usdc_url: "http://x/model.usdc", mapping_url: "http://x/element_mapping.json",
      });
    render();
    let toggle: HTMLElement | null = null;
    await waitFor(() => { toggle = container.querySelector('[data-testid="conv-coverage-toggle-ifcready_cov"]'); expect(toggle).not.toBeNull(); });
    await act(async () => { toggle!.click(); });                       // 展開 → fetch 一次（reject → error 態）
    await waitFor(() => {
      expect(spy).toHaveBeenCalledTimes(1);
      expect(container.querySelector('[data-testid="conv-coverage-ifcready_cov"]')!.textContent).toContain("/api/conversions");
    });
    await act(async () => { toggle!.click(); });                       // 收合
    await act(async () => { toggle!.click(); });                       // 再展開 → error 態不重用，重打
    await waitFor(() => {
      expect(spy).toHaveBeenCalledTimes(2);                            // 重試：第二次真的重打
      expect(container.querySelector('[data-testid="conv-coverage-ifcready_cov"]')!.textContent).toContain("98.86");
    });
  });

  it("無 conversion_job_id 的 job → 不可展開、顯尚未派工", async () => {
    const noConv: IfcReadyListItem = { ...coverageJob, ifc_ready_job_id: "ifcready_noconv", conversion_job_id: null, conversion_status: "pending" };
    vi.spyOn(coordinatorClient, "listIfcReady").mockResolvedValue({ count: 1, items: [noConv] });
    vi.spyOn(coordinatorClient, "minioWatchStatus").mockResolvedValue({ enabled: false });
    vi.spyOn(coordinatorClient, "getConversionRecords").mockResolvedValue({ count: 0, items: [] });
    stubHistoryEmpty();
    render();
    await waitFor(() => {
      expect(container.querySelector('[data-testid="conv-coverage-toggle-ifcready_noconv"]')).toBeNull();
      expect(container.textContent).toContain("尚未派工");
    });
  });
});

describe("GlobalConversionPane 控制動作（插隊／重試）", () => {
  it("dispatch_failed job 顯重試鈕 → 確認 → conversionRetry 被呼叫且 load 重抓", async () => {
    const listSpy = vi.spyOn(coordinatorClient, "listIfcReady").mockResolvedValue({ count: 1, items: [failedJob] });
    vi.spyOn(coordinatorClient, "minioWatchStatus").mockResolvedValue({ enabled: false });
    vi.spyOn(coordinatorClient, "getConversionRecords").mockResolvedValue({ count: 0, items: [] });
    stubHistoryEmpty();
    const retrySpy = vi.spyOn(coordinatorClient, "conversionRetry").mockResolvedValue({ ifc_ready_job_id: "ifcready_failed", status: "queued_for_conversion", queue_position: 1 });
    render();
    let retryBtn: HTMLButtonElement | null = null;
    await waitFor(() => { retryBtn = container.querySelector('[data-testid="conv-retry-ifcready_failed"]'); expect(retryBtn).toBeTruthy(); });
    await act(async () => { retryBtn!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    let confirm: HTMLButtonElement | null = null;
    await waitFor(() => { confirm = container.querySelector('[data-testid="intent-confirm"]'); expect(confirm).toBeTruthy(); });
    await act(async () => { confirm!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    await waitFor(() => {
      expect(retrySpy).toHaveBeenCalledWith("ifcready_failed", "");
      expect(listSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
  });

  it("queued_for_conversion + queue_position>=2 顯插隊鈕（不 disabled）→ 確認 → conversionPrioritize 被呼叫且成功關 dialog", async () => {
    const listSpy = vi.spyOn(coordinatorClient, "listIfcReady").mockResolvedValue({ count: 1, items: [queuedJob] });
    vi.spyOn(coordinatorClient, "minioWatchStatus").mockResolvedValue({ enabled: false });
    vi.spyOn(coordinatorClient, "getConversionRecords").mockResolvedValue({ count: 0, items: [] });
    stubHistoryEmpty();
    const prioritizeSpy = vi.spyOn(coordinatorClient, "conversionPrioritize").mockResolvedValue({ ifc_ready_job_id: "ifcready_queued", status: "queued_for_conversion", queue_position: 1 });
    render();
    let prioBtn: HTMLButtonElement | null = null;
    await waitFor(() => { prioBtn = container.querySelector('[data-testid="conv-prioritize-ifcready_queued"]'); expect(prioBtn).toBeTruthy(); });
    expect(prioBtn!.disabled).toBe(false);
    await act(async () => { prioBtn!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    let confirm: HTMLButtonElement | null = null;
    await waitFor(() => { confirm = container.querySelector('[data-testid="intent-confirm"]'); expect(confirm).toBeTruthy(); });
    await act(async () => { confirm!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    await waitFor(() => {
      expect(prioritizeSpy).toHaveBeenCalledWith("ifcready_queued", "");
      expect(listSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
      expect(container.querySelector('[data-testid="intent-dialog"]')).toBeNull();
    });
  });

  it("queue_position=1（已隊首）→ 插隊鈕 disabled 且 title 說明已在隊首", async () => {
    const headJob: IfcReadyListItem = { ...queuedJob, ifc_ready_job_id: "ifcready_head", queue_position: 1 };
    vi.spyOn(coordinatorClient, "listIfcReady").mockResolvedValue({ count: 1, items: [headJob] });
    vi.spyOn(coordinatorClient, "minioWatchStatus").mockResolvedValue({ enabled: false });
    vi.spyOn(coordinatorClient, "getConversionRecords").mockResolvedValue({ count: 0, items: [] });
    stubHistoryEmpty();
    render();
    await waitFor(() => {
      const prioBtn = container.querySelector('[data-testid="conv-prioritize-ifcready_head"]') as HTMLButtonElement;
      expect(prioBtn).toBeTruthy();
      expect(prioBtn.disabled).toBe(true);
      expect(prioBtn.title).toContain("隊首");
    });
  });

  it("POST 失敗（conversionRetry reject）→ dialog 維持開啟、顯誠實錯誤、不靜默關閉", async () => {
    vi.spyOn(coordinatorClient, "listIfcReady").mockResolvedValue({ count: 1, items: [failedJob] });
    vi.spyOn(coordinatorClient, "minioWatchStatus").mockResolvedValue({ enabled: false });
    vi.spyOn(coordinatorClient, "getConversionRecords").mockResolvedValue({ count: 0, items: [] });
    stubHistoryEmpty();
    vi.spyOn(coordinatorClient, "conversionRetry").mockRejectedValue(new Error("/api/conversion/jobs/ifcready_failed/retry -> 422"));
    render();
    let retryBtn: HTMLButtonElement | null = null;
    await waitFor(() => { retryBtn = container.querySelector('[data-testid="conv-retry-ifcready_failed"]'); expect(retryBtn).toBeTruthy(); });
    await act(async () => { retryBtn!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    let confirm: HTMLButtonElement | null = null;
    await waitFor(() => { confirm = container.querySelector('[data-testid="intent-confirm"]'); expect(confirm).toBeTruthy(); });
    await act(async () => { confirm!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    await waitFor(() => {
      expect(container.querySelector('[data-testid="intent-dialog"]')).not.toBeNull();
      const actionErrNode = container.querySelector('[data-testid="intent-action-error"]');
      expect(actionErrNode).not.toBeNull();
      expect(actionErrNode!.textContent).toContain("控制動作失敗");
    });
  });

  it("POST 成功但成功後重抓佇列失敗（listIfcReady 第二次 reject）→ dialog 維持開啟、顯重抓失敗誠實錯誤", async () => {
    vi.spyOn(coordinatorClient, "listIfcReady")
      .mockResolvedValueOnce({ count: 1, items: [failedJob] })
      .mockRejectedValue(new Error("coordinator /api/external/ifc-ready -> 503"));
    vi.spyOn(coordinatorClient, "minioWatchStatus").mockResolvedValue({ enabled: false });
    vi.spyOn(coordinatorClient, "getConversionRecords").mockResolvedValue({ count: 0, items: [] });
    stubHistoryEmpty();
    const retrySpy = vi.spyOn(coordinatorClient, "conversionRetry").mockResolvedValue({ ifc_ready_job_id: "ifcready_failed", status: "queued_for_conversion", queue_position: 1 });
    render();
    let retryBtn: HTMLButtonElement | null = null;
    await waitFor(() => { retryBtn = container.querySelector('[data-testid="conv-retry-ifcready_failed"]'); expect(retryBtn).toBeTruthy(); });
    await act(async () => { retryBtn!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    let confirm: HTMLButtonElement | null = null;
    await waitFor(() => { confirm = container.querySelector('[data-testid="intent-confirm"]'); expect(confirm).toBeTruthy(); });
    await act(async () => { confirm!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    await waitFor(() => {
      expect(retrySpy).toHaveBeenCalledWith("ifcready_failed", "");
      expect(container.querySelector('[data-testid="intent-dialog"]')).not.toBeNull();
      expect(container.textContent).toContain("重新抓取佇列失敗");
    });
  });

  it("同一事件循環連點兩次確認 → 只送出一個 POST（同步 busy guard）", async () => {
    vi.spyOn(coordinatorClient, "listIfcReady").mockResolvedValue({ count: 1, items: [queuedJob] });
    vi.spyOn(coordinatorClient, "minioWatchStatus").mockResolvedValue({ enabled: false });
    vi.spyOn(coordinatorClient, "getConversionRecords").mockResolvedValue({ count: 0, items: [] });
    stubHistoryEmpty();
    let resolvePost: (v: unknown) => void = () => {};
    const prioritizeSpy = vi.spyOn(coordinatorClient, "conversionPrioritize")
      .mockImplementation(() => new Promise((res) => { resolvePost = res as (v: unknown) => void; }));
    render();
    let prioBtn: HTMLButtonElement | null = null;
    await waitFor(() => { prioBtn = container.querySelector('[data-testid="conv-prioritize-ifcready_queued"]'); expect(prioBtn).toBeTruthy(); });
    await act(async () => { prioBtn!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    let confirm: HTMLButtonElement | null = null;
    await waitFor(() => { confirm = container.querySelector('[data-testid="intent-confirm"]'); expect(confirm).toBeTruthy(); });
    await act(async () => {
      confirm!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      confirm!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(prioritizeSpy).toHaveBeenCalledTimes(1);
    await act(async () => { resolvePost({ ifc_ready_job_id: "ifcready_queued", status: "queued_for_conversion", queue_position: 1 }); await Promise.resolve(); });
  });

  it("POST 失敗後按 Refresh queue → dialog 內 action 錯誤不被 load 的 setErr(null) 清掉", async () => {
    vi.spyOn(coordinatorClient, "listIfcReady").mockResolvedValue({ count: 1, items: [failedJob] });
    vi.spyOn(coordinatorClient, "minioWatchStatus").mockResolvedValue({ enabled: false });
    vi.spyOn(coordinatorClient, "getConversionRecords").mockResolvedValue({ count: 0, items: [] });
    stubHistoryEmpty();
    vi.spyOn(coordinatorClient, "conversionRetry").mockRejectedValue(new Error("/api/conversion/jobs/ifcready_failed/retry -> 422"));
    render();
    let retryBtn: HTMLButtonElement | null = null;
    await waitFor(() => { retryBtn = container.querySelector('[data-testid="conv-retry-ifcready_failed"]'); expect(retryBtn).toBeTruthy(); });
    await act(async () => { retryBtn!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    let confirm: HTMLButtonElement | null = null;
    await waitFor(() => { confirm = container.querySelector('[data-testid="intent-confirm"]'); expect(confirm).toBeTruthy(); });
    await act(async () => { confirm!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    await waitFor(() => { expect(container.querySelector('[data-testid="intent-action-error"]')).not.toBeNull(); });
    // 按 Refresh queue → 觸發 load()（其第一行 setErr(null)）
    const refreshBtn = Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.includes("Refresh queue") || b.textContent?.includes("讀取中"))! as HTMLButtonElement;
    expect(refreshBtn).toBeTruthy();
    await act(async () => { refreshBtn.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    await waitFor(() => {
      expect(container.querySelector('[data-testid="intent-dialog"]')).not.toBeNull();
      const stillThere = container.querySelector('[data-testid="intent-action-error"]');
      expect(stillThere).not.toBeNull();
      expect(stillThere!.textContent).toContain("控制動作失敗");
    });
  });
});

describe("GlobalConversionPane 自動偵測開關（watch-toggle）", () => {
  it("enabled=false → 頁頂琥珀條 + 開啟鈕 → 確認成功 → 琥珀條消失、Panel 切啟用、dialog 關閉", async () => {
    const listSpy = vi.spyOn(coordinatorClient, "listIfcReady").mockResolvedValue({ count: 0, items: [] });
    vi.spyOn(coordinatorClient, "minioWatchStatus")
      .mockResolvedValueOnce({ enabled: false, note: "watcher 預設關閉" })
      .mockResolvedValue({ enabled: true, bucket: "bim", prefix: "", poll_count: 1 });
    vi.spyOn(coordinatorClient, "getConversionRecords").mockResolvedValue({ count: 0, items: [] });
    stubHistoryEmpty();
    const toggleSpy = vi.spyOn(coordinatorClient, "conversionWatchToggle").mockResolvedValue({ enabled: true });
    render();
    let banner: Element | null = null;
    await waitFor(() => { banner = container.querySelector('[data-testid="conv-watch-off-banner"]'); expect(banner).not.toBeNull(); });
    const enableBtn = container.querySelector('[data-testid="conv-watch-enable"]') as HTMLButtonElement;
    expect(enableBtn).toBeTruthy();
    await act(async () => { enableBtn.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    let confirm: HTMLButtonElement | null = null;
    await waitFor(() => {
      const dialog = container.querySelector('[data-testid="intent-dialog"]');
      expect(dialog).not.toBeNull();
      expect(dialog!.textContent).toContain("開啟 MinIO 自動偵測");
      confirm = container.querySelector('[data-testid="intent-confirm"]');
      expect(confirm).toBeTruthy();
    });
    await act(async () => { confirm!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    await waitFor(() => {
      expect(toggleSpy).toHaveBeenCalledWith(true, "");
      expect(listSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
      expect(container.querySelector('[data-testid="intent-dialog"]')).toBeNull();
      expect(container.querySelector('[data-testid="conv-watch-off-banner"]')).toBeNull();
      expect(container.querySelector('[data-testid="minio-watch-panel"]')!.textContent).toContain("啟用中");
    });
  });

  it("enabled=true → 關閉鈕 → 確認成功 → conversionWatchToggle(false)、dialog 關閉、琥珀條出現", async () => {
    vi.spyOn(coordinatorClient, "listIfcReady").mockResolvedValue({ count: 0, items: [] });
    vi.spyOn(coordinatorClient, "minioWatchStatus")
      .mockResolvedValueOnce({ enabled: true, bucket: "bim", prefix: "", poll_count: 3 })
      .mockResolvedValue({ enabled: false, note: "watcher 已關閉" });
    vi.spyOn(coordinatorClient, "getConversionRecords").mockResolvedValue({ count: 0, items: [] });
    stubHistoryEmpty();
    const toggleSpy = vi.spyOn(coordinatorClient, "conversionWatchToggle").mockResolvedValue({ enabled: false });
    render();
    let disableBtn: HTMLButtonElement | null = null;
    await waitFor(() => {
      expect(container.querySelector('[data-testid="conv-watch-off-banner"]')).toBeNull();
      disableBtn = container.querySelector('[data-testid="conv-watch-disable"]');
      expect(disableBtn).toBeTruthy();
    });
    await act(async () => { disableBtn!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    let confirm: HTMLButtonElement | null = null;
    await waitFor(() => {
      const dialog = container.querySelector('[data-testid="intent-dialog"]');
      expect(dialog!.textContent).toContain("關閉 MinIO 自動偵測");
      confirm = container.querySelector('[data-testid="intent-confirm"]');
      expect(confirm).toBeTruthy();
    });
    await act(async () => { confirm!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    await waitFor(() => {
      expect(toggleSpy).toHaveBeenCalledWith(false, "");
      expect(container.querySelector('[data-testid="intent-dialog"]')).toBeNull();
      const banner = container.querySelector('[data-testid="conv-watch-off-banner"]');
      expect(banner).not.toBeNull();
      expect(banner!.textContent).toContain("自動偵測已關閉");
    });
  });

  it("toggle POST 失敗（422 未配置）→ dialog 維持開啟、顯誠實錯誤、mw 不被樂觀改寫", async () => {
    vi.spyOn(coordinatorClient, "listIfcReady").mockResolvedValue({ count: 0, items: [] });
    vi.spyOn(coordinatorClient, "minioWatchStatus").mockResolvedValue({ enabled: false });
    vi.spyOn(coordinatorClient, "getConversionRecords").mockResolvedValue({ count: 0, items: [] });
    stubHistoryEmpty();
    vi.spyOn(coordinatorClient, "conversionWatchToggle").mockRejectedValue(new Error("/api/conversion/watch -> 422 watcher 未配置"));
    render();
    let enableBtn: HTMLButtonElement | null = null;
    await waitFor(() => { enableBtn = container.querySelector('[data-testid="conv-watch-enable"]'); expect(enableBtn).toBeTruthy(); });
    await act(async () => { enableBtn!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    let confirm: HTMLButtonElement | null = null;
    await waitFor(() => { confirm = container.querySelector('[data-testid="intent-confirm"]'); expect(confirm).toBeTruthy(); });
    await act(async () => { confirm!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    await waitFor(() => {
      expect(container.querySelector('[data-testid="intent-dialog"]')).not.toBeNull();
      const actionErrNode = container.querySelector('[data-testid="intent-action-error"]');
      expect(actionErrNode).not.toBeNull();
      expect(actionErrNode!.textContent).toContain("控制動作失敗");
      expect(actionErrNode!.textContent).toContain("422");
      expect(container.querySelector('[data-testid="conv-watch-enable"]')).not.toBeNull();
      expect(container.querySelector('[data-testid="conv-watch-disable"]')).toBeNull();
    });
  });
});

describe("GlobalConversionPane 佇列表投影（三視圖對帳）", () => {
  it("投影 idempotency_key + lifecycle chip（.ec-prov）+ 誠實 usdc/replay/volatility 標籤", async () => {
    const reconcileJob: IfcReadyListItem = {
      ...queuedJob, ifc_ready_job_id: "ifcready_reconcile",
      idempotency_key: "mw_abc123def4567890", idempotent_replay: false,
      conversion_lifecycle_status: "queued", project_display_name: "松風庵", category: "機電",
      usdc_role: "pending", data_volatility: "in_memory_volatile", failure_reason: null, failure_stage: null,
    };
    vi.spyOn(coordinatorClient, "listIfcReady").mockResolvedValue({ count: 1, items: [reconcileJob] });
    vi.spyOn(coordinatorClient, "getConversionRecords").mockResolvedValue({ count: 0, items: [] });
    vi.spyOn(coordinatorClient, "minioWatchStatus").mockResolvedValue({ enabled: false, note: "未設定" });
    stubHistoryEmpty();
    render();
    await waitFor(() => {
      const idemCell = container.querySelector('[data-testid="conv-job-idem-ifcready_reconcile"]');
      expect(idemCell?.textContent).toContain("mw_abc123def4567890");
      const chip = container.querySelector('[data-testid="conv-job-lifecycle-ifcready_reconcile"]');
      expect(chip?.textContent).toContain("排隊");
      expect(chip?.className).toContain("ec-prov");
      expect(chip?.className).not.toContain("ec-chip");
      expect(container.querySelector('[data-testid="conv-job-usdc-ifcready_reconcile"]')?.textContent).toContain("待產生");
      expect(container.querySelector('[data-testid="conv-job-replay-ifcready_reconcile"]')?.textContent).toContain("新建");
      expect(container.querySelector('[data-testid="conv-job-volatility-ifcready_reconcile"]')?.textContent).toContain("易失");
      // 三段訊號不得相黏
      const keyCell = (idemCell as HTMLElement).closest("td")!;
      expect(keyCell.textContent).not.toContain("mw_abc123def4567890新建");
      expect(keyCell.textContent).not.toContain("新建易失");
    });
  });
});

// ── brief §Step 1 五條新斷言 ──────────────────────────────────────────────
describe("GlobalConversionPane：MD 合一新斷言（brief §Step 1）", () => {
  it("[新1] 摘要卡統計：queued 從 ifc-ready jobs、failed 從 ledger records，各帶口徑標示", async () => {
    // jobs 含 1 筆 queued_for_conversion；records 含 1 筆 failed
    vi.spyOn(coordinatorClient, "listIfcReady").mockResolvedValue({ count: 1, items: [queuedJob] });
    vi.spyOn(coordinatorClient, "getConversionRecords").mockResolvedValue({ count: 1, items: [failedRec] });
    vi.spyOn(coordinatorClient, "minioWatchStatus").mockResolvedValue({ enabled: false });
    stubHistoryEmpty();
    render();
    await waitFor(() => {
      expect(container.querySelector('[data-testid="md-stat-queued"]')!.textContent).toBe("1");
      expect(container.querySelector('[data-testid="md-stat-failed"]')!.textContent).toBe("1");
      // 口徑：佇列（易失 ifc-ready）／失敗（持久 ledger）
      const queuedBlock = container.querySelector('[data-testid="md-stat-block-queued"]')!;
      expect(queuedBlock.textContent).toContain("口徑：ifc-ready（易失");
      const failedBlock = container.querySelector('[data-testid="md-stat-block-failed"]')!;
      expect(failedBlock.textContent).toContain("口徑：ledger（持久");
    });
  });

  it("[新2] recordsTruncated=true → 摘要卡出現「（回傳窗內，非全量）」", async () => {
    vi.spyOn(coordinatorClient, "listIfcReady").mockResolvedValue({ count: 0, items: [] });
    // count(200) > items.length(1) → recordsTruncated=true
    vi.spyOn(coordinatorClient, "getConversionRecords").mockResolvedValue({ count: 200, items: [failedRec] });
    vi.spyOn(coordinatorClient, "minioWatchStatus").mockResolvedValue({ enabled: false });
    stubHistoryEmpty();
    render();
    await waitFor(() => {
      const note = container.querySelector('[data-testid="md-stats-windowed"]');
      expect(note).not.toBeNull();
      expect(note!.textContent).toContain("回傳窗內，非全量");
    });
  });

  // brief §Step 1 補課（Task 4 review）：md-stat-converting / md-stat-ready 個別斷言（[新1] 只驗 queued/failed）。
  // converting 讀易失 ifc-ready（conversion_lifecycle_status="converting"）；ready 讀持久 ledger（record.status="ready"）。
  it("[新1b] 摘要卡統計：converting 從 ifc-ready jobs、ready 從 ledger records，各帶口徑標示", async () => {
    const convertingJob: IfcReadyListItem = { ...okJob, ifc_ready_job_id: "ifcready_converting", conversion_lifecycle_status: "converting" };
    const readyRec: ConversionRecord = { ...failedRec, idempotency_key: "mw_ready0123456789", status: "ready", usdc_key: "東勢區許良宇紀念圖書館/root/main/000003/model.usdc" };
    vi.spyOn(coordinatorClient, "listIfcReady").mockResolvedValue({ count: 1, items: [convertingJob] });
    vi.spyOn(coordinatorClient, "getConversionRecords").mockResolvedValue({ count: 1, items: [readyRec] });
    vi.spyOn(coordinatorClient, "minioWatchStatus").mockResolvedValue({ enabled: false });
    stubHistoryEmpty();
    render();
    await waitFor(() => {
      expect(container.querySelector('[data-testid="md-stat-converting"]')!.textContent).toBe("1");
      expect(container.querySelector('[data-testid="md-stat-ready"]')!.textContent).toBe("1");
      // 口徑：轉換中（易失 ifc-ready）／完成（持久 ledger）
      expect(container.querySelector('[data-testid="md-stat-block-converting"]')!.textContent).toContain("口徑：ifc-ready（易失");
      expect(container.querySelector('[data-testid="md-stat-block-ready"]')!.textContent).toContain("口徑：ledger（持久");
    });
  });

  // brief §Step 1 補課（Task 4 review）：jobsTruncated 分支（相對 [新2] 的 recordsTruncated）——
  // 僅 jobs 被回傳窗截斷（listIfcReady count>items）、records 未截斷，摘要卡仍須加註「（回傳窗內，非全量）」。
  it("[新2b] jobsTruncated=true（records 未截斷）→ 摘要卡出現「（回傳窗內，非全量）」", async () => {
    // count(200) > items.length(1) → jobsTruncated=true
    vi.spyOn(coordinatorClient, "listIfcReady").mockResolvedValue({ count: 200, items: [okJob] });
    vi.spyOn(coordinatorClient, "getConversionRecords").mockResolvedValue({ count: 0, items: [] }); // 未截斷
    vi.spyOn(coordinatorClient, "minioWatchStatus").mockResolvedValue({ enabled: false });
    stubHistoryEmpty();
    render();
    await waitFor(() => {
      const note = container.querySelector('[data-testid="md-stats-windowed"]');
      expect(note).not.toBeNull();
      expect(note!.textContent).toContain("回傳窗內，非全量");
    });
  });

  it("[新3] 佇列表含 download / authority 兩欄，列 render j.download_status / j.conversion_authority", async () => {
    const inJob: IfcReadyListItem = {
      ...okJob, ifc_ready_job_id: "ifcready_in", download_status: "downloaded", conversion_authority: "bim-streaming-server",
    };
    vi.spyOn(coordinatorClient, "listIfcReady").mockResolvedValue({ count: 1, items: [inJob] });
    vi.spyOn(coordinatorClient, "getConversionRecords").mockResolvedValue({ count: 0, items: [] });
    vi.spyOn(coordinatorClient, "minioWatchStatus").mockResolvedValue({ enabled: false });
    stubHistoryEmpty();
    render();
    await waitFor(() => {
      const heads = Array.from(container.querySelectorAll("th")).map((h) => h.textContent);
      expect(heads).toContain("download");
      expect(heads).toContain("authority");
      expect(container.querySelector('[data-testid="conv-job-download-ifcready_in"]')!.textContent).toBe("downloaded");
      expect(container.querySelector('[data-testid="conv-job-authority-ifcready_in"]')!.textContent).toBe("bim-streaming-server");
    });
  });

  it("[新4] 有 object_key 的列掛「檔案 →」定位鈕（點擊呼 onLocateObject）；無 object_key 顯「非 MinIO 來源」", async () => {
    const matchedJob: IfcReadyListItem = { ...okJob, ifc_ready_job_id: "ifcready_matched", idempotency_key: "mw_failed0123456789" };
    const orphanJob: IfcReadyListItem = { ...okJob, ifc_ready_job_id: "ifcready_orphan", idempotency_key: "mw_noledger00000000" };
    vi.spyOn(coordinatorClient, "listIfcReady").mockResolvedValue({ count: 2, items: [matchedJob, orphanJob] });
    // failedRec.idempotency_key === "mw_failed0123456789" → 對帳命中，object_key 存在
    vi.spyOn(coordinatorClient, "getConversionRecords").mockResolvedValue({ count: 1, items: [failedRec] });
    vi.spyOn(coordinatorClient, "minioWatchStatus").mockResolvedValue({ enabled: false });
    stubHistoryEmpty();
    const onLocate = vi.fn();
    render({ onLocateObject: onLocate });
    let locateBtn: HTMLButtonElement | null = null;
    await waitFor(() => {
      locateBtn = container.querySelector('[data-testid="md-queue-locate-mw_failed0123456789"]');
      expect(locateBtn).toBeTruthy();
      // orphan 列（無對帳紀錄）顯「非 MinIO 來源」
      const orphanRow = (container.querySelector('[data-testid="conv-job-idem-ifcready_orphan"]') as HTMLElement).closest("tr")!;
      expect(orphanRow.textContent).toContain("非 MinIO 來源");
      expect(container.querySelector('[data-testid="md-queue-locate-mw_noledger00000000"]')).toBeNull();
    });
    await act(async () => { locateBtn!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(onLocate).toHaveBeenCalledWith("東勢區許良宇紀念圖書館/root/main/000003/model.ifc");
  });

  it("[新5] 展開 Pipeline / 系統細節 details → 出現 NOT BUILT（concurrency 揭露，spec §4 #21）", async () => {
    vi.spyOn(coordinatorClient, "listIfcReady").mockResolvedValue({ count: 0, items: [] });
    vi.spyOn(coordinatorClient, "getConversionRecords").mockResolvedValue({ count: 0, items: [] });
    vi.spyOn(coordinatorClient, "minioWatchStatus").mockResolvedValue({ enabled: false });
    stubHistoryEmpty();
    render();
    let details: HTMLDetailsElement | null = null;
    await waitFor(() => { details = container.querySelector('[data-testid="md-pipeline-details"]'); expect(details).not.toBeNull(); });
    // 展開細節（jsdom 不隨 summary click 自動 toggle → 直接設 open）
    await act(async () => { (details as HTMLDetailsElement).open = true; });
    await waitFor(() => { expect((details as HTMLDetailsElement).textContent).toContain("NOT BUILT"); });
  });

  it("[新4b] data-highlight：highlightJobId 命中列 data-highlight=\"true\"", async () => {
    vi.spyOn(coordinatorClient, "listIfcReady").mockResolvedValue({ count: 1, items: [okJob] });
    vi.spyOn(coordinatorClient, "getConversionRecords").mockResolvedValue({ count: 0, items: [] });
    vi.spyOn(coordinatorClient, "minioWatchStatus").mockResolvedValue({ enabled: false });
    stubHistoryEmpty();
    render({ highlightJobId: "ifcready_ok" });
    await waitFor(() => {
      const row = (container.querySelector('[data-testid="conv-job-idem-ifcready_ok"]') as HTMLElement).closest("tr")!;
      expect(row.getAttribute("data-highlight")).toBe("true");
    });
  });

  // spec §4 #12（dispatch 裁定 fix）：ledger 對映 failed 且有 object_key 的佇列列，補「觸發轉檔」鈕
  //（與「檔案 →」鈕並存不互斥，比照原 CV ledger 列兩鈕並存）；點擊開啟 trigger dialog（cost 含 object_key）。
  it("[新6/§4#12] failed 對映列掛「觸發轉檔」鈕 → 點擊開 trigger dialog（cost 含 object_key）；非 failed 列無鈕", async () => {
    const matchedJob: IfcReadyListItem = { ...okJob, ifc_ready_job_id: "ifcready_matched", idempotency_key: "mw_failed0123456789" };
    vi.spyOn(coordinatorClient, "listIfcReady").mockResolvedValue({ count: 1, items: [matchedJob] });
    // failedRec：status="failed"、object_key 存在、idempotency_key 對映到 matchedJob
    vi.spyOn(coordinatorClient, "getConversionRecords").mockResolvedValue({ count: 1, items: [failedRec] });
    vi.spyOn(coordinatorClient, "minioWatchStatus").mockResolvedValue({ enabled: false });
    stubHistoryEmpty();
    render();
    let trigBtn: HTMLButtonElement | null = null;
    await waitFor(() => {
      trigBtn = container.querySelector('[data-testid="md-queue-trigger-mw_failed0123456789"]');
      expect(trigBtn).toBeTruthy();
      // 兩鈕並存：同列「檔案 →」定位鈕仍在（不互斥）
      expect(container.querySelector('[data-testid="md-queue-locate-mw_failed0123456789"]')).not.toBeNull();
    });
    await act(async () => { trigBtn!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    await waitFor(() => {
      const dialog = container.querySelector('[data-testid="intent-dialog"]');
      expect(dialog).not.toBeNull();
      expect(dialog!.textContent).toContain("確認觸發轉檔");
      // cost 文案含原始 object_key（POST /api/conversion/trigger 的 payload 主體，誠實揭露）
      expect(dialog!.textContent).toContain("東勢區許良宇紀念圖書館/root/main/000003/model.ifc");
    });
  });

  it("[新6b/§4#12 邊界] 對映 record 非 failed（queued）→ 該列不掛觸發鈕", async () => {
    const matchedJob: IfcReadyListItem = { ...okJob, ifc_ready_job_id: "ifcready_matched", idempotency_key: "mw_failed0123456789" };
    const queuedRec: ConversionRecord = { ...failedRec, status: "queued" };
    vi.spyOn(coordinatorClient, "listIfcReady").mockResolvedValue({ count: 1, items: [matchedJob] });
    vi.spyOn(coordinatorClient, "getConversionRecords").mockResolvedValue({ count: 1, items: [queuedRec] });
    vi.spyOn(coordinatorClient, "minioWatchStatus").mockResolvedValue({ enabled: false });
    stubHistoryEmpty();
    render();
    await waitFor(() => {
      // 對映命中（有 object_key）→「檔案 →」鈕在；但 status=queued 非 failed → 無觸發鈕
      expect(container.querySelector('[data-testid="md-queue-locate-mw_failed0123456789"]')).not.toBeNull();
      expect(container.querySelector('[data-testid="md-queue-trigger-mw_failed0123456789"]')).toBeNull();
    });
  });
});

// 遷移自 console.test.tsx（Task 9 三頁合一）：dispatch_error 欄位形狀對齊真後端 schema，渲染層驗證（真後端值由 E2E 驗）。
// 佇列列失敗格 conv-job-failure-* 由 GlobalConversionPane 承接（原 CV 頁行為）：failure_reason 優先、無則回退
// dispatch_error；>80 字截斷補「…」提示（誠實鐵律不可靜默硬切），完整訊息保留於 title tooltip。
describe("GlobalConversionPane：dispatch_error 欄位形狀 + 80 字截斷（遷自 console.test.tsx）", () => {
  it("有 dispatch_error 的 job → 渲染錯誤明細節點（截斷+title）；無 dispatch_error 的 job → 不渲染", async () => {
    const failJob: IfcReadyListItem = {
      ...okJob, ifc_ready_job_id: "ifcready_fail", external_model_version_id: "271_pieple_管線",
      status: "dispatch_failed", conversion_status: "dispatch_failed",
      dispatch_error: 'streaming conversion API 400: {"detail":"Invalid ifc_artifact_id: ifc_271_pieple_管線"}',
    };
    const okDispatched: IfcReadyListItem = { ...okJob, ifc_ready_job_id: "ifcready_ok", status: "dispatched", conversion_status: "dispatched", dispatch_error: null };
    vi.spyOn(coordinatorClient, "listIfcReady").mockResolvedValue({ count: 2, items: [failJob, okDispatched] });
    vi.spyOn(coordinatorClient, "minioWatchStatus").mockResolvedValue({ enabled: false, note: "test stub" });
    vi.spyOn(coordinatorClient, "getConversionRecords").mockResolvedValue({ count: 0, items: [] });
    stubHistoryEmpty();
    render();
    let errNode: Element | null = null;
    await waitFor(() => {
      errNode = container.querySelector('[data-testid="conv-job-failure-ifcready_fail"]');
      expect(errNode).not.toBeNull();
    });
    expect(errNode!.textContent).toContain("Invalid ifc_artifact_id");
    expect(errNode!.getAttribute("title")).toContain("streaming conversion API 400");
    // 可見文字超過 80 字須截斷並補「…」提示，不得靜默硬切誤導操作員。
    expect(errNode!.textContent!.endsWith("…")).toBe(true);
    expect(errNode!.textContent).not.toContain("_管線");         // 尾端已被截斷，不在可見文字
    expect(errNode!.getAttribute("title")).toContain("_管線");   // 完整訊息仍保留於 title tooltip
    // 無 dispatch_error 的 job 不得渲染錯誤節點
    expect(container.querySelector('[data-testid="conv-job-failure-ifcready_ok"]')).toBeNull();
  });
});
