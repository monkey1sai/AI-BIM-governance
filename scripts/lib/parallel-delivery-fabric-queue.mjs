import {
  canonicalize,
  digestCanonical,
  isCanonicalOpaqueId,
  isCanonicalOpaqueReference,
  isCanonicalUtcMillisecondTimestamp,
} from './parallel-delivery-fabric-contract.mjs'

const SHA1 = /^[0-9a-f]{40}$/u
const SHA256 = /^[0-9a-f]{64}$/u
const TUPLE_ID = /^[a-z][a-z0-9_-]*:[a-z0-9][a-z0-9._-]*$/u
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u
const SECRET_VALUE = /(?:bearer|token|cookie|authorization|private[-_]?key|gh[pousr]_|github_pat_|eyJ[A-Za-z0-9_-]{10,})/iu
const RAW_WINDOWS_SID = /(?:^|[/:])S-\d+(?:-\d+){2,}(?=$|[/:])/iu
const SENSITIVE_KEY = /(?:token|cookie|authorization|private[_-]?key|(?:^|_)sid$|(?:^|_)pid$|process[_-]?id|transcript|(?:^|_)env(?:_|$)|environment|absolute[_-]?path)/iu
const ALLOWED_GROUP = /^\$\{\{\s*github\.workflow\s*\}\}-([a-z][a-z0-9_-]{0,63})$/u
const FORBIDDEN_GROUP_RESOURCE = /(?:^|[-_])(?:github|event|ref|sha|run|candidate|merge_group)(?:$|[-_])/iu

const deepFreeze = (value) => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze(nested)
    Object.freeze(value)
  }
  return value
}
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
const exactKeys = (value, keys) => isObject(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key))
const isSha = (value) => typeof value === 'string' && SHA1.test(value)
const isDigest = (value) => typeof value === 'string' && SHA256.test(value)
const hasUnsafeString = (value) => !(SHA1.test(value) || SHA256.test(value) || isCanonicalUtcMillisecondTimestamp(value)) &&
  (SECRET_VALUE.test(value) || RAW_WINDOWS_SID.test(value))
const recursivelyPrivacySafe = (value, depth = 0) => {
  if (depth > 64) return false
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return true
  if (typeof value === 'string') return !hasUnsafeString(value)
  if (Array.isArray(value)) return value.every((entry) => recursivelyPrivacySafe(entry, depth + 1))
  if (!isObject(value)) return false
  return Object.entries(value).every(([key, entry]) => !SENSITIVE_KEY.test(key) && recursivelyPrivacySafe(entry, depth + 1))
}
const canonicalObject = (raw) => {
  try {
    const value = canonicalize(raw)
    return isObject(value) && recursivelyPrivacySafe(value) ? value : null
  } catch {
    return null
  }
}
const clone = (value) => {
  try {
    return structuredClone(value)
  } catch {
    return null
  }
}
const held = (reason) => deepFreeze({ phase: 'HELD', internal_state: 'HELD_QUEUE_CAPABILITY', reason })

const sourceIsValid = (value) => exactKeys(value, ['repository', 'workflow', 'resource_key']) &&
  typeof value.repository === 'string' && value.repository.length >= 3 && value.repository.length <= 256 &&
  REPOSITORY.test(value.repository) && !hasUnsafeString(value.repository) &&
  isCanonicalOpaqueId(value.workflow) && isCanonicalOpaqueId(value.resource_key)

const snapshotIsValid = (value) => exactKeys(value, [
  'schema_version', 'snapshot_id', 'snapshot_generation', 'observed_at', 'expires_at', 'source_digest',
  'eligibility', 'merge_group_sha', 'member_vector_digest', 'queue_position', 'group_checks_digest', 'state',
]) && value.schema_version === 'merge-queue-observation/v1' && isCanonicalOpaqueId(value.snapshot_id) &&
  Number.isSafeInteger(value.snapshot_generation) && value.snapshot_generation >= 1 && value.snapshot_generation <= 1_000_000_000 &&
  isCanonicalUtcMillisecondTimestamp(value.observed_at) && isCanonicalUtcMillisecondTimestamp(value.expires_at) &&
  Date.parse(value.expires_at) > Date.parse(value.observed_at) &&
  isDigest(value.source_digest) && ['eligible', 'unsupported', 'unknown'].includes(value.eligibility) &&
  (value.merge_group_sha === null || isSha(value.merge_group_sha)) && isDigest(value.member_vector_digest) &&
  (value.queue_position === null || (Number.isSafeInteger(value.queue_position) && value.queue_position >= 1 && value.queue_position <= 100_000)) &&
  isDigest(value.group_checks_digest) && ['OBSERVED', 'INVALIDATED', 'HELD_QUEUE_CAPABILITY'].includes(value.state)

const memberVectorIsValid = (value) => Array.isArray(value) && value.length > 0 && value.length <= 64 &&
  value.every((member) => exactKeys(member, ['pr_number', 'node_id', 'head_sha']) && Number.isSafeInteger(member.pr_number) &&
    member.pr_number >= 1 && member.pr_number <= 1_000_000_000 && isCanonicalOpaqueReference(member.node_id) && isSha(member.head_sha)) &&
  new Set(value.map((member) => member.pr_number)).size === value.length &&
  new Set(value.map((member) => member.node_id)).size === value.length

const sameCanonical = (left, right) => {
  const normalizedLeft = canonicalObject(left)
  const normalizedRight = canonicalObject(right)
  return normalizedLeft !== null && normalizedRight !== null && JSON.stringify(normalizedLeft) === JSON.stringify(normalizedRight)
}

const parseQueueEvidence = (raw) => {
  const value = canonicalObject(raw)
  if (!exactKeys(value, ['source', 'snapshot', 'member_vector']) || !sourceIsValid(value.source) ||
    !snapshotIsValid(value.snapshot) || !memberVectorIsValid(value.member_vector)) return { kind: 'held', reason: 'snapshot_shape_invalid' }
  const { source, snapshot, member_vector: memberVector } = value
  if (snapshot.source_digest !== digestCanonical(source)) return { kind: 'held', reason: 'source_pin_mismatch' }
  if (snapshot.member_vector_digest !== digestCanonical(memberVector)) return { kind: 'held', reason: 'member_vector_pin_mismatch' }
  if (snapshot.eligibility !== 'eligible') return { kind: 'held', reason: 'unsupported_queue_capability' }
  const observation = deepFreeze({ source, snapshot, member_vector: memberVector })
  if (snapshot.state === 'INVALIDATED') return { kind: 'invalidated', observation }
  if (snapshot.state !== 'OBSERVED') return { kind: 'held', reason: 'snapshot_state_unavailable' }
  if (!isSha(snapshot.merge_group_sha)) return { kind: 'held', reason: 'snapshot_state_unavailable' }
  if (memberVector.some((member) => member.head_sha === snapshot.merge_group_sha)) {
    return { kind: 'held', reason: 'merge_group_sha_impersonation' }
  }
  return { kind: 'observed', observation }
}

export function observeMergeQueueSnapshot(input = {}) {
  try {
    const value = canonicalObject(input)
    if (!exactKeys(value, ['now', 'source', 'snapshot', 'member_vector']) || !isCanonicalUtcMillisecondTimestamp(value.now)) {
      return held('snapshot_shape_invalid')
    }
    const parsed = parseQueueEvidence({ source: value.source, snapshot: value.snapshot, member_vector: value.member_vector })
    if (parsed.kind === 'held') return held(parsed.reason)
    if (Date.parse(parsed.observation.snapshot.observed_at) > Date.parse(value.now) ||
      Date.parse(parsed.observation.snapshot.expires_at) <= Date.parse(value.now)) return held('snapshot_expired')
    if (parsed.kind === 'invalidated') return deepFreeze({
      phase: 'INVALIDATED',
      internal_state: 'QUEUE_SNAPSHOT_INVALIDATED',
      observation: parsed.observation,
    })
    return deepFreeze({ phase: 'OBSERVED', internal_state: 'QUEUE_OBSERVED', observation: parsed.observation })
  } catch {
    return held('snapshot_exception')
  }
}

export function validateQueueConcurrencyPolicy(policy = {}) {
  try {
    const value = canonicalObject(policy)
    if (!exactKeys(value, ['workflow', 'resource_key', 'group', 'queue', 'cancel_in_progress']) ||
      !isCanonicalOpaqueId(value.workflow) || !isCanonicalOpaqueId(value.resource_key) ||
      typeof value.group !== 'string' || value.group.length > 128) return held('queue_policy_shape_invalid')
    if (value.queue !== 'max') return held('queue_policy_not_max')
    if (value.cancel_in_progress !== false) return held('queue_policy_cancellation_invalid')
    const match = ALLOWED_GROUP.exec(value.group)
    if (match === null || match[1] !== value.resource_key || FORBIDDEN_GROUP_RESOURCE.test(match[1])) {
      return held('queue_policy_identity_missing')
    }
    return deepFreeze({ phase: 'OBSERVED', internal_state: 'QUEUE_CONCURRENCY_VALIDATED' })
  } catch {
    return held('queue_policy_exception')
  }
}

const tupleIsValid = (value) => exactKeys(value, ['candidate_id', 'run_id', 'lease_id']) &&
  [value.candidate_id, value.run_id, value.lease_id].every((field) => typeof field === 'string' &&
    TUPLE_ID.test(field) && isCanonicalOpaqueReference(field))
const sameTuple = (left, right) => left?.candidate_id === right?.candidate_id && left?.run_id === right?.run_id && left?.lease_id === right?.lease_id
const copyTuples = (items) => clone(items)
const tupleKey = (entry) => `${entry.candidate_id}\u0000${entry.run_id}\u0000${entry.lease_id}`
const cancellationIsProven = (value, incoming, pendingCount) => exactKeys(value, [
  'reason', 'candidate_id', 'run_id', 'lease_id', 'pending_before', 'pending_limit', 'incoming_position',
]) && value.reason === 'queue_capacity_exhausted' && sameTuple(value, incoming) &&
  value.pending_before === pendingCount && value.pending_limit === 100 && value.incoming_position === 101

export function reconcileQueueCapacity(input = {}) {
  try {
    const value = canonicalObject(input)
    const hasIncoming = value !== null && Object.hasOwn(value, 'incoming')
    const expectedKeys = hasIncoming ? ['policy', 'running', 'pending', 'incoming', 'cancellation'] : ['policy', 'running', 'pending']
    if (!exactKeys(value, expectedKeys) || !Array.isArray(value.running) || !Array.isArray(value.pending) ||
      value.running.some((entry) => !tupleIsValid(entry)) || value.pending.some((entry) => !tupleIsValid(entry)) ||
      value.running.length > 1 || value.pending.length > 100) return held('queue_capacity_shape_invalid')
    const policy = validateQueueConcurrencyPolicy(value.policy)
    if (policy.internal_state === 'HELD_QUEUE_CAPABILITY') return policy
    const allTuples = [...value.running, ...value.pending]
    if (new Set(allTuples.map(tupleKey)).size !== allTuples.length) return held('queue_capacity_tuple_duplicate')
    if (!hasIncoming) {
      const running = copyTuples(value.running)
      const pending = copyTuples(value.pending)
      return running === null || pending === null ? held('queue_capacity_clone_failed') : deepFreeze({
        phase: 'OBSERVED', internal_state: 'QUEUE_CAPACITY_OBSERVED', running, pending,
      })
    }
    if (!tupleIsValid(value.incoming)) return held('queue_capacity_incoming_invalid')
    if (new Set([...allTuples, value.incoming].map(tupleKey)).size !== allTuples.length + 1) {
      return held('queue_capacity_tuple_duplicate')
    }
    if (value.pending.length < 100) {
      return value.cancellation === null
        ? deepFreeze({ phase: 'OBSERVED', internal_state: 'QUEUE_CAPACITY_READY' })
        : held('queue_capacity_cancellation_unexpected')
    }
    if (!cancellationIsProven(value.cancellation, value.incoming, value.pending.length)) {
      return held('queue_capacity_cancellation_mapping_unverified')
    }
    return deepFreeze({ phase: 'OBSERVED', internal_state: 'QUEUE_CAPACITY_CANCELLED', cancelled: clone(value.incoming) })
  } catch {
    return held('queue_capacity_exception')
  }
}

export function invalidateMergeQueueSnapshot(input = {}) {
  try {
    const value = canonicalObject(input)
    if (!exactKeys(value, ['previous', 'next'])) return held('snapshot_rebuild_shape_invalid')
    const previous = parseQueueEvidence(value.previous)
    const next = parseQueueEvidence(value.next)
    if (previous.kind === 'held' || next.kind === 'held') return held('snapshot_rebuild_evidence_invalid')
    if (previous.kind !== 'observed') return held('snapshot_previous_not_observed')
    if (!sameCanonical(previous.observation.source, next.observation.source)) return held('snapshot_rebuild_source_changed')
    const priorSnapshot = previous.observation.snapshot
    const nextSnapshot = next.observation.snapshot
    if (nextSnapshot.snapshot_generation <= priorSnapshot.snapshot_generation ||
      Date.parse(nextSnapshot.observed_at) <= Date.parse(priorSnapshot.observed_at)) {
      return held('snapshot_generation_not_monotonic')
    }
    return deepFreeze({
      phase: 'INVALIDATED',
      internal_state: 'QUEUE_SNAPSHOT_INVALIDATED',
      previous_snapshot_id: priorSnapshot.snapshot_id,
      next_snapshot_id: nextSnapshot.snapshot_id,
    })
  } catch {
    return held('snapshot_rebuild_exception')
  }
}
