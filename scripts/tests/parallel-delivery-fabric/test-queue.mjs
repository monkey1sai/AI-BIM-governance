import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { digestCanonical } from '../../lib/parallel-delivery-fabric-contract.mjs'
import {
  invalidateMergeQueueSnapshot,
  observeMergeQueueSnapshot,
  reconcileQueueCapacity,
  validateQueueConcurrencyPolicy,
} from '../../lib/parallel-delivery-fabric-queue.mjs'

const sha = (character) => character.repeat(40)
const digest = (character) => character.repeat(64)
const NOW = '2026-08-28T12:05:00.000Z'

const source = () => ({
  repository: 'acme/bim',
  workflow: 'ci-workflow',
  resource_key: 'shared-resource-ci',
})

const memberVector = () => [{ pr_number: 11, node_id: 'prnode:one', head_sha: sha('c') }]

const queueSnapshot = (overrides = {}) => {
  const sourceValue = source()
  const members = memberVector()
  return {
    now: NOW,
    source: sourceValue,
    snapshot: {
      schema_version: 'merge-queue-observation/v1',
      snapshot_id: 'snapshot-queue-one',
      snapshot_generation: 1,
      observed_at: '2026-08-28T12:00:00.000Z',
      expires_at: '2026-08-28T12:10:00.000Z',
      source_digest: digestCanonical(sourceValue),
      eligibility: 'eligible',
      merge_group_sha: sha('b'),
      member_vector_digest: digestCanonical(members),
      queue_position: 1,
      group_checks_digest: digest('c'),
      state: 'OBSERVED',
    },
    member_vector: members,
    ...overrides,
  }
}

const queuePolicy = (overrides = {}) => ({
  workflow: 'ci-workflow',
  resource_key: 'shared-resource-ci',
  group: '${{ github.workflow }}-shared-resource-ci',
  queue: 'max',
  cancel_in_progress: false,
  ...overrides,
})

const tuple = (suffix) => ({
  candidate_id: `candidate:${suffix}`,
  run_id: `run:${suffix}`,
  lease_id: `lease:${suffix}`,
})

test('AC-31 — queue observer accepts only a fresh timestamped source-pinned snapshot', () => {
  const observed = observeMergeQueueSnapshot(queueSnapshot())

  assert.equal(observed.phase, 'OBSERVED')
  assert.equal(observed.internal_state, 'QUEUE_OBSERVED')
  assert.equal(observed.observation.snapshot.snapshot_id, 'snapshot-queue-one')
  assert.equal(observed.observation.member_vector[0].node_id, 'prnode:one')
  assert.equal(Object.isFrozen(observed), true)
})

test('AC-31 — queue observer holds unsupported, stale, unpinned, malformed, or impersonating merge-group evidence', () => {
  const cases = [
    ['unsupported', (input) => { input.snapshot.eligibility = 'unsupported' }, 'unsupported_queue_capability'],
    ['stale', (input) => { input.now = '2026-08-28T12:11:00.000Z' }, 'snapshot_expired'],
    ['source_drift', (input) => { input.snapshot.source_digest = digest('a') }, 'source_pin_mismatch'],
    ['vector_drift', (input) => { input.snapshot.member_vector_digest = digest('a') }, 'member_vector_pin_mismatch'],
    ['merge_group_as_pr_head', (input) => {
      input.member_vector[0].head_sha = input.snapshot.merge_group_sha
      input.snapshot.member_vector_digest = digestCanonical(input.member_vector)
    }, 'merge_group_sha_impersonation'],
  ]
  for (const [name, mutate, reason] of cases) {
    const input = queueSnapshot()
    mutate(input)
    assert.deepEqual(observeMergeQueueSnapshot(input), {
      phase: 'HELD',
      internal_state: 'HELD_QUEUE_CAPABILITY',
      reason,
    }, name)
  }
  const injected = queueSnapshot()
  injected.claimed_deployed_sha = injected.snapshot.merge_group_sha
  assert.equal(observeMergeQueueSnapshot(injected).internal_state, 'HELD_QUEUE_CAPABILITY')
})

test('Task7B P1-B1 — queue parsers hold private, unknown, throwing, duplicate, and unproven-101 evidence', () => {
  const unknown = queueSnapshot()
  unknown.snapshot.state = 'unknown'
  const privateInput = queueSnapshot()
  privateInput.source.token = 'redacted'
  for (const input of [unknown, privateInput]) {
    const outcome = observeMergeQueueSnapshot(input)
    assert.equal(outcome.phase, 'HELD')
    assert.equal(outcome.internal_state, 'HELD_QUEUE_CAPABILITY')
  }

  const throwing = {}
  Object.defineProperties(throwing, {
    now: { enumerable: true, value: NOW },
    source: { enumerable: true, value: source() },
    snapshot: { enumerable: true, get: () => { throw new Error('hostile getter') } },
    member_vector: { enumerable: true, value: memberVector() },
  })
  assert.doesNotThrow(() => observeMergeQueueSnapshot(throwing))
  assert.equal(observeMergeQueueSnapshot(throwing).phase, 'HELD')

  const pending99 = Array.from({ length: 99 }, (_, index) => tuple(`pending-${index}`))
  const incoming = tuple('candidate-100')
  const unproven101 = reconcileQueueCapacity({
    policy: queuePolicy(),
    running: [],
    pending: pending99,
    incoming,
    cancellation: {
      reason: 'queue_capacity_exhausted',
      ...incoming,
      pending_before: 99,
      pending_limit: 100,
      incoming_position: 101,
    },
  })
  assert.equal(unproven101.phase, 'HELD')
  assert.equal(reconcileQueueCapacity({
    policy: queuePolicy(),
    running: [],
    pending: [incoming],
    incoming,
    cancellation: null,
  }).internal_state, 'HELD_QUEUE_CAPABILITY')

  const previous = observeMergeQueueSnapshot(queueSnapshot()).observation
  const next = {
    source: structuredClone(previous.source),
    snapshot: {
      ...previous.snapshot,
      snapshot_id: 'snapshot-queue-next',
      snapshot_generation: 2,
      observed_at: '2026-08-28T12:01:00.000Z',
      expires_at: '2026-08-28T12:11:00.000Z',
      state: 'unknown',
    },
    member_vector: structuredClone(previous.member_vector),
  }
  assert.equal(invalidateMergeQueueSnapshot({ previous, next }).phase, 'HELD')

  const rebuiltSameVector = {
    source: structuredClone(previous.source),
    snapshot: {
      ...previous.snapshot,
      snapshot_id: 'snapshot-queue-rebuilt-same-vector',
      snapshot_generation: 2,
      observed_at: '2026-08-28T12:01:00.000Z',
      expires_at: '2026-08-28T12:11:00.000Z',
    },
    member_vector: structuredClone(previous.member_vector),
  }
  assert.equal(invalidateMergeQueueSnapshot({ previous, next: rebuiltSameVector }).phase, 'INVALIDATED')
})

test('AC-30 / Task7B P1-B — shared queue policy uses a closed interpolation allowlist', () => {
  assert.deepEqual(validateQueueConcurrencyPolicy(queuePolicy()), {
    phase: 'OBSERVED',
    internal_state: 'QUEUE_CONCURRENCY_VALIDATED',
  })
  for (const [name, policy] of [
    ['cancel', queuePolicy({ cancel_in_progress: true })],
    ['single', queuePolicy({ queue: 'single' })],
    ['candidate', queuePolicy({ group: '${{ github.workflow }}-${{ github.event.pull_request.number }}-shared-resource-ci' })],
    ['event', queuePolicy({ group: '${{ github.workflow }}-${{ github.event_name }}-shared-resource-ci' })],
    ['ref', queuePolicy({ group: '${{ github.workflow }}-${{ github.ref }}-shared-resource-ci' })],
    ['sha', queuePolicy({ group: '${{ github.workflow }}-${{ github.sha }}-shared-resource-ci' })],
    ['run', queuePolicy({ group: '${{ github.workflow }}-${{ github.run_id }}-shared-resource-ci' })],
    ['candidate_text', queuePolicy({ group: '${{ github.workflow }}-candidate-shared-resource-ci' })],
    ['candidate_resource', queuePolicy({ resource_key: 'candidate', group: '${{ github.workflow }}-candidate' })],
    ['merge_group', queuePolicy({ group: '${{ github.workflow }}-${{ github.event.merge_group.head_sha }}-shared-resource-ci' })],
    ['missing_workflow', queuePolicy({ workflow: '' })],
    ['missing_resource', queuePolicy({ resource_key: '' })],
    ['missing_group_resource', queuePolicy({ group: '${{ github.workflow }}-other-resource' })],
  ]) {
    assert.equal(validateQueueConcurrencyPolicy(policy).internal_state, 'HELD_QUEUE_CAPABILITY', name)
  }
})

test('Task7B P1-C — CI keeps merge_group base immutable without acquiring queue authority', async () => {
  const workflow = await readFile(new URL('../../../.github/workflows/ci.yml', import.meta.url), 'utf8')
  assert.match(workflow, /^\s{2}merge_group:\r?\n\s{4}types: \[checks_requested\]/mu)
  assert.match(workflow, /^concurrency:\r?\n\s{2}group: \$\{\{ github\.workflow \}\}-\$\{\{ github\.ref \}\}-\$\{\{ github\.event\.action == 'edited' && github\.event\.changes\.base == null && 'metadata-only' \|\| 'verification' \}\}\r?\n\s{2}cancel-in-progress: true$/mu)
  assert.doesNotMatch(workflow, /^\s+queue:\s*max\s*$/mu)
  assert.doesNotMatch(workflow, /^\s+cancel-in-progress:\s*false\s*$/mu)
  assert.match(workflow, /MERGE_GROUP_BASE_SHA:\s*\$\{\{ github\.event\.merge_group\.base_sha \}\}/u)
  assert.match(workflow, /elif \[ "\$EVENT_NAME" = "merge_group" \]; then/u)
  assert.match(workflow, /base_sha="\$MERGE_GROUP_BASE_SHA"/u)
  assert.match(workflow, /merge_group immutable base SHA is missing or invalid/u)
  assert.match(workflow, /TRUSTED_BASE_SHA:\s*\$\{\{ needs\.changes\.outputs\.base_sha \}\}/u)
  assert.match(workflow, /merge_group requires an immutable trusted base SHA/u)
  assert.doesNotMatch(workflow, /base_sha=['"]?\$\{\{ github\.event\.pull_request\.head\.sha/u)
})

test('AC-41 — queue max preserves one running plus pending candidates and fails closed on the cancelled 101st tuple', () => {
  const preservation = reconcileQueueCapacity({
    policy: queuePolicy(),
    running: [tuple('running')],
    pending: [tuple('pending-one'), tuple('pending-two')],
  })
  assert.deepEqual(preservation, {
    phase: 'OBSERVED',
    internal_state: 'QUEUE_CAPACITY_OBSERVED',
    running: [tuple('running')],
    pending: [tuple('pending-one'), tuple('pending-two')],
  })

  const pending = Array.from({ length: 100 }, (_, index) => tuple(`pending-${index}`))
  const incoming = tuple('one-hundred-one')
  const cancelled = reconcileQueueCapacity({
    policy: queuePolicy(),
    running: [tuple('running')],
    pending,
    incoming,
    cancellation: {
      reason: 'queue_capacity_exhausted',
      ...incoming,
      pending_before: 100,
      pending_limit: 100,
      incoming_position: 101,
    },
  })
  assert.deepEqual(cancelled, {
    phase: 'OBSERVED',
    internal_state: 'QUEUE_CAPACITY_CANCELLED',
    cancelled: incoming,
  })
  for (const cancellation of [
    undefined,
    { reason: 'queue_capacity_exhausted', ...tuple('mismatch'), pending_before: 100, pending_limit: 100, incoming_position: 101 },
    { reason: 'queue_capacity_exhausted', ...incoming, pending_before: 99, pending_limit: 100, incoming_position: 101 },
  ]) {
    const result = reconcileQueueCapacity({
      policy: queuePolicy(),
      running: [tuple('running')],
      pending,
      incoming,
      ...(cancellation ? { cancellation } : {}),
    })
    assert.equal(result.phase, 'HELD')
    assert.equal(result.internal_state, 'HELD_QUEUE_CAPABILITY')
    assert.doesNotMatch(JSON.stringify(result), /(?:PENDING|PASS|DELIVERED)/u)
  }
})

test('AC-41 — rebuilds invalidate prior merge-group membership and this observer exposes no queue or delivery effects', async () => {
  const previous = observeMergeQueueSnapshot(queueSnapshot()).observation
  const rebuilt = {
    source: structuredClone(previous.source),
    snapshot: {
      ...previous.snapshot,
      snapshot_id: 'snapshot-queue-two',
      snapshot_generation: 2,
      observed_at: '2026-08-28T12:01:00.000Z',
      expires_at: '2026-08-28T12:11:00.000Z',
      merge_group_sha: sha('d'),
    },
    member_vector: structuredClone(previous.member_vector),
  }
  assert.deepEqual(invalidateMergeQueueSnapshot({ previous, next: rebuilt }), {
    phase: 'INVALIDATED',
    internal_state: 'QUEUE_SNAPSHOT_INVALIDATED',
    previous_snapshot_id: 'snapshot-queue-one',
    next_snapshot_id: 'snapshot-queue-two',
  })

  const source = await readFile(new URL('../../lib/parallel-delivery-fabric-queue.mjs', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /(?:child_process|fetch\(|enqueue|dequeue|publish(?:Check)?|\bmerge\(|\bdeploy\()/iu)
})
