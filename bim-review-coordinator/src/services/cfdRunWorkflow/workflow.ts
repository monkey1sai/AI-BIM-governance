// CFD Run Workflow (docs/architecture/cfd-run-workflow-adr.md).
//
// The coordinator-side policy of a CFD run. Tracer bullet 1 owns the finding workflow (pedestrian-wind
// exceedance → governance issue) and overlay registration / removal on a review session; create, the reads
// and cancel follow in bullet 2. Routes parse the request, call one method and map the closed outcome to
// today's status codes and `error_code` values. The streaming CFD job service, governance-service and the
// session store are reached only through the dependencies given to the constructor; the ledger is an
// implementation detail the routes never touch for these operations.
import { cfdOverlayArtifactId } from "../../contract/schemas/cfd.js";
import type { StructLogger } from "../../lib/structLog.js";
import type { ArtifactBinding, SessionStatus } from "../../types.js";
import type { CfdRunClient, CfdUpstreamReply } from "../cfdRunClient.js";
import { CfdUpstreamUnavailable } from "../cfdRunClient.js";
import type { CfdFinding, CfdRunLedger } from "../cfdRunLedger.js";
import { isSessionMutable, type SessionStore } from "../sessionStore.js";
import { cfdFindingIssuePayload, type CfdFindingIssuePayload } from "./findingIssuePayload.js";

// ── ports ──────────────────────────────────────────────────────────────────────

/** The streaming CFD job service as this workflow uses it: `CfdRunClient` in production, an in-memory run store in tests. */
export type CfdRunPort = Pick<CfdRunClient, "getRun" | "getRunResult">;

export interface GovernanceIssueRef {
  id: string;
  kind: string;
}

/** governance-service `/api/issues` (the coordinator is its only caller for CFD findings). */
export interface GovernanceIssuePort {
  /**
   * The annotation opened earlier for the same prim path, title and model binding, or null. Governance has no
   * idempotency key on create, so this recovers an issue whose create reply the coordinator lost.
   */
  findAnnotation(query: { title: string; usdPrimPath: string; modelVersionId: string | null }): Promise<GovernanceIssueRef | null>;
  /** Open the issue; rejects with a message that says what governance answered. */
  createIssue(payload: CfdFindingIssuePayload): Promise<GovernanceIssueRef>;
}

export interface CfdRunWorkflowDeps {
  client: CfdRunPort;
  governanceIssues: GovernanceIssuePort;
  store: SessionStore;
  ledger: CfdRunLedger;
  /** Public origin of the streaming `/cfd-artifacts` route, e.g. `http://PUBLIC_HOST:49101/cfd-artifacts`. */
  publicCfdArtifactsUrl: string;
  log: Pick<StructLogger, "warn">;
}

// ── commands and outcomes ─────────────────────────────────────────────────────

export interface EvaluateFindingsCommand {
  runId: string;
  thresholdUMs: number;
  /** Governance model binding of the issue; null = unbound annotation. */
  modelVersionId: string | null;
  /** Directions to evaluate; null = every direction of the run. */
  windFromDegrees: readonly number[] | null;
  /** Operator principal the route resolved: issue provenance and the ledger fallback owner. */
  principal: string;
}

export type CfdFindingSkipReason = "direction_not_ready" | "below_threshold" | "not_in_run" | "overlay_missing";

/** One evaluated direction, in the `CfdFindingEvaluation` wire shape. */
export interface CfdFindingEvaluation {
  wind_from_degrees: number;
  u_max_m_s: number | null;
  exceeds: boolean;
  finding: CfdFinding | null;
  idempotent_replay: boolean;
  skipped_reason: CfdFindingSkipReason | null;
}

/** An upstream reply other than 200, passed through (401/403 never reach here: they are `unavailable`). */
export interface ForwardedReply {
  kind: "forwarded";
  status: number;
  body: Record<string, unknown>;
}

export interface UpstreamUnavailable {
  kind: "unavailable";
  detail: string;
}

export type FindingsOutcome =
  | {
    kind: "evaluated";
    runId: string;
    thresholdUMs: number;
    validationLevel: CfdFinding["validation_level"];
    createdCount: number;
    evaluated: CfdFindingEvaluation[];
  }
  | ForwardedReply
  | { kind: "run_not_ready"; runStatus: string }
  | { kind: "run_not_found" }
  /** Governance refused or failed mid-way: findings recorded before the failure stay recorded (`createdCount`). */
  | { kind: "governance_unavailable"; detail: string; createdCount: number; evaluated: CfdFindingEvaluation[] }
  | UpstreamUnavailable;

export interface BindOverlayCommand {
  sessionId: string;
  runId: string;
  windFromDegrees: number;
}

export interface CfdOverlayBinding {
  sessionId: string;
  binding: ArtifactBinding;
  runId: string;
  windFromDegrees: number;
}

export type OverlayOutcome =
  | ({ kind: "bound" } & CfdOverlayBinding)
  | ({ kind: "replayed" } & CfdOverlayBinding)
  | ForwardedReply
  | { kind: "session_not_found" }
  | { kind: "session_not_active"; sessionStatus: SessionStatus }
  | { kind: "direction_not_ready" }
  | { kind: "session_without_model" }
  | { kind: "model_mismatch" }
  /** The session store's invariants (ready-review projection, immutable identity) refused the write. */
  | { kind: "session_not_overlayable"; detail: string }
  | UpstreamUnavailable;

export type UnbindOutcome =
  | { kind: "removed"; sessionId: string; bindingId: string }
  | { kind: "binding_not_found" }
  | { kind: "session_not_found" };

// ── helpers ────────────────────────────────────────────────────────────────────

/** `<public base>/<run id>/<file>`: where the browser and Kit fetch a run's artifacts. */
export function cfdArtifactPublicUrl(publicCfdArtifactsUrl: string, runId: string, filename: string): string {
  return `${publicCfdArtifactsUrl.replace(/\/+$/, "")}/${encodeURIComponent(runId)}/${encodeURIComponent(filename)}`;
}

const TOKEN_REJECTED = "streaming CFD job service rejected the coordinator internal token";

async function upstream(call: () => Promise<CfdUpstreamReply>): Promise<{ ok: true; reply: CfdUpstreamReply } | UpstreamUnavailable & { ok: false }> {
  try {
    return { ok: true, reply: await call() };
  } catch (error) {
    return { ok: false, kind: "unavailable", detail: error instanceof CfdUpstreamUnavailable ? error.message : "streaming CFD job service error" };
  }
}

/**
 * A non-200 reply. The internal token is a coordinator↔streaming credential, so an upstream 401/403 is a
 * coordinator misconfiguration, not the browser's authentication problem: it becomes `unavailable`.
 */
function notOk(reply: CfdUpstreamReply): ForwardedReply | UpstreamUnavailable {
  return reply.status === 401 || reply.status === 403
    ? { kind: "unavailable", detail: TOKEN_REJECTED }
    : { kind: "forwarded", status: reply.status, body: reply.body };
}

function evaluation(
  deg: number, uMax: number | null, exceeds: boolean, finding: CfdFinding | null, replay: boolean, skipped: CfdFindingSkipReason | null,
): CfdFindingEvaluation {
  return { wind_from_degrees: deg, u_max_m_s: uMax, exceeds, finding, idempotent_replay: replay, skipped_reason: skipped };
}

// ── workflow ───────────────────────────────────────────────────────────────────

export class CfdRunWorkflow {
  /**
   * One finding evaluation at a time per run: the ledger check → governance create → ledger record sequence is
   * not atomic, so two interleaved evaluations of the same (run, direction, threshold, model) would both pass
   * the ledger check. In-memory per process.
   */
  private readonly findingLocks = new Map<string, Promise<void>>();

  constructor(private readonly deps: CfdRunWorkflowDeps) {}

  /**
   * Open one governance annotation per ready direction whose pedestrian-plane |U|max exceeds the threshold.
   * Idempotent per (run, direction, threshold, model binding) through the ledger, and through a governance
   * lookup when the ledger lost the finding; severity is `high` above 1.5 × threshold.
   */
  async evaluateFindings(command: EvaluateFindingsCommand): Promise<FindingsOutcome> {
    const { client, ledger, governanceIssues } = this.deps;
    const fetched = await upstream(() => client.getRunResult(command.runId));
    if (!fetched.ok) return { kind: "unavailable", detail: fetched.detail };
    if (fetched.reply.status !== 200) return notOk(fetched.reply);
    const result = fetched.reply.body;
    if (result.status !== "ready") return { kind: "run_not_ready", runStatus: String(result.status) };

    let ledgerRecord = ledger.get(command.runId);
    if (!ledgerRecord) {
      // Ledger lost or the run was created elsewhere: project the real status document, not a skeleton.
      const status = await upstream(() => client.getRun(command.runId));
      if (!status.ok) return { kind: "unavailable", detail: status.detail };
      if (status.reply.status === 200) ledgerRecord = ledger.upsertFromStatus(status.reply.body, { principal: command.principal });
    }
    if (!ledgerRecord) return { kind: "run_not_found" };

    const validationLevel = (typeof result.validation_level === "string" ? result.validation_level : "screening") as CfdFinding["validation_level"];
    const threshold = command.thresholdUMs;
    const modelVersionId = command.modelVersionId;
    const requested = command.windFromDegrees ? new Set(command.windFromDegrees) : null;
    const allDirections = (result.directions as Array<Record<string, unknown>> | undefined) ?? [];
    const directions = allDirections.filter((direction) => !requested || requested.has(Number(direction.wind_from_degrees)));
    const present = new Set(allDirections.map((direction) => Number(direction.wind_from_degrees)));
    const evaluated: CfdFindingEvaluation[] = [];
    for (const deg of requested ?? []) {
      if (!present.has(deg)) evaluated.push(evaluation(deg, null, false, null, false, "not_in_run"));
    }
    const origin = ledgerRecord.origin ?? null;

    return this.withRunLock(command.runId, async (): Promise<FindingsOutcome> => {
      let created = 0;
      const fail = (detail: string): FindingsOutcome => ({ kind: "governance_unavailable", detail, createdCount: created, evaluated });
      for (const direction of directions) {
        const deg = Number(direction.wind_from_degrees);
        const plane = direction.pedestrian_1p5m as { U_magnitude_max?: unknown } | null | undefined;
        const uMax = typeof plane?.U_magnitude_max === "number" ? plane.U_magnitude_max : null;
        if (direction.status !== "ready" || uMax === null) {
          evaluated.push(evaluation(deg, uMax, false, null, false, "direction_not_ready"));
          continue;
        }
        if (uMax <= threshold) {
          evaluated.push(evaluation(deg, uMax, false, null, false, "below_threshold"));
          continue;
        }
        // The issue must point at a prim of this run's overlay layer; without a valid overlay artifact of this run the
        // exceedance is reported as such but no issue is opened (it would carry a prim path Kit cannot resolve).
        const overlayArtifact = cfdOverlayArtifactId.safeParse((direction.overlay_layer as { artifact_id?: unknown } | null | undefined)?.artifact_id);
        if (!overlayArtifact.success || overlayArtifact.data.split(":")[1] !== command.runId) {
          evaluated.push(evaluation(deg, uMax, true, null, false, "overlay_missing"));
          continue;
        }
        const existing = ledger.findFinding(command.runId, deg, threshold, modelVersionId);
        if (existing) {
          evaluated.push(evaluation(deg, uMax, true, existing, true, null));
          continue;
        }
        const severity: CfdFinding["severity"] = uMax > threshold * 1.5 ? "high" : "medium";
        const payload = cfdFindingIssuePayload({
          runId: command.runId, overlayArtifactId: overlayArtifact.data, deg, uMax, threshold, severity, validationLevel, modelVersionId,
          result, origin, openedBy: command.principal,
        });
        let issue: GovernanceIssueRef;
        let replay = false;
        try {
          const found = await governanceIssues.findAnnotation({ title: payload.title, usdPrimPath: payload.usd_prim_path, modelVersionId: payload.model_version_id });
          if (found) {
            issue = found;
            replay = true;
          } else {
            issue = await governanceIssues.createIssue(payload);
          }
        } catch (error) {
          return fail(error instanceof Error ? error.message : String(error));
        }
        const finding = ledger.addFinding(command.runId, {
          wind_from_degrees: deg, threshold_u_m_s: threshold, u_max_m_s: uMax, severity, issue_id: issue.id,
          issue_kind: issue.kind === "issue" ? "issue" : "annotation", model_version_id: modelVersionId, validation_level: validationLevel,
          opened_by: command.principal, created_at: new Date().toISOString(),
        });
        if (!replay) created += 1;
        evaluated.push(evaluation(deg, uMax, true, finding, replay, null));
      }
      return { kind: "evaluated", runId: command.runId, thresholdUMs: threshold, validationLevel, createdCount: created, evaluated };
    });
  }

  /**
   * Register a finished direction's overlay layer as `ArtifactBinding(artifact_role: "overlay")` on a mutable review
   * session, so the existing stage-binding + loadArtifactGroupRequest path loads it. The overlay identity is the
   * upstream `artifact_id` verbatim (Python and JS round .5 differently, so the coordinator never re-derives the
   * `wNNN` tag); a second registration of the same artifact replays the existing binding.
   */
  async bindOverlay(command: BindOverlayCommand): Promise<OverlayOutcome> {
    const { client, store } = this.deps;
    const session = store.get(command.sessionId);
    if (!session) return { kind: "session_not_found" };
    if (!isSessionMutable(session)) return { kind: "session_not_active", sessionStatus: session.status };

    const fetched = await upstream(() => client.getRunResult(command.runId));
    if (!fetched.ok) return { kind: "unavailable", detail: fetched.detail };
    if (fetched.reply.status !== 200) return notOk(fetched.reply);
    const result = fetched.reply.body;
    const directions = (result.directions as Array<Record<string, unknown>> | undefined) ?? [];
    // Exact match on the requested angle.
    const direction = directions.find((item) => Number(item.wind_from_degrees) === command.windFromDegrees);
    const layer = direction?.overlay_layer as Record<string, unknown> | null | undefined;
    if (!direction || direction.status !== "ready" || !layer || typeof layer.filename !== "string") return { kind: "direction_not_ready" };
    const artifactId = cfdOverlayArtifactId.safeParse(layer.artifact_id);
    if (!artifactId.success) return { kind: "unavailable", detail: "upstream overlay artifact_id is malformed" };

    // Re-read right before the write: the upstream await above may have interleaved with another
    // registration on the same session. Everything from here to store.update is synchronous.
    const fresh = store.get(session.session_id);
    if (!fresh) return { kind: "session_not_found" };
    const existing = fresh.artifact_bindings.find((binding) => binding.artifact_id === artifactId.data);
    if (existing) {
      return { kind: "replayed", sessionId: fresh.session_id, binding: existing, runId: command.runId, windFromDegrees: command.windFromDegrees };
    }
    const primary = fresh.artifact_bindings.find((binding) => binding.artifact_role === "derived") ?? fresh.artifact_bindings[0];
    if (!primary) return { kind: "session_without_model" };
    const source = (result.source ?? {}) as { conversion_job_id?: unknown };
    // S7 makes runs of other models reachable from a session's panel; an overlay must belong to the session's model.
    if (typeof source.conversion_job_id === "string" && primary.conversion_job_id && source.conversion_job_id !== primary.conversion_job_id) {
      return { kind: "model_mismatch" };
    }
    const binding: ArtifactBinding = {
      binding_id: `binding_${artifactId.data.replace(/[^A-Za-z0-9_]/g, "_")}`,
      artifact_group_id: primary.artifact_group_id,
      model_version_id: primary.model_version_id,
      artifact_id: artifactId.data,
      display_name: `CFD ${command.windFromDegrees}° (design comparison only)`,
      artifact_role: "overlay",
      url: cfdArtifactPublicUrl(this.deps.publicCfdArtifactsUrl, command.runId, layer.filename),
      mapping_url: null,
      load_order: Math.max(0, ...fresh.artifact_bindings.map((item) => item.load_order)) + 1,
      routing_policy: primary.routing_policy,
      ready_status: "ready",
      conversion_authority: "bim-streaming-server",
      conversion_job_id: typeof source.conversion_job_id === "string" ? source.conversion_job_id : primary.conversion_job_id ?? null,
      conversion_status: "ready",
      failure_code: null,
      diagnostic: null,
    };
    let updated: ReturnType<SessionStore["update"]>;
    try {
      updated = store.update(fresh.session_id, { artifact_bindings: [...fresh.artifact_bindings, binding] });
    } catch (error) {
      return { kind: "session_not_overlayable", detail: error instanceof Error ? error.message : "session rejected the overlay binding" };
    }
    if (!updated) return { kind: "session_not_found" };
    return { kind: "bound", sessionId: fresh.session_id, binding, runId: command.runId, windFromDegrees: command.windFromDegrees };
  }

  /**
   * Remove an overlay binding. Only `overlay` bindings can be removed here. Works whether or not CFD is enabled
   * (cleanup) and carries no lifecycle gate (an open product decision); a session file that vanishes between the
   * read and the write is logged and still answered as removed.
   */
  async unbindOverlay(sessionId: string, bindingId: string): Promise<UnbindOutcome> {
    const { store, log } = this.deps;
    const session = store.get(sessionId);
    if (!session) return { kind: "session_not_found" };
    const target = session.artifact_bindings.find((binding) => binding.binding_id === bindingId);
    if (!target || target.artifact_role !== "overlay") return { kind: "binding_not_found" };
    const updated = store.update(session.session_id, { artifact_bindings: session.artifact_bindings.filter((binding) => binding.binding_id !== bindingId) });
    if (!updated) {
      log.warn("cfd-overlays", "review session vanished while its CFD overlay binding was being removed", { session_id: session.session_id, binding_id: bindingId });
    }
    return { kind: "removed", sessionId: session.session_id, bindingId };
  }

  private async withRunLock<T>(runId: string, work: () => Promise<T>): Promise<T> {
    const previous = this.findingLocks.get(runId) ?? Promise.resolve();
    let release: () => void = () => {};
    const current = new Promise<void>((resolve) => { release = resolve; });
    // The map holds the chained promise, so compare against that one when cleaning up (the route-level lock
    // compared against `current`, which never matched, and kept one entry per run id for the process lifetime).
    const tail = previous.then(() => current);
    this.findingLocks.set(runId, tail);
    await previous;
    try {
      return await work();
    } finally {
      release();
      if (this.findingLocks.get(runId) === tail) this.findingLocks.delete(runId);
    }
  }

  /** @internal test probe: runs whose finding lock is still held or queued. */
  pendingFindingLocks(): number {
    return this.findingLocks.size;
  }
}
