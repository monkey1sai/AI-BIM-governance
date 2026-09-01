import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { ioMock } = vi.hoisted(() => ({
    ioMock: vi.fn(),
}));

vi.mock("socket.io-client", () => ({
    io: ioMock,
}));

import {
    REVIEW_SOCKET_ACK_TIMEOUT_MS,
    connectReviewSocket,
    type ReviewSocketAck,
    type ReviewSocketCandidate,
} from "./reviewSocket";

type Listener = (...args: unknown[]) => void;

class FakeSocket {
    connected = false;
    readonly emitted: Array<{
        event: string;
        payload: Record<string, unknown>;
        ack?: (response: unknown) => void;
    }> = [];

    private readonly listeners = new Map<string, Listener[]>();
    private readonly anyListeners: Listener[] = [];

    on(event: string, listener: Listener): this {
        const listeners = this.listeners.get(event) ?? [];
        listeners.push(listener);
        this.listeners.set(event, listeners);
        return this;
    }

    onAny(listener: Listener): this {
        this.anyListeners.push(listener);
        return this;
    }

    emit(event: string, payload: Record<string, unknown>, ack?: (response: unknown) => void): this {
        this.emitted.push({ event, payload, ack });
        return this;
    }

    disconnect(): this {
        if (this.connected) {
            this.connected = false;
            this.trigger("disconnect", "io client disconnect");
        }
        return this;
    }

    trigger(event: string, ...args: unknown[]): void {
        if (event === "connect") this.connected = true;
        if (event === "disconnect") this.connected = false;
        for (const listener of this.listeners.get(event) ?? []) listener(...args);
    }

    triggerAny(event: string, payload: unknown): void {
        for (const listener of this.anyListeners) listener(event, payload);
    }
}

const CANDIDATE_A: ReviewSocketCandidate = {
    sessionId: "review_session_a",
    userId: "user_a",
    displayName: "User A",
    traceId: "ifcready_root_a",
};

const CANDIDATE_B: ReviewSocketCandidate = {
    sessionId: "review_session_b",
    userId: "user_b",
    displayName: "User B",
    traceId: "rev_review_session_b",
};

describe("connectReviewSocket", () => {
    let socket: FakeSocket;

    beforeEach(() => {
        vi.useFakeTimers();
        socket = new FakeSocket();
        ioMock.mockReturnValue(socket);
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it("buffers the latest join candidate until connect and emits an exact trace carrier", () => {
        const acknowledgements: Array<{ event: string; ack: ReviewSocketAck }> = [];
        const client = connectReviewSocket("http://127.0.0.1:8004", {
            onAck: (event, _candidate, ack) => acknowledgements.push({ event, ack }),
        });

        client.join(CANDIDATE_A);
        expect(socket.emitted).toHaveLength(0);

        socket.trigger("connect");
        expect(socket.emitted).toHaveLength(1);
        expect(socket.emitted[0]).toMatchObject({
            event: "joinSession",
            payload: {
                session_id: CANDIDATE_A.sessionId,
                user_id: CANDIDATE_A.userId,
                display_name: CANDIDATE_A.displayName,
                trace_id: CANDIDATE_A.traceId,
            },
        });

        socket.emitted[0].ack?.({ ok: true, trace_id: CANDIDATE_A.traceId });
        expect(acknowledgements).toEqual([{
            event: "joinSession",
            ack: { ok: true, trace_id: CANDIDATE_A.traceId },
        }]);
    });

    it("emits stream readiness only after join authority and reasserts it after reconnect", async () => {
        const client = connectReviewSocket("http://127.0.0.1:8004");
        client.join(CANDIDATE_A);
        client.setStreamReady(true);

        socket.trigger("connect");
        expect(socket.emitted.map(({ event }) => event)).toEqual(["joinSession"]);
        socket.emitted[0].ack?.({ ok: true, trace_id: CANDIDATE_A.traceId });
        await Promise.resolve();
        expect(socket.emitted[1]).toMatchObject({
            event: "streamReadiness",
            payload: {
                session_id: CANDIDATE_A.sessionId,
                trace_id: CANDIDATE_A.traceId,
                ready: true,
            },
        });

        socket.trigger("disconnect", "transport close");
        socket.trigger("connect");
        expect(socket.emitted[2].event).toBe("joinSession");
        socket.emitted[2].ack?.({ ok: true, trace_id: CANDIDATE_A.traceId });
        await Promise.resolve();
        expect(socket.emitted[3]).toMatchObject({ event: "streamReadiness", payload: { ready: true } });

        client.setStreamReady(false);
        expect(socket.emitted[4]).toMatchObject({ event: "streamReadiness", payload: { ready: false } });
    });

    it("uses the active candidate for heartbeat, activity, and leave without allowing a second root", () => {
        const client = connectReviewSocket("http://127.0.0.1:8004");
        socket.trigger("connect");
        client.join(CANDIDATE_A);
        client.heartbeat();
        client.userActivity();
        client.leave();

        expect(socket.emitted.map(({ event, payload }) => ({ event, payload }))).toEqual([
            {
                event: "joinSession",
                payload: {
                    session_id: CANDIDATE_A.sessionId,
                    user_id: CANDIDATE_A.userId,
                    display_name: CANDIDATE_A.displayName,
                    trace_id: CANDIDATE_A.traceId,
                },
            },
            {
                event: "heartbeat",
                payload: {
                    session_id: CANDIDATE_A.sessionId,
                    actor_id: CANDIDATE_A.userId,
                    trace_id: CANDIDATE_A.traceId,
                },
            },
            {
                event: "userActivity",
                payload: {
                    session_id: CANDIDATE_A.sessionId,
                    trace_id: CANDIDATE_A.traceId,
                },
            },
            {
                event: "leaveSession",
                payload: {
                    session_id: CANDIDATE_A.sessionId,
                    user_id: CANDIDATE_A.userId,
                    trace_id: CANDIDATE_A.traceId,
                },
            },
        ]);
    });

    it("resolves explicit activity only after an exact authority acknowledgement", async () => {
        const client = connectReviewSocket("http://127.0.0.1:8004");
        socket.trigger("connect");
        client.join(CANDIDATE_A);
        socket.emitted[0].ack?.({ ok: true, trace_id: CANDIDATE_A.traceId });

        const accepted = client.userActivity();
        socket.emitted[1].ack?.({
            ok: true,
            trace_id: CANDIDATE_A.traceId,
            session_id: CANDIDATE_A.sessionId,
        });
        await expect(accepted).resolves.toBe(true);

        const mismatched = client.userActivity();
        socket.emitted[2].ack?.({ ok: true, trace_id: CANDIDATE_B.traceId });
        await expect(mismatched).resolves.toBe(false);
    });

    it("normalizes rejected, malformed, and timed-out acknowledgements without inventing a trace", () => {
        const acknowledgements: ReviewSocketAck[] = [];
        const client = connectReviewSocket("http://127.0.0.1:8004", {
            onAck: (_event, _candidate, ack) => acknowledgements.push(ack),
        });
        socket.trigger("connect");

        client.join(CANDIDATE_A);
        socket.emitted[0].ack?.({ ok: false, error: "trace_id does not match session." });

        client.heartbeat();
        socket.emitted[1].ack?.({ ok: true, trace_id: 42 });

        client.heartbeat();
        vi.advanceTimersByTime(REVIEW_SOCKET_ACK_TIMEOUT_MS);

        expect(acknowledgements).toEqual([
            { ok: false, error: "trace_id does not match session." },
            { ok: false, error: "Malformed Socket.IO acknowledgement." },
            { ok: false, error: "Socket.IO acknowledgement timeout." },
        ]);
        expect(acknowledgements.every((ack) => !("trace_id" in ack))).toBe(true);
    });

    it("rejoins only the latest descriptor and ignores acknowledgements from an old connection generation", () => {
        const acknowledgedCandidates: string[] = [];
        const client = connectReviewSocket("http://127.0.0.1:8004", {
            onAck: (_event, candidate, ack) => {
                if (ack.ok) acknowledgedCandidates.push(candidate.traceId);
            },
        });

        client.join(CANDIDATE_A);
        socket.trigger("connect");
        const staleAck = socket.emitted[0].ack;
        socket.trigger("disconnect", "transport close");

        client.join(CANDIDATE_B);
        socket.trigger("connect");
        expect(socket.emitted.filter(({ event }) => event === "joinSession")).toHaveLength(2);
        expect(socket.emitted[1].payload.trace_id).toBe(CANDIDATE_B.traceId);

        staleAck?.({ ok: true, trace_id: CANDIDATE_A.traceId });
        socket.emitted[1].ack?.({ ok: true, trace_id: CANDIDATE_B.traceId });
        expect(acknowledgedCandidates).toEqual([CANDIDATE_B.traceId]);
    });

    it("manual disconnect forgets the descriptor and cannot rejoin on a later connect event", () => {
        const statuses: string[] = [];
        const client = connectReviewSocket("http://127.0.0.1:8004", {
            onStatus: (status) => statuses.push(status),
        });
        client.join(CANDIDATE_A);
        socket.trigger("connect");
        expect(socket.emitted).toHaveLength(1);

        client.disconnect();
        socket.trigger("connect");

        expect(socket.emitted).toHaveLength(1);
        expect(statuses).toEqual(["connected", "disconnected", "connected"]);
    });

    it("forwards non-ack Socket events without treating them as authority", () => {
        const received: Array<{ event: string; payload: unknown }> = [];
        connectReviewSocket("http://127.0.0.1:8004", {
            onEvent: (event, payload) => received.push({ event, payload }),
        });

        socket.triggerAny("presenceUpdated", {
            session_id: CANDIDATE_A.sessionId,
            trace_id: CANDIDATE_A.traceId,
        });

        expect(received).toEqual([{
            event: "presenceUpdated",
            payload: {
                session_id: CANDIDATE_A.sessionId,
                trace_id: CANDIDATE_A.traceId,
            },
        }]);
    });
});
