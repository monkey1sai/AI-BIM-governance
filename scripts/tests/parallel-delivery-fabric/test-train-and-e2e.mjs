import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import { digestCanonical } from '../../lib/parallel-delivery-fabric-contract.mjs'
import { trustedPinsAuthorityDigest } from '../../lib/parallel-delivery-fabric-e2e-binder.mjs'

import {
  bindBrowserEvidence,
  classifyE2EApplicability,
  createIntegrationTrain,
  evaluateRuntimeAdmission,
} from '../../lib/parallel-delivery-fabric-e2e-binder.mjs'

const SHA1 = character => character.repeat(40)
const SHA256 = character => character.repeat(64)
const BASE = SHA1('a')
const HEAD_A = SHA1('b')
const HEAD_B = SHA1('c')
const TREE = SHA256('d')
const MANIFEST = SHA256('e')
const RUNTIME = SHA256('f')
const PATH = SHA256('1')
const TRUSTED = SHA256('2')
const BINDER = SHA256('3')
const TRACE = SHA256('4')
const SCREENSHOT = SHA256('5')
const ALLOCATOR = SHA256('7')
const POLICY_SOURCE_SHA = SHA1('8')
const POLICY_RECORD = SHA256('9')
const AUTHORITY = SHA256('a')
const LISTENER = SHA256('b')
const NOW = '2026-08-29T01:00:00.000Z'
const LATER = '2026-08-29T02:00:00.000Z'
const TRAIN_CLOCK = Object.freeze({ now: NOW })
const sha256Text = value => createHash('sha256').update(value, 'utf8').digest('hex')

const trainPlan = (overrides = {}) => ({
  plan_id: 'plan:train',
  generation: 3,
  baseline_ref: 'origin/main',
  resolved_baseline_sha: BASE,
  integration_base_ref: 'origin/main',
  integration_base_sha: BASE,
  candidate_heads: [HEAD_A, HEAD_B],
  dependency_edges: [{ from: 'task:a', to: 'task:b' }],
  synthetic_integration_sha: SHA1('7'),
  runtime_manifest_digest: MANIFEST,
  checks_digest: SHA256('8'),
  created_at: NOW,
  expires_at: LATER,
  ...overrides,
})

const trustedPolicy = (overrides = {}) => ({
  source: 'base',
  source_ref: 'origin/main',
  source_sha: POLICY_SOURCE_SHA,
  base_sha: BASE,
  policy_digest: SHA256('9'),
  record_digest: POLICY_RECORD,
  immutable: true,
  base_pinned: true,
  fresh: true,
  version: 'e2e-policy/v1',
  ...overrides,
})

const applicabilityRecord = (overrides = {}) => {
  const record = {
    schema_version: 'e2e-applicability/v1',
    source: 'base',
    source_ref: 'ref:e2e-policy',
    source_sha: POLICY_SOURCE_SHA,
    base_sha: BASE,
    policy_digest: SHA256('9'),
    e2e_required: true,
    immutable: true,
    base_pinned: true,
    fresh: true,
    ...overrides,
  }
  return { ...record, record_digest: digestCanonical(record) }
}

const manifest = (overrides = {}) => ({
  schema_version: 'isolated-branch-stack/v1',
  stack_kind: 'isolated_branch_stack',
  change_id: 'change-a',
  run_id: 'run-a',
  head_sha: HEAD_A,
  manifest_sha256: MANIFEST,
  manifest_sha256_at_start: MANIFEST,
  manifest_sha256_at_publication: MANIFEST,
  manifest_path_digest: SHA256('a'),
  offset: 0,
  ports: { coordinator: 8005, governance: 49103, viewer: 5180 },
  base_urls: {
    coordinator: 'http://127.0.0.1:8005',
    governance: 'http://127.0.0.1:49103',
    viewer: 'http://127.0.0.1:5180',
  },
  branch: 'codex/task-a',
  worktree_id: 'worktree:a',
  worktree_path_digest: PATH,
  tree_digest: TREE,
  runtime_identity_digest: RUNTIME,
  execution_window: { started_at: NOW, finished_at: LATER },
  started_at: NOW,
  ...overrides,
})

const candidate = (overrides = {}) => ({
  candidate_id: 'candidate:a',
  head_sha: HEAD_A,
  tree_digest: TREE,
  branch: 'codex/task-a',
  worktree_id: 'worktree:a',
  worktree_path_digest: PATH,
  manifest_sha256: MANIFEST,
  manifest_path_digest: SHA256('a'),
  runtime_identity_digest: RUNTIME,
  base_sha: BASE,
  owner_session: 'writer:candidate',
  applicability: applicabilityRecord(),
  harness_modified: false,
  ...overrides,
})

const commandRecord = (role, overrides = {}) => ({
  role,
  cwd_digest: SHA256('c'),
  argv_digest: SHA256('d'),
  safe_environment_contract: 'e2e-require-real/v1',
  started_at: NOW,
  finished_at: LATER,
  exit_code: 0,
  stdout_artifact_ref: 'artifact:stdout',
  stderr_artifact_ref: 'artifact:stderr',
  redaction_status: 'sanitized',
  ...overrides,
})

const minutesAfterNow = (minutes) => new Date(Date.parse(NOW) + minutes * 60_000).toISOString()
const COMMAND_LIFECYCLE = Object.freeze({
  git_preflight: [0, 5], stack_start: [5, 10], stack_status: [10, 12],
  playwright_require_real: [12, 30], computer_use: [12, 35], postflight: [35, 40],
})
const commandRecords = () => Object.entries(COMMAND_LIFECYCLE).map(([role, [start, finish]]) => commandRecord(role, {
  started_at: minutesAfterNow(start), finished_at: minutesAfterNow(finish),
}))
const COMMANDS = digestCanonical(commandRecords())
// Trusted canonical runner pins: every role's cwd/argv/environment contract.
const commandPins = (overrides = {}) => Object.fromEntries(Object.keys(COMMAND_LIFECYCLE).map((role) => [role, {
  cwd_digest: SHA256('c'), argv_digest: SHA256('d'), environment_contract: 'e2e-require-real/v1', ...(overrides[role] ?? {}),
}]))

const computerUseAuthority = (overrides = {}) => ({
  schema_version: 'computer-use-authority/v1',
  source: 'prior-trusted',
  source_ref: 'ref:e2e-policy',
  source_sha: POLICY_SOURCE_SHA,
  base_sha: BASE,
  authority_digest: trustedPins().authority_digest,
  verifier_identity: 'computer-use:one',
  immutable: true,
  base_pinned: true,
  fresh: true,
  read_only: true,
  can_edit: false,
  can_push: false,
  can_resolve: false,
  can_publish_required_check: false,
  can_approve: false,
  can_merge: false,
  can_deploy: false,
  ...overrides,
})

const browserPacket = (role, overrides = {}) => ({
  verifier_role: role,
  verifier_identity: role === 'computer_use' ? 'computer-use:one' : 'playwright:canonical',
  status: 'passed',
  e2e_require_real: '1',
  skipped: false,
  manifest_present: true,
  timed_out: false,
  manifest_path_digest: SHA256('a'),
  manifest_sha256: MANIFEST,
  manifest_sha256_at_start: MANIFEST,
  manifest_sha256_at_publication: MANIFEST,
  stack_kind: 'isolated_branch_stack',
  head_sha: HEAD_A,
  tree_digest: TREE,
  runtime_identity_digest: RUNTIME,
  branch: 'codex/task-a',
  worktree_id: 'worktree:a',
  worktree_path_digest: PATH,
  offset: 0,
  ports: { coordinator: 8005, governance: 49103, viewer: 5180 },
  base_urls: {
    coordinator: 'http://127.0.0.1:8005',
    governance: 'http://127.0.0.1:49103',
    viewer: 'http://127.0.0.1:5180',
  },
  trusted_verifier_sha: TRUSTED,
  trusted_binder_sha: BINDER,
  verifier_tree_digest: TRUSTED,
  harness_digest: TRUSTED,
  candidate_harness_status: 'unchanged',
  verification_mode: 'canonical',
  reserved_port_guard: 'clean',
  listener_digest: LISTENER,
  route: '#conv',
  main_buttons: ['Upload IFC'],
  fixture: 'fixture:ifc-ready',
  api: 'api:ifc-ready',
  runtime_id: 'runtime:conversion-1',
  visible_state: 'state:success',
  network_result: 'network:ok',
  trace_sha256: TRACE,
  screenshot_sha256: SCREENSHOT,
  command_records_digest: COMMANDS,
  runtime_lineage_digest: RUNTIME,
  command_records: commandRecords(),
  execution_window: { started_at: NOW, finished_at: LATER },
  ...(role === 'computer_use' ? { authority: computerUseAuthority() } : {}),
  ...overrides,
})

// The base-owned expected user flow: the binder pins the exercised flow to this.
const expectedFlow = (overrides = {}) => ({
  route: '#conv', main_buttons: ['Upload IFC'], fixture: 'fixture:ifc-ready', api: 'api:ifc-ready',
  runtime_id: 'runtime:conversion-1', visible_state: 'state:success', ...overrides,
})

// The authority digest is derived from the complete pin map, so a fixture that
// overrides any pin re-derives it unless the test pins the digest on purpose.
const trustedPins = (overrides = {}) => {
  const pins = {
    source: 'prior-trusted',
    source_ref: 'ref:e2e-policy',
    source_sha: POLICY_SOURCE_SHA,
    base_sha: BASE,
    policy_digest: SHA256('9'),
    applicability_record_digest: applicabilityRecord().record_digest,
    immutable: true,
    base_pinned: true,
    fresh: true,
    verifier_sha: TRUSTED,
    binder_sha: BINDER,
    verifier_tree_digest: TRUSTED,
    harness_digest: TRUSTED,
    command_pins: commandPins(),
    expected_flow: expectedFlow(),
    ...overrides,
  }
  return { ...pins, authority_digest: overrides.authority_digest ?? trustedPinsAuthorityDigest(pins) }
}

const runtimeIdentity = (overrides = {}) => ({
  offset: 0,
  offset_source: 'registry',
  offset_binding_digest: ALLOCATOR,
  ports: manifest().ports,
  base_urls: manifest().base_urls,
  manifest_sha256: MANIFEST,
  tree_digest: TREE,
  branch: 'codex/task-a',
  worktree_id: 'worktree:a',
  worktree_path_digest: PATH,
  runtime_identity_digest: RUNTIME,
  ...overrides,
})

const runtimeIdentityForOffset = (offset, overrides = {}) => {
  const ports = { coordinator: 8005 + offset, governance: 49103 + offset, viewer: 5180 + offset }
  return runtimeIdentity({
    offset,
    ports,
    base_urls: {
      coordinator: `http://127.0.0.1:${ports.coordinator}`,
      governance: `http://127.0.0.1:${ports.governance}`,
      viewer: `http://127.0.0.1:${ports.viewer}`,
    },
    ...overrides,
  })
}

const runtimeRequest = (overrides = {}) => ({
  kind: 'integration_train',
  ...runtimeIdentity(),
  ...overrides,
})

const runtimeRequestAtOffset = (kind, offset, overrides = {}) => ({
  kind,
  ...runtimeIdentityForOffset(offset),
  ...overrides,
})

const runtimeSnapshot = (overrides = {}) => ({
  runtime_cap: 3,
  writer_cap: 2,
  leases: [],
  runtime_identity: runtimeIdentity(),
  ...overrides,
})

const runtimeLease = (kind, offset, overrides = {}) => ({
  kind,
  state: 'ACTIVE',
  offset,
  ...overrides,
})

const trainReleaseReconcile = (overrides = {}) => ({
  lease_id: 'lease:train',
  status: 'RELEASED',
  retention_state: 'RETAINED_FOR_REVIEW',
  observed_at: LATER,
  ...overrides,
})

const zeroEffectPorts = () => ({
  filesystem: 0,
  git: 0,
  network: 0,
  process: 0,
  provider: 0,
  github: 0,
  deploy: 0,
  cleanup: 0,
  promotion: 0,
})

const runtimeCapacityState = (leases, overrides = {}) => runtimeSnapshot({
  leases,
  effects: zeroEffectPorts(),
  ...overrides,
})

const without = (value, key) => {
  const copy = { ...value }
  delete copy[key]
  return copy
}

const withPrototypeProperty = (key, descriptor, callback) => {
  const previous = Object.getOwnPropertyDescriptor(Object.prototype, key)
  Object.defineProperty(Object.prototype, key, descriptor)
  try {
    return callback()
  } finally {
    if (previous) Object.defineProperty(Object.prototype, key, previous)
    else delete Object.prototype[key]
  }
}

const withPrototypeLeaseId = (descriptor, callback) => withPrototypeProperty('lease_id', descriptor, callback)

const trappedProxy = (value, counts) => new Proxy(value, {
  get(target, key, receiver) {
    counts.get += 1
    return Reflect.get(target, key, receiver)
  },
  ownKeys(target) {
    counts.ownKeys += 1
    return Reflect.ownKeys(target)
  },
  getOwnPropertyDescriptor(target, key) {
    counts.getOwnPropertyDescriptor += 1
    return Reflect.getOwnPropertyDescriptor(target, key)
  },
  getPrototypeOf(target) {
    counts.getPrototypeOf += 1
    return Reflect.getPrototypeOf(target)
  },
})

test('AC-21 — integration train freezes exact base and ordered candidate SHAs', () => {
  const planned = createIntegrationTrain(trainPlan(), TRAIN_CLOCK)
  assert.equal(planned.phase, 'READY_FOR_TRAIN')
  // The committed integration-train schema caps candidate heads at 64.
  const tooMany = createIntegrationTrain(trainPlan({ candidate_heads: Array.from({ length: 65 }, (_unused, index) => index.toString(16).padStart(40, '0')) }), TRAIN_CLOCK)
  assert.equal(tooMany.reason, 'CANDIDATE_LIMIT_EXCEEDED')
  assert.equal(planned.internal_state, 'TRAIN_REQUEST_READY')
  assert.equal(planned.train.integration_base_ref, 'origin/main')
  assert.equal(planned.train.integration_base_sha, BASE)
  assert.deepEqual(planned.train.candidate_heads, [HEAD_A, HEAD_B])
  assert.equal(planned.merge_candidate, false)
  assert.equal(planned.deploy_candidate, false)
  assert.equal(Object.isFrozen(planned), true)
  assert.equal(Object.isFrozen(planned.train), true)
})

test('train base, ordered inputs, and synthetic result drift fail closed and never become merge/deploy candidates', () => {
  const baseDrift = createIntegrationTrain(trainPlan({ observed_base_sha: SHA1('0') }), TRAIN_CLOCK)
  assert.equal(baseDrift.phase, 'CLOSED')
  assert.equal(baseDrift.internal_state, 'TRAIN_EVIDENCE_INVALID')
  assert.equal(baseDrift.reason, 'BASE_SHA_DRIFT')
  const inputDrift = createIntegrationTrain(trainPlan({ observed_candidate_heads: [HEAD_B, HEAD_A] }), TRAIN_CLOCK)
  assert.equal(inputDrift.reason, 'ORDERED_INPUT_SHA_DRIFT')
  const syntheticDrift = createIntegrationTrain(trainPlan({ observed_synthetic_integration_sha: SHA1('0') }), TRAIN_CLOCK)
  assert.equal(syntheticDrift.reason, 'SYNTHETIC_SHA_DRIFT')
  const manifestDrift = createIntegrationTrain(trainPlan({ observed_runtime_manifest_digest: SHA256('0') }), TRAIN_CLOCK)
  assert.equal(manifestDrift.reason, 'RUNTIME_MANIFEST_DRIFT')
  const candidateTrain = createIntegrationTrain(trainPlan({ is_merge_candidate: true }), TRAIN_CLOCK)
  assert.equal(candidateTrain.phase, 'CLOSED')
  assert.equal(candidateTrain.reason, 'TRAIN_NOT_PROMOTION_SOURCE')
})

test('integration train requires an explicit active authority window and trusted current time', () => {
  for (const missing of ['created_at', 'expires_at']) {
    const plan = trainPlan()
    delete plan[missing]
    assert.equal(createIntegrationTrain(plan, TRAIN_CLOCK).reason, 'TRAIN_WINDOW_INVALID', missing)
  }
  assert.equal(createIntegrationTrain(trainPlan(), undefined).reason, 'TRAIN_WINDOW_INVALID')
  assert.equal(createIntegrationTrain(trainPlan({ expires_at: NOW }), TRAIN_CLOCK).reason, 'TRAIN_WINDOW_INVALID')
  assert.equal(createIntegrationTrain(trainPlan({ created_at: LATER, expires_at: '2026-08-29T03:00:00.000Z' }), TRAIN_CLOCK).reason, 'TRAIN_WINDOW_INVALID')
  let reads = 0
  const hostileClock = {}
  Object.defineProperty(hostileClock, 'now', { enumerable: true, get: () => { reads += 1; return reads === 1 ? NOW : undefined } })
  assert.equal(createIntegrationTrain(trainPlan(), hostileClock).reason, 'TRAIN_WINDOW_INVALID')
  assert.equal(reads, 0)
  assert.equal(createIntegrationTrain(trainPlan(), new Proxy({ now: NOW }, {})).reason, 'TRAIN_WINDOW_INVALID')
})

test('runtime admission allows two writers plus one train or Computer Use, but never both shared slots', () => {
  const writers = [
    { kind: 'writer', state: 'ACTIVE', offset: 1, runtime_identity: 'runtime:writer-a' },
    { kind: 'writer', state: 'ACTIVE', offset: 2, runtime_identity: 'runtime:writer-b' },
  ]
  assert.equal(evaluateRuntimeAdmission(runtimeSnapshot({ leases: writers }), runtimeRequest({ kind: 'integration_train' })).status, 'ADMITTED')
  assert.equal(evaluateRuntimeAdmission(runtimeSnapshot({ leases: writers }), runtimeRequest({ kind: 'computer_use' })).status, 'ADMITTED')
  const train = evaluateRuntimeAdmission(runtimeSnapshot({ leases: [...writers, { kind: 'integration_train', state: 'ACTIVE', offset: 3 }] }), runtimeRequest({ kind: 'computer_use' }))
  assert.equal(train.status, 'QUEUED_FOR_LEASE')
  assert.equal(train.reason, 'SHARED_RUNTIME_SLOT_OCCUPIED')
  const thirdWriter = evaluateRuntimeAdmission(runtimeSnapshot({ leases: writers }), runtimeRequest({ kind: 'writer' }))
  assert.equal(thirdWriter.status, 'QUEUED_FOR_LEASE')
  assert.equal(thirdWriter.reason, 'WRITER_CAPACITY')
})

test('runtime capacity state holds an unauthenticated train release/reconcile record without changing the shared slot', () => {
  const effects = zeroEffectPorts()
  const occupied = runtimeCapacityState([
    runtimeLease('writer', 1, { runtime_identity: 'runtime:writer-a' }),
    runtimeLease('writer', 2, { runtime_identity: 'runtime:writer-b' }),
    runtimeLease('integration_train', 3, { lease_id: 'lease:train', runtime_identity: 'runtime:train' }),
  ], { effects })
  const queued = evaluateRuntimeAdmission(occupied, runtimeRequest({ kind: 'computer_use' }))

  assert.equal(occupied.runtime_cap, 3)
  assert.equal(occupied.writer_cap, 2)
  assert.equal(queued.status, 'QUEUED_FOR_LEASE')
  assert.equal(queued.reason, 'SHARED_RUNTIME_SLOT_OCCUPIED')

  // The four-field release/reconcile record has no authority, CAS, or source
  // pin, so it must never release a live train or mutate the admission state.
  const released = runtimeCapacityState([
    runtimeLease('writer', 1, { runtime_identity: 'runtime:writer-a' }),
    runtimeLease('writer', 2, { runtime_identity: 'runtime:writer-b' }),
    runtimeLease('integration_train', 3, { lease_id: 'lease:train', runtime_identity: 'runtime:train' }),
  ], {
    effects,
    runtime_identity: runtimeIdentityForOffset(3),
    train_release_reconcile: trainReleaseReconcile(),
  })
  const releasedBeforeAdmission = structuredClone(released)
  const thirdWriter = evaluateRuntimeAdmission(released, runtimeRequestAtOffset('writer', 3))
  const nextShared = evaluateRuntimeAdmission(released, runtimeRequestAtOffset('computer_use', 3))

  assert.equal(thirdWriter.status, 'HELD_RUNTIME')
  assert.equal(thirdWriter.reason, 'TRAIN_RELEASE_AUTHORITY_REQUIRED')
  assert.equal(nextShared.status, 'HELD_RUNTIME')
  assert.equal(nextShared.reason, 'TRAIN_RELEASE_AUTHORITY_REQUIRED')
  assert.equal(released.writer_cap, 2)
  assert.deepEqual(released, releasedBeforeAdmission)
  assert.deepEqual(effects, zeroEffectPorts())
  assert.deepEqual(released.effects, zeroEffectPorts())
})

test('runtime train release/reconcile rejects malformed and hostile targets without effects', () => {
  const writers = [
    runtimeLease('writer', 1, { lease_id: 'lease:writer-a', runtime_identity: 'runtime:writer-a' }),
    runtimeLease('writer', 2, { lease_id: 'lease:writer-b', runtime_identity: 'runtime:writer-b' }),
  ]
  const train = runtimeLease('integration_train', 3, { lease_id: 'lease:train', runtime_identity: 'runtime:train' })
  const validRecord = trainReleaseReconcile()
  const cases = [
    ['missing lease id', without(validRecord, 'lease_id'), [...writers, train], 'TRAIN_RELEASE_RECONCILE_INVALID'],
    ['extra record key', { ...validRecord, extra: true }, [...writers, train], 'TRAIN_RELEASE_RECONCILE_INVALID'],
    ['status drift', { ...validRecord, status: 'RECONCILED' }, [...writers, train], 'TRAIN_RELEASE_RECONCILE_INVALID'],
    ['retention drift', { ...validRecord, retention_state: 'PURGED' }, [...writers, train], 'TRAIN_RELEASE_RECONCILE_INVALID'],
    ['noncanonical observed timestamp', { ...validRecord, observed_at: '2026-08-29T02:00:00Z' }, [...writers, train], 'TRAIN_RELEASE_RECONCILE_INVALID'],
    ['malformed lease id', { ...validRecord, lease_id: 'lease train' }, [...writers, train], 'TRAIN_RELEASE_RECONCILE_INVALID'],
    ['writer target', { ...validRecord, lease_id: 'lease:writer-a' }, [...writers, train], 'TRAIN_RELEASE_AUTHORITY_REQUIRED'],
    ['unknown target', { ...validRecord, lease_id: 'lease:unknown' }, [...writers, runtimeLease('unknown', 3, { lease_id: 'lease:unknown' })], 'TRAIN_RELEASE_AUTHORITY_REQUIRED'],
    ['ambiguous lease kind aliases', validRecord, [...writers, runtimeLease('writer', 3, { lease_id: 'lease:train', runtime_kind: 'integration_train' })], 'TRAIN_RELEASE_AUTHORITY_REQUIRED'],
    ['undefined lease kind alias', validRecord, [...writers, runtimeLease('integration_train', 3, { lease_id: 'lease:train', runtime_kind: undefined })], 'RUNTIME_ADMISSION_INPUT_INVALID'],
    ['train lease missing own id', validRecord, [...writers, runtimeLease('integration_train', 3)], 'TRAIN_RELEASE_AUTHORITY_REQUIRED'],
    ['train lease undefined id', validRecord, [...writers, runtimeLease('integration_train', 3, { lease_id: undefined })], 'RUNTIME_ADMISSION_INPUT_INVALID'],
    ['train lease forged id', validRecord, [...writers, runtimeLease('integration_train', 3, { lease_id: 'lease train' })], 'TRAIN_RELEASE_AUTHORITY_REQUIRED'],
    ['nonactive train target', validRecord, [...writers, { ...train, state: 'RELEASED' }], 'TRAIN_RELEASE_AUTHORITY_REQUIRED'],
    ['missing train target', validRecord, writers, 'TRAIN_RELEASE_AUTHORITY_REQUIRED'],
    ['duplicate train target', validRecord, [...writers, train, runtimeLease('integration_train', 4, { lease_id: 'lease:train' })], 'TRAIN_RELEASE_AUTHORITY_REQUIRED'],
  ]

  for (const [label, record, leases, reason] of cases) {
    const effects = zeroEffectPorts()
    const state = runtimeCapacityState(leases, { effects, train_release_reconcile: record })
    const before = structuredClone(state)
    const result = evaluateRuntimeAdmission(state, runtimeRequest())
    assert.equal(result.status, 'HELD_RUNTIME', label)
    assert.equal(result.reason, reason, label)
    assert.deepEqual(state, before, label)
    assert.deepEqual(effects, zeroEffectPorts(), label)
    assert.deepEqual(state.effects, zeroEffectPorts(), label)
  }

  const ambiguousRequest = evaluateRuntimeAdmission(runtimeSnapshot(), runtimeRequest({ kind: 'computer_use', runtime_kind: 'writer' }))
  assert.equal(ambiguousRequest.status, 'HELD_RUNTIME')
  assert.equal(ambiguousRequest.reason, 'RUNTIME_KIND_ALIAS_INVALID')
  const undefinedAliasRequest = evaluateRuntimeAdmission(runtimeSnapshot(), runtimeRequest({ kind: 'computer_use', runtime_kind: undefined }))
  assert.equal(undefinedAliasRequest.status, 'HELD_RUNTIME')
  assert.equal(undefinedAliasRequest.reason, 'RUNTIME_ADMISSION_INPUT_INVALID')

  const legacyOnlyRequest = evaluateRuntimeAdmission(
    runtimeSnapshot(),
    without(runtimeRequest({ runtime_kind: 'computer_use' }), 'kind'),
  )
  assert.equal(legacyOnlyRequest.status, 'HELD_RUNTIME')
  assert.equal(legacyOnlyRequest.reason, 'RUNTIME_KIND_ALIAS_INVALID')

  for (const alias of ['runtime_kind', 'runtime_role', 'role', 'lease_kind']) {
    const state = runtimeCapacityState([runtimeLease('writer', 1, { [alias]: 'writer' })])
    const result = evaluateRuntimeAdmission(state, runtimeRequest({ kind: 'computer_use' }))
    assert.equal(result.status, 'HELD_RUNTIME', alias)
    assert.equal(result.reason, 'ACTIVE_RUNTIME_KIND_ALIAS_INVALID', alias)
  }

  const stateGetterEffects = zeroEffectPorts()
  const stateGetterLease = runtimeLease('integration_train', 3, { lease_id: 'lease:train' })
  let stateGetterHits = 0
  Object.defineProperty(stateGetterLease, 'state', {
    configurable: true,
    enumerable: false,
    get() {
      stateGetterHits += 1
      return stateGetterHits === 1 ? 'ACTIVE' : 'RELEASED'
    },
  })
  const stateGetterState = runtimeCapacityState([...writers, stateGetterLease], {
    effects: stateGetterEffects,
    train_release_reconcile: validRecord,
  })
  let stateGetterResult
  assert.doesNotThrow(() => { stateGetterResult = evaluateRuntimeAdmission(stateGetterState, runtimeRequest()) })
  assert.equal(stateGetterResult.status, 'HELD_RUNTIME')
  assert.equal(stateGetterResult.reason, 'RUNTIME_ADMISSION_INPUT_INVALID')
  assert.equal(stateGetterHits, 0)
  assert.deepEqual(stateGetterEffects, zeroEffectPorts())
  assert.deepEqual(stateGetterState.effects, zeroEffectPorts())

  const leaseGetterEffects = zeroEffectPorts()
  const leaseGetter = runtimeLease('integration_train', 3)
  let leaseGetterHits = 0
  Object.defineProperty(leaseGetter, 'lease_id', {
    configurable: true,
    enumerable: true,
    get() {
      leaseGetterHits += 1
      throw new Error('lease id getter must not run')
    },
  })
  const leaseGetterState = runtimeCapacityState([leaseGetter], {
    effects: leaseGetterEffects,
    train_release_reconcile: validRecord,
  })
  let leaseGetterResult
  assert.doesNotThrow(() => { leaseGetterResult = evaluateRuntimeAdmission(leaseGetterState, runtimeRequest()) })
  assert.equal(leaseGetterResult.status, 'HELD_RUNTIME')
  assert.equal(leaseGetterResult.reason, 'RUNTIME_ADMISSION_INPUT_INVALID')
  assert.equal(leaseGetterHits, 0)
  assert.deepEqual(leaseGetterEffects, zeroEffectPorts())
  assert.deepEqual(leaseGetterState.effects, zeroEffectPorts())

  const nonEnumerableRecord = { ...validRecord }
  Object.defineProperty(nonEnumerableRecord, 'extra', {
    configurable: true,
    enumerable: false,
    value: true,
  })
  const nonEnumerableRecordEffects = zeroEffectPorts()
  const nonEnumerableRecordState = runtimeCapacityState([train], {
    effects: nonEnumerableRecordEffects,
    train_release_reconcile: nonEnumerableRecord,
  })
  const nonEnumerableRecordResult = evaluateRuntimeAdmission(nonEnumerableRecordState, runtimeRequest())
  assert.equal(nonEnumerableRecordResult.status, 'HELD_RUNTIME')
  assert.equal(nonEnumerableRecordResult.reason, 'RUNTIME_ADMISSION_INPUT_INVALID')
  assert.deepEqual(nonEnumerableRecordEffects, zeroEffectPorts())
  assert.deepEqual(nonEnumerableRecordState.effects, zeroEffectPorts())

  const symbolRecord = { ...validRecord }
  Object.defineProperty(symbolRecord, Symbol('extra'), { enumerable: true, value: true })
  const symbolRecordEffects = zeroEffectPorts()
  const symbolRecordState = runtimeCapacityState([train], {
    effects: symbolRecordEffects,
    train_release_reconcile: symbolRecord,
  })
  const symbolRecordResult = evaluateRuntimeAdmission(symbolRecordState, runtimeRequest())
  assert.equal(symbolRecordResult.status, 'HELD_RUNTIME')
  assert.equal(symbolRecordResult.reason, 'RUNTIME_ADMISSION_INPUT_INVALID')
  assert.deepEqual(symbolRecordEffects, zeroEffectPorts())
  assert.deepEqual(symbolRecordState.effects, zeroEffectPorts())

  const inheritedEffects = zeroEffectPorts()
  const inheritedState = runtimeCapacityState([...writers, runtimeLease('integration_train', 3)], {
    effects: inheritedEffects,
    train_release_reconcile: validRecord,
  })
  const inheritedBefore = structuredClone(inheritedState)
  withPrototypeLeaseId({
    configurable: true,
    enumerable: false,
    value: 'lease:train',
    writable: true,
  }, () => {
    const result = evaluateRuntimeAdmission(inheritedState, runtimeRequest())
    assert.equal(result.status, 'HELD_RUNTIME', 'inherited lease id cannot match')
    assert.equal(result.reason, 'TRAIN_RELEASE_AUTHORITY_REQUIRED')
    assert.deepEqual(inheritedState, inheritedBefore)
    assert.deepEqual(inheritedEffects, zeroEffectPorts())
    assert.deepEqual(inheritedState.effects, zeroEffectPorts())
  })

  const inheritedGetterEffects = zeroEffectPorts()
  const inheritedGetterState = runtimeCapacityState([...writers, runtimeLease('integration_train', 3)], {
    effects: inheritedGetterEffects,
    train_release_reconcile: validRecord,
  })
  let inheritedGetterHits = 0
  withPrototypeLeaseId({
    configurable: true,
    enumerable: false,
    get() {
      inheritedGetterHits += 1
      throw new Error('inherited lease id getter must not run')
    },
  }, () => {
    let result
    assert.doesNotThrow(() => { result = evaluateRuntimeAdmission(inheritedGetterState, runtimeRequest()) })
    assert.equal(result.status, 'HELD_RUNTIME')
    assert.equal(result.reason, 'TRAIN_RELEASE_AUTHORITY_REQUIRED')
  })
  assert.equal(inheritedGetterHits, 0)
  assert.deepEqual(inheritedGetterEffects, zeroEffectPorts())
  assert.deepEqual(inheritedGetterState.effects, zeroEffectPorts())

  const inheritedStateEffects = zeroEffectPorts()
  const inheritedStatePolluted = runtimeCapacityState([...writers, runtimeLease('integration_train', 3)], {
    effects: inheritedStateEffects,
  })
  let inheritedStateGetterHits = 0
  withPrototypeProperty('state', {
    configurable: true,
    enumerable: false,
    get() {
      inheritedStateGetterHits += 1
      return inheritedStateGetterHits === 1 ? 'ACTIVE' : 'RELEASED'
    },
  }, () => {
    let result
    assert.doesNotThrow(() => { result = evaluateRuntimeAdmission(inheritedStatePolluted, runtimeRequest()) })
    assert.equal(result.status, 'QUEUED_FOR_LEASE')
    assert.equal(result.reason, 'SHARED_RUNTIME_SLOT_OCCUPIED')
  })
  assert.equal(inheritedStateGetterHits, 0)
  assert.deepEqual(inheritedStateEffects, zeroEffectPorts())
  assert.deepEqual(inheritedStatePolluted.effects, zeroEffectPorts())

  const proxyCases = [
    ['snapshot proxy', (counts) => [trappedProxy(runtimeSnapshot(), counts), runtimeRequest()]],
    ['request proxy', (counts) => [runtimeSnapshot(), trappedProxy(runtimeRequest(), counts)]],
    ['lease proxy', (counts) => [runtimeCapacityState([trappedProxy(runtimeLease('integration_train', 3), counts)]), runtimeRequest()]],
    ['reconcile proxy', (counts) => [runtimeCapacityState([train], { train_release_reconcile: trappedProxy(validRecord, counts) }), runtimeRequest()]],
    ['lease alias proxy', (counts) => [runtimeSnapshot({ runtime_leases: trappedProxy([], counts) }), runtimeRequest()]],
  ]
  for (const [label, makeArguments] of proxyCases) {
    const counts = { get: 0, ownKeys: 0, getOwnPropertyDescriptor: 0, getPrototypeOf: 0 }
    const [snapshot, request] = makeArguments(counts)
    const result = evaluateRuntimeAdmission(snapshot, request)
    assert.equal(result.status, 'HELD_RUNTIME', label)
    assert.equal(result.reason, 'RUNTIME_ADMISSION_INPUT_INVALID', label)
    assert.deepEqual(counts, { get: 0, ownKeys: 0, getOwnPropertyDescriptor: 0, getPrototypeOf: 0 }, label)
  }

  const hiddenAliasState = runtimeSnapshot()
  Object.defineProperty(hiddenAliasState, 'active_leases', {
    configurable: true,
    enumerable: false,
    value: [...writers, train],
  })
  const hiddenAliasResult = evaluateRuntimeAdmission(hiddenAliasState, runtimeRequest())
  assert.equal(hiddenAliasResult.status, 'HELD_RUNTIME')
  assert.equal(hiddenAliasResult.reason, 'RUNTIME_ADMISSION_INPUT_INVALID')

  const aliasGetterState = runtimeSnapshot()
  let aliasGetterHits = 0
  Object.defineProperty(aliasGetterState, 'active_leases', {
    configurable: true,
    enumerable: true,
    get() {
      aliasGetterHits += 1
      throw new Error('lease alias getter must not run')
    },
  })
  let aliasGetterResult
  assert.doesNotThrow(() => { aliasGetterResult = evaluateRuntimeAdmission(aliasGetterState, runtimeRequest()) })
  assert.equal(aliasGetterResult.status, 'HELD_RUNTIME')
  assert.equal(aliasGetterResult.reason, 'RUNTIME_ADMISSION_INPUT_INVALID')
  assert.equal(aliasGetterHits, 0)

  const symbolAliasResult = evaluateRuntimeAdmission(
    runtimeSnapshot({ runtime_leases: Symbol('lease alias') }),
    runtimeRequest(),
  )
  assert.equal(symbolAliasResult.status, 'HELD_RUNTIME')
  assert.equal(symbolAliasResult.reason, 'RUNTIME_ADMISSION_INPUT_INVALID')

  const aliasConflictEffects = zeroEffectPorts()
  const aliasConflictState = runtimeCapacityState([...writers, train], {
    effects: aliasConflictEffects,
    leases: [],
    runtime_leases: [],
    active_leases: [...writers, train],
  })
  const aliasConflictBefore = structuredClone(aliasConflictState)
  const aliasConflict = evaluateRuntimeAdmission(aliasConflictState, runtimeRequest({ kind: 'computer_use' }))
  assert.equal(aliasConflict.status, 'HELD_RUNTIME')
  assert.equal(aliasConflict.reason, 'RUNTIME_LEASE_SNAPSHOT_INVALID')
  assert.deepEqual(aliasConflictState, aliasConflictBefore)
  assert.deepEqual(aliasConflictEffects, zeroEffectPorts())

  for (const alias of ['leases', 'runtime_leases', 'active_leases']) {
    for (const invalidValue of [null, undefined]) {
      const effects = zeroEffectPorts()
      const state = runtimeCapacityState([], { effects, [alias]: invalidValue })
      const before = structuredClone(state)
      const result = evaluateRuntimeAdmission(state, runtimeRequest({ kind: 'computer_use' }))
      assert.equal(result.status, 'HELD_RUNTIME', `${alias}:${String(invalidValue)}`)
      assert.equal(result.reason, 'RUNTIME_LEASE_SNAPSHOT_INVALID', `${alias}:${String(invalidValue)}`)
      assert.deepEqual(state, before, `${alias}:${String(invalidValue)}`)
      assert.deepEqual(effects, zeroEffectPorts(), `${alias}:${String(invalidValue)}`)
    }
  }

  const legacyLeaseAliases = runtimeCapacityState([], {
    leases: [],
    runtime_leases: [],
    active_leases: [],
  })
  const legacyLeaseAliasesResult = evaluateRuntimeAdmission(legacyLeaseAliases, runtimeRequest({ kind: 'computer_use' }))
  assert.equal(legacyLeaseAliasesResult.status, 'HELD_RUNTIME')
  assert.equal(legacyLeaseAliasesResult.reason, 'RUNTIME_LEASE_SNAPSHOT_INVALID')

  const frozenAliasEffects = zeroEffectPorts()
  const frozenAliasState = runtimeCapacityState([], {
    effects: frozenAliasEffects,
    runtime_identity: runtimeIdentityForOffset(1),
    frozen_runtime: runtimeIdentity(),
  })
  const frozenAliasBefore = structuredClone(frozenAliasState)
  const frozenAlias = evaluateRuntimeAdmission(frozenAliasState, runtimeRequest())
  assert.equal(frozenAlias.status, 'HELD_RUNTIME')
  assert.equal(frozenAlias.reason, 'FROZEN_RUNTIME_IDENTITY_INVALID')
  assert.deepEqual(frozenAliasState, frozenAliasBefore)
  assert.deepEqual(frozenAliasEffects, zeroEffectPorts())

  for (const alias of ['frozen_runtime', 'runtime_frozen', 'frozen_identity']) {
    const state = runtimeCapacityState([], { [alias]: runtimeIdentity() })
    const result = evaluateRuntimeAdmission(state, runtimeRequest())
    assert.equal(result.status, 'HELD_RUNTIME', alias)
    assert.equal(result.reason, 'FROZEN_RUNTIME_IDENTITY_INVALID', alias)
  }

  for (const [invalidValue, expectedReason] of [[null, 'FROZEN_RUNTIME_IDENTITY_INVALID'], [undefined, 'RUNTIME_ADMISSION_INPUT_INVALID']]) {
    const state = runtimeCapacityState([], { runtime_identity: invalidValue })
    const result = evaluateRuntimeAdmission(state, runtimeRequest())
    assert.equal(result.status, 'HELD_RUNTIME')
    assert.equal(result.reason, expectedReason)
  }

  const sourceAliasEffects = zeroEffectPorts()
  const sourceAliasState = runtimeCapacityState([], { effects: sourceAliasEffects })
  const sourceAliasBefore = structuredClone(sourceAliasState)
  const sourceAlias = evaluateRuntimeAdmission(
    sourceAliasState,
    runtimeRequest({ offset_source: 'registry', allocator_source: 'allocator' }),
  )
  assert.equal(sourceAlias.status, 'HELD_RUNTIME')
  assert.equal(sourceAlias.reason, 'OFFSET_SOURCE_UNTRUSTED')
  assert.deepEqual(sourceAliasState, sourceAliasBefore)
  assert.deepEqual(sourceAliasEffects, zeroEffectPorts())

  for (const [invalidValue, expectedReason] of [[null, 'OFFSET_SOURCE_UNTRUSTED'], [undefined, 'RUNTIME_ADMISSION_INPUT_INVALID']]) {
    const result = evaluateRuntimeAdmission(runtimeSnapshot(), runtimeRequest({ allocator_source: invalidValue }))
    assert.equal(result.status, 'HELD_RUNTIME')
    assert.equal(result.reason, expectedReason)
  }

  const bindingAliasEffects = zeroEffectPorts()
  const bindingAliasState = runtimeCapacityState([], { effects: bindingAliasEffects })
  const bindingAliasBefore = structuredClone(bindingAliasState)
  const bindingAlias = evaluateRuntimeAdmission(
    bindingAliasState,
    runtimeRequest({ offset_binding_digest: ALLOCATOR, allocator_binding_digest: SHA256('0') }),
  )
  assert.equal(bindingAlias.status, 'HELD_RUNTIME')
  assert.equal(bindingAlias.reason, 'OFFSET_BINDING_MISSING')
  assert.deepEqual(bindingAliasState, bindingAliasBefore)
  assert.deepEqual(bindingAliasEffects, zeroEffectPorts())

  for (const alias of ['allocator_binding_digest', 'offset_binding']) {
    for (const [invalidValue, expectedReason] of [[ALLOCATOR, 'OFFSET_BINDING_MISSING'], [null, 'OFFSET_BINDING_MISSING'], [undefined, 'RUNTIME_ADMISSION_INPUT_INVALID']]) {
      const result = evaluateRuntimeAdmission(runtimeSnapshot(), runtimeRequest({ [alias]: invalidValue }))
      assert.equal(result.status, 'HELD_RUNTIME', `${alias}:${String(invalidValue)}`)
      assert.equal(result.reason, expectedReason, `${alias}:${String(invalidValue)}`)
    }
  }

  let ordinaryFunctionToStringHits = 0
  const ordinaryFunction = function ordinaryFunction() {}
  Object.defineProperty(ordinaryFunction, 'toString', {
    configurable: true,
    value() {
      ordinaryFunctionToStringHits += 1
      throw new Error('function source must not be coerced')
    },
  })
  const functionResult = evaluateRuntimeAdmission(
    runtimeSnapshot(),
    runtimeRequest({ offset_source: ordinaryFunction }),
  )
  assert.equal(functionResult.status, 'HELD_RUNTIME')
  assert.equal(functionResult.reason, 'RUNTIME_ADMISSION_INPUT_INVALID')
  assert.equal(ordinaryFunctionToStringHits, 0)

  const callableProxyCounts = { get: 0, ownKeys: 0, getOwnPropertyDescriptor: 0, getPrototypeOf: 0 }
  const callableProxy = trappedProxy(function callableProxy() {}, callableProxyCounts)
  const callableProxyResult = evaluateRuntimeAdmission(
    runtimeSnapshot(),
    runtimeRequest({ offset_source: callableProxy }),
  )
  assert.equal(callableProxyResult.status, 'HELD_RUNTIME')
  assert.equal(callableProxyResult.reason, 'RUNTIME_ADMISSION_INPUT_INVALID')
  assert.deepEqual(callableProxyCounts, { get: 0, ownKeys: 0, getOwnPropertyDescriptor: 0, getPrototypeOf: 0 })
})

test('runtime admission rejects malformed/over-cap snapshots and incomplete trusted identity', () => {
  const overCap = evaluateRuntimeAdmission(runtimeSnapshot({
    leases: [
      { kind: 'writer', state: 'ACTIVE', offset: 1 },
      { kind: 'writer', state: 'ACTIVE', offset: 2 },
      { kind: 'writer', state: 'ACTIVE', offset: 3 },
    ],
  }), runtimeRequest())
  assert.equal(overCap.status, 'HELD_RUNTIME')
  assert.equal(overCap.reason, 'RUNTIME_CAPACITY_SNAPSHOT_OVERFLOW')

  const missingFrozen = evaluateRuntimeAdmission({ runtime_cap: 3, writer_cap: 2, leases: [] }, runtimeRequest())
  assert.equal(missingFrozen.status, 'HELD_RUNTIME')
  assert.equal(missingFrozen.reason, 'FROZEN_RUNTIME_IDENTITY_MISSING')

  const missingOffsetSource = evaluateRuntimeAdmission(runtimeSnapshot(), runtimeRequest({ offset_source: undefined }))
  assert.equal(missingOffsetSource.status, 'HELD_RUNTIME')
  assert.equal(missingOffsetSource.reason, 'RUNTIME_ADMISSION_INPUT_INVALID')

  const missingBinding = evaluateRuntimeAdmission(runtimeSnapshot(), runtimeRequest({ offset_binding_digest: undefined }))
  assert.equal(missingBinding.status, 'HELD_RUNTIME')
  assert.equal(missingBinding.reason, 'RUNTIME_ADMISSION_INPUT_INVALID')
})

test('runtime admission rejects malformed/duplicate active lease offsets and request collisions', () => {
  const cases = [
    ['missing writer offset', [{ kind: 'writer', state: 'ACTIVE' }], 'ACTIVE_RUNTIME_OFFSET_INVALID'],
    ['missing shared runtime offset', [{ kind: 'integration_train', state: 'ACTIVE' }], 'ACTIVE_RUNTIME_OFFSET_INVALID'],
    ['non-integer Computer Use offset', [{ kind: 'computer_use', state: 'ACTIVE', offset: 1.5 }], 'ACTIVE_RUNTIME_OFFSET_INVALID'],
    ['negative writer offset', [{ kind: 'writer', state: 'ACTIVE', offset: -1 }], 'ACTIVE_RUNTIME_OFFSET_INVALID'],
    ['out-of-range shared runtime offset', [{ kind: 'integration_train', state: 'ACTIVE', offset: 5 }], 'ACTIVE_RUNTIME_OFFSET_INVALID'],
    ['duplicate active writer offsets', [
      { kind: 'writer', state: 'ACTIVE', offset: 1 },
      { kind: 'writer', state: 'ACTIVE', offset: 1 },
    ], 'ACTIVE_RUNTIME_OFFSET_DUPLICATE'],
  ]

  for (const [label, leases, reason] of cases) {
    const result = evaluateRuntimeAdmission(runtimeSnapshot({ leases }), runtimeRequest({ offset: 0 }))
    assert.equal(result.status, 'HELD_RUNTIME', label)
    assert.equal(result.reason, reason, label)
  }

  const collision = evaluateRuntimeAdmission(runtimeSnapshot({
    leases: [{ kind: 'writer', state: 'ACTIVE', offset: 0 }],
  }), runtimeRequest())
  assert.equal(collision.status, 'HELD_RUNTIME')
  assert.equal(collision.reason, 'RUNTIME_OFFSET_OCCUPIED')
})

test('runtime admission freezes offset, ports, base URL, branch/worktree, manifest and runtime identity', () => {
  const frozen = runtimeSnapshot()
  const request = runtimeRequest()
  assert.equal(evaluateRuntimeAdmission(frozen, request).status, 'ADMITTED')
  assert.equal(evaluateRuntimeAdmission(frozen, { ...request, offset: 1 }).status, 'HELD_RUNTIME')
  assert.equal(evaluateRuntimeAdmission(frozen, { ...request, manifest_sha256: SHA256('0') }).status, 'HELD_RUNTIME')
  assert.equal(evaluateRuntimeAdmission(frozen, { ...request, branch: 'codex/task-b' }).status, 'HELD_RUNTIME')
  assert.equal(evaluateRuntimeAdmission(frozen, { ...request, ports: { ...request.ports, viewer: 8004 } }).status, 'HELD_RUNTIME')
  // A malformed reservation field never reads as "nothing reserved".
  for (const reserved of ['8005', { viewer: 8005 }, ['8005'], [8005, 8005], [0], [70000], [8005.5]]) {
    const held = evaluateRuntimeAdmission({ ...frozen, reserved_ports: reserved }, request)
    assert.deepEqual({ status: held.status, reason: held.reason }, { status: 'HELD_RUNTIME', reason: 'RESERVED_PORTS_INVALID' }, JSON.stringify(reserved))
    assert.equal(evaluateRuntimeAdmission(frozen, { ...request, reserved_ports: reserved }).reason, 'RESERVED_PORTS_INVALID', JSON.stringify(reserved))
  }
  assert.equal(evaluateRuntimeAdmission({ ...frozen, reserved_ports: [request.ports.viewer] }, request).reason, 'RESERVED_PORT_CONFLICT')
})

test('base-pinned applicability is immutable and a candidate cannot downgrade required E2E', () => {
  const required = classifyE2EApplicability({
    change: {
      paths: ['web-viewer-sample/src/routes/conversion.ts'],
      route: '#conv',
      candidate_e2e_required: false,
    },
    trustedPolicy: trustedPolicy(),
    baseSha: BASE,
  })
  assert.equal(required.status, 'E2E_REQUIRED')
  assert.equal(required.e2e_required, true)
  assert.equal(required.record.e2e_required, true)
  assert.equal(required.record.source, 'base')
  assert.equal(required.record.base_sha, BASE)
  assert.equal(Object.isFrozen(required), true)
  assert.equal(Object.isFrozen(required.record), true)
  const docsOnly = classifyE2EApplicability({
    change: { paths: ['docs/agents/example.md'], e2e_required: true },
    trustedPolicy: trustedPolicy(),
    baseSha: BASE,
  })
  assert.equal(docsOnly.status, 'E2E_NOT_APPLICABLE')
  assert.equal(docsOnly.e2e_required, false)
  // Paths outside the static allowlist are executable or verification-bearing and
  // fail closed to E2E-required even when no trigger regex names them.
  for (const path of ['scripts/deploy.ps1', 'docker-compose.yml', '.github/workflows/ci.yml', 'tests/contracts/ifc_ready_payload.json', 'agent-contracts/schema.json', 'Dockerfile']) {
    const result = classifyE2EApplicability({ change: { paths: [path] }, trustedPolicy: trustedPolicy(), baseSha: BASE })
    assert.equal(result.status, 'E2E_REQUIRED', path)
    assert.equal(result.record.reason, 'UNCLASSIFIED_EXECUTABLE_OR_DEPLOYMENT_PATH', path)
  }
  for (const path of ['docs/agents/example.md', 'openspec/changes/x/tasks.md', 'README.md', 'assets/logo.png', 'LICENSE']) {
    assert.equal(classifyE2EApplicability({ change: { paths: [path] }, trustedPolicy: trustedPolicy(), baseSha: BASE }).status, 'E2E_NOT_APPLICABLE', path)
  }
  const mixed = classifyE2EApplicability({ change: { paths: ['docs/agents/example.md', 'scripts/deploy.ps1'] }, trustedPolicy: trustedPolicy(), baseSha: BASE })
  assert.equal(mixed.status, 'E2E_REQUIRED')
  // No classifier data is not "static": an empty or malformed path set holds unless
  // the trusted base policy explicitly classifies the change as static-only.
  const noPaths = classifyE2EApplicability({ change: {}, trustedPolicy: trustedPolicy(), baseSha: BASE })
  assert.deepEqual({ status: noPaths.status, reason: noPaths.reason }, { status: 'HELD_EVIDENCE_BINDING', reason: 'APPLICABILITY_PATHS_MISSING' })
  assert.equal(classifyE2EApplicability({ change: { paths: [] }, trustedPolicy: trustedPolicy(), baseSha: BASE }).reason, 'APPLICABILITY_PATHS_MISSING')
  assert.equal(classifyE2EApplicability({ change: { paths: [1, 'docs/a.md'] }, trustedPolicy: trustedPolicy(), baseSha: BASE }).reason, 'APPLICABILITY_PATHS_INVALID')
  assert.equal(classifyE2EApplicability({ change: { paths: 'not/a/list' }, trustedPolicy: trustedPolicy(), baseSha: BASE }).status, 'E2E_REQUIRED')
  const staticOnly = classifyE2EApplicability({ change: {}, trustedPolicy: trustedPolicy({ static_only: true }), baseSha: BASE })
  assert.equal(staticOnly.status, 'E2E_NOT_APPLICABLE')
  assert.equal(staticOnly.record.reason, 'TRUSTED_STATIC_ONLY_CLASSIFICATION')
  // Trigger flags still force E2E even without paths.
  assert.equal(classifyE2EApplicability({ change: { paths: [], user_facing: true }, trustedPolicy: trustedPolicy(), baseSha: BASE }).status, 'E2E_REQUIRED')
})

test('missing, stale, and candidate-sourced applicability records are held', () => {
  for (const [label, policy, sha] of [
    ['missing', null, BASE],
    ['stale', trustedPolicy({ base_sha: SHA1('0') }), BASE],
    ['candidate', trustedPolicy({ source: 'candidate' }), BASE],
    ['base drift', trustedPolicy(), SHA1('0')],
  ]) {
    const result = classifyE2EApplicability({ change: { paths: ['web-viewer-sample/src/app.ts'] }, trustedPolicy: policy, baseSha: sha })
    assert.equal(result.status, 'HELD_EVIDENCE_BINDING', label)
  }
})

test('applicability requires immutable fresh prior-trusted source and record proof', () => {
  for (const key of ['source_ref', 'source_sha', 'record_digest', 'immutable', 'base_pinned', 'fresh', 'policy_digest']) {
    const result = classifyE2EApplicability({
      change: { paths: ['web-viewer-sample/src/app.ts'] },
      trustedPolicy: without(trustedPolicy(), key),
      baseSha: BASE,
    })
    assert.equal(result.status, 'HELD_EVIDENCE_BINDING', `missing trusted policy ${key}`)
  }
})

test('browser evidence binds exact head/tree/manifest/runtime and sanitized evidence fields', () => {
  const result = bindBrowserEvidence({
    candidate: candidate(),
    manifest: manifest(),
    playwright: browserPacket('playwright'),
    computerUse: browserPacket('computer_use', { verifier_identity: 'computer-use:one' }),
    trustedPins: trustedPins(),
  })
  assert.equal(result.status, 'READY_FOR_TRAIN')
  assert.equal(result.promotion_eligible, true)
  assert.equal(result.evidence.route, '#conv')
  assert.deepEqual(result.evidence.main_buttons, ['Upload IFC'])
  assert.equal(result.evidence.fixture_reference, 'fixture:ifc-ready')
  assert.equal(result.evidence.api_reference, 'api:ifc-ready')
  assert.equal(result.evidence.runtime_reference, 'runtime:conversion-1')
  assert.equal(result.evidence.visible_state, 'state:success')
  assert.equal(result.evidence.network_digest, digestCanonical('network:ok'))
  assert.equal(result.evidence.trace_sha256, TRACE)
  assert.equal(result.evidence.screenshot_sha256, SCREENSHOT)
  // The exercised flow is pinned to the base-owned expected flow, not only to cross-packet agreement.
  const unrelatedFlow = { route: '#other', main_buttons: ['Delete IFC'] }
  const agreedButUnrelated = bindBrowserEvidence({
    candidate: candidate(), manifest: manifest(),
    playwright: browserPacket('playwright', unrelatedFlow),
    computerUse: browserPacket('computer_use', { verifier_identity: 'computer-use:one', ...unrelatedFlow }),
    trustedPins: trustedPins(),
  })
  assert.deepEqual({ status: agreedButUnrelated.status, reason: agreedButUnrelated.reason }, { status: 'HELD_EVIDENCE_BINDING', reason: 'EXPECTED_FLOW_MISMATCH' })
  const flowlessPins = trustedPins({ expected_flow: undefined })
  const noFlowPin = bindBrowserEvidence({
    candidate: candidate(), manifest: manifest(), playwright: browserPacket('playwright'),
    computerUse: browserPacket('computer_use', { verifier_identity: 'computer-use:one', authority: computerUseAuthority({ authority_digest: flowlessPins.authority_digest }) }),
    trustedPins: flowlessPins,
  })
  assert.equal(noFlowPin.reason, 'EXPECTED_FLOW_PIN_MISSING')
  // Command pins and the expected flow are covered by the prior-base authority digest:
  // a pin map swapped after issuance no longer authenticates.
  const swappedPins = trustedPins()
  swappedPins.command_pins = { ...swappedPins.command_pins, playwright_require_real: { ...swappedPins.command_pins.playwright_require_real, argv_digest: SHA256('f') } }
  const swapped = bindBrowserEvidence({
    candidate: candidate(), manifest: manifest(),
    playwright: browserPacket('playwright', { command_records: commandRecords().map((record) => (record.role === 'playwright_require_real' ? { ...record, argv_digest: SHA256('f') } : record)) }),
    computerUse: browserPacket('computer_use', { verifier_identity: 'computer-use:one' }),
    trustedPins: swappedPins,
  })
  assert.equal(swapped.reason, 'TRUSTED_PINS_AUTHORITY_DIGEST_MISMATCH')
  assert.equal(result.evidence.manifest_id, `manifest:sha256:${MANIFEST.slice(0, 40)}:bound`)
  assert.equal(result.evidence.trace_reference, `trace:sha256:${TRACE.slice(0, 40)}:bound`)
  assert.equal(result.evidence.screenshot_reference, `screenshot:sha256:${SCREENSHOT.slice(0, 40)}:bound`)
  assert.equal(result.evidence.command_records_digest, COMMANDS)
  assert.equal(result.evidence.listener_digest, LISTENER)
  assert.equal(result.evidence.reserved_port_guard, 'clean')
  assert.deepEqual(Object.keys(result.evidence).sort(), [
    'api_reference', 'applicability_record_digest', 'base_urls', 'branch', 'candidate_harness_status',
    'candidate_head_sha', 'command_records_digest', 'computer_use_authority_digest', 'created_at',
    'execution_window', 'fixture_reference', 'harness_digest', 'head_sha', 'listener_digest',
    'main_buttons', 'manifest_digest', 'manifest_id', 'manifest_path_digest', 'manifest_sha256',
    'manifest_sha256_at_publication', 'manifest_sha256_at_start', 'network_digest', 'offset', 'ports',
    'reserved_port_guard', 'route', 'runtime_identity_digest', 'runtime_lineage_digest',
    'runtime_reference', 'schema_version', 'screenshot_reference', 'screenshot_sha256', 'stack_kind',
    'trace_reference', 'trace_sha256', 'tree_digest', 'trusted_binder_sha', 'trusted_verifier_sha',
    'verifier_tree_digest', 'verification_mode', 'visible_state', 'worktree_id', 'worktree_path_digest',
  ].sort())
  assert.equal(JSON.stringify(result).includes('C:\\'), false)
  assert.equal(Object.isFrozen(result), true)
  assert.equal(Object.isFrozen(result.evidence), true)
})

test('P2 regression — browser evidence derives created_at from the required execution window', () => {
  const result = bindBrowserEvidence({
    candidate: candidate(),
    manifest: without(manifest(), 'started_at'),
    playwright: browserPacket('playwright'),
    computerUse: browserPacket('computer_use', { verifier_identity: 'computer-use:one' }),
    trustedPins: trustedPins(),
  })
  assert.equal(result.status, 'READY_FOR_TRAIN')
  assert.equal(result.evidence.created_at, NOW)
  assert.deepEqual(result.evidence.execution_window, { started_at: NOW, finished_at: LATER })
})

test('P2 regression — browser evidence rejects a zero-duration execution window', () => {
  const executionWindow = { started_at: NOW, finished_at: NOW }
  const result = bindBrowserEvidence({
    candidate: candidate(),
    manifest: { ...manifest(), execution_window: executionWindow },
    playwright: browserPacket('playwright', { execution_window: executionWindow }),
    computerUse: browserPacket('computer_use', { verifier_identity: 'computer-use:one', execution_window: executionWindow }),
    trustedPins: trustedPins(),
  })
  assert.equal(result.status, 'HELD_EVIDENCE_BINDING')
  assert.equal(result.reason, 'EXECUTION_WINDOW_REQUIRED')
  assert.equal(result.promotion_eligible, false)
})

test('AC-26 — listener evidence is own, canonical, matched, and fail-closed without mutating input', () => {
  const heldWithoutEvidence = (result, label, reason) => {
    assert.equal(result.status, 'HELD_EVIDENCE_BINDING', label)
    assert.equal(result.reason, reason, label)
    assert.equal(result.promotion_eligible, false, label)
    assert.equal(Object.hasOwn(result, 'evidence'), false, label)
  }
  const cases = [
    ['playwright missing', { playwright: without(browserPacket('playwright'), 'listener_digest') }, 'LISTENER_DIGEST_INVALID'],
    ['computer use missing', { computerUse: without(browserPacket('computer_use', { verifier_identity: 'computer-use:one' }), 'listener_digest') }, 'LISTENER_DIGEST_INVALID'],
    ['wrong type', { playwright: browserPacket('playwright', { listener_digest: 1 }) }, 'LISTENER_DIGEST_INVALID'],
    ['empty', { playwright: browserPacket('playwright', { listener_digest: '' }) }, 'LISTENER_DIGEST_INVALID'],
    ['unknown', { playwright: browserPacket('playwright', { listener_digest: 'unknown' }) }, 'LISTENER_DIGEST_INVALID'],
    ['mismatch', { computerUse: browserPacket('computer_use', { verifier_identity: 'computer-use:one', listener_digest: SHA256('0') }) }, 'LISTENER_DIGEST_MISMATCH'],
  ]
  for (const [label, overrides, reason] of cases) {
    const input = {
      candidate: candidate(),
      manifest: manifest(),
      playwright: browserPacket('playwright'),
      computerUse: browserPacket('computer_use', { verifier_identity: 'computer-use:one' }),
      trustedPins: trustedPins(),
      ...overrides,
    }
    const before = structuredClone(input)
    heldWithoutEvidence(bindBrowserEvidence(input), label, reason)
    assert.deepEqual(input, before, `${label} leaves all evidence input unchanged`)
  }

  let getterReads = 0
  const getterPacket = browserPacket('playwright')
  Object.defineProperty(getterPacket, 'listener_digest', {
    enumerable: true,
    get: () => {
      getterReads += 1
      return LISTENER
    },
  })
  heldWithoutEvidence(bindBrowserEvidence({
    candidate: candidate(), manifest: manifest(), playwright: getterPacket,
    computerUse: browserPacket('computer_use', { verifier_identity: 'computer-use:one' }), trustedPins: trustedPins(),
  }), 'getter listener digest', 'EVIDENCE_INPUT_UNSAFE')
  assert.equal(getterReads, 0, 'getter listener digest is never read')

  let proxyReads = 0
  const proxyPacket = new Proxy(browserPacket('playwright'), {
    get(target, key, receiver) {
      proxyReads += 1
      return Reflect.get(target, key, receiver)
    },
  })
  heldWithoutEvidence(bindBrowserEvidence({
    candidate: candidate(), manifest: manifest(), playwright: proxyPacket,
    computerUse: browserPacket('computer_use', { verifier_identity: 'computer-use:one' }), trustedPins: trustedPins(),
  }), 'proxy listener digest', 'EVIDENCE_INPUT_UNSAFE')
  assert.equal(proxyReads, 0, 'proxy listener digest is never read')
})

test('AC-26 — reserved-port guard accepts only existing clean forms and normalizes durable evidence', () => {
  const canonical = bindBrowserEvidence({
    candidate: candidate(), manifest: manifest(),
    playwright: browserPacket('playwright', { reserved_port_guard: true }),
    computerUse: browserPacket('computer_use', { verifier_identity: 'computer-use:one', reserved_port_guard: 'clean' }),
    trustedPins: trustedPins(),
  })
  assert.equal(canonical.status, 'READY_FOR_TRAIN')
  assert.equal(canonical.evidence.reserved_port_guard, 'clean')

  for (const [label, overrides] of [
    ['playwright missing', { playwright: without(browserPacket('playwright'), 'reserved_port_guard') }],
    ['computer use missing', { computerUse: without(browserPacket('computer_use', { verifier_identity: 'computer-use:one' }), 'reserved_port_guard') }],
    ['wrong type', { playwright: browserPacket('playwright', { reserved_port_guard: false }) }],
    ['empty', { playwright: browserPacket('playwright', { reserved_port_guard: '' }) }],
    ['unknown', { playwright: browserPacket('playwright', { reserved_port_guard: 'unknown' }) }],
  ]) {
    const result = bindBrowserEvidence({
      candidate: candidate(), manifest: manifest(), playwright: browserPacket('playwright'),
      computerUse: browserPacket('computer_use', { verifier_identity: 'computer-use:one' }), trustedPins: trustedPins(),
      ...overrides,
    })
    assert.equal(result.status, 'HELD_EVIDENCE_BINDING', label)
    assert.equal(result.reason, 'RESERVED_PORT_GUARD_FAILED', label)
    assert.equal(result.promotion_eligible, false, label)
    assert.equal(Object.hasOwn(result, 'evidence'), false, label)
  }
})

test('AC-26 — durable browser evidence rejects noncanonical schema-bound fields before publication', () => {
  const cases = [
    ['buttons scalar', { playwright: browserPacket('playwright', { main_buttons: 'Upload IFC' }) }, 'EVIDENCE_BUTTON_MISSING'],
    ['buttons empty', { playwright: browserPacket('playwright', { main_buttons: [] }) }, 'EVIDENCE_BUTTON_MISSING'],
    ['buttons non-string', { playwright: browserPacket('playwright', { main_buttons: [1] }) }, 'EVIDENCE_BUTTON_MISSING'],
    ['buttons empty string', { playwright: browserPacket('playwright', { main_buttons: [''] }) }, 'EVIDENCE_BUTTON_MISSING'],
    ['buttons exceed schema maximum', { playwright: browserPacket('playwright', { main_buttons: Array.from({ length: 65 }, (_, index) => `button-${index}`) }) }, 'EVIDENCE_BUTTON_MISSING'],
    ['visible array', { playwright: browserPacket('playwright', { visible_state: ['state:success'] }) }, 'EVIDENCE_VISIBLE_STATE_MISSING'],
    ['visible empty', { playwright: browserPacket('playwright', { visible_state: '' }) }, 'EVIDENCE_VISIBLE_STATE_MISSING'],
    ['visible non-string', { playwright: browserPacket('playwright', { visible_state: 1 }) }, 'EVIDENCE_VISIBLE_STATE_MISSING'],
    ['manifest id empty', { manifest: manifest({ manifest_id: '' }) }, 'MANIFEST_ID_INVALID'],
    ['manifest id too short', { manifest: manifest({ manifest_id: 'x' }) }, 'MANIFEST_ID_INVALID'],
    ['manifest id terminal numeric', { manifest: manifest({ manifest_id: 'manifest:123' }) }, 'MANIFEST_ID_INVALID'],
  ]
  for (const [label, overrides, reason] of cases) {
    const input = {
      candidate: candidate(),
      manifest: manifest(),
      playwright: browserPacket('playwright'),
      computerUse: browserPacket('computer_use', { verifier_identity: 'computer-use:one' }),
      trustedPins: trustedPins(),
      ...overrides,
    }
    const before = structuredClone(input)
    const result = bindBrowserEvidence(input)
    assert.equal(result.status, 'HELD_EVIDENCE_BINDING', label)
    assert.equal(result.reason, reason, label)
    assert.equal(result.promotion_eligible, false, label)
    assert.equal(Object.hasOwn(result, 'evidence'), false, label)
    assert.deepEqual(input, before, `${label} leaves inputs unchanged`)
  }
})

test('browser binding requires complete immutable source, trusted pins, and manifest lifecycle proof', () => {
  const candidateWithMissingApplicability = (key) => {
    const value = candidate()
    value.applicability = without(value.applicability, key)
    return value
  }
  const cases = [
    ['candidate applicability immutable', { candidate: candidateWithMissingApplicability('immutable') }, 'APPLICABILITY_RECORD_INVALID'],
    ['candidate applicability base pin', { candidate: candidateWithMissingApplicability('base_pinned') }, 'APPLICABILITY_RECORD_INVALID'],
    ['candidate applicability freshness', { candidate: candidateWithMissingApplicability('fresh') }, 'APPLICABILITY_RECORD_INVALID'],
    ['candidate applicability source sha', { candidate: candidateWithMissingApplicability('source_sha') }, 'APPLICABILITY_RECORD_INVALID'],
    ['candidate applicability source ref', { candidate: candidateWithMissingApplicability('source_ref') }, 'APPLICABILITY_RECORD_INVALID'],
    ['candidate applicability digest', { candidate: candidateWithMissingApplicability('record_digest') }, 'APPLICABILITY_RECORD_INVALID'],
    ['trusted verifier tree pin', { trustedPins: without(trustedPins(), 'verifier_tree_digest') }, 'TRUSTED_SOURCE_REQUIRED'],
    ['trusted harness pin', { trustedPins: without(trustedPins(), 'harness_digest') }, 'TRUSTED_SOURCE_REQUIRED'],
    ['manifest start bytes', { manifest: without(manifest(), 'manifest_sha256_at_start') }, 'MANIFEST_LIFECYCLE_INVALID'],
    ['manifest publication bytes', { manifest: without(manifest(), 'manifest_sha256_at_publication') }, 'MANIFEST_LIFECYCLE_INVALID'],
    ['manifest execution window', { manifest: without(manifest(), 'execution_window') }, 'EXECUTION_WINDOW_REQUIRED'],
    ['playwright start bytes', { playwright: without(browserPacket('playwright'), 'manifest_sha256_at_start') }, 'MANIFEST_LIFECYCLE_INVALID'],
    ['computer use publication bytes', { computerUse: without(browserPacket('computer_use', { verifier_identity: 'computer-use:one' }), 'manifest_sha256_at_publication') }, 'MANIFEST_LIFECYCLE_INVALID'],
    ['playwright execution window', { playwright: without(browserPacket('playwright'), 'execution_window') }, 'EXECUTION_WINDOW_REQUIRED'],
    ['shared execution window', { computerUse: browserPacket('computer_use', { verifier_identity: 'computer-use:one', execution_window: { started_at: NOW, finished_at: '2026-08-29T02:00:01.000Z' } }) }, 'EXECUTION_WINDOW_MISMATCH'],
  ]
  for (const [label, overrides, reason] of cases) {
    const result = bindBrowserEvidence({
      candidate: candidate(), manifest: manifest(), playwright: browserPacket('playwright'),
      computerUse: browserPacket('computer_use', { verifier_identity: 'computer-use:one' }), trustedPins: trustedPins(),
      ...overrides,
    })
    assert.equal(result.status, 'HELD_EVIDENCE_BINDING', label)
    assert.equal(result.reason, reason, label)
    assert.equal(result.freeze_scope, 'candidate', label)
    assert.equal(result.other_candidates_continue, true, label)
  }
})

test('Computer Use authority is a distinct prior-pinned read-only closed shape', () => {
  const deniedCapabilities = [
    'can_edit', 'can_push', 'can_resolve', 'can_publish_required_check',
    'can_approve', 'can_merge', 'can_deploy',
  ]
  for (const key of deniedCapabilities) {
    const result = bindBrowserEvidence({
      candidate: candidate(), manifest: manifest(), playwright: browserPacket('playwright'),
      computerUse: browserPacket('computer_use', {
        verifier_identity: 'computer-use:one',
        authority: computerUseAuthority({ [key]: true }),
      }), trustedPins: trustedPins(),
    })
    assert.equal(result.status, 'HELD_EVIDENCE_BINDING', `Computer Use capability ${key}`)
    assert.equal(result.reason, 'COMPUTER_USE_AUTHORITY_INVALID', `Computer Use capability ${key}`)
  }
  for (const [label, authority, reason] of [
    ['missing packet', undefined, 'COMPUTER_USE_AUTHORITY_MISSING'],
    ['candidate source', computerUseAuthority({ source: 'candidate' }), 'COMPUTER_USE_AUTHORITY_INVALID'],
    ['identity mismatch', computerUseAuthority({ verifier_identity: 'computer-use:other' }), 'COMPUTER_USE_AUTHORITY_IDENTITY_MISMATCH'],
    ['unknown field', computerUseAuthority({ can_publish_check: false }), 'COMPUTER_USE_AUTHORITY_INVALID'],
    ['read-only false', computerUseAuthority({ read_only: false }), 'COMPUTER_USE_AUTHORITY_INVALID'],
  ]) {
    const result = bindBrowserEvidence({
      candidate: candidate(), manifest: manifest(), playwright: browserPacket('playwright'),
      computerUse: browserPacket('computer_use', {
        verifier_identity: 'computer-use:one',
        authority,
      }), trustedPins: trustedPins(),
    })
    assert.equal(result.status, 'HELD_EVIDENCE_BINDING', label)
    assert.equal(result.reason, reason, label)
  }
  const topLevelCapability = bindBrowserEvidence({
    candidate: candidate(), manifest: manifest(), playwright: browserPacket('playwright'),
    computerUse: browserPacket('computer_use', { verifier_identity: 'computer-use:one', can_merge: true }),
    trustedPins: trustedPins(),
  })
  assert.equal(topLevelCapability.status, 'HELD_EVIDENCE_BINDING')
  assert.equal(topLevelCapability.reason, 'COMPUTER_USE_AUTHORITY_INVALID')
  const candidateClaim = bindBrowserEvidence({
    candidate: candidate({ authority: computerUseAuthority() }), manifest: manifest(),
    playwright: browserPacket('playwright'),
    computerUse: browserPacket('computer_use', { verifier_identity: 'computer-use:one' }),
    trustedPins: trustedPins(),
  })
  assert.equal(candidateClaim.status, 'HELD_EVIDENCE_BINDING')
  assert.equal(candidateClaim.reason, 'COMPUTER_USE_AUTHORITY_CANDIDATE_CLAIM')
})

test('Computer Use authority requires explicit false proof for every forbidden capability', () => {
  const forbiddenCapabilities = [
    'can_edit', 'can_push', 'can_resolve', 'can_publish_required_check',
    'can_approve', 'can_merge', 'can_deploy',
  ]
  for (const key of forbiddenCapabilities) {
    const result = bindBrowserEvidence({
      candidate: candidate(), manifest: manifest(), playwright: browserPacket('playwright'),
      computerUse: browserPacket('computer_use', {
        verifier_identity: 'computer-use:one',
        authority: without(computerUseAuthority(), key),
      }), trustedPins: trustedPins(),
    })
    assert.equal(result.status, 'HELD_EVIDENCE_BINDING', `omitted Computer Use capability ${key}`)
    assert.equal(result.reason, 'COMPUTER_USE_AUTHORITY_INVALID', `omitted Computer Use capability ${key}`)
    assert.equal(result.promotion_eligible, false, `omitted Computer Use capability ${key}`)
  }
})

test('AC-25 — E2E_REQUIRE_REAL rejects skip or missing manifest, and candidate harness changes are shadow-only', () => {
  const skipped = bindBrowserEvidence({
    candidate: candidate(), manifest: manifest(),
    playwright: browserPacket('playwright', { skipped: true }),
    computerUse: browserPacket('computer_use', { verifier_identity: 'computer-use:one' }), trustedPins: trustedPins(),
  })
  assert.equal(skipped.status, 'HELD_EVIDENCE_BINDING')
  const missingManifest = bindBrowserEvidence({
    candidate: candidate(), manifest: null,
    playwright: browserPacket('playwright'), computerUse: browserPacket('computer_use', { verifier_identity: 'computer-use:one' }), trustedPins: trustedPins(),
  })
  assert.equal(missingManifest.status, 'HELD_EVIDENCE_BINDING')
  const shadow = bindBrowserEvidence({
    candidate: candidate({ harness_modified: true }), manifest: manifest(),
    playwright: browserPacket('playwright', { candidate_harness_status: 'modified', verification_mode: 'shadow' }),
    computerUse: browserPacket('computer_use', { verifier_identity: 'computer-use:one', candidate_harness_status: 'modified', verification_mode: 'shadow' }), trustedPins: trustedPins(),
  })
  assert.equal(shadow.status, 'SHADOW_ONLY')
  assert.equal(shadow.promotion_eligible, false)
})

test('AC-27 — per-candidate E2E failures freeze only the affected candidate while disjoint work continues', () => {
  const cases = [
    ['candidate trusted source', { trustedPins: trustedPins({ source: 'candidate' }) }, 'TRUSTED_SOURCE_REQUIRED'],
    ['timeout', { playwright: browserPacket('playwright', { timed_out: true }) }, 'E2E_TIMEOUT'],
    ['playwright failure', { playwright: browserPacket('playwright', { status: 'failed' }) }, 'PLAYWRIGHT_FAILED'],
    ['manifest mismatch', { playwright: browserPacket('playwright', { manifest_sha256: SHA256('0') }) }, 'MANIFEST_HASH_MISMATCH'],
    ['head mismatch', { computerUse: browserPacket('computer_use', { verifier_identity: 'computer-use:one', head_sha: HEAD_B }) }, 'EXACT_HEAD_MISMATCH'],
    ['runtime drift', { manifest: manifest({ runtime_identity_digest: SHA256('0') }) }, 'RUNTIME_IDENTITY_DRIFT'],
    ['screenshot hash mismatch', { playwright: browserPacket('playwright', { screenshot_sha256: SHA256('0'), screenshot_hash: SCREENSHOT }) }, 'SCREENSHOT_HASH_MISMATCH'],
    ['trace hash mismatch', { computerUse: browserPacket('computer_use', { verifier_identity: 'computer-use:one', trace_sha256: SHA256('0'), trace_hash: TRACE }) }, 'TRACE_HASH_MISMATCH'],
  ]
  for (const [label, overrides, reason] of cases) {
    const result = bindBrowserEvidence({
      candidate: candidate(), manifest: manifest(), playwright: browserPacket('playwright'),
      computerUse: browserPacket('computer_use', { verifier_identity: 'computer-use:one' }), trustedPins: trustedPins(),
      ...overrides,
    })
    assert.equal(result.status, 'HELD_EVIDENCE_BINDING', label)
    assert.equal(result.reason, reason, label)
    assert.equal(result.freeze_scope, 'candidate', label)
    assert.equal(result.other_candidates_continue, true, label)
  }

  const computerUseFailure = bindBrowserEvidence({
    candidate: candidate(), manifest: manifest(), playwright: browserPacket('playwright'),
    computerUse: browserPacket('computer_use', { verifier_identity: 'computer-use:one', status: 'failed' }), trustedPins: trustedPins(),
  })
  assert.equal(computerUseFailure.status, 'HELD_EVIDENCE_BINDING')
  assert.equal(computerUseFailure.reason, 'COMPUTER_USE_FAILED')
  assert.equal(computerUseFailure.freeze_scope, 'candidate')
  assert.equal(computerUseFailure.other_candidates_continue, true)

  const disjointIdentity = {
    head_sha: HEAD_B,
    tree_digest: SHA256('b'),
    manifest_sha256: SHA256('c'),
    manifest_path_digest: SHA256('d'),
    runtime_identity_digest: SHA256('e'),
    branch: 'codex/task-b',
    worktree_id: 'worktree:b',
    worktree_path_digest: SHA256('f'),
  }
  const disjointCandidate = candidate({ candidate_id: 'candidate:b', owner_session: 'writer:disjoint', ...disjointIdentity })
  const disjointManifest = manifest({
    ...disjointIdentity,
    manifest_sha256_at_start: disjointIdentity.manifest_sha256,
    manifest_sha256_at_publication: disjointIdentity.manifest_sha256,
  })
  const disjointPacket = (role) => browserPacket(role, {
    ...disjointIdentity,
    manifest_sha256_at_start: disjointIdentity.manifest_sha256,
    manifest_sha256_at_publication: disjointIdentity.manifest_sha256,
    runtime_lineage_digest: disjointIdentity.runtime_identity_digest,
  })
  const disjointResult = bindBrowserEvidence({
    candidate: disjointCandidate, manifest: disjointManifest, playwright: disjointPacket('playwright'),
    computerUse: disjointPacket('computer_use'), trustedPins: trustedPins(),
  })
  assert.equal(disjointResult.status, 'READY_FOR_TRAIN')
  assert.equal(disjointResult.promotion_eligible, true)
})

test('binder requires complete canonical identity and command lineage packets', () => {
  const cases = [
    ['packet stack kind', { playwright: browserPacket('playwright', { stack_kind: 'other_stack' }) }, 'STACK_KIND_MISMATCH'],
    ['packet manifest metadata', { playwright: browserPacket('playwright', { manifest_present: undefined }) }, 'REQUIRE_REAL_MANIFEST_MISSING'],
    ['packet path identity', { computerUse: browserPacket('computer_use', { verifier_identity: 'computer-use:one', manifest_path_digest: undefined }) }, 'MANIFEST_PATH_MISMATCH'],
    ['packet command records', {
      playwright: browserPacket('playwright', { command_records: [] }),
      computerUse: browserPacket('computer_use', { verifier_identity: 'computer-use:one', command_records: [] }),
    }, 'COMMAND_RECORDS_MISSING'],
    ['command record fields', { playwright: browserPacket('playwright', { command_records: [commandRecord('git_preflight', { cwd_digest: undefined })] }) }, 'COMMAND_RECORD_INVALID'],
    ['manifest tree identity', { manifest: manifest({ tree_digest: SHA256('0') }) }, 'TREE_DIGEST_MISMATCH'],
    ['manifest branch identity', { manifest: manifest({ branch: 'codex/task-b' }) }, 'BRANCH_IDENTITY_MISMATCH'],
  ]
  for (const [label, overrides, reason] of cases) {
    const result = bindBrowserEvidence({
      candidate: candidate(), manifest: manifest(), playwright: browserPacket('playwright'),
      computerUse: browserPacket('computer_use', { verifier_identity: 'computer-use:one' }), trustedPins: trustedPins(),
      ...overrides,
    })
    assert.equal(result.status, 'HELD_EVIDENCE_BINDING', label)
    assert.equal(result.reason, reason, label)
    assert.equal(result.freeze_scope, 'candidate', label)
    assert.equal(result.other_candidates_continue, true, label)
  }
})

test('P2 regressions — binder recomputes command lineage and compares every network alias', () => {
  const alteredCommands = browserPacket('playwright')
  alteredCommands.command_records[0].exit_code = 1
  const commandResult = bindBrowserEvidence({
    candidate: candidate(), manifest: manifest(), playwright: alteredCommands,
    computerUse: browserPacket('computer_use', { verifier_identity: 'computer-use:one' }), trustedPins: trustedPins(),
  })
  assert.equal(commandResult.status, 'HELD_EVIDENCE_BINDING')
  assert.equal(commandResult.reason, 'COMMAND_RECORDS_DIGEST_MISMATCH')

  const failedCommands = commandRecords()
  failedCommands[0].exit_code = 1
  const failedPacket = browserPacket('playwright', {
    command_records: failedCommands,
    command_records_digest: digestCanonical(failedCommands),
  })
  const failedResult = bindBrowserEvidence({
    candidate: candidate(), manifest: manifest(), playwright: failedPacket,
    computerUse: browserPacket('computer_use', {
      verifier_identity: 'computer-use:one', command_records: failedCommands,
      command_records_digest: digestCanonical(failedCommands),
    }),
    trustedPins: trustedPins(),
  })
  assert.equal(failedResult.status, 'HELD_EVIDENCE_BINDING')
  assert.equal(failedResult.reason, 'COMMAND_RECORD_FAILED')

  const staleCommands = commandRecords().map((record) => ({
    ...record,
    started_at: '2026-08-28T01:00:00.000Z',
    finished_at: '2026-08-28T02:00:00.000Z',
  }))
  const staleCommandDigest = digestCanonical(staleCommands)
  const staleResult = bindBrowserEvidence({
    candidate: candidate(), manifest: manifest(),
    playwright: browserPacket('playwright', { command_records: staleCommands, command_records_digest: staleCommandDigest }),
    computerUse: browserPacket('computer_use', {
      verifier_identity: 'computer-use:one', command_records: staleCommands, command_records_digest: staleCommandDigest,
    }),
    trustedPins: trustedPins(),
  })
  assert.equal(staleResult.status, 'HELD_EVIDENCE_BINDING')
  assert.equal(staleResult.reason, 'COMMAND_RECORD_WINDOW_MISMATCH')

  // P2: six correctly labelled roles that ran an unrelated no-op command are not evidence
  // of the real Playwright / Computer Use runs; every record must match the trusted pin.
  const nonCanonical = commandRecords().map((record) => (record.role === 'computer_use' ? { ...record, argv_digest: SHA256('9') } : record))
  const nonCanonicalDigest = digestCanonical(nonCanonical)
  const nonCanonicalResult = bindBrowserEvidence({
    candidate: candidate(), manifest: manifest(),
    playwright: browserPacket('playwright', { command_records: nonCanonical, command_records_digest: nonCanonicalDigest }),
    computerUse: browserPacket('computer_use', {
      verifier_identity: 'computer-use:one', command_records: nonCanonical, command_records_digest: nonCanonicalDigest,
    }),
    trustedPins: trustedPins(),
  })
  assert.equal(nonCanonicalResult.status, 'HELD_EVIDENCE_BINDING')
  assert.equal(nonCanonicalResult.reason, 'COMMAND_RECORD_NOT_CANONICAL')
  const pinlessPins = trustedPins({ command_pins: undefined })
  const pinsMissing = bindBrowserEvidence({
    candidate: candidate(), manifest: manifest(), playwright: browserPacket('playwright'),
    computerUse: browserPacket('computer_use', { verifier_identity: 'computer-use:one', authority: computerUseAuthority({ authority_digest: pinlessPins.authority_digest }) }),
    trustedPins: pinlessPins,
  })
  assert.equal(pinsMissing.reason, 'COMMAND_PINS_MISSING')

  // P2: a postflight captured before the browser verifiers finished cannot attest the
  // post-test state, even though every interval lies inside the shared window.
  const reordered = commandRecords().map((record) => (record.role === 'postflight'
    ? { ...record, started_at: minutesAfterNow(1), finished_at: minutesAfterNow(3) }
    : record))
  const reorderedDigest = digestCanonical(reordered)
  const reorderedResult = bindBrowserEvidence({
    candidate: candidate(), manifest: manifest(),
    playwright: browserPacket('playwright', { command_records: reordered, command_records_digest: reorderedDigest }),
    computerUse: browserPacket('computer_use', {
      verifier_identity: 'computer-use:one', command_records: reordered, command_records_digest: reorderedDigest,
    }),
    trustedPins: trustedPins(),
  })
  assert.equal(reorderedResult.reason, 'COMMAND_RECORD_ORDER_INVALID')

  // P2: Computer Use must exercise the same user flow the evidence copies from Playwright.
  for (const [label, drift] of [
    ['route', { route: '#other' }], ['buttons', { main_buttons: ['Other'] }], ['fixture', { fixture: 'fixture:other' }],
    ['api', { api: 'api:other' }], ['runtime', { runtime_id: 'runtime:other' }], ['visible state', { visible_state: 'state:other' }],
  ]) {
    const flowResult = bindBrowserEvidence({
      candidate: candidate(), manifest: manifest(), playwright: browserPacket('playwright'),
      computerUse: browserPacket('computer_use', { verifier_identity: 'computer-use:one', ...drift }),
      trustedPins: trustedPins(),
    })
    assert.equal(flowResult.status, 'HELD_EVIDENCE_BINDING', label)
    assert.equal(flowResult.reason, 'BROWSER_FLOW_MISMATCH', label)
  }

  for (const computerUse of [
    browserPacket('computer_use', { verifier_identity: 'computer-use:one', network_result: 'network:other' }),
    browserPacket('computer_use', { verifier_identity: 'computer-use:one', network_sha256: SHA256('0') }),
  ]) {
    const networkResult = bindBrowserEvidence({
      candidate: candidate(), manifest: manifest(), playwright: browserPacket('playwright'),
      computerUse, trustedPins: trustedPins(),
    })
    assert.equal(networkResult.status, 'HELD_EVIDENCE_BINDING')
    assert.equal(networkResult.reason, 'NETWORK_EVIDENCE_MISMATCH')
  }
})

test('binder preserves POSIX path case while folding Windows physical path identity', () => {
  const upperPath = '/repo/Artifacts/e2e/change-a/run-a/stack-manifest.json'
  const lowerPath = '/repo/artifacts/e2e/change-a/run-a/stack-manifest.json'
  const upperDigest = sha256Text(upperPath)
  const lowerDigest = sha256Text(lowerPath)
  const upperIdentity = { manifest_path: upperPath, manifest_path_digest: upperDigest }
  const accepted = bindBrowserEvidence({
    candidate: candidate(upperIdentity),
    manifest: manifest(upperIdentity),
    playwright: browserPacket('playwright', upperIdentity),
    computerUse: browserPacket('computer_use', { verifier_identity: 'computer-use:one', ...upperIdentity }),
    trustedPins: trustedPins(),
  })
  assert.equal(accepted.status, 'READY_FOR_TRAIN')

  const mismatched = bindBrowserEvidence({
    candidate: candidate(upperIdentity),
    manifest: manifest(upperIdentity),
    playwright: browserPacket('playwright', upperIdentity),
    computerUse: browserPacket('computer_use', {
      verifier_identity: 'computer-use:one', manifest_path: lowerPath, manifest_path_digest: lowerDigest,
    }),
    trustedPins: trustedPins(),
  })
  assert.equal(mismatched.status, 'HELD_EVIDENCE_BINDING')
  assert.equal(mismatched.reason, 'MANIFEST_PATH_MISMATCH')

  const windowsPath = 'C:\\Repo\\Artifacts\\e2e\\change-a\\run-a\\stack-manifest.json'
  const windowsVariant = 'c:/repo/artifacts/e2e/change-a/run-a/stack-manifest.json'
  const windowsDigest = sha256Text(windowsVariant)
  const windowsAccepted = bindBrowserEvidence({
    candidate: candidate({ manifest_path: windowsPath, manifest_path_digest: windowsDigest }),
    manifest: manifest({ manifest_path: windowsVariant, manifest_path_digest: windowsDigest }),
    playwright: browserPacket('playwright', { manifest_path: windowsPath, manifest_path_digest: windowsDigest }),
    computerUse: browserPacket('computer_use', {
      verifier_identity: 'computer-use:one', manifest_path: windowsVariant, manifest_path_digest: windowsDigest,
    }),
    trustedPins: trustedPins(),
  })
  assert.equal(windowsAccepted.status, 'READY_FOR_TRAIN')
})
