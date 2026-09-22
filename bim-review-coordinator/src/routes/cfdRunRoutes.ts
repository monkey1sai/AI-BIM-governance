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
// reaches the app error handler; overlay `artifact_id` is taken verbatim from the
// upstream result (no re-rounding); overlay registration re-reads the session right
// before the write; the provenance principal comes from the user auth provider.
import type { Express, Request, RequestHandler, Response } from "express";
import { randomBytes } from "node:crypto";
import {
  cfdBindingIdParam,
  cfdOverlayArtifactId,
  cfdOverlayRegistrationRequest,
  cfdRunCreateRequest,
  cfdRunId,
  cfdRunListQuery,
  cfdSessionIdParam,
} from "../contract/schemas/cfd.js";
import type { CfdRunClient, CfdUpstreamReply } from "../services/cfdRunClient.js";
import { CfdUpstreamUnavailable } from "../services/cfdRunClient.js";
import type { CfdRunLedger } from "../services/cfdRunLedger.js";
import type { SessionStore } from "../services/sessionStore.js";
import type { StreamingConversionClient } from "../services/streamingConversionClient.js";
import type { ArtifactBinding } from "../types.js";

export interface CfdRunRoutesOptions {
  enabled: boolean;
  client: CfdRunClient;
  ledger: CfdRunLedger;
  store: SessionStore;
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
  const { client, ledger, store } = options;
  const publicBase = options.publicCfdArtifactsUrl.replace(/\/+$/, "");

  const publicUrl = (runId: string, filename: string): string => `${publicBase}/${encodeURIComponent(runId)}/${encodeURIComponent(filename)}`;

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
    };
    try {
      const reply = await client.createRun(internalBody);
      if (reply.status === 202 || reply.status === 200) {
        ledger.upsertFromStatus(reply.body, { principal, conversion_job_id: body.source.conversion_job_id, origin: ledgerOrigin });
      }
      sendUpstream(response, reply);
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

  // ── overlay binding on a review session ─────────────────────────────────────
  const overlayResponse = (sessionId: string, binding: ArtifactBinding, runId: string, windFromDegrees: number, replay: boolean) => ({
    session_id: sessionId, binding_id: binding.binding_id, artifact_id: binding.artifact_id, artifact_role: "overlay" as const,
    load_order: binding.load_order, url: binding.url ?? "", run_id: runId, wind_from_degrees: windFromDegrees, idempotent_replay: replay,
  });

  app.post("/api/review-sessions/:sessionId/cfd-overlays", route(async (request, response) => {
    response.set("Cache-Control", "no-store");
    if (options.rejectIfUnauthorized(request, response)) return;
    if (!options.enabled) { disabled(response); return; }
    const sessionId = cfdSessionIdParam.safeParse(request.params.sessionId);
    const parsed = cfdOverlayRegistrationRequest.safeParse(request.body);
    if (!sessionId.success) { response.status(404).json({ error_code: "session_not_found", detail: "session not found" }); return; }
    if (!parsed.success) { response.status(400).json({ error_code: "invalid_request", detail: issuesText(parsed.error.issues) }); return; }
    const session = store.get(sessionId.data);
    if (!session) { response.status(404).json({ error_code: "session_not_found", detail: "session not found" }); return; }
    if (session.status === "closed" || session.status === "closing" || session.status === "failed") {
      response.status(409).json({ error_code: "session_not_active", detail: `session is ${session.status}` });
      return;
    }

    let reply: CfdUpstreamReply;
    try {
      reply = await client.getRunResult(parsed.data.run_id);
    } catch (error) {
      sendUnavailable(response, error);
      return;
    }
    if (reply.status !== 200) { sendUpstream(response, reply); return; }
    const result = reply.body;
    const directions = (result.directions as Array<Record<string, unknown>> | undefined) ?? [];
    // Exact match on the requested angle; the overlay identity is the upstream artifact_id verbatim
    // (Python and JS round .5 differently, so the coordinator never re-derives the `wNNN` tag).
    const direction = directions.find((item) => Number(item.wind_from_degrees) === parsed.data.wind_from_degrees);
    const layer = direction?.overlay_layer as Record<string, unknown> | null | undefined;
    if (!direction || direction.status !== "ready" || !layer || typeof layer.filename !== "string") {
      response.status(409).json({ error_code: "direction_not_ready", detail: "requested wind direction has no ready overlay layer" });
      return;
    }
    const artifactId = cfdOverlayArtifactId.safeParse(layer.artifact_id);
    if (!artifactId.success) {
      response.status(502).json({ error_code: "cfd_upstream_unavailable", detail: "upstream overlay artifact_id is malformed" });
      return;
    }

    // Re-read right before the write: the upstream await above may have interleaved with another
    // registration on the same session. Everything from here to store.update is synchronous.
    const fresh = store.get(session.session_id);
    if (!fresh) { response.status(404).json({ error_code: "session_not_found", detail: "session not found" }); return; }
    const existing = fresh.artifact_bindings.find((binding) => binding.artifact_id === artifactId.data);
    if (existing) {
      response.status(200).json(overlayResponse(fresh.session_id, existing, parsed.data.run_id, parsed.data.wind_from_degrees, true));
      return;
    }
    const primary = fresh.artifact_bindings.find((binding) => binding.artifact_role === "derived") ?? fresh.artifact_bindings[0];
    if (!primary) { response.status(409).json({ error_code: "session_without_model", detail: "session has no model artifact binding" }); return; }
    const source = (result.source ?? {}) as { conversion_job_id?: unknown };
    const binding: ArtifactBinding = {
      binding_id: `binding_${artifactId.data.replace(/[^A-Za-z0-9_]/g, "_")}`,
      artifact_group_id: primary.artifact_group_id,
      model_version_id: primary.model_version_id,
      artifact_id: artifactId.data,
      display_name: `CFD ${parsed.data.wind_from_degrees}° (design comparison only)`,
      artifact_role: "overlay",
      url: publicUrl(parsed.data.run_id, layer.filename),
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
      // Session store invariants (ready-review projection, immutable identity) refuse the write.
      response.status(409).json({ error_code: "session_not_overlayable", detail: error instanceof Error ? error.message : "session rejected the overlay binding" });
      return;
    }
    if (!updated) { response.status(404).json({ error_code: "session_not_found", detail: "session not found" }); return; }
    response.status(201).json(overlayResponse(fresh.session_id, binding, parsed.data.run_id, parsed.data.wind_from_degrees, false));
  }));

  app.delete("/api/review-sessions/:sessionId/cfd-overlays/:bindingId", route((request, response) => {
    response.set("Cache-Control", "no-store");
    if (options.rejectIfUnauthorized(request, response)) return;
    const sessionId = cfdSessionIdParam.safeParse(request.params.sessionId);
    const bindingId = cfdBindingIdParam.safeParse(request.params.bindingId);
    if (!sessionId.success || !bindingId.success) { response.status(404).json({ error_code: "binding_not_found", detail: "binding not found" }); return; }
    const session = store.get(sessionId.data);
    if (!session) { response.status(404).json({ error_code: "session_not_found", detail: "session not found" }); return; }
    const target = session.artifact_bindings.find((binding) => binding.binding_id === bindingId.data);
    if (!target || target.artifact_role !== "overlay") { response.status(404).json({ error_code: "binding_not_found", detail: "binding not found" }); return; }
    store.update(session.session_id, { artifact_bindings: session.artifact_bindings.filter((binding) => binding.binding_id !== bindingId.data) });
    response.json({ session_id: session.session_id, binding_id: bindingId.data, removed: true });
  }));
}
