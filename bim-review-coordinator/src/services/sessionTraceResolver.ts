import type { ReviewSession } from "../types.js";
import {
  isCanonicalSessionTraceId,
  isIfcReadySessionTraceId,
  type SessionStore,
} from "./sessionStore.js";

export type SessionTraceResolutionError =
  | "session_not_found"
  | "malformed_session_state"
  | "malformed_stored_trace"
  | "malformed_linked_trace"
  | "ambiguous_linked_trace"
  | "session_trace_conflict"
  | "linked_trace_lookup_failed"
  | "stale_session_trace_plan"
  | "session_trace_commit_failed";

export interface SessionTracePlan {
  sessionId: string;
  canonicalTraceId: string;
  needsBackfill: boolean;
}

export type SessionTracePlanResult =
  | { ok: true; plan: SessionTracePlan }
  | { ok: false; error: SessionTraceResolutionError };

export type SessionTraceCommitResult =
  | { ok: true; canonicalTraceId: string; session: ReviewSession }
  | { ok: false; error: SessionTraceResolutionError };

export type LinkedSessionTraceProvider = (sessionId: string) => readonly unknown[];

/**
 * Resolves one server-owned immutable root without relying on mutable job
 * ordering. `plan()` is side-effect free; `commit()` re-resolves before a
 * one-time legacy backfill so rejected Socket.IO candidates cannot mutate the
 * session and stale linked-root observations cannot win a TOCTOU race.
 */
export class SessionTraceResolver {
  constructor(
    private readonly store: SessionStore,
    private readonly linkedTraceProvider: LinkedSessionTraceProvider,
  ) {}

  plan(sessionId: string): SessionTracePlanResult {
    let session: ReviewSession | null;
    try {
      session = this.store.get(sessionId);
    } catch {
      return { ok: false, error: "malformed_session_state" };
    }
    if (!session) return { ok: false, error: "session_not_found" };

    let rawLinkedRoots: readonly unknown[];
    try {
      rawLinkedRoots = this.linkedTraceProvider(sessionId);
    } catch {
      return { ok: false, error: "linked_trace_lookup_failed" };
    }
    if (!Array.isArray(rawLinkedRoots) || rawLinkedRoots.some((root) => !isIfcReadySessionTraceId(root))) {
      return { ok: false, error: "malformed_linked_trace" };
    }
    const linkedRoots = [...new Set(rawLinkedRoots as readonly string[])];
    if (linkedRoots.length > 1) {
      return { ok: false, error: "ambiguous_linked_trace" };
    }

    if (session.trace_id !== undefined) {
      if (!isCanonicalSessionTraceId(session.trace_id, sessionId)) {
        return { ok: false, error: "malformed_stored_trace" };
      }
      if (linkedRoots.length === 1 && linkedRoots[0] !== session.trace_id) {
        return { ok: false, error: "session_trace_conflict" };
      }
      return {
        ok: true,
        plan: {
          sessionId,
          canonicalTraceId: session.trace_id,
          needsBackfill: false,
        },
      };
    }

    return {
      ok: true,
      plan: {
        sessionId,
        canonicalTraceId: linkedRoots[0] ?? `rev_${sessionId}`,
        needsBackfill: true,
      },
    };
  }

  commit(planned: SessionTracePlan): SessionTraceCommitResult {
    const current = this.plan(planned.sessionId);
    if (!current.ok) return current;
    if (current.plan.canonicalTraceId !== planned.canonicalTraceId) {
      return { ok: false, error: "stale_session_trace_plan" };
    }

    try {
      const session = current.plan.needsBackfill
        ? this.store.backfillTraceId(planned.sessionId, planned.canonicalTraceId)
        : this.store.get(planned.sessionId);
      if (!session || session.trace_id !== planned.canonicalTraceId) {
        return { ok: false, error: "session_trace_commit_failed" };
      }
      return { ok: true, canonicalTraceId: planned.canonicalTraceId, session };
    } catch {
      return { ok: false, error: "session_trace_commit_failed" };
    }
  }

  resolveAndCommit(sessionId: string): SessionTraceCommitResult {
    const planned = this.plan(sessionId);
    return planned.ok ? this.commit(planned.plan) : planned;
  }
}
