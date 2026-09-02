import assert from 'node:assert/strict'
import test from 'node:test'

import { createParallelDeliveryFabric } from '../../lib/parallel-delivery-fabric.mjs'
import { digestCanonical } from '../../lib/parallel-delivery-fabric-contract.mjs'

const MAX_SNAPSHOT_BYTES = 256 * 1024
const MAX_SNAPSHOT_NODES = 4096
const MAX_ARRAY_LENGTH = 128

const freezeDeep = (value) => {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) freezeDeep(nested)
    Object.freeze(value)
  }
  return value
}

const snapshotBytes = (value) => {
  if (typeof value === 'string') return Buffer.byteLength(value, 'utf8')
  if (value === null || typeof value !== 'object') return 0
  return Reflect.ownKeys(value).reduce((total, key) => total + Buffer.byteLength(key, 'utf8') + snapshotBytes(value[key]), 0)
}

const snapshotNodes = (value) => {
  if (value === null || typeof value !== 'object') return 1
  return 1 + Reflect.ownKeys(value).filter((key) => key !== 'length').reduce((total, key) => total + snapshotNodes(value[key]), 0)
}

// Builds a tree of exactly `nodes` aggregate nodes within the dense array width
// and the depth budget by spreading the remainder across children.
const nodeTree = (nodes) => {
  if (nodes === 1) return 'x'
  const childCount = Math.min(MAX_ARRAY_LENGTH - 1, nodes - 1)
  let remaining = nodes - 1 - childCount
  return Array.from({ length: childCount }, () => {
    const extra = Math.min(remaining, MAX_ARRAY_LENGTH - 1)
    remaining -= extra
    return nodeTree(1 + extra)
  })
}

const noCalls = () => ({ admit: 0, advance: 0, commit: 0, drainPlan: 0, inspectLeases: 0, inspectPlan: 0, journalRead: 0, journalReserve: 0, planSubmit: 0, preflight: 0, projection: 0, reconcile: 0, release: 0, validateActive: 0, validateDependencies: 0, validatePlan: 0 })
const stableJournalKey = (commandId) => `journal:${digestCanonical({ command_id: commandId })}`
const canonicalAttemptId = 'attempt:123e4567-e89b-42d3-a456-426614174000'

const closedSubmitOutcome = (command) => Object.freeze({
  command_id: command.command_id,
  type: 'submit',
  status: 'SHADOW_STORED',
  reason: 'PLAN_STORED',
})

const committedJournalReceipt = (command, overrides = {}) => {
  const commandDigest = digestCanonical(command)
  const outcome = closedSubmitOutcome(command)
  return Object.freeze({
    journal_key: stableJournalKey(command.command_id),
    command_id: command.command_id,
    command_digest: commandDigest,
    attempt_id: canonicalAttemptId,
    reservation_id: `reservation:${digestCanonical({ command_id: command.command_id, command_digest: commandDigest, attempt_id: canonicalAttemptId })}`,
    status: 'COMMITTED',
    outcome_digest: digestCanonical(outcome),
    outcome,
    ...overrides,
  })
}

const reservedJournalReceipt = (command, overrides = {}) => {
  const commandDigest = digestCanonical(command)
  return Object.freeze({
    journal_key: stableJournalKey(command.command_id),
    command_id: command.command_id,
    command_digest: commandDigest,
    attempt_id: canonicalAttemptId,
    reservation_id: `reservation:${digestCanonical({ command_id: command.command_id, command_digest: commandDigest, attempt_id: canonicalAttemptId })}`,
    status: 'RESERVED',
    acquired: true,
    ...overrides,
  })
}

const assertPersistedReceiptHeld = async (label, persisted, expectedReason = 'COMMAND_RECEIPT_INVALID') => {
  const fixture = createPorts()
  const command = freezeDeep(submitCommand({ command_id: `command:receipt-${label}` }))
  fixture.ports.commandJournal.read = async () => {
    fixture.calls.journalRead += 1
    return persisted(command)
  }
  const result = await createParallelDeliveryFabric(fixture.ports).dispatch(command)
  assert.deepEqual(result, { command_id: command.command_id, type: 'submit', status: 'HELD', reason: expectedReason }, label)
  assert.equal(fixture.calls.journalRead, 1, label)
  assert.equal(fixture.calls.journalReserve, 0, label)
  assert.equal(fixture.calls.planSubmit, 0, label)
  assert.equal(fixture.calls.commit, 0, label)
}

const createPorts = () => {
  const calls = noCalls()
  const receipts = new Map()
  const journalRequests = { commit: [], read: [], reserve: [] }
  const ports = {
    commandJournal: {
      read: async (request) => {
        calls.journalRead += 1
        journalRequests.read.push(structuredClone(request))
        return receipts.get(request.journal_key ?? request.command_id) ?? null
      },
      reserve: async (request) => {
        calls.journalReserve += 1
        journalRequests.reserve.push(structuredClone(request))
        const { command_id, command_digest, attempt_id, reservation_id } = request
        const key = request.journal_key ?? command_id
        const existing = receipts.get(key)
        if (existing) return existing
        const receipt = { ...(request.journal_key === undefined ? {} : { journal_key: request.journal_key }), command_id, command_digest, attempt_id, reservation_id, status: 'RESERVED', acquired: true }
        receipts.set(key, receipt)
        return receipt
      },
      commit: async (request) => {
        calls.commit += 1
        journalRequests.commit.push(structuredClone(request))
        const { command_id, command_digest, attempt_id, reservation_id, outcome_digest, outcome } = request
        const receipt = JSON.parse(JSON.stringify({ ...(request.journal_key === undefined ? {} : { journal_key: request.journal_key }), command_id, command_digest, attempt_id, reservation_id, outcome_digest, status: 'COMMITTED', outcome }))
        receipts.set(request.journal_key ?? command_id, receipt)
        return receipt
      },
    },
    planRegistry: {
      submit: async ({ plan }) => { calls.planSubmit += 1; return { status: 'STORED', plan_id: plan.plan_id } },
      validateGeneration: async ({ plan_id, generation, task_id }) => {
        calls.validatePlan += 1
        const active = { status: 'ACTIVE', plan_id, generation, oid: 'f'.repeat(40) }
        return task_id === undefined ? active : {
          ...active,
          task: {
            task_id: 'task:one', owner_session: 'session:owner-one', provider: 'codex',
            baseline_sha: 'a'.repeat(40), scope_digest: ADVANCE_SCOPE_DIGEST, dependencies: [],
          },
        }
      },
      inspect: async () => { calls.inspectPlan += 1; return { oid: '0'.repeat(40), record: null } },
    },
    leaseRegistry: {
      admit: async ({ lease_id }) => { calls.admit += 1; return { status: 'ADMITTED', lease_id } },
      validateActive: async ({ lease_id }) => { calls.validateActive += 1; return { status: 'ACTIVE', lease_id } },
      validateDependencies: async ({ plan_id, generation, task_id, dependency_task_ids, expected_parent_sha }) => {
        calls.validateDependencies += 1
        return { status: 'READY', plan_id, generation, task_id, expected_parent_sha, dependency_count: dependency_task_ids.length }
      },
      reconcileTimeout: async ({ lease_id }) => { calls.reconcile += 1; return { status: 'ACTIVE', lease_id } },
      drainPlan: async ({ plan_id }) => { calls.drainPlan += 1; return { status: 'DRAINING', plan_id } },
      release: async () => { calls.release += 1; return { status: 'RELEASED', oid: 'b'.repeat(40), lease: { lease_id: 'lease:one', state: 'RELEASED', retention_state: 'RETAINED_FOR_REVIEW', release_record: { owner_end_attestation_ref: 'attestation:owner-end-one', owner_end_attestation_digest: 'c'.repeat(64) } } } },
      inspect: async () => { calls.inspectLeases += 1; return { oid: '0'.repeat(40), record: null } },
    },
    execution: {
      advance: (_envelope, advance) => { calls.advance += 1; return { status: 'SHADOW_INTENT', next_level: advance.next_level } },
    },
    providerAdapters: {
      codex: { preflight: () => { calls.preflight += 1; return { status: 'READY_FOR_SHADOW', provider: 'codex' } } },
      claude: { preflight: () => { calls.preflight += 1; return { status: 'READY_FOR_SHADOW', provider: 'claude' } } },
    },
    projection: {
      reconcile: async ({ reconciliation }) => { calls.projection += 1; return { status: 'PROJECTION_READY', lease_id: reconciliation.lease_id } },
    },
  }
  return { ports, calls, journalRequests, receipts }
}

const submitCommand = (overrides = {}) => ({
  type: 'submit', command_id: 'command:submit-one', plan: { plan_id: 'plan:one' }, expected_oid: 'a'.repeat(40), nonce: 'nonce-submit-one',
  execution: { level: 'plan_only', side_effect_class: 'CONTROL_METADATA' }, effects: { filesystem: 0, git: 0, network: 0, process: 0, provider: 0, github: 0, deploy: 0, cleanup: 0, promotion: 0 }, ...overrides,
})

const ADVANCE_RESOURCE_KEYS = Object.freeze(['path:scripts/fabric.mjs'])
const ADVANCE_SCOPE_DIGEST = digestCanonical([{ kind: 'path', path: 'scripts/fabric.mjs' }])
const advanceTuple = Object.freeze({
  plan_id: 'plan:one', generation: 1, task_id: 'task:one', owner_session: 'session:owner-one', provider: 'codex',
  provider_session_id: 'provider:one', execution_context_id: 'context:one', repo_identity_digest: 'a'.repeat(64),
  common_dir_digest: 'b'.repeat(64), worktree_id: 'worktree:one', worktree_path_digest: 'c'.repeat(64),
  branch: 'codex/fabric-one', baseline_sha: 'a'.repeat(40), head_sha: 'b'.repeat(40), scope_digest: ADVANCE_SCOPE_DIGEST,
  lease_id: 'lease:one',
})

const advanceCommand = (overrides = {}) => {
  const base = {
    type: 'advance', command_id: 'command:advance-one',
    envelope: { ...advanceTuple, current_level: 'plan_only' },
    advance_command: { next_level: 'implement_local', next_envelope: { ...advanceTuple, current_level: 'implement_local' } },
    admission: {
      ...advanceTuple, context_attestation_ref: 'attestation:one', resource_keys: [...ADVANCE_RESOURCE_KEYS], nonce: 'n'.repeat(32),
    },
    provider_request: {
      command: 'shadow-status',
      execution_context: { expected: { ...advanceTuple }, attestation: { attestation_ref: 'attestation:one' } },
    },
  }
  return {
    ...base,
    ...overrides,
    envelope: { ...base.envelope, ...(overrides.envelope ?? {}) },
    advance_command: {
      ...base.advance_command,
      ...(overrides.advance_command ?? {}),
      next_envelope: {
        ...base.advance_command.next_envelope,
        current_level: overrides.advance_command?.next_level ?? base.advance_command.next_level,
        ...(overrides.advance_command?.next_envelope ?? {}),
      },
    },
    admission: { ...base.admission, ...(overrides.admission ?? {}) },
    provider_request: {
      ...base.provider_request,
      ...(overrides.provider_request ?? {}),
      execution_context: {
        ...base.provider_request.execution_context,
        ...(overrides.provider_request?.execution_context ?? {}),
      },
    },
  }
}

const reconcileCommand = (overrides = {}) => ({
  type: 'reconcile', command_id: 'command:reconcile-one',
  reconcile_request: { lease_id: 'lease:one', expected_oid: 'a'.repeat(40), timeout_ms: 30000, nonce: 'nonce-reconcile-one' }, ...overrides,
})

const drainCommand = (overrides = {}) => ({
  type: 'drain', command_id: 'command:drain-one',
  drain_request: { plan_id: 'plan:one', generation: 1, expected_oid: 'a'.repeat(40), nonce: 'n'.repeat(32), reason: 'handoff' }, ...overrides,
})

const releaseCommand = (overrides = {}) => ({
  type: 'release', command_id: 'command:release-one', release_request: { lease_id: 'lease:one', expected_oid: 'a'.repeat(40), expected_envelope_oid: 'b'.repeat(40), expected_envelope_transition_sequence: 0, attestation: { attestation_ref: 'attestation:owner-end-one', attestation_digest: 'c'.repeat(64), issuer_id: 'attestor:owner-end', issuer_version: 'owner-end/v1', owner_session: 'session:owner-one', provider: 'codex', provider_session_id: 'provider:one', execution_context_id: 'context:one', lease_id: 'lease:one', generation: 1, head_sha: 'd'.repeat(40), scope_digest: 'e'.repeat(64), worktree_path_digest: 'f'.repeat(64), observed_at: '2026-08-29T00:00:00.000Z', expires_at: '2026-08-29T00:10:00.000Z', nonce: 'a'.repeat(32), revocation_epoch: 0 } }, ...overrides,
})

test('Task10A exposes only dispatch and inspect', async () => {
  const { ports } = createPorts()
  const fabric = createParallelDeliveryFabric(ports)

  assert.deepEqual(Object.keys(fabric).sort(), ['dispatch', 'inspect'])
  assert.equal(typeof fabric.dispatch, 'function')
  assert.equal(typeof fabric.inspect, 'function')
  assert.equal(Object.isFrozen(fabric), true)
})

test('unknown and secret-shaped commands fail closed before every downstream port', async () => {
  const { ports, calls } = createPorts()
  const fabric = createParallelDeliveryFabric(ports)

  const unknown = await fabric.dispatch({ type: 'merge', command_id: 'command:unknown' })
  const secret = await fabric.dispatch(submitCommand({ token: 'redacted' }))

  assert.deepEqual(unknown, { command_id: 'command:unknown', type: 'merge', status: 'HELD', reason: 'COMMAND_TYPE_INVALID' })
  assert.deepEqual(secret, { command_id: undefined, type: undefined, status: 'HELD', reason: 'COMMAND_INPUT_UNSAFE' })
  assert.deepEqual(calls, noCalls())
})

const assertSnapshotInputAccepted = async (command, label) => {
  const fixture = createPorts()
  const before = digestCanonical(command)
  const result = await createParallelDeliveryFabric(fixture.ports).dispatch(command)
  assert.equal(Object.isFrozen(command), true, label)
  assert.equal(digestCanonical(command), before, label)
  assert.deepEqual(result, { command_id: command.command_id, type: 'submit', status: 'SHADOW_STORED', reason: 'PLAN_STORED' }, label)
  assert.equal(fixture.calls.planSubmit, 1, label)
}

const assertSnapshotInputRejected = async (command, label) => {
  const fixture = createPorts()
  const before = digestCanonical(command)
  const result = await createParallelDeliveryFabric(fixture.ports).dispatch(command)
  assert.equal(Object.isFrozen(command), true, label)
  assert.equal(digestCanonical(command), before, label)
  assert.deepEqual(result, { command_id: undefined, type: undefined, status: 'HELD', reason: 'COMMAND_INPUT_UNSAFE' }, label)
  assert.deepEqual(fixture.calls, noCalls(), label)
}

test('core snapshot accepts exactly 256 KiB of user string and logical-key data', async () => {
  const commandId = 'command:budget-bytes-ok'
  const base = snapshotBytes(submitCommand({ command_id: commandId, nonce: '' }))
  const command = freezeDeep(submitCommand({ command_id: commandId, nonce: 'x'.repeat(MAX_SNAPSHOT_BYTES - base) }))
  assert.equal(snapshotBytes(command), MAX_SNAPSHOT_BYTES)
  await assertSnapshotInputAccepted(command, 'aggregate UTF-8 at 256 KiB')
})

test('core snapshot rejects 256 KiB plus one before journal and semantic ports', async () => {
  const commandId = 'command:budget-bytes-over'
  const base = snapshotBytes(submitCommand({ command_id: commandId, nonce: '' }))
  const command = freezeDeep(submitCommand({ command_id: commandId, nonce: 'x'.repeat(MAX_SNAPSHOT_BYTES - base + 1) }))
  assert.equal(snapshotBytes(command), MAX_SNAPSHOT_BYTES + 1)
  await assertSnapshotInputRejected(command, 'aggregate UTF-8 over 256 KiB')
})

test('core snapshot accepts exactly the aggregate node budget', async () => {
  const commandId = 'command:budget-nodes-ok'
  const base = snapshotNodes(submitCommand({ command_id: commandId }))
  const command = freezeDeep(submitCommand({ command_id: commandId, plan: { plan_id: 'plan:one', payload: nodeTree(MAX_SNAPSHOT_NODES - base) } }))
  assert.equal(snapshotNodes(command), MAX_SNAPSHOT_NODES)
  await assertSnapshotInputAccepted(command, 'total nodes at budget')
})

test('core snapshot rejects the aggregate node budget plus one before journal and semantic ports', async () => {
  const commandId = 'command:budget-nodes-over'
  const base = snapshotNodes(submitCommand({ command_id: commandId }))
  const command = freezeDeep(submitCommand({ command_id: commandId, plan: { plan_id: 'plan:one', payload: nodeTree(MAX_SNAPSHOT_NODES - base + 1) } }))
  assert.equal(snapshotNodes(command), MAX_SNAPSHOT_NODES + 1)
  await assertSnapshotInputRejected(command, 'total nodes over budget')
})

test('core snapshot accepts a dense array with exactly 128 elements', async () => {
  const command = freezeDeep(submitCommand({ command_id: 'command:budget-array-ok', plan: { plan_id: 'plan:one', payload: Array.from({ length: MAX_ARRAY_LENGTH }, () => 'x') } }))
  assert.equal(command.plan.payload.length, MAX_ARRAY_LENGTH)
  await assertSnapshotInputAccepted(command, 'array length at 128')
})

test('core snapshot rejects a dense array with 129 elements before journal and semantic ports', async () => {
  const command = freezeDeep(submitCommand({ command_id: 'command:budget-array-over', plan: { plan_id: 'plan:one', payload: Array.from({ length: MAX_ARRAY_LENGTH + 1 }, () => 'x') } }))
  assert.equal(command.plan.payload.length, MAX_ARRAY_LENGTH + 1)
  await assertSnapshotInputRejected(command, 'array length over 128')
})

test('core snapshot rejects transparent Proxies before their traps or downstream ports run', async () => {
  const fixture = createPorts()
  let traps = 0
  const command = new Proxy(submitCommand({ command_id: 'command:transparent-proxy' }), {
    get: (...args) => { traps += 1; return Reflect.get(...args) },
    getOwnPropertyDescriptor: (...args) => { traps += 1; return Reflect.getOwnPropertyDescriptor(...args) },
    getPrototypeOf: (...args) => { traps += 1; return Reflect.getPrototypeOf(...args) },
    ownKeys: (...args) => { traps += 1; return Reflect.ownKeys(...args) },
  })
  const result = await createParallelDeliveryFabric(fixture.ports).dispatch(command)
  assert.deepEqual(result, { command_id: undefined, type: undefined, status: 'HELD', reason: 'COMMAND_INPUT_UNSAFE' })
  assert.equal(traps, 0)
  assert.deepEqual(fixture.calls, noCalls())
})

const assertOversizedPortResultContained = async (label, portResult) => {
  const fixture = createPorts()
  fixture.ports.execution.advance = () => { fixture.calls.advance += 1; return freezeDeep(portResult) }
  const result = await createParallelDeliveryFabric(fixture.ports).dispatch(freezeDeep(advanceCommand({ command_id: `command:port-${label.replace(/[^a-z]+/giu, '-')}` })))
  assert.deepEqual(result, { command_id: result.command_id, type: 'advance', status: 'HELD', reason: 'EXECUTION_VALIDATION_UNAVAILABLE' }, label)
  assert.equal(fixture.calls.advance, 1, label)
  assert.equal(fixture.calls.admit, 0, label)
  assert.equal(fixture.calls.preflight, 0, label)
}

test('core snapshot contains an oversized byte port result before later semantic ports', async () => {
  await assertOversizedPortResultContained('aggregate UTF-8 over 256 KiB', { status: 'SHADOW_INTENT', next_level: 'implement_local', payload: 'x'.repeat(MAX_SNAPSHOT_BYTES + 1) })
})

test('core snapshot contains an oversized node port result before later semantic ports', async () => {
  await assertOversizedPortResultContained('total nodes over 512', { status: 'SHADOW_INTENT', next_level: 'implement_local', payload: nodeTree(MAX_SNAPSHOT_NODES + 1) })
})

test('core snapshot contains an oversized array port result before later semantic ports', async () => {
  await assertOversizedPortResultContained('array length over 128', { status: 'SHADOW_INTENT', next_level: 'implement_local', payload: Array.from({ length: MAX_ARRAY_LENGTH + 1 }, () => 'x') })
})

test('RED security: accessors, invalid levels, arbitrary effects, and hostile port config stop before semantic or effect ports', async () => {
  const accessorFixture = createPorts()
  let reads = 0
  const accessorCommand = {}
  Object.defineProperties(accessorCommand, {
    type: { enumerable: true, get: () => { reads += 1; return 'submit' } },
    command_id: { enumerable: true, get: () => { reads += 1; return 'command:accessor' } },
  })
  const accessor = await createParallelDeliveryFabric(accessorFixture.ports).dispatch(accessorCommand)

  const levelFixture = createPorts()
  const level = await createParallelDeliveryFabric(levelFixture.ports).dispatch(advanceCommand({ advance_command: { next_level: 'deploy_production' } }))

  const effectsFixture = createPorts()
  const effects = await createParallelDeliveryFabric(effectsFixture.ports).dispatch(submitCommand({ command_id: 'command:arbitrary-effects', effects: { arbitrary: 0 } }))

  const hostilePorts = createPorts()
  hostilePorts.ports.fs = { writeFile: () => { throw new Error('must not run') } }
  const config = await createParallelDeliveryFabric(hostilePorts.ports).dispatch(advanceCommand({ command_id: 'command:hostile-config' }))

  assert.equal(reads, 0)
  assert.equal(accessor.status, 'HELD')
  assert.equal(level.status, 'HELD')
  assert.equal(levelFixture.calls.advance, 0)
  assert.equal(effects.status, 'HELD')
  assert.equal(effectsFixture.calls.planSubmit, 0)
  assert.equal(config.status, 'HELD')
  assert.equal(hostilePorts.calls.advance, 0)
})

test('RED security: journal replay and reconcile results require closed validated protocols', async () => {
  const command = submitCommand({ command_id: 'command:forged-replay' })
  const replayFixture = createPorts()
  replayFixture.ports.commandJournal.read = async () => ({
    command_digest: digestCanonical(command), status: 'COMMITTED',
    outcome: Object.freeze({ command_id: command.command_id, type: 'submit', status: 'MERGED', reason: 'forged' }),
  })
  const replay = await createParallelDeliveryFabric(replayFixture.ports).dispatch(command)

  const reconcileFixture = createPorts()
  reconcileFixture.ports.leaseRegistry.reconcileTimeout = async () => ({ status: 'UNKNOWN_RECONCILE_STATE' })
  const reconcile = await createParallelDeliveryFabric(reconcileFixture.ports).dispatch(reconcileCommand())

  assert.equal(replay.status, 'HELD')
  assert.equal(replayFixture.calls.planSubmit, 0)
  assert.equal(reconcile.status, 'HELD')
  assert.equal(reconcileFixture.calls.projection, 0)
})

test('RED release: short, partial, and self-issued requests never call the lease port', async () => {
  const fixture = createPorts()
  const fabric = createParallelDeliveryFabric(fixture.ports)
  const short = await fabric.dispatch({ type: 'release', command_id: 'command:release-short', release_request: { lease_id: 'lease:one' } })
  const partial = await fabric.dispatch(releaseCommand({ command_id: 'command:release-partial', release_request: { lease_id: 'lease:one', expected_oid: 'a'.repeat(40) } }))
  const selfIssued = await fabric.dispatch(releaseCommand({ command_id: 'command:release-self', release_request: { ...releaseCommand().release_request, attestation: { ...releaseCommand().release_request.attestation, issuer_id: 'session:owner-one' } } }))
  assert.equal(short.status, 'HELD')
  assert.equal(partial.status, 'HELD')
  assert.equal(selfIssued.status, 'HELD')
  assert.equal(fixture.calls.release, 0)
})

test('AC-13 — legal plan_only writes only control metadata while every other effect remains zero', async () => {
  const { ports, calls } = createPorts()
  const fabric = createParallelDeliveryFabric(ports)

  const first = await fabric.dispatch(submitCommand())
  const replay = await fabric.dispatch(submitCommand())
  const mismatch = await fabric.dispatch(submitCommand({ plan: { plan_id: 'plan:two' } }))
  const nonMetadataFixture = createPorts()
  const nonMetadata = await createParallelDeliveryFabric(nonMetadataFixture.ports).dispatch(submitCommand({ command_id: 'command:submit-nonmetadata', execution: { level: 'implement_local', side_effect_class: 'CANDIDATE_FILESYSTEM' } }))
  const extraEffectFixture = createPorts()
  const extraEffect = await createParallelDeliveryFabric(extraEffectFixture.ports).dispatch(submitCommand({
    command_id: 'command:submit-extra-effect',
    effects: { filesystem: 0, git: 0, network: 1, process: 0, provider: 0, github: 0, deploy: 0, cleanup: 0, promotion: 0 },
  }))

  assert.deepEqual(first, { command_id: 'command:submit-one', type: 'submit', status: 'SHADOW_STORED', reason: 'PLAN_STORED' })
  assert.deepEqual(replay, first)
  assert.notEqual(replay, first)
  assert.equal(Object.isFrozen(replay), true)
  assert.deepEqual(mismatch, { command_id: 'command:submit-one', type: 'submit', status: 'HELD', reason: 'COMMAND_ID_REUSE' })
  assert.deepEqual(nonMetadata, { command_id: 'command:submit-nonmetadata', type: 'submit', status: 'HELD', reason: 'PLAN_ONLY_REQUIRED' })
  assert.deepEqual(extraEffect, { command_id: 'command:submit-extra-effect', type: 'submit', status: 'HELD', reason: 'PLAN_ONLY_REQUIRED' })
  assert.equal(calls.planSubmit, 1)
  assert.equal(calls.commit, 1)
  assert.deepEqual(calls, { ...noCalls(), commit: 1, journalRead: 3, journalReserve: 1, planSubmit: 1 })
  for (const fixture of [nonMetadataFixture, extraEffectFixture]) {
    assert.deepEqual(fixture.calls, noCalls())
  }
})

test('RED race: same command coalesces and conflicting reuse never reaches plan submit', async () => {
  const fixture = createPorts()
  let releaseFirst
  fixture.ports.planRegistry.submit = async () => {
    fixture.calls.planSubmit += 1
    await new Promise((resolve) => { releaseFirst = resolve })
    return { status: 'STORED' }
  }
  const fabric = createParallelDeliveryFabric(fixture.ports)
  const first = fabric.dispatch(submitCommand({ command_id: 'command:race-one' }))
  const second = fabric.dispatch(submitCommand({ command_id: 'command:race-one' }))
  await new Promise((resolve) => setImmediate(resolve))
  const mismatch = await fabric.dispatch(submitCommand({ command_id: 'command:race-one', plan: { plan_id: 'plan:other' } }))
  releaseFirst()
  const [firstOutcome, secondOutcome] = await Promise.all([first, second])
  assert.deepEqual(secondOutcome, firstOutcome)
  assert.equal(Object.isFrozen(secondOutcome), true)
  assert.equal(fixture.calls.planSubmit, 1)
  assert.deepEqual(mismatch, { command_id: 'command:race-one', type: 'submit', status: 'HELD', reason: 'COMMAND_ID_REUSE' })
})

test('RED command journal restarts from a command-id-derived stable key without replaying semantic ports', async () => {
  const fixture = createPorts()
  const command = freezeDeep(submitCommand({ command_id: 'command:journal-restart' }))
  const commandDigest = digestCanonical(command)
  const journalKey = stableJournalKey(command.command_id)
  const first = await createParallelDeliveryFabric(fixture.ports).dispatch(command)
  const semanticCallsBeforeReplay = fixture.calls.planSubmit
  const replay = await createParallelDeliveryFabric(fixture.ports).dispatch(command)
  const reuse = await createParallelDeliveryFabric(fixture.ports).dispatch(freezeDeep(submitCommand({ command_id: command.command_id, plan: { plan_id: 'plan:changed' } })))

  assert.deepEqual(first, { command_id: command.command_id, type: 'submit', status: 'SHADOW_STORED', reason: 'PLAN_STORED' })
  assert.deepEqual(replay, first)
  assert.deepEqual(reuse, { command_id: command.command_id, type: 'submit', status: 'HELD', reason: 'COMMAND_ID_REUSE' })
  assert.equal(fixture.calls.planSubmit, semanticCallsBeforeReplay)
  assert.equal(fixture.calls.planSubmit, 1)
  assert.deepEqual(fixture.journalRequests.read, [
    { journal_key: journalKey, command_id: command.command_id },
    { journal_key: journalKey, command_id: command.command_id },
    { journal_key: journalKey, command_id: command.command_id },
  ])
  assert.equal(fixture.journalRequests.reserve.length, 1)
  assert.equal(fixture.journalRequests.commit.length, 1)
  const [reserved] = fixture.journalRequests.reserve
  const [committed] = fixture.journalRequests.commit
  assert.deepEqual(Object.keys(reserved).sort(), ['attempt_id', 'command_digest', 'command_id', 'journal_key', 'reservation_id'])
  assert.deepEqual(Object.keys(committed).sort(), ['attempt_id', 'command_digest', 'command_id', 'journal_key', 'outcome', 'outcome_digest', 'reservation_id'])
  assert.equal(reserved.journal_key, journalKey)
  assert.equal(reserved.command_id, command.command_id)
  assert.equal(reserved.command_digest, commandDigest)
  assert.match(reserved.attempt_id, /^attempt:[0-9a-f-]{36}$/u)
  assert.equal(reserved.reservation_id, `reservation:${digestCanonical({ command_id: command.command_id, command_digest: commandDigest, attempt_id: reserved.attempt_id })}`)
  assert.deepEqual(committed, { ...reserved, outcome_digest: digestCanonical(first), outcome: first })
})

test('two Fabric instances sharing durable CAS use the stable journal key and have one semantic submit winner', async () => {
  const fixture = createPorts()
  let winner
  fixture.ports.commandJournal.read = async () => null
  fixture.ports.commandJournal.reserve = async (request) => {
    if (!winner) { winner = request; return { ...request, status: 'RESERVED', acquired: true } }
    return { ...winner, status: 'RESERVED', acquired: false }
  }
  fixture.ports.commandJournal.commit = async (request) => ({ ...request, status: 'COMMITTED' })
  const command = submitCommand({ command_id: 'command:cross-instance' })
  const [left, right] = await Promise.all([createParallelDeliveryFabric(fixture.ports).dispatch(command), createParallelDeliveryFabric(fixture.ports).dispatch(command)])
  assert.equal(fixture.calls.planSubmit, 1)
  assert.equal([left, right].filter((result) => result.status === 'SHADOW_STORED').length, 1)
  assert.equal([left, right].filter((result) => result.status === 'HELD').length, 1)
  assert.equal(winner.journal_key, stableJournalKey(command.command_id))
  assert.deepEqual(Object.keys(winner).sort(), ['attempt_id', 'command_digest', 'command_id', 'journal_key', 'reservation_id'])
})

test('RED command journal rejects unknown, extra, and mismatched committed receipts fail closed', async () => {
  const command = freezeDeep(submitCommand({ command_id: 'command:receipt-reject' }))
  const commandDigest = digestCanonical(command)
  const journalKey = stableJournalKey(command.command_id)
  const priorOutcome = Object.freeze({ command_id: command.command_id, type: 'submit', status: 'SHADOW_STORED', reason: 'PLAN_STORED' })
  const receipt = Object.freeze({ journal_key: journalKey, command_id: command.command_id, command_digest: commandDigest, attempt_id: 'attempt:prior', reservation_id: 'reservation:prior', status: 'COMMITTED', outcome_digest: digestCanonical(priorOutcome), outcome: priorOutcome })
  const rows = [
    ['unknown status', { ...receipt, status: 'UNKNOWN' }],
    ['unexpected field', { ...receipt, unrecognized: true }],
    ['mismatched stable key', { ...receipt, journal_key: `${journalKey}:other` }],
    ['mismatched reservation', { ...receipt, reservation_id: 'reservation:other' }],
  ]
  for (const [label, persisted] of rows) {
    const fixture = createPorts()
    fixture.ports.commandJournal.read = async () => persisted
    const result = await createParallelDeliveryFabric(fixture.ports).dispatch(command)
    assert.deepEqual(result, { command_id: command.command_id, type: 'submit', status: 'HELD', reason: 'COMMAND_RECEIPT_INVALID' }, label)
    assert.equal(fixture.calls.planSubmit, 0, label)
    assert.equal(fixture.calls.journalReserve, 0, label)
  }
})

test('persisted RESERVED receipt enters explicit recovery hold without replaying semantic ports', async () => {
  await assertPersistedReceiptHeld(
    'reserved-recovery',
    (command) => reservedJournalReceipt(command),
    'COMMAND_RECEIPT_RECOVERY_REQUIRED',
  )
  await assertPersistedReceiptHeld(
    'reserved-extra-field',
    (command) => reservedJournalReceipt(command, { unexpected: true }),
  )
  await assertPersistedReceiptHeld(
    'reserved-not-acquired',
    (command) => reservedJournalReceipt(command, { acquired: false }),
  )
})

test('hostile port results are snapshotted before execution status can reach admission', async () => {
  for (const hostile of [Object.defineProperty({}, 'status', { enumerable: true, get: () => 'SHADOW_INTENT' }), new Proxy({}, { ownKeys: () => { throw new Error('trap') } }), { status: 'SHADOW_INTENT', bad: BigInt(1) }]) {
    const fixture = createPorts()
    fixture.ports.execution.advance = () => hostile
    const result = await createParallelDeliveryFabric(fixture.ports).dispatch(advanceCommand())
    assert.equal(result.status, 'HELD')
    assert.equal(fixture.calls.admit, 0)
  }
})

test('factory capability snapshot ignores post-factory port replacement', async () => {
  const fixture = createPorts()
  const fabric = createParallelDeliveryFabric(fixture.ports)
  fixture.ports.planRegistry.submit = () => { throw new Error('replaced port must not run') }
  const result = await fabric.dispatch(submitCommand({ command_id: 'command:capability-snapshot' }))
  assert.deepEqual(result, { command_id: 'command:capability-snapshot', type: 'submit', status: 'SHADOW_STORED', reason: 'PLAN_STORED' })
  assert.equal(fixture.calls.planSubmit, 1)
})

test('advance stops scope, head, and evidence drift before admission or preflight', async () => {
  const fixture = createPorts()
  fixture.ports.execution.advance = () => { fixture.calls.advance += 1; return { status: 'HELD_SCOPE_DRIFT', reason: 'HEAD_DRIFT' } }
  const outcome = await createParallelDeliveryFabric(fixture.ports).dispatch(advanceCommand())

  assert.deepEqual(outcome, { command_id: 'command:advance-one', type: 'advance', status: 'HELD', reason: 'HEAD_DRIFT' })
  assert.equal(fixture.calls.advance, 1)
  assert.equal(fixture.calls.admit, 0)
  assert.equal(fixture.calls.preflight, 0)
})

test('advance rejects mixed plan, lease, provider, and context bindings before every semantic port', async () => {
  const cases = [
    ['transition plan', { advance_command: { next_level: 'implement_local', next_envelope: { plan_id: 'plan:other' } } }],
    ['admission lease', { admission: { lease_id: 'lease:other' } }],
    ['underdeclared resources', { admission: { resource_keys: ['path:docs/unrelated.mjs'] } }],
    ['provider head', { provider_request: { execution_context: { expected: { ...advanceTuple, head_sha: 'c'.repeat(40) } } } }],
    ['context attestation', { admission: { context_attestation_ref: 'attestation:other' } }],
  ]
  for (const [label, patch] of cases) {
    const fixture = createPorts()
    const result = await createParallelDeliveryFabric(fixture.ports).dispatch(advanceCommand({
      command_id: `command:mixed-${label.replace(' ', '-')}`,
      ...patch,
    }))
    assert.deepEqual(result, {
      command_id: `command:mixed-${label.replace(' ', '-')}`,
      type: 'advance', status: 'HELD', reason: 'ADVANCE_BINDING_MISMATCH',
    }, label)
    assert.equal(fixture.calls.advance, 0, label)
    assert.equal(fixture.calls.preflight, 0, label)
    assert.equal(fixture.calls.admit, 0, label)
    assert.equal(fixture.calls.validateActive, 0, label)
  }
})

test('advance rejects an ACTIVE plan response with a zero OID before execution, provider, or lease ports', async () => {
  const fixture = createPorts()
  fixture.ports.planRegistry.validateGeneration = async ({ plan_id, generation }) => {
    fixture.calls.validatePlan += 1
    return { status: 'ACTIVE', plan_id, generation, oid: '0'.repeat(40) }
  }
  const result = await createParallelDeliveryFabric(fixture.ports).dispatch(advanceCommand({ command_id: 'command:zero-plan-oid' }))
  assert.deepEqual(result, {
    command_id: 'command:zero-plan-oid', type: 'advance', status: 'HELD', reason: 'PLAN_GENERATION_UNAVAILABLE',
  })
  assert.equal(fixture.calls.advance, 0)
  assert.equal(fixture.calls.preflight, 0)
  assert.equal(fixture.calls.admit, 0)
})

test('P1 regression — advance binds the requested task to the active stored plan before every effect port', async () => {
  const fixture = createPorts()
  fixture.ports.planRegistry.validateGeneration = async ({ plan_id, generation }) => {
    fixture.calls.validatePlan += 1
    return {
      status: 'ACTIVE', plan_id, generation, oid: 'f'.repeat(40),
      task: {
        task_id: 'task:other', owner_session: 'session:owner-one', provider: 'codex',
        baseline_sha: 'a'.repeat(40), scope_digest: ADVANCE_SCOPE_DIGEST, dependencies: [],
      },
    }
  }
  const result = await createParallelDeliveryFabric(fixture.ports).dispatch(advanceCommand({ command_id: 'command:task-binding' }))
  assert.deepEqual(result, {
    command_id: 'command:task-binding', type: 'advance', status: 'HELD', reason: 'PLAN_TASK_BINDING_MISMATCH',
  })
  assert.equal(fixture.calls.advance, 0)
  assert.equal(fixture.calls.preflight, 0)
  assert.equal(fixture.calls.validateDependencies, 0)
  assert.equal(fixture.calls.admit, 0)
})

test('P2 regression — advance requires every stored predecessor to be completed at the integrated parent', async () => {
  const blockedFixture = createPorts()
  blockedFixture.ports.planRegistry.validateGeneration = async ({ plan_id, generation }) => {
    blockedFixture.calls.validatePlan += 1
    return {
      status: 'ACTIVE', plan_id, generation, oid: 'f'.repeat(40),
      task: {
        task_id: 'task:one', owner_session: 'session:owner-one', provider: 'codex',
        baseline_sha: 'a'.repeat(40), scope_digest: ADVANCE_SCOPE_DIGEST, dependencies: ['task:predecessor'],
      },
    }
  }
  blockedFixture.ports.leaseRegistry.validateDependencies = async () => {
    blockedFixture.calls.validateDependencies += 1
    return { status: 'HELD_EXECUTION_AUTHORITY', reason: 'DEPENDENCY_NOT_COMPLETED' }
  }
  const blocked = await createParallelDeliveryFabric(blockedFixture.ports).dispatch(advanceCommand({ command_id: 'command:dependency-blocked' }))
  assert.deepEqual(blocked, {
    command_id: 'command:dependency-blocked', type: 'advance', status: 'HELD', reason: 'DEPENDENCY_NOT_COMPLETED',
  })
  assert.equal(blockedFixture.calls.validateDependencies, 1)
  assert.equal(blockedFixture.calls.advance, 0)
  assert.equal(blockedFixture.calls.preflight, 0)
  assert.equal(blockedFixture.calls.admit, 0)

  const readyFixture = createPorts()
  readyFixture.ports.planRegistry.validateGeneration = blockedFixture.ports.planRegistry.validateGeneration
  const ready = await createParallelDeliveryFabric(readyFixture.ports).dispatch(advanceCommand({ command_id: 'command:dependency-ready' }))
  assert.deepEqual(ready, {
    command_id: 'command:dependency-ready', type: 'advance', status: 'SHADOW_INTENT', reason: 'ADVANCE_READY_FOR_SHADOW',
  })
  assert.equal(readyFixture.calls.validateDependencies, 1)
  assert.equal(readyFixture.calls.advance, 1)
})

test('advance keeps cap conflict and adapter context failure as typed non-live outcomes', async () => {
  const queuedFixture = createPorts()
  queuedFixture.ports.leaseRegistry.admit = async () => { queuedFixture.calls.admit += 1; return { status: 'QUEUED_FOR_LEASE', reason: 'WRITER_CAPACITY' } }
  const queued = await createParallelDeliveryFabric(queuedFixture.ports).dispatch(advanceCommand())

  const contextFixture = createPorts()
  contextFixture.ports.providerAdapters.codex.preflight = () => { contextFixture.calls.preflight += 1; return { status: 'HELD_EXECUTION_CONTEXT', reason: 'context_unverified' } }
  const context = await createParallelDeliveryFabric(contextFixture.ports).dispatch(advanceCommand({ command_id: 'command:advance-context' }))

  assert.deepEqual(queued, { command_id: 'command:advance-one', type: 'advance', status: 'QUEUED', reason: 'WRITER_CAPACITY' })
  assert.deepEqual(context, { command_id: 'command:advance-context', type: 'advance', status: 'HELD', reason: 'context_unverified' })
  assert.equal(queuedFixture.calls.preflight, 1)
  assert.equal(contextFixture.calls.admit, 0)
})

test('AC-14 — submit_delivery is a fixed Task9 hold and candidate delivery capabilities never reach a sink', async () => {
  const fixture = createPorts()
  const outcome = await createParallelDeliveryFabric(fixture.ports).dispatch(advanceCommand({
    envelope: { provider: 'codex', current_level: 'open_draft_pr' },
    advance_command: { next_level: 'submit_delivery', approve: true, merge: true, deploy: true },
  }))

  assert.deepEqual(outcome, {
    command_id: 'command:advance-one',
    type: 'advance',
    status: 'HELD',
    reason: 'PREMERGE_AUTHORITY_UNAVAILABLE',
    external_terminal: { phase: 'CLOSED', terminal_class: 'HELD', reason_code: 'PREMERGE_AUTHORITY_UNAVAILABLE' },
  })
  assert.equal(fixture.calls.advance, 0)
  assert.equal(fixture.calls.admit, 0)
  assert.equal(fixture.calls.preflight, 0)

  const credentialFixture = createPorts()
  const credential = await createParallelDeliveryFabric(credentialFixture.ports).dispatch(advanceCommand({
    command_id: 'command:advance-credential',
    envelope: { provider: 'codex', current_level: 'open_draft_pr' },
    advance_command: { next_level: 'submit_delivery', merge_credential: 'candidate-supplied' },
  }))
  assert.equal(credential.status, 'HELD')
  assert.deepEqual(credentialFixture.calls, noCalls())

  const sinkFixture = createPorts()
  const sinks = { approve: 0, credential: 0, deploy: 0, merge: 0, push: 0 }
  const candidatePorts = {
    ...sinkFixture.ports,
    approve: () => { sinks.approve += 1 },
    credential: () => { sinks.credential += 1 },
    deploy: () => { sinks.deploy += 1 },
    merge: () => { sinks.merge += 1 },
    push: () => { sinks.push += 1 },
  }
  const injectedPorts = await createParallelDeliveryFabric(candidatePorts).dispatch(advanceCommand({
    command_id: 'command:advance-injected-port',
    envelope: { provider: 'codex', current_level: 'open_draft_pr' },
    advance_command: { next_level: 'submit_delivery' },
  }))
  assert.equal(injectedPorts.status, 'HELD')
  assert.deepEqual(sinks, { approve: 0, credential: 0, deploy: 0, merge: 0, push: 0 })
  assert.deepEqual(sinkFixture.calls, noCalls())
})

test('advance rejects an unknown next level before admission or preflight', async () => {
  const fixture = createPorts()
  const outcome = await createParallelDeliveryFabric(fixture.ports).dispatch(advanceCommand({
    command_id: 'command:advance-unknown-level',
    advance_command: { next_level: 'deploy_production' },
  }))

  assert.deepEqual(outcome, {
    command_id: 'command:advance-unknown-level',
    type: 'advance',
    status: 'HELD',
    reason: 'ADVANCE_TRANSITION_INVALID',
  })
  assert.equal(fixture.calls.admit, 0)
  assert.equal(fixture.calls.preflight, 0)
})

test('adjacent advance matrix admits only the three non-terminal closed transitions', async () => {
  for (const [current_level, next_level] of [['plan_only', 'implement_local'], ['implement_local', 'push_owned_branch'], ['push_owned_branch', 'open_draft_pr']]) {
    const fixture = createPorts()
    const result = await createParallelDeliveryFabric(fixture.ports).dispatch(advanceCommand({ command_id: `command:${next_level}`, envelope: { provider: 'codex', current_level }, advance_command: { next_level } }))
    assert.deepEqual(result, { command_id: `command:${next_level}`, type: 'advance', status: 'SHADOW_INTENT', reason: 'ADVANCE_READY_FOR_SHADOW' })
  }
})

test('reconcile cannot release and a degraded projection fails closed', async () => {
  const releasedFixture = createPorts()
  releasedFixture.ports.leaseRegistry.reconcileTimeout = async () => { releasedFixture.calls.reconcile += 1; return { status: 'RELEASED', lease_id: 'lease:one' } }
  const released = await createParallelDeliveryFabric(releasedFixture.ports).dispatch(reconcileCommand())

  const degradedFixture = createPorts()
  degradedFixture.ports.projection.reconcile = async () => { degradedFixture.calls.projection += 1; return { status: 'HELD_PROJECTION', reason: 'projection_write_failed' } }
  const degraded = await createParallelDeliveryFabric(degradedFixture.ports).dispatch(reconcileCommand({ command_id: 'command:reconcile-degraded' }))

  assert.deepEqual(released, { command_id: 'command:reconcile-one', type: 'reconcile', status: 'HELD', reason: 'RECONCILE_RELEASE_FORBIDDEN' })
  assert.deepEqual(degraded, { command_id: 'command:reconcile-degraded', type: 'reconcile', status: 'HELD', reason: 'projection_write_failed' })
  assert.equal(releasedFixture.calls.release, 0)
})

test('drain persists a plan-level freeze; release stays held until a base-owned OwnerEndAttestor descriptor exists; inspect is read-only', async () => {
  const fixture = createPorts()
  const fabric = createParallelDeliveryFabric(fixture.ports)
  const drain = await fabric.dispatch(drainCommand())
  const release = await fabric.dispatch(releaseCommand())
  const snapshot = await fabric.inspect('plan:one')

  assert.deepEqual(drain, { command_id: 'command:drain-one', type: 'drain', status: 'SHADOW_STORED', reason: 'PLAN_DRAINING' })
  assert.deepEqual(release, { command_id: 'command:release-one', type: 'release', status: 'HELD', reason: 'RELEASE_AUTHORITY_UNAVAILABLE' })
  assert.deepEqual(snapshot, { plan_id: 'plan:one', plan: { oid: '0'.repeat(40), record: null }, leases: { oid: '0'.repeat(40), record: null } })
  assert.equal(Object.isFrozen(snapshot), true)
  assert.equal(fixture.calls.drainPlan, 1)
  assert.equal(fixture.calls.release, 0)
  assert.equal(fixture.calls.projection, 0)
})

test('RED release authority: caller-shaped attacker issuer stays held before the release port', async () => {
  const fixture = createPorts()
  const request = releaseCommand()
  request.release_request.attestation.issuer_id = 'attestor:attacker'
  const result = await createParallelDeliveryFabric(fixture.ports).dispatch(request)
  assert.deepEqual(result, { command_id: 'command:release-one', type: 'release', status: 'HELD', reason: 'RELEASE_AUTHORITY_UNAVAILABLE' })
  assert.equal(fixture.calls.release, 0)
})

test('RED inspect: partial or unknown read snapshots never become a successful view', async () => {
  for (const target of ['planRegistry', 'leaseRegistry']) {
    const fixture = createPorts()
    fixture.ports[target].inspect = async () => ({ status: 'UNKNOWN', partial: true })
    const result = await createParallelDeliveryFabric(fixture.ports).inspect('plan:one')
    assert.equal(result.status, 'HELD')
  }
})
