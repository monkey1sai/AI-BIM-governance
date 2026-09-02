import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { FABRIC_SCHEMA_VERSION, digestCanonical } from '../../lib/parallel-delivery-fabric-contract.mjs'
import { createLeaseRegistry, parseSessionLeaseRegistry } from '../../lib/parallel-delivery-fabric-registry.mjs'
import * as admissionModule from '../../lib/parallel-delivery-fabric-admission.mjs'
import {
  advanceExecutionEnvelope,
  advanceManagedBranch,
  evaluateAdmission,
  evaluateScopeRevalidation,
  evaluateScopeDrift,
  findScopeConflicts,
  normalizeScope,
  parseChangedScopeEvidence,
  rebaseManagedBranch,
  renewManagedBranch,
  _internal,
} from '../../lib/parallel-delivery-fabric-admission.mjs'

const SHA1_A = 'a'.repeat(40)
const SHA1_B = 'b'.repeat(40)
const SHA1_C = 'c'.repeat(40)
const SHA1_D = 'd'.repeat(40)
const SHA256_A = 'a'.repeat(64)
const SHA256_B = 'b'.repeat(64)
const SHA256_C = 'c'.repeat(64)
const SHA256_D = 'd'.repeat(64)
const ZERO_OID = '0'.repeat(40)
const NOW = '2026-08-29T05:00:00.000Z'
const LATER = '2026-08-29T05:05:00.000Z'
const LATER_2 = '2026-08-29T05:10:00.000Z'
const EXPIRED = '2026-08-29T04:55:00.000Z'
const NONCE = (suffix) => `${suffix}`.padEnd(32, 'n').slice(0, 32)
// Owner/session-bound proof required to end a lease (same closed shape the release path consumes).
const endAttestation = (lease, overrides = {}) => ({
  attestation_ref: `attestation:end-${lease.lease_id}`,
  attestation_digest: SHA256_A,
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
  observed_at: NOW,
  expires_at: new Date(Date.parse(NOW) + 600_000).toISOString(),
  nonce: NONCE(`end-${lease.lease_id.replace(/[^A-Za-z0-9]/gu, '')}`),
  revocation_epoch: lease.revocation_epoch,
  ...overrides,
})

const REQUEST_SCOPE = [{ kind: 'path', path: 'src/task-one.mjs' }]
const REQUEST_SCOPE_DIGEST = digestCanonical(REQUEST_SCOPE.map((resource) => ({ kind: resource.kind, path: resource.path.toLowerCase() })))
const EXECUTION_SCOPE = [{ kind: 'path', path: 'src' }]
const EXECUTION_SCOPE_DIGEST = digestCanonical(EXECUTION_SCOPE)
const EXECUTION_CHANGED_EVIDENCE = 'M\0src/task-one.mjs\0'
const EXECUTION_CHANGED_EVIDENCE_DIGEST = parseChangedScopeEvidence(EXECUTION_CHANGED_EVIDENCE).evidence_digest

const clone = (value) => structuredClone(value)

const managedBranch = (overrides = {}) => ({
  schema_version: 'managed-branch/v1',
  branch: 'develop',
  branch_class: 'develop',
  owner_authority: 'authority:managed-branch',
  protection_profile_digest: SHA256_C,
  base_ref: 'origin/main',
  base_sha: SHA1_A,
  generation: 1,
  scope_digest: SHA256_D,
  allowed_merge_targets: ['origin/main'],
  created_at: NOW,
  renewed_at: NOW,
  expires_at: LATER,
  current_head_sha: SHA1_B,
  registry_oid: SHA1_C,
  managed_base_lease_id: 'lease:managed-base',
  transition_sequence: 0,
  state: 'ACTIVE',
  ...overrides,
})

const request = (overrides = {}) => {
  const value = {
  schema_version: 'admission-request/v1',
  lease_kind: 'writer_seat',
  lease_id: 'lease:one',
  plan_id: 'plan:one',
  generation: 1,
  task_id: 'task:one',
  provider: 'codex',
  owner_session: 'session:one',
  provider_session_id: 'provider:one',
  execution_context_id: 'context:one',
  repo_identity_digest: SHA256_A,
  common_dir_digest: SHA256_A,
  worktree_id: 'worktree:one',
  worktree_path_digest: SHA256_C,
  branch: 'codex/task-one',
  scope: clone(REQUEST_SCOPE),
  scope_digest: REQUEST_SCOPE_DIGEST,
  baseline_sha: SHA1_A,
  head_sha: SHA1_B,
  base_ref: 'origin/main',
  base_sha: SHA1_A,
  expected_remote_sha: SHA1_A,
  action: 'admit',
  runtime_kind: null,
    ...overrides,
  }
  if (Object.hasOwn(overrides, 'scope') && !Object.hasOwn(overrides, 'scope_digest')) {
    value.scope_digest = digestCanonical(value.scope.map((resource) => ({
      kind: resource.kind,
      ...(resource.path ? { path: resource.path.toLowerCase() } : {}),
      ...(resource.pattern ? { pattern: resource.pattern.toLowerCase() } : {}),
      ...(resource.old_path ? { old_path: resource.old_path.toLowerCase(), new_path: resource.new_path.toLowerCase() } : {}),
      ...(resource.resource_key ? { resource_key: resource.resource_key.toLowerCase() } : {}),
    })))
  }
  return value
}

const snapshot = (overrides = {}) => ({
  schema_version: 'session-admission-snapshot/v1',
  plan_id: 'plan:one',
  generation: 1,
  repo_identity_digest: SHA256_A,
  common_dir_digest: SHA256_A,
  baseline_sha: SHA1_A,
  writer_cap: 2,
  runtime_cap: 3,
  leases: [],
  managed_branches: [],
  ...overrides,
})

const task3PlanRecord = () => {
  const plan = {
    schema_version: FABRIC_SCHEMA_VERSION,
    plan_id: 'plan:one',
    generation: 1,
    repo_identity: { full_name: 'acme/bim', repository_id: 1, common_dir_digest: SHA256_A },
    created_at: NOW,
    coordinator_session: 'session:coordinator',
    baseline_ref: 'origin/main',
    resolved_baseline_sha: SHA1_A,
    tasks: [{
      task_id: 'task:task3-one',
      outcome: 'task3-admission-contract',
      provider_preference: 'codex',
      owner_session: 'session:task3-one',
      scope: {
        owning_service: 'delivery-fabric',
        public_entrypoint: 'scripts/lib/parallel-delivery-fabric-registry.mjs',
        resources: [{ kind: 'path', path: 'src/task3-one.mjs' }],
        expected_tests: ['test:admission'],
        e2e_required: false,
      },
      dependencies: [],
      risk: 'bounded',
      e2e_required: false,
    }],
    requested_capacity: { writers: 1, runtime_leases: 0 },
    branch_profile: 'trunk',
    acceptance_criteria: ['criterion:task3-admission'],
    promotion_mode: 'single_pr',
    requested_execution_level: 'plan_only',
    authority_reference: 'authority:task3-plan',
    governance_source_refs: ['openspec:parallel-delivery-fabric'],
  }
  const base = {
    schema_version: 'delivery-plan-registry/v1',
    generation: 1,
    nonce: NONCE('task3-plan'),
    created_at: NOW,
    updated_at: NOW,
    plan,
    plan_digest: digestCanonical(plan),
    execution: { level: 'plan_only', side_effect_class: 'CONTROL_METADATA' },
  }
  return { ...base, canonical_digest: digestCanonical(base) }
}

const createInMemoryTask3LeaseRegistry = ({ rejectFirstFinalization = false } = {}) => {
  let current = {
    ref: 'refs/ai-bim/session-leases',
    oid: ZERO_OID,
    record: null,
  }
  let nextOid = SHA1_A
  let rejectFinalization = rejectFirstFinalization
  const plan = { ref: 'refs/ai-bim/delivery-plans', oid: SHA1_D, record: task3PlanRecord() }
  const store = {
    commonDirDigest: SHA256_A,
    async read(ref) {
      if (ref === plan.ref) return clone(plan)
      if (typeof ref === 'string' && ref.startsWith(`${plan.ref}/`)) return { ref, oid: ZERO_OID, record: null }
      return clone(current)
    },
    async cas({ expected_oid: expectedOid, record }) {
      if (rejectFinalization && Object.values(record.leases || {}).some((leaseRecord) => leaseRecord.state === 'RELEASED')) {
        rejectFinalization = false
        return {
          status: 'CONFLICT',
          reason: 'CAS_CONFLICT',
          expected_oid: expectedOid,
          actual_oid: current.oid,
          current: clone(current),
        }
      }
      if (expectedOid !== current.oid) {
        return {
          status: 'CONFLICT',
          reason: 'CAS_CONFLICT',
          expected_oid: expectedOid,
          actual_oid: current.oid,
          current: clone(current),
        }
      }
      const oid = nextOid
      nextOid = nextOid === SHA1_A ? SHA1_B : nextOid === SHA1_B ? SHA1_C : SHA1_D
      current = { ref: current.ref, oid, record: clone(record) }
      return { status: 'STORED', ref: current.ref, oid, previous_oid: expectedOid, record: clone(record) }
    },
    async casGuarded({ ref, expected_oid: expectedOid, record, guard_ref: guardRef, guard_oid: guardOid }) {
      if (guardRef !== plan.ref || guardOid !== plan.oid) {
        return { status: 'CONFLICT', reason: 'GUARD_CONFLICT', ref, expected_oid: expectedOid, actual_oid: current.oid, actual_guard_oid: ZERO_OID }
      }
      return this.cas({ ref, expected_oid: expectedOid, record })
    },
  }
  const clock = { now: () => NOW }
  const registry = createLeaseRegistry({ store, clock })
  return { store, registry }
}

const scopeDigestFromResourceKeys = (resourceKeys) => {
  try {
    return digestCanonical(normalizeScope(resourceKeys.map((key) => {
      const separator = key.indexOf(':')
      const kind = key.slice(0, separator)
      const value = key.slice(separator + 1)
      if (kind === 'path') return { kind, path: value }
      if (kind === 'glob') return { kind, pattern: value }
      if (kind === 'rename') {
        const [old_path, new_path] = value.split(':')
        return { kind, old_path, new_path }
      }
      return { kind, resource_key: value }
    })))
  } catch { return SHA256_C }
}

const task3LeaseRequest = (store, overrides = {}) => {
  const resourceKeys = overrides.resource_keys ?? ['path:src/task3-one.mjs']
  return {
    lease_id: overrides.lease_id ?? 'lease:task3-one',
    plan_id: overrides.plan_id ?? 'plan:one',
    generation: overrides.generation ?? 1,
    task_id: overrides.task_id ?? 'task:task3-one',
    provider: overrides.provider ?? 'codex',
    owner_session: overrides.owner_session ?? 'session:task3-one',
    provider_session_id: overrides.provider_session_id ?? 'provider:task3-one',
    execution_context_id: overrides.execution_context_id ?? 'context:task3-one',
    context_attestation_ref: overrides.context_attestation_ref ?? 'attestation:task3-one',
    common_dir_digest: overrides.common_dir_digest ?? store.commonDirDigest,
    worktree_id: overrides.worktree_id ?? 'worktree:task3-one',
    worktree_path_digest: overrides.worktree_path_digest ?? SHA256_B,
    branch: overrides.branch ?? 'codex/task3-one',
    scope_digest: overrides.scope_digest ?? scopeDigestFromResourceKeys(resourceKeys),
    head_sha: overrides.head_sha ?? SHA1_A,
    resource_keys: resourceKeys,
    nonce: overrides.nonce ?? NONCE('task3-one'),
    expected_plan_oid: overrides.expected_plan_oid ?? SHA1_D,
  }
}

const canonicalTask3AdmissionRecord = async (leaseOverrides = [{}]) => {
  const { store, registry } = createInMemoryTask3LeaseRegistry()
  for (const [index, overrides] of leaseOverrides.entries()) {
    const suffix = `admission-${index + 1}`
    const admitted = await registry.admit(task3LeaseRequest(store, {
      lease_id: `lease:${suffix}`,
      task_id: `task:${suffix}`,
      owner_session: `session:${suffix}`,
      provider_session_id: `provider:${suffix}`,
      execution_context_id: `context:${suffix}`,
      context_attestation_ref: `attestation:${suffix}`,
      worktree_id: `worktree:${suffix}`,
      worktree_path_digest: index % 2 === 0 ? SHA256_B : SHA256_D,
      branch: `codex/${suffix}`,
      resource_keys: [`path:src/${suffix}.mjs`],
      nonce: NONCE(suffix),
      ...overrides,
    }))
    assert.equal(admitted.status, 'ADMITTED')
  }
  return (await registry.inspect()).record
}

const restampTask3Record = (record) => {
  delete record.canonical_digest
  record.canonical_digest = digestCanonical(record)
  return record
}

const releaseTask3Lease = async ({ rejectFirstFinalization = false, leaseId = 'lease:task3-hostile' } = {}) => {
  const { store, registry } = createInMemoryTask3LeaseRegistry({ rejectFirstFinalization })
  const suffix = leaseId.slice('lease:'.length)
  const admitted = await registry.admit(task3LeaseRequest(store, {
    lease_id: leaseId,
    task_id: `task:${suffix}`,
    owner_session: `session:${suffix}`,
    provider_session_id: `provider:${suffix}`,
    execution_context_id: `context:${suffix}`,
    context_attestation_ref: `attestation:${suffix}`,
    worktree_id: `worktree:${suffix}`,
    branch: `codex/${suffix}`,
    resource_keys: [`path:src/${suffix}.mjs`],
    nonce: NONCE(suffix),
  }))
  assert.equal(admitted.status, 'ADMITTED')
  const ending = await registry.endRequest({
    lease_id: leaseId,
    expected_oid: admitted.oid,
    nonce: NONCE(`${suffix}-end`),
    reason: 'handoff',
    handoff_or_candidate_reference: `handoff:${suffix}`,
    owner_end_attestation: endAttestation(admitted.lease),
  })
  assert.equal(ending.status, 'END_REQUESTED')
  const releasingRegistry = createLeaseRegistry({
    store,
    clock: { now: () => NOW },
    ownerEndAttestor: { async verify({ attestation }) { return { verdict: 'TRUSTED', attestation: clone(attestation) } } },
    executionEnvelope: {
      async revoke({ expected_envelope_oid, expected_transition_sequence }) {
        return {
          status: 'REVOKED', previous_oid: expected_envelope_oid, oid: SHA1_D,
          transition_sequence: expected_transition_sequence + 1,
          revocation_epoch: 0,
          in_flight_command: false,
        }
      },
    },
  })
  const released = await releasingRegistry.release({
    lease_id: leaseId,
    expected_oid: ending.oid,
    expected_envelope_oid: SHA1_C,
    expected_envelope_transition_sequence: 0,
    attestation: {
      attestation_ref: `attestation:${suffix}-end`, attestation_digest: SHA256_A,
      issuer_id: `attestor:${suffix}-end`, issuer_version: 'owner-end/v1',
      owner_session: `session:${suffix}`, provider: 'codex', provider_session_id: `provider:${suffix}`,
      execution_context_id: `context:${suffix}`, lease_id: leaseId, generation: 1,
      head_sha: SHA1_A, scope_digest: admitted.lease.scope_digest, worktree_path_digest: SHA256_B,
      observed_at: NOW, expires_at: LATER, nonce: NONCE(`${suffix}-attestation`), revocation_epoch: 0,
    },
  })
  return { released, inspected: await releasingRegistry.inspect() }
}

const assertStatus = (result, status, reason = undefined) => {
  assert.equal(result.status, status)
  if (reason !== undefined) assert.equal(result.reason, reason)
}

const assertShadowActivationHold = (result, reason) => {
  assertStatus(result, 'HELD_EXTERNAL_ACTIVATION', reason)
  assert.equal(result.shadow_validation, 'VALID')
  assert.equal(result.requires_durable_consumption, true)
  assert.match(result.reservation_digest, /^[a-f0-9]{64}$/u)
  assert.equal(Object.isFrozen(result), true)
  const reservationDigest = result.reservation_digest
  assert.equal(Reflect.set(result, 'reservation_digest', SHA256_A), false)
  assert.equal(result.reservation_digest, reservationDigest)
  for (const key of ['intent', 'operation', 'retry', 'cas', 'nonce', 'effect', 'rebind', 'mutation_ready']) {
    assert.equal(Object.hasOwn(result, key), false, `${key} must not be emitted before durable consumption`)
  }
}

const executionEnvelope = (overrides = {}) => ({
  schema_version: 'execution-envelope/v1',
  envelope_id: 'envelope:one',
  plan_id: 'plan:one',
  generation: 1,
  task_id: 'task:one',
  owner_session: 'session:one',
  provider: 'codex',
  provider_session_id: 'provider:one',
  execution_context_id: 'context:one',
  context_attestation_digest: SHA256_A,
  issuer_id: 'issuer:control-plane',
  issuer_version: 'fabric-control-plane/v1',
  authority_reference: 'authority:plan',
  authority_digest: SHA256_B,
  issued_at: NOW,
  expires_at: LATER_2,
  revocation_epoch: 0,
  command_nonce: NONCE('envelope-command'),
  authorized_highest_level: 'submit_delivery',
  current_level: 'plan_only',
  transition_sequence: 0,
  expected_previous_envelope_oid: ZERO_OID,
  expected_lease_registry_oid: SHA1_C,
  repo_identity_digest: SHA256_A,
  common_dir_digest: SHA256_B,
  worktree_id: null,
  worktree_path_digest: null,
  branch: null,
  baseline_sha: SHA1_A,
  head_sha: null,
  scope_digest: EXECUTION_SCOPE_DIGEST,
  lease_id: null,
  allowed_remote: 'origin',
  allowed_repository: 'acme/bim',
  allowed_base: 'origin/main',
  expected_remote_ref: null,
  expected_remote_sha: null,
  promotion_mode: 'single_pr',
  external_capability_reference: null,
  side_effect_class: 'CONTROL_METADATA',
  ...overrides,
})

const authority = (overrides = {}) => ({
  authority_issued: true,
  plan_id: 'plan:one',
  issuer_id: 'issuer:control-plane',
  issuer_version: 'fabric-control-plane/v1',
  issuer_source_digest: SHA256_C,
  authority_reference: 'authority:plan',
  authority_digest: SHA256_B,
  expected_envelope_oid: SHA1_A,
  expected_lease_registry_oid: SHA1_C,
  generation: 1,
  task_id: 'task:one',
  owner_session: 'session:one',
  provider: 'codex',
  provider_session_id: 'provider:one',
  execution_context_id: 'context:one',
  context_attestation_digest: SHA256_A,
  repo_identity_digest: SHA256_A,
  common_dir_digest: SHA256_B,
  worktree_id: null,
  worktree_path_digest: null,
  branch: null,
  baseline_sha: SHA1_A,
  head_sha: null,
  scope_digest: EXECUTION_SCOPE_DIGEST,
  lease_id: null,
  allowed_remote: 'origin',
  allowed_repository: 'acme/bim',
  allowed_base: 'origin/main',
  expected_remote_ref: null,
  expected_remote_sha: null,
  promotion_mode: 'single_pr',
  command_nonce: NONCE('envelope-command'),
  current_level: 'plan_only',
  side_effect_class: 'CONTROL_METADATA',
  next_lease_id: 'lease:one',
  next_scope_digest: EXECUTION_SCOPE_DIGEST,
  authorized_highest_level: 'submit_delivery',
  issued_at: NOW,
  expires_at: LATER_2,
  revocation_epoch: 0,
  revoked: false,
  ...overrides,
})

const nextEnvelopeFor = (current, overrides = {}) => ({
  ...clone(current),
  envelope_id: 'envelope:next',
  command_nonce: NONCE('next-envelope'),
  current_level: 'implement_local',
  transition_sequence: 1,
  expected_previous_envelope_oid: SHA1_A,
  worktree_id: 'worktree:one',
  worktree_path_digest: SHA256_C,
  branch: 'codex/task-one',
  head_sha: SHA1_B,
  lease_id: 'lease:one',
  side_effect_class: 'CANDIDATE_FILESYSTEM',
  ...overrides,
})

const scopeRevalidation = (current, phase = 'push', overrides = {}) => ({
  schema_version: 'scope-revalidation/v1',
  phase,
  evidence_id: `scope-revalidation:${phase}`,
  changed_evidence_ref: 'scope-evidence:task-one',
  plan_id: current.plan_id,
  generation: current.generation,
  task_id: current.task_id,
  lease_id: current.lease_id || 'lease:one',
  execution_context_id: current.execution_context_id,
  worktree_id: current.worktree_id || 'worktree:one',
  branch: current.branch || 'codex/task-one',
  head_sha: current.head_sha || SHA1_B,
  scope_digest: current.scope_digest,
  declared_resources: clone(EXECUTION_SCOPE),
  changed_evidence: EXECUTION_CHANGED_EVIDENCE,
  changed_evidence_digest: EXECUTION_CHANGED_EVIDENCE_DIGEST,
  observed_at: NOW,
  expires_at: LATER,
  ...overrides,
})

const scopeRevalidationContext = (current, phase = 'commit', overrides = {}) => ({
  phase,
  plan_id: current.plan_id,
  generation: current.generation,
  task_id: current.task_id,
  lease_id: current.lease_id || 'lease:one',
  execution_context_id: current.execution_context_id,
  worktree_id: current.worktree_id || 'worktree:one',
  branch: current.branch || 'codex/task-one',
  head_sha: current.head_sha || SHA1_B,
  scope_digest: current.scope_digest,
  declared_resources: clone(EXECUTION_SCOPE),
  now: NOW,
  ...overrides,
})

const advanceCommand = (current, overrides = {}) => ({
  type: 'advance',
  command_id: 'command:one',
  next_level: Object.hasOwn(overrides, 'next_level') ? overrides.next_level : overrides.next_envelope?.current_level || 'implement_local',
  expected_envelope_id: current.envelope_id,
  expected_transition_sequence: current.transition_sequence,
  expected_envelope_oid: SHA1_A,
  expected_lease_registry_oid: current.expected_lease_registry_oid,
  command_nonce: current.command_nonce,
  now: NOW,
  authority: authority(),
  next_envelope: Object.hasOwn(overrides, 'next_envelope') ? overrides.next_envelope : nextEnvelopeFor(current),
  ...(current.current_level === 'plan_only'
    ? {}
    : { scope_revalidation: scopeRevalidation(current, (overrides.next_level || overrides.next_envelope?.current_level) === 'push_owned_branch' ? 'push' : 'handoff') }),
  ...overrides,
})

const advanceWithReservation = (current, overrides = {}, reservation = undefined) => (
  advanceExecutionEnvelope(current, advanceCommand(current, overrides), reservation)
)

const SHADOW_SOURCE_DIGEST = 'f'.repeat(64)
const SHADOW_SIGNATURE_EXECUTION = 'AAwYbOXzBjCl54DBsBsD/VmyGdbnnNQybtvlyUCSA7FsNd4l5Et4SPbofRJ8E6sdMPj+YSeqJTxki0vVcBVhDg=='

const shadowReservation = (kind, payload, overrides = {}) => {
  const reservation = {
    schema_version: 'fabric-shadow-reservation/v1',
    reservation_id: `reservation:${kind}-one`,
    reservation_kind: kind,
    mode: 'shadow',
    key_id: 'ed25519:shadow-vector-1',
    issuer_id: 'issuer:shadow-control-plane',
    issuer_version: 'fabric-shadow/v1',
    source_digest: SHADOW_SOURCE_DIGEST,
    authority_reference: 'authority:shadow-reservation',
    revocation_epoch: 0,
    issued_at: NOW,
    expires_at: LATER,
    nonce: NONCE(`shadow-${kind}`),
    sequence: 1,
    status: 'ISSUED',
    revoked: false,
    payload_digest: digestCanonical(payload),
    payload,
    signature: kind === 'execution' ? SHADOW_SIGNATURE_EXECUTION : 'A'.repeat(88),
    ...overrides,
  }
  return reservation
}

const shadowExecutionReservation = (current, command, next, overrides = {}) => {
  const reservation = shadowReservation('execution', {})
  const payload = {
    schema_version: 'fabric-shadow-execution-payload/v1',
    reservation_id: reservation.reservation_id,
    status: reservation.status,
    observed_at: reservation.issued_at,
    expires_at: reservation.expires_at,
    reservation_nonce: reservation.nonce,
    reservation_sequence: reservation.sequence,
    plan_id: current.plan_id,
    generation: current.generation,
    task_id: current.task_id,
    owner_session: current.owner_session,
    provider: current.provider,
    provider_session_id: current.provider_session_id,
    execution_context_id: current.execution_context_id,
    context_attestation_digest: current.context_attestation_digest,
    repo_identity_digest: current.repo_identity_digest,
    common_dir_digest: current.common_dir_digest,
    worktree_id: next.worktree_id,
    worktree_path_digest: next.worktree_path_digest,
    branch: next.branch,
    baseline_sha: current.baseline_sha,
    current_head_sha: current.head_sha,
    next_head_sha: next.head_sha,
    scope_digest: current.scope_digest,
    lease_id: next.lease_id,
    current_envelope_oid: command.expected_envelope_oid,
    expected_lease_registry_oid: command.expected_lease_registry_oid,
    command_id: command.command_id,
    command_nonce: command.command_nonce,
    next_command_nonce: next.command_nonce,
    from_level: current.current_level,
    to_level: next.current_level,
    transition_sequence: next.transition_sequence,
    side_effect_class: next.side_effect_class,
    side_effect_digest: digestCanonical({ side_effect_class: next.side_effect_class, to_level: next.current_level }),
    scope_evidence_digest: command.scope_revalidation?.changed_evidence_digest || digestCanonical({ scope_digest: current.scope_digest }),
    next_envelope_digest: digestCanonical(next),
  }
  return shadowReservation('execution', payload, overrides)
}

const SHADOW_SIGNATURE_MANAGED_RENEW = 'nhPzWt4xv0+5uyNvyzeYTS0ath6DozNMIQ0/r47gRM6sa0+9kY7kTbCxDFFrtMZKeIu378xLihp8mnH3fo+qDA=='
const SHADOW_SIGNATURE_MANAGED_ADVANCE = '3Im1oGtLAnBJn0YekI2+Z5lI+VWny9zIa0IOPtbu5ESGC8uBX6vN5p43J/ar5MfNftv/FjBgy8R9pitFCrJvCQ=='
const SHADOW_SIGNATURE_MANAGED_REBASE = 'K9wJi3LD1Ym9vYhh1DM31g7oa0TjTuVofWM66l2V7oKgjEozpmjqMXFbWweLew21Dqfotkv+JenEu/3w6GoBBQ=='

const shadowManagedSignature = (action) => action === 'renew'
  ? SHADOW_SIGNATURE_MANAGED_RENEW
  : action === 'rebase'
    ? SHADOW_SIGNATURE_MANAGED_REBASE
    : SHADOW_SIGNATURE_MANAGED_ADVANCE

const shadowManagedReservation = (record, command, overrides = {}) => {
  const reservation = shadowReservation('managed', {}, {
    signature: shadowManagedSignature(command.action),
    ...overrides,
  })
  const payload = {
    schema_version: 'fabric-shadow-managed-payload/v1',
    reservation_id: reservation.reservation_id,
    status: reservation.status,
    observed_at: reservation.issued_at,
    expires_at: reservation.expires_at,
    reservation_nonce: reservation.nonce,
    reservation_sequence: reservation.sequence,
    record_digest: digestCanonical(record),
    expected_registry_oid: command.expected_registry_oid,
    transition_sequence: command.transition_sequence,
    operation: command.action,
    owner_authority: record.owner_authority,
    managed_base_lease_id: record.managed_base_lease_id,
    base_ref: record.branch,
    base_sha: record.base_sha,
    current_head_sha: record.current_head_sha,
    protection_profile_digest: record.protection_profile_digest,
    generation: record.generation,
    new_expiry: command.action === 'renew' ? command.requested_expires_at : null,
    candidate_branch: command.action === 'renew' ? null : command.candidate_branch,
    candidate_base_sha: command.action === 'renew' ? null : command.candidate_base_sha,
    candidate_old_head_sha: command.action === 'renew' ? null : command.candidate_old_head_sha,
    candidate_new_head_sha: command.action === 'renew' ? null : command.candidate_new_head_sha,
    expected_remote_ref: command.action === 'renew' ? null : command.expected_remote_ref,
    expected_remote_sha: command.action === 'renew' ? null : command.expected_remote_sha,
    new_generation: command.action === 'renew' ? null : command.new_generation,
    commit_range_start: command.action === 'renew' ? null : command.commit_range_start,
    commit_range_end: command.action === 'renew' ? null : command.commit_range_end,
    evidence_invalidation: command.action === 'renew' ? [] : command.evidence_invalidation,
    candidate_lineage: command.action === 'renew' ? [] : command.candidate_lineage,
  }
  return shadowReservation('managed', payload, {
    signature: shadowManagedSignature(command.action),
    ...overrides,
  })
}

const managedOperationCommand = (action, overrides = {}) => ({
  schema_version: 'managed-branch-command/v1',
  action,
  operation_id: `operation:${action}-one`,
  owner_authority: 'authority:managed-branch',
  managed_base_lease_id: 'lease:managed-base',
  current_generation: 1,
  expected_registry_oid: SHA1_C,
  expected_base_sha: SHA1_A,
  expected_head_sha: SHA1_B,
  expected_protection_profile_digest: SHA256_C,
  transition_sequence: 0,
  nonce: NONCE(`managed-${action}`),
  now: NOW,
  candidate_branch: 'codex/task-one',
  candidate_base_sha: SHA1_B,
  candidate_old_head_sha: SHA1_B,
  candidate_new_head_sha: SHA1_D,
  expected_remote_ref: 'codex/task-one',
  expected_remote_sha: SHA1_B,
  new_generation: 2,
  commit_range_start: SHA1_B,
  commit_range_end: SHA1_D,
  evidence_invalidation: ['checks', 'review', 'train', 'e2e'],
  candidate_lineage: ['commit:old', 'commit:new'],
  cas_decision: {
    operation_id: `operation:${action}-one`,
    expected_registry_oid: SHA1_C,
    expected_transition_sequence: 0,
    nonce: NONCE(`managed-${action}`),
    winner: true,
  },
  ...(action === 'renew' ? { requested_expires_at: LATER_2 } : {}),
  ...overrides,
})

test('normalizeScope folds Windows paths, preserves POSIX case, and canonicalizes shared resources', () => {
  const raw = [
    { kind: 'path', path: 'Src\\Feature\\One.ts' },
    { kind: 'glob', pattern: 'SRC/**/\u0060*.TS' },
    { kind: 'rename', old_path: 'Docs\\Old.md', new_path: 'docs/New.md' },
    { kind: 'shared_contract', resource_key: 'contract:Delivery-Plan' },
    { kind: 'runtime', resource_key: 'runtime:offset-1' },
  ]
  assert.deepEqual(normalizeScope(raw), [
    { kind: 'glob', pattern: 'SRC/**/\u0060*.TS' },
    { kind: 'path', path: 'src/feature/one.ts' },
    { kind: 'rename', old_path: 'docs/old.md', new_path: 'docs/New.md' },
    { kind: 'runtime', resource_key: 'runtime:offset-1' },
    { kind: 'shared_contract', resource_key: 'contract:delivery-plan' },
  ])
})

test('normalizeScope rejects traversal, absolute paths, duplicates, and unknown resources', () => {
  for (const resources of [
    [{ kind: 'path', path: '..\\secret.txt' }],
    [{ kind: 'path', path: 'C:\\secret.txt' }],
    [{ kind: 'path', path: 'src/a.mjs' }, { kind: 'path', path: 'SRC\\a.mjs' }],
    [{ kind: 'glob', pattern: 'src/[abc' }],
    [{ kind: 'glob', pattern: 'src/{a,b' }],
    [{ kind: 'glob', pattern: 'src/[]/*.mjs' }],
    [{ kind: 'glob', pattern: 'src/orphan]/*.mjs' }],
    [{ kind: 'unknown', resource_key: 'contract:x' }],
  ]) {
    assert.throws(() => normalizeScope(resources), /scope|resource|path|duplicate|invalid/i)
  }
})

test('findScopeConflicts detects exact, parent, glob, rename, shared, runtime, and disjoint scopes', () => {
  const cases = [
    [[{ kind: 'path', path: 'src/Feature.ts' }], [{ kind: 'path', path: 'SRC/feature.ts' }], 'DISJOINT'],
    [[{ kind: 'path', path: 'src\\Feature.ts' }], [{ kind: 'path', path: 'SRC\\feature.ts' }], 'CONFLICT'],
    [[{ kind: 'path', path: 'src' }], [{ kind: 'path', path: 'src/new.ts' }], 'CONFLICT'],
    [[{ kind: 'glob', pattern: 'src/**/*.ts' }], [{ kind: 'path', path: 'src/new.ts' }], 'CONFLICT'],
    [[{ kind: 'glob', pattern: 'src/**/*.ts' }], [{ kind: 'glob', pattern: 'tests/**/*.ts' }], 'DISJOINT'],
    [[{ kind: 'glob', pattern: 'src*/*.mjs' }], [{ kind: 'path', path: 'src-other/a.mjs' }], 'CONFLICT'],
    [[{ kind: 'glob', pattern: 'src*/*.mjs' }], [{ kind: 'path', path: 'src-other' }], 'CONFLICT'],
    [[{ kind: 'path', path: 'src-other' }], [{ kind: 'glob', pattern: 'src*/*.mjs' }], 'CONFLICT'],
    [[{ kind: 'glob', pattern: 'foo?bar/*.mjs' }], [{ kind: 'glob', pattern: 'fooxbar/*.mjs' }], 'CONFLICT'],
    [[{ kind: 'glob', pattern: 'foo?bar/*.mjs' }], [{ kind: 'path', path: 'fooxbar' }], 'CONFLICT'],
    [[{ kind: 'glob', pattern: 'src[0-9]/*.mjs' }], [{ kind: 'path', path: 'src1/a.mjs' }], 'CONFLICT'],
    [[{ kind: 'glob', pattern: 'src[0-9]/*.mjs' }], [{ kind: 'path', path: 'src1' }], 'CONFLICT'],
    [[{ kind: 'rename', old_path: 'src/old.ts', new_path: 'src/new.ts' }], [{ kind: 'path', path: 'src/new.ts' }], 'CONFLICT'],
    [[{ kind: 'shared_contract', resource_key: 'contract:api' }], [{ kind: 'exported_symbol', resource_key: 'contract:api' }], 'CONFLICT'],
    [[{ kind: 'runtime', resource_key: 'runtime:offset-1' }], [{ kind: 'runtime', resource_key: 'runtime:offset-1' }], 'CONFLICT'],
  ]
  for (const [left, right, expected] of cases) assert.equal(findScopeConflicts(left, right).status, expected)
})

test('findScopeConflicts holds unknown overlap instead of optimistic disjointness', () => {
  assertStatus(
    findScopeConflicts([{ kind: 'future-resource', resource_key: 'future:x' }], [{ kind: 'path', path: 'src/x.ts' }]),
    'UNKNOWN',
    'SCOPE_OVERLAP_UNKNOWN',
  )
})

test('AC-06 — indeterminate admission overlap queues without exposing scope or mutating the registry', async () => {
  const existingPath = `src/${'a'.repeat(200)}`
  const unknownPattern = `src/${'*?'.repeat(250)}`
  const record = await canonicalTask3AdmissionRecord([{ resource_keys: [`path:${existingPath}`] }])
  const before = clone(record)
  const result = evaluateAdmission(record, request({ scope: [{ kind: 'glob', pattern: unknownPattern }] }))

  assertStatus(result, 'QUEUED_FOR_LEASE', 'SCOPE_OVERLAP_UNKNOWN')
  assert.deepEqual(Object.keys(result).sort(), ['reason', 'status'])
  assert.equal(JSON.stringify(result).includes(unknownPattern), false)
  assert.deepEqual(record, before)
})

test('5H — evaluateAdmission uses canonical Task3 records for disjoint writers and resource ownership', async () => {
  const oneSeat = await canonicalTask3AdmissionRecord()
  assertStatus(evaluateAdmission(oneSeat, request()), 'ADMITTED')

  const full = await canonicalTask3AdmissionRecord([
    {},
    { provider: 'claude' },
  ])
  assertStatus(evaluateAdmission(full, request({
    provider: 'claude',
    generation: full.generation,
    lease_id: 'lease:third',
    owner_session: 'session:third',
    provider_session_id: 'provider:third',
    execution_context_id: 'context:third',
    worktree_id: 'worktree:third',
    worktree_path_digest: SHA256_C,
    branch: 'codex/task-three',
    scope: [{ kind: 'path', path: 'src/task-three.mjs' }],
  })), 'ADMITTED')

  const occupied = await canonicalTask3AdmissionRecord()
  const existing = Object.values(occupied.leases)[0]
  assertStatus(evaluateAdmission(occupied, request({
    lease_id: 'lease:same-branch',
    owner_session: 'session:same-branch',
    provider_session_id: 'provider:same-branch',
    execution_context_id: 'context:same-branch',
    worktree_id: 'worktree:same-branch',
    worktree_path_digest: SHA256_C,
    branch: existing.branch,
    scope: [{ kind: 'path', path: 'src/other.mjs' }],
  })), 'QUEUED_FOR_LEASE', 'BRANCH_CONTENTION')

  const overlap = await canonicalTask3AdmissionRecord([{ resource_keys: ['path:src/existing.mjs'] }])
  assertStatus(evaluateAdmission(overlap, request({ scope: [{ kind: 'path', path: 'src/existing.mjs' }] })), 'QUEUED_FOR_LEASE', 'RESOURCE_CONFLICT')
})

test('5H — local admission snapshots are never an authority source', () => {
  assertStatus(evaluateAdmission(snapshot(), request()), 'HELD_EXECUTION_CONTEXT', 'SNAPSHOT_REGISTRY_INVALID')
})

test('5I — admission source has no retired local snapshot grammar or renew future mutation', () => {
  const source = readFileSync(new URL('../../lib/parallel-delivery-fabric-admission.mjs', import.meta.url), 'utf8')
  assert.equal(source.includes('task3AdmissionSnapshot'), false)
  assert.equal(source.includes('session-admission-snapshot/v1'), false)
  assert.equal(source.includes('const updated = clone(record)'), false)
})

test('5H — canonical Task3 records preserve tuple, topology, and identity holds', async () => {
  const record = await canonicalTask3AdmissionRecord()
  const existing = Object.values(record.leases)[0]
  assertStatus(evaluateAdmission(record, request({ lease_id: existing.lease_id })), 'HELD_CONFLICT', 'DUPLICATE_EXECUTION_TUPLE')
  assertStatus(evaluateAdmission(record, request({ common_dir_digest: SHA256_B })), 'HELD_TOPOLOGY_UNSUPPORTED', 'COMMON_DIR_MISMATCH')
  assertStatus(evaluateAdmission(record, request({ branch: 'main' })), 'HELD_EXECUTION_CONTEXT', 'IDENTITY_BINDING_INVALID')
})

test('5H — runtime, managed, and parent authority require their dedicated durable seams', async () => {
  const record = await canonicalTask3AdmissionRecord()
  assertStatus(evaluateAdmission(record, request({ runtime_kind: 'integration_train' })), 'HELD_RUNTIME', 'RUNTIME_REGISTRY_REQUIRED')
  assertStatus(evaluateAdmission(record, request({ runtime_kind: 'unknown_runtime' })), 'HELD_RUNTIME', 'RUNTIME_KIND_UNKNOWN')
  for (const candidate of [
    request({ branch: 'develop', target_branch: 'develop' }),
    request({ action: 'direct_deploy', base_ref: 'develop' }),
    request({ action: 'bulk_promotion', base_ref: 'develop' }),
  ]) assertStatus(evaluateAdmission(record, candidate), 'HELD_MANAGED_BRANCH', 'MANAGED_REGISTRY_REQUIRED')
  assertStatus(
    evaluateAdmission(record, request({ parent_base_sha: SHA1_A, evidence: { parent_base_sha: SHA1_A } })),
    'HELD_SCOPE_DRIFT',
    'PARENT_AUTHORITY_REQUIRED',
  )
})

const renewCommand = (overrides = {}) => ({
  schema_version: 'managed-branch-command/v1',
  action: 'renew',
  operation_id: 'operation:renew-one',
  owner_authority: 'authority:managed-branch',
  managed_base_lease_id: 'lease:managed-base',
  current_generation: 1,
  expected_registry_oid: SHA1_C,
  expected_base_sha: SHA1_A,
  expected_head_sha: SHA1_B,
  expected_protection_profile_digest: SHA256_C,
  transition_sequence: 0,
  nonce: NONCE('renew-one'),
  now: NOW,
  requested_expires_at: LATER_2,
  registry_cas_status: 'READY',
  cas_decision: {
    operation_id: 'operation:renew-one',
    expected_registry_oid: SHA1_C,
    expected_transition_sequence: 0,
    nonce: NONCE('renew-one'),
    winner: true,
  },
  ...overrides,
})

test('renewManagedBranch returns a CAS-bound intent that only extends expiry', () => {
  const original = managedBranch()
  const result = renewManagedBranch(original, renewCommand())
  assertStatus(result, 'HELD_EXTERNAL_ACTIVATION', 'RESERVATION_REQUIRED')
  assert.equal(result.operation, undefined)
  assert.deepEqual(original, managedBranch())
})

test('renewManagedBranch fails closed for missing fields, drift, replay, expiry, and forbidden mutation', () => {
  const cases = [
    ['owner', { owner_authority: 'authority:other' }, 'OWNER_MISMATCH'],
    ['lease', { managed_base_lease_id: 'lease:other' }, 'MANAGED_BASE_LEASE_REQUIRED'],
    ['head', { expected_head_sha: SHA1_D }, 'EXPECTED_HEAD_MISMATCH'],
    ['base', { expected_base_sha: SHA1_D }, 'EXPECTED_BASE_MISMATCH'],
    ['protection', { expected_protection_profile_digest: SHA256_D }, 'PROTECTION_PROFILE_DRIFT'],
    ['oid', { expected_registry_oid: SHA1_D }, 'REGISTRY_OID_REQUIRED'],
    ['nonce', { nonce: 'short' }, 'NONCE_INVALID'],
    ['expired', { now: LATER_2 }, 'MANAGED_BRANCH_EXPIRED'],
    ['cas', { registry_cas_status: 'CONFLICT' }, 'REGISTRY_CAS_CONFLICT'],
    ['mutation', { action: 'advance', requested_expires_at: LATER_2 }, 'MANAGED_OPERATION_INVALID'],
  ]
  for (const [label, patch, reason] of cases) assertStatus(renewManagedBranch(managedBranch(), renewCommand(patch)), 'HELD_MANAGED_BRANCH', reason, label)
  for (const field of ['owner_authority', 'base_ref', 'protection_profile_digest', 'generation', 'expires_at', 'current_head_sha']) {
    const record = managedBranch()
    delete record[field]
    assertStatus(renewManagedBranch(record, renewCommand()), 'HELD_MANAGED_BRANCH', 'MANAGED_BRANCH_INVALID', field)
  }
})

test('advanceExecutionEnvelope accepts only an authority-issued adjacent transition intent', () => {
  const current = executionEnvelope()
  const result = advanceExecutionEnvelope(current, advanceCommand(current))
  assertStatus(result, 'HELD_EXTERNAL_ACTIVATION', 'RESERVATION_REQUIRED')
  assert.equal(result.intent, undefined)
  assert.equal(Object.hasOwn(result, 'envelope'), false)
})

test('AC-38 — execution-envelope CAS rejects self/jump/replay/revoked/expired and binding drift', () => {
  const current = executionEnvelope()
  const cases = [
    ['self-issued', { authority: authority({ issuer_id: 'session:one' }) }, 'SELF_ISSUED'],
    ['self-authorized', { authority: authority({ authority_issued: false }) }, 'AUTHORITY_REQUIRED'],
    ['self-upgraded', { next_envelope: nextEnvelopeFor(current, { authorized_highest_level: 'open_draft_pr' }) }, 'AUTHORITY_LEVEL_MUTATION'],
    ['jump', { next_level: 'submit_delivery' }, 'NON_ADJACENT_TRANSITION'],
    ['replay', { replayed: true }, 'NONCE_REPLAY'],
    ['revoked', { authority: authority({ revoked: true }) }, 'ENVELOPE_REVOKED'],
    ['expired', { authority: authority({ expires_at: EXPIRED }) }, 'ENVELOPE_EXPIRED'],
    ['stale envelope OID', { expected_envelope_oid: SHA1_D }, 'ENVELOPE_OID_MISMATCH'],
    ['generation', { authority: authority({ generation: 2 }) }, 'GENERATION_MISMATCH'],
    ['wrong owner', { authority: authority({ owner_session: 'session:other' }) }, 'OWNER_SESSION_BINDING_MISMATCH'],
    ['wrong context', { authority: authority({ execution_context_id: 'context:other' }) }, 'EXECUTION_CONTEXT_ID_BINDING_MISMATCH'],
    ['target', { authority: authority({ allowed_base: 'develop' }) }, 'TARGET_BINDING_MISMATCH'],
    ['lease', { next_envelope: nextEnvelopeFor(current, { lease_id: 'lease:other' }) }, 'LEASE_BINDING_MISMATCH'],
    ['scope', { next_envelope: nextEnvelopeFor(current, { scope_digest: SHA256_C }) }, 'SCOPE_BINDING_MISMATCH'],
  ]
  for (const [label, patch, reason] of cases) {
    const result = advanceWithReservation(current, patch)
    assertStatus(result, 'HELD_EXECUTION_AUTHORITY', reason)
    assert.equal(result.intent, undefined, `${label} must not produce a mutation-ready intent`)
    assert.equal(Object.hasOwn(result, 'envelope'), false, `${label} must not expose a next envelope`)
  }
})

test('advanceExecutionEnvelope protects push-owned-branch and delivery sinks', () => {
  const current = executionEnvelope({ current_level: 'implement_local', transition_sequence: 1, expected_previous_envelope_oid: SHA1_A, worktree_id: 'worktree:one', worktree_path_digest: SHA256_C, branch: 'codex/task-one', head_sha: SHA1_B, lease_id: 'lease:one', side_effect_class: 'CANDIDATE_FILESYSTEM' })
  const next = nextEnvelopeFor(current, { current_level: 'push_owned_branch', transition_sequence: 2, expected_previous_envelope_oid: SHA1_A, expected_remote_ref: 'codex/task-one', expected_remote_sha: SHA1_B, side_effect_class: 'REMOTE_GIT_GITHUB' })
  const valid = advanceExecutionEnvelope(current, advanceCommand(current, { next_level: 'push_owned_branch', next_envelope: next, force_with_lease: true, authority: authority({ current_level: 'implement_local', worktree_id: 'worktree:one', worktree_path_digest: SHA256_C, branch: 'codex/task-one', head_sha: SHA1_B, lease_id: 'lease:one', expected_remote_ref: 'codex/task-one', expected_remote_sha: SHA1_B, side_effect_class: 'CANDIDATE_FILESYSTEM' }) }))
  assertStatus(valid, 'HELD_EXTERNAL_ACTIVATION', 'RESERVATION_REQUIRED')
  for (const [label, patch, reason] of [
    ['main', { next_envelope: { ...next, branch: 'main' }, authority: authority({ worktree_id: 'worktree:one', worktree_path_digest: SHA256_C, branch: 'main', head_sha: SHA1_B, lease_id: 'lease:one', expected_remote_ref: 'main', expected_remote_sha: SHA1_B, side_effect_class: 'REMOTE_GIT_GITHUB' }) }, 'PROTECTED_BRANCH_FORBIDDEN'],
    ['other branch', { next_envelope: { ...next, branch: 'codex/other' }, authority: authority({ worktree_id: 'worktree:one', worktree_path_digest: SHA256_C, branch: 'codex/other', head_sha: SHA1_B, lease_id: 'lease:one', expected_remote_ref: 'codex/other', expected_remote_sha: SHA1_B, side_effect_class: 'REMOTE_GIT_GITHUB' }) }, 'BRANCH_BINDING_MISMATCH'],
    ['wrong remote sha', { next_envelope: { ...next, expected_remote_sha: SHA1_D }, authority: authority({ worktree_id: 'worktree:one', worktree_path_digest: SHA256_C, branch: 'codex/task-one', head_sha: SHA1_B, lease_id: 'lease:one', expected_remote_ref: 'codex/task-one', expected_remote_sha: SHA1_D, side_effect_class: 'REMOTE_GIT_GITHUB' }) }, 'EXPECTED_REMOTE_SHA_MISMATCH'],
    ['bare force', { force: true }, 'FORCE_WITH_LEASE_REQUIRED'],
    ['merge sink', { next_level: 'submit_delivery', action: 'merge' }, 'NON_ADJACENT_TRANSITION'],
    ['deploy sink', { action: 'deploy' }, 'FORBIDDEN_DELIVERY_SINK'],
  ]) assertStatus(advanceWithReservation(current, patch), 'HELD_EXECUTION_AUTHORITY', reason, label)
})

test('plan-only transition never synthesizes candidate bindings or performs effects', () => {
  const current = executionEnvelope()
  const withoutNext = advanceWithReservation(current, { next_envelope: undefined })
  assertStatus(withoutNext, 'HELD_EXECUTION_AUTHORITY', 'BOUND_NEXT_ENVELOPE_REQUIRED')
  const nullBindings = advanceWithReservation(current, { next_envelope: executionEnvelope({ envelope_id: 'envelope:null-next', current_level: 'implement_local', transition_sequence: 1, expected_previous_envelope_oid: SHA1_A, side_effect_class: 'CANDIDATE_FILESYSTEM' }) })
  assertStatus(nullBindings, 'HELD_EXECUTION_AUTHORITY', 'BOUND_NEXT_ENVELOPE_REQUIRED')
})

test('P1-5 requires force-with-lease and exact bindings for draft PR handoff', () => {
  const current = executionEnvelope({
    current_level: 'push_owned_branch',
    transition_sequence: 2,
    expected_previous_envelope_oid: SHA1_A,
    worktree_id: 'worktree:one',
    worktree_path_digest: SHA256_C,
    branch: 'codex/task-one',
    head_sha: SHA1_B,
    lease_id: 'lease:one',
    expected_remote_ref: 'codex/task-one',
    expected_remote_sha: SHA1_B,
    side_effect_class: 'REMOTE_GIT_GITHUB',
  })
  const next = nextEnvelopeFor(current, {
    current_level: 'open_draft_pr',
    transition_sequence: 3,
    expected_previous_envelope_oid: SHA1_A,
    expected_remote_ref: 'codex/task-one',
    expected_remote_sha: SHA1_B,
    side_effect_class: 'REMOTE_GIT_GITHUB',
  })
  const valid = advanceWithReservation(current, {
    next_level: 'open_draft_pr',
    force_with_lease: true,
    next_envelope: next,
    authority: authority({
      current_level: 'push_owned_branch',
      worktree_id: 'worktree:one',
      worktree_path_digest: SHA256_C,
      branch: 'codex/task-one',
      head_sha: SHA1_B,
      lease_id: 'lease:one',
      expected_remote_ref: 'codex/task-one',
      expected_remote_sha: SHA1_B,
      side_effect_class: 'REMOTE_GIT_GITHUB',
    }),
  })
  assertStatus(valid, 'HELD_EXTERNAL_ACTIVATION', 'RESERVATION_REQUIRED')
  assertStatus(advanceWithReservation(current, {
    next_level: 'open_draft_pr',
    next_envelope: { ...next, allowed_base: 'develop' },
    authority: authority({ current_level: 'push_owned_branch', allowed_base: 'develop', worktree_id: 'worktree:one', worktree_path_digest: SHA256_C, branch: 'codex/task-one', head_sha: SHA1_B, lease_id: 'lease:one', expected_remote_ref: 'codex/task-one', expected_remote_sha: SHA1_B, side_effect_class: 'REMOTE_GIT_GITHUB' }),
  }), 'HELD_EXECUTION_AUTHORITY', 'TARGET_BINDING_MISMATCH')
  assertStatus(advanceWithReservation(current, {
    next_level: 'open_draft_pr',
    next_envelope: { ...next, expected_remote_sha: SHA1_D },
    authority: authority({ current_level: 'push_owned_branch', worktree_id: 'worktree:one', worktree_path_digest: SHA256_C, branch: 'codex/task-one', head_sha: SHA1_B, lease_id: 'lease:one', expected_remote_ref: 'codex/task-one', expected_remote_sha: SHA1_D, side_effect_class: 'REMOTE_GIT_GITHUB' }),
  }), 'HELD_EXECUTION_AUTHORITY', 'EXPECTED_REMOTE_SHA_MISMATCH')
})

test('P1-5 submit delivery is only an evidence-bound handoff intent', () => {
  const current = executionEnvelope({
    current_level: 'open_draft_pr',
    transition_sequence: 3,
    expected_previous_envelope_oid: SHA1_A,
    worktree_id: 'worktree:one',
    worktree_path_digest: SHA256_C,
    branch: 'codex/task-one',
    head_sha: SHA1_B,
    lease_id: 'lease:one',
    expected_remote_ref: 'codex/task-one',
    expected_remote_sha: SHA1_B,
    side_effect_class: 'REMOTE_GIT_GITHUB',
  })
  const next = nextEnvelopeFor(current, {
    current_level: 'submit_delivery',
    transition_sequence: 4,
    expected_previous_envelope_oid: SHA1_A,
    expected_remote_ref: 'codex/task-one',
    expected_remote_sha: SHA1_B,
    external_capability_reference: 'cap:delivery',
    side_effect_class: 'REMOTE_GIT_GITHUB',
  })
  const authorityPatch = {
    current_level: 'open_draft_pr',
    worktree_id: 'worktree:one',
    worktree_path_digest: SHA256_C,
    branch: 'codex/task-one',
    head_sha: SHA1_B,
    lease_id: 'lease:one',
    expected_remote_ref: 'codex/task-one',
    expected_remote_sha: SHA1_B,
    side_effect_class: 'REMOTE_GIT_GITHUB',
  }
  const commandPatch = {
    next_level: 'submit_delivery',
    next_envelope: next,
    authority: authority(authorityPatch),
    evidence_refs: {
      independent_review: 'evidence:review',
      e2e: 'evidence:e2e',
      train: 'evidence:train',
      drift: 'evidence:drift',
      packet: 'evidence:packet',
    },
    external_capability_reference: 'cap:delivery',
  }
  assertStatus(advanceWithReservation(current, commandPatch), 'HELD_EXTERNAL_ACTIVATION', 'RESERVATION_REQUIRED')
  assertStatus(advanceWithReservation(current, { ...commandPatch, action: 'merge' }), 'HELD_EXECUTION_AUTHORITY', 'FORBIDDEN_DELIVERY_SINK')
  assertStatus(advanceWithReservation(current, { ...commandPatch, evidence_refs: undefined }), 'HELD_EXECUTION_AUTHORITY', 'SUBMIT_EVIDENCE_REQUIRED')
  assertStatus(advanceWithReservation(current, { ...commandPatch, next_envelope: { ...next, external_capability_reference: null } }), 'HELD_EXECUTION_AUTHORITY', 'SUBMIT_CAPABILITY_REQUIRED')
})

test('AC-06 — deterministic scope normalization and conservative overlap evidence', async () => {
  assert.equal(findScopeConflicts(
    [{ kind: 'path', path: 'Src\\Feature.ts' }],
    [{ kind: 'path', path: 'src/feature.ts' }],
  ).status, 'CONFLICT')
  assert.equal(findScopeConflicts(
    [{ kind: 'shared_contract', resource_key: 'contract:api' }],
    [{ kind: 'exported_symbol', resource_key: 'CONTRACT:API' }],
  ).status, 'CONFLICT')
  assert.equal(findScopeConflicts(
    [{ kind: 'glob', pattern: 'src/**/*.ts' }],
    [{ kind: 'path', path: 'src' }],
  ).status, 'CONFLICT')
  assert.equal(findScopeConflicts(
    [{ kind: 'glob', pattern: 'src/*.ts' }],
    [{ kind: 'glob', pattern: 'src/foo.*' }],
  ).status, 'CONFLICT')
  assert.equal(findScopeConflicts(
    [{ kind: 'rename', old_path: 'src', new_path: 'dest' }],
    [{ kind: 'path', path: 'src/file.ts' }],
  ).status, 'CONFLICT')
  assert.equal(findScopeConflicts(
    [{ kind: 'rename', old_path: 'src/file.ts', new_path: 'other/file.ts' }],
    [{ kind: 'path', path: 'src' }],
  ).status, 'CONFLICT')
  const pathological = `src/${'*?'.repeat(250)}`
  assert.equal(findScopeConflicts(
    [{ kind: 'glob', pattern: pathological }],
    [{ kind: 'path', path: `src/${'a'.repeat(508)}` }],
  ).status, 'UNKNOWN')

  const evidence = parseChangedScopeEvidence(
    `A\0src/new.ts\0R100\0src/old.ts\0dest/new.ts\0S\0exported_symbol:api\0`,
  )
  assert.equal(evidence.entries.length, 3)
  assert.ok(evidence.resources.some((resource) => resource.kind === 'path' && resource.path === 'src'))
  assert.ok(evidence.resources.some((resource) => resource.kind === 'rename' && resource.old_path === 'src/old.ts'))
  assertStatus(
    evaluateScopeDrift([{ kind: 'path', path: 'src' }], parseChangedScopeEvidence('A\0src/new.ts\0')),
    'SCOPE_EVIDENCE_ACCEPTED',
    'SCOPE_COVERED',
  )
  assertStatus(
    evaluateScopeDrift([{ kind: 'path', path: 'src' }], evidence),
    'HELD_SCOPE_DRIFT',
    'SCOPE_DRIFT',
  )
  assertStatus(
    evaluateScopeDrift([{ kind: 'path', path: 'src/Foo.mjs' }], parseChangedScopeEvidence('A\0src/foo.mjs\0')),
    'HELD_SCOPE_DRIFT',
    'SCOPE_DRIFT',
  )
  const record = await canonicalTask3AdmissionRecord()
  assertStatus(
    evaluateAdmission(record, request({ scope: [{ kind: 'path', path: 'src/allowed.ts' }], changed_evidence: 'A\0src/outside.ts\0' })),
    'HELD_SCOPE_DRIFT',
    'SCOPE_DRIFT',
  )

  for (const [label, frame] of [
    ['newline', 'A\0src/with\nnewline.ts\0'],
    ['missing terminator', 'A\0src/file.ts'],
    ['traversal', 'A\0../escape.ts\0'],
    ['absolute', 'A\0C:/escape.ts\0'],
    ['duplicate', 'A\0src/file.ts\0A\0SRC\\file.ts\0'],
    ['unknown status', 'Q\0src/file.ts\0'],
  ]) {
    assert.throws(() => parseChangedScopeEvidence(frame), /evidence|path|nul|duplicate|status|invalid/i, label)
  }
})

test('AC-07 — scope revalidation is fresh, exact, and reusable at every execution phase', () => {
  const current = executionEnvelope({
    current_level: 'implement_local',
    transition_sequence: 1,
    expected_previous_envelope_oid: SHA1_A,
    worktree_id: 'worktree:one',
    worktree_path_digest: SHA256_C,
    branch: 'codex/task-one',
    head_sha: SHA1_B,
    lease_id: 'lease:one',
    side_effect_class: 'CANDIDATE_FILESYSTEM',
  })
  for (const phase of ['commit', 'push', 'handoff']) {
    assertStatus(
      evaluateScopeRevalidation(scopeRevalidation(current, phase), scopeRevalidationContext(current, phase)),
      'SCOPE_REVALIDATION_ACCEPTED',
      'SCOPE_REVALIDATION_FRESH',
    )
  }

  for (const [label, changedEvidence] of [
    ['path', 'A\0tests/not-declared.mjs\0'],
    ['symbol', 'S\0exported_symbol:not-declared\0'],
  ]) {
    const changedEvidenceDigest = parseChangedScopeEvidence(changedEvidence).evidence_digest
    for (const phase of ['commit', 'push', 'handoff']) {
      const rejected = evaluateScopeRevalidation(
        scopeRevalidation(current, phase, {
          changed_evidence: changedEvidence,
          changed_evidence_digest: changedEvidenceDigest,
        }),
        scopeRevalidationContext(current, phase),
      )
      assertStatus(rejected, 'HELD_SCOPE_DRIFT', 'SCOPE_DRIFT')
      assert.equal(rejected.scope_digest, undefined, `${label}:${phase} must not widen declared scope`)
    }
  }
  assertStatus(
    evaluateScopeRevalidation(scopeRevalidation(current, 'push', { head_sha: SHA1_C }), scopeRevalidationContext(current, 'push')),
    'HELD_SCOPE_DRIFT',
    'HEAD_BINDING_MISMATCH',
  )
  assertStatus(
    evaluateScopeRevalidation(scopeRevalidation(current, 'handoff', { scope_digest: SHA256_D }), scopeRevalidationContext(current, 'handoff')),
    'HELD_SCOPE_DRIFT',
    'SCOPE_BINDING_MISMATCH',
  )
  assertStatus(
    evaluateScopeRevalidation(scopeRevalidation(current, 'commit', { observed_at: '2026-08-29T04:50:00.000Z', expires_at: EXPIRED }), scopeRevalidationContext(current, 'commit')),
    'HELD_SCOPE_DRIFT',
    'SCOPE_REVALIDATION_EXPIRED',
  )
  assertStatus(
    evaluateScopeRevalidation(undefined, scopeRevalidationContext(current, 'commit')),
    'HELD_SCOPE_DRIFT',
    'SCOPE_REVALIDATION_REQUIRED',
  )
})

test('5E — transitions require fresh scope evidence after admission and before authority ports', () => {
  const current = executionEnvelope({
    current_level: 'implement_local',
    transition_sequence: 1,
    expected_previous_envelope_oid: SHA1_A,
    worktree_id: 'worktree:one',
    worktree_path_digest: SHA256_C,
    branch: 'codex/task-one',
    head_sha: SHA1_B,
    lease_id: 'lease:one',
    side_effect_class: 'CANDIDATE_FILESYSTEM',
  })
  const next = nextEnvelopeFor(current, {
    current_level: 'push_owned_branch',
    transition_sequence: 2,
    expected_previous_envelope_oid: SHA1_A,
    expected_remote_ref: 'codex/task-one',
    expected_remote_sha: SHA1_B,
    side_effect_class: 'REMOTE_GIT_GITHUB',
  })
  const authorityForPush = authority({
    current_level: 'implement_local',
    worktree_id: 'worktree:one',
    worktree_path_digest: SHA256_C,
    branch: 'codex/task-one',
    head_sha: SHA1_B,
    lease_id: 'lease:one',
    side_effect_class: 'CANDIDATE_FILESYSTEM',
    expected_remote_ref: null,
    expected_remote_sha: null,
  })
  const command = advanceCommand(current, {
    next_level: 'push_owned_branch',
    next_envelope: next,
    authority: authorityForPush,
    force_with_lease: true,
  })
  delete command.scope_revalidation
  assertStatus(advanceExecutionEnvelope(current, command), 'HELD_SCOPE_DRIFT', 'SCOPE_REVALIDATION_REQUIRED')

  const outsideEvidence = 'A\0tests/not-declared.mjs\0'
  const drifted = advanceCommand(current, {
    next_level: 'push_owned_branch',
    next_envelope: next,
    authority: authorityForPush,
    force_with_lease: true,
    scope_revalidation: scopeRevalidation(current, 'push', {
      changed_evidence: outsideEvidence,
      changed_evidence_digest: parseChangedScopeEvidence(outsideEvidence).evidence_digest,
    }),
  })
  assertStatus(advanceExecutionEnvelope(current, drifted), 'HELD_SCOPE_DRIFT', 'SCOPE_DRIFT')
})

test('5E — post-admission scope drift blocks push, draft, and submit transitions', () => {
  const outsideEvidence = 'A\0tests/not-declared.mjs\0'
  const drift = (current, phase) => scopeRevalidation(current, phase, {
    changed_evidence: outsideEvidence,
    changed_evidence_digest: parseChangedScopeEvidence(outsideEvidence).evidence_digest,
  })
  const pushCurrent = executionEnvelope({
    current_level: 'push_owned_branch',
    transition_sequence: 2,
    expected_previous_envelope_oid: SHA1_A,
    worktree_id: 'worktree:one',
    worktree_path_digest: SHA256_C,
    branch: 'codex/task-one',
    head_sha: SHA1_B,
    lease_id: 'lease:one',
    expected_remote_ref: 'codex/task-one',
    expected_remote_sha: SHA1_B,
    side_effect_class: 'REMOTE_GIT_GITHUB',
  })
  const draftCurrent = executionEnvelope({
    ...pushCurrent,
    current_level: 'open_draft_pr',
    transition_sequence: 3,
  })
  const draftNext = nextEnvelopeFor(pushCurrent, {
    current_level: 'open_draft_pr',
    transition_sequence: 3,
    expected_previous_envelope_oid: SHA1_A,
    expected_remote_ref: 'codex/task-one',
    expected_remote_sha: SHA1_B,
    side_effect_class: 'REMOTE_GIT_GITHUB',
  })
  const submitNext = nextEnvelopeFor(draftCurrent, {
    current_level: 'submit_delivery',
    transition_sequence: 4,
    expected_previous_envelope_oid: SHA1_A,
    expected_remote_ref: 'codex/task-one',
    expected_remote_sha: SHA1_B,
    external_capability_reference: 'cap:delivery',
    side_effect_class: 'REMOTE_GIT_GITHUB',
  })
  const cases = [
    [pushCurrent, draftNext, {
      next_level: 'open_draft_pr',
      authority: authority({ current_level: 'push_owned_branch', worktree_id: 'worktree:one', worktree_path_digest: SHA256_C, branch: 'codex/task-one', head_sha: SHA1_B, lease_id: 'lease:one', expected_remote_ref: 'codex/task-one', expected_remote_sha: SHA1_B, side_effect_class: 'REMOTE_GIT_GITHUB' }),
    }],
    [draftCurrent, submitNext, {
      next_level: 'submit_delivery',
      authority: authority({ current_level: 'open_draft_pr', worktree_id: 'worktree:one', worktree_path_digest: SHA256_C, branch: 'codex/task-one', head_sha: SHA1_B, lease_id: 'lease:one', expected_remote_ref: 'codex/task-one', expected_remote_sha: SHA1_B, side_effect_class: 'REMOTE_GIT_GITHUB' }),
      evidence_refs: { independent_review: 'evidence:review', e2e: 'evidence:e2e', train: 'evidence:train', drift: 'evidence:drift', packet: 'evidence:packet' },
      external_capability_reference: 'cap:delivery',
    }],
  ]
  for (const [current, next, patch] of cases) {
    const command = advanceCommand(current, { ...patch, next_envelope: next, scope_revalidation: drift(current, 'handoff') })
    assertStatus(advanceExecutionEnvelope(current, command), 'HELD_SCOPE_DRIFT', 'SCOPE_DRIFT')
  }
})

test('P1-3 managed renew/advance/rebase require a one-winner CAS product', () => {
  const record = managedBranch()
  const renew = renewCommand()
  const before = clone(record)
  const renewed = renewManagedBranch(record, renew)
  assertStatus(renewed, 'HELD_EXTERNAL_ACTIVATION', 'RESERVATION_REQUIRED')
  assert.equal(renewed.operation, undefined)
  assert.deepEqual(record, before)
  assertStatus(renewManagedBranch(record, renew), 'HELD_EXTERNAL_ACTIVATION', 'RESERVATION_REQUIRED')
  assertStatus(
    renewManagedBranch(record, renewCommand({
      cas_decision: {
        operation_id: 'operation:renew-one',
        expected_registry_oid: SHA1_C,
        expected_transition_sequence: 0,
        nonce: NONCE('renew-one'),
        winner: false,
      },
    })),
    'HELD_MANAGED_BRANCH',
    'REGISTRY_CAS_LOST',
  )
  assertStatus(
    renewManagedBranch(record, renewCommand({ requested_expires_at: NOW })),
    'HELD_MANAGED_BRANCH',
    'EXPIRY_NOT_EXTENDED',
  )
  assertStatus(
    renewManagedBranch(record, renewCommand({ owner_authority: 'authority:other' })),
    'HELD_MANAGED_BRANCH',
    'OWNER_MISMATCH',
  )
  assertStatus(
    renewManagedBranch(record, renewCommand({ managed_base_lease_id: 'lease:other' })),
    'HELD_MANAGED_BRANCH',
    'MANAGED_BASE_LEASE_REQUIRED',
  )

  for (const [action, operation] of [['advance', advanceManagedBranch], ['rebase', rebaseManagedBranch]]) {
    const operationResult = operation(record, managedOperationCommand(action))
    assertStatus(operationResult, 'HELD_EXTERNAL_ACTIVATION', 'RESERVATION_REQUIRED')
    assert.equal(operationResult.operation, undefined)
    assert.deepEqual(record, before)
  }
  assertStatus(
    renewManagedBranch(record, managedOperationCommand('advance', { candidate_lineage: undefined })),
    'HELD_MANAGED_BRANCH',
    'MANAGED_OPERATION_INVALID',
  )
  assertStatus(
    renewManagedBranch(record, managedOperationCommand('rebase', { new_generation: 1 })),
    'HELD_MANAGED_BRANCH',
    'MANAGED_GENERATION_REQUIRED',
  )
})

test('5D — evaluateAdmission consumes the exact Task3 lease registry record', async () => {
  const { store, registry } = createInMemoryTask3LeaseRegistry()
  const admitted = await registry.admit(task3LeaseRequest(store))
  assert.equal(admitted.status, 'ADMITTED')
  const inspected = await registry.inspect()
  assert.equal(inspected.record.schema_version, 'session-lease-registry/v1')
  assert.equal(inspected.record.writer_cap, 2)
  assert.equal(typeof inspected.record.canonical_digest, 'string')

  assertStatus(
    evaluateAdmission(inspected.record, request({ scope: [{ kind: 'path', path: 'src/new-admission.mjs' }] })),
    'ADMITTED',
  )
  assertStatus(
    evaluateAdmission(inspected.record, request({
      scope: [{ kind: 'path', path: 'src/task3-one.mjs' }],
    })),
    'QUEUED_FOR_LEASE',
    'RESOURCE_CONFLICT',
  )

  const capDrift = clone(inspected.record)
  capDrift.writer_cap = 3
  assertStatus(evaluateAdmission(capDrift, request()), 'HELD_EXECUTION_CONTEXT', 'SNAPSHOT_REGISTRY_INVALID')
  const extra = clone(inspected.record)
  extra.untrusted = true
  assertStatus(evaluateAdmission(extra, request()), 'HELD_EXECUTION_CONTEXT', 'SNAPSHOT_REGISTRY_INVALID')

  assertStatus(
    evaluateAdmission(inspected.record, request({
      lease_kind: 'runtime', runtime_kind: 'integration_train',
      scope: [{ kind: 'runtime', resource_key: 'runtime:integration-train' }],
    })),
    'HELD_RUNTIME',
    'RUNTIME_REGISTRY_REQUIRED',
  )
  assertStatus(
    evaluateAdmission(inspected.record, request({
      lease_kind: 'runtime', runtime_kind: null,
      scope: [{ kind: 'runtime', resource_key: 'runtime:unknown' }],
    })),
    'HELD_RUNTIME',
    'RUNTIME_KIND_UNKNOWN',
  )
})

test('5D — released seats are free but retained resources still block only overlapping work', async () => {
  const { store, registry } = createInMemoryTask3LeaseRegistry()
  const admitted = await registry.admit(task3LeaseRequest(store, {
    lease_id: 'lease:task3-release', task_id: 'task:task3-release', owner_session: 'session:task3-release',
    provider_session_id: 'provider:task3-release', execution_context_id: 'context:task3-release',
    context_attestation_ref: 'attestation:task3-release', worktree_id: 'worktree:task3-release',
    branch: 'codex/task3-release', resource_keys: ['path:src/task3-retained.mjs'], nonce: NONCE('task3-release'),
  }))
  assert.equal(admitted.status, 'ADMITTED')
  const ending = await registry.endRequest({
    lease_id: admitted.lease.lease_id, expected_oid: admitted.oid, nonce: NONCE('task3-end-request'),
    reason: 'handoff', handoff_or_candidate_reference: 'handoff:task3-release',
    owner_end_attestation: endAttestation(admitted.lease),
  })
  assert.equal(ending.status, 'END_REQUESTED')
  const attestor = {
    async verify({ attestation }) { return { verdict: 'TRUSTED', attestation: clone(attestation) } },
  }
  const envelope = {
    async revoke({ expected_envelope_oid, expected_transition_sequence }) {
      return {
        status: 'REVOKED', previous_oid: expected_envelope_oid, oid: SHA1_D,
        transition_sequence: expected_transition_sequence + 1, revocation_epoch: 0, in_flight_command: false,
      }
    },
  }
  const releasingRegistry = createLeaseRegistry({ store, clock: { now: () => NOW }, ownerEndAttestor: attestor, executionEnvelope: envelope })
  const released = await releasingRegistry.release({
    lease_id: admitted.lease.lease_id, expected_oid: ending.oid, expected_envelope_oid: SHA1_C,
    expected_envelope_transition_sequence: 0,
    attestation: {
      attestation_ref: 'attestation:task3-end', attestation_digest: SHA256_A, issuer_id: 'attestor:task3-end',
      issuer_version: 'owner-end/v1', owner_session: 'session:task3-release', provider: 'codex',
      provider_session_id: 'provider:task3-release', execution_context_id: 'context:task3-release',
      lease_id: 'lease:task3-release', generation: 1, head_sha: SHA1_A, scope_digest: admitted.lease.scope_digest,
      worktree_path_digest: SHA256_B, observed_at: NOW, expires_at: LATER, nonce: NONCE('task3-end-attestation'),
      revocation_epoch: 0,
    },
  })
  assert.equal(released.status, 'RELEASED')
  const inspected = await releasingRegistry.inspect()
  const sameScope = request({ generation: inspected.record.generation, scope: [{ kind: 'path', path: 'src/task3-retained.mjs' }] })
  assertStatus(evaluateAdmission(inspected.record, sameScope), 'QUEUED_FOR_LEASE', 'RESOURCE_CONFLICT')
  assertStatus(evaluateAdmission(inspected.record, request({ generation: inspected.record.generation, scope: [{ kind: 'path', path: 'src/disjoint-after-release.mjs' }] })), 'ADMITTED')
  assert.equal(inspected.record.leases['lease:task3-release'].state, 'RELEASED')
  assert.equal(inspected.record.leases['lease:task3-release'].retention_state, 'RETAINED_FOR_REVIEW')
})

test('5G — Task3 parser rejects recomputed zero-OID released records before admission decisions', async () => {
  const leaseId = 'lease:task3-released-zero'
  const { released, inspected } = await releaseTask3Lease({ leaseId })
  assert.equal(released.status, 'RELEASED')
  for (const field of ['expected_envelope_oid', 'expected_registry_oid']) {
    const forged = clone(inspected.record)
    forged.leases[leaseId].release_record[field] = ZERO_OID
    restampTask3Record(forged.leases[leaseId])
    restampTask3Record(forged)
    assert.throws(() => parseSessionLeaseRegistry(forged), /registry_record_invalid|oid/i, field)
    const result = evaluateAdmission(forged, request({
      generation: forged.generation,
      scope: [{ kind: 'path', path: `src/released-zero-${field}.mjs` }],
    }))
    assertStatus(result, 'HELD_EXECUTION_CONTEXT', 'SNAPSHOT_REGISTRY_INVALID', field)
    assert.notEqual(result.status, 'ADMITTED', field)
  }
})

test('5G — Task3 parser rejects cross-lease Releasing reservations and proofs before admission decisions', async () => {
  const leaseId = 'lease:task3-releasing-cross'
  const { released, inspected } = await releaseTask3Lease({ rejectFirstFinalization: true, leaseId })
  assertStatus(released, 'HELD_EXECUTION_AUTHORITY', 'RELEASE_FINALIZE_CAS_CONFLICT')
  assert.equal(inspected.record.leases[leaseId].state, 'RELEASING')
  for (const field of ['release_reservation', 'envelope_revocation_proof']) {
    const forged = clone(inspected.record)
    forged.leases[leaseId][field].lease_id = 'lease:task3-cross-boundary'
    restampTask3Record(forged.leases[leaseId][field])
    restampTask3Record(forged.leases[leaseId])
    restampTask3Record(forged)
    assert.throws(() => parseSessionLeaseRegistry(forged), /registry_record_invalid|binding/i, field)
    const result = evaluateAdmission(forged, request({
      generation: forged.generation,
      scope: [{ kind: 'path', path: `src/releasing-cross-${field}.mjs` }],
    }))
    assertStatus(result, 'HELD_EXECUTION_CONTEXT', 'SNAPSHOT_REGISTRY_INVALID', field)
    assert.notEqual(result.status, 'ADMITTED', field)
  }
})

test('5D — raw environment aliases are rejected recursively while OID/SHA/timestamps remain safe', async () => {
  const record = await canonicalTask3AdmissionRecord()
  const aliases = [
    'env:PAY_TO_ADDRESS', 'environment:PAY_TO_ADDRESS', '$env:PAY_TO_ADDRESS', '%PAY_TO_ADDRESS%',
  ]
  for (const value of aliases) {
    for (const [label, patch] of [
      ['path', { scope: [{ kind: 'path', path: `src/${value}` }] }],
      ['glob', { scope: [{ kind: 'glob', pattern: `src/${value}/*.mjs` }] }],
      ['rename', { scope: [{ kind: 'rename', old_path: `src/${value}.old`, new_path: 'src/new.mjs' }] }],
      ['resource', { scope: [{ kind: 'shared_contract', resource_key: `contract:${value}` }] }],
      ['nested', { evidence: { nested: { resource_key: value } } }],
    ]) {
      assertStatus(evaluateAdmission(record, request(patch)), 'HELD_EXECUTION_CONTEXT', 'SECRET_MATERIAL_FORBIDDEN', `${label}:${value}`)
    }
  }
  assertStatus(evaluateAdmission(record, request({ evidence: { oid: SHA1_A, digest: SHA256_B, observed_at: NOW } })), 'ADMITTED')
})

test('5G — public admission applies Task2 opaque-id bounds and secret rejection', async () => {
  const record = await canonicalTask3AdmissionRecord()
  for (const [label, ownerSession, status, reason] of [
    ['two', 'aa', 'HELD_EXECUTION_CONTEXT', 'REQUEST_SCHEMA_INVALID'],
    ['three', 'aaa', 'ADMITTED', undefined],
    ['one-twenty-eight', 'a'.repeat(128), 'ADMITTED', undefined],
    ['one-twenty-nine', 'a'.repeat(129), 'HELD_EXECUTION_CONTEXT', 'REQUEST_SCHEMA_INVALID'],
    ['bare-bearer', 'bearer', 'HELD_EXECUTION_CONTEXT', 'SECRET_MATERIAL_FORBIDDEN'],
    ['raw-environment-segment', 'session:env:PAY_TO_ADDRESS', 'HELD_EXECUTION_CONTEXT', 'SECRET_MATERIAL_FORBIDDEN'],
  ]) {
    assertStatus(evaluateAdmission(record, request({ owner_session: ownerSession })), status, reason, label)
  }
})

test('5D — recursive input and NUL evidence bounds return typed holds before expensive parsing', async () => {
  const record = await canonicalTask3AdmissionRecord()
  const cyclic = {}
  cyclic.self = cyclic
  assertStatus(evaluateAdmission(record, request({ evidence: cyclic })), 'HELD_EXECUTION_CONTEXT', 'INVALID_CYCLIC_INPUT')

  let deep = { value: 'ok' }
  for (let index = 0; index < 40; index += 1) deep = { next: deep }
  assertStatus(evaluateAdmission(record, request({ evidence: deep })), 'HELD_EXECUTION_CONTEXT', 'INPUT_COMPLEXITY_LIMIT')

  const oversizedEvidence = Array.from({ length: 300 }, (_, index) => `A\0src/bounded-${index}.mjs\0`).join('')
  assertStatus(
    evaluateAdmission(record, request({
      scope: [{ kind: 'path', path: 'src' }], changed_evidence: oversizedEvidence,
    })),
    'HELD_SCOPE_DRIFT',
    'EVIDENCE_LIMIT',
  )
  assert.throws(
    () => parseChangedScopeEvidence(oversizedEvidence),
    /EVIDENCE_LIMIT/u,
  )
})

test('5D — bounded glob matching exposes complexity as unknown instead of unbounded regex work', () => {
  const pathological = `src/${'*?'.repeat(250)}`
  assert.equal(_internal.globMatches(pathological, `src/${'a'.repeat(508)}`), null)
  assert.equal(
    findScopeConflicts(
      [{ kind: 'glob', pattern: pathological }],
      [{ kind: 'path', path: `src/${'a'.repeat(508)}` }],
    ).status,
    'UNKNOWN',
  )
})

test('5F — legacy in-process trust factories are not public authority sources', () => {
  for (const name of [
    'createExecutionEnvelopeController',
    'createExecutionTransitionReceipt',
    'createManagedCasDecision',
    'createTrustedRangeDiffEvidence',
  ]) {
    assert.equal(Object.hasOwn(admissionModule, name), false, `${name} must not be exported`)
  }
})

test('5F — a valid detached shadow reservation remains held until external activation', () => {
  const current = executionEnvelope()
  const command = advanceCommand(current)
  const reservation = shadowExecutionReservation(current, command, command.next_envelope)
  const result = advanceExecutionEnvelope(current, command, reservation)
  assertShadowActivationHold(result, 'SHADOW_EXECUTION_VALID_BUT_NOT_ACTIVATED')
})

test('5F — non-canonical calendar timestamps are closed-shape input failures', () => {
  const current = executionEnvelope()
  const command = advanceCommand(current)
  const reservation = shadowExecutionReservation(current, command, command.next_envelope)
  const invalidCalendar = {
    ...reservation,
    issued_at: '2026-02-31T05:00:00.000Z',
  }
  const result = advanceExecutionEnvelope(current, command, invalidCalendar)
  assertStatus(result, 'HELD_EXTERNAL_ACTIVATION', 'RESERVATION_SCHEMA_INVALID')
})

test('5F — managed shadow reservations are never ready intents and retain rebase lineage', () => {
  const record = managedBranch()
  for (const [operation, invoke, command] of [
    ['renew', renewManagedBranch, renewCommand()],
    ['advance', advanceManagedBranch, managedOperationCommand('advance')],
    ['rebase', rebaseManagedBranch, managedOperationCommand('rebase')],
  ]) {
    const result = invoke(record, command, shadowManagedReservation(record, command))
    assert.equal(result.reason, 'SHADOW_MANAGED_VALID_BUT_NOT_ACTIVATED', operation)
    assertShadowActivationHold(result, 'SHADOW_MANAGED_VALID_BUT_NOT_ACTIVATED')
    assert.deepEqual(record, managedBranch(), operation)
  }

})

test('5F — hostile reservation provenance is held by public input validation', () => {
  const current = executionEnvelope()
  const command = advanceCommand(current)
  const reservation = shadowExecutionReservation(current, command, command.next_envelope)

  const payloadMutation = structuredClone(reservation)
  payloadMutation.payload.task_id = 'task:attacker'
  payloadMutation.payload_digest = digestCanonical(payloadMutation.payload)

  const stale = structuredClone(reservation)
  stale.issued_at = LATER
  stale.expires_at = LATER_2
  stale.payload.observed_at = LATER
  stale.payload.expires_at = LATER_2
  stale.payload_digest = digestCanonical(stale.payload)

  const expired = structuredClone(reservation)
  expired.issued_at = EXPIRED
  expired.expires_at = NOW
  expired.payload.observed_at = EXPIRED
  expired.payload.expires_at = NOW
  expired.payload_digest = digestCanonical(expired.payload)

  for (const [label, hostile, status, reason] of [
    ['self-signed issuer', { ...reservation, issuer_id: 'issuer:attacker', signature: `B${reservation.signature.slice(1)}` }, 'HELD_EXTERNAL_ACTIVATION', 'RESERVATION_SCHEMA_INVALID'],
    ['attacker public key injection', { ...reservation, public_key_spki: 'MCowBQYDK2VwAyEA11qYAYKxCrfVS/7TyWQHOg7hcvPapiMlrwIaaPcHURo=' }, 'HELD_EXTERNAL_ACTIVATION', 'RESERVATION_SCHEMA_INVALID'],
    ['wrong pinned source', { ...reservation, source_digest: SHA256_A }, 'HELD_EXTERNAL_ACTIVATION', 'RESERVATION_SCHEMA_INVALID'],
    ['payload mutation', payloadMutation, 'HELD_EXTERNAL_ACTIVATION', 'EXECUTION_RESERVATION_BINDING_MISMATCH'],
    ['stale reservation', stale, 'HELD_EXTERNAL_ACTIVATION', 'RESERVATION_EXPIRED'],
    ['expired reservation', expired, 'HELD_EXTERNAL_ACTIVATION', 'RESERVATION_EXPIRED'],
  ]) {
    const result = advanceExecutionEnvelope(current, command, hostile)
    assertStatus(result, status, reason, label)
    assert.equal(result.intent, undefined, `${label}: no mutation-ready intent`)
  }

  assertStatus(
    advanceExecutionEnvelope(current, { ...command, replayed: true }, reservation),
    'HELD_EXECUTION_AUTHORITY',
    'NONCE_REPLAY',
  )
})

test('AC-11 — release and hotfix managed records require the closed registry shape', () => {
  for (const [branch, branchClass] of [
    ['develop', 'develop'],
    ['release/2026.08', 'release'],
    ['hotfix/security', 'hotfix'],
  ]) {
    const valid = managedBranch({ branch, branch_class: branchClass })
    assertStatus(renewManagedBranch(valid, renewCommand()), 'HELD_EXTERNAL_ACTIVATION', 'RESERVATION_REQUIRED', branch)
    for (const field of ['owner_authority', 'base_ref', 'protection_profile_digest', 'generation', 'expires_at']) {
      const missing = clone(valid)
      delete missing[field]
      assertStatus(renewManagedBranch(missing, renewCommand()), 'HELD_MANAGED_BRANCH', 'MANAGED_BRANCH_INVALID', `${branch}:${field}`)
    }
  }
})

test('AC-11 — managed branch drift and expiry are typed freezes without registry mutation', () => {
  for (const branch of ['develop', 'release/2026.08', 'hotfix/security']) {
    const branchClass = branch === 'develop' ? 'develop' : branch.split('/')[0]
    const cases = [
      ['state frozen', { state: 'FROZEN' }, 'MANAGED_BRANCH_NOT_ACTIVE'],
      ['rebase required', { state: 'REBASE_REQUIRED' }, 'MANAGED_BRANCH_NOT_ACTIVE'],
      ['expiry', { expires_at: EXPIRED }, 'MANAGED_BRANCH_EXPIRED'],
      ['base drift', {}, 'EXPECTED_BASE_MISMATCH', { expected_base_sha: SHA1_D }],
      ['head drift', {}, 'EXPECTED_HEAD_MISMATCH', { expected_head_sha: SHA1_D }],
      ['protection drift', {}, 'PROTECTION_PROFILE_DRIFT', { expected_protection_profile_digest: SHA256_D }],
    ]
    for (const [label, recordPatch, reason, commandPatch = {}] of cases) {
      const record = managedBranch({ branch, branch_class: branchClass, ...recordPatch })
      const before = clone(record)
      assertStatus(renewManagedBranch(record, renewCommand(commandPatch)), 'HELD_MANAGED_BRANCH', reason, `${branch}:${label}`)
      assert.deepEqual(record, before, `${branch}:${label} must not mutate the registry record`)
      assert.equal(record.branch, branch, `${branch}:${label} must retain the managed branch`)
    }
  }

  for (const [action, invoke, command] of [
    ['renew', renewManagedBranch, renewCommand()],
    ['advance', advanceManagedBranch, managedOperationCommand('advance')],
    ['rebase', rebaseManagedBranch, managedOperationCommand('rebase')],
  ]) {
    const record = managedBranch({ expires_at: EXPIRED })
    const before = clone(record)
    assertStatus(invoke(record, command), 'HELD_MANAGED_BRANCH', 'MANAGED_BRANCH_EXPIRED', action)
    assert.deepEqual(record, before, `${action}: expiry must not delete or mutate the registry record`)
  }
})

test('AC-11 — generic managed branch bulk promotion without attribution is held before mutation', async () => {
  const record = await canonicalTask3AdmissionRecord()
  const before = clone(record)
  for (const managedBase of ['develop', 'release/2026.08', 'hotfix/security']) {
    const candidate = request({
      action: 'bulk_promotion',
      base_ref: managedBase,
      target_branch: 'main',
      bulk: true,
      promotion_mode: 'single_pr',
    })
    // Deliberately omit the spec's included-commit vector and per-candidate
    // attribution: this generic branch-level request must be held before any
    // promotion mutation can be considered.
    assertStatus(evaluateAdmission(record, candidate), 'HELD_MANAGED_BRANCH', 'MANAGED_REGISTRY_REQUIRED', managedBase)
  }
  assert.deepEqual(record, before, 'generic bulk rejection must not mutate the lease registry')
})

test('AC-11 — managed-base push and deploy intents have zero remote/delete/process side effects', () => {
  const calls = { remote: 0, delete: 0, process: 0 }
  const effects = {
    remote: () => { calls.remote += 1 },
    delete: () => { calls.delete += 1 },
    process: () => { calls.process += 1 },
  }
  const current = executionEnvelope({
    current_level: 'implement_local',
    transition_sequence: 1,
    expected_previous_envelope_oid: SHA1_A,
    worktree_id: 'worktree:one',
    worktree_path_digest: SHA256_C,
    branch: 'codex/task-one',
    head_sha: SHA1_B,
    lease_id: 'lease:one',
    side_effect_class: 'CANDIDATE_FILESYSTEM',
  })
  const authorityPatch = {
    current_level: 'implement_local',
    worktree_id: 'worktree:one',
    worktree_path_digest: SHA256_C,
    branch: 'codex/task-one',
    head_sha: SHA1_B,
    lease_id: 'lease:one',
    side_effect_class: 'CANDIDATE_FILESYSTEM',
    effects,
  }
  for (const managedBase of ['develop', 'release/2026.08', 'hotfix/security']) {
    const managedBasePush = nextEnvelopeFor(current, {
      current_level: 'push_owned_branch',
      transition_sequence: 2,
      expected_previous_envelope_oid: SHA1_A,
      branch: managedBase,
      expected_remote_ref: managedBase,
      expected_remote_sha: SHA1_B,
      side_effect_class: 'REMOTE_GIT_GITHUB',
    })
    const pushResult = advanceExecutionEnvelope(current, advanceCommand(current, {
      next_level: 'push_owned_branch',
      next_envelope: managedBasePush,
      force_with_lease: true,
      authority: authority(authorityPatch),
    }))
    assertStatus(pushResult, 'HELD_EXECUTION_AUTHORITY', 'PROTECTED_BRANCH_FORBIDDEN', managedBase)
    assert.equal(pushResult.intent, undefined, `${managedBase}: no mutation-ready intent`)

    const directDeployResult = advanceExecutionEnvelope(current, advanceCommand(current, {
      action: 'direct_deploy',
      next_level: 'push_owned_branch',
      next_envelope: managedBasePush,
      force_with_lease: true,
      authority: authority(authorityPatch),
    }))
    assertStatus(directDeployResult, 'HELD_EXECUTION_AUTHORITY', 'FORBIDDEN_DELIVERY_SINK', managedBase)
    assert.equal(directDeployResult.intent, undefined, `${managedBase}: direct deploy must not produce an intent`)
  }
  assert.deepEqual(calls, { remote: 0, delete: 0, process: 0 })
})

test('AC-11 — admission kernel has no remote, delete, or process mutation capability', () => {
  const source = readFileSync(new URL('../../lib/parallel-delivery-fabric-admission.mjs', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /node:(?:child_process|fs|http|https|net|tls|worker_threads)/u)
  assert.doesNotMatch(source, /\b(?:fetch|exec|execFile|fork|spawn|kill|unlink|rmSync|rmdirSync)\s*\(/u)
})
