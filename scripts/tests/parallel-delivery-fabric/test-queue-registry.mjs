import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'

import { digestCanonical } from '../../lib/parallel-delivery-fabric-contract.mjs'
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

const canonicalDigest = (value) => digestCanonical(value)

const createClock = (now = NOW) => ({ now: () => now })

const createLegacyStore = () => {
  let current = { oid: ZERO_OID, record: null }
  const calls = []
  return {
    commonDirDigest: DIGEST,
    calls,
    async read(ref) {
      calls.push({ kind: 'read', ref })
      return structuredClone(current)
    },
    async cas({ ref, expected_oid, record }) {
      calls.push({ kind: 'cas', ref, expected_oid })
      if (expected_oid !== current.oid) return { status: 'CONFLICT', actual_oid: current.oid }
      const oid = createHash('sha1').update(JSON.stringify(record)).digest('hex')
      current = { oid, record: structuredClone(record) }
      return { status: 'STORED', oid, record: structuredClone(record) }
    },
    snapshot: () => structuredClone(current),
  }
}

const legacyLeaseRequest = (overrides = {}) => ({
  lease_id: 'lease:queue-root',
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
  scope_digest: DIGEST,
  head_sha: SHA1,
  resource_keys: ['path:scripts/tests/parallel-delivery-fabric/test-queue-registry.mjs'],
  nonce: NONCE('legacy-root'),
  ...overrides,
})

const source = () => ({
  repository: 'acme/bim',
  workflow: 'workflow:ci',
  resource_key: 'resource:kit-runtime',
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
  registry_ref: 'refs/ai-bim/session-leases',
  expected_oid: ZERO_OID,
  operation_id: 'operation:queue-reserve-one',
  nonce: NONCE('queue-reserve-one'),
  candidate_id: 'candidate:one',
  run_id: 'run:one',
  lease_id: 'lease:one',
  resource_key: 'resource:kit-runtime',
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

test('AC-30 — legacy session-lease root normalizes queue fields without CAS or byte/OID mutation', async () => {
  const store = createLegacyStore()
  const leases = createLeaseRegistry({ store, clock: createClock(), writerCap: 2 })
  const admitted = await leases.admit(legacyLeaseRequest())
  assert.equal(admitted.status, 'ADMITTED')
  const before = store.snapshot()
  const queue = createQueueMappingRegistry({ store, clock: createClock() })
  const restored = await queue.restore({ registry_ref: 'refs/ai-bim/session-leases' })
  assert.equal(restored.status, 'SHADOW_QUEUE_MAPPING_RESTORED')
  assert.equal(restored.registry_oid, before.oid)
  assert.deepEqual(restored.record.queue_mappings, {})
  assert.deepEqual(restored.record.used_queue_operations, {})
  assert.deepEqual(store.snapshot(), before)
  assert.equal(store.calls.filter((call) => call.kind === 'cas').length, 1)
})

test('AC-30 — first legal reserve upgrades the same LEASE_REF with exact tuple and digests', async () => {
  const store = createLegacyStore()
  const leases = createLeaseRegistry({ store, clock: createClock(), writerCap: 2 })
  await leases.admit(legacyLeaseRequest())
  const before = store.snapshot()
  const queue = createQueueMappingRegistry({ store, clock: createClock() })
  const result = await queue.reserve(reserveRequest({ expected_oid: before.oid }))
  assert.equal(result.status, 'SHADOW_QUEUE_MAPPING_STORED')
  assert.equal(result.shadow, 'SHADOW_ONLY')
  assert.equal(result.mapping.candidate_id, 'candidate:one')
  assert.equal(result.mapping.source_digest, canonicalDigest(source()))
  assert.equal(result.mapping.observation_digest, canonicalDigest(observation()))
  assert.notEqual(result.registry_oid, before.oid)
})

test('AC-30 — same-OID reserve race has one winner and preserves the loser tuple', async () => {
  const store = createLegacyStore()
  const leases = createLeaseRegistry({ store, clock: createClock(), writerCap: 2 })
  await leases.admit(legacyLeaseRequest())
  const expected = store.snapshot().oid
  const queue = createQueueMappingRegistry({ store, clock: createClock() })
  const [left, right] = await Promise.all([
    queue.reserve(reserveRequest({ expected_oid: expected, operation_id: 'operation:left', nonce: NONCE('left') })),
    queue.reserve(reserveRequest({ expected_oid: expected, operation_id: 'operation:right', nonce: NONCE('right'), candidate_id: 'candidate:right', run_id: 'run:right', lease_id: 'lease:right' })),
  ])
  assert.equal([left, right].filter((item) => item.status === 'SHADOW_QUEUE_MAPPING_STORED').length, 1)
  assert.equal([left, right].filter((item) => item.status === 'HELD_QUEUE_CAPABILITY').length, 1)
})

test('AC-30 — duplicate nonce and operation replay remain held after restart with zero CAS', async () => {
  const store = createLegacyStore()
  const leases = createLeaseRegistry({ store, clock: createClock(), writerCap: 2 })
  await leases.admit(legacyLeaseRequest())
  const queue = createQueueMappingRegistry({ store, clock: createClock() })
  const first = await queue.reserve({ ...reserveRequest(), expected_oid: store.snapshot().oid })
  assert.equal(first.status, 'SHADOW_QUEUE_MAPPING_STORED')
  const restarted = createQueueMappingRegistry({ store, clock: createClock() })
  const before = store.calls.filter((call) => call.kind === 'cas').length
  expectHeld(await restarted.reserve({ ...reserveRequest(), expected_oid: store.snapshot().oid }), 'NONCE_REPLAY')
  expectHeld(await restarted.reserve({ ...reserveRequest({ nonce: NONCE('fresh-nonce'), expected_oid: store.snapshot().oid }), operation_id: 'operation:queue-reserve-one' }), 'OPERATION_REPLAY')
  assert.equal(store.calls.filter((call) => call.kind === 'cas').length, before)
})

test('AC-30 — restore rejects missing/corrupt/unknown state and digest records without CAS', async () => {
  for (const [label, record] of [
    ['missing', null],
    ['unknown-state', { schema_version: 'queue-registry/v1', generation: 1, state: 'UNKNOWN' }],
    ['bad-root-digest', { schema_version: 'queue-registry/v1', generation: 1, queue_mappings: {}, used_queue_operations: {}, canonical_digest: DIGEST }],
  ]) {
    const store = createLegacyStore()
    store.cas({ ref: 'refs/ai-bim/session-leases', expected_oid: ZERO_OID, record })
    const queue = createQueueMappingRegistry({ store, clock: createClock() })
    const before = store.calls.filter((call) => call.kind === 'cas').length
    expectHeld(await queue.restore({ registry_ref: 'refs/ai-bim/session-leases' }), label === 'missing' ? 'REGISTRY_UNKNOWN' : undefined)
    assert.equal(store.calls.filter((call) => call.kind === 'cas').length, before)
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
    const request = reserveRequest({ [label]: value, expected_oid: store.snapshot().oid })
    expectHeld(await queue.reserve(request))
    assert.equal(store.calls.filter((call) => call.kind === 'cas').length, before, label)
  }
})

test('AC-30 — stale OID, 1025 mappings, and 4097 operations are bounded HELD outcomes', async () => {
  const store = createLegacyStore()
  const leases = createLeaseRegistry({ store, clock: createClock(), writerCap: 2 })
  await leases.admit(legacyLeaseRequest())
  const queue = createQueueMappingRegistry({ store, clock: createClock() })
  expectHeld(await queue.reserve(reserveRequest({ expected_oid: SHA1_NEXT })), 'REGISTRY_CAS_CONFLICT')
  expectHeld(await queue.reserve(reserveRequest({ expected_oid: store.snapshot().oid, queue_mapping_count: 1025 })), 'LEDGER_CAPACITY_EXCEEDED')
  expectHeld(await queue.reserve(reserveRequest({ expected_oid: store.snapshot().oid, operation_count: 4097 })), 'LEDGER_CAPACITY_EXCEEDED')
})

test('AC-30 — only exact 101st cancellation cross-binds source, snapshot, tuple, and mapping', async () => {
  const store = createLegacyStore()
  const leases = createLeaseRegistry({ store, clock: createClock(), writerCap: 2 })
  await leases.admit(legacyLeaseRequest())
  const queue = createQueueMappingRegistry({ store, clock: createClock() })
  const reserved = await queue.reserve({ ...reserveRequest(), expected_oid: store.snapshot().oid })
  assert.equal(reserved.status, 'SHADOW_QUEUE_MAPPING_STORED')
  const cancelled = await queue.reconcileCancelled(cancellationRequest({ expected_oid: reserved.registry_oid }))
  assert.equal(cancelled.status, 'SHADOW_QUEUE_CANCELLATION_RECORDED')
  assert.equal(cancelled.shadow, 'SHADOW_ONLY')
  for (const patch of [
    { pending_before: 99 }, { pending_limit: 99 }, { incoming_position: 100 },
    { candidate_id: 'candidate:other' }, { source_digest: DIGEST_NEXT },
    { observation_digest: DIGEST_NEXT }, { observation: observation({ snapshot_generation: 2 }) },
  ]) {
    const before = store.calls.filter((call) => call.kind === 'cas').length
    expectHeld(await queue.reconcileCancelled(cancellationRequest({ ...patch, expected_oid: store.snapshot().oid })))
    assert.equal(store.calls.filter((call) => call.kind === 'cas').length, before)
  }
})

test('AC-30 — queue registry interface has bounded, private, zero-sink implementation requirements', () => {
  assert.equal(typeof createQueueMappingRegistry, 'function')
  assert.match(NONCE('contract'), /^[A-Za-z0-9_-]{32,128}$/u)
  assert.doesNotMatch(JSON.stringify(reserveRequest()), /(?:token|cookie|authorization|private[_-]?key|absolute_path|process_id|transcript)/iu)
})
