// Review Session Opening (docs/architecture/review-session-opening-adr.md).
//
// Entering a Review Session for a ready model. Tracer bullet 1 owns closed-session recreation: request identity and
// idempotent replay (Idempotency-Key digest, Recreation Receipt, deterministic session id), joining concurrent requests
// for the same key, the review-request carrier integrity check, the rebuildability gate, server-owned binding
// construction, Kit allocation and the recreation lineage events. The ready-model and conversion-terminal paths follow
// in bullet 2. Routes validate the request and map the closed outcome to their wire bodies.
import { createHash, randomBytes } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { CoordinatorConfig } from "../../config.js";
import type { ArtifactBinding, ArtifactHealthSnapshot, ReviewSession } from "../../types.js";
import { isTrustedDirectSessionProbeBinding, type ArtifactHealthProbeInput } from "../artifactHealthProbe.js";
import type { EventLog } from "../eventLog.js";
import { legacyKitInstanceFromBinding } from "../kitPool.js";
import { isCanonicalReadyReviewSourceCarrier, reviewRequestCarrierIntegrity, type SessionStore } from "../sessionStore.js";

// ── ports and configuration ────────────────────────────────────────────────────

/** Reachability of a binding's model and mapping. Production: `probeArtifactHealth`. */
export interface ArtifactHealthPort {
  probe(input: ArtifactHealthProbeInput): Promise<ArtifactHealthSnapshot>;
}

export interface OpeningPolicyConfig {
  /** Conversion API base, edge runtime data root and Kit endpoints. */
  coordinator: CoordinatorConfig;
  /** Origin of the conversion authority's public artifact URLs (`STREAMING_CONVERSION_PUBLIC_ARTIFACTS_URL`). */
  conversionPublicArtifactOrigin: string;
}

export interface ReviewSessionOpeningDeps {
  store: SessionStore;
  eventLog: EventLog;
  artifactHealth: ArtifactHealthPort;
  config: OpeningPolicyConfig;
}

// ── commands and outcomes ─────────────────────────────────────────────────────

export interface SessionRebuildability {
  state: "ready" | "stale" | "unavailable";
  reason: string | null;
  checked_at: string | null;
}

export interface RecreateCommand {
  closedSessionId: string;
  /** The request's Idempotency-Key header value, already validated by the route. */
  idempotencyKey: string;
}

export type RecreateOutcome =
  | { kind: "created"; session: ReviewSession; sourceSessionId: string }
  /** The key was used before (receipt or deterministic id), or this request joined the one that created the session. */
  | { kind: "replayed"; session: ReviewSession; sourceSessionId: string }
  | { kind: "not_found" }
  | { kind: "not_closed" }
  /** The source's review-request carrier, or the replayed session's, is not intact. */
  | { kind: "carrier_corrupt" }
  | { kind: "not_rebuildable"; rebuildability: SessionRebuildability }
  | { kind: "no_ready_binding" };

// ── lineage ────────────────────────────────────────────────────────────────────

/**
 * Append the recreation lineage events that are missing: `sessionCreated` (with `recreated_from_session_id`) on the
 * recreated session, `sessionRecreated` on the source, and `sessionActive` when the recreated session is already active.
 * Idempotent, so replays repair a lineage that a crash left half written.
 */
export function ensureRecreationEvents(eventLog: EventLog, source: ReviewSession, recreated: ReviewSession): void {
  const targetEvents = eventLog.list(recreated.session_id);
  const hasCanonicalCreatedEvent = targetEvents.some((event) => (
    event.type === "sessionCreated"
    && event.server_owned === true
    && isDeepStrictEqual(event.payload, {
      project_id: recreated.project_id,
      model_version_id: recreated.model_version_id,
      recreated_from_session_id: source.session_id,
    })
  ));
  if (!hasCanonicalCreatedEvent) {
    eventLog.appendServerOwned(recreated.session_id, "sessionCreated", {
      project_id: recreated.project_id,
      model_version_id: recreated.model_version_id,
      recreated_from_session_id: source.session_id,
    });
  }
  const sourceHasRecreatedEvent = eventLog.list(source.session_id).some((event) => {
    if (
      event.type !== "sessionRecreated"
      || event.server_owned !== true
      || !event.payload
      || typeof event.payload !== "object"
    ) return false;
    return (event.payload as { recreated_session_id?: unknown }).recreated_session_id === recreated.session_id;
  });
  if (!sourceHasRecreatedEvent) {
    eventLog.appendServerOwned(source.session_id, "sessionRecreated", {
      recreated_session_id: recreated.session_id,
    });
  }
  const kitInstanceBindings = recreated.kit_instance_bindings.map((binding) => binding.kit_instance_id);
  const hasCanonicalActiveEvent = targetEvents.some((event) => (
    event.type === "sessionActive"
    && event.server_owned === true
    && isDeepStrictEqual(
      (event.payload as { kit_instance_bindings?: unknown })?.kit_instance_bindings,
      kitInstanceBindings,
    )
  ));
  if (recreated.status === "active" && !hasCanonicalActiveEvent) {
    eventLog.appendServerOwned(recreated.session_id, "sessionActive", {
      kit_instance_bindings: kitInstanceBindings,
    });
  }
}

/** A replayed session must carry the source's review-request identity exactly (or, like the source, carry none). */
function recreationReadySourceMatches(source: ReviewSession, target: ReviewSession): boolean {
  const expectedRequestId = source.session_id.startsWith("review_session_request_") ? undefined : source.review_request_id;
  if (target.review_request_id !== expectedRequestId || target.session_id.startsWith("review_session_request_")) return false;
  const carries = (session: ReviewSession) => session.ready_review_source !== undefined
    || session.review_request_fingerprint !== undefined || session.session_id.startsWith("review_session_request_");
  if (!carries(source)) return !carries(target);
  return isCanonicalReadyReviewSourceCarrier(source) && isCanonicalReadyReviewSourceCarrier(target)
    && source.review_request_fingerprint === target.review_request_fingerprint
    && isDeepStrictEqual(source.ready_review_source, target.ready_review_source);
}

// ── module ─────────────────────────────────────────────────────────────────────

export class ReviewSessionOpening {
  /** One recreation at a time per (source session, Idempotency-Key digest); later requests join it. */
  private readonly recreations = new Map<string, Promise<RecreateOutcome>>();

  constructor(private readonly deps: ReviewSessionOpeningDeps) {}

  /**
   * Recreate a closed session as a new session over the source's server-owned derived bindings. The same key always
   * answers the same session: from its Recreation Receipt, from the deterministic session id when the receipt was lost,
   * or by joining the request that is creating it right now.
   */
  async recreate(command: RecreateCommand): Promise<RecreateOutcome> {
    const keyDigest = createHash("sha256").update(command.idempotencyKey).digest("hex");
    const operationKey = `${command.closedSessionId}:${keyDigest}`;
    const inFlight = this.recreations.get(operationKey);
    if (inFlight) {
      const outcome = await inFlight;
      return outcome.kind === "created" ? { ...outcome, kind: "replayed" } : outcome;
    }
    const operation = this.recreateOnce(command.closedSessionId, keyDigest);
    this.recreations.set(operationKey, operation);
    try {
      return await operation;
    } finally {
      this.recreations.delete(operationKey);
    }
  }

  /**
   * Whether a session's derived bindings can be opened again: every ready derived binding has a trusted model and mapping
   * URL that the artifact-health probe reaches. Also the read projection of the closed-session list.
   */
  async rebuildability(session: ReviewSession): Promise<SessionRebuildability> {
    const { artifactHealth, config } = this.deps;
    const derivedBindings = session.artifact_bindings
      .filter((candidate) => candidate.artifact_role === "derived")
      .slice()
      .sort((left, right) => left.load_order - right.load_order);
    const bindings = derivedBindings.filter((candidate) => candidate.ready_status === "ready");
    if (bindings.length === 0) {
      if (derivedBindings.length > 0) {
        const first = derivedBindings[0];
        return {
          state: "stale",
          reason: first.diagnostic || first.failure_code || `artifact binding status is ${first.ready_status}`,
          checked_at: session.artifact_health?.checked_at ?? null,
        };
      }
      return { state: "unavailable", reason: "ready USDC / mapping binding is unavailable", checked_at: null };
    }
    let checkedAt: string | null = null;
    for (const binding of bindings) {
      if (!binding.url) {
        return { state: "unavailable", reason: `USDC binding is unavailable for ${binding.artifact_id}`, checked_at: checkedAt };
      }
      if (!binding.mapping_url) {
        return { state: "unavailable", reason: `mapping binding is unavailable for ${binding.artifact_id}`, checked_at: checkedAt };
      }
      if (!isTrustedDirectSessionProbeBinding(binding, config.coordinator.streamingConversionApiBase, config.conversionPublicArtifactOrigin)) {
        return { state: "unavailable", reason: "artifact binding is not owned by the configured conversion authority", checked_at: checkedAt };
      }
      try {
        const health = await artifactHealth.probe({
          host_local_path: null,
          model_artifact_url: binding.url,
          mapping_url: binding.mapping_url,
          edge_runtime_data_root: config.coordinator.edgeRuntimeDataRoot,
          configured_conversion_api_origin: config.coordinator.streamingConversionApiBase,
          trusted_public_artifact_origin: config.conversionPublicArtifactOrigin,
        });
        checkedAt = health.checked_at;
        if (health.model_usdc_reachable === false || health.mapping_reachable === false) {
          return {
            state: "stale",
            reason: health.stale_reason || health.failure_details?.model_usdc || health.failure_details?.mapping || "derived artifact is unreachable",
            checked_at: health.checked_at,
          };
        }
        if (health.model_usdc_reachable !== true || health.mapping_reachable !== true) {
          return { state: "unavailable", reason: "artifact health could not be verified", checked_at: health.checked_at };
        }
      } catch {
        return { state: "unavailable", reason: "artifact health could not be verified", checked_at: checkedAt };
      }
    }
    return { state: "ready", reason: null, checked_at: checkedAt };
  }

  private async recreateOnce(sourceSessionId: string, keyDigest: string): Promise<RecreateOutcome> {
    const { store, eventLog, config } = this.deps;
    const source = store.get(sourceSessionId);
    if (!source) return { kind: "not_found" };
    if (source.status !== "closed") return { kind: "not_closed" };
    if (reviewRequestCarrierIntegrity(source) === "corrupt") return { kind: "carrier_corrupt" };

    const receiptSessionId = store.getRecreationReceipt(sourceSessionId, keyDigest);
    const receiptSession = receiptSessionId ? store.get(receiptSessionId) : null;
    if (receiptSession) {
      // A receipt that names a session of another lineage is a store inconsistency, not a request outcome.
      if (receiptSession.recreated_from_session_id !== sourceSessionId) {
        throw new Error("Recreation idempotency receipt lineage mismatch.");
      }
      if (!recreationReadySourceMatches(source, receiptSession)) return { kind: "carrier_corrupt" };
      ensureRecreationEvents(eventLog, source, receiptSession);
      return { kind: "replayed", session: receiptSession, sourceSessionId };
    }
    const deterministicSessionId = `review_session_${createHash("sha256")
      .update(`${sourceSessionId}:${keyDigest}`)
      .digest("hex")
      .slice(0, 24)}`;
    const unreceiptedSession = store.get(deterministicSessionId);
    if (unreceiptedSession) {
      if (unreceiptedSession.recreated_from_session_id !== sourceSessionId) {
        throw new Error("Deterministic recreation session id collision.");
      }
      if (!recreationReadySourceMatches(source, unreceiptedSession)) return { kind: "carrier_corrupt" };
      ensureRecreationEvents(eventLog, source, unreceiptedSession);
      store.recordRecreationReceipt(sourceSessionId, keyDigest, unreceiptedSession.session_id);
      return { kind: "replayed", session: unreceiptedSession, sourceSessionId };
    }

    const rebuildability = await this.rebuildability(source);
    if (rebuildability.state !== "ready") return { kind: "not_rebuildable", rebuildability };
    const sourceBindings = source.artifact_bindings
      .filter((binding) => binding.artifact_role === "derived" && binding.ready_status === "ready" && Boolean(binding.url))
      .slice()
      .sort((left, right) => left.load_order - right.load_order);
    const sourceBinding = sourceBindings[0];
    if (!sourceBinding || sourceBindings.some((binding) => !binding.mapping_url
      || !isTrustedDirectSessionProbeBinding(binding, config.coordinator.streamingConversionApiBase, config.conversionPublicArtifactOrigin))) {
      return { kind: "no_ready_binding" };
    }
    const artifactBindings: ArtifactBinding[] = sourceBindings.map((binding) => ({
      ...binding,
      binding_id: `binding_${randomBytes(6).toString("hex")}`,
    }));
    const sourceRequestNamespace = source.session_id.startsWith("review_session_request_");
    const recreated = store.create({
      session_id: deterministicSessionId,
      ready_model_id: source.ready_model_id,
      trace_id: source.ready_model_id ? source.trace_id : undefined,
      recreated_from_session_id: source.session_id,
      review_request_id: sourceRequestNamespace ? undefined : source.review_request_id,
      review_request_fingerprint: source.review_request_fingerprint,
      ready_review_source: source.ready_review_source,
      tenant_id: source.tenant_id,
      project_id: source.project_id,
      model_version_id: source.model_version_id,
      source_artifact_id: source.source_artifact_id,
      usdc_artifact_id: sourceBinding.artifact_id,
      created_by: source.created_by,
      mode: source.mode,
      kit_instance: legacyKitInstanceFromBinding(undefined, config.coordinator),
      artifact_bindings: artifactBindings,
      kit_instance_bindings: [],
      quality_metrics_summary: source.quality_metrics_summary ?? null,
    });
    ensureRecreationEvents(eventLog, source, recreated);
    store.recordRecreationReceipt(sourceSessionId, keyDigest, recreated.session_id);
    return { kind: "created", session: recreated, sourceSessionId: source.session_id };
  }
}
