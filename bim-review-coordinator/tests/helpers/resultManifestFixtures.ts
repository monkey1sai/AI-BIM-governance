import crypto from "node:crypto";
import type { MinioLocator } from "../../src/services/lineage/minioLocator.js";
import type { SourceBundleAllowlist } from "../../src/services/lineage/sourceBundleObjectPort.js";
import type { FakeSourceBundleObjectPort } from "./fakeSourceBundleObjectPort.js";

/**
 * governed **result** manifest 的測試語料建構器（`governedBundleFixtures.ts` 的姊妹檔；
 * 那一支蓋 source bundle 的 `manifest.json`，這一支蓋 attempt 的 `result-manifest.json`）。
 *
 * 全部值刻意合成（`edge-test-01` / `lineage-results-test`）：repo 為 PUBLIC，測試語料
 * 不得出現真實 MinIO endpoint、bucket 名或生產 `edge_site_id`。artifact bytes 一律是
 * 幾十位元組的字串——真實 USDC/IFC 不得進 repo（R-5）。
 *
 * 數字取自 `tests/contracts/lineage/fixtures/result_manifest/valid/valid-result-manifest-full.json`，
 * 因此同時滿足 compare-side schema 的 count↔metric 綁定不變式。
 */
export const RESULT_AUTHORITY = "edge-test-01";
export const RESULT_BUCKET = "lineage-results-test";

export const RESULT_ALLOWLIST: SourceBundleAllowlist = {
  allowedAuthorities: [RESULT_AUTHORITY],
  allowedBuckets: [RESULT_BUCKET],
};

export const RESULT_SOURCE_BUNDLE_ID = "source-bundle-test-0001";
export const RESULT_EXTERNAL_MODEL_VERSION_ID = "model-version-test-0001";
export const RESULT_ATTEMPT_ID = "attempt-0007";
export const RESULT_RESULT_ID = "result-0007";
export const RESULT_MANIFEST_VERSION_ID = "v-manifest-0007";
export const RESULT_COMPLETED_AT = "2026-07-16T08:41:03.125Z";
export const RESULT_MANIFEST_PUBLISHED_AT = "2026-07-16T08:40:22.750Z";
export const RESULT_ARTIFACT_PUBLISHED_AT = "2026-07-16T08:39:00Z";

/** manifest 契約 `artifacts` 的四個必備 role（`contains` 子句）。 */
export const RESULT_FIXTURE_ROLES = [
  ["usdc", "model.usdc", "application/octet-stream"],
  ["element_mapping", "element_mapping.json", "application/json"],
  ["alignment_report_json", "alignment_report.json", "application/json"],
  ["alignment_report_csv", "alignment_report.csv", "text/csv"],
] as const;

export type ResultFixtureRole = (typeof RESULT_FIXTURE_ROLES)[number][0];

export function sha256Hex(bytes: Buffer): string {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

/** 與 `createFakeSourceBundleObjectPort` 的預設 ETag 演算法一致。 */
export function fakeEtag(bytes: Buffer): string {
  return sha256Hex(bytes).slice(0, 32);
}

export function attemptKeyPrefix(attemptId: string = RESULT_ATTEMPT_ID): string {
  return `${RESULT_EXTERNAL_MODEL_VERSION_ID}/results/${attemptId}/`;
}

export function resultPrefix(attemptId: string = RESULT_ATTEMPT_ID): string {
  return `minio://${RESULT_AUTHORITY}/${RESULT_BUCKET}/${attemptKeyPrefix(attemptId)}`;
}

export function manifestObjectKey(attemptId: string = RESULT_ATTEMPT_ID): string {
  return `${attemptKeyPrefix(attemptId)}result-manifest.json`;
}

/** referenced artifact 在 fake store 內實際持有的 bytes（每個 role 一份固定合成字串）。 */
export function artifactBytes(role: string): Buffer {
  return Buffer.from(`${role}-fixture-bytes`, "utf-8");
}

export interface ArtifactStoreOverride {
  /** fake store 實際回報的 ETag（改它可製造 integrity mismatch）。 */
  storedEtag?: string;
  /** fake store 實際回報的 size（改它可製造 integrity mismatch）。 */
  storedSizeBytes?: number;
  /** true = 不播種這個 object（製造 artifact_not_found）。 */
  omit?: boolean;
}

export interface SeedResultManifestOptions {
  /** 覆寫 manifest body 的任意欄位（例如 `pipeline_job_id`、`result_id`）。 */
  body?: Record<string, unknown>;
  /** 逐 role 覆寫 fake store 的實體觀測值。 */
  artifacts?: Partial<Record<ResultFixtureRole, ArtifactStoreOverride>>;
  attemptId?: string;
  manifestVersionId?: string;
  /** 直接指定 manifest bytes（繞過 body 組裝，用於 too-large / 非 JSON 場景）。 */
  rawManifestBytes?: Buffer;
}

export interface SeededResultManifest {
  /** governed manifest locator（etag/sha256/size 與實際 bytes 一致）。 */
  locator: MinioLocator;
  /** 實際播進 fake store 的 manifest bytes。 */
  bytes: Buffer;
  /** manifest body（`rawManifestBytes` 模式下為 null）。 */
  body: Record<string, unknown> | null;
}

/** artifact 在 manifest 內宣告的 locator 欄位（宣告值恆取自真 bytes）。 */
function declaredArtifact(
  role: string,
  filename: string,
  contentType: string,
  attemptId: string,
): Record<string, unknown> {
  const bytes = artifactBytes(role);
  return {
    role,
    ref: `minio://${RESULT_AUTHORITY}/${RESULT_BUCKET}/${attemptKeyPrefix(attemptId)}${filename}?versionId=v-0007-${role}`,
    object_version_id: `v-0007-${role}`,
    etag: fakeEtag(bytes),
    sha256: sha256Hex(bytes),
    size_bytes: bytes.length,
    published_at: RESULT_ARTIFACT_PUBLISHED_AT,
    filename,
    content_type: contentType,
  };
}

/** 契約合格的 `result-manifest-document/v1` envelope。 */
export function resultManifestDocument(
  options: SeedResultManifestOptions = {},
): Record<string, unknown> {
  const attemptId = options.attemptId ?? RESULT_ATTEMPT_ID;
  return {
    schema_version: "result-manifest-document/v1",
    document_type: "result_manifest",
    body: {
      manifest_schema_version: "result-manifest/v1",
      result_id: RESULT_RESULT_ID,
      attempt_id: attemptId,
      pipeline_job_id: "PLACEHOLDER",
      source_bundle_id: RESULT_SOURCE_BUNDLE_ID,
      external_model_version_id: RESULT_EXTERNAL_MODEL_VERSION_ID,
      attempt_outcome: "succeeded",
      converter: {
        converter_id: "ifc-usdc-converter",
        converter_version: "2.4.1",
        runtime_profile: "kit-gpu-exclusive",
      },
      result_prefix: resultPrefix(attemptId),
      created_at: "2026-07-16T08:38:40Z",
      published_at: RESULT_MANIFEST_PUBLISHED_AT,
      artifacts: RESULT_FIXTURE_ROLES.map(([role, filename, contentType]) =>
        declaredArtifact(role, filename, contentType, attemptId),
      ),
      alignment_summary: resultAlignmentSummary(),
      ...options.body,
    },
  };
}

/** 契約合格的 `alignment_summary`（單獨導出，方便測試只改其中一欄）。 */
export function resultAlignmentSummary(): Record<string, unknown> {
  return {
    metrics: {
      ifc_usdc_coverage_ratio: {
        numerator: 1200,
        denominator: 1200,
        ratio: 1,
        status: "complete",
      },
      rvt_ifc_alignment_ratio: {
        numerator: 1000,
        denominator: 1000,
        ratio: 1,
        status: "complete",
      },
      rvt_ifc_usdc_lineage_ratio: {
        numerator: 1000,
        denominator: 1000,
        ratio: 1,
        status: "complete",
      },
    },
    counts: {
      csv_total_count: 1000,
      csv_valid_count: 1000,
      eligible_ifc_product_count: 1200,
      duplicate_rvt_id_count: 0,
      duplicate_ifc_guid_count: 0,
      invalid_row_count: 0,
      csv_only_count: 0,
      ifc_only_count: 200,
      ifc_usdc_unmapped_count: 0,
      full_lineage_matched_count: 1000,
    },
    warning_codes: [],
    warning_code_count: 0,
  };
}

/**
 * 把一份 result manifest **與它引用的四個 artifact** 播進 fake object port。
 *
 * 兩者一起播是刻意的：registration 管道在契約驗證後會逐 artifact `headVersioned`，
 * 只播 manifest 的 fixture 會讓每個 happy path 都撞上 `artifact_not_found`——
 * 那正是這一層存在的意義（design.md §5 的 referenced refs 驗證）。
 */
export function seedResultManifest(
  port: FakeSourceBundleObjectPort,
  options: SeedResultManifestOptions = {},
): SeededResultManifest {
  const attemptId = options.attemptId ?? RESULT_ATTEMPT_ID;
  for (const [role, filename] of RESULT_FIXTURE_ROLES) {
    const override = options.artifacts?.[role] ?? {};
    if (override.omit) continue;
    const bytes = artifactBytes(role);
    port.seed({
      authority: RESULT_AUTHORITY,
      bucket: RESULT_BUCKET,
      objectKey: `${attemptKeyPrefix(attemptId)}${filename}`,
      versionId: `v-0007-${role}`,
      bytes,
      etag: override.storedEtag,
      sizeBytes: override.storedSizeBytes,
    });
  }

  const document = options.rawManifestBytes
    ? null
    : (resultManifestDocument(options) as { body: Record<string, unknown> });
  const bytes =
    options.rawManifestBytes ?? Buffer.from(JSON.stringify(document), "utf-8");
  const versionId = options.manifestVersionId ?? RESULT_MANIFEST_VERSION_ID;
  const ref = port.seed({
    authority: RESULT_AUTHORITY,
    bucket: RESULT_BUCKET,
    objectKey: manifestObjectKey(attemptId),
    versionId,
    bytes,
  });

  return {
    locator: {
      ref,
      object_version_id: versionId,
      etag: fakeEtag(bytes),
      sha256: sha256Hex(bytes),
      size_bytes: bytes.length,
    },
    bytes,
    body: document ? document.body : null,
  };
}
