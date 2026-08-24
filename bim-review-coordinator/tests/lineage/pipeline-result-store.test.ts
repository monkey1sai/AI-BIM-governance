import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { afterEach, describe, expect, it } from "vitest";
import { PipelineJobStore } from "../../src/services/lineage/pipelineJobStore.js";
import {
  PipelineResultActivationTargetInvariantError,
  PipelineResultConflictError,
  PipelineResultAuthorizationError,
  PipelineResultCompareInvariantError,
  PipelineResultInvariantError,
  PipelineResultRevisionConflictError,
  PipelineResultStateUnavailableError,
  PipelineResultStore,
  type CreatePipelineResultActivationIntentInput,
  type RegisterPipelineResultInput,
  type VerifiedExternalResultDecision,
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

  it("restart 重播 activation audit chain，拒絕被外部竄改的 from_result_id", () => {
    const file = tmpStorePath();
    const { store: jobStore, pipelineJobId } = jobs();
    const first = new PipelineResultStore(jobStore, file);
    first.registerResult(resultInput(pipelineJobId));
    registerSecondSelectable(first, pipelineJobId);
    first.registerResult(
      resultInput(pipelineJobId, {
        result_id: "result-0009",
        attempt_id: "attempt-0009",
        attempt_number: 3,
        result_prefix:
          "minio://edge-test-01/lineage-results/model-version-test-0001/results/attempt-0009/",
        result_manifest_ref:
          "minio://edge-test-01/lineage-results/model-version-test-0001/results/attempt-0009/result-manifest.json?versionId=v-manifest-0009",
        result_manifest_digest: "c".repeat(64),
        correlation_id: "corr-lineage-0009",
        now: "2026-07-16T08:46:00.000Z",
      }),
    );
    first.createActivationIntent(activationIntentInput(pipelineJobId));
    first.confirmActivationIntent({
      intent_id: "intent_promote_0008",
      decision: verifiedDecision(),
      now: "2026-07-16T08:51:00.000Z",
    });
    const snapshot = JSON.parse(fs.readFileSync(file, "utf-8")) as {
      activation_audit: Array<{ transition: string; from_result_id: string | null }>;
    };
    const promote = snapshot.activation_audit.find((entry) => entry.transition === "promote");
    expect(promote).toBeDefined();
    if (!promote) throw new Error("promotion audit fixture was not persisted");
    promote.from_result_id = "result-0009";
    fs.writeFileSync(file, JSON.stringify(snapshot), "utf-8");

    const reloaded = new PipelineResultStore(jobStore, file);
    expect(() => reloaded.listActivationAudit(pipelineJobId)).toThrow(
      /does not continue pointer history/,
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

function activationIntentInput(
  pipelineJobId: string,
  overrides: Partial<CreatePipelineResultActivationIntentInput> = {},
): CreatePipelineResultActivationIntentInput {
  return {
    intent_id: "intent_promote_0008",
    intent_nonce: "nonce-" + "7".repeat(64),
    pipeline_job_id: pipelineJobId,
    target_result_id: "result-0008",
    expected_active_result_id: "result-0007",
    transition: "promote",
    capability: "result.promote",
    reason: "operator selected the verified warning result",
    actor: { actor_kind: "operator", actor_id: "operator-test-01" },
    correlation_id: "corr-promote-0008",
    created_at: "2026-07-16T08:50:00.000Z",
    expires_at: "2026-07-16T08:55:00.000Z",
    ...overrides,
  };
}

function verifiedDecision(
  overrides: Partial<VerifiedExternalResultDecision> = {},
): VerifiedExternalResultDecision {
  return {
    authorization_decision_ref: "decision-result-promote-0008",
    issuer: "https://control-plane.test/",
    audience: "urn:ai-bim:edge-lineage",
    subject: "operator-test-01",
    capability: "result.promote",
    jti: "decision-jti-promote-0008",
    issued_at: "2026-07-16T08:50:05.000Z",
    not_before: "2026-07-16T08:50:05.000Z",
    expires_at: "2026-07-16T08:54:00.000Z",
    verified_at: "2026-07-16T08:51:00.000Z",
    ...overrides,
  };
}

describe("PipelineResultStore protected activation intents", () => {
  it.each([
    ["promote", "result.promote"],
    ["rollback", "result.rollback"],
  ] as const)("%s non-selectable target 以中性 typed reason fail closed", (transition, capability) => {
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

    let observed: unknown;
    try {
      store.createActivationIntent(
        activationIntentInput(pipelineJobId, {
          intent_id: `intent_nonselectable_${transition}`,
          intent_nonce: `nonce-nonselectable-${transition}-` + "e".repeat(64),
          target_result_id: "result-failed-0008",
          transition,
          capability,
        }),
      );
    } catch (error) {
      observed = error;
    }
    expect(observed).toBeInstanceOf(PipelineResultActivationTargetInvariantError);
    expect((observed as PipelineResultActivationTargetInvariantError).reason).toBe(
      "activation_target_not_selectable",
    );
    expect(store.listActivationAudit(pipelineJobId)).toHaveLength(1);
  });

  it.each([
    ["promote", "result.promote", "result-0007"],
    ["rollback", "result.rollback", "result-0008"],
  ] as const)("%s target selection state 不符時以 typed reason fail closed", (transition, capability, targetResultId) => {
    const { store: jobStore, pipelineJobId } = jobs();
    const store = new PipelineResultStore(jobStore, null);
    store.registerResult(resultInput(pipelineJobId));
    registerSecondSelectable(store, pipelineJobId);

    let observed: unknown;
    try {
      store.createActivationIntent(
        activationIntentInput(pipelineJobId, {
          intent_id: `intent_selection_${transition}`,
          intent_nonce: `nonce-selection-${transition}-` + "f".repeat(64),
          target_result_id: targetResultId,
          transition,
          capability,
        }),
      );
    } catch (error) {
      observed = error;
    }
    expect(observed).toBeInstanceOf(PipelineResultActivationTargetInvariantError);
    expect((observed as PipelineResultActivationTargetInvariantError).reason).toBe(
      "selection_state_mismatch",
    );
    expect(store.listActivationAudit(pipelineJobId)).toHaveLength(1);
  });

  it("建立 server-bound intent 只落 nonce hash，pointer/audit 不變", () => {
    const file = tmpStorePath();
    const { store: jobStore, pipelineJobId } = jobs();
    const store = new PipelineResultStore(jobStore, file);
    store.registerResult(resultInput(pipelineJobId));
    registerSecondSelectable(store, pipelineJobId);
    const pointerBefore = store.getActiveResultPointer(pipelineJobId);
    const auditBefore = store.listActivationAudit(pipelineJobId);
    const input = activationIntentInput(pipelineJobId);

    const created = store.createActivationIntent(input);

    expect(created.replay).toBe(false);
    expect(created.intent).toMatchObject({
      intent_id: input.intent_id,
      state: "pending",
      pipeline_job_id: pipelineJobId,
      target_result_id: "result-0008",
      expected_active_result_id: "result-0007",
      decision: null,
    });
    expect(created.intent.intent_nonce_sha256).toMatch(/^[0-9a-f]{64}$/);
    const persisted = fs.readFileSync(file, "utf-8");
    expect(persisted).not.toContain(input.intent_nonce);
    expect(persisted).not.toContain("decision-jti-promote-0008");
    expect(store.getActiveResultPointer(pipelineJobId)).toEqual(pointerBefore);
    expect(store.listActivationAudit(pipelineJobId)).toEqual(auditBefore);
  });

  it("confirm 在同一 commit 消費 decision、切 pointer、append audit；response-loss retry 冪等", () => {
    const file = tmpStorePath();
    const { store: jobStore, pipelineJobId } = jobs();
    const store = new PipelineResultStore(jobStore, file);
    store.registerResult(resultInput(pipelineJobId));
    registerSecondSelectable(store, pipelineJobId);
    store.createActivationIntent(activationIntentInput(pipelineJobId));

    const first = store.confirmActivationIntent({
      intent_id: "intent_promote_0008",
      decision: verifiedDecision(),
      now: "2026-07-16T08:51:00.000Z",
    });
    expect(first).toMatchObject({
      outcome: "committed",
      replay: false,
      active_result_pointer: { result_id: "result-0008" },
      activation_audit_entry: {
        transition: "promote",
        from_result_id: "result-0007",
        to_result_id: "result-0008",
        actor: { actor_id: "operator-test-01" },
        authorization_decision_ref: "decision-result-promote-0008",
      },
      intent: { state: "committed" },
    });
    const replay = store.confirmActivationIntent({
      intent_id: "intent_promote_0008",
      decision: verifiedDecision(),
      now: "2026-07-16T08:51:00.000Z",
    });
    expect(replay.outcome).toBe("committed");
    expect(replay.replay).toBe(true);
    expect(store.listActivationAudit(pipelineJobId)).toHaveLength(2);

    const persisted = fs.readFileSync(file, "utf-8");
    expect(persisted).not.toContain("decision-jti-promote-0008");
    const reloaded = new PipelineResultStore(jobStore, file);
    expect(reloaded.getActivationIntent("intent_promote_0008")?.state).toBe("committed");
    expect(reloaded.getActiveResultPointer(pipelineJobId)?.result_id).toBe("result-0008");
  });

  it("已 committed confirm 在 pointer 後續改變時不得重送歷史 active pointer", () => {
    const { store: jobStore, pipelineJobId } = jobs();
    const store = new PipelineResultStore(jobStore, null);
    store.registerResult(resultInput(pipelineJobId));
    registerSecondSelectable(store, pipelineJobId);
    store.createActivationIntent(activationIntentInput(pipelineJobId));
    store.confirmActivationIntent({
      intent_id: "intent_promote_0008",
      decision: verifiedDecision(),
      now: "2026-07-16T08:51:00.000Z",
    });
    store.createActivationIntent(
      activationIntentInput(pipelineJobId, {
        intent_id: "intent_rollback_after_commit",
        intent_nonce: "nonce-rollback-after-commit-" + "a".repeat(64),
        target_result_id: "result-0007",
        expected_active_result_id: "result-0008",
        transition: "rollback",
        capability: "result.rollback",
        reason: "restore the previous verified result",
        correlation_id: "corr-rollback-after-commit",
        created_at: "2026-07-16T08:52:00.000Z",
        expires_at: "2026-07-16T08:57:00.000Z",
      }),
    );
    store.confirmActivationIntent({
      intent_id: "intent_rollback_after_commit",
      decision: verifiedDecision({
        authorization_decision_ref: "decision-rollback-after-commit",
        capability: "result.rollback",
        jti: "decision-jti-rollback-after-commit",
        issued_at: "2026-07-16T08:52:05.000Z",
        not_before: "2026-07-16T08:52:05.000Z",
        expires_at: "2026-07-16T08:56:00.000Z",
        verified_at: "2026-07-16T08:53:00.000Z",
      }),
      now: "2026-07-16T08:53:00.000Z",
    });

    expect(() =>
      store.confirmActivationIntent({
        intent_id: "intent_promote_0008",
        decision: verifiedDecision({ verified_at: "2026-07-16T08:53:00.000Z" }),
        now: "2026-07-16T08:53:00.000Z",
      }),
    ).toThrow(PipelineResultConflictError);
    expect(store.getActiveResultPointer(pipelineJobId)?.result_id).toBe("result-0007");
  });

  it("stale confirm 終結 intent/jti 但不新增 activation audit，pointer 日後恢復也不可重放", () => {
    const { store: jobStore, pipelineJobId } = jobs();
    const store = new PipelineResultStore(jobStore, null);
    store.registerResult(resultInput(pipelineJobId));
    registerSecondSelectable(store, pipelineJobId);
    store.createActivationIntent(activationIntentInput(pipelineJobId));
    store.createActivationIntent(
      activationIntentInput(pipelineJobId, {
        intent_id: "intent_competing_promote_0008",
        intent_nonce: "nonce-competing-" + "8".repeat(64),
        correlation_id: "corr-competing-promote-0008",
        created_at: "2026-07-16T08:50:10.000Z",
        expires_at: "2026-07-16T08:54:30.000Z",
      }),
    );
    store.confirmActivationIntent({
      intent_id: "intent_competing_promote_0008",
      decision: verifiedDecision({
        authorization_decision_ref: "decision-competing-promote-0008",
        jti: "decision-jti-competing-promote-0008",
        issued_at: "2026-07-16T08:50:10.000Z",
        not_before: "2026-07-16T08:50:10.000Z",
        expires_at: "2026-07-16T08:54:00.000Z",
        verified_at: "2026-07-16T08:50:30.000Z",
      }),
      now: "2026-07-16T08:50:30.000Z",
    });
    const auditBefore = store.listActivationAudit(pipelineJobId);

    const stale = store.confirmActivationIntent({
      intent_id: "intent_promote_0008",
      decision: verifiedDecision(),
      now: "2026-07-16T08:51:00.000Z",
    });
    expect(stale).toMatchObject({
      outcome: "rejected_stale",
      replay: false,
      intent: { state: "rejected_stale" },
      observed_active_result_id: "result-0008",
    });
    expect(store.listActivationAudit(pipelineJobId)).toEqual(auditBefore);

    store.createActivationIntent(
      activationIntentInput(pipelineJobId, {
        intent_id: "intent_rollback_after_stale",
        intent_nonce: "nonce-rollback-after-stale-" + "9".repeat(64),
        target_result_id: "result-0007",
        expected_active_result_id: "result-0008",
        transition: "rollback",
        capability: "result.rollback",
        reason: "restore the previous verified result",
        correlation_id: "corr-rollback-after-stale",
        created_at: "2026-07-16T08:52:00.000Z",
        expires_at: "2026-07-16T08:57:00.000Z",
      }),
    );
    store.confirmActivationIntent({
      intent_id: "intent_rollback_after_stale",
      decision: verifiedDecision({
        authorization_decision_ref: "decision-rollback-after-stale",
        capability: "result.rollback",
        jti: "decision-jti-rollback-after-stale",
        issued_at: "2026-07-16T08:52:05.000Z",
        not_before: "2026-07-16T08:52:05.000Z",
        expires_at: "2026-07-16T08:56:00.000Z",
        verified_at: "2026-07-16T08:53:00.000Z",
      }),
      now: "2026-07-16T08:53:00.000Z",
    });
    const replay = store.confirmActivationIntent({
      intent_id: "intent_promote_0008",
      decision: verifiedDecision({ verified_at: "2026-07-16T08:53:00.000Z" }),
      now: "2026-07-16T08:53:00.000Z",
    });
    expect(replay.outcome).toBe("rejected_stale");
    expect(replay.replay).toBe(true);
    expect(store.getActiveResultPointer(pipelineJobId)?.result_id).toBe("result-0007");
  });

  it("decision subject/capability/time 或跨 intent jti replay 不符時 fail closed", () => {
    const { store: jobStore, pipelineJobId } = jobs();
    const store = new PipelineResultStore(jobStore, null);
    store.registerResult(resultInput(pipelineJobId));
    registerSecondSelectable(store, pipelineJobId);
    store.createActivationIntent(activationIntentInput(pipelineJobId));

    for (const decision of [
      verifiedDecision({ subject: "operator-other" }),
      verifiedDecision({ capability: "result.rollback" }),
      verifiedDecision({ expires_at: "2026-07-16T08:50:30.000Z" }),
      verifiedDecision({ issued_at: "2026-07-16T08:50:05.1234567Z" }),
      verifiedDecision({ issued_at: "2026-07-16T08:51:00.000001Z" }),
      verifiedDecision({ not_before: "2026-07-16T08:51:00.000001Z" }),
    ]) {
      expect(() =>
        store.confirmActivationIntent({
          intent_id: "intent_promote_0008",
          decision,
          now: "2026-07-16T08:51:00.000Z",
        }),
      ).toThrow(PipelineResultAuthorizationError);
    }
    expect(store.getActiveResultPointer(pipelineJobId)?.result_id).toBe("result-0007");
    expect(store.getActivationIntent("intent_promote_0008")?.state).toBe("pending");
  });

  it("同 issuer/audience/jti 不得跨 capability 再消費", () => {
    const { store: jobStore, pipelineJobId } = jobs();
    const store = new PipelineResultStore(jobStore, null);
    store.registerResult(resultInput(pipelineJobId));
    registerSecondSelectable(store, pipelineJobId);
    store.createActivationIntent(activationIntentInput(pipelineJobId));
    store.confirmActivationIntent({
      intent_id: "intent_promote_0008",
      decision: verifiedDecision({ jti: "issuer-global-jti-0001" }),
      now: "2026-07-16T08:51:00.000Z",
    });

    store.createActivationIntent(
      activationIntentInput(pipelineJobId, {
        intent_id: "intent_rollback_0007",
        intent_nonce: "nonce-" + "8".repeat(64),
        target_result_id: "result-0007",
        expected_active_result_id: "result-0008",
        transition: "rollback",
        capability: "result.rollback",
        reason: "rollback after downstream regression",
        correlation_id: "corr-rollback-0007",
        created_at: "2026-07-16T08:52:00.000Z",
        expires_at: "2026-07-16T08:57:00.000Z",
      }),
    );
    expect(() =>
      store.confirmActivationIntent({
        intent_id: "intent_rollback_0007",
        decision: verifiedDecision({
          authorization_decision_ref: "decision-result-rollback-0007",
          capability: "result.rollback",
          jti: "issuer-global-jti-0001",
          issued_at: "2026-07-16T08:52:05.000Z",
          not_before: "2026-07-16T08:52:05.000Z",
          expires_at: "2026-07-16T08:56:00.000Z",
          verified_at: "2026-07-16T08:53:00.000Z",
        }),
        now: "2026-07-16T08:53:00.000Z",
      }),
    ).toThrow(PipelineResultAuthorizationError);
    expect(store.getActiveResultPointer(pipelineJobId)?.result_id).toBe("result-0008");
  });

  it("每 principal/job pending intent 有上限，建立新 intent 時原子清掉已逾期 pending", () => {
    const { store: jobStore, pipelineJobId } = jobs();
    const store = new PipelineResultStore(jobStore, null);
    store.registerResult(resultInput(pipelineJobId));
    registerSecondSelectable(store, pipelineJobId);
    for (let index = 0; index < 8; index += 1) {
      store.createActivationIntent(
        activationIntentInput(pipelineJobId, {
          intent_id: `intent_cap_${String(index).padStart(4, "0")}`,
          intent_nonce: `nonce-${index}-` + String(index).repeat(64),
        }),
      );
    }
    expect(() =>
      store.createActivationIntent(
        activationIntentInput(pipelineJobId, {
          intent_id: "intent_cap_blocked_0009",
          intent_nonce: "nonce-blocked-" + "9".repeat(64),
          created_at: "2026-07-16T08:54:00.000Z",
          expires_at: "2026-07-16T08:59:00.000Z",
        }),
      ),
    ).toThrow(PipelineResultConflictError);

    const afterExpiry = store.createActivationIntent(
      activationIntentInput(pipelineJobId, {
        intent_id: "intent_cap_after_expiry",
        intent_nonce: "nonce-after-expiry-" + "a".repeat(64),
        created_at: "2026-07-16T08:55:00.000Z",
        expires_at: "2026-07-16T09:00:00.000Z",
      }),
    );
    expect(afterExpiry.replay).toBe(false);
    expect(store.getActivationIntent("intent_cap_0000")).toBeNull();
  });

  it("pre-existing sidecar write lock fail closed，不留下 partial tmp 或 state", () => {
    const file = tmpStorePath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(`${file}.lock`, "another-writer", "utf-8");
    const { store: jobStore, pipelineJobId } = jobs();
    const store = new PipelineResultStore(jobStore, file);

    expect(() => store.registerResult(resultInput(pipelineJobId))).toThrow(
      PipelineResultStateUnavailableError,
    );
    expect(fs.existsSync(file)).toBe(false);
    expect(fs.existsSync(`${file}.tmp`)).toBe(false);
    expect(store.getResult("result-0007")).toBeNull();
  });

  it("crashed writer 的 owner metadata 可驗為 dead 後，原子接管 stale lock", async () => {
    const file = tmpStorePath();
    const exited = spawn(process.execPath, ["-e", "process.exit(0)"]);
    const deadPid = exited.pid;
    expect(deadPid).toBeTypeOf("number");
    await once(exited, "exit");
    fs.writeFileSync(
      `${file}.lock`,
      JSON.stringify({
        schema_version: "pipeline-result-lock/v1",
        pid: deadPid,
        created_at_ms: Date.now() - 1_000,
      }),
      "utf-8",
    );
    const { store: jobStore, pipelineJobId } = jobs();
    const store = new PipelineResultStore(jobStore, file);

    store.registerResult(resultInput(pipelineJobId));

    expect(store.getResult("result-0007")?.result_id).toBe("result-0007");
    expect(fs.existsSync(`${file}.lock`)).toBe(false);
  });

  it.each([
    ["malformed intent id", { intent_id: "bad" }],
    ["short nonce", { intent_nonce: "too-short" }],
    ["transition-capability mismatch", { capability: "result.rollback" }],
    ["non-increasing expiry", { expires_at: "2026-07-16T08:50:00.000Z" }],
  ] as const)("rejects malformed activation intent binding: %s", (_name, overrides) => {
    const { store: jobStore, pipelineJobId } = jobs();
    const store = new PipelineResultStore(jobStore, null);
    store.registerResult(resultInput(pipelineJobId));
    registerSecondSelectable(store, pipelineJobId);
    const pointerBefore = store.getActiveResultPointer(pipelineJobId);
    const auditBefore = store.listActivationAudit(pipelineJobId);

    expect(() =>
      store.createActivationIntent(activationIntentInput(pipelineJobId, overrides)),
    ).toThrow(PipelineResultInvariantError);
    expect(store.getActiveResultPointer(pipelineJobId)).toEqual(pointerBefore);
    expect(store.listActivationAudit(pipelineJobId)).toEqual(auditBefore);
  });

  it("rejects conflicting intent-id and nonce reuse without changing pointer or audit", () => {
    const { store: jobStore, pipelineJobId } = jobs();
    const store = new PipelineResultStore(jobStore, null);
    store.registerResult(resultInput(pipelineJobId));
    registerSecondSelectable(store, pipelineJobId);
    const input = activationIntentInput(pipelineJobId);
    store.createActivationIntent(input);
    expect(store.createActivationIntent(input).replay).toBe(true);
    const pointerBefore = store.getActiveResultPointer(pipelineJobId);
    const auditBefore = store.listActivationAudit(pipelineJobId);

    expect(() =>
      store.createActivationIntent(
        activationIntentInput(pipelineJobId, { reason: "different binding" }),
      ),
    ).toThrow(PipelineResultConflictError);
    expect(() =>
      store.createActivationIntent(
        activationIntentInput(pipelineJobId, {
          intent_id: "intent_nonce_reuse_0009",
          correlation_id: "corr-nonce-reuse-0009",
        }),
      ),
    ).toThrow(PipelineResultConflictError);
    expect(store.getActiveResultPointer(pipelineJobId)).toEqual(pointerBefore);
    expect(store.listActivationAudit(pipelineJobId)).toEqual(auditBefore);
  });

  it("missing or expired confirm fails closed without consuming pointer or audit", () => {
    const { store: jobStore, pipelineJobId } = jobs();
    const store = new PipelineResultStore(jobStore, null);
    store.registerResult(resultInput(pipelineJobId));
    registerSecondSelectable(store, pipelineJobId);
    const pointerBefore = store.getActiveResultPointer(pipelineJobId);
    const auditBefore = store.listActivationAudit(pipelineJobId);

    expect(() =>
      store.confirmActivationIntent({
        intent_id: "intent_missing_0009",
        decision: verifiedDecision(),
        now: "2026-07-16T08:51:00.000Z",
      }),
    ).toThrow(PipelineResultAuthorizationError);

    store.createActivationIntent(activationIntentInput(pipelineJobId));
    expect(() =>
      store.confirmActivationIntent({
        intent_id: "intent_promote_0008",
        decision: verifiedDecision({
          issued_at: "2026-07-16T08:54:00.000Z",
          not_before: "2026-07-16T08:54:00.000Z",
          expires_at: "2026-07-16T08:55:00.000001Z",
          verified_at: "2026-07-16T08:55:00.000Z",
        }),
        now: "2026-07-16T08:55:00.000Z",
      }),
    ).toThrow(PipelineResultAuthorizationError);
    expect(store.getActivationIntent("intent_promote_0008")?.state).toBe("pending");
    expect(store.getActiveResultPointer(pipelineJobId)).toEqual(pointerBefore);
    expect(store.listActivationAudit(pipelineJobId)).toEqual(auditBefore);
  });

  it("rejects stale pointer and missing or cross-job target bindings before intent persistence", () => {
    const { store: jobStore, pipelineJobId } = jobs();
    const otherJob = jobStore.ensureJobForSourceBundle({
      sourceBundleId: "source-bundle-test-0002",
      externalModelVersionId: "model-version-test-0002",
      eventId: "ready-event-0002",
      now: "2026-07-16T08:10:00.000Z",
    }).job;
    const store = new PipelineResultStore(jobStore, null);
    store.registerResult(resultInput(pipelineJobId));
    registerSecondSelectable(store, pipelineJobId);
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

    expect(() =>
      store.createActivationIntent(
        activationIntentInput(pipelineJobId, { expected_active_result_id: "result-stale" }),
      ),
    ).toThrow(PipelineResultConflictError);
    for (const [intentId, targetResultId] of [
      ["intent_missing_target", "result-missing"],
      ["intent_cross_job_target", "result-other-0001"],
    ] as const) {
      expect(() =>
        store.createActivationIntent(
          activationIntentInput(pipelineJobId, {
            intent_id: intentId,
            intent_nonce: `nonce-${intentId}-` + "c".repeat(64),
            target_result_id: targetResultId,
          }),
        ),
      ).toThrow(PipelineResultActivationTargetInvariantError);
      expect(store.getActivationIntent(intentId)).toBeNull();
    }
  });

  it("rejects activation intent when the job has no active selectable result", () => {
    const { store: jobStore, pipelineJobId } = jobs();
    const store = new PipelineResultStore(jobStore, null);
    store.registerResult(
      resultInput(pipelineJobId, {
        attempt_outcome: "failed",
        publication_state: "AVAILABLE",
      }),
    );

    expect(() =>
      store.createActivationIntent(activationIntentInput(pipelineJobId)),
    ).toThrow(PipelineResultInvariantError);
    expect(store.getActiveResultPointer(pipelineJobId)).toBeNull();
    expect(store.listActivationAudit(pipelineJobId)).toHaveLength(0);
  });
});
