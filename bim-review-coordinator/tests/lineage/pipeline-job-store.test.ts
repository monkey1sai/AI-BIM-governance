import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  PipelineJobIdentityConflictError,
  PipelineJobInvariantError,
  PipelineJobStore,
  READY_EVENT_LEDGER_MAX_ENTRIES,
  pipelineJobIdFor,
  type PipelineJobRecord,
} from "../../src/services/lineage/pipelineJobStore.js";
import {
  createFakeJobStructLogger,
  sequentialEventIds,
} from "../helpers/fakePipelineJobDeps.js";

/**
 * `rvt-ifc-usdc-lineage` task 3.2 —— durable stable pipeline-job store。
 *
 * 這一支釘的是 spec 的核心句：「每個 immutable `source_bundle_id` SHALL 對應一個
 * stable `pipeline_job_id`；ready-event replay、retry、backoff、runtime re-admission、
 * streaming restart 與 coordinator restart MUST NOT 建立第二個 logical job」。
 *
 * 契約權威 = repo-root `tests/contracts/pipeline_job_attempt.json` 的
 * `$defs/pipelineJob` 與 `tests/contracts/lineage/semantic_validators.py` 的
 * `validate_job_scenario`（job 半邊三條規則）。文件形狀對拍在
 * `pipeline-job-contract.test.ts`；本檔測的是 store 行為。
 */

const NOW = "2026-07-16T08:00:00.000Z";
const LATER = "2026-07-16T08:05:12.250Z";

const tmpRoots: string[] = [];

function tmpStorePath(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pipeline-job-store-"));
  tmpRoots.push(root);
  return path.join(root, "pipeline-jobs.json");
}

afterEach(() => {
  while (tmpRoots.length > 0) {
    const root = tmpRoots.pop();
    if (root) fs.rmSync(root, { recursive: true, force: true });
  }
});

function ensure(
  store: PipelineJobStore,
  overrides: Partial<Parameters<PipelineJobStore["ensureJobForSourceBundle"]>[0]> = {},
): ReturnType<PipelineJobStore["ensureJobForSourceBundle"]> {
  return store.ensureJobForSourceBundle({
    sourceBundleId: "source-bundle-test-0001",
    externalModelVersionId: "model-version-test-0001",
    tenantId: "tenant-test",
    projectId: "project-test",
    eventId: "evt-0001",
    now: NOW,
    ...overrides,
  });
}

describe("pipelineJobIdFor", () => {
  it("是決定性的：同一個 source_bundle_id 永遠導出同一個 job id", () => {
    expect(pipelineJobIdFor("source-bundle-test-0001")).toBe(
      pipelineJobIdFor("source-bundle-test-0001"),
    );
  });

  it("不同 bundle 導出不同 job id，且形狀落在 L1 identifier 的 1..200 內", () => {
    const first = pipelineJobIdFor("source-bundle-test-0001");
    const second = pipelineJobIdFor("source-bundle-test-0002");
    expect(first).not.toBe(second);
    expect(first).toMatch(/^pj_[0-9a-f]{32}$/);
    expect(first.length).toBeGreaterThanOrEqual(1);
    expect(first.length).toBeLessThanOrEqual(200);
  });
});

describe("PipelineJobStore.ensureJobForSourceBundle", () => {
  it("首見建立一個 PENDING_ADMISSION 的 job，ledger 第一筆宣告建立 logical job", () => {
    const store = new PipelineJobStore(null);
    const { job, created } = ensure(store);

    expect(created).toBe(true);
    expect(job.owner).toBe("bim-review-coordinator");
    expect(job.pipeline_job_id).toBe(pipelineJobIdFor("source-bundle-test-0001"));
    expect(job.job_state).toBe("PENDING_ADMISSION");
    expect(job.attempt_count).toBe(0);
    expect(job.in_flight_attempt_id).toBeNull();
    expect(job.active_result_id).toBeNull();
    expect(job.manual_correction_blocker).toBeNull();
    expect(job.ready_event_ledger).toEqual([
      {
        event_id: "evt-0001",
        event_kind: "source_bundle_ready",
        received_at: NOW,
        created_new_logical_job: true,
      },
    ]);
  });

  it("同一個 bundle 重複 claim 只有一個 logical job（重複入列 scenario）", () => {
    const store = new PipelineJobStore(null);
    const first = ensure(store);
    const second = ensure(store, { eventId: "evt-0002", now: LATER });

    expect(second.created).toBe(false);
    expect(second.job.pipeline_job_id).toBe(first.job.pipeline_job_id);
    expect(store.list()).toHaveLength(1);
    expect(second.job.ready_event_ledger).toHaveLength(2);
    expect(second.job.ready_event_ledger[1]).toEqual({
      event_id: "evt-0002",
      event_kind: "ready_replay",
      received_at: LATER,
      created_new_logical_job: false,
    });
  });

  it("重放 N 次後，只有 ledger 第一筆宣告建立 logical job", () => {
    const store = new PipelineJobStore(null);
    const nextEventId = sequentialEventIds();
    for (let i = 0; i < 6; i += 1) ensure(store, { eventId: nextEventId() });

    const job = store.getBySourceBundle("source-bundle-test-0001");
    expect(job).not.toBeNull();
    const creating = job!.ready_event_ledger
      .map((entry, index) => ({ index, created: entry.created_new_logical_job }))
      .filter((item) => item.created);
    expect(creating).toEqual([{ index: 0, created: true }]);
    expect(store.list()).toHaveLength(1);
  });

  it("replay 不動 job_state 與 attempt_count", () => {
    const store = new PipelineJobStore(null);
    const created = ensure(store);
    store.transition(created.job.pipeline_job_id, { job_state: "WAITING_CAPACITY" }, LATER);

    const replayed = ensure(store, { eventId: "evt-0002", now: LATER });
    expect(replayed.job.job_state).toBe("WAITING_CAPACITY");
    expect(replayed.job.attempt_count).toBe(0);
  });

  it("同一個 event_id 重送不重複 append（HTTP 重試不長 ledger）", () => {
    const store = new PipelineJobStore(null);
    ensure(store);
    ensure(store, { eventId: "evt-dup", now: LATER });
    const again = ensure(store, { eventId: "evt-dup", now: "2026-07-16T09:00:00.000Z" });

    expect(again.job.ready_event_ledger).toHaveLength(2);
  });

  it("不同 bundle 是不同的 logical job", () => {
    const store = new PipelineJobStore(null);
    ensure(store);
    ensure(store, {
      sourceBundleId: "source-bundle-test-0002",
      externalModelVersionId: "model-version-test-0002",
      eventId: "evt-0002",
    });
    expect(store.list()).toHaveLength(2);
  });

  it("同 bundle 卻換 external_model_version_id → fail-closed，不靜默改綁", () => {
    const store = new PipelineJobStore(null);
    ensure(store);
    expect(() =>
      ensure(store, { externalModelVersionId: "model-version-test-0999", eventId: "evt-0002" }),
    ).toThrow(PipelineJobIdentityConflictError);
  });

  it("tenant/project 未知時不宣告該鍵（L1 additionalProperties:false ＋ 誠實優先）", () => {
    const store = new PipelineJobStore(null);
    const { job } = ensure(store, { tenantId: null, projectId: undefined });
    expect(Object.keys(job)).not.toContain("tenant_id");
    expect(Object.keys(job)).not.toContain("project_id");
  });

  it("以 restart 事件首建 job 時，第一筆也不得宣告建立 logical job", () => {
    const store = new PipelineJobStore(null);
    const { job } = ensure(store, { eventKind: "coordinator_restart" });
    expect(job.ready_event_ledger[0].created_new_logical_job).toBe(false);
  });
});

describe("PipelineJobStore.appendReadyEvent", () => {
  it("restart 事件宣稱建立 logical job → 拒絕（restart_created_second_logical_job）", () => {
    const store = new PipelineJobStore(null);
    const { job } = ensure(store);
    expect(() =>
      store.appendReadyEvent(job.pipeline_job_id, {
        event_id: "evt-restart",
        event_kind: "streaming_restart",
        received_at: LATER,
        created_new_logical_job: true,
      }),
    ).toThrow(/restart_created_second_logical_job/);
  });

  it("非第一筆宣稱建立 logical job → 拒絕（duplicate_logical_job_for_source_bundle）", () => {
    const store = new PipelineJobStore(null);
    const { job } = ensure(store);
    expect(() =>
      store.appendReadyEvent(job.pipeline_job_id, {
        event_id: "evt-dup",
        event_kind: "source_bundle_ready",
        received_at: LATER,
        created_new_logical_job: true,
      }),
    ).toThrow(/duplicate_logical_job_for_source_bundle/);
  });

  it("找不到 job 回 null（不 crash、不憑空造 job）", () => {
    const store = new PipelineJobStore(null);
    expect(
      store.appendReadyEvent("pj_does_not_exist", {
        event_id: "evt-x",
        event_kind: "ready_replay",
        received_at: NOW,
        created_new_logical_job: false,
      }),
    ).toBeNull();
  });

  it("ledger 滿載時只丟非建立型的中段 entry，index 0 一定留著", () => {
    const logs = createFakeJobStructLogger();
    const store = new PipelineJobStore(null, { structLog: logs.logger });
    const { job } = ensure(store);
    const total = READY_EVENT_LEDGER_MAX_ENTRIES + 25;
    for (let i = 0; i < total; i += 1) {
      store.appendReadyEvent(job.pipeline_job_id, {
        event_id: `evt-bulk-${i}`,
        event_kind: "ready_replay",
        received_at: LATER,
        created_new_logical_job: false,
      });
    }

    const latest = store.get(job.pipeline_job_id);
    expect(latest!.ready_event_ledger).toHaveLength(READY_EVENT_LEDGER_MAX_ENTRIES);
    expect(latest!.ready_event_ledger[0].event_id).toBe("evt-0001");
    expect(latest!.ready_event_ledger[0].created_new_logical_job).toBe(true);
    expect(logs.find("ready event ledger truncated").length).toBeGreaterThan(0);
  });
});

describe("PipelineJobStore.transition", () => {
  function seeded(): { store: PipelineJobStore; job: PipelineJobRecord } {
    const store = new PipelineJobStore(null);
    return { store, job: ensure(store).job };
  }

  it("WAITING_CAPACITY 不得持有 attempt（等待容量 scenario）", () => {
    const { store, job } = seeded();
    expect(() =>
      store.transition(
        job.pipeline_job_id,
        { job_state: "WAITING_CAPACITY", in_flight_attempt_id: "attempt-0007" },
        LATER,
      ),
    ).toThrow(PipelineJobInvariantError);
  });

  it("WAITING_CAPACITY 不增加 attempt counter", () => {
    const { store, job } = seeded();
    const waiting = store.transition(job.pipeline_job_id, { job_state: "WAITING_CAPACITY" }, LATER);
    expect(waiting!.attempt_count).toBe(0);
    expect(waiting!.in_flight_attempt_id).toBeNull();
  });

  it("RUNNING 必須帶一個 in-flight attempt", () => {
    const { store, job } = seeded();
    expect(() =>
      store.transition(job.pipeline_job_id, { job_state: "RUNNING" }, LATER),
    ).toThrow(PipelineJobInvariantError);
  });

  it("manual_correction_required 必須帶 blocker", () => {
    const { store, job } = seeded();
    expect(() =>
      store.transition(job.pipeline_job_id, { job_state: "manual_correction_required" }, LATER),
    ).toThrow(PipelineJobInvariantError);
  });

  it("已有 retry ledger entry 的 job 不得進 manual_correction_required", () => {
    const { store, job } = seeded();
    store.appendReadyEvent(job.pipeline_job_id, {
      event_id: "evt-retry",
      event_kind: "retry",
      received_at: LATER,
      created_new_logical_job: false,
    });
    expect(() =>
      store.transition(
        job.pipeline_job_id,
        {
          job_state: "manual_correction_required",
          manual_correction_blocker: {
            blocker_code: "semantic_invalid_source",
            detail: "alignment contract not satisfiable",
            requires_new_source_bundle: true,
          },
        },
        LATER,
      ),
    ).toThrow(/semantic_invalid_source_retried_same_job/);
  });

  it("進入 manual_correction_required 之後不得再收 retry（修正要開新 bundle／新 job）", () => {
    const { store, job } = seeded();
    store.transition(
      job.pipeline_job_id,
      {
        job_state: "manual_correction_required",
        manual_correction_blocker: {
          blocker_code: "semantic_invalid_source",
          detail: "alignment contract not satisfiable",
          requires_new_source_bundle: true,
        },
      },
      LATER,
    );
    expect(() =>
      store.appendReadyEvent(job.pipeline_job_id, {
        event_id: "evt-retry",
        event_kind: "retry",
        received_at: LATER,
        created_new_logical_job: false,
      }),
    ).toThrow(/semantic_invalid_source_retried_same_job/);
  });

  it("找不到 job 回 null", () => {
    const store = new PipelineJobStore(null);
    expect(store.transition("pj_missing", { job_state: "TERMINAL" }, NOW)).toBeNull();
  });
});

describe("PipelineJobStore 持久化", () => {
  it("roundtrip：重建 store 仍找得回同一個 job 與整條 ledger", () => {
    const storePath = tmpStorePath();
    const first = new PipelineJobStore(storePath);
    const created = ensure(first);
    ensure(first, { eventId: "evt-0002", now: LATER });

    const reopened = new PipelineJobStore(storePath);
    const restored = reopened.getBySourceBundle("source-bundle-test-0001");
    expect(restored).not.toBeNull();
    expect(restored!.pipeline_job_id).toBe(created.job.pipeline_job_id);
    expect(restored!.ready_event_ledger).toHaveLength(2);
    expect(reopened.list()).toHaveLength(1);
  });

  it("持久檔帶自有 schema_version（不是 L1 envelope 的版本字串）", () => {
    const storePath = tmpStorePath();
    ensure(new PipelineJobStore(storePath));
    const parsed = JSON.parse(fs.readFileSync(storePath, "utf-8")) as { schema_version: string };
    expect(parsed.schema_version).toBe("pipeline-job/v1");
  });

  it("壞檔不 crash，且下一個 ready event 以同一個 job id 重建（決定性 id 的用意）", () => {
    const storePath = tmpStorePath();
    const before = ensure(new PipelineJobStore(storePath)).job.pipeline_job_id;
    fs.writeFileSync(storePath, "{ this is not json", "utf-8");

    const reopened = new PipelineJobStore(storePath);
    expect(reopened.list()).toHaveLength(0);
    const rebuilt = ensure(reopened, { eventId: "evt-after-corruption" });
    expect(rebuilt.job.pipeline_job_id).toBe(before);
    expect(reopened.list()).toHaveLength(1);
  });

  it("殘缺的列被丟棄，不會變成 contract-invalid 的 job 文件", () => {
    const storePath = tmpStorePath();
    fs.writeFileSync(
      storePath,
      JSON.stringify({
        schema_version: "pipeline-job/v1",
        records: [
          { owner: "bim-review-coordinator", pipeline_job_id: "pj_broken" },
          { owner: "someone-else", pipeline_job_id: "pj_wrong_owner" },
        ],
      }),
      "utf-8",
    );
    expect(new PipelineJobStore(storePath).list()).toHaveLength(0);
  });
});
