import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
  consoleText,
  inspectReadiness,
  inspectRealE2E,
  inspectRealE2EManifest,
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

test('require-real readiness rejects skipped, missing-manifest, or missing Kit authority evidence', () => {
  assert.deepEqual(inspectRealE2E({ requireReal: true, skipped: false, manifestPresent: true, kitAuthorityPresent: true }), {
    ready: true,
    reason: 'REAL_E2E_EVIDENCE_PRESENT',
  });
  assert.equal(isRealE2EReady({ requireReal: true, skipped: true, manifestPresent: true }), false);
  assert.equal(isRealE2EReady({ requireReal: true, skipped: false, manifestPresent: false }), false);
  assert.equal(isRealE2EReady({ requireReal: false, skipped: true, manifestPresent: false }), true);
  assert.deepEqual(inspectRealE2E({ requireReal: true, skipped: false, manifestPresent: true }), {
    ready: false,
    reason: 'REAL_E2E_KIT_AUTHORITY_MISSING',
  });
  assert.equal(
    inspectReadiness(baseState(), consoleEvents(), { requireReal: true, skipped: true, manifestPresent: true }).ready,
    false,
  );
});

test('require-real readiness accepts a manifestPath fallback and rejects bypass modes', () => {
  assert.equal(
    isRealE2EReady({ requireReal: true, skipped: false, manifestPath: 'E2E_STACK_MANIFEST', kitAuthorityPresent: true }),
    true,
  );
  assert.equal(
    isRealE2EReady({ requireReal: true, skipped: false, manifest: null, manifestPath: 'E2E_STACK_MANIFEST', kitAuthorityPresent: true }),
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

test('physical real-E2E manifest binds path, worktree, head, and live process lineage', async () => {
  const root = 'C:\\repo';
  const manifestPath = 'C:\\repo\\artifacts\\e2e\\change-one\\run-one\\isolated-stack.json';
  const manifest = {
    schema_version: 'isolated-branch-stack/v1',
    stack_kind: 'isolated_branch_stack',
    change_id: 'change-one',
    run_id: 'run-one',
    worktree_root: root,
    head_sha: 'a'.repeat(40),
    ports: { coordinator: 8005, governance: 49103, viewer: 5180 },
    base_urls: {
      coordinator: 'http://127.0.0.1:8005',
      governance: 'http://127.0.0.1:49103',
      viewer: 'http://127.0.0.1:5180',
    },
    lifecycle_owners: { coordinator: 'repo_launcher', governance: 'repo_launcher', viewer: 'playwright_webserver' },
    viewer: { expected_port: 5180, owner: 'playwright_webserver', managed_by_launcher: false },
    processes: [
      { role: 'governance', pid: 101, entrypoint: 'app:app', command_line: 'python app', creation_identity: 'c1' },
      { role: 'coordinator', pid: 102, entrypoint: 'src/index.ts', command_line: 'node index', creation_identity: 'c2' },
    ],
  };
  const manifestBytes = (value = manifest) => Buffer.from(JSON.stringify(value), 'utf8');
  const manifestDigest = createHash('sha256').update(manifestBytes()).digest('hex');
  const ports = {
    readManifest: async () => manifestBytes(),
    realpath: async (value) => value,
    readHead: async () => 'a'.repeat(40),
    readStatus: async () => '',
    inspectStack: async () => ({
      status: 'active',
      stack_kind: 'isolated_branch_stack',
      manifest_path: manifestPath,
      viewer: { expected_port: 5180, owner: 'playwright_webserver', managed_by_launcher: false },
      backend: [
        { role: 'governance', pid: 101, owned: true, ready: true },
        { role: 'coordinator', pid: 102, owned: true, ready: true },
      ],
    }),
  };
  const verified = await inspectRealE2EManifest({ manifestPath, worktreeRoot: root, separator: '\\' }, ports);
  assert.equal(verified.ready, true);
  assert.equal(verified.reason, 'REAL_E2E_MANIFEST_VERIFIED');
  assert.equal(verified.binding.viewer_base_url, 'http://127.0.0.1:5180');
  assert.equal(verified.binding.manifest_digest, manifestDigest);

  for (const mutate of [
    (copy) => { copy.head_sha = 'b'.repeat(40); },
    (copy) => { copy.worktree_root = 'C:\\other'; },
    (copy) => { copy.processes[0].creation_identity = ''; },
  ]) {
    const hostilePorts = { ...ports, readManifest: async () => { const copy = structuredClone(manifest); mutate(copy); return manifestBytes(copy); } };
    assert.equal((await inspectRealE2EManifest({ manifestPath, worktreeRoot: root, separator: '\\' }, hostilePorts)).ready, false);
  }
  assert.equal((await inspectRealE2EManifest({ manifestPath: 'C:\\tmp\\forged.json', worktreeRoot: root, separator: '\\' }, ports)).ready, false);
  assert.equal((await inspectRealE2EManifest({ manifestPath, worktreeRoot: root, separator: '\\' }, {
    ...ports,
    inspectStack: async () => ({ status: 'degraded', stack_kind: 'isolated_branch_stack', manifest_path: manifestPath, backend: [] }),
  })).reason, 'REAL_E2E_MANIFEST_LINEAGE_MISMATCH');
  assert.equal((await inspectRealE2EManifest({ manifestPath, worktreeRoot: root, separator: '\\' }, {
    ...ports,
    readStatus: async () => ' M candidate-file',
  })).reason, 'REAL_E2E_WORKTREE_DIRTY');
  assert.equal((await inspectRealE2EManifest({ manifestPath, worktreeRoot: root, separator: '\\' }, {
    ...ports,
    readManifest: async () => manifestBytes({ ...structuredClone(manifest), base_urls: { ...manifest.base_urls, viewer: 'http://127.0.0.1:5173' } }),
  })).reason, 'REAL_E2E_MANIFEST_ENDPOINT_MISMATCH');

  const posixRoot = '/repo';
  const caseVariantPath = '/repo/Artifacts/e2e/change-one/run-one/isolated-stack.json';
  assert.equal((await inspectRealE2EManifest({ manifestPath: caseVariantPath, worktreeRoot: posixRoot, separator: '/' }, {
    ...ports,
    realpath: async (value) => value,
  })).reason, 'REAL_E2E_MANIFEST_PATH_MISMATCH');
  assert.equal((await inspectRealE2EManifest({
    manifestPath: '/tmp/repo\\artifacts\\e2e\\change-one\\run-one\\isolated-stack.json',
    worktreeRoot: '/tmp/repo',
    separator: '\\',
  }, {
    ...ports,
    realpath: async (value) => value,
  })).reason, 'REAL_E2E_MANIFEST_IDENTITY_INVALID');
});
