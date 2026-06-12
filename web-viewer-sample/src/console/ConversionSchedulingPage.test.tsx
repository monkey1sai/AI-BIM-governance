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
