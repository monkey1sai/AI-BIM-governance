import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  dispatchDirectStackMerge,
  planDirectStackDispatch,
  reduceDirectStackDispatch,
  reduceDirectStackPoll,
  reduceStackDeployment,
  verifyOrdinaryDelivery,
} from '../../lib/parallel-delivery-fabric-stack.mjs'
import { digestCanonical, projectExternalTerminal } from '../../lib/parallel-delivery-fabric-contract.mjs'

const sha = (character) => character.repeat(40)
const digest = (character) => character.repeat(64)
const OPERATION_UUID = '123e4567-e89b-42d3-a456-426614174000'

// The frozen vector digest is derived from the members, exactly as the contract recomputes it.
const withVector = (stack) => ({ ...stack, ordered_member_vector_digest: digestCanonical(stack.members) })
const stackEnvelope = () => withVector({
  schema_version: 'stack-delivery-envelope/v1',
  stack_id: 'stack:linear-prefix',
  trunk_ref: 'main',
  trunk_sha: sha('a'),
  selected_top_pr: 12,
  ordered_member_vector_digest: digest('a'),
  merge_action: 'direct_merge',
  merge_method: 'merge',
  members: [
    {
      pr_number: 11,
      node_id: 'prnode:one',
      position: 1,
      head_ref: 'feature-one',
      head_sha: sha('b'),
      direct_base_ref: 'main',
      direct_base_sha: sha('a'),
      exact_head_packet_digest: digest('b'),
      checks_digest: digest('c'),
      independent_review_digest: digest('d'),
      e2e_required: false,
      e2e_result_digest: null,
      unresolved_finding_state: 'none',
    },
    {
      pr_number: 12,
      node_id: 'prnode:two',
      position: 2,
      head_ref: 'feature-two',
      head_sha: sha('c'),
      direct_base_ref: 'feature-one',
      direct_base_sha: sha('b'),
      exact_head_packet_digest: digest('e'),
      checks_digest: digest('f'),
      independent_review_digest: digest('0'),
      e2e_required: true,
      e2e_result_digest: digest('1'),
      unresolved_finding_state: 'none',
    },
  ],
  expected_protection_digest: digest('2'),
  capability_reference: 'capability:direct-stack',
  deployment_target_reference: 'target:linux-canonical',
  created_at: '2026-08-28T12:00:00.000Z',
  expires_at: '2026-08-28T13:00:00.000Z',
})

const directStackObservation = (stack = stackEnvelope()) => ({
  schema_version: 'direct-stack-observation/v1',
  observed_at: '2026-08-28T12:05:00.000Z',
  repository: 'acme/bim',
  trunk_ref: stack.trunk_ref,
  trunk_sha: stack.trunk_sha,
  protection_digest: stack.expected_protection_digest,
  capability_reference: stack.capability_reference,
  capability_state: 'enabled',
  chain: stack.members.map((member) => ({ ...member, repository: 'acme/bim', merged: false })),
})

const operationFor = (plan) => ({
  schema_version: 'direct-stack-operation/v1',
  operation_uuid: OPERATION_UUID,
  operation_reference: 'operation:direct-stack-1',
  stack_id: plan.frozen_stack.stack_id,
  repository: plan.repository,
  request_digest: plan.request_digest,
  expected_state_digest: digestCanonical(plan.request.expected_state),
  ordered_member_vector_digest: plan.frozen_stack.ordered_member_vector_digest,
  expected_head_sha: plan.request.expected_head_sha,
  expected_protection_digest: plan.request.expected_protection_digest,
  capability_reference: plan.request.capability_reference,
})

const acceptedResponse = (plan, status = 202) => ({ status, operation: operationFor(plan) })

const rejectionResponse = (plan, status, overrides = {}) => ({
  status,
  stack_id: plan.frozen_stack.stack_id,
  repository: plan.repository,
  request_digest: plan.request_digest,
  ordered_member_vector_digest: plan.frozen_stack.ordered_member_vector_digest,
  authoritative_zero_member_merged: true,
  deterministic_evidence: status === 400 || status === 422,
  ...overrides,
})

test('AC-16 — direct-stack dispatch freezes a same-repository fully-linear lowest-unmerged prefix', () => {
  const stack = stackEnvelope()
  const planned = planDirectStackDispatch({
    stack,
    repository: 'acme/bim',
    observation: directStackObservation(stack),
  })

  assert.equal(planned.phase, 'READY_TO_MERGE')
  assert.equal(planned.internal_state, 'STACK_REQUEST_READY')
  assert.equal(planned.request.schema_version, 'direct-stack-request/v1')
  assert.equal(planned.request.stack_id, stack.stack_id)
  assert.equal(planned.request.selected_top_pr, 12)
  assert.equal(planned.request.expected_head_sha, sha('c'))
  assert.equal(planned.request.merge_action, 'direct_merge')
  assert.equal(planned.request.merge_method, 'merge')
  assert.deepEqual(planned.request.members.map((member) => member.node_id), ['prnode:one', 'prnode:two'])
  assert.deepEqual(planned.request.cas_precondition, {
    stack_id: stack.stack_id,
    repository: 'acme/bim',
    trunk_sha: sha('a'),
    selected_top_pr: 12,
    expected_head_sha: sha('c'),
    ordered_member_vector_digest: stack.ordered_member_vector_digest,
    expected_protection_digest: digest('2'),
    capability_reference: 'capability:direct-stack',
  })
  assert.equal(Object.isFrozen(planned), true)
})

test('AC-20 — stack planner rejects malformed, non-linear, cross-repository, or drifted batches before a sink sees them', () => {
  const stack = stackEnvelope()
  const malformed = planDirectStackDispatch({ stack: { ...stack, members: [] }, repository: 'acme/bim', observation: {} })
  assert.deepEqual(malformed, {
    phase: 'CLOSED',
    internal_state: 'PREMERGE_EVIDENCE_INVALID',
    reason: 'stack_envelope_invalid',
  })

  const cases = [
    ['head_drift', (observation) => { observation.chain[0].head_sha = sha('d') }],
    ['base_drift', (observation) => { observation.chain[1].direct_base_sha = sha('e') }],
    ['evidence_drift', (observation) => { observation.chain[1].checks_digest = digest('3') }],
    ['cross_repository', (observation) => { observation.chain[1].repository = 'other/repo' }],
    ['non_linear', (observation) => { observation.chain[1].direct_base_sha = stack.trunk_sha }],
  ]
  for (const [name, mutate] of cases) {
    const observation = directStackObservation(stack)
    mutate(observation)
    let calls = 0
    const result = dispatchDirectStackMerge({
      plan: planDirectStackDispatch({ stack, repository: 'acme/bim', observation: directStackObservation(stack) }),
      observation,
      send: () => { calls += 1; return { status: 202, operation_id: 'operation:one' } },
    })
    assert.equal(result.phase, 'CLOSED', name)
    assert.equal(result.internal_state, 'PREMERGE_EVIDENCE_INVALID', name)
    assert.equal(calls, 0, name)
  }

  const sourceStack = stackEnvelope()
  const planned = planDirectStackDispatch({
    stack: sourceStack,
    repository: 'acme/bim',
    observation: directStackObservation(sourceStack),
  })
  sourceStack.members[0].head_sha = sha('f')
  assert.equal(planned.frozen_stack.members[0].head_sha, sha('b'))
})

test('AC-15 — stack planner treats unavailable direct-stack authority as a typed premerge hold', () => {
  const stack = stackEnvelope()
  const observation = directStackObservation(stack)
  observation.capability_state = 'unsupported'
  assert.deepEqual(planDirectStackDispatch({ stack, repository: 'acme/bim', observation }), {
    phase: 'CLOSED',
    internal_state: 'PREMERGE_AUTHORITY_UNAVAILABLE',
    reason: 'direct_stack_capability_unavailable',
  })
})

test('direct-stack planner rejects not-yet-valid and expired stack envelopes', () => {
  for (const [name, observed_at] of [
    ['not-yet-valid', '2026-08-28T11:59:59.999Z'],
    ['expired', '2026-08-28T13:00:00.000Z'],
  ]) {
    const stack = stackEnvelope()
    const observation = { ...directStackObservation(stack), observed_at }
    assert.deepEqual(planDirectStackDispatch({ stack, repository: 'acme/bim', observation }), {
      phase: 'CLOSED',
      internal_state: 'PREMERGE_EVIDENCE_INVALID',
      reason: 'stack_envelope_outside_validity_window',
    }, name)
  }
})

test('Task7B P1-A1 — accepted direct-stack operations bind the frozen request and every identity field', () => {
  const stack = stackEnvelope()
  const plan = planDirectStackDispatch({ stack, repository: 'acme/bim', observation: directStackObservation(stack) })
  const accepted = reduceDirectStackDispatch({ plan, response: acceptedResponse(plan) })
  assert.equal(accepted.phase, 'MERGING')
  assert.equal(accepted.internal_state, 'MERGE_ASYNC_DISPATCHED')
  assert.deepEqual(accepted.operation, operationFor(plan))
  assert.deepEqual(accepted.frozen_stack.members.map((member) => member.node_id), ['prnode:one', 'prnode:two'])

  const substituted = acceptedResponse(plan)
  substituted.operation.expected_head_sha = sha('f')
  assert.equal(
    reduceDirectStackDispatch({ plan, response: substituted }).internal_state,
    'MERGE_OUTCOME_UNVERIFIED',
  )

  const adopted = {
    status: 409,
    operation: operationFor(plan),
    request: structuredClone(plan.request),
    request_digest: plan.request_digest,
  }
  assert.equal(reduceDirectStackDispatch({ plan, response: adopted }).internal_state, 'MERGE_ASYNC_DISPATCHED')
  adopted.request.members[0].node_id = 'prnode:substituted'
  assert.equal(reduceDirectStackDispatch({ plan, response: adopted }).internal_state, 'MERGE_OUTCOME_UNVERIFIED')
})

test('AC-17 — direct-stack dispatch reducer classifies every accepted and rejected HTTP outcome without retrying', () => {
  const stack = stackEnvelope()
  const plan = planDirectStackDispatch({ stack, repository: 'acme/bim', observation: directStackObservation(stack) })

  const accepted = reduceDirectStackDispatch({
    plan,
    response: acceptedResponse(plan),
  })
  assert.equal(accepted.phase, 'MERGING')
  assert.equal(accepted.internal_state, 'MERGE_ASYNC_DISPATCHED')
  assert.deepEqual(accepted.operation, operationFor(plan))
  assert.equal(accepted.frozen_vector_digest, stack.ordered_member_vector_digest)

  const cases = [
    [200, { status: 200, operation: operationFor(plan), request: structuredClone(plan.request), request_digest: plan.request_digest }, 'MERGE_ASYNC_DISPATCHED'],
    [409, { status: 409, operation: operationFor(plan), request: structuredClone(plan.request), request_digest: plan.request_digest }, 'MERGE_ASYNC_DISPATCHED'],
    [200, { status: 200 }, 'MERGE_OUTCOME_UNVERIFIED'],
    [409, { status: 409, operation: operationFor(plan), request: structuredClone(plan.request), request_digest: digest('9') }, 'MERGE_OUTCOME_UNVERIFIED'],
    [400, rejectionResponse(plan, 400), 'PREMERGE_EVIDENCE_INVALID'],
    [422, rejectionResponse(plan, 422), 'PREMERGE_EVIDENCE_INVALID'],
    [403, rejectionResponse(plan, 403), 'PREMERGE_AUTHORITY_UNAVAILABLE'],
    [404, rejectionResponse(plan, 404), 'PREMERGE_AUTHORITY_UNAVAILABLE'],
    [403, rejectionResponse(plan, 403, { authoritative_zero_member_merged: false }), 'MERGE_OUTCOME_UNVERIFIED'],
    [418, {}, 'MERGE_OUTCOME_UNVERIFIED'],
  ]
  for (const [status, response, expected] of cases) {
    const result = reduceDirectStackDispatch({ plan, response: status === 418 ? { status } : response })
    assert.equal(result.internal_state, expected, String(status))
    if (expected !== 'MERGE_ASYNC_DISPATCHED') assert.equal(result.phase, 'CLOSED', String(status))
  }
  assert.equal(reduceDirectStackDispatch({ plan, response: { status: 202, operation: { operation_uuid: 'not-a-uuid' } } }).internal_state, 'MERGE_OUTCOME_UNVERIFIED')
})

const pollBase = (plan, status) => ({
  schema_version: 'direct-stack-poll/v1',
  status,
  observed_at: '2026-08-28T12:10:00.000Z',
  stack_id: plan.frozen_stack.stack_id,
  repository: plan.repository,
  request_digest: plan.request_digest,
  operation: operationFor(plan),
})

const successfulPoll = (plan) => {
  const stack = plan.frozen_stack
  const result = sha('d')
  return {
    ...pollBase(plan, 'succeeded'),
    member_vector_digest: stack.ordered_member_vector_digest,
    members: stack.members.map((member) => ({
      ...member,
      merged: true,
      frozen_head_sha: member.head_sha,
      reported_merge_commit_sha: result,
    })),
    stack_result_merge_commit_sha: result,
    fresh_origin_main: {
      schema_version: 'origin-main-observation/v1',
      observed_at: '2026-08-28T12:10:00.000Z',
      source_reference: 'source:origin-main',
      repository: plan.repository,
      trunk_ref: stack.trunk_ref,
      commit_sha: result,
      authoritative: true,
    },
    ancestry: stack.members.map((member) => ({
      node_id: member.node_id,
      ancestor_sha: member.head_sha,
      descendant_sha: result,
      reachable: true,
      proof_digest: digest('7'),
    })),
  }
}

const deploymentObservation = (merged, overrides = {}) => ({
  schema_version: 'stack-deployment-observation/v1',
  observed_at: '2026-08-28T12:15:00.000Z',
  stack_id: merged.stack_id,
  repository: merged.repository,
  request_digest: merged.request_digest,
  operation: structuredClone(merged.operation),
  frozen_vector_digest: merged.frozen_vector_digest,
  stack_result_merge_commit_sha: merged.stack_result_merge_commit_sha,
  deployment_target_reference: merged.request.deployment_target_reference,
  command_state: 'completed',
  deployed_commit_sha: merged.stack_result_merge_commit_sha,
  post_deploy_status: 'passed',
  group_verification_digest: digest('4'),
  ...overrides,
})

const ordinaryObservation = (overrides = {}) => ({
  schema_version: 'ordinary-delivery-observation/v1',
  observed_at: '2026-08-28T12:20:00.000Z',
  repository: 'acme/bim',
  pr_number: 11,
  head_sha: sha('b'),
  merge_commit_sha: sha('d'),
  fresh_origin_main: {
    schema_version: 'origin-main-observation/v1',
    observed_at: '2026-08-28T12:20:00.000Z',
    source_reference: 'source:origin-main',
    repository: 'acme/bim',
    trunk_ref: 'main',
    commit_sha: sha('d'),
    authoritative: true,
  },
  deployed_commit_sha: sha('d'),
  head_reachable: true,
  head_reachability_digest: digest('8'),
  post_deploy_verified: true,
  post_deploy_verification_digest: digest('9'),
  ...overrides,
})

test('AC-18 — direct-stack poll requires a full frozen vector, final ancestry, and fresh origin/main before deployment', () => {
  const stack = stackEnvelope()
  const plan = planDirectStackDispatch({ stack, repository: 'acme/bim', observation: directStackObservation(stack) })
  const accepted = reduceDirectStackDispatch({ plan, response: acceptedResponse(plan) })
  const pending = reduceDirectStackPoll({ plan, accepted, poll: pollBase(plan, 'pending') })
  assert.equal(pending.phase, 'MERGING')
  assert.equal(pending.internal_state, 'MERGE_ASYNC_PENDING')
  assert.deepEqual(pending.operation, operationFor(plan))
  assert.equal(pending.frozen_vector_digest, stack.ordered_member_vector_digest)

  const merged = reduceDirectStackPoll({ plan, accepted, poll: successfulPoll(plan) })
  assert.equal(merged.phase, 'MERGED')
  assert.equal(merged.internal_state, 'STACK_MERGED_PENDING_DEPLOY')
  assert.equal(merged.stack_id, stack.stack_id)
  assert.equal(merged.stack_result_merge_commit_sha, sha('d'))
  assert.equal(merged.frozen_vector_digest, stack.ordered_member_vector_digest)
  assert.equal(merged.fresh_origin_main.commit_sha, sha('d'))
  assert.doesNotMatch(JSON.stringify(merged), /DELIVERED/u)

  const failureCases = [
    pollBase(plan, 'timeout'),
    pollBase(plan, 'expired'),
    pollBase(plan, 'not_found'),
    pollBase(plan, 'ambiguous'),
    { ...pollBase(plan, 'failed'), authoritative_zero_member_merged: true, policy_or_settings_drift: true },
  ]
  for (const poll of failureCases) {
    const result = reduceDirectStackPoll({ plan, accepted, poll })
    assert.equal(result.phase, 'CLOSED')
    assert.equal(result.internal_state, poll.policy_or_settings_drift ? 'POLICY_OR_SETTINGS_DRIFT' : 'MERGE_OUTCOME_UNVERIFIED')
  }

  const partial = successfulPoll(plan)
  partial.members[1].merged = false
  assert.equal(reduceDirectStackPoll({ plan, accepted, poll: partial }).internal_state, 'MERGE_OUTCOME_UNVERIFIED')
  const wrongFinal = successfulPoll(plan)
  wrongFinal.fresh_origin_main.commit_sha = sha('e')
  assert.equal(reduceDirectStackPoll({ plan, accepted, poll: wrongFinal }).internal_state, 'MERGE_OUTCOME_UNVERIFIED')
  const wrongVector = successfulPoll(plan)
  wrongVector.member_vector_digest = digest('8')
  assert.equal(reduceDirectStackPoll({ plan, accepted, poll: wrongVector }).internal_state, 'MERGE_OUTCOME_UNVERIFIED')
  // A replayed poll observed before the frozen stack was created is not evidence of its merge.
  const stale = successfulPoll(plan)
  stale.observed_at = '2026-08-28T11:59:59.999Z'
  stale.fresh_origin_main.observed_at = stale.observed_at
  const staleResult = reduceDirectStackPoll({ plan, accepted, poll: stale })
  assert.equal(staleResult.internal_state, 'MERGE_OUTCOME_UNVERIFIED')
  assert.doesNotMatch(JSON.stringify(staleResult), /PENDING_DEPLOY/u)
  const stalePending = reduceDirectStackPoll({ plan, accepted, poll: { ...pollBase(plan, 'pending'), observed_at: '2026-08-28T11:00:00.000Z' } })
  assert.equal(stalePending.internal_state, 'MERGE_OUTCOME_UNVERIFIED')
  const expiredSuccess = successfulPoll(plan)
  expiredSuccess.observed_at = stack.expires_at
  expiredSuccess.fresh_origin_main.observed_at = stack.expires_at
  assert.equal(reduceDirectStackPoll({ plan, accepted, poll: expiredSuccess }).internal_state, 'MERGE_OUTCOME_UNVERIFIED')
  const noAncestry = successfulPoll(plan)
  noAncestry.ancestry[0].reachable = false
  assert.equal(reduceDirectStackPoll({ plan, accepted, poll: noAncestry }).internal_state, 'MERGE_OUTCOME_UNVERIFIED')
  assert.equal(reduceDirectStackPoll({
    plan,
    accepted,
    poll: pollBase(plan, 'succeeded'),
  }).internal_state, 'MERGE_OUTCOME_UNVERIFIED')
})

test('AC-19 — direct-stack delivery waits for group deployment and produces repair/revert intent on failure', () => {
  const ordinary = verifyOrdinaryDelivery(ordinaryObservation())
  assert.equal(ordinary.phase, 'CLOSED')
  assert.equal(ordinary.internal_state, 'ORDINARY_DELIVERY_VERIFIED')
  assert.equal(ordinary.pr_number, 11)
  assert.equal(ordinary.merge_commit_sha, sha('d'))
  assert.equal(verifyOrdinaryDelivery(ordinaryObservation({
    fresh_origin_main: { ...ordinaryObservation().fresh_origin_main, commit_sha: sha('e') },
  })).internal_state, 'POLICY_OR_SETTINGS_DRIFT')

  const stack = stackEnvelope()
  const plan = planDirectStackDispatch({ stack, repository: 'acme/bim', observation: directStackObservation(stack) })
  const accepted = reduceDirectStackDispatch({ plan, response: acceptedResponse(plan) })
  const merged = reduceDirectStackPoll({ plan, accepted, poll: successfulPoll(plan) })
  const delivered = reduceStackDeployment({
    merged,
    deployment: deploymentObservation(merged),
  })
  assert.equal(delivered.phase, 'CLOSED')
  assert.equal(delivered.internal_state, 'STACK_DELIVERY_VERIFIED')

  const predatesMerge = reduceStackDeployment({
    merged,
    deployment: deploymentObservation(merged, { observed_at: '2026-08-28T12:00:00.000Z' }),
  })
  assert.equal(predatesMerge.internal_state, 'MERGE_OUTCOME_UNVERIFIED')

  const afterEnvelopeExpiry = reduceStackDeployment({
    merged,
    deployment: deploymentObservation(merged, { observed_at: stack.expires_at }),
  })
  assert.equal(afterEnvelopeExpiry.internal_state, 'MERGE_OUTCOME_UNVERIFIED')

  const failed = reduceStackDeployment({
    merged,
    deployment: deploymentObservation(merged, {
      command_state: 'failed',
      deployed_commit_sha: null,
      post_deploy_status: 'not_started',
      group_verification_digest: digest('5'),
    }),
  })
  assert.equal(failed.phase, 'CLOSED')
  assert.equal(failed.internal_state, 'STACK_DELIVERY_FAILED')
  assert.equal(failed.admission_state, 'FROZEN')
  assert.equal(failed.stack_id, stack.stack_id)
  assert.equal(failed.stack_result_merge_commit_sha, sha('d'))
  assert.deepEqual(failed.repair_revert_lineage, {
    source_stack_id: stack.stack_id,
    failed_stack_result_merge_commit_sha: sha('d'),
    required_new_exact_head: true,
    allowed_successor_kinds: ['repair', 'revert'],
    physical_rollback_claim: 'none',
  })
  assert.equal(reduceStackDeployment({ merged, deployment: {} }).internal_state, 'MERGE_OUTCOME_UNVERIFIED')
})

test('AC-32 — ordinary and direct-stack paths preserve their distinct complete commit lineage', () => {
  const ordinary = verifyOrdinaryDelivery(ordinaryObservation())
  assert.equal(ordinary.internal_state, 'ORDINARY_DELIVERY_VERIFIED')

  const stack = stackEnvelope()
  const plan = planDirectStackDispatch({ stack, repository: 'acme/bim', observation: directStackObservation(stack) })
  const accepted = reduceDirectStackDispatch({ plan, response: acceptedResponse(plan) })
  const merged = reduceDirectStackPoll({ plan, accepted, poll: successfulPoll(plan) })
  assert.equal(merged.stack_result_merge_commit_sha, sha('d'))
  const delivered = reduceStackDeployment({
    merged,
    deployment: deploymentObservation(merged, { group_verification_digest: digest('6') }),
  })
  assert.equal(delivered.deployed_commit_sha, sha('d'))
})

test('Task7B P1-A2 — closed parser boundaries convert malformed, extra, private, and throwing inputs into typed holds', () => {
  const stack = stackEnvelope()
  const plan = planDirectStackDispatch({ stack, repository: 'acme/bim', observation: directStackObservation(stack) })
  const accepted = reduceDirectStackDispatch({ plan, response: acceptedResponse(plan) })
  const merged = reduceDirectStackPoll({ plan, accepted, poll: successfulPoll(plan) })
  const cases = [
    () => planDirectStackDispatch({ stack, repository: 'acme/bim', observation: { ...directStackObservation(stack), token: 'redacted' } }),
    () => planDirectStackDispatch({ stack, repository: 'acme/bim', observation: directStackObservation(stack), unexpected: true }),
    () => reduceDirectStackDispatch({ plan, response: { ...acceptedResponse(plan), authorization: 'redacted' } }),
    () => reduceDirectStackPoll({ plan, accepted, poll: { ...successfulPoll(plan), absolute_path: 'redacted' } }),
    () => reduceStackDeployment({ merged: { ...merged, unexpected: true }, deployment: deploymentObservation(merged) }),
    () => reduceStackDeployment({ merged, deployment: { ...deploymentObservation(merged), token: 'redacted' } }),
    () => verifyOrdinaryDelivery({ ...ordinaryObservation(), environment: 'redacted' }),
  ]
  for (const reduce of cases) {
    let outcome
    assert.doesNotThrow(() => { outcome = reduce() })
    assert.equal(outcome.phase, 'CLOSED')
    assert.match(outcome.internal_state, /^(?:PREMERGE_EVIDENCE_INVALID|MERGE_OUTCOME_UNVERIFIED)$/u)
  }

  const throwing = {}
  Object.defineProperty(throwing, 'stack', { enumerable: true, get: () => { throw new Error('hostile getter') } })
  Object.defineProperties(throwing, {
    repository: { enumerable: true, value: 'acme/bim' },
    observation: { enumerable: true, value: directStackObservation(stack) },
  })
  assert.doesNotThrow(() => planDirectStackDispatch(throwing))
  assert.equal(planDirectStackDispatch(throwing).internal_state, 'PREMERGE_EVIDENCE_INVALID')

  const delivered = reduceStackDeployment({ merged, deployment: deploymentObservation(merged) })
  assert.throws(() => projectExternalTerminal(delivered))
  assert.throws(() => projectExternalTerminal({ internal_state: delivered.internal_state, stack_id: delivered.stack_id }))
})

test('AC-42 — stack keeps only typed internal outcomes and omits retired terminal vocabulary', async () => {
  const moduleSource = await readFile(new URL('../../lib/parallel-delivery-fabric-stack.mjs', import.meta.url), 'utf8')
  assert.doesNotMatch(moduleSource, /(?:terminal_class|DEPLOYMENT_BLOCKED|ACTIVATION_UNATTESTED)/u)
  const stack = stackEnvelope()
  const plan = planDirectStackDispatch({ stack, repository: 'acme/bim', observation: directStackObservation(stack) })
  const held = reduceDirectStackDispatch({ plan, response: { status: 403, authoritative_zero_member_merged: true } })
  assert.equal(held.phase, 'CLOSED')
  assert.equal(Object.hasOwn(held, 'terminal_class'), false)
})

test('Task7B P1-A0 — stack rejects member drift and keeps the Phase 0 merge sink inert', () => {
  const stack = stackEnvelope()
  const plan = planDirectStackDispatch({ stack, repository: 'acme/bim', observation: directStackObservation(stack) })
  const nodeDrift = directStackObservation(stack)
  nodeDrift.chain[0].node_id = 'prnode:substituted'
  let sent = null
  const drifted = dispatchDirectStackMerge({
    plan,
    observation: nodeDrift,
    send: (packet) => {
      sent = packet
      return { status: 202, operation_uuid: OPERATION_UUID }
    },
  })
  assert.equal(drifted.internal_state, 'PREMERGE_EVIDENCE_INVALID')
  assert.equal(sent, null)

  const dispatch = dispatchDirectStackMerge({
    plan,
    observation: directStackObservation(stack),
    send: (packet) => {
      sent = packet
      return { status: 202, operation_uuid: OPERATION_UUID }
    },
  })
  assert.deepEqual(dispatch, {
    phase: 'CLOSED',
    internal_state: 'PREMERGE_AUTHORITY_UNAVAILABLE',
    reason: 'direct_stack_activation_held',
  })
  assert.equal(sent, null)

  let asyncCalls = 0
  const asyncDispatch = dispatchDirectStackMerge({
    plan,
    observation: directStackObservation(stack),
    send: async () => { asyncCalls += 1; return { status: 202 } },
  })
  assert.equal(asyncDispatch.internal_state, 'PREMERGE_AUTHORITY_UNAVAILABLE')
  assert.equal(asyncCalls, 0)
})
