import { z } from "zod";
import { TextDecoder } from "node:util";
import { isUtcTimestamp } from "./minioLocator.js";

/** 整份 JSON report 的 bounded-read 上限；超過者仍可走既有個別下載 API。 */
export const LINEAGE_ALIGNMENT_REPORT_MAX_BYTES = 16 * 1024 * 1024;

export const LINEAGE_ALIGNMENT_DIFFERENCE_SETS = [
  "csv_only",
  "ifc_only",
  "ifc_usdc_unmapped",
  "duplicate_rvt_ids",
  "duplicate_ifc_guids",
  "invalid_rows",
  "full_lineage_matched",
] as const;

export type LineageAlignmentDifferenceSet =
  (typeof LINEAGE_ALIGNMENT_DIFFERENCE_SETS)[number];

const IFC_GUID_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$";
const identifierSchema = z.string().min(1).max(200);
const safeIntegerSchema = z.number().int().nonnegative().safe();
const uuid36RawSchema = z
  .string()
  .regex(/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/);
const uuid36Schema = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
const globalIdSchema = z.string().regex(/^[0-9A-Za-z_$]{22}$/);
const ifcClassSchema = z.string().min(1).max(120).regex(/^[A-Za-z_][A-Za-z0-9_]*$/);
const usdRootSchema = z
  .string()
  .max(512)
  .regex(/^\/World\/Elements\/[A-Za-z_][A-Za-z0-9_]*\/G_[A-Za-z0-9_]+$/);
const usdChildSchema = z
  .string()
  .max(1_024)
  .regex(/^\/World\/Elements\/[A-Za-z_][A-Za-z0-9_]*\/G_[A-Za-z0-9_]+(?:\/[A-Za-z_][A-Za-z0-9_]*)+$/);

function uniqueArray<T extends z.ZodTypeAny>(item: T) {
  return z
    .array(item)
    .refine((items) => new Set(items.map((value) => JSON.stringify(value))).size === items.length);
}

const csvOnlySchema = z
  .object({
    rvt_element_id: z.string().min(1).max(200),
    ifc_uuid36_raw: uuid36RawSchema,
    ifc_uuid36: uuid36Schema,
    ifc_global_id22: globalIdSchema.optional(),
    reason_code: z.enum(["ifc_product_not_found", "guid_roundtrip_failed"]),
  })
  .strict()
  .superRefine((row, context) => {
    if (row.reason_code === "ifc_product_not_found" && row.ifc_global_id22 === undefined) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["ifc_global_id22"], message: "required" });
    }
    if (row.reason_code === "guid_roundtrip_failed" && row.ifc_global_id22 !== undefined) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["ifc_global_id22"], message: "forbidden" });
    }
  });

const ifcOnlySchema = z
  .object({
    ifc_global_id22: globalIdSchema,
    ifc_uuid36: uuid36Schema,
    ifc_class: ifcClassSchema,
    usd_prim_path: usdRootSchema.optional(),
  })
  .strict();

const ifcUsdcUnmappedSchema = z
  .object({
    ifc_global_id22: globalIdSchema,
    ifc_uuid36: uuid36Schema,
    ifc_class: ifcClassSchema,
    reason_code: z.enum(["prim_not_found", "unstable_child_prim_target", "prim_token_mismatch"]),
    observed_prim_path: usdChildSchema.optional(),
  })
  .strict()
  .superRefine((row, context) => {
    const needsPath = row.reason_code === "unstable_child_prim_target";
    if (needsPath !== (row.observed_prim_path !== undefined)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["observed_prim_path"], message: "reason/path mismatch" });
    }
  });

const invalidRowSchema = z
  .object({
    row_number: z.number().int().min(1).safe(),
    rvt_element_id: z.string().min(1).max(200).optional(),
    ifc_uuid36_raw: uuid36RawSchema.optional(),
    reason_code: z.enum([
      "missing_id",
      "missing_guid",
      "duplicate_id",
      "duplicate_guid",
      "invalid_guid_format",
      "guid_roundtrip_failed",
    ]),
  })
  .strict()
  .superRefine((row, context) => {
    if (row.reason_code === "missing_id" && row.rvt_element_id !== undefined) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["rvt_element_id"], message: "must be absent" });
    }
    if (row.reason_code === "missing_guid" && row.ifc_uuid36_raw !== undefined) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["ifc_uuid36_raw"], message: "must be absent" });
    }
  });

const differenceSetsSchema = z
  .object({
    csv_only: uniqueArray(csvOnlySchema),
    ifc_only: uniqueArray(ifcOnlySchema),
    ifc_usdc_unmapped: uniqueArray(ifcUsdcUnmappedSchema),
    duplicate_rvt_ids: uniqueArray(
      z.object({ rvt_element_id: z.string().min(1).max(200), occurrence_count: z.number().int().min(2).safe() }).strict(),
    ),
    duplicate_ifc_guids: uniqueArray(
      z.object({ ifc_uuid36: uuid36Schema, occurrence_count: z.number().int().min(2).safe() }).strict(),
    ),
    invalid_rows: uniqueArray(invalidRowSchema),
    full_lineage_matched: uniqueArray(
      z
        .object({
          rvt_element_id: z.string().min(1).max(200),
          ifc_uuid36: uuid36Schema,
          ifc_global_id22: globalIdSchema,
          usd_prim_path: usdRootSchema,
        })
        .strict(),
    ),
  })
  .strict();

const countsSchema = z
  .object({
    csv_total_count: safeIntegerSchema,
    csv_valid_count: safeIntegerSchema,
    eligible_ifc_product_count: safeIntegerSchema,
    duplicate_rvt_id_count: safeIntegerSchema,
    duplicate_ifc_guid_count: safeIntegerSchema,
    invalid_row_count: safeIntegerSchema,
    csv_only_count: safeIntegerSchema,
    ifc_only_count: safeIntegerSchema,
    ifc_usdc_unmapped_count: safeIntegerSchema,
    full_lineage_matched_count: safeIntegerSchema,
  })
  .strict();

function metricSchema(scope: "eligible_ifc_product_count" | "csv_valid_count") {
  return z
    .object({
      numerator: safeIntegerSchema,
      denominator: safeIntegerSchema,
      ratio: z.number().finite().min(0).max(1).nullable(),
      status: z.enum(["complete", "partial", "not_evaluable"]),
      denominator_scope: z.literal(scope),
    })
    .strict();
}

const reportBodySchema = z
  .object({
    report_schema_version: z.literal("alignment-report/v1"),
    source_bundle_id: identifierSchema,
    pipeline_job_id: identifierSchema,
    attempt_id: identifierSchema,
    result_id: z.string().min(1).max(200).regex(/^[^:]+$/),
    generated_at: z.string().refine(isUtcTimestamp),
    scope: z
      .object({
        eligible_ifc_product_selector: z.literal("IfcProduct"),
        eligible_ifc_product_count: safeIntegerSchema,
        legacy_alias: z
          .object({ source_ifc_entity_count_is_alias_of: z.literal("eligible_ifc_product_count") })
          .strict(),
      })
      .strict(),
    metrics: z
      .object({
        ifc_usdc_coverage_ratio: metricSchema("eligible_ifc_product_count"),
        rvt_ifc_alignment_ratio: metricSchema("csv_valid_count"),
        rvt_ifc_usdc_lineage_ratio: metricSchema("csv_valid_count"),
      })
      .strict(),
    counts: countsSchema,
    difference_sets: differenceSetsSchema,
    warning_codes: z
      .array(z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/))
      .max(64)
      .refine((items) => new Set(items).size === items.length),
    warning_code_count: z.number().int().min(0).max(64).safe(),
  })
  .strict()
  .superRefine((body, context) => {
    const issue = (path: Array<string | number>, message: string): void => {
      context.addIssue({ code: z.ZodIssueCode.custom, path, message });
    };
    if (body.scope.eligible_ifc_product_count !== body.counts.eligible_ifc_product_count) {
      issue(["scope", "eligible_ifc_product_count"], "scope/count mismatch");
    }
    if (body.warning_code_count !== body.warning_codes.length) {
      issue(["warning_code_count"], "warning count mismatch");
    }

    const setCounts: Record<LineageAlignmentDifferenceSet, number> = {
      csv_only: body.counts.csv_only_count,
      ifc_only: body.counts.ifc_only_count,
      ifc_usdc_unmapped: body.counts.ifc_usdc_unmapped_count,
      duplicate_rvt_ids: body.counts.duplicate_rvt_id_count,
      duplicate_ifc_guids: body.counts.duplicate_ifc_guid_count,
      invalid_rows: body.counts.invalid_row_count,
      full_lineage_matched: body.counts.full_lineage_matched_count,
    };
    for (const name of LINEAGE_ALIGNMENT_DIFFERENCE_SETS) {
      if (body.difference_sets[name].length > setCounts[name]) {
        issue(["difference_sets", name], "enumerated set exceeds authoritative count");
      }
    }

    if (!alignmentSummaryIsValid(body)) {
      issue(["metrics"], "alignment summary semantics are invalid");
    }
    validateIdentityChains(body, issue);
  });

const reportDocumentSchema = z
  .object({
    schema_version: z.literal("lineage-alignment-report/v1"),
    document_type: z.literal("alignment_report_json"),
    body: reportBodySchema,
  })
  .strict();

export type LineageAlignmentReportBody = z.infer<typeof reportBodySchema>;
export type LineageAlignmentDifferenceItem =
  LineageAlignmentReportBody["difference_sets"][LineageAlignmentDifferenceSet][number];

export function parseLineageAlignmentReport(rawBytes: Buffer): LineageAlignmentReportBody | null {
  let document: unknown;
  try {
    document = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(rawBytes));
  } catch {
    return null;
  }
  const parsed = reportDocumentSchema.safeParse(document);
  return parsed.success ? parsed.data.body : null;
}

function truncatedRatio(numerator: number, denominator: number): number | null {
  if (denominator === 0) return null;
  const scale = 10_000_000_000n;
  return Number((BigInt(numerator) * scale) / BigInt(denominator)) / 10_000_000_000;
}

function alignmentSummaryIsValid(body: LineageAlignmentReportBody): boolean {
  const { counts, metrics } = body;
  const coverage = metrics.ifc_usdc_coverage_ratio;
  const alignment = metrics.rvt_ifc_alignment_ratio;
  const lineage = metrics.rvt_ifc_usdc_lineage_ratio;
  const csvTotal = BigInt(counts.csv_total_count);
  const csvValid = BigInt(counts.csv_valid_count);
  const eligible = BigInt(counts.eligible_ifc_product_count);
  const matched = BigInt(alignment.numerator);
  const mapped = BigInt(coverage.numerator);
  const full = BigInt(counts.full_lineage_matched_count);
  const csvNonValid = csvTotal - csvValid;
  const lowerCandidate = matched + mapped - eligible;
  const lower = lowerCandidate > 0n ? lowerCandidate : 0n;
  const upper = matched < mapped ? matched : mapped;
  const metricsValid = [coverage, alignment, lineage].every((metric) => {
    const expectedStatus = metric.denominator === 0
      ? "not_evaluable"
      : metric.numerator === metric.denominator
        ? "complete"
        : "partial";
    return metric.numerator <= metric.denominator &&
      metric.ratio === truncatedRatio(metric.numerator, metric.denominator) &&
      metric.status === expectedStatus;
  });
  return metricsValid &&
    csvValid <= csvTotal &&
    BigInt(counts.duplicate_rvt_id_count) <= csvNonValid &&
    BigInt(counts.duplicate_ifc_guid_count) <= csvNonValid &&
    BigInt(counts.invalid_row_count) <= csvNonValid &&
    BigInt(coverage.denominator) === eligible &&
    mapped === eligible - BigInt(counts.ifc_usdc_unmapped_count) &&
    BigInt(alignment.denominator) === csvValid &&
    matched === csvValid - BigInt(counts.csv_only_count) &&
    BigInt(lineage.denominator) === csvValid &&
    BigInt(lineage.numerator) === full &&
    BigInt(counts.ifc_only_count) === eligible - matched &&
    full >= lower &&
    full <= upper;
}

function validateIdentityChains(
  body: LineageAlignmentReportBody,
  issue: (path: Array<string | number>, message: string) => void,
): void {
  const { difference_sets: sets } = body;
  const check = (uuid: string, globalId: string, path: Array<string | number>): void => {
    if (ifcGuidCompress(uuid) !== globalId || ifcGuidExpand(globalId) !== uuid) {
      issue(path, "IFC GUID round-trip mismatch");
    }
  };
  sets.csv_only.forEach((row, index) => {
    if (row.ifc_uuid36 !== row.ifc_uuid36_raw.toLowerCase()) {
      issue(["difference_sets", "csv_only", index, "ifc_uuid36"], "canonical UUID mismatch");
    }
    if (row.ifc_global_id22) check(row.ifc_uuid36, row.ifc_global_id22, ["difference_sets", "csv_only", index]);
  });
  sets.ifc_only.forEach((row, index) => {
    check(row.ifc_uuid36, row.ifc_global_id22, ["difference_sets", "ifc_only", index]);
    if (row.usd_prim_path && row.usd_prim_path.split("/").at(-1) !== usdGuidToken(row.ifc_global_id22)) {
      issue(["difference_sets", "ifc_only", index, "usd_prim_path"], "stable root mismatch");
    }
  });
  sets.ifc_usdc_unmapped.forEach((row, index) => {
    check(row.ifc_uuid36, row.ifc_global_id22, ["difference_sets", "ifc_usdc_unmapped", index]);
    if (row.observed_prim_path && !row.observed_prim_path.startsWith(`${usdRoot(row.ifc_class, row.ifc_global_id22)}/`)) {
      issue(["difference_sets", "ifc_usdc_unmapped", index, "observed_prim_path"], "child root mismatch");
    }
  });
  sets.full_lineage_matched.forEach((row, index) => {
    check(row.ifc_uuid36, row.ifc_global_id22, ["difference_sets", "full_lineage_matched", index]);
    if (row.usd_prim_path !== usdRoot(row.usd_prim_path.split("/")[3] ?? "", row.ifc_global_id22)) {
      issue(["difference_sets", "full_lineage_matched", index, "usd_prim_path"], "stable root mismatch");
    }
  });
  const matchedRvt = new Set(sets.full_lineage_matched.map((row) => row.rvt_element_id));
  const matchedIfc = new Set(sets.full_lineage_matched.map((row) => row.ifc_global_id22));
  if (sets.csv_only.some((row) => matchedRvt.has(row.rvt_element_id))) {
    issue(["difference_sets", "csv_only"], "overlaps full lineage set");
  }
  if (sets.ifc_only.some((row) => matchedIfc.has(row.ifc_global_id22))) {
    issue(["difference_sets", "ifc_only"], "overlaps full lineage set");
  }
}

function encodeIfc(value: number, length: number): string {
  let encoded = "";
  for (let position = length - 1; position >= 0; position -= 1) {
    encoded += IFC_GUID_CHARS[Math.floor(value / (64 ** position)) % 64];
  }
  return encoded;
}

function decodeIfc(value: string): number {
  let decoded = 0;
  for (const char of value) decoded = decoded * 64 + IFC_GUID_CHARS.indexOf(char);
  return decoded;
}

function ifcGuidCompress(uuid36: string): string | null {
  const hex = uuid36.replaceAll("-", "");
  if (!/^[0-9a-f]{32}$/.test(hex)) return null;
  const octets = Array.from({ length: 16 }, (_, index) => Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16));
  let encoded = encodeIfc(octets[0], 2);
  for (let index = 1; index < 16; index += 3) {
    encoded += encodeIfc((octets[index] << 16) | (octets[index + 1] << 8) | octets[index + 2], 4);
  }
  return encoded;
}

function ifcGuidExpand(globalId: string): string | null {
  if (!/^[0-3][0-9A-Za-z_$]{21}$/.test(globalId)) return null;
  const octets = [decodeIfc(globalId.slice(0, 2))];
  for (let group = 0; group < 5; group += 1) {
    const value = decodeIfc(globalId.slice(2 + 4 * group, 6 + 4 * group));
    octets.push((value >> 16) & 255, (value >> 8) & 255, value & 255);
  }
  const hex = octets.map((value) => value.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function usdSafe(value: string, fallback: string): string {
  let safe = value.replace(/[^A-Za-z0-9_]/g, "_") || fallback;
  if (!/^[A-Za-z_]/.test(safe)) safe = `_${safe}`;
  return safe;
}

function usdRoot(ifcClass: string, globalId: string): string {
  return `/World/Elements/${usdSafe(ifcClass, "Unclassified")}/${usdGuidToken(globalId)}`;
}

function usdGuidToken(globalId: string): string {
  const body = usdSafe(globalId, "Shape").replace(/^_/, "") || "Shape";
  return `G_${body}`;
}
