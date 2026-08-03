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
const showUsdStageDockDefinition = /const showUsdStageDock = this\.state\.showUI[\s\S]*?&& this\.state\.viewerTab === "model"[\s\S]*?&& \(isDebugQueryEnabled\(\) \|\| this\.state\.usdPrims\.length > 0\);/;
assert.match(
    windowSource,
    showUsdStageDockDefinition,
    "USD stage dock must be scoped to the model tab and require debug mode or USD prims",
);
assert.match(
    windowSource,
    /\{showUsdStageDock && \([\s\S]*?data-testid="usd-stage-left-dock"[\s\S]*?reservedLeft=\{showUsdStageDock \? sidebarWidth : 0\}/,
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
    // C M4：_sendStreamMessage 先經 _withRuntimeAuthority(message) 包成授權後的 `outgoing` 再送出，
    // 故送出物件與後續 result 映射/logging 皆針對 `outgoing`（原契約硬編 `message`，於 runtime authority
    // 閘門落地後更新為 `outgoing`；send-object→map-Promise-reply→handle→log 的結構意圖不變）。
    /private _sendStreamMessage[\s\S]*?AppStream\.sendMessage\(outgoing\)[\s\S]*?appStreamResultToAppEvent\(outgoing\.event_type, result\)[\s\S]*?this\._handleCustomEvent\(responseEvent, streamGenerationAtSend\)[\s\S]*?this\._appendDemoOutgoing/,
    "_sendStreamMessage must send the runtime-authority-wrapped object payload through AppStream, handle built-in Promise replies, and log outgoing messages",
);
assert.ok(
    windowSource.includes("const streamGenerationAtSend = this.streamGeneration;"),
    "_sendStreamMessage must capture the stream generation before sending a runtime message",
);
assert.ok(
    windowSource.includes("this._handleCustomEvent(responseEvent, streamGenerationAtSend)"),
    "_sendStreamMessage must ignore Promise replies from a superseded stream generation",
);
assert.ok(
    windowSource.includes("this._isCurrentStreamCallback(streamGenerationAtSend, `${outgoing.event_type}-error`)"),
    "_sendStreamMessage must ignore Promise rejections from a superseded stream generation",
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
    /this\.setState\(\{[\s\S]*?reviewSessionId: sessionId,[\s\S]*?latestStreamConfig: streamConfig,[\s\S]*?\}, \(\) => \{[\s\S]*?this\._scheduleStreamStartTimeout\(\);/,
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
const progressActivityStart = windowSource.indexOf('else if (event.event_type === "updateProgressActivity")');
const progressActivityTail = windowSource.slice(progressActivityStart);
const progressActivityEndMatch = /\n\s*else if \(event\.event_type === "highlightPrimsResult"\)/.exec(progressActivityTail);
const progressActivityEnd = progressActivityEndMatch === null ? -1 : progressActivityStart + progressActivityEndMatch.index;
assert.ok(progressActivityStart >= 0 && progressActivityEnd > progressActivityStart, "updateProgressActivity handler source slice is missing");
const progressActivitySource = windowSource.slice(progressActivityStart, progressActivityEnd);
assert.match(
    progressActivitySource,
    /if \(activityText === "None"\) return;/,
    "updateProgressActivity=None must be advisory only; completion authority is correlated openedStageResult",
);
assert.doesNotMatch(
    progressActivitySource,
    /_recordLoadedStageEvidence|_completeStageLoad/,
    "updateProgressActivity=None must not record stage evidence or complete a stage without correlation",
);
assert.match(
    windowSource,
    /onStopped=\{\(message\) => this\._handleStreamStopped\("stopped", message, renderedStreamGeneration\)\}/,
    "AppStream onStop must surface visible WebRTC disconnect state",
);
assert.match(
    windowSource,
    /onTerminated=\{\(message\) => this\._handleStreamStopped\("terminated", message, renderedStreamGeneration\)\}/,
    "AppStream onTerminate must surface visible WebRTC disconnect state",
);
assert.ok(
    windowSource.includes("private streamGeneration = 0;"),
    "Window.tsx must own a synchronous stream lifecycle generation",
);
assert.match(
    windowSource,
    /private _replaceStreamLifecycle\(\): number \{[\s\S]*?this\.streamGeneration \+= 1;[\s\S]*?this\._invalidateStageAttempt\(\);[\s\S]*?this\._clearStageLoadTimeout\(\);/,
    "stream lifecycle replacement must invalidate callbacks and stage timers synchronously before React remounts",
);
assert.match(
    windowSource,
    /const streamMountKey = streamEndpointChanged[\s\S]*?this\._replaceStreamLifecycle\(\)/,
    "a changed endpoint must replace the stream lifecycle before AppStream receives the new endpoint",
);
assert.ok(
    windowSource.includes("isKitReady: streamEndpointChanged ? false : this.state.isKitReady"),
    "a changed endpoint must not carry Kit readiness into the replacement AppStream lifecycle",
);
assert.ok(
    windowSource.includes("if (!streamEndpointChanged && this.state.isKitReady"),
    "bootstrap must not open a stage before a replacement AppStream generation reports ready",
);
assert.ok(
    windowSource.includes("if (this.state.isKitReady && this._canOpenSelectedAsset())"),
    "onStarted must not schedule an open until its own stream generation reports Kit ready",
);
const stageLoadTimeoutStart = windowSource.indexOf("private _scheduleStageLoadTimeout");
const stageLoadTimeoutEnd = windowSource.indexOf("private _clearStageLoadTimeout", stageLoadTimeoutStart);
assert.ok(stageLoadTimeoutStart >= 0 && stageLoadTimeoutEnd > stageLoadTimeoutStart, "stage timeout source slice is missing");
const stageLoadTimeoutSource = windowSource.slice(stageLoadTimeoutStart, stageLoadTimeoutEnd);
assert.ok(
    stageLoadTimeoutSource.includes("STAGE_LOAD_TIMEOUT_MS"),
    "stage loading must use the fixed 45-second terminal deadline",
);
assert.ok(
    !stageLoadTimeoutSource.includes("_completeStageLoadFromVisibleStream"),
    "the stage timeout must not extend itself when a provisional stream is visible",
);
for (const callback of [
    "this._onStreamStarted(renderedStreamGeneration)",
    "this._onLoggedIn(userId, renderedStreamGeneration)",
    "this._handleCustomEvent(event, renderedStreamGeneration)",
    "this._handleStreamStopped(\"stopped\", message, renderedStreamGeneration)",
    "this._handleStreamStopped(\"terminated\", message, renderedStreamGeneration)",
]) {
    assert.ok(windowSource.includes(callback), `AppStream must bind ${callback} to the rendered stream generation`);
}
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
