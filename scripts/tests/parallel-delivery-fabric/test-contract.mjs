import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  FABRIC_SCHEMA_VERSION,
  canonicalize,
  digestCanonical,
  isCanonicalNonce,
  isCanonicalOpaqueId,
  isCanonicalOpaqueReference,
  isCanonicalUtcMillisecondTimestamp,
  normalizeScopeResource,
  parseDeliveryPlan,
  parseExecutionEnvelope,
  parseProviderSessionEnvelope,
  parseStackDeliveryEnvelope,
  projectExternalTerminal,
} from '../../lib/parallel-delivery-fabric-contract.mjs'

const SHA1 = 'a'.repeat(40)
const SHA1_B = 'b'.repeat(40)
const SHA256 = 'c'.repeat(64)
const SHA256_B = 'd'.repeat(64)
const NOW = '2026-08-28T12:00:00.000Z'
const LATER = '2026-08-28T13:00:00.000Z'

test('RED round8: canonical UTC-millisecond timestamps reject normalized dates and noncanonical forms', () => {
  assert.equal(isCanonicalUtcMillisecondTimestamp('2028-02-29T12:34:56.789Z'), true)
  for (const value of [
    '2026-02-31T00:00:00.000Z',
    '2028-02-29T12:34:56Z',
    '2028-02-29T12:34:56.789+00:00',
    '2028-02-29T12:34:56.789+08:00',
  ]) assert.equal(isCanonicalUtcMillisecondTimestamp(value), false, value)
})

test('round10: exported canonical opaque and nonce predicates retain Task2 boundaries and privacy gates', () => {
  assert.equal(isCanonicalOpaqueId('abc'), true)
  assert.equal(isCanonicalOpaqueId('ab'), false)
  assert.equal(isCanonicalOpaqueId('a'.repeat(128)), true)
  assert.equal(isCanonicalOpaqueId('a'.repeat(129)), false)
  assert.equal(isCanonicalOpaqueReference('a:'), false)
  assert.equal(isCanonicalOpaqueReference('a:b'), true)
  assert.equal(isCanonicalOpaqueReference(`a:${'b'.repeat(119)}`), true)
  assert.equal(isCanonicalOpaqueReference(`a:${'b'.repeat(126)}`), false)
  assert.equal(isCanonicalOpaqueReference(`a:${'b'.repeat(127)}`), false)
  assert.equal(isCanonicalOpaqueReference('lease:writer-one'), true)
  assert.equal(isCanonicalOpaqueReference('opaque-id'), false)
  assert.equal(isCanonicalNonce('n'.repeat(32)), true)
  assert.equal(isCanonicalNonce('n'.repeat(31)), false)
  assert.equal(isCanonicalNonce('n'.repeat(128)), true)
  assert.equal(isCanonicalNonce('n'.repeat(129)), false)
  for (const value of ['opaque:S-1-5-21-1234-5678-9012-3456', 'opaque:123', 'token'.padEnd(32, 'x')]) {
    assert.equal(isCanonicalOpaqueId(value), false, value)
    assert.equal(isCanonicalNonce(value), false, value)
  }
})

const scope = () => ({
  owning_service: 'delivery-fabric',
  public_entrypoint: 'scripts/lib/parallel-delivery-fabric-contract.mjs',
  resources: [
    { kind: 'path', path: 'Scripts/Contracts/Plan.json' },
    { kind: 'glob', pattern: 'scripts/tests/**/*.mjs' },
    { kind: 'rename', old_path: 'docs/old.md', new_path: 'docs/new.md' },
    { kind: 'shared_contract', resource_key: 'contract:delivery-plan' },
  ],
  expected_tests: ['test:contract'],
  e2e_required: false,
})

const plan = () => ({
  schema_version: FABRIC_SCHEMA_VERSION,
  plan_id: 'plan:contract',
  generation: 1,
  repo_identity: {
    full_name: 'acme/bim',
    repository_id: 1,
    common_dir_digest: SHA256,
  },
  created_at: NOW,
  coordinator_session: 'session:coordinator',
  baseline_ref: 'origin/main',
  resolved_baseline_sha: SHA1,
  tasks: [{
    task_id: 'task:contract',
    outcome: 'closed-contract',
    provider_preference: 'codex',
    owner_session: 'session:writer',
    scope: scope(),
    dependencies: [],
    risk: 'bounded',
    e2e_required: false,
  }],
  requested_capacity: { writers: 1, runtime_leases: 3 },
  branch_profile: 'trunk',
  acceptance_criteria: ['criterion:closed-schema'],
  promotion_mode: 'single_pr',
  requested_execution_level: 'plan_only',
  authority_reference: 'authority:plan',
  governance_source_refs: ['openspec:parallel-delivery-fabric'],
})

const providerSession = () => ({
  schema_version: 'provider-session-envelope/v1',
  plan_id: 'plan:contract',
  generation: 1,
  task_id: 'task:contract',
  provider: 'codex',
  owner_session: 'session:writer',
  provider_session_id: 'provider-session:one',
  execution_context_id: 'execution-context:one',
  repo_identity_digest: SHA256,
  common_dir_digest: SHA256_B,
  worktree_id: 'worktree:one',
  worktree_path_digest: SHA256,
  branch: 'codex/task-contract',
  baseline_sha: SHA1,
  scope_digest: SHA256_B,
  resource_keys: ['path:scripts/contracts/plan.json', 'contract:delivery-plan'],
  lease_id: 'lease:writer-one',
  heartbeat_seq: 1,
  heartbeat_state: 'ACTIVE',
  heartbeat_at: NOW,
  context_attestation_ref: 'attestation:context-one',
  context_attestation_digest: SHA256,
  evidence_head_sha: SHA1_B,
  evidence_refs: ['evidence:head-one'],
  handoff_id: null,
  adapter_version: 'fabric-adapter/v1',
})

const executionEnvelope = () => ({
  schema_version: 'execution-envelope/v1',
  envelope_id: 'envelope:one',
  plan_id: 'plan:contract',
  generation: 1,
  task_id: 'task:contract',
  owner_session: 'session:writer',
  provider: 'codex',
  provider_session_id: 'provider-session:one',
  execution_context_id: 'execution-context:one',
  context_attestation_digest: SHA256,
  issuer_id: 'issuer:control-plane',
  issuer_version: 'fabric-control-plane/v1',
  authority_reference: 'authority:plan',
  authority_digest: SHA256_B,
  issued_at: NOW,
  expires_at: LATER,
  revocation_epoch: 0,
  command_nonce: 'n'.repeat(32),
  authorized_highest_level: 'submit_delivery',
  current_level: 'plan_only',
  transition_sequence: 0,
  expected_previous_envelope_oid: '0'.repeat(40),
  expected_lease_registry_oid: '0'.repeat(40),
  repo_identity_digest: SHA256,
  common_dir_digest: SHA256_B,
  worktree_id: null,
  worktree_path_digest: null,
  branch: null,
  baseline_sha: SHA1,
  head_sha: null,
  scope_digest: SHA256_B,
  lease_id: null,
  allowed_remote: 'origin',
  allowed_repository: 'acme/bim',
  allowed_base: 'origin/main',
  expected_remote_ref: null,
  expected_remote_sha: null,
  promotion_mode: 'single_pr',
  external_capability_reference: null,
  side_effect_class: 'CONTROL_METADATA',
})

const withVector = (value) => ({ ...value, ordered_member_vector_digest: digestCanonical(value.members) })
const stack = () => withVector({
  schema_version: 'stack-delivery-envelope/v1',
  stack_id: 'stack:one',
  trunk_ref: 'origin/main',
  trunk_sha: SHA1,
  selected_top_pr: 42,
  ordered_member_vector_digest: SHA256,
  merge_action: 'direct_merge',
  merge_method: 'merge',
  members: [{
    pr_number: 42,
    node_id: 'node:pr-42',
    position: 1,
    head_ref: 'codex/task-contract',
    head_sha: SHA1_B,
    direct_base_ref: 'origin/main',
    direct_base_sha: SHA1,
    exact_head_packet_digest: SHA256_B,
    checks_digest: SHA256,
    independent_review_digest: SHA256_B,
    e2e_required: false,
    e2e_result_digest: null,
    unresolved_finding_state: 'none',
  }],
  expected_protection_digest: SHA256,
  capability_reference: 'capability:stack-v1',
  deployment_target_reference: 'target:canonical-test',
  created_at: NOW,
  expires_at: LATER,
})

function expectCode(code, callback) {
  assert.throws(callback, (error) => error?.code === code)
}

test('P2 regression — provider-session resource keys admit every contract-valid plan path and negated glob classes', async () => {
  const longPath = (root, length) => {
    let path = root
    for (let index = 0; path.length < length; index += 1) path += `/dir${index}`
    return path.slice(0, length - 2) + 'ab'
  }
  const keys = [`path:${longPath('src', 512)}`, `glob:${longPath('lib', 500)}/**/*.mjs`, `rename:${longPath('old', 512)}:${longPath('new', 512)}`, 'glob:src/[!a].mjs', 'glob:src/[^a].mjs']
  const session = parseProviderSessionEnvelope({ ...providerSession(), resource_keys: keys })
  assert.deepEqual(session.resource_keys, keys)
  expectCode('invalid_value', () => parseProviderSessionEnvelope({ ...providerSession(), resource_keys: [`path:${longPath('src', 513)}`] }))
  const schema = JSON.parse(await readFile(new URL('../../../agent-contracts/parallel-delivery-fabric.schema.json', import.meta.url), 'utf8'))
  const definition = schema.$defs.resource_key.allOf.find((entry) => typeof entry.pattern === 'string')
  const pattern = new RegExp(definition.pattern, 'u')
  assert.equal(definition.maxLength, 1032)
  for (const key of keys) assert.equal(pattern.test(key) && key.length <= definition.maxLength, true, key)
  assert.equal(pattern.test('glob:src/[!a]/../x.mjs'), true)
  assert.equal(pattern.test('Path:src/a.mjs'), false)
})

test('schema exposes every closed Fabric durable definition', async () => {
  const schema = JSON.parse(await readFile(new URL('../../../agent-contracts/parallel-delivery-fabric.schema.json', import.meta.url), 'utf8'))
  assert.equal(schema.$id, 'parallel-delivery-fabric.schema.json')
  assert.equal(schema.additionalProperties, false)
  for (const name of [
    'plan', 'lease', 'provider_session', 'candidate', 'managed_branch', 'stack',
    'train', 'execution_envelope', 'queue_observation', 'handoff', 'reclaim_intent',
    'owner_end_release', 'e2e_manifest', 'activation_record',
  ]) {
    assert.equal(schema.$defs[name].type, 'object', name)
    assert.equal(schema.$defs[name].additionalProperties, false, name)
  }
})

test('schema centralizes nullable opaque identities and references', async () => {
  const schema = JSON.parse(await readFile(new URL('../../../agent-contracts/parallel-delivery-fabric.schema.json', import.meta.url), 'utf8'))
  const properties = schema.$defs.execution_envelope.properties
  for (const [field, definition] of [
    ['worktree_id', 'nullable_opaque_reference'],
    ['lease_id', 'nullable_opaque_reference'],
    ['external_capability_reference', 'nullable_opaque_reference'],
    ['branch', 'nullable_opaque_id'],
    ['expected_remote_ref', 'nullable_opaque_id'],
    ['worktree_path_digest', 'nullable_sha256'],
    ['head_sha', 'nullable_sha1'],
    ['expected_remote_sha', 'nullable_sha1'],
  ]) {
    assert.deepEqual(properties[field], { $ref: `#/$defs/${definition}` }, field)
  }
  assert.deepEqual(
    schema.$defs.lease.properties.release_evidence_ref,
    { $ref: '#/$defs/nullable_opaque_reference' },
  )
})

test('canonicalization sorts keys without mutation and hashes canonical JSON', () => {
  const value = { z: [3, { b: true, a: 'x' }], a: 1 }
  const normalized = canonicalize(value)
  assert.deepEqual(normalized, { a: 1, z: [3, { a: 'x', b: true }] })
  assert.deepEqual(value, { z: [3, { b: true, a: 'x' }], a: 1 })
  const canonical = JSON.stringify(normalized)
  assert.equal(digestCanonical(value), createHash('sha256').update(canonical).digest('hex'))
  expectCode('non_ijson_value', () => canonicalize({ bad: Number.NaN }))
  expectCode('non_ijson_value', () => canonicalize({ bad: '\ud800' }))
  expectCode('non_ijson_value', () => canonicalize({ __proto__: { polluted: true } }))
  // A sparse array would serialize its holes as null and share a digest with [null].
  expectCode('non_ijson_value', () => canonicalize(Array(1)))
  expectCode('non_ijson_value', () => digestCanonical({ list: [1, , 3] }))
  assert.equal(typeof digestCanonical([null]), 'string')
})

test('scope resources fold Windows paths, preserve POSIX case, and retain shared keys', () => {
  assert.deepEqual(normalizeScopeResource({ kind: 'path', path: 'Src\\Contracts\\Plan.json' }), {
    kind: 'path', path: 'src/contracts/plan.json',
  })
  assert.deepEqual(normalizeScopeResource({ kind: 'rename', old_path: 'Src\\Old.ts', new_path: 'src\\New.ts' }), {
    kind: 'rename', old_path: 'src/old.ts', new_path: 'src/new.ts',
  })
  assert.deepEqual(normalizeScopeResource({ kind: 'path', path: 'src/Foo.mjs' }), {
    kind: 'path', path: 'src/Foo.mjs',
  })
  assert.notDeepEqual(
    normalizeScopeResource({ kind: 'path', path: 'src/Foo.mjs' }),
    normalizeScopeResource({ kind: 'path', path: 'src/foo.mjs' }),
  )
  assert.deepEqual(normalizeScopeResource({ kind: 'shared_contract', resource_key: 'contract:Delivery-Plan' }), {
    kind: 'shared_contract', resource_key: 'contract:delivery-plan',
  })
  expectCode('ambiguous_path', () => normalizeScopeResource({ kind: 'path', path: '..\\secret.txt' }))
  expectCode('invalid_shape', () => normalizeScopeResource({ kind: 'path', path: 'src/a', extra: true }))
})

test('delivery plans are versioned, exact-key, bounded, and privacy-safe', () => {
  assert.equal(parseDeliveryPlan(plan()).plan_id, 'plan:contract')
  const unknown = plan()
  unknown.unexpected = true
  expectCode('invalid_shape', () => parseDeliveryPlan(unknown))
  const badSha = plan()
  badSha.resolved_baseline_sha = SHA1.toUpperCase()
  expectCode('invalid_value', () => parseDeliveryPlan(badSha))
  const badTimestamp = plan()
  badTimestamp.created_at = '2026-08-28 12:00:00Z'
  expectCode('invalid_value', () => parseDeliveryPlan(badTimestamp))
  const secret = plan()
  secret.tasks[0].scope.raw_token = 'Bearer do-not-store'
  expectCode('secret_material_detected', () => parseDeliveryPlan(secret))
  const broad = plan()
  broad.tasks[0].scope.resources[0].path = 'C:\\Users\\jacks\\secret.txt'
  expectCode('ambiguous_path', () => parseDeliveryPlan(broad))

  const invalidOpaqueId = plan()
  invalidOpaqueId.plan_id = 'plan with spaces'
  expectCode('invalid_value', () => parseDeliveryPlan(invalidOpaqueId))

  const threeWriters = plan()
  threeWriters.tasks = [
    { ...structuredClone(threeWriters.tasks[0]), task_id: 'task:one', dependencies: [] },
    { ...structuredClone(threeWriters.tasks[0]), task_id: 'task:two', dependencies: ['task:one'] },
    { ...structuredClone(threeWriters.tasks[0]), task_id: 'task:three', dependencies: ['task:two'] },
  ]
  threeWriters.requested_capacity.writers = 3
  assert.equal(parseDeliveryPlan(threeWriters).requested_capacity.writers, 3)

  const overTaskCount = structuredClone(threeWriters)
  overTaskCount.requested_capacity.writers = 4
  expectCode('invalid_value', () => parseDeliveryPlan(overTaskCount))

  const missingDependency = structuredClone(threeWriters)
  missingDependency.tasks[1].dependencies = ['task:missing']
  expectCode('invalid_value', () => parseDeliveryPlan(missingDependency))

  const selfDependency = structuredClone(threeWriters)
  selfDependency.tasks[0].dependencies = ['task:one']
  expectCode('invalid_value', () => parseDeliveryPlan(selfDependency))

  const cyclic = structuredClone(threeWriters)
  cyclic.tasks[0].dependencies = ['task:three']
  expectCode('invalid_value', () => parseDeliveryPlan(cyclic))
})

test('all prohibited credential, host-identity, and transcript fields fail closed recursively', () => {
  for (const [field, value] of [
    ['raw_token', 'Bearer do-not-store'],
    ['cookie', 'session=do-not-store'],
    ['authorization', 'Bearer do-not-store'],
    ['private_key', 'do-not-store'],
    ['raw_sid', 'S-1-5-21-do-not-store'],
    ['pid', 1234],
    ['transcript', 'do-not-store'],
    ['env', { EXAMPLE: 'do-not-store' }],
    ['rawEnv', { EXAMPLE: 'do-not-store' }],
    ['privateKey', 'do-not-store'],
  ]) {
    const unsafe = plan()
    unsafe.tasks[0].scope[field] = value
    expectCode('secret_material_detected', () => parseDeliveryPlan(unsafe))
  }
})

test('permitted durable references reject raw Windows SID and bare PID values', () => {
  assert.equal(parseProviderSessionEnvelope(providerSession()).owner_session, 'session:writer')

  const fixtures = [
    ['owner_session', 'S-1-5-21-4242'],
    ['provider_session_id', '4242'],
    ['execution_context_id', 'S-1-5-21-4242'],
    ['context_attestation_ref', '4242'],
  ]
  for (const [field, value] of fixtures) {
    const unsafe = providerSession()
    unsafe[field] = value
    expectCode(/s-1-5-21-/iu.test(value) ? 'secret_material_detected' : 'invalid_value', () => parseProviderSessionEnvelope(unsafe))
  }

  const rawEvidenceRef = providerSession()
  rawEvidenceRef.evidence_refs = ['S-1-5-21-4242']
  expectCode('secret_material_detected', () => parseProviderSessionEnvelope(rawEvidenceRef))
})

test('opaque references reject namespaced raw SID and terminal PID payloads without rejecting numeric path directories', () => {
  for (const [field, value] of [
    ['authority_reference', 'authority:s-1-5-21-4242'],
    ['coordinator_session', 'session:4242'],
  ]) {
    const unsafe = plan()
    unsafe[field] = value
    expectCode(/s-1-5-21-/iu.test(value) ? 'secret_material_detected' : 'invalid_value', () => parseDeliveryPlan(unsafe))
  }

  for (const value of ['contract:s-1-5-21-4242', 'contract:4242']) {
    const unsafe = plan()
    unsafe.tasks[0].scope.resources = [{ kind: 'shared_contract', resource_key: value }]
    expectCode(/s-1-5-21-/iu.test(value) ? 'secret_material_detected' : 'invalid_value', () => parseDeliveryPlan(unsafe))
  }

  for (const [field, value] of [
    ['worktree_id', 'worktree:s-1-5-21-4242'],
    ['lease_id', 'lease:4242'],
    ['external_capability_reference', 'capability:s-1-5-21-4242'],
  ]) {
    const unsafe = executionEnvelope()
    unsafe.current_level = 'implement_local'
    unsafe.transition_sequence = 1
    unsafe[field] = value
    expectCode(/s-1-5-21-/iu.test(value) ? 'secret_material_detected' : 'invalid_value', () => parseExecutionEnvelope(unsafe))
  }

  assert.deepEqual(
    normalizeScopeResource({ kind: 'shared_contract', resource_key: 'contract:src/2026/plan' }),
    { kind: 'shared_contract', resource_key: 'contract:src/2026/plan' },
  )
})

test('secret markers embedded in otherwise legal string values fail closed recursively', () => {
  const planAuthority = plan()
  planAuthority.authority_reference = 'authority:ghp_abcdefghijklmno'
  expectCode('secret_material_detected', () => parseDeliveryPlan(planAuthority))

  const planScopeResource = plan()
  planScopeResource.tasks[0].scope.resources = [{ kind: 'shared_contract', resource_key: 'contract:token-marker' }]
  expectCode('secret_material_detected', () => parseDeliveryPlan(planScopeResource))

  const planCookie = plan()
  planCookie.coordinator_session = 'session:cookie-marker'
  expectCode('secret_material_detected', () => parseDeliveryPlan(planCookie))

  const providerEvidence = providerSession()
  providerEvidence.evidence_refs = ['evidence:github_pat_abcdefghijklmno']
  expectCode('secret_material_detected', () => parseProviderSessionEnvelope(providerEvidence))

  const providerPrivateKey = providerSession()
  providerPrivateKey.evidence_refs = ['evidence:private-key-marker']
  expectCode('secret_material_detected', () => parseProviderSessionEnvelope(providerPrivateKey))

  const providerAttestation = providerSession()
  providerAttestation.context_attestation_ref = 'attestation:eyJabcdefghijklmno'
  expectCode('secret_material_detected', () => parseProviderSessionEnvelope(providerAttestation))

  const executionAuthority = executionEnvelope()
  executionAuthority.authority_reference = 'authority:authorization-marker'
  expectCode('secret_material_detected', () => parseExecutionEnvelope(executionAuthority))
})

test('secret marker detection aligns with schema for bare bearer without rejecting near words', () => {
  const bareBearer = executionEnvelope()
  bareBearer.authority_reference = 'authority:bearer'
  expectCode('secret_material_detected', () => parseExecutionEnvelope(bareBearer))

  const normalNearWord = executionEnvelope()
  normalNearWord.authority_reference = 'authority:bearing'
  assert.equal(parseExecutionEnvelope(normalNearWord).authority_reference, 'authority:bearing')
})

test('scope paths apply NFC while preserving POSIX case and folding Windows case', () => {
  const composed = 'src/caf\u00e9.mjs'
  const decomposed = 'src/cafe\u0301.mjs'
  assert.deepEqual(
    normalizeScopeResource({ kind: 'path', path: decomposed }),
    normalizeScopeResource({ kind: 'path', path: composed }),
  )
  assert.deepEqual(
    normalizeScopeResource({ kind: 'rename', old_path: decomposed.replaceAll('/', '\\'), new_path: `src\\${'CAFE\u0301'}.mjs` }),
    { kind: 'rename', old_path: composed, new_path: composed },
  )
  assert.notDeepEqual(
    normalizeScopeResource({ kind: 'path', path: 'src/Caf\u00e9.mjs' }),
    normalizeScopeResource({ kind: 'path', path: composed }),
  )

  const normalizedPlan = plan()
  normalizedPlan.tasks[0].scope.public_entrypoint = decomposed
  normalizedPlan.tasks[0].scope.resources = [{ kind: 'glob', pattern: 'src/cafe\u0301/**/*.mjs' }]
  const parsed = parseDeliveryPlan(normalizedPlan)
  assert.equal(parsed.tasks[0].scope.public_entrypoint, composed)
  assert.equal(parsed.tasks[0].scope.resources[0].pattern, 'src/caf\u00e9/**/*.mjs')

  const colliding = plan()
  colliding.tasks[0].scope.resources = [
    { kind: 'path', path: composed },
    { kind: 'path', path: decomposed },
  ]
  expectCode('invalid_value', () => parseDeliveryPlan(colliding))
})

test('provider-session envelope keeps identity opaque and keys closed', () => {
  assert.equal(parseProviderSessionEnvelope(providerSession()).provider, 'codex')
  const badProvider = providerSession()
  badProvider.provider = 'nested-agent'
  expectCode('invalid_value', () => parseProviderSessionEnvelope(badProvider))
  const rawPid = providerSession()
  rawPid.process_id = 1234
  expectCode('secret_material_detected', () => parseProviderSessionEnvelope(rawPid))
  const badTimestamp = providerSession()
  badTimestamp.heartbeat_at = '2026-08-28T12:00:00Z'
  expectCode('invalid_value', () => parseProviderSessionEnvelope(badTimestamp))
})

test('execution envelopes enforce adjacent levels and closed side-effect taxonomy', () => {
  assert.equal(parseExecutionEnvelope(executionEnvelope()).side_effect_class, 'CONTROL_METADATA')
  const badClass = executionEnvelope()
  badClass.side_effect_class = 'UNKNOWN'
  expectCode('invalid_value', () => parseExecutionEnvelope(badClass))
  const selfIssued = executionEnvelope()
  selfIssued.issuer_id = selfIssued.owner_session
  expectCode('invalid_value', () => parseExecutionEnvelope(selfIssued))
  const jump = executionEnvelope()
  jump.current_level = 'submit_delivery'
  jump.authorized_highest_level = 'submit_delivery'
  expectCode('invalid_value', () => parseExecutionEnvelope(jump))
  const secret = executionEnvelope()
  secret.raw_env = { GH_TOKEN: 'do-not-store' }
  expectCode('secret_material_detected', () => parseExecutionEnvelope(secret))
})

test('stack envelope freezes direct-merge vector and rejects unsafe member state', () => {
  assert.equal(parseStackDeliveryEnvelope(stack()).members[0].head_sha, SHA1_B)
  const badMethod = stack()
  badMethod.merge_method = 'squash'
  expectCode('invalid_value', () => parseStackDeliveryEnvelope(badMethod))
  const badPosition = stack()
  badPosition.members[0].position = 0
  expectCode('invalid_value', () => parseStackDeliveryEnvelope(badPosition))
  const badFinding = stack()
  badFinding.members[0].unresolved_finding_state = 'open'
  expectCode('invalid_value', () => parseStackDeliveryEnvelope(badFinding))
})

test('stack parser keeps every durable reference namespaced', () => {
  for (const [target, field, value] of [
    ['stack', 'stack_id', 'stack-one'],
    ['member', 'node_id', 'node-one'],
    ['stack', 'capability_reference', 'capability-one'],
    ['stack', 'deployment_target_reference', 'target-one'],
  ]) {
    const hostile = stack()
    if (target === 'member') hostile.members[0][field] = value
    else hostile[field] = value
    expectCode('invalid_value', () => parseStackDeliveryEnvelope(hostile))
  }
})

test('semantic parser boundary rejects every schema-only cross-record hostile fixture', () => {
  const duplicateTask = plan()
  duplicateTask.tasks.push(structuredClone(duplicateTask.tasks[0]))

  const duplicateNormalizedResource = plan()
  duplicateNormalizedResource.tasks[0].scope.resources = [
    { kind: 'path', path: 'src/caf\u00e9.mjs' },
    { kind: 'path', path: 'src/cafe\u0301.mjs' },
  ]

  const mismatchedE2e = plan()
  mismatchedE2e.tasks[0].e2e_required = true

  const selfIssued = executionEnvelope()
  selfIssued.issuer_id = selfIssued.owner_session

  const untypedOwner = executionEnvelope()
  untypedOwner.owner_session = 'writer-session'

  const missingE2eDigest = stack()
  missingE2eDigest.members[0].e2e_required = true

  const selectedTopNotFinal = stack()
  const finalMember = structuredClone(selectedTopNotFinal.members[0])
  finalMember.pr_number = 43
  finalMember.position = 2
  selectedTopNotFinal.members.push(finalMember)

  for (const [parser, fixture] of [
    [parseDeliveryPlan, duplicateTask],
    [parseDeliveryPlan, duplicateNormalizedResource],
    [parseDeliveryPlan, mismatchedE2e],
    [parseExecutionEnvelope, selfIssued],
    [parseExecutionEnvelope, untypedOwner],
    [parseStackDeliveryEnvelope, missingE2eDigest],
    [parseStackDeliveryEnvelope, selectedTopNotFinal],
  ]) {
    expectCode('invalid_value', () => parser(fixture))
  }
})

test('final contract acceptance requires the semantic validation entrypoint after Draft validation', async () => {
  const { validateFabricContract } = await import('../../lib/parallel-delivery-fabric-contract.mjs')
  assert.equal(typeof validateFabricContract, 'function')

  const duplicateTask = plan()
  duplicateTask.tasks.push(structuredClone(duplicateTask.tasks[0]))
  const selfIssued = executionEnvelope()
  selfIssued.issuer_id = selfIssued.owner_session
  const selectedTopNotFinal = stack()
  const finalMember = structuredClone(selectedTopNotFinal.members[0])
  finalMember.pr_number = 43
  finalMember.position = 2
  selectedTopNotFinal.members.push(finalMember)

  for (const [definition, fixture] of [
    ['plan', duplicateTask],
    ['execution_envelope', selfIssued],
    ['stack', selectedTopNotFinal],
  ]) {
    expectCode('invalid_value', () => validateFabricContract(definition, fixture))
  }
})

test('external terminal projection enforces the complete closed result matrix', () => {
  const validPairs = [
    ['DELIVERED', 'DELIVERY_VERIFIED'],
    ['FAILED', 'MERGED_NOT_DELIVERED'],
    ['HELD', 'MERGE_OUTCOME_UNVERIFIED'],
    ['HELD', 'PREMERGE_EVIDENCE_INVALID'],
    ['HELD', 'PREMERGE_AUTHORITY_UNAVAILABLE'],
    ['HELD', 'POLICY_OR_SETTINGS_DRIFT'],
  ]
  const allReasons = [
    'DELIVERY_VERIFIED', 'MERGED_NOT_DELIVERED', 'MERGE_OUTCOME_UNVERIFIED',
    'PREMERGE_EVIDENCE_INVALID', 'PREMERGE_AUTHORITY_UNAVAILABLE',
    'POLICY_OR_SETTINGS_DRIFT',
  ]

  for (const [terminalClass, reasonCode] of validPairs) {
    const value = { phase: 'CLOSED', terminal_class: terminalClass, reason_code: reasonCode }
    assert.deepEqual(projectExternalTerminal(value), value)
  }

  const validReasonsByClass = new Map([
    ['DELIVERED', new Set(['DELIVERY_VERIFIED'])],
    ['FAILED', new Set(['MERGED_NOT_DELIVERED'])],
    ['HELD', new Set([
      'MERGE_OUTCOME_UNVERIFIED', 'PREMERGE_EVIDENCE_INVALID',
      'PREMERGE_AUTHORITY_UNAVAILABLE', 'POLICY_OR_SETTINGS_DRIFT',
    ])],
  ])
  for (const [terminalClass, allowedReasons] of validReasonsByClass) {
    for (const reasonCode of allReasons) {
      if (allowedReasons.has(reasonCode)) continue
      expectCode('invalid_value', () => projectExternalTerminal({
        phase: 'CLOSED', terminal_class: terminalClass, reason_code: reasonCode,
      }))
    }
  }

  for (const [value, expectedCode] of [
    [{ phase: 'OPEN', terminal_class: 'DELIVERED', reason_code: 'DELIVERY_VERIFIED' }, 'invalid_value'],
    [{ phase: 'CLOSED', terminal_class: 'DELIVERED', reason_code: 'DELIVERY_VERIFIED', extra: true }, 'invalid_shape'],
    [{ phase: 'CLOSED', terminal_class: 'STACK_DELIVERY_FAILED', reason_code: 'MERGED_NOT_DELIVERED' }, 'invalid_value'],
    [{ phase: 'CLOSED', terminal_class: 'FAILED', reason_code: 'DEPLOYMENT_BLOCKED' }, 'invalid_value'],
    [{ phase: 'CLOSED', terminal_class: 'HELD', reason_code: 'ACTIVATION_UNATTESTED' }, 'invalid_value'],
    [{ phase: 'CLOSED', terminal_class: 'HELD', reason_code: 'DELIVERY_PENDING_FIXPOINT' }, 'invalid_value'],
    [{ phase: 'CLOSED', terminal_class: 'HELD', reason_code: 'MERGE_ASYNC_DISPATCHED' }, 'invalid_value'],
    [{ phase: 'CLOSED', terminal_class: 'HELD', reason_code: 'PENDING' }, 'invalid_value'],
    [{ phase: 'CLOSED', terminal_class: 'HELD', reason_code: 'TIMEOUT' }, 'invalid_value'],
  ]) {
    expectCode(expectedCode, () => projectExternalTerminal(value))
  }

  for (const terminalClass of ['STACK_DELIVERY_FAILED', 'STACK_DELIVERY_VERIFIED', 'STACK_UNKNOWN']) {
    expectCode('invalid_value', () => projectExternalTerminal({
      phase: 'CLOSED', terminal_class: terminalClass, reason_code: 'MERGE_OUTCOME_UNVERIFIED',
    }))
  }

  for (const internalState of [
    'STACK_UNKNOWN', 'MERGE_ASYNC_DISPATCHED', 'PENDING', 'TIMEOUT',
  ]) {
    expectCode('invalid_value', () => projectExternalTerminal({ internal_state: internalState }))
  }

  assert.deepEqual(projectExternalTerminal({ internal_state: 'STACK_DELIVERY_FAILED' }), {
    phase: 'CLOSED', terminal_class: 'FAILED', reason_code: 'MERGED_NOT_DELIVERED',
  })
  assert.deepEqual(projectExternalTerminal({ internal_state: 'STACK_DELIVERY_VERIFIED' }), {
    phase: 'CLOSED', terminal_class: 'DELIVERED', reason_code: 'DELIVERY_VERIFIED',
  })
})

test('contract module remains pure and does not import IO, process, or network capabilities', async () => {
  const source = await readFile(new URL('../../lib/parallel-delivery-fabric-contract.mjs', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /node:(?:assert|child_process|cluster|dgram|dns|fs|http2?|https|net|tls|worker_threads)/u)
  assert.doesNotMatch(source, /\b(?:exec|execFile|fork|spawn|fetch)\s*\(/u)
})
