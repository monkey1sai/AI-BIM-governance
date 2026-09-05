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

export const SESSION_IDLE_TIMEOUT_MAX_MS = 2_147_483_647;

export interface SessionIdlePolicySnapshot {
  enabled: boolean;
  timeoutMs: number | null;
  source: "environment" | "operator_override";
  revision: number;
  countdownSeconds: number;
}

export interface SessionActivityState {
  sessionId: string;
  lastActivityAt: number;
  isCountingDown: boolean;
  countdownRemainingSec: number;
  countdownStartedAt?: number;
}

type SessionTeardownCallback = (sessionId: string) => Promise<void> | void;

export class SessionIdleReclaimService {
  private idleTimeoutMs: number | null;
  private policySource: SessionIdlePolicySnapshot["source"] = "environment";
  private policyRevision = 0;
  private readonly countdownSeconds: number;
  private readonly checkIntervalMs: number;
  private readonly onCountdown?: (sessionId: string, remainingSeconds: number) => void;
  private readonly onCountdownCancelled?: (sessionId: string) => void;
  private readonly onReclaimTeardown?: SessionTeardownCallback;

  private readonly sessionStates = new Map<string, SessionActivityState>();
  private readonly connectedPeers = new Map<string, Set<string>>();
  private readonly lastActivityAtBySession = new Map<string, number>();
  private readonly countdownStartedAtBySession = new Map<string, number>();
  private readonly teardownInFlight = new Set<string>();
  private readonly teardownRetryCallbacks = new Map<string, SessionTeardownCallback>();
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
    if (this.isRunning || (this.idleTimeoutMs === null && this.teardownRetryCallbacks.size === 0)) return;
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

  getPolicy(): SessionIdlePolicySnapshot {
    return {
      enabled: this.idleTimeoutMs !== null,
      timeoutMs: this.idleTimeoutMs,
      source: this.policySource,
      revision: this.policyRevision,
      countdownSeconds: this.countdownSeconds,
    };
  }

  private hasPendingTerminalTeardown(): boolean {
    if (this.teardownRetryCallbacks.size > 0 || this.teardownInFlight.size > 0) return true;
    return Array.from(this.sessionStates.values()).some(
      (state) => state.isCountingDown && state.countdownRemainingSec <= 0,
    );
  }

  /**
   * Applies a process-local operator override. Ready sessions restart their
   * inactivity clock at the policy change boundary so a shorter value cannot
   * close an existing session immediately. Terminal teardown retries are kept.
   */
  updateIdleTimeoutMs(timeoutMs: number | null, timestamp: number = Date.now()): SessionIdlePolicySnapshot {
    if (timeoutMs !== null && (
      !Number.isSafeInteger(timeoutMs)
      || timeoutMs < 1
      || timeoutMs > SESSION_IDLE_TIMEOUT_MAX_MS
    )) {
      throw new RangeError(`idle timeout must be null or an integer from 1 to ${SESSION_IDLE_TIMEOUT_MAX_MS}`);
    }

    for (const [sessionId, state] of Array.from(this.sessionStates.entries())) {
      const terminalRetry = (state.isCountingDown && state.countdownRemainingSec <= 0)
        || this.teardownInFlight.has(sessionId)
        || this.teardownRetryCallbacks.has(sessionId);
      if (terminalRetry) continue;
      if (state.isCountingDown) this.onCountdownCancelled?.(sessionId);
      this.sessionStates.delete(sessionId);
      this.lastActivityAtBySession.delete(sessionId);
      this.countdownStartedAtBySession.delete(sessionId);
    }

    this.idleTimeoutMs = timeoutMs;
    this.policySource = "operator_override";
    this.policyRevision += 1;

    if (timeoutMs !== null) {
      for (const [sessionId, peers] of this.connectedPeers.entries()) {
        const existingState = this.sessionStates.get(sessionId);
        const terminalRetry = (existingState?.isCountingDown && existingState.countdownRemainingSec <= 0)
          || this.teardownInFlight.has(sessionId)
          || this.teardownRetryCallbacks.has(sessionId);
        if (peers.size === 0 || terminalRetry) continue;
        let session;
        try {
          session = this.store.get(sessionId);
        } catch {
          continue;
        }
        if (!session || (session.status !== "active" && session.status !== "created")) continue;
        this.sessionStates.set(sessionId, {
          sessionId,
          lastActivityAt: timestamp,
          isCountingDown: false,
          countdownRemainingSec: this.countdownSeconds,
        });
        this.lastActivityAtBySession.set(sessionId, timestamp);
      }
      this.start();
    } else if (!this.hasPendingTerminalTeardown()) {
      this.stop();
    }

    return this.getPolicy();
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
    this.lastActivityAtBySession.set(sessionId, timestamp);
    this.countdownStartedAtBySession.delete(sessionId);
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
    if (this.idleTimeoutMs === null && !this.hasPendingTerminalTeardown()) return;
    for (const [sessionId, state] of Array.from(this.sessionStates.entries())) {
      const retryingTeardown = state.isCountingDown && state.countdownRemainingSec <= 0;
      if (!this.hasConnectedPeer(sessionId) && !retryingTeardown && !this.teardownInFlight.has(sessionId)) {
        this.untrackConnectedSession(sessionId);
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
        if (this.idleTimeoutMs !== null && inactiveDurationMs >= this.idleTimeoutMs) {
          state.isCountingDown = true;
          state.countdownStartedAt = now;
          this.countdownStartedAtBySession.set(sessionId, now);
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
            const teardownCallback = this.teardownRetryCallbacks.get(sessionId) ?? this.onReclaimTeardown;
            const teardown = teardownCallback?.(sessionId);
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
    if (this.idleTimeoutMs === null && !this.hasPendingTerminalTeardown()) this.stop();
  }

  /**
   * Queues a durable close recovery that must retry even when idle reclaim is disabled.
   */
  queueTeardownRetry(sessionId: string, retry: SessionTeardownCallback): boolean {
    if (!isSafeSessionId(sessionId)) return false;
    let session;
    try {
      session = this.store.get(sessionId);
    } catch {
      return false;
    }
    if (!session || (session.status !== "closing" && session.status !== "closed")) return false;
    const now = Date.now();
    this.teardownRetryCallbacks.set(sessionId, retry);
    this.sessionStates.set(sessionId, {
      sessionId,
      lastActivityAt: now,
      isCountingDown: true,
      countdownRemainingSec: 0,
      countdownStartedAt: now - (this.countdownSeconds * 1000),
    });
    this.start();
    return true;
  }

  connectPeer(sessionId: string, peerId: string, timestamp: number = Date.now()): boolean {
    if (!isSafeSessionId(sessionId) || peerId.length === 0) return false;
    let session;
    try {
      session = this.store.get(sessionId);
    } catch {
      return false;
    }
    if (!session || (session.status !== "active" && session.status !== "created")) return false;
    const peers = this.connectedPeers.get(sessionId) ?? new Set<string>();
    const alreadyReady = peers.has(peerId);
    peers.add(peerId);
    this.connectedPeers.set(sessionId, peers);
    if (this.idleTimeoutMs === null) return false;
    if (alreadyReady && this.sessionStates.has(sessionId)) return true;
    if (!this.sessionStates.has(sessionId)) {
      const lastActivityAt = this.lastActivityAtBySession.get(sessionId) ?? timestamp;
      const countdownStartedAt = this.countdownStartedAtBySession.get(sessionId);
      const countdownRemainingSec = countdownStartedAt === undefined
        ? this.countdownSeconds
        : Math.max(0, this.countdownSeconds - Math.floor((timestamp - countdownStartedAt) / 1000));
      this.sessionStates.set(sessionId, {
        sessionId,
        lastActivityAt,
        isCountingDown: countdownStartedAt !== undefined,
        countdownRemainingSec,
        ...(countdownStartedAt === undefined ? {} : { countdownStartedAt }),
      });
      this.lastActivityAtBySession.set(sessionId, lastActivityAt);
    }
    return true;
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
      this.untrackConnectedSession(sessionId);
    }
  }

  /** Returns actual ready-peer presence, independent of retained teardown retry state. */
  hasConnectedPeer(sessionId: string): boolean {
    return (this.connectedPeers.get(sessionId)?.size ?? 0) > 0;
  }

  /**
   * Untracks a session when closed.
   */
  removeSession(sessionId: string): void {
    this.untrackConnectedSession(sessionId);
    this.lastActivityAtBySession.delete(sessionId);
    this.countdownStartedAtBySession.delete(sessionId);
    this.teardownRetryCallbacks.delete(sessionId);
  }

  private untrackConnectedSession(sessionId: string): void {
    this.sessionStates.delete(sessionId);
    this.connectedPeers.delete(sessionId);
    this.teardownInFlight.delete(sessionId);
  }
}
