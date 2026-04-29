import type { Server, Socket } from "socket.io";
import type { BimControlClient } from "../services/bimControlClient.js";
import type { EventLog } from "../services/eventLog.js";
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
  bimControlClient: BimControlClient,
): void {
  const namespace = io.of("/review");

  namespace.on("connection", (socket) => {
    socket.on("joinSession", (payload: SessionPayload, ack?: (response: unknown) => void) => {
      const sessionId = payload.session_id;
      const userId = payload.user_id || socket.id;
      if (!sessionId) {
        ack?.({ ok: false, error: "Missing session_id" });
        return;
      }
      socket.join(sessionId);
      const session = store.join(sessionId, {
        user_id: userId,
        display_name: payload.display_name,
      });
      namespace.to(sessionId).emit("presenceUpdated", {
        session_id: sessionId,
        participants: session?.participants || [],
      });
      ack?.({ ok: true, session });
    });

    socket.on("highlightRequest", (payload: SessionPayload, ack?: (response: unknown) => void) => {
      broadcastSessionEvent(socket, eventLog, "highlightRequest", payload);
      ack?.({ ok: true });
    });

    socket.on("selectionUpdate", (payload: SessionPayload, ack?: (response: unknown) => void) => {
      broadcastSessionEvent(socket, eventLog, "selectionUpdate", payload);
      ack?.({ ok: true });
    });

    socket.on("annotationCreate", async (payload: SessionPayload, ack?: (response: unknown) => void) => {
      try {
        const sessionId = payload.session_id;
        if (!sessionId) throw new Error("Missing session_id");
        const saved = await bimControlClient.createAnnotation(sessionId, payload);
        broadcastSessionEvent(socket, eventLog, "annotationCreated", { ...payload, saved });
        ack?.({ ok: true, saved });
      } catch (error) {
        ack?.({ ok: false, error: error instanceof Error ? error.message : String(error) });
      }
    });

    socket.on("leaveSession", (payload: SessionPayload, ack?: (response: unknown) => void) => {
      const sessionId = payload.session_id;
      const userId = payload.user_id || socket.id;
      if (!sessionId) {
        ack?.({ ok: false, error: "Missing session_id" });
        return;
      }
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
  eventLog: EventLog,
  type: string,
  payload: SessionPayload,
): void {
  const sessionId = payload.session_id;
  if (!sessionId) return;
  eventLog.append(sessionId, type, payload);
  socket.to(sessionId).emit(type, payload);
}
