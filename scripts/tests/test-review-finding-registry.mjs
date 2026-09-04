import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ReviewFindingRegistryError,
  assertRoundAdvance,
  classifyStaleness,
  computeFindingFingerprint,
  createJoinRecord,
  indexRegistry,
  joinKey,
  sameFingerprintNoNewEvidence,
  validateJoinRecord,
} from '../lib/review-finding-registry.mjs';

const BASE = 'a'.repeat(40);
const HEAD1 = 'b'.repeat(40);
const HEAD2 = 'c'.repeat(40);
const EVIDENCE1 = '1'.repeat(64);
const EVIDENCE2 = '2'.repeat(64);

const fingerprint = computeFindingFingerprint({ origin: 'reviewer', path: 'bim-review-coordinator/src/app.ts', symbol: 'startServer', rule: 'correctness/null-guard', title: 'Missing null guard on session lookup' });

function record(overrides = {}) {
  return createJoinRecord({
    repository: 'monkey1sai/AI-BIM-governance', pr_number: 784, base_sha: BASE, head_sha: HEAD1,
    finding_id: 'f-001', fingerprint, origin: 'reviewer', round: 1, evidence_fingerprint: EVIDENCE1,
    touched_paths: ['bim-review-coordinator/src/app.ts'],
    ...overrides,
  });
}

test('fingerprint is stable across line numbers, whitespace and case, but changes on material content', () => {
  const same = computeFindingFingerprint({ origin: 'reviewer', path: 'bim-review-coordinator/src/app.ts', symbol: 'startServer', rule: 'Correctness/Null-Guard', title: '  missing NULL guard   on session lookup ' });
  assert.equal(same, fingerprint);
  const differentRule = computeFindingFingerprint({ origin: 'reviewer', path: 'bim-review-coordinator/src/app.ts', symbol: 'startServer', rule: 'security/injection', title: 'Missing null guard on session lookup' });
  assert.notEqual(differentRule, fingerprint);
  const differentPath = computeFindingFingerprint({ origin: 'reviewer', path: 'bim-review-coordinator/src/other.ts', symbol: 'startServer', rule: 'correctness/null-guard', title: 'Missing null guard on session lookup' });
  assert.notEqual(differentPath, fingerprint);
  assert.throws(() => computeFindingFingerprint({ origin: 'gossip', path: 'x', rule: 'r', title: 't' }), (error) => error instanceof ReviewFindingRegistryError);
});

test('join records are exact-key validated and never extend the existing finding shapes', () => {
  const valid = record();
  assert.equal(valid.resolution, 'open');
  assert.throws(() => validateJoinRecord({ ...valid, threadId: 'x' }), (error) => error.code === 'join_shape_invalid');
  assert.throws(() => validateJoinRecord({ ...valid, round: 3 }), (error) => error.code === 'join_invalid');
  assert.throws(() => validateJoinRecord({ ...valid, disposition: 'DEFERRED' }), (error) => error.code === 'join_invalid');
  assert.equal(validateJoinRecord({ ...valid, disposition: 'DEFERRED', follow_up: 'https://github.com/monkey1sai/AI-BIM-governance/issues/999' }).disposition, 'DEFERRED');
});

test('registry index rejects duplicate (head_sha, finding_id) keys', () => {
  const a = record();
  const b = record({ head_sha: HEAD2 });
  const index = indexRegistry([a, b]);
  assert.equal(index.size, 2);
  assert.equal(joinKey(a), `${HEAD1}:f-001`);
  assert.throws(() => indexRegistry([a, record()]), (error) => error.code === 'join_duplicate');
});

test('the disposition field is bound to the closed delivery enum, matching the JSON schema', () => {
  const valid = record();
  assert.throws(() => validateJoinRecord({ ...valid, disposition: 'NOT_REAL' }), (error) => error.code === 'join_invalid');
  assert.throws(() => validateJoinRecord({ ...valid, disposition: 'fix_now' }), (error) => error.code === 'join_invalid');
  for (const disposition of ['ACCEPTED', 'FIX_REQUIRED', 'FALSE_POSITIVE', 'ESCALATE']) {
    assert.equal(validateJoinRecord({ ...valid, disposition }).disposition, disposition);
  }
  assert.equal(validateJoinRecord({ ...valid, disposition: null }).disposition, null);
});

test('a round advance may not cross repository, PR, finding identity or base lineage', () => {
  const first = record();
  const advance = (overrides) => assertRoundAdvance(first, record({ round: 2, evidence_fingerprint: EVIDENCE2, ...overrides }));
  assert.equal(advance({}).round, 2, 'the in-identity advance still works');
  for (const overrides of [
    { repository: 'someone/else' },
    { pr_number: 999 },
    { finding_id: 'f-002' },
    { origin: 'ci' },
    { base_sha: 'd'.repeat(40) },
  ]) {
    assert.throws(() => advance(overrides), (error) => error.code === 'round_advance_invalid', JSON.stringify(overrides));
  }
});

test('same fingerprint with no new evidence is refused as a retry', () => {
  const first = record();
  const rerun = record({ round: 2, head_sha: HEAD2 });
  assert.equal(sameFingerprintNoNewEvidence(first, rerun), true);
  assert.throws(() => assertRoundAdvance(first, rerun), (error) => error.code === 'same_evidence_fingerprint_no_retry');
  const withNewEvidence = record({ round: 2, head_sha: HEAD2, evidence_fingerprint: EVIDENCE2 });
  assert.equal(sameFingerprintNoNewEvidence(first, withNewEvidence), false);
  assert.equal(assertRoundAdvance(first, withNewEvidence).round, 2);
});

test('round advance is bounded at two and must be sequential', () => {
  const first = record();
  assert.throws(() => assertRoundAdvance(first, record({ round: 1, evidence_fingerprint: EVIDENCE2 })), (error) => error.code === 'round_advance_invalid');
  const second = record({ round: 2, evidence_fingerprint: EVIDENCE2 });
  assert.throws(() => validateJoinRecord({ ...second, round: 3 }), (error) => error.code === 'join_invalid');
});

test('staleness: exact head is current, untouched paths need recheck, touched paths supersede', () => {
  const join = record();
  assert.equal(classifyStaleness(join, { currentHeadSha: HEAD1, changedPathsSinceRecord: [] }).staleness, 'current');
  const moved = classifyStaleness(join, { currentHeadSha: HEAD2, changedPathsSinceRecord: ['docs/agents/domain.md'] });
  assert.equal(moved.staleness, 'head_moved_recheck');
  assert.equal(moved.authority, 'none');
  const superseded = classifyStaleness(join, { currentHeadSha: HEAD2, changedPathsSinceRecord: ['bim-review-coordinator/src/app.ts'] });
  assert.equal(superseded.staleness, 'superseded');
  assert.deepEqual(superseded.touched, ['bim-review-coordinator/src/app.ts']);
});
