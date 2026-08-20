import type { MinioLocator } from "./minioLocator.js";

/**
 * governed source bundle 的 **wire payload validator**（3.1 route 層，純函式、無 I/O）。
 *
 * 契約正本：repo-root `tests/contracts/source_bundle_ready.json`（L1 凍結）。本檔是該
 * schema 的手寫 runtime 對映。選型沿用 repo 既有裁決（`src/lib/structLog.ts:488-491`）：
 * **不把 ajv 拖進 production bundle**，spec-strictness 交由 contract test（ajv-backed
 * Vitest sibling）與本檔逐筆對拍；production 走手寫 validator。零新 dependency。
 *
 * runtime 必須比 JSON Schema 更嚴的兩點（L1 README §2 對 3.x runtime 的硬要求）：
 *  1. **絕對錨定**：JS 的 `$`（無 `m` flag）本身已是字串結尾，不吃結尾換行；但
 *     contract 的 pytest 側以 Python `re` 驗證，其 `$` 會放行結尾換行，故 fixture
 *     內存在「結尾換行」案例。此處再加一道明文 CR/LF 守衛，讓兩側判定一致且可證。
 *  2. **calendar 檢查**：`2026-02-30` 過得了 timestamp pattern，必須另判真實日期。
 *
 * 非本檔責任（刻意留給 `sourceBundleValidator.ts` 的重驗階段）：
 *  - `manifest_ref.ref` 的 `?versionId=` 是否逐字等於 `object_version_id`
 *    （屬 integrity 診斷 `unversioned_locator` → 422，不是 wire malformed → 400）；
 *  - claim 的 `manifest_sha256` 是否等於 MinIO 實讀 digest（`manifest_digest_conflict`）。
 *  claim 非權威：本檔只判「這是不是一個形狀合法的 claim」。
 */

/** L1 `$defs/locator.properties.ref.pattern` 逐字複製。 */
export const MINIO_LOCATOR_REF_PATTERN =
  /^minio:\/\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+\/[^?#\s]+\?versionId=[A-Za-z0-9._~%-]+$/;

/** L1 `$defs/locator.properties.ref.not.pattern` 逐字複製（presigned query 禁用）。 */
export const PRESIGNED_QUERY_PATTERN = /[?&][Xx]-[Aa][Mm][Zz]-/;

/** L1 `$defs/sha256.pattern` 逐字複製。 */
export const SHA256_PATTERN = /^[0-9a-f]{64}$/;

/** L1 `$defs/utcTimestamp.pattern` 逐字複製。 */
export const UTC_TIMESTAMP_PATTERN =
  /^[1-9][0-9]{3}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12][0-9]|3[01])T(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](?:\.[0-9]{1,6})?Z$/;

/**
 * L1 頂層 `not.anyOf` 的逐字對應：dual-authority 禁用欄位。
 * `additionalProperties:false` 已經會擋，但獨立列出讓拒絕原因精確
 * （`forbidden_cloud_field` 而非泛用的 `unexpected_field`），並讓「這是 intake claim、
 * 不是 cloud event」這條規則在 runtime 也是機器可讀的。
 */
export const FORBIDDEN_CLOUD_FIELDS: readonly string[] = Object.freeze([
  "schema_version",
  "event_type",
  "publication_identity",
  "result_manifest_digest",
  "edge_site_id",
  "callback_url",
  "result_refs",
  "alignment_summary",
]);

export type ProducerKind = "external_ifc_worker" | "legacy_enrollment";

/** L1 `$defs/bundleProducer` 的共用別名（services 層以此名引用）。 */
export type BundleProducer = SourceBundleReadyProducer;

export interface SourceBundleReadyProducer {
  producer_id: string;
  producer_kind: ProducerKind;
  agent_version?: string;
}

export type SourceBundleReadyPayload = {
  event: "source_bundle_ready";
  contract_version: "source-bundle-ready/v1";
  correlation_id: string;
  idempotency_key: string;
  source_bundle_id: string;
  external_model_version_id: string;
  tenant_id: string;
  project_id: string;
  project_display_name?: string;
  model_category?: string;
  manifest_ref: MinioLocator;
  manifest_sha256: string;
  claimed_at: string;
  producer: SourceBundleReadyProducer;
};

/**
 * 拒絕原因詞彙。**這不是 L1 契約詞彙**（L1 沒有為 wire rejection 定義 enum），
 * 而是 route 層對外的穩定機器可讀原因碼；`integrityDiagnosticCode` 的 13 個值屬
 * 重驗階段（422），不得與此混用。唯一交集是 `presigned_locator_forbidden`：
 * 形狀層就能判定的 presigned locator 在此直接 400，語意與同名診斷一致。
 */
export const PAYLOAD_REJECTION_REASONS = [
  "not_an_object",
  "missing_required_field",
  "unexpected_field",
  "forbidden_cloud_field",
  "invalid_const",
  "invalid_enum",
  "invalid_type",
  "invalid_length",
  "invalid_pattern",
  "invalid_calendar_date",
  "presigned_locator_forbidden",
] as const;

export type PayloadRejectionReason = (typeof PAYLOAD_REJECTION_REASONS)[number];

/** RFC 6901 JSON pointer（根為空字串），讓 caller 能精確定位違規欄位。 */
export type PayloadRejection = { reason: PayloadRejectionReason; pointer: string };

const ALLOWED_KEYS: ReadonlySet<string> = new Set([
  "event",
  "contract_version",
  "correlation_id",
  "idempotency_key",
  "source_bundle_id",
  "external_model_version_id",
  "tenant_id",
  "project_id",
  "project_display_name",
  "model_category",
  "manifest_ref",
  "manifest_sha256",
  "claimed_at",
  "producer",
]);

const REQUIRED_KEYS: readonly string[] = Object.freeze([
  "event",
  "contract_version",
  "correlation_id",
  "idempotency_key",
  "source_bundle_id",
  "external_model_version_id",
  "tenant_id",
  "project_id",
  "manifest_ref",
  "manifest_sha256",
  "claimed_at",
  "producer",
]);

const LOCATOR_KEYS: ReadonlySet<string> = new Set([
  "ref",
  "object_version_id",
  "etag",
  "sha256",
  "size_bytes",
]);

const LOCATOR_REQUIRED_KEYS: readonly string[] = Object.freeze([
  "ref",
  "object_version_id",
  "etag",
  "sha256",
  "size_bytes",
]);

const PRODUCER_KEYS: ReadonlySet<string> = new Set([
  "producer_id",
  "producer_kind",
  "agent_version",
]);

const PRODUCER_REQUIRED_KEYS: readonly string[] = Object.freeze(["producer_id", "producer_kind"]);

const PRODUCER_KINDS: ReadonlySet<string> = new Set(["external_ifc_worker", "legacy_enrollment"]);

const SOURCE_BUNDLE_ID_PATTERN = /^[A-Za-z0-9._-]+$/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function reject(reason: PayloadRejectionReason, pointer: string): PayloadRejection {
  return { reason, pointer };
}

/**
 * 有界字串：型別 → 無 CR/LF（絕對錨定守衛）→ 長度。任一不合回精確 rejection。
 */
function checkBoundedString(
  value: unknown,
  pointer: string,
  minLength: number,
  maxLength: number,
): PayloadRejection | null {
  if (typeof value !== "string") return reject("invalid_type", pointer);
  if (/[\r\n]/.test(value)) return reject("invalid_pattern", pointer);
  if (value.length < minLength || value.length > maxLength) return reject("invalid_length", pointer);
  return null;
}

/** pattern 過得了但日期不存在（如 `2026-02-30`）→ 明確拒絕。 */
function isRealCalendarDate(timestamp: string): boolean {
  const year = Number.parseInt(timestamp.slice(0, 4), 10);
  const month = Number.parseInt(timestamp.slice(5, 7), 10);
  const day = Number.parseInt(timestamp.slice(8, 10), 10);
  const asUtc = new Date(Date.UTC(year, month - 1, day));
  return (
    asUtc.getUTCFullYear() === year &&
    asUtc.getUTCMonth() === month - 1 &&
    asUtc.getUTCDate() === day
  );
}

function checkUtcTimestamp(value: unknown, pointer: string): PayloadRejection | null {
  if (typeof value !== "string") return reject("invalid_type", pointer);
  if (!UTC_TIMESTAMP_PATTERN.test(value)) return reject("invalid_pattern", pointer);
  if (!isRealCalendarDate(value)) return reject("invalid_calendar_date", pointer);
  return null;
}

function checkLocator(value: unknown, pointer: string): PayloadRejection | null {
  if (!isPlainObject(value)) return reject("invalid_type", pointer);
  for (const key of Object.keys(value)) {
    if (!LOCATOR_KEYS.has(key)) return reject("unexpected_field", `${pointer}/${key}`);
  }
  for (const key of LOCATOR_REQUIRED_KEYS) {
    if (!hasOwn(value, key)) return reject("missing_required_field", `${pointer}/${key}`);
  }

  const refPointer = `${pointer}/ref`;
  const refBounds = checkBoundedString(value.ref, refPointer, 1, 4096);
  if (refBounds) return refBounds;
  const ref = value.ref as string;
  // presigned 先判：兩條規則都會擋掉簽章 URL（`&` 不在 versionId 的字元集內），
  // 但先判 presigned 才能回精確原因，而不是泛用的 invalid_pattern。
  if (PRESIGNED_QUERY_PATTERN.test(ref)) return reject("presigned_locator_forbidden", refPointer);
  if (!MINIO_LOCATOR_REF_PATTERN.test(ref)) return reject("invalid_pattern", refPointer);

  const versionBounds = checkBoundedString(
    value.object_version_id,
    `${pointer}/object_version_id`,
    1,
    512,
  );
  if (versionBounds) return versionBounds;

  const etagBounds = checkBoundedString(value.etag, `${pointer}/etag`, 1, 512);
  if (etagBounds) return etagBounds;

  const sha256Pointer = `${pointer}/sha256`;
  if (typeof value.sha256 !== "string") return reject("invalid_type", sha256Pointer);
  if (!SHA256_PATTERN.test(value.sha256)) return reject("invalid_pattern", sha256Pointer);

  const sizePointer = `${pointer}/size_bytes`;
  if (typeof value.size_bytes !== "number" || !Number.isInteger(value.size_bytes)) {
    return reject("invalid_type", sizePointer);
  }
  if (value.size_bytes < 0) return reject("invalid_length", sizePointer);

  return null;
}

function checkProducer(value: unknown, pointer: string): PayloadRejection | null {
  if (!isPlainObject(value)) return reject("invalid_type", pointer);
  for (const key of Object.keys(value)) {
    if (!PRODUCER_KEYS.has(key)) return reject("unexpected_field", `${pointer}/${key}`);
  }
  for (const key of PRODUCER_REQUIRED_KEYS) {
    if (!hasOwn(value, key)) return reject("missing_required_field", `${pointer}/${key}`);
  }
  const idBounds = checkBoundedString(value.producer_id, `${pointer}/producer_id`, 1, 200);
  if (idBounds) return idBounds;
  const kindPointer = `${pointer}/producer_kind`;
  if (typeof value.producer_kind !== "string") return reject("invalid_type", kindPointer);
  if (!PRODUCER_KINDS.has(value.producer_kind)) return reject("invalid_enum", kindPointer);
  if (hasOwn(value, "agent_version")) {
    const versionBounds = checkBoundedString(
      value.agent_version,
      `${pointer}/agent_version`,
      1,
      120,
    );
    if (versionBounds) return versionBounds;
  }
  return null;
}

/**
 * 逐字對齊 `tests/contracts/source_bundle_ready.json`。回傳成功時的 payload 是
 * **白名單重建**（不 spread 原輸入），故即使日後守衛被改動，未知欄位也不可能滲進
 * 下游 store／log／response。
 */
export function validateSourceBundleReadyPayload(
  input: unknown,
): { ok: true; payload: SourceBundleReadyPayload } | { ok: false; rejection: PayloadRejection } {
  if (!isPlainObject(input)) {
    return { ok: false, rejection: reject("not_an_object", "") };
  }

  // dual-authority ban 最先判（L1 頂層 `not.anyOf` 的 runtime 對應）。
  for (const forbidden of FORBIDDEN_CLOUD_FIELDS) {
    if (hasOwn(input, forbidden)) {
      return { ok: false, rejection: reject("forbidden_cloud_field", `/${forbidden}`) };
    }
  }
  // additionalProperties:false。
  for (const key of Object.keys(input)) {
    if (!ALLOWED_KEYS.has(key)) {
      return { ok: false, rejection: reject("unexpected_field", `/${key}`) };
    }
  }
  for (const key of REQUIRED_KEYS) {
    if (!hasOwn(input, key)) {
      return { ok: false, rejection: reject("missing_required_field", `/${key}`) };
    }
  }

  if (input.event !== "source_bundle_ready") {
    return { ok: false, rejection: reject("invalid_const", "/event") };
  }
  if (input.contract_version !== "source-bundle-ready/v1") {
    return { ok: false, rejection: reject("invalid_const", "/contract_version") };
  }

  const boundedFields: Array<[key: string, min: number, max: number]> = [
    ["correlation_id", 1, 200],
    ["idempotency_key", 1, 200],
    ["source_bundle_id", 1, 200],
    ["external_model_version_id", 1, 200],
    ["tenant_id", 1, 200],
    ["project_id", 1, 200],
  ];
  for (const [key, min, max] of boundedFields) {
    const rejection = checkBoundedString(input[key], `/${key}`, min, max);
    if (rejection) return { ok: false, rejection };
  }
  if (!SOURCE_BUNDLE_ID_PATTERN.test(input.source_bundle_id as string)) {
    return { ok: false, rejection: reject("invalid_pattern", "/source_bundle_id") };
  }

  if (hasOwn(input, "project_display_name")) {
    const rejection = checkBoundedString(input.project_display_name, "/project_display_name", 1, 400);
    if (rejection) return { ok: false, rejection };
  }
  if (hasOwn(input, "model_category")) {
    const rejection = checkBoundedString(input.model_category, "/model_category", 1, 200);
    if (rejection) return { ok: false, rejection };
  }

  const locatorRejection = checkLocator(input.manifest_ref, "/manifest_ref");
  if (locatorRejection) return { ok: false, rejection: locatorRejection };

  if (typeof input.manifest_sha256 !== "string") {
    return { ok: false, rejection: reject("invalid_type", "/manifest_sha256") };
  }
  if (!SHA256_PATTERN.test(input.manifest_sha256)) {
    return { ok: false, rejection: reject("invalid_pattern", "/manifest_sha256") };
  }

  const claimedAtRejection = checkUtcTimestamp(input.claimed_at, "/claimed_at");
  if (claimedAtRejection) return { ok: false, rejection: claimedAtRejection };

  const producerRejection = checkProducer(input.producer, "/producer");
  if (producerRejection) return { ok: false, rejection: producerRejection };

  const locator = input.manifest_ref as Record<string, unknown>;
  const producer = input.producer as Record<string, unknown>;
  const payload: SourceBundleReadyPayload = {
    event: "source_bundle_ready",
    contract_version: "source-bundle-ready/v1",
    correlation_id: input.correlation_id as string,
    idempotency_key: input.idempotency_key as string,
    source_bundle_id: input.source_bundle_id as string,
    external_model_version_id: input.external_model_version_id as string,
    tenant_id: input.tenant_id as string,
    project_id: input.project_id as string,
    manifest_ref: {
      ref: locator.ref as string,
      object_version_id: locator.object_version_id as string,
      etag: locator.etag as string,
      sha256: locator.sha256 as string,
      size_bytes: locator.size_bytes as number,
    },
    manifest_sha256: input.manifest_sha256,
    claimed_at: input.claimed_at as string,
    producer: {
      producer_id: producer.producer_id as string,
      producer_kind: producer.producer_kind as ProducerKind,
      ...(hasOwn(producer, "agent_version")
        ? { agent_version: producer.agent_version as string }
        : {}),
    },
  };
  if (hasOwn(input, "project_display_name")) {
    payload.project_display_name = input.project_display_name as string;
  }
  if (hasOwn(input, "model_category")) {
    payload.model_category = input.model_category as string;
  }
  return { ok: true, payload };
}
