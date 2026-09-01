import type {
  ReviewSocketCandidate,
  ReviewSocketClient,
  ReviewSocketEvent,
  ReviewSocketHandlers,
} from "../clients/reviewSocket";
import {
  HARNESS_REVIEW_AUTHORITY,
  type HarnessReviewAuthority,
} from "./fixtures/reviewAuthority";

export const HARNESS_REVIEW_AUTHORITY_REJECTED = "Harness review authority mismatch.";

type PendingCallback = {
  generation: number;
  allowAfterDisconnect: boolean;
};

function candidateKey(candidate: ReviewSocketCandidate): string {
  return JSON.stringify([
    candidate.sessionId,
    candidate.userId,
    candidate.displayName,
    candidate.traceId,
  ]);
}

function isExactHarnessAuthority(
  candidate: ReviewSocketCandidate,
  authority: HarnessReviewAuthority,
): boolean {
  return candidate.sessionId === authority.sessionId && candidate.traceId === authority.traceId;
}

/**
 * Deterministic dev/E2E Socket substitute. It never learns authority from a
 * caller: only the frozen harness tuple can receive a successful acknowledgement.
 */
export function connectHarnessReviewSocket(
  handlers: ReviewSocketHandlers = {},
  authority: HarnessReviewAuthority = HARNESS_REVIEW_AUTHORITY,
): ReviewSocketClient {
  let activeCandidate: ReviewSocketCandidate | null = null;
  let joinAcknowledged = false;
  let streamReady = false;
  let generation = 0;
  let manuallyDisconnected = false;
  const pendingCallbacks = new Set<PendingCallback>();

  const invalidatePending = (): void => {
    generation += 1;
    pendingCallbacks.clear();
  };

  const schedule = (callback: () => void, allowAfterDisconnect = false): void => {
    const pending = { generation, allowAfterDisconnect };
    pendingCallbacks.add(pending);
    queueMicrotask(() => {
      if (!pendingCallbacks.delete(pending)) return;
      if (pending.generation !== generation) return;
      if (manuallyDisconnected && !pending.allowAfterDisconnect) return;
      callback();
    });
  };

  const successAck = (event: ReviewSocketEvent, candidate: ReviewSocketCandidate): void => {
    handlers.onAck?.(event, candidate, {
      ok: true,
      session_id: authority.sessionId,
      trace_id: authority.traceId,
    });
  };

  return {
    join(candidate: ReviewSocketCandidate): void {
      if (manuallyDisconnected) return;
      invalidatePending();
      activeCandidate = { ...candidate };
      joinAcknowledged = false;
      streamReady = false;
      const expectedCandidate = { ...activeCandidate };
      const expectedKey = candidateKey(expectedCandidate);
      schedule(() => {
        if (!activeCandidate || candidateKey(activeCandidate) !== expectedKey) return;
        handlers.onStatus?.("connected");
        if (!isExactHarnessAuthority(expectedCandidate, authority)) {
          handlers.onAck?.("joinSession", expectedCandidate, {
            ok: false,
            error: HARNESS_REVIEW_AUTHORITY_REJECTED,
          });
          return;
        }
        joinAcknowledged = true;
        successAck("joinSession", expectedCandidate);
      });
    },

    heartbeat(): void {
      if (manuallyDisconnected || !joinAcknowledged || !activeCandidate) return;
      const expectedCandidate = { ...activeCandidate };
      const expectedKey = candidateKey(expectedCandidate);
      schedule(() => {
        if (
          !joinAcknowledged
          || !activeCandidate
          || candidateKey(activeCandidate) !== expectedKey
          || !isExactHarnessAuthority(expectedCandidate, authority)
        ) return;
        successAck("heartbeat", expectedCandidate);
      });
    },

    setStreamReady(ready: boolean): void {
      if (manuallyDisconnected || !joinAcknowledged || !activeCandidate) return;
      streamReady = ready;
      const expectedCandidate = { ...activeCandidate };
      const expectedKey = candidateKey(expectedCandidate);
      schedule(() => {
        if (!joinAcknowledged || !activeCandidate || candidateKey(activeCandidate) !== expectedKey) return;
        successAck("streamReadiness", expectedCandidate);
      });
    },

    userActivity(): Promise<boolean> {
      if (manuallyDisconnected || !joinAcknowledged || !activeCandidate) return Promise.resolve(false);
      const expectedCandidate = { ...activeCandidate };
      const expectedKey = candidateKey(expectedCandidate);
      const expectedGeneration = generation;
      return new Promise((resolve) => {
        queueMicrotask(() => {
          const acknowledged = !manuallyDisconnected
            && generation === expectedGeneration
            && joinAcknowledged
            && streamReady
            && Boolean(activeCandidate)
            && candidateKey(activeCandidate ?? expectedCandidate) === expectedKey
            && isExactHarnessAuthority(expectedCandidate, authority);
          if (acknowledged) successAck("userActivity", expectedCandidate);
          resolve(acknowledged);
        });
      });
    },

    leave(): void {
      if (manuallyDisconnected || !joinAcknowledged || !activeCandidate) return;
      const expectedCandidate = { ...activeCandidate };
      invalidatePending();
      activeCandidate = null;
      joinAcknowledged = false;
      streamReady = false;
      schedule(() => successAck("leaveSession", expectedCandidate));
    },

    disconnect(): void {
      if (manuallyDisconnected) return;
      invalidatePending();
      manuallyDisconnected = true;
      activeCandidate = null;
      joinAcknowledged = false;
      streamReady = false;
      schedule(() => handlers.onStatus?.("disconnected"), true);
    },
  };
}
