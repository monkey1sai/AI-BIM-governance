import {
  canonicalize,
  digestCanonical,
  isCanonicalOpaqueId,
  isCanonicalOpaqueReference,
  isCanonicalUtcMillisecondTimestamp,
  parseStackDeliveryEnvelope,
} from './parallel-delivery-fabric-contract.mjs'

const deepFreeze = (value) => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze(nested)
    Object.freeze(value)
  }
  return value
}

const SHA1 = /^[0-9a-f]{40}$/u
const SHA256 = /^[0-9a-f]{64}$/u
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u
const SECRET_VALUE = /(?:bearer|token|cookie|authorization|private[-_]?key|gh[pousr]_|github_pat_|eyJ[A-Za-z0-9_-]{10,})/iu
const RAW_WINDOWS_SID = /(?:^|[/:])S-\d+(?:-\d+){2,}(?=$|[/:])/iu
const SENSITIVE_KEY = /(?:token|cookie|authorization|private[_-]?key|(?:^|_)sid$|(?:^|_)pid$|process[_-]?id|transcript|(?:^|_)env(?:_|$)|environment|absolute[_-]?path)/iu
const MEMBER_KEYS = Object.freeze([
  'pr_number', 'node_id', 'position', 'head_ref', 'head_sha', 'direct_base_ref', 'direct_base_sha',
  'exact_head_packet_digest', 'checks_digest', 'independent_review_digest', 'e2e_required',
  'e2e_result_digest', 'unresolved_finding_state',
])
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
const isSha = (value) => typeof value === 'string' && SHA1.test(value)
const isDigest = (value) => typeof value === 'string' && SHA256.test(value)
const isOperationUuid = (value) => typeof value === 'string' && UUID.test(value)
const exactKeys = (value, keys) => isObject(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key))
const hasUnsafeString = (value) => !(SHA1.test(value) || SHA256.test(value) || isCanonicalUtcMillisecondTimestamp(value)) &&
  (SECRET_VALUE.test(value) || RAW_WINDOWS_SID.test(value))
const recursivelyPrivacySafe = (value, depth = 0) => {
  if (depth > 64) return false
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return true
  if (typeof value === 'string') return !hasUnsafeString(value)
  if (Array.isArray(value)) return value.every((entry) => recursivelyPrivacySafe(entry, depth + 1))
  if (!isObject(value)) return false
  return Object.entries(value).every(([key, entry]) => !SENSITIVE_KEY.test(key) && recursivelyPrivacySafe(entry, depth + 1))
}
const canonicalObject = (raw) => {
  try {
    const value = canonicalize(raw)
    return isObject(value) && recursivelyPrivacySafe(value) ? value : null
  } catch {
    return null
  }
}
const canonicalCopy = (raw) => {
  try {
    const value = canonicalize(raw)
    return recursivelyPrivacySafe(value) ? value : null
  } catch {
    return null
  }
}
const sameCanonical = (left, right) => {
  const normalizedLeft = canonicalCopy(left)
  const normalizedRight = canonicalCopy(right)
  return normalizedLeft !== null && normalizedRight !== null && JSON.stringify(normalizedLeft) === JSON.stringify(normalizedRight)
}
const isRepository = (value) => typeof value === 'string' && value.length >= 3 && value.length <= 256 && REPOSITORY.test(value) && !hasUnsafeString(value)
const memberShapeIsValid = (member) => exactKeys(member, MEMBER_KEYS) &&
  Number.isSafeInteger(member.pr_number) && member.pr_number >= 1 && member.pr_number <= 1_000_000_000 &&
  isCanonicalOpaqueReference(member.node_id) && Number.isSafeInteger(member.position) && member.position >= 1 && member.position <= 64 &&
  isCanonicalOpaqueId(member.head_ref) && isSha(member.head_sha) && isCanonicalOpaqueId(member.direct_base_ref) &&
  isSha(member.direct_base_sha) && isDigest(member.exact_head_packet_digest) && isDigest(member.checks_digest) &&
  isDigest(member.independent_review_digest) && typeof member.e2e_required === 'boolean' &&
  (member.e2e_result_digest === null || isDigest(member.e2e_result_digest)) &&
  member.e2e_required === (member.e2e_result_digest !== null) && member.unresolved_finding_state === 'none'

const sameMember = (expected, observed) => (
  expected.pr_number === observed?.pr_number &&
  expected.node_id === observed?.node_id &&
  expected.position === observed?.position &&
  expected.head_ref === observed?.head_ref &&
  expected.head_sha === observed?.head_sha &&
  expected.direct_base_ref === observed?.direct_base_ref &&
  expected.direct_base_sha === observed?.direct_base_sha &&
  expected.exact_head_packet_digest === observed?.exact_head_packet_digest &&
  expected.checks_digest === observed?.checks_digest &&
  expected.independent_review_digest === observed?.independent_review_digest &&
  expected.e2e_required === observed?.e2e_required &&
  expected.e2e_result_digest === observed?.e2e_result_digest &&
  expected.unresolved_finding_state === observed?.unresolved_finding_state
)

const closed = (internal_state, reason) => deepFreeze({
  phase: 'CLOSED',
  internal_state,
  reason,
})

const parseObservation = (raw) => {
  const value = canonicalObject(raw)
  const keys = [
    'schema_version', 'observed_at', 'repository', 'trunk_ref', 'trunk_sha', 'protection_digest',
    'capability_reference', 'capability_state', 'chain',
  ]
  if (!exactKeys(value, keys) || value.schema_version !== 'direct-stack-observation/v1' ||
    !isCanonicalUtcMillisecondTimestamp(value.observed_at) || !isRepository(value.repository) ||
    !isCanonicalOpaqueId(value.trunk_ref) || !isSha(value.trunk_sha) || !isDigest(value.protection_digest) ||
    !isCanonicalOpaqueReference(value.capability_reference) ||
    !['enabled', 'unsupported', 'unknown'].includes(value.capability_state) || !Array.isArray(value.chain) ||
    value.chain.length < 1 || value.chain.length > 64) return null
  for (const member of value.chain) {
    if (!exactKeys(member, ['repository', 'merged', ...MEMBER_KEYS]) || !isRepository(member.repository) ||
      typeof member.merged !== 'boolean' || !memberShapeIsValid(Object.fromEntries(
        MEMBER_KEYS.map((key) => [key, member[key]]),
      ))) return null
  }
  return value
}

const stackIsLinear = (stack) => stack.members.every((member, index) => (
  index === 0
    ? member.direct_base_ref === stack.trunk_ref && member.direct_base_sha === stack.trunk_sha
    : member.direct_base_ref === stack.members[index - 1].head_ref && member.direct_base_sha === stack.members[index - 1].head_sha
))

const buildDispatchPacket = (stack, repository) => deepFreeze(canonicalCopy({
  schema_version: 'direct-stack-request/v1',
  stack_id: stack.stack_id,
  repository,
  trunk_ref: stack.trunk_ref,
  trunk_sha: stack.trunk_sha,
  selected_top_pr: stack.selected_top_pr,
  expected_head_sha: stack.members.at(-1).head_sha,
  merge_action: stack.merge_action,
  merge_method: stack.merge_method,
  ordered_member_vector_digest: stack.ordered_member_vector_digest,
  members: stack.members,
  expected_protection_digest: stack.expected_protection_digest,
  capability_reference: stack.capability_reference,
  capability_state: 'enabled',
  deployment_target_reference: stack.deployment_target_reference,
  expected_state: {
    repository,
    trunk_ref: stack.trunk_ref,
    trunk_sha: stack.trunk_sha,
    selected_top_pr: stack.selected_top_pr,
    expected_head_sha: stack.members.at(-1).head_sha,
    ordered_member_vector_digest: stack.ordered_member_vector_digest,
    expected_protection_digest: stack.expected_protection_digest,
    capability_reference: stack.capability_reference,
    capability_state: 'enabled',
  },
  cas_precondition: {
    stack_id: stack.stack_id,
    repository,
    trunk_sha: stack.trunk_sha,
    selected_top_pr: stack.selected_top_pr,
    expected_head_sha: stack.members.at(-1).head_sha,
    ordered_member_vector_digest: stack.ordered_member_vector_digest,
    expected_protection_digest: stack.expected_protection_digest,
    capability_reference: stack.capability_reference,
  },
}))

const parsePlan = (raw) => {
  const plan = canonicalObject(raw)
  if (!exactKeys(plan, ['phase', 'internal_state', 'repository', 'frozen_stack', 'request', 'request_digest']) ||
    plan.phase !== 'READY_TO_MERGE' || plan.internal_state !== 'STACK_REQUEST_READY' || !isRepository(plan.repository) ||
    !isDigest(plan.request_digest)) return null
  try {
    const stack = parseStackDeliveryEnvelope(plan.frozen_stack)
    const request = buildDispatchPacket(stack, plan.repository)
    return request !== null && sameCanonical(request, plan.request) && plan.request_digest === digestCanonical(request)
      ? deepFreeze(plan)
      : null
  } catch {
    return null
  }
}

const expectedStateDigest = (request) => {
  try {
    return isObject(request?.expected_state) ? digestCanonical(request.expected_state) : null
  } catch {
    return null
  }
}

const parseOperation = (raw, plan) => {
  const operation = canonicalObject(raw)
  const stack = plan?.frozen_stack
  const request = plan?.request
  if (!exactKeys(operation, [
    'schema_version', 'operation_uuid', 'operation_reference', 'stack_id', 'repository', 'request_digest',
    'expected_state_digest', 'ordered_member_vector_digest', 'expected_head_sha', 'expected_protection_digest',
    'capability_reference',
  ]) || operation.schema_version !== 'direct-stack-operation/v1' || !isOperationUuid(operation.operation_uuid) ||
    !isCanonicalOpaqueReference(operation.operation_reference) || !stack || !request) return null
  return operation.stack_id === stack.stack_id && operation.repository === plan.repository &&
    operation.request_digest === plan.request_digest && operation.expected_state_digest === expectedStateDigest(request) &&
    operation.ordered_member_vector_digest === stack.ordered_member_vector_digest &&
    operation.expected_head_sha === request.expected_head_sha &&
    operation.expected_protection_digest === request.expected_protection_digest &&
    operation.capability_reference === request.capability_reference
    ? deepFreeze(operation)
    : null
}

const mergePending = (internal_state, plan, operation) => deepFreeze({
  phase: 'MERGING',
  internal_state,
  repository: plan.repository,
  frozen_stack: plan.frozen_stack,
  request: plan.request,
  request_digest: plan.request_digest,
  operation,
  frozen_vector_digest: plan.frozen_stack.ordered_member_vector_digest,
})

const parseAccepted = (raw, plan) => {
  const accepted = canonicalObject(raw)
  if (!exactKeys(accepted, [
    'phase', 'internal_state', 'repository', 'frozen_stack', 'request', 'request_digest', 'operation', 'frozen_vector_digest',
  ]) || accepted.phase !== 'MERGING' || !['MERGE_ASYNC_DISPATCHED', 'MERGE_ASYNC_PENDING'].includes(accepted.internal_state) ||
    accepted.repository !== plan.repository || accepted.request_digest !== plan.request_digest ||
    accepted.frozen_vector_digest !== plan.frozen_stack.ordered_member_vector_digest ||
    !sameCanonical(accepted.frozen_stack, plan.frozen_stack) || !sameCanonical(accepted.request, plan.request)) return null
  const operation = parseOperation(accepted.operation, plan)
  return operation === null ? null : deepFreeze({ ...accepted, operation })
}

const selectedPrefixIsValid = (stack, chain, repository) => {
  if (!Array.isArray(chain) || chain.length < stack.members.length) return false
  if (chain.some((member) => member?.repository !== repository || typeof member?.merged !== 'boolean')) return false
  const firstUnmerged = chain.findIndex((member) => !member.merged)
  if (firstUnmerged < 0 || firstUnmerged + stack.members.length > chain.length) return false
  const selected = chain.slice(firstUnmerged, firstUnmerged + stack.members.length)
  if (selected.some((member) => member.merged)) return false
  return selected.every((member, index) => sameMember(stack.members[index], member)) &&
    selected.at(-1)?.pr_number === stack.selected_top_pr
}

export function planDirectStackDispatch(input = {}) {
  try {
    const value = canonicalObject(input)
    if (!exactKeys(value, ['stack', 'repository', 'observation']) || !isRepository(value.repository)) {
      return closed('PREMERGE_EVIDENCE_INVALID', 'stack_plan_input_invalid')
    }
    let frozenStack
    try {
      frozenStack = parseStackDeliveryEnvelope(value.stack)
    } catch {
      return closed('PREMERGE_EVIDENCE_INVALID', 'stack_envelope_invalid')
    }
    const observation = parseObservation(value.observation)
    if (observation === null) return closed('PREMERGE_EVIDENCE_INVALID', 'stack_observation_invalid')
    const observedAt = Date.parse(observation.observed_at)
    if (observedAt < Date.parse(frozenStack.created_at) || observedAt >= Date.parse(frozenStack.expires_at)) {
      return closed('PREMERGE_EVIDENCE_INVALID', 'stack_envelope_outside_validity_window')
    }
    if (observation.capability_state !== 'enabled') return closed('PREMERGE_AUTHORITY_UNAVAILABLE', 'direct_stack_capability_unavailable')
    const vectorMatches = selectedPrefixIsValid(frozenStack, observation.chain, value.repository) && stackIsLinear(frozenStack) &&
      observation.repository === value.repository && observation.trunk_ref === frozenStack.trunk_ref &&
      observation.trunk_sha === frozenStack.trunk_sha && observation.protection_digest === frozenStack.expected_protection_digest &&
      observation.capability_reference === frozenStack.capability_reference
    if (!vectorMatches) return closed('PREMERGE_EVIDENCE_INVALID', 'stack_vector_or_capability_drift')
    const request = buildDispatchPacket(frozenStack, value.repository)
    const requestDigest = request === null ? null : digestCanonical(request)
    if (requestDigest === null) return closed('MERGE_OUTCOME_UNVERIFIED', 'stack_request_canonicalization_failed')
    return deepFreeze({
      phase: 'READY_TO_MERGE',
      internal_state: 'STACK_REQUEST_READY',
      repository: value.repository,
      frozen_stack: frozenStack,
      request,
      request_digest: requestDigest,
    })
  } catch {
    return closed('PREMERGE_EVIDENCE_INVALID', 'stack_plan_exception')
  }
}

export function dispatchDirectStackMerge(input = {}) {
  try {
    if (!exactKeys(input, ['plan', 'observation', 'send'])) {
      return closed('PREMERGE_EVIDENCE_INVALID', 'stack_dispatch_input_invalid')
    }
    const plan = parsePlan(input.plan)
    if (plan === null) return closed('PREMERGE_EVIDENCE_INVALID', 'stack_dispatch_plan_invalid')
    const reread = planDirectStackDispatch({
      stack: plan.frozen_stack,
      repository: plan.repository,
      observation: input.observation,
    })
    if (reread.phase !== 'READY_TO_MERGE' || !sameCanonical(reread, plan)) return reread
    if (typeof input.send !== 'function') return closed('PREMERGE_AUTHORITY_UNAVAILABLE', 'stack_dispatch_port_unavailable')
    // Phase 0 deliberately has no activation authority. Keep the sink inert even
    // when a caller injects a function; reducers can still validate recorded
    // responses without turning this candidate-owned module into a merge sink.
    return closed('PREMERGE_AUTHORITY_UNAVAILABLE', 'direct_stack_activation_held')
  } catch {
    return closed('PREMERGE_AUTHORITY_UNAVAILABLE', 'stack_dispatch_port_failed')
  }
}

const parseDispatchResponse = (raw, plan) => {
  const response = canonicalObject(raw)
  if (!isObject(response) || !Number.isSafeInteger(response.status)) return null
  if (response.status === 202) {
    const operation = exactKeys(response, ['status', 'operation']) ? parseOperation(response.operation, plan) : null
    return operation === null ? null : { kind: 'accepted', operation }
  }
  if (response.status === 200 || response.status === 409) {
    if (!exactKeys(response, ['status', 'operation', 'request', 'request_digest']) ||
      response.request_digest !== plan.request_digest || !sameCanonical(response.request, plan.request)) return null
    const operation = parseOperation(response.operation, plan)
    return operation === null ? null : { kind: 'accepted', operation }
  }
  if (![400, 403, 404, 422].includes(response.status) || !exactKeys(response, [
    'status', 'stack_id', 'repository', 'request_digest', 'ordered_member_vector_digest',
    'authoritative_zero_member_merged', 'deterministic_evidence',
  ]) || response.stack_id !== plan.frozen_stack.stack_id || response.repository !== plan.repository ||
    response.request_digest !== plan.request_digest ||
    response.ordered_member_vector_digest !== plan.frozen_stack.ordered_member_vector_digest ||
    typeof response.authoritative_zero_member_merged !== 'boolean' || typeof response.deterministic_evidence !== 'boolean') return null
  if (!response.authoritative_zero_member_merged) return { kind: 'unproven' }
  if (response.status === 400 || response.status === 422) {
    return response.deterministic_evidence ? { kind: 'premerge_rejection' } : { kind: 'authority_unavailable' }
  }
  return { kind: 'authority_unavailable' }
}

export function reduceDirectStackDispatch(input = {}) {
  try {
    const value = canonicalObject(input)
    if (!exactKeys(value, ['plan', 'response'])) return closed('MERGE_OUTCOME_UNVERIFIED', 'stack_dispatch_input_invalid')
    const plan = parsePlan(value.plan)
    if (plan === null) return closed('MERGE_OUTCOME_UNVERIFIED', 'stack_dispatch_plan_invalid')
    const response = parseDispatchResponse(value.response, plan)
    if (response === null || response.kind === 'unproven') return closed('MERGE_OUTCOME_UNVERIFIED', 'stack_dispatch_outcome_unproven')
    if (response.kind === 'premerge_rejection') return closed('PREMERGE_EVIDENCE_INVALID', 'stack_dispatch_rejected_with_zero_member_proof')
    if (response.kind === 'authority_unavailable') return closed('PREMERGE_AUTHORITY_UNAVAILABLE', 'stack_dispatch_authority_unavailable')
    return mergePending('MERGE_ASYNC_DISPATCHED', plan, response.operation)
  } catch {
    return closed('MERGE_OUTCOME_UNVERIFIED', 'stack_dispatch_exception')
  }
}

const parseFreshOriginMain = (raw, plan, resultSha, observedAt) => {
  const observation = canonicalObject(raw)
  if (!exactKeys(observation, [
    'schema_version', 'observed_at', 'source_reference', 'repository', 'trunk_ref', 'commit_sha', 'authoritative',
  ]) || observation.schema_version !== 'origin-main-observation/v1' ||
    !isCanonicalUtcMillisecondTimestamp(observation.observed_at) || !isCanonicalOpaqueReference(observation.source_reference) ||
    observation.repository !== plan.repository || observation.trunk_ref !== plan.frozen_stack.trunk_ref ||
    observation.commit_sha !== resultSha || observation.authoritative !== true || observation.observed_at !== observedAt) return null
  return deepFreeze(observation)
}

const parseMergedMember = (raw, expected, resultSha) => {
  const merged = canonicalObject(raw)
  if (!exactKeys(merged, [...MEMBER_KEYS, 'merged', 'frozen_head_sha', 'reported_merge_commit_sha']) ||
    !sameMember(expected, merged) || merged.merged !== true || merged.frozen_head_sha !== expected.head_sha ||
    merged.reported_merge_commit_sha !== resultSha) return null
  return deepFreeze(merged)
}

const parseAncestryProof = (raw, expected, resultSha) => {
  const proof = canonicalObject(raw)
  if (!exactKeys(proof, ['node_id', 'ancestor_sha', 'descendant_sha', 'reachable', 'proof_digest']) ||
    proof.node_id !== expected.node_id || proof.ancestor_sha !== expected.head_sha ||
    proof.descendant_sha !== resultSha || proof.reachable !== true || !isDigest(proof.proof_digest)) return null
  return deepFreeze(proof)
}

const parseStackPoll = (raw, plan, accepted) => {
  const poll = canonicalObject(raw)
  const baseKeys = ['schema_version', 'status', 'observed_at', 'stack_id', 'repository', 'request_digest', 'operation']
  if (!isObject(poll) || poll.schema_version !== 'direct-stack-poll/v1' || !isCanonicalUtcMillisecondTimestamp(poll.observed_at) ||
    poll.stack_id !== plan.frozen_stack.stack_id || poll.repository !== plan.repository ||
    poll.request_digest !== plan.request_digest || !sameCanonical(poll.operation, accepted.operation)) return null
  const operation = parseOperation(poll.operation, plan)
  if (operation === null) return null
  // A poll observed before the frozen stack existed cannot describe its merge: a
  // replayed stale observation would otherwise become `merged_at` and let a
  // deployment dated before the stack satisfy the merge-to-deploy ordering.
  const observedAt = Date.parse(poll.observed_at)
  if (observedAt < Date.parse(plan.frozen_stack.created_at) ||
      observedAt >= Date.parse(plan.frozen_stack.expires_at)) return null
  if (poll.status === 'pending') return exactKeys(poll, baseKeys) ? { kind: 'pending' } : null
  if (['timeout', 'expired', 'not_found', 'ambiguous'].includes(poll.status)) {
    return exactKeys(poll, baseKeys) ? { kind: 'unproven' } : null
  }
  if (poll.status === 'failed') {
    if (!exactKeys(poll, [...baseKeys, 'authoritative_zero_member_merged', 'policy_or_settings_drift']) ||
      typeof poll.authoritative_zero_member_merged !== 'boolean' || typeof poll.policy_or_settings_drift !== 'boolean') return null
    if (!poll.authoritative_zero_member_merged) return { kind: 'unproven' }
    return poll.policy_or_settings_drift ? { kind: 'policy_drift' } : { kind: 'authority_unavailable' }
  }
  if (poll.status !== 'succeeded' || !exactKeys(poll, [
    ...baseKeys, 'member_vector_digest', 'members', 'stack_result_merge_commit_sha', 'fresh_origin_main', 'ancestry',
  ]) || poll.member_vector_digest !== plan.frozen_stack.ordered_member_vector_digest ||
    !isSha(poll.stack_result_merge_commit_sha) || !Array.isArray(poll.members) ||
    poll.members.length !== plan.frozen_stack.members.length || !Array.isArray(poll.ancestry) ||
    poll.ancestry.length !== plan.frozen_stack.members.length) return null
  const freshOriginMain = parseFreshOriginMain(poll.fresh_origin_main, plan, poll.stack_result_merge_commit_sha, poll.observed_at)
  if (freshOriginMain === null) return null
  const members = poll.members.map((member, index) => parseMergedMember(member, plan.frozen_stack.members[index], poll.stack_result_merge_commit_sha))
  const ancestry = poll.ancestry.map((proof, index) => parseAncestryProof(proof, plan.frozen_stack.members[index], poll.stack_result_merge_commit_sha))
  if (members.some((member) => member === null) || ancestry.some((proof) => proof === null)) return null
  return {
    kind: 'succeeded',
    members: deepFreeze(members),
    ancestry: deepFreeze(ancestry),
    stack_result_merge_commit_sha: poll.stack_result_merge_commit_sha,
    fresh_origin_main: freshOriginMain,
    merged_at: poll.observed_at,
  }
}

export function reduceDirectStackPoll(input = {}) {
  try {
    const value = canonicalObject(input)
    if (!exactKeys(value, ['plan', 'accepted', 'poll'])) return closed('MERGE_OUTCOME_UNVERIFIED', 'stack_poll_input_invalid')
    const plan = parsePlan(value.plan)
    if (plan === null) return closed('MERGE_OUTCOME_UNVERIFIED', 'stack_poll_plan_invalid')
    const accepted = parseAccepted(value.accepted, plan)
    if (accepted === null) return closed('MERGE_OUTCOME_UNVERIFIED', 'stack_poll_accepted_invalid')
    const poll = parseStackPoll(value.poll, plan, accepted)
    if (poll === null || poll.kind === 'unproven') return closed('MERGE_OUTCOME_UNVERIFIED', 'stack_poll_terminal_outcome_unproven')
    if (poll.kind === 'pending') return mergePending('MERGE_ASYNC_PENDING', plan, accepted.operation)
    if (poll.kind === 'policy_drift') return closed('POLICY_OR_SETTINGS_DRIFT', 'stack_poll_policy_or_settings_drift')
    if (poll.kind === 'authority_unavailable') return closed('PREMERGE_AUTHORITY_UNAVAILABLE', 'stack_poll_failure_without_merge')
    return deepFreeze({
      phase: 'MERGED',
      internal_state: 'STACK_MERGED_PENDING_DEPLOY',
      repository: plan.repository,
      frozen_stack: plan.frozen_stack,
      request: plan.request,
      request_digest: plan.request_digest,
      operation: accepted.operation,
      stack_id: plan.frozen_stack.stack_id,
      stack_result_merge_commit_sha: poll.stack_result_merge_commit_sha,
      frozen_vector_digest: plan.frozen_stack.ordered_member_vector_digest,
      members: poll.members,
      ancestry: poll.ancestry,
      fresh_origin_main: poll.fresh_origin_main,
      merged_at: poll.merged_at,
    })
  } catch {
    return closed('MERGE_OUTCOME_UNVERIFIED', 'stack_poll_exception')
  }
}

const parseMerged = (raw) => {
  const merged = canonicalObject(raw)
  if (!exactKeys(merged, [
    'phase', 'internal_state', 'repository', 'frozen_stack', 'request', 'request_digest', 'operation', 'stack_id',
    'stack_result_merge_commit_sha', 'frozen_vector_digest', 'members', 'ancestry', 'fresh_origin_main', 'merged_at',
  ]) || merged.phase !== 'MERGED' || merged.internal_state !== 'STACK_MERGED_PENDING_DEPLOY' ||
    !isCanonicalUtcMillisecondTimestamp(merged.merged_at) || !isSha(merged.stack_result_merge_commit_sha)) return null
  const plan = parsePlan({
    phase: 'READY_TO_MERGE',
    internal_state: 'STACK_REQUEST_READY',
    repository: merged.repository,
    frozen_stack: merged.frozen_stack,
    request: merged.request,
    request_digest: merged.request_digest,
  })
  if (plan === null || merged.stack_id !== plan.frozen_stack.stack_id ||
    merged.frozen_vector_digest !== plan.frozen_stack.ordered_member_vector_digest) return null
  const operation = parseOperation(merged.operation, plan)
  if (operation === null) return null
  const accepted = mergePending('MERGE_ASYNC_DISPATCHED', plan, operation)
  const poll = parseStackPoll({
    schema_version: 'direct-stack-poll/v1',
    status: 'succeeded',
    observed_at: merged.merged_at,
    stack_id: merged.stack_id,
    repository: merged.repository,
    request_digest: merged.request_digest,
    operation,
    member_vector_digest: merged.frozen_vector_digest,
    members: merged.members,
    stack_result_merge_commit_sha: merged.stack_result_merge_commit_sha,
    fresh_origin_main: merged.fresh_origin_main,
    ancestry: merged.ancestry,
  }, plan, accepted)
  return poll?.kind === 'succeeded' ? { merged: deepFreeze(merged), plan, operation } : null
}

const parseDeployment = (raw, merged, plan, operation) => {
  const deployment = canonicalObject(raw)
  if (!exactKeys(deployment, [
    'schema_version', 'observed_at', 'stack_id', 'repository', 'request_digest', 'operation', 'frozen_vector_digest',
    'stack_result_merge_commit_sha', 'deployment_target_reference', 'command_state', 'deployed_commit_sha',
    'post_deploy_status', 'group_verification_digest',
  ]) || deployment.schema_version !== 'stack-deployment-observation/v1' ||
    !isCanonicalUtcMillisecondTimestamp(deployment.observed_at) || deployment.stack_id !== merged.stack_id ||
    Date.parse(deployment.observed_at) < Date.parse(merged.merged_at) ||
    Date.parse(deployment.observed_at) >= Date.parse(plan.frozen_stack.expires_at) ||
    deployment.repository !== merged.repository || deployment.request_digest !== merged.request_digest ||
    !sameCanonical(deployment.operation, operation) || deployment.frozen_vector_digest !== merged.frozen_vector_digest ||
    deployment.stack_result_merge_commit_sha !== merged.stack_result_merge_commit_sha ||
    deployment.deployment_target_reference !== plan.frozen_stack.deployment_target_reference ||
    !['queued', 'running', 'completed', 'failed', 'cancelled'].includes(deployment.command_state) ||
    !(deployment.deployed_commit_sha === null || isSha(deployment.deployed_commit_sha)) ||
    !['not_started', 'running', 'passed', 'failed', 'unknown'].includes(deployment.post_deploy_status) ||
    !isDigest(deployment.group_verification_digest)) return null
  return deepFreeze(deployment)
}

const deploymentFailure = (merged) => deepFreeze({
  phase: 'CLOSED',
  internal_state: 'STACK_DELIVERY_FAILED',
  admission_state: 'FROZEN',
  stack_id: merged.stack_id,
  repository: merged.repository,
  request_digest: merged.request_digest,
  operation: merged.operation,
  frozen_vector_digest: merged.frozen_vector_digest,
  stack_result_merge_commit_sha: merged.stack_result_merge_commit_sha,
  repair_revert_lineage: {
    source_stack_id: merged.stack_id,
    failed_stack_result_merge_commit_sha: merged.stack_result_merge_commit_sha,
    required_new_exact_head: true,
    allowed_successor_kinds: ['repair', 'revert'],
    physical_rollback_claim: 'none',
  },
})

export function reduceStackDeployment(input = {}) {
  try {
    const value = canonicalObject(input)
    if (!exactKeys(value, ['merged', 'deployment'])) return closed('MERGE_OUTCOME_UNVERIFIED', 'stack_deployment_input_invalid')
    const parsedMerged = parseMerged(value.merged)
    if (parsedMerged === null) return closed('MERGE_OUTCOME_UNVERIFIED', 'stack_deployment_merged_invalid')
    const deployment = parseDeployment(value.deployment, parsedMerged.merged, parsedMerged.plan, parsedMerged.operation)
    if (deployment === null) return closed('MERGE_OUTCOME_UNVERIFIED', 'stack_deployment_observation_invalid')
    if (deployment.command_state === 'completed' && deployment.deployed_commit_sha === parsedMerged.merged.stack_result_merge_commit_sha &&
      deployment.post_deploy_status === 'passed') {
      return deepFreeze({
        phase: 'CLOSED',
        internal_state: 'STACK_DELIVERY_VERIFIED',
        stack_id: parsedMerged.merged.stack_id,
        repository: parsedMerged.merged.repository,
        request_digest: parsedMerged.merged.request_digest,
        operation: parsedMerged.operation,
        stack_result_merge_commit_sha: parsedMerged.merged.stack_result_merge_commit_sha,
        deployed_commit_sha: deployment.deployed_commit_sha,
        group_verification_digest: deployment.group_verification_digest,
      })
    }
    if (deployment.command_state === 'failed' || deployment.post_deploy_status === 'failed') {
      return deploymentFailure(parsedMerged.merged)
    }
    if (deployment.command_state === 'completed' && deployment.post_deploy_status === 'passed') {
      return closed('POLICY_OR_SETTINGS_DRIFT', 'stack_deployment_commit_lineage_drift')
    }
    return closed('MERGE_OUTCOME_UNVERIFIED', 'stack_deployment_outcome_unproven')
  } catch {
    return closed('MERGE_OUTCOME_UNVERIFIED', 'stack_deployment_exception')
  }
}

export function verifyOrdinaryDelivery(input = {}) {
  try {
    const value = canonicalObject(input)
    if (!exactKeys(value, [
      'schema_version', 'observed_at', 'repository', 'pr_number', 'head_sha', 'merge_commit_sha', 'fresh_origin_main',
      'deployed_commit_sha', 'head_reachable', 'head_reachability_digest', 'post_deploy_verified',
      'post_deploy_verification_digest',
    ]) || value.schema_version !== 'ordinary-delivery-observation/v1' ||
      !isCanonicalUtcMillisecondTimestamp(value.observed_at) || !isRepository(value.repository) ||
      !Number.isSafeInteger(value.pr_number) || value.pr_number < 1 || !isSha(value.head_sha) ||
      !isSha(value.merge_commit_sha) || !isSha(value.deployed_commit_sha) || value.head_reachable !== true ||
      !isDigest(value.head_reachability_digest) || typeof value.post_deploy_verified !== 'boolean' ||
      !isDigest(value.post_deploy_verification_digest)) {
      return closed('PREMERGE_EVIDENCE_INVALID', 'ordinary_delivery_input_invalid')
    }
    const fresh = canonicalObject(value.fresh_origin_main)
    if (!exactKeys(fresh, [
      'schema_version', 'observed_at', 'source_reference', 'repository', 'trunk_ref', 'commit_sha', 'authoritative',
    ]) || fresh.schema_version !== 'origin-main-observation/v1' ||
      !isCanonicalUtcMillisecondTimestamp(fresh.observed_at) || !isCanonicalOpaqueReference(fresh.source_reference) ||
      fresh.repository !== value.repository || fresh.trunk_ref !== 'main' || fresh.authoritative !== true ||
      !isSha(fresh.commit_sha) || fresh.observed_at !== value.observed_at) {
      return closed('PREMERGE_EVIDENCE_INVALID', 'ordinary_delivery_fresh_origin_main_invalid')
    }
    if (value.merge_commit_sha !== fresh.commit_sha || value.merge_commit_sha !== value.deployed_commit_sha) {
      return closed('POLICY_OR_SETTINGS_DRIFT', 'ordinary_delivery_commit_lineage_drift')
    }
    if (!value.post_deploy_verified) return closed('MERGE_OUTCOME_UNVERIFIED', 'ordinary_delivery_postverify_unproven')
    return deepFreeze({
      phase: 'CLOSED',
      internal_state: 'ORDINARY_DELIVERY_VERIFIED',
      repository: value.repository,
      pr_number: value.pr_number,
      head_sha: value.head_sha,
      merge_commit_sha: value.merge_commit_sha,
      fresh_origin_main: fresh,
      deployed_commit_sha: value.deployed_commit_sha,
      head_reachability_digest: value.head_reachability_digest,
      post_deploy_verification_digest: value.post_deploy_verification_digest,
    })
  } catch {
    return closed('PREMERGE_EVIDENCE_INVALID', 'ordinary_delivery_exception')
  }
}
