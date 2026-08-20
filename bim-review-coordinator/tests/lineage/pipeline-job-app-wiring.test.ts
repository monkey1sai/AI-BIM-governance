import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createCoordinatorApp, type CoordinatorApp } from "../../src/app.js";
import type { CoordinatorConfig } from "../../src/config.js";
import { pipelineJobIdFor } from "../../src/services/lineage/pipelineJobStore.js";
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

  it("legacy in-memory 佇列的 dropped_on_restart 語意不受影響（governed 走另一條路）", () => {
    const app = makeApp(tmpRoot());
    // governed store 與 legacy store 是兩張表、兩個去重空間；接線後 legacy 仍為空且獨立。
    expect(app.externalIfcReadyStore.list()).toHaveLength(0);
    expect(app.pipelineJobStore.list()).toHaveLength(0);
    expect(app.sourceBundleStore.list()).toHaveLength(0);
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
