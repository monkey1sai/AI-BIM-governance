import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CiLocalParityError,
  assertAdvisoryOnly,
  compareParity,
  summarizeParityCorpus,
} from '../lib/ci-local-parity.mjs';
import { hashJson } from '../lib/verification-outcome.mjs';

const HEAD = 'f'.repeat(40);
const OTHER = 'e'.repeat(40);
const BASE = 'a'.repeat(40);
const ACTIONS_APP = 15368;

function plan(overrides = {}) {
  return {
    schema_version: 'verification-plan/v2', subject_sha: HEAD, base_sha: BASE, dispatch: 'affected', result: 'planned',
    targets: [
      { id: 'viewer', ci_job: 'viewer build and tests', required: true },
      { id: 'root-contracts', ci_job: 'root contracts and fakes', required: true },
      { id: 'coordinator', ci_job: 'coordinator build and tests', required: false },
    ],
    ...overrides,
  };
}

// The outcome is bound to its plan by plan_sha256; parity must reuse that binding, so fixtures
// have to be built from the plan rather than hand-written.
function outcome(gates, boundPlan = plan(), overrides = {}) {
  return {
    schema_version: 'verification-outcome/v1', manifest_version: 'verification-manifest/v2',
    manifest_sha256: 'c'.repeat(64), plan_sha256: hashJson(boundPlan),
    base_sha: boundPlan.base_sha, subject_sha: boundPlan.subject_sha, dispatch: boundPlan.dispatch,
    started_at: '2026-09-04T00:00:00.000Z', completed_at: '2026-09-04T00:01:00.000Z', duration_ms: 60000,
    result: 'passed', gates, ...overrides,
  };
}

const bothPassed = [{ target_id: 'viewer', result: 'passed' }, { target_id: 'root-contracts', result: 'passed' }];
const check = (name, conclusion, extra = {}) => ({ name, conclusion, head_sha: HEAD, app_id: ACTIONS_APP, ...extra });

// Every fixture outcome is built from its plan, so the plan binding holds by construction; the
// binding check has its own dedicated test below.
function parity(gates, checkRuns, options = {}) {
  return compareParity({ outcome: outcome(gates), plan: plan(), checkRuns, expectedAppId: ACTIONS_APP, ...options });
}

test('agreeing local and CI results produce agree records and are not disqualifying', () => {
  const record = parity(bothPassed, [check('viewer build and tests', 'success'), check('root contracts and fakes', 'success')]);
  assert.equal(record.authority, 'advisory_only');
  assert.equal(record.summary.agree, 2);
  assert.equal(record.disqualifying, false);
  assert.equal(assertAdvisoryOnly(record), record);
});

test('local passed where CI failed is a false negative and disqualifying', () => {
  const record = parity(bothPassed, [check('viewer build and tests', 'failure'), check('root contracts and fakes', 'success')]);
  assert.equal(record.summary.false_negative, 1);
  assert.equal(record.disqualifying, true);
  assert.equal(record.disqualifying_reason, 'local_passed_where_ci_failed');
});

test('local failed where CI passed is a false positive, tolerated but recorded', () => {
  const record = parity([{ target_id: 'viewer', result: 'failed' }, { target_id: 'root-contracts', result: 'passed' }],
    [check('viewer build and tests', 'success'), check('root contracts and fakes', 'success')]);
  assert.equal(record.summary.false_positive, 1);
  assert.equal(record.disqualifying, false);
});

test('a required target CI skipped or never created is surfaced, never counted as agreement', () => {
  const record = parity(bothPassed, [check('viewer build and tests', 'skipped')]);
  assert.equal(record.summary.ci_skipped, 1);
  assert.equal(record.summary.ci_missing, 1);
  assert.equal(record.summary.agree, 0);
});

test('a rerun with a decisive conclusion supersedes an earlier skipped check run', () => {
  const record = parity(bothPassed, [
    check('viewer build and tests', 'skipped'), check('viewer build and tests', 'success'), check('root contracts and fakes', 'success'),
  ]);
  assert.equal(record.summary.agree, 2);
});

test('a same-name check from another App is not mistaken for the required Actions run', () => {
  const record = parity(bothPassed, [
    check('viewer build and tests', 'success', { app_id: 99999 }),
    check('root contracts and fakes', 'success'),
  ]);
  assert.equal(record.summary.ci_missing, 1, 'the foreign-App check is ignored, not compared');
  assert.equal(record.summary.agree, 1);
  const unfiltered = parity(bothPassed, [
    check('viewer build and tests', 'success', { app_id: 99999 }), check('root contracts and fakes', 'success'),
  ], { expectedAppId: null });
  assert.equal(unfiltered.summary.agree, 2, 'without an expected App id every same-name check is eligible');
});

test('the outcome must be bound to the exact plan, not merely the same head', () => {
  const realPlan = plan();
  const bound = outcome(bothPassed, realPlan);
  const runs = [check('viewer build and tests', 'success'), check('root contracts and fakes', 'success')];
  assert.equal(compareParity({ outcome: bound, plan: realPlan, checkRuns: runs, expectedAppId: ACTIONS_APP }).summary.agree, 2);
  // Same head, different gate set: plan_sha256 no longer matches, so parity must refuse.
  const otherPlan = plan({ targets: [{ id: 'viewer', ci_job: 'viewer build and tests', required: true }] });
  assert.throws(() => compareParity({ outcome: bound, plan: otherPlan, checkRuns: runs, expectedAppId: ACTIONS_APP }),
    (error) => error instanceof CiLocalParityError && error.code === 'plan_binding_invalid');
});

test('head mismatch and tiered outcomes are refused (exact-head only, subsets are not parity evidence)', () => {
  assert.throws(() => compareParity({ outcome: outcome([]), plan: plan({ subject_sha: OTHER }), checkRuns: [] }),
    (error) => error instanceof CiLocalParityError && error.code === 'head_mismatch');
  assert.throws(() => parity([], [check('x', 'success', { head_sha: OTHER })]), (error) => error.code === 'head_mismatch');
  assert.throws(() => parity([], [], { tier: 'quick' }), (error) => error.code === 'tiered_outcome_not_parity_evidence');
});

test('a parity record can never be promoted to authority', () => {
  assert.throws(() => assertAdvisoryOnly({ schema_version: 'ci-local-parity/v1', authority: 'gate' }), (error) => error.code === 'authority_invalid');
});

test('corpus sufficiency needs enough heads, zero false negatives, and real comparisons', () => {
  const good = parity(bothPassed, [check('viewer build and tests', 'success'), check('root contracts and fakes', 'success')]);
  const few = summarizeParityCorpus([good, good], { minimumHeads: 5 });
  assert.equal(few.sufficient, false);
  assert.deepEqual([...few.insufficient_reasons], ['fewer_than_5_heads']);

  const bad = compareParity({
    outcome: outcome(bothPassed, plan({ subject_sha: OTHER })), plan: plan({ subject_sha: OTHER }),
    checkRuns: [{ name: 'viewer build and tests', conclusion: 'failure' }, { name: 'root contracts and fakes', conclusion: 'success' }],
    expectedAppId: ACTIONS_APP,
  });
  const withFalseNegative = summarizeParityCorpus([good, bad], { minimumHeads: 1 });
  assert.equal(withFalseNegative.sufficient, false);
  assert.deepEqual([...withFalseNegative.insufficient_reasons], ['false_negative_observed']);
  assert.equal(summarizeParityCorpus([good], { minimumHeads: 1 }).sufficient, true);
});

test('a corpus of only incomplete records is never sufficient, however many heads it has', () => {
  // Every record has the required head count and zero false negatives, but nothing was actually
  // compared: CI never produced a result. This must not qualify a migration phase.
  const empty = parity(bothPassed, []);
  assert.equal(empty.summary.ci_missing, 2);
  const summary = summarizeParityCorpus([empty, empty], { minimumHeads: 1 });
  assert.equal(summary.false_negatives, 0);
  assert.equal(summary.compared_entries, 0);
  assert.equal(summary.incomplete_divergences, 4);
  assert.equal(summary.sufficient, false);
  assert.ok(summary.insufficient_reasons.includes('incomplete_divergence_observed'));
  assert.ok(summary.insufficient_reasons.includes('no_comparable_observation'));
  assert.deepEqual([...summary.targets_observed], [], 'an uncompared target is not an observed target');
});

test('sufficiency can require that every named target was actually compared', () => {
  const partial = parity(bothPassed, [check('viewer build and tests', 'success')]);
  const summary = summarizeParityCorpus([partial], { minimumHeads: 1, requiredTargets: ['viewer', 'root-contracts'] });
  assert.equal(summary.sufficient, false);
  assert.deepEqual([...summary.required_targets_missing], ['root-contracts']);
  assert.ok(summary.insufficient_reasons.includes('required_target_never_compared'));
});
