import { createHash, timingSafeEqual } from 'node:crypto'


export class TrustedMergeHold extends Error {
  constructor(reason, detail) {
    super(detail)
    this.name = 'TrustedMergeHold'
    this.reason = reason
    this.detail = detail
  }
}

export const fail = (reason, detail) => {
  throw new TrustedMergeHold(reason, detail)
}

export const isPlainObject = (value) => (
  value !== null && typeof value === 'object' && !Array.isArray(value)
)

export const safeInteger = (value) => Number.isSafeInteger(value) && value > 0

export const exactKeys = (value, keys) => {
  if (!isPlainObject(value)) return false
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}

export const equalText = (left, right) => {
  if (typeof left !== 'string' || typeof right !== 'string') return false
  const a = Buffer.from(left)
  const b = Buffer.from(right)
  return a.length === b.length && timingSafeEqual(a, b)
}

export const canonicalJson = (value) => {
  const normalize = (item) => {
    if (Array.isArray(item)) return item.map(normalize)
    if (!isPlainObject(item)) return item
    return Object.fromEntries(Object.keys(item).sort().map((key) => [key, normalize(item[key])]))
  }
  return JSON.stringify(normalize(value))
}

export const sha256 = (value) => createHash('sha256').update(value).digest('hex')

const parsePositiveInteger = (value, reason = 'invalid_pr_number_arg') => {
  if (safeInteger(value)) return value
  if (typeof value !== 'string' || !/^[1-9][0-9]{0,14}$/u.test(value)) {
    fail(reason, 'positive_integer_required')
  }
  const parsed = Number(value)
  if (!safeInteger(parsed)) fail(reason, 'safe_positive_integer_required')
  return parsed
}

const parseSha = (value, detail) => {
  if (typeof value !== 'string' || !/^[0-9a-f]{40}$/u.test(value)) {
    fail('invalid_args_format', detail)
  }
  return value
}

export function prepareInvocation(raw, context, contract, now = new Date()) {
  const inputKeys = [
    'prNumber', 'expectedHead', 'expectedBase', 'expectedActivationMode',
    'provider', 'nonce', 'expiresAt',
  ]
  if (!exactKeys(raw, inputKeys)) fail('invalid_args_format', 'dispatch_input_shape_invalid')
  if (!isPlainObject(context)) fail('host_env_blocked', 'workflow_context_missing')

  const repository = contract?.repository?.full_name
  const branch = contract?.repository?.base_branch
  if (
    context.eventName !== 'workflow_dispatch' || context.repository !== repository ||
    context.ref !== `refs/heads/${branch}` ||
    Number(context.runAttempt) !== contract?.executor?.run_attempt
  ) {
    fail('wrong_checkout', 'workflow_identity_mismatch')
  }

  const invocation = {
    repo: repository,
    prNumber: parsePositiveInteger(raw.prNumber),
    headOid: parseSha(raw.expectedHead, 'expected_head_invalid'),
    baseOid: parseSha(raw.expectedBase, 'expected_base_invalid'),
    action: contract.broker.assertion.action,
    runId: parsePositiveInteger(context.runId, 'host_env_blocked'),
    activationMode: raw.expectedActivationMode,
    provider: raw.provider,
    nonce: raw.nonce,
    expiresAt: raw.expiresAt,
  }
  if (!equalText(context.sha, invocation.baseOid)) fail('stale_base', 'workflow_sha_not_expected_base')
  if (!contract.apex.providers.includes(invocation.provider)) {
    fail('invalid_args_format', 'unsupported_apex_provider')
  }
  const activationModes = [...contract.activation.pending_modes, contract.activation.active_mode]
  if (!activationModes.includes(invocation.activationMode)) {
    fail('invalid_args_format', 'unsupported_activation_mode')
  }
  const noncePattern = new RegExp(contract.broker.assertion.nonce_pattern, 'u')
  if (typeof invocation.nonce !== 'string' || !noncePattern.test(invocation.nonce)) {
    fail('invalid_args_format', 'nonce_invalid')
  }
  if (typeof invocation.expiresAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(invocation.expiresAt)) {
    fail('invalid_args_format', 'expiry_invalid')
  }
  const expiresAtMs = Date.parse(invocation.expiresAt)
  const nowMs = now.getTime()
  const lifetimeMs = contract.broker.assertion.max_lifetime_seconds * 1000
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= nowMs || expiresAtMs > nowMs + lifetimeMs) {
    fail('trusted_elevated_authorization_unavailable', 'authorization_expired_or_too_long')
  }
  return invocation
}

export function buildBrokerAssertion(invocation, contract) {
  const assertion = {
    kind: contract.broker.assertion.kind,
    version: contract.broker.assertion.version,
    repo: invocation.repo,
    prNumber: invocation.prNumber,
    headOid: invocation.headOid,
    baseOid: invocation.baseOid,
    action: invocation.action,
    runId: invocation.runId,
    activationMode: invocation.activationMode,
    provider: invocation.provider,
    nonce: invocation.nonce,
    expiresAt: invocation.expiresAt,
  }
  if (!exactKeys(assertion, contract.broker.assertion.fields)) {
    fail('host_env_blocked', 'broker_assertion_contract_drift')
  }
  return JSON.stringify(assertion)
}

export function activationTupleSha256(invocation, contract) {
  const fields = contract?.activation?.attestation_tuple_fields
  if (!Array.isArray(fields) || fields.length === 0 || new Set(fields).size !== fields.length) {
    fail('host_env_blocked', 'activation_tuple_contract_invalid')
  }
  const tuple = {}
  for (const field of fields) {
    if (!Object.hasOwn(invocation, field)) fail('host_env_blocked', 'activation_tuple_field_missing')
    tuple[field] = invocation[field]
  }
  return sha256(canonicalJson(tuple))
}

export function verifyActivationGate({
  activationState,
  externalMode,
  attestationTupleSha256,
  invocation,
  contract,
}) {
  const activation = contract?.activation
  const tupleDigest = typeof attestationTupleSha256 === 'string' ? attestationTupleSha256 : ''
  if (!equalText(externalMode, invocation?.activationMode)) {
    fail('trusted_elevated_authorization_unavailable', 'activation_mode_mismatch')
  }
  if (activationState === activation?.active_state) {
    if (externalMode !== activation.active_mode || tupleDigest !== '') {
      fail('trusted_elevated_authorization_unavailable', 'active_activation_state_mismatch')
    }
    return activation.active_mode
  }
  if (activationState === activation?.pending_state) {
    if (!activation.pending_modes.includes(externalMode)) {
      fail('trusted_elevated_authorization_unavailable', 'attestation_mode_not_enabled')
    }
    const expected = activationTupleSha256(invocation, contract)
    if (!/^[0-9a-f]{64}$/u.test(tupleDigest) || !equalText(tupleDigest, expected)) {
      fail('trusted_elevated_authorization_unavailable', 'attestation_tuple_mismatch')
    }
    return externalMode
  }
  fail('trusted_elevated_authorization_unavailable', 'activation_state_unknown')
}

export function verifyEnvironmentConfiguration(environment, branchPolicies, contract) {
  if (!isPlainObject(environment) || environment.name !== contract.broker.environment) {
    fail('trusted_elevated_authorization_unavailable', 'environment_identity_mismatch')
  }
  if (environment.can_admins_bypass !== contract.broker.admins_can_bypass) {
    fail('trusted_elevated_authorization_unavailable', 'environment_admin_bypass_enabled')
  }
  const rules = Array.isArray(environment.protection_rules)
    ? environment.protection_rules.filter((rule) => rule?.type === 'required_reviewers')
    : []
  const rule = rules[0]
  if (
    rules.length !== 1 || rule.prevent_self_review !== contract.broker.prevent_self_review ||
    !Array.isArray(rule.reviewers) || rule.reviewers.length !== 1
  ) {
    fail('trusted_elevated_authorization_unavailable', 'environment_reviewer_policy_not_strict')
  }
  const configured = rule.reviewers[0]
  const expected = contract.broker.required_reviewer
  if (
    configured?.type !== expected.type || configured?.reviewer?.login !== expected.login ||
    configured?.reviewer?.id !== expected.id || configured?.reviewer?.type !== expected.type
  ) {
    fail('trusted_elevated_authorization_unavailable', 'environment_reviewer_identity_mismatch')
  }
  const expectedPolicy = contract.broker.deployment_branch_policy
  if (
    environment.deployment_branch_policy?.protected_branches !== expectedPolicy.protected_branches ||
    environment.deployment_branch_policy?.custom_branch_policies !== expectedPolicy.custom_branch_policies ||
    !Array.isArray(branchPolicies) || branchPolicies.length !== 1 ||
    branchPolicies[0]?.name !== expectedPolicy.allowed_branch || branchPolicies[0]?.type !== 'branch'
  ) {
    fail('trusted_elevated_authorization_unavailable', 'environment_branch_allowlist_invalid')
  }
}

export function verifyBrokerApproval(approvals, expectedAssertion, invocation, contract, now = new Date()) {
  if (Date.parse(invocation.expiresAt) <= now.getTime()) {
    fail('trusted_elevated_authorization_unavailable', 'authorization_expired')
  }
  if (!Array.isArray(approvals) || approvals.length !== 1) {
    fail('trusted_elevated_authorization_unavailable', 'approval_history_not_one_use')
  }
  const approval = approvals[0]
  const reviewer = contract.broker.required_reviewer
  const environments = Array.isArray(approval?.environments) ? approval.environments : []
  if (
    approval?.state !== 'approved' || !equalText(approval?.comment, expectedAssertion) ||
    approval?.user?.login !== reviewer.login || approval?.user?.id !== reviewer.id ||
    approval?.user?.type !== reviewer.type || environments.length !== 1 ||
    environments[0]?.name !== contract.broker.environment
  ) {
    fail('trusted_elevated_authorization_unavailable', 'broker_approval_mismatch')
  }
}
