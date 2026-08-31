// Runtime E2E readiness predicates, extracted from verify-runtime-e2e-cdp.mjs so the
// readiness rules can be unit-tested without launching Chrome. Pure functions only —
// no I/O, no CDP, no module-level side effects.

export function consoleText(events) {
  return events
    .flatMap((event) => event.args || [])
    .map((arg) => String(arg.value || arg.description || arg.type || ""))
    .join("\n");
}

function truthyRequireReal(value) {
  return value === true || value === 1 || value === "1" || value === "true";
}

function truthySkipped(value) {
  return value === true
    || value === 1
    || value === "1"
    || value === "true"
    || (typeof value === "number" && value > 0);
}

const REAL_E2E_BYPASS_MODES = new Set(["skip", "skipped", "mock", "simulation", "bypass", "shadow"]);

/**
 * Apply the explicit real-browser E2E policy without reading process state.
 * Callers pass launcher-derived values so this predicate remains unit-testable.
 */
export function inspectRealE2E(input = {}) {
  const requireReal = truthyRequireReal(
    input.requireReal ?? input.e2eRequireReal ?? input.E2E_REQUIRE_REAL,
  );
  if (!requireReal) {
    return { ready: true, reason: "REAL_E2E_NOT_REQUIRED" };
  }

  const skipped = truthySkipped(input.skipped ?? input.e2eSkipped)
    || (typeof input.skippedCount === "number" && input.skippedCount > 0);
  if (skipped) {
    return { ready: false, reason: "REAL_E2E_SKIPPED" };
  }

  const mode = input.mode ?? input.e2eMode ?? input.verificationMode;
  if (typeof mode === "string" && REAL_E2E_BYPASS_MODES.has(mode.trim().toLowerCase())) {
    return { ready: false, reason: "REAL_E2E_MODE_BYPASS" };
  }

  const manifest = input.manifestPresent
    ?? input.e2eManifestPresent
    ?? (Boolean(input.manifest) || Boolean(input.manifestPath));
  if (manifest !== true) {
    return { ready: false, reason: "REAL_E2E_MANIFEST_MISSING" };
  }

  return { ready: true, reason: "REAL_E2E_EVIDENCE_PRESENT" };
}

export function isRealE2EReady(input = {}) {
  return inspectRealE2E(input).ready;
}

const DATA_CHANNEL_EVIDENCE = [
  ["bodyHasDataChannelReply", (state) => Boolean(state.bodyHasDataChannelReply)],
  ["bodyHasMakePickableResponse", (state) => Boolean(state.bodyHasMakePickableResponse)],
  ["bodyHasLoadingStateResponse", (state) => Boolean(state.bodyHasLoadingStateResponse)],
  ["makePrimsPickableResponse", (state, log) => log.includes("makePrimsPickableResponse")],
  ["loadingStateResponse", (state, log) => log.includes("loadingStateResponse")],
];

function dataChannelMatch(state, log, requireDataChannel) {
  if (!requireDataChannel) {
    return "requireDataChannel:false";
  }
  for (const [key, test] of DATA_CHANNEL_EVIDENCE) {
    if (test(state, log)) return key;
  }
  return null;
}

export function inspectReadiness(state, consoleEvents, options = {}) {
  const requireDataChannel = options.requireDataChannel !== false;
  const requireStageSuccess = options.requireStageSuccess !== false;
  const realE2E = inspectRealE2E(options);
  const log = consoleText(consoleEvents);
  const hasOpenedStageSuccess =
    state.bodyHasModelLoaded
    || (
      state.bodyHasOpenedStageResult
      && !log.includes("Kit App communicates there was an error loading")
    )
    || (log.includes("openedStageResult") && log.includes('"result":"success"'));
  const hasStageQuerySuccess =
    log.includes("Kit App sent stage prims")
    || log.includes("getChildrenResponse");
  const hasStageSuccess =
    hasOpenedStageSuccess
    || hasStageQuerySuccess;
  // Every disjunct MUST be an inbound signal from Kit. `loadingStateQuery` used to be
  // accepted here, but that is the string the viewer emits when it *asks* — accepting it
  // let a session with zero Kit replies satisfy the DataChannel gate (#671 line, 2026-08-20).
  // `getChildrenResponse` is deliberately excluded: it is the stage axis' signal and is
  // already consumed by hasStageQuerySuccess; reusing it here would collapse the two axes.
  const matchedEvidence = dataChannelMatch(state, log, requireDataChannel);
  const ready = Boolean(
    state
    && state.readyState >= 2
    && state.videoWidth > 0
    && state.videoHeight > 0
    && state.srcObject
    && state.bodyHasUsdcPanel
    && state.bodyHasArtifactUrl
    && (!requireStageSuccess || hasStageSuccess || state.bodyHasSpectatorReady)
    && (!requireDataChannel || (matchedEvidence && matchedEvidence !== "requireDataChannel:false"))
    && realE2E.ready
    && !state.bodyHasWaitingText
    && state.pixelStats
    && state.pixelStats.nonBlack > 100
  );
  return { ready, matchedEvidence, realE2E };
}

export function isReady(state, consoleEvents, options = {}) {
  return inspectReadiness(state, consoleEvents, options).ready;
}
