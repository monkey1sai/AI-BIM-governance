import { io, type Socket } from "socket.io-client";

export interface ReviewSocketHandlers {
    onEvent?: (event: string, payload: unknown) => void;
    onStatus?: (status: string) => void;
}

export interface ReviewSocketClient {
    join(sessionId: string, userId: string, displayName: string): void;
    heartbeat(sessionId: string, userId: string): void;
    disconnect(): void;
}

export function connectReviewSocket(baseUrl: string, handlers: ReviewSocketHandlers = {}): ReviewSocketClient {
    const socket: Socket = io(`${baseUrl}/review`, {
        transports: ["websocket", "polling"],
        autoConnect: true,
    });

    socket.on("connect", () => handlers.onStatus?.("connected"));
    socket.on("disconnect", () => handlers.onStatus?.("disconnected"));
    socket.onAny((event, payload) => handlers.onEvent?.(event, payload));

    return {
        join(sessionId: string, userId: string, displayName: string) {
            socket.emit("joinSession", { session_id: sessionId, user_id: userId, display_name: displayName });
        },
        heartbeat(sessionId: string, userId: string) {
            socket.emit("heartbeat", { session_id: sessionId, actor_id: userId });
        },
        disconnect() {
            socket.disconnect();
        },
    };
}
