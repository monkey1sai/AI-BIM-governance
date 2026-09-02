import { createHash } from 'node:crypto'

export const FABRIC_SCHEMA_VERSION = 'parallel-delivery-fabric/v1'

class FabricContractError extends Error {
  constructor(code, detail) {
    super(`${code}: ${detail}`)
    this.name = 'FabricContractError'
    this.code = code
    this.detail = detail
  }
}

const fail = (code, detail) => {
  throw new FabricContractError(code, detail)
}

const SHA1 = /^[0-9a-f]{40}$/u
const SHA256 = /^[0-9a-f]{64}$/u
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u
const OPAQUE_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{1,127}$/u
const OPAQUE_REFERENCE = /^[a-z][a-z0-9_-]*:[a-z0-9][a-z0-9._:/-]{0,119}$/u
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u
const RESOURCE_KEY = /^[a-z][a-z0-9_-]*:[a-z0-9][a-z0-9._:/-]{0,255}$/u
const NONCE = /^[A-Za-z0-9_-]{32,128}$/u
const RAW_WINDOWS_SID_SEGMENT = /(?:^|[/:])S-\d+(?:-\d+){2,}(?=$|[/:])/iu
const TERMINAL_PROCESS_ID_SEGMENT = /(?:^|[/:])\d+$/u
const SECRET_VALUE_MARKER = /(?:bearer|token|cookie|authorization|private[-_]?key|gh[pousr]_|github_pat_|eyJ[A-Za-z0-9_-]{10,})/iu

export const isCanonicalUtcMillisecondTimestamp = (value) => {
  if (typeof value !== 'string' || !TIMESTAMP.test(value)) return false
  const milliseconds = Date.parse(value)
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value
}

const hasSecretValueMarker = (value) => {
  if (SHA1.test(value) || SHA256.test(value) || TIMESTAMP.test(value)) return false
  return SECRET_VALUE_MARKER.test(value) || RAW_WINDOWS_SID_SEGMENT.test(value)
}

const hasOpaqueIdentityDisclosure = (value) => (
  RAW_WINDOWS_SID_SEGMENT.test(value) || TERMINAL_PROCESS_ID_SEGMENT.test(value)
)

const EXECUTION_LEVELS = Object.freeze([
  'plan_only', 'implement_local', 'push_owned_branch', 'open_draft_pr', 'submit_delivery',
])
const SIDE_EFFECT_CLASSES = Object.freeze([
  'CONTROL_METADATA', 'CANDIDATE_FILESYSTEM', 'REMOTE_GIT_GITHUB',
  'HOST_RUNTIME_SECURITY', 'EXTERNAL_ENVIRONMENT',
])
const TERMINAL_REASON_BY_CLASS = Object.freeze({
  DELIVERED: Object.freeze(['DELIVERY_VERIFIED']),
  FAILED: Object.freeze(['MERGED_NOT_DELIVERED']),
  HELD: Object.freeze([
    'MERGE_OUTCOME_UNVERIFIED', 'PREMERGE_EVIDENCE_INVALID',
    'PREMERGE_AUTHORITY_UNAVAILABLE', 'POLICY_OR_SETTINGS_DRIFT',
  ]),
})

const isPlainObject = (value) => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

const assertNoLoneSurrogate = (value, context) => {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index)
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1)
      if (!(next >= 0xdc00 && next <= 0xdfff)) fail('non_ijson_value', `${context}_lone_surrogate`)
      index += 1
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      fail('non_ijson_value', `${context}_lone_surrogate`)
    }
  }
}

export function canonicalize(value) {
  const normalize = (item, context = '$', depth = 0) => {
    if (depth > 64) fail('non_ijson_value', `${context}_depth_limit`)
    if (item === null || typeof item === 'boolean') return item
    if (typeof item === 'string') {
      assertNoLoneSurrogate(item, context)
      return item
    }
    if (typeof item === 'number') {
      if (!Number.isSafeInteger(item)) fail('non_ijson_value', `${context}_safe_integer_required`)
      return item
    }
    if (Array.isArray(item)) {
      // A hole would serialize as null and alias a different input's digest.
      for (let index = 0; index < item.length; index += 1) {
        if (!Object.hasOwn(item, index)) fail('non_ijson_value', `${context}[${index}]_sparse_array`)
      }
      return item.map((entry, index) => normalize(entry, `${context}[${index}]`, depth + 1))
    }
    if (!isPlainObject(item)) fail('non_ijson_value', `${context}_plain_object_required`)

    const normalized = {}
    for (const key of Object.keys(item).sort()) {
      assertNoLoneSurrogate(key, `${context}.key`)
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
        fail('non_ijson_value', `${context}_reserved_key`)
      }
      normalized[key] = normalize(item[key], `${context}.${key}`, depth + 1)
    }
    return normalized
  }
  return normalize(value)
}

export function digestCanonical(value) {
  return createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex')
}

const deepFreeze = (value) => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze(nested)
    Object.freeze(value)
  }
  return value
}

const hasSensitiveKey = (rawKey) => {
  const key = rawKey.replace(/([a-z0-9])([A-Z])/gu, '$1_$2').toLowerCase().replaceAll('-', '_')
  return (
    key.includes('token') || key.includes('cookie') || key.includes('authorization') ||
    key.includes('private_key') || key === 'sid' || key.endsWith('_sid') ||
    key === 'pid' || key.endsWith('_pid') || key === 'process_id' ||
    key.includes('transcript') || key === 'env' || key.startsWith('env_') ||
    key.endsWith('_env') || key.includes('raw_env') || key.includes('environment_values') ||
    key.includes('absolute_path') ||
    (key.endsWith('_path') && !['old_path', 'new_path', 'public_entrypoint'].includes(key))
  )
}

const assertNoSecretMaterial = (value, context = '$') => {
  if (typeof value === 'string') {
    if (hasSecretValueMarker(value)) fail('secret_material_detected', `${context}_forbidden`)
    return
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoSecretMaterial(entry, `${context}[${index}]`))
    return
  }
  if (!isPlainObject(value)) return
  for (const [key, nested] of Object.entries(value)) {
    if (hasSensitiveKey(key)) fail('secret_material_detected', `${context}.${key}_forbidden`)
    assertNoSecretMaterial(nested, `${context}.${key}`)
  }
}

const exactKeys = (value, keys, context) => {
  if (!isPlainObject(value)) fail('invalid_shape', `${context}_must_be_object`)
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail('invalid_shape', `${context}_keys_invalid`)
  }
}

const assertString = (value, context, { min = 1, max = 512, pattern = undefined } = {}) => {
  if (typeof value !== 'string' || value.length < min || value.length > max) {
    fail('invalid_value', `${context}_invalid_string`)
  }
  if (pattern && !pattern.test(value)) fail('invalid_value', `${context}_pattern_mismatch`)
  return value
}

const assertSafeInteger = (value, context, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) => {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    fail('invalid_value', `${context}_invalid_integer`)
  }
  return value
}

const assertBoolean = (value, context) => {
  if (typeof value !== 'boolean') fail('invalid_value', `${context}_must_be_boolean`)
  return value
}

const assertEnum = (value, choices, context) => {
  if (!choices.includes(value)) fail('invalid_value', `${context}_enum_invalid`)
  return value
}

const assertSha1 = (value, context, nullable = false) => {
  if (nullable && value === null) return value
  return assertString(value, context, { min: 40, max: 40, pattern: SHA1 })
}

const assertSha256 = (value, context, nullable = false) => {
  if (nullable && value === null) return value
  return assertString(value, context, { min: 64, max: 64, pattern: SHA256 })
}

// Identifiers become object keys in canonical (IJSON) records, whose normalizer rejects
// these prototype-colliding names; refusing them at the grammar keeps the contract honest
// instead of letting a "valid" id fail deep inside every durable store.
const RESERVED_IDENTIFIERS = new Set(['__proto__', 'constructor', 'prototype'])

const assertOpaqueId = (value, context, nullable = false) => {
  if (nullable && value === null) return value
  const identifier = assertString(value, context, { min: 3, max: 128, pattern: OPAQUE_ID })
  if (RESERVED_IDENTIFIERS.has(identifier)) fail('invalid_value', `${context}_reserved_identifier`)
  if (hasOpaqueIdentityDisclosure(identifier) || hasSecretValueMarker(identifier)) {
    fail('invalid_value', `${context}_raw_identity_or_credential_forbidden`)
  }
  return identifier
}

const assertOpaqueReference = (value, context, nullable = false) => {
  if (nullable && value === null) return value
  assertOpaqueId(value, context)
  return assertString(value, context, { min: 3, max: 128, pattern: OPAQUE_REFERENCE })
}

const assertNonce = (value, context) => {
  const nonce = assertString(value, context, { min: 32, max: 128, pattern: NONCE })
  if (hasOpaqueIdentityDisclosure(nonce) || hasSecretValueMarker(nonce)) {
    fail('invalid_value', `${context}_raw_identity_or_credential_forbidden`)
  }
  return nonce
}

export const isCanonicalOpaqueId = (value) => {
  try {
    assertOpaqueId(value, 'opaque_id')
    return true
  } catch {
    return false
  }
}

export const isCanonicalOpaqueReference = (value) => {
  try {
    assertOpaqueReference(value, 'opaque_reference')
    return true
  } catch {
    return false
  }
}

export const isCanonicalNonce = (value) => {
  try {
    assertNonce(value, 'nonce')
    return true
  } catch {
    return false
  }
}

const assertTimestamp = (value, context) => {
  assertString(value, context, { min: 24, max: 24, pattern: TIMESTAMP })
  if (!isCanonicalUtcMillisecondTimestamp(value)) {
    fail('invalid_value', `${context}_timestamp_invalid`)
  }
  return Date.parse(value)
}

const assertArray = (value, context, { min = 0, max = 256 } = {}) => {
  if (!Array.isArray(value) || value.length < min || value.length > max) {
    fail('invalid_shape', `${context}_array_invalid`)
  }
  return value
}

const assertUnique = (values, context) => {
  if (new Set(values).size !== values.length) fail('invalid_value', `${context}_duplicates_forbidden`)
}

const supportedGlobAlternatives = (pattern, depth = 0) => {
  if (depth > 8) return null
  const start = pattern.indexOf('{')
  if (start < 0) return [pattern]
  const end = pattern.indexOf('}', start + 1)
  if (end < 0) return null
  const choices = pattern.slice(start + 1, end).split(',')
  if (choices.length < 2 || choices.some((choice) => choice.length === 0 || choice.includes('/'))) return null
  const expanded = []
  for (const choice of choices) {
    const nested = supportedGlobAlternatives(`${pattern.slice(0, start)}${choice}${pattern.slice(end + 1)}`, depth + 1)
    if (nested === null) return null
    expanded.push(...nested)
    if (expanded.length > 32) return null
  }
  return expanded
}

const supportedGlobTokens = (pattern) => {
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index]
    if (character === '[') {
      const end = pattern.indexOf(']', index + 1)
      if (end < 0) return false
      const content = pattern.slice(index + 1, end)
      const unprefixed = content[0] === '!' || content[0] === '^' ? content.slice(1) : content
      if (!unprefixed || content.includes('/') || content.includes('[')) return false
      index = end
    } else if (character === ']' || character === '{' || character === '}') return false
  }
  return true
}

const supportedGlobPattern = (pattern) => {
  const alternatives = supportedGlobAlternatives(pattern)
  return alternatives !== null && alternatives.every(supportedGlobTokens)
}

const normalizeRelativePath = (value, context, { glob = false } = {}) => {
  assertString(value, context, { min: 1, max: 512 })
  if (value.includes('\u0000') || /[\r\n]/u.test(value)) fail('ambiguous_path', `${context}_control_character`)
  const windowsIdentity = value.includes('\\')
  const slashed = value.normalize('NFC').replaceAll('\\', '/')
  if (
    slashed.startsWith('/') || slashed.startsWith('//') || /^[A-Za-z]:\//u.test(slashed) ||
    slashed.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')
  ) fail('ambiguous_path', `${context}_not_repository_relative`)
  if (!glob && /[*?\[\]{}]/u.test(slashed)) fail('ambiguous_path', `${context}_wildcard_not_path`)
  if (glob && !supportedGlobPattern(slashed)) fail('ambiguous_path', `${context}_glob_syntax_unsupported`)
  return windowsIdentity ? slashed.toLowerCase() : slashed
}

// Serialized scope keys (`path:` / `glob:` / `rename:<old>:<new>`) follow the lease-side
// bound: 7 + 512 + 1 + 512, so every contract-valid plan path fits a session envelope.
const MAX_RESOURCE_KEY_LENGTH = 1032

const normalizeResourceKey = (value, context) => {
  assertString(value, context, { min: 3, max: MAX_RESOURCE_KEY_LENGTH })
  const separator = value.indexOf(':')
  const kind = separator > 0 ? value.slice(0, separator).toLowerCase() : ''
  const payload = separator > 0 ? value.slice(separator + 1) : ''
  if (kind === 'path' || kind === 'glob') {
    const path = normalizeRelativePath(payload, context, { glob: kind === 'glob' })
    const normalizedPathKey = `${kind}:${path}`
    if (hasOpaqueIdentityDisclosure(normalizedPathKey) || hasSecretValueMarker(normalizedPathKey)) {
      fail('invalid_value', `${context}_resource_key_raw_identity_or_credential_forbidden`)
    }
    return normalizedPathKey
  }
  if (kind === 'rename') {
    const endpoints = payload.split(':')
    if (endpoints.length !== 2) fail('invalid_value', `${context}_resource_key_invalid`)
    const oldPath = normalizeRelativePath(endpoints[0], `${context}.old_path`)
    const newPath = normalizeRelativePath(endpoints[1], `${context}.new_path`)
    const normalizedRenameKey = `rename:${oldPath}:${newPath}`
    if (hasOpaqueIdentityDisclosure(normalizedRenameKey) || hasSecretValueMarker(normalizedRenameKey)) {
      fail('invalid_value', `${context}_resource_key_raw_identity_or_credential_forbidden`)
    }
    return normalizedRenameKey
  }
  const normalized = value.toLowerCase()
  if (!RESOURCE_KEY.test(normalized)) fail('invalid_value', `${context}_resource_key_invalid`)
  if (hasOpaqueIdentityDisclosure(normalized) || hasSecretValueMarker(normalized)) {
    fail('invalid_value', `${context}_resource_key_raw_identity_or_credential_forbidden`)
  }
  return normalized
}

const normalizeResourceInternal = (raw) => {
  const resource = canonicalize(raw)
  assertNoSecretMaterial(resource, 'scope_resource')
  if (!isPlainObject(resource)) fail('invalid_shape', 'scope_resource_must_be_object')
  switch (resource.kind) {
    case 'path':
      exactKeys(resource, ['kind', 'path'], 'scope_resource.path')
      return { kind: 'path', path: normalizeRelativePath(resource.path, 'scope_resource.path') }
    case 'glob':
      exactKeys(resource, ['kind', 'pattern'], 'scope_resource.glob')
      return { kind: 'glob', pattern: normalizeRelativePath(resource.pattern, 'scope_resource.pattern', { glob: true }) }
    case 'rename':
      exactKeys(resource, ['kind', 'old_path', 'new_path'], 'scope_resource.rename')
      return {
        kind: 'rename',
        old_path: normalizeRelativePath(resource.old_path, 'scope_resource.rename.old_path'),
        new_path: normalizeRelativePath(resource.new_path, 'scope_resource.rename.new_path'),
      }
    case 'shared_contract':
    case 'exported_symbol':
    case 'schema':
    case 'event':
    case 'migration':
    case 'runtime':
      exactKeys(resource, ['kind', 'resource_key'], 'scope_resource.shared')
      return { kind: resource.kind, resource_key: normalizeResourceKey(resource.resource_key, 'scope_resource.resource_key') }
    default:
      fail('invalid_value', 'scope_resource_kind_invalid')
  }
}

export function normalizeScopeResource(resource) {
  return deepFreeze(normalizeResourceInternal(resource))
}

const scopeResourceIdentity = (resource) => {
  if (resource.kind === 'path') return `path:${resource.path}`
  if (resource.kind === 'glob') return `glob:${resource.pattern}`
  if (resource.kind === 'rename') return `rename:${resource.old_path}:${resource.new_path}`
  return `${resource.kind}:${resource.resource_key}`
}

const validateRepositoryIdentity = (value, context) => {
  exactKeys(value, ['full_name', 'repository_id', 'common_dir_digest'], context)
  assertString(value.full_name, `${context}.full_name`, { min: 3, max: 200, pattern: REPOSITORY })
  assertSafeInteger(value.repository_id, `${context}.repository_id`, 1)
  assertSha256(value.common_dir_digest, `${context}.common_dir_digest`)
}

const validateScope = (value, context) => {
  exactKeys(value, ['owning_service', 'public_entrypoint', 'resources', 'expected_tests', 'e2e_required'], context)
  assertOpaqueId(value.owning_service, `${context}.owning_service`)
  value.public_entrypoint = normalizeRelativePath(value.public_entrypoint, `${context}.public_entrypoint`)
  assertArray(value.resources, `${context}.resources`, { min: 1, max: 256 })
  value.resources = value.resources.map((resource) => normalizeResourceInternal(resource))
  assertUnique(value.resources.map(scopeResourceIdentity), `${context}.resources`)
  assertArray(value.expected_tests, `${context}.expected_tests`, { min: 1, max: 128 })
  value.expected_tests.forEach((entry, index) => assertOpaqueReference(entry, `${context}.expected_tests[${index}]`))
  assertUnique(value.expected_tests, `${context}.expected_tests`)
  assertBoolean(value.e2e_required, `${context}.e2e_required`)
}

const parseWith = (raw, validator) => {
  const value = canonicalize(raw)
  assertNoSecretMaterial(value)
  validator(value)
  return deepFreeze(value)
}

export function parseDeliveryPlan(raw) {
  return parseWith(raw, (plan) => {
    exactKeys(plan, [
      'schema_version', 'plan_id', 'generation', 'repo_identity', 'created_at', 'coordinator_session',
      'baseline_ref', 'resolved_baseline_sha', 'tasks', 'requested_capacity', 'branch_profile',
      'acceptance_criteria', 'promotion_mode', 'requested_execution_level', 'authority_reference',
      'governance_source_refs',
    ], 'delivery_plan')
    if (plan.schema_version !== FABRIC_SCHEMA_VERSION) fail('invalid_value', 'delivery_plan_schema_version_invalid')
    assertOpaqueReference(plan.plan_id, 'delivery_plan.plan_id')
    assertSafeInteger(plan.generation, 'delivery_plan.generation', 1)
    validateRepositoryIdentity(plan.repo_identity, 'delivery_plan.repo_identity')
    assertTimestamp(plan.created_at, 'delivery_plan.created_at')
    assertOpaqueReference(plan.coordinator_session, 'delivery_plan.coordinator_session')
    assertOpaqueId(plan.baseline_ref, 'delivery_plan.baseline_ref')
    assertSha1(plan.resolved_baseline_sha, 'delivery_plan.resolved_baseline_sha')
    assertArray(plan.tasks, 'delivery_plan.tasks', { min: 1, max: 64 })
    plan.tasks.forEach((task, index) => {
      const context = `delivery_plan.tasks[${index}]`
      exactKeys(task, ['task_id', 'outcome', 'provider_preference', 'owner_session', 'scope', 'dependencies', 'risk', 'e2e_required'], context)
      assertOpaqueReference(task.task_id, `${context}.task_id`)
      assertOpaqueId(task.outcome, `${context}.outcome`)
      assertEnum(task.provider_preference, ['codex', 'claude'], `${context}.provider_preference`)
      assertOpaqueReference(task.owner_session, `${context}.owner_session`)
      validateScope(task.scope, `${context}.scope`)
      assertArray(task.dependencies, `${context}.dependencies`, { max: 64 })
      task.dependencies.forEach((dependency, dependencyIndex) => assertOpaqueReference(dependency, `${context}.dependencies[${dependencyIndex}]`))
      assertUnique(task.dependencies, `${context}.dependencies`)
      assertEnum(task.risk, ['low', 'bounded', 'high', 'critical'], `${context}.risk`)
      assertBoolean(task.e2e_required, `${context}.e2e_required`)
      if (task.e2e_required !== task.scope.e2e_required) fail('invalid_value', `${context}_e2e_scope_mismatch`)
    })
    assertUnique(plan.tasks.map((task) => task.task_id), 'delivery_plan.tasks')
    const tasksById = new Map(plan.tasks.map((task) => [task.task_id, task]))
    for (const task of plan.tasks) {
      for (const dependency of task.dependencies) {
        if (dependency === task.task_id) fail('invalid_value', `delivery_plan.task_${task.task_id}_dependency_self_reference`)
        if (!tasksById.has(dependency)) fail('invalid_value', `delivery_plan.task_${task.task_id}_dependency_missing`)
      }
    }
    const visiting = new Set()
    const visited = new Set()
    const visitTask = (taskId) => {
      if (visiting.has(taskId)) fail('invalid_value', 'delivery_plan_task_dependency_cycle')
      if (visited.has(taskId)) return
      visiting.add(taskId)
      for (const dependency of tasksById.get(taskId).dependencies) visitTask(dependency)
      visiting.delete(taskId)
      visited.add(taskId)
    }
    for (const taskId of tasksById.keys()) visitTask(taskId)
    exactKeys(plan.requested_capacity, ['writers', 'runtime_leases'], 'delivery_plan.requested_capacity')
    assertSafeInteger(plan.requested_capacity.writers, 'delivery_plan.requested_capacity.writers', 1, plan.tasks.length)
    assertSafeInteger(plan.requested_capacity.runtime_leases, 'delivery_plan.requested_capacity.runtime_leases', 0, 3)
    assertEnum(plan.branch_profile, ['trunk', 'managed_gitflow'], 'delivery_plan.branch_profile')
    assertArray(plan.acceptance_criteria, 'delivery_plan.acceptance_criteria', { min: 1, max: 128 })
    plan.acceptance_criteria.forEach((criterion, index) => assertOpaqueReference(criterion, `delivery_plan.acceptance_criteria[${index}]`))
    assertUnique(plan.acceptance_criteria, 'delivery_plan.acceptance_criteria')
    assertEnum(plan.promotion_mode, ['single_pr', 'direct_stack'], 'delivery_plan.promotion_mode')
    assertEnum(plan.requested_execution_level, EXECUTION_LEVELS, 'delivery_plan.requested_execution_level')
    assertOpaqueReference(plan.authority_reference, 'delivery_plan.authority_reference')
    assertArray(plan.governance_source_refs, 'delivery_plan.governance_source_refs', { min: 1, max: 64 })
    plan.governance_source_refs.forEach((reference, index) => assertOpaqueReference(reference, `delivery_plan.governance_source_refs[${index}]`))
    assertUnique(plan.governance_source_refs, 'delivery_plan.governance_source_refs')
  })
}

export function parseProviderSessionEnvelope(raw) {
  return parseWith(raw, (session) => {
    exactKeys(session, [
      'schema_version', 'plan_id', 'generation', 'task_id', 'provider', 'owner_session',
      'provider_session_id', 'execution_context_id', 'repo_identity_digest', 'common_dir_digest',
      'worktree_id', 'worktree_path_digest', 'branch', 'baseline_sha', 'scope_digest', 'resource_keys',
      'lease_id', 'heartbeat_seq', 'heartbeat_state', 'heartbeat_at', 'context_attestation_ref',
      'context_attestation_digest', 'evidence_head_sha', 'evidence_refs', 'handoff_id', 'adapter_version',
    ], 'provider_session')
    if (session.schema_version !== 'provider-session-envelope/v1') fail('invalid_value', 'provider_session_schema_version_invalid')
    for (const key of ['plan_id', 'task_id', 'owner_session', 'provider_session_id', 'execution_context_id', 'worktree_id', 'lease_id', 'context_attestation_ref']) {
      assertOpaqueReference(session[key], `provider_session.${key}`)
    }
    assertOpaqueId(session.adapter_version, 'provider_session.adapter_version')
    assertSafeInteger(session.generation, 'provider_session.generation', 1)
    assertEnum(session.provider, ['codex', 'claude'], 'provider_session.provider')
    for (const key of ['repo_identity_digest', 'common_dir_digest', 'worktree_path_digest', 'scope_digest', 'context_attestation_digest']) {
      assertSha256(session[key], `provider_session.${key}`)
    }
    assertOpaqueId(session.branch, 'provider_session.branch')
    assertSha1(session.baseline_sha, 'provider_session.baseline_sha')
    assertArray(session.resource_keys, 'provider_session.resource_keys', { min: 1, max: 256 })
    session.resource_keys = session.resource_keys.map((key, index) => normalizeResourceKey(key, `provider_session.resource_keys[${index}]`))
    assertUnique(session.resource_keys, 'provider_session.resource_keys')
    assertSafeInteger(session.heartbeat_seq, 'provider_session.heartbeat_seq', 1)
    assertEnum(session.heartbeat_state, ['ACTIVE', 'SUSPECT', 'HANDOFF_READY'], 'provider_session.heartbeat_state')
    assertTimestamp(session.heartbeat_at, 'provider_session.heartbeat_at')
    assertSha1(session.evidence_head_sha, 'provider_session.evidence_head_sha')
    assertArray(session.evidence_refs, 'provider_session.evidence_refs', { min: 1, max: 128 })
    session.evidence_refs.forEach((reference, index) => assertOpaqueReference(reference, `provider_session.evidence_refs[${index}]`))
    assertUnique(session.evidence_refs, 'provider_session.evidence_refs')
    assertOpaqueReference(session.handoff_id, 'provider_session.handoff_id', true)
  })
}

export function parseExecutionEnvelope(raw) {
  return parseWith(raw, (envelope) => {
    exactKeys(envelope, [
      'schema_version', 'envelope_id', 'plan_id', 'generation', 'task_id', 'owner_session', 'provider',
      'provider_session_id', 'execution_context_id', 'context_attestation_digest', 'issuer_id',
      'issuer_version', 'authority_reference', 'authority_digest', 'issued_at', 'expires_at',
      'revocation_epoch', 'command_nonce', 'authorized_highest_level', 'current_level',
      'transition_sequence', 'expected_previous_envelope_oid', 'expected_lease_registry_oid',
      'repo_identity_digest', 'common_dir_digest', 'worktree_id', 'worktree_path_digest', 'branch',
      'baseline_sha', 'head_sha', 'scope_digest', 'lease_id', 'allowed_remote', 'allowed_repository',
      'allowed_base', 'expected_remote_ref', 'expected_remote_sha', 'promotion_mode',
      'external_capability_reference', 'side_effect_class',
    ], 'execution_envelope')
    if (envelope.schema_version !== 'execution-envelope/v1') fail('invalid_value', 'execution_envelope_schema_version_invalid')
    for (const key of [
      'envelope_id', 'plan_id', 'task_id', 'owner_session', 'provider_session_id', 'execution_context_id',
      'issuer_id', 'authority_reference',
    ]) assertOpaqueReference(envelope[key], `execution_envelope.${key}`)
    for (const key of ['issuer_version', 'allowed_remote', 'allowed_repository', 'allowed_base']) {
      assertOpaqueId(envelope[key], `execution_envelope.${key}`)
    }
    if (envelope.issuer_id === envelope.owner_session) fail('invalid_value', 'execution_envelope_self_issued')
    assertSafeInteger(envelope.generation, 'execution_envelope.generation', 1)
    assertEnum(envelope.provider, ['codex', 'claude'], 'execution_envelope.provider')
    for (const key of [
      'context_attestation_digest', 'authority_digest', 'repo_identity_digest', 'common_dir_digest', 'scope_digest',
    ]) assertSha256(envelope[key], `execution_envelope.${key}`)
    const issuedAt = assertTimestamp(envelope.issued_at, 'execution_envelope.issued_at')
    const expiresAt = assertTimestamp(envelope.expires_at, 'execution_envelope.expires_at')
    if (expiresAt <= issuedAt) fail('invalid_value', 'execution_envelope_expiry_not_after_issue')
    assertSafeInteger(envelope.revocation_epoch, 'execution_envelope.revocation_epoch')
    assertNonce(envelope.command_nonce, 'execution_envelope.command_nonce')
    assertEnum(envelope.authorized_highest_level, EXECUTION_LEVELS, 'execution_envelope.authorized_highest_level')
    assertEnum(envelope.current_level, EXECUTION_LEVELS, 'execution_envelope.current_level')
    const highestLevel = EXECUTION_LEVELS.indexOf(envelope.authorized_highest_level)
    const currentLevel = EXECUTION_LEVELS.indexOf(envelope.current_level)
    if (currentLevel > highestLevel) fail('invalid_value', 'execution_envelope_level_exceeds_authority')
    assertSafeInteger(envelope.transition_sequence, 'execution_envelope.transition_sequence', 0, EXECUTION_LEVELS.length - 1)
    if (envelope.transition_sequence !== currentLevel) fail('invalid_value', 'execution_envelope_transition_not_adjacent')
    assertSha1(envelope.expected_previous_envelope_oid, 'execution_envelope.expected_previous_envelope_oid')
    assertSha1(envelope.expected_lease_registry_oid, 'execution_envelope.expected_lease_registry_oid')
    assertOpaqueReference(envelope.worktree_id, 'execution_envelope.worktree_id', true)
    assertSha256(envelope.worktree_path_digest, 'execution_envelope.worktree_path_digest', true)
    assertOpaqueId(envelope.branch, 'execution_envelope.branch', true)
    assertSha1(envelope.baseline_sha, 'execution_envelope.baseline_sha')
    assertSha1(envelope.head_sha, 'execution_envelope.head_sha', true)
    assertOpaqueReference(envelope.lease_id, 'execution_envelope.lease_id', true)
    assertOpaqueId(envelope.expected_remote_ref, 'execution_envelope.expected_remote_ref', true)
    assertSha1(envelope.expected_remote_sha, 'execution_envelope.expected_remote_sha', true)
    assertEnum(envelope.promotion_mode, ['single_pr', 'direct_stack'], 'execution_envelope.promotion_mode')
    assertOpaqueReference(envelope.external_capability_reference, 'execution_envelope.external_capability_reference', true)
    assertEnum(envelope.side_effect_class, SIDE_EFFECT_CLASSES, 'execution_envelope.side_effect_class')
    if (envelope.current_level === 'plan_only') {
      if (envelope.side_effect_class !== 'CONTROL_METADATA') fail('invalid_value', 'plan_only_effect_not_allowlisted')
      for (const key of ['worktree_id', 'worktree_path_digest', 'branch', 'head_sha', 'lease_id', 'expected_remote_ref', 'expected_remote_sha', 'external_capability_reference']) {
        if (envelope[key] !== null) fail('invalid_value', `plan_only_${key}_must_be_null`)
      }
    }
  })
}

export function parseStackDeliveryEnvelope(raw) {
  return parseWith(raw, (stack) => {
    exactKeys(stack, [
      'schema_version', 'stack_id', 'trunk_ref', 'trunk_sha', 'selected_top_pr', 'ordered_member_vector_digest',
      'merge_action', 'merge_method', 'members', 'expected_protection_digest', 'capability_reference',
      'deployment_target_reference', 'created_at', 'expires_at',
    ], 'stack_delivery')
    if (stack.schema_version !== 'stack-delivery-envelope/v1') fail('invalid_value', 'stack_delivery_schema_version_invalid')
    assertOpaqueReference(stack.stack_id, 'stack_delivery.stack_id')
    assertOpaqueId(stack.trunk_ref, 'stack_delivery.trunk_ref')
    assertSha1(stack.trunk_sha, 'stack_delivery.trunk_sha')
    assertSafeInteger(stack.selected_top_pr, 'stack_delivery.selected_top_pr', 1)
    assertSha256(stack.ordered_member_vector_digest, 'stack_delivery.ordered_member_vector_digest')
    assertEnum(stack.merge_action, ['direct_merge'], 'stack_delivery.merge_action')
    assertEnum(stack.merge_method, ['merge'], 'stack_delivery.merge_method')
    assertArray(stack.members, 'stack_delivery.members', { min: 1, max: 64 })
    stack.members.forEach((member, index) => {
      const context = `stack_delivery.members[${index}]`
      exactKeys(member, [
        'pr_number', 'node_id', 'position', 'head_ref', 'head_sha', 'direct_base_ref', 'direct_base_sha',
        'exact_head_packet_digest', 'checks_digest', 'independent_review_digest', 'e2e_required',
        'e2e_result_digest', 'unresolved_finding_state',
      ], context)
      assertSafeInteger(member.pr_number, `${context}.pr_number`, 1)
      assertOpaqueReference(member.node_id, `${context}.node_id`)
      assertSafeInteger(member.position, `${context}.position`, 1)
      if (member.position !== index + 1) fail('invalid_value', `${context}_position_not_contiguous`)
      assertOpaqueId(member.head_ref, `${context}.head_ref`)
      assertSha1(member.head_sha, `${context}.head_sha`)
      assertOpaqueId(member.direct_base_ref, `${context}.direct_base_ref`)
      assertSha1(member.direct_base_sha, `${context}.direct_base_sha`)
      for (const key of ['exact_head_packet_digest', 'checks_digest', 'independent_review_digest']) {
        assertSha256(member[key], `${context}.${key}`)
      }
      assertBoolean(member.e2e_required, `${context}.e2e_required`)
      assertSha256(member.e2e_result_digest, `${context}.e2e_result_digest`, true)
      if (member.e2e_required !== (member.e2e_result_digest !== null)) {
        fail('invalid_value', `${context}_e2e_result_mismatch`)
      }
      assertEnum(member.unresolved_finding_state, ['none'], `${context}.unresolved_finding_state`)
    })
    if (stack.members.at(-1).pr_number !== stack.selected_top_pr) fail('invalid_value', 'stack_delivery_selected_top_not_final_member')
    // The frozen vector identity is derived from the members, never declared.
    if (stack.ordered_member_vector_digest !== digestCanonical(stack.members)) fail('invalid_value', 'stack_delivery_vector_digest_mismatch')
    assertUnique(stack.members.map((member) => member.pr_number), 'stack_delivery.members')
    assertSha256(stack.expected_protection_digest, 'stack_delivery.expected_protection_digest')
    assertOpaqueReference(stack.capability_reference, 'stack_delivery.capability_reference')
    assertOpaqueReference(stack.deployment_target_reference, 'stack_delivery.deployment_target_reference')
    const createdAt = assertTimestamp(stack.created_at, 'stack_delivery.created_at')
    const expiresAt = assertTimestamp(stack.expires_at, 'stack_delivery.expires_at')
    if (expiresAt <= createdAt) fail('invalid_value', 'stack_delivery_expiry_not_after_create')
  })
}

export function validateFabricContract(definition, value) {
  switch (definition) {
    case 'plan': return parseDeliveryPlan(value)
    case 'provider_session': return parseProviderSessionEnvelope(value)
    case 'execution_envelope': return parseExecutionEnvelope(value)
    case 'stack': return parseStackDeliveryEnvelope(value)
    default: fail('invalid_value', 'semantic_validation_definition_invalid')
  }
}

const validateExternalTerminal = (value) => {
  exactKeys(value, ['phase', 'terminal_class', 'reason_code'], 'external_terminal')
  if (value.phase !== 'CLOSED') fail('invalid_value', 'external_terminal_phase_invalid')
  if (!Object.hasOwn(TERMINAL_REASON_BY_CLASS, value.terminal_class)) {
    fail('invalid_value', 'external_terminal_class_invalid')
  }
  if (!TERMINAL_REASON_BY_CLASS[value.terminal_class].includes(value.reason_code)) {
    fail('invalid_value', 'external_terminal_reason_invalid')
  }
}

export function projectExternalTerminal(raw) {
  const value = canonicalize(raw)
  assertNoSecretMaterial(value)
  if (!isPlainObject(value)) fail('invalid_value', 'terminal_projection_must_be_object')
  if (Object.keys(value).length === 1 && Object.hasOwn(value, 'internal_state')) {
    const projection = {
      STACK_DELIVERY_FAILED: { phase: 'CLOSED', terminal_class: 'FAILED', reason_code: 'MERGED_NOT_DELIVERED' },
      MERGE_OUTCOME_UNVERIFIED: { phase: 'CLOSED', terminal_class: 'HELD', reason_code: 'MERGE_OUTCOME_UNVERIFIED' },
      STACK_DELIVERY_VERIFIED: { phase: 'CLOSED', terminal_class: 'DELIVERED', reason_code: 'DELIVERY_VERIFIED' },
      PREMERGE_EVIDENCE_INVALID: { phase: 'CLOSED', terminal_class: 'HELD', reason_code: 'PREMERGE_EVIDENCE_INVALID' },
      PREMERGE_AUTHORITY_UNAVAILABLE: { phase: 'CLOSED', terminal_class: 'HELD', reason_code: 'PREMERGE_AUTHORITY_UNAVAILABLE' },
      POLICY_OR_SETTINGS_DRIFT: { phase: 'CLOSED', terminal_class: 'HELD', reason_code: 'POLICY_OR_SETTINGS_DRIFT' },
    }[value.internal_state]
    if (!projection) fail('invalid_value', 'terminal_projection_internal_state_invalid')
    return deepFreeze(projection)
  }
  if (!Object.hasOwn(value, 'phase') || !Object.hasOwn(value, 'terminal_class') || !Object.hasOwn(value, 'reason_code')) {
    fail('invalid_value', 'terminal_projection_external_shape_invalid')
  }
  validateExternalTerminal(value)
  return deepFreeze(value)
}
