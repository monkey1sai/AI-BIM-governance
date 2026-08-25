import { z } from "zod";
import { assertLocatorConsistent } from "./minioLocator.js";
import {
  PipelineResultManifestReadError,
  readPipelineResultManifest,
  type PipelineResultManifest,
  type PipelineResultManifestReadDeps,
} from "./pipelineResultManifest.js";
import { SourceBundleAccessDeniedError } from "./sourceBundleObjectPort.js";
import type { PipelineResultView } from "./pipelineResultStore.js";

export type PipelineResultMetricName =
  | "ifc_usdc_coverage_ratio"
  | "rvt_ifc_alignment_ratio"
  | "rvt_ifc_usdc_lineage_ratio";

export type PipelineResultCountName =
  | "csv_total_count"
  | "csv_valid_count"
  | "eligible_ifc_product_count"
  | "duplicate_rvt_id_count"
  | "duplicate_ifc_guid_count"
  | "invalid_row_count"
  | "csv_only_count"
  | "ifc_only_count"
  | "ifc_usdc_unmapped_count"
  | "full_lineage_matched_count";

export interface PipelineResultMetric {
  numerator: number;
  denominator: number;
  ratio: number | null;
  status: "complete" | "partial" | "not_evaluable";
}

export interface PipelineResultCompareSide {
  result_id: string;
  attempt_id: string;
  pipeline_job_id: string;
  publication_state: "AVAILABLE";
  attempt_outcome: "succeeded" | "succeeded_with_warnings";
  result_manifest_digest: string;
  result_manifest_ref: {
    ref: string;
    object_version_id: string;
    etag: string;
    sha256: string;
    size_bytes: number;
  };
  converter: {
    converter_id: string;
    converter_version: string;
    runtime_profile: string;
  };
  metrics: Record<PipelineResultMetricName, PipelineResultMetric>;
  counts: Record<PipelineResultCountName, number>;
  warning_codes: string[];
}

export interface PipelineResultCompareDifferences {
  changed_metric_names: PipelineResultMetricName[];
  changed_count_names: PipelineResultCountName[];
  warning_codes_added: string[];
  warning_codes_removed: string[];
}

/**
 * Streaming/result-manifest projection seam. The route first validates result ownership and
 * selectability in PipelineResultStore, then asks this reader for the immutable manifest detail.
 * Missing deployment wiring is an honest 503; callers must never fabricate metrics/counts.
 */
export interface PipelineResultDetailReaderPort {
  readCompareSide(result: PipelineResultView): Promise<PipelineResultCompareSide>;
}

export class PipelineResultDetailUnavailableError extends Error {
  readonly code = "result_detail_unavailable";

  constructor(detail: string) {
    super(detail);
    this.name = "PipelineResultDetailUnavailableError";
  }
}

const identifierSchema = z.string().min(1).max(200);
const nonnegativeSafeIntegerSchema = z.number().int().nonnegative().safe();
const RATIO_SCALE = 10_000_000_000n;
const RATIO_SCALE_NUMBER = 10_000_000_000;

function truncatedRatio(numerator: number, denominator: number): number | null {
  if (denominator === 0) {
    return null;
  }
  const scaled = (BigInt(numerator) * RATIO_SCALE) / BigInt(denominator);
  return Number(scaled) / RATIO_SCALE_NUMBER;
}

const locatorSchema = z
  .object({
    ref: z.string().min(1).max(4_096),
    object_version_id: z.string().min(1).max(512),
    etag: z.string().min(1).max(512),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    size_bytes: z.number().int().nonnegative(),
  })
  .strict()
  .refine((locator) => assertLocatorConsistent(locator) === null);

const metricSchema = z
  .object({
    numerator: nonnegativeSafeIntegerSchema,
    denominator: nonnegativeSafeIntegerSchema,
    ratio: z.number().finite().min(0).max(1).nullable(),
    status: z.enum(["complete", "partial", "not_evaluable"]),
  })
  .strict()
  .superRefine((metric, context) => {
    if (metric.denominator === 0) {
      if (
        metric.numerator !== 0 ||
        metric.ratio !== null ||
        metric.status !== "not_evaluable"
      ) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: "invalid zero denominator" });
      }
      return;
    }
    if (metric.ratio === null || metric.status === "not_evaluable") {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "invalid evaluable metric" });
      return;
    }
    if (metric.numerator > metric.denominator) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "numerator exceeds denominator" });
      return;
    }
    if (metric.ratio !== truncatedRatio(metric.numerator, metric.denominator)) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "invalid truncated ratio" });
    }
    const expectedStatus =
      metric.numerator === metric.denominator ? "complete" : "partial";
    if (metric.status !== expectedStatus) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "invalid metric status" });
    }
  });

const countsSchema = z
  .object({
    csv_total_count: nonnegativeSafeIntegerSchema,
    csv_valid_count: nonnegativeSafeIntegerSchema,
    eligible_ifc_product_count: nonnegativeSafeIntegerSchema,
    duplicate_rvt_id_count: nonnegativeSafeIntegerSchema,
    duplicate_ifc_guid_count: nonnegativeSafeIntegerSchema,
    invalid_row_count: nonnegativeSafeIntegerSchema,
    csv_only_count: nonnegativeSafeIntegerSchema,
    ifc_only_count: nonnegativeSafeIntegerSchema,
    ifc_usdc_unmapped_count: nonnegativeSafeIntegerSchema,
    full_lineage_matched_count: nonnegativeSafeIntegerSchema,
  })
  .strict();

const compareSideSchema = z
  .object({
    result_id: identifierSchema,
    attempt_id: identifierSchema,
    pipeline_job_id: identifierSchema,
    publication_state: z.literal("AVAILABLE"),
    attempt_outcome: z.enum(["succeeded", "succeeded_with_warnings"]),
    result_manifest_digest: z.string().regex(/^[0-9a-f]{64}$/),
    result_manifest_ref: locatorSchema,
    converter: z
      .object({
        converter_id: identifierSchema,
        converter_version: identifierSchema,
        runtime_profile: identifierSchema,
      })
      .strict(),
    metrics: z
      .object({
        ifc_usdc_coverage_ratio: metricSchema,
        rvt_ifc_alignment_ratio: metricSchema,
        rvt_ifc_usdc_lineage_ratio: metricSchema,
      })
      .strict(),
    counts: countsSchema,
    warning_codes: z
      .array(z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/))
      .max(64)
      .refine((items) => new Set(items).size === items.length),
  })
  .strict()
  .superRefine((side, context) => {
    const issue = (path: Array<string | number>, message: string): void => {
      context.addIssue({ code: z.ZodIssueCode.custom, path, message });
    };
    const coverage = side.metrics.ifc_usdc_coverage_ratio;
    const alignment = side.metrics.rvt_ifc_alignment_ratio;
    const lineage = side.metrics.rvt_ifc_usdc_lineage_ratio;
    const csvTotal = BigInt(side.counts.csv_total_count);
    const csvValid = BigInt(side.counts.csv_valid_count);
    const eligible = BigInt(side.counts.eligible_ifc_product_count);
    const csvOnly = BigInt(side.counts.csv_only_count);
    const ifcOnly = BigInt(side.counts.ifc_only_count);
    const unmapped = BigInt(side.counts.ifc_usdc_unmapped_count);
    const fullLineage = BigInt(side.counts.full_lineage_matched_count);
    const matchedRvtIfc = BigInt(alignment.numerator);
    const mappedIfcUsdc = BigInt(coverage.numerator);

    if (BigInt(coverage.denominator) !== eligible) {
      issue(
        ["metrics", "ifc_usdc_coverage_ratio", "denominator"],
        "IFC-USDC denominator mismatch",
      );
    }
    if (mappedIfcUsdc !== eligible - unmapped) {
      issue(
        ["metrics", "ifc_usdc_coverage_ratio", "numerator"],
        "IFC-USDC numerator mismatch",
      );
    }
    if (BigInt(alignment.denominator) !== csvValid) {
      issue(
        ["metrics", "rvt_ifc_alignment_ratio", "denominator"],
        "RVT-IFC denominator mismatch",
      );
    }
    if (matchedRvtIfc !== csvValid - csvOnly) {
      issue(
        ["metrics", "rvt_ifc_alignment_ratio", "numerator"],
        "RVT-IFC numerator mismatch",
      );
    }
    if (BigInt(lineage.denominator) !== csvValid) {
      issue(
        ["metrics", "rvt_ifc_usdc_lineage_ratio", "denominator"],
        "lineage denominator mismatch",
      );
    }
    if (BigInt(lineage.numerator) !== fullLineage) {
      issue(
        ["metrics", "rvt_ifc_usdc_lineage_ratio", "numerator"],
        "lineage numerator mismatch",
      );
    }

    if (csvValid > csvTotal) {
      issue(["counts", "csv_valid_count"], "CSV valid count exceeds total");
    } else {
      const nonValidRows = csvTotal - csvValid;
      for (const name of [
        "duplicate_rvt_id_count",
        "duplicate_ifc_guid_count",
        "invalid_row_count",
      ] as const) {
        if (BigInt(side.counts[name]) > nonValidRows) {
          issue(["counts", name], "diagnostic count exceeds non-valid rows");
        }
      }
    }

    if (ifcOnly !== eligible - matchedRvtIfc) {
      issue(["counts", "ifc_only_count"], "IFC-only count mismatch");
    }

    const lowerCandidate = matchedRvtIfc + mappedIfcUsdc - eligible;
    const lowerBound = lowerCandidate > 0n ? lowerCandidate : 0n;
    const upperBound = matchedRvtIfc < mappedIfcUsdc ? matchedRvtIfc : mappedIfcUsdc;
    if (fullLineage < lowerBound || fullLineage > upperBound) {
      issue(["counts", "full_lineage_matched_count"], "lineage set-intersection mismatch");
    }
  });

/** Runtime equivalent of the L1 compareSide schema; readers are untrusted until this succeeds. */
export function parsePipelineResultCompareSide(
  value: unknown,
): PipelineResultCompareSide | null {
  const parsed = compareSideSchema.safeParse(value);
  return parsed.success ? (parsed.data as PipelineResultCompareSide) : null;
}

const METRIC_NAMES: PipelineResultMetricName[] = [
  "ifc_usdc_coverage_ratio",
  "rvt_ifc_alignment_ratio",
  "rvt_ifc_usdc_lineage_ratio",
];

const COUNT_NAMES: PipelineResultCountName[] = [
  "csv_total_count",
  "csv_valid_count",
  "eligible_ifc_product_count",
  "duplicate_rvt_id_count",
  "duplicate_ifc_guid_count",
  "invalid_row_count",
  "csv_only_count",
  "ifc_only_count",
  "ifc_usdc_unmapped_count",
  "full_lineage_matched_count",
];

export function buildPipelineResultCompareDifferences(
  left: PipelineResultCompareSide,
  right: PipelineResultCompareSide,
): PipelineResultCompareDifferences {
  const leftWarnings = new Set(left.warning_codes);
  const rightWarnings = new Set(right.warning_codes);
  return {
    changed_metric_names: METRIC_NAMES.filter(
      (name) => JSON.stringify(left.metrics[name]) !== JSON.stringify(right.metrics[name]),
    ),
    changed_count_names: COUNT_NAMES.filter(
      (name) => left.counts[name] !== right.counts[name],
    ),
    warning_codes_added: [...rightWarnings].filter((code) => !leftWarnings.has(code)).sort(),
    warning_codes_removed: [...leftWarnings].filter((code) => !rightWarnings.has(code)).sort(),
  };
}

/**
 * 生產 adapter 的相依：與 registration service **同一條** manifest 讀取／驗證管道
 * （`pipelineResultManifest.ts`），因此 compare 面與註冊面不可能長出兩套 parse。
 */
export type S3PipelineResultDetailReaderDeps = PipelineResultManifestReadDeps;

/** manifest 讀得到但與 store 記錄的不可變證據不符時的統一訊息前綴。 */
function evidenceMismatch(result: PipelineResultView, detail: string): never {
  throw new PipelineResultDetailUnavailableError(
    `result ${result.result_id} manifest evidence mismatch: ${detail}`,
  );
}

/**
 * 由已驗證的 manifest 投影出 compare side。
 *
 * identity 三欄與 `attempt_outcome` 取 **store 記錄**與 **manifest 實讀值**的交集：
 * 兩邊必須逐字相同，否則這份 manifest 描述的不是這個 result，誠實 503 而不是選一邊。
 * `publication_state` 一律取 store（publication 軸的權威在 coordinator，不在 manifest）。
 */
function projectCompareSide(
  result: PipelineResultView,
  manifest: PipelineResultManifest,
  locator: PipelineResultCompareSide["result_manifest_ref"],
): unknown {
  if (manifest.result_id !== result.result_id) {
    evidenceMismatch(result, "result_id");
  }
  if (manifest.attempt_id !== result.attempt_id) {
    evidenceMismatch(result, "attempt_id");
  }
  if (manifest.pipeline_job_id !== result.pipeline_job_id) {
    evidenceMismatch(result, "pipeline_job_id");
  }
  if (manifest.attempt_outcome !== result.attempt_outcome) {
    evidenceMismatch(result, "attempt_outcome");
  }
  return {
    result_id: result.result_id,
    attempt_id: result.attempt_id,
    pipeline_job_id: result.pipeline_job_id,
    publication_state: result.publication_state,
    attempt_outcome: manifest.attempt_outcome,
    result_manifest_digest: locator.sha256,
    result_manifest_ref: locator,
    converter: { ...manifest.converter },
    metrics: { ...manifest.alignment_summary.metrics },
    counts: { ...manifest.alignment_summary.counts },
    warning_codes: [...manifest.alignment_summary.warning_codes],
  };
}

/**
 * 生產 detail reader：從 governed MinIO 讀 `result-manifest.json` 並投影成 compare side。
 *
 * 三條誠實鐵律：
 *   1. **不捏造** metrics／counts —— 讀不到、驗不過、與 store 記錄不符，一律
 *      `PipelineResultDetailUnavailableError`（route → 503），不回半份或預設值。
 *   2. digest 以 MinIO 實讀 bytes 為準，並與 store 的 `result_manifest_digest`
 *      比對（由 `readPipelineResultManifest` 的 expectation 完成）。
 *   3. 回傳前用**本檔既有**的 `parsePipelineResultCompareSide` 重驗；那份 schema 比
 *      manifest 契約更嚴（截斷比、count↔metric 綁定），投影不合格就等於沒有可信 detail。
 *
 * `SourceBundleAccessDeniedError`（allowlist fail-closed）也收斂成 503：locator 不在
 * 治理允許範圍內時，這個 result 的 detail 對本部署而言就是不可得。其餘上游錯誤
 * （憑證／連線／5xx）向上 propagate，不謊報成「detail 不可用」。
 */
export function createS3PipelineResultDetailReader(
  deps: S3PipelineResultDetailReaderDeps,
): PipelineResultDetailReaderPort {
  return {
    async readCompareSide(result: PipelineResultView): Promise<PipelineResultCompareSide> {
      let read;
      try {
        read = await readPipelineResultManifest(
          {
            ref: result.result_manifest_ref,
            // store 記錄只釘 ref 與 digest；etag／size 由 HEAD 觀測後才知道，
            // 沒有 claim 就沒有可比的東西（null = 不比，不是「比過了」）。
            sha256: result.result_manifest_digest,
            etag: null,
            size_bytes: null,
          },
          { objects: deps.objects },
        );
      } catch (error) {
        if (error instanceof SourceBundleAccessDeniedError) {
          throw new PipelineResultDetailUnavailableError(
            `result ${result.result_id} manifest locator is not governed by this deployment`,
          );
        }
        if (error instanceof PipelineResultManifestReadError) {
          throw new PipelineResultDetailUnavailableError(
            `result ${result.result_id} manifest is unreadable (${error.code}): ${error.message}`,
          );
        }
        throw error;
      }

      const projected = projectCompareSide(result, read.manifest, {
        ref: result.result_manifest_ref,
        object_version_id: read.object_version_id,
        etag: read.observed_etag,
        sha256: read.observed_sha256,
        size_bytes: read.observed_size_bytes,
      });
      const side = parsePipelineResultCompareSide(projected);
      if (side === null) {
        throw new PipelineResultDetailUnavailableError(
          `result ${result.result_id} manifest does not project a contract-valid compare side`,
        );
      }
      return side;
    },
  };
}
