import { io, type Socket } from "socket.io-client";
import type { HighlightItem } from "../types/streamMessages";

export interface ReviewSocketClient {
    join(sessionId: string, userId: string, displayName: string): void;
    emitHighlight(sessionId: string, userId: string, issueId: string, items: HighlightItem[]): void;
    disconnect(): void;
}

export function connectReviewSocket(baseUrl: string): ReviewSocketClient {
    const socket: Socket = io(`${baseUrl}/review`, {
        transports: ["websocket", "polling"],
        autoConnect: true,
    });

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
                    usd_prim_path: item.prim_path,
                    ifc_guid: item.ifc_guid,
                    color: item.color,
                    label: item.label,
                })),
            });
        },
        disconnect() {
            socket.disconnect();
        },
    };
}
