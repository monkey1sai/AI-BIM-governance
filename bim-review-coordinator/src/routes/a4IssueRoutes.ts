import type { Express, Request, Response } from "express";

import {
  forwardTrustedA4,
  type A4SearchPrincipal,
  type A4SearchPrincipalResolution,
  type A4SearchSessionContext,
  type A4SearchSessionResolution,
} from "./a4SearchRoutes.js";

export interface A4IssueRouteDeps {
  isSafeSessionId?: (sessionId: string) => boolean;
  authenticatePrincipal?: (
    headers: Record<string, string | undefined>,
  ) => A4SearchPrincipalResolution;
  resolveSessionContext?: (
    sessionId: string,
    principal: A4SearchPrincipal,
  ) => A4SearchSessionResolution;
  trustedGovernanceOrigins?: string[];
  a4InternalContextToken?: string;
  governanceTimeoutMs?: number;
}

type A4IssueDraft = {
  title: string;
  description?: string | null;
  severity: "low" | "medium" | "high" | "critical";
  assignee?: string | null;
  ifc_guid: string;
  usd_prim_path?: string | null;
  evidence_proof: string;
  a4_evidence_snapshot: Record<string, unknown>;
};

type SanitizedDraft =
  | { ok: true; value: A4IssueDraft }
  | { ok: false; authority: boolean; detail: string };

const ISSUE_DRAFT_KEYS = new Set([
  "title",
  "description",
  "severity",
  "assignee",
  "ifc_guid",
  "usd_prim_path",
  "evidence_proof",
  "a4_evidence_snapshot",
]);
const BROWSER_AUTHORITY_KEYS = new Set([
  "user_id",
  "actor",
  "principal",
  "principal_ref",
  "session_id",
  "review_session_id",
  "source_type",
  "source_ref",
  "model_version_id",
  "primary_artifact_id",
  "active_binding_revision",
  "mapping_provenance",
  "primary_lease_capability",
  "auth_scope",
  "lease_id",
  "lease_token",
  "viewer_lease_id",
  "viewer_lease_token",
  "a4_trusted_context",
  "proof_id",
  "snapshot_hash",
  "proof_digest",
  "creation_request_hash",
]);
const BROWSER_AUTHORITY_HEADERS = new Set(["x-actor", "x-operator"]);
const PROOF_PATTERN = /^a4p\.[A-Za-z0-9_-]{1,64}\.[A-Za-z0-9_-]{16,96}\.[0-9a-f]{64}$/;
const IFC_GUID_PATTERN = /^[A-Za-z0-9_$-]{1,64}$/;
const USD_PRIM_PATTERN = /^\/(?:[A-Za-z_][A-Za-z0-9_]*)+(?:\/[A-Za-z_][A-Za-z0-9_]*)*$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizedRequestHeaders(request: Request): Record<string, string | undefined> {
  const headers: Record<string, string | undefined> = {};
  for (const [name, value] of Object.entries(request.headers)) {
    headers[name.toLowerCase()] = Array.isArray(value) ? value[0] : value;
  }
  return headers;
}

function hasBrowserAuthorityHeader(headers: Record<string, string | undefined>): boolean {
  return [...BROWSER_AUTHORITY_HEADERS].some((name) => {
    const value = headers[name];
    return typeof value === "string" && value.trim().length > 0;
  });
}

function optionalText(
  body: Record<string, unknown>,
  key: "description" | "assignee" | "usd_prim_path",
  maxLength: number,
): boolean {
  const value = body[key];
  return value === undefined || value === null || (typeof value === "string" && value.length <= maxLength);
}

function sanitizeIssueDraft(body: unknown): SanitizedDraft {
  if (!isRecord(body)) {
    return { ok: false, authority: false, detail: "A4 Issue draft must be a JSON object." };
  }
  const keys = Object.keys(body);
  if (keys.some((key) => BROWSER_AUTHORITY_KEYS.has(key.toLowerCase()))) {
    return { ok: false, authority: true, detail: "Browser identity or authority fields are not accepted." };
  }
  if (keys.some((key) => !ISSUE_DRAFT_KEYS.has(key))) {
    return { ok: false, authority: false, detail: "A4 Issue draft contains unsupported fields." };
  }
  if (
    typeof body.title !== "string"
    || body.title.trim().length === 0
    || body.title.length > 500
    || !optionalText(body, "description", 4_000)
    || !optionalText(body, "assignee", 256)
    || !optionalText(body, "usd_prim_path", 2_048)
    || (body.severity !== "low" && body.severity !== "medium"
      && body.severity !== "high" && body.severity !== "critical")
    || typeof body.ifc_guid !== "string"
    || !IFC_GUID_PATTERN.test(body.ifc_guid)
    || typeof body.evidence_proof !== "string"
    || !PROOF_PATTERN.test(body.evidence_proof)
    || !isRecord(body.a4_evidence_snapshot)
  ) {
    return { ok: false, authority: false, detail: "A4 Issue draft is invalid." };
  }
  if (
    typeof body.usd_prim_path === "string"
    && !USD_PRIM_PATTERN.test(body.usd_prim_path)
  ) {
    return { ok: false, authority: false, detail: "A4 Issue USD prim path is invalid." };
  }
  return { ok: true, value: body as A4IssueDraft };
}

function authenticate(
  request: Request,
  response: Response,
  deps: A4IssueRouteDeps,
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
    response.status(resolution.status).json({
      error_code: resolution.error_code,
      detail: resolution.detail,
    });
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

function resolveSession(
  response: Response,
  deps: A4IssueRouteDeps,
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
    response.status(resolution.status).json({
      error_code: resolution.error_code,
      detail: resolution.detail,
    });
    return null;
  }
  return resolution.context;
}

function trustedIssueContext(
  sessionId: string,
  principal: A4SearchPrincipal,
  context: A4SearchSessionContext,
): Record<string, unknown> | null {
  if (
    principal.auth_scope !== "production"
    || context.review_session_id !== sessionId
    || !context.model_version_id
    || !context.primary_artifact_id
    || !context.active_binding_revision
    || context.mapping_provenance !== "server_resolved"
    || !context.element_mapping_path
    || context.primary_lease_capability !== "verified"
  ) return null;
  return {
    scope: "session_table_only",
    review_session_id: sessionId,
    principal_ref: principal.principal_ref,
    primary_artifact_id: context.primary_artifact_id,
    active_binding_revision: context.active_binding_revision,
    model_version_id: context.model_version_id,
    auth_scope: "production",
    mapping_provenance: "server_resolved",
    primary_lease_capability: "verified",
  };
}

function snapshotMatchesCurrentBinding(
  draft: A4IssueDraft,
  trusted: Record<string, unknown>,
): boolean {
  const snapshot = draft.a4_evidence_snapshot;
  const binding = snapshot.session_binding;
  const row = snapshot.row;
  if (!isRecord(binding) || !isRecord(row)) return false;
  const expected = {
    review_session_id: trusted.review_session_id,
    principal_ref: trusted.principal_ref,
    primary_artifact_id: trusted.primary_artifact_id,
    active_binding_revision: trusted.active_binding_revision,
    model_version_id: trusted.model_version_id,
    mapping_provenance: "server_resolved",
    primary_lease_capability: "verified",
    auth_scope: "production",
    session_id: trusted.review_session_id,
    principal: trusted.principal_ref,
    model_artifact: trusted.primary_artifact_id,
  };
  if (
    snapshot.model_version_id !== trusted.model_version_id
    || Object.entries(expected).some(([key, value]) => binding[key] !== value)
    || row.ifc_guid !== draft.ifc_guid
  ) return false;
  const acceptedPrim = row.accepted_usd_prim;
  const snapshotPrim = row.usd_prim_path;
  const draftPrim = draft.usd_prim_path ?? null;
  return (acceptedPrim ?? null) === draftPrim && (snapshotPrim ?? null) === draftPrim;
}

export function registerA4IssueRoutes(app: Express, deps: A4IssueRouteDeps): void {
  app.post("/api/governance/issues/from-a4-search/for-session/:sessionId", (request, response) => {
    const sessionId = request.params.sessionId;
    if (!deps.isSafeSessionId?.(sessionId)) {
      response.status(400).json({ error_code: "invalid_session_id", detail: "Invalid review session id." });
      return;
    }
    const principal = authenticate(request, response, deps);
    if (!principal) return;
    if (principal.auth_scope !== "production") {
      response.status(503).json({
        error_code: "a4_issue_authority_unavailable",
        detail: "Production A4 Issue authority is unavailable.",
      });
      return;
    }
    const draft = sanitizeIssueDraft(request.body);
    if (!draft.ok) {
      response.status(draft.authority ? 403 : 400).json({
        error_code: draft.authority ? "a4_browser_authority_forbidden" : "invalid_a4_issue_draft",
        detail: draft.detail,
      });
      return;
    }
    const context = resolveSession(response, deps, sessionId, principal);
    if (!context) return;
    const trusted = trustedIssueContext(sessionId, principal, context);
    if (!trusted) {
      response.status(503).json({
        error_code: "a4_issue_authority_unavailable",
        detail: "Current A4 Issue session authority is unavailable.",
      });
      return;
    }
    if (!snapshotMatchesCurrentBinding(draft.value, trusted)) {
      response.status(403).json({
        error_code: "a4_issue_binding_mismatch",
        detail: "A4 Issue evidence does not match the current authorized session.",
      });
      return;
    }
    void forwardTrustedA4(
      response,
      deps,
      "/api/internal/a4/issues/from-search",
      "deterministic",
      { ...draft.value, a4_trusted_context: trusted },
      [context.ifc_source_path, context.element_mapping_path ?? ""],
      [
        draft.value.title.normalize("NFC").trim(),
        ...(draft.value.description
          ? [draft.value.description.normalize("NFC")]
          : []),
        ...(draft.value.assignee
          ? [draft.value.assignee.normalize("NFC").trim()]
          : []),
      ],
    );
  });
}
