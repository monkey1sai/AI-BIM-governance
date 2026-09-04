import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    createBrowserLogger,
    type BrowserStructLogger,
    type LogRecord,
    type ViewerLogDeliveryAuthority,
} from "../lib/structLog";
import {
    routeReviewSessionIdFromSearch,
    StructuredLogDiagnostics,
    type StructuredLogDiagnosticsProps,
} from "./StructuredLogDiagnostics";

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
}

describe("StructuredLogDiagnostics", () => {
    const deliveryAuthority: ViewerLogDeliveryAuthority = {
        reviewSessionId: "review_session_diagnostics_x",
        leaseId: "viewer_lease_diagnostics_x",
        leaseToken: "lease_token_diagnostics_x",
    };
    let container: HTMLDivElement;
    let root: Root | null;
    const actEnvKey = "IS_REACT_ACT_ENVIRONMENT" as const;
    let previousActEnv: unknown;

    beforeEach(() => {
        previousActEnv = (globalThis as Record<string, unknown>)[actEnvKey];
        (globalThis as Record<string, unknown>)[actEnvKey] = true;
        container = document.createElement("div");
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(async () => {
        if (root) await act(async () => { root!.unmount(); });
        container.remove();
        vi.restoreAllMocks();
        (globalThis as Record<string, unknown>)[actEnvKey] = previousActEnv;
    });

    const flushReact = async () => {
        for (let i = 0; i < 6; i += 1) {
            await act(async () => { await Promise.resolve(); });
        }
    };

    const q = <T extends HTMLElement = HTMLElement>(testId: string) =>
        container.querySelector<T>(`[data-testid="${testId}"]`);

    const makeLogger = (
        transport: (url: string, body: LogRecord[]) => Promise<{ ok: boolean; status: number; detail?: string }>,
        identity: { runId?: string; traceId?: string } = {},
    ): BrowserStructLogger => createBrowserLogger({
        runId: identity.runId ?? "run_20260728_120000_a3f900",
        initialTraceId: identity.traceId ?? "ifcready_diagnostics_x",
        transport,
        enableTimer: false,
        flushAtRecords: 999,
        flushMaxAttempts: 1,
        flushBackoffMs: 0,
    });

    const renderDiagnostics = async (overrides: Partial<StructuredLogDiagnosticsProps> = {}) => {
        const logger = overrides.logger ?? makeLogger(async () => ({ ok: true, status: 200 }));
        const props: StructuredLogDiagnosticsProps = {
            search: "?session=review_session_diagnostics_x&trace_id=ifcready_diagnostics_x",
            logger,
            reviewSessionId: "review_session_diagnostics_x",
            conversionJobId: "stream_conv_diagnostics_x",
            kitInstanceId: "kit_local_001",
            ensureViewerLogAuthority: async () => deliveryAuthority,
            requestSessionClose: vi.fn(),
            ...overrides,
        };
        await act(async () => { root!.render(<StructuredLogDiagnostics {...props} />); });
        // 診斷面板預設收成 stage 角落 HUD chip（不遮 live 3D）；既有行為契約都針對展開後的
        // 投遞控制，故 helper 一律先展開。收合預設本身另有專屬測試把關。
        await act(async () => { q<HTMLButtonElement>("structured-log-toggle")!.click(); });
        return { logger, props };
    };

    it("預設收成角落 HUD chip（不遮 live 3D stage），且收合態以文字而非只有顏色表述可用性", async () => {
        await act(async () => {
            root!.render(<StructuredLogDiagnostics
                search="?session=review_session_diagnostics_x&trace_id=ifcready_diagnostics_x"
                logger={makeLogger(async () => ({ ok: true, status: 200 }))}
                reviewSessionId="review_session_diagnostics_x"
                conversionJobId="stream_conv_diagnostics_x"
                kitInstanceId="kit_local_001"
                ensureViewerLogAuthority={async () => deliveryAuthority}
                requestSessionClose={() => {}}
            />);
        });

        const toggle = q<HTMLButtonElement>("structured-log-toggle");
        expect(toggle).not.toBeNull();
        expect(q("structured-log-diagnostics")?.getAttribute("data-expanded")).toBe("false");
        expect(toggle?.getAttribute("aria-expanded")).toBe("false");
        // 收合態：投遞控制與 ID 表完全不掛載 → 不可能遮住模型。
        expect(q("structured-log-flush")).toBeNull();
        expect(q("review-session-close")).toBeNull();
        expect(q("structured-log-trace-id")).toBeNull();
        // 可用性必須有文字（色點是 aria-hidden 裝飾），且 chip 仍誠實顯示 Kit 識別碼。
        expect(q("structured-log-chip-readiness")?.textContent).toBe("Ready");
        expect(toggle?.textContent).toContain("kit_local_001");

        await act(async () => { toggle!.click(); });
        expect(q("structured-log-diagnostics")?.getAttribute("data-expanded")).toBe("true");
        expect(q<HTMLButtonElement>("structured-log-flush")?.disabled).toBe(false);
        expect(q("structured-log-trace-id")?.textContent).toContain("ifcready_diagnostics_x");

        await act(async () => { q<HTMLButtonElement>("structured-log-toggle")!.click(); });
        expect(q("structured-log-flush")).toBeNull();
    });

    it("route/session/trace 不一致時，收合態的 chip 就要顯示 Unavailable 文字", async () => {
        await act(async () => {
            root!.render(<StructuredLogDiagnostics
                search="?session=review_session_diagnostics_x&trace_id=ifcready_OTHER"
                logger={makeLogger(async () => ({ ok: true, status: 200 }))}
                reviewSessionId="review_session_diagnostics_x"
                conversionJobId={null}
                kitInstanceId={null}
                ensureViewerLogAuthority={async () => deliveryAuthority}
                requestSessionClose={() => {}}
            />);
        });
        expect(q("structured-log-chip-readiness")?.textContent).toBe("Unavailable");
    });

    it("accepts exactly one valid session carrier and rejects duplicates", () => {
        expect(routeReviewSessionIdFromSearch("?session=review_session_x")).toBe("review_session_x");
        expect(routeReviewSessionIdFromSearch("?session=lwv_x")).toBe("lwv_x");
        expect(routeReviewSessionIdFromSearch("?session=review_session_x&session=review_session_x")).toBeNull();
        expect(routeReviewSessionIdFromSearch("?session=Review_session_x")).toBeNull();
        expect(routeReviewSessionIdFromSearch("?session=review_session_x%2Fclose")).toBeNull();
        expect(routeReviewSessionIdFromSearch(`?session=review_session_${"x".repeat(200)}`)).toBeNull();
    });

    it("shows authoritative identifiers and enables actions only for an exact route/session/trace match", async () => {
        await renderDiagnostics();

        expect(q("structured-log-trace-id")?.textContent).toContain("ifcready_diagnostics_x");
        expect(q("structured-log-run-id")?.textContent).toContain("run_20260728_120000_a3f900");
        expect(q("structured-log-session-id")?.textContent).toContain("review_session_diagnostics_x");
        expect(q("structured-log-conversion-id")?.textContent).toContain("stream_conv_diagnostics_x");
        expect(q("structured-log-kit-id")?.textContent).toContain("kit_local_001");
        expect(q<HTMLButtonElement>("structured-log-flush")?.disabled).toBe(false);
        expect(q<HTMLButtonElement>("review-session-close")?.disabled).toBe(false);

        await act(async () => {
            root!.render(<StructuredLogDiagnostics
                search="?session=review_session_diagnostics_x&trace_id=ifcready_OTHER"
                logger={makeLogger(async () => ({ ok: true, status: 200 }))}
                reviewSessionId="review_session_diagnostics_x"
                conversionJobId={null}
                kitInstanceId={null}
                requestSessionClose={vi.fn()}
            />);
        });
        expect(q("structured-log-unavailable")).not.toBeNull();
        expect(q("structured-log-conversion-id")?.textContent).toContain("未觀測");
        expect(q("structured-log-kit-id")?.textContent).toContain("未觀測");
        expect(q<HTMLButtonElement>("structured-log-flush")?.disabled).toBe(true);
        expect(q<HTMLButtonElement>("review-session-close")?.disabled).toBe(true);
    });

    it.each([
        {
            condition: "the valid route session differs from the loaded session",
            search: "?session=review_session_diagnostics_y&trace_id=ifcready_diagnostics_x",
        },
        {
            condition: "the session carrier is missing",
            search: "?trace_id=ifcready_diagnostics_x",
        },
        {
            condition: "the trace carrier is missing",
            search: "?session=review_session_diagnostics_x",
        },
    ])("keeps actions unavailable when $condition", async ({ search }) => {
        await renderDiagnostics({ search });

        expect(q("structured-log-unavailable")).not.toBeNull();
        expect(q<HTMLButtonElement>("structured-log-flush")?.disabled).toBe(true);
        expect(q<HTMLButtonElement>("review-session-close")?.disabled).toBe(true);
    });

    it("收合後仍誠實顯示投遞失敗，不得回頭顯示 Ready", async () => {
        const firstTransport = deferred<{ ok: boolean; status: number; detail?: string }>();
        let calls = 0;
        const logger = makeLogger(async () => {
            calls += 1;
            if (calls === 1) return firstTransport.promise;
            return { ok: true, status: 200 };
        });
        await renderDiagnostics({ logger });

        // 投遞中：收合態的 chip 必須跟著顯示「進行中」，不能停在 Ready。
        await act(async () => {
            q<HTMLButtonElement>("structured-log-flush")!.click();
            await Promise.resolve();
        });
        expect(q("structured-log-chip-readiness")?.dataset.state).toBe("loading");

        firstTransport.resolve({ ok: false, status: 503, detail: "forced_failure" });
        await flushReact();
        expect(q("structured-log-flush-status")?.dataset.state).toBe("failure");

        // 關鍵契約：使用者在失敗後收合面板，role="alert" 的展開態狀態列會被卸載；
        // 此時 chip 仍必須表述失敗（文字＋alert），否則一次失敗的投遞會被當成 Ready 呈現。
        await act(async () => { q<HTMLButtonElement>("structured-log-toggle")!.click(); });
        expect(q("structured-log-diagnostics")?.getAttribute("data-expanded")).toBe("false");
        expect(q("structured-log-flush-status")).toBeNull();
        const chip = q("structured-log-chip-readiness");
        expect(chip?.dataset.state).toBe("failure");
        expect(chip?.textContent).toBe("Delivery failed");
        expect(chip?.getAttribute("role")).toBe("alert");
        expect(chip?.textContent).not.toBe("Ready");

        // 重新展開重試成功後，chip 回到 Ready。
        await act(async () => { q<HTMLButtonElement>("structured-log-toggle")!.click(); });
        await act(async () => {
            q<HTMLButtonElement>("structured-log-retry")!.click();
            await Promise.resolve();
        });
        await flushReact();
        expect(q("structured-log-flush-status")?.dataset.state).toBe("success");
        await act(async () => { q<HTMLButtonElement>("structured-log-toggle")!.click(); });
        expect(q("structured-log-chip-readiness")?.dataset.state).toBe("ready");
        expect(q("structured-log-chip-readiness")?.getAttribute("role")).toBe("status");
    });

    it("shows loading, retains one action on failure, and retries the same action to success", async () => {
        const firstTransport = deferred<{ ok: boolean; status: number; detail?: string }>();
        const batches: LogRecord[][] = [];
        const logger = makeLogger(async (_url, body) => {
            batches.push(body.map((record) => ({ ...record, data: { ...record.data } })));
            if (batches.length === 1) return firstTransport.promise;
            return { ok: true, status: 200 };
        });
        const pauseCalls: boolean[] = [];
        const setPaused = logger.setAutoFlushPaused.bind(logger);
        logger.setAutoFlushPaused = (paused) => {
            pauseCalls.push(paused);
            setPaused(paused);
        };
        await renderDiagnostics({ logger });

        await act(async () => {
            q<HTMLButtonElement>("structured-log-flush")!.click();
            await Promise.resolve();
        });
        expect(q("structured-log-flush-status")?.dataset.state).toBe("loading");
        const retainedAction = logger.tail(logger.bufferLength())
            .find((record) => typeof record.data?.evidence_action_id === "string");
        expect(retainedAction).toBeDefined();
        const actionId = retainedAction!.data.evidence_action_id;

        firstTransport.resolve({ ok: false, status: 503, detail: "forced_failure" });
        await flushReact();
        expect(q("structured-log-flush-status")?.dataset.state).toBe("failure");
        expect(q("structured-log-retry")).not.toBeNull();
        expect(q<HTMLButtonElement>("review-session-close")?.disabled).toBe(true);
        expect(logger.tail(logger.bufferLength())
            .filter((record) => record.data?.evidence_action_id === actionId)).toHaveLength(1);
        expect(pauseCalls).toEqual([true]);
        expect(container.textContent).not.toContain(String(actionId));

        await act(async () => {
            q<HTMLButtonElement>("structured-log-retry")!.click();
            await Promise.resolve();
        });
        await flushReact();
        expect(q("structured-log-flush-status")?.dataset.state).toBe("success");
        expect(q("structured-log-retry")).toBeNull();
        expect(q<HTMLButtonElement>("review-session-close")?.disabled).toBe(false);
        expect(batches).toHaveLength(2);
        expect(batches[0].filter((record) => record.data?.evidence_action_id === actionId)).toHaveLength(1);
        expect(batches[1].filter((record) => record.data?.evidence_action_id === actionId)).toHaveLength(1);
        expect(logger.tail(logger.bufferLength())
            .some((record) => record.data?.evidence_action_id === actionId)).toBe(false);
        expect(pauseCalls).toEqual([true, false]);
    });

    it("retains the diagnostics action and does not transport when lease authority is unavailable", async () => {
        const transport = vi.fn(async () => ({ ok: true, status: 200 }));
        const logger = makeLogger(transport);
        const ensureViewerLogAuthority = vi.fn(async () => null);
        await renderDiagnostics({ logger, ensureViewerLogAuthority });

        await act(async () => {
            q<HTMLButtonElement>("structured-log-flush")!.click();
            await Promise.resolve();
        });
        await flushReact();

        expect(ensureViewerLogAuthority).toHaveBeenCalledTimes(1);
        expect(transport).not.toHaveBeenCalled();
        expect(q("structured-log-flush-status")?.dataset.state).toBe("failure");
        expect(logger.tail(logger.bufferLength()).filter(
            (record) => typeof record.data?.evidence_action_id === "string",
        )).toHaveLength(1);
    });

    it("resumes auto-flush when a failed diagnostics component unmounts", async () => {
        const logger = makeLogger(async () => ({ ok: false, status: 503 }));
        const pauseCalls: boolean[] = [];
        const setPaused = logger.setAutoFlushPaused.bind(logger);
        logger.setAutoFlushPaused = (paused) => {
            pauseCalls.push(paused);
            setPaused(paused);
        };
        await renderDiagnostics({ logger });
        await act(async () => {
            q<HTMLButtonElement>("structured-log-flush")!.click();
            await Promise.resolve();
        });
        await flushReact();
        expect(q("structured-log-flush-status")?.dataset.state).toBe("failure");

        await act(async () => { root!.unmount(); });
        root = null;
        expect(pauseCalls).toEqual([true, false]);
    });

    it("ignores a stale flush completion after the route identity changes", async () => {
        const firstTransport = deferred<{ ok: boolean; status: number; detail?: string }>();
        const oldLogger = makeLogger(async () => firstTransport.promise);
        const pauseCalls: boolean[] = [];
        const setPaused = oldLogger.setAutoFlushPaused.bind(oldLogger);
        oldLogger.setAutoFlushPaused = (paused) => {
            pauseCalls.push(paused);
            setPaused(paused);
        };
        await renderDiagnostics({ logger: oldLogger });
        await act(async () => {
            q<HTMLButtonElement>("structured-log-flush")!.click();
            await Promise.resolve();
        });
        expect(q("structured-log-flush-status")?.dataset.state).toBe("loading");

        const newLogger = makeLogger(
            async () => ({ ok: true, status: 200 }),
            { runId: "run_20260728_120100_b4f901", traceId: "ifcready_diagnostics_y" },
        );
        await act(async () => {
            root!.render(<StructuredLogDiagnostics
                search="?session=review_session_diagnostics_y&trace_id=ifcready_diagnostics_y"
                logger={newLogger}
                reviewSessionId="review_session_diagnostics_y"
                conversionJobId="stream_conv_diagnostics_y"
                kitInstanceId="kit_local_002"
                requestSessionClose={vi.fn()}
            />);
        });
        firstTransport.resolve({ ok: true, status: 200 });
        await flushReact();

        expect(q("structured-log-flush-status")?.dataset.state).toBe("idle");
        expect(q("structured-log-trace-id")?.textContent).toContain("ifcready_diagnostics_y");
        expect(q("structured-log-run-id")?.textContent).toContain("run_20260728_120100_b4f901");
        expect(q<HTMLButtonElement>("review-session-close")?.disabled).toBe(false);
        expect(pauseCalls).toEqual([true, false]);
    });

    it("delegates terminal close to Session Management without calling a close API", async () => {
        const requestSessionClose = vi.fn();
        await renderDiagnostics({ requestSessionClose });

        await act(async () => { q<HTMLButtonElement>("review-session-close")!.click(); });

        expect(requestSessionClose).toHaveBeenCalledTimes(1);
        expect(requestSessionClose).toHaveBeenCalledWith("review_session_diagnostics_x");
        expect(q("review-session-close-status")?.dataset.state).toBe("delegated");
        expect(q("review-session-close-status")?.textContent).toContain("Session Management");
        expect(q("review-session-close-retry")).toBeNull();
    });
});
