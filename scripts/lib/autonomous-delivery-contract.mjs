import { createHash, timingSafeEqual } from 'node:crypto'


export class AutonomousDeliveryContractError extends Error {
  constructor(code, detail) {
    super(`${code}: ${detail}`)
    this.name = 'AutonomousDeliveryContractError'
    this.code = code
    this.detail = detail
  }
}

const fail = (code, detail) => {
  throw new AutonomousDeliveryContractError(code, detail)
}

const PHASES = Object.freeze([
  'COLLECTING', 'VERIFYING', 'READY_TO_MERGE', 'MERGING', 'MERGED',
  'DEPLOYING', 'VERIFYING_DEPLOYMENT', 'RETRYING_DEPLOYMENT', 'CLOSED',
])
const LAST_PHASES = Object.freeze(PHASES.filter((phase) => phase !== 'CLOSED'))
const TERMINAL_CLASSES = Object.freeze(['DELIVERED', 'FAILED', 'HELD'])
const REASON_CODES = Object.freeze([
  'DELIVERY_VERIFIED',
  'PREMERGE_EVIDENCE_INVALID',
  'PREMERGE_AUTHORITY_UNAVAILABLE',
  'POLICY_OR_SETTINGS_DRIFT',
  'MERGE_OUTCOME_UNVERIFIED',
  'DEPLOYMENT_BLOCKED',
  'MERGED_NOT_DELIVERED',
  'DELIVERY_PENDING_FIXPOINT',
  'ACTIVATION_UNATTESTED',
])
const PR_CLASSES = Object.freeze([
  'draft_report_only', 'ordinary', 'repair', 'reconciliation',
  'activation_canary', 'activation_closure', 'revert', 'release_hotfix',
])
const ACTIVATION_PHASES = Object.freeze([
  'LEGACY_GUARDED', 'SHADOW_DUAL', 'CUTOVER_ARMED', 'CANARY_ACTIVE', 'AUTONOMOUS_ACTIVE',
])
const TRANSITIONS = Object.freeze({
  COLLECTING: ['VERIFYING', 'CLOSED'],
  VERIFYING: ['READY_TO_MERGE', 'CLOSED'],
  READY_TO_MERGE: ['MERGING', 'CLOSED'],
  MERGING: ['MERGED', 'CLOSED'],
  MERGED: ['DEPLOYING', 'CLOSED'],
  DEPLOYING: ['VERIFYING_DEPLOYMENT', 'CLOSED'],
  VERIFYING_DEPLOYMENT: ['CLOSED'],
  RETRYING_DEPLOYMENT: ['DEPLOYING', 'CLOSED'],
  CLOSED: [],
})
const TERMINAL_REASON_MAP = Object.freeze({
  DELIVERED: ['DELIVERY_VERIFIED'],
  FAILED: ['MERGED_NOT_DELIVERED'],
  HELD: [
    'PREMERGE_EVIDENCE_INVALID', 'PREMERGE_AUTHORITY_UNAVAILABLE',
    'POLICY_OR_SETTINGS_DRIFT', 'MERGE_OUTCOME_UNVERIFIED', 'DEPLOYMENT_BLOCKED',
    'DELIVERY_PENDING_FIXPOINT', 'ACTIVATION_UNATTESTED',
  ],
})
const REASON_LAST_PHASES = Object.freeze({
  DELIVERY_VERIFIED: ['VERIFYING_DEPLOYMENT', 'RETRYING_DEPLOYMENT'],
  PREMERGE_EVIDENCE_INVALID: ['COLLECTING', 'VERIFYING', 'READY_TO_MERGE'],
  PREMERGE_AUTHORITY_UNAVAILABLE: ['COLLECTING', 'VERIFYING', 'READY_TO_MERGE'],
  POLICY_OR_SETTINGS_DRIFT: LAST_PHASES,
  MERGE_OUTCOME_UNVERIFIED: ['MERGING'],
  DEPLOYMENT_BLOCKED: ['MERGED', 'DEPLOYING'],
  MERGED_NOT_DELIVERED: ['DEPLOYING', 'VERIFYING_DEPLOYMENT', 'RETRYING_DEPLOYMENT'],
  DELIVERY_PENDING_FIXPOINT: ['VERIFYING_DEPLOYMENT', 'RETRYING_DEPLOYMENT'],
  ACTIVATION_UNATTESTED: LAST_PHASES,
})

export const autonomousDeliveryVocabulary = Object.freeze({
  phases: PHASES,
  terminalClasses: TERMINAL_CLASSES,
  reasonCodes: REASON_CODES,
  prClasses: PR_CLASSES,
  activationPhases: ACTIVATION_PHASES,
})

const PACKET_KEYS = Object.freeze([
  'schema_version', 'repository', 'pull_request', 'classification',
  'classification_evidence', 'changed_paths', 'changed_paths_sha256',
  'required_check_sources', 'conversation_state', 'openspec_state',
  'review_surface', 'artifacts', 'review_surface_sha256', 'artifacts_sha256',
  'collector', 'budgets',
])
const ENVELOPE_KEYS = Object.freeze([
  'schema_version', 'attestation_id', 'purpose', 'audience', 'canonicalization',
  'signature_domain', 'repository', 'pull_request', 'packet_sha256', 'diff_sha256',
  'policy_sha256', 'manifest_sha256', 'review_surface_sha256', 'artifacts_sha256',
  'issuer', 'key_id', 'algorithm', 'nonce', 'nonce_consumption', 'issued_at',
  'expires_at', 'signature',
])
const TERMINAL_KEYS = Object.freeze([
  'schema_version', 'delivery_id', 'attempt_id', 'pr_class',
  'supersedes_delivery_id', 'supersedes_attempt_id', 'previous_attempt_sha256',
  'repository', 'pull_request', 'phase', 'last_phase', 'terminal_class', 'reason_code',
  'merge_observed', 'merge_commit_oid', 'fetched_origin_main_oid', 'deployed_commit_oid',
  'command_state', 'target_id', 'runner_ids', 'gates', 'artifacts', 'failure_detail',
  'closed_at',
])

const isPlainObject = (value) => (
  value !== null && typeof value === 'object' && !Array.isArray(value)
)

const exactKeys = (value, expected, context) => {
  if (!isPlainObject(value)) fail('invalid_shape', `${context}_must_be_object`)
  const actual = Object.keys(value).sort()
  const wanted = [...expected].sort()
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    fail('invalid_shape', `${context}_keys_invalid`)
  }
}

const assertSafeInteger = (value, context, minimum = 0) => {
  if (!Number.isSafeInteger(value) || value < minimum) fail('invalid_value', `${context}_invalid_integer`)
}

const assertBoolean = (value, context) => {
  if (typeof value !== 'boolean') fail('invalid_value', `${context}_must_be_boolean`)
}

const assertString = (value, context, { min = 1, max = 4096, pattern } = {}) => {
  if (typeof value !== 'string' || value.length < min || value.length > max) {
    fail('invalid_value', `${context}_invalid_string`)
  }
  if (pattern && !pattern.test(value)) fail('invalid_value', `${context}_pattern_mismatch`)
  return value
}

const SHA1 = /^[0-9a-f]{40}$/u
const SHA256 = /^[0-9a-f]{64}$/u
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/u
const OPAQUE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]*(?::[A-Za-z0-9][A-Za-z0-9._-]*)?$/u
const NONCE = /^[A-Za-z0-9_-]{32,128}$/u
const SIGNATURE = /^[A-Za-z0-9_-]{43,1024}$/u
const MEDIA_TYPE = /^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+$/u
const UTC_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u

const assertSha1 = (value, context, nullable = false) => {
  if (nullable && value === null) return
  assertString(value, context, { min: 40, max: 40, pattern: SHA1 })
}

const assertSha256 = (value, context, nullable = false) => {
  if (nullable && value === null) return
  assertString(value, context, { min: 64, max: 64, pattern: SHA256 })
}

const assertIdentifier = (value, context, nullable = false) => {
  if (nullable && value === null) return
  assertString(value, context, { min: 3, max: 128, pattern: IDENTIFIER })
}

const assertOpaqueIdentifier = (value, context, nullable = false) => {
  if (nullable && value === null) return
  assertString(value, context, { min: 3, max: 128, pattern: OPAQUE_IDENTIFIER })
}

const assertTimestamp = (value, context) => {
  assertString(value, context, { min: 24, max: 24, pattern: UTC_TIMESTAMP })
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== value) {
    fail('invalid_value', `${context}_invalid_timestamp`)
  }
  return timestamp
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

const normalizeCanonical = (value, context = '$', depth = 0) => {
  if (depth > 64) fail('evidence_budget_exceeded', `${context}_json_depth_limit`)
  if (value === null || typeof value === 'boolean') return value
  if (typeof value === 'string') {
    assertNoLoneSurrogate(value, context)
    return value
  }
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) fail('non_ijson_value', `${context}_number_not_safe_integer`)
    return value
  }
  if (Array.isArray(value)) {
    return value.map((item, index) => normalizeCanonical(item, `${context}[${index}]`, depth + 1))
  }
  if (!isPlainObject(value)) fail('non_ijson_value', `${context}_unsupported_type`)
  const keys = Object.keys(value).sort()
  const normalized = {}
  for (const key of keys) {
    assertNoLoneSurrogate(key, `${context}.key`)
    if (['__proto__', 'constructor', 'prototype'].includes(key)) {
      fail('non_ijson_value', `${context}_reserved_key`)
    }
    normalized[key] = normalizeCanonical(value[key], `${context}.${key}`, depth + 1)
  }
  return normalized
}

export const canonicalJson = (value) => JSON.stringify(normalizeCanonical(value))
export const sha256 = (value) => createHash('sha256').update(value).digest('hex')

const constantTimeTextEqual = (left, right) => {
  if (typeof left !== 'string' || typeof right !== 'string') return false
  const leftBytes = Buffer.from(left)
  const rightBytes = Buffer.from(right)
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes)
}

const parseCanonicalJson = (raw, context, maxBytes) => {
  let bytes
  if (Buffer.isBuffer(raw)) bytes = raw
  else if (typeof raw === 'string') bytes = Buffer.from(raw, 'utf8')
  else fail('invalid_json_input', `${context}_must_be_utf8_string_or_buffer`)
  if (bytes.length === 0 || bytes.length > maxBytes) fail('evidence_budget_exceeded', `${context}_byte_budget`)
  const text = bytes.toString('utf8')
  if (!Buffer.from(text, 'utf8').equals(bytes) || text.charCodeAt(0) === 0xfeff) {
    fail('invalid_json_input', `${context}_not_strict_utf8`)
  }
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    fail('invalid_json_input', `${context}_malformed_json`)
  }
  const canonical = canonicalJson(parsed)
  if (text !== canonical) {
    // This also rejects duplicate keys because parsing collapses them before
    // canonical serialization, so the original bytes can no longer match.
    fail('non_canonical_json', `${context}_must_be_rfc8785_canonical_bytes`)
  }
  return parsed
}

const SECRET_KEY = /(?:^|[_-])(?:token|password|passwd|secret|private[_-]?key|ssh|cookie|authorization|credential)(?:$|[_-])/iu
const SECRET_VALUES = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u,
  /\b(?:gh[pousr]_|github_pat_)[A-Za-z0-9_]{8,}\b/u,
  /\bAKIA[0-9A-Z]{16}\b/u,
  /\bBearer\s+[A-Za-z0-9._~+\/-]{8,}/iu,
]

const assertNoSecretMaterial = (value, context = '$') => {
  if (typeof value === 'string') {
    if (SECRET_VALUES.some((pattern) => pattern.test(value))) {
      fail('secret_material_detected', `${context}_contains_secret_pattern`)
    }
    return
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoSecretMaterial(item, `${context}[${index}]`))
    return
  }
  if (!isPlainObject(value)) return
  for (const [key, item] of Object.entries(value)) {
    if (SECRET_KEY.test(key)) fail('secret_material_detected', `${context}_secret_key_name`)
    assertNoSecretMaterial(item, `${context}.${key}`)
  }
}

const deepFreeze = (value) => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    Object.values(value).forEach(deepFreeze)
  }
  return value
}

const assertSortedUnique = (items, key, context, { caseInsensitive = false } = {}) => {
  const values = items.map(key)
  for (let index = 1; index < values.length; index += 1) {
    if (values[index - 1] >= values[index]) fail('invalid_order', `${context}_not_strictly_sorted`)
  }
  if (caseInsensitive) {
    const folded = new Set()
    for (const value of values) {
      const candidate = value.normalize('NFC').toLowerCase()
      if (folded.has(candidate)) fail('ambiguous_path', `${context}_case_or_unicode_collision`)
      folded.add(candidate)
    }
  }
}

const assertRepository = (repository, context) => {
  exactKeys(repository, ['full_name', 'repository_id'], context)
  assertString(repository.full_name, `${context}.full_name`, {
    min: 3, max: 200, pattern: /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u,
  })
  assertSafeInteger(repository.repository_id, `${context}.repository_id`, 1)
}

const assertPullRequest = (pullRequest, context, { refs = false, mergeBase = false } = {}) => {
  const keys = ['number', 'base_oid', 'head_oid']
  if (refs) keys.push('base_ref', 'head_ref')
  if (mergeBase) keys.push('merge_base_oid')
  exactKeys(pullRequest, keys, context)
  assertSafeInteger(pullRequest.number, `${context}.number`, 1)
  assertSha1(pullRequest.base_oid, `${context}.base_oid`)
  assertSha1(pullRequest.head_oid, `${context}.head_oid`)
  if (pullRequest.base_oid === pullRequest.head_oid) fail('invalid_exact_tuple', `${context}_base_equals_head`)
  if (refs) {
    assertIdentifier(pullRequest.base_ref, `${context}.base_ref`)
    assertIdentifier(pullRequest.head_ref, `${context}.head_ref`)
  }
  if (mergeBase) assertSha1(pullRequest.merge_base_oid, `${context}.merge_base_oid`)
}

const assertRepoPath = (value, context) => {
  assertString(value, context, { min: 1, max: 4096 })
  if (
    value !== value.normalize('NFC') || value.includes('\\') || value.includes('\0') ||
    value.includes('\r') || value.includes('\n') || value.startsWith('/') ||
    /^[A-Za-z]:/u.test(value)
  ) fail('ambiguous_path', `${context}_not_normalized_repo_path`)
  const segments = value.split('/')
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    fail('ambiguous_path', `${context}_contains_ambiguous_segment`)
  }
}

const classificationKeys = (kind, classification) => {
  if (['draft_report_only', 'ordinary'].includes(kind)) return ['kind']
  if (['repair', 'revert'].includes(kind)) return ['kind', 'failure_delivery_id']
  if (kind === 'reconciliation') return Object.hasOwn(classification, 'debt_id')
    ? ['kind', 'delivery_id', 'debt_id']
    : ['kind', 'delivery_id']
  if (kind === 'activation_canary') return ['kind', 'activation_plan_id']
  if (kind === 'activation_closure') return ['kind', 'activation_plan_id', 'debt_id', 'canary_delivery_id']
  if (kind === 'release_hotfix') return ['kind', 'release_id']
  fail('classification_unknown', 'classification_kind_not_closed')
}

const assertClassification = (classification, evidence) => {
  if (!isPlainObject(classification) || !PR_CLASSES.includes(classification.kind)) {
    fail('classification_unknown', 'classification_kind_not_closed')
  }
  exactKeys(classification, classificationKeys(classification.kind, classification), 'classification')
  for (const [key, value] of Object.entries(classification)) {
    if (key !== 'kind') assertOpaqueIdentifier(value, `classification.${key}`)
  }
  exactKeys(evidence, [
    'source', 'activation_phase', 'draft', 'queue_state', 'complete_paths_sha256',
    'classification_lease_sha256',
  ], 'classification_evidence')
  if (evidence.source !== 'server_authoritative') fail('classification_untrusted', 'classification_source_invalid')
  if (!ACTIVATION_PHASES.includes(evidence.activation_phase)) fail('classification_unknown', 'activation_phase_invalid')
  assertBoolean(evidence.draft, 'classification_evidence.draft')
  if (!['open', 'frozen', 'activation_exclusive'].includes(evidence.queue_state)) {
    fail('classification_unknown', 'queue_state_invalid')
  }
  assertSha256(evidence.complete_paths_sha256, 'classification_evidence.complete_paths_sha256')
  assertSha256(evidence.classification_lease_sha256, 'classification_evidence.classification_lease_sha256', true)

  const kind = classification.kind
  if (kind === 'draft_report_only') {
    if (!evidence.draft || evidence.queue_state !== 'open' || evidence.classification_lease_sha256 !== null) {
      fail('classification_ambiguous', 'draft_classification_evidence_invalid')
    }
    return
  }
  if (evidence.draft || evidence.classification_lease_sha256 === null) {
    fail('classification_untrusted', 'non_draft_requires_signed_classification_lease')
  }
  if (kind === 'ordinary' && (evidence.activation_phase !== 'AUTONOMOUS_ACTIVE' || evidence.queue_state !== 'open')) {
    fail('classification_lane_invalid', 'ordinary_requires_active_open_queue')
  }
  if (['repair', 'revert'].includes(kind) && (
    !['CANARY_ACTIVE', 'AUTONOMOUS_ACTIVE'].includes(evidence.activation_phase) || evidence.queue_state !== 'frozen'
  )) fail('classification_lane_invalid', 'repair_or_revert_requires_frozen_active_queue')
  if (kind === 'reconciliation' && (
    evidence.activation_phase !== 'AUTONOMOUS_ACTIVE' || evidence.queue_state !== 'frozen'
  )) fail('classification_lane_invalid', 'reconciliation_is_post_active_only')
  if (['activation_canary', 'activation_closure'].includes(kind) && (
    evidence.activation_phase !== 'CANARY_ACTIVE' || evidence.queue_state !== 'activation_exclusive'
  )) fail('classification_lane_invalid', 'activation_class_requires_canary_exclusive_queue')
  if (kind === 'release_hotfix' && (
    evidence.activation_phase !== 'AUTONOMOUS_ACTIVE' || evidence.queue_state !== 'frozen'
  )) fail('classification_lane_invalid', 'release_hotfix_requires_frozen_active_queue')
}

const assertArtifact = (artifact, context, { includeAccess = false } = {}) => {
  const keys = ['artifact_id', 'sha256', 'size_bytes', 'media_type', 'retention_class']
  if (includeAccess) keys.push('acl_scope', 'authentication')
  exactKeys(artifact, keys, context)
  assertOpaqueIdentifier(artifact.artifact_id, `${context}.artifact_id`)
  assertSha256(artifact.sha256, `${context}.sha256`)
  assertSafeInteger(artifact.size_bytes, `${context}.size_bytes`, 1)
  assertString(artifact.media_type, `${context}.media_type`, { min: 3, max: 200, pattern: MEDIA_TYPE })
  if (!['ephemeral_24h', 'delivery_30d', 'audit_1y'].includes(artifact.retention_class)) {
    fail('invalid_value', `${context}.retention_class_invalid`)
  }
  if (includeAccess && (
    artifact.acl_scope !== 'issuer_and_executor' || artifact.authentication !== 'short_lived_lease'
  )) fail('artifact_authority_invalid', `${context}_access_contract_invalid`)
}

const validatePacketObject = (packet) => {
  exactKeys(packet, PACKET_KEYS, 'packet')
  if (packet.schema_version !== 'autonomous-delivery-adjudication-packet/v1') {
    fail('schema_version_unknown', 'packet_schema_version_invalid')
  }
  assertRepository(packet.repository, 'packet.repository')
  assertPullRequest(packet.pull_request, 'packet.pull_request', { refs: true, mergeBase: true })
  assertClassification(packet.classification, packet.classification_evidence)
  assertNoSecretMaterial(packet)

  if (!Array.isArray(packet.changed_paths) || packet.changed_paths.length < 1 || packet.changed_paths.length > 3000) {
    fail('evidence_budget_exceeded', 'changed_paths_count_invalid')
  }
  for (const [index, record] of packet.changed_paths.entries()) {
    if (!isPlainObject(record)) fail('invalid_shape', `changed_paths_${index}_must_be_object`)
    const renamed = record.status === 'renamed'
    exactKeys(record, renamed ? ['path', 'status', 'previous_path'] : ['path', 'status'], `changed_paths[${index}]`)
    if (!['added', 'modified', 'deleted', 'copied', 'type_changed', 'renamed'].includes(record.status)) {
      fail('invalid_value', `changed_paths_${index}_status_invalid`)
    }
    assertRepoPath(record.path, `changed_paths[${index}].path`)
    if (renamed) {
      assertRepoPath(record.previous_path, `changed_paths[${index}].previous_path`)
      if (record.path === record.previous_path) fail('ambiguous_path', `changed_paths_${index}_rename_identity`)
    }
  }
  assertSortedUnique(packet.changed_paths, (item) => item.path, 'changed_paths', {
    caseInsensitive: true,
  })
  assertSha256(packet.changed_paths_sha256, 'packet.changed_paths_sha256')
  const changedPathsDigest = sha256(canonicalJson(packet.changed_paths))
  if (!constantTimeTextEqual(packet.changed_paths_sha256, changedPathsDigest)) {
    fail('digest_mismatch', 'changed_paths_sha256_mismatch')
  }
  if (!constantTimeTextEqual(packet.classification_evidence.complete_paths_sha256, changedPathsDigest)) {
    fail('digest_mismatch', 'classification_complete_paths_sha256_mismatch')
  }

  if (!Array.isArray(packet.required_check_sources) || packet.required_check_sources.length > 256) {
    fail('evidence_budget_exceeded', 'required_check_sources_count_invalid')
  }
  if (packet.required_check_sources.length < 1) {
    fail('required_check_not_passing', 'required_check_sources_empty')
  }
  for (const [index, source] of packet.required_check_sources.entries()) {
    exactKeys(source, [
      'context', 'app_id', 'check_run_id', 'head_oid', 'workflow_path',
      'verification_target', 'conclusion',
    ], `required_check_sources[${index}]`)
    assertIdentifier(source.context, `required_check_sources[${index}].context`)
    assertSafeInteger(source.app_id, `required_check_sources[${index}].app_id`, 1)
    assertSafeInteger(source.check_run_id, `required_check_sources[${index}].check_run_id`, 1)
    assertSha1(source.head_oid, `required_check_sources[${index}].head_oid`)
    if (source.head_oid !== packet.pull_request.head_oid) fail('invalid_exact_tuple', `required_check_sources_${index}_wrong_head`)
    assertRepoPath(source.workflow_path, `required_check_sources[${index}].workflow_path`)
    assertIdentifier(source.verification_target, `required_check_sources[${index}].verification_target`)
    if (source.conclusion !== 'success') fail('required_check_not_passing', `required_check_sources_${index}_not_success`)
  }
  assertSortedUnique(
    packet.required_check_sources,
    (source) => `${source.context}\0${String(source.app_id).padStart(16, '0')}\0${String(source.check_run_id).padStart(16, '0')}`,
    'required_check_sources',
  )

  exactKeys(packet.conversation_state, [
    'total_threads', 'resolved_threads', 'unresolved_threads', 'threads_sha256',
  ], 'conversation_state')
  for (const key of ['total_threads', 'resolved_threads', 'unresolved_threads']) {
    assertSafeInteger(packet.conversation_state[key], `conversation_state.${key}`)
  }
  if (packet.conversation_state.resolved_threads + packet.conversation_state.unresolved_threads !== packet.conversation_state.total_threads) {
    fail('conversation_state_invalid', 'conversation_thread_counts_do_not_balance')
  }
  assertSha256(packet.conversation_state.threads_sha256, 'conversation_state.threads_sha256')

  exactKeys(packet.openspec_state, ['required', 'change_name', 'alignment', 'evidence_sha256'], 'openspec_state')
  assertBoolean(packet.openspec_state.required, 'openspec_state.required')
  assertIdentifier(packet.openspec_state.change_name, 'openspec_state.change_name', true)
  if (!['aligned', 'not_applicable'].includes(packet.openspec_state.alignment)) {
    fail('openspec_state_invalid', 'openspec_alignment_unknown')
  }
  assertSha256(packet.openspec_state.evidence_sha256, 'openspec_state.evidence_sha256')
  if (
    (packet.openspec_state.required && (packet.openspec_state.change_name === null || packet.openspec_state.alignment !== 'aligned')) ||
    (!packet.openspec_state.required && (packet.openspec_state.change_name !== null || packet.openspec_state.alignment !== 'not_applicable'))
  ) fail('openspec_state_invalid', 'openspec_requirement_alignment_mismatch')

  exactKeys(packet.review_surface, [
    'changed_paths_sha256', 'diff_sha256', 'policy_sha256', 'manifest_sha256',
    'required_checks_sha256', 'conversation_sha256',
  ], 'review_surface')
  Object.entries(packet.review_surface).forEach(([key, value]) => assertSha256(value, `review_surface.${key}`))
  if (!constantTimeTextEqual(packet.review_surface.changed_paths_sha256, changedPathsDigest)) {
    fail('digest_mismatch', 'review_surface_changed_paths_sha256_mismatch')
  }
  if (!constantTimeTextEqual(packet.review_surface.required_checks_sha256, sha256(canonicalJson(packet.required_check_sources)))) {
    fail('digest_mismatch', 'required_checks_sha256_mismatch')
  }
  if (!constantTimeTextEqual(packet.review_surface.conversation_sha256, sha256(canonicalJson(packet.conversation_state)))) {
    fail('digest_mismatch', 'conversation_sha256_mismatch')
  }
  assertSha256(packet.review_surface_sha256, 'packet.review_surface_sha256')
  if (!constantTimeTextEqual(packet.review_surface_sha256, sha256(canonicalJson(packet.review_surface)))) {
    fail('digest_mismatch', 'review_surface_sha256_mismatch')
  }

  if (!Array.isArray(packet.artifacts) || packet.artifacts.length > 512) {
    fail('evidence_budget_exceeded', 'artifact_count_invalid')
  }
  packet.artifacts.forEach((artifact, index) => assertArtifact(artifact, `artifacts[${index}]`, { includeAccess: true }))
  assertSortedUnique(packet.artifacts, (artifact) => artifact.artifact_id, 'artifacts')
  assertSha256(packet.artifacts_sha256, 'packet.artifacts_sha256')
  if (!constantTimeTextEqual(packet.artifacts_sha256, sha256(canonicalJson(packet.artifacts)))) {
    fail('digest_mismatch', 'artifacts_sha256_mismatch')
  }

  exactKeys(packet.collector, ['kind', 'app_id', 'run_id', 'source_api', 'collected_at'], 'collector')
  if (packet.collector.kind !== 'github_app' || packet.collector.source_api !== 'github_rest_graphql') {
    fail('collector_identity_invalid', 'collector_source_invalid')
  }
  assertSafeInteger(packet.collector.app_id, 'collector.app_id', 1)
  assertSafeInteger(packet.collector.run_id, 'collector.run_id', 1)
  assertTimestamp(packet.collector.collected_at, 'collector.collected_at')

  exactKeys(packet.budgets, [
    'changed_path_count', 'changed_path_limit', 'diff_bytes', 'diff_byte_limit',
    'review_surface_bytes', 'review_surface_byte_limit', 'artifact_count', 'artifact_count_limit',
  ], 'budgets')
  for (const key of Object.keys(packet.budgets)) {
    assertSafeInteger(packet.budgets[key], `budgets.${key}`, key.endsWith('_limit') ? 1 : 0)
  }
  if (
    packet.budgets.changed_path_count !== packet.changed_paths.length ||
    packet.budgets.artifact_count !== packet.artifacts.length ||
    packet.budgets.changed_path_count > packet.budgets.changed_path_limit ||
    packet.budgets.diff_bytes > packet.budgets.diff_byte_limit ||
    packet.budgets.review_surface_bytes > packet.budgets.review_surface_byte_limit ||
    packet.budgets.artifact_count > packet.budgets.artifact_count_limit
  ) fail('evidence_budget_exceeded', 'packet_budget_invalid')
  return packet
}

export function parseAdjudicationPacket(raw) {
  return deepFreeze(validatePacketObject(parseCanonicalJson(raw, 'packet', 16 * 1024 * 1024)))
}

const CLASSIFIER_KEYS = Object.freeze([
  'schema_version', 'source', 'repository', 'pull_request', 'activation_phase', 'draft',
  'queue_state', 'complete_paths_sha256', 'classifier_policy_sha256', 'signed_lease_sha256',
  'lineage',
])
const LINEAGE_KEYS = Object.freeze([
  'remediation_kind', 'failure_delivery_id', 'reconciliation_delivery_id', 'debt_id',
  'activation_plan_id', 'canary_delivery_id', 'release_id',
])

export function classifyPullRequest(raw, { verifyLease } = {}) {
  const input = parseCanonicalJson(raw, 'classifier_input', 256 * 1024)
  exactKeys(input, CLASSIFIER_KEYS, 'classifier_input')
  if (input.schema_version !== 'autonomous-delivery-classifier-input/v1' || input.source !== 'server_authoritative') {
    fail('classification_untrusted', 'classifier_schema_or_source_invalid')
  }
  assertRepository(input.repository, 'classifier_input.repository')
  assertPullRequest(input.pull_request, 'classifier_input.pull_request', { refs: true })
  if (!ACTIVATION_PHASES.includes(input.activation_phase)) fail('classification_unknown', 'classifier_activation_phase_invalid')
  assertBoolean(input.draft, 'classifier_input.draft')
  if (!['open', 'frozen', 'activation_exclusive'].includes(input.queue_state)) {
    fail('classification_unknown', 'classifier_queue_state_invalid')
  }
  assertSha256(input.complete_paths_sha256, 'classifier_input.complete_paths_sha256')
  assertSha256(input.classifier_policy_sha256, 'classifier_input.classifier_policy_sha256')
  assertSha256(input.signed_lease_sha256, 'classifier_input.signed_lease_sha256', true)
  exactKeys(input.lineage, LINEAGE_KEYS, 'classifier_input.lineage')
  if (![null, 'repair', 'revert'].includes(input.lineage.remediation_kind)) {
    fail('classification_unknown', 'classifier_remediation_kind_invalid')
  }
  for (const key of LINEAGE_KEYS.filter((key) => key !== 'remediation_kind')) {
    assertOpaqueIdentifier(input.lineage[key], `classifier_input.lineage.${key}`, true)
  }
  assertNoSecretMaterial(input)

  const lineage = input.lineage
  const present = (key) => lineage[key] !== null
  const noneExcept = (...allowed) => LINEAGE_KEYS
    .filter((key) => key !== 'remediation_kind' && !allowed.includes(key))
    .every((key) => lineage[key] === null)
  let classification
  if (input.draft) {
    if (input.queue_state !== 'open' || input.signed_lease_sha256 !== null || lineage.remediation_kind !== null || !noneExcept()) {
      fail('classification_ambiguous', 'draft_has_privileged_lineage_or_lease')
    }
    classification = { kind: 'draft_report_only' }
  } else {
    if (input.signed_lease_sha256 === null) fail('classification_untrusted', 'non_draft_classifier_requires_signed_lease')
    // A digest alone is self-attested shape, not authority. Mirror the
    // attestation path: no verifier, no classification lane.
    if (typeof verifyLease !== 'function') {
      fail('classification_authority_unavailable', 'lease_verifier_missing')
    }
    const leaseVerified = verifyLease({
      signedLeaseSha256: input.signed_lease_sha256,
      repository: input.repository,
      pullRequest: input.pull_request,
      activationPhase: input.activation_phase,
    })
    if (leaseVerified !== true) fail('classification_untrusted', 'lease_authority_rejected')
    if (lineage.remediation_kind !== null && present('failure_delivery_id') && noneExcept('failure_delivery_id')) {
      classification = { kind: lineage.remediation_kind, failure_delivery_id: lineage.failure_delivery_id }
    } else if (
      lineage.remediation_kind === null && present('reconciliation_delivery_id') &&
      noneExcept('reconciliation_delivery_id', 'debt_id')
    ) {
      classification = { kind: 'reconciliation', delivery_id: lineage.reconciliation_delivery_id }
      if (present('debt_id')) classification.debt_id = lineage.debt_id
    } else if (
      lineage.remediation_kind === null && present('activation_plan_id') &&
      !present('debt_id') && !present('canary_delivery_id') && noneExcept('activation_plan_id')
    ) {
      classification = { kind: 'activation_canary', activation_plan_id: lineage.activation_plan_id }
    } else if (
      lineage.remediation_kind === null && present('activation_plan_id') && present('debt_id') &&
      present('canary_delivery_id') && noneExcept('activation_plan_id', 'debt_id', 'canary_delivery_id')
    ) {
      classification = {
        kind: 'activation_closure', activation_plan_id: lineage.activation_plan_id,
        debt_id: lineage.debt_id, canary_delivery_id: lineage.canary_delivery_id,
      }
    } else if (lineage.remediation_kind === null && present('release_id') && noneExcept('release_id')) {
      classification = { kind: 'release_hotfix', release_id: lineage.release_id }
    } else if (lineage.remediation_kind === null && noneExcept()) {
      classification = { kind: 'ordinary' }
    } else {
      fail('classification_ambiguous', 'classifier_lineage_matches_zero_or_multiple_classes')
    }
  }
  assertClassification(classification, {
    source: input.source,
    activation_phase: input.activation_phase,
    draft: input.draft,
    queue_state: input.queue_state,
    complete_paths_sha256: input.complete_paths_sha256,
    classification_lease_sha256: input.signed_lease_sha256,
  })
  return deepFreeze(classification)
}

const validateEnvelopeObject = (envelope, packet, now) => {
  exactKeys(envelope, ENVELOPE_KEYS, 'attestation_envelope')
  if (envelope.schema_version !== 'autonomous-delivery-attestation-envelope/v1') {
    fail('schema_version_unknown', 'attestation_schema_version_invalid')
  }
  if (
    envelope.purpose !== 'critical_machine_adjudication' ||
    envelope.audience !== 'autonomous-delivery-merge-executor/v1' ||
    envelope.canonicalization !== 'RFC8785' ||
    envelope.signature_domain !== 'ai-bim-autonomous-delivery-attestation/v1'
  ) fail('attestation_domain_invalid', 'attestation_purpose_audience_or_domain_invalid')
  assertOpaqueIdentifier(envelope.attestation_id, 'attestation_envelope.attestation_id')
  assertRepository(envelope.repository, 'attestation_envelope.repository')
  assertPullRequest(envelope.pull_request, 'attestation_envelope.pull_request')
  if (
    canonicalJson(envelope.repository) !== canonicalJson(packet.repository) ||
    envelope.pull_request.number !== packet.pull_request.number ||
    envelope.pull_request.base_oid !== packet.pull_request.base_oid ||
    envelope.pull_request.head_oid !== packet.pull_request.head_oid
  ) fail('invalid_exact_tuple', 'attestation_packet_tuple_mismatch')
  for (const key of [
    'packet_sha256', 'diff_sha256', 'policy_sha256', 'manifest_sha256',
    'review_surface_sha256', 'artifacts_sha256',
  ]) assertSha256(envelope[key], `attestation_envelope.${key}`)
  const expectedDigests = {
    packet_sha256: sha256(canonicalJson(packet)),
    diff_sha256: packet.review_surface.diff_sha256,
    policy_sha256: packet.review_surface.policy_sha256,
    manifest_sha256: packet.review_surface.manifest_sha256,
    review_surface_sha256: packet.review_surface_sha256,
    artifacts_sha256: packet.artifacts_sha256,
  }
  for (const [key, expected] of Object.entries(expectedDigests)) {
    if (!constantTimeTextEqual(envelope[key], expected)) fail('digest_mismatch', `attestation_${key}_mismatch`)
  }
  exactKeys(envelope.issuer, ['kind', 'app_id'], 'attestation_envelope.issuer')
  if (envelope.issuer.kind !== 'github_app') fail('attestation_issuer_invalid', 'attestation_issuer_kind_invalid')
  assertSafeInteger(envelope.issuer.app_id, 'attestation_envelope.issuer.app_id', 1)
  assertOpaqueIdentifier(envelope.key_id, 'attestation_envelope.key_id')
  if (envelope.algorithm !== 'ed25519') fail('attestation_algorithm_invalid', 'attestation_algorithm_not_allowlisted')
  assertString(envelope.nonce, 'attestation_envelope.nonce', { min: 32, max: 128, pattern: NONCE })
  if (envelope.nonce_consumption !== 'atomic_single_use') fail('attestation_nonce_invalid', 'nonce_consumption_not_atomic')
  const issuedAt = assertTimestamp(envelope.issued_at, 'attestation_envelope.issued_at')
  const expiresAt = assertTimestamp(envelope.expires_at, 'attestation_envelope.expires_at')
  const nowMs = now instanceof Date ? now.getTime() : Number.NaN
  if (!Number.isFinite(nowMs)) fail('attestation_time_invalid', 'attestation_now_invalid')
  if (expiresAt <= issuedAt || expiresAt - issuedAt > 900_000) {
    fail('attestation_time_invalid', 'attestation_lifetime_invalid')
  }
  if (issuedAt > nowMs + 60_000 || expiresAt <= nowMs) fail('attestation_expired', 'attestation_outside_clock_window')
  assertString(envelope.signature, 'attestation_envelope.signature', { min: 43, max: 1024, pattern: SIGNATURE })
  assertNoSecretMaterial(envelope)
  return envelope
}

export function parseAttestationEnvelope(raw, packetRaw, now = new Date()) {
  const packet = typeof packetRaw === 'string' || Buffer.isBuffer(packetRaw)
    ? parseAdjudicationPacket(packetRaw)
    : deepFreeze(validatePacketObject(structuredClone(packetRaw)))
  const envelope = parseCanonicalJson(raw, 'attestation_envelope', 256 * 1024)
  return deepFreeze(validateEnvelopeObject(envelope, packet, now))
}

const signingBytesForValidatedEnvelope = (envelope) => {
  const unsigned = Object.fromEntries(Object.entries(envelope).filter(([key]) => key !== 'signature'))
  return Buffer.from(`${envelope.signature_domain}\0${canonicalJson(unsigned)}`, 'utf8')
}

export function attestationSigningBytes(raw, packetRaw, now = new Date()) {
  const envelope = typeof raw === 'string' || Buffer.isBuffer(raw)
    ? parseAttestationEnvelope(raw, packetRaw, now)
    : parseAttestationEnvelope(canonicalJson(raw), packetRaw, now)
  return signingBytesForValidatedEnvelope(envelope)
}

export function authorizeAttestationEnvelope(raw, packetRaw, {
  now = new Date(), verifySignature, consumeNonce,
} = {}) {
  if (typeof verifySignature !== 'function' || typeof consumeNonce !== 'function') {
    fail('attestation_authority_unavailable', 'signature_and_nonce_authorities_required')
  }
  const packet = typeof packetRaw === 'string' || Buffer.isBuffer(packetRaw)
    ? parseAdjudicationPacket(packetRaw)
    : deepFreeze(validatePacketObject(structuredClone(packetRaw)))
  const envelope = parseAttestationEnvelope(raw, packet, now)
  const verified = verifySignature({
    issuer: envelope.issuer,
    keyId: envelope.key_id,
    algorithm: envelope.algorithm,
    signingBytes: signingBytesForValidatedEnvelope(envelope),
    signature: envelope.signature,
  })
  if (verified !== true) fail('attestation_signature_invalid', 'signature_authority_rejected')
  const consumed = consumeNonce({
    issuer: envelope.issuer,
    nonce: envelope.nonce,
    expiresAt: envelope.expires_at,
    packetSha256: envelope.packet_sha256,
  })
  if (consumed !== true) fail('attestation_nonce_reused', 'nonce_not_atomically_consumed')
  return deepFreeze({ packet, envelope })
}

const validateTerminalObject = (record) => {
  exactKeys(record, TERMINAL_KEYS, 'terminal_record')
  if (record.schema_version !== 'autonomous-delivery-terminal-record/v1') {
    fail('schema_version_unknown', 'terminal_schema_version_invalid')
  }
  assertOpaqueIdentifier(record.delivery_id, 'terminal_record.delivery_id')
  assertOpaqueIdentifier(record.attempt_id, 'terminal_record.attempt_id')
  if (!PR_CLASSES.includes(record.pr_class) || record.pr_class === 'draft_report_only') {
    fail('classification_unknown', 'terminal_pr_class_invalid')
  }
  assertOpaqueIdentifier(record.supersedes_delivery_id, 'terminal_record.supersedes_delivery_id', true)
  assertOpaqueIdentifier(record.supersedes_attempt_id, 'terminal_record.supersedes_attempt_id', true)
  assertSha256(record.previous_attempt_sha256, 'terminal_record.previous_attempt_sha256', true)
  const supersedesValues = [
    record.supersedes_delivery_id, record.supersedes_attempt_id, record.previous_attempt_sha256,
  ]
  if (!supersedesValues.every((value) => value === null) && !supersedesValues.every((value) => value !== null)) {
    fail('attempt_lineage_invalid', 'supersedes_tuple_must_be_all_null_or_all_present')
  }
  assertRepository(record.repository, 'terminal_record.repository')
  assertPullRequest(record.pull_request, 'terminal_record.pull_request')
  if (record.phase !== 'CLOSED' || !LAST_PHASES.includes(record.last_phase)) {
    fail('terminal_state_invalid', 'terminal_phase_invalid')
  }
  if (!TERMINAL_CLASSES.includes(record.terminal_class) || !REASON_CODES.includes(record.reason_code)) {
    fail('terminal_state_invalid', 'terminal_class_or_reason_unknown')
  }
  if (!TERMINAL_REASON_MAP[record.terminal_class].includes(record.reason_code)) {
    fail('terminal_state_invalid', 'terminal_class_reason_mismatch')
  }
  if (!REASON_LAST_PHASES[record.reason_code].includes(record.last_phase)) {
    fail('terminal_state_invalid', 'reason_last_phase_mismatch')
  }
  assertBoolean(record.merge_observed, 'terminal_record.merge_observed')
  assertSha1(record.merge_commit_oid, 'terminal_record.merge_commit_oid', true)
  assertSha1(record.fetched_origin_main_oid, 'terminal_record.fetched_origin_main_oid', true)
  assertSha1(record.deployed_commit_oid, 'terminal_record.deployed_commit_oid', true)
  if (!['not_started', 'started', 'completed'].includes(record.command_state)) {
    fail('terminal_state_invalid', 'command_state_unknown')
  }
  if (record.target_id !== null) {
    assertOpaqueIdentifier(record.target_id, 'terminal_record.target_id')
  }
  if (!Array.isArray(record.runner_ids) || record.runner_ids.length > 32) {
    fail('invalid_shape', 'terminal_runner_ids_invalid')
  }
  record.runner_ids.forEach((runnerId, index) => assertOpaqueIdentifier(runnerId, `terminal_record.runner_ids[${index}]`))
  assertSortedUnique(record.runner_ids, (runnerId) => runnerId, 'terminal_runner_ids')
  if (!Array.isArray(record.gates) || record.gates.length > 256) fail('invalid_shape', 'terminal_gates_invalid')
  for (const [index, gate] of record.gates.entries()) {
    exactKeys(gate, ['gate_id', 'status', 'result_sha256'], `terminal_record.gates[${index}]`)
    assertOpaqueIdentifier(gate.gate_id, `terminal_record.gates[${index}].gate_id`)
    if (!['passed', 'failed', 'held', 'not_applicable'].includes(gate.status)) {
      fail('terminal_state_invalid', `terminal_gate_${index}_status_invalid`)
    }
    assertSha256(gate.result_sha256, `terminal_record.gates[${index}].result_sha256`)
  }
  assertSortedUnique(record.gates, (gate) => gate.gate_id, 'terminal_gates')
  if (!Array.isArray(record.artifacts) || record.artifacts.length > 512) fail('invalid_shape', 'terminal_artifacts_invalid')
  record.artifacts.forEach((artifact, index) => assertArtifact(artifact, `terminal_record.artifacts[${index}]`))
  assertSortedUnique(record.artifacts, (artifact) => artifact.artifact_id, 'terminal_artifacts')
  if (!Array.isArray(record.failure_detail) || record.failure_detail.length > 64) {
    fail('invalid_shape', 'terminal_failure_detail_invalid')
  }
  for (const [index, detail] of record.failure_detail.entries()) {
    exactKeys(detail, ['namespace', 'code', 'evidence_sha256'], `terminal_record.failure_detail[${index}]`)
    assertOpaqueIdentifier(detail.namespace, `terminal_record.failure_detail[${index}].namespace`)
    assertOpaqueIdentifier(detail.code, `terminal_record.failure_detail[${index}].code`)
    assertSha256(detail.evidence_sha256, `terminal_record.failure_detail[${index}].evidence_sha256`)
  }
  assertSortedUnique(record.failure_detail, (detail) => `${detail.namespace}\0${detail.code}`, 'terminal_failure_detail')
  const artifactDigests = new Set(record.artifacts.map((artifact) => artifact.sha256))
  if (record.failure_detail.some((detail) => !artifactDigests.has(detail.evidence_sha256))) {
    fail('failure_evidence_incomplete', 'failure_detail_digest_not_present_in_artifacts')
  }
  assertTimestamp(record.closed_at, 'terminal_record.closed_at')
  assertNoSecretMaterial(record)

  const allCommitFieldsNull = [
    record.merge_commit_oid, record.fetched_origin_main_oid, record.deployed_commit_oid,
  ].every((value) => value === null)
  if (!record.merge_observed && !allCommitFieldsNull) fail('commit_attribution_invalid', 'unobserved_merge_has_commit_identity')
  if (record.merge_observed && record.merge_commit_oid === null) fail('commit_attribution_invalid', 'observed_merge_missing_commit')

  if (record.terminal_class === 'DELIVERED') {
    if (
      !record.merge_observed || record.command_state !== 'completed' || record.target_id === null ||
      record.runner_ids.length < 2 || record.gates.length === 0 || record.artifacts.length === 0 ||
      record.failure_detail.length !== 0 || record.gates.some((gate) => !['passed', 'not_applicable'].includes(gate.status)) ||
      !record.gates.some((gate) => gate.status === 'passed') ||
      record.merge_commit_oid === null || record.merge_commit_oid !== record.fetched_origin_main_oid ||
      record.merge_commit_oid !== record.deployed_commit_oid
    ) fail('delivery_evidence_incomplete', 'delivered_record_missing_exact_positive_evidence')
  }
  if (record.terminal_class === 'FAILED') {
    if (
      !record.merge_observed || record.command_state !== 'completed' || record.target_id === null ||
      record.runner_ids.length === 0 || !record.gates.some((gate) => gate.status === 'failed') ||
      record.failure_detail.length === 0 || record.artifacts.length === 0 ||
      record.merge_commit_oid === null || record.fetched_origin_main_oid !== record.merge_commit_oid ||
      (record.deployed_commit_oid !== null && record.deployed_commit_oid !== record.merge_commit_oid)
    ) fail('failure_evidence_incomplete', 'failed_record_missing_reproducible_negative_evidence')
  }
  if (['PREMERGE_EVIDENCE_INVALID', 'PREMERGE_AUTHORITY_UNAVAILABLE'].includes(record.reason_code)) {
    if (record.merge_observed || !allCommitFieldsNull || record.command_state !== 'not_started' || record.target_id !== null) {
      fail('terminal_state_invalid', 'premerge_reason_crossed_merge_boundary')
    }
  }
  if (record.reason_code === 'MERGE_OUTCOME_UNVERIFIED' && (
    record.merge_observed || !allCommitFieldsNull || record.command_state !== 'not_started'
  )) fail('terminal_state_invalid', 'ambiguous_merge_claims_authoritative_commit')
  if (record.reason_code === 'DEPLOYMENT_BLOCKED' && (
    !record.merge_observed || record.command_state !== 'not_started' || record.merge_commit_oid === null ||
    record.fetched_origin_main_oid !== record.merge_commit_oid || record.deployed_commit_oid !== null
  )) fail('terminal_state_invalid', 'deployment_blocked_boundary_invalid')
  if (record.reason_code === 'DELIVERY_PENDING_FIXPOINT' && (
    !record.merge_observed || record.command_state !== 'completed' || record.target_id === null ||
    record.merge_commit_oid === null || record.merge_commit_oid !== record.fetched_origin_main_oid ||
    record.merge_commit_oid !== record.deployed_commit_oid || record.runner_ids.length < 2 ||
    record.gates.length === 0 || record.artifacts.length === 0 ||
    record.gates.some((gate) => !['passed', 'not_applicable'].includes(gate.status))
  )) fail('terminal_state_invalid', 'fixpoint_hold_missing_completed_delivery_identity')
  return record
}

export function parseTerminalRecord(raw) {
  return deepFreeze(validateTerminalObject(parseCanonicalJson(raw, 'terminal_record', 2 * 1024 * 1024)))
}

export function assertPhaseTransition(fromPhase, toPhase, { supersedesAttempt = false } = {}) {
  if (!PHASES.includes(toPhase)) fail('illegal_transition', 'transition_target_unknown')
  if (fromPhase === null) {
    if (toPhase === 'COLLECTING' || (toPhase === 'RETRYING_DEPLOYMENT' && supersedesAttempt)) return true
    fail('illegal_transition', 'initial_phase_invalid')
  }
  if (!PHASES.includes(fromPhase) || !TRANSITIONS[fromPhase].includes(toPhase)) {
    fail('illegal_transition', `${fromPhase}_to_${toPhase}_not_allowed`)
  }
  return true
}

const recordKey = (record) => `${record.delivery_id}\0${record.attempt_id}`

export function validateAttemptAppend(historyRaw, candidateRaw) {
  if (!Array.isArray(historyRaw)) fail('attempt_lineage_invalid', 'attempt_history_must_be_array')
  const history = historyRaw.map((raw) => (
    typeof raw === 'string' || Buffer.isBuffer(raw)
      ? parseTerminalRecord(raw)
      : deepFreeze(validateTerminalObject(structuredClone(raw)))
  ))
  const candidate = typeof candidateRaw === 'string' || Buffer.isBuffer(candidateRaw)
    ? parseTerminalRecord(candidateRaw)
    : deepFreeze(validateTerminalObject(structuredClone(candidateRaw)))
  const seen = new Map()
  const children = new Set()
  for (const record of [...history, candidate]) {
    const key = recordKey(record)
    if (seen.has(key)) fail('attempt_rewrite_forbidden', 'attempt_identity_already_exists')
    if (record.supersedes_attempt_id !== null) {
      const parentKey = `${record.supersedes_delivery_id}\0${record.supersedes_attempt_id}`
      const parent = seen.get(parentKey)
      if (!parent) fail('attempt_lineage_invalid', 'superseded_attempt_not_earlier_in_history')
      if (children.has(parentKey)) fail('attempt_lineage_invalid', 'attempt_lineage_fork_forbidden')
      if (!constantTimeTextEqual(record.previous_attempt_sha256, sha256(canonicalJson(parent)))) {
        fail('attempt_rewrite_forbidden', 'previous_attempt_digest_mismatch')
      }
      if (Date.parse(record.closed_at) <= Date.parse(parent.closed_at)) {
        fail('attempt_lineage_invalid', 'attempt_timestamp_not_monotonic')
      }
      if (record.delivery_id === parent.delivery_id) {
        if (
          record.repository.full_name !== parent.repository.full_name ||
          record.repository.repository_id !== parent.repository.repository_id ||
          record.pull_request.number !== parent.pull_request.number ||
          record.pull_request.base_oid !== parent.pull_request.base_oid ||
          record.pull_request.head_oid !== parent.pull_request.head_oid ||
          record.pr_class !== parent.pr_class ||
          record.merge_observed !== parent.merge_observed ||
          record.merge_commit_oid !== parent.merge_commit_oid ||
          record.fetched_origin_main_oid !== parent.fetched_origin_main_oid ||
          record.target_id !== parent.target_id
        ) fail('attempt_lineage_invalid', 'same_delivery_retry_tuple_drift')
      } else if (!allowedQueueLanes(parent).includes(record.pr_class)) {
        fail('attempt_lineage_invalid', 'cross_delivery_successor_class_not_allowed_by_parent')
      }
      children.add(parentKey)
    } else if ([...seen.values()].some((prior) => prior.delivery_id === record.delivery_id)) {
      fail('attempt_lineage_invalid', 'delivery_may_have_only_one_root_attempt')
    }
    seen.set(key, record)
  }
  return candidate
}

export function allowedQueueLanes(recordRaw) {
  const record = typeof recordRaw === 'string' || Buffer.isBuffer(recordRaw)
    ? parseTerminalRecord(recordRaw)
    : deepFreeze(validateTerminalObject(structuredClone(recordRaw)))
  if (record.terminal_class === 'DELIVERED' && record.pr_class === 'activation_canary') {
    return Object.freeze(['activation_closure'])
  }
  if (record.terminal_class === 'DELIVERED') return Object.freeze(['ordinary'])
  if (record.terminal_class === 'FAILED') return Object.freeze(['repair', 'revert'])
  if (['MERGE_OUTCOME_UNVERIFIED', 'DELIVERY_PENDING_FIXPOINT'].includes(record.reason_code)) {
    return Object.freeze(['reconciliation'])
  }
  return Object.freeze([])
}
