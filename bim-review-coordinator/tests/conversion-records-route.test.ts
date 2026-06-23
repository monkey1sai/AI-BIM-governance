// bim-review-coordinator/tests/conversion-records-route.test.ts
import { describe, it, expect, afterEach } from "vitest";
import request from "supertest";
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import { createCoordinatorApp, type CoordinatorApp } from "../src/app.js";

let active: CoordinatorApp | null = null; let root: string | null = null;
function makeApp() {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "conv-records-"));
  active = createCoordinatorApp({
    sessionStoreDir: path.join(root, "sessions"), eventLogDir: path.join(root, "events"),
    callbackOutboxStorePath: path.join(root, "callback-outbox.json"),
    conversionLedgerStorePath: path.join(root, "conversion-ledger.json"),
    corsOrigins: ["http://127.0.0.1:5173"], conversionPollEnabled: false,
  });
  return active;
}
afterEach(async () => {
  if (active) { await active.dispose(); active.io.close();
    await new Promise<void>((r) => active?.server.close(() => r())); active = null; }
  if (root) { fs.rmSync(root, { recursive: true, force: true }); root = null; }
});

describe("GET /api/conversion/records", () => {
  it("空 ledger 回 count=0 items=[]", async () => {
    const res = await request(makeApp().app).get("/api/conversion/records");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ count: 0, items: [] });
  });
});
