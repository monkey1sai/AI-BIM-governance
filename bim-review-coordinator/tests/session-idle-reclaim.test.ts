import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import request from "supertest";
import { SessionStore } from "../src/services/sessionStore.js";
import { SessionIdleReclaimService } from "../src/services/sessionIdleReclaimService.js";
import { createCoordinatorApp } from "../src/app.js";
import type { SessionEvent } from "../src/services/eventLog.js";

describe("SessionIdleReclaimService (session-lifecycle idle countdown & reclaim)", () => {
  let tmpDir: string;
  let store: SessionStore;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "session-idle-reclaim-test-"));
    store = new SessionStore(tmpDir);
  });

  const createActiveSession = () => {
    const session = store.create({
      project_id: "prj_001",
      model_version_id: "mv_001",
      created_by: "user_test",
      kit_instance: {
        instance_id: "kit_001",
        provider: "local_fixed",
        status: "ready",
        stream_server: "127.0.0.1",
        signaling_port: 49101,
        media_server: "127.0.0.1",
      },
    });
    return session;
  };

  it("triggers countdown when inactivity exceeds idleTimeoutMs", () => {
    const session = createActiveSession();
    const countdowns: Array<{ sessionId: string; remaining: number }> = [];
    const cancellations: string[] = [];
    const teardowns: string[] = [];

    const service = new SessionIdleReclaimService(store, {
      idleTimeoutMs: 60_000, // 60s
      countdownSeconds: 10,
      onCountdown: (sessionId, remaining) => {
        countdowns.push({ sessionId, remaining });
      },
      onCountdownCancelled: (sessionId) => {
        cancellations.push(sessionId);
      },
      onReclaimTeardown: (sessionId) => {
        teardowns.push(sessionId);
      },
    });

    const t0 = 1000_000;
    service.recordActivity(session.session_id, t0);

    // After 30s: no countdown
    service.tick(t0 + 30_000);
    expect(countdowns).toHaveLength(0);

    // After 60s: countdown triggers with 10s remaining
    service.tick(t0 + 60_000);
    expect(countdowns).toHaveLength(1);
    expect(countdowns[0]).toEqual({ sessionId: session.session_id, remaining: 10 });
    expect(teardowns).toHaveLength(0);
  });

  it("cancels countdown and resets inactivity when user activity is received during countdown", () => {
    const session = createActiveSession();
    const countdowns: Array<{ sessionId: string; remaining: number }> = [];
    const cancellations: string[] = [];
    const teardowns: string[] = [];

    const service = new SessionIdleReclaimService(store, {
      idleTimeoutMs: 60_000,
      countdownSeconds: 10,
      onCountdown: (sessionId, remaining) => {
        countdowns.push({ sessionId, remaining });
      },
      onCountdownCancelled: (sessionId) => {
        cancellations.push(sessionId);
      },
      onReclaimTeardown: (sessionId) => {
        teardowns.push(sessionId);
      },
    });

    const t0 = 1000_000;
    service.recordActivity(session.session_id, t0);

    // Trigger countdown at 60s
    service.tick(t0 + 60_000);
    expect(countdowns).toHaveLength(1);

    // Tick at 5s into countdown (remaining = 5)
    service.tick(t0 + 65_000);
    expect(countdowns).toHaveLength(2);
    expect(countdowns[1].remaining).toBe(5);

    // User interacts at 67s
    const activityRecorded = service.recordActivity(session.session_id, t0 + 67_000);
    expect(activityRecorded).toBe(true);
    expect(cancellations).toContain(session.session_id);

    // Tick at 72s: countdown has been cancelled, session is active and not timed out (only 5s since 67s)
    service.tick(t0 + 72_000);
    expect(teardowns).toHaveLength(0);
    const state = service.getSessionState(session.session_id);
    expect(state?.isCountingDown).toBe(false);
  });

  it("triggers teardown when 10-second countdown reaches 0 without interaction", () => {
    const session = createActiveSession();
    const teardowns: string[] = [];

    const service = new SessionIdleReclaimService(store, {
      idleTimeoutMs: 60_000,
      countdownSeconds: 10,
      onReclaimTeardown: (sessionId) => {
        teardowns.push(sessionId);
      },
    });

    const t0 = 1000_000;
    service.recordActivity(session.session_id, t0);

    // Inactivity triggers countdown at t0 + 60s
    service.tick(t0 + 60_000);
    expect(teardowns).toHaveLength(0);

    // Progress to t0 + 65s (5s remaining)
    service.tick(t0 + 65_000);
    expect(teardowns).toHaveLength(0);

    // Reaching t0 + 70s (10s countdown completed)
    service.tick(t0 + 70_000);
    expect(teardowns).toEqual([session.session_id]);
  });

  it("active sessions with regular interaction are never reclaimed (no max-hold cap)", () => {
    const session = createActiveSession();
    const countdowns: Array<{ sessionId: string; remaining: number }> = [];
    const teardowns: string[] = [];

    const service = new SessionIdleReclaimService(store, {
      idleTimeoutMs: 60_000,
      countdownSeconds: 10,
      onCountdown: (sessionId, remaining) => {
        countdowns.push({ sessionId, remaining });
      },
      onReclaimTeardown: (sessionId) => {
        teardowns.push(sessionId);
      },
    });

    let currentT = 1000_000;
    service.recordActivity(session.session_id, currentT);

    // Simulate 3 hours of continuous active session with interaction every 30s
    for (let i = 0; i < 360; i++) {
      currentT += 30_000;
      service.recordActivity(session.session_id, currentT);
      service.tick(currentT);
    }

    expect(countdowns).toHaveLength(0);
    expect(teardowns).toHaveLength(0);
  });
});

describe("Coordinator App HTTP & Socket integration for Idle Reclaim", () => {
  let appInstance: ReturnType<typeof createCoordinatorApp>;
  let tmpSessionsDir: string;
  let tmpEventsDir: string;

  beforeEach(() => {
    tmpSessionsDir = fs.mkdtempSync(path.join(os.tmpdir(), "coord-sessions-"));
    tmpEventsDir = fs.mkdtempSync(path.join(os.tmpdir(), "coord-events-"));
    appInstance = createCoordinatorApp({
      sessionStoreDir: tmpSessionsDir,
      eventLogDir: tmpEventsDir,
      sessionIdleTimeoutMs: 50,
    });
  });

  afterEach(async () => {
    await appInstance.dispose();
  });

  it("supports POST /api/review-sessions/:sessionId/activity and GET /idle-status", async () => {
    const createRes = await request(appInstance.app)
      .post("/api/review-sessions")
      .send({
        project_id: "prj_test",
        model_version_id: "mv_test",
        created_by: "user_test",
      });
    expect(createRes.status).toBe(200);
    const sessionId = createRes.body.session_id;

    // Check idle status initially
    const statusRes = await request(appInstance.app)
      .get(`/api/review-sessions/${sessionId}/idle-status`);
    expect(statusRes.status).toBe(200);
    expect(statusRes.body.session_id).toBe(sessionId);
    expect(statusRes.body.is_counting_down).toBe(false);

    // Report activity
    const actRes = await request(appInstance.app)
      .post(`/api/review-sessions/${sessionId}/activity`)
      .send({});
    expect(actRes.status).toBe(200);
    expect(actRes.body.ok).toBe(true);
    expect(actRes.body.session_id).toBe(sessionId);
  });

  it("automatically closes inactive session with reason=inactivity in ledger when countdown expires", async () => {
    const createRes = await request(appInstance.app)
      .post("/api/review-sessions")
      .send({
        project_id: "prj_test",
        model_version_id: "mv_test",
        created_by: "user_test",
      });
    const sessionId = createRes.body.session_id;

    // Fast-forward tick manually on idleReclaimService
    const t0 = 1000_000;
    appInstance.idleReclaimService.recordActivity(sessionId, t0);

    // After 100ms (idleTimeoutMs=50): enters countdown
    appInstance.idleReclaimService.tick(t0 + 100);
    const stateInCountdown = appInstance.idleReclaimService.getSessionState(sessionId);
    expect(stateInCountdown?.isCountingDown).toBe(true);

    // After 10s countdown: teardown triggered
    appInstance.idleReclaimService.tick(t0 + 100 + 11_000);

    // Session is now closed
    const session = appInstance.store.get(sessionId);
    expect(session?.status).toBe("closed");

    // EventLog has sessionClosed with reason: "inactivity"
    const events = appInstance.eventLog.list(sessionId);
    const closedEvent = events.find((e: SessionEvent) => e.type === "sessionClosed");
    expect(closedEvent).toBeDefined();
    expect((closedEvent?.payload as { reason?: string } | undefined)?.reason).toBe("inactivity");
  });
});
