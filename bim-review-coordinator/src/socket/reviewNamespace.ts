import type { Server, Socket } from "socket.io";
import type { BimControlClient } from "../services/bimControlClient.js";
import type { EventLog } from "../services/eventLog.js";
import { isSafeSessionId } from "../services/sessionStore.js";
import type { SessionStore } from "../services/sessionStore.js";

interface SessionPayload {
  session_id?: string;
  user_id?: string;
  display_name?: string;
  [key: string]: unknown;
}

type AckResponse =
  | { ok: true; [key: string]: unknown }
  | { ok: false; error: string };

export function registerReviewNamespace(
  io: Server,
  store: SessionStore,
  eventLog: EventLog,
  bimControlClient: BimControlClient,
): void {
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

    socket.on("highlightRequest", (payload: SessionPayload, ack?: (response: unknown) => void) => {
      ack?.(broadcastSessionEvent(socket, store, eventLog, "highlightRequest", payload));
    });

    socket.on("selectionUpdate", (payload: SessionPayload, ack?: (response: unknown) => void) => {
      ack?.(broadcastSessionEvent(socket, store, eventLog, "selectionUpdate", payload));
    });

    socket.on("heartbeat", (payload: SessionPayload, ack?: (response: unknown) => void) => {
      ack?.({ ok: true, received_at: new Date().toISOString(), session_id: payload.session_id });
    });

    socket.on("annotationCreate", async (payload: SessionPayload, ack?: (response: unknown) => void) => {
      try {
        const sessionCheck = validateExistingSession(store, payload);
        if (!sessionCheck.ok) {
          ack?.(sessionCheck);
          return;
        }
        const sessionId = sessionCheck.sessionId;
        const saved = await bimControlClient.createAnnotation(sessionId, payload);
        const broadcastResult = broadcastSessionEvent(socket, store, eventLog, "annotationCreated", { ...payload, saved });
        if (!broadcastResult.ok) {
          ack?.(broadcastResult);
          return;
        }
        ack?.({ ok: true, saved });
      } catch (error) {
        ack?.({ ok: false, error: error instanceof Error ? error.message : String(error) });
      }
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

function broadcastSessionEvent(
  socket: Socket,
  store: SessionStore,
  eventLog: EventLog,
  type: string,
  payload: SessionPayload,
): AckResponse {
  const sessionCheck = validateExistingSession(store, payload);
  if (!sessionCheck.ok) return sessionCheck;
  const sessionId = sessionCheck.sessionId;
  eventLog.append(sessionId, type, payload);
  socket.to(sessionId).emit(type, payload);
  return { ok: true };
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
  if (!store.get(sessionId)) {
    return { ok: false, error: "Review session not found." };
  }
  return { ok: true, sessionId };
}
