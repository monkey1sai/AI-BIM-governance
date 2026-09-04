import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CiLocalParityError,
  assertAdvisoryOnly,
  compareParity,
  summarizeParityCorpus,
} from '../lib/ci-local-parity.mjs';

const HEAD = 'f'.repeat(40);
const OTHER = 'e'.repeat(40);

function plan(overrides = {}) {
  return {
    schema_version: 'verification-plan/v2', subject_sha: HEAD, base_sha: 'a'.repeat(40), dispatch: 'affected', result: 'planned',
    targets: [
      { id: 'viewer', ci_job: 'viewer build and tests', required: true },
      { id: 'root-contracts', ci_job: 'root contracts and fakes', required: true },
      { id: 'coordinator', ci_job: 'coordinator build and tests', required: false },
    ],
    ...overrides,
  };
}

function outcome(gates) {
  return { schema_version: 'verification-outcome/v1', subject_sha: HEAD, manifest_sha256: 'c'.repeat(64), result: 'passed', gates };
}

test('agreeing local and CI results produce agree records and are not disqualifying', () => {
  const record = compareParity({
    outcome: outcome([{ target_id: 'viewer', result: 'passed' }, { target_id: 'root-contracts', result: 'passed' }]),
    plan: plan(),
    checkRuns: [{ name: 'viewer build and tests', conclusion: 'success', head_sha: HEAD }, { name: 'root contracts and fakes', conclusion: 'success', head_sha: HEAD }],
  });
  assert.equal(record.authority, 'advisory_only');
  assert.equal(record.summary.agree, 2);
  assert.equal(record.disqualifying, false);
  assert.equal(assertAdvisoryOnly(record), record);
});

test('local passed where CI failed is a false negative and disqualifying', () => {
  const record = compareParity({
    outcome: outcome([{ target_id: 'viewer', result: 'passed' }, { target_id: 'root-contracts', result: 'passed' }]),
    plan: plan(),
    checkRuns: [{ name: 'viewer build and tests', conclusion: 'failure', head_sha: HEAD }, { name: 'root contracts and fakes', conclusion: 'success', head_sha: HEAD }],
  });
  assert.equal(record.summary.false_negative, 1);
  assert.equal(record.disqualifying, true);
  assert.equal(record.disqualifying_reason, 'local_passed_where_ci_failed');
});

test('local failed where CI passed is a false positive, tolerated but recorded', () => {
  const record = compareParity({
    outcome: outcome([{ target_id: 'viewer', result: 'failed' }, { target_id: 'root-contracts', result: 'passed' }]),
    plan: plan(),
    checkRuns: [{ name: 'viewer build and tests', conclusion: 'success', head_sha: HEAD }, { name: 'root contracts and fakes', conclusion: 'success', head_sha: HEAD }],
  });
  assert.equal(record.summary.false_positive, 1);
  assert.equal(record.disqualifying, false);
});

test('a required target CI skipped or never created is surfaced, never counted as agreement', () => {
  const record = compareParity({
    outcome: outcome([{ target_id: 'viewer', result: 'passed' }, { target_id: 'root-contracts', result: 'passed' }]),
    plan: plan(),
    checkRuns: [{ name: 'viewer build and tests', conclusion: 'skipped', head_sha: HEAD }],
  });
  assert.equal(record.summary.ci_skipped, 1);
  assert.equal(record.summary.ci_missing, 1);
  assert.equal(record.summary.agree, 0);
});

test('a rerun with a decisive conclusion supersedes an earlier skipped check run', () => {
  const record = compareParity({
    outcome: outcome([{ target_id: 'viewer', result: 'passed' }, { target_id: 'root-contracts', result: 'passed' }]),
    plan: plan(),
    checkRuns: [
      { name: 'viewer build and tests', conclusion: 'skipped', head_sha: HEAD },
      { name: 'viewer build and tests', conclusion: 'success', head_sha: HEAD },
      { name: 'root contracts and fakes', conclusion: 'success', head_sha: HEAD },
    ],
  });
  assert.equal(record.summary.agree, 2);
});

test('head mismatch and tiered outcomes are refused (exact-head only, subsets are not parity evidence)', () => {
  assert.throws(() => compareParity({ outcome: outcome([]), plan: plan({ subject_sha: OTHER }), checkRuns: [] }), (error) => error instanceof CiLocalParityError && error.code === 'head_mismatch');
  assert.throws(() => compareParity({ outcome: outcome([]), plan: plan(), checkRuns: [{ name: 'x', conclusion: 'success', head_sha: OTHER }] }), (error) => error.code === 'head_mismatch');
  assert.throws(() => compareParity({ outcome: outcome([]), plan: plan(), checkRuns: [], tier: 'quick' }), (error) => error.code === 'tiered_outcome_not_parity_evidence');
});

test('a parity record can never be promoted to authority', () => {
  assert.throws(() => assertAdvisoryOnly({ schema_version: 'ci-local-parity/v1', authority: 'gate' }), (error) => error.code === 'authority_invalid');
});

test('corpus sufficiency needs enough heads and zero false negatives', () => {
  const good = compareParity({
    outcome: outcome([{ target_id: 'viewer', result: 'passed' }, { target_id: 'root-contracts', result: 'passed' }]),
    plan: plan(),
    checkRuns: [{ name: 'viewer build and tests', conclusion: 'success' }, { name: 'root contracts and fakes', conclusion: 'success' }],
  });
  const few = summarizeParityCorpus([good, good], { minimumHeads: 5 });
  assert.equal(few.sufficient, false);
  assert.deepEqual([...few.insufficient_reasons], ['fewer_than_5_heads']);
  const bad = compareParity({
    outcome: { ...outcome([{ target_id: 'viewer', result: 'passed' }, { target_id: 'root-contracts', result: 'passed' }]), subject_sha: OTHER },
    plan: plan({ subject_sha: OTHER }),
    checkRuns: [{ name: 'viewer build and tests', conclusion: 'failure' }, { name: 'root contracts and fakes', conclusion: 'success' }],
  });
  const withFalseNegative = summarizeParityCorpus([good, bad], { minimumHeads: 1 });
  assert.equal(withFalseNegative.sufficient, false);
  assert.deepEqual([...withFalseNegative.insufficient_reasons], ['false_negative_observed']);
  assert.equal(summarizeParityCorpus([good], { minimumHeads: 1 }).sufficient, true);
});
