// Shared lineage report fixtures for the model library and the report redirect tests.
import type { LineageConversionReport, LineageConversionReportDifferences } from "../coordinatorClient";

export const lineageMetric = (
  numerator: number,
  denominator: number,
  scope: "eligible_ifc_product_count" | "csv_valid_count",
) => ({
  numerator,
  denominator,
  ratio: denominator === 0 ? null : Math.trunc((numerator / denominator) * 1e10) / 1e10,
  status: denominator === 0 ? "not_evaluable" as const : numerator === denominator ? "complete" as const : "partial" as const,
  denominator_scope: scope,
});

export const LINEAGE_REPORT: LineageConversionReport = {
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
    ifc_usdc_coverage_ratio: lineageMetric(6720, 6816, "eligible_ifc_product_count"),
    rvt_ifc_alignment_ratio: lineageMetric(6133, 6134, "csv_valid_count"),
    rvt_ifc_usdc_lineage_ratio: lineageMetric(6045, 6134, "csv_valid_count"),
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

/** An older attempt of the same IFC that predates the report feature. */
export const LINEAGE_REPORT_NOT_PRODUCED: LineageConversionReport = {
  ...LINEAGE_REPORT,
  conversion_job_id: "stream_conv_0",
  ifc_ready_job_id: "ifcready_0",
  status: "not_produced",
  error_code: "report_not_produced",
  metrics: null,
  counts: null,
  warning_codes: [],
  conversion_created_at: "2026-09-15T08:00:00.000Z",
  files: { "alignment_report.json": null, "alignment_report.csv": null },
  minio_upload: { ...LINEAGE_REPORT.minio_upload, status: "skipped", reason: "report_not_generated" },
};

export const lineageDifferencePage = (
  set: LineageConversionReportDifferences["set"],
  items: Array<Record<string, unknown>>,
  offset = 0,
  total = items.length,
  conversionJobId = "stream_conv_1",
): LineageConversionReportDifferences => ({
  conversion_job_id: conversionJobId,
  set,
  total,
  authoritative_count: total,
  offset,
  limit: 100,
  items,
});
