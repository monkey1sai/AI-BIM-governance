// model-file-session-lifecycle-contract §4.3：purge 已結束 session 的 coordinator 本地紀錄。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { createCoordinatorApp, type CoordinatorApp } from "../src/app.js";
import type { CoordinatorConfig } from "../src/config.js";

let active: CoordinatorApp | null = null;
let root: string | null = null;
function makeApp(overrides: Partial<CoordinatorConfig> = {}): CoordinatorApp {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "session-purge-route-"));
  active = createCoordinatorApp({
    sessionStoreDir: path.join(root, "sessions"), eventLogDir: path.join(root, "events"),
    callbackOutboxStorePath: path.join(root, "callback-outbox.json"),
    corsOrigins: ["http://127.0.0.1:5173"], conversionPollEnabled: false, ...overrides,
  });
  return active;
}
afterEach(async () => {
  if (active) { await active.dispose(); active.io.close(); await new Promise<void>((r) => active?.server.close(() => r())); active = null; }
  if (root) { fs.rmSync(root, { recursive: true, force: true }); root = null; }
});
async function createSession(app: CoordinatorApp, suffix: string): Promise<string> {
  const created = await request(app.app).post("/api/review-sessions").send({ project_id: `project_${suffix}`, model_version_id: `model_${suffix}` });
  expect(created.status).toBe(200);
  return created.body.session_id as string;
}
async function closeSession(app: CoordinatorApp, sessionId: string): Promise<void> {
  const closed = await request(app.app).post(`/api/review-sessions/${sessionId}/close`).send({ reason: "test fixture" });
  expect(closed.status).toBe(200);
}

describe("DELETE /api/review-sessions/:sessionId (purge)", () => {
  it("removes the session file and event log of a closed session; the id is gone everywhere afterwards", async () => {
    const app = makeApp();
    const sessionId = await createSession(app, "a");
    await closeSession(app, sessionId);
    const sessionFile = path.join(root as string, "sessions", `${sessionId}.json`);
    const eventsFile = path.join(root as string, "events", `${sessionId}.jsonl`);
    expect(fs.existsSync(sessionFile)).toBe(true);
    expect(fs.existsSync(eventsFile)).toBe(true);

    const purged = await request(app.app).delete(`/api/review-sessions/${sessionId}?reason=stale_cleanup`);
    expect(purged.status).toBe(200);
    expect(purged.body).toMatchObject({ session_id: sessionId, status: "purged", removed: { session_file: true, events_file: true } });
    expect(purged.body.purged_at).toEqual(expect.any(String));
    expect(fs.existsSync(sessionFile)).toBe(false);
    expect(fs.existsSync(eventsFile)).toBe(false);

    expect((await request(app.app).get(`/api/review-sessions/${sessionId}`)).status).toBe(404);
    const runtime = await request(app.app).get("/api/runtime/status");
    expect(runtime.body.sessions.items.map((item: { session_id: string }) => item.session_id)).not.toContain(sessionId);
    const archive = await request(app.app).get("/api/review-sessions?status=closed");
    expect(archive.body.items.map((item: { session_id: string }) => item.session_id)).not.toContain(sessionId);
    const again = await request(app.app).delete(`/api/review-sessions/${sessionId}`);
    expect(again.status).toBe(404);
    expect(again.body).toEqual({ error_code: "review_session_not_found" });
  });

  it("refuses a session that is not closed or failed with 409 review_session_not_closed", async () => {
    const app = makeApp();
    const sessionId = await createSession(app, "b");
    const refused = await request(app.app).delete(`/api/review-sessions/${sessionId}`);
    expect(refused.status).toBe(409);
    expect(refused.body.error_code).toBe("review_session_not_closed");
    expect(["created", "active"]).toContain(refused.body.status);
    expect((await request(app.app).get(`/api/review-sessions/${sessionId}`)).status).toBe(200);
  });

  it("400 on an unsafe id and 404 on an unknown id", async () => {
    const app = makeApp();
    expect((await request(app.app).delete("/api/review-sessions/not%20a%20session")).status).toBe(400);
    const unknown = await request(app.app).delete("/api/review-sessions/review_session_000000000000");
    expect(unknown.status).toBe(404);
    expect(unknown.body).toEqual({ error_code: "review_session_not_found" });
  });

  it("403 when the conversion-control guard rejects the caller", async () => {
    const app = makeApp({ conversionTriggerIpAllowlist: ["10.99.0.1"], devAuthToken: "dev-token" });
    const sessionId = await createSession(app, "c");
    await closeSession(app, sessionId);
    const refused = await request(app.app).delete(`/api/review-sessions/${sessionId}`);
    expect(refused.status).toBe(403);
    expect(fs.existsSync(path.join(root as string, "sessions", `${sessionId}.json`))).toBe(true);
  });
});
