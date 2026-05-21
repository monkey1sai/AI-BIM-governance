import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const repoRoot = process.cwd();

function readSource(relativePath) {
    return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function loadStreamMessageModule() {
    const source = readSource("src/clients/streamMessages.ts");
    const compiled = ts.transpileModule(source, {
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2020,
        },
    });
    const module = { exports: {} };
    const fn = new Function("exports", "module", compiled.outputText);
    fn(module.exports, module);
    return module.exports;
}

const { buildOpenStageRequest } = loadStreamMessageModule();

const legacyRequest = buildOpenStageRequest("edge-local://artifacts/model.usdc");
assert.equal(legacyRequest.event_type, "openStageRequest");
assert.equal(legacyRequest.payload.url, "edge-local://artifacts/model.usdc");
assert.equal(Object.hasOwn(legacyRequest.payload, "artifact_bindings"), false);

const binding = {
    binding_id: "binding_1",
    artifact_group_id: "ag_test_ready",
    model_version_id: "version_demo_001",
    artifact_id: "artifact_usdc_test_001",
    artifact_role: "derived",
    url: "edge-local://artifacts/model.usdc",
    mapping_url: "edge-local://artifacts/element_mapping.json",
    load_order: 0,
    routing_policy: "same_instance",
    ready_status: "ready",
};
const routedRequest = buildOpenStageRequest(binding.url, [binding], { primary: binding, secondary_layers: [] });
assert.equal(routedRequest.payload.url, binding.url);
assert.deepEqual(routedRequest.payload.artifact_bindings, [binding]);
assert.equal(routedRequest.payload.stage_composition.primary.artifact_id, binding.artifact_id);
assert.deepEqual(routedRequest.payload.stage_composition.secondary_layers, []);

const windowSource = readSource("src/Window.tsx");
for (const token of [
    "review_request_id",
    "blocked_conversion",
    "queued_for_instance",
    "closing",
    "closed",
    "failed",
    "_sendStreamMessage",
    "_handleQueuedForInstance",
    "isQueuedForInstanceError",
    "queuedForKitInstance",
    "patchReviewSessionRequest(reviewRequest.review_request_id",
    "buildOpenStageRequest(",
    "this.state.latestStreamConfig.model.status !== \"ready\"",
    "stage_composition",
    "this.coordinatorClient.getReviewSession(reviewEnv.defaultSessionId)",
    // remove-conflict-review-from-fast-mvp:review-bootstrap endpoint 與 getReviewBootstrap 已退役;
    // session-first 仍保留(先 GET session → 拿 model_version_id),但 bootstrap 取代為 stream-config 內 artifacts。
]) {
    assert.ok(windowSource.includes(token), `Window.tsx is missing ${token}`);
}
// 額外確認 review-bootstrap path 已從 Window.tsx 移除
assert.ok(!windowSource.includes("getReviewBootstrap"), "Window.tsx must NOT call getReviewBootstrap after remove-conflict-review-from-fast-mvp");
assert.ok(!windowSource.includes("_loadReviewBootstrapFromCoordinator"), "Window.tsx must NOT define _loadReviewBootstrapFromCoordinator after remove-conflict-review-from-fast-mvp");
assert.ok(!windowSource.includes("ReviewIssue"), "Window.tsx must NOT import ReviewIssue after remove-conflict-review-from-fast-mvp");

const reviewTypesSource = readSource("src/types/review.ts");
for (const token of ["converting", "conversion_authority", "conversion_job_id", "stage_composition"]) {
    assert.ok(reviewTypesSource.includes(token), `review.ts is missing ${token}`);
}
assert.match(
    windowSource,
    /private _sendStreamMessage[\s\S]*?AppStream\.sendMessage\(JSON\.stringify\(message\)\);[\s\S]*?this\._appendDemoOutgoing/,
    "_sendStreamMessage must send through AppStream and log outgoing messages",
);
assert.doesNotMatch(
    windowSource,
    /private _sendStreamMessage[\s\S]*?this\._sendStreamMessage\(message\);[\s\S]*?this\._appendDemoOutgoing/,
    "_sendStreamMessage must not recursively call itself",
);
assert.match(
    windowSource,
    /private _onSelectUSDPrims[\s\S]*?this\._sendStreamMessage\(message\);/,
    "_onSelectUSDPrims must route selection changes through lifecycle-guarded stream sending",
);
// remove-conflict-review-from-fast-mvp:review-bootstrap 已退役,改驗 session-first 順序到 stream-config 的鏈
assert.match(
    windowSource,
    /this\.coordinatorClient\.getReviewSession\(reviewEnv\.defaultSessionId\)[\s\S]*?this\.coordinatorClient\.getStreamConfig\(sessionId\)/,
    "sessionId bootstrap must call getReviewSession before getStreamConfig (session-first contract; review-bootstrap retired)",
);

const coordinatorClientSource = readSource("src/clients/coordinatorClient.ts");
for (const token of ["QueuedForInstanceError", "isQueuedForInstanceResponse", 'response.status === 409', '"queued_for_instance"']) {
    assert.ok(coordinatorClientSource.includes(token), `coordinatorClient.ts is missing ${token}`);
}

const artifactPanelSource = readSource("src/components/ArtifactPanel.tsx");
for (const token of ["artifactBindings", "ready_status", "mapping_url", "load_order"]) {
    assert.ok(artifactPanelSource.includes(token), `ArtifactPanel.tsx is missing ${token}`);
}

console.log("[verify] session-first viewer contract passed");
