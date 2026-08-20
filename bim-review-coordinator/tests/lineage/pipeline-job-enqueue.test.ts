import { describe, expect, it } from "vitest";
import {
  PipelineJobEnqueueRefusedError,
  autoEnqueueGovernedBundle,
  newReadyEventId,
} from "../../src/services/lineage/pipelineJobEnqueue.js";
import {
  PipelineJobStore,
  pipelineJobIdFor,
} from "../../src/services/lineage/pipelineJobStore.js";
import { SourceBundleStore } from "../../src/services/lineage/sourceBundleStore.js";
import {
  createFakeJobStructLogger,
  readyBundleRecord,
  sequentialEventIds,
} from "../helpers/fakePipelineJobDeps.js";

/**
 * `rvt-ifc-usdc-lineage` task 3.2 —— **idempotent auto-enqueue**。
 *
 * 這裡用的是**真的** `SourceBundleStore` 與 `PipelineJobStore`（純記憶體模式），
 * 不是替身：本檔要證明的正是兩個 store 之間的冪等接線，替身會把待證的東西假設掉。
 *
 * 邊界斷言（D-9）：enqueue 只落 `PENDING_ADMISSION`，不得產生 admission_record、
 * 不得配置 attempt、不得動 active_result。
 */

const NOW = "2026-07-16T08:00:00.000Z";
const LATER = "2026-07-16T08:30:00.000Z";

function harness(now: string = NOW) {
  const bundles = new SourceBundleStore(null);
  const jobs = new PipelineJobStore(null);
  const logs = createFakeJobStructLogger();
  const clock = { value: now };
  return {
    bundles,
    jobs,
    logs,
    clock,
    deps: {
      jobs,
      bundles,
      now: () => clock.value,
      newEventId: sequentialEventIds(),
      structLog: logs.logger,
    },
  };
}

describe("autoEnqueueGovernedBundle", () => {
  it("首次 enqueue 建立 stable job 並回填 SourceBundleStore", () => {
    const h = harness();
    const admitted = h.bundles.admit(readyBundleRecord());
    const result = autoEnqueueGovernedBundle(admitted.record, h.deps);

    expect(result.created).toBe(true);
    expect(result.pipeline_job_id).toBe(pipelineJobIdFor("source-bundle-test-0001"));
    expect(h.bundles.get("source-bundle-test-0001")!.pipeline_job_id).toBe(result.pipeline_job_id);
    expect(h.jobs.list()).toHaveLength(1);
  });

  it("同一個 bundle 再 enqueue 一次回既有 job，不建第二個", () => {
    const h = harness();
    const admitted = h.bundles.admit(readyBundleRecord());
    const first = autoEnqueueGovernedBundle(admitted.record, h.deps);

    h.clock.value = LATER;
    const replayRecord = h.bundles.get("source-bundle-test-0001")!;
    const second = autoEnqueueGovernedBundle(replayRecord, h.deps);

    expect(second.created).toBe(false);
    expect(second.pipeline_job_id).toBe(first.pipeline_job_id);
    expect(h.jobs.list()).toHaveLength(1);
    expect(second.job.ready_event_ledger.map((entry) => entry.event_kind)).toEqual([
      "source_bundle_ready",
      "ready_replay",
    ]);
  });

  it("replay（同 digest 再 admit）走完整條路徑仍只有一個 logical job", () => {
    const h = harness();
    const first = h.bundles.admit(readyBundleRecord());
    autoEnqueueGovernedBundle(first.record, h.deps);

    h.clock.value = LATER;
    // 同 id 同 digest → replay_same_digest；record 已帶著 pipeline_job_id 回來。
    const replayed = h.bundles.admit(readyBundleRecord({ validated_at: LATER, updated_at: LATER }));
    expect(replayed.outcome).toBe("replay_same_digest");
    const second = autoEnqueueGovernedBundle(replayed.record, h.deps);

    expect(second.created).toBe(false);
    expect(h.jobs.list()).toHaveLength(1);
    expect(h.bundles.list()).toHaveLength(1);
  });

  it("enqueue 只落 PENDING_ADMISSION：不配 attempt、不動 active result、不造 admission", () => {
    const h = harness();
    const admitted = h.bundles.admit(readyBundleRecord());
    const { job } = autoEnqueueGovernedBundle(admitted.record, h.deps);

    expect(job.job_state).toBe("PENDING_ADMISSION");
    expect(job.attempt_count).toBe(0);
    expect(job.in_flight_attempt_id).toBeNull();
    expect(job.active_result_id).toBeNull();
    expect(job.manual_correction_blocker).toBeNull();
  });

  it("非 READY 的 bundle 一律拒絕（只有 READY 可持有 job）", () => {
    const h = harness();
    const nonReady = readyBundleRecord({ bundle_state: "NON_READY" });
    expect(() => autoEnqueueGovernedBundle(nonReady, h.deps)).toThrow(
      PipelineJobEnqueueRefusedError,
    );
    expect(h.jobs.list()).toHaveLength(0);
  });

  it("呼叫端可指定 streaming_restart，但它一樣不建第二個 logical job", () => {
    const h = harness();
    const admitted = h.bundles.admit(readyBundleRecord());
    const first = autoEnqueueGovernedBundle(admitted.record, h.deps);

    const restarted = autoEnqueueGovernedBundle(h.bundles.get("source-bundle-test-0001")!, h.deps, {
      eventKind: "streaming_restart",
      eventId: "evt-stream-restart",
    });

    expect(restarted.pipeline_job_id).toBe(first.pipeline_job_id);
    expect(restarted.created).toBe(false);
    expect(h.jobs.list()).toHaveLength(1);
    const last = restarted.job.ready_event_ledger.at(-1)!;
    expect(last.event_kind).toBe("streaming_restart");
    expect(last.created_new_logical_job).toBe(false);
  });

  it("兩個不同 bundle 得到兩個不同的 job", () => {
    const h = harness();
    const a = h.bundles.admit(readyBundleRecord());
    const b = h.bundles.admit(
      readyBundleRecord({
        source_bundle_id: "source-bundle-test-0002",
        external_model_version_id: "model-version-test-0002",
        manifest_sha256: "b".repeat(64),
      }),
    );
    const first = autoEnqueueGovernedBundle(a.record, h.deps);
    const second = autoEnqueueGovernedBundle(b.record, h.deps);

    expect(first.pipeline_job_id).not.toBe(second.pipeline_job_id);
    expect(h.jobs.list()).toHaveLength(2);
  });

  it("結構化記錄帶上 created_new_logical_job，讓「沒偷建第二個」在 log 面也留得下證據", () => {
    const h = harness();
    const admitted = h.bundles.admit(readyBundleRecord());
    autoEnqueueGovernedBundle(admitted.record, h.deps);
    autoEnqueueGovernedBundle(h.bundles.get("source-bundle-test-0001")!, h.deps);

    const logged = h.logs.find("governed bundle auto-enqueued");
    expect(logged).toHaveLength(2);
    expect(logged[0].data?.created_new_logical_job).toBe(true);
    expect(logged[1].data?.created_new_logical_job).toBe(false);
  });
});

describe("newReadyEventId", () => {
  it("產生不重複、非空的事件 id", () => {
    const first = newReadyEventId();
    const second = newReadyEventId();
    expect(first).not.toBe(second);
    expect(first.startsWith("ready-evt-")).toBe(true);
    expect(first.length).toBeLessThanOrEqual(200);
  });
});
