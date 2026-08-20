// Runtime E2E readiness predicates, extracted from verify-runtime-e2e-cdp.mjs so the
// readiness rules can be unit-tested without launching Chrome. Pure functions only —
// no I/O, no CDP, no module-level side effects.

export function consoleText(events) {
  return events
    .flatMap((event) => event.args || [])
    .map((arg) => String(arg.value || arg.description || arg.type || ""))
    .join("\n");
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
    && !state.bodyHasWaitingText
    && state.pixelStats
    && state.pixelStats.nonBlack > 100
  );
  return { ready, matchedEvidence };
}

export function isReady(state, consoleEvents, options = {}) {
  return inspectReadiness(state, consoleEvents, options).ready;
}
