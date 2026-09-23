// Browser-facing CFD wind-run routes (building-energy-cfd-p2-contract.md §3.2, slices S2/S2.1).
//
// The browser talks only to the coordinator; the coordinator is the single caller of the streaming CFD job service.
// Every route parses the request, resolves the caller (operator guard, principal, trace id), calls one CFD Run
// Workflow method (docs/architecture/cfd-run-workflow-adr.md) and maps its closed outcome to the status codes and
// `error_code` values below. The policy (binding a run to one exact model.usdc, the ledger projection, public artifact
// URLs, finding idempotency, overlay identity and model match) lives in the workflow. No new Kit command, no
// governance route.
//
// S2.1 (post-merge review of #888): every handler is wrapped so a rejected promise reaches the app error handler;
// the provenance principal comes from the user auth provider.
import type { Express, Request, RequestHandler, Response } from "express";
import { randomBytes } from "node:crypto";
import {
  cfdBindingIdParam,
  cfdEstimateRequest,
  cfdFindingRequest,
  cfdOverlayRegistrationRequest,
  cfdRunCreateRequest,
  cfdRunId,
  cfdRunListQuery,
  cfdSessionIdParam,
} from "../contract/schemas/cfd.js";
import type { CfdOverlayBinding, CfdRunWorkflow, PassThroughOutcome } from "../services/cfdRunWorkflow/index.js";

export interface CfdRunRoutesOptions {
  enabled: boolean;
  workflow: CfdRunWorkflow;
  rejectIfUnauthorized: (request: Request, response: Response) => boolean;
  /**
   * Authenticated user id for `requested_by.principal` (same provider as stage-binding).
   * Return null when the caller carries no user identity; a fixed subject is recorded instead.
   */
  authenticatePrincipal: (request: Request) => string | null;
}

export const ANONYMOUS_CFD_PRINCIPAL = "coordinator-browser";

/** Derive `.../cfd-artifacts` from the public `/artifacts` URL the coordinator already trusts. */
export function derivePublicCfdArtifactsUrl(publicArtifactsUrl: string): string {
  const trimmed = publicArtifactsUrl.replace(/\/+$/, "");
  return trimmed.endsWith("/artifacts") ? `${trimmed.slice(0, -"/artifacts".length)}/cfd-artifacts` : `${trimmed}/cfd-artifacts`;
}

function issuesText(issues: ReadonlyArray<{ path: PropertyKey[]; message: string }>): string {
  return issues.slice(0, 8).map((issue) => `${issue.path.map(String).join(".")}: ${issue.message}`).join("; ");
}

function traceIdOf(request: Request): string {
  const header = request.header("x-trace-id");
  return header && /^[A-Za-z0-9._:-]{1,200}$/.test(header) ? header : `trace_cfd_${randomBytes(8).toString("hex")}`;
}

type AsyncHandler = (request: Request, response: Response) => Promise<void> | void;

/** Express 4 does not forward rejected promises; route every failure into the app error handler. */
function route(handler: AsyncHandler): RequestHandler {
  return (request, response, next) => {
    Promise.resolve()
      .then(() => handler(request, response))
      .catch(next);
  };
}

/** The streaming service could not be used: unreachable, or it refused the coordinator's own internal token. */
function sendUnavailable(response: Response, detail: string): void {
  response.status(502).json({ error_code: "cfd_upstream_unavailable", detail });
}

function sendPassThrough(response: Response, outcome: PassThroughOutcome): void {
  if (outcome.kind === "unavailable") {
    sendUnavailable(response, outcome.detail);
    return;
  }
  response.status(outcome.status).json(outcome.body);
}

export function registerCfdRunRoutes(app: Express, options: CfdRunRoutesOptions): void {
  const { workflow } = options;

  const principalOf = (request: Request): string => {
    const authenticated = options.authenticatePrincipal(request);
    return authenticated && /^[A-Za-z0-9._:@-]{1,200}$/.test(authenticated) ? authenticated : ANONYMOUS_CFD_PRINCIPAL;
  };

  const disabled = (response: Response): void => {
    response.status(503).json({ error_code: "cfd_disabled", detail: "CFD runs are not enabled on this coordinator (CFD_ENABLED=false)." });
  };

  const notFoundRun = (response: Response): void => {
    response.status(404).json({ error_code: "run_not_found", detail: "CFD run not found." });
  };

  // ── create ──────────────────────────────────────────────────────────────────
  app.post("/api/cfd/runs", route(async (request, response) => {
    response.set("Cache-Control", "no-store");
    if (options.rejectIfUnauthorized(request, response)) return;
    if (!options.enabled) { disabled(response); return; }
    const parsed = cfdRunCreateRequest.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error_code: "invalid_request", detail: issuesText(parsed.error.issues) });
      return;
    }
    const outcome = await workflow.createRun({ request: parsed.data, principal: principalOf(request), traceId: traceIdOf(request) });
    switch (outcome.kind) {
      case "forwarded":
        response.status(outcome.status).json(outcome.body);
        return;
      case "conversion_not_found":
        response.status(404).json({ error_code: "conversion_not_found", detail: "conversion job not found" });
        return;
      case "source_not_ready":
        response.status(409).json({ error_code: "source_not_ready", detail: `conversion ${parsed.data.source.conversion_job_id} is ${outcome.conversionStatus}` });
        return;
      case "source_mismatch":
        response.status(409).json({ error_code: "source_mismatch", detail: "conversion result carries no model.usdc checksum" });
        return;
      case "unavailable":
        sendUnavailable(response, outcome.detail);
        return;
      default:
        assertNever(outcome);
    }
  }));

  // ── S8 settings phase A: options + estimate (read-only pass-through) ───────────
  app.get("/api/cfd/options", route(async (_request, response) => {
    response.set("Cache-Control", "no-store");
    if (!options.enabled) { disabled(response); return; }
    sendPassThrough(response, await workflow.getOptions());
  }));

  app.post("/api/cfd/estimates", route(async (request, response) => {
    response.set("Cache-Control", "no-store");
    // Not a write, but it walks the run history on the streaming host: only callers who may submit runs may ask.
    if (options.rejectIfUnauthorized(request, response)) return;
    if (!options.enabled) { disabled(response); return; }
    const parsed = cfdEstimateRequest.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error_code: "invalid_request", detail: issuesText(parsed.error.issues) });
      return;
    }
    sendPassThrough(response, await workflow.estimate(parsed.data as Record<string, unknown>));
  }));

  // ── list / detail / result / exclusions / cancel ──────────────────────────────
  app.get("/api/cfd/runs", route(async (request, response) => {
    response.set("Cache-Control", "no-store");
    const query = cfdRunListQuery.safeParse(request.query);
    if (!query.success) { response.status(400).json({ error_code: "invalid_request", detail: "unknown or malformed query parameter" }); return; }
    // Disabled CFD still serves the ledger (enabled:false), so earlier runs stay listable.
    const outcome = await workflow.listRuns(query.data, { enabled: options.enabled });
    response.json({ items: outcome.items, count: outcome.items.length, enabled: outcome.enabled, stale: outcome.stale });
  }));

  app.get("/api/cfd/runs/:runId", route(async (request, response) => {
    response.set("Cache-Control", "no-store");
    const runId = cfdRunId.safeParse(request.params.runId);
    if (!runId.success) { notFoundRun(response); return; }
    if (!options.enabled) { disabled(response); return; }
    const outcome = await workflow.getRun(runId.data);
    switch (outcome.kind) {
      case "detail":
        response.json({ ledger: outcome.ledger, status: outcome.status });
        return;
      case "stale_record":
        response.json({ ledger: outcome.ledger, status: null, stale: true });
        return;
      case "forwarded":
        response.status(outcome.status).json(outcome.body);
        return;
      case "unavailable":
        sendUnavailable(response, outcome.detail);
        return;
      default:
        assertNever(outcome);
    }
  }));

  app.get("/api/cfd/runs/:runId/result", route(async (request, response) => {
    response.set("Cache-Control", "no-store");
    const runId = cfdRunId.safeParse(request.params.runId);
    if (!runId.success) { notFoundRun(response); return; }
    if (!options.enabled) { disabled(response); return; }
    const outcome = await workflow.getRunResult(runId.data);
    switch (outcome.kind) {
      case "result":
        response.json(outcome.body);
        return;
      case "forwarded":
        response.status(outcome.status).json(outcome.body);
        return;
      case "unavailable":
        sendUnavailable(response, outcome.detail);
        return;
      default:
        assertNever(outcome);
    }
  }));

  app.get("/api/cfd/runs/:runId/exclusions", route(async (request, response) => {
    response.set("Cache-Control", "no-store");
    const runId = cfdRunId.safeParse(request.params.runId);
    if (!runId.success) { notFoundRun(response); return; }
    if (!options.enabled) { disabled(response); return; }
    sendPassThrough(response, await workflow.getRunExclusions(runId.data));
  }));

  app.post("/api/cfd/runs/:runId/cancel", route(async (request, response) => {
    response.set("Cache-Control", "no-store");
    if (options.rejectIfUnauthorized(request, response)) return;
    const runId = cfdRunId.safeParse(request.params.runId);
    if (!runId.success) { notFoundRun(response); return; }
    if (!options.enabled) { disabled(response); return; }
    sendPassThrough(response, await workflow.cancelRun(runId.data));
  }));

  // ── S6 A1 finding: pedestrian-wind exceedance → existing governance /api/issues ─────────────
  app.post("/api/cfd/runs/:runId/findings", route(async (request, response) => {
    response.set("Cache-Control", "no-store");
    if (options.rejectIfUnauthorized(request, response)) return;
    const runId = cfdRunId.safeParse(request.params.runId);
    if (!runId.success) { notFoundRun(response); return; }
    if (!options.enabled) { disabled(response); return; }
    const parsed = cfdFindingRequest.safeParse(request.body ?? {});
    if (!parsed.success) {
      response.status(400).json({ error_code: "invalid_request", detail: issuesText(parsed.error.issues) });
      return;
    }
    const outcome = await workflow.evaluateFindings({
      runId: runId.data,
      thresholdUMs: parsed.data.threshold_u_m_s,
      modelVersionId: parsed.data.model_version_id ?? null,
      windFromDegrees: parsed.data.wind_from_degrees ?? null,
      principal: principalOf(request),
    });
    switch (outcome.kind) {
      case "evaluated":
        response.status(outcome.createdCount > 0 ? 201 : 200).json({
          run_id: outcome.runId, threshold_u_m_s: outcome.thresholdUMs, validation_level: outcome.validationLevel,
          purpose: "design_comparison_only", created_count: outcome.createdCount, evaluated: outcome.evaluated,
        });
        return;
      case "forwarded":
        response.status(outcome.status).json(outcome.body);
        return;
      case "run_not_ready":
        response.status(409).json({ error_code: "run_not_ready", detail: `run is ${outcome.runStatus}` });
        return;
      case "run_not_found":
        notFoundRun(response);
        return;
      case "governance_unavailable":
        response.status(502).json({ error_code: "governance_unavailable", detail: outcome.detail, created_count: outcome.createdCount, evaluated: outcome.evaluated });
        return;
      case "unavailable":
        response.status(502).json({ error_code: "cfd_upstream_unavailable", detail: outcome.detail });
        return;
      default:
        assertNever(outcome);
    }
  }));

  // ── overlay binding on a review session ─────────────────────────────────────
  const overlayResponse = (overlay: CfdOverlayBinding, replay: boolean) => ({
    session_id: overlay.sessionId, binding_id: overlay.binding.binding_id, artifact_id: overlay.binding.artifact_id, artifact_role: "overlay" as const,
    load_order: overlay.binding.load_order, url: overlay.binding.url ?? "", run_id: overlay.runId, wind_from_degrees: overlay.windFromDegrees,
    idempotent_replay: replay,
  });
  const sessionNotFound = (response: Response): void => {
    response.status(404).json({ error_code: "session_not_found", detail: "session not found" });
  };
  const bindingNotFound = (response: Response): void => {
    response.status(404).json({ error_code: "binding_not_found", detail: "binding not found" });
  };

  app.post("/api/review-sessions/:sessionId/cfd-overlays", route(async (request, response) => {
    response.set("Cache-Control", "no-store");
    if (options.rejectIfUnauthorized(request, response)) return;
    if (!options.enabled) { disabled(response); return; }
    const sessionId = cfdSessionIdParam.safeParse(request.params.sessionId);
    const parsed = cfdOverlayRegistrationRequest.safeParse(request.body);
    if (!sessionId.success) { sessionNotFound(response); return; }
    if (!parsed.success) { response.status(400).json({ error_code: "invalid_request", detail: issuesText(parsed.error.issues) }); return; }
    const outcome = await workflow.bindOverlay({ sessionId: sessionId.data, runId: parsed.data.run_id, windFromDegrees: parsed.data.wind_from_degrees });
    switch (outcome.kind) {
      case "bound":
        response.status(201).json(overlayResponse(outcome, false));
        return;
      case "replayed":
        response.status(200).json(overlayResponse(outcome, true));
        return;
      case "forwarded":
        response.status(outcome.status).json(outcome.body);
        return;
      case "session_not_found":
        sessionNotFound(response);
        return;
      case "session_not_active":
        response.status(409).json({ error_code: "session_not_active", detail: `session is ${outcome.sessionStatus}` });
        return;
      case "direction_not_ready":
        response.status(409).json({ error_code: "direction_not_ready", detail: "requested wind direction has no ready overlay layer" });
        return;
      case "session_without_model":
        response.status(409).json({ error_code: "session_without_model", detail: "session has no model artifact binding" });
        return;
      case "model_mismatch":
        response.status(409).json({ error_code: "model_mismatch", detail: "run belongs to a different model than the session's primary binding" });
        return;
      case "session_not_overlayable":
        response.status(409).json({ error_code: "session_not_overlayable", detail: outcome.detail });
        return;
      case "unavailable":
        response.status(502).json({ error_code: "cfd_upstream_unavailable", detail: outcome.detail });
        return;
      default:
        assertNever(outcome);
    }
  }));

  // Removal stays available when CFD is disabled (cleanup of earlier overlays).
  app.delete("/api/review-sessions/:sessionId/cfd-overlays/:bindingId", route(async (request, response) => {
    response.set("Cache-Control", "no-store");
    if (options.rejectIfUnauthorized(request, response)) return;
    const sessionId = cfdSessionIdParam.safeParse(request.params.sessionId);
    const bindingId = cfdBindingIdParam.safeParse(request.params.bindingId);
    if (!sessionId.success || !bindingId.success) { bindingNotFound(response); return; }
    const outcome = await workflow.unbindOverlay(sessionId.data, bindingId.data);
    switch (outcome.kind) {
      case "removed":
        response.json({ session_id: outcome.sessionId, binding_id: outcome.bindingId, removed: true });
        return;
      case "session_not_found":
        sessionNotFound(response);
        return;
      case "binding_not_found":
        bindingNotFound(response);
        return;
      default:
        assertNever(outcome);
    }
  }));
}

function assertNever(outcome: never): never {
  throw new Error(`unhandled CFD workflow outcome: ${JSON.stringify(outcome)}`);
}
