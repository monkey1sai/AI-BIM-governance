import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CoordinatorHttpError, coordinatorClient, type LineageConversionReport, type MinioFolderListing } from "../coordinatorClient";
import { parseHandoff } from "../handoff";
import { LINEAGE_REPORT as REPORT } from "../__testdata__/lineageReports";
import { LineageReportPage } from "./LineageReportPage";

/**
 * The report now lives in the model library (`#minio`, step ③). `#lineage` stays so old
 * bookmarks keep working: it forwards to the model the report belongs to.
 */
describe("LineageReportPage（舊連結轉到模型庫）", () => {
  let node: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    node = document.createElement("div");
    document.body.appendChild(node);
    root = createRoot(node);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    node.remove();
    window.location.hash = "";
    vi.restoreAllMocks();
  });

  const render = async (hash: string) => {
    window.location.hash = hash;
    await act(async () => root.render(<LineageReportPage />));
  };
  const byTestId = (id: string) => node.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  const folderWith = (...keys: string[]): MinioFolderListing => ({
    bucket: "bim-control",
    prefix: "899/main/p1/",
    folders: [],
    objects: keys.map((key) => ({
      key, etag: "etag-ifc", role: "source_ifc" as const, project_id: "p1", project_display_name: "P1",
      category: "main", version: "p1", idempotency_key: "mw_0123456789abcdef",
    })),
    count: keys.length,
  });
  const flush = async () => {
    for (let tick = 0; tick < 10; tick += 1) await act(async () => { await Promise.resolve(); });
  };
  const waitForHash = async (predicate: (hash: string) => boolean) => {
    for (let tick = 0; tick < 40; tick += 1) {
      if (predicate(window.location.hash)) return;
      await act(async () => { await Promise.resolve(); });
    }
    throw new Error(`hash did not change: ${window.location.hash}`);
  };

  it("沒有指定轉檔時轉到模型庫", async () => {
    await render("#lineage");
    await waitForHash((hash) => hash === "#minio");
  });

  it("#/console/lineage 也轉到模型庫", async () => {
    await render("#/console/lineage");
    await waitForHash((hash) => hash === "#minio");
  });

  it("指定轉檔且模型還在時轉到該模型，並帶上要看的那次轉檔", async () => {
    const get = vi.spyOn(coordinatorClient, "getLineageConversionReport").mockResolvedValue(REPORT);
    const folder = vi.spyOn(coordinatorClient, "getMinioFolder").mockResolvedValue(folderWith("899/main/p1/model.ifc"));
    await render("#lineage?conversion_job_id=stream_conv_1");
    await waitForHash((hash) => hash.startsWith("#minio?"));
    expect(get).toHaveBeenCalledWith("stream_conv_1");
    expect(folder).toHaveBeenCalledWith("899/main/p1/");
    expect(parseHandoff(window.location.hash)).toEqual({
      source: "minio",
      minio_key: "899/main/p1/model.ifc",
      conversion_id: "stream_conv_1",
    });
  });

  it("報表不知道來源 IFC 時就地顯示結果", async () => {
    vi.spyOn(coordinatorClient, "getLineageConversionReport").mockResolvedValue({
      ...REPORT,
      source_ifc: { bucket: null, key: null, etag: null },
    });
    await render("#lineage?conversion_job_id=stream_conv_1");
    expect(window.location.hash).toBe("#lineage?conversion_job_id=stream_conv_1");
    expect(byTestId("lineage-report-unknown-source")).not.toBeNull();
    expect(byTestId("lineage-kpi-rvt_ifc_usdc_lineage_ratio")?.textContent).toContain("98.54%");
    expect(node.querySelector('a[href="#minio"]')).not.toBeNull();
  });

  it("來源 IFC 已不在模型庫時，就地顯示結果並說明原因", async () => {
    vi.spyOn(coordinatorClient, "getLineageConversionReport").mockResolvedValue(REPORT);
    vi.spyOn(coordinatorClient, "getMinioFolder").mockResolvedValue(folderWith("899/main/p1/other.ifc"));
    await render("#lineage?conversion_job_id=stream_conv_1");
    await flush();
    expect(window.location.hash).toBe("#lineage?conversion_job_id=stream_conv_1");
    expect(byTestId("lineage-report-source-missing")?.textContent).toContain("899/main/p1/model.ifc");
    expect(byTestId("lineage-kpi-rvt_ifc_usdc_lineage_ratio")).not.toBeNull();
  });

  it("來源 IFC 在不同 bucket 時也就地顯示", async () => {
    const elsewhere: LineageConversionReport = { ...REPORT, source_ifc: { ...REPORT.source_ifc, bucket: "archive" } };
    vi.spyOn(coordinatorClient, "getLineageConversionReport").mockResolvedValue(elsewhere);
    vi.spyOn(coordinatorClient, "getMinioFolder").mockResolvedValue(folderWith("899/main/p1/model.ifc"));
    await render("#lineage?conversion_job_id=stream_conv_1");
    await flush();
    expect(byTestId("lineage-report-source-missing")).not.toBeNull();
  });

  it("暫時無法確認模型庫時，就地顯示結果", async () => {
    vi.spyOn(coordinatorClient, "getLineageConversionReport").mockResolvedValue(REPORT);
    vi.spyOn(coordinatorClient, "getMinioFolder").mockRejectedValue(new Error("coordinator /api/minio/objects -> 502"));
    await render("#lineage?conversion_job_id=stream_conv_1");
    await flush();
    expect(window.location.hash).toBe("#lineage?conversion_job_id=stream_conv_1");
    expect(byTestId("lineage-report-source-unverified")).not.toBeNull();
    expect(byTestId("lineage-kpi-rvt_ifc_usdc_lineage_ratio")).not.toBeNull();
  });

  it("讀取期間使用者已離開時不改網址", async () => {
    let finish!: (value: LineageConversionReport) => void;
    vi.spyOn(coordinatorClient, "getLineageConversionReport").mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    vi.spyOn(coordinatorClient, "getMinioFolder").mockResolvedValue(folderWith("899/main/p1/model.ifc"));
    await render("#lineage?conversion_job_id=stream_conv_1");
    window.location.hash = "#home";
    await act(async () => finish(REPORT));
    await flush();
    expect(window.location.hash).toBe("#home");
  });

  it("找不到報表與讀取失敗分開呈現，失敗可重試", async () => {
    const notFound = new CoordinatorHttpError("/api/lineage/conversion-reports/stream_missing", 404, "lineage_report_not_found", "lineage_report_not_found");
    const get = vi
      .spyOn(coordinatorClient, "getLineageConversionReport")
      .mockRejectedValueOnce(notFound)
      .mockRejectedValueOnce(new Error("coordinator -> 502"))
      .mockResolvedValue(REPORT);
    vi.spyOn(coordinatorClient, "getMinioFolder").mockResolvedValue(folderWith("899/main/p1/model.ifc"));
    await render("#lineage?conversion_job_id=stream_missing");
    expect(byTestId("lineage-report-not-found")).not.toBeNull();
    expect(byTestId("lineage-report-not-found")?.querySelector('a[href="#minio"]')).not.toBeNull();

    await act(async () => {
      window.location.hash = "#lineage?conversion_job_id=stream_conv_1";
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    expect(byTestId("lineage-report-error")).not.toBeNull();
    await act(async () => byTestId("lineage-report-retry")!.click());
    expect(get).toHaveBeenCalledTimes(3);
    await waitForHash((hash) => hash.startsWith("#minio?"));
  });
});
