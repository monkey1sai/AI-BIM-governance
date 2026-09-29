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
// R10：claiming a viewer lease needs an allocated Kit instance binding, which needs both Kit endpoint
// config on the app and an artifact binding on session-create. Shape copied from the working
// tests/viewer-leases.test.ts makeApp()/createSession() (kitMediaPort + kitInstanceEndpoints, a single
// "derived"/"ready" artifact binding) rather than the bare overrides/createSession above, which don't
// allocate Kit capacity and would make .../viewer-leases/claim fail with no_stream_endpoint_available.
const KIT_INSTANCE_ENDPOINTS_OVERRIDE: Partial<CoordinatorConfig> = {
  kitMediaPort: 47998,
  kitInstanceEndpoints: [
    { id: "kit_local_001", signalingServer: "127.0.0.1", signalingPort: 49100, mediaServer: "127.0.0.1", mediaPort: 47998 },
    { id: "kit_local_002", signalingServer: "127.0.0.1", signalingPort: 49110, mediaServer: "127.0.0.1", mediaPort: 48008 },
  ],
};
async function createSessionWithKitBinding(app: CoordinatorApp, suffix: string): Promise<string> {
  const created = await request(app.app).post("/api/review-sessions").send({
    project_id: `project_${suffix}`, model_version_id: `model_${suffix}`,
    artifact_bindings: [{
      artifact_group_id: `ag_${suffix}`, artifact_id: `auto_usdc_${suffix}`, artifact_role: "derived",
      url: `http://127.0.0.1:49101/artifacts/${suffix}/model.usdc`,
      mapping_url: `http://127.0.0.1:49101/artifacts/${suffix}/element_mapping.json`,
      load_order: 0, ready_status: "ready", conversion_authority: "bim-streaming-server",
      conversion_job_id: suffix, conversion_status: "ready",
    }],
  });
  expect(created.status).toBe(200);
  return created.body.session_id as string;
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

  it("purges viewer-lease rows and idle-reclaim state keyed by the session id (R10)", async () => {
    const app = makeApp(KIT_INSTANCE_ENDPOINTS_OVERRIDE);
    const sessionId = await createSessionWithKitBinding(app, "leasepurge");
    const claim = await request(app.app)
      .post(`/api/review-sessions/${sessionId}/viewer-leases/claim`)
      .set("X-User-Token", "user_leasepurge")
      .send({
        viewer_id: "viewer_leasepurge", user_id: "user_leasepurge", display_name: "Viewer Leasepurge",
        requested_role: "primary", client_nonce: `${sessionId}:leasepurge:primary`,
      });
    expect(claim.status).toBe(200);

    await closeSession(app, sessionId);
    // close() already releases the active lease to "released" but does not delete the row (see
    // viewerLeaseStore.releaseSession). Pinning it non-empty here proves the post-purge "[]" assertion
    // below is not vacuously true — there was a real row for purge to remove.
    expect(app.viewerLeaseStore.list(sessionId).length).toBeGreaterThan(0);

    const purged = await request(app.app).delete(`/api/review-sessions/${sessionId}`);
    expect(purged.status).toBe(200);
    expect(app.viewerLeaseStore.list(sessionId)).toEqual([]);
    expect(app.idleReclaimService.getSessionState(sessionId)).toBeNull();
  });

  it("defaults to reason=manual when the query parameter is omitted (still 200)", async () => {
    const app = makeApp();
    const sessionId = await createSession(app, "noreason");
    await closeSession(app, sessionId);
    const purged = await request(app.app).delete(`/api/review-sessions/${sessionId}`);
    expect(purged.status).toBe(200);
    expect(purged.body).toMatchObject({ session_id: sessionId, status: "purged" });
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
