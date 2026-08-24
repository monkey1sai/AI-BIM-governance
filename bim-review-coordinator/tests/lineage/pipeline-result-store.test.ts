import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PipelineJobStore } from "../../src/services/lineage/pipelineJobStore.js";
import {
  PipelineResultConflictError,
  PipelineResultCompareInvariantError,
  PipelineResultInvariantError,
  PipelineResultRevisionConflictError,
  PipelineResultStateUnavailableError,
  PipelineResultStore,
  type RegisterPipelineResultInput,
} from "../../src/services/lineage/pipelineResultStore.js";

const NOW = "2026-07-16T08:41:07.500Z";
const LATER = "2026-07-16T08:45:00.000Z";
const tmpRoots: string[] = [];

function tmpStorePath(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pipeline-result-store-"));
  tmpRoots.push(root);
  return path.join(root, "pipeline-results.json");
}

afterEach(() => {
  while (tmpRoots.length > 0) {
    const root = tmpRoots.pop();
    if (root) fs.rmSync(root, { recursive: true, force: true });
  }
});

function jobs(): { store: PipelineJobStore; pipelineJobId: string } {
  const store = new PipelineJobStore(null);
  const { job } = store.ensureJobForSourceBundle({
    sourceBundleId: "source-bundle-test-0001",
    externalModelVersionId: "model-version-test-0001",
    eventId: "ready-event-0001",
    now: "2026-07-16T08:00:00.000Z",
  });
  return { store, pipelineJobId: job.pipeline_job_id };
}

function resultInput(
  pipelineJobId: string,
  overrides: Partial<RegisterPipelineResultInput> = {},
): RegisterPipelineResultInput {
  return {
    result_id: "result-0007",
    attempt_id: "attempt-0007",
    pipeline_job_id: pipelineJobId,
    source_bundle_id: "source-bundle-test-0001",
    external_model_version_id: "model-version-test-0001",
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
    now: NOW,
    ...overrides,
  };
}

describe("PipelineResultStore.registerResult", () => {
  it("第一個 selectable result 原子建立 active pointer 與 system first-activation audit", () => {
    const { store: jobStore, pipelineJobId } = jobs();
    const store = new PipelineResultStore(jobStore, null);

    const registered = store.registerResult(resultInput(pipelineJobId));

    expect(registered.replay).toBe(false);
    expect(registered.result.selection_state).toBe("active");
    expect(registered.active_result_pointer).toMatchObject({
      pipeline_job_id: pipelineJobId,
      result_id: "result-0007",
      attempt_id: "attempt-0007",
      selection_state: "active",
      publication_state: "AVAILABLE",
      attempt_outcome: "succeeded",
      activated_at: NOW,
      correlation_id: "corr-lineage-0007",
    });
    expect(registered.activation_audit_entry).toMatchObject({
      pipeline_job_id: pipelineJobId,
      transition: "first_activation",
      from_result_id: null,
      to_result_id: "result-0007",
      capability: null,
      actor: { actor_kind: "system", actor_id: "bim-review-coordinator" },
      authorization_decision_ref: null,
      append_only: true,
    });
    expect(registered.active_result_pointer?.audit_entry_id).toBe(
      registered.activation_audit_entry?.audit_entry_id,
    );
    expect(store.listActivationAudit(pipelineJobId)).toHaveLength(1);
  });

  it("後續 selectable result 保持 candidate，不自動取代 active pointer", () => {
    const { store: jobStore, pipelineJobId } = jobs();
    const store = new PipelineResultStore(jobStore, null);
    const first = store.registerResult(resultInput(pipelineJobId));

    const second = store.registerResult(
      resultInput(pipelineJobId, {
        result_id: "result-0008",
        attempt_id: "attempt-0008",
        attempt_number: 2,
        result_prefix:
          "minio://edge-test-01/lineage-results/model-version-test-0001/results/attempt-0008/",
        result_manifest_ref:
          "minio://edge-test-01/lineage-results/model-version-test-0001/results/attempt-0008/result-manifest.json?versionId=v-manifest-0008",
        result_manifest_digest: "b".repeat(64),
        attempt_outcome: "succeeded_with_warnings",
        correlation_id: "corr-lineage-0008",
        now: LATER,
      }),
    );

    expect(second.result.selection_state).toBe("candidate");
    expect(second.activation_audit_entry).toBeNull();
    expect(second.active_result_pointer).toEqual(first.active_result_pointer);
    expect(store.listActivationAudit(pipelineJobId)).toHaveLength(1);
  });

  it.each([
    ["failed", "AVAILABLE"],
    ["cancelled", "AVAILABLE"],
    ["succeeded", "PUBLISHING"],
    ["succeeded_with_warnings", "INVALID"],
  ] as const)(
    "%s + %s 可保存為 formal evidence，但沒有 selection state 或 pointer",
    (attemptOutcome, publicationState) => {
      const { store: jobStore, pipelineJobId } = jobs();
      const store = new PipelineResultStore(jobStore, null);
      const registered = store.registerResult(
        resultInput(pipelineJobId, {
          attempt_outcome: attemptOutcome,
          publication_state: publicationState,
        }),
      );
      expect(registered.result.selection_state).toBeNull();
      expect(registered.active_result_pointer).toBeNull();
      expect(registered.activation_audit_entry).toBeNull();
    },
  );

  it("同一 immutable result 重送冪等；同 id 異 digest fail closed", () => {
    const { store: jobStore, pipelineJobId } = jobs();
    const store = new PipelineResultStore(jobStore, null);
    const first = store.registerResult(resultInput(pipelineJobId));
    const replay = store.registerResult(resultInput(pipelineJobId, { now: LATER }));
    expect(replay.replay).toBe(true);
    expect(replay.result).toEqual(first.result);
    expect(store.listActivationAudit(pipelineJobId)).toHaveLength(1);

    expect(() =>
      store.registerResult(
        resultInput(pipelineJobId, { result_manifest_digest: "c".repeat(64), now: LATER }),
      ),
    ).toThrow(PipelineResultConflictError);
  });

  it("拒絕未知 job、cross-job source identity 與 attempt id 重綁", () => {
    const { store: jobStore, pipelineJobId } = jobs();
    const store = new PipelineResultStore(jobStore, null);
    expect(() => store.registerResult(resultInput("pj_missing"))).toThrow(
      PipelineResultInvariantError,
    );
    expect(() =>
      store.registerResult(
        resultInput(pipelineJobId, { source_bundle_id: "source-bundle-other" }),
      ),
    ).toThrow(PipelineResultInvariantError);

    store.registerResult(resultInput(pipelineJobId));
    expect(() =>
      store.registerResult(
        resultInput(pipelineJobId, {
          result_id: "result-0008",
          result_manifest_digest: "b".repeat(64),
        }),
      ),
    ).toThrow(PipelineResultConflictError);
  });

  it.each([
    "minio://edge-test-01/lineage-results/path/result-manifest.json?versionId=v1&extra=1",
    "minio://edge-test-01/lineage-results/path/result-manifest.json?versionId=v1#fragment",
    "minio://edge-test-01/lineage-results/path/result-manifest.json?versionId=v1&X-Amz-Signature=x",
  ])("拒絕非單一 immutable version locator：%s", (resultManifestRef) => {
    const { store: jobStore, pipelineJobId } = jobs();
    const store = new PipelineResultStore(jobStore, null);
    expect(() =>
      store.registerResult(
        resultInput(pipelineJobId, { result_manifest_ref: resultManifestRef }),
      ),
    ).toThrow(PipelineResultInvariantError);
  });

  it.each([
    [
      "missing trailing slash",
      {
        result_prefix:
          "minio://edge-test-01/lineage-results/model-version-test-0001/results/attempt-0007",
      },
    ],
    [
      "broad non-attempt prefix",
      {
        result_prefix:
          "minio://edge-test-01/lineage-results/model-version-test-0001/results/",
      },
    ],
    [
      "attempt id mismatch",
      {
        result_prefix:
          "minio://edge-test-01/lineage-results/model-version-test-0001/results/attempt-other/",
        result_manifest_ref:
          "minio://edge-test-01/lineage-results/model-version-test-0001/results/attempt-other/result-manifest.json?versionId=v-manifest-0007",
      },
    ],
    [
      "manifest outside prefix",
      {
        result_manifest_ref:
          "minio://edge-test-01/lineage-results/model-version-test-0001/results/attempt-other/result-manifest.json?versionId=v-manifest-0007",
      },
    ],
    [
      "wrong manifest leaf inside prefix",
      {
        result_manifest_ref:
          "minio://edge-test-01/lineage-results/model-version-test-0001/results/attempt-0007/other.json?versionId=v-manifest-0007",
      },
    ],
  ])("拒絕非 attempt-scoped result location：%s", (_name, overrides) => {
    const { store: jobStore, pipelineJobId } = jobs();
    const store = new PipelineResultStore(jobStore, null);
    expect(() => store.registerResult(resultInput(pipelineJobId, overrides))).toThrow(
      PipelineResultInvariantError,
    );
  });
});

describe("PipelineResultStore persistence", () => {
  it("candidate、pointer、audit 同一 sidecar round-trip", () => {
    const file = tmpStorePath();
    const { store: jobStore, pipelineJobId } = jobs();
    const first = new PipelineResultStore(jobStore, file);
    first.registerResult(resultInput(pipelineJobId));

    const reloaded = new PipelineResultStore(jobStore, file);
    expect(reloaded.getActiveResultPointer(pipelineJobId)?.result_id).toBe("result-0007");
    expect(reloaded.listResults(pipelineJobId)).toHaveLength(1);
    expect(reloaded.listActivationAudit(pipelineJobId)).toHaveLength(1);
  });

  it("已 committed 的 result sidecar 遺失時 restart fail closed，不得重建空 pointer/audit", () => {
    const file = tmpStorePath();
    const { store: jobStore, pipelineJobId } = jobs();
    const first = new PipelineResultStore(jobStore, file);
    first.registerResult(resultInput(pipelineJobId));
    expect(jobStore.getPipelineResultSnapshotCommitment()).not.toBeNull();
    fs.unlinkSync(file);

    const reloaded = new PipelineResultStore(jobStore, file);
    expect(() => reloaded.listResults(pipelineJobId)).toThrow(
      PipelineResultStateUnavailableError,
    );
    expect(() => reloaded.registerResult(resultInput(pipelineJobId))).toThrow(
      PipelineResultStateUnavailableError,
    );
  });

  it("result snapshot bytes 與 durable commitment digest 不符時 restart fail closed", () => {
    const file = tmpStorePath();
    const { store: jobStore, pipelineJobId } = jobs();
    const first = new PipelineResultStore(jobStore, file);
    first.registerResult(resultInput(pipelineJobId));
    fs.appendFileSync(file, "\n", "utf-8");

    const reloaded = new PipelineResultStore(jobStore, file);
    expect(() => reloaded.listResults(pipelineJobId)).toThrow(
      PipelineResultStateUnavailableError,
    );
  });

  it("prepare 後、sidecar rename 前 crash：restart 保留 current 並清除 pending", () => {
    const file = tmpStorePath();
    const jobFile = `${file}.jobs`;
    const firstJobs = new PipelineJobStore(jobFile);
    const { job } = firstJobs.ensureJobForSourceBundle({
      sourceBundleId: "source-bundle-test-0001",
      externalModelVersionId: "model-version-test-0001",
      eventId: "ready-event-0001",
      now: "2026-07-16T08:00:00.000Z",
    });
    const first = new PipelineResultStore(firstJobs, file);
    first.registerResult(resultInput(job.pipeline_job_id));
    const current = firstJobs.getPipelineResultSnapshotCommitment();
    expect(current).not.toBeNull();
    firstJobs.preparePipelineResultSnapshot({
      schema_version: current!.schema_version,
      revision: current!.revision + 1,
      snapshot_sha256: "b".repeat(64),
    });

    const reopenedJobs = new PipelineJobStore(jobFile);
    const reopened = new PipelineResultStore(reopenedJobs, file);
    expect(reopened.listResults(job.pipeline_job_id)).toHaveLength(1);
    expect(reopenedJobs.getPipelineResultSnapshotCommitmentState()).toMatchObject({
      current,
      pending: null,
    });
  });

  it("sidecar rename 後、pending promote 前 crash：restart 採用 pending snapshot", () => {
    const file = tmpStorePath();
    const jobFile = `${file}.jobs`;
    const firstJobs = new PipelineJobStore(jobFile);
    const { job } = firstJobs.ensureJobForSourceBundle({
      sourceBundleId: "source-bundle-test-0001",
      externalModelVersionId: "model-version-test-0001",
      eventId: "ready-event-0001",
      now: "2026-07-16T08:00:00.000Z",
    });
    new PipelineResultStore(firstJobs, file).registerResult(resultInput(job.pipeline_job_id));
    const crashBeforePromoteJobs = {
      get: firstJobs.get.bind(firstJobs),
      getPipelineResultSnapshotCommitment:
        firstJobs.getPipelineResultSnapshotCommitment.bind(firstJobs),
      getPipelineResultSnapshotCommitmentState:
        firstJobs.getPipelineResultSnapshotCommitmentState.bind(firstJobs),
      commitPipelineResultSnapshot: firstJobs.commitPipelineResultSnapshot.bind(firstJobs),
      preparePipelineResultSnapshot: firstJobs.preparePipelineResultSnapshot.bind(firstJobs),
      abortPipelineResultSnapshot: firstJobs.abortPipelineResultSnapshot.bind(firstJobs),
      promotePipelineResultSnapshot: () => {
        throw new Error("simulated crash after sidecar rename");
      },
    };
    const crashing = new PipelineResultStore(crashBeforePromoteJobs, file);
    expect(() =>
      crashing.registerResult(
        resultInput(job.pipeline_job_id, {
          result_id: "result-0008",
          attempt_id: "attempt-0008",
          result_prefix:
            "minio://edge-test-01/lineage-results/model-version-test-0001/results/attempt-0008/",
          result_manifest_ref:
            "minio://edge-test-01/lineage-results/model-version-test-0001/results/attempt-0008/result-manifest.json?versionId=v-manifest-0008",
          result_manifest_digest: "b".repeat(64),
          now: LATER,
        }),
      ),
    ).toThrow("simulated crash after sidecar rename");

    const reopenedJobs = new PipelineJobStore(jobFile);
    const reopened = new PipelineResultStore(reopenedJobs, file);
    expect(reopened.listResults(job.pipeline_job_id)).toHaveLength(2);
    expect(reopenedJobs.getPipelineResultSnapshotCommitmentState()).toMatchObject({
      current: { revision: 2 },
      pending: null,
    });
  });

  it("舊 sidecar 無 commitment 時只做一次受控 migration", () => {
    const file = tmpStorePath();
    const jobFile = `${file}.jobs`;
    const firstJobs = new PipelineJobStore(jobFile);
    const { job } = firstJobs.ensureJobForSourceBundle({
      sourceBundleId: "source-bundle-test-0001",
      externalModelVersionId: "model-version-test-0001",
      eventId: "ready-event-0001",
      now: "2026-07-16T08:00:00.000Z",
    });
    const first = new PipelineResultStore(firstJobs, file);
    first.registerResult(resultInput(job.pipeline_job_id));
    const legacyJobs = JSON.parse(fs.readFileSync(jobFile, "utf-8")) as Record<string, unknown>;
    legacyJobs.schema_version = "pipeline-job/v1";
    delete legacyJobs.result_snapshot_commitment;
    fs.writeFileSync(jobFile, JSON.stringify(legacyJobs, null, 2), "utf-8");

    const reopenedJobs = new PipelineJobStore(jobFile);
    expect(reopenedJobs.getPipelineResultSnapshotCommitment()).toBeNull();
    const migrated = new PipelineResultStore(reopenedJobs, file);
    expect(migrated.listResults(job.pipeline_job_id)).toHaveLength(1);
    expect(reopenedJobs.getPipelineResultSnapshotCommitment()).toMatchObject({ revision: 1 });
    const afterMigration = fs.readFileSync(jobFile, "utf-8");
    new PipelineResultStore(new PipelineJobStore(jobFile), file).listResults(job.pipeline_job_id);
    expect(fs.readFileSync(jobFile, "utf-8")).toBe(afterMigration);
  });

  it("兩個 stale instance 以 persisted revision CAS 阻止 last-write-wins", () => {
    const file = tmpStorePath();
    const { store: jobStore, pipelineJobId } = jobs();
    const first = new PipelineResultStore(jobStore, file);
    const stale = new PipelineResultStore(jobStore, file);
    first.registerResult(resultInput(pipelineJobId));

    expect(() =>
      stale.registerResult(
        resultInput(pipelineJobId, {
          result_id: "result-0008",
          attempt_id: "attempt-0008",
          result_prefix:
            "minio://edge-test-01/lineage-results/model-version-test-0001/results/attempt-0008/",
          result_manifest_ref:
            "minio://edge-test-01/lineage-results/model-version-test-0001/results/attempt-0008/result-manifest.json?versionId=v-manifest-0008",
          result_manifest_digest: "b".repeat(64),
        }),
      ),
    ).toThrow(PipelineResultRevisionConflictError);
  });

  it("corrupt sidecar fail closed，但不清空或改寫 stable pipeline job", () => {
    const file = tmpStorePath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "{not-json", "utf-8");
    const { store: jobStore, pipelineJobId } = jobs();
    const store = new PipelineResultStore(jobStore, file);

    expect(() => store.listResults(pipelineJobId)).toThrow(
      PipelineResultStateUnavailableError,
    );
    expect(jobStore.get(pipelineJobId)?.active_result_id).toBeNull();
    expect(fs.readFileSync(file, "utf-8")).toBe("{not-json");
  });

  it("restart 重新驗 strict manifest locator，拒絕被外部竄改的 duplicate query", () => {
    const file = tmpStorePath();
    const { store: jobStore, pipelineJobId } = jobs();
    const first = new PipelineResultStore(jobStore, file);
    first.registerResult(resultInput(pipelineJobId));
    const snapshot = JSON.parse(fs.readFileSync(file, "utf-8")) as {
      results: Array<{ result_manifest_ref: string }>;
    };
    snapshot.results[0].result_manifest_ref += "&extra=1";
    fs.writeFileSync(file, JSON.stringify(snapshot), "utf-8");

    const reloaded = new PipelineResultStore(jobStore, file);
    expect(() => reloaded.listResults(pipelineJobId)).toThrow(
      PipelineResultStateUnavailableError,
    );
  });

  it("restart 重新驗 attempt-scoped prefix 與 manifest boundary", () => {
    const file = tmpStorePath();
    const { store: jobStore, pipelineJobId } = jobs();
    const first = new PipelineResultStore(jobStore, file);
    first.registerResult(resultInput(pipelineJobId));
    const snapshot = JSON.parse(fs.readFileSync(file, "utf-8")) as {
      results: Array<{ result_prefix: string }>;
    };
    snapshot.results[0].result_prefix = snapshot.results[0].result_prefix.slice(0, -1);
    fs.writeFileSync(file, JSON.stringify(snapshot), "utf-8");

    const reloaded = new PipelineResultStore(jobStore, file);
    expect(() => reloaded.listResults(pipelineJobId)).toThrow(
      PipelineResultStateUnavailableError,
    );
  });
});

function registerSecondSelectable(store: PipelineResultStore, pipelineJobId: string): void {
  store.registerResult(
    resultInput(pipelineJobId, {
      result_id: "result-0008",
      attempt_id: "attempt-0008",
      attempt_number: 2,
      result_prefix:
        "minio://edge-test-01/lineage-results/model-version-test-0001/results/attempt-0008/",
      result_manifest_ref:
        "minio://edge-test-01/lineage-results/model-version-test-0001/results/attempt-0008/result-manifest.json?versionId=v-manifest-0008",
      result_manifest_digest: "b".repeat(64),
      attempt_outcome: "succeeded_with_warnings",
      correlation_id: "corr-lineage-0008",
      now: LATER,
    }),
  );
}

describe("PipelineResultStore compare", () => {
  it("compare 僅回同 job selectable views，完全不改 pointer 或 audit", () => {
    const { store: jobStore, pipelineJobId } = jobs();
    const store = new PipelineResultStore(jobStore, null);
    store.registerResult(resultInput(pipelineJobId));
    registerSecondSelectable(store, pipelineJobId);
    const pointerBefore = store.getActiveResultPointer(pipelineJobId);
    const auditBefore = store.listActivationAudit(pipelineJobId);

    const compared = store.getComparableResults(pipelineJobId, "result-0007", "result-0008");
    expect(compared.left.result_id).toBe("result-0007");
    expect(compared.right.result_id).toBe("result-0008");
    expect(store.getActiveResultPointer(pipelineJobId)).toEqual(pointerBefore);
    expect(store.listActivationAudit(pipelineJobId)).toEqual(auditBefore);
  });

  it("cross-job compare 以 contract semantic reason fail closed", () => {
    const { store: jobStore, pipelineJobId } = jobs();
    const otherJob = jobStore.ensureJobForSourceBundle({
      sourceBundleId: "source-bundle-test-0002",
      externalModelVersionId: "model-version-test-0002",
      eventId: "ready-event-0002",
      now: "2026-07-16T08:10:00.000Z",
    }).job;
    const store = new PipelineResultStore(jobStore, null);
    store.registerResult(resultInput(pipelineJobId));
    store.registerResult(
      resultInput(otherJob.pipeline_job_id, {
        result_id: "result-other-0001",
        attempt_id: "attempt-other-0001",
        source_bundle_id: "source-bundle-test-0002",
        external_model_version_id: "model-version-test-0002",
        result_prefix:
          "minio://edge-test-01/lineage-results/model-version-test-0002/results/attempt-other-0001/",
        result_manifest_ref:
          "minio://edge-test-01/lineage-results/model-version-test-0002/results/attempt-other-0001/result-manifest.json?versionId=v-manifest-other-0001",
        result_manifest_digest: "d".repeat(64),
        correlation_id: "corr-lineage-other-0001",
      }),
    );

    let observed: unknown;
    try {
      store.getComparableResults(pipelineJobId, "result-0007", "result-other-0001");
    } catch (error) {
      observed = error;
    }
    expect(observed).toBeInstanceOf(PipelineResultCompareInvariantError);
    expect((observed as PipelineResultCompareInvariantError).reason).toBe(
      "compare_cross_job_rejected",
    );
  });

  it("non-selectable compare 以 typed reason 拒絕且不改 pointer/audit", () => {
    const { store: jobStore, pipelineJobId } = jobs();
    const store = new PipelineResultStore(jobStore, null);
    store.registerResult(resultInput(pipelineJobId));
    store.registerResult(
      resultInput(pipelineJobId, {
        result_id: "result-failed-0008",
        attempt_id: "attempt-failed-0008",
        attempt_number: 2,
        result_prefix:
          "minio://edge-test-01/lineage-results/model-version-test-0001/results/attempt-failed-0008/",
        result_manifest_ref:
          "minio://edge-test-01/lineage-results/model-version-test-0001/results/attempt-failed-0008/result-manifest.json?versionId=v-manifest-failed-0008",
        result_manifest_digest: "e".repeat(64),
        attempt_outcome: "failed",
        correlation_id: "corr-lineage-failed-0008",
      }),
    );
    const pointerBefore = store.getActiveResultPointer(pipelineJobId);
    const auditBefore = store.listActivationAudit(pipelineJobId);

    let observed: unknown;
    try {
      store.getComparableResults(pipelineJobId, "result-0007", "result-failed-0008");
    } catch (error) {
      observed = error;
    }
    expect(observed).toBeInstanceOf(PipelineResultCompareInvariantError);
    expect((observed as PipelineResultCompareInvariantError).reason).toBe(
      "compare_non_selectable",
    );
    expect(store.getActiveResultPointer(pipelineJobId)).toEqual(pointerBefore);
    expect(store.listActivationAudit(pipelineJobId)).toEqual(auditBefore);
  });
});
