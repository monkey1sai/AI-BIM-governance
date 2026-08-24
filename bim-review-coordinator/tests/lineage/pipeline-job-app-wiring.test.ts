import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { createCoordinatorApp, type CoordinatorApp } from "../../src/app.js";
import type { CoordinatorConfig } from "../../src/config.js";
import {
  PipelineJobStore,
  pipelineJobIdFor,
} from "../../src/services/lineage/pipelineJobStore.js";
import {
  PipelineResultStateUnavailableError,
  PipelineResultStore,
} from "../../src/services/lineage/pipelineResultStore.js";
import {
  createFakeSourceBundleObjectPort,
  type FakeSourceBundleObjectPort,
} from "../helpers/fakeSourceBundleObjectPort.js";
import {
  TEST_ALLOWLIST,
  TEST_AUTHORITY,
  TEST_BUCKET,
  seedGovernedBundle,
} from "../helpers/governedBundleFixtures.js";

/**
 * `rvt-ifc-usdc-lineage` task 3.2 —— **app.ts 接線**（restart recovery ＋ reconciler
 * 生命週期 ＋ dispose）。
 *
 * 前三支測試檔證明的是 service 行為；這一支證明的是「那些行為真的被接上
 * `createCoordinatorApp`」——沒有這一層，一個忘了呼叫 `recoverOnStart()` 的接線
 * 仍然會讓 store 測試全綠。
 *
 * MinIO 一律經 `sourceBundleObjectStoreFactory` seam 注入 in-memory fake；
 * 沒有任何 self-POST／固定 port，也不啟動 legacy watcher（預設關閉）。
 */

const NOW_ISH = /^\d{4}-\d{2}-\d{2}T/;

let active: CoordinatorApp | null = null;
const tmpRoots: string[] = [];

afterEach(async () => {
  if (active) {
    await active.dispose();
    active.io.close();
    await new Promise<void>((resolve) => active?.server.close(() => resolve()));
    active = null;
  }
  while (tmpRoots.length > 0) {
    const root = tmpRoots.pop();
    if (root) fs.rmSync(root, { recursive: true, force: true });
  }
});

function tmpRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pipeline-job-app-"));
  tmpRoots.push(root);
  return root;
}

function makeApp(
  root: string,
  overrides: Partial<CoordinatorConfig> = {},
  port: FakeSourceBundleObjectPort | null = null,
): CoordinatorApp {
  const storageRoot = path.join(root, "storage");
  active = createCoordinatorApp(
    {
      sessionStoreDir: path.join(root, "sessions"),
      eventLogDir: path.join(root, "events"),
      callbackOutboxStorePath: path.join(root, "callback-outbox.json"),
      conversionLedgerStorePath: path.join(root, "conversion-ledger.json"),
      artifactHealthLedgerStorePath: path.join(root, "artifact-health-ledger.json"),
      edgeSiteId: "site_test_edge",
      edgeRuntimeDataRoot: root,
      storageRoot,
      storageHostRoot: storageRoot,
      sourceBundleStorePath: path.join(root, "source-bundles.json"),
      pipelineJobStorePath: path.join(root, "pipeline-jobs.json"),
      streamingConversionApiBase: "http://127.0.0.1:1",
      corsOrigins: ["http://127.0.0.1:5173"],
      ...overrides,
    },
    port ? { sourceBundleObjectStoreFactory: () => port } : {},
  );
  return active;
}

describe("app 接線：durable pipeline job", () => {
  it("暴露 pipelineJobStore 供契約測試讀取，且開機時是空的", () => {
    const app = makeApp(tmpRoot());
    expect(app.pipelineJobStore.list()).toHaveLength(0);
  });

  it("開機即執行 restart recovery：WAITING_CAPACITY → PENDING_ADMISSION", async () => {
    const root = tmpRoot();
    const storePath = path.join(root, "pipeline-jobs.json");
    const jobId = pipelineJobIdFor("source-bundle-test-0001");
    fs.writeFileSync(
      storePath,
      JSON.stringify({
        schema_version: "pipeline-job/v1",
        records: [
          {
            owner: "bim-review-coordinator",
            pipeline_job_id: jobId,
            source_bundle_id: "source-bundle-test-0001",
            external_model_version_id: "model-version-test-0001",
            tenant_id: "tenant-test",
            project_id: "project-test",
            job_state: "WAITING_CAPACITY",
            attempt_count: 1,
            in_flight_attempt_id: null,
            active_result_id: null,
            manual_correction_blocker: null,
            ready_event_ledger: [
              {
                event_id: "evt-0001",
                event_kind: "source_bundle_ready",
                received_at: "2026-07-16T08:00:00.000Z",
                created_new_logical_job: true,
              },
            ],
            created_at: "2026-07-16T08:00:00.000Z",
            updated_at: "2026-07-16T08:00:00.000Z",
          },
        ],
      }),
      "utf-8",
    );

    const app = makeApp(root, { pipelineJobStorePath: storePath });
    const job = app.pipelineJobStore.get(jobId)!;

    expect(job.job_state).toBe("PENDING_ADMISSION");
    // restart 不燒 attempt、不建第二個 logical job、不標 legacy 的 dropped_on_restart。
    expect(job.attempt_count).toBe(1);
    expect(app.pipelineJobStore.list()).toHaveLength(1);
    expect(job.ready_event_ledger.at(-1)!.event_kind).toBe("coordinator_restart");
    expect(job.ready_event_ledger.at(-1)!.created_new_logical_job).toBe(false);
    expect(job.updated_at).toMatch(NOW_ISH);
    expect(fs.readFileSync(storePath, "utf-8")).not.toContain("dropped_on_restart");
  });

  it("committed result sidecar 遺失時 startup fail closed，且不先改寫 job recovery", () => {
    const root = tmpRoot();
    const storePath = path.join(root, "pipeline-jobs.json");
    const resultPath = `${storePath}.results`;
    const jobs = new PipelineJobStore(storePath);
    const { job } = jobs.ensureJobForSourceBundle({
      sourceBundleId: "source-bundle-test-0001",
      externalModelVersionId: "model-version-test-0001",
      eventId: "ready-event-0001",
      now: "2026-07-16T08:00:00.000Z",
    });
    const results = new PipelineResultStore(jobs, resultPath);
    results.registerResult({
      result_id: "result-0007",
      attempt_id: "attempt-0007",
      pipeline_job_id: job.pipeline_job_id,
      source_bundle_id: job.source_bundle_id,
      external_model_version_id: job.external_model_version_id,
      attempt_number: 1,
      result_prefix:
        "minio://edge-test-01/lineage-results/model-version-test-0001/results/attempt-0007/",
      result_manifest_ref:
        "minio://edge-test-01/lineage-results/model-version-test-0001/results/attempt-0007/result-manifest.json?versionId=v-manifest-0007",
      result_manifest_digest: "a".repeat(64),
      attempt_outcome: "succeeded",
      publication_state: "AVAILABLE",
      completed_at: "2026-07-16T08:41:03.125Z",
      correlation_id: "corr-lineage-0007",
      now: "2026-07-16T08:41:07.500Z",
    });
    jobs.transition(
      job.pipeline_job_id,
      { job_state: "WAITING_CAPACITY" },
      "2026-07-16T08:45:00.000Z",
    );
    const before = fs.readFileSync(storePath, "utf-8");
    expect(jobs.getPipelineResultSnapshotCommitment()).not.toBeNull();
    fs.unlinkSync(resultPath);

    expect(() => makeApp(root, { pipelineJobStorePath: storePath })).toThrow(
      PipelineResultStateUnavailableError,
    );
    expect(fs.readFileSync(storePath, "utf-8")).toBe(before);
    const persisted = JSON.parse(before) as {
      records: Array<{
        job_state: string;
        ready_event_ledger: Array<{ event_kind: string }>;
      }>;
      result_snapshot_commitment?: unknown;
    };
    expect(persisted.result_snapshot_commitment).toBeDefined();
    expect(persisted.records[0].job_state).toBe("WAITING_CAPACITY");
    expect(persisted.records[0].ready_event_ledger.at(-1)?.event_kind).not.toBe(
      "coordinator_restart",
    );
  });

  it("legacy in-memory 佇列的 dropped_on_restart 語意不受影響（governed 走另一條路）", () => {
    const app = makeApp(tmpRoot());
    // governed store 與 legacy store 是兩張表、兩個去重空間；接線後 legacy 仍為空且獨立。
    expect(app.externalIfcReadyStore.list()).toHaveLength(0);
    expect(app.pipelineJobStore.list()).toHaveLength(0);
    expect(app.sourceBundleStore.list()).toHaveLength(0);
  });

  it("3.3/3.4 routes 已掛載但 external verifier 未接時 fail closed；3.2 job 文件不被 overlay", async () => {
    const app = makeApp(tmpRoot());
    const { job } = app.pipelineJobStore.ensureJobForSourceBundle({
      sourceBundleId: "source-bundle-result-wiring-0001",
      externalModelVersionId: "model-version-result-wiring-0001",
      eventId: "ready-event-result-wiring-0001",
      now: "2026-07-16T08:00:00.000Z",
    });

    const stableJob = await request(app.app).get(
      `/api/lineage/pipeline-jobs/${job.pipeline_job_id}`,
    );
    expect(stableJob.status).toBe(200);
    expect(stableJob.body.body.active_result_id).toBeNull();

    const compare = await request(app.app)
      .get(`/api/lineage/pipeline-jobs/${job.pipeline_job_id}/results/compare`)
      .query({ left_result_id: "result-0007", right_result_id: "result-0008" })
      .set("x-lineage-authorization-decision", "synthetic-decision");
    expect(compare.status).toBe(503);
    expect(compare.body.error).toBe("authorization_unavailable");

    for (const surface of ["overview", "artifacts", "alignment", "attempts", "audit"]) {
      const metadata = await request(app.app)
        .get(`/api/lineage/pipeline-jobs/${job.pipeline_job_id}/${surface}`)
        .set("x-lineage-authorization-decision", "synthetic-decision");
      expect(metadata.status, surface).toBe(503);
      expect(metadata.body).toEqual({ error: "authorization_unavailable" });
    }

    const download = await request(app.app)
      .get(
        `/api/lineage/pipeline-jobs/${job.pipeline_job_id}/results/result-0007/artifacts/usdc/download`,
      )
      .set("x-lineage-authorization-decision", "synthetic-decision");
    expect(download.status).toBe(503);
    expect(download.body).toEqual({ error: "authorization_unavailable" });
  });
});

describe("app 接線：reconciler 生命週期", () => {
  it("預設關閉：不排程、不掃 MinIO", () => {
    const port = createFakeSourceBundleObjectPort(TEST_ALLOWLIST);
    const app = makeApp(
      tmpRoot(),
      { governedSourcePrefix: `minio://${TEST_AUTHORITY}/${TEST_BUCKET}/source-bundles/` },
      port,
    );

    expect(app.config.sourceBundleReconcileEnabled).toBe(false);
    expect(app.sourceBundleReconciler.status().enabled).toBe(false);
    expect(app.sourceBundleReconciler.status().started).toBe(false);
    expect(port.listCalls).toBe(0);
  });

  it("開啟後 pollNow 撿到 MinIO 上的 governed bundle 並給它 stable job", async () => {
    const port = createFakeSourceBundleObjectPort(TEST_ALLOWLIST);
    const seeded = seedGovernedBundle(port);
    const app = makeApp(
      tmpRoot(),
      {
        governedSourcePrefix: `minio://${TEST_AUTHORITY}/${TEST_BUCKET}/source-bundles/`,
        sourceBundleReconcileEnabled: true,
      },
      port,
    );

    const result = await app.sourceBundleReconciler.pollNow();

    expect(result.errors).toBe(0);
    expect(app.sourceBundleStore.get(seeded.claim.source_bundle_id)).not.toBeNull();
    expect(app.pipelineJobStore.list()).toHaveLength(1);
    expect(app.pipelineJobStore.getBySourceBundle(seeded.claim.source_bundle_id)!.pipeline_job_id)
      .toBe(pipelineJobIdFor(seeded.claim.source_bundle_id));
  });

  it("interval 有下限（防忙迴圈連打 MinIO）", () => {
    const app = makeApp(tmpRoot(), { sourceBundleReconcileIntervalMs: 1 });
    expect(app.config.sourceBundleReconcileIntervalMs).toBeGreaterThanOrEqual(5_000);
  });

  it("dispose 先停 reconciler 再 destroy object port（順序可被 falsify）", async () => {
    const port = createFakeSourceBundleObjectPort(TEST_ALLOWLIST);
    seedGovernedBundle(port);
    const app = makeApp(
      tmpRoot(),
      {
        governedSourcePrefix: `minio://${TEST_AUTHORITY}/${TEST_BUCKET}/source-bundles/`,
        sourceBundleReconcileEnabled: true,
      },
      port,
    );
    await app.sourceBundleReconciler.pollNow();

    await app.dispose();

    expect(app.sourceBundleReconciler.status().started).toBe(false);
    expect(port.destroyCalls).toBe(1);
    // dispose 冪等（afterEach 會再呼叫一次；重跑不得重複 destroy）。
    await app.dispose();
    expect(port.destroyCalls).toBe(1);
  });
});
