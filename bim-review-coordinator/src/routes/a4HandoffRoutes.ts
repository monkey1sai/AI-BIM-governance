import type { Express, Request, Response } from "express";
import {
  A4HandoffStore,
  type A4HandoffAction,
  type A4HandoffBinding,
  type A4HandoffRow,
} from "../services/a4HandoffStore.js";
import type {
  A4SearchResolutionFailure,
  A4SearchSessionContext,
  A4SearchSessionResolution,
} from "./governanceProxy.js";

const DEFAULT_GOVERNANCE_API_BASE = "http://127.0.0.1:49102";
const DEFAULT_GOVERNANCE_TIMEOUT_MS = 3_000;
const MAX_GOVERNANCE_TIMEOUT_MS = 10_000;
const MAX_GOVERNANCE_RESPONSE_BYTES = 64 * 1024;
const A4_PROOF_PATTERN = /^a4p\.[A-Za-z0-9_-]{1,64}\.[A-Za-z0-9_-]{16,96}\.[0-9a-f]{64}$/;
const A4_HANDOFF_ID_PATTERN = /^a4h_[A-Za-z0-9_-]{16,96}$/;
const USD_PRIM_PATTERN = /^\/[A-Za-z_][A-Za-z0-9_]*(?:\/[A-Za-z_][A-Za-z0-9_]*)*$/;

export interface A4HandoffRouteDeps {
  isSafeSessionId?: (sessionId: string) => boolean;
  resolveA4SearchSessionContext?: (
    sessionId: string,
    headers: Record<string, string | undefined>,
  ) => A4SearchSessionResolution;
  a4InternalContextToken?: string;
  handoffStore?: A4HandoffStore;
  governanceTimeoutMs?: number;
}

type A4HandoffControls = {
  action: A4HandoffAction;
  evidence_proofs: string[];
};

type GovernanceHandoffResponse = {
  accepted: boolean;
  action: A4HandoffAction;
  code: string | null;
  failed_index: number | null;
  min_proof_expires_at: string | null;
  rows: A4HandoffRow[];
};

function governanceApiBase(): string {
  return process.env.GOVERNANCE_API_BASE ?? DEFAULT_GOVERNANCE_API_BASE;
}

function isLoopbackGovernanceBase(value: string): boolean {
  try {
    const parsed = new URL(value);
    const host = parsed.hostname.toLowerCase().replace(/^\[(.*)\]$/, "$1");
    return (parsed.protocol === "http:" || parsed.protocol === "https:")
      && (host === "127.0.0.1" || host === "::1");
  } catch {
    return false;
  }
}

function requestHeaders(request: Request): Record<string, string | undefined> {
  const normalized: Record<string, string | undefined> = {};
  for (const [name, value] of Object.entries(request.headers)) {
    normalized[name.toLowerCase()] = Array.isArray(value) ? value[0] : value;
  }
  return normalized;
}

function internalToken(deps: A4HandoffRouteDeps): string | undefined {
  const token = deps.a4InternalContextToken ?? process.env.A4_INTERNAL_CONTEXT_TOKEN;
  return token?.trim() || undefined;
}

function governanceTimeoutMs(deps: A4HandoffRouteDeps): number {
  const value = deps.governanceTimeoutMs ?? DEFAULT_GOVERNANCE_TIMEOUT_MS;
  if (!Number.isInteger(value) || value <= 0) return DEFAULT_GOVERNANCE_TIMEOUT_MS;
  return Math.min(value, MAX_GOVERNANCE_TIMEOUT_MS);
}

async function readBoundedGovernanceJson(upstream: globalThis.Response): Promise<unknown> {
  const contentType = upstream.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") {
    await upstream.body?.cancel();
    throw new Error("governance_response_content_type_invalid");
  }

  const declaredLength = upstream.headers.get("content-length");
  if (declaredLength) {
    if (!/^\d+$/.test(declaredLength) || Number(declaredLength) > MAX_GOVERNANCE_RESPONSE_BYTES) {
      await upstream.body?.cancel();
      throw new Error("governance_response_too_large");
    }
  }
  if (!upstream.body) throw new Error("governance_response_body_missing");

  const reader = upstream.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let totalBytes = 0;
  let text = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      totalBytes += chunk.value.byteLength;
      if (totalBytes > MAX_GOVERNANCE_RESPONSE_BYTES) {
        await reader.cancel();
        throw new Error("governance_response_too_large");
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    return JSON.parse(text) as unknown;
  } finally {
    reader.releaseLock();
  }
}

function sendResolutionFailure(response: Response, resolution: A4SearchResolutionFailure): void {
  response.status(resolution.status).json({ error_code: resolution.error_code, detail: resolution.detail });
}

function eligibleBinding(context: A4SearchSessionContext, expectedSessionId: string): A4HandoffBinding | null {
  if (
    context.auth_scope !== "production"
    || context.primary_lease_capability !== "verified"
    || context.mapping_provenance !== "server_resolved"
    || typeof context.review_session_id !== "string"
    || !context.review_session_id
    || context.review_session_id !== expectedSessionId
    || typeof context.principal_ref !== "string"
    || !context.principal_ref
    || typeof context.model_version_id !== "string"
    || !context.model_version_id
    || typeof context.primary_artifact_id !== "string"
    || !context.primary_artifact_id
    || typeof context.active_binding_revision !== "string"
    || !context.active_binding_revision
  ) {
    return null;
  }
  return {
    review_session_id: context.review_session_id,
    principal_ref: context.principal_ref,
    model_version_id: context.model_version_id,
    primary_artifact_id: context.primary_artifact_id,
    active_binding_revision: context.active_binding_revision,
  };
}

function sameBinding(left: A4HandoffBinding, right: A4HandoffBinding): boolean {
  return left.review_session_id === right.review_session_id
    && left.principal_ref === right.principal_ref
    && left.model_version_id === right.model_version_id
    && left.primary_artifact_id === right.primary_artifact_id
    && left.active_binding_revision === right.active_binding_revision;
}

function sanitizeCreateControls(body: unknown): { ok: true; value: A4HandoffControls } | { ok: false } {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false };
  const input = body as Record<string, unknown>;
  if (Object.keys(input).some((key) => key !== "action" && key !== "evidence_proofs")) return { ok: false };
  if (input.action !== "focus" && input.action !== "highlight") return { ok: false };
  if (!Array.isArray(input.evidence_proofs)) return { ok: false };
  const count = input.evidence_proofs.length;
  if ((input.action === "focus" && count !== 1) || (input.action === "highlight" && (count < 1 || count > 64))) {
    return { ok: false };
  }
  if (!input.evidence_proofs.every((item) => typeof item === "string" && A4_PROOF_PATTERN.test(item))) {
    return { ok: false };
  }
  if (new Set(input.evidence_proofs).size !== count) return { ok: false };
  return { ok: true, value: { action: input.action, evidence_proofs: [...input.evidence_proofs] } };
}

function consumeBodyIsEmpty(body: unknown): boolean {
  return body === undefined
    || body === null
    || (typeof body === "object" && !Array.isArray(body) && Object.keys(body as Record<string, unknown>).length === 0);
}

function parseGovernanceResponse(raw: unknown, expectedAction: A4HandoffAction): GovernanceHandoffResponse | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const input = raw as Record<string, unknown>;
  const expectedKeys = new Set(["accepted", "action", "code", "failed_index", "min_proof_expires_at", "rows"]);
  if (Object.keys(input).some((key) => !expectedKeys.has(key))) return null;
  if (input.action !== expectedAction || typeof input.accepted !== "boolean") return null;
  const code = input.code === null ? null : typeof input.code === "string" && /^[a-z0-9_]{1,64}$/.test(input.code) ? input.code : undefined;
  if (code === undefined) return null;
  const failedIndex = input.failed_index === null
    ? null
    : typeof input.failed_index === "number" && Number.isInteger(input.failed_index) && input.failed_index >= 0
      ? input.failed_index
      : undefined;
  if (failedIndex === undefined || !Array.isArray(input.rows)) return null;
  if (!input.accepted) {
    if (input.rows.length !== 0 || code === null || input.min_proof_expires_at !== null) return null;
    return { accepted: false, action: expectedAction, code, failed_index: failedIndex, min_proof_expires_at: null, rows: [] };
  }
  if (code !== null || failedIndex !== null || typeof input.min_proof_expires_at !== "string") return null;
  const minimumExpiryMs = Date.parse(input.min_proof_expires_at);
  if (!Number.isFinite(minimumExpiryMs)) return null;
  const rows: A4HandoffRow[] = [];
  const rowExpiryTimes: number[] = [];
  for (const item of input.rows) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const row = item as Record<string, unknown>;
    const expectedRowKeys = new Set(["proof_id", "ifc_guid", "prim_path", "proof_expires_at"]);
    if (Object.keys(row).some((key) => !expectedRowKeys.has(key))) return null;
    if (
      typeof row.proof_id !== "string"
      || !row.proof_id
      || (row.ifc_guid !== null && typeof row.ifc_guid !== "string")
      || typeof row.prim_path !== "string"
      || row.prim_path.length > 512
      || !USD_PRIM_PATTERN.test(row.prim_path)
      || typeof row.proof_expires_at !== "string"
      || !Number.isFinite(Date.parse(row.proof_expires_at))
    ) return null;
    rows.push({ ifc_guid: row.ifc_guid as string | null, prim_path: row.prim_path });
    rowExpiryTimes.push(Date.parse(row.proof_expires_at));
  }
  if (rows.length === 0 || new Set(rows.map((row) => row.prim_path)).size !== rows.length) return null;
  if (Math.min(...rowExpiryTimes) !== minimumExpiryMs) return null;
  return {
    accepted: true,
    action: expectedAction,
    code: null,
    failed_index: null,
    min_proof_expires_at: input.min_proof_expires_at,
    rows,
  };
}

async function verifyWithGovernance(
  controls: A4HandoffControls,
  binding: A4HandoffBinding,
  token: string,
  timeoutMs: number,
): Promise<{ ok: true; value: GovernanceHandoffResponse } | { ok: false; status: number; code: string; failedIndex?: number }> {
  try {
    const upstream = await fetch(`${governanceApiBase()}/api/internal/a4/handoffs/verify`, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(timeoutMs),
      headers: { "Content-Type": "application/json", "X-A4-Internal-Token": token },
      body: JSON.stringify({
        action: controls.action,
        evidence_proofs: controls.evidence_proofs,
        binding: {
          session_id: binding.review_session_id,
          principal: binding.principal_ref,
          model_version_id: binding.model_version_id,
          model_artifact: binding.primary_artifact_id,
          active_binding_revision: binding.active_binding_revision,
        },
      }),
    });
    if (upstream.status !== 200 && upstream.status !== 409) {
      await upstream.body?.cancel();
      return { ok: false, status: 502, code: "a4_handoff_authority_unavailable" };
    }
    const parsed = parseGovernanceResponse(await readBoundedGovernanceJson(upstream), controls.action);
    if (!parsed) return { ok: false, status: 502, code: "a4_handoff_authority_unavailable" };
    if ((parsed.accepted && upstream.status !== 200) || (!parsed.accepted && upstream.status !== 409)) {
      return { ok: false, status: 502, code: "a4_handoff_authority_unavailable" };
    }
    if (!parsed.accepted) {
      return {
        ok: false,
        status: 409,
        code: parsed.code ?? "a4_handoff_rejected",
        ...(parsed.failed_index === null ? {} : { failedIndex: parsed.failed_index }),
      };
    }
    if (parsed.rows.length !== controls.evidence_proofs.length) {
      return { ok: false, status: 502, code: "a4_handoff_authority_unavailable" };
    }
    return { ok: true, value: parsed };
  } catch {
    return { ok: false, status: 502, code: "a4_handoff_authority_unavailable" };
  }
}

export function registerA4HandoffRoutes(app: Express, deps: A4HandoffRouteDeps): void {
  const store = deps.handoffStore ?? new A4HandoffStore();

  app.post("/api/review-sessions/:sessionId/a4-handoffs", async (request, response) => {
    const sessionId = request.params.sessionId;
    if (!deps.isSafeSessionId?.(sessionId)) {
      response.status(400).json({ error_code: "invalid_session_id", detail: "Invalid review session id." });
      return;
    }
    if (!deps.resolveA4SearchSessionContext) {
      response.status(503).json({ error_code: "a4_trusted_context_unavailable", detail: "A4 session authorization is unavailable." });
      return;
    }
    const headers = requestHeaders(request);
    const initialResolution = deps.resolveA4SearchSessionContext(sessionId, headers);
    if (!initialResolution.ok) {
      sendResolutionFailure(response, initialResolution);
      return;
    }
    const initialBinding = eligibleBinding(initialResolution.context, sessionId);
    if (!initialBinding) {
      response.status(409).json({ error_code: "a4_handoff_not_eligible", detail: "A4 3D handoff authority is unavailable for this session." });
      return;
    }
    const controls = sanitizeCreateControls(request.body);
    if (!controls.ok) {
      response.status(400).json({ error_code: "invalid_a4_handoff_controls", detail: "A4 handoff controls are invalid." });
      return;
    }
    const token = internalToken(deps);
    if (!token || !isLoopbackGovernanceBase(governanceApiBase())) {
      response.status(503).json({ error_code: "a4_handoff_authority_unavailable", detail: "A4 handoff authority is unavailable." });
      return;
    }
    const verification = await verifyWithGovernance(
      controls.value,
      initialBinding,
      token,
      governanceTimeoutMs(deps),
    );
    if (!verification.ok) {
      response.status(verification.status).json({
        error_code: verification.code,
        detail: "A4 handoff evidence was rejected.",
        ...(verification.failedIndex === undefined ? {} : { failed_index: verification.failedIndex }),
      });
      return;
    }

    // Close the verification/store TOCTOU window: authorization, primary lease,
    // artifact, and active revision must still be identical after governance
    // has verified every proof.
    const refreshedResolution = deps.resolveA4SearchSessionContext(sessionId, headers);
    if (!refreshedResolution.ok) {
      sendResolutionFailure(response, refreshedResolution);
      return;
    }
    const refreshedBinding = eligibleBinding(refreshedResolution.context, sessionId);
    if (!refreshedBinding || !sameBinding(initialBinding, refreshedBinding)) {
      response.status(409).json({ error_code: "a4_handoff_binding_changed", detail: "A4 session binding changed during handoff creation." });
      return;
    }
    const created = store.create({
      action: controls.value.action,
      binding: refreshedBinding,
      rows: verification.value.rows,
      minProofExpiresAt: verification.value.min_proof_expires_at!,
    });
    if (!created.ok) {
      const status = created.code === "a4_handoff_expired" ? 410 : 503;
      response.status(status).json({ error_code: created.code, detail: "A4 handoff could not be created." });
      return;
    }
    const openUrl = `/ui/open?session=${encodeURIComponent(sessionId)}&a4_handoff=${encodeURIComponent(created.intent.handoff_id)}`;
    response.status(201).json({
      handoff_id: created.intent.handoff_id,
      action: created.intent.action,
      expires_at: created.intent.expires_at,
      open_url: openUrl,
      viewer_url: openUrl,
      row_count: created.intent.rows.length,
    });
  });

  app.post("/api/review-sessions/:sessionId/a4-handoffs/:handoffId/consume", (request, response) => {
    const { sessionId, handoffId } = request.params;
    if (!deps.isSafeSessionId?.(sessionId) || !A4_HANDOFF_ID_PATTERN.test(handoffId)) {
      response.status(400).json({ error_code: "invalid_a4_handoff", detail: "A4 handoff identifier is invalid." });
      return;
    }
    if (!deps.resolveA4SearchSessionContext) {
      response.status(503).json({ error_code: "a4_trusted_context_unavailable", detail: "A4 session authorization is unavailable." });
      return;
    }
    const resolution = deps.resolveA4SearchSessionContext(sessionId, requestHeaders(request));
    if (!resolution.ok) {
      sendResolutionFailure(response, resolution);
      return;
    }
    const binding = eligibleBinding(resolution.context, sessionId);
    if (!binding) {
      response.status(409).json({ error_code: "a4_handoff_not_eligible", detail: "A4 3D handoff authority is unavailable for this session." });
      return;
    }
    if (!consumeBodyIsEmpty(request.body)) {
      response.status(400).json({ error_code: "invalid_a4_handoff_consume", detail: "A4 handoff consume accepts no browser authority fields." });
      return;
    }
    const consumed = store.consume(handoffId, binding);
    if (!consumed.ok) {
      const status = consumed.code === "a4_handoff_expired" ? 410
        : consumed.code === "a4_handoff_binding_mismatch" ? 409
          : 404;
      response.status(status).json({ error_code: consumed.code, detail: "A4 handoff is unavailable." });
      return;
    }
    response.json({
      handoff_id: consumed.intent.handoff_id,
      action: consumed.intent.action,
      expires_at: consumed.intent.expires_at,
      prim_paths: consumed.intent.rows.map((row) => row.prim_path),
      binding: {
        review_session_id: consumed.intent.binding.review_session_id,
        model_version_id: consumed.intent.binding.model_version_id,
        primary_artifact_id: consumed.intent.binding.primary_artifact_id,
        active_binding_revision: consumed.intent.binding.active_binding_revision,
      },
    });
  });
}
