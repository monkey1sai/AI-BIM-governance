import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  ZERO_OID,
  createGitCasStore,
  createCommandJournal,
  createLeaseRegistry,
  createManagedBranchRegistry,
  createPlanRegistry,
  parseManagedBranchRecord,
  parseSessionLease,
  parseSessionLeaseRegistry,
} from '../../lib/parallel-delivery-fabric-registry.mjs'
import { evaluateAdmission } from '../../lib/parallel-delivery-fabric-admission.mjs'

import { FABRIC_SCHEMA_VERSION, canonicalize, digestCanonical, normalizeScopeResource } from '../../lib/parallel-delivery-fabric-contract.mjs'
import { createParallelDeliveryFabric } from '../../lib/parallel-delivery-fabric.mjs'

const SHA1 = 'a'.repeat(40)
const SHA256 = 'b'.repeat(64)
const ENVELOPE_OID = 'e'.repeat(40)
const REVOKED_ENVELOPE_OID = 'f'.repeat(40)
const NONCE = (suffix) => `${suffix}`.padEnd(32, 'n').slice(0, 32)
const scopeFromResourceKeys = (resourceKeys) => resourceKeys.map((key) => {
  const separator = key.indexOf(':')
  const kind = key.slice(0, separator)
  const value = key.slice(separator + 1)
  if (kind === 'path') return normalizeScopeResource({ kind, path: value })
  if (kind === 'glob') return normalizeScopeResource({ kind, pattern: value })
  if (kind === 'rename') {
    const [old_path, new_path] = value.split(':')
    return normalizeScopeResource({ kind, old_path, new_path })
  }
  return normalizeScopeResource({ kind, resource_key: value })
}).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)))
const scopeDigestFromResourceKeys = (resourceKeys) => {
  try { return digestCanonical(scopeFromResourceKeys(resourceKeys)) } catch { return SHA256 }
}
const DEFAULT_RESOURCE_KEYS = ['path:scripts/lib/parallel-delivery-fabric-registry.mjs']
const DEFAULT_SCOPE_DIGEST = scopeDigestFromResourceKeys(DEFAULT_RESOURCE_KEYS)

const createClock = (initial = '2026-08-29T00:00:00.000Z') => {
  let value = initial
  return {
    now: () => value,
    set: (next) => { value = next },
  }
}

const createInMemoryGit = ({ raceBarrier = undefined, failUpdateAt = undefined } = {}) => {
  const refs = new Map()
  const blobs = new Map()
  const calls = []
  let updateCalls = 0

  const oidFor = (value) => createHash('sha1').update(value).digest('hex')

  return {
    calls,
    refs,
    blobs,
    async run({ args, input, env, commonDir }) {
      calls.push({ args: [...args], input, env: { ...env }, commonDir })
      const [command, ...rest] = args
      if (command === 'hash-object') {
        assert.deepEqual(rest, ['-w', '--stdin'])
        const oid = oidFor(input)
        blobs.set(oid, input)
        return { exitCode: 0, stdout: `${oid}\n`, stderr: '' }
      }
      if (command === 'show-ref') {
        const quiet = rest[1] === '--quiet'
        assert.deepEqual(rest.slice(0, 3), ['--verify', quiet ? '--quiet' : '--hash', '--'])
        const value = refs.get(rest[3])
        return value
          ? { exitCode: 0, stdout: quiet ? '' : `${value}\n`, stderr: '' }
          : { exitCode: 1, stdout: '', stderr: '' }
      }
      if (command === 'cat-file') {
        assert.deepEqual(rest.slice(0, 2), ['blob', '--'])
        const value = blobs.get(rest[2])
        return value === undefined
          ? { exitCode: 1, stdout: '', stderr: 'missing blob' }
          : { exitCode: 0, stdout: value, stderr: '' }
      }
      if (command === 'update-ref') {
        if (rest.length === 2 && rest[0] === '--no-deref' && rest[1] === '--stdin') {
          const lines = input.trimEnd().split('\n')
          assert.equal(lines[0], 'start')
          assert.equal(lines.at(-1), 'commit')
          const verify = lines.find((line) => line.startsWith('verify '))?.split(' ')
          const update = lines.find((line) => line.startsWith('update '))?.split(' ')
          assert.equal(lines.includes('prepare'), true)
          assert.equal(verify?.length, 3)
          assert.equal(update?.length, 4)
          updateCalls += 1
          if (updateCalls === failUpdateAt) return { exitCode: 128, stdout: '', stderr: 'forced fake update failure' }
          const [, guardRef, guardOid] = verify
          const [, ref, nextOid, expectedOid] = update
          if ((refs.get(guardRef) ?? ZERO_OID) !== guardOid || (refs.get(ref) ?? ZERO_OID) !== expectedOid) {
            return { exitCode: 128, stdout: '', stderr: 'stale old value' }
          }
          refs.set(ref, nextOid)
          return { exitCode: 0, stdout: '', stderr: '' }
        }
        assert.deepEqual(rest.slice(0, 1), ['--no-deref'])
        const [, ref, nextOid, expectedOid] = rest
        updateCalls += 1
        if (updateCalls === failUpdateAt) return { exitCode: 128, stdout: '', stderr: 'forced fake update failure' }
        if (raceBarrier && updateCalls <= 2) await raceBarrier()
        const actual = refs.get(ref) ?? ZERO_OID
        if (actual !== expectedOid) return { exitCode: 128, stdout: '', stderr: 'stale old value' }
        refs.set(ref, nextOid)
        return { exitCode: 0, stdout: '', stderr: '' }
      }
      throw new Error(`unexpected fake git command: ${args.join(' ')}`)
    },
  }
}

const createEffects = () => ({
  branch: 0,
  worktree: 0,
  network: 0,
  board: 0,
  process: 0,
  cleanup: 0,
})

const makePlan = ({ planId = 'plan:one', generation = 1 } = {}) => ({
  schema_version: FABRIC_SCHEMA_VERSION,
  plan_id: planId,
  generation,
  repo_identity: { full_name: 'acme/bim', repository_id: 1, common_dir_digest: SHA256 },
  created_at: '2026-08-29T00:00:00.000Z',
  coordinator_session: 'session:coordinator',
  baseline_ref: 'origin/main',
  resolved_baseline_sha: SHA1,
  tasks: [{
    task_id: 'task:one',
    outcome: 'registry-contract',
    provider_preference: 'codex',
    owner_session: 'session:owner-one',
    scope: {
      owning_service: 'delivery-fabric',
      public_entrypoint: 'scripts/lib/parallel-delivery-fabric-registry.mjs',
      resources: [{ kind: 'path', path: 'scripts/lib/parallel-delivery-fabric-registry.mjs' }],
      expected_tests: ['test:registry'],
      e2e_required: false,
    },
    dependencies: [],
    risk: 'bounded',
    e2e_required: false,
  }],
  requested_capacity: { writers: 1, runtime_leases: 0 },
  branch_profile: 'trunk',
  acceptance_criteria: ['criterion:registry'],
  promotion_mode: 'single_pr',
  requested_execution_level: 'plan_only',
  authority_reference: 'authority:plan',
  governance_source_refs: ['openspec:parallel-delivery-fabric'],
})

const SEEDED_PLAN_RECORD = (() => {
  const plan = makePlan()
  const base = {
    schema_version: 'delivery-plan-registry/v1', generation: plan.generation, nonce: NONCE('seeded-plan'),
    created_at: '2026-08-29T00:00:00.000Z', updated_at: '2026-08-29T00:00:00.000Z',
    plan, plan_digest: digestCanonical(plan), execution: { level: 'plan_only', side_effect_class: 'CONTROL_METADATA' },
  }
  return { ...base, canonical_digest: digestCanonical(base) }
})()
const SEEDED_PLAN_BLOB = JSON.stringify(canonicalize(SEEDED_PLAN_RECORD))
const SEEDED_PLAN_OID = createHash('sha1').update(SEEDED_PLAN_BLOB).digest('hex')

const makeRequest = (store, overrides = {}) => {
  const resourceKeys = overrides.resource_keys ?? DEFAULT_RESOURCE_KEYS
  return {
    lease_id: overrides.lease_id ?? 'lease:one',
    plan_id: overrides.plan_id ?? 'plan:one',
    generation: overrides.generation ?? 1,
    task_id: overrides.task_id ?? 'task:one',
    provider: overrides.provider ?? 'codex',
    owner_session: overrides.owner_session ?? 'session:owner-one',
    provider_session_id: overrides.provider_session_id ?? 'provider:one',
    execution_context_id: overrides.execution_context_id ?? 'context:one',
    context_attestation_ref: overrides.context_attestation_ref ?? 'attestation:one',
    common_dir_digest: overrides.common_dir_digest ?? store.commonDirDigest,
    worktree_id: overrides.worktree_id ?? 'worktree:one',
    worktree_path_digest: overrides.worktree_path_digest ?? SHA256,
    branch: overrides.branch ?? 'codex/registry-one',
    scope_digest: overrides.scope_digest ?? scopeDigestFromResourceKeys(resourceKeys),
    head_sha: overrides.head_sha ?? SHA1,
    resource_keys: resourceKeys,
    nonce: overrides.nonce ?? NONCE('admission-one'),
    expected_plan_oid: overrides.expected_plan_oid ?? SEEDED_PLAN_OID,
  }
}

// Owner/session-bound proof that ends a lease: the same closed attestation shape the
// release path consumes, bound to the exact lease tuple.
const endAttestation = (lease, overrides = {}) => ({
  attestation_ref: `attestation:end-${lease.lease_id}`,
  attestation_digest: SHA256,
  issuer_id: 'attestor:owner-end',
  issuer_version: 'owner-end/v1',
  owner_session: lease.owner_session,
  provider: lease.provider,
  provider_session_id: lease.provider_session_id,
  execution_context_id: lease.execution_context_id,
  lease_id: lease.lease_id,
  generation: lease.generation,
  head_sha: lease.head_sha,
  scope_digest: lease.scope_digest,
  worktree_path_digest: lease.worktree_path_digest,
  observed_at: '2026-08-29T00:00:00.000Z',
  expires_at: '2026-08-29T00:10:00.000Z',
  nonce: NONCE(`end-${lease.lease_id.replace(/[^A-Za-z0-9]/gu, '')}`),
  revocation_epoch: lease.revocation_epoch,
  ...overrides,
})

const createTrustedAttestor = () => ({
  calls: [],
  async verify({ attestation, lease }) {
    this.calls.push({ attestation, lease })
    if (attestation?.force === 'unknown') return { verdict: 'UNKNOWN' }
    return { verdict: 'TRUSTED', attestation: structuredClone(attestation) }
  },
})

const createEnvelopePort = () => {
  let oid = ENVELOPE_OID
  let transitionSequence = 0
  const calls = []
  return {
    calls,
    async revoke(request) {
      calls.push(structuredClone(request))
      if (request.expected_envelope_oid !== oid || request.expected_transition_sequence !== transitionSequence) {
        return { status: 'CONFLICT', actual_oid: oid }
      }
      const previousOid = oid
      oid = REVOKED_ENVELOPE_OID
      transitionSequence += 1
      if (request.force_in_flight) {
        return {
          status: 'REVOKED', previous_oid: previousOid, oid, transition_sequence: transitionSequence,
          revocation_epoch: 0, in_flight_command: true,
        }
      }
      return {
        status: 'REVOKED', previous_oid: previousOid, oid, transition_sequence: transitionSequence,
        revocation_epoch: 0, in_flight_command: false,
      }
    },
  }
}

// Every release revokes an execution envelope; this port issues a distinct OID per
// revocation so one fixture can release several leases.
const createSequencedEnvelopePort = () => {
  let oid = ENVELOPE_OID
  let transitionSequence = 0
  let revocations = 0
  return {
    current: () => ({ oid, transitionSequence }),
    async revoke(request) {
      if (request.expected_envelope_oid !== oid || request.expected_transition_sequence !== transitionSequence) {
        return { status: 'CONFLICT', actual_oid: oid }
      }
      const previousOid = oid
      revocations += 1
      oid = `${'c'.repeat(39)}${revocations.toString(16)}`
      transitionSequence += 1
      return { status: 'REVOKED', previous_oid: previousOid, oid, transition_sequence: transitionSequence, revocation_epoch: 0, in_flight_command: false }
    },
  }
}

// Admit, end (handoff) and release one lease through a sequenced envelope port.
const handOff = async ({ leaseRegistry, store, envelope, clock }, leaseId, overrides, suffix) => {
  const admitted = await leaseRegistry.admit(makeRequest(store, { lease_id: leaseId, ...overrides }))
  assert.equal(admitted.status, 'ADMITTED', JSON.stringify(admitted))
  const end = await leaseRegistry.endRequest({
    lease_id: leaseId, expected_oid: admitted.oid, nonce: NONCE(`${suffix}-end`), reason: 'handoff',
    handoff_or_candidate_reference: `handoff:${suffix}`, owner_end_attestation: endAttestation(admitted.lease),
  })
  const attestation = {
    attestation_ref: `attestation:${suffix}`, attestation_digest: SHA256,
    issuer_id: 'attestor:owner-end', issuer_version: 'owner-end/v1', owner_session: admitted.lease.owner_session,
    provider: 'codex', provider_session_id: admitted.lease.provider_session_id, execution_context_id: admitted.lease.execution_context_id,
    lease_id: leaseId, generation: 1, head_sha: admitted.lease.head_sha, scope_digest: admitted.lease.scope_digest,
    worktree_path_digest: SHA256, observed_at: clock.now(),
    expires_at: new Date(Date.parse(clock.now()) + 10 * 60 * 1000).toISOString(), nonce: NONCE(`${suffix}-owner-end`), revocation_epoch: 0,
  }
  const { oid: envelopeOid, transitionSequence } = envelope.current()
  const released = await leaseRegistry.release({
    lease_id: leaseId, expected_oid: end.oid, expected_envelope_oid: envelopeOid,
    expected_envelope_transition_sequence: transitionSequence, attestation,
  })
  assert.equal(released.status, 'RELEASED', JSON.stringify(released))
  return { admitted, attestation }
}

// A plan-owner drain attestation bound to the exact drain tuple.
const drainAttestation = ({ plan_id = 'plan:one', generation = 1, expected_oid, nonce, reason = 'handoff', suffix = 'drain' } = {}) => ({
  attestation_ref: `attestation:${suffix}`, attestation_digest: SHA256, issuer_id: 'attestor:plan-owner', issuer_version: 'plan-owner/v1',
  action: 'drain', plan_id, generation, expected_oid, nonce, reason,
  observed_at: '2026-08-29T00:00:00.000Z', expires_at: '2026-08-29T00:10:00.000Z', revocation_epoch: 0,
})

const createFixture = ({ raceBarrier = undefined, writerCap = 2, failUpdateAt = undefined, seedPlan = true } = {}) => {
  const git = createInMemoryGit({ raceBarrier, failUpdateAt })
  if (seedPlan) {
    git.blobs.set(SEEDED_PLAN_OID, SEEDED_PLAN_BLOB)
    git.refs.set('refs/ai-bim/delivery-plans', SEEDED_PLAN_OID)
  }
  const clock = createClock()
  const store = createGitCasStore({ git, commonDir: 'C:/fake/common-dir' })
  const attestor = createTrustedAttestor()
  const envelope = createEnvelopePort()
  return {
    git,
    clock,
    store,
    planRegistry: createPlanRegistry({ store, clock }),
    leaseRegistry: createLeaseRegistry({ store, clock, writerCap, ownerEndAttestor: attestor, executionEnvelope: envelope }),
    attestor,
    envelope,
  }
}

const latestLeaseOid = async (leaseRegistry) => (await leaseRegistry.inspect()).oid

test('AC-44 — plan-only metadata uses the delivery-plan ref and no forbidden effects', async () => {
  const { git, planRegistry } = createFixture({ seedPlan: false })
  const effects = createEffects()

  const submitted = await planRegistry.submit({
    plan: makePlan(),
    expected_oid: ZERO_OID,
    nonce: NONCE('plan-submit'),
    execution: { level: 'plan_only', side_effect_class: 'CONTROL_METADATA' },
    effects,
  })

  assert.equal(submitted.status, 'STORED')
  assert.match(submitted.ref, /^refs\/ai-bim\/delivery-plans\/[0-9a-f]{64}$/u)
  assert.equal(git.blobs.size, 1)
  assert.deepEqual(effects, createEffects())
  assert.deepEqual([...git.refs.keys()], [submitted.ref])
  assert.equal(submitted.record.schema_version, 'delivery-plan-registry/v1')
  assert.equal(submitted.record.generation, 1)
  assert.equal(submitted.record.nonce, NONCE('plan-submit'))
  assert.match(submitted.record.canonical_digest, /^[0-9a-f]{64}$/u)

  const second = await planRegistry.submit({
    plan: makePlan({ planId: 'plan:second' }),
    expected_oid: ZERO_OID,
    nonce: NONCE('plan-second'),
    execution: { level: 'plan_only', side_effect_class: 'CONTROL_METADATA' },
  })
  assert.equal(second.status, 'STORED')
  assert.notEqual(second.ref, submitted.ref)
  assert.equal(git.refs.get(submitted.ref), submitted.oid)
  assert.equal((await planRegistry.inspect('plan:one')).oid, submitted.oid)
  assert.equal((await planRegistry.inspect('plan:second')).oid, second.oid)

  const stale = await planRegistry.submit({
    plan: makePlan({ planId: 'plan:second' }),
    expected_oid: ZERO_OID,
    nonce: NONCE('plan-stale'),
    execution: { level: 'plan_only', side_effect_class: 'CONTROL_METADATA' },
  })
  assert.equal(stale.status, 'CONFLICT')
  assert.equal(stale.reason, 'CAS_CONFLICT')
  assert.equal(stale.actual_oid, second.oid)
  await assert.rejects(
    planRegistry.submit({
      plan: makePlan({ planId: 'plan:forbidden' }),
      expected_oid: submitted.oid,
      nonce: NONCE('plan-forbidden'),
      execution: { level: 'implement_local', side_effect_class: 'CANDIDATE_FILESYSTEM' },
    }),
    (error) => error?.code === 'plan_only_metadata_required',
  )
})

test('plan registry rejects a semantic rewrite at the same generation and later lease validation pins the admitted plan OID', async () => {
  const { planRegistry, leaseRegistry, store } = createFixture()
  const rewritten = makePlan()
  rewritten.tasks[0].outcome = 'same-generation-substitution'
  const rejected = await planRegistry.submit({
    plan: rewritten,
    expected_oid: SEEDED_PLAN_OID,
    nonce: NONCE('same-generation-rewrite'),
    execution: { level: 'plan_only', side_effect_class: 'CONTROL_METADATA' },
  })
  assert.deepEqual({ status: rejected.status, reason: rejected.reason }, {
    status: 'CONFLICT', reason: 'PLAN_SAME_GENERATION_REWRITE',
  })
  assert.equal((await planRegistry.inspect()).oid, SEEDED_PLAN_OID)

  const request = makeRequest(store)
  assert.equal((await leaseRegistry.admit(request)).status, 'ADMITTED')
  const nextPlan = makePlan({ generation: 2 })
  const advanced = await planRegistry.submit({
    plan: nextPlan,
    expected_oid: SEEDED_PLAN_OID,
    nonce: NONCE('plan-generation-two'),
    execution: { level: 'plan_only', side_effect_class: 'CONTROL_METADATA' },
  })
  assert.equal(advanced.status, 'STORED')
  assert.deepEqual(await leaseRegistry.validateActive(request), {
    status: 'HELD_EXECUTION_AUTHORITY', reason: 'PLAN_REGISTRY_CHANGED',
  })
})

test('P1 regression — plan generation validation returns only the requested stored task authority', async () => {
  const { planRegistry } = createFixture()
  assert.deepEqual(await planRegistry.validateGeneration({ plan_id: 'plan:one', generation: 1, task_id: 'task:one' }), {
    status: 'ACTIVE', plan_id: 'plan:one', generation: 1, oid: SEEDED_PLAN_OID,
    task: {
      task_id: 'task:one', owner_session: 'session:owner-one', provider: 'codex', baseline_sha: SHA1,
      scope_digest: DEFAULT_SCOPE_DIGEST, dependencies: [],
    },
  })
  assert.deepEqual(await planRegistry.validateGeneration({ plan_id: 'plan:one', generation: 1, task_id: 'task:missing' }), {
    status: 'HELD_EXECUTION_AUTHORITY', reason: 'PLAN_TASK_NOT_FOUND',
  })
})

test('command journal persists reservation and committed outcome receipts across restarts', async () => {
  const { clock, store } = createFixture()
  const journal = createCommandJournal({ store, clock })
  const base = {
    journal_key: `journal:${SHA256}`, command_id: 'command:journal-one', command_digest: SHA256,
    attempt_id: 'attempt:journal-one', reservation_id: 'reservation:journal-one',
  }
  const reserved = await journal.reserve(base)
  assert.deepEqual(reserved, { ...base, status: 'RESERVED', acquired: true })
  assert.deepEqual(await journal.read({ journal_key: base.journal_key, command_id: base.command_id }), reserved)
  const outcome = { command_id: base.command_id, type: 'submit', status: 'SHADOW_STORED', reason: 'PLAN_STORED' }
  const committed = await journal.commit({ ...base, outcome_digest: digestCanonical(outcome), outcome })
  assert.deepEqual(committed, { ...base, outcome_digest: digestCanonical(outcome), outcome, status: 'COMMITTED' })
  const restarted = createCommandJournal({ store, clock })
  assert.deepEqual(await restarted.read({ journal_key: base.journal_key, command_id: base.command_id }), committed)
})

test('command journal same-key race has one durable reservation winner', async () => {
  const { clock, store } = createFixture()
  const left = createCommandJournal({ store, clock })
  const right = createCommandJournal({ store, clock })
  const request = {
    journal_key: `journal:${'c'.repeat(64)}`, command_id: 'command:journal-race', command_digest: 'c'.repeat(64),
    attempt_id: 'attempt:journal-race', reservation_id: 'reservation:journal-race',
  }
  const [first, second] = await Promise.all([left.reserve(request), right.reserve(request)])
  assert.deepEqual(first, second)
  const snapshot = await store.read(store.refs.commandJournal)
  assert.equal(snapshot.record.generation, 1)
  assert.deepEqual(Object.keys(snapshot.record.receipts), [request.journal_key])
})

test('command journal merges distinct concurrent reservations and commits without losing an executed outcome', async () => {
  const { clock, store } = createFixture()
  const left = createCommandJournal({ store, clock })
  const right = createCommandJournal({ store, clock })
  const requests = ['d', 'e'].map((character, index) => ({
    journal_key: `journal:${character.repeat(64)}`,
    command_id: `command:journal-distinct-${index + 1}`,
    command_digest: character.repeat(64),
    attempt_id: `attempt:journal-distinct-${index + 1}`,
    reservation_id: `reservation:journal-distinct-${index + 1}`,
  }))
  await Promise.all([left.reserve(requests[0]), right.reserve(requests[1])])
  const commits = requests.map((request, index) => {
    const outcome = { command_id: request.command_id, type: 'advance', status: 'SHADOW_INTENT', reason: `DISTINCT_${index + 1}` }
    return { ...request, outcome, outcome_digest: digestCanonical(outcome) }
  })
  const [leftCommitted, rightCommitted] = await Promise.all([
    left.commit(commits[0]),
    right.commit(commits[1]),
  ])

  assert.equal(leftCommitted.status, 'COMMITTED')
  assert.equal(rightCommitted.status, 'COMMITTED')
  const snapshot = await store.read(store.refs.commandJournal)
  assert.equal(snapshot.record.generation, 4)
  assert.deepEqual(Object.keys(snapshot.record.receipts).sort(), requests.map((request) => request.journal_key).sort())
  assert.equal(snapshot.record.receipts[requests[0].journal_key].outcome.reason, 'DISTINCT_1')
  assert.equal(snapshot.record.receipts[requests[1].journal_key].outcome.reason, 'DISTINCT_2')
})

test('P2 regression — command journal capacity is bounded without breaking committed replay', async () => {
  const { clock, store } = createFixture()
  const journal = createCommandJournal({ store, clock, receiptLimit: 2 })
  const requests = ['c', 'd', 'e'].map((character, index) => ({
    journal_key: `journal:${character.repeat(64)}`,
    command_id: `command:bounded-${index + 1}`,
    command_digest: character.repeat(64),
    attempt_id: `attempt:bounded-${index + 1}`,
    reservation_id: `reservation:bounded-${index + 1}`,
  }))
  await journal.reserve(requests[0])
  await journal.reserve(requests[1])
  const outcome = { command_id: requests[0].command_id, type: 'submit', status: 'SHADOW_STORED', reason: 'BOUNDED' }
  const committed = await journal.commit({ ...requests[0], outcome, outcome_digest: digestCanonical(outcome) })
  assert.equal(committed.status, 'COMMITTED')
  assert.equal((await journal.reserve(requests[2])).status, 'RESERVED')
  assert.deepEqual(await journal.read({ journal_key: requests[0].journal_key, command_id: requests[0].command_id }), committed)
  const snapshot = await store.read(store.refs.commandJournal)
  assert.equal(Object.keys(snapshot.record.receipts).length, 2)
  assert.equal(Object.hasOwn(snapshot.record.receipts, requests[0].journal_key), false)
  // An archived command key can never re-enter execution through a fresh reservation.
  assert.deepEqual(await journal.reserve(requests[0]), committed)
  await assert.rejects(journal.reserve({ ...requests[0], command_id: 'command:bounded-other' }), (error) => error?.detail === 'command_id_mismatch')
  assert.equal(Object.keys((await store.read(store.refs.commandJournal)).record.receipts).length, 2)
})

test('P2 regression — lease IDs that collide with Object.prototype names are admitted and looked up by own property', async () => {
  const { leaseRegistry, store } = createFixture()
  // Names the canonical record normalizer can never store are refused at the grammar.
  for (const reserved of ['constructor', '__proto__', 'prototype']) {
    await assert.rejects(async () => leaseRegistry.admit(makeRequest(store, { lease_id: reserved, nonce: NONCE('reserved') })),
      (error) => error?.code === 'invalid_value', reserved)
  }
  // Other Object.prototype names are legal ids: lookups must use own properties, not truthiness.
  for (const [leaseId, index] of [['toString', 0], ['valueOf', 1]]) {
    const admitted = await leaseRegistry.admit(makeRequest(store, {
      lease_id: leaseId, owner_session: `session:proto-${index}`, provider_session_id: `provider:proto-${index}`,
      execution_context_id: `context:proto-${index}`, worktree_id: `worktree:proto-${index}`, branch: `codex/proto-${index}`,
      resource_keys: [`path:src/proto-${index}.mjs`], nonce: NONCE(`proto-${index}`),
    }))
    assert.equal(admitted.status, 'ADMITTED', `${leaseId}: ${JSON.stringify(admitted)}`)
  }
  const snapshot = await leaseRegistry.inspect()
  assert.deepEqual(Object.keys(snapshot.record.leases).sort(), ['toString', 'valueOf'])
  assert.equal((await leaseRegistry.heartbeat({ lease_id: 'toString', expected_oid: snapshot.oid, heartbeat_seq: 10, nonce: NONCE('proto-heartbeat') })).status, 'HEARTBEAT_RECORDED')
  const fresh = await leaseRegistry.inspect()
  await assert.rejects(leaseRegistry.heartbeat({ lease_id: 'hasOwnProperty', expected_oid: fresh.oid, heartbeat_seq: 1, nonce: NONCE('proto-missing') }), (error) => error?.code === 'lease_not_found')
})

test('P2 regression — every contract-valid scope path serializes into an admissible lease resource key', async () => {
  const { leaseRegistry, store } = createFixture()
  // Realistic nested segments (no secret-shaped runs) padded to the exact contract bound.
  const longPath = (root, length) => {
    let path = root
    for (let index = 0; path.length < length; index += 1) path += `/dir${index}`
    return path.slice(0, length - 2) + 'ab'
  }
  const longest = longPath('src', 512)
  assert.equal(longest.length, 512)
  const admitted = await leaseRegistry.admit(makeRequest(store, {
    lease_id: 'lease:wide-scope',
    resource_keys: [`path:${longest}`, `glob:${longPath('lib', 500)}/**/*.mjs`, `rename:${longPath('old', 512)}:${longPath('new', 512)}`],
    nonce: NONCE('wide-scope'),
  }))
  assert.equal(admitted.status, 'ADMITTED', JSON.stringify(admitted))
  await assert.rejects(async () => leaseRegistry.admit(makeRequest(store, {
    lease_id: 'lease:wide-scope-over', resource_keys: [`path:${longest}x`], nonce: NONCE('wide-scope-over'),
  })), (error) => error?.code === 'invalid_value')
})

test('P2 regression — the Git CAS store admits queue-operation archive refs and still refuses unknown refs', async () => {
  const store = createGitCasStore({ git: createInMemoryGit(), commonDir: 'C:/fake/common-dir' })
  const archiveRef = `refs/ai-bim/queue-operation-archive/${'c'.repeat(64)}`
  assert.deepEqual(await store.read(archiveRef), { ref: archiveRef, oid: '0'.repeat(40), record: null })
  for (const forbidden of ['refs/ai-bim/queue-operation-archive/not-a-digest', 'refs/ai-bim/queue-operation-archive/', 'refs/ai-bim/queue-operation-archive']) {
    await assert.rejects(store.read(forbidden), (error) => error?.code === 'registry_ref_forbidden', forbidden)
  }
})

test('P2 regression — crossing the live-record threshold compacts released leases instead of blocking a disjoint writer', async () => {
  const git = createInMemoryGit()
  git.blobs.set(SEEDED_PLAN_OID, SEEDED_PLAN_BLOB)
  git.refs.set('refs/ai-bim/delivery-plans', SEEDED_PLAN_OID)
  const clock = createClock()
  const store = createGitCasStore({ git, commonDir: 'C:/fake/common-dir' })
  const envelope = createSequencedEnvelopePort()
  const attestor = createTrustedAttestor()
  const leaseRegistry = createLeaseRegistry({
    store, clock, writerCap: 2, ownerEndAttestor: attestor, executionEnvelope: envelope, retainedReleasedLeases: 64, liveLeaseCompactionThreshold: 1,
  })
  await handOff({ leaseRegistry, store, envelope, clock }, 'lease:threshold-a', { resource_keys: ['path:src/threshold-a.mjs'] }, 'threshold-a')
  let inspected = await leaseRegistry.inspect()
  assert.equal(inspected.record.leases['lease:threshold-a'].state, 'RELEASED')
  clock.set('2026-08-29T00:01:00.000Z')
  const admitted = await leaseRegistry.admit(makeRequest(store, {
    lease_id: 'lease:threshold-b', owner_session: 'session:threshold-b', provider_session_id: 'provider:threshold-b',
    execution_context_id: 'context:threshold-b', worktree_id: 'worktree:threshold-b', branch: 'codex/threshold-b',
    resource_keys: ['path:src/threshold-b.mjs'], nonce: NONCE('threshold-b-admit'),
  }))
  assert.equal(admitted.status, 'ADMITTED', JSON.stringify(admitted))
  inspected = await leaseRegistry.inspect()
  assert.equal(Object.hasOwn(inspected.record.leases, 'lease:threshold-a'), false)
  assert.deepEqual(Object.keys(inspected.record.retained_resources), ['lease:threshold-a'])
  assert.equal(inspected.record.leases['lease:threshold-b'].state, 'ACTIVE')
  assert.throws(() => createLeaseRegistry({ store, clock, writerCap: 2, liveLeaseCompactionThreshold: 0 }),
    (error) => error?.detail === 'live_lease_compaction_threshold_out_of_range')
})

test('P2 regression — Fabric inspect returns a re-authenticated plan-scoped lease projection', async () => {
  const git = createInMemoryGit()
  git.blobs.set(SEEDED_PLAN_OID, SEEDED_PLAN_BLOB)
  git.refs.set('refs/ai-bim/delivery-plans', SEEDED_PLAN_OID)
  const clock = createClock()
  const store = createGitCasStore({ git, commonDir: 'C:/fake/common-dir' })
  const envelope = createSequencedEnvelopePort()
  const attestor = createTrustedAttestor()
  const leaseRegistry = createLeaseRegistry({
    store, clock, writerCap: 2, ownerEndAttestor: attestor, executionEnvelope: envelope, retainedReleasedLeases: 1,
  })
  const fixture = { leaseRegistry, store, envelope, clock }
  await handOff(fixture, 'lease:projection-a', { resource_keys: ['path:src/projection-a.mjs'] }, 'projection-a')
  clock.set('2026-08-29T00:01:00.000Z')
  await handOff(fixture, 'lease:projection-b', {
    owner_session: 'session:projection-b', provider_session_id: 'provider:projection-b', execution_context_id: 'context:projection-b',
    worktree_id: 'worktree:projection-b', branch: 'codex/projection-b', resource_keys: ['path:src/projection-b.mjs'],
  }, 'projection-b')
  const inspected = await leaseRegistry.inspect()
  const ownStub = inspected.record.retained_resources['lease:projection-a']
  const [ownAttestationRef, ownAttestation] = Object.entries(inspected.record.used_owner_end_attestations)[0]
  // Another plan's retained truth and consumed attestations live in the same registry record.
  const { canonical_digest: _digest, ...unsigned } = {
    ...inspected.record,
    retained_resources: {
      ...inspected.record.retained_resources,
      'lease:other': { ...ownStub, lease_id: 'lease:other', plan_id: 'plan:other', branch: 'codex/other', worktree_id: 'worktree:other', resource_keys: ['path:src/other.mjs'], scope_digest: scopeDigestFromResourceKeys(['path:src/other.mjs']) },
    },
    used_owner_end_attestations: {
      ...inspected.record.used_owner_end_attestations,
      'attestation:other-end': { ...ownAttestation, lease_id: 'lease:other', nonce: NONCE('other-end'), release_id: 'release:other' },
    },
  }
  const crafted = { ...unsigned, canonical_digest: digestCanonical(unsigned) }
  parseSessionLeaseRegistry(crafted)
  const ports = {
    commandJournal: { read: async () => null, reserve: async () => ({}), commit: async () => ({}) },
    planRegistry: { submit: async () => ({}), validateGeneration: async () => ({}), inspect: async () => ({ oid: '0'.repeat(40), record: null }) },
    leaseRegistry: {
      admit: async () => ({}), validateActive: async () => ({}), validateDependencies: async () => ({}), reconcileTimeout: async () => ({}),
      drainPlan: async () => ({}), release: async () => ({}), releaseRetainedResources: async () => ({}),
      inspect: async () => ({ oid: inspected.oid, record: crafted }),
    },
    execution: { advance: () => ({}) },
    providerAdapters: { codex: { preflight: () => ({}) }, claude: { preflight: () => ({}) } },
  }
  const result = await createParallelDeliveryFabric(ports).inspect('plan:one')
  assert.equal(result.status, undefined, JSON.stringify(result))
  assert.deepEqual(result.leases.projection, { scope: 'plan', plan_id: 'plan:one', source_oid: inspected.oid, source_digest: crafted.canonical_digest })
  assert.deepEqual(Object.keys(result.leases.record.retained_resources), ['lease:projection-a'])
  assert.deepEqual(Object.keys(result.leases.record.leases), ['lease:projection-b'])
  assert.equal(Object.hasOwn(result.leases.record.used_owner_end_attestations, 'attestation:other-end'), false)
  assert.equal(Object.hasOwn(result.leases.record.used_owner_end_attestations, ownAttestationRef), true)
  assert.notEqual(result.leases.record.canonical_digest, crafted.canonical_digest)
  // The projection authenticates on its own: a consumer can pass it straight back through the registry parser.
  assert.doesNotThrow(() => parseSessionLeaseRegistry(structuredClone(result.leases.record)))
})

test('AC-01 — cross-provider disjoint writers are admitted', async () => {
  const { leaseRegistry, store } = createFixture()

  const codex = await leaseRegistry.admit(makeRequest(store, {
    lease_id: 'lease:codex', provider: 'codex', resource_keys: ['path:src/codex.mjs'], nonce: NONCE('codex'),
  }))
  const claude = await leaseRegistry.admit(makeRequest(store, {
    lease_id: 'lease:claude', provider: 'claude', owner_session: 'session:owner-claude',
    provider_session_id: 'provider:claude', execution_context_id: 'context:claude',
    worktree_id: 'worktree:claude', branch: 'claude/registry', resource_keys: ['path:src/claude.mjs'], nonce: NONCE('claude'),
  }))
  const third = await leaseRegistry.admit(makeRequest(store, {
    lease_id: 'lease:third', provider: 'codex', owner_session: 'session:owner-third',
    provider_session_id: 'provider:third', execution_context_id: 'context:third',
    worktree_id: 'worktree:third', branch: 'codex/third', resource_keys: ['path:src/third.mjs'], nonce: NONCE('third'),
  }))

  assert.equal(codex.status, 'ADMITTED')
  assert.equal(claude.status, 'ADMITTED')
  assert.equal(third.status, 'ADMITTED')
  const snapshot = await leaseRegistry.inspect()
  assert.equal(snapshot.record.leases['lease:codex'].provider, 'codex')
  assert.equal(snapshot.record.leases['lease:claude'].provider, 'claude')
  assert.equal(snapshot.record.leases['lease:third'].provider, 'codex')
  assert.equal(snapshot.record.writer_cap, 2)
})

test('AC-02 — same-provider disjoint sessions are admitted without a writer-count cap', async () => {
  const { leaseRegistry, store } = createFixture()
  for (const suffix of ['one', 'two', 'three']) {
    const result = await leaseRegistry.admit(makeRequest(store, {
      lease_id: `lease:${suffix}`,
      owner_session: `session:${suffix}`,
      provider_session_id: `provider:${suffix}`,
      execution_context_id: `context:${suffix}`,
      worktree_id: `worktree:${suffix}`,
      branch: `codex/${suffix}`,
      resource_keys: [`path:src/${suffix}.mjs`],
      nonce: NONCE(`same-${suffix}`),
    }))
    assert.equal(result.status, 'ADMITTED')
  }
  const contended = await leaseRegistry.admit(makeRequest(store, {
    lease_id: 'lease:same-branch', owner_session: 'session:same-branch',
    provider_session_id: 'provider:same-branch', execution_context_id: 'context:same-branch',
    worktree_id: 'worktree:same-branch', branch: 'codex/one',
    resource_keys: ['path:src/other.mjs'], nonce: NONCE('same-branch'),
  }))
  assert.deepEqual({ status: contended.status, reason: contended.reason }, {
    status: 'QUEUED_FOR_LEASE', reason: 'BRANCH_CONTENTION',
  })
})

test('hierarchical and glob resource overlap queues the second writer while disjoint scopes remain admissible', async () => {
  for (const [heldKey, requestedKey] of [
    ['path:src', 'path:src/file.mjs'],
    ['path:src/file.mjs', 'path:src'],
    ['glob:src/*.mjs', 'path:src/file.mjs'],
    ['glob:src*/*.mjs', 'path:src-other/a.mjs'],
    ['path:src-other/a.mjs', 'glob:src*/*.mjs'],
    ['glob:foo?bar/*.mjs', 'glob:fooxbar/*.mjs'],
    ['glob:src[0-9]/*.mjs', 'path:src1/a.mjs'],
    ['rename:src/file.mjs:src/file2.mjs', 'glob:src/*.mjs'],
    ['glob:src/*.mjs', 'rename:src/file.mjs:src/file2.mjs'],
    ['shared_contract:contract:foo', 'exported_symbol:contract:foo'],
  ]) {
    const { leaseRegistry, store } = createFixture()
    assert.equal((await leaseRegistry.admit(makeRequest(store, { resource_keys: [heldKey] }))).status, 'ADMITTED')
    const second = await leaseRegistry.admit(makeRequest(store, {
      lease_id: 'lease:overlap', owner_session: 'session:overlap', provider_session_id: 'provider:overlap',
      execution_context_id: 'context:overlap', worktree_id: 'worktree:overlap', branch: 'codex/overlap',
      resource_keys: [requestedKey], nonce: NONCE(`overlap-${requestedKey.length}`),
    }))
    assert.deepEqual({ status: second.status, reason: second.reason }, { status: 'QUEUED_FOR_LEASE', reason: 'RESOURCE_CONFLICT' })
  }
  const { leaseRegistry, store } = createFixture()
  assert.equal((await leaseRegistry.admit(makeRequest(store, { resource_keys: ['path:src/one'] }))).status, 'ADMITTED')
  assert.equal((await leaseRegistry.admit(makeRequest(store, {
    lease_id: 'lease:disjoint', owner_session: 'session:disjoint', provider_session_id: 'provider:disjoint',
    execution_context_id: 'context:disjoint', worktree_id: 'worktree:disjoint', branch: 'codex/disjoint',
    resource_keys: ['path:docs/two'], nonce: NONCE('disjoint-hierarchy'),
  }))).status, 'ADMITTED')
})

test('canonical leading-metachar repository globs remain valid lease resources', async () => {
  for (const resourceKey of ['glob:**/*.mjs', 'glob:{src,docs}/*.mjs', 'glob:[ab]/*.mjs']) {
    const { leaseRegistry, store } = createFixture()
    const result = await leaseRegistry.admit(makeRequest(store, { resource_keys: [resourceKey] }))
    assert.equal(result.status, 'ADMITTED', resourceKey)
  }
})

test('malformed glob resources fail closed before a lease can be persisted', async () => {
  for (const resourceKey of ['glob:src/[abc', 'glob:src/{a,b', 'glob:src/[]/*.mjs', 'glob:src/orphan]/*.mjs']) {
    const { leaseRegistry, store } = createFixture()
    await assert.rejects(
      leaseRegistry.admit(makeRequest(store, { resource_keys: [resourceKey] })),
      (error) => error?.code === 'invalid_value',
      resourceKey,
    )
    assert.equal((await leaseRegistry.inspect()).record.leases['lease:one'], undefined)
  }
})

test('plan drain is durable and blocks every later admission for the same plan', async () => {
  const { leaseRegistry, planRegistry, store } = createFixture()
  assert.equal((await leaseRegistry.admit(makeRequest(store))).status, 'ADMITTED')
  const beforeDrain = await leaseRegistry.inspect()
  // Knowing the inspectable OIDs is not authority: a drain without the owner attestation,
  // with a mismatched tuple, or one the attestor does not trust never lands.
  await assert.rejects(leaseRegistry.drainPlan({
    plan_id: 'plan:one', generation: 1, expected_oid: beforeDrain.oid,
    expected_plan_oid: SEEDED_PLAN_OID, nonce: NONCE('plan-drain'), reason: 'handoff',
  }), (error) => error?.code === 'invalid_shape' && error?.detail === 'plan_drain_request_keys_invalid')
  await assert.rejects(leaseRegistry.drainPlan({
    plan_id: 'plan:one', generation: 1, expected_oid: beforeDrain.oid,
    expected_plan_oid: SEEDED_PLAN_OID, nonce: NONCE('plan-drain'), reason: 'handoff',
    owner_attestation: drainAttestation({ expected_oid: beforeDrain.oid, nonce: NONCE('plan-drain'), reason: 'failed' }),
  }), (error) => error?.code === 'invalid_value' && error?.detail === 'plan_drain_request_attestation_tuple_mismatch')
  const untrusted = await leaseRegistry.drainPlan({
    plan_id: 'plan:one', generation: 1, expected_oid: beforeDrain.oid,
    expected_plan_oid: SEEDED_PLAN_OID, nonce: NONCE('plan-drain'), reason: 'handoff',
    owner_attestation: { ...drainAttestation({ expected_oid: beforeDrain.oid, nonce: NONCE('plan-drain') }), force: 'unknown' },
  }).catch((error) => ({ status: 'REJECTED', reason: error?.code }))
  assert.notEqual(untrusted.status, 'DRAINING')
  const drained = await leaseRegistry.drainPlan({
    plan_id: 'plan:one', generation: 1, expected_oid: beforeDrain.oid,
    expected_plan_oid: SEEDED_PLAN_OID, nonce: NONCE('plan-drain'), reason: 'handoff',
    owner_attestation: drainAttestation({ expected_oid: beforeDrain.oid, nonce: NONCE('plan-drain') }),
  })
  assert.equal(drained.status, 'DRAINING')
  assert.equal(drained.plan_id, 'plan:one')
  assert.deepEqual(await leaseRegistry.validateActive(makeRequest(store)), { status: 'ACTIVE', lease_id: 'lease:one' })
  assert.deepEqual(await leaseRegistry.validateActive(makeRequest(store, { head_sha: 'b'.repeat(40) })), {
    status: 'HELD_EXECUTION_AUTHORITY', reason: 'ACTIVE_LEASE_BINDING_MISMATCH',
  })
  const blocked = await leaseRegistry.admit(makeRequest(store, {
    lease_id: 'lease:same-plan-after-drain', owner_session: 'session:same-plan-after-drain',
    provider_session_id: 'provider:same-plan-after-drain', execution_context_id: 'context:same-plan-after-drain',
    worktree_id: 'worktree:same-plan-after-drain', branch: 'codex/same-plan-after-drain',
    resource_keys: ['path:docs/after-drain.mjs'], nonce: NONCE('same-plan-after-drain'),
  }))
  assert.deepEqual({ status: blocked.status, reason: blocked.reason }, { status: 'QUEUED_FOR_LEASE', reason: 'PLAN_DRAINING' })
  // The drain is bound to generation 1: the plan's next generation admits again.
  const nextGeneration = await planRegistry.submit({
    plan: makePlan({ generation: 2 }), expected_oid: SEEDED_PLAN_OID, nonce: NONCE('plan-gen2-submit'),
    execution: { level: 'plan_only', side_effect_class: 'CONTROL_METADATA' },
  })
  assert.equal(nextGeneration.status, 'STORED')
  const nextGenerationLease = await leaseRegistry.admit(makeRequest(store, {
    lease_id: 'lease:gen2', generation: 2, owner_session: 'session:gen2', provider_session_id: 'provider:gen2',
    execution_context_id: 'context:gen2', worktree_id: 'worktree:gen2', branch: 'codex/gen2',
    resource_keys: ['path:docs/gen2.mjs'], nonce: NONCE('gen2-admit'), expected_plan_oid: nextGeneration.oid,
  }))
  assert.notEqual(nextGenerationLease.reason, 'PLAN_DRAINING', JSON.stringify(nextGenerationLease))
  // The newer active generation can be drained on its own; the older drain stays immutable.
  const beforeGen2Drain = await leaseRegistry.inspect()
  const gen2Drain = await leaseRegistry.drainPlan({
    plan_id: 'plan:one', generation: 2, expected_oid: beforeGen2Drain.oid,
    expected_plan_oid: nextGeneration.oid, nonce: NONCE('plan-drain-gen2'), reason: 'failed',
    owner_attestation: drainAttestation({ generation: 2, expected_oid: beforeGen2Drain.oid, nonce: NONCE('plan-drain-gen2'), reason: 'failed', suffix: 'drain-gen2' }),
  })
  assert.equal(gen2Drain.status, 'DRAINING', JSON.stringify(gen2Drain))
  const gen2Blocked = await leaseRegistry.admit(makeRequest(store, {
    lease_id: 'lease:gen2-after-drain', generation: 2, owner_session: 'session:gen2-after', provider_session_id: 'provider:gen2-after',
    execution_context_id: 'context:gen2-after', worktree_id: 'worktree:gen2-after', branch: 'codex/gen2-after',
    resource_keys: ['path:docs/gen2-after.mjs'], nonce: NONCE('gen2-after-admit'), expected_plan_oid: nextGeneration.oid,
  }))
  assert.deepEqual({ status: gen2Blocked.status, reason: gen2Blocked.reason }, { status: 'QUEUED_FOR_LEASE', reason: 'PLAN_DRAINING' })
  const afterGen2Drain = await leaseRegistry.inspect()
  const olderDrain = await leaseRegistry.drainPlan({
    plan_id: 'plan:one', generation: 1, expected_oid: afterGen2Drain.oid,
    expected_plan_oid: nextGeneration.oid, nonce: NONCE('plan-drain-old'), reason: 'handoff',
    owner_attestation: drainAttestation({ expected_oid: afterGen2Drain.oid, nonce: NONCE('plan-drain-old'), suffix: 'drain-old' }),
  })
  assert.notEqual(olderDrain.status, 'DRAINING')
  const otherPlanSnapshot = await planRegistry.submit({
    plan: makePlan({ planId: 'plan:other' }),
    expected_oid: ZERO_OID,
    nonce: NONCE('other-plan-submit'),
    execution: { level: 'plan_only', side_effect_class: 'CONTROL_METADATA' },
  })
  assert.equal(otherPlanSnapshot.status, 'STORED')
  const otherPlan = await leaseRegistry.admit(makeRequest(store, {
    lease_id: 'lease:other-plan', plan_id: 'plan:other', owner_session: 'session:other-plan',
    provider_session_id: 'provider:other-plan', execution_context_id: 'context:other-plan',
    worktree_id: 'worktree:other-plan', branch: 'codex/other-plan',
    resource_keys: ['path:docs/other-plan.mjs'], nonce: NONCE('other-plan'), expected_plan_oid: otherPlanSnapshot.oid,
  }))
  assert.equal(otherPlan.status, 'ADMITTED')
})

test('plan rotation between validation and lease CAS cannot admit against a stale generation snapshot', async () => {
  const fixture = createFixture()
  let rotated = false
  const guardedStore = {
    commonDirDigest: fixture.store.commonDirDigest,
    refs: fixture.store.refs,
    read: fixture.store.read,
    cas: fixture.store.cas,
    async casGuarded(request) {
      if (!rotated) {
        rotated = true
        const stored = await fixture.planRegistry.submit({
          plan: makePlan({ generation: 2 }), expected_oid: SEEDED_PLAN_OID, nonce: NONCE('plan-race'),
          execution: { level: 'plan_only', side_effect_class: 'CONTROL_METADATA' }, effects: createEffects(),
        })
        assert.equal(stored.status, 'STORED')
      }
      return fixture.store.casGuarded(request)
    },
  }
  const registry = createLeaseRegistry({ store: guardedStore, clock: fixture.clock })
  const result = await registry.admit(makeRequest(guardedStore, { expected_plan_oid: SEEDED_PLAN_OID }))
  assert.deepEqual(result, { status: 'HELD_EXECUTION_AUTHORITY', reason: 'PLAN_REGISTRY_CHANGED' })
  assert.equal((await fixture.store.read(fixture.store.refs.sessionLeases)).record, null)
})

test('AC-05 — a resource race has one CAS winner and the loser is queued', async () => {
  let arrivals = 0
  let releaseBarrier
  const barrier = new Promise((resolve) => { releaseBarrier = resolve })
  const { leaseRegistry, store } = createFixture({
    raceBarrier: async () => {
      arrivals += 1
      if (arrivals === 2) releaseBarrier()
      await barrier
    },
  })
  const request = (suffix) => makeRequest(store, {
    lease_id: `lease:race-${suffix}`,
    owner_session: `session:race-${suffix}`,
    provider_session_id: `provider:race-${suffix}`,
    execution_context_id: `context:race-${suffix}`,
    worktree_id: `worktree:race-${suffix}`,
    branch: `codex/race-${suffix}`,
    resource_keys: ['path:src/shared.mjs'],
    nonce: NONCE(`race-${suffix}`),
  })

  const [left, right] = await Promise.all([leaseRegistry.admit(request('left')), leaseRegistry.admit(request('right'))])
  assert.equal([left, right].filter((result) => result.status === 'ADMITTED').length, 1)
  const queued = [left, right].find((result) => result.status === 'QUEUED_FOR_LEASE')
  assert.equal(queued.reason, 'RESOURCE_CONFLICT')
  assert.equal(queued.conflict.code, 'CAS_CONFLICT')
  const topology = await leaseRegistry.admit(makeRequest(store, {
    lease_id: 'lease:foreign', common_dir_digest: 'c'.repeat(64), nonce: NONCE('foreign'),
  }))
  assert.deepEqual({ status: topology.status, reason: topology.reason }, {
    status: 'HELD_TOPOLOGY_UNSUPPORTED', reason: 'COMMON_DIR_MISMATCH',
  })
})

test('AC-03 — heartbeat is monotonic and timeout marks SUSPECT without releasing a seat', async () => {
  const { clock, leaseRegistry, store } = createFixture()
  const admitted = await leaseRegistry.admit(makeRequest(store, { resource_keys: ['path:src/heartbeat.mjs'] }))
  const heartbeat = await leaseRegistry.heartbeat({
    lease_id: 'lease:one',
    expected_oid: admitted.oid,
    heartbeat_seq: 2,
    nonce: NONCE('heartbeat'),
  })
  assert.equal(heartbeat.status, 'HEARTBEAT_RECORDED')
  await assert.rejects(
    leaseRegistry.heartbeat({
      lease_id: 'lease:one', expected_oid: heartbeat.oid, heartbeat_seq: 2, nonce: NONCE('heartbeat-repeat'),
    }),
    (error) => error?.code === 'heartbeat_not_monotonic',
  )
  clock.set('2026-08-29T00:05:00.000Z')
  const suspect = await leaseRegistry.reconcileTimeout({
    lease_id: 'lease:one', expected_oid: heartbeat.oid, timeout_ms: 30000, nonce: NONCE('timeout'),
  })
  assert.equal(suspect.status, 'SUSPECT')
  const snapshot = await leaseRegistry.inspect()
  assert.equal(snapshot.record.leases['lease:one'].state, 'SUSPECT')
  assert.equal(snapshot.record.leases['lease:one'].release_evidence_ref, null)
  const blocked = await leaseRegistry.admit(makeRequest(store, {
    lease_id: 'lease:second', owner_session: 'session:second', provider_session_id: 'provider:second',
    execution_context_id: 'context:second', worktree_id: 'worktree:second', branch: 'codex/second',
    resource_keys: ['path:src/second.mjs'], nonce: NONCE('after-timeout'),
  }))
  assert.equal(blocked.status, 'ADMITTED')
  const stillDisjoint = await leaseRegistry.admit(makeRequest(store, {
    lease_id: 'lease:third', owner_session: 'session:third', provider_session_id: 'provider:third',
    execution_context_id: 'context:third', worktree_id: 'worktree:third', branch: 'codex/third',
    resource_keys: ['path:src/third.mjs'], nonce: NONCE('third-timeout'),
  }))
  assert.equal(stillDisjoint.status, 'ADMITTED')
})

test('P2 regression — timeout reconciliation uses the coordinator-owned heartbeat policy', async () => {
  const { leaseRegistry, store } = createFixture()
  const admitted = await leaseRegistry.admit(makeRequest(store, {
    lease_id: 'lease:timeout-policy', resource_keys: ['path:src/timeout-policy.mjs'], nonce: NONCE('timeout-policy-admit'),
  }))
  const before = await leaseRegistry.inspect()
  assert.throws(
    () => leaseRegistry.reconcileTimeout({
      lease_id: 'lease:timeout-policy', expected_oid: admitted.oid, timeout_ms: 1, nonce: NONCE('timeout-policy-reconcile'),
    }),
    (error) => error?.code === 'invalid_value' && error?.detail === 'timeout_ms_policy_mismatch',
  )
  assert.deepEqual(await leaseRegistry.inspect(), before)
})

test('P2 regression — an admitted unnamespaced opaque lease ID remains usable across its lifecycle', async () => {
  const { attestor, clock, envelope, leaseRegistry, store } = createFixture()
  const admitted = await leaseRegistry.admit(makeRequest(store, {
    lease_id: 'lease001', resource_keys: ['path:src/lease001.mjs'], nonce: NONCE('lease001-admit'),
  }))
  assert.equal(admitted.status, 'ADMITTED')
  const heartbeat = await leaseRegistry.heartbeat({
    lease_id: 'lease001', expected_oid: admitted.oid, heartbeat_seq: 2, nonce: NONCE('lease001-heartbeat'),
  })
  assert.equal(heartbeat.status, 'HEARTBEAT_RECORDED')
  const end = await leaseRegistry.endRequest({
    lease_id: 'lease001', expected_oid: heartbeat.oid, nonce: NONCE('lease001-end'), reason: 'handoff',
    handoff_or_candidate_reference: 'handoff:lease001', owner_end_attestation: endAttestation(admitted.lease),
  })
  assert.equal(end.status, 'END_REQUESTED')
  const released = await leaseRegistry.release({
    lease_id: 'lease001',
    expected_oid: end.oid,
    expected_envelope_oid: ENVELOPE_OID,
    expected_envelope_transition_sequence: 0,
    attestation: {
      attestation_ref: 'attestation:lease001-owner-end',
      attestation_digest: SHA256,
      issuer_id: 'attestor:owner-end',
      issuer_version: 'owner-end/v1',
      owner_session: 'session:owner-one',
      provider: 'codex',
      provider_session_id: 'provider:one',
      execution_context_id: 'context:one',
      lease_id: 'lease001',
      generation: 1,
      head_sha: SHA1,
      scope_digest: admitted.lease.scope_digest,
      worktree_path_digest: SHA256,
      observed_at: '2026-08-29T00:00:00.000Z',
      expires_at: '2026-08-29T00:10:00.000Z',
      nonce: NONCE('lease001-owner-end'),
      revocation_epoch: 0,
    },
  })
  assert.equal(released.status, 'RELEASED')
  assert.equal(attestor.calls.length, 1)
  assert.equal(envelope.calls.length, 1)
  assert.deepEqual(await leaseRegistry.validateDependencies({
    plan_id: 'plan:one', generation: 1, task_id: 'task:successor',
    dependency_task_ids: ['task:one'], expected_parent_sha: SHA1,
  }), {
    status: 'READY', plan_id: 'plan:one', generation: 1, task_id: 'task:successor',
    expected_parent_sha: SHA1, dependency_count: 1,
  })
  assert.deepEqual(await leaseRegistry.validateDependencies({
    plan_id: 'plan:one', generation: 1, task_id: 'task:successor',
    dependency_task_ids: ['task:one'], expected_parent_sha: 'c'.repeat(40),
  }), {
    status: 'HELD_EXECUTION_AUTHORITY', reason: 'DEPENDENCY_PARENT_SHA_MISMATCH',
  })
  assert.deepEqual(await leaseRegistry.validateDependencies({
    plan_id: 'plan:one', generation: 1, task_id: 'task:successor',
    dependency_task_ids: ['task:missing'], expected_parent_sha: SHA1,
  }), {
    status: 'HELD_EXECUTION_AUTHORITY', reason: 'DEPENDENCY_NOT_COMPLETED',
  })

  const second = await leaseRegistry.admit(makeRequest(store, {
    lease_id: 'lease002', owner_session: 'session:lease002', provider_session_id: 'provider:lease002',
    execution_context_id: 'context:lease002', worktree_id: 'worktree:lease002', branch: 'codex/lease002',
    resource_keys: ['path:src/lease002.mjs'], nonce: NONCE('lease002-admit'),
  }))
  assert.equal(second.status, 'ADMITTED')
  clock.set('2026-08-29T00:05:00.000Z')
  const suspect = await leaseRegistry.reconcileTimeout({
    lease_id: 'lease002', expected_oid: second.oid, timeout_ms: 30000, nonce: NONCE('lease002-timeout'),
  })
  assert.equal(suspect.status, 'SUSPECT')
})

test('AC-04 — a lease cannot be rebound to a new execution context without explicit release authority', async () => {
  const { leaseRegistry, store } = createFixture()
  const admitted = await leaseRegistry.admit(makeRequest(store, { resource_keys: ['path:src/rebind.mjs'] }))
  const rebound = await leaseRegistry.admit(makeRequest(store, {
    execution_context_id: 'context:replacement', provider_session_id: 'provider:replacement',
    nonce: NONCE('rebind'), resource_keys: ['path:src/rebind.mjs'],
  }))
  assert.equal(admitted.status, 'ADMITTED')
  assert.deepEqual({ status: rebound.status, reason: rebound.reason }, {
    status: 'HELD_EXECUTION_AUTHORITY', reason: 'LEASE_ID_ALREADY_BOUND',
  })
})

test('AC-43 — trusted owner-end release revokes once, frees only the seat, and retains task resources', async () => {
  const { attestor, envelope, leaseRegistry, store } = createFixture()
  const first = await leaseRegistry.admit(makeRequest(store, {
    lease_id: 'lease:release', resource_keys: ['path:src/retained.mjs'],
    worktree_id: 'worktree:release', branch: 'codex/release', nonce: NONCE('release-admit'),
  }))
  const end = await leaseRegistry.endRequest({
    lease_id: 'lease:release', expected_oid: first.oid, nonce: NONCE('end-request'), reason: 'handoff',
    handoff_or_candidate_reference: 'handoff:release', owner_end_attestation: endAttestation(first.lease),
  })
  const attestation = {
    attestation_ref: 'attestation:owner-end',
    attestation_digest: SHA256,
    issuer_id: 'attestor:owner-end',
    issuer_version: 'owner-end/v1',
    owner_session: 'session:owner-one',
    provider: 'codex',
    provider_session_id: 'provider:one',
    execution_context_id: 'context:one',
    lease_id: 'lease:release',
    generation: 1,
    head_sha: SHA1,
    scope_digest: first.lease.scope_digest,
    worktree_path_digest: SHA256,
    observed_at: '2026-08-29T00:00:00.000Z',
    expires_at: '2026-08-29T00:10:00.000Z',
    nonce: NONCE('owner-end'),
    revocation_epoch: 0,
  }
  const released = await leaseRegistry.release({
    lease_id: 'lease:release',
    expected_oid: end.oid,
    expected_envelope_oid: ENVELOPE_OID,
    expected_envelope_transition_sequence: 0,
    attestation,
  })
  assert.equal(released.status, 'RELEASED')
  assert.equal(attestor.calls.length, 1)
  assert.equal(envelope.calls.length, 1)
  const snapshot = await leaseRegistry.inspect()
  const record = snapshot.record.leases['lease:release']
  assert.equal(record.state, 'RELEASED')
  assert.equal(record.retention_state, 'RETAINED_FOR_REVIEW')
  assert.equal(record.branch, 'codex/release')
  assert.equal(record.worktree_id, 'worktree:release')
  assert.deepEqual(record.release_transition, ['RELEASING', 'RELEASED'])

  const disjoint = await leaseRegistry.admit(makeRequest(store, {
    lease_id: 'lease:after-release', owner_session: 'session:after', provider_session_id: 'provider:after',
    execution_context_id: 'context:after', worktree_id: 'worktree:after', branch: 'codex/after',
    resource_keys: ['path:src/disjoint.mjs'], nonce: NONCE('after-release'),
  }))
  assert.equal(disjoint.status, 'ADMITTED')
  const conflict = await leaseRegistry.admit(makeRequest(store, {
    lease_id: 'lease:retained-conflict', owner_session: 'session:conflict', provider_session_id: 'provider:conflict',
    execution_context_id: 'context:conflict', worktree_id: 'worktree:conflict', branch: 'codex/conflict',
    resource_keys: ['path:src/retained.mjs'], nonce: NONCE('retained-conflict'),
  }))
  assert.deepEqual({ status: conflict.status, reason: conflict.reason }, {
    status: 'QUEUED_FOR_LEASE', reason: 'RESOURCE_CONFLICT',
  })
})

test('AC-43 — release rejects replay, self-issued, expired, tuple drift, in-flight work, and CAS races', async () => {
  const fixture = createFixture()
  const { clock, envelope, leaseRegistry, store } = fixture
  const admitted = await leaseRegistry.admit(makeRequest(store, { lease_id: 'lease:negative', resource_keys: ['path:src/negative.mjs'] }))
  const end = await leaseRegistry.endRequest({
    lease_id: 'lease:negative', expected_oid: admitted.oid, nonce: NONCE('negative-end'), reason: 'aborted',
    handoff_or_candidate_reference: 'handoff:negative', owner_end_attestation: endAttestation(admitted.lease),
  })
  const base = {
    attestation_ref: 'attestation:negative', attestation_digest: SHA256,
    issuer_id: 'attestor:owner-end', issuer_version: 'owner-end/v1', owner_session: 'session:owner-one',
    provider: 'codex', provider_session_id: 'provider:one', execution_context_id: 'context:one',
    lease_id: 'lease:negative', generation: 1, head_sha: SHA1, scope_digest: admitted.lease.scope_digest,
    worktree_path_digest: SHA256, observed_at: '2026-08-29T00:00:00.000Z',
    expires_at: '2026-08-29T00:10:00.000Z', nonce: NONCE('negative-owner-end'), revocation_epoch: 0,
  }
  const invalids = [
    { label: 'self-issued', patch: { issuer_id: 'session:owner-one' }, code: 'owner_end_attestation_untrusted' },
    { label: 'wrong-owner', patch: { owner_session: 'session:other' }, code: 'owner_end_attestation_tuple_mismatch' },
    { label: 'wrong-context', patch: { execution_context_id: 'context:other' }, code: 'owner_end_attestation_tuple_mismatch' },
    { label: 'wrong-head', patch: { head_sha: 'c'.repeat(40) }, code: 'owner_end_attestation_tuple_mismatch' },
  ]
  for (const { patch, code } of invalids) {
    await assert.rejects(
      leaseRegistry.release({
        lease_id: 'lease:negative', expected_oid: end.oid, expected_envelope_oid: ENVELOPE_OID, expected_envelope_transition_sequence: 0,
        attestation: { ...base, ...patch, attestation_ref: `attestation:${code}`, nonce: NONCE(code) },
      }),
      (error) => error?.code === code,
    )
  }
  clock.set('2026-08-29T00:11:00.000Z')
  await assert.rejects(
    leaseRegistry.release({ lease_id: 'lease:negative', expected_oid: end.oid, expected_envelope_oid: ENVELOPE_OID, expected_envelope_transition_sequence: 0, attestation: base }),
    (error) => error?.code === 'owner_end_attestation_expired',
  )
  clock.set('2026-08-29T00:00:00.000Z')
  envelope.revoke = async () => ({
    status: 'REVOKED', previous_oid: ENVELOPE_OID, oid: REVOKED_ENVELOPE_OID, transition_sequence: 1,
    revocation_epoch: 0, in_flight_command: true,
  })
  assert.deepEqual(await leaseRegistry.release({
    lease_id: 'lease:negative', expected_oid: end.oid, expected_envelope_oid: ENVELOPE_OID,
    expected_envelope_transition_sequence: 0, attestation: base,
  }), {
    status: 'HELD_EXECUTION_AUTHORITY', reason: 'ENVELOPE_REVOKE_EVIDENCE_GAP', reconcile_required: true,
  })
})

test('AC-43 — release CAS allows one winner and consumes an owner-end attestation only once', async () => {
  const { envelope, leaseRegistry, store } = createFixture()
  const admitted = await leaseRegistry.admit(makeRequest(store, {
    lease_id: 'lease:release-race', resource_keys: ['path:src/release-race.mjs'], nonce: NONCE('release-race-admit'),
  }))
  const end = await leaseRegistry.endRequest({
    lease_id: 'lease:release-race', expected_oid: admitted.oid, nonce: NONCE('release-race-end'), reason: 'handoff',
    handoff_or_candidate_reference: 'handoff:release-race', owner_end_attestation: endAttestation(admitted.lease),
  })
  const attestation = {
    attestation_ref: 'attestation:release-race', attestation_digest: SHA256,
    issuer_id: 'attestor:owner-end', issuer_version: 'owner-end/v1', owner_session: 'session:owner-one',
    provider: 'codex', provider_session_id: 'provider:one', execution_context_id: 'context:one',
    lease_id: 'lease:release-race', generation: 1, head_sha: SHA1, scope_digest: admitted.lease.scope_digest,
    worktree_path_digest: SHA256, observed_at: '2026-08-29T00:00:00.000Z',
    expires_at: '2026-08-29T00:10:00.000Z', nonce: NONCE('release-race-owner-end'), revocation_epoch: 0,
  }
  const results = await Promise.all([
    leaseRegistry.release({ lease_id: 'lease:release-race', expected_oid: end.oid, expected_envelope_oid: ENVELOPE_OID, expected_envelope_transition_sequence: 0, attestation }),
    leaseRegistry.release({ lease_id: 'lease:release-race', expected_oid: end.oid, expected_envelope_oid: ENVELOPE_OID, expected_envelope_transition_sequence: 0, attestation }),
  ])
  assert.equal(results.filter((result) => result.status === 'RELEASED').length, 1)
  assert.equal(results.filter((result) => result.status === 'CONFLICT').length, 1)
  assert.equal(envelope.calls.length, 1)

  const second = await leaseRegistry.admit(makeRequest(store, {
    lease_id: 'lease:replay-target', owner_session: 'session:replay', provider_session_id: 'provider:replay',
    execution_context_id: 'context:replay', worktree_id: 'worktree:replay', branch: 'codex/replay',
    resource_keys: ['path:src/replay.mjs'], nonce: NONCE('replay-admit'),
  }))
  const secondEnd = await leaseRegistry.endRequest({
    lease_id: 'lease:replay-target', expected_oid: second.oid, nonce: NONCE('replay-end'), reason: 'failed',
    handoff_or_candidate_reference: 'handoff:replay', owner_end_attestation: endAttestation(second.lease),
  })
  await assert.rejects(
    leaseRegistry.release({
      lease_id: 'lease:replay-target', expected_oid: secondEnd.oid, expected_envelope_oid: ENVELOPE_OID, expected_envelope_transition_sequence: 0,
      attestation: {
        ...attestation,
        owner_session: 'session:replay', provider_session_id: 'provider:replay', execution_context_id: 'context:replay',
        lease_id: 'lease:replay-target', scope_digest: second.lease.scope_digest,
      },
    }),
    (error) => error?.code === 'owner_end_attestation_replayed',
  )
})

test('registry uses only sanitized local Git plumbing and cannot reach cleanup or remote commands', async () => {
  const { git, leaseRegistry, store } = createFixture()
  const admitted = await leaseRegistry.admit(makeRequest(store, { resource_keys: ['path:src/local-only.mjs'] }))
  assert.equal(admitted.status, 'ADMITTED')
  const allowed = new Set(['hash-object', 'show-ref', 'cat-file', 'update-ref'])
  for (const call of git.calls) {
    assert.equal(allowed.has(call.args[0]), true, call.args.join(' '))
    assert.equal(call.env.GIT_CONFIG_NOSYSTEM, '1')
    assert.equal(call.env.GIT_TERMINAL_PROMPT, '0')
    assert.equal(call.env.GIT_CONFIG_VALUE_0, process.platform === 'win32' ? 'NUL' : '/dev/null')
    assert.equal(call.env.GIT_CONFIG_GLOBAL, process.platform === 'win32' ? 'NUL' : '/dev/null')
    assert.equal(Object.hasOwn(call.env, 'GIT_DIR'), false)
    assert.equal(Object.hasOwn(call.env, 'GIT_WORK_TREE'), false)
    assert.equal(Object.hasOwn(call.env, 'GIT_INDEX_FILE'), false)
    assert.doesNotMatch(call.args.join(' '), /\b(?:fetch|push|remote|worktree|branch|prune|clean|reset)\b/u)
  }
  assert.deepEqual([...git.refs.keys()], ['refs/ai-bim/delivery-plans', 'refs/ai-bim/session-leases'])
  const source = await readFile(new URL('../../lib/parallel-delivery-fabric-registry.mjs', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /node:(?:child_process|fs|http2?|https?|net|tls|worker_threads)/u)
  assert.doesNotMatch(source, /\b(?:fetch|spawn|exec|cleanup|prune|taskkill|safe\.directory)\s*\(/u)
})

test('queue Git CAS atomically verifies the lease ref before storing a separate queue record', async () => {
  const { leaseRegistry, store } = createFixture()
  const admitted = await leaseRegistry.admit(makeRequest(store, { resource_keys: ['runtime:resource:kit-runtime'] }))
  const queueBase = {
    schema_version: 'queue-registry/v1',
    generation: 1,
    nonce: NONCE('queue-guarded'),
    created_at: '2026-08-29T00:00:00.000Z',
    updated_at: '2026-08-29T00:00:00.000Z',
    queue_mappings: {},
    used_queue_operations: {},
  }
  const record = { ...queueBase, canonical_digest: digestCanonical(queueBase) }
  const stored = await store.casGuarded({
    ref: 'refs/ai-bim/queue-mappings',
    expected_oid: ZERO_OID,
    record,
    guard_ref: 'refs/ai-bim/session-leases',
    guard_oid: admitted.oid,
  })
  assert.equal(stored.status, 'STORED')
  const heartbeat = await leaseRegistry.heartbeat({
    lease_id: 'lease:one', expected_oid: admitted.oid, heartbeat_seq: 2, nonce: NONCE('queue-guard-rotation'),
  })
  assert.equal(heartbeat.status, 'HEARTBEAT_RECORDED')
  const nextBase = { ...queueBase, generation: 2, nonce: NONCE('queue-guarded-next') }
  const conflict = await store.casGuarded({
    ref: 'refs/ai-bim/queue-mappings',
    expected_oid: stored.oid,
    record: { ...nextBase, canonical_digest: digestCanonical(nextBase) },
    guard_ref: 'refs/ai-bim/session-leases',
    guard_oid: admitted.oid,
  })
  assert.equal(conflict.status, 'CONFLICT')
  assert.equal(conflict.reason, 'GUARD_CONFLICT')
})

const stampedFixture = (record) => ({
  ...record,
  canonical_digest: digestCanonical(record),
})

const ownerEndFixture = (overrides = {}) => {
  const leaseId = overrides.lease_id ?? 'lease:release-proof'
  const suffix = leaseId.slice(leaseId.indexOf(':') + 1)
  return {
  attestation_ref: 'attestation:release-proof',
  attestation_digest: SHA256,
  issuer_id: 'attestor:owner-end',
  issuer_version: 'owner-end/v1',
  owner_session: 'session:owner-one',
  provider: 'codex',
  provider_session_id: 'provider:one',
  execution_context_id: 'context:one',
  lease_id: leaseId,
  generation: 1,
  head_sha: SHA1,
  scope_digest: scopeDigestFromResourceKeys([`path:src/${suffix}.mjs`]),
  worktree_path_digest: SHA256,
  observed_at: '2026-08-29T00:00:00.000Z',
  expires_at: '2026-08-29T00:10:00.000Z',
  nonce: NONCE('release-proof'),
  revocation_epoch: 0,
  ...overrides,
  }
}

test('P1 regression — corrupt or wrong-ref persisted records hold before occupancy and zero CAS writes', async () => {
  const { git, leaseRegistry, planRegistry, store } = createFixture()
  const malformedLease = stampedFixture({
    schema_version: 'not-session-lease/v1',
    generation: 1,
    nonce: NONCE('malformed-lease'),
    created_at: '2026-08-29T00:00:00.000Z',
    updated_at: '2026-08-29T00:00:00.000Z',
  })
  const malformedRegistry = stampedFixture({
    schema_version: 'session-lease-registry/v1',
    generation: 1,
    nonce: NONCE('malformed-registry'),
    created_at: '2026-08-29T00:00:00.000Z',
    updated_at: '2026-08-29T00:00:00.000Z',
    writer_cap: 2,
    leases: { 'lease:corrupt': malformedLease },
    draining_plans: {},
    used_owner_end_attestations: {},
    retained_resources: {},
  })
  const malformedBlob = JSON.stringify(malformedRegistry)
  const malformedOid = createHash('sha1').update(malformedBlob).digest('hex')
  git.blobs.set(malformedOid, malformedBlob)
  git.refs.set('refs/ai-bim/session-leases', malformedOid)
  const writesBefore = git.calls.filter((call) => ['hash-object', 'update-ref'].includes(call.args[0])).length

  const heldLease = await leaseRegistry.admit(makeRequest(store, {
    lease_id: 'lease:after-corruption',
    resource_keys: ['path:src/after-corruption.mjs'],
    nonce: NONCE('after-corruption'),
  }))
  assert.deepEqual(heldLease, {
    status: 'HELD_REGISTRY_INTEGRITY',
    reason: 'PERSISTED_RECORD_INVALID',
    ref: 'refs/ai-bim/session-leases',
  })
  assert.equal(git.calls.filter((call) => ['hash-object', 'update-ref'].includes(call.args[0])).length, writesBefore)

  git.refs.set('refs/ai-bim/delivery-plans', malformedOid)
  const heldPlan = await planRegistry.inspect()
  assert.deepEqual(heldPlan, {
    status: 'HELD_REGISTRY_INTEGRITY',
    reason: 'PERSISTED_RECORD_INVALID',
    ref: 'refs/ai-bim/delivery-plans',
  })
})

test('P1 regression — Task 2 privacy rules reject sensitive lease metadata before hash or ref mutation', async () => {
  const cases = [
    ['raw SID', { owner_session: 'sid:S-1-5-21-1-2-3' }],
    ['token', { provider_session_id: 'token:ghp_abcdefghijklmnopqrstuvwxyz' }],
    ['cookie nonce', { nonce: 'cookie_value_that_is_long_enough_for_nonce' }],
    ['raw path resource', { resource_keys: ['path:C:/Users/private/model.ifc'] }],
  ]
  for (const [label, overrides] of cases) {
    const { git, leaseRegistry, store } = createFixture()
    await assert.rejects(
      leaseRegistry.admit(makeRequest(store, {
        ...overrides,
        lease_id: `lease:privacy-${label.replaceAll(' ', '-')}`,
      })),
      (error) => error?.code === 'secret_material_detected',
      label,
    )
    assert.equal(git.calls.some((call) => ['hash-object', 'update-ref'].includes(call.args[0])), false, label)
  }
})

test('P1 regression — neutral raw environment values are rejected before every Git operation', async () => {
  for (const resourceKey of [
    'env:PAY_TO_ADDRESS', 'environment:PAY_TO_ADDRESS', '$env:PAY_TO_ADDRESS', '%PAY_TO_ADDRESS%',
    'path:env:PAY_TO_ADDRESS', 'path:environment:PAY_TO_ADDRESS', 'path:$env:PAY_TO_ADDRESS', 'path:%PAY_TO_ADDRESS%',
  ]) {
    const { git, leaseRegistry, store } = createFixture()
    await assert.rejects(
      leaseRegistry.admit(makeRequest(store, {
        lease_id: 'lease:opaque-safe',
        resource_keys: [resourceKey],
        nonce: NONCE('neutral-environment'),
      })),
      (error) => error?.code === 'secret_material_detected',
      resourceKey,
    )
    assert.equal(git.calls.length, 0, resourceKey)
  }

  const { git, leaseRegistry, store } = createFixture()
  const admitted = await leaseRegistry.admit(makeRequest(store, {
    lease_id: 'lease:opaque-record', resource_keys: ['path:src/opaque-record.mjs'], nonce: NONCE('opaque-record-admit'),
  }))
  const persisted = (await leaseRegistry.inspect()).record
  const leakedLease = { ...persisted.leases['lease:opaque-record'], resource_keys: ['path:env:PAY_TO_ADDRESS'] }
  delete leakedLease.canonical_digest
  persisted.leases['lease:opaque-record'] = stampedFixture(leakedLease)
  delete persisted.canonical_digest
  const leakedRecord = stampedFixture(persisted)
  const leakedBlob = JSON.stringify(leakedRecord)
  const leakedOid = createHash('sha1').update(leakedBlob).digest('hex')
  git.blobs.set(leakedOid, leakedBlob)
  git.refs.set(store.refs.sessionLeases, leakedOid)
  const writesBeforeRead = git.calls.filter((call) => ['hash-object', 'update-ref'].includes(call.args[0])).length
  assert.deepEqual(await leaseRegistry.inspect(), {
    status: 'HELD_REGISTRY_INTEGRITY',
    reason: 'PERSISTED_RECORD_INVALID',
    ref: store.refs.sessionLeases,
  })
  assert.equal(git.calls.filter((call) => ['hash-object', 'update-ref'].includes(call.args[0])).length, writesBeforeRead)

  for (const resourceKey of [
    'path:src/environmental.mjs', 'path:docs/env-guide.md', 'path:src/env/config.mjs', 'path:src/pay_to_address.mjs',
  ]) {
    const { leaseRegistry: normalRegistry, store: normalStore } = createFixture()
    const normal = await normalRegistry.admit(makeRequest(normalStore, {
      lease_id: 'lease:normal-canonical', resource_keys: [resourceKey], nonce: NONCE('normal-canonical'),
    }))
    assert.equal(normal.status, 'ADMITTED', resourceKey)
  }
})

test('P1 regression — every public lease request is closed and privacy-safe before registry access', async () => {
  const publicRequests = [
    ['heartbeat non-object', 'heartbeat', null, 'invalid_shape'],
    ['heartbeat unknown key', 'heartbeat', { lease_id: 'lease:one', expected_oid: ZERO_OID, heartbeat_seq: 2, nonce: NONCE('heartbeat-unknown'), extra: 'value' }, 'invalid_shape'],
    ['heartbeat token key', 'heartbeat', { lease_id: 'lease:one', expected_oid: ZERO_OID, heartbeat_seq: 2, nonce: NONCE('heartbeat-token'), token: 'opaque' }, 'secret_material_detected'],
    ['heartbeat nested raw env', 'heartbeat', { lease_id: 'lease:one', expected_oid: ZERO_OID, heartbeat_seq: 2, nonce: NONCE('heartbeat-env'), metadata: { value: 'path:env:PAY_TO_ADDRESS' } }, 'secret_material_detected'],
    ['reconcile non-object', 'reconcileTimeout', [], 'invalid_shape'],
    ['reconcile unknown key', 'reconcileTimeout', { lease_id: 'lease:one', expected_oid: ZERO_OID, timeout_ms: 1, nonce: NONCE('reconcile-unknown'), extra: 'value' }, 'invalid_shape'],
    ['reconcile token value', 'reconcileTimeout', { lease_id: 'lease:one', expected_oid: ZERO_OID, timeout_ms: 1, nonce: NONCE('reconcile-token'), metadata: { value: 'token:abc' } }, 'secret_material_detected'],
    ['reconcile nested raw env', 'reconcileTimeout', { lease_id: 'lease:one', expected_oid: ZERO_OID, timeout_ms: 1, nonce: NONCE('reconcile-env'), metadata: { value: 'path:$env:PAY_TO_ADDRESS' } }, 'secret_material_detected'],
    ['end non-object', 'endRequest', 'not-an-object', 'invalid_shape'],
    ['end unknown key', 'endRequest', { lease_id: 'lease:one', expected_oid: ZERO_OID, nonce: NONCE('end-unknown'), reason: 'handoff', handoff_or_candidate_reference: 'handoff:one', owner_end_attestation: endAttestation({ lease_id: 'lease:one', owner_session: 'session:owner-one', provider: 'codex', provider_session_id: 'provider:one', execution_context_id: 'context:one', generation: 1, head_sha: SHA1, scope_digest: SHA256, worktree_path_digest: SHA256, revocation_epoch: 0 }), extra: 'value' }, 'invalid_shape'],
    ['end token key', 'endRequest', { lease_id: 'lease:one', expected_oid: ZERO_OID, nonce: NONCE('end-token'), reason: 'handoff', handoff_or_candidate_reference: 'handoff:one', owner_end_attestation: endAttestation({ lease_id: 'lease:one', owner_session: 'session:owner-one', provider: 'codex', provider_session_id: 'provider:one', execution_context_id: 'context:one', generation: 1, head_sha: SHA1, scope_digest: SHA256, worktree_path_digest: SHA256, revocation_epoch: 0 }), authorization: 'opaque' }, 'secret_material_detected'],
    ['end nested raw env', 'endRequest', { lease_id: 'lease:one', expected_oid: ZERO_OID, nonce: NONCE('end-env'), reason: 'handoff', handoff_or_candidate_reference: 'handoff:one', owner_end_attestation: endAttestation({ lease_id: 'lease:one', owner_session: 'session:owner-one', provider: 'codex', provider_session_id: 'provider:one', execution_context_id: 'context:one', generation: 1, head_sha: SHA1, scope_digest: SHA256, worktree_path_digest: SHA256, revocation_epoch: 0 }), metadata: { value: 'path:%PAY_TO_ADDRESS%' } }, 'secret_material_detected'],
  ]
  for (const [label, method, input, code] of publicRequests) {
    const { git, leaseRegistry } = createFixture()
    await assert.rejects(
      async () => leaseRegistry[method](input),
      (error) => error?.code === code,
      label,
    )
    assert.equal(git.calls.length, 0, label)
  }
})

test('P1 regression — registry privacy rejects bare bearer while preserving a legal near-match', async () => {
  const blocked = createFixture()
  await assert.rejects(
    blocked.leaseRegistry.admit(makeRequest(blocked.store, { owner_session: 'session:bearer' })),
    (error) => error?.code === 'secret_material_detected',
  )
  assert.equal(blocked.git.calls.length, 0)

  const allowed = createFixture()
  assert.equal((await allowed.leaseRegistry.admit(makeRequest(allowed.store, {
    lease_id: 'lease:bearish-near-match', owner_session: 'session:bearish', nonce: NONCE('bearish-near-match'),
  }))).status, 'ADMITTED')
})

test('P1 regression — lease writer cap is ref-pinned before writes and wrong-cap blobs hold on read', async () => {
  const { git, leaseRegistry, store } = createFixture()
  const makeRegistry = (writerCap) => stampedFixture({
    schema_version: 'session-lease-registry/v1',
    generation: 1,
    nonce: NONCE('wrong-writer-cap'),
    created_at: '2026-08-29T00:00:00.000Z',
    updated_at: '2026-08-29T00:00:00.000Z',
    writer_cap: writerCap,
    leases: {},
    draining_plans: {},
    used_owner_end_attestations: {},
    retained_resources: {},
  })
  for (const writerCap of [0, 1, 3, 99, '2', null]) {
    await assert.rejects(
      store.cas({ ref: store.refs.sessionLeases, expected_oid: ZERO_OID, record: makeRegistry(writerCap) }),
      (error) => error?.code === 'registry_record_invalid',
      String(writerCap),
    )
    assert.equal(git.calls.length, 0, String(writerCap))
  }

  const forged = JSON.stringify(makeRegistry(99))
  const forgedOid = createHash('sha1').update(forged).digest('hex')
  git.blobs.set(forgedOid, forged)
  git.refs.set(store.refs.sessionLeases, forgedOid)
  assert.deepEqual(await leaseRegistry.inspect(), {
    status: 'HELD_REGISTRY_INTEGRITY',
    reason: 'PERSISTED_RECORD_INVALID',
    ref: store.refs.sessionLeases,
  })
})

test('P1 regression — persisted occupied states cannot share a branch or worktree', async () => {
  const timestamp = '2026-08-29T00:00:00.000Z'
  const occupiedStates = ['ACTIVE', 'SUSPECT', 'END_REQUESTED', 'RELEASING']
  for (const state of occupiedStates) {
    const { git, leaseRegistry, store } = createFixture()
    await leaseRegistry.admit(makeRequest(store, {
      lease_id: 'lease:cap-one', task_id: 'task:cap-one', owner_session: 'session:cap-one',
      provider_session_id: 'provider:cap-one', execution_context_id: 'context:cap-one',
      worktree_id: 'worktree:cap-one', worktree_path_digest: 'c'.repeat(64), branch: 'codex/cap-one',
      resource_keys: ['path:src/cap-one.mjs'], nonce: NONCE('cap-one'),
    }))
    await leaseRegistry.admit(makeRequest(store, {
      lease_id: 'lease:cap-two', task_id: 'task:cap-two', owner_session: 'session:cap-two',
      provider_session_id: 'provider:cap-two', execution_context_id: 'context:cap-two',
      worktree_id: 'worktree:cap-two', worktree_path_digest: 'd'.repeat(64), branch: 'codex/cap-two',
      resource_keys: ['path:src/cap-two.mjs'], nonce: NONCE('cap-two'),
    }))
    const snapshot = await leaseRegistry.inspect()
    const third = structuredClone(snapshot.record.leases['lease:cap-one'])
    third.lease_id = 'lease:cap-three'
    third.task_id = 'task:cap-three'
    third.provider_session_id = 'provider:cap-three'
    third.execution_context_id = 'context:cap-three'
    third.resource_keys = ['path:src/cap-three.mjs']
    third.nonce = NONCE(`cap-${state.toLowerCase()}`)
    if (state === 'SUSPECT') {
      third.state = 'SUSPECT'
      third.suspect_at = timestamp
    }
    if (state === 'END_REQUESTED' || state === 'RELEASING') {
      third.state = state
      third.end_request = {
        reason: 'failed', requested_at: timestamp, nonce: NONCE(`cap-end-${state.toLowerCase()}`), handoff_or_candidate_reference: 'candidate:cap-three',
      }
    }
    if (state === 'RELEASING') {
      third.release_reservation = stampedFixture({
        schema_version: 'lease-release-reservation/v1', generation: 1, nonce: NONCE('cap-reservation'), created_at: timestamp, updated_at: timestamp,
        release_id: 'release:cap-three', lease_id: 'lease:cap-three', attestation_ref: 'attestation:cap-three', attestation_digest: SHA256,
        attestor_issuer: 'issuer:cap-three', attestor_version: 'owner-end/v1', observed_at: timestamp, expires_at: '2026-08-29T00:10:00.000Z',
        revocation_epoch: 0, expected_registry_oid: SHA1, expected_envelope_oid: ENVELOPE_OID, expected_envelope_transition_sequence: 0,
      })
      third.nonce = NONCE('cap-reservation')
    }
    delete third.canonical_digest
    const record = structuredClone(snapshot.record)
    record.leases['lease:cap-three'] = stampedFixture(third)
    delete record.canonical_digest
    const forged = stampedFixture(record)
    const writesBefore = git.calls.filter((call) => ['hash-object', 'update-ref'].includes(call.args[0])).length
    await assert.rejects(
      store.cas({ ref: store.refs.sessionLeases, expected_oid: snapshot.oid, record: forged }),
      (error) => error?.code === 'registry_record_invalid',
      state,
    )
    assert.equal(git.calls.filter((call) => ['hash-object', 'update-ref'].includes(call.args[0])).length, writesBefore, state)

    const blob = JSON.stringify(forged)
    const oid = createHash('sha1').update(blob).digest('hex')
    git.blobs.set(oid, blob)
    git.refs.set(store.refs.sessionLeases, oid)
    assert.deepEqual(await leaseRegistry.inspect(), {
      status: 'HELD_REGISTRY_INTEGRITY', reason: 'PERSISTED_RECORD_INVALID', ref: store.refs.sessionLeases,
    }, state)
  }
})

test('P1 regression — END_REQUESTED is immutable and timeout retains its authority boundary', async () => {
  const { clock, git, leaseRegistry, store } = createFixture()
  const admitted = await leaseRegistry.admit(makeRequest(store, {
    lease_id: 'lease:end-immutable', resource_keys: ['path:src/end-immutable.mjs'], nonce: NONCE('end-immutable-admit'),
  }))
  const endInput = {
    lease_id: 'lease:end-immutable', expected_oid: admitted.oid, nonce: NONCE('end-immutable-request'), reason: 'handoff',
    handoff_or_candidate_reference: 'handoff:end-immutable', owner_end_attestation: endAttestation(admitted.lease),
  }
  const ended = await leaseRegistry.endRequest(endInput)
  assert.equal(ended.status, 'END_REQUESTED')
  const writes = () => git.calls.filter((call) => ['hash-object', 'update-ref'].includes(call.args[0])).length
  const writesBeforeReplay = writes()
  const replay = await leaseRegistry.endRequest({ ...endInput, expected_oid: ended.oid })
  assert.equal(replay.status, 'END_REQUESTED')
  assert.equal(replay.oid, ended.oid)
  assert.equal(writes(), writesBeforeReplay)
  for (const [label, patch] of [
    ['reason drift', { reason: 'failed' }],
    ['reference drift', { handoff_or_candidate_reference: 'candidate:end-immutable' }],
    ['nonce drift', { nonce: NONCE('end-immutable-drift') }],
  ]) {
    const writesBeforeDrift = writes()
    assert.deepEqual(await leaseRegistry.endRequest({ ...endInput, expected_oid: ended.oid, ...patch }), {
      status: 'HELD_EXECUTION_AUTHORITY', reason: 'END_REQUEST_IMMUTABLE', reconcile_required: false,
    }, label)
    assert.equal(writes(), writesBeforeDrift, label)
  }
  clock.set('2026-08-29T00:05:00.000Z')
  const writesBeforeTimeout = writes()
  const timedOut = await leaseRegistry.reconcileTimeout({
    lease_id: 'lease:end-immutable', expected_oid: ended.oid, timeout_ms: 30000, nonce: NONCE('end-immutable-timeout'),
  })
  assert.equal(timedOut.status, 'HELD_EXECUTION_AUTHORITY')
  assert.equal(timedOut.reason, 'OWNER_END_ATTESTATION_EVIDENCE_GAP')
  assert.equal(timedOut.reconcile_required, true)
  assert.equal(timedOut.oid, ended.oid)
  assert.equal(timedOut.lease.state, 'END_REQUESTED')
  assert.equal(writes(), writesBeforeTimeout)
  assert.equal((await leaseRegistry.inspect()).record.leases['lease:end-immutable'].state, 'END_REQUESTED')
})

const createEnvelopeCasPort = () => {
  const expectedOid = 'e'.repeat(40)
  const resultingOid = 'f'.repeat(40)
  let currentOid = expectedOid
  let successfulMutations = 0
  const calls = []
  return {
    calls,
    get successfulMutations() { return successfulMutations },
    async revoke(request) {
      calls.push(structuredClone(request))
      if (request.expected_envelope_oid !== currentOid || request.expected_transition_sequence !== 0) {
        return { status: 'CONFLICT', actual_oid: currentOid }
      }
      currentOid = resultingOid
      successfulMutations += 1
      return {
        status: 'REVOKED',
        previous_oid: expectedOid,
        oid: resultingOid,
        transition_sequence: 1,
        revocation_epoch: 0,
        in_flight_command: false,
      }
    },
  }
}

test('P1 regression — only a release reservation owner can reach the envelope during heartbeat and release races', async () => {
  const fixture = createFixture()
  const { attestor, clock, store } = fixture
  let registry
  let stateAtEnvelope = undefined
  let heartbeatDuringRelease = undefined
  const envelope = {
    calls: [],
    async revoke(request) {
      this.calls.push(structuredClone(request))
      const snapshot = await registry.inspect()
      stateAtEnvelope = snapshot.record.leases['lease:reservation-race'].state
      heartbeatDuringRelease = await registry.heartbeat({
        lease_id: 'lease:reservation-race',
        expected_oid: snapshot.oid,
        heartbeat_seq: 2,
        nonce: NONCE('reservation-heartbeat'),
      })
      return {
        status: 'REVOKED', previous_oid: ENVELOPE_OID, oid: REVOKED_ENVELOPE_OID,
        transition_sequence: 1, revocation_epoch: 0, in_flight_command: false,
      }
    },
  }
  registry = createLeaseRegistry({ store, clock, writerCap: 2, ownerEndAttestor: attestor, executionEnvelope: envelope })
  const admitted = await registry.admit(makeRequest(store, {
    lease_id: 'lease:reservation-race', resource_keys: ['path:src/reservation-race.mjs'], nonce: NONCE('reservation-admit'),
  }))
  const ended = await registry.endRequest({
    lease_id: 'lease:reservation-race', expected_oid: admitted.oid, nonce: NONCE('reservation-end'), reason: 'handoff',
    owner_end_attestation: endAttestation(admitted.lease),
    handoff_or_candidate_reference: 'handoff:reservation-race',
  })
  const request = {
    lease_id: 'lease:reservation-race', expected_oid: ended.oid, expected_envelope_oid: ENVELOPE_OID,
    expected_envelope_transition_sequence: 0,
    attestation: ownerEndFixture({ lease_id: 'lease:reservation-race', nonce: NONCE('reservation-attestation') }),
  }
  const results = await Promise.all([registry.release(request), registry.release(request)])
  assert.equal(results.filter((result) => result.status === 'RELEASED').length, 1)
  assert.equal(envelope.calls.length, 1)
  assert.equal(stateAtEnvelope, 'RELEASING')
  assert.deepEqual(heartbeatDuringRelease, {
    status: 'HELD_EXECUTION_AUTHORITY', reason: 'RELEASE_IN_PROGRESS', reconcile_required: false,
  })
})

test('P2 regression — a lost revocation-proof CAS is recovered idempotently before release finalization', async () => {
  const fixture = createFixture()
  const { attestor, clock, store } = fixture
  let rejectFirstProof = true
  const contestedStore = {
    commonDirDigest: store.commonDirDigest,
    refs: store.refs,
    read: store.read,
    casGuarded: store.casGuarded,
    async cas(request) {
      const lease = request.record?.leases?.['lease:proof-recovery']
      if (rejectFirstProof && request.ref === store.refs.sessionLeases && lease?.state === 'RELEASING' &&
          Object.hasOwn(lease, 'envelope_revocation_proof')) {
        rejectFirstProof = false
        const current = await store.read(request.ref)
        return {
          status: 'CONFLICT', reason: 'CAS_CONFLICT', expected_oid: request.expected_oid,
          actual_oid: current.oid, current,
        }
      }
      return store.cas(request)
    },
  }
  let acceptedRequest = null
  let successfulMutations = 0
  const envelopeResult = {
    status: 'REVOKED', previous_oid: ENVELOPE_OID, oid: REVOKED_ENVELOPE_OID,
    transition_sequence: 1, revocation_epoch: 0, in_flight_command: false,
  }
  const envelope = {
    calls: [],
    async revoke(request) {
      this.calls.push(structuredClone(request))
      if (acceptedRequest === null) {
        acceptedRequest = structuredClone(request)
        successfulMutations += 1
      } else {
        assert.deepEqual(request, acceptedRequest)
      }
      return structuredClone(envelopeResult)
    },
  }
  const registry = createLeaseRegistry({
    store: contestedStore, clock, writerCap: 2, ownerEndAttestor: attestor, executionEnvelope: envelope,
  })
  const admitted = await registry.admit(makeRequest(contestedStore, {
    lease_id: 'lease:proof-recovery', resource_keys: ['path:src/proof-recovery.mjs'], nonce: NONCE('proof-recovery-admit'),
  }))
  const ended = await registry.endRequest({
    lease_id: 'lease:proof-recovery', expected_oid: admitted.oid, nonce: NONCE('proof-recovery-end'), reason: 'failed',
    owner_end_attestation: endAttestation(admitted.lease),
    handoff_or_candidate_reference: 'candidate:proof-recovery',
  })
  const request = {
    lease_id: 'lease:proof-recovery', expected_oid: ended.oid, expected_envelope_oid: ENVELOPE_OID,
    expected_envelope_transition_sequence: 0,
    attestation: ownerEndFixture({ lease_id: 'lease:proof-recovery', nonce: NONCE('proof-recovery-attestation') }),
  }
  assert.deepEqual(await registry.release(request), {
    status: 'HELD_EXECUTION_AUTHORITY',
    reason: 'RELEASE_RECONCILIATION_REQUIRED',
    reconcile_required: true,
    release_id: `release:${NONCE('proof-recovery-attestation')}`,
  })
  const releasing = await registry.inspect()
  assert.equal(releasing.record.leases['lease:proof-recovery'].state, 'RELEASING')
  assert.equal(Object.hasOwn(releasing.record.leases['lease:proof-recovery'], 'envelope_revocation_proof'), false)
  assert.equal(envelope.calls.length, 1)
  assert.equal(successfulMutations, 1)

  const finalized = await registry.release({ ...request, expected_oid: releasing.oid })
  assert.equal(finalized.status, 'RELEASED')
  assert.equal(finalized.lease.state, 'RELEASED')
  assert.equal(finalized.lease.envelope_revocation_oid, REVOKED_ENVELOPE_OID)
  assert.equal(envelope.calls.length, 2)
  assert.equal(successfulMutations, 1)
})

test('P1 regression — a post-envelope final CAS conflict stays reconcilable and occupied', async () => {
  const fixture = createFixture()
  const { attestor, clock, envelope, store } = fixture
  let rejectFirstFinalization = true
  const contestedStore = {
    commonDirDigest: store.commonDirDigest,
    refs: store.refs,
    read: store.read,
    casGuarded: store.casGuarded,
    async cas(request) {
      if (rejectFirstFinalization && request.ref === store.refs.sessionLeases && request.record.leases['lease:finalize-hold']?.state === 'RELEASED') {
        rejectFirstFinalization = false
        const current = await store.read(request.ref)
        return {
          status: 'CONFLICT', reason: 'CAS_CONFLICT', expected_oid: request.expected_oid,
          actual_oid: current.oid, current,
        }
      }
      return store.cas(request)
    },
  }
  const registry = createLeaseRegistry({
    store: contestedStore, clock, writerCap: 2, ownerEndAttestor: attestor, executionEnvelope: envelope,
  })
  const admitted = await registry.admit(makeRequest(contestedStore, {
    lease_id: 'lease:finalize-hold', resource_keys: ['path:src/finalize-hold.mjs'], nonce: NONCE('finalize-admit'),
  }))
  const ended = await registry.endRequest({
    lease_id: 'lease:finalize-hold', expected_oid: admitted.oid, nonce: NONCE('finalize-end'), reason: 'failed',
    owner_end_attestation: endAttestation(admitted.lease),
    handoff_or_candidate_reference: 'candidate:finalize-hold',
  })
  assert.deepEqual(await registry.release({
    lease_id: 'lease:finalize-hold', expected_oid: ended.oid, expected_envelope_oid: ENVELOPE_OID,
    expected_envelope_transition_sequence: 0,
    attestation: ownerEndFixture({ lease_id: 'lease:finalize-hold', nonce: NONCE('finalize-attestation') }),
  }), {
    status: 'HELD_EXECUTION_AUTHORITY',
    reason: 'RELEASE_FINALIZE_CAS_CONFLICT',
    reconcile_required: true,
    release_id: `release:${NONCE('finalize-attestation')}`,
  })
  const snapshot = await registry.inspect()
  const releasingLease = snapshot.record.leases['lease:finalize-hold']
  assert.equal(releasingLease.state, 'RELEASING')
  assert.equal(envelope.calls.length, 1)
  assert.equal(releasingLease.envelope_revocation_proof.release_id, `release:${NONCE('finalize-attestation')}`)
  assert.equal(releasingLease.envelope_revocation_proof.lease_id, 'lease:finalize-hold')
  assert.equal(releasingLease.envelope_revocation_proof.previous_oid, ENVELOPE_OID)
  assert.equal(releasingLease.envelope_revocation_proof.oid, 'f'.repeat(40))
  assert.equal(releasingLease.envelope_revocation_proof.transition_sequence, 1)
  assert.equal(releasingLease.envelope_revocation_proof.in_flight_command, false)
  const { canonical_digest: proofDigest, ...proofWithoutDigest } = releasingLease.envelope_revocation_proof
  assert.equal(proofDigest, digestCanonical(proofWithoutDigest))

  clock.set('2026-08-29T00:05:00.000Z')
  const restarted = createLeaseRegistry({
    store: contestedStore, clock, writerCap: 2, ownerEndAttestor: attestor, executionEnvelope: envelope,
  })
  const timedOut = await restarted.reconcileTimeout({
    lease_id: 'lease:finalize-hold', expected_oid: snapshot.oid, timeout_ms: 30000,
    nonce: NONCE('finalize-reconcile'),
  })
  assert.equal(timedOut.status, 'HELD_EXECUTION_AUTHORITY')
  assert.equal(timedOut.reason, 'RELEASE_RECONCILIATION_REQUIRED')
  assert.equal(timedOut.reconcile_required, true)
  assert.equal(timedOut.release_id, `release:${NONCE('finalize-attestation')}`)
  assert.equal(timedOut.oid, snapshot.oid)
  assert.equal(timedOut.lease.state, 'RELEASING')
  const afterRestartTimeout = await restarted.inspect()
  assert.equal(afterRestartTimeout.oid, snapshot.oid)
  assert.equal(afterRestartTimeout.record.leases['lease:finalize-hold'].state, 'RELEASING')
  assert.equal(envelope.calls.length, 1)
  for (const [label, attestation, code] of [
    ['unknown nested key', { ...ownerEndFixture({ lease_id: 'lease:finalize-hold', nonce: NONCE('finalize-attestation') }), extra: 'forbidden' }, 'invalid_shape'],
    ['nested raw environment alias', { ...ownerEndFixture({ lease_id: 'lease:finalize-hold', nonce: NONCE('finalize-attestation') }), issuer_id: 'path:env:PAY_TO_ADDRESS' }, 'secret_material_detected'],
    ['tuple drift', { ...ownerEndFixture({ lease_id: 'lease:finalize-hold', nonce: NONCE('finalize-attestation') }), head_sha: 'c'.repeat(40) }, 'owner_end_attestation_tuple_mismatch'],
  ]) {
    const callsBefore = envelope.calls.length
    await assert.rejects(
      restarted.release({
        lease_id: 'lease:finalize-hold', expected_oid: snapshot.oid, expected_envelope_oid: ENVELOPE_OID,
        expected_envelope_transition_sequence: 0, attestation,
      }),
      (error) => error?.code === code,
      label,
    )
    assert.equal((await restarted.inspect()).oid, snapshot.oid, label)
    assert.equal(envelope.calls.length, callsBefore, label)
  }
  const finalized = await restarted.release({
    lease_id: 'lease:finalize-hold', expected_oid: snapshot.oid, expected_envelope_oid: ENVELOPE_OID,
    expected_envelope_transition_sequence: 0,
    attestation: ownerEndFixture({ lease_id: 'lease:finalize-hold', nonce: NONCE('finalize-attestation') }),
  })
  assert.equal(finalized.status, 'RELEASED')
  assert.equal(envelope.calls.length, 1)
  assert.equal((await restarted.inspect()).record.leases['lease:finalize-hold'].state, 'RELEASED')
})

const assertDraft2020Value = (schema, definition, value, context) => {
  if (definition.$ref) return assertDraft2020Value(schema, schema.$defs[definition.$ref.split('/').at(-1)], value, context)
  if (definition.allOf) definition.allOf.forEach((entry) => assertDraft2020Value(schema, entry, value, context))
  if (definition.not?.pattern) assert.doesNotMatch(value, new RegExp(definition.not.pattern, 'u'), context)
  if (Object.hasOwn(definition, 'const')) assert.equal(value, definition.const, context)
  if (definition.enum) assert.equal(definition.enum.includes(value), true, context)
  if (definition.type === 'string') {
    assert.equal(typeof value, 'string', context)
    if (definition.minLength !== undefined) assert.equal(value.length >= definition.minLength, true, context)
    if (definition.maxLength !== undefined) assert.equal(value.length <= definition.maxLength, true, context)
    if (definition.pattern) assert.match(value, new RegExp(definition.pattern, 'u'), context)
  }
  if (definition.type === 'integer') {
    assert.equal(Number.isSafeInteger(value), true, context)
    if (definition.minimum !== undefined) assert.equal(value >= definition.minimum, true, context)
  }
  if (definition.type === 'array') {
    assert.equal(Array.isArray(value), true, context)
    if (definition.minItems !== undefined) assert.equal(value.length >= definition.minItems, true, context)
    if (definition.maxItems !== undefined) assert.equal(value.length <= definition.maxItems, true, context)
    if (definition.uniqueItems) assert.equal(new Set(value).size, value.length, context)
    value.forEach((item, index) => assertDraft2020Value(schema, definition.items, item, `${context}[${index}]`))
  }
}

const assertDraft2020OwnerEndRelease = async (record) => {
  const schema = JSON.parse(await readFile(new URL('../../../agent-contracts/parallel-delivery-fabric.schema.json', import.meta.url), 'utf8'))
  const definition = schema.$defs.owner_end_release
  assert.equal(definition.additionalProperties, false)
  assert.deepEqual(Object.keys(record).sort(), [...definition.required].sort())
  for (const key of definition.required) assertDraft2020Value(schema, definition.properties[key], record[key], `owner_end_release.${key}`)
}

const createReleasedAuditFixture = async () => {
  const fixture = createFixture()
  const { attestor, envelope, leaseRegistry, store } = fixture
  const admitted = await leaseRegistry.admit(makeRequest(store, {
    lease_id: 'lease:canonical-boundary', resource_keys: ['path:src/canonical-boundary.mjs'], nonce: NONCE('canonical-boundary-admit'),
  }))
  const ended = await leaseRegistry.endRequest({
    lease_id: 'lease:canonical-boundary', expected_oid: admitted.oid, nonce: NONCE('canonical-boundary-end'), reason: 'handoff',
    owner_end_attestation: endAttestation(admitted.lease), handoff_or_candidate_reference: 'handoff:canonical-boundary',
  })
  assert.equal((await leaseRegistry.release({
    lease_id: 'lease:canonical-boundary', expected_oid: ended.oid, expected_envelope_oid: ENVELOPE_OID,
    expected_envelope_transition_sequence: 0,
    attestation: ownerEndFixture({ lease_id: 'lease:canonical-boundary', nonce: NONCE('canonical-boundary-attestation') }),
  })).status, 'RELEASED')
  return { leaseRegistry, store, git: fixture.git }
}

test('RED round6: canonical Task3 parser clones, freezes, and rejects forged lease evidence', async () => {
  const activeFixture = createFixture()
  const active = await activeFixture.leaseRegistry.admit(makeRequest(activeFixture.store, {
    lease_id: 'lease:parser-active', resource_keys: ['path:src/parser-active.mjs'], nonce: NONCE('parser-active'),
  }))
  const suspectFixture = createFixture()
  const suspectAdmitted = await suspectFixture.leaseRegistry.admit(makeRequest(suspectFixture.store, {
    lease_id: 'lease:parser-suspect', resource_keys: ['path:src/parser-suspect.mjs'], nonce: NONCE('parser-suspect'),
  }))
  suspectFixture.clock.set('2026-08-29T00:05:00.000Z')
  await suspectFixture.leaseRegistry.reconcileTimeout({
    lease_id: 'lease:parser-suspect', expected_oid: suspectAdmitted.oid, timeout_ms: 30000, nonce: NONCE('parser-suspect-timeout'),
  })
  const endFixture = createFixture()
  const endAdmitted = await endFixture.leaseRegistry.admit(makeRequest(endFixture.store, {
    lease_id: 'lease:parser-end', resource_keys: ['path:src/parser-end.mjs'], nonce: NONCE('parser-end'),
  }))
  await endFixture.leaseRegistry.endRequest({
    lease_id: 'lease:parser-end', expected_oid: endAdmitted.oid, nonce: NONCE('parser-end-request'), reason: 'handoff',
    owner_end_attestation: endAttestation(endAdmitted.lease), handoff_or_candidate_reference: 'handoff:parser-end',
  })
  const releasingFixture = createFixture({ failUpdateAt: 5 })
  const releasingAdmitted = await releasingFixture.leaseRegistry.admit(makeRequest(releasingFixture.store, {
    lease_id: 'lease:parser-releasing', resource_keys: ['path:src/parser-releasing.mjs'], nonce: NONCE('parser-releasing'),
  }))
  const releasingEnd = await releasingFixture.leaseRegistry.endRequest({
    lease_id: 'lease:parser-releasing', expected_oid: releasingAdmitted.oid, nonce: NONCE('parser-releasing-end'), reason: 'handoff',
    owner_end_attestation: endAttestation(releasingAdmitted.lease), handoff_or_candidate_reference: 'handoff:parser-releasing',
  })
  assert.equal((await releasingFixture.leaseRegistry.release({
    lease_id: 'lease:parser-releasing', expected_oid: releasingEnd.oid, expected_envelope_oid: ENVELOPE_OID,
    expected_envelope_transition_sequence: 0,
    attestation: ownerEndFixture({ lease_id: 'lease:parser-releasing', nonce: NONCE('parser-releasing-owner-end') }),
  })).status, 'HELD_EXECUTION_AUTHORITY')
  const { leaseRegistry: releasedRegistry } = await createReleasedAuditFixture()
  const stateFixtures = [
    active.lease,
    (await suspectFixture.leaseRegistry.inspect()).record.leases['lease:parser-suspect'],
    (await endFixture.leaseRegistry.inspect()).record.leases['lease:parser-end'],
    (await releasingFixture.leaseRegistry.inspect()).record.leases['lease:parser-releasing'],
    (await releasedRegistry.inspect()).record.leases['lease:canonical-boundary'],
  ]
  for (const raw of stateFixtures) {
    const parsed = parseSessionLease(raw, raw.lease_id)
    assert.deepEqual(parsed, raw, raw.state)
    assert.equal(JSON.stringify(parsed), JSON.stringify(raw), `${raw.state} byte-compatible`)
    assert.equal(Object.isFrozen(parsed), true, raw.state)
    assert.equal(Object.isFrozen(parsed.resource_keys), true, raw.state)
  }
  const mutable = structuredClone(active.lease)
  const parsed = parseSessionLease(mutable, mutable.lease_id)
  mutable.resource_keys[0] = 'path:src/mutated-after-parse.mjs'
  assert.equal(parsed.resource_keys[0], 'path:src/parser-active.mjs')
  const parsedRegistry = parseSessionLeaseRegistry((await activeFixture.leaseRegistry.inspect()).record)
  assert.deepEqual(parsedRegistry, (await activeFixture.leaseRegistry.inspect()).record)
  assert.equal(JSON.stringify(parsedRegistry), JSON.stringify((await activeFixture.leaseRegistry.inspect()).record))
  assert.equal(Object.isFrozen(parsedRegistry.leases['lease:parser-active']), true)

  const restamp = (candidate) => {
    delete candidate.canonical_digest
    candidate.canonical_digest = digestCanonical(candidate)
    return candidate
  }
  const invalidTimestamp = restamp(structuredClone(active.lease))
  invalidTimestamp.created_at = '2026-02-31T00:00:00.000Z'
  restamp(invalidTimestamp)
  const tooLongResource = restamp(structuredClone(active.lease))
  tooLongResource.resource_keys = [`path:${'a'.repeat(252)}`]
  restamp(tooLongResource)
  const forgedReservation = restamp(structuredClone(stateFixtures.find((candidate) => candidate.state === 'RELEASING')))
  forgedReservation.release_reservation.created_at = '2026-02-31T00:00:00.000Z'
  restamp(forgedReservation.release_reservation)
  restamp(forgedReservation)
  const forgedProof = restamp(structuredClone(stateFixtures.find((candidate) => candidate.state === 'RELEASING')))
  forgedProof.envelope_revocation_proof.previous_oid = SHA1
  restamp(forgedProof.envelope_revocation_proof)
  restamp(forgedProof)
  const released = stateFixtures.at(-1)
  const forgedRelease = restamp(structuredClone(released))
  forgedRelease.release_record.lease_id = 'lease:forged-release'
  restamp(forgedRelease)
  for (const [label, forged] of [
    ['non-roundtrip timestamp', invalidTimestamp],
    ['257-byte resource key', tooLongResource],
    ['forged reservation timestamp', forgedReservation],
    ['forged envelope proof', forgedProof],
    ['forged release record', forgedRelease],
  ]) {
    assert.throws(() => parseSessionLease(forged, forged.lease_id), undefined, label)
  }
})

const forgeReleaseAudit = (snapshot, mutate) => {
  const record = structuredClone(snapshot.record)
  const lease = record.leases['lease:canonical-boundary']
  mutate(lease.release_record)
  delete lease.canonical_digest
  record.leases['lease:canonical-boundary'] = stampedFixture(lease)
  delete record.canonical_digest
  return stampedFixture(record)
}

const forgeRegistryLease = (snapshot, leaseId, mutate) => {
  const record = structuredClone(snapshot.record)
  const lease = record.leases[leaseId]
  mutate(lease)
  delete lease.canonical_digest
  record.leases[leaseId] = stampedFixture(lease)
  delete record.canonical_digest
  return stampedFixture(record)
}

test('RED round7: parser rejects zero predecessor OIDs and cross-lease release proof', async () => {
  const { leaseRegistry: releasedRegistry } = await createReleasedAuditFixture()
  const releasedSnapshot = await releasedRegistry.inspect()
  assert.doesNotThrow(() => parseSessionLeaseRegistry(releasedSnapshot.record), 'valid RELEASED lease remains canonical')

  const zeroExpectedRegistryOid = forgeRegistryLease(releasedSnapshot, 'lease:canonical-boundary', (lease) => {
    lease.release_record.expected_registry_oid = ZERO_OID
  })
  const zeroExpectedEnvelopeOid = forgeRegistryLease(releasedSnapshot, 'lease:canonical-boundary', (lease) => {
    lease.release_record.expected_envelope_oid = ZERO_OID
  })

  const releasingFixture = createFixture({ failUpdateAt: 5 })
  const admitted = await releasingFixture.leaseRegistry.admit(makeRequest(releasingFixture.store, {
    lease_id: 'lease:parser-proof-source', resource_keys: ['path:src/parser-proof-source.mjs'], nonce: NONCE('parser-proof-source-admit'),
  }))
  const ending = await releasingFixture.leaseRegistry.endRequest({
    lease_id: 'lease:parser-proof-source', expected_oid: admitted.oid, nonce: NONCE('parser-proof-source-end'), reason: 'handoff',
    owner_end_attestation: endAttestation(admitted.lease), handoff_or_candidate_reference: 'handoff:parser-proof-source',
  })
  assert.equal((await releasingFixture.leaseRegistry.release({
    lease_id: 'lease:parser-proof-source', expected_oid: ending.oid, expected_envelope_oid: ENVELOPE_OID,
    expected_envelope_transition_sequence: 0,
    attestation: ownerEndFixture({ lease_id: 'lease:parser-proof-source', nonce: NONCE('parser-proof-source-attestation') }),
  })).status, 'HELD_EXECUTION_AUTHORITY')
  const crossLeaseProof = forgeRegistryLease(await releasingFixture.leaseRegistry.inspect(), 'lease:parser-proof-source', (lease) => {
    lease.envelope_revocation_proof.lease_id = 'lease:parser-proof-other'
    delete lease.envelope_revocation_proof.canonical_digest
    lease.envelope_revocation_proof = stampedFixture(lease.envelope_revocation_proof)
  })

  for (const [label, forged, code] of [
    ['zero release expected_registry_oid', zeroExpectedRegistryOid, 'invalid_value'],
    ['zero release expected_envelope_oid', zeroExpectedEnvelopeOid, 'invalid_value'],
    ['cross-lease release reservation/proof', crossLeaseProof, 'registry_record_invalid'],
  ]) {
    assert.throws(() => parseSessionLeaseRegistry(forged), (error) => error?.code === code, label)
  }
})

test('P1 regression — local release audit acceptance exactly matches Task 2 owner_end_release boundaries', async () => {
  const opaque128 = `a:${'a'.repeat(126)}`
  const opaque129 = `a:${'a'.repeat(127)}`
  const retained = (count, prefix = 'path:src/canonical') => Array.from({ length: count }, (_, index) => `${prefix}-${index}.mjs`)
  const cases = [
    ['opaque ID at 128', (release) => { release.attestor_issuer = opaque128 }, true],
    ['opaque ID at 129', (release) => { release.attestor_issuer = opaque129 }, false],
    ['lowercase resource key', (release) => { release.retained_resource_keys = ['path:src/lowercase.mjs'] }, true],
    ['uppercase resource kind', (release) => { release.retained_resource_keys = ['Path:src/uppercase.mjs'] }, false],
    ['256 retained resource keys', (release) => { release.retained_resource_keys = retained(256) }, true],
    ['257 retained resource keys', (release) => { release.retained_resource_keys = retained(257) }, false],
    ['extra closed key', (release) => { release.extra = 'forbidden' }, false],
    ['missing closed key', (release) => { delete release.nonce }, false],
  ]
  const admissionFixture = createFixture()
  await assert.rejects(
    admissionFixture.leaseRegistry.admit(makeRequest(admissionFixture.store, {
      lease_id: 'lease:over-resource-bound',
      resource_keys: retained(257, 'path:resource'),
      nonce: NONCE('over-resource-bound'),
    })),
    (error) => error?.code === 'invalid_shape',
    'admission rejects the 257th resource before registry access',
  )
  assert.equal(admissionFixture.git.calls.length, 0)
  for (const [label, mutate, expectedCanonical] of cases) {
    const { git, leaseRegistry, store } = await createReleasedAuditFixture()
    const snapshot = await leaseRegistry.inspect()
    const forged = forgeReleaseAudit(snapshot, mutate)
    const release = forged.leases['lease:canonical-boundary'].release_record
    if (expectedCanonical) await assertDraft2020OwnerEndRelease(release)
    else await assert.rejects(assertDraft2020OwnerEndRelease(release), undefined, label)
    const blob = JSON.stringify(forged)
    const oid = createHash('sha1').update(blob).digest('hex')
    git.blobs.set(oid, blob)
    git.refs.set(store.refs.sessionLeases, oid)
    const inspected = await leaseRegistry.inspect()
    if (expectedCanonical) assert.equal(inspected.record.leases['lease:canonical-boundary'].release_record.attestor_issuer, release.attestor_issuer, label)
    else assert.deepEqual(inspected, {
      status: 'HELD_REGISTRY_INTEGRITY', reason: 'PERSISTED_RECORD_INVALID', ref: store.refs.sessionLeases,
    }, label)
  }
})

test('P1 regression — release requires a proven one-winner envelope CAS and persists a closed audit record', async () => {
  const fixture = createFixture()
  const { attestor, leaseRegistry, store } = fixture
  const envelope = createEnvelopeCasPort()
  const guardedRegistry = createLeaseRegistry({ store, clock: fixture.clock, writerCap: 2, ownerEndAttestor: attestor, executionEnvelope: envelope })
  const admitted = await guardedRegistry.admit(makeRequest(store, {
    lease_id: 'lease:release-proof',
    resource_keys: ['path:src/release-proof.mjs'],
    nonce: NONCE('release-proof-admit'),
  }))
  const ending = await guardedRegistry.endRequest({
    lease_id: 'lease:release-proof',
    owner_end_attestation: endAttestation(admitted.lease),
    expected_oid: admitted.oid,
    nonce: NONCE('release-proof-end'),
    reason: 'handoff',
    handoff_or_candidate_reference: 'handoff:release-proof',
  })
  const releaseRequest = {
    lease_id: 'lease:release-proof',
    expected_oid: ending.oid,
    expected_envelope_oid: 'e'.repeat(40),
    expected_envelope_transition_sequence: 0,
    attestation: ownerEndFixture(),
  }
  const [first, second] = await Promise.all([
    guardedRegistry.release(releaseRequest),
    guardedRegistry.release(releaseRequest),
  ])
  assert.equal([first, second].filter((result) => result.status === 'RELEASED').length, 1)
  assert.equal([first, second].filter((result) => result.status === 'CONFLICT').length, 1)
  assert.equal(envelope.successfulMutations, 1)
  const released = (await guardedRegistry.inspect()).record.leases['lease:release-proof']
  await assertDraft2020OwnerEndRelease(released.release_record)
  assert.equal(released.release_record.expected_envelope_oid, 'e'.repeat(40))
  assert.equal(released.release_record.transition_sequence, 0)
  assert.equal(released.release_record.handoff_or_candidate_reference, 'handoff:release-proof')

  const recovered = createLeaseRegistry({ store, clock: fixture.clock, writerCap: 2, ownerEndAttestor: attestor, executionEnvelope: envelope })
  const recoveredRelease = (await recovered.inspect()).record.leases['lease:release-proof'].release_record
  assert.equal(recoveredRelease.release_id, released.release_record.release_id)
  await assertDraft2020OwnerEndRelease(recoveredRelease)

  await assert.rejects(
    guardedRegistry.release({ ...releaseRequest, expected_envelope_oid: 'envelope:non-sha' }),
    (error) => error?.code === 'invalid_value',
  )
  assert.equal(envelope.successfulMutations, 1)
})

test('P2 regression — attestor and envelope failures return typed evidence holds without registry mutation', async () => {
  const fixture = createFixture()
  const { leaseRegistry, store } = fixture
  const admitted = await leaseRegistry.admit(makeRequest(store, {
    lease_id: 'lease:port-failure',
    resource_keys: ['path:src/port-failure.mjs'],
    nonce: NONCE('port-failure-admit'),
  }))
  const ending = await leaseRegistry.endRequest({
    lease_id: 'lease:port-failure',
    expected_oid: admitted.oid,
    nonce: NONCE('port-failure-end'),
    reason: 'failed',
    owner_end_attestation: endAttestation(admitted.lease), handoff_or_candidate_reference: 'candidate:port-failure',
  })
  const throwingAttestor = { async verify() { throw new Error('attestor unavailable') } }
  const heldByAttestor = createLeaseRegistry({ store, clock: fixture.clock, writerCap: 2, ownerEndAttestor: throwingAttestor, executionEnvelope: fixture.envelope })
  assert.deepEqual(await heldByAttestor.release({
    lease_id: 'lease:port-failure', expected_oid: ending.oid, expected_envelope_oid: 'e'.repeat(40),
    expected_envelope_transition_sequence: 0, attestation: ownerEndFixture({ lease_id: 'lease:port-failure', nonce: NONCE('port-failure-attestor') }),
  }), {
    status: 'HELD_EXECUTION_AUTHORITY',
    reason: 'OWNER_END_ATTESTATION_EVIDENCE_GAP',
    reconcile_required: true,
  })
  const unchanged = await leaseRegistry.inspect()
  assert.equal(unchanged.oid, ending.oid)
})

const MANAGED_BASE_SHA = 'c'.repeat(40)
const MANAGED_HEAD_SHA = 'd'.repeat(40)
const MANAGED_REGISTRY_OID = 'e'.repeat(40)
const MANAGED_PROTECTION_DIGEST = 'f'.repeat(64)

const managedBranchRecord = (overrides = {}) => {
  const record = {
    schema_version: 'managed-branch/v1',
    branch: 'develop',
    branch_class: 'develop',
    owner_authority: 'authority:managed-base',
    protection_profile_digest: MANAGED_PROTECTION_DIGEST,
    base_ref: 'origin/main',
    base_sha: MANAGED_BASE_SHA,
    generation: 7,
    scope_digest: SHA256,
    allowed_merge_targets: ['origin/main'],
    created_at: '2026-08-29T00:00:00.000Z',
    renewed_at: '2026-08-29T00:00:00.000Z',
    expires_at: '2026-08-29T01:00:00.000Z',
    current_head_sha: MANAGED_HEAD_SHA,
    registry_oid: MANAGED_REGISTRY_OID,
    managed_base_lease_id: 'lease:managed-base',
    transition_sequence: 4,
    state: 'ACTIVE',
    ...overrides,
  }
  const { canonical_digest: ignoredDigest, registry_oid: ignoredRegistryOid, ...digestInput } = record
  return { ...record, canonical_digest: digestCanonical(digestInput) }
}

const managedRegistryState = (branch, usedNonces = {}, extraBranches = []) => ({
  schema_version: 'managed-branch-registry/v2',
  branches: Object.fromEntries([branch, ...extraBranches].map((record) => [record.branch, record])),
  used_nonces: usedNonces,
})

const createInMemoryManagedCas = ({ branch = managedBranchRecord(), raceBarrier = undefined, usedNonces = {}, extraBranches = [] } = {}) => {
  let current = { oid: branch.registry_oid, record: managedRegistryState(branch, usedNonces, extraBranches) }
  let casCalls = 0
  const calls = []
  const sideEffects = { network: 0, process: 0, delete: 0, worktree: 0, acl: 0 }
  const oidFor = (value) => createHash('sha1').update(JSON.stringify(value)).digest('hex')
  return {
    calls,
    sideEffects,
    async read(ref) {
      calls.push({ kind: 'read', ref })
      return structuredClone(current)
    },
    async cas({ ref, expected_oid, record }) {
      calls.push({ kind: 'cas', ref, expected_oid })
      casCalls += 1
      if (raceBarrier && casCalls <= 2) await raceBarrier()
      if (current.oid !== expected_oid) {
        return {
          status: 'CONFLICT',
          expected_oid,
          actual_oid: current.oid,
          current: structuredClone(current),
        }
      }
      const previousOid = current.oid
      const oid = oidFor(record)
      current = { oid, record: structuredClone(record) }
      return { status: 'STORED', oid, previous_oid: previousOid, record: structuredClone(record) }
    },
  }
}

const managedRenewCommand = (record, overrides = {}) => ({
  schema_version: 'managed-branch-command/v1',
  branch: record.branch,
  action: 'renew',
  operation_id: 'operation:managed-renew',
  owner_authority: record.owner_authority,
  managed_base_lease_id: record.managed_base_lease_id,
  current_generation: record.generation,
  expected_registry_oid: record.registry_oid,
  expected_base_sha: record.base_sha,
  expected_head_sha: record.current_head_sha,
  expected_protection_profile_digest: record.protection_profile_digest,
  transition_sequence: record.transition_sequence,
  nonce: NONCE('managed-renew'),
  requested_expires_at: '2026-08-29T02:00:00.000Z',
  authorized_expires_at: '2026-08-29T03:00:00.000Z',
  ...overrides,
})

const createManagedRenewalAuthority = ({
  authorizedExpiresAt = '2026-08-29T03:00:00.000Z',
  decisionPatch = {},
} = {}) => {
  const calls = []
  return {
    calls,
    async verifyRenewal(request) {
      calls.push(structuredClone(request))
      return {
        schema_version: 'managed-branch-renewal-authority-decision/v1',
        verdict: 'AUTHORIZED',
        request_digest: request.request_digest,
        authorized_expires_at: authorizedExpiresAt,
        ...decisionPatch,
      }
    },
  }
}

const createManagedFixture = ({ branch = managedBranchRecord(), raceBarrier = undefined, usedNonces = {}, extraBranches = [] } = {}) => {
  const store = createInMemoryManagedCas({ branch, raceBarrier, usedNonces, extraBranches })
  const clock = createClock()
  const managedBranchAuthority = createManagedRenewalAuthority()
  return {
    store,
    clock,
    managedBranchAuthority,
    registry: createManagedBranchRegistry({ store, clock, managedBranchAuthority }),
  }
}

test('AC-39 — managed registry composes with the namespaced Git CAS store', async () => {
  const git = createInMemoryGit()
  const store = createGitCasStore({ git, commonDir: 'C:/fake/common-dir' })
  const seeded = await store.cas({
    ref: store.refs.managedBranches,
    expected_oid: ZERO_OID,
    record: managedRegistryState(managedBranchRecord()),
  })
  assert.equal(seeded.status, 'STORED')
  const registry = createManagedBranchRegistry({
    store, clock: createClock(), managedBranchAuthority: createManagedRenewalAuthority(),
  })
  const before = await registry.inspect(managedBranchRecord().branch)
  assert.equal(before.status, 'READY')
  const renewed = await registry.renew(managedRenewCommand(before.record))
  assert.equal(renewed.status, 'RENEWED')
  assert.notEqual(renewed.registry_oid, seeded.oid)
  assert.deepEqual([...git.refs.keys()], ['refs/ai-bim/managed-branches'])
})

test('AC-39 — managed record is closed, digest-stable, and renew changes only its expiry transition', async () => {
  const branch = managedBranchRecord()
  const parsed = parseManagedBranchRecord(branch)
  assert.deepEqual(parsed, branch)
  assert.equal(Object.isFrozen(parsed), true)
  assert.equal(parsed.canonical_digest, digestCanonical((({ canonical_digest, registry_oid, ...value }) => value)(branch)))

  const { registry, store } = createManagedFixture({ branch })
  const before = await registry.inspect(branch.branch)
  assert.equal(before.registry_oid, MANAGED_REGISTRY_OID)
  const renewed = await registry.renew(managedRenewCommand(before.record))
  assert.equal(renewed.status, 'RENEWED')
  assert.notEqual(renewed.registry_oid, before.registry_oid)
  assert.equal(renewed.record.registry_oid, renewed.registry_oid)
  assert.equal(renewed.record.expires_at, '2026-08-29T02:00:00.000Z')
  assert.equal(renewed.record.renewed_at, '2026-08-29T00:00:00.000Z')
  assert.equal(renewed.record.transition_sequence, 5)
  assert.notEqual(renewed.record.canonical_digest, before.record.canonical_digest)
  for (const key of [
    'schema_version', 'branch', 'branch_class', 'owner_authority', 'protection_profile_digest', 'base_ref', 'base_sha',
    'generation', 'scope_digest', 'allowed_merge_targets', 'created_at', 'current_head_sha', 'managed_base_lease_id', 'state',
  ]) assert.deepEqual(renewed.record[key], before.record[key], key)
  assert.equal(store.calls.filter((call) => call.kind === 'cas').length, 1)
  assert.equal(store.calls.find((call) => call.kind === 'cas').ref, 'refs/ai-bim/managed-branches')
  assert.equal(store.calls.filter((call) => call.kind === 'read').every((call) => call.ref === 'refs/ai-bim/managed-branches'), true)
  assert.deepEqual(store.sideEffects, { network: 0, process: 0, delete: 0, worktree: 0, acl: 0 })
})

test('AC-39 — managed renewal requires a trusted authority decision bound to the exact request', async () => {
  const branch = managedBranchRecord()
  const missingStore = createInMemoryManagedCas({ branch })
  const missing = createManagedBranchRegistry({ store: missingStore, clock: createClock() })
  const unavailable = await missing.renew(managedRenewCommand(branch))
  assert.equal(unavailable.status, 'HELD_MANAGED_BRANCH')
  assert.equal(unavailable.reason, 'RENEWAL_AUTHORITY_UNAVAILABLE')
  assert.equal(missingStore.calls.filter((call) => call.kind === 'cas').length, 0)

  const store = createInMemoryManagedCas({ branch })
  const authority = createManagedRenewalAuthority()
  const registry = createManagedBranchRegistry({ store, clock: createClock(), managedBranchAuthority: authority })
  const callerExtended = await registry.renew(managedRenewCommand(branch, {
    authorized_expires_at: '2026-08-30T00:00:00.000Z',
  }))
  assert.equal(callerExtended.status, 'HELD_MANAGED_BRANCH')
  assert.equal(callerExtended.reason, 'RENEWAL_AUTHORITY_MISMATCH')
  assert.equal(authority.calls.length, 1)
  assert.equal(store.calls.filter((call) => call.kind === 'cas').length, 0)

  for (const [label, managedBranchAuthority, expectedReason] of [
    ['throwing verifier', { verifyRenewal: async () => { throw new Error('authority unavailable') } }, 'RENEWAL_AUTHORITY_REJECTED'],
    ['wrong request digest', createManagedRenewalAuthority({ decisionPatch: { request_digest: SHA256 } }), 'RENEWAL_AUTHORITY_MISMATCH'],
  ]) {
    const rejectedStore = createInMemoryManagedCas({ branch })
    const rejectedRegistry = createManagedBranchRegistry({
      store: rejectedStore, clock: createClock(), managedBranchAuthority,
    })
    const rejected = await rejectedRegistry.renew(managedRenewCommand(branch))
    assert.equal(rejected.status, 'HELD_MANAGED_BRANCH', label)
    assert.equal(rejected.reason, expectedReason, label)
    assert.equal(rejectedStore.calls.filter((call) => call.kind === 'cas').length, 0, label)
  }
})

test('P2 regression — managed renewal rotates old nonce receipts without exhausting renewal authority', async () => {
  const usedNonces = Object.fromEntries(Array.from({ length: 4096 }, (_, index) => [
    NONCE(`managed-capacity-${index}`),
    { operation_id: `operation:managed-capacity-${index}`, consumed_at: '2026-08-29T00:00:00.000Z' },
  ]))
  const { registry, store, managedBranchAuthority } = createManagedFixture({ usedNonces })
  const current = (await registry.inspect(managedBranchRecord().branch)).record
  const outcome = await registry.renew(managedRenewCommand(current, {
    operation_id: 'operation:managed-capacity-new', nonce: NONCE('managed-capacity-new'),
  }))
  assert.equal(outcome.status, 'RENEWED')
  assert.equal(managedBranchAuthority.calls.length, 1)
  assert.equal(store.calls.filter((call) => call.kind === 'cas').length, 1)
  const persisted = (await registry.inspect(current.branch)).record
  assert.equal(persisted.transition_sequence, current.transition_sequence + 1)
})

test('AC-39 RED — two same-OID renew operations have exactly one local CAS winner', async () => {
  let arrivals = 0
  let releaseBarrier
  const barrier = new Promise((resolve) => { releaseBarrier = resolve })
  const { registry } = createManagedFixture({
    raceBarrier: async () => {
      arrivals += 1
      if (arrivals === 2) releaseBarrier()
      await barrier
    },
  })
  const current = (await registry.inspect(managedBranchRecord().branch)).record
  const [left, right] = await Promise.all([
    registry.renew(managedRenewCommand(current, { operation_id: 'operation:managed-left', nonce: NONCE('managed-left') })),
    registry.renew(managedRenewCommand(current, { operation_id: 'operation:managed-right', nonce: NONCE('managed-right') })),
  ])
  assert.equal([left, right].filter((result) => result.status === 'RENEWED').length, 1)
  const loser = [left, right].find((result) => result.status === 'HELD_MANAGED_BRANCH')
  assert.equal(loser.reason, 'REGISTRY_CAS_CONFLICT')
  assert.equal(loser.retention_state, 'RETAINED_FOR_REVIEW')
})

test('AC-39 RED — renewal rejects drift, replay, direct push, and unsafe fields before a CAS write', async () => {
  const branch = managedBranchRecord()
  const checks = [
    ['owner', { owner_authority: 'authority:other' }, 'OWNER_MISMATCH'],
    ['managed-base lease', { managed_base_lease_id: 'lease:other' }, 'MANAGED_BASE_LEASE_REQUIRED'],
    ['head', { expected_head_sha: SHA1 }, 'EXPECTED_HEAD_MISMATCH'],
    ['base', { expected_base_sha: SHA1 }, 'EXPECTED_BASE_MISMATCH'],
    ['protection', { expected_protection_profile_digest: SHA256 }, 'PROTECTION_PROFILE_DRIFT'],
    ['registry OID', { expected_registry_oid: SHA1 }, 'REGISTRY_OID_MISMATCH'],
    ['generation', { current_generation: branch.generation + 1 }, 'GENERATION_MISMATCH'],
    ['nonce', { nonce: 'too-short' }, 'NONCE_INVALID'],
    ['expiry', { requested_expires_at: branch.expires_at }, 'EXPIRY_NOT_EXTENDED'],
    ['policy expiry', { requested_expires_at: '2026-08-29T04:00:00.000Z' }, 'EXPIRY_POLICY_BOUND'],
    ['direct push', { action: 'direct_push' }, 'DIRECT_PUSH_FORBIDDEN'],
    ['unknown field', { unknown_metadata: 'forbidden' }, 'COMMAND_SCHEMA_INVALID'],
    ['secret field', { owner_authority: 'authority:ghp_abcdefghijklmno' }, 'SECRET_MATERIAL_DETECTED'],
  ]
  for (const [label, patch, reason] of checks) {
    const { registry, store } = createManagedFixture({ branch })
    const outcome = await registry.renew(managedRenewCommand(branch, patch))
    assert.equal(outcome.status, 'HELD_MANAGED_BRANCH', label)
    assert.equal(outcome.reason, reason, label)
    assert.equal(outcome.retention_state, 'RETAINED_FOR_REVIEW', label)
    assert.equal(store.calls.filter((call) => call.kind === 'cas').length, 0, label)
    if (label === 'direct push' || label === 'unknown field' || label === 'secret field' || label === 'nonce') {
      assert.equal(store.calls.length, 0, label)
    }
  }

  const { registry, store, clock } = createManagedFixture({ branch })
  const renewed = await registry.renew(managedRenewCommand(branch))
  assert.equal(renewed.status, 'RENEWED')
  const replay = await registry.renew(managedRenewCommand(renewed.record, {
    nonce: NONCE('managed-renew'),
    operation_id: 'operation:managed-replay',
    requested_expires_at: '2026-08-29T03:00:00.000Z',
    authorized_expires_at: '2026-08-29T04:00:00.000Z',
  }))
  assert.deepEqual({ status: replay.status, reason: replay.reason, retention_state: replay.retention_state }, {
    status: 'HELD_MANAGED_BRANCH', reason: 'NONCE_REPLAY', retention_state: 'RETAINED_FOR_REVIEW',
  })
  assert.equal(store.calls.filter((call) => call.kind === 'cas').length, 1)

  clock.set('2026-08-29T02:00:00.000Z')
  const expired = await registry.renew(managedRenewCommand(renewed.record, {
    nonce: NONCE('managed-expired'), operation_id: 'operation:managed-expired',
    requested_expires_at: '2026-08-29T04:00:00.000Z', authorized_expires_at: '2026-08-29T05:00:00.000Z',
  }))
  assert.deepEqual({ status: expired.status, reason: expired.reason, state: expired.state, retention_state: expired.retention_state }, {
    status: 'HELD_MANAGED_BRANCH', reason: 'MANAGED_BRANCH_EXPIRED', state: 'FROZEN', retention_state: 'RETAINED_FOR_REVIEW',
  })
})

test('P2 regression — ending a lease requires an owner-session-bound attestation that matches the exact lease', async () => {
  const { leaseRegistry, store } = createFixture()
  const admitted = await leaseRegistry.admit(makeRequest(store, {
    lease_id: 'lease:end-authority', resource_keys: ['path:src/end-authority.mjs'], nonce: NONCE('end-authority-admit'),
  }))
  assert.equal(admitted.status, 'ADMITTED')
  const request = (overrides, attestationPatch = {}) => ({
    lease_id: 'lease:end-authority', expected_oid: admitted.oid, reason: 'aborted',
    handoff_or_candidate_reference: 'handoff:end-authority',
    owner_end_attestation: endAttestation(admitted.lease, attestationPatch),
    ...overrides,
  })
  for (const [label, patch] of [
    ['another local writer', { owner_session: 'session:intruder' }],
    ['self-issued', { issuer_id: 'session:owner-one' }],
    ['expired', { observed_at: '2026-08-27T00:00:00.000Z', expires_at: '2026-08-28T00:00:00.000Z' }],
    ['other lease', { lease_id: 'lease:other' }],
  ]) {
    const held = await leaseRegistry.endRequest(request({ nonce: NONCE(`end-authority-${label.replace(/[^A-Za-z0-9]/gu, '')}`) }, patch))
    assert.deepEqual({ status: held.status, reason: held.reason }, { status: 'HELD_EXECUTION_AUTHORITY', reason: 'END_REQUEST_UNAUTHORIZED' }, label)
    assert.equal((await leaseRegistry.inspect()).record.leases['lease:end-authority'].state, 'ACTIVE', label)
  }
  assert.throws(() => leaseRegistry.endRequest({ ...request({ nonce: NONCE('end-authority-missing') }), owner_end_attestation: undefined }), (error) => error?.code === 'invalid_shape')
  const ended = await leaseRegistry.endRequest(request({ nonce: NONCE('end-authority-ok') }))
  assert.equal(ended.status, 'END_REQUESTED')
  const persisted = (await leaseRegistry.inspect()).record.leases['lease:end-authority']
  assert.equal(persisted.state, 'END_REQUESTED')
})

test('P2 regression — managed branches are keyed by branch identity and renewed independently', async () => {
  const develop = managedBranchRecord()
  const release = managedBranchRecord({
    branch: 'release/2026.09', branch_class: 'release', managed_base_lease_id: 'lease:managed-release',
    current_head_sha: SHA1, base_sha: SHA1,
  })
  const { registry, store } = createManagedFixture({ branch: develop, extraBranches: [release] })
  const all = await registry.inspect()
  assert.equal(all.status, 'READY')
  assert.deepEqual(Object.keys(all.branches).sort(), [develop.branch, 'release/2026.09'].sort())
  const unknown = await registry.inspect('hotfix/none')
  assert.deepEqual({ status: unknown.status, reason: unknown.reason }, { status: 'HELD_MANAGED_BRANCH', reason: 'MANAGED_BRANCH_UNKNOWN' })
  const releaseBefore = await registry.inspect('release/2026.09')
  assert.equal(releaseBefore.record.branch_class, 'release')
  const renewed = await registry.renew(managedRenewCommand(releaseBefore.record, {
    nonce: NONCE('managed-release-renew'), operation_id: 'operation:managed-release-renew',
  }))
  assert.equal(renewed.status, 'RENEWED')
  assert.equal(renewed.record.branch, 'release/2026.09')
  assert.equal(renewed.record.transition_sequence, release.transition_sequence + 1)
  // The other managed branch is untouched by the release renewal and still renews on its own.
  const developAfter = await registry.inspect(develop.branch)
  assert.equal(developAfter.record.transition_sequence, develop.transition_sequence)
  assert.equal(developAfter.record.expires_at, develop.expires_at)
  const developRenewed = await registry.renew(managedRenewCommand(developAfter.record, {
    nonce: NONCE('managed-develop-renew'), operation_id: 'operation:managed-develop-renew',
  }))
  assert.equal(developRenewed.status, 'RENEWED')
  const missingBranch = await registry.renew(managedRenewCommand(developRenewed.record, {
    branch: 'hotfix/none', nonce: NONCE('managed-missing'), operation_id: 'operation:managed-missing',
  }))
  assert.deepEqual({ status: missingBranch.status, reason: missingBranch.reason }, { status: 'HELD_MANAGED_BRANCH', reason: 'MANAGED_BRANCH_UNKNOWN' })
  const invalidBranch = await registry.renew(managedRenewCommand(developRenewed.record, {
    branch: 'feature/not-managed', nonce: NONCE('managed-invalid'), operation_id: 'operation:managed-invalid',
  }))
  assert.equal(invalidBranch.reason, 'COMMAND_SCHEMA_INVALID')
  assert.equal(store.calls.filter((call) => call.kind === 'cas').length, 2)
})

test('P2 regression — released leases compact into retained-resource stubs that still gate admission, and consumed attestations expire out of the ledger', async () => {
  const git = createInMemoryGit()
  git.blobs.set(SEEDED_PLAN_OID, SEEDED_PLAN_BLOB)
  git.refs.set('refs/ai-bim/delivery-plans', SEEDED_PLAN_OID)
  const clock = createClock()
  const store = createGitCasStore({ git, commonDir: 'C:/fake/common-dir' })
  const envelope = createSequencedEnvelopePort()
  const leaseRegistry = createLeaseRegistry({
    store, clock, writerCap: 2, ownerEndAttestor: createTrustedAttestor(), executionEnvelope: envelope, retainedReleasedLeases: 1,
  })
  const releaseLease = async (leaseId, overrides, attestationSuffix) => {
    const admitted = await leaseRegistry.admit(makeRequest(store, { lease_id: leaseId, ...overrides }))
    assert.equal(admitted.status, 'ADMITTED')
    const end = await leaseRegistry.endRequest({
      lease_id: leaseId, expected_oid: admitted.oid, nonce: NONCE(`${attestationSuffix}-end`), reason: 'handoff',
      handoff_or_candidate_reference: `handoff:${attestationSuffix}`, owner_end_attestation: endAttestation(admitted.lease),
    })
    const attestation = {
      attestation_ref: `attestation:${attestationSuffix}`, attestation_digest: SHA256,
      issuer_id: 'attestor:owner-end', issuer_version: 'owner-end/v1', owner_session: admitted.lease.owner_session,
      provider: 'codex', provider_session_id: admitted.lease.provider_session_id, execution_context_id: admitted.lease.execution_context_id,
      lease_id: leaseId, generation: 1, head_sha: SHA1, scope_digest: admitted.lease.scope_digest,
      worktree_path_digest: SHA256, observed_at: '2026-08-29T00:00:00.000Z',
      expires_at: '2026-08-29T00:10:00.000Z', nonce: NONCE(`${attestationSuffix}-owner-end`), revocation_epoch: 0,
    }
    const { oid: envelopeOid, transitionSequence } = envelope.current()
    const released = await leaseRegistry.release({
      lease_id: leaseId, expected_oid: end.oid, expected_envelope_oid: envelopeOid,
      expected_envelope_transition_sequence: transitionSequence, attestation,
    })
    assert.equal(released.status, 'RELEASED', JSON.stringify(released))
    return attestation
  }
  await releaseLease('lease:compact-a', { resource_keys: ['path:src/compact-a.mjs'] }, 'compact-a')
  clock.set('2026-08-29T00:01:00.000Z')
  const attestationB = await releaseLease('lease:compact-b', {
    owner_session: 'session:compact-b', provider_session_id: 'provider:compact-b', execution_context_id: 'context:compact-b',
    worktree_id: 'worktree:compact-b', branch: 'codex/compact-b', resource_keys: ['path:src/compact-b.mjs'],
  }, 'compact-b')
  // Only the newest released record stays in full; the older one is a stub that keeps its resources.
  let record = (await leaseRegistry.inspect()).record
  assert.deepEqual(Object.keys(record.leases), ['lease:compact-b'])
  assert.deepEqual(Object.keys(record.retained_resources), ['lease:compact-a'])
  assert.deepEqual(record.retained_resources['lease:compact-a'].resource_keys, ['path:src/compact-a.mjs'])
  assert.equal(record.retained_resources['lease:compact-a'].release_reason, 'handoff')
  assert.equal(typeof record.used_owner_end_attestations['attestation:compact-a'].expires_at, 'string')
  const blocked = await leaseRegistry.admit(makeRequest(store, {
    lease_id: 'lease:compact-c', owner_session: 'session:compact-c', provider_session_id: 'provider:compact-c',
    execution_context_id: 'context:compact-c', worktree_id: 'worktree:compact-c', branch: 'codex/compact-c',
    resource_keys: ['path:src/compact-a.mjs'], nonce: NONCE('compact-c-admit'),
  }))
  assert.deepEqual({ status: blocked.status, reason: blocked.reason }, { status: 'QUEUED_FOR_LEASE', reason: 'RESOURCE_CONFLICT' })
  const rebound = await leaseRegistry.admit(makeRequest(store, {
    lease_id: 'lease:compact-a', owner_session: 'session:compact-d', provider_session_id: 'provider:compact-d',
    execution_context_id: 'context:compact-d', worktree_id: 'worktree:compact-d', branch: 'codex/compact-d',
    resource_keys: ['path:src/compact-d.mjs'], nonce: NONCE('compact-d-admit'),
  }))
  assert.deepEqual({ status: rebound.status, reason: rebound.reason }, { status: 'HELD_EXECUTION_AUTHORITY', reason: 'LEASE_ID_ALREADY_BOUND' })
  // A compacted handoff still satisfies a dependency lookup for its task.
  const dependent = await leaseRegistry.validateDependencies({
    plan_id: 'plan:one', generation: 1, task_id: 'task:compact-dependent', dependency_task_ids: ['task:one'], expected_parent_sha: SHA1,
  })
  assert.notEqual(dependent.reason, 'DEPENDENCY_NOT_COMPLETED')
  // Consumed attestations leave the ledger only after expiry plus the grace window.
  clock.set('2026-08-29T00:05:00.000Z')
  await leaseRegistry.admit(makeRequest(store, {
    lease_id: 'lease:compact-e', owner_session: 'session:compact-e', provider_session_id: 'provider:compact-e',
    execution_context_id: 'context:compact-e', worktree_id: 'worktree:compact-e', branch: 'codex/compact-e',
    resource_keys: ['path:src/compact-e.mjs'], nonce: NONCE('compact-e-admit'),
  }))
  record = (await leaseRegistry.inspect()).record
  assert.deepEqual(Object.keys(record.used_owner_end_attestations).sort(), ['attestation:compact-a', 'attestation:compact-b'])
  clock.set('2026-09-06T00:00:00.000Z')
  await leaseRegistry.admit(makeRequest(store, {
    lease_id: 'lease:compact-f', owner_session: 'session:compact-f', provider_session_id: 'provider:compact-f',
    execution_context_id: 'context:compact-f', worktree_id: 'worktree:compact-f', branch: 'codex/compact-f',
    resource_keys: ['path:src/compact-f.mjs'], nonce: NONCE('compact-f-admit'),
  }))
  record = (await leaseRegistry.inspect()).record
  assert.deepEqual(Object.keys(record.used_owner_end_attestations), [])
  assert.deepEqual(Object.keys(record.retained_resources).sort(), ['lease:compact-a'])
  // The local admission projection sees the compacted holder exactly as the registry does.
  const admissionRequest = (overrides) => ({
    schema_version: 'admission-request/v1', lease_kind: 'writer_seat', plan_id: 'plan:one', generation: 1, task_id: 'task:projection',
    provider: 'codex', owner_session: 'session:projection', provider_session_id: 'provider:projection', execution_context_id: 'context:projection',
    repo_identity_digest: SHA256, common_dir_digest: store.commonDirDigest, worktree_id: 'worktree:projection', worktree_path_digest: 'd'.repeat(64),
    branch: 'codex/projection', baseline_sha: SHA1, head_sha: 'b'.repeat(40), base_ref: 'origin/main', base_sha: SHA1, expected_remote_sha: SHA1,
    action: 'admit', runtime_kind: null, ...overrides,
  })
  const overlapScope = [{ kind: 'path', path: 'src/compact-a.mjs' }]
  const projected = evaluateAdmission(record, admissionRequest({
    lease_id: 'lease:projection', scope: overlapScope, scope_digest: digestCanonical(overlapScope.map((resource) => ({ kind: resource.kind, path: resource.path }))),
  }))
  assert.deepEqual({ status: projected.status, reason: projected.reason }, { status: 'QUEUED_FOR_LEASE', reason: 'RESOURCE_CONFLICT' }, JSON.stringify(projected))
  // The pruned attestation cannot be replayed: it is expired for the validator regardless of the ledger.
  const late = await leaseRegistry.admit(makeRequest(store, {
    lease_id: 'lease:compact-g', owner_session: 'session:compact-b', provider_session_id: 'provider:compact-b',
    execution_context_id: 'context:compact-b', worktree_id: 'worktree:compact-g', branch: 'codex/compact-g',
    resource_keys: ['path:src/compact-g.mjs'], nonce: NONCE('compact-g-admit'),
  }))
  const lateEnd = await leaseRegistry.endRequest({
    lease_id: 'lease:compact-g', expected_oid: late.oid, nonce: NONCE('compact-g-end'), reason: 'failed',
    handoff_or_candidate_reference: 'handoff:compact-g', owner_end_attestation: endAttestation(late.lease, {
      observed_at: '2026-09-06T00:00:00.000Z', expires_at: '2026-09-06T00:10:00.000Z',
    }),
  })
  await assert.rejects(
    leaseRegistry.release({
      lease_id: 'lease:compact-g', expected_oid: lateEnd.oid, expected_envelope_oid: ENVELOPE_OID, expected_envelope_transition_sequence: 0,
      attestation: { ...attestationB, lease_id: 'lease:compact-g', scope_digest: late.lease.scope_digest },
    }),
    (error) => error?.code === 'owner_end_attestation_expired',
  )
})

test('P1 regression — a fan-in of predecessors needs an attested integrated parent, a single predecessor its exact handoff head', async () => {
  const build = (integratedParentAuthority = undefined) => {
    const git = createInMemoryGit()
    git.blobs.set(SEEDED_PLAN_OID, SEEDED_PLAN_BLOB)
    git.refs.set('refs/ai-bim/delivery-plans', SEEDED_PLAN_OID)
    const clock = createClock()
    const store = createGitCasStore({ git, commonDir: 'C:/fake/common-dir' })
    const envelope = createSequencedEnvelopePort()
    const leaseRegistry = createLeaseRegistry({
      store, clock, writerCap: 2, ownerEndAttestor: createTrustedAttestor(), executionEnvelope: envelope, integratedParentAuthority,
    })
    return { git, clock, store, envelope, leaseRegistry }
  }
  const seed = async (fixture) => {
    await handOff(fixture, 'lease:dep-a', { task_id: 'task:dep-a', resource_keys: ['path:src/dep-a.mjs'], head_sha: 'a'.repeat(40) }, 'dep-a')
    await handOff(fixture, 'lease:dep-b', {
      task_id: 'task:dep-b', owner_session: 'session:dep-b', provider_session_id: 'provider:dep-b', execution_context_id: 'context:dep-b',
      worktree_id: 'worktree:dep-b', branch: 'codex/dep-b', resource_keys: ['path:src/dep-b.mjs'], head_sha: 'b'.repeat(40),
    }, 'dep-b')
  }
  const unattested = build()
  await seed(unattested)
  // A single predecessor: the parent must be that predecessor's handoff head, not the plan baseline.
  assert.equal((await unattested.leaseRegistry.validateDependencies({
    plan_id: 'plan:one', generation: 1, task_id: 'task:child', dependency_task_ids: ['task:dep-b'], expected_parent_sha: 'b'.repeat(40),
  })).status, 'READY')
  assert.equal((await unattested.leaseRegistry.validateDependencies({
    plan_id: 'plan:one', generation: 1, task_id: 'task:child', dependency_task_ids: ['task:dep-b'], expected_parent_sha: 'a'.repeat(40),
  })).reason, 'DEPENDENCY_PARENT_SHA_MISMATCH')
  // Fan-in without an integrated-parent authority is held, never guessed.
  const fanIn = { plan_id: 'plan:one', generation: 1, task_id: 'task:child', dependency_task_ids: ['task:dep-a', 'task:dep-b'], expected_parent_sha: 'c'.repeat(40) }
  assert.deepEqual(await unattested.leaseRegistry.validateDependencies(fanIn), { status: 'HELD_EXECUTION_AUTHORITY', reason: 'DEPENDENCY_INTEGRATION_PARENT_UNATTESTED' })
  const requests = []
  const attested = build({
    verify: async (request) => {
      requests.push(request)
      return request.integrated_parent_sha === 'c'.repeat(40) && Object.keys(request.dependency_heads).length === 2
    },
  })
  await seed(attested)
  assert.equal((await attested.leaseRegistry.validateDependencies(fanIn)).status, 'READY')
  assert.deepEqual(requests[0].dependency_heads, { 'task:dep-a': ['a'.repeat(40)], 'task:dep-b': ['b'.repeat(40)] })
  assert.equal((await attested.leaseRegistry.validateDependencies({ ...fanIn, expected_parent_sha: 'd'.repeat(40) })).reason, 'DEPENDENCY_INTEGRATION_PARENT_UNATTESTED')
  const throwing = build({ verify: async () => { throw new Error('authority offline') } })
  await seed(throwing)
  assert.equal((await throwing.leaseRegistry.validateDependencies(fanIn)).reason, 'DEPENDENCY_INTEGRATION_PARENT_UNATTESTED')
})

test('P2 regression — retained-resource stubs leave the registry only through an owner-attested release', async () => {
  const git = createInMemoryGit()
  git.blobs.set(SEEDED_PLAN_OID, SEEDED_PLAN_BLOB)
  git.refs.set('refs/ai-bim/delivery-plans', SEEDED_PLAN_OID)
  const clock = createClock()
  const store = createGitCasStore({ git, commonDir: 'C:/fake/common-dir' })
  const envelope = createSequencedEnvelopePort()
  const attestor = createTrustedAttestor()
  const leaseRegistry = createLeaseRegistry({
    store, clock, writerCap: 2, ownerEndAttestor: attestor, executionEnvelope: envelope, retainedReleasedLeases: 1,
  })
  const fixture = { leaseRegistry, store, envelope, clock }
  await handOff(fixture, 'lease:archive-a', { resource_keys: ['path:src/archive-a.mjs'] }, 'archive-a')
  clock.set('2026-08-29T00:01:00.000Z')
  await handOff(fixture, 'lease:archive-b', {
    owner_session: 'session:archive-b', provider_session_id: 'provider:archive-b', execution_context_id: 'context:archive-b',
    worktree_id: 'worktree:archive-b', branch: 'codex/archive-b', resource_keys: ['path:src/archive-b.mjs'],
  }, 'archive-b')
  let inspected = await leaseRegistry.inspect()
  assert.deepEqual(Object.keys(inspected.record.retained_resources), ['lease:archive-a'])
  const blocked = await leaseRegistry.admit(makeRequest(store, {
    lease_id: 'lease:archive-c', owner_session: 'session:archive-c', provider_session_id: 'provider:archive-c',
    execution_context_id: 'context:archive-c', worktree_id: 'worktree:archive-c', branch: 'codex/archive-c',
    resource_keys: ['path:src/archive-a.mjs'], nonce: NONCE('archive-c-admit'),
  }))
  assert.equal(blocked.reason, 'RESOURCE_CONFLICT')
  const attestation = (overrides = {}) => ({
    attestation_ref: 'attestation:retention-release', attestation_digest: SHA256, issuer_id: 'attestor:plan-owner', issuer_version: 'plan-owner/v1',
    action: 'release_retained_resources', lease_set_digest: digestCanonical(['lease:archive-a']), expected_oid: inspected.oid,
    nonce: NONCE('retention-release'), observed_at: '2026-08-29T00:00:00.000Z', expires_at: '2026-08-29T00:10:00.000Z', revocation_epoch: 0,
    ...overrides,
  })
  // No attestation, a mismatched lease set, or an untrusted attestation never removes retained truth.
  await assert.rejects(leaseRegistry.releaseRetainedResources({ lease_ids: ['lease:archive-a'], expected_oid: inspected.oid, nonce: NONCE('retention-release') }),
    (error) => error?.code === 'invalid_shape')
  await assert.rejects(leaseRegistry.releaseRetainedResources({
    lease_ids: ['lease:archive-a'], expected_oid: inspected.oid, nonce: NONCE('retention-release'),
    owner_attestation: attestation({ lease_set_digest: digestCanonical(['lease:archive-b']) }),
  }), (error) => error?.detail === 'retained_resource_release_request_attestation_tuple_mismatch')
  const untrusted = await leaseRegistry.releaseRetainedResources({
    lease_ids: ['lease:archive-a'], expected_oid: inspected.oid, nonce: NONCE('retention-release'),
    owner_attestation: { ...attestation(), force: 'unknown' },
  }).catch((error) => ({ status: 'REJECTED', reason: error?.code }))
  assert.notEqual(untrusted.status, 'RETENTION_RELEASED')
  const unknown = await leaseRegistry.releaseRetainedResources({
    lease_ids: ['lease:archive-zzz'], expected_oid: inspected.oid, nonce: NONCE('retention-release'),
    owner_attestation: attestation({ lease_set_digest: digestCanonical(['lease:archive-zzz']) }),
  })
  assert.equal(unknown.reason, 'RETAINED_RESOURCE_UNKNOWN')
  const released = await leaseRegistry.releaseRetainedResources({
    lease_ids: ['lease:archive-a'], expected_oid: inspected.oid, nonce: NONCE('retention-release'), owner_attestation: attestation(),
  })
  assert.equal(released.status, 'RETENTION_RELEASED', JSON.stringify(released))
  inspected = await leaseRegistry.inspect()
  assert.deepEqual(Object.keys(inspected.record.retained_resources), [])
  assert.equal(inspected.record.leases['lease:archive-b'].state, 'RELEASED')
  const recentNonce = NONCE('retention-release-recent')
  const recent = await leaseRegistry.releaseRetainedResources({
    lease_ids: ['lease:archive-b'], expected_oid: inspected.oid, nonce: recentNonce,
    owner_attestation: attestation({
      attestation_ref: 'attestation:retention-release-recent',
      lease_set_digest: digestCanonical(['lease:archive-b']), expected_oid: inspected.oid, nonce: recentNonce,
    }),
  })
  assert.equal(recent.status, 'RETENTION_RELEASED', JSON.stringify(recent))
  inspected = await leaseRegistry.inspect()
  assert.equal(Object.hasOwn(inspected.record.leases, 'lease:archive-b'), false)
  const admitted = await leaseRegistry.admit(makeRequest(store, {
    lease_id: 'lease:archive-c', owner_session: 'session:archive-c', provider_session_id: 'provider:archive-c',
    execution_context_id: 'context:archive-c', worktree_id: 'worktree:archive-c', branch: 'codex/archive-c',
    resource_keys: ['path:src/archive-a.mjs'], nonce: NONCE('archive-c-admit-2'),
  }))
  assert.equal(admitted.status, 'ADMITTED', JSON.stringify(admitted))
})
