import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as AjvNs from "ajv/dist/2020.js";
import { beforeEach, describe, expect, it } from "vitest";
import { INTEGRITY_DIAGNOSTIC_CODES } from "../../src/services/lineage/integrityDiagnostics.js";
import {
  finalizeAdmissionOutcome,
  MANIFEST_MAX_BYTES,
  resolveSha256VerifyMode,
  toValidationResultDocument,
  validateSourceBundle,
  withEnqueuedPipelineJob,
  type BundleValidationResult,
  type SourceBundleValidatorDeps,
} from "../../src/services/lineage/sourceBundleValidator.js";
import {
  createFakeSourceBundleObjectPort,
  type FakeSourceBundleObjectPort,
} from "../helpers/fakeSourceBundleObjectPort.js";
import {
  seedGovernedBundle,
  fixedNow,
  TEST_ALLOWLIST,
  TEST_AUTHORITY,
  TEST_BUCKET,
  TEST_KEY_PREFIX,
} from "../helpers/governedBundleFixtures.js";

// Task 3.1 的核心：ready claim 非權威，coordinator 獨立重驗。
// 每個 case 只打壞一項，讓「這條診斷是被什麼打出來的」可逐條追。

type AjvCtor = new (opts?: Record<string, unknown>) => {
  compile: (schema: unknown) => (data: unknown) => boolean;
};
const Ajv = (AjvNs as unknown as { default: AjvCtor }).default;

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TEST_DIR, "..", "..", "..");
const CONTRACT = JSON.parse(
  fs.readFileSync(
    path.resolve(REPO_ROOT, "tests", "contracts", "model_version_bundle_manifest.json"),
    "utf-8",
  ),
) as Record<string, unknown>;
const ajvValidate = new Ajv({ allErrors: true, strict: false }).compile(CONTRACT);

/** 本檔實際打出過的 diagnostic code；末尾一條測試當覆蓋率 ratchet。 */
const observedCodes = new Set<string>();

let port: FakeSourceBundleObjectPort;

function deps(overrides: Partial<SourceBundleValidatorDeps> = {}): SourceBundleValidatorDeps {
  return { objects: port, now: fixedNow(), sha256Mode: "full", ...overrides };
}

function codesOf(result: BundleValidationResult): string[] {
  const codes = result.integrity_diagnostics.map((d) => d.code);
  for (const code of codes) observedCodes.add(code);
  return codes;
}

beforeEach(() => {
  port = createFakeSourceBundleObjectPort(TEST_ALLOWLIST);
});

describe("validateSourceBundle — 乾淨路徑", () => {
  it("三個 role 齊備且逐欄相符 → READY、零診斷、manifest_sha256 取實讀值", async () => {
    const seeded = seedGovernedBundle(port);
    const result = await validateSourceBundle(seeded.claim, deps());
    expect(codesOf(result)).toEqual([]);
    expect(result.bundle_state).toBe("READY");
    expect(result.manifest_present).toBe(true);
    expect(result.manifest_sha256).toBe(seeded.manifestSha256);
    expect(result.external_model_version_id).toBe("model-version-test-0001");
    expect(result.replay).toBe(false);
    expect(result.enqueued_pipeline_job_id).toBeNull();
    // validator 不持有 store，所以 conditional_create 還是中間態。
    expect(result.conditional_create).toEqual({ attempted: false, outcome: "not_attempted" });
  });

  it("full 模式對每個 artifact 都做 streaming SHA-256（D-1 預設）", async () => {
    const seeded = seedGovernedBundle(port);
    await validateSourceBundle(seeded.claim, deps());
    expect(port.sha256Calls).toBe(3);
  });

  it("observed_at 取自呼叫端傳入的時鐘（service 內不取時鐘）", async () => {
    const seeded = seedGovernedBundle(port);
    const result = await validateSourceBundle(
      seeded.claim,
      deps({ now: fixedNow("2026-08-01T01:02:03.000Z") }),
    );
    expect(result.observed_at).toBe("2026-08-01T01:02:03.000Z");
  });
});

describe("validateSourceBundle — 逐一產生 13 個 integrity diagnostic code", () => {
  it("sha256_mismatch：MinIO 上的 bytes 與 manifest 宣告的 digest 不符", async () => {
    const seeded = seedGovernedBundle(port, {
      artifactOverrides: { source_ifc: { declaredSha256: "a".repeat(64) } },
    });
    const result = await validateSourceBundle(seeded.claim, deps());
    expect(codesOf(result)).toEqual(["sha256_mismatch"]);
    expect(result.bundle_state).toBe("NON_READY");
    expect(result.integrity_diagnostics[0].role).toBe("source_ifc");
  });

  it("etag_mismatch", async () => {
    const seeded = seedGovernedBundle(port, {
      artifactOverrides: { source_rvt: { declaredEtag: "etag-that-does-not-match" } },
    });
    const result = await validateSourceBundle(seeded.claim, deps());
    expect(codesOf(result)).toEqual(["etag_mismatch"]);
    expect(result.integrity_diagnostics[0].role).toBe("source_rvt");
  });

  it("size_mismatch", async () => {
    const seeded = seedGovernedBundle(port, {
      artifactOverrides: { schedule_csv: { declaredSizeBytes: 999_999 } },
    });
    const result = await validateSourceBundle(seeded.claim, deps());
    expect(codesOf(result)).toEqual(["size_mismatch"]);
    expect(result.integrity_diagnostics[0].observed).not.toBe("999999");
  });

  it("artifact_not_found：manifest 引用的 object version 不在 MinIO 上", async () => {
    const seeded = seedGovernedBundle(port, {
      artifactOverrides: { source_ifc: { skipSeed: true } },
    });
    const result = await validateSourceBundle(seeded.claim, deps());
    expect(codesOf(result)).toEqual(["artifact_not_found"]);
    // 找不到就不該再去 hash 它。
    expect(port.sha256Calls).toBe(2);
  });

  it("artifact_incomplete：size_bytes 為 0 = 還沒寫完", async () => {
    const seeded = seedGovernedBundle(port, {
      artifactOverrides: { schedule_csv: { declaredSizeBytes: 0, storedSizeBytes: 0 } },
    });
    const result = await validateSourceBundle(seeded.claim, deps());
    expect(codesOf(result)).toContain("artifact_incomplete");
  });

  it("missing_required_role", async () => {
    const seeded = seedGovernedBundle(port, { roles: ["source_rvt", "source_ifc"] });
    const result = await validateSourceBundle(seeded.claim, deps());
    expect(codesOf(result)).toEqual(["missing_required_role"]);
  });

  it("duplicate_role", async () => {
    const seeded = seedGovernedBundle(port, {
      mutateManifestBody: (body) => {
        const artifacts = body.artifacts as Array<Record<string, unknown>>;
        artifacts.push({ ...artifacts[0] });
      },
    });
    const result = await validateSourceBundle(seeded.claim, deps());
    expect(codesOf(result)).toContain("duplicate_role");
  });

  it("presigned_locator_forbidden", async () => {
    const presigned = `minio://${TEST_AUTHORITY}/${TEST_BUCKET}/${TEST_KEY_PREFIX}model.rvt?X-Amz-Signature=deadbeef`;
    const seeded = seedGovernedBundle(port, {
      artifactOverrides: { source_rvt: { declaredRef: presigned } },
    });
    const result = await validateSourceBundle(seeded.claim, deps());
    expect(codesOf(result)).toEqual(["presigned_locator_forbidden"]);
  });

  it("unversioned_locator：ref 的 ?versionId= 與 object_version_id 不符", async () => {
    const drifted = `minio://${TEST_AUTHORITY}/${TEST_BUCKET}/${TEST_KEY_PREFIX}model.ifc?versionId=v-some-other-version`;
    const seeded = seedGovernedBundle(port, {
      artifactOverrides: { source_ifc: { declaredRef: drifted } },
    });
    const result = await validateSourceBundle(seeded.claim, deps());
    // 文件層吐 unversioned_locator；store 層再依 ref 上的 version 觀測到 not_found。
    expect(codesOf(result)).toContain("unversioned_locator");
    expect(result.bundle_state).toBe("NON_READY");
  });

  it("semantic_contract_violation：artifact 跨兩個 MinIO authority", async () => {
    const otherAuthority = `minio://edge-test-02/${TEST_BUCKET}/${TEST_KEY_PREFIX}model.ifc?versionId=v-ifc-0001`;
    const seeded = seedGovernedBundle(port, {
      artifactOverrides: { source_ifc: { declaredRef: otherAuthority } },
    });
    const result = await validateSourceBundle(seeded.claim, deps());
    expect(codesOf(result)).toContain("semantic_contract_violation");
  });

  it("manifest_published_before_artifacts：published_at 早於 created_at", async () => {
    const seeded = seedGovernedBundle(port, {
      createdAt: "2026-07-16T08:00:00.000Z",
      publishedAt: "2026-07-16T07:00:00.000Z",
    });
    const result = await validateSourceBundle(seeded.claim, deps());
    expect(codesOf(result)).toEqual(["manifest_published_before_artifacts"]);
  });

  it("manifest_digest_conflict：claim 宣告的 manifest_sha256 與實讀不符（以 MinIO 為準）", async () => {
    const seeded = seedGovernedBundle(port);
    const claimedDigest = "b".repeat(64);
    const result = await validateSourceBundle(
      { ...seeded.claim, manifest_sha256: claimedDigest },
      deps(),
    );
    expect(codesOf(result)).toEqual(["manifest_digest_conflict"]);
    expect(result.manifest_sha256).toBe(seeded.manifestSha256);
    expect(result.integrity_diagnostics[0].expected).toBe(claimedDigest);
    expect(result.integrity_diagnostics[0].observed).toBe(seeded.manifestSha256);
  });

  it("immutable_bundle_overwrite_rejected：同 id 異 digest 的 admission 衝突", async () => {
    const seeded = seedGovernedBundle(port);
    const clean = await validateSourceBundle(seeded.claim, deps());
    const conflicted = finalizeAdmissionOutcome(clean, { outcome: "conflict_different_digest" });
    expect(codesOf(conflicted)).toEqual(["immutable_bundle_overwrite_rejected"]);
    expect(conflicted.bundle_state).toBe("NON_READY");
    expect(conflicted.replay).toBe(false);
    expect(conflicted.enqueued_pipeline_job_id).toBeNull();
  });

  it("13 個 code 全部在本檔被實際產生過（覆蓋率 ratchet）", () => {
    expect([...observedCodes].sort()).toEqual([...INTEGRITY_DIAGNOSTIC_CODES].sort());
  });
});

describe("validateSourceBundle — manifest 本身的問題", () => {
  it("manifest object 不存在 → manifest_present false、artifact_not_found、NON_READY", async () => {
    const seeded = seedGovernedBundle(port, { skipManifestObject: true });
    const result = await validateSourceBundle(seeded.claim, deps());
    expect(result.manifest_present).toBe(false);
    expect(result.manifest_sha256).toBeNull();
    expect(result.integrity_diagnostics.map((d) => d.code)).toEqual(["artifact_not_found"]);
    expect(result.bundle_state).toBe("NON_READY");
  });

  it("manifest_ref 帶 presign 參數 → 一次連線都不發", async () => {
    const seeded = seedGovernedBundle(port);
    const result = await validateSourceBundle(
      {
        ...seeded.claim,
        manifest_ref: {
          ...seeded.claim.manifest_ref,
          ref: `minio://${TEST_AUTHORITY}/${TEST_BUCKET}/${TEST_KEY_PREFIX}manifest.json?X-Amz-Signature=deadbeef`,
        },
      },
      deps(),
    );
    expect(result.integrity_diagnostics.map((d) => d.code)).toEqual([
      "presigned_locator_forbidden",
    ]);
    expect(port.headCalls).toBe(0);
    expect(port.getBytesCalls).toBe(0);
  });

  it("manifest 讀不到且 claim 沒帶 external_model_version_id → 自我描述 sentinel", async () => {
    const seeded = seedGovernedBundle(port, { skipManifestObject: true });
    const { external_model_version_id: _dropped, ...claimWithoutVersion } = seeded.claim;
    const result = await validateSourceBundle(claimWithoutVersion, deps());
    expect(result.external_model_version_id).toBe("unresolved-manifest-unreadable");
    expect(result.manifest_present).toBe(false);
  });

  it("manifest bytes 不是合法 manifest → 仍記下實讀 digest（claim 非權威）", async () => {
    const seeded = seedGovernedBundle(port, { skipManifestObject: true });
    port.seed({
      authority: TEST_AUTHORITY,
      bucket: TEST_BUCKET,
      objectKey: seeded.manifestObjectKey,
      versionId: "v-manifest-0001",
      bytes: "{}",
    });
    const result = await validateSourceBundle(
      {
        ...seeded.claim,
        manifest_ref: {
          ...seeded.claim.manifest_ref,
          etag: port.objects[port.objects.length - 1].etag,
          size_bytes: 2,
        },
        manifest_sha256: seeded.manifestSha256,
      },
      deps(),
    );
    expect(result.manifest_present).toBe(true);
    expect(result.manifest_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(result.bundle_state).toBe("NON_READY");
  });

  it("manifest.json 超過讀取上限 → 診斷（422 面），不是 500", async () => {
    const seeded = seedGovernedBundle(port, { skipManifestObject: true });
    const oversized = Buffer.alloc(MANIFEST_MAX_BYTES + 1, 0x20);
    port.seed({
      authority: TEST_AUTHORITY,
      bucket: TEST_BUCKET,
      objectKey: seeded.manifestObjectKey,
      versionId: "v-manifest-0001",
      bytes: oversized,
    });
    const result = await validateSourceBundle(
      {
        ...seeded.claim,
        manifest_ref: {
          ...seeded.claim.manifest_ref,
          etag: port.objects[port.objects.length - 1].etag,
          size_bytes: oversized.length,
        },
      },
      deps(),
    );
    expect(result.bundle_state).toBe("NON_READY");
    expect(result.manifest_sha256).toBeNull();
    expect(result.integrity_diagnostics.at(-1)?.code).toBe("semantic_contract_violation");
    expect(result.integrity_diagnostics.at(-1)?.detail).toContain("讀取上限");
    expect(ajvValidate(toValidationResultDocument(result))).toBe(true);
  });

  it("manifest 宣告的 source_bundle_id 與 claim 不符 → semantic_contract_violation", async () => {
    const seeded = seedGovernedBundle(port);
    const result = await validateSourceBundle(
      { ...seeded.claim, source_bundle_id: "some-other-bundle" },
      deps(),
    );
    expect(result.integrity_diagnostics.map((d) => d.code)).toContain(
      "semantic_contract_violation",
    );
    // 結果文件記的是 claim 的 id（那是這一次 claim 的識別），診斷說明兩者不符。
    expect(result.source_bundle_id).toBe("some-other-bundle");
  });
});

describe("SOURCE_BUNDLE_SHA256_VERIFY_MODE 降檔門（D-1）", () => {
  it("size_etag_only 不做 SHA-256，且在 integrity_diagnostics 誠實標示", async () => {
    const seeded = seedGovernedBundle(port);
    const result = await validateSourceBundle(seeded.claim, deps({ sha256Mode: "size_etag_only" }));
    expect(port.sha256Calls).toBe(0);
    const downgrade = result.integrity_diagnostics.at(-1);
    expect(downgrade?.code).toBe("semantic_contract_violation");
    expect(downgrade?.observed).toBe("SOURCE_BUNDLE_SHA256_VERIFY_MODE=size_etag_only");
    expect(downgrade?.detail).toContain("SHA-256 未獨立重驗");
  });

  it("降檔模式在契約上無法產生 READY —— 沒有全量重驗過的 bundle 不得被宣告 READY", async () => {
    const seeded = seedGovernedBundle(port);
    const result = await validateSourceBundle(seeded.claim, deps({ sha256Mode: "size_etag_only" }));
    expect(result.bundle_state).toBe("NON_READY");
    // finalize 也不會把它救回 READY（admission 只在 READY 時生效）。
    const finalized = finalizeAdmissionOutcome(result, { outcome: "created" });
    expect(finalized.bundle_state).toBe("NON_READY");
    expect(finalized.conditional_create).toEqual({ attempted: false, outcome: "not_attempted" });
  });

  it("resolveSha256VerifyMode：未設定 → full；拼錯 → 開機就紅", () => {
    expect(resolveSha256VerifyMode(undefined)).toBe("full");
    expect(resolveSha256VerifyMode("")).toBe("full");
    expect(resolveSha256VerifyMode("  full ")).toBe("full");
    expect(resolveSha256VerifyMode("size_etag_only")).toBe("size_etag_only");
    expect(() => resolveSha256VerifyMode("SIZE_ETAG_ONLY")).toThrow(RangeError);
    expect(() => resolveSha256VerifyMode("off")).toThrow(RangeError);
  });
});

describe("allowlist fail-closed（D-3）", () => {
  it("authority 不在 allowlist → semantic_contract_violation，不是 500", async () => {
    const seeded = seedGovernedBundle(port);
    const restricted = createFakeSourceBundleObjectPort({
      allowedAuthorities: ["some-other-edge"],
      allowedBuckets: [TEST_BUCKET],
    });
    restricted.objects = port.objects;
    const result = await validateSourceBundle(seeded.claim, deps({ objects: restricted }));
    expect(result.integrity_diagnostics.map((d) => d.code)).toEqual([
      "semantic_contract_violation",
    ]);
    expect(result.integrity_diagnostics[0].detail).toContain("authority");
    expect(result.bundle_state).toBe("NON_READY");
  });

  it("bucket 不在 allowlist → semantic_contract_violation", async () => {
    const seeded = seedGovernedBundle(port);
    const restricted = createFakeSourceBundleObjectPort({
      allowedAuthorities: [TEST_AUTHORITY],
      allowedBuckets: ["some-other-bucket"],
    });
    restricted.objects = port.objects;
    const result = await validateSourceBundle(seeded.claim, deps({ objects: restricted }));
    expect(result.integrity_diagnostics[0].detail).toContain("bucket");
  });

  it("空 allowlist 代表全關，不是全開", async () => {
    const seeded = seedGovernedBundle(port);
    const closed = createFakeSourceBundleObjectPort({
      allowedAuthorities: [],
      allowedBuckets: [],
    });
    closed.objects = port.objects;
    const result = await validateSourceBundle(seeded.claim, deps({ objects: closed }));
    expect(result.bundle_state).toBe("NON_READY");
  });
});

describe("finalizeAdmissionOutcome 與契約完整性", () => {
  it("created → {attempted:true, created}、replay=false，文件通過 L1 schema", async () => {
    const seeded = seedGovernedBundle(port);
    const clean = await validateSourceBundle(seeded.claim, deps());
    const finalized = withEnqueuedPipelineJob(
      finalizeAdmissionOutcome(clean, { outcome: "created" }),
      "pipeline-job-test-0001",
    );
    expect(finalized.conditional_create).toEqual({ attempted: true, outcome: "created" });
    expect(finalized.replay).toBe(false);
    expect(finalized.enqueued_pipeline_job_id).toBe("pipeline-job-test-0001");
    expect(ajvValidate(toValidationResultDocument(finalized))).toBe(true);
  });

  it("replay_same_digest → already_exists_same_digest、replay=true，文件通過 L1 schema", async () => {
    const seeded = seedGovernedBundle(port);
    const clean = await validateSourceBundle(seeded.claim, deps());
    const finalized = finalizeAdmissionOutcome(clean, { outcome: "replay_same_digest" });
    expect(finalized.conditional_create).toEqual({
      attempted: true,
      outcome: "already_exists_same_digest",
    });
    expect(finalized.replay).toBe(true);
    expect(ajvValidate(toValidationResultDocument(finalized))).toBe(true);
  });

  it("conflict_different_digest 的文件也通過 L1 schema（NON_READY ＋ 至少一條診斷）", async () => {
    const seeded = seedGovernedBundle(port);
    const clean = await validateSourceBundle(seeded.claim, deps());
    const finalized = finalizeAdmissionOutcome(clean, { outcome: "conflict_different_digest" });
    expect(ajvValidate(toValidationResultDocument(finalized))).toBe(true);
  });

  it("NON_READY 的結果文件也通過 L1 schema", async () => {
    const seeded = seedGovernedBundle(port, {
      artifactOverrides: { source_rvt: { declaredEtag: "wrong-etag" } },
    });
    const result = await validateSourceBundle(seeded.claim, deps());
    expect(ajvValidate(toValidationResultDocument(result))).toBe(true);
  });

  it("withEnqueuedPipelineJob 只對 READY 生效（契約：只有 READY 可持有 job）", async () => {
    const seeded = seedGovernedBundle(port, {
      artifactOverrides: { source_rvt: { declaredEtag: "wrong-etag" } },
    });
    const result = await validateSourceBundle(seeded.claim, deps());
    expect(withEnqueuedPipelineJob(result, "pipeline-job-x").enqueued_pipeline_job_id).toBeNull();
  });

  it("replay 與 conflict 互斥（語意層第 9 條不會被觸發）", async () => {
    const seeded = seedGovernedBundle(port);
    const clean = await validateSourceBundle(seeded.claim, deps());
    const conflicted = finalizeAdmissionOutcome(clean, { outcome: "conflict_different_digest" });
    expect(conflicted.conditional_create.outcome).toBe("conflict_different_digest");
    expect(conflicted.replay).toBe(false);
  });
});
