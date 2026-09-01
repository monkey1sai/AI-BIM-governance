import { createHash } from 'node:crypto'
import { types as utilTypes } from 'node:util'

// This reducer is deliberately descriptive and in-memory only. A caller can
// synchronously construct both inputs, so this standalone module never grants
// COMPLETE. It only reports advisory eligibility pending a later authority.
export const EVIDENCE_SCHEMA_VERSION = 'parallel-delivery-fabric-evidence/v2'
export const TRUSTED_EVIDENCE_CONTEXT_VERSION = 'parallel-delivery-fabric-evidence-trusted-context/v1'
export const ACCEPTANCE_IDS = Object.freeze(
  Array.from({ length: 45 }, (_, index) => `AC-${String(index + 1).padStart(2, '0')}`),
)

const SUMMARY_SCHEMA_VERSION = 'parallel-delivery-fabric-evidence-summary/v3'
const SHA1 = /^[0-9a-f]{40}$/u
const SHA256 = /^[0-9a-f]{64}$/u
const SHA_LIKE = /(?:^|[^0-9a-f])(?:[0-9a-f]{64}|[0-9a-f]{40})(?=$|[^0-9a-f])/iu
const REFERENCE_ID = /^[a-z][a-z0-9_-]{0,31}:[a-z0-9][a-z0-9._-]{0,119}$/u
const CLASSIFICATIONS = new Set(['PASSED', 'PARTIAL', 'HELD', 'FAILED', 'NOT_APPLICABLE'])
const GATE_KINDS = new Set(['CONTRACT', 'POLICY', 'STATIC_ANALYSIS', 'PLAYWRIGHT', 'COMPUTER_USE'])
const GATE_STATUSES = new Set(['passed', 'failed', 'not_run', 'skipped', 'not_configured'])
const ACTIVATION_STATUSES = new Set(['CURRENT', 'HELD', 'NOT_ACTIVATED', 'TASK9_EXTERNAL_ACTIVATION_GAP'])
const SOURCE_KINDS = new Set(['DESIGN', 'ACTIVATION', 'ROLLBACK', 'GATE', 'APPLICABILITY'])
const HELD_REASON_CODES_BY_CLASSIFICATION = new Map([
  ['PARTIAL', new Set(['PARTIAL_EVIDENCE', 'REQUIRED_GATE_NOT_RUN', 'REQUIRED_GATE_SKIPPED', 'REQUIRED_GATE_NOT_CONFIGURED'])],
  ['HELD', new Set(['HELD_PENDING_EVIDENCE', 'TASK9_EXTERNAL_ACTIVATION_GAP', 'REQUIRED_GATE_NOT_TERMINAL', 'REQUIRED_GATE_NOT_CURRENT_EXACT_HEAD'])],
  ['FAILED', new Set(['FAILED_EVIDENCE', 'REQUIRED_GATE_FAILED'])],
])
const SOURCE_SCHEMES = Object.freeze({
  DESIGN: 'design',
  ACTIVATION: 'activation',
  ROLLBACK: 'rollback',
  GATE: 'gate',
  APPLICABILITY: 'applicability',
})
const BASE_SOURCE_KINDS = Object.freeze(['DESIGN', 'ACTIVATION', 'ROLLBACK', 'GATE'])
const REQUIRED_GATES_BY_ACCEPTANCE = new Map([
  ['AC-22', 'PLAYWRIGHT'],
  ['AC-26', 'COMPUTER_USE'],
])
const MAX_NODES = 4096
const MAX_DEPTH = 32

const SECRET_VALUE = /(?:\b(?:bearer|basic)\s+[A-Za-z0-9._~+/=-]{8,}\b|\b(?:(?:api|access|refresh|session)[_-]?token|token)\s*[:=]\s*\S+|\bcookie\s*[:=]\s*\S+|\bauthorization\s*:\s*(?:bearer|basic)\s+\S+|\bgh[pousr]_[A-Za-z0-9_]{8,}\b|\bgithub_pat_[A-Za-z0-9_]{8,}\b|\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})/iu
const RAW_WINDOWS_SID = /\bS-\d+(?:-\d+){2,}\b/iu
const RAW_PID = /\b(?:pid|process(?:[_ -]?id)?)\b\s*[:=]?\s*\d+\b/iu
const RAW_WINDOWS_PATH = /\b[A-Za-z]:[\\/]/u
const RAW_POSIX_PATH = /(?:^|[\s=:])\/(?!\/)(?:[^\s\x00/]+\/)*[^\s\x00/]+/u
const RAW_NETWORK_PATH = /\\\\[^\\/]+[\\/]/u
const RAW_ENVIRONMENT = /\b(?:env|environment)(?:[_ -]?(?:var(?:iable)?|value))?\b\s*(?::|=)\s*[A-Za-z_][A-Za-z0-9_]*\b|(?:^|[\s/:\\])\$env:[A-Za-z_][A-Za-z0-9_]*\b|%[A-Za-z_][A-Za-z0-9_]*%/iu

class EvidenceContractError extends Error {
  constructor(code) {
    super(code)
    this.code = code
  }
}

const reject = code => { throw new EvidenceContractError(code) }

const isPlainObject = value => {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || utilTypes.isProxy(value)) return false
  try {
    const prototype = Object.getPrototypeOf(value)
    return prototype === Object.prototype || prototype === null
  } catch {
    return false
  }
}

const normalizeKey = value => String(value)
  .replace(/([a-z0-9])([A-Z])/gu, '$1_$2')
  .toLowerCase()
  .replaceAll('-', '_')

const sensitiveKey = value => {
  const key = normalizeKey(value)
  return key === 'secret' || key.endsWith('_secret') || key === 'token' || key.endsWith('_token') ||
    key === 'cookie' || key === 'authorization' || key === 'private_key' || key === 'sid' ||
    key.endsWith('_sid') || key === 'pid' || key.endsWith('_pid') || key === 'process_id' ||
    key.includes('transcript') || key === 'env' || key.startsWith('env_') || key.endsWith('_env') ||
    key.includes('raw_env') || key.includes('environment_values') || key === 'absolute_path'
}

const unsafeText = value => SHA_LIKE.test(value) || SECRET_VALUE.test(value) || RAW_WINDOWS_SID.test(value) ||
  RAW_PID.test(value) || RAW_WINDOWS_PATH.test(value) || RAW_POSIX_PATH.test(value) ||
  RAW_NETWORK_PATH.test(value) || RAW_ENVIRONMENT.test(value) || /\btranscript\b/iu.test(value)

const INVALID = Symbol('invalid-evidence-input')

const dataSnapshot = (value, state = { nodes: 0 }, depth = 0) => {
  try {
    if (depth > MAX_DEPTH || state.nodes++ > MAX_NODES || utilTypes.isProxy(value)) return INVALID
    if (value === null || typeof value === 'boolean') return value
    if (typeof value === 'string') return value
    if (typeof value === 'number') return Number.isSafeInteger(value) ? value : INVALID
    if (typeof value !== 'object') return INVALID
    if (Array.isArray(value)) {
      const length = value.length
      if (!Number.isSafeInteger(length)) return INVALID
      const keys = Reflect.ownKeys(value)
      if (keys.length !== length + 1 || !keys.includes('length')) return INVALID
      const result = []
      for (let index = 0; index < length; index += 1) {
        const key = String(index)
        const descriptor = Object.getOwnPropertyDescriptor(value, key)
        if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) return INVALID
        const nested = dataSnapshot(descriptor.value, state, depth + 1)
        if (nested === INVALID) return INVALID
        result.push(nested)
      }
      return result
    }
    if (!isPlainObject(value)) return INVALID
    const result = Object.create(null)
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== 'string' || key === '__proto__' || key === 'constructor' || key === 'prototype') return INVALID
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) return INVALID
      const nested = dataSnapshot(descriptor.value, state, depth + 1)
      if (nested === INVALID) return INVALID
      Object.defineProperty(result, key, { configurable: true, enumerable: true, value: nested, writable: true })
    }
    return result
  } catch {
    return INVALID
  }
}

const isDeepFrozenData = (value, state = { nodes: 0 }, depth = 0) => {
  try {
    if (depth > MAX_DEPTH || state.nodes++ > MAX_NODES || utilTypes.isProxy(value)) return false
    if (value === null || typeof value === 'boolean' || typeof value === 'string') return true
    if (typeof value === 'number') return Number.isSafeInteger(value)
    if (typeof value !== 'object' || !Object.isFrozen(value)) return false
    if (Array.isArray(value)) {
      const keys = Reflect.ownKeys(value)
      if (keys.length !== value.length + 1 || !keys.includes('length')) return false
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
        if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value') ||
            !isDeepFrozenData(descriptor.value, state, depth + 1)) return false
      }
      return true
    }
    if (!isPlainObject(value)) return false
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== 'string') return false
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value') ||
          !isDeepFrozenData(descriptor.value, state, depth + 1)) return false
    }
    return true
  } catch {
    return false
  }
}

const assertNoForbiddenKeys = value => {
  if (value === null || typeof value !== 'object') return
  if (Array.isArray(value)) {
    value.forEach(assertNoForbiddenKeys)
    return
  }
  for (const [key, nested] of Object.entries(value)) {
    if (sensitiveKey(key)) reject('EVIDENCE_SENSITIVE_MATERIAL')
    assertNoForbiddenKeys(nested)
  }
}

const deepFreeze = (value, seen = new WeakSet()) => {
  if (value === null || typeof value !== 'object' || seen.has(value)) return value
  seen.add(value)
  for (const nested of Object.values(value)) deepFreeze(nested, seen)
  return Object.freeze(value)
}

const canonicalize = value => {
  if (value === null || typeof value === 'boolean' || typeof value === 'string' || Number.isSafeInteger(value)) return value
  if (Array.isArray(value)) return value.map(canonicalize)
  if (!isPlainObject(value)) reject('EVIDENCE_CANONICALIZATION_INVALID')
  const result = {}
  for (const key of Object.keys(value).sort()) result[key] = canonicalize(value[key])
  return result
}

const digestCanonical = value => createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex')

const compareText = (left, right) => left === right ? 0 : left < right ? -1 : 1

const compareClosedKeys = keys => (left, right) => {
  for (const key of keys) {
    const comparison = compareText(String(left[key]), String(right[key]))
    if (comparison !== 0) return comparison
  }
  return 0
}

const canonicalCandidateForDigest = candidate => ({
  ...candidate,
  records: candidate.records
    .map(record => ({
      ...record,
      source_refs: [...record.source_refs].sort(compareClosedKeys(['kind', 'ref', 'digest'])),
      gate_outcomes: [...record.gate_outcomes].sort(compareClosedKeys([
        'gate_id', 'kind', 'required', 'status', 'terminal', 'current_exact_head',
        'subject_sha', 'base_sha', 'manifest_digest', 'source_ref', 'source_digest',
      ])),
      held_reasons: [...record.held_reasons].sort(compareText),
    }))
    .sort(compareClosedKeys(['id'])),
})

const canonicalTrustedContextForDigest = context => ({
  ...context,
  acceptance: context.acceptance
    .map(acceptance => ({
      ...acceptance,
      required_gate_kinds: [...acceptance.required_gate_kinds].sort(compareText),
      required_source_kinds: [...acceptance.required_source_kinds].sort(compareText),
    }))
    .sort(compareClosedKeys(['id'])),
})

const exactKeys = (value, keys, code) => {
  if (!isPlainObject(value)) reject(code)
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) reject(code)
}

const assertSha1 = (value, code) => {
  if (typeof value !== 'string' || !SHA1.test(value)) reject(code)
  return value
}

const assertSha256 = (value, code) => {
  if (typeof value !== 'string' || !SHA256.test(value)) reject(code)
  return value
}

const assertSafeText = (value, code) => {
  if (typeof value !== 'string' || value.length === 0 || value.length > 256 || unsafeText(value)) reject(code)
  return value
}

const assertReference = (value, scheme, code) => {
  assertSafeText(value, code)
  if (!REFERENCE_ID.test(value) || value.slice(0, value.indexOf(':')) !== scheme) reject(code)
  return value
}

const assertBoolean = (value, code) => {
  if (typeof value !== 'boolean') reject(code)
  return value
}

const parseSourceRefs = value => {
  if (!Array.isArray(value) || value.length < 4 || value.length > 5) reject('EVIDENCE_SOURCE_REFS_INVALID')
  const byKind = new Map()
  const byRef = new Map()
  for (const source of value) {
    exactKeys(source, ['kind', 'ref', 'digest'], 'EVIDENCE_SOURCE_REF_INVALID')
    if (!SOURCE_KINDS.has(source.kind)) reject('EVIDENCE_SOURCE_REF_INVALID')
    const ref = assertReference(source.ref, SOURCE_SCHEMES[source.kind], 'EVIDENCE_SOURCE_REF_INVALID')
    const digest = assertSha256(source.digest, 'EVIDENCE_SOURCE_REF_INVALID')
    if (byKind.has(source.kind) || byRef.has(ref)) reject('EVIDENCE_SOURCE_REF_DUPLICATE')
    const normalized = { kind: source.kind, ref, digest }
    byKind.set(source.kind, normalized)
    byRef.set(ref, normalized)
  }
  return { byKind, byRef }
}

const assertBoundSource = (sources, kind, ref, digest, code) => {
  const source = sources.byKind.get(kind)
  if (!source || source.ref !== ref || source.digest !== digest) reject(code)
}

const parseActivation = (value, sources) => {
  exactKeys(value, ['ref', 'digest', 'status'], 'EVIDENCE_ACTIVATION_INVALID')
  const ref = assertReference(value.ref, 'activation', 'EVIDENCE_ACTIVATION_INVALID')
  const digest = assertSha256(value.digest, 'EVIDENCE_ACTIVATION_INVALID')
  if (!ACTIVATION_STATUSES.has(value.status)) reject('EVIDENCE_ACTIVATION_INVALID')
  assertBoundSource(sources, 'ACTIVATION', ref, digest, 'EVIDENCE_ACTIVATION_SOURCE_UNBOUND')
  return { ref, digest, status: value.status }
}

const parseRollback = (value, sources) => {
  exactKeys(value, ['ref', 'digest'], 'EVIDENCE_ROLLBACK_INVALID')
  const ref = assertReference(value.ref, 'rollback', 'EVIDENCE_ROLLBACK_INVALID')
  const digest = assertSha256(value.digest, 'EVIDENCE_ROLLBACK_INVALID')
  assertBoundSource(sources, 'ROLLBACK', ref, digest, 'EVIDENCE_ROLLBACK_SOURCE_UNBOUND')
  return { ref, digest }
}

const parseHeldReasons = (value, classification) => {
  if (!Array.isArray(value) || value.length > 16) reject('EVIDENCE_HELD_REASONS_INVALID')
  if ((classification === 'PASSED' || classification === 'NOT_APPLICABLE') && value.length !== 0) reject('EVIDENCE_HELD_REASONS_INVALID')
  if ((classification === 'PARTIAL' || classification === 'HELD' || classification === 'FAILED') && value.length === 0) {
    reject('EVIDENCE_HELD_REASONS_MISSING')
  }
  const allowedCodes = HELD_REASON_CODES_BY_CLASSIFICATION.get(classification)
  const reasons = new Set()
  for (const reason of value) {
    const safeReason = assertSafeText(reason, 'EVIDENCE_HELD_REASONS_INVALID')
    if (!allowedCodes || !allowedCodes.has(safeReason) || reasons.has(safeReason)) reject('EVIDENCE_HELD_REASONS_INVALID')
    reasons.add(safeReason)
  }
  return [...reasons]
}

const parseCandidateApplicability = (value, classification, baseSha, sources) => {
  if (classification !== 'NOT_APPLICABLE') {
    exactKeys(value, ['kind'], 'EVIDENCE_APPLICABILITY_INVALID')
    if (value.kind !== 'REQUIRED') reject('EVIDENCE_APPLICABILITY_INVALID')
    return { kind: 'REQUIRED' }
  }
  exactKeys(value, [
    'kind', 'authority_ref', 'authority_digest', 'base_sha', 'prior_pinned', 'immutable', 'current_exact_head',
  ], 'EVIDENCE_APPLICABILITY_INVALID')
  if (value.kind !== 'NOT_APPLICABLE' || value.base_sha !== baseSha || value.prior_pinned !== true ||
      value.immutable !== true || value.current_exact_head !== true) reject('EVIDENCE_APPLICABILITY_AUTHORITY_REQUIRED')
  const authorityRef = assertReference(value.authority_ref, 'applicability', 'EVIDENCE_APPLICABILITY_AUTHORITY_REQUIRED')
  const authorityDigest = assertSha256(value.authority_digest, 'EVIDENCE_APPLICABILITY_AUTHORITY_REQUIRED')
  assertBoundSource(sources, 'APPLICABILITY', authorityRef, authorityDigest, 'EVIDENCE_APPLICABILITY_AUTHORITY_REQUIRED')
  return {
    kind: 'NOT_APPLICABLE', authority_ref: authorityRef, authority_digest: authorityDigest, base_sha: baseSha,
    prior_pinned: true, immutable: true, current_exact_head: true,
  }
}

const parseGateOutcomes = (value, identity, sources) => {
  if (!Array.isArray(value) || value.length === 0 || value.length > 32) reject('EVIDENCE_GATES_INVALID')
  const gateIds = new Set()
  const gates = []
  for (const gate of value) {
    exactKeys(gate, [
      'gate_id', 'kind', 'required', 'status', 'terminal', 'current_exact_head',
      'subject_sha', 'base_sha', 'manifest_digest', 'source_ref', 'source_digest',
    ], 'EVIDENCE_GATE_INVALID')
    const gateId = assertReference(gate.gate_id, 'gate', 'EVIDENCE_GATE_INVALID')
    if (gateIds.has(gateId) || !GATE_KINDS.has(gate.kind) || !GATE_STATUSES.has(gate.status)) reject('EVIDENCE_GATE_INVALID')
    gateIds.add(gateId)
    assertBoolean(gate.required, 'EVIDENCE_GATE_INVALID')
    assertBoolean(gate.terminal, 'EVIDENCE_GATE_INVALID')
    assertBoolean(gate.current_exact_head, 'EVIDENCE_GATE_INVALID')
    if (gate.subject_sha !== identity.subject_sha || gate.base_sha !== identity.base_sha || gate.manifest_digest !== identity.manifest_digest) {
      reject('EVIDENCE_GATE_IDENTITY_MISMATCH')
    }
    const sourceRef = assertReference(gate.source_ref, 'gate', 'EVIDENCE_GATE_INVALID')
    const sourceDigest = assertSha256(gate.source_digest, 'EVIDENCE_GATE_INVALID')
    assertBoundSource(sources, 'GATE', sourceRef, sourceDigest, 'EVIDENCE_GATE_SOURCE_UNBOUND')
    gates.push({
      gate_id: gateId, kind: gate.kind, required: gate.required, status: gate.status, terminal: gate.terminal,
      current_exact_head: gate.current_exact_head,
    })
  }
  return gates
}

const parseCandidateRecord = value => {
  exactKeys(value, [
    'id', 'classification', 'subject_sha', 'base_sha', 'manifest_digest', 'source_refs',
    'gate_outcomes', 'held_reasons', 'activation', 'rollback', 'applicability',
  ], 'EVIDENCE_RECORD_INVALID')
  if (!ACCEPTANCE_IDS.includes(value.id) || !CLASSIFICATIONS.has(value.classification)) reject('EVIDENCE_RECORD_INVALID')
  const identity = {
    subject_sha: assertSha1(value.subject_sha, 'EVIDENCE_RECORD_INVALID'),
    base_sha: assertSha1(value.base_sha, 'EVIDENCE_RECORD_INVALID'),
    manifest_digest: assertSha256(value.manifest_digest, 'EVIDENCE_RECORD_INVALID'),
  }
  const sourceRefs = parseSourceRefs(value.source_refs)
  const activation = parseActivation(value.activation, sourceRefs)
  const rollback = parseRollback(value.rollback, sourceRefs)
  const applicability = parseCandidateApplicability(value.applicability, value.classification, identity.base_sha, sourceRefs)
  const heldReasons = parseHeldReasons(value.held_reasons, value.classification)
  const gates = parseGateOutcomes(value.gate_outcomes, identity, sourceRefs)
  return {
    id: value.id,
    classification: value.classification,
    ...identity,
    source_refs: sourceRefs,
    activation,
    rollback,
    applicability,
    held_reasons: heldReasons,
    gate_outcomes: gates,
  }
}

const sameReference = (left, right) => left.ref === right.ref && left.digest === right.digest

const parseCandidate = input => {
  const snapshot = dataSnapshot(input)
  if (snapshot === INVALID) reject('EVIDENCE_INPUT_HOSTILE')
  assertNoForbiddenKeys(snapshot)
  exactKeys(snapshot, ['schema_version', 'records'], 'EVIDENCE_ENVELOPE_INVALID')
  if (snapshot.schema_version !== EVIDENCE_SCHEMA_VERSION || !Array.isArray(snapshot.records) || snapshot.records.length !== 45) {
    reject('EVIDENCE_ENVELOPE_INVALID')
  }
  const records = snapshot.records.map(parseCandidateRecord)
  const seenIds = new Set()
  for (const record of records) {
    if (seenIds.has(record.id)) reject('EVIDENCE_ACCEPTANCE_DUPLICATE')
    seenIds.add(record.id)
  }
  if (ACCEPTANCE_IDS.some(id => !seenIds.has(id))) reject('EVIDENCE_ACCEPTANCE_MISSING')
  const first = records[0]
  for (const record of records.slice(1)) {
    if (record.subject_sha !== first.subject_sha || record.base_sha !== first.base_sha ||
        record.manifest_digest !== first.manifest_digest || !sameReference(record.activation, first.activation) ||
        record.activation.status !== first.activation.status || !sameReference(record.rollback, first.rollback)) {
      reject('EVIDENCE_BUNDLE_IDENTITY_MISMATCH')
    }
  }
  return { snapshot, records, identity: first, activation: first.activation, rollback: first.rollback }
}

const parseRequiredKinds = (value, allowed, code) => {
  if (!Array.isArray(value) || value.length === 0 || value.length > allowed.size) reject(code)
  const seen = new Set()
  for (const item of value) {
    if (!allowed.has(item) || seen.has(item)) reject(code)
    seen.add(item)
  }
  return seen
}

const parseTrustedApplicability = (value, baseSha) => {
  if (!isPlainObject(value)) reject('TRUSTED_CONTEXT_APPLICABILITY_INVALID')
  if (value.kind === 'REQUIRED') {
    exactKeys(value, ['kind'], 'TRUSTED_CONTEXT_APPLICABILITY_INVALID')
    return { kind: 'REQUIRED' }
  }
  exactKeys(value, [
    'kind', 'authority_ref', 'authority_digest', 'base_sha', 'prior_pinned', 'immutable', 'current_exact_head',
  ], 'TRUSTED_CONTEXT_APPLICABILITY_INVALID')
  if (value.kind !== 'NOT_APPLICABLE' || value.base_sha !== baseSha || value.prior_pinned !== true ||
      value.immutable !== true || value.current_exact_head !== true) reject('TRUSTED_CONTEXT_APPLICABILITY_INVALID')
  return {
    kind: 'NOT_APPLICABLE',
    authority_ref: assertReference(value.authority_ref, 'applicability', 'TRUSTED_CONTEXT_APPLICABILITY_INVALID'),
    authority_digest: assertSha256(value.authority_digest, 'TRUSTED_CONTEXT_APPLICABILITY_INVALID'),
    base_sha: baseSha,
    prior_pinned: true,
    immutable: true,
    current_exact_head: true,
  }
}

const parseTrustedAcceptance = (value, baseSha) => {
  exactKeys(value, ['id', 'required_gate_kinds', 'required_source_kinds', 'applicability'], 'TRUSTED_CONTEXT_ACCEPTANCE_INVALID')
  if (!ACCEPTANCE_IDS.includes(value.id)) reject('TRUSTED_CONTEXT_ACCEPTANCE_INVALID')
  const requiredGateKinds = parseRequiredKinds(value.required_gate_kinds, GATE_KINDS, 'TRUSTED_CONTEXT_ACCEPTANCE_INVALID')
  const requiredSourceKinds = parseRequiredKinds(value.required_source_kinds, SOURCE_KINDS, 'TRUSTED_CONTEXT_ACCEPTANCE_INVALID')
  for (const sourceKind of BASE_SOURCE_KINDS) {
    if (!requiredSourceKinds.has(sourceKind)) reject('TRUSTED_CONTEXT_ACCEPTANCE_INVALID')
  }
  const applicability = parseTrustedApplicability(value.applicability, baseSha)
  if (applicability.kind === 'NOT_APPLICABLE') {
    if (!requiredSourceKinds.has('APPLICABILITY') || requiredSourceKinds.size !== BASE_SOURCE_KINDS.length + 1) {
      reject('TRUSTED_CONTEXT_ACCEPTANCE_INVALID')
    }
  } else if (requiredSourceKinds.has('APPLICABILITY') || requiredSourceKinds.size !== BASE_SOURCE_KINDS.length) {
    reject('TRUSTED_CONTEXT_ACCEPTANCE_INVALID')
  }
  const mandatoryGate = REQUIRED_GATES_BY_ACCEPTANCE.get(value.id)
  if (applicability.kind === 'REQUIRED' && mandatoryGate && !requiredGateKinds.has(mandatoryGate)) reject('TRUSTED_CONTEXT_ACCEPTANCE_INVALID')
  return { id: value.id, required_gate_kinds: requiredGateKinds, required_source_kinds: requiredSourceKinds, applicability }
}

const parseTrustedContext = input => {
  if (input === undefined) reject('TRUSTED_CONTEXT_REQUIRED')
  const snapshot = dataSnapshot(input)
  if (snapshot === INVALID) reject('TRUSTED_CONTEXT_HOSTILE')
  if (!isDeepFrozenData(input)) reject('TRUSTED_CONTEXT_NOT_FROZEN')
  assertNoForbiddenKeys(snapshot)
  exactKeys(snapshot, [
    'schema_version', 'subject_sha', 'base_sha', 'manifest_digest', 'activation', 'rollback', 'acceptance',
  ], 'TRUSTED_CONTEXT_INVALID')
  if (snapshot.schema_version !== TRUSTED_EVIDENCE_CONTEXT_VERSION || !Array.isArray(snapshot.acceptance) || snapshot.acceptance.length !== 45) {
    reject('TRUSTED_CONTEXT_INVALID')
  }
  const identity = {
    subject_sha: assertSha1(snapshot.subject_sha, 'TRUSTED_CONTEXT_INVALID'),
    base_sha: assertSha1(snapshot.base_sha, 'TRUSTED_CONTEXT_INVALID'),
    manifest_digest: assertSha256(snapshot.manifest_digest, 'TRUSTED_CONTEXT_INVALID'),
  }
  exactKeys(snapshot.activation, ['ref', 'digest', 'status'], 'TRUSTED_CONTEXT_INVALID')
  const activation = {
    ref: assertReference(snapshot.activation.ref, 'activation', 'TRUSTED_CONTEXT_INVALID'),
    digest: assertSha256(snapshot.activation.digest, 'TRUSTED_CONTEXT_INVALID'),
    status: snapshot.activation.status,
  }
  if (!ACTIVATION_STATUSES.has(activation.status)) reject('TRUSTED_CONTEXT_INVALID')
  exactKeys(snapshot.rollback, ['ref', 'digest'], 'TRUSTED_CONTEXT_INVALID')
  const rollback = {
    ref: assertReference(snapshot.rollback.ref, 'rollback', 'TRUSTED_CONTEXT_INVALID'),
    digest: assertSha256(snapshot.rollback.digest, 'TRUSTED_CONTEXT_INVALID'),
  }
  const acceptance = new Map()
  for (const item of snapshot.acceptance) {
    const parsed = parseTrustedAcceptance(item, identity.base_sha)
    if (acceptance.has(parsed.id)) reject('TRUSTED_CONTEXT_ACCEPTANCE_DUPLICATE')
    acceptance.set(parsed.id, parsed)
  }
  if (ACCEPTANCE_IDS.some(id => !acceptance.has(id))) reject('TRUSTED_CONTEXT_ACCEPTANCE_MISSING')
  return { snapshot, identity, activation, rollback, acceptance }
}

const sameApplicability = (left, right) => left.kind === right.kind && (
  left.kind === 'REQUIRED' || (
    left.authority_ref === right.authority_ref && left.authority_digest === right.authority_digest &&
    left.base_sha === right.base_sha && left.prior_pinned === right.prior_pinned &&
    left.immutable === right.immutable && left.current_exact_head === right.current_exact_head
  )
)

const assertRecordMatchesTrustedContext = (record, expected, context) => {
  if (record.subject_sha !== context.identity.subject_sha || record.base_sha !== context.identity.base_sha ||
      record.manifest_digest !== context.identity.manifest_digest || !sameReference(record.activation, context.activation) ||
      record.activation.status !== context.activation.status || !sameReference(record.rollback, context.rollback)) {
    reject('EVIDENCE_TRUSTED_PIN_MISMATCH')
  }
  if (record.source_refs.byKind.size !== expected.required_source_kinds.size) reject('EVIDENCE_TRUSTED_SOURCE_KINDS_MISMATCH')
  for (const sourceKind of expected.required_source_kinds) {
    if (!record.source_refs.byKind.has(sourceKind)) reject('EVIDENCE_TRUSTED_SOURCE_KINDS_MISMATCH')
  }
  if (expected.applicability.kind === 'NOT_APPLICABLE') {
    if (record.classification !== 'NOT_APPLICABLE' || !sameApplicability(record.applicability, expected.applicability)) {
      reject('EVIDENCE_TRUSTED_APPLICABILITY_MISMATCH')
    }
  } else if (record.classification === 'NOT_APPLICABLE' || record.applicability.kind !== 'REQUIRED') {
    reject('EVIDENCE_TRUSTED_APPLICABILITY_MISMATCH')
  }
  const representedRequiredKinds = new Set()
  for (const gate of record.gate_outcomes) {
    if (!gate.required) continue
    if (!expected.required_gate_kinds.has(gate.kind)) reject('EVIDENCE_TRUSTED_GATE_MAP_MISMATCH')
    representedRequiredKinds.add(gate.kind)
  }
  for (const requiredKind of expected.required_gate_kinds) {
    if (!representedRequiredKinds.has(requiredKind)) reject('EVIDENCE_TRUSTED_GATE_MAP_MISMATCH')
  }
}

const parseEvidence = (candidate, trustedExpectedContext) => {
  const parsedCandidate = parseCandidate(candidate)
  const trustedContext = parseTrustedContext(trustedExpectedContext)
  for (const record of parsedCandidate.records) {
    assertRecordMatchesTrustedContext(record, trustedContext.acceptance.get(record.id), trustedContext)
  }
  return { ...parsedCandidate, trustedContext }
}

const freezeResult = value => deepFreeze(value)

const rejected = reason => freezeResult({
  schema_version: SUMMARY_SCHEMA_VERSION,
  status: 'REJECTED',
  complete: false,
  advisory_eligible: false,
  reason,
  blockers: Object.freeze(['EVIDENCE_CONTRACT_REJECTED']),
  acceptance: Object.freeze([]),
})

const summarizeAcceptance = record => freezeResult({
  id: record.id,
  classification: record.classification,
  required_gate_count: record.gate_outcomes.filter(gate => gate.required).length,
})

const blockerForGate = gate => {
  if (!gate.required) return null
  if (gate.status !== 'passed') return `GATE_${gate.status.toUpperCase()}`
  if (!gate.terminal) return 'REQUIRED_GATE_NOT_TERMINAL'
  if (!gate.current_exact_head) return 'REQUIRED_GATE_NOT_CURRENT_EXACT_HEAD'
  return null
}

/**
 * Reduces a candidate-only evidence bundle against an independently supplied,
 * frozen expected context. It never reads live state, creates evidence, or
 * grants activation authority; only a later prior-base-owned authority wrapper
 * may unlock completion.
 */
export function reduceEvidenceContract(candidate = {}, trustedExpectedContext) {
  try {
    const parsed = parseEvidence(candidate, trustedExpectedContext)
    const blockers = new Set()
    let hasPlaywright = false
    let hasComputerUse = false
    const trustedAcceptances = [...parsed.trustedContext.acceptance.values()]
    const requiresPlaywright = trustedAcceptances.some(value => value.applicability.kind === 'REQUIRED' && value.required_gate_kinds.has('PLAYWRIGHT'))
    const requiresComputerUse = trustedAcceptances.some(value => value.applicability.kind === 'REQUIRED' && value.required_gate_kinds.has('COMPUTER_USE'))
    for (const record of parsed.records) {
      if (record.classification !== 'PASSED' && record.classification !== 'NOT_APPLICABLE') {
        blockers.add(`ACCEPTANCE_${record.classification}`)
      }
      for (const gate of record.gate_outcomes) {
        const gateBlocker = blockerForGate(gate)
        if (gateBlocker) blockers.add(gateBlocker)
        if (gate.required && gate.status === 'passed' && gate.terminal && gate.current_exact_head) {
          if (gate.kind === 'PLAYWRIGHT') hasPlaywright = true
          if (gate.kind === 'COMPUTER_USE') hasComputerUse = true
        }
      }
    }
    if (parsed.activation.status === 'TASK9_EXTERNAL_ACTIVATION_GAP') blockers.add('TASK9_EXTERNAL_ACTIVATION_GAP')
    else if (parsed.activation.status !== 'CURRENT') blockers.add(`ACTIVATION_${parsed.activation.status}`)
    if (requiresPlaywright && !hasPlaywright) blockers.add('PLAYWRIGHT_EVIDENCE_MISSING')
    if (requiresComputerUse && !hasComputerUse) blockers.add('COMPUTER_USE_EVIDENCE_MISSING')

    const orderedBlockers = [...blockers].sort()
    const advisoryEligible = orderedBlockers.length === 0
    return freezeResult({
      schema_version: SUMMARY_SCHEMA_VERSION,
      status: advisoryEligible ? 'HELD' : 'INCOMPLETE',
      complete: false,
      advisory_eligible: advisoryEligible,
      ...(advisoryEligible ? { reason: 'TRUSTED_CONTEXT_AUTHORITY_REQUIRED' } : {}),
      subject_sha: parsed.identity.subject_sha,
      base_sha: parsed.identity.base_sha,
      manifest_digest: parsed.identity.manifest_digest,
      activation: freezeResult({ ...parsed.activation }),
      rollback: freezeResult({ ...parsed.rollback }),
      evidence_digest: digestCanonical(canonicalCandidateForDigest(parsed.snapshot)),
      trusted_context_digest: digestCanonical(canonicalTrustedContextForDigest(parsed.trustedContext.snapshot)),
      blockers: advisoryEligible ? ['TRUSTED_CONTEXT_AUTHORITY_REQUIRED'] : orderedBlockers,
      acceptance: parsed.records.map(summarizeAcceptance),
    })
  } catch (error) {
    const reason = error instanceof EvidenceContractError ? error.code : 'EVIDENCE_INPUT_INVALID'
    return rejected(reason)
  }
}
