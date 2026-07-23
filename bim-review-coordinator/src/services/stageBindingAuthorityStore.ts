import { randomBytes } from "node:crypto";

export type StageBindingStatus = "pending" | "executing" | "active" | "failed" | "superseded";
export type StageLoadEventType = "openStageRequest" | "loadArtifactGroupRequest";
export type StageBindingCompletionOutcome = "success" | "failed";

export interface StageCompositionArtifact {
  artifact_id: string;
  role: "primary" | "secondary";
  load_order: number;
  usdc_url: string;
}

export interface StageComposition {
  primary: StageCompositionArtifact;
  secondary_layers: StageCompositionArtifact[];
}

export interface StageBindingCreateInput {
  session_id: string;
  principal: string;
  lease_id: string;
  source_client_id: string;
  composition: StageComposition;
}

export interface StageBindingTransaction {
  stage_binding_authorization_id: string;
  binding_revision_id: string;
  session_id: string;
  principal: string;
  lease_id: string;
  source_client_id: string;
  stage_composition: StageComposition;
  status: StageBindingStatus;
  created_at: string;
  pending_expires_at: string;
  executing_expires_at: string | null;
  request_id: string | null;
  event_type: StageLoadEventType | null;
  completed_at: string | null;
  completion_outcome: StageBindingCompletionOutcome | null;
  failure_code: string | null;
}

interface StoredStageBindingTransaction extends StageBindingTransaction {
  createdAtMs: number;
  pendingExpiresAtMs: number;
  executingExpiresAtMs: number | null;
  completedAtMs: number | null;
}

export interface ActiveStageBindingSnapshot {
  binding_revision_id: string;
  principal: string;
  lease_id: string;
  source_client_id: string;
  stage_composition: StageComposition;
}

interface ActiveBindingSummary {
  active: ActiveStageBindingSnapshot;
  lastGood: ActiveStageBindingSnapshot | null;
  updatedAtMs: number;
}

export interface StageBindingAuthorityStoreOptions {
  clock?: () => number;
  idFactory?: (prefix: "stage_auth" | "binding_rev") => string;
  pendingTtlMs?: number;
  executingTtlMs?: number;
  completedRetentionMs?: number;
  maxNonTerminal?: number;
  maxCompleted?: number;
  maxCompletedPerSession?: number;
  maxActiveSessions?: number;
}

export type StageBindingCreateResult =
  | { ok: true; transaction: StageBindingTransaction; superseded_authorization_id: string | null }
  | { ok: false; reason: "transaction_executing" | "capacity_exceeded" };

export interface StageBindingConsumeInput {
  session_id: string;
  stage_binding_authorization_id: string;
  binding_revision_id: string;
  lease_id: string;
  source_client_id: string;
  request_id: string;
  event_type: StageLoadEventType;
  composition: StageComposition;
}

export type StageBindingConsumeResult =
  | { authorized: true; status: "executing"; transaction: StageBindingTransaction }
  | {
      authorized: false;
      reason: "transaction_missing" | "transaction_not_pending" | "transaction_mismatch";
    };

export type StageBindingPreMutationFailureResult =
  | { failed: true; transaction: StageBindingTransaction; idempotent_replay: boolean }
  | {
      failed: false;
      reason: "transaction_missing" | "transaction_not_abortable" | "transaction_mismatch";
    };

export interface StageBindingCompleteInput extends StageBindingConsumeInput {
  outcome: StageBindingCompletionOutcome;
}

export type StageBindingCompleteResult =
  | {
      confirmed: true;
      status: "active" | "failed";
      transaction: StageBindingTransaction;
      active_binding_revision: string | null;
      last_good_binding_revision: string | null;
      idempotent_replay: boolean;
    }
  | {
      confirmed: false;
      reason:
        | "transaction_missing"
        | "transaction_not_executing"
        | "transaction_mismatch"
        | "completion_mismatch";
    };

export interface StageBindingPrincipalSummary {
  transaction_status: StageBindingStatus | "none";
  binding_revision_id: string | null;
  active_binding_revision: string | null;
  last_good_binding_revision: string | null;
}

const DEFAULT_PENDING_TTL_MS = 60_000;
const DEFAULT_EXECUTING_TTL_MS = 10 * 60_000;
const DEFAULT_COMPLETED_RETENTION_MS = 30 * 60_000;
const DEFAULT_MAX_NON_TERMINAL = 256;
const DEFAULT_MAX_COMPLETED = 1_024;
const DEFAULT_MAX_COMPLETED_PER_SESSION = 4;
const DEFAULT_MAX_ACTIVE_SESSIONS = 256;

/**
 * Process-local authority for exact stage composition transactions.
 *
 * Every state transition is synchronous and therefore atomic within the Node
 * event loop. Callers only receive clones; mutating a response cannot alter the
 * exact tuple retained for later Kit authorization and completion.
 */
export class StageBindingAuthorityStore {
  private readonly transactions = new Map<string, StoredStageBindingTransaction>();
  private readonly activeBySession = new Map<string, ActiveBindingSummary>();
  private readonly clock: () => number;
  private readonly idFactory: (prefix: "stage_auth" | "binding_rev") => string;
  private readonly pendingTtlMs: number;
  private readonly executingTtlMs: number;
  private readonly completedRetentionMs: number;
  private readonly maxNonTerminal: number;
  private readonly maxCompleted: number;
  private readonly maxCompletedPerSession: number;
  private readonly maxActiveSessions: number;

  constructor(options: StageBindingAuthorityStoreOptions = {}) {
    this.clock = options.clock ?? Date.now;
    this.idFactory = options.idFactory ?? ((prefix) => `${prefix}_${randomBytes(12).toString("hex")}`);
    this.pendingTtlMs = positiveBound(options.pendingTtlMs, DEFAULT_PENDING_TTL_MS);
    this.executingTtlMs = positiveBound(options.executingTtlMs, DEFAULT_EXECUTING_TTL_MS);
    this.completedRetentionMs = positiveBound(options.completedRetentionMs, DEFAULT_COMPLETED_RETENTION_MS);
    this.maxNonTerminal = positiveBound(options.maxNonTerminal, DEFAULT_MAX_NON_TERMINAL);
    this.maxCompleted = positiveBound(options.maxCompleted, DEFAULT_MAX_COMPLETED);
    this.maxCompletedPerSession = positiveBound(
      options.maxCompletedPerSession,
      DEFAULT_MAX_COMPLETED_PER_SESSION,
    );
    this.maxActiveSessions = positiveBound(options.maxActiveSessions, DEFAULT_MAX_ACTIVE_SESSIONS);
  }

  create(input: StageBindingCreateInput): StageBindingCreateResult {
    const now = this.clock();
    this.sweep(now);
    const current = this.nonTerminalForSession(input.session_id);
    if (current?.status === "executing") {
      return { ok: false, reason: "transaction_executing" };
    }

    let supersededAuthorizationId: string | null = null;
    if (current?.status === "pending") {
      this.finishWithoutRuntime(current, "superseded", now, "superseded_by_new_pending");
      supersededAuthorizationId = current.stage_binding_authorization_id;
    }

    if (this.nonTerminalCount() >= this.maxNonTerminal) {
      return { ok: false, reason: "capacity_exceeded" };
    }

    const pendingExpiresAtMs = now + this.pendingTtlMs;
    const transaction: StoredStageBindingTransaction = {
      stage_binding_authorization_id: this.idFactory("stage_auth"),
      binding_revision_id: this.idFactory("binding_rev"),
      session_id: input.session_id,
      principal: input.principal,
      lease_id: input.lease_id,
      source_client_id: input.source_client_id,
      stage_composition: cloneComposition(input.composition),
      status: "pending",
      created_at: new Date(now).toISOString(),
      pending_expires_at: new Date(pendingExpiresAtMs).toISOString(),
      executing_expires_at: null,
      request_id: null,
      event_type: null,
      completed_at: null,
      completion_outcome: null,
      failure_code: null,
      createdAtMs: now,
      pendingExpiresAtMs,
      executingExpiresAtMs: null,
      completedAtMs: null,
    };
    this.transactions.set(transaction.stage_binding_authorization_id, transaction);
    this.evictCompletedForSession(input.session_id);
    return {
      ok: true,
      transaction: cloneTransaction(transaction),
      superseded_authorization_id: supersededAuthorizationId,
    };
  }

  consume(input: StageBindingConsumeInput): StageBindingConsumeResult {
    const now = this.clock();
    this.sweep(now);
    const transaction = this.transactions.get(input.stage_binding_authorization_id);
    if (!transaction) return { authorized: false, reason: "transaction_missing" };
    if (transaction.status !== "pending") {
      return { authorized: false, reason: "transaction_not_pending" };
    }
    if (!matchesAttempt(transaction, input, false)) {
      return { authorized: false, reason: "transaction_mismatch" };
    }

    const executingExpiresAtMs = now + this.executingTtlMs;
    transaction.status = "executing";
    transaction.request_id = input.request_id;
    transaction.event_type = input.event_type;
    transaction.executingExpiresAtMs = executingExpiresAtMs;
    transaction.executing_expires_at = new Date(executingExpiresAtMs).toISOString();
    return {
      authorized: true,
      status: "executing",
      transaction: cloneTransaction(transaction),
    };
  }

  /**
   * Fail a stage attempt that Kit could not safely begin because the
   * authorization response was unavailable. Accepting both pending and the
   * exact executing tuple closes the response-loss race without ever making a
   * runtime mutation look active.
   */
  failBeforeMutation(input: StageBindingConsumeInput): StageBindingPreMutationFailureResult {
    const now = this.clock();
    this.sweep(now);
    const transaction = this.transactions.get(input.stage_binding_authorization_id);
    if (!transaction) return { failed: false, reason: "transaction_missing" };

    if (
      transaction.status === "failed"
      && transaction.failure_code === "authorization_unavailable"
      && matchesAttempt(transaction, input, true)
    ) {
      return {
        failed: true,
        transaction: cloneTransaction(transaction),
        idempotent_replay: true,
      };
    }

    const matches = transaction.status === "pending"
      ? matchesAttempt(transaction, input, false)
      : transaction.status === "executing"
        ? matchesAttempt(transaction, input, true)
        : false;
    if (!matches) {
      return {
        failed: false,
        reason: transaction.status === "pending" || transaction.status === "executing"
          ? "transaction_mismatch"
          : "transaction_not_abortable",
      };
    }

    transaction.status = "failed";
    transaction.request_id = input.request_id;
    transaction.event_type = input.event_type;
    transaction.executingExpiresAtMs = null;
    transaction.executing_expires_at = null;
    transaction.completedAtMs = now;
    transaction.completed_at = new Date(now).toISOString();
    transaction.completion_outcome = "failed";
    transaction.failure_code = "authorization_unavailable";
    this.evictCompletedForSession(transaction.session_id);
    return {
      failed: true,
      transaction: cloneTransaction(transaction),
      idempotent_replay: false,
    };
  }

  complete(
    input: StageBindingCompleteInput,
    beforeCommit?: (transaction: StageBindingTransaction) => void,
  ): StageBindingCompleteResult {
    const now = this.clock();
    this.sweep(now);
    const transaction = this.transactions.get(input.stage_binding_authorization_id);
    if (!transaction) return { confirmed: false, reason: "transaction_missing" };

    if ((transaction.status === "active" || transaction.status === "failed") && transaction.completion_outcome) {
      if (!matchesAttempt(transaction, input, true) || transaction.completion_outcome !== input.outcome) {
        return { confirmed: false, reason: "completion_mismatch" };
      }
      return this.completedResult(transaction, true);
    }

    if (transaction.status !== "executing") {
      return { confirmed: false, reason: "transaction_not_executing" };
    }
    if (!matchesAttempt(transaction, input, true)) {
      return { confirmed: false, reason: "transaction_mismatch" };
    }

    beforeCommit?.(cloneTransaction(transaction));

    transaction.status = input.outcome === "success" ? "active" : "failed";
    transaction.completion_outcome = input.outcome;
    transaction.completedAtMs = now;
    transaction.completed_at = new Date(now).toISOString();
    transaction.failure_code = input.outcome === "failed" ? "runtime_stage_load_failed" : null;

    if (input.outcome === "success") {
      const previous = this.activeBySession.get(transaction.session_id)?.active ?? null;
      this.activeBySession.set(transaction.session_id, {
        active: snapshotBinding(transaction),
        lastGood: previous,
        updatedAtMs: now,
      });
      this.evictActiveSessions(transaction.session_id);
    }
    this.evictCompletedForSession(
      transaction.session_id,
      transaction.stage_binding_authorization_id,
    );
    this.evictCompletedGlobal(transaction.stage_binding_authorization_id);
    return this.completedResult(transaction, false);
  }

  get(stageBindingAuthorizationId: string): StageBindingTransaction | null {
    this.sweep(this.clock());
    const transaction = this.transactions.get(stageBindingAuthorizationId);
    return transaction ? cloneTransaction(transaction) : null;
  }

  activeBinding(sessionId: string, principal: string): ActiveStageBindingSnapshot | null {
    this.sweep(this.clock());
    const active = this.activeBySession.get(sessionId)?.active;
    return active?.principal === principal ? cloneBindingSnapshot(active) : null;
  }

  summary(sessionId: string, principal: string): StageBindingPrincipalSummary {
    this.sweep(this.clock());
    const principalTransactions = [...this.transactions.values()]
      .filter((transaction) => transaction.session_id === sessionId && transaction.principal === principal)
      .sort((left, right) => right.createdAtMs - left.createdAtMs);
    const current = principalTransactions.find((transaction) =>
      transaction.status === "pending" || transaction.status === "executing",
    ) ?? principalTransactions[0] ?? null;
    const active = this.activeBySession.get(sessionId);
    const callerActive = active?.active.principal === principal ? active.active.binding_revision_id : null;
    const callerLastGood = active?.lastGood?.principal === principal
      ? active.lastGood.binding_revision_id
      : null;

    return {
      transaction_status: current?.status ?? (callerActive ? "active" : "none"),
      binding_revision_id: current?.binding_revision_id ?? callerActive,
      active_binding_revision: callerActive,
      last_good_binding_revision: callerLastGood,
    };
  }

  private completedResult(
    transaction: StoredStageBindingTransaction,
    idempotentReplay: boolean,
  ): Extract<StageBindingCompleteResult, { confirmed: true }> {
    const active = this.activeBySession.get(transaction.session_id);
    return {
      confirmed: true,
      status: transaction.status === "active" ? "active" : "failed",
      transaction: cloneTransaction(transaction),
      active_binding_revision: active?.active.binding_revision_id ?? null,
      last_good_binding_revision: active?.lastGood?.binding_revision_id ?? null,
      idempotent_replay: idempotentReplay,
    };
  }

  private sweep(now: number): void {
    for (const transaction of this.transactions.values()) {
      if (transaction.status === "pending" && now >= transaction.pendingExpiresAtMs) {
        this.finishWithoutRuntime(transaction, "failed", now, "pending_expired");
      } else if (
        transaction.status === "executing"
        && transaction.executingExpiresAtMs !== null
        && now >= transaction.executingExpiresAtMs
      ) {
        this.finishWithoutRuntime(transaction, "failed", now, "executing_expired");
      }
    }

    for (const [id, transaction] of this.transactions.entries()) {
      if (transaction.completedAtMs === null) continue;
      if (now - transaction.completedAtMs >= this.completedRetentionMs) {
        this.transactions.delete(id);
      }
    }

    const sessionIds = new Set([...this.transactions.values()].map((transaction) => transaction.session_id));
    for (const sessionId of sessionIds) this.evictCompletedForSession(sessionId);
    this.evictCompletedGlobal();
    this.evictActiveSessions();
  }

  private finishWithoutRuntime(
    transaction: StoredStageBindingTransaction,
    status: "failed" | "superseded",
    now: number,
    failureCode: string,
  ): void {
    transaction.status = status;
    transaction.completedAtMs = now;
    transaction.completed_at = new Date(now).toISOString();
    transaction.failure_code = failureCode;
  }

  private nonTerminalForSession(sessionId: string): StoredStageBindingTransaction | null {
    return [...this.transactions.values()].find((transaction) =>
      transaction.session_id === sessionId
      && (transaction.status === "pending" || transaction.status === "executing"),
    ) ?? null;
  }

  private nonTerminalCount(): number {
    return [...this.transactions.values()].filter((transaction) =>
      transaction.status === "pending" || transaction.status === "executing",
    ).length;
  }

  private evictCompletedForSession(sessionId: string, protectedId?: string): void {
    const completed = [...this.transactions.values()]
      .filter((transaction) => transaction.session_id === sessionId && transaction.completedAtMs !== null)
      .sort((left, right) => (right.completedAtMs ?? 0) - (left.completedAtMs ?? 0));
    const retained = new Set(
      completed
        .filter((transaction) => transaction.stage_binding_authorization_id !== protectedId)
        .slice(0, Math.max(0, this.maxCompletedPerSession - (protectedId ? 1 : 0)))
        .map((transaction) => transaction.stage_binding_authorization_id),
    );
    if (protectedId) retained.add(protectedId);
    for (const transaction of completed) {
      if (retained.has(transaction.stage_binding_authorization_id)) continue;
      this.transactions.delete(transaction.stage_binding_authorization_id);
    }
  }

  private evictCompletedGlobal(protectedId?: string): void {
    const completed = [...this.transactions.values()]
      .filter((transaction) => transaction.completedAtMs !== null)
      .sort((left, right) => (right.completedAtMs ?? 0) - (left.completedAtMs ?? 0));
    const retained = new Set(
      completed
        .filter((transaction) => transaction.stage_binding_authorization_id !== protectedId)
        .slice(0, Math.max(0, this.maxCompleted - (protectedId ? 1 : 0)))
        .map((transaction) => transaction.stage_binding_authorization_id),
    );
    if (protectedId) retained.add(protectedId);
    for (const transaction of completed) {
      if (retained.has(transaction.stage_binding_authorization_id)) continue;
      this.transactions.delete(transaction.stage_binding_authorization_id);
    }
  }

  private evictActiveSessions(protectedSessionId?: string): void {
    if (this.activeBySession.size <= this.maxActiveSessions) return;
    const candidates = [...this.activeBySession.entries()]
      .filter(([sessionId]) => sessionId !== protectedSessionId)
      .sort((left, right) => left[1].updatedAtMs - right[1].updatedAtMs);
    const removeCount = this.activeBySession.size - this.maxActiveSessions;
    for (const [sessionId] of candidates.slice(0, removeCount)) {
      this.activeBySession.delete(sessionId);
    }
  }
}

function matchesAttempt(
  transaction: StoredStageBindingTransaction,
  input: StageBindingConsumeInput,
  requireClaimedAttempt: boolean,
): boolean {
  if (
    transaction.session_id !== input.session_id
    || transaction.binding_revision_id !== input.binding_revision_id
    || transaction.lease_id !== input.lease_id
    || transaction.source_client_id !== input.source_client_id
    || !compositionsEqual(transaction.stage_composition, input.composition)
  ) {
    return false;
  }
  if (!requireClaimedAttempt) return true;
  return transaction.request_id === input.request_id && transaction.event_type === input.event_type;
}

function compositionsEqual(left: StageComposition, right: StageComposition): boolean {
  if (!artifactsEqual(left.primary, right.primary)) return false;
  if (left.secondary_layers.length !== right.secondary_layers.length) return false;
  return left.secondary_layers.every((artifact, index) => artifactsEqual(artifact, right.secondary_layers[index]));
}

function artifactsEqual(left: StageCompositionArtifact, right: StageCompositionArtifact | undefined): boolean {
  return Boolean(right)
    && left.artifact_id === right?.artifact_id
    && left.role === right?.role
    && left.load_order === right?.load_order
    && left.usdc_url === right?.usdc_url;
}

function cloneComposition(composition: StageComposition): StageComposition {
  return {
    primary: { ...composition.primary },
    secondary_layers: composition.secondary_layers.map((artifact) => ({ ...artifact })),
  };
}

function snapshotBinding(transaction: StoredStageBindingTransaction): ActiveStageBindingSnapshot {
  return {
    binding_revision_id: transaction.binding_revision_id,
    principal: transaction.principal,
    lease_id: transaction.lease_id,
    source_client_id: transaction.source_client_id,
    stage_composition: cloneComposition(transaction.stage_composition),
  };
}

function cloneBindingSnapshot(snapshot: ActiveStageBindingSnapshot): ActiveStageBindingSnapshot {
  return {
    ...snapshot,
    stage_composition: cloneComposition(snapshot.stage_composition),
  };
}

function cloneTransaction(transaction: StoredStageBindingTransaction): StageBindingTransaction {
  return {
    stage_binding_authorization_id: transaction.stage_binding_authorization_id,
    binding_revision_id: transaction.binding_revision_id,
    session_id: transaction.session_id,
    principal: transaction.principal,
    lease_id: transaction.lease_id,
    source_client_id: transaction.source_client_id,
    stage_composition: cloneComposition(transaction.stage_composition),
    status: transaction.status,
    created_at: transaction.created_at,
    pending_expires_at: transaction.pending_expires_at,
    executing_expires_at: transaction.executing_expires_at,
    request_id: transaction.request_id,
    event_type: transaction.event_type,
    completed_at: transaction.completed_at,
    completion_outcome: transaction.completion_outcome,
    failure_code: transaction.failure_code,
  };
}

function positiveBound(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && (value ?? 0) > 0 ? Math.floor(value as number) : fallback;
}
