import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, readdirSync, rmSync, existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";

import { createCoordinatorApp, type CoordinatorApp } from "../../src/app.js";
import type { LogRecord } from "../../src/lib/structLog.js";

function baseRecord(overrides: Partial<LogRecord> = {}): LogRecord {
  return {
    ts: "2026-05-26T14:25:00.000Z",
    level: "info",
    event_type: "general",
    service: "viewer",
    component: "webrtcClient",
    run_id: "run_20260526_142455_d3e400",
    trace_id: "rev_20260526_1234abcd",
    msg: "viewer event",
    data: {},
    ...overrides,
  };
}

describe("POST /api/internal/viewer-log", () => {
  let app: CoordinatorApp | null = null;
  let storageRoot: string;
  let logRoot: string;

  beforeEach(() => {
    storageRoot = mkdtempSync(join(tmpdir(), "viewerlog-intake-storage-"));
    logRoot = mkdtempSync(join(tmpdir(), "viewerlog-intake-logs-"));
    app = createCoordinatorApp({
      sessionStoreDir: join(storageRoot, "sessions"),
      eventLogDir: join(storageRoot, "events"),
      callbackOutboxStorePath: join(storageRoot, "callback-outbox.json"),
      bimControlApiBase: "http://127.0.0.1:1",
      corsOrigins: ["http://127.0.0.1:5173"],
      logRoot,
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

  function listViewerJsonl(): string[] {
    const dir = join(logRoot, "viewer");
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

  it("persists a batch of schema-valid records and returns accepted/dropped counts", async () => {
    const records = Array.from({ length: 10 }, (_, i) =>
      baseRecord({ msg: `viewer event ${i}`, data: { seq: i } }),
    );
    const response = await request(app!.app).post("/api/internal/viewer-log").send(records);
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
    const response = await request(app!.app)
      .post("/api/internal/viewer-log")
      .send([...valid, ...invalid]);
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
    const response = await request(app!.app)
      .post("/api/internal/viewer-log")
      .set("Content-Type", "application/json")
      .send([baseRecord({ msg: huge })]);
    expect(response.status).toBe(413);
  });

  it("rejects non-array body with 400", async () => {
    const response = await request(app!.app)
      .post("/api/internal/viewer-log")
      .send(baseRecord());
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ accepted: 0, dropped: 0 });
  });

  it("rejects too many records in a single batch with 413", async () => {
    const records = Array.from({ length: 600 }, (_, i) => baseRecord({ msg: `m-${i}` }));
    const response = await request(app!.app).post("/api/internal/viewer-log").send(records);
    expect(response.status).toBe(413);
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
      bimControlApiBase: "http://127.0.0.1:1",
      corsOrigins: ["http://127.0.0.1:5173"],
      logRoot,
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

  it("returns the coordinator logger run_id, file, and counters", async () => {
    const response = await request(app!.app).get("/api/internal/structLog/health");
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
    const before = await request(app!.app).get("/api/internal/structLog/health");
    const droppedBefore = before.body.viewer_intake.records_dropped as number;

    await request(app!.app)
      .post("/api/internal/viewer-log")
      .send([{ foo: "bar" } as unknown, { not: "valid" } as unknown]);

    const after = await request(app!.app).get("/api/internal/structLog/health");
    expect(after.body.viewer_intake.records_dropped).toBeGreaterThanOrEqual(droppedBefore + 2);
  });
});
