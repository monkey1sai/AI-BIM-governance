import { act } from "react";
import { renderToString } from "react-dom/server";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConversionSchedulingPage } from "./pages";
import { coordinatorClient, type IfcReadyListItem } from "./coordinatorClient";

describe("ConversionSchedulingPage MinIO 自動偵測 Panel（O4）", () => {
  it("初始渲染含 MinIO 自動偵測 Panel 與穩定選取子", () => {
    const html = renderToString(<ConversionSchedulingPage />);
    expect(html).toContain("MinIO 自動偵測");
    // 真實狀態端點來源（誠實）
    expect(html).toContain("/api/external/minio-watch/status");
    // 穩定選取子供 E2E
    expect(html).toContain('data-testid="minio-watch-panel"');
  });

  it("只打 coordinator，不直連內部埠", () => {
    const html = renderToString(<ConversionSchedulingPage />);
    expect(html).not.toContain(":49101");
    expect(html).not.toContain(":9000"); // 前端不直連 MinIO；走 coordinator status
  });
});

// 兩端點獨立 settle：minio-watch/status 失敗不得污染 ifc-ready 錯誤、不得讓 watcher
// Panel 靜默停在 placeholder（finding #1）。client render 才會跑 useEffect → load()。
describe("ConversionSchedulingPage：minio-watch 與 ifc-ready 錯誤獨立", () => {
  const actEnvKey = "IS_REACT_ACT_ENVIRONMENT" as const;
  let container: HTMLDivElement;
  let prevActEnv: unknown;
  const baseJob = {
    project_id: "271", download_status: "downloaded", conversion_authority: null,
    review_session_id: null, viewer_url: null, expected_stage_url: null,
    expected_mapping_url: null, created_at: "2026-06-11T00:00:00Z",
    conversion_job_id: null, // m2a-coverage-report:新 required key（值 null）；補齊既有 fixture
    queue_position: null, // conv-prioritize-retry:non-optional required key；dispatched fixture 預設 null
    updated_at: "2026-06-11T00:00:00Z", // conv-prioritize-retry §2.4:新 required key；補齊既有 fixture
  };
  const okJob: IfcReadyListItem = {
    ...baseJob, ifc_ready_job_id: "ifcready_ok", external_model_version_id: "ext_ok",
    status: "dispatched", conversion_status: "dispatched", dispatch_error: null,
  };
  beforeEach(() => {
    prevActEnv = (globalThis as Record<string, unknown>)[actEnvKey];
    (globalThis as Record<string, unknown>)[actEnvKey] = true;
    container = document.createElement("div");
    document.body.appendChild(container);
  });
  afterEach(() => {
    document.body.removeChild(container);
    vi.restoreAllMocks();
    (globalThis as Record<string, unknown>)[actEnvKey] = prevActEnv;
  });

  it("minioWatchStatus reject 時：jobs 仍渲染，watcher Panel 顯示獨立錯誤而非 placeholder", async () => {
    vi.spyOn(coordinatorClient, "listIfcReady").mockResolvedValue({ count: 1, items: [okJob] });
    vi.spyOn(coordinatorClient, "minioWatchStatus").mockRejectedValue(new Error("coordinator /api/external/minio-watch/status -> 404 Not Found"));
    const root = createRoot(container);
    await act(async () => { root.render(<ConversionSchedulingPage />); });
    await act(async () => { await Promise.resolve(); });

    // ifc-ready 那側成功 → job 列照常渲染
    expect(container.textContent).toContain("ifcready_ok");
    // watcher 錯誤獨立顯示，且不再卡在 placeholder
    const mwErrNode = container.querySelector('[data-testid="minio-watch-error"]');
    expect(mwErrNode).not.toBeNull();
    expect(mwErrNode!.textContent).toContain("/api/external/minio-watch/status");
    const panel = container.querySelector('[data-testid="minio-watch-panel"]');
    expect(panel!.textContent).not.toContain("按上方 Refresh queue 後顯示");
    // 錯誤端點不得被誤標成 ifc-ready
    expect(mwErrNode!.textContent).not.toContain("/api/external/ifc-ready");
  });

  it("listIfcReady reject 但 minioWatchStatus 成功時：watcher Panel 正常顯示未啟用，不被 ifc-ready 錯誤連坐", async () => {
    vi.spyOn(coordinatorClient, "listIfcReady").mockRejectedValue(new Error("coordinator /api/external/ifc-ready -> 500"));
    vi.spyOn(coordinatorClient, "minioWatchStatus").mockResolvedValue({ enabled: false, note: "watcher 預設關閉" });
    const root = createRoot(container);
    await act(async () => { root.render(<ConversionSchedulingPage />); });
    await act(async () => { await Promise.resolve(); });

    // watcher 側成功 → 顯示未啟用狀態，沒有 watcher 錯誤節點
    expect(container.querySelector('[data-testid="minio-watch-error"]')).toBeNull();
    const panel = container.querySelector('[data-testid="minio-watch-panel"]');
    expect(panel!.textContent).toContain("未啟用");
  });

  // spec §6.2：enabled=true → 計數 render。覆蓋整條 client-render 路徑（bucket/prefix/
  // last_poll_at + baseline/seen/觸發/跳過 計數字串 + minio-watch-triggered table），
  // 否則 pages.tsx 模板字串拼接或 table 條件渲染若有 typo，CI 抓不到（finding #2）。
  it("minioWatchStatus enabled=true 時：渲染計數與 triggered table", async () => {
    vi.spyOn(coordinatorClient, "listIfcReady").mockResolvedValue({ count: 1, items: [okJob] });
    vi.spyOn(coordinatorClient, "minioWatchStatus").mockResolvedValue({
      enabled: true, bucket: "bim-control", prefix: "", last_poll_at: "2026-06-12T06:00:00Z",
      poll_count: 3, baseline_count: 10, seen_count: 11, triggered_total: 1, skipped_malformed_total: 0,
      last_triggered: [{ key: "bim-control/271/v1/model.ifc", job_id: "ifcready_mw1", error: null, at: "2026-06-12T06:00:00Z" }],
    });
    const root = createRoot(container);
    await act(async () => { root.render(<ConversionSchedulingPage />); });
    await act(async () => { await Promise.resolve(); });

    const panel = container.querySelector('[data-testid="minio-watch-panel"]');
    expect(panel!.textContent).toContain("啟用中");
    expect(panel!.textContent).toContain("bim-control");
    // 計數字串 baseline / seen / 觸發 / 跳過
    expect(panel!.textContent).toContain("10 / 11 / 1 / 0");
    // poll_count 渲染為「輪詢次數」（loop liveness 對操作者可見，非 dead field）。
    expect(panel!.textContent).toContain("輪詢次數");
    expect(panel!.textContent).toContain("3");
    // triggered table 帶 job id
    const triggered = container.querySelector('[data-testid="minio-watch-triggered"]');
    expect(triggered).not.toBeNull();
    expect(triggered!.textContent).toContain("ifcready_mw1");
    expect(triggered!.textContent).toContain("bim-control/271/v1/model.ifc");
    // race window 沒命中時不應殘留 note 文字
    expect(panel!.textContent).not.toContain("not yet started");
  });

  // 後端 race window（coordinator app.ts:841）：minioWatchEnabled=true 但 watcher handle
  // 尚未建立 → { enabled: true, note: "..." }，無 bucket/prefix/計數。enabled=true 分支
  // 必須讓 note 穿透，否則操作者只看到一排 dash，無從判斷正常 race 還是真故障（finding #1）。
  it("minioWatchStatus enabled=true 但僅帶 note（watcher 尚未啟動）：note 穿透顯示", async () => {
    vi.spyOn(coordinatorClient, "listIfcReady").mockResolvedValue({ count: 1, items: [okJob] });
    vi.spyOn(coordinatorClient, "minioWatchStatus").mockResolvedValue({
      enabled: true, note: "watcher enabled but not yet started (server not listening)",
    });
    const root = createRoot(container);
    await act(async () => { root.render(<ConversionSchedulingPage />); });
    await act(async () => { await Promise.resolve(); });

    const panel = container.querySelector('[data-testid="minio-watch-panel"]');
    // 仍顯示啟用中（enabled=true 分支），且 note 穿透
    expect(panel!.textContent).toContain("啟用中");
    expect(panel!.textContent).toContain("watcher enabled but not yet started");
  });
});

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
    queue_position: null, // conv-prioritize-retry:non-optional required key；dispatched fixture 預設 null
    updated_at: "2026-06-16T00:00:00Z", // conv-prioritize-retry §2.4:新 required key；補齊既有 fixture
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
        conversion_duration_seconds: 73.5,
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
    expect(drawer.textContent).toContain("73.5");   // conversion_duration_seconds（spec §4.4 必顯欄）
    expect(drawer.textContent).toContain("model.usdc");
    expect(drawer.textContent).toContain("未提供");  // 三項拆分誠實標
    // sidecar 策略非自我參照 → 不得顯 usd_stage_enumeration 的自我比對 caveat
    expect(container.querySelector('[data-testid="conv-coverage-selfref-note"]')).toBeNull();
  });

  // 誠實鐵律「coverage 語意不得被誤讀」：materialization=usd_stage_enumeration 下 coverage_ratio
  // 為自我參照（source=mapped 同源 USD 枚舉，結構性恆=1.0），必須顯誠實 caveat，避免 100% 被讀成 IFC lossless。
  it("materialization=usd_stage_enumeration → 顯自我參照誠實 caveat（source 標 USD 枚舉 prim 數）", async () => {
    vi.spyOn(coordinatorClient, "listIfcReady").mockResolvedValue({ count: 1, items: [job] });
    vi.spyOn(coordinatorClient, "minioWatchStatus").mockResolvedValue({ enabled: false });
    vi.spyOn(coordinatorClient, "conversionQualityMetrics").mockResolvedValue({
      conversion_job_id: "stream_conv_20260616_cov",
      quality_metrics_summary: {
        coverage_ratio: 1, coverage_status: "pass", mapped_count: 543, unmapped_count: 0,
        source_ifc_entity_count: 543, materialization_strategy: "usd_stage_enumeration",
        conversion_duration_seconds: null,
      },
      usdc_url: "http://x/model.usdc", mapping_url: "http://x/element_mapping.json",
    });
    const root = createRoot(container);
    await act(async () => { root.render(<ConversionSchedulingPage />); });
    await act(async () => { await Promise.resolve(); });
    const toggle = container.querySelector('[data-testid="conv-coverage-toggle-ifcready_cov"]') as HTMLElement;
    await act(async () => { toggle.click(); });
    await act(async () => { await Promise.resolve(); });
    const drawer = container.querySelector('[data-testid="conv-coverage-ifcready_cov"]')!;
    expect(drawer.textContent).toContain("100.00"); // coverage_ratio=1 → 真顯 100%（值為真）
    const note = container.querySelector('[data-testid="conv-coverage-selfref-note"]');
    expect(note).not.toBeNull();                    // 自我參照 caveat 必顯
    expect(note!.textContent).toContain("自我比對");
    expect(note!.textContent).toContain("lossless");
    expect(drawer.textContent).toContain("USD 枚舉 prim 數"); // source 欄標籤改寫
  });

  // spec §6 line 104 測試邊界「無 quality_metrics → summary:null」：CoverageDrawer 的 null 守門
  //（pages.tsx:404）必須誠實顯「未取得品質遙測」且不顯任何百分比。鎖住此分支防靜默回歸。
  it("summary 為 null（後端無 quality_metrics）→ 顯「未取得品質遙測」、不顯任何 %", async () => {
    vi.spyOn(coordinatorClient, "listIfcReady").mockResolvedValue({ count: 1, items: [job] });
    vi.spyOn(coordinatorClient, "minioWatchStatus").mockResolvedValue({ enabled: false });
    vi.spyOn(coordinatorClient, "conversionQualityMetrics").mockResolvedValue({
      conversion_job_id: "stream_conv_20260616_cov",
      quality_metrics_summary: null,
      usdc_url: null, mapping_url: null,
    });
    const root = createRoot(container);
    await act(async () => { root.render(<ConversionSchedulingPage />); });
    await act(async () => { await Promise.resolve(); });
    const toggle = container.querySelector('[data-testid="conv-coverage-toggle-ifcready_cov"]') as HTMLElement;
    await act(async () => { toggle.click(); });
    await act(async () => { await Promise.resolve(); });
    const drawer = container.querySelector('[data-testid="conv-coverage-ifcready_cov"]')!;
    expect(drawer.textContent).toContain("未取得品質遙測");
    expect(drawer.textContent).not.toMatch(/\d+\.\d+\s*%/); // 無任何百分比
  });

  // 誠實鐵律「不得承諾 100% lossless」：ratio<1（有 unmapped）卻四捨五入到 100.00 時，
  // 必須下修顯 99.99%，不得謊報 100%（真值另由相鄰 mapped/unmapped 揭露）。
  it("coverage_ratio<1 但近似 100 → 顯 99.99% 不謊報 100.00%", async () => {
    vi.spyOn(coordinatorClient, "listIfcReady").mockResolvedValue({ count: 1, items: [job] });
    vi.spyOn(coordinatorClient, "minioWatchStatus").mockResolvedValue({ enabled: false });
    vi.spyOn(coordinatorClient, "conversionQualityMetrics").mockResolvedValue({
      conversion_job_id: "stream_conv_20260616_cov",
      quality_metrics_summary: {
        coverage_ratio: 0.99996, coverage_status: "warn", mapped_count: 24999, unmapped_count: 1,
        source_ifc_entity_count: 25000, materialization_strategy: "sidecar",
      },
      usdc_url: "http://x/model.usdc", mapping_url: "http://x/element_mapping.json",
    });
    const root = createRoot(container);
    await act(async () => { root.render(<ConversionSchedulingPage />); });
    await act(async () => { await Promise.resolve(); });
    const toggle = container.querySelector('[data-testid="conv-coverage-toggle-ifcready_cov"]') as HTMLElement;
    await act(async () => { toggle.click(); });
    await act(async () => { await Promise.resolve(); });
    const drawer = container.querySelector('[data-testid="conv-coverage-ifcready_cov"]')!;
    expect(drawer.textContent).toContain("99.99%");
    expect(drawer.textContent).not.toContain("100.00%");
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

  // spec §5「重複展開同 job → 去重 / 載入鎖，避免重打」/ §6.2「去重 / 載入鎖（重打）邏輯驗證」。
  // pages.tsx toggleCoverage 的快取去重：成功取得後收合再展開，重用快取不再打 API。
  it("成功展開後收合再展開同一 job → 重用快取，不再呼叫 conversionQualityMetrics", async () => {
    vi.spyOn(coordinatorClient, "listIfcReady").mockResolvedValue({ count: 1, items: [job] });
    vi.spyOn(coordinatorClient, "minioWatchStatus").mockResolvedValue({ enabled: false });
    const spy = vi.spyOn(coordinatorClient, "conversionQualityMetrics").mockResolvedValue({
      conversion_job_id: "stream_conv_20260616_cov",
      quality_metrics_summary: {
        coverage_ratio: 0.9886, coverage_status: "warn", mapped_count: 988, unmapped_count: 12,
        source_ifc_entity_count: 1000, materialization_strategy: "sidecar",
        conversion_duration_seconds: 73.5,
      },
      usdc_url: "http://x/model.usdc", mapping_url: "http://x/element_mapping.json",
    });
    const root = createRoot(container);
    await act(async () => { root.render(<ConversionSchedulingPage />); });
    await act(async () => { await Promise.resolve(); });
    const toggle = container.querySelector('[data-testid="conv-coverage-toggle-ifcready_cov"]') as HTMLElement;
    // 1) 展開 → 觸發 fetch（一次）
    await act(async () => { toggle.click(); });
    await act(async () => { await Promise.resolve(); });
    expect(spy).toHaveBeenCalledTimes(1);
    // 2) 收合（openJob === id 的 early-return）
    await act(async () => { toggle.click(); });
    await act(async () => { await Promise.resolve(); });
    // 3) 再展開 → 命中成功快取，不重打
    await act(async () => { toggle.click(); });
    await act(async () => { await Promise.resolve(); });
    expect(spy).toHaveBeenCalledTimes(1);
    // 快取仍渲染真 coverage
    expect(container.querySelector('[data-testid="conv-coverage-ifcready_cov"]')!.textContent).toContain("98.86");
  });

  // 載入鎖：fetch 尚未 settle（deferred promise）時，收合再展開不得觸發第二次 API call
  //（toggleCoverage 的 cached === "loading" 守門）。
  it("載入中收合再展開 → 載入鎖擋下第二次 conversionQualityMetrics", async () => {
    vi.spyOn(coordinatorClient, "listIfcReady").mockResolvedValue({ count: 1, items: [job] });
    vi.spyOn(coordinatorClient, "minioWatchStatus").mockResolvedValue({ enabled: false });
    // 永不 resolve → 卡在 loading 狀態
    const spy = vi.spyOn(coordinatorClient, "conversionQualityMetrics").mockReturnValue(new Promise(() => {}));
    const root = createRoot(container);
    await act(async () => { root.render(<ConversionSchedulingPage />); });
    await act(async () => { await Promise.resolve(); });
    const toggle = container.querySelector('[data-testid="conv-coverage-toggle-ifcready_cov"]') as HTMLElement;
    // 展開 → 進 loading（fetch 不 settle）
    await act(async () => { toggle.click(); });
    await act(async () => { await Promise.resolve(); });
    expect(spy).toHaveBeenCalledTimes(1);
    // 收合
    await act(async () => { toggle.click(); });
    await act(async () => { await Promise.resolve(); });
    // 再展開 → cov[id] 仍是 "loading"，載入鎖擋下不重打
    await act(async () => { toggle.click(); });
    await act(async () => { await Promise.resolve(); });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  // 錯誤重試：error 態收合再展開 → 重新打 API（錯誤不黏住，符合誠實鐵律的重試機會）。
  it("展開遇錯誤後收合再展開 → 重新呼叫 conversionQualityMetrics（重試）", async () => {
    vi.spyOn(coordinatorClient, "listIfcReady").mockResolvedValue({ count: 1, items: [job] });
    vi.spyOn(coordinatorClient, "minioWatchStatus").mockResolvedValue({ enabled: false });
    const spy = vi.spyOn(coordinatorClient, "conversionQualityMetrics")
      .mockRejectedValueOnce(new Error("/api/conversions/... -> 502"))
      .mockResolvedValueOnce({
        conversion_job_id: "stream_conv_20260616_cov",
        quality_metrics_summary: {
          coverage_ratio: 0.9886, coverage_status: "warn", mapped_count: 988, unmapped_count: 12,
          source_ifc_entity_count: 1000, materialization_strategy: "sidecar",
          conversion_duration_seconds: 73.5,
        },
        usdc_url: "http://x/model.usdc", mapping_url: "http://x/element_mapping.json",
      });
    const root = createRoot(container);
    await act(async () => { root.render(<ConversionSchedulingPage />); });
    await act(async () => { await Promise.resolve(); });
    const toggle = container.querySelector('[data-testid="conv-coverage-toggle-ifcready_cov"]') as HTMLElement;
    // 1) 展開 → 第一次失敗
    await act(async () => { toggle.click(); });
    await act(async () => { await Promise.resolve(); });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[data-testid="conv-coverage-ifcready_cov"]')!.textContent).toContain("/api/conversions");
    // 2) 收合
    await act(async () => { toggle.click(); });
    await act(async () => { await Promise.resolve(); });
    // 3) 再展開 → error 態不黏快取，重新打 API（第二次成功）
    await act(async () => { toggle.click(); });
    await act(async () => { await Promise.resolve(); });
    expect(spy).toHaveBeenCalledTimes(2);
    expect(container.querySelector('[data-testid="conv-coverage-ifcready_cov"]')!.textContent).toContain("98.86");
  });
});

describe("ConversionSchedulingPage 控制動作（插隊／重試）", () => {
  const actEnvKey = "IS_REACT_ACT_ENVIRONMENT" as const;
  let container: HTMLDivElement; let prev: unknown;
  beforeEach(() => { prev = (globalThis as Record<string, unknown>)[actEnvKey]; (globalThis as Record<string, unknown>)[actEnvKey] = true; container = document.createElement("div"); document.body.appendChild(container); });
  afterEach(() => { document.body.removeChild(container); vi.restoreAllMocks(); (globalThis as Record<string, unknown>)[actEnvKey] = prev; });

  const failedJob: IfcReadyListItem = {
    ifc_ready_job_id: "ifcready_failed", status: "dispatch_failed", project_id: "271",
    external_model_version_id: "ext_f", download_status: "downloaded", conversion_status: "dispatch_failed",
    conversion_authority: null, conversion_job_id: null, dispatch_error: "stub failure",
    queue_position: null, review_session_id: null, viewer_url: null,
    expected_stage_url: null, expected_mapping_url: null, created_at: "2026-06-16T00:00:00Z",
    updated_at: "2026-06-16T00:00:00Z", // conv-prioritize-retry §2.4:non-optional required key
  };

  // spec §4.6/§4.5：queued_for_conversion 且非隊首（queue_position>=2）→ 顯插隊鈕、不 disabled。
  const queuedJob: IfcReadyListItem = {
    ifc_ready_job_id: "ifcready_queued", status: "queued_for_conversion", project_id: "271",
    external_model_version_id: "ext_q", download_status: "downloaded", conversion_status: "queued_for_conversion",
    conversion_authority: null, conversion_job_id: null, dispatch_error: null,
    queue_position: 2, review_session_id: null, viewer_url: null,
    expected_stage_url: null, expected_mapping_url: null, created_at: "2026-06-16T00:00:00Z",
    updated_at: "2026-06-16T00:00:00Z",
  };

  it("dispatch_failed job 顯重試鈕 → 確認 → conversionRetry 被呼叫且 load 重抓", async () => {
    const listSpy = vi.spyOn(coordinatorClient, "listIfcReady").mockResolvedValue({ count: 1, items: [failedJob] });
    vi.spyOn(coordinatorClient, "minioWatchStatus").mockResolvedValue({ enabled: false });
    const retrySpy = vi.spyOn(coordinatorClient, "conversionRetry").mockResolvedValue({ ifc_ready_job_id: "ifcready_failed", status: "queued_for_conversion", queue_position: 1 });
    const root = createRoot(container);
    await act(async () => { root.render(<ConversionSchedulingPage />); });
    await act(async () => { await Promise.resolve(); });

    const retryBtn = container.querySelector('[data-testid="conv-retry-ifcready_failed"]') as HTMLButtonElement;
    expect(retryBtn).toBeTruthy();
    await act(async () => { retryBtn.dispatchEvent(new MouseEvent("click", { bubbles: true })); });

    const confirm = container.querySelector('[data-testid="intent-confirm"]') as HTMLButtonElement;
    expect(confirm).toBeTruthy();
    await act(async () => { confirm.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    await act(async () => { await Promise.resolve(); });

    expect(retrySpy).toHaveBeenCalledWith("ifcready_failed", "");
    expect(listSpy.mock.calls.length).toBeGreaterThanOrEqual(2); // 初次 load + 成功後 load
  });

  // spec §4.5/§4.6/§6.1「prioritize 移 queued job 到前端」：queued_for_conversion + queue_position>=2
  // → 插隊鈕出現且不 disabled → 點按開 IntentDialog → confirm → conversionPrioritize 被呼叫且 load 重抓。
  // 此前 task#6 測試只覆蓋 retry 路徑，插隊整條互動流（dialog→confirm→prioritize→load）無單元保護。
  it("queued_for_conversion + queue_position>=2 顯插隊鈕（不 disabled）→ 確認 → conversionPrioritize 被呼叫且 load 重抓", async () => {
    const listSpy = vi.spyOn(coordinatorClient, "listIfcReady").mockResolvedValue({ count: 1, items: [queuedJob] });
    vi.spyOn(coordinatorClient, "minioWatchStatus").mockResolvedValue({ enabled: false });
    const prioritizeSpy = vi.spyOn(coordinatorClient, "conversionPrioritize").mockResolvedValue({ ifc_ready_job_id: "ifcready_queued", status: "queued_for_conversion", queue_position: 1 });
    const root = createRoot(container);
    await act(async () => { root.render(<ConversionSchedulingPage />); });
    await act(async () => { await Promise.resolve(); });

    const prioBtn = container.querySelector('[data-testid="conv-prioritize-ifcready_queued"]') as HTMLButtonElement;
    expect(prioBtn).toBeTruthy();
    expect(prioBtn.disabled).toBe(false); // queue_position=2 → 可插隊（非隊首/非 in-flight）
    await act(async () => { prioBtn.dispatchEvent(new MouseEvent("click", { bubbles: true })); });

    // 點按開 IntentDialog
    expect(container.querySelector('[data-testid="intent-dialog"]')).not.toBeNull();
    const confirm = container.querySelector('[data-testid="intent-confirm"]') as HTMLButtonElement;
    expect(confirm).toBeTruthy();
    await act(async () => { confirm.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    await act(async () => { await Promise.resolve(); });

    expect(prioritizeSpy).toHaveBeenCalledWith("ifcready_queued", "");
    expect(listSpy.mock.calls.length).toBeGreaterThanOrEqual(2); // 初次 load + 成功後 load
    // 成功後關 dialog（非樂觀，後端真狀態刷新）
    expect(container.querySelector('[data-testid="intent-dialog"]')).toBeNull();
  });

  // spec §5/§4.6「失敗顯誠實錯誤、不關 dialog、不改狀態」：runAction catch 分支（setErr + pendingAction 保留）。
  // 若未來有人在 catch 加 setPendingAction(null)（誤關 dialog），此測試會攔截，防靜默 regression。
  it("POST 失敗（conversionRetry reject）→ dialog 維持開啟、顯誠實錯誤、不靜默關閉", async () => {
    vi.spyOn(coordinatorClient, "listIfcReady").mockResolvedValue({ count: 1, items: [failedJob] });
    vi.spyOn(coordinatorClient, "minioWatchStatus").mockResolvedValue({ enabled: false });
    vi.spyOn(coordinatorClient, "conversionRetry").mockRejectedValue(new Error("/api/conversion/jobs/ifcready_failed/retry -> 422"));
    const root = createRoot(container);
    await act(async () => { root.render(<ConversionSchedulingPage />); });
    await act(async () => { await Promise.resolve(); });

    const retryBtn = container.querySelector('[data-testid="conv-retry-ifcready_failed"]') as HTMLButtonElement;
    expect(retryBtn).toBeTruthy();
    await act(async () => { retryBtn.dispatchEvent(new MouseEvent("click", { bubbles: true })); });

    const confirm = container.querySelector('[data-testid="intent-confirm"]') as HTMLButtonElement;
    expect(confirm).toBeTruthy();
    await act(async () => { confirm.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    await act(async () => { await Promise.resolve(); });

    // 失敗不關 dialog（pendingAction 仍非 null）
    expect(container.querySelector('[data-testid="intent-dialog"]')).not.toBeNull();
    // 誠實錯誤訊息（runAction catch 的 setActionErr）
    const warn = container.querySelector(".ec-warn-note");
    expect(warn).not.toBeNull();
    expect(container.textContent).toContain("控制動作失敗");
  });

  // finding #1：runAction 缺同步 busy guard，confirm 鈕 disabled={busy} 要等下一次 render 才生效。
  // 同一事件循環連按兩次 confirm → 應只送出一個 POST（同步 ref guard 在 React state 更新前攔截第二次）。
  it("同一事件循環連點兩次確認 → 只送出一個 POST（同步 busy guard）", async () => {
    vi.spyOn(coordinatorClient, "listIfcReady").mockResolvedValue({ count: 1, items: [queuedJob] });
    vi.spyOn(coordinatorClient, "minioWatchStatus").mockResolvedValue({ enabled: false });
    // POST 不立即 settle（deferred），維持 busy 視窗讓第二次 click 有機會穿透 stale disabled。
    let resolvePost: (v: unknown) => void = () => {};
    const prioritizeSpy = vi.spyOn(coordinatorClient, "conversionPrioritize")
      .mockImplementation(() => new Promise((res) => { resolvePost = res; }));
    const root = createRoot(container);
    await act(async () => { root.render(<ConversionSchedulingPage />); });
    await act(async () => { await Promise.resolve(); });

    const prioBtn = container.querySelector('[data-testid="conv-prioritize-ifcready_queued"]') as HTMLButtonElement;
    await act(async () => { prioBtn.dispatchEvent(new MouseEvent("click", { bubbles: true })); });

    const confirm = container.querySelector('[data-testid="intent-confirm"]') as HTMLButtonElement;
    // 同一個 act（同步、單一事件循環）內連點兩次：第二次須被同步 guard 攔下。
    await act(async () => {
      confirm.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      confirm.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    // 只送出一次 POST
    expect(prioritizeSpy).toHaveBeenCalledTimes(1);
    // 收尾：放行 POST，避免懸掛 promise
    await act(async () => { resolvePost({ ifc_ready_job_id: "ifcready_queued", status: "queued_for_conversion", queue_position: 1 }); await Promise.resolve(); });
  });

  // finding #2：action 錯誤應為獨立 state（actionErr）顯示在 dialog 內，不與 load 的 err 共用。
  // POST 失敗後不關 dialog；接著按 "Refresh queue"（load() → setErr(null)）不得清掉 dialog 內的 action 錯誤。
  it("POST 失敗後按 Refresh queue → dialog 內 action 錯誤不被 load 的 setErr(null) 清掉", async () => {
    vi.spyOn(coordinatorClient, "listIfcReady").mockResolvedValue({ count: 1, items: [failedJob] });
    vi.spyOn(coordinatorClient, "minioWatchStatus").mockResolvedValue({ enabled: false });
    vi.spyOn(coordinatorClient, "conversionRetry").mockRejectedValue(new Error("/api/conversion/jobs/ifcready_failed/retry -> 422"));
    const root = createRoot(container);
    await act(async () => { root.render(<ConversionSchedulingPage />); });
    await act(async () => { await Promise.resolve(); });

    const retryBtn = container.querySelector('[data-testid="conv-retry-ifcready_failed"]') as HTMLButtonElement;
    await act(async () => { retryBtn.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    const confirm = container.querySelector('[data-testid="intent-confirm"]') as HTMLButtonElement;
    await act(async () => { confirm.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    await act(async () => { await Promise.resolve(); });

    // action 錯誤顯示在 dialog 內部
    const dialog = container.querySelector('[data-testid="intent-dialog"]')!;
    expect(dialog).not.toBeNull();
    const actionErrNode = dialog.querySelector('[data-testid="intent-action-error"]');
    expect(actionErrNode).not.toBeNull();
    expect(actionErrNode!.textContent).toContain("控制動作失敗");

    // 按 Refresh queue → 觸發 load()（其第一行 setErr(null)）
    const refreshBtn = Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.includes("Refresh queue") || b.textContent?.includes("讀取中"))! as HTMLButtonElement;
    expect(refreshBtn).toBeTruthy();
    await act(async () => { refreshBtn.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    await act(async () => { await Promise.resolve(); });

    // dialog 仍開、action 錯誤仍在（load 的 setErr(null) 不影響獨立的 actionErr）
    expect(container.querySelector('[data-testid="intent-dialog"]')).not.toBeNull();
    const stillThere = container.querySelector('[data-testid="intent-action-error"]');
    expect(stillThere).not.toBeNull();
    expect(stillThere!.textContent).toContain("控制動作失敗");
  });
});
