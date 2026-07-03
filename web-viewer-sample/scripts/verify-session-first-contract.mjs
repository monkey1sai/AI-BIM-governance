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
assert.equal(legacyRequest.payload.requested_stage_url, "edge-local://artifacts/model.usdc");
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
assert.equal(routedRequest.payload.requested_stage_url, binding.url);
assert.deepEqual(routedRequest.payload.artifact_bindings, [binding]);
assert.equal(routedRequest.payload.stage_composition.primary.artifact_id, binding.artifact_id);
assert.deepEqual(routedRequest.payload.stage_composition.secondary_layers, []);

const windowSource = readSource("src/Window.tsx");
// #17 vitest 抽出:lifecycle / endpoint 純函式從 Window.tsx 搬到 utils/windowHelpers.ts,
// 視為 Window 邏輯的一部分,正向 token 檢查兩檔聯集(否定斷言仍只看 Window.tsx)。
const windowHelpersSource = readSource("src/utils/windowHelpers.ts");
const mockViewportSource = readSource("src/console/viewer/MockViewport.tsx");
const viewerContractSource = `${windowSource}\n${windowHelpersSource}\n${mockViewportSource}`;
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
    "expectedStageUrlFromStreamConfig",
    "_recordLoadedStageEvidence",
    "stale_stage_or_mismatch",
    "webrtc_disconnected",
    "_reconnectStream",
    "viewer-session-bridge",
    "mock-stage-url",
    "mock-layer-count",
    "viewer-role",
    "showUsdStageDock",
    "Boolean(this.state.reviewSessionId)",
    "this.coordinatorClient.getReviewSession(reviewEnv.defaultSessionId)",
    "isSpectatorStreamMode",
    "const spectatorBinding = isSpectatorStreamMode()",
    // remove-conflict-review-from-fast-mvp:review-bootstrap endpoint 與 getReviewBootstrap 已退役;
    // session-first 仍保留(先 GET session → 拿 model_version_id),但 bootstrap 取代為 stream-config 內 artifacts。
]) {
    assert.ok(viewerContractSource.includes(token), `viewer contract source is missing ${token}`);
}
assert.ok(!windowSource.includes("stage-truth-panel"), "Window.tsx must not render removed stage-truth-panel floating UI");
assert.match(
    windowSource,
    /const showUsdStageDock = this\.state\.showUI && \(isDebugQueryEnabled\(\) \|\| this\.state\.usdPrims\.length > 0\);[\s\S]*?\{showUsdStageDock && \([\s\S]*?data-testid="usd-stage-left-dock"[\s\S]*?reservedLeft=\{showUsdStageDock \? sidebarWidth : 0\}/,
    "model viewport must reserve left width only when the USD stage dock is rendered",
);
// 額外確認 review-bootstrap path 已從 Window.tsx 移除
assert.ok(!windowSource.includes("getReviewBootstrap"), "Window.tsx must NOT call getReviewBootstrap after remove-conflict-review-from-fast-mvp");
assert.ok(!windowSource.includes("_loadReviewBootstrapFromCoordinator"), "Window.tsx must NOT define _loadReviewBootstrapFromCoordinator after remove-conflict-review-from-fast-mvp");
assert.ok(!windowSource.includes("ReviewIssue"), "Window.tsx must NOT import ReviewIssue after remove-conflict-review-from-fast-mvp");

const reviewTypesSource = readSource("src/types/review.ts");
for (const token of ["converting", "conversion_authority", "conversion_job_id", "stage_composition"]) {
    assert.ok(reviewTypesSource.includes(token), `review.ts is missing ${token}`);
}

const envSource = readSource("src/config/env.ts");
assert.match(
    envSource,
    /queryParam\("session"\)\s*\|\|\s*queryParam\("sessionId"\)/,
    "viewer must accept coordinator /ui/open handoff query key `session` before falling back to legacy `sessionId`",
);
assert.match(
    envSource,
    /trustedCoordinatorBaseFromQuery\("coordinatorApiBase"\)/,
    "viewer must validate coordinatorApiBase from coordinator /ui/open handoff before localhost defaults",
);
assert.match(
    envSource,
    /trustedCoordinatorBaseFromQuery\("coordinatorSocketUrl"\)/,
    "viewer must validate coordinatorSocketUrl from handoff and fall back to trusted coordinatorApiBase",
);
assert.match(
    envSource,
    /VITE_ALLOWED_COORDINATOR_ORIGINS/,
    "viewer must support an explicit trusted coordinator origin allowlist",
);
assert.match(
    envSource,
    /parsed\.hostname === browserHost/,
    "viewer must accept same-host coordinator handoff for LAN deployments",
);

assert.match(
    windowSource,
    /private _sendStreamMessage[\s\S]*?AppStream\.sendMessage\(message\)[\s\S]*?appStreamResultToAppEvent\(message\.event_type, result\)[\s\S]*?this\._handleCustomEvent\(responseEvent\)[\s\S]*?this\._appendDemoOutgoing/,
    "_sendStreamMessage must send object payloads through AppStream, handle built-in Promise replies, and log outgoing messages",
);
assert.doesNotMatch(
    windowSource,
    /AppStream\.sendMessage\(JSON\.stringify\(message\)\);/,
    "_sendStreamMessage must not stringify DataChannel messages; Kit livestream messaging expects an event object",
);
assert.match(
    windowSource,
    /function appStreamResultToAppEvent[\s\S]*?requestEventType === "openStageRequest"[\s\S]*?event_type: "openedStageResult"[\s\S]*?requestEventType === "loadingStateQuery"[\s\S]*?event_type: "loadingStateResponse"[\s\S]*?requestEventType === "getChildrenRequest"[\s\S]*?event_type: "getChildrenResponse"/,
    "viewer must map AppStreamer built-in Promise replies back into existing DataChannel handlers",
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
assert.match(
    windowSource,
    /const expectedStageUrl = expectedStageUrlFromStreamConfig\(streamConfig\)[\s\S]*?const selectedUSDAsset = expectedStageAsset/,
    "session-first viewer must prefer stream_config stage_composition primary URL over stale /api/assets entries",
);
assert.match(
    viewerContractSource,
    /function sameStreamTransportEndpoint[\s\S]*?signalingServer[\s\S]*?signalingPort[\s\S]*?mediaServer[\s\S]*?mediaPort/,
    "spectator binding selection must compare the full transport endpoint, not only ids or ports",
);
assert.doesNotMatch(
    windowSource,
    /componentDidMount\(\): void \{[\s\S]*?this\._scheduleStreamStartTimeout\(\);[\s\S]*?void this\._bootstrapReview\(\);/,
    "viewer must not start the WebRTC timeout before session stream-config is resolved",
);
assert.match(
    windowSource,
    /const shouldRenderAppStream = !reviewEnv\.hasExplicitEmptySessionId && Boolean\(this\.state\.reviewSessionId\);/,
    "viewer must not mount AppStream before a coordinator review session is bound",
);
assert.match(
    windowSource,
    /this\.setState\(\{[\s\S]*?reviewSessionId: sessionId,[\s\S]*?\}, \(\) => \{\s*this\._scheduleStreamStartTimeout\(\);/,
    "viewer must start the WebRTC timeout only after session stream-config has bound AppStream inputs",
);
assert.match(
    windowSource,
    /event\.event_type === "openedStageResult"[\s\S]*?_recordLoadedStageEvidence\(loadedUrl, "openedStageResult"/,
    "openedStageResult must record loaded stage URL evidence",
);
assert.match(
    windowSource,
    /event\.event_type == "loadingStateResponse"[\s\S]*?_recordLoadedStageEvidence\(payloadUrl, "loadingStateResponse"/,
    "loadingStateResponse must record and compare loaded stage URL evidence",
);
assert.match(
    windowSource,
    /activityText === "None"[\s\S]*?const loadedUrl = this\.pendingStageUrl;[\s\S]*?_recordLoadedStageEvidence\(loadedUrl, "updateProgressActivity", activityText\)[\s\S]*?_completeStageLoad\(loadedUrl\)/,
    "updateProgressActivity=None must prove the pending stage URL when Kit omits openedStageResult",
);
assert.match(
    windowSource,
    /onStopped=\{\(message\) => this\._handleStreamStopped\("stopped", message\)\}/,
    "AppStream onStop must surface visible WebRTC disconnect state",
);
assert.match(
    windowSource,
    /onTerminated=\{\(message\) => this\._handleStreamStopped\("terminated", message\)\}/,
    "AppStream onTerminate must surface visible WebRTC disconnect state",
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

// harden-web-viewer-test-resilience: source-level contracts shared across the apply agents
assert.ok(
    windowSource.includes("_pollForKitReadyId"),
    "Window.tsx must name the Kit-ready poll handle _pollForKitReadyId",
);
assert.ok(
    windowSource.includes("spectator_ready") && windowSource.includes("'matched'"),
    "Window.tsx spectator branch must gate stageLoadStatus 'matched' on coordinator viewport_sharing.spectator_ready",
);

const appStreamSource = readSource("src/AppStream.tsx");
assert.ok(
    appStreamSource.includes("terminate(false)"),
    "AppStream.tsx must tear down the stream via AppStreamer.terminate(false)",
);
assert.ok(
    !appStreamSource.includes("._stream ="),
    "AppStream.tsx must not assign ._stream directly after switching to AppStreamer.terminate(false)",
);
assert.ok(
    !appStreamSource.includes("as any"),
    "AppStream.tsx must not use `as any` after switching to AppStreamer.terminate(false)",
);

const appSource = readSource("src/App.tsx");
assert.ok(
    appSource.includes("MAX_POLL_RETRIES"),
    "App.tsx must define the MAX_POLL_RETRIES constant",
);

const indexHtmlSource = readSource("index.html");
assert.ok(
    !indexHtmlSource.includes("gfn-client-sdk.js"),
    "index.html must not load gfn-client-sdk.js",
);

console.log("[verify] session-first viewer contract passed");
