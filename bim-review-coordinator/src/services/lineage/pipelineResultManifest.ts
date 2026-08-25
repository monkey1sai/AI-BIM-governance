// bim-review-coordinator/src/services/lineage/pipelineResultManifest.ts
//
// Governed `result-manifest.json` 的**契約解析**與**有界讀取**（rvt-ifc-usdc-lineage
// task 3.3 收尾刀）。
//
// 契約正本：`tests/contracts/result_manifest.json` 的 `$defs/resultManifest`
// （envelope `result-manifest-document/v1`）。語意規則正本：
// `tests/contracts/lineage/semantic_validators.py` 的
// `validate_result_publication_scenario`（`manifest_published_before_artifacts`）
// 與 `validate_cloud_publication_scenario` 的 `WARNING_CODE_COUNT_MISMATCH`。
//
// **為什麼獨立成一個模組**：`registration`（把 manifest 收成 result 記錄）與
// `detail reader`（把 manifest 投影成 compare side）是兩個呼叫端，但**只能有一套
// parse**。與 `sourceBundleManifest.ts`／`sourceBundleValidator.ts` 同一分工：
// 這裡只管「bytes → 契約文件」、「locator → 已驗證 bytes」與「referenced refs 的 head-level
// 實體觀測」，不碰 store、不碰 route。
//
// **claim 非權威**（逐字沿用 `sourceBundleValidator` 的 doctrine）：呼叫端交來的
// locator 只是入口，etag／size／sha256 一律以 MinIO 實讀為準，不符即 fail-closed
// 拋 typed error，絕不靜默採信 claim、也絕不截斷讀取。
import { z } from "zod";
import {
  assertLocatorConsistent,
  isRefParseFailure,
  isUtcTimestamp,
  parseMinioPrefix,
  parseMinioRef,
  utcTimestampToMicros,
  type MinioLocator,
} from "./minioLocator.js";
import { PIPELINE_RESULT_ARTIFACT_IDS } from "./pipelineResultArtifactReader.js";
import { sha256Hex } from "./sourceBundleManifest.js";
import {
  SourceBundleObjectTooLargeError,
  type SourceBundleObjectPort,
} from "./sourceBundleObjectPort.js";

/** envelope 的 `schema_version`（`$defs` 之外的頂層 const）。 */
export const RESULT_MANIFEST_ENVELOPE_SCHEMA_VERSION = "result-manifest-document/v1";
/** body 的 `manifest_schema_version`。 */
export const RESULT_MANIFEST_BODY_SCHEMA_VERSION = "result-manifest/v1";
/** attempt prefix 之下的固定檔名（`isAttemptScopedMinioResultLocation` 的同一個字）。 */
export const RESULT_MANIFEST_OBJECT_NAME = "result-manifest.json";

/**
 * result manifest 的有界讀取上限。
 *
 * manifest 只帶 locator 與摘要數字（契約用 `additionalProperties:false` 擋掉
 * inline bytes），實測 fixture 約 6 KB；1 MiB 與 `sourceBundleValidator.MANIFEST_MAX_BYTES`
 * 同一量級，超過即 fail-closed（`object_too_large`），不截斷、不改用 streaming 猜。
 */
export const RESULT_MANIFEST_MAX_BYTES = 1024 * 1024;

/** 契約 `$defs/resultArtifactRole` 的封閉詞彙（與 task 3.4 的 artifact id 同一份正本）。 */
export type PipelineResultManifestArtifactRole = (typeof PIPELINE_RESULT_ARTIFACT_IDS)[number];

/** 契約 `artifacts` 的四個 `contains` 子句：缺一即非完整 result。 */
export const RESULT_MANIFEST_REQUIRED_ROLES = [
  "usdc",
  "element_mapping",
  "alignment_report_json",
  "alignment_report_csv",
] as const;

export interface PipelineResultManifestArtifact {
  role: PipelineResultManifestArtifactRole;
  ref: string;
  object_version_id: string;
  etag: string;
  sha256: string;
  size_bytes: number;
  published_at: string;
  filename?: string;
  content_type?: string;
}

export interface PipelineResultManifestMetric {
  numerator: number;
  denominator: number;
  ratio: number | null;
  status: "complete" | "partial" | "not_evaluable";
}

export interface PipelineResultManifestCounts {
  csv_total_count: number;
  csv_valid_count: number;
  eligible_ifc_product_count: number;
  duplicate_rvt_id_count: number;
  duplicate_ifc_guid_count: number;
  invalid_row_count: number;
  csv_only_count: number;
  ifc_only_count: number;
  ifc_usdc_unmapped_count: number;
  full_lineage_matched_count: number;
}

export interface PipelineResultManifestAlignmentSummary {
  metrics: {
    ifc_usdc_coverage_ratio: PipelineResultManifestMetric;
    rvt_ifc_alignment_ratio: PipelineResultManifestMetric;
    rvt_ifc_usdc_lineage_ratio: PipelineResultManifestMetric;
  };
  counts: PipelineResultManifestCounts;
  warning_codes: string[];
  warning_code_count: number;
}

export interface PipelineResultManifest {
  manifest_schema_version: typeof RESULT_MANIFEST_BODY_SCHEMA_VERSION;
  result_id: string;
  attempt_id: string;
  pipeline_job_id: string;
  source_bundle_id: string;
  external_model_version_id: string;
  attempt_outcome: "succeeded" | "succeeded_with_warnings" | "failed" | "cancelled";
  converter: {
    converter_id: string;
    converter_version: string;
    runtime_profile: string;
  };
  result_prefix: string;
  created_at: string;
  published_at: string;
  artifacts: PipelineResultManifestArtifact[];
  alignment_summary: PipelineResultManifestAlignmentSummary;
}

const identifierSchema = z.string().min(1).max(200);
const sourceBundleIdSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9._-]+$/);
const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);
const utcTimestampSchema = z.string().refine(isUtcTimestamp);
const nonnegativeSafeIntegerSchema = z.number().int().nonnegative().safe();

/**
 * `$defs/metric` 的逐字對應（含 `allOf` 的 denominator=0 分支）。
 *
 * **刻意比 `pipelineResultDetailReader` 的 `metricSchema` 寬**：契約只要求
 * `ratio ∈ [0,1]` 與 status 分支，沒有規定 ratio 必須等於截斷後的商。那條更嚴的
 * 規則屬 compare-side **投影**層（reader 回傳前用 `parsePipelineResultCompareSide`
 * 重驗），放在這裡會讓「manifest 合約」與「投影合約」變成兩個會漂移的權威。
 */
const manifestMetricSchema = z
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
    }
  });

const manifestCountsSchema = z
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

const manifestArtifactSchema = z
  .object({
    role: z.enum(PIPELINE_RESULT_ARTIFACT_IDS),
    ref: z.string().min(1).max(4_096),
    object_version_id: z.string().min(1).max(512),
    etag: z.string().min(1).max(512),
    sha256: sha256Schema,
    size_bytes: nonnegativeSafeIntegerSchema,
    published_at: utcTimestampSchema,
    filename: z.string().min(1).max(512).optional(),
    content_type: z.string().min(1).max(200).optional(),
  })
  .strict()
  .superRefine((artifact, context) => {
    // `$defs/minioObjectRef` 的 pattern／`not(presign)` 與 semantic 規則
    // `LOCATOR_VERSION_ID_MISMATCH` 一次驗完：parseMinioRef 已擋 presign／未釘版本／CRLF。
    const parsed = parseMinioRef(artifact.ref);
    if (isRefParseFailure(parsed)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["ref"],
        message: `artifact ref is not a governed immutable locator (${parsed.error})`,
      });
      return;
    }
    if (parsed.versionId !== artifact.object_version_id) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["object_version_id"],
        message: "artifact ?versionId= does not match object_version_id",
      });
    }
  });

const manifestBodySchema = z
  .object({
    manifest_schema_version: z.literal(RESULT_MANIFEST_BODY_SCHEMA_VERSION),
    result_id: identifierSchema,
    attempt_id: identifierSchema,
    pipeline_job_id: identifierSchema,
    source_bundle_id: sourceBundleIdSchema,
    external_model_version_id: identifierSchema,
    attempt_outcome: z.enum(["succeeded", "succeeded_with_warnings", "failed", "cancelled"]),
    converter: z
      .object({
        converter_id: identifierSchema,
        converter_version: identifierSchema,
        runtime_profile: identifierSchema,
      })
      .strict(),
    // `$defs/attemptResultPrefix`：query-free、必以 `/` 結尾。runtime 另用
    // `parseMinioPrefix` 擋掉空／`.`／`..` segment 與 CRLF（比 schema 嚴）。
    result_prefix: z
      .string()
      .min(1)
      .max(4_096)
      .refine((prefix) => parseMinioPrefix(prefix) !== null),
    created_at: utcTimestampSchema,
    published_at: utcTimestampSchema,
    artifacts: z.array(manifestArtifactSchema).min(4),
    alignment_summary: z
      .object({
        metrics: z
          .object({
            ifc_usdc_coverage_ratio: manifestMetricSchema,
            rvt_ifc_alignment_ratio: manifestMetricSchema,
            rvt_ifc_usdc_lineage_ratio: manifestMetricSchema,
          })
          .strict(),
        counts: manifestCountsSchema,
        warning_codes: z.array(z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/)).max(64),
        warning_code_count: z.number().int().min(0).max(64),
      })
      .strict()
      .superRefine((summary, context) => {
        if (new Set(summary.warning_codes).size !== summary.warning_codes.length) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["warning_codes"],
            message: "warning_codes must be unique",
          });
        }
        // semantic 規則 WARNING_CODE_COUNT_MISMATCH（contracts/README.md §warning codes）。
        if (summary.warning_code_count !== summary.warning_codes.length) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["warning_code_count"],
            message: "warning_code_count must equal warning_codes length",
          });
        }
      }),
  })
  .strict()
  .superRefine((body, context) => {
    for (const role of RESULT_MANIFEST_REQUIRED_ROLES) {
      if (!body.artifacts.some((artifact) => artifact.role === role)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["artifacts"],
          message: `result manifest is missing the required ${role} artifact`,
        });
      }
    }
    // semantic 規則 manifest_published_before_artifacts：manifest 先發布就可能被讀到
    // 一個 object 還在上傳的 result。時間一律當 instant 比，不比字串。
    const manifestPublishedAt = utcTimestampToMicros(body.published_at);
    if (
      body.artifacts.some(
        (artifact) => utcTimestampToMicros(artifact.published_at) > manifestPublishedAt,
      )
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["published_at"],
        message: "result manifest published_at precedes one of its artifacts",
      });
    }
  });

const manifestDocumentSchema = z
  .object({
    schema_version: z.literal(RESULT_MANIFEST_ENVELOPE_SCHEMA_VERSION),
    document_type: z.literal("result_manifest"),
    body: manifestBodySchema,
  })
  .strict();

/**
 * 解析 MinIO 讀回來的 `result-manifest.json` bytes。
 *
 * @param rawBytes 原始 bytes（digest 對這份 bytes 算，不對 re-serialize 的結果）
 * @returns 契約合格的 manifest body；任何形狀／語意違規一律回 null（呼叫端轉成
 *          `schema_invalid`，不吐部分解析結果）
 */
export function parsePipelineResultManifest(rawBytes: Buffer): PipelineResultManifest | null {
  let document: unknown;
  try {
    document = JSON.parse(rawBytes.toString("utf-8"));
  } catch {
    return null;
  }
  const parsed = manifestDocumentSchema.safeParse(document);
  return parsed.success ? (parsed.data.body as PipelineResultManifest) : null;
}

/** `readPipelineResultManifest` 的失敗分類（每一個都是不同的處置，不可合併）。 */
export type PipelineResultManifestReadFailure =
  /** locator 形狀壞掉（presign／未釘 versionId／pattern 不符）——連線都不該發生。 */
  | "locator_malformed"
  /** locator 指向的 object version 在 MinIO 上不存在。 */
  | "object_not_found"
  /** HEAD 觀測到的 ETag 與 claim 不符。 */
  | "etag_mismatch"
  /** HEAD 觀測到的 size 與 claim 不符。 */
  | "size_mismatch"
  /** 實讀 bytes 的 SHA-256 與 claim 不符（以 MinIO 為準）。 */
  | "digest_mismatch"
  /** 超過 `RESULT_MANIFEST_MAX_BYTES`：fail-closed，不截斷。 */
  | "object_too_large"
  /** bytes 讀到了，但不符 `result-manifest-document/v1` 契約。 */
  | "schema_invalid";

/**
 * manifest 讀取／驗證的 typed 失敗。
 *
 * `code` 是 wire 友善的前綴字串，`failure` 是可 switch 的分類。**訊息只帶 locator
 * 與觀測值**（authority／bucket／key／etag／size／digest），不帶任何 credential。
 */
export class PipelineResultManifestReadError extends Error {
  readonly code: string;

  constructor(
    readonly failure: PipelineResultManifestReadFailure,
    detail: string,
    readonly expected: string | null = null,
    readonly observed: string | null = null,
  ) {
    super(detail);
    this.name = "PipelineResultManifestReadError";
    this.code = `result_manifest_${failure}`;
  }
}

/**
 * 讀取期望值。
 *
 * `etag`／`size_bytes` 為 null 代表呼叫端**沒有** claim 這兩個欄位（例如 detail reader
 * 只從 store 記錄拿得到 ref 與 digest），此時實讀值即事實、不做比對；有 claim 就必須相符。
 */
export interface PipelineResultManifestExpectation {
  ref: string;
  sha256: string | null;
  etag: string | null;
  size_bytes: number | null;
}

export interface PipelineResultManifestReadResult {
  manifest: PipelineResultManifest;
  /** 實讀 bytes 的 SHA-256（唯一權威的 `result_manifest_digest`）。 */
  observed_sha256: string;
  /** HEAD 觀測到的 ETag。 */
  observed_etag: string;
  /** HEAD 觀測到的 size。 */
  observed_size_bytes: number;
  /** locator 的 `?versionId=`（已與 `object_version_id` 對齊過）。 */
  object_version_id: string;
}

export interface PipelineResultManifestReadDeps {
  /**
   * governed MinIO 讀取面。名稱沿用 task 3.1 的 `SourceBundleObjectPort`：那是
   * **governed locator 通用**的 port（authority／bucket 由 locator 決定、allowlist
   * fail-closed），不是只給 source bundle 用的。legacy `ObjectStorePort` 逐字不動。
   */
  objects: SourceBundleObjectPort;
}

/**
 * 由 governed locator 讀出一份已驗證的 result manifest。
 *
 * 順序（與 `sourceBundleValidator.validateSourceBundle` 同構，壞在前面就不往下走）：
 *   1. locator 形狀（`assertLocatorConsistent` ＋ `parseMinioRef`）
 *   2. HEAD（不存在／ETag／size）
 *   3. 有界讀 bytes（超限 fail-closed）
 *   4. SHA-256 重算比對 claim
 *   5. 契約解析
 *
 * allowlist 拒絕（`SourceBundleAccessDeniedError`）與其他上游錯誤一律**向上
 * propagate**：那是部署邊界／基礎設施事實，收斂成「manifest 有問題」會謊報。
 */
export async function readPipelineResultManifest(
  expectation: PipelineResultManifestExpectation,
  deps: PipelineResultManifestReadDeps,
): Promise<PipelineResultManifestReadResult> {
  const parsedRef = parseMinioRef(expectation.ref);
  if (isRefParseFailure(parsedRef)) {
    throw new PipelineResultManifestReadError(
      "locator_malformed",
      `result manifest locator is not a governed immutable ref (${parsedRef.error})`,
      "minio://<authority>/<bucket>/<key>?versionId=<id>",
      null,
    );
  }

  const head = await deps.objects.headVersioned(parsedRef);
  if (head === null) {
    throw new PipelineResultManifestReadError(
      "object_not_found",
      `result manifest object version ${parsedRef.versionId} does not exist in MinIO`,
      parsedRef.versionId,
      null,
    );
  }
  if (expectation.etag !== null && head.etag !== expectation.etag) {
    throw new PipelineResultManifestReadError(
      "etag_mismatch",
      "claimed result manifest ETag does not match the MinIO observation",
      expectation.etag,
      head.etag,
    );
  }
  if (expectation.size_bytes !== null && head.sizeBytes !== expectation.size_bytes) {
    throw new PipelineResultManifestReadError(
      "size_mismatch",
      "claimed result manifest size_bytes does not match the MinIO observation",
      String(expectation.size_bytes),
      String(head.sizeBytes),
    );
  }

  let rawBytes: Buffer;
  try {
    rawBytes = await deps.objects.getBytesVersioned(parsedRef, RESULT_MANIFEST_MAX_BYTES);
  } catch (error) {
    if (error instanceof SourceBundleObjectTooLargeError) {
      // object 存在但無法在上限內完整讀取 → 算不出 digest，也就無從驗證；誠實記成
      // 讀取失敗，不退化成「讀到一半的 manifest」。
      throw new PipelineResultManifestReadError(
        "object_too_large",
        "result manifest exceeds the bounded read limit and cannot be digest-verified",
        `<= ${RESULT_MANIFEST_MAX_BYTES} bytes`,
        `> ${RESULT_MANIFEST_MAX_BYTES} bytes`,
      );
    }
    throw error;
  }

  const observedSha256 = sha256Hex(rawBytes);
  if (expectation.sha256 !== null && observedSha256 !== expectation.sha256) {
    throw new PipelineResultManifestReadError(
      "digest_mismatch",
      "claimed result manifest digest does not match the bytes read from MinIO",
      expectation.sha256,
      observedSha256,
    );
  }

  const manifest = parsePipelineResultManifest(rawBytes);
  if (manifest === null) {
    throw new PipelineResultManifestReadError(
      "schema_invalid",
      `result manifest bytes do not satisfy ${RESULT_MANIFEST_ENVELOPE_SCHEMA_VERSION}`,
      RESULT_MANIFEST_ENVELOPE_SCHEMA_VERSION,
      null,
    );
  }

  return {
    manifest,
    observed_sha256: observedSha256,
    observed_etag: head.etag,
    observed_size_bytes: head.sizeBytes,
    object_version_id: parsedRef.versionId,
  };
}

/** 逐 artifact 實體觀測的失敗分類。 */
export type PipelineResultArtifactObservationFailure =
  /** manifest 引用的 object version 在 MinIO 上不存在（已刪／從未寫入）。 */
  | "artifact_not_found"
  /** object 在，但 ETag 或 size 與 manifest 宣告不符（被重寫）。 */
  | "artifact_integrity_mismatch";

/**
 * referenced artifact 的觀測失敗。
 *
 * 與 `PipelineResultManifestReadError` 分開：後者說的是「manifest 這份 bytes 有問題」，
 * 這個說的是「manifest 本身沒問題，但它指向的 artifact 已不在或已被改」。
 * `role` 與 `field` 讓呼叫端能直接指出是哪一個引用壞掉。
 */
export class PipelineResultArtifactObservationError extends Error {
  readonly code: string;

  constructor(
    readonly failure: PipelineResultArtifactObservationFailure,
    readonly role: PipelineResultManifestArtifactRole,
    /** integrity mismatch 時是 `etag`／`size_bytes`；not found 時為 null。 */
    readonly field: "etag" | "size_bytes" | null,
    detail: string,
    readonly expected: string | null = null,
    readonly observed: string | null = null,
  ) {
    super(detail);
    this.name = "PipelineResultArtifactObservationError";
    this.code = `result_manifest_${failure}`;
  }
}

/**
 * 逐 referenced artifact 做 **head-level** 實體觀測（design.md §5：只有 manifest
 * 及其 referenced refs/checksums 驗證成功，result 才是 AVAILABLE）。
 *
 * 模式照 `sourceBundleValidator.observeArtifact` 的 head 段：`headVersioned` 比存在性
 * → ETag → `size_bytes`，順序依 manifest 的 artifacts 陣列順序，第一個違規即 fail-closed
 * （單一原因，不累積診斷：這條路徑的結果只有「可不可以註冊」兩種）。
 *
 * **誠實邊界：head-level 觀測，sha256 深驗不在本刀。**
 * `sha256Versioned` 是全量流式重算，GB 級 USDC 在同步 registration 路徑上跑它的
 * 成本裁決屬後續 slice（local-cache observation 邊界）。因此本函式能證的是
 * 「object 還在且 ETag／size 未變」，**不是**「bytes 逐位元組符合 manifest checksum」。
 * 實作升級時只需在同一迴圈補 `sha256Versioned` 比對，不動呼叫端。
 *
 * allowlist 拒絕（`SourceBundleAccessDeniedError`）與其他上游錯誤向上 propagate。
 */
export async function observeReferencedArtifacts(
  manifest: PipelineResultManifest,
  deps: PipelineResultManifestReadDeps,
): Promise<void> {
  for (const artifact of manifest.artifacts) {
    const parsed = parseMinioRef(artifact.ref);
    if (isRefParseFailure(parsed)) {
      // `manifestArtifactSchema` 已保證這裡不可達；真到了就是契約解析漏了一條。
      throw new PipelineResultManifestReadError(
        "schema_invalid",
        `result manifest ${artifact.role} ref is not a governed immutable locator`,
        "minio://<authority>/<bucket>/<key>?versionId=<id>",
        null,
      );
    }
    const head = await deps.objects.headVersioned(parsed);
    if (head === null) {
      throw new PipelineResultArtifactObservationError(
        "artifact_not_found",
        artifact.role,
        null,
        `referenced ${artifact.role} object version ${artifact.object_version_id} does not exist in MinIO`,
        artifact.object_version_id,
        null,
      );
    }
    if (head.etag !== artifact.etag) {
      throw new PipelineResultArtifactObservationError(
        "artifact_integrity_mismatch",
        artifact.role,
        "etag",
        `referenced ${artifact.role} ETag does not match the MinIO observation`,
        artifact.etag,
        head.etag,
      );
    }
    if (head.sizeBytes !== artifact.size_bytes) {
      throw new PipelineResultArtifactObservationError(
        "artifact_integrity_mismatch",
        artifact.role,
        "size_bytes",
        `referenced ${artifact.role} size_bytes does not match the MinIO observation`,
        String(artifact.size_bytes),
        String(head.sizeBytes),
      );
    }
  }
}

/**
 * 由完整 `MinioLocator` 組出讀取期望值，並先做一次 locator 自洽檢查。
 *
 * `assertLocatorConsistent` 擋的是「文件層」的不一致（presign／`?versionId=` 與
 * `object_version_id` 不符／`size_bytes` 為 0），這些在發任何請求之前就該擋掉。
 */
export function locatorExpectation(
  locator: MinioLocator,
): PipelineResultManifestExpectation {
  const inconsistency = assertLocatorConsistent(locator);
  if (inconsistency !== null) {
    throw new PipelineResultManifestReadError(
      "locator_malformed",
      `result manifest locator is internally inconsistent (${inconsistency})`,
      "self-consistent immutable locator",
      inconsistency,
    );
  }
  return {
    ref: locator.ref,
    sha256: locator.sha256,
    etag: locator.etag,
    size_bytes: locator.size_bytes,
  };
}
