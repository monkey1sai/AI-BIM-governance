// Browser-facing CFD wind-run routes (building-energy-cfd-p2-contract.md §3.2, slices S2/S2.1).
//
// The browser talks only to the coordinator; the coordinator is the single
// caller of the streaming CFD job service. This module binds a run to one exact
// model.usdc (sha256 from the conversion result), keeps the ledger projection,
// rewrites artifact URLs to the public streaming origin and registers finished
// overlay layers as `ArtifactBinding(artifact_role: "overlay")` on a review
// session so the existing stage-binding + loadArtifactGroupRequest path loads
// them. No new Kit command, no governance route.
//
// S2.1 (post-merge review of #888): every handler is wrapped so a rejected promise
// reaches the app error handler; the provenance principal comes from the user auth provider.
//
// CFD Run Workflow (docs/architecture/cfd-run-workflow-adr.md): the finding and overlay routes parse, call
// one workflow method and map its closed outcome to the status codes and `error_code` values below; the
// policy (idempotency, severity, per-run serialization, overlay identity, model match) lives in the workflow.
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
import type { CfdRunClient, CfdUpstreamReply } from "../services/cfdRunClient.js";
import { CfdUpstreamUnavailable } from "../services/cfdRunClient.js";
import type { CfdRunLedger } from "../services/cfdRunLedger.js";
import { cfdArtifactPublicUrl, type CfdOverlayBinding, type CfdRunWorkflow } from "../services/cfdRunWorkflow/index.js";
import type { StreamingConversionClient } from "../services/streamingConversionClient.js";

export interface CfdRunRoutesOptions {
  enabled: boolean;
  /** Findings and overlay registration / removal (cfd-run-workflow-adr.md tracer bullet 1). */
  workflow: CfdRunWorkflow;
  client: CfdRunClient;
  ledger: CfdRunLedger;
  streamingConversionClient: Pick<StreamingConversionClient, "fetchConversionResult">;
  /** Public origin of the streaming `/cfd-artifacts` route, e.g. `http://PUBLIC_HOST:49101/cfd-artifacts`. */
  publicCfdArtifactsUrl: string;
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

function sendUpstream(response: Response, reply: CfdUpstreamReply): void {
  // The internal token is a coordinator<->streaming credential; an upstream 401/403 is a
  // coordinator misconfiguration, not the browser's authentication problem.
  if (reply.status === 401 || reply.status === 403) {
    response.status(502).json({ error_code: "cfd_upstream_unavailable", detail: "streaming CFD job service rejected the coordinator internal token" });
    return;
  }
  response.status(reply.status).json(reply.body);
}

function sendUnavailable(response: Response, error: unknown): void {
  const detail = error instanceof CfdUpstreamUnavailable ? error.message : "streaming CFD job service error";
  response.status(502).json({ error_code: "cfd_upstream_unavailable", detail });
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

export function registerCfdRunRoutes(app: Express, options: CfdRunRoutesOptions): void {
  const { client, ledger, workflow } = options;

  const publicUrl = (runId: string, filename: string): string => cfdArtifactPublicUrl(options.publicCfdArtifactsUrl, runId, filename);

  const principalOf = (request: Request): string => {
    const authenticated = options.authenticatePrincipal(request);
    return authenticated && /^[A-Za-z0-9._:@-]{1,200}$/.test(authenticated) ? authenticated : ANONYMOUS_CFD_PRINCIPAL;
  };

  /** Replace streaming loopback URLs in a result document with the public origin. */
  const publicizeResult = (result: Record<string, unknown>): Record<string, unknown> => {
    const runId = typeof result.run_id === "string" ? result.run_id : "";
    const directions = Array.isArray(result.directions) ? result.directions : [];
    for (const direction of directions as Array<Record<string, unknown>>) {
      const layer = direction.overlay_layer as Record<string, unknown> | null | undefined;
      if (layer && typeof layer.filename === "string") layer.url = publicUrl(runId, layer.filename);
    }
    for (const key of ["run_record", "exclusions"] as const) {
      const ref = result[key] as Record<string, unknown> | undefined;
      if (ref && typeof ref.filename === "string") ref.url = publicUrl(runId, ref.filename);
    }
    return result;
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
    const body = parsed.data;

    // Bind to the exact model.usdc: the sha256 comes from the conversion authority's own result,
    // never from the browser.
    let modelSha: string | null = null;
    try {
      const conversion = await options.streamingConversionClient.fetchConversionResult(body.source.conversion_job_id);
      if (!conversion.ready) {
        response.status(409).json({ error_code: "source_not_ready", detail: `conversion ${body.source.conversion_job_id} is ${conversion.status}` });
        return;
      }
      const artifacts = (conversion.raw.artifacts ?? {}) as Record<string, Record<string, unknown> | undefined>;
      const checksum = artifacts.model_usdc?.checksum_sha256;
      modelSha = typeof checksum === "string" && /^[0-9a-f]{64}$/.test(checksum) ? checksum : null;
    } catch (error) {
      const message = (error as Error).message ?? "";
      if (/ 404:/.test(message)) {
        response.status(404).json({ error_code: "conversion_not_found", detail: "conversion job not found" });
        return;
      }
      sendUnavailable(response, error);
      return;
    }
    if (!modelSha) {
      response.status(409).json({ error_code: "source_mismatch", detail: "conversion result carries no model.usdc checksum" });
      return;
    }

    const principal = principalOf(request);
    // S7: `origin` is coordinator-side context; the frozen streaming request rejects unknown top-level keys.
    const { origin, ...forwarded } = body;
    const internalBody = {
      ...forwarded,
      source: { conversion_job_id: body.source.conversion_job_id, model_usdc_sha256: modelSha },
      requested_by: { principal, trace_id: traceIdOf(request) },
    };
    const ledgerOrigin = {
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
        // 200 = idempotent replay: streaming ignores the replayed body, so it must not become the recorded origin.
        const profile = reply.body.settings_profile as { preset_match?: unknown } | undefined;
        const presetMatch = typeof profile?.preset_match === "string" ? profile.preset_match : null;
        const origin = reply.status === 202 ? { ...ledgerOrigin, preset_match: presetMatch } : undefined;
        ledger.upsertFromStatus(reply.body, { principal, conversion_job_id: body.source.conversion_job_id, origin });
      }
      sendUpstream(response, reply);
    } catch (error) {
      sendUnavailable(response, error);
    }
  }));

  // ── S8 settings phase A: options + estimate (read-only pass-through) ───────────
  app.get("/api/cfd/options", route(async (_request, response) => {
    response.set("Cache-Control", "no-store");
    if (!options.enabled) { disabled(response); return; }
    try {
      sendUpstream(response, await client.getOptions());
    } catch (error) {
      sendUnavailable(response, error);
    }
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
    try {
      sendUpstream(response, await client.estimate(parsed.data as Record<string, unknown>));
    } catch (error) {
      sendUnavailable(response, error);
    }
  }));

  // ── list / detail ───────────────────────────────────────────────────────────
  app.get("/api/cfd/runs", route(async (request, response) => {
    response.set("Cache-Control", "no-store");
    const query = cfdRunListQuery.safeParse(request.query);
    if (!query.success) { response.status(400).json({ error_code: "invalid_request", detail: "unknown or malformed query parameter" }); return; }
    if (!options.enabled) {
      const items = ledger.list(query.data);
      response.json({ items, count: items.length, enabled: false, stale: false });
      return;
    }
    let stale = false;
    try {
      const reply = await client.listRuns(query.data);
      if (reply.status === 200) {
        ledger.upsertAllFromStatus((reply.body.items as Array<Record<string, unknown>> | undefined) ?? []);
      } else {
        stale = true;
      }
    } catch {
      stale = true;
    }
    const items = ledger.list(query.data);
    response.json({ items, count: items.length, enabled: true, stale });
  }));

  app.get("/api/cfd/runs/:runId", route(async (request, response) => {
    response.set("Cache-Control", "no-store");
    const runId = cfdRunId.safeParse(request.params.runId);
    if (!runId.success) { notFoundRun(response); return; }
    if (!options.enabled) { disabled(response); return; }
    try {
      const reply = await client.getRun(runId.data);
      if (reply.status !== 200) { sendUpstream(response, reply); return; }
      const record = ledger.upsertFromStatus(reply.body);
      response.json({ ledger: record, status: reply.body });
    } catch (error) {
      const cached = ledger.get(runId.data);
      if (cached) { response.json({ ledger: cached, status: null, stale: true }); return; }
      sendUnavailable(response, error);
    }
  }));

  app.get("/api/cfd/runs/:runId/result", route(async (request, response) => {
    response.set("Cache-Control", "no-store");
    const runId = cfdRunId.safeParse(request.params.runId);
    if (!runId.success) { notFoundRun(response); return; }
    if (!options.enabled) { disabled(response); return; }
    try {
      const reply = await client.getRunResult(runId.data);
      if (reply.status !== 200) { sendUpstream(response, reply); return; }
      response.json(publicizeResult(reply.body));
    } catch (error) {
      sendUnavailable(response, error);
    }
  }));

  app.get("/api/cfd/runs/:runId/exclusions", route(async (request, response) => {
    response.set("Cache-Control", "no-store");
    const runId = cfdRunId.safeParse(request.params.runId);
    if (!runId.success) { notFoundRun(response); return; }
    if (!options.enabled) { disabled(response); return; }
    try {
      sendUpstream(response, await client.getRunExclusions(runId.data));
    } catch (error) {
      sendUnavailable(response, error);
    }
  }));

  app.post("/api/cfd/runs/:runId/cancel", route(async (request, response) => {
    response.set("Cache-Control", "no-store");
    if (options.rejectIfUnauthorized(request, response)) return;
    const runId = cfdRunId.safeParse(request.params.runId);
    if (!runId.success) { notFoundRun(response); return; }
    if (!options.enabled) { disabled(response); return; }
    try {
      const reply = await client.cancelRun(runId.data);
      if (reply.status === 200) ledger.upsertFromStatus(reply.body);
      sendUpstream(response, reply);
    } catch (error) {
      sendUnavailable(response, error);
    }
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
