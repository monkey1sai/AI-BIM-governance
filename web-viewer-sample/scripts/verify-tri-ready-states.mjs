// Focused contract assertion for `src/utils/triReady.ts`(viewer-edge-bim-server-console)。
//
// 同 verify-conversion-summary-card.mjs 採 source-level + pure-function 雙保險:
//   1. Source-level:確保 triReady.ts 與 types/review.ts schema 對齊 C1 / C4
//      新欄位(semantic_mapping_fidelity / mapping_has_ifc_type /
//      mapping_has_ifc_name / queued_for_conversion / dropped_on_restart)。
//   2. Pure function:transpile triReady.ts 到 CJS,跑 3 組 fixture 確認
//      computeFileReady / computeRuntimeReady / computeSemanticReady 行為正確。
//
// 不啟動 React renderer;tri-ready 計算純資料,不依賴 DOM。

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

// ---------- 1. Source-level schema invariants ----------
const reviewTypeSource = readSource("src/types/review.ts");
for (const required of [
    "semantic_mapping_fidelity",
    "mapping_has_ifc_type",
    "mapping_has_ifc_name",
    "queued_for_conversion",
    "dropped_on_restart",
]) {
    assert.match(
        reviewTypeSource,
        new RegExp(required),
        `types/review.ts must declare field/value ${required}`,
    );
}

const triReadySource = readSource("src/utils/triReady.ts");
for (const required of [
    "computeFileReady",
    "computeRuntimeReady",
    "computeSemanticReady",
    "TriReadyState",
    'semantic_mapping_fidelity',
    'mapping_has_ifc_type',
    'mapping_has_ifc_name',
]) {
    assert.match(triReadySource, new RegExp(required), `triReady.ts must reference ${required}`);
}

// ---------- 2. Transpile + pure function unit test ----------
function compileToCjs(source, fileName) {
    const transpiled = ts.transpileModule(source, {
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2020,
            esModuleInterop: true,
        },
        fileName,
    });
    return transpiled.outputText;
}

const triReadyCjs = compileToCjs(triReadySource, "triReady.ts");
// strip type-only imports(review type 不在 runtime test 範圍)
const module = { exports: {} };
const cjsWithoutImports = triReadyCjs.replace(/require\(["']\.\.\/types\/review["']\);?\s*\n?/g, "");
const fn = new Function("module", "exports", "require", cjsWithoutImports);
fn(module, module.exports, require);
const { computeFileReady, computeRuntimeReady, computeSemanticReady } = module.exports;

// Fixture A:全空 → 全 "no"
assert.equal(computeFileReady(null), "no");
assert.equal(computeRuntimeReady("initializing", "unproven"), "no");
assert.equal(computeSemanticReady(null), "no");
assert.equal(computeSemanticReady({}), "no");

// Fixture B:File ready only
const fileOnlyConfig = {
    model: { status: "ready", url: "http://127.0.0.1:49101/artifacts/x/model.usdc" },
};
assert.equal(computeFileReady(fileOnlyConfig), "yes");
assert.equal(computeRuntimeReady("started", "pending"), "incomplete");
assert.equal(computeSemanticReady({ semantic_mapping_fidelity: null }), "no");

// Fixture C:File + Runtime ready
assert.equal(computeFileReady(fileOnlyConfig), "yes");
assert.equal(computeRuntimeReady("started", "matched"), "yes");

// Fixture D:Semantic 部分到位 → incomplete
assert.equal(
    computeSemanticReady({
        semantic_mapping_fidelity: "ifc_class_grouped_with_name",
        mapping_has_ifc_type: true,
        mapping_has_ifc_name: false,
    }),
    "incomplete",
    "Semantic ready partial fidelity must be incomplete, not yes",
);

// Fixture E:全 yes
assert.equal(
    computeSemanticReady({
        semantic_mapping_fidelity: "ifc_class_grouped_with_name",
        mapping_has_ifc_type: true,
        mapping_has_ifc_name: true,
    }),
    "yes",
);

// Fixture F:fidelity 空字串視為 no(不偽宣告)
assert.equal(
    computeSemanticReady({
        semantic_mapping_fidelity: "",
        mapping_has_ifc_type: true,
        mapping_has_ifc_name: true,
    }),
    "incomplete",
    "empty fidelity but type+name present → incomplete (not yes)",
);

// Fixture G:Runtime stopped → no
assert.equal(computeRuntimeReady("stopped", "matched"), "no");
assert.equal(computeRuntimeReady("failed", "matched"), "no");

// Fixture H:Runtime started + mismatch → no(stage 不對)
assert.equal(computeRuntimeReady("started", "mismatch"), "no");
assert.equal(computeRuntimeReady("started", "disconnected"), "no");

console.log("verify-tri-ready-states.mjs:all assertions passed.");
