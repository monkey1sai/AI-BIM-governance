import type { SessionStore } from "./sessionStore.js";
import { isSafeSessionId } from "./sessionStore.js";

export interface SessionIdleReclaimOptions {
  /**
   * Continuous inactivity in milliseconds before countdown triggers.
   * Default: 300,000ms (5 minutes).
   */
  idleTimeoutMs?: number;
  /**
   * Duration in seconds for the countdown before session is torn down.
   * Default: 10 seconds.
   */
  countdownSeconds?: number;
  /**
   * Check loop interval in milliseconds.
   * Default: 1,000ms.
   */
  checkIntervalMs?: number;
  /**
   * Callback fired when a session enters or updates its countdown.
   */
  onCountdown?: (sessionId: string, remainingSeconds: number) => void;
  /**
   * Callback fired when an active countdown is cancelled by user activity.
   */
  onCountdownCancelled?: (sessionId: string) => void;
  /**
   * Callback fired when countdown reaches 0 to teardown the session.
   */
  onReclaimTeardown?: (sessionId: string) => Promise<void> | void;
}

export interface SessionActivityState {
  sessionId: string;
  lastActivityAt: number;
  isCountingDown: boolean;
  countdownRemainingSec: number;
  countdownStartedAt?: number;
}

export class SessionIdleReclaimService {
  private readonly idleTimeoutMs: number;
  private readonly countdownSeconds: number;
  private readonly checkIntervalMs: number;
  private readonly onCountdown?: (sessionId: string, remainingSeconds: number) => void;
  private readonly onCountdownCancelled?: (sessionId: string) => void;
  private readonly onReclaimTeardown?: (sessionId: string) => Promise<void> | void;

  private readonly sessionStates = new Map<string, SessionActivityState>();
  private timer: NodeJS.Timeout | null = null;
  private isRunning = false;

  constructor(
    private readonly store: SessionStore,
    options: SessionIdleReclaimOptions = {},
  ) {
    this.idleTimeoutMs = options.idleTimeoutMs ?? parseInt(process.env.SESSION_IDLE_TIMEOUT_MS || "300000", 10);
    this.countdownSeconds = options.countdownSeconds ?? 10;
    this.checkIntervalMs = options.checkIntervalMs ?? 1000;
    this.onCountdown = options.onCountdown;
    this.onCountdownCancelled = options.onCountdownCancelled;
    this.onReclaimTeardown = options.onReclaimTeardown;
  }

  /**
   * Starts the periodic idle-check background loop.
   */
  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.timer = setInterval(() => {
      this.tick();
    }, this.checkIntervalMs);
  }

  /**
   * Stops the background loop and clears active timers.
   */
  stop(): void {
    this.isRunning = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Ingests a user activity event for the given session.
   * Updates lastActivityAt and cancels any active countdown.
   */
  recordActivity(sessionId: string, timestamp: number = Date.now()): boolean {
    if (!isSafeSessionId(sessionId)) return false;
    const session = this.store.get(sessionId);
    if (!session || (session.status !== "active" && session.status !== "created")) return false;

    let state = this.sessionStates.get(sessionId);
    if (!state) {
      state = {
        sessionId,
        lastActivityAt: timestamp,
        isCountingDown: false,
        countdownRemainingSec: this.countdownSeconds,
      };
      this.sessionStates.set(sessionId, state);
    } else {
      state.lastActivityAt = timestamp;
      if (state.isCountingDown) {
        state.isCountingDown = false;
        state.countdownRemainingSec = this.countdownSeconds;
        state.countdownStartedAt = undefined;
        this.onCountdownCancelled?.(sessionId);
      }
    }
    return true;
  }

  /**
   * Returns current idle and countdown status for a session.
   */
  getSessionState(sessionId: string): SessionActivityState | null {
    if (!isSafeSessionId(sessionId)) return null;
    const session = this.store.get(sessionId);
    if (!session || (session.status !== "active" && session.status !== "created")) {
      this.sessionStates.delete(sessionId);
      return null;
    }

    let state = this.sessionStates.get(sessionId);
    if (!state) {
      const createdAtMs = Date.parse(session.created_at) || Date.now();
      state = {
        sessionId,
        lastActivityAt: createdAtMs,
        isCountingDown: false,
        countdownRemainingSec: this.countdownSeconds,
      };
      this.sessionStates.set(sessionId, state);
    }
    return state;
  }

  /**
   * Single deterministic tick that evaluates active sessions.
   * Can be called manually in unit tests with simulated timestamps.
   */
  tick(now: number = Date.now()): void {
    const activeSessions = this.store.list().filter((s) => s.status === "active" || s.status === "created");
    const activeIds = new Set(activeSessions.map((s) => s.session_id));

    // Clean up states for removed or closed sessions
    for (const [id] of this.sessionStates) {
      if (!activeIds.has(id)) {
        this.sessionStates.delete(id);
      }
    }

    for (const session of activeSessions) {
      const state = this.getSessionState(session.session_id);
      if (!state) continue;

      const inactiveDurationMs = now - state.lastActivityAt;

      if (!state.isCountingDown) {
        // Trigger countdown if idle timeout reached
        if (inactiveDurationMs >= this.idleTimeoutMs) {
          state.isCountingDown = true;
          state.countdownStartedAt = now;
          state.countdownRemainingSec = this.countdownSeconds;
          this.onCountdown?.(session.session_id, state.countdownRemainingSec);
        }
      } else {
        // Decrement remaining seconds
        const elapsedCountdownSec = Math.floor((now - (state.countdownStartedAt ?? now)) / 1000);
        const remaining = Math.max(0, this.countdownSeconds - elapsedCountdownSec);
        state.countdownRemainingSec = remaining;

        if (remaining <= 0) {
          // Countdown expired: teardown session
          this.sessionStates.delete(session.session_id);
          try {
            void this.onReclaimTeardown?.(session.session_id);
          } catch (err) {
            console.error(`[SessionIdleReclaim] Error tearing down session ${session.session_id}:`, err);
          }
        } else {
          this.onCountdown?.(session.session_id, remaining);
        }
      }
    }
  }

  /**
   * Untracks a session when closed.
   */
  removeSession(sessionId: string): void {
    this.sessionStates.delete(sessionId);
  }
}
