// bim-review-coordinator/src/services/lineage/integrityDiagnostics.ts
//
// Governed source-bundle 的 integrity 診斷詞彙。
//
// 這 13 個 code 是 **封閉詞彙**，逐字取自
// `tests/contracts/model_version_bundle_manifest.json` 的
// `$defs/integrityDiagnosticCode`（L1 契約正本，tasks 2.1）。runtime 側不得
// 自創第二種拼法——語意層（`tests/contracts/lineage/semantic_validators.py`）
// 與 wire enum 已經共用同一組字，多一種拼法就是多一個 authority。
//
// 本檔刻意不含任何 I/O 與 domain 邏輯，只放型別與建構 helper，讓
// minioLocator / sourceBundleManifest / sourceBundleValidator 三層都能引用而
// 不產生循環相依。

/** L1 `$defs/integrityDiagnosticCode` 的 13 個值（順序逐字照抄契約）。 */
export const INTEGRITY_DIAGNOSTIC_CODES = [
  "missing_required_role",
  "duplicate_role",
  "artifact_not_found",
  "artifact_incomplete",
  "etag_mismatch",
  "sha256_mismatch",
  "size_mismatch",
  "manifest_published_before_artifacts",
  "manifest_digest_conflict",
  "unversioned_locator",
  "presigned_locator_forbidden",
  "immutable_bundle_overwrite_rejected",
  "semantic_contract_violation",
] as const;

export type IntegrityDiagnosticCode = (typeof INTEGRITY_DIAGNOSTIC_CODES)[number];

/** L1 `$defs/artifactRole`。 */
export const BUNDLE_REQUIRED_ROLES = ["source_rvt", "schedule_csv", "source_ifc"] as const;

export type ArtifactRole = (typeof BUNDLE_REQUIRED_ROLES)[number];

/**
 * L1 `$defs/integrityDiagnostic`：五個欄位全部必填，`role` 可為 null
 * （bundle 級診斷），`expected`／`observed` 可為 null，`detail` 至少 1 字元。
 */
export interface IntegrityDiagnostic {
  code: IntegrityDiagnosticCode;
  role: ArtifactRole | null;
  expected: string | null;
  observed: string | null;
  detail: string;
}

/** `detail` 的契約上限（L1 `maxLength: 1000`）。 */
const DETAIL_MAX_LENGTH = 1000;

/** `expected`／`observed` 的契約上限（L1 `maxLength: 512`）。 */
const VALUE_MAX_LENGTH = 512;

function clamp(value: string | null, max: number): string | null {
  if (value === null) return null;
  return value.length <= max ? value : value.slice(0, max);
}

/**
 * 建一筆 integrity diagnostic，並把三個字串欄位夾在契約上限內。
 *
 * 夾長度而不是拋錯，是因為 `observed` 可能來自 MinIO 回傳的任意長 ETag／key；
 * 一筆超長的觀測值不該讓整個 validation 變成 500——診斷本身仍然誠實，只是被截斷。
 */
export function diagnostic(
  code: IntegrityDiagnosticCode,
  role: ArtifactRole | null,
  expected: string | null,
  observed: string | null,
  detail: string,
): IntegrityDiagnostic {
  return {
    code,
    role,
    expected: clamp(expected, VALUE_MAX_LENGTH),
    observed: clamp(observed, VALUE_MAX_LENGTH),
    detail: clamp(detail, DETAIL_MAX_LENGTH) ?? detail,
  };
}
