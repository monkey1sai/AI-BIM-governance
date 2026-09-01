import { io, type Socket } from "socket.io-client";

export const REVIEW_SOCKET_ACK_TIMEOUT_MS = 5_000;

export type ReviewSocketEvent = "joinSession" | "heartbeat" | "streamReadiness" | "userActivity" | "leaveSession";
export type ReviewSocketStatus = "connected" | "disconnected";

export interface ReviewSocketCandidate {
    sessionId: string;
    userId: string;
    displayName: string;
    traceId: string;
}

export type ReviewSocketAck =
    | {
        ok: true;
        trace_id: string;
        session_id?: string;
        session?: unknown;
        received_at?: string;
    }
    | {
        ok: false;
        error: string;
    };

export interface ReviewSocketHandlers {
    onEvent?: (event: string, payload: unknown) => void;
    onStatus?: (status: ReviewSocketStatus) => void;
    onAck?: (event: ReviewSocketEvent, candidate: ReviewSocketCandidate, ack: ReviewSocketAck) => void;
}

export interface ReviewSocketClient {
    join(candidate: ReviewSocketCandidate): void;
    heartbeat(): void;
    setStreamReady(ready: boolean): void;
    userActivity(): Promise<boolean>;
    leave(): void;
    disconnect(): void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeAck(value: unknown): ReviewSocketAck {
    if (!isRecord(value)) {
        return { ok: false, error: "Malformed Socket.IO acknowledgement." };
    }
    if (value.ok === true && typeof value.trace_id === "string" && value.trace_id.length > 0) {
        return {
            ok: true,
            trace_id: value.trace_id,
            ...(typeof value.session_id === "string" ? { session_id: value.session_id } : {}),
            ...(value.session !== undefined ? { session: value.session } : {}),
            ...(typeof value.received_at === "string" ? { received_at: value.received_at } : {}),
        };
    }
    if (value.ok === false && typeof value.error === "string" && value.error.length > 0) {
        return { ok: false, error: value.error };
    }
    return { ok: false, error: "Malformed Socket.IO acknowledgement." };
}

function candidateKey(candidate: ReviewSocketCandidate): string {
    return JSON.stringify([
        candidate.sessionId,
        candidate.userId,
        candidate.displayName,
        candidate.traceId,
    ]);
}

export function connectReviewSocket(baseUrl: string, handlers: ReviewSocketHandlers = {}): ReviewSocketClient {
    const socket: Socket = io(`${baseUrl}/review`, {
        transports: ["websocket", "polling"],
        autoConnect: true,
    });
    const pendingTimers = new Set<ReturnType<typeof setTimeout>>();
    const pendingCancels = new Map<ReturnType<typeof setTimeout>, () => void>();
    let activeCandidate: ReviewSocketCandidate | null = null;
    let joinedCandidateKey: string | null = null;
    let streamReady = false;
    let connectionGeneration = 0;
    let manuallyDisconnected = false;

    const clearPendingTimers = (): void => {
        const cancels = [...pendingCancels.values()];
        for (const timer of pendingTimers) clearTimeout(timer);
        pendingTimers.clear();
        pendingCancels.clear();
        for (const cancel of cancels) cancel();
    };

    const emitWithAck = (
        event: ReviewSocketEvent,
        candidate: ReviewSocketCandidate,
        payload: Record<string, unknown>,
    ): Promise<ReviewSocketAck> => {
        if (!socket.connected || manuallyDisconnected) {
            return Promise.resolve({ ok: false, error: "Socket.IO is not connected." });
        }
        const expectedGeneration = connectionGeneration;
        const expectedCandidateKey = candidateKey(candidate);
        return new Promise((resolve) => {
            let settled = false;

            const settle = (ack: ReviewSocketAck): void => {
                if (settled) return;
                settled = true;
                if (
                    manuallyDisconnected
                    || expectedGeneration !== connectionGeneration
                    || candidateKey(activeCandidate ?? candidate) !== expectedCandidateKey
                ) {
                    resolve({ ok: false, error: "Socket.IO authority changed before acknowledgement." });
                    return;
                }
                if (event === "leaveSession" && ack.ok) {
                    activeCandidate = null;
                    joinedCandidateKey = null;
                }
                handlers.onAck?.(event, candidate, ack);
                resolve(ack);
            };

            const timer = setTimeout(() => {
                pendingTimers.delete(timer);
                pendingCancels.delete(timer);
                settle({ ok: false, error: "Socket.IO acknowledgement timeout." });
            }, REVIEW_SOCKET_ACK_TIMEOUT_MS);
            pendingTimers.add(timer);
            pendingCancels.set(timer, () => settle({ ok: false, error: "Socket.IO request was cancelled." }));

            socket.emit(event, payload, (value: unknown) => {
                clearTimeout(timer);
                pendingTimers.delete(timer);
                pendingCancels.delete(timer);
                settle(normalizeAck(value));
            });
        });
    };

    const emitReadiness = (candidate: ReviewSocketCandidate, ready: boolean): void => {
        void emitWithAck("streamReadiness", candidate, {
            session_id: candidate.sessionId,
            trace_id: candidate.traceId,
            ready,
        });
    };

    const emitJoin = (candidate: ReviewSocketCandidate): void => {
        const expectedKey = candidateKey(candidate);
        void emitWithAck("joinSession", candidate, {
            session_id: candidate.sessionId,
            user_id: candidate.userId,
            display_name: candidate.displayName,
            trace_id: candidate.traceId,
        }).then((ack) => {
            if (!ack.ok || !activeCandidate || candidateKey(activeCandidate) !== expectedKey) return;
            joinedCandidateKey = expectedKey;
            if (streamReady) emitReadiness(candidate, true);
        });
    };

    socket.on("connect", () => {
        connectionGeneration += 1;
        handlers.onStatus?.("connected");
        if (activeCandidate && !manuallyDisconnected) emitJoin(activeCandidate);
    });
    socket.on("disconnect", () => {
        connectionGeneration += 1;
        joinedCandidateKey = null;
        clearPendingTimers();
        handlers.onStatus?.("disconnected");
    });
    socket.onAny((event, payload) => handlers.onEvent?.(event, payload));

    return {
        join(candidate: ReviewSocketCandidate) {
            activeCandidate = { ...candidate };
            if (socket.connected && !manuallyDisconnected) emitJoin(activeCandidate);
        },
        heartbeat() {
            if (!activeCandidate) return;
            void emitWithAck("heartbeat", activeCandidate, {
                session_id: activeCandidate.sessionId,
                actor_id: activeCandidate.userId,
                trace_id: activeCandidate.traceId,
            });
        },
        setStreamReady(ready: boolean) {
            streamReady = ready;
            if (!activeCandidate || joinedCandidateKey !== candidateKey(activeCandidate)) return;
            emitReadiness({ ...activeCandidate }, ready);
        },
        userActivity() {
            if (!activeCandidate) return Promise.resolve(false);
            const candidate = { ...activeCandidate };
            return emitWithAck("userActivity", candidate, {
                session_id: candidate.sessionId,
                trace_id: candidate.traceId,
            }).then((ack) => ack.ok
                && ack.trace_id === candidate.traceId
                && (ack.session_id === undefined || ack.session_id === candidate.sessionId));
        },
        leave() {
            if (!activeCandidate) return;
            streamReady = false;
            void emitWithAck("leaveSession", activeCandidate, {
                session_id: activeCandidate.sessionId,
                user_id: activeCandidate.userId,
                trace_id: activeCandidate.traceId,
            });
        },
        disconnect() {
            manuallyDisconnected = true;
            activeCandidate = null;
            joinedCandidateKey = null;
            streamReady = false;
            connectionGeneration += 1;
            clearPendingTimers();
            socket.disconnect();
        },
    };
}
