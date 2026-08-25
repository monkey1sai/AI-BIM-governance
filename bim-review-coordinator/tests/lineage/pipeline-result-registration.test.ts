import { describe, expect, it } from "vitest";
import { PipelineJobStore } from "../../src/services/lineage/pipelineJobStore.js";
import {
  PipelineResultConflictError,
  PipelineResultStore,
  type PipelineResultView,
} from "../../src/services/lineage/pipelineResultStore.js";
import {
  PipelineResultArtifactObservationError,
  PipelineResultManifestReadError,
  RESULT_MANIFEST_MAX_BYTES,
  type PipelineResultManifestReadFailure,
} from "../../src/services/lineage/pipelineResultManifest.js";
import {
  createPipelineResultRegistrationService,
  PipelineResultIdentityMismatchError,
  type RegisterPipelineResultFromManifestInput,
} from "../../src/services/lineage/pipelineResultRegistration.js";
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

const NOW = "2026-07-16T08:41:07.500Z";

interface Harness {
  jobStore: PipelineJobStore;
  resultStore: PipelineResultStore;
  objects: ReturnType<typeof createFakeSourceBundleObjectPort>;
  registration: ReturnType<typeof createPipelineResultRegistrationService>;
  pipelineJobId: string;
}

function harness(): Harness {
  const jobStore = new PipelineJobStore(null);
  const { job } = jobStore.ensureJobForSourceBundle({
    sourceBundleId: RESULT_SOURCE_BUNDLE_ID,
    externalModelVersionId: RESULT_EXTERNAL_MODEL_VERSION_ID,
    eventId: "ready-event-0001",
    now: "2026-07-16T08:00:00.000Z",
  });
  const resultStore = new PipelineResultStore(jobStore, null);
  const objects = createFakeSourceBundleObjectPort(RESULT_ALLOWLIST);
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

  it("超過 bounded 讀取上限時 fail-closed，不截斷也不半解析", async () => {
    const h = harness();
    const seeded = seed(h, {
      rawManifestBytes: Buffer.alloc(RESULT_MANIFEST_MAX_BYTES + 1, 0x61),
    });

    await expectReadFailure(
      h.registration.registerFromManifest(registrationInput(h, seeded.locator)),
      "object_too_large",
    );
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
