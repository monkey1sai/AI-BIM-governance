import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { coordinatorClient, type LineageConversionReport, type MinioObject } from "../coordinatorClient";
import { LINEAGE_REPORT as REPORT, LINEAGE_REPORT_NOT_PRODUCED as OLDER } from "../__testdata__/lineageReports";
import { AlignmentResultSection, type ResultProgressChange } from "./AlignmentResultSection";

const object: MinioObject = {
  key: "899/main/p1/model.ifc", etag: "etag-ifc", role: "source_ifc",
  project_id: "project_1", project_display_name: "P1", category: "main", version: "p1", idempotency_key: "mw_0123456789abcdef",
};

describe("AlignmentResultSection（第③步：對齊結果）", () => {
  let node: HTMLDivElement;
  let root: Root;
  let progress: ResultProgressChange[];
  beforeEach(() => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    node = document.createElement("div");
    document.body.appendChild(node);
    root = createRoot(node);
    progress = [];
    vi.spyOn(coordinatorClient, "lookupLineageSourceBundles").mockResolvedValue({ items: [], unindexed_bundle_count: 0 });
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    node.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const render = async (props: Partial<Parameters<typeof AlignmentResultSection>[0]> = {}) => {
    await act(async () => root.render(
      <AlignmentResultSection
        object={object}
        bucket="bim-control"
        onProgress={(change) => progress.push(change)}
        {...props}
      />,
    ));
  };
  const flush = async () => {
    for (let tick = 0; tick < 5; tick += 1) await act(async () => { await Promise.resolve(); });
  };
  const byTestId = (id: string) => node.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  const last = () => progress[progress.length - 1];

  it("顯示此 IFC 最新一次轉檔的結果", async () => {
    const list = vi.spyOn(coordinatorClient, "listLineageConversionReports")
      .mockResolvedValue({ count: 2, items: [REPORT, OLDER] });
    await render();
    expect(list).toHaveBeenCalledWith({ sourceIfcKey: object.key, limit: 200 });
    expect(byTestId("md-step-result")?.textContent).toContain("③");
    expect(byTestId("lineage-result-attempt")?.textContent).toContain("已產出");
    expect(byTestId("lineage-kpi-rvt_ifc_usdc_lineage_ratio")?.textContent).toContain("98.54%");
    expect(last()).toEqual({ progress: "generated" });
  });

  it("指定的轉檔優先顯示並註明是較早的一次，可切換到其他次轉檔", async () => {
    vi.spyOn(coordinatorClient, "listLineageConversionReports").mockResolvedValue({ count: 2, items: [REPORT, OLDER] });
    await render({ preferredConversionId: "stream_conv_0" });
    expect(byTestId("lineage-report-status")?.textContent).toContain("report_not_produced");
    expect(byTestId("lineage-viewing-older")?.textContent).toContain("已產出");
    // 頂端步驟跟著模型的最新一次，不跟著目前檢視的較早結果。
    expect(last()).toEqual({ progress: "generated" });

    const select = byTestId("lineage-attempt-select") as HTMLSelectElement;
    expect([...select.options].map((option) => option.value)).toEqual(["stream_conv_1", "stream_conv_0"]);
    expect(select.value).toBe("stream_conv_0");
    await act(async () => {
      select.value = "stream_conv_1";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(byTestId("lineage-kpi-rvt_ifc_usdc_lineage_ratio")).not.toBeNull();
    expect(byTestId("lineage-viewing-older")).toBeNull();
    expect(last()).toEqual({ progress: "generated" });
  });

  it("最新一次沒有可用報表時，頂端步驟提醒，即使正在看較早的結果", async () => {
    const newest = { ...OLDER, conversion_job_id: "stream_conv_9" };
    vi.spyOn(coordinatorClient, "listLineageConversionReports").mockResolvedValue({ count: 2, items: [newest, REPORT] });
    await render({ preferredConversionId: "stream_conv_1" });
    expect(byTestId("lineage-kpi-rvt_ifc_usdc_lineage_ratio")).not.toBeNull();
    expect(last()).toEqual({ progress: "problem", label: "未產出報表" });
  });

  it("只有一次轉檔時不顯示切換選單", async () => {
    vi.spyOn(coordinatorClient, "listLineageConversionReports").mockResolvedValue({ count: 1, items: [REPORT] });
    await render();
    expect(byTestId("lineage-attempt-select")).toBeNull();
  });

  it("指定的轉檔不在清單時說明，改顯示最新一次", async () => {
    vi.spyOn(coordinatorClient, "listLineageConversionReports").mockResolvedValue({ count: 2, items: [REPORT, OLDER] });
    await render({ preferredConversionId: "stream_conv_missing" });
    expect(byTestId("lineage-preferred-missing")?.textContent).toContain("stream_conv_missing");
    expect(byTestId("lineage-preferred-missing")?.textContent).toContain("最近 2 次");
    expect(byTestId("lineage-kpi-rvt_ifc_usdc_lineage_ratio")).not.toBeNull();
  });

  it("還沒有任何報表時說明轉檔後會產生", async () => {
    vi.spyOn(coordinatorClient, "listLineageConversionReports").mockResolvedValue({ count: 0, items: [] });
    await render();
    expect(byTestId("lineage-conversion-none")?.textContent).toContain("轉檔");
    expect(last()).toEqual({ progress: "none" });
  });

  it("最新轉檔已完成但報表還沒出現時顯示整理中，並自動重讀", async () => {
    vi.useFakeTimers();
    const fresh: LineageConversionReport = { ...REPORT, conversion_job_id: "stream_conv_2" };
    const list = vi.spyOn(coordinatorClient, "listLineageConversionReports")
      .mockResolvedValueOnce({ count: 1, items: [REPORT] })
      .mockResolvedValue({ count: 2, items: [fresh, REPORT] });
    await render({ latestReadyConversionId: "stream_conv_2", latestReadyAt: new Date().toISOString() });
    await flush();
    expect(byTestId("lineage-result-pending")).not.toBeNull();
    expect(last()).toEqual({ progress: "pending" });

    await act(async () => { vi.advanceTimersByTime(5000); });
    await flush();
    expect(list).toHaveBeenCalledTimes(2);
    expect(byTestId("lineage-result-pending")).toBeNull();
    expect((byTestId("lineage-attempt-select") as HTMLSelectElement).value).toBe("stream_conv_2");
    expect(last()).toEqual({ progress: "generated" });
  });

  it("最新轉檔一直沒有報表時只等一段時間，之後說明沒有收到報表，可再檢查", async () => {
    vi.useFakeTimers();
    const list = vi.spyOn(coordinatorClient, "listLineageConversionReports").mockResolvedValue({ count: 1, items: [REPORT] });
    await render({ latestReadyConversionId: "stream_conv_2", latestReadyAt: new Date().toISOString() });
    await flush();
    expect(byTestId("lineage-result-pending")).not.toBeNull();
    for (let poll = 0; poll < 24; poll += 1) {
      await act(async () => { vi.advanceTimersByTime(5000); });
      await flush();
    }
    expect(list).toHaveBeenCalledTimes(25);
    expect(byTestId("lineage-result-pending")).toBeNull();
    expect(byTestId("lineage-result-missing")?.textContent).toContain("stream_conv_2");
    expect(last()).toEqual({ progress: "problem", label: "未收到報表" });

    await act(async () => { vi.advanceTimersByTime(60_000); });
    await flush();
    expect(list).toHaveBeenCalledTimes(25);

    await act(async () => byTestId("lineage-result-recheck")!.click());
    await flush();
    expect(list).toHaveBeenCalledTimes(26);
    expect(byTestId("lineage-result-pending")).not.toBeNull();
  });

  it("最新轉檔早就完成仍沒有報表時，不再等待", async () => {
    vi.useFakeTimers();
    const list = vi.spyOn(coordinatorClient, "listLineageConversionReports").mockResolvedValue({ count: 1, items: [REPORT] });
    await render({ latestReadyConversionId: "stream_conv_2", latestReadyAt: new Date(Date.now() - 60 * 60 * 1000).toISOString() });
    await flush();
    expect(byTestId("lineage-result-pending")).toBeNull();
    expect(byTestId("lineage-result-missing")?.textContent).toContain("較早一次");
    await act(async () => { vi.advanceTimersByTime(10_000); });
    await flush();
    expect(list).toHaveBeenCalledTimes(1);
  });

  it("整理中重讀失敗時提示，並保留上次的結果", async () => {
    vi.useFakeTimers();
    vi.spyOn(coordinatorClient, "listLineageConversionReports")
      .mockResolvedValueOnce({ count: 1, items: [REPORT] })
      .mockRejectedValueOnce(new Error("coordinator -> 503"))
      .mockResolvedValue({ count: 1, items: [REPORT] });
    await render({ latestReadyConversionId: "stream_conv_2", latestReadyAt: new Date().toISOString() });
    await flush();
    await act(async () => { vi.advanceTimersByTime(5000); });
    await flush();
    expect(byTestId("lineage-refresh-error")).not.toBeNull();
    expect(byTestId("lineage-kpi-rvt_ifc_usdc_lineage_ratio")).not.toBeNull();
    await act(async () => { vi.advanceTimersByTime(5000); });
    await flush();
    expect(byTestId("lineage-refresh-error")).toBeNull();
  });

  it("報表清單讀取失敗時可重試", async () => {
    const list = vi.spyOn(coordinatorClient, "listLineageConversionReports")
      .mockRejectedValueOnce(new Error("coordinator -> 503"))
      .mockResolvedValue({ count: 1, items: [REPORT] });
    await render();
    expect(byTestId("lineage-conversion-error")).not.toBeNull();
    expect(last()).toEqual({ progress: "error" });
    await act(async () => byTestId("lineage-conversion-retry")?.click());
    expect(list).toHaveBeenCalledTimes(2);
    expect(byTestId("lineage-kpi-rvt_ifc_usdc_lineage_ratio")).not.toBeNull();
  });

  it("報表對應較早版本的 IFC 時提醒；沒有 ETag 時不提醒", async () => {
    vi.spyOn(coordinatorClient, "listLineageConversionReports").mockResolvedValue({ count: 1, items: [REPORT] });
    await render({ object: { ...object, etag: "\"newer\"" } });
    expect(byTestId("lineage-conversion-stale")).not.toBeNull();

    await act(async () => root.unmount());
    root = createRoot(node);
    vi.spyOn(coordinatorClient, "listLineageConversionReports").mockResolvedValue({
      count: 1, items: [{ ...REPORT, source_ifc: { ...REPORT.source_ifc, etag: null } }],
    });
    await render({ object: { ...object, etag: "\"newer\"" } });
    expect(byTestId("lineage-kpi-rvt_ifc_usdc_lineage_ratio")).not.toBeNull();
    expect(byTestId("lineage-conversion-stale")).toBeNull();
  });

  it("governed bundle 反查收在預設收合的進階區", async () => {
    vi.spyOn(coordinatorClient, "listLineageConversionReports").mockResolvedValue({ count: 1, items: [REPORT] });
    const lookup = vi.spyOn(coordinatorClient, "lookupLineageSourceBundles").mockResolvedValue({ items: [], unindexed_bundle_count: 0 });
    await render();
    expect(lookup).toHaveBeenCalledWith("bim-control", object.key, object.etag);
    const details = byTestId("lineage-summary-none")?.closest("details");
    expect(details).not.toBeNull();
    expect(details?.open).toBe(false);
  });
});
