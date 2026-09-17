// Coordinator Browser Contract — governed lineage read projections.
import { z } from "zod/v4";
import type { BundleState } from "../../services/lineage/sourceBundleValidator.js";
import type {
  SourceBundleLookupItem,
  SourceBundleLookupResponse,
} from "../../services/lineage/sourceBundleStore.js";
import { LINEAGE_ALIGNMENT_DIFFERENCE_SETS } from "../../services/lineage/lineageAlignmentReport.js";
import type {
  LineageReportCounts,
  LineageReportMetrics,
  LineageReportRecord,
} from "../../services/lineageReports/lineageReportStore.js";
import type {
  LineageConversionReportDifferences,
  LineageConversionReportList,
} from "../../services/lineageReports/lineageReportViews.js";
import type { Equal, Expect } from "../typecheck.js";
import { isoTimestamp, named } from "../primitives.js";

export const bundleState = named("BundleState", z.enum(["READY", "NON_READY", "LEGACY_UNMANAGED"]));
export type _BundleState = Expect<Equal<z.output<typeof bundleState>, BundleState>>;

export const sourceBundleLookupItem = named("SourceBundleLookupItem", z.strictObject({
  source_bundle_id: z.string(),
  bundle_state: bundleState,
  pipeline_job_id: z.string().nullable(),
}));
export type _SourceBundleLookupItem = Expect<Equal<z.output<typeof sourceBundleLookupItem>, SourceBundleLookupItem>>;

export const sourceBundleLookupResponse = named("SourceBundleLookupResponse", z.strictObject({
  items: z.array(sourceBundleLookupItem),
  unindexed_bundle_count: z.number().int().nonnegative(),
}));
export type _SourceBundleLookupResponse = Expect<Equal<z.output<typeof sourceBundleLookupResponse>, SourceBundleLookupResponse>>;

// ── Conversion alignment reports (legacy MinIO watch flow) ─────────────────────

// denominator_scope is fixed per metric by the report parser; the wire type keeps its enum.
const reportMetric = named("LineageReportMetric", z.strictObject({
  numerator: z.number().int().nonnegative(),
  denominator: z.number().int().nonnegative(),
  ratio: z.number().min(0).max(1).nullable(),
  status: z.enum(["complete", "partial", "not_evaluable"]),
  denominator_scope: z.enum(["eligible_ifc_product_count", "csv_valid_count"]),
}));

export const lineageReportMetrics = named("LineageReportMetrics", z.strictObject({
  ifc_usdc_coverage_ratio: reportMetric,
  rvt_ifc_alignment_ratio: reportMetric,
  rvt_ifc_usdc_lineage_ratio: reportMetric,
}));
export type _LineageReportMetrics = Expect<Equal<z.output<typeof lineageReportMetrics>, LineageReportMetrics>>;

const count = z.number().int().nonnegative();
export const lineageReportCounts = named("LineageReportCounts", z.strictObject({
  csv_total_count: count,
  csv_valid_count: count,
  eligible_ifc_product_count: count,
  duplicate_rvt_id_count: count,
  duplicate_ifc_guid_count: count,
  invalid_row_count: count,
  csv_only_count: count,
  ifc_only_count: count,
  ifc_usdc_unmapped_count: count,
  full_lineage_matched_count: count,
}));
export type _LineageReportCounts = Expect<Equal<z.output<typeof lineageReportCounts>, LineageReportCounts>>;

const reportFileFacts = z.strictObject({ sha256: z.string(), size_bytes: count }).nullable();
const reportFileKeys = z.strictObject({
  "alignment_report.json": z.string().nullable(),
  "alignment_report.csv": z.string().nullable(),
});

export const lineageConversionReport = named("LineageConversionReport", z.strictObject({
  conversion_job_id: z.string(),
  ifc_ready_job_id: z.string(),
  source_model_id: z.string(),
  project_id: z.string(),
  external_model_version_id: z.string(),
  source_ifc: z.strictObject({ bucket: z.string().nullable(), key: z.string().nullable(), etag: z.string().nullable() }),
  schedule: z.strictObject({
    key: z.string().nullable(),
    etag: z.string().nullable(),
    sha256: z.string().nullable(),
    size_bytes: count.nullable(),
    used: z.boolean(),
  }),
  status: z.enum(["generated", "failed", "not_produced", "invalid"]),
  error_code: z.string().nullable(),
  report_generated_at: z.string().nullable(),
  conversion_created_at: isoTimestamp,
  recorded_at: isoTimestamp,
  metrics: lineageReportMetrics.nullable(),
  counts: lineageReportCounts.nullable(),
  warning_codes: z.array(z.string()),
  files: z.strictObject({ "alignment_report.json": reportFileFacts, "alignment_report.csv": reportFileFacts }),
  minio_upload: z.strictObject({
    status: z.enum(["uploaded", "exists", "denied", "failed", "skipped"]),
    bucket: z.string().nullable(),
    keys: reportFileKeys,
    reason: z.string().nullable(),
    attempted_at: z.string().nullable(),
  }),
}), "One conversion's schedule.csv ↔ IFC ↔ USDC alignment report record.");
export type _LineageConversionReport = Expect<Equal<z.output<typeof lineageConversionReport>, LineageReportRecord>>;

export const lineageConversionReportList = named("LineageConversionReportList", z.strictObject({
  count,
  items: z.array(lineageConversionReport),
}));
export type _LineageConversionReportList = Expect<Equal<z.output<typeof lineageConversionReportList>, LineageConversionReportList>>;

export const lineageDifferenceSet = named("LineageDifferenceSet", z.enum(LINEAGE_ALIGNMENT_DIFFERENCE_SETS));

export const lineageConversionReportDifferences = named("LineageConversionReportDifferences", z.strictObject({
  conversion_job_id: z.string(),
  set: lineageDifferenceSet,
  total: count,
  authoritative_count: count,
  offset: count,
  limit: count,
  items: z.array(z.record(z.string(), z.unknown())),
}));
export type _LineageConversionReportDifferences = Expect<Equal<
  z.output<typeof lineageConversionReportDifferences>, LineageConversionReportDifferences>>;
