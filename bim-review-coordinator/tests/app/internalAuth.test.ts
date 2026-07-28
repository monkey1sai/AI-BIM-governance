import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";

import { createCoordinatorApp, type CoordinatorApp } from "../../src/app.js";

// Internal API auth boundary (cross-service-structured-log-baseline): health
// keeps the existing internal token. Viewer-log uses its narrower active lease
// authority and must not fall through to an unauthenticated allowlist.
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
      await app.dispose();
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

  it("rejects /api/internal/viewer-log without active lease headers", async () => {
    const response = await request(app!.app)
      .post("/api/internal/viewer-log")
      .send([]);
    expect(response.status).toBe(401);
    expect(response.body).toEqual({ detail: "missing or invalid viewer lease" });
  });

  it("requires the internal token for GET /api/internal/structLog/health", async () => {
    const response = await request(app!.app).get("/api/internal/structLog/health");
    expect(response.status).toBe(401);
    expect(response.body).toEqual({ detail: "missing or invalid internal API token" });

    const authorized = await request(app!.app)
      .get("/api/internal/structLog/health")
      .set("X-Internal-Token", INTERNAL_TOKEN);
    expect(authorized.status).toBe(200);
  });
});
