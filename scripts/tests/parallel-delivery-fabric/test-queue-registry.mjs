import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'

import { FABRIC_SCHEMA_VERSION, digestCanonical } from '../../lib/parallel-delivery-fabric-contract.mjs'
import {
  createLeaseRegistry,
  createQueueMappingRegistry,
} from '../../lib/parallel-delivery-fabric-registry.mjs'

const ZERO_OID = '0'.repeat(40)
const SHA1 = 'a'.repeat(40)
const SHA1_NEXT = 'b'.repeat(40)
const DIGEST = 'c'.repeat(64)
const DIGEST_NEXT = 'd'.repeat(64)
const NOW = '2026-08-30T00:00:00.000Z'
const LATER = '2026-08-30T00:10:00.000Z'
const NONCE = (suffix) => suffix.padEnd(32, 'n').slice(0, 32)
const LEASE_REF = 'refs/ai-bim/session-leases'
const QUEUE_REF = 'refs/ai-bim/queue-mappings'
const PLAN_REF = 'refs/ai-bim/delivery-plans'

const canonicalDigest = (value) => digestCanonical(value)
const restamp = (value) => {
  const record = structuredClone(value)
  delete record.canonical_digest
  return { ...record, canonical_digest: canonicalDigest(record) }
}

const legacyPlanRecord = () => {
  const plan = {
    schema_version: FABRIC_SCHEMA_VERSION,
    plan_id: 'plan:queue-root',
    generation: 1,
    repo_identity: { full_name: 'acme/bim', repository_id: 1, common_dir_digest: DIGEST },
    created_at: NOW,
    coordinator_session: 'session:queue-root',
    baseline_ref: 'origin/main',
    resolved_baseline_sha: SHA1,
    tasks: [{
      task_id: 'task:queue-root',
      outcome: 'queue-shadow-contract',
      provider_preference: 'codex',
      owner_session: 'session:queue-root',
      scope: {
        owning_service: 'delivery-fabric',
        public_entrypoint: 'scripts/lib/parallel-delivery-fabric-registry.mjs',
        resources: [{ kind: 'runtime', resource_key: 'resource:kit-runtime' }],
        expected_tests: ['test:queue-registry'],
        e2e_required: false,
      },
      dependencies: [],
      risk: 'bounded',
      e2e_required: false,
    }],
    requested_capacity: { writers: 1, runtime_leases: 1 },
    branch_profile: 'trunk',
    acceptance_criteria: ['criterion:queue-shadow'],
    promotion_mode: 'single_pr',
    requested_execution_level: 'plan_only',
    authority_reference: 'authority:queue-plan',
    governance_source_refs: ['openspec:parallel-delivery-fabric'],
  }
  const base = {
    schema_version: 'delivery-plan-registry/v1',
    generation: 1,
    nonce: NONCE('legacy-plan'),
    created_at: NOW,
    updated_at: NOW,
    plan,
    plan_digest: canonicalDigest(plan),
    execution: { level: 'plan_only', side_effect_class: 'CONTROL_METADATA' },
  }
  return { ...base, canonical_digest: canonicalDigest(base) }
}

const createClock = (now = NOW) => ({ now: () => now })

const createLegacyStore = () => {
  const states = new Map([[PLAN_REF, { oid: SHA1, record: legacyPlanRecord() }]])
  const calls = []
  const snapshot = (ref) => structuredClone(states.get(ref) ?? { oid: ZERO_OID, record: null })
  return {
    commonDirDigest: DIGEST,
    calls,
    async read(ref) {
      calls.push({ kind: 'read', ref })
      return snapshot(ref)
    },
    async cas({ ref, expected_oid, record }) {
      calls.push({ kind: 'cas', ref, expected_oid })
      const current = snapshot(ref)
      if (expected_oid !== current.oid) return { status: 'CONFLICT', actual_oid: current.oid }
      const oid = createHash('sha1').update(JSON.stringify(record)).digest('hex')
      states.set(ref, { oid, record: structuredClone(record) })
      return { status: 'STORED', oid, record: structuredClone(record) }
    },
    async casGuarded({ ref, expected_oid, record, guard_ref, guard_oid }) {
      calls.push({ kind: 'cas', ref, expected_oid, guard_ref, guard_oid })
      const current = snapshot(ref)
      const guard = snapshot(guard_ref)
      if (guard.oid !== guard_oid) {
        return { status: 'CONFLICT', reason: 'GUARD_CONFLICT', actual_oid: current.oid, actual_guard_oid: guard.oid }
      }
      if (expected_oid !== current.oid) return { status: 'CONFLICT', reason: 'CAS_CONFLICT', actual_oid: current.oid }
      const oid = createHash('sha1').update(JSON.stringify(record)).digest('hex')
      states.set(ref, { oid, record: structuredClone(record) })
      return { status: 'STORED', oid, record: structuredClone(record) }
    },
    snapshot,
  }
}

const legacyLeaseRequest = (overrides = {}) => ({
  lease_id: 'lease:one',
  plan_id: 'plan:queue-root',
  generation: 1,
  task_id: 'task:queue-root',
  provider: 'codex',
  owner_session: 'session:queue-root',
  provider_session_id: 'provider:queue-root',
  execution_context_id: 'context:queue-root',
  context_attestation_ref: 'attestation:queue-root',
  common_dir_digest: DIGEST,
  worktree_id: 'worktree:queue-root',
  worktree_path_digest: DIGEST,
  branch: 'codex/queue-root',
  scope_digest: canonicalDigest([{ kind: 'runtime', resource_key: 'resource:kit-runtime' }]),
  head_sha: SHA1,
  resource_keys: ['runtime:resource:kit-runtime'],
  nonce: NONCE('legacy-root'),
  expected_plan_oid: SHA1,
  ...overrides,
})

const source = () => ({
  repository: 'acme/bim',
  workflow: 'workflow:ci',
  resource_key: 'runtime:resource:kit-runtime',
})

const observation = (overrides = {}) => ({
  snapshot_id: 'snapshot:queue-one',
  snapshot_generation: 1,
  observed_at: NOW,
  expires_at: LATER,
  queue_position: 101,
  member_vector_digest: DIGEST,
  state: 'OBSERVED',
  ...overrides,
})

const reserveRequest = (overrides = {}) => ({
  registry_ref: QUEUE_REF,
  expected_oid: ZERO_OID,
  operation_id: 'operation:queue-reserve-one',
  nonce: NONCE('queue-reserve-one'),
  candidate_id: 'candidate:one',
  run_id: 'run:one',
  lease_id: 'lease:one',
  resource_key: 'runtime:resource:kit-runtime',
  workflow: 'workflow:ci',
  candidate_head_sha: SHA1,
  lease_generation: 1,
  source: source(),
  source_digest: canonicalDigest(source()),
  observation: observation(),
  observation_digest: canonicalDigest(observation()),
  ...overrides,
})

const cancellationRequest = (overrides = {}) => ({
  ...reserveRequest(),
  operation_id: 'operation:queue-cancel-one',
  nonce: NONCE('queue-cancel-one'),
  pending_before: 100,
  pending_limit: 100,
  incoming_position: 101,
  ...overrides,
})

const expectHeld = (result, reason = undefined) => {
  assert.equal(result.status, 'HELD_QUEUE_CAPABILITY')
  assert.equal(result.shadow, 'SHADOW_ONLY')
  if (reason) assert.equal(result.reason, reason)
}

test('AC-30 — missing queue root is held without mutating the legacy lease root', async () => {
  const store = createLegacyStore()
  const leases = createLeaseRegistry({ store, clock: createClock(), writerCap: 2 })
  const admitted = await leases.admit(legacyLeaseRequest())
  assert.equal(admitted.status, 'ADMITTED')
  const before = store.snapshot(LEASE_REF)
  const queue = createQueueMappingRegistry({ store, clock: createClock() })
  expectHeld(await queue.restore({ registry_ref: QUEUE_REF }), 'REGISTRY_UNKNOWN')
  assert.deepEqual(store.snapshot(LEASE_REF), before)
  assert.deepEqual(store.snapshot(QUEUE_REF), { oid: ZERO_OID, record: null })
  assert.equal(store.calls.filter((call) => call.kind === 'cas').length, 1)
})

test('AC-30 — first legal reserve writes a separate queue root and preserves the lease root', async () => {
  const store = createLegacyStore()
  const leases = createLeaseRegistry({ store, clock: createClock(), writerCap: 2 })
  await leases.admit(legacyLeaseRequest())
  const leaseBefore = store.snapshot(LEASE_REF)
  const queue = createQueueMappingRegistry({ store, clock: createClock() })
  const result = await queue.reserve(reserveRequest({ expected_oid: ZERO_OID }))
  assert.equal(result.status, 'SHADOW_QUEUE_MAPPING_STORED')
  assert.equal(result.shadow, 'SHADOW_ONLY')
  assert.equal(result.mapping.candidate_id, 'candidate:one')
  assert.equal(result.mapping.source_digest, canonicalDigest(source()))
  assert.equal(result.mapping.observation_digest, canonicalDigest(observation()))
  assert.notEqual(result.registry_oid, ZERO_OID)
  assert.deepEqual(store.snapshot(LEASE_REF), leaseBefore)
  assert.equal(store.snapshot(QUEUE_REF).oid, result.registry_oid)
})

test('P2 regression — each queue write shares one clock observation with its operation receipt', async () => {
  const store = createLegacyStore()
  const leases = createLeaseRegistry({ store, clock: createClock(), writerCap: 2 })
  await leases.admit(legacyLeaseRequest())
  let tick = 0
  const advancingClock = {
    now: () => `2026-08-30T00:00:00.${String(tick++).padStart(3, '0')}Z`,
  }
  const queue = createQueueMappingRegistry({ store, clock: advancingClock })
  const reserved = await queue.reserve(reserveRequest())
  assert.equal(reserved.status, 'SHADOW_QUEUE_MAPPING_STORED')
  let snapshot = store.snapshot(QUEUE_REF)
  assert.equal(snapshot.record.used_queue_operations['operation:queue-reserve-one'].consumed_at, snapshot.record.updated_at)

  const cancelled = await queue.reconcileCancelled(cancellationRequest({ expected_oid: reserved.registry_oid }))
  assert.equal(cancelled.status, 'SHADOW_QUEUE_CANCELLATION_RECORDED')
  snapshot = store.snapshot(QUEUE_REF)
  assert.equal(snapshot.record.used_queue_operations['operation:queue-cancel-one'].consumed_at, snapshot.record.updated_at)
})

test('P2 regression — a cancelled candidate mapping is terminal and cannot be re-reserved', async () => {
  const store = createLegacyStore()
  const leases = createLeaseRegistry({ store, clock: createClock(), writerCap: 2 })
  await leases.admit(legacyLeaseRequest())
  const queue = createQueueMappingRegistry({ store, clock: createClock() })
  const reserved = await queue.reserve(reserveRequest())
  assert.equal(reserved.status, 'SHADOW_QUEUE_MAPPING_STORED')
  const cancelled = await queue.reconcileCancelled(cancellationRequest({ expected_oid: reserved.registry_oid }))
  assert.equal(cancelled.status, 'SHADOW_QUEUE_CANCELLATION_RECORDED')
  const queueOid = store.snapshot(QUEUE_REF).oid
  const casCalls = store.calls.filter((call) => call.kind === 'cas').length
  expectHeld(await queue.reserve(reserveRequest({
    expected_oid: queueOid,
    operation_id: 'operation:queue-rereserve-one',
    nonce: NONCE('queue-rereserve-one'),
  })), 'MAPPING_TERMINAL')
  assert.equal(store.calls.filter((call) => call.kind === 'cas').length, casCalls)
})

test('AC-30 — same-OID reserve race has one winner and preserves the loser tuple', async () => {
  const store = createLegacyStore()
  const leases = createLeaseRegistry({ store, clock: createClock(), writerCap: 2 })
  await leases.admit(legacyLeaseRequest())
  const expected = store.snapshot(QUEUE_REF).oid
  const queue = createQueueMappingRegistry({ store, clock: createClock() })
  const [left, right] = await Promise.all([
    queue.reserve(reserveRequest({ expected_oid: expected, operation_id: 'operation:left', nonce: NONCE('left') })),
    queue.reserve(reserveRequest({ expected_oid: expected, operation_id: 'operation:right', nonce: NONCE('right') })),
  ])
  assert.equal([left, right].filter((item) => item.status === 'SHADOW_QUEUE_MAPPING_STORED').length, 1)
  assert.equal([left, right].filter((item) => item.status === 'HELD_QUEUE_CAPABILITY').length, 1)
})

test('AC-30 — lease rotation between validation and queue CAS prevents a stale reservation', async () => {
  const store = createLegacyStore()
  const leases = createLeaseRegistry({ store, clock: createClock(), writerCap: 2 })
  await leases.admit(legacyLeaseRequest())
  const originalCasGuarded = store.casGuarded.bind(store)
  let rotated = false
  store.casGuarded = async (input) => {
    if (!rotated) {
      rotated = true
      const leaseSnapshot = store.snapshot(LEASE_REF)
      const heartbeat = await leases.heartbeat({
        lease_id: 'lease:one',
        expected_oid: leaseSnapshot.oid,
        heartbeat_seq: 2,
        nonce: NONCE('lease-rotated'),
      })
      assert.equal(heartbeat.status, 'HEARTBEAT_RECORDED')
    }
    return originalCasGuarded(input)
  }
  const queue = createQueueMappingRegistry({ store, clock: createClock() })
  expectHeld(await queue.reserve(reserveRequest()), 'LEASE_REGISTRY_CHANGED')
  assert.deepEqual(store.snapshot(QUEUE_REF), { oid: ZERO_OID, record: null })
})

test('AC-30 — duplicate nonce and operation replay remain held after restart with zero CAS', async () => {
  const store = createLegacyStore()
  const leases = createLeaseRegistry({ store, clock: createClock(), writerCap: 2 })
  await leases.admit(legacyLeaseRequest())
  const queue = createQueueMappingRegistry({ store, clock: createClock() })
  const first = await queue.reserve({ ...reserveRequest(), expected_oid: store.snapshot(QUEUE_REF).oid })
  assert.equal(first.status, 'SHADOW_QUEUE_MAPPING_STORED')
  const restarted = createQueueMappingRegistry({ store, clock: createClock() })
  const before = store.calls.filter((call) => call.kind === 'cas').length
  expectHeld(await restarted.reserve({ ...reserveRequest(), expected_oid: store.snapshot(QUEUE_REF).oid }), 'NONCE_REPLAY')
  expectHeld(await restarted.reserve({ ...reserveRequest({ nonce: NONCE('fresh-nonce'), expected_oid: store.snapshot(QUEUE_REF).oid }), operation_id: 'operation:queue-reserve-one' }), 'OPERATION_REPLAY')
  assert.equal(store.calls.filter((call) => call.kind === 'cas').length, before)
})

test('AC-30 — restore rejects missing/corrupt/unknown state and digest records without CAS', async () => {
  for (const [label, record] of [
    ['missing', null],
    ['unknown-state', { schema_version: 'queue-registry/v1', generation: 1, state: 'UNKNOWN' }],
    ['bad-root-digest', { schema_version: 'queue-registry/v1', generation: 1, queue_mappings: {}, used_queue_operations: {}, canonical_digest: DIGEST }],
  ]) {
    const store = createLegacyStore()
    if (record !== null) await store.cas({ ref: QUEUE_REF, expected_oid: ZERO_OID, record })
    const queue = createQueueMappingRegistry({ store, clock: createClock() })
    const before = store.calls.filter((call) => call.kind === 'cas').length
    expectHeld(await queue.restore({ registry_ref: QUEUE_REF }), label === 'missing' ? 'REGISTRY_UNKNOWN' : undefined)
    assert.equal(store.calls.filter((call) => call.kind === 'cas').length, before)
  }
})

test('AC-30 — restore fail-closes every persisted mapping and operation binding after a recomputed root digest', async () => {
  const corruptions = [
    ['mapping-key', (record) => {
      record.queue_mappings['candidate:other'] = record.queue_mappings['candidate:one']
      delete record.queue_mappings['candidate:one']
    }],
    ['mapping-run', (record) => { record.queue_mappings['candidate:one'].run_id = 'run:other' }],
    ['mapping-head', (record) => { record.queue_mappings['candidate:one'].candidate_head_sha = ZERO_OID }],
    ['mapping-generation', (record) => { record.queue_mappings['candidate:one'].lease_generation = 0 }],
    ['mapping-digest', (record) => { record.queue_mappings['candidate:one'].source_digest = 'not-a-digest' }],
    ['operation-shape', (record) => { record.used_queue_operations['operation:queue-reserve-one'].unexpected = true }],
    ['operation-nonce', (record) => { record.used_queue_operations['operation:queue-reserve-one'].nonce = 'short' }],
    ['operation-time', (record) => { record.used_queue_operations['operation:queue-reserve-one'].consumed_at = '2026-08-29T23:59:59.999Z' }],
    ['operation-kind', (record) => { record.used_queue_operations['operation:queue-reserve-one'].kind = 'execute' }],
  ]
  for (const [label, corrupt] of corruptions) {
    const store = createLegacyStore()
    const leases = createLeaseRegistry({ store, clock: createClock(), writerCap: 2 })
    await leases.admit(legacyLeaseRequest())
    const queue = createQueueMappingRegistry({ store, clock: createClock() })
    const stored = await queue.reserve(reserveRequest())
    assert.equal(stored.status, 'SHADOW_QUEUE_MAPPING_STORED')
    const snapshot = store.snapshot(QUEUE_REF)
    const corrupted = structuredClone(snapshot.record)
    corrupt(corrupted)
    await store.cas({ ref: QUEUE_REF, expected_oid: snapshot.oid, record: restamp(corrupted) })
    const before = store.calls.filter((call) => call.kind === 'cas').length
    expectHeld(await createQueueMappingRegistry({ store, clock: createClock() }).restore({ registry_ref: QUEUE_REF }), 'REGISTRY_UNKNOWN')
    assert.equal(store.calls.filter((call) => call.kind === 'cas').length, before, label)
  }
})

test('AC-30 — tuple/resource/workflow/head/generation/source/snapshot/freshness drift is independently held before CAS', async () => {
  const fields = [
    ['candidate_id', 'candidate:other'], ['run_id', 'run:other'], ['lease_id', 'lease:other'],
    ['resource_key', 'resource:other'], ['workflow', 'workflow:other'], ['candidate_head_sha', SHA1_NEXT],
    ['lease_generation', 2], ['source_digest', DIGEST_NEXT], ['observation_digest', DIGEST_NEXT],
    ['observation', observation({ snapshot_generation: 2 })],
    ['now', '2026-08-30T00:11:00.000Z'],
  ]
  for (const [label, value] of fields) {
    const store = createLegacyStore()
    const leases = createLeaseRegistry({ store, clock: createClock(), writerCap: 2 })
    await leases.admit(legacyLeaseRequest())
    const queue = createQueueMappingRegistry({ store, clock: createClock() })
    const before = store.calls.filter((call) => call.kind === 'cas').length
    const request = reserveRequest({ [label]: value, expected_oid: store.snapshot(QUEUE_REF).oid })
    expectHeld(await queue.reserve(request))
    assert.equal(store.calls.filter((call) => call.kind === 'cas').length, before, label)
  }
})

test('AC-30 — a future-dated queue observation is stale even when its expiry is later', async () => {
  const store = createLegacyStore()
  const leases = createLeaseRegistry({ store, clock: createClock(), writerCap: 2 })
  await leases.admit(legacyLeaseRequest())
  const queue = createQueueMappingRegistry({ store, clock: createClock() })
  const future = observation({ observed_at: '2026-08-30T00:01:00.000Z' })
  const before = store.calls.filter((call) => call.kind === 'cas').length
  expectHeld(await queue.reserve(reserveRequest({
    observation: future,
    observation_digest: canonicalDigest(future),
  })), 'SNAPSHOT_STALE')
  assert.equal(store.calls.filter((call) => call.kind === 'cas').length, before)
})

test('AC-30 — stale OID, 1025 mappings, and 4097 operations are bounded HELD outcomes', async () => {
  const store = createLegacyStore()
  const leases = createLeaseRegistry({ store, clock: createClock(), writerCap: 2 })
  await leases.admit(legacyLeaseRequest())
  const queue = createQueueMappingRegistry({ store, clock: createClock() })
  expectHeld(await queue.reserve(reserveRequest({ expected_oid: SHA1_NEXT })), 'REGISTRY_CAS_CONFLICT')
  expectHeld(await queue.reserve(reserveRequest({ expected_oid: store.snapshot(QUEUE_REF).oid, queue_mapping_count: 1025 })), 'LEDGER_CAPACITY_EXCEEDED')
  expectHeld(await queue.reserve(reserveRequest({ expected_oid: store.snapshot(QUEUE_REF).oid, operation_count: 4097 })), 'LEDGER_CAPACITY_EXCEEDED')
})

test('AC-30 — only exact 101st cancellation cross-binds source, snapshot, tuple, and mapping', async () => {
  const store = createLegacyStore()
  const leases = createLeaseRegistry({ store, clock: createClock(), writerCap: 2 })
  await leases.admit(legacyLeaseRequest())
  const queue = createQueueMappingRegistry({ store, clock: createClock() })
  const reserved = await queue.reserve({ ...reserveRequest(), expected_oid: store.snapshot(QUEUE_REF).oid })
  assert.equal(reserved.status, 'SHADOW_QUEUE_MAPPING_STORED')
  const cancelled = await queue.reconcileCancelled(cancellationRequest({ expected_oid: reserved.registry_oid }))
  assert.equal(cancelled.status, 'SHADOW_QUEUE_CANCELLATION_RECORDED')
  assert.equal(cancelled.shadow, 'SHADOW_ONLY')
  assert.deepEqual((await queue.restore({ registry_ref: QUEUE_REF })).record.queue_mappings, {})
  for (const patch of [
    { pending_before: 99 }, { pending_limit: 99 }, { incoming_position: 100 },
    { candidate_id: 'candidate:other' }, { source_digest: DIGEST_NEXT },
    { observation_digest: DIGEST_NEXT }, { observation: observation({ snapshot_generation: 2 }) },
  ]) {
    const before = store.calls.filter((call) => call.kind === 'cas').length
    expectHeld(await queue.reconcileCancelled(cancellationRequest({ ...patch, expected_oid: store.snapshot(QUEUE_REF).oid })))
    assert.equal(store.calls.filter((call) => call.kind === 'cas').length, before)
  }
})

test('AC-30 — queue registry interface has bounded, private, zero-sink implementation requirements', () => {
  assert.equal(typeof createQueueMappingRegistry, 'function')
  assert.match(NONCE('contract'), /^[A-Za-z0-9_-]{32,128}$/u)
  assert.doesNotMatch(JSON.stringify(reserveRequest()), /(?:token|cookie|authorization|private[_-]?key|absolute_path|process_id|transcript)/iu)
})
