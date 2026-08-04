// Workflow-tool script: Workflow({name:'ship-item', args}).
//
// P6 is intentionally a validation-only fail-closed boundary. The measured
// Workflow runtime cannot provide the base-pinned host capability required to
// gather trusted evidence or merge. Keep every command and dispatch sink out of
// this candidate-controlled file until that executor exists outside the runtime.
// The future trusted-host procedure is documented in ship-item.md.
export const meta = {
  name: 'ship-item',
  description: 'P6 buffered ship: validate bounded args, then durably hold until a base-pinned trusted host executor exists.',
  phases: [
    { title: 'Validate', detail: 'Fail-closed validate the bounded workflow args' },
    { title: 'Hold', detail: 'Return the durable unavailable-host state without side effects' },
  ],
}

const ARGS_SAFE = args !== undefined && args !== null && typeof args === 'object' && !Array.isArray(args)
const A = ARGS_SAFE ? args : {}
const ALLOWED_ARG_KEYS = new Set(['branch', 'prNumber', 'userFacing', 'elevatedAuthorization'])
const ARG_KEYS_SAFE = ARGS_SAFE && Object.keys(A).every((key) => ALLOWED_ARG_KEYS.has(key))
const BRANCH = A.branch === undefined || A.branch === null ? '' : A.branch
const INPUT_PR_NUMBER = A.prNumber === undefined || A.prNumber === null ? null : A.prNumber
const INPUT_USER_FACING = A.userFacing === undefined || A.userFacing === null ? null : A.userFacing
const INPUT_ELEVATED_AUTHORIZATION = A.elevatedAuthorization === undefined || A.elevatedAuthorization === null
  ? null
  : A.elevatedAuthorization

const branchParts = typeof BRANCH === 'string' ? BRANCH.split('/') : []
const BRANCH_SAFE = BRANCH === '' || (
  typeof BRANCH === 'string' &&
  /^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/.test(BRANCH) &&
  !BRANCH.includes('..') &&
  !BRANCH.includes('//') &&
  !BRANCH.includes('@{') &&
  !BRANCH.endsWith('/') &&
  !BRANCH.endsWith('.') &&
  !branchParts.some((part) => !part || part.startsWith('.') || part.endsWith('.') || part.endsWith('.lock'))
)
const PR_NUMBER_SAFE = INPUT_PR_NUMBER === null || (Number.isSafeInteger(INPUT_PR_NUMBER) && INPUT_PR_NUMBER > 0)
const USER_FACING_SAFE = INPUT_USER_FACING === null || typeof INPUT_USER_FACING === 'boolean'
const ELEVATED_AUTHORIZATION_SAFE = INPUT_ELEVATED_AUTHORIZATION === null || (
  typeof INPUT_ELEVATED_AUTHORIZATION === 'string' &&
  /^[\x20-\x7e]{1,1000}$/.test(INPUT_ELEVATED_AUTHORIZATION)
)

// Generated from agent-contracts/spec-to-done.contract.json. The workflow
// runtime cannot import repository modules, so contract tests enforce set parity.
const SHIP_HELD_REASON_VALUES = [
  'arbiter_denied',
  'arbiter_identity_mismatch',
  'bad_args',
  'bad_findings',
  'branch_protection_changed_after_verdict',
  'branch_protection_changed_during_buffer',
  'branch_protection_single_owner_gate_not_strict',
  'branch_requires_separate_authorization',
  'critical_impact',
  'cyber_safeguard_payload',
  'detached_head',
  'detect_changes_repeatedly_failing',
  'evidence_not_closing',
  'evidence_stale',
  'evidence_too_large_for_arbiter',
  'external_blocked',
  'final_gate_not_clean',
  'final_gate_read_failed',
  'host_env_blocked',
  'human_approval_changed_after_verdict',
  'human_approval_required',
  'identity_changed_after_verdict',
  'identity_changed_during_buffer',
  'impact_unavailable',
  'invalid_args_format',
  'invalid_branch_arg',
  'invalid_elevated_authorization_arg',
  'invalid_git_identity',
  'invalid_pr_number_arg',
  'ledger_mismatch',
  'merge_command_failed',
  'merge_command_failed_unverified',
  'merge_not_observed',
  'merge_verification_failed',
  'no_browser_engine',
  'no_browser_evidence',
  'plan_author_failed',
  'plan_error_at_task',
  'plan_not_aligned',
  'plan_parse_failed',
  'pr_identity_not_ready',
  'pr_resolution_failed',
  'preparation_command_failed',
  'quality_review_not_closing',
  'resume_state_invalid',
  'review_evidence_changed_after_verdict',
  'review_required',
  'review_unverified',
  'reviewer_agent_failed',
  'reviewer_permission_changed_after_verdict',
  'reviewer_permission_not_strict',
  'run_budget_exhausted',
  'scope_drift',
  'ship_blocked',
  'spec_review_not_closing',
  'stale_base',
  'test_deploy_process_unproven',
  'trusted_elevated_authorization_unavailable',
  'unexpected_elevated_authorization',
  'worktree_not_clean',
  'wrong_checkout',
]
const SHIP_HELD_REASONS = new Set(SHIP_HELD_REASON_VALUES)
const held = (requestedReason, prNumber = null, heldDetail = null) => {
  const heldReason = SHIP_HELD_REASONS.has(requestedReason) ? requestedReason : 'ship_blocked'
  const canonicalPrNumber = Number.isSafeInteger(prNumber) && prNumber > 0 ? prNumber : null
  const canonicalDetail = heldReason === requestedReason && typeof heldDetail === 'string'
    ? heldDetail
    : null
  return {
    merged: false,
    prNumber: canonicalPrNumber,
    mergeCommit: null,
    heldReason,
    heldDetail: canonicalDetail,
  }
}

phase('Validate')
if (!ARGS_SAFE || !ARG_KEYS_SAFE) return held('invalid_args_format')
if (!BRANCH_SAFE) return held('invalid_branch_arg')
if (!PR_NUMBER_SAFE) return held('invalid_pr_number_arg')
if (!USER_FACING_SAFE) return held('invalid_args_format')
if (!ELEVATED_AUTHORIZATION_SAFE) return held('invalid_elevated_authorization_arg')

phase('Hold')
return held('host_env_blocked', INPUT_PR_NUMBER, 'ship_workflow_shell_unavailable')
