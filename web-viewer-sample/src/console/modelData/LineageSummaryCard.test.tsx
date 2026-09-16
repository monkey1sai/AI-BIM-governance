import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  coordinatorClient,
  type LineageConversionReport,
  type MinioObject,
  type SourceBundleLookupResponse,
} from "../coordinatorClient";
import { LineageSummaryCard } from "./LineageSummaryCard";

const object: MinioObject = { key: "project/main/v1/model.ifc", etag: "a".repeat(32), role: "source_ifc",
  project_id: "project", project_display_name: "Project", category: "main", version: "v1", idempotency_key: "mw_0123456789abcdef" };
const found: SourceBundleLookupResponse = {
  items: [
    { source_bundle_id: "bundle-0002", bundle_state: "READY", pipeline_job_id: "pj_0002" },
    { source_bundle_id: "bundle-0001", bundle_state: "READY", pipeline_job_id: null },
  ],
  unindexed_bundle_count: 0,
};

const metric = (numerator: number, denominator: number, scope: "eligible_ifc_product_count" | "csv_valid_count") => ({
  numerator, denominator, ratio: denominator ? numerator / denominator : null,
  status: denominator ? "partial" as const : "not_evaluable" as const, denominator_scope: scope,
});
const report: LineageConversionReport = {
  conversion_job_id: "stream_conv_2", ifc_ready_job_id: "ifcready_2", source_model_id: "mw_0123456789abcdef",
  project_id: "project", external_model_version_id: "v1",
  source_ifc: { bucket: "bim-control", key: object.key, etag: object.etag },
  schedule: { key: "project/main/v1/schedule.csv", etag: "s", sha256: "b".repeat(64), size_bytes: 10, used: true },
  status: "generated", error_code: null, report_generated_at: "2026-09-16T12:00:00.000000Z",
  conversion_created_at: "2026-09-16T11:00:00.000Z", recorded_at: "2026-09-16T12:00:00.000Z",
  metrics: {
    ifc_usdc_coverage_ratio: metric(98, 100, "eligible_ifc_product_count"),
    rvt_ifc_alignment_ratio: metric(9, 10, "csv_valid_count"),
    rvt_ifc_usdc_lineage_ratio: metric(8, 10, "csv_valid_count"),
  },
  counts: null, warning_codes: [],
  files: { "alignment_report.json": { sha256: "c".repeat(64), size_bytes: 1 }, "alignment_report.csv": { sha256: "d".repeat(64), size_bytes: 1 } },
  minio_upload: { status: "uploaded", bucket: "bim-control", keys: { "alignment_report.json": "k.json", "alignment_report.csv": "k.csv" }, reason: null, attempted_at: null },
};

describe("LineageSummaryCard", () => {
  let node: HTMLDivElement; let root: Root;
  beforeEach(() => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    node = document.createElement("div"); document.body.appendChild(node); root = createRoot(node);
    vi.spyOn(coordinatorClient, "listLineageConversionReports").mockResolvedValue({ count: 0, items: [] });
  });
  afterEach(async () => { await act(async () => root.unmount()); node.remove(); vi.restoreAllMocks(); });
  const render = async (bucket: string | null = "bim-control") => {
    await act(async () => root.render(<LineageSummaryCard object={object} bucket={bucket} />));
  };
  const byTestId = (id: string) => node.querySelector<HTMLElement>(`[data-testid="${id}"]`);

  it("以 bucket、object key 與 etag 反查，列出引用此 IFC 的 bundle", async () => {
    const lookup = vi.spyOn(coordinatorClient, "lookupLineageSourceBundles").mockResolvedValue(found);
    await render();
    expect(lookup).toHaveBeenCalledWith("bim-control", object.key, object.etag);
    const bundles = node.querySelectorAll('[data-testid="lineage-summary-bundle"]');
    expect(bundles).toHaveLength(2);
    expect(bundles[0].textContent).toContain("bundle-0002");
    expect(bundles[0].textContent).toContain("pj_0002");
    expect(bundles[1].textContent).toContain("尚未建立");
    expect(byTestId("lineage-summary-ratios")?.textContent).toContain("授權");
  });

  it("顯示此 IFC 最新的轉檔對齊報表並連到報表頁", async () => {
    const list = vi.spyOn(coordinatorClient, "listLineageConversionReports")
      .mockResolvedValue({ count: 3, items: [report] });
    vi.spyOn(coordinatorClient, "lookupLineageSourceBundles").mockResolvedValue({ items: [], unindexed_bundle_count: 0 });
    await render();
    expect(list).toHaveBeenCalledWith({ sourceIfcKey: object.key, limit: 1 });
    const latest = byTestId("lineage-conversion-latest")?.textContent ?? "";
    expect(latest).toContain("80.00%");
    expect(latest).toContain("8 / 10");
    expect(latest).toContain("已上傳");
    expect(byTestId("lineage-conversion-open")?.getAttribute("href")).toBe("#lineage?conversion_job_id=stream_conv_2");
    expect(byTestId("lineage-conversion-count")?.textContent).toContain("3");
    expect(byTestId("lineage-conversion-stale")).toBeNull();
  });

  it("最新報表對應較早版本的 IFC 時提醒；沒有報表時說明會在轉檔後產生", async () => {
    vi.spyOn(coordinatorClient, "lookupLineageSourceBundles").mockResolvedValue({ items: [], unindexed_bundle_count: 0 });
    vi.spyOn(coordinatorClient, "listLineageConversionReports").mockResolvedValue({
      count: 1, items: [{ ...report, source_ifc: { ...report.source_ifc, etag: "older" } }],
    });
    await render();
    expect(byTestId("lineage-conversion-stale")).not.toBeNull();

    await act(async () => root.unmount());
    root = createRoot(node);
    vi.spyOn(coordinatorClient, "listLineageConversionReports").mockResolvedValue({ count: 0, items: [] });
    await render();
    expect(byTestId("lineage-conversion-none")?.textContent).toContain("轉檔");
  });

  it("報表清單讀取失敗時可重試，不影響 governed 查詢", async () => {
    vi.spyOn(coordinatorClient, "lookupLineageSourceBundles").mockResolvedValue(found);
    const list = vi.spyOn(coordinatorClient, "listLineageConversionReports")
      .mockRejectedValueOnce(new Error("coordinator -> 503"))
      .mockResolvedValue({ count: 1, items: [report] });
    await render();
    expect(byTestId("lineage-conversion-error")).not.toBeNull();
    expect(node.querySelectorAll('[data-testid="lineage-summary-bundle"]')).toHaveLength(2);
    await act(async () => byTestId("lineage-conversion-retry")?.click());
    expect(list).toHaveBeenCalledTimes(2);
    expect(byTestId("lineage-conversion-latest")).not.toBeNull();
  });

  it("查無 bundle 且沒有未建索引的紀錄時，說明此 IFC 沒有 lineage 報表", async () => {
    vi.spyOn(coordinatorClient, "lookupLineageSourceBundles").mockResolvedValue({ items: [], unindexed_bundle_count: 0 });
    await render();
    expect(byTestId("lineage-summary-none")).not.toBeNull();
    expect(byTestId("lineage-summary-indeterminate")).toBeNull();
    expect(byTestId("lineage-summary-ratios")).toBeNull();
  });

  it("有未建立索引的舊 bundle 時，不把查無說成確定沒有", async () => {
    vi.spyOn(coordinatorClient, "lookupLineageSourceBundles").mockResolvedValue({ items: [], unindexed_bundle_count: 2 });
    await render();
    expect(byTestId("lineage-summary-none")).toBeNull();
    expect(byTestId("lineage-summary-indeterminate")?.textContent).toContain("2");
  });

  it("查詢失敗時顯示錯誤，重試後顯示結果", async () => {
    const lookup = vi.spyOn(coordinatorClient, "lookupLineageSourceBundles")
      .mockRejectedValueOnce(new Error("coordinator /api/lineage/source-bundles -> 502 upstream_failed"))
      .mockResolvedValue(found);
    await render();
    expect(byTestId("lineage-summary-error")).not.toBeNull();
    await act(async () => byTestId("lineage-summary-retry")?.click());
    expect(lookup).toHaveBeenCalledTimes(2);
    expect(byTestId("lineage-summary-error")).toBeNull();
    expect(node.querySelectorAll('[data-testid="lineage-summary-bundle"]')).toHaveLength(2);
  });

  it("不知道 bucket 時不做 governed 反查，轉檔報表照常顯示", async () => {
    const lookup = vi.spyOn(coordinatorClient, "lookupLineageSourceBundles");
    vi.spyOn(coordinatorClient, "listLineageConversionReports").mockResolvedValue({ count: 1, items: [report] });
    await render(null);
    expect(lookup).not.toHaveBeenCalled();
    expect(byTestId("lineage-summary-bucket-unknown")).not.toBeNull();
    expect(byTestId("lineage-conversion-latest")).not.toBeNull();
  });
});
