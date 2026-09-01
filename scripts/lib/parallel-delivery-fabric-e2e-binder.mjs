import { createHash } from 'node:crypto'
import { types as utilTypes } from 'node:util'

import {
  canonicalize,
  digestCanonical,
  isCanonicalOpaqueId,
  isCanonicalOpaqueReference,
  isCanonicalUtcMillisecondTimestamp,
} from './parallel-delivery-fabric-contract.mjs'

// This module is a pure evidence/policy boundary.  It consumes observations
// produced by the repository-owned stack and browser runners; it never starts
// a process, reads a file, scans listeners, changes Git state, or publishes a
// check.  Host paths may be accepted only to compare physical manifest
// identity and are represented by a digest in returned durable evidence.

const SHA1 = /^[0-9a-f]{40}$/u
const SHA256 = /^[0-9a-f]{64}$/u
const CANONICAL_OFFSETS = Object.freeze([0, 1, 2, 3, 4])
const CANONICAL_RESERVED_PORTS = new Set([
  8004, 49102, 49101, 8010, 5173, 5174, 49100,
  ...Array.from({ length: 41 }, (_, index) => 49110 + index),
])
const RUNTIME_KINDS = Object.freeze(new Set(['writer', 'integration_train', 'computer_use']))
const RUNTIME_KIND_LEGACY_KEYS = Object.freeze(['runtime_kind', 'runtime_role', 'role', 'lease_kind'])
const RUNTIME_LEASE_ALIAS_KEYS = Object.freeze(['leases', 'runtime_leases', 'active_leases'])
const TRUSTED_SOURCES = Object.freeze(new Set(['base', 'base-owned', 'prior-trusted', 'trusted']))
const OFFSET_SOURCES = Object.freeze(new Set(['base', 'launcher', 'registry', 'trusted', 'allocator', 'trusted-allocator']))
const LEASE_STATES = Object.freeze(new Set(['ACTIVE', 'RELEASED', 'ENDED', 'INACTIVE', 'CLOSED']))
const TRAIN_RELEASE_RECONCILE_KEYS = Object.freeze([
  'lease_id', 'status', 'retention_state', 'observed_at',
])
const REQUIRED_COMMAND_ROLES = Object.freeze(new Set([
  'git_preflight', 'stack_start', 'stack_status', 'playwright_require_real', 'computer_use', 'postflight',
]))
const COMPUTER_USE_AUTHORITY_KEYS = Object.freeze(new Set([
  'schema_version', 'source', 'source_ref', 'source_sha', 'base_sha', 'authority_digest',
  'verifier_identity', 'immutable', 'base_pinned', 'fresh', 'read_only',
  'can_edit', 'can_push', 'can_resolve', 'can_publish_required_check',
  'can_approve', 'can_merge', 'can_deploy',
]))
const COMPUTER_USE_DENIED_CAPABILITIES = Object.freeze([
  'can_edit', 'can_push', 'can_resolve', 'can_publish_required_check',
  'can_approve', 'can_merge', 'can_deploy',
])

const isPlainObject = (value) => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

const deepFreeze = (value, seen = new WeakSet()) => {
  if (value === null || typeof value !== 'object' || seen.has(value)) return value
  seen.add(value)
  for (const nested of Object.values(value)) deepFreeze(nested, seen)
  return Object.freeze(value)
}

const clone = (value) => {
  if (Array.isArray(value)) return value.map(clone)
  if (!isPlainObject(value)) return value
  const result = {}
  for (const [key, nested] of Object.entries(value)) result[key] = clone(nested)
  return result
}

const freezeCopy = (value) => deepFreeze(clone(value))
const own = (value, key) => isPlainObject(value) && Object.hasOwn(value, key)
const first = (value, keys) => {
  if (!isPlainObject(value)) return undefined
  for (const key of keys) if (own(value, key) && value[key] !== null && value[key] !== undefined) return value[key]
  return undefined
}
const isSha1 = (value) => typeof value === 'string' && SHA1.test(value)
const isSha256 = (value) => typeof value === 'string' && SHA256.test(value)
const isTimestamp = (value) => typeof value === 'string' && isCanonicalUtcMillisecondTimestamp(value)
const isOpaqueId = (value) => isCanonicalOpaqueId(value)
const isOpaqueRef = (value) => isCanonicalOpaqueReference(value)
const exactKeys = (value, keys) => !utilTypes.isProxy(value) && isPlainObject(value) &&
  Reflect.ownKeys(value).every((key) => typeof key === 'string') &&
  Reflect.ownKeys(value).length === keys.length && keys.every((key) => own(value, key))

const trustedClockNow = (value) => {
  try {
    if (!exactKeys(value, ['now'])) return undefined
    const descriptor = Object.getOwnPropertyDescriptor(value, 'now')
    return descriptor && Object.hasOwn(descriptor, 'value') && isTimestamp(descriptor.value) ? descriptor.value : undefined
  } catch {
    return undefined
  }
}

const normalizedKey = (key) => String(key)
  .replace(/([a-z0-9])([A-Z])/gu, '$1_$2')
  .toLowerCase()
  .replaceAll('-', '_')

const SECRET_VALUE = /(?:bearer|token|cookie|authorization|private[-_]?key|gh[pousr]_|github_pat_|eyJ[A-Za-z0-9_-]{10,})/iu
const WINDOWS_SID = /(?:^|[/:])S-\d+(?:-\d+){2,}(?=$|[/:])/iu
const ABSOLUTE_PATH = /(?:^|[=:])[A-Za-z]:[\\/]|(?:^|:)\/(?:home|users|tmp|var)\//iu
const ENV_ALIAS = /(?:^|[/:\\])(?:env|environment):[A-Za-z_][A-Za-z0-9_]*|(?:^|[/:\\])\$env:[A-Za-z_][A-Za-z0-9_]*|(?:^|[/:\\])%[A-Za-z_][A-Za-z0-9_]*%/iu
const TERMINAL_PID = /(?:^|[/:])\d+$/u
const ALLOWED_RAW_PATH_KEYS = new Set(['manifest_path', 'physical_manifest_path', 'worktree_root'])

const sensitiveKey = (key) => {
  const normalized = normalizedKey(key)
  if (ALLOWED_RAW_PATH_KEYS.has(normalized)) return false
  return normalized.includes('token') || normalized.includes('cookie') || normalized.includes('authorization') ||
    normalized.includes('private_key') || normalized === 'sid' || normalized.endsWith('_sid') ||
    normalized === 'pid' || normalized.endsWith('_pid') || normalized === 'process_id' ||
    normalized.includes('transcript') || normalized === 'env' || normalized.startsWith('env_') ||
    normalized.endsWith('_env') || normalized.includes('raw_env') || normalized.includes('environment_values') ||
    normalized.includes('absolute_path') ||
    (normalized.endsWith('_path') && !['old_path', 'new_path', 'public_entrypoint', ...ALLOWED_RAW_PATH_KEYS].includes(normalized))
}

const unsafeString = (value, key = '') => {
  if (typeof value !== 'string') return false
  if (isSha1(value) || isSha256(value) || isTimestamp(value)) return false
  if (ALLOWED_RAW_PATH_KEYS.has(normalizedKey(key))) return false
  return SECRET_VALUE.test(value) || WINDOWS_SID.test(value) || ENV_ALIAS.test(value) ||
    (ABSOLUTE_PATH.test(value) && !['path', 'paths'].includes(normalizedKey(key))) ||
    (TERMINAL_PID.test(value) && (normalizedKey(key).includes('identity') || normalizedKey(key).includes('reference')))
}

const DATA_SNAPSHOT_INVALID = Symbol('data_snapshot_invalid')
const DATA_SNAPSHOT_UNDEFINED_LEASE_ALIAS = Symbol('data_snapshot_undefined_lease_alias')

const dataOnlySnapshot = (value, seen = new WeakSet(), nodes = { count: 0 }, path = []) => {
  const valueType = typeof value
  if (value !== null && (valueType === 'object' || valueType === 'function') && utilTypes.isProxy(value)) {
    return DATA_SNAPSHOT_INVALID
  }
  if (value === null) return value
  if (valueType === 'string' || valueType === 'boolean' ||
      (valueType === 'number' && Number.isFinite(value))) return value
  if (valueType !== 'object') {
    if (valueType === 'undefined' && path.length === 1 && RUNTIME_LEASE_ALIAS_KEYS.includes(path[0])) {
      return DATA_SNAPSHOT_UNDEFINED_LEASE_ALIAS
    }
    return DATA_SNAPSHOT_INVALID
  }
  if (seen.has(value) || ++nodes.count > 4096) return DATA_SNAPSHOT_INVALID
  const array = Array.isArray(value)
  if (!array && !isPlainObject(value)) return DATA_SNAPSHOT_INVALID
  const result = array ? [] : Object.create(null)
  seen.add(value)
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key === 'symbol') {
      seen.delete(value)
      return DATA_SNAPSHOT_INVALID
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (array && key === 'length') continue
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
      seen.delete(value)
      return DATA_SNAPSHOT_INVALID
    }
    const nested = dataOnlySnapshot(descriptor.value, seen, nodes, [...path, key])
    if (nested === DATA_SNAPSHOT_INVALID || nested === DATA_SNAPSHOT_UNDEFINED_LEASE_ALIAS) {
      seen.delete(value)
      return nested
    }
    Object.defineProperty(result, key, {
      configurable: true,
      enumerable: true,
      value: nested,
      writable: true,
    })
  }
  seen.delete(value)
  return result
}

const safeInput = (value, key = '', seen = new WeakSet(), nodes = { count: 0 }) => {
  if (typeof value === 'string') return !unsafeString(value, key)
  if (value === null) return true
  if (value === undefined) return true
  if (typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) return true
  if (typeof value !== 'object') return false
  if (utilTypes.isProxy(value)) return false
  if (seen.has(value) || ++nodes.count > 4096) return false
  if (!Array.isArray(value) && !isPlainObject(value)) return false
  seen.add(value)
  let result = true
  for (const nestedKey of Reflect.ownKeys(value)) {
    if (typeof nestedKey === 'symbol') {
      result = false
      break
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, nestedKey)
    if (Array.isArray(value) && nestedKey === 'length') continue
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
      result = false
      break
    }
    if (!Array.isArray(value) && sensitiveKey(nestedKey)) {
      result = false
      break
    }
    if (!safeInput(descriptor.value, Array.isArray(value) ? key : nestedKey, seen, nodes)) {
      result = false
      break
    }
  }
  seen.delete(value)
  return result
}

const safeDigest = (value) => {
  try {
    if (!safeInput(value)) return null
    return digestCanonical(value)
  } catch {
    return null
  }
}

const equalCanonical = (left, right) => {
  try { return JSON.stringify(canonicalize(left)) === JSON.stringify(canonicalize(right)) } catch { return false }
}

const ALIAS_VALUE_INVALID = Symbol('alias_value_invalid')

const resolveAliases = (value, canonicalKey, legacyKeys = []) => {
  if (!isPlainObject(value)) return ALIAS_VALUE_INVALID
  if (legacyKeys.some((key) => own(value, key))) return ALIAS_VALUE_INVALID
  if (!own(value, canonicalKey)) return undefined
  const nested = value[canonicalKey]
  if (nested === null || nested === undefined || typeof nested === 'function' ||
      typeof nested === 'symbol' || typeof nested === 'bigint' ||
      (typeof nested === 'number' && !Number.isFinite(nested))) return ALIAS_VALUE_INVALID
  return nested
}

const sha1From = (value) => {
  try {
    const canonical = JSON.stringify(canonicalize(value))
    return createHash('sha1').update(canonical, 'utf8').digest('hex')
  } catch {
    return null
  }
}

const held = (status, reason, extras = {}) => freezeCopy({ status, reason, ...extras })

const normalizedPhysicalPath = (value) => {
  if (typeof value !== 'string' || value.trim() === '') return null
  const parts = value.replaceAll('\\', '/').split('/')
  const normalized = []
  for (const part of parts) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      if (normalized.length > 0 && normalized.at(-1) !== '..') normalized.pop()
      else normalized.push(part)
    } else normalized.push(part)
  }
  const prefix = /^[A-Za-z]:/u.test(value) ? `${value[0].toLowerCase()}:` : value.startsWith('/') ? '/' : ''
  return `${prefix}${normalized.join('/')}`.replace(/^\/+/, prefix === '/' ? '/' : '').toLowerCase()
}

const pathDigest = (value) => {
  const normalized = normalizedPhysicalPath(value)
  return normalized === null ? null : createHash('sha256').update(normalized, 'utf8').digest('hex')
}

const pathIdentity = (value) => {
  const supplied = first(value, ['manifest_path_digest', 'physical_manifest_path_digest', 'path_digest'])
  const rawPath = first(value, ['manifest_path', 'physical_manifest_path'])
  const computed = rawPath === undefined ? null : pathDigest(rawPath)
  if (computed !== null) return isSha256(supplied) && supplied !== computed ? null : computed
  return isSha256(supplied) ? supplied : null
}

const portsForOffset = (offset) => ({
  coordinator: 8005 + offset,
  governance: 49103 + offset,
  viewer: 5180 + offset,
})

const baseUrlsForPorts = (ports) => ({
  coordinator: `http://127.0.0.1:${ports.coordinator}`,
  governance: `http://127.0.0.1:${ports.governance}`,
  viewer: `http://127.0.0.1:${ports.viewer}`,
})

const validOffset = (value) => Number.isSafeInteger(value) && CANONICAL_OFFSETS.includes(value)

const validPorts = (ports, offset) => {
  if (!isPlainObject(ports) || !['coordinator', 'governance', 'viewer'].every((key) => Number.isSafeInteger(ports[key]))) return false
  if (Object.keys(ports).some((key) => !['coordinator', 'governance', 'viewer'].includes(key))) return false
  if (offset !== undefined && (!validOffset(offset) || !equalCanonical(ports, portsForOffset(offset)))) return false
  return Object.values(ports).every((port) => port >= 1 && port <= 65535 && !CANONICAL_RESERVED_PORTS.has(port))
}

const validBaseUrls = (baseUrls, ports) => isPlainObject(baseUrls) &&
  ['coordinator', 'governance', 'viewer'].every((key) => typeof baseUrls[key] === 'string') &&
  equalCanonical(baseUrls, baseUrlsForPorts(ports))

const runtimeKind = (value) => {
  const raw = typeof value === 'string' ? value.toLowerCase().replaceAll('-', '_') : ''
  if (raw === 'writer' || raw === 'writer_runtime') return 'writer'
  if (raw === 'train' || raw === 'integration_train' || raw === 'integration') return 'integration_train'
  if (raw === 'computer_use' || raw === 'computeruse' || raw === 'browser_verifier') return 'computer_use'
  return null
}

const activeLeaseState = (lease) => {
  const state = own(lease, 'state') && typeof lease.state === 'string' ? lease.state.toUpperCase() : 'ACTIVE'
  return !['RELEASED', 'ENDED', 'INACTIVE', 'CLOSED'].includes(state)
}

const leaseState = (lease) => own(lease, 'state') && typeof lease.state === 'string' ? lease.state.toUpperCase() : 'ACTIVE'

const resolveRuntimeKind = (value) => {
  if (!isPlainObject(value)) return { kind: null, reason: 'INVALID' }
  if (RUNTIME_KIND_LEGACY_KEYS.some((key) => own(value, key))) {
    return { kind: null, reason: 'ALIAS_INVALID' }
  }
  if (!own(value, 'kind')) return { kind: null, reason: 'MISSING' }
  const kind = runtimeKind(value.kind)
  return kind ? { kind, reason: null } : { kind: null, reason: 'UNKNOWN' }
}

const runtimeLeases = (snapshot) => {
  const values = resolveAliases(snapshot, 'leases', ['runtime_leases', 'active_leases'])
  if (values === ALIAS_VALUE_INVALID) return values
  if (values === undefined) return []
  return Array.isArray(values) ? values : ALIAS_VALUE_INVALID
}

const trainReleaseReconcile = (snapshot) => {
  if (!own(snapshot, 'train_release_reconcile')) return null
  const value = snapshot.train_release_reconcile
  if (!exactKeys(value, TRAIN_RELEASE_RECONCILE_KEYS) ||
      !isOpaqueId(value.lease_id) ||
      value.status !== 'RELEASED' ||
      value.retention_state !== 'RETAINED_FOR_REVIEW' ||
      !isTimestamp(value.observed_at)) return undefined
  return value
}

const frozenRuntime = (snapshot) => {
  const value = resolveAliases(snapshot, 'runtime_identity', ['frozen_runtime', 'runtime_frozen', 'frozen_identity'])
  if (value === ALIAS_VALUE_INVALID) return value
  return value === undefined ? null : value
}

const identityFields = Object.freeze([
  'offset', 'manifest_sha256', 'branch', 'worktree_id', 'worktree_path_digest',
  'runtime_identity_digest', 'tree_digest', 'offset_source', 'offset_binding_digest',
])

const COMPLETE_RUNTIME_FIELDS = Object.freeze([
  'offset', 'ports', 'base_urls', 'manifest_sha256', 'tree_digest', 'runtime_identity_digest',
  'branch', 'worktree_id', 'worktree_path_digest',
])

const offsetSource = (value) => resolveAliases(value, 'offset_source', ['allocator_source'])
const offsetBinding = (value) => resolveAliases(value, 'offset_binding_digest', ['allocator_binding_digest', 'offset_binding'])

const hasCompleteRuntimeIdentity = (value) => isPlainObject(value) &&
  COMPLETE_RUNTIME_FIELDS.every((key) => own(value, key) && value[key] !== undefined && value[key] !== null)

const compareRuntimeIdentity = (frozen, request) => {
  if (!isPlainObject(frozen)) return null
  for (const key of identityFields) {
    if (own(frozen, key) && own(request, key) && frozen[key] !== request[key]) return key
  }
  if (own(frozen, 'ports') && own(request, 'ports') && !equalCanonical(frozen.ports, request.ports)) return 'ports'
  if (own(frozen, 'base_urls') && own(request, 'base_urls') && !equalCanonical(frozen.base_urls, request.base_urls)) return 'base_urls'
  return null
}

const runtimeIdentityView = (request) => {
  const output = {}
  for (const key of identityFields) if (own(request, key)) output[key] = request[key]
  for (const key of ['ports', 'base_urls']) if (own(request, key)) output[key] = request[key]
  return output
}

/**
 * Evaluate a runtime lease intent against an already collected snapshot.
 * This is deliberately admission-only: it does not reserve an offset or
 * mutate the snapshot.  A caller must persist the returned frozen identity
 * through its existing lease registry before starting a runtime.
 */
export function evaluateRuntimeAdmission(snapshot, request) {
  const ownedSnapshot = dataOnlySnapshot(snapshot)
  const ownedRequest = dataOnlySnapshot(request)
  if (ownedSnapshot === DATA_SNAPSHOT_UNDEFINED_LEASE_ALIAS) {
    return held('HELD_RUNTIME', 'RUNTIME_LEASE_SNAPSHOT_INVALID')
  }
  if (ownedSnapshot === DATA_SNAPSHOT_INVALID || ownedRequest === DATA_SNAPSHOT_INVALID ||
      ownedRequest === DATA_SNAPSHOT_UNDEFINED_LEASE_ALIAS ||
      !isPlainObject(ownedSnapshot) || !isPlainObject(ownedRequest)) {
    return held('HELD_RUNTIME', 'RUNTIME_ADMISSION_INPUT_INVALID')
  }
  snapshot = ownedSnapshot
  request = ownedRequest
  if (!safeInput(snapshot) || !safeInput(request) || !isPlainObject(snapshot) || !isPlainObject(request)) {
    return held('HELD_RUNTIME', 'RUNTIME_ADMISSION_INPUT_INVALID')
  }
  const leases = runtimeLeases(snapshot)
  if (leases === ALIAS_VALUE_INVALID || !Array.isArray(leases)) {
    return held('HELD_RUNTIME', 'RUNTIME_LEASE_SNAPSHOT_INVALID')
  }
  const releaseReconcile = trainReleaseReconcile(snapshot)
  if (releaseReconcile === undefined) {
    return held('HELD_RUNTIME', 'TRAIN_RELEASE_RECONCILE_INVALID')
  }
  if (releaseReconcile !== null) {
    return held('HELD_RUNTIME', 'TRAIN_RELEASE_AUTHORITY_REQUIRED')
  }
  const requestedKindResolution = resolveRuntimeKind(request)
  if (requestedKindResolution.reason === 'ALIAS_INVALID') return held('HELD_RUNTIME', 'RUNTIME_KIND_ALIAS_INVALID')
  const requestedKind = requestedKindResolution.kind
  if (!RUNTIME_KINDS.has(requestedKind)) return held('HELD_RUNTIME', 'RUNTIME_KIND_UNKNOWN')
  const requestedOffsetSource = offsetSource(request)
  const requestedOffsetBinding = offsetBinding(request)
  if (requestedOffsetSource === ALIAS_VALUE_INVALID) return held('HELD_RUNTIME', 'OFFSET_SOURCE_UNTRUSTED')
  if (requestedOffsetBinding === ALIAS_VALUE_INVALID) return held('HELD_RUNTIME', 'OFFSET_BINDING_MISSING')
  if (!requestedOffsetSource || !OFFSET_SOURCES.has(String(requestedOffsetSource).toLowerCase()) ||
      String(requestedOffsetSource).toLowerCase().includes('candidate')) {
    return held('HELD_RUNTIME', 'OFFSET_SOURCE_UNTRUSTED')
  }
  if (!isSha256(requestedOffsetBinding) && !isOpaqueRef(requestedOffsetBinding)) return held('HELD_RUNTIME', 'OFFSET_BINDING_MISSING')
  if (request.candidate_offset !== undefined || request.candidate_chosen_offset !== undefined) {
    return held('HELD_RUNTIME', 'OFFSET_NOT_TRUSTED')
  }
  if (!own(snapshot, 'runtime_cap') || snapshot.runtime_cap !== 3) {
    return held('HELD_RUNTIME', 'RUNTIME_CAPACITY_POLICY_INVALID')
  }
  if (!own(snapshot, 'writer_cap') || snapshot.writer_cap !== 2) return held('HELD_RUNTIME', 'WRITER_CAPACITY_POLICY_INVALID')

  const frozen = frozenRuntime(snapshot)
  if (frozen === ALIAS_VALUE_INVALID) return held('HELD_RUNTIME', 'FROZEN_RUNTIME_IDENTITY_INVALID')
  if (!hasCompleteRuntimeIdentity(frozen)) return held('HELD_RUNTIME', 'FROZEN_RUNTIME_IDENTITY_MISSING')
  const frozenOffsetSource = offsetSource(frozen)
  if (frozenOffsetSource === ALIAS_VALUE_INVALID) {
    return held('HELD_RUNTIME', 'FROZEN_RUNTIME_OFFSET_SOURCE_INVALID')
  }
  if (!frozenOffsetSource || String(frozenOffsetSource).toLowerCase() !== String(requestedOffsetSource).toLowerCase()) {
    return held('HELD_RUNTIME', 'FROZEN_RUNTIME_OFFSET_SOURCE_MISMATCH')
  }
  const frozenOffsetBinding = offsetBinding(frozen)
  if (frozenOffsetBinding === ALIAS_VALUE_INVALID) {
    return held('HELD_RUNTIME', 'FROZEN_RUNTIME_OFFSET_BINDING_INVALID')
  }
  if ((!isSha256(frozenOffsetBinding) && !isOpaqueRef(frozenOffsetBinding)) || frozenOffsetBinding !== requestedOffsetBinding) {
    return held('HELD_RUNTIME', 'FROZEN_RUNTIME_OFFSET_BINDING_MISMATCH')
  }
  if (!hasCompleteRuntimeIdentity(request)) return held('HELD_RUNTIME', 'RUNTIME_IDENTITY_INCOMPLETE')
  if (request.offset !== undefined && !validOffset(request.offset)) return held('HELD_RUNTIME', 'OFFSET_INVALID')

  const validatedLeases = []
  for (const lease of leases) {
    if (!isPlainObject(lease)) return held('HELD_RUNTIME', 'ACTIVE_RUNTIME_LEASE_INVALID')
    if (!LEASE_STATES.has(leaseState(lease))) return held('HELD_RUNTIME', 'ACTIVE_RUNTIME_LEASE_INVALID')
    const kindResolution = resolveRuntimeKind(lease)
    if (kindResolution.reason === 'ALIAS_INVALID') return held('HELD_RUNTIME', 'ACTIVE_RUNTIME_KIND_ALIAS_INVALID')
    const kind = kindResolution.kind
    if (!kind) return held('HELD_RUNTIME', 'ACTIVE_RUNTIME_KIND_UNKNOWN')
    if (!own(lease, 'offset') || !validOffset(lease.offset)) {
      return held('HELD_RUNTIME', 'ACTIVE_RUNTIME_OFFSET_INVALID')
    }
    if (own(lease, 'lease_id') && !isOpaqueId(lease.lease_id)) {
      return held('HELD_RUNTIME', 'ACTIVE_RUNTIME_LEASE_INVALID')
    }
    validatedLeases.push({ lease, kind })
  }

  const active = validatedLeases.filter(({ lease }) => activeLeaseState(lease))
  const occupiedOffsets = new Set()
  for (const { lease } of active) {
    if (occupiedOffsets.has(lease.offset)) return held('HELD_RUNTIME', 'ACTIVE_RUNTIME_OFFSET_DUPLICATE')
    occupiedOffsets.add(lease.offset)
  }
  const writers = active.filter(({ kind }) => kind === 'writer').length
  const shared = active.filter(({ kind }) => kind === 'integration_train' || kind === 'computer_use')
  if (writers > 2 || shared.length > 1 || active.length > 3) {
    return held('HELD_RUNTIME', 'RUNTIME_CAPACITY_SNAPSHOT_OVERFLOW')
  }

  const mismatch = compareRuntimeIdentity(frozen, request)
  if (mismatch) return held('HELD_RUNTIME', `FROZEN_RUNTIME_${mismatch.toUpperCase()}_MISMATCH`)
  const offset = request.offset ?? frozen?.offset
  if (offset !== undefined && !validOffset(offset)) return held('HELD_RUNTIME', 'OFFSET_INVALID')
  const identity = isPlainObject(frozen) ? { ...frozen, ...request } : request
  if (identity.manifest_sha256 !== undefined && !isSha256(identity.manifest_sha256)) return held('HELD_RUNTIME', 'MANIFEST_HASH_INVALID')
  if (identity.tree_digest !== undefined && !isSha256(identity.tree_digest)) return held('HELD_RUNTIME', 'TREE_DIGEST_INVALID')
  if (identity.runtime_identity_digest !== undefined && !isSha256(identity.runtime_identity_digest)) return held('HELD_RUNTIME', 'RUNTIME_IDENTITY_INVALID')
  if (identity.branch !== undefined && !isOpaqueId(identity.branch)) return held('HELD_RUNTIME', 'BRANCH_IDENTITY_INVALID')
  if (identity.worktree_id !== undefined && !isOpaqueId(identity.worktree_id)) return held('HELD_RUNTIME', 'WORKTREE_IDENTITY_INVALID')
  if (identity.worktree_path_digest !== undefined && !isSha256(identity.worktree_path_digest)) return held('HELD_RUNTIME', 'WORKTREE_PATH_IDENTITY_INVALID')
  const ports = request.ports ?? frozen?.ports
  if (ports !== undefined && !validPorts(ports, offset)) return held('HELD_RUNTIME', 'PORT_SET_INVALID')
  const baseUrls = request.base_urls ?? frozen?.base_urls
  if (baseUrls !== undefined && ports !== undefined && !validBaseUrls(baseUrls, ports)) {
    return held('HELD_RUNTIME', 'BASE_URL_MISMATCH')
  }
  const reserved = new Set([
    ...CANONICAL_RESERVED_PORTS,
    ...(Array.isArray(snapshot.reserved_ports) ? snapshot.reserved_ports : []),
    ...(Array.isArray(request.reserved_ports) ? request.reserved_ports : []),
  ])
  if (ports !== undefined && Object.values(ports).some((port) => reserved.has(port))) {
    return held('HELD_RUNTIME', 'RESERVED_PORT_CONFLICT')
  }
  if (offset !== undefined && occupiedOffsets.has(offset)) return held('HELD_RUNTIME', 'RUNTIME_OFFSET_OCCUPIED')

  const frozenView = Object.keys(runtimeIdentityView(request)).length > 0
    ? runtimeIdentityView(request)
    : (isPlainObject(frozen) ? runtimeIdentityView(frozen) : {})
  if (requestedKind === 'writer' && writers >= 2) {
    return held('QUEUED_FOR_LEASE', 'WRITER_CAPACITY', { runtime_kind: requestedKind, frozen_runtime: frozenView })
  }
  if (requestedKind !== 'writer' && shared.length >= 1) {
    return held('QUEUED_FOR_LEASE', 'SHARED_RUNTIME_SLOT_OCCUPIED', { runtime_kind: requestedKind, frozen_runtime: frozenView })
  }
  return held('ADMITTED', 'RUNTIME_CAPACITY_AVAILABLE', {
    runtime_kind: requestedKind,
    writer_count: writers,
    shared_runtime_count: shared.length,
    frozen_runtime: frozenView,
  })
}

const applicabilityPaths = (change) => {
  if (typeof change === 'string') return [change]
  if (Array.isArray(change)) return change.filter((entry) => typeof entry === 'string')
  if (!isPlainObject(change)) return []
  const values = first(change, ['paths', 'changed_paths', 'files', 'changed_files', 'path'])
  if (typeof values === 'string') return [values]
  return Array.isArray(values) ? values.filter((entry) => typeof entry === 'string') : []
}

const pathIsTrigger = (rawPath) => {
  const path = rawPath.replaceAll('\\', '/').toLowerCase()
  return /(?:^|\/)(?:web-viewer-sample|apps\/|services\/|bim-review-coordinator|bim-streaming-server|governance-service)(?:\/|$)/u.test(path) ||
    /(?:^|\/)(?:e2e|playwright|webrtc|kit|runtime|streaming|conversion|route|workflow|manifest|isolated-branch-stack)(?:\/|[-_.]|$)/u.test(path) ||
    /(?:^|\/)(?:package\.json|playwright[^/]*\.ts|vite[^/]*\.ts)$/u.test(path)
}

const changeTrigger = (change) => {
  const paths = applicabilityPaths(change)
  if (paths.some(pathIsTrigger)) return { required: true, reason: 'USER_FACING_OR_SHARED_RUNTIME_CHANGE' }
  if (isPlainObject(change)) {
    const flags = [
      ['route', 'USER_FACING_ROUTE_CHANGE'], ['routes', 'USER_FACING_ROUTE_CHANGE'], ['workflow', 'USER_FACING_WORKFLOW_CHANGE'],
      ['shared_runtime', 'SHARED_RUNTIME_CHANGE'], ['runtime', 'SHARED_RUNTIME_CHANGE'], ['user_facing', 'USER_FACING_CHANGE'],
      ['ui', 'USER_FACING_CHANGE'], ['browser', 'BROWSER_RUNTIME_CHANGE'], ['policy_requires_e2e', 'POLICY_REQUIRED_E2E'],
    ]
    for (const [key, reason] of flags) if (change[key] === true || (Array.isArray(change[key]) && change[key].length > 0)) return { required: true, reason }
    if (change.scope?.e2e_required === true || change.trusted_e2e_required === true) return { required: true, reason: 'BASE_POLICY_REQUIRED_E2E' }
  }
  return { required: false, reason: 'STATIC_OR_NON_USER_FACING_CHANGE' }
}

const trustedPolicyFailure = (trustedPolicy, baseSha) => {
  if (!isPlainObject(trustedPolicy)) return 'APPLICABILITY_RECORD_MISSING'
  const source = String(first(trustedPolicy, ['source', 'source_kind', 'authority']) || '').toLowerCase()
  if (!TRUSTED_SOURCES.has(source) || trustedPolicy.candidate === true || trustedPolicy.candidate_controlled === true) return 'APPLICABILITY_SOURCE_UNTRUSTED'
  if (trustedPolicy.stale === true || trustedPolicy.expired === true || trustedPolicy.valid === false ||
      String(trustedPolicy.status || '').toLowerCase() === 'stale' || String(trustedPolicy.status || '').toLowerCase() === 'expired') return 'APPLICABILITY_RECORD_STALE'
  if (!isOpaqueId(trustedPolicy.source_ref) ||
      (!isSha1(trustedPolicy.source_sha) && !isSha256(trustedPolicy.source_sha))) return 'APPLICABILITY_RECORD_INVALID'
  if (!isSha1(trustedPolicy.base_sha) || trustedPolicy.base_sha !== baseSha) return 'APPLICABILITY_BASE_DRIFT'
  for (const key of ['pinned_base_sha', 'current_base_sha']) {
    if (trustedPolicy[key] !== undefined && trustedPolicy[key] !== baseSha) return 'APPLICABILITY_BASE_DRIFT'
  }
  if (!isSha256(trustedPolicy.policy_digest) || !isSha256(trustedPolicy.record_digest)) return 'APPLICABILITY_RECORD_INVALID'
  if (trustedPolicy.immutable !== true || trustedPolicy.base_pinned !== true || trustedPolicy.fresh !== true) return 'APPLICABILITY_RECORD_NOT_IMMUTABLE'
  return null
}

/**
 * Classify E2E applicability from a trusted base policy.  Candidate-provided
 * `e2e_required` values are intentionally ignored; they cannot downgrade a
 * base decision (and cannot upgrade a static-only decision either).
 */
export function classifyE2EApplicability({ change, trustedPolicy, baseSha } = {}) {
  if (!isSha1(baseSha) || !safeInput(change) || !safeInput(trustedPolicy)) {
    return held('HELD_EVIDENCE_BINDING', 'APPLICABILITY_INPUT_INVALID')
  }
  const policyFailure = trustedPolicyFailure(trustedPolicy, baseSha)
  if (policyFailure) return held('HELD_EVIDENCE_BINDING', policyFailure)
  const policyDigest = trustedPolicy.policy_digest
  if (!policyDigest) return held('HELD_EVIDENCE_BINDING', 'APPLICABILITY_POLICY_DIGEST_INVALID')
  const trigger = changeTrigger(change)
  const record = {
    schema_version: 'e2e-applicability/v1',
    source: 'base',
    source_ref: trustedPolicy.source_ref,
    source_sha: trustedPolicy.source_sha,
    base_sha: baseSha,
    policy_digest: policyDigest,
    source_record_digest: trustedPolicy.record_digest,
    change_digest: safeDigest(change),
    e2e_required: trigger.required,
    reason: trigger.reason,
    immutable: true,
    base_pinned: true,
    fresh: true,
  }
  if (!record.change_digest) return held('HELD_EVIDENCE_BINDING', 'APPLICABILITY_CHANGE_DIGEST_INVALID')
  const frozenRecord = freezeCopy(record)
  const recordDigest = digestCanonical(frozenRecord)
  return freezeCopy({
    status: trigger.required ? 'E2E_REQUIRED' : 'E2E_NOT_APPLICABLE',
    e2e_required: trigger.required,
    base_sha: baseSha,
    source: 'base',
    record: frozenRecord,
    applicability: frozenRecord,
    record_digest: recordDigest,
    immutable: true,
  })
}

const candidateHeads = (plan) => {
  const direct = first(plan, ['candidate_heads', 'ordered_candidate_heads', 'ordered_input_shas', 'input_shas'])
  const values = direct ?? (Array.isArray(plan?.ordered_inputs) ? plan.ordered_inputs : null)
  if (Array.isArray(values)) {
    const heads = values.map((value) => isPlainObject(value) ? first(value, ['head_sha', 'candidate_head_sha', 'sha']) : value)
    return heads.every(isSha1) ? heads : null
  }
  if (Array.isArray(plan?.candidates)) {
    const heads = plan.candidates.map((value) => isPlainObject(value) ? first(value, ['head_sha', 'candidate_head_sha', 'sha']) : value)
    return heads.every(isSha1) ? heads : null
  }
  if (Array.isArray(plan?.tasks)) {
    const heads = plan.tasks.map((value) => first(value, ['head_sha', 'candidate_head_sha', 'candidate_sha']) ?? first(value?.candidate, ['head_sha', 'candidate_head_sha']))
    return heads.every(isSha1) ? heads : null
  }
  return null
}

const trainFailure = (reason, extras = {}) => held('HELD_EVIDENCE_BINDING', reason, {
  phase: 'CLOSED',
  internal_state: 'TRAIN_EVIDENCE_INVALID',
  merge_candidate: false,
  deploy_candidate: false,
  ...extras,
})

/**
 * Build a throw-away integration-train record from exact, ordered inputs.
 * The returned wrapper follows the stack/queue adapters' phase vocabulary;
 * `train` itself is the closed `integration-train/v1` durable record.
 */
export function createIntegrationTrain(plan = {}, trustedClock = undefined) {
  if (!isPlainObject(plan) || !safeInput(plan)) return trainFailure('TRAIN_INPUT_INVALID')
  const observedAt = trustedClockNow(trustedClock)
  if (observedAt === undefined) return trainFailure('TRAIN_WINDOW_INVALID')
  const baseRef = first(plan, ['integration_base_ref', 'baseline_ref', 'base_ref'])
  const baseSha = first(plan, ['integration_base_sha', 'resolved_baseline_sha', 'base_sha'])
  if (!isOpaqueId(baseRef) || !isSha1(baseSha)) return trainFailure('TRAIN_BASE_INVALID')
  for (const key of ['observed_base_sha', 'current_base_sha', 'baseline_observed_sha']) {
    if (plan[key] !== undefined && plan[key] !== baseSha) return trainFailure('BASE_SHA_DRIFT')
  }
  const heads = candidateHeads(plan)
  if (!Array.isArray(heads) || heads.length === 0 || new Set(heads).size !== heads.length) return trainFailure('ORDERED_INPUTS_INVALID')
  for (const key of ['observed_candidate_heads', 'current_candidate_heads', 'ordered_input_observed_shas']) {
    if (plan[key] !== undefined && (!Array.isArray(plan[key]) || !equalCanonical(plan[key], heads))) return trainFailure('ORDERED_INPUT_SHA_DRIFT')
  }
  if (plan.input_sha_drift === true || plan.candidate_push_detected === true || plan.baseline_drift === true) {
    return trainFailure(plan.baseline_drift === true ? 'BASE_SHA_DRIFT' : 'ORDERED_INPUT_SHA_DRIFT')
  }
  if (plan.is_merge_candidate === true || plan.merge_candidate === true || plan.deploy_candidate === true ||
      plan.canonical_deploy_source === true || plan.promotion_eligible === true || plan.is_promotion_source === true) {
    return trainFailure('TRAIN_NOT_PROMOTION_SOURCE')
  }
  const runtimeManifest = first(plan, ['runtime_manifest_digest', 'manifest_sha256', 'runtime_digest']) ??
    first(first(plan, ['runtime_manifest', 'manifest']), ['manifest_sha256', 'manifest_digest', 'sha256'])
  if (!isSha256(runtimeManifest)) return trainFailure('TRAIN_MANIFEST_DIGEST_INVALID')
  const generation = first(plan, ['generation', 'train_generation'])
  if (!Number.isSafeInteger(generation) || generation < 1) return trainFailure('TRAIN_GENERATION_INVALID')
  const trainId = first(plan, ['train_id', 'integration_train_id']) || `train:${digestCanonical({
    plan_id: first(plan, ['plan_id']) || 'plan:unknown', generation, baseSha, heads,
  }).slice(0, 40)}`
  if (!isOpaqueId(trainId)) return trainFailure('TRAIN_ID_INVALID')
  const dependencyEdgesInput = first(plan, ['dependency_edges', 'dependencies', 'ordered_dependency_edges'])
  const dependencyEdges = dependencyEdgesInput ?? []
  const dependencyDigestInput = first(plan, ['dependency_edges_digest'])
  const dependencyDigest = dependencyDigestInput || safeDigest(dependencyEdges)
  if (dependencyEdgesInput !== undefined && dependencyDigestInput !== undefined && dependencyDigest !== safeDigest(dependencyEdges)) {
    return trainFailure('TRAIN_DEPENDENCY_DIGEST_DRIFT')
  }
  const checksInput = first(plan, ['checks'])
  const checksDigestInput = first(plan, ['checks_digest'])
  const checksDigest = checksDigestInput || safeDigest(checksInput ?? [])
  if (checksInput !== undefined && checksDigestInput !== undefined && checksDigest !== safeDigest(checksInput)) {
    return trainFailure('TRAIN_CHECKS_DIGEST_DRIFT')
  }
  if (!isSha256(dependencyDigest) || !isSha256(checksDigest)) return trainFailure('TRAIN_DIGEST_INVALID')
  const synthetic = first(plan, ['synthetic_integration_sha', 'synthetic_sha']) || sha1From({ baseSha, heads, generation })
  if (!isSha1(synthetic)) return trainFailure('TRAIN_SYNTHETIC_SHA_INVALID')
  for (const key of ['observed_synthetic_integration_sha', 'current_synthetic_integration_sha', 'observed_synthetic_sha']) {
    if (plan[key] !== undefined && plan[key] !== synthetic) return trainFailure('SYNTHETIC_SHA_DRIFT')
  }
  for (const key of ['observed_runtime_manifest_digest', 'current_runtime_manifest_digest', 'observed_manifest_sha256']) {
    if (plan[key] !== undefined && plan[key] !== runtimeManifest) return trainFailure('RUNTIME_MANIFEST_DRIFT')
  }
  if (plan.synthetic_sha_drift === true) return trainFailure('SYNTHETIC_SHA_DRIFT')
  if (plan.runtime_manifest_drift === true) return trainFailure('RUNTIME_MANIFEST_DRIFT')
  const createdAt = first(plan, ['created_at', 'started_at'])
  const expiresAt = first(plan, ['expires_at', 'ends_at'])
  if (!isTimestamp(createdAt) || !isTimestamp(expiresAt) || expiresAt <= createdAt || observedAt < createdAt || observedAt >= expiresAt) {
    return trainFailure('TRAIN_WINDOW_INVALID')
  }
  const failures = first(plan, ['interaction_failure_refs', 'failure_refs']) ?? []
  if (!Array.isArray(failures) || failures.some((value) => !isOpaqueId(value)) || new Set(failures).size !== failures.length) return trainFailure('TRAIN_FAILURE_REFS_INVALID')
  const train = {
    schema_version: 'integration-train/v1',
    train_id: trainId,
    generation,
    integration_base_ref: baseRef,
    integration_base_sha: baseSha,
    candidate_heads: [...heads],
    dependency_edges_digest: dependencyDigest,
    synthetic_integration_sha: synthetic,
    runtime_manifest_digest: runtimeManifest,
    checks_digest: checksDigest,
    interaction_failure_refs: [...failures],
    created_at: createdAt,
    expires_at: expiresAt,
  }
  const frozenTrain = freezeCopy(train)
  return freezeCopy({
    phase: 'READY_FOR_TRAIN',
    internal_state: 'TRAIN_REQUEST_READY',
    status: 'READY_FOR_TRAIN',
    train: frozenTrain,
    train_id: frozenTrain.train_id,
    integration_base_ref: frozenTrain.integration_base_ref,
    integration_base_sha: frozenTrain.integration_base_sha,
    candidate_heads: frozenTrain.candidate_heads,
    ordered_input_shas: frozenTrain.candidate_heads,
    merge_candidate: false,
    deploy_candidate: false,
  })
}

const bindingHold = (reason, candidate, extras = {}) => held('HELD_EVIDENCE_BINDING', reason, {
  phase: 'CLOSED',
  internal_state: 'E2E_EVIDENCE_INVALID',
  candidate_id: first(candidate, ['candidate_id', 'id']) || null,
  freeze_scope: 'candidate',
  other_candidates_continue: true,
  promotion_eligible: false,
  ...extras,
})

const packetHead = (packet) => first(packet, ['head_sha', 'candidate_head_sha', 'subject_sha'])
const packetTree = (packet) => first(packet, ['tree_digest', 'candidate_tree_digest', 'worktree_tree_digest'])
const packetManifestHash = (packet) => first(packet, ['manifest_sha256', 'manifest_digest', 'stack_manifest_digest'])
const packetRuntimeDigest = (packet) => first(packet, ['runtime_identity_digest', 'runtime_digest', 'runtime_lineage_digest'])
const trustedVerifierSha = (pins) => first(pins, ['verifier_sha', 'trusted_verifier_sha'])
const trustedBinderSha = (pins) => first(pins, ['binder_sha', 'trusted_binder_sha'])
const ownDataValue = (value, key) => {
  if (!isPlainObject(value) || utilTypes.isProxy(value) || !own(value, key)) return undefined
  const descriptor = Object.getOwnPropertyDescriptor(value, key)
  return descriptor?.enumerable === true && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined
}
const listenerDigest = (packet) => {
  const value = ownDataValue(packet, 'listener_digest')
  return isSha256(value) ? value : null
}

const validExecutionWindow = (value) => {
  if (!isPlainObject(value)) return null
  const keys = Object.keys(value)
  if (keys.some((key) => !['started_at', 'finished_at'].includes(key))) return null
  const startedAt = first(value, ['started_at'])
  const finishedAt = first(value, ['finished_at'])
  if (!isTimestamp(startedAt) || !isTimestamp(finishedAt) || finishedAt < startedAt) return null
  return { started_at: startedAt, finished_at: finishedAt }
}

const lifecycleHashFailure = (value, expected) => {
  for (const aliases of [
    ['manifest_sha256_at_start', 'manifest_start_sha256'],
    ['manifest_sha256_at_publication', 'manifest_publication_sha256', 'publication_manifest_sha256'],
  ]) {
    const observations = aliases.filter((key) => own(value, key)).map((key) => value[key])
    if (observations.length === 0 || observations.some((observation) => !isSha256(observation) || observation !== expected)) return true
  }
  return false
}

const authorityPacket = (packet) => first(packet, ['authority', 'authority_packet', 'verifier_authority'])

const computerUseAuthorityFailure = (packet, trustedPins) => {
  if (COMPUTER_USE_DENIED_CAPABILITIES.some((key) => own(packet, key))) return 'COMPUTER_USE_AUTHORITY_INVALID'
  const authority = authorityPacket(packet)
  if (authority === undefined) return 'COMPUTER_USE_AUTHORITY_MISSING'
  if (!isPlainObject(authority) || Object.keys(authority).some((key) => !COMPUTER_USE_AUTHORITY_KEYS.has(key))) {
    return 'COMPUTER_USE_AUTHORITY_INVALID'
  }
  const required = [
    'schema_version', 'source', 'source_ref', 'source_sha', 'base_sha', 'authority_digest',
    'verifier_identity', 'immutable', 'base_pinned', 'fresh', 'read_only',
    ...COMPUTER_USE_DENIED_CAPABILITIES,
  ]
  if (required.some((key) => !own(authority, key))) return 'COMPUTER_USE_AUTHORITY_INVALID'
  if (authority.schema_version !== 'computer-use-authority/v1' ||
      !TRUSTED_SOURCES.has(String(authority.source).toLowerCase()) ||
      String(authority.source).toLowerCase().includes('candidate') ||
      !isOpaqueId(authority.source_ref) ||
      (!isSha1(authority.source_sha) && !isSha256(authority.source_sha)) ||
      !isSha1(authority.base_sha) ||
      !isSha256(authority.authority_digest) ||
      !isOpaqueRef(authority.verifier_identity) ||
      authority.immutable !== true || authority.base_pinned !== true || authority.fresh !== true ||
      authority.read_only !== true) return 'COMPUTER_USE_AUTHORITY_INVALID'
  const packetIdentity = first(packet, ['verifier_identity', 'verifier_id', 'owner_session'])
  if (authority.verifier_identity !== packetIdentity) return 'COMPUTER_USE_AUTHORITY_IDENTITY_MISMATCH'
  const pinSource = String(first(trustedPins, ['source', 'source_kind', 'authority']) || '').toLowerCase()
  if (String(authority.source).toLowerCase() !== pinSource ||
      authority.source_ref !== trustedPins.source_ref || authority.source_sha !== trustedPins.source_sha ||
      authority.base_sha !== trustedPins.base_sha || authority.authority_digest !== trustedPins.authority_digest) {
    return 'COMPUTER_USE_AUTHORITY_INVALID'
  }
  for (const key of COMPUTER_USE_DENIED_CAPABILITIES) {
    if (authority[key] !== false || typeof authority[key] !== 'boolean') return 'COMPUTER_USE_AUTHORITY_INVALID'
  }
  return null
}

const normalizedRealFlag = (packet) => packet?.e2e_require_real === true || packet?.e2e_require_real === 1 || packet?.e2e_require_real === '1' ||
  packet?.E2E_REQUIRE_REAL === true || packet?.E2E_REQUIRE_REAL === 1 || packet?.E2E_REQUIRE_REAL === '1' ||
  packet?.e2eRequireReal === true || packet?.e2eRequireReal === 1 || packet?.e2eRequireReal === '1'
const bypassMode = (packet) => first(packet, ['mode', 'e2e_mode', 'verification_mode'])
const E2E_BYPASS_MODES = new Set(['skip', 'skipped', 'mock', 'simulation', 'bypass'])

const packetFailure = (packet, expectedRole, trustedPins) => {
  if (!isPlainObject(packet)) return expectedRole === 'playwright' ? 'PLAYWRIGHT_PACKET_MISSING' : 'COMPUTER_USE_PACKET_MISSING'
  const role = String(first(packet, ['verifier_role', 'role', 'verifier']) || '').toLowerCase().replaceAll('-', '_')
  if (expectedRole === 'playwright' && !['playwright', 'canonical_playwright', 'playwright_require_real'].includes(role)) return 'PLAYWRIGHT_ROLE_INVALID'
  if (expectedRole === 'computer_use' && !['computer_use', 'computeruse'].includes(role)) return 'COMPUTER_USE_ROLE_INVALID'
  if (packet.timed_out === true || packet.timeout === true || packet.status === 'timeout' ||
      (Number.isSafeInteger(packet.duration_ms) && Number.isSafeInteger(trustedPins.timeout_ms) && packet.duration_ms > trustedPins.timeout_ms)) {
    return 'E2E_TIMEOUT'
  }
  if (packet.skipped === true || packet.status === 'skipped' || packet.skipped_count > 0) return 'E2E_SKIPPED'
  if (typeof bypassMode(packet) === 'string' && E2E_BYPASS_MODES.has(bypassMode(packet).trim().toLowerCase())) return 'E2E_MODE_BYPASS'
  if (!normalizedRealFlag(packet) || first(packet, ['manifest_present', 'manifestPresent']) !== true) return 'REQUIRE_REAL_MANIFEST_MISSING'
  if (!['passed', 'success', 'ok'].includes(String(packet.status || '').toLowerCase())) {
    return expectedRole === 'playwright' ? 'PLAYWRIGHT_FAILED' : 'COMPUTER_USE_FAILED'
  }
  if (packet.reserved_port_guard !== 'clean' && packet.reserved_port_guard !== true) return 'RESERVED_PORT_GUARD_FAILED'
  if (packet.candidate_harness_status === 'modified' || packet.verification_mode === 'shadow') return 'CANDIDATE_HARNESS_MODIFIED'
  return null
}

const packetIdentityFailure = (packet, expected, trustedPins) => {
  const fields = [
    ['stack_kind', first(packet, ['stack_kind']), expected.stack_kind, 'STACK_KIND_MISMATCH'],
    ['head_sha', packetHead(packet), expected.head_sha, 'EXACT_HEAD_MISMATCH'],
    ['tree_digest', packetTree(packet), expected.tree_digest, 'TREE_DIGEST_MISMATCH'],
    ['manifest_sha256', packetManifestHash(packet), expected.manifest_sha256, 'MANIFEST_HASH_MISMATCH'],
    ['runtime_identity_digest', packetRuntimeDigest(packet), expected.runtime_identity_digest, 'RUNTIME_IDENTITY_DRIFT'],
    ['branch', first(packet, ['branch']), expected.branch, 'BRANCH_IDENTITY_MISMATCH'],
    ['worktree_id', first(packet, ['worktree_id']), expected.worktree_id, 'WORKTREE_IDENTITY_MISMATCH'],
    ['worktree_path_digest', first(packet, ['worktree_path_digest']), expected.worktree_path_digest, 'WORKTREE_PATH_IDENTITY_MISMATCH'],
  ]
  for (const [, actual, wanted, reason] of fields) if (actual !== wanted) return reason
  if (pathIdentity(packet) !== expected.manifest_path_digest) return 'MANIFEST_PATH_MISMATCH'
  if (first(packet, ['offset']) !== expected.offset) return 'OFFSET_MISMATCH'
  if (!own(packet, 'ports') || !equalCanonical(packet.ports, expected.ports)) return 'PORT_SET_MISMATCH'
  if (!own(packet, 'base_urls') || !equalCanonical(packet.base_urls, expected.base_urls)) return 'BASE_URL_MISMATCH'
  for (const [key, aliases] of [
    ['trusted_verifier_sha', ['trusted_verifier_sha', 'verifier_sha']],
    ['trusted_binder_sha', ['trusted_binder_sha', 'binder_sha']],
  ]) {
    const actual = first(packet, aliases)
    const expectedPin = key === 'trusted_verifier_sha' ? trustedVerifierSha(trustedPins) : trustedBinderSha(trustedPins)
    if (!isSha256(actual) || actual !== expectedPin) return 'TRUSTED_SOURCE_REQUIRED'
  }
  if (first(packet, ['verifier_tree_digest', 'trusted_verifier_tree_digest']) !== trustedPins.verifier_tree_digest) return 'TRUSTED_SOURCE_REQUIRED'
  if (first(packet, ['harness_digest', 'canonical_harness_digest']) !== trustedPins.harness_digest) return 'TRUSTED_SOURCE_REQUIRED'
  return null
}

const artifactHashFailure = (packet) => {
  for (const [declaredKeys, actualKeys, reason] of [
    [['screenshot_sha256', 'screenshot_hash'], ['screenshot_artifact_sha256', 'screenshot_actual_sha256'], 'SCREENSHOT_HASH_MISMATCH'],
    [['trace_sha256', 'trace_hash'], ['trace_artifact_sha256', 'trace_actual_sha256'], 'TRACE_HASH_MISMATCH'],
  ]) {
    const declared = first(packet, declaredKeys)
    if (!isSha256(declared)) return `${declaredKeys[0].toUpperCase()}_INVALID`
    for (const alias of declaredKeys) {
      if (own(packet, alias) && packet[alias] !== declared) return reason
    }
    const actual = first(packet, actualKeys)
    if (actual !== undefined && actual !== declared) return reason
  }
  return null
}

const packetCompletenessFailure = (packet) => {
  const route = first(packet, ['route'])
  const buttons = first(packet, ['main_buttons', 'buttons', 'main_button'])
  const fixture = first(packet, ['fixture', 'fixture_reference'])
  const api = first(packet, ['api', 'backend_api', 'api_reference'])
  const runtimeId = first(packet, ['runtime_id', 'runtime_reference'])
  const visible = first(packet, ['visible_state', 'visible_states'])
  const network = first(packet, ['network_digest', 'network_result', 'network'])
  if (typeof route !== 'string' || route.length === 0) return 'EVIDENCE_ROUTE_MISSING'
  if (!Array.isArray(buttons) || buttons.length === 0 || buttons.length > 64 ||
      buttons.some((button) => typeof button !== 'string' || button.length === 0)) return 'EVIDENCE_BUTTON_MISSING'
  if (typeof fixture !== 'string' || fixture.length === 0) return 'EVIDENCE_FIXTURE_MISSING'
  if (typeof api !== 'string' || api.length === 0) return 'EVIDENCE_API_MISSING'
  if (typeof runtimeId !== 'string' || runtimeId.length === 0) return 'EVIDENCE_RUNTIME_ID_MISSING'
  if (typeof visible !== 'string' || visible.length === 0) return 'EVIDENCE_VISIBLE_STATE_MISSING'
  if (network === undefined || network === null) return 'EVIDENCE_NETWORK_MISSING'
  if (!listenerDigest(packet)) return 'LISTENER_DIGEST_INVALID'
  if (!isSha256(first(packet, ['command_records_digest', 'command_lineage_digest'])) ||
      !isSha256(first(packet, ['runtime_lineage_digest', 'runtime_identity_digest']))) return 'EVIDENCE_COMMAND_LINEAGE_MISSING'
  return null
}

const commandRecordFailure = (packets) => {
  if (packets.some((packet) => !Array.isArray(packet?.command_records) || packet.command_records.length === 0)) return 'COMMAND_RECORDS_MISSING'
  const records = packets.flatMap((packet) => packet.command_records)
  const roles = new Set()
  for (const record of records) {
    if (!isPlainObject(record) || !safeInput(record) || typeof record.role !== 'string' || record.role.length === 0) return 'COMMAND_RECORD_INVALID'
    roles.add(record.role)
    const cwd = first(record, ['cwd_digest', 'resolved_cwd_digest', 'resolved_cwd'])
    const argv = first(record, ['argv_digest', 'safe_argv_digest', 'argv'])
    const environment = first(record, ['safe_environment_contract', 'environment_contract'])
    const startedAt = first(record, ['started_at', 'start_time'])
    const finishedAt = first(record, ['finished_at', 'end_time'])
    const stdout = first(record, ['stdout_artifact_ref', 'stdout_artifact_reference', 'stdout_ref'])
    const stderr = first(record, ['stderr_artifact_ref', 'stderr_artifact_reference', 'stderr_ref'])
    const redaction = first(record, ['redaction_status', 'redacted'])
    const hasCwd = isSha256(cwd) || (typeof cwd === 'string' && cwd.length > 0)
    const hasArgv = isSha256(argv) || (typeof argv === 'string' && argv.length > 0) || (Array.isArray(argv) && argv.length > 0)
    if (!hasCwd || !hasArgv || typeof environment !== 'string' || environment.length === 0 ||
        !isTimestamp(startedAt) || !isTimestamp(finishedAt) || finishedAt < startedAt ||
        !Number.isSafeInteger(record.exit_code) || typeof stdout !== 'string' || stdout.length === 0 ||
        typeof stderr !== 'string' || stderr.length === 0 ||
        (typeof redaction !== 'string' && typeof redaction !== 'boolean') || redaction === '') return 'COMMAND_RECORD_INVALID'
  }
  for (const required of REQUIRED_COMMAND_ROLES) if (!roles.has(required)) return 'COMMAND_RECORDS_INCOMPLETE'
  return null
}

const sanitizedNetworkDigest = (packet) => {
  const supplied = first(packet, ['network_digest', 'network_sha256'])
  if (supplied !== undefined) return isSha256(supplied) ? supplied : null
  const value = first(packet, ['network_result', 'network'])
  return value === undefined ? null : safeDigest(value)
}

/**
 * Bind canonical require-real Playwright evidence and the distinct Computer
 * Use verifier to one exact candidate.  Every failure is candidate-local so
 * unrelated writers remain eligible; no result from a modified candidate
 * harness is promotion-eligible.
 */
export function bindBrowserEvidence({ candidate, manifest, playwright, computerUse, trustedPins } = {}) {
  const candidateId = first(candidate, ['candidate_id', 'id']) || null
  const allowRawManifestPaths = (value) => safeInput(value)
  if (!allowRawManifestPaths(candidate) || !allowRawManifestPaths(manifest) || !allowRawManifestPaths(playwright) ||
      !allowRawManifestPaths(computerUse) || !allowRawManifestPaths(trustedPins)) {
    return bindingHold('EVIDENCE_INPUT_UNSAFE', candidate)
  }
  if (!isPlainObject(candidate) || !isPlainObject(manifest) || !isPlainObject(playwright) || !isPlainObject(computerUse) || !isPlainObject(trustedPins)) {
    return bindingHold('EVIDENCE_INPUT_INVALID', candidate)
  }
  if (['authority', 'authority_packet', 'verifier_authority', 'computer_use_authority'].some((key) => own(candidate, key))) {
    return bindingHold('COMPUTER_USE_AUTHORITY_CANDIDATE_CLAIM', candidate)
  }
  const candidateHead = first(candidate, ['head_sha', 'candidate_head_sha', 'subject_sha'])
  const candidateTree = first(candidate, ['tree_digest', 'candidate_tree_digest'])
  const candidateManifest = first(candidate, ['manifest_sha256', 'manifest_digest'])
  const candidateRuntime = first(candidate, ['runtime_identity_digest', 'runtime_digest'])
  if (!isSha1(candidateHead) || !isSha256(candidateTree) || !isSha256(candidateManifest) || !isSha256(candidateRuntime)) return bindingHold('CANDIDATE_IDENTITY_INVALID', candidate)
  const candidateBranch = first(candidate, ['branch'])
  const candidateWorktree = first(candidate, ['worktree_id'])
  const candidateWorktreePath = first(candidate, ['worktree_path_digest'])
  if (!isOpaqueId(candidateBranch) || !isOpaqueId(candidateWorktree) || !isSha256(candidateWorktreePath)) return bindingHold('CANDIDATE_IDENTITY_INVALID', candidate)
  const candidatePathDigest = pathIdentity(candidate)
  if (!isSha256(candidatePathDigest)) return bindingHold('MANIFEST_PATH_IDENTITY_MISSING', candidate)
  const applicability = first(candidate, ['applicability', 'e2e_applicability', 'applicability_record'])
  if (!isPlainObject(applicability)) return bindingHold('APPLICABILITY_RECORD_MISSING', candidate)
  if (String(applicability.source || '').toLowerCase() !== 'base' || applicability.candidate === true || applicability.candidate_controlled === true) return bindingHold('APPLICABILITY_SOURCE_UNTRUSTED', candidate)
  const applicabilityRequired = [
    'schema_version', 'source_ref', 'source_sha', 'base_sha', 'policy_digest', 'record_digest',
    'e2e_required', 'immutable', 'base_pinned', 'fresh',
  ]
  if (applicabilityRequired.some((key) => !own(applicability, key))) return bindingHold('APPLICABILITY_RECORD_INVALID', candidate)
  if (applicability.schema_version !== 'e2e-applicability/v1' ||
      !isOpaqueId(applicability.source_ref) ||
      (!isSha1(applicability.source_sha) && !isSha256(applicability.source_sha)) ||
      !isSha1(applicability.base_sha) ||
      !isSha256(applicability.policy_digest) ||
      !isSha256(applicability.record_digest) ||
      applicability.immutable !== true || applicability.base_pinned !== true || applicability.fresh !== true) {
    return bindingHold('APPLICABILITY_RECORD_INVALID', candidate)
  }
  if (applicability.base_sha !== first(candidate, ['base_sha', 'resolved_base_sha']) || applicability.e2e_required !== true) return bindingHold('APPLICABILITY_RECORD_STALE', candidate)
  const { record_digest: applicabilityDigest, ...applicabilityPayload } = applicability
  if (digestCanonical(applicabilityPayload) !== applicabilityDigest) return bindingHold('APPLICABILITY_RECORD_DIGEST_MISMATCH', candidate)

  const manifestSchema = first(manifest, ['schema_version'])
  const manifestStack = first(manifest, ['stack_kind'])
  const manifestHead = first(manifest, ['head_sha', 'candidate_head_sha'])
  const manifestHash = first(manifest, ['manifest_sha256', 'manifest_digest', 'bytes_sha256', 'sha256'])
  const manifestPathDigest = pathIdentity(manifest)
  const manifestTree = first(manifest, ['tree_digest', 'candidate_tree_digest', 'worktree_tree_digest'])
  const manifestBranch = first(manifest, ['branch'])
  const manifestWorktree = first(manifest, ['worktree_id'])
  const manifestWorktreePath = first(manifest, ['worktree_path_digest'])
  const manifestOffset = first(manifest, ['offset'])
  const manifestPorts = first(manifest, ['ports'])
  const manifestBaseUrls = first(manifest, ['base_urls'])
  const manifestRuntime = first(manifest, ['runtime_identity_digest', 'runtime_digest', 'runtime_lineage_digest'])
  if (manifestSchema !== 'isolated-branch-stack/v1' || manifestStack !== 'isolated_branch_stack') return bindingHold('MANIFEST_SCHEMA_INVALID', candidate)
  if (!isSha1(manifestHead) || manifestHead !== candidateHead) return bindingHold('EXACT_HEAD_MISMATCH', candidate)
  if (!isSha256(manifestHash) || manifestHash !== candidateManifest) return bindingHold('MANIFEST_HASH_MISMATCH', candidate)
  if (lifecycleHashFailure(manifest, manifestHash)) return bindingHold('MANIFEST_LIFECYCLE_INVALID', candidate)
  if (!isSha256(manifestPathDigest) || manifestPathDigest !== candidatePathDigest) return bindingHold('MANIFEST_PATH_MISMATCH', candidate)
  if (!isSha256(manifestTree) || manifestTree !== candidateTree) return bindingHold('TREE_DIGEST_MISMATCH', candidate)
  if (manifestBranch !== candidateBranch) return bindingHold('BRANCH_IDENTITY_MISMATCH', candidate)
  if (manifestWorktree !== candidateWorktree) return bindingHold('WORKTREE_IDENTITY_MISMATCH', candidate)
  if (manifestWorktreePath !== candidateWorktreePath) return bindingHold('WORKTREE_PATH_IDENTITY_MISMATCH', candidate)
  if (!validOffset(manifestOffset) || !validPorts(manifestPorts, manifestOffset) || !validBaseUrls(manifestBaseUrls, manifestPorts)) return bindingHold('MANIFEST_RUNTIME_MAPPING_INVALID', candidate)
  if (!isSha256(manifestRuntime) || manifestRuntime !== candidateRuntime) return bindingHold('RUNTIME_IDENTITY_DRIFT', candidate)
  const manifestId = own(manifest, 'manifest_id')
    ? ownDataValue(manifest, 'manifest_id')
    : `manifest:sha256:${manifestHash.slice(0, 40)}:bound`
  if (!isOpaqueId(manifestId)) return bindingHold('MANIFEST_ID_INVALID', candidate)
  const manifestExecutionWindow = validExecutionWindow(first(manifest, ['execution_window']))
  if (!manifestExecutionWindow) return bindingHold('EXECUTION_WINDOW_REQUIRED', candidate)

  const pinSource = String(first(trustedPins, ['source', 'source_kind', 'authority']) || '').toLowerCase()
  const trustedPinRequired = ['source_ref', 'source_sha', 'base_sha', 'policy_digest', 'applicability_record_digest', 'immutable', 'base_pinned', 'fresh', 'authority_digest']
  if (!TRUSTED_SOURCES.has(pinSource) || trustedPins.candidate === true || trustedPins.candidate_controlled === true ||
      trustedPinRequired.some((key) => !own(trustedPins, key)) ||
      !isOpaqueId(trustedPins.source_ref) ||
      (!isSha1(trustedPins.source_sha) && !isSha256(trustedPins.source_sha)) ||
      !isSha1(trustedPins.base_sha) || !isSha256(trustedPins.policy_digest) ||
      !isSha256(trustedPins.applicability_record_digest) || !isSha256(trustedPins.authority_digest) ||
      !isSha256(trustedVerifierSha(trustedPins)) || !isSha256(trustedBinderSha(trustedPins)) ||
      !isSha256(trustedPins.verifier_tree_digest) || !isSha256(trustedPins.harness_digest)) return bindingHold('TRUSTED_SOURCE_REQUIRED', candidate)
  if (trustedPins.stale === true || String(trustedPins.status || '').toLowerCase() === 'stale' ||
      trustedPins.immutable !== true || trustedPins.base_pinned !== true || trustedPins.fresh !== true) return bindingHold('TRUSTED_SOURCE_STALE', candidate)
  if (trustedPins.base_sha !== first(candidate, ['base_sha', 'resolved_base_sha'])) return bindingHold('TRUSTED_SOURCE_BASE_MISMATCH', candidate)
  if (trustedPins.source_ref !== applicability.source_ref || trustedPins.source_sha !== applicability.source_sha ||
      trustedPins.policy_digest !== applicability.policy_digest || trustedPins.applicability_record_digest !== applicability.record_digest) {
    return bindingHold('APPLICABILITY_RECORD_MISMATCH', candidate)
  }

  const roleFailure = packetFailure(playwright, 'playwright', trustedPins) || packetFailure(computerUse, 'computer_use', trustedPins)
  if (roleFailure === 'CANDIDATE_HARNESS_MODIFIED' || candidate.harness_modified === true || candidate.candidate_harness_status === 'modified') {
    return held('SHADOW_ONLY', 'CANDIDATE_HARNESS_MODIFIED', {
      phase: 'CLOSED', internal_state: 'E2E_SHADOW_ONLY', candidate_id: candidateId,
      freeze_scope: 'candidate', other_candidates_continue: true, promotion_eligible: false, verification_mode: 'shadow',
    })
  }
  if (roleFailure) return bindingHold(roleFailure, candidate)
  const authorityFailure = computerUseAuthorityFailure(computerUse, trustedPins)
  if (authorityFailure) return bindingHold(authorityFailure, candidate)
  const expected = {
    head_sha: candidateHead,
    tree_digest: candidateTree,
    manifest_sha256: candidateManifest,
    manifest_path_digest: manifestPathDigest,
    runtime_identity_digest: candidateRuntime,
    branch: candidateBranch,
    worktree_id: candidateWorktree,
    worktree_path_digest: candidateWorktreePath,
    stack_kind: manifestStack,
    offset: manifestOffset,
    ports: manifestPorts,
    base_urls: manifestBaseUrls,
  }
  const packetExecutionWindows = []
  for (const packet of [playwright, computerUse]) {
    const identityFailure = packetIdentityFailure(packet, expected, trustedPins)
    if (identityFailure) return bindingHold(identityFailure, candidate)
    const artifactFailure = artifactHashFailure(packet)
    if (artifactFailure) return bindingHold(artifactFailure, candidate)
    const completenessFailure = packetCompletenessFailure(packet)
    if (completenessFailure) return bindingHold(completenessFailure, candidate)
    if (lifecycleHashFailure(packet, manifestHash)) return bindingHold('MANIFEST_LIFECYCLE_INVALID', candidate)
    const packetWindow = validExecutionWindow(first(packet, ['execution_window']))
    if (!packetWindow) return bindingHold('EXECUTION_WINDOW_REQUIRED', candidate)
    if (!equalCanonical(packetWindow, manifestExecutionWindow)) return bindingHold('EXECUTION_WINDOW_MISMATCH', candidate)
    packetExecutionWindows.push(packetWindow)
  }
  const playwrightListenerDigest = listenerDigest(playwright)
  const computerUseListenerDigest = listenerDigest(computerUse)
  if (playwrightListenerDigest !== computerUseListenerDigest) return bindingHold('LISTENER_DIGEST_MISMATCH', candidate)
  const computerUseIdentity = first(computerUse, ['verifier_identity', 'verifier_id', 'owner_session'])
  const writerIdentity = first(candidate, ['owner_session', 'writer_session', 'provider_session_id'])
  const playwrightIdentity = first(playwright, ['verifier_identity', 'verifier_id'])
  if (!isOpaqueRef(computerUseIdentity) || !isOpaqueRef(writerIdentity) || !isOpaqueRef(playwrightIdentity) ||
      computerUseIdentity === writerIdentity || computerUseIdentity === playwrightIdentity ||
      /(?:writer|candidate)/iu.test(computerUseIdentity)) return bindingHold('ROLE_SEPARATION_VIOLATION', candidate)
  const playwrightCommandDigest = first(playwright, ['command_records_digest', 'command_lineage_digest'])
  const computerUseCommandDigest = first(computerUse, ['command_records_digest', 'command_lineage_digest'])
  const playwrightRuntimeLineage = first(playwright, ['runtime_lineage_digest', 'runtime_identity_digest'])
  const computerUseRuntimeLineage = first(computerUse, ['runtime_lineage_digest', 'runtime_identity_digest'])
  if (playwrightCommandDigest !== computerUseCommandDigest || playwrightRuntimeLineage !== computerUseRuntimeLineage) return bindingHold('COMMAND_OR_RUNTIME_LINEAGE_MISMATCH', candidate)
  if (!equalCanonical(packetExecutionWindows[0], packetExecutionWindows[1])) return bindingHold('EXECUTION_WINDOW_MISMATCH', candidate)
  const commandFailure = commandRecordFailure([playwright, computerUse])
  if (commandFailure) return bindingHold(commandFailure, candidate)
  const networkDigest = sanitizedNetworkDigest(playwright)
  if (!networkDigest || (computerUse.network_digest !== undefined && computerUse.network_digest !== networkDigest)) return bindingHold('NETWORK_EVIDENCE_MISMATCH', candidate)
  const traceHash = first(playwright, ['trace_sha256', 'trace_hash', 'trace_artifact_sha256'])
  const screenshotHash = first(playwright, ['screenshot_sha256', 'screenshot_hash', 'screenshot_artifact_sha256'])
  const buttons = first(playwright, ['main_buttons', 'buttons', 'main_button'])
  const visible = first(playwright, ['visible_state', 'visible_states'])
  const evidence = {
    schema_version: 'e2e-manifest/v1',
    manifest_id: manifestId,
    candidate_head_sha: candidateHead,
    applicability_record_digest: applicability.record_digest,
    manifest_digest: manifestHash,
    stack_kind: 'isolated_branch_stack',
    head_sha: candidateHead,
    tree_digest: candidateTree,
    manifest_path_digest: manifestPathDigest,
    manifest_sha256: manifestHash,
    manifest_sha256_at_start: first(manifest, ['manifest_sha256_at_start', 'manifest_start_sha256']),
    manifest_sha256_at_publication: first(manifest, ['manifest_sha256_at_publication', 'manifest_publication_sha256', 'publication_manifest_sha256']),
    execution_window: clone(manifestExecutionWindow),
    offset: manifestOffset,
    ports: clone(manifestPorts),
    base_urls: clone(manifestBaseUrls),
    branch: expected.branch,
    worktree_id: expected.worktree_id,
    worktree_path_digest: expected.worktree_path_digest,
    route: first(playwright, ['route']),
    main_buttons: [...buttons],
    fixture_reference: first(playwright, ['fixture', 'fixture_reference']),
    api_reference: first(playwright, ['api', 'backend_api', 'api_reference']),
    runtime_reference: first(playwright, ['runtime_id', 'runtime_reference']),
    visible_state: visible,
    network_digest: networkDigest,
    trace_sha256: traceHash,
    screenshot_sha256: screenshotHash,
    trace_reference: `trace:sha256:${traceHash.slice(0, 40)}:bound`,
    screenshot_reference: `screenshot:sha256:${screenshotHash.slice(0, 40)}:bound`,
    command_records_digest: first(playwright, ['command_records_digest', 'command_lineage_digest']),
    runtime_identity_digest: candidateRuntime,
    runtime_lineage_digest: first(playwright, ['runtime_lineage_digest', 'runtime_identity_digest']),
    listener_digest: playwrightListenerDigest,
    reserved_port_guard: 'clean',
    trusted_verifier_sha: trustedVerifierSha(trustedPins),
    trusted_binder_sha: trustedBinderSha(trustedPins),
    verifier_tree_digest: trustedPins.verifier_tree_digest,
    harness_digest: trustedPins.harness_digest,
    computer_use_authority_digest: trustedPins.authority_digest,
    verification_mode: 'canonical',
    candidate_harness_status: 'unchanged',
    created_at: first(manifest, ['started_at', 'created_at']) || DEFAULT_CREATED_AT,
  }
  if (!isTimestamp(evidence.created_at)) return bindingHold('EVIDENCE_TIMESTAMP_INVALID', candidate)
  const frozenEvidence = freezeCopy(evidence)
  const digest = digestCanonical(frozenEvidence)
  return freezeCopy({
    status: 'READY_FOR_TRAIN',
    phase: 'READY_FOR_TRAIN',
    internal_state: 'E2E_EVIDENCE_BOUND',
    candidate_id: candidateId,
    head_sha: candidateHead,
    tree_digest: candidateTree,
    manifest_sha256: manifestHash,
    applicability_record_digest: applicability.record_digest,
    manifest_path_digest: manifestPathDigest,
    runtime_identity_digest: candidateRuntime,
    trusted_verifier_sha: trustedVerifierSha(trustedPins),
    trusted_binder_sha: trustedBinderSha(trustedPins),
    computer_use_authority_digest: trustedPins.authority_digest,
    evidence: frozenEvidence,
    record: frozenEvidence,
    evidence_digest: digest,
    promotion_eligible: true,
    verification_mode: 'canonical',
    candidate_harness_status: 'unchanged',
    failure_isolation: { scope: 'candidate', other_candidates_continue: true },
  })
}
