import crypto from "node:crypto";
import type { ArtifactRole } from "../../src/services/lineage/integrityDiagnostics.js";
import type { SourceBundleReadyClaim } from "../../src/services/lineage/sourceBundleValidator.js";
import type { SourceBundleAllowlist } from "../../src/services/lineage/sourceBundleObjectPort.js";
import type { FakeSourceBundleObjectPort } from "./fakeSourceBundleObjectPort.js";

/**
 * governed source-bundle 的測試語料建構器。
 *
 * 全部值刻意是合成的（`edge-test-01` / `source-bundles-test` / `tenant-test`）：
 * repo 為 PUBLIC，測試語料不得出現真實 MinIO endpoint、bucket 名、專案中文原名或
 * 生產 `edge_site_id`。
 *
 * bytes 一律是幾十位元組的字串——真實 RVT/IFC 不得進 repo（R-5），
 * streaming SHA-256 的行為由 fake port 的同一段 hash 程式碼覆蓋。
 */
export const TEST_AUTHORITY = "edge-test-01";
export const TEST_BUCKET = "source-bundles-test";
export const TEST_KEY_PREFIX = "source-bundles/tenant-test/project-test/model-version-test/";

export const TEST_ALLOWLIST: SourceBundleAllowlist = {
  allowedAuthorities: [TEST_AUTHORITY],
  allowedBuckets: [TEST_BUCKET],
};

const ROLE_FILENAMES: Record<ArtifactRole, string> = {
  source_rvt: "model.rvt",
  schedule_csv: "schedule.csv",
  source_ifc: "model.ifc",
};

const ROLE_CONTENT_TYPES: Record<ArtifactRole, string> = {
  source_rvt: "application/octet-stream",
  schedule_csv: "text/csv",
  source_ifc: "application/x-step",
};

const ROLE_VERSION_IDS: Record<ArtifactRole, string> = {
  source_rvt: "v-rvt-0001",
  schedule_csv: "v-csv-0001",
  source_ifc: "v-ifc-0001",
};

export const MANIFEST_VERSION_ID = "v-manifest-0001";

function sha256(bytes: Buffer): string {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

/** 與 `createFakeSourceBundleObjectPort` 的預設 ETag 演算法一致。 */
function fakeEtag(bytes: Buffer): string {
  return sha256(bytes).slice(0, 32);
}

export interface ArtifactOverride {
  /** fake store 實際持有的 bytes（改它可製造 sha256_mismatch）。 */
  storedBytes?: string;
  /** fake store 實際回報的 ETag（改它可製造 etag_mismatch）。 */
  storedEtag?: string;
  /** fake store 實際回報的 size（改它可製造 size_mismatch）。 */
  storedSizeBytes?: number;
  /** 不播種這個 object（製造 artifact_not_found）。 */
  skipSeed?: boolean;
  declaredRef?: string;
  declaredObjectVersionId?: string;
  declaredEtag?: string;
  declaredSha256?: string;
  declaredSizeBytes?: number;
}

export interface SeedBundleOptions {
  sourceBundleId?: string;
  externalModelVersionId?: string;
  keyPrefix?: string;
  authority?: string;
  bucket?: string;
  createdAt?: string;
  publishedAt?: string;
  /** 只播種／宣告這些 role（預設三個都有）。 */
  roles?: ArtifactRole[];
  artifactOverrides?: Partial<Record<ArtifactRole, ArtifactOverride>>;
  /** manifest 序列化前的最後一手修改（製造 duplicate_role、跨 authority 等場景）。 */
  mutateManifestBody?: (body: Record<string, unknown>) => void;
  /** 不播種 manifest.json object（製造 manifest 不存在）。 */
  skipManifestObject?: boolean;
  claimOverrides?: Partial<SourceBundleReadyClaim>;
}

export interface SeededBundle {
  manifestDocument: Record<string, unknown>;
  manifestBytes: Buffer;
  manifestSha256: string;
  manifestObjectKey: string;
  manifestRef: string;
  claim: SourceBundleReadyClaim;
}

/**
 * 在 fake port 上播種一組 governed source bundle，並回傳對應的 ready claim。
 *
 * 預設是**完全乾淨**的 bundle：三個 role 各一次、declared 值與 stored 值逐欄相符、
 * claim 的 `manifest_sha256` 等於實際 manifest bytes 的 digest。每個負向場景只需要
 * 用 override 打壞其中一項，讓「這一條診斷是被什麼打出來的」在測試裡一目了然。
 */
export function seedGovernedBundle(
  port: FakeSourceBundleObjectPort,
  options: SeedBundleOptions = {},
): SeededBundle {
  const authority = options.authority ?? TEST_AUTHORITY;
  const bucket = options.bucket ?? TEST_BUCKET;
  const keyPrefix = options.keyPrefix ?? TEST_KEY_PREFIX;
  const sourceBundleId = options.sourceBundleId ?? "source-bundle-test-0001";
  const externalModelVersionId = options.externalModelVersionId ?? "model-version-test-0001";
  const roles = options.roles ?? (["source_rvt", "schedule_csv", "source_ifc"] as ArtifactRole[]);

  const artifacts: Array<Record<string, unknown>> = [];
  for (const role of roles) {
    const override = options.artifactOverrides?.[role] ?? {};
    const objectKey = `${keyPrefix}${ROLE_FILENAMES[role]}`;
    const versionId = ROLE_VERSION_IDS[role];
    const bytes = Buffer.from(
      override.storedBytes ?? `${role}-bytes-for-${sourceBundleId}`,
      "utf-8",
    );
    const storedEtag = override.storedEtag ?? fakeEtag(bytes);
    const storedSize = override.storedSizeBytes ?? bytes.length;
    if (!override.skipSeed) {
      port.seed({
        authority,
        bucket,
        objectKey,
        versionId,
        bytes,
        etag: storedEtag,
        sizeBytes: storedSize,
      });
    }
    artifacts.push({
      role,
      ref:
        override.declaredRef ??
        `minio://${authority}/${bucket}/${objectKey}?versionId=${versionId}`,
      object_version_id: override.declaredObjectVersionId ?? versionId,
      etag: override.declaredEtag ?? storedEtag,
      sha256: override.declaredSha256 ?? sha256(bytes),
      size_bytes: override.declaredSizeBytes ?? storedSize,
      filename: ROLE_FILENAMES[role],
      content_type: ROLE_CONTENT_TYPES[role],
    });
  }

  const body: Record<string, unknown> = {
    manifest_schema_version: "source-bundle-manifest/v1",
    source_bundle_id: sourceBundleId,
    external_model_version_id: externalModelVersionId,
    tenant_id: "tenant-test",
    project_id: "project-test",
    project_display_name: "project-test",
    model_category: "structure",
    producer: {
      producer_id: "ifc-worker-test-01",
      producer_kind: "external_ifc_worker",
      agent_version: "0.0.1-test",
    },
    created_at: options.createdAt ?? "2026-07-16T07:40:00.000Z",
    published_at: options.publishedAt ?? "2026-07-16T07:58:12.500Z",
    artifacts,
  };
  options.mutateManifestBody?.(body);

  const manifestDocument = {
    schema_version: "model-version-bundle-manifest/v1",
    document_type: "source_bundle_manifest",
    body,
  };
  const manifestBytes = Buffer.from(`${JSON.stringify(manifestDocument, null, 2)}\n`, "utf-8");
  const manifestSha256 = sha256(manifestBytes);
  const manifestObjectKey = `${keyPrefix}manifest.json`;
  const manifestRef = `minio://${authority}/${bucket}/${manifestObjectKey}?versionId=${MANIFEST_VERSION_ID}`;
  const manifestEtag = fakeEtag(manifestBytes);
  if (!options.skipManifestObject) {
    port.seed({
      authority,
      bucket,
      objectKey: manifestObjectKey,
      versionId: MANIFEST_VERSION_ID,
      bytes: manifestBytes,
    });
  }

  const claim: SourceBundleReadyClaim = {
    source_bundle_id: sourceBundleId,
    external_model_version_id: externalModelVersionId,
    manifest_sha256: manifestSha256,
    manifest_ref: {
      ref: manifestRef,
      object_version_id: MANIFEST_VERSION_ID,
      etag: manifestEtag,
      sha256: manifestSha256,
      size_bytes: manifestBytes.length,
    },
    ...options.claimOverrides,
  };

  return {
    manifestDocument,
    manifestBytes,
    manifestSha256,
    manifestObjectKey,
    manifestRef,
    claim,
  };
}

/** 固定時鐘（service 不取時鐘，`now` 一律由呼叫端傳入）。 */
export function fixedNow(iso = "2026-07-16T08:00:00.000Z"): () => string {
  return () => iso;
}

/** 只取診斷 code 序列並去重，形狀對齊 L1 語意 validator 的 `list[str]`。 */
export function dedupedCodes(diagnostics: ReadonlyArray<{ code: string }>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of diagnostics) {
    if (!seen.has(item.code)) {
      seen.add(item.code);
      out.push(item.code);
    }
  }
  return out;
}
