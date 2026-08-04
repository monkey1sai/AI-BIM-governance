import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  RUNTIME_MUTATION_AUTHORITY_VOCABULARY,
  RuntimeMutationAuthority,
  type PreauthorizeStageBindingResult,
  type RuntimeMutationAuthorityPorts,
  type RuntimeSessionContext,
} from "../../src/services/runtimeMutationAuthority/runtimeMutationAuthority.js";

const ARTIFACT_IDS = [
  "artifact_primary",
  "artifact_secondary",
  "artifact_new",
  "artifact_failed",
  "artifact_second",
  "artifact_retry",
  "artifact_replacement",
  "artifact_wrong",
  "artifact_a",
  "artifact_b",
  "artifact_c",
];

function testAuthority(
  stateOptions: Record<string, unknown> = {},
  portOverrides: Partial<Pick<
    RuntimeMutationAuthorityPorts,
    "generateId" | "inspectRuntimeLease"
  >> = {},
) {
  let now = 1_000;
  let nextId = 0;
  let appendError: Error | null = null;
  const appendedEvents: unknown[] = [];
  const inspectedCredentials: string[] = [];
  const sessionStatuses = new Map<string, RuntimeSessionContext["status"]>();
  const ports: RuntimeMutationAuthorityPorts = {
    now: () => now,
    generateId: (prefix) => portOverrides.generateId?.(prefix) ?? `${prefix}_test_${++nextId}`,
    getSessionContext: (sessionId) => sessionId.startsWith("review_session_")
      ? {
          sessionId,
          status: sessionStatuses.get(sessionId) ?? "active",
          artifacts: ARTIFACT_IDS.map((artifactId) => ({
            artifactId,
            readyStatus: "ready",
            usdcUrl: `http://127.0.0.1:49101/artifacts/${artifactId}/model.usdc`,
          })),
        }
      : null,
    inspectPrimaryLease: (input) => {
      inspectedCredentials.push(input.credential);
      const suffix = input.sourceClientId.replace("viewer_lease_", "");
      return {
        authorized: true,
        lease: { leaseId: input.sourceClientId, principal: `lab_principal_${suffix}` },
      };
    },
    inspectRuntimeLease: (input) => {
      inspectedCredentials.push(input.credential);
      if (portOverrides.inspectRuntimeLease) return portOverrides.inspectRuntimeLease(input);
      const suffix = input.sourceClientId.replace("viewer_lease_", "");
      return {
        authorized: true,
        lease: { leaseId: input.sourceClientId, principal: `lab_principal_${suffix}` },
      };
    },
    appendStageBindingApplied: (event) => {
      if (appendError) throw appendError;
      appendedEvents.push(event);
    },
  };
  const authority = new RuntimeMutationAuthority(ports, {
    pendingTtlMs: 100,
    executingTtlMs: 1_000,
    completedRetentionMs: 10_000,
    ...stateOptions,
  });
  return {
    authority,
    advance: (milliseconds: number) => { now += milliseconds; },
    appendedEvents,
    inspectedCredentials,
    setAppendError: (error: Error | null) => { appendError = error; },
    setSessionStatus: (sessionId: string, status: RuntimeSessionContext["status"]) => {
      sessionStatuses.set(sessionId, status);
    },
  };
}

function mustPreauthorize(
  authority: RuntimeMutationAuthority,
  artifactId = "artifact_primary",
  overrides: Partial<Parameters<RuntimeMutationAuthority["preauthorizeStageBinding"]>[0]> = {},
): Extract<PreauthorizeStageBindingResult, { ok: true }> {
  const result = authority.preauthorizeStageBinding({
    sessionId: "review_session_a",
    principal: "lab_principal_a",
    sourceClientId: "viewer_lease_a",
    credential: "lease-token-sentinel",
    artifacts: [{ artifactId, role: "primary", loadOrder: 0 }],
    ...overrides,
  });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.reason);
  return result;
}

describe("RuntimeMutationAuthority", () => {
  it("preauthorizes a server-resolved pending stage binding", () => {
    const { authority } = testAuthority();

    const result = authority.preauthorizeStageBinding({
      sessionId: "review_session_a",
      principal: "lab_principal_a",
      sourceClientId: "viewer_lease_a",
      credential: "lease-token-sentinel",
      artifacts: [{ artifactId: "artifact_primary", role: "primary", loadOrder: 0 }],
    });

    expect(result).toMatchObject({
      ok: true,
      transactionStatus: "pending",
      stageBindingAuthorizationId: "stage_auth_test_1",
      bindingRevisionId: "binding_rev_test_2",
      composition: {
        primary: {
          artifactId: "artifact_primary",
          role: "primary",
          loadOrder: 0,
        },
        secondaryLayers: [],
      },
    });
    expect(authority.getStageBindingSummary({
      sessionId: "review_session_a",
      principal: "lab_principal_a",
    })).toEqual({
      transactionStatus: "pending",
      bindingRevisionId: "binding_rev_test_2",
      activeBindingRevision: null,
      lastGoodBindingRevision: null,
    });
  });

  it("bounds cancellation tombstones and preserves a recently repeated cancellation", () => {
    const { authority } = testAuthority({ maxCancelledPreauthorizationIntents: 2 });
    const cancel = (clientRequestId: string) => authority.cancelStageBindingPreauthorization({
      sessionId: "review_session_a",
      principal: "lab_principal_a",
      sourceClientId: "viewer_lease_a",
      credential: "lease-token-sentinel",
      clientRequestId,
    });

    expect(cancel("stage_preauth_cancelled_1")).toMatchObject({ cancelled: true });
    expect(cancel("stage_preauth_cancelled_2")).toMatchObject({ cancelled: true });
    expect(cancel("stage_preauth_cancelled_1")).toMatchObject({
      cancelled: true,
      idempotentReplay: true,
    });
    expect(cancel("stage_preauth_cancelled_3")).toMatchObject({ cancelled: true });

    expect(mustPreauthorize(authority, "artifact_primary", {
      clientRequestId: "stage_preauth_cancelled_2",
    }).transactionStatus).toBe("pending");
    expect(authority.preauthorizeStageBinding({
      sessionId: "review_session_a",
      principal: "lab_principal_a",
      sourceClientId: "viewer_lease_a",
      credential: "lease-token-sentinel",
      clientRequestId: "stage_preauth_cancelled_1",
      artifacts: [{ artifactId: "artifact_primary", role: "primary", loadOrder: 0 }],
    })).toEqual({ ok: false, reason: "request_cancelled" });
    expect(authority.preauthorizeStageBinding({
      sessionId: "review_session_a",
      principal: "lab_principal_a",
      sourceClientId: "viewer_lease_a",
      credential: "lease-token-sentinel",
      clientRequestId: "stage_preauth_cancelled_3",
      artifacts: [{ artifactId: "artifact_primary", role: "primary", loadOrder: 0 }],
    })).toEqual({ ok: false, reason: "request_cancelled" });
  });

  it("supersedes pending authority and blocks replacement while the latest attempt executes", () => {
    const { authority } = testAuthority();
    const first = mustPreauthorize(authority);
    const second = mustPreauthorize(authority);

    expect(authority.authorizeRuntimeCommand({
      sessionId: "review_session_a",
      sourceClientId: "viewer_lease_a",
      credential: "lease-token-sentinel",
      requestId: "cmd_old",
      requestedEventType: "openStageRequest",
      commandContext: {},
      stageBindingAuthorizationId: first.stageBindingAuthorizationId,
      bindingRevisionId: first.bindingRevisionId,
      stageComposition: first.composition,
    })).toMatchObject({
      authorized: false,
      reason: "lease_invalid",
      detailCode: "stage_transaction_not_pending",
    });

    expect(authority.authorizeRuntimeCommand({
      sessionId: "review_session_a",
      sourceClientId: "viewer_lease_a",
      credential: "lease-token-sentinel",
      requestId: "cmd_current",
      requestedEventType: "openStageRequest",
      commandContext: {},
      stageBindingAuthorizationId: second.stageBindingAuthorizationId,
      bindingRevisionId: second.bindingRevisionId,
      stageComposition: second.composition,
    })).toMatchObject({ authorized: true, requestId: "cmd_current" });

    expect(authority.preauthorizeStageBinding({
      sessionId: "review_session_a",
      principal: "lab_principal_a",
      sourceClientId: "viewer_lease_a",
      credential: "lease-token-sentinel",
      artifacts: [{ artifactId: "artifact_primary", role: "primary", loadOrder: 0 }],
    })).toEqual({ ok: false, reason: "transaction_executing" });
  });

  it("keeps the exact pending authority when replacement ID generation throws", () => {
    let generatedIds = 0;
    const { authority } = testAuthority({}, {
      generateId: (prefix) => {
        generatedIds += 1;
        if (generatedIds === 4) throw new Error("id dependency unavailable");
        return `${prefix}_failure_test_${generatedIds}`;
      },
    });
    const first = mustPreauthorize(authority);

    expect(() => mustPreauthorize(authority, "artifact_replacement")).toThrow(
      "id dependency unavailable",
    );
    expect(authority.getStageBindingSummary({
      sessionId: "review_session_a",
      principal: "lab_principal_a",
    })).toMatchObject({
      transactionStatus: "pending",
      bindingRevisionId: first.bindingRevisionId,
    });
    expect(authority.authorizeRuntimeCommand({
      sessionId: "review_session_a",
      sourceClientId: "viewer_lease_a",
      credential: "lease-token-sentinel",
      requestId: "cmd_original_after_id_failure",
      requestedEventType: "openStageRequest",
      commandContext: {},
      stageBindingAuthorizationId: first.stageBindingAuthorizationId,
      bindingRevisionId: first.bindingRevisionId,
      stageComposition: first.composition,
    })).toMatchObject({
      authorized: true,
      requestId: "cmd_original_after_id_failure",
    });
  });

  it("consumes only the exact pending tuple and denies all replays", () => {
    const { authority } = testAuthority();
    const transactionResult = authority.preauthorizeStageBinding({
      sessionId: "review_session_a",
      principal: "lab_principal_a",
      sourceClientId: "viewer_lease_a",
      credential: "lease-token-sentinel",
      artifacts: [
        { artifactId: "artifact_primary", role: "primary", loadOrder: 0 },
        { artifactId: "artifact_secondary", role: "secondary", loadOrder: 1 },
        { artifactId: "artifact_new", role: "secondary", loadOrder: 2 },
      ],
    });
    expect(transactionResult.ok).toBe(true);
    if (!transactionResult.ok) throw new Error(transactionResult.reason);
    const transaction = transactionResult;
    const command = {
      sessionId: "review_session_a",
      sourceClientId: "viewer_lease_a",
      credential: "lease-token-sentinel",
      requestId: "cmd_exact",
      requestedEventType: "openStageRequest",
      commandContext: {},
      stageBindingAuthorizationId: transaction.stageBindingAuthorizationId,
      bindingRevisionId: transaction.bindingRevisionId,
      stageComposition: transaction.composition,
    };

    expect(authority.authorizeRuntimeCommand({
      ...command,
      stageComposition: {
        ...transaction.composition,
        primary: { ...transaction.composition.primary, artifactId: "artifact_wrong" },
      },
    })).toMatchObject({
      authorized: false,
      reason: "invalid_payload",
      detailCode: "stage_transaction_mismatch",
    });
    expect(authority.getStageBindingSummary({
      sessionId: "review_session_a",
      principal: "lab_principal_a",
    }).transactionStatus)
      .toBe("pending");
    expect(authority.authorizeRuntimeCommand({
      ...command,
      stageComposition: {
        ...transaction.composition,
        secondaryLayers: [...transaction.composition.secondaryLayers].reverse(),
      },
    })).toMatchObject({
      authorized: false,
      reason: "invalid_payload",
      detailCode: "stage_transaction_mismatch",
    });

    expect(authority.authorizeRuntimeCommand(command)).toMatchObject({ authorized: true });
    expect(authority.authorizeRuntimeCommand(command)).toMatchObject({
      authorized: false,
      detailCode: "stage_transaction_not_pending",
    });
    expect(authority.authorizeRuntimeCommand({ ...command, requestId: "cmd_other" })).toMatchObject({
      authorized: false,
      detailCode: "stage_transaction_not_pending",
    });
  });

  it("fails an exact pending or executing attempt before mutation and makes rollback replay-safe", () => {
    const { authority } = testAuthority();
    const executing = mustPreauthorize(authority);
    const executingAttempt = {
      sessionId: "review_session_a",
      sourceClientId: "viewer_lease_a",
      credential: "lease-token-sentinel",
      requestId: "cmd_executing_timeout",
      requestedEventType: "openStageRequest",
      commandContext: {},
      stageBindingAuthorizationId: executing.stageBindingAuthorizationId,
      bindingRevisionId: executing.bindingRevisionId,
      stageComposition: executing.composition,
    };
    expect(authority.authorizeRuntimeCommand(executingAttempt)).toMatchObject({ authorized: true });
    expect(authority.failStageBindingBeforeMutation(executingAttempt)).toEqual({
      failed: true,
      requestId: "cmd_executing_timeout",
      transactionStatus: "failed",
      idempotentReplay: false,
    });
    expect(authority.failStageBindingBeforeMutation(executingAttempt)).toEqual({
      failed: true,
      requestId: "cmd_executing_timeout",
      transactionStatus: "failed",
      idempotentReplay: true,
    });
    expect(authority.getStageBindingSummary({
      sessionId: "review_session_a",
      principal: "lab_principal_a",
    }).activeBindingRevision)
      .toBeNull();

    const pending = mustPreauthorize(authority, "artifact_retry");
    expect(authority.failStageBindingBeforeMutation({
      ...executingAttempt,
      requestId: "cmd_pending_timeout",
      stageBindingAuthorizationId: pending.stageBindingAuthorizationId,
      bindingRevisionId: pending.bindingRevisionId,
      stageComposition: pending.composition,
    })).toMatchObject({ failed: true, idempotentReplay: false });
    expect(mustPreauthorize(authority, "artifact_replacement").transactionStatus).toBe("pending");
  });

  it("commits active and last-good only after exact confirmation and makes completion idempotent", () => {
    const { authority, appendedEvents } = testAuthority();
    const first = mustPreauthorize(authority);
    const firstCommand = {
      sessionId: "review_session_a",
      sourceClientId: "viewer_lease_a",
      credential: "lease-token-sentinel",
      requestId: "cmd_first",
      requestedEventType: "openStageRequest",
      commandContext: {},
      stageBindingAuthorizationId: first.stageBindingAuthorizationId,
      bindingRevisionId: first.bindingRevisionId,
      stageComposition: first.composition,
    };
    expect(authority.authorizeRuntimeCommand(firstCommand)).toMatchObject({ authorized: true });
    const firstConfirmation = {
      sessionId: "review_session_a",
      credential: "lease-token-sentinel",
      stageBindingAuthorizationId: first.stageBindingAuthorizationId,
      bindingRevisionId: first.bindingRevisionId,
      requestId: "cmd_first",
      outcome: "success" as const,
    };
    expect(authority.confirmStageBinding({ ...firstConfirmation, requestId: "cmd_wrong" })).toMatchObject({
      confirmed: false,
      reason: "invalid_payload",
      detailCode: "stage_transaction_mismatch",
    });
    expect(authority.confirmStageBinding(firstConfirmation)).toEqual({
      confirmed: true,
      requestId: "cmd_first",
      bindingRevisionId: first.bindingRevisionId,
      transactionStatus: "active",
      activeBindingRevision: first.bindingRevisionId,
      lastGoodBindingRevision: null,
      idempotentReplay: false,
    });
    expect(authority.confirmStageBinding(firstConfirmation)).toMatchObject({
      confirmed: true,
      idempotentReplay: true,
    });
    expect(authority.confirmStageBinding({ ...firstConfirmation, outcome: "failed" })).toMatchObject({
      confirmed: false,
      reason: "invalid_payload",
      detailCode: "stage_completion_mismatch",
    });

    const failed = mustPreauthorize(authority, "artifact_failed");
    const failedCommand = {
      ...firstCommand,
      requestId: "cmd_failed",
      stageBindingAuthorizationId: failed.stageBindingAuthorizationId,
      bindingRevisionId: failed.bindingRevisionId,
      stageComposition: failed.composition,
    };
    authority.authorizeRuntimeCommand(failedCommand);
    expect(authority.confirmStageBinding({
      ...firstConfirmation,
      requestId: "cmd_failed",
      stageBindingAuthorizationId: failed.stageBindingAuthorizationId,
      bindingRevisionId: failed.bindingRevisionId,
      outcome: "failed",
    })).toMatchObject({ confirmed: true, transactionStatus: "failed" });
    expect(authority.getStageBindingSummary({
      sessionId: "review_session_a",
      principal: "lab_principal_a",
    }).activeBindingRevision)
      .toBe(first.bindingRevisionId);

    const second = mustPreauthorize(authority, "artifact_second");
    const secondCommand = {
      ...firstCommand,
      requestId: "cmd_second",
      stageBindingAuthorizationId: second.stageBindingAuthorizationId,
      bindingRevisionId: second.bindingRevisionId,
      stageComposition: second.composition,
    };
    authority.authorizeRuntimeCommand(secondCommand);
    expect(authority.confirmStageBinding({
      ...firstConfirmation,
      requestId: "cmd_second",
      stageBindingAuthorizationId: second.stageBindingAuthorizationId,
      bindingRevisionId: second.bindingRevisionId,
    })).toMatchObject({
      confirmed: true,
      activeBindingRevision: second.bindingRevisionId,
      lastGoodBindingRevision: first.bindingRevisionId,
    });
    expect(appendedEvents).toHaveLength(2);
  });

  it("returns a principal-scoped defensive snapshot for the confirmed active binding", () => {
    const { authority } = testAuthority();
    const transaction = mustPreauthorize(authority);
    const command = {
      sessionId: "review_session_a",
      sourceClientId: "viewer_lease_a",
      credential: "lease-token-sentinel",
      requestId: "cmd_active_snapshot",
      requestedEventType: "openStageRequest",
      commandContext: {},
      stageBindingAuthorizationId: transaction.stageBindingAuthorizationId,
      bindingRevisionId: transaction.bindingRevisionId,
      stageComposition: transaction.composition,
    };
    expect(authority.authorizeRuntimeCommand(command)).toMatchObject({ authorized: true });
    expect(authority.confirmStageBinding({
      sessionId: "review_session_a",
      credential: "lease-token-sentinel",
      stageBindingAuthorizationId: transaction.stageBindingAuthorizationId,
      bindingRevisionId: transaction.bindingRevisionId,
      requestId: "cmd_active_snapshot",
      outcome: "success",
    })).toMatchObject({ confirmed: true, transactionStatus: "active" });

    const active = authority.getActiveStageBinding({
      sessionId: "review_session_a",
      principal: "lab_principal_a",
    });
    expect(active).toEqual({
      bindingRevisionId: transaction.bindingRevisionId,
      principal: "lab_principal_a",
      leaseId: "viewer_lease_a",
      sourceClientId: "viewer_lease_a",
      composition: transaction.composition,
    });
    expect(authority.getActiveStageBinding({
      sessionId: "review_session_a",
      principal: "lab_principal_other",
    })).toBeNull();
    if (!active) throw new Error("confirmed binding snapshot missing");

    active.composition.primary.artifactId = "caller_mutation";
    expect(authority.getActiveStageBinding({
      sessionId: "review_session_a",
      principal: "lab_principal_a",
    })?.composition.primary.artifactId).toBe(transaction.composition.primary.artifactId);
  });

  it("uses independent pending and executing deadlines", () => {
    const { authority, advance } = testAuthority();
    const expiredPending = mustPreauthorize(authority);
    advance(101);
    expect(authority.authorizeRuntimeCommand({
      sessionId: "review_session_a",
      sourceClientId: "viewer_lease_a",
      credential: "lease-token-sentinel",
      requestId: "cmd_expired_pending",
      requestedEventType: "openStageRequest",
      commandContext: {},
      stageBindingAuthorizationId: expiredPending.stageBindingAuthorizationId,
      bindingRevisionId: expiredPending.bindingRevisionId,
      stageComposition: expiredPending.composition,
    })).toMatchObject({ authorized: false, detailCode: "stage_transaction_not_pending" });
    expect(authority.getStageBindingSummary({
      sessionId: "review_session_a",
      principal: "lab_principal_a",
    }).transactionStatus)
      .toBe("failed");

    const independent = mustPreauthorize(authority, "artifact_second");
    advance(90);
    const independentCommand = {
      sessionId: "review_session_a",
      sourceClientId: "viewer_lease_a",
      credential: "lease-token-sentinel",
      requestId: "cmd_independent",
      requestedEventType: "openStageRequest",
      commandContext: {},
      stageBindingAuthorizationId: independent.stageBindingAuthorizationId,
      bindingRevisionId: independent.bindingRevisionId,
      stageComposition: independent.composition,
    };
    expect(authority.authorizeRuntimeCommand(independentCommand)).toMatchObject({ authorized: true });
    advance(100);
    expect(authority.confirmStageBinding({
      sessionId: "review_session_a",
      credential: "lease-token-sentinel",
      stageBindingAuthorizationId: independent.stageBindingAuthorizationId,
      bindingRevisionId: independent.bindingRevisionId,
      requestId: "cmd_independent",
      outcome: "success",
    })).toMatchObject({ confirmed: true, transactionStatus: "active" });

    const expiredExecuting = mustPreauthorize(authority, "artifact_failed");
    const expiredExecutingCommand = {
      ...independentCommand,
      requestId: "cmd_expired_executing",
      stageBindingAuthorizationId: expiredExecuting.stageBindingAuthorizationId,
      bindingRevisionId: expiredExecuting.bindingRevisionId,
      stageComposition: expiredExecuting.composition,
    };
    authority.authorizeRuntimeCommand(expiredExecutingCommand);
    advance(1_001);
    expect(authority.confirmStageBinding({
      sessionId: "review_session_a",
      credential: "lease-token-sentinel",
      stageBindingAuthorizationId: expiredExecuting.stageBindingAuthorizationId,
      bindingRevisionId: expiredExecuting.bindingRevisionId,
      requestId: "cmd_expired_executing",
      outcome: "success",
    })).toMatchObject({
      confirmed: false,
      reason: "lease_invalid",
      detailCode: "stage_transaction_not_executing",
    });
  });

  it("expires completed replay records while retaining active and last-good projection", () => {
    const { authority, advance } = testAuthority({ completedRetentionMs: 100 });
    const execute = (artifactId: string, requestId: string, outcome: "success" | "failed") => {
      const transaction = mustPreauthorize(authority, artifactId);
      expect(authority.authorizeRuntimeCommand({
        sessionId: "review_session_a",
        sourceClientId: "viewer_lease_a",
        credential: "lease-token-sentinel",
        requestId,
        requestedEventType: "openStageRequest",
        commandContext: {},
        stageBindingAuthorizationId: transaction.stageBindingAuthorizationId,
        bindingRevisionId: transaction.bindingRevisionId,
        stageComposition: transaction.composition,
      })).toMatchObject({ authorized: true, requestId });
      const confirmation = {
        sessionId: "review_session_a",
        credential: "lease-token-sentinel",
        stageBindingAuthorizationId: transaction.stageBindingAuthorizationId,
        bindingRevisionId: transaction.bindingRevisionId,
        requestId,
        outcome,
      } as const;
      expect(authority.confirmStageBinding(confirmation)).toMatchObject({
        confirmed: true,
        transactionStatus: outcome === "success" ? "active" : "failed",
      });
      return { transaction, confirmation };
    };

    const first = execute("artifact_primary", "cmd_retained_first", "success");
    const active = execute("artifact_second", "cmd_retained_active", "success");
    const failed = execute("artifact_failed", "cmd_retained_failed", "failed");
    advance(101);

    for (const confirmation of [active.confirmation, failed.confirmation]) {
      expect(authority.confirmStageBinding(confirmation)).toMatchObject({
        confirmed: false,
        reason: "lease_invalid",
        detailCode: "stage_transaction_missing",
      });
    }
    expect(authority.getStageBindingSummary({
      sessionId: "review_session_a",
      principal: "lab_principal_a",
    })).toEqual({
      transactionStatus: "active",
      bindingRevisionId: active.transaction.bindingRevisionId,
      activeBindingRevision: active.transaction.bindingRevisionId,
      lastGoodBindingRevision: first.transaction.bindingRevisionId,
    });
  });

  it("keeps execution uncommitted when audit append fails and appends once across retry", () => {
    const { authority, appendedEvents, setAppendError } = testAuthority();
    const transaction = mustPreauthorize(authority);
    const command = {
      sessionId: "review_session_a",
      sourceClientId: "viewer_lease_a",
      credential: "lease-token-sentinel",
      requestId: "cmd_audit",
      requestedEventType: "openStageRequest",
      commandContext: {},
      stageBindingAuthorizationId: transaction.stageBindingAuthorizationId,
      bindingRevisionId: transaction.bindingRevisionId,
      stageComposition: transaction.composition,
    };
    authority.authorizeRuntimeCommand(command);
    const confirmation = {
      sessionId: "review_session_a",
      credential: "lease-token-sentinel",
      stageBindingAuthorizationId: transaction.stageBindingAuthorizationId,
      bindingRevisionId: transaction.bindingRevisionId,
      requestId: "cmd_audit",
      outcome: "success" as const,
    };

    setAppendError(new Error("audit write failed"));
    expect(() => authority.confirmStageBinding(confirmation)).toThrow("audit write failed");
    expect(authority.getStageBindingSummary({
      sessionId: "review_session_a",
      principal: "lab_principal_a",
    })).toMatchObject({
      transactionStatus: "executing",
      activeBindingRevision: null,
    });
    expect(appendedEvents).toHaveLength(0);

    setAppendError(null);
    expect(authority.confirmStageBinding(confirmation)).toMatchObject({
      confirmed: true,
      idempotentReplay: false,
    });
    expect(authority.confirmStageBinding(confirmation)).toMatchObject({
      confirmed: true,
      idempotentReplay: true,
    });
    expect(appendedEvents).toHaveLength(1);
  });

  it("bounds non-terminal, completed, and active process-local state", () => {
    const { authority, advance } = testAuthority({
      maxNonTerminal: 1,
      maxCompleted: 2,
      maxCompletedPerSession: 1,
      maxActiveSessions: 2,
    });
    const pending = mustPreauthorize(authority);
    expect(authority.preauthorizeStageBinding({
      sessionId: "review_session_b",
      principal: "lab_principal_b",
      sourceClientId: "viewer_lease_b",
      credential: "lease-token-sentinel",
      artifacts: [{ artifactId: "artifact_b", role: "primary", loadOrder: 0 }],
    })).toEqual({ ok: false, reason: "capacity_exceeded" });

    const complete = (
      transaction: Extract<PreauthorizeStageBindingResult, { ok: true }>,
      suffix: string,
    ) => {
      const sessionId = `review_session_${suffix}`;
      const sourceClientId = `viewer_lease_${suffix}`;
      const requestId = `cmd_${suffix}_${transaction.bindingRevisionId}`;
      authority.authorizeRuntimeCommand({
        sessionId,
        sourceClientId,
        credential: "lease-token-sentinel",
        requestId,
        requestedEventType: "openStageRequest",
        commandContext: {},
        stageBindingAuthorizationId: transaction.stageBindingAuthorizationId,
        bindingRevisionId: transaction.bindingRevisionId,
        stageComposition: transaction.composition,
      });
      return authority.confirmStageBinding({
        sessionId,
        credential: "lease-token-sentinel",
        stageBindingAuthorizationId: transaction.stageBindingAuthorizationId,
        bindingRevisionId: transaction.bindingRevisionId,
        requestId,
        outcome: "success",
      });
    };

    expect(complete(pending, "a")).toMatchObject({ confirmed: true });
    const sameSession = mustPreauthorize(authority, "artifact_second");
    expect(complete(sameSession, "a")).toMatchObject({ confirmed: true });
    expect(authority.confirmStageBinding({
      sessionId: "review_session_a",
      credential: "lease-token-sentinel",
      stageBindingAuthorizationId: pending.stageBindingAuthorizationId,
      bindingRevisionId: pending.bindingRevisionId,
      requestId: `cmd_a_${pending.bindingRevisionId}`,
      outcome: "success",
    })).toMatchObject({ confirmed: false, detailCode: "stage_transaction_missing" });

    for (const suffix of ["b", "c"]) {
      advance(1);
      const transaction = mustPreauthorize(authority, `artifact_${suffix}`, {
        sessionId: `review_session_${suffix}`,
        principal: `lab_principal_${suffix}`,
        sourceClientId: `viewer_lease_${suffix}`,
      });
      expect(complete(transaction, suffix)).toMatchObject({ confirmed: true });
    }
    expect(authority.confirmStageBinding({
      sessionId: "review_session_a",
      credential: "lease-token-sentinel",
      stageBindingAuthorizationId: sameSession.stageBindingAuthorizationId,
      bindingRevisionId: sameSession.bindingRevisionId,
      requestId: `cmd_a_${sameSession.bindingRevisionId}`,
      outcome: "success",
    })).toMatchObject({ confirmed: false, detailCode: "stage_transaction_missing" });
    expect(authority.getStageBindingSummary({
      sessionId: "review_session_a",
      principal: "lab_principal_a",
    }).activeBindingRevision)
      .toBeNull();
    expect(authority.getStageBindingSummary({
      sessionId: "review_session_b",
      principal: "lab_principal_b",
    }).activeBindingRevision)
      .not.toBeNull();
    expect(authority.getStageBindingSummary({
      sessionId: "review_session_c",
      principal: "lab_principal_c",
    }).activeBindingRevision)
      .not.toBeNull();
    expect(authority.getStageBindingSummary({
      sessionId: "review_session_c",
      principal: "lab_principal_other",
    }).activeBindingRevision)
      .toBeNull();
  });

  it("owns the closed mutator catalog and validates transport-neutral command contexts", () => {
    const { authority } = testAuthority();
    const base = {
      sessionId: "review_session_a",
      sourceClientId: "viewer_lease_a",
      credential: "lease-token-sentinel",
      requestId: "cmd_policy",
      commandContext: {},
    };
    expect(authority.authorizeRuntimeCommand({
      ...base,
      requestedEventType: "getChildrenRequest",
    })).toMatchObject({
      authorized: false,
      reason: "unsupported_command",
      detailCode: "event_not_in_mutator_catalog",
    });
    expect(authority.authorizeRuntimeCommand({
      ...base,
      requestedEventType: "composeStageRequest",
    })).toMatchObject({
      authorized: false,
      reason: "unsupported_command",
      detailCode: "harness_only_command",
    });
    expect(authority.authorizeRuntimeCommand({
      ...base,
      requestedEventType: "focusPrimRequest",
      commandContext: { prim_path: "/World/WrongCase" },
    })).toMatchObject({
      authorized: false,
      reason: "invalid_payload",
      detailCode: "runtime_command_context_invalid",
    });
    expect(authority.authorizeRuntimeCommand({
      ...base,
      requestedEventType: "focusPrimRequest",
      commandContext: { primPath: "/World/Correct" },
    })).toMatchObject({ authorized: true });
    expect(authority.authorizeRuntimeCommand({
      ...base,
      requestedEventType: "resetStage",
      stageBindingAuthorizationId: "unexpected",
    })).toMatchObject({
      authorized: false,
      reason: "invalid_payload",
      detailCode: "unexpected_stage_transaction",
    });
  });

  it("rechecks session, principal lease, and artifact authority inside preauthorization", () => {
    const { authority, inspectedCredentials, setSessionStatus } = testAuthority();
    expect(authority.preauthorizeStageBinding({
      sessionId: "missing",
      principal: "lab_principal_a",
      sourceClientId: "viewer_lease_a",
      credential: "lease-token-sentinel",
      artifacts: [{ artifactId: "artifact_primary", role: "primary", loadOrder: 0 }],
    })).toEqual({ ok: false, reason: "session_not_found" });
    setSessionStatus("review_session_a", "closed");
    expect(authority.preauthorizeStageBinding({
      sessionId: "review_session_a",
      principal: "lab_principal_a",
      sourceClientId: "viewer_lease_a",
      credential: "lease-token-sentinel",
      artifacts: [{ artifactId: "artifact_primary", role: "primary", loadOrder: 0 }],
    })).toEqual({ ok: false, reason: "session_lifecycle_blocked" });
    expect(inspectedCredentials).toHaveLength(0);

    setSessionStatus("review_session_a", "active");
    expect(authority.preauthorizeStageBinding({
      sessionId: "review_session_a",
      principal: "lab_principal_other",
      sourceClientId: "viewer_lease_a",
      credential: "lease-token-sentinel",
      artifacts: [{ artifactId: "artifact_primary", role: "primary", loadOrder: 0 }],
    })).toEqual({ ok: false, reason: "primary_lease_required" });
    expect(authority.preauthorizeStageBinding({
      sessionId: "review_session_a",
      principal: "lab_principal_a",
      sourceClientId: "viewer_lease_a",
      credential: "lease-token-sentinel",
      artifacts: [
        { artifactId: "artifact_primary", role: "primary", loadOrder: 0 },
        { artifactId: "artifact_primary", role: "secondary", loadOrder: 1 },
      ],
    })).toEqual({ ok: false, reason: "artifact_selection_invalid" });
    expect(authority.preauthorizeStageBinding({
      sessionId: "review_session_a",
      principal: "lab_principal_a",
      sourceClientId: "viewer_lease_a",
      credential: "lease-token-sentinel",
      artifacts: [{ artifactId: "artifact_missing", role: "primary", loadOrder: 0 }],
    })).toEqual({ ok: false, reason: "artifact_unavailable" });
  });

  it("keeps credentials transient and fails closed when process-local authority is replaced", () => {
    const firstHarness = testAuthority();
    const transaction = mustPreauthorize(firstHarness.authority);
    const command = {
      sessionId: "review_session_a",
      sourceClientId: "viewer_lease_a",
      credential: "lease-token-sentinel",
      requestId: "cmd_secret",
      requestedEventType: "openStageRequest",
      commandContext: {},
      stageBindingAuthorizationId: transaction.stageBindingAuthorizationId,
      bindingRevisionId: transaction.bindingRevisionId,
      stageComposition: transaction.composition,
    };
    const authorized = firstHarness.authority.authorizeRuntimeCommand(command);
    const confirmed = firstHarness.authority.confirmStageBinding({
      sessionId: "review_session_a",
      credential: "lease-token-sentinel",
      stageBindingAuthorizationId: transaction.stageBindingAuthorizationId,
      bindingRevisionId: transaction.bindingRevisionId,
      requestId: "cmd_secret",
      outcome: "success",
    });
    const observable = JSON.stringify({
      transaction,
      authorized,
      confirmed,
      summary: firstHarness.authority.getStageBindingSummary({
        sessionId: "review_session_a",
        principal: "lab_principal_a",
      }),
      events: firstHarness.appendedEvents,
    });
    expect(observable).not.toContain("lease-token-sentinel");
    expect(firstHarness.inspectedCredentials).toEqual([
      "lease-token-sentinel",
      "lease-token-sentinel",
      "lease-token-sentinel",
    ]);

    const restarted = testAuthority().authority;
    expect(restarted.authorizeRuntimeCommand(command)).toMatchObject({
      authorized: false,
      reason: "lease_invalid",
      detailCode: "stage_transaction_missing",
    });
  });

  it("matches the tests-only cross-language runtime mutation vocabulary fixture", () => {
    const fixture = JSON.parse(readFileSync(
      new URL("../../../tests/contracts/runtime-mutation-authority-v1.json", import.meta.url),
      "utf8",
    )) as {
      version: number;
      mutatingEventTypes: string[];
      readonlyEventTypes: string[];
      stageLoadEventTypes: string[];
      harnessOnlyEventTypes: string[];
      rejectionReasons: string[];
    };
    expect(fixture.version).toBe(1);
    expect(RUNTIME_MUTATION_AUTHORITY_VOCABULARY.version).toBe(fixture.version);
    expect(new Set(RUNTIME_MUTATION_AUTHORITY_VOCABULARY.mutatingEventTypes))
      .toEqual(new Set(fixture.mutatingEventTypes));
    expect(new Set(RUNTIME_MUTATION_AUTHORITY_VOCABULARY.readonlyEventTypes))
      .toEqual(new Set(fixture.readonlyEventTypes));
    expect(new Set(RUNTIME_MUTATION_AUTHORITY_VOCABULARY.stageLoadEventTypes))
      .toEqual(new Set(fixture.stageLoadEventTypes));
    expect(new Set(RUNTIME_MUTATION_AUTHORITY_VOCABULARY.harnessOnlyEventTypes))
      .toEqual(new Set(fixture.harnessOnlyEventTypes));
    expect(new Set(RUNTIME_MUTATION_AUTHORITY_VOCABULARY.rejectionReasons))
      .toEqual(new Set(fixture.rejectionReasons));

    const validContexts: Record<string, Record<string, unknown>> = {
      openStageRequest: {},
      loadArtifactGroupRequest: {},
      composeStageRequest: {},
      highlightPrimsRequest: {
        mode: "replace",
        items: [{ primPath: "/World/Wall_001" }],
        focusFirst: true,
      },
      focusPrimRequest: { primPath: "/World/Wall_001" },
      clearHighlightRequest: {},
      selectPrimsRequest: { paths: ["/World/Wall_001"] },
      makePrimsPickable: { paths: ["/World/Wall_001"] },
      resetStage: {},
    };
    expect(Object.keys(validContexts).sort()).toEqual([...fixture.mutatingEventTypes].sort());
    const { authority } = testAuthority();
    for (const eventType of fixture.mutatingEventTypes) {
      const result = authority.authorizeRuntimeCommand({
        sessionId: "review_session_a",
        sourceClientId: "viewer_lease_a",
        credential: "lease-token-sentinel",
        requestId: `cmd_${eventType}`,
        requestedEventType: eventType,
        commandContext: validContexts[eventType],
      });
      if (fixture.harnessOnlyEventTypes.includes(eventType)) {
        expect(result).toMatchObject({ authorized: false, detailCode: "harness_only_command" });
      } else if (fixture.stageLoadEventTypes.includes(eventType)) {
        expect(result).toMatchObject({ authorized: false, detailCode: "stage_transaction_required" });
      } else {
        expect(result).toMatchObject({ authorized: true });
      }
    }
    for (const eventType of fixture.readonlyEventTypes) {
      expect(authority.authorizeRuntimeCommand({
        sessionId: "review_session_a",
        sourceClientId: "viewer_lease_a",
        credential: "lease-token-sentinel",
        requestId: `cmd_${eventType}`,
        requestedEventType: eventType,
        commandContext: {},
      })).toMatchObject({ authorized: false, detailCode: "event_not_in_mutator_catalog" });
    }

    const rejectionReasons = new Set<string>();
    const recordReason = (result: ReturnType<RuntimeMutationAuthority["authorizeRuntimeCommand"]>) => {
      if (!result.authorized) rejectionReasons.add(result.reason);
    };
    recordReason(authority.authorizeRuntimeCommand({
      sessionId: "missing",
      sourceClientId: "viewer_lease_a",
      credential: "lease-token-sentinel",
      requestId: "cmd_missing",
      requestedEventType: "resetStage",
      commandContext: {},
    }));
    recordReason(authority.authorizeRuntimeCommand({
      sessionId: "review_session_a",
      sourceClientId: "viewer_lease_a",
      credential: "lease-token-sentinel",
      requestId: "cmd_unsupported",
      requestedEventType: "unknownMutation",
      commandContext: {},
    }));
    recordReason(authority.authorizeRuntimeCommand({
      sessionId: "review_session_a",
      sourceClientId: "viewer_lease_a",
      credential: "lease-token-sentinel",
      requestId: "cmd_invalid",
      requestedEventType: "focusPrimRequest",
      commandContext: {},
    }));
    const closedHarness = testAuthority();
    closedHarness.setSessionStatus("review_session_a", "closed");
    recordReason(closedHarness.authority.authorizeRuntimeCommand({
      sessionId: "review_session_a",
      sourceClientId: "viewer_lease_a",
      credential: "lease-token-sentinel",
      requestId: "cmd_closed",
      requestedEventType: "resetStage",
      commandContext: {},
    }));
    for (const reason of ["spectator_readonly", "unauthorized_source_client"] as const) {
      const deniedHarness = testAuthority({}, {
        inspectRuntimeLease: () => ({ authorized: false, reason, detailCode: `test_${reason}` }),
      });
      recordReason(deniedHarness.authority.authorizeRuntimeCommand({
        sessionId: "review_session_a",
        sourceClientId: "viewer_lease_a",
        credential: "lease-token-sentinel",
        requestId: `cmd_${reason}`,
        requestedEventType: "resetStage",
        commandContext: {},
      }));
    }
    expect(rejectionReasons).toEqual(new Set(fixture.rejectionReasons));
  });
});
