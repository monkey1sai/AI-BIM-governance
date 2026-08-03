export type StageBindingStatus = "pending" | "executing" | "active" | "failed" | "superseded";
export type StageLoadEventType = "openStageRequest" | "loadArtifactGroupRequest";
export type StageBindingCompletionOutcome = "success" | "failed";

export interface StageCompositionArtifact {
  artifactId: string;
  role: "primary" | "secondary";
  loadOrder: number;
  usdcUrl: string;
}

export interface StageComposition {
  primary: StageCompositionArtifact;
  secondaryLayers: StageCompositionArtifact[];
}

interface StageBindingBase {
  stageBindingAuthorizationId: string;
  bindingRevisionId: string;
  sessionId: string;
  principal: string;
  leaseId: string;
  sourceClientId: string;
  // The browser creates this opaque ID before sending a preauthorization
  // request.  It lets a timeout cancellation arrive before the delayed POST
  // without allowing that stale request to replace a newer pending binding.
  clientRequestId?: string;
  composition: StageComposition;
  createdAtMs: number;
  pendingExpiresAtMs: number;
}

interface PendingStageBinding extends StageBindingBase {
  phase: "pending";
}

export interface StageBindingAttempt {
  sessionId: string;
  stageBindingAuthorizationId: string;
  bindingRevisionId: string;
  leaseId: string;
  sourceClientId: string;
  requestId: string;
  eventType: StageLoadEventType;
  composition: StageComposition;
}

interface ExecutingStageBinding extends StageBindingBase {
  phase: "executing";
  attempt: StageBindingAttempt;
  executingExpiresAtMs: number;
}

interface SupersededStageBinding extends StageBindingBase {
  phase: "superseded";
  completedAtMs: number;
  failureCode: "superseded_by_new_pending";
}

interface AuthorizationUnavailableStageBinding extends StageBindingBase {
  phase: "failed";
  attempt: StageBindingAttempt;
  completedAtMs: number;
  completionOutcome: "failed";
  failureCode: "authorization_unavailable";
}

interface ActiveStageBinding extends StageBindingBase {
  phase: "active";
  attempt: StageBindingAttempt;
  executingExpiresAtMs: number;
  completedAtMs: number;
  completionOutcome: "success";
}

interface RuntimeFailedStageBinding extends StageBindingBase {
  phase: "failed";
  attempt: StageBindingAttempt;
  executingExpiresAtMs: number;
  completedAtMs: number;
  completionOutcome: "failed";
  failureCode: "runtime_stage_load_failed";
}

interface PendingExpiredStageBinding extends StageBindingBase {
  phase: "failed";
  completedAtMs: number;
  failureCode: "pending_expired";
}

interface PreauthorizationCancelledStageBinding extends StageBindingBase {
  phase: "failed";
  completedAtMs: number;
  failureCode: "preauthorization_cancelled";
}

interface ExecutingExpiredStageBinding extends StageBindingBase {
  phase: "failed";
  attempt: StageBindingAttempt;
  executingExpiresAtMs: number;
  completedAtMs: number;
  failureCode: "executing_expired";
}

type StageBindingRecord =
  | PendingStageBinding
  | ExecutingStageBinding
  | SupersededStageBinding
  | AuthorizationUnavailableStageBinding
  | ActiveStageBinding
  | RuntimeFailedStageBinding
  | PendingExpiredStageBinding
  | PreauthorizationCancelledStageBinding
  | ExecutingExpiredStageBinding;

export interface ActiveStageBindingSnapshot {
  bindingRevisionId: string;
  principal: string;
  leaseId: string;
  sourceClientId: string;
  composition: StageComposition;
}

interface ActiveBindingSummary {
  active: ActiveStageBindingSnapshot;
  lastGood: ActiveStageBindingSnapshot | null;
  updatedAtMs: number;
}

export interface StageBindingStateOptions {
  clock: () => number;
  idFactory: (prefix: "stage_auth" | "binding_rev") => string;
  pendingTtlMs?: number;
  executingTtlMs?: number;
  completedRetentionMs?: number;
  maxNonTerminal?: number;
  maxCompleted?: number;
  maxCompletedPerSession?: number;
  maxActiveSessions?: number;
}

export interface CreatePendingStageBindingInput {
  sessionId: string;
  principal: string;
  leaseId: string;
  sourceClientId: string;
  clientRequestId?: string;
  composition: StageComposition;
}

export interface PendingStageBindingView {
  stageBindingAuthorizationId: string;
  bindingRevisionId: string;
  transactionStatus: "pending";
  composition: StageComposition;
  pendingExpiresAt: string;
}

export type CreatePendingStageBindingResult =
  | { ok: true; transaction: PendingStageBindingView; supersededAuthorizationId: string | null }
  | { ok: false; reason: "transaction_executing" | "capacity_exceeded" | "request_cancelled" };

export interface CancelPendingStageBindingInput {
  sessionId: string;
  principal: string;
  leaseId: string;
  sourceClientId: string;
  clientRequestId: string;
}

export type CancelPendingStageBindingResult =
  | { cancelled: true; idempotentReplay: boolean }
  | { cancelled: false; reason: "transaction_not_abortable" };

export type ConsumeStageBindingResult =
  | { authorized: true; transactionStatus: "executing" }
  | {
      authorized: false;
      reason: "transaction_missing" | "transaction_not_pending" | "transaction_mismatch";
    };

export type FailStageBindingResult =
  | { failed: true; idempotentReplay: boolean }
  | {
      failed: false;
      reason: "transaction_missing" | "transaction_not_abortable" | "transaction_mismatch";
    };

export type StageBindingConfirmationContextResult =
  | { found: false; reason: "transaction_missing" | "transaction_mismatch" }
  | {
      found: true;
      sessionId: string;
      stageBindingAuthorizationId: string;
      bindingRevisionId: string;
      leaseId: string;
      principal: string;
      sourceClientId: string;
      attempt: StageBindingAttempt | null;
      composition: StageComposition;
    };

export interface CompleteStageBindingInput extends StageBindingAttempt {
  outcome: StageBindingCompletionOutcome;
}

export type CompleteStageBindingResult =
  | {
      confirmed: true;
      transactionStatus: "active" | "failed";
      activeBindingRevision: string | null;
      lastGoodBindingRevision: string | null;
      idempotentReplay: boolean;
    }
  | {
      confirmed: false;
      reason:
        | "transaction_missing"
        | "transaction_not_executing"
        | "transaction_mismatch"
        | "completion_mismatch";
    };

export interface StageBindingSummary {
  transactionStatus: StageBindingStatus | "none";
  bindingRevisionId: string | null;
  activeBindingRevision: string | null;
  lastGoodBindingRevision: string | null;
}

const DEFAULT_PENDING_TTL_MS = 60_000;
const DEFAULT_EXECUTING_TTL_MS = 10 * 60_000;
const DEFAULT_COMPLETED_RETENTION_MS = 30 * 60_000;
const DEFAULT_MAX_NON_TERMINAL = 256;
const DEFAULT_MAX_COMPLETED = 1_024;
const DEFAULT_MAX_COMPLETED_PER_SESSION = 4;
const DEFAULT_MAX_ACTIVE_SESSIONS = 256;

/** Private process-local stage-binding state. Public callers use RuntimeMutationAuthority. */
export class StageBindingState {
  private readonly transactions = new Map<string, StageBindingRecord>();
  // Tombstones are intentionally independent of a transaction record.  A
  // cancellation can reach the coordinator before the timed-out browser POST
  // does, so there is not necessarily an authorization ID to roll back yet.
  private readonly cancelledPreauthorizationIntents = new Map<string, number>();
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

  constructor(options: StageBindingStateOptions) {
    this.clock = options.clock;
    this.idFactory = options.idFactory;
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

  createPending(input: CreatePendingStageBindingInput): CreatePendingStageBindingResult {
    const now = this.clock();
    this.sweep(now);
    const clientRequestId = input.clientRequestId;
    if (
      clientRequestId
      && this.cancelledPreauthorizationIntents.has(preauthorizationIntentKey({ ...input, clientRequestId }))
    ) {
      return { ok: false, reason: "request_cancelled" };
    }
    const current = this.nonTerminalForSession(input.sessionId);
    if (current?.phase === "executing") {
      return { ok: false, reason: "transaction_executing" };
    }

    const replacedPending = current?.phase === "pending" ? current : null;
    const projectedNonTerminalCount = this.nonTerminalCount() + (replacedPending ? 0 : 1);
    if (projectedNonTerminalCount > this.maxNonTerminal) {
      return { ok: false, reason: "capacity_exceeded" };
    }

    const pendingExpiresAtMs = now + this.pendingTtlMs;
    const record: PendingStageBinding = {
      phase: "pending",
      stageBindingAuthorizationId: this.idFactory("stage_auth"),
      bindingRevisionId: this.idFactory("binding_rev"),
      sessionId: input.sessionId,
      principal: input.principal,
      leaseId: input.leaseId,
      sourceClientId: input.sourceClientId,
      ...(input.clientRequestId ? { clientRequestId: input.clientRequestId } : {}),
      composition: cloneComposition(input.composition),
      createdAtMs: now,
      pendingExpiresAtMs,
    };
    const superseded = replacedPending
      ? {
          ...replacedPending,
          phase: "superseded" as const,
          completedAtMs: now,
          failureCode: "superseded_by_new_pending" as const,
        }
      : null;

    if (superseded) {
      this.transactions.set(superseded.stageBindingAuthorizationId, superseded);
    }
    this.transactions.set(record.stageBindingAuthorizationId, record);
    this.evictCompletedForSession(input.sessionId);
    return {
      ok: true,
      transaction: pendingView(record),
      supersededAuthorizationId: superseded?.stageBindingAuthorizationId ?? null,
    };
  }

  cancelPendingByIntent(input: CancelPendingStageBindingInput): CancelPendingStageBindingResult {
    const now = this.clock();
    this.sweep(now);
    const key = preauthorizationIntentKey(input);
    const alreadyCancelled = this.cancelledPreauthorizationIntents.has(key);
    this.cancelledPreauthorizationIntents.set(key, now);

    const matchingTransactions = [...this.transactions.values()].filter((candidate) => (
      matchesPreauthorizationIntent(candidate, input)
    ));
    const transaction = matchingTransactions.find((candidate) => candidate.phase === "pending");
    if (!transaction) {
      const priorCancellation = matchingTransactions.find((candidate) => (
        candidate.phase === "failed" && candidate.failureCode === "preauthorization_cancelled"
      ));
      if (priorCancellation) return { cancelled: true, idempotentReplay: true };
      if (matchingTransactions.length > 0) {
        // The browser cannot safely roll back a request once Kit has consumed
        // it (or it has otherwise reached a non-pending terminal state).  Keep
        // the tombstone so a duplicate late POST is still fenced, but expose
        // that the existing transaction was not abortable.
        return { cancelled: false, reason: "transaction_not_abortable" };
      }
      return { cancelled: true, idempotentReplay: alreadyCancelled };
    }

    const cancelled: PreauthorizationCancelledStageBinding = {
      ...transaction,
      phase: "failed",
      completedAtMs: now,
      failureCode: "preauthorization_cancelled",
    };
    this.transactions.set(transaction.stageBindingAuthorizationId, cancelled);
    this.evictCompletedForSession(transaction.sessionId, transaction.stageBindingAuthorizationId);
    this.evictCompletedGlobal(transaction.stageBindingAuthorizationId);
    return { cancelled: true, idempotentReplay: false };
  }

  consume(input: StageBindingAttempt): ConsumeStageBindingResult {
    const now = this.clock();
    this.sweep(now);
    const transaction = this.transactions.get(input.stageBindingAuthorizationId);
    if (!transaction) return { authorized: false, reason: "transaction_missing" };
    if (transaction.phase !== "pending") {
      return { authorized: false, reason: "transaction_not_pending" };
    }
    if (!matchesBase(transaction, input)) {
      return { authorized: false, reason: "transaction_mismatch" };
    }
    const executing: ExecutingStageBinding = {
      ...transaction,
      phase: "executing",
      attempt: cloneAttempt(input),
      executingExpiresAtMs: now + this.executingTtlMs,
    };
    this.transactions.set(transaction.stageBindingAuthorizationId, executing);
    return { authorized: true, transactionStatus: "executing" };
  }

  failBeforeMutation(input: StageBindingAttempt): FailStageBindingResult {
    const now = this.clock();
    this.sweep(now);
    const transaction = this.transactions.get(input.stageBindingAuthorizationId);
    if (!transaction) return { failed: false, reason: "transaction_missing" };

    if (
      transaction.phase === "failed"
      && transaction.failureCode === "authorization_unavailable"
      && matchesAttempt(transaction.attempt, input)
    ) {
      return { failed: true, idempotentReplay: true };
    }

    const matches = transaction.phase === "pending"
      ? matchesBase(transaction, input)
      : transaction.phase === "executing"
        ? matchesAttempt(transaction.attempt, input)
        : false;
    if (!matches) {
      return {
        failed: false,
        reason: transaction.phase === "pending" || transaction.phase === "executing"
          ? "transaction_mismatch"
          : "transaction_not_abortable",
      };
    }

    if (transaction.phase !== "pending" && transaction.phase !== "executing") {
      return { failed: false, reason: "transaction_not_abortable" };
    }
    const failed: AuthorizationUnavailableStageBinding = {
      ...baseRecord(transaction),
      phase: "failed",
      attempt: cloneAttempt(input),
      completedAtMs: now,
      completionOutcome: "failed",
      failureCode: "authorization_unavailable",
    };
    this.transactions.set(transaction.stageBindingAuthorizationId, failed);
    this.evictCompletedForSession(transaction.sessionId);
    return { failed: true, idempotentReplay: false };
  }

  confirmationContext(
    stageBindingAuthorizationId: string,
    sessionId: string,
    bindingRevisionId: string,
  ): StageBindingConfirmationContextResult {
    this.sweep(this.clock());
    const transaction = this.transactions.get(stageBindingAuthorizationId);
    if (!transaction) return { found: false, reason: "transaction_missing" };
    if (transaction.sessionId !== sessionId || transaction.bindingRevisionId !== bindingRevisionId) {
      return { found: false, reason: "transaction_mismatch" };
    }
    return {
      found: true,
      sessionId: transaction.sessionId,
      stageBindingAuthorizationId: transaction.stageBindingAuthorizationId,
      bindingRevisionId: transaction.bindingRevisionId,
      leaseId: transaction.leaseId,
      principal: transaction.principal,
      sourceClientId: transaction.sourceClientId,
      attempt: "attempt" in transaction ? cloneAttempt(transaction.attempt) : null,
      composition: cloneComposition(transaction.composition),
    };
  }

  complete(input: CompleteStageBindingInput, beforeCommit?: () => void): CompleteStageBindingResult {
    const now = this.clock();
    this.sweep(now);
    const transaction = this.transactions.get(input.stageBindingAuthorizationId);
    if (!transaction) return { confirmed: false, reason: "transaction_missing" };

    if (
      (transaction.phase === "active" || transaction.phase === "failed")
      && "completionOutcome" in transaction
    ) {
      if (!matchesAttempt(transaction.attempt, input) || transaction.completionOutcome !== input.outcome) {
        return { confirmed: false, reason: "completion_mismatch" };
      }
      return this.completedResult(transaction, true);
    }
    if (transaction.phase !== "executing") {
      return { confirmed: false, reason: "transaction_not_executing" };
    }
    if (!matchesAttempt(transaction.attempt, input)) {
      return { confirmed: false, reason: "transaction_mismatch" };
    }

    beforeCommit?.();

    const completed: ActiveStageBinding | RuntimeFailedStageBinding = input.outcome === "success"
      ? {
          ...transaction,
          phase: "active",
          completedAtMs: now,
          completionOutcome: "success",
        }
      : {
          ...transaction,
          phase: "failed",
          completedAtMs: now,
          completionOutcome: "failed",
          failureCode: "runtime_stage_load_failed",
        };
    this.transactions.set(transaction.stageBindingAuthorizationId, completed);
    if (completed.phase === "active") {
      const previous = this.activeBySession.get(completed.sessionId)?.active ?? null;
      this.activeBySession.set(completed.sessionId, {
        active: snapshotActiveBinding(completed),
        lastGood: previous,
        updatedAtMs: now,
      });
      this.evictActiveSessions(completed.sessionId);
    }
    this.evictCompletedForSession(completed.sessionId, completed.stageBindingAuthorizationId);
    this.evictCompletedGlobal(completed.stageBindingAuthorizationId);
    return this.completedResult(completed, false);
  }

  summary(sessionId: string, principal: string): StageBindingSummary {
    this.sweep(this.clock());
    const principalTransactions = [...this.transactions.values()]
      .filter((transaction) => transaction.sessionId === sessionId && transaction.principal === principal)
      .sort((left, right) => right.createdAtMs - left.createdAtMs);
    const current = principalTransactions.find((transaction) =>
      transaction.phase === "pending" || transaction.phase === "executing",
    ) ?? principalTransactions[0] ?? null;
    const active = this.activeBySession.get(sessionId);
    const callerActive = active?.active.principal === principal ? active.active.bindingRevisionId : null;
    const callerLastGood = active?.lastGood?.principal === principal
      ? active.lastGood.bindingRevisionId
      : null;
    return {
      transactionStatus: current?.phase ?? (callerActive ? "active" : "none"),
      bindingRevisionId: current?.bindingRevisionId ?? callerActive,
      activeBindingRevision: callerActive,
      lastGoodBindingRevision: callerLastGood,
    };
  }

  activeBinding(sessionId: string, principal: string): ActiveStageBindingSnapshot | null {
    this.sweep(this.clock());
    const active = this.activeBySession.get(sessionId)?.active;
    return active?.principal === principal ? cloneActiveBinding(active) : null;
  }

  private sweep(now: number): void {
    for (const transaction of this.transactions.values()) {
      if (transaction.phase === "pending" && now >= transaction.pendingExpiresAtMs) {
        const expired: PendingExpiredStageBinding = {
          ...transaction,
          phase: "failed",
          completedAtMs: now,
          failureCode: "pending_expired",
        };
        this.transactions.set(transaction.stageBindingAuthorizationId, expired);
      } else if (
        transaction.phase === "executing"
        && now >= transaction.executingExpiresAtMs
      ) {
        const expired: ExecutingExpiredStageBinding = {
          ...transaction,
          phase: "failed",
          completedAtMs: now,
          failureCode: "executing_expired",
        };
        this.transactions.set(transaction.stageBindingAuthorizationId, expired);
      }
    }

    for (const [authorizationId, transaction] of this.transactions.entries()) {
      if (!("completedAtMs" in transaction)) continue;
      if (now - transaction.completedAtMs >= this.completedRetentionMs) {
        this.transactions.delete(authorizationId);
      }
    }

    for (const [key, cancelledAtMs] of this.cancelledPreauthorizationIntents.entries()) {
      if (now - cancelledAtMs >= this.completedRetentionMs) {
        this.cancelledPreauthorizationIntents.delete(key);
      }
    }

    const sessionIds = new Set([...this.transactions.values()].map((transaction) => transaction.sessionId));
    for (const sessionId of sessionIds) this.evictCompletedForSession(sessionId);
    this.evictCompletedGlobal();
    this.evictActiveSessions();
  }

  private nonTerminalForSession(sessionId: string): PendingStageBinding | ExecutingStageBinding | null {
    return [...this.transactions.values()].find((transaction) =>
      transaction.sessionId === sessionId
      && (transaction.phase === "pending" || transaction.phase === "executing"),
    ) as PendingStageBinding | ExecutingStageBinding | undefined ?? null;
  }

  private nonTerminalCount(): number {
    return [...this.transactions.values()].filter((transaction) =>
      transaction.phase === "pending" || transaction.phase === "executing",
    ).length;
  }

  private completedResult(
    transaction: ActiveStageBinding | RuntimeFailedStageBinding | AuthorizationUnavailableStageBinding,
    idempotentReplay: boolean,
  ): Extract<CompleteStageBindingResult, { confirmed: true }> {
    const active = this.activeBySession.get(transaction.sessionId);
    return {
      confirmed: true,
      transactionStatus: transaction.phase === "active" ? "active" : "failed",
      activeBindingRevision: active?.active.bindingRevisionId ?? null,
      lastGoodBindingRevision: active?.lastGood?.bindingRevisionId ?? null,
      idempotentReplay,
    };
  }

  private evictCompletedForSession(sessionId: string, protectedId?: string): void {
    const completed = [...this.transactions.values()]
      .filter((transaction) => transaction.sessionId === sessionId && "completedAtMs" in transaction)
      .sort((left, right) => completedAt(right) - completedAt(left));
    const retained = new Set(
      completed
        .filter((transaction) => transaction.stageBindingAuthorizationId !== protectedId)
        .slice(0, Math.max(0, this.maxCompletedPerSession - (protectedId ? 1 : 0)))
        .map((transaction) => transaction.stageBindingAuthorizationId),
    );
    if (protectedId) retained.add(protectedId);
    for (const transaction of completed) {
      if (!retained.has(transaction.stageBindingAuthorizationId)) {
        this.transactions.delete(transaction.stageBindingAuthorizationId);
      }
    }
  }

  private evictCompletedGlobal(protectedId?: string): void {
    const completed = [...this.transactions.values()]
      .filter((transaction) => "completedAtMs" in transaction)
      .sort((left, right) => completedAt(right) - completedAt(left));
    const retained = new Set(
      completed
        .filter((transaction) => transaction.stageBindingAuthorizationId !== protectedId)
        .slice(0, Math.max(0, this.maxCompleted - (protectedId ? 1 : 0)))
        .map((transaction) => transaction.stageBindingAuthorizationId),
    );
    if (protectedId) retained.add(protectedId);
    for (const transaction of completed) {
      if (!retained.has(transaction.stageBindingAuthorizationId)) {
        this.transactions.delete(transaction.stageBindingAuthorizationId);
      }
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

function matchesBase(transaction: StageBindingBase, attempt: StageBindingAttempt): boolean {
  return transaction.stageBindingAuthorizationId === attempt.stageBindingAuthorizationId
    && transaction.sessionId === attempt.sessionId
    && transaction.bindingRevisionId === attempt.bindingRevisionId
    && transaction.leaseId === attempt.leaseId
    && transaction.sourceClientId === attempt.sourceClientId
    && compositionsEqual(transaction.composition, attempt.composition);
}

function matchesPreauthorizationIntent(
  transaction: StageBindingBase,
  input: CancelPendingStageBindingInput,
): boolean {
  return transaction.sessionId === input.sessionId
    && transaction.principal === input.principal
    && transaction.leaseId === input.leaseId
    && transaction.sourceClientId === input.sourceClientId
    && transaction.clientRequestId === input.clientRequestId;
}

function matchesAttempt(left: StageBindingAttempt, right: StageBindingAttempt): boolean {
  return left.sessionId === right.sessionId
    && left.stageBindingAuthorizationId === right.stageBindingAuthorizationId
    && left.bindingRevisionId === right.bindingRevisionId
    && left.leaseId === right.leaseId
    && left.sourceClientId === right.sourceClientId
    && left.requestId === right.requestId
    && left.eventType === right.eventType
    && compositionsEqual(left.composition, right.composition);
}

function compositionsEqual(left: StageComposition, right: StageComposition): boolean {
  if (!artifactsEqual(left.primary, right.primary)) return false;
  if (left.secondaryLayers.length !== right.secondaryLayers.length) return false;
  return left.secondaryLayers.every((artifact, index) => artifactsEqual(artifact, right.secondaryLayers[index]));
}

function artifactsEqual(left: StageCompositionArtifact, right: StageCompositionArtifact | undefined): boolean {
  return Boolean(right)
    && left.artifactId === right?.artifactId
    && left.role === right?.role
    && left.loadOrder === right?.loadOrder
    && left.usdcUrl === right?.usdcUrl;
}

function cloneAttempt(attempt: StageBindingAttempt): StageBindingAttempt {
  return { ...attempt, composition: cloneComposition(attempt.composition) };
}

function snapshotActiveBinding(transaction: StageBindingBase): ActiveStageBindingSnapshot {
  return {
    bindingRevisionId: transaction.bindingRevisionId,
    principal: transaction.principal,
    leaseId: transaction.leaseId,
    sourceClientId: transaction.sourceClientId,
    composition: cloneComposition(transaction.composition),
  };
}

function cloneActiveBinding(snapshot: ActiveStageBindingSnapshot): ActiveStageBindingSnapshot {
  return {
    ...snapshot,
    composition: cloneComposition(snapshot.composition),
  };
}

function baseRecord(transaction: StageBindingRecord): StageBindingBase {
  return {
    stageBindingAuthorizationId: transaction.stageBindingAuthorizationId,
    bindingRevisionId: transaction.bindingRevisionId,
    sessionId: transaction.sessionId,
    principal: transaction.principal,
    leaseId: transaction.leaseId,
    sourceClientId: transaction.sourceClientId,
    ...(transaction.clientRequestId ? { clientRequestId: transaction.clientRequestId } : {}),
    composition: transaction.composition,
    createdAtMs: transaction.createdAtMs,
    pendingExpiresAtMs: transaction.pendingExpiresAtMs,
  };
}

function preauthorizationIntentKey(input: {
  sessionId: string;
  principal: string;
  leaseId: string;
  sourceClientId: string;
  clientRequestId: string;
}): string {
  return [
    input.sessionId,
    input.principal,
    input.leaseId,
    input.sourceClientId,
    input.clientRequestId,
  ].join("\u0000");
}

function cloneComposition(composition: StageComposition): StageComposition {
  return {
    primary: { ...composition.primary },
    secondaryLayers: composition.secondaryLayers.map((artifact) => ({ ...artifact })),
  };
}

function pendingView(transaction: PendingStageBinding): PendingStageBindingView {
  return {
    stageBindingAuthorizationId: transaction.stageBindingAuthorizationId,
    bindingRevisionId: transaction.bindingRevisionId,
    transactionStatus: "pending",
    composition: cloneComposition(transaction.composition),
    pendingExpiresAt: new Date(transaction.pendingExpiresAtMs).toISOString(),
  };
}

function completedAt(transaction: StageBindingRecord): number {
  return "completedAtMs" in transaction ? transaction.completedAtMs : Number.NEGATIVE_INFINITY;
}

function positiveBound(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && (value ?? 0) > 0 ? Math.floor(value as number) : fallback;
}
