import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config.js";
import { IntranetDevAuthProvider } from "../../src/services/authProvider.js";
import { autoEnqueueGovernedBundle } from "../../src/services/lineage/pipelineJobEnqueue.js";
import {
  PipelineJobStore,
  pipelineJobIdFor,
} from "../../src/services/lineage/pipelineJobStore.js";
import { SourceBundleStore } from "../../src/services/lineage/sourceBundleStore.js";
import {
  createFakeSourceBundleObjectPort,
  createFakeStructLogger,
  createLineageTestApp,
  createStubValidator,
  readyResultFor,
} from "../helpers/fakeSourceBundleDeps.js";
import { sequentialEventIds } from "../helpers/fakePipelineJobDeps.js";

/**
 * `rvt-ifc-usdc-lineage` task 3.2 —— `/api/lineage/pipeline-jobs*` 讀取面
 * ＋ **ready claim → auto-enqueue 的 route 層冪等證明**。
 *
 * 這一支刻意用真的 `SourceBundleStore` / `PipelineJobStore` ＋ 真的 enqueue，
 * 只把 MinIO 重驗換成 stub validator（重驗本身已由 3.1 的 validator 測試覆蓋）：
 * 要證的是「同一份 claim 打兩次，wire 上回來的 `enqueued_pipeline_job_id` 是同一個」。
 *
 * **沒有 self-POST／固定 port**：supertest 直接掛 express app，不 listen 在 :8004，
 * 不可能誤打到本機部署區（前車之鑑：自打本機部署區造成假綠）。
 */

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const VALID_MINIMAL = JSON.parse(
  fs.readFileSync(
    path.resolve(
      TEST_DIR,
      "..",
      "..",
      "..",
      "tests",
      "contracts",
      "lineage",
      "fixtures",
      "source_bundle_ready",
      "valid",
      "valid-source-bundle-ready-minimal.json",
    ),
    "utf-8",
  ),
) as Record<string, unknown>;

const WEBHOOK_SECRET = "dev-webhook-secret"; // = config 預設（環境設定，非契約資料）
const SOURCE_BUNDLE_ID = VALID_MINIMAL.source_bundle_id as string;

function authHeaders(): Record<string, string> {
  return {
    "X-Webhook-Secret": WEBHOOK_SECRET,
    "X-Correlation-Id": "corr-source-bundle-0003",
    "X-Idempotency-Key": "idem-source-bundle-0003",
  };
}

interface Harness {
  app: express.Express;
  bundles: SourceBundleStore;
  jobs: PipelineJobStore;
}

function makeHarness(options: { withJobs?: boolean } = {}): Harness {
  const bundles = new SourceBundleStore(null);
  const jobs = new PipelineJobStore(null);
  const logs = createFakeStructLogger();
  const withJobs = options.withJobs !== false;
  // 產生器**必須**建在閉包外：每次 enqueue 都重建一個會讓兩次 HTTP claim 拿到同一個
  // event_id，而 store 對同 event_id 是冪等的 → ledger 不會長第二筆，測試就會誤以為
  // 「replay 沒被記錄」。production 用的是 `newReadyEventId()`（randomUUID），每次不同。
  const nextEventId = sequentialEventIds("route");
  const app = createLineageTestApp({
    config: loadConfig({ governedSourcePrefix: "source-bundles/" }),
    authProvider: new IntranetDevAuthProvider(WEBHOOK_SECRET, ["127.0.0.1", "::1"]),
    store: bundles,
    validator: createStubValidator((claim) => readyResultFor(claim)),
    objects: createFakeSourceBundleObjectPort(),
    enqueue: async (record) =>
      autoEnqueueGovernedBundle(record, {
        jobs,
        bundles,
        now: () => "2026-07-16T08:00:00.000Z",
        newEventId: nextEventId,
      }).pipeline_job_id,
    jobs: withJobs ? jobs : null,
    rejectIfIpNotAllowed: () => false,
    structLog: logs.logger,
  });
  return { app, bundles, jobs };
}

function seedJob(jobs: PipelineJobStore, sourceBundleId = SOURCE_BUNDLE_ID): string {
  return jobs.ensureJobForSourceBundle({
    sourceBundleId,
    externalModelVersionId: "model-version-20260715-001",
    tenantId: "tenant-a",
    projectId: "project-library",
    eventId: "evt-0001",
    now: "2026-07-16T08:00:00.000Z",
  }).job.pipeline_job_id;
}

describe("GET /api/lineage/pipeline-jobs?source_bundle_id=", () => {
  it("回 L1 envelope 的 pipeline_job 文件", async () => {
    const h = makeHarness();
    const jobId = seedJob(h.jobs);

    const response = await request(h.app)
      .get("/api/lineage/pipeline-jobs")
      .query({ source_bundle_id: SOURCE_BUNDLE_ID });

    expect(response.status).toBe(200);
    expect(response.body.schema_version).toBe("pipeline-job-attempt/v1");
    expect(response.body.document_type).toBe("pipeline_job");
    expect(response.body.body.pipeline_job_id).toBe(jobId);
    expect(response.body.body.owner).toBe("bim-review-coordinator");
    expect(response.body.body.source_bundle_id).toBe(SOURCE_BUNDLE_ID);
  });

  it("未知 bundle → 404（不回空物件冒充「有 job 但空」）", async () => {
    const h = makeHarness();
    const response = await request(h.app)
      .get("/api/lineage/pipeline-jobs")
      .query({ source_bundle_id: "source-bundle-unknown" });
    expect(response.status).toBe(404);
  });

  it("缺 source_bundle_id → 400（不長出無界列表）", async () => {
    const h = makeHarness();
    const response = await request(h.app).get("/api/lineage/pipeline-jobs");
    expect(response.status).toBe(400);
    expect(response.body.error).toBe("invalid_source_bundle_id");
  });

  it("source_bundle_id 不合 L1 pattern → 400", async () => {
    const h = makeHarness();
    const response = await request(h.app)
      .get("/api/lineage/pipeline-jobs")
      .query({ source_bundle_id: "bad id/with slash" });
    expect(response.status).toBe(400);
  });

  it("job store 未接線 → 503（誠實停擺，不回 404 冒充「沒有」）", async () => {
    const h = makeHarness({ withJobs: false });
    const response = await request(h.app)
      .get("/api/lineage/pipeline-jobs")
      .query({ source_bundle_id: SOURCE_BUNDLE_ID });
    expect(response.status).toBe(503);
    expect(response.body.error).toBe("pipeline_job_store_unavailable");
  });
});

describe("GET /api/lineage/pipeline-jobs/:pipelineJobId", () => {
  it("回 L1 envelope，且 ready_event_ledger 原樣輸出（append-only evidence）", async () => {
    const h = makeHarness();
    const jobId = seedJob(h.jobs);
    h.jobs.appendReadyEvent(jobId, {
      event_id: "evt-0002",
      event_kind: "ready_replay",
      received_at: "2026-07-16T08:05:12.250Z",
      created_new_logical_job: false,
    });

    const response = await request(h.app).get(`/api/lineage/pipeline-jobs/${jobId}`);

    expect(response.status).toBe(200);
    expect(response.body.body.ready_event_ledger).toHaveLength(2);
    expect(response.body.body.ready_event_ledger[0].created_new_logical_job).toBe(true);
    expect(response.body.body.ready_event_ledger[1].created_new_logical_job).toBe(false);
  });

  it("未知 job → 404；不合法 id → 400", async () => {
    const h = makeHarness();
    expect((await request(h.app).get("/api/lineage/pipeline-jobs/pj_missing")).status).toBe(404);
    expect((await request(h.app).get("/api/lineage/pipeline-jobs/bad%20id")).status).toBe(400);
  });

  it("job store 未接線 → 503", async () => {
    const h = makeHarness({ withJobs: false });
    const response = await request(h.app).get("/api/lineage/pipeline-jobs/pj_anything");
    expect(response.status).toBe(503);
  });

  it("靜態 `/api/lineage/pipeline-jobs` 先於 `/:pipelineJobId` 命中", async () => {
    const h = makeHarness();
    seedJob(h.jobs);
    // 若註冊順序反了，這一發會被 `/:pipelineJobId` 吃掉並回 404 而不是 400。
    const response = await request(h.app).get("/api/lineage/pipeline-jobs");
    expect(response.status).toBe(400);
  });
});

describe("ready claim → auto-enqueue（route 層冪等）", () => {
  it("同一份 claim 打兩次：202 → 200，且回同一個 pipeline_job_id", async () => {
    const h = makeHarness();

    const first = await request(h.app)
      .post("/api/external/source-bundles/ready")
      .set(authHeaders())
      .send(VALID_MINIMAL);
    const second = await request(h.app)
      .post("/api/external/source-bundles/ready")
      .set(authHeaders())
      .send(VALID_MINIMAL);

    expect(first.status).toBe(202);
    expect(second.status).toBe(200);
    expect(second.body.body.replay).toBe(true);

    const jobId = pipelineJobIdFor(SOURCE_BUNDLE_ID);
    expect(first.body.body.enqueued_pipeline_job_id).toBe(jobId);
    expect(second.body.body.enqueued_pipeline_job_id).toBe(jobId);
    expect(h.jobs.list()).toHaveLength(1);
    expect(h.bundles.list()).toHaveLength(1);
  });

  it("claim 之後可由 job 讀取面證明 1:1（bundle → 唯一 job）", async () => {
    const h = makeHarness();
    await request(h.app)
      .post("/api/external/source-bundles/ready")
      .set(authHeaders())
      .send(VALID_MINIMAL);
    await request(h.app)
      .post("/api/external/source-bundles/ready")
      .set(authHeaders())
      .send(VALID_MINIMAL);

    const byBundle = await request(h.app)
      .get("/api/lineage/pipeline-jobs")
      .query({ source_bundle_id: SOURCE_BUNDLE_ID });
    expect(byBundle.status).toBe(200);
    const ledger = byBundle.body.body.ready_event_ledger as Array<Record<string, unknown>>;
    expect(ledger.filter((entry) => entry.created_new_logical_job)).toHaveLength(1);
    expect(ledger.map((entry) => entry.event_kind)).toEqual([
      "source_bundle_ready",
      "ready_replay",
    ]);

    const byId = await request(h.app).get(
      `/api/lineage/pipeline-jobs/${byBundle.body.body.pipeline_job_id}`,
    );
    expect(byId.status).toBe(200);
    expect(byId.body.body.source_bundle_id).toBe(SOURCE_BUNDLE_ID);
  });

  it("bundle 的 read model 帶著同一個 job id（enqueued_pipeline_job_id 不再恆為 null）", async () => {
    const h = makeHarness();
    await request(h.app)
      .post("/api/external/source-bundles/ready")
      .set(authHeaders())
      .send(VALID_MINIMAL);

    const detail = await request(h.app).get(`/api/external/source-bundles/${SOURCE_BUNDLE_ID}`);
    expect(detail.status).toBe(200);
    expect(detail.body.validation_summary.enqueued_pipeline_job_id).toBe(
      pipelineJobIdFor(SOURCE_BUNDLE_ID),
    );
  });
});
