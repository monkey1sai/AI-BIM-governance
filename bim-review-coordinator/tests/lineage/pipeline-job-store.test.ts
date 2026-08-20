import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PipelineJobStore } from "../../src/services/lineage/pipelineJobStore.js";
import type { SourceBundleRecord } from "../../src/services/lineage/sourceBundleStore.js";

const tempRoots: string[] = [];

function makeStorePath(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pipeline-job-store-"));
  tempRoots.push(root);
  return path.join(root, "data", "pipeline-jobs.json");
}

function makeBundle(overrides: Partial<SourceBundleRecord> = {}): SourceBundleRecord {
  return {
    source_bundle_id: "source-bundle-0003",
    external_model_version_id: "model-version-20260715-001",
    tenant_id: "tenant-a",
    project_id: "project-library",
    project_display_name: "library",
    model_category: "structure",
    manifest_ref:
      "minio://edge-test-01/source-bundles-test/source-bundles/tenant-a/project-library/manifest.json?versionId=v-1",
    manifest_sha256: "a".repeat(64),
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

afterEach(() => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (root) fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("PipelineJobStore — 3.2 stable job + restart", () => {
  it("首見 READY bundle → PENDING_ADMISSION 且 minted 一個 logical job", () => {
    const store = new PipelineJobStore(null);
    const first = store.ensureFromReadyBundle(makeBundle(), "2026-07-16T08:00:00.000Z");
    expect(first.createdNew).toBe(true);
    expect(first.job.owner).toBe("bim-review-coordinator");
    expect(first.job.job_state).toBe("PENDING_ADMISSION");
    expect(first.job.attempt_count).toBe(0);
    expect(first.job.in_flight_attempt_id).toBeNull();
    expect(first.job.active_result_id).toBeNull();
    expect(first.job.ready_event_ledger).toEqual([
      {
        event_id: first.job.ready_event_ledger[0]?.event_id,
        event_kind: "source_bundle_ready",
        received_at: "2026-07-16T08:00:00.000Z",
        created_new_logical_job: true,
      },
    ]);
    expect(first.job.ready_event_ledger.filter((entry) => entry.created_new_logical_job)).toHaveLength(1);
  });

  it("同 bundle replay → 同一 pipeline_job_id，追加 ready_replay，不建第二個 job", () => {
    const store = new PipelineJobStore(null);
    const first = store.ensureFromReadyBundle(makeBundle(), "2026-07-16T08:00:00.000Z");
    const replay = store.ensureFromReadyBundle(makeBundle(), "2026-07-16T08:10:00.000Z");
    expect(replay.createdNew).toBe(false);
    expect(replay.job.pipeline_job_id).toBe(first.job.pipeline_job_id);
    expect(store.list()).toHaveLength(1);
    expect(replay.job.job_state).toBe("PENDING_ADMISSION");
    expect(replay.job.attempt_count).toBe(0);
    expect(replay.job.ready_event_ledger.map((entry) => entry.event_kind)).toEqual([
      "source_bundle_ready",
      "ready_replay",
    ]);
    expect(replay.job.ready_event_ledger[1]?.created_new_logical_job).toBe(false);
  });

  it("不同 bundle → 不同 pipeline_job_id", () => {
    const store = new PipelineJobStore(null);
    const left = store.ensureFromReadyBundle(makeBundle(), "2026-07-16T08:00:00.000Z");
    const right = store.ensureFromReadyBundle(
      makeBundle({ source_bundle_id: "source-bundle-0004" }),
      "2026-07-16T08:00:01.000Z",
    );
    expect(right.job.pipeline_job_id).not.toBe(left.job.pipeline_job_id);
    expect(store.list()).toHaveLength(2);
  });

  it("寫盤後新 store 實例恢復同一 job，不 mint 第二個 logical job", () => {
    const storePath = makeStorePath();
    const first = new PipelineJobStore(storePath).ensureFromReadyBundle(
      makeBundle(),
      "2026-07-16T08:00:00.000Z",
    );
    const recovered = new PipelineJobStore(storePath);
    const replay = recovered.ensureFromReadyBundle(makeBundle(), "2026-07-16T08:23:41.000Z");
    expect(replay.createdNew).toBe(false);
    expect(replay.job.pipeline_job_id).toBe(first.job.pipeline_job_id);
    expect(replay.job.created_at).toBe("2026-07-16T08:00:00.000Z");
    expect(replay.job.job_state).toBe("PENDING_ADMISSION");
    expect(recovered.list()).toHaveLength(1);
  });

  it("壞檔不 crash，當成空 store 起手", () => {
    const storePath = makeStorePath();
    fs.mkdirSync(path.dirname(storePath), { recursive: true });
    fs.writeFileSync(storePath, "{not-json", "utf-8");
    const store = new PipelineJobStore(storePath);
    expect(store.list()).toEqual([]);
    const created = store.ensureFromReadyBundle(makeBundle(), "2026-07-16T08:00:00.000Z");
    expect(created.createdNew).toBe(true);
  });
});
