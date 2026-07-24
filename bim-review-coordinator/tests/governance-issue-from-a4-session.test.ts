import http from "node:http";
import type { AddressInfo } from "node:net";

import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  registerA4IssueRoutes,
  type A4IssueRouteDeps,
} from "../src/routes/a4IssueRoutes.js";

type RecordedRequest = {
  url: string;
  headers: http.IncomingHttpHeaders;
  body: Record<string, unknown>;
};

const activeServers: http.Server[] = [];
const originalBase = process.env.GOVERNANCE_API_BASE;
const originalInternalToken = process.env.A4_INTERNAL_CONTEXT_TOKEN;

beforeEach(() => {
  process.env.A4_INTERNAL_CONTEXT_TOKEN = "test-a4-internal-context-token";
});

afterEach(async () => {
  while (activeServers.length > 0) {
    const server = activeServers.pop();
    await new Promise<void>((resolve) => server?.close(() => resolve()));
  }
  if (originalBase === undefined) delete process.env.GOVERNANCE_API_BASE;
  else process.env.GOVERNANCE_API_BASE = originalBase;
  if (originalInternalToken === undefined) delete process.env.A4_INTERNAL_CONTEXT_TOKEN;
  else process.env.A4_INTERNAL_CONTEXT_TOKEN = originalInternalToken;
});

async function startGovernanceStub(options: { status?: number; body?: unknown } = {}) {
  const calls: RecordedRequest[] = [];
  const server = http.createServer((incoming, outgoing) => {
    const chunks: Buffer[] = [];
    incoming.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    incoming.on("end", () => {
      calls.push({
        url: incoming.url ?? "/",
        headers: incoming.headers,
        body: JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>,
      });
      const payload = JSON.stringify(options.body ?? {
        issue: { id: "iss_a4", source_type: "a4_search" },
        replayed: false,
      });
      outgoing.writeHead(options.status ?? 201, { "Content-Type": "application/json" });
      outgoing.end(payload);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  activeServers.push(server);
  return {
    calls,
    baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
  };
}

const sessionId = "review_session_a4test001";
const principalRef = "production_principal_a4";

function sessionContext() {
  return {
    ifc_source_path: "C:\\server-only\\model.ifc",
    element_mapping_path: "C:\\server-only\\element_mapping.json",
    model_version_id: "a4_fixture_v1",
    review_session_id: sessionId,
    primary_artifact_id: "artifact_a4",
    active_binding_revision: "binding_a4_1",
    mapping_provenance: "server_resolved" as const,
    primary_lease_capability: "verified" as const,
  };
}

function routeApp(overrides: Partial<A4IssueRouteDeps> = {}) {
  const app = express();
  app.use(express.json());
  registerA4IssueRoutes(app, {
    isSafeSessionId: (value) => /^review_session_[A-Za-z0-9_-]+$/.test(value),
    authenticatePrincipal: () => ({
      ok: true,
      principal: { principal_ref: principalRef, auth_scope: "production" },
    }),
    resolveSessionContext: () => ({ ok: true, context: sessionContext() }),
    a4InternalContextToken: "test-a4-internal-context-token",
    ...overrides,
  });
  return app;
}

function evidenceSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    schema_version: "a4-proof-v1",
    query_id: "a4q_issue_fixture_0001",
    query: "IfcDoor",
    normalized_filters: { ifc_classes: ["IfcDoor"] },
    interpretation: {
      source: "deterministic_grammar",
      degraded_to_deterministic: false,
      unresolved_terms: [],
    },
    row: {
      ifc_guid: "0A4DoorLow000000000001",
      ifc_class: "IfcDoor",
      matched_properties: {},
      predicate_trace: ["IfcDoor"],
      accepted_usd_prim: "/World/Doors/Low",
      usd_prim_path: "/World/Doors/Low",
      mapping_observed: true,
    },
    model_version_id: "a4_fixture_v1",
    session_binding: {
      review_session_id: sessionId,
      principal_ref: principalRef,
      primary_artifact_id: "artifact_a4",
      active_binding_revision: "binding_a4_1",
      model_version_id: "a4_fixture_v1",
      mapping_provenance: "server_resolved",
      primary_lease_capability: "verified",
      auth_scope: "production",
      session_id: sessionId,
      principal: principalRef,
      model_artifact: "artifact_a4",
    },
    mapping_digest: "a".repeat(64),
    ...overrides,
  };
}

function issuePayload(overrides: Record<string, unknown> = {}) {
  return {
    title: "4F 防火門 FireRating 不足",
    description: "人工確認",
    severity: "high",
    assignee: "reviewer-a4",
    ifc_guid: "0A4DoorLow000000000001",
    usd_prim_path: "/World/Doors/Low",
    evidence_proof: `a4p.a4_test_kid.proof_id_fixture_0001.${"b".repeat(64)}`,
    a4_evidence_snapshot: evidenceSnapshot(),
    ...overrides,
  };
}

describe("session-scoped A4 Issue route", () => {
  it("forwards one exact draft with non-overridable trusted current context", async () => {
    const governance = await startGovernanceStub();
    process.env.GOVERNANCE_API_BASE = governance.baseUrl;
    const payload = issuePayload();

    const response = await request(routeApp())
      .post(`/api/governance/issues/from-a4-search/for-session/${sessionId}`)
      .send(payload);

    expect(response.status).toBe(201);
    expect(governance.calls).toHaveLength(1);
    expect(governance.calls[0].url).toBe("/api/internal/a4/issues/from-search");
    expect(governance.calls[0].headers["x-a4-internal-token"]).toBe(
      "test-a4-internal-context-token",
    );
    expect(governance.calls[0].body).toEqual({
      ...payload,
      a4_trusted_context: {
        scope: "session_table_only",
        review_session_id: sessionId,
        principal_ref: principalRef,
        primary_artifact_id: "artifact_a4",
        active_binding_revision: "binding_a4_1",
        model_version_id: "a4_fixture_v1",
        auth_scope: "production",
        mapping_provenance: "server_resolved",
        primary_lease_capability: "verified",
      },
    });
  });

  it("allows exact path-like draft echoes without hiding a committed Issue", async () => {
    const title = "/Door defect";
    const description = "Inspect user note C:\\model";
    const snapshot = evidenceSnapshot({ query: "/Door query" });
    const governance = await startGovernanceStub({
      body: {
        issue: {
          id: "iss_a4_pathlike_draft",
          source_type: "a4_search",
          title,
          description,
          a4_evidence_snapshot: snapshot,
        },
        replayed: false,
      },
    });
    process.env.GOVERNANCE_API_BASE = governance.baseUrl;

    const response = await request(routeApp())
      .post(`/api/governance/issues/from-a4-search/for-session/${sessionId}`)
      .send(issuePayload({ title, description, a4_evidence_snapshot: snapshot }));

    expect(response.status).toBe(201);
    expect(response.body.issue.title).toBe(title);
    expect(response.body.issue.description).toBe(description);
    expect(response.body.issue.a4_evidence_snapshot.query).toBe("/Door query");
    expect(governance.calls).toHaveLength(1);
  });

  it("rejects missing auth and session resolution failures before upstream persistence", async () => {
    const governance = await startGovernanceStub();
    process.env.GOVERNANCE_API_BASE = governance.baseUrl;
    const unauthenticated = await request(routeApp({
      authenticatePrincipal: () => ({
        ok: false,
        status: 401,
        error_code: "a4_authentication_required",
        detail: "Authentication is required.",
      }),
    }))
      .post(`/api/governance/issues/from-a4-search/for-session/${sessionId}`)
      .send(issuePayload());
    expect(unauthenticated.status).toBe(401);

    const inactive = await request(routeApp({
      resolveSessionContext: () => ({
        ok: false,
        status: 409,
        error_code: "a4_session_inactive",
        detail: "A4 review session is not active.",
      }),
    }))
      .post(`/api/governance/issues/from-a4-search/for-session/${sessionId}`)
      .send(issuePayload());
    expect(inactive.status).toBe(409);
    expect(governance.calls).toHaveLength(0);
  });

  it("fails closed for lab identity, unavailable mapping, or unverified primary lease", async () => {
    const governance = await startGovernanceStub();
    process.env.GOVERNANCE_API_BASE = governance.baseUrl;
    const lab = await request(routeApp({
      authenticatePrincipal: () => ({
        ok: true,
        principal: { principal_ref: principalRef, auth_scope: "lab" },
      }),
    }))
      .post(`/api/governance/issues/from-a4-search/for-session/${sessionId}`)
      .send(issuePayload());
    expect(lab.status).toBe(503);
    expect(lab.body.error_code).toBe("a4_issue_authority_unavailable");

    const unverified = await request(routeApp({
      resolveSessionContext: () => ({
        ok: true,
        context: { ...sessionContext(), primary_lease_capability: "lab_unverified" },
      }),
    }))
      .post(`/api/governance/issues/from-a4-search/for-session/${sessionId}`)
      .send(issuePayload());
    expect(unverified.status).toBe(503);

    const unmapped = await request(routeApp({
      resolveSessionContext: () => ({
        ok: true,
        context: { ...sessionContext(), mapping_provenance: "unavailable" },
      }),
    }))
      .post(`/api/governance/issues/from-a4-search/for-session/${sessionId}`)
      .send(issuePayload());
    expect(unmapped.status).toBe(503);

    const nonAsciiToken = await request(routeApp({
      a4InternalContextToken: "test-a4-internal-token-非",
    }))
      .post(`/api/governance/issues/from-a4-search/for-session/${sessionId}`)
      .send(issuePayload());
    expect(nonAsciiToken.status).toBe(503);
    expect(nonAsciiToken.body.error_code).toBe("a4_trusted_context_unavailable");
    expect(governance.calls).toHaveLength(0);
  });

  it("rejects body/header authority and cross-session evidence without upstream calls", async () => {
    const governance = await startGovernanceStub();
    process.env.GOVERNANCE_API_BASE = governance.baseUrl;
    const bodyAuthority = await request(routeApp())
      .post(`/api/governance/issues/from-a4-search/for-session/${sessionId}`)
      .send(issuePayload({ source_type: "a4_search" }));
    expect(bodyAuthority.status).toBe(403);
    expect(bodyAuthority.body.error_code).toBe("a4_browser_authority_forbidden");

    const headerAuthority = await request(routeApp())
      .post(`/api/governance/issues/from-a4-search/for-session/${sessionId}`)
      .set("X-Actor", "admin")
      .send(issuePayload());
    expect(headerAuthority.status).toBe(403);

    const crossSession = await request(routeApp())
      .post(`/api/governance/issues/from-a4-search/for-session/${sessionId}`)
      .send(issuePayload({
        a4_evidence_snapshot: evidenceSnapshot({
          session_binding: {
            ...(evidenceSnapshot().session_binding as Record<string, unknown>),
            review_session_id: "review_session_other",
            session_id: "review_session_other",
          },
        }),
      }));
    expect(crossSession.status).toBe(403);
    expect(crossSession.body.error_code).toBe("a4_issue_binding_mismatch");
    expect(governance.calls).toHaveLength(0);
  });

  it("preserves safe governance errors but replaces path-bearing responses", async () => {
    const safe = await startGovernanceStub({
      status: 409,
      body: { detail: { code: "a4_proof_expired", retryable: true } },
    });
    process.env.GOVERNANCE_API_BASE = safe.baseUrl;
    const expired = await request(routeApp())
      .post(`/api/governance/issues/from-a4-search/for-session/${sessionId}`)
      .send(issuePayload());
    expect(expired.status).toBe(409);
    expect(expired.body.detail.code).toBe("a4_proof_expired");

    const leaking = await startGovernanceStub({
      status: 422,
      body: { detail: "C:\\governance-private\\model.ifc" },
    });
    process.env.GOVERNANCE_API_BASE = leaking.baseUrl;
    const sanitized = await request(routeApp())
      .post(`/api/governance/issues/from-a4-search/for-session/${sessionId}`)
      .send(issuePayload());
    expect(sanitized.status).toBe(502);
    expect(JSON.stringify(sanitized.body)).not.toContain("governance-private");
  });
});
