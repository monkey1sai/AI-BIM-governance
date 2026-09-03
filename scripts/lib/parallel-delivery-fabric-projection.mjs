import {
  digestCanonical,
  isCanonicalNonce,
  isCanonicalOpaqueId,
  isCanonicalOpaqueReference,
  isCanonicalUtcMillisecondTimestamp,
} from './parallel-delivery-fabric-contract.mjs'
import { parseSessionLease } from './parallel-delivery-fabric-registry.mjs'

const BOARD_STATUS_ARGV = Object.freeze(['status', '--json', '--no-prune'])
const BOARD_COMMAND = BOARD_STATUS_ARGV.join(' ')
const CHANNEL = 'parallel-delivery-fabric-projection/v1'
const OID = /^[0-9a-f]{40}$/u
const SHA256 = /^[0-9a-f]{64}$/u
const RAW_WINDOWS_SID = /(?:^|[/:])S-\d+(?:-\d+){2,}(?=$|[/:])/iu
const TERMINAL_PROCESS_ID = /(?:^|[/:])\d+$/u
const SECRET_VALUE = /(?:bearer|token|cookie|authorization|private[-_]?key|gh[pousr]_|github_pat_|eyJ[A-Za-z0-9_-]{10,})/iu
const ABSOLUTE_PATH = /(?:^|:)[A-Za-z]:[\\/]|(?:^|:)\/(?:home|users|tmp)(?:\/|$)/iu
const RAW_ENVIRONMENT = /(?:^|[/:])(?:(?:env|environment):[A-Za-z_][A-Za-z0-9_]*|\$env:[A-Za-z_][A-Za-z0-9_]*|%[A-Za-z_][A-Za-z0-9_]*%)(?=$|[/:])/iu
// Matches the CLI/snapshot node budget so a contract-maximum plan is projectable.
const MAX_RECURSIVE_INPUT_NODES = 4096
const INVENTORY_SHADOW_PIN = Object.freeze({
  issuer_id: 'issuer:host-inventory',
  issuer_version: 'host-inventory-authority/v1',
  source_digest: 'a'.repeat(64),
  revocation_epoch: 7,
})
const RESUME_SHADOW_PIN = Object.freeze({
  issuer_id: 'issuer:resume-authority',
  issuer_version: 'resume-authority/v1',
  source_digest: 'b'.repeat(64),
  revocation_epoch: 7,
})

const isPlainObject = (value) => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  try {
    const prototype = Object.getPrototypeOf(value)
    return prototype === Object.prototype || prototype === null
  } catch {
    return false
  }
}
const hasExactKeys = (value, keys) => isPlainObject(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key))
const isOpaqueReference = isCanonicalOpaqueReference
const isOpaqueId = isCanonicalOpaqueId
const isSha256 = (value) => typeof value === 'string' && SHA256.test(value)
const isOid = (value) => typeof value === 'string' && OID.test(value)
const isNonzeroOid = (value) => isOid(value) && value !== '0'.repeat(40)
const normalizedKey = (rawKey) => String(rawKey).replace(/([a-z0-9])([A-Z])/gu, '$1_$2').toLowerCase().replaceAll('-', '_')
const hasSensitiveKey = (rawKey) => {
  const key = normalizedKey(rawKey)
  return key.includes('token') || key.includes('cookie') || key.includes('authorization') || key.includes('private_key') ||
    key === 'sid' || key.endsWith('_sid') || key === 'pid' || key.endsWith('_pid') || key === 'process_id' ||
    key.includes('transcript') || key === 'env' || key.startsWith('env_') || key.endsWith('_env') ||
    key.includes('raw_env') || key.includes('environment_values') || key.includes('absolute_path') ||
    (key.endsWith('_path') && !['old_path', 'new_path', 'public_entrypoint'].includes(key))
}
const inspectValue = (value, seen = new WeakSet(), state = { nodes: 0 }) => {
  if (typeof value === 'string' && (isOid(value) || isSha256(value) || isCanonicalUtcMillisecondTimestamp(value))) return 'safe'
  if (typeof value === 'string') return RAW_WINDOWS_SID.test(value) || TERMINAL_PROCESS_ID.test(value) ||
    SECRET_VALUE.test(value) || ABSOLUTE_PATH.test(value) || RAW_ENVIRONMENT.test(value) ? 'private' : 'safe'
  if (value === null || typeof value !== 'object') return 'safe'
  if (!Array.isArray(value) && !isPlainObject(value)) return 'invalid'
  if (seen.has(value) || ++state.nodes > MAX_RECURSIVE_INPUT_NODES) return 'invalid'
  seen.add(value)
  let entries
  try {
    entries = Array.isArray(value) ? value.map((nested, index) => [String(index), nested]) : Object.entries(value)
  } catch {
    return 'invalid'
  }
  for (const [key, nested] of entries) {
    if (!Array.isArray(value) && hasSensitiveKey(key)) return 'private'
    const nestedResult = inspectValue(nested, seen, state)
    if (nestedResult !== 'safe') return nestedResult
  }
  return 'safe'
}
const unsafeValue = (value) => inspectValue(value) !== 'safe'

const deepFreeze = (value, seen = new WeakSet()) => {
  if (value === null || typeof value !== 'object' || seen.has(value)) return value
  seen.add(value)
  for (const nested of Object.values(value)) deepFreeze(nested, seen)
  return Object.freeze(value)
}
const ownedSnapshot = (value) => {
  try {
    const snapshot = structuredClone(value)
    return inspectValue(snapshot) === 'safe' ? deepFreeze(snapshot) : null
  } catch {
    return null
  }
}
const clonePort = (value) => {
  if (!isPlainObject(value)) return value
  try {
    return Object.freeze({ ...value })
  } catch {
    return null
  }
}
const snapshotInput = (input, keys, { ports = [], identities = [] } = {}) => {
  try {
    const data = {}
    const portSet = new Set(ports)
    for (const key of keys) if (!portSet.has(key) && Object.hasOwn(input, key)) data[key] = input[key]
    const snapshot = ownedSnapshot(data)
    if (snapshot === null) return null
    const combined = { ...snapshot }
    for (const key of ports) combined[key] = identities.includes(key) ? input[key] : clonePort(input[key])
    return Object.freeze(combined)
  } catch {
    return null
  }
}
const callbackArguments = (value) => ownedSnapshot(value)

const REGISTRY_KEYS = Object.freeze([
  'schema_version', 'oid', 'lease_id', 'target_ref', 'target_type', 'target_digest', 'runtime_correlation',
])
const CLOCK_KEYS = Object.freeze(['now', 'heartbeat_timeout_ms', 'projection_timeout_ms'])
const SOURCE_KEYS = Object.freeze([
  'schema_version', 'generation', 'expected_projection_oid', 'plan_ref', 'lease_ref', 'provider_envelope_ref', 'github_state_ref',
])
const registryIsValid = (value) => hasExactKeys(value, REGISTRY_KEYS) &&
  value.schema_version === 'lease-registry-snapshot/v1' && isOid(value.oid) && isOpaqueId(value.lease_id) &&
  isOpaqueReference(value.target_ref) && value.target_type === 'worktree' && isSha256(value.target_digest) &&
  isOpaqueReference(value.runtime_correlation)

const clockIsValid = (value) => hasExactKeys(value, CLOCK_KEYS) && isCanonicalUtcMillisecondTimestamp(value.now) &&
  Number.isSafeInteger(value.heartbeat_timeout_ms) && value.heartbeat_timeout_ms >= 0 &&
  Number.isSafeInteger(value.projection_timeout_ms) && value.projection_timeout_ms >= 0

const sourceIsValid = (value, currentLease) => hasExactKeys(value, SOURCE_KEYS) &&
  value.schema_version === 'fabric-projection-source/v1' && Number.isSafeInteger(value.generation) && value.generation >= 1 &&
  isOid(value.expected_projection_oid) && typeof value.plan_ref === 'string' && isOpaqueReference(value.lease_ref) &&
  isOpaqueReference(value.provider_envelope_ref) && isOpaqueReference(value.github_state_ref) &&
  currentLease !== null && value.generation === currentLease.generation && value.plan_ref === currentLease.plan_id

const parseLease = (value) => {
  if (!isPlainObject(value) || typeof value.lease_id !== 'string') return null
  try {
    return parseSessionLease(value, value.lease_id)
  } catch {
    return null
  }
}
const leaseProjectionState = (currentLease) => currentLease?.state === 'RELEASED'
  ? Object.freeze({
    lease_state: currentLease.state,
    occupied: false,
    writer_seat_released: true,
    resources_retained: true,
    retention_state: 'RETAINED_FOR_REVIEW',
  })
  : currentLease
    ? Object.freeze({
      lease_state: currentLease.state,
      occupied: true,
      writer_seat_released: false,
      resources_retained: true,
      retention_state: 'ACTIVE',
    })
    : Object.freeze({ occupied: true, truth_unknown: true })
const durableResult = (result, lease) => {
  const currentLease = parseLease(lease)
  return Object.freeze({
    ...result,
    ...(currentLease ? { lease_id: currentLease.lease_id } : {}),
    ...leaseProjectionState(currentLease),
  })
}
const lifecycleHold = (reason, currentLease) => durableResult({
  status: 'HELD_EXECUTION_AUTHORITY', reason,
}, currentLease)
const inventoryHold = (reason, currentLease) => durableResult({ status: 'HELD_HOST_INVENTORY', reason }, currentLease)
const suspect = (reason, currentLease) => durableResult({
  status: 'SUSPECT', reason,
}, currentLease)
const projectionFailure = (operation, reason, currentLease) => durableResult({
  status: 'PROJECTION_DEGRADED', reason, operation,
}, currentLease)
const inputHold = (status, reason, currentLease) => durableResult({ status, reason }, currentLease)

const OUTER_INPUT_KEYS = Object.freeze({
  start: Object.freeze(['lease', 'projectionSource', 'legacy_board_command']),
  heartbeat: Object.freeze(['lease', 'projectionSource', 'legacy_board_command']),
  handoff: Object.freeze(['lease', 'projectionSource', 'legacy_board_command']),
  end_request: Object.freeze(['lease', 'projectionSource', 'legacy_board_command']),
  release: Object.freeze(['lease', 'projectionSource', 'legacy_board_command']),
  reconcile: Object.freeze(['lease', 'registry', 'projectionSource', 'clock', 'inventoryAttestation', 'inventoryReceipt']),
  resume: Object.freeze(['lease', 'registry', 'projectionSource', 'intent', 'contextAttestation', 'ownerEndAttestation', 'resumeAuthorityReceipt']),
})
const OUTER_PORT_KEYS = Object.freeze({
  start: Object.freeze([]),
  heartbeat: Object.freeze([]),
  handoff: Object.freeze([]),
  end_request: Object.freeze([]),
  release: Object.freeze([]),
  reconcile: Object.freeze([]),
  resume: Object.freeze([]),
})
const outerInputIsClosed = (operation, value) => isPlainObject(value) &&
  Object.hasOwn(OUTER_INPUT_KEYS, operation) && Object.keys(value).every((key) => OUTER_INPUT_KEYS[operation].includes(key))

const leaseRegistryIsBound = (currentLease, currentRegistry) => registryIsValid(currentRegistry) &&
  currentRegistry.lease_id === currentLease.lease_id && currentRegistry.target_digest === currentLease.worktree_path_digest

const BOARD_SESSION_KEYS = Object.freeze(['session_ref', 'state', 'updated_at'])
const boardSnapshotIsValid = (value, currentClock) => hasExactKeys(value, ['board_ref', 'observed_at', 'sessions']) &&
  isOpaqueReference(value.board_ref) && isCanonicalUtcMillisecondTimestamp(value.observed_at) && Array.isArray(value.sessions) &&
  value.sessions.every((session) => hasExactKeys(session, BOARD_SESSION_KEYS) && isOpaqueReference(session.session_ref) &&
    ['active', 'idle', 'ended', 'suspect'].includes(session.state) && isCanonicalUtcMillisecondTimestamp(session.updated_at)) &&
  (currentClock === undefined || (Date.parse(value.observed_at) <= Date.parse(currentClock.now) &&
    Date.parse(currentClock.now) - Date.parse(value.observed_at) <= currentClock.projection_timeout_ms))

const INVENTORY_HANDOFF_KEYS = Object.freeze(['attestation_ref', 'target_ref', 'target_type', 'target_digest', 'lease_id', 'runtime_correlation'])
const CANONICAL_INVENTORY_KEYS = Object.freeze(['status', 'handoff'])
const INVENTORY_RECEIPT_KEYS = Object.freeze([
  'status', 'attestation_ref', 'issuer_id', 'issuer_version', 'source_digest', 'observed_at', 'expires_at', 'nonce',
  'revocation_epoch', 'target_ref', 'target_type', 'target_digest', 'lease_id', 'runtime_correlation', 'owner_proof_status',
  'runtime_state', 'expected_registry_oid',
])
const AUTHORITY_PIN_KEYS = Object.freeze(['issuer_id', 'issuer_version', 'source_digest', 'revocation_epoch'])

const canonicalInventoryIsValid = (value) => hasExactKeys(value, CANONICAL_INVENTORY_KEYS) &&
  value.status === 'RECLAIM_HANDOFF_READY' && hasExactKeys(value.handoff, INVENTORY_HANDOFF_KEYS) &&
  isOpaqueReference(value.handoff.attestation_ref) && isOpaqueReference(value.handoff.target_ref) &&
  value.handoff.target_type === 'worktree' && isSha256(value.handoff.target_digest) && isOpaqueReference(value.handoff.lease_id) &&
  isOpaqueReference(value.handoff.runtime_correlation)

const authorityPinIsValid = (value) => hasExactKeys(value, AUTHORITY_PIN_KEYS) &&
  isOpaqueReference(value.issuer_id) && isOpaqueId(value.issuer_version) && isSha256(value.source_digest) &&
  Number.isSafeInteger(value.revocation_epoch) && value.revocation_epoch >= 0

const receiptMatchesAuthorityPin = (receipt, pin) => authorityPinIsValid(pin) &&
  receipt.issuer_id === pin.issuer_id && receipt.issuer_version === pin.issuer_version &&
  receipt.source_digest === pin.source_digest && receipt.revocation_epoch === pin.revocation_epoch

const inventoryReceiptIsBound = (value, canonicalInventory, currentLease, currentRegistry, currentClock) => {
  const handoff = canonicalInventory.handoff
  return hasExactKeys(value, INVENTORY_RECEIPT_KEYS) && value.status === 'VERIFIED_HOST_INVENTORY' &&
    isOpaqueReference(value.attestation_ref) && isOpaqueReference(value.issuer_id) && isOpaqueId(value.issuer_version) &&
    value.issuer_id !== currentLease.owner_session && isSha256(value.source_digest) && isCanonicalUtcMillisecondTimestamp(value.observed_at) &&
    isCanonicalUtcMillisecondTimestamp(value.expires_at) && isCanonicalNonce(value.nonce) &&
    Number.isSafeInteger(value.revocation_epoch) && value.revocation_epoch === currentLease.revocation_epoch &&
    value.attestation_ref === handoff.attestation_ref && value.target_ref === handoff.target_ref &&
    value.target_type === handoff.target_type && value.target_digest === handoff.target_digest &&
    value.lease_id === currentLease.lease_id && value.runtime_correlation === currentRegistry.runtime_correlation &&
    value.owner_proof_status === 'ENDED' && value.runtime_state === 'ABSENT' && value.expected_registry_oid === currentRegistry.oid &&
    receiptMatchesAuthorityPin(value, INVENTORY_SHADOW_PIN) &&
    Date.parse(value.observed_at) <= Date.parse(currentClock.now) && Date.parse(value.expires_at) > Date.parse(currentClock.now) &&
    currentRegistry.target_ref === handoff.target_ref && currentRegistry.target_type === handoff.target_type &&
    currentRegistry.target_digest === handoff.target_digest
}

const RECONCILE_INPUT_KEYS = Object.freeze(['lease', 'registry', 'inventoryAttestation', 'inventoryReceipt', 'clock'])

export function reconcileSession(input = {}) {
  try {
  const inputInspection = inspectValue(input)
  const rawLease = isPlainObject(input) ? input.lease : null
  if (inputInspection === 'private') return inputHold('HELD_PRIVACY', 'reconcile_input_private', rawLease)
  if (inputInspection !== 'safe' || !hasExactKeys(input, RECONCILE_INPUT_KEYS)) return inputHold('HELD_INPUT', 'reconcile_input_invalid', rawLease)
  const snapshot = snapshotInput(input, RECONCILE_INPUT_KEYS)
  if (snapshot === null) return inputHold('HELD_INPUT', 'reconcile_input_snapshot_invalid', rawLease)
  const { lease: rawCurrentLease, registry: currentRegistry, inventoryAttestation, inventoryReceipt, clock } = snapshot
  const currentLease = parseLease(rawCurrentLease)
  if (unsafeValue({ lease: rawCurrentLease, registry: currentRegistry, clock }) || currentLease === null ||
    !registryIsValid(currentRegistry) || !leaseRegistryIsBound(currentLease, currentRegistry) || !clockIsValid(clock)) {
    return lifecycleHold('reconcile_authority_invalid', rawCurrentLease)
  }
  if (currentLease.state === 'END_REQUESTED' || currentLease.state === 'RELEASING') {
    return durableResult({ status: 'HELD_EXECUTION_AUTHORITY', reason: 'owner_end_reconciliation_required' }, currentLease)
  }
  if (currentLease.state === 'ACTIVE' && Date.parse(clock.now) - Date.parse(currentLease.heartbeat_at) > clock.heartbeat_timeout_ms) {
    return suspect('heartbeat_timeout', currentLease)
  }
  if (currentLease.state === 'RELEASED') {
    return durableResult({ status: 'RECONCILED' }, currentLease)
  }
  if ((inventoryAttestation === undefined || inventoryAttestation === null) &&
    (inventoryReceipt === undefined || inventoryReceipt === null)) {
    return durableResult({ status: 'RECONCILED' }, currentLease)
  }
  if (inventoryAttestation === undefined || inventoryAttestation === null || unsafeValue(inventoryAttestation) ||
    !canonicalInventoryIsValid(inventoryAttestation) || currentLease.state !== 'SUSPECT') {
    return inventoryHold('inventory_evidence_untrusted', currentLease)
  }
  if (inventoryReceipt === undefined || inventoryReceipt === null ||
    unsafeValue(inventoryReceipt) || !inventoryReceiptIsBound(inventoryReceipt, inventoryAttestation, currentLease, currentRegistry, clock)) {
    return inventoryHold('inventory_evidence_untrusted', currentLease)
  }
  return durableResult({
    status: 'HELD_HOST_INVENTORY',
    reason: 'host_inventory_authority_activation_unavailable',
    reconcile_required: true,
    shadow_contract: 'MATCHED',
  }, currentLease)
  } catch {
    return PUBLIC_INPUT_HOLD
  }
}

const RESUME_INTENT_KEYS = Object.freeze([
  'schema_version', 'type', 'owner_session', 'provider', 'provider_session_id', 'prior_execution_context_id',
  'execution_context_id', 'lease_id', 'generation', 'common_dir_digest', 'worktree_id', 'worktree_path_digest', 'branch',
  'head_sha', 'scope_digest', 'expected_registry_oid', 'nonce',
])
const CANONICAL_CONTEXT_KEYS = Object.freeze(['status', 'attestation_ref', 'tuple_digest'])
const CANONICAL_OWNER_END_KEYS = Object.freeze(['status', 'attestation_ref'])
const RESUME_RECEIPT_KEYS = Object.freeze([
  'status', 'context_attestation_ref', 'context_tuple_digest', 'owner_end_attestation_ref', 'issuer_id', 'issuer_version',
  'source_digest', 'observed_at', 'expires_at', 'nonce', 'revocation_epoch', 'old_execution_context_id', 'expected_registry_oid', 'tuple',
])
const RESUME_TUPLE_KEYS = Object.freeze([
  'owner_session', 'provider', 'provider_session_id', 'execution_context_id', 'lease_id', 'generation', 'common_dir_digest',
  'worktree_id', 'worktree_path_digest', 'branch', 'head_sha', 'scope_digest',
])
const resumeIntentIsBound = (intent, currentLease, currentRegistry) => hasExactKeys(intent, RESUME_INTENT_KEYS) &&
  intent.schema_version === 'resume-intent/v1' && intent.type === 'RESUME_INTENT' &&
  intent.owner_session === currentLease.owner_session && intent.provider === currentLease.provider &&
  intent.provider_session_id === currentLease.provider_session_id && intent.prior_execution_context_id === currentLease.execution_context_id &&
  isOpaqueReference(intent.execution_context_id) && intent.execution_context_id !== currentLease.execution_context_id &&
  intent.lease_id === currentLease.lease_id && intent.generation === currentLease.generation &&
  intent.common_dir_digest === currentLease.common_dir_digest && intent.worktree_id === currentLease.worktree_id &&
  intent.worktree_path_digest === currentLease.worktree_path_digest && intent.branch === currentLease.branch &&
  intent.head_sha === currentLease.head_sha && intent.scope_digest === currentLease.scope_digest &&
  intent.expected_registry_oid === currentRegistry.oid && isCanonicalNonce(intent.nonce)

const canonicalContextIsValid = (value) => hasExactKeys(value, CANONICAL_CONTEXT_KEYS) &&
  value.status === 'VERIFIED_EXECUTION_CONTEXT' && isOpaqueReference(value.attestation_ref) && isSha256(value.tuple_digest)
const canonicalOwnerEndIsValid = (value) => hasExactKeys(value, CANONICAL_OWNER_END_KEYS) &&
  value.status === 'VERIFIED_OWNER_END' && isOpaqueReference(value.attestation_ref)
const resumeReceiptIsBound = (receipt, intent, contextAttestation, ownerEndAttestation, currentLease, currentRegistry, authorityClock) => {
  if (!hasExactKeys(receipt, RESUME_RECEIPT_KEYS) || receipt.status !== 'VERIFIED_RESUME_AUTHORITY' ||
    receipt.context_attestation_ref !== contextAttestation.attestation_ref || receipt.context_tuple_digest !== contextAttestation.tuple_digest ||
    receipt.owner_end_attestation_ref !== ownerEndAttestation.attestation_ref || !isOpaqueReference(receipt.issuer_id) ||
    !isOpaqueId(receipt.issuer_version) || receipt.issuer_id === currentLease.owner_session || !isSha256(receipt.source_digest) ||
    !isCanonicalUtcMillisecondTimestamp(receipt.observed_at) || !isCanonicalUtcMillisecondTimestamp(receipt.expires_at) ||
    Date.parse(receipt.observed_at) > Date.parse(authorityClock.now) || Date.parse(receipt.expires_at) <= Date.parse(authorityClock.now) ||
    receipt.nonce !== intent.nonce || !Number.isSafeInteger(receipt.revocation_epoch) ||
    receipt.revocation_epoch !== currentLease.revocation_epoch || !receiptMatchesAuthorityPin(receipt, RESUME_SHADOW_PIN) ||
    receipt.old_execution_context_id !== currentLease.execution_context_id ||
    receipt.expected_registry_oid !== currentRegistry.oid || receipt.expected_registry_oid !== intent.expected_registry_oid ||
    !hasExactKeys(receipt.tuple, RESUME_TUPLE_KEYS)) return false
  const tuple = receipt.tuple
  return tuple.owner_session === currentLease.owner_session && tuple.provider === currentLease.provider &&
    tuple.provider_session_id === currentLease.provider_session_id && tuple.execution_context_id === intent.execution_context_id &&
    tuple.lease_id === currentLease.lease_id && tuple.generation === currentLease.generation &&
    tuple.common_dir_digest === currentLease.common_dir_digest && tuple.worktree_id === currentLease.worktree_id &&
    tuple.worktree_path_digest === currentLease.worktree_path_digest && tuple.branch === currentLease.branch &&
    tuple.head_sha === currentLease.head_sha && tuple.scope_digest === currentLease.scope_digest
}

const RESUME_INPUT_KEYS = Object.freeze([
  'lease', 'registry', 'intent', 'contextAttestation', 'ownerEndAttestation', 'resumeAuthorityReceipt', 'authorityClock',
])

export function evaluateResumeIntent(input = {}) {
  try {
  const inputInspection = inspectValue(input)
  const rawLease = isPlainObject(input) ? input.lease : null
  if (inputInspection === 'private') return inputHold('HELD_PRIVACY', 'resume_input_private', rawLease)
  if (inputInspection !== 'safe' || !hasExactKeys(input, RESUME_INPUT_KEYS)) return inputHold('HELD_INPUT', 'resume_input_invalid', rawLease)
  const snapshot = snapshotInput(input, RESUME_INPUT_KEYS)
  if (snapshot === null) return inputHold('HELD_INPUT', 'resume_input_snapshot_invalid', rawLease)
  const {
    lease: rawCurrentLease, registry: currentRegistry, intent, contextAttestation, ownerEndAttestation, resumeAuthorityReceipt, authorityClock,
  } = snapshot
  const currentLease = parseLease(rawCurrentLease)
  if (unsafeValue({ lease: rawCurrentLease, registry: currentRegistry, intent, contextAttestation, ownerEndAttestation }) ||
    currentLease === null || !registryIsValid(currentRegistry) || !leaseRegistryIsBound(currentLease, currentRegistry) ||
    currentLease.state !== 'SUSPECT' ||
    !resumeIntentIsBound(intent, currentLease, currentRegistry) || !canonicalContextIsValid(contextAttestation) ||
    !canonicalOwnerEndIsValid(ownerEndAttestation) || !clockIsValid(authorityClock)) {
    return lifecycleHold('resume_authority_invalid', rawCurrentLease)
  }
  if (unsafeValue(resumeAuthorityReceipt) || !resumeReceiptIsBound(
    resumeAuthorityReceipt, intent, contextAttestation, ownerEndAttestation, currentLease, currentRegistry, authorityClock,
  )) return lifecycleHold('resume_evidence_untrusted', currentLease)
  return durableResult({
    status: 'HELD_EXECUTION_AUTHORITY',
    reason: 'resume_authority_activation_unavailable',
    reconcile_required: true,
    shadow_contract: 'MATCHED',
  }, currentLease)
  } catch {
    return PUBLIC_INPUT_HOLD
  }
}

const FACTORY_CONFIG_KEYS = Object.freeze(['readBoardStatus', 'writeProjection', 'authorityClock'])
const PUBLIC_INPUT_HOLD = Object.freeze({ status: 'HELD_INPUT', reason: 'public_input_invalid', occupied: true, truth_unknown: true })
const inertProjection = () => Object.freeze({
  start: () => PUBLIC_INPUT_HOLD,
  heartbeat: () => PUBLIC_INPUT_HOLD,
  handoff: () => PUBLIC_INPUT_HOLD,
  end_request: () => PUBLIC_INPUT_HOLD,
  release: () => PUBLIC_INPUT_HOLD,
  reconcile: () => PUBLIC_INPUT_HOLD,
  resume: () => PUBLIC_INPUT_HOLD,
})

export function createBoardProjection(config = {}) {
  try {
  const configIsClosed = isPlainObject(config) && Object.keys(config).every((key) => FACTORY_CONFIG_KEYS.includes(key))
  const readBoardStatus = configIsClosed ? config.readBoardStatus : undefined
  const writeProjection = configIsClosed ? config.writeProjection : undefined
  const suppliedAuthorityClock = configIsClosed && Object.hasOwn(config, 'authorityClock') ? config.authorityClock : undefined
  const authorityClock = suppliedAuthorityClock === undefined ? undefined : ownedSnapshot(suppliedAuthorityClock)
  const authorityClockIsValid = authorityClock === undefined || clockIsValid(authorityClock)
  const configured = configIsClosed && typeof readBoardStatus === 'function' && typeof writeProjection === 'function' && authorityClockIsValid
  const project = (operation, input = {}) => {
    try {
    const rawLease = isPlainObject(input) ? input.lease : null
    if (!isPlainObject(input)) {
      return inputHold('HELD_INPUT', 'projection_input_invalid', rawLease)
    }
    const inputInspection = inspectValue(input)
    if (inputInspection === 'private') {
      return inputHold('HELD_PRIVACY', 'projection_input_private', rawLease)
    }
    if (inputInspection !== 'safe') return inputHold('HELD_INPUT', 'projection_input_invalid', rawLease)
    if (!outerInputIsClosed(operation, input)) {
      return inputHold('HELD_INPUT', 'projection_input_invalid', rawLease)
    }
    if (!configured) return inputHold('HELD_INPUT', 'projection_config_invalid', rawLease)
    const snapshotInputValue = snapshotInput(input, OUTER_INPUT_KEYS[operation], { ports: OUTER_PORT_KEYS[operation] })
    if (snapshotInputValue === null) return inputHold('HELD_INPUT', 'projection_input_snapshot_invalid', rawLease)
    const currentLease = parseLease(snapshotInputValue.lease)
    if (currentLease === null) return lifecycleHold('lease_record_invalid', rawLease)
    let durableOutcome
    if (operation === 'reconcile') {
      const hasInventoryEvidence = snapshotInputValue.inventoryAttestation !== undefined || snapshotInputValue.inventoryReceipt !== undefined
      const reconciliationClock = hasInventoryEvidence ? authorityClock : snapshotInputValue.clock
      if (hasInventoryEvidence && reconciliationClock === undefined) {
        return inventoryHold('inventory_evidence_untrusted', currentLease)
      }
      durableOutcome = reconcileSession({
        lease: currentLease, registry: snapshotInputValue.registry, inventoryAttestation: snapshotInputValue.inventoryAttestation,
        inventoryReceipt: snapshotInputValue.inventoryReceipt, clock: reconciliationClock,
      })
      if (durableOutcome.status !== 'RECONCILED') return durableOutcome
    }
    if (operation === 'resume') {
      if (authorityClock === undefined) return lifecycleHold('resume_evidence_untrusted', currentLease)
      durableOutcome = evaluateResumeIntent({
        lease: currentLease, registry: snapshotInputValue.registry, intent: snapshotInputValue.intent,
        contextAttestation: snapshotInputValue.contextAttestation, ownerEndAttestation: snapshotInputValue.ownerEndAttestation,
        resumeAuthorityReceipt: snapshotInputValue.resumeAuthorityReceipt, authorityClock,
      })
      if (durableOutcome.status !== 'RECONCILED') return durableOutcome
    }
    if (!configured || !sourceIsValid(snapshotInputValue.projectionSource, currentLease)) {
      return projectionFailure(operation, 'projection_input_invalid', currentLease)
    }
    if (Object.hasOwn(snapshotInputValue, 'legacy_board_command') && snapshotInputValue.legacy_board_command !== BOARD_COMMAND) {
      return durableResult({ status: 'HELD_LEGACY_BOARD_WRITE', reason: 'legacy_board_write_forbidden', operation }, currentLease)
    }
    if (snapshotInputValue.clock !== undefined && !clockIsValid(snapshotInputValue.clock)) return projectionFailure(operation, 'projection_clock_invalid', currentLease)
    let boardSnapshot
    try {
      boardSnapshot = ownedSnapshot(readBoardStatus(...BOARD_STATUS_ARGV))
    } catch {
      return projectionFailure(operation, 'board_read_failed', currentLease)
    }
    if (boardSnapshot === null || !boardSnapshotIsValid(boardSnapshot, snapshotInputValue.clock)) {
      return projectionFailure(operation, 'board_snapshot_invalid', currentLease)
    }
    let record
    try {
      const unsigned = {
        board_ref: boardSnapshot.board_ref,
        channel: CHANNEL,
        generation: snapshotInputValue.projectionSource.generation,
        github_state_ref: snapshotInputValue.projectionSource.github_state_ref,
        lease_id: currentLease.lease_id,
        lease_ref: snapshotInputValue.projectionSource.lease_ref,
        lease_state: currentLease.state,
        operation,
        plan_ref: snapshotInputValue.projectionSource.plan_ref,
        projected_at: boardSnapshot.observed_at,
        provider_envelope_ref: snapshotInputValue.projectionSource.provider_envelope_ref,
      }
      record = Object.freeze({ ...unsigned, projection_digest: digestCanonical(unsigned) })
    } catch {
      return projectionFailure(operation, 'projection_record_invalid', currentLease)
    }
    let acknowledgement
    try {
      const writeRequest = callbackArguments({
        channel: CHANNEL, expected_oid: snapshotInputValue.projectionSource.expected_projection_oid, record,
      })
      if (writeRequest === null) return projectionFailure(operation, 'projection_write_failed', currentLease)
      acknowledgement = ownedSnapshot(writeProjection(writeRequest))
    } catch {
      return projectionFailure(operation, 'projection_write_failed', currentLease)
    }
    if (acknowledgement === null || !hasExactKeys(acknowledgement, ['status', 'oid']) || acknowledgement.status !== 'STORED' || !isNonzeroOid(acknowledgement.oid)) {
      return projectionFailure(operation, 'projection_write_conflict', currentLease)
    }
    return durableOutcome || durableResult({ status: 'PROJECTION_READY', operation }, currentLease)
    } catch {
      return PUBLIC_INPUT_HOLD
    }
  }
  return Object.freeze({
    start: (input) => project('start', input),
    heartbeat: (input) => project('heartbeat', input),
    handoff: (input) => project('handoff', input),
    end_request: (input) => project('end_request', input),
    release: (input) => project('release', input),
    reconcile: (input) => project('reconcile', input),
    resume: (input) => project('resume', input),
  })
  } catch {
    return inertProjection()
  }
}
