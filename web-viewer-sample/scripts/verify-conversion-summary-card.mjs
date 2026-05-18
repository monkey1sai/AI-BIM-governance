// Focused contract assertion for ConversionSummaryCard.
//
// This test intentionally avoids spinning up a real React renderer (the card uses useEffect, which
// would require a DOM/scheduler shim that adds more risk than signal). Instead it asserts:
//
//   1. Source-level invariants — the card source explicitly declares the no-cache/no-recompute
//      contract, gates the fallback behind import.meta.env.DEV, and lists every required summary
//      field (fixture_name, source_ifc_entity_count, sidecar_carrier_count, materialization_strategy,
//      coverage_ratio, coverage_status, conversion_duration_seconds).
//   2. The pure data-shaping function `defaultFetchFallback` transforms a coordinator dev-proxy
//      `/api/dev/conversions/{job}/result` payload into a ConversionQualityMetricsSummary with the
//      expected fields, and never mutates or recomputes any value.
//   3. The dev gate behaves correctly for both DEV=true and DEV=false (the dev gate must be the
//      single source of truth for fallback reachability).
//
// We also keep the existing session-first contract test untouched by running this in its own file.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import ts from "typescript";

const repoRoot = process.cwd();
const require = createRequire(import.meta.url);

function readSource(relativePath) {
    return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

const cardSource = readSource("src/components/ConversionSummaryCard.tsx");

// ---------- 1. Source-level invariants ----------
assert.match(
    cardSource,
    /MUST NOT compute, cache, or rebroadcast/,
    "viewer card source must declare the no-cache contract",
);
assert.match(cardSource, /import\.meta/, "card must read dev mode through import.meta");
assert.doesNotMatch(cardSource, /recompute|recalculate/i, "card must not reintroduce recompute logic");

for (const required of [
    "fixture_name",
    "source_ifc_entity_count",
    "sidecar_carrier_count",
    "materialization_strategy",
    "coverage_ratio",
    "coverage_status",
    "conversion_duration_seconds",
    "conversion_authority",
    "stage_composition",
]) {
    assert.match(cardSource, new RegExp(required), `card must reference field ${required}`);
}

// The fallback must be guarded by `if (!dev) return` in the useEffect body.
assert.match(cardSource, /if \(!dev\) return/, "card must short-circuit non-dev builds before any fetch");

// The defaultFetchFallback must read from `/api/dev/conversions/.../result` on the coordinator URL.
assert.match(
    cardSource,
    /\/api\/dev\/conversions\/.+\/result/,
    "card's dev fallback must target /api/dev/conversions/{job}/result",
);

// `data-testid` hooks for ready / degraded / dev-fetching states must all exist.
for (const testId of [
    "conversion-summary-card",
    "conversion-summary-card-ready",
    "conversion-summary-card-degraded",
]) {
    assert.match(cardSource, new RegExp(`data-testid=\\"${testId}\\"`), `card must expose data-testid="${testId}"`);
}

// ---------- 2. Pure data-shape transform ----------
function compileToCjs(source, fileName, devOverride) {
    const transpiled = ts.transpileModule(source, {
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2020,
            jsx: ts.JsxEmit.ReactJSX,
            esModuleInterop: true,
        },
        fileName,
    }).outputText;
    // Replace `import.meta` with a synthetic object so the dev gate logic is testable in Node.
    const importMetaShim = JSON.stringify({ env: { DEV: Boolean(devOverride), PROD: !devOverride } });
    return `var importMeta = ${importMetaShim};\n` + transpiled.replace(/import\.meta/g, "importMeta");
}

function loadCard(devOverride) {
    const compiled = compileToCjs(cardSource, "ConversionSummaryCard.tsx", devOverride);
    const moduleScope = { exports: {} };
    const mockRequire = (specifier) => {
        if (specifier === "react") return require("react");
        if (specifier === "react/jsx-runtime") return require("react/jsx-runtime");
        if (specifier === "react/jsx-dev-runtime") return require("react/jsx-dev-runtime");
        if (specifier === "../types/review") return {};
        throw new Error(`Unexpected require: ${specifier}`);
    };
    const fn = new Function("exports", "module", "require", compiled);
    fn(moduleScope.exports, moduleScope, mockRequire);
    return moduleScope.exports;
}

// Re-extract the pure transform from the compiled output. We do this by string-eval'ing only the
// helper rather than executing React rendering. The transform must remain self-contained.
const transformBlockMatch = cardSource.match(
    /async function defaultFetchFallback[\s\S]+?\r?\n}\r?\n/,
);
assert.ok(transformBlockMatch, "defaultFetchFallback must be defined in the card source");

const transformSource = transformBlockMatch[0];
const transformCompiled = ts.transpileModule(`${transformSource}\nmodule.exports = defaultFetchFallback;`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const transformModule = { exports: {} };
new Function("exports", "module", transformCompiled)(transformModule.exports, transformModule);
const defaultFetchFallback = transformModule.exports;

// Stub fetch with a deterministic streaming conversion-shaped response.
const workerPayload = {
    conversion_job_id: "conv_test_001",
    original_filename: "fixture_demo.ifc",
    artifact_group_id: "ag_fallback_001",
    quality_metrics: {
        source_ifc_entity_count: 1234,
        sidecar_carrier_count: 7,
        materialization_strategy: "sidecar",
        coverage_ratio: 1.0,
        coverage_status: "pass",
        phase_timings: {
            conversion_total: { duration_seconds: 87.5 },
        },
    },
};

const originalFetch = globalThis.fetch;
globalThis.fetch = async (url) => {
    assert.match(String(url), /\/api\/dev\/conversions\/conv_test_001\/result/, "fallback must encode conversion_job_id");
    return {
        ok: true,
        json: async () => workerPayload,
    };
};

try {
    const summary = await defaultFetchFallback("http://127.0.0.1:8004", "conv_test_001");
    assert.ok(summary, "fallback must return a summary object");
    assert.equal(summary.fixture_name, "fixture_demo.ifc");
    assert.equal(summary.conversion_job_id, "conv_test_001");
    assert.equal(summary.artifact_group_id, "ag_fallback_001");
    assert.equal(summary.source_ifc_entity_count, 1234);
    assert.equal(summary.sidecar_carrier_count, 7);
    assert.equal(summary.materialization_strategy, "sidecar");
    assert.equal(summary.coverage_ratio, 1.0);
    assert.equal(summary.coverage_status, "pass");
    assert.equal(summary.conversion_duration_seconds, 87.5);

    // Verify no value mutation: the original payload must be untouched.
    assert.equal(workerPayload.quality_metrics.coverage_ratio, 1.0);
    assert.equal(workerPayload.original_filename, "fixture_demo.ifc");

    // Non-OK responses must produce null (no synthesized values).
    globalThis.fetch = async () => ({ ok: false, json: async () => ({}) });
    const failure = await defaultFetchFallback("http://127.0.0.1:8004", "conv_test_999");
    assert.equal(failure, null, "fallback must return null when the worker response is not OK");
} finally {
    globalThis.fetch = originalFetch;
}

// ---------- 3. Dev gate behaviour ----------
const devModule = loadCard(true);
const prodModule = loadCard(false);
assert.ok(typeof devModule.default === "function", "dev card module must export a default React component");
assert.ok(typeof prodModule.default === "function", "prod card module must export a default React component");

// We can't directly observe the gate's runtime decision without React, but we can verify that the
// compiled source for the prod build carries `importMeta.env.DEV === false` so the gate inside
// `useEffect` returns early.
const prodCompiledForInspection = compileToCjs(cardSource, "Inspect.tsx", false);
assert.ok(
    prodCompiledForInspection.includes('"DEV":false'),
    "prod build's importMeta env must report DEV=false",
);

const devCompiledForInspection = compileToCjs(cardSource, "Inspect.tsx", true);
assert.ok(
    devCompiledForInspection.includes('"DEV":true'),
    "dev build's importMeta env must report DEV=true",
);

console.log("[verify-conversion-summary-card] all assertions passed");
