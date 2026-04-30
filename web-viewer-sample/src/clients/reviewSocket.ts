import { io, type Socket } from "socket.io-client";
import type { HighlightItem } from "../types/streamMessages";

export interface ReviewSocketHandlers {
    onEvent?: (event: string, payload: unknown) => void;
    onStatus?: (status: string) => void;
}

export interface ReviewSocketClient {
    join(sessionId: string, userId: string, displayName: string): void;
    emitHighlight(sessionId: string, userId: string, issueId: string, items: HighlightItem[]): void;
    emitSelection(sessionId: string, userId: string, paths: string[]): void;
    emitAnnotation(sessionId: string, userId: string, text: string): void;
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
        emitHighlight(sessionId: string, userId: string, issueId: string, items: HighlightItem[]) {
            socket.emit("highlightRequest", {
                session_id: sessionId,
                user_id: userId,
                source: "issue_panel",
                issue_id: issueId,
                items: items.map((item) => ({
                    prim_path: item.prim_path,
                    usd_prim_path: item.prim_path,
                    ifc_guid: item.ifc_guid,
                    color: item.color,
                    label: item.label,
                })),
            });
        },
        emitSelection(sessionId: string, userId: string, paths: string[]) {
            socket.emit("selectionUpdate", {
                session_id: sessionId,
                actor_id: userId,
                selected_paths: paths,
            });
        },
        emitAnnotation(sessionId: string, userId: string, text: string) {
            socket.emit("annotationCreate", {
                session_id: sessionId,
                actor_id: userId,
                text,
                target: {
                    usd_prim_path: "/World",
                    ifc_guid: "2VJ3sK9L000fake001",
                },
            });
        },
        heartbeat(sessionId: string, userId: string) {
            socket.emit("heartbeat", { session_id: sessionId, actor_id: userId });
        },
        disconnect() {
            socket.disconnect();
        },
    };
}
