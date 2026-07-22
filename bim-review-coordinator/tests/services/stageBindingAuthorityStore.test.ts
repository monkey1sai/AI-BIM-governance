import { describe, expect, it } from "vitest";

import {
  StageBindingAuthorityStore,
  type StageBindingCreateInput,
  type StageBindingTransaction,
} from "../../src/services/stageBindingAuthorityStore.js";

function composition(primaryId = "artifact_primary", secondaryId = "artifact_secondary") {
  return {
    primary: {
      artifact_id: primaryId,
      role: "primary" as const,
      load_order: 0,
      usdc_url: `http://127.0.0.1:49101/artifacts/${primaryId}/model.usdc`,
    },
    secondary_layers: secondaryId
      ? [{
          artifact_id: secondaryId,
          role: "secondary" as const,
          load_order: 1,
          usdc_url: `http://127.0.0.1:49101/artifacts/${secondaryId}/model.usdc`,
        }]
      : [],
  };
}

function createInput(overrides: Partial<StageBindingCreateInput> = {}): StageBindingCreateInput {
  return {
    session_id: "review_session_a",
    principal: "lab_principal_a",
    lease_id: "viewer_lease_a",
    source_client_id: "viewer_lease_a",
    composition: composition(),
    ...overrides,
  };
}

function testStore(options: ConstructorParameters<typeof StageBindingAuthorityStore>[0] = {}) {
  let now = 1_000;
  let id = 0;
  const store = new StageBindingAuthorityStore({
    clock: () => now,
    idFactory: (prefix) => `${prefix}_test_${++id}`,
    pendingTtlMs: 100,
    executingTtlMs: 1_000,
    completedRetentionMs: 10_000,
    ...options,
  });
  return {
    store,
    advance: (milliseconds: number) => { now += milliseconds; },
  };
}

function mustCreate(store: StageBindingAuthorityStore, input = createInput()): StageBindingTransaction {
  const result = store.create(input);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.reason);
  return result.transaction;
}

function consumeInput(transaction: StageBindingTransaction, overrides: Record<string, unknown> = {}) {
  return {
    session_id: transaction.session_id,
    stage_binding_authorization_id: transaction.stage_binding_authorization_id,
    binding_revision_id: transaction.binding_revision_id,
    lease_id: transaction.lease_id,
    source_client_id: transaction.source_client_id,
    request_id: "cmd_request_a",
    event_type: "openStageRequest" as const,
    composition: transaction.stage_composition,
    ...overrides,
  };
}

describe("StageBindingAuthorityStore", () => {
  it("creates a bounded pending transaction without changing active or last-good", () => {
    const { store } = testStore();
    const transaction = mustCreate(store);

    expect(transaction.status).toBe("pending");
    expect(transaction.stage_binding_authorization_id).toMatch(/^stage_auth_/);
    expect(transaction.binding_revision_id).toMatch(/^binding_rev_/);
    expect(transaction.pending_expires_at).toBe(new Date(1_100).toISOString());
    expect(store.summary("review_session_a", "lab_principal_a")).toEqual({
      transaction_status: "pending",
      binding_revision_id: transaction.binding_revision_id,
      active_binding_revision: null,
      last_good_binding_revision: null,
    });
  });

  it("supersedes an older pending transaction but rejects a second transaction while executing", () => {
    const { store } = testStore();
    const first = mustCreate(store);
    const secondResult = store.create(createInput({ composition: composition("artifact_new", "") }));
    expect(secondResult.ok).toBe(true);
    if (!secondResult.ok) throw new Error(secondResult.reason);
    expect(store.get(first.stage_binding_authorization_id)?.status).toBe("superseded");

    const consumed = store.consume(consumeInput(secondResult.transaction));
    expect(consumed.authorized).toBe(true);
    const blocked = store.create(createInput({ session_id: "review_session_a" }));
    expect(blocked).toEqual({ ok: false, reason: "transaction_executing" });
  });

  it("atomically consumes only an exact pending tuple and denies every replay", () => {
    const { store } = testStore();
    const transaction = mustCreate(store);

    const tampered = store.consume(consumeInput(transaction, {
      composition: composition("artifact_wrong", "artifact_secondary"),
    }));
    expect(tampered).toMatchObject({ authorized: false, reason: "transaction_mismatch" });
    expect(store.get(transaction.stage_binding_authorization_id)?.status).toBe("pending");

    const first = store.consume(consumeInput(transaction));
    expect(first).toMatchObject({ authorized: true, status: "executing" });
    const sameRequestReplay = store.consume(consumeInput(transaction));
    const otherRequestReplay = store.consume(consumeInput(transaction, { request_id: "cmd_request_b" }));
    expect(sameRequestReplay).toMatchObject({ authorized: false, reason: "transaction_not_pending" });
    expect(otherRequestReplay).toMatchObject({ authorized: false, reason: "transaction_not_pending" });
  });

  it("fails an exact pending or executing attempt before mutation without changing active binding", () => {
    const { store } = testStore();
    const executing = mustCreate(store);
    const attempt = consumeInput(executing);
    expect(store.consume(attempt).authorized).toBe(true);

    expect(store.failBeforeMutation(attempt)).toMatchObject({
      failed: true,
      idempotent_replay: false,
      transaction: {
        status: "failed",
        completion_outcome: "failed",
        failure_code: "authorization_unavailable",
      },
    });
    expect(store.failBeforeMutation(attempt)).toMatchObject({ failed: true, idempotent_replay: true });
    expect(store.summary(executing.session_id, executing.principal).active_binding_revision).toBeNull();

    const pending = mustCreate(store, createInput({ composition: composition("artifact_retry", "") }));
    expect(store.failBeforeMutation(consumeInput(pending, { request_id: "cmd_pending_timeout" }))).toMatchObject({
      failed: true,
      transaction: { status: "failed", failure_code: "authorization_unavailable" },
    });
    expect(store.create(createInput({ composition: composition("artifact_replacement", "") }))).toMatchObject({
      ok: true,
      transaction: { status: "pending" },
    });
  });

  it("uses the independent executing deadline after a pending transaction is claimed", () => {
    const { store, advance } = testStore();
    const transaction = mustCreate(store);
    advance(90);
    expect(store.consume(consumeInput(transaction)).authorized).toBe(true);
    advance(100);

    const completion = store.complete({
      ...consumeInput(transaction),
      outcome: "success",
    });
    expect(completion).toMatchObject({ confirmed: true, status: "active", idempotent_replay: false });
  });

  it("fails an executing transaction only after its separate deadline", () => {
    const { store, advance } = testStore();
    const transaction = mustCreate(store);
    expect(store.consume(consumeInput(transaction)).authorized).toBe(true);
    advance(1_001);

    expect(store.get(transaction.stage_binding_authorization_id)?.status).toBe("failed");
    expect(store.complete({ ...consumeInput(transaction), outcome: "success" })).toMatchObject({
      confirmed: false,
      reason: "transaction_not_executing",
    });
    expect(store.summary("review_session_a", "lab_principal_a").active_binding_revision).toBeNull();
  });

  it("updates active and last-good only on success and makes exact completion idempotent", () => {
    const { store } = testStore();
    const first = mustCreate(store);
    store.consume(consumeInput(first));
    const completed = store.complete({ ...consumeInput(first), outcome: "success" });
    expect(completed).toMatchObject({ confirmed: true, idempotent_replay: false });
    expect(store.complete({ ...consumeInput(first), outcome: "success" })).toMatchObject({
      confirmed: true,
      idempotent_replay: true,
    });
    expect(store.complete({ ...consumeInput(first), outcome: "failed" })).toMatchObject({
      confirmed: false,
      reason: "completion_mismatch",
    });

    const failed = mustCreate(store, createInput({ composition: composition("artifact_failed", "") }));
    store.consume(consumeInput(failed, { request_id: "cmd_failed" }));
    expect(store.complete({
      ...consumeInput(failed, { request_id: "cmd_failed" }),
      outcome: "failed",
    })).toMatchObject({ confirmed: true, status: "failed" });
    expect(store.summary("review_session_a", "lab_principal_a").active_binding_revision).toBe(first.binding_revision_id);

    const second = mustCreate(store, createInput({ composition: composition("artifact_second", "") }));
    store.consume(consumeInput(second, { request_id: "cmd_second" }));
    store.complete({ ...consumeInput(second, { request_id: "cmd_second" }), outcome: "success" });
    expect(store.summary("review_session_a", "lab_principal_a")).toMatchObject({
      transaction_status: "active",
      active_binding_revision: second.binding_revision_id,
      last_good_binding_revision: first.binding_revision_id,
    });
  });

  it("keeps the transaction executing when the before-commit audit hook fails", () => {
    const { store } = testStore();
    const transaction = mustCreate(store);
    const completion = { ...consumeInput(transaction), outcome: "success" as const };
    expect(store.consume(consumeInput(transaction)).authorized).toBe(true);

    expect(() => store.complete(completion, () => {
      throw new Error("audit write failed");
    })).toThrow("audit write failed");
    expect(store.get(transaction.stage_binding_authorization_id)?.status).toBe("executing");
    expect(store.summary(transaction.session_id, transaction.principal).active_binding_revision).toBeNull();

    let committedAudits = 0;
    expect(store.complete(completion, () => { committedAudits += 1; })).toMatchObject({
      confirmed: true,
      status: "active",
      idempotent_replay: false,
    });
    expect(store.complete(completion, () => { committedAudits += 1; })).toMatchObject({
      confirmed: true,
      idempotent_replay: true,
    });
    expect(committedAudits).toBe(1);
  });

  it("bounds global non-terminal capacity and per-session completed retention", () => {
    const { store } = testStore({ maxNonTerminal: 1, maxCompletedPerSession: 1 });
    const first = mustCreate(store);
    expect(store.create(createInput({ session_id: "review_session_b" }))).toEqual({
      ok: false,
      reason: "capacity_exceeded",
    });
    store.consume(consumeInput(first));
    store.complete({ ...consumeInput(first), outcome: "success" });

    const second = mustCreate(store, createInput({ composition: composition("artifact_second", "") }));
    store.consume(consumeInput(second, { request_id: "cmd_second" }));
    store.complete({ ...consumeInput(second, { request_id: "cmd_second" }), outcome: "success" });
    expect(store.get(first.stage_binding_authorization_id)).toBeNull();
    expect(store.get(second.stage_binding_authorization_id)?.status).toBe("active");
  });

  it("bounds completed records and active summaries across different sessions", () => {
    const { store, advance } = testStore({
      maxCompleted: 2,
      maxCompletedPerSession: 4,
      maxActiveSessions: 2,
    });
    const completed: StageBindingTransaction[] = [];

    for (const suffix of ["a", "b", "c"]) {
      const transaction = mustCreate(store, createInput({
        session_id: `review_session_${suffix}`,
        principal: `lab_principal_${suffix}`,
        lease_id: `viewer_lease_${suffix}`,
        source_client_id: `viewer_lease_${suffix}`,
        composition: composition(`artifact_${suffix}`, ""),
      }));
      store.consume(consumeInput(transaction, { request_id: `cmd_${suffix}` }));
      store.complete({
        ...consumeInput(transaction, { request_id: `cmd_${suffix}` }),
        outcome: "success",
      });
      completed.push(transaction);
      advance(1);
    }

    expect(store.get(completed[0].stage_binding_authorization_id)).toBeNull();
    expect(store.get(completed[1].stage_binding_authorization_id)?.status).toBe("active");
    expect(store.get(completed[2].stage_binding_authorization_id)?.status).toBe("active");
    expect(store.summary("review_session_a", "lab_principal_a").active_binding_revision).toBeNull();
    expect(store.summary("review_session_b", "lab_principal_b").active_binding_revision).toBe(completed[1].binding_revision_id);
    expect(store.summary("review_session_c", "lab_principal_c").active_binding_revision).toBe(completed[2].binding_revision_id);
  });

  it("fails closed after process-local state is replaced", () => {
    const { store } = testStore();
    const transaction = mustCreate(store);
    const { store: restarted } = testStore();
    expect(restarted.consume(consumeInput(transaction))).toMatchObject({
      authorized: false,
      reason: "transaction_missing",
    });
  });
});
