import type { SessionStore } from "./sessionStore.js";
import { isSafeSessionId } from "./sessionStore.js";

export interface SessionIdleReclaimOptions {
  /**
   * Continuous inactivity in milliseconds before countdown triggers.
   * Omit to keep inactivity reclaim disabled until a measured baseline defines it.
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
  private readonly idleTimeoutMs: number | null;
  private readonly countdownSeconds: number;
  private readonly checkIntervalMs: number;
  private readonly onCountdown?: (sessionId: string, remainingSeconds: number) => void;
  private readonly onCountdownCancelled?: (sessionId: string) => void;
  private readonly onReclaimTeardown?: (sessionId: string) => Promise<void> | void;

  private readonly sessionStates = new Map<string, SessionActivityState>();
  private readonly connectedPeers = new Map<string, Set<string>>();
  private readonly teardownInFlight = new Set<string>();
  private timer: NodeJS.Timeout | null = null;
  private isRunning = false;

  constructor(
    private readonly store: SessionStore,
    options: SessionIdleReclaimOptions = {},
  ) {
    this.idleTimeoutMs = options.idleTimeoutMs ?? null;
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
    if (this.isRunning || this.idleTimeoutMs === null) return;
    this.isRunning = true;
    this.timer = setInterval(() => {
      try {
        this.tick();
      } catch (error) {
        console.error("[SessionIdleReclaim] Idle check failed:", error);
      }
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
    if (
      this.idleTimeoutMs === null
      || !isSafeSessionId(sessionId)
      || !this.hasConnectedPeer(sessionId)
      || this.teardownInFlight.has(sessionId)
    ) return false;
    let session;
    try {
      session = this.store.get(sessionId);
    } catch {
      return false;
    }
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
    if (this.idleTimeoutMs === null || !isSafeSessionId(sessionId)) return null;
    const trackedState = this.sessionStates.get(sessionId);
    const retryingTeardown = trackedState?.isCountingDown === true
      && trackedState.countdownRemainingSec <= 0;
    if (!this.hasConnectedPeer(sessionId) && !retryingTeardown && !this.teardownInFlight.has(sessionId)) return null;
    let session;
    try {
      session = this.store.get(sessionId);
    } catch {
      this.removeSession(sessionId);
      return null;
    }
    const retryingInterruptedTeardown = (
      session?.status === "closing" || session?.status === "closed"
    ) && trackedState?.isCountingDown === true && trackedState.countdownRemainingSec <= 0;
    if (!session || (
      session.status !== "active"
      && session.status !== "created"
      && !retryingInterruptedTeardown
    )) {
      this.removeSession(sessionId);
      return null;
    }

    let state = trackedState;
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
    if (this.idleTimeoutMs === null) return;
    for (const [sessionId, state] of Array.from(this.sessionStates.entries())) {
      const retryingTeardown = state.isCountingDown && state.countdownRemainingSec <= 0;
      if (!this.hasConnectedPeer(sessionId) && !retryingTeardown && !this.teardownInFlight.has(sessionId)) {
        this.removeSession(sessionId);
        continue;
      }
      if (this.teardownInFlight.has(sessionId)) continue;
      try {
        const session = this.store.get(sessionId);
        const retryingInterruptedTeardown = (
          session?.status === "closing" || session?.status === "closed"
        )
          && state.isCountingDown
          && state.countdownRemainingSec <= 0;
        if (
          !session
          || (
            session.status !== "active"
            && session.status !== "created"
            && !retryingInterruptedTeardown
          )
        ) {
          this.removeSession(sessionId);
          continue;
        }
      } catch (error) {
        this.removeSession(sessionId);
        console.error(`[SessionIdleReclaim] Failed to read session ${sessionId}:`, error);
        continue;
      }

      const inactiveDurationMs = now - state.lastActivityAt;

      if (!state.isCountingDown) {
        // Trigger countdown if idle timeout reached
        if (inactiveDurationMs >= this.idleTimeoutMs) {
          state.isCountingDown = true;
          state.countdownStartedAt = now;
          state.countdownRemainingSec = this.countdownSeconds;
          this.onCountdown?.(sessionId, state.countdownRemainingSec);
        }
      } else {
        // Decrement remaining seconds
        const elapsedCountdownSec = Math.floor((now - (state.countdownStartedAt ?? now)) / 1000);
        const remaining = Math.max(0, this.countdownSeconds - elapsedCountdownSec);
        state.countdownRemainingSec = remaining;

        if (remaining <= 0) {
          // Retain peer/state ownership until teardown actually succeeds. A failed
          // close may leave the durable session in `closing`; the next tick must
          // be able to resume that exact teardown instead of orphaning it.
          try {
            const teardown = this.onReclaimTeardown?.(sessionId);
            if (teardown && typeof teardown.then === "function") {
              this.teardownInFlight.add(sessionId);
              void teardown
                .then(() => this.removeSession(sessionId))
                .catch((error) => {
                  console.error(`[SessionIdleReclaim] Error tearing down session ${sessionId}:`, error);
                })
                .finally(() => this.teardownInFlight.delete(sessionId));
            } else {
              this.removeSession(sessionId);
            }
          } catch (err) {
            console.error(`[SessionIdleReclaim] Error tearing down session ${sessionId}:`, err);
          }
        } else {
          this.onCountdown?.(sessionId, remaining);
        }
      }
    }
  }

  connectPeer(sessionId: string, peerId: string, timestamp: number = Date.now()): boolean {
    if (this.idleTimeoutMs === null || !isSafeSessionId(sessionId) || peerId.length === 0) return false;
    let session;
    try {
      session = this.store.get(sessionId);
    } catch {
      return false;
    }
    if (!session || (session.status !== "active" && session.status !== "created")) return false;
    const peers = this.connectedPeers.get(sessionId) ?? new Set<string>();
    peers.add(peerId);
    this.connectedPeers.set(sessionId, peers);
    return this.recordActivity(sessionId, timestamp);
  }

  recordPeerActivity(sessionId: string, peerId: string, timestamp: number = Date.now()): boolean {
    if (!this.connectedPeers.get(sessionId)?.has(peerId)) return false;
    return this.recordActivity(sessionId, timestamp);
  }

  disconnectPeer(sessionId: string, peerId: string): void {
    const peers = this.connectedPeers.get(sessionId);
    if (!peers) return;
    peers.delete(peerId);
    if (peers.size === 0) {
      const state = this.sessionStates.get(sessionId);
      const retryingTeardown = state?.isCountingDown === true && state.countdownRemainingSec <= 0;
      if (retryingTeardown || this.teardownInFlight.has(sessionId)) return;
      if (state?.isCountingDown) {
        this.onCountdownCancelled?.(sessionId);
      }
      this.removeSession(sessionId);
    }
  }

  private hasConnectedPeer(sessionId: string): boolean {
    return (this.connectedPeers.get(sessionId)?.size ?? 0) > 0;
  }

  /**
   * Untracks a session when closed.
   */
  removeSession(sessionId: string): void {
    this.sessionStates.delete(sessionId);
    this.connectedPeers.delete(sessionId);
    this.teardownInFlight.delete(sessionId);
  }
}
