// Base-sync policy evaluator.
//
// Governs whether an agent MAY merge/rebase origin/main into a PR branch while the PR is
// converging. "main advanced" is never a reason; the reason enum is closed so a routine
// freshness sync has no legal value to record. Overlap and correctness questions are routed
// through the existing verification-manifest classifier (createVerificationPlan) rather than
// a second path taxonomy. Counts are derived from server truth by the caller; this module
// never calls git or GitHub.
//
// Authority: advisory_detective. Nothing here gates a merge.

import { createVerificationPlan, VerificationPlanError } from './verification-plan.mjs';

export const BASE_SYNC_POLICY_VERSION = 'base-sync-policy/v1';
export const BASE_SYNC_DECISION_VERSION = 'base-sync-decision/v1';
export const BASE_SYNC_LEDGER_VERSION = 'base-sync-ledger/v1';

export const SYNC_REASONS = Object.freeze(['real_conflict', 'semantic_overlap', 'protection_forced', 'base_affects_correctness']);
export const SYNC_PHASES = Object.freeze(['pre_convergence', 'post_convergence']);
export const SYNC_INITIATORS = Object.freeze(['agent', 'github_update_branch', 'human']);
export const LOOP_STATES = Object.freeze(['continue', 'held', 'complete']);

const COMMIT = /^[0-9a-f]{40}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;

export class BaseSyncPolicyError extends Error {
  constructor(code, field, message) {
    super(message);
    this.name = 'BaseSyncPolicyError';
    this.code = code;
    this.field = field;
  }
}

function fail(code, field, message) {
  throw new BaseSyncPolicyError(code, field, message);
}

function exactKeys(value, keys, field) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail('shape_invalid', field, `${field} must be an object.`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail('shape_invalid', field, `${field} must have exactly the keys ${expected.join(', ')}.`);
  }
}

function assertStringArray(value, field, { allowEmpty = true } = {}) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || item.length === 0)) {
    fail('shape_invalid', field, `${field} must be an array of non-empty strings.`);
  }
  if (!allowEmpty && value.length === 0) fail('shape_invalid', field, `${field} must not be empty.`);
}

// Minimal glob matcher for the policy's additional_paths: `**` spans segments, `*` stays in one.
function globToRegExp(glob) {
  let pattern = '';
  for (let index = 0; index < glob.length; index += 1) {
    const char = glob[index];
    if (char === '*') {
      if (glob[index + 1] === '*') {
        pattern += '.*';
        index += 1;
        if (glob[index + 1] === '/') index += 1;
      } else {
        pattern += '[^/]*';
      }
    } else if ('\\^$+?.()|{}[]'.includes(char)) {
      pattern += `\\${char}`;
    } else {
      pattern += char;
    }
  }
  return new RegExp(`^${pattern}$`, 'u');
}

function matchesAnyGlob(filePath, globs) {
  return globs.some((glob) => globToRegExp(glob).test(filePath));
}

export function validateBaseSyncPolicy(candidate) {
  const policy = JSON.parse(JSON.stringify(candidate));
  exactKeys(policy, ['$schema', 'schema_version', 'authority', 'purpose', 'decision', 'budgets', 'ledger', 'starvation', 'amended_doctrine', 'adjacent_not_equivalent'], 'policy');
  if (policy.schema_version !== BASE_SYNC_POLICY_VERSION) fail('policy_invalid', 'schema_version', 'Unsupported base-sync policy schema version.');
  if (policy.authority !== 'advisory_detective') fail('policy_invalid', 'authority', 'Base-sync policy must remain advisory_detective.');
  const { decision } = policy;
  exactKeys(decision, ['default', 'allowed_reasons', 'rejected_reasons', 'real_conflict', 'semantic_overlap', 'protection_forced', 'base_affects_correctness'], 'policy.decision');
  if (decision.default !== 'forbidden') fail('policy_invalid', 'decision.default', 'Base sync must be forbidden by default.');
  assertStringArray(decision.allowed_reasons, 'decision.allowed_reasons', { allowEmpty: false });
  const allowed = [...decision.allowed_reasons].sort();
  if (allowed.length !== SYNC_REASONS.length || allowed.some((reason, index) => reason !== [...SYNC_REASONS].sort()[index])) {
    fail('policy_invalid', 'decision.allowed_reasons', 'The allowed reason enum must be exactly the four closed exceptions.');
  }
  assertStringArray(decision.rejected_reasons, 'decision.rejected_reasons', { allowEmpty: false });
  if (!decision.rejected_reasons.includes('base_advanced')) fail('policy_invalid', 'decision.rejected_reasons', 'base_advanced must be an explicitly rejected reason.');
  if (decision.rejected_reasons.some((reason) => SYNC_REASONS.includes(reason))) fail('policy_invalid', 'decision.rejected_reasons', 'A rejected reason cannot also be allowed.');
  if (decision.semantic_overlap.classifier_path !== 'scripts/verification-manifest.json') {
    fail('policy_invalid', 'decision.semantic_overlap.classifier_path', 'Semantic overlap must be decided by the verification manifest classifier.');
  }
  assertStringArray(decision.semantic_overlap.boundary_globs, 'decision.semantic_overlap.boundary_globs', { allowEmpty: false });
  assertStringArray(decision.semantic_overlap.ubiquitous_path_classes, 'decision.semantic_overlap.ubiquitous_path_classes', { allowEmpty: false });
  assertStringArray(decision.base_affects_correctness.additional_paths, 'decision.base_affects_correctness.additional_paths', { allowEmpty: false });
  const budget = policy.budgets?.ordinary_pr;
  exactKeys(budget, ['pre_convergence_discretionary_sync_count_max', 'discretionary_sync_count_max', 'final_sync_count_max', 'protection_forced_sync_count_max'], 'policy.budgets.ordinary_pr');
  if (budget.pre_convergence_discretionary_sync_count_max !== 0 || budget.discretionary_sync_count_max !== 0 || budget.final_sync_count_max !== 1 || budget.protection_forced_sync_count_max !== null) {
    fail('policy_invalid', 'budgets.ordinary_pr', 'Ordinary PR budgets must be {0, 0, 1, unbounded}.');
  }
  if (policy.ledger.source !== 'github_server_truth' || policy.ledger.self_attested_forbidden !== true) {
    fail('policy_invalid', 'ledger', 'The sync ledger must be derived from GitHub server truth and never self-attested.');
  }
  if (!Number.isInteger(policy.starvation.consecutive_protection_forced_warning) || policy.starvation.consecutive_protection_forced_warning < 2) {
    fail('policy_invalid', 'starvation', 'Starvation warning threshold must be an integer >= 2.');
  }
  return policy;
}

// Reason enum is closed: an agent syncing because main moved has no legal value to write.
export function assertSyncReason(reason, policy) {
  if (policy.decision.rejected_reasons.includes(reason)) {
    fail('reason_rejected', 'reason', `"${reason}" is explicitly rejected: main advancing is never a reason to sync.`);
  }
  if (!SYNC_REASONS.includes(reason)) fail('reason_not_allowed', 'reason', `"${reason}" is not in the closed sync reason enum.`);
  return reason;
}

const DECISION_INPUT_KEYS = [
  'schema_version', 'pr_number', 'repository', 'loop_state', 'converged', 'at_merge_sink',
  'merge_state_status', 'mergeable', 'base_sha_current', 'base_sha_at_branch', 'head_sha',
  'pr_changed_paths', 'base_advance_changed_paths', 'verification_manifest_sha256',
];

export function validateDecisionInput(candidate) {
  const input = JSON.parse(JSON.stringify(candidate));
  exactKeys(input, DECISION_INPUT_KEYS, 'input');
  if (input.schema_version !== BASE_SYNC_DECISION_VERSION) fail('input_invalid', 'schema_version', 'Unsupported decision input schema version.');
  if (!Number.isSafeInteger(input.pr_number) || input.pr_number < 1) fail('input_invalid', 'pr_number', 'pr_number must be a positive integer.');
  if (!REPOSITORY.test(input.repository)) fail('input_invalid', 'repository', 'repository must be owner/name.');
  if (!LOOP_STATES.includes(input.loop_state)) fail('input_invalid', 'loop_state', 'loop_state must be continue, held, or complete.');
  if (typeof input.converged !== 'boolean' || typeof input.at_merge_sink !== 'boolean') fail('input_invalid', 'booleans', 'converged and at_merge_sink must be booleans.');
  if (typeof input.merge_state_status !== 'string' || typeof input.mergeable !== 'string') fail('input_invalid', 'merge_state', 'merge_state_status and mergeable must be strings from GitHub.');
  for (const field of ['base_sha_current', 'base_sha_at_branch', 'head_sha']) {
    if (!COMMIT.test(input[field])) fail('input_invalid', field, `${field} must be a lowercase full commit id.`);
  }
  assertStringArray(input.pr_changed_paths, 'pr_changed_paths');
  assertStringArray(input.base_advance_changed_paths, 'base_advance_changed_paths');
  if (!SHA256.test(input.verification_manifest_sha256)) fail('input_invalid', 'verification_manifest_sha256', 'verification_manifest_sha256 must be a sha256 hex digest.');
  return input;
}

function planTargets(manifest, changedPaths) {
  if (changedPaths.length === 0) return { targets: new Set(), dispatch: 'none', planned: true, unknown: [] };
  try {
    const plan = createVerificationPlan(manifest, { changedPaths });
    const targets = new Set(plan.targets.filter((target) => target.required).map((target) => target.id));
    return { targets, dispatch: plan.dispatch, planned: plan.result === 'planned', unknown: [...(plan.unknown_paths ?? [])] };
  } catch (error) {
    if (error instanceof VerificationPlanError) return { targets: new Set(), dispatch: 'none', planned: false, unknown: [...changedPaths], error: error.code };
    throw error;
  }
}

// MAY_SYNC := E1 real_conflict ∨ E2 semantic_overlap ∨ E3 protection_forced ∨ E4 base_affects_correctness.
// Default false. Every input field is server- or git-derived; nothing is agent-asserted.
export function evaluateBaseSync(candidateInput, { policy: candidatePolicy, manifest }) {
  const policy = validateBaseSyncPolicy(candidatePolicy);
  const input = validateDecisionInput(candidateInput);
  if (!manifest || typeof manifest !== 'object') fail('input_invalid', 'manifest', 'A verification manifest document is required.');
  const violations = [];
  const P = new Set(input.pr_changed_paths);
  const B = new Set(input.base_advance_changed_paths);
  const baseAdvanced = input.base_sha_current !== input.base_sha_at_branch;

  // E1 — server-reported conflict. BEHIND is explicitly not a conflict.
  const e1 = policy.decision.real_conflict.mergeable_values.includes(input.mergeable)
    || policy.decision.real_conflict.merge_state_status_values.includes(input.merge_state_status);

  // E2 — overlap through the manifest classifier, never agent judgement. Targets that fire for
  // (nearly) every path carry no overlap signal and are excluded; a shared target only counts
  // when the base advance also crossed a contract-authority boundary declared in the policy.
  const direct = [...P].filter((filePath) => B.has(filePath)).sort();
  const pPlan = planTargets(manifest, [...P]);
  const bPlan = planTargets(manifest, [...B]);
  const ubiquitousClasses = new Set(policy.decision.semantic_overlap.ubiquitous_path_classes);
  const ubiquitousTargets = new Set((manifest.targets ?? [])
    .filter((target) => Array.isArray(target.required_when?.any_of) && target.required_when.any_of.every((id) => ubiquitousClasses.has(id)))
    .map((target) => target.id));
  const sharedTargets = [...pPlan.targets].filter((id) => bPlan.targets.has(id) && !ubiquitousTargets.has(id)).sort();
  const boundaryPaths = [...B].filter((filePath) => matchesAnyGlob(filePath, policy.decision.semantic_overlap.boundary_globs)).sort();
  const boundaryCrossing = bPlan.dispatch === 'full' || boundaryPaths.length > 0;
  const unknownBase = B.size > 0 && !bPlan.planned;
  const e2 = direct.length > 0 || (sharedTargets.length > 0 && boundaryCrossing) || unknownBase;

  // E4 — the base advance touched a correctness/governance surface.
  const fullDispatchGlobs = Array.isArray(manifest.full_dispatch_globs) ? manifest.full_dispatch_globs : [];
  const securityRegistry = manifest.security_policy?.exception_registry;
  const correctnessPaths = [...policy.decision.base_affects_correctness.additional_paths];
  if (typeof securityRegistry === 'string') correctnessPaths.push(securityRegistry);
  const correctnessHits = [...B].filter((filePath) => matchesAnyGlob(filePath, fullDispatchGlobs) || matchesAnyGlob(filePath, correctnessPaths)).sort();
  const e4 = correctnessHits.length > 0 || bPlan.dispatch === 'full';

  // E3 — the only exception that may legitimately repeat, and only at the merge sink.
  const behind = input.merge_state_status === policy.decision.protection_forced.merge_state_status;
  const e3Requested = input.at_merge_sink && behind;
  let e3 = false;
  if (e3Requested) {
    if (!input.converged || input.loop_state !== 'complete') violations.push('merge_sink_unreachable_pre_convergence');
    else e3 = true;
  }

  const reasons = [];
  if (e1) reasons.push('real_conflict');
  if (e2) reasons.push('semantic_overlap');
  if (e4) reasons.push('base_affects_correctness');
  if (e3) reasons.push('protection_forced');
  const maySync = reasons.length > 0;
  const reason = maySync ? reasons[0] : null;
  if (!maySync && baseAdvanced && behind) violations.push('base_advanced_is_not_a_reason');

  return {
    schema_version: BASE_SYNC_DECISION_VERSION,
    pr_number: input.pr_number,
    repository: input.repository,
    head_sha: input.head_sha,
    base_sha_current: input.base_sha_current,
    may_sync: maySync,
    reason,
    reasons,
    phase: input.converged ? 'post_convergence' : 'pre_convergence',
    counts_toward: maySync ? (reason === 'protection_forced' ? 'protection_forced' : 'excepted') : 'discretionary',
    violations,
    evidence: {
      base_advanced: baseAdvanced,
      merge_state_status: input.merge_state_status,
      mergeable: input.mergeable,
      direct_overlap_paths: direct,
      shared_target_ids: sharedTargets,
      boundary_crossing: boundaryCrossing,
      boundary_paths: boundaryPaths,
      unknown_base_paths: unknownBase ? bPlan.unknown : [],
      correctness_paths: correctnessHits,
      base_advance_dispatch: bPlan.dispatch,
      verification_manifest_sha256: input.verification_manifest_sha256,
    },
  };
}

const SYNC_RECORD_KEYS = [
  'index', 'timestamp', 'timestamp_source', 'reason', 'phase', 'initiated_by', 'initiator_identity',
  'base_sha_before', 'base_sha_after', 'head_sha_before', 'head_sha_after', 'merge_state_status_before',
];

export function validateSyncRecord(candidate, label = 'sync') {
  const record = JSON.parse(JSON.stringify(candidate));
  exactKeys(record, SYNC_RECORD_KEYS, label);
  if (!Number.isSafeInteger(record.index) || record.index < 1) fail('ledger_invalid', `${label}.index`, 'index must be a positive integer.');
  if (typeof record.timestamp !== 'string' || Number.isNaN(Date.parse(record.timestamp))) fail('ledger_invalid', `${label}.timestamp`, 'timestamp must be an ISO date.');
  if (record.timestamp_source !== 'github_commit_committer_date') fail('ledger_invalid', `${label}.timestamp_source`, 'timestamps must come from the GitHub commit, never an agent clock.');
  if (typeof record.reason !== 'string') fail('ledger_invalid', `${label}.reason`, 'reason must be a string.');
  if (!SYNC_PHASES.includes(record.phase)) fail('ledger_invalid', `${label}.phase`, 'phase must be pre_convergence or post_convergence.');
  if (!SYNC_INITIATORS.includes(record.initiated_by)) fail('ledger_invalid', `${label}.initiated_by`, 'initiated_by must be agent, github_update_branch, or human.');
  if (typeof record.initiator_identity !== 'string' || record.initiator_identity.length === 0) fail('ledger_invalid', `${label}.initiator_identity`, 'initiator_identity is required.');
  for (const field of ['base_sha_before', 'base_sha_after', 'head_sha_before', 'head_sha_after']) {
    if (!COMMIT.test(record[field])) fail('ledger_invalid', `${label}.${field}`, `${field} must be a lowercase full commit id.`);
  }
  if (typeof record.merge_state_status_before !== 'string') fail('ledger_invalid', `${label}.merge_state_status_before`, 'merge_state_status_before must be a string.');
  return record;
}

// Honest accounting: the governed number is discretionary_sync_count (syncs with no valid reason).
// protection_forced syncs are reported but never violations, because main advancing between the
// final sync and the merge is a race the agent cannot win.
export function classifyBaseSyncCounts(candidateSyncs, { policy: candidatePolicy, ledgerSource = 'github_server_truth' }) {
  const policy = validateBaseSyncPolicy(candidatePolicy);
  if (ledgerSource !== policy.ledger.source) fail('self_attested_ledger_forbidden', 'ledger.source', 'A sync ledger must be derived from GitHub server truth, never self-attested.');
  if (!Array.isArray(candidateSyncs)) fail('ledger_invalid', 'syncs', 'syncs must be an array.');
  const syncs = candidateSyncs.map((record, index) => validateSyncRecord(record, `syncs[${index}]`));
  syncs.forEach((record, index) => {
    if (record.index !== index + 1) fail('ledger_invalid', `syncs[${index}].index`, 'sync records must be sequential and one-based.');
  });
  const budget = policy.budgets.ordinary_pr;
  const violations = [];
  let preConvergence = 0;
  let preConvergenceDiscretionary = 0;
  let finalCount = 0;
  let protectionForced = 0;
  let discretionary = 0;
  let consecutiveForced = 0;
  let maxConsecutiveForced = 0;
  for (const record of syncs) {
    const valid = SYNC_REASONS.includes(record.reason);
    const forced = record.reason === 'protection_forced';
    if (record.phase === 'pre_convergence') preConvergence += 1;
    else finalCount += 1;
    if (forced) {
      protectionForced += 1;
      consecutiveForced += 1;
      maxConsecutiveForced = Math.max(maxConsecutiveForced, consecutiveForced);
      if (record.phase === 'pre_convergence') violations.push({ index: record.index, code: 'protection_forced_before_convergence' });
    } else {
      consecutiveForced = 0;
    }
    if (!valid) {
      discretionary += 1;
      if (record.phase === 'pre_convergence') preConvergenceDiscretionary += 1;
      violations.push({ index: record.index, code: policy.decision.rejected_reasons.includes(record.reason) ? 'reason_rejected' : 'reason_not_allowed', reason: record.reason });
    }
  }
  if (discretionary > budget.discretionary_sync_count_max) violations.push({ index: null, code: 'discretionary_budget_exceeded', observed: discretionary });
  if (preConvergenceDiscretionary > budget.pre_convergence_discretionary_sync_count_max) {
    violations.push({ index: null, code: 'pre_convergence_discretionary_budget_exceeded', observed: preConvergenceDiscretionary });
  }
  const finalNotForced = syncs.filter((record) => record.phase === 'post_convergence' && record.reason !== 'protection_forced').length;
  if (finalNotForced > budget.final_sync_count_max) violations.push({ index: null, code: 'final_budget_exceeded_without_protection_forced_justification', observed: finalNotForced });
  const starvationWarning = maxConsecutiveForced >= policy.starvation.consecutive_protection_forced_warning;
  return {
    schema_version: BASE_SYNC_LEDGER_VERSION,
    base_sync_count_per_pr: syncs.length,
    pre_convergence_sync_count: preConvergence,
    pre_convergence_discretionary_sync_count: preConvergenceDiscretionary,
    final_sync_count: finalCount,
    protection_forced_sync_count: protectionForced,
    discretionary_sync_count: discretionary,
    compliant: violations.length === 0,
    violations,
    starvation_warning: starvationWarning,
    starvation_response: starvationWarning ? policy.starvation.response : null,
  };
}
