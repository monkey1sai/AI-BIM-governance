import assert from 'node:assert/strict'
import test from 'node:test'

import {
  FABRIC_BINDING_SCHEMA_VERSION,
  buildSpecToDoneFabricBinding,
  deriveFabricBindingRelativePath,
  deriveFabricManagedStateRelativePath,
  validateSpecToDoneFabricBinding,
} from '../../lib/spec-to-done-fabric-binding.mjs'
import { digestCanonical } from '../../lib/parallel-delivery-fabric-contract.mjs'

const SHA1_A = 'a'.repeat(40)
const SHA1_B = 'b'.repeat(40)
const SHA256_A = 'a'.repeat(64)
const SHA256_B = 'b'.repeat(64)
const NOW = '2026-08-31T01:00:00.000Z'
const LATER = '2026-08-31T01:05:00.000Z'

const taskScope = () => ({
  owning_service: 'agent-governance',
  public_entrypoint: '.claude/skills/spec-to-done/SKILL.md',
  resources: [
    { kind: 'glob', pattern: 'scripts/lib/spec-to-done-*.mjs' },
    { kind: 'path', path: 'agent-contracts' },
    { kind: 'shared_contract', resource_key: 'contract:spec-to-done-binding' },
  ],
  expected_tests: ['test:spec-to-done-binding'],
  e2e_required: false,
})

const deliveryPlan = (overrides = {}) => {
  const task = {
    task_id: 'task:binding-one',
    outcome: 'bind-one-delivery-slice',
    provider_preference: 'codex',
    owner_session: 'session:writer-one',
    scope: taskScope(),
    dependencies: [],
    risk: 'bounded',
    e2e_required: false,
    ...overrides.task,
  }
  return {
    schema_version: 'parallel-delivery-fabric/v1',
    plan_id: 'plan:binding-contract',
    generation: 7,
    repo_identity: {
      full_name: 'acme/ai-bim-governance',
      repository_id: 42,
      common_dir_digest: SHA256_A,
    },
    created_at: NOW,
    coordinator_session: 'session:coordinator',
    baseline_ref: 'origin/main',
    resolved_baseline_sha: SHA1_A,
    tasks: [task],
    requested_capacity: { writers: 1, runtime_leases: 0 },
    branch_profile: 'trunk',
    acceptance_criteria: ['criterion:binding-verified'],
    promotion_mode: 'single_pr',
    requested_execution_level: 'implement_local',
    authority_reference: 'authority:binding-plan',
    governance_source_refs: ['openspec:spec-to-done-parallel-delivery-binding'],
    ...overrides.plan,
  }
}

const canonicalScopeResources = () => [
  { kind: 'glob', pattern: 'scripts/lib/spec-to-done-*.mjs' },
  { kind: 'path', path: 'agent-contracts' },
  { kind: 'shared_contract', resource_key: 'contract:spec-to-done-binding' },
]

const providerSession = (overrides = {}) => ({
  schema_version: 'provider-session-envelope/v1',
  plan_id: 'plan:binding-contract',
  generation: 7,
  task_id: 'task:binding-one',
  provider: 'codex',
  owner_session: 'session:writer-one',
  provider_session_id: 'provider-session:binding-one',
  execution_context_id: 'execution-context:binding-one',
  repo_identity_digest: SHA256_A,
  common_dir_digest: SHA256_A,
  worktree_id: 'worktree:binding-one',
  worktree_path_digest: SHA256_B,
  branch: 'codex/feat/binding-one',
  baseline_sha: SHA1_A,
  scope_digest: digestCanonical(canonicalScopeResources()),
  resource_keys: [
    'glob:scripts/lib/spec-to-done-*.mjs',
    'path:agent-contracts',
    'shared_contract:contract:spec-to-done-binding',
  ],
  lease_id: 'lease:binding-one',
  heartbeat_seq: 3,
  heartbeat_state: 'ACTIVE',
  heartbeat_at: NOW,
  context_attestation_ref: 'attestation:binding-one',
  context_attestation_digest: SHA256_B,
  evidence_head_sha: SHA1_B,
  evidence_refs: ['evidence:binding-one'],
  handoff_id: null,
  adapter_version: 'fabric-adapter/v1',
  ...overrides,
})

const stamp = (value) => ({ ...value, canonical_digest: digestCanonical(value) })

const sessionLease = (overrides = {}) => stamp({
  schema_version: 'session-lease/v1',
  generation: 7,
  nonce: 'n'.repeat(32),
  created_at: NOW,
  updated_at: NOW,
  lease_id: 'lease:binding-one',
  lease_kind: 'writer_seat',
  plan_id: 'plan:binding-contract',
  task_id: 'task:binding-one',
  provider: 'codex',
  owner_session: 'session:writer-one',
  provider_session_id: 'provider-session:binding-one',
  execution_context_id: 'execution-context:binding-one',
  context_attestation_ref: 'attestation:binding-one',
  common_dir_digest: SHA256_A,
  worktree_id: 'worktree:binding-one',
  worktree_path_digest: SHA256_B,
  branch: 'codex/feat/binding-one',
  scope_digest: digestCanonical(canonicalScopeResources()),
  head_sha: SHA1_B,
  resource_keys: [
    'glob:scripts/lib/spec-to-done-*.mjs',
    'path:agent-contracts',
    'shared_contract:contract:spec-to-done-binding',
  ],
  state: 'ACTIVE',
  heartbeat_seq: 3,
  heartbeat_at: NOW,
  release_evidence_ref: null,
  retention_state: 'ACTIVE',
  revocation_epoch: 0,
  ...overrides,
})

const build = (overrides = {}) => buildSpecToDoneFabricBinding({
  slug: overrides.slug ?? 'fabric-binding',
  allowed_paths: overrides.allowed_paths ?? [
    'scripts/lib/spec-to-done-fabric-binding.mjs',
    'agent-contracts/spec-to-done-fabric-binding.schema.json',
  ],
  plan: overrides.plan ?? deliveryPlan(),
  lease: overrides.lease ?? sessionLease(),
  provider_session: overrides.provider_session ?? providerSession(),
})

test('binding digest is canonical and independent of allowed-path input order', () => {
  const first = build()
  const second = build({
    allowed_paths: [
      'agent-contracts/spec-to-done-fabric-binding.schema.json',
      'scripts/lib/spec-to-done-fabric-binding.mjs',
    ],
  })

  const identity = {
    schema_version: FABRIC_BINDING_SCHEMA_VERSION,
    slug: first.slug,
    fabric_tuple: {
      plan_id: first.fabric_tuple.plan_id,
      generation: first.fabric_tuple.generation,
      task_id: first.fabric_tuple.task_id,
      lease_id: first.fabric_tuple.lease_id,
      owner_session: first.fabric_tuple.owner_session,
      provider: first.fabric_tuple.provider,
      scope_digest: first.fabric_tuple.scope_digest,
      baseline_sha: first.fabric_tuple.baseline_sha,
      branch: first.fabric_tuple.branch,
      worktree_path_digest: first.fabric_tuple.worktree_path_digest,
    },
    allowed_paths: first.allowed_paths,
  }

  assert.equal(first.binding_id, digestCanonical(identity))
  assert.equal(second.binding_id, first.binding_id)
  assert.deepEqual(second.allowed_paths, first.allowed_paths)
  assert.equal(first.capacity_semantics.session_admission_limit, 'unbounded')
  assert.equal(first.capacity_semantics.run_writer_cardinality, 1)
})

test('same slug with another exact Fabric tuple receives another durable identity', () => {
  const first = build()
  const otherPlan = deliveryPlan({ task: { task_id: 'task:binding-two' } })
  const otherSession = providerSession({
    task_id: 'task:binding-two',
    lease_id: 'lease:binding-two',
    provider_session_id: 'provider-session:binding-two',
    execution_context_id: 'execution-context:binding-two',
    worktree_id: 'worktree:binding-two',
    worktree_path_digest: 'c'.repeat(64),
    branch: 'codex/feat/binding-two',
  })
  const otherLease = sessionLease({
    task_id: 'task:binding-two',
    lease_id: 'lease:binding-two',
    provider_session_id: 'provider-session:binding-two',
    execution_context_id: 'execution-context:binding-two',
    worktree_id: 'worktree:binding-two',
    worktree_path_digest: 'c'.repeat(64),
    branch: 'codex/feat/binding-two',
  })
  const second = build({ plan: otherPlan, lease: otherLease, provider_session: otherSession })

  assert.notEqual(second.binding_id, first.binding_id)
  assert.notEqual(second.state_relative_path, first.state_relative_path)
  assert.equal(first.state_relative_path, deriveFabricManagedStateRelativePath(first.slug, first.binding_id))
  assert.equal(first.binding_relative_path, deriveFabricBindingRelativePath(first.binding_id))
})

test('binding captures the exact immutable Fabric tuple and excludes mutable heartbeat/head observations', () => {
  const first = build()
  const refreshed = build({
    lease: sessionLease({ heartbeat_seq: 4, heartbeat_at: LATER, updated_at: LATER, head_sha: 'c'.repeat(40) }),
    provider_session: providerSession({ heartbeat_seq: 4, heartbeat_at: LATER, evidence_head_sha: 'c'.repeat(40) }),
  })

  assert.deepEqual(first.fabric_tuple, {
    plan_id: 'plan:binding-contract',
    generation: 7,
    task_id: 'task:binding-one',
    lease_id: 'lease:binding-one',
    owner_session: 'session:writer-one',
    provider: 'codex',
    scope_digest: digestCanonical(canonicalScopeResources()),
    baseline_sha: SHA1_A,
    branch: 'codex/feat/binding-one',
    worktree_path_digest: SHA256_B,
  })
  assert.equal(first.lease_state_at_binding, 'ACTIVE')
  assert.equal(refreshed.binding_id, first.binding_id)
  assert.equal(refreshed.state_relative_path, first.state_relative_path)
  assert.deepEqual(refreshed.source_digests, first.source_digests)
})

test('pure validator accepts the binding only with its current exact Fabric sources', () => {
  const plan = deliveryPlan()
  const lease = sessionLease()
  const session = providerSession()
  const binding = build({ plan, lease, provider_session: session })

  const outcome = validateSpecToDoneFabricBinding({
    binding,
    plan,
    lease,
    provider_session: session,
  })

  assert.equal(outcome.status, 'FABRIC_BINDING_ACCEPTED')
  assert.equal(outcome.reason, 'EXACT_FABRIC_TUPLE_BOUND')
  assert.equal(outcome.current_lease_state, 'ACTIVE')
  assert.equal(outcome.held_lease_action, 'retain_as_suspect')
  assert.equal(outcome.binding.binding_id, binding.binding_id)
})

test('allowed paths outside explicit path/glob authority remain scope_drift', () => {
  assert.throws(
    () => build({ allowed_paths: ['docs/outside.md'] }),
    (error) => error?.code === 'scope_drift',
  )

  const sharedOnly = [{ kind: 'shared_contract', resource_key: 'contract:spec-to-done-binding' }]
  const scopeDigest = digestCanonical(sharedOnly)
  const plan = deliveryPlan({
    task: {
      scope: {
        ...taskScope(),
        resources: sharedOnly,
      },
    },
  })
  const resourceKeys = ['shared_contract:contract:spec-to-done-binding']
  const lease = sessionLease({ scope_digest: scopeDigest, resource_keys: resourceKeys })
  const session = providerSession({ scope_digest: scopeDigest, resource_keys: resourceKeys })
  assert.throws(
    () => build({ plan, lease, provider_session: session }),
    (error) => error?.code === 'scope_drift',
  )
})

test('every exact Fabric tuple mismatch fails closed without tuple substitution', () => {
  const cases = [
    ['plan_id', { provider_session: providerSession({ plan_id: 'plan:other' }) }],
    ['generation', { provider_session: providerSession({ generation: 8 }) }],
    ['task_id', { provider_session: providerSession({ task_id: 'task:other' }) }],
    ['lease_id', { provider_session: providerSession({ lease_id: 'lease:other' }) }],
    ['owner_session', { provider_session: providerSession({ owner_session: 'session:other' }) }],
    ['provider', { provider_session: providerSession({ provider: 'claude' }) }],
    ['scope_digest', { provider_session: providerSession({ scope_digest: 'e'.repeat(64) }) }],
    ['baseline_sha', { provider_session: providerSession({ baseline_sha: 'e'.repeat(40) }) }],
    ['branch', { provider_session: providerSession({ branch: 'codex/feat/other' }) }],
    ['worktree_path_digest', { provider_session: providerSession({ worktree_path_digest: 'e'.repeat(64) }) }],
  ]

  for (const [field, overrides] of cases) {
    assert.throws(
      () => build(overrides),
      (error) => error?.code === 'fabric_tuple_drift',
      field,
    )
  }
})

test('binding policy mutation cannot turn control metadata into delivery authority', () => {
  const plan = deliveryPlan()
  const lease = sessionLease()
  const session = providerSession()
  const binding = build({ plan, lease, provider_session: session })
  const hostile = [
    ['writer admission cap', (value) => { value.capacity_semantics.session_admission_limit = 2 }],
    ['multiple writers in one binding', (value) => { value.capacity_semantics.run_writer_cardinality = 2 }],
    ['merge authority', (value) => { value.delivery_authority.merge = true }],
    ['direct stack authority', (value) => { value.delivery_authority.direct_stack = true }],
    ['local resume', (value) => { value.recovery_policy.local_resume_allowed = true }],
  ]

  for (const [label, mutate] of hostile) {
    const forged = structuredClone(binding)
    mutate(forged)
    assert.throws(
      () => validateSpecToDoneFabricBinding({ binding: forged, plan, lease, provider_session: session }),
      (error) => error?.code === 'fabric_binding_invalid',
      label,
    )
  }
})

test('legacy standalone state is not reinterpreted as a Fabric binding', () => {
  assert.throws(
    () => validateSpecToDoneFabricBinding({
      binding: { status: 'IN_PROGRESS', phase: 'P3', slug: 'legacy-run' },
      plan: deliveryPlan(),
      lease: sessionLease(),
      provider_session: providerSession(),
    }),
    (error) => error?.code === 'fabric_binding_invalid',
  )
})

test('a third isolated binding is not rejected by occupied writer count', () => {
  const bindings = ['one', 'two', 'three'].map((suffix, index) => {
    const taskId = `task:binding-${suffix}`
    const leaseId = `lease:binding-${suffix}`
    const ownerSession = `session:writer-${suffix}`
    const providerSessionId = `provider-session:binding-${suffix}`
    const executionContextId = `execution-context:binding-${suffix}`
    const worktreeId = `worktree:binding-${suffix}`
    const worktreePathDigest = String.fromCharCode(98 + index).repeat(64)
    const branch = `codex/feat/binding-${suffix}`
    const plan = deliveryPlan({ task: { task_id: taskId, owner_session: ownerSession } })
    const session = providerSession({
      task_id: taskId,
      lease_id: leaseId,
      owner_session: ownerSession,
      provider_session_id: providerSessionId,
      execution_context_id: executionContextId,
      worktree_id: worktreeId,
      worktree_path_digest: worktreePathDigest,
      branch,
    })
    const lease = sessionLease({
      task_id: taskId,
      lease_id: leaseId,
      owner_session: ownerSession,
      provider_session_id: providerSessionId,
      execution_context_id: executionContextId,
      worktree_id: worktreeId,
      worktree_path_digest: worktreePathDigest,
      branch,
    })
    return build({ plan, lease, provider_session: session })
  })

  assert.equal(new Set(bindings.map((binding) => binding.binding_id)).size, 3)
  assert.ok(bindings.every((binding) => binding.capacity_semantics.session_admission_limit === 'unbounded'))
  assert.ok(bindings.every((binding) => binding.capacity_semantics.run_writer_cardinality === 1))
})

test('a retained SUSPECT lease validates against the immutable ACTIVE binding', () => {
  const plan = deliveryPlan()
  const activeLease = sessionLease()
  const activeSession = providerSession()
  const binding = build({ plan, lease: activeLease, provider_session: activeSession })
  const suspectLease = sessionLease({
    state: 'SUSPECT',
    suspect_at: NOW,
    updated_at: LATER,
    heartbeat_at: LATER,
  })
  const suspectSession = providerSession({ heartbeat_state: 'SUSPECT', heartbeat_at: LATER })

  const outcome = validateSpecToDoneFabricBinding({
    binding,
    plan,
    lease: suspectLease,
    provider_session: suspectSession,
  })
  assert.equal(outcome.current_lease_state, 'SUSPECT')
  assert.equal(outcome.held_lease_action, 'retain_as_suspect')
  assert.equal(outcome.binding.binding_id, binding.binding_id)
})

export {
  build,
  canonicalScopeResources,
  deliveryPlan,
  providerSession,
  sessionLease,
}
