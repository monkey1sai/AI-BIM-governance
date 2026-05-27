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
const localRequire = createRequire(import.meta.url);

function loadStructLogModule() {
    const source = fs.readFileSync(path.join(repoRoot, "src/lib/structLog.ts"), "utf8");
    const compiled = ts.transpileModule(source, {
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2020,
        },
    });
    const module = { exports: {} };
    const fn = new Function("exports", "module", "require", compiled.outputText);
    fn(module.exports, module, localRequire);
    return module.exports;
}

const { createBrowserLogger, generateRunId, isoUtcMs } = loadStructLogModule();

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
        flushAtRecords: 1,
    });
    logger.info("app", "viewer ready");
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(calls.length, 1);
    assert.equal(calls[0].length, 1);
    const rec = calls[0][0];
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
        flushAtRecords: 1,
    });
    logger.error("webrtc", "datachannel failed", new Error("timeout"));
    await new Promise((resolve) => setTimeout(resolve, 5));
    const rec = calls[0][0];
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
    assert.equal(sent.length, 3);
    assert.equal(sent[0].event_type, "network");
    assert.equal(sent[1].event_type, "lifecycle");
    assert.equal(sent[2].event_type, "operation_anomaly");
});

// ---------------------------------------------------------------------------
// Buffer / flush behaviour
// ---------------------------------------------------------------------------

await test("flushAtRecords triggers an auto-flush when threshold reached", async () => {
    let flushes = 0;
    const logger = createBrowserLogger({
        runId: "run_20260526_142010_a3f900",
        initialTraceId: "rev_20260526_1234abcd",
        transport: async () => {
            flushes += 1;
            return { ok: true, status: 200 };
        },
        enableTimer: false,
        flushAtRecords: 3,
    });
    logger.info("app", "1");
    logger.info("app", "2");
    assert.equal(flushes, 0, "should not flush yet");
    logger.info("app", "3");
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(flushes, 1, "should auto-flush at threshold");
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
    assert.equal(logger.droppedTotal(), 2);
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
    assert.equal(logger.bufferLength(), 1, "record retained after failed flush");
    // Advance past retainOnFailureMs and flush again — record should expire.
    clock.t += 1500;
    await logger.flush();
    assert.equal(logger.bufferLength(), 0, "record dropped after retention window");
    assert.equal(logger.droppedTotal(), 1);
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
    assert.deepEqual(aaa.map((r) => r.seq), [1]);
    assert.deepEqual(bbb.map((r) => r.seq), [1, 2]);
});

// ---------------------------------------------------------------------------
// Run summary
// ---------------------------------------------------------------------------

if (!process.exitCode) {
    console.log(`\n  ${testCount} tests passed`);
}
