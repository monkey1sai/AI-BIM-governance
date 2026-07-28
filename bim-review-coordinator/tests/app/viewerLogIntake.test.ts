import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, readFileSync, readdirSync, rmSync, existsSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { request as nodeHttpRequest } from "node:http";
import request from "supertest";

import { createCoordinatorApp, type CoordinatorApp } from "../../src/app.js";
import type { LogRecord } from "../../src/lib/structLog.js";

const INTERNAL_TOKEN = "test-viewer-log-internal-token";

interface TestLease {
  lease_id: string;
  lease_token: string;
}

let currentCanonicalTraceId = "rev_viewer_log_uninitialized";

function baseRecord(overrides: Partial<LogRecord> = {}): LogRecord {
  return {
    ts: "2026-05-26T14:25:00.000Z",
    level: "info",
    event_type: "general",
    service: "viewer",
    component: "webrtcClient",
    run_id: "run_20260526_142455_d3e400",
    trace_id: currentCanonicalTraceId,
    msg: "viewer event",
    data: {},
    ...overrides,
  };
}

describe("POST /api/internal/viewer-log", () => {
  let app: CoordinatorApp | null = null;
  let storageRoot: string;
  let logRoot: string;
  let sessionId: string;
  let lease: TestLease;

  beforeEach(async () => {
    storageRoot = mkdtempSync(join(tmpdir(), "viewerlog-intake-storage-"));
    logRoot = mkdtempSync(join(tmpdir(), "viewerlog-intake-logs-"));
    app = createCoordinatorApp({
      sessionStoreDir: join(storageRoot, "sessions"),
      eventLogDir: join(storageRoot, "events"),
      callbackOutboxStorePath: join(storageRoot, "callback-outbox.json"),
      corsOrigins: ["http://127.0.0.1:5173"],
      logRoot,
      conversionPollEnabled: false,
      internalApiAuthToken: INTERNAL_TOKEN,
      kitInstanceEndpoints: [{
        id: "kit_viewer_log_001",
        signalingServer: "127.0.0.1",
        signalingPort: 49100,
        mediaServer: "127.0.0.1",
        mediaPort: 47998,
      }],
    });
    sessionId = await createSession("primary");
    currentCanonicalTraceId = `rev_${sessionId}`;
    lease = await claimLease(sessionId, "primary", "viewer-log-primary");
  });

  afterEach(async () => {
    vi.restoreAllMocks();
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

  function listViewerJsonl(): string[] {
    return listServiceJsonl("viewer");
  }

  function listServiceJsonl(service: string): string[] {
    const dir = join(logRoot, service);
    if (!existsSync(dir)) return [];
    const dates = readdirSync(dir);
    const files: string[] = [];
    for (const date of dates) {
      const datePath = join(dir, date);
      if (statSync(datePath).isDirectory()) {
        for (const f of readdirSync(datePath)) {
          if (f.endsWith(".jsonl")) files.push(join(datePath, f));
        }
      }
    }
    return files;
  }

  async function createSession(suffix: string): Promise<string> {
    const response = await request(app!.app)
      .post("/api/review-sessions")
      .send({
        project_id: `project_viewer_log_${suffix}`,
        model_version_id: `version_viewer_log_${suffix}`,
        created_by: "viewer_log_fixture",
        artifact_bindings: [{
          artifact_group_id: `group_${suffix}`,
          artifact_id: `artifact_${suffix}`,
          artifact_role: "derived",
          url: `http://127.0.0.1:49101/artifacts/${suffix}/model.usdc`,
          mapping_url: null,
          load_order: 0,
          ready_status: "ready",
        }],
      });
    expect(response.status).toBe(200);
    return response.body.session_id as string;
  }

  async function claimLease(
    targetSessionId: string,
    role: "primary" | "spectator",
    user: string,
  ): Promise<TestLease> {
    const response = await request(app!.app)
      .post(`/api/review-sessions/${targetSessionId}/viewer-leases/claim`)
      .set("X-User-Token", user)
      .send({
        viewer_id: `${role}_${user}`,
        requested_role: role,
        client_nonce: `${targetSessionId}:${role}:${user}`,
      });
    expect(response.status).toBe(200);
    return response.body as TestLease;
  }

  function viewerLogRequest(
    targetSessionId = sessionId,
    targetLease = lease,
  ) {
    return request(app!.app)
      .post("/api/internal/viewer-log")
      .set("X-Review-Session-Id", targetSessionId)
      .set("X-Viewer-Lease-Id", targetLease.lease_id)
      .set("X-Viewer-Lease-Token", targetLease.lease_token);
  }

  it("persists a batch of schema-valid records and returns accepted/dropped counts", async () => {
    const records = Array.from({ length: 10 }, (_, i) =>
      baseRecord({ msg: `viewer event ${i}`, data: { seq: i } }),
    );
    const response = await viewerLogRequest().send(records);
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ accepted: 10, dropped: 0 });

    const files = listViewerJsonl();
    expect(files).toHaveLength(1);
    const lines = readFileSync(files[0]!, "utf-8").trim().split("\n").filter(Boolean);
    expect(lines).toHaveLength(10);
    const parsed = lines.map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(parsed.every((r) => r.service === "viewer")).toBe(true);
  });

  it("drops malformed records, persists valid ones, and increments dropped counter", async () => {
    const valid = Array.from({ length: 8 }, (_, i) => baseRecord({ msg: `ok-${i}` }));
    const invalid: unknown[] = [
      { foo: "bar" }, // missing required fields
      baseRecord({ level: "verbose" as never }), // bad level
    ];
    const response = await viewerLogRequest().send([...valid, ...invalid]);
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ accepted: 8, dropped: 2 });

    const files = listViewerJsonl();
    const lines = files.length === 0
      ? []
      : readFileSync(files[0]!, "utf-8").trim().split("\n").filter(Boolean);
    expect(lines).toHaveLength(8);
  });

  it("rejects oversized body with 413", async () => {
    // 1 MB body, well over the 256 KiB limit
    const huge = "x".repeat(1024 * 1024);
    const response = await viewerLogRequest()
      .set("Content-Type", "application/json")
      .send([baseRecord({ msg: huge })]);
    expect(response.status).toBe(413);
  });

  it("rejects non-array body with 400", async () => {
    const response = await viewerLogRequest().send(baseRecord());
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ accepted: 0, dropped: 0 });
  });

  it("rejects too many records in a single batch with 413", async () => {
    const records = Array.from({ length: 600 }, (_, i) => baseRecord({ msg: `m-${i}` }));
    const response = await viewerLogRequest().send(records);
    expect(response.status).toBe(413);
  });

  it("accepts an active spectator lease without stealing primary authority", async () => {
    const spectator = await claimLease(sessionId, "spectator", "viewer-log-spectator");
    const response = await viewerLogRequest(sessionId, spectator).send([baseRecord()]);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ accepted: 1, dropped: 0 });
    const primaryResponse = await viewerLogRequest().send([baseRecord({ msg: "primary remains active" })]);
    expect(primaryResponse.status).toBe(200);
    expect(primaryResponse.body).toEqual({ accepted: 1, dropped: 0 });
  });

  it("rejects a canonical trace from another session and writes nothing", async () => {
    const otherSessionId = await createSession("trace-other");
    const response = await viewerLogRequest().send([
      baseRecord({ trace_id: `rev_${otherSessionId}` }),
    ]);
    expect(response.status).toBe(409);
    expect(response.body).toEqual({
      detail: "viewer log trace does not match authenticated session",
      accepted: 0,
      dropped: 1,
    });
    expect(listViewerJsonl()).toEqual([]);
  });

  it("rejects a mixed-trace batch atomically without persisting its valid prefix", async () => {
    const response = await viewerLogRequest().send([
      baseRecord({ msg: "valid prefix" }),
      baseRecord({ trace_id: "rev_review_session_spoofed", msg: "spoofed suffix" }),
    ]);
    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ accepted: 0, dropped: 2 });
    expect(listViewerJsonl()).toEqual([]);
  });

  it("does not backfill a legacy trace until an exact-trace record passes validation", async () => {
    const sessionFile = join(storageRoot, "sessions", `${sessionId}.json`);
    const legacy = JSON.parse(readFileSync(sessionFile, "utf-8")) as Record<string, unknown>;
    delete legacy.trace_id;
    writeFileSync(sessionFile, JSON.stringify(legacy, null, 2), "utf-8");
    const beforeMismatch = readFileSync(sessionFile, "utf-8");

    const mismatch = await viewerLogRequest().send([
      baseRecord({ trace_id: "rev_review_session_foreign", msg: "foreign legacy candidate" }),
    ]);
    expect(mismatch.status).toBe(409);
    expect(readFileSync(sessionFile, "utf-8")).toBe(beforeMismatch);
    expect(listViewerJsonl()).toEqual([]);

    const accepted = await viewerLogRequest().send([baseRecord({ msg: "exact legacy candidate" })]);
    expect(accepted.status).toBe(200);
    expect(accepted.body).toEqual({ accepted: 1, dropped: 0 });
    const backfilled = JSON.parse(readFileSync(sessionFile, "utf-8")) as Record<string, unknown>;
    expect(backfilled.trace_id).toBe(currentCanonicalTraceId);
    const files = listViewerJsonl();
    expect(files).toHaveLength(1);
    expect(readFileSync(files[0]!, "utf-8").trim().split("\n")).toHaveLength(1);
  });

  it("redacts nested secret-like data and drops unknown top-level fields before persistence", async () => {
    const sentinel = "viewer-log-secret-sentinel";
    const unknown = {
      ...baseRecord({ msg: "unknown field record" }),
      auth_token: sentinel,
    };
    const response = await viewerLogRequest().send([
      baseRecord({ data: { nested: { api_token: sentinel }, visible: "kept" } }),
      baseRecord({
        event_type: "env_snapshot",
        msg: "untrusted env snapshot",
        data: {
          vars: [{
            key: "API_TOKEN",
            source: "system",
            value_or_redacted: sentinel,
            type: "string",
          }],
        },
      }),
      unknown,
    ]);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ accepted: 2, dropped: 1 });
    const files = listViewerJsonl();
    expect(files).toHaveLength(1);
    const text = readFileSync(files[0]!, "utf-8");
    expect(text).not.toContain(sentinel);
    const persisted = text.trim().split("\n").map((line) => JSON.parse(line) as LogRecord);
    const ordinary = persisted.find((record) => record.event_type === "general");
    const envSnapshot = persisted.find((record) => record.event_type === "env_snapshot");
    expect(ordinary?.data).toEqual({ nested: { api_token: "[REDACTED]" }, visible: "kept" });
    expect(envSnapshot?.data).toEqual({
      vars: [{
        key: "API_TOKEN",
        source: "system",
        value_or_redacted: `[REDACTED:type=string, len=${sentinel.length}]`,
        type: "string",
      }],
    });
  });

  it("drops event-specific schema violations and query-bearing network paths without persistence", async () => {
    const querySentinel = "viewer-log-query-secret-sentinel";
    const invalidRecords: LogRecord[] = [
      baseRecord({ event_type: "logic_error", data: {} }),
      baseRecord({ event_type: "operation_anomaly", data: { anomaly_kind: "retry" } }),
      baseRecord({ event_type: "env_snapshot", data: {} }),
      baseRecord({ event_type: "lifecycle", data: { phase: "active", subject_kind: "review_session" } }),
      baseRecord({ event_type: "audit", data: { action: "flush", actor: "viewer" } }),
      baseRecord({ event_type: "network", data: {} }),
      baseRecord({
        event_type: "network",
        data: {
          direction: "outbound",
          protocol: "http",
          peer: "coordinator",
          status: 200,
          path: `/api/internal/viewer-log?token=${querySentinel}`,
        },
      }),
    ];

    const response = await viewerLogRequest().send(invalidRecords);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ accepted: 0, dropped: invalidRecords.length });
    expect(listViewerJsonl()).toEqual([]);
    expect(JSON.stringify(response.body)).not.toContain(querySentinel);
  });

  it.each([
    ["missing headers", () => request(app!.app).post("/api/internal/viewer-log")],
    ["wrong token", () => viewerLogRequest().set("X-Viewer-Lease-Token", "wrong-token")],
    ["wrong lease id", () => viewerLogRequest().set("X-Viewer-Lease-Id", "viewer_lease_wrong")],
  ])("rejects %s with a uniform 401 before persistence", async (_label, buildRequest) => {
    const response = await buildRequest().send([baseRecord()]);
    expect(response.status).toBe(401);
    expect(response.body).toEqual({ detail: "missing or invalid viewer lease" });
    expect(listViewerJsonl()).toEqual([]);
  });

  it("rejects a cross-session lease with the same uniform 401", async () => {
    const otherSessionId = await createSession("other");
    const response = await viewerLogRequest(otherSessionId, lease).send([baseRecord()]);
    expect(response.status).toBe(401);
    expect(response.body).toEqual({ detail: "missing or invalid viewer lease" });
    expect(listViewerJsonl()).toEqual([]);
  });

  it("rejects released and expired leases", async () => {
    const released = await claimLease(sessionId, "spectator", "viewer-log-released");
    const releaseResponse = await request(app!.app)
      .post(`/api/review-sessions/${sessionId}/viewer-leases/${released.lease_id}/release`)
      .set("X-Viewer-Lease-Token", released.lease_token)
      .send({});
    expect(releaseResponse.status).toBe(200);
    const releasedResponse = await viewerLogRequest(sessionId, released).send([baseRecord()]);
    expect(releasedResponse.status).toBe(401);
    expect(releasedResponse.body).toEqual({ detail: "missing or invalid viewer lease" });

    const expiryBase = Date.now();
    vi.spyOn(Date, "now")
      .mockReturnValueOnce(expiryBase)
      .mockReturnValue(expiryBase + 46_000);
    const expiring = await claimLease(sessionId, "spectator", "viewer-log-expired");
    const expiredResponse = await viewerLogRequest(sessionId, expiring).send([baseRecord()]);
    expect(expiredResponse.status).toBe(401);
    expect(expiredResponse.body).toEqual({ detail: "missing or invalid viewer lease" });
  });

  it("authenticates before parsing malformed or oversized bodies", async () => {
    const malformed = await request(app!.app)
      .post("/api/internal/viewer-log")
      .set("Content-Type", "application/json")
      .send("{not-json");
    const oversized = await request(app!.app)
      .post("/api/internal/viewer-log")
      .set("Content-Type", "application/json")
      .send(`["${"x".repeat(300 * 1024)}"]`);
    expect(malformed.status).toBe(401);
    expect(oversized.status).toBe(401);
    expect(malformed.body).toEqual({ detail: "missing or invalid viewer lease" });
    expect(oversized.body).toEqual({ detail: "missing or invalid viewer lease" });
    expect(listViewerJsonl()).toEqual([]);
  });

  it.each([
    "/api/internal/viewer-log/",
    "/API/INTERNAL/VIEWER-LOG",
  ])("applies viewer lease auth before parsing Express route alias %s", async (path) => {
    const response = await request(app!.app)
      .post(path)
      .set("X-Internal-Token", INTERNAL_TOKEN)
      .set("Content-Type", "application/json")
      .send("{not-json");
    expect(response.status).toBe(401);
    expect(response.body).toEqual({ detail: "missing or invalid viewer lease" });
    expect(listViewerJsonl()).toEqual([]);
  });

  it("applies the same pre-parse lease gate to an absolute-form request target", async () => {
    await new Promise<void>((resolve) => app!.server.listen(0, "127.0.0.1", resolve));
    const address = app!.server.address();
    if (!address || typeof address === "string") throw new Error("test server did not expose a TCP port");
    const result = await new Promise<{ status: number | undefined; body: string }>((resolve, reject) => {
      const rawRequest = nodeHttpRequest({
        hostname: "127.0.0.1",
        port: address.port,
        method: "POST",
        path: "http://example.invalid/api/internal/viewer-log",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength("{not-json"),
          "X-Internal-Token": INTERNAL_TOKEN,
        },
      }, (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        response.on("end", () => resolve({
          status: response.statusCode,
          body: Buffer.concat(chunks).toString("utf8"),
        }));
      });
      rawRequest.on("error", reject);
      rawRequest.end("{not-json");
    });
    expect(result.status).toBe(401);
    expect(JSON.parse(result.body)).toEqual({ detail: "missing or invalid viewer lease" });
    expect(listViewerJsonl()).toEqual([]);
  });

  it("drops schema-valid non-viewer records without writing another service path", async () => {
    const before = listServiceJsonl("coordinator");
    const response = await viewerLogRequest().send([
      baseRecord({ service: "coordinator" }),
    ]);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ accepted: 0, dropped: 1 });
    expect(listViewerJsonl()).toEqual([]);
    expect(listServiceJsonl("coordinator")).toEqual(before);
  });
});

describe("GET /api/internal/structLog/health", () => {
  let app: CoordinatorApp | null = null;
  let storageRoot: string;
  let logRoot: string;

  beforeEach(() => {
    storageRoot = mkdtempSync(join(tmpdir(), "structlog-health-storage-"));
    logRoot = mkdtempSync(join(tmpdir(), "structlog-health-logs-"));
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

  it("returns the coordinator logger run_id, file, and counters", async () => {
    const response = await request(app!.app)
      .get("/api/internal/structLog/health")
      .set("X-Internal-Token", INTERNAL_TOKEN);
    expect(response.status).toBe(200);
    expect(response.body.run_id).toMatch(/^run_\d{8}_\d{6}_[0-9a-f]{6}$/);
    expect(typeof response.body.current_file).toBe("string");
    expect(typeof response.body.records_written).toBe("number");
    expect(typeof response.body.records_dropped).toBe("number");
    expect(response.body.last_failure === null || typeof response.body.last_failure === "object").toBe(true);
    expect(response.body.viewer_intake).toMatchObject({
      records_received: expect.any(Number),
      records_accepted: expect.any(Number),
      records_dropped: expect.any(Number),
    });
  });

  it("dropped counter advances after malformed viewer batch", async () => {
    const before = await request(app!.app)
      .get("/api/internal/structLog/health")
      .set("X-Internal-Token", INTERNAL_TOKEN);
    const droppedBefore = before.body.viewer_intake.records_dropped as number;

    const session = await request(app!.app)
      .post("/api/review-sessions")
      .send({
        project_id: "health-project",
        model_version_id: "health-version",
        created_by: "health-fixture",
        artifact_bindings: [],
      });
    const leaseResponse = await request(app!.app)
      .post(`/api/review-sessions/${session.body.session_id}/viewer-leases/claim`)
      .set("X-User-Token", "health-viewer")
      .send({
        viewer_id: "health-viewer",
        requested_role: "spectator",
        client_nonce: "health-viewer-log",
      });
    await request(app!.app)
      .post("/api/internal/viewer-log")
      .set("X-Review-Session-Id", session.body.session_id)
      .set("X-Viewer-Lease-Id", leaseResponse.body.lease_id)
      .set("X-Viewer-Lease-Token", leaseResponse.body.lease_token)
      .send([{ foo: "bar" } as unknown, { not: "valid" } as unknown]);

    const after = await request(app!.app)
      .get("/api/internal/structLog/health")
      .set("X-Internal-Token", INTERNAL_TOKEN);
    expect(after.body.viewer_intake.records_dropped).toBeGreaterThanOrEqual(droppedBefore + 2);
  });

  it("requires the existing internal token", async () => {
    const missing = await request(app!.app).get("/api/internal/structLog/health");
    const wrong = await request(app!.app)
      .get("/api/internal/structLog/health")
      .set("X-Internal-Token", "wrong");
    expect(missing.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(missing.body).toEqual({ detail: "missing or invalid internal API token" });
    expect(wrong.body).toEqual({ detail: "missing or invalid internal API token" });
  });
});
