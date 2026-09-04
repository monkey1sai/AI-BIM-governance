import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createVerificationPlan } from '../lib/verification-plan.mjs';
import { TIERS, VerificationTierError, selectTierGates, validateTierPolicy } from '../lib/verification-tiers.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const policy = JSON.parse(readFileSync(path.join(root, 'scripts', 'verification-tier-policy.json'), 'utf8'));
const manifest = JSON.parse(readFileSync(path.join(root, 'scripts', 'verification-manifest.json'), 'utf8'));

test('the committed tier policy validates and is monotonic quick ⊆ pr ⊆ full', () => {
  const validated = validateTierPolicy(policy);
  assert.deepEqual(TIERS, ['quick', 'pr', 'full']);
  assert.deepEqual(validated.tiers.quick.evidence_classes, ['fast']);
  assert.deepEqual(validated.tiers.full.evidence_classes.sort(), ['contract', 'fast', 'security', 'slow']);
  assert.equal(validated.authority, 'local_selection_only');
  assert.equal(validated.tiered_run_is_evidence, false);
});

test('quick tier over a governance-service change keeps fast gates and drops contract/security gates', () => {
  const plan = createVerificationPlan(manifest, { changedPaths: ['governance-service/app.py'] });
  const selection = selectTierGates(plan, 'quick', policy);
  assert.equal(selection.effective_tier, 'quick');
  assert.equal(selection.forced_full, false);
  assert.ok(selection.deselected.some((entry) => entry.evidence_class === 'contract'), 'contract gates are deselected at quick');
  assert.ok(selection.deselected.some((entry) => entry.evidence_class === 'security'), 'security gates are deselected at quick');
  assert.ok(selection.selected.every((entry) => entry.evidence_class === 'fast' || entry.reason === 'evidence_class_unknown_run_anyway'));
  assert.equal(selection.is_evidence, false);
});

test('pr tier adds contract gates; full tier deselects nothing', () => {
  const plan = createVerificationPlan(manifest, { changedPaths: ['governance-service/app.py'] });
  const pr = selectTierGates(plan, 'pr', policy);
  assert.ok(pr.selected.some((entry) => entry.evidence_class === 'contract'));
  assert.ok(pr.deselected.every((entry) => entry.evidence_class === 'slow' || entry.evidence_class === 'security'));
  const full = selectTierGates(plan, 'full', policy);
  assert.deepEqual([...full.deselected], []);
});

test('a self-change of the verification mechanism forces the full tier (governance/CI/bootstrap never get a reduced run)', () => {
  const plan = createVerificationPlan(manifest, { changedPaths: ['.github/workflows/ci.yml'] });
  assert.equal(plan.dispatch, 'full');
  const selection = selectTierGates(plan, 'quick', policy);
  assert.equal(selection.effective_tier, 'full');
  assert.equal(selection.forced_full, true);
  assert.equal(selection.forced_full_reason, 'plan_dispatch_full_self_change');
  assert.deepEqual([...selection.deselected], []);
});

test('a viewer-only change never selects deploy or bootstrap gates at any tier (Case 1)', () => {
  const plan = createVerificationPlan(manifest, { changedPaths: ['web-viewer-sample/src/console/Panel.tsx'] });
  assert.equal(plan.dispatch, 'affected');
  for (const tier of TIERS) {
    const selection = selectTierGates(plan, tier, policy);
    const targets = new Set([...selection.selected, ...selection.deselected].map((entry) => entry.target_id));
    assert.equal(targets.has('rebuild-test-deploy'), false, `${tier}: no deploy target`);
    assert.equal(targets.has('compose-config'), false, `${tier}: no compose target`);
    assert.equal(targets.has('coordinator'), false, `${tier}: no coordinator target`);
  }
});

test('weakened policies fail closed', () => {
  const nonMonotonic = structuredClone(policy);
  nonMonotonic.tiers.pr.evidence_classes = ['contract'];
  assert.throws(() => validateTierPolicy(nonMonotonic), (error) => error instanceof VerificationTierError && error.code === 'tier_policy_invalid');
  const evidence = structuredClone(policy);
  evidence.tiered_run_is_evidence = true;
  assert.throws(() => validateTierPolicy(evidence), (error) => error.code === 'tier_policy_invalid');
  const noForce = structuredClone(policy);
  noForce.full_when_dispatch_full = false;
  assert.throws(() => validateTierPolicy(noForce), (error) => error.code === 'tier_policy_invalid');
  assert.throws(() => selectTierGates({ targets: [] }, 'turbo', policy), (error) => error.code === 'tier_invalid');
});
