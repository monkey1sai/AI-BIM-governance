import assert from 'node:assert/strict';
import test from 'node:test';
import {
  consoleText,
  inspectReadiness,
  inspectRealE2E,
  isReady,
  isRealE2EReady,
} from '../lib/runtime-e2e-readiness.mjs';

// A page state that satisfies every gate except the DataChannel axis, so each test below
// isolates exactly one variable: which console/body signal supplies DataChannel evidence.
function baseState(overrides = {}) {
  return {
    readyState: 4,
    videoWidth: 1280,
    videoHeight: 720,
    srcObject: true,
    bodyHasUsdcPanel: true,
    bodyHasArtifactUrl: true,
    bodyHasModelLoaded: true,
    bodyHasWaitingText: false,
    bodyHasDataChannelReply: false,
    bodyHasMakePickableResponse: false,
    bodyHasLoadingStateResponse: false,
    bodyHasSpectatorReady: false,
    bodyHasOpenedStageResult: false,
    pixelStats: { nonBlack: 5000 },
    ...overrides,
  };
}

function consoleEvents(...messages) {
  return messages.map((value) => ({ args: [{ value }] }));
}

test('outbound-only traffic does not satisfy the DataChannel gate', () => {
  // Regression guard for the #671 line: `loadingStateQuery` is what the viewer emits when it
  // *asks* Kit. A session where the viewer talked and Kit never answered must not read ready.
  assert.equal(
    isReady(baseState(), consoleEvents('viewer sent loadingStateQuery'), {}),
    false,
  );
});

test('an inbound Kit reply satisfies the DataChannel gate', () => {
  assert.equal(
    isReady(baseState(), consoleEvents('Kit App sent loadingStateResponse'), {}),
    true,
  );
  assert.equal(
    isReady(baseState({ bodyHasLoadingStateResponse: true }), consoleEvents(), {}),
    true,
  );
  assert.equal(
    isReady(baseState({ bodyHasDataChannelReply: true }), consoleEvents(), {}),
    true,
  );
  assert.equal(
    isReady(baseState(), consoleEvents('makePrimsPickableResponse arrived'), {}),
    true,
  );
});

test('the stage axis stays independent of the DataChannel axis', () => {
  // getChildrenResponse proves the stage query returned; it must not double as DataChannel
  // evidence, otherwise requireDataChannel would collapse into requireStageSuccess.
  assert.equal(
    isReady(baseState({ bodyHasModelLoaded: false }), consoleEvents('getChildrenResponse'), {}),
    false,
  );
});

test('requireDataChannel:false skips the gate entirely', () => {
  assert.equal(
    isReady(baseState(), consoleEvents('viewer sent loadingStateQuery'), { requireDataChannel: false }),
    true,
  );
});

test('non-DataChannel gates still fail closed', () => {
  const withReply = { bodyHasDataChannelReply: true };
  assert.equal(isReady(baseState({ ...withReply, readyState: 1 }), consoleEvents(), {}), false);
  assert.equal(isReady(baseState({ ...withReply, videoWidth: 0 }), consoleEvents(), {}), false);
  assert.equal(isReady(baseState({ ...withReply, srcObject: false }), consoleEvents(), {}), false);
  assert.equal(isReady(baseState({ ...withReply, bodyHasWaitingText: true }), consoleEvents(), {}), false);
  assert.equal(isReady(baseState({ ...withReply, pixelStats: { nonBlack: 3 } }), consoleEvents(), {}), false);
  assert.equal(isReady(baseState({ ...withReply, pixelStats: null }), consoleEvents(), {}), false);
});

test('inspectReadiness names the inbound DataChannel signal that passed', () => {
  assert.equal(
    inspectReadiness(baseState({ bodyHasDataChannelReply: true }), consoleEvents(), {}).matchedEvidence,
    'bodyHasDataChannelReply',
  );
  assert.equal(
    inspectReadiness(baseState({ bodyHasLoadingStateResponse: true }), consoleEvents(), {}).matchedEvidence,
    'bodyHasLoadingStateResponse',
  );
  assert.equal(
    inspectReadiness(baseState(), consoleEvents('Kit App sent loadingStateResponse'), {}).matchedEvidence,
    'loadingStateResponse',
  );
  assert.equal(
    inspectReadiness(baseState(), consoleEvents('makePrimsPickableResponse arrived'), {}).matchedEvidence,
    'makePrimsPickableResponse',
  );
  assert.equal(
    inspectReadiness(baseState(), consoleEvents('viewer sent loadingStateQuery'), {}).matchedEvidence,
    null,
  );
  assert.equal(
    inspectReadiness(baseState(), consoleEvents(), { requireDataChannel: false }).matchedEvidence,
    'requireDataChannel:false',
  );
});

test('consoleText flattens CDP arg shapes without throwing on empty events', () => {
  assert.equal(consoleText([]), '');
  assert.equal(
    consoleText([{ args: [{ value: 'a' }, { description: 'b' }] }, { args: [{ type: 'c' }] }]),
    'a\nb\nc',
  );
  assert.equal(consoleText([{}]), '');
});

test('require-real readiness rejects skipped or missing-manifest evidence', () => {
  assert.deepEqual(inspectRealE2E({ requireReal: true, skipped: false, manifestPresent: true }), {
    ready: true,
    reason: 'REAL_E2E_EVIDENCE_PRESENT',
  });
  assert.equal(isRealE2EReady({ requireReal: true, skipped: true, manifestPresent: true }), false);
  assert.equal(isRealE2EReady({ requireReal: true, skipped: false, manifestPresent: false }), false);
  assert.equal(isRealE2EReady({ requireReal: false, skipped: true, manifestPresent: false }), true);
  assert.equal(
    inspectReadiness(baseState(), consoleEvents(), { requireReal: true, skipped: true, manifestPresent: true }).ready,
    false,
  );
});

test('require-real readiness accepts a manifestPath fallback and rejects bypass modes', () => {
  assert.equal(
    isRealE2EReady({ requireReal: true, skipped: false, manifestPath: 'E2E_STACK_MANIFEST' }),
    true,
  );
  assert.equal(
    isRealE2EReady({ requireReal: true, skipped: false, manifest: null, manifestPath: 'E2E_STACK_MANIFEST' }),
    true,
  );
  assert.equal(
    isRealE2EReady({ requireReal: true, skipped: false, manifest: false }),
    false,
  );
  assert.equal(
    isRealE2EReady({ requireReal: true, skipped: false, mode: 'bypass', manifestPath: 'E2E_STACK_MANIFEST' }),
    false,
  );
});
