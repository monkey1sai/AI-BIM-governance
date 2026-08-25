import { describe, expect, it } from "vitest";
import { PipelineJobStore } from "../../src/services/lineage/pipelineJobStore.js";
import {
  PipelineResultStore,
  type PipelineResultView,
} from "../../src/services/lineage/pipelineResultStore.js";
import {
  isRefParseFailure,
  parseMinioRef,
  type ParsedRef,
} from "../../src/services/lineage/minioLocator.js";
import {
  createS3PipelineResultArtifactReader,
  PipelineResultArtifactDetailUnavailableError,
  PipelineResultArtifactIntegrityUnavailableError,
} from "../../src/services/lineage/pipelineResultArtifactReader.js";
import {
  createS3LineageArtifactDownloadSigner,
  isLineageArtifactSignedTargetBound,
  LINEAGE_ARTIFACT_DOWNLOAD_MAX_TTL_SECONDS,
  LineageArtifactDownloadUnavailableError,
  parseLineageArtifactDownloadTargetPolicies,
  parseLineageArtifactSignedDownload,
  type LineageArtifactDownloadTarget,
} from "../../src/services/lineage/lineageArtifactDownloadSigner.js";
import { createFakeSourceBundleObjectPort } from "../helpers/fakeSourceBundleObjectPort.js";
import {
  RESULT_ALLOWLIST,
  RESULT_ATTEMPT_ID,
  RESULT_AUTHORITY,
  RESULT_BUCKET,
  RESULT_COMPLETED_AT,
  RESULT_EXTERNAL_MODEL_VERSION_ID,
  RESULT_RESULT_ID,
  RESULT_SOURCE_BUNDLE_ID,
  resultPrefix,
  seedResultManifest,
  sha256Hex,
  type SeedResultManifestOptions,
  type SeededResultManifest,
} from "../helpers/resultManifestFixtures.js";
import type { SourceBundleAllowlist } from "../../src/services/lineage/sourceBundleObjectPort.js";

const NOW = "2026-07-16T08:41:07.500Z";
const PUBLIC_ORIGIN = "https://lineage-download.example.test";
const OBJECT_PATH_PREFIX = `/${RESULT_BUCKET}/`;

interface Harness {
  objects: ReturnType<typeof createFakeSourceBundleObjectPort>;
  results: PipelineResultStore;
  pipelineJobId: string;
}

function harness(allow: SourceBundleAllowlist = RESULT_ALLOWLIST): Harness {
  const jobs = new PipelineJobStore(null);
  const { job } = jobs.ensureJobForSourceBundle({
    sourceBundleId: RESULT_SOURCE_BUNDLE_ID,
    externalModelVersionId: RESULT_EXTERNAL_MODEL_VERSION_ID,
    eventId: "ready-event-0001",
    now: "2026-07-16T08:00:00.000Z",
  });
  return {
    objects: createFakeSourceBundleObjectPort(allow),
    results: new PipelineResultStore(jobs, null),
    pipelineJobId: job.pipeline_job_id,
  };
}

function seed(h: Harness, options: SeedResultManifestOptions = {}): SeededResultManifest {
  return seedResultManifest(h.objects, {
    ...options,
    body: { pipeline_job_id: h.pipelineJobId, ...options.body },
  });
}

/** 直接寫進 store（3.4 的讀取面只需要一筆 AVAILABLE 記錄，不必跑 registration）。 */
function storeResult(h: Harness, seeded: SeededResultManifest, digest?: string): PipelineResultView {
  return h.results.registerResult({
    result_id: RESULT_RESULT_ID,
    attempt_id: RESULT_ATTEMPT_ID,
    pipeline_job_id: h.pipelineJobId,
    source_bundle_id: RESULT_SOURCE_BUNDLE_ID,
    external_model_version_id: RESULT_EXTERNAL_MODEL_VERSION_ID,
    attempt_number: 1,
    result_prefix: resultPrefix(),
    result_manifest_ref: seeded.locator.ref,
    result_manifest_digest: digest ?? sha256Hex(seeded.bytes),
    attempt_outcome: "succeeded",
    publication_state: "AVAILABLE",
    completed_at: RESULT_COMPLETED_AT,
    now: NOW,
    correlation_id: "corr-lineage-0007",
  }).result;
}

async function caught(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => new Error("expected rejection but the call resolved"),
    (error: unknown) => error,
  );
}

function parsedRefOf(ref: string): ParsedRef {
  const parsed = parseMinioRef(ref);
  if (isRefParseFailure(parsed)) throw new Error(`fixture ref is not governed: ${ref}`);
  return parsed;
}

describe("createS3PipelineResultArtifactReader", () => {
  it("由 MinIO 實讀的 manifest 投影出契約合格的 artifact descriptor", async () => {
    const h = harness();
    const seeded = seed(h);
    const result = storeResult(h, seeded);
    const reader = createS3PipelineResultArtifactReader({ objects: h.objects });

    const descriptor = await reader.readArtifact(result, "usdc");

    expect(descriptor).toMatchObject({
      pipeline_job_id: h.pipelineJobId,
      result_id: RESULT_RESULT_ID,
      attempt_id: RESULT_ATTEMPT_ID,
      source_bundle_id: RESULT_SOURCE_BUNDLE_ID,
      external_model_version_id: RESULT_EXTERNAL_MODEL_VERSION_ID,
      result_manifest_ref: seeded.locator.ref,
      result_manifest_digest: sha256Hex(seeded.bytes),
      artifact_id: "usdc",
      role: "usdc",
      filename: "model.usdc",
      content_type: "application/octet-stream",
    });
    expect(descriptor!.locator.ref).toContain("/model.usdc?versionId=");
    expect(descriptor!.locator.size_bytes).toBeGreaterThan(0);
  });

  it("manifest 沒有該 role 時回 null（route 據此 404，不是錯誤也不捏造 locator）", async () => {
    const h = harness();
    const result = storeResult(h, seed(h));
    const reader = createS3PipelineResultArtifactReader({ objects: h.objects });

    // fixture 只帶四個必備 role；quality_report 是合法但缺席的 artifact id。
    expect(await reader.readArtifact(result, "quality_report")).toBeNull();
  });

  it("store 記錄的 digest 與實讀 bytes 不符時擲 integrity 錯（不是 detail）", async () => {
    const h = harness();
    const seeded = seed(h);
    const result = storeResult(h, seeded, "c".repeat(64));
    const reader = createS3PipelineResultArtifactReader({ objects: h.objects });

    const error = await caught(reader.readArtifact(result, "usdc"));

    expect(error).toBeInstanceOf(PipelineResultArtifactIntegrityUnavailableError);
    expect((error as PipelineResultArtifactIntegrityUnavailableError).code).toBe(
      "artifact_integrity_unavailable",
    );
    expect((error as Error).message).toContain("result_manifest_digest_mismatch");
  });

  it("manifest object 不存在時擲 detail 錯（拿不到 ≠ 證據矛盾）", async () => {
    const h = harness();
    const seeded = seed(h);
    const result = storeResult(h, seeded);
    // 把 object 從 fake store 拿掉：記錄還在，bytes 不見了。
    h.objects.objects = h.objects.objects.filter(
      (object) => !object.objectKey.endsWith("result-manifest.json"),
    );
    const reader = createS3PipelineResultArtifactReader({ objects: h.objects });

    const error = await caught(reader.readArtifact(result, "usdc"));

    expect(error).toBeInstanceOf(PipelineResultArtifactDetailUnavailableError);
    expect((error as Error).message).toContain("result_manifest_object_not_found");
  });

  it("manifest identity 與 store 記錄不符時擲 integrity 錯", async () => {
    const h = harness();
    const seeded = seed(h, { body: { result_id: "result-from-another-attempt" } });
    const result = storeResult(h, seeded);
    const reader = createS3PipelineResultArtifactReader({ objects: h.objects });

    const error = await caught(reader.readArtifact(result, "usdc"));

    expect(error).toBeInstanceOf(PipelineResultArtifactIntegrityUnavailableError);
    expect((error as Error).message).toContain("identity does not match");
  });

  it("artifact ref 越出 result_prefix 時在簽章鏈之外就終止", async () => {
    const h = harness();
    const seeded = seed(h, {
      artifacts: {
        usdc: {
          declaredRef: `minio://${RESULT_AUTHORITY}/${RESULT_BUCKET}/${RESULT_EXTERNAL_MODEL_VERSION_ID}/results/attempt-9999/model.usdc?versionId=v-0007-usdc`,
        },
      },
    });
    const result = storeResult(h, seeded);
    const reader = createS3PipelineResultArtifactReader({ objects: h.objects });

    const error = await caught(reader.readArtifact(result, "usdc"));

    expect(error).toBeInstanceOf(PipelineResultArtifactIntegrityUnavailableError);
    expect((error as Error).message).toContain("outside the result prefix");
  });

  it("locator 不在 allowlist 時收斂成 detail 錯（本部署讀不到）", async () => {
    const h = harness({
      allowedAuthorities: [RESULT_AUTHORITY],
      allowedBuckets: ["another-governed-bucket"],
    });
    const seeded = seed(h);
    const result = storeResult(h, seeded);
    const reader = createS3PipelineResultArtifactReader({ objects: h.objects });

    const error = await caught(reader.readArtifact(result, "usdc"));

    expect(error).toBeInstanceOf(PipelineResultArtifactDetailUnavailableError);
    expect((error as Error).message).toContain("not governed by this deployment");
  });
});

describe("createS3LineageArtifactDownloadSigner", () => {
  function targetFor(seeded: SeededResultManifest, objectKey: string): LineageArtifactDownloadTarget {
    const ref = `minio://${RESULT_AUTHORITY}/${RESULT_BUCKET}/${objectKey}?versionId=v-0007-usdc`;
    const parsed = parsedRefOf(ref);
    return {
      pipeline_job_id: "pj_test",
      result_id: RESULT_RESULT_ID,
      artifact_id: "usdc",
      locator: {
        ref,
        object_version_id: "v-0007-usdc",
        etag: "etag-usdc",
        sha256: sha256Hex(seeded.bytes),
        size_bytes: 4_096,
      },
      parsed_ref: parsed,
      public_origin: PUBLIC_ORIGIN,
      object_path: `${OBJECT_PATH_PREFIX}${parsed.objectKey}`,
      filename: "model.usdc",
      content_type: "application/octet-stream",
    };
  }

  const signer = createS3LineageArtifactDownloadSigner({
    accessKey: "unused-test-access-key-id",
    secretKey: "unused-test-secret-key",
  });

  it("簽出的 URL 通過 route 的可執行綁定檢查（host、path、versionId、SigV4 欄位全綁）", async () => {
    const h = harness();
    const seeded = seed(h);
    const target = targetFor(
      seeded,
      `${RESULT_EXTERNAL_MODEL_VERSION_ID}/results/${RESULT_ATTEMPT_ID}/model.usdc`,
    );

    const signed = await signer.sign({
      target,
      requested_at: NOW,
      max_ttl_seconds: LINEAGE_ARTIFACT_DOWNLOAD_MAX_TTL_SECONDS,
    });

    // 先過 runtime schema（route 第一道），再過綁定檢查（route 第二道）。
    expect(parseLineageArtifactSignedDownload(signed)).not.toBeNull();
    expect(
      isLineageArtifactSignedTargetBound({
        download: signed,
        target,
        requested_at: NOW,
        max_ttl_seconds: LINEAGE_ARTIFACT_DOWNLOAD_MAX_TTL_SECONDS,
      }),
    ).toBe(true);

    const url = new URL(signed.url);
    // 簽章綁的就是治理宣告的 public origin，不是任何內網 endpoint。
    expect(url.origin).toBe(PUBLIC_ORIGIN);
    expect(url.pathname).toBe(target.object_path);
    expect(url.searchParams.get("versionId")).toBe("v-0007-usdc");
    expect(url.searchParams.get("X-Amz-Expires")).toBe(
      String(LINEAGE_ARTIFACT_DOWNLOAD_MAX_TTL_SECONDS),
    );
    expect(signed.bound_ref).toBe(target.locator.ref);
    expect(signed.supports_range).toBe(true);
  });

  it("TTL 取 min(caller, 契約上限)：caller 要 3600 只拿到 300", async () => {
    const h = harness();
    const target = targetFor(
      seed(h),
      `${RESULT_EXTERNAL_MODEL_VERSION_ID}/results/${RESULT_ATTEMPT_ID}/model.usdc`,
    );

    const signed = await signer.sign({ target, requested_at: NOW, max_ttl_seconds: 3_600 });

    expect(new URL(signed.url).searchParams.get("X-Amz-Expires")).toBe("300");
    // expires_at 由**截斷到秒**的簽章瞬間導出（AWS X-Amz-Date 只有秒精度）。
    expect(signed.expires_at).toBe("2026-07-16T08:46:07.000Z");
  });

  it("caller 給更短的 TTL 時照 caller（上限只是天花板）", async () => {
    const h = harness();
    const target = targetFor(
      seed(h),
      `${RESULT_EXTERNAL_MODEL_VERSION_ID}/results/${RESULT_ATTEMPT_ID}/model.usdc`,
    );

    const signed = await signer.sign({ target, requested_at: NOW, max_ttl_seconds: 60 });

    expect(new URL(signed.url).searchParams.get("X-Amz-Expires")).toBe("60");
    expect(signed.expires_at).toBe("2026-07-16T08:42:07.000Z");
  });

  it("requested_at 不是 canonical UTC 時 fail-closed（不猜時間）", async () => {
    const h = harness();
    const target = targetFor(
      seed(h),
      `${RESULT_EXTERNAL_MODEL_VERSION_ID}/results/${RESULT_ATTEMPT_ID}/model.usdc`,
    );

    const error = await caught(
      signer.sign({ target, requested_at: "2026-07-16T16:41:07.500+08:00", max_ttl_seconds: 300 }),
    );

    expect(error).toBeInstanceOf(LineageArtifactDownloadUnavailableError);
  });

  it("public_origin 不是 canonical https origin 時拒簽（簽章是安全邊界，不信上游）", async () => {
    const h = harness();
    const base = targetFor(
      seed(h),
      `${RESULT_EXTERNAL_MODEL_VERSION_ID}/results/${RESULT_ATTEMPT_ID}/model.usdc`,
    );

    for (const origin of ["http://lineage.example.test", "https://192.0.2.10", "https://minio.internal"]) {
      const error = await caught(
        signer.sign({
          target: { ...base, public_origin: origin },
          requested_at: NOW,
          max_ttl_seconds: 300,
        }),
      );
      expect(error, origin).toBeInstanceOf(LineageArtifactDownloadUnavailableError);
    }
  });

  it("TTL 非正整數時拒簽", async () => {
    const h = harness();
    const target = targetFor(
      seed(h),
      `${RESULT_EXTERNAL_MODEL_VERSION_ID}/results/${RESULT_ATTEMPT_ID}/model.usdc`,
    );

    for (const ttl of [0, -1, 1.5, Number.NaN]) {
      const error = await caught(
        signer.sign({ target, requested_at: NOW, max_ttl_seconds: ttl }),
      );
      expect(error, String(ttl)).toBeInstanceOf(LineageArtifactDownloadUnavailableError);
    }
  });
});

describe("parseLineageArtifactDownloadTargetPolicies", () => {
  const valid = JSON.stringify([
    {
      authority: RESULT_AUTHORITY,
      bucket: RESULT_BUCKET,
      public_origin: PUBLIC_ORIGIN,
      object_path_prefix: OBJECT_PATH_PREFIX,
    },
  ]);

  it("合格 JSON 陣列解析成 policy 清單", () => {
    const parsed = parseLineageArtifactDownloadTargetPolicies(valid);
    expect(parsed.malformed).toBe(false);
    expect(parsed.policies).toHaveLength(1);
    expect(parsed.policies[0]).toMatchObject({
      authority: RESULT_AUTHORITY,
      bucket: RESULT_BUCKET,
      public_origin: PUBLIC_ORIGIN,
      object_path_prefix: OBJECT_PATH_PREFIX,
    });
  });

  it("未設定／空字串＝空清單＝fail-closed，且不算 malformed", () => {
    for (const raw of ["", "   ", "\n"]) {
      const parsed = parseLineageArtifactDownloadTargetPolicies(raw);
      expect(parsed.policies).toEqual([]);
      expect(parsed.malformed).toBe(false);
    }
  });

  it("任何解析／驗證失敗一律收斂成空清單並標 malformed（不退化成差不多的 origin）", () => {
    const cases: Array<[string, string]> = [
      ["非 JSON", "{not json"],
      ["不是陣列", JSON.stringify({ authority: "a" })],
      ["http origin", valid.replace("https://", "http://")],
      ["IP literal origin", valid.replace(PUBLIC_ORIGIN, "https://192.0.2.10")],
      [".internal origin", valid.replace(PUBLIC_ORIGIN, "https://minio.internal")],
      ["origin 帶路徑", valid.replace(PUBLIC_ORIGIN, `${PUBLIC_ORIGIN}/downloads`)],
      ["prefix 無前導斜線", valid.replace(OBJECT_PATH_PREFIX, `${RESULT_BUCKET}/`)],
      ["prefix 無結尾斜線", valid.replace(OBJECT_PATH_PREFIX, `/${RESULT_BUCKET}`)],
      ["prefix 含 ..", valid.replace(OBJECT_PATH_PREFIX, "/../")],
      // path-style 簽章下唯一合法值是 `/<bucket>/`；typo 必須吵，不得靜默 malformed:false。
      ["prefix 不等於 /<bucket>/", valid.replace(OBJECT_PATH_PREFIX, "/downloads/")],
      [
        "prefix 是別的 bucket",
        valid.replace(OBJECT_PATH_PREFIX, "/another-governed-bucket/"),
      ],
      ["多餘欄位", valid.replace('"authority"', '"extra":1,"authority"')],
      ["authority 含空白", valid.replace(RESULT_AUTHORITY, "edge test 01")],
    ];
    for (const [name, raw] of cases) {
      const parsed = parseLineageArtifactDownloadTargetPolicies(raw);
      expect(parsed.policies, name).toEqual([]);
      expect(parsed.malformed, name).toBe(true);
    }
  });

  it("同一組 (authority, bucket) 重複宣告視為 malformed（resolver 要求唯一命中）", () => {
    const duplicated = JSON.stringify([
      {
        authority: RESULT_AUTHORITY,
        bucket: RESULT_BUCKET,
        public_origin: PUBLIC_ORIGIN,
        object_path_prefix: OBJECT_PATH_PREFIX,
      },
      {
        authority: RESULT_AUTHORITY,
        bucket: RESULT_BUCKET,
        public_origin: "https://other.example.test",
        object_path_prefix: OBJECT_PATH_PREFIX,
      },
    ]);

    const parsed = parseLineageArtifactDownloadTargetPolicies(duplicated);
    expect(parsed.policies).toEqual([]);
    expect(parsed.malformed).toBe(true);
  });
});
