// Review Session Opening (docs/architecture/review-session-opening-adr.md).
//
// Entering a Review Session for a ready model, on three paths: recreating a closed session, opening or creating a session
// for a ready model (intents `legacy`, `create_new` and `open_existing`), and the automatic open when a conversion reaches
// ready. The module owns request identity and idempotent replay (Idempotency-Key digest, Recreation Receipt, deterministic
// session id, review-request scope digest), joining concurrent requests for the same operation, the review-request carrier
// checks, source validation against the current ready bundle, the rebuildability and artifact-health gates, server-owned
// binding construction, Kit allocation and the lineage events. Routes validate the request and map the closed outcome to
// their wire bodies; the conversion-terminal observer keeps the IFC-ready job record and the viewer link.
import { createHash, randomBytes } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { CoordinatorConfig } from "../../config.js";
import type {
  ArtifactBinding,
  ArtifactHealthSnapshot,
  ConversionQualityMetricsSummary,
  IfcReadyIntakeJob,
  ReadyRenderBundle,
  ReviewSession,
} from "../../types.js";
import { isTrustedDirectSessionProbeBinding, type ArtifactHealthProbeInput } from "../artifactHealthProbe.js";
import type { ConversionLedger } from "../conversionLedger.js";
import type { EventLog } from "../eventLog.js";
import { allocateKitInstanceBindings, legacyKitInstanceFromBinding } from "../kitPool.js";
import { resolveReadyRenderBundle, type ReadyRenderResolution } from "../readyModelResolver.js";
import {
  fingerprintReadyReviewSource,
  identifyReadyReviewRequest,
  readyReviewSourceSnapshot,
  type ReadyReviewIntent,
} from "../readyReviewIntent.js";
import { AUTO_CONVERSION_READY_CREATOR, CONSOLE_READY_REVIEW_CREATOR } from "../sessionOrigin.js";
import {
  carriesReviewRequest,
  isCanonicalReadyReviewSourceCarrier,
  isModelBinding,
  isReviewRequestDigest,
  isSessionMutable,
  reviewRequestCarrierIntegrity,
  reviewSessionIdForRequestScope,
  type SessionStore,
} from "../sessionStore.js";
import type { StreamingConversionClient } from "../streamingConversionClient.js";

// ── ports and configuration ────────────────────────────────────────────────────

/** Reachability of a binding's model and mapping. Production: `probeArtifactHealth`. */
export interface ArtifactHealthPort {
  probe(input: ArtifactHealthProbeInput): Promise<ArtifactHealthSnapshot>;
}

/**
 * The conversion authority's result for a job. Production: `StreamingConversionClient`. The ready-model resolver treats
 * any rejection as `result_unavailable`.
 */
export type ConversionResultPort = Pick<StreamingConversionClient, "fetchConversionResult">;

/** Ready-model records and the render bundles resolved for them. Production: `ConversionLedger`. */
export type ReadyModelLedger = Pick<ConversionLedger, "get" | "rememberRenderBundle">;

export interface OpeningPolicyConfig {
  /** Conversion API base, the configured tenant (`minioWatchTenantId`), edge runtime data root and Kit endpoints. */
  coordinator: CoordinatorConfig;
  /** Origin of the conversion authority's public artifact URLs (`STREAMING_CONVERSION_PUBLIC_ARTIFACTS_URL`). */
  conversionPublicArtifactOrigin: string;
}

export interface ReviewSessionOpeningDeps {
  store: SessionStore;
  eventLog: EventLog;
  conversionLedger: ReadyModelLedger;
  artifactHealth: ArtifactHealthPort;
  conversionResults: ConversionResultPort;
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

export interface OpenForReadyModelCommand {
  /** `mw_` followed by 16 hex digits, already validated by the route. */
  readyModelId: string;
  intent: ReadyReviewIntent;
}

/** Why the ready render bundle did not resolve (`result_unavailable`: the conversion authority could not be reached). */
export type ReadyRenderFailure = Extract<ReadyRenderResolution, { ok: false }>["reason"];

export type ReadyModelOutcome =
  /**
   * `replay` is false only when this request created the session. A `create_new` request that joined the request creating
   * the session answers `replay: true`; a joined `legacy` request answers what the first one did.
   */
  | { kind: "opened"; session: ReviewSession; replay: boolean }
  | { kind: "ready_model_not_found" }
  | { kind: "resolver"; reason: ReadyRenderFailure }
  | { kind: "ready_artifacts_unavailable" }
  /** The ledger record changed while the authority and the artifacts were checked. */
  | { kind: "ready_model_changed" }
  | { kind: "review_session_not_found" }
  /** The selected session's review-request carrier, or the stored request session, is not intact. */
  | { kind: "carrier_corrupt" }
  /** The selected session was not opened from this ready bundle. */
  | { kind: "source_mismatch" }
  | { kind: "not_mutable" }
  /** The request id was used before for another ready source. */
  | { kind: "idempotency_conflict" }
  /** A legacy session of this ready model is still closing. */
  | { kind: "session_closing" }
  | { kind: "no_usdc_ref" }
  | { kind: "queued_for_instance" };

export interface TerminalOpenCommand {
  /** The IFC-ready job whose conversion reached ready. */
  job: Pick<IfcReadyIntakeJob,
    | "ifc_ready_job_id" | "tenant_id" | "project_id" | "external_model_version_id" | "correlation_id" | "review_session_id"
    | "intake_source" | "idempotency_key">;
  conversionJobId: string | null;
  /** The published model and mapping; the observer has already refused URLs outside the trusted artifact origin. */
  usdcRef: string | null;
  elementMappingRef: string | null;
  qualitySummary: ConversionQualityMetricsSummary | null;
}

export type TerminalOpenOutcome =
  | { kind: "opened"; session: ReviewSession; replay: boolean }
  /** The conversion published no model, so there is nothing to stream. */
  | { kind: "no_usdc_ref" }
  /** No Kit capacity: no session is created, and the caller keeps the review intent. */
  | { kind: "queued_for_instance" };

/** What the legacy ready-model path and the conversion-terminal path open a session from. */
interface AutomaticOpenSource {
  traceId: string;
  tenantId: string;
  projectId: string;
  modelVersionId: string;
  correlationId: string;
  /** A session recorded for this source earlier; reused while its file exists. */
  existingSessionId?: string | null;
  readyModelId?: string;
  /** A closed session the new one replaces: the open is then a recreation, with its lineage events. */
  recreatedFromSessionId?: string;
  usdcRef: string | null;
  mappingRef: string | null;
  conversionJobId: string | null;
  qualitySummary: ConversionQualityMetricsSummary | null;
}

const REQUEST_NAMESPACE = "review_session_request_";
const READY_MODEL_ID = /^mw_[a-f0-9]{16}$/;

// ── lineage ────────────────────────────────────────────────────────────────────

/**
 * Append the recreation lineage events that are missing: `sessionCreated` (with `recreated_from_session_id`) on the
 * recreated session, `sessionRecreated` on the source, and `sessionActive` when the recreated session is already active.
 * Idempotent, so replays repair a lineage that a crash left half written.
 */
function ensureRecreationEvents(eventLog: EventLog, source: ReviewSession, recreated: ReviewSession): void {
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

/** Append the `sessionCreated` of a `create_new` session unless it is there already, so a replay repairs a lost append. */
function ensureRequestSessionCreatedEvent(eventLog: EventLog, session: ReviewSession): void {
  if (!session.review_request_id || !session.review_request_fingerprint) throw new Error("Explicit review request provenance is unavailable.");
  const found = eventLog.list(session.session_id).some((event) => {
    const payload = event.payload as { review_request_id?: unknown; review_request_fingerprint?: unknown };
    return event.type === "sessionCreated" && event.server_owned === true
      && payload?.review_request_id === session.review_request_id
      && payload.review_request_fingerprint === session.review_request_fingerprint;
  });
  if (!found) {
    eventLog.appendServerOwned(session.session_id, "sessionCreated", {
      project_id: session.project_id,
      model_version_id: session.model_version_id,
      review_request_id: session.review_request_id,
      review_request_fingerprint: session.review_request_fingerprint,
    });
  }
}

// ── review-request carriers and ready bundles ─────────────────────────────────

/** A replayed session must carry the source's review-request identity exactly (or, like the source, carry none). */
function recreationReadySourceMatches(source: ReviewSession, target: ReviewSession): boolean {
  const expectedRequestId = source.session_id.startsWith(REQUEST_NAMESPACE) ? undefined : source.review_request_id;
  if (target.review_request_id !== expectedRequestId || target.session_id.startsWith(REQUEST_NAMESPACE)) return false;
  if (!carriesReviewRequest(source)) return !carriesReviewRequest(target);
  return isCanonicalReadyReviewSourceCarrier(source) && isCanonicalReadyReviewSourceCarrier(target)
    && source.review_request_fingerprint === target.review_request_fingerprint
    && isDeepStrictEqual(source.ready_review_source, target.ready_review_source);
}

/**
 * The open-existing carrier check as it stands. Bullet 3 of the ADR switches it to `reviewRequestCarrierIntegrity`, which
 * also refuses a `review_request_id` outside the request namespace, after that rule is checked on the persisted sessions.
 */
function openExistingCarrierCorrupt(session: ReviewSession): boolean {
  const requestNamespace = session.session_id.startsWith(REQUEST_NAMESPACE);
  return carriesReviewRequest(session)
    && (!isCanonicalReadyReviewSourceCarrier(session)
      || (requestNamespace && (!isReviewRequestDigest(session.review_request_id)
        || session.session_id !== reviewSessionIdForRequestScope(session.review_request_id))));
}

/**
 * Whether a session was opened from this ready bundle. A review-request carrier matches by the source fingerprint; a legacy
 * session has no historical checksum, so its server-owned identity and its single model binding are checked against the
 * current authority instead. CFD overlay bindings are additive result layers and never part of the ready bundle.
 */
function sessionMatchesReadyBundle(session: ReviewSession, bundle: ReadyRenderBundle): boolean {
  if (carriesReviewRequest(session)) {
    return isCanonicalReadyReviewSourceCarrier(session)
      && session.review_request_fingerprint === fingerprintReadyReviewSource(readyReviewSourceSnapshot(bundle));
  }
  const modelBindings = session.artifact_bindings.filter(isModelBinding);
  return session.ready_model_id === bundle.readyModelId && session.tenant_id === bundle.tenantId
    && session.project_id === bundle.projectId && session.model_version_id === bundle.modelVersionId
    && session.trace_id === bundle.rootTraceId && session.usdc_artifact_id === `auto_usdc_${bundle.conversionJobId}`
    && modelBindings.length === 1 && modelBindings.every((binding) =>
      binding.artifact_id === session.usdc_artifact_id && binding.artifact_group_id === `ag_${bundle.modelVersionId}`
      && binding.model_version_id === bundle.modelVersionId && binding.artifact_role === "derived"
      && binding.ready_status === "ready" && binding.load_order === 0 && binding.routing_policy === "same_instance"
      && binding.conversion_authority === "bim-streaming-server" && binding.conversion_status === "ready"
      && binding.conversion_job_id === bundle.conversionJobId && binding.url === bundle.model.url
      && binding.mapping_url === bundle.mapping.url);
}

/** The one server-owned model binding of a session opened for a ready bundle. */
function readyBundleArtifactBindings(bundle: ReadyRenderBundle): ArtifactBinding[] {
  return [{
    binding_id: "binding_auto_usdc", artifact_group_id: `ag_${bundle.modelVersionId}`,
    model_version_id: bundle.modelVersionId, artifact_id: `auto_usdc_${bundle.conversionJobId}`,
    artifact_role: "derived", url: bundle.model.url, mapping_url: bundle.mapping.url, load_order: 0,
    routing_policy: "same_instance", ready_status: "ready", conversion_authority: "bim-streaming-server",
    conversion_job_id: bundle.conversionJobId, conversion_status: "ready",
  }];
}

// ── concurrent requests ────────────────────────────────────────────────────────

/**
 * One table for every opening operation in flight. Keys are namespaced per path (`recreate:`, `ready:`), so a key only
 * ever holds its own path's outcome type.
 */
class InFlightOperations {
  private readonly operations = new Map<string, Promise<unknown>>();

  /** Run `start` once per key; a request that arrives while it runs awaits the same operation and is told it joined. */
  async run<T>(key: string, start: () => Promise<T>): Promise<{ outcome: T; joined: boolean }> {
    const inFlight = this.operations.get(key) as Promise<T> | undefined;
    if (inFlight) return { outcome: await inFlight, joined: true };
    const operation = start();
    this.operations.set(key, operation);
    try {
      return { outcome: await operation, joined: false };
    } finally {
      this.operations.delete(key);
    }
  }
}

// ── module ─────────────────────────────────────────────────────────────────────

export class ReviewSessionOpening {
  private readonly inFlight = new InFlightOperations();

  constructor(private readonly deps: ReviewSessionOpeningDeps) {}

  /**
   * Recreate a closed session as a new session over the source's server-owned derived bindings. The same key always
   * answers the same session: from its Recreation Receipt, from the deterministic session id when the receipt was lost,
   * or by joining the request that is creating it right now.
   */
  async recreate(command: RecreateCommand): Promise<RecreateOutcome> {
    const keyDigest = createHash("sha256").update(command.idempotencyKey).digest("hex");
    const { outcome, joined } = await this.inFlight.run(
      `recreate:${command.closedSessionId}:${keyDigest}`,
      () => this.recreateOnce(command.closedSessionId, keyDigest),
    );
    return joined && outcome.kind === "created" ? { ...outcome, kind: "replayed" } : outcome;
  }

  /**
   * Open a Review Session for a ready model. The ready render bundle is resolved from the conversion authority (or the
   * ledger's cached copy), its artifacts must be reachable and the ledger record unchanged meanwhile. Then the intent
   * decides: `open_existing` answers a selected session that still matches the bundle, `create_new` creates (or replays)
   * the session of a request id, and `legacy` reuses the model's open legacy session or opens one, as a recreation when
   * it replaces a closed one. Concurrent requests for the same model (legacy), request id or selected session join.
   */
  async openForReadyModel(command: OpenForReadyModelCommand): Promise<ReadyModelOutcome> {
    const { readyModelId, intent } = command;
    const key = intent.mode === "legacy" ? `ready:legacy:${readyModelId}`
      : intent.mode === "create_new" ? `ready:create:${readyModelId}:${intent.request_id}`
        : `ready:open:${readyModelId}:${intent.session_id}`;
    const { outcome, joined } = await this.inFlight.run(key, () => this.openForReadyModelOnce(readyModelId, intent));
    return joined && intent.mode === "create_new" && outcome.kind === "opened" ? { ...outcome, replay: true } : outcome;
  }

  /**
   * The automatic open when a conversion reaches ready: reuse the session the IFC-ready job recorded, or open one over the
   * published model. Synchronous, like the pipeline's terminal observer that calls it: the ingest response carries the
   * session it opened.
   */
  openForConversionTerminal(command: TerminalOpenCommand): TerminalOpenOutcome {
    const { job } = command;
    return this.openAutomatically({
      traceId: job.ifc_ready_job_id,
      tenantId: job.tenant_id,
      projectId: job.project_id,
      modelVersionId: job.external_model_version_id,
      correlationId: job.correlation_id,
      existingSessionId: job.review_session_id,
      // #809: a MinIO watcher job's idempotency key is its ready model id. Binding it lets the ready-model route reuse this
      // session instead of allocating a second one for the same conversion. Provenance comes from the job's intake source
      // (the watcher intake registry), never from the key's shape: an external worker's `mw_`-shaped key is not bound.
      readyModelId: job.intake_source === "minio_watch" && READY_MODEL_ID.test(job.idempotency_key) ? job.idempotency_key : undefined,
      usdcRef: command.usdcRef,
      mappingRef: command.elementMappingRef,
      conversionJobId: command.conversionJobId,
      qualitySummary: command.qualitySummary,
    });
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
    const sourceRequestNamespace = source.session_id.startsWith(REQUEST_NAMESPACE);
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

  private async openForReadyModelOnce(readyModelId: string, intent: ReadyReviewIntent): Promise<ReadyModelOutcome> {
    const { conversionLedger, conversionResults, artifactHealth, config } = this.deps;
    const record = conversionLedger.get(readyModelId);
    if (!record) return { kind: "ready_model_not_found" };
    const resolved = await resolveReadyRenderBundle({
      record,
      configuredTenantId: config.coordinator.minioWatchTenantId,
      conversionOrigin: config.coordinator.streamingConversionApiBase,
      publicArtifactOrigin: config.conversionPublicArtifactOrigin,
      fetchResult: (jobId) => conversionResults.fetchConversionResult(jobId),
    });
    if (!resolved.ok) return { kind: "resolver", reason: resolved.reason };
    const bundle = resolved.bundle;
    const health = await artifactHealth.probe({
      host_local_path: null,
      model_artifact_url: bundle.model.url,
      mapping_url: bundle.mapping.url,
      edge_runtime_data_root: config.coordinator.edgeRuntimeDataRoot,
      configured_conversion_api_origin: config.coordinator.streamingConversionApiBase,
      trusted_public_artifact_origin: config.conversionPublicArtifactOrigin,
    });
    if (health.model_usdc_reachable !== true || health.mapping_reachable !== true) return { kind: "ready_artifacts_unavailable" };
    const current = conversionLedger.get(readyModelId);
    if (!current || current.status !== "ready" || current.conversion_job_id !== record.conversion_job_id
      || current.correlation_id !== record.correlation_id || current.project_id !== record.project_id
      || current.external_model_version_id !== record.external_model_version_id || current.usdc_key !== record.usdc_key) {
      return { kind: "ready_model_changed" };
    }
    // Persist the bundle only when it came from the authority just now; a replay does not rewrite the whole ledger.
    if (!resolved.cached) conversionLedger.rememberRenderBundle(bundle);
    switch (intent.mode) {
      case "open_existing":
        return this.openExisting(intent.session_id, bundle);
      case "create_new":
        return this.createForRequest(intent.request_id, bundle, resolved.qualitySummary);
      case "legacy":
        return this.openLegacy(readyModelId, bundle, resolved.qualitySummary);
      default: {
        const unhandled: never = intent;
        throw new Error(`unhandled ready review intent: ${JSON.stringify(unhandled)}`);
      }
    }
  }

  private openExisting(sessionId: string, bundle: ReadyRenderBundle): ReadyModelOutcome {
    const selected = this.deps.store.get(sessionId);
    if (!selected) return { kind: "review_session_not_found" };
    if (openExistingCarrierCorrupt(selected)) return { kind: "carrier_corrupt" };
    if (!sessionMatchesReadyBundle(selected, bundle)) return { kind: "source_mismatch" };
    if (!isSessionMutable(selected)) return { kind: "not_mutable" };
    return { kind: "opened", session: selected, replay: true };
  }

  private createForRequest(requestId: string, bundle: ReadyRenderBundle, qualitySummary: ConversionQualityMetricsSummary | null): ReadyModelOutcome {
    const { store, eventLog, config } = this.deps;
    const identity = identifyReadyReviewRequest(bundle, requestId);
    const result = store.createOrGetReviewRequest({
      ready_model_id: bundle.readyModelId,
      trace_id: bundle.rootTraceId,
      review_request_id: identity.scopeDigest,
      review_request_fingerprint: identity.fingerprint,
      ready_review_source: readyReviewSourceSnapshot(bundle),
      tenant_id: bundle.tenantId,
      project_id: bundle.projectId,
      model_version_id: bundle.modelVersionId,
      usdc_artifact_id: `auto_usdc_${bundle.conversionJobId}`,
      created_by: CONSOLE_READY_REVIEW_CREATOR,
      mode: "single_kit_shared_state",
      kit_instance: legacyKitInstanceFromBinding(undefined, config.coordinator),
      artifact_bindings: readyBundleArtifactBindings(bundle),
      kit_instance_bindings: [],
      quality_metrics_summary: qualitySummary,
    });
    if (result.kind === "conflict") return { kind: "idempotency_conflict" };
    if (result.kind === "corrupt") return { kind: "carrier_corrupt" };
    if (!sessionMatchesReadyBundle(result.session, bundle)) return { kind: "carrier_corrupt" };
    ensureRequestSessionCreatedEvent(eventLog, result.session);
    return { kind: "opened", session: result.session, replay: result.kind === "replay" };
  }

  private openLegacy(readyModelId: string, bundle: ReadyRenderBundle, qualitySummary: ConversionQualityMetricsSummary | null): ReadyModelOutcome {
    // The model's legacy sessions: no review-request carrier, the same identity, and a binding to this bundle's model.
    const sessions = this.deps.store.list().filter((session) => !carriesReviewRequest(session)
      && session.ready_model_id === readyModelId
      && session.tenant_id === bundle.tenantId && session.project_id === bundle.projectId
      && session.model_version_id === bundle.modelVersionId && session.trace_id === bundle.rootTraceId
      && session.artifact_bindings.some((binding) => binding.conversion_job_id === bundle.conversionJobId
        && binding.url === bundle.model.url && binding.mapping_url === bundle.mapping.url));
    const active = sessions.find((session) => session.status === "active" || session.status === "created");
    // A closing session is mid close-recovery: it cannot be reused, and opening another while it still holds its Kit
    // binding would allocate the same endpoint twice and break the lineage. Recreation takes over once it has closed.
    if (!active && sessions.some((session) => session.status === "closing")) return { kind: "session_closing" };
    return this.openAutomatically({
      traceId: bundle.rootTraceId,
      tenantId: bundle.tenantId,
      projectId: bundle.projectId,
      modelVersionId: bundle.modelVersionId,
      correlationId: bundle.correlationId,
      existingSessionId: active?.session_id,
      readyModelId,
      recreatedFromSessionId: active ? undefined : sessions.find((session) => session.status === "closed")?.session_id,
      usdcRef: bundle.model.url,
      mappingRef: bundle.mapping.url,
      conversionJobId: bundle.conversionJobId,
      qualitySummary,
    });
  }

  /**
   * Reuse the source's recorded session, or open one over its published model with a Kit allocation (the session is
   * `active` with it). Replacing a closed session is a recreation and carries the recreation lineage.
   */
  private openAutomatically(source: AutomaticOpenSource): TerminalOpenOutcome {
    const { store, eventLog, config } = this.deps;
    if (source.existingSessionId) {
      const existing = store.get(source.existingSessionId);
      if (existing) {
        // #810: a session opened without a quality summary gains the one this caller resolved from the authority, so a
        // replay stops reporting semantic and coverage as not ready. An existing summary is never overwritten.
        if (source.qualitySummary && existing.quality_metrics_summary == null) {
          const enriched = store.update(existing.session_id, { quality_metrics_summary: source.qualitySummary });
          return { kind: "opened", session: enriched ?? existing, replay: true };
        }
        return { kind: "opened", session: existing, replay: true };
      }
      // The recorded session's file is gone: open a new one rather than drop the review intent.
    }
    // A ready conversion without a model is not streamable.
    if (!source.usdcRef) return { kind: "no_usdc_ref" };

    const autoArtifactId = `auto_usdc_${source.conversionJobId ?? source.correlationId}`;
    const artifactBindings: ArtifactBinding[] = [{
      binding_id: "binding_auto_usdc",
      artifact_group_id: `ag_${source.modelVersionId}`,
      model_version_id: source.modelVersionId,
      artifact_id: autoArtifactId,
      artifact_role: "derived",
      url: source.usdcRef,
      mapping_url: source.mappingRef,
      load_order: 0,
      routing_policy: "same_instance",
      ready_status: "ready",
      conversion_authority: "bim-streaming-server",
      conversion_job_id: source.conversionJobId,
      conversion_status: "ready",
    }];
    const kitInstanceBindings = allocateKitInstanceBindings(config.coordinator, artifactBindings, "same_instance", source.tenantId, {});
    // No Kit capacity: no session. The caller keeps the review intent and opens again on its next pass.
    if (kitInstanceBindings.length === 0) return { kind: "queued_for_instance" };

    const session = store.create({
      trace_id: source.traceId,
      ready_model_id: source.readyModelId,
      recreated_from_session_id: source.recreatedFromSessionId,
      review_request_id: undefined,
      tenant_id: source.tenantId,
      project_id: source.projectId,
      model_version_id: source.modelVersionId,
      source_artifact_id: undefined,
      usdc_artifact_id: autoArtifactId,
      created_by: AUTO_CONVERSION_READY_CREATOR,
      mode: "single_kit_shared_state",
      kit_instance: legacyKitInstanceFromBinding(kitInstanceBindings[0], config.coordinator),
      artifact_bindings: artifactBindings,
      kit_instance_bindings: kitInstanceBindings,
      quality_metrics_summary: source.qualitySummary,
    });
    const recreationSource = source.recreatedFromSessionId ? store.get(source.recreatedFromSessionId) : null;
    if (recreationSource) {
      // #800: replacing a closed session is a recreation, with the recreate route's paired lineage events.
      ensureRecreationEvents(eventLog, recreationSource, session);
    } else {
      eventLog.appendServerOwned(session.session_id, "sessionCreated", {
        project_id: session.project_id,
        model_version_id: session.model_version_id,
        review_request_id: session.review_request_id,
      });
      if (session.status === "active") {
        eventLog.appendServerOwned(session.session_id, "sessionActive", {
          kit_instance_bindings: session.kit_instance_bindings.map((binding) => binding.kit_instance_id),
        });
      }
    }
    return { kind: "opened", session, replay: false };
  }
}
