import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  PipelineJobStore,
  pipelineJobIdFor,
} from "../../src/services/lineage/pipelineJobStore.js";
import { sequentialEventIds } from "../helpers/fakePipelineJobDeps.js";

/**
 * `rvt-ifc-usdc-lineage` task 3.2 —— **coordinator restart 恢復**。
 *
 * Spec scenario（`local-coordinator-ifc-ready-intake-boundary`）：
 *   「coordinator 在 governed pipeline job 處於 `WAITING_CAPACITY` 或 publication
 *     中途時重啟 → 該 job SHALL 由 durable state 恢復並重新進入 runtime admission
 *     → 它 MUST NOT 被標為 `dropped_on_restart`，也 MUST NOT 要求 operator 重送 intake
 *     → legacy 佇列的既有 `dropped_on_restart` 行為 SHALL 不變」
 *
 * ＋ `conversion-attempt-publication`：「streaming restart 與 coordinator restart
 *   MUST NOT 建立第二個 logical job」。
 *
 * 這裡的 restart 是**真的重建 store 物件讀同一個檔**，不是在同一個實例上呼叫方法——
 * 否則測不到「durable state 撐過 process 邊界」這件事。
 */

const BOOT_1 = "2026-07-16T08:00:00.000Z";
const WAIT_AT = "2026-07-16T08:10:00.000Z";
const BOOT_2 = "2026-07-16T09:00:00.000Z";
const BOOT_3 = "2026-07-16T10:00:00.000Z";

const tmpRoots: string[] = [];

function tmpStorePath(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pipeline-job-restart-"));
  tmpRoots.push(root);
  return path.join(root, "pipeline-jobs.json");
}

afterEach(() => {
  while (tmpRoots.length > 0) {
    const root = tmpRoots.pop();
    if (root) fs.rmSync(root, { recursive: true, force: true });
  }
});

function seedJob(storePath: string, sourceBundleId = "source-bundle-test-0001"): PipelineJobStore {
  const store = new PipelineJobStore(storePath);
  store.ensureJobForSourceBundle({
    sourceBundleId,
    externalModelVersionId: "model-version-test-0001",
    tenantId: "tenant-test",
    projectId: "project-test",
    eventId: "evt-0001",
    now: BOOT_1,
  });
  return store;
}

describe("coordinator restart recovery", () => {
  it("WAITING_CAPACITY 的 job 重啟後回到 PENDING_ADMISSION 並重新進入 admission", () => {
    const storePath = tmpStorePath();
    const first = seedJob(storePath);
    const jobId = pipelineJobIdFor("source-bundle-test-0001");
    first.transition(jobId, { job_state: "WAITING_CAPACITY" }, WAIT_AT);

    // ── process 邊界：新的 store 實例讀同一個持久檔 ──
    const rebooted = new PipelineJobStore(storePath);
    expect(rebooted.get(jobId)!.job_state).toBe("WAITING_CAPACITY");

    const recovered = rebooted.recoverOnStart(BOOT_2, sequentialEventIds("restart"));
    expect(recovered).toHaveLength(1);

    const job = rebooted.get(jobId)!;
    expect(job.job_state).toBe("PENDING_ADMISSION");
    expect(job.attempt_count).toBe(0);
    expect(job.updated_at).toBe(BOOT_2);
    const last = job.ready_event_ledger[job.ready_event_ledger.length - 1];
    expect(last.event_kind).toBe("coordinator_restart");
    expect(last.created_new_logical_job).toBe(false);
  });

  it("恢復不建第二個 logical job，也不要求 operator 重送 intake", () => {
    const storePath = tmpStorePath();
    const first = seedJob(storePath);
    const jobId = pipelineJobIdFor("source-bundle-test-0001");
    first.transition(jobId, { job_state: "WAITING_CAPACITY" }, WAIT_AT);

    const rebooted = new PipelineJobStore(storePath);
    rebooted.recoverOnStart(BOOT_2, sequentialEventIds("restart"));

    expect(rebooted.list()).toHaveLength(1);
    expect(rebooted.getBySourceBundle("source-bundle-test-0001")!.pipeline_job_id).toBe(jobId);
    // 「不要求重送 intake」的機器證據：沒有任何一次新的 ready claim，job 就已經回到
    // 可被 admission 取用的狀態。
    const creating = rebooted
      .get(jobId)!
      .ready_event_ledger.filter((entry) => entry.created_new_logical_job);
    expect(creating).toHaveLength(1);
    expect(creating[0].event_kind).toBe("source_bundle_ready");
  });

  it("MUST NOT 標 dropped_on_restart（該語意只屬 legacy 佇列）", () => {
    const storePath = tmpStorePath();
    const first = seedJob(storePath);
    const jobId = pipelineJobIdFor("source-bundle-test-0001");
    first.transition(jobId, { job_state: "WAITING_CAPACITY" }, WAIT_AT);

    const rebooted = new PipelineJobStore(storePath);
    rebooted.recoverOnStart(BOOT_2, sequentialEventIds("restart"));

    // 逐字掃整個持久檔：governed job 的任何欄位都不得出現 legacy 的 restart 語意。
    expect(fs.readFileSync(storePath, "utf-8")).not.toContain("dropped_on_restart");
  });

  it("RUNNING 的 job 恢復時放掉 in-flight attempt，但不燒掉 attempt counter", () => {
    const storePath = tmpStorePath();
    const first = seedJob(storePath);
    const jobId = pipelineJobIdFor("source-bundle-test-0001");
    // attempt 配置屬 task 4.1；這裡直接以 transition 造出「重啟前正在跑」的狀態。
    first.transition(jobId, { job_state: "RUNNING", in_flight_attempt_id: "attempt-0007" }, WAIT_AT);

    const rebooted = new PipelineJobStore(storePath);
    rebooted.recoverOnStart(BOOT_2, sequentialEventIds("restart"));

    const job = rebooted.get(jobId)!;
    expect(job.job_state).toBe("PENDING_ADMISSION");
    expect(job.in_flight_attempt_id).toBeNull();
    expect(job.attempt_count).toBe(0);
  });

  it("PENDING_ADMISSION／TERMINAL 的 job 不動也不 append（ledger 不隨重啟次數膨脹）", () => {
    const storePath = tmpStorePath();
    const first = seedJob(storePath);
    const jobId = pipelineJobIdFor("source-bundle-test-0001");
    const pendingLedger = first.get(jobId)!.ready_event_ledger.length;

    const rebooted = new PipelineJobStore(storePath);
    expect(rebooted.recoverOnStart(BOOT_2, sequentialEventIds("restart"))).toHaveLength(0);
    expect(rebooted.get(jobId)!.ready_event_ledger).toHaveLength(pendingLedger);

    rebooted.transition(jobId, { job_state: "TERMINAL" }, WAIT_AT);
    const again = new PipelineJobStore(storePath);
    expect(again.recoverOnStart(BOOT_3, sequentialEventIds("restart"))).toHaveLength(0);
    expect(again.get(jobId)!.job_state).toBe("TERMINAL");
  });

  it("連續兩次重啟只會記一筆 coordinator_restart（第二次已無可恢復的 job）", () => {
    const storePath = tmpStorePath();
    const first = seedJob(storePath);
    const jobId = pipelineJobIdFor("source-bundle-test-0001");
    first.transition(jobId, { job_state: "WAITING_CAPACITY" }, WAIT_AT);

    new PipelineJobStore(storePath).recoverOnStart(BOOT_2, sequentialEventIds("restart-a"));
    const third = new PipelineJobStore(storePath);
    expect(third.recoverOnStart(BOOT_3, sequentialEventIds("restart-b"))).toHaveLength(0);

    const restartEntries = third
      .get(jobId)!
      .ready_event_ledger.filter((entry) => entry.event_kind === "coordinator_restart");
    expect(restartEntries).toHaveLength(1);
  });
});

describe("streaming restart", () => {
  it("streaming restart 不建第二個 logical job", () => {
    const store = new PipelineJobStore(null);
    const created = store.ensureJobForSourceBundle({
      sourceBundleId: "source-bundle-test-0001",
      externalModelVersionId: "model-version-test-0001",
      eventId: "evt-0001",
      now: BOOT_1,
    });

    const restarted = store.ensureJobForSourceBundle({
      sourceBundleId: "source-bundle-test-0001",
      externalModelVersionId: "model-version-test-0001",
      eventId: "evt-restart-0001",
      eventKind: "streaming_restart",
      now: WAIT_AT,
    });

    expect(restarted.created).toBe(false);
    expect(restarted.job.pipeline_job_id).toBe(created.job.pipeline_job_id);
    expect(store.list()).toHaveLength(1);
    const last = restarted.job.ready_event_ledger[restarted.job.ready_event_ledger.length - 1];
    expect(last).toEqual({
      event_id: "evt-restart-0001",
      event_kind: "streaming_restart",
      received_at: WAIT_AT,
      created_new_logical_job: false,
    });
  });

  it("streaming restart 與 coordinator restart 交錯後，logical job 仍只有一個", () => {
    const storePath = tmpStorePath();
    const store = seedJob(storePath);
    const jobId = pipelineJobIdFor("source-bundle-test-0001");
    store.ensureJobForSourceBundle({
      sourceBundleId: "source-bundle-test-0001",
      externalModelVersionId: "model-version-test-0001",
      eventId: "evt-stream-restart",
      eventKind: "streaming_restart",
      now: WAIT_AT,
    });
    store.transition(jobId, { job_state: "WAITING_CAPACITY" }, WAIT_AT);

    const rebooted = new PipelineJobStore(storePath);
    rebooted.recoverOnStart(BOOT_2, sequentialEventIds("restart"));

    expect(rebooted.list()).toHaveLength(1);
    const ledger = rebooted.get(jobId)!.ready_event_ledger;
    expect(ledger.map((entry) => entry.event_kind)).toEqual([
      "source_bundle_ready",
      "streaming_restart",
      "coordinator_restart",
    ]);
    expect(ledger.filter((entry) => entry.created_new_logical_job)).toHaveLength(1);
  });
});
