// Browser-facing CFD wind-run routes (building-energy-cfd-p2-contract.md §3.2, slice S2).
//
// The browser talks only to the coordinator; the coordinator is the single
// caller of the streaming CFD job service. This module binds a run to one exact
// model.usdc (sha256 from the conversion result), keeps the ledger projection,
// rewrites artifact URLs to the public streaming origin and registers finished
// overlay layers as `ArtifactBinding(artifact_role: "overlay")` on a review
// session so the existing stage-binding + loadArtifactGroupRequest path loads
// them. No new Kit command, no governance route.
import type { Express, Request, Response } from "express";
import { randomBytes } from "node:crypto";
import { z } from "zod/v4";
import { cfdOverlayRegistrationRequest, cfdRunCreateRequest, cfdRunId } from "../contract/schemas/cfd.js";
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
}

const sessionIdParam = z.string().min(1).max(200).regex(/^[A-Za-z0-9._:-]+$/);
const bindingIdParam = z.string().min(1).max(240).regex(/^[A-Za-z0-9._:-]+$/);
const listQuery = z.strictObject({
  conversion_job_id: z.string().regex(/^[A-Za-z0-9._-]{1,200}$/).optional(),
  status: z.enum(["queued", "preprocessing", "meshing", "solving", "postprocessing", "ready", "failed", "cancelled"]).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

/** Derive `.../cfd-artifacts` from the public `/artifacts` URL the coordinator already trusts. */
export function derivePublicCfdArtifactsUrl(publicArtifactsUrl: string): string {
  const trimmed = publicArtifactsUrl.replace(/\/+$/, "");
  return trimmed.endsWith("/artifacts") ? `${trimmed.slice(0, -"/artifacts".length)}/cfd-artifacts` : `${trimmed}/cfd-artifacts`;
}

function sendUpstream(response: Response, reply: CfdUpstreamReply): void {
  response.status(reply.status).json(reply.body);
}

function sendUnavailable(response: Response, error: unknown): void {
  const detail = error instanceof CfdUpstreamUnavailable ? error.message : "streaming CFD job service error";
  response.status(502).json({ error_code: "cfd_upstream_unavailable", detail });
}

function issuesText(issues: ReadonlyArray<{ path: PropertyKey[]; message: string }>): string {
  return issues.slice(0, 8).map((issue) => `${issue.path.map(String).join(".")}: ${issue.message}`).join("; ");
}

function principalOf(request: Request): string {
  const header = request.header("x-operator-id") || request.header("x-user-id");
  return header && /^[A-Za-z0-9._:@-]{1,200}$/.test(header) ? header : "coordinator-browser";
}

function traceIdOf(request: Request): string {
  const header = request.header("x-trace-id");
  return header && /^[A-Za-z0-9._:-]{1,200}$/.test(header) ? header : `trace_cfd_${randomBytes(8).toString("hex")}`;
}

export function registerCfdRunRoutes(app: Express, options: CfdRunRoutesOptions): void {
  const { client, ledger, store } = options;
  const publicBase = options.publicCfdArtifactsUrl.replace(/\/+$/, "");

  const publicUrl = (runId: string, filename: string): string => `${publicBase}/${encodeURIComponent(runId)}/${encodeURIComponent(filename)}`;

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

  // ── create ──────────────────────────────────────────────────────────────────
  app.post("/api/cfd/runs", async (request, response) => {
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
    const internalBody = {
      ...body,
      source: { conversion_job_id: body.source.conversion_job_id, model_usdc_sha256: modelSha },
      requested_by: { principal, trace_id: traceIdOf(request) },
    };
    try {
      const reply = await client.createRun(internalBody);
      if (reply.status === 202 || reply.status === 200) {
        ledger.upsertFromStatus(reply.body, { principal, conversion_job_id: body.source.conversion_job_id });
      }
      sendUpstream(response, reply);
    } catch (error) {
      sendUnavailable(response, error);
    }
  });

  // ── list / detail ───────────────────────────────────────────────────────────
  app.get("/api/cfd/runs", async (request, response) => {
    response.set("Cache-Control", "no-store");
    const query = listQuery.safeParse(request.query);
    if (!query.success) { response.status(400).json({ error_code: "invalid_request", detail: "unknown or malformed query parameter" }); return; }
    if (!options.enabled) {
      response.json({ items: ledger.list(query.data), count: ledger.list(query.data).length, enabled: false, stale: false });
      return;
    }
    let stale = false;
    try {
      const reply = await client.listRuns(query.data);
      if (reply.status === 200) {
        for (const item of (reply.body.items as Array<Record<string, unknown>> | undefined) ?? []) ledger.upsertFromStatus(item);
      } else {
        stale = true;
      }
    } catch {
      stale = true;
    }
    const items = ledger.list(query.data);
    response.json({ items, count: items.length, enabled: true, stale });
  });

  app.get("/api/cfd/runs/:runId", async (request, response) => {
    response.set("Cache-Control", "no-store");
    const runId = cfdRunId.safeParse(request.params.runId);
    if (!runId.success) { response.status(404).json({ error_code: "run_not_found", detail: "CFD run not found." }); return; }
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
  });

  app.get("/api/cfd/runs/:runId/result", async (request, response) => {
    response.set("Cache-Control", "no-store");
    const runId = cfdRunId.safeParse(request.params.runId);
    if (!runId.success) { response.status(404).json({ error_code: "run_not_found", detail: "CFD run not found." }); return; }
    if (!options.enabled) { disabled(response); return; }
    try {
      const reply = await client.getRunResult(runId.data);
      if (reply.status !== 200) { sendUpstream(response, reply); return; }
      response.json(publicizeResult(reply.body));
    } catch (error) {
      sendUnavailable(response, error);
    }
  });

  app.get("/api/cfd/runs/:runId/exclusions", async (request, response) => {
    response.set("Cache-Control", "no-store");
    const runId = cfdRunId.safeParse(request.params.runId);
    if (!runId.success) { response.status(404).json({ error_code: "run_not_found", detail: "CFD run not found." }); return; }
    if (!options.enabled) { disabled(response); return; }
    try {
      sendUpstream(response, await client.getRunExclusions(runId.data));
    } catch (error) {
      sendUnavailable(response, error);
    }
  });

  app.post("/api/cfd/runs/:runId/cancel", async (request, response) => {
    response.set("Cache-Control", "no-store");
    if (options.rejectIfUnauthorized(request, response)) return;
    const runId = cfdRunId.safeParse(request.params.runId);
    if (!runId.success) { response.status(404).json({ error_code: "run_not_found", detail: "CFD run not found." }); return; }
    if (!options.enabled) { disabled(response); return; }
    try {
      const reply = await client.cancelRun(runId.data);
      if (reply.status === 200) ledger.upsertFromStatus(reply.body);
      sendUpstream(response, reply);
    } catch (error) {
      sendUnavailable(response, error);
    }
  });

  // ── overlay binding on a review session ─────────────────────────────────────
  app.post("/api/review-sessions/:sessionId/cfd-overlays", async (request, response) => {
    response.set("Cache-Control", "no-store");
    if (options.rejectIfUnauthorized(request, response)) return;
    if (!options.enabled) { disabled(response); return; }
    const sessionId = sessionIdParam.safeParse(request.params.sessionId);
    const parsed = cfdOverlayRegistrationRequest.safeParse(request.body);
    if (!sessionId.success) { response.status(404).json({ error_code: "session_not_found", detail: "session not found" }); return; }
    if (!parsed.success) { response.status(400).json({ error_code: "invalid_request", detail: issuesText(parsed.error.issues) }); return; }
    const session = store.get(sessionId.data);
    if (!session) { response.status(404).json({ error_code: "session_not_found", detail: "session not found" }); return; }
    if (session.status === "closed" || session.status === "closing" || session.status === "failed") {
      response.status(409).json({ error_code: "session_not_active", detail: `session is ${session.status}` });
      return;
    }
    const tag = `w${String(Math.round(parsed.data.wind_from_degrees) % 360).padStart(3, "0")}`;
    const artifactId = `cfd:${parsed.data.run_id}:${tag}`;
    const existing = session.artifact_bindings.find((binding) => binding.artifact_id === artifactId);
    if (existing) {
      response.status(200).json({
        session_id: session.session_id, binding_id: existing.binding_id, artifact_id: existing.artifact_id, artifact_role: "overlay",
        load_order: existing.load_order, url: existing.url ?? "", run_id: parsed.data.run_id, wind_from_degrees: parsed.data.wind_from_degrees, idempotent_replay: true,
      });
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
    const direction = directions.find((item) => Math.round(Number(item.wind_from_degrees)) % 360 === Math.round(parsed.data.wind_from_degrees) % 360);
    const layer = direction?.overlay_layer as Record<string, unknown> | null | undefined;
    if (!direction || direction.status !== "ready" || !layer || typeof layer.filename !== "string") {
      response.status(409).json({ error_code: "direction_not_ready", detail: "requested wind direction has no ready overlay layer" });
      return;
    }
    const primary = session.artifact_bindings.find((binding) => binding.artifact_role === "derived") ?? session.artifact_bindings[0];
    if (!primary) { response.status(409).json({ error_code: "session_without_model", detail: "session has no model artifact binding" }); return; }
    const source = (result.source ?? {}) as { conversion_job_id?: unknown };
    const binding: ArtifactBinding = {
      binding_id: `binding_${artifactId.replace(/[^A-Za-z0-9_]/g, "_")}`,
      artifact_group_id: primary.artifact_group_id,
      model_version_id: primary.model_version_id,
      artifact_id: artifactId,
      display_name: `CFD ${parsed.data.wind_from_degrees}° (design comparison only)`,
      artifact_role: "overlay",
      url: publicUrl(parsed.data.run_id, layer.filename),
      mapping_url: null,
      load_order: Math.max(0, ...session.artifact_bindings.map((item) => item.load_order)) + 1,
      routing_policy: primary.routing_policy,
      ready_status: "ready",
      conversion_authority: "bim-streaming-server",
      conversion_job_id: typeof source.conversion_job_id === "string" ? source.conversion_job_id : primary.conversion_job_id ?? null,
      conversion_status: "ready",
      failure_code: null,
      diagnostic: null,
    };
    const updated = store.update(session.session_id, { artifact_bindings: [...session.artifact_bindings, binding] });
    if (!updated) { response.status(404).json({ error_code: "session_not_found", detail: "session not found" }); return; }
    response.status(201).json({
      session_id: session.session_id, binding_id: binding.binding_id, artifact_id: binding.artifact_id, artifact_role: "overlay",
      load_order: binding.load_order, url: binding.url ?? "", run_id: parsed.data.run_id, wind_from_degrees: parsed.data.wind_from_degrees, idempotent_replay: false,
    });
  });

  app.delete("/api/review-sessions/:sessionId/cfd-overlays/:bindingId", (request, response) => {
    response.set("Cache-Control", "no-store");
    if (options.rejectIfUnauthorized(request, response)) return;
    const sessionId = sessionIdParam.safeParse(request.params.sessionId);
    const bindingId = bindingIdParam.safeParse(request.params.bindingId);
    if (!sessionId.success || !bindingId.success) { response.status(404).json({ error_code: "binding_not_found", detail: "binding not found" }); return; }
    const session = store.get(sessionId.data);
    if (!session) { response.status(404).json({ error_code: "session_not_found", detail: "session not found" }); return; }
    const target = session.artifact_bindings.find((binding) => binding.binding_id === bindingId.data);
    if (!target || target.artifact_role !== "overlay") { response.status(404).json({ error_code: "binding_not_found", detail: "binding not found" }); return; }
    store.update(session.session_id, { artifact_bindings: session.artifact_bindings.filter((binding) => binding.binding_id !== bindingId.data) });
    response.json({ session_id: session.session_id, binding_id: bindingId.data, removed: true });
  });
}
