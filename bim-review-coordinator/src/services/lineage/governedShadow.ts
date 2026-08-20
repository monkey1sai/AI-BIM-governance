// bim-review-coordinator/src/services/lineage/governedShadow.ts
//
// Governed minimal shadow metadata（`local-artifact-shadow-metadata` 的 governed 邊界）。
//
// **D-6（coordinator 裁決）**：governed shadow **完全獨立**。
// 既有 12 個 legacy shadow 欄位（`src/types.ts` 的 `ShadowMetadata`）逐字保留、
// 逐 byte 不動；governed 欄位 MUST NOT 塞進 `IfcReadyIntakeJob` 或 `ShadowMetadata`
// （那會讓 `tests/shadow-metadata.test.ts` 與前端契約變形）。兩組欄位的 key 集合
// 刻意零重疊，由 `tests/lineage/governed-shadow.test.ts` 當 ratchet 守住。
//
// **只保存 identity／digest／locator／state**：spec 明文 MUST NOT 保存逐 element
// mapping rows、alignment／report body、artifact bytes、MinIO credentials、
// cloud DB credentials 或 cloud MySQL 內容的複本。
//
// **刻意不宣告尚未擁有的欄位**：spec 的 governed field set 還包含 `attempt_id`、
// `result_id`、`result_manifest_ref`／`_digest`、`active_result_id`、admission state
// （`admission_status`／`runtime_profile`／`requires_exclusive_runtime`／`lease_id`／
// `readiness_evidence[]`／`blocker_codes[]`）與 publication outbox 的
// `publication_identity`／delivery state。那些由 tasks 4.x／5.x 擁有；在 3.1 先把它們
// 宣告成 `null` 會產生「已知為空」的假證據（同 D-9 不捏造 admission evidence 的理由）。
// 欄位到位時循同一 additive 模式擴充本檔即可。
import { maskPresignedRef } from "../presignedRef.js";
import type { SourceBundleRecord } from "./sourceBundleStore.js";
import type { BundleState } from "./sourceBundleValidator.js";

/**
 * Governed source-bundle 的 minimal shadow 投影。
 *
 * `pipeline_job_id` 是 3.2 回填的 stable id；3.1 一律為 null。
 */
export interface GovernedShadowMetadata {
  source_bundle_id: string;
  external_model_version_id: string;
  tenant_id: string;
  project_id: string;
  manifest_ref: string;
  manifest_sha256: string;
  bundle_state: BundleState;
  pipeline_job_id: string | null;
}

/** 機器可讀的 governed shadow 欄位清單（與 legacy 12 欄的零重疊由測試守住）。 */
export const GOVERNED_SHADOW_FIELDS: readonly (keyof GovernedShadowMetadata)[] = [
  "source_bundle_id",
  "external_model_version_id",
  "tenant_id",
  "project_id",
  "manifest_ref",
  "manifest_sha256",
  "bundle_state",
  "pipeline_job_id",
];

/**
 * 把 durable governed 紀錄投影成對外的 minimal shadow。
 *
 * `manifest_ref` 出口套 `maskPresignedRef`：governed locator 依契約本來就不得帶
 * presign 參數，這一道是縱深防禦——與 legacy shadow 對 `source_ifc_ref` 的處置一致，
 * 確保「對外 response 不得含 presigned 簽章」這條誠實鐵律沒有第二種出口。
 */
export function toGovernedShadowMetadata(record: SourceBundleRecord): GovernedShadowMetadata {
  return {
    source_bundle_id: record.source_bundle_id,
    external_model_version_id: record.external_model_version_id,
    tenant_id: record.tenant_id,
    project_id: record.project_id,
    manifest_ref: maskPresignedRef(record.manifest_ref),
    manifest_sha256: record.manifest_sha256,
    bundle_state: record.bundle_state,
    pipeline_job_id: record.pipeline_job_id,
  };
}
