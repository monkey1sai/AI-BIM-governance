import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { createCoordinatorApp, type CoordinatorApp } from "../src/app.js";

let active: CoordinatorApp | null = null;

afterEach(async () => {
  if (active) {
    active.io.close();
    await new Promise<void>((resolve) => active?.server.close(() => resolve()));
    active = null;
  }
});

function makeApp(): CoordinatorApp {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bim-review-coordinator-test-"));
  active = createCoordinatorApp({
    sessionStoreDir: path.join(root, "sessions"),
    eventLogDir: path.join(root, "events"),
    bimControlApiBase: "http://127.0.0.1:1",
    corsOrigins: ["http://127.0.0.1:5173"],
  });
  return active;
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

    const events = await request(app.app).get(`/api/review-sessions/${created.body.session_id}/events`);
    expect(events.status).toBe(200);
    expect(events.body.items.some((item: { type: string }) => item.type === "highlightRequest")).toBe(true);
  });
});
