// Coordinator-owned active-result shadow state (rvt-ifc-usdc-lineage task 3.3).
//
// This sidecar deliberately does not copy artifact bytes, element mappings, alignment/report
// bodies, or cloud RBAC data. It persists only the identities, immutable manifest locator/digest,
// publication/attempt state, the single active pointer, and append-only activation audit needed
// for local orchestration and browser read models.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  PIPELINE_JOB_OWNER,
  PIPELINE_RESULT_SNAPSHOT_COMMITMENT_SCHEMA_VERSION,
  type PipelineResultSnapshotCommitment,
  type PipelineJobStore,
} from "./pipelineJobStore.js";
import {
  isAttemptScopedMinioResultLocation,
  isUtcTimestamp,
  utcTimestampToMicros,
} from "./minioLocator.js";

// v1 never shipped; activation intents and their decision-consumption ledger are part of the
// first reviewable persisted shape, named v2 so an older experimental file cannot be misread.
const STORE_SCHEMA_VERSION = "pipeline-result-state/v2";
export const PIPELINE_RESULT_DOCUMENT_SCHEMA_VERSION = "pipeline-job-attempt/v1";
export const PIPELINE_RESULT_INTENT_TTL_MS = 5 * 60 * 1_000;
const MAX_PENDING_ACTIVATION_INTENTS = 1_024;
const MAX_PENDING_ACTIVATION_INTENTS_PER_SUBJECT_JOB = 8;

export type AttemptOutcome =
  | "succeeded"
  | "succeeded_with_warnings"
  | "failed"
  | "cancelled";

export type SelectableAttemptOutcome = "succeeded" | "succeeded_with_warnings";
export type PublicationState = "UNPUBLISHED" | "PUBLISHING" | "AVAILABLE" | "INVALID";
export type ResultSelectionState = "candidate" | "active" | "historical" | null;
export type ActivationTransition = "first_activation" | "promote" | "rollback";
export type ActivationCapability = "result.promote" | "result.rollback" | null;

export interface PipelineResultRecord {
  result_id: string;
  attempt_id: string;
  pipeline_job_id: string;
  source_bundle_id: string;
  external_model_version_id: string;
  attempt_number: number;
  result_prefix: string;
  result_manifest_ref: string;
  result_manifest_digest: string;
  attempt_outcome: AttemptOutcome;
  publication_state: PublicationState;
  completed_at: string;
  registered_at: string;
}

export interface PipelineResultView extends PipelineResultRecord {
  selection_state: ResultSelectionState;
}

export interface ActiveResultPointer {
  pipeline_job_id: string;
  result_id: string;
  attempt_id: string;
  selection_state: "active";
  publication_state: "AVAILABLE";
  attempt_outcome: SelectableAttemptOutcome;
  audit_entry_id: string;
  activated_at: string;
  correlation_id: string;
}

export interface ActivationAuditEntry {
  audit_entry_id: string;
  pipeline_job_id: string;
  transition: ActivationTransition;
  from_result_id: string | null;
  to_result_id: string;
  target_result_evidence: {
    result_id: string;
    publication_state: PublicationState;
    attempt_outcome: AttemptOutcome;
    selection_state_before: "candidate" | "historical" | null;
  };
  capability: ActivationCapability;
  reason: string;
  actor: {
    actor_kind: "system" | "operator" | "service_account";
    actor_id: string;
  };
  authorization_decision_ref: string | null;
  correlation_id: string;
  occurred_at: string;
  append_only: true;
}

export interface ActiveResultPointerDocument {
  schema_version: typeof PIPELINE_RESULT_DOCUMENT_SCHEMA_VERSION;
  document_type: "active_result_pointer";
  body: ActiveResultPointer;
}

export interface ActivationAuditEntryDocument {
  schema_version: typeof PIPELINE_RESULT_DOCUMENT_SCHEMA_VERSION;
  document_type: "activation_audit_entry";
  body: ActivationAuditEntry;
}

export interface RegisterPipelineResultInput {
  result_id: string;
  attempt_id: string;
  pipeline_job_id: string;
  source_bundle_id: string;
  external_model_version_id: string;
  attempt_number: number;
  result_prefix: string;
  result_manifest_ref: string;
  result_manifest_digest: string;
  attempt_outcome: AttemptOutcome;
  publication_state: PublicationState;
  completed_at: string;
  /** Caller-supplied clock; the store never reads wall time. */
  now: string;
  /** Publication/attempt correlation used by the automatic first-activation audit. */
  correlation_id: string;
}

export interface RegisterPipelineResultOutcome {
  result: PipelineResultView;
  replay: boolean;
  active_result_pointer: ActiveResultPointer | null;
  activation_audit_entry: ActivationAuditEntry | null;
}

export interface ComparablePipelineResults {
  left: PipelineResultView;
  right: PipelineResultView;
}

export type PipelineResultActivationIntentState =
  | "pending"
  | "committed"
  | "rejected_stale";

export interface VerifiedExternalResultDecision {
  authorization_decision_ref: string;
  issuer: string;
  audience: string;
  subject: string;
  capability: "result.promote" | "result.rollback";
  /** Raw issuer decision id. It is accepted only from the verifier and never persisted. */
  jti: string;
  issued_at: string;
  not_before: string;
  expires_at: string;
  verified_at: string;
}

export interface PipelineResultDecisionProvenance {
  authorization_decision_ref: string;
  issuer: string;
  audience: string;
  subject: string;
  capability: "result.promote" | "result.rollback";
  /** Domain-separated hash of issuer/audience/capability/jti; raw jti is never persisted. */
  decision_replay_key_sha256: string;
  issued_at: string;
  not_before: string;
  expires_at: string;
  verified_at: string;
}

export interface PipelineResultActivationIntent {
  intent_id: string;
  pipeline_job_id: string;
  target_result_id: string;
  expected_active_result_id: string;
  transition: "promote" | "rollback";
  capability: "result.promote" | "result.rollback";
  reason: string;
  actor: {
    actor_kind: "operator" | "service_account";
    actor_id: string;
  };
  correlation_id: string;
  /** Hash of the server-generated challenge. The raw nonce is returned once and never persisted. */
  intent_nonce_sha256: string;
  created_at: string;
  expires_at: string;
  state: PipelineResultActivationIntentState;
  decision: PipelineResultDecisionProvenance | null;
  audit_entry_id: string | null;
  completed_at: string | null;
  /** Captured only for terminal stale rejection; null for pending/committed intents. */
  observed_active_result_id: string | null;
}

export interface CreatePipelineResultActivationIntentInput {
  intent_id: string;
  /** CSPRNG challenge generated by the route; the store persists only its SHA-256. */
  intent_nonce: string;
  pipeline_job_id: string;
  target_result_id: string;
  expected_active_result_id: string;
  transition: "promote" | "rollback";
  capability: "result.promote" | "result.rollback";
  reason: string;
  actor: {
    actor_kind: "operator" | "service_account";
    actor_id: string;
  };
  correlation_id: string;
  created_at: string;
  expires_at: string;
}

export interface CreatePipelineResultActivationIntentOutcome {
  replay: boolean;
  intent: PipelineResultActivationIntent;
}

export interface ConfirmPipelineResultActivationIntentInput {
  intent_id: string;
  /** Normalized, trusted output from ExternalLineageAuthorizationPort. */
  decision: VerifiedExternalResultDecision;
  /** Server clock used for the guarded commit; must equal decision.verified_at. */
  now: string;
}

export type ConfirmPipelineResultActivationIntentOutcome =
  | {
      outcome: "committed";
      replay: boolean;
      intent: PipelineResultActivationIntent;
      active_result_pointer: ActiveResultPointer;
      activation_audit_entry: ActivationAuditEntry;
    }
  | {
      outcome: "rejected_stale";
      replay: boolean;
      intent: PipelineResultActivationIntent;
      observed_active_result_id: string | null;
    };

interface PersistedPipelineResultState {
  schema_version: typeof STORE_SCHEMA_VERSION;
  revision: number;
  results: PipelineResultRecord[];
  active_result_pointers: ActiveResultPointer[];
  activation_audit: ActivationAuditEntry[];
  activation_intents: PipelineResultActivationIntent[];
}

export class PipelineResultInvariantError extends Error {
  readonly code = "pipeline_result_invariant_violation";

  constructor(detail: string) {
    super(detail);
    this.name = "PipelineResultInvariantError";
  }
}

export class PipelineResultCompareInvariantError extends PipelineResultInvariantError {
  readonly reason: "compare_cross_job_rejected" | "compare_non_selectable";

  constructor(
    reason: PipelineResultCompareInvariantError["reason"],
    detail: string,
  ) {
    super(detail);
    this.name = "PipelineResultCompareInvariantError";
    this.reason = reason;
  }
}

export class PipelineResultActivationTargetInvariantError extends PipelineResultInvariantError {
  readonly reason: "activation_target_not_selectable" | "selection_state_mismatch";

  constructor(
    reason: PipelineResultActivationTargetInvariantError["reason"],
    detail: string,
  ) {
    super(detail);
    this.name = "PipelineResultActivationTargetInvariantError";
    this.reason = reason;
  }
}

export class PipelineResultConflictError extends Error {
  readonly code: string = "pipeline_result_conflict";

  constructor(detail: string) {
    super(detail);
    this.name = "PipelineResultConflictError";
  }
}

export class PipelineResultRevisionConflictError extends PipelineResultConflictError {
  override readonly code = "pipeline_result_revision_conflict";

  constructor(expectedRevision: number, observedRevision: number | null) {
    super(
      `pipeline result sidecar revision changed: expected ${expectedRevision}, observed ${observedRevision ?? "missing"}`,
    );
    this.name = "PipelineResultRevisionConflictError";
  }
}

export class PipelineResultStateUnavailableError extends Error {
  readonly code = "pipeline_result_state_unavailable";

  constructor(detail: string) {
    super(detail);
    this.name = "PipelineResultStateUnavailableError";
  }
}

export class PipelineResultAuthorizationError extends Error {
  readonly code = "stale_or_missing_authorization_decision";

  constructor(detail: string) {
    super(detail);
    this.name = "PipelineResultAuthorizationError";
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sameSnapshotCommitment(
  left: PipelineResultSnapshotCommitment | null,
  right: PipelineResultSnapshotCommitment,
): boolean {
  return (
    left !== null &&
    left.revision === right.revision &&
    left.snapshot_sha256 === right.snapshot_sha256
  );
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isAttemptOutcome(value: unknown): value is AttemptOutcome {
  return (
    value === "succeeded" ||
    value === "succeeded_with_warnings" ||
    value === "failed" ||
    value === "cancelled"
  );
}

function isPublicationState(value: unknown): value is PublicationState {
  return (
    value === "UNPUBLISHED" ||
    value === "PUBLISHING" ||
    value === "AVAILABLE" ||
    value === "INVALID"
  );
}

function isPipelineResultRecord(value: unknown): value is PipelineResultRecord {
  if (!isPlainObject(value)) return false;
  return (
    isNonEmptyString(value.result_id) &&
    isNonEmptyString(value.attempt_id) &&
    isNonEmptyString(value.pipeline_job_id) &&
    isNonEmptyString(value.source_bundle_id) &&
    isNonEmptyString(value.external_model_version_id) &&
    typeof value.attempt_number === "number" &&
    Number.isInteger(value.attempt_number) &&
    value.attempt_number >= 1 &&
    isNonEmptyString(value.result_prefix) &&
    isNonEmptyString(value.result_manifest_ref) &&
    isAttemptScopedMinioResultLocation({
      resultPrefix: value.result_prefix,
      attemptId: value.attempt_id,
      manifestRef: value.result_manifest_ref,
    }) &&
    typeof value.result_manifest_digest === "string" &&
    /^[0-9a-f]{64}$/.test(value.result_manifest_digest) &&
    isAttemptOutcome(value.attempt_outcome) &&
    isPublicationState(value.publication_state) &&
    isNonEmptyString(value.completed_at) &&
    isNonEmptyString(value.registered_at)
  );
}

function isActiveResultPointer(value: unknown): value is ActiveResultPointer {
  if (!isPlainObject(value)) return false;
  return (
    isNonEmptyString(value.pipeline_job_id) &&
    isNonEmptyString(value.result_id) &&
    isNonEmptyString(value.attempt_id) &&
    value.selection_state === "active" &&
    value.publication_state === "AVAILABLE" &&
    (value.attempt_outcome === "succeeded" ||
      value.attempt_outcome === "succeeded_with_warnings") &&
    isNonEmptyString(value.audit_entry_id) &&
    isNonEmptyString(value.activated_at) &&
    isNonEmptyString(value.correlation_id)
  );
}

function isActivationAuditEntry(value: unknown): value is ActivationAuditEntry {
  if (!isPlainObject(value) || !isPlainObject(value.target_result_evidence)) return false;
  if (!isPlainObject(value.actor)) return false;
  const evidence = value.target_result_evidence;
  const actor = value.actor;
  return (
    isNonEmptyString(value.audit_entry_id) &&
    isNonEmptyString(value.pipeline_job_id) &&
    (value.transition === "first_activation" ||
      value.transition === "promote" ||
      value.transition === "rollback") &&
    (value.from_result_id === null || isNonEmptyString(value.from_result_id)) &&
    isNonEmptyString(value.to_result_id) &&
    isNonEmptyString(evidence.result_id) &&
    isPublicationState(evidence.publication_state) &&
    isAttemptOutcome(evidence.attempt_outcome) &&
    (evidence.selection_state_before === null ||
      evidence.selection_state_before === "candidate" ||
      evidence.selection_state_before === "historical") &&
    (value.capability === null ||
      value.capability === "result.promote" ||
      value.capability === "result.rollback") &&
    isNonEmptyString(value.reason) &&
    (actor.actor_kind === "system" ||
      actor.actor_kind === "operator" ||
      actor.actor_kind === "service_account") &&
    isNonEmptyString(actor.actor_id) &&
    (value.authorization_decision_ref === null ||
      isNonEmptyString(value.authorization_decision_ref)) &&
    isNonEmptyString(value.correlation_id) &&
    isNonEmptyString(value.occurred_at) &&
    value.append_only === true
  );
}

function isDecisionProvenance(value: unknown): value is PipelineResultDecisionProvenance {
  if (!isPlainObject(value)) return false;
  return (
    isNonEmptyString(value.authorization_decision_ref) &&
    isNonEmptyString(value.issuer) &&
    isNonEmptyString(value.audience) &&
    isNonEmptyString(value.subject) &&
    (value.capability === "result.promote" || value.capability === "result.rollback") &&
    typeof value.decision_replay_key_sha256 === "string" &&
    /^[0-9a-f]{64}$/.test(value.decision_replay_key_sha256) &&
    isUtcTimestamp(value.issued_at) &&
    isUtcTimestamp(value.not_before) &&
    isUtcTimestamp(value.expires_at) &&
    isUtcTimestamp(value.verified_at)
  );
}

function isActivationIntent(value: unknown): value is PipelineResultActivationIntent {
  if (!isPlainObject(value) || !isPlainObject(value.actor)) return false;
  const actor = value.actor;
  return (
    isNonEmptyString(value.intent_id) &&
    isNonEmptyString(value.pipeline_job_id) &&
    isNonEmptyString(value.target_result_id) &&
    isNonEmptyString(value.expected_active_result_id) &&
    (value.transition === "promote" || value.transition === "rollback") &&
    (value.capability === "result.promote" || value.capability === "result.rollback") &&
    isNonEmptyString(value.reason) &&
    (actor.actor_kind === "operator" || actor.actor_kind === "service_account") &&
    isNonEmptyString(actor.actor_id) &&
    isNonEmptyString(value.correlation_id) &&
    typeof value.intent_nonce_sha256 === "string" &&
    /^[0-9a-f]{64}$/.test(value.intent_nonce_sha256) &&
    isUtcTimestamp(value.created_at) &&
    isUtcTimestamp(value.expires_at) &&
    (value.state === "pending" ||
      value.state === "committed" ||
      value.state === "rejected_stale") &&
    (value.decision === null || isDecisionProvenance(value.decision)) &&
    (value.audit_entry_id === null || isNonEmptyString(value.audit_entry_id)) &&
    (value.completed_at === null || isUtcTimestamp(value.completed_at)) &&
    (value.observed_active_result_id === null ||
      isNonEmptyString(value.observed_active_result_id))
  );
}

function cloneResult(record: PipelineResultRecord): PipelineResultRecord {
  return { ...record };
}

function clonePointer(pointer: ActiveResultPointer): ActiveResultPointer {
  return { ...pointer };
}

function cloneAudit(entry: ActivationAuditEntry): ActivationAuditEntry {
  return {
    ...entry,
    target_result_evidence: { ...entry.target_result_evidence },
    actor: { ...entry.actor },
  };
}

function cloneIntent(intent: PipelineResultActivationIntent): PipelineResultActivationIntent {
  return {
    ...intent,
    actor: { ...intent.actor },
    decision: intent.decision ? { ...intent.decision } : null,
  };
}

function activationAuditIdFor(pipelineJobId: string, resultId: string): string {
  const digest = crypto
    .createHash("sha256")
    .update(`${STORE_SCHEMA_VERSION}|first_activation|${pipelineJobId}|${resultId}`, "utf-8")
    .digest("hex");
  return `audit_${digest.slice(0, 32)}`;
}

function protectedActivationAuditIdFor(intentId: string): string {
  const digest = crypto
    .createHash("sha256")
    .update(`${STORE_SCHEMA_VERSION}|protected_activation|${intentId}`, "utf-8")
    .digest("hex");
  return `audit_${digest.slice(0, 32)}`;
}

function sha256Text(value: string): string {
  return crypto.createHash("sha256").update(value, "utf-8").digest("hex");
}

function decisionReplayKeySha256(decision: VerifiedExternalResultDecision): string {
  return sha256Text(
    // JTI is issuer/audience-global one-time state. Capability remains exact-bound elsewhere but
    // must not split the replay ledger into separately consumable promote/rollback namespaces.
    `${STORE_SCHEMA_VERSION}|external_decision|${decision.issuer}|${decision.audience}|${decision.jti}`,
  );
}

interface PipelineResultLockMetadata {
  schema_version: "pipeline-result-lock/v1";
  pid: number;
  created_at_ms: number;
}

function isLockMetadata(value: unknown): value is PipelineResultLockMetadata {
  return (
    isPlainObject(value) &&
    value.schema_version === "pipeline-result-lock/v1" &&
    typeof value.pid === "number" &&
    Number.isSafeInteger(value.pid) &&
    value.pid > 0 &&
    typeof value.created_at_ms === "number" &&
    Number.isSafeInteger(value.created_at_ms) &&
    value.created_at_ms > 0
  );
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

function validateResultLocation(input: Pick<
  RegisterPipelineResultInput,
  "result_prefix" | "attempt_id" | "result_manifest_ref"
>): void {
  if (
    !isAttemptScopedMinioResultLocation({
      resultPrefix: input.result_prefix,
      attemptId: input.attempt_id,
      manifestRef: input.result_manifest_ref,
    })
  ) {
    throw new PipelineResultInvariantError(
      "result location must be an attempt-scoped prefix with a versioned manifest inside it",
    );
  }
}

function sameImmutableResult(
  existing: PipelineResultRecord,
  input: RegisterPipelineResultInput,
): boolean {
  return (
    existing.result_id === input.result_id &&
    existing.attempt_id === input.attempt_id &&
    existing.pipeline_job_id === input.pipeline_job_id &&
    existing.source_bundle_id === input.source_bundle_id &&
    existing.external_model_version_id === input.external_model_version_id &&
    existing.attempt_number === input.attempt_number &&
    existing.result_prefix === input.result_prefix &&
    existing.result_manifest_ref === input.result_manifest_ref &&
    existing.result_manifest_digest === input.result_manifest_digest &&
    existing.attempt_outcome === input.attempt_outcome &&
    existing.publication_state === input.publication_state &&
    existing.completed_at === input.completed_at
  );
}

export function isSelectableResult(
  result: Pick<PipelineResultRecord, "publication_state" | "attempt_outcome">,
): result is Pick<PipelineResultRecord, "publication_state" | "attempt_outcome"> & {
  publication_state: "AVAILABLE";
  attempt_outcome: SelectableAttemptOutcome;
} {
  return (
    result.publication_state === "AVAILABLE" &&
    (result.attempt_outcome === "succeeded" ||
      result.attempt_outcome === "succeeded_with_warnings")
  );
}

/**
 * Durable result identity/pointer/audit sidecar. PipelineJobStore remains the stable logical-job
 * authority; this store validates every result against that job but never rewrites its 3.2 file.
 */
export class PipelineResultStore {
  private results = new Map<string, PipelineResultRecord>();
  private resultIdByAttempt = new Map<string, string>();
  private activePointers = new Map<string, ActiveResultPointer>();
  private activationAudit: ActivationAuditEntry[] = [];
  private activationIntents = new Map<string, PipelineResultActivationIntent>();
  private revision = 0;
  private unavailableReason: string | null = null;

  constructor(
    private readonly jobs: Pick<
      PipelineJobStore,
      | "get"
      | "getPipelineResultSnapshotCommitmentState"
      | "commitPipelineResultSnapshot"
      | "preparePipelineResultSnapshot"
      | "promotePipelineResultSnapshot"
      | "abortPipelineResultSnapshot"
    >,
    private readonly persistencePath: string | null = null,
  ) {
    this.load();
  }

  assertAvailable(): void {
    if (this.unavailableReason !== null) {
      throw new PipelineResultStateUnavailableError(this.unavailableReason);
    }
  }

  private load(): void {
    if (!this.persistencePath) return;
    const commitmentState = this.jobs.getPipelineResultSnapshotCommitmentState();
    if (!fs.existsSync(this.persistencePath)) {
      if (commitmentState.current) {
        this.unavailableReason =
          "pipeline result sidecar is missing after durable initialization";
      } else if (commitmentState.pending) {
        try {
          // Crash after prepare on the first snapshot, before the sidecar existed.
          this.jobs.abortPipelineResultSnapshot(commitmentState.pending);
        } catch (error) {
          this.unavailableReason =
            error instanceof Error
              ? `pipeline result pending commitment recovery failed: ${error.message}`
              : "pipeline result pending commitment recovery failed";
        }
      }
      return;
    }
    try {
      const raw = fs.readFileSync(this.persistencePath, "utf-8");
      const parsed = JSON.parse(raw) as unknown;
      const snapshot = this.validateSnapshot(parsed);
      const observedCommitment: PipelineResultSnapshotCommitment = {
        schema_version: PIPELINE_RESULT_SNAPSHOT_COMMITMENT_SCHEMA_VERSION,
        revision: snapshot.revision,
        snapshot_sha256: crypto.createHash("sha256").update(raw, "utf8").digest("hex"),
      };
      if (commitmentState.pending) {
        if (sameSnapshotCommitment(commitmentState.pending, observedCommitment)) {
          // Crash after atomic sidecar replace, before the pending marker was promoted.
          this.jobs.promotePipelineResultSnapshot(commitmentState.pending);
        } else if (
          commitmentState.current &&
          sameSnapshotCommitment(commitmentState.current, observedCommitment)
        ) {
          // Crash after prepare, before atomic sidecar replace.
          this.jobs.abortPipelineResultSnapshot(commitmentState.pending);
        } else {
          throw new Error(
            "durable result snapshot matches neither current nor pending commitment",
          );
        }
      } else if (
        commitmentState.current &&
        !sameSnapshotCommitment(commitmentState.current, observedCommitment)
      ) {
        throw new Error("durable result snapshot commitment does not match sidecar bytes");
      } else if (!commitmentState.current) {
        // Controlled one-time migration for a fully validated pre-commitment sidecar.
        this.jobs.commitPipelineResultSnapshot(observedCommitment);
      }
      this.revision = snapshot.revision;
      this.results = new Map(snapshot.results.map((result) => [result.result_id, result]));
      this.resultIdByAttempt = new Map(
        snapshot.results.map((result) => [result.attempt_id, result.result_id]),
      );
      this.activePointers = new Map(
        snapshot.active_result_pointers.map((pointer) => [pointer.pipeline_job_id, pointer]),
      );
      this.activationAudit = snapshot.activation_audit;
      this.activationIntents = new Map(
        snapshot.activation_intents.map((intent) => [intent.intent_id, intent]),
      );
    } catch (error) {
      this.unavailableReason =
        error instanceof Error
          ? `pipeline result sidecar failed validation: ${error.message}`
          : "pipeline result sidecar failed validation";
    }
  }

  private validateSnapshot(value: unknown): PersistedPipelineResultState {
    if (!isPlainObject(value) || value.schema_version !== STORE_SCHEMA_VERSION) {
      throw new Error("unexpected schema_version");
    }
    if (
      typeof value.revision !== "number" ||
      !Number.isInteger(value.revision) ||
      value.revision < 0
    ) {
      throw new Error("invalid revision");
    }
    if (
      !Array.isArray(value.results) ||
      !value.results.every(isPipelineResultRecord) ||
      !Array.isArray(value.active_result_pointers) ||
      !value.active_result_pointers.every(isActiveResultPointer) ||
      !Array.isArray(value.activation_audit) ||
      !value.activation_audit.every(isActivationAuditEntry) ||
      !Array.isArray(value.activation_intents) ||
      !value.activation_intents.every(isActivationIntent)
    ) {
      throw new Error("invalid result/pointer/audit shape");
    }

    const results = value.results.map(cloneResult);
    const resultById = new Map<string, PipelineResultRecord>();
    const resultByAttempt = new Map<string, string>();
    for (const result of results) {
      if (resultById.has(result.result_id)) throw new Error("duplicate result_id");
      if (resultByAttempt.has(result.attempt_id)) throw new Error("duplicate attempt_id");
      const job = this.jobs.get(result.pipeline_job_id);
      if (!job) throw new Error(`orphan result ${result.result_id}`);
      if (
        job.source_bundle_id !== result.source_bundle_id ||
        job.external_model_version_id !== result.external_model_version_id
      ) {
        throw new Error(`result ${result.result_id} identity does not match its pipeline job`);
      }
      resultById.set(result.result_id, result);
      resultByAttempt.set(result.attempt_id, result.result_id);
    }

    const audit = value.activation_audit.map(cloneAudit);
    const auditById = new Map<string, ActivationAuditEntry>();
    for (const entry of audit) {
      if (auditById.has(entry.audit_entry_id)) throw new Error("duplicate audit_entry_id");
      const target = resultById.get(entry.to_result_id);
      if (!target || target.pipeline_job_id !== entry.pipeline_job_id) {
        throw new Error(`orphan activation audit ${entry.audit_entry_id}`);
      }
      if (
        entry.target_result_evidence.result_id !== target.result_id ||
        entry.target_result_evidence.publication_state !== target.publication_state ||
        entry.target_result_evidence.attempt_outcome !== target.attempt_outcome
      ) {
        throw new Error(`activation audit ${entry.audit_entry_id} evidence drift`);
      }
      if (entry.from_result_id !== null) {
        const from = resultById.get(entry.from_result_id);
        if (
          !from ||
          from.pipeline_job_id !== entry.pipeline_job_id ||
          !isSelectableResult(from) ||
          from.result_id === target.result_id
        ) {
          throw new Error(`activation audit ${entry.audit_entry_id} has invalid from_result_id`);
        }
      }
      if (entry.transition === "first_activation") {
        if (
          entry.from_result_id !== null ||
          entry.capability !== null ||
          entry.actor.actor_kind !== "system" ||
          entry.authorization_decision_ref !== null ||
          entry.target_result_evidence.selection_state_before !== null
        ) {
          throw new Error(`invalid first activation audit ${entry.audit_entry_id}`);
        }
      } else {
        const expectedCapability =
          entry.transition === "promote" ? "result.promote" : "result.rollback";
        if (
          entry.from_result_id === null ||
          entry.capability !== expectedCapability ||
          entry.actor.actor_kind === "system" ||
          entry.authorization_decision_ref === null
        ) {
          throw new Error(`invalid protected activation audit ${entry.audit_entry_id}`);
        }
      }
      auditById.set(entry.audit_entry_id, entry);
    }

    // Rebuild each job's pointer history from append order. This proves every non-null `from`
    // was the active result at that transition and distinguishes candidate promote from
    // historical rollback; a shape-valid but forged audit chain must not load.
    const replayedActive = new Map<string, string>();
    const activatedByJob = new Map<string, Set<string>>();
    for (const entry of audit) {
      const activated = activatedByJob.get(entry.pipeline_job_id) ?? new Set<string>();
      const priorActive = replayedActive.get(entry.pipeline_job_id) ?? null;
      if (entry.transition === "first_activation") {
        if (priorActive !== null || activated.has(entry.to_result_id)) {
          throw new Error(`duplicate first activation for ${entry.pipeline_job_id}`);
        }
      } else {
        if (priorActive !== entry.from_result_id) {
          throw new Error(
            `activation audit ${entry.audit_entry_id} does not continue pointer history`,
          );
        }
        const targetWasHistorical = activated.has(entry.to_result_id);
        if (
          (entry.transition === "promote" && targetWasHistorical) ||
          (entry.transition === "rollback" && !targetWasHistorical)
        ) {
          throw new Error(
            `activation audit ${entry.audit_entry_id} transition kind is inconsistent`,
          );
        }
      }
      activated.add(entry.to_result_id);
      activatedByJob.set(entry.pipeline_job_id, activated);
      replayedActive.set(entry.pipeline_job_id, entry.to_result_id);
    }

    const pointers = value.active_result_pointers.map(clonePointer);
    const pointerJobs = new Set<string>();
    for (const pointer of pointers) {
      if (pointerJobs.has(pointer.pipeline_job_id)) throw new Error("duplicate active pointer");
      const result = resultById.get(pointer.result_id);
      const auditEntry = auditById.get(pointer.audit_entry_id);
      if (
        !result ||
        !isSelectableResult(result) ||
        result.pipeline_job_id !== pointer.pipeline_job_id ||
        result.attempt_id !== pointer.attempt_id ||
        result.attempt_outcome !== pointer.attempt_outcome ||
        !auditEntry ||
        auditEntry.pipeline_job_id !== pointer.pipeline_job_id ||
        auditEntry.to_result_id !== pointer.result_id ||
        auditEntry.occurred_at !== pointer.activated_at ||
        auditEntry.correlation_id !== pointer.correlation_id ||
        replayedActive.get(pointer.pipeline_job_id) !== pointer.result_id
      ) {
        throw new Error(
          `active pointer for ${pointer.pipeline_job_id} is not referentially complete`,
        );
      }
      pointerJobs.add(pointer.pipeline_job_id);
    }
    for (const pipelineJobId of replayedActive.keys()) {
      if (!pointerJobs.has(pipelineJobId)) {
        throw new Error(`activation history for ${pipelineJobId} has no active pointer`);
      }
    }

    const intents = value.activation_intents.map(cloneIntent);
    const intentIds = new Set<string>();
    const consumedDecisionKeys = new Set<string>();
    for (const intent of intents) {
      if (intentIds.has(intent.intent_id)) throw new Error("duplicate activation intent_id");
      intentIds.add(intent.intent_id);
      const target = resultById.get(intent.target_result_id);
      if (!target || target.pipeline_job_id !== intent.pipeline_job_id) {
        throw new Error(`orphan activation intent ${intent.intent_id}`);
      }
      const expectedCapability =
        intent.transition === "promote" ? "result.promote" : "result.rollback";
      const createdAt = utcTimestampToMicros(intent.created_at);
      const expiresAt = utcTimestampToMicros(intent.expires_at);
      if (
        intent.capability !== expectedCapability ||
        expiresAt <= createdAt ||
        expiresAt - createdAt > BigInt(PIPELINE_RESULT_INTENT_TTL_MS) * 1_000n
      ) {
        throw new Error(`invalid activation intent binding ${intent.intent_id}`);
      }
      if (intent.state === "pending") {
        if (
          intent.decision !== null ||
          intent.audit_entry_id !== null ||
          intent.completed_at !== null ||
          intent.observed_active_result_id !== null
        ) {
          throw new Error(
            `pending activation intent ${intent.intent_id} has terminal evidence`,
          );
        }
        continue;
      }
      if (!intent.decision || !intent.completed_at) {
        throw new Error(
          `terminal activation intent ${intent.intent_id} lacks decision evidence`,
        );
      }
      if (
        intent.decision.subject !== intent.actor.actor_id ||
        intent.decision.capability !== intent.capability ||
        consumedDecisionKeys.has(intent.decision.decision_replay_key_sha256)
      ) {
        throw new Error(
          `activation intent ${intent.intent_id} decision evidence is invalid`,
        );
      }
      consumedDecisionKeys.add(intent.decision.decision_replay_key_sha256);
      if (intent.state === "committed") {
        const entry = intent.audit_entry_id
          ? auditById.get(intent.audit_entry_id)
          : undefined;
        if (
          !entry ||
          entry.pipeline_job_id !== intent.pipeline_job_id ||
          entry.transition !== intent.transition ||
          entry.from_result_id !== intent.expected_active_result_id ||
          entry.to_result_id !== intent.target_result_id ||
          entry.capability !== intent.capability ||
          entry.authorization_decision_ref !== intent.decision.authorization_decision_ref ||
          entry.actor.actor_id !== intent.actor.actor_id
        ) {
          throw new Error(
            `committed activation intent ${intent.intent_id} audit drift`,
          );
        }
        if (intent.observed_active_result_id !== null) {
          throw new Error(
            `committed activation intent ${intent.intent_id} has stale evidence`,
          );
        }
      } else if (
        intent.audit_entry_id !== null ||
        intent.observed_active_result_id === intent.expected_active_result_id
      ) {
        throw new Error(
          `stale activation intent ${intent.intent_id} must not cite an audit`,
        );
      }
    }

    return {
      schema_version: STORE_SCHEMA_VERSION,
      revision: value.revision,
      results,
      active_result_pointers: pointers,
      activation_audit: audit,
      activation_intents: intents,
    };
  }

  private persistedRevision(): number | null {
    if (!this.persistencePath || !fs.existsSync(this.persistencePath)) return null;
    try {
      const parsed = JSON.parse(
        fs.readFileSync(this.persistencePath, "utf-8"),
      ) as unknown;
      if (!isPlainObject(parsed) || typeof parsed.revision !== "number") {
        throw new Error("missing revision");
      }
      return parsed.revision;
    } catch (error) {
      throw new PipelineResultStateUnavailableError(
        `cannot verify pipeline result sidecar revision: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private writeLockMetadata(fd: number): void {
    const metadata: PipelineResultLockMetadata = {
      schema_version: "pipeline-result-lock/v1",
      pid: process.pid,
      created_at_ms: Date.now(),
    };
    fs.writeFileSync(fd, JSON.stringify(metadata), "utf-8");
    fs.fsyncSync(fd);
  }

  private openFreshWriteLock(lockPath: string): number {
    const fd = fs.openSync(lockPath, "wx", 0o600);
    try {
      this.writeLockMetadata(fd);
      return fd;
    } catch (error) {
      fs.closeSync(fd);
      // Leave the unverifiable lock fail-closed; deleting after close could race a replacement.
      throw error;
    }
  }

  private acquireWriteLock(lockPath: string): number {
    try {
      return this.openFreshWriteLock(lockPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        throw new PipelineResultStateUnavailableError(
          `pipeline result sidecar write lock is unavailable: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    let metadata: PipelineResultLockMetadata;
    try {
      const parsed = JSON.parse(fs.readFileSync(lockPath, "utf-8")) as unknown;
      if (!isLockMetadata(parsed)) throw new Error("invalid lock owner metadata");
      metadata = parsed;
    } catch (error) {
      throw new PipelineResultStateUnavailableError(
        `pipeline result sidecar lock owner cannot be verified: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    if (processIsAlive(metadata.pid)) {
      throw new PipelineResultStateUnavailableError(
        `pipeline result sidecar is locked by active pid ${metadata.pid}`,
      );
    }

    // Atomically claim the dead owner's lock before creating our own. A concurrent recovery or
    // writer makes rename/open fail closed; invalid/active locks are never auto-deleted.
    const stalePath = `${lockPath}.stale-${metadata.pid}-${crypto
      .randomBytes(8)
      .toString("hex")}`;
    try {
      fs.renameSync(lockPath, stalePath);
      return this.openFreshWriteLock(lockPath);
    } catch (error) {
      throw new PipelineResultStateUnavailableError(
        `pipeline result stale lock recovery lost CAS: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    } finally {
      if (fs.existsSync(stalePath)) fs.unlinkSync(stalePath);
    }
  }

  private persistState(
    results: Map<string, PipelineResultRecord>,
    activePointers: Map<string, ActiveResultPointer>,
    activationAudit: ActivationAuditEntry[],
    activationIntents: Map<string, PipelineResultActivationIntent> = this.activationIntents,
  ): number {
    const nextRevision = this.revision + 1;
    if (!this.persistencePath) return nextRevision;
    fs.mkdirSync(path.dirname(this.persistencePath), { recursive: true });
    const lockPath = `${this.persistencePath}.lock`;
    const lockFd = this.acquireWriteLock(lockPath);

    const tmpPath = `${this.persistencePath}.tmp-${process.pid}-${crypto
      .randomBytes(8)
      .toString("hex")}`;
    let tmpFd: number | null = null;
    let preparedCommitment: PipelineResultSnapshotCommitment | null = null;
    let sidecarReplaced = false;
    try {
      // The revision check occurs while holding the process-shared exclusive lock. This closes
      // the check/write race between two coordinator processes using the same sidecar.
      const observedRevision = this.persistedRevision();
      const expectedObservedRevision = this.revision === 0 ? null : this.revision;
      if (observedRevision !== expectedObservedRevision) {
        throw new PipelineResultRevisionConflictError(this.revision, observedRevision);
      }

      const snapshot: PersistedPipelineResultState = {
        schema_version: STORE_SCHEMA_VERSION,
        revision: nextRevision,
        results: [...results.values()].sort((a, b) =>
          a.result_id.localeCompare(b.result_id),
        ),
        active_result_pointers: [...activePointers.values()].sort((a, b) =>
          a.pipeline_job_id.localeCompare(b.pipeline_job_id),
        ),
        activation_audit: activationAudit,
        activation_intents: [...activationIntents.values()]
          .sort((a, b) => a.intent_id.localeCompare(b.intent_id))
          .map(cloneIntent),
      };
      const serializedSnapshot = JSON.stringify(snapshot, null, 2);
      preparedCommitment = {
        schema_version: PIPELINE_RESULT_SNAPSHOT_COMMITMENT_SCHEMA_VERSION,
        revision: nextRevision,
        snapshot_sha256: crypto
          .createHash("sha256")
          .update(serializedSnapshot, "utf8")
          .digest("hex"),
      };
      this.jobs.preparePipelineResultSnapshot(preparedCommitment);
      try {
        tmpFd = fs.openSync(tmpPath, "wx", 0o600);
        fs.writeFileSync(tmpFd, serializedSnapshot, "utf-8");
        fs.fsyncSync(tmpFd);
        fs.closeSync(tmpFd);
        tmpFd = null;
        fs.renameSync(tmpPath, this.persistencePath);
        sidecarReplaced = true;
        this.jobs.promotePipelineResultSnapshot(preparedCommitment);
      } catch (error) {
        if (!sidecarReplaced) {
          try {
            this.jobs.abortPipelineResultSnapshot(preparedCommitment);
          } catch (abortError) {
            this.unavailableReason =
              "pipeline result pending commitment could not be aborted after write failure";
            throw new PipelineResultStateUnavailableError(
              `${this.unavailableReason}: ${
                abortError instanceof Error ? abortError.message : String(abortError)
              }`,
            );
          }
        } else {
          // The durable pending marker lets a fresh instance promote exact sidecar bytes. This
          // instance keeps its old maps/revision and must not serve them as current meanwhile.
          this.unavailableReason =
            "pipeline result sidecar replacement awaits pending commitment recovery";
        }
        throw error;
      }
      return nextRevision;
    } finally {
      if (tmpFd !== null) fs.closeSync(tmpFd);
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
      fs.closeSync(lockFd);
      if (fs.existsSync(lockPath)) fs.unlinkSync(lockPath);
    }
  }

  private selectionStateFor(result: PipelineResultRecord): ResultSelectionState {
    const pointer = this.activePointers.get(result.pipeline_job_id);
    if (pointer?.result_id === result.result_id) return "active";
    if (!isSelectableResult(result)) return null;
    if (
      this.activationAudit.some(
        (entry) =>
          entry.pipeline_job_id === result.pipeline_job_id &&
          entry.from_result_id === result.result_id,
      )
    ) {
      return "historical";
    }
    return "candidate";
  }

  private toView(result: PipelineResultRecord): PipelineResultView {
    return { ...cloneResult(result), selection_state: this.selectionStateFor(result) };
  }

  registerResult(input: RegisterPipelineResultInput): RegisterPipelineResultOutcome {
    this.assertAvailable();
    if (
      !isPipelineResultRecord({
        ...input,
        registered_at: input.now,
      }) ||
      !isNonEmptyString(input.correlation_id)
    ) {
      throw new PipelineResultInvariantError("invalid pipeline result registration input");
    }
    validateResultLocation(input);

    const job = this.jobs.get(input.pipeline_job_id);
    if (!job) {
      throw new PipelineResultInvariantError(
        `pipeline job ${input.pipeline_job_id} does not exist`,
      );
    }
    if (
      job.source_bundle_id !== input.source_bundle_id ||
      job.external_model_version_id !== input.external_model_version_id
    ) {
      throw new PipelineResultInvariantError(
        `result ${input.result_id} identity does not match pipeline job ${input.pipeline_job_id}`,
      );
    }

    const existing = this.results.get(input.result_id);
    if (existing) {
      if (!sameImmutableResult(existing, input)) {
        throw new PipelineResultConflictError(
          `immutable result ${input.result_id} was replayed with different identity or manifest evidence`,
        );
      }
      return {
        result: this.toView(existing),
        replay: true,
        active_result_pointer: this.getActiveResultPointer(input.pipeline_job_id),
        activation_audit_entry: null,
      };
    }
    const attemptOwner = this.resultIdByAttempt.get(input.attempt_id);
    if (attemptOwner) {
      throw new PipelineResultConflictError(
        `attempt ${input.attempt_id} is already bound to result ${attemptOwner}`,
      );
    }

    const record: PipelineResultRecord = {
      result_id: input.result_id,
      attempt_id: input.attempt_id,
      pipeline_job_id: input.pipeline_job_id,
      source_bundle_id: input.source_bundle_id,
      external_model_version_id: input.external_model_version_id,
      attempt_number: input.attempt_number,
      result_prefix: input.result_prefix,
      result_manifest_ref: input.result_manifest_ref,
      result_manifest_digest: input.result_manifest_digest,
      attempt_outcome: input.attempt_outcome,
      publication_state: input.publication_state,
      completed_at: input.completed_at,
      registered_at: input.now,
    };
    const nextResults = new Map(this.results);
    const nextPointers = new Map(this.activePointers);
    const nextAudit = [...this.activationAudit];
    nextResults.set(record.result_id, record);

    let createdAudit: ActivationAuditEntry | null = null;
    if (isSelectableResult(record) && !nextPointers.has(record.pipeline_job_id)) {
      const auditEntryId = activationAuditIdFor(record.pipeline_job_id, record.result_id);
      createdAudit = {
        audit_entry_id: auditEntryId,
        pipeline_job_id: record.pipeline_job_id,
        transition: "first_activation",
        from_result_id: null,
        to_result_id: record.result_id,
        target_result_evidence: {
          result_id: record.result_id,
          publication_state: record.publication_state,
          attempt_outcome: record.attempt_outcome,
          selection_state_before: null,
        },
        capability: null,
        reason: "first selectable AVAILABLE result auto-activated",
        actor: { actor_kind: "system", actor_id: PIPELINE_JOB_OWNER },
        authorization_decision_ref: null,
        correlation_id: input.correlation_id,
        occurred_at: input.now,
        append_only: true,
      };
      const pointer: ActiveResultPointer = {
        pipeline_job_id: record.pipeline_job_id,
        result_id: record.result_id,
        attempt_id: record.attempt_id,
        selection_state: "active",
        publication_state: "AVAILABLE",
        attempt_outcome: record.attempt_outcome,
        audit_entry_id: auditEntryId,
        activated_at: input.now,
        correlation_id: input.correlation_id,
      };
      nextAudit.push(createdAudit);
      nextPointers.set(record.pipeline_job_id, pointer);
    }

    const nextRevision = this.persistState(nextResults, nextPointers, nextAudit);
    this.results = nextResults;
    this.resultIdByAttempt = new Map(
      [...nextResults.values()].map((item) => [item.attempt_id, item.result_id]),
    );
    this.activePointers = nextPointers;
    this.activationAudit = nextAudit;
    this.revision = nextRevision;

    return {
      result: this.toView(record),
      replay: false,
      active_result_pointer: this.getActiveResultPointer(record.pipeline_job_id),
      activation_audit_entry: createdAudit ? cloneAudit(createdAudit) : null,
    };
  }

  createActivationIntent(
    input: CreatePipelineResultActivationIntentInput,
  ): CreatePipelineResultActivationIntentOutcome {
    this.assertAvailable();
    const expectedCapability =
      input.transition === "promote" ? "result.promote" : "result.rollback";
    if (
      !isNonEmptyString(input.intent_id) ||
      !/^intent_[A-Za-z0-9._:-]{8,200}$/.test(input.intent_id) ||
      !isNonEmptyString(input.intent_nonce) ||
      input.intent_nonce.length < 32 ||
      input.intent_nonce.length > 512 ||
      !isNonEmptyString(input.pipeline_job_id) ||
      !isNonEmptyString(input.target_result_id) ||
      !isNonEmptyString(input.expected_active_result_id) ||
      input.capability !== expectedCapability ||
      !isNonEmptyString(input.reason) ||
      input.reason.length > 2_000 ||
      (input.actor.actor_kind !== "operator" &&
        input.actor.actor_kind !== "service_account") ||
      !isNonEmptyString(input.actor.actor_id) ||
      !isNonEmptyString(input.correlation_id) ||
      !isUtcTimestamp(input.created_at) ||
      !isUtcTimestamp(input.expires_at)
    ) {
      throw new PipelineResultInvariantError("invalid protected result activation intent");
    }
    const createdAt = utcTimestampToMicros(input.created_at);
    const expiresAt = utcTimestampToMicros(input.expires_at);
    if (
      expiresAt <= createdAt ||
      expiresAt - createdAt > BigInt(PIPELINE_RESULT_INTENT_TTL_MS) * 1_000n
    ) {
      throw new PipelineResultInvariantError("invalid protected result activation intent");
    }

    const intentNonceSha256 = sha256Text(input.intent_nonce);
    // Pending challenges are short-lived and may be removed; committed/stale decision evidence is
    // retained with the append-only transition history. Cleanup is included in the same commit as
    // the new intent so no separate sweeper can race a confirm.
    const retainedIntents = new Map(
      [...this.activationIntents.entries()].filter(
        ([, intent]) =>
          intent.state !== "pending" || utcTimestampToMicros(intent.expires_at) > createdAt,
      ),
    );
    const existing = retainedIntents.get(input.intent_id);
    if (existing) {
      const sameIntent =
        existing.pipeline_job_id === input.pipeline_job_id &&
        existing.target_result_id === input.target_result_id &&
        existing.expected_active_result_id === input.expected_active_result_id &&
        existing.transition === input.transition &&
        existing.capability === input.capability &&
        existing.reason === input.reason &&
        existing.actor.actor_kind === input.actor.actor_kind &&
        existing.actor.actor_id === input.actor.actor_id &&
        existing.correlation_id === input.correlation_id &&
        existing.intent_nonce_sha256 === intentNonceSha256 &&
        existing.created_at === input.created_at &&
        existing.expires_at === input.expires_at;
      if (!sameIntent) {
        throw new PipelineResultConflictError(
          `activation intent id ${input.intent_id} was reused with different binding`,
        );
      }
      return { replay: true, intent: cloneIntent(existing) };
    }
    if (
      [...retainedIntents.values()].some(
        (intent) => intent.intent_nonce_sha256 === intentNonceSha256,
      )
    ) {
      throw new PipelineResultConflictError(
        "server activation nonce was reused by a different intent",
      );
    }
    const pendingIntents = [...retainedIntents.values()].filter(
      (intent) => intent.state === "pending",
    );
    if (pendingIntents.length >= MAX_PENDING_ACTIVATION_INTENTS) {
      throw new PipelineResultConflictError("global pending activation intent limit reached");
    }
    const pendingForSubjectJob = pendingIntents.filter(
      (intent) =>
        intent.pipeline_job_id === input.pipeline_job_id &&
        intent.actor.actor_id === input.actor.actor_id,
    ).length;
    if (pendingForSubjectJob >= MAX_PENDING_ACTIVATION_INTENTS_PER_SUBJECT_JOB) {
      throw new PipelineResultConflictError(
        `pending activation intent limit reached for subject/job ${input.pipeline_job_id}`,
      );
    }

    const currentPointer = this.activePointers.get(input.pipeline_job_id);
    if (!currentPointer) {
      throw new PipelineResultInvariantError(
        `pipeline job ${input.pipeline_job_id} has no active result to ${input.transition}`,
      );
    }
    if (currentPointer.result_id !== input.expected_active_result_id) {
      throw new PipelineResultConflictError(
        `active result changed: expected ${input.expected_active_result_id}, observed ${currentPointer.result_id}`,
      );
    }
    const target = this.results.get(input.target_result_id);
    if (!target || target.pipeline_job_id !== input.pipeline_job_id) {
      throw new PipelineResultActivationTargetInvariantError(
        "activation_target_not_selectable",
        `target result ${input.target_result_id} does not belong to pipeline job ${input.pipeline_job_id}`,
      );
    }
    if (!isSelectableResult(target)) {
      throw new PipelineResultActivationTargetInvariantError(
        "activation_target_not_selectable",
        `target result ${input.target_result_id} is not AVAILABLE + succeeded|succeeded_with_warnings`,
      );
    }
    const targetSelectionBefore = this.selectionStateFor(target);
    if (
      (input.transition === "promote" && targetSelectionBefore !== "candidate") ||
      (input.transition === "rollback" && targetSelectionBefore !== "historical")
    ) {
      throw new PipelineResultActivationTargetInvariantError(
        "selection_state_mismatch",
        `${input.transition} target ${input.target_result_id} has selection_state=${targetSelectionBefore}`,
      );
    }

    const intent: PipelineResultActivationIntent = {
      intent_id: input.intent_id,
      pipeline_job_id: input.pipeline_job_id,
      target_result_id: input.target_result_id,
      expected_active_result_id: input.expected_active_result_id,
      transition: input.transition,
      capability: input.capability,
      reason: input.reason,
      actor: { ...input.actor },
      correlation_id: input.correlation_id,
      intent_nonce_sha256: intentNonceSha256,
      created_at: input.created_at,
      expires_at: input.expires_at,
      state: "pending",
      decision: null,
      audit_entry_id: null,
      completed_at: null,
      observed_active_result_id: null,
    };
    const nextIntents = new Map(retainedIntents);
    nextIntents.set(intent.intent_id, intent);
    const nextRevision = this.persistState(
      this.results,
      this.activePointers,
      this.activationAudit,
      nextIntents,
    );
    this.activationIntents = nextIntents;
    this.revision = nextRevision;
    return { replay: false, intent: cloneIntent(intent) };
  }

  private decisionProvenanceFor(
    intent: PipelineResultActivationIntent,
    decision: VerifiedExternalResultDecision,
    now: string,
  ): PipelineResultDecisionProvenance {
    if (
      !isNonEmptyString(decision.authorization_decision_ref) ||
      !isNonEmptyString(decision.issuer) ||
      !isNonEmptyString(decision.audience) ||
      !isNonEmptyString(decision.subject) ||
      !isNonEmptyString(decision.jti) ||
      decision.capability !== intent.capability ||
      decision.subject !== intent.actor.actor_id ||
      !isUtcTimestamp(decision.issued_at) ||
      !isUtcTimestamp(decision.not_before) ||
      !isUtcTimestamp(decision.expires_at) ||
      !isUtcTimestamp(decision.verified_at) ||
      !isUtcTimestamp(now) ||
      decision.verified_at !== now
    ) {
      throw new PipelineResultAuthorizationError(
        `external authorization decision does not match pending intent ${intent.intent_id}`,
      );
    }
    const nowInstant = utcTimestampToMicros(now);
    const issuedAt = utcTimestampToMicros(decision.issued_at);
    const notBefore = utcTimestampToMicros(decision.not_before);
    const expiresAt = utcTimestampToMicros(decision.expires_at);
    const intentCreatedAt = utcTimestampToMicros(intent.created_at);
    const intentExpiresAt = utcTimestampToMicros(intent.expires_at);
    if (
      issuedAt < intentCreatedAt ||
      issuedAt > nowInstant ||
      notBefore > nowInstant ||
      expiresAt <= nowInstant ||
      expiresAt > intentExpiresAt ||
      nowInstant >= intentExpiresAt
    ) {
      throw new PipelineResultAuthorizationError(
        `external authorization decision does not match pending intent ${intent.intent_id}`,
      );
    }
    return {
      authorization_decision_ref: decision.authorization_decision_ref,
      issuer: decision.issuer,
      audience: decision.audience,
      subject: decision.subject,
      capability: decision.capability,
      decision_replay_key_sha256: decisionReplayKeySha256(decision),
      issued_at: decision.issued_at,
      not_before: decision.not_before,
      expires_at: decision.expires_at,
      verified_at: decision.verified_at,
    };
  }

  confirmActivationIntent(
    input: ConfirmPipelineResultActivationIntentInput,
  ): ConfirmPipelineResultActivationIntentOutcome {
    this.assertAvailable();
    const intent = this.activationIntents.get(input.intent_id);
    if (!intent) {
      throw new PipelineResultAuthorizationError(
        `activation intent ${input.intent_id} is missing or expired`,
      );
    }
    const provenance = this.decisionProvenanceFor(intent, input.decision, input.now);
    const sameTerminalDecision =
      intent.decision?.decision_replay_key_sha256 ===
        provenance.decision_replay_key_sha256 &&
      intent.decision.authorization_decision_ref === provenance.authorization_decision_ref &&
      intent.decision.issuer === provenance.issuer &&
      intent.decision.audience === provenance.audience &&
      intent.decision.subject === provenance.subject &&
      intent.decision.capability === provenance.capability &&
      intent.decision.issued_at === provenance.issued_at &&
      intent.decision.not_before === provenance.not_before &&
      intent.decision.expires_at === provenance.expires_at;

    if (intent.state === "committed") {
      if (!sameTerminalDecision || !intent.audit_entry_id) {
        throw new PipelineResultAuthorizationError(
          `activation intent ${intent.intent_id} was already consumed by another decision`,
        );
      }
      const auditEntry = this.activationAudit.find(
        (entry) => entry.audit_entry_id === intent.audit_entry_id,
      );
      const target = this.results.get(intent.target_result_id);
      if (!auditEntry || !target || !isSelectableResult(target)) {
        throw new PipelineResultStateUnavailableError(
          `committed activation intent ${intent.intent_id} lost referential evidence`,
        );
      }
      const currentPointer = this.activePointers.get(intent.pipeline_job_id);
      if (
        !currentPointer ||
        currentPointer.result_id !== target.result_id ||
        currentPointer.audit_entry_id !== auditEntry.audit_entry_id
      ) {
        throw new PipelineResultConflictError(
          `committed activation intent ${intent.intent_id} no longer owns the active pointer`,
        );
      }
      return {
        outcome: "committed",
        replay: true,
        intent: cloneIntent(intent),
        active_result_pointer: clonePointer(currentPointer),
        activation_audit_entry: cloneAudit(auditEntry),
      };
    }
    if (intent.state === "rejected_stale") {
      if (!sameTerminalDecision) {
        throw new PipelineResultAuthorizationError(
          `stale activation intent ${intent.intent_id} was consumed by another decision`,
        );
      }
      return {
        outcome: "rejected_stale",
        replay: true,
        intent: cloneIntent(intent),
        observed_active_result_id: intent.observed_active_result_id,
      };
    }

    const replayOwner = [...this.activationIntents.values()].find(
      (candidate) =>
        candidate.intent_id !== intent.intent_id &&
        candidate.decision?.decision_replay_key_sha256 ===
          provenance.decision_replay_key_sha256,
    );
    if (replayOwner) {
      throw new PipelineResultAuthorizationError(
        `external authorization decision was already consumed by intent ${replayOwner.intent_id}`,
      );
    }

    const currentPointer = this.activePointers.get(intent.pipeline_job_id);
    if (!currentPointer || currentPointer.result_id !== intent.expected_active_result_id) {
      const staleIntent: PipelineResultActivationIntent = {
        ...cloneIntent(intent),
        state: "rejected_stale",
        decision: provenance,
        audit_entry_id: null,
        completed_at: input.now,
        observed_active_result_id: currentPointer?.result_id ?? null,
      };
      const nextIntents = new Map(this.activationIntents);
      nextIntents.set(intent.intent_id, staleIntent);
      const nextRevision = this.persistState(
        this.results,
        this.activePointers,
        this.activationAudit,
        nextIntents,
      );
      this.activationIntents = nextIntents;
      this.revision = nextRevision;
      return {
        outcome: "rejected_stale",
        replay: false,
        intent: cloneIntent(staleIntent),
        observed_active_result_id: staleIntent.observed_active_result_id,
      };
    }

    const target = this.results.get(intent.target_result_id);
    if (!target || target.pipeline_job_id !== intent.pipeline_job_id || !isSelectableResult(target)) {
      throw new PipelineResultActivationTargetInvariantError(
        "activation_target_not_selectable",
        `activation intent ${intent.intent_id} target is no longer selectable`,
      );
    }
    const targetSelectionBefore = this.selectionStateFor(target);
    let selectionStateBefore: "candidate" | "historical";
    if (intent.transition === "promote") {
      if (targetSelectionBefore !== "candidate") {
        throw new PipelineResultActivationTargetInvariantError(
          "selection_state_mismatch",
          `promote target ${target.result_id} has selection_state=${targetSelectionBefore}`,
        );
      }
      selectionStateBefore = targetSelectionBefore;
    } else {
      if (targetSelectionBefore !== "historical") {
        throw new PipelineResultActivationTargetInvariantError(
          "selection_state_mismatch",
          `rollback target ${target.result_id} has selection_state=${targetSelectionBefore}`,
        );
      }
      selectionStateBefore = targetSelectionBefore;
    }

    const auditEntryId = protectedActivationAuditIdFor(intent.intent_id);
    if (this.activationAudit.some((entry) => entry.audit_entry_id === auditEntryId)) {
      throw new PipelineResultConflictError(
        `activation audit id ${auditEntryId} already exists without a committed intent`,
      );
    }
    const auditEntry: ActivationAuditEntry = {
      audit_entry_id: auditEntryId,
      pipeline_job_id: intent.pipeline_job_id,
      transition: intent.transition,
      from_result_id: currentPointer.result_id,
      to_result_id: target.result_id,
      target_result_evidence: {
        result_id: target.result_id,
        publication_state: target.publication_state,
        attempt_outcome: target.attempt_outcome,
        selection_state_before: selectionStateBefore,
      },
      capability: intent.capability,
      reason: intent.reason,
      actor: { ...intent.actor },
      authorization_decision_ref: provenance.authorization_decision_ref,
      correlation_id: intent.correlation_id,
      occurred_at: input.now,
      append_only: true,
    };
    const pointer: ActiveResultPointer = {
      pipeline_job_id: target.pipeline_job_id,
      result_id: target.result_id,
      attempt_id: target.attempt_id,
      selection_state: "active",
      publication_state: "AVAILABLE",
      attempt_outcome: target.attempt_outcome,
      audit_entry_id: auditEntry.audit_entry_id,
      activated_at: input.now,
      correlation_id: intent.correlation_id,
    };
    const committedIntent: PipelineResultActivationIntent = {
      ...cloneIntent(intent),
      state: "committed",
      decision: provenance,
      audit_entry_id: auditEntry.audit_entry_id,
      completed_at: input.now,
      observed_active_result_id: null,
    };
    const nextPointers = new Map(this.activePointers);
    nextPointers.set(intent.pipeline_job_id, pointer);
    const nextAudit = [...this.activationAudit, auditEntry];
    const nextIntents = new Map(this.activationIntents);
    nextIntents.set(intent.intent_id, committedIntent);
    const nextRevision = this.persistState(
      this.results,
      nextPointers,
      nextAudit,
      nextIntents,
    );
    this.activePointers = nextPointers;
    this.activationAudit = nextAudit;
    this.activationIntents = nextIntents;
    this.revision = nextRevision;
    return {
      outcome: "committed",
      replay: false,
      intent: cloneIntent(committedIntent),
      active_result_pointer: clonePointer(pointer),
      activation_audit_entry: cloneAudit(auditEntry),
    };
  }

  getComparableResults(
    pipelineJobId: string,
    leftResultId: string,
    rightResultId: string,
  ): ComparablePipelineResults {
    this.assertAvailable();
    const left = this.results.get(leftResultId);
    const right = this.results.get(rightResultId);
    if (
      !left ||
      !right ||
      left.pipeline_job_id !== pipelineJobId ||
      right.pipeline_job_id !== pipelineJobId
    ) {
      throw new PipelineResultCompareInvariantError(
        "compare_cross_job_rejected",
        "result.compare requires two results from the requested pipeline job",
      );
    }
    if (!isSelectableResult(left) || !isSelectableResult(right)) {
      throw new PipelineResultCompareInvariantError(
        "compare_non_selectable",
        "result.compare requires two AVAILABLE + succeeded|succeeded_with_warnings results",
      );
    }
    return { left: this.toView(left), right: this.toView(right) };
  }

  listResults(pipelineJobId: string): PipelineResultView[] {
    this.assertAvailable();
    return [...this.results.values()]
      .filter((result) => result.pipeline_job_id === pipelineJobId)
      .sort((a, b) => a.attempt_number - b.attempt_number)
      .map((result) => this.toView(result));
  }

  getResult(resultId: string): PipelineResultView | null {
    this.assertAvailable();
    const result = this.results.get(resultId);
    return result ? this.toView(result) : null;
  }

  getActiveResultPointer(pipelineJobId: string): ActiveResultPointer | null {
    this.assertAvailable();
    const pointer = this.activePointers.get(pipelineJobId);
    return pointer ? clonePointer(pointer) : null;
  }

  listActivationAudit(pipelineJobId: string): ActivationAuditEntry[] {
    this.assertAvailable();
    return this.activationAudit
      .filter((entry) => entry.pipeline_job_id === pipelineJobId)
      .map(cloneAudit);
  }

  getActivationIntent(intentId: string): PipelineResultActivationIntent | null {
    this.assertAvailable();
    const intent = this.activationIntents.get(intentId);
    return intent ? cloneIntent(intent) : null;
  }
}

export function toActiveResultPointerDocument(
  pointer: ActiveResultPointer,
): ActiveResultPointerDocument {
  return {
    schema_version: PIPELINE_RESULT_DOCUMENT_SCHEMA_VERSION,
    document_type: "active_result_pointer",
    body: clonePointer(pointer),
  };
}

export function toActivationAuditEntryDocument(
  entry: ActivationAuditEntry,
): ActivationAuditEntryDocument {
  return {
    schema_version: PIPELINE_RESULT_DOCUMENT_SCHEMA_VERSION,
    document_type: "activation_audit_entry",
    body: cloneAudit(entry),
  };
}
