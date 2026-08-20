import assert from 'node:assert/strict';
import test from 'node:test';
import { isReady, consoleText } from '../lib/runtime-e2e-readiness.mjs';

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

test('consoleText flattens CDP arg shapes without throwing on empty events', () => {
  assert.equal(consoleText([]), '');
  assert.equal(
    consoleText([{ args: [{ value: 'a' }, { description: 'b' }] }, { args: [{ type: 'c' }] }]),
    'a\nb\nc',
  );
  assert.equal(consoleText([{}]), '');
});
