import {
  StageBindingState,
  type StageBindingAttempt,
} from "./stageBindingState.js";
import { z } from "zod";

export interface RuntimeStageCompositionArtifact {
  artifactId: string;
  role: "primary" | "secondary";
  loadOrder: number;
  usdcUrl: string;
}

export interface RuntimeStageComposition {
  primary: RuntimeStageCompositionArtifact;
  secondaryLayers: RuntimeStageCompositionArtifact[];
}

export type RuntimeSessionStatus = "created" | "active" | "closing" | "closed" | "failed";

export interface RuntimeSessionArtifact {
  artifactId: string;
  readyStatus: string;
  usdcUrl: string | null;
}

export interface RuntimeSessionContext {
  sessionId: string;
  status: RuntimeSessionStatus;
  artifacts: RuntimeSessionArtifact[];
}

export interface RuntimeLease {
  leaseId: string;
  principal: string;
}

export type PrimaryLeaseDecision =
  | { authorized: true; lease: RuntimeLease }
  | { authorized: false };

export type RuntimeLeaseDecision =
  | { authorized: true; lease: RuntimeLease }
  | {
      authorized: false;
      reason:
        | "spectator_readonly"
        | "lease_invalid"
        | "session_lifecycle_blocked"
        | "unauthorized_source_client";
      detailCode: string;
    };

export interface RuntimeMutationAuthorityPorts {
  now(): number;
  generateId(prefix: "stage_auth" | "binding_rev"): string;
  getSessionContext(sessionId: string): RuntimeSessionContext | null;
  inspectPrimaryLease(input: {
    sessionId: string;
    sourceClientId: string;
    credential: string;
  }): PrimaryLeaseDecision;
  inspectRuntimeLease(input: {
    sessionId: string;
    sourceClientId: string;
    credential: string;
  }): RuntimeLeaseDecision;
  appendStageBindingApplied(input: {
    sessionId: string;
    stageBindingAuthorizationId: string;
    bindingRevisionId: string;
    requestId: string;
    sourceClientId: string;
    primaryArtifactId: string;
    secondaryArtifactIds: string[];
  }): void;
}

export interface RuntimeMutationAuthorityOptions {
  pendingTtlMs?: number;
  executingTtlMs?: number;
  completedRetentionMs?: number;
  maxNonTerminal?: number;
  maxCompleted?: number;
  maxCompletedPerSession?: number;
  maxActiveSessions?: number;
}

export interface StageBindingSelection {
  artifactId: string;
  role: "primary" | "secondary";
  loadOrder: number;
}

export interface PreauthorizeStageBindingInput {
  sessionId: string;
  principal: string;
  sourceClientId: string;
  credential: string;
  artifacts: StageBindingSelection[];
}

export type PreauthorizeStageBindingResult =
  | {
      ok: true;
      transactionStatus: "pending";
      stageBindingAuthorizationId: string;
      bindingRevisionId: string;
      composition: RuntimeStageComposition;
      pendingExpiresAt: string;
    }
  | {
      ok: false;
      reason:
        | "session_not_found"
        | "session_lifecycle_blocked"
        | "primary_lease_required"
        | "artifact_selection_invalid"
        | "artifact_unavailable"
        | "transaction_executing"
        | "capacity_exceeded";
    };

export interface AuthorizeRuntimeCommandInput {
  sessionId: string;
  sourceClientId: string;
  credential: string;
  requestId: string;
  requestedEventType: string;
  commandContext: Record<string, unknown>;
  stageBindingAuthorizationId?: string;
  bindingRevisionId?: string;
  stageComposition?: RuntimeStageComposition;
}

/** @internal Contract-test visibility; production code must not load the JSON fixture. */
export const RUNTIME_MUTATION_AUTHORITY_VOCABULARY = {
  version: 1,
  mutatingEventTypes: [
    "openStageRequest",
    "loadArtifactGroupRequest",
    "composeStageRequest",
    "highlightPrimsRequest",
    "focusPrimRequest",
    "clearHighlightRequest",
    "selectPrimsRequest",
    "makePrimsPickable",
    "resetStage",
  ],
  readonlyEventTypes: ["loadingStateQuery", "getChildrenRequest"],
  stageLoadEventTypes: ["openStageRequest", "loadArtifactGroupRequest"],
  harnessOnlyEventTypes: ["composeStageRequest"],
  rejectionReasons: [
    "spectator_readonly",
    "lease_invalid",
    "session_lifecycle_blocked",
    "unauthorized_source_client",
    "unsupported_command",
    "invalid_payload",
  ],
} as const;

export type RuntimeCommandRejectionReason =
  (typeof RUNTIME_MUTATION_AUTHORITY_VOCABULARY.rejectionReasons)[number];

export type AuthorizeRuntimeCommandResult =
  | { authorized: true; requestId: string; retryable: false }
  | {
      authorized: false;
      reason: RuntimeCommandRejectionReason;
      requestId: string;
      retryable: false;
      detailCode: string;
    };

export type FailStageBindingBeforeMutationResult =
  | {
      failed: true;
      requestId: string;
      transactionStatus: "failed";
      idempotentReplay: boolean;
    }
  | { failed: false; requestId: string; detailCode: string };

export interface ConfirmStageBindingInput {
  sessionId: string;
  credential: string;
  stageBindingAuthorizationId: string;
  bindingRevisionId: string;
  requestId: string;
  outcome: "success" | "failed";
}

export interface GetStageBindingSummaryQuery {
  sessionId: string;
  principal: string;
}

export interface GetActiveStageBindingQuery {
  sessionId: string;
  principal: string;
}

export interface StageBindingSummaryResult {
  transactionStatus: "pending" | "executing" | "active" | "failed" | "superseded" | "none";
  bindingRevisionId: string | null;
  activeBindingRevision: string | null;
  lastGoodBindingRevision: string | null;
}

export interface ActiveStageBindingResult {
  bindingRevisionId: string;
  principal: string;
  leaseId: string;
  sourceClientId: string;
  composition: RuntimeStageComposition;
}

export type ConfirmStageBindingResult =
  | {
      confirmed: true;
      requestId: string;
      bindingRevisionId: string;
      transactionStatus: "active" | "failed";
      activeBindingRevision: string | null;
      lastGoodBindingRevision: string | null;
      idempotentReplay: boolean;
    }
  | {
      confirmed: false;
      reason: "lease_invalid" | "session_lifecycle_blocked" | "invalid_payload";
      requestId: string;
      retryable: false;
      detailCode: string;
    };

const RUNTIME_MUTATOR_EVENT_TYPES = new Set<string>(
  RUNTIME_MUTATION_AUTHORITY_VOCABULARY.mutatingEventTypes,
);
const STAGE_LOAD_EVENT_TYPES = new Set<StageBindingAttempt["eventType"]>(
  RUNTIME_MUTATION_AUTHORITY_VOCABULARY.stageLoadEventTypes,
);
const HARNESS_ONLY_EVENT_TYPES = new Set<string>(
  RUNTIME_MUTATION_AUTHORITY_VOCABULARY.harnessOnlyEventTypes,
);
const runtimePrimPathSchema = z.string().trim().min(1).max(4096).refine((path) => path.startsWith("/"));
const runtimeHighlightItemSchema = z.object({ primPath: runtimePrimPathSchema }).passthrough();
const runtimeCommandContextSchemas: Record<string, z.ZodTypeAny> = {
  openStageRequest: z.object({}).strict(),
  loadArtifactGroupRequest: z.object({}).strict(),
  highlightPrimsRequest: z.object({
    mode: z.literal("replace"),
    items: z.array(runtimeHighlightItemSchema).min(1).max(4096),
    focusFirst: z.boolean(),
  }).strict(),
  focusPrimRequest: z.object({ primPath: runtimePrimPathSchema }).strict(),
  clearHighlightRequest: z.object({}).strict(),
  selectPrimsRequest: z.object({ paths: z.array(runtimePrimPathSchema).max(4096) }).strict(),
  makePrimsPickable: z.object({ paths: z.array(runtimePrimPathSchema).min(1).max(4096) }).strict(),
  resetStage: z.object({}).strict(),
};

export class RuntimeMutationAuthority {
  private readonly state: StageBindingState;

  constructor(
    private readonly ports: RuntimeMutationAuthorityPorts,
    options: RuntimeMutationAuthorityOptions = {},
  ) {
    this.state = new StageBindingState({
      ...options,
      clock: () => ports.now(),
      idFactory: (prefix) => ports.generateId(prefix),
    });
  }

  preauthorizeStageBinding(input: PreauthorizeStageBindingInput): PreauthorizeStageBindingResult {
    const session = this.ports.getSessionContext(input.sessionId);
    if (!session) return { ok: false, reason: "session_not_found" };
    if (session.status !== "created" && session.status !== "active") {
      return { ok: false, reason: "session_lifecycle_blocked" };
    }
    const leaseDecision = this.ports.inspectPrimaryLease({
      sessionId: session.sessionId,
      sourceClientId: input.sourceClientId,
      credential: input.credential,
    });
    if (!leaseDecision.authorized || leaseDecision.lease.principal !== input.principal) {
      return { ok: false, reason: "primary_lease_required" };
    }

    const artifactIds = new Set(input.artifacts.map((artifact) => artifact.artifactId));
    const loadOrders = new Set(input.artifacts.map((artifact) => artifact.loadOrder));
    const primarySelections = input.artifacts.filter((artifact) => artifact.role === "primary");
    if (
      artifactIds.size !== input.artifacts.length
      || loadOrders.size !== input.artifacts.length
      || primarySelections.length !== 1
    ) {
      return { ok: false, reason: "artifact_selection_invalid" };
    }

    const resolved = [...input.artifacts]
      .sort((left, right) => left.loadOrder - right.loadOrder)
      .map((selection) => {
        const artifact = session.artifacts.find((candidate) => candidate.artifactId === selection.artifactId);
        if (!artifact || artifact.readyStatus !== "ready" || !artifact.usdcUrl) return null;
        return {
          ...selection,
          usdcUrl: artifact.usdcUrl,
        };
      });
    if (resolved.some((artifact) => artifact === null)) {
      return { ok: false, reason: "artifact_unavailable" };
    }
    const artifacts = resolved.filter((artifact): artifact is NonNullable<typeof artifact> => artifact !== null);
    const primary = artifacts.find((artifact) => artifact.role === "primary");
    if (!primary) return { ok: false, reason: "artifact_selection_invalid" };
    const composition: RuntimeStageComposition = {
      primary: { ...primary, role: "primary" },
      secondaryLayers: artifacts
        .filter((artifact) => artifact.role === "secondary")
        .map((artifact) => ({ ...artifact, role: "secondary" })),
    };
    const created = this.state.createPending({
      sessionId: session.sessionId,
      principal: input.principal,
      leaseId: leaseDecision.lease.leaseId,
      sourceClientId: input.sourceClientId,
      composition,
    });
    if (!created.ok) return created;
    return { ok: true, ...created.transaction };
  }

  authorizeRuntimeCommand(input: AuthorizeRuntimeCommandInput): AuthorizeRuntimeCommandResult {
    const deny = (reason: RuntimeCommandRejectionReason, detailCode: string): AuthorizeRuntimeCommandResult => ({
      authorized: false,
      reason,
      requestId: input.requestId,
      retryable: false,
      detailCode,
    });
    const session = this.ports.getSessionContext(input.sessionId);
    if (!session) return deny("lease_invalid", "session_not_found");
    if (session.status !== "created" && session.status !== "active") {
      return deny("session_lifecycle_blocked", `session_${session.status}`);
    }
    if (!RUNTIME_MUTATOR_EVENT_TYPES.has(input.requestedEventType)) {
      return deny("unsupported_command", "event_not_in_mutator_catalog");
    }
    if (HARNESS_ONLY_EVENT_TYPES.has(input.requestedEventType)) {
      return deny("unsupported_command", "harness_only_command");
    }
    if (!isValidRuntimeCommandContext(input.requestedEventType, input.commandContext)) {
      return deny("invalid_payload", "runtime_command_context_invalid");
    }
    const leaseDecision = this.ports.inspectRuntimeLease({
      sessionId: session.sessionId,
      sourceClientId: input.sourceClientId,
      credential: input.credential,
    });
    if (!leaseDecision.authorized) return deny(leaseDecision.reason, leaseDecision.detailCode);

    const isStageLoad = STAGE_LOAD_EVENT_TYPES.has(input.requestedEventType as StageBindingAttempt["eventType"]);
    const hasAnyStageAuthority = Boolean(
      input.stageBindingAuthorizationId || input.bindingRevisionId || input.stageComposition,
    );
    if (!isStageLoad && hasAnyStageAuthority) {
      return deny("invalid_payload", "unexpected_stage_transaction");
    }
    if (isStageLoad) {
      if (!input.stageBindingAuthorizationId || !input.bindingRevisionId || !input.stageComposition) {
        return deny("invalid_payload", "stage_transaction_required");
      }
      const consumed = this.state.consume({
        sessionId: session.sessionId,
        stageBindingAuthorizationId: input.stageBindingAuthorizationId,
        bindingRevisionId: input.bindingRevisionId,
        leaseId: leaseDecision.lease.leaseId,
        sourceClientId: input.sourceClientId,
        requestId: input.requestId,
        eventType: input.requestedEventType as StageBindingAttempt["eventType"],
        composition: input.stageComposition,
      });
      if (!consumed.authorized) {
        return consumed.reason === "transaction_mismatch"
          ? deny("invalid_payload", "stage_transaction_mismatch")
          : deny("lease_invalid", `stage_${consumed.reason}`);
      }
    }
    return { authorized: true, requestId: input.requestId, retryable: false };
  }

  failStageBindingBeforeMutation(
    input: AuthorizeRuntimeCommandInput,
  ): FailStageBindingBeforeMutationResult {
    const isStageLoad = STAGE_LOAD_EVENT_TYPES.has(input.requestedEventType as StageBindingAttempt["eventType"]);
    if (!isStageLoad || !input.stageBindingAuthorizationId || !input.bindingRevisionId || !input.stageComposition) {
      return { failed: false, requestId: input.requestId, detailCode: "stage_transaction_required" };
    }
    const session = this.ports.getSessionContext(input.sessionId);
    if (!session) {
      return { failed: false, requestId: input.requestId, detailCode: "session_not_found" };
    }
    const leaseDecision = this.ports.inspectRuntimeLease({
      sessionId: session.sessionId,
      sourceClientId: input.sourceClientId,
      credential: input.credential,
    });
    if (!leaseDecision.authorized) {
      return { failed: false, requestId: input.requestId, detailCode: leaseDecision.detailCode };
    }
    const failed = this.state.failBeforeMutation({
      sessionId: session.sessionId,
      stageBindingAuthorizationId: input.stageBindingAuthorizationId,
      bindingRevisionId: input.bindingRevisionId,
      leaseId: leaseDecision.lease.leaseId,
      sourceClientId: input.sourceClientId,
      requestId: input.requestId,
      eventType: input.requestedEventType as StageBindingAttempt["eventType"],
      composition: input.stageComposition,
    });
    return failed.failed
      ? {
          failed: true,
          requestId: input.requestId,
          transactionStatus: "failed",
          idempotentReplay: failed.idempotentReplay,
        }
      : {
          failed: false,
          requestId: input.requestId,
          detailCode: `stage_${failed.reason}`,
        };
  }

  confirmStageBinding(input: ConfirmStageBindingInput): ConfirmStageBindingResult {
    const deny = (
      reason: Extract<ConfirmStageBindingResult, { confirmed: false }>["reason"],
      detailCode: string,
    ): ConfirmStageBindingResult => ({
      confirmed: false,
      reason,
      requestId: input.requestId,
      retryable: false,
      detailCode,
    });
    const session = this.ports.getSessionContext(input.sessionId);
    if (!session) return deny("lease_invalid", "session_not_found");
    if (session.status !== "created" && session.status !== "active") {
      return deny("session_lifecycle_blocked", `session_${session.status}`);
    }
    const context = this.state.confirmationContext(
      input.stageBindingAuthorizationId,
      session.sessionId,
      input.bindingRevisionId,
    );
    if (!context.found) {
      return context.reason === "transaction_mismatch"
        ? deny("invalid_payload", "stage_transaction_mismatch")
        : deny("lease_invalid", "stage_transaction_missing");
    }
    const leaseDecision = this.ports.inspectRuntimeLease({
      sessionId: session.sessionId,
      sourceClientId: context.sourceClientId,
      credential: input.credential,
    });
    if (
      !leaseDecision.authorized
      || leaseDecision.lease.leaseId !== context.leaseId
      || leaseDecision.lease.principal !== context.principal
    ) {
      return deny(
        "lease_invalid",
        leaseDecision.authorized ? "lease_principal_changed" : leaseDecision.detailCode,
      );
    }
    if (!context.attempt) return deny("invalid_payload", "stage_transaction_not_claimed");

    const completed = this.state.complete(
      { ...context.attempt, requestId: input.requestId, outcome: input.outcome },
      input.outcome === "success"
        ? () => this.ports.appendStageBindingApplied({
            sessionId: context.sessionId,
            stageBindingAuthorizationId: context.stageBindingAuthorizationId,
            bindingRevisionId: context.bindingRevisionId,
            requestId: input.requestId,
            sourceClientId: context.sourceClientId,
            primaryArtifactId: context.composition.primary.artifactId,
            secondaryArtifactIds: context.composition.secondaryLayers.map((artifact) => artifact.artifactId),
          })
        : undefined,
    );
    if (!completed.confirmed) {
      return completed.reason === "transaction_mismatch" || completed.reason === "completion_mismatch"
        ? deny("invalid_payload", `stage_${completed.reason}`)
        : deny("lease_invalid", `stage_${completed.reason}`);
    }
    return {
      confirmed: true,
      requestId: input.requestId,
      bindingRevisionId: context.bindingRevisionId,
      transactionStatus: completed.transactionStatus,
      activeBindingRevision: completed.activeBindingRevision,
      lastGoodBindingRevision: completed.lastGoodBindingRevision,
      idempotentReplay: completed.idempotentReplay,
    };
  }

  getStageBindingSummary(query: GetStageBindingSummaryQuery): StageBindingSummaryResult {
    return this.state.summary(query.sessionId, query.principal);
  }

  getActiveStageBinding(query: GetActiveStageBindingQuery): ActiveStageBindingResult | null {
    const active = this.state.activeBinding(query.sessionId, query.principal);
    if (!active) return null;
    return {
      bindingRevisionId: active.bindingRevisionId,
      principal: active.principal,
      leaseId: active.leaseId,
      sourceClientId: active.sourceClientId,
      composition: {
        primary: { ...active.composition.primary },
        secondaryLayers: active.composition.secondaryLayers.map((artifact) => ({ ...artifact })),
      },
    };
  }
}

function isValidRuntimeCommandContext(eventType: string, context: Record<string, unknown>): boolean {
  return runtimeCommandContextSchemas[eventType]?.safeParse(context).success ?? false;
}
