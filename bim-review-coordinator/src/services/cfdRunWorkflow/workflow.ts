// CFD Run Workflow (docs/architecture/cfd-run-workflow-adr.md).
//
// The coordinator-side policy of a CFD run: source binding and create, the ledger projection behind list,
// detail and cancel, public artifact URLs, the finding workflow (pedestrian-wind exceedance → governance issue)
// and overlay registration / removal on a review session. Routes parse the request, call one method and map the
// closed outcome to the status codes and `error_code` values of the Coordinator Browser Contract. The streaming
// CFD job service, the conversion authority, governance-service and the session store are reached only through
// the dependencies given to the constructor; the ledger is an implementation detail the routes never see.
import type { z } from "zod/v4";
import { cfdOverlayArtifactId, type cfdRunCreateRequest } from "../../contract/schemas/cfd.js";
import type { StructLogger } from "../../lib/structLog.js";
import type { ArtifactBinding, SessionStatus } from "../../types.js";
import type { CfdRunClient, CfdUpstreamReply } from "../cfdRunClient.js";
import { CfdUpstreamUnavailable } from "../cfdRunClient.js";
import type { CfdFinding, CfdRunLedger, CfdRunLedgerRecord, CfdRunOrigin } from "../cfdRunLedger.js";
import { isSessionMutable, type SessionStore } from "../sessionStore.js";
import type { StreamingConversionResult } from "../streamingConversionClient.js";
import { cfdFindingIssuePayload, type CfdFindingIssuePayload } from "./findingIssuePayload.js";

// ── ports ──────────────────────────────────────────────────────────────────────

/** The streaming CFD job service as this workflow uses it: `CfdRunClient` in production, an in-memory run store in tests. */
export type CfdRunPort = Pick<CfdRunClient,
  "createRun" | "listRuns" | "getRun" | "getRunResult" | "getRunExclusions" | "cancelRun" | "getOptions" | "estimate">;

/** The conversion authority's result of one conversion job, classified (the HTTP adapter owns the client's message format). */
export interface ConversionResultPort {
  fetch(conversionJobId: string): Promise<
    | { kind: "found"; result: Pick<StreamingConversionResult, "ready" | "status" | "raw"> }
    | { kind: "not_found" }
    | { kind: "unavailable"; detail: string }>;
}

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
  conversionResults: ConversionResultPort;
  governanceIssues: GovernanceIssuePort;
  store: SessionStore;
  ledger: CfdRunLedger;
  /** Public origin of the streaming `/cfd-artifacts` route, e.g. `http://PUBLIC_HOST:49101/cfd-artifacts`. */
  publicCfdArtifactsUrl: string;
  log: Pick<StructLogger, "warn">;
}

// ── commands and outcomes ─────────────────────────────────────────────────────

/** A parsed `cfd-run-request/v1` body as the browser sends it: no sha, no `requested_by`, an optional `origin`. */
export type CfdRunCreateBody = z.output<typeof cfdRunCreateRequest>;

export interface CreateRunCommand {
  request: CfdRunCreateBody;
  /** Operator principal the route resolved (`requested_by.principal`). */
  principal: string;
  /** Trace id the route resolved (`requested_by.trace_id`). */
  traceId: string;
}

export interface CfdRunListQuery {
  conversion_job_id?: string;
  status?: string;
  limit?: number;
}

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

/** An upstream reply passed through as it came (401/403 never are: they are `unavailable`). */
export interface ForwardedReply {
  kind: "forwarded";
  status: number;
  body: Record<string, unknown>;
}

export interface UpstreamUnavailable {
  kind: "unavailable";
  detail: string;
}

/** Any upstream reply passed through as it came (success included), except 401/403, which are `unavailable`. */
export type PassThroughOutcome = ForwardedReply | UpstreamUnavailable;

export type CreateRunOutcome =
  | ForwardedReply
  | { kind: "conversion_not_found" }
  | { kind: "source_not_ready"; conversionStatus: string }
  /** The conversion result carries no valid model.usdc checksum, so the run cannot be bound to an exact model. */
  | { kind: "source_mismatch" }
  | UpstreamUnavailable;

export interface ListOutcome {
  kind: "records";
  items: CfdRunLedgerRecord[];
  enabled: boolean;
  /** The streaming service could not be read; the items are the ledger's last projection. */
  stale: boolean;
}

export type DetailOutcome =
  | { kind: "detail"; ledger: CfdRunLedgerRecord | null; status: Record<string, unknown> }
  /** The streaming service could not be read; the ledger still knows the run. */
  | { kind: "stale_record"; ledger: CfdRunLedgerRecord }
  | ForwardedReply
  | UpstreamUnavailable;

export type ResultOutcome =
  | { kind: "result"; body: Record<string, unknown> }
  | ForwardedReply
  | UpstreamUnavailable;

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

/** The detail an unexpected failure reports: the client's own unreachable message, otherwise a fixed text (never raw error text). */
function unavailableDetail(error: unknown): string {
  return error instanceof CfdUpstreamUnavailable ? error.message : "streaming CFD job service error";
}

async function upstream(call: () => Promise<CfdUpstreamReply>): Promise<{ ok: true; reply: CfdUpstreamReply } | UpstreamUnavailable & { ok: false }> {
  try {
    return { ok: true, reply: await call() };
  } catch (error) {
    return { ok: false, kind: "unavailable", detail: unavailableDetail(error) };
  }
}

/**
 * Pass a reply through as it came. The internal token is a coordinator↔streaming credential, so an upstream 401/403
 * is a coordinator misconfiguration, not the browser's authentication problem: it becomes `unavailable`.
 */
function passThrough(reply: CfdUpstreamReply): PassThroughOutcome {
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
   * Bind the run to the exact model.usdc of its conversion (the sha256 comes from the conversion authority's own
   * result, never from the browser), fill `requested_by`, strip the browser-only `origin`, forward the request and
   * project the reply into the ledger. The origin is recorded only on 202: a 200 is an idempotent replay whose body
   * the streaming service ignored.
   */
  async createRun(command: CreateRunCommand): Promise<CreateRunOutcome> {
    const { client, ledger, conversionResults } = this.deps;
    const body = command.request;
    const conversionJobId = body.source.conversion_job_id;
    const conversion = await conversionResults.fetch(conversionJobId);
    if (conversion.kind === "not_found") return { kind: "conversion_not_found" };
    if (conversion.kind === "unavailable") return { kind: "unavailable", detail: conversion.detail };
    if (!conversion.result.ready) return { kind: "source_not_ready", conversionStatus: conversion.result.status };
    const artifacts = (conversion.result.raw.artifacts ?? {}) as Record<string, Record<string, unknown> | undefined>;
    const checksum = artifacts.model_usdc?.checksum_sha256;
    const modelSha = typeof checksum === "string" && /^[0-9a-f]{64}$/.test(checksum) ? checksum : null;
    if (!modelSha) return { kind: "source_mismatch" };

    // S7: `origin` is coordinator-side context; the frozen streaming request rejects unknown top-level keys.
    const { origin, ...forwarded } = body;
    const internalBody = {
      ...forwarded,
      source: { conversion_job_id: conversionJobId, model_usdc_sha256: modelSha },
      requested_by: { principal: command.principal, trace_id: command.traceId },
    };
    const ledgerOrigin: CfdRunOrigin = {
      session_id: origin?.session_id ?? null,
      wind_from_degrees: body.wind.wind_from_degrees,
      uref_m_s: body.wind.uref_m_s,
      end_time: body.solver.end_time ?? null,
      n_procs: body.solver.n_procs ?? null,
      background_cell_m: body.mesh.background_cell_m ?? null,
      // S8: terrain / true-north settings as submitted; the manual angle only counts when the source is manual.
      zref_m: body.wind.zref_m,
      z0_m: body.wind.z0_m,
      true_north_source: body.wind.true_north_source,
      true_north_degrees_manual: body.wind.true_north_source === "manual" ? body.wind.true_north_degrees_manual ?? null : null,
    };
    try {
      const reply = await client.createRun(internalBody);
      if (reply.status === 202 || reply.status === 200) {
        const profile = reply.body.settings_profile as { preset_match?: unknown } | undefined;
        const presetMatch = typeof profile?.preset_match === "string" ? profile.preset_match : null;
        const recorded = reply.status === 202 ? { ...ledgerOrigin, preset_match: presetMatch } : undefined;
        ledger.upsertFromStatus(reply.body, { principal: command.principal, conversion_job_id: conversionJobId, origin: recorded });
      }
      return passThrough(reply);
    } catch (error) {
      return { kind: "unavailable", detail: unavailableDetail(error) };
    }
  }

  /**
   * The ledger projection, refreshed from the streaming service when CFD is enabled. When CFD is disabled, or the
   * streaming service cannot be read, the ledger's last projection is served (`enabled` / `stale` say which).
   */
  async listRuns(query: CfdRunListQuery, options: { enabled: boolean }): Promise<ListOutcome> {
    const { client, ledger } = this.deps;
    if (!options.enabled) return { kind: "records", items: ledger.list(query), enabled: false, stale: false };
    let stale = false;
    try {
      const reply = await client.listRuns(query);
      if (reply.status === 200) {
        ledger.upsertAllFromStatus((reply.body.items as Array<Record<string, unknown>> | undefined) ?? []);
      } else {
        stale = true;
      }
    } catch {
      stale = true;
    }
    return { kind: "records", items: ledger.list(query), enabled: true, stale };
  }

  /** The run's status document and its ledger projection; the ledger alone (`stale_record`) when streaming is unreachable. */
  async getRun(runId: string): Promise<DetailOutcome> {
    const { client, ledger } = this.deps;
    try {
      const reply = await client.getRun(runId);
      if (reply.status !== 200) return passThrough(reply);
      return { kind: "detail", ledger: ledger.upsertFromStatus(reply.body), status: reply.body };
    } catch (error) {
      const cached = ledger.get(runId);
      if (cached) return { kind: "stale_record", ledger: cached };
      return { kind: "unavailable", detail: unavailableDetail(error) };
    }
  }

  /** The run's result document with every artifact URL rewritten to the public streaming origin. */
  async getRunResult(runId: string): Promise<ResultOutcome> {
    const fetched = await upstream(() => this.deps.client.getRunResult(runId));
    if (!fetched.ok) return { kind: "unavailable", detail: fetched.detail };
    if (fetched.reply.status !== 200) return passThrough(fetched.reply);
    try {
      return { kind: "result", body: this.publicizeResult(fetched.reply.body) };
    } catch (error) {
      // A 200 the coordinator cannot rewrite is as unusable as an unreachable service (never raw error text).
      return { kind: "unavailable", detail: unavailableDetail(error) };
    }
  }

  async getRunExclusions(runId: string): Promise<PassThroughOutcome> {
    const fetched = await upstream(() => this.deps.client.getRunExclusions(runId));
    return fetched.ok ? passThrough(fetched.reply) : { kind: "unavailable", detail: fetched.detail };
  }

  /** Forward the cancel; a 200 status document is projected into the ledger. */
  async cancelRun(runId: string): Promise<PassThroughOutcome> {
    const { client, ledger } = this.deps;
    try {
      const reply = await client.cancelRun(runId);
      if (reply.status === 200) ledger.upsertFromStatus(reply.body);
      return passThrough(reply);
    } catch (error) {
      return { kind: "unavailable", detail: unavailableDetail(error) };
    }
  }

  /** S8: `cfd-options/v1`, passed through. */
  async getOptions(): Promise<PassThroughOutcome> {
    const fetched = await upstream(() => this.deps.client.getOptions());
    return fetched.ok ? passThrough(fetched.reply) : { kind: "unavailable", detail: fetched.detail };
  }

  /** S8: a `cfd-estimate-request/v1` body forwarded unchanged; `cfd-estimate/v1` passed through. */
  async estimate(body: Record<string, unknown>): Promise<PassThroughOutcome> {
    const fetched = await upstream(() => this.deps.client.estimate(body));
    return fetched.ok ? passThrough(fetched.reply) : { kind: "unavailable", detail: fetched.detail };
  }

  /**
   * Open one governance annotation per ready direction whose pedestrian-plane |U|max exceeds the threshold.
   * Idempotent per (run, direction, threshold, model binding) through the ledger, and through a governance
   * lookup when the ledger lost the finding; severity is `high` above 1.5 × threshold.
   */
  async evaluateFindings(command: EvaluateFindingsCommand): Promise<FindingsOutcome> {
    const { client, ledger, governanceIssues } = this.deps;
    const fetched = await upstream(() => client.getRunResult(command.runId));
    if (!fetched.ok) return { kind: "unavailable", detail: fetched.detail };
    if (fetched.reply.status !== 200) return passThrough(fetched.reply);
    const result = fetched.reply.body;
    if (result.status !== "ready") return { kind: "run_not_ready", runStatus: String(result.status) };

    let ledgerRecord = ledger.get(command.runId);
    if (!ledgerRecord) {
      // Ledger lost or the run was created elsewhere: project the real status document, not a skeleton. The projection
      // write shares the fetch's failure mapping, so a ledger write error never reaches the browser as raw text.
      try {
        const status = await client.getRun(command.runId);
        if (status.status === 200) ledgerRecord = ledger.upsertFromStatus(status.body, { principal: command.principal });
      } catch (error) {
        return { kind: "unavailable", detail: unavailableDetail(error) };
      }
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
    if (fetched.reply.status !== 200) return passThrough(fetched.reply);
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

  /** Replace streaming loopback URLs in a result document with the public origin. */
  private publicizeResult(result: Record<string, unknown>): Record<string, unknown> {
    const runId = typeof result.run_id === "string" ? result.run_id : "";
    const publicUrl = (filename: string): string => cfdArtifactPublicUrl(this.deps.publicCfdArtifactsUrl, runId, filename);
    const directions = Array.isArray(result.directions) ? result.directions : [];
    for (const direction of directions as Array<Record<string, unknown>>) {
      const layer = direction.overlay_layer as Record<string, unknown> | null | undefined;
      if (layer && typeof layer.filename === "string") layer.url = publicUrl(layer.filename);
    }
    for (const key of ["run_record", "exclusions"] as const) {
      const ref = result[key] as Record<string, unknown> | undefined;
      if (ref && typeof ref.filename === "string") ref.url = publicUrl(ref.filename);
    }
    return result;
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
