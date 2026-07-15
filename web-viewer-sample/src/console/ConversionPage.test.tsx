import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { coordinatorClient, type IfcReadyListItem } from "./coordinatorClient";
import { SharedStatusContext, EMPTY_SHARED_STATUS } from "./useSharedStatus";
import { ConversionPage } from "./ConversionPage";

const queuedJob = {
  ifc_ready_job_id: "ifcready_1",
  idempotency_key: "idem_1",
  idempotent_replay: false,
  status: "queued_for_conversion",
  project_id: "project_1",
  project_display_name: "圖書館",
  category: "architecture",
  external_model_version_id: "version_1",
  download_status: "succeeded",
  conversion_status: "queued",
  conversion_authority: "bim-streaming-server",
  queue_position: 2,
  conversion_job_id: "stream_conv_1",
  dispatch_error: null,
  review_session_id: null,
  viewer_url: null,
  expected_stage_url: null,
  expected_mapping_url: null,
  updated_at: "2026-07-15T00:00:00.000Z",
} as IfcReadyListItem;

describe("ConversionPage", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers();
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    vi.spyOn(coordinatorClient, "minioWatchStatus").mockResolvedValue({ enabled: false });
    vi.spyOn(coordinatorClient, "getConversionRecords").mockResolvedValue({ count: 0, items: [] });
    vi.spyOn(coordinatorClient, "getConversionsHistory").mockResolvedValue({
      count: 1,
      items: [{ conversion_job_id: "stream_conv_1", status: "queued", source_ifc_filename: "library.ifc" }],
    });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("保留 #conv 為獨立既有-job 頁，5 秒輪詢佇列且不提供 manual trigger", async () => {
    const list = vi.spyOn(coordinatorClient, "listIfcReady").mockResolvedValue({ count: 1, items: [queuedJob] });
    await act(async () => {
      root.render(
        <SharedStatusContext.Provider value={EMPTY_SHARED_STATUS}>
          <ConversionPage />
        </SharedStatusContext.Provider>,
      );
      await Promise.resolve();
    });

    expect(container.querySelector('[data-testid="conv-page"]')).not.toBeNull();
    expect(container.textContent).toContain("IFC→USD 轉檔歷史");
    expect(container.textContent).toContain("ifcready_1");
    expect(container.textContent).toContain("未取得 · idle");
    expect(container.textContent).toContain("adapter_from_env 未配 · idle");
    expect(container.textContent).toContain("自動偵測已關閉");
    expect(container.querySelector('[data-testid="conv-coverage-selfref-note"]')).not.toBeNull();
    expect(container.textContent).toContain("usd_stage_enumeration · 自我參照");
    expect(container.textContent).toContain("只對既有 ifc-ready job 排序／重試，不觸發新轉檔");
    expect(container.textContent).toContain("dispatch");
    expect(container.textContent).toContain("queued_for_conversion");
    expect(container.textContent).not.toContain("已接受");
    expect(container.textContent).toContain("session");
    expect(container.textContent).toContain("stage URL");
    expect(container.textContent).not.toContain("觸發轉檔");
    expect(container.textContent).not.toContain("POST /api/conversion/trigger");
    expect(list).toHaveBeenCalledTimes(1);

    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(list).toHaveBeenCalledTimes(2);
  });

  it("輪詢失敗保留上一輪 queue，並顯示可重試錯誤", async () => {
    vi.spyOn(coordinatorClient, "listIfcReady")
      .mockResolvedValueOnce({ count: 1, items: [queuedJob] })
      .mockRejectedValueOnce(new Error("offline"));
    await act(async () => {
      root.render(<ConversionPage />);
      await Promise.resolve();
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });

    expect(container.textContent).toContain("ifcready_1");
    expect(container.textContent).toContain("offline");
    expect(container.querySelector('[data-testid="conv-refresh"]')).not.toBeNull();
  });
});
