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

const legacyRequest = buildOpenStageRequest("http://127.0.0.1:8005/objects/model.usdc");
assert.equal(legacyRequest.event_type, "openStageRequest");
assert.equal(legacyRequest.payload.url, "http://127.0.0.1:8005/objects/model.usdc");
assert.equal(Object.hasOwn(legacyRequest.payload, "artifact_bindings"), false);

const binding = {
    binding_id: "binding_1",
    artifact_group_id: "ag_test_ready",
    model_version_id: "version_demo_001",
    artifact_id: "artifact_usdc_test_001",
    artifact_role: "derived",
    url: "http://127.0.0.1:8005/objects/model.usdc",
    mapping_url: "http://127.0.0.1:8005/objects/element_mapping.json",
    load_order: 0,
    routing_policy: "same_instance",
    ready_status: "ready",
};
const routedRequest = buildOpenStageRequest(binding.url, [binding]);
assert.equal(routedRequest.payload.url, binding.url);
assert.deepEqual(routedRequest.payload.artifact_bindings, [binding]);

const windowSource = readSource("src/Window.tsx");
for (const token of [
    "review_request_id",
    "blocked_conversion",
    "queued_for_instance",
    "closing",
    "closed",
    "failed",
    "_sendStreamMessage",
    "buildOpenStageRequest(this.state.selectedUSDAsset.url, artifactBindings)",
]) {
    assert.ok(windowSource.includes(token), `Window.tsx is missing ${token}`);
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

const artifactPanelSource = readSource("src/components/ArtifactPanel.tsx");
for (const token of ["artifactBindings", "ready_status", "mapping_url", "load_order"]) {
    assert.ok(artifactPanelSource.includes(token), `ArtifactPanel.tsx is missing ${token}`);
}

console.log("[verify] session-first viewer contract passed");
