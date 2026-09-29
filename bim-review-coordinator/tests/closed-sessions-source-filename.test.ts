// model-file-session-lifecycle-contract §4.2：已關閉清單帶檔名（推導同 §3.2）。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCoordinatorApp, type CoordinatorApp } from "../src/app.js";

let active: CoordinatorApp | null = null;
let root: string | null = null;
function makeApp(): CoordinatorApp {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "closed-filename-"));
  active = createCoordinatorApp({
    sessionStoreDir: path.join(root, "sessions"), eventLogDir: path.join(root, "events"),
    callbackOutboxStorePath: path.join(root, "callback-outbox.json"),
    corsOrigins: ["http://127.0.0.1:5173"], conversionPollEnabled: false,
  });
  return active;
}
afterEach(async () => {
  vi.restoreAllMocks();
  if (active) { await active.dispose(); active.io.close(); await new Promise<void>((r) => active?.server.close(() => r())); active = null; }
  if (root) { fs.rmSync(root, { recursive: true, force: true }); root = null; }
});
async function closedSession(app: CoordinatorApp, suffix: string, filename: string | null): Promise<string> {
  const created = await request(app.app).post("/api/review-sessions").send({
    project_id: `project_${suffix}`, model_version_id: `model_${suffix}`,
    artifact_bindings: [{ artifact_group_id: `group_${suffix}`, artifact_id: `artifact_${suffix}`, artifact_role: "derived",
      url: `http://127.0.0.1:49101/artifacts/${suffix}/model.usdc`, mapping_url: null, load_order: 0, ready_status: "ready",
      conversion_authority: "bim-streaming-server", source_ifc_filename: filename }],
  });
  expect(created.status).toBe(200);
  const closed = await request(app.app).post(`/api/review-sessions/${created.body.session_id}/close`).send({ reason: "test fixture" });
  expect(closed.status).toBe(200);
  return created.body.session_id as string;
}

describe("GET /api/review-sessions?status=closed source_ifc_filename", () => {
  it("returns the binding filename, and null when nothing is known", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 200 }));
    const app = makeApp();
    const named = await closedSession(app, "named", "villa.ifc");
    const anonymous = await closedSession(app, "anon", null);
    const res = await request(app.app).get("/api/review-sessions?status=closed");
    expect(res.status).toBe(200);
    const byId = new Map(res.body.items.map((item: { session_id: string; source_ifc_filename: string | null }) => [item.session_id, item.source_ifc_filename]));
    expect(byId.get(named)).toBe("villa.ifc");
    expect(byId.get(anonymous)).toBeNull();
  });
});
