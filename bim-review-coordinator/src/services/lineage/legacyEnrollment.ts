// bim-review-coordinator/src/services/lineage/legacyEnrollment.ts
//
// `LEGACY_UNMANAGED` grouping 的**唯讀** preview，與 capability-gated 的升格 confirm。
//
// 契約正本：`tests/contracts/model_version_bundle_manifest.json` 的
// `$defs/legacyUnmanagedPreview` 與 `$defs/legacyEnrollmentConfirmation`。
// Spec：`minio-model-version-bundle/spec.md`「Unmanifested legacy data SHALL 顯式治理升格」。
//
// **preview MUST NOT 修改 MinIO**：`mutates_store` 是契約的 `const false`，
// 本檔的 preview 路徑只呼叫 port 的 list／head 兩支唯讀方法，一次寫入呼叫都沒有。
// `tests/lineage/legacy-enrollment.test.ts` 以 fake port 的寫入計數器當機器證據。
//
// **owner carve-out（2026-08-20 裁決，取代先前的 D-4 preview-only）**：confirm 取得
// 對 governed source bundle **`manifest.json` 這單一 object key** 的 conditional PUT
// （`If-None-Match: *`）寫入權；僅此一 key、僅本路徑。其餘任何 MinIO 寫入仍然禁止。
// carve-out 正本：`bim-review-coordinator/AGENTS.md` 的 Required Boundaries；
// 機器強制在 `sourceBundleObjectPort.assertManifestObjectKey`。
//
// **並行升格**（spec「並行升格登錄」）：唯一的互斥點是 store 端的 conditional create。
// 本檔刻意**不**在 PUT 之前做「先 HEAD 再寫」的檢查當互斥——那是 TOCTOU，兩個
// operator 會雙雙看到「manifest 不存在」然後互相覆寫。preview 階段的 already-governed
// 判定只是使用者體驗上的早期拒絕，不是並行保證。
//
// **不自我背書**：conditional create 成功後，本檔**不**憑自己寫入前的觀測宣告
// `READY`，而是把剛寫好的 manifest 交給 `validateSourceBundle` 由 MinIO 重讀一次。
// 理由有二：(1) spec 要求 coordinator 在宣告 READY 前獨立重驗，用自己寫入時的觀測
// 當證據就是循環論證；(2) 這一趟重讀正好能抓到「掃描與寫入之間 artifact 被改掉」
// 的 TOCTOU。代價是 artifact bytes 被 hash 兩次，這是不自我背書的價格。
//
// **D-5（coordinator 裁決，minimal gate only）**：缺 `authorization_decision_ref`
// → 403 fail closed。真正的 control-plane decision 驗證（issuer／signature／expiry／
// 不可達 fail closed）屬 `lineage-governance-console`（tasks 3.3/3.4）；這裡**只有**
// 存在性 gate，不得被讀成「已授權」。
import crypto from "node:crypto";
import type { StructLogger } from "../../lib/structLog.js";
import { BUNDLE_REQUIRED_ROLES, type ArtifactRole } from "./integrityDiagnostics.js";
import { isRefParseFailure, parseMinioRef } from "./minioLocator.js";
import {
  MANIFEST_ENVELOPE_SCHEMA_VERSION,
  MANIFEST_BODY_SCHEMA_VERSION,
  MANIFEST_DOCUMENT_TYPE,
  sha256Hex,
  type BundleArtifact,
} from "./sourceBundleManifest.js";
import {
  buildMinioRef,
  MANIFEST_OBJECT_NAME,
  parseGovernedPrefix,
  type SourceBundleObjectPort,
  type VersionedObjectSummary,
} from "./sourceBundleObjectPort.js";
import type { SourceBundleRecord, SourceBundleStore } from "./sourceBundleStore.js";
import type { Sha256VerifyMode, validateSourceBundle } from "./sourceBundleValidator.js";

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

/**
 * grouping 湊不出一份**契約合法**的 governed manifest → 在寫入之前 fail closed。
 *
 * L1 `sourceBundleManifest.artifacts` 是 `minItems:3`／`maxItems:3` ＋ 三個 role 各一次，
 * 且每個 artifact 都要 `etag`（minLength 1）與 `sha256`。湊不齊就沒有合法文件可寫。
 *
 * 為什麼要在寫入前擋而不是寫完再讓重驗標 NON_READY：manifest 一旦 conditional-create
 * 成功，這個 grouping 就**永久**變成 governed（manifest 不可覆寫），等於用一份注定
 * NON_READY 的文件把 grouping 鎖死。寧可拒收，讓 operator 先補齊檔案。
 */
export class LegacyEnrollmentIncompleteError extends Error {
  readonly code = "legacy_grouping_incomplete_for_governance";
  readonly httpStatus = 422;

  constructor(
    readonly groupingKey: string,
    detail: string,
  ) {
    super(`legacy grouping ${groupingKey} cannot be enrolled: ${detail}`);
    this.name = "LegacyEnrollmentIncompleteError";
  }
}

// governed manifest 的固定檔名唯一定義在 `sourceBundleObjectPort.ts`（carve-out 的
// 寫入 gate 也用同一個字）；這裡只 re-export，維持既有 import 路徑不變。
export { MANIFEST_OBJECT_NAME };

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

/** confirm 需要的 store 面（只有 `admit`；本路徑不讀、不改既有紀錄）。 */
export type LegacyEnrollmentBundleStore = Pick<SourceBundleStore, "admit">;

/**
 * confirm 專用 deps：在 preview 的唯讀 deps 之上，多出寫入路徑才需要的三件。
 *
 * 刻意用**獨立型別**而不是把三個欄位加成 optional：optional 會讓「忘了注入 store」
 * 變成一個要靠 runtime 分支處理的洞（manifest 寫了、紀錄沒建）。用型別把它變成
 * 編譯期錯誤，這條路徑就不存在。
 */
export interface LegacyEnrollmentConfirmDeps extends LegacyEnrollmentDeps {
  store: LegacyEnrollmentBundleStore;
  /** 寫入後的獨立重驗（不自我背書）；與 route 的 governed ready 路徑用同一支。 */
  validator: typeof validateSourceBundle;
  sha256Mode: Sha256VerifyMode;
}

/** legacy 升格產生的 `source_bundle_id` 前綴（一眼看得出來源不是 producer）。 */
export const LEGACY_ENROLLMENT_ID_PREFIX = "legacy-enrolled-";

/**
 * legacy 升格紀錄的 `tenant_id` 佔位值。
 *
 * tenancy 的 authority 在 external cloud `bim-control`，legacy object path 猜不出來，
 * 而 `SourceBundleRecord.tenant_id` 是必填字串。沿用 validator 的
 * `UNRESOLVED_EXTERNAL_MODEL_VERSION_ID` 慣例，用一個**自我描述**的 sentinel：
 * 任何讀者都不會把它誤讀成一個真的 tenant，也不用空字串製造「看起來有值」的假象。
 */
export const LEGACY_ENROLLMENT_UNASSIGNED_TENANT_ID = "unassigned-legacy-enrollment-tenant";

/**
 * grouping key → 確定性的 `source_bundle_id`。
 *
 * 用 hash 而不是把 grouping key 塞進 id：契約的 id pattern 是 `^[A-Za-z0-9._-]+$`，
 * 而 legacy 路徑本來就可能含中文專案名與 `/`。hash 同時保證**確定性**——兩位 operator
 * 同時升格同一個 grouping 時算出同一個 id，衝突那一方不會憑空造出第二個身分。
 */
export function legacyEnrollmentSourceBundleId(groupingKey: string): string {
  const digest = crypto.createHash("sha256").update(groupingKey, "utf-8").digest("hex");
  return `${LEGACY_ENROLLMENT_ID_PREFIX}${digest.slice(0, 16)}`;
}

/** grouping 之下 `manifest.json` 的寫入座標（authority／bucket 由 governed prefix 決定）。 */
function manifestTarget(
  legacyRootPrefix: string,
  groupingKey: string,
): { authority: string; bucket: string; objectKey: string } {
  const parsed = parseGovernedPrefix(
    groupingPrefix(legacyRootPrefix, groupingKey).replace(/\/$/, ""),
  );
  if (parsed.keyPrefix === "") {
    // bucket 根目錄的 manifest 不屬於本 carve-out（governed manifest 一定住在
    // `<prefix>/<version>/` 之下）。走到這裡代表 prefix 設定壞了，fail closed。
    throw new LegacyGroupingKeyError(
      "legacy grouping resolves to the bucket root; governed manifest must live under a version prefix",
    );
  }
  return {
    authority: parsed.authority,
    bucket: parsed.bucket,
    objectKey: `${parsed.keyPrefix}/${MANIFEST_OBJECT_NAME}`,
  };
}

/** object key 的最後一段（manifest 的 `filename` 欄位用）。 */
function basename(objectKey: string): string {
  const index = objectKey.lastIndexOf("/");
  return index < 0 ? objectKey : objectKey.slice(index + 1);
}

/**
 * 由 preview 的候選推導 governed manifest 的三個 artifact。
 *
 * 這是 confirm **唯一**會讀 bytes 的地方：manifest 每個 artifact 都必須帶 sha256，
 * 而 preview 刻意不算（`digest_unknown`）。etag／size 也在此刻重新 HEAD 一次，
 * 而不是沿用 preview 的 list 觀測——preview 與 confirm 之間可能隔了很久。
 */
async function governedArtifactsFor(
  preview: LegacyUnmanagedPreview,
  deps: LegacyEnrollmentConfirmDeps,
): Promise<BundleArtifact[]> {
  const byRole = new Map(
    preview.candidate_metadata.candidate_artifacts.map((candidate) => [candidate.role, candidate]),
  );
  const artifacts: BundleArtifact[] = [];
  for (const role of BUNDLE_REQUIRED_ROLES) {
    const candidate = byRole.get(role);
    if (!candidate) {
      throw new LegacyEnrollmentIncompleteError(
        preview.grouping_key,
        `缺少 required role ${role}（governed manifest 必須恰有三個 role）`,
      );
    }
    const parsed = parseMinioRef(candidate.ref);
    if (isRefParseFailure(parsed)) {
      throw new LegacyEnrollmentIncompleteError(
        preview.grouping_key,
        `role ${role} 的 locator 不是合法 governed ref（${parsed.error}）`,
      );
    }
    const head = await deps.objects.headVersioned(parsed);
    if (head === null) {
      throw new LegacyEnrollmentIncompleteError(
        preview.grouping_key,
        `role ${role} 的 object version 在 confirm 當下已不存在（preview 之後被改動）`,
      );
    }
    if (head.etag === "" || head.sizeBytes <= 0) {
      throw new LegacyEnrollmentIncompleteError(
        preview.grouping_key,
        `role ${role} 的 object 不完整（etag/size 缺或為 0），無法組出契約合法的 manifest`,
      );
    }
    artifacts.push({
      role,
      ref: candidate.ref,
      object_version_id: parsed.versionId,
      etag: head.etag,
      sha256: await deps.objects.sha256Versioned(parsed),
      size_bytes: head.sizeBytes,
      filename: basename(parsed.objectKey),
    });
  }
  return artifacts;
}

/** 依 L1 `$defs/sourceBundleManifest` 組出 governed manifest 文件（envelope ＋ body）。 */
function buildLegacyManifestDocument(args: {
  sourceBundleId: string;
  identity: DerivedGroupingIdentity;
  confirmedBySubject: string;
  confirmedAt: string;
  artifacts: BundleArtifact[];
}): Record<string, unknown> {
  const body: Record<string, unknown> = {
    manifest_schema_version: MANIFEST_BODY_SCHEMA_VERSION,
    source_bundle_id: args.sourceBundleId,
    external_model_version_id: args.identity.external_model_version_id,
    // tenant_id 刻意不寫（L1 optional）：edge 不從 object path 猜 tenancy。
    project_id: args.identity.project_id,
    project_display_name: args.identity.project_display_name,
    producer: {
      // legacy 升格沒有 external worker：manifest 的產生者就是確認升格的 subject。
      producer_id: args.confirmedBySubject,
      producer_kind: "legacy_enrollment",
    },
    // 這份 manifest 是此刻才存在的；artifact bytes 的原始建立時間 legacy 資料沒有保留，
    // 不從 object mtime 反推一個看似精確的 created_at。
    created_at: args.confirmedAt,
    published_at: args.confirmedAt,
    artifacts: args.artifacts,
  };
  if (args.identity.model_category !== null) body.model_category = args.identity.model_category;
  return {
    schema_version: MANIFEST_ENVELOPE_SCHEMA_VERSION,
    document_type: MANIFEST_DOCUMENT_TYPE,
    body,
  };
}

/**
 * 顯式升格一個 legacy grouping（capability-gated conditional create）。
 *
 * 順序（每一步都 fail closed）：
 * 1. D-5 最小 gate —— 缺 `authorizationDecisionRef` 或 `confirmedBySubject` → 403。
 *    先判它，未授權的請求才不會換到後面的 grouping 診斷。
 * 2. 重跑一次 preview —— 呼叫端稍早看到的 preview **非權威**：grouping 可能在這段
 *    時間內已被別人升格（409）、或 artifact 已被刪（404）。
 * 3. 讀 bytes 補齊三個 role 的 sha256／etag／size，湊不出合法 manifest → 422（寫入前）。
 * 4. conditional create `manifest.json`（`If-None-Match: *`）——唯一的並行互斥點。
 * 5. created → 交給 `validateSourceBundle` 由 MinIO 重讀重驗，再以重驗結論落 store 紀錄；
 *    conflict → `created_source_bundle_id: null` ＋ `retryable: true`，**不覆寫**。
 */
export async function confirmLegacyEnrollment(
  input: LegacyEnrollmentConfirmInput,
  deps: LegacyEnrollmentConfirmDeps,
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

  const identity = deriveGroupingIdentity(groupingKey);
  const preview = await previewLegacyGrouping(groupingKey, deps);
  const artifacts = await governedArtifactsFor(preview, deps);

  const confirmedAt = deps.now();
  const sourceBundleId = legacyEnrollmentSourceBundleId(groupingKey);
  const manifestDocument = buildLegacyManifestDocument({
    sourceBundleId,
    identity,
    confirmedBySubject: subject,
    confirmedAt,
    artifacts,
  });
  // 序列化格式與 L1 fixtures 一致（2-space ＋ 結尾換行）；digest 對這份 bytes 計算。
  const manifestBytes = Buffer.from(`${JSON.stringify(manifestDocument, null, 2)}\n`, "utf-8");
  const manifestSha256 = sha256Hex(manifestBytes);
  const target = manifestTarget(deps.legacyRootPrefix, groupingKey);

  const created = await deps.objects.putIfAbsent(target, manifestBytes, "application/json");
  const confirmation: LegacyEnrollmentConfirmation = {
    grouping_key: groupingKey,
    confirmed_by_subject: subject,
    capability: "bundle.publish",
    authorization_decision_ref: decisionRef,
    confirmed_at: confirmedAt,
    conditional_create: { outcome: created.outcome },
    created_source_bundle_id: created.outcome === "created" ? sourceBundleId : null,
    // conflict 一律可重試：輸家該做的是重新 preview（grouping 現在是 governed 了），
    // 不是覆寫。created 沒有「重試」的語意，故為 false。
    retryable: created.outcome === "conflict_existing_manifest",
  };

  if (created.outcome === "conflict_existing_manifest") {
    deps.structLog?.warn("legacy-enrollment", "legacy enrollment lost the conditional create", {
      grouping_key: groupingKey,
      capability: "bundle.publish",
      outcome: created.outcome,
      retryable: true,
    });
    return confirmation;
  }

  // 不自我背書：重讀剛寫好的 manifest 與其引用的 artifact，由重驗決定 bundle_state。
  const manifestRef = buildMinioRef({ ...target, versionId: created.versionId });
  const validation = await deps.validator(
    {
      source_bundle_id: sourceBundleId,
      external_model_version_id: identity.external_model_version_id,
      manifest_sha256: manifestSha256,
      manifest_ref: {
        ref: manifestRef,
        object_version_id: created.versionId,
        etag: created.etag,
        sha256: manifestSha256,
        size_bytes: manifestBytes.length,
      },
    },
    {
      objects: deps.objects,
      now: deps.now,
      sha256Mode: deps.sha256Mode,
      structLog: deps.structLog,
    },
  );

  const record: SourceBundleRecord = {
    source_bundle_id: sourceBundleId,
    external_model_version_id: validation.external_model_version_id,
    tenant_id: LEGACY_ENROLLMENT_UNASSIGNED_TENANT_ID,
    project_id: identity.project_id,
    project_display_name: identity.project_display_name,
    model_category: identity.model_category,
    manifest_ref: manifestRef,
    manifest_sha256: validation.manifest_sha256 ?? manifestSha256,
    bundle_state: validation.bundle_state,
    integrity_diagnostics: validation.integrity_diagnostics,
    producer_id: subject,
    producer_kind: "legacy_enrollment",
    // legacy 升格沒有 producer claim；confirm 這個動作本身就是 claim。
    claimed_at: confirmedAt,
    validated_at: validation.observed_at,
    // 3.2 的 auto-enqueue 不由本路徑觸發（只有 READY 可持有 job，且綁定屬 3.2）。
    pipeline_job_id: null,
    created_at: confirmedAt,
    updated_at: confirmedAt,
  };
  const admitted = deps.store.admit(record);

  deps.structLog?.info("legacy-enrollment", "legacy grouping enrolled", {
    grouping_key: groupingKey,
    source_bundle_id: sourceBundleId,
    capability: "bundle.publish",
    bundle_state: validation.bundle_state,
    diagnostic_count: validation.integrity_diagnostics.length,
    admit_outcome: admitted.outcome,
  });
  if (admitted.outcome === "conflict_different_digest") {
    // manifest 是新建的，但同一個 id 已有異 digest 的舊紀錄（先前升格後 manifest 被
    // 刪除又重建）。MinIO 端的事實仍是 created，故 confirmation 不改；紀錄面的衝突
    // 由 store 保留舊紀錄（READY 不可原地覆寫），並在此誠實留下 warn。
    deps.structLog?.warn("legacy-enrollment", "enrolled manifest conflicts with an existing record", {
      grouping_key: groupingKey,
      source_bundle_id: sourceBundleId,
    });
  }
  return confirmation;
}
