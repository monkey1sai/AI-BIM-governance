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
  return response.body as {
    lease_id: string;
    lease_token: string;
    user_id: string;
  };
}

function internalHeaders() {
  return { "X-Internal-Token": "test-internal-token" };
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
  lease: { lease_id: string },
  overrides: Record<string, unknown> = {},
) {
  return {
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

    const missingInternal = await request(app.app)
      .post(`/api/internal/review-sessions/${sessionId}/runtime-command-authorizations`)
      .set("X-Viewer-Lease-Token", lease.lease_token)
      .send(runtimeBody(lease));
    expect(missingInternal.status).toBe(401);

    const allowed = await request(app.app)
      .post(`/api/internal/review-sessions/${sessionId}/runtime-command-authorizations`)
      .set(internalHeaders())
      .set("X-Viewer-Lease-Token", lease.lease_token)
      .send(runtimeBody(lease));
    expect(allowed.status).toBe(200);
    expect(allowed.body).toEqual({
      authorized: true,
      request_id: "cmd_highlight_001",
      retryable: false,
    });

    const forged = await request(app.app)
      .post(`/api/internal/review-sessions/${sessionId}/runtime-command-authorizations`)
      .set(internalHeaders())
      .set("X-Viewer-Lease-Token", "forged-viewer-lease-token")
      .send(runtimeBody(lease, { request_id: "cmd_forged_001" }));
    expect(forged.status).toBe(200);
    expect(forged.body).toMatchObject({
      authorized: false,
      reason: "lease_invalid",
      request_id: "cmd_forged_001",
      retryable: false,
    });
  });

  it("classifies spectator, wrong-source, blocked lifecycle, unsupported and malformed attempts", async () => {
    const app = makeApp();
    const sessionId = await createSession(app);
    const primary = await claim(app, sessionId, "primary-user");
    const spectator = await claim(app, sessionId, "spectator-user", "spectator");

    const spectatorDecision = await request(app.app)
      .post(`/api/internal/review-sessions/${sessionId}/runtime-command-authorizations`)
      .set(internalHeaders())
      .set("X-Viewer-Lease-Token", spectator.lease_token)
      .send(runtimeBody(spectator, { request_id: "cmd_spectator_001" }));
    expect(spectatorDecision.body).toMatchObject({ authorized: false, reason: "spectator_readonly" });

    const wrongSource = await request(app.app)
      .post(`/api/internal/review-sessions/${sessionId}/runtime-command-authorizations`)
      .set(internalHeaders())
      .set("X-Viewer-Lease-Token", primary.lease_token)
      .send(runtimeBody({ lease_id: "viewer_lease_wrong_source" }, { request_id: "cmd_wrong_source_001" }));
    expect(wrongSource.body).toMatchObject({ authorized: false, reason: "unauthorized_source_client" });

    const unsupported = await request(app.app)
      .post(`/api/internal/review-sessions/${sessionId}/runtime-command-authorizations`)
      .set(internalHeaders())
      .set("X-Viewer-Lease-Token", primary.lease_token)
      .send(runtimeBody(primary, { requested_event_type: "composeStageRequest", request_id: "cmd_compose_001" }));
    expect(unsupported.body).toMatchObject({ authorized: false, reason: "unsupported_command" });

    const malformed = await request(app.app)
      .post(`/api/internal/review-sessions/${sessionId}/runtime-command-authorizations`)
      .set(internalHeaders())
      .set("X-Viewer-Lease-Token", primary.lease_token)
      .send({ source_client_id: primary.lease_id, requested_event_type: "highlightPrimsRequest" });
    expect(malformed.status).toBe(200);
    expect(malformed.body).toMatchObject({ authorized: false, reason: "invalid_payload" });
    expect(malformed.body.rejection_id).toMatch(/^rejection_/);

    await request(app.app).post(`/api/review-sessions/${sessionId}/close`).send({});
    const blocked = await request(app.app)
      .post(`/api/internal/review-sessions/${sessionId}/runtime-command-authorizations`)
      .set(internalHeaders())
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
      .set(internalHeaders())
      .set("X-Viewer-Lease-Token", firstLease.lease_token)
      .send(runtimeBody(firstLease, { request_id: "cmd_cross_session_001" }));
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
      .set(internalHeaders())
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
      .set(internalHeaders())
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
        .set(internalHeaders())
        .set("X-Viewer-Lease-Token", lease.lease_token)
        .send(runtimeBody(lease, {
          requested_event_type: eventType,
          request_id: `cmd_context_valid_${index}`,
          command_context: validContext,
        }));
      expect(valid.body).toMatchObject({ authorized: true, request_id: `cmd_context_valid_${index}` });

      const invalid = await request(app.app)
        .post(`/api/internal/review-sessions/${sessionId}/runtime-command-authorizations`)
        .set(internalHeaders())
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
      .set(internalHeaders())
      .set("X-Viewer-Lease-Token", lease.lease_token)
      .send(runtimeBody(lease, {
        requested_event_type: "openStageRequest",
        request_id: "cmd_stage_001",
        command_context: {},
        ...stageFields,
      }));
    expect(authorization.body).toEqual({ authorized: true, request_id: "cmd_stage_001", retryable: false });
    expect(app.eventLog.list(sessionId).filter((event) => event.type === "stageBindingApplied")).toHaveLength(0);

    const replay = await request(app.app)
      .post(`/api/internal/review-sessions/${sessionId}/runtime-command-authorizations`)
      .set(internalHeaders())
      .set("X-Viewer-Lease-Token", lease.lease_token)
      .send(runtimeBody(lease, {
        requested_event_type: "openStageRequest",
        request_id: "cmd_stage_001",
        command_context: {},
        ...stageFields,
      }));
    expect(replay.body).toMatchObject({ authorized: false, retryable: false });

    const confirmationBody = {
      stage_binding_authorization_id: pending.body.stage_binding_authorization_id,
      binding_revision_id: pending.body.binding_revision_id,
      request_id: "cmd_stage_001",
      outcome: "success",
    };
    const confirmation = await request(app.app)
      .post(`/api/internal/review-sessions/${sessionId}/stage-binding-confirmations`)
      .set(internalHeaders())
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
      .set(internalHeaders())
      .set("X-Viewer-Lease-Token", lease.lease_token)
      .send(confirmationBody);
    expect(duplicate.body).toMatchObject({ confirmed: true, idempotent_replay: true });
    expect(app.eventLog.list(sessionId).filter((event) => event.type === "stageBindingApplied")).toHaveLength(1);
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
      .set(internalHeaders())
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
      stage_binding_authorization_id: pending.body.stage_binding_authorization_id,
      binding_revision_id: pending.body.binding_revision_id,
      request_id: acceptedRequestId,
      outcome: "success",
    };

    const releasedCompletion = await request(app.app)
      .post(`/api/internal/review-sessions/${sessionId}/stage-binding-confirmations`)
      .set(internalHeaders())
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
      .set(internalHeaders())
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
      .set(internalHeaders())
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
      stage_binding_authorization_id: pending.body.stage_binding_authorization_id,
      binding_revision_id: pending.body.binding_revision_id,
      request_id: "cmd_stage_audit_failure",
      outcome: "success",
    };
    const failed = await request(app.app)
      .post(`/api/internal/review-sessions/${sessionId}/stage-binding-confirmations`)
      .set(internalHeaders())
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
      .set(internalHeaders())
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
      .set(internalHeaders())
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
      .set(internalHeaders())
      .set("X-Viewer-Lease-Token", lease.lease_token)
      .send(runtimeBody(lease, {
        requested_event_type: "loadArtifactGroupRequest",
        request_id: "cmd_stage_exact",
        command_context: {},
        stage_binding_authorization_id: pending.body.stage_binding_authorization_id,
        binding_revision_id: pending.body.binding_revision_id,
        stage_composition: pending.body.stage_composition,
      }));
    expect(exact.body).toEqual({ authorized: true, request_id: "cmd_stage_exact", retryable: false });
  });
});
