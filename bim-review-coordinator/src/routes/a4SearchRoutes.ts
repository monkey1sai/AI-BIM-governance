import type { Express, Request, Response } from "express";

export type A4SearchResolutionFailure = {
  ok: false;
  status: 401 | 403 | 404 | 409 | 503;
  error_code: string;
  detail: string;
};

export interface A4SearchPrincipal {
  principal_ref: string;
  auth_scope: "production" | "lab";
}

export type A4SearchPrincipalResolution =
  | { ok: true; principal: A4SearchPrincipal }
  | A4SearchResolutionFailure;

export interface A4SearchSessionContext {
  ifc_source_path: string;
  element_mapping_path?: string;
  model_version_id: string;
  review_session_id: string;
  primary_artifact_id: string;
  active_binding_revision: string;
  mapping_provenance: "server_resolved" | "unavailable";
  primary_lease_capability: "verified" | "lab_unverified";
}

export type A4SearchSessionResolution =
  | { ok: true; context: A4SearchSessionContext }
  | A4SearchResolutionFailure;

export interface A4SearchIfcReadyContext {
  ifc_source_path: string;
  model_version_id: string | null;
}

export type A4SearchIfcReadyResolution =
  | { ok: true; context: A4SearchIfcReadyContext }
  | A4SearchResolutionFailure;

export interface A4SearchRouteDeps {
  isSafeSessionId?: (sessionId: string) => boolean;
  isSafeIfcReadyJobId?: (jobId: string) => boolean;
  authenticatePrincipal?: (
    headers: Record<string, string | undefined>,
  ) => A4SearchPrincipalResolution;
  resolveSessionContext?: (
    sessionId: string,
    principal: A4SearchPrincipal,
  ) => A4SearchSessionResolution;
  resolveIfcReadyContext?: (
    jobId: string,
    principal: A4SearchPrincipal,
  ) => A4SearchIfcReadyResolution;
  trustedGovernanceOrigins?: string[];
  a4InternalContextToken?: string;
  governanceTimeoutMs?: number;
}

type A4SearchControls = {
  query: string;
  limit?: number;
  interpret_mode?: "deterministic" | "semantic" | "auto";
  retry_of_query_id?: string;
};

export type GovernanceTimeoutBudget = "deterministic" | "model";

type Sanitized<T> =
  | { ok: true; value: T }
  | { ok: false; authority: boolean; detail: string };

const DEFAULT_GOVERNANCE_API_BASE = "http://127.0.0.1:49102";
// The canonical 89 MB IFC fixture needs more than the legacy five-second
// proxy budget on a cold parse. Model interpretation may legally consume the
// governance service's 120-second LLM budget before its separate 10-second IFC
// scan budget. The scoped browser client therefore waits 150 seconds, while
// this proxy defaults to 135 seconds and clamps overrides below that client.
const DEFAULT_DETERMINISTIC_GOVERNANCE_TIMEOUT_MS = 12_000;
const DEFAULT_MODEL_GOVERNANCE_TIMEOUT_MS = 135_000;
const MAX_GOVERNANCE_TIMEOUT_MS = 140_000;
const MAX_GOVERNANCE_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_QUERY_LENGTH = 4_000;
const MAX_RESULT_LIMIT = 1_000;
const RETRY_QUERY_ID_PATTERN = /^a4q_[A-Za-z0-9_-]{12,64}$/;
const PARTIAL_FALLBACK_ID_PATTERN = /^a4pf_[A-Za-z0-9_-]{12,96}$/;
const SEARCH_CONTROL_KEYS = new Set(["query", "limit", "interpret_mode", "retry_of_query_id"]);
const PARTIAL_CONTROL_KEYS = new Set(["partial_fallback_id"]);
const BROWSER_AUTHORITY_KEYS = new Set([
  "user_id",
  "actor",
  "principal",
  "principal_ref",
  "lease_id",
  "lease_token",
  "viewer_lease_id",
  "viewer_lease_token",
  "a4_trusted_context",
]);
const BROWSER_AUTHORITY_HEADERS = new Set(["x-actor", "x-operator"]);
const FORBIDDEN_UPSTREAM_RESPONSE_KEYS = new Set([
  "authorization",
  "ifc_source_path",
  "element_mapping_path",
  "raw_completion",
  "endpoint",
  "base_url",
  "token",
]);
const FORBIDDEN_CREDENTIAL_KEY_PATTERN = /^(?:(?:api|access|refresh|private)[_-]?)?(?:key|token)$|(?:^|[_-])(?:authorization|credential|credentials|password|secret)(?:$|[_-])/i;
const USD_PRIM_PATH_KEYS = new Set(["usd_prim_path", "accepted_usd_prim"]);

function normalizedRequestHeaders(request: Request): Record<string, string | undefined> {
  const headers: Record<string, string | undefined> = {};
  for (const [name, value] of Object.entries(request.headers)) {
    headers[name.toLowerCase()] = Array.isArray(value) ? value[0] : value;
  }
  return headers;
}

function sendResolutionFailure(response: Response, failure: A4SearchResolutionFailure): void {
  response.status(failure.status).json({ error_code: failure.error_code, detail: failure.detail });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function authorityKey(keys: string[]): string | null {
  return keys.find((key) => BROWSER_AUTHORITY_KEYS.has(key.toLowerCase())) ?? null;
}

function sanitizeSearchControls(body: unknown): Sanitized<A4SearchControls> {
  if (!isRecord(body)) {
    return { ok: false, authority: false, detail: "A4 search controls must be a JSON object." };
  }
  const keys = Object.keys(body);
  if (authorityKey(keys)) {
    return { ok: false, authority: true, detail: "Browser identity or authority fields are not accepted." };
  }
  if (keys.some((key) => !SEARCH_CONTROL_KEYS.has(key))) {
    return { ok: false, authority: false, detail: "A4 search accepts query controls only." };
  }
  if (
    typeof body.query !== "string"
    || body.query.length > MAX_QUERY_LENGTH
    || body.query.trim().length === 0
  ) {
    return { ok: false, authority: false, detail: "query must be a non-empty string of at most 4000 characters." };
  }

  const value: A4SearchControls = { query: body.query };
  if (Object.hasOwn(body, "limit")) {
    if (
      typeof body.limit !== "number"
      || !Number.isInteger(body.limit)
      || body.limit < 1
      || body.limit > MAX_RESULT_LIMIT
    ) {
      return { ok: false, authority: false, detail: "limit must be an integer between 1 and 1000." };
    }
    value.limit = body.limit;
  }
  if (Object.hasOwn(body, "interpret_mode")) {
    if (
      body.interpret_mode !== "deterministic"
      && body.interpret_mode !== "semantic"
      && body.interpret_mode !== "auto"
    ) {
      return { ok: false, authority: false, detail: "interpret_mode is invalid." };
    }
    value.interpret_mode = body.interpret_mode;
  }
  if (Object.hasOwn(body, "retry_of_query_id")) {
    if (typeof body.retry_of_query_id !== "string" || !RETRY_QUERY_ID_PATTERN.test(body.retry_of_query_id)) {
      return { ok: false, authority: false, detail: "retry_of_query_id is invalid." };
    }
    value.retry_of_query_id = body.retry_of_query_id;
  }
  return { ok: true, value };
}

function sanitizePartialConfirmation(body: unknown): Sanitized<{ partial_fallback_id: string }> {
  if (!isRecord(body)) {
    return { ok: false, authority: false, detail: "A4 partial confirmation must be a JSON object." };
  }
  const keys = Object.keys(body);
  if (authorityKey(keys)) {
    return { ok: false, authority: true, detail: "Browser identity or authority fields are not accepted." };
  }
  if (
    keys.some((key) => !PARTIAL_CONTROL_KEYS.has(key))
    || typeof body.partial_fallback_id !== "string"
    || !PARTIAL_FALLBACK_ID_PATTERN.test(body.partial_fallback_id)
  ) {
    return { ok: false, authority: false, detail: "partial_fallback_id is invalid." };
  }
  return { ok: true, value: { partial_fallback_id: body.partial_fallback_id } };
}

function hasBrowserAuthorityHeader(headers: Record<string, string | undefined>): boolean {
  return [...BROWSER_AUTHORITY_HEADERS].some((name) => {
    const value = headers[name];
    return typeof value === "string" && value.trim().length > 0;
  });
}

function authenticate(
  request: Request,
  response: Response,
  deps: A4SearchRouteDeps,
): A4SearchPrincipal | null {
  if (!deps.authenticatePrincipal) {
    response.status(503).json({
      error_code: "a4_authentication_unavailable",
      detail: "A4 authentication is unavailable.",
    });
    return null;
  }
  const headers = normalizedRequestHeaders(request);
  let resolution: A4SearchPrincipalResolution;
  try {
    resolution = deps.authenticatePrincipal(headers);
  } catch {
    response.status(503).json({
      error_code: "a4_authentication_unavailable",
      detail: "A4 authentication is unavailable.",
    });
    return null;
  }
  if (!resolution.ok) {
    sendResolutionFailure(response, resolution);
    return null;
  }
  if (
    typeof resolution.principal.principal_ref !== "string"
    || resolution.principal.principal_ref.length === 0
    || resolution.principal.principal_ref.length > 160
    || (resolution.principal.auth_scope !== "production" && resolution.principal.auth_scope !== "lab")
  ) {
    response.status(503).json({
      error_code: "a4_authentication_unavailable",
      detail: "A4 authentication is unavailable.",
    });
    return null;
  }
  if (hasBrowserAuthorityHeader(headers)) {
    response.status(403).json({
      error_code: "a4_browser_authority_forbidden",
      detail: "Browser identity headers cannot establish A4 authority.",
    });
    return null;
  }
  return resolution.principal;
}

function normalizedTrustedOrigin(value: string): string | null {
  try {
    const parsed = new URL(value);
    if (
      (parsed.protocol !== "http:" && parsed.protocol !== "https:")
      || parsed.username.length > 0
      || parsed.password.length > 0
      || (parsed.pathname !== "/" && parsed.pathname !== "")
      || parsed.search.length > 0
      || parsed.hash.length > 0
    ) return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

function trustedGovernanceOrigins(deps: A4SearchRouteDeps): Set<string> {
  const configured = deps.trustedGovernanceOrigins
    ?? (process.env.A4_TRUSTED_GOVERNANCE_ORIGINS ?? "").split(",");
  return new Set(configured
    .slice(0, 8)
    .map((value) => normalizedTrustedOrigin(value.trim()))
    .filter((value): value is string => value !== null));
}

function governanceBaseUrl(deps: A4SearchRouteDeps): URL | null {
  try {
    const parsed = new URL(process.env.GOVERNANCE_API_BASE ?? DEFAULT_GOVERNANCE_API_BASE);
    const hostname = parsed.hostname.toLowerCase().replace(/^\[(.*)\]$/, "$1");
    const loopback = hostname === "127.0.0.1" || hostname === "::1";
    if (
      (parsed.protocol !== "http:" && parsed.protocol !== "https:")
      || parsed.username.length > 0
      || parsed.password.length > 0
      || (parsed.pathname !== "/" && parsed.pathname !== "")
      || parsed.search.length > 0
      || parsed.hash.length > 0
    ) return null;
    if (!loopback && !trustedGovernanceOrigins(deps).has(parsed.origin)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function internalToken(deps: A4SearchRouteDeps): string | null {
  const token = (deps.a4InternalContextToken ?? process.env.A4_INTERNAL_CONTEXT_TOKEN)?.trim() ?? "";
  // A short shared value is both weak authority and unsafe to use as a
  // substring-based response leak sentinel (for example, token "a" would
  // match almost every JSON response). Fail closed on either condition.
  return token.length >= 16 && token.length <= 4_096 && /^[\x21-\x7E]+$/.test(token)
    ? token
    : null;
}

function governanceTimeout(deps: A4SearchRouteDeps, budget: GovernanceTimeoutBudget): number {
  const defaultTimeout = budget === "deterministic"
    ? DEFAULT_DETERMINISTIC_GOVERNANCE_TIMEOUT_MS
    : DEFAULT_MODEL_GOVERNANCE_TIMEOUT_MS;
  const candidate = deps.governanceTimeoutMs ?? defaultTimeout;
  if (!Number.isInteger(candidate) || candidate < 1) return defaultTimeout;
  return Math.min(candidate, MAX_GOVERNANCE_TIMEOUT_MS);
}

function searchTimeoutBudget(controls: A4SearchControls): GovernanceTimeoutBudget {
  // Governance defaults an omitted interpret_mode to auto, so only an explicit
  // deterministic request is safe to place on the short proxy budget.
  return controls.interpret_mode === "deterministic" ? "deterministic" : "model";
}

async function readBoundedJson(upstream: globalThis.Response): Promise<unknown> {
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
  let payload = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      totalBytes += chunk.value.byteLength;
      if (totalBytes > MAX_GOVERNANCE_RESPONSE_BYTES) {
        await reader.cancel();
        throw new Error("governance_response_too_large");
      }
      payload += decoder.decode(chunk.value, { stream: true });
    }
    payload += decoder.decode();
    return JSON.parse(payload) as unknown;
  } finally {
    reader.releaseLock();
  }
}

function responseContainsForbiddenData(
  value: unknown,
  forbiddenStrings: string[],
  allowedEchoStrings = new Set<string>(),
  seen = new Set<unknown>(),
  parentKey = "",
): boolean {
  if (typeof value === "string") {
    if (forbiddenStrings.some((candidate) => candidate.length > 0 && value.includes(candidate))) {
      return true;
    }
    // A session-authorized mutation may safely echo an exact browser draft
    // string.  Treat only exact values as provenance-aware echoes; any extra
    // upstream text still goes through the path/credential leak checks.
    if (allowedEchoStrings.has(value)) return false;
    const normalizedKey = parentKey.toLowerCase();
    if (USD_PRIM_PATH_KEYS.has(normalizedKey) && /^\/(?:[A-Za-z_][A-Za-z0-9_]*)+(?:\/[A-Za-z_][A-Za-z0-9_]*)*$/.test(value)) {
      return false;
    }
    return /(?:^|[\s("'=])(?:[A-Za-z]:[\\/]|\\\\)/.test(value)
      || /^\//.test(value)
      || /(?:^|[\s("'=])\/(?:home|tmp|var|workspace|mnt|opt|srv|etc|usr|root|Users)(?:\/|\b)/.test(value);
  }
  if (!value || typeof value !== "object" || seen.has(value)) return false;
  seen.add(value);
  if (Array.isArray(value)) {
    return value.some((item) => responseContainsForbiddenData(
      item,
      forbiddenStrings,
      allowedEchoStrings,
      seen,
    ));
  }
  return Object.entries(value as Record<string, unknown>).some(([key, nested]) =>
    FORBIDDEN_UPSTREAM_RESPONSE_KEYS.has(key.toLowerCase())
    || FORBIDDEN_CREDENTIAL_KEY_PATTERN.test(key)
    || responseContainsForbiddenData(nested, forbiddenStrings, allowedEchoStrings, seen, key),
  );
}

function sendGovernanceUnavailable(response: Response): void {
  response.status(502).json({
    error_code: "governance_service_unavailable",
    detail: "Governance service is unavailable.",
  });
}

export async function forwardTrustedA4(
  response: Response,
  deps: A4SearchRouteDeps,
  upstreamPath: string,
  timeoutBudget: GovernanceTimeoutBudget,
  body: Record<string, unknown>,
  serverPaths: string[],
  allowedResponseEchoes: string[] = [],
): Promise<void> {
  const base = governanceBaseUrl(deps);
  const token = internalToken(deps);
  if (!base || !token) {
    response.status(503).json({
      error_code: "a4_trusted_context_unavailable",
      detail: "A4 trusted context transport is unavailable.",
    });
    return;
  }
  try {
    const upstream = await fetch(new URL(upstreamPath, base), {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(governanceTimeout(deps, timeoutBudget)),
      headers: {
        "Content-Type": "application/json",
        "X-A4-Internal-Token": token,
      },
      body: JSON.stringify(body),
    });
    const payload = await readBoundedJson(upstream);
    const forbiddenStrings = [...serverPaths, token, base.toString()];
    if (responseContainsForbiddenData(payload, forbiddenStrings, new Set(allowedResponseEchoes))) {
      sendGovernanceUnavailable(response);
      return;
    }
    response.status(upstream.status).json(payload);
  } catch {
    sendGovernanceUnavailable(response);
  }
}

function trustedSessionContext(
  sessionId: string,
  principal: A4SearchPrincipal,
  context: A4SearchSessionContext,
): Record<string, unknown> | null {
  if (
    context.review_session_id !== sessionId
    || !context.ifc_source_path
    || !context.model_version_id
    || !context.primary_artifact_id
    || !context.active_binding_revision
    || (context.mapping_provenance === "server_resolved" && !context.element_mapping_path)
  ) return null;
  return {
    scope: "session_table_only",
    review_session_id: sessionId,
    principal_ref: principal.principal_ref,
    primary_artifact_id: context.primary_artifact_id,
    active_binding_revision: context.active_binding_revision,
    model_version_id: context.model_version_id,
    auth_scope: principal.auth_scope,
    mapping_provenance: context.mapping_provenance,
    primary_lease_capability: context.primary_lease_capability,
  };
}

function resolveSession(
  response: Response,
  deps: A4SearchRouteDeps,
  sessionId: string,
  principal: A4SearchPrincipal,
): A4SearchSessionContext | null {
  if (!deps.resolveSessionContext) {
    response.status(503).json({
      error_code: "a4_trusted_context_unavailable",
      detail: "A4 session authorization is unavailable.",
    });
    return null;
  }
  let resolution: A4SearchSessionResolution;
  try {
    resolution = deps.resolveSessionContext(sessionId, principal);
  } catch {
    response.status(503).json({
      error_code: "a4_trusted_context_unavailable",
      detail: "A4 session authorization is unavailable.",
    });
    return null;
  }
  if (!resolution.ok) {
    sendResolutionFailure(response, resolution);
    return null;
  }
  return resolution.context;
}

function invalidControls(response: Response, controls: Extract<Sanitized<unknown>, { ok: false }>): void {
  response.status(controls.authority ? 403 : 400).json({
    error_code: controls.authority ? "a4_browser_authority_forbidden" : "invalid_a4_search_controls",
    detail: controls.detail,
  });
}

export function registerA4SearchRoutes(app: Express, deps: A4SearchRouteDeps): void {
  // This route intentionally never falls through to the legacy generic proxy.
  // A browser-controlled host path is not an A4 production/test compatibility seam.
  app.post("/api/governance/search/model", (_request, response) => {
    response.status(404).json({
      error_code: "a4_generic_search_disabled",
      detail: "Generic A4 browser search is disabled; use a server-scoped route.",
    });
  });

  app.post("/api/governance/search/model/for-session/:sessionId/partial-confirmation", (request, response) => {
    const sessionId = request.params.sessionId;
    if (!deps.isSafeSessionId?.(sessionId)) {
      response.status(400).json({ error_code: "invalid_session_id", detail: "Invalid review session id." });
      return;
    }
    const principal = authenticate(request, response, deps);
    if (!principal) return;
    const controls = sanitizePartialConfirmation(request.body);
    if (!controls.ok) {
      invalidControls(response, controls);
      return;
    }
    const context = resolveSession(response, deps, sessionId, principal);
    if (!context) return;
    const trusted = trustedSessionContext(sessionId, principal, context);
    if (!trusted) {
      response.status(503).json({
        error_code: "a4_trusted_context_unavailable",
        detail: "A4 session context is unavailable.",
      });
      return;
    }
    void forwardTrustedA4(
      response,
      deps,
      "/api/internal/a4/search/model/confirm-partial",
      "deterministic",
      { partial_fallback_id: controls.value.partial_fallback_id, a4_trusted_context: trusted },
      [context.ifc_source_path, context.element_mapping_path ?? ""],
    );
  });

  app.post("/api/governance/search/model/for-session/:sessionId", (request, response) => {
    const sessionId = request.params.sessionId;
    if (!deps.isSafeSessionId?.(sessionId)) {
      response.status(400).json({ error_code: "invalid_session_id", detail: "Invalid review session id." });
      return;
    }
    const principal = authenticate(request, response, deps);
    if (!principal) return;
    const controls = sanitizeSearchControls(request.body);
    if (!controls.ok) {
      invalidControls(response, controls);
      return;
    }
    const context = resolveSession(response, deps, sessionId, principal);
    if (!context) return;
    const trusted = trustedSessionContext(sessionId, principal, context);
    if (!trusted) {
      response.status(503).json({
        error_code: "a4_trusted_context_unavailable",
        detail: "A4 session context is unavailable.",
      });
      return;
    }
    const body: Record<string, unknown> = {
      ifc_source_path: context.ifc_source_path,
      ...(context.element_mapping_path ? { element_mapping_path: context.element_mapping_path } : {}),
      model_version_id: context.model_version_id,
      ...controls.value,
      a4_trusted_context: trusted,
    };
    void forwardTrustedA4(
      response,
      deps,
      "/api/internal/a4/search/model",
      searchTimeoutBudget(controls.value),
      body,
      [context.ifc_source_path, context.element_mapping_path ?? ""],
    );
  });

  app.post("/api/governance/search/model/for-ifc-ready/:jobId", (request, response) => {
    const jobId = request.params.jobId;
    if (!deps.isSafeIfcReadyJobId?.(jobId)) {
      response.status(400).json({ error_code: "invalid_ifc_ready_job_id", detail: "Invalid IFC-ready job id." });
      return;
    }
    const principal = authenticate(request, response, deps);
    if (!principal) return;
    if (principal.auth_scope !== "lab") {
      response.status(403).json({
        error_code: "a4_ifc_ready_lab_only",
        detail: "A4 IFC-ready compatibility search is available in lab scope only.",
      });
      return;
    }
    const controls = sanitizeSearchControls(request.body);
    if (!controls.ok) {
      invalidControls(response, controls);
      return;
    }
    if (!deps.resolveIfcReadyContext) {
      response.status(503).json({
        error_code: "a4_trusted_context_unavailable",
        detail: "A4 IFC-ready authorization is unavailable.",
      });
      return;
    }
    let resolution: A4SearchIfcReadyResolution;
    try {
      resolution = deps.resolveIfcReadyContext(jobId, principal);
    } catch {
      response.status(503).json({
        error_code: "a4_trusted_context_unavailable",
        detail: "A4 IFC-ready authorization is unavailable.",
      });
      return;
    }
    if (!resolution.ok) {
      sendResolutionFailure(response, resolution);
      return;
    }
    const body: Record<string, unknown> = {
      ifc_source_path: resolution.context.ifc_source_path,
      model_version_id: resolution.context.model_version_id,
      ...controls.value,
      a4_trusted_context: { scope: "ifc_ready_table_only" },
    };
    void forwardTrustedA4(
      response,
      deps,
      "/api/internal/a4/search/model",
      searchTimeoutBudget(controls.value),
      body,
      [resolution.context.ifc_source_path],
    );
  });
}
