import { useEffect, useMemo, useRef, useState } from "react";
import { traceIdFromSearch } from "../lib/structLogBootstrap";
import type { BrowserStructLogger, ViewerLogDeliveryAuthority } from "../lib/structLog";
import "./StructuredLogDiagnostics.css";

const REVIEW_SESSION_PATTERN = /^(?:lwv_|review_session_)[A-Za-z0-9_]+$/;
const NOT_OBSERVED = "未觀測";

type FlushState = "idle" | "loading" | "success" | "failure";

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
    ensureViewerLogAuthority?: () => Promise<ViewerLogDeliveryAuthority | null>;
    requestSessionClose: (sessionId: string) => void;
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
    ensureViewerLogAuthority = async () => null,
    requestSessionClose,
}: StructuredLogDiagnosticsProps) {
    const [flushState, setFlushState] = useState<FlushState>("idle");
    // Omniverse viewport 慣例：疊在 live 3D stage 上的東西只能是角落極輕量 HUD。
    // 本面板是 runtime 佐證工具而非主要工作面，故預設收成 chip，點開才展開，
    // 絕不常駐遮住模型。展開狀態只活在本次 session（不做偏好持久化）。
    const [expanded, setExpanded] = useState(false);
    const pendingFlush = useRef<PendingFlushAction | null>(null);
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
        setFlushState("idle");
    }, [identity]);

    const runFlush = async () => {
        if (!available || !logger || flushState === "loading") return;
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
            const authority = await ensureViewerLogAuthority();
            if (!mounted.current || activeIdentity.current !== operationIdentity) return;
            if (!authority || authority.reviewSessionId !== reviewSessionId) {
                setFlushState("failure");
                return;
            }
            await logger.flush(authority);
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

    const actionBusy = flushState === "loading";
    const actionsEnabled = available;
    const closeEnabled = actionsEnabled && flushState !== "failure" && !pendingFlush.current;

    return (
        <aside
            className={`structured-log-diagnostics${expanded ? " is-expanded" : ""}`}
            data-testid="structured-log-diagnostics"
            data-expanded={expanded ? "true" : "false"}
            aria-label="Structured log delivery"
        >
            <button
                type="button"
                className="structured-log-diagnostics__chip"
                data-testid="structured-log-toggle"
                aria-expanded={expanded}
                title={expanded ? "收合 runtime 診斷" : "展開 runtime 診斷（structured log 投遞）"}
                onClick={() => setExpanded((value) => !value)}
            >
                {/* 色點只是輔助；可用性一律同時以文字表述，否則螢幕閱讀器與色覺障礙
                    使用者在收合態無從得知投遞是否可用。 */}
                <span className={`structured-log-diagnostics__dot ${available ? "is-ready" : "is-unavailable"}`} aria-hidden="true" />
                <span className="structured-log-diagnostics__chip-label">Runtime diagnostics</span>
                <span
                    className={`structured-log-diagnostics__chip-state ${available ? "is-ready" : "is-unavailable"}`}
                    data-testid="structured-log-chip-readiness"
                >
                    {available ? "Ready" : "Unavailable"}
                </span>
                <span className="structured-log-diagnostics__chip-id">{kitInstanceId || reviewSessionId || NOT_OBSERVED}</span>
                <span className="structured-log-diagnostics__chev" aria-hidden="true">{expanded ? "\u2304" : "\u02c4"}</span>
            </button>

            {expanded && (
            <div className="structured-log-diagnostics__panel">
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
                        onClick={() => { if (reviewSessionId) requestSessionClose(reviewSessionId); }}
                    >
                        Manage Review Session close
                    </button>
                    <p
                        className="structured-log-diagnostics__status is-idle"
                        data-testid="review-session-close-status"
                        data-state="delegated"
                        role="status"
                        aria-live="polite"
                    >
                        Terminal close is available only in Session Management with the irreversible-action confirmation.
                    </p>
                </div>
            </div>
            </div>
            )}
        </aside>
    );
}
