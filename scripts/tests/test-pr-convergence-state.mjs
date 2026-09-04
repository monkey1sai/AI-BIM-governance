import assert from 'node:assert/strict';
import test from 'node:test';
import { advanceReviewLoop } from '../lib/risk-proportional-review.mjs';
import {
  CONVERGENCE_STATES,
  PrConvergenceStateError,
  TRANSITIONS,
  assertTransition,
  deriveConvergenceState,
  evaluateMergePreconditions,
  retryCarriesNewInformation,
} from '../lib/pr-convergence-state.mjs';

const SHA1 = 'a'.repeat(40);
const SHA2 = 'b'.repeat(40);
const D = (char) => char.repeat(64);

function attempt(index, overrides = {}) {
  return {
    attempt: index, head_sha: SHA1, policy_sha256: D('1'), input_sha256: D('2'), verification_manifest_sha256: D('3'),
    evidence_fingerprint: D('4'), action: 'deterministic_verify', expected_new_evidence: [], observed_new_evidence: ['gate:root-contracts'],
    decision: 'continue', ...overrides,
  };
}

function loopWith(attempts) {
  return advanceReviewLoop({ schema_version: 'review-loop-input/v1', max_attempts: 2, max_evidence_delta_requests: 1, attempts });
}

function observe(overrides = {}) {
  return {
    loop: { state: 'continue', reason: 'initial_deterministic_collection_required', attempts_used: 0 },
    bundle_status: null,
    threads: { complete: true, unresolved: 0 },
    findings: { fix_required_open: 0, escalate: 0 },
    verifying: false,
    disposition_pending: false,
    ...overrides,
  };
}

test('eight states are declared and terminal states have no exits', () => {
  assert.equal(CONVERGENCE_STATES.length, 8);
  for (const terminal of ['CONVERGED', 'HELD', 'ESCALATED']) assert.deepEqual([...TRANSITIONS[terminal]], []);
});

test('fresh PR with no attempts is REVIEW_PENDING', () => {
  const state = deriveConvergenceState(observe());
  assert.equal(state.state, 'REVIEW_PENDING');
  assert.equal(state.final_sync_permitted, false);
  assert.equal(state.rounds_remaining, 2);
});

test('open FIX_REQUIRED findings put the PR in FIXING; running gates put it in VERIFYING', () => {
  assert.equal(deriveConvergenceState(observe({ loop: { state: 'continue', attempts_used: 1 }, findings: { fix_required_open: 2, escalate: 0 } })).state, 'FIXING');
  assert.equal(deriveConvergenceState(observe({ loop: { state: 'continue', attempts_used: 1 }, verifying: true })).state, 'VERIFYING');
  assert.equal(deriveConvergenceState(observe({ loop: { state: 'continue', attempts_used: 1 }, disposition_pending: true })).state, 'DISPOSITION');
  assert.equal(deriveConvergenceState(observe({ loop: { state: 'continue', attempts_used: 1 } })).state, 'RE_REVIEW');
});

test('CONVERGED requires loop complete, threads resolved, no open fixes, nothing verifying', () => {
  const converged = deriveConvergenceState(observe({ loop: { state: 'complete', attempts_used: 1 }, bundle_status: 'passed' }));
  assert.equal(converged.state, 'CONVERGED');
  assert.equal(converged.final_sync_permitted, true);
  assert.equal(converged.terminal, true);
  assert.equal(deriveConvergenceState(observe({ loop: { state: 'complete', attempts_used: 1 }, threads: { complete: true, unresolved: 1 } })).state, 'DISPOSITION');
  assert.equal(deriveConvergenceState(observe({ loop: { state: 'complete', attempts_used: 1 }, findings: { fix_required_open: 1, escalate: 0 } })).state, 'FIXING');
  assert.equal(deriveConvergenceState(observe({ loop: { state: 'complete', attempts_used: 1 }, threads: { complete: false, unresolved: 0 } })).state, 'HELD');
});

test('a human-required or blocked terminal decision never converges, however clean the threads are', () => {
  for (const reason of ['terminal_decision_human_required', 'terminal_decision_blocked']) {
    const state = deriveConvergenceState(observe({ loop: { state: 'complete', reason, attempts_used: 2 } }));
    assert.equal(state.state, 'HELD', reason);
    assert.equal(state.requires_human, true, reason);
    assert.equal(state.final_sync_permitted, false, reason);
    assert.equal(state.reason, reason);
  }
  // The real loop machine actually produces this shape, so the guard is not hypothetical.
  const live = loopWith([attempt(1), attempt(2, { action: 'human_review', evidence_fingerprint: D('7'), observed_new_evidence: ['review'], decision: 'human_required' })]);
  assert.equal(live.state, 'complete');
  assert.equal(live.reason, 'terminal_decision_human_required');
  assert.equal(deriveConvergenceState(observe({ loop: live })).state, 'HELD');
});

test('only an advisory pass or a passed bundle is a successful loop outcome', () => {
  assert.equal(deriveConvergenceState(observe({ loop: { state: 'complete', reason: 'terminal_decision_advisory_pass', attempts_used: 1 } })).state, 'CONVERGED');
  // advisory_review completed the loop but the findings still owe a disposition.
  const advisory = deriveConvergenceState(observe({ loop: { state: 'complete', reason: 'terminal_decision_advisory_review', attempts_used: 1 } }));
  assert.equal(advisory.state, 'DISPOSITION');
  assert.equal(advisory.final_sync_permitted, false);
});

test('escalation wins over everything and requires a human', () => {
  const escalated = deriveConvergenceState(observe({ loop: { state: 'complete', attempts_used: 2 }, findings: { fix_required_open: 0, escalate: 1 } }));
  assert.equal(escalated.state, 'ESCALATED');
  assert.equal(escalated.requires_human, true);
  assert.equal(escalated.final_sync_permitted, false);
  assert.equal(deriveConvergenceState(observe({ bundle_status: 'escalated' })).state, 'ESCALATED');
});

test('the real loop machine drives HELD after two rounds (Case 7) and on identity change (Case 8)', () => {
  const exhausted = loopWith([attempt(1), attempt(2, { action: 'model_review', evidence_fingerprint: D('5'), observed_new_evidence: ['review:r2'], decision: 'continue' })]);
  assert.equal(exhausted.state, 'held');
  const state = deriveConvergenceState(observe({ loop: exhausted }));
  assert.equal(state.state, 'HELD');
  assert.equal(state.reason, 'attempt_budget_exhausted');
  const moved = loopWith([attempt(1), attempt(2, { head_sha: SHA2, evidence_fingerprint: D('5') })]);
  assert.equal(moved.reason, 'exact_identity_changed_restart_cycle');
  assert.equal(deriveConvergenceState(observe({ loop: moved })).state, 'HELD');
});

test('same evidence fingerprint is refused as a retry by the underlying loop', () => {
  const rerun = loopWith([attempt(1), attempt(2, { action: 'model_review', decision: 'continue' })]);
  assert.equal(rerun.reason, 'same_evidence_fingerprint_no_retry');
  assert.equal(deriveConvergenceState(observe({ loop: rerun })).state, 'HELD');
});

test('retry carries new information only when a material field changed', () => {
  const previous = attempt(1);
  assert.equal(retryCarriesNewInformation(previous, attempt(2)).new_information, false);
  const withNewEvidence = retryCarriesNewInformation(previous, attempt(2, { evidence_fingerprint: D('9') }));
  assert.equal(withNewEvidence.new_information, true);
  assert.deepEqual([...withNewEvidence.changed_fields], ['evidence_fingerprint']);
  assert.throws(() => retryCarriesNewInformation({}, attempt(2)), (error) => error instanceof PrConvergenceStateError);
});

test('transitions are checked and terminal states cannot be left automatically', () => {
  assert.equal(assertTransition('REVIEW_PENDING', 'DISPOSITION'), 'DISPOSITION');
  assert.equal(assertTransition('FIXING', 'VERIFYING'), 'VERIFYING');
  assert.throws(() => assertTransition('HELD', 'FIXING'), (error) => error.code === 'transition_invalid');
  assert.throws(() => assertTransition('REVIEW_PENDING', 'CONVERGED'), (error) => error.code === 'transition_invalid');
});

test('every state the projector can emit is reachable through the transition graph', () => {
  // The projector and the transition table are two descriptions of one machine; if a valid
  // observation projects to a state the graph forbids, one of them is wrong.
  const cases = [
    { from: 'REVIEW_PENDING', observation: observe({ loop: { state: 'continue', attempts_used: 0 }, verifying: true }), expect: 'VERIFYING' },
    { from: 'RE_REVIEW', observation: observe({ loop: { state: 'continue', attempts_used: 1 }, verifying: true }), expect: 'VERIFYING' },
    { from: 'VERIFYING', observation: observe({ loop: { state: 'continue', attempts_used: 1 }, findings: { fix_required_open: 1, escalate: 0 } }), expect: 'FIXING' },
    { from: 'RE_REVIEW', observation: observe({ loop: { state: 'continue', attempts_used: 1 }, findings: { fix_required_open: 1, escalate: 0 } }), expect: 'FIXING' },
    { from: 'VERIFYING', observation: observe({ loop: { state: 'continue', attempts_used: 1 }, disposition_pending: true }), expect: 'DISPOSITION' },
  ];
  for (const { from, observation, expect } of cases) {
    assert.equal(deriveConvergenceState(observation).state, expect, `${from} -> ${expect}`);
    assert.equal(assertTransition(from, expect), expect, `${from} -> ${expect} must be a legal edge`);
  }
});

test('merge preconditions are observed, never granted (Case 10)', () => {
  const ready = evaluateMergePreconditions({ state: 'CONVERGED', exact_head_evidence_valid: true, required_checks_green: true, human_approval_valid: true });
  assert.equal(ready.observed_ready, true);
  assert.equal(ready.ready, false);
  assert.equal(ready.authority, 'server_side_only');
  const stale = evaluateMergePreconditions({ state: 'CONVERGED', exact_head_evidence_valid: false, required_checks_green: true, human_approval_valid: true });
  assert.deepEqual([...stale.unmet], ['exact_head_evidence_invalid_or_stale']);
});

test('observations exceeding the bounded budget are rejected', () => {
  assert.throws(() => deriveConvergenceState(observe({ loop: { state: 'continue', attempts_used: 3 } })), (error) => error.code === 'observation_invalid');
});
