// Local ↔ CI parity — compares a local verification-outcome/v1 against the check runs GitHub
// recorded for the SAME head, target by target, through the plan's ci_job binding.
//
// Authority: advisory_only, by construction and by assertion. A parity record is evidence that
// the local preflight agrees with CI; it is never a substitute for CI and never a gate input.
// One false_negative (local passed, CI failed) is disqualifying for the local tier that
// produced it: it means the local gate would have let a bad change through.

import { hashJson } from './verification-outcome.mjs';

export const CI_LOCAL_PARITY_VERSION = 'ci-local-parity/v1';
export const DIVERGENCE_KINDS = Object.freeze(['agree', 'false_negative', 'false_positive', 'ci_missing', 'ci_skipped', 'local_missing', 'local_incomplete']);
// Only these three kinds represent an actual local-vs-CI comparison; the rest mean one side
// produced nothing and therefore prove nothing about parity.
export const COMPARABLE_KINDS = Object.freeze(['agree', 'false_negative', 'false_positive']);

const COMMIT = /^[0-9a-f]{40}$/u;
const PASS_RESULTS = new Set(['passed']);
const FAIL_RESULTS = new Set(['failed']);

export class CiLocalParityError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'CiLocalParityError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new CiLocalParityError(code, message);
}

function localResultForTarget(outcome, targetId) {
  const gates = (outcome.gates ?? []).filter((gate) => gate.target_id === targetId);
  if (gates.length === 0) return 'missing';
  if (gates.some((gate) => FAIL_RESULTS.has(gate.result))) return 'failed';
  if (gates.every((gate) => PASS_RESULTS.has(gate.result) || gate.result === 'not_configured')) return 'passed';
  return 'incomplete';
}

function ciResultForJob(checkRuns, jobName, expectedAppId) {
  // Required checks are bound to name AND app_id; another installed App publishing a same-name
  // check must never be mistaken for the Actions run that branch protection requires.
  const candidates = checkRuns.filter((run) => run.name === jobName
    && (expectedAppId === null || run.app_id === undefined || run.app_id === expectedAppId));
  if (candidates.length === 0) return 'missing';
  // Prefer a non-skipped conclusion when a rerun exists; skipped means CI did not verify this head.
  const decisive = candidates.find((run) => run.conclusion && run.conclusion !== 'skipped');
  if (decisive) return decisive.conclusion;
  return candidates.some((run) => run.conclusion === 'skipped') ? 'skipped' : (candidates[0].conclusion ?? 'pending');
}

function classify(localResult, ciResult, required) {
  if (localResult === 'missing') return 'local_missing';
  if (ciResult === 'missing') return 'ci_missing';
  if (ciResult === 'skipped') return required ? 'ci_skipped' : 'agree';
  if (localResult === 'incomplete') return 'local_incomplete';
  const ciPassed = ciResult === 'success';
  const ciFailed = ['failure', 'timed_out', 'cancelled', 'action_required', 'startup_failure'].includes(ciResult);
  if (localResult === 'passed' && ciPassed) return 'agree';
  if (localResult === 'failed' && ciFailed) return 'agree';
  if (localResult === 'passed' && ciFailed) return 'false_negative';
  if (localResult === 'failed' && ciPassed) return 'false_positive';
  return 'ci_missing';
}

export function compareParity({ outcome, plan, checkRuns, tier = null, expectedAppId = null }) {
  if (outcome?.schema_version !== 'verification-outcome/v1') fail('outcome_invalid', 'outcome must be a verification-outcome/v1 document.');
  if (plan?.schema_version !== 'verification-plan/v2' || !Array.isArray(plan.targets)) fail('plan_invalid', 'plan must be a verification-plan/v2 document.');
  if (!Array.isArray(checkRuns)) fail('check_runs_invalid', 'checkRuns must be an array.');
  if (!COMMIT.test(outcome.subject_sha ?? '')) fail('outcome_invalid', 'outcome.subject_sha must be a lowercase full commit id.');
  if (plan.subject_sha !== outcome.subject_sha) fail('head_mismatch', 'plan and outcome are bound to different heads.');
  if (expectedAppId !== null && !Number.isSafeInteger(expectedAppId)) fail('check_runs_invalid', 'expectedAppId must be an integer when supplied.');
  for (const [index, run] of checkRuns.entries()) {
    if (typeof run?.name !== 'string') fail('check_runs_invalid', `checkRuns[${index}].name is required.`);
    if (run.head_sha !== undefined && run.head_sha !== outcome.subject_sha) fail('head_mismatch', `checkRuns[${index}] is bound to a different head.`);
  }
  if (tier !== null) fail('tiered_outcome_not_parity_evidence', 'A tiered local run executes a subset of the plan and cannot be compared for parity.');
  // The outcome carries plan_sha256 precisely to bind its gate set; a same-head but different
  // plan would compare CI against targets the local run never planned, or omit ones it did.
  // hashJson is the same digest the runner used when it wrote the outcome.
  if (typeof outcome.plan_sha256 !== 'string' || outcome.plan_sha256 !== hashJson(plan)) {
    fail('plan_binding_invalid', 'outcome.plan_sha256 does not bind this plan.');
  }
  for (const field of ['base_sha', 'dispatch']) {
    if (outcome[field] !== undefined && plan[field] !== undefined && outcome[field] !== plan[field]) {
      fail('plan_binding_invalid', `outcome.${field} disagrees with the plan.`);
    }
  }

  const records = [];
  for (const target of plan.targets) {
    if (!target.required) continue;
    const localResult = localResultForTarget(outcome, target.id);
    const ciResult = ciResultForJob(checkRuns, target.ci_job, expectedAppId);
    const divergence = classify(localResult, ciResult, target.required);
    records.push({ target_id: target.id, ci_job: target.ci_job, local_result: localResult, ci_result: ciResult, divergence });
  }
  const summary = Object.fromEntries(DIVERGENCE_KINDS.map((kind) => [kind, records.filter((record) => record.divergence === kind).length]));
  return Object.freeze({
    schema_version: CI_LOCAL_PARITY_VERSION,
    authority: 'advisory_only',
    head_sha: outcome.subject_sha,
    base_sha: plan.base_sha ?? null,
    manifest_sha256: outcome.manifest_sha256 ?? null,
    records: Object.freeze(records),
    summary,
    disqualifying: summary.false_negative > 0,
    disqualifying_reason: summary.false_negative > 0 ? 'local_passed_where_ci_failed' : null,
  });
}

export function assertAdvisoryOnly(record) {
  if (record?.authority !== 'advisory_only' || record?.schema_version !== CI_LOCAL_PARITY_VERSION) {
    fail('authority_invalid', 'A parity record is advisory_only and can never be wired into a gate.');
  }
  return record;
}

// Sufficiency across many PRs: parity evidence supports a migration phase only when there are
// enough heads, zero false negatives, and every required target was observed at least once.
export function summarizeParityCorpus(records, { minimumHeads = 5, requiredTargets = null } = {}) {
  if (!Array.isArray(records)) fail('corpus_invalid', 'records must be an array.');
  records.forEach((record) => assertAdvisoryOnly(record));
  const heads = new Set(records.map((record) => record.head_sha));
  const falseNegatives = records.reduce((sum, record) => sum + record.summary.false_negative, 0);
  const falsePositives = records.reduce((sum, record) => sum + record.summary.false_positive, 0);
  const incomplete = records.reduce((sum, record) => sum
    + record.summary.ci_missing + record.summary.ci_skipped + record.summary.local_missing + record.summary.local_incomplete, 0);
  // Only comparable entries count as observation: a target whose CI check was missing or skipped
  // proves nothing, so it must not make a migration phase look covered.
  const comparedEntries = records.flatMap((record) => record.records.filter((entry) => COMPARABLE_KINDS.includes(entry.divergence)));
  const targetsObserved = new Set(comparedEntries.map((entry) => entry.target_id));
  const missingTargets = requiredTargets === null ? [] : [...requiredTargets].filter((id) => !targetsObserved.has(id)).sort();
  const insufficient = [
    ...(heads.size < minimumHeads ? [`fewer_than_${minimumHeads}_heads`] : []),
    ...(falseNegatives > 0 ? ['false_negative_observed'] : []),
    ...(incomplete > 0 ? ['incomplete_divergence_observed'] : []),
    ...(comparedEntries.length === 0 ? ['no_comparable_observation'] : []),
    ...(missingTargets.length > 0 ? ['required_target_never_compared'] : []),
  ];
  return Object.freeze({
    heads: heads.size,
    false_negatives: falseNegatives,
    false_positives: falsePositives,
    incomplete_divergences: incomplete,
    compared_entries: comparedEntries.length,
    targets_observed: Object.freeze([...targetsObserved].sort()),
    required_targets_missing: Object.freeze(missingTargets),
    sufficient: insufficient.length === 0,
    insufficient_reasons: Object.freeze(insufficient),
  });
}
