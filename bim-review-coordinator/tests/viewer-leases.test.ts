import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
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
  const res = await request(app.app)
    .post(`/api/review-sessions/${sessionId}/viewer-leases/claim`)
    .send({
      viewer_id: viewerId,
      user_id: `user_${viewerId}`,
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
    expect(session.viewer_leases).toHaveLength(1);
    expect(session.viewer_leases[0].lease_id).toBe(lease.lease_id);
    expect(session.viewer_leases[0].lease_token).toBeUndefined();
  });

  it("replays the same client_nonce idempotently but rejects a second explicit primary", async () => {
    const app = makeApp();
    const sessionId = await createSession(app);
    const first = await claimPrimary(app, sessionId, "viewer_a");

    const replay = await request(app.app)
      .post(`/api/review-sessions/${sessionId}/viewer-leases/claim`)
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
      .send({
        viewer_id: "viewer_b",
        user_id: "user_viewer_b",
        requested_role: "primary",
        client_nonce: `viewer_b:${sessionId}:primary`,
      });
    expect(second.status).toBe(409);
    expect(second.body.detail).toBe("primary_already_claimed");
    expect(second.body.primary_lease.lease_id).toBe(first.lease_id);
  });

  it("records heartbeat first-frame, stage-match, and authorizes stage-binding with the lease token", async () => {
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
      .set("X-Viewer-Lease-Token", lease.lease_token)
      .send({
        source_client_id: lease.lease_id,
        role: "primary",
        binding_revision_id: "rev_a",
        primary_artifact_id: "auto_usdc_stream_conv_status_001",
      });
    expect(binding.status).toBe(200);
    expect(binding.body.primary_client_id).toBe(lease.lease_id);
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
      .set("X-Viewer-Lease-Token", "wrong-token")
      .send({
        source_client_id: lease.lease_id,
        role: "primary",
        binding_revision_id: "rev_a",
        primary_artifact_id: "auto_usdc_stream_conv_status_001",
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
      .send({
        source_client_id: lease.lease_id,
        role: "primary",
        binding_revision_id: "rev_a",
        primary_artifact_id: "auto_usdc_stream_conv_status_001",
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

    const status = await request(app.app).get(`/api/review-sessions/${sessionId}/viewer-leases/status`);
    expect(status.status).toBe(200);
    const found = status.body.leases.find((item: any) => item.lease_id === lease.lease_id);
    expect(found.status).toBe("released");
    expect(status.body.primary_lease_id).toBeNull();
  });
});
