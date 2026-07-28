/**
 * Verification script for src/lib/structLog.ts (viewer adapter).
 *
 * Strategy mirrors verify-session-first-contract.mjs: transpile the adapter
 * with the TypeScript compiler and evaluate it in this Node process with a
 * mock transport. We cannot use Vitest because the viewer repo intentionally
 * skips a test framework (per package.json).
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import ts from "typescript";

const repoRoot = process.cwd();
const structLogPath = path.join(repoRoot, "src/lib/structLog.ts");
const localRequire = createRequire(structLogPath);

function loadStructLogModule() {
    const source = fs.readFileSync(structLogPath, "utf8");
    const compiled = ts.transpileModule(source, {
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2020,
            esModuleInterop: true,
        },
    });
    const module = { exports: {} };
    const fn = new Function("exports", "module", "require", compiled.outputText);
    fn(module.exports, module, localRequire);
    return module.exports;
}

const { createBrowserLogger, generateRunId, isoUtcMs } = loadStructLogModule();
const TEST_DELIVERY_AUTHORITY = {
    reviewSessionId: "review_session_log_delivery",
    leaseId: "viewer_lease_log_delivery",
    leaseToken: "lease_token_log_delivery",
};

let testCount = 0;
function test(name, fn) {
    testCount += 1;
    try {
        const result = fn();
        if (result && typeof result.then === "function") {
            return result.then(
                () => console.log(`  PASS  ${name}`),
                (err) => {
                    console.error(`  FAIL  ${name}\n         ${err.message}`);
                    process.exitCode = 1;
                },
            );
        }
        console.log(`  PASS  ${name}`);
        return null;
    } catch (err) {
        console.error(`  FAIL  ${name}\n         ${err.message}`);
        process.exitCode = 1;
        return null;
    }
}

function freezeClock(start) {
    const fixed = new Date(start);
    return () => new Date(fixed.getTime());
}

function deferred() {
    let resolve;
    const promise = new Promise((resolvePromise) => {
        resolve = resolvePromise;
    });
    return { promise, resolve };
}

async function exerciseDefaultTransport(responseFactory, extraRecords = 0, fetchObserver = () => undefined) {
    const originalFetchDescriptor = Object.getOwnPropertyDescriptor(globalThis, "fetch");
    Object.defineProperty(globalThis, "fetch", {
        configurable: true,
        writable: true,
        value: async (url, init) => {
            fetchObserver(url, init);
            return responseFactory();
        },
    });

    try {
        const logger = createBrowserLogger({
            runId: "run_20260526_142010_a3f900",
            initialTraceId: "ifcready_ack_contract",
            enableTimer: false,
            flushAtRecords: 999,
            flushMaxAttempts: 1,
            deliveryAuthority: () => TEST_DELIVERY_AUTHORITY,
        });
        for (let i = 0; i < extraRecords; i += 1) logger.info("app", `ack-${i}`);
        const flushed = await logger.flush();
        return {
            flushed,
            bufferLength: logger.bufferLength(),
            lastFlushStatus: logger.lastFlushStatus(),
        };
    } finally {
        if (originalFetchDescriptor) {
            Object.defineProperty(globalThis, "fetch", originalFetchDescriptor);
        } else {
            delete globalThis.fetch;
        }
    }
}

function ackResponse(payload) {
    return {
        ok: true,
        status: 200,
        json: async () => payload,
        text: async () => JSON.stringify(payload),
    };
}

// ---------------------------------------------------------------------------
// generateRunId pattern (matches schema.json)
// ---------------------------------------------------------------------------

test("generateRunId emits run_<YYYYMMDD>_<HHMMSS>_<6 hex>", () => {
    const runId = generateRunId(new Date("2026-05-26T14:20:10Z"), () => "a3f900");
    assert.equal(runId, "run_20260526_142010_a3f900");
    assert.match(runId, /^run_\d{8}_\d{6}_[0-9a-f]{6}$/);
});

test("isoUtcMs always emits millisecond precision", () => {
    assert.equal(isoUtcMs(new Date("2026-05-26T14:23:11.482Z")), "2026-05-26T14:23:11.482Z");
    assert.equal(isoUtcMs(new Date("2026-05-26T14:23:11Z")), "2026-05-26T14:23:11.000Z");
});

// ---------------------------------------------------------------------------
// Logger basic record shape
// ---------------------------------------------------------------------------

const REQUIRED_FIELDS = ["ts", "level", "event_type", "service", "component", "run_id", "trace_id", "msg", "data"];

await test("factory buffers exactly one browser-safe env snapshot and flushes that same record", async () => {
    const calls = [];
    const hostileSentinels = {
        query: "query-secret-sentinel",
        localStorage: "local-storage-secret-sentinel",
        sessionStorage: "session-storage-secret-sentinel",
        cookie: "cookie-secret-sentinel",
        token: "token-secret-sentinel",
        window: "window-secret-sentinel",
        importMetaEnv: "import-meta-env-secret-sentinel",
    };
    const globalNames = ["window", "document", "localStorage", "sessionStorage"];
    const originalDescriptors = new Map(
        globalNames.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]),
    );

    Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: {
            location: { origin: "http://127.0.0.1:5173", search: `?trace_id=${hostileSentinels.query}` },
            arbitraryProperty: hostileSentinels.window,
        },
    });
    Object.defineProperty(globalThis, "document", {
        configurable: true,
        value: { cookie: hostileSentinels.cookie },
    });
    Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        value: { arbitrary: hostileSentinels.localStorage },
    });
    Object.defineProperty(globalThis, "sessionStorage", {
        configurable: true,
        value: { arbitrary: hostileSentinels.sessionStorage },
    });

    try {
        const logger = createBrowserLogger({
            runId: "run_20260526_142010_a3f900",
            initialTraceId: "ifcready_browser_snapshot_trace",
            browserSnapshotVars: [
                {
                    key: "VIEWER_PORT",
                    source: "default",
                    value_or_redacted: "5173",
                    type: "string",
                    query: hostileSentinels.query,
                    localStorage: hostileSentinels.localStorage,
                    sessionStorage: hostileSentinels.sessionStorage,
                    cookie: hostileSentinels.cookie,
                    token: hostileSentinels.token,
                    arbitraryWindowProperty: hostileSentinels.window,
                    importMetaEnv: hostileSentinels.importMetaEnv,
                },
                {
                    key: "VIEWER_API_TOKEN",
                    source: "system",
                    value_or_redacted: "browser-token-sentinel",
                    type: "string",
                },
                {
                    key: "BROWSER_THEME",
                    source: "default",
                    value_or_redacted: "dark-theme-sentinel",
                    type: "string",
                },
            ],
            endpoint: "http://127.0.0.1:8004/api/internal/viewer-log",
            transport: async (_url, body) => {
                calls.push(body);
                return { ok: true, status: 200 };
            },
            enableTimer: false,
            flushAtRecords: 99,
        });

        assert.equal(logger.bufferLength(), 1, "factory return must already contain one startup record");
        assert.equal(calls.length, 0, "factory must not synchronously transport the startup record");
        const [snapshot] = logger.tail();
        assert.equal(snapshot.event_type, "env_snapshot");
        assert.equal(snapshot.component, "bootstrap");
        assert.equal(snapshot.msg, "browser env snapshot");
        assert.equal(snapshot.trace_id, "ifcready_browser_snapshot_trace");
        assert.equal(snapshot.seq, 1);
        assert.deepEqual(snapshot.data.vars, [
            {
                key: "VIEWER_PORT",
                source: "default",
                value_or_redacted: "5173",
                type: "string",
            },
            {
                key: "VIEWER_API_TOKEN",
                source: "system",
                value_or_redacted: "[REDACTED:type=string, len=22]",
                type: "string",
            },
            {
                key: "BROWSER_THEME",
                source: "default",
                value_or_redacted: "[TYPE:type=string, len=19]",
                type: "string",
            },
        ]);
        for (const entry of snapshot.data.vars) {
            assert.deepEqual(Object.keys(entry).sort(), ["key", "source", "type", "value_or_redacted"]);
        }
        const serialized = JSON.stringify(snapshot);
        for (const sentinel of Object.values(hostileSentinels)) {
            assert.equal(serialized.includes(sentinel), false, `snapshot leaked forbidden browser value: ${sentinel}`);
        }

        assert.equal(await logger.flush(), 1);
        assert.equal(calls.length, 1);
        assert.equal(calls[0].length, 1);
        assert.strictEqual(calls[0][0], snapshot, "flush must transport the buffered startup record itself");
        assert.equal(logger.bufferLength(), 0);
        assert.equal(logger.flushedTotal(), 1);
    } finally {
        for (const [name, descriptor] of originalDescriptors) {
            if (descriptor) Object.defineProperty(globalThis, name, descriptor);
            else delete globalThis[name];
        }
    }
});

await test("info() builds a schema-shaped general record", async () => {
    const calls = [];
    const transport = async (_url, body) => {
        calls.push(body);
        return { ok: true, status: 200 };
    };
    const logger = createBrowserLogger({
        runId: "run_20260526_142010_a3f900",
        initialTraceId: "rev_20260526_1234abcd",
        transport,
        enableTimer: false,
        flushAtRecords: 2,
    });
    logger.info("app", "viewer ready");
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(calls.length, 1);
    assert.equal(calls[0].length, 2);
    assert.equal(calls[0][0].event_type, "env_snapshot");
    const rec = calls[0][1];
    for (const field of REQUIRED_FIELDS) assert.ok(field in rec, `missing ${field}`);
    assert.equal(rec.service, "viewer");
    assert.equal(rec.event_type, "general");
    assert.equal(rec.level, "info");
    assert.equal(rec.run_id, "run_20260526_142010_a3f900");
    assert.equal(rec.trace_id, "rev_20260526_1234abcd");
});

await test("error() builds a logic_error record with error metadata", async () => {
    const calls = [];
    const logger = createBrowserLogger({
        runId: "run_20260526_142010_a3f900",
        initialTraceId: "rev_20260526_1234abcd",
        transport: async (_url, body) => {
            calls.push(body);
            return { ok: true, status: 200 };
        },
        enableTimer: false,
        flushAtRecords: 2,
    });
    logger.error("webrtc", "datachannel failed", new Error("timeout"));
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(calls[0][0].event_type, "env_snapshot");
    const rec = calls[0][1];
    assert.equal(rec.event_type, "logic_error");
    assert.equal(rec.level, "error");
    assert.equal(rec.data.error.name, "Error");
    assert.equal(rec.data.error.message, "timeout");
    assert.ok(Array.isArray(rec.data.error.stack_tail));
});

await test("network/lifecycle/anomaly helpers attach correct event_type", async () => {
    const sent = [];
    const logger = createBrowserLogger({
        runId: "run_20260526_142010_a3f900",
        initialTraceId: "rev_20260526_1234abcd",
        transport: async (_url, body) => {
            sent.push(...body);
            return { ok: true, status: 200 };
        },
        enableTimer: false,
        flushAtRecords: 10,
    });
    logger.network("webrtcClient", "openStageRequest", {
        direction: "outbound",
        protocol: "datachannel",
        peer: "streaming-server",
        status: "openStageRequest",
    });
    logger.lifecycle("session", "started", {
        phase: "start",
        subject_kind: "review_session",
        subject_id: "review_session_x",
    });
    logger.anomaly("flushPipeline", "fallback", { anomaly_kind: "fallback", reason: "x" });
    await logger.flush();
    assert.equal(sent.length, 4);
    assert.equal(sent[0].event_type, "env_snapshot");
    assert.equal(sent[1].event_type, "network");
    assert.equal(sent[2].event_type, "lifecycle");
    assert.equal(sent[3].event_type, "operation_anomaly");
});

await test("ordinary data redacts nested secrets, bounds depth, and preserves only cyclic edges", async () => {
    const sentinels = [
        "browser-auth-secret",
        "browser-key-secret",
        "browser-password-secret",
        "browser-api-key-secret",
        "browser-token-secret",
        "browser-depth-secret",
        "browser-cycle-secret",
    ];
    const cycle = { visible: "cycle-visible", credential: sentinels[6] };
    cycle.self = cycle;
    const shared = { visible: "shared-visible" };
    const deep = {};
    let cursor = deep;
    for (let depth = 1; depth <= 8; depth += 1) {
        cursor.child = {};
        cursor = cursor.child;
    }
    cursor.beyond = { password: sentinels[5] };

    const originalFetchDescriptor = Object.getOwnPropertyDescriptor(globalThis, "fetch");
    let serializedBody = "";
    Object.defineProperty(globalThis, "fetch", {
        configurable: true,
        writable: true,
        value: async (_url, init) => {
            serializedBody = String(init.body);
            const count = JSON.parse(serializedBody).length;
            return ackResponse({ accepted: count, dropped: 0 });
        },
    });
    try {
        const logger = createBrowserLogger({
            runId: "run_20260526_142010_a3f900",
            initialTraceId: "ifcready_browser_redaction",
            deliveryAuthority: () => TEST_DELIVERY_AUTHORITY,
            enableTimer: false,
            flushAtRecords: 999,
        });
        logger.info("redaction", "hostile ordinary data", {
            auth: sentinels[0],
            nested: [{ key: sentinels[1], password: sentinels[2], api_key: sentinels[3], token: sentinels[4] }],
            deep,
            cycle,
            sharedA: shared,
            sharedB: shared,
        });
        const record = logger.tail()[1];
        assert.equal(record.event_type, "general");
        assert.equal(record.data.auth, "[REDACTED]");
        assert.equal(record.data.nested[0].key, "[REDACTED]");
        assert.equal(record.data.nested[0].password, "[REDACTED]");
        assert.equal(record.data.nested[0].api_key, "[REDACTED]");
        assert.equal(record.data.nested[0].token, "[REDACTED]");
        assert.equal(record.data.cycle.self, "[Circular]");
        assert.deepEqual(record.data.sharedA, { visible: "shared-visible" });
        assert.deepEqual(record.data.sharedB, { visible: "shared-visible" });
        let bounded = record.data.deep;
        for (let depth = 1; depth <= 7; depth += 1) bounded = bounded.child;
        assert.equal(bounded.child, "[Truncated]");

        await logger.flush();
        for (const sentinel of sentinels) {
            assert.equal(serializedBody.includes(sentinel), false, `serialized POST body leaked ${sentinel}`);
        }
    } finally {
        if (originalFetchDescriptor) Object.defineProperty(globalThis, "fetch", originalFetchDescriptor);
        else delete globalThis.fetch;
    }
});

// ---------------------------------------------------------------------------
// Buffer / flush behaviour
// ---------------------------------------------------------------------------

await test("flushAtRecords triggers an auto-flush when threshold reached", async () => {
    let flushes = 0;
    const batches = [];
    const logger = createBrowserLogger({
        runId: "run_20260526_142010_a3f900",
        initialTraceId: "rev_20260526_1234abcd",
        transport: async (_url, body) => {
            flushes += 1;
            batches.push(body);
            return { ok: true, status: 200 };
        },
        enableTimer: false,
        flushAtRecords: 3,
    });
    assert.equal(logger.bufferLength(), 1, "startup snapshot counts as the first buffered record");
    logger.info("app", "1");
    assert.equal(flushes, 0, "should not flush yet");
    logger.info("app", "2");
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(flushes, 1, "should auto-flush at threshold");
    assert.equal(batches[0].length, 3);
    assert.equal(batches[0][0].event_type, "env_snapshot");
});

await test("default transport accepts only a complete viewer-log acknowledgement", async () => {
    let requestInit;
    const result = await exerciseDefaultTransport(
        () => ackResponse({ accepted: 1, dropped: 0 }),
        0,
        (_url, init) => { requestInit = init; },
    );
    assert.equal(result.flushed, 1);
    assert.equal(result.bufferLength, 0);
    assert.equal(result.lastFlushStatus?.status, "ok");
    assert.equal(requestInit.headers["X-Review-Session-Id"], TEST_DELIVERY_AUTHORITY.reviewSessionId);
    assert.equal(requestInit.headers["X-Viewer-Lease-Id"], TEST_DELIVERY_AUTHORITY.leaseId);
    assert.equal(requestInit.headers["X-Viewer-Lease-Token"], TEST_DELIVERY_AUTHORITY.leaseToken);
});

await test("default transport retains buffered records and never fetches without delivery authority", async () => {
    const originalFetchDescriptor = Object.getOwnPropertyDescriptor(globalThis, "fetch");
    let fetchCalls = 0;
    Object.defineProperty(globalThis, "fetch", {
        configurable: true,
        writable: true,
        value: async () => {
            fetchCalls += 1;
            return ackResponse({ accepted: 1, dropped: 0 });
        },
    });
    try {
        const logger = createBrowserLogger({
            runId: "run_20260526_142010_a3f900",
            initialTraceId: "ifcready_no_delivery_authority",
            enableTimer: false,
            flushAtRecords: 999,
            flushMaxAttempts: 1,
        });
        assert.equal(await logger.flush(), 0);
        assert.equal(fetchCalls, 0);
        assert.equal(logger.bufferLength(), 1);
        assert.equal(logger.lastFlushStatus()?.detail, "viewer_log_authority_unavailable");
    } finally {
        if (originalFetchDescriptor) Object.defineProperty(globalThis, "fetch", originalFetchDescriptor);
        else delete globalThis.fetch;
    }
});

await test("default transport retains a partially dropped viewer-log batch", async () => {
    const result = await exerciseDefaultTransport(
        () => ackResponse({ accepted: 1, dropped: 1 }),
        1,
    );
    assert.equal(result.flushed, 0);
    assert.equal(result.bufferLength, 2);
    assert.equal(result.lastFlushStatus?.status, "failed");
    assert.equal(result.lastFlushStatus?.detail, "viewer_log_ack_incomplete");
});

await test("default transport retains an entirely dropped viewer-log batch", async () => {
    const result = await exerciseDefaultTransport(
        () => ackResponse({ accepted: 0, dropped: 2 }),
        1,
    );
    assert.equal(result.flushed, 0);
    assert.equal(result.bufferLength, 2);
    assert.equal(result.lastFlushStatus?.status, "failed");
    assert.equal(result.lastFlushStatus?.detail, "viewer_log_ack_incomplete");
});

await test("default transport fails closed on malformed or missing viewer-log acknowledgement", async () => {
    const malformed = await exerciseDefaultTransport(() => ({
        ok: true,
        status: 200,
        json: async () => { throw new SyntaxError("invalid JSON"); },
        text: async () => "not-json",
    }));
    assert.equal(malformed.flushed, 0);
    assert.equal(malformed.bufferLength, 1);
    assert.equal(malformed.lastFlushStatus?.detail, "viewer_log_ack_malformed");

    const missing = await exerciseDefaultTransport(() => ackResponse({ accepted: 1 }));
    assert.equal(missing.flushed, 0);
    assert.equal(missing.bufferLength, 1);
    assert.equal(missing.lastFlushStatus?.detail, "viewer_log_ack_malformed");
});

await test("manual flush waits for a timer-started batch and drains records appended afterward", async () => {
    const originalSetInterval = globalThis.setInterval;
    const originalClearInterval = globalThis.clearInterval;
    const firstResult = deferred();
    const batches = [];
    let timerCallback = null;
    globalThis.setInterval = ((callback) => {
        timerCallback = callback;
        return 43;
    });
    globalThis.clearInterval = (() => undefined);

    try {
        const logger = createBrowserLogger({
            runId: "run_20260526_142010_a3f900",
            initialTraceId: "ifcready_manual_wait",
            transport: async (_url, body) => {
                batches.push(body);
                if (batches.length === 1) return firstResult.promise;
                return { ok: true, status: 200 };
            },
            flushAtRecords: 999,
            flushIntervalMs: 10,
        });

        timerCallback();
        logger.info("structuredLogDiagnostics", "manual action", { evidence_action_id: "evidence_action_wait" });
        let settled = false;
        const manualFlush = logger.flush().then((count) => {
            settled = true;
            return count;
        });

        await Promise.resolve();
        assert.equal(settled, false, "manual flush must wait for the timer-started transport");
        firstResult.resolve({ ok: true, status: 200 });
        const flushed = await manualFlush;

        assert.equal(batches.length, 2);
        assert.equal(batches[0].some((record) => record.data?.evidence_action_id === "evidence_action_wait"), false);
        assert.equal(batches[1].filter((record) => record.data?.evidence_action_id === "evidence_action_wait").length, 1);
        assert.equal(flushed, 2);
        assert.equal(logger.bufferLength(), 0);
        await logger.shutdown();
    } finally {
        globalThis.setInterval = originalSetInterval;
        globalThis.clearInterval = originalClearInterval;
    }
});

await test("successful in-flight completion removes captured entries by identity after overflow", async () => {
    const firstResult = deferred();
    const batches = [];
    const logger = createBrowserLogger({
        runId: "run_20260526_142010_a3f900",
        initialTraceId: "ifcready_identity_removal",
        transport: async (_url, body) => {
            batches.push(body);
            if (batches.length === 1) return firstResult.promise;
            return { ok: true, status: 200 };
        },
        bufferCapacity: 1,
        enableTimer: false,
        flushAtRecords: 999,
    });

    const firstFlush = logger.flush();
    logger.info("structuredLogDiagnostics", "manual action", {
        evidence_action_id: "evidence_action_survives_old_completion",
    });
    firstResult.resolve({ ok: true, status: 200 });
    assert.equal(await firstFlush, 0, "the remotely accepted but locally evicted entry is not removed twice");
    assert.equal(logger.tail()[0].data.evidence_action_id, "evidence_action_survives_old_completion");

    assert.equal(await logger.flush(), 1);
    assert.equal(batches.length, 2);
    assert.equal(
        batches[1].filter((record) => record.data?.evidence_action_id === "evidence_action_survives_old_completion").length,
        1,
    );
    assert.equal(logger.bufferLength(), 0);
});

await test("manual flush retries a retained action after a timer-started batch fails", async () => {
    const originalSetInterval = globalThis.setInterval;
    const originalClearInterval = globalThis.clearInterval;
    const firstResult = deferred();
    const batches = [];
    let timerCallback = null;
    globalThis.setInterval = ((callback) => {
        timerCallback = callback;
        return 44;
    });
    globalThis.clearInterval = (() => undefined);

    try {
        const logger = createBrowserLogger({
            runId: "run_20260526_142010_a3f900",
            initialTraceId: "ifcready_manual_retry",
            transport: async (_url, body) => {
                batches.push(body);
                if (batches.length === 1) return firstResult.promise;
                return { ok: true, status: 200 };
            },
            flushAtRecords: 999,
            flushIntervalMs: 10,
            flushMaxAttempts: 1,
        });

        timerCallback();
        logger.info("structuredLogDiagnostics", "manual action", { evidence_action_id: "evidence_action_after_failure" });
        const manualFlush = logger.flush();
        firstResult.resolve({ ok: false, status: 503, detail: "forced_failure" });
        await manualFlush;

        assert.equal(batches.length, 2, "the retained diagnostics action needs its own attempt");
        assert.equal(batches[0].some((record) => record.data?.evidence_action_id === "evidence_action_after_failure"), false);
        assert.equal(batches[1].filter((record) => record.data?.evidence_action_id === "evidence_action_after_failure").length, 1);
        assert.equal(logger.bufferLength(), 0);
        assert.equal(logger.lastFlushStatus()?.status, "ok");
        await logger.shutdown();
    } finally {
        globalThis.setInterval = originalSetInterval;
        globalThis.clearInterval = originalClearInterval;
    }
});

await test("auto-flush pause blocks timer and threshold while manual flush remains available", async () => {
    const originalSetInterval = globalThis.setInterval;
    const originalClearInterval = globalThis.clearInterval;
    let timerCallback = null;
    let timerRegistrations = 0;
    const sent = [];
    globalThis.setInterval = ((callback) => {
        timerRegistrations += 1;
        timerCallback = callback;
        return 41;
    });
    globalThis.clearInterval = (() => undefined);

    try {
        const logger = createBrowserLogger({
            runId: "run_20260526_142010_a3f900",
            initialTraceId: "ifcready_pause",
            transport: async (_url, body) => {
                sent.push(body);
                return { ok: true, status: 200 };
            },
            flushAtRecords: 2,
            flushIntervalMs: 10,
        });

        assert.equal(timerRegistrations, 1);
        logger.setAutoFlushPaused(true);
        logger.info("app", "threshold while paused");
        await Promise.resolve();
        assert.equal(sent.length, 0, "threshold flush must stay paused");
        timerCallback();
        await Promise.resolve();
        assert.equal(sent.length, 0, "timer flush must stay paused");

        await logger.flush();
        assert.equal(sent.length, 1, "explicit flush must work while auto-flush is paused");
        logger.info("app", "timer after resume");
        logger.setAutoFlushPaused(false);
        logger.setAutoFlushPaused(true);
        logger.setAutoFlushPaused(false);
        assert.equal(timerRegistrations, 1, "resuming must not register duplicate timers");
        timerCallback();
        await Promise.resolve();
        assert.equal(sent.length, 2);
        await logger.shutdown();
    } finally {
        globalThis.setInterval = originalSetInterval;
        globalThis.clearInterval = originalClearInterval;
    }
});

await test("a retained failed action is not consumed by timer or threshold before resume", async () => {
    const originalSetInterval = globalThis.setInterval;
    const originalClearInterval = globalThis.clearInterval;
    let timerCallback = null;
    let transportCalls = 0;
    let shouldSucceed = false;
    globalThis.setInterval = ((callback) => {
        timerCallback = callback;
        return 42;
    });
    globalThis.clearInterval = (() => undefined);

    try {
        const logger = createBrowserLogger({
            runId: "run_20260526_142010_a3f900",
            initialTraceId: "ifcready_retained_failure",
            transport: async () => {
                transportCalls += 1;
                return shouldSucceed
                    ? { ok: true, status: 200 }
                    : { ok: false, status: 503, detail: "forced_failure" };
            },
            flushAtRecords: 2,
            flushIntervalMs: 10,
            flushMaxAttempts: 3,
            flushBackoffMs: 0,
        });

        logger.setAutoFlushPaused(true);
        logger.info("structuredLogDiagnostics", "manual action", { evidence_action_id: "evidence_action_retained" });
        await logger.flush();
        assert.equal(transportCalls, 3);
        assert.equal(logger.lastFlushStatus()?.status, "failed");
        assert.equal(logger.tail().filter((record) => record.data?.evidence_action_id === "evidence_action_retained").length, 1);

        timerCallback();
        logger.info("app", "threshold remains paused");
        await new Promise((resolve) => setTimeout(resolve, 5));
        assert.equal(transportCalls, 3, "background paths must not consume the retained action");

        shouldSucceed = true;
        logger.setAutoFlushPaused(false);
        timerCallback();
        await new Promise((resolve) => setTimeout(resolve, 5));
        assert.equal(transportCalls, 4);
        assert.equal(logger.tail().some((record) => record.data?.evidence_action_id === "evidence_action_retained"), false);
        await logger.shutdown();
    } finally {
        globalThis.setInterval = originalSetInterval;
        globalThis.clearInterval = originalClearInterval;
    }
});

await test("shutdown waits for an in-flight batch even while auto-flush is paused", async () => {
    const originalSetInterval = globalThis.setInterval;
    const originalClearInterval = globalThis.clearInterval;
    const firstResult = deferred();
    const batches = [];
    let timerCallback = null;
    globalThis.setInterval = ((callback) => {
        timerCallback = callback;
        return 45;
    });
    globalThis.clearInterval = (() => undefined);

    try {
        const logger = createBrowserLogger({
            runId: "run_20260526_142010_a3f900",
            initialTraceId: "ifcready_shutdown_wait",
            transport: async (_url, body) => {
                batches.push(body);
                if (batches.length === 1) return firstResult.promise;
                return { ok: true, status: 200 };
            },
            flushAtRecords: 999,
            flushIntervalMs: 10,
        });
        timerCallback();
        logger.setAutoFlushPaused(true);
        logger.info("app", "record appended while timer batch is in flight and paused");

        let shutdownSettled = false;
        const shutdown = logger.shutdown().then(() => {
            shutdownSettled = true;
        });
        await Promise.resolve();
        assert.equal(shutdownSettled, false);
        firstResult.resolve({ ok: true, status: 200 });
        await shutdown;
        assert.equal(batches.length, 2);
        assert.equal(logger.bufferLength(), 0);
    } finally {
        globalThis.setInterval = originalSetInterval;
        globalThis.clearInterval = originalClearInterval;
    }
});

await test("ring buffer drops oldest when over capacity", async () => {
    const logger = createBrowserLogger({
        runId: "run_20260526_142010_a3f900",
        initialTraceId: "rev_20260526_1234abcd",
        transport: async () => ({ ok: false, status: 500 }),
        enableTimer: false,
        flushAtRecords: 9999,
        bufferCapacity: 3,
        flushMaxAttempts: 1,
        retainOnFailureMs: 60 * 1000,
    });
    for (let i = 0; i < 5; i += 1) logger.info("app", `m-${i}`);
    assert.equal(logger.bufferLength(), 3);
    assert.equal(logger.droppedTotal(), 3, "startup snapshot is included in capacity accounting");
});

await test("failed flush keeps records until retainOnFailureMs elapses", async () => {
    const clock = { t: new Date("2026-05-26T14:00:00Z").getTime() };
    const logger = createBrowserLogger({
        runId: "run_20260526_140000_a3f900",
        initialTraceId: "rev_20260526_1234abcd",
        now: () => new Date(clock.t),
        transport: async () => ({ ok: false, status: 500 }),
        enableTimer: false,
        flushAtRecords: 9999,
        flushMaxAttempts: 1,
        retainOnFailureMs: 1000,
    });
    logger.info("app", "1");
    await logger.flush();
    assert.equal(logger.bufferLength(), 2, "startup snapshot and info record retained after failed flush");
    // Advance past retainOnFailureMs and flush again — record should expire.
    clock.t += 1500;
    await logger.flush();
    assert.equal(logger.bufferLength(), 0, "record dropped after retention window");
    assert.equal(logger.droppedTotal(), 2);
});

await test("tail() returns the last N buffered records for inspection", async () => {
    const logger = createBrowserLogger({
        runId: "run_20260526_142010_a3f900",
        initialTraceId: "rev_20260526_1234abcd",
        transport: async () => ({ ok: false, status: 500 }), // keep records in buffer
        enableTimer: false,
        flushAtRecords: 9999,
        flushMaxAttempts: 1,
        retainOnFailureMs: 60 * 1000,
    });
    for (let i = 0; i < 5; i += 1) logger.info("app", `m-${i}`);
    const tail3 = logger.tail(3);
    assert.equal(tail3.length, 3);
    assert.deepEqual(tail3.map((r) => r.msg), ["m-2", "m-3", "m-4"]);
});

await test("setTraceId rotates trace id and resets per-trace seq", async () => {
    const sent = [];
    const logger = createBrowserLogger({
        runId: "run_20260526_142010_a3f900",
        initialTraceId: "rev_aaa",
        transport: async (_url, body) => {
            sent.push(...body);
            return { ok: true, status: 200 };
        },
        enableTimer: false,
        flushAtRecords: 99,
    });
    logger.info("app", "first under aaa");
    logger.setTraceId("rev_bbb");
    logger.info("app", "first under bbb");
    logger.info("app", "second under bbb");
    await logger.flush();
    const aaa = sent.filter((r) => r.trace_id === "rev_aaa");
    const bbb = sent.filter((r) => r.trace_id === "rev_bbb");
    assert.equal(aaa[0].event_type, "env_snapshot");
    assert.deepEqual(aaa.map((r) => r.seq), [1, 2]);
    assert.deepEqual(bbb.map((r) => r.seq), [1, 2]);
});

// ---------------------------------------------------------------------------
// Run summary
// ---------------------------------------------------------------------------

if (!process.exitCode) {
    console.log(`\n  ${testCount} tests passed`);
}
