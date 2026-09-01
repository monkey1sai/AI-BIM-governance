import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import request from "supertest";
import { SessionStore } from "../src/services/sessionStore.js";
import { SessionIdleReclaimService } from "../src/services/sessionIdleReclaimService.js";
import { createCoordinatorApp } from "../src/app.js";
import { EventLog, type SessionEvent } from "../src/services/eventLog.js";

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
    service.connectPeer(session.session_id, "peer-1", t0);

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
    service.connectPeer(session.session_id, "peer-1", t0);

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

  it("broadcasts countdown cancellation before removing the last ready peer", () => {
    const session = createActiveSession();
    const cancellations: string[] = [];
    const service = new SessionIdleReclaimService(store, {
      idleTimeoutMs: 1_000,
      countdownSeconds: 10,
      onCountdownCancelled: (sessionId) => cancellations.push(sessionId),
    });
    const t0 = 1_000_000;
    service.connectPeer(session.session_id, "ready-peer", t0);
    service.tick(t0 + 1_000);

    service.disconnectPeer(session.session_id, "ready-peer");

    expect(cancellations).toEqual([session.session_id]);
    expect(service.getSessionState(session.session_id)).toBeNull();
  });

  it("does not refresh inactivity when readiness is replayed or a transport reconnects", () => {
    const session = createActiveSession();
    const service = new SessionIdleReclaimService(store, {
      idleTimeoutMs: 60_000,
      countdownSeconds: 10,
    });
    const t0 = 1_000_000;

    service.connectPeer(session.session_id, "peer-1", t0);
    service.connectPeer(session.session_id, "peer-1", t0 + 5_000);
    service.connectPeer(session.session_id, "peer-2", t0 + 10_000);
    expect(service.getSessionState(session.session_id)?.lastActivityAt).toBe(t0);

    service.disconnectPeer(session.session_id, "peer-1");
    service.disconnectPeer(session.session_id, "peer-2");
    expect(service.getSessionState(session.session_id)).toBeNull();

    service.connectPeer(session.session_id, "peer-reconnected", t0 + 20_000);
    expect(service.getSessionState(session.session_id)?.lastActivityAt).toBe(t0);
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
    service.connectPeer(session.session_id, "peer-1", t0);

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

  it("retains idle tracking and retries after a synchronous teardown failure", () => {
    const session = createActiveSession();
    const teardown = vi.fn()
      .mockImplementationOnce(() => { throw new Error("transient teardown failure"); })
      .mockImplementationOnce(() => undefined);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const service = new SessionIdleReclaimService(store, {
      idleTimeoutMs: 1_000,
      countdownSeconds: 1,
      onReclaimTeardown: teardown,
    });
    const t0 = 1_000_000;
    service.connectPeer(session.session_id, "peer-1", t0);
    service.tick(t0 + 1_000);

    service.tick(t0 + 2_000);
    expect(teardown).toHaveBeenCalledTimes(1);
    expect(service.getSessionState(session.session_id)).not.toBeNull();

    service.tick(t0 + 2_001);
    expect(teardown).toHaveBeenCalledTimes(2);
    expect(service.getSessionState(session.session_id)).toBeNull();
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });

  it("retains a zero-second teardown retry after the final ready peer disconnects", () => {
    const session = createActiveSession();
    const teardown = vi.fn()
      .mockImplementationOnce(() => { throw new Error("transient teardown failure"); })
      .mockImplementationOnce(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => {});
    const service = new SessionIdleReclaimService(store, {
      idleTimeoutMs: 1_000,
      countdownSeconds: 1,
      onReclaimTeardown: teardown,
    });
    const t0 = 1_000_000;
    service.connectPeer(session.session_id, "peer-1", t0);
    service.tick(t0 + 1_000);
    service.tick(t0 + 2_000);

    service.disconnectPeer(session.session_id, "peer-1");
    expect(service.getSessionState(session.session_id)).not.toBeNull();

    service.tick(t0 + 2_001);
    expect(teardown).toHaveBeenCalledTimes(2);
    expect(service.getSessionState(session.session_id)).toBeNull();
  });

  it("does not overlap async teardown and retries after rejection", async () => {
    const session = createActiveSession();
    let rejectFirst!: (reason?: unknown) => void;
    const firstAttempt = new Promise<void>((_resolve, reject) => { rejectFirst = reject; });
    const teardown = vi.fn()
      .mockReturnValueOnce(firstAttempt)
      .mockResolvedValueOnce(undefined);
    vi.spyOn(console, "error").mockImplementation(() => {});
    const service = new SessionIdleReclaimService(store, {
      idleTimeoutMs: 1_000,
      countdownSeconds: 1,
      onReclaimTeardown: teardown,
    });
    const t0 = 1_000_000;
    service.connectPeer(session.session_id, "peer-1", t0);
    service.tick(t0 + 1_000);

    service.tick(t0 + 2_000);
    service.tick(t0 + 2_001);
    expect(teardown).toHaveBeenCalledTimes(1);

    rejectFirst(new Error("async teardown failure"));
    await firstAttempt.catch(() => undefined);
    await Promise.resolve();
    expect(service.getSessionState(session.session_id)).not.toBeNull();

    service.tick(t0 + 2_002);
    await Promise.resolve();
    await Promise.resolve();
    expect(teardown).toHaveBeenCalledTimes(2);
    expect(service.getSessionState(session.session_id)).toBeNull();
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
    service.connectPeer(session.session_id, "peer-1", currentT);

    // Simulate 3 hours of continuous active session with interaction every 30s
    for (let i = 0; i < 360; i++) {
      currentT += 30_000;
      service.recordActivity(session.session_id, currentT);
      service.tick(currentT);
    }

    expect(countdowns).toHaveLength(0);
    expect(teardowns).toHaveLength(0);
  });

  it("does not track or reclaim a session without a connected viewer", () => {
    const session = createActiveSession();
    const teardown = vi.fn();
    const service = new SessionIdleReclaimService(store, {
      idleTimeoutMs: 1_000,
      onReclaimTeardown: teardown,
    });

    expect(service.recordActivity(session.session_id, 1_000)).toBe(false);
    service.tick(30_000);

    expect(service.getSessionState(session.session_id)).toBeNull();
    expect(teardown).not.toHaveBeenCalled();
  });

  it("checks only incrementally tracked connected sessions and contains corrupt session reads", () => {
    const session = createActiveSession();
    const service = new SessionIdleReclaimService(store, { idleTimeoutMs: 1_000 });
    const listSpy = vi.spyOn(store, "list");
    service.connectPeer(session.session_id, "peer-1", 1_000);
    vi.spyOn(store, "get").mockImplementation(() => {
      throw new Error("corrupt session file");
    });

    expect(() => service.tick(2_000)).not.toThrow();
    expect(listSpy).not.toHaveBeenCalled();
    expect(service.getSessionState(session.session_id)).toBeNull();
  });

  it("remains disabled when no measured inactivity timeout is configured", () => {
    const session = createActiveSession();
    const service = new SessionIdleReclaimService(store);

    expect(service.connectPeer(session.session_id, "peer-1", 1_000)).toBe(false);
    expect(service.recordActivity(session.session_id, 2_000)).toBe(false);
    expect(service.getSessionState(session.session_id)).toBeNull();
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

  it("requires an active viewer lease for POST activity and exposes GET /idle-status", async () => {
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

    appInstance.idleReclaimService.connectPeer(sessionId, "peer-http");
    const missingLease = await request(appInstance.app)
      .post(`/api/review-sessions/${sessionId}/activity`)
      .send({});
    expect(missingLease.status).toBe(401);

    const claimed = await request(appInstance.app)
      .post(`/api/review-sessions/${sessionId}/viewer-leases/claim`)
      .set("X-User-Token", "idle-viewer")
      .send({
        viewer_id: "idle-viewer",
        requested_role: "primary",
        client_nonce: `idle:${sessionId}`,
      });
    expect(claimed.status).toBe(200);

    const wrongToken = await request(appInstance.app)
      .post(`/api/review-sessions/${sessionId}/activity`)
      .set("X-Viewer-Lease-Token", "wrong-token")
      .send({ lease_id: claimed.body.lease_id });
    expect(wrongToken.status).toBe(401);

    const actRes = await request(appInstance.app)
      .post(`/api/review-sessions/${sessionId}/activity`)
      .set("X-Viewer-Lease-Token", claimed.body.lease_token)
      .send({ lease_id: claimed.body.lease_id });
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
    appInstance.idleReclaimService.connectPeer(sessionId, "peer-1", t0);

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

  it("retries terminal audit and notification work after durable status is already closed", async () => {
    const createRes = await request(appInstance.app)
      .post("/api/review-sessions")
      .send({
        project_id: "prj_retry",
        model_version_id: "mv_retry",
        created_by: "user_retry",
      });
    const sessionId = createRes.body.session_id as string;
    const originalAppend = appInstance.eventLog.appendServerCloseCheckpoint.bind(appInstance.eventLog);
    let failSessionClosedOnce = true;
    const appendSpy = vi.spyOn(appInstance.eventLog, "appendServerCloseCheckpoint").mockImplementation((id, type, payload, checkpointId) => {
      if (type === "sessionClosed" && failSessionClosedOnce) {
        failSessionClosedOnce = false;
        throw new Error("transient sessionClosed append failure");
      }
      return originalAppend(id, type, payload, checkpointId);
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const t0 = 2_000_000;

    try {
      appInstance.idleReclaimService.connectPeer(sessionId, "peer-retry", t0);
      appInstance.idleReclaimService.tick(t0 + 100);
      appInstance.idleReclaimService.tick(t0 + 100 + 11_000);

      expect(appInstance.store.get(sessionId)?.status).toBe("closed");
      expect(appInstance.idleReclaimService.getSessionState(sessionId)).not.toBeNull();
      appInstance.idleReclaimService.disconnectPeer(sessionId, "peer-retry");
      expect(appInstance.idleReclaimService.getSessionState(sessionId)).not.toBeNull();
      const retainedRetryStatus = await request(appInstance.app)
        .get(`/api/review-sessions/${sessionId}/idle-status`);
      expect(retainedRetryStatus.body.has_connected_viewer).toBe(false);

      appInstance.idleReclaimService.tick(t0 + 100 + 11_001);

      expect(appInstance.idleReclaimService.getSessionState(sessionId)).toBeNull();
      expect(appInstance.store.get(sessionId)?.status).toBe("closed");
      const events = appInstance.eventLog.list(sessionId);
      expect(events.filter((event) => event.type === "sessionClosing")).toHaveLength(1);
      expect(events.filter((event) => event.type === "sessionClosed")).toHaveLength(1);
      expect(events.filter((event) => event.type === "kitInstanceReleased")).toHaveLength(1);
      expect(errorSpy).toHaveBeenCalled();
    } finally {
      appendSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });

  it("retries a missing sessionClosing audit before closing the session", async () => {
    const createRes = await request(appInstance.app)
      .post("/api/review-sessions")
      .send({
        project_id: "prj_retry_closing",
        model_version_id: "mv_retry_closing",
        created_by: "user_retry_closing",
      });
    const sessionId = createRes.body.session_id as string;
    const originalAppend = appInstance.eventLog.appendServerCloseCheckpoint.bind(appInstance.eventLog);
    let failSessionClosingOnce = true;
    const appendSpy = vi.spyOn(appInstance.eventLog, "appendServerCloseCheckpoint").mockImplementation((id, type, payload, checkpointId) => {
      if (type === "sessionClosing" && failSessionClosingOnce) {
        failSessionClosingOnce = false;
        throw new Error("transient sessionClosing append failure");
      }
      return originalAppend(id, type, payload, checkpointId);
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const t0 = 3_000_000;

    try {
      appInstance.idleReclaimService.connectPeer(sessionId, "peer-retry-closing", t0);
      appInstance.idleReclaimService.tick(t0 + 100);
      appInstance.idleReclaimService.tick(t0 + 100 + 11_000);

      expect(appInstance.idleReclaimService.getSessionState(sessionId)).not.toBeNull();

      appInstance.idleReclaimService.tick(t0 + 100 + 11_001);

      expect(appInstance.idleReclaimService.getSessionState(sessionId)).toBeNull();
      expect(appInstance.store.get(sessionId)?.status).toBe("closed");
      const events = appInstance.eventLog.list(sessionId);
      expect(events.filter((event) => event.type === "sessionClosing")).toHaveLength(1);
      expect(events.filter((event) => event.type === "sessionClosed")).toHaveLength(1);
      expect(errorSpy).toHaveBeenCalled();
    } finally {
      appendSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });

  it("recovers an incomplete durable close checkpoint on coordinator restart", async () => {
    const createRes = await request(appInstance.app)
      .post("/api/review-sessions")
      .send({
        project_id: "prj_restart_recovery",
        model_version_id: "mv_restart_recovery",
        created_by: "user_restart_recovery",
      });
    const sessionId = createRes.body.session_id as string;
    const checkpoint = {
      checkpoint_id: "close_restart_recovery",
      expected_final_event_count: 0,
    };
    appInstance.store.update(sessionId, { status: "closed", close_checkpoint: checkpoint });
    appInstance.eventLog.appendServerCloseCheckpoint(sessionId, "sessionClosing", {
      final_events: 0,
      reason: "inactivity",
      actor: "system:idle_reclaimer",
    }, checkpoint.checkpoint_id);
    await appInstance.dispose();

    appInstance = createCoordinatorApp({
      sessionStoreDir: tmpSessionsDir,
      eventLogDir: tmpEventsDir,
      sessionIdleTimeoutMs: 50,
    });

    const events = appInstance.eventLog.list(sessionId);
    expect(events.filter((event) => event.type === "sessionClosing")).toHaveLength(1);
    expect(events.filter((event) => event.type === "sessionClosed")).toHaveLength(1);
    expect(events.filter((event) => event.type === "kitInstanceReleased")).toHaveLength(1);
  });

  it("retries a transient startup close recovery failure without requiring another restart", async () => {
    const createRes = await request(appInstance.app)
      .post("/api/review-sessions")
      .send({
        project_id: "prj_restart_retry",
        model_version_id: "mv_restart_retry",
        created_by: "user_restart_retry",
      });
    const sessionId = createRes.body.session_id as string;
    const checkpoint = {
      checkpoint_id: "close_restart_retry",
      expected_final_event_count: 0,
    };
    appInstance.store.update(sessionId, { status: "closed", close_checkpoint: checkpoint });
    appInstance.eventLog.appendServerCloseCheckpoint(sessionId, "sessionClosing", {
      final_events: 0,
      reason: "operator_close",
      actor: "operator:test",
    }, checkpoint.checkpoint_id);
    await appInstance.dispose();

    const originalAppend = EventLog.prototype.appendServerCloseCheckpoint;
    let failSessionClosedOnce = true;
    const appendSpy = vi.spyOn(EventLog.prototype, "appendServerCloseCheckpoint").mockImplementation(function (this: EventLog,
      id,
      type,
      payload,
      checkpointId,
    ) {
      if (type === "sessionClosed" && failSessionClosedOnce) {
        failSessionClosedOnce = false;
        throw new Error("transient startup recovery failure");
      }
      return originalAppend.call(this, id, type, payload, checkpointId);
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    try {
      appInstance = createCoordinatorApp({
        sessionStoreDir: tmpSessionsDir,
        eventLogDir: tmpEventsDir,
      });
      expect(appInstance.eventLog.list(sessionId).some((event) => event.type === "sessionClosed")).toBe(false);

      appInstance.idleReclaimService.tick();

      const events = appInstance.eventLog.list(sessionId);
      expect(events.filter((event) => event.type === "sessionClosing")).toHaveLength(1);
      expect(events.filter((event) => event.type === "sessionClosed")).toHaveLength(1);
      expect(events.filter((event) => event.type === "kitInstanceReleased")).toHaveLength(1);
      expect((events.find((event) => event.type === "sessionClosed")?.payload as { reason?: string }).reason)
        .toBe("operator_close");
    } finally {
      appendSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });
});
