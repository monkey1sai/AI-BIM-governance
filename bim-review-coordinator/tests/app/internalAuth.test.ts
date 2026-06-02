import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";

import { createCoordinatorApp, type CoordinatorApp } from "../../src/app.js";

// Internal API auth boundary (cross-service-structured-log-baseline): every
// `/api/internal/*` route requires a valid internal token EXCEPT the two
// intentionally-open paths (`/viewer-log`, `/structLog/health`). These tests
// pin that contract so the allowlist cannot silently widen and so the
// non-allowlisted routes cannot silently drop their token gate.
const INTERNAL_TOKEN = "test-internal-token-internalAuth";

describe("/api/internal auth boundary", () => {
  let app: CoordinatorApp | null = null;
  let storageRoot: string;
  let logRoot: string;

  beforeEach(() => {
    storageRoot = mkdtempSync(join(tmpdir(), "internalauth-storage-"));
    logRoot = mkdtempSync(join(tmpdir(), "internalauth-logs-"));
    app = createCoordinatorApp({
      sessionStoreDir: join(storageRoot, "sessions"),
      eventLogDir: join(storageRoot, "events"),
      callbackOutboxStorePath: join(storageRoot, "callback-outbox.json"),
      corsOrigins: ["http://127.0.0.1:5173"],
      logRoot,
      internalApiAuthToken: INTERNAL_TOKEN,
    });
  });

  afterEach(async () => {
    if (app) {
      app.io.close();
      await new Promise<void>((resolve) => app?.server.close(() => resolve()));
      app.dispose();
      app = null;
    }
    for (const root of [storageRoot, logRoot]) {
      try {
        rmSync(root, { recursive: true, force: true });
      } catch {
        // best effort
      }
    }
  });

  it("rejects a non-allowlisted internal route with 401 when no token is supplied", async () => {
    const response = await request(app!.app)
      .post("/api/internal/conversion-result")
      .send({});
    expect(response.status).toBe(401);
    expect(response.body).toMatchObject({ detail: "missing or invalid internal API token" });
  });

  it("passes the auth gate on a non-allowlisted route with a correct x-internal-token", async () => {
    const response = await request(app!.app)
      .post("/api/internal/conversion-result")
      .set("x-internal-token", INTERNAL_TOKEN)
      .send({});
    // The auth middleware must let this through; downstream body validation may
    // still reject the empty payload, but it must not be a 401.
    expect(response.status).not.toBe(401);
  });

  it("passes the auth gate on a non-allowlisted route with an Authorization: Bearer token", async () => {
    const response = await request(app!.app)
      .post("/api/internal/conversion-result")
      .set("Authorization", `Bearer ${INTERNAL_TOKEN}`)
      .send({});
    expect(response.status).not.toBe(401);
  });

  it("allows /api/internal/viewer-log without a token (intentional allowlist)", async () => {
    const response = await request(app!.app)
      .post("/api/internal/viewer-log")
      .send([]);
    expect(response.status).not.toBe(401);
  });

  it("allows GET /api/internal/structLog/health without a token (intentional allowlist)", async () => {
    const response = await request(app!.app).get("/api/internal/structLog/health");
    expect(response.status).toBe(200);
  });
});
