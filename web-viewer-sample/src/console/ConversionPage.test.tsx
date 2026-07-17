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
    // F2⑩：頁尾 outbox 摘要面板 mount 時抓一次；既有案例預設空摘要（不打真網路）。
    vi.spyOn(coordinatorClient, "getCallbackOutboxSummary").mockResolvedValue({ total: 0, limit: 50, entries: [] });
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
    expect(container.textContent).toContain("GPU runtime · 狀態未由 coordinator 提供；未觀測");
    expect(container.textContent).not.toContain("adapter_from_env 未配");
    expect(container.textContent).not.toContain("未取得 · idle");
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
    expect(coordinatorClient.getConversionsHistory).toHaveBeenCalledTimes(1);

    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(list).toHaveBeenCalledTimes(2);
    expect(coordinatorClient.getConversionsHistory).toHaveBeenCalledTimes(2);
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

  it("watcher 狀態未取得時顯示錯誤並禁止送出切換 intent", async () => {
    vi.mocked(coordinatorClient.minioWatchStatus).mockRejectedValueOnce(new Error("watch offline"));
    vi.spyOn(coordinatorClient, "conversionWatchToggle").mockResolvedValue({ enabled: true });
    vi.spyOn(coordinatorClient, "listIfcReady").mockResolvedValue({ count: 0, items: [] });
    await act(async () => {
      root.render(<ConversionPage />);
      await Promise.resolve();
    });

    const button = container.querySelector('[data-testid="conv-watch-unavailable"]') as HTMLButtonElement;
    expect(container.querySelector('[data-testid="conv-watch-error"]')?.textContent).toContain("watch offline");
    expect(button.disabled).toBe(true);
    await act(async () => { button.click(); });
    expect(coordinatorClient.conversionWatchToggle).not.toHaveBeenCalled();
  });

  it("手動與定時重新整理會更新 conversion history，失敗時保留上一份 snapshot", async () => {
    vi.spyOn(coordinatorClient, "listIfcReady").mockResolvedValue({ count: 0, items: [] });
    vi.mocked(coordinatorClient.getConversionsHistory)
      .mockReset()
      .mockResolvedValueOnce({
        count: 1,
        items: [{ conversion_job_id: "stream_conv_1", status: "queued", source_ifc_filename: "library.ifc" }],
      })
      .mockResolvedValueOnce({
        count: 1,
        items: [{ conversion_job_id: "stream_conv_1", status: "succeeded", source_ifc_filename: "library.ifc" }],
      })
      .mockRejectedValueOnce(new Error("history offline"));
    await act(async () => {
      root.render(<ConversionPage />);
      await Promise.resolve();
    });
    expect(container.textContent).toContain("queued");

    const refreshButton = container.querySelector('[data-testid="conv-refresh"]') as HTMLButtonElement;
    await act(async () => { refreshButton.click(); await Promise.resolve(); });
    expect(container.textContent).toContain("succeeded");

    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(container.textContent).toContain("succeeded");
    expect(container.textContent).toContain("轉檔歷史更新失敗；保留上一份結果");
  });

  // ── F2⑩：Callback Outbox 摘要面板三態（成功表格＋色碼 / 誠實失敗 / 空摘要） ──
  const outboxEntry = (overrides: Partial<import("./coordinatorClient").CallbackOutboxSummaryEntry> = {}) => ({
    outbox_id: "outbox_1",
    event: "issue_snapshot",
    status: "pending" as const,
    attempts: 1,
    max_attempts: 5,
    last_error: null,
    created_at: "2026-07-15T00:00:00.000Z",
    delivered_at: null,
    correlation_id: "review_session_x",
    conversion_job_id: null,
    ...overrides,
  });

  it("outbox 摘要成功時渲染表格（outbox_id/event/status/attempts/last_error/delivered_at）且 status 色碼 pending=琥珀/delivered=綠/dead_letter=紅", async () => {
    vi.spyOn(coordinatorClient, "listIfcReady").mockResolvedValue({ count: 0, items: [] });
    vi.mocked(coordinatorClient.getCallbackOutboxSummary).mockResolvedValue({
      total: 3,
      limit: 50,
      entries: [
        outboxEntry(),
        outboxEntry({ outbox_id: "outbox_2", event: "conversion_completed", status: "delivered", attempts: 2, delivered_at: "2026-07-15T00:01:00.000Z", conversion_job_id: "stream_conv_1" }),
        outboxEntry({ outbox_id: "outbox_3", status: "dead_letter", attempts: 5, last_error: "cloud callback base not configured" }),
      ],
    });
    await act(async () => {
      root.render(<ConversionPage />);
      await Promise.resolve();
    });

    expect(coordinatorClient.getCallbackOutboxSummary).toHaveBeenCalledWith(50);
    const panel = container.querySelector('[data-testid="conv-outbox-summary"]')!;
    expect(panel).not.toBeNull();
    expect(container.textContent).toContain("Callback Outbox 摘要");
    for (const text of ["outbox_1", "outbox_2", "outbox_3", "issue_snapshot", "conversion_completed", "1/5", "2/5", "cloud callback base not configured", "2026-07-15T00:01:00.000Z"]) {
      expect(panel.textContent).toContain(text);
    }
    // 色碼走既有 ec-status-dot data-status（legacy-console.css）：warn=琥珀 / ok=Hi-Fi 青 / bad=紅。
    expect(panel.querySelectorAll('.ec-status-dot[data-status="warn"]').length).toBe(1);
    expect(panel.querySelectorAll('.ec-status-dot[data-status="ok"]').length).toBe(1);
    expect(panel.querySelectorAll('.ec-status-dot[data-status="bad"]').length).toBe(1);
  });

  it("outbox 摘要取用失敗時誠實顯「未取得（coordinator outbox API 不可達）」，不影響其餘面板", async () => {
    vi.spyOn(coordinatorClient, "listIfcReady").mockResolvedValue({ count: 1, items: [queuedJob] });
    vi.mocked(coordinatorClient.getCallbackOutboxSummary).mockRejectedValue(new Error("coordinator /api/callback-outbox/summary -> 404 Not Found"));
    await act(async () => {
      root.render(<ConversionPage />);
      await Promise.resolve();
    });

    const panel = container.querySelector('[data-testid="conv-outbox-summary"]')!;
    expect(panel.textContent).toContain("未取得（coordinator outbox API 不可達）");
    expect(panel.textContent).toContain("404");
    expect(panel.querySelector(".ec-status-dot")).toBeNull(); // 失敗不渲染假色碼
    // 既有面板不受影響（純加性）。
    expect(container.textContent).toContain("ifcready_1");
    expect(container.textContent).toContain("IFC→USD 轉檔歷史");
  });

  it("outbox 摘要為空時誠實顯示無紀錄（total=0），不渲染空表格", async () => {
    vi.spyOn(coordinatorClient, "listIfcReady").mockResolvedValue({ count: 0, items: [] });
    await act(async () => {
      root.render(<ConversionPage />);
      await Promise.resolve();
    });

    const panel = container.querySelector('[data-testid="conv-outbox-summary"]')!;
    expect(panel.textContent).toContain("目前沒有 outbox 紀錄（total=0）");
    expect(panel.querySelector("table")).toBeNull();
  });
});
