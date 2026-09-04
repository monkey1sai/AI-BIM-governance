import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  BaseSyncPolicyError,
  SYNC_REASONS,
  assertSyncReason,
  classifyBaseSyncCounts,
  evaluateBaseSync,
  validateBaseSyncPolicy,
} from '../lib/base-sync-policy.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const policy = JSON.parse(readFileSync(path.join(root, 'scripts', 'base-sync-policy.json'), 'utf8'));
const manifest = JSON.parse(readFileSync(path.join(root, 'scripts', 'verification-manifest.json'), 'utf8'));

const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);
const SHA_H = 'c'.repeat(40);
const DIGEST = 'd'.repeat(64);

function input(overrides = {}) {
  return {
    schema_version: 'base-sync-decision/v1',
    pr_number: 784,
    repository: 'monkey1sai/AI-BIM-governance',
    loop_state: 'continue',
    converged: false,
    at_merge_sink: false,
    merge_state_status: 'BEHIND',
    mergeable: 'MERGEABLE',
    base_sha_current: SHA_B,
    base_sha_at_branch: SHA_A,
    head_sha: SHA_H,
    pr_changed_paths: ['web-viewer-sample/src/console/Panel.tsx'],
    base_advance_changed_paths: ['docs/agents/domain.md'],
    verification_manifest_sha256: DIGEST,
    ...overrides,
  };
}

function sync(index, overrides = {}) {
  return {
    index,
    timestamp: '2026-09-04T00:00:00Z',
    timestamp_source: 'github_commit_committer_date',
    reason: 'protection_forced',
    phase: 'post_convergence',
    initiated_by: 'agent',
    initiator_identity: 'monkey1sai',
    base_sha_before: SHA_A,
    base_sha_after: SHA_B,
    head_sha_before: SHA_H,
    head_sha_after: SHA_H,
    merge_state_status_before: 'BEHIND',
    ...overrides,
  };
}

test('the committed policy validates and pins the closed reason enum', () => {
  const validated = validateBaseSyncPolicy(policy);
  assert.deepEqual([...validated.decision.allowed_reasons].sort(), [...SYNC_REASONS].sort());
  assert.equal(validated.decision.default, 'forbidden');
  assert.ok(validated.decision.rejected_reasons.includes('base_advanced'));
});

test('main advanced with no path overlap forbids sync (the core negative case)', () => {
  const decision = evaluateBaseSync(input(), { policy, manifest });
  assert.equal(decision.may_sync, false);
  assert.equal(decision.reason, null);
  assert.equal(decision.counts_toward, 'discretionary');
  assert.ok(decision.violations.includes('base_advanced_is_not_a_reason'));
});

test('BEHIND alone is never a sync reason', () => {
  const decision = evaluateBaseSync(input({ base_advance_changed_paths: [] }), { policy, manifest });
  assert.equal(decision.may_sync, false);
});

test('pre-convergence protection_forced is unavailable (INV-1)', () => {
  const decision = evaluateBaseSync(input({ at_merge_sink: true, converged: false }), { policy, manifest });
  assert.equal(decision.may_sync, false);
  assert.ok(decision.violations.includes('merge_sink_unreachable_pre_convergence'));
});

test('routine freshness is not in the reason enum', () => {
  assert.throws(() => assertSyncReason('base_advanced', policy), (error) => error instanceof BaseSyncPolicyError && error.code === 'reason_rejected');
  assert.throws(() => assertSyncReason('felt_like_it', policy), (error) => error instanceof BaseSyncPolicyError && error.code === 'reason_not_allowed');
  for (const reason of SYNC_REASONS) assert.equal(assertSyncReason(reason, policy), reason);
});

test('same-target different-file overlap alone does not qualify', () => {
  const decision = evaluateBaseSync(input({
    pr_changed_paths: ['web-viewer-sample/src/console/A.tsx'],
    base_advance_changed_paths: ['web-viewer-sample/src/console/B.tsx'],
  }), { policy, manifest });
  assert.equal(decision.may_sync, false);
  assert.ok(decision.evidence.shared_target_ids.length > 0, 'both sides land on the viewer target');
  assert.equal(decision.evidence.boundary_crossing, false);
});

test('real conflict permits sync', () => {
  const decision = evaluateBaseSync(input({ mergeable: 'CONFLICTING' }), { policy, manifest });
  assert.equal(decision.may_sync, true);
  assert.equal(decision.reason, 'real_conflict');
  assert.equal(decision.counts_toward, 'excepted');
});

test('direct file overlap permits sync', () => {
  const decision = evaluateBaseSync(input({
    pr_changed_paths: ['bim-review-coordinator/src/app.ts'],
    base_advance_changed_paths: ['bim-review-coordinator/src/app.ts'],
  }), { policy, manifest });
  assert.equal(decision.may_sync, true);
  assert.equal(decision.reason, 'semantic_overlap');
  assert.deepEqual(decision.evidence.direct_overlap_paths, ['bim-review-coordinator/src/app.ts']);
});

test('shared root-contract scope permits sync', () => {
  const decision = evaluateBaseSync(input({
    pr_changed_paths: ['bim-review-coordinator/src/app.ts'],
    base_advance_changed_paths: ['tests/contracts/test_something.py'],
  }), { policy, manifest });
  assert.equal(decision.may_sync, true);
  assert.equal(decision.reason, 'semantic_overlap');
  assert.equal(decision.evidence.boundary_crossing, true);
});

test('base workflow change permits sync as base_affects_correctness', () => {
  const decision = evaluateBaseSync(input({ base_advance_changed_paths: ['.github/workflows/ci.yml'] }), { policy, manifest });
  assert.equal(decision.may_sync, true);
  assert.ok(decision.reasons.includes('base_affects_correctness'));
});

test('unknown base path fails closed to allowed', () => {
  const decision = evaluateBaseSync(input({ base_advance_changed_paths: ['some/unclassified/path.xyz'] }), { policy, manifest });
  assert.equal(decision.may_sync, true);
  assert.equal(decision.reason, 'semantic_overlap');
  assert.deepEqual(decision.evidence.unknown_base_paths, ['some/unclassified/path.xyz']);
});

test('converged PR at merge sink with BEHIND permits exactly one protection_forced sync', () => {
  const decision = evaluateBaseSync(input({ converged: true, loop_state: 'complete', at_merge_sink: true }), { policy, manifest });
  assert.equal(decision.may_sync, true);
  assert.equal(decision.reason, 'protection_forced');
  assert.equal(decision.counts_toward, 'protection_forced');
  assert.equal(decision.phase, 'post_convergence');
});

test('protection forced a second sync is not a violation (the honest case)', () => {
  const counts = classifyBaseSyncCounts([sync(1), sync(2)], { policy });
  assert.equal(counts.compliant, true);
  assert.equal(counts.final_sync_count, 2);
  assert.equal(counts.protection_forced_sync_count, 2);
  assert.equal(counts.discretionary_sync_count, 0);
  assert.deepEqual(counts.violations, []);
});

test('main racing ahead repeatedly stays compliant but raises a starvation warning', () => {
  const counts = classifyBaseSyncCounts([sync(1), sync(2), sync(3), sync(4)], { policy });
  assert.equal(counts.compliant, true);
  assert.equal(counts.starvation_warning, true);
  assert.equal(counts.starvation_response, 'serialize_merges_not_more_syncs');
});

test('a discretionary sync is counted and violates the zero budget', () => {
  const counts = classifyBaseSyncCounts([sync(1, { reason: 'base_advanced', phase: 'pre_convergence' })], { policy });
  assert.equal(counts.compliant, false);
  assert.equal(counts.discretionary_sync_count, 1);
  assert.equal(counts.pre_convergence_discretionary_sync_count, 1);
  assert.ok(counts.violations.some((violation) => violation.code === 'reason_rejected'));
  assert.ok(counts.violations.some((violation) => violation.code === 'discretionary_budget_exceeded'));
  assert.ok(counts.violations.some((violation) => violation.code === 'pre_convergence_discretionary_budget_exceeded'));
});

test('an excepted pre-convergence sync (real conflict) is reported but not a violation', () => {
  const counts = classifyBaseSyncCounts([sync(1, { reason: 'real_conflict', phase: 'pre_convergence', merge_state_status_before: 'DIRTY' })], { policy });
  assert.equal(counts.compliant, true);
  assert.equal(counts.pre_convergence_sync_count, 1);
  assert.equal(counts.pre_convergence_discretionary_sync_count, 0);
});

test('github update-branch is attributed, not laundered', () => {
  const counts = classifyBaseSyncCounts([sync(1, { reason: 'keep_branch_current', initiated_by: 'github_update_branch', initiator_identity: 'web-flow', phase: 'pre_convergence' })], { policy });
  assert.equal(counts.compliant, false);
  assert.equal(counts.discretionary_sync_count, 1);
});

test('agent-asserted ledger is rejected', () => {
  assert.throws(() => classifyBaseSyncCounts([sync(1)], { policy, ledgerSource: 'agent_self_report' }),
    (error) => error instanceof BaseSyncPolicyError && error.code === 'self_attested_ledger_forbidden');
});

test('sync records must use the GitHub commit timestamp and be sequential', () => {
  assert.throws(() => classifyBaseSyncCounts([sync(1, { timestamp_source: 'agent_clock' })], { policy }),
    (error) => error.code === 'ledger_invalid');
  assert.throws(() => classifyBaseSyncCounts([sync(2)], { policy }), (error) => error.code === 'ledger_invalid');
});

test('weakened policies fail closed', () => {
  const loosened = structuredClone(policy);
  loosened.budgets.ordinary_pr.discretionary_sync_count_max = 1;
  assert.throws(() => validateBaseSyncPolicy(loosened), (error) => error.code === 'policy_invalid');
  const defaulted = structuredClone(policy);
  defaulted.decision.default = 'allowed';
  assert.throws(() => validateBaseSyncPolicy(defaulted), (error) => error.code === 'policy_invalid');
  const selfAttested = structuredClone(policy);
  selfAttested.ledger.source = 'agent';
  assert.throws(() => validateBaseSyncPolicy(selfAttested), (error) => error.code === 'policy_invalid');
  const extraReason = structuredClone(policy);
  extraReason.decision.allowed_reasons.push('base_advanced');
  assert.throws(() => validateBaseSyncPolicy(extraReason), (error) => error.code === 'policy_invalid');
});
