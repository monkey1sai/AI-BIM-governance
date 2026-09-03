import { randomUUID } from 'node:crypto'
import { types } from 'node:util'
import { digestCanonical, normalizeScopeResource, parseDeliveryPlan } from './parallel-delivery-fabric-contract.mjs'
import { parseSessionLeaseRegistry } from './parallel-delivery-fabric-registry.mjs'

const COMMAND_TYPES = new Set(['submit', 'advance', 'reconcile', 'drain', 'release'])
const ADVANCE_LEVELS = new Set(['implement_local', 'push_owned_branch', 'open_draft_pr', 'submit_delivery'])
const COMMAND_ID = /^[A-Za-z][A-Za-z0-9._:-]{2,127}$/u
const SECRET_KEY = /(?:secret|token|password|credential|private|cookie|authorization|bearer|\benv\b|_env$|^env_|\bsid\b|\bpid\b|transcript|process_id|absolute_path)/iu
const SECRET_VALUE = /(?:gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+|bearer\s+|-----BEGIN|eyJ[A-Za-z0-9_-]{10,}|(?:^|[/:])S-\d+(?:-\d+){2,}(?=$|[/:])|(?:^|[/:])\d+$|(?:^|:)[A-Za-z]:[\\/]|(?:^|:)(?:\\\\|\/)|\$env:|%[A-Za-z_][A-Za-z0-9_]*%)/iu
const SAFE_REASON = /^[A-Za-z0-9_:-]{1,128}$/u
const FORBIDDEN_KEY = /^(?:__proto__|prototype|constructor)$/iu
const MAX_SNAPSHOT_DEPTH = 16
const MAX_SNAPSHOT_KEYS = 128
// Matches the CLI node budget: a contract-maximum 64-task plan must snapshot.
const MAX_SNAPSHOT_NODES = 4096
const MAX_SNAPSHOT_BYTES = 256 * 1024
const EFFECT_KEYS = Object.freeze(['filesystem', 'git', 'network', 'process', 'provider', 'github', 'deploy', 'cleanup', 'promotion'])
const NEXT_LEVEL = Object.freeze({ plan_only: 'implement_local', implement_local: 'push_owned_branch', push_owned_branch: 'open_draft_pr', open_draft_pr: 'submit_delivery' })
const RECONCILE_STATUSES = new Set(['ACTIVE', 'SUSPECT', 'NO_CHANGE'])

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
const own = (value, key) => isObject(value) && Object.hasOwn(value, key)

const chargeKey = (key, budget) => {
  if (FORBIDDEN_KEY.test(key) || SECRET_KEY.test(key) || key.length > MAX_SNAPSHOT_BYTES) return false
  budget.bytes += Buffer.byteLength(key, 'utf8')
  return budget.bytes <= MAX_SNAPSHOT_BYTES
}

const canonicalArrayIndex = (key, length) => {
  if (!/^(?:0|[1-9]\d*)$/u.test(key)) return false
  const index = Number(key)
  return Number.isSafeInteger(index) && String(index) === key && index < length
}

const plainData = (value, seen = new WeakSet(), budget = { bytes: 0, nodes: 0 }, depth = 0) => {
  if (depth > MAX_SNAPSHOT_DEPTH || value === undefined || typeof value === 'bigint' || typeof value === 'function' || typeof value === 'symbol') return undefined
  budget.nodes += 1
  if (budget.nodes > MAX_SNAPSHOT_NODES) return undefined
  if (typeof value === 'string') {
    if (!/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/u.test(value) && SECRET_VALUE.test(value)) return undefined
    budget.bytes += Buffer.byteLength(value, 'utf8')
    return budget.bytes <= MAX_SNAPSHOT_BYTES ? value : undefined
  }
  if (value === null || typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (typeof value !== 'object' || seen.has(value) || types.isProxy(value)) return undefined
  try {
    const prototype = Object.getPrototypeOf(value)
    if (Array.isArray(value) && prototype !== Array.prototype) return undefined
    if (!Array.isArray(value) && ![Object.prototype, null].includes(prototype)) return undefined
    const keys = Reflect.ownKeys(value)
    const descriptors = Object.getOwnPropertyDescriptors(value)
    if (keys.some((key) => typeof key !== 'string') || keys.length !== Reflect.ownKeys(descriptors).length || keys.some((key) => !Object.hasOwn(descriptors, key))) return undefined
    if (Array.isArray(value)) {
      const length = descriptors.length
      const indexKeys = keys.filter((key) => key !== 'length')
      if (!length || !Object.hasOwn(length, 'value') || !Number.isSafeInteger(length.value) || length.value < 0 || length.value > MAX_SNAPSHOT_KEYS || indexKeys.length !== length.value || !indexKeys.every((key) => canonicalArrayIndex(key, length.value)) || !indexKeys.every((key) => chargeKey(key, budget))) return undefined
      const result = []
      seen.add(value)
      for (let index = 0; index < length.value; index += 1) {
        const descriptor = descriptors[String(index)]
        const copied = descriptor && Object.hasOwn(descriptor, 'value') ? plainData(descriptor.value, seen, budget, depth + 1) : undefined
        if (copied === undefined) return undefined
        result.push(copied)
      }
      return result
    }
    if (keys.length > MAX_SNAPSHOT_KEYS || !keys.every((key) => chargeKey(key, budget))) return undefined
    const result = {}
    seen.add(value)
    for (const key of keys) {
      const descriptor = descriptors[key]
      const copied = descriptor && Object.hasOwn(descriptor, 'value') ? plainData(descriptor.value, seen, budget, depth + 1) : undefined
      if (copied === undefined) return undefined
      result[key] = copied
    }
    return result
  } catch { return undefined }
}

const safeReason = (value, fallback) => typeof value === 'string' && SAFE_REASON.test(value) ? value : fallback

const deepFreeze = (value) => {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze(nested)
    Object.freeze(value)
  }
  return value
}

const safeSnapshot = (value) => {
  const first = plainData(value)
  if (first === undefined) return undefined
  try {
    const second = plainData(structuredClone(value))
    return second === undefined || digestCanonical(first) !== digestCanonical(second) ? undefined : deepFreeze(first)
  } catch {
    return undefined
  }
}
const safePortResult = (value) => safeSnapshot(value)

const safeInput = (value) => safeSnapshot(value) !== undefined

const outcome = (commandId, type, status, reason, extra = undefined) => Object.freeze({
  command_id: commandId,
  type,
  status,
  reason,
  ...(extra === undefined ? {} : extra),
})

const exactKeys = (value, keys) => isObject(value) && Object.keys(value).length === keys.length && keys.every((key) => own(value, key))

const portObject = (value, keys) => {
  if (!isObject(value)) return undefined
  try {
    const descriptors = Object.getOwnPropertyDescriptors(value)
    if (Object.keys(descriptors).length !== keys.length || !keys.every((key) => Object.hasOwn(descriptors, key) && Object.hasOwn(descriptors[key], 'value'))) return undefined
    return Object.fromEntries(keys.map((key) => [key, descriptors[key].value]))
  } catch { return undefined }
}

const configured = (rawPorts) => {
  let root
  try { root = portObject(rawPorts, Object.hasOwn(rawPorts ?? {}, 'projection') ? ['commandJournal', 'planRegistry', 'leaseRegistry', 'execution', 'providerAdapters', 'projection'] : ['commandJournal', 'planRegistry', 'leaseRegistry', 'execution', 'providerAdapters']) } catch { return undefined }
  if (!root) return undefined
  const commandJournal = portObject(root.commandJournal, ['read', 'reserve', 'commit'])
  const planRegistry = portObject(root.planRegistry, ['submit', 'validateGeneration', 'inspect'])
  const leaseKeys = Object.hasOwn(root.leaseRegistry ?? {}, 'releaseRetainedResources')
    ? ['admit', 'validateActive', 'validateDependencies', 'reconcileTimeout', 'drainPlan', 'release', 'releaseRetainedResources', 'inspect']
    : ['admit', 'validateActive', 'validateDependencies', 'reconcileTimeout', 'drainPlan', 'release', 'inspect']
  const leaseRegistryRaw = portObject(root.leaseRegistry, leaseKeys)
  const leaseRegistry = leaseRegistryRaw && Object.freeze({
    ...leaseRegistryRaw,
    releaseRetainedResources: leaseRegistryRaw.releaseRetainedResources ?? (async () => ({ status: 'HELD', reason: 'RETENTION_RELEASE_AUTHORITY_UNAVAILABLE' })),
  })
  const execution = portObject(root.execution, ['advance'])
  const adapters = portObject(root.providerAdapters, ['codex', 'claude'])
  const codex = adapters && portObject(adapters.codex, ['preflight'])
  const claude = adapters && portObject(adapters.claude, ['preflight'])
  const projection = Object.hasOwn(root, 'projection') ? portObject(root.projection, ['reconcile']) : undefined
  const functions = [commandJournal?.read, commandJournal?.reserve, commandJournal?.commit, planRegistry?.submit, planRegistry?.validateGeneration, planRegistry?.inspect, leaseRegistry?.admit, leaseRegistry?.validateActive, leaseRegistry?.validateDependencies, leaseRegistry?.reconcileTimeout, leaseRegistry?.drainPlan, leaseRegistry?.release, leaseRegistry?.releaseRetainedResources, leaseRegistry?.inspect, execution?.advance, codex?.preflight, claude?.preflight, ...(projection ? [projection.reconcile] : [])]
  return functions.every((entry) => typeof entry === 'function') && (!Object.hasOwn(root, 'projection') || projection) ? deepFreeze({ commandJournal, planRegistry, leaseRegistry, execution, providerAdapters: { codex, claude }, ...(projection ? { projection } : {}) }) : undefined
}

const submittedPlanIsMetadataOnly = (command) => exactKeys(command.execution, ['level', 'side_effect_class']) &&
  command.execution.level === 'plan_only' && command.execution.side_effect_class === 'CONTROL_METADATA' &&
  exactKeys(command.effects, EFFECT_KEYS) && EFFECT_KEYS.every((key) => command.effects[key] === 0)

const commandShapeIsValid = (command) => {
  if (!isObject(command) || !COMMAND_TYPES.has(command.type) || typeof command.command_id !== 'string' || !COMMAND_ID.test(command.command_id)) return false
  const shapes = {
    submit: ['type', 'command_id', 'plan', 'expected_oid', 'nonce', 'execution', 'effects'],
    advance: ['type', 'command_id', 'envelope', 'advance_command', 'admission', 'provider_request'],
    reconcile: ['type', 'command_id', 'reconcile_request'],
    drain: ['type', 'command_id', 'drain_request'],
    release: ['type', 'command_id', 'release_request'],
  }
  return exactKeys(command, shapes[command.type])
}

const journalKey = (commandId) => `journal:${digestCanonical({ command_id: commandId })}`
const reservationId = (commandId, commandDigest, attemptId) => `reservation:${digestCanonical({ command_id: commandId, command_digest: commandDigest, attempt_id: attemptId })}`
const closedOutcome = (value, command) => {
  const outcome = safeSnapshot(value)
  if (!outcome || outcome.command_id !== command.command_id || outcome.type !== command.type || !['HELD', 'SHADOW_STORED', 'SHADOW_INTENT', 'QUEUED'].includes(outcome.status) || !SAFE_REASON.test(outcome.reason)) return undefined
  if (outcome.status === 'HELD' && command.type === 'advance' && outcome.reason === 'PREMERGE_AUTHORITY_UNAVAILABLE' && exactKeys(outcome, ['command_id', 'type', 'status', 'reason', 'external_terminal']) && digestCanonical(outcome.external_terminal) === digestCanonical({ phase: 'CLOSED', terminal_class: 'HELD', reason_code: 'PREMERGE_AUTHORITY_UNAVAILABLE' })) return outcome
  if (!exactKeys(outcome, ['command_id', 'type', 'status', 'reason'])) return undefined
  const allowed = { submit: ['HELD', 'SHADOW_STORED'], advance: ['HELD', 'SHADOW_INTENT', 'QUEUED'], reconcile: ['HELD', 'SHADOW_STORED'], drain: ['HELD', 'SHADOW_STORED'], release: ['HELD', 'SHADOW_STORED'] }
  return allowed[command.type].includes(outcome.status) ? outcome : undefined
}
const receipt = (value, command, commandDigest, reservation, status, expectedOutcome = undefined, attemptId = undefined, journal = undefined) => {
  const candidate = safeSnapshot(value)
  const keys = status === 'COMMITTED' ? ['journal_key', 'command_id', 'command_digest', 'attempt_id', 'reservation_id', 'status', 'outcome_digest', 'outcome'] : ['journal_key', 'command_id', 'command_digest', 'attempt_id', 'reservation_id', 'status', 'acquired']
  if (!candidate || !exactKeys(candidate, keys) || candidate.command_id !== command.command_id || candidate.command_digest !== commandDigest || candidate.reservation_id !== reservation || candidate.status !== status || candidate.journal_key !== journal || (attemptId !== undefined && candidate.attempt_id !== attemptId)) return undefined
  if (status !== 'COMMITTED') return candidate.acquired === true ? candidate : undefined
  const outcome = closedOutcome(candidate.outcome, command)
  return outcome && candidate.outcome_digest === digestCanonical(outcome) && (!expectedOutcome || candidate.outcome_digest === digestCanonical(expectedOutcome)) ? deepFreeze({ ...candidate, outcome }) : undefined
}

const heldFromPort = (command, fallback, result) => outcome(
  command.command_id,
  command.type,
  'HELD',
  safeReason(isObject(result) ? result.reason : undefined, fallback),
)

const task9Unavailable = (command) => outcome(
  command.command_id,
  command.type,
  'HELD',
  'PREMERGE_AUTHORITY_UNAVAILABLE',
  { external_terminal: Object.freeze({ phase: 'CLOSED', terminal_class: 'HELD', reason_code: 'PREMERGE_AUTHORITY_UNAVAILABLE' }) },
)

const validReleaseRequest = (request) => {
  const keys = ['attestation_ref', 'attestation_digest', 'issuer_id', 'issuer_version', 'owner_session', 'provider', 'provider_session_id', 'execution_context_id', 'lease_id', 'generation', 'head_sha', 'scope_digest', 'worktree_path_digest', 'observed_at', 'expires_at', 'nonce', 'revocation_epoch']
  if (!exactKeys(request, ['lease_id', 'expected_oid', 'expected_envelope_oid', 'expected_envelope_transition_sequence', 'attestation']) || typeof request.lease_id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{1,127}$/u.test(request.lease_id) || !/^[0-9a-f]{40}$/u.test(request.expected_oid) || !/^[0-9a-f]{40}$/u.test(request.expected_envelope_oid) || request.expected_envelope_oid === '0'.repeat(40) || !Number.isSafeInteger(request.expected_envelope_transition_sequence) || request.expected_envelope_transition_sequence < 0 || !exactKeys(request.attestation, keys)) return false
  const proof = request.attestation
  return proof.lease_id === request.lease_id && proof.issuer_id !== proof.owner_session && ['codex', 'claude'].includes(proof.provider) && ['attestation_ref', 'issuer_id', 'issuer_version', 'owner_session', 'provider_session_id', 'execution_context_id', 'lease_id'].every((key) => typeof proof[key] === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:/-]{1,127}$/u.test(proof[key])) && ['attestation_digest', 'scope_digest', 'worktree_path_digest'].every((key) => /^[0-9a-f]{64}$/u.test(proof[key])) && /^[0-9a-f]{40}$/u.test(proof.head_sha) && typeof proof.nonce === 'string' && /^[A-Za-z0-9_-]{32,128}$/u.test(proof.nonce) && Number.isSafeInteger(proof.generation) && proof.generation > 0 && Number.isSafeInteger(proof.revocation_epoch) && proof.revocation_epoch >= 0 && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(proof.observed_at) && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(proof.expires_at) && Date.parse(proof.observed_at) < Date.parse(proof.expires_at)
}
const validRetainedReleaseRequest = (request) => isObject(request) &&
  exactKeys(request, ['lease_ids', 'expected_oid', 'nonce', 'owner_attestation']) &&
  Array.isArray(request.lease_ids) && request.lease_ids.length > 0 && request.lease_ids.length <= 256 &&
  new Set(request.lease_ids).size === request.lease_ids.length &&
  request.lease_ids.every((leaseId) => typeof leaseId === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:/-]{1,127}$/u.test(leaseId)) &&
  typeof request.expected_oid === 'string' && /^[0-9a-f]{40}$/u.test(request.expected_oid) &&
  typeof request.nonce === 'string' && /^[A-Za-z0-9_-]{32,128}$/u.test(request.nonce) && isObject(request.owner_attestation)

const validReleased = (result, request) => isObject(result) && exactKeys(result, ['status', 'oid', 'lease']) && result.status === 'RELEASED' && /^[0-9a-f]{40}$/u.test(result.oid) && isObject(result.lease) && exactKeys(result.lease, ['lease_id', 'state', 'retention_state', 'release_record']) && result.lease.lease_id === request.lease_id && result.lease.state === 'RELEASED' && result.lease.retention_state === 'RETAINED_FOR_REVIEW' && isObject(result.lease.release_record) && exactKeys(result.lease.release_record, ['owner_end_attestation_ref', 'owner_end_attestation_digest']) && result.lease.release_record.owner_end_attestation_ref === request.attestation.attestation_ref && result.lease.release_record.owner_end_attestation_digest === request.attestation.attestation_digest
const bound = (value, keys, status, bindings) => isObject(value) && exactKeys(value, keys) && value.status === status && Object.entries(bindings).every(([key, expected]) => value[key] === expected)
const validPlanSnapshot = (value, planId) => {
  if (!isObject(value) || !exactKeys(value, ['oid', 'record']) || !/^[0-9a-f]{40}$/u.test(value.oid)) return undefined
  if (value.record === null) return value
  const record = value.record
  if (!exactKeys(record, ['schema_version', 'generation', 'nonce', 'created_at', 'updated_at', 'plan', 'plan_digest', 'execution', 'canonical_digest']) || record.schema_version !== 'delivery-plan-registry/v1' || !Number.isSafeInteger(record.generation) || record.generation < 1 || !/^[0-9a-f]{64}$/u.test(record.plan_digest) || !/^[0-9a-f]{64}$/u.test(record.canonical_digest) || !exactKeys(record.execution, ['level', 'side_effect_class']) || record.execution.level !== 'plan_only' || record.execution.side_effect_class !== 'CONTROL_METADATA') return undefined
  try { const plan = parseDeliveryPlan(record.plan); return plan.plan_id === planId && plan.generation === record.generation && digestCanonical(plan) === record.plan_digest ? value : undefined } catch { return undefined }
}
const validLeaseSnapshot = (value, planId) => {
  if (!isObject(value) || !exactKeys(value, ['oid', 'record']) || !/^[0-9a-f]{40}$/u.test(value.oid)) return undefined
  if (value.record === null) return value
  try {
    const record = parseSessionLeaseRegistry(value.record)
    // Every plan-owned collection is projected, and the projection is re-authenticated so
    // it neither leaks another plan's state nor fails a consumer's registry parse.
    const ownedByPlan = (entry) => entry?.plan_id === planId
    const leases = Object.fromEntries(Object.entries(record.leases).filter(([, lease]) => ownedByPlan(lease)))
    const retainedResources = Object.fromEntries(Object.entries(record.retained_resources).filter(([, stub]) => ownedByPlan(stub)))
    const drainingPlans = Object.fromEntries(Object.entries(record.draining_plans).filter(([, drain]) => ownedByPlan(drain)))
    const usedOwnerEndAttestations = Object.fromEntries(Object.entries(record.used_owner_end_attestations)
      .filter(([, used]) => Object.hasOwn(leases, used.lease_id) || Object.hasOwn(retainedResources, used.lease_id)))
    const { canonical_digest: sourceDigest, ...unsigned } = {
      ...record, leases, retained_resources: retainedResources, draining_plans: drainingPlans, used_owner_end_attestations: usedOwnerEndAttestations,
    }
    const projected = parseSessionLeaseRegistry({ ...unsigned, canonical_digest: digestCanonical(unsigned) })
    return deepFreeze({ oid: value.oid, record: projected, projection: { scope: 'plan', plan_id: planId, source_oid: value.oid, source_digest: sourceDigest } })
  } catch { return undefined }
}

const STABLE_ADVANCE_BINDINGS = Object.freeze([
  'plan_id', 'generation', 'task_id', 'owner_session', 'provider', 'provider_session_id',
  'execution_context_id', 'repo_identity_digest', 'common_dir_digest', 'baseline_sha', 'scope_digest',
])
const ADMISSION_ADVANCE_BINDINGS = Object.freeze([
  'plan_id', 'generation', 'task_id', 'provider', 'owner_session', 'provider_session_id',
  'execution_context_id', 'common_dir_digest', 'worktree_id', 'worktree_path_digest',
  'branch', 'scope_digest', 'head_sha', 'lease_id',
])
const PROVIDER_ADVANCE_BINDINGS = Object.freeze([
  'owner_session', 'provider', 'provider_session_id', 'execution_context_id', 'lease_id',
  'repo_identity_digest', 'common_dir_digest', 'worktree_id', 'worktree_path_digest',
  'branch', 'baseline_sha', 'head_sha', 'scope_digest',
])
const exactBinding = (left, right, keys) => keys.every((key) => own(left, key) && own(right, key) && left[key] === right[key])
const resourceFromKey = (key) => {
  if (typeof key !== 'string') return undefined
  const separator = key.indexOf(':')
  if (separator < 1) return undefined
  const kind = key.slice(0, separator)
  const value = key.slice(separator + 1)
  if (kind === 'path') return { kind, path: value }
  if (kind === 'glob') return { kind, pattern: value }
  if (kind === 'rename') {
    const endpoints = value.split(':')
    return endpoints.length === 2 ? { kind, old_path: endpoints[0], new_path: endpoints[1] } : undefined
  }
  if (['shared_contract', 'exported_symbol', 'schema', 'event', 'migration', 'runtime'].includes(kind)) return { kind, resource_key: value }
  return undefined
}
const canonicalResourceKey = (resource) => resource.kind === 'path'
  ? `path:${resource.path}`
  : resource.kind === 'glob'
    ? `glob:${resource.pattern}`
    : resource.kind === 'rename'
      ? `rename:${resource.old_path}:${resource.new_path}`
      : `${resource.kind}:${resource.resource_key}`
const admissionScopeIsBound = (admission) => {
  try {
    if (!Array.isArray(admission.resource_keys) || admission.resource_keys.length < 1 || admission.resource_keys.length > 256) return false
    const scope = admission.resource_keys.map((key) => {
      const candidate = resourceFromKey(key)
      if (!candidate) throw new Error('resource_key_invalid')
      const resource = normalizeScopeResource(candidate)
      if (canonicalResourceKey(resource) !== key) throw new Error('resource_key_not_canonical')
      return resource
    })
    scope.sort((left, right) => canonicalResourceKey(left).localeCompare(canonicalResourceKey(right)))
    return new Set(admission.resource_keys).size === admission.resource_keys.length && digestCanonical(scope) === admission.scope_digest
  } catch { return false }
}
const advanceBindingsValid = (command) => {
  const current = command.envelope
  const transition = command.advance_command?.next_envelope
  const admission = command.admission
  const executionContext = command.provider_request?.execution_context
  const expected = executionContext?.expected
  const attestation = executionContext?.attestation
  return isObject(current) && isObject(transition) && isObject(admission) && isObject(expected) && isObject(attestation) &&
    transition.current_level === command.advance_command.next_level &&
    exactBinding(current, transition, STABLE_ADVANCE_BINDINGS) &&
    exactBinding(transition, admission, ADMISSION_ADVANCE_BINDINGS) &&
    exactBinding(transition, expected, PROVIDER_ADVANCE_BINDINGS) &&
    admissionScopeIsBound(admission) &&
    typeof attestation.attestation_ref === 'string' && admission.context_attestation_ref === attestation.attestation_ref
}

const activePlanTask = (value, command) => {
  if (!isObject(value) || !exactKeys(value, ['status', 'plan_id', 'generation', 'oid', 'task']) || value.status !== 'ACTIVE' ||
      value.plan_id !== command.envelope.plan_id || value.generation !== command.envelope.generation ||
      !/^[0-9a-f]{40}$/u.test(value.oid) || value.oid === '0'.repeat(40)) return undefined
  const task = value.task
  // A task with predecessors sits on its integrated parent (the predecessor handoff
  // head, verified by the dependency authority), not on the plan-wide baseline.
  const dependent = isObject(task) && Array.isArray(task.dependencies) && task.dependencies.length > 0
  if (!isObject(task) || !exactKeys(task, ['task_id', 'owner_session', 'provider', 'baseline_sha', 'scope_digest', 'dependencies']) ||
      task.task_id !== command.envelope.task_id || task.owner_session !== command.envelope.owner_session ||
      task.provider !== command.envelope.provider || (!dependent && task.baseline_sha !== command.envelope.baseline_sha) ||
      task.scope_digest !== command.envelope.scope_digest || !Array.isArray(task.dependencies) || task.dependencies.length > 64 ||
      new Set(task.dependencies).size !== task.dependencies.length ||
      task.dependencies.some((dependency) => typeof dependency !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{1,127}$/u.test(dependency) || dependency === task.task_id)) return undefined
  return task
}

const dependencyAuthorityReady = (value, command, task) => isObject(value) && exactKeys(value, [
  'status', 'plan_id', 'generation', 'task_id', 'expected_parent_sha', 'dependency_count',
]) && value.status === 'READY' && value.plan_id === command.envelope.plan_id &&
  value.generation === command.envelope.generation && value.task_id === command.envelope.task_id &&
  value.expected_parent_sha === command.envelope.baseline_sha && value.dependency_count === task.dependencies.length

export function createParallelDeliveryFabric(ports) {
  const capabilities = configured(ports)
  const ready = capabilities !== undefined
  const inFlight = new Map()

  const dispatchOnce = async (rawCommand = undefined) => {
    try {
      const command = safeSnapshot(rawCommand)
      if (!command) return outcome(undefined, undefined, 'HELD', 'COMMAND_INPUT_UNSAFE')
      const type = command.type
      const commandId = command.command_id
      if (!isObject(command) || !COMMAND_TYPES.has(type)) return outcome(commandId, type, 'HELD', 'COMMAND_TYPE_INVALID')
      if (!commandShapeIsValid(command)) return outcome(commandId, type, 'HELD', 'COMMAND_SCHEMA_INVALID')
      if (!ready) return outcome(commandId, type, 'HELD', 'ORCHESTRATOR_PORTS_INVALID')
      if (type === 'submit' && !submittedPlanIsMetadataOnly(command)) return outcome(commandId, type, 'HELD', 'PLAN_ONLY_REQUIRED')
      const retainedRelease = type === 'release' && Array.isArray(command.release_request?.lease_ids)
      if (type === 'release' && !(retainedRelease ? validRetainedReleaseRequest(command.release_request) : validReleaseRequest(command.release_request))) {
        return outcome(commandId, type, 'HELD', 'RELEASE_REQUEST_INVALID')
      }

      const commandDigest = digestCanonical(command)
      const attemptId = `attempt:${randomUUID()}`
      const journal = journalKey(command.command_id)
      const reservation = reservationId(command.command_id, commandDigest, attemptId)
      let existing
      try { existing = await capabilities.commandJournal.read({ journal_key: journal, command_id: command.command_id }) } catch { return outcome(command.command_id, type, 'HELD', 'COMMAND_RECEIPT_UNAVAILABLE') }
      if (existing !== null && existing !== undefined) {
        const persisted = safeSnapshot(existing)
        if (!persisted || persisted.command_digest !== commandDigest || persisted.command_id !== command.command_id) return outcome(command.command_id, type, 'HELD', 'COMMAND_ID_REUSE')
        const expectedReservation = typeof persisted.attempt_id === 'string' ? reservationId(command.command_id, commandDigest, persisted.attempt_id) : undefined
        const priorReservation = receipt(persisted, command, commandDigest, expectedReservation, 'RESERVED', undefined, persisted.attempt_id, journal)
        if (priorReservation) return outcome(command.command_id, type, 'HELD', 'COMMAND_RECEIPT_RECOVERY_REQUIRED')
        const prior = receipt(persisted, command, commandDigest, expectedReservation, 'COMMITTED', undefined, undefined, journal)
        return prior === undefined ? outcome(command.command_id, type, 'HELD', 'COMMAND_RECEIPT_INVALID') : prior.outcome
      }

      let reserved
      try { reserved = await capabilities.commandJournal.reserve({ journal_key: journal, command_id: command.command_id, command_digest: commandDigest, attempt_id: attemptId, reservation_id: reservation }) } catch { return outcome(command.command_id, type, 'HELD', 'COMMAND_RECEIPT_UNAVAILABLE') }
      if (!receipt(reserved, command, commandDigest, reservation, 'RESERVED', undefined, attemptId, journal)) return outcome(command.command_id, type, 'HELD', 'COMMAND_RECEIPT_CONFLICT')

      let next
      if (type === 'submit') {
        let result
        try { result = safePortResult(await capabilities.planRegistry.submit({ plan: command.plan, expected_oid: command.expected_oid, nonce: command.nonce, execution: command.execution, effects: command.effects })) } catch { result = undefined }
        next = bound(result, ['status', 'plan_id'], 'STORED', { plan_id: command.plan.plan_id })
          ? outcome(command.command_id, type, 'SHADOW_STORED', 'PLAN_STORED')
          : outcome(command.command_id, type, 'HELD', safeReason(result?.reason, 'PLAN_REGISTRY_UNAVAILABLE'))
      } else if (type === 'advance') {
        if (!isObject(command.envelope) || !isObject(command.advance_command) || NEXT_LEVEL[command.envelope.current_level] !== command.advance_command.next_level) {
          next = outcome(command.command_id, type, 'HELD', 'ADVANCE_TRANSITION_INVALID')
        } else if (command.advance_command.next_level === 'submit_delivery') {
          next = task9Unavailable(command)
        } else if (!advanceBindingsValid(command)) {
          next = outcome(command.command_id, type, 'HELD', 'ADVANCE_BINDING_MISMATCH')
        } else {
          let plan
          try {
            plan = safePortResult(await capabilities.planRegistry.validateGeneration({
              plan_id: command.envelope.plan_id,
              generation: command.envelope.generation,
              task_id: command.envelope.task_id,
            }))
          } catch { plan = undefined }
          const task = activePlanTask(plan, command)
          if (!task) {
            const activePlanOid = plan?.status === 'ACTIVE' && typeof plan?.oid === 'string' && /^[0-9a-f]{40}$/u.test(plan.oid) && plan.oid !== '0'.repeat(40)
            next = heldFromPort(command, activePlanOid ? 'PLAN_TASK_BINDING_MISMATCH' : 'PLAN_GENERATION_UNAVAILABLE', plan)
          } else {
            let dependencyAuthority
            if (task.dependencies.length > 0) {
              try {
                dependencyAuthority = safePortResult(await capabilities.leaseRegistry.validateDependencies({
                  plan_id: command.envelope.plan_id,
                  generation: command.envelope.generation,
                  task_id: command.envelope.task_id,
                  dependency_task_ids: task.dependencies,
                  expected_parent_sha: command.envelope.baseline_sha,
                }))
              } catch { dependencyAuthority = undefined }
            }
            if (task.dependencies.length > 0 && !dependencyAuthorityReady(dependencyAuthority, command, task)) {
              next = heldFromPort(command, 'DEPENDENCY_AUTHORITY_UNAVAILABLE', dependencyAuthority)
            } else {
              let execution
              try { execution = safePortResult(await capabilities.execution.advance(command.envelope, command.advance_command)) } catch { execution = undefined }
              if (!bound(execution, ['status', 'next_level'], 'SHADOW_INTENT', { next_level: command.advance_command.next_level })) {
                next = heldFromPort(command, 'EXECUTION_VALIDATION_UNAVAILABLE', execution)
              } else {
                const provider = command.envelope?.provider
                const adapter = provider === 'codex' || provider === 'claude' ? capabilities.providerAdapters[provider] : undefined
                let preflight
                try { preflight = adapter ? safePortResult(await adapter.preflight(command.provider_request)) : undefined } catch { preflight = undefined }
                if (!bound(preflight, ['status', 'provider'], 'READY_FOR_SHADOW', { provider })) {
                  next = heldFromPort(command, 'PROVIDER_PREFLIGHT_UNAVAILABLE', preflight)
                } else {
                  let admission
                  try {
                    const guardedAdmission = { ...command.admission, expected_plan_oid: plan.oid }
                    admission = safePortResult(await (command.envelope.current_level === 'plan_only'
                      ? capabilities.leaseRegistry.admit(guardedAdmission)
                      : capabilities.leaseRegistry.validateActive(guardedAdmission)))
                  } catch { admission = undefined }
                  if (bound(admission, ['status', 'reason'], 'QUEUED_FOR_LEASE', {})) {
                    next = outcome(command.command_id, type, 'QUEUED', safeReason(admission.reason, 'LEASE_CAPACITY_UNAVAILABLE'))
                  } else {
                    const expectedStatus = command.envelope.current_level === 'plan_only' ? 'ADMITTED' : 'ACTIVE'
                    next = bound(admission, ['status', 'lease_id'], expectedStatus, { lease_id: command.admission.lease_id })
                      ? outcome(command.command_id, type, 'SHADOW_INTENT', 'ADVANCE_READY_FOR_SHADOW')
                      : heldFromPort(command, 'ADMISSION_UNAVAILABLE', admission)
                  }
                }
              }
            }
          }
        }
      } else if (type === 'reconcile') {
        let reconciliation
        try { reconciliation = safePortResult(await capabilities.leaseRegistry.reconcileTimeout(command.reconcile_request)) } catch { reconciliation = undefined }
        if (bound(reconciliation, ['status', 'lease_id'], 'RELEASED', { lease_id: command.reconcile_request.lease_id })) {
          next = outcome(command.command_id, type, 'HELD', 'RECONCILE_RELEASE_FORBIDDEN')
        } else if (!isObject(reconciliation) || !exactKeys(reconciliation, ['status', 'lease_id']) || !RECONCILE_STATUSES.has(reconciliation.status) || reconciliation.lease_id !== command.reconcile_request.lease_id) {
          next = heldFromPort(command, 'RECONCILE_UNAVAILABLE', reconciliation)
        } else if (capabilities.projection !== undefined) {
          let projection
          try { projection = safePortResult(await capabilities.projection.reconcile({ reconciliation })) } catch { projection = undefined }
          next = bound(projection, ['status', 'lease_id'], 'PROJECTION_READY', { lease_id: command.reconcile_request.lease_id })
            ? outcome(command.command_id, type, 'SHADOW_STORED', 'RECONCILED')
            : heldFromPort(command, 'PROJECTION_UNAVAILABLE', projection)
        } else next = outcome(command.command_id, type, 'HELD', 'PROJECTION_DEGRADED')
      } else if (type === 'drain') {
        let plan
        try { plan = safePortResult(await capabilities.planRegistry.validateGeneration({ plan_id: command.drain_request.plan_id, generation: command.drain_request.generation })) } catch { plan = undefined }
        if (!bound(plan, ['status', 'plan_id', 'generation', 'oid'], 'ACTIVE', { plan_id: command.drain_request.plan_id, generation: command.drain_request.generation }) || !/^[0-9a-f]{40}$/u.test(plan.oid) || plan.oid === '0'.repeat(40)) {
          next = heldFromPort(command, 'PLAN_GENERATION_UNAVAILABLE', plan)
        } else {
          let drained
          try { drained = safePortResult(await capabilities.leaseRegistry.drainPlan({ ...command.drain_request, expected_plan_oid: plan.oid })) } catch { drained = undefined }
          next = bound(drained, ['status', 'plan_id'], 'DRAINING', { plan_id: command.drain_request.plan_id })
            ? outcome(command.command_id, type, 'SHADOW_STORED', 'PLAN_DRAINING')
            : heldFromPort(command, 'PLAN_DRAIN_UNAVAILABLE', drained)
        }
      } else if (type === 'release') {
        if (!retainedRelease) {
          // Ordinary lease release still requires the sequenced envelope path.
          next = outcome(command.command_id, type, 'HELD', 'RELEASE_AUTHORITY_UNAVAILABLE')
        } else {
          let released
          try { released = safePortResult(await capabilities.leaseRegistry.releaseRetainedResources(command.release_request)) } catch { released = undefined }
          next = bound(released, ['status'], 'RETENTION_RELEASED', {})
            ? outcome(command.command_id, type, 'SHADOW_STORED', 'RETENTION_RELEASED')
            : heldFromPort(command, 'RETENTION_RELEASE_AUTHORITY_UNAVAILABLE', released)
        }
      } else {
        next = outcome(command.command_id, type, 'HELD', 'COMMAND_NOT_IMPLEMENTED')
      }

      try {
        const outcomeDigest = digestCanonical(next)
        const committed = await capabilities.commandJournal.commit({ journal_key: journal, command_id: command.command_id, command_digest: commandDigest, attempt_id: attemptId, reservation_id: reservation, outcome_digest: outcomeDigest, outcome: next })
        if (!receipt(committed, command, commandDigest, reservation, 'COMMITTED', next, attemptId, journal)) return outcome(command.command_id, type, 'HELD', 'COMMAND_RECEIPT_COMMIT_FAILED')
      } catch {
        return outcome(command.command_id, type, 'HELD', 'COMMAND_RECEIPT_COMMIT_FAILED')
      }
      return next
    } catch {
      return outcome(undefined, undefined, 'HELD', 'COMMAND_INPUT_INVALID')
    }
  }

  const dispatch = async (rawCommand = undefined) => {
    const command = safeSnapshot(rawCommand)
    if (!command || typeof command.command_id !== 'string') return dispatchOnce(rawCommand)
    const digest = digestCanonical(command)
    const active = inFlight.get(command.command_id)
    if (active) return active.digest === digest ? safeSnapshot(await active.promise) : outcome(command.command_id, command.type, 'HELD', 'COMMAND_ID_REUSE')
    const promise = dispatchOnce(command)
    inFlight.set(command.command_id, { digest, promise })
    try { return await promise } finally { if (inFlight.get(command.command_id)?.promise === promise) inFlight.delete(command.command_id) }
  }

  const inspect = async (planId) => {
    if (!ready || typeof planId !== 'string' || planId.length < 3 || planId.length > 256 || !safeInput(planId)) return outcome(planId, 'inspect', 'HELD', 'INSPECT_INPUT_INVALID')
    try {
      const [plan, leases] = await Promise.all([capabilities.planRegistry.inspect(planId), capabilities.leaseRegistry.inspect(planId)])
      const safePlan = plainData(plan)
      const safeLeases = plainData(leases)
      const planSnapshot = validPlanSnapshot(safePlan, planId)
      const leaseSnapshot = validLeaseSnapshot(safeLeases, planId)
      if (!planSnapshot || !leaseSnapshot) return outcome(planId, 'inspect', 'HELD', 'INSPECT_OUTPUT_UNSAFE')
      return deepFreeze({ plan_id: planId, plan: planSnapshot, leases: leaseSnapshot })
    } catch {
      return outcome(planId, 'inspect', 'HELD', 'INSPECT_UNAVAILABLE')
    }
  }

  return Object.freeze({ dispatch, inspect })
}
