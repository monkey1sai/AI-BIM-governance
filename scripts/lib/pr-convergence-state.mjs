// PR Convergence Agent — a thin, derivational state layer over the repo's two existing
// convergence machines. It persists nothing and introduces no second budget:
//
//   advanceReviewLoop            (risk-proportional-review.mjs)          -> continue | held | complete
//   validateFindingDispositionBundle (autonomous-delivery-finalization.mjs) -> escalated | held | passed
//
// The eight named states are a projection of those observations plus server-observed thread and
// finding facts. Owner ruling D-6(a): bind to the real machines, do not invent a new contract.
// Only CONVERGED permits the single final base sync (see scripts/base-sync-policy.json); every
// other state permits a sync only through the E1/E2/E4 exceptions evaluated elsewhere.

export const CONVERGENCE_STATE_VERSION = 'pr-convergence-state/v1';
export const CONVERGENCE_STATES = Object.freeze([
  'REVIEW_PENDING', 'DISPOSITION', 'FIXING', 'VERIFYING', 'RE_REVIEW', 'CONVERGED', 'HELD', 'ESCALATED',
]);
export const TERMINAL_STATES = Object.freeze(['CONVERGED', 'HELD', 'ESCALATED']);
export const MAX_ROUNDS = 2;

// Legal transitions. HELD and ESCALATED are terminal for a convergence run: leaving them requires
// a human decision and a NEW run, never an automatic retry.
export const TRANSITIONS = Object.freeze({
  REVIEW_PENDING: Object.freeze(['DISPOSITION', 'HELD', 'ESCALATED']),
  DISPOSITION: Object.freeze(['FIXING', 'VERIFYING', 'CONVERGED', 'HELD', 'ESCALATED']),
  FIXING: Object.freeze(['VERIFYING', 'HELD', 'ESCALATED']),
  VERIFYING: Object.freeze(['RE_REVIEW', 'CONVERGED', 'HELD', 'ESCALATED']),
  RE_REVIEW: Object.freeze(['DISPOSITION', 'CONVERGED', 'HELD', 'ESCALATED']),
  CONVERGED: Object.freeze([]),
  HELD: Object.freeze([]),
  ESCALATED: Object.freeze([]),
});

const LOOP_STATES = new Set(['continue', 'held', 'complete']);
const BUNDLE_STATUSES = new Set(['escalated', 'held', 'passed']);

export class PrConvergenceStateError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'PrConvergenceStateError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new PrConvergenceStateError(code, message);
}

function nonNegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) fail('observation_invalid', `${label} must be a non-negative integer.`);
  return value;
}

// Observations are all machine- or server-derived. Nothing here is an agent's opinion.
export function validateObservation(candidate) {
  if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) fail('observation_invalid', 'observation must be an object.');
  const {
    loop, bundle_status: bundleStatus = null, threads, findings, verifying = false, disposition_pending: dispositionPending = false,
  } = candidate;
  if (loop === null || typeof loop !== 'object') fail('observation_invalid', 'loop (advanceReviewLoop output) is required.');
  if (!LOOP_STATES.has(loop.state)) fail('observation_invalid', 'loop.state must be continue, held, or complete.');
  nonNegativeInteger(loop.attempts_used, 'loop.attempts_used');
  if (loop.attempts_used > MAX_ROUNDS) fail('observation_invalid', `loop.attempts_used exceeds the bounded budget of ${MAX_ROUNDS}.`);
  if (bundleStatus !== null && !BUNDLE_STATUSES.has(bundleStatus)) fail('observation_invalid', 'bundle_status must be null, escalated, held, or passed.');
  if (threads === null || typeof threads !== 'object' || typeof threads.complete !== 'boolean') fail('observation_invalid', 'threads.complete must be a server-observed boolean.');
  nonNegativeInteger(threads.unresolved, 'threads.unresolved');
  if (findings === null || typeof findings !== 'object') fail('observation_invalid', 'findings summary is required.');
  nonNegativeInteger(findings.fix_required_open, 'findings.fix_required_open');
  nonNegativeInteger(findings.escalate, 'findings.escalate');
  if (typeof verifying !== 'boolean' || typeof dispositionPending !== 'boolean') fail('observation_invalid', 'verifying and disposition_pending must be booleans.');
  return {
    loop: { state: loop.state, reason: typeof loop.reason === 'string' ? loop.reason : null, attempts_used: loop.attempts_used },
    bundle_status: bundleStatus,
    threads: { complete: threads.complete, unresolved: threads.unresolved },
    findings: { fix_required_open: findings.fix_required_open, escalate: findings.escalate },
    verifying,
    disposition_pending: dispositionPending,
  };
}

// Priority order matters: an escalation or a hold is visible regardless of anything else.
export function deriveConvergenceState(candidate) {
  const o = validateObservation(candidate);
  const decide = (state, reason) => Object.freeze({
    schema_version: CONVERGENCE_STATE_VERSION,
    state,
    reason,
    terminal: TERMINAL_STATES.includes(state),
    final_sync_permitted: state === 'CONVERGED',
    rounds_used: o.loop.attempts_used,
    rounds_remaining: Math.max(0, MAX_ROUNDS - o.loop.attempts_used),
    requires_human: state === 'HELD' || state === 'ESCALATED',
    loop_reason: o.loop.reason,
  });

  if (o.bundle_status === 'escalated' || o.findings.escalate > 0) return decide('ESCALATED', 'finding_escalated_out_of_autonomous_authority');
  if (o.loop.state === 'held') return decide('HELD', o.loop.reason ?? 'loop_held');
  if (o.bundle_status === 'held') return decide('HELD', 'disposition_bundle_held');
  const converged = o.loop.state === 'complete' && o.threads.complete && o.threads.unresolved === 0 && o.findings.fix_required_open === 0 && !o.verifying;
  if (converged) return decide('CONVERGED', 'loop_complete_threads_resolved_no_open_fixes');
  if (o.loop.state === 'complete' && !converged) {
    // The loop finished but conversation or fixes are not: this is a hold, not a silent wait.
    if (!o.threads.complete) return decide('HELD', 'thread_state_unknown_after_loop_complete');
    if (o.findings.fix_required_open > 0) return decide('FIXING', 'loop_complete_fix_required_open');
    if (o.threads.unresolved > 0) return decide('DISPOSITION', 'loop_complete_threads_unresolved');
  }
  if (o.verifying) return decide('VERIFYING', 'affected_gates_running_at_exact_head');
  if (o.findings.fix_required_open > 0) return decide('FIXING', 'fix_required_findings_open');
  if (o.disposition_pending) return decide('DISPOSITION', 'findings_await_disposition');
  if (o.loop.attempts_used === 0) return decide('REVIEW_PENDING', o.loop.reason ?? 'initial_deterministic_collection_required');
  if (o.loop.attempts_used >= MAX_ROUNDS) return decide('HELD', 'attempt_budget_exhausted');
  return decide('RE_REVIEW', `round_${o.loop.attempts_used + 1}_of_${MAX_ROUNDS}`);
}

export function assertTransition(from, to) {
  if (!CONVERGENCE_STATES.includes(from) || !CONVERGENCE_STATES.includes(to)) fail('state_invalid', `unknown state in transition ${from} -> ${to}.`);
  if (from === to) return to;
  if (!TRANSITIONS[from].includes(to)) fail('transition_invalid', `${from} -> ${to} is not a legal convergence transition.`);
  return to;
}

// Retry admissibility mirrors advanceReviewLoop: a retry must change at least one of
// implementation (head), hypothesis/input, tool/policy, environment (manifest), or evidence.
// Changing agent or model, re-running the same command, or re-sending the same prompt changes
// none of these and is therefore not new information.
export function retryCarriesNewInformation(previousAttempt, nextAttempt) {
  const fields = ['head_sha', 'input_sha256', 'policy_sha256', 'verification_manifest_sha256', 'evidence_fingerprint'];
  for (const field of fields) {
    if (typeof previousAttempt?.[field] !== 'string' || typeof nextAttempt?.[field] !== 'string') fail('attempt_invalid', `${field} must be present on both attempts.`);
  }
  const changed = fields.filter((field) => previousAttempt[field] !== nextAttempt[field]);
  return Object.freeze({ new_information: changed.length > 0, changed_fields: Object.freeze(changed) });
}

// Merge precondition as observed by an agent. `ready` is always false here on purpose: the
// authority to merge lives server-side (branch protection + trusted host executor), never in
// this module. This only reports which preconditions are visibly unmet.
export function evaluateMergePreconditions({ state, exact_head_evidence_valid: exactHead, required_checks_green: checksGreen, human_approval_valid: approval }) {
  if (!CONVERGENCE_STATES.includes(state)) fail('state_invalid', 'state must be a convergence state.');
  const unmet = [];
  if (state !== 'CONVERGED') unmet.push('findings_not_converged');
  if (exactHead !== true) unmet.push('exact_head_evidence_invalid_or_stale');
  if (checksGreen !== true) unmet.push('required_checks_not_green');
  if (approval !== true) unmet.push('human_approval_missing_or_stale');
  return Object.freeze({ observed_ready: unmet.length === 0, ready: false, authority: 'server_side_only', unmet: Object.freeze(unmet) });
}
