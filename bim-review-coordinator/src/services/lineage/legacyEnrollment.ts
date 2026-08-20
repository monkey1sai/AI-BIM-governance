// bim-review-coordinator/src/services/lineage/legacyEnrollment.ts
//
// `LEGACY_UNMANAGED` grouping 的**唯讀** preview，與（尚未開放的）升格 confirm。
//
// 契約正本：`tests/contracts/model_version_bundle_manifest.json` 的
// `$defs/legacyUnmanagedPreview` 與 `$defs/legacyEnrollmentConfirmation`。
// Spec：`minio-model-version-bundle/spec.md`「Unmanifested legacy data SHALL 顯式治理升格」。
//
// **preview MUST NOT 修改 MinIO**：`mutates_store` 是契約的 `const false`，
// 本檔的 preview 路徑只呼叫 port 的 list／head 兩支唯讀方法，一次寫入呼叫都沒有。
// `tests/lineage/legacy-enrollment.test.ts` 以 fake port 的寫入計數器當機器證據。
//
// **D-4（coordinator 裁決，preview-only）**：confirm 的 MinIO conditional PUT
// **不在本輪實作**。`confirmLegacyEnrollment` 一律 fail-closed 拋
// `LegacyEnrollmentNotImplementedError`（501，`awaiting owner carve-out`）。
// coordinator 至今只讀 MinIO，取得寫入權責需要 owner 對
// `bim-review-coordinator/AGENTS.md` 的明示 carve-out。
//
// **D-5（coordinator 裁決，minimal gate only）**：缺 `authorization_decision_ref`
// → 403 fail closed。真正的 control-plane decision 驗證（issuer／signature／expiry／
// 不可達 fail closed）屬 `lineage-governance-console`（tasks 3.3/3.4）；這裡**只有**
// 存在性 gate，不得被讀成「已授權」。
import type { StructLogger } from "../../lib/structLog.js";
import { BUNDLE_REQUIRED_ROLES, type ArtifactRole } from "./integrityDiagnostics.js";
import {
  parseGovernedPrefix,
  type SourceBundleObjectPort,
  type VersionedObjectSummary,
} from "./sourceBundleObjectPort.js";

/** L1 `$defs/legacyCandidateArtifact`。digest 可為 unknown：preview 不得為了算 SHA-256 而讀 bytes。 */
export interface LegacyCandidateArtifact {
  role: ArtifactRole;
  ref: string;
  object_version_id?: string | null;
  etag?: string | null;
  size_bytes?: number | null;
}

/** L1 `$defs/legacyCandidateMetadata`。 */
export interface LegacyCandidateMetadata {
  external_model_version_id?: string | null;
  tenant_id?: string | null;
  project_id?: string | null;
  project_display_name?: string | null;
  model_category?: string | null;
  candidate_artifacts: LegacyCandidateArtifact[];
}

export type LegacyDifferenceKind =
  | "missing_manifest"
  | "missing_artifact"
  | "extra_artifact"
  | "metadata_mismatch"
  | "digest_unknown";

/** L1 `$defs/legacyDifference`。 */
export interface LegacyDifference {
  field: string;
  difference_kind: LegacyDifferenceKind;
  candidate_value: string | null;
  governed_value: string | null;
}

/** L1 `$defs/legacyUnmanagedPreview`。 */
export interface LegacyUnmanagedPreview {
  grouping_key: string;
  state: "LEGACY_UNMANAGED";
  candidate_metadata: LegacyCandidateMetadata;
  differences: LegacyDifference[];
  mutates_store: false;
  requires_capability: "bundle.publish";
  observed_at: string;
}

/** L1 `$defs/legacyEnrollmentConfirmation`。 */
export interface LegacyEnrollmentConfirmation {
  grouping_key: string;
  confirmed_by_subject: string;
  capability: "bundle.publish";
  authorization_decision_ref: string;
  confirmed_at: string;
  conditional_create: { outcome: "created" | "conflict_existing_manifest" };
  created_source_bundle_id: string | null;
  retryable: boolean;
}

export interface LegacyEnrollmentDeps {
  objects: SourceBundleObjectPort;
  /**
   * governed legacy 掃描根，形如 `minio://<authority>/<bucket>/<prefix>`。
   *
   * 對外輸出的 `grouping_key` 只保留**相對**路徑，authority／bucket 不外流
   * （repo 為 PUBLIC，evidence 不得出現真實 endpoint／bucket 名）。
   */
  legacyRootPrefix: string;
  now: () => string;
  structLog?: StructLogger;
}

/** grouping key 形狀不合法（空段／`.`／`..`／段數不足）。 */
export class LegacyGroupingKeyError extends Error {
  readonly code = "legacy_grouping_key_malformed";
  readonly httpStatus = 400;

  constructor(detail: string) {
    super(detail);
    this.name = "LegacyGroupingKeyError";
  }
}

/** grouping 之下沒有任何可辨識的候選 artifact（契約要求 `candidate_artifacts` 至少 1 筆）。 */
export class LegacyGroupingNotFoundError extends Error {
  readonly code = "legacy_grouping_not_found";
  readonly httpStatus = 404;

  constructor(readonly groupingKey: string) {
    super(`legacy grouping ${groupingKey} has no recognisable candidate artifact`);
    this.name = "LegacyGroupingNotFoundError";
  }
}

/** grouping 已經有 `manifest.json`：它不是 `LEGACY_UNMANAGED`。 */
export class LegacyGroupingAlreadyGovernedError extends Error {
  readonly code = "legacy_grouping_already_governed";
  readonly httpStatus = 409;

  constructor(readonly groupingKey: string) {
    super(`legacy grouping ${groupingKey} already carries a governed manifest.json`);
    this.name = "LegacyGroupingAlreadyGovernedError";
  }
}

/** D-5：缺 `authorization_decision_ref`／`confirmed_by_subject` → fail closed。 */
export class LegacyEnrollmentAuthorizationError extends Error {
  readonly code = "authorization_decision_ref_required";
  readonly httpStatus = 403;

  constructor(detail: string) {
    super(detail);
    this.name = "LegacyEnrollmentAuthorizationError";
  }
}

/** D-4：confirm 的 MinIO 寫入尚未取得 owner carve-out。 */
export class LegacyEnrollmentNotImplementedError extends Error {
  readonly code = "legacy_enrollment_awaiting_owner_carve_out";
  readonly httpStatus = 501;

  constructor(
    detail = "legacy enrollment conditional create is awaiting owner carve-out; preview is read-only and already available",
  ) {
    super(detail);
    this.name = "LegacyEnrollmentNotImplementedError";
  }
}

/** governed manifest 的固定檔名（discovery 與 legacy 判定共用同一個字）。 */
export const MANIFEST_OBJECT_NAME = "manifest.json";

/**
 * 副檔名 → role。canonical 檔名是 `model.rvt`／`schedule.csv`／`model.ifc`，
 * 但 legacy 資料本來就沒有命名保證，所以判的是副檔名而不是完整檔名。
 */
const EXTENSION_ROLES: ReadonlyArray<[string, ArtifactRole]> = [
  [".rvt", "source_rvt"],
  [".csv", "schedule_csv"],
  [".ifc", "source_ifc"],
];

function roleForObjectKey(objectKey: string): ArtifactRole | null {
  const lowered = objectKey.toLowerCase();
  for (const [extension, role] of EXTENSION_ROLES) {
    if (lowered.endsWith(extension)) return role;
  }
  return null;
}

export interface DerivedGroupingIdentity {
  project_id: string;
  project_display_name: string;
  model_category: string | null;
  external_model_version_id: string;
}

/**
 * 由 grouping key 導出候選 identity。
 *
 * 沿用 `services/minioWatcher.deriveIntakeFromKey` 的「專案／…／種類／版本」約定：
 * 第一段＝專案、最後一段＝版本、倒數第二段＝種類（只有 ≥3 段時才有種類）。
 * 空段與純點段（`.`／`..`）一律拒收——那是路徑穿越形狀，`^[A-Za-z0-9._-]+$`
 * 這類 sanitize 擋不住它。
 *
 * `tenant_id` 刻意**不**導出：tenancy 的 authority 在 external cloud `bim-control`，
 * 從 edge 的 object path 猜一個 tenant 就是在本地偽造 control-plane metadata。
 */
export function deriveGroupingIdentity(groupingKey: string): DerivedGroupingIdentity {
  if (typeof groupingKey !== "string" || groupingKey.includes("\n") || groupingKey.includes("\r")) {
    throw new LegacyGroupingKeyError("grouping key must be a single-line string");
  }
  const trimmed = groupingKey.replace(/\/+$/, "");
  const segments = trimmed.split("/");
  if (segments.length < 2 || segments.some((s) => s === "" || s === "." || s === "..")) {
    throw new LegacyGroupingKeyError(
      `grouping key must have at least 專案/版本 two non-empty segments without . or ..: ${groupingKey}`,
    );
  }
  return {
    project_id: segments[0],
    project_display_name: segments[0],
    model_category: segments.length >= 3 ? segments[segments.length - 2] : null,
    external_model_version_id: segments[segments.length - 1],
  };
}

/** grouping key → 掃描用的完整 governed prefix（結尾補 `/`，避免 boundary 不對齊）。 */
function groupingPrefix(legacyRootPrefix: string, groupingKey: string): string {
  const root = legacyRootPrefix.endsWith("/") ? legacyRootPrefix : `${legacyRootPrefix}/`;
  const relative = groupingKey.replace(/^\/+/, "").replace(/\/+$/, "");
  return `${root}${relative}/`;
}

/**
 * 唯讀推導一個 `LEGACY_UNMANAGED` grouping 的候選 metadata 與差異。
 *
 * `mutates_store` 恆為 `false`：本函式只呼叫 `listObjectsUnder`，一次寫入都沒有。
 *
 * 判定：
 * - grouping 已有 `manifest.json` → 它是 governed，不是 legacy → 409 fail closed
 * - 零個可辨識候選 artifact → 404（契約要求 `candidate_artifacts` 至少 1 筆，
 *   湊不出來時寧可誠實 404，也不吐一份 schema-invalid 的 preview）
 */
export async function previewLegacyGrouping(
  groupingKey: string,
  deps: LegacyEnrollmentDeps,
): Promise<LegacyUnmanagedPreview> {
  const identity = deriveGroupingIdentity(groupingKey);
  const prefix = groupingPrefix(deps.legacyRootPrefix, groupingKey);
  // 先解析一次：prefix 形狀壞掉要在發出任何請求前就紅（fail closed）。
  parseGovernedPrefix(prefix.replace(/\/$/, ""));

  const objects = await deps.objects.listObjectsUnder(prefix);
  if (objects.some((object) => object.objectKey.endsWith(`/${MANIFEST_OBJECT_NAME}`))) {
    throw new LegacyGroupingAlreadyGovernedError(groupingKey);
  }

  const candidates: LegacyCandidateArtifact[] = [];
  const extras: VersionedObjectSummary[] = [];
  const seenRoles = new Set<ArtifactRole>();
  // 同一個 role 有多個候選（例如 `model.rvt` 與 `backup.rvt`）時，取 **object key
  // 字典序第一個**，其餘標 `extra_artifact`。tie-break 必須是確定性的：
  // 兩次 preview 對同一份 legacy 資料若給出不同候選，operator 看到的差異表就沒有意義。
  // `listObjectsUnder` 在兩個 adapter 都回字典序（fake 顯式排序，S3 ListObjectVersions
  // 本來就是 key 序），所以這個順序不是巧合。
  for (const object of objects) {
    const role = roleForObjectKey(object.objectKey);
    if (role === null || seenRoles.has(role)) {
      extras.push(object);
      continue;
    }
    seenRoles.add(role);
    candidates.push({
      role,
      ref: object.ref,
      object_version_id: object.versionId,
      etag: object.etag === "" ? null : object.etag,
      size_bytes: object.sizeBytes,
    });
  }
  if (candidates.length === 0) throw new LegacyGroupingNotFoundError(groupingKey);
  // 契約的 candidate_artifacts 依 role 順序呈現，讓兩次 preview 的輸出可逐字比對。
  candidates.sort(
    (a, b) => BUNDLE_REQUIRED_ROLES.indexOf(a.role) - BUNDLE_REQUIRED_ROLES.indexOf(b.role),
  );

  const differences: LegacyDifference[] = [
    {
      field: MANIFEST_OBJECT_NAME,
      difference_kind: "missing_manifest",
      candidate_value: null,
      governed_value: "source-bundle-manifest/v1",
    },
  ];
  for (const role of BUNDLE_REQUIRED_ROLES) {
    if (!seenRoles.has(role)) {
      differences.push({
        field: `artifacts[${role}]`,
        difference_kind: "missing_artifact",
        candidate_value: null,
        governed_value: role,
      });
    }
  }
  for (const candidate of candidates) {
    // preview 不算 SHA-256：那要讀完整 bytes（governed bundle 動輒數百 MB），
    // 而 governed manifest 每個 artifact 都必須帶 sha256 → 逐個標 digest_unknown。
    differences.push({
      field: `artifacts[${candidate.role}].sha256`,
      difference_kind: "digest_unknown",
      candidate_value: null,
      governed_value: "sha256",
    });
  }
  for (const extra of extras) {
    differences.push({
      field: extra.objectKey,
      difference_kind: "extra_artifact",
      candidate_value: extra.objectKey,
      governed_value: null,
    });
  }

  deps.structLog?.info("legacy-enrollment", "legacy grouping previewed", {
    grouping_key: groupingKey,
    candidate_count: candidates.length,
    difference_count: differences.length,
    mutates_store: false,
  });

  return {
    grouping_key: groupingKey,
    state: "LEGACY_UNMANAGED",
    candidate_metadata: {
      external_model_version_id: identity.external_model_version_id,
      // tenant authority 在 external cloud；edge 不從 object path 猜。
      tenant_id: null,
      project_id: identity.project_id,
      project_display_name: identity.project_display_name,
      model_category: identity.model_category,
      candidate_artifacts: candidates,
    },
    differences: differences.slice(0, 64),
    mutates_store: false,
    requires_capability: "bundle.publish",
    observed_at: deps.now(),
  };
}

export interface LegacyEnrollmentConfirmInput {
  groupingKey: string;
  confirmedBySubject: string;
  authorizationDecisionRef: string;
}

/**
 * 顯式升格一個 legacy grouping。
 *
 * **本輪一律 fail closed**：
 * 1. D-5 最小 gate —— 缺 `authorizationDecisionRef` 或 `confirmedBySubject` → 403。
 *    先判它，是為了讓「沒帶授權」得到的是 403 而不是 501；否則一個未授權的請求會
 *    收到「功能尚未實作」，讀起來像是「授權沒問題，只是還沒做」。
 * 2. D-4 preview-only —— 通過 gate 之後仍拋 501，因為 conditional create 需要
 *    coordinator 對 MinIO 的寫入權責，那還沒拿到 owner carve-out。
 *
 * 回傳型別維持 `Promise<LegacyEnrollmentConfirmation>`（與 worker J 的共同介面契約），
 * 但目前**不存在**能走到 resolve 的路徑——不捏造一份沒有真實 conditional create
 * 支撐的 confirmation 文件。
 */
export async function confirmLegacyEnrollment(
  input: LegacyEnrollmentConfirmInput,
  deps: LegacyEnrollmentDeps,
): Promise<LegacyEnrollmentConfirmation> {
  const groupingKey = (input?.groupingKey ?? "").trim();
  const subject = (input?.confirmedBySubject ?? "").trim();
  const decisionRef = (input?.authorizationDecisionRef ?? "").trim();

  if (groupingKey === "") {
    throw new LegacyGroupingKeyError("grouping key is required");
  }
  if (subject === "") {
    throw new LegacyEnrollmentAuthorizationError(
      "confirmed_by_subject is required: an enrollment must name the subject that confirmed it",
    );
  }
  if (decisionRef === "") {
    throw new LegacyEnrollmentAuthorizationError(
      "authorization_decision_ref is required: bundle.publish must name the control-plane decision that authorised it",
    );
  }

  deps.structLog?.warn("legacy-enrollment", "legacy enrollment confirm refused", {
    grouping_key: groupingKey,
    capability: "bundle.publish",
    refusal_code: "legacy_enrollment_awaiting_owner_carve_out",
  });
  throw new LegacyEnrollmentNotImplementedError();
}
