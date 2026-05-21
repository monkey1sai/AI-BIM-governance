import type { Server } from "socket.io";
import type { EventLog } from "../services/eventLog.js";
import { isSafeSessionId, isSessionMutable } from "../services/sessionStore.js";
import type { SessionStore } from "../services/sessionStore.js";

interface SessionPayload {
  session_id?: string;
  user_id?: string;
  display_name?: string;
  [key: string]: unknown;
}

export function registerReviewNamespace(
  io: Server,
  store: SessionStore,
  eventLog: EventLog,
): void {
  // eventLog 保留為 future lifecycle audit 拓展,join/leave/heartbeat 路徑暫未直接寫入。
  void eventLog;

  const namespace = io.of("/review");

  namespace.on("connection", (socket) => {
    socket.on("joinSession", (payload: SessionPayload, ack?: (response: unknown) => void) => {
      const sessionCheck = validateExistingSession(store, payload);
      if (!sessionCheck.ok) {
        ack?.(sessionCheck);
        return;
      }
      const sessionId = sessionCheck.sessionId;
      const userId = payload.user_id || socket.id;
      const session = store.join(sessionId, {
        user_id: userId,
        display_name: payload.display_name,
      });
      socket.join(sessionId);
      namespace.to(sessionId).emit("presenceUpdated", {
        session_id: sessionId,
        participants: session?.participants || [],
      });
      ack?.({ ok: true, session });
    });

    socket.on("heartbeat", (payload: SessionPayload, ack?: (response: unknown) => void) => {
      ack?.({ ok: true, received_at: new Date().toISOString(), session_id: payload.session_id });
    });

    socket.on("leaveSession", (payload: SessionPayload, ack?: (response: unknown) => void) => {
      const sessionCheck = validateExistingSession(store, payload);
      if (!sessionCheck.ok) {
        ack?.(sessionCheck);
        return;
      }
      const sessionId = sessionCheck.sessionId;
      const userId = payload.user_id || socket.id;
      socket.leave(sessionId);
      const session = store.leave(sessionId, userId);
      namespace.to(sessionId).emit("presenceUpdated", {
        session_id: sessionId,
        participants: session?.participants || [],
      });
      ack?.({ ok: true });
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
  const session = store.get(sessionId);
  if (!session) {
    return { ok: false, error: "Review session not found." };
  }
  if (!isSessionMutable(session)) {
    return { ok: false, error: "Review session is not active." };
  }
  return { ok: true, sessionId };
}
