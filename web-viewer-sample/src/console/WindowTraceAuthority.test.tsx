import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { connectReviewSocketMock } = vi.hoisted(() => ({
    connectReviewSocketMock: vi.fn(),
}));

vi.mock("../clients/reviewSocket", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../clients/reviewSocket")>();
    return {
        ...actual,
        connectReviewSocket: connectReviewSocketMock,
    };
});

import type {
    ReviewSocketAck,
    ReviewSocketCandidate,
    ReviewSocketClient,
    ReviewSocketEvent,
    ReviewSocketHandlers,
    ReviewSocketStatus,
} from "../clients/reviewSocket";
import AppStream from "../AppStream";
import { reviewEnv } from "../config/env";
import {
    HARNESS_SESSION_ID,
    HARNESS_TRACE_ID,
} from "../harness/fixtures/reviewAuthority";
import type { BrowserStructLogger } from "../lib/structLog";
import type { ReviewStreamConfig } from "../types/review";
import App from "../Window";

const SESSION_ID = "review_session_trace_authority";
const TRACE_ID = "ifcready_trace_authority";

const VIEWER_TO_KIT_EVENTS = [
    "openStageRequest",
    "loadArtifactGroupRequest",
    "composeStageRequest",
    "highlightPrimsRequest",
    "focusPrimRequest",
    "clearHighlightRequest",
    "selectPrimsRequest",
    "makePrimsPickable",
    "resetStage",
    "loadingStateQuery",
    "getChildrenRequest",
] as const;

const KIT_TO_VIEWER_EVENTS = [
    "openedStageResult",
    "loadArtifactGroupResult",
    "highlightPrimsResult",
    "focusPrimResult",
    "selectPrimsResult",
    "makePrimsPickableResponse",
    "resetStageResponse",
    "clearHighlightResult",
    "loadingStateResponse",
    "getChildrenResponse",
    "stageSelectionChanged",
    "updateProgressAmount",
    "updateProgressActivity",
    "bindingApplied",
    "commandRejected",
] as const;

type AppInternals = {
    state: Record<string, unknown>;
    componentMounted: boolean;
    verifiedDataChannelAuthority: {
        sessionId: string;
        traceId: string;
        connectionGeneration: number;
    } | null;
    reviewSocketEpoch: number;
    runtimeCommandContexts: Map<string, unknown>;
    runtimeCommandTerminalClaims: Map<string, unknown>;
    _connectReviewSocket: (sessionId: string, traceId: string) => void;
    _onStreamStarted: (streamGeneration?: number) => void;
    _reportStreamReadinessIfFrame: (streamGeneration?: number) => void;
    _hasRemoteVideoFrame: () => boolean;
    _queryLoadingState: () => void;
    _replaceStreamLifecycle: () => number;
    _pollForKitReady: () => void;
    _bootstrapHarnessSession: () => void;
    _beginStageAttempt: (url: string) => number;
    _sendStreamMessage: (message: { event_type: string; payload: unknown }) => boolean;
    _handleCustomEvent: (event: {
        event_type?: string;
        messageRecipient?: string;
        data?: string;
        payload?: unknown;
    }) => void;
    _appendDemoIncoming: (label: string, payload: unknown) => void;
    _appendDemoOutgoing: (label: string, payload: unknown) => void;
    _appendReviewEvent: (message: string) => void;
    _onViewerUserActivity: (event: Event) => void;
    _reportViewerActivity: () => void;
    _recordSessionActivity: () => Promise<boolean>;
    passiveIdleActivityRequestInFlight: boolean;
    idleActivityRequestInFlight: boolean;
    lastIdleActivityReportAt: number;
    _currentViewerLogDeliveryAuthority: () => {
        reviewSessionId: string;
        leaseId: string;
        leaseToken: string;
    } | null;
    _ensureViewerLogDeliveryAuthority: () => Promise<{
      reviewSessionId: string;
      leaseId: string;
      leaseToken: string;
    } | null>;
    coordinatorClient: {
        recordSessionActivity: (
            sessionId: string,
            leaseId: string,
            leaseToken: string,
        ) => Promise<{ ok: boolean; session_id: string }>;
    };
};

const internals = (app: App): AppInternals => app as unknown as AppInternals;

function streamConfig(traceId = TRACE_ID): ReviewStreamConfig {
    return {
        session_id: SESSION_ID,
        trace_id: traceId,
        lifecycle_status: "active",
        source: "local_fixed",
        webrtc: {
            signalingServer: "127.0.0.1",
            signalingPort: 49100,
            mediaServer: "127.0.0.1",
            mediaPort: null,
        },
        model: {
            status: "ready",
            artifact_id: "artifact_a",
            url: "stage://model.usdc",
            mapping_url: null,
        },
        artifacts: [],
        artifact_bindings: [],
        kit_instance_bindings: [],
    };
}

function loggerMock(initialTraceId = TRACE_ID): BrowserStructLogger {
    return {
        runId: "run_test",
        traceId: initialTraceId,
        bufferLength: vi.fn(() => 0),
        flushedTotal: vi.fn(() => 0),
        droppedTotal: vi.fn(() => 0),
        lastFlushStatus: vi.fn(() => null),
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        fatal: vi.fn(),
        network: vi.fn(),
        lifecycle: vi.fn(),
        anomaly: vi.fn(),
        setTraceId: vi.fn(),
        setAutoFlushPaused: vi.fn(),
        setDeliveryAuthorityProvider: vi.fn(),
        flush: vi.fn(async () => 0),
        tail: vi.fn(() => []),
        shutdown: vi.fn(async () => {}),
    };
}

describe("Window Socket canonical trace authority", () => {
    let handlers: ReviewSocketHandlers;
    let socketClient: ReviewSocketClient;
    let logger: BrowserStructLogger;

    beforeEach(() => {
        window.history.replaceState({}, "", `/?session=${SESSION_ID}&trace_id=${TRACE_ID}`);
        handlers = {};
        socketClient = {
            join: vi.fn(),
            heartbeat: vi.fn(),
            setStreamReady: vi.fn(),
            userActivity: vi.fn(async () => true),
            leave: vi.fn(),
            disconnect: vi.fn(),
        };
        connectReviewSocketMock.mockImplementation((_url: string, nextHandlers: ReviewSocketHandlers) => {
            handlers = nextHandlers;
            return socketClient;
        });
        logger = loggerMock();
        window.__structLog = { logger, tail: () => [] };
        reviewEnv.viewerLeaseToken = "lease_token_a";
        reviewEnv.sourceClientId = "viewer_lease_a";
    });

    afterEach(() => {
        delete window.__structLog;
        reviewEnv.viewerLeaseToken = "";
        reviewEnv.sourceClientId = "dev_user_001";
        vi.restoreAllMocks();
    });

    function readyApp(): App {
        const app = new App({} as never);
        internals(app).componentMounted = true;
        internals(app).state = {
            ...internals(app).state,
            reviewSessionId: SESSION_ID,
            reviewLifecycleStatus: "active",
            latestStreamConfig: streamConfig(),
            webrtcLifecycleStatus: "initializing",
        };
        vi.spyOn(app, "setState").mockImplementation(() => {});
        return app;
    }

    function authorizedApp(options: { synchronousSetState?: boolean } = {}): App {
        const app = readyApp();
        const target = internals(app);
        target.verifiedDataChannelAuthority = {
            sessionId: SESSION_ID,
            traceId: TRACE_ID,
            connectionGeneration: target.reviewSocketEpoch,
        };
        vi.mocked(app.setState).mockImplementation((update: unknown, callback?: () => void) => {
            if (options.synchronousSetState) {
                const patch = typeof update === "function"
                    ? (update as (state: Record<string, unknown>) => Record<string, unknown>)(target.state)
                    : update;
                if (patch && typeof patch === "object") {
                    target.state = { ...target.state, ...(patch as Record<string, unknown>) };
                }
                callback?.();
            }
        });
        return app;
    }

    function rejectionPayload(traceId: unknown): Record<string, unknown> {
        return {
            trace_id: traceId,
            rejected_event_type: "highlightPrimsRequest",
            reason: "lease_invalid",
            rejection_id: "reject_trace_authority",
            retryable: false,
            runtime_state: "unchanged",
        };
    }

    function ack(
        event: ReviewSocketEvent,
        candidate: ReviewSocketCandidate,
        response: ReviewSocketAck,
    ): void {
        handlers.onAck?.(event, candidate, response);
    }

    it("submits only the stream-config trace candidate and grants authority after exact join ack", () => {
        const app = readyApp();
        internals(app)._connectReviewSocket(SESSION_ID, TRACE_ID);

        const candidate: ReviewSocketCandidate = {
            sessionId: SESSION_ID,
            userId: reviewEnv.defaultUserId,
            displayName: reviewEnv.defaultDisplayName,
            traceId: TRACE_ID,
        };
        expect(socketClient.join).toHaveBeenCalledWith(candidate);
        expect(internals(app).verifiedDataChannelAuthority).toBeNull();
        expect(internals(app)._currentViewerLogDeliveryAuthority()).toBeNull();

        handlers.onStatus?.("connected" satisfies ReviewSocketStatus);
        ack("joinSession", candidate, { ok: true, trace_id: TRACE_ID });

        expect(internals(app).verifiedDataChannelAuthority).toMatchObject({
            sessionId: SESSION_ID,
            traceId: TRACE_ID,
        });
        expect(logger.setTraceId).toHaveBeenCalledWith(TRACE_ID);
        expect(internals(app)._currentViewerLogDeliveryAuthority()).toEqual({
            reviewSessionId: SESSION_ID,
            leaseId: "viewer_lease_a",
            leaseToken: "lease_token_a",
        });
    });

    it("reasserts stream readiness when a started stream replaces its review socket", () => {
        const app = readyApp();
        const target = internals(app);
        vi.spyOn(target, "_hasRemoteVideoFrame").mockReturnValue(true);
        target._connectReviewSocket(SESSION_ID, TRACE_ID);
        const firstSocket = socketClient;

        target.state = { ...target.state, webrtcLifecycleStatus: "started" };
        const replacementSocket: ReviewSocketClient = {
            join: vi.fn(),
            heartbeat: vi.fn(),
            setStreamReady: vi.fn(),
            userActivity: vi.fn(async () => true),
            leave: vi.fn(),
            disconnect: vi.fn(),
        };
        socketClient = replacementSocket;
        const sendSpy = vi.spyOn(AppStream, "sendMessage").mockImplementation(() => new Promise(() => {}));

        target._connectReviewSocket(SESSION_ID, TRACE_ID);
        const replacementCandidate = vi.mocked(replacementSocket.join).mock.calls[0][0];
        handlers.onStatus?.("connected");
        ack("joinSession", replacementCandidate, { ok: true, trace_id: TRACE_ID });

        expect(firstSocket.disconnect).toHaveBeenCalledTimes(1);
        expect(replacementSocket.setStreamReady).toHaveBeenCalledWith(true);
        expect(sendSpy).toHaveBeenCalled();
    });

    it("spectator Flush cannot claim a primary viewer lease", async () => {
        window.history.replaceState(
            {},
            "",
            `/?streamRole=spectator&session=${SESSION_ID}&trace_id=${TRACE_ID}`,
        );
        reviewEnv.viewerLeaseToken = "";
        reviewEnv.sourceClientId = "";
        const fetchSpy = vi.spyOn(globalThis, "fetch");
        const app = authorizedApp();

        await expect(internals(app)._ensureViewerLogDeliveryAuthority()).resolves.toBeNull();
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("harness bootstrap keeps authority and transport closed until the async fixed-tuple ack", async () => {
        window.history.replaceState(
            {},
            "",
            `/?harness=1&session=${HARNESS_SESSION_ID}&trace_id=${HARNESS_TRACE_ID}`,
        );
        const app = new App({} as never);
        const target = internals(app);
        target.componentMounted = true;
        const sendSpy = vi.spyOn(AppStream, "sendMessage").mockImplementation(() => new Promise(() => {}));
        vi.spyOn(app, "setState").mockImplementation((update: unknown, callback?: () => void) => {
            const patch = typeof update === "function"
                ? (update as (state: Record<string, unknown>) => Record<string, unknown>)(target.state)
                : update;
            if (patch && typeof patch === "object") {
                target.state = { ...target.state, ...(patch as Record<string, unknown>) };
            }
            callback?.();
        });

        target._bootstrapHarnessSession();

        expect(target.verifiedDataChannelAuthority).toBeNull();
        expect(target._sendStreamMessage({ event_type: "loadingStateQuery", payload: {} })).toBe(false);
        expect(sendSpy).not.toHaveBeenCalled();

        await Promise.resolve();

        expect(target.verifiedDataChannelAuthority).toMatchObject({
            sessionId: HARNESS_SESSION_ID,
            traceId: HARNESS_TRACE_ID,
        });
        expect(logger.setTraceId).toHaveBeenCalledWith(HARNESS_TRACE_ID);
        expect(target._sendStreamMessage({ event_type: "loadingStateQuery", payload: {} })).toBe(true);
        expect(sendSpy).toHaveBeenCalledWith({
            event_type: "loadingStateQuery",
            payload: {
                session_id: HARNESS_SESSION_ID,
                trace_id: HARNESS_TRACE_ID,
            },
        });
    });

    it.each([
        ["missing", `/?harness=1&session=${HARNESS_SESSION_ID}`],
        ["conflicting", `/?harness=1&session=${HARNESS_SESSION_ID}&trace_id=${HARNESS_TRACE_ID.toUpperCase()}`],
        ["duplicate", `/?harness=1&session=${HARNESS_SESSION_ID}&trace_id=${HARNESS_TRACE_ID}&trace_id=${HARNESS_TRACE_ID}`],
        ["missing session", `/?harness=1&trace_id=${HARNESS_TRACE_ID}`],
        ["conflicting session", `/?harness=1&session=${HARNESS_SESSION_ID}_other&trace_id=${HARNESS_TRACE_ID}`],
        ["duplicate session", `/?harness=1&session=${HARNESS_SESSION_ID}&session=${HARNESS_SESSION_ID}&trace_id=${HARNESS_TRACE_ID}`],
    ])("harness bootstrap fails closed for %s route authority", async (_label, search) => {
        window.history.replaceState({}, "", search);
        const app = new App({} as never);
        const target = internals(app);
        target.componentMounted = true;
        vi.spyOn(app, "setState").mockImplementation((update: unknown, callback?: () => void) => {
            const patch = typeof update === "function"
                ? (update as (state: Record<string, unknown>) => Record<string, unknown>)(target.state)
                : update;
            if (patch && typeof patch === "object") {
                target.state = { ...target.state, ...(patch as Record<string, unknown>) };
            }
            callback?.();
        });

        target._bootstrapHarnessSession();
        await Promise.resolve();

        expect(target.verifiedDataChannelAuthority).toBeNull();
        expect(connectReviewSocketMock).not.toHaveBeenCalled();
        expect(target._sendStreamMessage({ event_type: "loadingStateQuery", payload: {} })).toBe(false);
    });

    it.each([
        ["rejected ack", { ok: false, error: "trace_id does not match session." } as ReviewSocketAck],
        ["mismatched success", { ok: true, trace_id: "ifcready_other" } as ReviewSocketAck],
    ])("keeps authority closed for %s", (_label, response) => {
        const app = readyApp();
        internals(app)._connectReviewSocket(SESSION_ID, TRACE_ID);
        handlers.onStatus?.("connected");
        ack("joinSession", {
            sessionId: SESSION_ID,
            userId: reviewEnv.defaultUserId,
            displayName: reviewEnv.defaultDisplayName,
            traceId: TRACE_ID,
        }, response);

        expect(internals(app).verifiedDataChannelAuthority).toBeNull();
        expect(logger.setTraceId).not.toHaveBeenCalled();
        expect(internals(app)._currentViewerLogDeliveryAuthority()).toBeNull();
    });

    it("fails closed before connecting when the URL candidate differs from stream-config", () => {
        window.history.replaceState({}, "", `/?session=${SESSION_ID}&trace_id=ifcready_other`);
        const app = readyApp();

        internals(app)._connectReviewSocket(SESSION_ID, TRACE_ID);

        expect(connectReviewSocketMock).not.toHaveBeenCalled();
        expect(socketClient.join).not.toHaveBeenCalled();
        expect(internals(app).verifiedDataChannelAuthority).toBeNull();
    });

    it("clears authority and stale countdown on disconnect, then requires a fresh exact reconnect ack", () => {
        const app = authorizedApp({ synchronousSetState: true });
        const target = internals(app);
        target._connectReviewSocket(SESSION_ID, TRACE_ID);
        const candidate = vi.mocked(socketClient.join).mock.calls[0][0];
        handlers.onStatus?.("connected");
        ack("joinSession", candidate, { ok: true, trace_id: TRACE_ID });
        expect(target.verifiedDataChannelAuthority).toMatchObject({
            sessionId: SESSION_ID,
            traceId: TRACE_ID,
        });
        target.state = { ...target.state, idleCountdownRemainingSeconds: 6 };

        handlers.onStatus?.("disconnected");
        expect(target.verifiedDataChannelAuthority).toBeNull();
        expect(target.state.idleCountdownRemainingSeconds).toBeNull();

        handlers.onStatus?.("connected");
        expect(target.verifiedDataChannelAuthority).toBeNull();
        ack("joinSession", candidate, { ok: true, trace_id: TRACE_ID });
        expect(target.verifiedDataChannelAuthority).toMatchObject({
            sessionId: SESSION_ID,
            traceId: TRACE_ID,
        });
    });

    it("reports WebRTC readiness only after a remote video frame and clears it before replacing the stream lifecycle", () => {
        const app = readyApp();
        const target = internals(app);
        const hasRemoteVideoFrame = vi.spyOn(target, "_hasRemoteVideoFrame").mockReturnValue(false);
        vi.spyOn(target, "_queryLoadingState").mockImplementation(() => undefined);
        vi.spyOn(app, "setState").mockImplementation((update: unknown, callback?: () => void) => {
            const patch = typeof update === "function"
                ? (update as (state: Record<string, unknown>) => Record<string, unknown>)(target.state)
                : update;
            if (patch && typeof patch === "object") target.state = { ...target.state, ...(patch as Record<string, unknown>) };
            callback?.();
        });
        vi.spyOn(target, "_pollForKitReady").mockImplementation(() => undefined);
        target._connectReviewSocket(SESSION_ID, TRACE_ID);
        const candidate: ReviewSocketCandidate = {
            sessionId: SESSION_ID,
            userId: reviewEnv.defaultUserId,
            displayName: reviewEnv.defaultDisplayName,
            traceId: TRACE_ID,
        };
        ack("joinSession", candidate, { ok: true, trace_id: TRACE_ID });

        target._onStreamStarted();
        expect(socketClient.setStreamReady).not.toHaveBeenCalledWith(true);

        hasRemoteVideoFrame.mockReturnValue(true);
        target._reportStreamReadinessIfFrame();
        expect(socketClient.setStreamReady).toHaveBeenCalledWith(true);

        target.state = { ...target.state, idleCountdownRemainingSeconds: 5 };
        target._replaceStreamLifecycle();
        expect(socketClient.setStreamReady).toHaveBeenLastCalledWith(false);
        expect(target.state.idleCountdownRemainingSeconds).toBeNull();
    });

    it("preserves joined authority when optional user activity is rejected", () => {
        const app = readyApp();
        internals(app)._connectReviewSocket(SESSION_ID, TRACE_ID);
        const candidate = vi.mocked(socketClient.join).mock.calls[0][0];
        handlers.onStatus?.("connected");
        ack("joinSession", candidate, { ok: true, trace_id: TRACE_ID });

        ack("userActivity", candidate, { ok: false, error: "idle reclaim disabled" });

        expect(internals(app).verifiedDataChannelAuthority).toMatchObject({
            sessionId: SESSION_ID,
            traceId: TRACE_ID,
        });
    });

    it("lets the explicit keepalive control own its request instead of pre-cancelling via global activity", () => {
        const app = readyApp();
        const target = internals(app);
        target._connectReviewSocket(SESSION_ID, TRACE_ID);
        const candidate = vi.mocked(socketClient.join).mock.calls[0][0];
        handlers.onStatus?.("connected");
        ack("joinSession", candidate, { ok: true, trace_id: TRACE_ID });
        vi.mocked(socketClient.userActivity).mockClear();
        const button = document.createElement("button");
        button.dataset.testid = "session-idle-keepalive-btn";
        button.addEventListener("pointerdown", target._onViewerUserActivity);

        button.dispatchEvent(new Event("pointerdown", { bubbles: true }));

        expect(socketClient.userActivity).not.toHaveBeenCalled();
    });

    it("registers and removes wheel navigation as passive viewer activity", () => {
        const app = readyApp();
        const target = internals(app);
        vi.spyOn(target as never, "_loadUSDAssets" as never).mockResolvedValue(undefined as never);
        vi.spyOn(target as never, "_bootstrapReview" as never).mockResolvedValue(undefined as never);
        const addEventListener = vi.spyOn(window, "addEventListener");
        const removeEventListener = vi.spyOn(window, "removeEventListener");

        app.componentDidMount();
        expect(addEventListener).toHaveBeenCalledWith("wheel", target._onViewerUserActivity, { passive: true });

        app.componentWillUnmount();
        expect(removeEventListener).toHaveBeenCalledWith("wheel", target._onViewerUserActivity);
    });

    it("uses lease-backed REST for passive activity and throttles only after a positive acknowledgement", async () => {
        const app = authorizedApp({ synchronousSetState: true });
        const target = internals(app);
        target._connectReviewSocket(SESSION_ID, TRACE_ID);
        const candidate = vi.mocked(socketClient.join).mock.calls[0][0];
        handlers.onStatus?.("connected");
        ack("joinSession", candidate, { ok: true, trace_id: TRACE_ID });
        vi.spyOn(target, "_ensureViewerLogDeliveryAuthority").mockResolvedValue({
            reviewSessionId: SESSION_ID,
            leaseId: "lease_passive_activity",
            leaseToken: "lease_token_passive_activity",
        });
        vi.spyOn(target.coordinatorClient, "recordSessionActivity").mockResolvedValue({
            ok: true,
            session_id: SESSION_ID,
        });
        vi.mocked(socketClient.userActivity).mockReturnValue(new Promise(() => {}));

        target._reportViewerActivity();
        target._reportViewerActivity();
        await vi.waitFor(() => expect(target.lastIdleActivityReportAt).toBeGreaterThan(0));
        expect(target.coordinatorClient.recordSessionActivity).toHaveBeenCalledTimes(1);
        expect(socketClient.userActivity).not.toHaveBeenCalled();

        target._reportViewerActivity();
        expect(target.coordinatorClient.recordSessionActivity).toHaveBeenCalledTimes(1);
    });

    it("accepts explicit keepalive through the trace-authorized socket when no REST lease is available", async () => {
        const app = authorizedApp({ synchronousSetState: true });
        const target = internals(app);
        target._connectReviewSocket(SESSION_ID, TRACE_ID);
        const candidate = vi.mocked(socketClient.join).mock.calls[0][0];
        handlers.onStatus?.("connected");
        ack("joinSession", candidate, { ok: true, trace_id: TRACE_ID, session_id: SESSION_ID });
        vi.spyOn(target, "_ensureViewerLogDeliveryAuthority").mockResolvedValue(null);
        vi.mocked(socketClient.userActivity).mockResolvedValue(true);

        await expect(target._recordSessionActivity()).resolves.toBe(true);
        expect(socketClient.userActivity).toHaveBeenCalledTimes(1);
        expect(target.state.idleCountdownRemainingSeconds).toBeNull();
    });

    it("falls back to the trace-authorized socket when lease acquisition exceeds its deadline", async () => {
        vi.useFakeTimers();
        try {
            const app = authorizedApp({ synchronousSetState: true });
            const target = internals(app);
            target._connectReviewSocket(SESSION_ID, TRACE_ID);
            const candidate = vi.mocked(socketClient.join).mock.calls[0][0];
            handlers.onStatus?.("connected");
            ack("joinSession", candidate, { ok: true, trace_id: TRACE_ID, session_id: SESSION_ID });
            vi.spyOn(target, "_ensureViewerLogDeliveryAuthority").mockReturnValue(new Promise(() => {}));
            vi.mocked(socketClient.userActivity).mockResolvedValue(true);

            const keepalive = target._recordSessionActivity();
            await vi.advanceTimersByTimeAsync(1_000);

            await expect(keepalive).resolves.toBe(true);
            expect(socketClient.userActivity).toHaveBeenCalledTimes(1);
            expect(target.state.idleCountdownRemainingSeconds).toBeNull();
        } finally {
            vi.useRealTimers();
        }
    });

    it("falls back to the trace-authorized socket when the REST activity request exceeds its deadline", async () => {
        vi.useFakeTimers();
        try {
            const app = authorizedApp({ synchronousSetState: true });
            const target = internals(app);
            target._connectReviewSocket(SESSION_ID, TRACE_ID);
            const candidate = vi.mocked(socketClient.join).mock.calls[0][0];
            handlers.onStatus?.("connected");
            ack("joinSession", candidate, { ok: true, trace_id: TRACE_ID, session_id: SESSION_ID });
            vi.spyOn(target, "_ensureViewerLogDeliveryAuthority").mockResolvedValue({
                reviewSessionId: SESSION_ID,
                leaseId: "lease_hanging_activity",
                leaseToken: "lease_token_hanging_activity",
            });
            vi.spyOn(target.coordinatorClient, "recordSessionActivity").mockReturnValue(new Promise(() => {}));
            vi.mocked(socketClient.userActivity).mockResolvedValue(true);

            const keepalive = target._recordSessionActivity();
            await vi.advanceTimersByTimeAsync(1_000);

            await expect(keepalive).resolves.toBe(true);
            expect(socketClient.userActivity).toHaveBeenCalledTimes(1);
            expect(target.state.idleCountdownRemainingSeconds).toBeNull();
        } finally {
            vi.useRealTimers();
        }
    });

    it("bounds a dropped socket acknowledgement instead of suppressing later keepalive attempts", async () => {
        vi.useFakeTimers();
        try {
            const app = authorizedApp({ synchronousSetState: true });
            const target = internals(app);
            target._connectReviewSocket(SESSION_ID, TRACE_ID);
            const candidate = vi.mocked(socketClient.join).mock.calls[0][0];
            handlers.onStatus?.("connected");
            ack("joinSession", candidate, { ok: true, trace_id: TRACE_ID, session_id: SESSION_ID });
            vi.spyOn(target, "_ensureViewerLogDeliveryAuthority").mockResolvedValue(null);
            vi.mocked(socketClient.userActivity).mockReturnValue(new Promise(() => {}));

            const keepalive = target._recordSessionActivity();
            await vi.advanceTimersByTimeAsync(1_000);

            await expect(keepalive).resolves.toBe(false);
            expect(target.idleActivityRequestInFlight).toBe(false);
        } finally {
            vi.useRealTimers();
        }
    });

    it("retires socket, stream, and mutation authority on authoritative session close", () => {
        const app = authorizedApp({ synchronousSetState: true });
        const target = internals(app);
        target._connectReviewSocket(SESSION_ID, TRACE_ID);
        const candidate = vi.mocked(socketClient.join).mock.calls[0][0];
        handlers.onStatus?.("connected");
        ack("joinSession", candidate, { ok: true, trace_id: TRACE_ID });
        const stopSpy = vi.spyOn(AppStream, "stop").mockImplementation(() => {});

        handlers.onEvent?.("session:closed", {
            session_id: SESSION_ID,
            trace_id: TRACE_ID,
            reason: "inactivity",
        });

        expect(target.state.reviewLifecycleStatus).toBe("closed");
        expect(target.state.webrtcLifecycleStatus).toBe("stopped");
        expect(target.state.showStream).toBe(false);
        expect(target.verifiedDataChannelAuthority).toBeNull();
        expect(socketClient.disconnect).toHaveBeenCalledTimes(1);
        expect(stopSpy).toHaveBeenCalledTimes(1);
        expect(target._sendStreamMessage({ event_type: "loadingStateQuery", payload: {} })).toBe(false);
    });

    it("replays authoritative closed state when reconnect join is rejected as terminal", () => {
        const app = authorizedApp({ synchronousSetState: true });
        const target = internals(app);
        target._connectReviewSocket(SESSION_ID, TRACE_ID);
        const candidate = vi.mocked(socketClient.join).mock.calls[0][0];
        const stopSpy = vi.spyOn(AppStream, "stop").mockImplementation(() => {});

        handlers.onStatus?.("connected");
        ack("joinSession", candidate, {
            ok: false,
            error: "Review session is not active.",
            session_id: SESSION_ID,
            trace_id: TRACE_ID,
            lifecycle_status: "closed",
            reason: "recovered_close",
        });

        expect(target.state.reviewLifecycleStatus).toBe("closed");
        expect(target.state.idleClosedReason).toBe("recovered_close");
        expect(target.state.webrtcLifecycleStatus).toBe("stopped");
        expect(socketClient.disconnect).toHaveBeenCalledTimes(1);
        expect(stopSpy).toHaveBeenCalledTimes(1);
    });

    it("ignores a late ack from an older socket instance after a session reconnect", () => {
        const app = readyApp();
        internals(app)._connectReviewSocket(SESSION_ID, TRACE_ID);
        const firstHandlers = handlers;
        const firstCandidate = vi.mocked(socketClient.join).mock.calls[0][0];

        internals(app)._connectReviewSocket(SESSION_ID, TRACE_ID);
        firstHandlers.onStatus?.("connected");
        firstHandlers.onAck?.("joinSession", firstCandidate, { ok: true, trace_id: TRACE_ID });

        expect(internals(app).verifiedDataChannelAuthority).toBeNull();
        expect(logger.setTraceId).not.toHaveBeenCalled();
    });

    it("immutably injects the verified case-exact trace into all 11 viewer-to-Kit messages", () => {
        const app = authorizedApp({ synchronousSetState: true });
        const target = internals(app);
        const sendSpy = vi.spyOn(AppStream, "sendMessage").mockImplementation(() => new Promise(() => {}));

        for (const eventType of VIEWER_TO_KIT_EVENTS) {
            const payload = { caller_field: eventType };
            expect(target._sendStreamMessage({ event_type: eventType, payload })).toBe(true);
            expect(payload).toEqual({ caller_field: eventType });
        }

        expect(sendSpy).toHaveBeenCalledTimes(VIEWER_TO_KIT_EVENTS.length);
        for (const [index, call] of sendSpy.mock.calls.entries()) {
            expect(call[0]).toMatchObject({
                event_type: VIEWER_TO_KIT_EVENTS[index],
                payload: { session_id: SESSION_ID, trace_id: TRACE_ID },
            });
            expect((call[0] as Record<string, unknown>).trace_id).toBeUndefined();
        }
    });

    it("preserves an exact caller trace without mutating the caller payload", () => {
        const app = authorizedApp({ synchronousSetState: true });
        const target = internals(app);
        const sendSpy = vi.spyOn(AppStream, "sendMessage").mockImplementation(() => new Promise(() => {}));
        const payload = { session_id: SESSION_ID, trace_id: TRACE_ID, caller_field: "preserve" };

        expect(target._sendStreamMessage({ event_type: "loadingStateQuery", payload })).toBe(true);

        expect(payload).toEqual({ session_id: SESSION_ID, trace_id: TRACE_ID, caller_field: "preserve" });
        expect(sendSpy).toHaveBeenCalledWith({
            event_type: "loadingStateQuery",
            payload: { session_id: SESSION_ID, trace_id: TRACE_ID, caller_field: "preserve" },
        });
    });

    it.each([
        ["mismatched session", { session_id: `${SESSION_ID}_other` }],
        ["non-string session", { session_id: 42 }],
        ["non-string trace", { trace_id: { nested: TRACE_ID } }],
    ])("rejects all 11 outbound messages before side effects for %s", (_label, candidate) => {
        const app = authorizedApp();
        const target = internals(app);
        const sendSpy = vi.spyOn(AppStream, "sendMessage").mockImplementation(() => new Promise(() => {}));
        const outgoingSpy = vi.spyOn(target, "_appendDemoOutgoing").mockImplementation(() => {});

        for (const eventType of VIEWER_TO_KIT_EVENTS) {
            expect(target._sendStreamMessage({ event_type: eventType, payload: candidate })).toBe(false);
        }

        expect(sendSpy).not.toHaveBeenCalled();
        expect(outgoingSpy).not.toHaveBeenCalled();
        expect(app.setState).not.toHaveBeenCalled();
        expect(target.runtimeCommandContexts.size).toBe(0);
    });

    it.each([
        ["caller mismatch", TRACE_ID.toUpperCase()],
        ["missing Socket verification", undefined],
    ])("rejects every viewer-to-Kit message before bookkeeping, logging, or transport for %s", (_label, authority) => {
        const app = authorizedApp();
        const target = internals(app);
        const sendSpy = vi.spyOn(AppStream, "sendMessage").mockImplementation(() => new Promise(() => {}));
        const outgoingSpy = vi.spyOn(target, "_appendDemoOutgoing").mockImplementation(() => {});
        const reviewSpy = vi.spyOn(target, "_appendReviewEvent").mockImplementation(() => {});
        if (authority === undefined) target.verifiedDataChannelAuthority = null;

        for (const eventType of VIEWER_TO_KIT_EVENTS) {
            const payload = authority === undefined ? {} : { trace_id: authority };
            expect(target._sendStreamMessage({ event_type: eventType, payload })).toBe(false);
        }

        expect(sendSpy).not.toHaveBeenCalled();
        expect(outgoingSpy).not.toHaveBeenCalled();
        expect(reviewSpy).not.toHaveBeenCalled();
        expect(app.setState).not.toHaveBeenCalled();
        expect(target.runtimeCommandContexts.size).toBe(0);
        expect(target.runtimeCommandTerminalClaims.size).toBe(0);
    });

    it("rejects a non-object outbound payload before all side effects", () => {
        const app = authorizedApp();
        const target = internals(app);
        const sendSpy = vi.spyOn(AppStream, "sendMessage").mockImplementation(() => new Promise(() => {}));
        const outgoingSpy = vi.spyOn(target, "_appendDemoOutgoing").mockImplementation(() => {});

        expect(target._sendStreamMessage({ event_type: "loadingStateQuery", payload: null })).toBe(false);
        expect(sendSpy).not.toHaveBeenCalled();
        expect(outgoingSpy).not.toHaveBeenCalled();
        expect(app.setState).not.toHaveBeenCalled();
    });

    it.each([undefined, TRACE_ID.toUpperCase()])(
        "rejects all 15 Kit-to-viewer events before correlation, accepted logging, or UI mutation for trace=%s",
        (candidateTrace) => {
            for (const eventType of KIT_TO_VIEWER_EVENTS) {
                const app = authorizedApp();
                const target = internals(app);
                const incomingSpy = vi.spyOn(target, "_appendDemoIncoming").mockImplementation(() => {});
                const reviewSpy = vi.spyOn(target, "_appendReviewEvent").mockImplementation(() => {});
                const payload = eventType === "commandRejected"
                    ? rejectionPayload(candidateTrace)
                    : { ...(candidateTrace === undefined ? {} : { trace_id: candidateTrace }) };

                target._handleCustomEvent({ event_type: eventType, payload });

                expect(incomingSpy, eventType).not.toHaveBeenCalled();
                expect(reviewSpy, eventType).not.toHaveBeenCalled();
                expect(app.setState, eventType).not.toHaveBeenCalled();
                expect(target.runtimeCommandContexts.size, eventType).toBe(0);
                expect(target.runtimeCommandTerminalClaims.size, eventType).toBe(0);
            }
        },
    );

    it("accepts all 15 exact-trace Kit-to-viewer catalog events through the central gate", () => {
        for (const eventType of KIT_TO_VIEWER_EVENTS) {
            const app = authorizedApp();
            const target = internals(app);
            const incomingSpy = vi.spyOn(target, "_appendDemoIncoming").mockImplementation(() => {});
            const payload = eventType === "commandRejected"
                ? rejectionPayload(TRACE_ID)
                : { trace_id: TRACE_ID };

            target._handleCustomEvent({ event_type: eventType, payload });

            expect(incomingSpy, eventType).toHaveBeenCalled();
        }
    });

    it("rejects unknown inbound event types even when they carry the verified trace", () => {
        const app = authorizedApp();
        const target = internals(app);
        const incomingSpy = vi.spyOn(target, "_appendDemoIncoming").mockImplementation(() => {});

        target._handleCustomEvent({ event_type: "unknownKitEvent", payload: { trace_id: TRACE_ID } });

        expect(incomingSpy).not.toHaveBeenCalled();
        expect(app.setState).not.toHaveBeenCalled();
    });

    it.each([
        ["exact", TRACE_ID, true],
        ["missing", undefined, false],
        ["mismatched", TRACE_ID.toUpperCase(), false],
    ])("applies the same central gate immediately after vendor-wrapper parsing for %s trace", (_label, traceId, accepted) => {
        const app = authorizedApp();
        const target = internals(app);
        const incomingSpy = vi.spyOn(target, "_appendDemoIncoming").mockImplementation(() => {});
        const payload = traceId === undefined ? {} : { trace_id: traceId };

        target._handleCustomEvent({
            messageRecipient: "kit",
            data: JSON.stringify({ event_type: "updateProgressAmount", payload }),
        });

        expect(incomingSpy).toHaveBeenCalledTimes(accepted ? 1 : 0);
        if (!accepted) expect(app.setState).not.toHaveBeenCalled();
    });

    it.each([
        "loadingStateQuery",
        "getChildrenRequest",
    ])("copies only the real AppStream result trace into synthetic %s responses", async (eventType) => {
        const app = authorizedApp({ synchronousSetState: true });
        const target = internals(app);
        const inboundSpy = vi.spyOn(target, "_handleCustomEvent").mockImplementation(() => {});
        vi.spyOn(AppStream, "sendMessage").mockResolvedValue({ status: "success", trace_id: TRACE_ID });

        expect(target._sendStreamMessage({ event_type: eventType, payload: {} })).toBe(true);
        await Promise.resolve();

        expect(inboundSpy).toHaveBeenCalledTimes(1);
        const synthetic = inboundSpy.mock.calls[0][0] as Record<string, unknown>;
        expect(synthetic.trace_id).toBeUndefined();
        expect(synthetic.payload).toMatchObject({ trace_id: TRACE_ID });
    });

    it.each([undefined, "", null, 42, { nested: TRACE_ID }])(
        "does not synthesize an inbound event when the AppStream result trace is %j",
        async (resultTrace) => {
            const app = authorizedApp({ synchronousSetState: true });
            const target = internals(app);
            const inboundSpy = vi.spyOn(target, "_handleCustomEvent").mockImplementation(() => {});
            const result = resultTrace === undefined
                ? { status: "success" }
                : { status: "success", trace_id: resultTrace };
            vi.spyOn(AppStream, "sendMessage").mockResolvedValue(result);

            expect(target._sendStreamMessage({ event_type: "openStageRequest", payload: {} })).toBe(true);
            await Promise.resolve();

            expect(inboundSpy).not.toHaveBeenCalled();
        },
    );

    it("uses outbound correlation only for the concrete NVIDIA OpenStageEvent shape", async () => {
        const app = authorizedApp({ synchronousSetState: true });
        const target = internals(app);
        const stageUrl = "stage://native-open-stage.usdc";
        const inboundSpy = vi.spyOn(target, "_handleCustomEvent").mockImplementation(() => {});
        vi.spyOn(AppStream, "sendMessage").mockResolvedValue({
            action: "message",
            status: "success",
            info: "StageOpenedEvent result received",
            url: stageUrl,
        });
        target._beginStageAttempt(stageUrl);

        expect(target._sendStreamMessage({
            event_type: "openStageRequest",
            payload: {
                request_id: "req_native_open_stage",
                binding_revision_id: "rev_native_open_stage",
                url: stageUrl,
            },
        })).toBe(true);
        await Promise.resolve();

        expect(inboundSpy).toHaveBeenCalledWith(expect.objectContaining({
            event_type: "openedStageResult",
            payload: expect.objectContaining({
                trace_id: TRACE_ID,
                request_id: "req_native_open_stage",
                binding_revision_id: "rev_native_open_stage",
                url: "stage://native-open-stage.usdc",
                result: "success",
            }),
        }), expect.any(Number));
    });

    it("maps a trace-less NVIDIA warning to a terminal error, never a success proof", async () => {
        const app = authorizedApp({ synchronousSetState: true });
        const target = internals(app);
        const stageUrl = "stage://native-warning.usdc";
        const inboundSpy = vi.spyOn(target, "_handleCustomEvent").mockImplementation(() => {});
        vi.spyOn(AppStream, "sendMessage").mockResolvedValue({
            action: "message",
            status: "warning",
            info: "StageOpenedEvent payload was not authoritative",
            url: stageUrl,
        });
        target._beginStageAttempt(stageUrl);

        expect(target._sendStreamMessage({
            event_type: "openStageRequest",
            payload: {
                request_id: "req_native_warning",
                binding_revision_id: "rev_native_warning",
                url: stageUrl,
            },
        })).toBe(true);
        await Promise.resolve();

        expect(inboundSpy).toHaveBeenCalledWith(expect.objectContaining({
            event_type: "openedStageResult",
            payload: expect.objectContaining({
                request_id: "req_native_warning",
                binding_revision_id: "rev_native_warning",
                result: "error",
                error: "StageOpenedEvent payload was not authoritative",
            }),
        }), expect.any(Number));
    });

    it("rejects a partial native correlation instead of mixing it with outbound fields", async () => {
        const app = authorizedApp({ synchronousSetState: true });
        const target = internals(app);
        const stageUrl = "stage://partial-native.usdc";
        const inboundSpy = vi.spyOn(target, "_handleCustomEvent").mockImplementation(() => {});
        vi.spyOn(AppStream, "sendMessage").mockResolvedValue({
            status: "success",
            trace_id: TRACE_ID,
            request_id: "req_partial_native",
        });
        target._beginStageAttempt(stageUrl);

        expect(target._sendStreamMessage({
            event_type: "openStageRequest",
            payload: {
                request_id: "req_partial_native",
                binding_revision_id: "rev_partial_native",
                url: stageUrl,
            },
        })).toBe(true);
        await Promise.resolve();

        expect(inboundSpy).not.toHaveBeenCalled();
    });

    it("does not replace a malformed native-looking result trace with outbound correlation", async () => {
        const app = authorizedApp({ synchronousSetState: true });
        const target = internals(app);
        const stageUrl = "stage://native-open-stage.usdc";
        const inboundSpy = vi.spyOn(target, "_handleCustomEvent").mockImplementation(() => {});
        vi.spyOn(AppStream, "sendMessage").mockResolvedValue({
            action: "message",
            status: "success",
            info: "StageOpenedEvent result received",
            url: stageUrl,
            trace_id: null,
        });
        target._beginStageAttempt(stageUrl);

        expect(target._sendStreamMessage({
            event_type: "openStageRequest",
            payload: {
                request_id: "req_malformed_native",
                binding_revision_id: "rev_malformed_native",
                url: stageUrl,
            },
        })).toBe(true);
        await Promise.resolve();

        expect(inboundSpy).not.toHaveBeenCalled();
    });

    it("does not inspect synthetic result status or info before validating the trace carrier", async () => {
        const app = authorizedApp({ synchronousSetState: true });
        const target = internals(app);
        const inboundSpy = vi.spyOn(target, "_handleCustomEvent").mockImplementation(() => {});
        const statusGetter = vi.fn(() => "success");
        const infoGetter = vi.fn(() => "should_not_be_read");
        const result: Record<string, unknown> = {};
        Object.defineProperties(result, {
            status: { get: statusGetter },
            info: { get: infoGetter },
        });
        vi.spyOn(AppStream, "sendMessage").mockResolvedValue(result);

        expect(target._sendStreamMessage({ event_type: "openStageRequest", payload: {} })).toBe(true);
        await Promise.resolve();

        expect(statusGetter).not.toHaveBeenCalled();
        expect(infoGetter).not.toHaveBeenCalled();
        expect(inboundSpy).not.toHaveBeenCalled();
    });

    it("preserves a mismatched result trace for the inbound gate to reject with zero inbound side effects", async () => {
        const app = authorizedApp({ synchronousSetState: true });
        const target = internals(app);
        const incomingSpy = vi.spyOn(target, "_appendDemoIncoming").mockImplementation(() => {});
        vi.spyOn(AppStream, "sendMessage").mockResolvedValue({
            status: "success",
            trace_id: TRACE_ID.toUpperCase(),
        });

        expect(target._sendStreamMessage({ event_type: "openStageRequest", payload: {} })).toBe(true);
        const contextSizeAfterSend = target.runtimeCommandContexts.size;
        vi.mocked(app.setState).mockClear();
        await Promise.resolve();

        expect(incomingSpy).not.toHaveBeenCalled();
        expect(app.setState).not.toHaveBeenCalled();
        expect(target.runtimeCommandContexts.size).toBe(contextSizeAfterSend);
    });

    it("does not synthesize responses for request types without an explicit adapter mapping", async () => {
        const app = authorizedApp({ synchronousSetState: true });
        const target = internals(app);
        const inboundSpy = vi.spyOn(target, "_handleCustomEvent").mockImplementation(() => {});
        vi.spyOn(AppStream, "sendMessage").mockResolvedValue({ status: "success", trace_id: TRACE_ID });

        expect(target._sendStreamMessage({ event_type: "highlightPrimsRequest", payload: {} })).toBe(true);
        await Promise.resolve();

        expect(inboundSpy).not.toHaveBeenCalled();
    });

    it("accepts a decoded frame from the injected GFN video player", () => {
        const app = readyApp();
        const player = document.createElement("video");
        player.id = "gfn-stream-player-video";
        Object.defineProperties(player, {
            readyState: { configurable: true, value: HTMLMediaElement.HAVE_CURRENT_DATA },
            videoWidth: { configurable: true, value: 1280 },
            videoHeight: { configurable: true, value: 720 },
        });
        document.body.appendChild(player);

        try {
            expect(internals(app)._hasRemoteVideoFrame()).toBe(true);
        } finally {
            player.remove();
        }
    });

    // #783：SDK 對 native 指令會自己攔下 Kit 的同名回應，經 fromLoadingStateEvent /
    // fromGetChildrenEvent 重組後 resolve sendMessage 的 promise——trace_id 在這一步被剝掉。
    // 之前 appStreamResultToAppEvent 只認 result.trace_id，等於把每一則正常回應靜默丟掉：
    // isKitReady 永遠 false、永不送 openStageRequest、3D 全黑（181 與本機皆重現）。
    describe("native SDK results without trace_id (#783)", () => {
        function flush(): Promise<void> {
            return new Promise((resolve) => setTimeout(resolve, 0));
        }

        it("loadingStateQuery: trace-less SDK result is re-correlated from the verified outbound trace and marks Kit ready", async () => {
            const app = authorizedApp({ synchronousSetState: true });
            const target = internals(app);
            // 逐字對齊 SDK LogFormatter.fromLoadingStateEvent 的回傳形狀：沒有 trace_id。
            vi.spyOn(AppStream, "sendMessage").mockResolvedValue({
                action: "message",
                status: "success",
                info: "Loading state result received",
                loadingState: "idle",
                url: "",
            });
            const handled = vi.spyOn(target, "_handleCustomEvent");
            // 無 active attempt 時，_canApplyLoadingStateResponse 只認已開串流的探測。
            target.state = { ...target.state, isKitReady: false, webrtcLifecycleStatus: "started" };

            expect(target._sendStreamMessage({ event_type: "loadingStateQuery", payload: {} })).toBe(true);
            await flush();

            expect(handled).toHaveBeenCalledWith(
                {
                    event_type: "loadingStateResponse",
                    payload: { trace_id: TRACE_ID, loading_state: "idle", url: "" },
                },
                expect.any(Number),
            );
            expect(target.state.isKitReady).toBe(true);
        });

        it("getChildrenRequest: the same SDK strip is re-correlated the same way", async () => {
            const app = authorizedApp({ synchronousSetState: true });
            const target = internals(app);
            vi.spyOn(AppStream, "sendMessage").mockResolvedValue({
                action: "message",
                status: "success",
                info: "Get children result received",
                primPath: "/World",
                // key 用 prim_path：純測試資料，避免 PR 契約的 user_facing_route 偵測器把 USD prim path 誤判成路由。
                children: [{ prim_path: "/World/A" }],
            });
            const handled = vi.spyOn(target, "_handleCustomEvent");

            expect(target._sendStreamMessage({ event_type: "getChildrenRequest", payload: { prim_path: "/World" } })).toBe(true);
            await flush();

            expect(handled).toHaveBeenCalledWith(
                expect.objectContaining({
                    event_type: "getChildrenResponse",
                    payload: expect.objectContaining({ trace_id: TRACE_ID, prim_path: "/World" }),
                }),
                expect.any(Number),
            );
        });

        it("a trace_id carried by the result still takes precedence over the outbound trace", async () => {
            const app = authorizedApp({ synchronousSetState: true });
            const target = internals(app);
            vi.spyOn(AppStream, "sendMessage").mockResolvedValue({
                action: "message",
                status: "success",
                info: "Loading state result received",
                trace_id: TRACE_ID,
                loadingState: "busy",
                url: "stage://model.usdc",
            });
            const handled = vi.spyOn(target, "_handleCustomEvent");

            expect(target._sendStreamMessage({ event_type: "loadingStateQuery", payload: {} })).toBe(true);
            await flush();

            expect(handled).toHaveBeenCalledWith(
                expect.objectContaining({
                    event_type: "loadingStateResponse",
                    payload: expect.objectContaining({ trace_id: TRACE_ID, loading_state: "busy" }),
                }),
                expect.any(Number),
            );
        });
    });
});
