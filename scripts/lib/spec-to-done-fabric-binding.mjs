import {
  canonicalize,
  digestCanonical,
  normalizeScopeResource,
  parseDeliveryPlan,
  parseProviderSessionEnvelope,
} from './parallel-delivery-fabric-contract.mjs'
import { evaluateScopeDrift, normalizeScope } from './parallel-delivery-fabric-admission.mjs'
import { parseSessionLease } from './parallel-delivery-fabric-registry.mjs'

export const FABRIC_BINDING_SCHEMA_VERSION = 'spec-to-done-fabric-binding/v1'

const SHA1 = /^[0-9a-f]{40}$/u
const SHA256 = /^[0-9a-f]{64}$/u
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u

const CAPACITY_SEMANTICS = Object.freeze({
  session_admission_limit: 'unbounded',
  run_writer_cardinality: 1,
  requested_capacity_writers: 'plan_local_request_only',
  activation_writer_cap: 'review_or_direct_stack_only',
})

const RECOVERY_POLICY = Object.freeze({
  held_lease_action: 'retain_as_suspect',
  local_new_run_allowed: false,
  local_resume_allowed: false,
  verified_resume_intent_required: true,
})

const DELIVERY_AUTHORITY = Object.freeze({
  push: false,
  approve: false,
  merge: false,
  deploy: false,
  process_termination: false,
  branch_protection_mutation: false,
  review_migration: false,
  direct_stack: false,
})

const BINDING_KEYS = Object.freeze([
  'schema_version',
  'binding_id',
  'slug',
  'fabric_tuple',
  'lease_state_at_binding',
  'source_digests',
  'task_scope_resources',
  'allowed_paths',
  'state_relative_path',
  'binding_relative_path',
  'capacity_semantics',
  'recovery_policy',
  'delivery_authority',
])

const TUPLE_KEYS = Object.freeze([
  'plan_id',
  'generation',
  'task_id',
  'lease_id',
  'owner_session',
  'provider',
  'scope_digest',
  'baseline_sha',
  'branch',
  'worktree_path_digest',
])

export class SpecToDoneFabricBindingError extends Error {
  constructor(code, detail) {
    super(`${code}${detail ? `: ${detail}` : ''}`)
    this.name = 'SpecToDoneFabricBindingError'
    this.code = code
    this.detail = detail ?? null
  }
}

const fail = (code, detail) => {
  throw new SpecToDoneFabricBindingError(code, detail)
}

const isPlainObject = (value) => (
  value !== null && typeof value === 'object' && !Array.isArray(value) &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
)

const exactKeys = (value, expected, context) => {
  if (!isPlainObject(value)) fail('fabric_binding_invalid', `${context}_must_be_object`)
  const actual = Object.keys(value).sort()
  const canonical = [...expected].sort()
  if (actual.length !== canonical.length || actual.some((key, index) => key !== canonical[index])) {
    fail('fabric_binding_invalid', `${context}_keys_invalid`)
  }
}

const deepFreeze = (value) => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze(nested)
    Object.freeze(value)
  }
  return value
}

const sameCanonical = (left, right) => digestCanonical(left) === digestCanonical(right)

const assertEqual = (left, right, context) => {
  if (left !== right) fail('fabric_tuple_drift', context)
}

const assertCanonicalObject = (actual, expected, context) => {
  exactKeys(actual, Object.keys(expected), context)
  if (!sameCanonical(actual, expected)) fail('fabric_binding_invalid', `${context}_value_invalid`)
}

const assertSha = (value, expression, context) => {
  if (typeof value !== 'string' || !expression.test(value)) fail('fabric_binding_invalid', context)
}

const canonicalSlug = (value) => {
  if (typeof value !== 'string' || value.length > 96 || !SLUG.test(value)) {
    fail('fabric_binding_invalid', 'slug_invalid')
  }
  return value
}

const canonicalAllowedPaths = (values) => {
  if (!Array.isArray(values) || values.length === 0 || values.length > 256) {
    fail('scope_drift', 'allowed_paths_required')
  }
  let paths
  try {
    paths = values.map((path) => normalizeScopeResource({ kind: 'path', path }).path).sort()
  } catch (error) {
    fail('scope_drift', error?.code || 'allowed_path_invalid')
  }
  if (new Set(paths).size !== paths.length) fail('scope_drift', 'allowed_paths_duplicate')
  return paths
}

const stableLeaseProjection = (lease) => ({
  schema_version: lease.schema_version,
  generation: lease.generation,
  lease_id: lease.lease_id,
  lease_kind: lease.lease_kind,
  plan_id: lease.plan_id,
  task_id: lease.task_id,
  provider: lease.provider,
  owner_session: lease.owner_session,
  provider_session_id: lease.provider_session_id,
  execution_context_id: lease.execution_context_id,
  context_attestation_ref: lease.context_attestation_ref,
  common_dir_digest: lease.common_dir_digest,
  worktree_id: lease.worktree_id,
  worktree_path_digest: lease.worktree_path_digest,
  branch: lease.branch,
  scope_digest: lease.scope_digest,
  resource_keys: [...lease.resource_keys],
})

const stableProviderProjection = (session) => ({
  schema_version: session.schema_version,
  plan_id: session.plan_id,
  generation: session.generation,
  task_id: session.task_id,
  provider: session.provider,
  owner_session: session.owner_session,
  provider_session_id: session.provider_session_id,
  execution_context_id: session.execution_context_id,
  repo_identity_digest: session.repo_identity_digest,
  common_dir_digest: session.common_dir_digest,
  worktree_id: session.worktree_id,
  worktree_path_digest: session.worktree_path_digest,
  branch: session.branch,
  baseline_sha: session.baseline_sha,
  scope_digest: session.scope_digest,
  resource_keys: [...session.resource_keys],
  lease_id: session.lease_id,
  context_attestation_ref: session.context_attestation_ref,
  context_attestation_digest: session.context_attestation_digest,
  adapter_version: session.adapter_version,
})

const stableSourceDigests = ({ plan, task, lease, providerSession }) => ({
  plan: digestCanonical(plan),
  task: digestCanonical(task),
  lease: digestCanonical(stableLeaseProjection(lease)),
  provider_session: digestCanonical(stableProviderProjection(providerSession)),
})

const changedEvidenceFor = (paths) => paths.map((path) => `M\0${path}\0`).join('')

const validateScopeContainment = (taskScopeResources, allowedPaths, scopeDigest) => {
  const outcome = evaluateScopeDrift(taskScopeResources, changedEvidenceFor(allowedPaths))
  if (outcome.status !== 'SCOPE_EVIDENCE_ACCEPTED' || outcome.reason !== 'SCOPE_COVERED') {
    fail('scope_drift', outcome.reason || 'scope_unproven')
  }
  assertEqual(outcome.scope_digest, scopeDigest, 'scope_digest')
}

const parseFabricSources = ({ plan: rawPlan, lease: rawLease, provider_session: rawProviderSession }, { requireActive }) => {
  const plan = parseDeliveryPlan(rawPlan)
  if (!isPlainObject(rawLease) || typeof rawLease.lease_id !== 'string') {
    fail('fabric_binding_invalid', 'lease_invalid')
  }
  const lease = parseSessionLease(rawLease, rawLease.lease_id)
  const providerSession = parseProviderSessionEnvelope(rawProviderSession)
  const task = plan.tasks.find((candidate) => candidate.task_id === providerSession.task_id)
  if (!task) fail('fabric_tuple_drift', 'task_missing_from_plan')

  if (requireActive && lease.state !== 'ACTIVE') fail('fabric_lease_invalid', 'binding_requires_active_lease')
  if (!['ACTIVE', 'SUSPECT'].includes(lease.state)) fail('fabric_lease_invalid', 'lease_not_retained')
  const expectedHeartbeat = lease.state === 'SUSPECT' ? 'SUSPECT' : 'ACTIVE'
  assertEqual(providerSession.heartbeat_state, expectedHeartbeat, 'heartbeat_state')

  const taskScopeResources = normalizeScope(task.scope.resources)
  const scopeDigest = digestCanonical(taskScopeResources)
  const comparisons = {
    plan_id: [plan.plan_id, lease.plan_id, providerSession.plan_id],
    generation: [plan.generation, lease.generation, providerSession.generation],
    task_id: [task.task_id, lease.task_id, providerSession.task_id],
    lease_id: [lease.lease_id, providerSession.lease_id],
    owner_session: [task.owner_session, lease.owner_session, providerSession.owner_session],
    provider: [task.provider_preference, lease.provider, providerSession.provider],
    scope_digest: [scopeDigest, lease.scope_digest, providerSession.scope_digest],
    baseline_sha: [plan.resolved_baseline_sha, providerSession.baseline_sha],
    branch: [lease.branch, providerSession.branch],
    worktree_path_digest: [lease.worktree_path_digest, providerSession.worktree_path_digest],
    provider_session_id: [lease.provider_session_id, providerSession.provider_session_id],
    execution_context_id: [lease.execution_context_id, providerSession.execution_context_id],
    common_dir_digest: [lease.common_dir_digest, providerSession.common_dir_digest],
    worktree_id: [lease.worktree_id, providerSession.worktree_id],
    context_attestation_ref: [lease.context_attestation_ref, providerSession.context_attestation_ref],
    head_sha: [lease.head_sha, providerSession.evidence_head_sha],
  }
  for (const [field, values] of Object.entries(comparisons)) {
    const [first, ...rest] = values
    if (rest.some((value) => value !== first)) fail('fabric_tuple_drift', field)
  }
  if (!sameCanonical(lease.resource_keys, providerSession.resource_keys)) {
    fail('fabric_tuple_drift', 'resource_keys')
  }

  const fabricTuple = {
    plan_id: plan.plan_id,
    generation: plan.generation,
    task_id: task.task_id,
    lease_id: lease.lease_id,
    owner_session: task.owner_session,
    provider: task.provider_preference,
    scope_digest: scopeDigest,
    baseline_sha: plan.resolved_baseline_sha,
    branch: lease.branch,
    worktree_path_digest: lease.worktree_path_digest,
  }

  return deepFreeze({
    plan,
    task,
    lease,
    providerSession,
    fabricTuple,
    taskScopeResources,
    sourceDigests: stableSourceDigests({ plan, task, lease, providerSession }),
  })
}

const bindingIdentity = ({ slug, fabricTuple, allowedPaths }) => ({
  schema_version: FABRIC_BINDING_SCHEMA_VERSION,
  slug,
  fabric_tuple: fabricTuple,
  allowed_paths: allowedPaths,
})

export const deriveFabricManagedStateRelativePath = (slug, bindingId) => {
  canonicalSlug(slug)
  assertSha(bindingId, SHA256, 'binding_id_invalid')
  return `artifacts/spec-to-done/${slug}--${bindingId}-state.md`
}

export const deriveFabricBindingRelativePath = (bindingId) => {
  assertSha(bindingId, SHA256, 'binding_id_invalid')
  return `artifacts/spec-to-done/bindings/${bindingId}.json`
}

export function buildSpecToDoneFabricBinding(input) {
  if (!isPlainObject(input)) fail('fabric_binding_invalid', 'input_must_be_object')
  exactKeys(input, ['slug', 'allowed_paths', 'plan', 'lease', 'provider_session'], 'input')
  const slug = canonicalSlug(input.slug)
  const allowedPaths = canonicalAllowedPaths(input.allowed_paths)
  const sources = parseFabricSources(input, { requireActive: true })
  validateScopeContainment(sources.taskScopeResources, allowedPaths, sources.fabricTuple.scope_digest)

  const bindingId = digestCanonical(bindingIdentity({
    slug,
    fabricTuple: sources.fabricTuple,
    allowedPaths,
  }))
  const binding = canonicalize({
    schema_version: FABRIC_BINDING_SCHEMA_VERSION,
    binding_id: bindingId,
    slug,
    fabric_tuple: sources.fabricTuple,
    lease_state_at_binding: 'ACTIVE',
    source_digests: sources.sourceDigests,
    task_scope_resources: sources.taskScopeResources,
    allowed_paths: allowedPaths,
    state_relative_path: deriveFabricManagedStateRelativePath(slug, bindingId),
    binding_relative_path: deriveFabricBindingRelativePath(bindingId),
    capacity_semantics: CAPACITY_SEMANTICS,
    recovery_policy: RECOVERY_POLICY,
    delivery_authority: DELIVERY_AUTHORITY,
  })
  return deepFreeze(binding)
}

export function validateSpecToDoneFabricBinding({ binding: rawBinding, plan, lease, provider_session }) {
  const binding = canonicalize(rawBinding)
  exactKeys(binding, BINDING_KEYS, 'binding')
  if (binding.schema_version !== FABRIC_BINDING_SCHEMA_VERSION) {
    fail('fabric_binding_invalid', 'schema_version_invalid')
  }
  canonicalSlug(binding.slug)
  assertSha(binding.binding_id, SHA256, 'binding_id_invalid')
  exactKeys(binding.fabric_tuple, TUPLE_KEYS, 'fabric_tuple')
  if (!Number.isSafeInteger(binding.fabric_tuple.generation) || binding.fabric_tuple.generation < 1) {
    fail('fabric_binding_invalid', 'generation_invalid')
  }
  assertSha(binding.fabric_tuple.scope_digest, SHA256, 'scope_digest_invalid')
  assertSha(binding.fabric_tuple.baseline_sha, SHA1, 'baseline_sha_invalid')
  assertSha(binding.fabric_tuple.worktree_path_digest, SHA256, 'worktree_path_digest_invalid')
  if (binding.lease_state_at_binding !== 'ACTIVE') fail('fabric_binding_invalid', 'lease_state_at_binding_invalid')

  const canonicalPaths = canonicalAllowedPaths(binding.allowed_paths)
  if (!sameCanonical(canonicalPaths, binding.allowed_paths)) fail('fabric_binding_invalid', 'allowed_paths_not_canonical')
  const canonicalScope = normalizeScope(binding.task_scope_resources)
  if (!sameCanonical(canonicalScope, binding.task_scope_resources)) {
    fail('fabric_binding_invalid', 'task_scope_resources_not_canonical')
  }
  exactKeys(binding.source_digests, ['plan', 'task', 'lease', 'provider_session'], 'source_digests')
  for (const [field, value] of Object.entries(binding.source_digests)) {
    assertSha(value, SHA256, `source_digest_${field}_invalid`)
  }
  assertCanonicalObject(binding.capacity_semantics, CAPACITY_SEMANTICS, 'capacity_semantics')
  assertCanonicalObject(binding.recovery_policy, RECOVERY_POLICY, 'recovery_policy')
  assertCanonicalObject(binding.delivery_authority, DELIVERY_AUTHORITY, 'delivery_authority')

  const sources = parseFabricSources({ plan, lease, provider_session }, { requireActive: false })
  if (!sameCanonical(binding.fabric_tuple, sources.fabricTuple)) fail('fabric_tuple_drift', 'binding_tuple')
  if (!sameCanonical(binding.source_digests, sources.sourceDigests)) fail('fabric_tuple_drift', 'source_digests')
  if (!sameCanonical(binding.task_scope_resources, sources.taskScopeResources)) {
    fail('fabric_tuple_drift', 'task_scope_resources')
  }
  validateScopeContainment(sources.taskScopeResources, canonicalPaths, sources.fabricTuple.scope_digest)

  const expectedId = digestCanonical(bindingIdentity({
    slug: binding.slug,
    fabricTuple: sources.fabricTuple,
    allowedPaths: canonicalPaths,
  }))
  assertEqual(binding.binding_id, expectedId, 'binding_id')
  assertEqual(
    binding.state_relative_path,
    deriveFabricManagedStateRelativePath(binding.slug, binding.binding_id),
    'state_relative_path',
  )
  assertEqual(binding.binding_relative_path, deriveFabricBindingRelativePath(binding.binding_id), 'binding_relative_path')

  return deepFreeze({
    status: 'FABRIC_BINDING_ACCEPTED',
    reason: 'EXACT_FABRIC_TUPLE_BOUND',
    binding,
    current_lease_state: sources.lease.state,
    current_head_sha: sources.lease.head_sha,
    current_branch: sources.lease.branch,
    worktree_path_digest: sources.lease.worktree_path_digest,
    scope_digest: sources.lease.scope_digest,
    held_lease_action: RECOVERY_POLICY.held_lease_action,
  })
}
