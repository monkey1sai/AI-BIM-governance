import { useEffect, useMemo, useRef, useState } from "react";
import type { CloseReviewSessionResponse } from "../clients/coordinatorClient";
import { traceIdFromSearch } from "../lib/structLogBootstrap";
import type { BrowserStructLogger } from "../lib/structLog";
import "./StructuredLogDiagnostics.css";

const REVIEW_SESSION_PATTERN = /^(?:lwv_|review_session_)[A-Za-z0-9_]+$/;
const NOT_OBSERVED = "未觀測";

type FlushState = "idle" | "loading" | "success" | "failure";
type CloseState = "idle" | "closing" | "closed" | "failure";

interface PendingFlushAction {
    actionId: string;
    droppedBefore: number;
    targetFlushedTotal: number;
}

export interface StructuredLogDiagnosticsProps {
    search: string;
    logger: BrowserStructLogger | null;
    reviewSessionId: string | null;
    conversionJobId?: string | null;
    kitInstanceId?: string | null;
    closeReviewSession: (sessionId: string) => Promise<CloseReviewSessionResponse>;
}

// eslint-disable-next-line react-refresh/only-export-components -- exported for case-exact route-gate tests.
export function routeReviewSessionIdFromSearch(search: string): string | null {
    const values = new URLSearchParams(search).getAll("session");
    if (values.length !== 1) return null;
    return values[0].length <= 200 && REVIEW_SESSION_PATTERN.test(values[0]) ? values[0] : null;
}

function nextEvidenceActionId(): string {
    const cryptoGlobal = globalThis.crypto;
    if (cryptoGlobal && typeof cryptoGlobal.randomUUID === "function") {
        return `evidence_action_${cryptoGlobal.randomUUID().replace(/-/g, "")}`;
    }
    return `evidence_action_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function containsAction(logger: BrowserStructLogger, actionId: string): boolean {
    return logger.tail(logger.bufferLength()).some(
        (record) => record.data?.evidence_action_id === actionId,
    );
}

export function StructuredLogDiagnostics({
    search,
    logger,
    reviewSessionId,
    conversionJobId,
    kitInstanceId,
    closeReviewSession,
}: StructuredLogDiagnosticsProps) {
    const [flushState, setFlushState] = useState<FlushState>("idle");
    const [closeState, setCloseState] = useState<CloseState>("idle");
    const pendingFlush = useRef<PendingFlushAction | null>(null);
    const closeInFlight = useRef(false);
    const mounted = useRef(false);
    const routeSessionId = useMemo(() => routeReviewSessionIdFromSearch(search), [search]);
    const routeTraceId = useMemo(() => traceIdFromSearch(search), [search]);
    const loggerRunId = logger?.runId ?? null;
    const loggerTraceId = logger?.traceId ?? null;
    const identity = useMemo(() => ({
        logger,
        loggerRunId,
        loggerTraceId,
        reviewSessionId,
        routeSessionId,
        routeTraceId,
    }), [logger, loggerRunId, loggerTraceId, reviewSessionId, routeSessionId, routeTraceId]);
    const activeIdentity = useRef(identity);
    const previousIdentity = useRef(identity);
    activeIdentity.current = identity;
    const available = Boolean(
        logger
        && routeSessionId
        && routeTraceId
        && reviewSessionId === routeSessionId
        && loggerTraceId === routeTraceId,
    );

    useEffect(() => {
        mounted.current = true;
        return () => {
            mounted.current = false;
            logger?.setAutoFlushPaused(false);
        };
    }, [logger]);

    useEffect(() => {
        const prior = previousIdentity.current;
        if (prior === identity) return;
        if (prior.logger === identity.logger) prior.logger?.setAutoFlushPaused(false);
        previousIdentity.current = identity;
        pendingFlush.current = null;
        closeInFlight.current = false;
        setFlushState("idle");
        setCloseState("idle");
    }, [identity]);

    const runFlush = async () => {
        if (!available || !logger || flushState === "loading" || closeInFlight.current) return;
        const operationIdentity = identity;

        let pending = pendingFlush.current;
        if (!pending) {
            logger.setAutoFlushPaused(true);
            const droppedBefore = logger.droppedTotal();
            const actionId = nextEvidenceActionId();
            logger.info("structuredLogDiagnostics", "manual structured log flush requested", {
                evidence_action_id: actionId,
                review_session_id: reviewSessionId,
            });
            pending = {
                actionId,
                droppedBefore,
                targetFlushedTotal: logger.flushedTotal() + logger.bufferLength(),
            };
            pendingFlush.current = pending;
        }

        setFlushState("loading");
        try {
            await logger.flush();
            if (!mounted.current || activeIdentity.current !== operationIdentity) return;
            const delivered = logger.lastFlushStatus()?.status === "ok"
                && logger.flushedTotal() >= pending.targetFlushedTotal
                && logger.droppedTotal() === pending.droppedBefore
                && !containsAction(logger, pending.actionId);
            if (!delivered) {
                setFlushState("failure");
                return;
            }

            pendingFlush.current = null;
            logger.setAutoFlushPaused(false);
            setFlushState("success");
        } catch {
            if (!mounted.current || activeIdentity.current !== operationIdentity) return;
            setFlushState("failure");
        }
    };

    const runClose = async () => {
        if (
            !available
            || !reviewSessionId
            || closeState === "closing"
            || closeState === "closed"
            || pendingFlush.current
        ) return;
        const operationIdentity = identity;
        closeInFlight.current = true;
        setCloseState("closing");
        try {
            const response = await closeReviewSession(reviewSessionId);
            if (!mounted.current || activeIdentity.current !== operationIdentity) return;
            if (response.session_id !== reviewSessionId || response.status !== "closed") {
                throw new Error("review session close response mismatch");
            }
            setCloseState("closed");
        } catch {
            if (!mounted.current || activeIdentity.current !== operationIdentity) return;
            closeInFlight.current = false;
            setCloseState("failure");
        }
    };

    const actionBusy = flushState === "loading" || closeState === "closing";
    const actionsEnabled = available && closeState !== "closed";
    const closeEnabled = actionsEnabled && flushState !== "failure" && !pendingFlush.current;

    return (
        <aside className="structured-log-diagnostics" data-testid="structured-log-diagnostics" aria-label="Structured log delivery">
            <div className="structured-log-diagnostics__heading">
                <div>
                    <p className="structured-log-diagnostics__eyebrow">Runtime diagnostics</p>
                    <h2>Structured log delivery</h2>
                </div>
                <span className={`structured-log-diagnostics__availability ${available ? "is-ready" : "is-unavailable"}`}>
                    {available ? "Ready" : "Unavailable"}
                </span>
            </div>

            {!available && (
                <p className="structured-log-diagnostics__notice" data-testid="structured-log-unavailable" role="status">
                    Route, session, and root trace must match before delivery actions are available.
                </p>
            )}

            <dl className="structured-log-diagnostics__ids">
                <div data-testid="structured-log-trace-id"><dt>Root trace</dt><dd>{logger?.traceId ?? NOT_OBSERVED}</dd></div>
                <div data-testid="structured-log-run-id"><dt>Browser run</dt><dd>{logger?.runId ?? NOT_OBSERVED}</dd></div>
                <div data-testid="structured-log-session-id"><dt>Review session</dt><dd>{reviewSessionId ?? NOT_OBSERVED}</dd></div>
                <div data-testid="structured-log-conversion-id"><dt>Conversion job</dt><dd>{conversionJobId || NOT_OBSERVED}</dd></div>
                <div data-testid="structured-log-kit-id"><dt>Active Kit</dt><dd>{kitInstanceId || NOT_OBSERVED}</dd></div>
            </dl>

            <div className="structured-log-diagnostics__actions">
                <div className="structured-log-diagnostics__action">
                    <button
                        type="button"
                        className="structured-log-diagnostics__primary"
                        data-testid="structured-log-flush"
                        disabled={!actionsEnabled || actionBusy}
                        onClick={() => { void runFlush(); }}
                    >
                        {flushState === "loading" ? "Flushing…" : "Flush structured logs"}
                    </button>
                    <p
                        className={`structured-log-diagnostics__status is-${flushState}`}
                        data-testid="structured-log-flush-status"
                        data-state={flushState}
                        role={flushState === "failure" ? "alert" : "status"}
                        aria-live="polite"
                    >
                        {flushState === "idle" && "Ready for a user-triggered delivery check."}
                        {flushState === "loading" && "Delivering buffered browser records…"}
                        {flushState === "success" && `Delivered for ${logger?.traceId ?? NOT_OBSERVED} · ${logger?.runId ?? NOT_OBSERVED}.`}
                        {flushState === "failure" && "Delivery failed. Buffered records remain available for retry."}
                    </p>
                    {flushState === "failure" && (
                        <button
                            type="button"
                            className="structured-log-diagnostics__retry"
                            data-testid="structured-log-retry"
                            disabled={!actionsEnabled || actionBusy}
                            onClick={() => { void runFlush(); }}
                        >
                            Retry flush
                        </button>
                    )}
                </div>

                <div className="structured-log-diagnostics__action">
                    <button
                        type="button"
                        className="structured-log-diagnostics__secondary"
                        data-testid="review-session-close"
                        disabled={!closeEnabled || actionBusy}
                        onClick={() => { void runClose(); }}
                    >
                        {closeState === "closing" && "Closing…"}
                        {closeState === "closed" && "Review session closed"}
                        {(closeState === "idle" || closeState === "failure") && "Close review session"}
                    </button>
                    <p
                        className={`structured-log-diagnostics__status is-${closeState}`}
                        data-testid="review-session-close-status"
                        data-state={closeState}
                        role={closeState === "failure" ? "alert" : "status"}
                        aria-live="polite"
                    >
                        {closeState === "idle" && "Cooperative close sends no operator termination reason."}
                        {closeState === "closing" && `Closing ${reviewSessionId ?? NOT_OBSERVED}…`}
                        {closeState === "closed" && `Closed ${reviewSessionId ?? NOT_OBSERVED}.`}
                        {closeState === "failure" && "Close failed. The session was not reported as closed."}
                    </p>
                    {closeState === "failure" && (
                        <button
                            type="button"
                            className="structured-log-diagnostics__retry"
                            data-testid="review-session-close-retry"
                            disabled={!closeEnabled || actionBusy}
                            onClick={() => { void runClose(); }}
                        >
                            Retry close
                        </button>
                    )}
                </div>
            </div>
        </aside>
    );
}
