import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createCoordinatorApp, type CoordinatorApp } from "../src/app.js";
import { createLogger } from "../src/lib/structLog.js";

let active: CoordinatorApp | null = null;
let activeRoot: string | null = null;

afterEach(async () => {
  vi.restoreAllMocks();
  if (active) {
    active.io.close();
    await new Promise<void>((resolve) => active?.server.close(() => resolve()));
    await active.dispose();
    active = null;
  }
  if (activeRoot) {
    fs.rmSync(activeRoot, { recursive: true, force: true });
    activeRoot = null;
  }
});

function makeApp(): CoordinatorApp {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "runtime-command-authority-"));
  activeRoot = root;
  const config = {
    sessionStoreDir: path.join(root, "sessions"),
    eventLogDir: path.join(root, "events"),
    callbackOutboxStorePath: path.join(root, "callback-outbox.json"),
    conversionLedgerStorePath: path.join(root, "conversion-ledger.json"),
    artifactHealthLedgerStorePath: path.join(root, "artifact-health-ledger.json"),
    logRoot: path.join(root, "logs"),
    conversionPollEnabled: false,
    internalApiAuthToken: "test-internal-token",
    corsOrigins: ["http://127.0.0.1:5173"],
    kitInstanceEndpoints: [{
      id: "kit_authority_001",
      signalingServer: "127.0.0.1",
      signalingPort: 49100,
      mediaServer: "127.0.0.1",
      mediaPort: 47998,
    }],
  };
  active = createCoordinatorApp(config, {
    structLog: createLogger("coordinator", {
      logRoot: config.logRoot,
      runId: "run_20260721_runtime_authority",
      skipEnvSnapshot: true,
    }),
  });
  return active;
}

async function createSession(app: CoordinatorApp, suffix = "a"): Promise<string> {
  const response = await request(app.app)
    .post("/api/review-sessions")
    .send({
      project_id: `project_authority_${suffix}`,
      model_version_id: `version_authority_${suffix}`,
      created_by: "authority_fixture",
      artifact_bindings: [
        {
          artifact_group_id: `group_${suffix}`,
          artifact_id: `artifact_primary_${suffix}`,
          artifact_role: "derived",
          url: `http://127.0.0.1:49101/artifacts/primary-${suffix}/model.usdc`,
          mapping_url: null,
          load_order: 0,
          ready_status: "ready",
        },
        {
          artifact_group_id: `group_${suffix}`,
          artifact_id: `artifact_secondary_${suffix}`,
          artifact_role: "overlay",
          url: `http://127.0.0.1:49101/artifacts/secondary-${suffix}/model.usdc`,
          mapping_url: null,
          load_order: 1,
          ready_status: "ready",
        },
      ],
    });
  expect(response.status).toBe(200);
  return response.body.session_id as string;
}

async function claim(
  app: CoordinatorApp,
  sessionId: string,
  user: string,
  role: "primary" | "spectator" = "primary",
) {
  const response = await request(app.app)
    .post(`/api/review-sessions/${sessionId}/viewer-leases/claim`)
    .set("X-User-Token", user)
    .send({
      viewer_id: `${role}_${user}`,
      requested_role: role,
      client_nonce: `${sessionId}:${role}:${user}`,
    });
  expect(response.status).toBe(200);
  return {
    ...response.body,
    session_id: sessionId,
  } as {
    lease_id: string;
    lease_token: string;
    user_id: string;
    session_id: string;
  };
}

function internalHeaders(sessionId?: string) {
  return {
    "X-Internal-Token": "test-internal-token",
    ...(sessionId ? { "X-Trace-Id": sessionTrace(sessionId) } : {}),
  };
}

function sessionTrace(sessionId: string): string {
  return `rev_${sessionId}`;
}

function stageSelection(suffix = "a") {
  return [
    { artifact_id: `artifact_primary_${suffix}`, role: "primary", load_order: 0 },
    { artifact_id: `artifact_secondary_${suffix}`, role: "secondary", load_order: 1 },
  ];
}

async function preauthorize(
  app: CoordinatorApp,
  sessionId: string,
  lease: { lease_id: string; lease_token: string },
  user: string,
  suffix = "a",
) {
  return request(app.app)
    .post(`/api/review-sessions/${sessionId}/stage-binding`)
    .set("X-User-Token", user)
    .set("X-Viewer-Lease-Token", lease.lease_token)
    .send({
      source_client_id: lease.lease_id,
      role: "primary",
      artifacts: stageSelection(suffix),
    });
}

function runtimeBody(
  lease: { lease_id: string; session_id?: string },
  overrides: Record<string, unknown> = {},
  traceId?: string,
) {
  const effectiveTraceId = traceId ?? (lease.session_id ? sessionTrace(lease.session_id) : undefined);
  return {
    ...(effectiveTraceId ? { trace_id: effectiveTraceId } : {}),
    source_client_id: lease.lease_id,
    requested_event_type: "highlightPrimsRequest",
    request_id: "cmd_highlight_001",
    command_context: {
      mode: "replace",
      items: [{ prim_path: "/World/Wall_001" }],
      focus_first: true,
    },
    ...overrides,
  };
}

describe("coordinator runtime command authority", () => {
  it("requires internal auth while mapping normal business allow/deny to HTTP 200", async () => {
    const app = makeApp();
    const sessionId = await createSession(app);
    const lease = await claim(app, sessionId, "authority-user");
    const traceId = sessionTrace(sessionId);

    const missingInternal = await request(app.app)
      .post(`/api/internal/review-sessions/${sessionId}/runtime-command-authorizations`)
      .set("X-Trace-Id", traceId)
      .set("X-Viewer-Lease-Token", lease.lease_token)
      .send(runtimeBody(lease, {}, traceId));
    expect(missingInternal.status).toBe(401);

    const allowed = await request(app.app)
      .post(`/api/internal/review-sessions/${sessionId}/runtime-command-authorizations`)
      .set(internalHeaders())
      .set("X-Trace-Id", traceId)
      .set("X-Viewer-Lease-Token", lease.lease_token)
      .send(runtimeBody(lease, {}, traceId));
    expect(allowed.status).toBe(200);
    expect(allowed.body).toEqual({
      authorized: true,
      request_id: "cmd_highlight_001",
      retryable: false,
      trace_id: traceId,
    });
    expect(allowed.headers["x-trace-id"]).toBe(traceId);

    const forged = await request(app.app)
      .post(`/api/internal/review-sessions/${sessionId}/runtime-command-authorizations`)
      .set(internalHeaders())
      .set("X-Trace-Id", traceId)
      .set("X-Viewer-Lease-Token", "forged-viewer-lease-token")
      .send(runtimeBody(lease, { request_id: "cmd_forged_001" }, traceId));
    expect(forged.status).toBe(200);
    expect(forged.body).toMatchObject({
      authorized: false,
      reason: "lease_invalid",
      request_id: "cmd_forged_001",
      retryable: false,
      trace_id: traceId,
    });
    expect(forged.headers["x-trace-id"]).toBe(traceId);
  });

  it("verifies an exact read-only DataChannel session/trace pair without exposing authority on failure", async () => {
    const app = makeApp();
    const sessionId = await createSession(app, "readonly-trace");
    const traceId = sessionTrace(sessionId);
    const route = `/api/internal/review-sessions/${sessionId}/datachannel-trace-verifications`;

    const exact = await request(app.app)
      .post(route)
      .set(internalHeaders())
      .set("X-Trace-Id", traceId)
      .send({ trace_id: traceId });
    expect(exact.status).toBe(200);
    expect(exact.body).toEqual({
      verified: true,
      session_id: sessionId,
      trace_id: traceId,
    });
    expect(exact.headers["x-trace-id"]).toBe(traceId);

    for (const [label, headerTrace, body] of [
      ["missing header", undefined, { trace_id: traceId }],
      ["missing body", traceId, {}],
      ["header/body mismatch", traceId.toUpperCase(), { trace_id: traceId }],
      ["canonical mismatch", `${traceId}_other`, { trace_id: `${traceId}_other` }],
    ] as const) {
      let pending = request(app.app).post(route).set(internalHeaders());
      if (headerTrace) pending = pending.set("X-Trace-Id", headerTrace);
      const denied = await pending.send(body);
      expect(denied.status, label).toBe(200);
      expect(denied.body, label).toMatchObject({ verified: false });
      expect(denied.body.trace_id, label).toBeUndefined();
      expect(denied.headers["x-trace-id"], label).toBeUndefined();
    }
  });

  it("classifies spectator, wrong-source, blocked lifecycle, unsupported and malformed attempts", async () => {
    const app = makeApp();
    const sessionId = await createSession(app);
    const primary = await claim(app, sessionId, "primary-user");
    const spectator = await claim(app, sessionId, "spectator-user", "spectator");

    const spectatorDecision = await request(app.app)
      .post(`/api/internal/review-sessions/${sessionId}/runtime-command-authorizations`)
      .set(internalHeaders(sessionId))
      .set("X-Viewer-Lease-Token", spectator.lease_token)
      .send(runtimeBody(spectator, { request_id: "cmd_spectator_001" }));
    expect(spectatorDecision.body).toMatchObject({ authorized: false, reason: "spectator_readonly" });

    const wrongSource = await request(app.app)
      .post(`/api/internal/review-sessions/${sessionId}/runtime-command-authorizations`)
      .set(internalHeaders(sessionId))
      .set("X-Viewer-Lease-Token", primary.lease_token)
      .send(runtimeBody(
        { lease_id: "viewer_lease_wrong_source" },
        { request_id: "cmd_wrong_source_001" },
        sessionTrace(sessionId),
      ));
    expect(wrongSource.body).toMatchObject({ authorized: false, reason: "unauthorized_source_client" });

    const unsupported = await request(app.app)
      .post(`/api/internal/review-sessions/${sessionId}/runtime-command-authorizations`)
      .set(internalHeaders(sessionId))
      .set("X-Viewer-Lease-Token", primary.lease_token)
      .send(runtimeBody(primary, { requested_event_type: "composeStageRequest", request_id: "cmd_compose_001" }));
    expect(unsupported.body).toMatchObject({ authorized: false, reason: "unsupported_command" });

    const malformed = await request(app.app)
      .post(`/api/internal/review-sessions/${sessionId}/runtime-command-authorizations`)
      .set(internalHeaders(sessionId))
      .set("X-Viewer-Lease-Token", primary.lease_token)
      .send({
        trace_id: sessionTrace(sessionId),
        source_client_id: primary.lease_id,
        requested_event_type: "highlightPrimsRequest",
      });
    expect(malformed.status).toBe(200);
    expect(malformed.body).toMatchObject({ authorized: false, reason: "invalid_payload" });
    expect(malformed.body.rejection_id).toMatch(/^rejection_/);

    await request(app.app).post(`/api/review-sessions/${sessionId}/close`).send({});
    const blocked = await request(app.app)
      .post(`/api/internal/review-sessions/${sessionId}/runtime-command-authorizations`)
      .set(internalHeaders(sessionId))
      .set("X-Viewer-Lease-Token", primary.lease_token)
      .send(runtimeBody(primary, { request_id: "cmd_blocked_001" }));
    expect(blocked.body).toMatchObject({ authorized: false, reason: "session_lifecycle_blocked" });
  });

  it("classifies released, expired, and cross-session leases without changing HTTP status", async () => {
    const app = makeApp();
    const firstSessionId = await createSession(app, "lease-matrix-a");
    const secondSessionId = await createSession(app, "lease-matrix-b");
    const thirdSessionId = await createSession(app, "lease-matrix-c");
    const firstLease = await claim(app, firstSessionId, "lease-matrix-owner-a");
    const expiringLease = await claim(app, thirdSessionId, "lease-matrix-owner-c");

    const crossSession = await request(app.app)
      .post(`/api/internal/review-sessions/${secondSessionId}/runtime-command-authorizations`)
      .set(internalHeaders(secondSessionId))
      .set("X-Viewer-Lease-Token", firstLease.lease_token)
      .send(runtimeBody(
        firstLease,
        { request_id: "cmd_cross_session_001" },
        sessionTrace(secondSessionId),
      ));
    expect(crossSession.status).toBe(200);
    expect(crossSession.body).toMatchObject({
      authorized: false,
      reason: "unauthorized_source_client",
      request_id: "cmd_cross_session_001",
      retryable: false,
      detail_code: "cross_session_lease",
    });

    await request(app.app)
      .post(`/api/review-sessions/${firstSessionId}/viewer-leases/${firstLease.lease_id}/release`)
      .set("X-Viewer-Lease-Token", firstLease.lease_token)
      .send({ reason: "runtime authority matrix" })
      .expect(200);
    const released = await request(app.app)
      .post(`/api/internal/review-sessions/${firstSessionId}/runtime-command-authorizations`)
      .set(internalHeaders(firstSessionId))
      .set("X-Viewer-Lease-Token", firstLease.lease_token)
      .send(runtimeBody(firstLease, { request_id: "cmd_released_001" }));
    expect(released.status).toBe(200);
    expect(released.body).toMatchObject({
      authorized: false,
      reason: "lease_invalid",
      request_id: "cmd_released_001",
      retryable: false,
      detail_code: "lease_released",
    });

    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 60_000);
    const expired = await request(app.app)
      .post(`/api/internal/review-sessions/${thirdSessionId}/runtime-command-authorizations`)
      .set(internalHeaders(thirdSessionId))
      .set("X-Viewer-Lease-Token", expiringLease.lease_token)
      .send(runtimeBody(expiringLease, { request_id: "cmd_expired_001" }));
    expect(expired.status).toBe(200);
    expect(expired.body).toMatchObject({
      authorized: false,
      reason: "lease_invalid",
      request_id: "cmd_expired_001",
      retryable: false,
      detail_code: "lease_expired",
    });
  });

  it("validates event-specific command context before authorizing a mutator", async () => {
    const app = makeApp();
    const sessionId = await createSession(app);
    const lease = await claim(app, sessionId, "context-owner");
    const cases = [
      [
        "highlightPrimsRequest",
        { mode: "replace", items: [{ prim_path: "/World/Wall_001", ifc_guid: "ifc-wall-001" }], focus_first: true },
        { mode: "replace", items: [{ prim_path: "not-an-absolute-prim-path" }], focus_first: true },
      ],
      ["focusPrimRequest", { prim_path: "/World/Wall_001" }, {}],
      ["clearHighlightRequest", {}, { unexpected: true }],
      ["selectPrimsRequest", { paths: [] }, { paths: ["not-an-absolute-prim-path"] }],
      ["makePrimsPickable", { paths: ["/World/Wall_001"] }, { paths: "not-an-array" }],
      ["resetStage", {}, { unexpected: true }],
    ] as const;

    for (const [index, [eventType, validContext, invalidContext]] of cases.entries()) {
      const valid = await request(app.app)
        .post(`/api/internal/review-sessions/${sessionId}/runtime-command-authorizations`)
        .set(internalHeaders(sessionId))
        .set("X-Viewer-Lease-Token", lease.lease_token)
        .send(runtimeBody(lease, {
          requested_event_type: eventType,
          request_id: `cmd_context_valid_${index}`,
          command_context: validContext,
        }));
      expect(valid.body).toMatchObject({ authorized: true, request_id: `cmd_context_valid_${index}` });

      const invalid = await request(app.app)
        .post(`/api/internal/review-sessions/${sessionId}/runtime-command-authorizations`)
        .set(internalHeaders(sessionId))
        .set("X-Viewer-Lease-Token", lease.lease_token)
        .send(runtimeBody(lease, {
          requested_event_type: eventType,
          request_id: `cmd_context_invalid_${index}`,
          command_context: invalidContext,
        }));
      expect(invalid.body).toMatchObject({
        authorized: false,
        reason: "invalid_payload",
        request_id: `cmd_context_invalid_${index}`,
        detail_code: "runtime_command_context_invalid",
      });
    }
  });

  it("uses canonical snake-case prim paths regardless of alias insertion order", async () => {
    const app = makeApp();
    const sessionId = await createSession(app);
    const lease = await claim(app, sessionId, "alias-collision-owner");
    const cases = [
      {
        name: "canonical-invalid-first",
        item: { prim_path: "not-an-absolute-prim-path", primPath: "/World/Alias" },
        authorized: false,
      },
      {
        name: "canonical-invalid-last",
        item: { primPath: "/World/Alias", prim_path: "not-an-absolute-prim-path" },
        authorized: false,
      },
      {
        name: "canonical-valid-first",
        item: { prim_path: "/World/Canonical", primPath: "not-an-absolute-prim-path" },
        authorized: true,
      },
      {
        name: "canonical-valid-last",
        item: { primPath: "not-an-absolute-prim-path", prim_path: "/World/Canonical" },
        authorized: true,
      },
    ] as const;

    for (const collision of cases) {
      const response = await request(app.app)
        .post(`/api/internal/review-sessions/${sessionId}/runtime-command-authorizations`)
        .set(internalHeaders(sessionId))
        .set("X-Viewer-Lease-Token", lease.lease_token)
        .send(runtimeBody(lease, {
          request_id: `cmd_${collision.name}`,
          command_context: {
            mode: "replace",
            items: [collision.item],
            focus_first: true,
          },
        }));
      expect(response.body).toMatchObject(collision.authorized
        ? { authorized: true, request_id: `cmd_${collision.name}` }
        : {
            authorized: false,
            reason: "invalid_payload",
            request_id: `cmd_${collision.name}`,
            detail_code: "runtime_command_context_invalid",
          });
    }
  });

  it("rejects top-level camel-case aliases that the frozen wire contract does not allow", async () => {
    const app = makeApp();
    const sessionId = await createSession(app);
    const lease = await claim(app, sessionId, "top-level-alias-owner");
    const cases = [
      {
        name: "focus-canonical-first",
        eventType: "focusPrimRequest",
        commandContext: { prim_path: "/World/Canonical", primPath: "/World/Alias" },
      },
      {
        name: "focus-alias-first",
        eventType: "focusPrimRequest",
        commandContext: { primPath: "/World/Alias", prim_path: "/World/Canonical" },
      },
      {
        name: "highlight-canonical-first",
        eventType: "highlightPrimsRequest",
        commandContext: {
          mode: "replace",
          items: [{ prim_path: "/World/Canonical" }],
          focus_first: true,
          focusFirst: false,
        },
      },
      {
        name: "highlight-alias-first",
        eventType: "highlightPrimsRequest",
        commandContext: {
          mode: "replace",
          items: [{ prim_path: "/World/Canonical" }],
          focusFirst: false,
          focus_first: true,
        },
      },
    ] as const;

    for (const collision of cases) {
      const response = await request(app.app)
        .post(`/api/internal/review-sessions/${sessionId}/runtime-command-authorizations`)
        .set(internalHeaders(sessionId))
        .set("X-Viewer-Lease-Token", lease.lease_token)
        .send(runtimeBody(lease, {
          requested_event_type: collision.eventType,
          request_id: `cmd_${collision.name}`,
          command_context: collision.commandContext,
        }));
      expect(response.body).toMatchObject({
        authorized: false,
        reason: "invalid_payload",
        request_id: `cmd_${collision.name}`,
        detail_code: "runtime_command_context_invalid",
      });
    }
  });

  it("creates a server-resolved pending stage transaction without applying it", async () => {
    const app = makeApp();
    const sessionId = await createSession(app);
    const lease = await claim(app, sessionId, "stage-owner");

    const pending = await preauthorize(app, sessionId, lease, "stage-owner");
    expect(pending.status).toBe(200);
    expect(pending.body).toMatchObject({ status: "pending", session_id: sessionId });
    expect(pending.body.stage_binding_authorization_id).toMatch(/^stage_auth_/);
    expect(pending.body.binding_revision_id).toMatch(/^binding_rev_/);
    expect(pending.body.stage_composition.primary).toEqual({
      artifact_id: "artifact_primary_a",
      role: "primary",
      load_order: 0,
      usdc_url: "http://127.0.0.1:49101/artifacts/primary-a/model.usdc",
    });
    expect(app.eventLog.list(sessionId).filter((event) => event.type === "stageBindingApplied")).toHaveLength(0);

    const status = await request(app.app)
      .get(`/api/review-sessions/${sessionId}/viewer-leases/status`)
      .set("X-User-Token", "stage-owner");
    expect(status.body.stage_binding).toMatchObject({
      transaction_status: "pending",
      binding_revision_id: pending.body.binding_revision_id,
      active_binding_revision: null,
    });
  });

  it("rejects browser-supplied stage URL or revision authority", async () => {
    const app = makeApp();
    const sessionId = await createSession(app);
    const lease = await claim(app, sessionId, "stage-owner");

    const response = await request(app.app)
      .post(`/api/review-sessions/${sessionId}/stage-binding`)
      .set("X-User-Token", "stage-owner")
      .set("X-Viewer-Lease-Token", lease.lease_token)
      .send({
        source_client_id: lease.lease_id,
        role: "primary",
        binding_revision_id: "browser_revision_forbidden",
        artifacts: [{
          ...stageSelection()[0],
          usdc_url: "http://attacker.invalid/model.usdc",
        }],
      });
    expect(response.status).toBe(400);
    expect(app.eventLog.list(sessionId).filter((event) => event.type === "stageBindingApplied")).toHaveLength(0);
  });

  it("keeps stage-binding session preflight ahead of malformed body parsing", async () => {
    const app = makeApp();
    const missing = await request(app.app)
      .post("/api/review-sessions/review_session_missing/stage-binding")
      .set("X-User-Token", "precedence-owner")
      .send({ malformed: true });
    expect(missing.status).toBe(404);
    expect(missing.body).toEqual({ detail: "Review session not found." });

    const sessionId = await createSession(app, "precedence");
    await request(app.app).post(`/api/review-sessions/${sessionId}/close`).send({});
    const immutable = await request(app.app)
      .post(`/api/review-sessions/${sessionId}/stage-binding`)
      .set("X-User-Token", "precedence-owner")
      .send({ malformed: true });
    expect(immutable.status).toBe(409);
    expect(immutable.body).toEqual({ detail: "Review session is not active." });
  });

  it("checks caller lease authority before disclosing artifact existence or readiness", async () => {
    const app = makeApp();
    const sessionId = await createSession(app);

    const response = await request(app.app)
      .post(`/api/review-sessions/${sessionId}/stage-binding`)
      .set("X-User-Token", "artifact-prober")
      .set("X-Viewer-Lease-Token", "forged-viewer-lease-token")
      .send({
        source_client_id: "viewer_lease_unknown",
        role: "primary",
        artifacts: [{ artifact_id: "secret-artifact-probe", role: "primary", load_order: 0 }],
      });

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ detail: "stage binding requires caller's active primary viewer lease" });
  });

  it("atomically consumes exact stage authority once and only applies after confirmed success", async () => {
    const app = makeApp();
    const sessionId = await createSession(app);
    const lease = await claim(app, sessionId, "stage-owner");
    const pending = await preauthorize(app, sessionId, lease, "stage-owner");
    expect(pending.status).toBe(200);
    const stageFields = {
      stage_binding_authorization_id: pending.body.stage_binding_authorization_id,
      binding_revision_id: pending.body.binding_revision_id,
      stage_composition: pending.body.stage_composition,
    };

    const authorization = await request(app.app)
      .post(`/api/internal/review-sessions/${sessionId}/runtime-command-authorizations`)
      .set(internalHeaders(sessionId))
      .set("X-Viewer-Lease-Token", lease.lease_token)
      .send(runtimeBody(lease, {
        requested_event_type: "openStageRequest",
        request_id: "cmd_stage_001",
        command_context: {},
        ...stageFields,
      }));
    expect(authorization.body).toEqual({
      authorized: true,
      request_id: "cmd_stage_001",
      retryable: false,
      trace_id: sessionTrace(sessionId),
    });
    expect(app.eventLog.list(sessionId).filter((event) => event.type === "stageBindingApplied")).toHaveLength(0);

    const replay = await request(app.app)
      .post(`/api/internal/review-sessions/${sessionId}/runtime-command-authorizations`)
      .set(internalHeaders(sessionId))
      .set("X-Viewer-Lease-Token", lease.lease_token)
      .send(runtimeBody(lease, {
        requested_event_type: "openStageRequest",
        request_id: "cmd_stage_001",
        command_context: {},
        ...stageFields,
      }));
    expect(replay.body).toMatchObject({ authorized: false, retryable: false });

    const confirmationBody = {
      trace_id: sessionTrace(sessionId),
      stage_binding_authorization_id: pending.body.stage_binding_authorization_id,
      binding_revision_id: pending.body.binding_revision_id,
      request_id: "cmd_stage_001",
      outcome: "success",
    };
    const confirmation = await request(app.app)
      .post(`/api/internal/review-sessions/${sessionId}/stage-binding-confirmations`)
      .set(internalHeaders(sessionId))
      .set("X-Viewer-Lease-Token", lease.lease_token)
      .send(confirmationBody);
    expect(confirmation.body).toMatchObject({
      confirmed: true,
      transaction_status: "active",
      active_binding_revision: pending.body.binding_revision_id,
      idempotent_replay: false,
    });
    expect(app.eventLog.list(sessionId).filter((event) => event.type === "stageBindingApplied")).toHaveLength(1);

    const duplicate = await request(app.app)
      .post(`/api/internal/review-sessions/${sessionId}/stage-binding-confirmations`)
      .set(internalHeaders(sessionId))
      .set("X-Viewer-Lease-Token", lease.lease_token)
      .send(confirmationBody);
    expect(duplicate.body).toMatchObject({ confirmed: true, idempotent_replay: true });
    expect(app.eventLog.list(sessionId).filter((event) => event.type === "stageBindingApplied")).toHaveLength(1);
  });

  it("trace mismatch cannot consume or confirm a pending stage transaction", async () => {
    const app = makeApp();
    const sessionId = await createSession(app, "trace-zero-side-effect");
    const traceId = sessionTrace(sessionId);
    const lease = await claim(app, sessionId, "trace-zero-side-effect-owner");
    const pending = await preauthorize(
      app,
      sessionId,
      lease,
      "trace-zero-side-effect-owner",
      "trace-zero-side-effect",
    );
    expect(pending.status).toBe(200);
    const attempt = runtimeBody(lease, {
      requested_event_type: "openStageRequest",
      request_id: "cmd_trace_zero_side_effect",
      command_context: {},
      stage_binding_authorization_id: pending.body.stage_binding_authorization_id,
      binding_revision_id: pending.body.binding_revision_id,
      stage_composition: pending.body.stage_composition,
    });

    const mismatchedAuthorization = await request(app.app)
      .post(`/api/internal/review-sessions/${sessionId}/runtime-command-authorizations`)
      .set(internalHeaders())
      .set("X-Trace-Id", traceId.toUpperCase())
      .set("X-Viewer-Lease-Token", lease.lease_token)
      .send(attempt);
    expect(mismatchedAuthorization.body).toEqual({
      authorized: false,
      reason: "invalid_payload",
      request_id: "cmd_trace_zero_side_effect",
      retryable: false,
      detail_code: "runtime_trace_mismatch",
    });
    expect(mismatchedAuthorization.headers["x-trace-id"]).toBeUndefined();

    const exactAuthorization = await request(app.app)
      .post(`/api/internal/review-sessions/${sessionId}/runtime-command-authorizations`)
      .set(internalHeaders(sessionId))
      .set("X-Viewer-Lease-Token", lease.lease_token)
      .send(attempt);
    expect(exactAuthorization.body).toEqual({
      authorized: true,
      request_id: "cmd_trace_zero_side_effect",
      retryable: false,
      trace_id: traceId,
    });

    const confirmationBody = {
      trace_id: traceId,
      stage_binding_authorization_id: pending.body.stage_binding_authorization_id,
      binding_revision_id: pending.body.binding_revision_id,
      request_id: "cmd_trace_zero_side_effect",
      outcome: "success",
    };
    const mismatchedConfirmation = await request(app.app)
      .post(`/api/internal/review-sessions/${sessionId}/stage-binding-confirmations`)
      .set(internalHeaders())
      .set("X-Trace-Id", traceId.toUpperCase())
      .set("X-Viewer-Lease-Token", lease.lease_token)
      .send(confirmationBody);
    expect(mismatchedConfirmation.body).toEqual({
      confirmed: false,
      reason: "invalid_payload",
      request_id: "cmd_trace_zero_side_effect",
      retryable: false,
      detail_code: "stage_confirmation_trace_authority_unavailable",
    });
    expect(mismatchedConfirmation.headers["x-trace-id"]).toBeUndefined();

    const statusAfterMismatch = await request(app.app)
      .get(`/api/review-sessions/${sessionId}/viewer-leases/status`)
      .set("X-User-Token", "trace-zero-side-effect-owner");
    expect(statusAfterMismatch.body.stage_binding).toMatchObject({
      transaction_status: "executing",
      active_binding_revision: null,
    });

    const exactConfirmation = await request(app.app)
      .post(`/api/internal/review-sessions/${sessionId}/stage-binding-confirmations`)
      .set(internalHeaders(sessionId))
      .set("X-Viewer-Lease-Token", lease.lease_token)
      .send(confirmationBody);
    expect(exactConfirmation.body).toMatchObject({
      confirmed: true,
      transaction_status: "active",
      active_binding_revision: pending.body.binding_revision_id,
      trace_id: traceId,
    });
  });

  it("trace mismatch cannot roll back an executing stage transaction", async () => {
    const app = makeApp();
    const sessionId = await createSession(app, "rollback-trace-zero-side-effect");
    const traceId = sessionTrace(sessionId);
    const lease = await claim(app, sessionId, "rollback-trace-owner");
    const pending = await preauthorize(
      app,
      sessionId,
      lease,
      "rollback-trace-owner",
      "rollback-trace-zero-side-effect",
    );
    expect(pending.status).toBe(200);
    const attempt = runtimeBody(lease, {
      requested_event_type: "openStageRequest",
      request_id: "cmd_rollback_trace_zero_side_effect",
      command_context: {},
      stage_binding_authorization_id: pending.body.stage_binding_authorization_id,
      binding_revision_id: pending.body.binding_revision_id,
      stage_composition: pending.body.stage_composition,
    });

    await request(app.app)
      .post(`/api/internal/review-sessions/${sessionId}/runtime-command-authorizations`)
      .set(internalHeaders(sessionId))
      .set("X-Viewer-Lease-Token", lease.lease_token)
      .send(attempt)
      .expect(200, {
        authorized: true,
        request_id: "cmd_rollback_trace_zero_side_effect",
        retryable: false,
        trace_id: traceId,
      });

    const mismatchedRollback = await request(app.app)
      .post(`/api/internal/review-sessions/${sessionId}/stage-binding-authorization-rollbacks`)
      .set(internalHeaders())
      .set("X-Trace-Id", traceId.toUpperCase())
      .set("X-Viewer-Lease-Token", lease.lease_token)
      .send(attempt);
    expect(mismatchedRollback.body).toEqual({
      rolled_back: false,
      request_id: "cmd_rollback_trace_zero_side_effect",
      detail_code: "rollback_trace_authority_unavailable",
    });
    expect(mismatchedRollback.headers["x-trace-id"]).toBeUndefined();

    const statusAfterMismatch = await request(app.app)
      .get(`/api/review-sessions/${sessionId}/viewer-leases/status`)
      .set("X-User-Token", "rollback-trace-owner");
    expect(statusAfterMismatch.body.stage_binding).toMatchObject({
      transaction_status: "executing",
      active_binding_revision: null,
    });

    const exactRollback = await request(app.app)
      .post(`/api/internal/review-sessions/${sessionId}/stage-binding-authorization-rollbacks`)
      .set(internalHeaders(sessionId))
      .set("X-Viewer-Lease-Token", lease.lease_token)
      .send(attempt);
    expect(exactRollback.body).toMatchObject({
      rolled_back: true,
      request_id: "cmd_rollback_trace_zero_side_effect",
      transaction_status: "failed",
      trace_id: traceId,
    });
  });

  it("fails an exact stage authorization before mutation so response loss cannot block a retry", async () => {
    const app = makeApp();
    const sessionId = await createSession(app);
    const lease = await claim(app, sessionId, "stage-owner");
    const pending = await preauthorize(app, sessionId, lease, "stage-owner");
    expect(pending.status).toBe(200);
    const stageFields = {
      stage_binding_authorization_id: pending.body.stage_binding_authorization_id,
      binding_revision_id: pending.body.binding_revision_id,
      stage_composition: pending.body.stage_composition,
    };
    const attempt = runtimeBody(lease, {
      requested_event_type: "openStageRequest",
      request_id: "cmd_stage_response_lost",
      command_context: {},
      ...stageFields,
    });

    await request(app.app)
      .post(`/api/internal/review-sessions/${sessionId}/runtime-command-authorizations`)
      .set(internalHeaders(sessionId))
      .set("X-Viewer-Lease-Token", lease.lease_token)
      .send(attempt)
      .expect(200, {
        authorized: true,
        request_id: "cmd_stage_response_lost",
        retryable: false,
        trace_id: sessionTrace(sessionId),
      });

    const invalidCorrelatedRollback = await request(app.app)
      .post(`/api/internal/review-sessions/${sessionId}/stage-binding-authorization-rollbacks`)
      .set(internalHeaders(sessionId))
      .set("X-Viewer-Lease-Token", lease.lease_token)
      .send({ ...attempt, stage_composition: { root_layer_url: 42 } });
    expect(invalidCorrelatedRollback.body).toEqual({
      rolled_back: false,
      request_id: "cmd_stage_response_lost",
      detail_code: "rollback_payload_invalid",
    });

    const invalidUncorrelatedRollback = await request(app.app)
      .post(`/api/internal/review-sessions/${sessionId}/stage-binding-authorization-rollbacks`)
      .set(internalHeaders(sessionId))
      .set("X-Viewer-Lease-Token", lease.lease_token)
      .send({ ...attempt, request_id: "?", stage_composition: { root_layer_url: 42 } });
    expect(invalidUncorrelatedRollback.body).toMatchObject({
      rolled_back: false,
      detail_code: "rollback_payload_invalid",
    });
    expect(invalidUncorrelatedRollback.body.rejection_id).toMatch(/^rejection_/);

    const rollback = await request(app.app)
      .post(`/api/internal/review-sessions/${sessionId}/stage-binding-authorization-rollbacks`)
      .set(internalHeaders(sessionId))
      .set("X-Viewer-Lease-Token", lease.lease_token)
      .send(attempt);
    expect(rollback.status).toBe(200);
    expect(rollback.body).toMatchObject({
      rolled_back: true,
      request_id: "cmd_stage_response_lost",
      transaction_status: "failed",
      idempotent_replay: false,
    });

    const replay = await request(app.app)
      .post(`/api/internal/review-sessions/${sessionId}/stage-binding-authorization-rollbacks`)
      .set(internalHeaders(sessionId))
      .set("X-Viewer-Lease-Token", lease.lease_token)
      .send(attempt);
    expect(replay.body).toMatchObject({ rolled_back: true, idempotent_replay: true });

    const status = await request(app.app)
      .get(`/api/review-sessions/${sessionId}/viewer-leases/status`)
      .set("X-User-Token", "stage-owner");
    expect(status.body.stage_binding).toMatchObject({
      transaction_status: "failed",
      active_binding_revision: null,
    });
    expect(await preauthorize(app, sessionId, lease, "stage-owner"))
      .toMatchObject({ status: 200 });
    expect(app.eventLog.list(sessionId).filter((event) => event.type === "stageBindingApplied")).toHaveLength(0);
  });

  it("allows only one concurrent stage consume and rejects completion after lease turnover", async () => {
    const app = makeApp();
    const sessionId = await createSession(app, "concurrent-turnover");
    const originalLease = await claim(app, sessionId, "turnover-owner-a");
    const pending = await preauthorize(app, sessionId, originalLease, "turnover-owner-a", "concurrent-turnover");
    expect(pending.status).toBe(200);
    const stageFields = {
      stage_binding_authorization_id: pending.body.stage_binding_authorization_id,
      binding_revision_id: pending.body.binding_revision_id,
      stage_composition: pending.body.stage_composition,
    };
    const authorize = (requestId: string) => request(app.app)
      .post(`/api/internal/review-sessions/${sessionId}/runtime-command-authorizations`)
      .set(internalHeaders(sessionId))
      .set("X-Viewer-Lease-Token", originalLease.lease_token)
      .send(runtimeBody(originalLease, {
        requested_event_type: "loadArtifactGroupRequest",
        request_id: requestId,
        command_context: {},
        ...stageFields,
      }));

    const decisions = await Promise.all([
      authorize("cmd_concurrent_a"),
      authorize("cmd_concurrent_b"),
    ]);
    expect(decisions.every((decision) => decision.status === 200)).toBe(true);
    expect(decisions.filter((decision) => decision.body.authorized === true)).toHaveLength(1);
    expect(decisions.filter((decision) => decision.body.authorized === false)).toHaveLength(1);
    const acceptedRequestId = decisions.find((decision) => decision.body.authorized === true)?.body.request_id;
    expect(["cmd_concurrent_a", "cmd_concurrent_b"]).toContain(acceptedRequestId);

    const interleavedPreauthorization = await preauthorize(
      app,
      sessionId,
      originalLease,
      "turnover-owner-a",
      "concurrent-turnover",
    );
    expect(interleavedPreauthorization.status).toBe(409);
    expect(interleavedPreauthorization.body).toEqual({ detail: "stage_binding_transaction_executing" });

    await request(app.app)
      .post(`/api/review-sessions/${sessionId}/viewer-leases/${originalLease.lease_id}/release`)
      .set("X-Viewer-Lease-Token", originalLease.lease_token)
      .send({ reason: "lease turnover" })
      .expect(200);
    const replacementLease = await claim(app, sessionId, "turnover-owner-b");
    const confirmationBody = {
      trace_id: sessionTrace(sessionId),
      stage_binding_authorization_id: pending.body.stage_binding_authorization_id,
      binding_revision_id: pending.body.binding_revision_id,
      request_id: acceptedRequestId,
      outcome: "success",
    };

    const releasedCompletion = await request(app.app)
      .post(`/api/internal/review-sessions/${sessionId}/stage-binding-confirmations`)
      .set(internalHeaders(sessionId))
      .set("X-Viewer-Lease-Token", originalLease.lease_token)
      .send(confirmationBody);
    expect(releasedCompletion.status).toBe(200);
    expect(releasedCompletion.body).toMatchObject({
      confirmed: false,
      reason: "lease_invalid",
      request_id: acceptedRequestId,
      detail_code: "lease_released",
    });

    const replacementCompletion = await request(app.app)
      .post(`/api/internal/review-sessions/${sessionId}/stage-binding-confirmations`)
      .set(internalHeaders(sessionId))
      .set("X-Viewer-Lease-Token", replacementLease.lease_token)
      .send(confirmationBody);
    expect(replacementCompletion.status).toBe(200);
    expect(replacementCompletion.body).toMatchObject({
      confirmed: false,
      reason: "lease_invalid",
      request_id: acceptedRequestId,
      detail_code: "source_client_mismatch",
    });

    const status = await request(app.app)
      .get(`/api/review-sessions/${sessionId}/viewer-leases/status`)
      .set("X-User-Token", "turnover-owner-a");
    expect(status.body.stage_binding).toMatchObject({
      transaction_status: "executing",
      binding_revision_id: pending.body.binding_revision_id,
      active_binding_revision: null,
    });
    expect(app.eventLog.list(sessionId).filter((event) => event.type === "stageBindingApplied")).toHaveLength(0);
  });

  it("does not activate a stage binding when the exactly-once audit append fails", async () => {
    const app = makeApp();
    const sessionId = await createSession(app);
    const lease = await claim(app, sessionId, "audit-owner");
    const pending = await preauthorize(app, sessionId, lease, "audit-owner");
    const stageFields = {
      stage_binding_authorization_id: pending.body.stage_binding_authorization_id,
      binding_revision_id: pending.body.binding_revision_id,
      stage_composition: pending.body.stage_composition,
    };
    await request(app.app)
      .post(`/api/internal/review-sessions/${sessionId}/runtime-command-authorizations`)
      .set(internalHeaders(sessionId))
      .set("X-Viewer-Lease-Token", lease.lease_token)
      .send(runtimeBody(lease, {
        requested_event_type: "openStageRequest",
        request_id: "cmd_stage_audit_failure",
        command_context: {},
        ...stageFields,
      }))
      .expect(200);

    const appendSpy = vi.spyOn(app.eventLog, "append");
    appendSpy.mockImplementationOnce(() => {
      throw new Error("simulated stageBindingApplied audit failure");
    });
    const confirmationBody = {
      trace_id: sessionTrace(sessionId),
      stage_binding_authorization_id: pending.body.stage_binding_authorization_id,
      binding_revision_id: pending.body.binding_revision_id,
      request_id: "cmd_stage_audit_failure",
      outcome: "success",
    };
    const failed = await request(app.app)
      .post(`/api/internal/review-sessions/${sessionId}/stage-binding-confirmations`)
      .set(internalHeaders(sessionId))
      .set("X-Viewer-Lease-Token", lease.lease_token)
      .send(confirmationBody);
    expect(failed.status).toBe(500);

    const statusAfterFailure = await request(app.app)
      .get(`/api/review-sessions/${sessionId}/viewer-leases/status`)
      .set("X-User-Token", "audit-owner");
    expect(statusAfterFailure.body.stage_binding).toMatchObject({
      transaction_status: "executing",
      active_binding_revision: null,
    });
    expect(app.eventLog.list(sessionId).filter((event) => event.type === "stageBindingApplied")).toHaveLength(0);

    const retry = await request(app.app)
      .post(`/api/internal/review-sessions/${sessionId}/stage-binding-confirmations`)
      .set(internalHeaders(sessionId))
      .set("X-Viewer-Lease-Token", lease.lease_token)
      .send(confirmationBody);
    expect(retry.body).toMatchObject({
      confirmed: true,
      transaction_status: "active",
      idempotent_replay: false,
    });
    expect(app.eventLog.list(sessionId).filter((event) => event.type === "stageBindingApplied")).toHaveLength(1);
  });

  it("denies a tampered exact composition without consuming the pending transaction", async () => {
    const app = makeApp();
    const sessionId = await createSession(app);
    const lease = await claim(app, sessionId, "stage-owner");
    const pending = await preauthorize(app, sessionId, lease, "stage-owner");
    const tamperedComposition = structuredClone(pending.body.stage_composition);
    tamperedComposition.primary.usdc_url = "http://127.0.0.1:49101/artifacts/wrong/model.usdc";

    const tampered = await request(app.app)
      .post(`/api/internal/review-sessions/${sessionId}/runtime-command-authorizations`)
      .set(internalHeaders(sessionId))
      .set("X-Viewer-Lease-Token", lease.lease_token)
      .send(runtimeBody(lease, {
        requested_event_type: "loadArtifactGroupRequest",
        request_id: "cmd_stage_tamper",
        command_context: {},
        stage_binding_authorization_id: pending.body.stage_binding_authorization_id,
        binding_revision_id: pending.body.binding_revision_id,
        stage_composition: tamperedComposition,
      }));
    expect(tampered.body).toMatchObject({ authorized: false, reason: "invalid_payload", retryable: false });

    const exact = await request(app.app)
      .post(`/api/internal/review-sessions/${sessionId}/runtime-command-authorizations`)
      .set(internalHeaders(sessionId))
      .set("X-Viewer-Lease-Token", lease.lease_token)
      .send(runtimeBody(lease, {
        requested_event_type: "loadArtifactGroupRequest",
        request_id: "cmd_stage_exact",
        command_context: {},
        stage_binding_authorization_id: pending.body.stage_binding_authorization_id,
        binding_revision_id: pending.body.binding_revision_id,
        stage_composition: pending.body.stage_composition,
      }));
    expect(exact.body).toEqual({
      authorized: true,
      request_id: "cmd_stage_exact",
      retryable: false,
      trace_id: sessionTrace(sessionId),
    });
  });
});
