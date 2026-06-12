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
});
