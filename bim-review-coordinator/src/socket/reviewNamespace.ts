import type { Server } from "socket.io";
import type { EventLog } from "../services/eventLog.js";
import {
  isCanonicalSessionTraceId,
  isSafeSessionId,
  isSessionMutable,
} from "../services/sessionStore.js";
import type { SessionStore } from "../services/sessionStore.js";
import type { SessionTraceResolver } from "../services/sessionTraceResolver.js";

interface SessionPayload {
  session_id?: string;
  user_id?: string;
  display_name?: string;
  trace_id?: string;
  [key: string]: unknown;
}

export function registerReviewNamespace(
  io: Server,
  store: SessionStore,
  eventLog: EventLog,
  traceResolver: SessionTraceResolver,
): void {
  // eventLog 保留為 future lifecycle audit 拓展,join/leave/heartbeat 路徑暫未直接寫入。
  void eventLog;

  const namespace = io.of("/review");

  namespace.on("connection", (socket) => {
    let membership: SocketMembership | null = null;

    socket.on("joinSession", (payload: SessionPayload, ack?: (response: unknown) => void) => {
      const sessionCheck = validateExistingSession(store, payload);
      if (!sessionCheck.ok) {
        ack?.(sessionCheck);
        return;
      }
      const sessionId = sessionCheck.sessionId;
      const traceCheck = authorizeCanonicalTrace(traceResolver, sessionId, payload.trace_id);
      if (!traceCheck.ok) {
        ack?.(traceCheck);
        return;
      }
      if (membership && membership.sessionId !== sessionId) {
        ack?.({ ok: false, error: "Socket is already joined to another review session." });
        return;
      }
      // Presence identity is server-owned. payload.user_id remains accepted for
      // wire compatibility but can never replace another socket's participant.
      const userId = `socket:${socket.id}`;
      const displayName = typeof payload.display_name === "string"
        ? payload.display_name.slice(0, 200)
        : undefined;
      const session = store.join(sessionId, {
        user_id: userId,
        display_name: displayName,
      });
      if (!session) {
        ack?.({ ok: false, error: "Review session unavailable." });
        return;
      }
      membership = { sessionId, userId, traceId: traceCheck.traceId };
      socket.join(sessionId);
      namespace.to(sessionId).emit("presenceUpdated", {
        session_id: sessionId,
        trace_id: traceCheck.traceId,
        participants: session.participants,
      });
      ack?.({ ok: true, trace_id: traceCheck.traceId, session });
    });

    socket.on("heartbeat", (payload: SessionPayload, ack?: (response: unknown) => void) => {
      const sessionCheck = validateExistingSession(store, payload);
      if (!sessionCheck.ok) {
        ack?.(sessionCheck);
        return;
      }
      const traceCheck = authorizeCanonicalTrace(traceResolver, sessionCheck.sessionId, payload.trace_id);
      if (!traceCheck.ok) {
        ack?.(traceCheck);
        return;
      }
      if (!membership || membership.sessionId !== sessionCheck.sessionId) {
        ack?.({ ok: false, error: "Socket is not joined to this review session." });
        return;
      }
      ack?.({
        ok: true,
        received_at: new Date().toISOString(),
        session_id: sessionCheck.sessionId,
        trace_id: traceCheck.traceId,
      });
    });

    socket.on("leaveSession", (payload: SessionPayload, ack?: (response: unknown) => void) => {
      const sessionCheck = validateExistingSession(store, payload);
      if (!sessionCheck.ok) {
        ack?.(sessionCheck);
        return;
      }
      const sessionId = sessionCheck.sessionId;
      const traceCheck = authorizeCanonicalTrace(traceResolver, sessionId, payload.trace_id);
      if (!traceCheck.ok) {
        ack?.(traceCheck);
        return;
      }
      if (!membership || membership.sessionId !== sessionId) {
        ack?.({ ok: false, error: "Socket is not joined to this review session." });
        return;
      }
      const session = store.leave(sessionId, membership.userId);
      if (!session) {
        ack?.({ ok: false, error: "Review session unavailable." });
        return;
      }
      membership = null;
      namespace.to(sessionId).emit("presenceUpdated", {
        session_id: sessionId,
        trace_id: traceCheck.traceId,
        participants: session.participants,
      });
      socket.leave(sessionId);
      ack?.({ ok: true, trace_id: traceCheck.traceId });
    });

    socket.on("disconnect", () => {
      const active = membership;
      membership = null;
      if (!active) return;
      const session = store.leave(active.sessionId, active.userId);
      if (!session) return;
      namespace.to(active.sessionId).emit("presenceUpdated", {
        session_id: active.sessionId,
        trace_id: active.traceId,
        participants: session.participants,
      });
    });
  });
}

function validateExistingSession(
  store: SessionStore,
  payload: SessionPayload,
): { ok: true; sessionId: string } | { ok: false; error: string } {
  const sessionId = payload.session_id;
  if (!sessionId) {
    return { ok: false, error: "Missing session_id" };
  }
  if (!isSafeSessionId(sessionId)) {
    return { ok: false, error: "Invalid review session id." };
  }
  let session;
  try {
    session = store.get(sessionId);
  } catch {
    return { ok: false, error: "Review session unavailable." };
  }
  if (!session) {
    return { ok: false, error: "Review session not found." };
  }
  if (!isSessionMutable(session)) {
    return { ok: false, error: "Review session is not active." };
  }
  return { ok: true, sessionId };
}

interface SocketMembership {
  sessionId: string;
  userId: string;
  traceId: string;
}

function authorizeCanonicalTrace(
  resolver: SessionTraceResolver,
  sessionId: string,
  candidate: unknown,
): { ok: true; traceId: string } | { ok: false; error: string } {
  if (candidate === undefined || candidate === null || candidate === "") {
    return { ok: false, error: "Missing trace_id" };
  }
  if (!isCanonicalSessionTraceId(candidate, sessionId)) {
    return { ok: false, error: "Invalid trace_id." };
  }
  const planned = resolver.plan(sessionId);
  if (!planned.ok) {
    return { ok: false, error: "Session trace authority unavailable." };
  }
  if (candidate !== planned.plan.canonicalTraceId) {
    return { ok: false, error: "trace_id does not match session." };
  }
  const committed = resolver.commit(planned.plan);
  return committed.ok
    ? { ok: true, traceId: committed.canonicalTraceId }
    : { ok: false, error: "Session trace authority unavailable." };
}
