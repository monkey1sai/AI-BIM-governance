import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import request from "supertest";
import { io as createSocketClient, type Socket as SocketClient } from "socket.io-client";
import { afterEach, describe, expect, it } from "vitest";
import { createCoordinatorApp, type CoordinatorApp } from "../src/app.js";
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

function makeApp(): CoordinatorApp {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bim-review-coordinator-test-"));
  activeRoot = root;
  active = createCoordinatorApp({
    sessionStoreDir: path.join(root, "sessions"),
    eventLogDir: path.join(root, "events"),
    bimControlApiBase: "http://127.0.0.1:1",
    corsOrigins: ["http://127.0.0.1:5173"],
  });
  return active;
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

  it("rejects socket session operations when the session id is missing, invalid, or unknown", async () => {
    const app = makeApp();
    const client = await connectReviewSocket(await listen(app));

    const missingHighlight = await emitWithAck<{ ok: boolean; error?: string }>(client, "highlightRequest", {
      user_id: "dev_user_001",
    });
    expect(missingHighlight).toEqual({ ok: false, error: "Missing session_id" });

    const invalidSelection = await emitWithAck<{ ok: boolean; error?: string }>(client, "selectionUpdate", {
      session_id: "..\\secrets",
      user_id: "dev_user_001",
    });
    expect(invalidSelection).toEqual({ ok: false, error: "Invalid review session id." });

    const missingJoin = await emitWithAck<{ ok: boolean; error?: string }>(client, "joinSession", {
      session_id: "review_session_missing",
      user_id: "dev_user_001",
    });
    expect(missingJoin).toEqual({ ok: false, error: "Review session not found." });

    const missingHighlightSession = await emitWithAck<{ ok: boolean; error?: string }>(client, "highlightRequest", {
      session_id: "review_session_missing",
      user_id: "dev_user_001",
    });
    expect(missingHighlightSession).toEqual({ ok: false, error: "Review session not found." });
    expect(fs.existsSync(path.join(activeRoot as string, "events", "review_session_missing.jsonl"))).toBe(false);
  });

  it("rejects socket annotation persistence for unknown sessions before calling downstream APIs", async () => {
    const app = makeApp();
    const client = await connectReviewSocket(await listen(app));

    const response = await emitWithAck<{ ok: boolean; error?: string }>(client, "annotationCreate", {
      session_id: "review_session_missing",
      user_id: "dev_user_001",
      text: "檢查消防區劃",
    });

    expect(response).toEqual({ ok: false, error: "Review session not found." });
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
});
