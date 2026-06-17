import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import request from "supertest";
import { io as createSocketClient, type Socket as SocketClient } from "socket.io-client";
import { afterEach, describe, expect, it } from "vitest";
import { createCoordinatorApp, type CoordinatorApp } from "../src/app.js";
import type { CoordinatorConfig } from "../src/config.js";
import { EventLog } from "../src/services/eventLog.js";

let active: CoordinatorApp | null = null;
let activeRoot: string | null = null;
const activeClients: SocketClient[] = [];

afterEach(async () => {
  for (const client of activeClients.splice(0)) {
    client.disconnect();
  }
  if (active) {
    active.io.close();
    await new Promise<void>((resolve) => active?.server.close(() => resolve()));
    active = null;
  }
});

function makeApp(overrides: Partial<CoordinatorConfig> = {}): CoordinatorApp {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bim-review-coordinator-test-"));
  activeRoot = root;
  active = createCoordinatorApp({
    sessionStoreDir: path.join(root, "sessions"),
    eventLogDir: path.join(root, "events"),
    callbackOutboxStorePath: path.join(root, "callback-outbox.json"),
    corsOrigins: ["http://127.0.0.1:5173"],
    ...overrides,
  });
  return active;
}

function multiEndpointOverrides(): Partial<CoordinatorConfig> {
  return {
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
  };
}

async function listen(app: CoordinatorApp): Promise<string> {
  await new Promise<void>((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const address = app.server.address();
  if (!address || typeof address === "string") {
    throw new Error("Expected coordinator test server to listen on a TCP port.");
  }
  return `http://127.0.0.1:${address.port}/review`;
}

async function connectReviewSocket(url: string): Promise<SocketClient> {
  const client = createSocketClient(url, {
    forceNew: true,
    transports: ["websocket"],
  });
  activeClients.push(client);

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Timed out connecting review socket.")), 5000);
    client.once("connect", () => {
      clearTimeout(timeout);
      resolve(client);
    });
    client.once("connect_error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

async function emitWithAck<T>(client: SocketClient, event: string, payload: unknown): Promise<T> {
  return new Promise((resolve) => {
    client.emit(event, payload, (response: T) => resolve(response));
  });
}

describe("bim-review-coordinator", () => {
  it("returns health", async () => {
    const app = makeApp();
    const response = await request(app.app).get("/health");

    expect(response.status).toBe(200);
    expect(response.body.status).toBe("ok");
    expect(response.body.kit_signaling_port).toBe(49100);
  });

  it("returns dashboard runtime status with session, participant, Kit, and IFC-ready summaries", async () => {
    const app = makeApp(multiEndpointOverrides());
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
            url: "http://127.0.0.1:49101/artifacts/stream_conv_status_001/model.usdc",
            mapping_url: "http://127.0.0.1:49101/artifacts/stream_conv_status_001/element_mapping.json",
            load_order: 0,
            ready_status: "ready",
            conversion_authority: "bim-streaming-server",
            conversion_job_id: "stream_conv_status_001",
            conversion_status: "ready",
          },
        ],
      });
    await request(app.app)
      .post(`/api/review-sessions/${created.body.session_id}/join`)
      .send({ user_id: "viewer_001", display_name: "Viewer One" });

    const streamConfig = await request(app.app).get(`/api/review-sessions/${created.body.session_id}/stream-config`);
    const status = await request(app.app).get("/api/runtime/status");

    expect(streamConfig.status).toBe(200);
    expect(streamConfig.body.kit_instance_bindings).toHaveLength(2);
    expect(streamConfig.body.kit_instance_bindings[1]).toMatchObject({
      kit_instance_id: "kit_local_002",
      assigned_artifact_ids: ["auto_usdc_stream_conv_status_001"],
      stream_config: {
        signalingServer: "127.0.0.1",
        signalingPort: 49110,
        mediaServer: "127.0.0.1",
        mediaPort: 48008,
      },
    });
    expect(streamConfig.body.viewport_sharing).toMatchObject({
      mode: "single_kit_shared_state",
      shared_state: true,
      spectator_ready: true,
    });
    expect(status.status).toBe(200);
    expect(status.body.service.status).toBe("ok");
    expect(status.body.configured_endpoints.kit).toHaveLength(2);
    expect(status.body.configured_endpoints.kit[0]).toMatchObject({
      id: "kit_local_001",
      signalingServer: "127.0.0.1",
      signalingPort: 49100,
      mediaPort: 47998,
    });
    expect(status.body.sessions).toMatchObject({
      count: 1,
      active_count: 1,
      participant_count: 1,
    });
    expect(status.body.sessions.items[0]).toMatchObject({
      session_id: created.body.session_id,
      expected_stage_url: "http://127.0.0.1:49101/artifacts/stream_conv_status_001/model.usdc",
      participant_count: 1,
    });
    expect(status.body.kit_instance_bindings[0]).toMatchObject({
      kit_instance_id: "kit_local_001",
      session_id: created.body.session_id,
      assigned_artifact_ids: ["auto_usdc_stream_conv_status_001"],
    });
    expect(status.body.ifc_ready_jobs).toMatchObject({ count: 0, recent: [] });
    expect(status.body.observations.note).toContain("read-only");
  });

  it("creates a review session and stream config", async () => {
    const app = makeApp();
    const created = await request(app.app)
      .post("/api/review-sessions")
      .send({
        project_id: "project_demo_001",
        model_version_id: "version_demo_001",
        created_by: "dev_user_001",
      });

    expect(created.status).toBe(200);
    expect(created.body.session_id).toMatch(/^review_session_/);
    expect(created.body.kit_instance.signaling_port).toBe(49100);

    const config = await request(app.app).get(`/api/review-sessions/${created.body.session_id}/stream-config`);
    expect(config.status).toBe(200);
    expect(config.body.webrtc.signalingPort).toBe(49100);
    expect(config.body.model.status).toBe("missing");
    expect(config.body.lifecycle_status).toBe("active");
    expect(Array.isArray(config.body.artifact_bindings)).toBe(true);
    expect(Array.isArray(config.body.kit_instance_bindings)).toBe(true);
    // Additive pass-through: when not provided, stream_config still exposes the field as null.
    expect(config.body.quality_metrics_summary).toBeNull();
  });

  it("overrides stale loopback Kit endpoints in stream config when runtime host changes", async () => {
    const app = makeApp({
      kitMediaPort: 47998,
      kitInstanceEndpoints: [
        {
          id: "kit_local_001",
          signalingServer: "127.0.0.1",
          signalingPort: 49100,
          mediaServer: "127.0.0.1",
          mediaPort: null,
        },
      ],
    });
    const created = await request(app.app)
      .post("/api/review-sessions")
      .send({
        project_id: "project_demo_001",
        model_version_id: "version_demo_001",
        created_by: "dev_user_001",
      });

    expect(created.status).toBe(200);
    app.config.kitStreamServer = "192.0.2.10";
    app.config.kitMediaServer = "192.0.2.10";
    app.config.kitMediaPort = 47998;

    const config = await request(app.app).get(`/api/review-sessions/${created.body.session_id}/stream-config`);

    expect(config.status).toBe(200);
    expect(config.body.webrtc.signalingServer).toBe("192.0.2.10");
    expect(config.body.webrtc.mediaServer).toBe("192.0.2.10");
    expect(config.body.webrtc.mediaPort).toBe(47998);
    expect(config.body.kit_instance_bindings[0].stream_config.signalingServer).toBe("192.0.2.10");
  });

  it("forwards additive quality_metrics_summary from session creation through stream-config", async () => {
    const app = makeApp();
    const summary = {
      fixture_name: "fixture_demo.ifc",
      conversion_job_id: "conv_test_summary_001",
      artifact_group_id: "ag_test_summary",
      source_ifc_entity_count: 1234,
      sidecar_carrier_count: 7,
      materialization_strategy: "sidecar",
      coverage_ratio: 1.0,
      coverage_status: "pass",
      conversion_duration_seconds: 87.5,
    };
    const created = await request(app.app)
      .post("/api/review-sessions")
      .send({
        project_id: "project_demo_001",
        model_version_id: "version_demo_001",
        created_by: "dev_user_001",
        quality_metrics_summary: summary,
      });
    expect(created.status).toBe(200);
    expect(created.body.quality_metrics_summary).toEqual(summary);

    const config = await request(app.app).get(`/api/review-sessions/${created.body.session_id}/stream-config`);
    expect(config.status).toBe(200);
    expect(config.body.quality_metrics_summary).toEqual(summary);
    // Coordinator MUST NOT compute or rewrite values.
    expect(config.body.quality_metrics_summary.coverage_ratio).toBe(1.0);
    expect(config.body.quality_metrics_summary.materialization_strategy).toBe("sidecar");
  });

  it("stores provided artifact and Kit bindings on session creation", async () => {
    const app = makeApp();
    const created = await request(app.app)
      .post("/api/review-sessions")
      .send({
        review_request_id: "review_request_test_001",
        tenant_id: "tenant_demo_001",
        project_id: "project_demo_001",
        model_version_id: "version_demo_001",
        created_by: "dev_user_001",
        routing_policy: "same_instance",
        artifact_bindings: [
          {
            artifact_group_id: "ag_test_ready",
            artifact_id: "artifact_usdc_test_001",
            artifact_role: "derived",
            url: "edge-local://artifacts/model.usdc",
            mapping_url: "edge-local://artifacts/element_mapping.json",
            load_order: 0,
            ready_status: "ready",
          },
        ],
      });

    expect(created.status).toBe(200);
    expect(created.body.review_request_id).toBe("review_request_test_001");
    expect(created.body.artifact_bindings).toHaveLength(1);
    expect(created.body.kit_instance_bindings).toHaveLength(1);
    expect(created.body.kit_instance_bindings[0].assigned_artifact_ids).toEqual(["artifact_usdc_test_001"]);

    const config = await request(app.app).get(`/api/review-sessions/${created.body.session_id}/stream-config`);
    expect(config.status).toBe(200);
    expect(config.body.model.url).toBe("edge-local://artifacts/model.usdc");
    expect(config.body.artifact_bindings[0].mapping_url).toContain("element_mapping.json");
  });

  it("reports streaming-owned conversion as converting in stream config", async () => {
    const app = makeApp();
    const created = await request(app.app)
      .post("/api/review-sessions")
      .send({
        project_id: "project_demo_001",
        model_version_id: "version_demo_001",
        created_by: "dev_user_001",
        artifact_bindings: [
          {
            artifact_group_id: "ag_streaming_conversion",
            artifact_id: "artifact_ifc_demo_001",
            artifact_role: "derived",
            load_order: 0,
            ready_status: "converting",
            conversion_authority: "bim-streaming-server",
            conversion_job_id: "stream_conv_demo_001",
            conversion_status: "running",
          },
        ],
      });

    expect(created.status).toBe(200);
    const config = await request(app.app).get(`/api/review-sessions/${created.body.session_id}/stream-config`);
    expect(config.status).toBe(200);
    expect(config.body.model.status).toBe("converting");
    expect(config.body.model.conversion_authority).toBe("bim-streaming-server");
    expect(config.body.model.conversion_job_id).toBe("stream_conv_demo_001");
    expect(config.body.model.url).toBeNull();
  });

  it("passes streaming-owned ready conversion metadata through stream config", async () => {
    const app = makeApp();
    const created = await request(app.app)
      .post("/api/review-sessions")
      .send({
        project_id: "project_demo_001",
        model_version_id: "version_demo_001",
        created_by: "dev_user_001",
        artifact_bindings: [
          {
            artifact_group_id: "ag_streaming_ready",
            artifact_id: "artifact_stream_usdc_001",
            artifact_role: "derived",
            url: "http://127.0.0.1:49100/artifacts/stream_conv_001/model.usdc",
            mapping_url: "http://127.0.0.1:49100/artifacts/stream_conv_001/element_mapping.json",
            load_order: 0,
            ready_status: "ready",
            conversion_authority: "bim-streaming-server",
            conversion_job_id: "stream_conv_001",
            conversion_status: "succeeded",
          },
        ],
      });

    expect(created.status).toBe(200);
    const config = await request(app.app).get(`/api/review-sessions/${created.body.session_id}/stream-config`);
    expect(config.status).toBe(200);
    expect(config.body.model.status).toBe("ready");
    expect(config.body.model.conversion_authority).toBe("bim-streaming-server");
    expect(config.body.model.conversion_job_id).toBe("stream_conv_001");
    expect(config.body.model.mapping_url).toContain("element_mapping.json");
  });

  it("surfaces streaming-owned conversion failure without hiding it", async () => {
    const app = makeApp();
    const created = await request(app.app)
      .post("/api/review-sessions")
      .send({
        project_id: "project_demo_001",
        model_version_id: "version_demo_001",
        created_by: "dev_user_001",
        artifact_bindings: [
          {
            artifact_group_id: "ag_streaming_failed",
            artifact_id: "artifact_ifc_demo_001",
            artifact_role: "derived",
            load_order: 0,
            ready_status: "failed",
            conversion_authority: "bim-streaming-server",
            conversion_job_id: "stream_conv_failed_001",
            conversion_status: "failed",
            failure_code: "placeholder_usdc",
            diagnostic: "Generated model.usdc looks like a placeholder output.",
          },
        ],
      });

    expect(created.status).toBe(200);
    const config = await request(app.app).get(`/api/review-sessions/${created.body.session_id}/stream-config`);
    expect(config.status).toBe(200);
    expect(config.body.model.status).toBe("failed");
    expect(config.body.model.failure_code).toBe("placeholder_usdc");
    expect(config.body.model.diagnostic).toContain("placeholder");
  });

  it("allocates dedicated Kit instance bindings per artifact", async () => {
    const app = makeApp(multiEndpointOverrides());
    const created = await request(app.app)
      .post("/api/review-sessions")
      .send({
        project_id: "project_demo_001",
        model_version_id: "version_demo_001",
        created_by: "dev_user_001",
        routing_policy: "dedicated_instance",
        artifact_bindings: [
          {
            artifact_group_id: "ag_a",
            artifact_id: "artifact_usdc_a",
            artifact_role: "derived",
            url: "edge-local://artifacts/a.usdc",
            load_order: 0,
            ready_status: "ready",
          },
          {
            artifact_group_id: "ag_b",
            artifact_id: "artifact_usdc_b",
            artifact_role: "derived",
            url: "edge-local://artifacts/b.usdc",
            load_order: 1,
            ready_status: "ready",
          },
        ],
      });

    expect(created.status).toBe(200);
    expect(created.body.kit_instance_bindings).toHaveLength(2);
    expect(created.body.kit_instance_bindings[0].assigned_artifact_ids).toEqual(["artifact_usdc_a"]);
    expect(created.body.kit_instance_bindings[1].assigned_artifact_ids).toEqual(["artifact_usdc_b"]);
    expect(created.body.kit_instance_bindings[0].stream_config.signalingPort).toBe(49100);
    expect(created.body.kit_instance_bindings[1].stream_config.signalingPort).toBe(49110);
    expect(created.body.kit_instance_bindings[0].stream_config.mediaPort).toBe(47998);
    expect(created.body.kit_instance_bindings[1].stream_config.mediaPort).toBe(48008);

    const streamConfig = await request(app.app).get(`/api/review-sessions/${created.body.session_id}/stream-config`);
    expect(streamConfig.status).toBe(200);
    expect(streamConfig.body.webrtc.signalingPort).toBe(49100);
    expect(streamConfig.body.webrtc.mediaPort).toBe(47998);
    expect(streamConfig.body.stage_composition.primary_artifact_id).toBe("artifact_usdc_a");
    expect(streamConfig.body.stage_composition.secondary_artifact_ids).toEqual(["artifact_usdc_b"]);
  });

  it("reports queued_for_instance when dedicated Kit routing exceeds capacity", async () => {
    const app = makeApp();
    const created = await request(app.app)
      .post("/api/review-sessions")
      .send({
        project_id: "project_demo_001",
        model_version_id: "version_demo_001",
        created_by: "dev_user_001",
        routing_policy: "dedicated_instance",
        kit_profile: { capacity_slots: 1 },
        artifact_bindings: [
          {
            artifact_group_id: "ag_a",
            artifact_id: "artifact_usdc_a",
            artifact_role: "derived",
            url: "edge-local://artifacts/a.usdc",
            load_order: 0,
            ready_status: "ready",
          },
          {
            artifact_group_id: "ag_b",
            artifact_id: "artifact_usdc_b",
            artifact_role: "derived",
            url: "edge-local://artifacts/b.usdc",
            load_order: 1,
            ready_status: "ready",
          },
        ],
      });

    expect(created.status).toBe(409);
    expect(created.body.status).toBe("queued_for_instance");
    expect(created.body.artifact_bindings).toHaveLength(2);
  });

  it("reports queued_for_instance when Kit capacity is unavailable", async () => {
    const app = makeApp();
    const created = await request(app.app)
      .post("/api/review-sessions")
      .send({
        project_id: "project_demo_001",
        model_version_id: "version_demo_001",
        created_by: "dev_user_001",
        kit_profile: { capacity_slots: 0 },
        artifact_bindings: [
          {
            artifact_group_id: "ag_test_ready",
            artifact_id: "artifact_usdc_test_001",
            artifact_role: "derived",
            url: "edge-local://artifacts/model.usdc",
            load_order: 0,
            ready_status: "ready",
          },
        ],
      });

    expect(created.status).toBe(409);
    expect(created.body.status).toBe("queued_for_instance");
  });

  it("joins participants and appends events", async () => {
    const app = makeApp();
    const created = await request(app.app)
      .post("/api/review-sessions")
      .send({
        project_id: "project_demo_001",
        model_version_id: "version_demo_001",
        created_by: "dev_user_001",
      });

    const joined = await request(app.app)
      .post(`/api/review-sessions/${created.body.session_id}/join`)
      .send({ user_id: "dev_user_001", display_name: "Dev User" });

    expect(joined.status).toBe(200);
    expect(joined.body.participants).toHaveLength(1);

    const event = await request(app.app)
      .post(`/api/review-sessions/${created.body.session_id}/events`)
      .send({ type: "highlightRequest", issue_id: "ISSUE-DEMO-001" });
    expect(event.status).toBe(200);
    expect(fs.existsSync(path.join(activeRoot as string, "events", `${created.body.session_id}.jsonl`))).toBe(true);

    const events = await request(app.app).get(`/api/review-sessions/${created.body.session_id}/events`);
    expect(events.status).toBe(200);
    expect(events.body.items.some((item: { type: string }) => item.type === "highlightRequest")).toBe(true);
  });

  it("closes sessions separately from Kit release and blocks new mutating events", async () => {
    const app = makeApp();
    const created = await request(app.app)
      .post("/api/review-sessions")
      .send({
        project_id: "project_demo_001",
        model_version_id: "version_demo_001",
        created_by: "dev_user_001",
      });

    const closed = await request(app.app)
      .post(`/api/review-sessions/${created.body.session_id}/close`)
      .send({ final_events: [{ type: "annotationSnapshot", count: 1 }] });

    expect(closed.status).toBe(200);
    expect(closed.body.status).toBe("closed");
    expect(closed.body.kit_instance_bindings.every((binding: { status: string }) => binding.status === "released")).toBe(true);

    const event = await request(app.app)
      .post(`/api/review-sessions/${created.body.session_id}/events`)
      .send({ type: "highlightRequest", issue_id: "ISSUE-DEMO-001" });
    expect(event.status).toBe(409);

    const events = await request(app.app).get(`/api/review-sessions/${created.body.session_id}/events`);
    expect(events.body.items.map((item: { type: string }) => item.type)).toContain("sessionClosed");
    expect(events.body.items.map((item: { type: string }) => item.type)).toContain("kitInstanceReleased");
  });

  it("rejects HTTP events for missing sessions or malformed bodies", async () => {
    const app = makeApp();
    const missing = await request(app.app)
      .post("/api/review-sessions/review_session_missing/events")
      .send({ type: "highlightRequest", issue_id: "ISSUE-DEMO-001" });

    expect(missing.status).toBe(404);
    expect(missing.body.detail).toBe("Review session not found.");
    expect(fs.existsSync(path.join(activeRoot as string, "events", "review_session_missing.jsonl"))).toBe(false);

    const created = await request(app.app)
      .post("/api/review-sessions")
      .send({
        project_id: "project_demo_001",
        model_version_id: "version_demo_001",
        created_by: "dev_user_001",
      });
    const malformed = await request(app.app)
      .post(`/api/review-sessions/${created.body.session_id}/events`)
      .send({ issue_id: "ISSUE-DEMO-001" });

    expect(malformed.status).toBe(400);
  });

  it("rejects socket joinSession when the session id is missing, invalid, or unknown", async () => {
    const app = makeApp();
    const client = await connectReviewSocket(await listen(app));

    const missingJoin = await emitWithAck<{ ok: boolean; error?: string }>(client, "joinSession", {
      user_id: "dev_user_001",
    });
    expect(missingJoin).toEqual({ ok: false, error: "Missing session_id" });

    const invalidJoin = await emitWithAck<{ ok: boolean; error?: string }>(client, "joinSession", {
      session_id: "..\\secrets",
      user_id: "dev_user_001",
    });
    expect(invalidJoin).toEqual({ ok: false, error: "Invalid review session id." });

    const unknownJoin = await emitWithAck<{ ok: boolean; error?: string }>(client, "joinSession", {
      session_id: "review_session_missing",
      user_id: "dev_user_001",
    });
    expect(unknownJoin).toEqual({ ok: false, error: "Review session not found." });
    expect(fs.existsSync(path.join(activeRoot as string, "events", "review_session_missing.jsonl"))).toBe(false);
  });

  it("rejects socket joins for closed sessions", async () => {
    const app = makeApp();
    const created = await request(app.app)
      .post("/api/review-sessions")
      .send({
        project_id: "project_demo_001",
        model_version_id: "version_demo_001",
        created_by: "dev_user_001",
      });
    await request(app.app).post(`/api/review-sessions/${created.body.session_id}/close`).send({});
    const client = await connectReviewSocket(await listen(app));

    const response = await emitWithAck<{ ok: boolean; error?: string }>(client, "joinSession", {
      session_id: created.body.session_id,
      user_id: "dev_user_001",
    });

    expect(response).toEqual({ ok: false, error: "Review session is not active." });
  });

  it("rejects unsafe session ids before touching the filesystem", async () => {
    const app = makeApp();

    const response = await request(app.app).get("/api/review-sessions/..%2Fsecrets/events");

    expect(response.status).toBe(400);
    expect(response.body.detail).toBe("Invalid review session id.");
  });

  it("skips malformed lines in the event log instead of throwing", async () => {
    const eventsDir = fs.mkdtempSync(path.join(os.tmpdir(), "bim-review-coordinator-eventlog-"));
    const log = new EventLog(eventsDir);
    const sessionId = "review_session_eventlog_skip";
    log.append(sessionId, "highlightRequest", { issue_id: "ISSUE-DEMO-001" });
    fs.appendFileSync(path.join(eventsDir, `${sessionId}.jsonl`), "{not valid json\n", "utf8");
    log.append(sessionId, "selectionUpdate", { user_id: "dev_user_001" });

    const items = log.list(sessionId);
    expect(items.map((item) => item.type)).toEqual(["highlightRequest", "selectionUpdate"]);
  });

  it("migrates legacy json event logs into jsonl on first append", async () => {
    const eventsDir = fs.mkdtempSync(path.join(os.tmpdir(), "bim-review-coordinator-eventlog-"));
    const sessionId = "review_session_eventlog_migrate";
    const legacyFile = path.join(eventsDir, `${sessionId}.json`);
    const jsonlFile = path.join(eventsDir, `${sessionId}.jsonl`);

    const legacyEvent = {
      event_id: "legacy_001",
      session_id: sessionId,
      type: "legacyHighlight",
      payload: { source: "legacy_seed" },
      created_at: "2026-04-29T10:00:00.000Z",
    };
    fs.writeFileSync(legacyFile, JSON.stringify({ items: [legacyEvent] }, null, 2), "utf8");

    const log = new EventLog(eventsDir);
    expect(log.list(sessionId).map((item) => item.event_id)).toEqual(["legacy_001"]);
    expect(fs.existsSync(jsonlFile)).toBe(false);

    log.append(sessionId, "highlightRequest", { issue_id: "ISSUE-DEMO-002" });

    expect(fs.existsSync(jsonlFile)).toBe(true);
    const merged = log.list(sessionId);
    expect(merged.map((item) => item.event_id)).toContain("legacy_001");
    expect(merged.some((item) => item.type === "highlightRequest")).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // isSessionMutable edge cases
  // ---------------------------------------------------------------------------

  it("rejects join via HTTP on a closed session with 409", async () => {
    const app = makeApp();
    const created = await request(app.app)
      .post("/api/review-sessions")
      .send({
        project_id: "project_demo_001",
        model_version_id: "version_demo_001",
        created_by: "dev_user_001",
      });
    await request(app.app).post(`/api/review-sessions/${created.body.session_id}/close`).send({});

    const joined = await request(app.app)
      .post(`/api/review-sessions/${created.body.session_id}/join`)
      .send({ user_id: "late_user", display_name: "Late User" });

    expect(joined.status).toBe(409);
    expect(joined.body.detail).toBe("Review session is not active.");
  });

  it("close is idempotent for already-closed sessions", async () => {
    const app = makeApp();
    const created = await request(app.app)
      .post("/api/review-sessions")
      .send({
        project_id: "project_demo_001",
        model_version_id: "version_demo_001",
        created_by: "dev_user_001",
      });
    await request(app.app).post(`/api/review-sessions/${created.body.session_id}/close`).send({});

    const secondClose = await request(app.app)
      .post(`/api/review-sessions/${created.body.session_id}/close`)
      .send({});

    expect(secondClose.status).toBe(200);
    expect(secondClose.body.status).toBe("closed");
  });

  it("logs sessionCreated event with review_request_id when provided", async () => {
    const app = makeApp();
    const created = await request(app.app)
      .post("/api/review-sessions")
      .send({
        review_request_id: "review_request_events_test",
        project_id: "project_demo_001",
        model_version_id: "version_demo_001",
        created_by: "dev_user_001",
      });

    expect(created.status).toBe(200);
    const events = await request(app.app).get(`/api/review-sessions/${created.body.session_id}/events`);
    expect(events.status).toBe(200);
    const createdEvent = events.body.items.find((item: { type: string }) => item.type === "sessionCreated");
    expect(createdEvent).toBeDefined();
    expect(createdEvent.payload?.review_request_id).toBe("review_request_events_test");
  });

  it("logs sessionActive event when kit instance bindings are allocated", async () => {
    const app = makeApp();
    const created = await request(app.app)
      .post("/api/review-sessions")
      .send({
        project_id: "project_demo_001",
        model_version_id: "version_demo_001",
        created_by: "dev_user_001",
        artifact_bindings: [
          {
            artifact_group_id: "ag_test_active",
            artifact_id: "artifact_usdc_test_001",
            artifact_role: "derived",
            url: "edge-local://artifacts/model.usdc",
            load_order: 0,
            ready_status: "ready",
          },
        ],
      });

    expect(created.status).toBe(200);
    expect(created.body.status).toBe("active");
    const events = await request(app.app).get(`/api/review-sessions/${created.body.session_id}/events`);
    const types = events.body.items.map((item: { type: string }) => item.type);
    expect(types).toContain("sessionActive");
  });

  it("does not log sessionActive event when no kit bindings are allocated", async () => {
    // kit_profile with capacity_slots 0 → no bindings → 409 before session creation
    // Instead test with auto_allocate_kit false, which skips the 409 check
    const app = makeApp();
    const created = await request(app.app)
      .post("/api/review-sessions")
      .send({
        project_id: "project_demo_001",
        model_version_id: "version_demo_001",
        created_by: "dev_user_001",
        options: { auto_allocate_kit: false },
        kit_profile: { capacity_slots: 0 },
      });

    // When capacity is 0 and auto_allocate_kit is false, session is created with "created" status
    expect(created.status).toBe(200);
    expect(created.body.status).toBe("created");
    const events = await request(app.app).get(`/api/review-sessions/${created.body.session_id}/events`);
    const types = events.body.items.map((item: { type: string }) => item.type);
    expect(types).not.toContain("sessionActive");
  });

  // ---------------------------------------------------------------------------
  // kitPool: allocateKitInstanceBindings, markKitBindingsDraining, releaseKitBindings
  // ---------------------------------------------------------------------------

  it("allocates shared Kit instance with custom profile from kit_profile", async () => {
    const app = makeApp();
    const created = await request(app.app)
      .post("/api/review-sessions")
      .send({
        project_id: "project_demo_001",
        model_version_id: "version_demo_001",
        created_by: "dev_user_001",
        kit_profile: { profile: "gpu_large" },
        artifact_bindings: [
          {
            artifact_group_id: "ag_profile_test",
            artifact_id: "artifact_usdc_profile_test",
            artifact_role: "derived",
            url: "edge-local://artifacts/model.usdc",
            load_order: 0,
            ready_status: "ready",
          },
        ],
      });

    expect(created.status).toBe(200);
    expect(created.body.kit_instance_bindings).toHaveLength(1);
    expect(created.body.kit_instance_bindings[0].gpu_profile.profile).toBe("gpu_large");
  });

  it("released bindings stay released when markKitBindingsDraining is called after close", async () => {
    const app = makeApp();
    const created = await request(app.app)
      .post("/api/review-sessions")
      .send({
        project_id: "project_demo_001",
        model_version_id: "version_demo_001",
        created_by: "dev_user_001",
        artifact_bindings: [
          {
            artifact_group_id: "ag_drain_test",
            artifact_id: "artifact_usdc_drain_test",
            artifact_role: "derived",
            url: "edge-local://artifacts/model.usdc",
            load_order: 0,
            ready_status: "ready",
          },
        ],
      });

    const closed = await request(app.app)
      .post(`/api/review-sessions/${created.body.session_id}/close`)
      .send({});

    // All bindings must be released after close
    expect(closed.body.kit_instance_bindings.every((b: { status: string }) => b.status === "released")).toBe(true);
    // released_at must be set
    expect(closed.body.kit_instance_bindings.every((b: { released_at: string | null }) => b.released_at !== null)).toBe(true);
  });

  it("close stores final_events in the event log", async () => {
    const app = makeApp();
    const created = await request(app.app)
      .post("/api/review-sessions")
      .send({
        project_id: "project_demo_001",
        model_version_id: "version_demo_001",
        created_by: "dev_user_001",
      });

    const finalEvent = { type: "annotationFinal", count: 3 };
    await request(app.app)
      .post(`/api/review-sessions/${created.body.session_id}/close`)
      .send({ final_events: [finalEvent] });

    const events = await request(app.app).get(`/api/review-sessions/${created.body.session_id}/events`);
    expect(events.body.items.some((item: { type: string }) => item.type === "finalReviewEvent")).toBe(true);
    expect(events.body.items.some((item: { type: string }) => item.type === "sessionClosing")).toBe(true);
    expect(events.body.items.some((item: { type: string }) => item.type === "sessionClosed")).toBe(true);
    expect(events.body.items.some((item: { type: string }) => item.type === "kitInstanceReleased")).toBe(true);
  });

  it("close threads reason/actor into sessionClosing and sessionClosed audit payloads", async () => {
    const app = makeApp();
    const created = await request(app.app)
      .post("/api/review-sessions")
      .send({ project_id: "271", model_version_id: "mv_terminate_audit", artifact_bindings: [] });
    expect(created.status).toBe(200);
    const sessionId = created.body.session_id;

    const closed = await request(app.app)
      .post(`/api/review-sessions/${sessionId}/close`)
      .set("X-Operator", "alice@lan")
      .send({ reason: "operator terminate via #sessions" });
    expect(closed.status).toBe(200);
    expect(closed.body.status).toBe("closed");
    // reason 不外溢回傳 body（形狀不退化）
    expect(closed.body.reason).toBeUndefined();

    const events = await request(app.app).get(`/api/review-sessions/${sessionId}/events`);
    const closing = events.body.items.find((e: { type: string }) => e.type === "sessionClosing");
    const closedEvt = events.body.items.find((e: { type: string }) => e.type === "sessionClosed");
    expect(closing.payload.reason).toBe("operator terminate via #sessions");
    expect(closing.payload.actor).toBe("alice@lan");
    expect(closedEvt.payload.reason).toBe("operator terminate via #sessions");
    expect(closedEvt.payload.actor).toBe("alice@lan");
  });

  it("close without reason leaves cooperative behavior unchanged (reason absent, release intact)", async () => {
    const app = makeApp();
    const created = await request(app.app)
      .post("/api/review-sessions")
      .send({ project_id: "271", model_version_id: "mv_no_reason", artifact_bindings: [] });
    const sessionId = created.body.session_id;
    const closed = await request(app.app)
      .post(`/api/review-sessions/${sessionId}/close`)
      .send({ final_events: [{ type: "annotationSnapshot", count: 1 }] });
    expect(closed.status).toBe(200);
    expect(closed.body.status).toBe("closed");
    expect(closed.body.kit_instance_bindings.every((b: { status: string }) => b.status === "released")).toBe(true);
    const events = await request(app.app).get(`/api/review-sessions/${sessionId}/events`);
    const closing = events.body.items.find((e: { type: string }) => e.type === "sessionClosing");
    const closedEvt = events.body.items.find((e: { type: string }) => e.type === "sessionClosed");
    // 回歸鎖（spec §2.1/§3/§6.1）：無 reason 的 cooperative close payload 形狀零退化——
    // sessionClosing 維持 { final_events }、sessionClosed 維持 {}；reason/actor 缺省 undefined（非 ""），
    // additive 欄不污染既有 cooperative 呼叫端。
    expect(closing.payload.final_events).toBe(1);             // final_events 計數照常
    expect(closing.payload.reason).toBeUndefined();           // 無 reason → 不寫該欄
    expect(closing.payload.actor).toBeUndefined();            // 無 reason → 不寫 actor（不退化形狀）
    expect(closedEvt.payload.reason).toBeUndefined();         // 無 reason → 不寫該欄
    expect(closedEvt.payload.actor).toBeUndefined();          // 無 reason → 不寫 actor
    const finalReview = events.body.items.find((e: { type: string }) => e.type === "finalReviewEvent");
    expect(finalReview).toBeTruthy();                          // final_events 路徑零退化
  });

  it("close with empty-string reason does not pollute cooperative close payload (no actor leak)", async () => {
    // IMPORTANT-1 回歸鎖：caller 送 { reason: "" } 時，空字串為 falsy 但 typeof === "string"，
    // 若用 `reason !== undefined` 判斷會讓 auditFields 帶入 actor，違反 §2.1/§3「cooperative close
    // payload 形狀零退化」。空 reason 視同無 reason → sessionClosing/sessionClosed 不得帶 actor。
    const app = makeApp();
    const created = await request(app.app)
      .post("/api/review-sessions")
      .send({ project_id: "271", model_version_id: "mv_empty_reason", artifact_bindings: [] });
    const sessionId = created.body.session_id;
    const closed = await request(app.app)
      .post(`/api/review-sessions/${sessionId}/close`)
      .set("X-Operator", "alice@lan")
      .send({ reason: "" });
    expect(closed.status).toBe(200);
    expect(closed.body.status).toBe("closed");
    const events = await request(app.app).get(`/api/review-sessions/${sessionId}/events`);
    const closing = events.body.items.find((e: { type: string }) => e.type === "sessionClosing");
    const closedEvt = events.body.items.find((e: { type: string }) => e.type === "sessionClosed");
    expect(closing.payload.reason).toBeUndefined();           // 空 reason → 不寫該欄
    expect(closing.payload.actor).toBeUndefined();            // 空 reason → 不得洩漏 actor
    expect(closedEvt.payload.reason).toBeUndefined();
    expect(closedEvt.payload.actor).toBeUndefined();
  });

  it("close rejects caller IP not in allowlist with 403 (before id/state checks)", async () => {
    // IMPORTANT-2 回歸鎖：close 改造為「模式 3 operator terminate」後，control-plane mutation
    // surface 不得匿名寫入，須與 prioritize/retry/watch 三條路由一致補 rejectIfIpNotAllowed 守門。
    // supertest 走 loopback，故把 allowlist 設成排除 loopback 的網段 → 預期 403（在 id 驗證之前先擋）。
    const app = makeApp({ externalIntakeIpAllowlist: ["10.0.0.0/8"] });
    const res = await request(app.app)
      .post("/api/review-sessions/review_session_anything/close")
      .send({ reason: "operator terminate" });
    expect(res.status).toBe(403);
  });

  it("close with empty allowlist bypasses IP guard (consistent with IntranetDevAuthProvider length>0)", async () => {
    // 空 allowlist 代表「未啟用 IP 守門」→ bypass，而非全 403。傳空 allowlist + 不存在 session →
    // 預期非 403（落到 404 找不到 session），與 prioritize/retry 的空 allowlist 行為對稱。
    const app = makeApp({ externalIntakeIpAllowlist: [] });
    const res = await request(app.app)
      .post("/api/review-sessions/review_session_nope/close")
      .send({ reason: "operator terminate" });
    expect(res.status).not.toBe(403);
    expect(res.status).toBe(404);
  });

  it("returns lifecycle audit events with stable sequence and excludes generic events", async () => {
    const app = makeApp();
    const created = await request(app.app)
      .post("/api/review-sessions")
      .send({
        review_request_id: "review_request_lifecycle_audit",
        project_id: "project_demo_001",
        model_version_id: "version_demo_001",
        created_by: "dev_user_001",
      });

    await request(app.app)
      .post(`/api/review-sessions/${created.body.session_id}/events`)
      .send({ type: "highlightRequest", issue_id: "ISSUE-DEMO-001" });
    await request(app.app)
      .post(`/api/review-sessions/${created.body.session_id}/close`)
      .send({ final_events: [{ type: "annotationSnapshot", count: 1 }] });

    const lifecycle = await request(app.app).get(`/api/review-sessions/${created.body.session_id}/lifecycle-events`);
    expect(lifecycle.status).toBe(200);
    const items = lifecycle.body.items as Array<{
      event_id: string;
      session_id: string;
      type: string;
      sequence: number;
      created_at: string;
      payload: Record<string, unknown>;
    }>;
    const types = items.map((item) => item.type);
    expect(types).toEqual(["sessionCreated", "sessionActive", "sessionClosing", "sessionClosed", "kitInstanceReleased"]);
    expect(types).not.toContain("highlightRequest");
    expect(types).not.toContain("finalReviewEvent");
    expect(items.map((item) => item.sequence)).toEqual([1, 2, 4, 6, 7]);
    expect(items.every((item) => item.event_id && item.session_id === created.body.session_id && item.created_at)).toBe(true);
    expect(items[0].payload.review_request_id).toBe("review_request_lifecycle_audit");
    expect(items.at(-1)?.payload.kit_instance_bindings).toEqual(["kit_local_001"]);

    const generic = await request(app.app).get(`/api/review-sessions/${created.body.session_id}/events`);
    const genericTypes = generic.body.items.map((item: { type: string }) => item.type);
    expect(genericTypes).toContain("highlightRequest");
    expect(genericTypes).toContain("finalReviewEvent");
  });

  it("uses existing validation behavior for lifecycle event endpoint", async () => {
    const app = makeApp();

    const invalid = await request(app.app).get("/api/review-sessions/..%2Fsecrets/lifecycle-events");
    expect(invalid.status).toBe(400);

    const missing = await request(app.app).get("/api/review-sessions/review_session_missing/lifecycle-events");
    expect(missing.status).toBe(404);
  });

  // ---------------------------------------------------------------------------
  // sessionStore: isSessionMutable + session status transitions
  // ---------------------------------------------------------------------------

  it("session created without kit bindings has status created not active", async () => {
    const app = makeApp();
    const created = await request(app.app)
      .post("/api/review-sessions")
      .send({
        project_id: "project_demo_001",
        model_version_id: "version_demo_001",
        created_by: "dev_user_001",
        options: { auto_allocate_kit: false },
        kit_profile: { capacity_slots: 0 },
      });

    expect(created.status).toBe(200);
    expect(created.body.status).toBe("created");
    expect(created.body.kit_instance_bindings).toHaveLength(0);
  });

  it("stream config returns artifact bindings and kit instance bindings from session", async () => {
    const app = makeApp();
    const created = await request(app.app)
      .post("/api/review-sessions")
      .send({
        project_id: "project_demo_001",
        model_version_id: "version_demo_001",
        created_by: "dev_user_001",
        routing_policy: "same_instance",
        artifact_bindings: [
          {
            artifact_group_id: "ag_stream_test",
            artifact_id: "artifact_usdc_stream",
            artifact_role: "derived",
            url: "edge-local://artifacts/stream.usdc",
            mapping_url: "edge-local://artifacts/element_mapping.json",
            load_order: 0,
            ready_status: "ready",
          },
        ],
      });

    expect(created.status).toBe(200);
    const config = await request(app.app).get(`/api/review-sessions/${created.body.session_id}/stream-config`);
    expect(config.status).toBe(200);
    expect(config.body.lifecycle_status).toBe("active");
    expect(config.body.model.url).toBe("edge-local://artifacts/stream.usdc");
    expect(config.body.model.mapping_url).toContain("element_mapping.json");
    expect(config.body.kit_instance_bindings).toHaveLength(1);
  });

  it("get session returns 400 for invalid session id", async () => {
    const app = makeApp();

    const response = await request(app.app).get("/api/review-sessions/invalid-session-format");

    expect(response.status).toBe(400);
    expect(response.body.detail).toBe("Invalid review session id.");
  });

  it("get session returns 404 for missing session", async () => {
    const app = makeApp();

    const response = await request(app.app).get("/api/review-sessions/review_session_missing");

    expect(response.status).toBe(404);
    expect(response.body.detail).toBe("Review session not found.");
  });

  it("stream config returns 404 for missing session", async () => {
    const app = makeApp();

    const response = await request(app.app).get("/api/review-sessions/review_session_missing/stream-config");

    expect(response.status).toBe(404);
  });

  it("close returns 400 for invalid session id format", async () => {
    const app = makeApp();

    const response = await request(app.app)
      .post("/api/review-sessions/bad-format/close")
      .send({});

    expect(response.status).toBe(400);
    expect(response.body.detail).toBe("Invalid review session id.");
  });

  it("close returns 404 for unknown session id", async () => {
    const app = makeApp();

    const response = await request(app.app)
      .post("/api/review-sessions/review_session_unknownclose/close")
      .send({});

    expect(response.status).toBe(404);
    expect(response.body.detail).toBe("Review session not found.");
  });
});
