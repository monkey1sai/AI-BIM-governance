import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";

import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createCoordinatorApp, type CoordinatorApp } from "../src/app.js";
import {
  registerA4SearchRoutes,
  type A4SearchRouteDeps,
  type A4SearchSessionContext,
} from "../src/routes/a4SearchRoutes.js";
import { ExternalIfcReadyStore } from "../src/services/externalIfcReadyStore.js";
import { SessionStore } from "../src/services/sessionStore.js";

type RecordedRequest = {
  method: string;
  url: string;
  headers: http.IncomingHttpHeaders;
  body: Record<string, unknown>;
};

type GovernanceStubOptions = {
  status?: number;
  responseBody?: unknown;
  redirectTo?: string;
  declaredLength?: number;
  delayMs?: number;
};

const activeServers: http.Server[] = [];
const activeApps: CoordinatorApp[] = [];
const temporaryRoots: string[] = [];
const originalEnvironment = {
  governanceApiBase: process.env.GOVERNANCE_API_BASE,
  a4TrustedGovernanceOrigins: process.env.A4_TRUSTED_GOVERNANCE_ORIGINS,
  a4InternalContextToken: process.env.A4_INTERNAL_CONTEXT_TOKEN,
  externalIfcReadyStorePath: process.env.EXTERNAL_IFC_READY_STORE_PATH,
  nodeEnv: process.env.NODE_ENV,
};

function restoreEnvironment(name: keyof typeof originalEnvironment, envName: string): void {
  const value = originalEnvironment[name];
  if (value === undefined) delete process.env[envName];
  else process.env[envName] = value;
}

beforeEach(() => {
  process.env.NODE_ENV = "test";
  process.env.A4_INTERNAL_CONTEXT_TOKEN = "test-a4-internal-context-token";
});

afterEach(async () => {
  vi.restoreAllMocks();
  while (activeApps.length > 0) {
    const app = activeApps.pop();
    if (!app) continue;
    app.io.close();
    await new Promise<void>((resolve) => app.server.close(() => resolve()));
    await app.dispose();
  }
  while (activeServers.length > 0) {
    const server = activeServers.pop();
    await new Promise<void>((resolve) => server?.close(() => resolve()));
  }
  while (temporaryRoots.length > 0) {
    const root = temporaryRoots.pop();
    if (root) fs.rmSync(root, { recursive: true, force: true });
  }
  restoreEnvironment("governanceApiBase", "GOVERNANCE_API_BASE");
  restoreEnvironment("a4TrustedGovernanceOrigins", "A4_TRUSTED_GOVERNANCE_ORIGINS");
  restoreEnvironment("a4InternalContextToken", "A4_INTERNAL_CONTEXT_TOKEN");
  restoreEnvironment("externalIfcReadyStorePath", "EXTERNAL_IFC_READY_STORE_PATH");
  restoreEnvironment("nodeEnv", "NODE_ENV");
});

async function startGovernanceStub(options: GovernanceStubOptions = {}) {
  const calls: RecordedRequest[] = [];
  const server = http.createServer((incoming, outgoing) => {
    const chunks: Buffer[] = [];
    incoming.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    incoming.on("end", () => {
      let body: Record<string, unknown> = {};
      if (chunks.length > 0) body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
      calls.push({
        method: incoming.method ?? "GET",
        url: incoming.url ?? "/",
        headers: incoming.headers,
        body,
      });
      const sendResponse = () => {
        if (options.redirectTo) {
          outgoing.writeHead(302, { Location: options.redirectTo });
          outgoing.end();
          return;
        }
        const responseBody = options.responseBody ?? {
          status: "ok",
          query_id: "a4q_test_query_123456",
          search_scope: "session_table_only",
          results: [],
          stats: { scanned: 0, matched: 0, returned: 0 },
        };
        const payload = JSON.stringify(responseBody);
        outgoing.writeHead(options.status ?? 200, {
          "Content-Type": "application/json",
          ...(options.declaredLength === undefined ? {} : { "Content-Length": String(options.declaredLength) }),
        });
        outgoing.end(payload);
      };
      if (options.delayMs && options.delayMs > 0) setTimeout(sendResponse, options.delayMs);
      else sendResponse();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  activeServers.push(server);
  const address = server.address() as AddressInfo;
  return { baseUrl: `http://127.0.0.1:${address.port}`, calls };
}

function trustedSessionContext(): A4SearchSessionContext {
  return {
    ifc_source_path: "C:\\server-only\\source.ifc",
    element_mapping_path: "C:\\server-only\\element_mapping.json",
    model_version_id: "version_a4_001",
    review_session_id: "review_session_a4test001",
    primary_artifact_id: "artifact_a4_001",
    active_binding_revision: "binding_rev_a4_001",
    mapping_provenance: "server_resolved",
    primary_lease_capability: "lab_unverified",
  };
}

function routeApp(overrides: Partial<A4SearchRouteDeps> = {}) {
  const app = express();
  app.use(express.json());
  registerA4SearchRoutes(app, {
    isSafeSessionId: (value) => /^review_session_[A-Za-z0-9_-]+$/.test(value),
    isSafeIfcReadyJobId: (value) => /^[A-Za-z0-9_.-]+$/.test(value),
    authenticatePrincipal: () => ({
      ok: true,
      principal: { principal_ref: "lab_principal_a4_001", auth_scope: "lab" },
    }),
    resolveSessionContext: () => ({ ok: true, context: trustedSessionContext() }),
    resolveIfcReadyContext: () => ({
      ok: true,
      context: {
        ifc_source_path: "C:\\server-only\\source.ifc",
        model_version_id: "version_a4_001",
      },
    }),
    a4InternalContextToken: "test-a4-internal-context-token",
    ...overrides,
  });
  return app;
}

async function claimPrimary(
  app: CoordinatorApp,
  sessionId: string,
  userToken: string,
  clientNonce = `${sessionId}:${userToken}`,
) {
  const response = await request(app.app)
    .post(`/api/review-sessions/${sessionId}/viewer-leases/claim`)
    .set("X-User-Token", userToken)
    .send({
      viewer_id: `viewer_${userToken}`,
      requested_role: "primary",
      client_nonce: clientNonce,
    });
  expect(response.status).toBe(200);
  return response.body as { lease_id: string; lease_token: string };
}

async function releaseLease(
  app: CoordinatorApp,
  sessionId: string,
  lease: { lease_id: string; lease_token: string },
) {
  const response = await request(app.app)
    .post(`/api/review-sessions/${sessionId}/viewer-leases/${lease.lease_id}/release`)
    .set("X-Viewer-Lease-Token", lease.lease_token)
    .send({});
  expect(response.status).toBe(200);
}

async function activateStage(
  app: CoordinatorApp,
  sessionId: string,
  traceId: string,
  userToken: string,
  lease: { lease_id: string; lease_token: string },
  artifactId: string,
) {
  const pending = await request(app.app)
    .post(`/api/review-sessions/${sessionId}/stage-binding`)
    .set("X-User-Token", userToken)
    .set("X-Viewer-Lease-Token", lease.lease_token)
    .send({
      source_client_id: lease.lease_id,
      role: "primary",
      artifacts: [{ artifact_id: artifactId, role: "primary", load_order: 0 }],
    });
  expect(pending.status).toBe(200);

  const requestId = "cmd_a4_stage_001";
  const authorization = await request(app.app)
    .post(`/api/internal/review-sessions/${sessionId}/runtime-command-authorizations`)
    .set("X-Internal-Token", "test-internal-token")
    .set("X-Viewer-Lease-Token", lease.lease_token)
    .set("X-Trace-Id", traceId)
    .send({
      trace_id: traceId,
      source_client_id: lease.lease_id,
      requested_event_type: "openStageRequest",
      request_id: requestId,
      command_context: {},
      stage_binding_authorization_id: pending.body.stage_binding_authorization_id,
      binding_revision_id: pending.body.binding_revision_id,
      stage_composition: pending.body.stage_composition,
    });
  expect(authorization.body).toEqual({
    authorized: true,
    request_id: requestId,
    retryable: false,
    trace_id: traceId,
  });

  const confirmation = await request(app.app)
    .post(`/api/internal/review-sessions/${sessionId}/stage-binding-confirmations`)
    .set("X-Internal-Token", "test-internal-token")
    .set("X-Viewer-Lease-Token", lease.lease_token)
    .set("X-Trace-Id", traceId)
    .send({
      trace_id: traceId,
      stage_binding_authorization_id: pending.body.stage_binding_authorization_id,
      binding_revision_id: pending.body.binding_revision_id,
      request_id: requestId,
      outcome: "success",
    });
  expect(confirmation.body).toMatchObject({
    confirmed: true,
    transaction_status: "active",
    active_binding_revision: pending.body.binding_revision_id,
  });
  return pending.body.binding_revision_id as string;
}

function seedCoordinatorFixture(
  governanceBase: string,
  options: { hostArtifactsRoot?: string } = {},
) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "coordinator-a4-search-"));
  temporaryRoots.push(root);
  const edgeRoot = path.join(root, "edge-runtime");
  const storageRoot = path.join(edgeRoot, "storage");
  const sessionStoreDir = path.join(root, "sessions");
  const externalStorePath = path.join(root, "ifc-ready.json");
  const conversionJobId = "stream_conv_a4_001";
  const modelVersionId = "version_a4_001";
  const artifactId = "artifact_a4_primary";
  const sourcePath = path.join(storageRoot, "ifc-cache", "source.ifc");
  const mappingPath = path.join(edgeRoot, "artifacts", conversionJobId, "element_mapping.json");
  fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
  fs.mkdirSync(path.dirname(mappingPath), { recursive: true });
  fs.writeFileSync(sourcePath, "ISO-10303-21;END-ISO-10303-21;", "utf8");
  fs.writeFileSync(mappingPath, "{}", "utf8");

  const timestamp = new Date().toISOString();
  const externalStore = new ExternalIfcReadyStore(externalStorePath);
  const job = externalStore.create({
    event: "ifc_ready",
    tenant_id: "tenant_demo_001",
    project_id: "project_a4_001",
    external_model_version_id: modelVersionId,
    source_ifc: { ref: "http://127.0.0.1/source.ifc", etag: "etag-a4-001" },
  }, {
    correlationId: "corr_a4_001",
    idempotencyKey: "idem_a4_001",
    tenantId: "tenant_demo_001",
    projectId: "project_a4_001",
    externalModelVersionId: modelVersionId,
  });
  const sessions = new SessionStore(sessionStoreDir);
  const session = sessions.create({
    trace_id: job.ifc_ready_job_id,
    project_id: "project_a4_001",
    model_version_id: modelVersionId,
    created_by: "a4_test_fixture",
    kit_instance: {
      instance_id: "kit_a4_001",
      provider: "local_fixed",
      status: "ready",
      stream_server: "127.0.0.1",
      signaling_port: 49100,
      media_server: "127.0.0.1",
      media_port: 47998,
    },
    artifact_bindings: [{
      binding_id: "binding_a4_primary",
      artifact_group_id: "group_a4_001",
      model_version_id: modelVersionId,
      artifact_id: artifactId,
      artifact_role: "derived",
      url: `http://127.0.0.1:49101/artifacts/${conversionJobId}/model.usdc`,
      mapping_url: `http://127.0.0.1:49101/artifacts/${conversionJobId}/element_mapping.json`,
      load_order: 0,
      routing_policy: "same_instance",
      ready_status: "ready",
      conversion_authority: "bim-streaming-server",
      conversion_job_id: conversionJobId,
      conversion_status: "ready",
    }],
    kit_instance_bindings: [{
      kit_instance_id: "kit_a4_001",
      provider: "local_fixed",
      tenant_id: "tenant_demo_001",
      assigned_artifact_ids: [artifactId],
      status: "ready",
      stream_config: {
        signalingServer: "127.0.0.1",
        signalingPort: 49100,
        mediaServer: "127.0.0.1",
        mediaPort: 47998,
      },
      started_at: timestamp,
      last_heartbeat_at: timestamp,
      released_at: null,
      gpu_profile: { profile: "test", capacity_slot: "test-a4" },
    }],
  });

  externalStore.markDownloaded(job.ifc_ready_job_id, sourcePath, sourcePath);
  externalStore.markDispatched(job.ifc_ready_job_id, conversionJobId, "ready");
  externalStore.recordConversionOutcome(job.ifc_ready_job_id, "ready", "outbox_a4_001");
  externalStore.recordReviewSession(job.ifc_ready_job_id, session.session_id);

  process.env.EXTERNAL_IFC_READY_STORE_PATH = externalStorePath;
  process.env.GOVERNANCE_API_BASE = governanceBase;
  const app = createCoordinatorApp({
    sessionStoreDir,
    eventLogDir: path.join(root, "events"),
    callbackOutboxStorePath: path.join(root, "callback-outbox.json"),
    conversionLedgerStorePath: path.join(root, "conversion-ledger.json"),
    artifactHealthLedgerStorePath: path.join(root, "artifact-health-ledger.json"),
    logRoot: path.join(root, "logs"),
    edgeRuntimeDataRoot: edgeRoot,
    a4ConversionArtifactsHostRoot: options.hostArtifactsRoot ?? path.join(edgeRoot, "artifacts"),
    storageRoot,
    storageHostRoot: storageRoot,
    devAuthToken: "test-dev-auth-token",
    internalApiAuthToken: "test-internal-token",
    externalIntakeWebhookSecret: "test-webhook-secret",
    conversionPollEnabled: false,
    minioWatchEnabled: false,
    corsOrigins: ["http://127.0.0.1:5173"],
  });
  activeApps.push(app);
  return {
    app,
    sessions,
    sessionId: session.session_id,
    ifcReadyJobId: job.ifc_ready_job_id,
    modelVersionId,
    artifactId,
    sourcePath,
    mappingPath,
  };
}

describe("A4 search route contract", () => {
  it("forwards byte-identical controls with only coordinator-owned session fields", async () => {
    const governance = await startGovernanceStub();
    process.env.GOVERNANCE_API_BASE = governance.baseUrl;
    const app = routeApp();

    const response = await request(app)
      .post("/api/governance/search/model/for-session/review_session_a4test001")
      .set("Authorization", "Bearer lab-user")
      .send({
        query: "  IfcDoor 名稱保持原樣  ",
        limit: 17,
        interpret_mode: "deterministic",
        retry_of_query_id: "a4q_previous_query_123456",
      });

    expect(response.status).toBe(200);
    expect(governance.calls).toHaveLength(1);
    expect(governance.calls[0]).toMatchObject({
      method: "POST",
      url: "/api/internal/a4/search/model",
      body: {
        ifc_source_path: "C:\\server-only\\source.ifc",
        element_mapping_path: "C:\\server-only\\element_mapping.json",
        model_version_id: "version_a4_001",
        query: "  IfcDoor 名稱保持原樣  ",
        limit: 17,
        interpret_mode: "deterministic",
        retry_of_query_id: "a4q_previous_query_123456",
        a4_trusted_context: {
          scope: "session_table_only",
          review_session_id: "review_session_a4test001",
          principal_ref: "lab_principal_a4_001",
          primary_artifact_id: "artifact_a4_001",
          active_binding_revision: "binding_rev_a4_001",
          model_version_id: "version_a4_001",
          auth_scope: "lab",
          mapping_provenance: "server_resolved",
          primary_lease_capability: "lab_unverified",
        },
      },
    });
    expect(governance.calls[0].headers["x-a4-internal-token"]).toBe("test-a4-internal-context-token");
    expect(JSON.stringify(response.body)).not.toContain("server-only");
  });

  it("authenticates before lookup and rejects browser authority or host fields without outbound", async () => {
    const governance = await startGovernanceStub();
    process.env.GOVERNANCE_API_BASE = governance.baseUrl;
    const resolveSessionContext = vi.fn<NonNullable<A4SearchRouteDeps["resolveSessionContext"]>>(() => ({
      ok: true,
      context: trustedSessionContext(),
    }));
    const unauthenticated = routeApp({
      authenticatePrincipal: () => ({
        ok: false,
        status: 401,
        error_code: "a4_authentication_required",
        detail: "A4 authentication failed.",
      }),
      resolveSessionContext,
    });

    const noIdentity = await request(unauthenticated)
      .post("/api/governance/search/model/for-session/review_session_a4test001")
      .send({ ifc_source_path: "C:/browser.ifc", query: "IfcDoor" });
    expect(noIdentity.status).toBe(401);
    expect(resolveSessionContext).not.toHaveBeenCalled();

    const authenticated = routeApp({ resolveSessionContext });
    const forgedHeader = await request(authenticated)
      .post("/api/governance/search/model/for-session/review_session_a4test001")
      .set("X-Actor", "admin")
      .send({ query: "IfcDoor" });
    expect(forgedHeader.status).toBe(403);
    expect(forgedHeader.body.error_code).toBe("a4_browser_authority_forbidden");

    const forgedBody = await request(authenticated)
      .post("/api/governance/search/model/for-session/review_session_a4test001")
      .send({ query: "IfcDoor", user_id: "admin" });
    expect(forgedBody.status).toBe(403);

    const browserPath = await request(authenticated)
      .post("/api/governance/search/model/for-session/review_session_a4test001")
      .send({ query: "IfcDoor", element_mapping_path: "C:/browser-mapping.json" });
    expect(browserPath.status).toBe(400);
    expect(browserPath.body.error_code).toBe("invalid_a4_search_controls");
    expect(resolveSessionContext).not.toHaveBeenCalled();
    expect(governance.calls).toHaveLength(0);
  });

  it("re-authorizes partial confirmation and accepts only the opaque fallback id", async () => {
    const governance = await startGovernanceStub();
    process.env.GOVERNANCE_API_BASE = governance.baseUrl;
    const app = routeApp();

    const response = await request(app)
      .post("/api/governance/search/model/for-session/review_session_a4test001/partial-confirmation")
      .send({ partial_fallback_id: "a4pf_partial_confirmation_123" });

    expect(response.status).toBe(200);
    expect(governance.calls[0].url).toBe("/api/internal/a4/search/model/confirm-partial");
    expect(governance.calls[0].body).toEqual({
      partial_fallback_id: "a4pf_partial_confirmation_123",
      a4_trusted_context: {
        scope: "session_table_only",
        review_session_id: "review_session_a4test001",
        principal_ref: "lab_principal_a4_001",
        primary_artifact_id: "artifact_a4_001",
        active_binding_revision: "binding_rev_a4_001",
        model_version_id: "version_a4_001",
        auth_scope: "lab",
        mapping_provenance: "server_resolved",
        primary_lease_capability: "lab_unverified",
      },
    });
  });

  it("keeps IFC-ready compatibility table-only and rejects client mapping", async () => {
    const governance = await startGovernanceStub();
    process.env.GOVERNANCE_API_BASE = governance.baseUrl;
    const app = routeApp();

    const response = await request(app)
      .post("/api/governance/search/model/for-ifc-ready/ifcready_a4_001")
      .send({ query: "IfcDoor", interpret_mode: "auto" });
    expect(response.status).toBe(200);
    expect(governance.calls[0].body).toEqual({
      ifc_source_path: "C:\\server-only\\source.ifc",
      model_version_id: "version_a4_001",
      query: "IfcDoor",
      interpret_mode: "auto",
      a4_trusted_context: { scope: "ifc_ready_table_only" },
    });

    const rejected = await request(app)
      .post("/api/governance/search/model/for-ifc-ready/ifcready_a4_001")
      .send({ query: "IfcDoor", element_mapping_path: "C:/browser.json" });
    expect(rejected.status).toBe(400);
    expect(governance.calls).toHaveLength(1);
  });

  it("allows a cold IFC scan to exceed the legacy five-second proxy budget", async () => {
    const governance = await startGovernanceStub({ delayMs: 5_250 });
    process.env.GOVERNANCE_API_BASE = governance.baseUrl;

    const response = await request(routeApp())
      .post("/api/governance/search/model/for-ifc-ready/ifcready_a4_001")
      .send({ query: "IfcDoor", interpret_mode: "deterministic" });

    expect(response.status).toBe(200);
    expect(governance.calls).toHaveLength(1);
  });

  it("assigns short deterministic and layered model-aware upstream deadlines", async () => {
    const governance = await startGovernanceStub();
    process.env.GOVERNANCE_API_BASE = governance.baseUrl;
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout");

    await request(routeApp())
      .post("/api/governance/search/model/for-ifc-ready/ifcready_a4_001")
      .send({ query: "IfcDoor", interpret_mode: "deterministic" });
    expect(timeoutSpy).toHaveBeenLastCalledWith(12_000);

    await request(routeApp())
      .post("/api/governance/search/model/for-ifc-ready/ifcready_a4_001")
      .send({ query: "doors on level two", interpret_mode: "semantic" });
    expect(timeoutSpy).toHaveBeenLastCalledWith(135_000);

    await request(routeApp())
      .post("/api/governance/search/model/for-ifc-ready/ifcready_a4_001")
      .send({ query: "doors on level two" });
    expect(timeoutSpy).toHaveBeenLastCalledWith(135_000);

    await request(routeApp())
      .post("/api/governance/search/model/for-session/review_session_a4test001/partial-confirmation")
      .send({ partial_fallback_id: "a4pf_partial_confirmation_123" });
    expect(timeoutSpy).toHaveBeenLastCalledWith(12_000);

    await request(routeApp({ governanceTimeoutMs: 999_999 }))
      .post("/api/governance/search/model/for-ifc-ready/ifcready_a4_001")
      .send({ query: "doors on level two", interpret_mode: "auto" });
    expect(timeoutSpy).toHaveBeenLastCalledWith(140_000);
  });

  it("keeps an explicit upstream deadline fail-closed and response-safe", async () => {
    const governance = await startGovernanceStub({ delayMs: 100 });
    process.env.GOVERNANCE_API_BASE = governance.baseUrl;

    const response = await request(routeApp({ governanceTimeoutMs: 25 }))
      .post("/api/governance/search/model/for-ifc-ready/ifcready_a4_001")
      .send({ query: "IfcDoor", interpret_mode: "deterministic" });

    expect(response.status).toBe(502);
    expect(response.body).toEqual({
      error_code: "governance_service_unavailable",
      detail: "Governance service is unavailable.",
    });
  });

  it("disables generic browser search in every profile", async () => {
    const governance = await startGovernanceStub();
    process.env.GOVERNANCE_API_BASE = governance.baseUrl;
    const response = await request(routeApp())
      .post("/api/governance/search/model")
      .send({ ifc_source_path: "C:/browser.ifc", query: "IfcDoor" });

    expect(response.status).toBe(404);
    expect(response.body.error_code).toBe("a4_generic_search_disabled");
    expect(governance.calls).toHaveLength(0);
  });

  it("requires loopback transport, rejects redirects, and never leaks server fields", async () => {
    const shortTokenGovernance = await startGovernanceStub();
    process.env.GOVERNANCE_API_BASE = shortTokenGovernance.baseUrl;
    const shortToken = await request(routeApp({ a4InternalContextToken: "too-short" }))
      .post("/api/governance/search/model/for-session/review_session_a4test001")
      .send({ query: "IfcDoor" });
    expect(shortToken.status).toBe(503);
    expect(shortToken.body.error_code).toBe("a4_trusted_context_unavailable");
    expect(shortTokenGovernance.calls).toHaveLength(0);

    process.env.GOVERNANCE_API_BASE = "http://example.invalid";
    const nonLoopback = await request(routeApp())
      .post("/api/governance/search/model/for-session/review_session_a4test001")
      .send({ query: "IfcDoor" });
    expect(nonLoopback.status).toBe(503);
    expect(nonLoopback.body.error_code).toBe("a4_trusted_context_unavailable");

    const destination = await startGovernanceStub();
    const redirect = await startGovernanceStub({ redirectTo: `${destination.baseUrl}/second-hop` });
    process.env.GOVERNANCE_API_BASE = redirect.baseUrl;
    const redirected = await request(routeApp())
      .post("/api/governance/search/model/for-session/review_session_a4test001")
      .send({ query: "IfcDoor" });
    expect(redirected.status).toBe(502);
    expect(redirected.body).toEqual({
      error_code: "governance_service_unavailable",
      detail: "Governance service is unavailable.",
    });
    expect(redirect.calls).toHaveLength(1);
    expect(destination.calls).toHaveLength(0);

    const leaking = await startGovernanceStub({
      status: 400,
      responseBody: { detail: "C:\\server-only\\source.ifc" },
    });
    process.env.GOVERNANCE_API_BASE = leaking.baseUrl;
    const leakResponse = await request(routeApp())
      .post("/api/governance/search/model/for-session/review_session_a4test001")
      .send({ query: "IfcDoor" });
    expect(leakResponse.status).toBe(502);
    expect(JSON.stringify(leakResponse.body)).not.toContain("server-only");

    const credentialLeak = await startGovernanceStub({
      status: 400,
      responseBody: { api_key: "upstream-secret-must-not-cross" },
    });
    process.env.GOVERNANCE_API_BASE = credentialLeak.baseUrl;
    const credentialLeakResponse = await request(routeApp())
      .post("/api/governance/search/model/for-session/review_session_a4test001")
      .send({ query: "IfcDoor" });
    expect(credentialLeakResponse.status).toBe(502);
    expect(JSON.stringify(credentialLeakResponse.body)).not.toContain("upstream-secret");

    const unrelatedPathLeak = await startGovernanceStub({
      status: 400,
      responseBody: { detail: "C:\\other-server-path\\unexpected.ifc" },
    });
    process.env.GOVERNANCE_API_BASE = unrelatedPathLeak.baseUrl;
    const unrelatedPathResponse = await request(routeApp())
      .post("/api/governance/search/model/for-session/review_session_a4test001")
      .send({ query: "IfcDoor" });
    expect(unrelatedPathResponse.status).toBe(502);
    expect(JSON.stringify(unrelatedPathResponse.body)).not.toContain("other-server-path");

    const oversized = await startGovernanceStub({ declaredLength: 2 * 1024 * 1024 + 1 });
    process.env.GOVERNANCE_API_BASE = oversized.baseUrl;
    const oversizedResponse = await request(routeApp())
      .post("/api/governance/search/model/for-session/review_session_a4test001")
      .send({ query: "IfcDoor" });
    expect(oversizedResponse.status).toBe(502);
    expect(oversizedResponse.body.error_code).toBe("governance_service_unavailable");
  });

  it("uses only an explicitly allowlisted host bridge and rejects arbitrary hosts", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      status: "ok",
      results: [],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    process.env.GOVERNANCE_API_BASE = "http://host.docker.internal:49102";
    process.env.A4_TRUSTED_GOVERNANCE_ORIGINS = "http://host.docker.internal:49102";

    const allowed = await request(routeApp())
      .post("/api/governance/search/model/for-session/review_session_a4test001")
      .send({ query: "IfcDoor" });
    expect(allowed.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0][0])).toBe(
      "http://host.docker.internal:49102/api/internal/a4/search/model",
    );

    process.env.GOVERNANCE_API_BASE = "http://governance.attacker.invalid:49102";
    const rejected = await request(routeApp())
      .post("/api/governance/search/model/for-session/review_session_a4test001")
      .send({ query: "IfcDoor" });
    expect(rejected.status).toBe(503);
    expect(rejected.body.error_code).toBe("a4_trusted_context_unavailable");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("keeps IFC-ready compatibility lab-only until tenant-aware user auth exists", async () => {
    const resolveIfcReadyContext = vi.fn<NonNullable<A4SearchRouteDeps["resolveIfcReadyContext"]>>();
    const response = await request(routeApp({
      authenticatePrincipal: () => ({
        ok: true,
        principal: { principal_ref: "production_principal_a4", auth_scope: "production" },
      }),
      resolveIfcReadyContext,
    }))
      .post("/api/governance/search/model/for-ifc-ready/ifcready_a4_001")
      .send({ query: "IfcDoor" });

    expect(response.status).toBe(403);
    expect(response.body.error_code).toBe("a4_ifc_ready_lab_only");
    expect(resolveIfcReadyContext).not.toHaveBeenCalled();
  });
});

describe("createCoordinatorApp A4 search integration", () => {
  it("mounts the scoped A4 search and Issue routers before the generic proxy", async () => {
    const governance = await startGovernanceStub();
    const fixture = seedCoordinatorFixture(governance.baseUrl);

    const generic = await request(fixture.app.app)
      .post("/api/governance/search/model")
      .send({ ifc_source_path: "C:/browser.ifc", query: "IfcDoor" });
    const session = await request(fixture.app.app)
      .post(`/api/governance/search/model/for-session/${fixture.sessionId}`)
      .send({ query: "IfcDoor" });
    const ifcReady = await request(fixture.app.app)
      .post(`/api/governance/search/model/for-ifc-ready/${fixture.ifcReadyJobId}`)
      .send({ query: "IfcDoor" });
    const issue = await request(fixture.app.app)
      .post(`/api/governance/issues/from-a4-search/for-session/${fixture.sessionId}`)
      .send({});

    expect(generic.status).toBe(404);
    expect(generic.body.error_code).toBe("a4_generic_search_disabled");
    expect(session.status).toBe(401);
    expect(session.body.error_code).toBe("a4_authentication_required");
    expect(ifcReady.status).toBe(401);
    expect(ifcReady.body.error_code).toBe("a4_authentication_required");
    expect(issue.status).toBe(401);
    expect(issue.body.error_code).toBe("a4_authentication_required");
    expect(governance.calls).toHaveLength(0);
  });

  it("resolves active session source, mapping, model, stage, and primary principal server-side", async () => {
    const governance = await startGovernanceStub();
    const fixture = seedCoordinatorFixture(governance.baseUrl);
    const owner = "a4-owner";
    const lease = await claimPrimary(fixture.app, fixture.sessionId, owner);

    const stageMissing = await request(fixture.app.app)
      .post(`/api/governance/search/model/for-session/${fixture.sessionId}`)
      .set("X-User-Token", owner)
      .send({ query: "IfcDoor" });
    expect(stageMissing.status).toBe(409);
    expect(stageMissing.body.error_code).toBe("a4_session_stage_unavailable");

    const bindingRevision = await activateStage(
      fixture.app,
      fixture.sessionId,
      fixture.ifcReadyJobId,
      owner,
      lease,
      fixture.artifactId,
    );
    const ready = await request(fixture.app.app)
      .post(`/api/governance/search/model/for-session/${fixture.sessionId}`)
      .set("X-User-Token", owner)
      .set("X-Viewer-Lease-Token", "browser-carrier-is-not-authority")
      .send({ query: "  IfcDoor  ", limit: 9 });
    expect(ready.status).toBe(200);
    expect(governance.calls).toHaveLength(1);
    expect(governance.calls[0].body).toMatchObject({
      ifc_source_path: fixture.sourcePath,
      element_mapping_path: fixture.mappingPath,
      model_version_id: fixture.modelVersionId,
      query: "  IfcDoor  ",
      limit: 9,
      a4_trusted_context: {
        review_session_id: fixture.sessionId,
        primary_artifact_id: fixture.artifactId,
        active_binding_revision: bindingRevision,
        auth_scope: "lab",
        mapping_provenance: "server_resolved",
        primary_lease_capability: "lab_unverified",
      },
    });
    expect(JSON.stringify(ready.body)).not.toContain(fixture.sourcePath);
    expect(JSON.stringify(ready.body)).not.toContain(fixture.mappingPath);

    const issueMutation = await request(fixture.app.app)
      .post(`/api/governance/issues/from-a4-search/for-session/${fixture.sessionId}`)
      .set("X-User-Token", owner)
      .send({});
    expect(issueMutation.status).toBe(503);
    expect(issueMutation.body.error_code).toBe("a4_issue_authority_unavailable");
    expect(governance.calls).toHaveLength(1);

    const stolenLease = await request(fixture.app.app)
      .post(`/api/governance/search/model/for-session/${fixture.sessionId}`)
      .set("X-User-Token", "different-user")
      .set("X-Viewer-Lease-Token", lease.lease_token)
      .send({ query: "IfcDoor" });
    expect(stolenLease.status).toBe(403);
    expect(stolenLease.body.error_code).toBe("a4_primary_lease_required");
    expect(governance.calls).toHaveLength(1);

    fs.rmSync(fixture.mappingPath);
    const mappingMissing = await request(fixture.app.app)
      .post(`/api/governance/search/model/for-session/${fixture.sessionId}`)
      .set("X-User-Token", owner)
      .send({ query: "IfcDoor" });
    expect(mappingMissing.status).toBe(409);
    expect(mappingMissing.body.error_code).toBe("a4_session_mapping_unavailable");
    fs.writeFileSync(fixture.mappingPath, "{}", "utf8");

    fixture.sessions.update(fixture.sessionId, { model_version_id: "version_mismatch" });
    const modelMismatch = await request(fixture.app.app)
      .post(`/api/governance/search/model/for-session/${fixture.sessionId}`)
      .set("X-User-Token", owner)
      .send({ query: "IfcDoor" });
    expect(modelMismatch.status).toBe(409);
    expect(modelMismatch.body.error_code).toBe("a4_session_model_unavailable");
    fixture.sessions.update(fixture.sessionId, { model_version_id: fixture.modelVersionId });

    fs.rmSync(fixture.sourcePath);
    const sourceMissing = await request(fixture.app.app)
      .post(`/api/governance/search/model/for-session/${fixture.sessionId}`)
      .set("X-User-Token", owner)
      .send({ query: "IfcDoor" });
    expect(sourceMissing.status).toBe(409);
    expect(sourceMissing.body.error_code).toBe("a4_session_source_unavailable");
    fs.writeFileSync(fixture.sourcePath, "ISO-10303-21;END-ISO-10303-21;", "utf8");

    fixture.sessions.setStatus(fixture.sessionId, "closed");
    const closed = await request(fixture.app.app)
      .post(`/api/governance/search/model/for-session/${fixture.sessionId}`)
      .set("X-User-Token", owner)
      .send({ query: "IfcDoor" });
    expect(closed.status).toBe(409);
    expect(closed.body.error_code).toBe("a4_session_inactive");
  });

  it("binds search to the exact active stage primary instead of the default session artifact", async () => {
    const governance = await startGovernanceStub();
    const fixture = seedCoordinatorFixture(governance.baseUrl);
    const owner = "a4-owner-two-artifacts";
    const lease = await claimPrimary(fixture.app, fixture.sessionId, owner);
    const session = fixture.sessions.get(fixture.sessionId);
    expect(session).not.toBeNull();
    if (!session) throw new Error("fixture session missing");
    const activeArtifactId = "artifact_a4_selected_second";
    fixture.sessions.update(fixture.sessionId, {
      artifact_bindings: [
        ...session.artifact_bindings,
        {
          ...session.artifact_bindings[0],
          binding_id: "binding_a4_selected_second",
          artifact_id: activeArtifactId,
          load_order: 1,
        },
      ],
    });

    const bindingRevision = await activateStage(
      fixture.app,
      fixture.sessionId,
      fixture.ifcReadyJobId,
      owner,
      lease,
      activeArtifactId,
    );
    const response = await request(fixture.app.app)
      .post(`/api/governance/search/model/for-session/${fixture.sessionId}`)
      .set("X-User-Token", owner)
      .send({ query: "IfcDoor" });

    expect(response.status).toBe(200);
    expect(governance.calls).toHaveLength(1);
    expect(governance.calls[0].body).toMatchObject({
      a4_trusted_context: {
        primary_artifact_id: activeArtifactId,
        active_binding_revision: bindingRevision,
      },
    });
  });

  it("rejects a stage binding when its confirmed primary lease has turned over", async () => {
    const governance = await startGovernanceStub();
    const fixture = seedCoordinatorFixture(governance.baseUrl);
    const owner = "a4-owner-lease-turnover";
    const firstLease = await claimPrimary(fixture.app, fixture.sessionId, owner);
    await activateStage(
      fixture.app,
      fixture.sessionId,
      fixture.ifcReadyJobId,
      owner,
      firstLease,
      fixture.artifactId,
    );
    await releaseLease(fixture.app, fixture.sessionId, firstLease);

    const replacementLease = await claimPrimary(
      fixture.app,
      fixture.sessionId,
      owner,
      `${fixture.sessionId}:${owner}:replacement`,
    );
    expect(replacementLease.lease_id).not.toBe(firstLease.lease_id);

    const response = await request(fixture.app.app)
      .post(`/api/governance/search/model/for-session/${fixture.sessionId}`)
      .set("X-User-Token", owner)
      .send({ query: "IfcDoor" });

    expect(response.status).toBe(409);
    expect(response.body.error_code).toBe("a4_session_stage_unavailable");
    expect(governance.calls).toHaveLength(0);
  });

  it("verifies the container-visible mapping but forwards the host-native mapping path", async () => {
    const governance = await startGovernanceStub();
    const hostArtifactsRoot = "D:\\AI-BIM-runtime-data\\artifacts";
    const fixture = seedCoordinatorFixture(governance.baseUrl, { hostArtifactsRoot });
    const owner = "a4-owner-dual-namespace";
    const lease = await claimPrimary(fixture.app, fixture.sessionId, owner);
    await activateStage(
      fixture.app,
      fixture.sessionId,
      fixture.ifcReadyJobId,
      owner,
      lease,
      fixture.artifactId,
    );

    const response = await request(fixture.app.app)
      .post(`/api/governance/search/model/for-session/${fixture.sessionId}`)
      .set("X-User-Token", owner)
      .send({ query: "IfcDoor" });

    const hostMappingPath = path.win32.join(
      hostArtifactsRoot,
      "stream_conv_a4_001",
      "element_mapping.json",
    );
    expect(response.status).toBe(200);
    expect(governance.calls).toHaveLength(1);
    expect(governance.calls[0].body.element_mapping_path).toBe(hostMappingPath);
    expect(governance.calls[0].body.element_mapping_path).not.toBe(fixture.mappingPath);
  });

  it("returns actionable missing-session errors without leaking identifiers or paths", async () => {
    const governance = await startGovernanceStub();
    const fixture = seedCoordinatorFixture(governance.baseUrl);
    const response = await request(fixture.app.app)
      .post("/api/governance/search/model/for-session/review_session_missing001")
      .set("X-User-Token", "a4-owner")
      .send({ query: "IfcDoor" });

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      error_code: "a4_session_not_found",
      detail: "A4 review session was not found.",
    });
    expect(JSON.stringify(response.body)).not.toContain("review_session_missing001");
    expect(governance.calls).toHaveLength(0);
  });

  it("fails closed when production is still using pending local-dev identity", async () => {
    process.env.NODE_ENV = "production";
    const governance = await startGovernanceStub();
    const fixture = seedCoordinatorFixture(governance.baseUrl);
    const response = await request(fixture.app.app)
      .post(`/api/governance/search/model/for-session/${fixture.sessionId}`)
      .set("X-User-Token", "local-dev-is-not-production-authority")
      .send({ query: "IfcDoor" });

    expect(response.status).toBe(503);
    expect(response.body).toEqual({
      error_code: "a4_production_identity_unavailable",
      detail: "Production A4 identity is unavailable.",
    });
    expect(governance.calls).toHaveLength(0);
  });

  it("keeps the real IFC-ready route table-only and strips browser mapping authority", async () => {
    const governance = await startGovernanceStub();
    const fixture = seedCoordinatorFixture(governance.baseUrl);

    const tableOnly = await request(fixture.app.app)
      .post(`/api/governance/search/model/for-ifc-ready/${fixture.ifcReadyJobId}`)
      .set("X-User-Token", "a4-owner")
      .send({ query: "IfcDoor" });
    expect(tableOnly.status).toBe(200);
    expect(governance.calls[0].body).toEqual({
      ifc_source_path: fixture.sourcePath,
      model_version_id: fixture.modelVersionId,
      query: "IfcDoor",
      a4_trusted_context: { scope: "ifc_ready_table_only" },
    });

    const browserMapping = await request(fixture.app.app)
      .post(`/api/governance/search/model/for-ifc-ready/${fixture.ifcReadyJobId}`)
      .set("X-User-Token", "a4-owner")
      .send({ query: "IfcDoor", element_mapping_path: fixture.mappingPath });
    expect(browserMapping.status).toBe(400);
    expect(governance.calls).toHaveLength(1);
  });
});
