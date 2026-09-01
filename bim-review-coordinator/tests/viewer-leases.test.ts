import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCoordinatorApp, type CoordinatorApp } from "../src/app.js";
import type { CoordinatorConfig } from "../src/config.js";

let active: CoordinatorApp | null = null;

afterEach(async () => {
  if (active) {
    active.io.close();
    await new Promise<void>((resolve) => active?.server.close(() => resolve()));
    active = null;
  }
});

function makeApp(overrides: Partial<CoordinatorConfig> = {}): CoordinatorApp {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bim-review-coordinator-viewer-leases-"));
  active = createCoordinatorApp({
    sessionStoreDir: path.join(root, "sessions"),
    eventLogDir: path.join(root, "events"),
    callbackOutboxStorePath: path.join(root, "callback-outbox.json"),
    corsOrigins: ["http://127.0.0.1:5173"],
    kitMediaPort: 47998,
    kitInstanceEndpoints: [
      {
        id: "kit_local_001",
        signalingServer: "127.0.0.1",
        signalingPort: 49100,
        mediaServer: "127.0.0.1",
        mediaPort: 47998,
      },
      {
        id: "kit_local_002",
        signalingServer: "127.0.0.1",
        signalingPort: 49110,
        mediaServer: "127.0.0.1",
        mediaPort: 48008,
      },
    ],
    ...overrides,
  });
  return active;
}

async function createSession(
  app: CoordinatorApp,
  artifactUrl = "http://127.0.0.1:49101/artifacts/stream_conv_status_001/model.usdc",
): Promise<string> {
  const created = await request(app.app)
    .post("/api/review-sessions")
    .send({
      project_id: "project_demo_001",
      model_version_id: "version_demo_001",
      created_by: "dev_user_001",
      artifact_bindings: [
        {
          artifact_group_id: "ag_version_demo_001",
          artifact_id: "auto_usdc_stream_conv_status_001",
          artifact_role: "derived",
          url: artifactUrl,
          mapping_url: "http://127.0.0.1:49101/artifacts/stream_conv_status_001/element_mapping.json",
          load_order: 0,
          ready_status: "ready",
          conversion_authority: "bim-streaming-server",
          conversion_job_id: "stream_conv_status_001",
          conversion_status: "ready",
        },
      ],
    });
  expect(created.status).toBe(200);
  expect(typeof created.body.session_id).toBe("string");
  return created.body.session_id as string;
}

async function claimPrimary(app: CoordinatorApp, sessionId: string, viewerId = "viewer_a") {
  const userId = `user_${viewerId}`;
  const res = await request(app.app)
    .post(`/api/review-sessions/${sessionId}/viewer-leases/claim`)
    .set("X-User-Token", userId)
    .send({
      viewer_id: viewerId,
      user_id: userId,
      display_name: `Viewer ${viewerId}`,
      requested_role: "primary",
      client_nonce: `${viewerId}:${sessionId}:primary`,
    });
  expect(res.status).toBe(200);
  return res.body as {
    lease_id: string;
    lease_token: string;
    session_id: string;
    role: string;
    status: string;
    kit_instance_id: string | null;
  };
}

describe("review session viewer leases", () => {
  it("claims a primary viewer lease and exposes it in runtime status without leaking token", async () => {
    const app = makeApp();
    const sessionId = await createSession(app);

    const lease = await claimPrimary(app, sessionId);
    expect(lease.role).toBe("primary");
    expect(lease.status).toBe("active");
    expect(lease.kit_instance_id).toBe("kit_local_001");
    expect(typeof lease.lease_token).toBe("string");

    const runtime = await request(app.app).get("/api/runtime/status");
    const session = runtime.body.sessions.items.find((item: any) => item.session_id === sessionId);
    expect(session.primary_viewer_lease_id).toBe(lease.lease_id);
    expect(session.stage_open_state).toBe("not_observed");
    expect(session.stage_open_evidence.source).toBe("viewer_lease");
    expect(session.viewer_leases).toHaveLength(1);
    expect(session.viewer_leases[0].lease_id).toBe(lease.lease_id);
    expect(session.viewer_leases[0].lease_token).toBeUndefined();
  });

  it("keeps Kit binding metadata separate from actual stage-open proof", async () => {
    const app = makeApp();
    const sessionId = await createSession(app);

    const beforeLease = await request(app.app).get("/api/runtime/status");
    const beforeSession = beforeLease.body.sessions.items.find((item: any) => item.session_id === sessionId);
    expect(beforeSession.stage_open_state).toBe("not_requested");
    expect(beforeSession.stage_open_evidence.detail).toContain("no active primary viewer lease");
    expect(beforeLease.body.kit_instance_bindings[0].status).toBe("ready");
    expect(beforeLease.body.kit_instance_bindings[0].binding_intent).toBe("capacity_allocated");

    const lease = await claimPrimary(app, sessionId);
    await request(app.app)
      .post(`/api/review-sessions/${sessionId}/viewer-leases/${lease.lease_id}/heartbeat`)
      .set("X-Viewer-Lease-Token", lease.lease_token)
      .send({
        first_frame: true,
        loaded_stage_url: "http://127.0.0.1:49101/artifacts/stream_conv_status_001/model.usdc",
        datachannel_ready: true,
      });

    const afterHeartbeat = await request(app.app).get("/api/runtime/status");
    const afterSession = afterHeartbeat.body.sessions.items.find((item: any) => item.session_id === sessionId);
    expect(afterSession.stage_open_state).toBe("open");
    expect(afterSession.stage_open_evidence.source).toBe("viewer_lease");
    expect(afterSession.stage_open_evidence.loaded_stage_url).toContain("model.usdc");
  });

  it("replays the same client_nonce idempotently but rejects a second explicit primary", async () => {
    const app = makeApp();
    const sessionId = await createSession(app);
    const first = await claimPrimary(app, sessionId, "viewer_a");

    const replay = await request(app.app)
      .post(`/api/review-sessions/${sessionId}/viewer-leases/claim`)
      .set("X-User-Token", "user_viewer_a")
      .send({
        viewer_id: "viewer_a",
        user_id: "user_viewer_a",
        requested_role: "primary",
        client_nonce: `viewer_a:${sessionId}:primary`,
      });
    expect(replay.status).toBe(200);
    expect(replay.body.lease_id).toBe(first.lease_id);
    expect(replay.body.idempotent_replay).toBe(true);

    const second = await request(app.app)
      .post(`/api/review-sessions/${sessionId}/viewer-leases/claim`)
      .set("X-User-Token", "user_viewer_b")
      .send({
        viewer_id: "viewer_b",
        user_id: "user_viewer_b",
        requested_role: "primary",
        client_nonce: `viewer_b:${sessionId}:primary`,
      });
    expect(second.status).toBe(409);
    expect(second.body.detail).toBe("primary_already_claimed");
    expect(second.body).not.toHaveProperty("primary_lease");
    expect(JSON.stringify(second.body)).not.toContain(first.lease_id);
  });

  it("records heartbeat first-frame, stage-match, and creates a pending server-owned stage binding", async () => {
    const app = makeApp();
    const sessionId = await createSession(app);
    const lease = await claimPrimary(app, sessionId);

    const heartbeat = await request(app.app)
      .post(`/api/review-sessions/${sessionId}/viewer-leases/${lease.lease_id}/heartbeat`)
      .set("X-Viewer-Lease-Token", lease.lease_token)
      .send({
        first_frame: true,
        loaded_stage_url: "http://127.0.0.1:49101/artifacts/stream_conv_status_001/model.usdc",
        datachannel_ready: true,
      });
    expect(heartbeat.status).toBe(200);
    expect(heartbeat.body.first_frame_at).toBeTruthy();
    expect(heartbeat.body.stage_match).toBe(true);
    expect(heartbeat.body.datachannel_ready).toBe(true);

    const binding = await request(app.app)
      .post(`/api/review-sessions/${sessionId}/stage-binding`)
      .set("X-User-Token", "user_viewer_a")
      .set("X-Viewer-Lease-Token", lease.lease_token)
      .send({
        source_client_id: lease.lease_id,
        role: "primary",
        artifacts: [{
          artifact_id: "auto_usdc_stream_conv_status_001",
          role: "primary",
          load_order: 0,
        }],
      });
    expect(binding.status).toBe(200);
    expect(binding.body.status).toBe("pending");
    expect(binding.body.stage_binding_authorization_id).toMatch(/^stage_auth_/);
    expect(binding.body.binding_revision_id).toMatch(/^binding_rev_/);
    expect(binding.body.stage_composition.primary).toMatchObject({
      artifact_id: "auto_usdc_stream_conv_status_001",
      role: "primary",
      load_order: 0,
    });
  });

  it("keeps full loaded stage URLs up to the route schema limit for stage matching", async () => {
    const app = makeApp();
    const longStageUrl = `http://127.0.0.1:49101/artifacts/${"nested/".repeat(90)}model.usdc?etag=${"a".repeat(80)}`;
    expect(longStageUrl.length).toBeGreaterThan(500);
    expect(longStageUrl.length).toBeLessThan(2048);
    const sessionId = await createSession(app, longStageUrl);
    const lease = await claimPrimary(app, sessionId);

    const heartbeat = await request(app.app)
      .post(`/api/review-sessions/${sessionId}/viewer-leases/${lease.lease_id}/heartbeat`)
      .set("X-Viewer-Lease-Token", lease.lease_token)
      .send({
        first_frame: true,
        loaded_stage_url: longStageUrl,
        datachannel_ready: true,
      });

    expect(heartbeat.status).toBe(200);
    expect(heartbeat.body.loaded_stage_url).toBe(longStageUrl);
    expect(heartbeat.body.stage_match).toBe(true);
  });

  it("does not treat different custom stage URLs as equivalent", async () => {
    const app = makeApp();
    const sessionId = await createSession(app, "stage://expected-model");
    const lease = await claimPrimary(app, sessionId);

    const heartbeat = await request(app.app)
      .post(`/api/review-sessions/${sessionId}/viewer-leases/${lease.lease_id}/heartbeat`)
      .set("X-Viewer-Lease-Token", lease.lease_token)
      .send({
        first_frame: true,
        loaded_stage_url: "stage://wrong-model",
        datachannel_ready: true,
      });

    expect(heartbeat.status).toBe(200);
    expect(heartbeat.body.loaded_stage_url).toBe("stage://wrong-model");
    expect(heartbeat.body.stage_match).toBe(false);
  });

  it("rejects stage-binding when a lease token is present but not authorized", async () => {
    const app = makeApp();
    const sessionId = await createSession(app);
    const lease = await claimPrimary(app, sessionId);

    const binding = await request(app.app)
      .post(`/api/review-sessions/${sessionId}/stage-binding`)
      .set("X-User-Token", "user_viewer_a")
      .set("X-Viewer-Lease-Token", "wrong-token")
      .send({
        source_client_id: lease.lease_id,
        role: "primary",
        artifacts: [{
          artifact_id: "auto_usdc_stream_conv_status_001",
          role: "primary",
          load_order: 0,
        }],
      });
    expect(binding.status).toBe(403);
    expect(binding.body.detail).toContain("primary viewer lease");
  });

  it("rejects stage-binding without a viewer lease token", async () => {
    const app = makeApp();
    const sessionId = await createSession(app);
    const lease = await claimPrimary(app, sessionId);

    const binding = await request(app.app)
      .post(`/api/review-sessions/${sessionId}/stage-binding`)
      .set("X-User-Token", "user_viewer_a")
      .send({
        source_client_id: lease.lease_id,
        role: "primary",
        artifacts: [{
          artifact_id: "auto_usdc_stream_conv_status_001",
          role: "primary",
          load_order: 0,
        }],
      });
    expect(binding.status).toBe(403);
    expect(binding.body.detail).toContain("primary viewer lease");
  });

  it("releases active viewer leases when the session closes", async () => {
    const app = makeApp();
    const sessionId = await createSession(app);
    const lease = await claimPrimary(app, sessionId);

    const close = await request(app.app).post(`/api/review-sessions/${sessionId}/close`).send({});
    expect(close.status).toBe(200);

    const status = await request(app.app)
      .get(`/api/review-sessions/${sessionId}/viewer-leases/status`)
      .set("X-User-Token", "user_viewer_a");
    expect(status.status).toBe(200);
    const found = status.body.leases.find((item: any) => item.lease_id === lease.lease_id);
    expect(found.status).toBe("released");
    expect(status.body.primary.available).toBe(true);
    expect(status.body.primary.owned_by_caller).toBe(false);
  });

  it("keeps leases active until close payloads are durable and reuses the checkpoint audit", async () => {
    const app = makeApp();
    const sessionId = await createSession(app);
    const lease = await claimPrimary(app, sessionId);
    const finalEvents = [{ type: "annotationFinal", count: 1 }];
    const originalAppend = app.eventLog.appendServerCloseCheckpoint.bind(app.eventLog);
    let failFinalEventOnce = true;
    const appendSpy = vi.spyOn(app.eventLog, "appendServerCloseCheckpoint").mockImplementation((id, type, payload, checkpointId) => {
      if (type === "finalReviewEvent" && failFinalEventOnce) {
        failFinalEventOnce = false;
        throw new Error("transient final event append failure");
      }
      return originalAppend(id, type, payload, checkpointId);
    });

    try {
      const firstClose = await request(app.app)
        .post(`/api/review-sessions/${sessionId}/close`)
        .set("X-User-Token", "original-operator")
        .send({ reason: "original close reason", final_events: finalEvents });
      expect(firstClose.status).toBe(500);
      expect(app.store.get(sessionId)?.status).toBe("active");

      const heartbeat = await request(app.app)
        .post(`/api/review-sessions/${sessionId}/viewer-leases/${lease.lease_id}/heartbeat`)
        .set("X-Viewer-Lease-Token", lease.lease_token)
        .send({ datachannel_ready: true });
      expect(heartbeat.status).toBe(200);

      const retriedClose = await request(app.app)
        .post(`/api/review-sessions/${sessionId}/close`)
        .set("X-User-Token", "replacement-operator")
        .send({ reason: "replacement close reason", final_events: finalEvents });
      expect(retriedClose.status).toBe(200);
      expect(retriedClose.body.status).toBe("closed");

      const status = await request(app.app)
        .get(`/api/review-sessions/${sessionId}/viewer-leases/status`)
        .set("X-User-Token", "user_viewer_a");
      const storedLease = status.body.leases.find((item: { lease_id: string }) => item.lease_id === lease.lease_id);
      expect(storedLease.status).toBe("released");

      const checkpointEvents = app.eventLog
        .list(sessionId)
        .filter((event) => event.close_checkpoint_id === retriedClose.body.close_checkpoint.checkpoint_id);
      const closingPayload = checkpointEvents.find((event) => event.type === "sessionClosing")?.payload;
      const closedPayload = checkpointEvents.find((event) => event.type === "sessionClosed")?.payload;
      expect(closingPayload).toMatchObject({ reason: "original close reason" });
      expect(closedPayload).toEqual(closingPayload && typeof closingPayload === "object"
        ? {
            reason: (closingPayload as { reason: string }).reason,
            actor: (closingPayload as { actor: string }).actor,
          }
        : null);
    } finally {
      appendSpy.mockRestore();
    }
  });
});
