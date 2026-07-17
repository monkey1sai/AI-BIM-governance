/** A4 search proxy: browser controls stay bounded; context stays coordinator-owned. */
import { afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import type { AddressInfo } from "node:net";
import http from "node:http";
import express from "express";
import {
  registerGovernanceProxy,
  type A4SearchSessionResolution,
  type GovernanceProxyDeps,
} from "../src/routes/governanceProxy.js";

const activeServers: http.Server[] = [];
const originalNodeEnv = process.env.NODE_ENV;

function makeProxyApp(deps: GovernanceProxyDeps) {
  const app = express();
  app.use(express.json());
  registerGovernanceProxy(app, deps);
  return app;
}

function trustedSessionContext() {
  return {
    ifc_source_path: "C:/server-only/a4.ifc",
    model_version_id: "a4_fixture_v1",
    review_session_id: "review_session_deadbeef12",
    principal_ref: "a4p_test_opaque",
    auth_scope: "lab" as const,
    primary_lease_capability: "lab_unverified" as const,
    primary_artifact_id: "artifact_a4",
    mapping_provenance: "unavailable" as const,
    active_binding_revision: "binding_a4_1",
  };
}

function trustedSessionResolution(): A4SearchSessionResolution {
  return { ok: true, context: trustedSessionContext() };
}

async function startGovernanceStub() {
  const urls: string[] = [];
  const bodies: Record<string, unknown>[] = [];
  const headers: Record<string, string | undefined>[] = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      urls.push(`${req.method} ${req.url}`);
      let body: Record<string, unknown> = {};
      if (chunks.length) {
        try {
          body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
        } catch {
          body = {};
        }
      }
      bodies.push(body);
      headers.push({ "x-a4-internal-token": typeof req.headers["x-a4-internal-token"] === "string" ? req.headers["x-a4-internal-token"] : undefined });
      if (req.method === "POST" && (
        req.url === "/api/internal/a4/search/model" ||
        req.url === "/api/internal/a4/search/model/confirm-partial" ||
        req.url === "/api/internal/a4/issues"
      )) {
        res.writeHead(req.url === "/api/internal/a4/issues" ? 201 : 200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          status: "ok",
          interpreted_filters: { raw_query: body.query, interpretable: true },
          results: [],
          stats: { total: 0, matched: 0, unmapped: 0, scanned: 0 },
          evidence_refs: [],
        }));
        return;
      }
      res.writeHead(404).end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  activeServers.push(server);
  const address = server.address() as AddressInfo;
  return { baseUrl: `http://127.0.0.1:${address.port}`, urls, bodies, headers };
}

async function startRedirectingGovernanceStub(destination: string) {
  const headers: Record<string, string | undefined>[] = [];
  const server = http.createServer((req, res) => {
    headers.push({ "x-a4-internal-token": typeof req.headers["x-a4-internal-token"] === "string" ? req.headers["x-a4-internal-token"] : undefined });
    res.writeHead(302, { Location: destination });
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  activeServers.push(server);
  const address = server.address() as AddressInfo;
  return { baseUrl: `http://127.0.0.1:${address.port}`, headers };
}

async function startDestinationStub() {
  const headers: Record<string, string | undefined>[] = [];
  const server = http.createServer((req, res) => {
    headers.push({ "x-a4-internal-token": typeof req.headers["x-a4-internal-token"] === "string" ? req.headers["x-a4-internal-token"] : undefined });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end("{}");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  activeServers.push(server);
  const address = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${address.port}/second-hop`, headers };
}

afterEach(async () => {
  while (activeServers.length) {
    const server = activeServers.pop();
    await new Promise<void>((resolve) => server?.close(() => resolve()));
  }
  delete process.env.GOVERNANCE_API_BASE;
  process.env.NODE_ENV = originalNodeEnv;
});

describe("A4 governance search proxy", () => {
  it("forwards only coordinator-owned session context and bounded browser controls", async () => {
    const gov = await startGovernanceStub();
    process.env.GOVERNANCE_API_BASE = gov.baseUrl;
    const headers: Record<string, string | undefined>[] = [];
    const app = makeProxyApp({
      isSafeSessionId: () => true,
      a4InternalContextToken: "test-a4-internal-context-token",
      resolveA4SearchSessionContext: (_sessionId, requestHeaders) => {
        headers.push(requestHeaders);
        return trustedSessionResolution();
      },
    });

    const response = await request(app)
      .post("/api/governance/search/model/for-session/review_session_deadbeef12")
      .set("Authorization", "Bearer test-user")
      .send({ query: "IfcDoor", limit: 10, interpret_mode: "deterministic" });

    expect(response.status).toBe(200);
    expect(headers[0]?.authorization).toBe("Bearer test-user");
    expect(gov.urls).toEqual(["POST /api/internal/a4/search/model"]);
    expect(gov.headers[0]?.["x-a4-internal-token"]).toBe("test-a4-internal-context-token");
    expect(gov.bodies[0]).toEqual({
      ifc_source_path: "C:/server-only/a4.ifc",
      model_version_id: "a4_fixture_v1",
      query: "IfcDoor",
      limit: 10,
      interpret_mode: "deterministic",
      a4_trusted_context: {
        scope: "session_table_only",
        review_session_id: "review_session_deadbeef12",
        principal_ref: "a4p_test_opaque",
        primary_artifact_id: "artifact_a4",
        active_binding_revision: "binding_a4_1",
        model_version_id: "a4_fixture_v1",
        auth_scope: "lab",
        mapping_provenance: "unavailable",
        primary_lease_capability: "lab_unverified",
      },
    });
  });

  it("authenticates before parsing rejected browser controls and never forwards them", async () => {
    const gov = await startGovernanceStub();
    process.env.GOVERNANCE_API_BASE = gov.baseUrl;
    const app = makeProxyApp({
      isSafeSessionId: () => true,
      resolveA4SearchSessionContext: () => ({
        ok: false,
        status: 401,
        error_code: "a4_authentication_required",
        detail: "A4 authentication failed.",
      }),
    });

    const response = await request(app)
      .post("/api/governance/search/model/for-session/review_session_deadbeef12")
      .send({ ifc_source_path: "C:/browser-controlled.ifc", element_mapping_path: "C:/browser.map" });

    expect(response.status).toBe(401);
    expect(response.body.error_code).toBe("a4_authentication_required");
    expect(gov.bodies).toHaveLength(0);
  });

  it("rejects browser path, mapping, and actor fields after trusted context resolution", async () => {
    const gov = await startGovernanceStub();
    process.env.GOVERNANCE_API_BASE = gov.baseUrl;
    const app = makeProxyApp({
      isSafeSessionId: () => true,
      resolveA4SearchSessionContext: () => trustedSessionResolution(),
    });

    const response = await request(app)
      .post("/api/governance/search/model/for-session/review_session_deadbeef12")
      .send({
        query: "IfcDoor",
        ifc_source_path: "C:/browser-controlled.ifc",
        element_mapping_path: "C:/browser.map",
        user_id: "forged-user",
      });

    expect(response.status).toBe(400);
    expect(response.body.error_code).toBe("invalid_a4_search_controls");
    expect(gov.bodies).toHaveLength(0);
  });

  it("re-resolves session context and forwards only an opaque partial confirmation", async () => {
    const gov = await startGovernanceStub();
    process.env.GOVERNANCE_API_BASE = gov.baseUrl;
    const headers: Record<string, string | undefined>[] = [];
    const app = makeProxyApp({
      isSafeSessionId: () => true,
      a4InternalContextToken: "test-a4-internal-context-token",
      resolveA4SearchSessionContext: (_sessionId, requestHeaders) => {
        headers.push(requestHeaders);
        return trustedSessionResolution();
      },
    });

    const response = await request(app)
      .post("/api/governance/search/model/for-session/review_session_deadbeef12/partial-confirmation")
      .set("Authorization", "Bearer test-user")
      .send({ partial_fallback_id: "a4pf_partial_confirmation_123" });

    expect(response.status).toBe(200);
    expect(headers[0]?.authorization).toBe("Bearer test-user");
    expect(gov.urls).toEqual(["POST /api/internal/a4/search/model/confirm-partial"]);
    expect(gov.bodies[0]).toEqual({
      partial_fallback_id: "a4pf_partial_confirmation_123",
      a4_trusted_context: {
        scope: "session_table_only",
        review_session_id: "review_session_deadbeef12",
        principal_ref: "a4p_test_opaque",
        primary_artifact_id: "artifact_a4",
        active_binding_revision: "binding_a4_1",
        model_version_id: "a4_fixture_v1",
        auth_scope: "lab",
        mapping_provenance: "unavailable",
        primary_lease_capability: "lab_unverified",
      },
    });
  });

  it("marks ifc-ready search as coordinator-enforced table-only scope", async () => {
    const gov = await startGovernanceStub();
    process.env.GOVERNANCE_API_BASE = gov.baseUrl;
    const app = makeProxyApp({
      isSafeIfcReadyJobId: () => true,
      a4InternalContextToken: "test-a4-internal-context-token",
      resolveA4SearchIfcReadyContext: () => ({
        ok: true,
        context: { ifc_source_path: "C:/server-only/a4.ifc", model_version_id: "a4_fixture_v1" },
      }),
    });

    const response = await request(app)
      .post("/api/governance/search/model/for-ifc-ready/ifc_ready_a4")
      .send({ query: "IfcDoor" });

    expect(response.status).toBe(200);
    expect(gov.bodies[0]).toMatchObject({
      ifc_source_path: "C:/server-only/a4.ifc",
      a4_trusted_context: { scope: "ifc_ready_table_only" },
    });
    expect(JSON.stringify(gov.bodies[0])).not.toContain("element_mapping_path");
  });

  it("fails closed when ifc-ready ownership authorization is not configured", async () => {
    const gov = await startGovernanceStub();
    process.env.GOVERNANCE_API_BASE = gov.baseUrl;
    const app = makeProxyApp({
      isSafeIfcReadyJobId: () => true,
      a4InternalContextToken: "test-a4-internal-context-token",
    });

    const response = await request(app)
      .post("/api/governance/search/model/for-ifc-ready/ifc_ready_a4")
      .send({ query: "IfcDoor" });

    expect(response.status).toBe(503);
    expect(response.body.error_code).toBe("a4_trusted_context_unavailable");
    expect(gov.bodies).toHaveLength(0);
  });

  it("does not forward an A4 context token to a non-loopback governance base", async () => {
    const gov = await startGovernanceStub();
    process.env.GOVERNANCE_API_BASE = "http://example.invalid";
    const app = makeProxyApp({
      isSafeSessionId: () => true,
      a4InternalContextToken: "test-a4-internal-context-token",
      resolveA4SearchSessionContext: () => trustedSessionResolution(),
    });

    const response = await request(app)
      .post("/api/governance/search/model/for-session/review_session_deadbeef12")
      .send({ query: "IfcDoor" });

    expect(response.status).toBe(503);
    expect(response.body.error_code).toBe("a4_trusted_context_unavailable");
    expect(gov.bodies).toHaveLength(0);
  });

  it("rejects an A4 upstream redirect before a token can reach its second hop", async () => {
    const destination = await startDestinationStub();
    const redirect = await startRedirectingGovernanceStub(destination.url);
    process.env.GOVERNANCE_API_BASE = redirect.baseUrl;
    const app = makeProxyApp({
      isSafeSessionId: () => true,
      a4InternalContextToken: "test-a4-internal-context-token",
      resolveA4SearchSessionContext: () => trustedSessionResolution(),
    });

    const response = await request(app)
      .post("/api/governance/search/model/for-session/review_session_deadbeef12")
      .send({ query: "IfcDoor" });

    expect(response.status).toBe(502);
    expect(response.body.error_code).toBe("governance_service_unavailable");
    expect(redirect.headers).toHaveLength(1);
    expect(destination.headers).toHaveLength(0);
  });

  it("never registers generic host-path search, including test mode", async () => {
    process.env.NODE_ENV = "test";
    const gov = await startGovernanceStub();
    process.env.GOVERNANCE_API_BASE = gov.baseUrl;
    const app = makeProxyApp({});

    const response = await request(app)
      .post("/api/governance/search/model")
      .send({ ifc_source_path: "C:/browser-controlled.ifc", query: "IfcDoor" });

    expect(response.status).toBe(404);
    expect(gov.bodies).toHaveLength(0);
  });

  it("reauthorizes and forwards only an opaque A4 proof plus editable Issue draft", async () => {
    const gov = await startGovernanceStub();
    process.env.GOVERNANCE_API_BASE = gov.baseUrl;
    const app = makeProxyApp({
      isSafeSessionId: () => true,
      a4InternalContextToken: "test-a4-internal-context-token",
      resolveA4SearchSessionContext: () => ({
        ok: true,
        context: {
          ...trustedSessionContext(),
          auth_scope: "production",
          primary_lease_capability: "verified",
          mapping_provenance: "server_resolved",
        },
      }),
    });
    const proof = `a4p.a4_test_kid.proof_id_with_under_score_0001.${"a".repeat(64)}`;

    const response = await request(app)
      .post("/api/governance/issues/from-a4-search/for-session/review_session_deadbeef12")
      .set("Authorization", "Bearer test-user")
      .send({
        evidence_proof: proof,
        title: "A4 selected door needs review",
        description: "Editable draft only.",
        severity: "high",
        assignee: "ops-a4",
      });

    expect(response.status).toBe(201);
    expect(gov.urls).toEqual(["POST /api/internal/a4/issues"]);
    expect(gov.headers[0]?.["x-a4-internal-token"]).toBe("test-a4-internal-context-token");
    expect(gov.bodies[0]).toEqual({
      evidence_proof: proof,
      title: "A4 selected door needs review",
      description: "Editable draft only.",
      severity: "high",
      assignee: "ops-a4",
      a4_trusted_context: {
        scope: "session_table_only",
        review_session_id: "review_session_deadbeef12",
        principal_ref: "a4p_test_opaque",
        primary_artifact_id: "artifact_a4",
        active_binding_revision: "binding_a4_1",
        model_version_id: "a4_fixture_v1",
        auth_scope: "production",
        mapping_provenance: "server_resolved",
        primary_lease_capability: "verified",
      },
    });
    expect(JSON.stringify(gov.bodies[0])).not.toContain("ifc_source_path");
    expect(JSON.stringify(gov.bodies[0])).not.toContain("ifc_guid");
  });

  it("keeps A4 Issue mutation fail-closed when the authentic lease is unavailable", async () => {
    const gov = await startGovernanceStub();
    process.env.GOVERNANCE_API_BASE = gov.baseUrl;
    const app = makeProxyApp({
      isSafeSessionId: () => true,
      a4InternalContextToken: "test-a4-internal-context-token",
      resolveA4SearchSessionContext: () => trustedSessionResolution(),
    });

    const response = await request(app)
      .post("/api/governance/issues/from-a4-search/for-session/review_session_deadbeef12")
      .send({ evidence_proof: `a4p.a4_test_kid.proof_id_with_under_score_0001.${"a".repeat(64)}`, title: "blocked" });

    expect(response.status).toBe(409);
    expect(response.body.error_code).toBe("a4_issue_not_eligible");
    expect(gov.bodies).toHaveLength(0);
  });
});
