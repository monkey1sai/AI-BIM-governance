import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { digestCanonical } from '../../lib/parallel-delivery-fabric-contract.mjs'
import { createBoardProjection, evaluateResumeIntent, reconcileSession } from '../../lib/parallel-delivery-fabric-projection.mjs'

const SHA1_A = 'a'.repeat(40)
const SHA1_B = 'b'.repeat(40)
const SHA1_C = 'c'.repeat(40)
const SHA256_A = 'a'.repeat(64)
const SHA256_B = 'b'.repeat(64)
const NOW = '2026-08-29T00:00:00.000Z'
const LATER = '2026-08-29T00:05:00.000Z'
const EARLIER = '2026-08-28T23:55:00.000Z'
const INVALID_CALENDAR_TIMESTAMP = '2026-02-31T00:00:00.000Z'
const LEAP_DAY_TIMESTAMP = '2028-02-29T12:34:56.789Z'
const NONCE = 'n'.repeat(32)

const lease = (overrides = {}) => {
  const value = {
    schema_version: 'session-lease/v1', generation: 1, nonce: NONCE, created_at: NOW, updated_at: NOW,
    lease_id: 'lease:writer-one', lease_kind: 'writer_seat', plan_id: 'plan:one', task_id: 'task:one', provider: 'codex',
    owner_session: 'session:owner-one', provider_session_id: 'provider-session:one', execution_context_id: 'context:old',
    context_attestation_ref: 'attestation:context-old', common_dir_digest: SHA256_A, worktree_id: 'worktree:one',
    worktree_path_digest: SHA256_B, branch: 'codex/projection', scope_digest: SHA256_A, head_sha: SHA1_A,
    resource_keys: ['path:scripts/lib/parallel-delivery-fabric-projection.mjs'], state: 'SUSPECT', heartbeat_seq: 2,
    heartbeat_at: NOW, release_evidence_ref: null, retention_state: 'ACTIVE', revocation_epoch: 7, suspect_at: NOW,
    ...overrides,
  }
  if (value.state !== 'SUSPECT') delete value.suspect_at
  const { canonical_digest: ignored, ...unsigned } = value
  return { ...unsigned, canonical_digest: digestCanonical(unsigned) }
}

const registry = (overrides = {}) => ({
  schema_version: 'lease-registry-snapshot/v1', oid: SHA1_B, lease_id: 'lease:writer-one',
  target_ref: 'target:worktree-one', target_type: 'worktree', target_digest: SHA256_B,
  runtime_correlation: 'runtime:none', ...overrides,
})
const clock = (overrides = {}) => ({ now: NOW, heartbeat_timeout_ms: 30_000, projection_timeout_ms: 30_000, ...overrides })
const boardSnapshot = (overrides = {}) => ({
  board_ref: 'board:shared-one', observed_at: NOW,
  sessions: [{ session_ref: 'session:board-one', state: 'active', updated_at: NOW }], ...overrides,
})
const projectionSource = (overrides = {}) => ({
  schema_version: 'fabric-projection-source/v1', generation: 1, expected_projection_oid: SHA1_A,
  plan_ref: 'plan:one', lease_ref: 'lease-registry:one', provider_envelope_ref: 'envelope:one', github_state_ref: 'github-state:one',
  ...overrides,
})
const canonicalInventory = (overrides = {}) => ({
  status: 'RECLAIM_HANDOFF_READY',
  handoff: {
    attestation_ref: 'attestation:inventory-one', target_ref: 'target:worktree-one', target_type: 'worktree',
    target_digest: SHA256_B, lease_id: 'lease:writer-one', runtime_correlation: 'runtime:none',
  },
  ...overrides,
})
const inventoryReceipt = (overrides = {}) => ({
  status: 'VERIFIED_HOST_INVENTORY', attestation_ref: 'attestation:inventory-one',
  issuer_id: 'issuer:host-inventory', issuer_version: 'host-inventory-authority/v1', source_digest: SHA256_A,
  observed_at: NOW, expires_at: LATER, nonce: NONCE, revocation_epoch: 7,
  target_ref: 'target:worktree-one', target_type: 'worktree', target_digest: SHA256_B, lease_id: 'lease:writer-one',
  runtime_correlation: 'runtime:none', owner_proof_status: 'ENDED', runtime_state: 'ABSENT', expected_registry_oid: SHA1_B,
  ...overrides,
})
const resumeIntent = (overrides = {}) => ({
  schema_version: 'resume-intent/v1', type: 'RESUME_INTENT', owner_session: 'session:owner-one', provider: 'codex',
  provider_session_id: 'provider-session:one', prior_execution_context_id: 'context:old', execution_context_id: 'context:new',
  lease_id: 'lease:writer-one', generation: 1, common_dir_digest: SHA256_A, worktree_id: 'worktree:one',
  worktree_path_digest: SHA256_B, branch: 'codex/projection', head_sha: SHA1_A, scope_digest: SHA256_A,
  expected_registry_oid: SHA1_B, nonce: NONCE, ...overrides,
})
const canonicalContext = (overrides = {}) => ({
  status: 'VERIFIED_EXECUTION_CONTEXT', attestation_ref: 'attestation:context-new', tuple_digest: SHA256_A, ...overrides,
})
const canonicalOwnerEnd = (overrides = {}) => ({ status: 'VERIFIED_OWNER_END', attestation_ref: 'attestation:owner-end-one', ...overrides })
const resumeReceipt = (overrides = {}) => ({
  status: 'VERIFIED_RESUME_AUTHORITY', context_attestation_ref: 'attestation:context-new', context_tuple_digest: SHA256_A,
  owner_end_attestation_ref: 'attestation:owner-end-one', issuer_id: 'issuer:resume-authority', issuer_version: 'resume-authority/v1',
  source_digest: SHA256_B, observed_at: NOW, expires_at: LATER, nonce: NONCE, revocation_epoch: 7,
  old_execution_context_id: 'context:old', expected_registry_oid: SHA1_B,
  tuple: {
    owner_session: 'session:owner-one', provider: 'codex', provider_session_id: 'provider-session:one', execution_context_id: 'context:new',
    lease_id: 'lease:writer-one', generation: 1, common_dir_digest: SHA256_A, worktree_id: 'worktree:one',
    worktree_path_digest: SHA256_B, branch: 'codex/projection', head_sha: SHA1_A, scope_digest: SHA256_A,
  },
  ...overrides,
})
const makeProjection = ({ board = () => boardSnapshot(), acknowledgement = () => ({ status: 'STORED', oid: SHA1_C }), authorityClock = undefined, extraConfig = {} } = {}) => {
  const calls = { read: 0, write: 0, argv: [], requests: [] }
  const config = {
    readBoardStatus: (...argv) => { calls.read += 1; calls.argv.push(argv); return board(...argv) },
    writeProjection: (request) => { calls.write += 1; calls.requests.push(request); return acknowledgement(request) },
    ...extraConfig,
  }
  if (authorityClock !== undefined) config.authorityClock = authorityClock
  return { calls, projection: createBoardProjection(config) }
}

const stamped = (value) => ({ ...value, canonical_digest: digestCanonical(value) })
const endRequest = () => ({ reason: 'handoff', requested_at: NOW, nonce: NONCE, handoff_or_candidate_reference: 'handoff:one' })
const releaseReservation = () => stamped({
  schema_version: 'lease-release-reservation/v1', generation: 1, nonce: NONCE, created_at: NOW, updated_at: NOW,
  release_id: 'release:one', lease_id: 'lease:writer-one', attestation_ref: 'attestation:owner-end', attestation_digest: SHA256_A,
  attestor_issuer: 'attestor:owner-end', attestor_version: 'owner-end/v1', observed_at: NOW, expires_at: LATER,
  revocation_epoch: 7, expected_registry_oid: SHA1_B, expected_envelope_oid: 'e'.repeat(40), expected_envelope_transition_sequence: 0,
})
const releasingLease = () => lease({ state: 'RELEASING', end_request: endRequest(), release_reservation: releaseReservation() })
const releasedLease = () => lease({
  state: 'RELEASED', retention_state: 'RETAINED_FOR_REVIEW', release_evidence_ref: 'attestation:owner-end', end_request: endRequest(),
  release_transition: ['RELEASING', 'RELEASED'], release_evidence_digest: SHA256_A, release_reason: 'handoff', envelope_revocation_oid: 'f'.repeat(40),
  release_record: {
    schema_version: 'lease-release/v1', release_id: 'release:one', plan_id: 'plan:one', generation: 1, task_id: 'task:one', lease_id: 'lease:writer-one',
    lease_kind: 'writer_seat', owner_session: 'session:owner-one', provider: 'codex', provider_session_id: 'provider-session:one', execution_context_id: 'context:old',
    final_heartbeat_seq: 2, final_head_sha: SHA1_A, scope_digest: SHA256_A, worktree_path_digest: SHA256_B, handoff_or_candidate_reference: 'handoff:one',
    release_reason: 'handoff', owner_end_attestation_ref: 'attestation:owner-end', owner_end_attestation_digest: SHA256_A, attestor_issuer: 'attestor:owner-end',
    attestor_version: 'owner-end/v1', observed_at: NOW, expires_at: LATER, nonce: NONCE, revocation_epoch: 7, expected_registry_oid: SHA1_B,
    expected_envelope_oid: 'e'.repeat(40), transition_sequence: 1, retained_resource_keys: ['path:scripts/lib/parallel-delivery-fabric-projection.mjs'],
  },
})

test('ordinary lifecycle projection uses only exact status read and atomic projection CAS', () => {
  const { calls, projection } = makeProjection()
  for (const operation of ['start', 'heartbeat', 'handoff', 'end_request', 'release']) {
    assert.equal(projection[operation]({ lease: lease(), projectionSource: projectionSource() }).status, 'PROJECTION_READY', operation)
  }
  assert.deepEqual(calls.argv, Array.from({ length: 5 }, () => ['status', '--json', '--no-prune']))
  assert.equal(calls.write, 5)
  for (const request of calls.requests) {
    assert.deepEqual(Object.keys(request).sort(), ['channel', 'expected_oid', 'record'])
    assert.equal(request.expected_oid, SHA1_A)
  }
})

test('legacy board writes are held before board or projection ports', () => {
  const { calls, projection } = makeProjection()
  const result = projection.start({ lease: lease(), projectionSource: projectionSource(), legacy_board_command: 'update' })
  assert.equal(result.status, 'HELD_LEGACY_BOARD_WRITE')
  assert.equal(result.reason, 'legacy_board_write_forbidden')
  assert.equal(calls.read, 0)
  assert.equal(calls.write, 0)
})

test('ordinary reconcile projects a durable RECONCILED outcome', () => {
  const { calls, projection } = makeProjection()
  const result = projection.reconcile({ lease: lease(), registry: registry(), projectionSource: projectionSource(), clock: clock() })
  assert.equal(result.status, 'RECONCILED')
  assert.equal(calls.read, 1)
  assert.equal(calls.write, 1)
})

test('stale ACTIVE lease becomes SUSPECT before malformed projection or board evidence', () => {
  for (const source of [undefined, { schema_version: 'fabric-projection-source/v1' }]) {
    const { calls, projection } = makeProjection({ board: () => null })
    const result = projection.reconcile({
      lease: lease({ state: 'ACTIVE', heartbeat_at: EARLIER }), registry: registry(), projectionSource: source, clock: clock(),
    })
    assert.equal(result.status, 'SUSPECT')
    assert.equal(result.reason, 'heartbeat_timeout')
    assert.equal(calls.read, 0)
    assert.equal(calls.write, 0)
  }
})

test('canonical Task3 END_REQUESTED and RELEASING leases hold before board projection', () => {
  for (const currentLease of [lease({ state: 'END_REQUESTED', end_request: endRequest() }), releasingLease()]) {
    const { calls, projection } = makeProjection()
    const result = projection.reconcile({ lease: currentLease, registry: registry(), projectionSource: projectionSource(), clock: clock() })
    assert.equal(result.status, 'HELD_EXECUTION_AUTHORITY')
    assert.equal(result.lease_state, currentLease.state)
    assert.equal(calls.read, 0)
    assert.equal(calls.write, 0)
  }
})

test('canonical Task3 RELEASED lease projects a released writer seat while retaining resources', () => {
  const { calls, projection } = makeProjection()
  const result = projection.start({ lease: releasedLease(), projectionSource: projectionSource() })
  assert.equal(result.status, 'PROJECTION_READY')
  assert.equal(result.lease_state, 'RELEASED')
  assert.equal(result.occupied, false)
  assert.equal(result.writer_seat_released, true)
  assert.equal(result.resources_retained, true)
  assert.equal(result.retention_state, 'RETAINED_FOR_REVIEW')
  assert.equal(calls.read, 1)
  assert.equal(calls.write, 1)
})

test('projection source and writer failures degrade without changing parsed durable truth', () => {
  const missing = makeProjection()
  const invalid = missing.projection.start({ lease: lease(), projectionSource: undefined })
  assert.equal(invalid.status, 'PROJECTION_DEGRADED')
  assert.equal(invalid.lease_state, 'SUSPECT')
  assert.equal(missing.calls.read, 0)
  const conflict = makeProjection({ acknowledgement: () => ({ status: 'CONFLICT', oid: SHA1_C }) })
  const result = conflict.projection.start({ lease: lease(), projectionSource: projectionSource() })
  assert.equal(result.status, 'PROJECTION_DEGRADED')
  assert.equal(result.lease_state, 'SUSPECT')
  assert.equal(conflict.calls.read, 1)
  assert.equal(conflict.calls.write, 1)
})

test('closed recursive privacy gate rejects raw environment, secret, and cyclic inputs before ports', () => {
  for (const input of [
    { lease: lease(), projectionSource: projectionSource(), untrusted: { authorization: 'bearer' } },
    { lease: lease({ lease_id: 'path:env:PAY_TO_ADDRESS' }), projectionSource: projectionSource() },
  ]) {
    const { calls, projection } = makeProjection()
    const result = projection.start(input)
    assert.match(result.status, /^HELD_(?:PRIVACY|INPUT)$/u)
    assert.equal(calls.read, 0)
    assert.equal(calls.write, 0)
  }
  const cycle = { lease: lease(), projectionSource: projectionSource() }
  cycle.self = cycle
  const { calls, projection } = makeProjection()
  assert.equal(projection.start(cycle).status, 'HELD_INPUT')
  assert.equal(calls.read, 0)
  assert.equal(calls.write, 0)
})

test('factory accepts only the two real ports plus an optional canonical authority clock', () => {
  const ordinary = makeProjection()
  assert.equal(ordinary.projection.start({ lease: lease(), projectionSource: projectionSource() }).status, 'PROJECTION_READY')
  const invalid = makeProjection({ extraConfig: { effects: {} } })
  assert.equal(invalid.projection.start({ lease: lease(), projectionSource: projectionSource() }).status, 'HELD_INPUT')
  assert.equal(invalid.calls.read, 0)
  assert.equal(invalid.calls.write, 0)
  const clockInvalid = makeProjection({ authorityClock: { now: NOW } })
  assert.equal(clockInvalid.projection.start({ lease: lease(), projectionSource: projectionSource() }).status, 'HELD_INPUT')
  assert.equal(clockInvalid.calls.read, 0)
  assert.equal(clockInvalid.calls.write, 0)
})

test('AC-28 — seven lifecycle operations reject forbidden legacy and machine-effect ports with zero side effects', () => {
  const forbiddenNames = [
    'legacy_board_register', 'legacy_board_update', 'legacy_board_done', 'legacy_board_hooks', 'notify',
    'lifecycle_maintenance', 'orphan_cleanup', 'detached_child', 'process_scan', 'listener_scan',
    'terminate_pid', 'branch_prune', 'worktree_prune', 'acl_mutation',
  ]
  const forbiddenCalls = Object.fromEntries(forbiddenNames.map((name) => [name, 0]))
  const extraConfig = Object.fromEntries(forbiddenNames.map((name) => [name, () => { forbiddenCalls[name] += 1 }]))
  const { calls, projection } = makeProjection({ extraConfig })
  const operations = [
    ['start', () => projection.start({ lease: lease(), projectionSource: projectionSource(), legacy_board_command: 'update' })],
    ['heartbeat', () => projection.heartbeat({ lease: lease(), projectionSource: projectionSource(), legacy_board_command: 'update' })],
    ['handoff', () => projection.handoff({ lease: lease(), projectionSource: projectionSource(), legacy_board_command: 'update' })],
    ['end_request', () => projection.end_request({ lease: lease(), projectionSource: projectionSource(), legacy_board_command: 'update' })],
    ['release', () => projection.release({ lease: lease(), projectionSource: projectionSource(), legacy_board_command: 'update' })],
    ['reconcile', () => projection.reconcile({ lease: lease(), registry: registry(), projectionSource: projectionSource(), clock: clock() })],
    ['resume', () => projection.resume({
      lease: lease(), registry: registry(), projectionSource: projectionSource(), intent: resumeIntent(),
      contextAttestation: canonicalContext(), ownerEndAttestation: canonicalOwnerEnd(), resumeAuthorityReceipt: resumeReceipt(),
    })],
  ]

  for (const [name, operation] of operations) {
    const result = operation()
    assert.ok(['HELD_INPUT', 'HELD_EXECUTION_AUTHORITY', 'PROJECTION_DEGRADED'].includes(result.status), name)
    assert.equal(calls.read, 0, name)
    assert.equal(calls.write, 0, name)
    assert.deepEqual(forbiddenCalls, Object.fromEntries(forbiddenNames.map((port) => [port, 0])), name)
  }
})

test('AC-29 — the legacy board is one exact rebuildable projection read and cannot issue authority', () => {
  const durableRegistry = registry()
  const githubObservation = projectionSource()
  const ordinary = makeProjection()
  const rebuilt = ordinary.projection.reconcile({
    lease: lease(), registry: durableRegistry, projectionSource: githubObservation, clock: clock(),
  })

  assert.equal(rebuilt.status, 'RECONCILED')
  assert.deepEqual(ordinary.calls.argv, [['status', '--json', '--no-prune']])
  assert.equal(ordinary.calls.write, 1)
  assert.deepEqual(
    {
      lease_id: ordinary.calls.requests[0].record.lease_id,
      github_state_ref: ordinary.calls.requests[0].record.github_state_ref,
      generation: ordinary.calls.requests[0].record.generation,
    },
    { lease_id: durableRegistry.lease_id, github_state_ref: githubObservation.github_state_ref, generation: githubObservation.generation },
  )

  for (const [name, options] of [
    ['missing board', { board: () => null }],
    ['malformed board', { board: () => ({ board_ref: 'board:shared-one' }) }],
    ['projection write failure', { acknowledgement: () => ({ status: 'CONFLICT', oid: SHA1_C }) }],
  ]) {
    const degraded = makeProjection(options)
    const result = degraded.projection.start({ lease: lease(), projectionSource: githubObservation })
    assert.equal(result.status, 'PROJECTION_DEGRADED', name)
  }

  const authorityCalls = { lease: 0, pass: 0, process: 0 }
  const authorityPortAttempt = makeProjection({
    extraConfig: {
      lease_authority: () => { authorityCalls.lease += 1 },
      pass_authority: () => { authorityCalls.pass += 1 },
      process_authority: () => { authorityCalls.process += 1 },
    },
  })
  const held = authorityPortAttempt.projection.start({ lease: lease(), projectionSource: githubObservation })

  assert.equal(held.status, 'HELD_INPUT')
  assert.equal(authorityPortAttempt.calls.read, 0)
  assert.equal(authorityPortAttempt.calls.write, 0)
  assert.deepEqual(authorityCalls, { lease: 0, pass: 0, process: 0 })
})

test('legacy authority configuration and public callback keys are rejected before ports', () => {
  const legacyConfig = makeProjection({ extraConfig: { inventoryAuthorityPin: {} } })
  assert.equal(legacyConfig.projection.start({ lease: lease(), projectionSource: projectionSource() }).status, 'HELD_INPUT')
  assert.equal(legacyConfig.calls.read, 0)
  const { calls, projection } = makeProjection({ authorityClock: clock() })
  const result = projection.reconcile({
    lease: lease(), registry: registry(), projectionSource: projectionSource(), clock: clock(), inventoryAttestation: canonicalInventory(), inventoryAuthority: {},
  })
  assert.equal(result.status, 'HELD_INPUT')
  assert.equal(calls.read, 0)
  assert.equal(calls.write, 0)
})

test('matching detached inventory receipt is a shadow hold and never a reclaim handoff', () => {
  const { calls, projection } = makeProjection({ authorityClock: clock() })
  const result = projection.reconcile({
    lease: lease(), registry: registry(), projectionSource: projectionSource(), clock: clock(), inventoryAttestation: canonicalInventory(), inventoryReceipt: inventoryReceipt(),
  })
  assert.equal(result.status, 'HELD_HOST_INVENTORY')
  assert.equal(result.reason, 'host_inventory_authority_activation_unavailable')
  assert.equal(result.reconcile_required, true)
  assert.equal(result.shadow_contract, 'MATCHED')
  assert.equal(Object.hasOwn(result, 'handoff'), false)
  assert.equal(calls.read, 0)
  assert.equal(calls.write, 0)
})

test('forged, stale, runtime-active, and fixed-pin-drift inventory receipts fail closed before ports', () => {
  for (const receipt of [
    inventoryReceipt({ issuer_id: 'issuer:attacker' }),
    inventoryReceipt({ observed_at: EARLIER, expires_at: NOW }),
    inventoryReceipt({ runtime_state: 'ACTIVE' }),
    inventoryReceipt({ source_digest: SHA256_B }),
  ]) {
    const { calls, projection } = makeProjection({ authorityClock: clock() })
    const result = projection.reconcile({
      lease: lease(), registry: registry(), projectionSource: projectionSource(), clock: clock(), inventoryAttestation: canonicalInventory(), inventoryReceipt: receipt,
    })
    assert.equal(result.status, 'HELD_HOST_INVENTORY')
    assert.equal(result.reason, 'inventory_evidence_untrusted')
    assert.equal(calls.read, 0)
    assert.equal(calls.write, 0)
  }
})

test('missing authority clock prevents inventory shadow matching without a wall-clock fallback', () => {
  const { calls, projection } = makeProjection()
  const result = projection.reconcile({
    lease: lease(), registry: registry(), projectionSource: projectionSource(), clock: clock(), inventoryAttestation: canonicalInventory(), inventoryReceipt: inventoryReceipt(),
  })
  assert.equal(result.status, 'HELD_HOST_INVENTORY')
  assert.equal(result.reason, 'inventory_evidence_untrusted')
  assert.equal(calls.read, 0)
  assert.equal(calls.write, 0)
})

test('matching detached resume receipt is a shadow hold and never a registry rebind', () => {
  const { calls, projection } = makeProjection({ authorityClock: clock() })
  const result = projection.resume({
    lease: lease(), registry: registry(), projectionSource: projectionSource(), intent: resumeIntent(), contextAttestation: canonicalContext(),
    ownerEndAttestation: canonicalOwnerEnd(), resumeAuthorityReceipt: resumeReceipt(),
  })
  assert.equal(result.status, 'HELD_EXECUTION_AUTHORITY')
  assert.equal(result.reason, 'resume_authority_activation_unavailable')
  assert.equal(result.reconcile_required, true)
  assert.equal(result.shadow_contract, 'MATCHED')
  assert.equal(Object.hasOwn(result, 'rebind'), false)
  assert.equal(calls.read, 0)
  assert.equal(calls.write, 0)
})

test('wrong resume pin, OID, nonce, and timestamps hold before board or registry effects', () => {
  for (const receipt of [
    resumeReceipt({ issuer_id: 'issuer:attacker' }), resumeReceipt({ expected_registry_oid: SHA1_C }),
    resumeReceipt({ nonce: 'x'.repeat(32) }), resumeReceipt({ observed_at: INVALID_CALENDAR_TIMESTAMP }),
  ]) {
    const { calls, projection } = makeProjection({ authorityClock: clock() })
    const result = projection.resume({
      lease: lease(), registry: registry(), projectionSource: projectionSource(), intent: resumeIntent(), contextAttestation: canonicalContext(),
      ownerEndAttestation: canonicalOwnerEnd(), resumeAuthorityReceipt: receipt,
    })
    assert.equal(result.status, 'HELD_EXECUTION_AUTHORITY')
    assert.equal(result.reason, 'resume_evidence_untrusted')
    assert.equal(calls.read, 0)
    assert.equal(calls.write, 0)
  }
})

test('direct helpers are closed detached shadow APIs and ignore caller authority callback fields', () => {
  const inventory = reconcileSession({
    lease: lease(), registry: registry(), clock: clock(), inventoryAttestation: canonicalInventory(), inventoryReceipt: inventoryReceipt(),
  })
  assert.equal(inventory.status, 'HELD_HOST_INVENTORY')
  const resume = evaluateResumeIntent({
    lease: lease(), registry: registry(), intent: resumeIntent(), contextAttestation: canonicalContext(), ownerEndAttestation: canonicalOwnerEnd(),
    resumeAuthorityReceipt: resumeReceipt(), authorityClock: clock(),
  })
  assert.equal(resume.status, 'HELD_EXECUTION_AUTHORITY')
  assert.equal(reconcileSession({
    lease: lease(), registry: registry(), clock: clock(), inventoryAttestation: canonicalInventory(), inventoryReceipt: inventoryReceipt(), inventoryAuthority: {},
  }).status, 'HELD_INPUT')
})

test('input snapshot prevents a board reader from mutating caller projection metadata', () => {
  const rawSource = projectionSource()
  const { calls, projection } = makeProjection({ board: () => { rawSource.expected_projection_oid = SHA1_B; return boardSnapshot() } })
  const result = projection.start({ lease: lease(), projectionSource: rawSource })
  assert.equal(result.status, 'PROJECTION_READY')
  assert.equal(calls.requests[0].expected_oid, SHA1_A)
})

test('invalid board calendar date degrades before writer while canonical leap day remains valid', () => {
  const invalid = makeProjection({ board: () => boardSnapshot({ observed_at: INVALID_CALENDAR_TIMESTAMP }) })
  assert.equal(invalid.projection.start({ lease: lease(), projectionSource: projectionSource() }).status, 'PROJECTION_DEGRADED')
  assert.equal(invalid.calls.write, 0)
  const leap = makeProjection({ board: () => boardSnapshot({
    observed_at: LEAP_DAY_TIMESTAMP, sessions: [{ session_ref: 'session:board-one', state: 'active', updated_at: LEAP_DAY_TIMESTAMP }],
  }) })
  assert.equal(leap.projection.start({ lease: lease(), projectionSource: projectionSource() }).status, 'PROJECTION_READY')
  assert.equal(leap.calls.write, 1)
})

test('authority receipt calendar dates, offsets, and missing milliseconds fail closed', () => {
  for (const timestamp of [INVALID_CALENDAR_TIMESTAMP, '2026-08-29T00:00:00Z', '2026-08-29T00:00:00.000+00:00']) {
    const inventory = makeProjection({ authorityClock: clock() })
    const inventoryResult = inventory.projection.reconcile({
      lease: lease(), registry: registry(), projectionSource: projectionSource(), clock: clock(), inventoryAttestation: canonicalInventory(), inventoryReceipt: inventoryReceipt({ observed_at: timestamp }),
    })
    assert.match(inventoryResult.status, /^HELD_(?:HOST_INVENTORY|PRIVACY)$/u)
    assert.equal(inventory.calls.read, 0)
    assert.equal(inventory.calls.write, 0)
    const resume = makeProjection({ authorityClock: clock() })
    const resumeResult = resume.projection.resume({
      lease: lease(), registry: registry(), projectionSource: projectionSource(), intent: resumeIntent(), contextAttestation: canonicalContext(),
      ownerEndAttestation: canonicalOwnerEnd(), resumeAuthorityReceipt: resumeReceipt({ observed_at: timestamp }),
    })
    assert.match(resumeResult.status, /^HELD_(?:EXECUTION_AUTHORITY|PRIVACY)$/u)
    assert.equal(resume.calls.read, 0)
    assert.equal(resume.calls.write, 0)
  }
})

test('projection callbacks receive owned frozen input and malformed acknowledgements only degrade', () => {
  let frozen = false
  const fixture = makeProjection({ acknowledgement: (request) => {
    frozen = Object.isFrozen(request) && Object.isFrozen(request.record)
    return { status: 'STORED', oid: SHA1_C, extra: true }
  } })
  const result = fixture.projection.start({ lease: lease(), projectionSource: projectionSource() })
  assert.equal(frozen, true)
  assert.equal(result.status, 'PROJECTION_DEGRADED')
  assert.equal(fixture.calls.read, 1)
  assert.equal(fixture.calls.write, 1)
})

test('source remains Phase0 shadow-only without authority callback, nonce, CAS, or wall-clock execution', async () => {
  const source = await readFile(new URL('../../lib/parallel-delivery-fabric-projection.mjs', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /verifyHostInventory|verifyResumeEvidence|reserveReclaimHandoff|rebindResume|Date\.now\s*\(/u)
  assert.doesNotMatch(source, /EFFECT_PORT_KEYS|effectsAreInertAndComplete/u)
  assert.doesNotMatch(source, /status:\s*['"]RECLAIM_HANDOFF_READY['"]|status:\s*['"]RESUME_REBOUND['"]/u)
})

test('RED round11: throwing Proxy prototypes produce typed public input holds before ports', () => {
  const proxy = (value = {}) => new Proxy(value, { getPrototypeOf() { throw new Error('proxy-prototype-trap') } })
  const factoryCalls = { read: 0, write: 0 }
  const fromProxyConfig = createBoardProjection(proxy({
    readBoardStatus: () => { factoryCalls.read += 1; return boardSnapshot() },
    writeProjection: () => { factoryCalls.write += 1; return { status: 'STORED', oid: SHA1_C } },
  }))
  assert.equal(fromProxyConfig.start({ lease: lease(), projectionSource: projectionSource() }).status, 'HELD_INPUT')
  assert.deepEqual(factoryCalls, { read: 0, write: 0 })

  const ordinary = makeProjection()
  assert.equal(ordinary.projection.start(proxy()).status, 'HELD_INPUT')
  assert.equal(ordinary.calls.read, 0)
  assert.equal(ordinary.calls.write, 0)
  assert.equal(reconcileSession(proxy()).status, 'HELD_INPUT')
  assert.equal(evaluateResumeIntent(proxy()).status, 'HELD_INPUT')
})

test('RED round11: only canonical timestamps bypass recursive bearer privacy classification', () => {
  const malicious = reconcileSession({
    lease: lease(), registry: registry(), clock: clock({ now: '2026-08-29Tbearer' }), inventoryAttestation: undefined, inventoryReceipt: undefined,
  })
  assert.equal(malicious.status, 'HELD_PRIVACY')
  const canonical = reconcileSession({
    lease: lease(), registry: registry(), clock: clock(), inventoryAttestation: undefined, inventoryReceipt: undefined,
  })
  assert.equal(canonical.status, 'RECONCILED')
})

test('RED round12: ownKeys and get Proxy traps never escape any public boundary', () => {
  const proxyModes = [
    ['ownKeys', (value) => new Proxy(value, { getPrototypeOf: () => Object.prototype, ownKeys() { throw new Error('proxy-own-keys-trap') } })],
    ['get', (value) => new Proxy(value, { getPrototypeOf: () => Object.prototype, ownKeys: (target) => Reflect.ownKeys(target), get() { throw new Error('proxy-get-trap') } })],
  ]
  for (const [name, proxy] of proxyModes) {
    const factoryCalls = { read: 0, write: 0 }
    const fromProxyConfig = createBoardProjection(proxy({
      readBoardStatus: () => { factoryCalls.read += 1; return boardSnapshot() },
      writeProjection: () => { factoryCalls.write += 1; return { status: 'STORED', oid: SHA1_C } },
    }))
    assert.equal(fromProxyConfig.start({ lease: lease(), projectionSource: projectionSource() }).status, 'HELD_INPUT', `${name}:config`)
    assert.deepEqual(factoryCalls, { read: 0, write: 0 }, `${name}:config`)

    const ordinary = makeProjection()
    assert.equal(ordinary.projection.start(proxy({ lease: lease(), projectionSource: projectionSource() })).status, 'HELD_INPUT', `${name}:start`)
    assert.equal(ordinary.calls.read, 0, `${name}:start`)
    assert.equal(ordinary.calls.write, 0, `${name}:start`)
    assert.equal(reconcileSession(proxy({})).status, 'HELD_INPUT', `${name}:reconcile`)
    assert.equal(evaluateResumeIntent(proxy({})).status, 'HELD_INPUT', `${name}:resume`)
  }
})
