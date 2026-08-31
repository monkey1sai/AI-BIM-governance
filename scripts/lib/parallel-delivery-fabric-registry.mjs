import {
  FABRIC_SCHEMA_VERSION,
  canonicalize,
  digestCanonical,
  parseDeliveryPlan,
} from './parallel-delivery-fabric-contract.mjs'

export const ZERO_OID = '0'.repeat(40)

const PLAN_REF = 'refs/ai-bim/delivery-plans'
const LEASE_REF = 'refs/ai-bim/session-leases'
const REFS = new Set([PLAN_REF, LEASE_REF])
const WRITER_CAP_V1 = 2
const OID = /^[0-9a-f]{40}$/u
const DIGEST = /^[0-9a-f]{64}$/u
const NONCE = /^[A-Za-z0-9_-]{32,128}$/u
const OPAQUE_REFERENCE = /^[a-z][a-z0-9_-]*:[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/u
const OPAQUE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:/-]{1,255}$/u
const TASK2_OPAQUE_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{1,127}$/u
const TASK2_RESOURCE_KEY = /^[a-z][a-z0-9_-]*:[a-z0-9][a-z0-9._:/-]{0,255}$/u
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u
const RAW_WINDOWS_SID_SEGMENT = /(?:^|[/:])S-\d+(?:-\d+){2,}(?=$|[/:])/iu
const TERMINAL_PROCESS_ID_SEGMENT = /(?:^|[/:])\d+$/u
const SECRET_VALUE_MARKER = /(?:bearer|token|cookie|authorization|private[-_]?key|gh[pousr]_|github_pat_|eyJ[A-Za-z0-9_-]{10,})/iu
const RAW_ENV_SEGMENT = /(?:^|[/:])(?:(?:env|environment):[A-Za-z_][A-Za-z0-9_]*|\$env:[A-Za-z_][A-Za-z0-9_]*|%[A-Za-z_][A-Za-z0-9_]*%)(?=$|[/:])/iu

const SANITIZED_GIT_ENV = Object.freeze({
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_TERMINAL_PROMPT: '0',
  GIT_CONFIG_COUNT: '1',
  GIT_CONFIG_KEY_0: 'core.hooksPath',
  GIT_CONFIG_VALUE_0: 'NUL',
  GIT_CONFIG_GLOBAL: 'NUL',
})

class FabricRegistryError extends Error {
  constructor(code, detail) {
    super(`${code}: ${detail}`)
    this.name = 'FabricRegistryError'
    this.code = code
    this.detail = detail
  }
}

const fail = (code, detail) => {
  throw new FabricRegistryError(code, detail)
}

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

const normalizedKey = (rawKey) => rawKey.replace(/([a-z0-9])([A-Z])/gu, '$1_$2').toLowerCase().replaceAll('-', '_')

const sensitiveKey = (rawKey) => {
  const key = normalizedKey(rawKey)
  return (
    key.includes('token') || key.includes('cookie') || key.includes('authorization') || key.includes('private_key') ||
    key === 'sid' || key.endsWith('_sid') || key === 'pid' || key.endsWith('_pid') || key === 'process_id' ||
    key.includes('transcript') || key === 'env' || key.startsWith('env_') || key.endsWith('_env') ||
    key.includes('raw_env') || key.includes('environment_values') || key.includes('absolute_path') ||
    (key.endsWith('_path') && !['old_path', 'new_path', 'public_entrypoint'].includes(key))
  )
}

const scalarHasSensitiveMaterial = (value) => {
  if (typeof value !== 'string') return false
  if (OID.test(value) || DIGEST.test(value) || TIMESTAMP.test(value)) return false
  return SECRET_VALUE_MARKER.test(value) || RAW_WINDOWS_SID_SEGMENT.test(value) || TERMINAL_PROCESS_ID_SEGMENT.test(value) || RAW_ENV_SEGMENT.test(value) ||
    /(?:^|:)[A-Za-z]:[\\/]/u.test(value) || /(?:^|:)(?:\\\\|\/)/u.test(value)
}

const assertNoSensitiveMaterial = (value, context = '$') => {
  if (typeof value === 'string') {
    if (scalarHasSensitiveMaterial(value)) fail('secret_material_detected', `${context}_forbidden`)
    return
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoSensitiveMaterial(entry, `${context}[${index}]`))
    return
  }
  if (!isObject(value)) return
  for (const [key, nested] of Object.entries(value)) {
    if (sensitiveKey(key)) fail('secret_material_detected', `${context}.${key}_forbidden`)
    assertNoSensitiveMaterial(nested, `${context}.${key}`)
  }
}

const exactKeys = (value, keys, context) => {
  if (!isObject(value)) fail('invalid_shape', `${context}_must_be_object`)
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail('invalid_shape', `${context}_keys_invalid`)
  }
}

const validateClosedRequest = (value, keys, context) => {
  assertNoSensitiveMaterial(value, context)
  exactKeys(value, keys, context)
  return value
}

const assertString = (value, context, pattern = undefined) => {
  if (typeof value !== 'string' || value.length === 0 || (pattern && !pattern.test(value))) {
    fail('invalid_value', `${context}_invalid`)
  }
  assertNoSensitiveMaterial(value, context)
  return value
}

const assertOid = (value, context, { zero = true } = {}) => {
  if (value === ZERO_OID) {
    if (zero) return value
    fail('invalid_value', `${context}_zero_forbidden`)
  }
  return assertString(value, context, OID)
}

const assertDigest = (value, context) => assertString(value, context, DIGEST)
const assertNonce = (value, context) => assertString(value, context, NONCE)
const assertOpaque = (value, context) => assertString(value, context, OPAQUE_REFERENCE)
const assertIdentifier = (value, context) => assertString(value, context, OPAQUE_IDENTIFIER)
const assertTask2OpaqueId = (value, context) => {
  const opaqueId = assertString(value, context, TASK2_OPAQUE_ID)
  if (opaqueId.length < 3 || opaqueId.length > 128) fail('invalid_value', `${context}_invalid`)
  return opaqueId
}
const assertTask2ResourceKey = (value, context) => {
  const resourceKey = assertString(value, context, TASK2_RESOURCE_KEY)
  if (resourceKey.length < 3 || resourceKey.length > 256) fail('invalid_value', `${context}_invalid`)
  return resourceKey
}

const parseTimestamp = (value, context) => {
  assertString(value, context, TIMESTAMP)
  const milliseconds = Date.parse(value)
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) {
    fail('invalid_value', `${context}_invalid`)
  }
  return milliseconds
}

const nowFrom = (clock) => {
  if (!clock || typeof clock.now !== 'function') fail('invalid_port', 'clock_now_required')
  const value = clock.now()
  parseTimestamp(value, 'clock_now')
  return value
}

const clone = (value) => structuredClone(value)

const stamp = (value) => {
  const normalized = canonicalize(value)
  delete normalized.canonical_digest
  return {
    ...normalized,
    canonical_digest: digestCanonical(normalized),
  }
}

const assertStamped = (record, context) => {
  if (!isObject(record)) fail('registry_record_invalid', `${context}_not_object`)
  assertNoSensitiveMaterial(record, context)
  assertString(record.schema_version, `${context}.schema_version`)
  if (!Number.isSafeInteger(record.generation) || record.generation < 1) {
    fail('registry_record_invalid', `${context}.generation_invalid`)
  }
  assertNonce(record.nonce, `${context}.nonce`)
  parseTimestamp(record.created_at, `${context}.created_at`)
  parseTimestamp(record.updated_at, `${context}.updated_at`)
  assertDigest(record.canonical_digest, `${context}.canonical_digest`)
  const withoutDigest = { ...record }
  delete withoutDigest.canonical_digest
  if (digestCanonical(withoutDigest) !== record.canonical_digest) {
    fail('registry_record_invalid', `${context}.canonical_digest_mismatch`)
  }
}

const command = async (git, commonDir, args, input = undefined) => {
  if (!git || typeof git.run !== 'function') fail('invalid_port', 'git_run_required')
  const response = await git.run({
    args: [...args],
    input,
    env: { ...SANITIZED_GIT_ENV },
    commonDir,
  })
  if (!isObject(response) || !Number.isInteger(response.exitCode) || typeof response.stdout !== 'string' || typeof response.stderr !== 'string') {
    fail('git_port_invalid_response', args[0])
  }
  return response
}

const refOf = (ref) => {
  if (!REFS.has(ref)) fail('registry_ref_forbidden', String(ref))
  return ref
}

export function createGitCasStore({ git, commonDir }) {
  if (typeof commonDir !== 'string' || commonDir.length === 0) fail('invalid_port', 'common_dir_required')
  const commonDirDigest = digestCanonical({ common_dir: commonDir })

  const read = async (ref) => {
    const safeRef = refOf(ref)
    const refResult = await command(git, commonDir, ['show-ref', '--verify', '--hash', '--', safeRef])
    if (refResult.exitCode === 1) return { ref: safeRef, oid: ZERO_OID, record: null }
    if (refResult.exitCode !== 0) fail('git_read_ref_failed', safeRef)
    const oid = refResult.stdout.trim()
    assertOid(oid, `${safeRef}_oid`, { zero: false })
    const blobResult = await command(git, commonDir, ['cat-file', 'blob', '--', oid])
    if (blobResult.exitCode !== 0) fail('git_read_blob_failed', safeRef)
    let record
    try {
      record = JSON.parse(blobResult.stdout)
    } catch {
      fail('registry_blob_invalid_json', safeRef)
    }
    validatePersistedRecordForRef(safeRef, record)
    return { ref: safeRef, oid, record }
  }

  const cas = async ({ ref, expected_oid, record }) => {
    const safeRef = refOf(ref)
    assertOid(expected_oid, 'expected_oid')
    validatePersistedRecordForRef(safeRef, record)
    const serialized = JSON.stringify(canonicalize(record))
    const blobResult = await command(git, commonDir, ['hash-object', '-w', '--stdin'], serialized)
    if (blobResult.exitCode !== 0) fail('git_write_blob_failed', safeRef)
    const oid = blobResult.stdout.trim()
    assertOid(oid, 'written_blob_oid', { zero: false })
    const updateResult = await command(git, commonDir, ['update-ref', '--no-deref', safeRef, oid, expected_oid])
    if (updateResult.exitCode === 0) return { status: 'STORED', ref: safeRef, oid, previous_oid: expected_oid, record }
    if (updateResult.exitCode !== 1) fail('git_update_ref_failed', safeRef)
    const current = await read(safeRef)
    return {
      status: 'CONFLICT',
      reason: 'CAS_CONFLICT',
      ref: safeRef,
      expected_oid,
      actual_oid: current.oid,
      current,
    }
  }

  return Object.freeze({
    refs: Object.freeze({ deliveryPlans: PLAN_REF, sessionLeases: LEASE_REF }),
    commonDirDigest,
    read,
    cas,
  })
}

const validatePlanOnlyExecution = (execution) => {
  exactKeys(execution, ['level', 'side_effect_class'], 'plan_only_execution')
  if (execution.level !== 'plan_only' || execution.side_effect_class !== 'CONTROL_METADATA') {
    fail('plan_only_metadata_required', 'control_metadata_only')
  }
  return { level: 'plan_only', side_effect_class: 'CONTROL_METADATA' }
}

const assertNoObservedEffects = (effects) => {
  if (effects === undefined) return
  if (!isObject(effects)) fail('invalid_shape', 'effects_must_be_object')
  for (const [name, count] of Object.entries(effects)) {
    if (!Number.isSafeInteger(count) || count !== 0) fail('plan_only_effect_observed', name)
  }
}

const validatePlanRegistryRecord = (record) => {
  exactKeys(record, [
    'schema_version', 'generation', 'nonce', 'created_at', 'updated_at', 'plan', 'plan_digest', 'execution', 'canonical_digest',
  ], 'delivery_plan_registry')
  assertStamped(record, 'delivery_plan_registry')
  if (record.schema_version !== 'delivery-plan-registry/v1') fail('registry_record_invalid', 'delivery_plan_registry_schema')
  const parsedPlan = parseDeliveryPlan(record.plan)
  if (record.generation !== parsedPlan.generation || record.plan_digest !== digestCanonical(parsedPlan)) {
    fail('registry_record_invalid', 'delivery_plan_registry_plan_binding')
  }
  validatePlanOnlyExecution(record.execution)
  return record
}

const heldRegistryIntegrity = (ref) => Object.freeze({
  status: 'HELD_REGISTRY_INTEGRITY',
  reason: 'PERSISTED_RECORD_INVALID',
  ref,
})

const readValidatedPlanSnapshot = async (store) => {
  try {
    const snapshot = await store.read(PLAN_REF)
    if (snapshot.record !== null) validatePlanRegistryRecord(snapshot.record)
    return snapshot
  } catch {
    return heldRegistryIntegrity(PLAN_REF)
  }
}

export function createPlanRegistry({ store, clock }) {
  if (!store || typeof store.read !== 'function' || typeof store.cas !== 'function') fail('invalid_port', 'plan_store_required')

  const submit = async (input) => {
    assertNoSensitiveMaterial(input, 'plan_submit')
    if (!isObject(input) || Object.keys(input).some((key) => !['plan', 'expected_oid', 'nonce', 'execution', 'effects'].includes(key)) ||
        ['plan', 'expected_oid', 'nonce', 'execution'].some((key) => !Object.hasOwn(input, key))) {
      fail('invalid_shape', 'plan_submit_keys_invalid')
    }
    const { plan, expected_oid, nonce, execution, effects = undefined } = input
    const snapshot = await readValidatedPlanSnapshot(store)
    if (snapshot.status === 'HELD_REGISTRY_INTEGRITY') return snapshot
    const parsedPlan = parseDeliveryPlan(plan)
    assertOid(expected_oid, 'plan_expected_oid')
    assertNonce(nonce, 'plan_nonce')
    const validatedExecution = validatePlanOnlyExecution(execution)
    assertNoObservedEffects(effects)
    if (snapshot.oid !== expected_oid) {
      return {
        status: 'CONFLICT',
        reason: 'CAS_CONFLICT',
        ref: PLAN_REF,
        expected_oid,
        actual_oid: snapshot.oid,
        current: snapshot,
      }
    }
    const timestamp = nowFrom(clock)
    const record = stamp({
      schema_version: 'delivery-plan-registry/v1',
      generation: parsedPlan.generation,
      nonce,
      created_at: timestamp,
      updated_at: timestamp,
      plan: parsedPlan,
      plan_digest: digestCanonical(parsedPlan),
      execution: validatedExecution,
    })
    validatePlanRegistryRecord(record)
    const result = await store.cas({ ref: PLAN_REF, expected_oid, record })
    return result.status === 'STORED' ? result : {
      status: 'CONFLICT',
      reason: 'CAS_CONFLICT',
      ref: PLAN_REF,
      expected_oid,
      actual_oid: result.actual_oid,
      current: result.current,
    }
  }

  const inspect = () => readValidatedPlanSnapshot(store)
  return Object.freeze({ submit, inspect })
}

const emptyLeaseRegistry = (writerCap) => ({
  schema_version: 'session-lease-registry/v1',
  generation: 0,
  writer_cap: writerCap,
  leases: {},
  used_owner_end_attestations: {},
})

const validateLeaseRequest = (request, store) => {
  exactKeys(request, [
    'lease_id', 'plan_id', 'generation', 'task_id', 'provider', 'owner_session',
    'provider_session_id', 'execution_context_id', 'context_attestation_ref', 'common_dir_digest',
    'worktree_id', 'worktree_path_digest', 'branch', 'scope_digest', 'head_sha', 'resource_keys', 'nonce',
  ], 'lease_request')
  for (const field of [
    'lease_id', 'plan_id', 'task_id', 'owner_session', 'provider_session_id',
    'execution_context_id',
  ]) assertTask2OpaqueId(request[field], `lease_request.${field}`)
  for (const field of ['context_attestation_ref', 'worktree_id']) {
    assertOpaque(request[field], `lease_request.${field}`)
  }
  assertIdentifier(request.branch, 'lease_request.branch')
  if (!Number.isSafeInteger(request.generation) || request.generation < 1) fail('invalid_value', 'lease_request.generation_invalid')
  if (!['codex', 'claude'].includes(request.provider)) fail('invalid_value', 'lease_request.provider_invalid')
  assertDigest(request.common_dir_digest, 'lease_request.common_dir_digest')
  assertDigest(request.worktree_path_digest, 'lease_request.worktree_path_digest')
  assertDigest(request.scope_digest, 'lease_request.scope_digest')
  assertOid(request.head_sha, 'lease_request.head_sha', { zero: false })
  assertNonce(request.nonce, 'lease_request.nonce')
  if (!Array.isArray(request.resource_keys) || request.resource_keys.length === 0 || request.resource_keys.length > 256) {
    fail('invalid_shape', 'lease_request.resource_keys_invalid')
  }
  request.resource_keys.forEach((key, index) => assertTask2ResourceKey(key, `lease_request.resource_keys[${index}]`))
  if (new Set(request.resource_keys).size !== request.resource_keys.length) fail('invalid_value', 'lease_request.resource_keys_duplicate')
  if (request.common_dir_digest !== store.commonDirDigest) {
    return { status: 'HELD_TOPOLOGY_UNSUPPORTED', reason: 'COMMON_DIR_MISMATCH' }
  }
  return null
}

const occupancy = (lease) => (
  lease.lease_kind === 'writer_seat' &&
  !(lease.state === 'RELEASED' && typeof lease.release_evidence_ref === 'string')
)

const resourceHeld = (lease) => lease.state !== 'RELEASED' || lease.retention_state === 'RETAINED_FOR_REVIEW'

const findAdmissionBlocker = (record, request, writerCap) => {
  if (record.leases[request.lease_id]) {
    return { status: 'HELD_EXECUTION_AUTHORITY', reason: 'LEASE_ID_ALREADY_BOUND' }
  }
  for (const lease of Object.values(record.leases)) {
    if (resourceHeld(lease) && request.resource_keys.some((key) => lease.resource_keys.includes(key))) {
      return { status: 'QUEUED_FOR_LEASE', reason: 'RESOURCE_CONFLICT' }
    }
  }
  const occupiedSeats = Object.values(record.leases).filter(occupancy).length
  if (occupiedSeats >= writerCap) return { status: 'QUEUED_FOR_LEASE', reason: 'WRITER_CAPACITY' }
  return null
}

const stampLease = (lease) => stamp(lease)

const createLeaseRecord = (request, timestamp) => stampLease({
  schema_version: 'session-lease/v1',
  generation: request.generation,
  nonce: request.nonce,
  created_at: timestamp,
  updated_at: timestamp,
  lease_id: request.lease_id,
  lease_kind: 'writer_seat',
  plan_id: request.plan_id,
  task_id: request.task_id,
  provider: request.provider,
  owner_session: request.owner_session,
  provider_session_id: request.provider_session_id,
  execution_context_id: request.execution_context_id,
  context_attestation_ref: request.context_attestation_ref,
  common_dir_digest: request.common_dir_digest,
  worktree_id: request.worktree_id,
  worktree_path_digest: request.worktree_path_digest,
  branch: request.branch,
  scope_digest: request.scope_digest,
  head_sha: request.head_sha,
  resource_keys: [...request.resource_keys],
  state: 'ACTIVE',
  heartbeat_seq: 1,
  heartbeat_at: timestamp,
  release_evidence_ref: null,
  retention_state: 'ACTIVE',
  revocation_epoch: 0,
})

const LEASE_BASE_KEYS = Object.freeze([
  'schema_version', 'generation', 'nonce', 'created_at', 'updated_at', 'lease_id', 'lease_kind', 'plan_id', 'task_id',
  'provider', 'owner_session', 'provider_session_id', 'execution_context_id', 'context_attestation_ref', 'common_dir_digest',
  'worktree_id', 'worktree_path_digest', 'branch', 'scope_digest', 'head_sha', 'resource_keys', 'state', 'heartbeat_seq',
  'heartbeat_at', 'release_evidence_ref', 'retention_state', 'revocation_epoch', 'canonical_digest',
])

const validateOwnerEndReleaseRecord = (record) => {
  exactKeys(record, [
    'schema_version', 'release_id', 'plan_id', 'generation', 'task_id', 'lease_id', 'lease_kind', 'owner_session', 'provider',
    'provider_session_id', 'execution_context_id', 'final_heartbeat_seq', 'final_head_sha', 'scope_digest', 'worktree_path_digest',
    'handoff_or_candidate_reference', 'release_reason', 'owner_end_attestation_ref', 'owner_end_attestation_digest',
    'attestor_issuer', 'attestor_version', 'observed_at', 'expires_at', 'nonce', 'revocation_epoch', 'expected_registry_oid',
    'expected_envelope_oid', 'transition_sequence', 'retained_resource_keys',
  ], 'lease_release')
  assertNoSensitiveMaterial(record, 'lease_release')
  if (record.schema_version !== 'lease-release/v1') fail('registry_record_invalid', 'lease_release_schema')
  for (const key of [
    'release_id', 'plan_id', 'task_id', 'lease_id', 'owner_session', 'provider_session_id', 'execution_context_id',
    'handoff_or_candidate_reference', 'owner_end_attestation_ref', 'attestor_issuer',
  ]) assertTask2OpaqueId(record[key], `lease_release.${key}`)
  assertTask2OpaqueId(record.attestor_version, 'lease_release.attestor_version')
  if (!['codex', 'claude'].includes(record.provider) || record.lease_kind !== 'writer_seat' ||
      !['handoff', 'failed', 'aborted'].includes(record.release_reason)) fail('registry_record_invalid', 'lease_release_enum')
  for (const key of ['owner_end_attestation_digest', 'scope_digest', 'worktree_path_digest']) assertDigest(record[key], `lease_release.${key}`)
  for (const key of ['final_head_sha', 'expected_registry_oid', 'expected_envelope_oid']) {
    assertOid(record[key], `lease_release.${key}`, { zero: false })
  }
  for (const key of ['observed_at', 'expires_at']) parseTimestamp(record[key], `lease_release.${key}`)
  if (parseTimestamp(record.expires_at, 'lease_release.expires_at') <= parseTimestamp(record.observed_at, 'lease_release.observed_at')) {
    fail('registry_record_invalid', 'lease_release_expiry')
  }
  assertNonce(record.nonce, 'lease_release.nonce')
  for (const key of ['generation', 'final_heartbeat_seq', 'revocation_epoch', 'transition_sequence']) {
    if (!Number.isSafeInteger(record[key]) || record[key] < 0) fail('registry_record_invalid', `lease_release.${key}`)
  }
  if (record.generation < 1 || record.final_heartbeat_seq < 1 || !Array.isArray(record.retained_resource_keys) ||
      record.retained_resource_keys.length === 0 || record.retained_resource_keys.length > 256) {
    fail('registry_record_invalid', 'lease_release_transition')
  }
  record.retained_resource_keys.forEach((key, index) => assertTask2ResourceKey(key, `lease_release.retained_resource_keys[${index}]`))
  if (new Set(record.retained_resource_keys).size !== record.retained_resource_keys.length) {
    fail('registry_record_invalid', 'lease_release_retained_resources')
  }
}

const validateReleaseReservation = (record) => {
  exactKeys(record, [
    'schema_version', 'generation', 'nonce', 'created_at', 'updated_at', 'release_id', 'lease_id',
    'attestation_ref', 'attestation_digest', 'attestor_issuer', 'attestor_version', 'observed_at', 'expires_at',
    'revocation_epoch', 'expected_registry_oid', 'expected_envelope_oid', 'expected_envelope_transition_sequence',
    'canonical_digest',
  ], 'lease_release_reservation')
  assertStamped(record, 'lease_release_reservation')
  if (record.schema_version !== 'lease-release-reservation/v1') fail('registry_record_invalid', 'lease_release_reservation_schema')
  for (const key of ['release_id', 'lease_id', 'attestation_ref', 'attestor_issuer']) {
    assertTask2OpaqueId(record[key], `lease_release_reservation.${key}`)
  }
  assertTask2OpaqueId(record.attestor_version, 'lease_release_reservation.attestor_version')
  assertDigest(record.attestation_digest, 'lease_release_reservation.attestation_digest')
  for (const key of ['expected_registry_oid', 'expected_envelope_oid']) assertOid(record[key], `lease_release_reservation.${key}`, { zero: false })
  for (const key of ['observed_at', 'expires_at']) parseTimestamp(record[key], `lease_release_reservation.${key}`)
  if (parseTimestamp(record.expires_at, 'lease_release_reservation.expires_at') <= parseTimestamp(record.observed_at, 'lease_release_reservation.observed_at') ||
      !Number.isSafeInteger(record.expected_envelope_transition_sequence) || record.expected_envelope_transition_sequence < 0 ||
      !Number.isSafeInteger(record.revocation_epoch) || record.revocation_epoch < 0) {
    fail('registry_record_invalid', 'lease_release_reservation_binding')
  }
}

const validateEnvelopeRevocationProof = (record, reservation) => {
  exactKeys(record, [
    'schema_version', 'release_id', 'lease_id', 'previous_oid', 'oid', 'transition_sequence', 'revocation_epoch',
    'in_flight_command', 'observed_at', 'canonical_digest',
  ], 'envelope_revocation_proof')
  if (record.schema_version !== 'envelope-revocation-proof/v1') fail('registry_record_invalid', 'envelope_revocation_proof_schema')
  for (const key of ['release_id', 'lease_id']) assertTask2OpaqueId(record[key], `envelope_revocation_proof.${key}`)
  for (const key of ['previous_oid', 'oid']) assertOid(record[key], `envelope_revocation_proof.${key}`, { zero: false })
  if (!Number.isSafeInteger(record.transition_sequence) || record.transition_sequence < 0 ||
      !Number.isSafeInteger(record.revocation_epoch) || record.revocation_epoch < 0 || record.in_flight_command !== false) {
    fail('registry_record_invalid', 'envelope_revocation_proof_binding')
  }
  parseTimestamp(record.observed_at, 'envelope_revocation_proof.observed_at')
  assertDigest(record.canonical_digest, 'envelope_revocation_proof.canonical_digest')
  const withoutDigest = { ...record }
  delete withoutDigest.canonical_digest
  if (digestCanonical(withoutDigest) !== record.canonical_digest || record.release_id !== reservation.release_id ||
      record.lease_id !== reservation.lease_id || record.previous_oid !== reservation.expected_envelope_oid ||
      record.oid === record.previous_oid || record.transition_sequence !== reservation.expected_envelope_transition_sequence + 1 ||
      record.revocation_epoch !== reservation.revocation_epoch) {
    fail('registry_record_invalid', 'envelope_revocation_proof_binding')
  }
}

const validateLeaseRecord = (lease, leaseId) => {
  if (!isObject(lease)) fail('registry_record_invalid', 'lease_not_object')
  const stateExtras = {
    ACTIVE: [],
    SUSPECT: ['suspect_at'],
    END_REQUESTED: ['end_request'],
    RELEASING: ['end_request', 'release_reservation'],
    RELEASED: [
      'end_request', 'release_transition', 'release_evidence_digest', 'release_reason', 'envelope_revocation_oid', 'release_record',
    ],
  }
  if (!Object.hasOwn(stateExtras, lease.state)) fail('registry_record_invalid', 'lease_state')
  const extras = lease.state === 'RELEASING' && Object.hasOwn(lease, 'envelope_revocation_proof')
    ? [...stateExtras.RELEASING, 'envelope_revocation_proof']
    : stateExtras[lease.state]
  exactKeys(lease, [...LEASE_BASE_KEYS, ...extras], `lease.${leaseId}`)
  assertStamped(lease, `lease.${leaseId}`)
  if (lease.schema_version !== 'session-lease/v1' || lease.lease_id !== leaseId || lease.lease_kind !== 'writer_seat' ||
      !['codex', 'claude'].includes(lease.provider)) fail('registry_record_invalid', `lease.${leaseId}_identity`)
  for (const key of [
    'lease_id', 'plan_id', 'task_id', 'owner_session', 'provider_session_id', 'execution_context_id',
  ]) assertTask2OpaqueId(lease[key], `lease.${leaseId}.${key}`)
  for (const key of ['context_attestation_ref', 'worktree_id']) assertOpaque(lease[key], `lease.${leaseId}.${key}`)
  assertIdentifier(lease.branch, `lease.${leaseId}.branch`)
  for (const key of ['common_dir_digest', 'worktree_path_digest', 'scope_digest']) assertDigest(lease[key], `lease.${leaseId}.${key}`)
  assertOid(lease.head_sha, `lease.${leaseId}.head_sha`, { zero: false })
  assertNonce(lease.nonce, `lease.${leaseId}.nonce`)
  if (!Number.isSafeInteger(lease.generation) || lease.generation < 1 || !Number.isSafeInteger(lease.heartbeat_seq) ||
      lease.heartbeat_seq < 1 || !Number.isSafeInteger(lease.revocation_epoch) || lease.revocation_epoch < 0 ||
      !Array.isArray(lease.resource_keys) || lease.resource_keys.length === 0 || lease.resource_keys.length > 256) {
    fail('registry_record_invalid', `lease.${leaseId}_shape`)
  }
  lease.resource_keys.forEach((key, index) => assertTask2ResourceKey(key, `lease.${leaseId}.resource_keys[${index}]`))
  if (new Set(lease.resource_keys).size !== lease.resource_keys.length) fail('registry_record_invalid', `lease.${leaseId}_resources`)
  parseTimestamp(lease.heartbeat_at, `lease.${leaseId}.heartbeat_at`)
  if (lease.state === 'RELEASED') {
    if (lease.retention_state !== 'RETAINED_FOR_REVIEW' || typeof lease.release_evidence_ref !== 'string' ||
        !Array.isArray(lease.release_transition) || lease.release_transition.join(':') !== 'RELEASING:RELEASED') {
      fail('registry_record_invalid', `lease.${leaseId}_release_state`)
    }
    assertTask2OpaqueId(lease.release_evidence_ref, `lease.${leaseId}.release_evidence_ref`)
    assertDigest(lease.release_evidence_digest, `lease.${leaseId}.release_evidence_digest`)
    assertOid(lease.envelope_revocation_oid, `lease.${leaseId}.envelope_revocation_oid`, { zero: false })
    validateOwnerEndReleaseRecord(lease.release_record)
    if (lease.release_record.lease_id !== lease.lease_id || lease.release_record.owner_end_attestation_ref !== lease.release_evidence_ref ||
        lease.release_record.owner_end_attestation_digest !== lease.release_evidence_digest || lease.release_record.final_head_sha !== lease.head_sha ||
        lease.release_record.release_reason !== lease.release_reason) {
      fail('registry_record_invalid', `lease.${leaseId}_release_binding`)
    }
  } else if (lease.retention_state !== 'ACTIVE' || lease.release_evidence_ref !== null) {
    fail('registry_record_invalid', `lease.${leaseId}_active_retention`)
  }
  if (lease.state === 'RELEASING') {
    validateReleaseReservation(lease.release_reservation)
    if (lease.release_reservation.lease_id !== lease.lease_id || lease.release_reservation.generation !== lease.generation ||
        lease.release_reservation.revocation_epoch !== lease.revocation_epoch) {
      fail('registry_record_invalid', `lease.${leaseId}_release_reservation_binding`)
    }
    if (Object.hasOwn(lease, 'envelope_revocation_proof')) {
      validateEnvelopeRevocationProof(lease.envelope_revocation_proof, lease.release_reservation)
    }
  }
  if (lease.state === 'SUSPECT') parseTimestamp(lease.suspect_at, `lease.${leaseId}.suspect_at`)
  if (lease.state === 'END_REQUESTED' || lease.state === 'RELEASING' || lease.state === 'RELEASED') {
    exactKeys(lease.end_request, ['reason', 'requested_at', 'nonce', 'handoff_or_candidate_reference'], `lease.${leaseId}.end_request`)
    if (!['handoff', 'failed', 'aborted'].includes(lease.end_request.reason)) fail('registry_record_invalid', `lease.${leaseId}_end_reason`)
    parseTimestamp(lease.end_request.requested_at, `lease.${leaseId}.end_request.requested_at`)
    assertNonce(lease.end_request.nonce, `lease.${leaseId}.end_request.nonce`)
    assertTask2OpaqueId(lease.end_request.handoff_or_candidate_reference, `lease.${leaseId}.end_request.handoff_or_candidate_reference`)
  }
}

const validateLeaseRegistryRecord = (record, writerCap) => {
  exactKeys(record, [
    'schema_version', 'generation', 'nonce', 'created_at', 'updated_at', 'writer_cap', 'leases', 'used_owner_end_attestations', 'canonical_digest',
  ], 'lease_registry')
  if (record.schema_version !== 'session-lease-registry/v1' || record.writer_cap !== writerCap || !isObject(record.leases) ||
      !isObject(record.used_owner_end_attestations)) fail('registry_record_invalid', 'lease_registry_shape')
  assertStamped(record, 'lease_registry')
  for (const [leaseId, lease] of Object.entries(record.leases)) {
    assertTask2OpaqueId(leaseId, 'lease_registry.lease_key')
    validateLeaseRecord(lease, leaseId)
  }
  if (Object.values(record.leases).filter(occupancy).length > writerCap) {
    fail('registry_record_invalid', 'lease_registry_writer_capacity')
  }
  for (const [attestationRef, used] of Object.entries(record.used_owner_end_attestations)) {
    assertTask2OpaqueId(attestationRef, 'lease_registry.used_attestation_ref')
    exactKeys(used, ['nonce', 'lease_id', 'consumed_at', 'release_id', 'release_record_digest'], 'lease_registry.used_attestation')
    assertNonce(used.nonce, 'lease_registry.used_attestation.nonce')
    assertTask2OpaqueId(used.lease_id, 'lease_registry.used_attestation.lease_id')
    assertTask2OpaqueId(used.release_id, 'lease_registry.used_attestation.release_id')
    assertDigest(used.release_record_digest, 'lease_registry.used_attestation.release_record_digest')
    parseTimestamp(used.consumed_at, 'lease_registry.used_attestation.consumed_at')
  }
  return record
}

const freezeIJson = (value) => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) freezeIJson(nested)
    Object.freeze(value)
  }
  return value
}

const cloneIJson = (value) => {
  canonicalize(value)
  return structuredClone(value)
}

// This is the only exported boundary for consumers that need the durable Task3 lease grammar.
// `canonicalize` first rejects non-I-JSON input; the subsequent clone preserves durable bytes.
export function parseSessionLease(raw, leaseId) {
  const parsed = cloneIJson(raw)
  assertTask2OpaqueId(leaseId, 'session_lease_id')
  validateLeaseRecord(parsed, leaseId)
  return freezeIJson(parsed)
}

export function parseSessionLeaseRegistry(raw, writerCap = WRITER_CAP_V1) {
  const parsed = cloneIJson(raw)
  if (writerCap !== WRITER_CAP_V1) fail('invalid_value', 'writer_cap_must_equal_two')
  validateLeaseRegistryRecord(parsed, writerCap)
  return freezeIJson(parsed)
}

function validatePersistedRecordForRef(ref, record) {
  if (ref === PLAN_REF) return validatePlanRegistryRecord(record)
  if (ref === LEASE_REF) {
    if (isObject(record) && record.schema_version === 'queue-registry/v1') return validateQueueRegistryRecord(record)
    return validateLeaseRegistryRecord(record, WRITER_CAP_V1)
  }
  fail('registry_ref_forbidden', String(ref))
}

const nextRegistryRecord = ({ current, writerCap, nonce, timestamp, leases, usedOwnerEndAttestations }) => {
  const record = stamp({
    schema_version: 'session-lease-registry/v1',
    generation: (current?.generation ?? 0) + 1,
    nonce,
    created_at: current?.created_at ?? timestamp,
    updated_at: timestamp,
    writer_cap: writerCap,
    leases,
    used_owner_end_attestations: usedOwnerEndAttestations,
  })
  validateLeaseRegistryRecord(record, writerCap)
  return record
}

const registrySnapshot = async (store, writerCap) => {
  try {
    const snapshot = await store.read(LEASE_REF)
    if (snapshot.record === null) return { ...snapshot, record: emptyLeaseRegistry(writerCap) }
    validateLeaseRegistryRecord(snapshot.record, writerCap)
    return snapshot
  } catch {
    return heldRegistryIntegrity(LEASE_REF)
  }
}

const updateLease = (lease, fields) => stampLease({ ...lease, ...fields })

const casConflict = (result) => ({
  status: 'CONFLICT',
  reason: 'CAS_CONFLICT',
  expected_oid: result.expected_oid,
  actual_oid: result.actual_oid,
  current: result.current,
})

const queueAfterConflict = (current, request, writerCap, result) => {
  if (current?.record !== null && current?.record !== undefined) {
    try {
      validateLeaseRegistryRecord(current.record, writerCap)
    } catch {
      return heldRegistryIntegrity(LEASE_REF)
    }
  }
  const blocker = findAdmissionBlocker(current?.record ?? emptyLeaseRegistry(writerCap), request, writerCap)
  if (blocker?.status === 'QUEUED_FOR_LEASE') {
    return { ...blocker, conflict: { code: 'CAS_CONFLICT', actual_oid: result.actual_oid } }
  }
  return casConflict(result)
}

const requireLease = (snapshot, leaseId) => {
  assertOpaque(leaseId, 'lease_id')
  const lease = snapshot.record.leases[leaseId]
  if (!lease) fail('lease_not_found', leaseId)
  return lease
}

const validateExpectedSnapshot = (snapshot, expectedOid) => {
  assertOid(expectedOid, 'expected_oid')
  if (snapshot.oid !== expectedOid) {
    return {
      status: 'CONFLICT',
      reason: 'CAS_CONFLICT',
      expected_oid: expectedOid,
      actual_oid: snapshot.oid,
      current: snapshot,
    }
  }
  return null
}

const updateSingleLease = async ({ store, writerCap, clock, leaseId, expectedOid, nonce, transform }) => {
  assertTask2OpaqueId(leaseId, 'lease_id')
  assertOid(expectedOid, 'lease_expected_oid')
  assertNonce(nonce, 'lease_nonce')
  const snapshot = await registrySnapshot(store, writerCap)
  if (snapshot.status === 'HELD_REGISTRY_INTEGRITY') return snapshot
  const stale = validateExpectedSnapshot(snapshot, expectedOid)
  if (stale) return stale
  const lease = requireLease(snapshot, leaseId)
  const timestamp = nowFrom(clock)
  const nextLease = transform(lease, timestamp)
  if (isObject(nextLease) && nextLease.status === 'END_REQUESTED' && nextLease.idempotent === true) {
    return { status: 'END_REQUESTED', oid: snapshot.oid, lease }
  }
  if (isObject(nextLease) && nextLease.status === 'HELD_EXECUTION_AUTHORITY') return nextLease
  const leases = clone(snapshot.record.leases)
  leases[leaseId] = nextLease
  const next = nextRegistryRecord({
    current: snapshot.record,
    writerCap,
    nonce,
    timestamp,
    leases,
    usedOwnerEndAttestations: clone(snapshot.record.used_owner_end_attestations),
  })
  const result = await store.cas({ ref: LEASE_REF, expected_oid: expectedOid, record: next })
  return result.status === 'STORED' ? { ...result, lease: nextLease } : casConflict(result)
}

const OWNER_END_ATTESTATION_KEYS = Object.freeze([
    'attestation_ref', 'attestation_digest', 'issuer_id', 'issuer_version', 'owner_session', 'provider',
    'provider_session_id', 'execution_context_id', 'lease_id', 'generation', 'head_sha', 'scope_digest',
    'worktree_path_digest', 'observed_at', 'expires_at', 'nonce', 'revocation_epoch',
])

const validateOwnerEndAttestationShape = (attestation) => {
  validateClosedRequest(attestation, OWNER_END_ATTESTATION_KEYS, 'owner_end_attestation')
  for (const field of [
    'attestation_ref', 'issuer_id', 'issuer_version', 'owner_session', 'provider_session_id', 'execution_context_id', 'lease_id',
  ]) assertTask2OpaqueId(attestation[field], `owner_end_attestation.${field}`)
  assertDigest(attestation.attestation_digest, 'owner_end_attestation.attestation_digest')
  if (!['codex', 'claude'].includes(attestation.provider)) fail('invalid_value', 'owner_end_attestation.provider_invalid')
  assertOid(attestation.head_sha, 'owner_end_attestation.head_sha', { zero: false })
  for (const field of ['scope_digest', 'worktree_path_digest']) assertDigest(attestation[field], `owner_end_attestation.${field}`)
  parseTimestamp(attestation.observed_at, 'owner_end_attestation.observed_at')
  const expiresAt = parseTimestamp(attestation.expires_at, 'owner_end_attestation.expires_at')
  if (expiresAt <= parseTimestamp(attestation.observed_at, 'owner_end_attestation.observed_at')) fail('invalid_value', 'owner_end_attestation_expiry')
  assertNonce(attestation.nonce, 'owner_end_attestation.nonce')
  if (!Number.isSafeInteger(attestation.generation) || attestation.generation < 1 ||
      !Number.isSafeInteger(attestation.revocation_epoch) || attestation.revocation_epoch < 0) {
    fail('invalid_value', 'owner_end_attestation_generation_invalid')
  }
  return attestation
}

const validateOwnerEndAttestation = (attestation, lease, now, used) => {
  validateOwnerEndAttestationShape(attestation)
  const expiresAt = parseTimestamp(attestation.expires_at, 'owner_end_attestation.expires_at')
  const currentTime = parseTimestamp(now, 'release_now')
  if (expiresAt <= currentTime) fail('owner_end_attestation_expired', 'attestation_expired')
  if (parseTimestamp(attestation.observed_at, 'owner_end_attestation.observed_at') > currentTime) {
    fail('owner_end_attestation_untrusted', 'attestation_from_future')
  }
  if (attestation.issuer_id === lease.owner_session) fail('owner_end_attestation_untrusted', 'self_issued')
  const fields = [
    'owner_session', 'provider', 'provider_session_id', 'execution_context_id', 'lease_id', 'generation',
    'head_sha', 'scope_digest', 'worktree_path_digest',
  ]
  for (const field of fields) {
    if (attestation[field] !== lease[field]) fail('owner_end_attestation_tuple_mismatch', field)
  }
  if (attestation.revocation_epoch !== lease.revocation_epoch) fail('owner_end_attestation_tuple_mismatch', 'revocation_epoch')
  if (Object.hasOwn(used, attestation.attestation_ref) || Object.values(used).some((entry) => entry.nonce === attestation.nonce)) {
    fail('owner_end_attestation_replayed', 'attestation_reused')
  }
}

const validateReservedOwnerEndAttestation = (attestation, lease, reservation) => {
  validateOwnerEndAttestationShape(attestation)
  if (attestation.issuer_id === lease.owner_session) fail('owner_end_attestation_untrusted', 'self_issued')
  for (const field of [
    'owner_session', 'provider', 'provider_session_id', 'execution_context_id', 'lease_id', 'generation',
    'head_sha', 'scope_digest', 'worktree_path_digest',
  ]) {
    if (attestation[field] !== lease[field]) fail('owner_end_attestation_tuple_mismatch', field)
  }
  const reservationBindings = [
    ['attestation_ref', 'attestation_ref'], ['attestation_digest', 'attestation_digest'], ['issuer_id', 'attestor_issuer'],
    ['issuer_version', 'attestor_version'], ['observed_at', 'observed_at'], ['expires_at', 'expires_at'],
    ['nonce', 'nonce'], ['revocation_epoch', 'revocation_epoch'],
  ]
  for (const [attestationField, reservationField] of reservationBindings) {
    if (attestation[attestationField] !== reservation[reservationField]) {
      fail('owner_end_attestation_tuple_mismatch', attestationField)
    }
  }
}

export function createLeaseRegistry({ store, clock, writerCap = WRITER_CAP_V1, ownerEndAttestor = undefined, executionEnvelope = undefined }) {
  if (!store || typeof store.read !== 'function' || typeof store.cas !== 'function') fail('invalid_port', 'lease_store_required')
  if (writerCap !== WRITER_CAP_V1) fail('invalid_value', 'writer_cap_must_equal_two')

  const inspect = () => registrySnapshot(store, writerCap)

  const admit = async (request) => {
    assertNoSensitiveMaterial(request, 'lease_request')
    const topology = validateLeaseRequest(request, store)
    if (topology) return topology
    const snapshot = await registrySnapshot(store, writerCap)
    if (snapshot.status === 'HELD_REGISTRY_INTEGRITY') return snapshot
    const blocker = findAdmissionBlocker(snapshot.record, request, writerCap)
    if (blocker) return blocker
    const timestamp = nowFrom(clock)
    const lease = createLeaseRecord(request, timestamp)
    const leases = clone(snapshot.record.leases)
    leases[request.lease_id] = lease
    const record = nextRegistryRecord({
      current: snapshot.record,
      writerCap,
      nonce: request.nonce,
      timestamp,
      leases,
      usedOwnerEndAttestations: clone(snapshot.record.used_owner_end_attestations),
    })
    const result = await store.cas({ ref: LEASE_REF, expected_oid: snapshot.oid, record })
    if (result.status === 'STORED') return { ...result, status: 'ADMITTED', lease }
    return queueAfterConflict(result.current, request, writerCap, result)
  }

  const heartbeat = (input) => {
    const { lease_id, expected_oid, heartbeat_seq, nonce } = validateClosedRequest(input, [
      'lease_id', 'expected_oid', 'heartbeat_seq', 'nonce',
    ], 'heartbeat_request')
    if (!Number.isSafeInteger(heartbeat_seq) || heartbeat_seq < 1) fail('invalid_value', 'heartbeat_seq_invalid')
    return updateSingleLease({
      store,
      writerCap,
      clock,
      leaseId: lease_id,
      expectedOid: expected_oid,
      nonce,
      transform: (lease, timestamp) => {
        if (lease.state === 'END_REQUESTED' || lease.state === 'RELEASING') {
          return { status: 'HELD_EXECUTION_AUTHORITY', reason: 'RELEASE_IN_PROGRESS', reconcile_required: false }
        }
        if (lease.state === 'RELEASED') fail('lease_released', lease.lease_id)
        if (lease.state === 'SUSPECT') fail('resume_intent_required', lease.lease_id)
        if (heartbeat_seq <= lease.heartbeat_seq) fail('heartbeat_not_monotonic', lease.lease_id)
        return updateLease(lease, {
          nonce,
          updated_at: timestamp,
          heartbeat_seq,
          heartbeat_at: timestamp,
        })
      },
    }).then((result) => result.status === 'STORED' ? { ...result, status: 'HEARTBEAT_RECORDED' } : result)
  }

  const reconcileTimeout = (input) => {
    const { lease_id, expected_oid, timeout_ms, nonce } = validateClosedRequest(input, [
      'lease_id', 'expected_oid', 'timeout_ms', 'nonce',
    ], 'reconcile_timeout_request')
    assertTask2OpaqueId(lease_id, 'reconcile_timeout_lease_id')
    assertOid(expected_oid, 'reconcile_timeout_expected_oid')
    assertNonce(nonce, 'reconcile_timeout_nonce')
    if (!Number.isSafeInteger(timeout_ms) || timeout_ms < 1) fail('invalid_value', 'timeout_ms_invalid')
    return (async () => {
      const snapshot = await registrySnapshot(store, writerCap)
      if (snapshot.status === 'HELD_REGISTRY_INTEGRITY') return snapshot
      const stale = validateExpectedSnapshot(snapshot, expected_oid)
      if (stale) return stale
      const lease = requireLease(snapshot, lease_id)
      if (lease.state === 'RELEASED') return { status: 'RELEASED', oid: snapshot.oid, lease }
      if (lease.state === 'END_REQUESTED') {
        return {
          status: 'HELD_EXECUTION_AUTHORITY',
          reason: 'OWNER_END_ATTESTATION_EVIDENCE_GAP',
          reconcile_required: true,
          oid: snapshot.oid,
          lease,
        }
      }
      if (lease.state === 'RELEASING') {
        return {
          status: 'HELD_EXECUTION_AUTHORITY',
          reason: 'RELEASE_RECONCILIATION_REQUIRED',
          reconcile_required: true,
          release_id: lease.release_reservation.release_id,
          oid: snapshot.oid,
          lease,
        }
      }
      const timestamp = nowFrom(clock)
      if (Date.parse(timestamp) - Date.parse(lease.heartbeat_at) < timeout_ms) {
        return { status: lease.state, oid: snapshot.oid, lease }
      }
      const nextLease = updateLease(lease, {
        nonce,
        updated_at: timestamp,
        state: 'SUSPECT',
        suspect_at: timestamp,
      })
      const leases = clone(snapshot.record.leases)
      leases[lease_id] = nextLease
      const record = nextRegistryRecord({
        current: snapshot.record,
        writerCap,
        nonce,
        timestamp,
        leases,
        usedOwnerEndAttestations: clone(snapshot.record.used_owner_end_attestations),
      })
      const result = await store.cas({ ref: LEASE_REF, expected_oid, record })
      return result.status === 'STORED' ? { ...result, status: 'SUSPECT', lease: nextLease } : casConflict(result)
    })()
  }

  const endRequest = (input) => {
    const { lease_id, expected_oid, nonce, reason, handoff_or_candidate_reference } = validateClosedRequest(input, [
      'lease_id', 'expected_oid', 'nonce', 'reason', 'handoff_or_candidate_reference',
    ], 'end_request')
    if (!['handoff', 'failed', 'aborted'].includes(reason)) fail('invalid_value', 'end_request_reason_invalid')
    assertTask2OpaqueId(handoff_or_candidate_reference, 'end_request_handoff_or_candidate_reference')
    return updateSingleLease({
      store,
      writerCap,
      clock,
      leaseId: lease_id,
      expectedOid: expected_oid,
      nonce,
      transform: (lease, timestamp) => {
        if (lease.state === 'END_REQUESTED') {
          const same = lease.end_request.reason === reason &&
            lease.end_request.handoff_or_candidate_reference === handoff_or_candidate_reference &&
            lease.end_request.nonce === nonce
          return same
            ? { status: 'END_REQUESTED', idempotent: true }
            : { status: 'HELD_EXECUTION_AUTHORITY', reason: 'END_REQUEST_IMMUTABLE', reconcile_required: false }
        }
        if (lease.state === 'RELEASING') {
          return { status: 'HELD_EXECUTION_AUTHORITY', reason: 'RELEASE_IN_PROGRESS', reconcile_required: false }
        }
        if (lease.state === 'RELEASED') fail('lease_released', lease.lease_id)
        if (lease.state !== 'ACTIVE') {
          return { status: 'HELD_EXECUTION_AUTHORITY', reason: 'END_REQUEST_REQUIRES_ACTIVE', reconcile_required: false }
        }
        return updateLease(lease, {
          nonce,
          updated_at: timestamp,
          state: 'END_REQUESTED',
          end_request: { reason, requested_at: timestamp, nonce, handoff_or_candidate_reference },
        })
      },
    }).then((result) => result.status === 'STORED' ? { ...result, status: 'END_REQUESTED' } : result)
  }

  const finalizeReservedRelease = async ({ snapshot, lease, input }) => {
    const reservation = lease.release_reservation
    validateReservedOwnerEndAttestation(input.attestation, lease, reservation)
    if (input.expected_envelope_oid !== reservation.expected_envelope_oid ||
        input.expected_envelope_transition_sequence !== reservation.expected_envelope_transition_sequence ||
        input.attestation.attestation_ref !== reservation.attestation_ref ||
        input.attestation.attestation_digest !== reservation.attestation_digest || input.attestation.nonce !== reservation.nonce) {
      return { status: 'HELD_EXECUTION_AUTHORITY', reason: 'RELEASE_RECONCILIATION_REQUIRED', reconcile_required: true, release_id: reservation.release_id }
    }
    if (!Object.hasOwn(lease, 'envelope_revocation_proof')) {
      return { status: 'HELD_EXECUTION_AUTHORITY', reason: 'RELEASE_RECONCILIATION_REQUIRED', reconcile_required: true, release_id: reservation.release_id }
    }
    validateEnvelopeRevocationProof(lease.envelope_revocation_proof, reservation)
    if (Object.hasOwn(snapshot.record.used_owner_end_attestations, reservation.attestation_ref)) {
      return { status: 'HELD_EXECUTION_AUTHORITY', reason: 'RELEASE_RECONCILIATION_REQUIRED', reconcile_required: true, release_id: reservation.release_id }
    }
    const releaseRecord = {
      schema_version: 'lease-release/v1',
      release_id: reservation.release_id,
      plan_id: lease.plan_id,
      generation: lease.generation,
      task_id: lease.task_id,
      lease_id: lease.lease_id,
      lease_kind: lease.lease_kind,
      owner_session: lease.owner_session,
      provider: lease.provider,
      provider_session_id: lease.provider_session_id,
      execution_context_id: lease.execution_context_id,
      final_heartbeat_seq: lease.heartbeat_seq,
      final_head_sha: lease.head_sha,
      scope_digest: lease.scope_digest,
      worktree_path_digest: lease.worktree_path_digest,
      handoff_or_candidate_reference: lease.end_request.handoff_or_candidate_reference,
      release_reason: lease.end_request.reason,
      owner_end_attestation_ref: reservation.attestation_ref,
      owner_end_attestation_digest: reservation.attestation_digest,
      attestor_issuer: reservation.attestor_issuer,
      attestor_version: reservation.attestor_version,
      observed_at: reservation.observed_at,
      expires_at: reservation.expires_at,
      nonce: reservation.nonce,
      revocation_epoch: reservation.revocation_epoch,
      expected_registry_oid: snapshot.oid,
      expected_envelope_oid: reservation.expected_envelope_oid,
      transition_sequence: reservation.expected_envelope_transition_sequence,
      retained_resource_keys: [...lease.resource_keys],
    }
    validateOwnerEndReleaseRecord(releaseRecord)
    const {
      release_reservation: ignoredReservation,
      envelope_revocation_proof: envelopeProof,
      ...reservationFreeLease
    } = lease
    const releasedLease = updateLease(reservationFreeLease, {
      nonce: reservation.nonce,
      updated_at: nowFrom(clock),
      state: 'RELEASED',
      release_transition: ['RELEASING', 'RELEASED'],
      release_evidence_ref: reservation.attestation_ref,
      release_evidence_digest: reservation.attestation_digest,
      release_reason: lease.end_request.reason,
      retention_state: 'RETAINED_FOR_REVIEW',
      envelope_revocation_oid: envelopeProof.oid,
      release_record: releaseRecord,
    })
    const leases = clone(snapshot.record.leases)
    leases[lease.lease_id] = releasedLease
    const used = clone(snapshot.record.used_owner_end_attestations)
    used[reservation.attestation_ref] = {
      nonce: reservation.nonce,
      lease_id: lease.lease_id,
      consumed_at: nowFrom(clock),
      release_id: reservation.release_id,
      release_record_digest: digestCanonical(releaseRecord),
    }
    const timestamp = nowFrom(clock)
    const record = nextRegistryRecord({
      current: snapshot.record,
      writerCap,
      nonce: reservation.nonce,
      timestamp,
      leases,
      usedOwnerEndAttestations: used,
    })
    try {
      const result = await store.cas({ ref: LEASE_REF, expected_oid: snapshot.oid, record })
      if (result.status === 'STORED') return { ...result, status: 'RELEASED', lease: releasedLease }
    } catch {
      // The digest-bound proof remains in the occupied reservation.
    }
    return {
      status: 'HELD_EXECUTION_AUTHORITY',
      reason: 'RELEASE_FINALIZE_CAS_CONFLICT',
      reconcile_required: true,
      release_id: reservation.release_id,
    }
  }

  const release = async (input) => {
    validateClosedRequest(input, ['lease_id', 'expected_oid', 'expected_envelope_oid', 'expected_envelope_transition_sequence', 'attestation'], 'lease_release_request')
    const { lease_id, expected_oid, expected_envelope_oid, expected_envelope_transition_sequence, attestation } = input
    assertTask2OpaqueId(lease_id, 'release_lease_id')
    assertOid(expected_oid, 'release_expected_oid')
    assertOid(expected_envelope_oid, 'release_expected_envelope_oid', { zero: false })
    if (!Number.isSafeInteger(expected_envelope_transition_sequence) || expected_envelope_transition_sequence < 0) {
      fail('invalid_value', 'release_expected_envelope_transition_sequence_invalid')
    }
    validateOwnerEndAttestationShape(attestation)
    const snapshot = await registrySnapshot(store, writerCap)
    if (snapshot.status === 'HELD_REGISTRY_INTEGRITY') return snapshot
    const stale = validateExpectedSnapshot(snapshot, expected_oid)
    if (stale) {
      const currentLease = stale.current?.record?.leases?.[lease_id]
      if (currentLease?.state === 'RELEASING') {
        return { status: 'HELD_EXECUTION_AUTHORITY', reason: 'RELEASE_IN_PROGRESS', reconcile_required: false }
      }
      return stale
    }
    const lease = requireLease(snapshot, lease_id)
    if (lease.state === 'RELEASING') {
      return finalizeReservedRelease({ snapshot, lease, input })
    }
    if (lease.state !== 'END_REQUESTED') fail('owner_end_attestation_missing_end_request', lease.lease_id)
    if (!ownerEndAttestor || typeof ownerEndAttestor.verify !== 'function') {
      return { status: 'HELD_EXECUTION_AUTHORITY', reason: 'OWNER_END_ATTESTATION_EVIDENCE_GAP', reconcile_required: true }
    }
    const timestamp = nowFrom(clock)
    let verified
    try {
      verified = await ownerEndAttestor.verify({ attestation, lease: clone(lease), now: timestamp })
    } catch {
      return { status: 'HELD_EXECUTION_AUTHORITY', reason: 'OWNER_END_ATTESTATION_EVIDENCE_GAP', reconcile_required: true }
    }
    if (!isObject(verified) || verified.verdict !== 'TRUSTED' || !isObject(verified.attestation)) {
      return { status: 'HELD_EXECUTION_AUTHORITY', reason: 'OWNER_END_ATTESTATION_UNVERIFIED', reconcile_required: true }
    }
    const trustedAttestation = verified.attestation
    if (digestCanonical(trustedAttestation) !== digestCanonical(attestation)) {
      return { status: 'HELD_EXECUTION_AUTHORITY', reason: 'OWNER_END_ATTESTATION_PAYLOAD_MISMATCH', reconcile_required: true }
    }
    try {
      validateOwnerEndAttestation(trustedAttestation, lease, timestamp, snapshot.record.used_owner_end_attestations)
    } catch (error) {
      if (error instanceof FabricRegistryError) throw error
      return { status: 'HELD_EXECUTION_AUTHORITY', reason: 'OWNER_END_ATTESTATION_EVIDENCE_GAP', reconcile_required: true }
    }
    if (!executionEnvelope || typeof executionEnvelope.revoke !== 'function') {
      return { status: 'HELD_EXECUTION_AUTHORITY', reason: 'ENVELOPE_REVOKE_EVIDENCE_GAP', reconcile_required: true }
    }
    const releaseReservation = stamp({
      schema_version: 'lease-release-reservation/v1',
      generation: lease.generation,
      nonce: trustedAttestation.nonce,
      created_at: timestamp,
      updated_at: timestamp,
      release_id: `release:${trustedAttestation.nonce}`,
      lease_id: lease.lease_id,
      attestation_ref: trustedAttestation.attestation_ref,
      attestation_digest: trustedAttestation.attestation_digest,
      attestor_issuer: trustedAttestation.issuer_id,
      attestor_version: trustedAttestation.issuer_version,
      observed_at: trustedAttestation.observed_at,
      expires_at: trustedAttestation.expires_at,
      revocation_epoch: trustedAttestation.revocation_epoch,
      expected_registry_oid: expected_oid,
      expected_envelope_oid,
      expected_envelope_transition_sequence,
    })
    validateReleaseReservation(releaseReservation)
    const reservingLease = updateLease(lease, {
      nonce: trustedAttestation.nonce,
      updated_at: timestamp,
      state: 'RELEASING',
      release_reservation: releaseReservation,
    })
    const reservingLeases = clone(snapshot.record.leases)
    reservingLeases[lease_id] = reservingLease
    const reservationRecord = nextRegistryRecord({
      current: snapshot.record,
      writerCap,
      nonce: trustedAttestation.nonce,
      timestamp,
      leases: reservingLeases,
      usedOwnerEndAttestations: clone(snapshot.record.used_owner_end_attestations),
    })
    const reservationResult = await store.cas({ ref: LEASE_REF, expected_oid, record: reservationRecord })
    if (reservationResult.status !== 'STORED') return casConflict(reservationResult)

    let envelope
    try {
      envelope = await executionEnvelope.revoke({
        lease_id,
        release_id: releaseReservation.release_id,
        expected_envelope_oid,
        expected_transition_sequence: expected_envelope_transition_sequence,
        revocation_epoch: trustedAttestation.revocation_epoch,
        owner_end_attestation_ref: trustedAttestation.attestation_ref,
        owner_end_nonce: trustedAttestation.nonce,
      })
    } catch {
      return { status: 'HELD_EXECUTION_AUTHORITY', reason: 'ENVELOPE_REVOKE_EVIDENCE_GAP', reconcile_required: true }
    }
    if (!isObject(envelope) || envelope.status === 'CONFLICT') {
      return { status: 'HELD_EXECUTION_AUTHORITY', reason: 'ENVELOPE_CAS_CONFLICT', reconcile_required: true }
    }
    if (!isObject(envelope) || envelope.status !== 'REVOKED') {
      return { status: 'HELD_EXECUTION_AUTHORITY', reason: 'ENVELOPE_REVOKE_EVIDENCE_GAP', reconcile_required: true }
    }
    try {
      exactKeys(envelope, ['status', 'previous_oid', 'oid', 'transition_sequence', 'revocation_epoch', 'in_flight_command'], 'envelope_revoke_result')
      assertOid(envelope.previous_oid, 'envelope_revoke_result.previous_oid', { zero: false })
      assertOid(envelope.oid, 'envelope_revoke_result.oid', { zero: false })
    } catch {
      return { status: 'HELD_EXECUTION_AUTHORITY', reason: 'ENVELOPE_REVOKE_EVIDENCE_GAP', reconcile_required: true }
    }
    if (envelope.previous_oid !== expected_envelope_oid || envelope.oid === expected_envelope_oid ||
        envelope.transition_sequence !== expected_envelope_transition_sequence + 1 ||
        envelope.revocation_epoch !== trustedAttestation.revocation_epoch || envelope.in_flight_command !== false) {
      return { status: 'HELD_EXECUTION_AUTHORITY', reason: 'ENVELOPE_REVOKE_EVIDENCE_GAP', reconcile_required: true }
    }

    const envelopeRevocationProof = stamp({
      schema_version: 'envelope-revocation-proof/v1',
      release_id: releaseReservation.release_id,
      lease_id,
      previous_oid: envelope.previous_oid,
      oid: envelope.oid,
      transition_sequence: envelope.transition_sequence,
      revocation_epoch: envelope.revocation_epoch,
      in_flight_command: false,
      observed_at: timestamp,
    })
    validateEnvelopeRevocationProof(envelopeRevocationProof, releaseReservation)
    const proofLease = updateLease(reservationResult.record.leases[lease_id], {
      nonce: trustedAttestation.nonce,
      updated_at: timestamp,
      envelope_revocation_proof: envelopeRevocationProof,
    })
    const proofLeases = clone(reservationResult.record.leases)
    proofLeases[lease_id] = proofLease
    const proofRecord = nextRegistryRecord({
      current: reservationResult.record,
      writerCap,
      nonce: trustedAttestation.nonce,
      timestamp,
      leases: proofLeases,
      usedOwnerEndAttestations: clone(reservationResult.record.used_owner_end_attestations),
    })
    let proofResult
    try {
      proofResult = await store.cas({ ref: LEASE_REF, expected_oid: reservationResult.oid, record: proofRecord })
    } catch {
      return {
        status: 'HELD_EXECUTION_AUTHORITY',
        reason: 'RELEASE_RECONCILIATION_REQUIRED',
        reconcile_required: true,
        release_id: releaseReservation.release_id,
      }
    }
    if (proofResult.status !== 'STORED') {
      return {
        status: 'HELD_EXECUTION_AUTHORITY',
        reason: 'RELEASE_RECONCILIATION_REQUIRED',
        reconcile_required: true,
        release_id: releaseReservation.release_id,
      }
    }

    const releaseRecord = {
      schema_version: 'lease-release/v1',
      release_id: releaseReservation.release_id,
      plan_id: lease.plan_id,
      generation: lease.generation,
      task_id: lease.task_id,
      lease_id: lease.lease_id,
      lease_kind: lease.lease_kind,
      owner_session: lease.owner_session,
      provider: lease.provider,
      provider_session_id: lease.provider_session_id,
      execution_context_id: lease.execution_context_id,
      final_heartbeat_seq: lease.heartbeat_seq,
      final_head_sha: lease.head_sha,
      scope_digest: lease.scope_digest,
      worktree_path_digest: lease.worktree_path_digest,
      handoff_or_candidate_reference: lease.end_request.handoff_or_candidate_reference,
      release_reason: lease.end_request.reason,
      owner_end_attestation_ref: trustedAttestation.attestation_ref,
      owner_end_attestation_digest: trustedAttestation.attestation_digest,
      attestor_issuer: trustedAttestation.issuer_id,
      attestor_version: trustedAttestation.issuer_version,
      observed_at: trustedAttestation.observed_at,
      expires_at: trustedAttestation.expires_at,
      nonce: trustedAttestation.nonce,
      revocation_epoch: trustedAttestation.revocation_epoch,
      expected_registry_oid: proofResult.oid,
      expected_envelope_oid,
      transition_sequence: expected_envelope_transition_sequence,
      retained_resource_keys: [...lease.resource_keys],
    }
    validateOwnerEndReleaseRecord(releaseRecord)
    const {
      release_reservation: ignoredReservation,
      envelope_revocation_proof: ignoredEnvelopeProof,
      ...reservationFreeLease
    } = proofLease
    const releasedLease = updateLease(reservationFreeLease, {
      nonce: trustedAttestation.nonce,
      updated_at: timestamp,
      state: 'RELEASED',
      release_transition: ['RELEASING', 'RELEASED'],
      release_evidence_ref: trustedAttestation.attestation_ref,
      release_evidence_digest: trustedAttestation.attestation_digest,
      release_reason: lease.end_request.reason,
      retention_state: 'RETAINED_FOR_REVIEW',
      envelope_revocation_oid: envelope.oid,
      release_record: releaseRecord,
    })
    const leases = clone(proofResult.record.leases)
    leases[lease_id] = releasedLease
    const used = clone(reservationResult.record.used_owner_end_attestations)
    used[trustedAttestation.attestation_ref] = {
      nonce: trustedAttestation.nonce,
      lease_id,
      consumed_at: timestamp,
      release_id: releaseRecord.release_id,
      release_record_digest: digestCanonical(releaseRecord),
    }
    const record = nextRegistryRecord({
      current: proofResult.record,
      writerCap,
      nonce: trustedAttestation.nonce,
      timestamp,
      leases,
      usedOwnerEndAttestations: used,
    })
    try {
      const result = await store.cas({ ref: LEASE_REF, expected_oid: proofResult.oid, record })
      if (result.status === 'STORED') return { ...result, status: 'RELEASED', lease: releasedLease }
    } catch {
      // The durable reservation remains occupied and contains the correlation evidence.
    }
    return {
      status: 'HELD_EXECUTION_AUTHORITY',
      reason: 'RELEASE_FINALIZE_CAS_CONFLICT',
      reconcile_required: true,
      release_id: releaseReservation.release_id,
    }
  }

  return Object.freeze({ inspect, admit, heartbeat, reconcileTimeout, endRequest, release })
}

const MANAGED_BRANCH_KEYS = Object.freeze([
  'schema_version', 'branch', 'branch_class', 'owner_authority', 'protection_profile_digest', 'base_ref', 'base_sha',
  'generation', 'scope_digest', 'allowed_merge_targets', 'created_at', 'renewed_at', 'expires_at', 'current_head_sha',
  'registry_oid', 'managed_base_lease_id', 'transition_sequence', 'state', 'canonical_digest',
])

const MANAGED_REGISTRY_KEYS = Object.freeze(['schema_version', 'branch', 'used_nonces'])
const MANAGED_RENEW_COMMAND_KEYS = Object.freeze([
  'schema_version', 'action', 'operation_id', 'owner_authority', 'managed_base_lease_id', 'current_generation',
  'expected_registry_oid', 'expected_base_sha', 'expected_head_sha', 'expected_protection_profile_digest',
  'transition_sequence', 'nonce', 'requested_expires_at', 'authorized_expires_at',
])

const managedBranchClass = (branch) => {
  if (branch === 'develop') return 'develop'
  if (typeof branch !== 'string') return null
  if (/^release\/[^/]+$/u.test(branch)) return 'release'
  if (/^hotfix\/[^/]+$/u.test(branch)) return 'hotfix'
  return null
}

const managedBranchDigest = (record) => {
  const digestInput = { ...record }
  delete digestInput.registry_oid
  delete digestInput.canonical_digest
  return digestCanonical(digestInput)
}

const stampManagedBranch = (record) => ({
  ...record,
  canonical_digest: managedBranchDigest(record),
})

const validateManagedBranchRecord = (record, context = 'managed_branch') => {
  assertNoSensitiveMaterial(record, context)
  exactKeys(record, MANAGED_BRANCH_KEYS, context)
  if (record.schema_version !== 'managed-branch/v1') fail('registry_record_invalid', `${context}_schema`)
  assertIdentifier(record.branch, `${context}.branch`)
  if (managedBranchClass(record.branch) !== record.branch_class) fail('registry_record_invalid', `${context}_branch_class`)
  assertOpaque(record.owner_authority, `${context}.owner_authority`)
  assertDigest(record.protection_profile_digest, `${context}.protection_profile_digest`)
  assertIdentifier(record.base_ref, `${context}.base_ref`)
  assertOid(record.base_sha, `${context}.base_sha`, { zero: false })
  if (!Number.isSafeInteger(record.generation) || record.generation < 1) fail('registry_record_invalid', `${context}.generation`)
  assertDigest(record.scope_digest, `${context}.scope_digest`)
  if (!Array.isArray(record.allowed_merge_targets) || record.allowed_merge_targets.length === 0 || record.allowed_merge_targets.length > 8) {
    fail('registry_record_invalid', `${context}.allowed_merge_targets`)
  }
  record.allowed_merge_targets.forEach((target, index) => assertIdentifier(target, `${context}.allowed_merge_targets[${index}]`))
  if (new Set(record.allowed_merge_targets).size !== record.allowed_merge_targets.length) {
    fail('registry_record_invalid', `${context}.allowed_merge_targets_duplicate`)
  }
  const createdAt = parseTimestamp(record.created_at, `${context}.created_at`)
  const renewedAt = parseTimestamp(record.renewed_at, `${context}.renewed_at`)
  const expiresAt = parseTimestamp(record.expires_at, `${context}.expires_at`)
  if (createdAt > renewedAt || renewedAt >= expiresAt) fail('registry_record_invalid', `${context}.timestamps`)
  assertOid(record.current_head_sha, `${context}.current_head_sha`, { zero: false })
  assertOid(record.registry_oid, `${context}.registry_oid`, { zero: false })
  assertOpaque(record.managed_base_lease_id, `${context}.managed_base_lease_id`)
  if (!Number.isSafeInteger(record.transition_sequence) || record.transition_sequence < 0) {
    fail('registry_record_invalid', `${context}.transition_sequence`)
  }
  if (!['ACTIVE', 'FROZEN', 'REBASE_REQUIRED'].includes(record.state)) fail('registry_record_invalid', `${context}.state`)
  assertDigest(record.canonical_digest, `${context}.canonical_digest`)
  if (managedBranchDigest(record) !== record.canonical_digest) fail('registry_record_invalid', `${context}.canonical_digest_mismatch`)
  return record
}

const validateManagedRegistryState = (record) => {
  assertNoSensitiveMaterial(record, 'managed_branch_registry')
  exactKeys(record, MANAGED_REGISTRY_KEYS, 'managed_branch_registry')
  if (record.schema_version !== 'managed-branch-registry/v1' || !isObject(record.used_nonces)) {
    fail('registry_record_invalid', 'managed_branch_registry_shape')
  }
  validateManagedBranchRecord(record.branch, 'managed_branch_registry.branch')
  for (const [nonce, receipt] of Object.entries(record.used_nonces)) {
    assertNonce(nonce, 'managed_branch_registry.used_nonce')
    exactKeys(receipt, ['operation_id', 'consumed_at'], 'managed_branch_registry.used_nonce_receipt')
    assertOpaque(receipt.operation_id, 'managed_branch_registry.used_nonce_receipt.operation_id')
    parseTimestamp(receipt.consumed_at, 'managed_branch_registry.used_nonce_receipt.consumed_at')
  }
  return record
}

const managedHeld = (reason, extra = {}) => Object.freeze({
  status: 'HELD_MANAGED_BRANCH',
  reason,
  retention_state: 'RETAINED_FOR_REVIEW',
  ...extra,
})

const managedCommandFailure = (error) => {
  if (error instanceof FabricRegistryError && error.code === 'secret_material_detected') return 'SECRET_MATERIAL_DETECTED'
  return 'COMMAND_SCHEMA_INVALID'
}

const validateManagedRenewCommand = (input) => {
  try {
    assertNoSensitiveMaterial(input, 'managed_branch_renew')
    exactKeys(input, MANAGED_RENEW_COMMAND_KEYS, 'managed_branch_renew')
  } catch (error) {
    return { reason: managedCommandFailure(error) }
  }
  if (input.schema_version !== 'managed-branch-command/v1') return { reason: 'COMMAND_SCHEMA_INVALID' }
  if (input.action !== 'renew') {
    return { reason: ['push', 'direct_push', 'deploy', 'direct_deploy'].includes(input.action) ? 'DIRECT_PUSH_FORBIDDEN' : 'MANAGED_OPERATION_INVALID' }
  }
  try {
    assertOpaque(input.operation_id, 'managed_branch_renew.operation_id')
    assertOpaque(input.owner_authority, 'managed_branch_renew.owner_authority')
    assertOpaque(input.managed_base_lease_id, 'managed_branch_renew.managed_base_lease_id')
    if (!Number.isSafeInteger(input.current_generation) || input.current_generation < 1) fail('invalid_value', 'managed_branch_renew.current_generation')
    assertOid(input.expected_registry_oid, 'managed_branch_renew.expected_registry_oid', { zero: false })
    assertOid(input.expected_base_sha, 'managed_branch_renew.expected_base_sha', { zero: false })
    assertOid(input.expected_head_sha, 'managed_branch_renew.expected_head_sha', { zero: false })
    assertDigest(input.expected_protection_profile_digest, 'managed_branch_renew.expected_protection_profile_digest')
    if (!Number.isSafeInteger(input.transition_sequence) || input.transition_sequence < 0) {
      fail('invalid_value', 'managed_branch_renew.transition_sequence')
    }
    assertNonce(input.nonce, 'managed_branch_renew.nonce')
    parseTimestamp(input.requested_expires_at, 'managed_branch_renew.requested_expires_at')
    parseTimestamp(input.authorized_expires_at, 'managed_branch_renew.authorized_expires_at')
  } catch (error) {
    if (error instanceof FabricRegistryError && error.code === 'secret_material_detected') return { reason: 'SECRET_MATERIAL_DETECTED' }
    if (typeof input.nonce !== 'string' || !NONCE.test(input.nonce)) return { reason: 'NONCE_INVALID' }
    return { reason: 'COMMAND_SCHEMA_INVALID' }
  }
  return { command: input }
}

const hydrateManagedBranch = (branch, registryOid) => stampManagedBranch({ ...branch, registry_oid: registryOid })

const readManagedSnapshot = async (store) => {
  try {
    const snapshot = await store.read()
    exactKeys(snapshot, ['oid', 'record'], 'managed_branch_store_snapshot')
    assertOid(snapshot.oid, 'managed_branch_store_snapshot.oid', { zero: false })
    if (snapshot.record === null) return managedHeld('REGISTRY_UNKNOWN')
    validateManagedRegistryState(snapshot.record)
    return {
      status: 'READY',
      registry_oid: snapshot.oid,
      record: hydrateManagedBranch(snapshot.record.branch, snapshot.oid),
      state: snapshot.record,
    }
  } catch {
    return managedHeld('REGISTRY_UNKNOWN')
  }
}

const renewFailure = (snapshot, command, clock) => {
  const record = snapshot.record
  const now = nowFrom(clock)
  const nowMilliseconds = parseTimestamp(now, 'managed_branch_renew.now')
  if (record.state !== 'ACTIVE') return managedHeld('MANAGED_BRANCH_NOT_ACTIVE', { state: record.state })
  if (parseTimestamp(record.expires_at, 'managed_branch_renew.expires_at') <= nowMilliseconds) {
    return managedHeld('MANAGED_BRANCH_EXPIRED', { state: 'FROZEN' })
  }
  if (command.owner_authority !== record.owner_authority) return managedHeld('OWNER_MISMATCH')
  if (command.managed_base_lease_id !== record.managed_base_lease_id) return managedHeld('MANAGED_BASE_LEASE_REQUIRED')
  if (command.expected_registry_oid !== snapshot.registry_oid) return managedHeld('REGISTRY_OID_MISMATCH', { registry_oid: snapshot.registry_oid })
  if (command.current_generation !== record.generation) return managedHeld('GENERATION_MISMATCH')
  if (command.expected_base_sha !== record.base_sha) return managedHeld('EXPECTED_BASE_MISMATCH')
  if (command.expected_head_sha !== record.current_head_sha) return managedHeld('EXPECTED_HEAD_MISMATCH')
  if (command.expected_protection_profile_digest !== record.protection_profile_digest) return managedHeld('PROTECTION_PROFILE_DRIFT')
  if (command.transition_sequence !== record.transition_sequence) return managedHeld('TRANSITION_SEQUENCE_MISMATCH')
  if (Object.hasOwn(snapshot.state.used_nonces, command.nonce) ||
      Object.values(snapshot.state.used_nonces).some((receipt) => receipt.operation_id === command.operation_id)) {
    return managedHeld('NONCE_REPLAY')
  }
  const requestedExpiresAt = parseTimestamp(command.requested_expires_at, 'managed_branch_renew.requested_expires_at')
  const authorizedExpiresAt = parseTimestamp(command.authorized_expires_at, 'managed_branch_renew.authorized_expires_at')
  if (requestedExpiresAt <= parseTimestamp(record.expires_at, 'managed_branch_renew.current_expires_at')) return managedHeld('EXPIRY_NOT_EXTENDED')
  if (requestedExpiresAt > authorizedExpiresAt || requestedExpiresAt <= nowMilliseconds) return managedHeld('EXPIRY_POLICY_BOUND')
  return null
}

export function parseManagedBranchRecord(raw) {
  const parsed = cloneIJson(raw)
  validateManagedBranchRecord(parsed)
  return freezeIJson(parsed)
}

export function parseManagedBranchRegistry(raw) {
  const parsed = cloneIJson(raw)
  validateManagedRegistryState(parsed)
  return freezeIJson(parsed)
}

export function createManagedBranchRegistry({ store, clock }) {
  if (!store || typeof store.read !== 'function' || typeof store.cas !== 'function') fail('invalid_port', 'managed_branch_store_required')

  const inspect = async () => {
    const snapshot = await readManagedSnapshot(store)
    if (snapshot.status !== 'READY') return snapshot
    return Object.freeze({ status: 'READY', registry_oid: snapshot.registry_oid, record: snapshot.record })
  }

  const renew = async (input) => {
    const commandResult = validateManagedRenewCommand(input)
    if (commandResult.reason) return managedHeld(commandResult.reason)
    const snapshot = await readManagedSnapshot(store)
    if (snapshot.status !== 'READY') return snapshot
    const failure = renewFailure(snapshot, commandResult.command, clock)
    if (failure) return failure
    const timestamp = nowFrom(clock)
    const branch = hydrateManagedBranch({
      ...snapshot.record,
      expires_at: commandResult.command.requested_expires_at,
      renewed_at: timestamp,
      transition_sequence: snapshot.record.transition_sequence + 1,
    }, snapshot.registry_oid)
    const usedNonces = clone(snapshot.state.used_nonces)
    usedNonces[commandResult.command.nonce] = {
      operation_id: commandResult.command.operation_id,
      consumed_at: timestamp,
    }
    const next = {
      schema_version: 'managed-branch-registry/v1',
      branch,
      used_nonces: usedNonces,
    }
    try {
      validateManagedRegistryState(next)
      const result = await store.cas({ expected_oid: snapshot.registry_oid, record: next })
      if (isObject(result) && result.status === 'STORED') {
        assertOid(result.oid, 'managed_branch_renew.result_oid', { zero: false })
        const record = hydrateManagedBranch(branch, result.oid)
        return Object.freeze({
          status: 'RENEWED',
          registry_oid: result.oid,
          previous_registry_oid: snapshot.registry_oid,
          record: freezeIJson(record),
        })
      }
    } catch {
      return managedHeld('REGISTRY_UNKNOWN')
    }
    const current = await readManagedSnapshot(store)
    return managedHeld('REGISTRY_CAS_CONFLICT', current.status === 'READY' ? { registry_oid: current.registry_oid } : {})
  }

  return Object.freeze({ inspect, renew })
}

const QUEUE_REF = LEASE_REF
const QUEUE_MAPPING_LIMIT = 1024
const QUEUE_OPERATION_LIMIT = 4096
const QUEUE_HELD = (reason) => Object.freeze({ status: 'HELD_QUEUE_CAPABILITY', shadow: 'SHADOW_ONLY', reason })
const QUEUE_SOURCE_KEYS = Object.freeze(['repository', 'workflow', 'resource_key'])
const QUEUE_OBSERVATION_KEYS = Object.freeze([
  'snapshot_id', 'snapshot_generation', 'observed_at', 'expires_at', 'queue_position', 'member_vector_digest', 'state',
])
const QUEUE_RESERVE_KEYS = Object.freeze([
  'registry_ref', 'expected_oid', 'operation_id', 'nonce', 'candidate_id', 'run_id', 'lease_id',
  'resource_key', 'workflow', 'candidate_head_sha', 'lease_generation', 'source', 'source_digest',
  'observation', 'observation_digest',
])
const QUEUE_RESERVE_OPTIONAL = new Set(['queue_mapping_count', 'operation_count'])
const QUEUE_CANCEL_KEYS = Object.freeze([...QUEUE_RESERVE_KEYS, 'pending_before', 'pending_limit', 'incoming_position'])
const QUEUE_MAPPING_KEYS = Object.freeze([
  'candidate_id', 'run_id', 'lease_id', 'resource_key', 'workflow', 'candidate_head_sha', 'lease_generation',
  'source_digest', 'observation_digest', 'state',
])

const validateQueueRegistryRecord = (record) => {
  exactKeys(record, [
    'schema_version', 'generation', 'nonce', 'created_at', 'updated_at', 'queue_mappings', 'used_queue_operations', 'canonical_digest',
  ], 'queue_registry')
  if (record.schema_version !== 'queue-registry/v1') fail('registry_record_invalid', 'queue_registry_schema')
  assertStamped(record, 'queue_registry')
  if (!isObject(record.queue_mappings) || !isObject(record.used_queue_operations)) fail('registry_record_invalid', 'queue_registry_maps')
  if (Object.keys(record.queue_mappings).length > QUEUE_MAPPING_LIMIT) fail('registry_record_invalid', 'queue_mapping_limit')
  if (Object.keys(record.used_queue_operations).length > QUEUE_OPERATION_LIMIT) fail('registry_record_invalid', 'queue_operation_limit')
  for (const [key, mapping] of Object.entries(record.queue_mappings)) {
    assertTask2OpaqueId(key, 'queue_mapping_key')
    exactKeys(mapping, QUEUE_MAPPING_KEYS, 'queue_mapping')
    if (!['RESERVED', 'CANCELLED'].includes(mapping.state)) fail('registry_record_invalid', 'queue_mapping_state')
  }
  return record
}

const emptyQueueRecord = (timestamp, nonce) => stamp({
  schema_version: 'queue-registry/v1',
  generation: 1,
  nonce,
  created_at: timestamp,
  updated_at: timestamp,
  queue_mappings: {},
  used_queue_operations: {},
})

const readQueueSnapshot = async (store) => {
  try {
    const snapshot = await store.read(QUEUE_REF)
    if (!isObject(snapshot) || !OID.test(snapshot.oid)) return QUEUE_HELD('REGISTRY_UNKNOWN')
    if (snapshot.record === null) return { oid: snapshot.oid, record: null, kind: 'empty' }
    if (isObject(snapshot.record) && snapshot.record.schema_version === 'queue-registry/v1') {
      try {
        validateQueueRegistryRecord(snapshot.record)
        return { oid: snapshot.oid, record: snapshot.record, kind: 'queue' }
      } catch {
        return QUEUE_HELD('REGISTRY_UNKNOWN')
      }
    }
    if (isObject(snapshot.record) && snapshot.record.schema_version === 'session-lease-registry/v1') {
      try {
        validateLeaseRegistryRecord(snapshot.record, WRITER_CAP_V1)
        return { oid: snapshot.oid, record: snapshot.record, kind: 'lease' }
      } catch {
        return QUEUE_HELD('REGISTRY_UNKNOWN')
      }
    }
    return QUEUE_HELD('REGISTRY_UNKNOWN')
  } catch {
    return QUEUE_HELD('REGISTRY_UNKNOWN')
  }
}

const queueView = (oid, record) => Object.freeze({
  status: 'SHADOW_QUEUE_MAPPING_RESTORED',
  registry_oid: oid,
  record: Object.freeze({
    queue_mappings: freezeIJson(record?.queue_mappings ? clone(record.queue_mappings) : {}),
    used_queue_operations: freezeIJson(record?.used_queue_operations ? clone(record.used_queue_operations) : {}),
  }),
})

const sourceValid = (value) => {
  try {
    exactKeys(value, QUEUE_SOURCE_KEYS, 'queue_source')
    assertTask2OpaqueId(value.workflow, 'queue_source.workflow')
    assertTask2OpaqueId(value.resource_key, 'queue_source.resource_key')
    assertNoSensitiveMaterial(value, 'queue_source')
    return typeof value.repository === 'string' && value.repository.length >= 3 && value.repository.length <= 256
  } catch {
    return false
  }
}

const observationValid = (value) => {
  try {
    exactKeys(value, QUEUE_OBSERVATION_KEYS, 'queue_observation')
    assertTask2OpaqueId(value.snapshot_id, 'queue_observation.snapshot_id')
    if (!Number.isSafeInteger(value.snapshot_generation) || value.snapshot_generation < 1) return false
    parseTimestamp(value.observed_at, 'queue_observation.observed_at')
    parseTimestamp(value.expires_at, 'queue_observation.expires_at')
    if (Date.parse(value.expires_at) <= Date.parse(value.observed_at)) return false
    if (!Number.isSafeInteger(value.queue_position) || value.queue_position < 1) return false
    assertDigest(value.member_vector_digest, 'queue_observation.member_vector_digest')
    return value.state === 'OBSERVED'
  } catch {
    return false
  }
}

const parseQueueRequest = (input, cancelling) => {
  try {
    assertNoSensitiveMaterial(input, 'queue_request')
    if (!isObject(input)) return QUEUE_HELD('REQUEST_INVALID')
    const allowed = new Set(cancelling ? QUEUE_CANCEL_KEYS : QUEUE_RESERVE_KEYS)
    for (const key of Object.keys(input)) {
      if (!allowed.has(key) && !QUEUE_RESERVE_OPTIONAL.has(key)) return QUEUE_HELD('REQUEST_INVALID')
    }
    for (const key of cancelling ? QUEUE_CANCEL_KEYS : QUEUE_RESERVE_KEYS) {
      if (!Object.hasOwn(input, key)) return QUEUE_HELD('REQUEST_INVALID')
    }
    if (input.registry_ref !== QUEUE_REF) return QUEUE_HELD('REQUEST_INVALID')
    assertOid(input.expected_oid, 'queue_expected_oid')
    assertTask2OpaqueId(input.operation_id, 'queue_operation_id')
    assertNonce(input.nonce, 'queue_nonce')
    for (const key of ['candidate_id', 'run_id', 'lease_id', 'resource_key', 'workflow']) {
      assertTask2OpaqueId(input[key], `queue_${key}`)
    }
    assertOid(input.candidate_head_sha, 'queue_candidate_head_sha', { zero: false })
    if (!Number.isSafeInteger(input.lease_generation) || input.lease_generation < 1) return QUEUE_HELD('REQUEST_INVALID')
    if (!sourceValid(input.source) || !observationValid(input.observation)) return QUEUE_HELD('REQUEST_INVALID')
    if (input.source.workflow !== input.workflow || input.source.resource_key !== input.resource_key) return QUEUE_HELD('SOURCE_DRIFT')
    const suffix = (value) => String(value).slice(String(value).indexOf(':') + 1)
    if (new Set([suffix(input.candidate_id), suffix(input.run_id), suffix(input.lease_id)]).size !== 1) {
      return QUEUE_HELD('TUPLE_DRIFT')
    }
    if (digestCanonical(input.source) !== input.source_digest) return QUEUE_HELD('SOURCE_DRIFT')
    if (digestCanonical(input.observation) !== input.observation_digest) return QUEUE_HELD('SNAPSHOT_DRIFT')
    if (cancelling) {
      if (![input.pending_before, input.pending_limit, input.incoming_position].every((value) => Number.isSafeInteger(value) && value >= 1)) {
        return QUEUE_HELD('REQUEST_INVALID')
      }
    }
    return { status: 'READY', request: input }
  } catch {
    return QUEUE_HELD('REQUEST_INVALID')
  }
}

const mappingFromRequest = (request, state) => Object.freeze({
  candidate_id: request.candidate_id,
  run_id: request.run_id,
  lease_id: request.lease_id,
  resource_key: request.resource_key,
  workflow: request.workflow,
  candidate_head_sha: request.candidate_head_sha,
  lease_generation: request.lease_generation,
  source_digest: request.source_digest,
  observation_digest: request.observation_digest,
  state,
})

const mappingKey = (request) => request.candidate_id

const queueFreshnessHeld = (request, clock) => {
  try {
    const now = nowFrom(clock)
    if (Date.parse(now) >= Date.parse(request.observation.expires_at)) return QUEUE_HELD('SNAPSHOT_STALE')
    return null
  } catch {
    return QUEUE_HELD('REQUEST_INVALID')
  }
}

export function createQueueMappingRegistry({ store, clock }) {
  if (!store || typeof store.read !== 'function' || typeof store.cas !== 'function') {
    return Object.freeze({
      restore: async () => QUEUE_HELD('REGISTRY_UNKNOWN'),
      reserve: async () => QUEUE_HELD('REGISTRY_UNKNOWN'),
      reconcileCancelled: async () => QUEUE_HELD('REGISTRY_UNKNOWN'),
    })
  }

  const restore = async (input) => {
    if (!isObject(input) || input.registry_ref !== QUEUE_REF) return QUEUE_HELD('REQUEST_INVALID')
    const snapshot = await readQueueSnapshot(store)
    if (snapshot.status === 'HELD_QUEUE_CAPABILITY') return snapshot
    if (snapshot.kind === 'empty' || snapshot.record === null) return QUEUE_HELD('REGISTRY_UNKNOWN')
    if (snapshot.kind === 'lease') return queueView(snapshot.oid, null)
    return queueView(snapshot.oid, snapshot.record)
  }

  const writeQueue = async (expectedOid, current, request, transform) => {
    const timestamp = nowFrom(clock)
    const nextMaps = transform(current)
    if (nextMaps.status === 'HELD_QUEUE_CAPABILITY') return nextMaps
    const record = stamp({
      schema_version: 'queue-registry/v1',
      generation: (current?.generation ?? 0) + 1,
      nonce: request.nonce,
      created_at: current?.created_at ?? timestamp,
      updated_at: timestamp,
      queue_mappings: nextMaps.queue_mappings,
      used_queue_operations: nextMaps.used_queue_operations,
    })
    const result = await store.cas({ ref: QUEUE_REF, expected_oid: expectedOid, record })
    if (isObject(result) && result.status === 'STORED') {
      return Object.freeze({
        status: nextMaps.resultStatus,
        shadow: 'SHADOW_ONLY',
        registry_oid: result.oid,
        mapping: nextMaps.mapping,
      })
    }
    return QUEUE_HELD('REGISTRY_CAS_CONFLICT')
  }

  const currentQueueState = (snapshot) => {
    if (snapshot.kind === 'queue') return clone(snapshot.record)
    return {
      generation: 0,
      created_at: undefined,
      queue_mappings: {},
      used_queue_operations: {},
    }
  }

  const reserve = async (input) => {
    const parsed = parseQueueRequest(input, false)
    if (parsed.status !== 'READY') return parsed
    const request = parsed.request
    const freshness = queueFreshnessHeld(request, clock)
    if (freshness) return freshness
    if (Number.isSafeInteger(request.queue_mapping_count) && request.queue_mapping_count > QUEUE_MAPPING_LIMIT) {
      return QUEUE_HELD('LEDGER_CAPACITY_EXCEEDED')
    }
    if (Number.isSafeInteger(request.operation_count) && request.operation_count > QUEUE_OPERATION_LIMIT) {
      return QUEUE_HELD('LEDGER_CAPACITY_EXCEEDED')
    }
    const snapshot = await readQueueSnapshot(store)
    if (snapshot.status === 'HELD_QUEUE_CAPABILITY') return snapshot
    if (snapshot.kind === 'empty' || snapshot.record === null) return QUEUE_HELD('REGISTRY_UNKNOWN')
    if (snapshot.oid !== request.expected_oid) return QUEUE_HELD('REGISTRY_CAS_CONFLICT')
    if (snapshot.kind === 'lease') {
      const leases = Object.values(snapshot.record.leases || {})
      if (leases.length > 0 && !leases.some((lease) => lease.head_sha === request.candidate_head_sha && lease.generation === request.lease_generation)) {
        return QUEUE_HELD('TUPLE_DRIFT')
      }
    }
    const current = currentQueueState(snapshot)
    if (Object.keys(current.used_queue_operations).some((key) => current.used_queue_operations[key]?.nonce === request.nonce)) {
      return QUEUE_HELD('NONCE_REPLAY')
    }
    if (Object.hasOwn(current.used_queue_operations, request.operation_id)) return QUEUE_HELD('OPERATION_REPLAY')
    if (Object.keys(current.queue_mappings).length >= QUEUE_MAPPING_LIMIT) return QUEUE_HELD('LEDGER_CAPACITY_EXCEEDED')
    if (Object.keys(current.used_queue_operations).length >= QUEUE_OPERATION_LIMIT) return QUEUE_HELD('LEDGER_CAPACITY_EXCEEDED')
    const mapping = mappingFromRequest(request, 'RESERVED')
    return writeQueue(request.expected_oid, current, request, (state) => {
      const queue_mappings = clone(state.queue_mappings)
      const used_queue_operations = clone(state.used_queue_operations)
      queue_mappings[mappingKey(request)] = mapping
      used_queue_operations[request.operation_id] = {
        nonce: request.nonce,
        consumed_at: nowFrom(clock),
        kind: 'reserve',
      }
      return {
        queue_mappings,
        used_queue_operations,
        mapping,
        resultStatus: 'SHADOW_QUEUE_MAPPING_STORED',
      }
    })
  }

  const reconcileCancelled = async (input) => {
    const parsed = parseQueueRequest(input, true)
    if (parsed.status !== 'READY') return parsed
    const request = parsed.request
    const freshness = queueFreshnessHeld(request, clock)
    if (freshness) return freshness
    if (request.pending_before !== 100 || request.pending_limit !== 100 || request.incoming_position !== 101) {
      return QUEUE_HELD('CANCELLATION_WINDOW_INVALID')
    }
    const snapshot = await readQueueSnapshot(store)
    if (snapshot.status === 'HELD_QUEUE_CAPABILITY') return snapshot
    if (snapshot.kind !== 'queue') return QUEUE_HELD('REGISTRY_UNKNOWN')
    if (snapshot.oid !== request.expected_oid) return QUEUE_HELD('REGISTRY_CAS_CONFLICT')
    const current = currentQueueState(snapshot)
    if (Object.keys(current.used_queue_operations).some((key) => current.used_queue_operations[key]?.nonce === request.nonce)) {
      return QUEUE_HELD('NONCE_REPLAY')
    }
    if (Object.hasOwn(current.used_queue_operations, request.operation_id)) return QUEUE_HELD('OPERATION_REPLAY')
    const existing = current.queue_mappings[mappingKey(request)]
    if (!existing || existing.state !== 'RESERVED') return QUEUE_HELD('MAPPING_NOT_RESERVED')
    const expected = mappingFromRequest(request, 'RESERVED')
    for (const key of QUEUE_MAPPING_KEYS) {
      if (key === 'state') continue
      if (existing[key] !== expected[key]) return QUEUE_HELD('TUPLE_DRIFT')
    }
    const mapping = mappingFromRequest(request, 'CANCELLED')
    return writeQueue(request.expected_oid, current, request, (state) => {
      const queue_mappings = clone(state.queue_mappings)
      const used_queue_operations = clone(state.used_queue_operations)
      queue_mappings[mappingKey(request)] = mapping
      used_queue_operations[request.operation_id] = {
        nonce: request.nonce,
        consumed_at: nowFrom(clock),
        kind: 'cancel',
      }
      return {
        queue_mappings,
        used_queue_operations,
        mapping,
        resultStatus: 'SHADOW_QUEUE_CANCELLATION_RECORDED',
      }
    })
  }

  return Object.freeze({ restore, reserve, reconcileCancelled })
}
