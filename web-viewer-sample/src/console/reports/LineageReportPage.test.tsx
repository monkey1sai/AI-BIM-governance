import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CoordinatorHttpError,
  coordinatorClient,
  type LineageConversionReport,
  type LineageConversionReportDifferences,
} from "../coordinatorClient";
import { LineageReportPage } from "./LineageReportPage";

const metric = (numerator: number, denominator: number, scope: "eligible_ifc_product_count" | "csv_valid_count") => ({
  numerator,
  denominator,
  ratio: denominator === 0 ? null : Math.trunc((numerator / denominator) * 1e10) / 1e10,
  status: denominator === 0 ? "not_evaluable" as const : numerator === denominator ? "complete" as const : "partial" as const,
  denominator_scope: scope,
});

const REPORT: LineageConversionReport = {
  conversion_job_id: "stream_conv_1",
  ifc_ready_job_id: "ifcready_1",
  source_model_id: "mw_0123456789abcdef",
  project_id: "project_1",
  external_model_version_id: "ext_1",
  source_ifc: { bucket: "bim-control", key: "899/main/p1/model.ifc", etag: "etag-ifc" },
  schedule: { key: "899/main/p1/schedule.csv", etag: "etag-s", sha256: "b".repeat(64), size_bytes: 2048, used: true },
  status: "generated",
  error_code: null,
  report_generated_at: "2026-09-16T12:00:00.000000Z",
  conversion_created_at: "2026-09-16T11:00:00.000Z",
  recorded_at: "2026-09-16T12:01:00.000Z",
  metrics: {
    ifc_usdc_coverage_ratio: metric(6720, 6816, "eligible_ifc_product_count"),
    rvt_ifc_alignment_ratio: metric(6133, 6134, "csv_valid_count"),
    rvt_ifc_usdc_lineage_ratio: metric(6045, 6134, "csv_valid_count"),
  },
  counts: {
    csv_total_count: 6140,
    csv_valid_count: 6134,
    eligible_ifc_product_count: 6816,
    duplicate_rvt_id_count: 1,
    duplicate_ifc_guid_count: 0,
    invalid_row_count: 6,
    csv_only_count: 1,
    ifc_only_count: 683,
    ifc_usdc_unmapped_count: 96,
    full_lineage_matched_count: 6045,
  },
  warning_codes: ["IFC_USDC_UNMAPPED", "SCHEDULE_IFCGUID_GLOBALID22_FORMAT"],
  files: {
    "alignment_report.json": { sha256: "c".repeat(64), size_bytes: 1_759_277 },
    "alignment_report.csv": { sha256: "d".repeat(64), size_bytes: 1_198_585 },
  },
  minio_upload: {
    status: "denied",
    bucket: "bim-control",
    keys: {
      "alignment_report.json": "899/main/p1/lineage-reports/stream_conv_1/alignment_report.json",
      "alignment_report.csv": "899/main/p1/lineage-reports/stream_conv_1/alignment_report.csv",
    },
    reason: "minio_write_denied",
    attempted_at: "2026-09-16T12:01:00.000Z",
  },
};

const OLDER: LineageConversionReport = {
  ...REPORT,
  conversion_job_id: "stream_conv_0",
  ifc_ready_job_id: "ifcready_0",
  status: "not_produced",
  error_code: "report_not_produced",
  metrics: null,
  counts: null,
  warning_codes: [],
  conversion_created_at: "2026-09-15T08:00:00.000Z",
  files: { "alignment_report.json": null, "alignment_report.csv": null },
  minio_upload: { ...REPORT.minio_upload, status: "skipped", reason: "report_not_generated" },
};

const page = (
  set: LineageConversionReportDifferences["set"],
  items: Array<Record<string, unknown>>,
  offset = 0,
  total = items.length,
): LineageConversionReportDifferences => ({
  conversion_job_id: "stream_conv_1",
  set,
  total,
  authoritative_count: total,
  offset,
  limit: 100,
  items,
});

describe("LineageReportPage", () => {
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
  const click = async (element: Element | null) => {
    expect(element).not.toBeNull();
    await act(async () => (element as HTMLElement).click());
  };
  const tab = (name: string) => node.querySelector(`[role="tab"][data-tab="${name}"]`);

  it("總覽顯示三個比率、計數、警告、schedule 與 MinIO 上傳結果", async () => {
    const get = vi.spyOn(coordinatorClient, "getLineageConversionReport").mockResolvedValue(REPORT);
    await render("#lineage?conversion_job_id=stream_conv_1");

    expect(get).toHaveBeenCalledWith("stream_conv_1");
    expect(byTestId("lineage-report-source")?.textContent).toContain("899/main/p1/model.ifc");
    const lineage = byTestId("lineage-kpi-rvt_ifc_usdc_lineage_ratio")?.textContent ?? "";
    expect(lineage).toContain("98.54%");
    expect(lineage).toContain("6045 / 6134");
    expect(byTestId("lineage-kpi-ifc_usdc_coverage_ratio")?.textContent).toContain("6720 / 6816");
    expect(byTestId("lineage-counts")?.textContent).toContain("683");
    expect(byTestId("lineage-warnings")?.textContent).toContain("SCHEDULE_IFCGUID_GLOBALID22_FORMAT");
    expect(byTestId("lineage-schedule")?.textContent).toContain("899/main/p1/schedule.csv");
    expect(byTestId("lineage-upload")?.textContent).toContain("沒有寫入權限");
    expect(tab("overview")?.getAttribute("aria-selected")).toBe("true");
  });

  it("對齊差異分頁：切換集合、翻頁並檢視單列明細", async () => {
    vi.spyOn(coordinatorClient, "getLineageConversionReport").mockResolvedValue(REPORT);
    const rows = Array.from({ length: 100 }, (_, n) => ({
      ifc_global_id22: `0F3WqC2mf928Sb1IC38G${String(n).padStart(2, "0")}`,
      ifc_uuid36: "0f0e0d0c-0b0a-4908-8725-05230321011f",
      ifc_class: "IfcDoor",
    }));
    const differences = vi
      .spyOn(coordinatorClient, "listLineageConversionReportDifferences")
      .mockImplementation(async (_id, set, { offset }) => {
        if (set === "ifc_only") return page("ifc_only", offset === 0 ? rows : rows.slice(0, 3), offset, 103);
        return page(set, [{ rvt_element_id: "R-1", ifc_uuid36_raw: "X", reason_code: "ifc_product_not_found" }]);
      });
    await render("#lineage?conversion_job_id=stream_conv_1");
    await click(tab("alignment"));

    expect(differences).toHaveBeenLastCalledWith("stream_conv_1", "csv_only", { offset: 0, limit: 100 });
    expect(byTestId("lineage-diff-table")?.textContent).toContain("R-1");

    await click(node.querySelector('[data-set="ifc_only"]'));
    expect(differences).toHaveBeenLastCalledWith("stream_conv_1", "ifc_only", { offset: 0, limit: 100 });
    expect(node.querySelector('[data-set="ifc_only"]')?.textContent).toContain("683");
    expect(node.querySelectorAll('[data-testid="lineage-diff-row"]')).toHaveLength(100);
    expect(byTestId("lineage-diff-range")?.textContent).toContain("1–100 / 103");

    await click(byTestId("lineage-diff-next"));
    expect(differences).toHaveBeenLastCalledWith("stream_conv_1", "ifc_only", { offset: 100, limit: 100 });
    expect(byTestId("lineage-diff-range")?.textContent).toContain("101–103 / 103");
    expect(byTestId("lineage-diff-next")).toHaveProperty("disabled", true);

    await click(node.querySelectorAll('[data-testid="lineage-diff-view"]')[1]);
    expect(byTestId("lineage-diff-detail")?.textContent).toContain("0F3WqC2mf928Sb1IC38G01");
  });

  it("翻頁載入中仍保留分頁按鈕（避免鍵盤焦點掉回頁首）", async () => {
    vi.spyOn(coordinatorClient, "getLineageConversionReport").mockResolvedValue(REPORT);
    const rows = Array.from({ length: 100 }, (_, n) => ({ rvt_element_id: `R-${n}` }));
    vi.spyOn(coordinatorClient, "listLineageConversionReportDifferences").mockImplementation(
      async (_id, set, { offset }) =>
        offset === 0 ? page(set, rows, 0, 150) : new Promise<LineageConversionReportDifferences>(() => {}),
    );
    await render("#lineage?conversion_job_id=stream_conv_1");
    await click(tab("alignment"));
    await click(byTestId("lineage-diff-next"));
    expect(node.querySelector('[role="status"]')).not.toBeNull();
    expect(byTestId("lineage-diff-next")).toHaveProperty("disabled", true);
    expect(byTestId("lineage-diff-prev")).not.toBeNull();
  });

  it("分頁可用方向鍵切換，只有選中的分頁在 tab 順序內", async () => {
    vi.spyOn(coordinatorClient, "getLineageConversionReport").mockResolvedValue(REPORT);
    vi.spyOn(coordinatorClient, "listLineageConversionReports").mockResolvedValue({ count: 1, items: [REPORT] });
    await render("#lineage?conversion_job_id=stream_conv_1");
    expect(tab("overview")?.getAttribute("tabindex")).toBe("0");
    expect(tab("artifacts")?.getAttribute("tabindex")).toBe("-1");
    expect(tab("overview")?.getAttribute("aria-controls")).toBe("lineage-panel-overview");
    expect(tab("artifacts")?.hasAttribute("aria-controls")).toBe(false);

    await act(async () => {
      tab("overview")!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
    });
    expect(tab("audit")?.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(tab("audit"));
    await act(async () => {
      tab("audit")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true }));
    });
    expect(tab("overview")?.getAttribute("aria-selected")).toBe("true");
  });

  it("產物分頁提供報表下載、來源 IFC、schedule 與 MinIO 位置", async () => {
    vi.spyOn(coordinatorClient, "getLineageConversionReport").mockResolvedValue(REPORT);
    vi.spyOn(coordinatorClient, "lineageConversionReportFileUrl").mockImplementation(
      (id, name) => `http://coordinator.test/api/lineage/conversion-reports/${id}/files/${name}`,
    );
    await render("#lineage?conversion_job_id=stream_conv_1");
    await click(tab("artifacts"));

    const csv = node.querySelector<HTMLAnchorElement>('[data-testid="lineage-download-alignment_report.csv"]');
    expect(csv?.href).toBe("http://coordinator.test/api/lineage/conversion-reports/stream_conv_1/files/alignment_report.csv");
    expect(csv?.hasAttribute("download")).toBe(true);
    const artifacts = byTestId("lineage-artifacts")?.textContent ?? "";
    expect(artifacts).toContain("d".repeat(64));
    expect(artifacts).toContain("etag-ifc");
    expect(artifacts).toContain("899/main/p1/lineage-reports/stream_conv_1/alignment_report.csv");
  });

  it("轉檔歷史列出同一個 IFC 的各次報表並可切換", async () => {
    vi.spyOn(coordinatorClient, "getLineageConversionReport").mockResolvedValue(REPORT);
    const list = vi
      .spyOn(coordinatorClient, "listLineageConversionReports")
      .mockResolvedValue({ count: 2, items: [REPORT, OLDER] });
    await render("#lineage?conversion_job_id=stream_conv_1");
    await click(tab("attempts"));

    expect(list).toHaveBeenCalledWith({ sourceIfcKey: "899/main/p1/model.ifc", limit: 200 });
    const rows = node.querySelectorAll('[data-testid="lineage-attempt"]');
    expect(rows).toHaveLength(2);
    expect(rows[0].getAttribute("aria-current")).toBe("true");
    expect(rows[1].textContent).toContain("未產出報表");
    expect(rows[1].querySelector("a")?.getAttribute("href")).toBe("#lineage?conversion_job_id=stream_conv_0");
  });

  it("報表太大無法線上瀏覽差異時，引導改下載 CSV", async () => {
    vi.spyOn(coordinatorClient, "getLineageConversionReport").mockResolvedValue(REPORT);
    vi.spyOn(coordinatorClient, "listLineageConversionReportDifferences").mockRejectedValue(
      new CoordinatorHttpError("/api/lineage/conversion-reports/stream_conv_1/differences", 413, "lineage_report_too_large", "lineage_report_too_large"),
    );
    await render("#lineage?conversion_job_id=stream_conv_1");
    await click(tab("alignment"));
    expect(byTestId("lineage-diff-too-large")?.textContent).toContain("CSV");
    expect(byTestId("lineage-diff-error")).toBeNull();
  });

  it("稽核分頁誠實標示尚未建置", async () => {
    vi.spyOn(coordinatorClient, "getLineageConversionReport").mockResolvedValue(REPORT);
    await render("#lineage?conversion_job_id=stream_conv_1");
    await click(tab("audit"));
    expect(byTestId("lineage-audit")?.textContent).toContain("NOT_BUILT");
  });

  it("沒有產出報表時說明原因，對齊差異不發請求", async () => {
    vi.spyOn(coordinatorClient, "getLineageConversionReport").mockResolvedValue(OLDER);
    const differences = vi.spyOn(coordinatorClient, "listLineageConversionReportDifferences");
    await render("#lineage?conversion_job_id=stream_conv_0");
    expect(byTestId("lineage-report-status")?.textContent).toContain("report_not_produced");
    expect(byTestId("lineage-kpi-rvt_ifc_usdc_lineage_ratio")).toBeNull();
    await click(tab("alignment"));
    expect(byTestId("lineage-diff-unavailable")).not.toBeNull();
    expect(differences).not.toHaveBeenCalled();
  });

  it("沒有指定轉檔時列出最近的報表", async () => {
    const list = vi
      .spyOn(coordinatorClient, "listLineageConversionReports")
      .mockResolvedValue({ count: 2, items: [REPORT, OLDER] });
    await render("#lineage");
    expect(list).toHaveBeenCalledWith({ limit: 50 });
    const links = node.querySelectorAll<HTMLAnchorElement>('[data-testid="lineage-index-item"] a');
    expect(links).toHaveLength(2);
    expect(links[0].getAttribute("href")).toBe("#lineage?conversion_job_id=stream_conv_1");
  });

  it("找不到報表與讀取失敗分開呈現，失敗可重試", async () => {
    const notFound = new CoordinatorHttpError("/api/lineage/conversion-reports/stream_missing", 404, "lineage_report_not_found", "lineage_report_not_found");
    const get = vi
      .spyOn(coordinatorClient, "getLineageConversionReport")
      .mockRejectedValueOnce(notFound)
      .mockRejectedValueOnce(new Error("coordinator -> 502"))
      .mockResolvedValue(REPORT);
    await render("#lineage?conversion_job_id=stream_missing");
    expect(byTestId("lineage-report-not-found")).not.toBeNull();

    await act(async () => {
      window.location.hash = "#lineage?conversion_job_id=stream_conv_1";
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    expect(byTestId("lineage-report-error")).not.toBeNull();
    await click(byTestId("lineage-report-retry"));
    expect(get).toHaveBeenCalledTimes(3);
    expect(byTestId("lineage-kpi-rvt_ifc_usdc_lineage_ratio")).not.toBeNull();
  });
});
