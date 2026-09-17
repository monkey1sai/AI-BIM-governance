import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CoordinatorHttpError,
  coordinatorClient,
  type LineageConversionReport,
  type LineageConversionReportDifferences,
} from "../coordinatorClient";
import {
  LINEAGE_REPORT as REPORT,
  LINEAGE_REPORT_NOT_PRODUCED as NOT_PRODUCED,
  lineageDifferencePage as page,
} from "../__testdata__/lineageReports";
import { LineageResultView } from "./LineageResultView";

describe("LineageResultView", () => {
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
    vi.restoreAllMocks();
  });

  const render = async (report: LineageConversionReport = REPORT) => {
    await act(async () => root.render(<LineageResultView report={report} />));
  };
  const byTestId = (id: string) => node.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  const click = async (element: Element | null) => {
    expect(element).not.toBeNull();
    await act(async () => (element as HTMLElement).click());
  };
  const card = (key: string) => byTestId(`lineage-kpi-${key}`);

  it("三張比率卡各用一句話說明結果", async () => {
    await render();
    const lineage = card("rvt_ifc_usdc_lineage_ratio")?.textContent ?? "";
    expect(lineage).toContain("98.54%");
    expect(lineage).toContain("6134 筆 Revit 元件中，6045 筆可一路追到 USDC");
    expect(card("rvt_ifc_alignment_ratio")?.textContent).toContain("6134 筆 Revit 元件中，1 筆在 IFC 找不到");
    expect(card("ifc_usdc_coverage_ratio")?.textContent).toContain("6816 個 IFC 元件中，96 個在 USDC 沒有對應");
  });

  it("全部對得上時改用正面說法", async () => {
    await render({
      ...REPORT,
      counts: { ...REPORT.counts!, csv_only_count: 0, ifc_usdc_unmapped_count: 0 },
    });
    expect(card("rvt_ifc_alignment_ratio")?.textContent).toContain("6134 筆 Revit 元件都在 IFC 找得到");
    expect(card("ifc_usdc_coverage_ratio")?.textContent).toContain("6816 個 IFC 元件都在 USDC 找得到");
  });

  it("沒點卡片前不載入明細；點卡片載入對應清單", async () => {
    const differences = vi
      .spyOn(coordinatorClient, "listLineageConversionReportDifferences")
      .mockImplementation(async (_id, set) => page(set, [{ rvt_element_id: "R-1", reason_code: "ifc_product_not_found" }]));
    await render();
    expect(differences).not.toHaveBeenCalled();
    expect(byTestId("lineage-diff-hint")).not.toBeNull();

    await click(card("rvt_ifc_alignment_ratio"));
    expect(differences).toHaveBeenLastCalledWith("stream_conv_1", "csv_only", { offset: 0, limit: 100 });
    expect(card("rvt_ifc_alignment_ratio")?.getAttribute("aria-pressed")).toBe("true");
    expect(byTestId("lineage-diff-title")?.textContent).toBe("IFC 找不到的 Revit 元件");
    expect(byTestId("lineage-diff-table")?.textContent).toContain("IFC 沒有這個 GUID 的產品");
    expect(byTestId("lineage-diff-hint")).toBeNull();

    await click(card("ifc_usdc_coverage_ratio"));
    expect(differences).toHaveBeenLastCalledWith("stream_conv_1", "ifc_usdc_unmapped", { offset: 0, limit: 100 });
    expect(card("rvt_ifc_alignment_ratio")?.getAttribute("aria-pressed")).toBe("false");

    await click(card("rvt_ifc_usdc_lineage_ratio"));
    expect(differences).toHaveBeenLastCalledWith("stream_conv_1", "full_lineage_matched", { offset: 0, limit: 100 });

    await click(card("rvt_ifc_usdc_lineage_ratio"));
    expect(byTestId("lineage-diff-table")).toBeNull();
    expect(byTestId("lineage-diff-hint")).not.toBeNull();
  });

  it("其他差異只列出數量不為零的類別，可翻頁並展開明細", async () => {
    const rows = Array.from({ length: 100 }, (_, n) => ({
      ifc_global_id22: `0F3WqC2mf928Sb1IC38G${String(n).padStart(2, "0")}`,
      ifc_uuid36: "0f0e0d0c-0b0a-4908-8725-05230321011f",
      ifc_class: "IfcDoor",
    }));
    const differences = vi
      .spyOn(coordinatorClient, "listLineageConversionReportDifferences")
      .mockImplementation(async (_id, set, { offset }) => page(set, offset === 0 ? rows : rows.slice(0, 3), offset, 103));
    await render();

    const others = [...node.querySelectorAll("[data-set]")].map((element) => element.getAttribute("data-set"));
    expect(others).toEqual(["ifc_only", "invalid_rows", "duplicate_rvt_ids"]);
    expect(node.querySelector('[data-set="ifc_only"]')?.textContent).toContain("683");

    await click(node.querySelector('[data-set="ifc_only"]'));
    expect(differences).toHaveBeenLastCalledWith("stream_conv_1", "ifc_only", { offset: 0, limit: 100 });
    expect(byTestId("lineage-diff-title")?.textContent).toBe("只在 IFC（schedule 沒列到）");
    expect(node.querySelectorAll('[data-testid="lineage-diff-row"]')).toHaveLength(100);
    expect(byTestId("lineage-diff-range")?.textContent).toContain("1–100 / 103");

    await click(byTestId("lineage-diff-next"));
    expect(differences).toHaveBeenLastCalledWith("stream_conv_1", "ifc_only", { offset: 100, limit: 100 });
    expect(byTestId("lineage-diff-range")?.textContent).toContain("101–103 / 103");
    expect(byTestId("lineage-diff-next")).toHaveProperty("disabled", true);

    await click(node.querySelectorAll('[data-testid="lineage-diff-view"]')[1]);
    expect(byTestId("lineage-diff-detail")?.textContent).toContain("0F3WqC2mf928Sb1IC38G01");
  });

  const IFC_ONLY_ROWS = ["A", "B", "C"].map((id) => ({
    ifc_global_id22: `0F3WqC2mf928Sb1IC38G${id}${id}`,
    ifc_class: "IfcWall",
    ifc_uuid36: "0f0e0d0c-0b0a-4908-8725-05230321011f",
    usd_prim_path: `/World/Elements/IfcWall/G_0F3WqC2mf928Sb1IC38G${id}${id}`,
  }));

  const openIfcOnly = async () => {
    vi.spyOn(coordinatorClient, "listLineageConversionReportDifferences").mockResolvedValue(page("ifc_only", IFC_ONLY_ROWS));
    await render();
    await click(node.querySelector('[data-set="ifc_only"]'));
  };

  it("明細在所選列正下方展開，再按一次收合", async () => {
    await openIfcOnly();
    const views = node.querySelectorAll<HTMLButtonElement>('[data-testid="lineage-diff-view"]');
    const rows = () => node.querySelectorAll('[data-testid="lineage-diff-row"]');

    await click(views[1]);
    const detailRow = byTestId("lineage-diff-detail")?.closest("tr");
    expect(detailRow?.previousElementSibling).toBe(rows()[1]);
    expect(detailRow?.textContent).toContain("G_0F3WqC2mf928Sb1IC38GBB");
    expect(views[1].getAttribute("aria-expanded")).toBe("true");
    expect(views[1].getAttribute("aria-controls")).toBe(detailRow?.id);
    expect(views[0].getAttribute("aria-expanded")).toBe("false");

    await click(views[1]);
    expect(byTestId("lineage-diff-detail")).toBeNull();

    await click(views[2]);
    expect(byTestId("lineage-diff-detail")?.closest("tr")?.previousElementSibling).toBe(rows()[2]);
    expect(node.querySelectorAll('[data-testid="lineage-diff-detail"]')).toHaveLength(1);
  });

  it("長路徑只在斜線後提供斷行點，文字內容不變", async () => {
    await openIfcOnly();
    const cells = node.querySelectorAll('[data-testid="lineage-diff-row"]')[0]!.querySelectorAll("td");
    expect(cells[3]!.textContent).toBe("/World/Elements/IfcWall/G_0F3WqC2mf928Sb1IC38GAA");
    expect(cells[3]!.querySelectorAll("wbr")).toHaveLength(4);
    expect(cells[0]!.querySelectorAll("wbr")).toHaveLength(0);
  });

  it("翻頁載入中仍保留分頁按鈕（避免鍵盤焦點掉回頁首）", async () => {
    const rows = Array.from({ length: 100 }, (_, n) => ({ rvt_element_id: `R-${n}` }));
    vi.spyOn(coordinatorClient, "listLineageConversionReportDifferences").mockImplementation(
      async (_id, set, { offset }) =>
        offset === 0 ? page(set, rows, 0, 150) : new Promise<LineageConversionReportDifferences>(() => {}),
    );
    await render();
    await click(card("rvt_ifc_alignment_ratio"));
    await click(byTestId("lineage-diff-next"));
    expect(node.querySelector('[role="status"]')).not.toBeNull();
    expect(byTestId("lineage-diff-next")).toHaveProperty("disabled", true);
    expect(byTestId("lineage-diff-prev")).not.toBeNull();
  });

  it("報表太大無法線上瀏覽時，引導改下載 CSV", async () => {
    vi.spyOn(coordinatorClient, "listLineageConversionReportDifferences").mockRejectedValue(
      new CoordinatorHttpError("/api/lineage/conversion-reports/stream_conv_1/differences", 413, "lineage_report_too_large", "lineage_report_too_large"),
    );
    await render();
    await click(card("ifc_usdc_coverage_ratio"));
    expect(byTestId("lineage-diff-too-large")?.textContent).toContain("CSV");
    expect(byTestId("lineage-diff-error")).toBeNull();
  });

  it("明細讀取失敗可重試", async () => {
    const differences = vi
      .spyOn(coordinatorClient, "listLineageConversionReportDifferences")
      .mockRejectedValueOnce(new Error("coordinator -> 502"))
      .mockResolvedValue(page("csv_only", [{ rvt_element_id: "R-9" }]));
    await render();
    await click(card("rvt_ifc_alignment_ratio"));
    expect(byTestId("lineage-diff-error")).not.toBeNull();
    await click(byTestId("lineage-diff-retry"));
    expect(differences).toHaveBeenCalledTimes(2);
    expect(byTestId("lineage-diff-table")?.textContent).toContain("R-9");
  });

  it("提供 JSON 與 CSV 下載", async () => {
    vi.spyOn(coordinatorClient, "lineageConversionReportFileUrl").mockImplementation(
      (id, name) => `http://coordinator.test/api/lineage/conversion-reports/${id}/files/${name}`,
    );
    await render();
    const csv = node.querySelector<HTMLAnchorElement>('[data-testid="lineage-download-alignment_report.csv"]');
    expect(csv?.href).toBe("http://coordinator.test/api/lineage/conversion-reports/stream_conv_1/files/alignment_report.csv");
    expect(csv?.hasAttribute("download")).toBe(true);
    expect(byTestId("lineage-download-alignment_report.json")).not.toBeNull();
  });

  it("計數、警告、來源、MinIO 與稽核收在預設收合的技術細節裡", async () => {
    await render();
    const details = byTestId("lineage-tech-details") as HTMLDetailsElement | null;
    expect(details?.tagName).toBe("DETAILS");
    expect(details?.open).toBe(false);
    expect(byTestId("lineage-counts")?.closest("details")).toBe(details);
    expect(byTestId("lineage-counts")?.textContent).toContain("683");
    expect(byTestId("lineage-warnings")?.textContent).toContain("SCHEDULE_IFCGUID_GLOBALID22_FORMAT");
    expect(byTestId("lineage-schedule")?.textContent).toContain("899/main/p1/schedule.csv");
    expect(byTestId("lineage-upload")?.textContent).toContain("沒有寫入權限");
    const sources = byTestId("lineage-sources")?.textContent ?? "";
    expect(sources).toContain("etag-ifc");
    expect(sources).toContain("d".repeat(64));
    expect(sources).toContain("899/main/p1/lineage-reports/stream_conv_1/alignment_report.csv");
    expect(byTestId("lineage-audit")?.textContent).toContain("NOT_BUILT");
  });

  it("沒有產出報表時說明原因，不顯示比率也不發明細請求", async () => {
    const differences = vi.spyOn(coordinatorClient, "listLineageConversionReportDifferences");
    await render(NOT_PRODUCED);
    expect(byTestId("lineage-report-status")?.textContent).toContain("report_not_produced");
    expect(byTestId("lineage-report-status")?.textContent).toContain("重新轉檔");
    expect(card("rvt_ifc_usdc_lineage_ratio")).toBeNull();
    expect(node.querySelector("[data-set]")).toBeNull();
    expect(byTestId("lineage-diff-hint")).toBeNull();
    expect(differences).not.toHaveBeenCalled();
  });
});
