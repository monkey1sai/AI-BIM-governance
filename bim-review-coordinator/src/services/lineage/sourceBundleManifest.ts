// bim-review-coordinator/src/services/lineage/sourceBundleManifest.ts
//
// MinIO `manifest.json` 的解析（純函式，無 I/O）＋ L1 語意層的文件級診斷。
//
// 契約正本：`tests/contracts/model_version_bundle_manifest.json` 的
// `$defs/sourceBundleManifest`（envelope 為
// `{schema_version, document_type: "source_bundle_manifest", body}`）。
// 語意規則正本：`tests/contracts/lineage/semantic_validators.py`
// 的 `validate_bundle_scenario`（同一組 lower_snake wire code，不另創拼法）。
//
// 分層：
//   parseSourceBundleManifest      → **形狀**（envelope／型別／pattern／未知欄位）
//   manifestDocumentDiagnostics    → **文件語意**（role 齊備、locator、authority、發布順序）
//   sourceBundleValidator          → **store 觀測**（HEAD／SHA-256 重驗）
// 三層刻意分開：形狀壞掉時談不了 role，role 湊不齊時談不了 ETag。
import crypto from "node:crypto";
import {
  diagnostic,
  BUNDLE_REQUIRED_ROLES,
  type ArtifactRole,
  type IntegrityDiagnostic,
} from "./integrityDiagnostics.js";
import {
  isRefParseFailure,
  isSha256,
  isUtcTimestamp,
  locatorAuthority,
  locatorDiagnostics,
  parseMinioRef,
  utcTimestampToMillis,
  type MinioLocator,
} from "./minioLocator.js";
import type { BundleProducer } from "./sourceBundleReadyPayload.js";

export type { ArtifactRole, IntegrityDiagnostic };

/** L1 `$defs/bundleArtifact`：locator 欄位攤平後再加 role／filename／content_type。 */
export type BundleArtifact = MinioLocator & {
  role: ArtifactRole;
  filename?: string;
  content_type?: string;
};

/** L1 `$defs/sourceBundleManifest` 的 body。 */
export interface SourceBundleManifest {
  manifest_schema_version: "source-bundle-manifest/v1";
  source_bundle_id: string;
  external_model_version_id: string;
  tenant_id?: string;
  project_id?: string;
  project_display_name?: string;
  model_category?: string;
  producer: BundleProducer;
  created_at: string;
  published_at: string;
  artifacts: BundleArtifact[];
}

export type ManifestParseResult =
  | { ok: true; manifest: SourceBundleManifest; sha256: string }
  | { ok: false; diagnostics: IntegrityDiagnostic[] };

export const MANIFEST_ENVELOPE_SCHEMA_VERSION = "model-version-bundle-manifest/v1";
export const MANIFEST_DOCUMENT_TYPE = "source_bundle_manifest";
export const MANIFEST_BODY_SCHEMA_VERSION = "source-bundle-manifest/v1";

const ENVELOPE_ALLOWED_KEYS: ReadonlySet<string> = new Set([
  "schema_version",
  "document_type",
  "body",
]);

const BODY_REQUIRED_KEYS = [
  "manifest_schema_version",
  "source_bundle_id",
  "external_model_version_id",
  "producer",
  "created_at",
  "published_at",
  "artifacts",
] as const;

const BODY_ALLOWED_KEYS: ReadonlySet<string> = new Set<string>([
  ...BODY_REQUIRED_KEYS,
  "tenant_id",
  "project_id",
  "project_display_name",
  "model_category",
]);

const ARTIFACT_REQUIRED_KEYS = [
  "role",
  "ref",
  "object_version_id",
  "etag",
  "sha256",
  "size_bytes",
] as const;

const ARTIFACT_ALLOWED_KEYS: ReadonlySet<string> = new Set<string>([
  ...ARTIFACT_REQUIRED_KEYS,
  "filename",
  "content_type",
]);

const PRODUCER_ALLOWED_KEYS: ReadonlySet<string> = new Set([
  "producer_id",
  "producer_kind",
  "agent_version",
]);

const PRODUCER_KINDS: ReadonlySet<string> = new Set(["external_ifc_worker", "legacy_enrollment"]);

const SAFE_ID_PATTERN = /^[A-Za-z0-9._-]+$/;

const ROLE_SET: ReadonlySet<string> = new Set<string>(BUNDLE_REQUIRED_ROLES);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function codePointLength(value: string): number {
  return [...value].length;
}

function isBoundedString(value: unknown, min: number, max: number): value is string {
  if (typeof value !== "string") return false;
  const length = codePointLength(value);
  return length >= min && length <= max;
}

/** 形狀違規統一收斂成 `semantic_contract_violation`（契約詞彙裡唯一的通用碼）。 */
function shapeViolation(detail: string, expected: string | null = null, observed: string | null = null) {
  return diagnostic("semantic_contract_violation", null, expected, observed, detail);
}

/** 計算 manifest bytes 的 SHA-256（小寫 hex），與 L1 `manifest_sha256` 同一表示。 */
export function sha256Hex(bytes: Buffer): string {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function parseArtifact(
  raw: unknown,
  index: number,
  out: IntegrityDiagnostic[],
): BundleArtifact | null {
  if (!isPlainObject(raw)) {
    out.push(shapeViolation(`artifacts[${index}] 必須是 object`));
    return null;
  }
  for (const key of ARTIFACT_REQUIRED_KEYS) {
    if (!(key in raw)) {
      out.push(shapeViolation(`artifacts[${index}] 缺必填欄位 ${key}`, key, null));
      return null;
    }
  }
  for (const key of Object.keys(raw)) {
    if (!ARTIFACT_ALLOWED_KEYS.has(key)) {
      out.push(shapeViolation(`artifacts[${index}] 帶未定義欄位 ${key}`, null, key));
      return null;
    }
  }
  if (typeof raw.role !== "string" || !ROLE_SET.has(raw.role)) {
    out.push(
      shapeViolation(
        `artifacts[${index}].role 不在 source_rvt/schedule_csv/source_ifc 之內`,
        BUNDLE_REQUIRED_ROLES.join("|"),
        typeof raw.role === "string" ? raw.role : null,
      ),
    );
    return null;
  }
  if (!isBoundedString(raw.ref, 1, 4096)) {
    out.push(shapeViolation(`artifacts[${index}].ref 必須是 1..4096 字元字串`));
    return null;
  }
  if (!isBoundedString(raw.object_version_id, 1, 512)) {
    out.push(shapeViolation(`artifacts[${index}].object_version_id 必須是 1..512 字元字串`));
    return null;
  }
  if (!isBoundedString(raw.etag, 1, 512)) {
    out.push(shapeViolation(`artifacts[${index}].etag 必須是 1..512 字元字串`));
    return null;
  }
  if (!isSha256(raw.sha256)) {
    out.push(shapeViolation(`artifacts[${index}].sha256 必須是 64 位小寫 hex`));
    return null;
  }
  if (typeof raw.size_bytes !== "number" || !Number.isInteger(raw.size_bytes) || raw.size_bytes < 0) {
    out.push(shapeViolation(`artifacts[${index}].size_bytes 必須是 >= 0 的整數`));
    return null;
  }
  if ("filename" in raw && !isBoundedString(raw.filename, 1, 512)) {
    out.push(shapeViolation(`artifacts[${index}].filename 必須是 1..512 字元字串`));
    return null;
  }
  if ("content_type" in raw && !isBoundedString(raw.content_type, 1, 200)) {
    out.push(shapeViolation(`artifacts[${index}].content_type 必須是 1..200 字元字串`));
    return null;
  }
  const artifact: BundleArtifact = {
    role: raw.role as ArtifactRole,
    ref: raw.ref,
    object_version_id: raw.object_version_id,
    etag: raw.etag,
    sha256: raw.sha256,
    size_bytes: raw.size_bytes,
  };
  if (typeof raw.filename === "string") artifact.filename = raw.filename;
  if (typeof raw.content_type === "string") artifact.content_type = raw.content_type;
  return artifact;
}

function parseProducer(raw: unknown, out: IntegrityDiagnostic[]): BundleProducer | null {
  if (!isPlainObject(raw)) {
    out.push(shapeViolation("producer 必須是 object"));
    return null;
  }
  for (const key of Object.keys(raw)) {
    if (!PRODUCER_ALLOWED_KEYS.has(key)) {
      out.push(shapeViolation(`producer 帶未定義欄位 ${key}`, null, key));
      return null;
    }
  }
  if (!isBoundedString(raw.producer_id, 1, 200)) {
    out.push(shapeViolation("producer.producer_id 必須是 1..200 字元字串"));
    return null;
  }
  if (typeof raw.producer_kind !== "string" || !PRODUCER_KINDS.has(raw.producer_kind)) {
    out.push(shapeViolation("producer.producer_kind 不在封閉詞彙內"));
    return null;
  }
  if ("agent_version" in raw && !isBoundedString(raw.agent_version, 1, 120)) {
    out.push(shapeViolation("producer.agent_version 必須是 1..120 字元字串"));
    return null;
  }
  const producer: BundleProducer = {
    producer_id: raw.producer_id,
    producer_kind: raw.producer_kind as BundleProducer["producer_kind"],
  };
  if (typeof raw.agent_version === "string") producer.agent_version = raw.agent_version;
  return producer;
}

/**
 * 解析 MinIO 上的 `manifest.json` bytes。
 *
 * 刻意**不**在這一層檢查 `artifacts` 的 3 個元素數量（契約的
 * `minItems:3`／`maxItems:3`／三個 `contains`）：那三條規則等價於「三個 role 各一次」，
 * 交給語意層才能吐出 `missing_required_role`／`duplicate_role` 這兩個精確的 wire code，
 * 而不是一個籠統的形狀錯。
 *
 * @param rawBytes MinIO 讀回來的原始 bytes（sha256 對這份 bytes 計算，不對 re-serialize 的結果）
 */
export function parseSourceBundleManifest(rawBytes: Buffer): ManifestParseResult {
  const diagnostics: IntegrityDiagnostic[] = [];
  const sha256 = sha256Hex(rawBytes);

  let document: unknown;
  try {
    document = JSON.parse(rawBytes.toString("utf-8"));
  } catch {
    diagnostics.push(shapeViolation("manifest.json 不是合法 JSON"));
    return { ok: false, diagnostics };
  }
  if (!isPlainObject(document)) {
    diagnostics.push(shapeViolation("manifest.json 頂層必須是 object"));
    return { ok: false, diagnostics };
  }
  for (const key of Object.keys(document)) {
    if (!ENVELOPE_ALLOWED_KEYS.has(key)) {
      diagnostics.push(shapeViolation(`envelope 帶未定義欄位 ${key}`, null, key));
      return { ok: false, diagnostics };
    }
  }
  if (document.schema_version !== MANIFEST_ENVELOPE_SCHEMA_VERSION) {
    diagnostics.push(
      shapeViolation(
        "envelope schema_version 不符",
        MANIFEST_ENVELOPE_SCHEMA_VERSION,
        typeof document.schema_version === "string" ? document.schema_version : null,
      ),
    );
    return { ok: false, diagnostics };
  }
  if (document.document_type !== MANIFEST_DOCUMENT_TYPE) {
    diagnostics.push(
      shapeViolation(
        "envelope document_type 不是 source_bundle_manifest",
        MANIFEST_DOCUMENT_TYPE,
        typeof document.document_type === "string" ? document.document_type : null,
      ),
    );
    return { ok: false, diagnostics };
  }
  const body = document.body;
  if (!isPlainObject(body)) {
    diagnostics.push(shapeViolation("envelope body 必須是 object"));
    return { ok: false, diagnostics };
  }
  for (const key of BODY_REQUIRED_KEYS) {
    if (!(key in body)) {
      diagnostics.push(shapeViolation(`body 缺必填欄位 ${key}`, key, null));
      return { ok: false, diagnostics };
    }
  }
  for (const key of Object.keys(body)) {
    if (!BODY_ALLOWED_KEYS.has(key)) {
      diagnostics.push(shapeViolation(`body 帶未定義欄位 ${key}`, null, key));
      return { ok: false, diagnostics };
    }
  }
  if (body.manifest_schema_version !== MANIFEST_BODY_SCHEMA_VERSION) {
    diagnostics.push(
      shapeViolation(
        "manifest_schema_version 不符",
        MANIFEST_BODY_SCHEMA_VERSION,
        typeof body.manifest_schema_version === "string" ? body.manifest_schema_version : null,
      ),
    );
    return { ok: false, diagnostics };
  }
  if (!isBoundedString(body.source_bundle_id, 1, 200) || !SAFE_ID_PATTERN.test(body.source_bundle_id)) {
    diagnostics.push(shapeViolation("source_bundle_id 必須符合 ^[A-Za-z0-9._-]+$ 且長度 1..200"));
    return { ok: false, diagnostics };
  }
  if (!isBoundedString(body.external_model_version_id, 1, 200)) {
    diagnostics.push(shapeViolation("external_model_version_id 必須是 1..200 字元字串"));
    return { ok: false, diagnostics };
  }
  const optionalStrings: Array<[string, number]> = [
    ["tenant_id", 200],
    ["project_id", 200],
    ["project_display_name", 400],
    ["model_category", 200],
  ];
  for (const [key, max] of optionalStrings) {
    if (key in body && !isBoundedString(body[key], 1, max)) {
      diagnostics.push(shapeViolation(`${key} 必須是 1..${max} 字元字串`));
      return { ok: false, diagnostics };
    }
  }
  if (!isUtcTimestamp(body.created_at)) {
    diagnostics.push(shapeViolation("created_at 必須是 calendar-valid 的 UTC timestamp"));
    return { ok: false, diagnostics };
  }
  if (!isUtcTimestamp(body.published_at)) {
    diagnostics.push(shapeViolation("published_at 必須是 calendar-valid 的 UTC timestamp"));
    return { ok: false, diagnostics };
  }
  const producer = parseProducer(body.producer, diagnostics);
  if (!producer) return { ok: false, diagnostics };

  if (!Array.isArray(body.artifacts) || body.artifacts.length === 0) {
    diagnostics.push(shapeViolation("artifacts 必須是非空陣列"));
    return { ok: false, diagnostics };
  }
  const artifacts: BundleArtifact[] = [];
  for (let index = 0; index < body.artifacts.length; index += 1) {
    const artifact = parseArtifact(body.artifacts[index], index, diagnostics);
    if (!artifact) return { ok: false, diagnostics };
    artifacts.push(artifact);
  }

  const manifest: SourceBundleManifest = {
    manifest_schema_version: MANIFEST_BODY_SCHEMA_VERSION,
    source_bundle_id: body.source_bundle_id,
    external_model_version_id: body.external_model_version_id,
    producer,
    created_at: body.created_at,
    published_at: body.published_at,
    artifacts,
  };
  if (typeof body.tenant_id === "string") manifest.tenant_id = body.tenant_id;
  if (typeof body.project_id === "string") manifest.project_id = body.project_id;
  if (typeof body.project_display_name === "string") {
    manifest.project_display_name = body.project_display_name;
  }
  if (typeof body.model_category === "string") manifest.model_category = body.model_category;

  return { ok: true, manifest, sha256 };
}

/**
 * 三個 required role 必須各出現恰好一次（`_check_required_roles` 的逐字對應）。
 */
export function requiredRoleDiagnostics(
  artifacts: ReadonlyArray<{ role: ArtifactRole }>,
): IntegrityDiagnostic[] {
  const out: IntegrityDiagnostic[] = [];
  const roles = artifacts.map((artifact) => artifact.role);
  const missing = BUNDLE_REQUIRED_ROLES.filter((role) => !roles.includes(role));
  if (missing.length > 0) {
    out.push(
      diagnostic(
        "missing_required_role",
        missing[0],
        missing.join(","),
        roles.join(",") || null,
        `bundle 缺少 required role：${missing.join("、")}`,
      ),
    );
  }
  const duplicated = BUNDLE_REQUIRED_ROLES.filter(
    (role) => roles.filter((candidate) => candidate === role).length > 1,
  );
  if (duplicated.length > 0) {
    out.push(
      diagnostic(
        "duplicate_role",
        duplicated[0],
        "each required role exactly once",
        roles.join(","),
        `role 重複出現：${duplicated.join("、")}`,
      ),
    );
  }
  return out;
}

/**
 * 同一個 bundle 的所有 artifact 必須落在同一個 MinIO authority
 * （`_check_single_authority` 的逐字對應）。跨 authority 的 bundle 無法被當成
 * 一個 immutable 單位 conditional-create／versioned／retained，屬契約違規而非
 * per-object integrity 問題。
 */
export function singleAuthorityDiagnostics(
  artifacts: ReadonlyArray<{ ref: string }>,
): IntegrityDiagnostic[] {
  const authorities = new Set(artifacts.map((artifact) => locatorAuthority(artifact.ref)));
  if (authorities.size <= 1) return [];
  return [
    diagnostic(
      "semantic_contract_violation",
      null,
      "one MinIO authority",
      [...authorities].sort().join(","),
      "同一 bundle 的 artifact 落在多個 MinIO authority",
    ),
  ];
}

/**
 * manifest 文件層的全部語意診斷，順序逐字對齊
 * `semantic_validators.validate_bundle_scenario` 的 `source_bundle_manifest` 分支：
 *
 *   required roles → 逐 artifact locator／completeness → 單一 authority → 發布順序
 *
 * 藍圖 B-1 file 5 把 locator 形狀排在 role 之前，但 L1 語意層實作（也就是契約的
 * canonical 拼法）是 role 先。這裡跟 L1，差異已回報 coordinator。
 */
export function manifestDocumentDiagnostics(manifest: SourceBundleManifest): IntegrityDiagnostic[] {
  const out: IntegrityDiagnostic[] = [];
  out.push(...requiredRoleDiagnostics(manifest.artifacts));
  for (const artifact of manifest.artifacts) {
    out.push(...locatorDiagnostics(artifact, artifact.role));
  }
  out.push(...singleAuthorityDiagnostics(manifest.artifacts));
  if (utcTimestampToMillis(manifest.published_at) < utcTimestampToMillis(manifest.created_at)) {
    out.push(
      diagnostic(
        "manifest_published_before_artifacts",
        null,
        `published_at >= ${manifest.created_at}`,
        manifest.published_at,
        "manifest.json 的 published_at 早於 created_at：manifest 必須最後發布",
      ),
    );
  }
  return out;
}

/** manifest 內指定 role 的 artifact；找不到回 null。 */
export function artifactForRole(
  manifest: SourceBundleManifest,
  role: ArtifactRole,
): BundleArtifact | null {
  return manifest.artifacts.find((artifact) => artifact.role === role) ?? null;
}

/** manifest 宣告的 authority（取第一個 artifact；跨 authority 已由語意層擋下）。 */
export function manifestAuthority(manifest: SourceBundleManifest): string | null {
  const first = manifest.artifacts[0];
  if (!first) return null;
  const parsed = parseMinioRef(first.ref);
  return isRefParseFailure(parsed) ? null : parsed.authority;
}
