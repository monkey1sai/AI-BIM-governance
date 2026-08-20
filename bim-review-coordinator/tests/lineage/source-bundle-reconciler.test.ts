import { describe, expect, it } from "vitest";
import {
  autoEnqueueGovernedBundle,
} from "../../src/services/lineage/pipelineJobEnqueue.js";
import {
  PipelineJobStore,
  pipelineJobIdFor,
} from "../../src/services/lineage/pipelineJobStore.js";
import { SourceBundleStore } from "../../src/services/lineage/sourceBundleStore.js";
import {
  createSourceBundleReconciler,
  type SourceBundleReconcilerConfig,
} from "../../src/services/lineage/sourceBundleReconciler.js";
import {
  finalizeAdmissionOutcome,
  validateSourceBundle,
} from "../../src/services/lineage/sourceBundleValidator.js";
import { createFakeSourceBundleObjectPort } from "../helpers/fakeSourceBundleObjectPort.js";
import {
  TEST_ALLOWLIST,
  TEST_AUTHORITY,
  TEST_BUCKET,
  seedGovernedBundle,
} from "../helpers/governedBundleFixtures.js";
import {
  createFakeJobStructLogger,
  readyBundleRecord,
  sequentialEventIds,
} from "../helpers/fakePipelineJobDeps.js";

/**
 * `rvt-ifc-usdc-lineage` task 3.2 —— **polling reconciliation（撿漏）**。
 *
 * 定位斷言（比行為斷言更重要）：
 *   - **預設關閉**（比照 `MINIO_WATCH_ENABLED`）；
 *   - 走的是與 ready claim **同一條** validate＋enqueue 路徑，先後順序互換結果相同；
 *   - 只作 reconciliation：已完整的 bundle 不重跑重驗，NON_READY 不入 store。
 *
 * MinIO 一律用 `tests/helpers/fakeSourceBundleObjectPort.ts` 的 in-memory fake
 * （既有 seam-not-`vi.mock` 慣例）。**沒有任何 self-POST／URL seam**：撿漏路徑是
 * 直接呼叫 service，不經 HTTP，因此不可能誤打到本機部署區的 :8004。
 */

const SCAN_PREFIX = `minio://${TEST_AUTHORITY}/${TEST_BUCKET}/source-bundles/`;
const NOW = "2026-07-16T08:00:00.000Z";

function config(overrides: Partial<SourceBundleReconcilerConfig> = {}): SourceBundleReconcilerConfig {
  return { enabled: true, intervalMs: 300_000, prefix: SCAN_PREFIX, ...overrides };
}

function harness(configOverrides: Partial<SourceBundleReconcilerConfig> = {}) {
  const objects = createFakeSourceBundleObjectPort(TEST_ALLOWLIST);
  const bundles = new SourceBundleStore(null);
  const jobs = new PipelineJobStore(null);
  const logs = createFakeJobStructLogger();
  const reconciler = createSourceBundleReconciler({
    objects,
    bundles,
    jobs,
    sha256Mode: "full",
    now: () => NOW,
    newEventId: sequentialEventIds("reconcile"),
    structLog: logs.logger,
    config: config(configOverrides),
  });
  return { objects, bundles, jobs, logs, reconciler };
}

/** ready claim 那一條路徑的最小重演（route 已在 3.1 測過；這裡只要它的**效果**）。 */
async function admitViaReadyClaim(
  h: ReturnType<typeof harness>,
  claim: Parameters<typeof validateSourceBundle>[0],
): Promise<string> {
  const validation = await validateSourceBundle(claim, {
    objects: h.objects,
    now: () => NOW,
    sha256Mode: "full",
  });
  expect(validation.bundle_state).toBe("READY");
  const admitted = h.bundles.admit(
    readyBundleRecord({
      source_bundle_id: validation.source_bundle_id,
      external_model_version_id: validation.external_model_version_id,
      manifest_ref: claim.manifest_ref.ref,
      manifest_sha256: validation.manifest_sha256!,
    }),
  );
  expect(finalizeAdmissionOutcome(validation, { outcome: admitted.outcome }).bundle_state).toBe(
    "READY",
  );
  return autoEnqueueGovernedBundle(admitted.record, {
    jobs: h.jobs,
    bundles: h.bundles,
    now: () => NOW,
    newEventId: sequentialEventIds("ready"),
  }).pipeline_job_id;
}

describe("source bundle reconciler — 預設關閉", () => {
  it("enabled=false 時 start() 不排程也不掃描", () => {
    const h = harness({ enabled: false });
    h.reconciler.start();

    expect(h.reconciler.status().enabled).toBe(false);
    expect(h.reconciler.status().started).toBe(false);
    expect(h.objects.listCalls).toBe(0);
  });

  it("governed prefix 未設定時視為未設定，永不掃描", async () => {
    const h = harness({ prefix: "" });
    h.reconciler.start();
    const result = await h.reconciler.pollNow();

    expect(h.reconciler.status().configured).toBe(false);
    expect(h.objects.listCalls).toBe(0);
    expect(result.scanned).toBe(0);
  });

  it("object port 為 null（governed MinIO 未設定）時誠實停擺，不改用其他憑證", async () => {
    const bundles = new SourceBundleStore(null);
    const jobs = new PipelineJobStore(null);
    const reconciler = createSourceBundleReconciler({
      objects: null,
      bundles,
      jobs,
      sha256Mode: "full",
      now: () => NOW,
      newEventId: sequentialEventIds(),
      config: config(),
    });
    reconciler.start();
    const result = await reconciler.pollNow();

    expect(reconciler.status().configured).toBe(false);
    expect(result).toEqual({ scanned: 0, admitted: 0, replayed: 0, skipped: 0, errors: 0 });
    expect(bundles.list()).toHaveLength(0);
    expect(jobs.list()).toHaveLength(0);
  });
});

describe("source bundle reconciler — 撿漏", () => {
  it("MinIO 有 manifest 但 store 沒紀錄 → 收進 store 並取得 stable job", async () => {
    const h = harness();
    const seeded = seedGovernedBundle(h.objects);

    const result = await h.reconciler.pollNow();

    expect(result.scanned).toBe(1);
    expect(result.admitted).toBe(1);
    const record = h.bundles.get(seeded.claim.source_bundle_id);
    expect(record).not.toBeNull();
    expect(record!.bundle_state).toBe("READY");
    expect(record!.pipeline_job_id).toBe(pipelineJobIdFor(seeded.claim.source_bundle_id));
    expect(h.jobs.list()).toHaveLength(1);
    expect(h.jobs.list()[0].job_state).toBe("PENDING_ADMISSION");
  });

  it("第二輪不重複收案，也不建第二個 logical job", async () => {
    const h = harness();
    seedGovernedBundle(h.objects);

    const first = await h.reconciler.pollNow();
    const second = await h.reconciler.pollNow();

    expect(first.admitted).toBe(1);
    expect(second.admitted).toBe(0);
    expect(second.skipped).toBe(1);
    expect(h.jobs.list()).toHaveLength(1);
    expect(h.bundles.list()).toHaveLength(1);
  });

  it("ready claim 先、reconcile 後 → 同一個 job，reconcile 不重複收案", async () => {
    const h = harness();
    const seeded = seedGovernedBundle(h.objects);
    const viaClaim = await admitViaReadyClaim(h, seeded.claim);

    const result = await h.reconciler.pollNow();

    expect(h.jobs.list()).toHaveLength(1);
    expect(h.jobs.list()[0].pipeline_job_id).toBe(viaClaim);
    expect(result.admitted).toBe(0);
    expect(h.bundles.list()).toHaveLength(1);
  });

  it("reconcile 先、ready claim 後 → 同一個 job（先後順序互換結果相同）", async () => {
    const h = harness();
    const seeded = seedGovernedBundle(h.objects);
    await h.reconciler.pollNow();
    const viaReconcile = h.jobs.list()[0].pipeline_job_id;

    const viaClaim = await admitViaReadyClaim(h, seeded.claim);

    expect(viaClaim).toBe(viaReconcile);
    expect(h.jobs.list()).toHaveLength(1);
    expect(h.bundles.list()).toHaveLength(1);
  });

  it("store 有紀錄但沒綁 job（落 store 與 enqueue 之間掛掉）→ 只補 job，不重跑重驗", async () => {
    const h = harness();
    const seeded = seedGovernedBundle(h.objects);
    h.bundles.admit(
      readyBundleRecord({
        source_bundle_id: seeded.claim.source_bundle_id,
        external_model_version_id: "model-version-test-0001",
        manifest_ref: seeded.manifestRef,
        manifest_sha256: seeded.manifestSha256,
        pipeline_job_id: null,
      }),
    );
    const sha256CallsBefore = h.objects.sha256Calls;

    const result = await h.reconciler.pollNow();

    expect(result.replayed).toBe(1);
    expect(result.admitted).toBe(0);
    // 只讀 manifest 一次（判 identity）；三個 artifact 的 SHA-256 沒有被重算。
    expect(h.objects.sha256Calls).toBe(sha256CallsBefore);
    expect(h.bundles.get(seeded.claim.source_bundle_id)!.pipeline_job_id).toBe(
      pipelineJobIdFor(seeded.claim.source_bundle_id),
    );
  });

  it("NON_READY 的 bundle 不入 store、不取得 job，且下一輪會再試（自癒）", async () => {
    const h = harness();
    const seeded = seedGovernedBundle(h.objects, {
      artifactOverrides: { source_ifc: { skipSeed: true } },
    });

    const first = await h.reconciler.pollNow();
    expect(first.admitted).toBe(0);
    expect(first.skipped).toBe(1);
    expect(h.bundles.get(seeded.claim.source_bundle_id)).toBeNull();
    expect(h.jobs.list()).toHaveLength(0);

    // 缺的 artifact 稍後補齊 → 下一輪應該撿得到（NON_READY 不入快取）。
    const second = await h.reconciler.pollNow();
    expect(second.scanned).toBe(1);
    expect(second.skipped).toBe(1);
  });

  it("manifest 缺 tenant/project identity → 不猜、不入 store", async () => {
    const h = harness();
    const seeded = seedGovernedBundle(h.objects, {
      mutateManifestBody: (body) => {
        delete body.tenant_id;
        delete body.project_id;
      },
    });

    const result = await h.reconciler.pollNow();

    expect(result.skipped).toBe(1);
    expect(h.bundles.get(seeded.claim.source_bundle_id)).toBeNull();
    expect(h.jobs.list()).toHaveLength(0);
    expect(h.logs.find("lacks tenant/project identity").length).toBe(1);
  });

  it("兩個 bundle 各自取得自己的 stable job", async () => {
    const h = harness();
    seedGovernedBundle(h.objects, {
      sourceBundleId: "source-bundle-test-000a",
      keyPrefix: "source-bundles/tenant-test/project-test/model-version-a/",
    });
    seedGovernedBundle(h.objects, {
      sourceBundleId: "source-bundle-test-000b",
      keyPrefix: "source-bundles/tenant-test/project-test/model-version-b/",
    });

    const result = await h.reconciler.pollNow();

    expect(result.scanned).toBe(2);
    expect(result.admitted).toBe(2);
    expect(h.jobs.list()).toHaveLength(2);
  });

  it("list 失敗記成 error 並回報，不 throw、不停擺", async () => {
    const h = harness();
    h.objects.listObjectsUnder = async () => {
      throw new Error("minio unreachable");
    };

    const result = await h.reconciler.pollNow();

    expect(result.errors).toBe(1);
    expect(result.scanned).toBe(0);
    expect(h.reconciler.status().last_error).toContain("minio unreachable");
    expect(h.logs.find("governed reconciliation list failed").length).toBe(1);
  });

  it("單筆 bundle 失敗不讓整輪停擺", async () => {
    const h = harness();
    seedGovernedBundle(h.objects, {
      sourceBundleId: "source-bundle-test-000a",
      keyPrefix: "source-bundles/tenant-test/project-test/model-version-a/",
    });
    seedGovernedBundle(h.objects, {
      sourceBundleId: "source-bundle-test-000b",
      keyPrefix: "source-bundles/tenant-test/project-test/model-version-b/",
    });
    const realGetBytes = h.objects.getBytesVersioned.bind(h.objects);
    h.objects.getBytesVersioned = async (ref, maxBytes) => {
      if (ref.objectKey.includes("model-version-a")) throw new Error("transient read failure");
      return realGetBytes(ref, maxBytes);
    };

    const result = await h.reconciler.pollNow();

    expect(result.errors).toBe(1);
    expect(result.admitted).toBe(1);
    expect(h.jobs.list()).toHaveLength(1);
  });

  it("非 manifest.json 的 object 不會被當成 governed bundle", async () => {
    const h = harness();
    h.objects.seed({
      authority: TEST_AUTHORITY,
      bucket: TEST_BUCKET,
      objectKey: "source-bundles/tenant-test/project-test/model-version-test/model.ifc",
      versionId: "v-stray-0001",
      bytes: "not a manifest",
    });

    const result = await h.reconciler.pollNow();

    expect(result.scanned).toBe(0);
    expect(h.bundles.list()).toHaveLength(0);
  });

  it("stop() 之後不再排程；重複 stop 安全", async () => {
    const h = harness();
    seedGovernedBundle(h.objects);
    h.reconciler.start();
    await h.reconciler.pollNow();
    await h.reconciler.stop();
    await h.reconciler.stop();

    expect(h.reconciler.status().started).toBe(false);
  });
});
