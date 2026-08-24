import { describe, expect, it } from "vitest";
import {
  GOVERNED_SHADOW_FIELDS,
  toGovernedShadowMetadata,
} from "../../src/services/lineage/governedShadow.js";
import type { SourceBundleRecord } from "../../src/services/lineage/sourceBundleStore.js";

// D-6：governed shadow 與 legacy 12 欄完全獨立。
// 這一支同時是 ratchet：日後有人把 governed 欄位塞進 legacy ShadowMetadata
// （或反過來）就會紅。

/**
 * `src/types.ts` 的 `ShadowMetadata` 12 個 legacy 欄位，逐字複製。
 *
 * 刻意複製而不是 import 型別：`keyof` 只在編譯期存在，複製一份字面清單才能在
 * runtime 斷言兩組 key 的交集為空，並且在 legacy 欄位被偷偷改名時紅掉。
 */
const LEGACY_SHADOW_FIELDS = [
  "tenant_id",
  "project_id",
  "external_model_version_id",
  "external_conversion_task_id",
  "correlation_id",
  "source_ifc_ref",
  "source_ifc_etag",
  "conversion_job_id",
  "artifact_manifest_ref",
  "callback_url",
  "callback_status",
  "last_callback_attempt_at",
] as const;

function makeRecord(overrides: Partial<SourceBundleRecord> = {}): SourceBundleRecord {
  return {
    source_bundle_id: "source-bundle-test-0001",
    external_model_version_id: "model-version-test-0001",
    tenant_id: "tenant-test",
    project_id: "project-test",
    project_display_name: "project-test",
    model_category: "structure",
    manifest_ref:
      "minio://edge-test-01/source-bundles-test/source-bundles/tenant-test/project-test/model-version-test/manifest.json?versionId=v-manifest-0001",
    manifest_sha256: "d".repeat(64),
    bundle_state: "READY",
    integrity_diagnostics: [],
    producer_id: "ifc-worker-test-01",
    producer_kind: "external_ifc_worker",
    claimed_at: "2026-07-16T07:58:20.000Z",
    validated_at: "2026-07-16T07:58:40.000Z",
    pipeline_job_id: null,
    created_at: "2026-07-16T07:58:40.000Z",
    updated_at: "2026-07-16T07:58:40.000Z",
    ...overrides,
  };
}

describe("governed shadow metadata", () => {
  it("只投影 governed identity／digest／locator／state 八欄", () => {
    const shadow = toGovernedShadowMetadata(makeRecord());
    expect(Object.keys(shadow).sort()).toEqual([...GOVERNED_SHADOW_FIELDS].sort());
    expect(shadow).toEqual({
      source_bundle_id: "source-bundle-test-0001",
      external_model_version_id: "model-version-test-0001",
      tenant_id: "tenant-test",
      project_id: "project-test",
      manifest_ref: makeRecord().manifest_ref,
      manifest_sha256: "d".repeat(64),
      bundle_state: "READY",
      pipeline_job_id: null,
    });
  });

  it("不外洩 durable 紀錄的其餘欄位（producer／diagnostics／時間戳全部不在投影裡）", () => {
    const shadow = toGovernedShadowMetadata(makeRecord()) as unknown as Record<string, unknown>;
    for (const leaked of [
      "producer_id",
      "producer_kind",
      "integrity_diagnostics",
      "claimed_at",
      "validated_at",
      "created_at",
      "updated_at",
      "project_display_name",
      "model_category",
    ]) {
      expect(shadow[leaked]).toBeUndefined();
    }
  });

  it("與 legacy 12 欄的 key 交集只有 spec 允許的三個共享 identity 欄位", () => {
    const governed = new Set<string>(GOVERNED_SHADOW_FIELDS as readonly string[]);
    const overlap = LEGACY_SHADOW_FIELDS.filter((field) => governed.has(field)).sort();
    // tenant_id / project_id / external_model_version_id 是 spec 明列的既有 minimal
    // shadow 欄位，governed 投影引用同一組 external identity（不是新增第二個 authority）。
    // 除此之外不得有任何欄位重疊——特別是 legacy 的 12 欄一個都不能被 governed 改寫。
    expect(overlap).toEqual(["external_model_version_id", "project_id", "tenant_id"]);
  });

  it("MUST NOT 投影 legacy 專屬的 callback／conversion 欄位", () => {
    const governed = new Set<string>(GOVERNED_SHADOW_FIELDS as readonly string[]);
    for (const legacyOnly of [
      "external_conversion_task_id",
      "correlation_id",
      "source_ifc_ref",
      "source_ifc_etag",
      "conversion_job_id",
      "artifact_manifest_ref",
      "callback_url",
      "callback_status",
      "last_callback_attempt_at",
    ]) {
      expect(governed.has(legacyOnly)).toBe(false);
    }
  });

  it("manifest_ref 出口套 presigned 遮蔽（縱深防禦）", () => {
    const shadow = toGovernedShadowMetadata(
      makeRecord({
        manifest_ref:
          "https://minio.invalid/source-bundles-test/manifest.json?X-Amz-Signature=deadbeef&X-Amz-Expires=60",
      }),
    );
    expect(shadow.manifest_ref).toBe("https://minio.invalid/source-bundles-test/manifest.json");
    expect(shadow.manifest_ref).not.toContain("X-Amz-Signature");
  });

  it("governed locator（非 presigned）原樣保留 ?versionId=", () => {
    const shadow = toGovernedShadowMetadata(makeRecord());
    expect(shadow.manifest_ref).toContain("?versionId=v-manifest-0001");
  });

  it("pipeline_job_id 由 3.2 回填；3.1 一律 null", () => {
    expect(toGovernedShadowMetadata(makeRecord()).pipeline_job_id).toBeNull();
    expect(
      toGovernedShadowMetadata(makeRecord({ pipeline_job_id: "pipeline-job-test-0001" }))
        .pipeline_job_id,
    ).toBe("pipeline-job-test-0001");
  });

  it("MUST NOT 宣告尚未擁有的 admission／result／publication 欄位（D-9 不捏造證據）", () => {
    const governed = new Set<string>(GOVERNED_SHADOW_FIELDS as readonly string[]);
    for (const notYetOwned of [
      "attempt_id",
      "result_id",
      "result_manifest_ref",
      "result_manifest_digest",
      "active_result_id",
      "admission_status",
      "runtime_profile",
      "requires_exclusive_runtime",
      "lease_id",
      "readiness_evidence",
      "blocker_codes",
      "publication_identity",
    ]) {
      expect(governed.has(notYetOwned)).toBe(false);
    }
  });
});
