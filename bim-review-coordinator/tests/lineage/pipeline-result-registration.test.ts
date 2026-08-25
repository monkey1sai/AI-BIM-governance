import { describe, expect, it } from "vitest";
import { PipelineJobStore } from "../../src/services/lineage/pipelineJobStore.js";
import {
  PipelineResultConflictError,
  PipelineResultStore,
  type PipelineResultView,
} from "../../src/services/lineage/pipelineResultStore.js";
import {
  parsePipelineResultManifest,
  PipelineResultArtifactObservationError,
  PipelineResultManifestReadError,
  RESULT_MANIFEST_MAX_BYTES,
  type PipelineResultManifestReadFailure,
} from "../../src/services/lineage/pipelineResultManifest.js";
import {
  createPipelineResultRegistrationService,
  PipelineResultIdentityMismatchError,
  PipelineResultLocationError,
  type RegisterPipelineResultFromManifestInput,
} from "../../src/services/lineage/pipelineResultRegistration.js";
import { SourceBundleAccessDeniedError } from "../../src/services/lineage/sourceBundleObjectPort.js";
import {
  createS3PipelineResultDetailReader,
  PipelineResultDetailUnavailableError,
} from "../../src/services/lineage/pipelineResultDetailReader.js";
import { createFakeSourceBundleObjectPort } from "../helpers/fakeSourceBundleObjectPort.js";
import {
  fakeEtag,
  manifestObjectKey,
  RESULT_ALLOWLIST,
  RESULT_ATTEMPT_ID,
  RESULT_AUTHORITY,
  RESULT_BUCKET,
  RESULT_COMPLETED_AT,
  RESULT_EXTERNAL_MODEL_VERSION_ID,
  RESULT_RESULT_ID,
  RESULT_SOURCE_BUNDLE_ID,
  resultAlignmentSummary,
  resultManifestDocument,
  resultPrefix,
  seedResultManifest,
  sha256Hex,
  type SeededResultManifest,
  type SeedResultManifestOptions,
} from "../helpers/resultManifestFixtures.js";
import type { MinioLocator } from "../../src/services/lineage/minioLocator.js";
import type { SourceBundleAllowlist } from "../../src/services/lineage/sourceBundleObjectPort.js";

const NOW = "2026-07-16T08:41:07.500Z";

interface Harness {
  jobStore: PipelineJobStore;
  resultStore: PipelineResultStore;
  objects: ReturnType<typeof createFakeSourceBundleObjectPort>;
  registration: ReturnType<typeof createPipelineResultRegistrationService>;
  pipelineJobId: string;
}

function harness(allow: SourceBundleAllowlist = RESULT_ALLOWLIST): Harness {
  const jobStore = new PipelineJobStore(null);
  const { job } = jobStore.ensureJobForSourceBundle({
    sourceBundleId: RESULT_SOURCE_BUNDLE_ID,
    externalModelVersionId: RESULT_EXTERNAL_MODEL_VERSION_ID,
    eventId: "ready-event-0001",
    now: "2026-07-16T08:00:00.000Z",
  });
  const resultStore = new PipelineResultStore(jobStore, null);
  const objects = createFakeSourceBundleObjectPort(allow);
  return {
    jobStore,
    resultStore,
    objects,
    registration: createPipelineResultRegistrationService({ objects, results: resultStore }),
    pipelineJobId: job.pipeline_job_id,
  };
}

/** manifest ＋ 它引用的四個 artifact 一起播種（registration 會逐 ref 做 head 觀測）。 */
function seed(h: Harness, options: SeedResultManifestOptions = {}): SeededResultManifest {
  return seedResultManifest(h.objects, {
    ...options,
    body: { pipeline_job_id: h.pipelineJobId, ...options.body },
  });
}

function registrationInput(
  h: Harness,
  locator: MinioLocator,
  overrides: Partial<RegisterPipelineResultFromManifestInput> = {},
): RegisterPipelineResultFromManifestInput {
  return {
    manifest_locator: locator,
    expected_identity: {
      result_id: RESULT_RESULT_ID,
      attempt_id: RESULT_ATTEMPT_ID,
      pipeline_job_id: h.pipelineJobId,
      source_bundle_id: RESULT_SOURCE_BUNDLE_ID,
      external_model_version_id: RESULT_EXTERNAL_MODEL_VERSION_ID,
    },
    attempt: { attempt_number: 1, completed_at: RESULT_COMPLETED_AT },
    now: NOW,
    correlation_id: "corr-lineage-0007",
    ...overrides,
  };
}

async function caught(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => new Error("expected rejection but the call resolved"),
    (error: unknown) => error,
  );
}

async function expectReadFailure(
  promise: Promise<unknown>,
  failure: PipelineResultManifestReadFailure,
): Promise<void> {
  const error = await caught(promise);
  expect(error).toBeInstanceOf(PipelineResultManifestReadError);
  expect((error as PipelineResultManifestReadError).failure).toBe(failure);
  expect((error as PipelineResultManifestReadError).code).toBe(`result_manifest_${failure}`);
}

describe("createPipelineResultRegistrationService.registerFromManifest", () => {
  it("讀到並驗過的 manifest 成為 AVAILABLE result，並由 store 自動首次啟用", async () => {
    const h = harness();
    const seeded = seed(h);

    const outcome = await h.registration.registerFromManifest(
      registrationInput(h, seeded.locator),
    );

    expect(outcome.registration.replay).toBe(false);
    expect(outcome.observed_manifest_sha256).toBe(sha256Hex(seeded.bytes));
    expect(outcome.manifest.converter.converter_id).toBe("ifc-usdc-converter");
    expect(outcome.registration.result).toMatchObject({
      result_id: RESULT_RESULT_ID,
      attempt_id: RESULT_ATTEMPT_ID,
      pipeline_job_id: h.pipelineJobId,
      source_bundle_id: RESULT_SOURCE_BUNDLE_ID,
      external_model_version_id: RESULT_EXTERNAL_MODEL_VERSION_ID,
      attempt_number: 1,
      result_prefix: resultPrefix(),
      result_manifest_ref: seeded.locator.ref,
      result_manifest_digest: sha256Hex(seeded.bytes),
      attempt_outcome: "succeeded",
      publication_state: "AVAILABLE",
      completed_at: RESULT_COMPLETED_AT,
      registered_at: NOW,
      selection_state: "active",
    });
    expect(outcome.registration.activation_audit_entry).toMatchObject({
      transition: "first_activation",
      from_result_id: null,
      to_result_id: RESULT_RESULT_ID,
      capability: null,
      correlation_id: "corr-lineage-0007",
    });
    expect(outcome.registration.active_result_pointer?.result_id).toBe(RESULT_RESULT_ID);
    // manifest 一次 HEAD ＋ 四個 referenced artifact 各一次（design.md §5 的實體觀測）。
    expect(h.objects.headCalls).toBe(5);
    // head-level 觀測不跑全量流式 sha256（成本裁決留給後續 slice）。
    expect(h.objects.sha256Calls).toBe(0);
  });

  it("同一份 manifest 重放時冪等：replay=true 且不再產生第二筆 activation audit", async () => {
    const h = harness();
    const seeded = seed(h);

    const first = await h.registration.registerFromManifest(
      registrationInput(h, seeded.locator),
    );
    const second = await h.registration.registerFromManifest(
      registrationInput(h, seeded.locator),
    );

    expect(first.registration.replay).toBe(false);
    expect(second.registration.replay).toBe(true);
    expect(second.registration.activation_audit_entry).toBeNull();
    expect(second.registration.active_result_pointer?.audit_entry_id).toBe(
      first.registration.activation_audit_entry?.audit_entry_id,
    );
    expect(h.resultStore.listResults(h.pipelineJobId)).toHaveLength(1);
  });

  it("同一個 attempt 已綁其他 result 時 fail-closed（store 的衝突語意不被本層吞掉）", async () => {
    const h = harness();
    await h.registration.registerFromManifest(registrationInput(h, seed(h).locator));

    // 同一個 attempt prefix、同一個 manifest key，但換 object version 與 result_id。
    const rival = seed(h, {
      body: { result_id: "result-0007-rival" },
      manifestVersionId: "v-manifest-0007-rival",
    });

    const error = await caught(
      h.registration.registerFromManifest(
        registrationInput(h, rival.locator, {
          expected_identity: {
            result_id: "result-0007-rival",
            attempt_id: RESULT_ATTEMPT_ID,
            pipeline_job_id: h.pipelineJobId,
            source_bundle_id: RESULT_SOURCE_BUNDLE_ID,
            external_model_version_id: RESULT_EXTERNAL_MODEL_VERSION_ID,
          },
        }),
      ),
    );

    expect(error).toBeInstanceOf(PipelineResultConflictError);
    expect((error as PipelineResultConflictError).code).toBe("pipeline_result_conflict");
    expect(h.resultStore.listResults(h.pipelineJobId)).toHaveLength(1);
  });

  it("locator 形狀壞掉時連 MinIO 都不碰", async () => {
    const h = harness();
    const seeded = seed(h);

    await expectReadFailure(
      h.registration.registerFromManifest(
        registrationInput(h, {
          ...seeded.locator,
          // 拿掉 ?versionId=：未釘死到不可變 object version。
          ref: `minio://${RESULT_AUTHORITY}/${RESULT_BUCKET}/${manifestObjectKey()}`,
        }),
      ),
      "locator_malformed",
    );
    expect(h.objects.headCalls).toBe(0);
    expect(h.objects.getBytesCalls).toBe(0);
  });

  it("locator 指向不存在的 object version 時回 object_not_found", async () => {
    const h = harness();
    const seeded = seed(h);

    await expectReadFailure(
      h.registration.registerFromManifest(
        registrationInput(h, {
          ...seeded.locator,
          ref: `minio://${RESULT_AUTHORITY}/${RESULT_BUCKET}/${manifestObjectKey()}?versionId=v-does-not-exist`,
          object_version_id: "v-does-not-exist",
        }),
      ),
      "object_not_found",
    );
  });

  it("claim 的 ETag 與 MinIO 觀測不符時 fail-closed", async () => {
    const h = harness();
    const seeded = seed(h);

    await expectReadFailure(
      h.registration.registerFromManifest(
        registrationInput(h, { ...seeded.locator, etag: "etag-that-was-never-observed" }),
      ),
      "etag_mismatch",
    );
    expect(h.objects.getBytesCalls).toBe(0);
  });

  it("claim 的 size_bytes 與 MinIO 觀測不符時 fail-closed", async () => {
    const h = harness();
    const seeded = seed(h);

    await expectReadFailure(
      h.registration.registerFromManifest(
        registrationInput(h, {
          ...seeded.locator,
          size_bytes: seeded.locator.size_bytes + 1,
        }),
      ),
      "size_mismatch",
    );
    expect(h.objects.getBytesCalls).toBe(0);
  });

  it("claim 的 sha256 與實讀 bytes 不符時以 MinIO 為準並拒絕註冊", async () => {
    const h = harness();
    const seeded = seed(h);

    await expectReadFailure(
      h.registration.registerFromManifest(
        registrationInput(h, { ...seeded.locator, sha256: "b".repeat(64) }),
      ),
      "digest_mismatch",
    );
    expect(h.resultStore.listResults(h.pipelineJobId)).toHaveLength(0);
  });

  it("bytes 讀得到但不符 result-manifest 契約時回 schema_invalid", async () => {
    const h = harness();
    // warning_code_count 與 warning_codes 長度不一致（semantic 規則
    // WARNING_CODE_COUNT_MISMATCH），其餘欄位皆合格。
    const seeded = seed(h, {
      body: {
        alignment_summary: {
          ...resultAlignmentSummary(),
          warning_codes: ["PARTIAL_RVT_IFC_ALIGNMENT"],
          warning_code_count: 2,
        },
      },
    });

    await expectReadFailure(
      h.registration.registerFromManifest(registrationInput(h, seeded.locator)),
      "schema_invalid",
    );
  });

  it("manifest identity 與期望不符時擲 typed identity mismatch，並不寫進 store", async () => {
    const h = harness();
    const seeded = seed(h, { body: { result_id: "result-from-another-attempt" } });

    const error = await caught(
      h.registration.registerFromManifest(registrationInput(h, seeded.locator)),
    );

    expect(error).toBeInstanceOf(PipelineResultIdentityMismatchError);
    expect((error as PipelineResultIdentityMismatchError).field).toBe("result_id");
    expect((error as PipelineResultIdentityMismatchError).code).toBe(
      "result_manifest_identity_mismatch",
    );
    expect(h.resultStore.listResults(h.pipelineJobId)).toHaveLength(0);
  });

  // 有界讀有兩道門：HEAD 宣告的 size（第一道）與 body chunk tally（第二道）。
  // 兩案分別把其中一道單獨打亮，證明第二道不是第一道的裝飾。
  it("第一道門：HEAD 宣告超過上限時，body stream 從未開啟", async () => {
    const h = harness();
    const bytes = Buffer.from(
      JSON.stringify(resultManifestDocument({ body: { pipeline_job_id: h.pipelineJobId } })),
      "utf-8",
    );
    const ref = h.objects.seed({
      authority: RESULT_AUTHORITY,
      bucket: RESULT_BUCKET,
      objectKey: manifestObjectKey(),
      versionId: "v-manifest-head-oversized",
      bytes,
      sizeBytes: RESULT_MANIFEST_MAX_BYTES + 1,
    });

    await expectReadFailure(
      h.registration.registerFromManifest(
        registrationInput(h, {
          ref,
          object_version_id: "v-manifest-head-oversized",
          etag: fakeEtag(bytes),
          sha256: sha256Hex(bytes),
          // claim 與 HEAD 一致，否則會先撞 size_mismatch 而測不到本門。
          size_bytes: RESULT_MANIFEST_MAX_BYTES + 1,
        }),
      ),
      "object_too_large",
    );
    expect(h.objects.getBytesCalls).toBe(0);
    expect(h.resultStore.listResults(h.pipelineJobId)).toHaveLength(0);
  });

  it("第二道門：HEAD 宣告在限內但 body 實際超限時仍 fail-closed（宣告小、送很多）", async () => {
    const h = harness();
    const oversized = Buffer.alloc(RESULT_MANIFEST_MAX_BYTES + 1, 0x61);
    const ref = h.objects.seed({
      authority: RESULT_AUTHORITY,
      bucket: RESULT_BUCKET,
      objectKey: manifestObjectKey(),
      versionId: "v-manifest-body-oversized",
      bytes: oversized,
      // server 宣告一個小 size；事實在 body 裡。
      sizeBytes: 512,
    });

    await expectReadFailure(
      h.registration.registerFromManifest(
        registrationInput(h, {
          ref,
          object_version_id: "v-manifest-body-oversized",
          etag: fakeEtag(oversized),
          sha256: sha256Hex(oversized),
          size_bytes: 512,
        }),
      ),
      "object_too_large",
    );
    expect(h.objects.getBytesCalls).toBe(1);
    expect(h.resultStore.listResults(h.pipelineJobId)).toHaveLength(0);
  });

  // design.md §5：只有 manifest **及其 referenced refs/checksums** 驗證成功，result 才是
  // AVAILABLE。以下三案證明「manifest 完好但被引用的 object 已被刪／改寫」不會被誤判。
  it("referenced artifact 不存在時拒絕註冊（manifest 完好也不算 AVAILABLE）", async () => {
    const h = harness();
    const seeded = seed(h, { artifacts: { usdc: { omit: true } } });

    const error = await caught(
      h.registration.registerFromManifest(registrationInput(h, seeded.locator)),
    );

    expect(error).toBeInstanceOf(PipelineResultArtifactObservationError);
    expect((error as PipelineResultArtifactObservationError).code).toBe(
      "result_manifest_artifact_not_found",
    );
    expect((error as PipelineResultArtifactObservationError).role).toBe("usdc");
    expect((error as PipelineResultArtifactObservationError).field).toBeNull();
    expect(h.resultStore.listResults(h.pipelineJobId)).toHaveLength(0);
  });

  it("referenced artifact 的 ETag 被改寫時拒絕註冊", async () => {
    const h = harness();
    const seeded = seed(h, {
      artifacts: { element_mapping: { storedEtag: "etag-after-silent-rewrite" } },
    });

    const error = await caught(
      h.registration.registerFromManifest(registrationInput(h, seeded.locator)),
    );

    expect(error).toBeInstanceOf(PipelineResultArtifactObservationError);
    expect((error as PipelineResultArtifactObservationError).code).toBe(
      "result_manifest_artifact_integrity_mismatch",
    );
    expect((error as PipelineResultArtifactObservationError).role).toBe("element_mapping");
    expect((error as PipelineResultArtifactObservationError).field).toBe("etag");
    expect((error as PipelineResultArtifactObservationError).observed).toBe(
      "etag-after-silent-rewrite",
    );
    expect(h.resultStore.listResults(h.pipelineJobId)).toHaveLength(0);
  });

  it("referenced artifact 的 size 與宣告不符時拒絕註冊", async () => {
    const h = harness();
    const seeded = seed(h, {
      artifacts: { alignment_report_csv: { storedSizeBytes: 999_999 } },
    });

    const error = await caught(
      h.registration.registerFromManifest(registrationInput(h, seeded.locator)),
    );

    expect(error).toBeInstanceOf(PipelineResultArtifactObservationError);
    expect((error as PipelineResultArtifactObservationError).code).toBe(
      "result_manifest_artifact_integrity_mismatch",
    );
    expect((error as PipelineResultArtifactObservationError).role).toBe(
      "alignment_report_csv",
    );
    expect((error as PipelineResultArtifactObservationError).field).toBe("size_bytes");
    expect((error as PipelineResultArtifactObservationError).observed).toBe("999999");
    expect(h.resultStore.listResults(h.pipelineJobId)).toHaveLength(0);
  });

  it("artifact ref 不在 result_prefix 之下時拒絕（授權邊界縱深，發請求之前就擋）", async () => {
    const h = harness();
    const seeded = seed(h, {
      artifacts: {
        usdc: {
          // 宣告一個指向**別的 attempt** 的 ref：合約形狀合格，但越出本 result 的邊界。
          declaredRef: `minio://${RESULT_AUTHORITY}/${RESULT_BUCKET}/${RESULT_EXTERNAL_MODEL_VERSION_ID}/results/attempt-9999/model.usdc?versionId=v-0007-usdc`,
        },
      },
    });

    const error = await caught(
      h.registration.registerFromManifest(registrationInput(h, seeded.locator)),
    );

    expect(error).toBeInstanceOf(PipelineResultArtifactObservationError);
    expect((error as PipelineResultArtifactObservationError).code).toBe(
      "result_manifest_artifact_outside_result_prefix",
    );
    expect((error as PipelineResultArtifactObservationError).role).toBe("usdc");
    expect((error as PipelineResultArtifactObservationError).field).toBe("ref");
    // manifest 那一次之外零 HEAD：越界的 ref 連請求都不該發出去。
    expect(h.objects.headCalls).toBe(1);
    expect(h.resultStore.listResults(h.pipelineJobId)).toHaveLength(0);
  });

  it("result_prefix 末段不等於 attempt_id 時擲 typed location error（不是 store 深處的泛用 InvariantError）", async () => {
    const h = harness();
    // attempt_id 換成另一個 attempt；prefix 仍是 .../attempt-0007/，兩者不再對齊。
    const seeded = seed(h, { body: { attempt_id: "attempt-0009" } });

    const error = await caught(
      h.registration.registerFromManifest(
        registrationInput(h, seeded.locator, {
          expected_identity: {
            result_id: RESULT_RESULT_ID,
            attempt_id: "attempt-0009",
            pipeline_job_id: h.pipelineJobId,
            source_bundle_id: RESULT_SOURCE_BUNDLE_ID,
            external_model_version_id: RESULT_EXTERNAL_MODEL_VERSION_ID,
          },
        }),
      ),
    );

    expect(error).toBeInstanceOf(PipelineResultLocationError);
    expect((error as PipelineResultLocationError).code).toBe("result_prefix_not_attempt_scoped");
    expect((error as Error).message).toContain("result-manifest.json");
    // 位置不對就不必去觀測 artifacts：manifest 那一次之外零 HEAD。
    expect(h.objects.headCalls).toBe(1);
    expect(h.resultStore.listResults(h.pipelineJobId)).toHaveLength(0);
  });

  it("同一 result_id 以不同 manifest digest 重放時 fail-closed（不可變 result 不得被覆寫）", async () => {
    const h = harness();
    const first = seed(h);
    await h.registration.registerFromManifest(registrationInput(h, first.locator));

    // 同 result_id／attempt_id，只改 created_at → bytes 不同 → digest 不同。
    const second = seed(h, {
      body: { created_at: "2026-07-16T08:38:41Z" },
      manifestVersionId: "v-manifest-0007-second-digest",
    });
    expect(sha256Hex(second.bytes)).not.toBe(sha256Hex(first.bytes));

    const error = await caught(
      h.registration.registerFromManifest(registrationInput(h, second.locator)),
    );

    expect(error).toBeInstanceOf(PipelineResultConflictError);
    // 既有 result 的 digest 未被改寫。
    expect(h.resultStore.getResult(RESULT_RESULT_ID)!.result_manifest_digest).toBe(
      sha256Hex(first.bytes),
    );
    expect(h.resultStore.listResults(h.pipelineJobId)).toHaveLength(1);
  });

  it("manifest locator 不在 allowlist 時 access-denied 原樣向上拋，不偽裝成 manifest 有問題", async () => {
    // port 的 bucket allowlist 不含 fixture 的 bucket → D-3 fail-closed 在 HEAD 就擋下。
    const h = harness({
      allowedAuthorities: [RESULT_AUTHORITY],
      allowedBuckets: ["another-governed-bucket"],
    });
    const seeded = seed(h);

    const error = await caught(
      h.registration.registerFromManifest(registrationInput(h, seeded.locator)),
    );

    expect(error).toBeInstanceOf(SourceBundleAccessDeniedError);
    expect((error as SourceBundleAccessDeniedError).code).toBe(
      "source_bundle_locator_not_allowlisted",
    );
    // 分類邊界：registration 端**不**把部署邊界錯誤收斂成 manifest 讀取失敗。
    expect(error).not.toBeInstanceOf(PipelineResultManifestReadError);
    expect(h.resultStore.listResults(h.pipelineJobId)).toHaveLength(0);
  });

  it("失敗時寫一筆 structLog warn，只帶 id 與 typed 分類（ref 全文不入 log）", async () => {
    const h = harness();
    const warns: Array<{
      component: string;
      msg: string;
      data?: Record<string, unknown>;
    }> = [];
    const service = createPipelineResultRegistrationService({
      objects: h.objects,
      results: h.resultStore,
      structLog: {
        info: () => {},
        warn: (component, msg, data) => {
          warns.push({ component, msg, data });
        },
      },
    });
    const seeded = seed(h, { artifacts: { usdc: { omit: true } } });

    await caught(service.registerFromManifest(registrationInput(h, seeded.locator)));

    expect(warns).toHaveLength(1);
    expect(warns[0].component).toBe("pipeline-result-registration");
    expect(warns[0].data).toMatchObject({
      pipeline_job_id: h.pipelineJobId,
      result_id: RESULT_RESULT_ID,
      attempt_id: RESULT_ATTEMPT_ID,
      code: "result_manifest_artifact_not_found",
      role: "usdc",
    });
    // governed locator 的全文不得進 log（欄位只留 id／分類／截斷後的 expected/observed）。
    expect(JSON.stringify(warns[0].data)).not.toContain("?versionId=");
    expect(JSON.stringify(warns[0].data)).not.toContain(RESULT_BUCKET);
  });

  it("containment 失敗同樣寫 warn，且帶 prefix 的 expected 被遮蔽成 <redacted>", async () => {
    // 這一案是上一案的補集：`artifact_outside_result_prefix` 的 `expected` 是完整的
    // `result_prefix`（一個 governed locator prefix），正好證明遮蔽規則有作用。
    const h = harness();
    const warns: Array<{
      component: string;
      msg: string;
      data?: Record<string, unknown>;
    }> = [];
    const service = createPipelineResultRegistrationService({
      objects: h.objects,
      results: h.resultStore,
      structLog: {
        info: () => {},
        warn: (component, msg, data) => {
          warns.push({ component, msg, data });
        },
      },
    });
    const seeded = seed(h, {
      artifacts: {
        usdc: {
          declaredRef: `minio://${RESULT_AUTHORITY}/${RESULT_BUCKET}/${RESULT_EXTERNAL_MODEL_VERSION_ID}/results/attempt-9999/model.usdc?versionId=v-0007-usdc`,
        },
      },
    });

    await caught(service.registerFromManifest(registrationInput(h, seeded.locator)));

    expect(warns).toHaveLength(1);
    expect(warns[0].data).toMatchObject({
      code: "result_manifest_artifact_outside_result_prefix",
      role: "usdc",
      field: "ref",
      expected: "<redacted>",
    });
    // 遮蔽必須真的擋住拓撲：bucket 名不得出現在整筆 log record 裡。
    expect(JSON.stringify(warns[0].data)).not.toContain(RESULT_BUCKET);
  });

  it("帶 presign 參數的值一律遮蔽（簽章憑證絕不進 log）", async () => {
    const h = harness();
    const warns: Array<{ data?: Record<string, unknown> }> = [];
    const service = createPipelineResultRegistrationService({
      objects: {
        ...h.objects,
        // 模擬上游擲出一個把 presigned URL 放進 observed 的 typed 錯誤。
        headVersioned: async () => {
          throw Object.assign(new Error("upstream"), {
            code: "result_manifest_object_not_found",
            observed:
              "https://minio.example.test/bucket/key?X-Amz-Signature=deadbeef&X-Amz-Credential=AKIA",
          });
        },
      },
      results: h.resultStore,
      structLog: {
        info: () => {},
        warn: (_component, _msg, data) => {
          warns.push({ data });
        },
      },
    });
    const seeded = seed(h);

    await caught(service.registerFromManifest(registrationInput(h, seeded.locator)));

    expect(warns).toHaveLength(1);
    expect(warns[0].data).toMatchObject({ observed: "<redacted>" });
    const serialized = JSON.stringify(warns[0].data);
    expect(serialized).not.toContain("X-Amz-Signature");
    expect(serialized).not.toContain("X-Amz-Credential");
  });

  it("非物件的 throw 值不會讓失敗面的 log 自己炸掉", async () => {
    const h = harness();
    const warns: Array<{ data?: Record<string, unknown> }> = [];
    const service = createPipelineResultRegistrationService({
      // headVersioned 直接 throw 一個字串：catch 的 error 是 `unknown`，
      // 沒有物件守衛就會在讀 `.code` 時變成 TypeError（失敗面的第二個失敗模式）。
      objects: {
        ...h.objects,
        headVersioned: async () => {
          throw "boom";
        },
      },
      results: h.resultStore,
      structLog: {
        info: () => {},
        warn: (_component, _msg, data) => {
          warns.push({ data });
        },
      },
    });
    const seeded = seed(h);

    const error = await caught(service.registerFromManifest(registrationInput(h, seeded.locator)));

    // 原始的 throw 值必須原樣向上拋（不被 log 路徑吞掉或替換）。
    expect(error).toBe("boom");
    expect(warns).toHaveLength(1);
    expect(warns[0].data).toMatchObject({ code: "unclassified", role: null, field: null });
  });
});

describe("parsePipelineResultManifest 的 runtime 收斂規則", () => {
  function parse(body: Record<string, unknown>): unknown {
    return parsePipelineResultManifest(
      Buffer.from(JSON.stringify(resultManifestDocument({ body })), "utf-8"),
    );
  }

  // 這兩案刻意分開，但**無法完全隔離**：role enum 只有 9 個成員，任何超過 9 筆的
  // artifacts 陣列必然含重複 role，所以 `.max(32)` 在現行詞彙下是**冗餘防線**
  // （role 唯一性先觸發或同時觸發）。保留 `.max(32)` 是為了「role 詞彙日後擴充」與
  // 「1 MiB 內的 manifest 不得逼出上千次 HEAD」兩個獨立理由。
  it("同一 role 重複宣告時拒絕（10 筆 4 role：鎖 role 唯一性）", () => {
    const base = resultManifestDocument().body as { artifacts: unknown[] };
    const duplicated = Array.from({ length: 10 }, (_, index) => base.artifacts[index % 4]);
    expect(duplicated).toHaveLength(10);
    expect(parse({ artifacts: duplicated })).toBeNull();
  });

  it("artifacts 超過 32 筆時拒絕（整體上限；與 role 唯一性同時成立）", () => {
    const base = resultManifestDocument().body as { artifacts: unknown[] };
    const inflated = Array.from({ length: 33 }, (_, index) => base.artifacts[index % 4]);
    expect(inflated).toHaveLength(33);
    expect(parse({ artifacts: inflated })).toBeNull();
  });

  it("alignment_summary 的 denominator 未綁定到 count 時拒絕（semantic rule 2）", () => {
    const summary = resultAlignmentSummary();
    expect(
      parse({
        alignment_summary: {
          ...summary,
          counts: {
            ...(summary.counts as Record<string, unknown>),
            // eligible 改了但 coverage.denominator 沒跟著改 → IFC_USDC_DENOMINATOR_MISMATCH。
            eligible_ifc_product_count: 1199,
            ifc_only_count: 199,
          },
        },
      }),
    ).toBeNull();
  });

  it("identifier 含 SAFE_ID 之外的字元時拒絕（runtime 比契約嚴）", () => {
    expect(parse({ result_id: "result 0007" })).toBeNull();
    expect(parse({ external_model_version_id: "model\nversion" })).toBeNull();
  });
});

describe("createS3PipelineResultDetailReader.readCompareSide", () => {
  /** 直接寫進 store（繞過 registration），用來製造「記錄與 bytes 不一致」的場景。 */
  function registerRaw(
    h: Harness,
    locator: Pick<MinioLocator, "ref">,
    digest: string,
    overrides: { attempt_outcome?: "succeeded" | "succeeded_with_warnings" } = {},
  ): PipelineResultView {
    return h.resultStore.registerResult({
      result_id: RESULT_RESULT_ID,
      attempt_id: RESULT_ATTEMPT_ID,
      pipeline_job_id: h.pipelineJobId,
      source_bundle_id: RESULT_SOURCE_BUNDLE_ID,
      external_model_version_id: RESULT_EXTERNAL_MODEL_VERSION_ID,
      attempt_number: 1,
      result_prefix: resultPrefix(),
      result_manifest_ref: locator.ref,
      result_manifest_digest: digest,
      attempt_outcome: overrides.attempt_outcome ?? "succeeded",
      publication_state: "AVAILABLE",
      completed_at: RESULT_COMPLETED_AT,
      now: NOW,
      correlation_id: "corr-lineage-0007",
    }).result;
  }

  it("由 MinIO 實讀的 manifest 投影出契約合格的 compare side", async () => {
    const h = harness();
    const seeded = seed(h);
    const registered = await h.registration.registerFromManifest(
      registrationInput(h, seeded.locator),
    );
    const headCallsBefore = h.objects.headCalls;
    const reader = createS3PipelineResultDetailReader({ objects: h.objects });

    const side = await reader.readCompareSide(registered.registration.result);

    expect(side).toMatchObject({
      result_id: RESULT_RESULT_ID,
      attempt_id: RESULT_ATTEMPT_ID,
      pipeline_job_id: h.pipelineJobId,
      publication_state: "AVAILABLE",
      attempt_outcome: "succeeded",
      result_manifest_digest: sha256Hex(seeded.bytes),
      converter: {
        converter_id: "ifc-usdc-converter",
        converter_version: "2.4.1",
        runtime_profile: "kit-gpu-exclusive",
      },
      warning_codes: [],
    });
    // locator 的 etag／size 只能來自 HEAD 觀測，不是 store 記錄裡的欄位。
    expect(side.result_manifest_ref).toEqual({
      ref: seeded.locator.ref,
      object_version_id: seeded.locator.object_version_id,
      etag: fakeEtag(seeded.bytes),
      sha256: sha256Hex(seeded.bytes),
      size_bytes: seeded.bytes.length,
    });
    expect(side.metrics.ifc_usdc_coverage_ratio).toEqual({
      numerator: 1200,
      denominator: 1200,
      ratio: 1,
      status: "complete",
    });
    expect(side.counts.full_lineage_matched_count).toBe(1000);
    // compare 只投影 manifest：detail reader 不重跑 referenced artifact 的實體觀測。
    expect(h.objects.headCalls - headCallsBefore).toBe(1);
  });

  it("manifest 不符契約時誠實 503，不捏造 metrics/counts", async () => {
    const h = harness();
    // alignment_summary 整段缺席：契約必填欄位。
    const document = resultManifestDocument({
      body: { pipeline_job_id: h.pipelineJobId },
    }) as { body: Record<string, unknown> };
    delete document.body.alignment_summary;
    const seeded = seed(h, {
      rawManifestBytes: Buffer.from(JSON.stringify(document), "utf-8"),
    });
    const view = registerRaw(h, seeded.locator, sha256Hex(seeded.bytes));
    const reader = createS3PipelineResultDetailReader({ objects: h.objects });

    const error = await caught(reader.readCompareSide(view));

    expect(error).toBeInstanceOf(PipelineResultDetailUnavailableError);
    expect((error as PipelineResultDetailUnavailableError).code).toBe(
      "result_detail_unavailable",
    );
    expect((error as Error).message).toContain("result_manifest_schema_invalid");
  });

  it("store 記錄的 digest 與實讀 bytes 不符時誠實 503", async () => {
    const h = harness();
    const seeded = seed(h);
    const view = registerRaw(h, seeded.locator, "c".repeat(64));
    const reader = createS3PipelineResultDetailReader({ objects: h.objects });

    const error = await caught(reader.readCompareSide(view));

    expect(error).toBeInstanceOf(PipelineResultDetailUnavailableError);
    expect((error as Error).message).toContain("result_manifest_digest_mismatch");
  });

  it("manifest 契約合格但投影不過 compare-side 重驗時誠實 503", async () => {
    const h = harness();
    // ratio 不等於截斷後的商：manifest 契約沒有這條規則，compare-side schema 有。
    const summary = resultAlignmentSummary();
    const seeded = seed(h, {
      body: {
        alignment_summary: {
          ...summary,
          metrics: {
            ...(summary.metrics as Record<string, unknown>),
            ifc_usdc_coverage_ratio: {
              numerator: 1200,
              denominator: 1200,
              ratio: 0.5,
              status: "complete",
            },
          },
        },
      },
    });
    const view = registerRaw(h, seeded.locator, sha256Hex(seeded.bytes));
    const reader = createS3PipelineResultDetailReader({ objects: h.objects });

    const error = await caught(reader.readCompareSide(view));

    expect(error).toBeInstanceOf(PipelineResultDetailUnavailableError);
    expect((error as Error).message).toContain("contract-valid compare side");
  });

  it("locator 不在 allowlist 時收斂成 503（與 registration 的 propagate 分類相反，刻意）", async () => {
    // 同一個部署邊界條件，兩端刻意不同分類：registration 是寫入路徑，必須讓
    // 部署設定錯誤大聲冒出來；compare 是唯讀讀取面，對呼叫端而言就是「這份 detail
    // 對本部署不可得」＝誠實 503。這條 catch 分支先前零覆蓋。
    const h = harness({
      allowedAuthorities: [RESULT_AUTHORITY],
      allowedBuckets: ["another-governed-bucket"],
    });
    const seeded = seed(h);
    // store 不做 allowlist 判斷，所以記錄本身建得起來（模擬 allowlist 事後被縮小）。
    const view = registerRaw(h, seeded.locator, sha256Hex(seeded.bytes));
    const reader = createS3PipelineResultDetailReader({ objects: h.objects });

    const error = await caught(reader.readCompareSide(view));

    expect(error).toBeInstanceOf(PipelineResultDetailUnavailableError);
    expect((error as PipelineResultDetailUnavailableError).code).toBe(
      "result_detail_unavailable",
    );
    expect((error as Error).message).toContain("not governed by this deployment");
  });

  it("store 記錄與 manifest 的 attempt_outcome 不一致時誠實 503（不選邊站）", async () => {
    const h = harness();
    const seeded = seed(h);
    const view = registerRaw(h, seeded.locator, sha256Hex(seeded.bytes), {
      attempt_outcome: "succeeded_with_warnings",
    });
    const reader = createS3PipelineResultDetailReader({ objects: h.objects });

    const error = await caught(reader.readCompareSide(view));

    expect(error).toBeInstanceOf(PipelineResultDetailUnavailableError);
    expect((error as Error).message).toContain("attempt_outcome");
  });
});
