// bim-review-coordinator/src/services/lineage/sourceBundleValidator.ts
//
// Governed source bundle 的**獨立重驗** deep module（task 3.1 的核心）。
//
// 契約正本：`tests/contracts/model_version_bundle_manifest.json` 的
// `$defs/bundleValidationResult`。Spec：
// `openspec/changes/rvt-ifc-usdc-lineage/specs/minio-model-version-bundle/spec.md`
// 「Governed ready claim SHALL 使用additive intake與獨立重驗」。
//
// **claim 非權威**：producer 的 ready claim 只提供 `manifest_ref` 這個入口，
// 其餘一律以 MinIO 實讀為準。claim 宣告的 `manifest_sha256` 與實讀不符時，
// 結果文件記的是**實讀值**，並吐 `manifest_digest_conflict`。
//
// **三層驗證順序**（形狀 → 文件語意 → store 觀測）：
//   1. manifest locator 形狀（presigned／unversioned）
//   2. allowlist（D-3 fail-closed）
//   3. HEAD manifest object（存在／etag／size）
//   4. 讀 manifest bytes → SHA-256 → 解析
//   5. 文件語意（role 齊備、逐 artifact locator、單一 authority、發布順序）
//      —— 順序逐字對齊 `semantic_validators.validate_bundle_scenario`
//   6. 逐 artifact store 觀測（not_found／etag／size／SHA-256）
//
// **D-1（coordinator 裁決）**：預設 `full` = 全量 streaming SHA-256 重驗。
// `SOURCE_BUNDLE_SHA256_VERIFY_MODE=size_etag_only` 是降檔門，降檔時**必須**在
// `integrity_diagnostics` 誠實標示。L1 契約規定 `READY` 的 diagnostics 必須為空，
// 所以降檔模式在契約上**無法**產生 READY——這正是「READY 名副其實」的保證：
// 沒有全量重驗過的 bundle 不得被宣告為 READY。
import type { StructLogger } from "../../lib/structLog.js";
import {
  diagnostic,
  type ArtifactRole,
  type IntegrityDiagnostic,
  type IntegrityDiagnosticCode,
} from "./integrityDiagnostics.js";
import {
  isRefParseFailure,
  locatorDiagnostics,
  parseMinioRef,
  type MinioLocator,
  type ParsedRef,
} from "./minioLocator.js";
import {
  manifestDocumentDiagnostics,
  parseSourceBundleManifest,
  sha256Hex,
  type BundleArtifact,
  type SourceBundleManifest,
} from "./sourceBundleManifest.js";
import {
  SourceBundleAccessDeniedError,
  SourceBundleObjectTooLargeError,
  type SourceBundleObjectPort,
} from "./sourceBundleObjectPort.js";

export type { IntegrityDiagnostic, IntegrityDiagnosticCode };

export type BundleState = "READY" | "NON_READY" | "LEGACY_UNMANAGED";

export type ConditionalCreateOutcome =
  | "created"
  | "already_exists_same_digest"
  | "conflict_different_digest"
  | "not_attempted";

/** 逐欄對齊 L1 `$defs/bundleValidationResult` 的 body。 */
export interface BundleValidationResult {
  source_bundle_id: string;
  external_model_version_id: string;
  manifest_sha256: string | null;
  manifest_present: boolean;
  bundle_state: BundleState;
  conditional_create: { attempted: boolean; outcome: ConditionalCreateOutcome };
  replay: boolean;
  enqueued_pipeline_job_id: string | null;
  integrity_diagnostics: IntegrityDiagnostic[];
  observed_at: string;
}

export type Sha256VerifyMode = "full" | "size_etag_only";

export const SHA256_VERIFY_MODES: readonly Sha256VerifyMode[] = ["full", "size_etag_only"];

export interface SourceBundleValidatorDeps {
  objects: SourceBundleObjectPort;
  now: () => string;
  sha256Mode: Sha256VerifyMode;
  structLog?: StructLogger;
}

/**
 * ready claim 的最小入口。
 *
 * `external_model_version_id` 是**可選**的補充：契約的 validation result 必填它，
 * 但 manifest 讀不到時無從得知。有 claim 值就用 claim 值（並在 manifest 讀得到後
 * 以 manifest 為準覆寫），沒有就落到自我描述的 sentinel。
 */
export interface SourceBundleReadyClaim {
  source_bundle_id: string;
  manifest_ref: MinioLocator;
  manifest_sha256: string;
  external_model_version_id?: string;
}

/**
 * manifest 讀不到時 `external_model_version_id` 的自我描述 sentinel。
 *
 * 契約只要求 1..200 字元，沒有 charset 限制，所以這個值是 schema-valid 的；
 * 它與 `manifest_present: false` ＋ `artifact_not_found` 一起出現，任何讀者都不會
 * 把它誤讀成一個真的 model version。刻意不用空字串（違反 minLength）也不用
 * claim 的 `source_bundle_id`（那會偽裝成一個看似合理的版本號）。
 */
export const UNRESOLVED_EXTERNAL_MODEL_VERSION_ID = "unresolved-manifest-unreadable";

/** manifest.json 的讀取上限。governed manifest 是小檔；超過即視為異常，fail-closed。 */
export const MANIFEST_MAX_BYTES = 1024 * 1024;

const LOG_COMPONENT = "source-bundle-validator";

/**
 * 由 env 字串解析 SHA-256 重驗模式。
 *
 * 未設定 → `full`（最嚴的預設）。設了但拼錯 → 拋錯，讓部署在開機時就紅，
 * 而不是靜默降檔成一個沒人察覺的弱驗證。
 */
export function resolveSha256VerifyMode(raw: string | undefined | null): Sha256VerifyMode {
  const value = (raw ?? "").trim();
  if (value === "") return "full";
  if (value === "full" || value === "size_etag_only") return value;
  throw new RangeError(
    `SOURCE_BUNDLE_SHA256_VERIFY_MODE must be "full" or "size_etag_only", got ${JSON.stringify(value)}`,
  );
}

function notAttempted(): BundleValidationResult["conditional_create"] {
  return { attempted: false, outcome: "not_attempted" };
}

function nonReady(
  claim: SourceBundleReadyClaim,
  externalModelVersionId: string,
  manifestPresent: boolean,
  manifestSha256: string | null,
  diagnostics: IntegrityDiagnostic[],
  observedAt: string,
): BundleValidationResult {
  return {
    source_bundle_id: claim.source_bundle_id,
    external_model_version_id: externalModelVersionId,
    manifest_sha256: manifestSha256,
    manifest_present: manifestPresent,
    bundle_state: "NON_READY",
    conditional_create: notAttempted(),
    replay: false,
    enqueued_pipeline_job_id: null,
    integrity_diagnostics: diagnostics,
    observed_at: observedAt,
  };
}

/** allowlist 拒絕 → `semantic_contract_violation`（不自創第 14 個 code）。 */
function accessDeniedDiagnostic(
  err: SourceBundleAccessDeniedError,
  role: ArtifactRole | null,
): IntegrityDiagnostic {
  return diagnostic(
    "semantic_contract_violation",
    role,
    "authority/bucket in governed allowlist",
    `${err.authority}/${err.bucket}`,
    err.message,
  );
}

/** 解析得出的 `ParsedRef`；形狀壞掉回 null（該情形已由文件層診斷涵蓋）。 */
function resolveLocator(ref: string): ParsedRef | null {
  const parsed = parseMinioRef(ref);
  return isRefParseFailure(parsed) ? null : parsed;
}

/** 逐 artifact 的 store 觀測診斷（HEAD ＋ 依模式的 SHA-256）。 */
async function observeArtifact(
  artifact: BundleArtifact,
  deps: SourceBundleValidatorDeps,
): Promise<IntegrityDiagnostic[]> {
  const out: IntegrityDiagnostic[] = [];
  const parsed = resolveLocator(artifact.ref);
  // locator 形狀壞掉的情形已由文件層 `locatorDiagnostics` 吐過，這裡不重複開槍。
  if (!parsed) return out;

  let head;
  try {
    head = await deps.objects.headVersioned(parsed);
  } catch (err) {
    if (err instanceof SourceBundleAccessDeniedError) {
      out.push(accessDeniedDiagnostic(err, artifact.role));
      return out;
    }
    throw err;
  }
  if (head === null) {
    out.push(
      diagnostic(
        "artifact_not_found",
        artifact.role,
        artifact.object_version_id,
        null,
        "manifest 引用的 object version 在 MinIO 上不存在",
      ),
    );
    return out;
  }
  if (head.etag !== artifact.etag) {
    out.push(
      diagnostic(
        "etag_mismatch",
        artifact.role,
        artifact.etag,
        head.etag,
        "manifest 宣告的 ETag 與 MinIO 目前 object version 不符",
      ),
    );
  }
  if (head.sizeBytes !== artifact.size_bytes) {
    out.push(
      diagnostic(
        "size_mismatch",
        artifact.role,
        String(artifact.size_bytes),
        String(head.sizeBytes),
        "manifest 宣告的 size_bytes 與 MinIO 觀測值不符",
      ),
    );
  }
  if (deps.sha256Mode === "full") {
    let observed: string;
    try {
      observed = await deps.objects.sha256Versioned(parsed);
    } catch (err) {
      if (err instanceof SourceBundleAccessDeniedError) {
        out.push(accessDeniedDiagnostic(err, artifact.role));
        return out;
      }
      throw err;
    }
    if (observed !== artifact.sha256) {
      out.push(
        diagnostic(
          "sha256_mismatch",
          artifact.role,
          artifact.sha256,
          observed,
          "streaming 重算的 SHA-256 與 manifest 宣告值不符",
        ),
      );
    }
  }
  return out;
}

/**
 * 獨立重驗一個 governed source bundle。
 *
 * 回傳的文件在 `bundle_state === "READY"` 時是**中間態**：
 * `conditional_create` 仍是 `{attempted:false, outcome:"not_attempted"}`，因為
 * 「這個 bundle identity 是第一次被收下、重放、還是與既有 digest 衝突」是
 * `SourceBundleStore.admit()` 才知道的事，而 validator 依藍圖不持有 store。
 * 呼叫端**必須**把結果餵給 `finalizeAdmissionOutcome` 之後才可以當成
 * `source_bundle_validation_result` 文件對外送出（L1 的 READY 分支要求
 * `conditional_create.outcome ∈ {created, already_exists_same_digest}`）。
 */
export async function validateSourceBundle(
  claim: SourceBundleReadyClaim,
  deps: SourceBundleValidatorDeps,
): Promise<BundleValidationResult> {
  const observedAt = deps.now();
  const diagnostics: IntegrityDiagnostic[] = [];
  let externalModelVersionId =
    claim.external_model_version_id ?? UNRESOLVED_EXTERNAL_MODEL_VERSION_ID;

  // 1. manifest locator 形狀。壞掉就連連線都不該發生。
  const manifestLocatorDiagnostics = locatorDiagnostics(claim.manifest_ref, null);
  if (manifestLocatorDiagnostics.length > 0) {
    diagnostics.push(...manifestLocatorDiagnostics);
    return nonReady(claim, externalModelVersionId, false, null, diagnostics, observedAt);
  }
  const parsedManifestRef = parseMinioRef(claim.manifest_ref.ref);
  if (isRefParseFailure(parsedManifestRef)) {
    diagnostics.push(
      diagnostic(
        "semantic_contract_violation",
        null,
        "governed minio:// locator",
        null,
        "manifest_ref 不符 governed locator pattern",
      ),
    );
    return nonReady(claim, externalModelVersionId, false, null, diagnostics, observedAt);
  }

  // 2+3. allowlist ＋ HEAD manifest object。
  let manifestHead;
  try {
    manifestHead = await deps.objects.headVersioned(parsedManifestRef);
  } catch (err) {
    if (err instanceof SourceBundleAccessDeniedError) {
      diagnostics.push(accessDeniedDiagnostic(err, null));
      return nonReady(claim, externalModelVersionId, false, null, diagnostics, observedAt);
    }
    throw err;
  }
  if (manifestHead === null) {
    diagnostics.push(
      diagnostic(
        "artifact_not_found",
        null,
        claim.manifest_ref.object_version_id,
        null,
        "claim 指向的 manifest.json object version 在 MinIO 上不存在",
      ),
    );
    return nonReady(claim, externalModelVersionId, false, null, diagnostics, observedAt);
  }
  if (manifestHead.etag !== claim.manifest_ref.etag) {
    diagnostics.push(
      diagnostic(
        "etag_mismatch",
        null,
        claim.manifest_ref.etag,
        manifestHead.etag,
        "claim 宣告的 manifest ETag 與 MinIO 觀測值不符",
      ),
    );
  }
  if (manifestHead.sizeBytes !== claim.manifest_ref.size_bytes) {
    diagnostics.push(
      diagnostic(
        "size_mismatch",
        null,
        String(claim.manifest_ref.size_bytes),
        String(manifestHead.sizeBytes),
        "claim 宣告的 manifest size_bytes 與 MinIO 觀測值不符",
      ),
    );
  }

  // 4. 讀 manifest bytes（小檔，全量讀）→ SHA-256 → 解析。
  let rawBytes: Buffer;
  try {
    rawBytes = await deps.objects.getBytesVersioned(parsedManifestRef, MANIFEST_MAX_BYTES);
  } catch (err) {
    if (err instanceof SourceBundleAccessDeniedError) {
      diagnostics.push(accessDeniedDiagnostic(err, null));
      return nonReady(claim, externalModelVersionId, false, null, diagnostics, observedAt);
    }
    if (err instanceof SourceBundleObjectTooLargeError) {
      // 超大的 manifest.json 是 bundle 的內容問題，不是 coordinator 的基礎設施故障：
      // 收斂成診斷（呼叫端 → 422），不要讓它冒成 500。
      diagnostics.push(
        diagnostic(
          "semantic_contract_violation",
          null,
          `<= ${MANIFEST_MAX_BYTES} bytes`,
          `> ${MANIFEST_MAX_BYTES} bytes`,
          "manifest.json 超過 governed manifest 的讀取上限：object 存在但無法在上限內完整讀取，因此算不出 digest；依契約的 digest 不變式（sha256 為 null 時 manifest_present 記 false）此處記為 not present",
        ),
      );
      return nonReady(claim, externalModelVersionId, false, null, diagnostics, observedAt);
    }
    throw err;
  }
  // 解析成功與否，manifest bytes 的 digest 都是實讀出來的事實（claim 永遠不是 authority）。
  const observedManifestSha256 = sha256Hex(rawBytes);
  const parseResult = parseSourceBundleManifest(rawBytes);

  if (!parseResult.ok) {
    diagnostics.push(...parseResult.diagnostics);
    return nonReady(
      claim,
      externalModelVersionId,
      true,
      observedManifestSha256,
      diagnostics,
      observedAt,
    );
  }
  const manifest: SourceBundleManifest = parseResult.manifest;
  const manifestSha256 = parseResult.sha256;
  externalModelVersionId = manifest.external_model_version_id;

  if (manifestSha256 !== claim.manifest_sha256) {
    // ready claim 重驗：以 MinIO 實讀為準，claim 只是入口。
    diagnostics.push(
      diagnostic(
        "manifest_digest_conflict",
        null,
        claim.manifest_sha256,
        manifestSha256,
        "claim 宣告的 manifest_sha256 與 MinIO 實讀 bytes 的 digest 不符；以 MinIO 為準",
      ),
    );
  }
  if (manifest.source_bundle_id !== claim.source_bundle_id) {
    diagnostics.push(
      diagnostic(
        "semantic_contract_violation",
        null,
        claim.source_bundle_id,
        manifest.source_bundle_id,
        "manifest 宣告的 source_bundle_id 與 ready claim 不符",
      ),
    );
  }

  // 5. 文件語意（順序逐字對齊 semantic_validators.validate_bundle_scenario）。
  diagnostics.push(...manifestDocumentDiagnostics(manifest));

  // 6. 逐 artifact store 觀測（陣列順序）。
  for (const artifact of manifest.artifacts) {
    diagnostics.push(...(await observeArtifact(artifact, deps)));
  }

  // D-1 降檔門的誠實標示。
  if (deps.sha256Mode === "size_etag_only") {
    diagnostics.push(
      diagnostic(
        "semantic_contract_violation",
        null,
        "SOURCE_BUNDLE_SHA256_VERIFY_MODE=full",
        "SOURCE_BUNDLE_SHA256_VERIFY_MODE=size_etag_only",
        "SHA-256 未獨立重驗（只比對 object version／ETag／size）；此 bundle 不得被宣告為 READY",
      ),
    );
  }

  const bundleState: BundleState = diagnostics.length === 0 ? "READY" : "NON_READY";
  deps.structLog?.info(LOG_COMPONENT, "source bundle re-validated", {
    source_bundle_id: claim.source_bundle_id,
    external_model_version_id: externalModelVersionId,
    bundle_state: bundleState,
    sha256_verify_mode: deps.sha256Mode,
    diagnostic_count: diagnostics.length,
  });

  return {
    source_bundle_id: claim.source_bundle_id,
    external_model_version_id: externalModelVersionId,
    manifest_sha256: manifestSha256,
    manifest_present: true,
    bundle_state: bundleState,
    conditional_create: notAttempted(),
    replay: false,
    enqueued_pipeline_job_id: null,
    integrity_diagnostics: diagnostics,
    observed_at: observedAt,
  };
}

/** `SourceBundleStore.admit()` 的三個 outcome。 */
export type BundleAdmissionOutcome =
  | "created"
  | "replay_same_digest"
  | "conflict_different_digest";

/**
 * 把 store 的 create-once 結果併回 validation result，讓它成為一份**契約完整**的
 * `source_bundle_validation_result`。
 *
 * 映射（同時滿足 L1 schema 的 READY 分支與語意層第 8/9/10 條）：
 *
 * | admit                      | conditional_create              | replay | bundle_state |
 * |----------------------------|---------------------------------|--------|--------------|
 * | `created`                  | `{true, created}`               | false  | READY        |
 * | `replay_same_digest`       | `{true, already_exists_same_digest}` | true  | READY   |
 * | `conflict_different_digest`| `{true, conflict_different_digest}`  | false | NON_READY ＋ `immutable_bundle_overwrite_rejected` |
 *
 * `replay` 與 `conflict_different_digest` 刻意互斥：語意層第 9 條把
 * 「conflict 又宣稱是同 bytes 重放」判為 `manifest_digest_conflict`。
 *
 * validation 未通過（NON_READY）時不得有 admission，原樣回傳。
 */
export function finalizeAdmissionOutcome(
  result: BundleValidationResult,
  admission: { outcome: BundleAdmissionOutcome },
): BundleValidationResult {
  if (result.bundle_state !== "READY") return result;
  if (admission.outcome === "created") {
    return { ...result, conditional_create: { attempted: true, outcome: "created" }, replay: false };
  }
  if (admission.outcome === "replay_same_digest") {
    return {
      ...result,
      conditional_create: { attempted: true, outcome: "already_exists_same_digest" },
      replay: true,
    };
  }
  return {
    ...result,
    bundle_state: "NON_READY",
    conditional_create: { attempted: true, outcome: "conflict_different_digest" },
    replay: false,
    enqueued_pipeline_job_id: null,
    integrity_diagnostics: [
      ...result.integrity_diagnostics,
      diagnostic(
        "immutable_bundle_overwrite_rejected",
        null,
        result.manifest_sha256,
        null,
        "同一個 source_bundle_id 已存在且 manifest digest 不同；READY bundle 不可原地覆寫，必須建立新的 source_bundle_id",
      ),
    ],
  };
}

/**
 * 回填 3.2 的 stable job id。只有 READY 可以持有 job（L1「Nothing but READY may
 * hold an enqueued pipeline job」）。
 */
export function withEnqueuedPipelineJob(
  result: BundleValidationResult,
  pipelineJobId: string,
): BundleValidationResult {
  if (result.bundle_state !== "READY") return result;
  return { ...result, enqueued_pipeline_job_id: pipelineJobId };
}

/** 把 validation result 包成 L1 envelope，供 API 回應／持久化使用。 */
export function toValidationResultDocument(result: BundleValidationResult): {
  schema_version: "model-version-bundle-manifest/v1";
  document_type: "source_bundle_validation_result";
  body: BundleValidationResult;
} {
  return {
    schema_version: "model-version-bundle-manifest/v1",
    document_type: "source_bundle_validation_result",
    body: result,
  };
}
